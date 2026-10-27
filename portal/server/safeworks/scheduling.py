"""Inspection schedules: next due time and scheduled-run creation (used by the scheduler job and on schedule changes)."""
from __future__ import annotations

from datetime import datetime, time as dtime, timedelta, timezone

from . import db
from .numbers import next_case_no
from .notify import link_for, notify, users_with_roles
from .i18n import pick


def _hm(s: str) -> dtime:
    try:
        h, m = str(s or "08:00").split(":")
        return dtime(int(h), int(m))
    except Exception:
        return dtime(8, 0)


def next_due(freq: dict, after: datetime) -> datetime | None:
    """First due time strictly after `after` (IST calendar). weekdays use JavaScript numbering (0 = Sunday)."""
    every = max(1, int(freq.get("every", 1) or 1))
    unit = freq.get("unit", "day")
    at = _hm(freq.get("time", "08:00"))
    local = after.astimezone(db.TZ)
    weekdays = [int(x) for x in (freq.get("weekdays") or [])]
    if unit == "day":
        d = local.date()
        for _ in range(400):
            cand = datetime.combine(d, at, tzinfo=db.TZ)
            js_dow = (cand.weekday() + 1) % 7
            if cand > local and (not weekdays or js_dow in weekdays):
                return cand.astimezone(timezone.utc)
            d += timedelta(days=every if not weekdays else 1)
    elif unit == "week":
        d = local.date()
        for _ in range(400):
            cand = datetime.combine(d, at, tzinfo=db.TZ)
            js_dow = (cand.weekday() + 1) % 7
            if cand > local and (js_dow in (weekdays or [1])):
                return cand.astimezone(timezone.utc)
            d += timedelta(days=1)
    elif unit == "month":
        day = int(freq.get("day", local.day) or 1)
        y, m = local.year, local.month
        for _ in range(60):
            try:
                cand = datetime.combine(datetime(y, m, min(day, 28)).date(), at, tzinfo=db.TZ)
            except ValueError:
                cand = None
            if cand and cand > local:
                return cand.astimezone(timezone.utc)
            m += every
            while m > 12:
                m -= 12
                y += 1
    return None


async def ensure_scheduled_run(conn, schedule: dict, now: datetime | None = None) -> str | None:
    """Create the next `scheduled` run for an active schedule when its due time is within lead_days. Returns the run id when created."""
    now = now or datetime.now(timezone.utc)
    if not schedule["active"]:
        return None
    due = schedule["next_due_at"]
    if due is None or due < now - timedelta(hours=int(schedule["grace_hours"] or 0)) - timedelta(days=1):
        due = next_due(schedule["frequency"] or {}, now)
        if due is None:
            return None
        await db._db(conn).execute("update inspection_schedules set next_due_at = $2, updated_at = now() where id = $1", schedule["id"], due)
    if due - now > timedelta(days=int(schedule["lead_days"] or 0)):
        return None
    existing = await db.one("select id from inspection_runs where schedule_id = $1 and due_at = $2", [schedule["id"], due], conn)
    if existing:
        return None
    tmpl = await db.one(
        "select t.id, t.name_i18n, t.active_version_id, s.code as site_code, s.name_i18n as site_name, s.org_id from inspection_templates t join sites s on s.id = $2 where t.id = $1",
        [schedule["template_id"], schedule["site_id"]], conn,
    )
    if not tmpl or not tmpl["active_version_id"]:
        return None
    case_no = await next_case_no(conn, tmpl["site_code"], "inspection_run", due)
    import uuid as _uuid
    run = await db.one(
        """insert into inspection_runs (client_uuid, org_id, case_no, template_version_id, site_id, area_id, asset_id, schedule_id, trigger, due_at, status, inspector_user_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled',$9,'scheduled',$10) returning id""",
        [str(_uuid.uuid4()), tmpl["org_id"], case_no, tmpl["active_version_id"], schedule["site_id"], schedule["area_id"], schedule["asset_id"], schedule["id"], due, schedule["assignee_user_id"]], conn,
    )
    nxt = next_due(schedule["frequency"] or {}, due)
    await db._db(conn).execute("update inspection_schedules set next_due_at = $2, updated_at = now() where id = $1", schedule["id"], nxt)
    recipients = [schedule["assignee_user_id"]] if schedule["assignee_user_id"] else await users_with_roles(conn, schedule["site_id"], [schedule["assignee_role"]] if schedule["assignee_role"] else ["site_safety_officer"], tmpl["org_id"])
    area_name = ""
    if schedule["area_id"]:
        a = await db.one("select name_i18n from areas where id = $1", [schedule["area_id"]], conn)
        area_name = f" / {pick(a['name_i18n'], 'en')}" if a else ""
    await notify(conn, org_id=tmpl["org_id"], recipients=recipients, event_type="inspection_due", record_type="inspection_run", record_id=run["id"], key="inspection_due",
                 params={"caseNo": case_no, "due": due.astimezone(db.TZ).strftime("%d %b %Y, %H:%M"), "template": pick(tmpl["name_i18n"], "en"), "site": pick(tmpl["site_name"], "en"), "area": area_name},
                 link=link_for("inspection_run", run["id"]))
    return run["id"]


async def mark_missed(conn, now: datetime | None = None) -> int:
    """Scheduled runs not started by due + grace become `missed`; the officer is told."""
    now = now or datetime.now(timezone.utc)
    rows = await db.q(
        """select r.id, r.case_no, r.org_id, r.site_id, r.due_at, r.area_id, t.name_i18n as template_name, s.name_i18n as site_name
             from inspection_runs r join inspection_schedules sc on sc.id = r.schedule_id join inspection_template_versions v on v.id = r.template_version_id
             join inspection_templates t on t.id = v.template_id join sites s on s.id = r.site_id
            where r.status = 'scheduled' and r.due_at + make_interval(hours => sc.grace_hours) < $1""", [now], conn,
    )
    for r in rows:
        await db._db(conn).execute("update inspection_runs set status = 'missed', version = version + 1, updated_at = now() where id = $1", r["id"])
        officers = await users_with_roles(conn, r["site_id"], ["site_safety_officer"], r["org_id"])
        await notify(conn, org_id=r["org_id"], recipients=officers, event_type="inspection_missed", record_type="inspection_run", record_id=r["id"], key="inspection_missed",
                     params={"caseNo": r["case_no"], "due": r["due_at"].astimezone(db.TZ).strftime("%d %b %Y, %H:%M"), "template": pick(r["template_name"], "en"), "site": pick(r["site_name"], "en"), "area": ""},
                     link=link_for("inspection_run", r["id"]))
    return len(rows)
