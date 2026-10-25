"""Tamper-evident audit log (API.md "Audit log and hash chain").

hash = sha256(prev_hash + "|" + canonical_json(at, org_id, actor_user_id, action, record_type, record_id, changes, reason))
`prev_hash` is the previous row's hash in the same organisation; a per-organisation transaction-level advisory lock
serialises inserts so the chain never forks. Phones and contacts are masked inside `changes`.
"""
from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from . import db
from .crypto import mask_phone

ACTIONS = {"create", "update", "transition", "delete", "view_sensitive", "export", "login", "login_failed", "logout",
           "permission_change", "config_change", "mfa_enrol", "password_reset", "sync"}

SENSITIVE_KEY = re.compile(r"(phone|mobile|contact|whatsapp)", re.I)
EMAIL_KEY = re.compile(r"email", re.I)


def _jsonable(o: Any) -> Any:
    if isinstance(o, datetime):
        return o.astimezone(timezone.utc).isoformat(timespec="microseconds")
    if isinstance(o, date):
        return o.isoformat()
    if isinstance(o, (uuid.UUID, Decimal)):
        return str(o)
    if isinstance(o, (bytes, bytearray, memoryview)):
        return "<bytes>"
    if isinstance(o, set):
        return sorted(_jsonable(x) for x in o)
    return str(o)


def normalize(value: Any) -> Any:
    """JSON round trip so the hashed value equals what jsonb stores and returns."""
    return json.loads(json.dumps(value, default=_jsonable, ensure_ascii=False))


def mask_sensitive(value: Any, key: str = "") -> Any:
    """Mask phone numbers and contact details anywhere inside `changes`."""
    if isinstance(value, dict):
        return {k: mask_sensitive(v, str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [mask_sensitive(v, key) for v in value]
    if isinstance(value, str) and key:
        if SENSITIVE_KEY.search(key):
            if key.lower().endswith("_enc") or value.startswith("v1:"):
                return "<encrypted>"
            return mask_phone(value) if any(ch.isdigit() for ch in value) else ("•" * min(len(value), 8) if value else "")
        if EMAIL_KEY.search(key) and "@" in value:
            local, _, domain = value.partition("@")
            return f"{local[:1]}•••@{domain}"
    return value


def canonical(at: datetime, org_id: str | None, actor_user_id: str | None, action: str, record_type: str, record_id: str,
              changes: Any, reason: str) -> str:
    payload = {
        "at": at.astimezone(timezone.utc).isoformat(timespec="microseconds"),
        "org_id": str(org_id) if org_id else None,
        "actor_user_id": str(actor_user_id) if actor_user_id else None,
        "action": action,
        "record_type": record_type,
        "record_id": record_id,
        "changes": changes,
        "reason": reason,
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_hash(prev_hash: str, canon: str) -> str:
    return hashlib.sha256((prev_hash + "|" + canon).encode("utf-8")).hexdigest()


def _lock_key(org_id: str | None) -> int:
    h = hashlib.sha256((org_id or "none").encode()).digest()
    return int.from_bytes(h[:8], "big", signed=True)


async def audit(conn, *, org_id: str | None, actor: Any = None, actor_user_id: str | None = None, actor_role: str = "",
                action: str, record_type: str = "", record_id: str = "", changes: Any = None, reason: str = "",
                site_id: str | None = None, device_id: str = "", ip: str = "") -> int:
    """Write one chained audit row inside the caller's transaction. `actor` may be an AuthUser."""
    if action not in ACTIONS:
        raise ValueError(f"unknown audit action {action}")
    if actor is not None:
        actor_user_id = actor_user_id or getattr(actor, "id", None)
        if not actor_role:
            roles = sorted(getattr(actor, "role_set", lambda: set())())
            actor_role = ",".join(roles)
        device_id = device_id or getattr(actor, "device_id", "") or ""
        ip = ip or getattr(actor, "ip", "") or ""
    changes = normalize(mask_sensitive(changes if changes is not None else {}))
    at = datetime.now(timezone.utc)
    await conn.execute("select pg_advisory_xact_lock($1)", _lock_key(org_id))
    prev = await conn.fetchval("select hash from audit_log where org_id is not distinct from $1 order by id desc limit 1", org_id)
    prev_hash = prev or ""
    h = compute_hash(prev_hash, canonical(at, org_id, actor_user_id, action, record_type, str(record_id or ""), changes, reason))
    ip_hash = hashlib.sha256(ip.encode()).hexdigest()[:32] if ip else ""
    row = await db.one(
        """insert into audit_log (at, org_id, actor_user_id, actor_role, site_id, device_id, ip_hash, action, record_type, record_id, changes, reason, prev_hash, hash)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id""",
        [at, org_id, actor_user_id, actor_role[:200], site_id, (device_id or "")[:100], ip_hash, action, record_type, str(record_id or ""),
         changes, reason or "", prev_hash, h],
        conn,
    )
    return row["id"]


async def verify_chain(org_id: str | None, conn=None) -> dict:
    """Walk the organisation's chain and report the first row whose hash does not match."""
    rows = await db.q(
        "select id, at, org_id, actor_user_id, action, record_type, record_id, changes, reason, prev_hash, hash from audit_log where org_id is not distinct from $1 order by id",
        [org_id],
        conn,
    )
    prev = ""
    first_bad = None
    for r in rows:
        canon = canonical(r["at"], r["org_id"], r["actor_user_id"], r["action"], r["record_type"], r["record_id"], r["changes"], r["reason"])
        if r["prev_hash"] != prev or compute_hash(prev, canon) != r["hash"]:
            first_bad = r["id"]
            break
        prev = r["hash"]
    return {"ok": first_bad is None, "rows": len(rows), "firstBadId": first_bad, "checkedAt": datetime.now(timezone.utc)}
