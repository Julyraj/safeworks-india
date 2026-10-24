"""Admin console API: overview, sites, contractors, users and passwords, master lists, settings, audit, export."""
from __future__ import annotations

import csv
import io
import re
import time
from datetime import date, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import Field, field_validator
from starlette.responses import Response

from .. import db
from ..audit import audit
from ..auth import forget_user_in_cache, require_user, revoke_user_sessions
from ..config import config
from ..errors import bad_request, conflict, forbidden, not_found
from ..http import JSON, client_ip, json_body, query, uuid_param
from ..observations import TYPE_LABEL, check_uuid, clear_site_cache
from ..rbac import ROLE_LABEL, ROLES, AuthUser, is_admin
from ..security import hash_password, password_problem, sign_file, temp_password
from ..settings import clear_org_cache, get_org, merge_settings
from ..validation import In, Str, parse
from .dashboard import kpis, period, site_dashboard
from .meta import clear_master_cache

import asyncpg

router = APIRouter()
admin = require_user("admin")

SITE_TYPES = ("construction", "factory", "plant", "warehouse", "terminal", "quarry", "office", "other")
ROLE_SCOPE = {"platform_admin": "company", "org_admin": "company", "viewer": "either", "auditor": "either", "safety_officer": "site", "supervisor": "site"}
ROLE_ALIASES = {
    "safety officer": "safety_officer", "safety_officer": "safety_officer", "so": "safety_officer",
    "supervisor": "supervisor", "action owner": "supervisor",
    "viewer": "viewer", "management viewer": "viewer",
    "auditor": "auditor", "admin": "org_admin", "org_admin": "org_admin",
}
MASTER_LISTS = ("category", "item", "hazard", "activity", "root_cause", "lsr", "immediate_action", "control_level", "round_type", "shift", "permit_type")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def require_write(u: AuthUser) -> None:
    if not is_admin(u):
        raise forbidden("Only admins can change this. Management viewers have read-only access.")


def _email(v: str | None) -> str | None:
    if v is None:
        return v
    v = v.strip()
    if v and not EMAIL_RE.match(v):
        raise ValueError("Enter a valid email address")
    return v


class SiteIn(In):
    code: str
    name: Str(160, 2)
    site_type: Literal[SITE_TYPES] = "construction"  # type: ignore[valid-type]
    state: Str(60, 2)
    address: Str(400) = ""
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    registrations: dict[str, Str(120)] = Field(default_factory=dict)
    site_head_name: Str(120) = ""
    site_head_phone: Str(40) = ""
    site_head_email: str = ""
    active: bool = True

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        v = v.strip().upper()
        if not re.match(r"^[A-Z0-9][A-Z0-9-]{1,19}$", v):
            raise ValueError("Use 2–20 letters, digits or dashes, e.g. BLR-TWR01.")
        return v

    @field_validator("site_head_email")
    @classmethod
    def _e(cls, v: str) -> str:
        return _email(v) or ""


class SitePatch(SiteIn):
    code: str | None = None  # type: ignore[assignment]
    name: Str(160, 2) | None = None  # type: ignore[assignment]
    site_type: Literal[SITE_TYPES] | None = None  # type: ignore[valid-type,assignment]
    state: Str(60, 2) | None = None  # type: ignore[assignment]
    address: Str(400) | None = None  # type: ignore[assignment]
    registrations: dict[str, Str(120)] | None = None  # type: ignore[assignment]
    site_head_name: Str(120) | None = None  # type: ignore[assignment]
    site_head_phone: Str(40) | None = None  # type: ignore[assignment]
    site_head_email: str | None = None  # type: ignore[assignment]
    active: bool | None = None  # type: ignore[assignment]

    @field_validator("code")
    @classmethod
    def _code(cls, v: str | None) -> str | None:
        return None if v is None else SiteIn._code(v)


class RoleIn(In):
    role: Literal[tuple(ROLES)]  # type: ignore[valid-type]
    site_id: str | None = None

    @field_validator("site_id")
    @classmethod
    def _uuid(cls, v: str | None) -> str | None:
        return check_uuid(v)


class PasswordChoice(In):
    mode: Literal["temp", "set"] = "temp"
    value: str | None = None
    must_change: bool = True


