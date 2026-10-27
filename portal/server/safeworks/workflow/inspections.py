"""Inspection runs: start, answers, submit (lock + actions + score + report), reopen, cancel (brief §5.4, §6.3)."""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from .. import db
from ..audit import audit
from ..errors import bad_request, forbidden, not_found
from ..i18n import pick, t
from ..media import create_media_rows
from ..notify import link_for, notify, users_with_roles
from ..numbers import next_case_no
from ..rbac import AuthUser, require_officer, require_scope
from ..reports import store_run_report
from ..schemas import ActionDraft, Answer, RunStartRequest, RunSubmitRequest
from ..settings import org_settings
from ..views import RUN_SELECT, answer as answer_view, media as media_view, media_for, run_summary
from . import actions as actions_wf
from .common import DuplicateRecord, ensure_status, get_site, now, site_label, touch

NA_VALUES = {"na", "n/a", "not_applicable"}


async def load(conn, run_id: str) -> dict:
    r = await db.one(RUN_SELECT + " where r.id = $1", [run_id], conn)
    if not r:
        raise not_found()
    return r


async def _questions(conn, version_id: str) -> list[dict]:
    return await db.q(
        "select q.*, s.repeatable, s.sort as section_sort from inspection_questions q join inspection_sections s on s.id = q.section_id where s.version_id = $1 order by s.sort, q.sort, q.id",
        [version_id], conn,
    )


def _evaluate(q: dict, value: Any) -> tuple[bool, float | None, bool]:
    """(flag, score, is_na) for an answer value against the question's response set / range."""
    if value is None or value == "" or value == []:
        return False, None, False
    at = q["answer_type"]
    if at in ("pass_fail_na", "single_choice", "multi_choice"):
        values = value if isinstance(value, list) else [value]
        flag, scores, na = False, [], False
        for v in values:
            opt = next((o for o in (q["response_set"] or []) if str(o.get("value")) == str(v)), None)
            if opt is None:
                if str(v).lower() in NA_VALUES:
                    na = True
                continue
            if opt.get("flag"):
                flag = True
            if opt.get("score") is None:
                if str(opt.get("value")).lower() in NA_VALUES:
                    na = True
            else:
                scores.append(float(opt["score"]))
        if na and not scores and not flag:
            return False, None, True
        return flag, (min(scores) if scores else (0.0 if flag else 1.0)), False
    if at == "number":
        try:
            x = float(value)
        except (TypeError, ValueError):
            return False, None, False
        lo, hi = q["pass_min"], q["pass_max"]
        ok = (lo is None or x >= float(lo)) and (hi is None or x <= float(hi))
        return (not ok), (1.0 if ok else 0.0), False
    return False, None, False


def _visible(q: dict, answers_by_code: dict[str, Any]) -> bool:
    cond = q["show_if"]
    if not cond:
        return True
    v = answers_by_code.get(cond.get("questionCode") or cond.get("question_code"))
    want = cond.get("equals")
    if isinstance(v, list):
        return str(want) in [str(x) for x in v]
    return v is not None and str(v) == str(want)


# ---------- start ----------

