"""Sessions (bearer tokens) and the `require_user` dependency.

Session kinds: `field` (app/PWA) and `admin` (console). A pre-auth session (`mfa_passed = false`) is issued
when the user's roles need MFA; it is valid 10 minutes and only for /auth/mfa*.
"""
from __future__ import annotations

import time
from typing import Callable

from fastapi import Request

from . import db
from .config import config
from .errors import HttpError, forbidden, unauthorized
from .i18n import from_accept_language
from .rbac import AuthUser, SiteRole
from .security import new_token, sha256

# A short in-process cache so each request does not hit the sessions table.
CACHE_SECONDS = 10
LAST_SEEN_SECONDS = 300
_cache: dict[str, tuple[AuthUser, float, float]] = {}  # token hash → (user, expires_at, cached_at)
_last_seen: dict[str, float] = {}


def token_from(request: Request) -> str | None:
    h = request.headers.get("authorization", "")
    if h.startswith("Bearer "):
        return h[7:].strip() or None
    return None


def request_lang(request: Request, user: AuthUser | None = None) -> str:
    if user and user.language:
        return user.language
    return from_accept_language(request.headers.get("accept-language"))


async def load_roles(user_id: str, conn=None) -> list[SiteRole]:
    rows = await db.q(
        """select r.site_id, r.role::text as role, r.medical_data, r.expires_at
             from user_site_roles r left join sites s on s.id = r.site_id
            where r.user_id = $1 and (r.site_id is null or (s.active and s.deleted_at is null))
              and (r.expires_at is null or r.expires_at > now())
            order by r.granted_at""",
        [user_id],
        conn,
    )
    return [SiteRole(r["site_id"], r["role"], r["medical_data"], r["expires_at"]) for r in rows]


async def active_site_ids(org_id: str, conn=None) -> list[str]:
    rows = await db.q("select id from sites where org_id = $1 and active and deleted_at is null order by code", [org_id], conn)
    return [r["id"] for r in rows]


async def build_user(row: dict, conn=None) -> AuthUser:
    return AuthUser(
        id=row["id"], org_id=row["org_id"], name=row["name"], employee_code=row["employee_code"], email=row["email"],
        language=row["language"], login_type=row["login_type"], must_change_password=row["must_change_password"],
        mfa_enabled=row["mfa_enabled"], employer_id=row.get("employer_id"), roles=await load_roles(row["id"], conn),
        all_site_ids=await active_site_ids(row["org_id"], conn),
        session_id=row.get("session_id", ""), kind=row.get("kind", "field"), mfa_passed=bool(row.get("mfa_passed", True)),
        device_id=row.get("device_id") or "",
    )


USER_SQL = """select u.id, u.org_id, coalesce(nullif(p.full_name, ''), nullif(u.employee_code, ''), u.email) as name, u.employee_code, u.email,
                     u.language, u.login_type, u.must_change_password, u.mfa_enabled, u.status, u.expires_at, u.password_hash,
                     u.failed_attempts, u.locked_until, u.mfa_secret_enc, u.person_id, p.employer_id
                from users u left join people p on p.id = u.person_id"""


async def _lookup(token_hash: str) -> AuthUser | None:
    now = time.time()
    hit = _cache.get(token_hash)
    if hit and now - hit[2] < CACHE_SECONDS and hit[1] > now:
        return hit[0]
    row = await db.one(
        """select s.id as session_id, s.kind, s.mfa_passed, s.device_id::text as device_id, s.expires_at, s.last_seen_at,
                  u.id, u.org_id, coalesce(nullif(p.full_name, ''), nullif(u.employee_code, ''), u.email) as name, u.employee_code, u.email,
                  u.language, u.login_type, u.must_change_password, u.mfa_enabled, p.employer_id
             from sessions s join users u on u.id = s.user_id left join people p on p.id = u.person_id
            where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and u.status = 'active'
              and (u.expires_at is null or u.expires_at > now())""",
        [token_hash],
    )
    if not row:
        _cache.pop(token_hash, None)
        return None
    user = await build_user(row)
    _cache[token_hash] = (user, row["expires_at"].timestamp(), now)
    if len(_cache) > 50_000:
        for k in list(_cache.keys())[:10_000]:
            _cache.pop(k, None)
    seen = _last_seen.get(row["session_id"], row["last_seen_at"].timestamp())
    if now - seen > LAST_SEEN_SECONDS:
        _last_seen[row["session_id"]] = now
        await db.execute("update sessions set last_seen_at = now() where id = $1", [row["session_id"]])
    return user


