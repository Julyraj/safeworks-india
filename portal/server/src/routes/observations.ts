import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { one, pool, q } from "../db.js";
import { requireUser } from "../auth.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { canRaise, canViewWholeSite, isAdmin } from "../rbac.js";
import {
  addComment, addEvidencePhoto, cancelObservation, createObservation, decideClosure, editObservation, extendDue,
  getObservation, listItem, listObservations, nextRoundCode, parseInput, reopenObservation, startWork, submitClosure, withdrawPhoto,
} from "../observations.js";
import { readMultipart } from "../upload.js";

const idParam = z.object({ id: z.string().uuid() });

const roundSchema = z.object({
  id: z.string().uuid(),
  siteId: z.string().uuid(),
  roundType: z.string().trim().min(1).max(80),
  shift: z.string().trim().min(1).max(40),
  areaNames: z.array(z.string().trim().max(120)).max(30).default([]),
  accompaniedBy: z.string().trim().max(300).default(""),
  weather: z.string().trim().max(120).default(""),
  personsOnSite: z.coerce.number().int().min(0).max(100000).nullable().optional(),
});

export default async function observationRoutes(app: FastifyInstance) {
  const auth = requireUser();

  // ----- Rounds (safety walks) ------------------------------------------------------------
  app.post("/api/rounds", { preHandler: auth }, async (req, reply) => {
    const u = req.user!;
    const input = parseInput(roundSchema, req.body);
    const existing = await one<any>(`select id, observer_id from rounds where id = $1`, [input.id]);
    if (existing) {
      if (existing.observer_id !== u.id) throw conflict("Round ID already used.");
      return { id: input.id, duplicate: true };
    }
    if (!canRaise(u, input.siteId)) throw forbidden("Only safety officers start safety walks.");
    const site = await one<any>(`select id, code from sites where id = $1 and org_id = $2 and active`, [input.siteId, u.orgId]);
    if (!site) throw badRequest("Site not found.");
    const code = await nextRoundCode(pool, site.code);
    await q(
      `insert into rounds (id, org_id, site_id, code, observer_id, round_type, shift, area_names, accompanied_by, weather, persons_on_site)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [input.id, u.orgId, site.id, code, u.id, input.roundType, input.shift, input.areaNames, input.accompaniedBy, input.weather, input.personsOnSite ?? null],
    );
    reply.code(201);
    return { id: input.id, code };
  });

  app.post("/api/rounds/:id/finish", { preHandler: auth }, async (req) => {
    const { id } = parseInput(idParam, req.params);
    const u = req.user!;
    const r = await one<any>(`select * from rounds where id = $1 and org_id = $2`, [id, u.orgId]);
    if (!r) throw notFound("Round not found.");
    if (r.observer_id !== u.id && !isAdmin(u)) throw forbidden();
    await q(`update rounds set status = 'finished', ended_at = coalesce(ended_at, now()) where id = $1`, [id]);
    return { ok: true };
  });

  app.get("/api/rounds", { preHandler: auth }, async (req) => {
    const u = req.user!;
    const f = parseInput(z.object({ siteId: z.string().uuid().optional(), mine: z.string().optional() }), req.query);
    const rows = await q<any>(
      `select r.id, r.code, r.round_type, r.shift, r.status, r.started_at, r.ended_at, r.area_names, s.name as site_name, s.id as site_id,
              u.name as observer_name, r.observer_id,
              (select count(*)::int from observations o where o.round_id = r.id and o.status <> 'cancelled') as points
         from rounds r join sites s on s.id = r.site_id join users u on u.id = r.observer_id
        where r.org_id = $1 and ($2::uuid is null or r.site_id = $2) and ($3::boolean is not true or r.observer_id = $4)
        order by r.started_at desc limit 50`,
      [u.orgId, f.siteId ?? null, f.mine === "1", u.id],
    );
    return {
      rounds: rows
        .filter((r) => r.observer_id === u.id || canViewWholeSite(u, r.site_id))
        .map((r) => ({
          id: r.id, code: r.code, roundType: r.round_type, shift: r.shift, status: r.status, startedAt: r.started_at, endedAt: r.ended_at,
          areaNames: r.area_names, site: { id: r.site_id, name: r.site_name }, observerName: r.observer_name, points: r.points, mine: r.observer_id === u.id,
        })),
    };
  });

  app.get("/api/rounds/:id", { preHandler: auth }, async (req) => {
    const { id } = parseInput(idParam, req.params);
    const u = req.user!;
    const r = await one<any>(
      `select r.*, s.name as site_name, s.code as site_code, u.name as observer_name, u.designation as observer_designation, u.employee_id as observer_employee_id
         from rounds r join sites s on s.id = r.site_id join users u on u.id = r.observer_id where r.id = $1 and r.org_id = $2`,
      [id, u.orgId],
    );
    if (!r) throw notFound("Round not found.");
    if (r.observer_id !== u.id && !canViewWholeSite(u, r.site_id)) throw forbidden();
    const list = await listObservations(u, { roundId: id, pageSize: 200, status: "any" });
    return {
      id: r.id, code: r.code, status: r.status, roundType: r.round_type, shift: r.shift, areaNames: r.area_names, accompaniedBy: r.accompanied_by,
      weather: r.weather, personsOnSite: r.persons_on_site, startedAt: r.started_at, endedAt: r.ended_at,
      site: { id: r.site_id, name: r.site_name, code: r.site_code },
      observer: { name: r.observer_name, designation: r.observer_designation, employeeId: r.observer_employee_id },
      mine: r.observer_id === u.id,
      points: list.items,
    };
  });

  // ----- Observations ----------------------------------------------------------------------
  app.post("/api/observations", { preHandler: auth }, async (req, reply) => {
    const { data, files } = await readMultipart(req, { fileFields: ["photos", "afterPhotos"], maxFiles: 4 });
    const out = await createObservation(req.user!, data, { evidence: files.photos ?? [], after: files.afterPhotos ?? [] }, req.ip);
    reply.code(out.duplicate ? 200 : 201);
    return getObservation(req.user!, out.id);
  });

  app.get("/api/observations", { preHandler: auth }, async (req) => listObservations(req.user!, req.query));

  app.get("/api/observations/:id", { preHandler: auth }, async (req) => {
    const { id } = parseInput(idParam, req.params);
    return getObservation(req.user!, id);
  });

  app.patch("/api/observations/:id", { preHandler: auth }, async (req) => {
    const { id } = parseInput(idParam, req.params);
    await editObservation(req.user!, id, req.body);
    return getObservation(req.user!, id);
  });

  app.post("/api/observations/:id/start", { preHandler: auth }, async (req) => {
    const { id } = parseInput(idParam, req.params);
    await startWork(req.user!, id);
    return getObservation(req.user!, id);
  });

  app.post("/api/observations/:id/closure", { preHandler: auth }, async (req) => {
    const { id } = parseInput(idParam, req.params);
    const { data, files } = await readMultipart(req, { fileFields: ["photos"], maxFiles: 2 });
    await submitClosure(req.user!, id, data, files.photos ?? []);
    return getObservation(req.user!, id);
  });

  app.post("/api/observations/:id/decision", { preHandler: auth }, async (req) => {
    const { id } = parseInput(idParam, req.params);
    await decideClosure(req.user!, id, req.body);
    return getObservation(req.user!, id);
  });

  app.post("/api/observations/:id/cancel", { preHandler: auth }, async (req) => {
    const { id } = parseInput(idParam, req.params);
    await cancelObservation(req.user!, id, req.body);
    return getObservation(req.user!, id);
  });

  app.post("/api/observations/:id/reopen", { preHandler: auth }, async (req) => {
    const { id } = parseInput(idParam, req.params);
    await reopenObservation(req.user!, id, req.body);
    return getObservation(req.user!, id);
  });

  app.post("/api/observations/:id/extend", { preHandler: auth }, async (req) => {
    const { id } = parseInput(idParam, req.params);
    await extendDue(req.user!, id, req.body);
    return getObservation(req.user!, id);
  });

  app.post("/api/observations/:id/comments", { preHandler: auth }, async (req) => {
    const { id } = parseInput(idParam, req.params);
    await addComment(req.user!, id, req.body);
    return getObservation(req.user!, id);
  });

  app.post("/api/observations/:id/photos", { preHandler: auth }, async (req) => {
    const { id } = parseInput(idParam, req.params);
    const { files } = await readMultipart(req, { fileFields: ["photos"], maxFiles: 2 });
    await addEvidencePhoto(req.user!, id, files.photos ?? []);
    return getObservation(req.user!, id);
  });

  app.post("/api/photos/:id/withdraw", { preHandler: auth }, async (req) => {
    const { id } = parseInput(idParam, req.params);
    await withdrawPhoto(req.user!, id, req.body);
    return { ok: true };
  });

  // ----- Notifications ---------------------------------------------------------------------
  app.get("/api/notifications", { preHandler: auth }, async (req) => {
    const rows = await q<any>(
      `select n.id, n.kind, n.title, n.body, n.created_at, n.read_at, n.observation_id
         from notifications n where n.user_id = $1 order by n.created_at desc limit 100`,
      [req.user!.id],
    );
    return {
      items: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, at: r.created_at, read: !!r.read_at, observationId: r.observation_id })),
    };
  });

  app.post("/api/notifications/read", { preHandler: auth }, async (req) => {
    const body = parseInput(z.object({ ids: z.array(z.number().int()).max(500).optional() }), req.body ?? {});
    if (body.ids?.length) await q(`update notifications set read_at = now() where user_id = $1 and id = any($2::bigint[]) and read_at is null`, [req.user!.id, body.ids]);
    else await q(`update notifications set read_at = now() where user_id = $1 and read_at is null`, [req.user!.id]);
    return { ok: true };
  });
}

export { listItem };
