"""Offline sync (brief §13; API.md "Sync").

Push: each command runs in its own transaction; `commandId` is the idempotency key (a repeat returns the stored result as
`duplicate`); commands apply in request order after their `dependsOn`; a validation error is `rejected`; a transition on a
record that someone else already changed is `conflict_saved_as_comment`. Pull: a scoped snapshot (`full`) or a delta by
`updated_at` with tombstones.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg

from . import db
from .audit import audit
from .crypto import hmac_id
from .errors import HttpError
from .i18n import LANGS, load_overrides, t
from .media import uploads_for
from .profile import me_payload
from .rbac import AuthUser
from .schemas import (ActionCommentPayload, ActionCompletePayload, ActionCreateRequest, ActionIdPayload, ActionRequestPayload, ActionVerifyPayload, ObsIdPayload,
                      ObsRefPayload, ObservationCreate, RunAnswersPayload, RunStartRequest, RunSubmitPayload, SyncCommand, SyncPushRequest, TriagePayload, parse)
from .settings import org_settings
from .views import (ACTION_SELECT, OBS_SELECT, RUN_SELECT, action_summary, area, asset, category, contractor, directory_user, due_date_rule, first_thumb, industry,
                    ladder, load_template_versions, matrix_version, media_for, notification, run_summary, schedule, site)
from .workflow import actions as actions_wf
from .workflow import inspections as insp_wf
from .workflow import observations as obs_wf
from .workflow.common import DuplicateRecord, fmt_dt, get_site

log = logging.getLogger("safeworks.sync")

TRANSITION_OPS = {("observation", "triage"), ("observation", "reply"), ("action", "start"), ("action", "complete"), ("action", "verify"), ("action", "request"),
                  ("inspection_run", "submit")}


def _err(e: HttpError, lang: str, org_id: str) -> dict:
    msg = t(e.key, lang, org_id, **e.params) if e.key else e.message
    out = {"error": msg, "code": e.code}
    if e.details is not None:
        out["details"] = e.details
    return out


async def _apply(conn, user: AuthUser, cmd: SyncCommand, device_id: str) -> dict:
    """Run one command inside `conn`'s transaction and return the SyncResult fields (without commandId)."""
    et, op, p = cmd.entity_type, cmd.op, cmd.payload
    user.device_id = device_id
    if et == "observation":
        if op == "create":
            payload = parse(ObservationCreate, p)
            site = await get_site(conn, payload.site_id)
            if not user.in_scope(site["id"]):
                raise HttpError(404, "Not found.", "not_found", key="err.not_found")
            try:
                o, uploads = await obs_wf.create(conn, user, payload, site=site, area_id=payload.area_id, asset_id=payload.asset_id, channel=payload.channel or "app", device_id=device_id)
            except DuplicateRecord as d:
                rows = await db.q("select * from media where owner_type = 'observation' and owner_id = $1 and upload_status = 'pending'", [d.record_id], conn)
                return {"status": "duplicate", "serverId": d.record_id, "caseNo": d.case_no, "uploads": uploads_for(rows)}
            return {"status": "applied", "serverId": o["id"], "caseNo": o["case_no"], "uploads": uploads}
        if op == "comment":
            payload = parse(ObsRefPayload, p)
            c = await obs_wf.add_comment(conn, user, payload.observation_id, payload)
            return {"status": "applied", "serverId": c["id"]}
        if op == "reply":
            payload = parse(ObsRefPayload, p)
            o = await obs_wf.reply(conn, user, payload.observation_id, payload)
            return {"status": "applied", "serverId": o["id"], "caseNo": o["caseNo"], "uploads": o.get("uploads", [])}
        if op == "triage":
            payload = parse(TriagePayload, p)
            o = await obs_wf.triage(conn, user, payload.observation_id, payload)
            return {"status": "applied", "serverId": o["id"], "caseNo": o["caseNo"]}
        if op == "ack_critical":
            payload = parse(ObsIdPayload, p)
            o = await obs_wf.ack_critical(conn, user, payload.observation_id)
            return {"status": "applied", "serverId": o["id"], "caseNo": o["caseNo"]}
    elif et == "action":
        if op == "create":
            payload = parse(ActionCreateRequest, p)
            try:
                a = await actions_wf.create_rest(conn, user, payload)
            except DuplicateRecord as d:
                return {"status": "duplicate", "serverId": d.record_id, "caseNo": d.case_no}
            return {"status": "applied", "serverId": a["id"], "caseNo": a["caseNo"], "uploads": a.get("uploads", [])}
        if op == "start":
            payload = parse(ActionIdPayload, p)
            a = await actions_wf.start(conn, user, payload.action_id, payload.captured_at, cmd.command_id if _is_uuid(cmd.command_id) else None)
            return {"status": "applied", "serverId": a["id"], "caseNo": a["caseNo"]}
        if op == "complete":
            payload = parse(ActionCompletePayload, p)
            a = await actions_wf.complete(conn, user, payload.action_id, payload)
            return {"status": "applied", "serverId": a["id"], "caseNo": a["caseNo"], "uploads": a.get("uploads", [])}
        if op == "verify":
            payload = parse(ActionVerifyPayload, p)
            a = await actions_wf.verify(conn, user, payload.action_id, payload)
            return {"status": "applied", "serverId": a["id"], "caseNo": a["caseNo"], "uploads": a.get("uploads", [])}
        if op == "request":
            payload = parse(ActionRequestPayload, p)
            a = await actions_wf.request(conn, user, payload.action_id, payload)
            return {"status": "applied", "serverId": a["id"], "caseNo": a["caseNo"]}
        if op == "comment":
            payload = parse(ActionCommentPayload, p)
            ev = await actions_wf.add_comment(conn, user, payload.action_id, payload)
            return {"status": "applied", "serverId": str(ev["id"]), "uploads": ev.get("uploads", [])}
    elif et == "inspection_run":
        if op == "start":
            payload = parse(RunStartRequest, p)
            try:
                r = await insp_wf.start(conn, user, payload)
            except DuplicateRecord as d:
                return {"status": "duplicate", "serverId": d.record_id, "caseNo": d.case_no}
            return {"status": "applied", "serverId": r["id"], "caseNo": r["caseNo"]}
        if op == "answers":
            payload = parse(RunAnswersPayload, p)
            r = await insp_wf.upsert_answers(conn, user, payload.run_id, payload.answers)
            return {"status": "applied", "serverId": r["id"], "caseNo": r["caseNo"]}
        if op == "submit":
            payload = parse(RunSubmitPayload, p)
            r = await insp_wf.submit(conn, user, payload.run_id, payload)
            return {"status": "applied", "serverId": r["id"], "caseNo": r["caseNo"], "uploads": r.get("uploads", [])}
    raise HttpError(400, "Unknown sync operation.", "bad_request", key="err.unknown_op")


UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _is_uuid(s: str) -> bool:
    return bool(UUID_RE.match(s or ""))


async def _save_conflict_comment(user: AuthUser, cmd: SyncCommand, err: HttpError, lang: str) -> str | None:
    """Store the content of a rejected offline decision as a comment on the record and tell the officer."""
    p = cmd.payload or {}
    rec_type, rec_id = None, None
    if cmd.entity_type == "observation":
        rec_type, rec_id = "observation", p.get("observationId")
    elif cmd.entity_type == "inspection_run":
        rec_type, rec_id = "inspection_run", p.get("runId")
    elif cmd.entity_type == "action":
        rec_id = p.get("actionId")
    content = {k: v for k, v in p.items() if k not in ("media",)}
    text = t("sys.conflict_comment", lang, user.org_id, user=user.name, at=fmt_dt(cmd.captured_at or datetime.now(timezone.utc)),
             content=json.dumps(content, ensure_ascii=False, default=str)[:1500])
    async with db.tx() as c:
        if rec_type and rec_id and _is_uuid(str(rec_id)):
            row = await db.one(
                "insert into comments (owner_type, owner_id, user_id, kind, body, captured_at) values ($1, $2, $3, 'rejected_offline_decision', $4, $5) returning id",
                [rec_type, rec_id, user.id, text, cmd.captured_at], c,
            )
            cid = row["id"]
        elif rec_id and _is_uuid(str(rec_id)):
            row = await db.one(
                "insert into action_events (action_id, event_type, body, payload, actor_user_id, captured_at, device_id) values ($1, 'comment', $2, $3, $4, $5, $6) returning id",
                [rec_id, text, {"rejectedOfflineDecision": True, "op": cmd.op}, user.id, cmd.captured_at, user.device_id], c,
            )
            cid = str(row["id"])
        else:
            return None
        await audit(c, org_id=user.org_id, actor=user, action="sync", record_type=rec_type or "action", record_id=str(rec_id), changes={"conflict": cmd.op, "commandId": cmd.command_id},
                    reason=err.message)
        return cid