class UserIn(In):
    employee_id: str
    name: Str(120, 2)
    designation: Str(120) = ""
    phone: Str(40) = ""
    email: str = ""
    contractor_id: str | None = None
    roles: list[RoleIn] = Field(min_length=1, max_length=50)
    password: PasswordChoice = Field(default_factory=PasswordChoice)

    @field_validator("employee_id")
    @classmethod
    def _emp(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 40 or not re.match(r"^[A-Za-z0-9._\-/]+$", v):
            raise ValueError("Employee ID can use letters, digits and . _ - /")
        return v

    @field_validator("email")
    @classmethod
    def _e(cls, v: str) -> str:
        return _email(v) or ""

    @field_validator("contractor_id")
    @classmethod
    def _c(cls, v: str | None) -> str | None:
        return check_uuid(v)


class UserPatch(In):
    name: Str(120, 2) | None = None
    designation: Str(120) | None = None
    phone: Str(40) | None = None
    email: str | None = None
    contractor_id: str | None = None

    @field_validator("email")
    @classmethod
    def _e(cls, v: str | None) -> str | None:
        return _email(v)

    @field_validator("contractor_id")
    @classmethod
    def _c(cls, v: str | None) -> str | None:
        return check_uuid(v)


class PasswordIn(In):
    mode: Literal["temp", "set"]
    password: str | None = None
    must_change: bool = True


async def validate_roles(u: AuthUser, roles: list[RoleIn]) -> None:
    site_ids = list({r.site_id for r in roles if r.site_id})
    if site_ids:
        found = await db.q("select id from sites where org_id = $1 and id = any($2::uuid[])", [u.org_id, site_ids])
        if len(found) != len(site_ids):
            raise bad_request("One of the sites does not exist.")
    for r in roles:
        scope = ROLE_SCOPE[r.role]
        if scope == "company" and r.site_id:
            raise bad_request(f"{ROLE_LABEL[r.role]} applies to the whole company, not one site.")
        if scope == "site" and not r.site_id:
            raise bad_request(f"{ROLE_LABEL[r.role]} must be given for a specific site.")
        if r.role == "platform_admin" and not any(m.role == "platform_admin" for m in u.memberships):
            raise forbidden("Only a platform admin can grant the platform admin role.")
    keys = [f"{r.role}:{r.site_id or '*'}" for r in roles]
    if len(set(keys)) != len(keys):
        raise bad_request("The same role is listed twice.")


async def resolve_password(mode: str, value: str | None) -> tuple[str, str | None]:
    if mode == "set":
        pw = value or ""
        problem = password_problem(pw)
        if problem:
            raise bad_request(problem)
        return await hash_password(pw), None
    temp = temp_password()
    return await hash_password(temp), temp


def csv_cell(v: Any) -> str:
    if v is None:
        return ""
    s = v.isoformat() if isinstance(v, (datetime, date)) else str(v)
    if s and s[0] in "=+-@\t\r":
        s = "'" + s  # neutralise spreadsheet formulas (CSV injection)
    return f'"{s.replace(chr(34), chr(34) * 2)}"' if re.search(r'[",\n\r]', s) else s


def _like(s: str) -> str:
    return "%" + re.sub(r"([%_\\])", r"\\\1", s) + "%"


# ----- Overview -------------------------------------------------------------------------------


@router.get("/api/admin/overview")
async def overview(request: Request, u: AuthUser = Depends(admin)):
    frm, to = period(query(request))
    sites = await db.q(
        """select s.id, s.code, s.name, s.state, s.site_type, s.active,
                  count(o.id) filter (where o.status in ('open','in_progress'))::int as open,
                  count(o.id) filter (where o.status in ('open','in_progress') and o.due_at < now())::int as overdue,
                  count(o.id) filter (where o.status = 'closure_submitted')::int as awaiting,
                  count(o.id) filter (where o.status in ('open','in_progress','closure_submitted') and o.risk_level in ('High','Critical'))::int as high_critical_open,
                  count(o.id) filter (where o.status <> 'cancelled' and o.raised_at >= $2::date and o.raised_at < ($3::date + 1))::int as raised,
                  count(o.id) filter (where o.status = 'closed' and o.raised_at >= $2::date and o.raised_at < ($3::date + 1))::int as closed,
                  count(o.id) filter (where o.status not in ('cancelled','noted') and o.raised_at >= $2::date and o.raised_at < ($3::date + 1))::int as actionable,
                  round((avg(extract(epoch from (o.closed_at - o.raised_at)) / 86400) filter (where o.status = 'closed' and o.raised_at >= $2::date and o.raised_at < ($3::date + 1)))::numeric, 1)::float as avg_days,
                  (select count(distinct m.user_id)::int from memberships m where m.site_id = s.id) as users
             from sites s left join observations o on o.site_id = s.id
            where s.org_id = $1 group by s.id order by s.active desc, s.name""",
        [u.org_id, frm, to],
    )
    active_ids = [s["id"] for s in sites if s["active"]]
    dash = await site_dashboard(active_ids, u.org_id, frm, to)
    return JSON({
        "period": {"from": frm.isoformat(), "to": to.isoformat()},
        "sites": [
            {"id": s["id"], "code": s["code"], "name": s["name"], "state": s["state"], "type": s["site_type"], "active": s["active"], "users": s["users"],
             "open": s["open"], "overdue": s["overdue"], "awaiting": s["awaiting"], "highCriticalOpen": s["high_critical_open"], "raised": s["raised"],
             "closed": s["closed"], "closureRate": round(s["closed"] / s["actionable"] * 1000) / 10 if s["actionable"] else None, "avgDaysToClose": s["avg_days"]}
            for s in sites
        ],
        "dashboard": dash,
    })


# ----- Sites and areas ------------------------------------------------------------------------


@router.get("/api/admin/sites")
async def list_sites(u: AuthUser = Depends(admin)):
    sites = await db.q("select * from sites where org_id = $1 order by active desc, name", [u.org_id])
    areas = await db.q("select a.* from areas a join sites s on s.id = a.site_id where s.org_id = $1 order by a.name", [u.org_id])
    return JSON({"sites": [
        {"id": s["id"], "code": s["code"], "name": s["name"], "siteType": s["site_type"], "state": s["state"], "address": s["address"],
         "lat": s["lat"], "lng": s["lng"], "registrations": s["registrations"], "siteHeadName": s["site_head_name"], "siteHeadPhone": s["site_head_phone"],
         "siteHeadEmail": s["site_head_email"], "active": s["active"],
         "areas": [{"id": a["id"], "name": a["name"], "active": a["active"]} for a in areas if a["site_id"] == s["id"]]}
        for s in sites
    ]})


@router.post("/api/admin/sites")
async def create_site(request: Request, u: AuthUser = Depends(admin)):
    require_write(u)
    s = parse(SiteIn, await json_body(request))
    try:
        row = await db.one(
            """insert into sites (org_id, code, name, site_type, state, address, lat, lng, registrations, site_head_name, site_head_phone, site_head_email, active)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id""",
            [u.org_id, s.code, s.name, s.site_type, s.state, s.address, s.lat, s.lng, s.registrations, s.site_head_name, s.site_head_phone, s.site_head_email, s.active],
        )
    except asyncpg.UniqueViolationError:
        raise conflict("A site with this code already exists.")
    clear_site_cache()
    await audit("site.created", org_id=u.org_id, actor_id=u.id, entity="site", entity_id=row["id"], ip=client_ip(request), details={"code": s.code, "name": s.name})
    return JSON({"id": row["id"]}, status_code=201)


SITE_COLS = {
    "code": "code", "name": "name", "site_type": "site_type", "state": "state", "address": "address", "lat": "lat", "lng": "lng",
    "registrations": "registrations", "site_head_name": "site_head_name", "site_head_phone": "site_head_phone", "site_head_email": "site_head_email", "active": "active",
}


@router.patch("/api/admin/sites/{sid}")
async def patch_site(sid: str, request: Request, u: AuthUser = Depends(admin)):
    require_write(u)
    sid = uuid_param(sid, "Site not found.")
    body = await json_body(request)
    s = parse(SitePatch, body)
    if not await db.one("select id from sites where id = $1 and org_id = $2", [sid, u.org_id]):
        raise not_found("Site not found.")
    sets, vals = [], [sid]
    for field, col in SITE_COLS.items():
        if field not in s.model_fields_set:
            continue
        v = getattr(s, field)
        if v is None and col not in ("lat", "lng"):
            continue
        vals.append(v)
        sets.append(f"{col} = ${len(vals)}")
    if not sets:
        return JSON({"ok": True})
    try:
        await db.execute(f"update sites set {', '.join(sets)} where id = $1", vals)
    except asyncpg.UniqueViolationError:
        raise conflict("A site with this code already exists.")
    clear_site_cache()
    await audit("site.updated", org_id=u.org_id, actor_id=u.id, entity="site", entity_id=sid, ip=client_ip(request), details=body)
    return JSON({"ok": True})


class AreaIn(In):
    name: Str(120, 1)


class AreaPatch(In):
    name: Str(120, 1) | None = None
    active: bool | None = None


@router.post("/api/admin/sites/{sid}/areas")
async def add_area(sid: str, request: Request, u: AuthUser = Depends(admin)):
    require_write(u)
    sid = uuid_param(sid, "Site not found.")
    name = parse(AreaIn, await json_body(request)).name
    if not await db.one("select 1 as ok from sites where id = $1 and org_id = $2", [sid, u.org_id]):
        raise not_found("Site not found.")
    try:
        row = await db.one("insert into areas (site_id, name) values ($1,$2) returning id", [sid, name])
    except asyncpg.UniqueViolationError:
        raise conflict("This area already exists on the site.")
    await audit("area.created", org_id=u.org_id, actor_id=u.id, entity="area", entity_id=row["id"], ip=client_ip(request), details={"siteId": sid, "name": name})
    return JSON({"id": row["id"]}, status_code=201)


@router.patch("/api/admin/areas/{aid}")
async def patch_area(aid: str, request: Request, u: AuthUser = Depends(admin)):
    require_write(u)
    aid = uuid_param(aid, "Area not found.")
    b = parse(AreaPatch, await json_body(request))
    if not await db.one("select a.id from areas a join sites s on s.id = a.site_id where a.id = $1 and s.org_id = $2", [aid, u.org_id]):
        raise not_found("Area not found.")
    try:
        await db.execute("update areas set name = coalesce($2, name), active = coalesce($3, active) where id = $1", [aid, b.name, b.active])
    except asyncpg.UniqueViolationError:
        raise conflict("This area already exists on the site.")
    await audit("area.updated", org_id=u.org_id, actor_id=u.id, entity="area", entity_id=aid, ip=client_ip(request), details=b.model_dump(by_alias=True, exclude_none=True))
    return JSON({"ok": True})


# ----- Contractors ----------------------------------------------------------------------------


class ContractorIn(In):
    name: Str(160, 2)
    contact: Str(300) = ""
    active: bool = True
    site_ids: list[str] = Field(default_factory=list, max_length=500)

    @field_validator("site_ids")
    @classmethod
    def _ids(cls, v: list[str]) -> list[str]:
        return [check_uuid(x) for x in v if check_uuid(x)]  # type: ignore[misc]


@router.get("/api/admin/contractors")
async def list_contractors(u: AuthUser = Depends(admin)):
    rows = await db.q(
        """select c.*, coalesce(array_agg(cs.site_id) filter (where cs.site_id is not null), '{}') as site_ids,
                  (select count(*)::int from users x where x.contractor_id = c.id) as users
             from contractors c left join contractor_sites cs on cs.contractor_id = c.id
            where c.org_id = $1 group by c.id order by c.active desc, c.name""",
        [u.org_id],
    )
    return JSON({"contractors": [{"id": c["id"], "name": c["name"], "contact": c["contact"], "active": c["active"], "siteIds": c["site_ids"], "users": c["users"]} for c in rows]})


async def save_contractor(u: AuthUser, cid: str | None, inp: ContractorIn) -> str:
    async with db.tx() as c:
        try:
            if cid:
                r = await db.one("update contractors set name = $2, contact = $3, active = $4 where id = $1 and org_id = $5 returning id", [cid, inp.name, inp.contact, inp.active, u.org_id], c)
                if not r:
                    raise not_found("Contractor not found.")
            else:
                r = await db.one("insert into contractors (org_id, name, contact, active) values ($1,$2,$3,$4) returning id", [u.org_id, inp.name, inp.contact, inp.active], c)
                cid = r["id"]
        except asyncpg.UniqueViolationError:
            raise conflict("A contractor with this name already exists.")
        await db.execute("delete from contractor_sites where contractor_id = $1", [cid], c)
        if inp.site_ids:
            await db.execute(
                "insert into contractor_sites (contractor_id, site_id) select $1, s.id from sites s where s.org_id = $2 and s.id = any($3::uuid[])",
                [cid, u.org_id, inp.site_ids],
                c,
            )
        return cid  # type: ignore[return-value]


@router.post("/api/admin/contractors")
async def create_contractor(request: Request, u: AuthUser = Depends(admin)):
    require_write(u)
    inp = parse(ContractorIn, await json_body(request))
    cid = await save_contractor(u, None, inp)
    await audit("contractor.created", org_id=u.org_id, actor_id=u.id, entity="contractor", entity_id=cid, ip=client_ip(request), details={"name": inp.name})
    return JSON({"id": cid}, status_code=201)


@router.put("/api/admin/contractors/{cid}")
async def update_contractor(cid: str, request: Request, u: AuthUser = Depends(admin)):
    require_write(u)
    cid = uuid_param(cid, "Contractor not found.")
    inp = parse(ContractorIn, await json_body(request))
    await save_contractor(u, cid, inp)
    await audit("contractor.updated", org_id=u.org_id, actor_id=u.id, entity="contractor", entity_id=cid, ip=client_ip(request), details=inp.model_dump(by_alias=True))
    return JSON({"ok": True})


# ----- Users ----------------------------------------------------------------------------------


class UsersQ(In):
    q: Str(80) | None = None
    site_id: str | None = None
    role: Literal[tuple(ROLES)] | None = None  # type: ignore[valid-type]
    status: Literal["active", "inactive", "locked", "all"] = "all"
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=100, ge=1, le=500)

    @field_validator("site_id")
    @classmethod
    def _uuid(cls, v: str | None) -> str | None:
        return check_uuid(v)