async def create_session(user_id: str, kind: str, ip: str, ua: str, *, mfa_passed: bool = True, device_id: str | None = None, conn=None) -> dict:
    token = new_token()
    if not mfa_passed:
        minutes = config.preauth_minutes
    else:
        minutes = (config.session_hours_admin if kind == "admin" else config.session_hours_field) * 60
    row = await db.one(
        """insert into sessions (user_id, token_hash, kind, mfa_passed, device_id, expires_at, ip, user_agent)
           values ($1, $2, $3, $4, $5, now() + make_interval(mins => $6), $7, $8) returning id, expires_at""",
        [user_id, sha256(token), kind, mfa_passed, device_id, minutes, ip, ua[:300]],
        conn,
    )
    return {"token": token, "expiresAt": row["expires_at"], "sessionId": row["id"]}


async def promote_session(session_id: str, kind: str, conn=None) -> dict:
    """A pre-auth session passed MFA: mark it and extend it to a full session."""
    minutes = (config.session_hours_admin if kind == "admin" else config.session_hours_field) * 60
    row = await db.one(
        "update sessions set mfa_passed = true, expires_at = now() + make_interval(mins => $2) where id = $1 returning expires_at",
        [session_id, minutes],
        conn,
    )
    _cache.clear()
    return {"expiresAt": row["expires_at"]}


def forget_user_in_cache(user_id: str) -> None:
    for k, v in list(_cache.items()):
        if v[0].id == user_id:
            _cache.pop(k, None)


def forget_token(token: str) -> None:
    _cache.pop(sha256(token), None)


def forget_all() -> None:
    _cache.clear()


async def revoke_user_sessions(user_id: str, except_session_id: str | None, conn=None) -> None:
    await db.execute(
        "update sessions set revoked_at = now() where user_id = $1 and revoked_at is null and ($2::uuid is null or id <> $2::uuid)",
        [user_id, except_session_id],
        conn,
    )
    forget_user_in_cache(user_id)


def require_user(kind: str = "any", allow_must_change: bool = False, allow_preauth: bool = False) -> Callable:
    """Dependency: a signed-in user.
    kind "admin": only admin-console sessions of users with a console role.
    allow_must_change: lets a user who must change their password reach this route.
    allow_preauth: lets a pre-auth (MFA pending) session reach this route (the /auth/mfa* routes)."""

    async def dep(request: Request) -> AuthUser:
        token = token_from(request)
        if not token:
            raise unauthorized()
        u = await _lookup(sha256(token))
        if not u:
            raise unauthorized("Your session has ended. Please sign in again.", key="err.session_ended")
        if not u.mfa_passed and not allow_preauth:
            raise HttpError(403, "Please enter your authenticator code to continue.", "mfa_required", key="err.mfa_required")
        if kind == "admin" and (u.kind != "admin" or not u.can_use_admin_console):
            raise forbidden("Admin console access only.", key="err.admin_console_only")
        if kind == "field" and u.kind != "field":
            raise forbidden("Use the SafeWorks app for this.", key="err.field_only")
        if u.must_change_password and not allow_must_change:
            raise HttpError(403, "Please set a new password before continuing.", "must_change_password", key="err.must_change_password")
        u.ip = request.client.host if request.client else ""
        request.state.user = u
        request.state.lang = u.language or request_lang(request)
        return u

    return dep
