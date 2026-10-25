"""Case numbers: `<site code>-OBS|ACT|INS-<year>-<00001>` from `code_counters` (one row per site, kind and year)."""
from __future__ import annotations

from datetime import datetime

from . import db

KINDS = {"observation": "OBS", "action": "ACT", "inspection_run": "INS", "incident": "OBS"}


async def next_case_no(conn, site_code: str, kind: str, when: datetime | None = None) -> str:
    """Atomic: the upsert takes the row lock, so two inserts in the same scope never get the same number."""
    code = KINDS.get(kind, kind.upper()[:3])
    year = (when or datetime.now(db.TZ)).astimezone(db.TZ).year
    scope = f"{site_code}:{code}:{year}"
    n = await conn.fetchval(
        """insert into code_counters (scope, next_no) values ($1, 2)
           on conflict (scope) do update set next_no = code_counters.next_no + 1
           returning next_no - 1""",
        scope,
    )
    return f"{site_code}-{code}-{year}-{n:05d}"