@router.get("/api/admin/users")
async def list_users(request: Request, u: AuthUser = Depends(admin)):
    f = parse(UsersQ, query(request))
    where, params = ["u.org_id = $1"], [u.org_id]
    if f.q:
        params.append(_like(f.q))
        n = len(params)
        where.append(f"(u.employee_id ilike ${n} or u.name ilike ${n} or u.designation ilike ${n})")
    if f.site_id:
        params.append(f.site_id)
        where.append(f"exists (select 1 from memberships m where m.user_id = u.id and m.site_id = ${len(params)}::uuid)")
    if f.role:
        params.append(f.role)
        where.append(f"exists (select 1 from memberships m where m.user_id = u.id and m.role::text = ${len(params)})")
    if f.status == "active":
        where.append("u.active")
    elif f.status == "inactive":
        where.append("not u.active")
    elif f.status == "locked":
        where.append("u.locked_until > now()")
    w = " and ".join(where)
    rows = await db.q(
        f"""select u.id, u.employee_id, u.name, u.designation, u.phone, u.email, u.active, u.must_change_password, u.last_login_at, u.created_at,
                   (u.locked_until is not null and u.locked_until > now()) as locked, ct.name as contractor_name, u.contractor_id,
                   coalesce(json_agg(json_build_object('role', m.role, 'siteId', m.site_id, 'siteName', s.name, 'siteCode', s.code)) filter (where m.id is not null), '[]') as roles
              from users u left join memberships m on m.user_id = u.id left join sites s on s.id = m.site_id
              left join contractors ct on ct.id = u.contractor_id
             where {w} group by u.id, ct.name order by u.active desc, u.name limit {f.page_size} offset {(f.page - 1) * f.page_size}""",
        params,
    )
    total = await db.one(f"select count(*)::int as n from users u where {w}", params)
    return JSON({
        "total": total["n"] if total else 0,
        "users": [
            {"id": r["id"], "employeeId": r["employee_id"], "name": r["name"], "designation": r["designation"], "phone": r["phone"], "email": r["email"],
             "active": r["active"], "locked": r["locked"], "mustChangePassword": r["must_change_password"], "lastLoginAt": r["last_login_at"],
             "createdAt": r["created_at"], "contractorId": r["contractor_id"], "contractorName": r["contractor_name"],
             "roles": [{**x, "roleLabel": ROLE_LABEL.get(x["role"], x["role"])} for x in r["roles"]]}
            for r in rows
        ],
    })


