"""Observation points: raise, list, view, edit, assign, close, approve, reject, cancel, reopen, extend."""
from __future__ import annotations

import re
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

import asyncpg
from pydantic import AwareDatetime, Field, field_validator

from . import db
from .audit import audit
from .errors import bad_request, conflict, forbidden, not_found
from .notify import company_admins, notify, site_safety_officers
from .rbac import AuthUser, can_manage, can_raise, can_view_whole_site, is_admin
from .security import signed_file_url
from .settings import get_org, risk_of
from .upload import UploadedImage, discard_photos, store_photos
from .validation import In, Str, parse

OBS_TYPES = ("unsafe_act", "unsafe_condition", "near_miss", "safe_behaviour")
ObsType = Literal["unsafe_act", "unsafe_condition", "near_miss", "safe_behaviour"]
TYPE_LABEL = {"unsafe_act": "Unsafe act", "unsafe_condition": "Unsafe condition", "near_miss": "Near miss", "safe_behaviour": "Safe behaviour"}
Level15 = Field(default=None, ge=1, le=5)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------------------------
# Input models
# ---------------------------------------------------------------------------------------------


class CreateIn(In):
    id: str
    site_id: str
    round_id: str | None = None
    area_id: str | None = None
    location: Str(200) = ""
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    observed_at: AwareDatetime | None = None
    type: ObsType
    category_code: Str(80) = ""
    item_code: Str(80) = ""
    item_other: Str(300) = ""
    hazard: Str(100) = ""
    activity: Str(160) = ""
    lsr: Str(160) = ""
    permit_type: Str(80) = ""
    permit_no: Str(60) = ""
    equipment: Str(120) = ""
    person_observed: Str(160) = ""
    contractor_id: str | None = None
    crew_size: int | None = Field(default=None, ge=0, le=5000)
    severity: int | None = Level15
    likelihood: int | None = Level15
    work_stopped: bool = False
    description: Str(4000) = ""
    immediate_action: Str(200) = ""
    root_cause: Str(200) = ""
    corrective_action: Str(2000) = ""
    control_level: Str(40) = ""
    corrected_on_spot: bool = False
    owner_id: str | None = None
    due_at: AwareDatetime | None = None
    legal_ref: Str(600) = ""

    @field_validator("id", "site_id", "round_id", "area_id", "contractor_id", "owner_id")
    @classmethod
    def _uuid(cls, v: str | None) -> str | None:
        return check_uuid(v)

    @field_validator("description")
    @classmethod
    def _desc(cls, v: str) -> str:
        if len(v) < 3:
            raise ValueError("Describe what was observed.")
        return v


UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def check_uuid(v: str | None) -> str | None:
    if v is None or v == "":
        return None
    if not UUID_RE.match(v):
        raise ValueError("Invalid ID")
    return v.lower()


class EditIn(In):
    area_id: str | None = None
    location: Str(200) | None = None
    category_code: Str(80) | None = None
    item_code: Str(80) | None = None
    item_other: Str(300) | None = None
    hazard: Str(100) | None = None
    activity: Str(160) | None = None
    lsr: Str(160) | None = None
    permit_type: Str(80) | None = None
    permit_no: Str(60) | None = None
    equipment: Str(120) | None = None
    person_observed: Str(160) | None = None
    contractor_id: str | None = None
    crew_size: int | None = Field(default=None, ge=0, le=5000)
    severity: int | None = Level15
    likelihood: int | None = Level15
    work_stopped: bool | None = None
    description: Str(4000, 3) | None = None
    immediate_action: Str(200) | None = None
    root_cause: Str(200) | None = None
    corrective_action: Str(2000) | None = None
    control_level: Str(40) | None = None
    owner_id: str | None = None
    legal_ref: Str(600) | None = None
    reason: Str(500) = ""

    @field_validator("area_id", "contractor_id", "owner_id")
    @classmethod
    def _uuid(cls, v: str | None) -> str | None:
        return check_uuid(v)


class ClosureIn(In):
    comment: Str(2000) = ""
    completed_on: date | None = None
    control_level: Str(40) = ""

    @field_validator("comment")
    @classmethod
    def _c(cls, v: str) -> str:
        if len(v) < 3:
            raise ValueError("A closure comment is required.")
        return v


class DecisionIn(In):
    decision: Literal["approve", "reject"]
    remarks: Str(1000) = ""
    onsite_verified: bool = False


class ReasonIn(In):
    reason: Str(1000) = ""

    @field_validator("reason")
    @classmethod
    def _r(cls, v: str) -> str:
        if len(v) < 3:
            raise ValueError("A reason is required.")
        return v


class ExtendIn(ReasonIn):
    due_at: AwareDatetime


class CommentIn(In):
    body: Str(2000, 1)


# ---------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------


async def _next_number(conn, scope: str) -> int:
    row = await db.one(
        """insert into code_counters (scope, next_no) values ($1, 2)
           on conflict (scope) do update set next_no = code_counters.next_no + 1
           returning next_no - 1 as n""",
        [scope],
        conn,
    )
    return row["n"]


async def next_observation_code(conn, site_code: str) -> str:
    year = db.local_date()[:4]
    n = await _next_number(conn, f"obs:{site_code}:{year}")
    return f"OBS-{site_code}-{year}-{n:05d}"


async def next_round_code(conn, site_code: str) -> str:
    ymd = db.local_date().replace("-", "")
    n = await _next_number(conn, f"rnd:{site_code}:{ymd}")
    return f"RND-{site_code}-{ymd}-{n:02d}"


async def master_label(conn, org_id: str, lst: str, code: str) -> str | None:
    if not code:
        return None
    row = await db.one(
        """select label from master_items where list = $1 and code = $2 and (org_id = $3 or org_id is null)
           order by org_id nulls last limit 1""",
        [lst, code, org_id],
        conn,
    )
    return row["label"] if row else None