async def start(conn, actor: AuthUser, payload: RunStartRequest) -> dict:
    existing = await db.one("select id, case_no from inspection_runs where client_uuid = $1", [payload.client_uuid.lower()], conn)
    if existing:
        raise DuplicateRecord(existing["id"], existing["case_no"], "inspection_run")
    site = await get_site(conn, payload.site_id)
    require_scope(actor, site["id"])
    version = await db.one("select v.*, t.org_id, t.code from inspection_template_versions v join inspection_templates t on t.id = v.template_id where v.id = $1",
                           [payload.template_version_id], conn)
    if not version or version["org_id"] != actor.org_id:
        raise not_found()
    if payload.area_id and not await db.one("select 1 from areas where id = $1 and site_id = $2", [payload.area_id, site["id"]], conn):
        raise not_found()
    if payload.asset_id and not await db.one("select 1 from assets where id = $1 and site_id = $2", [payload.asset_id, site["id"]], conn):
        raise not_found()
    run = None
    if payload.schedule_id:
        run = await db.one(
            "select * from inspection_runs where schedule_id = $1 and status = 'scheduled' order by due_at limit 1 for update", [payload.schedule_id], conn,
        )
    if run:
        if run["site_id"] != site["id"]:
            raise not_found()
        await db.execute(
            """update inspection_runs set client_uuid = $2, status = 'in_progress', inspector_user_id = $3, header = $4, started_at = $5, start_lat = $6, start_lng = $7,
                                         template_version_id = $8, area_id = coalesce($9, area_id), asset_id = coalesce($10, asset_id) where id = $1""",
            [run["id"], payload.client_uuid.lower(), actor.id, payload.header, payload.started_at, payload.lat, payload.lng, version["id"], payload.area_id, payload.asset_id], conn,
        )
        run_id = run["id"]
        from_status = "scheduled"
    else:
        if version["status"] != "active":
            raise bad_request("This template version is not active.", key="err.template_not_active")
        case_no = await next_case_no(conn, site["code"], "inspection_run", now())
        row = await db.one(
            """insert into inspection_runs (client_uuid, org_id, case_no, template_version_id, site_id, area_id, asset_id, schedule_id, trigger, started_at, status,
                                            inspector_user_id, header, start_lat, start_lng)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'in_progress',$11,$12,$13,$14) returning id""",
            [payload.client_uuid.lower(), actor.org_id, case_no, version["id"], site["id"], payload.area_id, payload.asset_id, payload.schedule_id,
             payload.trigger or "spot", payload.started_at, actor.id, payload.header, payload.lat, payload.lng], conn,
        )
        run_id = row["id"]
        from_status = None
    await touch(conn, "inspection_runs", run_id)
    await audit(conn, org_id=actor.org_id, actor=actor, action="create" if from_status is None else "transition", record_type="inspection_run", record_id=run_id,
                site_id=site["id"], changes={"status": [from_status, "in_progress"], "templateVersionId": version["id"], "templateCode": version["code"]})
    return await detail(conn, actor, run_id)


# ---------- answers ----------

async def _upsert_answer(conn, run: dict, actor: AuthUser, q: dict, a: Answer, settings: dict) -> dict | None:
    flag, score, _ = _evaluate(q, a.value)
    existing = await db.one("select * from inspection_answers where run_id = $1 and question_id = $2 and repeat_index = $3", [run["id"], q["id"], a.repeat_index], conn)
    if existing and existing["answered_at"] and a.answered_at and existing["answered_at"] > a.answered_at:
        return existing  # last write wins by answered_at
    if existing:
        row = await db.one(
            """update inspection_answers set client_uuid = coalesce(client_uuid, $2), value = $3, flag = $4, score = $5, note = $6, likelihood = $7, severity = $8, answered_at = $9,
                                             lat = $10, lng = $11, device_id = $12 where id = $1 returning *""",
            [existing["id"], a.client_uuid.lower(), a.value, flag, score, a.note, a.likelihood, a.severity, a.answered_at, a.lat, a.lng, actor.device_id], conn,
        )
    else:
        dup = await db.one("select id from inspection_answers where client_uuid = $1", [a.client_uuid.lower()], conn)
        row = await db.one(
            """insert into inspection_answers (client_uuid, run_id, question_id, repeat_index, value, flag, score, note, likelihood, severity, answered_at, lat, lng, device_id)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *""",
            [None if dup else a.client_uuid.lower(), run["id"], q["id"], a.repeat_index, a.value, flag, score, a.note, a.likelihood, a.severity, a.answered_at, a.lat, a.lng,
             actor.device_id], conn,
        )
    if a.media:
        await create_media_rows(conn, org_id=run["org_id"], owner_type="inspection_answer", owner_id=row["id"], refs=a.media, created_by=actor.id, device_id=actor.device_id,
                                max_photos=int(settings.get("maxPhotosPerRecord", 10)))
    return row


def _require_inspector(actor: AuthUser, run: dict) -> None:
    require_scope(actor, run["site_id"])
    if run["inspector_user_id"] != actor.id:
        raise forbidden("Only the inspector of this run can do this.", key="err.not_inspector")


