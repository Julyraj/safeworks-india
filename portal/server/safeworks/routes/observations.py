"""Observations: list, detail, duplicates, create, triage, comments, reply, reopen, critical acknowledgement, closure summary."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from .. import db
from ..auth import require_user
from ..crypto import hmac_id
from ..errors import not_found
from ..http import JSON, json_body, page_params, parse_dt, uuid_param
from ..rbac import AuthUser, require_officer
from ..schemas import ClosureSummaryBody, CommentBody, ObservationCreate, ReasonBody, ReplyBody, TriageRequest, parse
from ..views import OBS_SELECT, paged
from ..workflow import observations as obs_wf
from ..workflow.common import DuplicateRecord, get_site

router = APIRouter(prefix="/api/v1/observations")

OPEN = ("submitted", "returned", "action_assigned", "escalated")


def observation_filters(q: dict, user: AuthUser, params: list, *, table: str = "o") -> tuple[list[str], list]:
    """WHERE clauses for the shared observation filters (list and CSV export)."""
    where: list[str] = [f"{table}.org_id = ${len(params) + 1}"]
    params.append(user.org_id)
    site_ids = [s for s in (q.get("siteId") or q.get("siteIds") or "").split(",") if s]
    scope = user.sites_in_scope()
    officer_sites = [s for s in scope if user.can_view_site(s)]
    mine = q.get("mine") == "1" or not officer_sites
    if site_ids:
        site_ids = [uuid_param(s) for s in site_ids]
        if any(s not in scope for s in site_ids):
            raise not_found()
    if mine:
        params += [user.id, hmac_id(user.id)]
        where.append(f"({table}.reporter_user_id = ${len(params) - 1} or {table}.id in (select observation_id from observation_reporter_seals where reporter_user_hash = ${len(params)}))")
        if site_ids:
            params.append(site_ids)
            where.append(f"{table}.site_id = any(${len(params)}::uuid[])")
    else:
        params.append(site_ids or officer_sites)
        where.append(f"{table}.site_id = any(${len(params)}::uuid[])")
    for key, col in (("status", "status"), ("band", "risk_band"), ("type", "type"), ("channel", "channel")):
        if q.get(key):
            vals = q[key].split(",")
            params.append(vals)
            where.append(f"{table}.{col} = any(${len(params)}::text[])")
    if q.get("category"):
        params.append(q["category"].split(","))
        where.append(f"{table}.category_codes && ${len(params)}::text[]")
    if q.get("areaId"):
        params.append(uuid_param(q["areaId"]))
        where.append(f"{table}.area_id = ${len(params)}")
    if q.get("employerId"):
        params.append(uuid_param(q["employerId"]))
        where.append(f"{table}.employer_involved_id = ${len(params)}")
    if q.get("from"):
        params.append(parse_dt(q["from"]))
        where.append(f"{table}.received_at >= ${len(params)}")
    if q.get("to"):
        params.append(parse_dt(q["to"], end_of_day=True))
        where.append(f"{table}.received_at <= ${len(params)}")
    if q.get("q"):
        params.append(f"%{q['q'].strip()}%")
        where.append(f"({table}.description ilike ${len(params)} or {table}.case_no ilike ${len(params)} or {table}.task_observed ilike ${len(params)})")
    return where, params


@router.get("")
async def list_observations(request: Request, user: AuthUser = Depends(require_user())):
    q = dict(request.query_params)
    page, size = page_params(request, 50, 200)
    params: list = []
    where, params = observation_filters(q, user, params)
    order = "o.imminent_danger desc, (o.risk_band = 'extreme') desc, o.received_at asc" if q.get("status") == "submitted" else "o.received_at desc"
    total = await db.one(f"select count(*)::int as n from observations o where {' and '.join(where)}", params)
    rows = await db.q(OBS_SELECT + f" where {' and '.join(where)} order by {order} limit {size} offset {(page - 1) * size}", params)
    items = await obs_wf.summary_for(None, user, rows)
    return JSON(paged(items, total["n"], page, size))


@router.post("")
async def create_observation(request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(ObservationCreate, await json_body(request))
    site = await get_site(None, inp.site_id)
    if not user.in_scope(site["id"]):
        raise not_found()
    channel = inp.channel if inp.channel in ("app", "web", "on_behalf") else "web"
    async with db.tx() as c:
        try:
            o, uploads = await obs_wf.create(c, user, inp, site=site, area_id=inp.area_id, asset_id=inp.asset_id, channel=channel, device_id=user.device_id)
        except DuplicateRecord as d:
            out = await obs_wf.detail(c, user, d.record_id)
            out["uploads"] = [{"clientUuid": m["clientUuid"], "url": f"/api/v1/media/{m['clientUuid']}"} for m in out["media"] if m["uploadStatus"] == "pending"]
            out["duplicate"] = True
            return JSON(out)
        out = await obs_wf.detail(c, user, o["id"])
    out["uploads"] = uploads
    return JSON(out, status_code=201)


@router.get("/{obs_id}")
async def get_observation(obs_id: str, request: Request, user: AuthUser = Depends(require_user())):
    oid = uuid_param(obs_id)
    out = await obs_wf.detail(None, user, oid, with_duplicates=request.query_params.get("duplicates") == "1")
    return JSON(out)


@router.get("/{obs_id}/duplicates")
async def get_duplicates(obs_id: str, user: AuthUser = Depends(require_user())):
    o = await obs_wf.load(None, uuid_param(obs_id))
    require_officer(user, o["site_id"])
    return JSON(await obs_wf.duplicates(None, o))


@router.post("/{obs_id}/triage")
async def triage(obs_id: str, request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(TriageRequest, await json_body(request))
    async with db.tx() as c:
        out = await obs_wf.triage(c, user, uuid_param(obs_id), inp)
    return JSON(out)


@router.post("/{obs_id}/comments")
async def add_comment(obs_id: str, request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(CommentBody, await json_body(request))
    async with db.tx() as c:
        out = await obs_wf.add_comment(c, user, uuid_param(obs_id), inp)
    return JSON(out, status_code=201)


@router.post("/{obs_id}/reply")
async def reply(obs_id: str, request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(ReplyBody, await json_body(request))
    async with db.tx() as c:
        out = await obs_wf.reply(c, user, uuid_param(obs_id), inp)
    return JSON(out)


@router.post("/{obs_id}/reopen")
async def reopen(obs_id: str, request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(ReasonBody, await json_body(request))
    async with db.tx() as c:
        out = await obs_wf.reopen(c, user, uuid_param(obs_id), inp.reason)
    return JSON(out)


@router.post("/{obs_id}/ack-critical")
async def ack_critical(obs_id: str, user: AuthUser = Depends(require_user())):
    async with db.tx() as c:
        out = await obs_wf.ack_critical(c, user, uuid_param(obs_id))
    return JSON(out)


@router.put("/{obs_id}/closure-summary")
async def closure_summary(obs_id: str, request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(ClosureSummaryBody, await json_body(request))
    async with db.tx() as c:
        out = await obs_wf.set_closure_summary(c, user, uuid_param(obs_id), inp.closure_summary)
    return JSON(out)
