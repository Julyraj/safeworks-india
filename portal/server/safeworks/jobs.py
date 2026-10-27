"""Background jobs (API.md "Jobs"): asyncio tasks in the server process when RUN_JOBS=true.

One process wins each job through `job_marks` + `select … for update skip locked`; every job logs failures without dying.
"""
from __future__ import annotations

import asyncio
import json
import logging
import smtplib
import ssl
from datetime import datetime, time as dtime, timedelta, timezone
from email.message import EmailMessage
from email.utils import parseaddr
from urllib.parse import unquote, urlparse

import anyio

from . import db
from .config import config
from .i18n import pick, t
from .notify import link_for, notify, send_email, users_with_roles
from .retention import dry_run
from .scheduling import ensure_scheduled_run, mark_missed
from .settings import org_settings
from .workflow.common import add_working_days, fmt_dt
from .workflow.observations import reporter_id, send_critical_alert

log = logging.getLogger("safeworks.jobs")
_warned = False


# ---------------------------------------------------------------- email sender (kept from 1.x)

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


async def send_emails(_conn=None) -> None:
    global _warned
    if not config.smtp_url:
        if not _warned:
            log.warning("SMTP_URL not set: emails stay queued in email_outbox and are not sent.")
            _warned = True
        return
    async with db.tx() as c:
        batch = await db.q(
            """select id, to_addr, subject, body, attempts, notification_id from email_outbox
                where sent_at is null and next_try_at <= now() and attempts < 8 order by id limit 50 for update skip locked""", [], c)
        for m in batch:
            if not parseaddr(m["to_addr"])[1]:
                await db.execute("update email_outbox set attempts = 99, last_error = 'bad address' where id = $1", [m["id"]], c)
                continue
            try:
                await anyio.to_thread.run_sync(_send_smtp, m["to_addr"], m["subject"], m["body"])
                await db.execute("update email_outbox set sent_at = now(), attempts = attempts + 1 where id = $1", [m["id"]], c)
                if m["notification_id"]:
                    await db.execute("update notifications set status = 'sent', sent_at = now(), attempts = attempts + 1 where id = $1", [m["notification_id"]], c)
            except Exception as e:  # keep trying later with backoff
                wait = float(min(2 ** m["attempts"] * 60, 6 * 3600))
                await db.execute("update email_outbox set attempts = attempts + 1, last_error = $2, next_try_at = now() + make_interval(secs => $3) where id = $1", [m["id"], str(e)[:500], wait], c)
                if m["notification_id"]:
                    await db.execute("update notifications set attempts = attempts + 1, error = $2, status = case when attempts >= 7 then 'failed' else status end where id = $1",
                                     [m["notification_id"], str(e)[:500]], c)


# ---------------------------------------------------------------- push sender (Web Push, VAPID)

def _webpush(subscription: dict, payload: str) -> None:
    from pywebpush import webpush
    webpush(subscription_info=subscription, data=payload, vapid_private_key=config.vapid_private_key,
            vapid_claims={"sub": config.vapid_subject or "mailto:admin@safeworks.local"}, ttl=3600, timeout=15)


async def send_pushes(_conn=None) -> None:
    async with db.tx() as c:
        batch = await db.q(
            """select n.*, u.id as uid from notifications n join users u on u.id = n.recipient_user_id
                where n.status = 'queued' and n.channel = 'push' and (n.send_after is null or n.send_after <= now()) and n.attempts < 5
                order by n.critical desc, n.id limit 100 for update of n skip locked""", [], c)
        for n in batch:
            if not (config.vapid_private_key and config.vapid_public_key):
                await db.execute("update notifications set status = 'failed', attempts = attempts + 1, error = 'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not configured: Web Push disabled' where id = $1", [n["id"]], c)
                continue
            devices = await db.q("select id, push_subscription from devices where user_id = $1 and revoked_at is null and push_subscription is not null", [n["uid"]], c)
            if not devices:
                await db.execute("update notifications set status = 'failed', attempts = attempts + 1, error = 'no push subscription for this user' where id = $1", [n["id"]], c)
                continue
            payload = json.dumps({"id": n["id"], "title": n["title"], "body": n["body"], "link": n["link"], "critical": n["critical"], "eventType": n["event_type"]}, ensure_ascii=False)
            ok, err = 0, ""
            for d in devices:
                sub = d["push_subscription"]
                if isinstance(sub, str):
                    try:
                        sub = json.loads(sub)
                    except ValueError:
                        sub = None
                if not isinstance(sub, dict) or not sub.get("endpoint"):
                    continue
                try:
                    await anyio.to_thread.run_sync(_webpush, sub, payload)
                    ok += 1
                except Exception as e:
                    err = str(e)[:400]
                    if "410" in err or "404" in err:  # the subscription is gone
                        await db.execute("update devices set push_subscription = null where id = $1", [d["id"]], c)
            if ok:
                await db.execute("update notifications set status = 'sent', sent_at = now(), attempts = attempts + 1, error = '' where id = $1", [n["id"]], c)
            else:
                await db.execute("update notifications set status = case when attempts + 1 >= 5 then 'failed' else 'queued' end, attempts = attempts + 1, error = $2, send_after = now() + interval '2 minutes' where id = $1",
                                 [n["id"], err or "push failed"], c)