@router.post("/api/admin/users")
async def create_user(request: Request, u: AuthUser = Depends(admin)):
    require_write(u)
    inp = parse(UserIn, await json_body(request))
    await validate_roles(u, inp.roles)
    pw_hash, temp = await resolve_password(inp.password.mode, inp.password.value)
    async with db.tx() as c:
        try:
            row = await db.one(
                """insert into users (org_id, employee_id, name, designation, phone, email, contractor_id, password_hash, must_change_password, created_by)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id""",
                [u.org_id, inp.employee_id, inp.name, inp.designation, inp.phone, inp.email, inp.contractor_id, pw_hash, True if temp else inp.password.must_change, u.id],
                c,
            )
        except asyncpg.UniqueViolationError:
            raise conflict(f"Employee ID {inp.employee_id} is already in use.")
        for r in inp.roles:
            await db.execute("insert into memberships (user_id, org_id, site_id, role) values ($1,$2,$3,$4)", [row["id"], u.org_id, r.site_id, r.role], c)
        await audit("user.created", org_id=u.org_id, actor_id=u.id, entity="user", entity_id=row["id"], ip=client_ip(request),
                    details={"employeeId": inp.employee_id, "roles": [{"role": r.role, "siteId": r.site_id} for r in inp.roles], "password": inp.password.mode}, conn=c)
    return JSON({"id": row["id"], "tempPassword": temp}, status_code=201)


