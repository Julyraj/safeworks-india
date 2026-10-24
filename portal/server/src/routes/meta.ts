import type { FastifyInstance } from "fastify";
import { q } from "../db.js";
import { requireUser } from "../auth.js";
import { AuthUser, canManage, canRaise, canViewWholeSite, hasCompanyWideRead, rolesAt } from "../rbac.js";
import { getOrg } from "../settings.js";

let masterCache: { orgId: string; at: number; data: any } | null = null;

export function clearMasterCache() {
  masterCache = null;
}

export async function masterLists(orgId: string) {
  if (masterCache && masterCache.orgId === orgId && Date.now() - masterCache.at < 60_000) return masterCache.data;
  const rows = await q<any>(
    `select distinct on (list, code) list, code, label, parent_code, sort, version, active
       from master_items where org_id = $1 or org_id is null
      order by list, code, org_id nulls last`,
    [orgId],
  );
  const lists: Record<string, { code: string; label: string; parent: string | null; sort: number; version: string }[]> = {};
  for (const r of rows) {
    if (!r.active) continue;
    (lists[r.list] ||= []).push({ code: r.code, label: r.label, parent: r.parent_code, sort: r.sort, version: r.version });
  }
  for (const k of Object.keys(lists)) lists[k].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
  const org = await getOrg(orgId);
  const data = { lists, settings: org.settings, company: org.name };
  masterCache = { orgId, at: Date.now(), data };
  return data;
}

export async function sitesFor(u: AuthUser) {
  const all = await q<any>(`select * from sites where org_id = $1 and active order by name`, [u.orgId]);
  const mine = all.filter((s) => hasCompanyWideRead(u) || u.memberships.some((m) => m.siteId === s.id));
  const ids = mine.map((s) => s.id);
  if (!ids.length) return [];
  const [areas, contractors, people] = await Promise.all([
    q<any>(`select id, site_id, name from areas where site_id = any($1::uuid[]) and active order by name`, [ids]),
    q<any>(
      `select c.id, c.name, cs.site_id from contractors c join contractor_sites cs on cs.contractor_id = c.id
        where cs.site_id = any($1::uuid[]) and c.active order by c.name`,
      [ids],
    ),
    q<any>(
      `select u.id, u.name, u.designation, u.phone, u.employee_id, m.site_id, m.role, ct.name as contractor_name
         from memberships m join users u on u.id = m.user_id left join contractors ct on ct.id = u.contractor_id
        where m.site_id = any($1::uuid[]) and u.active and m.role in ('supervisor','safety_officer')
        order by u.name`,
      [ids],
    ),
  ]);
  return mine.map((s) => {
    const roles = [...rolesAt(u, s.id)];
    const sitePeople = people.filter((p) => p.site_id === s.id);
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      type: s.site_type,
      state: s.state,
      address: s.address,
      siteHead: { name: s.site_head_name, phone: s.site_head_phone },
      myRoles: roles,
      can: { raise: canRaise(u, s.id), manage: canManage(u, s.id), viewAll: canViewWholeSite(u, s.id) },
      areas: areas.filter((a) => a.site_id === s.id).map((a) => ({ id: a.id, name: a.name })),
      contractors: contractors.filter((c) => c.site_id === s.id).map((c) => ({ id: c.id, name: c.name })),
      owners: [...new Map(sitePeople.map((p) => [p.id, { id: p.id, name: p.name, designation: p.designation, role: p.role, contractor: p.contractor_name }])).values()],
      safetyOfficers: sitePeople.filter((p) => p.role === "safety_officer").map((p) => ({ name: p.name, phone: p.phone })),
    };
  });
}

export default async function metaRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => {
    await q("select 1");
    return { ok: true, time: new Date().toISOString() };
  });

  app.get("/api/master", { preHandler: requireUser() }, async (req) => masterLists(req.user!.orgId));

  app.get("/api/sites", { preHandler: requireUser() }, async (req) => ({ sites: await sitesFor(req.user!) }));
}
