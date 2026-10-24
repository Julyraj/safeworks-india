"""Applies the numbered SQL files in migrations/ once each, in order, inside a transaction."""
from __future__ import annotations

import logging
import re

from . import db
from .config import SERVER_ROOT

MIGRATIONS_DIR = SERVER_ROOT / "migrations"
log = logging.getLogger("safeworks.migrate")


async def migrate(verbose: bool = True) -> list[str]:
    await db.init_pool()
    applied: list[str] = []
    async with db._db(None).acquire() as c:
        await c.execute("select pg_advisory_lock(777001)")
        try:
            await c.execute("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())")
            done = {r["name"] for r in await c.fetch("select name from schema_migrations")}
            files = sorted(p for p in MIGRATIONS_DIR.iterdir() if re.match(r"^\d+_.+\.sql$", p.name))
            for f in files:
                if f.name in done:
                    continue
                sql = f.read_text(encoding="utf-8")
                try:
                    async with c.transaction():
                        await c.execute(sql)
                        await c.execute("insert into schema_migrations (name) values ($1)", f.name)
                except Exception as e:
                    raise RuntimeError(f"Migration {f.name} failed: {e}") from e
                applied.append(f.name)
                if verbose:
                    print(f"[migrate] applied {f.name}", flush=True)
        finally:
            await c.execute("select pg_advisory_unlock(777001)")
    return applied
