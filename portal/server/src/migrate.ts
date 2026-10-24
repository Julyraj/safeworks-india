import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Works from src/ (tsx) and dist/ (compiled): migrations live in server/migrations
const MIGRATIONS_DIR = path.resolve(here, "..", "migrations");

/** Applies numbered SQL files in migrations/ once each, in order, inside a transaction. */
export async function migrate(log = true): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query(`select pg_advisory_lock(777001)`);
    await client.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
    const done = new Set((await client.query(`select name from schema_migrations`)).rows.map((r) => r.name));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(`insert into schema_migrations (name) values ($1)`, [f]);
        await client.query("commit");
        applied.push(f);
        if (log) console.log(`[migrate] applied ${f}`);
      } catch (e) {
        await client.query("rollback");
        throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.query(`select pg_advisory_unlock(777001)`).catch(() => {});
    client.release();
  }
  return applied;
}
