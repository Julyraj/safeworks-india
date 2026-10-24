"""In-app notifications plus queued emails."""
from __future__ import annotations

from . import db
from .config import config


async def notify(conn, user_ids: list[str | None], *, kind: str, title: str, body: str = "", observation_id: str | None = None) -> None:
    ids = list(dict.fromkeys([u for u in user_ids if u]))
    if not ids:
        return
    await db.execute(
        """insert into notifications (user_id, observation_id, kind, title, body)
           select unnest($1::uuid[]), $2, $3, $4, $5""",
        [ids, observation_id, kind, title, body],
        conn,
    )
    link = f"\n\nOpen: {config.public_url}/o/{observation_id}" if observation_id else ""
    await db.execute(
        """insert into email_outbox (to_addr, subject, body)
           select u.email, $2, $3 from users u where u.id = any($1::uuid[]) and u.active and u.email <> ''""",
        [ids, f"SafeWorks: {title}", f"{title}\n\n{body}{link}\n\n— SafeWorks"],
        conn,
    )


async def email_to(conn, addr: str, subject: str, body: str) -> None:
    if addr:
        await db.execute("insert into email_outbox (to_addr, subject, body) values ($1, $2, $3)", [addr, f"SafeWorks: {subject}", body], conn)


async def site_safety_officers(conn, site_id: str) -> list[str]:
    rows = await db.q(
        """select distinct m.user_id from memberships m join users u on u.id = m.user_id
            where m.site_id = $1 and m.role = 'safety_officer' and u.active""",
        [site_id],
        conn,
    )
    return [r["user_id"] for r in rows]


async def company_admins(conn, org_id: str) -> list[str]:
    rows = await db.q(
        """select distinct m.user_id from memberships m join users u on u.id = m.user_id
            where m.org_id = $1 and m.site_id is null and m.role = 'org_admin' and u.active""",
        [org_id],
        conn,
    )
    return [r["user_id"] for r in rows]
