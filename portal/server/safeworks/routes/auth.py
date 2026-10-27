"""Sign in (password, MFA, enrolment code), sign out, change password."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request

from .. import db, mfa
from ..audit import audit
from ..auth import USER_SQL, build_user, create_session, forget_token, forget_user_in_cache, promote_session, require_user, revoke_user_sessions, token_from
from ..config import config
from ..errors import HttpError, forbidden, unauthorized
from ..http import JSON, client_ip, json_body
from ..profile import me_payload
from ..ratelimit import login_limiter
from ..rbac import AuthUser
from ..schemas import EnrolRequest, LoginRequest, MfaCode, PasswordChange, parse
from ..security import dummy_verify, hash_password, password_problem, sha256, verify_password
from ..settings import org_settings

router = APIRouter(prefix="/api/v1/auth")


async def _register_device(conn, user_id: str, device_uuid: str | None, platform: str | None, app_version: str | None) -> str | None:
    if not device_uuid:
        return None
    row = await db.one(
        """insert into devices (user_id, device_uuid, platform, app_version) values ($1, $2, $3, $4)
           on conflict (device_uuid) do update set user_id = excluded.user_id, platform = coalesce(nullif(excluded.platform, ''), devices.platform),
               app_version = coalesce(nullif(excluded.app_version, ''), devices.app_version), last_seen_at = now(), revoked_at = null
           returning id""",
        [user_id, device_uuid[:200], platform or "", app_version or ""], conn,
    )
    return row["id"]


async def _login_response(conn, user: AuthUser, session: dict, *, must_change: bool) -> dict:
    out = {"token": session["token"], "expiresAt": session["expiresAt"], "mustChangePassword": must_change}
    if not must_change:
        out["me"] = await me_payload(user, conn)
    return out


@router.post("/login")
async def login(request: Request):
    inp = parse(LoginRequest, await json_body(request))
    ip = client_ip(request)
    login_limiter.check(f"login:{ip}:{inp.login.lower()}", 30)
    ua = request.headers.get("user-agent", "")
    login = inp.login.strip().lower()
    row = await db.one(USER_SQL + " where lower(u.employee_code) = $1 or lower(u.email) = $1 order by (u.status = 'active') desc, u.created_at limit 1", [login])
    if not row or row["status"] != "active":
        await dummy_verify(inp.password)
        async with db.tx() as c:
            await audit(c, org_id=row["org_id"] if row else None, actor_user_id=row["id"] if row else None, action="login_failed", record_type="user", record_id=login,
                        changes={"reason": "inactive" if row else "unknown", "kind": inp.kind}, ip=ip)
        if row:
            raise forbidden("This account is not active. Contact your safety officer.", key="err.account_inactive")
        raise unauthorized("Login or password is incorrect.", key="err.login_invalid")
    if row["locked_until"] and row["locked_until"] > datetime.now(timezone.utc):
        minutes = int((row["locked_until"] - datetime.now(timezone.utc)).total_seconds() // 60) + 1
        raise HttpError(429, f"Too many failed attempts. Try again in {minutes} minutes.", "rate_limited", key="err.login_locked", params={"minutes": minutes})
    if not await verify_password(inp.password, row["password_hash"]):
        async with db.tx() as c:
            failed = await c.fetchval(
                """update users set failed_attempts = case when locked_until is not null and locked_until < now() then 1 else failed_attempts + 1 end,
                                    locked_until = case when locked_until is not null and locked_until < now() then null else locked_until end
                    where id = $1 returning failed_attempts""", row["id"])
            locked = False
            if failed >= config.max_failed_logins:
                await c.execute("update users set locked_until = now() + make_interval(mins => $2), failed_attempts = 0 where id = $1", row["id"], config.lock_minutes)
                locked = True
            await audit(c, org_id=row["org_id"], actor_user_id=row["id"], action="login_failed", record_type="user", record_id=row["id"],
                        changes={"reason": "password", "kind": inp.kind, "locked": locked}, ip=ip)
        raise unauthorized("Login or password is incorrect.", key="err.login_invalid")
    if row["expires_at"] and row["expires_at"] < datetime.now(timezone.utc):
        raise forbidden("This account has expired.", key="err.account_expired")
    async with db.tx() as c:
        device_id = await _register_device(c, row["id"], inp.device_uuid, inp.platform, inp.app_version)
        user = await build_user({**row, "kind": inp.kind}, c)
        if inp.kind == "admin" and not user.can_use_admin_console:
            raise forbidden("Admin console access only.", key="err.admin_console_only")
        settings = await org_settings(user.org_id, c)
        need_mfa = mfa.roles_need_mfa(user.role_set(), settings)
        await c.execute("update users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = $1", row["id"])
        if need_mfa:
            session = await create_session(user.id, inp.kind, ip, ua, mfa_passed=False, device_id=device_id, conn=c)
            await audit(c, org_id=user.org_id, actor=user, action="login", record_type="user", record_id=user.id, changes={"stage": "preauth", "kind": inp.kind, "mfaEnrolled": user.mfa_enabled}, ip=ip)
            return JSON({"token": session["token"], "expiresAt": session["expiresAt"], "mfaRequired": True, "mfaEnrolled": user.mfa_enabled, "mustChangePassword": user.must_change_password})
        session = await create_session(user.id, inp.kind, ip, ua, device_id=device_id, conn=c)
        user.session_id = session["sessionId"]
        user.kind = inp.kind
        await audit(c, org_id=user.org_id, actor=user, action="login", record_type="user", record_id=user.id, changes={"kind": inp.kind}, ip=ip)
        return JSON(await _login_response(c, user, session, must_change=user.must_change_password))


@router.post("/mfa/enrol")
async def mfa_enrol(request: Request, user: AuthUser = Depends(require_user(allow_preauth=True, allow_must_change=True))):
    org = await db.one("select name from organisations where id = $1", [user.org_id])
    async with db.tx() as c:
        out = await mfa.begin_enrol(c, user.id, user.email or user.employee_code, f"SafeWorks {org['name']}" if org else "SafeWorks")
    forget_user_in_cache(user.id)
    return JSON(out)


async def _finish_mfa(request: Request, user: AuthUser, action: str) -> dict:
    ip = client_ip(request)
    async with db.tx() as c:
        if not user.mfa_passed:
            session = await promote_session(user.session_id, user.kind, c)
            token = token_from(request) or ""
            sess = {"token": token, "expiresAt": session["expiresAt"]}
        else:
            sess = {"token": token_from(request) or "", "expiresAt": (await db.one("select expires_at from sessions where id = $1", [user.session_id], c))["expires_at"]}
        user.mfa_passed = True
        user.mfa_enabled = True
        await audit(c, org_id=user.org_id, actor=user, action=action, record_type="user", record_id=user.id, changes={"kind": user.kind}, ip=ip)
        return await _login_response(c, user, sess, must_change=user.must_change_password)


@router.post("/mfa/confirm")
async def mfa_confirm(request: Request, user: AuthUser = Depends(require_user(allow_preauth=True, allow_must_change=True))):
    inp = parse(MfaCode, await json_body(request))
    row = await db.one("select mfa_secret_enc, mfa_enabled from users where id = $1", [user.id])
    if not row or not row["mfa_secret_enc"]:
        raise HttpError(400, "Set up your authenticator app first.", "bad_request", key="err.mfa_not_enrolled")
    async with db.tx() as c:
        ok = await mfa.confirm_enrol(c, user.id, row["mfa_secret_enc"], inp.code)
    if not ok:
        raise HttpError(401, "That code is not correct. Try again.", "unauthorized", key="err.mfa_code_invalid")
    forget_user_in_cache(user.id)
    return JSON(await _finish_mfa(request, user, "mfa_enrol"))


@router.post("/mfa")
async def mfa_verify(request: Request, user: AuthUser = Depends(require_user(allow_preauth=True, allow_must_change=True))):
    inp = parse(MfaCode, await json_body(request))
    row = await db.one("select mfa_secret_enc, mfa_enabled from users where id = $1", [user.id])
    if not row or not row["mfa_enabled"]:
        raise HttpError(403, "Set up your authenticator app first.", "mfa_required", key="err.mfa_not_enrolled")
    if not mfa.verify_code(user.id, row["mfa_secret_enc"], inp.code):
        async with db.tx() as c:
            await audit(c, org_id=user.org_id, actor=user, action="login_failed", record_type="user", record_id=user.id, changes={"reason": "mfa"}, ip=client_ip(request))
        raise HttpError(401, "That code is not correct. Try again.", "unauthorized", key="err.mfa_code_invalid")
    return JSON(await _finish_mfa(request, user, "login"))


@router.post("/enrol")
async def enrol(request: Request):
    inp = parse(EnrolRequest, await json_body(request))
    ip = client_ip(request)
    login_limiter.check(f"enrol:{ip}", 20)
    code = inp.code.strip().upper().replace("-", "").replace(" ", "")
    row = await db.one(
        "select e.*, u.status from enrolment_codes e join users u on u.id = e.user_id where e.code_hash = $1 and e.used_at is null and e.expires_at > now()", [sha256(code)]
    )
    if not row or row["status"] != "active":
        raise HttpError(400, "This enrolment code is not valid or has expired.", "bad_request", key="err.enrol_code_invalid")
    problem = password_problem(inp.new_password, staff=False)
    if problem:
        raise HttpError(400, "Password rule not met.", "bad_request", key=problem)
    pw_hash = await hash_password(inp.new_password)
    async with db.tx() as c:
        await c.execute("update enrolment_codes set used_at = now() where id = $1", row["id"])
        await c.execute("update users set password_hash = $2, must_change_password = false, password_changed_at = now(), last_login_at = now(), failed_attempts = 0, locked_until = null where id = $1",
                        row["user_id"], pw_hash)
        urow = await db.one(USER_SQL + " where u.id = $1", [row["user_id"]], c)
        device_id = await _register_device(c, row["user_id"], inp.device_uuid, inp.platform, inp.app_version)
        user = await build_user({**urow, "kind": "field"}, c)
        session = await create_session(user.id, "field", ip, request.headers.get("user-agent", ""), device_id=device_id, conn=c)
        user.session_id = session["sessionId"]
        await audit(c, org_id=user.org_id, actor=user, action="login", record_type="user", record_id=user.id, changes={"kind": "field", "via": "enrolment_code"}, ip=ip)
        await audit(c, org_id=user.org_id, actor=user, action="password_reset", record_type="user", record_id=user.id, changes={"via": "enrolment_code"}, ip=ip)
        return JSON(await _login_response(c, user, session, must_change=False))


@router.post("/logout")
async def logout(request: Request, user: AuthUser = Depends(require_user(allow_must_change=True, allow_preauth=True))):
    token = token_from(request) or ""
    async with db.tx() as c:
        await c.execute("update sessions set revoked_at = now() where id = $1", user.session_id)
        await audit(c, org_id=user.org_id, actor=user, action="logout", record_type="user", record_id=user.id, ip=client_ip(request))
    forget_token(token)
    return JSON({"ok": True})


@router.post("/password")
async def change_password(request: Request, user: AuthUser = Depends(require_user(allow_must_change=True))):
    inp = parse(PasswordChange, await json_body(request))
    row = await db.one("select password_hash from users where id = $1", [user.id])
    if not row or not await verify_password(inp.current, row["password_hash"]):
        raise HttpError(400, "Your current password is not correct.", "bad_request", key="err.password_current_wrong")
    problem = password_problem(inp.new, staff=user.is_staff)
    if problem:
        raise HttpError(400, "Password rule not met.", "bad_request", key=problem)
    pw_hash = await hash_password(inp.new)
    async with db.tx() as c:
        await c.execute("update users set password_hash = $2, must_change_password = false, password_changed_at = now(), updated_at = now() where id = $1", user.id, pw_hash)
        await revoke_user_sessions(user.id, user.session_id, c)
        await audit(c, org_id=user.org_id, actor=user, action="password_reset", record_type="user", record_id=user.id, changes={"via": "self"}, ip=client_ip(request))
    forget_user_in_cache(user.id)
    return JSON({"ok": True})
