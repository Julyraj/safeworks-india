import type pg from "pg";
import { z } from "zod";
import { Db, localDate, one, pool, q, tx } from "./db.js";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import { AuthUser, canManage, canRaise, canViewWholeSite, isAdmin, rolesAt } from "./rbac.js";
import { getOrg, riskOf, RiskLevel } from "./settings.js";
import { notify, siteSafetyOfficers, companyAdmins } from "./notify.js";
import { signedFileUrl } from "./security.js";
import { StoredPhoto, discardPhotos, storePhotos, UploadedImage } from "./upload.js";
import { audit } from "./audit.js";

export const OBS_TYPES = ["unsafe_act", "unsafe_condition", "near_miss", "safe_behaviour"] as const;
export type ObsType = (typeof OBS_TYPES)[number];
export const TYPE_LABEL: Record<ObsType, string> = {
  unsafe_act: "Unsafe act",
  unsafe_condition: "Unsafe condition",
  near_miss: "Near miss",
  safe_behaviour: "Safe behaviour",
};

const str = (max: number) => z.string().trim().max(max).default("");
const uuidOpt = z.string().uuid().nullable().optional();
const level15 = z.coerce.number().int().min(1).max(5).nullable().optional();

export const createSchema = z.object({
  id: z.string().uuid(),
  siteId: z.string().uuid(),
  roundId: uuidOpt,
  areaId: uuidOpt,
  location: str(200),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  observedAt: z.string().datetime({ offset: true }).optional(),
  type: z.enum(OBS_TYPES),
  categoryCode: str(80),
  itemCode: str(80),
  itemOther: str(300),
  hazard: str(100),
  activity: str(160),
  lsr: str(160),
  permitType: str(80),
  permitNo: str(60),
  equipment: str(120),
  personObserved: str(160),
  contractorId: uuidOpt,
  crewSize: z.coerce.number().int().min(0).max(5000).nullable().optional(),
  severity: level15,
  likelihood: level15,
  workStopped: z.boolean().default(false),
  description: z.string().trim().min(3, "Describe what was observed.").max(4000),
  immediateAction: str(200),
  rootCause: str(200),
  correctiveAction: str(2000),
  controlLevel: str(40),
  correctedOnSpot: z.boolean().default(false),
  ownerId: uuidOpt,
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  legalRef: str(600),
});
export type CreateInput = z.infer<typeof createSchema>;

function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    const field = first?.path?.join(".") || "input";
    throw badRequest(`${field}: ${first?.message ?? "invalid"}`, r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return r.data;
}
export { parse as parseInput };

async function nextNumber(db: Db, scope: string): Promise<number> {
  const row = await one<{ n: number }>(
    `insert into code_counters (scope, next_no) values ($1, 2)
     on conflict (scope) do update set next_no = code_counters.next_no + 1
     returning next_no - 1 as n`,
    [scope],
    db,
  );
  return row!.n;
}

export async function nextObservationCode(db: Db, siteCode: string): Promise<string> {
  const year = localDate().slice(0, 4);
  const n = await nextNumber(db, `obs:${siteCode}:${year}`);
  return `OBS-${siteCode}-${year}-${String(n).padStart(5, "0")}`;
}

export async function nextRoundCode(db: Db, siteCode: string): Promise<string> {
  const ymd = localDate().replace(/-/g, "");
  const n = await nextNumber(db, `rnd:${siteCode}:${ymd}`);
  return `RND-${siteCode}-${ymd}-${String(n).padStart(2, "0")}`;
}

async function masterLabel(db: Db, orgId: string, list: string, code: string): Promise<string | null> {
  if (!code) return null;
  const row = await one<{ label: string }>(
    `select label from master_items where list = $1 and code = $2 and (org_id = $3 or org_id is null)
     order by org_id nulls last limit 1`,
    [list, code, orgId],
    db,
  );
  return row?.label ?? null;
}

/** Is the user allowed to be the action owner of a point on this site? */
async function isValidOwner(db: Db, siteId: string, userId: string): Promise<boolean> {
  const row = await one(
    `select 1 from memberships m join users u on u.id = m.user_id
      where m.user_id = $1 and u.active and m.site_id = $2 and m.role in ('supervisor','safety_officer') limit 1`,
    [userId, siteId],
    db,
  );
  return !!row;
}

function snapshotOf(row: any) {
  const { version, updated_at, ...rest } = row;
  return rest;
}

