import { config } from "./config.js";
import { Db, q } from "./db.js";

export interface Note {
  kind: string;
  title: string;
  body?: string;
  observationId?: string | null;
}

/** In-app notification for each user, plus an email when the user has an address on file. */
export async function notify(db: Db, userIds: (string | null | undefined)[], note: Note): Promise<void> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  await q(
    `insert into notifications (user_id, observation_id, kind, title, body)
     select unnest($1::uuid[]), $2, $3, $4, $5`,
    [ids, note.observationId ?? null, note.kind, note.title, note.body ?? ""],
    db,
  );
  const link = note.observationId ? `\n\nOpen: ${config.publicUrl}/o/${note.observationId}` : "";
  await q(
    `insert into email_outbox (to_addr, subject, body)
     select u.email, $2, $3 from users u where u.id = any($1::uuid[]) and u.active and u.email <> ''`,
    [ids, `SafeWorks: ${note.title}`, `${note.title}\n\n${note.body ?? ""}${link}\n\n— SafeWorks`],
    db,
  );
}

export async function emailTo(db: Db, addr: string, subject: string, body: string): Promise<void> {
  if (!addr) return;
  await q(`insert into email_outbox (to_addr, subject, body) values ($1, $2, $3)`, [addr, `SafeWorks: ${subject}`, body], db);
}

export async function siteSafetyOfficers(db: Db, siteId: string): Promise<string[]> {
  const rows = await q<{ user_id: string }>(
    `select distinct m.user_id from memberships m join users u on u.id = m.user_id
      where m.site_id = $1 and m.role = 'safety_officer' and u.active`,
    [siteId],
    db,
  );
  return rows.map((r) => r.user_id);
}

export async function companyAdmins(db: Db, orgId: string): Promise<string[]> {
  const rows = await q<{ user_id: string }>(
    `select distinct m.user_id from memberships m join users u on u.id = m.user_id
      where m.org_id = $1 and m.site_id is null and m.role in ('org_admin') and u.active`,
    [orgId],
    db,
  );
  return rows.map((r) => r.user_id);
}