@router.patch("/api/admin/users/{uid}")
async def patch_user(uid: str, request: Request, u: AuthUser = Depends(admin)):
    require_write(u)
    uid = uuid_param(uid, "User not found.")
    b = parse(UserPatch, await json_body(request))
    if not await db.one("select id from users where id = $1 and org_id = $2", [uid, u.org_id]):
        raise not_found("User not found.")
    await db.execute(
        """update users set name = coalesce($2, name), designation = coalesce($3, designation), phone = coalesce($4, phone), email = coalesce($5, email),
                  contractor_id = case when $6::boolean then $7::uuid else contractor_id end where id = $1""",
        [uid, b.name, b.designation, b.phone, b.email, "contractor_id" in b.model_fields_set, b.contractor_id],
    )
    forget_user_in_cache(uid)
    await audit("user.updated", org_id=u.org_id, actor_id=u.id, entity="user", entity_id=uid, ip=client_ip(request), details=b.model_dump(by_alias=True, exclude_unset=True))
    return JSON({"ok": True})


class RolesIn(In):
    roles: list[RoleIn] = Field(min_length=1, max_length=50)


@router.put("/api/admin/users/{uid}/roles")
async def set_roles(uid: str, request: Request, u: AuthUser = Depends(admin)):
    require_write(u)
    uid = uuid_param(uid, "User not found.")
    roles = parse(RolesIn, await json_body(request)).roles
    await validate_roles(u, roles)
    if not await db.one("select id from users where id = $1 and org_id = $2", [uid, u.org_id]):
        raise not_found("User not found.")
    if uid == u.id and not any(r.role in ("org_admin", "platform_admin") for r in roles):
        raise bad_request("You cannot remove your own admin role. Ask another admin.")
    before = await db.q("select role::text as role, site_id from memberships where user_id = $1", [uid])
    if any(r["role"] == "platform_admin" for r in before) and not any(m.role == "platform_admin" for m in u.memberships) and not any(r.role == "platform_admin" for r in roles):
        raise forbidden("Only a platform admin can remove the platform admin role.")
    async with db.tx() as c:
        await db.execute("delete from memberships where user_id = $1", [uid], c)
        for r in roles:
            await db.execute("insert into memberships (user_id, org_id, site_id, role) values ($1,$2,$3,$4)", [uid, u.org_id, r.site_id, r.role], c)
        await audit("user.roles_changed", org_id=u.org_id, actor_id=u.id, entity="user", entity_id=uid, ip=client_ip(request),
                    details={"before": before, "after": [{"role": r.role, "siteId": r.site_id} for r in roles]}, conn=c)
    forget_user_in_cache(uid)
    return JSON({"ok": True})


@router.post("/api/admin/users/{uid}/password")
async def set_password(uid: str, request: Request, u: AuthUser = Depends(admin)):
    require_write(u)
    uid = uuid_param(uid, "User not found.")
    b = parse(PasswordIn, await json_body(request))
    target = await db.one("select id, employee_id from users where id = $1 and org_id = $2", [uid, u.org_id])
    if not target:
        raise not_found("User not found.")
    pw_hash, temp = await resolve_password(b.mode, b.password)
    must_change = True if temp else b.must_change
    await db.execute(
        "update users set password_hash = $2, must_change_password = $3, failed_attempts = 0, locked_until = null, password_changed_at = now() where id = $1",
        [uid, pw_hash, must_change],
    )
    await revoke_user_sessions(uid, None)
    await audit("password.reset" if b.mode == "temp" else "password.set_by_admin", org_id=u.org_id, actor_id=u.id, entity="user", entity_id=uid,
                ip=client_ip(request), details={"employeeId": target["employee_id"], "mustChange": must_change})
    return JSON({"ok": True, "tempPassword": temp, "mustChange": must_change})


@router.post("/api/admin/users/{uid}/unlock")
async def unlock(uid: str, request: Request, u: AuthUser = Depends(admin)):
    require_write(u)
    uid = uuid_param(uid, "User not found.")
    if not await db.one("update users set failed_attempts = 0, locked_until = null where id = $1 and org_id = $2 returning id", [uid, u.org_id]):
        raise not_found("User not found.")
    await audit("user.unlocked", org_id=u.org_id, actor_id=u.id, entity="user", entity_id=uid, ip=client_ip(request))
    return JSON({"ok": True})


@router.post("/api/admin/users/{uid}/force-change")
async def force_change(uid: str, request: Request, u: AuthUser = Depends(admin)):
    require_write(u)
    uid = uuid_param(uid, "User not found.")
    if not await db.one("update users set must_change_password = true where id = $1 and org_id = $2 returning id", [uid, u.org_id]):
        raise not_found("User not found.")
    forget_user_in_cache(uid)
    await audit("password.force_change", org_id=u.org_id, actor_id=u.id, entity="user", entity_id=uid, ip=client_ip(request))
    return JSON({"ok": True})


class ActiveIn(In):
    active: bool


