import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { one, q, tx } from "../db.js";
import { requireUser, revokeUserSessions, forgetUserInCache } from "../auth.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { audit } from "../audit.js";
import { AuthUser, isAdmin, Role, ROLES, ROLE_LABEL } from "../rbac.js";
import { hashPassword, passwordProblem, signFile, tempPassword } from "../security.js";
import { parseInput, TYPE_LABEL } from "../observations.js";
import { clearOrgCache, getOrg, mergeSettings } from "../settings.js";
import { clearMasterCache } from "./meta.js";
import { kpis, period, siteDashboard } from "./dashboard.js";

const idParam = z.object({ id: z.string().uuid() });

function requireAdminWrite(req: FastifyRequest) {
  if (!isAdmin(req.user!)) throw forbidden("Only admins can change this. Management viewers have read-only access.");
}

const SITE_TYPES = ["construction", "factory", "plant", "warehouse", "terminal", "quarry", "office", "other"] as const;

const siteSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, "Use 2–20 letters, digits or dashes, e.g. BLR-TWR01."),
  name: z.string().trim().min(2).max(160),
  siteType: z.enum(SITE_TYPES).default("construction"),
  state: z.string().trim().min(2).max(60),
  address: z.string().trim().max(400).default(""),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  registrations: z.record(z.string(), z.string().max(120)).default({}),
  siteHeadName: z.string().trim().max(120).default(""),
  siteHeadPhone: z.string().trim().max(40).default(""),
  siteHeadEmail: z.union([z.string().trim().email(), z.literal("")]).default(""),
  active: z.boolean().default(true),
});

const roleSchema = z.object({ role: z.enum(ROLES as [Role, ...Role[]]), siteId: z.string().uuid().nullable() });

const userSchema = z.object({
  employeeId: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._\-\/]+$/, "Employee ID can use letters, digits and . _ - /"),
  name: z.string().trim().min(2).max(120),
  designation: z.string().trim().max(120).default(""),
  phone: z.string().trim().max(40).default(""),
  email: z.union([z.string().trim().email(), z.literal("")]).default(""),
  contractorId: z.string().uuid().nullable().optional(),
  roles: z.array(roleSchema).min(1, "Give the user at least one role.").max(50),
  password: z
    .object({ mode: z.enum(["temp", "set"]), value: z.string().max(200).optional(), mustChange: z.boolean().default(true) })
    .default({ mode: "temp", mustChange: true }),
});

const userEditSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  designation: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.union([z.string().trim().email(), z.literal("")]).optional(),
  contractorId: z.string().uuid().nullable().optional(),
});

const passwordSchema = z.object({
  mode: z.enum(["temp", "set"]),
  password: z.string().max(200).optional(),
  mustChange: z.boolean().default(true),
});

const ROLE_SCOPE: Record<Role, "company" | "site" | "either"> = {
  platform_admin: "company",
  org_admin: "company",
  viewer: "either",
  auditor: "either",
  safety_officer: "site",
  supervisor: "site",
};

async function validateRoles(admin: AuthUser, roles: { role: Role; siteId: string | null }[]) {
  const siteIds = [...new Set(roles.map((r) => r.siteId).filter(Boolean))] as string[];
  if (siteIds.length) {
    const found = await q<{ id: string }>(`select id from sites where org_id = $1 and id = any($2::uuid[])`, [admin.orgId, siteIds]);
    if (found.length !== siteIds.length) throw badRequest("One of the sites does not exist.");
  }
  for (const r of roles) {
    const scope = ROLE_SCOPE[r.role];
    if (scope === "company" && r.siteId) throw badRequest(`${ROLE_LABEL[r.role]} applies to the whole company, not one site.`);
    if (scope === "site" && !r.siteId) throw badRequest(`${ROLE_LABEL[r.role]} must be given for a specific site.`);
    if (r.role === "platform_admin" && !admin.memberships.some((m) => m.role === "platform_admin")) {
      throw forbidden("Only a platform admin can grant the platform admin role.");
    }
  }
  const keys = roles.map((r) => `${r.role}:${r.siteId ?? "*"}`);
  if (new Set(keys).size !== keys.length) throw badRequest("The same role is listed twice.");
}