async def upsert_answers(conn, actor: AuthUser, run_id: str, answers: list[Answer]) -> dict:
    run = await load(conn, run_id)
    _require_inspector(actor, run)
    settings = await org_settings(run["org_id"], conn)
    if run["status"] in ("completed", "closed"):
        # after submit, late answers become an addendum (brief §13 conflict policy) instead of changing the locked run
        lang = settings.get("defaultLanguage", "en")
        await db.execute("insert into comments (owner_type, owner_id, user_id, kind, body) values ('inspection_run', $1, $2, 'system', $3)",
                         [run["id"], actor.id, t("sys.late_answers", lang, run["org_id"], count=len(answers))], conn)
        return await detail(conn, actor, run_id)
    ensure_status(run, ("in_progress", "reopened"))
    qs = {q["id"]: q for q in await _questions(conn, run["template_version_id"])}
    for a in answers:
        q = qs.get(a.question_id.lower())
        if not q:
            raise bad_request(f"Unknown question {a.question_id}.", key="err.not_found")
        await _upsert_answer(conn, run, actor, q, a, settings)
    await touch(conn, "inspection_runs", run["id"])
    return await detail(conn, actor, run_id)


# ---------- submit ----------

async def submit(conn, actor: AuthUser, run_id: str, payload: RunSubmitRequest) -> dict:
    run = await load(conn, run_id)
    _require_inspector(actor, run)
    if run["status"] in ("completed", "closed") and run["client_uuid"] == payload.client_uuid.lower():
        return await detail(conn, actor, run_id)
    ensure_status(run, ("in_progress", "reopened"))
    settings = await org_settings(run["org_id"], conn)
    qs = await _questions(conn, run["template_version_id"])
    q_by_id = {q["id"]: q for q in qs}
    drafts: dict[tuple[str, int], ActionDraft] = {}
    for a in payload.answers:
        q = q_by_id.get(a.question_id.lower())
        if not q:
            raise bad_request(f"Unknown question {a.question_id}.", key="err.not_found")
        await _upsert_answer(conn, run, actor, q, a, settings)
        if a.action:
            drafts[(q["id"], a.repeat_index)] = a.action
    rows = await db.q("select * from inspection_answers where run_id = $1 order by repeat_index, answered_at", [run["id"]], conn)
    by_q: dict[str, list[dict]] = {}
    answers_by_code: dict[str, Any] = {}
    for r in rows:
        by_q.setdefault(r["question_id"], []).append(r)
        q = q_by_id.get(r["question_id"])
        if q and q["code"] and r["repeat_index"] == 0:
            answers_by_code[q["code"]] = r["value"]
    missing = 0
    for q in qs:
        if not q["required"] or not _visible(q, answers_by_code):
            continue
        answered = [r for r in by_q.get(q["id"], []) if r["value"] not in (None, "", [])]
        if not answered:
            missing += 1
    if missing:
        raise bad_request(f"Answer every required question first ({missing} unanswered).", key="err.required_unanswered", count=missing)
    flagged = [r for r in rows if r["flag"]]
    missing_actions = [r for r in flagged if q_by_id[r["question_id"]]["action_on_fail"] and not r["action_id"] and (r["question_id"], r["repeat_index"]) not in drafts]
    if missing_actions:
        raise bad_request(f"Every failed item needs an action ({len(missing_actions)} missing).", key="err.action_on_fail_missing", count=len(missing_actions))
    site = await get_site(conn, run["site_id"])
    created = 0
    for r in flagged:
        d = drafts.get((r["question_id"], r["repeat_index"]))
        if not d or r["action_id"]:
            continue
        q = q_by_id[r["question_id"]]
        defaults = q["action_defaults"] or {}
        if not d.band:
            d.band = defaults.get("band") or "moderate"
        if not d.problem:
            d.problem = pick(q["text_i18n"], actor.language)
        if d.due_at is None and defaults.get("dueOffsetHours"):
            d.due_at = now() + timedelta(hours=int(defaults["dueOffsetHours"]))
        try:
            action = await actions_wf.create(conn, actor, d, org_id=run["org_id"], site=site, area_id=run["area_id"], source_type="inspection_answer", source_id=r["id"],
                                             captured_at=payload.completed_at)
        except DuplicateRecord as dup:
            action = {"id": dup.record_id}
        await db.execute("update inspection_answers set action_id = $2 where id = $1", [r["id"], action["id"]], conn)
        created += 1
    # repeat findings: same question failed in the previous completed run at the same area / asset
    prev = await db.one(
        """select r.id, r.template_version_id from inspection_runs r join inspection_template_versions v on v.id = r.template_version_id
            where v.template_id = $1 and r.site_id = $2 and r.area_id is not distinct from $3 and r.asset_id is not distinct from $4 and r.id <> $5
              and r.status in ('completed', 'closed') order by r.completed_at desc nulls last limit 1""",
        [run["template_id"], run["site_id"], run["area_id"], run["asset_id"], run["id"]], conn,
    )
    repeat_n = 0
    if prev:
        prev_failed = await db.q(
            """select q.code, q.id as qid, ia.repeat_index from inspection_answers ia join inspection_questions q on q.id = ia.question_id where ia.run_id = $1 and ia.flag""",
            [prev["id"]], conn,
        )
        failed_keys = {(p["code"] or p["qid"], p["repeat_index"]) for p in prev_failed}
        for r in flagged:
            q = q_by_id[r["question_id"]]
            if (q["code"] or q["id"], r["repeat_index"]) in failed_keys:
                await db.execute("update inspection_answers set repeat_finding = true where id = $1", [r["id"]], conn)
                repeat_n += 1
    # score (N/A excluded) and the any-Fail rule
    scored = [r for r in rows if r["score"] is not None]
    score_pct = round(100.0 * sum(float(r["score"]) for r in scored) / len(scored), 1) if scored else 100.0
    scoring = (await db.one("select scoring from inspection_template_versions where id = $1", [run["template_version_id"]], conn))["scoring"] or {}
    any_fail = scoring.get("anyFailRule", True)
    pass_mark = float(scoring.get("passMarkPct", 80))
    result = "fail" if (any_fail and flagged) or score_pct < pass_mark else "pass"
    # signature and lock
    sig_id = None
    uploads: list[dict] = []
    if payload.signature:
        sig_rows, uploads = await create_media_rows(conn, org_id=run["org_id"], owner_type="inspection_run", owner_id=run["id"], refs=[payload.signature], created_by=actor.id,
                                                    device_id=actor.device_id, max_photos=int(settings.get("maxPhotosPerRecord", 10)) + 1)
        sig_id = sig_rows[0]["id"] if sig_rows else None
    final_status = "completed" if created or await _open_actions(conn, run["id"]) else "closed"
    await db.execute(
        """update inspection_runs set status = $2, completed_at = $3, submit_lat = $4, submit_lng = $5, score_pct = $6, result = $7, immediate_action = $8, tag_status = $9,
                                     signature_media_id = coalesce($10, signature_media_id) where id = $1""",
        [run["id"], final_status, payload.completed_at, payload.lat, payload.lng, score_pct, result, payload.immediate_action, payload.tag_status, sig_id], conn,
    )
    if run["asset_id"] and payload.tag_status:
        new_status = "do_not_use" if payload.tag_status == "do_not_use" else "in_service"
        await db.execute("update assets set status = $2, status_reason = $3, version = version + 1, updated_at = now() where id = $1",
                         [run["asset_id"], new_status, f"{run['case_no']}: {payload.tag_status}"], conn)
    await touch(conn, "inspection_runs", run["id"])
    await store_run_report(conn, run["id"], actor.language)
    await audit(conn, org_id=run["org_id"], actor=actor, action="transition", record_type="inspection_run", record_id=run["id"], site_id=run["site_id"],
                changes={"status": [run["status"], final_status], "scorePct": score_pct, "result": result, "failed": len(flagged), "actionsRaised": created, "repeatFindings": repeat_n,
                         "tagStatus": payload.tag_status})
    lang = settings.get("defaultLanguage", "en")
    officers = await users_with_roles(conn, run["site_id"], ["site_safety_officer"], run["org_id"])
    await notify(conn, org_id=run["org_id"], recipients=officers, event_type="inspection_submitted", record_type="inspection_run", record_id=run["id"], key="inspection_submitted",
                 params={"caseNo": run["case_no"], "result": t("report." + result, lang, run["org_id"]), "template": pick(run["template_name"], lang), "site": site_label(site, lang),
                         "score": score_pct, "failed": len(flagged), "actions": created}, link=link_for("inspection_run", run["id"]), exclude=[actor.id], push=result == "fail")
    out = await detail(conn, actor, run_id)
    out["uploads"] = uploads
    return out


