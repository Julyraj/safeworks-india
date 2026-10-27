"""Admin: users (roles, passwords, enrolment codes, locks, MFA, devices, import), people and contractors."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ... import db, mfa
from ...audit import audit
from ...auth import forget_user_in_cache, revoke_user_sessions
from ...crypto import encrypt
from ...errors import HttpError, bad_request, forbidden, not_found
from ...http import JSON, json_body, page_params, uuid_param
from ...notify import notify
from ...rbac import ALL_SITES_ROLES, ROLES, AuthUser
from ...schemas import ContractorIn, PersonIn, RoleGrant, RolesBody, StatusBody, UserCreate, UserUpdate, parse
from ...security import hash_password, random_code, sha256, temp_password
from ...views import contractor as contractor_view, paged, person as person_view, user_admin
from ._common import console_user, need_admin, need_write, read_csv

router = APIRouter(prefix="/api/v1/admin")

USER_SELECT = """select u.*, coalesce(nullif(p.full_name, ''), nullif(u.employee_code, ''), u.email) as name, p.employer_id, k.name as employer_name
                   from users u left join people p on p.id = u.person_id left join contractors k on k.id = p.employer_id"""


async def _roles(conn, user_id: str) -> list[dict]:
    rows = await db.q("select site_id, role::text as role, medical_data, expires_at from user_site_roles where user_id = $1 order by granted_at", [user_id], conn)
    return [{"siteId": r["site_id"], "role": r["role"], "medicalData": r["medical_data"], "expiresAt": r["expires_at"]} for r in rows]


async def _devices(conn, user_id: str) -> list[dict]:
    return await db.q("select * from devices where user_id = $1 order by last_seen_at desc", [user_id], conn)


async def _user_out(conn, user_id: str) -> dict:
    row = await db.one(USER_SELECT + " where u.id = $1", [user_id], conn)
    if not row:
        raise not_found()
    return user_admin(row, await _roles(conn, user_id), await _devices(conn, user_id))


async def _load(user_id: str, actor: AuthUser) -> dict:
    row = await db.one(USER_SELECT + " where u.id = $1 and u.org_id = $2", [user_id, actor.org_id])
    if not row:
        raise not_found()
    if not actor.is_all_sites_role:
        # officers see users who hold a role at one of their sites
        ok = await db.one("select 1 from user_site_roles where user_id = $1 and site_id = any($2::uuid[]) limit 1", [user_id, actor.sites_in_scope()])
        if not ok:
            raise not_found()
    return row


def _validate_roles(roles: list[RoleGrant]) -> None:
    for r in roles:
        if r.role not in ROLES:
            raise bad_request(f"Unknown role {r.role}")
        if r.site_id is None and r.role not in ALL_SITES_ROLES:
            raise bad_request(f"Role {r.role} cannot be granted for all sites.", key="err.invalid_role_scope", role=r.role)


async def _set_roles(conn, actor: AuthUser, user_id: str, roles: list[RoleGrant]) -> None:
    _validate_roles(roles)
    for r in roles:
        if r.site_id and not await db.one("select 1 from sites where id = $1 and org_id = $2", [r.site_id, actor.org_id], conn):
            raise not_found()
    before = await _roles(conn, user_id)
    await conn.execute("delete from user_site_roles where user_id = $1", user_id)
    for r in roles:
        await conn.execute(
            "insert into user_site_roles (user_id, site_id, role, medical_data, granted_by, expires_at) values ($1, $2, $3::role_t, $4, $5, $6) on conflict do nothing",
            user_id, r.site_id, r.role, r.medical_data, actor.id, r.expires_at,
        )
    await audit(conn, org_id=actor.org_id, actor=actor, action="permission_change", record_type="user", record_id=user_id,
                changes={"roles": [before, [x.model_dump(by_alias=True) for x in roles]]})
    forget_user_in_cache(user_id)


# ---------- users ----------

@router.get("/users")
async def list_users(request: Request, user: AuthUser = Depends(console_user)):
    q = request.query_params
    page, size = page_params(request, 50, 500)
    params: list = [user.org_id]
    where = ["u.org_id = $1"]
    if not user.is_all_sites_role:
        params.append(user.sites_in_scope())
        where.append(f"u.id in (select user_id from user_site_roles where site_id = any(${len(params)}::uuid[]))")
    if q.get("siteId"):
        params.append(uuid_param(q["siteId"]))
        where.append(f"u.id in (select user_id from user_site_roles where site_id = ${len(params)} or site_id is null)")
    if q.get("role"):
        params.append(q["role"])
        where.append(f"u.id in (select user_id from user_site_roles where role::text = ${len(params)})")
    if q.get("status"):
        params.append(q["status"])
        where.append(f"u.status = ${len(params)}")
    if q.get("q"):
        params.append(f"%{q['q'].strip()}%")
        where.append(f"(u.employee_code ilike ${len(params)} or u.email ilike ${len(params)} or p.full_name ilike ${len(params)})")
    total = await db.one(f"select count(*)::int as n from users u left join people p on p.id = u.person_id where {' and '.join(where)}", params)
    rows = await db.q(USER_SELECT + f" where {' and '.join(where)} order by u.employee_code, u.email limit {size} offset {(page - 1) * size}", params)
    items = []
    for r in rows:
        items.append(user_admin(r, await _roles(None, r["id"]), await _devices(None, r["id"])))
    return JSON(paged(items, total["n"], page, size))


@router.post("/users")
async def create_user(request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    inp = parse(UserCreate, await json_body(request))
    if inp.login_type == "email" and not inp.email:
        raise bad_request("email: required for email login")
    if inp.login_type == "employee_code" and not inp.employee_code:
        raise bad_request("employeeCode: required")
    if inp.employee_code and await db.one("select 1 from users where org_id = $1 and lower(employee_code) = lower($2)", [user.org_id, inp.employee_code]):
        raise HttpError(409, "This code is already in use.", "conflict", key="err.duplicate_code")
    if inp.email and await db.one("select 1 from users where lower(email) = lower($1)", [inp.email]):
        raise HttpError(409, "This email is already in use.", "conflict", key="err.duplicate_code")
    _validate_roles(inp.roles)
    temp = temp_password()
    pw_hash = await hash_password(temp)
    async with db.tx() as c:
        person = await db.one(
            "insert into people (org_id, full_name, employer_id, phone_enc, phone_last4, preferred_language, trade, worker_type) values ($1,$2,$3,$4,$5,$6,$7,'employee') returning id",
            [user.org_id, inp.name, inp.employer_id, encrypt(inp.phone) if inp.phone else "", inp.phone[-4:] if inp.phone else "", inp.language, inp.trade], c,
        )
        row = await db.one(
            """insert into users (org_id, person_id, login_type, employee_code, email, password_hash, must_change_password, language, expires_at, created_by)
               values ($1,$2,$3,$4,$5,$6,true,$7,$8,$9) returning id""",
            [user.org_id, person["id"], inp.login_type, inp.employee_code or "", inp.email or "", pw_hash, inp.language, inp.expires_at, user.id], c,
        )
        await audit(c, org_id=user.org_id, actor=user, action="create", record_type="user", record_id=row["id"],
                    changes={"name": inp.name, "employeeCode": inp.employee_code, "email": inp.email, "loginType": inp.login_type, "phone": inp.phone})
        await _set_roles(c, user, row["id"], inp.roles)
        out = await _user_out(c, row["id"])
    out["tempPassword"] = temp if inp.login_type != "enrolment_code" else None
    return JSON(out, status_code=201)


@router.get("/users/{user_id}")
async def get_user(user_id: str, user: AuthUser = Depends(console_user)):
    row = await _load(uuid_param(user_id), user)
    return JSON(user_admin(row, await _roles(None, row["id"]), await _devices(None, row["id"])))


@router.put("/users/{user_id}")
async def update_user(user_id: str, request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    row = await _load(uuid_param(user_id), user)
    inp = parse(UserUpdate, await json_body(request))
    async with db.tx() as c:
        if row["person_id"]:
            await c.execute(
                """update people set full_name = coalesce($2, full_name), employer_id = coalesce($3, employer_id), trade = coalesce($4, trade),
                                     phone_enc = coalesce($5, phone_enc), phone_last4 = coalesce($6, phone_last4), preferred_language = coalesce($7, preferred_language),
                                     version = version + 1, updated_at = now() where id = $1""",
                row["person_id"], inp.name, inp.employer_id, inp.trade, encrypt(inp.phone) if inp.phone else ("" if inp.phone == "" else None),
                (inp.phone[-4:] if inp.phone else ("" if inp.phone == "" else None)), inp.language,
            )
        await c.execute(
            """update users set email = coalesce($2, email), employee_code = coalesce($3, employee_code), language = coalesce($4, language), expires_at = coalesce($5, expires_at),
                                login_type = coalesce($6, login_type), updated_at = now() where id = $1""",
            row["id"], inp.email.lower() if inp.email else None, inp.employee_code, inp.language, inp.expires_at, inp.login_type,
        )
        await audit(c, org_id=user.org_id, actor=user, action="update", record_type="user", record_id=row["id"], changes={k: v for k, v in inp.model_dump(by_alias=True).items() if v is not None})
        out = await _user_out(c, row["id"])
    forget_user_in_cache(row["id"])
    return JSON(out)


@router.post("/users/{user_id}/roles")
async def set_roles(user_id: str, request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    row = await _load(uuid_param(user_id), user)
    inp = parse(RolesBody, await json_body(request))
    async with db.tx() as c:
        await _set_roles(c, user, row["id"], inp.roles)
        out = await _user_out(c, row["id"])
    return JSON(out)


@router.post("/users/{user_id}/reset-password")
async def reset_password(user_id: str, user: AuthUser = Depends(console_user)):
    need_admin(user)
    row = await _load(uuid_param(user_id), user)
    temp = temp_password()
    pw_hash = await hash_password(temp)
    async with db.tx() as c:
        await c.execute("update users set password_hash = $2, must_change_password = true, failed_attempts = 0, locked_until = null, updated_at = now() where id = $1", row["id"], pw_hash)
        await revoke_user_sessions(row["id"], None, c)
        await audit(c, org_id=user.org_id, actor=user, action="password_reset", record_type="user", record_id=row["id"], changes={"via": "admin"})
    return JSON({"tempPassword": temp})


@router.post("/users/{user_id}/enrolment-code")
async def enrolment_code(user_id: str, user: AuthUser = Depends(console_user)):
    need_write(user)
    row = await _load(uuid_param(user_id), user)
    if not (user.is_admin or user.is_hse or any(user.is_officer_plus(s) for s in user.sites_in_scope())):
        raise forbidden()
    code = random_code(8)
    async with db.tx() as c:
        exp = await c.fetchval("insert into enrolment_codes (org_id, user_id, code_hash, issued_by, expires_at) values ($1, $2, $3, $4, now() + interval '24 hours') returning expires_at",
                               user.org_id, row["id"], sha256(code), user.id)
        await audit(c, org_id=user.org_id, actor=user, action="password_reset", record_type="user", record_id=row["id"], changes={"via": "enrolment_code", "expiresAt": exp})
    return JSON({"code": f"{code[:4]}-{code[4:]}", "expiresAt": exp})


@router.post("/users/{user_id}/unlock")
async def unlock(user_id: str, user: AuthUser = Depends(console_user)):
    need_admin(user)
    row = await _load(uuid_param(user_id), user)
    async with db.tx() as c:
        await c.execute("update users set failed_attempts = 0, locked_until = null, updated_at = now() where id = $1", row["id"])
        await audit(c, org_id=user.org_id, actor=user, action="update", record_type="user", record_id=row["id"], changes={"unlocked": True})
    return JSON(await _user_out(None, row["id"]))


@router.post("/users/{user_id}/status")
async def set_status(user_id: str, request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    row = await _load(uuid_param(user_id), user)
    inp = parse(StatusBody, await json_body(request))
    async with db.tx() as c:
        await c.execute("update users set status = $2, updated_at = now() where id = $1", row["id"], inp.status)
        if inp.status != "active":
            await revoke_user_sessions(row["id"], None, c)
        await audit(c, org_id=user.org_id, actor=user, action="update", record_type="user", record_id=row["id"], changes={"status": [row["status"], inp.status]}, reason=inp.reason)
    forget_user_in_cache(row["id"])
    return JSON(await _user_out(None, row["id"]))


@router.post("/users/{user_id}/mfa/reset")
async def mfa_reset(user_id: str, user: AuthUser = Depends(console_user)):
    need_admin(user)
    row = await _load(uuid_param(user_id), user)
    async with db.tx() as c:
        await mfa.reset(c, row["id"])
        await revoke_user_sessions(row["id"], None, c)
        await audit(c, org_id=user.org_id, actor=user, action="mfa_enrol", record_type="user", record_id=row["id"], changes={"reset": True})
        await notify(c, org_id=user.org_id, recipients=[row["id"]], event_type="mfa_reset", record_type="user", record_id=row["id"], key="mfa_reset", push=False, email=True)
    return JSON(await _user_out(None, row["id"]))


@router.post("/users/{user_id}/devices/{device_id}/revoke")
async def revoke_device(user_id: str, device_id: str, user: AuthUser = Depends(console_user)):
    need_admin(user)
    row = await _load(uuid_param(user_id), user)
    async with db.tx() as c:
        d = await db.one("update devices set revoked_at = now(), push_subscription = null where id = $1 and user_id = $2 returning id", [uuid_param(device_id), row["id"]], c)
        if not d:
            raise not_found()
        await c.execute("update sessions set revoked_at = now() where device_id = $1 and revoked_at is null", d["id"])
        await audit(c, org_id=user.org_id, actor=user, action="update", record_type="device", record_id=d["id"], changes={"revoked": True, "userId": row["id"]})
    forget_user_in_cache(row["id"])
    return JSON(await _user_out(None, row["id"]))


@router.post("/users/import")
async def import_users(request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    rows = await read_csv(request, ["name", "employee_code", "role", "site_code"])
    created = updated = skipped = 0
    errors = []
    temp_passwords = {}
    async with db.tx() as c:
        for i, r in enumerate(rows, start=2):
            name, code, role, site_code = r.get("name", ""), r.get("employee_code", ""), r.get("role", "").strip(), r.get("site_code", "").upper()
            if not name or not code or role not in ROLES:
                errors.append({"row": i, "message": "name, employee_code and a valid role are required"})
                skipped += 1
                continue
            site = None
            if role not in ALL_SITES_ROLES:
                site = await db.one("select id from sites where org_id = $1 and code = $2 and deleted_at is null", [user.org_id, site_code], c)
                if not site:
                    errors.append({"row": i, "message": f"unknown site_code {site_code}"})
                    skipped += 1
                    continue
            employer = None
            if r.get("employer"):
                employer = await db.one("select id from contractors where org_id = $1 and lower(name) = lower($2) and deleted_at is null", [user.org_id, r["employer"]], c)
            lang = r.get("language") if r.get("language") in ("en", "hi", "ta", "kn") else "en"
            phone = r.get("phone", "")
            existing = await db.one("select id, person_id from users where org_id = $1 and lower(employee_code) = lower($2)", [user.org_id, code], c)
            if existing:
                await c.execute("update people set full_name = $2, employer_id = coalesce($3, employer_id), trade = $4, updated_at = now() where id = $1",
                                existing["person_id"], name, employer["id"] if employer else None, r.get("trade", ""))
                await c.execute("update users set email = coalesce(nullif($2, ''), email), language = $3, updated_at = now() where id = $1", existing["id"], r.get("email", "").lower(), lang)
                await c.execute("insert into user_site_roles (user_id, site_id, role, granted_by) values ($1, $2, $3::role_t, $4) on conflict do nothing",
                                existing["id"], site["id"] if site else None, role, user.id)
                forget_user_in_cache(existing["id"])
                updated += 1
            else:
                temp = temp_password()
                person = await db.one(
                    "insert into people (org_id, full_name, employer_id, phone_enc, phone_last4, preferred_language, trade) values ($1,$2,$3,$4,$5,$6,$7) returning id",
                    [user.org_id, name, employer["id"] if employer else None, encrypt(phone) if phone else "", phone[-4:] if phone else "", lang, r.get("trade", "")], c,
                )
                login_type = "email" if r.get("email") and role in ("site_safety_officer", "site_head", "hse_manager", "admin", "auditor") else "employee_code"
                u = await db.one(
                    "insert into users (org_id, person_id, login_type, employee_code, email, password_hash, language, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
                    [user.org_id, person["id"], login_type, code, r.get("email", "").lower(), await hash_password(temp), lang, user.id], c,
                )
                await c.execute("insert into user_site_roles (user_id, site_id, role, granted_by) values ($1, $2, $3::role_t, $4)", u["id"], site["id"] if site else None, role, user.id)
                temp_passwords[code] = temp
                created += 1
        await audit(c, org_id=user.org_id, actor=user, action="create", record_type="user", record_id="import", changes={"created": created, "updated": updated, "skipped": skipped})
    return JSON({"created": created, "updated": updated, "skipped": skipped, "errors": errors, "tempPasswords": temp_passwords})


# ---------- people ----------

@router.get("/people")
async def list_people(request: Request, user: AuthUser = Depends(console_user)):
    page, size = page_params(request, 100, 500)
    q = request.query_params.get("q", "").strip()
    params: list = [user.org_id, f"%{q}%"]
    total = await db.one("select count(*)::int as n from people where org_id = $1 and deleted_at is null and ($2 = '%%' or full_name ilike $2)", params)
    rows = await db.q(f"select * from people where org_id = $1 and deleted_at is null and ($2 = '%%' or full_name ilike $2) order by full_name limit {size} offset {(page - 1) * size}", params)
    return JSON(paged([person_view(p) for p in rows], total["n"], page, size))


def _worker_type(v: str) -> str:
    return "contract" if v == "contractor" else v


@router.post("/people")
async def create_person(request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    inp = parse(PersonIn, await json_body(request))
    async with db.tx() as c:
        row = await db.one(
            "insert into people (org_id, full_name, employer_id, phone_enc, phone_last4, preferred_language, trade, worker_type, active) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *",
            [user.org_id, inp.full_name, inp.employer_id, encrypt(inp.phone) if inp.phone else "", inp.phone[-4:] if inp.phone else "", inp.preferred_language, inp.trade,
             _worker_type(inp.worker_type), inp.active], c,
        )
        await audit(c, org_id=user.org_id, actor=user, action="create", record_type="person", record_id=row["id"], changes={"fullName": inp.full_name, "phone": inp.phone, "employerId": inp.employer_id})
    return JSON(person_view(row), status_code=201)


@router.put("/people/{person_id}")
async def update_person(person_id: str, request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    p = await db.one("select * from people where id = $1 and org_id = $2", [uuid_param(person_id), user.org_id])
    if not p:
        raise not_found()
    inp = parse(PersonIn, await json_body(request))
    async with db.tx() as c:
        row = await db.one(
            """update people set full_name = $2, employer_id = $3, phone_enc = case when $4 = '' then phone_enc else $4 end, phone_last4 = case when $5 = '' then phone_last4 else $5 end,
                                preferred_language = $6, trade = $7, worker_type = $8, active = $9, version = version + 1, updated_at = now() where id = $1 returning *""",
            [p["id"], inp.full_name, inp.employer_id, encrypt(inp.phone) if inp.phone else "", inp.phone[-4:] if inp.phone else "", inp.preferred_language, inp.trade,
             _worker_type(inp.worker_type), inp.active], c,
        )
        await audit(c, org_id=user.org_id, actor=user, action="update", record_type="person", record_id=p["id"], changes={"fullName": [p["full_name"], inp.full_name], "phone": inp.phone})
    return JSON(person_view(row))


@router.delete("/people/{person_id}")
async def delete_person(person_id: str, request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    p = await db.one("select * from people where id = $1 and org_id = $2", [uuid_param(person_id), user.org_id])
    if not p:
        raise not_found()
    reason = (await json_body(request) or {}).get("reason") or ""
    async with db.tx() as c:
        await c.execute("update people set active = false, deleted_at = now(), deleted_by = $2, delete_reason = $3, updated_at = now() where id = $1", p["id"], user.id, reason)
        await audit(c, org_id=user.org_id, actor=user, action="delete", record_type="person", record_id=p["id"], reason=reason)
    return JSON({"ok": True})


@router.post("/people/import")
async def import_people(request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    rows = await read_csv(request, ["name"])
    created = updated = skipped = 0
    errors = []
    async with db.tx() as c:
        for i, r in enumerate(rows, start=2):
            name = r.get("name", "")
            if not name:
                errors.append({"row": i, "message": "name is required"})
                skipped += 1
                continue
            employer = await db.one("select id from contractors where org_id = $1 and lower(name) = lower($2) and deleted_at is null", [user.org_id, r.get("employer", "")], c) if r.get("employer") else None
            phone = r.get("phone", "")
            lang = r.get("language") if r.get("language") in ("en", "hi", "ta", "kn") else "en"
            wt = _worker_type(r.get("worker_type", "employee")) if r.get("worker_type") in ("employee", "contract", "contractor", "temporary", "visitor") else "employee"
            existing = await db.one("select id from people where org_id = $1 and lower(full_name) = lower($2) and phone_last4 = $3 and deleted_at is null", [user.org_id, name, phone[-4:] if phone else ""], c)
            if existing:
                await c.execute("update people set employer_id = coalesce($2, employer_id), trade = $3, preferred_language = $4, worker_type = $5, updated_at = now() where id = $1",
                                existing["id"], employer["id"] if employer else None, r.get("trade", ""), lang, wt)
                updated += 1
            else:
                await c.execute("insert into people (org_id, full_name, employer_id, phone_enc, phone_last4, preferred_language, trade, worker_type) values ($1,$2,$3,$4,$5,$6,$7,$8)",
                                user.org_id, name, employer["id"] if employer else None, encrypt(phone) if phone else "", phone[-4:] if phone else "", lang, r.get("trade", ""), wt)
                created += 1
        await audit(c, org_id=user.org_id, actor=user, action="create", record_type="person", record_id="import", changes={"created": created, "updated": updated, "skipped": skipped})
    return JSON({"created": created, "updated": updated, "skipped": skipped, "errors": errors})


# ---------- contractors ----------

CONTRACTOR_SELECT = """select k.*, coalesce(array_agg(cs.site_id::text) filter (where cs.site_id is not null), '{}') as site_ids
                         from contractors k left join contractor_sites cs on cs.contractor_id = k.id"""


@router.get("/contractors")
async def list_contractors(request: Request, user: AuthUser = Depends(console_user)):
    rows = await db.q(CONTRACTOR_SELECT + " where k.org_id = $1 and k.deleted_at is null group by k.id order by k.is_own_company desc, k.name", [user.org_id])
    return JSON([contractor_view(r) for r in rows])


async def _contractor_out(conn, cid: str) -> dict:
    row = await db.one(CONTRACTOR_SELECT + " where k.id = $1 group by k.id", [cid], conn)
    return contractor_view(row)


@router.post("/contractors")
async def create_contractor(request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    inp = parse(ContractorIn, await json_body(request))
    if await db.one("select 1 from contractors where org_id = $1 and name = $2", [user.org_id, inp.name]):
        raise HttpError(409, "This code is already in use.", "conflict", key="err.duplicate_code")
    async with db.tx() as c:
        row = await db.one(
            "insert into contractors (org_id, name, is_own_company, parent_id, registration_no, contact_name, phone, email, trades, active) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",
            [user.org_id, inp.name, inp.is_own_company, inp.parent_id, inp.registration_no, inp.contact_name, inp.phone, inp.email, inp.trades, inp.active], c,
        )
        for sid in inp.site_ids:
            await c.execute("insert into contractor_sites (contractor_id, site_id) values ($1, $2) on conflict do nothing", row["id"], sid)
        await audit(c, org_id=user.org_id, actor=user, action="create", record_type="contractor", record_id=row["id"], changes={"name": inp.name, "phone": inp.phone, "contactName": inp.contact_name})
        out = await _contractor_out(c, row["id"])
    return JSON(out, status_code=201)


@router.put("/contractors/{cid}")
async def update_contractor(cid: str, request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    k = await db.one("select * from contractors where id = $1 and org_id = $2", [uuid_param(cid), user.org_id])
    if not k:
        raise not_found()
    inp = parse(ContractorIn, await json_body(request))
    async with db.tx() as c:
        await c.execute(
            """update contractors set name = $2, is_own_company = $3, parent_id = $4, registration_no = $5, contact_name = $6, phone = $7, email = $8, trades = $9, active = $10,
                                      version = version + 1, updated_at = now() where id = $1""",
            k["id"], inp.name, inp.is_own_company, inp.parent_id, inp.registration_no, inp.contact_name, inp.phone, inp.email, inp.trades, inp.active,
        )
        await c.execute("delete from contractor_sites where contractor_id = $1", k["id"])
        for sid in inp.site_ids:
            await c.execute("insert into contractor_sites (contractor_id, site_id) values ($1, $2) on conflict do nothing", k["id"], sid)
        await audit(c, org_id=user.org_id, actor=user, action="update", record_type="contractor", record_id=k["id"], changes={"name": [k["name"], inp.name], "phone": inp.phone, "active": [k["active"], inp.active]})
        out = await _contractor_out(c, k["id"])
    return JSON(out)


@router.delete("/contractors/{cid}")
async def delete_contractor(cid: str, request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    k = await db.one("select * from contractors where id = $1 and org_id = $2", [uuid_param(cid), user.org_id])
    if not k:
        raise not_found()
    reason = (await json_body(request) or {}).get("reason") or ""
    async with db.tx() as c:
        await c.execute("update contractors set active = false, deleted_at = now(), deleted_by = $2, delete_reason = $3, updated_at = now() where id = $1", k["id"], user.id, reason)
        await audit(c, org_id=user.org_id, actor=user, action="delete", record_type="contractor", record_id=k["id"], reason=reason)
    return JSON({"ok": True})