async function addVersion(db: Db, obsId: string, version: number, actorId: string, action: string, changes: Record<string, [unknown, unknown]> = {}, reason = "", snapshot?: unknown) {
  await q(
    `insert into observation_versions (observation_id, version, actor_id, action, changes, reason, snapshot) values ($1,$2,$3,$4,$5,$6,$7)`,
    [obsId, version, actorId, action, JSON.stringify(changes), reason, snapshot ? JSON.stringify(snapshot) : null],
    db,
  );
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

// ---------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------

export async function createObservation(
  u: AuthUser,
  raw: unknown,
  images: { evidence: UploadedImage[]; after: UploadedImage[] },
  ip: string,
): Promise<{ id: string; duplicate: boolean }> {
  const input = parse(createSchema, raw);

  // Idempotent retry from the offline queue: same id from the same user returns the saved record.
  const existing = await one<{ raised_by: string }>(`select raised_by from observations where id = $1`, [input.id]);
  if (existing) {
    if (existing.raised_by === u.id) return { id: input.id, duplicate: true };
    throw conflict("An observation with this ID already exists.");
  }

  if (!canRaise(u, input.siteId)) throw forbidden("Only the site's safety officers raise observation points.");
  const site = await one<{ id: string; code: string; org_id: string; active: boolean; name: string }>(
    `select id, code, org_id, active, name from sites where id = $1`,
    [input.siteId],
  );
  if (!site || site.org_id !== u.orgId || !site.active) throw badRequest("Site not found or inactive.");

  // Photos: at least 1, at most 2 evidence photos; up to 2 after-photos when corrected on the spot.
  if (images.evidence.length < 1) throw badRequest("Add at least 1 photo (maximum 2).");
  if (images.evidence.length > 2) throw badRequest("A point can have at most 2 photos.");
  if (images.after.length > 2) throw badRequest("At most 2 after-photos.");

  const t = input.type;
  const needsAction = t !== "safe_behaviour" && !input.correctedOnSpot;
  if (t === "unsafe_act" || t === "unsafe_condition") {
    if (!input.categoryCode) throw badRequest("Choose a category.");
    if (!input.itemCode) throw badRequest("Choose the specific observation.");
    if (input.itemCode === "other" && !input.itemOther) throw badRequest("Describe the observation for 'Other'.");
  }
  if (t === "unsafe_act" && !input.personObserved) throw badRequest("Person observed (trade/role and employer) is required for unsafe acts.");
  if (t !== "safe_behaviour") {
    if (!input.hazard) throw badRequest("Choose the hazard type.");
    if (!input.severity || !input.likelihood) throw badRequest("Set severity and likelihood.");
    if (!input.immediateAction) throw badRequest("Choose the immediate action taken.");
    if (!input.rootCause) throw badRequest("Choose the likely root cause.");
  }
  if (needsAction && !input.correctiveAction) throw badRequest("Describe the corrective / preventive action.");

  const now = new Date();
  let observedAt = input.observedAt ? new Date(input.observedAt) : now;
  if (observedAt.getTime() > now.getTime() + 5 * 60_000) throw badRequest("Observed time cannot be in the future.");
  if (now.getTime() - observedAt.getTime() > 36 * 3600_000) throw badRequest("Observed time must be today.");

  const org = await getOrg(u.orgId);
  const risk = t === "safe_behaviour" ? { score: null, level: null as RiskLevel | null } : riskOf(input.severity, input.likelihood, input.workStopped);

  let category = "", item = "";
  if (input.categoryCode) {
    const lbl = await masterLabel(pool, u.orgId, "category", input.categoryCode);
    if (!lbl) throw badRequest("Unknown category.");
    category = lbl;
  }
  if (input.itemCode) {
    if (input.itemCode === "other") item = input.itemOther;
    else {
      const lbl = await masterLabel(pool, u.orgId, "item", input.itemCode);
      if (!lbl) throw badRequest("Unknown observation item.");
      item = lbl;
    }
  }
  if (input.areaId) {
    const a = await one(`select 1 from areas where id = $1 and site_id = $2`, [input.areaId, site.id]);
    if (!a) throw badRequest("Area does not belong to this site.");
  }
  if (input.contractorId) {
    const c = await one(`select 1 from contractors where id = $1 and org_id = $2`, [input.contractorId, u.orgId]);
    if (!c) throw badRequest("Unknown contractor.");
  }
  if (input.roundId) {
    const r = await one<{ site_id: string; status: string; observer_id: string }>(`select site_id, status, observer_id from rounds where id = $1`, [input.roundId]);
    if (!r || r.site_id !== site.id) throw badRequest("Round not found for this site.");
    if (r.observer_id !== u.id && !isAdmin(u)) throw forbidden("This safety walk belongs to another safety officer.");
  }
  let ownerId: string | null = null;
  if (needsAction && input.ownerId) {
    if (!(await isValidOwner(pool, site.id, input.ownerId))) throw badRequest("The action owner must be a supervisor or safety officer of this site.");
    ownerId = input.ownerId;
  }
  let dueAt: Date | null = null;
  if (needsAction) {
    if (input.dueAt) {
      dueAt = new Date(input.dueAt);
      if (dueAt.getTime() < now.getTime()) throw badRequest("Due date cannot be in the past.");
    } else {
      dueAt = addDays(now, org.settings.dueDays[risk.level ?? "Low"] ?? 7);
    }
  }

  const status = t === "safe_behaviour" ? "noted" : input.correctedOnSpot ? "closed" : "open";

  const evidence = await storePhotos(images.evidence);
  let after: StoredPhoto[] = [];
  try {
    after = await storePhotos(images.after);
  } catch (e) {
    await discardPhotos(evidence);
    throw e;
  }

  try {
    await tx(async (c) => {
      const code = await nextObservationCode(c, site.code);
      let repeatOf: string | null = null;
      if (input.itemCode && input.itemCode !== "other" && input.areaId) {
        const rep = await one<{ id: string }>(
          `select id from observations where site_id = $1 and item_code = $2 and area_id = $3 and status <> 'cancelled'
             and raised_at > now() - interval '30 days' order by raised_at desc limit 1`,
          [site.id, input.itemCode, input.areaId],
          c,
        );
        repeatOf = rep?.id ?? null;
      }
      const row = await one<any>(
        `insert into observations (
           id, org_id, site_id, code, round_id, area_id, location, lat, lng, observed_at, raised_by, raised_at,
           obs_type, category_code, category, item_code, item, hazard, activity, lsr, permit_type, permit_no, equipment,
           person_observed, contractor_id, crew_size, severity, likelihood, risk_score, risk_level, work_stopped,
           description, immediate_action, root_cause, corrective_action, control_level, corrected_on_spot,
           owner_id, assigned_at, due_at, legal_ref, status, repeat_of, closed_at, closed_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),
           $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
           $23,$24,$25,$26,$27,$28,$29,$30,
           $31,$32,$33,$34,$35,$36,
           $37, case when $37::uuid is null then null else now() end, $38, $39, $40, $41,
           case when $40 = 'closed' then now() else null end, case when $40 = 'closed' then $11::uuid else null end)
         returning *`,
        [
          input.id, u.orgId, site.id, code, input.roundId ?? null, input.areaId ?? null, input.location, input.lat ?? null, input.lng ?? null, observedAt.toISOString(), u.id,
          t, input.categoryCode, category, input.itemCode, item, input.hazard, input.activity, input.lsr, input.permitType, input.permitNo, input.equipment,
          input.personObserved, input.contractorId ?? null, input.crewSize ?? null, t === "safe_behaviour" ? null : input.severity, t === "safe_behaviour" ? null : input.likelihood, risk.score, risk.level, input.workStopped,
          input.description, input.immediateAction, input.rootCause, input.correctiveAction, input.controlLevel, input.correctedOnSpot,
          ownerId, dueAt ? dueAt.toISOString() : null, input.legalRef, status, repeatOf,
        ],
        c,
      );
      for (const p of evidence) {
        await q(
          `insert into observation_photos (observation_id, kind, storage_key, mime, bytes, width, height, uploaded_by) values ($1,'evidence',$2,$3,$4,$5,$6,$7)`,
          [input.id, p.key, p.mime, p.bytes, p.width, p.height, u.id],
          c,
        );
      }
      if (input.correctedOnSpot && t !== "safe_behaviour") {
        const cl = await one<{ id: string }>(
          `insert into closures (observation_id, attempt, comment, completed_on, control_level, submitted_by, decision, decided_by, decided_at, remarks, onsite_verified)
           values ($1, 1, $2, current_date, $3, $4, 'approved', $4, now(), 'Corrected on the spot', true) returning id`,
          [input.id, input.correctiveAction || input.immediateAction || "Corrected on the spot", input.controlLevel, u.id],
          c,
        );
        for (const p of after) {
          await q(
            `insert into observation_photos (observation_id, closure_id, kind, storage_key, mime, bytes, width, height, uploaded_by) values ($1,$2,'closure',$3,$4,$5,$6,$7,$8)`,
            [input.id, cl!.id, p.key, p.mime, p.bytes, p.width, p.height, u.id],
            c,
          );
        }
      }
      await addVersion(c, input.id, 1, u.id, input.correctedOnSpot ? "created_closed_on_spot" : "created", {}, "", snapshotOf(row));
      if (ownerId && ownerId !== u.id) {
        await notify(c, [ownerId], {
          kind: "assigned",
          observationId: input.id,
          title: `${code} assigned to you (${risk.level ?? ""} risk)`,
          body: `${site.name}: ${item || input.hazard || TYPE_LABEL[t]}. Due ${dueAt ? dueAt.toDateString() : ""}.`,
        });
      }
      if (risk.level === "Critical" && status === "open") {
        const sos = (await siteSafetyOfficers(c, site.id)).filter((x) => x !== u.id);
        await notify(c, sos, {
          kind: "critical",
          observationId: input.id,
          title: `Critical observation ${code}`,
          body: `${site.name}: ${input.description.slice(0, 200)}`,
        });
      }
    });
  } catch (e: any) {
    await discardPhotos([...evidence, ...after]);
    if (e?.code === "23505" && String(e?.constraint || "").includes("observations_pkey")) {
      return { id: input.id, duplicate: true };
    }
    throw e;
  }
  if (input.correctedOnSpot) await audit({ orgId: u.orgId, actorId: u.id, action: "observation.closed_on_spot", entity: "observation", entityId: input.id, ip });
  return { id: input.id, duplicate: false };
}

// ---------------------------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------------------------

export function canSee(u: AuthUser, obs: { site_id: string; owner_id: string | null; raised_by: string }, closureSubmitters: string[] = []): boolean {
  if (canViewWholeSite(u, obs.site_id)) return true;
  if (obs.owner_id === u.id || obs.raised_by === u.id) return true;
  return closureSubmitters.includes(u.id);
}

const LIST_SELECT = `
  o.id, o.code, o.obs_type, o.category, o.item, o.hazard, o.risk_level, o.status, o.due_at, o.raised_at, o.closed_at,
  o.closure_submitted_at, o.description, o.repeat_of is not null as is_repeat, o.work_stopped, o.lsr,
  s.id as site_id, s.code as site_code, s.name as site_name, a.name as area_name, o.location,
  ow.name as owner_name, rb.name as raised_by_name, ct.name as contractor_name,
  (o.status in ('open','in_progress') and o.due_at < now()) as overdue,
  (select p.storage_key from observation_photos p where p.observation_id = o.id and p.kind = 'evidence' and not p.withdrawn order by p.uploaded_at limit 1) as thumb_key`;

export function listItem(r: any) {
  return {
    id: r.id,
    code: r.code,
    type: r.obs_type,
    typeLabel: TYPE_LABEL[r.obs_type as ObsType],
    category: r.category,
    item: r.item,
    hazard: r.hazard,
    riskLevel: r.risk_level,
    status: r.status,
    overdue: !!r.overdue,
    dueAt: r.due_at,
    raisedAt: r.raised_at,
    closedAt: r.closed_at,
    closureSubmittedAt: r.closure_submitted_at,
    description: r.description,
    isRepeat: !!r.is_repeat,
    workStopped: r.work_stopped,
    lsr: r.lsr,
    site: { id: r.site_id, code: r.site_code, name: r.site_name },
    area: r.area_name,
    location: r.location,
    ownerName: r.owner_name,
    raisedByName: r.raised_by_name,
    contractorName: r.contractor_name,
    thumbUrl: r.thumb_key ? signedFileUrl(r.thumb_key) : null,
  };
}

export const listSchema = z.object({
  siteId: z.string().uuid().optional(),
  scope: z.enum(["all", "assigned", "raised", "approvals"]).default("all"),
  status: z.enum(["any", "open", "overdue", "awaiting", "closed", "cancelled", "noted", "active"]).default("any"),
  type: z.enum(OBS_TYPES).optional(),
  risk: z.enum(["Low", "Medium", "High", "Critical"]).optional(),
  roundId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  raisedToday: z.enum(["1", "0", "true", "false"]).optional().transform((v) => v === "1" || v === "true"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Sites whose observations the user can see in full. */
export async function fullSiteIds(u: AuthUser): Promise<string[]> {
  const rows = await q<{ id: string }>(`select id from sites where org_id = $1 and active`, [u.orgId]);
  return rows.map((r) => r.id).filter((id) => canViewWholeSite(u, id));
}

export async function listObservations(u: AuthUser, raw: unknown) {
  const f = parse(listSchema, raw);
  const where: string[] = ["o.org_id = $1"];
  const params: unknown[] = [u.orgId];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const full = await fullSiteIds(u);
  // Visibility: whole sites the user manages/views, plus anything assigned to or raised by them.
  where.push(`(o.site_id = any(${p(full)}::uuid[]) or o.owner_id = ${p(u.id)} or o.raised_by = $${params.length})`);
  if (f.siteId) where.push(`o.site_id = ${p(f.siteId)}`);
  if (f.scope === "assigned") where.push(`o.owner_id = ${p(u.id)}`);
  if (f.scope === "raised") where.push(`o.raised_by = ${p(u.id)}`);
  if (f.scope === "approvals") {
    const manageable = full.filter((id) => canManage(u, id));
    where.push(`o.site_id = any(${p(manageable)}::uuid[]) and o.status = 'closure_submitted'`);
    where.push(`not exists (select 1 from closures c where c.observation_id = o.id and c.decision = 'pending' and c.submitted_by = ${p(u.id)})`);
  }
  switch (f.status) {
    case "open": where.push(`o.status in ('open','in_progress')`); break;
    case "overdue": where.push(`o.status in ('open','in_progress') and o.due_at < now()`); break;
    case "awaiting": where.push(`o.status = 'closure_submitted'`); break;
    case "closed": where.push(`o.status = 'closed'`); break;
    case "cancelled": where.push(`o.status = 'cancelled'`); break;
    case "noted": where.push(`o.status = 'noted'`); break;
    case "active": where.push(`o.status in ('open','in_progress','closure_submitted')`); break;
    default: where.push(`o.status <> 'cancelled'`);
  }
  if (f.type) where.push(`o.obs_type = ${p(f.type)}`);
  if (f.risk) where.push(`o.risk_level = ${p(f.risk)}`);
  if (f.roundId) where.push(`o.round_id = ${p(f.roundId)}`);
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    where.push(`(o.code ilike ${p(like)} or o.description ilike $${params.length} or o.item ilike $${params.length} or o.location ilike $${params.length})`);
  }
  if (f.from) where.push(`o.raised_at >= ${p(f.from)}::date`);
  if (f.to) where.push(`o.raised_at < (${p(f.to)}::date + 1)`);
  if (f.raisedToday) where.push(`o.raised_at >= date_trunc('day', now())`);

  let order = "o.raised_at desc";
  if (f.status === "open" || f.status === "overdue" || f.status === "active") order = "o.due_at asc nulls last, o.raised_at";
  if (f.status === "closed") order = "o.closed_at desc";
  if (f.scope === "approvals" || f.status === "awaiting") order = "o.closure_submitted_at asc";

  const w = where.join(" and ");
  const offset = (f.page - 1) * f.pageSize;
  const [rows, total] = await Promise.all([
    q(
      `select ${LIST_SELECT}
         from observations o join sites s on s.id = o.site_id
         left join areas a on a.id = o.area_id left join users ow on ow.id = o.owner_id
         join users rb on rb.id = o.raised_by left join contractors ct on ct.id = o.contractor_id
        where ${w} order by ${order} limit ${f.pageSize} offset ${offset}`,
      params,
    ),
    one<{ n: number }>(`select count(*)::int as n from observations o where ${w}`, params),
  ]);
  return { items: rows.map(listItem), total: total?.n ?? 0, page: f.page, pageSize: f.pageSize };
}

export async function getObservation(u: AuthUser, id: string) {
  const o = await one<any>(
    `select o.*, s.code as site_code, s.name as site_name, s.state as site_state, a.name as area_name,
            ct.name as contractor_name, ow.name as owner_name, ow.designation as owner_designation,
            rb.name as raised_by_name, rb.designation as raised_by_designation, rb.employee_id as raised_by_employee_id,
            cb.name as closed_by_name, r.code as round_code, rep.code as repeat_of_code,
            (o.status in ('open','in_progress') and o.due_at < now()) as overdue
       from observations o join sites s on s.id = o.site_id
       left join areas a on a.id = o.area_id left join contractors ct on ct.id = o.contractor_id
       left join users ow on ow.id = o.owner_id join users rb on rb.id = o.raised_by
       left join users cb on cb.id = o.closed_by left join rounds r on r.id = o.round_id
       left join observations rep on rep.id = o.repeat_of
      where o.id = $1 and o.org_id = $2`,
    [id, u.orgId],
  );
  if (!o) throw notFound("Observation not found.");
  const [photos, closures, versions, comments] = await Promise.all([
    q(`select id, closure_id, kind, storage_key, width, height, uploaded_at, withdrawn, withdrawn_reason, uploaded_by from observation_photos where observation_id = $1 order by uploaded_at`, [id]),
    q(
      `select c.*, su.name as submitted_by_name, du.name as decided_by_name
         from closures c join users su on su.id = c.submitted_by left join users du on du.id = c.decided_by
        where c.observation_id = $1 order by c.attempt`,
      [id],
    ),
    q(
      `select v.id, v.version, v.at, v.action, v.changes, v.reason, u.name as actor_name
         from observation_versions v left join users u on u.id = v.actor_id where v.observation_id = $1 order by v.id`,
      [id],
    ),
    q(`select c.id, c.body, c.created_at, u.name as user_name, u.id as user_id from comments c join users u on u.id = c.user_id where c.observation_id = $1 order by c.created_at`, [id]),
  ]);
  const submitters = closures.map((c: any) => c.submitted_by);
  if (!canSee(u, o, submitters)) throw forbidden("You can only open observations of your site or assigned to you.");

  const manage = canManage(u, o.site_id);
  const pending = closures.find((c: any) => c.decision === "pending");
  const isOwner = o.owner_id === u.id;
  const active = ["open", "in_progress"].includes(o.status);
  return {
    id: o.id,
    code: o.code,
    type: o.obs_type,
    typeLabel: TYPE_LABEL[o.obs_type as ObsType],
    status: o.status,
    overdue: !!o.overdue,
    site: { id: o.site_id, code: o.site_code, name: o.site_name, state: o.site_state },
    round: o.round_id ? { id: o.round_id, code: o.round_code } : null,
    areaId: o.area_id,
    area: o.area_name,
    location: o.location,
    lat: o.lat,
    lng: o.lng,
    observedAt: o.observed_at,
    raisedAt: o.raised_at,
    raisedBy: { id: o.raised_by, name: o.raised_by_name, designation: o.raised_by_designation, employeeId: o.raised_by_employee_id },
    categoryCode: o.category_code,
    category: o.category,
    itemCode: o.item_code,
    item: o.item,
    hazard: o.hazard,
    activity: o.activity,
    lsr: o.lsr,
    permitType: o.permit_type,
    permitNo: o.permit_no,
    equipment: o.equipment,
    personObserved: o.person_observed,
    contractorId: o.contractor_id,
    contractorName: o.contractor_name,
    crewSize: o.crew_size,
    severity: o.severity,
    likelihood: o.likelihood,
    riskScore: o.risk_score,
    riskLevel: o.risk_level,
    workStopped: o.work_stopped,
    description: o.description,
    immediateAction: o.immediate_action,
    rootCause: o.root_cause,
    correctiveAction: o.corrective_action,
    controlLevel: o.control_level,
    correctedOnSpot: o.corrected_on_spot,
    owner: o.owner_id ? { id: o.owner_id, name: o.owner_name, designation: o.owner_designation } : null,
    assignedAt: o.assigned_at,
    dueAt: o.due_at,
    originalDueAt: o.original_due_at,
    legalRef: o.legal_ref,
    repeatOf: o.repeat_of ? { id: o.repeat_of, code: o.repeat_of_code } : null,
    closureSubmittedAt: o.closure_submitted_at,
    closedAt: o.closed_at,
    closedBy: o.closed_by_name,
    cancelReason: o.cancel_reason,
    version: o.version,
    photos: photos.map((p: any) => ({
      id: p.id,
      kind: p.kind,
      closureId: p.closure_id,
      url: signedFileUrl(p.storage_key),
      width: p.width,
      height: p.height,
      uploadedAt: p.uploaded_at,
      withdrawn: p.withdrawn,
      withdrawnReason: p.withdrawn_reason,
    })),
    closures: closures.map((c: any) => ({
      id: c.id,
      attempt: c.attempt,
      comment: c.comment,
      completedOn: c.completed_on,
      controlLevel: c.control_level,
      submittedBy: c.submitted_by_name,
      submittedById: c.submitted_by,
      submittedAt: c.submitted_at,
      decision: c.decision,
      decidedBy: c.decided_by_name,
      decidedAt: c.decided_at,
      remarks: c.remarks,
      onsiteVerified: c.onsite_verified,
    })),
    timeline: versions.map((v: any) => ({ id: v.id, version: v.version, at: v.at, action: v.action, changes: v.changes, reason: v.reason, actor: v.actor_name })),
    comments: comments.map((c: any) => ({ id: c.id, body: c.body, at: c.created_at, user: c.user_name, userId: c.user_id })),
    can: {
      edit: manage && active,
      assign: manage && active,
      extend: manage && active,
      start: isOwner && o.status === "open",
      submitClosure: active && (isOwner || manage),
      decide: o.status === "closure_submitted" && manage && !!pending && pending.submitted_by !== u.id,
      cancel: manage && ["open", "in_progress", "closure_submitted", "noted"].includes(o.status),
      reopen: manage && o.status === "closed",
      comment: true,
      withdrawPhoto: manage && o.status !== "closed" && o.status !== "cancelled",
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------------------------

async function lockObs(c: pg.PoolClient, u: AuthUser, id: string): Promise<any> {
  const o = await one<any>(`select o.*, s.name as site_name from observations o join sites s on s.id = o.site_id where o.id = $1 and o.org_id = $2 for update of o`, [id, u.orgId], c);
  if (!o) throw notFound("Observation not found.");
  return o;
}

async function bump(c: pg.PoolClient, o: any, sets: Record<string, unknown>, actorId: string, action: string, reason = "", changes?: Record<string, [unknown, unknown]>) {
  const cols = Object.keys(sets);
  const ch: Record<string, [unknown, unknown]> = changes ?? {};
  if (!changes) for (const k of cols) if (String(o[k] ?? "") !== String(sets[k] ?? "")) ch[k] = [o[k] ?? null, sets[k] ?? null];
  const assign = cols.map((k, i) => `${k} = $${i + 2}`).join(", ");
  const row = await one<any>(
    `update observations set ${assign}${cols.length ? ", " : ""}version = version + 1, updated_at = now() where id = $1 returning *`,
    [o.id, ...cols.map((k) => sets[k])],
    c,
  );
  await addVersion(c, o.id, row.version, actorId, action, ch, reason, snapshotOf(row));
  return row;
}

export const editSchema = z.object({
  areaId: uuidOpt,
  location: z.string().trim().max(200).optional(),
  categoryCode: z.string().trim().max(80).optional(),
  itemCode: z.string().trim().max(80).optional(),
  itemOther: z.string().trim().max(300).optional(),
  hazard: z.string().trim().max(100).optional(),
  activity: z.string().trim().max(160).optional(),
  lsr: z.string().trim().max(160).optional(),
  permitType: z.string().trim().max(80).optional(),
  permitNo: z.string().trim().max(60).optional(),
  equipment: z.string().trim().max(120).optional(),
  personObserved: z.string().trim().max(160).optional(),
  contractorId: uuidOpt,
  crewSize: z.coerce.number().int().min(0).max(5000).nullable().optional(),
  severity: level15,
  likelihood: level15,
  workStopped: z.boolean().optional(),
  description: z.string().trim().min(3).max(4000).optional(),
  immediateAction: z.string().trim().max(200).optional(),
  rootCause: z.string().trim().max(200).optional(),
  correctiveAction: z.string().trim().max(2000).optional(),
  controlLevel: z.string().trim().max(40).optional(),
  ownerId: uuidOpt,
  legalRef: z.string().trim().max(600).optional(),
  reason: z.string().trim().max(500).default(""),
});

const EDIT_COLS: Record<string, string> = {
  areaId: "area_id", location: "location", hazard: "hazard", activity: "activity", lsr: "lsr", permitType: "permit_type",
  permitNo: "permit_no", equipment: "equipment", personObserved: "person_observed", contractorId: "contractor_id", crewSize: "crew_size",
  severity: "severity", likelihood: "likelihood", workStopped: "work_stopped", description: "description", immediateAction: "immediate_action",
  rootCause: "root_cause", correctiveAction: "corrective_action", controlLevel: "control_level", legalRef: "legal_ref",
};

export async function editObservation(u: AuthUser, id: string, raw: unknown) {
  const input = parse(editSchema, raw);
  await tx(async (c) => {
    const o = await lockObs(c, u, id);
    if (!canManage(u, o.site_id)) throw forbidden("Only the site's safety officers can edit observations.");
    if (!["open", "in_progress", "closure_submitted", "noted"].includes(o.status)) throw badRequest("Closed or cancelled observations cannot be edited; reopen first.");
    const sets: Record<string, unknown> = {};
    for (const [k, col] of Object.entries(EDIT_COLS)) {
      const v = (input as any)[k];
      if (v !== undefined) sets[col] = v;
    }
    if (input.areaId) {
      const a = await one(`select 1 from areas where id = $1 and site_id = $2`, [input.areaId, o.site_id], c);
      if (!a) throw badRequest("Area does not belong to this site.");
    }
    if (input.contractorId) {
      const ct = await one(`select 1 from contractors where id = $1 and org_id = $2`, [input.contractorId, u.orgId], c);
      if (!ct) throw badRequest("Unknown contractor.");
    }
    if (input.categoryCode !== undefined) {
      const lbl = input.categoryCode ? await masterLabel(c, u.orgId, "category", input.categoryCode) : "";
      if (lbl === null) throw badRequest("Unknown category.");
      sets.category_code = input.categoryCode;
      sets.category = lbl;
    }
    if (input.itemCode !== undefined) {
      let lbl: string | null = "";
      if (input.itemCode === "other") lbl = input.itemOther ?? o.item;
      else if (input.itemCode) lbl = await masterLabel(c, u.orgId, "item", input.itemCode);
      if (lbl === null) throw badRequest("Unknown observation item.");
      sets.item_code = input.itemCode;
      sets.item = lbl;
    }
    if (o.obs_type !== "safe_behaviour" && ("severity" in sets || "likelihood" in sets || "work_stopped" in sets)) {
      const sev = (sets.severity ?? o.severity) as number;
      const lik = (sets.likelihood ?? o.likelihood) as number;
      const ws = (sets.work_stopped ?? o.work_stopped) as boolean;
      const r = riskOf(sev, lik, ws);
      sets.risk_score = r.score;
      sets.risk_level = r.level;
    }
    let notifyOwner: string | null = null;
    if (input.ownerId !== undefined && input.ownerId !== o.owner_id) {
      if (o.obs_type === "safe_behaviour") throw badRequest("Safe-behaviour points have no action owner.");
      if (input.ownerId && !(await isValidOwner(c, o.site_id, input.ownerId))) throw badRequest("The action owner must be a supervisor or safety officer of this site.");
      sets.owner_id = input.ownerId;
      sets.assigned_at = input.ownerId ? new Date().toISOString() : null;
      notifyOwner = input.ownerId ?? null;
    }
    if (!Object.keys(sets).length) return;
    // Only keep fields that actually changed.
    for (const k of Object.keys(sets)) if (String(o[k] ?? "") === String(sets[k] ?? "")) delete sets[k];
    if (!Object.keys(sets).length) return;
    const action = Object.keys(sets).length === 2 && "owner_id" in sets ? "assigned" : "edited";
    await bump(c, o, sets, u.id, action, input.reason);
    if (notifyOwner && notifyOwner !== u.id) {
      await notify(c, [notifyOwner], {
        kind: "assigned",
        observationId: o.id,
        title: `${o.code} assigned to you`,
        body: `${o.site_name}: ${o.item || o.hazard}. Due ${o.due_at ? new Date(o.due_at).toDateString() : "—"}.`,
      });
    }
  });
}

export async function startWork(u: AuthUser, id: string) {
  await tx(async (c) => {
    const o = await lockObs(c, u, id);
    if (o.owner_id !== u.id) throw forbidden("Only the action owner can start work on this point.");
    if (o.status !== "open") throw badRequest("Work can only be started on an open point.");
    await bump(c, o, { status: "in_progress" }, u.id, "started");
  });
}

export const closureSchema = z.object({
  comment: z.string().trim().min(3, "A closure comment is required.").max(2000),
  completedOn: z.string().date().optional(),
  controlLevel: z.string().trim().max(40).default(""),
});

export async function submitClosure(u: AuthUser, id: string, raw: unknown, photos: UploadedImage[]) {
  const input = parse(closureSchema, raw);
  if (photos.length > 2) throw badRequest("At most 2 closure photos.");
  const completedOn = input.completedOn ?? localDate();
  if (completedOn > localDate()) throw badRequest("Completion date cannot be in the future.");
  const stored = await storePhotos(photos);
  try {
    await tx(async (c) => {
      const o = await lockObs(c, u, id);
      const manage = canManage(u, o.site_id);
      if (o.owner_id !== u.id && !manage) throw forbidden("Only the action owner or the site safety officer can submit the closure.");
      if (!["open", "in_progress"].includes(o.status)) throw badRequest("This point is not open for closure.");
      const att = await one<{ n: number }>(`select coalesce(max(attempt), 0) + 1 as n from closures where observation_id = $1`, [id], c);
      const cl = await one<{ id: string }>(
        `insert into closures (observation_id, attempt, comment, completed_on, control_level, submitted_by) values ($1,$2,$3,$4,$5,$6) returning id`,
        [id, att!.n, input.comment, completedOn, input.controlLevel, u.id],
        c,
      );
      for (const p of stored) {
        await q(
          `insert into observation_photos (observation_id, closure_id, kind, storage_key, mime, bytes, width, height, uploaded_by) values ($1,$2,'closure',$3,$4,$5,$6,$7,$8)`,
          [id, cl!.id, p.key, p.mime, p.bytes, p.width, p.height, u.id],
          c,
        );
      }
      await bump(c, o, { status: "closure_submitted", closure_submitted_at: new Date().toISOString() }, u.id, "closure_submitted", "", {
        status: [o.status, "closure_submitted"],
        closure_attempt: [null, att!.n],
      });
      let approvers = (await siteSafetyOfficers(c, o.site_id)).filter((x) => x !== u.id);
      if (!approvers.length) approvers = (await companyAdmins(c, o.org_id)).filter((x) => x !== u.id);
      await notify(c, approvers, {
        kind: "closure_submitted",
        observationId: id,
        title: `Closure submitted for ${o.code}`,
        body: `${u.name}: ${input.comment.slice(0, 300)}`,
      });
    });
  } catch (e) {
    await discardPhotos(stored);
    throw e;
  }
}

export const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  remarks: z.string().trim().max(1000).default(""),
  onsiteVerified: z.boolean().default(false),
});

export async function decideClosure(u: AuthUser, id: string, raw: unknown) {
  const input = parse(decisionSchema, raw);
  if (input.decision === "reject" && input.remarks.length < 3) throw badRequest("Give a reason for rejecting the closure.");
  await tx(async (c) => {
    const o = await lockObs(c, u, id);
    if (!canManage(u, o.site_id)) throw forbidden("Only the site's safety officer can approve or reject a closure.");
    if (o.status !== "closure_submitted") {
      const last = await one<any>(`select c.decision, u.name from closures c left join users u on u.id = c.decided_by where c.observation_id = $1 order by c.attempt desc limit 1`, [id], c);
      if (last && last.decision !== "pending") throw conflict(`This closure was already ${last.decision} by ${last.name ?? "another user"}.`);
      throw badRequest("There is no closure waiting for approval.");
    }
    const pending = await one<any>(`select * from closures where observation_id = $1 and decision = 'pending' order by attempt desc limit 1`, [id], c);
    if (!pending) throw badRequest("There is no closure waiting for approval.");
    if (pending.submitted_by === u.id) throw forbidden("You cannot approve a closure you submitted yourself; another safety officer or an admin must approve it.");
    await q(
      `update closures set decision = $2, decided_by = $3, decided_at = now(), remarks = $4, onsite_verified = $5 where id = $1`,
      [pending.id, input.decision === "approve" ? "approved" : "rejected", u.id, input.remarks, input.onsiteVerified],
      c,
    );
    if (input.decision === "approve") {
      await bump(c, o, { status: "closed", closed_at: new Date().toISOString(), closed_by: u.id }, u.id, "approved", input.remarks, {
        status: [o.status, "closed"],
      });
      await notify(c, [pending.submitted_by, o.owner_id].filter((x) => x !== u.id), {
        kind: "approved",
        observationId: id,
        title: `${o.code} closed`,
        body: `Closure approved by ${u.name}.${input.remarks ? " " + input.remarks : ""}`,
      });
    } else {
      await bump(c, o, { status: "in_progress" }, u.id, "rejected", input.remarks, { status: [o.status, "in_progress"] });
      await notify(c, [pending.submitted_by, o.owner_id].filter((x) => x !== u.id), {
        kind: "rejected",
        observationId: id,
        title: `Closure rejected for ${o.code}`,
        body: `${u.name}: ${input.remarks}`,
      });
    }
  });
}

const reasonSchema = z.object({ reason: z.string().trim().min(3, "A reason is required.").max(1000) });

export async function cancelObservation(u: AuthUser, id: string, raw: unknown) {
  const { reason } = parse(reasonSchema, raw);
  await tx(async (c) => {
    const o = await lockObs(c, u, id);
    if (!canManage(u, o.site_id)) throw forbidden("Only the site's safety officer can cancel an observation.");
    if (["closed", "cancelled"].includes(o.status)) throw badRequest("This observation cannot be cancelled.");
    await q(`update closures set decision = 'rejected', decided_by = $2, decided_at = now(), remarks = 'Observation cancelled' where observation_id = $1 and decision = 'pending'`, [id, u.id], c);
    await bump(c, o, { status: "cancelled", cancel_reason: reason }, u.id, "cancelled", reason);
  });
}

export async function reopenObservation(u: AuthUser, id: string, raw: unknown) {
  const { reason } = parse(reasonSchema, raw);
  await tx(async (c) => {
    const o = await lockObs(c, u, id);
    if (!canManage(u, o.site_id)) throw forbidden("Only the site's safety officer can reopen an observation.");
    if (o.status !== "closed") throw badRequest("Only closed observations can be reopened.");
    await bump(c, o, { status: o.owner_id ? "in_progress" : "open", closed_at: null, closed_by: null }, u.id, "reopened", reason);
    if (o.owner_id && o.owner_id !== u.id) {
      await notify(c, [o.owner_id], { kind: "reopened", observationId: id, title: `${o.code} reopened`, body: reason });
    }
  });
}

const extendSchema = z.object({ dueAt: z.string().datetime({ offset: true }), reason: z.string().trim().min(3, "A reason is required.").max(1000) });

export async function extendDue(u: AuthUser, id: string, raw: unknown) {
  const input = parse(extendSchema, raw);
  await tx(async (c) => {
    const o = await lockObs(c, u, id);
    if (!canManage(u, o.site_id)) throw forbidden("Only the site's safety officer can extend a due date.");
    if (!["open", "in_progress"].includes(o.status)) throw badRequest("Only open points can have their due date extended.");
    const nd = new Date(input.dueAt);
    if (o.due_at && nd.getTime() <= new Date(o.due_at).getTime()) throw badRequest("The new due date must be later than the current one.");
    await bump(c, o, { due_at: nd.toISOString(), original_due_at: o.original_due_at ?? o.due_at }, u.id, "due_extended", input.reason, {
      due_at: [o.due_at, nd.toISOString()],
    });
    if (o.owner_id && o.owner_id !== u.id) {
      await notify(c, [o.owner_id], { kind: "due_extended", observationId: id, title: `${o.code}: due date extended`, body: `New due date ${nd.toDateString()}. ${input.reason}` });
    }
  });
}

const commentSchema = z.object({ body: z.string().trim().min(1).max(2000) });

export async function addComment(u: AuthUser, id: string, raw: unknown) {
  const { body } = parse(commentSchema, raw);
  const o = await one<any>(`select id, site_id, owner_id, raised_by, code from observations where id = $1 and org_id = $2`, [id, u.orgId]);
  if (!o) throw notFound();
  const subs = (await q<{ submitted_by: string }>(`select submitted_by from closures where observation_id = $1`, [id])).map((r) => r.submitted_by);
  if (!canSee(u, o, subs)) throw forbidden();
  await tx(async (c) => {
    await q(`insert into comments (observation_id, user_id, body) values ($1,$2,$3)`, [id, u.id, body], c);
    await notify(c, [o.owner_id, o.raised_by].filter((x: string | null) => x && x !== u.id), {
      kind: "comment",
      observationId: id,
      title: `New comment on ${o.code}`,
      body: `${u.name}: ${body.slice(0, 300)}`,
    });
  });
}

export async function withdrawPhoto(u: AuthUser, photoId: string, raw: unknown) {
  const { reason } = parse(reasonSchema, raw);
  await tx(async (c) => {
    const p = await one<any>(`select p.*, o.org_id from observation_photos p join observations o on o.id = p.observation_id where p.id = $1`, [photoId], c);
    if (!p || p.org_id !== u.orgId) throw notFound("Photo not found.");
    const o = await lockObs(c, u, p.observation_id);
    if (!canManage(u, o.site_id)) throw forbidden();
    if (p.withdrawn) return;
    if (p.kind === "evidence") {
      const left = await one<{ n: number }>(`select count(*)::int as n from observation_photos where observation_id = $1 and kind = 'evidence' and not withdrawn`, [o.id], c);
      if ((left?.n ?? 0) <= 1) throw badRequest("A point must keep at least 1 photo. Add the correct photo before withdrawing this one.");
    }
    await q(`update observation_photos set withdrawn = true, withdrawn_reason = $2 where id = $1`, [photoId, reason], c);
    await bump(c, o, {}, u.id, "photo_withdrawn", reason, { photo: [photoId, "withdrawn"] });
  });
}

export async function addEvidencePhoto(u: AuthUser, id: string, photos: UploadedImage[]) {
  if (!photos.length) throw badRequest("No photo received.");
  const stored = await storePhotos(photos);
  try {
    await tx(async (c) => {
      const o = await lockObs(c, u, id);
      if (!canManage(u, o.site_id)) throw forbidden();
      const n = await one<{ n: number }>(`select count(*)::int as n from observation_photos where observation_id = $1 and kind = 'evidence' and not withdrawn`, [id], c);
      if ((n?.n ?? 0) + stored.length > 2) throw badRequest("A point can have at most 2 photos. Withdraw one first.");
      for (const p of stored) {
        await q(
          `insert into observation_photos (observation_id, kind, storage_key, mime, bytes, width, height, uploaded_by) values ($1,'evidence',$2,$3,$4,$5,$6,$7)`,
          [id, p.key, p.mime, p.bytes, p.width, p.height, u.id],
          c,
        );
      }
      await bump(c, o, {}, u.id, "photo_added", "", { photos: [null, stored.length] });
    });
  } catch (e) {
    await discardPhotos(stored);
    throw e;
  }
}

export { rolesAt };
