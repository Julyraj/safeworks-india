"""Corrective actions: list, detail, create, transitions, requests, cancel, reassign, comments."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from .. import db
from ..auth import require_user
from ..errors import not_found
from ..http import JSON, json_body, page_params, parse_dt, uuid_param
from ..rbac import AuthUser
from ..schemas import (ActionCancelRequest, ActionCommentBody, ActionCompleteRequest, ActionCreateRequest, ActionReassignRequest, ActionRequestCreate, ActionRequestDecide,
                       ActionVerifyRequest, SimpleTransition, parse)
from ..views import ACTION_SELECT, action_summary, first_thumb, media_for, paged
from ..workflow import actions as actions_wf

router = APIRouter(prefix="/api/v1/actions")


def action_filters(q: dict, user: AuthUser, params: list, *, table: str = "a") -> list[str]:
    where = [f"{table}.org_id = ${len(params) + 1}"]
    params.append(user.org_id)
    scope = user.sites_in_scope()
    site_ids = [uuid_param(s) for s in (q.get("siteId") or q.get("siteIds") or "").split(",") if s]
    if any(s not in scope for s in site_ids):
        raise not_found()
    officer_sites = [s for s in scope if user.can_view_site(s)]
    if q.get("verify") == "1":
        verify_sites = [s for s in scope if user.can_verify(s)]
        params += [verify_sites, user.id]
        where.append(f"{table}.status = 'completed' and {table}.site_id = any(${len(params) - 1}::uuid[]) and {table}.owner_user_id <> ${len(params)} and {table}.completed_by is distinct from ${len(params)}")
    elif q.get("mine") == "1" or not officer_sites:
        params.append(user.id)
        where.append(f"({table}.owner_user_id = ${len(params)} or {table}.verifier_user_id = ${len(params)} or {table}.completed_by = ${len(params)})")
    else:
        params.append(site_ids or officer_sites)
        where.append(f"{table}.site_id = any(${len(params)}::uuid[])")
        site_ids = []
    if site_ids:
        params.append(site_ids)
        where.append(f"{table}.site_id = any(${len(params)}::uuid[])")
    if q.get("status"):
        params.append(q["status"].split(","))
        where.append(f"{table}.status = any(${len(params)}::text[])")
    if q.get("band"):
        params.append(q["band"].split(","))
        where.append(f"{table}.band = any(${len(params)}::text[])")
    if q.get("ownerId"):
        params.append(uuid_param(q["ownerId"]))
        where.append(f"{table}.owner_user_id = ${len(params)}")
    if q.get("overdue") == "1":
        where.append(f"{table}.status in ('open','in_progress','reopened','disputed') and {table}.due_at < now()")
    if q.get("from"):
        params.append(parse_dt(q["from"]))
        where.append(f"{table}.created_at >= ${len(params)}")
    if q.get("to"):
        params.append(parse_dt(q["to"], end_of_day=True))
        where.append(f"{table}.created_at <= ${len(params)}")
    if q.get("q"):
        params.append(f"%{q['q'].strip()}%")
        where.append(f"({table}.title ilike ${len(params)} or {table}.case_no ilike ${len(params)} or {table}.problem ilike ${len(params)})")
    return where


@router.get("")
async def list_actions(request: Request, user: AuthUser = Depends(require_user())):
    q = dict(request.query_params)
    page, size = page_params(request, 50, 200)
    params: list = []
    where = action_filters(q, user, params)
    total = await db.one(f"select count(*)::int as n from actions a where {' and '.join(where)}", params)
    rows = await db.q(ACTION_SELECT + f" where {' and '.join(where)} order by a.due_at asc, a.created_at desc limit {size} offset {(page - 1) * size}", params)
    media = await media_for(None, "observation", [r["source_id"] for r in rows if r["source_type"] == "observation" and r["source_id"]])
    items = [action_summary(r, first_thumb(media.get(r["source_id"])) if r["source_type"] == "observation" else None) for r in rows]
    return JSON(paged(items, total["n"], page, size))


@router.post("")
async def create_action(request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(ActionCreateRequest, await json_body(request))
    async with db.tx() as c:
        out = await actions_wf.create_rest(c, user, inp)
    return JSON(out, status_code=201)


@router.get("/{action_id}")
async def get_action(action_id: str, user: AuthUser = Depends(require_user())):
    return JSON(await actions_wf.detail(None, user, uuid_param(action_id)))


@router.post("/{action_id}/start")
async def start(action_id: str, request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(SimpleTransition, await json_body(request))
    async with db.tx() as c:
        out = await actions_wf.start(c, user, uuid_param(action_id), inp.captured_at, inp.client_uuid)
    return JSON(out)


@router.post("/{action_id}/complete")
async def complete(action_id: str, request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(ActionCompleteRequest, await json_body(request))
    async with db.tx() as c:
        out = await actions_wf.complete(c, user, uuid_param(action_id), inp)
    return JSON(out)


@router.post("/{action_id}/verify")
async def verify(action_id: str, request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(ActionVerifyRequest, await json_body(request))
    async with db.tx() as c:
        out = await actions_wf.verify(c, user, uuid_param(action_id), inp)
    return JSON(out)


@router.post("/{action_id}/requests")
async def create_request(action_id: str, request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(ActionRequestCreate, await json_body(request))
    async with db.tx() as c:
        out = await actions_wf.request(c, user, uuid_param(action_id), inp)
    return JSON(out)


@router.post("/{action_id}/requests/{rid}/decide")
async def decide(action_id: str, rid: str, request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(ActionRequestDecide, await json_body(request))
    async with db.tx() as c:
        out = await actions_wf.decide(c, user, uuid_param(action_id), uuid_param(rid), inp)
    return JSON(out)


@router.post("/{action_id}/cancel")
async def cancel(action_id: str, request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(ActionCancelRequest, await json_body(request))
    async with db.tx() as c:
        out = await actions_wf.cancel(c, user, uuid_param(action_id), inp)
    return JSON(out)


@router.post("/{action_id}/reassign")
async def reassign(action_id: str, request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(ActionReassignRequest, await json_body(request))
    async with db.tx() as c:
        out = await actions_wf.reassign(c, user, uuid_param(action_id), inp)
    return JSON(out)


@router.post("/{action_id}/comments")
async def comment(action_id: str, request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(ActionCommentBody, await json_body(request))
    async with db.tx() as c:
        out = await actions_wf.add_comment(c, user, uuid_param(action_id), inp)
    return JSON(out, status_code=201)