async def is_valid_owner(conn, site_id: str, user_id: str) -> bool:
    row = await db.one(
        """select 1 as ok from memberships m join users u on u.id = m.user_id
            where m.user_id = $1 and u.active and m.site_id = $2 and m.role in ('supervisor','safety_officer') limit 1""",
        [user_id, site_id],
        conn,
    )
    return row is not None


def _jsonable(v: Any) -> Any:
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def snapshot_of(row: dict) -> dict:
    return {k: _jsonable(v) for k, v in row.items() if k not in ("version", "updated_at")}


async def add_version(conn, obs_id: str, version: int, actor_id: str, action: str, changes: dict | None = None, reason: str = "", snapshot: dict | None = None) -> None:
    await db.execute(
        "insert into observation_versions (observation_id, version, actor_id, action, changes, reason, snapshot) values ($1,$2,$3,$4,$5,$6,$7)",
        [obs_id, version, actor_id, action, changes or {}, reason, snapshot],
        conn,
    )


def _iso(v: Any) -> Any:
    return v.isoformat() if isinstance(v, (datetime, date)) else v


# ---------------------------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------------------------


async def create_observation(u: AuthUser, raw: Any, evidence: list[UploadedImage], after: list[UploadedImage], ip: str) -> tuple[str, bool]:
    inp = parse(CreateIn, raw)

    # Idempotent retry from the phone's offline queue: the same ID from the same user returns the saved point.
    existing = await db.one("select raised_by from observations where id = $1", [inp.id])
    if existing:
        if existing["raised_by"] == u.id:
            return inp.id, True
        raise conflict("An observation with this ID already exists.")

    if not can_raise(u, inp.site_id):
        raise forbidden("Only the site's safety officers raise observation points.")
    site = await db.one("select id, code, org_id, active, name from sites where id = $1", [inp.site_id])
    if not site or site["org_id"] != u.org_id or not site["active"]:
        raise bad_request("Site not found or inactive.")

    if len(evidence) < 1:
        raise bad_request("Add at least 1 photo (maximum 2).")
    if len(evidence) > 2:
        raise bad_request("A point can have at most 2 photos.")
    if len(after) > 2:
        raise bad_request("At most 2 after-photos.")

    t = inp.type
    needs_action = t != "safe_behaviour" and not inp.corrected_on_spot
    if t in ("unsafe_act", "unsafe_condition"):
        if not inp.category_code:
            raise bad_request("Choose a category.")
        if not inp.item_code:
            raise bad_request("Choose the specific observation.")
        if inp.item_code == "other" and not inp.item_other:
            raise bad_request("Describe the observation for 'Other'.")
    if t == "unsafe_act" and not inp.person_observed:
        raise bad_request("Person observed (trade/role and employer) is required for unsafe acts.")
    if t != "safe_behaviour":
        if not inp.hazard:
            raise bad_request("Choose the hazard type.")
        if not inp.severity or not inp.likelihood:
            raise bad_request("Set severity and likelihood.")
        if not inp.immediate_action:
            raise bad_request("Choose the immediate action taken.")
        if not inp.root_cause:
            raise bad_request("Choose the likely root cause.")
    if needs_action and not inp.corrective_action:
        raise bad_request("Describe the corrective / preventive action.")

    now = now_utc()
    observed_at = inp.observed_at or now
    if observed_at > now + timedelta(minutes=5):
        raise bad_request("Observed time cannot be in the future.")
    if now - observed_at > timedelta(hours=36):
        raise bad_request("Observed time must be today.")

    org = await get_org(u.org_id)
    score, level = (None, None) if t == "safe_behaviour" else risk_of(inp.severity, inp.likelihood, inp.work_stopped)

    category = item = ""
    if inp.category_code:
        lbl = await master_label(None, u.org_id, "category", inp.category_code)
        if not lbl:
            raise bad_request("Unknown category.")
        category = lbl
    if inp.item_code:
        if inp.item_code == "other":
            item = inp.item_other
        else:
            lbl = await master_label(None, u.org_id, "item", inp.item_code)
            if not lbl:
                raise bad_request("Unknown observation item.")
            item = lbl
    if inp.area_id and not await db.one("select 1 as ok from areas where id = $1 and site_id = $2", [inp.area_id, site["id"]]):
        raise bad_request("Area does not belong to this site.")
    if inp.contractor_id and not await db.one("select 1 as ok from contractors where id = $1 and org_id = $2", [inp.contractor_id, u.org_id]):
        raise bad_request("Unknown contractor.")
    if inp.round_id:
        r = await db.one("select site_id, status, observer_id from rounds where id = $1", [inp.round_id])
        if not r or r["site_id"] != site["id"]:
            raise bad_request("Round not found for this site.")
        if r["observer_id"] != u.id and not is_admin(u):
            raise forbidden("This safety walk belongs to another safety officer.")
    owner_id = None
    if needs_action and inp.owner_id:
        if not await is_valid_owner(None, site["id"], inp.owner_id):
            raise bad_request("The action owner must be a supervisor or safety officer of this site.")
        owner_id = inp.owner_id
    due_at = None
    if needs_action:
        if inp.due_at:
            due_at = inp.due_at
            if due_at < now:
                raise bad_request("Due date cannot be in the past.")
        else:
            due_at = now + timedelta(days=org["settings"]["dueDays"].get(level or "Low", 7))

    status = "noted" if t == "safe_behaviour" else "closed" if inp.corrected_on_spot else "open"

    ev = await store_photos(evidence)
    try:
        af = await store_photos(after)
    except Exception:
        await discard_photos(ev)
        raise

    try:
        async with db.tx() as c:
            code = await next_observation_code(c, site["code"])
            repeat_of = None
            if inp.item_code and inp.item_code != "other" and inp.area_id:
                rep = await db.one(
                    """select id from observations where site_id = $1 and item_code = $2 and area_id = $3 and status <> 'cancelled'
                         and raised_at > now() - interval '30 days' order by raised_at desc limit 1""",
                    [site["id"], inp.item_code, inp.area_id],
                    c,
                )
                repeat_of = rep["id"] if rep else None
            row = await db.one(
                """insert into observations (
                     id, org_id, site_id, code, round_id, area_id, location, lat, lng, observed_at, raised_by, raised_at,
                     obs_type, category_code, category, item_code, item, hazard, activity, lsr, permit_type, permit_no, equipment,
                     person_observed, contractor_id, crew_size, severity, likelihood, risk_score, risk_level, work_stopped,
                     description, immediate_action, root_cause, corrective_action, control_level, corrected_on_spot,
                     owner_id, assigned_at, due_at, legal_ref, status, repeat_of, closed_at, closed_by)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),
                     $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
                     $23,$24,$25,$26,$27,$28,$29,$30,
                     $31,$32,$33,$34,$35,$36,
                     $37::uuid, case when $37::uuid is null then null else now() end, $38, $39, $40::text, $41,
                     case when $40::text = 'closed' then now() else null end, case when $40::text = 'closed' then $11::uuid else null end)
                   returning *""",
                [
                    inp.id, u.org_id, site["id"], code, inp.round_id, inp.area_id, inp.location, inp.lat, inp.lng, observed_at, u.id,
                    t, inp.category_code, category, inp.item_code, item, inp.hazard, inp.activity, inp.lsr, inp.permit_type, inp.permit_no, inp.equipment,
                    inp.person_observed, inp.contractor_id, inp.crew_size,
                    None if t == "safe_behaviour" else inp.severity, None if t == "safe_behaviour" else inp.likelihood, score, level, inp.work_stopped,
                    inp.description, inp.immediate_action, inp.root_cause, inp.corrective_action, inp.control_level, inp.corrected_on_spot,
                    owner_id, due_at, inp.legal_ref, status, repeat_of,
                ],
                c,
            )
            for p in ev:
                await db.execute(
                    "insert into observation_photos (observation_id, kind, storage_key, mime, bytes, width, height, uploaded_by) values ($1,'evidence',$2,$3,$4,$5,$6,$7)",
                    [inp.id, p.key, p.mime, p.bytes, p.width, p.height, u.id],
                    c,
                )
            if inp.corrected_on_spot and t != "safe_behaviour":
                cl = await db.one(
                    """insert into closures (observation_id, attempt, comment, completed_on, control_level, submitted_by, decision, decided_by, decided_at, remarks, onsite_verified)
                       values ($1, 1, $2, current_date, $3, $4, 'approved', $4, now(), 'Corrected on the spot', true) returning id""",
                    [inp.id, inp.corrective_action or inp.immediate_action or "Corrected on the spot", inp.control_level, u.id],
                    c,
                )
                for p in af:
                    await db.execute(
                        "insert into observation_photos (observation_id, closure_id, kind, storage_key, mime, bytes, width, height, uploaded_by) values ($1,$2,'closure',$3,$4,$5,$6,$7,$8)",
                        [inp.id, cl["id"], p.key, p.mime, p.bytes, p.width, p.height, u.id],
                        c,
                    )
            await add_version(c, inp.id, 1, u.id, "created_closed_on_spot" if inp.corrected_on_spot else "created", {}, "", snapshot_of(row))
            if owner_id and owner_id != u.id:
                due_txt = due_at.astimezone(db.TZ).strftime("%a %d %b %Y") if due_at else ""
                await notify(c, [owner_id], kind="assigned", observation_id=inp.id,
                             title=f"{code} assigned to you ({level or ''} risk)", body=f"{site['name']}: {item or inp.hazard or TYPE_LABEL[t]}. Due {due_txt}.")
            if level == "Critical" and status == "open":
                sos = [x for x in await site_safety_officers(c, site["id"]) if x != u.id]
                await notify(c, sos, kind="critical", observation_id=inp.id, title=f"Critical observation {code}", body=f"{site['name']}: {inp.description[:200]}")
    except asyncpg.UniqueViolationError as e:
        await discard_photos(ev + af)
        if "observations_pkey" in str(e.constraint_name or ""):
            return inp.id, True
        raise
    except Exception:
        await discard_photos(ev + af)
        raise
    if inp.corrected_on_spot:
        await audit("observation.closed_on_spot", org_id=u.org_id, actor_id=u.id, entity="observation", entity_id=inp.id, ip=ip)
    return inp.id, False


