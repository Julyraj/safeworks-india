"""Insights (2.1): the same chart set at three levels.

- `me`: the reports I made (named and anonymous: my own anonymous reports are found through the seal hash, and only I see them)
  and the actions assigned to me.
- `department`: reports by named members of my department (anonymous and QR reports never count towards a department) and
  actions assigned to my department.
- `site`: every report and action of the sites in my scope; officers may pick sites. Counts only, never names.

Every number is a count over the chosen period; charts never show a person's name.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request

from .. import db
from ..auth import require_user
from ..crypto import hmac_id
from ..errors import not_found
from ..http import JSON, parse_dt, uuid_param
from ..rbac import AuthUser

router = APIRouter(prefix="/api/v1")

LEVELS = ("me", "department", "site")
OPEN_OBS = ("submitted", "returned", "action_assigned", "escalated")
OPEN_ACT = ("open", "in_progress", "reopened", "disputed")
TYPES = ("good_practice", "unsafe_act", "unsafe_condition", "near_miss")
BANDS = ("extreme", "high", "moderate", "low")


def period(q) -> tuple[datetime, datetime]:
    to = parse_dt(q.get("to"), end_of_day=True) or datetime.now(timezone.utc)
    frm = parse_dt(q.get("from")) or (to - timedelta(days=90))
    if frm > to:  # C2: dates the wrong way round: swap the dates, then take the whole first and last day again
        frm = parse_dt(q.get("to")) if q.get("to") else to
        to = parse_dt(q.get("from"), end_of_day=True)
    return frm, to


def site_filter(q, user: AuthUser) -> list[str]:
    scope = user.sites_in_scope()
    if not scope:
        raise not_found()
    raw = q.get("siteIds") or q.get("siteId") or ""
    ids = [uuid_param(s) for s in raw.split(",") if s]
    if any(s not in scope for s in ids):
        raise not_found()
    return ids or scope


def scope_sql(level: str, user: AuthUser, sites: list[str]) -> tuple[str, str, list]:
    """(observation WHERE, action WHERE, params) for a level; $1..$3 are sites, from, to."""
    params: list = [sites]
    if level == "me":
        params += [user.id, hmac_id(user.id)]
        obs = "(o.reporter_user_id = $4 or o.id in (select observation_id from observation_reporter_seals where reporter_user_hash = $5::text))"
        act = "a.owner_user_id = $4 and $5::text is not null"  # $5 (the seal hash) is shared with the report queries; typed so Postgres accepts it unused
    elif level == "department":
        if not user.department_id:
            raise not_found()
        params.append(user.department_id)
        obs = "o.reporter_department_id = $4"
        act = "a.department_id = $4"
    else:
        obs, act = "true", "true"
    return obs, act, params


async def insights_data(user: AuthUser, level: str, sites: list[str], frm: datetime, to: datetime) -> dict:
    obs_scope, act_scope, extra = scope_sql(level, user, sites)
    p = [sites, frm, to, *extra[1:]]
    ow = f"o.site_id = any($1::uuid[]) and o.received_at between $2 and $3 and o.status not in ('discarded','merged') and {obs_scope}"
    aw = f"a.site_id = any($1::uuid[]) and a.created_at between $2 and $3 and a.status <> 'cancelled' and {act_scope}"
    # span ≤ 120 days → weekly buckets, else monthly
    bucket = "week" if (to - frm).days <= 120 else "month"
    fmt = "IYYY-\"W\"IW" if bucket == "week" else "YYYY-MM"
    async with db._db(None).acquire() as c:
        tot = await db.one(
            f"""select count(*)::int as reports,
                       count(*) filter (where type = 'good_practice')::int as good,
                       count(*) filter (where type in ('unsafe_act','unsafe_condition'))::int as at_risk,
                       count(*) filter (where type = 'near_miss')::int as near_miss,
                       count(*) filter (where status = any(${len(p) + 1}::text[]))::int as open,
                       count(*) filter (where status = 'closed')::int as closed,
                       count(*) filter (where imminent_danger)::int as danger,
                       count(*) filter (where fixed_on_spot)::int as fixed_on_spot
                  from observations o where {ow}""", [*p, list(OPEN_OBS)], c)
        act = await db.one(
            f"""select count(*)::int as assigned,
                       count(*) filter (where status = any(${len(p) + 1}::text[]))::int as open,
                       count(*) filter (where status = any(${len(p) + 1}::text[]) and due_at < now())::int as overdue,
                       count(*) filter (where status = 'completed')::int as awaiting_verification,
                       count(*) filter (where status = 'verified')::int as verified,
                       count(*) filter (where status = 'verified' and completed_at <= original_due_at)::int as on_time
                  from actions a where {aw}""", [*p, list(OPEN_ACT)], c)
        by_type = await db.q(f"select type as key, count(*)::int as count from observations o where {ow} group by 1", p, c)
        by_status = await db.q(f"select status as key, count(*)::int as count from observations o where {ow} group by 1 order by 2 desc", p, c)
        by_band = await db.q(f"select risk_band as key, count(*)::int as count from observations o where {ow} and risk_band is not null group by 1", p, c)
        by_cat = await db.q(f"select cat as key, count(*)::int as count from observations o, unnest(o.category_codes) cat where {ow} group by 1 order by 2 desc limit 8", p, c)
        by_act_status = await db.q(f"select status as key, count(*)::int as count from actions a where {aw} group by 1 order by 2 desc", p, c)
        trend = await db.q(
            f"""select to_char(date_trunc('{bucket}', o.received_at at time zone 'Asia/Kolkata'), '{fmt}') as period, count(*)::int as reports,
                       count(*) filter (where type in ('unsafe_act','unsafe_condition','near_miss'))::int as at_risk,
                       count(*) filter (where type = 'good_practice')::int as good
                  from observations o where {ow} group by 1 order by 1""", p, c)
        closed_trend = await db.q(
            f"""select to_char(date_trunc('{bucket}', a.verified_at at time zone 'Asia/Kolkata'), '{fmt}') as period, count(*)::int as closed
                  from actions a where a.site_id = any($1::uuid[]) and a.verified_at between $2 and $3 and a.status = 'verified' and {act_scope} group by 1""", p, c)
        by_dept: list[dict] = []
        if level == "site":
            by_dept = [dict(r) for r in await db.q(
                f"""select d.id, d.code, d.name_i18n as name,
                           (select count(*) from observations o where {ow} and o.reporter_department_id = d.id)::int as reports,
                           (select count(*) from actions a where {aw} and a.department_id = d.id)::int as assigned,
                           (select count(*) from actions a where a.site_id = any($1::uuid[]) and a.department_id = d.id and a.status = any($4::text[]))::int as open,
                           (select count(*) from actions a where a.site_id = any($1::uuid[]) and a.department_id = d.id and a.status = any($4::text[]) and a.due_at < now())::int as overdue
                      from departments d where d.org_id = $5 and d.deleted_at is null order by d.sort, d.code""",
                [*p, list(OPEN_ACT), user.org_id], c)]
    closed_map = {r["period"]: r["closed"] for r in closed_trend}
    periods = sorted({r["period"] for r in trend} | set(closed_map))
    trend_map = {r["period"]: r for r in trend}
    dept_name = None
    if level == "department":
        d = await db.one("select code, name_i18n from departments where id = $1", [user.department_id])
        dept_name = d["name_i18n"] if d else None
    return {
        "level": level, "siteIds": sites, "from": frm, "to": to, "bucket": bucket, "departmentId": user.department_id if level == "department" else None,
        "departmentName": dept_name,
        "reports": {"total": tot["reports"], "goodPractice": tot["good"], "atRisk": tot["at_risk"], "nearMiss": tot["near_miss"], "open": tot["open"], "closed": tot["closed"],
                    "dangerNow": tot["danger"], "fixedOnSpot": tot["fixed_on_spot"]},
        "actions": {"assigned": act["assigned"], "open": act["open"], "overdue": act["overdue"], "awaitingVerification": act["awaiting_verification"], "verified": act["verified"],
                    "onTimePct": round(100.0 * act["on_time"] / act["verified"], 1) if act["verified"] else None},
        "byType": [{"key": k, "count": next((r["count"] for r in by_type if r["key"] == k), 0)} for k in TYPES],
        "byStatus": [{"key": r["key"], "count": r["count"]} for r in by_status],
        "byBand": [{"key": k, "count": next((r["count"] for r in by_band if r["key"] == k), 0)} for k in BANDS],
        "byCategory": [{"key": r["key"], "count": r["count"]} for r in by_cat],
        "actionsByStatus": [{"key": r["key"], "count": r["count"]} for r in by_act_status],
        "trend": [{"period": k, "reports": trend_map[k]["reports"] if k in trend_map else 0, "atRisk": trend_map[k]["at_risk"] if k in trend_map else 0,
                   "good": trend_map[k]["good"] if k in trend_map else 0, "actionsClosed": closed_map.get(k, 0)} for k in periods],
        "byDepartment": [{"departmentId": r["id"], "code": r["code"], "name": r["name"], "reports": r["reports"], "assigned": r["assigned"], "open": r["open"],
                          "overdue": r["overdue"]} for r in by_dept],
    }


@router.get("/insights")
async def insights(request: Request, user: AuthUser = Depends(require_user())):
    q = request.query_params
    level = q.get("level") or "me"
    if level not in LEVELS:
        level = "me"
    sites = site_filter(q, user)
    frm, to = period(q)
    return JSON(await insights_data(user, level, sites, frm, to))