async def push(user: AuthUser, req: SyncPushRequest, lang: str) -> dict:
    results: list[dict] = []
    status_of: dict[str, str] = {}
    device_id = req.device_id
    for cmd in req.commands:
        prior = await db.one("select result_status, result from sync_commands where command_id = $1", [cmd.command_id])
        if prior and prior["result_status"] != "rejected":
            r = dict(prior["result"] or {})
            r.update({"commandId": cmd.command_id, "status": "duplicate"})
            results.append(r)
            status_of[cmd.command_id] = "duplicate"
            continue
        failed_dep = None
        for dep in cmd.depends_on or []:
            st = status_of.get(dep)
            if st is None:
                row = await db.one("select result_status from sync_commands where command_id = $1", [dep])
                st = row["result_status"] if row else None
            if st not in ("applied", "duplicate"):
                failed_dep = dep
                break
        if failed_dep:
            err = {"error": t("err.dependency_failed", lang, user.org_id), "code": "dependency_failed", "details": {"dependsOn": failed_dep}}
            results.append({"commandId": cmd.command_id, "status": "rejected", "error": err})
            status_of[cmd.command_id] = "rejected"
            continue
        result: dict[str, Any]
        try:
            async with db.tx() as c:
                result = await _apply(c, user, cmd, device_id)
        except HttpError as e:
            if e.status == 409 and (cmd.entity_type, cmd.op) in TRANSITION_OPS:
                cid = await _save_conflict_comment(user, cmd, e, lang)
                result = {"status": "conflict_saved_as_comment", "serverId": cid, "error": _err(e, lang, user.org_id)}
            else:
                result = {"status": "rejected", "error": _err(e, lang, user.org_id)}
        except asyncpg.PostgresError as e:
            log.warning("sync command %s failed: %s", cmd.command_id, e)
            result = {"status": "rejected", "error": {"error": t("err.server", lang, user.org_id), "code": "server_error"}}
        await db.execute(
            """insert into sync_commands (command_id, device_id, user_id, entity_type, entity_client_uuid, op, result_status, result, server_record_id)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
               on conflict (command_id) do update set result_status = excluded.result_status, result = excluded.result, server_record_id = excluded.server_record_id, received_at = now()""",
            [cmd.command_id, device_id, user.id, cmd.entity_type, cmd.entity_client_uuid, cmd.op, result["status"], result,
             result.get("serverId") if _is_uuid(str(result.get("serverId") or "")) else None],
        )
        status_of[cmd.command_id] = result["status"]
        results.append({"commandId": cmd.command_id, **result})
    if req.commands:
        await db.execute("update devices set last_seen_at = now(), app_version = coalesce(nullif($2, ''), app_version) where device_uuid = $1 and user_id = $3",
                         [device_id, req.app_version, user.id])
    return {"results": results, "serverTime": datetime.now(timezone.utc)}


# ---------- pull ----------