async def _open_actions(conn, run_id: str) -> int:
    return await db._db(conn).fetchval(
        "select count(*) from inspection_answers ia join actions a on a.id = ia.action_id where ia.run_id = $1 and a.status not in ('verified','cancelled')", run_id
    ) or 0


async def close_if_done(conn, run_id: str) -> bool:
    run = await db.one("select id, status, org_id, site_id from inspection_runs where id = $1", [run_id], conn)
    if not run or run["status"] != "completed":
        return False
    if await _open_actions(conn, run_id):
        return False
    await db.execute("update inspection_runs set status = 'closed' where id = $1", [run_id], conn)
    await touch(conn, "inspection_runs", run_id)
    await audit(conn, org_id=run["org_id"], actor_role="system", action="transition", record_type="inspection_run", record_id=run_id, site_id=run["site_id"],
                changes={"status": ["completed", "closed"]})
    return True


# ---------- reopen / cancel ----------

async def reopen(conn, actor: AuthUser, run_id: str, reason: str) -> dict:
    run = await load(conn, run_id)
    require_scope(actor, run["site_id"])
    if not (actor.is_admin or actor.is_hse):
        raise forbidden()
    ensure_status(run, ("completed", "closed"))
    if not reason.strip():
        raise bad_request("A reason code and text are required.", key="err.reason_required")
    await db.execute("update inspection_runs set status = 'reopened', reopen_reason = $2, report_superseded = true where id = $1", [run["id"], reason], conn)
    await touch(conn, "inspection_runs", run["id"])
    await audit(conn, org_id=run["org_id"], actor=actor, action="transition", record_type="inspection_run", record_id=run["id"], site_id=run["site_id"],
                changes={"status": [run["status"], "reopened"]}, reason=reason)
    return await detail(conn, actor, run_id)


