"""TOTP multi-factor authentication (pyotp). Secrets are encrypted at rest with the field key.

`users.mfa_secret_enc` holds the (pending or confirmed) secret; `users.mfa_enabled` says whether enrolment was confirmed.
Wrong-code attempts are counted in memory per user: 5 tries, then a 15-minute lock (API.md).
"""
from __future__ import annotations

import time

import pyotp

from . import db
from .crypto import decrypt, encrypt
from .errors import HttpError

MAX_TRIES = 5
LOCK_SECONDS = 15 * 60
_tries: dict[str, tuple[int, float]] = {}  # user id → (count, first failure time or lock start)


def roles_need_mfa(roles: set[str], settings: dict) -> bool:
    return bool(roles & set(settings.get("mfaRequiredRoles") or []))


async def begin_enrol(conn, user_id: str, label: str, issuer: str) -> dict:
    """New pending secret (replaces an unconfirmed one). Returns {secret, otpauthUrl}."""
    secret = pyotp.random_base32()
    await db.execute("update users set mfa_secret_enc = $2, mfa_enabled = false, updated_at = now() where id = $1", [user_id, encrypt(secret)], conn)
    url = pyotp.TOTP(secret).provisioning_uri(name=label or user_id, issuer_name=issuer or "SafeWorks")
    return {"secret": secret, "otpauthUrl": url}


def _check_lock(user_id: str) -> None:
    hit = _tries.get(user_id)
    if hit and hit[0] >= MAX_TRIES:
        if time.time() - hit[1] < LOCK_SECONDS:
            minutes = int((LOCK_SECONDS - (time.time() - hit[1])) // 60) + 1
            raise HttpError(403, f"Too many wrong codes. Try again in {minutes} minutes.", "mfa_locked", key="err.mfa_locked", params={"minutes": minutes})
        _tries.pop(user_id, None)


def _record_failure(user_id: str) -> None:
    count, since = _tries.get(user_id, (0, time.time()))
    if time.time() - since > LOCK_SECONDS:
        count, since = 0, time.time()
    count += 1
    _tries[user_id] = (count, since if count < MAX_TRIES else time.time())


def verify_code(user_id: str, secret_enc: str, code: str) -> bool:
    _check_lock(user_id)
    code = "".join(ch for ch in (code or "") if ch.isdigit())
    ok = False
    if secret_enc and len(code) == 6:
        try:
            ok = pyotp.TOTP(decrypt(secret_enc)).verify(code, valid_window=1)
        except Exception:
            ok = False
    if ok:
        _tries.pop(user_id, None)
    else:
        _record_failure(user_id)
    return ok


async def confirm_enrol(conn, user_id: str, secret_enc: str, code: str) -> bool:
    if not verify_code(user_id, secret_enc, code):
        return False
    await db.execute("update users set mfa_enabled = true, updated_at = now() where id = $1", [user_id], conn)
    return True


async def reset(conn, user_id: str) -> None:
    await db.execute("update users set mfa_enabled = false, mfa_secret_enc = '', updated_at = now() where id = $1", [user_id], conn)
    _tries.pop(user_id, None)
