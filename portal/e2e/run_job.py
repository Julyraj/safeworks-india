"""Runs one background job of the server once, against DATABASE_URL (used by run_test_plan.py for the timed cases).

    DATABASE_URL=... python portal/e2e/run_job.py ladder_job
    python portal/e2e/run_job.py digests weekly
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from safeworks import db, jobs  # noqa: E402

WITH_CONN = {"ladder_job", "critical_ack_watcher", "inspection_scheduler", "closure_notices", "retention_report"}


async def main(name: str, arg: str) -> None:
    await db.init_pool()
    try:
        if name in ("send_emails", "send_pushes"):
            await getattr(jobs, name)()
        elif name == "digests":
            async with db.tx() as c:
                await jobs.digests(c, arg == "weekly")
        elif name in WITH_CONN:
            async with db.tx() as c:
                await getattr(jobs, name)(c)
        else:
            raise SystemExit(f"unknown job {name}")
    finally:
        await db.close_pool()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ""))
