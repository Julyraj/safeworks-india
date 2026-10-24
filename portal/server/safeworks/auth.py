"""Sessions (bearer tokens) and the `require_user` dependency."""
from __future__ import annotations

import time
from typing import Callable

from fastapi import Request

from . import db
from .config import config
from .errors import HttpError, forbidden, unauthorized
from .rbac import AuthUser, Membership, can_use_admin_console
from .security import new_token, sha256

# A short in-process cache so each request does not hit the sessions table.
# Logout, password reset and deactivation clear it at once in this process; with several
# server processes, the others see the change within CACHE_SECONDS.
CACHE_SECONDS = 10
LAST_SEEN_SECONDS = 300
_cache: dict[str, tuple[AuthUser, float, float]] = {}  # token hash → (user, expires_at, cached_at)
_last_seen: dict[str, float] = {}


def token_from(request: Request) -> str | None:
    h = request.headers.get("authorization", "")
    if h.startswith("Bearer "):
        return h[7:].strip() or None
    return None


async def load_memberships(user_id: str, conn=None) -> list[Membership]:
    rows = await db.q(
        """select m.site_id, m.role::text as role from memberships m left join sites s on s.id = m.site_id
            where m.user_id = $1 and (m.site_id is null or s.active)""",
        [user_id],
        conn,
    )
    return [Membership(r["site_id"], r["role"]) for r in rows]


async def _lookup(token_hash: str) -> AuthUser | None:
    now = time.time()
    hit = _cache.get(token_hash)
    if hit and now - hit[2] < CACHE_SECONDS and hit[1] > now:
        return hit[0]
    row = await db.one(
        """select s.id as session_id, s.kind, s.expires_at, s.last_seen_at,
                  u.id, u.org_id, u.employee_id, u.name, u.designation, u.email, u.must_change_password
             from sessions s join users u on u.id = s.user_id
            where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and u.active""",
        [token_hash],
    )
    if not row:
        _cache.pop(token_hash, None)
        return None
    user = AuthUser(
        id=row["id"], org_id=row["org_id"], employee_id=row["employee_id"], name=row["name"], designation=row["designation"],
        email=row["email"], must_change_password=row["must_change_password"], memberships=await load_memberships(row["id"]),
        session_id=row["session_id"], kind=row["kind"],
    )
    _cache[token_hash] = (user, row["expires_at"].timestamp(), now)
    if len(_cache) > 50_000:
        for k in list(_cache.keys())[:10_000]:
            _cache.pop(k, None)
    seen = _last_seen.get(row["session_id"], row["last_seen_at"].timestamp())
    if now - seen > LAST_SEEN_SECONDS:
        _last_seen[row["session_id"]] = now
        await db.execute("update sessions set last_seen_at = now() where id = $1", [row["session_id"]])
    return user


async def create_session(user_id: str, kind: str, ip: str, ua: str, conn=None) -> dict:
    token = new_token()
    hours = config.session_hours_admin if kind == "admin" else config.session_hours_portal
    row = await db.one(
        """insert into sessions (user_id, token_hash, kind, expires_at, ip, user_agent)
           values ($1, $2, $3, now() + make_interval(hours => $4), $5, $6) returning expires_at""",
        [user_id, sha256(token), kind, hours, ip, ua[:300]],
        conn,
    )
    return {"token": token, "expiresAt": row["expires_at"]}


def forget_user_in_cache(user_id: str) -> None:
    for k, v in list(_cache.items()):
        if v[0].id == user_id:
            _cache.pop(k, None)


def forget_token(token: str) -> None:
    _cache.pop(sha256(token), None)


async def revoke_user_sessions(user_id: str, except_session_id: str | None, conn=None) -> None:
    await db.execute(
        "update sessions set revoked_at = now() where user_id = $1 and revoked_at is null and ($2::uuid is null or id <> $2::uuid)",
        [user_id, except_session_id],
        conn,
    )
    forget_user_in_cache(user_id)


def require_user(kind: str = "any", allow_must_change: bool = False) -> Callable:
    """Dependency: a signed-in user.
    kind "admin": only admin-console sessions of users with an admin/viewer role.
    allow_must_change: lets a user who must change their password reach this route."""

    async def dep(request: Request) -> AuthUser:
        token = token_from(request)
        if not token:
            raise unauthorized()
        u = await _lookup(sha256(token))
        if not u:
            raise unauthorized("Your session has ended. Please sign in again.")
        if kind == "admin" and (u.kind != "admin" or not can_use_admin_console(u.memberships)):
            raise forbidden("Admin console access only.")
        if kind == "portal" and u.kind != "portal":
            raise forbidden("Use the SafeWorks portal or app for this.")
        if u.must_change_password and not allow_must_change:
            raise HttpError(403, "Please set a new password before continuing.", "must_change_password")
        request.state.user = u
        return u

    return dep
