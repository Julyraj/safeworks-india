"""Notifications: in-app rows, Web Push queue, email outbox; quiet hours, daily reminder cap, digests (brief §5.8).

`notify()` writes one `notifications` row per recipient and channel in the caller's transaction. Push rows stay
`queued` until the push_sender job sends them (deferred to the end of quiet hours for non-critical items); reminder
pushes beyond `dailyPushCap` are not queued and reach the person through the digest instead. Critical alerts are never
capped or deferred. Texts are translated into each recipient's language.
"""
from __future__ import annotations

from datetime import datetime, time as dtime, timedelta, timezone
from typing import Iterable

from . import db
from .config import config
from .i18n import t
from .settings import org_settings

REMINDER_EVENTS = {"action_due_soon", "action_due_today", "action_overdue", "triage_sla", "verification_sla", "inspection_due"}


def _parse_hm(s: str, default: dtime) -> dtime:
    try:
        h, m = s.split(":")
        return dtime(int(h), int(m))
    except Exception:
        return default


def in_quiet_hours(now_local: datetime, quiet: dict) -> datetime | None:
    """Returns the local time quiet hours end if `now_local` is inside them, else None."""
    start = _parse_hm(quiet.get("start", "21:00"), dtime(21, 0))
    end = _parse_hm(quiet.get("end", "07:00"), dtime(7, 0))
    today = now_local.date()
    s = datetime.combine(today, start, tzinfo=now_local.tzinfo)
    e = datetime.combine(today, end, tzinfo=now_local.tzinfo)
    if start > end:  # overnight window, e.g. 21:00–07:00
        if now_local >= s:
            return e + timedelta(days=1)
        if now_local < e:
            return e
        return None
    if s <= now_local < e:
        return e
    return None


async def users_with_roles(conn, site_id: str | None, roles: Iterable[str], org_id: str | None = None) -> list[str]:
    """Active users holding one of `roles` at the site (or for all sites)."""
    rows = await db.q(
        """select distinct r.user_id from user_site_roles r join users u on u.id = r.user_id
            where r.role::text = any($2::text[]) and u.status = 'active' and (r.expires_at is null or r.expires_at > now())
              and (r.site_id = $1 or (r.site_id is null and ($3::uuid is null or u.org_id = $3)))""",
        [site_id, list(roles), org_id], conn,
    )
    return [r["user_id"] for r in rows]


async def notify(conn, *, org_id: str, recipients: Iterable[str | None], event_type: str, record_type: str = "", record_id: str | None = None,
                 key: str, params: dict | None = None, link: str = "", critical: bool = False, push: bool = True, email: bool = False,
                 exclude: Iterable[str | None] = ()) -> list[int]:
    """Create in-app (+ push, + email) notifications for `recipients`. Returns the in-app notification ids."""
    ids = [u for u in dict.fromkeys(recipients) if u and u not in set(exclude)]
    if not ids:
        return []
    params = params or {}
    settings = await org_settings(org_id, conn)
    users = await db.q("select id, language, email, preferences from users where id = any($1::uuid[]) and status = 'active'", [ids], conn)
    now_local = datetime.now(db.TZ)
    created: list[int] = []
    for u in users:
        lang = u["language"] or settings.get("defaultLanguage", "en")
        title = t(f"ntf.{key}.title", lang, org_id, **params)[:300]
        body = t(f"ntf.{key}.body", lang, org_id, **params)[:2000]
        row = await db.one(
            """insert into notifications (org_id, event_type, record_type, record_id, recipient_user_id, channel, template_code, language, title, body, link, critical, status)
               values ($1,$2,$3,$4,$5,'inapp',$6,$7,$8,$9,$10,$11,'delivered') returning id""",
            [org_id, event_type, record_type, record_id, u["id"], key, lang, title, body, link, critical], conn,
        )
        created.append(row["id"])
        prefs = u["preferences"] or {}
        if push:
            send_after = None
            allowed = True
            if not critical:
                if event_type in REMINDER_EVENTS:
                    cap = int(settings.get("dailyPushCap", 5))
                    sent_today = await conn.fetchval(
                        """select count(*) from notifications where recipient_user_id = $1 and channel = 'push' and event_type = any($2::text[])
                              and created_at > now() - interval '24 hours' and status <> 'failed'""",
                        u["id"], list(REMINDER_EVENTS),
                    )
                    allowed = (sent_today or 0) < cap
                if allowed and prefs.get("quietHours", True):
                    end = in_quiet_hours(now_local, settings.get("quietHours") or {})
                    if end:
                        send_after = end.astimezone(timezone.utc)
            if allowed:
                await db.execute(
                    """insert into notifications (org_id, event_type, record_type, record_id, recipient_user_id, channel, template_code, language, title, body, link, critical, status, send_after)
                       values ($1,$2,$3,$4,$5,'push',$6,$7,$8,$9,$10,$11,'queued',$12)""",
                    [org_id, event_type, record_type, record_id, u["id"], key, lang, title, body, link, critical, send_after], conn,
                )
        if email and u["email"]:
            await send_email(conn, org_id=org_id, user_id=u["id"], to_addr=u["email"], subject=title, body=body + (f"\n\n{config.public_url}{link}" if link else ""),
                             event_type=event_type, record_type=record_type, record_id=record_id, lang=lang, critical=critical)
    return created


async def send_email(conn, *, org_id: str, user_id: str | None, to_addr: str, subject: str, body: str, event_type: str = "email", record_type: str = "",
                     record_id: str | None = None, lang: str = "en", critical: bool = False) -> None:
    """Queue an email in the outbox; the notifications row tracks its status for the admin log."""
    nid = None
    if user_id:
        row = await db.one(
            """insert into notifications (org_id, event_type, record_type, record_id, recipient_user_id, channel, language, title, body, critical, status)
               values ($1,$2,$3,$4,$5,'email',$6,$7,$8,$9,'queued') returning id""",
            [org_id, event_type, record_type, record_id, user_id, lang, subject[:300], body[:5000], critical], conn,
        )
        nid = row["id"]
    footer = "\n\n" + t("email.footer", lang, org_id, org=(await _org_name(conn, org_id)))
    await db.execute("insert into email_outbox (to_addr, subject, body, notification_id) values ($1, $2, $3, $4)", [to_addr, f"SafeWorks: {subject}"[:300], body + footer, nid], conn)


async def _org_name(conn, org_id: str) -> str:
    return await conn.fetchval("select name from organisations where id = $1", org_id) or "SafeWorks"


def link_for(record_type: str, record_id: str) -> str:
    return {"observation": f"/o/{record_id}", "action": f"/a/{record_id}", "inspection_run": f"/inspections/runs/{record_id}"}.get(record_type, "/")