@router.post("/api/admin/users/{uid}/active")
async def set_active(uid: str, request: Request, u: AuthUser = Depends(admin)):
    require_write(u)
    uid = uuid_param(uid, "User not found.")
    active = parse(ActiveIn, await json_body(request)).active
    if uid == u.id and not active:
        raise bad_request("You cannot deactivate your own login.")
    if not await db.one("update users set active = $2 where id = $1 and org_id = $3 returning id", [uid, active, u.org_id]):
        raise not_found("User not found.")
    if not active:
        await revoke_user_sessions(uid, None)
    await audit("user.reactivated" if active else "user.deactivated", org_id=u.org_id, actor_id=u.id, entity="user", entity_id=uid, ip=client_ip(request))
    return JSON({"ok": True})


class ImportIn(In):
    csv: str = Field(max_length=2_000_000)
    dry_run: bool = False


@router.post("/api/admin/users/import")
async def import_users(request: Request, u: AuthUser = Depends(admin)):
    require_write(u)
    inp = parse(ImportIn, await json_body(request))
    text = inp.csv.lstrip("﻿")
    rows = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
    if len(rows) < 2:
        raise bad_request("The file needs a header row and at least one user.")
    header = [re.sub(r"\s+", "_", h.strip().lower()) for h in rows[0]]

    def col(name: str) -> int:
        return header.index(name) if name in header else -1

    for need in ("employee_id", "name", "role"):
        if col(need) < 0:
            raise bad_request(f'Missing column "{need}". Expected: employee_id, name, designation, phone, email, role, site_code.')
    sites = await db.q("select id, code from sites where org_id = $1", [u.org_id])
    site_by_code = {s["code"].upper(): s["id"] for s in sites}
    existing = {r["e"] for r in await db.q("select lower(employee_id) as e from users where org_id = $1", [u.org_id])}
    errors: list[dict] = []
    seen: set[str] = set()
    plans: list[tuple[int, UserIn]] = []
    for i, r in enumerate(rows[1:]):
        line = i + 2

        def get(name: str) -> str:
            k = col(name)
            return r[k].strip() if 0 <= k < len(r) else ""

        emp = get("employee_id")
        role = ROLE_ALIASES.get(get("role").lower())
        site_code = get("site_code").upper()
        if not emp:
            errors.append({"line": line, "message": "employee_id is empty"})
            continue
        if emp.lower() in existing or emp.lower() in seen:
            errors.append({"line": line, "message": f"Employee ID {emp} already exists"})
            continue
        if not role:
            errors.append({"line": line, "message": f'Unknown role "{get("role")}" (use safety officer, supervisor, viewer, auditor or admin)'})
            continue
        scope = ROLE_SCOPE[role]
        site_id = None
        if scope == "site" or (scope == "either" and site_code):
            site_id = site_by_code.get(site_code)
            if not site_id:
                errors.append({"line": line, "message": f'Unknown site_code "{site_code}"'})
                continue
        try:
            user = UserIn.model_validate({
                "employeeId": emp, "name": get("name"), "designation": get("designation"), "phone": get("phone"), "email": get("email"),
                "roles": [{"role": role, "siteId": site_id}], "password": {"mode": "temp", "mustChange": True},
            })
        except Exception as e:  # pydantic.ValidationError
            msgs = "; ".join(f"{'.'.join(str(x) for x in er['loc'])}: {er['msg']}" for er in getattr(e, "errors", lambda: [])())
            errors.append({"line": line, "message": msgs or str(e)})
            continue
        seen.add(emp.lower())
        plans.append((line, user))
    if inp.dry_run or errors:
        return JSON({"created": [], "errors": errors, "ready": len(plans)})
    created = []
    async with db.tx() as c:
        for _, p in plans:
            temp = temp_password()
            h = await hash_password(temp)
            row = await db.one(
                """insert into users (org_id, employee_id, name, designation, phone, email, password_hash, must_change_password, created_by)
                   values ($1,$2,$3,$4,$5,$6,$7,true,$8) returning id""",
                [u.org_id, p.employee_id, p.name, p.designation, p.phone, p.email, h, u.id],
                c,
            )
            for r in p.roles:
                await db.execute("insert into memberships (user_id, org_id, site_id, role) values ($1,$2,$3,$4)", [row["id"], u.org_id, r.site_id, r.role], c)
            code = next((s["code"] for s in sites if s["id"] == p.roles[0].site_id), "All sites")
            created.append({"employeeId": p.employee_id, "name": p.name, "role": ROLE_LABEL[p.roles[0].role], "site": code, "tempPassword": temp})
        await audit("user.bulk_import", org_id=u.org_id, actor_id=u.id, entity="user", ip=client_ip(request), details={"count": len(plans)}, conn=c)
    return JSON({"created": created, "errors": [], "ready": len(plans)})


# ----- Master lists ---------------------------------------------------------------------------


@router.get("/api/admin/master")
async def master_items(u: AuthUser = Depends(admin)):
    rows = await db.q(
        """select distinct on (list, code) id, org_id, list, code, label, parent_code, sort, version, active, updated_at
             from master_items where org_id = $1 or org_id is null order by list, code, org_id nulls last""",
        [u.org_id],
    )
    rows.sort(key=lambda r: (r["list"], r["sort"], r["label"].lower()))
    return JSON({"items": [
        {"id": r["id"], "list": r["list"], "code": r["code"], "label": r["label"], "parent": r["parent_code"], "sort": r["sort"], "version": r["version"],
         "active": r["active"], "custom": r["org_id"] is not None, "updatedAt": r["updated_at"]}
        for r in rows
    ]})


def version_now() -> str:
    return datetime.now(db.TZ).strftime("%Y.%m")


class MasterIn(In):
    list: Literal[MASTER_LISTS]  # type: ignore[valid-type]
    label: Str(300, 2)
    parent: Str(80) | None = None
    sort: int = 1000


