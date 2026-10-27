"""Helpers shared by the observation, action and inspection workflows."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from .. import db
from ..errors import bad_request, conflict, not_found
from ..i18n import pick, t
from ..rbac import AuthUser

BAND_ORDER = ["low", "moderate", "high", "extreme"]


class DuplicateRecord(Exception):
    """A create with a client_uuid that already exists: the caller returns the existing record (sync: `duplicate`)."""

    def __init__(self, record_id: str, case_no: str, record_type: str):
        super().__init__("duplicate")
        self.record_id = record_id
        self.case_no = case_no
        self.record_type = record_type


def now() -> datetime:
    return datetime.now(timezone.utc)


def fmt_dt(d: datetime | None, lang: str = "en") -> str:
    if not d:
        return ""
    return d.astimezone(db.TZ).strftime("%d %b %Y, %H:%M")


def fmt_date(d: datetime | None) -> str:
    return d.astimezone(db.TZ).strftime("%d %b %Y") if d else ""


def new_uuid() -> str:
    return str(uuid.uuid4())


async def get_site(conn, site_id: str) -> dict:
    s = await db.one("select * from sites where id = $1 and deleted_at is null", [site_id], conn)
    if not s:
        raise not_found()
    return s


async def user_name(conn, user_id: str | None) -> str:
    if not user_id:
        return ""
    return await db._db(conn).fetchval(
        "select coalesce(nullif(p.full_name, ''), nullif(u.employee_code, ''), u.email) from users u left join people p on p.id = u.person_id where u.id = $1", user_id
    ) or ""


async def user_has_site(conn, user_id: str, site_id: str) -> bool:
    """The user holds any role at the site (or an all-sites role) and is active."""
    return bool(await db._db(conn).fetchval(
        """select 1 from users u join user_site_roles r on r.user_id = u.id
            where u.id = $1 and u.status = 'active' and (r.site_id = $2 or r.site_id is null) and (r.expires_at is null or r.expires_at > now()) limit 1""",
        user_id, site_id,
    ))


async def user_roles_at(conn, user_id: str, site_id: str) -> set[str]:
    rows = await db.q(
        "select role::text as role from user_site_roles where user_id = $1 and (site_id = $2 or site_id is null) and (expires_at is null or expires_at > now())",
        [user_id, site_id], conn,
    )
    return {r["role"] for r in rows}


# ---------- risk matrix ----------

async def active_matrix(conn, org_id: str, site: dict) -> dict:
    v = None
    if site.get("risk_matrix_version_id"):
        v = await db.one("select v.*, m.size, m.name from risk_matrix_versions v join risk_matrices m on m.id = v.matrix_id where v.id = $1", [site["risk_matrix_version_id"]], conn)
    if not v:
        v = await db.one(
            """select v.*, m.size, m.name from risk_matrix_versions v join risk_matrices m on m.id = v.matrix_id
                where m.org_id = $1 and v.status = 'active' order by v.effective_from desc nulls last, v.version desc limit 1""",
            [org_id], conn,
        )
    if not v:
        raise bad_request("The site has no active risk matrix.", key="err.matrix_missing")
    return v


def band_for(matrix: dict, likelihood: int, severity: int) -> tuple[int, str]:
    size = int(matrix["size"])
    if not (1 <= likelihood <= size and 1 <= severity <= size):
        raise bad_request(f"Likelihood and severity must be between 1 and {size}.", key="err.rating_out_of_range", size=size)
    score = likelihood * severity
    for b in matrix["bands"] or []:
        if int(b["min"]) <= score <= int(b["max"]):
            return score, b["band"]
    # gaps in a matrix (e.g. 7, 11) fall into the nearest lower band
    best = None
    for b in matrix["bands"] or []:
        if int(b["min"]) <= score and (best is None or int(b["min"]) > int(best["min"])):
            best = b
    return score, (best["band"] if best else "low")


# ---------- due dates ----------

async def due_rule(conn, org_id: str, site_id: str, band: str) -> dict:
    r = await db.one(
        """select * from due_date_rules where org_id = $1 and band = $3 and (site_id = $2 or site_id is null)
            order by site_id nulls last limit 1""",
        [org_id, site_id, band], conn,
    )
    if not r:
        raise bad_request(f"No due-date rule for band {band}.", key="err.due_rule_missing", band=band)
    return r


def add_working_days(start: datetime, days: int, weekly_off: list[int]) -> datetime:
    """Adds `days` working days (weekly_off uses JavaScript's day numbering: 0 = Sunday)."""
    d = start.astimezone(db.TZ)
    off = set(int(x) for x in (weekly_off or [0]))
    added = 0
    while added < days:
        d += timedelta(days=1)
        js_dow = (d.weekday() + 1) % 7
        if js_dow not in off:
            added += 1
    return d.astimezone(timezone.utc)


def compute_due(rule: dict, start: datetime, site: dict) -> datetime:
    amount = int(rule["due_amount"])
    unit = rule["due_unit"]
    if unit == "hours":
        return start + timedelta(hours=amount)
    if unit == "days":
        return start + timedelta(days=amount)
    cal = site.get("working_calendar") or {}
    return add_working_days(start, amount, cal.get("weeklyOff", [0]))


# ---------- record bookkeeping ----------

async def touch(conn, table: str, record_id: str) -> int:
    """Bump version and updated_at; returns the new version."""
    return await db._db(conn).fetchval(f"update {table} set version = version + 1, updated_at = now() where id = $1 returning version", record_id)


def ensure_status(record: dict, allowed: tuple[str, ...], *, as_conflict: bool = True) -> None:
    """Transitions re-checked against the current state: a wrong state is a 409 (sync turns it into a comment)."""
    if record["status"] not in allowed:
        if as_conflict:
            raise conflict(f"This cannot be done while the record is {record['status']}.", key="err.wrong_status", status=record["status"])
        raise bad_request(f"This cannot be done while the record is {record['status']}.", key="err.wrong_status", status=record["status"])


def label(key: str, lang: str, org_id: str | None = None, **params: Any) -> str:
    return t(key, lang, org_id, **params)


def site_label(site: dict, lang: str = "en") -> str:
    return pick(site.get("name_i18n"), lang) or site.get("code", "")


def area_suffix(area_name: Any, lang: str = "en") -> str:
    a = pick(area_name, lang) if area_name else ""
    return f" / {a}" if a else ""


def actor_id(actor: AuthUser | None) -> str | None:
    return actor.id if actor else None


def device_of(actor: AuthUser | None) -> str:
    return (actor.device_id if actor else "") or ""
