"""PostgreSQL access with asyncpg. Rows come back as dicts; UUIDs are returned as strings."""
from __future__ import annotations

import json
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime
from typing import Any, AsyncIterator
from zoneinfo import ZoneInfo

import asyncpg

from .config import config

pool: asyncpg.Pool | None = None
TZ = ZoneInfo(config.timezone)

Conn = asyncpg.Connection | asyncpg.Pool | None


class _Connection(asyncpg.Connection):
    """Skips asyncpg's reset query (advisory-unlock / RESET ALL …) on every return to the pool.

    The server never leaves session state on a pooled connection: it sets no session variables
    and the two advisory locks it takes (jobs, migrations) are released in `finally` blocks.
    Open transactions are still rolled back by asyncpg. This saves one database round trip per query.
    """

    def get_reset_query(self) -> str:
        return ""


async def _init_conn(conn: asyncpg.Connection) -> None:
    for t in ("json", "jsonb"):
        await conn.set_type_codec(t, encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def init_pool() -> asyncpg.Pool:
    global pool
    if pool is None:
        pool = await asyncpg.create_pool(
            config.database_url,
            # A few warm connections so the first rush after a quiet spell does not wait for new ones.
            min_size=min(4, config.db_pool_max),
            max_size=config.db_pool_max,
            command_timeout=30,
            max_inactive_connection_lifetime=1800,
            connection_class=_Connection,
            server_settings={"timezone": config.timezone, "statement_timeout": "15000", "application_name": "safeworks"},
            init=_init_conn,
        )
    return pool


async def close_pool() -> None:
    global pool
    if pool is not None:
        await pool.close()
        pool = None


def _norm(v: Any) -> Any:
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, list):
        return [_norm(x) for x in v]
    return v


def _row(r: asyncpg.Record) -> dict[str, Any]:
    return {k: _norm(v) for k, v in r.items()}


def _db(conn: Conn):
    if conn is not None:
        return conn
    if pool is None:
        raise RuntimeError("Database pool is not initialised")
    return pool


async def q(sql: str, params: list | tuple = (), conn: Conn = None) -> list[dict[str, Any]]:
    rows = await _db(conn).fetch(sql, *params)
    return [_row(r) for r in rows]


async def one(sql: str, params: list | tuple = (), conn: Conn = None) -> dict[str, Any] | None:
    r = await _db(conn).fetchrow(sql, *params)
    return _row(r) if r is not None else None


async def execute(sql: str, params: list | tuple = (), conn: Conn = None) -> str:
    return await _db(conn).execute(sql, *params)


@asynccontextmanager
async def tx() -> AsyncIterator[asyncpg.Connection]:
    async with _db(None).acquire() as c:
        async with c.transaction():
            yield c


def local_date(d: datetime | None = None) -> str:
    """Calendar date (YYYY-MM-DD) in the app time zone."""
    return (d or datetime.now(TZ)).astimezone(TZ).date().isoformat()


def to_date(s: str | date) -> date:
    return s if isinstance(s, date) else date.fromisoformat(s)