class MasterPatch(In):
    label: Str(300, 2) | None = None
    active: bool | None = None
    sort: int | None = None


@router.post("/api/admin/master")
async def add_master(request: Request, u: AuthUser = Depends(admin)):
    require_write(u)
    b = parse(MasterIn, await json_body(request))
    if b.list == "item" and not b.parent:
        raise bad_request("Choose the category this item belongs to.")
    code = f"c-{int(time.time() * 1000):x}"
    row = await db.one(
        "insert into master_items (org_id, list, code, label, parent_code, sort, version) values ($1,$2,$3,$4,$5,$6,$7) returning id",
        [u.org_id, b.list, code, b.label, b.parent, b.sort, version_now()],
    )
    clear_master_cache()
    await audit("master.created", org_id=u.org_id, actor_id=u.id, entity="master_item", entity_id=row["id"], ip=client_ip(request), details=b.model_dump(by_alias=True))
    return JSON({"id": row["id"], "code": code}, status_code=201)


@router.patch("/api/admin/master/{mid}")
async def patch_master(mid: str, request: Request, u: AuthUser = Depends(admin)):
    require_write(u)
    mid = uuid_param(mid, "List item not found.")
    b = parse(MasterPatch, await json_body(request))
    item = await db.one("select * from master_items where id = $1 and (org_id = $2 or org_id is null)", [mid, u.org_id])
    if not item:
        raise not_found("List item not found.")
    if item["org_id"]:
        await db.execute(
            "update master_items set label = coalesce($2, label), active = coalesce($3, active), sort = coalesce($4, sort), version = $5, updated_at = now() where id = $1",
            [mid, b.label, b.active, b.sort, version_now()],
        )
    else:
        # Editing a built-in item creates the company's own copy; the built-in wording stays for old records.
        await db.execute(
            """insert into master_items (org_id, list, code, label, parent_code, sort, version, active)
               values ($1,$2,$3,$4,$5,$6,$7,$8)
               on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), list, code)
               do update set label = excluded.label, active = excluded.active, sort = excluded.sort, version = excluded.version, updated_at = now()""",
            [u.org_id, item["list"], item["code"], b.label if b.label is not None else item["label"], item["parent_code"],
             b.sort if b.sort is not None else item["sort"], version_now(), b.active if b.active is not None else item["active"]],
        )
    clear_master_cache()
    await audit("master.updated", org_id=u.org_id, actor_id=u.id, entity="master_item", entity_id=mid, ip=client_ip(request),
                details={"list": item["list"], "code": item["code"], **b.model_dump(by_alias=True, exclude_none=True)})
    return JSON({"ok": True})


# ----- Settings -------------------------------------------------------------------------------


@router.get("/api/admin/settings")
async def get_settings(u: AuthUser = Depends(admin)):
    org = await get_org(u.org_id)
    return JSON({"companyName": org["name"], "settings": org["settings"]})


class DueDaysIn(In):
    model_config = {**In.model_config, "alias_generator": None}
    Critical: int = Field(ge=1, le=365)
    High: int = Field(ge=1, le=365)
    Medium: int = Field(ge=1, le=365)
    Low: int = Field(ge=1, le=365)


class EscalationIn(In):
    site_head_days: int = Field(ge=1, le=90)
    admin_days: int = Field(ge=1, le=180)


class SettingsIn(In):
    company_name: Str(160, 2)
    due_days: DueDaysIn
    escalation: EscalationIn
    due_reminder_hours: int = Field(default=24, ge=1, le=168)


@router.put("/api/admin/settings")
async def put_settings(request: Request, u: AuthUser = Depends(admin)):
    require_write(u)
    b = parse(SettingsIn, await json_body(request))
    d = b.due_days
    if not (d.Critical <= d.High <= d.Medium <= d.Low):
        raise bad_request("Due days should not be shorter for a lower risk level (Critical ≤ High ≤ Medium ≤ Low).")
    before = await get_org(u.org_id)
    settings = merge_settings({
        "dueDays": {"Critical": d.Critical, "High": d.High, "Medium": d.Medium, "Low": d.Low},
        "escalation": {"siteHeadDays": b.escalation.site_head_days, "adminDays": b.escalation.admin_days},
        "dueReminderHours": b.due_reminder_hours,
    })
    await db.execute("update organisations set name = $2, settings = $3 where id = $1", [u.org_id, b.company_name, settings])
    clear_org_cache()
    clear_master_cache()
    await audit("settings.updated", org_id=u.org_id, actor_id=u.id, entity="organisation", entity_id=u.org_id, ip=client_ip(request),
                details={"before": {"name": before["name"], **before["settings"]}, "after": {"name": b.company_name, **settings}})
    return JSON({"ok": True})


# ----- Audit log ------------------------------------------------------------------------------


class AuditQ(In):
    q: Str(80) | None = None
    action: Str(60) | None = None
    page: int = Field(default=1, ge=1)


