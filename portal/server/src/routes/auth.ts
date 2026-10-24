import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { one, q, tx } from "../db.js";
import { HttpError, unauthorized, forbidden, badRequest } from "../errors.js";
import { audit } from "../audit.js";
import { createSession, forgetToken, loadMemberships, requireUser, revokeUserSessions, tokenFrom } from "../auth.js";
import { canUseAdminConsole, ROLE_LABEL } from "../rbac.js";
import { dummyVerify, hashPassword, passwordProblem, verifyPassword } from "../security.js";
import { parseInput } from "../observations.js";

const loginSchema = z.object({
  employeeId: z.string().trim().min(1, "Enter your employee ID.").max(64),
  password: z.string().min(1, "Enter your password.").max(200),
  app: z.enum(["portal", "admin"]).default("portal"),
});

const changeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

export async function mePayload(userId: string) {
  const u = await one<any>(
    `select u.id, u.org_id, u.employee_id, u.name, u.designation, u.phone, u.email, u.must_change_password, o.name as org_name
       from users u join organisations o on o.id = u.org_id where u.id = $1`,
    [userId],
  );
  const memberships = await loadMemberships(userId);
  const siteRows = await q<{ id: string; code: string; name: string }>(`select id, code, name from sites where org_id = $1`, [u.org_id]);
  const siteById = new Map(siteRows.map((s) => [s.id, s]));
  const unread = await one<{ n: number }>(`select count(*)::int as n from notifications where user_id = $1 and read_at is null`, [userId]);
  return {
    id: u.id,
    employeeId: u.employee_id,
    name: u.name,
    designation: u.designation,
    phone: u.phone,
    email: u.email,
    mustChangePassword: u.must_change_password,
    company: u.org_name,
    roles: memberships.map((m) => ({
      role: m.role,
      roleLabel: ROLE_LABEL[m.role],
      siteId: m.siteId,
      siteCode: m.siteId ? siteById.get(m.siteId)?.code ?? null : null,
      siteName: m.siteId ? siteById.get(m.siteId)?.name ?? null : "All sites",
    })),
    unreadNotifications: unread?.n ?? 0,
  };
}

const GENERIC = "Employee ID or password is incorrect.";

export default async function authRoutes(app: FastifyInstance) {
  app.post(
    "/api/auth/login",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
          hook: "preHandler",
          keyGenerator: (req: any) => `login:${req.ip}:${String(req.body?.employeeId ?? "").toLowerCase().slice(0, 64)}`,
        },
      },
    },
    async (req) => {
      const input = parseInput(loginSchema, req.body);
      const ua = String(req.headers["user-agent"] ?? "");
      const user = await one<any>(
        `select id, org_id, password_hash, active, failed_attempts, locked_until, must_change_password
           from users where lower(employee_id) = lower($1) order by active desc limit 1`,
        [input.employeeId],
      );
      if (!user || !user.active) {
        await dummyVerify(input.password);
        await audit({ orgId: user?.org_id ?? null, actorId: user?.id ?? null, action: "login.failed", entity: "user", entityId: input.employeeId, ip: req.ip, details: { reason: user ? "inactive" : "unknown", app: input.app } });
        throw unauthorized(GENERIC);
      }
      if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
        await dummyVerify(input.password);
        const until = new Date(user.locked_until).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: config.timezone });
        throw new HttpError(423, `This account is locked after too many wrong passwords. Try again after ${until}, or ask your admin to unlock it.`, "locked");
      }
      const ok = await verifyPassword(input.password, user.password_hash);
      if (!ok) {
        const fails = user.failed_attempts + 1;
        const lock = fails >= config.maxFailedLogins;
        await q(
          `update users set failed_attempts = $2, locked_until = case when $3 then now() + make_interval(mins => $4) else locked_until end where id = $1`,
          [user.id, lock ? 0 : fails, lock, config.lockMinutes],
        );
        await audit({ orgId: user.org_id, actorId: user.id, action: lock ? "login.locked" : "login.failed", entity: "user", entityId: user.id, ip: req.ip, details: { attempt: fails, app: input.app } });
        if (lock) throw new HttpError(423, `Too many wrong passwords. The account is locked for ${config.lockMinutes} minutes, or ask your admin to unlock it.`, "locked");
        throw unauthorized(GENERIC);
      }
      const memberships = await loadMemberships(user.id);
      if (input.app === "admin" && !canUseAdminConsole({ memberships } as any)) {
        await audit({ orgId: user.org_id, actorId: user.id, action: "login.denied_admin", entity: "user", entityId: user.id, ip: req.ip });
        throw forbidden("This login does not have admin console access.");
      }
      if (!memberships.length) throw forbidden("Your login has no site or role yet. Ask your admin to assign one.");
      const session = await tx(async (c) => {
        await q(`update users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = $1`, [user.id], c);
        return createSession(user.id, input.app, req.ip, ua, c);
      });
      await audit({ orgId: user.org_id, actorId: user.id, action: "login", entity: "user", entityId: user.id, ip: req.ip, details: { app: input.app } });
      return { token: session.token, expiresAt: session.expiresAt, mustChangePassword: user.must_change_password, user: await mePayload(user.id) };
    },
  );

  app.post("/api/auth/logout", { preHandler: requireUser("any", { allowMustChange: true }) }, async (req) => {
    await q(`update sessions set revoked_at = now() where id = $1`, [req.user!.sessionId]);
    const t = tokenFrom(req);
    if (t) forgetToken(t);
    return { ok: true };
  });

  app.get("/api/me", { preHandler: requireUser("any", { allowMustChange: true }) }, async (req) => {
    return mePayload(req.user!.id);
  });

  app.post("/api/auth/change-password", { preHandler: requireUser("any", { allowMustChange: true }) }, async (req) => {
    const input = parseInput(changeSchema, req.body);
    const u = req.user!;
    const row = await one<{ password_hash: string }>(`select password_hash from users where id = $1`, [u.id]);
    if (!row || !(await verifyPassword(input.currentPassword, row.password_hash))) throw badRequest("Current password is incorrect.");
    const problem = passwordProblem(input.newPassword);
    if (problem) throw badRequest(problem);
    if (input.newPassword === input.currentPassword) throw badRequest("Choose a password different from the current one.");
    const hash = await hashPassword(input.newPassword);
    await q(`update users set password_hash = $2, must_change_password = false, password_changed_at = now() where id = $1`, [u.id, hash]);
    await revokeUserSessions(u.id, u.sessionId);
    await audit({ orgId: u.orgId, actorId: u.id, action: "password.changed", entity: "user", entityId: u.id, ip: req.ip });
    return { ok: true };
  });
}
