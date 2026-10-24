import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { one, pool, q, Db } from "./db.js";
import { HttpError, unauthorized, forbidden } from "./errors.js";
import { AuthUser, Membership, canUseAdminConsole } from "./rbac.js";
import { newToken, sha256 } from "./security.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

interface CacheEntry {
  user: AuthUser;
  expiresAt: number;
  cachedAt: number;
}

// Short-lived in-process cache so each request does not hit the sessions table.
// Revocation (logout, password reset, deactivation) clears entries immediately on this instance;
// other instances pick it up within CACHE_MS.
const CACHE_MS = 30_000;
const LAST_SEEN_MS = 5 * 60_000;
const cache = new Map<string, CacheEntry>();
const lastSeenWrite = new Map<string, number>();

export function tokenFrom(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (h && h.startsWith("Bearer ")) return h.slice(7).trim() || null;
  return null;
}

export async function loadMemberships(userId: string, db: Db = pool): Promise<Membership[]> {
  const rows = await q<{ site_id: string | null; role: Membership["role"] }>(
    `select m.site_id, m.role from memberships m left join sites s on s.id = m.site_id
      where m.user_id = $1 and (m.site_id is null or s.active)`,
    [userId],
    db,
  );
  return rows.map((r) => ({ siteId: r.site_id, role: r.role }));
}

async function lookup(tokenHash: string): Promise<CacheEntry | null> {
  const now = Date.now();
  const hit = cache.get(tokenHash);
  if (hit && now - hit.cachedAt < CACHE_MS && hit.expiresAt > now) return hit;
  const row = await one<any>(
    `select s.id as session_id, s.kind, s.expires_at, s.last_seen_at,
            u.id, u.org_id, u.employee_id, u.name, u.designation, u.email, u.must_change_password
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and u.active`,
    [tokenHash],
  );
  if (!row) {
    cache.delete(tokenHash);
    return null;
  }
  const memberships = await loadMemberships(row.id);
  const entry: CacheEntry = {
    user: {
      id: row.id,
      orgId: row.org_id,
      employeeId: row.employee_id,
      name: row.name,
      designation: row.designation,
      email: row.email,
      mustChangePassword: row.must_change_password,
      memberships,
      sessionId: row.session_id,
      kind: row.kind,
    },
    expiresAt: new Date(row.expires_at).getTime(),
    cachedAt: now,
  };
  cache.set(tokenHash, entry);
  if (cache.size > 50_000) {
    // crude bound: drop the oldest entries
    for (const k of cache.keys()) {
      cache.delete(k);
      if (cache.size <= 40_000) break;
    }
  }
  const seen = lastSeenWrite.get(row.session_id) ?? new Date(row.last_seen_at).getTime();
  if (now - seen > LAST_SEEN_MS) {
    lastSeenWrite.set(row.session_id, now);
    pool.query(`update sessions set last_seen_at = now() where id = $1`, [row.session_id]).catch(() => {});
  }
  return entry;
}

export async function createSession(userId: string, kind: "portal" | "admin", ip: string, ua: string, db: Db = pool): Promise<{ token: string; expiresAt: string }> {
  const token = newToken();
  const hours = kind === "admin" ? config.sessionHoursAdmin : config.sessionHoursPortal;
  const row = await one<{ expires_at: string }>(
    `insert into sessions (user_id, token_hash, kind, expires_at, ip, user_agent)
     values ($1, $2, $3, now() + make_interval(hours => $4), $5, $6) returning expires_at`,
    [userId, sha256(token), kind, hours, ip, ua.slice(0, 300)],
    db,
  );
  return { token, expiresAt: new Date(row!.expires_at).toISOString() };
}

export function forgetUserInCache(userId: string): void {
  for (const [k, v] of cache) if (v.user.id === userId) cache.delete(k);
}

export function forgetToken(token: string): void {
  cache.delete(sha256(token));
}

export async function revokeUserSessions(userId: string, exceptSessionId: string | null, db: Db = pool): Promise<void> {
  await q(
    `update sessions set revoked_at = now() where user_id = $1 and revoked_at is null and ($2::uuid is null or id <> $2::uuid)`,
    [userId, exceptSessionId],
    db,
  );
  forgetUserInCache(userId);
}

type Kind = "portal" | "admin" | "any";

/**
 * Pre-handler: require a signed-in user.
 * - kind "admin": only admin-console sessions of users with an admin/viewer role
 * - allowMustChange: lets a user who must change their password reach this route
 */
export function requireUser(kind: Kind = "any", opts: { allowMustChange?: boolean } = {}) {
  return async function (req: FastifyRequest, _reply: FastifyReply) {
    const token = tokenFrom(req);
    if (!token) throw unauthorized();
    const entry = await lookup(sha256(token));
    if (!entry) throw unauthorized("Your session has ended. Please sign in again.");
    const u = entry.user;
    if (kind === "admin" && (u.kind !== "admin" || !canUseAdminConsole(u))) throw forbidden("Admin console access only.");
    if (kind === "portal" && u.kind !== "portal") throw forbidden("Use the SafeWorks portal or app for this.");
    if (u.mustChangePassword && !opts.allowMustChange) {
      throw new HttpError(403, "Please set a new password before continuing.", "must_change_password");
    }
    req.user = u;
  };
}
