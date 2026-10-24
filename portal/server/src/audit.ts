import { Db, pool, q } from "./db.js";

export async function audit(
  entry: { orgId?: string | null; actorId?: string | null; action: string; entity?: string; entityId?: string; ip?: string; details?: unknown },
  db: Db = pool,
): Promise<void> {
  await q(
    `insert into audit_log (org_id, actor_id, action, entity, entity_id, ip, details) values ($1,$2,$3,$4,$5,$6,$7)`,
    [entry.orgId ?? null, entry.actorId ?? null, entry.action, entry.entity ?? "", entry.entityId ?? "", entry.ip ?? "", JSON.stringify(entry.details ?? {})],
    db,
  );
}