# ---------------------------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------------------------


def can_see(u: AuthUser, obs: dict, closure_submitters: list[str] | None = None) -> bool:
    if can_view_whole_site(u, obs["site_id"]):
        return True
    if obs.get("owner_id") == u.id or obs.get("raised_by") == u.id:
        return True
    return u.id in (closure_submitters or [])


LIST_SELECT = """
  o.id, o.code, o.obs_type, o.category, o.item, o.hazard, o.risk_level, o.status, o.due_at, o.raised_at, o.closed_at,
  o.closure_submitted_at, o.description, o.repeat_of is not null as is_repeat, o.work_stopped, o.lsr,
  s.id as site_id, s.code as site_code, s.name as site_name, a.name as area_name, o.location,
  ow.name as owner_name, rb.name as raised_by_name, ct.name as contractor_name,
  (o.status in ('open','in_progress') and o.due_at < now()) as overdue,
  (select p.storage_key from observation_photos p where p.observation_id = o.id and p.kind = 'evidence' and not p.withdrawn order by p.uploaded_at limit 1) as thumb_key"""


def list_item(r: dict) -> dict:
    return {
        "id": r["id"], "code": r["code"], "type": r["obs_type"], "typeLabel": TYPE_LABEL.get(r["obs_type"], r["obs_type"]),
        "category": r["category"], "item": r["item"], "hazard": r["hazard"], "riskLevel": r["risk_level"], "status": r["status"],
        "overdue": bool(r["overdue"]), "dueAt": r["due_at"], "raisedAt": r["raised_at"], "closedAt": r["closed_at"],
        "closureSubmittedAt": r["closure_submitted_at"], "description": r["description"], "isRepeat": bool(r["is_repeat"]),
        "workStopped": r["work_stopped"], "lsr": r["lsr"], "site": {"id": r["site_id"], "code": r["site_code"], "name": r["site_name"]},
        "area": r["area_name"], "location": r["location"], "ownerName": r["owner_name"], "raisedByName": r["raised_by_name"],
        "contractorName": r["contractor_name"], "thumbUrl": signed_file_url(r["thumb_key"]) if r["thumb_key"] else None,
    }


