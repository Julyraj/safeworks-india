"""Sign in, sign out, who am I, change password."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request

from .. import db
from ..audit import audit
from ..auth import create_session, forget_token, load_memberships, require_user, revoke_user_sessions, token_from
from ..config import config
from ..errors import HttpError, bad_request, forbidden, unauthorized
from ..http import JSON, client_ip, json_body
from ..ratelimit import login_limiter
from ..rbac import ROLE_LABEL, AuthUser, can_use_admin_console
from ..security import dummy_verify, hash_password, password_problem, verify_password
from ..validation import In, Str, parse

router = APIRouter()


class LoginIn(In):
    employee_id: Str(64) = ""
    password: str = ""
    app: str = "portal"


class ChangeIn(In):
    current_password: str
    new_password: str


GENERIC = "Employee ID or password is incorrect."


async def me_payload(user_id: str) -> dict:
    u = await db.one(
        """select u.id, u.org_id, u.employee_id, u.name, u.designation, u.phone, u.email, u.must_change_password, o.name as org_name
             from users u join organisations o on o.id = u.org_id where u.id = $1""",
        [user_id],
    )
    memberships = await load_memberships(user_id)
    sites = {s["id"]: s for s in await db.q("select id, code, name from sites where org_id = $1", [u["org_id"]])}
    unread = await db.one("select count(*)::int as n from notifications where user_id = $1 and read_at is null", [user_id])
    return {
        "id": u["id"], "employeeId": u["employee_id"], "name": u["name"], "designation": u["designation"], "phone": u["phone"],
        "email": u["email"], "mustChangePassword": u["must_change_password"], "company": u["org_name"],
        "roles": [
            {"role": m.role, "roleLabel": ROLE_LABEL.get(m.role, m.role), "siteId": m.site_id,
             "siteCode": sites.get(m.site_id, {}).get("code") if m.site_id else None,
             "siteName": sites.get(m.site_id, {}).get("name") if m.site_id else "All sites"}
            for m in memberships
        ],
        "unreadNotifications": unread["n"] if unread else 0,
    }


@router.post("/api/auth/login")
async def login(request: Request):
    body = await json_body(request)
    inp = parse(LoginIn, body)
    if not inp.employee_id:
        raise bad_request("employeeId: Enter your employee ID.")
    if not inp.password:
        raise bad_request("password: Enter your password.")
    if len(inp.password) > 200:
        raise bad_request("password: too long")
    app_kind = "admin" if inp.app == "admin" else "portal"
    ip = client_ip(request)
    login_limiter.check(f"login:{ip}:{inp.employee_id.lower()}", 20)
    ua = request.headers.get("user-agent", "")
    user = await db.one(
        """select id, org_id, password_hash, active, failed_attempts, locked_until, must_change_password
             from users where lower(employee_id) = lower($1) order by active desc limit 1""",
        [inp.employee_id],
    )
    if not user or not user["active"]:
        await dummy_verify(inp.password)
        await audit("login.failed", org_id=user["org_id"] if user else None, actor_id=user["id"] if user else None, entity="user",
                    entity_id=inp.employee_id, ip=ip, details={"reason": "inactive" if user else "unknown", "app": app_kind})
        raise unauthorized(GENERIC)
    if user["locked_until"] and user["locked_until"] > datetime.now(timezone.utc):
        await dummy_verify(inp.password)
        until = user["locked_until"].astimezone(db.TZ).strftime("%I:%M %p")
        raise HttpError(423, f"This account is locked after too many wrong passwords. Try again after {until}, or ask your admin to unlock it.", "locked")
    if not await verify_password(inp.password, user["password_hash"]):
        fails = user["failed_attempts"] + 1
        lock = fails >= config.max_failed_logins
        await db.execute(
            "update users set failed_attempts = $2, locked_until = case when $3 then now() + make_interval(mins => $4) else locked_until end where id = $1",
            [user["id"], 0 if lock else fails, lock, config.lock_minutes],
        )
        await audit("login.locked" if lock else "login.failed", org_id=user["org_id"], actor_id=user["id"], entity="user", entity_id=user["id"], ip=ip,
                    details={"attempt": fails, "app": app_kind})
        if lock:
            raise HttpError(423, f"Too many wrong passwords. The account is locked for {config.lock_minutes} minutes, or ask your admin to unlock it.", "locked")
        raise unauthorized(GENERIC)
    memberships = await load_memberships(user["id"])
    if app_kind == "admin" and not can_use_admin_console(memberships):
        await audit("login.denied_admin", org_id=user["org_id"], actor_id=user["id"], entity="user", entity_id=user["id"], ip=ip)
        raise forbidden("This login does not have admin console access.")
    if not memberships:
        raise forbidden("Your login has no site or role yet. Ask your admin to assign one.")
    async with db.tx() as c:
        await db.execute("update users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = $1", [user["id"]], c)
        session = await create_session(user["id"], app_kind, ip, ua, c)
    await audit("login", org_id=user["org_id"], actor_id=user["id"], entity="user", entity_id=user["id"], ip=ip, details={"app": app_kind})
    return JSON({"token": session["token"], "expiresAt": session["expiresAt"], "mustChangePassword": user["must_change_password"], "user": await me_payload(user["id"])})


@router.post("/api/auth/logout")
async def logout(request: Request, u: AuthUser = Depends(require_user("any", allow_must_change=True))):
    await db.execute("update sessions set revoked_at = now() where id = $1", [u.session_id])
    t = token_from(request)
    if t:
        forget_token(t)
    return JSON({"ok": True})


@router.get("/api/me")
async def me(u: AuthUser = Depends(require_user("any", allow_must_change=True))):
    return JSON(await me_payload(u.id))


@router.post("/api/auth/change-password")
async def change_password(request: Request, u: AuthUser = Depends(require_user("any", allow_must_change=True))):
    inp = parse(ChangeIn, await json_body(request))
    row = await db.one("select password_hash from users where id = $1", [u.id])
    if not row or not await verify_password(inp.current_password, row["password_hash"]):
        raise bad_request("Current password is incorrect.")
    problem = password_problem(inp.new_password)
    if problem:
        raise bad_request(problem)
    if inp.new_password == inp.current_password:
        raise bad_request("Choose a password different from the current one.")
    h = await hash_password(inp.new_password)
    await db.execute("update users set password_hash = $2, must_change_password = false, password_changed_at = now() where id = $1", [u.id, h])
    await revoke_user_sessions(u.id, u.session_id)
    await audit("password.changed", org_id=u.org_id, actor_id=u.id, entity="user", entity_id=u.id, ip=client_ip(request))
    return JSON({"ok": True})