async def cancel(conn, actor: AuthUser, run_id: str, reason: str) -> dict:
    run = await load(conn, run_id)
    require_officer(actor, run["site_id"])
    ensure_status(run, ("scheduled", "in_progress"))
    if not reason.strip():
        raise bad_request("A reason code and text are required.", key="err.reason_required")
    await db.execute("update inspection_runs set status = 'cancelled', reopen_reason = $2 where id = $1", [run["id"], reason], conn)
    await touch(conn, "inspection_runs", run["id"])
    await audit(conn, org_id=run["org_id"], actor=actor, action="transition", record_type="inspection_run", record_id=run["id"], site_id=run["site_id"],
                changes={"status": [run["status"], "cancelled"]}, reason=reason)
    return await detail(conn, actor, run_id)


# ---------- reads ----------

def can_view(viewer: AuthUser, run: dict) -> bool:
    if not viewer.in_scope(run["site_id"]):
        return False
    if viewer.can_view_site(run["site_id"]):
        return True
    if run["inspector_user_id"] == viewer.id:
        return True
    # a scheduled run assigned to the viewer's role at the site
    return run["status"] == "scheduled"


async def detail(conn, viewer: AuthUser, run_id: str) -> dict:
    run = await load(conn, run_id)
    if not can_view(viewer, run):
        raise not_found()
    rows = await db.q("select * from inspection_answers where run_id = $1 order by repeat_index, answered_at", [run["id"]], conn)
    media = await media_for(conn, "inspection_answer", [r["id"] for r in rows])
    sig = None
    if run["signature_media_id"]:
        sm = await db.one("select * from media where id = $1", [run["signature_media_id"]], conn)
        if sm:
            sig = media_view(sm)
    out = run_summary(run)
    inspector = run["inspector_user_id"] == viewer.id
    out.update({
        "header": run["header"] or {}, "answers": [answer_view(r, media.get(r["id"], [])) for r in rows], "signature": sig,
        "reportUrl": f"/api/v1/inspections/runs/{run['id']}/report" if run["report_media_id"] else None, "immediateAction": run["immediate_action"], "reopenReason": run["reopen_reason"],
        "can": {"answer": inspector and run["status"] in ("in_progress", "reopened"), "submit": inspector and run["status"] in ("in_progress", "reopened"),
                "reopen": (viewer.is_admin or viewer.is_hse) and run["status"] in ("completed", "closed"), "cancel": viewer.is_officer_plus(run["site_id"]) and run["status"] in ("scheduled", "in_progress")},
    })
    return out
