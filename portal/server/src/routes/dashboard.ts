import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, q } from "../db.js";
import { requireUser } from "../auth.js";
import { forbidden } from "../errors.js";
import { AuthUser, canManage, canViewWholeSite } from "../rbac.js";
import { fullSiteIds, listObservations, parseInput } from "../observations.js";

const COUNTS = `
  count(*) filter (where status <> 'cancelled')::int as created,
  count(*) filter (where status in ('open','in_progress'))::int as open,
  count(*) filter (where status in ('open','in_progress') and due_at < now())::int as overdue,
  count(*) filter (where status = 'closure_submitted')::int as awaiting,
  count(*) filter (where status = 'closed')::int as closed,
  count(*) filter (where status = 'noted')::int as noted`;

const periodSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

function period(raw: unknown): { from: string; to: string } {
  const p = parseInput(periodSchema, raw ?? {});
  const to = p.to ?? new Date().toISOString().slice(0, 10);
  const from = p.from ?? new Date(Date.now() - 89 * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

export async function kpis(where: string, params: unknown[], from: string, to: string) {
  const n = params.length;
  const row = await one<any>(
    `select
       count(*) filter (where status not in ('cancelled'))::int as raised,
       count(*) filter (where status not in ('cancelled','noted'))::int as actionable,
       count(*) filter (where status = 'closed')::int as closed,
       count(*) filter (where status = 'closed' and closed_at <= coalesce(due_at, closed_at))::int as closed_on_time,
       round(avg(extract(epoch from (closed_at - raised_at)) / 86400) filter (where status = 'closed')::numeric, 1)::float as avg_days_to_close,
       count(*) filter (where obs_type = 'unsafe_act' and status <> 'cancelled')::int as acts,
       count(*) filter (where obs_type = 'unsafe_condition' and status <> 'cancelled')::int as conditions,
       count(*) filter (where obs_type = 'near_miss' and status <> 'cancelled')::int as near_misses,
       count(*) filter (where obs_type = 'safe_behaviour' and status <> 'cancelled')::int as safe,
       count(*) filter (where repeat_of is not null and status <> 'cancelled')::int as repeats,
       count(*) filter (where risk_level in ('High','Critical') and status <> 'cancelled')::int as high_critical
     from observations o
    where ${where} and o.raised_at >= $${n + 1}::date and o.raised_at < ($${n + 2}::date + 1)`,
    [...params, from, to],
  );
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  return {
    raised: row.raised,
    closed: row.closed,
    closureRate: pct(row.closed, row.actionable),
    onTimeClosure: pct(row.closed_on_time, row.closed),
    avgDaysToClose: row.avg_days_to_close,
    actConditionRatio: row.conditions > 0 ? Math.round((row.acts / row.conditions) * 100) / 100 : null,
    acts: row.acts,
    conditions: row.conditions,
    nearMisses: row.near_misses,
    safeBehaviourShare: pct(row.safe, row.raised),
    repeatRate: pct(row.repeats, row.raised),
    highCritical: row.high_critical,
  };
}

async function myDashboard(u: AuthUser) {
  const full = await fullSiteIds(u);
  const manageable = full.filter((id) => canManage(u, id));
  const isSiteLevel = full.length > 0;
  const scopeWhere = isSiteLevel ? `org_id = $1 and site_id = any($2::uuid[])` : `org_id = $1 and owner_id = $2`;
  const scopeParams = isSiteLevel ? [u.orgId, full] : [u.orgId, u.id];
  const [scope, mine, assigned, approvals, today, openRound] = await Promise.all([
    one<any>(`select ${COUNTS} from observations where ${scopeWhere}`, scopeParams),
    one<any>(
      `select count(*) filter (where status <> 'cancelled')::int as raised,
              count(*) filter (where status <> 'cancelled' and raised_at >= date_trunc('day', now()))::int as raised_today
         from observations where raised_by = $1`,
      [u.id],
    ),
    one<any>(`select ${COUNTS} from observations where owner_id = $1`, [u.id]),
    one<any>(
      `select count(*)::int as n from observations o
        where o.site_id = any($1::uuid[]) and o.status = 'closure_submitted'
          and not exists (select 1 from closures c where c.observation_id = o.id and c.decision = 'pending' and c.submitted_by = $2)`,
      [manageable, u.id],
    ),
    listObservations(u, { scope: isSiteLevel ? "all" : "assigned", status: "open", pageSize: 10 }),
    one<any>(
      `select r.id, r.code, s.name as site_name, (select count(*)::int from observations o where o.round_id = r.id) as points
         from rounds r join sites s on s.id = r.site_id where r.observer_id = $1 and r.status = 'open' order by r.started_at desc limit 1`,
      [u.id],
    ),
  ]);
  return {
    scope: isSiteLevel ? "site" : "assigned",
    counters: scope,
    raisedByMe: mine?.raised ?? 0,
    raisedToday: mine?.raised_today ?? 0,
    assignedToMe: assigned,
    awaitingMyApproval: approvals?.n ?? 0,
    dueSoon: today.items,
    openRound: openRound ? { id: openRound.id, code: openRound.code, siteName: openRound.site_name, points: openRound.points } : null,
  };
}

export async function siteDashboard(siteIds: string[], orgId: string, from: string, to: string) {
  const where = `o.org_id = $1 and o.site_id = any($2::uuid[])`;
  const params: unknown[] = [orgId, siteIds];
  const inPeriod = `${where} and o.raised_at >= $3::date and o.raised_at < ($4::date + 1) and o.status <> 'cancelled'`;
  const pp = [...params, from, to];
  const group = (expr: string, limit = 12) =>
    q<{ label: string; n: number }>(
      `select coalesce(nullif(${expr}, ''), 'Not set') as label, count(*)::int as n from observations o
         left join areas a on a.id = o.area_id left join contractors ct on ct.id = o.contractor_id
        where ${inPeriod} group by 1 order by 2 desc limit ${limit}`,
      pp,
    );
  const [counts, k, byCategory, byHazard, byArea, byContractor, byRisk, byType, weekly, overdue, repeats, lsr, perOfficer] = await Promise.all([
    one<any>(`select ${COUNTS} from observations o where ${where}`, params),
    kpis(where, params, from, to),
    group("o.category"),
    group("o.hazard"),
    group("a.name"),
    group("ct.name"),
    group("o.risk_level", 5),
    group("o.obs_type", 5),
    q<any>(
      `with weeks as (select generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') as wk)
       select to_char(w.wk, 'YYYY-MM-DD') as week,
              (select count(*)::int from observations o where ${where} and o.status <> 'cancelled' and o.raised_at >= w.wk and o.raised_at < w.wk + interval '1 week') as raised,
              (select count(*)::int from observations o where ${where} and o.status = 'closed' and o.closed_at >= w.wk and o.closed_at < w.wk + interval '1 week') as closed
         from weeks w order by w.wk`,
      params,
    ),
    q<any>(
      `select o.id, o.code, o.item, o.hazard, o.risk_level, o.due_at, ow.name as owner_name, s.name as site_name,
              floor(extract(epoch from (now() - o.due_at)) / 86400)::int as days_overdue
         from observations o join sites s on s.id = o.site_id left join users ow on ow.id = o.owner_id
        where ${where} and o.status in ('open','in_progress') and o.due_at < now() order by o.due_at limit 25`,
      params,
    ),
    q<any>(
      `select o.item as label, coalesce(a.name, '') as area, count(*)::int as n from observations o left join areas a on a.id = o.area_id
        where ${inPeriod} and o.item <> '' group by o.item, a.name having count(*) > 1 order by 3 desc limit 10`,
      pp,
    ),
    q<any>(`select o.lsr as label, count(*)::int as n from observations o where ${inPeriod} and o.lsr <> '' group by 1 order by 2 desc`, pp),
    q<any>(
      `select u.name as officer, to_char(date_trunc('day', o.raised_at), 'YYYY-MM-DD') as day, count(*)::int as n
         from observations o join users u on u.id = o.raised_by
        where ${where} and o.status <> 'cancelled' and o.raised_at >= date_trunc('day', now()) - interval '13 days'
        group by 1, 2 order by 1, 2`,
      params,
    ),
  ]);
  return {
    period: { from, to },
    counters: counts,
    kpis: k,
    byCategory, byHazard, byArea, byContractor, byRisk, byType,
    weekly,
    overdue: overdue.map((r) => ({ id: r.id, code: r.code, item: r.item || r.hazard, riskLevel: r.risk_level, dueAt: r.due_at, ownerName: r.owner_name, siteName: r.site_name, daysOverdue: r.days_overdue })),
    repeats,
    lsrBreaches: lsr,
    perOfficer,
  };
}

export default async function dashboardRoutes(app: FastifyInstance) {
  app.get("/api/dashboard/me", { preHandler: requireUser() }, async (req) => myDashboard(req.user!));

  app.get("/api/dashboard/site/:siteId", { preHandler: requireUser() }, async (req) => {
    const { siteId } = parseInput(z.object({ siteId: z.string().uuid() }), req.params);
    const u = req.user!;
    if (!canViewWholeSite(u, siteId)) throw forbidden("Site dashboard is for the site's safety officers and managers.");
    const p = period(req.query);
    return siteDashboard([siteId], u.orgId, p.from, p.to);
  });
}

export { period };