class ListIn(In):
    site_id: str | None = None
    scope: Literal["all", "assigned", "raised", "approvals"] = "all"
    status: Literal["any", "open", "overdue", "awaiting", "closed", "cancelled", "noted", "active"] = "any"
    type: ObsType | None = None
    risk: Literal["Low", "Medium", "High", "Critical"] | None = None
    round_id: str | None = None
    q: Str(100) | None = None
    from_: date | None = Field(default=None, alias="from")
    to: date | None = None
    raised_today: Literal["1", "0", "true", "false"] | None = None
    page: int = Field(default=1, ge=1, le=10_000)
    page_size: int = Field(default=50, ge=1, le=200)

    @field_validator("site_id", "round_id")
    @classmethod
    def _uuid(cls, v: str | None) -> str | None:
        return check_uuid(v)


_active_sites: dict[str, tuple[float, list[str]]] = {}
SITE_CACHE_SECONDS = 15


async def active_site_ids(org_id: str) -> list[str]:
    """Active sites of the company, cached briefly per process (asked on every list and dashboard)."""
    hit = _active_sites.get(org_id)
    if hit and time.monotonic() - hit[0] < SITE_CACHE_SECONDS:
        return hit[1]
    ids = [r["id"] for r in await db.q("select id from sites where org_id = $1 and active", [org_id])]
    _active_sites[org_id] = (time.monotonic(), ids)
    return ids


def clear_site_cache() -> None:
    _active_sites.clear()


async def full_site_ids(u: AuthUser) -> list[str]:
    return [s for s in await active_site_ids(u.org_id) if can_view_whole_site(u, s)]


async def list_observations(u: AuthUser, raw: Any) -> dict:
    f = parse(ListIn, raw)
    where = ["o.org_id = $1"]
    params: list[Any] = [u.org_id]

    def p(v: Any) -> str:
        params.append(v)
        return f"${len(params)}"

    full = await full_site_ids(u)
    a, b = p(full), p(u.id)
    where.append(f"(o.site_id = any({a}::uuid[]) or o.owner_id = {b}::uuid or o.raised_by = {b}::uuid)")
    if f.site_id:
        where.append(f"o.site_id = {p(f.site_id)}::uuid")
    if f.scope == "assigned":
        where.append(f"o.owner_id = {p(u.id)}::uuid")
    if f.scope == "raised":
        where.append(f"o.raised_by = {p(u.id)}::uuid")
    if f.scope == "approvals":
        manageable = [s for s in full if can_manage(u, s)]
        where.append(f"o.site_id = any({p(manageable)}::uuid[]) and o.status = 'closure_submitted'")
        where.append(f"not exists (select 1 from closures c where c.observation_id = o.id and c.decision = 'pending' and c.submitted_by = {p(u.id)}::uuid)")
    status_sql = {
        "open": "o.status in ('open','in_progress')",
        "overdue": "o.status in ('open','in_progress') and o.due_at < now()",
        "awaiting": "o.status = 'closure_submitted'",
        "closed": "o.status = 'closed'",
        "cancelled": "o.status = 'cancelled'",
        "noted": "o.status = 'noted'",
        "active": "o.status in ('open','in_progress','closure_submitted')",
    }
    where.append(status_sql.get(f.status, "o.status <> 'cancelled'"))
    if f.type:
        where.append(f"o.obs_type = {p(f.type)}")
    if f.risk:
        where.append(f"o.risk_level = {p(f.risk)}")
    if f.round_id:
        where.append(f"o.round_id = {p(f.round_id)}::uuid")
    if f.q:
        like = "%" + re.sub(r"([%_\\])", r"\\\1", f.q) + "%"
        x = p(like)
        where.append(f"(o.code ilike {x} or o.description ilike {x} or o.item ilike {x} or o.location ilike {x})")
    if f.from_:
        where.append(f"o.raised_at >= {p(f.from_)}::date")
    if f.to:
        where.append(f"o.raised_at < ({p(f.to)}::date + 1)")
    if f.raised_today in ("1", "true"):
        where.append("o.raised_at >= date_trunc('day', now())")

    order = "o.raised_at desc"
    if f.status in ("open", "overdue", "active"):
        order = "o.due_at asc nulls last, o.raised_at"
    if f.status == "closed":
        order = "o.closed_at desc"
    if f.scope == "approvals" or f.status == "awaiting":
        order = "o.closure_submitted_at asc"

    w = " and ".join(where)
    offset = (f.page - 1) * f.page_size
    rows = await db.q(
        f"""select {LIST_SELECT}
              from observations o join sites s on s.id = o.site_id
              left join areas a on a.id = o.area_id left join users ow on ow.id = o.owner_id
              join users rb on rb.id = o.raised_by left join contractors ct on ct.id = o.contractor_id
             where {w} order by {order} limit {f.page_size} offset {offset}""",
        params,
    )
    total = await db.one(f"select count(*)::int as n from observations o where {w}", params)
    return {"items": [list_item(r) for r in rows], "total": total["n"] if total else 0, "page": f.page, "pageSize": f.page_size}


