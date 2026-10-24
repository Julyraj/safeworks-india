"""Personal and site dashboards."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Request

from .. import db
from ..auth import require_user
from ..errors import forbidden
from ..http import JSON, query, uuid_param
from ..observations import full_site_ids, list_observations
from ..rbac import AuthUser, can_manage, can_view_whole_site
from ..validation import In, parse

router = APIRouter()

COUNTS = """
  count(*) filter (where status <> 'cancelled')::int as created,
  count(*) filter (where status in ('open','in_progress'))::int as open,
  count(*) filter (where status in ('open','in_progress') and due_at < now())::int as overdue,
  count(*) filter (where status = 'closure_submitted')::int as awaiting,
  count(*) filter (where status = 'closed')::int as closed,
  count(*) filter (where status = 'noted')::int as noted"""


class PeriodIn(In):
    from_: date | None = None
    to: date | None = None

    model_config = {**In.model_config, "alias_generator": None}

    @classmethod
    def of(cls, raw: dict) -> "PeriodIn":
        return parse(cls, {"from_": raw.get("from"), "to": raw.get("to")})


def period(raw: dict) -> tuple[date, date]:
    p = PeriodIn.of(raw or {})
    today = datetime.now(db.TZ).date()
    to = p.to or today
    frm = p.from_ or (today - timedelta(days=89))
    return frm, to


def _pct(a: int, b: int) -> float | None:
    return round(a / b * 1000) / 10 if b > 0 else None


async def kpis(where: str, params: list, frm: date, to: date) -> dict:
    n = len(params)
    row = await db.one(
        f"""select
              count(*) filter (where status not in ('cancelled'))::int as raised,
              count(*) filter (where status not in ('cancelled','noted'))::int as actionable,
              count(*) filter (where status = 'closed')::int as closed,
              count(*) filter (where status = 'closed' and closed_at <= coalesce(due_at, closed_at))::int as closed_on_time,
              round((avg(extract(epoch from (closed_at - raised_at)) / 86400) filter (where status = 'closed'))::numeric, 1)::float as avg_days_to_close,
              count(*) filter (where obs_type = 'unsafe_act' and status <> 'cancelled')::int as acts,
              count(*) filter (where obs_type = 'unsafe_condition' and status <> 'cancelled')::int as conditions,
              count(*) filter (where obs_type = 'near_miss' and status <> 'cancelled')::int as near_misses,
              count(*) filter (where obs_type = 'safe_behaviour' and status <> 'cancelled')::int as safe,
              count(*) filter (where repeat_of is not null and status <> 'cancelled')::int as repeats,
              count(*) filter (where risk_level in ('High','Critical') and status <> 'cancelled')::int as high_critical
            from observations o
           where {where} and o.raised_at >= ${n + 1}::date and o.raised_at < (${n + 2}::date + 1)""",
        [*params, frm, to],
    )
    return {
        "raised": row["raised"],
        "closed": row["closed"],
        "closureRate": _pct(row["closed"], row["actionable"]),
        "onTimeClosure": _pct(row["closed_on_time"], row["closed"]),
        "avgDaysToClose": row["avg_days_to_close"],
        "actConditionRatio": round(row["acts"] / row["conditions"] * 100) / 100 if row["conditions"] > 0 else None,
        "acts": row["acts"],
        "conditions": row["conditions"],
        "nearMisses": row["near_misses"],
        "safeBehaviourShare": _pct(row["safe"], row["raised"]),
        "repeatRate": _pct(row["repeats"], row["raised"]),
        "highCritical": row["high_critical"],
    }


async def my_dashboard(u: AuthUser) -> dict:
    full = await full_site_ids(u)
    manageable = [s for s in full if can_manage(u, s)]
    site_level = len(full) > 0
    if site_level:
        scope = await db.one(f"select {COUNTS} from observations where org_id = $1 and site_id = any($2::uuid[])", [u.org_id, full])
    else:
        scope = await db.one(f"select {COUNTS} from observations where org_id = $1 and owner_id = $2", [u.org_id, u.id])
    mine = await db.one(
        """select count(*) filter (where status <> 'cancelled')::int as raised,
                  count(*) filter (where status <> 'cancelled' and raised_at >= date_trunc('day', now()))::int as raised_today
             from observations where raised_by = $1""",
        [u.id],
    )
    assigned = await db.one(f"select {COUNTS} from observations where owner_id = $1", [u.id])
    approvals = await db.one(
        """select count(*)::int as n from observations o
            where o.site_id = any($1::uuid[]) and o.status = 'closure_submitted'
              and not exists (select 1 from closures c where c.observation_id = o.id and c.decision = 'pending' and c.submitted_by = $2)""",
        [manageable, u.id],
    )
    due = await list_observations(u, {"scope": "all" if site_level else "assigned", "status": "open", "pageSize": 10})
    open_round = await db.one(
        """select r.id, r.code, s.name as site_name, (select count(*)::int from observations o where o.round_id = r.id) as points
             from rounds r join sites s on s.id = r.site_id where r.observer_id = $1 and r.status = 'open' order by r.started_at desc limit 1""",
        [u.id],
    )
    return {
        "scope": "site" if site_level else "assigned",
        "counters": scope,
        "raisedByMe": mine["raised"] if mine else 0,
        "raisedToday": mine["raised_today"] if mine else 0,
        "assignedToMe": assigned,
        "awaitingMyApproval": approvals["n"] if approvals else 0,
        "dueSoon": due["items"],
        "openRound": {"id": open_round["id"], "code": open_round["code"], "siteName": open_round["site_name"], "points": open_round["points"]} if open_round else None,
    }


async def site_dashboard(site_ids: list[str], org_id: str, frm: date, to: date) -> dict:
    where = "o.org_id = $1 and o.site_id = any($2::uuid[])"
    params: list[Any] = [org_id, site_ids]
    in_period = f"{where} and o.raised_at >= $3::date and o.raised_at < ($4::date + 1) and o.status <> 'cancelled'"
    pp = [*params, frm, to]

    async def group(expr: str, limit: int = 12) -> list[dict]:
        return await db.q(
            f"""select coalesce(nullif({expr}, ''), 'Not set') as label, count(*)::int as n from observations o
                  left join areas a on a.id = o.area_id left join contractors ct on ct.id = o.contractor_id
                 where {in_period} group by 1 order by 2 desc limit {limit}""",
            pp,
        )

    counts = await db.one(f"select {COUNTS} from observations o where {where}", params)
    k = await kpis(where, params, frm, to)
    weekly = await db.q(
        f"""with weeks as (select generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') as wk)
            select to_char(w.wk, 'YYYY-MM-DD') as week,
                   (select count(*)::int from observations o where {where} and o.status <> 'cancelled' and o.raised_at >= w.wk and o.raised_at < w.wk + interval '1 week') as raised,
                   (select count(*)::int from observations o where {where} and o.status = 'closed' and o.closed_at >= w.wk and o.closed_at < w.wk + interval '1 week') as closed
              from weeks w order by w.wk""",
        params,
    )
    overdue = await db.q(
        f"""select o.id, o.code, o.item, o.hazard, o.risk_level, o.due_at, ow.name as owner_name, s.name as site_name,
                   floor(extract(epoch from (now() - o.due_at)) / 86400)::int as days_overdue
              from observations o join sites s on s.id = o.site_id left join users ow on ow.id = o.owner_id
             where {where} and o.status in ('open','in_progress') and o.due_at < now() order by o.due_at limit 25""",
        params,
    )
    repeats = await db.q(
        f"""select o.item as label, coalesce(a.name, '') as area, count(*)::int as n from observations o left join areas a on a.id = o.area_id
             where {in_period} and o.item <> '' group by o.item, a.name having count(*) > 1 order by 3 desc limit 10""",
        pp,
    )
    lsr = await db.q(f"select o.lsr as label, count(*)::int as n from observations o where {in_period} and o.lsr <> '' group by 1 order by 2 desc", pp)
    per_officer = await db.q(
        f"""select u.name as officer, to_char(date_trunc('day', o.raised_at), 'YYYY-MM-DD') as day, count(*)::int as n
              from observations o join users u on u.id = o.raised_by
             where {where} and o.status <> 'cancelled' and o.raised_at >= date_trunc('day', now()) - interval '13 days'
             group by 1, 2 order by 1, 2""",
        params,
    )
    return {
        "period": {"from": frm.isoformat(), "to": to.isoformat()},
        "counters": counts,
        "kpis": k,
        "byCategory": await group("o.category"),
        "byHazard": await group("o.hazard"),
        "byArea": await group("a.name"),
        "byContractor": await group("ct.name"),
        "byRisk": await group("o.risk_level", 5),
        "byType": await group("o.obs_type", 5),
        "weekly": weekly,
        "overdue": [
            {"id": r["id"], "code": r["code"], "item": r["item"] or r["hazard"], "riskLevel": r["risk_level"], "dueAt": r["due_at"],
             "ownerName": r["owner_name"], "siteName": r["site_name"], "daysOverdue": r["days_overdue"]}
            for r in overdue
        ],
        "repeats": repeats,
        "lsrBreaches": lsr,
        "perOfficer": per_officer,
    }


@router.get("/api/dashboard/me")
async def me(u: AuthUser = Depends(require_user())):
    return JSON(await my_dashboard(u))


@router.get("/api/dashboard/site/{site_id}")
async def site(site_id: str, request: Request, u: AuthUser = Depends(require_user())):
    site_id = uuid_param(site_id, "Site not found.")
    if not can_view_whole_site(u, site_id):
        raise forbidden("Site dashboard is for the site's safety officers and managers.")
    frm, to = period(query(request))
    return JSON(await site_dashboard([site_id], u.org_id, frm, to))
