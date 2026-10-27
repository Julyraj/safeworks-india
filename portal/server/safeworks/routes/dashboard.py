"""Dashboard KPIs (brief §5.9, §10) and CSV exports with a BOM."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request

from .. import db
from ..audit import audit
from ..auth import require_user
from ..config import config
from ..errors import forbidden, not_found, rate_limited
from ..http import JSON, csv_response, parse_dt, uuid_param
from ..i18n import pick, t
from ..ratelimit import Limiter
from ..rbac import AuthUser
from ..settings import org_settings
from .actions import action_filters
from .observations import observation_filters

router = APIRouter(prefix="/api/v1")
export_limiter = Limiter(3600)


def _sites(request: Request, user: AuthUser) -> list[str]:
    raw = request.query_params.get("siteIds") or request.query_params.get("siteId") or ""
    ids = [uuid_param(s) for s in raw.split(",") if s]
    scope = user.sites_in_scope()
    allowed = [s for s in scope if user.can_view_site(s)]
    if not allowed:
        raise forbidden()
    if ids:
        if any(s not in scope for s in ids):
            raise not_found()
        return ids
    return allowed


def _kpi(key: str, value, lang: str, org: str, *, unit: str = "", n: int | None = None, hint: str | None = None, formula: str = "") -> dict:
    out = {"key": key, "label": {"en": t(f"kpi.{key}", "en", org), lang: t(f"kpi.{key}", lang, org)}, "value": value, "unit": unit, "n": n, "trend": None, "formula": formula}
    if hint:
        out["hint"] = {"en": t(hint, "en", org), lang: t(hint, lang, org)}
    return out


@router.get("/dashboard")
async def dashboard(request: Request, user: AuthUser = Depends(require_user())):
    sites = _sites(request, user)
    q = request.query_params
    to = parse_dt(q.get("to"), end_of_day=True) or datetime.now(timezone.utc)
    frm = parse_dt(q.get("from")) or (to - timedelta(days=90))
    org = user.org_id
    lang = user.language
    settings = await org_settings(org)
    p = [sites, frm, to]
    obs_where = "o.site_id = any($1::uuid[]) and o.received_at between $2 and $3"
    # KPIs
    open_actions = await db.one("select count(*)::int as n from actions a where a.site_id = any($1::uuid[]) and a.status in ('open','in_progress','reopened','disputed')", [sites])
    overdue = await db.one("select count(*)::int as n from actions a where a.site_id = any($1::uuid[]) and a.status in ('open','in_progress','reopened','disputed') and a.due_at < now()", [sites])
    backlog = await db.one("select count(*)::int as n from observations o where o.site_id = any($1::uuid[]) and o.status in ('submitted','returned')", [sites])
    due = await db.one(
        """select count(*)::int as n, count(*) filter (where status = 'verified' and completed_at <= original_due_at)::int as on_time
             from actions a where a.site_id = any($1::uuid[]) and a.original_due_at between $2 and $3 and a.status <> 'cancelled'""", p)
    closed = await db.one(
        """select percentile_cont(0.5) within group (order by extract(epoch from (closed_at - received_at)) / 86400) as med, count(*)::int as n
             from observations o where {w} and o.status = 'closed' and o.closed_at is not null""".format(w=obs_where), p)
    part = await db.one(
        """select count(distinct coalesce(o.reporter_user_id::text, s.reporter_user_hash))::int as reporters,
                  (select coalesce(sum(worker_count), 0)::int from sites where id = any($1::uuid[])) as workers
             from observations o left join observation_reporter_seals s on s.observation_id = o.id where {w}""".format(w=obs_where), p)
    crit = await db.one(
        """select percentile_cont(0.5) within group (order by extract(epoch from (critical_acked_at - received_at)) / 60) as med, count(*)::int as n
             from observations o where {w} and (o.imminent_danger or o.risk_band = 'extreme') and o.critical_acked_at is not null""".format(w=obs_where), p)
    insp = await db.one(
        """select count(*) filter (where status in ('completed','closed'))::int as done, count(*) filter (where status in ('completed','closed','missed'))::int as n
             from inspection_runs r where r.site_id = any($1::uuid[]) and coalesce(r.completed_at, r.due_at, r.created_at) between $2 and $3 and r.schedule_id is not null""", p)
    repeat = await db.one(
        """select count(*) filter (where ia.repeat_finding)::int as rep, count(*)::int as n from inspection_answers ia join inspection_runs r on r.id = ia.run_id
            where r.site_id = any($1::uuid[]) and r.completed_at between $2 and $3 and ia.flag""", p)
    discard = await db.one(
        """select count(*) filter (where status = 'discarded')::int as d, count(*) filter (where triaged_at is not null)::int as n from observations o where {w}""".format(w=obs_where), p)
    safe = await db.one(
        """select count(*) filter (where type = 'good_practice')::int as safe, count(*) filter (where type in ('unsafe_act','unsafe_condition'))::int as at_risk
             from observations o where {w} and o.status not in ('discarded','merged')""".format(w=obs_where), p)
    min_safe = int(settings.get("percentSafeMinimum", 30))
    behaviours = safe["safe"] + safe["at_risk"]
    kpis = [
        _kpi("open_actions", open_actions["n"], lang, org, n=open_actions["n"]),
        _kpi("overdue_actions", overdue["n"], lang, org, n=open_actions["n"], formula="open actions past due"),
        _kpi("triage_backlog", backlog["n"], lang, org, n=backlog["n"]),
        _kpi("on_time_closure", round(100.0 * due["on_time"] / due["n"], 1) if due["n"] else None, lang, org, unit="%", n=due["n"], hint="kpi.hint.on_time_closure",
             formula="verified effective by original due date ÷ actions due in period × 100"),
        _kpi("median_days_to_close", round(float(closed["med"]), 1) if closed["med"] is not None else None, lang, org, unit="days", n=closed["n"]),
        _kpi("participation", round(100.0 * part["reporters"] / part["workers"], 1) if part["workers"] else None, lang, org, unit="%", n=part["reporters"], hint="kpi.hint.participation",
             formula="distinct reporters ÷ site worker count × 100"),
        _kpi("critical_ack_median", round(float(crit["med"]), 1) if crit["med"] is not None else None, lang, org, unit="min", n=crit["n"]),
        _kpi("inspection_completion", round(100.0 * insp["done"] / insp["n"], 1) if insp["n"] else None, lang, org, unit="%", n=insp["n"], hint="kpi.hint.inspection_completion",
             formula="completed ÷ scheduled × 100 (missed counts as not completed)"),
        _kpi("repeat_findings", round(100.0 * repeat["rep"] / repeat["n"], 1) if repeat["n"] else None, lang, org, unit="%", n=repeat["n"], hint="kpi.hint.repeat_findings"),
        _kpi("discard_rate", round(100.0 * discard["d"] / discard["n"], 1) if discard["n"] else None, lang, org, unit="%", n=discard["n"], hint="kpi.hint.discard_rate"),
        _kpi("percent_safe", round(100.0 * safe["safe"] / behaviours, 1) if behaviours >= min_safe else None, lang, org, unit="%", n=behaviours, hint="kpi.hint.percent_safe",
             formula=f"good practice ÷ (good practice + at-risk) × 100, hidden below {min_safe}"),
    ]
    by_type = await db.q(f"select type, count(*)::int as count from observations o where {obs_where} and o.status not in ('discarded','merged') group by type order by type", p)
    by_cat = await db.q(
        f"""select c as code, count(*)::int as count, count(*) filter (where type in ('unsafe_act','unsafe_condition','near_miss'))::int as at_risk,
                   count(*) filter (where type = 'good_practice')::int as safe
              from observations o, unnest(o.category_codes) c where {obs_where} and o.status not in ('discarded','merged') group by c order by count desc limit 30""", p)
    by_area = await db.q(
        f"""select o.area_id, a.name_i18n as name, count(*)::int as count from observations o left join areas a on a.id = o.area_id
             where {obs_where} and o.status not in ('discarded','merged') group by o.area_id, a.name_i18n order by count desc limit 30""", p)
    by_emp = await db.q(
        f"""select o.employer_involved_id as employer_id, coalesce(k.name, '—') as name, count(*)::int as count from observations o left join contractors k on k.id = o.employer_involved_id
             where {obs_where} and o.status not in ('discarded','merged') group by o.employer_involved_id, k.name order by count desc limit 30""", p)
    weekly = await db.q(
        f"""select to_char(date_trunc('week', o.received_at at time zone 'Asia/Kolkata'), 'IYYY-"W"IW') as week, count(*)::int as reports,
                   count(*) filter (where type in ('unsafe_act','unsafe_condition','near_miss'))::int as at_risk, count(*) filter (where type = 'good_practice')::int as good
              from observations o where {obs_where} and o.status not in ('discarded','merged') group by 1 order by 1""", p)
    ageing = await db.q(
        """select bucket, count(*)::int as count from (
             select case when age <= 7 then '0-7' when age <= 30 then '8-30' when age <= 90 then '31-90' else '90+' end as bucket
               from (select extract(epoch from (now() - created_at)) / 86400 as age from actions a where a.site_id = any($1::uuid[]) and a.status in ('open','in_progress','reopened','disputed')) x) y
            group by bucket""", [sites])
    order = {"0-7": 0, "8-30": 1, "31-90": 2, "90+": 3}
    ageing_rows = {r["bucket"]: r["count"] for r in ageing}
    dtc = await db.q(
        """select band, percentile_cont(0.5) within group (order by extract(epoch from (verified_at - created_at)) / 86400) as median, count(*)::int as n
             from actions a where a.site_id = any($1::uuid[]) and a.status = 'verified' and a.verified_at between $2 and $3 group by band""", p)
    dtc_map = {r["band"]: r for r in dtc}
    top_rep = await db.q(
        """select q.text_i18n as question_text, tm.name_i18n as template_name, count(*)::int as count
             from inspection_answers ia join inspection_runs r on r.id = ia.run_id join inspection_questions q on q.id = ia.question_id
             join inspection_template_versions v on v.id = r.template_version_id join inspection_templates tm on tm.id = v.template_id
            where r.site_id = any($1::uuid[]) and r.completed_at between $2 and $3 and ia.repeat_finding group by q.text_i18n, tm.name_i18n order by count desc limit 10""", p)
    return JSON({
        "siteIds": sites, "from": frm, "to": to, "kpis": kpis,
        "byType": [{"type": r["type"], "count": r["count"]} for r in by_type],
        "byCategory": [{"code": r["code"], "count": r["count"], "atRisk": r["at_risk"], "safe": r["safe"]} for r in by_cat],
        "byArea": [{"areaId": r["area_id"], "name": r["name"] or {"en": "—"}, "count": r["count"]} for r in by_area],
        "byEmployer": [{"employerId": r["employer_id"], "name": r["name"], "count": r["count"]} for r in by_emp],
        "weekly": [{"week": r["week"], "reports": r["reports"], "atRisk": r["at_risk"], "good": r["good"]} for r in weekly],
        "ageing": [{"bucket": b, "count": ageing_rows.get(b, 0)} for b in sorted(order, key=order.get)],
        "daysToCloseByBand": [{"band": b, "median": round(float(dtc_map[b]["median"]), 1) if b in dtc_map and dtc_map[b]["median"] is not None else None, "n": dtc_map[b]["n"] if b in dtc_map else 0}
                               for b in ("low", "moderate", "high", "extreme")],
        "topRepeatFindings": [{"questionText": r["question_text"], "templateName": r["template_name"], "count": r["count"]} for r in top_rep],
        "sampleNote": {"en": t("dashboard.sample_note", "en", org), lang: t("dashboard.sample_note", lang, org)},
    })


# ---------- exports ----------

def _check_export(user: AuthUser) -> None:
    if not any(user.can_view_site(s) for s in user.sites_in_scope()):
        raise forbidden()
    try:
        export_limiter.check(f"export:{user.id}", config.exports_per_hour)
    except Exception:
        raise rate_limited(f"Export limit reached ({config.exports_per_hour} per hour).", key="err.exports_limit", limit=config.exports_per_hour)


async def _audit_export(user: AuthUser, what: str, n: int, filters: dict) -> None:
    async with db.tx() as c:
        await audit(c, org_id=user.org_id, actor=user, action="export", record_type=what, record_id="csv", changes={"rows": n, "filters": filters})


@router.get("/exports/observations.csv")
async def export_observations(request: Request, user: AuthUser = Depends(require_user())):
    _check_export(user)
    q = dict(request.query_params)
    params: list = []
    where, params = observation_filters(q, user, params)
    rows = await db.q(
        f"""select o.case_no, o.site_id, s.code as site_code, a.name_i18n as area_name, o.type, o.category_codes, o.description, o.description_lang, o.status, o.risk_band, o.likelihood, o.severity,
                   o.imminent_danger, o.fixed_on_spot, o.anonymous, o.channel, o.reporter_type, k.name as employer, o.trade, o.captured_at, o.received_at, o.triaged_at, o.closed_at,
                   o.closure_summary, o.is3786_code, o.lat, o.lng,
                   case when o.anonymous then '' else coalesce(p.full_name, u.employee_code, '') end as reporter
              from observations o join sites s on s.id = o.site_id left join areas a on a.id = o.area_id left join contractors k on k.id = o.employer_involved_id
              left join users u on u.id = o.reporter_user_id left join people p on p.id = u.person_id
             where {' and '.join(where)} order by o.received_at desc limit 50000""", params)
    lang = user.language
    head = ["Case no", "Site", "Area", "Type", "Categories", "Description", "Language", "Status", "Band", "Likelihood", "Severity", "Danger now", "Fixed on spot", "Anonymous", "Channel",
            "Reporter type", "Employer", "Trade", "Reporter", "Captured at", "Received at", "Triaged at", "Closed at", "Closure summary", "IS 3786", "Lat", "Lng"]
    out = [head]
    for r in rows:
        reporter = r["reporter"] if user.sees_reporter_identity(r["site_id"]) else ""
        out.append([r["case_no"], r["site_code"], pick(r["area_name"], lang) if r["area_name"] else "", r["type"], ",".join(r["category_codes"] or []), r["description"], r["description_lang"],
                    r["status"], r["risk_band"], r["likelihood"], r["severity"], r["imminent_danger"], r["fixed_on_spot"], r["anonymous"], r["channel"], r["reporter_type"], r["employer"],
                    r["trade"], reporter, r["captured_at"], r["received_at"], r["triaged_at"], r["closed_at"], r["closure_summary"], r["is3786_code"], r["lat"], r["lng"]])
    await _audit_export(user, "observation", len(rows), q)
    return csv_response(out, "observations.csv")


@router.get("/exports/actions.csv")
async def export_actions(request: Request, user: AuthUser = Depends(require_user())):
    _check_export(user)
    q = dict(request.query_params)
    params: list = []
    where = action_filters(q, user, params)
    rows = await db.q(
        f"""select a.case_no, s.code as site_code, a.source_type, a.title, a.problem, a.band, a.status, coalesce(p.full_name, u.employee_code) as owner, k.name as employer,
                   a.action_type, a.control_level, a.original_due_at, a.due_at, a.created_at, a.completed_at, a.verified_at, a.completion_note, a.cause_addressed, a.verification_result,
                   a.verification_method, a.reopen_count, a.interim_control
              from actions a join sites s on s.id = a.site_id join users u on u.id = a.owner_user_id left join people p on p.id = u.person_id
              left join contractors k on k.id = a.responsible_employer_id where {' and '.join(where)} order by a.created_at desc limit 50000""", params)
    head = ["Case no", "Site", "Source", "Title", "Problem", "Band", "Status", "Owner", "Employer", "Type", "Control level", "Original due", "Due", "Created", "Completed", "Verified",
            "Completion note", "Cause addressed", "Verification result", "Verification method", "Reopen count", "Interim control"]
    out = [head] + [[r["case_no"], r["site_code"], r["source_type"], r["title"], r["problem"], r["band"], r["status"], r["owner"], r["employer"], r["action_type"], r["control_level"],
                     r["original_due_at"], r["due_at"], r["created_at"], r["completed_at"], r["verified_at"], r["completion_note"], r["cause_addressed"], r["verification_result"],
                     r["verification_method"], r["reopen_count"], r["interim_control"]] for r in rows]
    await _audit_export(user, "action", len(rows), q)
    return csv_response(out, "actions.csv")


@router.get("/exports/inspections.csv")
async def export_inspections(request: Request, user: AuthUser = Depends(require_user())):
    _check_export(user)
    q = dict(request.query_params)
    sites = _sites(request, user)
    params: list = [sites]
    where = ["r.site_id = any($1::uuid[])"]
    if q.get("status"):
        params.append(q["status"].split(","))
        where.append(f"r.status = any(${len(params)}::text[])")
    if q.get("from"):
        params.append(parse_dt(q["from"]))
        where.append(f"coalesce(r.completed_at, r.due_at, r.created_at) >= ${len(params)}")
    if q.get("to"):
        params.append(parse_dt(q["to"], end_of_day=True))
        where.append(f"coalesce(r.completed_at, r.due_at, r.created_at) <= ${len(params)}")
    rows = await db.q(
        f"""select r.case_no, s.code as site_code, t.code as template_code, t.name_i18n as template_name, v.version, ar.name_i18n as area_name, ast.tag_no, r.trigger, r.status,
                   coalesce(p.full_name, u.employee_code) as inspector, r.due_at, r.started_at, r.completed_at, r.score_pct, r.result, r.tag_status,
                   (select count(*) from inspection_answers ia where ia.run_id = r.id and ia.flag)::int as failed,
                   (select count(*) from inspection_answers ia where ia.run_id = r.id and ia.action_id is not null)::int as actions,
                   (select count(*) from inspection_answers ia where ia.run_id = r.id and ia.repeat_finding)::int as repeats
              from inspection_runs r join sites s on s.id = r.site_id join inspection_template_versions v on v.id = r.template_version_id join inspection_templates t on t.id = v.template_id
              left join areas ar on ar.id = r.area_id left join assets ast on ast.id = r.asset_id left join users u on u.id = r.inspector_user_id left join people p on p.id = u.person_id
             where {' and '.join(where)} order by coalesce(r.completed_at, r.due_at, r.created_at) desc limit 50000""", params)
    lang = user.language
    head = ["Case no", "Site", "Template", "Template name", "Version", "Area", "Asset", "Trigger", "Status", "Inspector", "Due", "Started", "Completed", "Score %", "Result", "Tag", "Failed",
            "Actions", "Repeat findings"]
    out = [head] + [[r["case_no"], r["site_code"], r["template_code"], pick(r["template_name"], lang), r["version"], pick(r["area_name"], lang) if r["area_name"] else "", r["tag_no"],
                     r["trigger"], r["status"], r["inspector"], r["due_at"], r["started_at"], r["completed_at"], float(r["score_pct"]) if r["score_pct"] is not None else "", r["result"],
                     r["tag_status"], r["failed"], r["actions"], r["repeats"]] for r in rows]
    await _audit_export(user, "inspection_run", len(rows), q)
    return csv_response(out, "inspections.csv")