async def get_observation(u: AuthUser, obs_id: str) -> dict:
    if not UUID_RE.match(obs_id or ""):
        raise not_found("Observation not found.")
    o = await db.one(
        """select o.*, s.code as site_code, s.name as site_name, s.state as site_state, a.name as area_name,
                  ct.name as contractor_name, ow.name as owner_name, ow.designation as owner_designation,
                  rb.name as raised_by_name, rb.designation as raised_by_designation, rb.employee_id as raised_by_employee_id,
                  cb.name as closed_by_name, r.code as round_code, rep.code as repeat_of_code,
                  (o.status in ('open','in_progress') and o.due_at < now()) as overdue
             from observations o join sites s on s.id = o.site_id
             left join areas a on a.id = o.area_id left join contractors ct on ct.id = o.contractor_id
             left join users ow on ow.id = o.owner_id join users rb on rb.id = o.raised_by
             left join users cb on cb.id = o.closed_by left join rounds r on r.id = o.round_id
             left join observations rep on rep.id = o.repeat_of
            where o.id = $1 and o.org_id = $2""",
        [obs_id, u.org_id],
    )
    if not o:
        raise not_found("Observation not found.")
    photos = await db.q(
        "select id, closure_id, kind, storage_key, width, height, uploaded_at, withdrawn, withdrawn_reason, uploaded_by from observation_photos where observation_id = $1 order by uploaded_at",
        [obs_id],
    )
    closures = await db.q(
        """select c.*, su.name as submitted_by_name, du.name as decided_by_name
             from closures c join users su on su.id = c.submitted_by left join users du on du.id = c.decided_by
            where c.observation_id = $1 order by c.attempt""",
        [obs_id],
    )
    versions = await db.q(
        """select v.id, v.version, v.at, v.action, v.changes, v.reason, u.name as actor_name
             from observation_versions v left join users u on u.id = v.actor_id where v.observation_id = $1 order by v.id""",
        [obs_id],
    )
    comments = await db.q(
        "select c.id, c.body, c.created_at, u.name as user_name, u.id as user_id from comments c join users u on u.id = c.user_id where c.observation_id = $1 order by c.created_at",
        [obs_id],
    )
    submitters = [c["submitted_by"] for c in closures]
    if not can_see(u, o, submitters):
        raise forbidden("You can only open observations of your site or assigned to you.")

    manage = can_manage(u, o["site_id"])
    pending = next((c for c in closures if c["decision"] == "pending"), None)
    is_owner = o["owner_id"] == u.id
    active = o["status"] in ("open", "in_progress")
    return {
        "id": o["id"], "code": o["code"], "type": o["obs_type"], "typeLabel": TYPE_LABEL.get(o["obs_type"], o["obs_type"]),
        "status": o["status"], "overdue": bool(o["overdue"]),
        "site": {"id": o["site_id"], "code": o["site_code"], "name": o["site_name"], "state": o["site_state"]},
        "round": {"id": o["round_id"], "code": o["round_code"]} if o["round_id"] else None,
        "areaId": o["area_id"], "area": o["area_name"], "location": o["location"], "lat": o["lat"], "lng": o["lng"],
        "observedAt": o["observed_at"], "raisedAt": o["raised_at"],
        "raisedBy": {"id": o["raised_by"], "name": o["raised_by_name"], "designation": o["raised_by_designation"], "employeeId": o["raised_by_employee_id"]},
        "categoryCode": o["category_code"], "category": o["category"], "itemCode": o["item_code"], "item": o["item"], "hazard": o["hazard"],
        "activity": o["activity"], "lsr": o["lsr"], "permitType": o["permit_type"], "permitNo": o["permit_no"], "equipment": o["equipment"],
        "personObserved": o["person_observed"], "contractorId": o["contractor_id"], "contractorName": o["contractor_name"], "crewSize": o["crew_size"],
        "severity": o["severity"], "likelihood": o["likelihood"], "riskScore": o["risk_score"], "riskLevel": o["risk_level"], "workStopped": o["work_stopped"],
        "description": o["description"], "immediateAction": o["immediate_action"], "rootCause": o["root_cause"], "correctiveAction": o["corrective_action"],
        "controlLevel": o["control_level"], "correctedOnSpot": o["corrected_on_spot"],
        "owner": {"id": o["owner_id"], "name": o["owner_name"], "designation": o["owner_designation"]} if o["owner_id"] else None,
        "assignedAt": o["assigned_at"], "dueAt": o["due_at"], "originalDueAt": o["original_due_at"], "legalRef": o["legal_ref"],
        "repeatOf": {"id": o["repeat_of"], "code": o["repeat_of_code"]} if o["repeat_of"] else None,
        "closureSubmittedAt": o["closure_submitted_at"], "closedAt": o["closed_at"], "closedBy": o["closed_by_name"], "cancelReason": o["cancel_reason"],
        "version": o["version"],
        "photos": [
            {"id": p["id"], "kind": p["kind"], "closureId": p["closure_id"], "url": signed_file_url(p["storage_key"]), "width": p["width"],
             "height": p["height"], "uploadedAt": p["uploaded_at"], "withdrawn": p["withdrawn"], "withdrawnReason": p["withdrawn_reason"]}
            for p in photos
        ],
        "closures": [
            {"id": c["id"], "attempt": c["attempt"], "comment": c["comment"], "completedOn": c["completed_on"], "controlLevel": c["control_level"],
             "submittedBy": c["submitted_by_name"], "submittedById": c["submitted_by"], "submittedAt": c["submitted_at"], "decision": c["decision"],
             "decidedBy": c["decided_by_name"], "decidedAt": c["decided_at"], "remarks": c["remarks"], "onsiteVerified": c["onsite_verified"]}
            for c in closures
        ],
        "timeline": [
            {"id": v["id"], "version": v["version"], "at": v["at"], "action": v["action"], "changes": v["changes"], "reason": v["reason"], "actor": v["actor_name"]}
            for v in versions
        ],
        "comments": [{"id": c["id"], "body": c["body"], "at": c["created_at"], "user": c["user_name"], "userId": c["user_id"]} for c in comments],
        "can": {
            "edit": manage and active,
            "assign": manage and active,
            "extend": manage and active,
            "start": is_owner and o["status"] == "open",
            "submitClosure": active and (is_owner or manage),
            "decide": o["status"] == "closure_submitted" and manage and pending is not None and pending["submitted_by"] != u.id,
            "cancel": manage and o["status"] in ("open", "in_progress", "closure_submitted", "noted"),
            "reopen": manage and o["status"] == "closed",
            "comment": True,
            "withdrawPhoto": manage and o["status"] not in ("closed", "cancelled"),
        },
    }