def _parse_cursor(cursor: str | None) -> datetime | None:
    if not cursor:
        return None
    try:
        d = datetime.fromisoformat(cursor.replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    if datetime.now(timezone.utc) - d > timedelta(days=30):
        return None
    return d


async def pull(user: AuthUser, cursor: str | None, device_id: str | None) -> dict:
    server_time = datetime.now(timezone.utc)
    since = _parse_cursor(cursor)
    full = since is None
    delta = (since - timedelta(seconds=60)) if since else None
    scope = user.sites_in_scope()
    officer_sites = [s for s in scope if user.can_view_site(s)]
    org = user.org_id
    async with db._db(None).acquire() as c:
        me = await me_payload(user, c)
        settings = await org_settings(org, c)
        # reference data
        sites_rows = await db.q("select * from sites where id = any($1::uuid[]) and deleted_at is null and ($2::timestamptz is null or updated_at > $2)", [scope, delta], c)
        areas_rows = await db.q("select * from areas where site_id = any($1::uuid[]) and deleted_at is null and ($2::timestamptz is null or updated_at > $2) order by sort", [scope, delta], c)
        assets_rows = await db.q(
            """select a.*, (select token from qr_codes q where q.target_type = 'asset' and q.target_id = a.id and q.active order by created_at desc limit 1) as qr_token
                 from assets a where a.site_id = any($1::uuid[]) and a.deleted_at is null and ($2::timestamptz is null or a.updated_at > $2)""", [scope, delta], c)
        cats_rows = await db.q("select * from categories where org_id = $1 and deleted_at is null and ($2::timestamptz is null or updated_at > $2) order by sort", [org, delta], c)
        contr_rows = await db.q(
            """select k.*, coalesce(array_agg(cs.site_id::text) filter (where cs.site_id is not null), '{}') as site_ids from contractors k
                 left join contractor_sites cs on cs.contractor_id = k.id where k.org_id = $1 and k.deleted_at is null and ($2::timestamptz is null or k.updated_at > $2)
                group by k.id""", [org, delta], c)
        dir_rows = await db.q(
            """select u.id, coalesce(nullif(p.full_name, ''), nullif(u.employee_code, ''), u.email) as name, u.employee_code, u.status, p.employer_id,
                      array_agg(json_build_object('siteId', r.site_id, 'role', r.role::text, 'medicalData', false, 'expiresAt', r.expires_at)::text) as roles
                 from users u left join people p on p.id = u.person_id join user_site_roles r on r.user_id = u.id
                where u.org_id = $1 and u.status = 'active' and (r.site_id = any($2::uuid[]) or r.site_id is null) and (r.expires_at is null or r.expires_at > now())
                group by u.id, p.full_name, p.employer_id""", [org, scope], c)
        matrix_rows = await db.q(
            """select v.*, m.name, m.size from risk_matrix_versions v join risk_matrices m on m.id = v.matrix_id where m.org_id = $1
                and (v.status = 'active' or v.id in (select risk_matrix_version_id from sites where id = any($2::uuid[]) and risk_matrix_version_id is not null))""", [org, scope], c)
        ddr_rows = await db.q("select * from due_date_rules where org_id = $1 and (site_id is null or site_id = any($2::uuid[])) order by site_id nulls first, band", [org, scope], c)
        ladder_rows = await db.q("select * from reminder_ladders where org_id = $1 order by band", [org], c)
        ind_rows = await db.q("select * from industry_profiles where active order by sort, code", [], c)
        sched_rows = await db.q("select * from inspection_schedules where site_id = any($1::uuid[]) and active and ($2::timestamptz is null or updated_at > $2)", [scope, delta], c)
        # observations: mine + site scope for officers (open + last 30 days)
        obs_rows = await db.q(
            OBS_SELECT + """ where o.org_id = $1 and (o.reporter_user_id = $2 or o.id in (select observation_id from observation_reporter_seals where reporter_user_hash = $3)
                   or (o.site_id = any($4::uuid[]) and (o.status in ('submitted','returned','action_assigned','escalated') or o.received_at > now() - interval '30 days'))
                   or o.id in (select source_id from actions where source_type = 'observation' and (owner_user_id = $2 or verifier_user_id = $2) and status not in ('verified','cancelled')))
                  and ($5::timestamptz is null or o.updated_at > $5) order by o.received_at desc limit 2000""",
            [org, user.id, hmac_id(user.id), officer_sites, delta], c)
        act_rows = await db.q(
            ACTION_SELECT + """ where a.org_id = $1 and (a.owner_user_id = $2 or a.verifier_user_id = $2 or a.completed_by = $2
                   or (a.site_id = any($3::uuid[]) and (a.status not in ('verified','cancelled') or a.updated_at > now() - interval '30 days'))
                   or (a.status = 'completed' and a.site_id = any($4::uuid[])))
                  and ($5::timestamptz is null or a.updated_at > $5) order by a.due_at limit 2000""",
            [org, user.id, officer_sites, [s for s in scope if user.can_verify(s)], delta], c)
        run_rows = await db.q(
            RUN_SELECT + """ where r.org_id = $1 and (r.inspector_user_id = $2
                   or (r.status = 'scheduled' and r.site_id = any($3::uuid[]) and (r.schedule_id in (select id from inspection_schedules where assignee_user_id = $2)
                        or r.schedule_id in (select s.id from inspection_schedules s where s.assignee_role::text = any($4::text[]) and s.site_id = any($3::uuid[]))))
                   or (r.site_id = any($5::uuid[]) and (r.status in ('scheduled','in_progress','completed','reopened') or r.updated_at > now() - interval '30 days')))
                  and ($6::timestamptz is null or r.updated_at > $6) order by r.due_at nulls last, r.started_at desc limit 1000""",
            [org, user.id, scope, sorted(user.role_set()), officer_sites, delta], c)
        # templates: active versions in scope + versions used by my open runs
        tmpl_versions = await db.q(
            """select v.id from inspection_template_versions v join inspection_templates t on t.id = v.template_id
                where t.org_id = $1 and t.deleted_at is null and (v.status = 'active'
                   or v.id in (select template_version_id from inspection_runs where inspector_user_id = $2 and status in ('scheduled','in_progress','reopened')))""",
            [org, user.id], c)
        templates = await load_template_versions(c, [v["id"] for v in tmpl_versions])
        if delta:
            templates = [tv for tv in templates if tv["updatedAt"] > delta or tv["approvedAt"] and tv["approvedAt"] > delta]
        ntf_rows = await db.q(
            """select * from notifications where recipient_user_id = $1 and channel = 'inapp' and (read_at is null or created_at > now() - interval '7 days')
                  and ($2::timestamptz is null or created_at > $2 or read_at > $2 or acked_at > $2) order by created_at desc limit 300""", [user.id, delta], c)
        overrides = await load_overrides(org, c)
        notice = await db.q("select version, lang, body, effective_from from privacy_notices where org_id = $1 and status = 'active' and version = (select max(version) from privacy_notices where org_id = $1 and status = 'active')", [org], c)
        deleted: list[dict] = []
        if delta:
            for table, et in (("areas", "area"), ("assets", "asset"), ("categories", "category"), ("contractors", "contractor"), ("sites", "site"), ("inspection_templates", "template")):
                rows = await db.q(f"select id from {table} where deleted_at > $1", [delta], c)
                deleted += [{"entityType": et, "id": r["id"]} for r in rows]
            rows = await db.q("select id from inspection_schedules where not active and updated_at > $1 and site_id = any($2::uuid[])", [delta, scope], c)
            deleted += [{"entityType": "schedule", "id": r["id"]} for r in rows]
            rows = await db.q("select id from inspection_template_versions where status = 'retired' and approved_at is not null and template_id in (select id from inspection_templates where org_id = $1)", [org], c)
            deleted += [{"entityType": "template_version", "id": r["id"]} for r in rows]
        observations = await obs_wf.summary_for(c, user, obs_rows)
        act_media = await media_for(c, "observation", [a["source_id"] for a in act_rows if a["source_type"] == "observation" and a["source_id"]])
        if device_id:
            await db.execute("update devices set last_seen_at = now() where device_uuid = $1 and user_id = $2", [device_id, user.id], c)
    directory = []
    for r in dir_rows:
        roles = [json.loads(x) for x in r["roles"]]
        directory.append(directory_user(r, roles))
    translations = {lang: overrides.get(lang, {}) for lang in LANGS}
    return {
        "cursor": server_time.isoformat(), "full": full, "serverTime": server_time, "me": me,
        "sites": [site(s) for s in sites_rows], "areas": [area(a) for a in areas_rows], "assets": [asset(a) for a in assets_rows], "categories": [category(x) for x in cats_rows],
        "contractors": [contractor(k) for k in contr_rows], "directory": directory, "matrixVersions": [matrix_version({**m, "status_label": settings["statusLabels"].get("risk_matrix", "design default")}) for m in matrix_rows],
        "dueDateRules": [due_date_rule(d) for d in ddr_rows], "ladders": [ladder(l) for l in ladder_rows], "industries": [industry(i) for i in ind_rows], "templates": templates,
        "schedules": [schedule(s) for s in sched_rows], "observations": observations,
        "actions": [action_summary(a, first_thumb(act_media.get(a["source_id"])) if a["source_type"] == "observation" else None) for a in act_rows],
        "runs": [run_summary(r) for r in run_rows], "notifications": [notification(n) for n in ntf_rows], "translations": translations, "deleted": deleted,
        "privacyNotice": ({"version": notice[0]["version"], "body": {n["lang"]: n["body"] for n in notice}, "effectiveFrom": notice[0]["effective_from"]} if notice else None),
    }
