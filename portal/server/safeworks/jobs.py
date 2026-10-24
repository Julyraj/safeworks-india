"""Background jobs: email sending, due-date reminders, overdue notices and escalations."""
from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import parseaddr
from urllib.parse import unquote, urlparse

import anyio

from . import db
from .config import config
from .notify import email_to, notify
from .settings import merge_settings

log = logging.getLogger("safeworks.jobs")
_warned = False


def _send_smtp(to: str, subject: str, body: str) -> None:
    u = urlparse(config.smtp_url)
    msg = EmailMessage()
    msg["From"] = config.mail_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    host, port = u.hostname or "localhost", u.port
    user, pw = unquote(u.username or ""), unquote(u.password or "")
    if u.scheme == "smtps":
        with smtplib.SMTP_SSL(host, port or 465, context=ssl.create_default_context(), timeout=30) as s:
            if user:
                s.login(user, pw)
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port or 587, timeout=30) as s:
            s.ehlo()
            if s.has_extn("starttls"):
                s.starttls(context=ssl.create_default_context())
                s.ehlo()
            if user:
                s.login(user, pw)
            s.send_message(msg)


async def send_emails() -> None:
    global _warned
    if not config.smtp_url:
        if not _warned:
            log.warning("SMTP_URL not set: emails stay queued in email_outbox and are not sent.")
            _warned = True
        return
    async with db.tx() as c:
        # skip locked: several server processes never send the same email twice
        batch = await db.q(
            """select id, to_addr, subject, body, attempts from email_outbox
                where sent_at is null and next_try_at <= now() and attempts < 8 order by id limit 50 for update skip locked""",
            [],
            c,
        )
        for m in batch:
            if not parseaddr(m["to_addr"])[1]:
                continue
            try:
                await anyio.to_thread.run_sync(_send_smtp, m["to_addr"], m["subject"], m["body"])
                await db.execute("update email_outbox set sent_at = now(), attempts = attempts + 1 where id = $1", [m["id"]], c)
            except Exception as e:  # keep trying later with backoff
                wait = float(min(2 ** m["attempts"] * 60, 6 * 3600))
                await db.execute(
                    "update email_outbox set attempts = attempts + 1, last_error = $2, next_try_at = now() + make_interval(secs => $3) where id = $1",
                    [m["id"], str(e)[:500], wait],
                    c,
                )


async def _once(c, key: str) -> bool:
    row = await db.one("insert into job_marks (key) values ($1) on conflict do nothing returning key", [key], c)
    return row is not None


async def run_reminders() -> None:
    async with db._db(None).acquire() as c:
        got = await c.fetchval("select pg_try_advisory_lock(424242)")
        if not got:
            return
        try:
            for org in await db.q("select id, settings from organisations", [], c):
                s = merge_settings(org["settings"])
                due_soon = await db.q(
                    """select o.id, o.code, o.owner_id, o.due_at, s.name as site_name from observations o join sites s on s.id = o.site_id
                        where o.org_id = $1 and o.status in ('open','in_progress') and o.owner_id is not null
                          and o.due_at > now() and o.due_at <= now() + make_interval(hours => $2)""",
                    [org["id"], s["dueReminderHours"]],
                    c,
                )
                for o in due_soon:
                    if await _once(c, f"due:{o['id']}:{o['due_at'].isoformat()}"):
                        when = o["due_at"].astimezone(db.TZ).strftime("%d %b %Y, %I:%M %p")
                        await notify(c, [o["owner_id"]], kind="due_soon", observation_id=o["id"], title=f"{o['code']} is due {when}", body=o["site_name"])
                overdue = await db.q(
                    """select o.id, o.code, o.owner_id, o.site_id, o.due_at, s.name as site_name, s.site_head_email,
                              floor(extract(epoch from (now() - o.due_at)) / 86400)::int as days
                         from observations o join sites s on s.id = o.site_id
                        where o.org_id = $1 and o.status in ('open','in_progress') and o.due_at < now()""",
                    [org["id"]],
                    c,
                )
                today = datetime.now(timezone.utc).date().isoformat()
                for o in overdue:
                    days = max(o["days"], 0)
                    if await _once(c, f"overdue:{o['id']}:{today}"):
                        sos = await db.q("select user_id from memberships where site_id = $1 and role = 'safety_officer'", [o["site_id"]], c)
                        await notify(c, [o["owner_id"], *[x["user_id"] for x in sos]], kind="overdue", observation_id=o["id"],
                                     title=f"{o['code']} is overdue ({days} day{'' if days == 1 else 's'})", body=o["site_name"])
                    if days >= s["escalation"]["siteHeadDays"] and o["site_head_email"] and await _once(c, f"esc1:{o['id']}"):
                        await email_to(c, o["site_head_email"], f"{o['code']} overdue by {days} days",
                                       f"Observation {o['code']} at {o['site_name']} is overdue by {days} days.\n\nOpen: {config.public_url}/o/{o['id']}")
                    if days >= s["escalation"]["adminDays"] and await _once(c, f"esc2:{o['id']}"):
                        admins = await db.q("select user_id from memberships where org_id = $1 and site_id is null and role = 'org_admin'", [org["id"]], c)
                        await notify(c, [a["user_id"] for a in admins], kind="escalation", observation_id=o["id"],
                                     title=f"Escalation: {o['code']} overdue by {days} days", body=o["site_name"])
            await db.execute("delete from job_marks where at < now() - interval '120 days'", [], c)
            await db.execute("delete from sessions where expires_at < now() - interval '30 days'", [], c)
        finally:
            await c.execute("select pg_advisory_unlock(424242)")


async def _loop(fn, every: float, first_delay: float) -> None:
    await asyncio.sleep(first_delay)
    while True:
        try:
            await fn()
        except asyncio.CancelledError:
            raise
        except Exception as e:  # never let a job error stop the loop
            log.error("job %s failed: %s", fn.__name__, e)
        await asyncio.sleep(every)


def start_jobs() -> list[asyncio.Task]:
    return [
        asyncio.create_task(_loop(send_emails, 30, 30)),
        asyncio.create_task(_loop(run_reminders, 300, 15)),
    ]
