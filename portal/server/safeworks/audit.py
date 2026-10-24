from __future__ import annotations

from typing import Any

from . import db


async def audit(action: str, *, org_id: str | None = None, actor_id: str | None = None, entity: str = "", entity_id: str = "",
                ip: str = "", details: Any = None, conn=None) -> None:
    await db.execute(
        "insert into audit_log (org_id, actor_id, action, entity, entity_id, ip, details) values ($1,$2,$3,$4,$5,$6,$7)",
        [org_id, actor_id, action, entity, str(entity_id or ""), ip or "", details if details is not None else {}],
        conn,
    )