# ---------------------------------------------------------------------------------------------
# Changes
# ---------------------------------------------------------------------------------------------


async def lock_obs(c, u: AuthUser, obs_id: str) -> dict:
    if not UUID_RE.match(obs_id or ""):
        raise not_found("Observation not found.")
    o = await db.one(
        "select o.*, s.name as site_name from observations o join sites s on s.id = o.site_id where o.id = $1 and o.org_id = $2 for update of o",
        [obs_id, u.org_id],
        c,
    )
    if not o:
        raise not_found("Observation not found.")
    return o


async def bump(c, o: dict, sets: dict[str, Any], actor_id: str, action: str, reason: str = "", changes: dict | None = None) -> dict:
    cols = list(sets.keys())
    ch: dict[str, Any] = changes if changes is not None else {}
    if changes is None:
        for k in cols:
            if str(o.get(k) if o.get(k) is not None else "") != str(sets[k] if sets[k] is not None else ""):
                ch[k] = [_iso(o.get(k)), _iso(sets[k])]
    assign = ", ".join(f"{k} = ${i + 2}" for i, k in enumerate(cols))
    row = await db.one(
        f"update observations set {assign}{', ' if cols else ''}version = version + 1, updated_at = now() where id = $1 returning *",
        [o["id"], *[sets[k] for k in cols]],
        c,
    )
    await add_version(c, o["id"], row["version"], actor_id, action, ch, reason, snapshot_of(row))
    return row


EDIT_COLS = {
    "area_id": "area_id", "location": "location", "hazard": "hazard", "activity": "activity", "lsr": "lsr", "permit_type": "permit_type",
    "permit_no": "permit_no", "equipment": "equipment", "person_observed": "person_observed", "contractor_id": "contractor_id", "crew_size": "crew_size",
    "severity": "severity", "likelihood": "likelihood", "work_stopped": "work_stopped", "description": "description",
    "immediate_action": "immediate_action", "root_cause": "root_cause", "corrective_action": "corrective_action",
    "control_level": "control_level", "legal_ref": "legal_ref",
}


async def edit_observation(u: AuthUser, obs_id: str, raw: Any) -> None:
    inp = parse(EditIn, raw)
    given = inp.model_fields_set  # only the fields the client actually sent
    async with db.tx() as c:
        o = await lock_obs(c, u, obs_id)
        if not can_manage(u, o["site_id"]):
            raise forbidden("Only the site's safety officers can edit observations.")
        if o["status"] not in ("open", "in_progress", "closure_submitted", "noted"):
            raise bad_request("Closed or cancelled observations cannot be edited; reopen first.")
        sets: dict[str, Any] = {}
        for field, col in EDIT_COLS.items():
            if field in given:
                v = getattr(inp, field)
                if v is None and col not in ("area_id", "contractor_id", "crew_size", "severity", "likelihood"):
                    continue
                sets[col] = v
        if inp.area_id and not await db.one("select 1 as ok from areas where id = $1 and site_id = $2", [inp.area_id, o["site_id"]], c):
            raise bad_request("Area does not belong to this site.")
        if inp.contractor_id and not await db.one("select 1 as ok from contractors where id = $1 and org_id = $2", [inp.contractor_id, u.org_id], c):
            raise bad_request("Unknown contractor.")
        if "category_code" in given and inp.category_code is not None:
            lbl = await master_label(c, u.org_id, "category", inp.category_code) if inp.category_code else ""
            if lbl is None:
                raise bad_request("Unknown category.")
            sets["category_code"] = inp.category_code
            sets["category"] = lbl
        if "item_code" in given and inp.item_code is not None:
            lbl: str | None = ""
            if inp.item_code == "other":
                lbl = inp.item_other if inp.item_other is not None else o["item"]
            elif inp.item_code:
                lbl = await master_label(c, u.org_id, "item", inp.item_code)
            if lbl is None:
                raise bad_request("Unknown observation item.")
            sets["item_code"] = inp.item_code
            sets["item"] = lbl
        if o["obs_type"] != "safe_behaviour" and any(k in sets for k in ("severity", "likelihood", "work_stopped")):
            sev = sets.get("severity", o["severity"])
            lik = sets.get("likelihood", o["likelihood"])
            ws = sets.get("work_stopped", o["work_stopped"])
            score, level = risk_of(sev, lik, bool(ws))
            sets["risk_score"] = score
            sets["risk_level"] = level
        notify_owner = None
        if "owner_id" in given and inp.owner_id != o["owner_id"]:
            if o["obs_type"] == "safe_behaviour":
                raise bad_request("Safe-behaviour points have no action owner.")
            if inp.owner_id and not await is_valid_owner(c, o["site_id"], inp.owner_id):
                raise bad_request("The action owner must be a supervisor or safety officer of this site.")
            sets["owner_id"] = inp.owner_id
            sets["assigned_at"] = now_utc() if inp.owner_id else None
            notify_owner = inp.owner_id
        # Keep only fields that actually changed.
        for k in list(sets.keys()):
            if k != "assigned_at" and str(o.get(k) if o.get(k) is not None else "") == str(sets[k] if sets[k] is not None else ""):
                sets.pop(k)
        if not sets or list(sets.keys()) == ["assigned_at"]:
            return
        action = "assigned" if set(sets.keys()) == {"owner_id", "assigned_at"} else "edited"
        await bump(c, o, sets, u.id, action, inp.reason)
        if notify_owner and notify_owner != u.id:
            due = o["due_at"].astimezone(db.TZ).strftime("%a %d %b %Y") if o["due_at"] else "—"
            await notify(c, [notify_owner], kind="assigned", observation_id=o["id"], title=f"{o['code']} assigned to you",
                         body=f"{o['site_name']}: {o['item'] or o['hazard']}. Due {due}.")


