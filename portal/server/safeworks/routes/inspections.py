"""Inspections: templates in scope, runs (list, detail, start, answers, submit, report, reopen, cancel)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from starlette.responses import Response

from .. import db
from ..auth import require_user
from ..errors import not_found
from ..http import JSON, json_body, page_params, uuid_param
from ..rbac import AuthUser
from ..reports import read_run_report
from ..schemas import AnswersBody, ReasonBody, RunStartRequest, RunSubmitRequest, parse
from ..views import RUN_SELECT, load_template_versions, paged, run_summary
from ..workflow import inspections as insp_wf
from ..workflow.common import DuplicateRecord

router = APIRouter(prefix="/api/v1/inspections")


async def templates_for_site(conn, org_id: str, site_id: str | None) -> list[dict]:
    """Active template versions that apply to the site (industry / area types / asset classes present)."""
    rows = await db.q(
        "select v.id, t.applies_to from inspection_template_versions v join inspection_templates t on t.id = v.template_id where t.org_id = $1 and t.deleted_at is null and v.status = 'active'",
        [org_id], conn,
    )
    if not site_id:
        return await load_template_versions(conn, [r["id"] for r in rows])
    site = await db.one("select industry_code from sites where id = $1", [site_id], conn)
    area_types = {r["area_type"] for r in await db.q("select distinct area_type from areas where site_id = $1 and deleted_at is null", [site_id], conn)}
    asset_classes = {r["asset_class"] for r in await db.q("select distinct asset_class from assets where site_id = $1 and deleted_at is null", [site_id], conn)}
    ids = []
    for r in rows:
        ap = r["applies_to"] or {}
        inds, ats, acs = ap.get("industries") or [], ap.get("areaTypes") or [], ap.get("assetClasses") or []
        ok = True
        if inds and site and site["industry_code"] and site["industry_code"] not in inds:
            ok = False
        if ok and ats and area_types and not (set(ats) & area_types):
            ok = False
        if ok and acs and not (set(acs) & asset_classes):
            ok = False
        if ok:
            ids.append(r["id"])
    return await load_template_versions(conn, ids)


@router.get("/templates")
async def templates(request: Request, user: AuthUser = Depends(require_user())):
    site_id = request.query_params.get("siteId")
    if site_id:
        site_id = uuid_param(site_id)
        if not user.in_scope(site_id):
            raise not_found()
    return JSON(await templates_for_site(None, user.org_id, site_id))


@router.get("/runs")
async def list_runs(request: Request, user: AuthUser = Depends(require_user())):
    q = dict(request.query_params)
    page, size = page_params(request, 50, 200)
    params: list = [user.org_id]
    where = ["r.org_id = $1"]
    scope = user.sites_in_scope()
    officer_sites = [s for s in scope if user.can_view_site(s)]
    site_ids = [uuid_param(s) for s in (q.get("siteId") or q.get("siteIds") or "").split(",") if s]
    if any(s not in scope for s in site_ids):
        raise not_found()
    if q.get("mine") == "1" or not officer_sites:
        params.append(user.id)
        where.append(f"(r.inspector_user_id = ${len(params)} or (r.status = 'scheduled' and r.schedule_id in (select id from inspection_schedules where assignee_user_id = ${len(params)})))")
        if site_ids:
            params.append(site_ids)
            where.append(f"r.site_id = any(${len(params)}::uuid[])")
    else:
        params.append(site_ids or officer_sites)
        where.append(f"r.site_id = any(${len(params)}::uuid[])")
    if q.get("status"):
        params.append(q["status"].split(","))
        where.append(f"r.status = any(${len(params)}::text[])")
    if q.get("templateId"):
        params.append(uuid_param(q["templateId"]))
        where.append(f"t.id = ${len(params)}")
    total = await db.one(f"select count(*)::int as n from inspection_runs r join inspection_template_versions v on v.id = r.template_version_id join inspection_templates t on t.id = v.template_id where {' and '.join(where)}", params)
    rows = await db.q(RUN_SELECT + f" where {' and '.join(where)} order by coalesce(r.due_at, r.started_at, r.created_at) desc limit {size} offset {(page - 1) * size}", params)
    return JSON(paged([run_summary(r) for r in rows], total["n"], page, size))


@router.post("/runs")
async def start_run(request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(RunStartRequest, await json_body(request))
    async with db.tx() as c:
        try:
            out = await insp_wf.start(c, user, inp)
        except DuplicateRecord as d:
            return JSON(await insp_wf.detail(c, user, d.record_id))
    return JSON(out, status_code=201)


@router.get("/runs/{run_id}")
async def get_run(run_id: str, user: AuthUser = Depends(require_user())):
    return JSON(await insp_wf.detail(None, user, uuid_param(run_id)))


@router.put("/runs/{run_id}/answers")
async def put_answers(run_id: str, request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(AnswersBody, await json_body(request))
    async with db.tx() as c:
        out = await insp_wf.upsert_answers(c, user, uuid_param(run_id), inp.answers)
    return JSON(out)


@router.post("/runs/{run_id}/submit")
async def submit_run(run_id: str, request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(RunSubmitRequest, await json_body(request))
    async with db.tx() as c:
        out = await insp_wf.submit(c, user, uuid_param(run_id), inp)
    return JSON(out)


@router.get("/runs/{run_id}/report")
async def run_report(run_id: str, user: AuthUser = Depends(require_user())):
    rid = uuid_param(run_id)
    run = await insp_wf.load(None, rid)
    if not insp_wf.can_view(user, run):
        raise not_found()
    data = await read_run_report(None, rid)
    if data is None:
        raise not_found()
    return Response(data, media_type="text/html; charset=utf-8", headers={"content-disposition": f'inline; filename="{run["case_no"]}.html"'})


@router.post("/runs/{run_id}/reopen")
async def reopen_run(run_id: str, request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(ReasonBody, await json_body(request))
    async with db.tx() as c:
        out = await insp_wf.reopen(c, user, uuid_param(run_id), inp.reason)
    return JSON(out)


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str, request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(ReasonBody, await json_body(request))
    async with db.tx() as c:
        out = await insp_wf.cancel(c, user, uuid_param(run_id), inp.reason)
    return JSON(out)