async function resolvePassword(p: { mode: "temp" | "set"; value?: string; password?: string }): Promise<{ hash: string; temp: string | null }> {
  if (p.mode === "set") {
    const pw = p.value ?? p.password ?? "";
    const problem = passwordProblem(pw);
    if (problem) throw badRequest(problem);
    return { hash: await hashPassword(pw), temp: null };
  }
  const temp = tempPassword();
  return { hash: await hashPassword(temp), temp };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formulas (CSV injection).
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const ROLE_ALIASES: Record<string, Role> = {
  "safety officer": "safety_officer", safety_officer: "safety_officer", so: "safety_officer",
  supervisor: "supervisor", "action owner": "supervisor",
  viewer: "viewer", "management viewer": "viewer",
  auditor: "auditor", admin: "org_admin", org_admin: "org_admin",
};

export default async function adminRoutes(app: FastifyInstance) {
  const admin = requireUser("admin");

  // ----- Overview --------------------------------------------------------------------------
  app.get("/api/admin/overview", { preHandler: admin }, async (req) => {
    const u = req.user!;
    const p = period(req.query);
    const sites = await q<any>(
      `select s.id, s.code, s.name, s.state, s.site_type, s.active,
              count(o.*) filter (where o.status in ('open','in_progress'))::int as open,
              count(o.*) filter (where o.status in ('open','in_progress') and o.due_at < now())::int as overdue,
              count(o.*) filter (where o.status = 'closure_submitted')::int as awaiting,
              count(o.*) filter (where o.status in ('open','in_progress','closure_submitted') and o.risk_level in ('High','Critical'))::int as high_critical_open,
              count(o.*) filter (where o.status <> 'cancelled' and o.raised_at >= $2::date and o.raised_at < ($3::date + 1))::int as raised,
              count(o.*) filter (where o.status = 'closed' and o.raised_at >= $2::date and o.raised_at < ($3::date + 1))::int as closed,
              count(o.*) filter (where o.status not in ('cancelled','noted') and o.raised_at >= $2::date and o.raised_at < ($3::date + 1))::int as actionable,
              round(avg(extract(epoch from (o.closed_at - o.raised_at)) / 86400) filter (where o.status = 'closed' and o.raised_at >= $2::date and o.raised_at < ($3::date + 1))::numeric, 1)::float as avg_days,
              (select count(distinct m.user_id)::int from memberships m where m.site_id = s.id) as users
         from sites s left join observations o on o.site_id = s.id
        where s.org_id = $1 group by s.id order by s.active desc, s.name`,
      [u.orgId, p.from, p.to],
    );
    const activeIds = sites.filter((s) => s.active).map((s) => s.id);
    const dash = await siteDashboard(activeIds, u.orgId, p.from, p.to);
    return {
      period: p,
      sites: sites.map((s) => ({
        id: s.id, code: s.code, name: s.name, state: s.state, type: s.site_type, active: s.active, users: s.users,
        open: s.open, overdue: s.overdue, awaiting: s.awaiting, highCriticalOpen: s.high_critical_open, raised: s.raised, closed: s.closed,
        closureRate: s.actionable ? Math.round((s.closed / s.actionable) * 1000) / 10 : null, avgDaysToClose: s.avg_days,
      })),
      dashboard: dash,
    };
  });

  // ----- Sites and areas -------------------------------------------------------------------
  app.get("/api/admin/sites", { preHandler: admin }, async (req) => {
    const u = req.user!;
    const sites = await q<any>(`select * from sites where org_id = $1 order by active desc, name`, [u.orgId]);
    const areas = await q<any>(`select a.* from areas a join sites s on s.id = a.site_id where s.org_id = $1 order by a.name`, [u.orgId]);
    return {
      sites: sites.map((s) => ({
        id: s.id, code: s.code, name: s.name, siteType: s.site_type, state: s.state, address: s.address, lat: s.lat, lng: s.lng,
        registrations: s.registrations, siteHeadName: s.site_head_name, siteHeadPhone: s.site_head_phone, siteHeadEmail: s.site_head_email, active: s.active,
        areas: areas.filter((a) => a.site_id === s.id).map((a) => ({ id: a.id, name: a.name, active: a.active })),
      })),
    };
  });

  app.post("/api/admin/sites", { preHandler: admin }, async (req, reply) => {
    requireAdminWrite(req);
    const u = req.user!;
    const s = parseInput(siteSchema, req.body);
    try {
      const row = await one<any>(
        `insert into sites (org_id, code, name, site_type, state, address, lat, lng, registrations, site_head_name, site_head_phone, site_head_email, active)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [u.orgId, s.code, s.name, s.siteType, s.state, s.address, s.lat ?? null, s.lng ?? null, JSON.stringify(s.registrations), s.siteHeadName, s.siteHeadPhone, s.siteHeadEmail, s.active],
      );
      await audit({ orgId: u.orgId, actorId: u.id, action: "site.created", entity: "site", entityId: row.id, ip: req.ip, details: { code: s.code, name: s.name } });
      reply.code(201);
      return { id: row.id };
    } catch (e: any) {
      if (e.code === "23505") throw conflict("A site with this code already exists.");
      throw e;
    }
  });

  app.patch("/api/admin/sites/:id", { preHandler: admin }, async (req) => {
    requireAdminWrite(req);
    const u = req.user!;
    const { id } = parseInput(idParam, req.params);
    const s = parseInput(siteSchema.partial(), req.body);
    const before = await one<any>(`select * from sites where id = $1 and org_id = $2`, [id, u.orgId]);
    if (!before) throw notFound("Site not found.");
    const map: Record<string, string> = {
      code: "code", name: "name", siteType: "site_type", state: "state", address: "address", lat: "lat", lng: "lng", registrations: "registrations",
      siteHeadName: "site_head_name", siteHeadPhone: "site_head_phone", siteHeadEmail: "site_head_email", active: "active",
    };
    const sets: string[] = [];
    const vals: unknown[] = [id];
    for (const [k, col] of Object.entries(map)) {
      const v = (s as any)[k];
      if (v === undefined) continue;
      vals.push(k === "registrations" ? JSON.stringify(v) : v);
      sets.push(`${col} = $${vals.length}`);
    }
    if (!sets.length) return { ok: true };
    try {
      await q(`update sites set ${sets.join(", ")} where id = $1`, vals);
    } catch (e: any) {
      if (e.code === "23505") throw conflict("A site with this code already exists.");
      throw e;
    }
    await audit({ orgId: u.orgId, actorId: u.id, action: "site.updated", entity: "site", entityId: id, ip: req.ip, details: s });
    return { ok: true };
  });

  app.post("/api/admin/sites/:id/areas", { preHandler: admin }, async (req, reply) => {
    requireAdminWrite(req);
    const u = req.user!;
    const { id } = parseInput(idParam, req.params);
    const { name } = parseInput(z.object({ name: z.string().trim().min(1).max(120) }), req.body);
    const site = await one(`select 1 from sites where id = $1 and org_id = $2`, [id, u.orgId]);
    if (!site) throw notFound("Site not found.");
    try {
      const row = await one<any>(`insert into areas (site_id, name) values ($1,$2) returning id`, [id, name]);
      await audit({ orgId: u.orgId, actorId: u.id, action: "area.created", entity: "area", entityId: row.id, ip: req.ip, details: { siteId: id, name } });
      reply.code(201);
      return { id: row.id };
    } catch (e: any) {
      if (e.code === "23505") throw conflict("This area already exists on the site.");
      throw e;
    }
  });

  app.patch("/api/admin/areas/:id", { preHandler: admin }, async (req) => {
    requireAdminWrite(req);
    const u = req.user!;
    const { id } = parseInput(idParam, req.params);
    const b = parseInput(z.object({ name: z.string().trim().min(1).max(120).optional(), active: z.boolean().optional() }), req.body);
    const a = await one(`select a.id from areas a join sites s on s.id = a.site_id where a.id = $1 and s.org_id = $2`, [id, u.orgId]);
    if (!a) throw notFound("Area not found.");
    await q(`update areas set name = coalesce($2, name), active = coalesce($3, active) where id = $1`, [id, b.name ?? null, b.active ?? null]);
    await audit({ orgId: u.orgId, actorId: u.id, action: "area.updated", entity: "area", entityId: id, ip: req.ip, details: b });
    return { ok: true };
  });

  // ----- Contractors ------------------------------------------------------------------------
  app.get("/api/admin/contractors", { preHandler: admin }, async (req) => {
    const u = req.user!;
    const rows = await q<any>(
      `select c.*, coalesce(array_agg(cs.site_id) filter (where cs.site_id is not null), '{}') as site_ids,
              (select count(*)::int from users x where x.contractor_id = c.id) as users
         from contractors c left join contractor_sites cs on cs.contractor_id = c.id
        where c.org_id = $1 group by c.id order by c.active desc, c.name`,
      [u.orgId],
    );
    return { contractors: rows.map((c) => ({ id: c.id, name: c.name, contact: c.contact, active: c.active, siteIds: c.site_ids, users: c.users })) };
  });

  const contractorSchema = z.object({
    name: z.string().trim().min(2).max(160),
    contact: z.string().trim().max(300).default(""),
    active: z.boolean().default(true),
    siteIds: z.array(z.string().uuid()).max(500).default([]),
  });

  async function saveContractor(u: AuthUser, id: string | null, input: z.infer<typeof contractorSchema>) {
    return tx(async (c) => {
      let cid = id;
      try {
        if (cid) {
          const r = await one(`update contractors set name = $2, contact = $3, active = $4 where id = $1 and org_id = $5 returning id`, [cid, input.name, input.contact, input.active, u.orgId], c);
          if (!r) throw notFound("Contractor not found.");
        } else {
          const r = await one<any>(`insert into contractors (org_id, name, contact, active) values ($1,$2,$3,$4) returning id`, [u.orgId, input.name, input.contact, input.active], c);
          cid = r.id;
        }
      } catch (e: any) {
        if (e.code === "23505") throw conflict("A contractor with this name already exists.");
        throw e;
      }
      await q(`delete from contractor_sites where contractor_id = $1`, [cid], c);
      if (input.siteIds.length) {
        await q(
          `insert into contractor_sites (contractor_id, site_id) select $1, s.id from sites s where s.org_id = $2 and s.id = any($3::uuid[])`,
          [cid, u.orgId, input.siteIds],
          c,
        );
      }
      return cid!;
    });
  }

  app.post("/api/admin/contractors", { preHandler: admin }, async (req, reply) => {
    requireAdminWrite(req);
    const input = parseInput(contractorSchema, req.body);
    const id = await saveContractor(req.user!, null, input);
    await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: "contractor.created", entity: "contractor", entityId: id, ip: req.ip, details: { name: input.name } });
    reply.code(201);
    return { id };
  });

  app.put("/api/admin/contractors/:id", { preHandler: admin }, async (req) => {
    requireAdminWrite(req);
    const { id } = parseInput(idParam, req.params);
    const input = parseInput(contractorSchema, req.body);
    await saveContractor(req.user!, id, input);
    await audit({ orgId: req.user!.orgId, actorId: req.user!.id, action: "contractor.updated", entity: "contractor", entityId: id, ip: req.ip, details: input });
    return { ok: true };
  });

  // ----- Users ------------------------------------------------------------------------------
  app.get("/api/admin/users", { preHandler: admin }, async (req) => {
    const u = req.user!;
    const f = parseInput(
      z.object({
        q: z.string().trim().max(80).optional(),
        siteId: z.string().uuid().optional(),
        role: z.enum(ROLES as [Role, ...Role[]]).optional(),
        status: z.enum(["active", "inactive", "locked", "all"]).default("all"),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(500).default(100),
      }),
      req.query,
    );
    const where = ["u.org_id = $1"];
    const params: unknown[] = [u.orgId];
    if (f.q) {
      params.push(`%${f.q.replace(/[%_\\]/g, (m) => "\\" + m)}%`);
      where.push(`(u.employee_id ilike $${params.length} or u.name ilike $${params.length} or u.designation ilike $${params.length})`);
    }
    if (f.siteId) {
      params.push(f.siteId);
      where.push(`exists (select 1 from memberships m where m.user_id = u.id and m.site_id = $${params.length})`);
    }
    if (f.role) {
      params.push(f.role);
      where.push(`exists (select 1 from memberships m where m.user_id = u.id and m.role = $${params.length})`);
    }
    if (f.status === "active") where.push("u.active");
    if (f.status === "inactive") where.push("not u.active");
    if (f.status === "locked") where.push("u.locked_until > now()");
    const w = where.join(" and ");
    const [rows, total] = await Promise.all([
      q<any>(
        `select u.id, u.employee_id, u.name, u.designation, u.phone, u.email, u.active, u.must_change_password, u.last_login_at, u.created_at,
                (u.locked_until is not null and u.locked_until > now()) as locked, ct.name as contractor_name, u.contractor_id,
                coalesce(json_agg(json_build_object('role', m.role, 'siteId', m.site_id, 'siteName', s.name, 'siteCode', s.code)) filter (where m.id is not null), '[]') as roles
           from users u left join memberships m on m.user_id = u.id left join sites s on s.id = m.site_id
           left join contractors ct on ct.id = u.contractor_id
          where ${w} group by u.id, ct.name order by u.active desc, u.name limit ${f.pageSize} offset ${(f.page - 1) * f.pageSize}`,
        params,
      ),
      one<{ n: number }>(`select count(*)::int as n from users u where ${w}`, params),
    ]);
    return {
      total: total?.n ?? 0,
      users: rows.map((r) => ({
        id: r.id, employeeId: r.employee_id, name: r.name, designation: r.designation, phone: r.phone, email: r.email, active: r.active,
        locked: r.locked, mustChangePassword: r.must_change_password, lastLoginAt: r.last_login_at, createdAt: r.created_at,
        contractorId: r.contractor_id, contractorName: r.contractor_name,
        roles: r.roles.map((x: any) => ({ ...x, roleLabel: ROLE_LABEL[x.role as Role] })),
      })),
    };
  });

  app.post("/api/admin/users", { preHandler: admin }, async (req, reply) => {
    requireAdminWrite(req);
    const u = req.user!;
    const input = parseInput(userSchema, req.body);
    await validateRoles(u, input.roles);
    const pw = await resolvePassword(input.password);
    const id = await tx(async (c) => {
      let row: any;
      try {
        row = await one<any>(
          `insert into users (org_id, employee_id, name, designation, phone, email, contractor_id, password_hash, must_change_password, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
          [u.orgId, input.employeeId, input.name, input.designation, input.phone, input.email, input.contractorId ?? null, pw.hash, pw.temp ? true : input.password.mustChange, u.id],
          c,
        );
      } catch (e: any) {
        if (e.code === "23505") throw conflict(`Employee ID ${input.employeeId} is already in use.`);
        throw e;
      }
      for (const r of input.roles) {
        await q(`insert into memberships (user_id, org_id, site_id, role) values ($1,$2,$3,$4)`, [row.id, u.orgId, r.siteId, r.role], c);
      }
      await audit({ orgId: u.orgId, actorId: u.id, action: "user.created", entity: "user", entityId: row.id, ip: req.ip, details: { employeeId: input.employeeId, roles: input.roles, password: input.password.mode } }, c);
      return row.id as string;
    });
    reply.code(201);
    return { id, tempPassword: pw.temp };
  });

  app.patch("/api/admin/users/:id", { preHandler: admin }, async (req) => {
    requireAdminWrite(req);
    const u = req.user!;
    const { id } = parseInput(idParam, req.params);
    const b = parseInput(userEditSchema, req.body);
    const row = await one<any>(`select id from users where id = $1 and org_id = $2`, [id, u.orgId]);
    if (!row) throw notFound("User not found.");
    await q(
      `update users set name = coalesce($2, name), designation = coalesce($3, designation), phone = coalesce($4, phone), email = coalesce($5, email),
              contractor_id = case when $6::boolean then $7::uuid else contractor_id end where id = $1`,
      [id, b.name ?? null, b.designation ?? null, b.phone ?? null, b.email ?? null, b.contractorId !== undefined, b.contractorId ?? null],
    );
    forgetUserInCache(id);
    await audit({ orgId: u.orgId, actorId: u.id, action: "user.updated", entity: "user", entityId: id, ip: req.ip, details: b });
    return { ok: true };
  });

  app.put("/api/admin/users/:id/roles", { preHandler: admin }, async (req) => {
    requireAdminWrite(req);
    const u = req.user!;
    const { id } = parseInput(idParam, req.params);
    const { roles } = parseInput(z.object({ roles: z.array(roleSchema).min(1, "Keep at least one role.").max(50) }), req.body);
    await validateRoles(u, roles);
    const target = await one<any>(`select id from users where id = $1 and org_id = $2`, [id, u.orgId]);
    if (!target) throw notFound("User not found.");
    if (id === u.id && !roles.some((r) => r.role === "org_admin" || r.role === "platform_admin")) {
      throw badRequest("You cannot remove your own admin role. Ask another admin.");
    }
    const before = await q<any>(`select role, site_id from memberships where user_id = $1`, [id]);
    if (before.some((r) => r.role === "platform_admin") && !u.memberships.some((m) => m.role === "platform_admin") && !roles.some((r) => r.role === "platform_admin")) {
      throw forbidden("Only a platform admin can remove the platform admin role.");
    }
    await tx(async (c) => {
      await q(`delete from memberships where user_id = $1`, [id], c);
      for (const r of roles) await q(`insert into memberships (user_id, org_id, site_id, role) values ($1,$2,$3,$4)`, [id, u.orgId, r.siteId, r.role], c);
      await audit({ orgId: u.orgId, actorId: u.id, action: "user.roles_changed", entity: "user", entityId: id, ip: req.ip, details: { before, after: roles } }, c);
    });
    forgetUserInCache(id);
    return { ok: true };
  });

  app.post("/api/admin/users/:id/password", { preHandler: admin }, async (req) => {
    requireAdminWrite(req);
    const u = req.user!;
    const { id } = parseInput(idParam, req.params);
    const b = parseInput(passwordSchema, req.body);
    const target = await one<any>(`select id, employee_id from users where id = $1 and org_id = $2`, [id, u.orgId]);
    if (!target) throw notFound("User not found.");
    const pw = await resolvePassword({ mode: b.mode, password: b.password });
    const mustChange = pw.temp ? true : b.mustChange;
    await q(
      `update users set password_hash = $2, must_change_password = $3, failed_attempts = 0, locked_until = null, password_changed_at = now() where id = $1`,
      [id, pw.hash, mustChange],
    );
    await revokeUserSessions(id, null);
    await audit({ orgId: u.orgId, actorId: u.id, action: b.mode === "temp" ? "password.reset" : "password.set_by_admin", entity: "user", entityId: id, ip: req.ip, details: { employeeId: target.employee_id, mustChange } });
    return { ok: true, tempPassword: pw.temp, mustChange };
  });

  app.post("/api/admin/users/:id/unlock", { preHandler: admin }, async (req) => {
    requireAdminWrite(req);
    const u = req.user!;
    const { id } = parseInput(idParam, req.params);
    const r = await one(`update users set failed_attempts = 0, locked_until = null where id = $1 and org_id = $2 returning id`, [id, u.orgId]);
    if (!r) throw notFound("User not found.");
    await audit({ orgId: u.orgId, actorId: u.id, action: "user.unlocked", entity: "user", entityId: id, ip: req.ip });
    return { ok: true };
  });

  app.post("/api/admin/users/:id/force-change", { preHandler: admin }, async (req) => {
    requireAdminWrite(req);
    const u = req.user!;
    const { id } = parseInput(idParam, req.params);
    const r = await one(`update users set must_change_password = true where id = $1 and org_id = $2 returning id`, [id, u.orgId]);
    if (!r) throw notFound("User not found.");
    forgetUserInCache(id);
    await audit({ orgId: u.orgId, actorId: u.id, action: "password.force_change", entity: "user", entityId: id, ip: req.ip });
    return { ok: true };
  });

  app.post("/api/admin/users/:id/active", { preHandler: admin }, async (req) => {
    requireAdminWrite(req);
    const u = req.user!;
    const { id } = parseInput(idParam, req.params);
    const { active } = parseInput(z.object({ active: z.boolean() }), req.body);
    if (id === u.id && !active) throw badRequest("You cannot deactivate your own login.");
    const r = await one(`update users set active = $2 where id = $1 and org_id = $3 returning id`, [id, active, u.orgId]);
    if (!r) throw notFound("User not found.");
    if (!active) await revokeUserSessions(id, null);
    await audit({ orgId: u.orgId, actorId: u.id, action: active ? "user.reactivated" : "user.deactivated", entity: "user", entityId: id, ip: req.ip });
    return { ok: true };
  });

  app.post("/api/admin/users/import", { preHandler: admin, bodyLimit: 2 * 1024 * 1024 }, async (req) => {
    requireAdminWrite(req);
    const u = req.user!;
    const { csv, dryRun } = parseInput(z.object({ csv: z.string().max(2_000_000), dryRun: z.boolean().default(false) }), req.body);
    const rows = parseCsv(csv.replace(/^﻿/, ""));
    if (rows.length < 2) throw badRequest("The file needs a header row and at least one user.");
    const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const col = (name: string) => header.indexOf(name);
    const need = ["employee_id", "name", "role"];
    for (const n of need) if (col(n) < 0) throw badRequest(`Missing column "${n}". Expected: employee_id, name, designation, phone, email, role, site_code.`);
    const sites = await q<any>(`select id, code from sites where org_id = $1`, [u.orgId]);
    const siteByCode = new Map(sites.map((s) => [s.code.toUpperCase(), s.id]));
    const existing = new Set((await q<any>(`select lower(employee_id) as e from users where org_id = $1`, [u.orgId])).map((r) => r.e));
    const created: { employeeId: string; name: string; role: string; site: string; tempPassword: string }[] = [];
    const errors: { line: number; message: string }[] = [];
    const seen = new Set<string>();
    const plans: { line: number; user: z.infer<typeof userSchema> }[] = [];
    rows.slice(1).forEach((r, i) => {
      const line = i + 2;
      const get = (n: string) => (col(n) >= 0 ? (r[col(n)] ?? "").trim() : "");
      const emp = get("employee_id");
      const roleRaw = get("role").toLowerCase();
      const role = ROLE_ALIASES[roleRaw];
      const siteCode = get("site_code").toUpperCase();
      if (!emp) return errors.push({ line, message: "employee_id is empty" });
      if (existing.has(emp.toLowerCase()) || seen.has(emp.toLowerCase())) return errors.push({ line, message: `Employee ID ${emp} already exists` });
      if (!role) return errors.push({ line, message: `Unknown role "${get("role")}" (use safety officer, supervisor, viewer, auditor or admin)` });
      const scope = ROLE_SCOPE[role];
      let siteId: string | null = null;
      if (scope === "site" || (scope === "either" && siteCode)) {
        siteId = siteByCode.get(siteCode) ?? null;
        if (!siteId) return errors.push({ line, message: `Unknown site_code "${siteCode}"` });
      }
      const parsed = userSchema.safeParse({
        employeeId: emp, name: get("name"), designation: get("designation"), phone: get("phone"), email: get("email"),
        roles: [{ role, siteId }], password: { mode: "temp", mustChange: true },
      });
      if (!parsed.success) return errors.push({ line, message: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
      seen.add(emp.toLowerCase());
      plans.push({ line, user: parsed.data });
    });
    if (dryRun || errors.length) return { created: [], errors, ready: plans.length };
    await tx(async (c) => {
      for (const p of plans) {
        const temp = tempPassword();
        const hash = await hashPassword(temp);
        const row = await one<any>(
          `insert into users (org_id, employee_id, name, designation, phone, email, password_hash, must_change_password, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,true,$8) returning id`,
          [u.orgId, p.user.employeeId, p.user.name, p.user.designation, p.user.phone, p.user.email, hash, u.id],
          c,
        );
        for (const r of p.user.roles) await q(`insert into memberships (user_id, org_id, site_id, role) values ($1,$2,$3,$4)`, [row.id, u.orgId, r.siteId, r.role], c);
        const siteCode = sites.find((s) => s.id === p.user.roles[0].siteId)?.code ?? "All sites";
        created.push({ employeeId: p.user.employeeId, name: p.user.name, role: ROLE_LABEL[p.user.roles[0].role], site: siteCode, tempPassword: temp });
      }
      await audit({ orgId: u.orgId, actorId: u.id, action: "user.bulk_import", entity: "user", ip: req.ip, details: { count: plans.length } }, c);
    });
    return { created, errors: [], ready: plans.length };
  });

  // ----- Master lists -----------------------------------------------------------------------
  app.get("/api/admin/master", { preHandler: admin }, async (req) => {
    const u = req.user!;
    const rows = await q<any>(
      `select distinct on (list, code) id, org_id, list, code, label, parent_code, sort, version, active, updated_at
         from master_items where org_id = $1 or org_id is null order by list, code, org_id nulls last`,
      [u.orgId],
    );
    return {
      items: rows
        .sort((a, b) => a.list.localeCompare(b.list) || a.sort - b.sort || a.label.localeCompare(b.label))
        .map((r) => ({ id: r.id, list: r.list, code: r.code, label: r.label, parent: r.parent_code, sort: r.sort, version: r.version, active: r.active, custom: !!r.org_id, updatedAt: r.updated_at })),
    };
  });

  const MASTER_LISTS = ["category", "item", "hazard", "activity", "root_cause", "lsr", "immediate_action", "control_level", "round_type", "shift", "permit_type"] as const;
  const versionNow = () => new Date().toISOString().slice(0, 7).replace("-", ".");

  app.post("/api/admin/master", { preHandler: admin }, async (req, reply) => {
    requireAdminWrite(req);
    const u = req.user!;
    const b = parseInput(
      z.object({ list: z.enum(MASTER_LISTS), label: z.string().trim().min(2).max(300), parent: z.string().trim().max(80).nullable().optional(), sort: z.number().int().default(1000) }),
      req.body,
    );
    if (b.list === "item" && !b.parent) throw badRequest("Choose the category this item belongs to.");
    const code = `c-${Date.now().toString(36)}`;
    const row = await one<any>(
      `insert into master_items (org_id, list, code, label, parent_code, sort, version) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [u.orgId, b.list, code, b.label, b.parent ?? null, b.sort, versionNow()],
    );
    clearMasterCache();
    await audit({ orgId: u.orgId, actorId: u.id, action: "master.created", entity: "master_item", entityId: row.id, ip: req.ip, details: b });
    reply.code(201);
    return { id: row.id, code };
  });

  app.patch("/api/admin/master/:id", { preHandler: admin }, async (req) => {
    requireAdminWrite(req);
    const u = req.user!;
    const { id } = parseInput(idParam, req.params);
    const b = parseInput(z.object({ label: z.string().trim().min(2).max(300).optional(), active: z.boolean().optional(), sort: z.number().int().optional() }), req.body);
    const item = await one<any>(`select * from master_items where id = $1 and (org_id = $2 or org_id is null)`, [id, u.orgId]);
    if (!item) throw notFound("List item not found.");
    if (item.org_id) {
      await q(`update master_items set label = coalesce($2, label), active = coalesce($3, active), sort = coalesce($4, sort), version = $5, updated_at = now() where id = $1`, [id, b.label ?? null, b.active ?? null, b.sort ?? null, versionNow()]);
    } else {
      // Editing a built-in item creates the company's own copy; the built-in wording stays for old records.
      await q(
        `insert into master_items (org_id, list, code, label, parent_code, sort, version, active)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), list, code)
         do update set label = excluded.label, active = excluded.active, sort = excluded.sort, version = excluded.version, updated_at = now()`,
        [u.orgId, item.list, item.code, b.label ?? item.label, item.parent_code, b.sort ?? item.sort, versionNow(), b.active ?? item.active],
      );
    }
    clearMasterCache();
    await audit({ orgId: u.orgId, actorId: u.id, action: "master.updated", entity: "master_item", entityId: id, ip: req.ip, details: { list: item.list, code: item.code, ...b } });
    return { ok: true };
  });

  // ----- Settings ---------------------------------------------------------------------------
  app.get("/api/admin/settings", { preHandler: admin }, async (req) => {
    const org = await getOrg(req.user!.orgId);
    return { companyName: org.name, settings: org.settings };
  });

  app.put("/api/admin/settings", { preHandler: admin }, async (req) => {
    requireAdminWrite(req);
    const u = req.user!;
    const days = z.coerce.number().int().min(1).max(365);
    const b = parseInput(
      z.object({
        companyName: z.string().trim().min(2).max(160),
        dueDays: z.object({ Critical: days, High: days, Medium: days, Low: days }),
        escalation: z.object({ siteHeadDays: z.coerce.number().int().min(1).max(90), adminDays: z.coerce.number().int().min(1).max(180) }),
        dueReminderHours: z.coerce.number().int().min(1).max(168).default(24),
      }),
      req.body,
    );
    if (!(b.dueDays.Critical <= b.dueDays.High && b.dueDays.High <= b.dueDays.Medium && b.dueDays.Medium <= b.dueDays.Low)) {
      throw badRequest("Due days should not be shorter for a lower risk level (Critical ≤ High ≤ Medium ≤ Low).");
    }
    const before = await getOrg(u.orgId);
    const settings = mergeSettings({ dueDays: b.dueDays, escalation: b.escalation, dueReminderHours: b.dueReminderHours });
    await q(`update organisations set name = $2, settings = $3 where id = $1`, [u.orgId, b.companyName, JSON.stringify(settings)]);
    clearOrgCache();
    clearMasterCache();
    await audit({ orgId: u.orgId, actorId: u.id, action: "settings.updated", entity: "organisation", entityId: u.orgId, ip: req.ip, details: { before: { name: before.name, ...before.settings }, after: { name: b.companyName, ...settings } } });
    return { ok: true };
  });

  // ----- Audit log --------------------------------------------------------------------------
  app.get("/api/admin/audit", { preHandler: admin }, async (req) => {
    const u = req.user!;
    if (!isAdmin(u)) throw forbidden("The audit log is for admins.");
    const f = parseInput(
      z.object({ q: z.string().trim().max(80).optional(), action: z.string().trim().max(60).optional(), page: z.coerce.number().int().min(1).default(1) }),
      req.query,
    );
    const where = ["(a.org_id = $1 or a.org_id is null)"];
    const params: unknown[] = [u.orgId];
    if (f.action) { params.push(`${f.action}%`); where.push(`a.action like $${params.length}`); }
    if (f.q) { params.push(`%${f.q}%`); where.push(`(u.name ilike $${params.length} or u.employee_id ilike $${params.length} or a.entity_id ilike $${params.length} or a.details::text ilike $${params.length})`); }
    const rows = await q<any>(
      `select a.id, a.at, a.action, a.entity, a.entity_id, a.ip, a.details, u.name as actor_name, u.employee_id as actor_employee_id
         from audit_log a left join users u on u.id = a.actor_id where ${where.join(" and ")} order by a.at desc limit 100 offset ${(f.page - 1) * 100}`,
      params,
    );
    return { items: rows.map((r) => ({ id: r.id, at: r.at, action: r.action, entity: r.entity, entityId: r.entity_id, ip: r.ip, details: r.details, actor: r.actor_name, actorEmployeeId: r.actor_employee_id })) };
  });

  // ----- Export -----------------------------------------------------------------------------
  app.get("/api/admin/export/observations.csv", { preHandler: admin }, async (req, reply: FastifyReply) => {
    const u = req.user!;
    const f = parseInput(z.object({ siteId: z.string().uuid().optional(), from: z.string().date().optional(), to: z.string().date().optional() }), req.query);
    const p = period({ from: f.from, to: f.to });
    const rows = await q<any>(
      `select o.*, s.code as site_code, s.name as site_name, a.name as area_name, ct.name as contractor_name, ow.name as owner_name,
              rb.name as raised_by_name, rb.employee_id as raised_by_emp, cb.name as closed_by_name, r.code as round_code,
              (select string_agg(p.storage_key, ' ') from observation_photos p where p.observation_id = o.id and p.kind = 'evidence' and not p.withdrawn) as evidence_keys,
              (select string_agg(p.storage_key, ' ') from observation_photos p where p.observation_id = o.id and p.kind = 'closure' and not p.withdrawn) as closure_keys,
              (select c.comment from closures c where c.observation_id = o.id order by c.attempt desc limit 1) as closure_comment
         from observations o join sites s on s.id = o.site_id left join areas a on a.id = o.area_id left join contractors ct on ct.id = o.contractor_id
         left join users ow on ow.id = o.owner_id join users rb on rb.id = o.raised_by left join users cb on cb.id = o.closed_by left join rounds r on r.id = o.round_id
        where o.org_id = $1 and ($2::uuid is null or o.site_id = $2) and o.raised_at >= $3::date and o.raised_at < ($4::date + 1)
        order by o.raised_at limit 50000`,
      [u.orgId, f.siteId ?? null, p.from, p.to],
    );
    // Photo links in the export stay valid for 7 days.
    const exp = Math.floor(Date.now() / 1000) + 7 * 86400;
    const link = (keys: string | null) =>
      (keys || "").split(" ").filter(Boolean).map((k) => `${config.publicUrl}/files/${k}?e=${exp}&s=${signFile(k, exp)}`).join(" | ");
    const head = [
      "Observation ID", "Site code", "Site", "Area", "Location", "Round", "Observed at", "Raised at", "Raised by", "Raised by employee ID", "Type", "Category", "Item",
      "Hazard", "Work activity", "Life-Saving Rule", "Permit type", "Permit no", "Equipment", "Person observed", "Contractor", "Crew size", "Severity", "Likelihood",
      "Risk score", "Risk level", "Work stopped", "Description", "Immediate action", "Root cause", "Corrective action", "Control level", "Action owner", "Due date",
      "Original due date", "Status", "Repeat", "Closure submitted at", "Closure comment", "Closed at", "Closed by", "Days to close", "Legal reference", "Evidence photos", "Closure photos",
    ];
    const lines = [head.map(csvCell).join(",")];
    for (const o of rows) {
      const days = o.closed_at ? Math.round(((new Date(o.closed_at).getTime() - new Date(o.raised_at).getTime()) / 86_400_000) * 10) / 10 : "";
      lines.push(
        [
          o.code, o.site_code, o.site_name, o.area_name, o.location, o.round_code, o.observed_at, o.raised_at, o.raised_by_name, o.raised_by_emp, TYPE_LABEL[o.obs_type as keyof typeof TYPE_LABEL],
          o.category, o.item, o.hazard, o.activity, o.lsr, o.permit_type, o.permit_no, o.equipment, o.person_observed, o.contractor_name, o.crew_size, o.severity, o.likelihood,
          o.risk_score, o.risk_level, o.work_stopped ? "Yes" : "No", o.description, o.immediate_action, o.root_cause, o.corrective_action, o.control_level, o.owner_name, o.due_at,
          o.original_due_at, o.status, o.repeat_of ? "Yes" : "No", o.closure_submitted_at, o.closure_comment, o.closed_at, o.closed_by_name, days, o.legal_ref,
          link(o.evidence_keys), link(o.closure_keys),
        ].map(csvCell).join(","),
      );
    }
    await audit({ orgId: u.orgId, actorId: u.id, action: "export.observations", entity: "observation", ip: req.ip, details: { siteId: f.siteId ?? null, ...p, rows: rows.length } });
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="safeworks-observations-${p.from}-to-${p.to}.csv"`);
    return "﻿" + lines.join("\r\n");
  });

  app.get("/api/admin/roles", { preHandler: admin }, async () => ({
    roles: ROLES.map((r) => ({ role: r, label: ROLE_LABEL[r], scope: ROLE_SCOPE[r] })),
  }));

  // KPI helper for the admin console (company-wide, chosen period)
  app.get("/api/admin/kpis", { preHandler: admin }, async (req) => {
    const p = period(req.query);
    return kpis("o.org_id = $1", [req.user!.orgId], p.from, p.to);
  });
}