async def start_work(u: AuthUser, obs_id: str) -> None:
    async with db.tx() as c:
        o = await lock_obs(c, u, obs_id)
        if o["owner_id"] != u.id:
            raise forbidden("Only the action owner can start work on this point.")
        if o["status"] != "open":
            raise bad_request("Work can only be started on an open point.")
        await bump(c, o, {"status": "in_progress"}, u.id, "started")


async def submit_closure(u: AuthUser, obs_id: str, raw: Any, photos: list[UploadedImage]) -> None:
    inp = parse(ClosureIn, raw)
    if len(photos) > 2:
        raise bad_request("At most 2 closure photos.")
    today = db.local_date()
    completed_on = inp.completed_on.isoformat() if inp.completed_on else today
    if completed_on > today:
        raise bad_request("Completion date cannot be in the future.")
    stored = await store_photos(photos)
    try:
        async with db.tx() as c:
            o = await lock_obs(c, u, obs_id)
            manage = can_manage(u, o["site_id"])
            if o["owner_id"] != u.id and not manage:
                raise forbidden("Only the action owner or the site safety officer can submit the closure.")
            if o["status"] not in ("open", "in_progress"):
                raise bad_request("This point is not open for closure.")
            att = await db.one("select coalesce(max(attempt), 0) + 1 as n from closures where observation_id = $1", [obs_id], c)
            cl = await db.one(
                "insert into closures (observation_id, attempt, comment, completed_on, control_level, submitted_by) values ($1,$2,$3,$4,$5,$6) returning id",
                [obs_id, att["n"], inp.comment, db.to_date(completed_on), inp.control_level, u.id],
                c,
            )
            for p in stored:
                await db.execute(
                    "insert into observation_photos (observation_id, closure_id, kind, storage_key, mime, bytes, width, height, uploaded_by) values ($1,$2,'closure',$3,$4,$5,$6,$7,$8)",
                    [obs_id, cl["id"], p.key, p.mime, p.bytes, p.width, p.height, u.id],
                    c,
                )
            await bump(c, o, {"status": "closure_submitted", "closure_submitted_at": now_utc()}, u.id, "closure_submitted", "",
                       {"status": [o["status"], "closure_submitted"], "closure_attempt": [None, att["n"]]})
            approvers = [x for x in await site_safety_officers(c, o["site_id"]) if x != u.id]
            if not approvers:
                approvers = [x for x in await company_admins(c, o["org_id"]) if x != u.id]
            await notify(c, approvers, kind="closure_submitted", observation_id=obs_id, title=f"Closure submitted for {o['code']}", body=f"{u.name}: {inp.comment[:300]}")
    except Exception:
        await discard_photos(stored)
        raise


async def decide_closure(u: AuthUser, obs_id: str, raw: Any) -> None:
    inp = parse(DecisionIn, raw)
    if inp.decision == "reject" and len(inp.remarks) < 3:
        raise bad_request("Give a reason for rejecting the closure.")
    async with db.tx() as c:
        o = await lock_obs(c, u, obs_id)
        if not can_manage(u, o["site_id"]):
            raise forbidden("Only the site's safety officer can approve or reject a closure.")
        if o["status"] != "closure_submitted":
            last = await db.one(
                "select c.decision, u.name from closures c left join users u on u.id = c.decided_by where c.observation_id = $1 order by c.attempt desc limit 1",
                [obs_id],
                c,
            )
            if last and last["decision"] != "pending":
                raise conflict(f"This closure was already {last['decision']} by {last['name'] or 'another user'}.")
            raise bad_request("There is no closure waiting for approval.")
        pending = await db.one("select * from closures where observation_id = $1 and decision = 'pending' order by attempt desc limit 1", [obs_id], c)
        if not pending:
            raise bad_request("There is no closure waiting for approval.")
        if pending["submitted_by"] == u.id:
            raise forbidden("You cannot approve a closure you submitted yourself; another safety officer or an admin must approve it.")
        await db.execute(
            "update closures set decision = $2, decided_by = $3, decided_at = now(), remarks = $4, onsite_verified = $5 where id = $1",
            [pending["id"], "approved" if inp.decision == "approve" else "rejected", u.id, inp.remarks, inp.onsite_verified],
            c,
        )
        targets = [x for x in (pending["submitted_by"], o["owner_id"]) if x and x != u.id]
        if inp.decision == "approve":
            await bump(c, o, {"status": "closed", "closed_at": now_utc(), "closed_by": u.id}, u.id, "approved", inp.remarks, {"status": [o["status"], "closed"]})
            await notify(c, targets, kind="approved", observation_id=obs_id, title=f"{o['code']} closed",
                         body=f"Closure approved by {u.name}.{(' ' + inp.remarks) if inp.remarks else ''}")
        else:
            await bump(c, o, {"status": "in_progress"}, u.id, "rejected", inp.remarks, {"status": [o["status"], "in_progress"]})
            await notify(c, targets, kind="rejected", observation_id=obs_id, title=f"Closure rejected for {o['code']}", body=f"{u.name}: {inp.remarks}")