# ---------------------------------------------------------------- critical acknowledgement watcher

async def critical_ack_watcher(c) -> None:
    for org in await db.q("select id from organisations", [], c):
        settings = await org_settings(org["id"], c)
        minutes = int(settings.get("criticalAckMinutes", 30))
        rows = await db.q(
            """select o.*, s.name_i18n as site_name, a.name_i18n as area_name from observations o join sites s on s.id = o.site_id left join areas a on a.id = o.area_id
                where o.org_id = $1 and (o.imminent_danger or o.risk_band = 'extreme') and o.critical_acked_at is null and o.status in ('submitted','returned','action_assigned','escalated')
                  and o.received_at < now() - make_interval(mins => $2)""", [org["id"], minutes], c)
        for o in rows:
            level = int((datetime.now(timezone.utc) - o["received_at"]).total_seconds() // (minutes * 60))
            level = max(1, min(level, 48))
            ins = await db.one(
                "insert into escalations (org_id, record_type, record_id, level, reason, target_user_ids) values ($1,'observation',$2,$3,'critical_unacknowledged',$4) on conflict do nothing returning id",
                [org["id"], o["id"], level, await users_with_roles(c, o["site_id"], ["site_head", "hse_manager"], org["id"])], c)
            if not ins:
                continue
            lang = settings.get("defaultLanguage", "en")
            params = {"caseNo": o["case_no"], "site": pick(o["site_name"], lang), "area": f" / {pick(o['area_name'], lang)}" if o["area_name"] else "", "description": o["description"][:160],
                      "minutes": level * minutes}
            await send_critical_alert(c, o, params, repeat=True)


# ---------------------------------------------------------------- reminder ladder, triage and verification SLAs

async def _ladder_step_key(action_id: str, step: dict) -> str:
    return f"ladder:{action_id}:{step['recipient']}:{step['offsetMinutes']}"


async def _once(c, key: str) -> bool:
    row = await db.one("insert into job_marks (key) values ($1) on conflict do nothing returning key", [key], c)
    return row is not None


async def ladder_job(c) -> None:
    now = datetime.now(timezone.utc)
    for org in await db.q("select id from organisations", [], c):
        settings = await org_settings(org["id"], c)
        ladders = {l["band"]: l for l in await db.q("select * from reminder_ladders where org_id = $1", [org["id"]], c)}
        actions = await db.q(
            """select a.*, s.code as site_code, coalesce(p.full_name, u.employee_code) as owner_name from actions a join sites s on s.id = a.site_id
                 join users u on u.id = a.owner_user_id left join people p on p.id = u.person_id
                where a.org_id = $1 and a.status in ('open','in_progress','reopened') and (a.ladder_paused_until is null or a.ladder_paused_until < now())
                  and a.due_at between now() - interval '30 days' and now() + interval '8 days'""", [org["id"]], c)
        for a in actions:
            lad = ladders.get(a["band"])
            if not lad:
                continue
            for step in lad["steps"] or []:
                fire_at = a["due_at"] + timedelta(minutes=int(step["offsetMinutes"]))
                if fire_at > now or fire_at < a["created_at"]:
                    continue  # steps before creation are skipped (brief §8.4)
                key = await _ladder_step_key(a["id"], step)
                if not await _once(c, key):
                    continue
                offset = int(step["offsetMinutes"])
                if step["recipient"] == "owner":
                    recipients = [a["owner_user_id"]]
                    kind = "action_overdue" if offset > 0 else ("action_due_today" if offset == 0 else "action_due_soon")
                elif step["recipient"] == "verifier":
                    recipients = await users_with_roles(c, a["site_id"], ["verifier"], org["id"])
                    kind = "action_overdue"
                else:
                    recipients = await users_with_roles(c, a["site_id"], [step["recipient"]], org["id"])
                    kind = "action_overdue"
                email = step.get("channel") in ("email", "both")
                params = {"caseNo": a["case_no"], "title": a["title"], "site": a["site_code"], "due": fmt_dt(a["due_at"]), "owner": a["owner_name"], "band": a["band"]}
                await notify(c, org_id=org["id"], recipients=recipients, event_type=kind, record_type="action", record_id=a["id"], key=kind, params=params,
                             link=link_for("action", a["id"]), email=email)
                await c.execute(
                    "insert into action_events (action_id, event_type, body, payload) values ($1, $2, $3, $4)",
                    a["id"], "escalated" if offset > 0 and step["recipient"] != "owner" else "reminder_sent", f"{step['recipient']} {offset:+d} min", {"step": step},
                )
                if offset > 0 and step["recipient"] != "owner":
                    level = 2 if step["recipient"] == "hse_manager" else 1
                    await c.execute("update actions set escalation_level = greatest(escalation_level, $2) where id = $1", a["id"], level)
                    await c.execute(
                        "insert into escalations (org_id, record_type, record_id, level, reason, target_user_ids) values ($1,'action',$2,$3,$4,$5) on conflict do nothing",
                        org["id"], a["id"], level, "overdue_t3" if level == 2 else "overdue_t1", recipients,
                    )
        # triage SLA: officer after N working days, site head after M
        sla, esc = int(settings.get("triageSlaWorkingDays", 1)), int(settings.get("triageEscalateWorkingDays", 2))
        sites = await db.q("select * from sites where org_id = $1 and deleted_at is null and active", [org["id"]], c)
        for s in sites:
            waiting = await db.q("select id, case_no, received_at from observations where site_id = $1 and status = 'submitted' order by received_at", [s["id"]], c)
            cal = (s["working_calendar"] or {}).get("weeklyOff", [0])
            late_sla = [o for o in waiting if add_working_days(o["received_at"], sla, cal) < now]
            late_esc = [o for o in waiting if add_working_days(o["received_at"], esc, cal) < now]
            today = now.astimezone(db.TZ).date().isoformat()
            if late_sla and await _once(c, f"triage_sla:{s['id']}:{today}"):
                officers = await users_with_roles(c, s["id"], ["site_safety_officer"], org["id"])
                oldest = late_sla[0]
                await notify(c, org_id=org["id"], recipients=officers, event_type="triage_sla", record_type="observation", record_id=oldest["id"], key="triage_sla",
                             params={"count": len(late_sla), "site": s["code"], "caseNo": oldest["case_no"], "received": fmt_dt(oldest["received_at"])}, link="/inbox")
            if late_esc and await _once(c, f"triage_escalate:{s['id']}:{today}"):
                heads = await users_with_roles(c, s["id"], ["site_head"], org["id"])
                oldest = late_esc[0]
                await notify(c, org_id=org["id"], recipients=heads, event_type="triage_sla", record_type="observation", record_id=oldest["id"], key="triage_escalate",
                             params={"count": len(late_esc), "site": s["code"], "caseNo": oldest["case_no"], "days": esc}, link="/inbox", email=True)
                for o in late_esc:
                    await c.execute("insert into escalations (org_id, record_type, record_id, level, reason, target_user_ids) values ($1,'observation',$2,1,'triage_sla',$3) on conflict do nothing",
                                    org["id"], o["id"], heads)
        # verification SLA: verifier, then officer, then site head
        completed = await db.q(
            """select a.*, s.code as site_code, r.verify_within_hours from actions a join sites s on s.id = a.site_id
                 left join due_date_rules r on r.org_id = a.org_id and r.band = a.band and (r.site_id = a.site_id or r.site_id is null)
                where a.org_id = $1 and a.status = 'completed' and a.completed_at < now() - make_interval(hours => coalesce(r.verify_within_hours, 72))
                order by a.id, r.site_id nulls last""", [org["id"]], c)
        seen = set()
        for a in completed:
            if a["id"] in seen:
                continue
            seen.add(a["id"])
            hours = int(a["verify_within_hours"] or 72)
            overdue_h = (now - a["completed_at"]).total_seconds() / 3600
            level = 1 if overdue_h < hours * 2 else 2 if overdue_h < hours * 3 else 3
            if not await _once(c, f"verify_sla:{a['id']}:{level}"):
                continue
            roles = {1: ["verifier"], 2: ["site_safety_officer"], 3: ["site_head"]}[level]
            recipients = await users_with_roles(c, a["site_id"], roles, org["id"])
            await notify(c, org_id=org["id"], recipients=[r for r in recipients if r not in (a["owner_user_id"], a["completed_by"])], event_type="verification_sla", record_type="action",
                         record_id=a["id"], key="verification_sla", params={"caseNo": a["case_no"], "completed": fmt_dt(a["completed_at"]), "hours": hours}, link=link_for("action", a["id"]))
            await c.execute("insert into escalations (org_id, record_type, record_id, level, reason, target_user_ids) values ($1,'action',$2,$3,'verification_sla',$4) on conflict do nothing",
                            org["id"], a["id"], level, recipients)
    await c.execute("delete from job_marks where key like 'ladder:%' and at < now() - interval '120 days'")
    await c.execute("delete from sessions where expires_at < now() - interval '30 days'")
    await c.execute("delete from public_rate_counters where window_start < now() - interval '24 hours'")


# ---------------------------------------------------------------- inspection scheduler

async def inspection_scheduler(c) -> None:
    schedules = await db.q("select * from inspection_schedules where active order by next_due_at nulls first", [], c)
    for s in schedules:
        try:
            await ensure_scheduled_run(c, s)
        except Exception as e:
            log.error("schedule %s: %s", s["id"], e)
    await mark_missed(c)


# ---------------------------------------------------------------- closure notices

async def closure_notices(c) -> None:
    rows = await db.q(
        """select o.*, s.name_i18n as site_name from observations o join sites s on s.id = o.site_id
            where o.status = 'closed' and o.closure_feedback_sent_at is null and o.closed_at < now() - interval '30 minutes' limit 200""", [], c)
    for o in rows:
        settings = await org_settings(o["org_id"], c)
        lang = settings.get("defaultLanguage", "en")
        summary = o["closure_summary"] or t("sys.closure_summary_none", lang, o["org_id"])
        params = {"caseNo": o["case_no"], "summary": summary[:300], "site": pick(o["site_name"], lang)}
        targets = []
        rid = await reporter_id(c, o)
        if rid:
            targets.append(rid)
        # duplicates merged into this master: their reporters are told too (brief §5.2)
        dups = await db.q("select * from observations where master_observation_id = $1 and status = 'merged'", [o["id"]], c)
        for d in dups:
            drid = await reporter_id(c, d)
            if drid:
                targets.append(drid)
        await notify(c, org_id=o["org_id"], recipients=targets, event_type="observation_closed", record_type="observation", record_id=o["id"], key="observation_closed", params=params,
                     link=link_for("observation", o["id"]))
        if o["channel"] == "qr" and o["reporter_contact_enc"]:
            # named QR reporter: a status link by email when the contact carries one (phones are Phase 2 WhatsApp/SMS)
            try:
                from .crypto import decrypt_json
                contact = decrypt_json(o["reporter_contact_enc"]) or {}
                email = contact.get("email") or ""
                if email and "@" in email:
                    url = f"{config.public_url}/q/status/{o['case_no']}?s={o['status_secret']}"
                    await send_email(c, org_id=o["org_id"], user_id=None, to_addr=email, subject=t("closure.subject", lang, o["org_id"], caseNo=o["case_no"]),
                                     body=t("closure.body", lang, o["org_id"], caseNo=o["case_no"], site=pick(o["site_name"], lang), summary=summary, url=url), lang=lang)
            except Exception as e:
                log.warning("closure email for %s: %s", o["case_no"], e)
        await c.execute("update observations set closure_feedback_sent_at = now() where id = $1", o["id"])


# ---------------------------------------------------------------- digests

async def _digest_for(c, org_id: str, user: dict, sites: list[str], weekly: bool) -> list[str]:
    lang = user["language"] or "en"
    lines = []
    backlog = await c.fetchval("select count(*) from observations where site_id = any($1::uuid[]) and status in ('submitted','returned')", sites)
    overdue = await c.fetchval("select count(*) from actions where site_id = any($1::uuid[]) and status in ('open','in_progress','reopened','disputed') and due_at < now() and ($2::bool or owner_user_id = $3)",
                               sites, user["staff"], user["id"])
    due_soon = await c.fetchval("select count(*) from actions where site_id = any($1::uuid[]) and status in ('open','in_progress','reopened') and due_at between now() and now() + interval '7 days' and ($2::bool or owner_user_id = $3)",
                                sites, user["staff"], user["id"])
    verify = await c.fetchval("select count(*) from actions where site_id = any($1::uuid[]) and status = 'completed'", sites) if user["staff"] else 0
    insp = await c.fetchval("select count(*) from inspection_runs where site_id = any($1::uuid[]) and status = 'scheduled' and due_at < now() + interval '7 days'", sites)
    missed = await c.fetchval("select count(*) from inspection_runs where site_id = any($1::uuid[]) and status = 'missed' and updated_at > now() - interval '7 days'", sites)
    critical = await c.fetchval("select count(*) from observations where site_id = any($1::uuid[]) and (imminent_danger or risk_band = 'extreme') and critical_acked_at is null and status not in ('closed','discarded','merged')", sites)
    if user["staff"]:
        lines.append(t("digest.triage_backlog", lang, org_id, count=backlog))
    lines.append(t("digest.overdue_actions", lang, org_id, count=overdue))
    lines.append(t("digest.due_soon", lang, org_id, count=due_soon))
    if user["staff"]:
        lines.append(t("digest.verify_pending", lang, org_id, count=verify))
        lines.append(t("digest.inspections_due", lang, org_id, count=insp))
        lines.append(t("digest.missed_inspections", lang, org_id, count=missed))
        lines.append(t("digest.critical_open", lang, org_id, count=critical))
    if not any([backlog, overdue, due_soon, verify, missed, critical]):
        lines.append(t("digest.none", lang, org_id))
    lines.append(t("digest.open_portal", lang, org_id, url=config.public_url))
    return lines


async def digests(c, weekly: bool) -> None:
    for org in await db.q("select id from organisations", [], c):
        roles = ["site_head", "hse_manager", "action_owner"] if weekly else ["site_safety_officer"]
        users = await db.q(
            """select u.id, u.language, u.email, u.preferences, array_agg(distinct r.site_id::text) filter (where r.site_id is not null) as site_ids, bool_or(r.site_id is null) as all_sites,
                      bool_or(r.role::text in ('site_safety_officer','site_head','hse_manager')) as staff
                 from users u join user_site_roles r on r.user_id = u.id where u.org_id = $1 and u.status = 'active' and r.role::text = any($2::text[]) group by u.id""", [org["id"], roles], c)
        all_sites = [s["id"] for s in await db.q("select id from sites where org_id = $1 and active and deleted_at is null", [org["id"]], c)]
        for u in users:
            pref = (u["preferences"] or {}).get("digest", "daily")
            if pref == "off" or (pref == "weekly" and not weekly and not u["staff"]):
                continue
            sites = all_sites if u["all_sites"] else [s for s in (u["site_ids"] or []) if s]
            if not sites:
                continue
            lines = await _digest_for(c, org["id"], u, sites, weekly)
            key = "digest_weekly" if weekly else "digest_daily"
            date = datetime.now(db.TZ).strftime("%d %b %Y")
            await notify(c, org_id=org["id"], recipients=[u["id"]], event_type=key, record_type="digest", record_id=None, key=key, params={"date": date}, link="/", push=False, email=bool(u["email"]))
            # the body of the digest goes into the in-app row so the inbox shows the counts
            await c.execute("update notifications set body = $2 where id = (select max(id) from notifications where recipient_user_id = $1 and event_type = $3 and channel = 'inapp')",
                            u["id"], "\n".join(lines), key)
            if u["email"]:
                await c.execute("update email_outbox set body = $2 || E'\\n\\n' || body where id = (select max(id) from email_outbox where to_addr = $1)", u["email"], "\n".join(lines))


# ---------------------------------------------------------------- retention report

async def retention_report(c) -> None:
    for org in await db.q("select id from organisations", [], c):
        result = await dry_run(org["id"], c)
        log.info("retention dry run %s: %s", org["id"], json.dumps(result, default=str))
        await c.execute("insert into job_marks (key, at) values ($1, now()) on conflict (key) do update set at = now()", f"retention:{org['id']}")


# ---------------------------------------------------------------- scheduling glue

async def _run_guarded(key: str, min_interval: timedelta, fn, *args) -> bool:
    """Run `fn(conn, *args)` inside a transaction when this process wins the job_marks row (skip locked) and the interval has passed."""
    async with db.tx() as c:
        row = await db.one("select at from job_marks where key = $1 for update skip locked", [f"job:{key}"], c)
        if row is None:
            exists = await db.one("select 1 from job_marks where key = $1", [f"job:{key}"], c)
            if exists:
                return False  # another process holds it
            await c.execute("insert into job_marks (key, at) values ($1, to_timestamp(0)) on conflict do nothing", f"job:{key}")
            row = await db.one("select at from job_marks where key = $1 for update skip locked", [f"job:{key}"], c)
            if row is None:
                return False
        if datetime.now(timezone.utc) - row["at"] < min_interval:
            return False
        await c.execute("update job_marks set at = now() where key = $1", f"job:{key}")
        await fn(c, *args)
    return True


def _due_daily(key_at: datetime | None, at: dtime, weekday: int | None = None) -> bool:
    """True when the local clock has passed `at` today (and the weekday matches) and the job has not run since then."""
    now = datetime.now(db.TZ)
    if weekday is not None and now.weekday() != weekday:
        return False
    target = datetime.combine(now.date(), at, tzinfo=db.TZ)
    if now < target:
        return False
    return key_at is None or key_at.astimezone(db.TZ) < target


async def _last(key: str) -> datetime | None:
    row = await db.one("select at from job_marks where key = $1", [f"job:{key}"])
    return row["at"] if row else None


async def tick_minute() -> None:
    await _run_guarded("critical_ack_watcher", timedelta(seconds=50), critical_ack_watcher)
    if _due_daily(await _last("inspection_scheduler"), dtime(0, 30)):
        await _run_guarded("inspection_scheduler", timedelta(minutes=5), inspection_scheduler)
    if _due_daily(await _last("digest_daily"), dtime(7, 30)):
        await _run_guarded("digest_daily", timedelta(hours=1), digests, False)
    if _due_daily(await _last("digest_weekly"), dtime(7, 0), weekday=0):
        await _run_guarded("digest_weekly", timedelta(hours=1), digests, True)
    if _due_daily(await _last("retention_report"), dtime(3, 0), weekday=6):
        await _run_guarded("retention_report", timedelta(hours=1), retention_report)


async def tick_15min() -> None:
    await _run_guarded("ladder", timedelta(minutes=14), ladder_job)


async def tick_5min() -> None:
    await _run_guarded("closure_notices", timedelta(minutes=4), closure_notices)


async def tick_30s() -> None:
    await _run_guarded("push_sender", timedelta(seconds=25), send_pushes)
    await _run_guarded("email_sender", timedelta(seconds=25), send_emails)


async def run_all_once() -> None:
    """Run every job once, ignoring the schedule (tests and `python -m safeworks.jobs`)."""
    async with db.tx() as c:
        await critical_ack_watcher(c)
        await ladder_job(c)
        await inspection_scheduler(c)
        await closure_notices(c)
    await send_pushes()
    await send_emails()


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
        asyncio.create_task(_loop(tick_30s, 30, 10)),
        asyncio.create_task(_loop(tick_minute, 60, 20)),
        asyncio.create_task(_loop(tick_5min, 300, 40)),
        asyncio.create_task(_loop(tick_15min, 900, 60)),
    ]


if __name__ == "__main__":  # python -m safeworks.jobs → run every job once
    async def _main():
        await db.init_pool()
        try:
            await run_all_once()
        finally:
            await db.close_pool()
    asyncio.run(_main())