@router.get("/api/admin/audit")
async def audit_log(request: Request, u: AuthUser = Depends(admin)):
    if not is_admin(u):
        raise forbidden("The audit log is for admins.")
    f = parse(AuditQ, query(request))
    where, params = ["(a.org_id = $1 or a.org_id is null)"], [u.org_id]
    if f.action:
        params.append(f"{f.action}%")
        where.append(f"a.action like ${len(params)}")
    if f.q:
        params.append(f"%{f.q}%")
        n = len(params)
        where.append(f"(u.name ilike ${n} or u.employee_id ilike ${n} or a.entity_id ilike ${n} or a.details::text ilike ${n})")
    rows = await db.q(
        f"""select a.id, a.at, a.action, a.entity, a.entity_id, a.ip, a.details, u.name as actor_name, u.employee_id as actor_employee_id
              from audit_log a left join users u on u.id = a.actor_id where {' and '.join(where)} order by a.at desc limit 100 offset {(f.page - 1) * 100}""",
        params,
    )
    return JSON({"items": [
        {"id": r["id"], "at": r["at"], "action": r["action"], "entity": r["entity"], "entityId": r["entity_id"], "ip": r["ip"], "details": r["details"],
         "actor": r["actor_name"], "actorEmployeeId": r["actor_employee_id"]}
        for r in rows
    ]})


# ----- Export ---------------------------------------------------------------------------------


class ExportQ(In):
    site_id: str | None = None

    @field_validator("site_id")
    @classmethod
    def _uuid(cls, v: str | None) -> str | None:
        return check_uuid(v)


@router.get("/api/admin/export/observations.csv")
async def export_csv(request: Request, u: AuthUser = Depends(admin)):
    qp = query(request)
    f = parse(ExportQ, qp)
    frm, to = period(qp)
    rows = await db.q(
        """select o.*, s.code as site_code, s.name as site_name, a.name as area_name, ct.name as contractor_name, ow.name as owner_name,
                  rb.name as raised_by_name, rb.employee_id as raised_by_emp, cb.name as closed_by_name, r.code as round_code,
                  (select string_agg(p.storage_key, ' ') from observation_photos p where p.observation_id = o.id and p.kind = 'evidence' and not p.withdrawn) as evidence_keys,
                  (select string_agg(p.storage_key, ' ') from observation_photos p where p.observation_id = o.id and p.kind = 'closure' and not p.withdrawn) as closure_keys,
                  (select c.comment from closures c where c.observation_id = o.id order by c.attempt desc limit 1) as closure_comment
             from observations o join sites s on s.id = o.site_id left join areas a on a.id = o.area_id left join contractors ct on ct.id = o.contractor_id
             left join users ow on ow.id = o.owner_id join users rb on rb.id = o.raised_by left join users cb on cb.id = o.closed_by left join rounds r on r.id = o.round_id
            where o.org_id = $1 and ($2::uuid is null or o.site_id = $2::uuid) and o.raised_at >= $3::date and o.raised_at < ($4::date + 1)
            order by o.raised_at limit 50000""",
        [u.org_id, f.site_id, frm, to],
    )
    exp = int(time.time()) + 7 * 86400  # photo links in the export stay valid for 7 days

    def link(keys: str | None) -> str:
        return " | ".join(f"{config.public_url}/files/{k}?e={exp}&s={sign_file(k, exp)}" for k in (keys or "").split() if k)

    head = [
        "Observation ID", "Site code", "Site", "Area", "Location", "Round", "Observed at", "Raised at", "Raised by", "Raised by employee ID", "Type", "Category", "Item",
        "Hazard", "Work activity", "Life-Saving Rule", "Permit type", "Permit no", "Equipment", "Person observed", "Contractor", "Crew size", "Severity", "Likelihood",
        "Risk score", "Risk level", "Work stopped", "Description", "Immediate action", "Root cause", "Corrective action", "Control level", "Action owner", "Due date",
        "Original due date", "Status", "Repeat", "Closure submitted at", "Closure comment", "Closed at", "Closed by", "Days to close", "Legal reference", "Evidence photos", "Closure photos",
    ]
    lines = [",".join(csv_cell(h) for h in head)]
    for o in rows:
        days = round((o["closed_at"] - o["raised_at"]).total_seconds() / 86400, 1) if o["closed_at"] else ""
        lines.append(",".join(csv_cell(v) for v in [
            o["code"], o["site_code"], o["site_name"], o["area_name"], o["location"], o["round_code"], o["observed_at"], o["raised_at"], o["raised_by_name"], o["raised_by_emp"],
            TYPE_LABEL.get(o["obs_type"], o["obs_type"]), o["category"], o["item"], o["hazard"], o["activity"], o["lsr"], o["permit_type"], o["permit_no"], o["equipment"],
            o["person_observed"], o["contractor_name"], o["crew_size"], o["severity"], o["likelihood"], o["risk_score"], o["risk_level"], "Yes" if o["work_stopped"] else "No",
            o["description"], o["immediate_action"], o["root_cause"], o["corrective_action"], o["control_level"], o["owner_name"], o["due_at"], o["original_due_at"], o["status"],
            "Yes" if o["repeat_of"] else "No", o["closure_submitted_at"], o["closure_comment"], o["closed_at"], o["closed_by_name"], days, o["legal_ref"],
            link(o["evidence_keys"]), link(o["closure_keys"]),
        ]))
    await audit("export.observations", org_id=u.org_id, actor_id=u.id, entity="observation", ip=client_ip(request),
                details={"siteId": f.site_id, "from": frm.isoformat(), "to": to.isoformat(), "rows": len(rows)})
    return Response(
        content="﻿" + "\r\n".join(lines),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="safeworks-observations-{frm}-to-{to}.csv"'},
    )


@router.get("/api/admin/roles")
async def roles(u: AuthUser = Depends(admin)):
    return JSON({"roles": [{"role": r, "label": ROLE_LABEL[r], "scope": ROLE_SCOPE[r]} for r in ROLES]})


@router.get("/api/admin/kpis")
async def company_kpis(request: Request, u: AuthUser = Depends(admin)):
    frm, to = period(query(request))
    return JSON(await kpis("o.org_id = $1", [u.org_id], frm, to))