async def cancel_observation(u: AuthUser, obs_id: str, raw: Any) -> None:
    reason = parse(ReasonIn, raw).reason
    async with db.tx() as c:
        o = await lock_obs(c, u, obs_id)
        if not can_manage(u, o["site_id"]):
            raise forbidden("Only the site's safety officer can cancel an observation.")
        if o["status"] in ("closed", "cancelled"):
            raise bad_request("This observation cannot be cancelled.")
        await db.execute(
            "update closures set decision = 'rejected', decided_by = $2, decided_at = now(), remarks = 'Observation cancelled' where observation_id = $1 and decision = 'pending'",
            [obs_id, u.id],
            c,
        )
        await bump(c, o, {"status": "cancelled", "cancel_reason": reason}, u.id, "cancelled", reason)


async def reopen_observation(u: AuthUser, obs_id: str, raw: Any) -> None:
    reason = parse(ReasonIn, raw).reason
    async with db.tx() as c:
        o = await lock_obs(c, u, obs_id)
        if not can_manage(u, o["site_id"]):
            raise forbidden("Only the site's safety officer can reopen an observation.")
        if o["status"] != "closed":
            raise bad_request("Only closed observations can be reopened.")
        await bump(c, o, {"status": "in_progress" if o["owner_id"] else "open", "closed_at": None, "closed_by": None}, u.id, "reopened", reason)
        if o["owner_id"] and o["owner_id"] != u.id:
            await notify(c, [o["owner_id"]], kind="reopened", observation_id=obs_id, title=f"{o['code']} reopened", body=reason)


async def extend_due(u: AuthUser, obs_id: str, raw: Any) -> None:
    inp = parse(ExtendIn, raw)
    async with db.tx() as c:
        o = await lock_obs(c, u, obs_id)
        if not can_manage(u, o["site_id"]):
            raise forbidden("Only the site's safety officer can extend a due date.")
        if o["status"] not in ("open", "in_progress"):
            raise bad_request("Only open points can have their due date extended.")
        nd = inp.due_at
        if o["due_at"] and nd <= o["due_at"]:
            raise bad_request("The new due date must be later than the current one.")
        await bump(c, o, {"due_at": nd, "original_due_at": o["original_due_at"] or o["due_at"]}, u.id, "due_extended", inp.reason,
                   {"due_at": [_iso(o["due_at"]), nd.isoformat()]})
        if o["owner_id"] and o["owner_id"] != u.id:
            await notify(c, [o["owner_id"]], kind="due_extended", observation_id=obs_id, title=f"{o['code']}: due date extended",
                         body=f"New due date {nd.astimezone(db.TZ).strftime('%a %d %b %Y')}. {inp.reason}")


async def add_comment(u: AuthUser, obs_id: str, raw: Any) -> None:
    body = parse(CommentIn, raw).body
    if not UUID_RE.match(obs_id or ""):
        raise not_found()
    o = await db.one("select id, site_id, owner_id, raised_by, code from observations where id = $1 and org_id = $2", [obs_id, u.org_id])
    if not o:
        raise not_found()
    subs = [r["submitted_by"] for r in await db.q("select submitted_by from closures where observation_id = $1", [obs_id])]
    if not can_see(u, o, subs):
        raise forbidden()
    async with db.tx() as c:
        await db.execute("insert into comments (observation_id, user_id, body) values ($1,$2,$3)", [obs_id, u.id, body], c)
        await notify(c, [x for x in (o["owner_id"], o["raised_by"]) if x and x != u.id], kind="comment", observation_id=obs_id,
                     title=f"New comment on {o['code']}", body=f"{u.name}: {body[:300]}")


async def withdraw_photo(u: AuthUser, photo_id: str, raw: Any) -> None:
    reason = parse(ReasonIn, raw).reason
    if not UUID_RE.match(photo_id or ""):
        raise not_found("Photo not found.")
    async with db.tx() as c:
        p = await db.one("select p.*, o.org_id from observation_photos p join observations o on o.id = p.observation_id where p.id = $1", [photo_id], c)
        if not p or p["org_id"] != u.org_id:
            raise not_found("Photo not found.")
        o = await lock_obs(c, u, p["observation_id"])
        if not can_manage(u, o["site_id"]):
            raise forbidden()
        if p["withdrawn"]:
            return
        if p["kind"] == "evidence":
            left = await db.one("select count(*)::int as n from observation_photos where observation_id = $1 and kind = 'evidence' and not withdrawn", [o["id"]], c)
            if (left["n"] if left else 0) <= 1:
                raise bad_request("A point must keep at least 1 photo. Add the correct photo before withdrawing this one.")
        await db.execute("update observation_photos set withdrawn = true, withdrawn_reason = $2 where id = $1", [photo_id, reason], c)
        await bump(c, o, {}, u.id, "photo_withdrawn", reason, {"photo": [photo_id, "withdrawn"]})


async def add_evidence_photo(u: AuthUser, obs_id: str, photos: list[UploadedImage]) -> None:
    if not photos:
        raise bad_request("No photo received.")
    stored = await store_photos(photos)
    try:
        async with db.tx() as c:
            o = await lock_obs(c, u, obs_id)
            if not can_manage(u, o["site_id"]):
                raise forbidden()
            n = await db.one("select count(*)::int as n from observation_photos where observation_id = $1 and kind = 'evidence' and not withdrawn", [obs_id], c)
            if (n["n"] if n else 0) + len(stored) > 2:
                raise bad_request("A point can have at most 2 photos. Withdraw one first.")
            for p in stored:
                await db.execute(
                    "insert into observation_photos (observation_id, kind, storage_key, mime, bytes, width, height, uploaded_by) values ($1,'evidence',$2,$3,$4,$5,$6,$7)",
                    [obs_id, p.key, p.mime, p.bytes, p.width, p.height, u.id],
                    c,
                )
            await bump(c, o, {}, u.id, "photo_added", "", {"photos": [None, len(stored)]})
    except Exception:
        await discard_photos(stored)
        raise
