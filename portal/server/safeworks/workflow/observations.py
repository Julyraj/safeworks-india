"""Observations: create, triage, comments, replies, reopen, critical acknowledgement, closure (brief §5.1–5.2, §6.1)."""
from __future__ import annotations

import json
import math
import secrets
from typing import Any

from .. import db
from ..audit import audit
from ..crypto import decrypt_json, encrypt_json, hmac_id
from ..errors import bad_request, conflict, forbidden, not_found
from ..i18n import t
from ..media import create_media_rows
from ..notify import link_for, notify, users_with_roles
from ..numbers import next_case_no
from ..rbac import AuthUser, require_officer, require_scope
from ..schemas import CommentBody, ObservationCreate, QrObservationCreate, ReplyBody, TriageRequest
from ..settings import org_settings
from ..views import OBS_SELECT, action_summary, comment as comment_view, first_thumb, media_for, observation_summary, triage_record
from . import actions as actions_wf
from .common import DuplicateRecord, active_matrix, area_suffix, band_for, ensure_status, fmt_dt, get_site, new_uuid, now, site_label, touch

OPEN_STATUSES = ("submitted", "returned", "action_assigned", "escalated")
TYPE_LABEL = {"good_practice": "label.good_practice", "unsafe_act": "label.unsafe_act", "unsafe_condition": "label.unsafe_condition", "near_miss": "label.near_miss"}


async def load(conn, obs_id: str) -> dict:
    o = await db.one(OBS_SELECT + " where o.id = $1", [obs_id], conn)
    if not o:
        raise not_found()
    return o


async def is_mine(conn, viewer: AuthUser | None, o: dict) -> bool:
    if not viewer:
        return False
    if o["reporter_user_id"] == viewer.id:
        return True
    if o["anonymous"]:
        return bool(await conn.fetchval("select 1 from observation_reporter_seals where observation_id = $1 and reporter_user_hash = $2", o["id"], hmac_id(viewer.id)))
    return False


async def reporter_id(conn, o: dict) -> str | None:
    """Server-only: who to notify (the seal is read only here and never leaves the server)."""
    if o["reporter_user_id"]:
        return o["reporter_user_id"]
    seal = await db.one("select reporter_user_id_enc from observation_reporter_seals where observation_id = $1", [o["id"]], conn)
    if seal:
        try:
            return decrypt_json(seal["reporter_user_id_enc"])
        except Exception:
            return None
    return None


# ---------- create ----------

async def create(conn, actor: AuthUser | None, payload: ObservationCreate | QrObservationCreate, *, site: dict, area_id: str | None, asset_id: str | None,
                 channel: str, device_id: str = "", qr_contact: dict | None = None) -> tuple[dict, list[dict]]:
    """Create an observation (app/web/on_behalf by a signed-in user, or a QR report without an account).
    Returns (observation row, uploads)."""
    existing = await db.one("select id, case_no from observations where client_uuid = $1", [payload.client_uuid.lower()], conn)
    if existing:
        raise DuplicateRecord(existing["id"], existing["case_no"], "observation")
    org_id = site["org_id"]
    if area_id:
        area = await db.one("select id from areas where id = $1 and site_id = $2 and deleted_at is null", [area_id, site["id"]], conn)
        if not area:
            raise bad_request("Choose the area (no GPS fix).", key="err.area_required")
    if asset_id:
        a = await db.one("select id from assets where id = $1 and site_id = $2 and deleted_at is null", [asset_id, site["id"]], conn)
        if not a:
            raise not_found()
    if not area_id and (payload.lat is None or payload.lng is None):
        raise bad_request("Choose the area (no GPS fix).", key="err.area_required")
    if not payload.description.strip() and not payload.media:
        raise bad_request("Describe what you observed.", key="err.description_required")
    if payload.category_codes:
        valid = await db.q("select code from categories where org_id = $1 and code = any($2::text[]) and deleted_at is null", [org_id, payload.category_codes], conn)
        if len(valid) != len(set(payload.category_codes)):
            raise bad_request("Choose at least one category.", key="err.category_required")
    settings = await org_settings(org_id, conn)
    received = now()
    case_no = await next_case_no(conn, site["code"], "observation", received)
    anonymous = bool(payload.anonymous)
    reporter_user_id = actor.id if (actor and not anonymous) else None
    contact_enc = ""
    if qr_contact and not anonymous and (qr_contact.get("name") or qr_contact.get("phone")):
        contact_enc = encrypt_json({k: v for k, v in qr_contact.items() if v})
    employer = getattr(payload, "employer_involved_id", None)
    if actor and employer is None and channel != "qr":
        employer = actor.employer_id
    extra = dict(getattr(payload, "extra", {}) or {})
    on_behalf = getattr(payload, "on_behalf_of", None)
    if on_behalf:
        extra["onBehalfOf"] = on_behalf.model_dump(by_alias=True)
    if qr_contact and qr_contact.get("employerName"):
        extra["employerName"] = qr_contact["employerName"]
    status_secret = secrets.token_urlsafe(12) if channel == "qr" else ""
    row = await db.one(
        """insert into observations (client_uuid, org_id, site_id, area_id, asset_id, case_no, lat, lng, accuracy_m, captured_at, received_at, device_id, channel,
                                     reporter_type, reporter_user_id, anonymous, reporter_contact_enc, type, category_codes, task_observed, description, description_lang,
                                     fixed_on_spot, immediate_action, imminent_danger, employer_involved_id, trade, status_secret)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28) returning id""",
        [payload.client_uuid.lower(), org_id, site["id"], area_id, asset_id, case_no, payload.lat, payload.lng, payload.accuracy_m, payload.captured_at, received, device_id,
         channel, payload.reporter_type, reporter_user_id, anonymous, contact_enc, payload.type, payload.category_codes, getattr(payload, "task_observed", "") or "",
         payload.description, payload.description_lang, payload.fixed_on_spot, payload.immediate_action or "", payload.imminent_danger, employer,
         getattr(payload, "trade", "") or "", status_secret], conn,
    )
    obs_id = row["id"]
    if extra:
        await _store_extra(conn, obs_id, extra)
    if actor and anonymous:
        await db.execute("insert into observation_reporter_seals (observation_id, reporter_user_id_enc, reporter_user_hash) values ($1, $2, $3)",
                         [obs_id, encrypt_json(actor.id), hmac_id(actor.id)], conn)
    max_photos = int(settings.get("maxPhotosPerRecord", 10))
    _, uploads = await create_media_rows(conn, org_id=org_id, owner_type="observation", owner_id=obs_id, refs=payload.media, created_by=actor.id if actor else None,
                                         device_id=device_id, max_photos=max_photos, public=channel == "qr")
    await audit(conn, org_id=org_id, actor=actor, actor_role="public" if not actor else "", action="create", record_type="observation", record_id=obs_id, site_id=site["id"],
                device_id=device_id,
                changes={"caseNo": case_no, "type": payload.type, "categoryCodes": payload.category_codes, "channel": channel, "anonymous": anonymous,
                         "imminentDanger": payload.imminent_danger, "fixedOnSpot": payload.fixed_on_spot, "areaId": area_id, "media": len(payload.media)})
    o = await load(conn, obs_id)
    lang = settings.get("defaultLanguage", "en")
    params = {"caseNo": case_no, "type": t(TYPE_LABEL[payload.type], lang, org_id), "site": site_label(site, lang), "area": area_suffix(o.get("area_name"), lang),
              "description": (payload.description or "")[:160], "minutes": settings.get("criticalAckMinutes", 30)}
    officers = await users_with_roles(conn, site["id"], ["site_safety_officer"], org_id)
    await notify(conn, org_id=org_id, recipients=officers, event_type="new_report", record_type="observation", record_id=obs_id, key="new_report", params=params,
                 link=link_for("observation", obs_id), exclude=[actor.id if actor else None])
    if payload.imminent_danger:
        await send_critical_alert(conn, o, params, exclude=[actor.id if actor else None])
    return o, uploads


async def _store_extra(conn, obs_id: str, extra: dict) -> None:
    # category extra fields have no column of their own in 001: kept as a system comment ("extra:{...}") and surfaced in the detail
    await db.execute("insert into comments (owner_type, owner_id, user_id, kind, body) values ('observation', $1, null, 'system', $2)",
                     [obs_id, "extra:" + json.dumps(extra, ensure_ascii=False)], conn)


async def send_critical_alert(conn, o: dict, params: dict, *, exclude: list | None = None, repeat: bool = False) -> None:
    targets = await users_with_roles(conn, o["site_id"], ["site_head", "site_safety_officer", "hse_manager"], o["org_id"])
    key = "critical_repeat" if repeat else "critical"
    await notify(conn, org_id=o["org_id"], recipients=targets, event_type=key, record_type="observation", record_id=o["id"], key=key, params=params,
                 link=link_for("observation", o["id"]), critical=True, email=True, exclude=exclude or [])


# ---------- triage ----------

def _reason_required(payload: TriageRequest) -> None:
    if not payload.reason_code.strip() or not payload.reason_text.strip():
        raise bad_request("A reason code and text are required.", key="err.reason_required")


async def triage(conn, actor: AuthUser, obs_id: str, payload: TriageRequest) -> dict:
    o = await load(conn, obs_id)
    require_officer(actor, o["site_id"])
    if await db.one("select 1 from triage_decisions where client_uuid = $1", [payload.client_uuid.lower()], conn):
        return await detail(conn, actor, obs_id)
    allowed = ("submitted", "returned") if payload.decision != "escalate_incident" else ("submitted", "returned", "action_assigned")
    if o["status"] not in allowed:
        if o["status"] in ("action_assigned", "closed", "merged", "discarded", "escalated"):
            raise conflict("This report was already triaged by someone else.", key="err.already_triaged")
        ensure_status(o, allowed)
    site = await get_site(conn, o["site_id"])
    org_id = o["org_id"]
    settings = await org_settings(org_id, conn)
    lang = settings.get("defaultLanguage", "en")
    matrix = None
    score = band = None
    if payload.likelihood is not None or payload.severity is not None:
        if payload.likelihood is None or payload.severity is None:
            raise bad_request("Rate likelihood and severity.", key="err.likelihood_severity_required")
        matrix = await active_matrix(conn, org_id, site)
        score, band = band_for(matrix, payload.likelihood, payload.severity)
    d = payload.decision
    to_status = o["status"]
    changes: dict[str, Any] = {"decision": d}
    reporter = await reporter_id(conn, o)
    params = {"caseNo": o["case_no"], "site": site_label(site, lang), "area": area_suffix(o.get("area_name"), lang), "description": o["description"][:160],
              "minutes": settings.get("criticalAckMinutes", 30)}
    created_actions: list[dict] = []

    if d == "accept_assign":
        cats = payload.category_codes if payload.category_codes is not None else list(o["category_codes"] or [])
        if not cats:
            raise bad_request("Choose at least one category.", key="err.category_required")
        if band is None:
            raise bad_request("Rate likelihood and severity.", key="err.likelihood_severity_required")
        if not payload.is3786_code:
            raise bad_request("Choose the IS 3786 code.", key="err.is3786_required")
        if payload.employer_involved_id is None and o["employer_involved_id"] is None:
            raise bad_request("Choose the employer involved.", key="err.employer_required")
        if not payload.actions:
            raise bad_request("Add at least one action.", key="err.actions_required")
        critical = band == "extreme" or o["imminent_danger"]
        if critical and not payload.interim_control.strip():
            raise bad_request("An interim control is required for this risk band.", key="err.interim_required")
        employer = payload.employer_involved_id or o["employer_involved_id"]
        await db.execute(
            """update observations set category_codes = $2, likelihood = $3, severity = $4, risk_score = $5, risk_band = $6, risk_matrix_version_id = $7, is3786_code = $8,
                                       employer_involved_id = $9, trade = coalesce($10, trade), status = 'action_assigned', triaged_by = $11, triaged_at = now() where id = $1""",
            [o["id"], cats, payload.likelihood, payload.severity, score, band, matrix["id"], payload.is3786_code, employer, payload.trade, actor.id], conn,
        )
        to_status = "action_assigned"
        for draft in payload.actions:
            try:
                a = await actions_wf.create(conn, actor, draft, org_id=org_id, site=site, area_id=o["area_id"], source_type="observation", source_id=o["id"],
                                            default_band=band, triage_interim=payload.interim_control, captured_at=payload.captured_at)
                created_actions.append(a)
            except DuplicateRecord:
                continue
        changes.update({"band": band, "likelihood": payload.likelihood, "severity": payload.severity, "is3786Code": payload.is3786_code, "actions": [a["case_no"] for a in created_actions]})
        if critical:
            await send_critical_alert(conn, o, {**params, "description": f"{band}: {o['description'][:140]}"}, exclude=[actor.id])
    elif d == "accept_fixed_on_spot":
        summary = o["immediate_action"] or payload.reason_text or t("sys.closure_summary_none", lang, org_id)
        await db.execute(
            """update observations set status = 'closed', closed_at = now(), closure_summary = $2, closure_feedback_sent_at = now(), triaged_by = $3, triaged_at = now(),
                                       fixed_on_spot = true, likelihood = coalesce($4, likelihood), severity = coalesce($5, severity), risk_score = coalesce($6, risk_score),
                                       risk_band = coalesce($7, risk_band), risk_matrix_version_id = coalesce($8, risk_matrix_version_id),
                                       category_codes = coalesce($9, category_codes) where id = $1""",
            [o["id"], summary, actor.id, payload.likelihood, payload.severity, score, band, matrix["id"] if matrix else None, payload.category_codes], conn,
        )
        to_status = "closed"
        if reporter:
            await notify(conn, org_id=org_id, recipients=[reporter], event_type="observation_closed", record_type="observation", record_id=o["id"], key="observation_closed",
                         params={**params, "summary": summary[:300]}, link=link_for("observation", o["id"]), exclude=[actor.id])
    elif d == "reviewed_no_action":
        _reason_required(payload)
        await db.execute(
            """update observations set status = 'closed', closed_at = now(), closure_summary = $2, closure_feedback_sent_at = now(), triaged_by = $3, triaged_at = now(),
                                       category_codes = coalesce($4, category_codes) where id = $1""",
            [o["id"], f"{payload.reason_code}: {payload.reason_text}", actor.id, payload.category_codes], conn,
        )
        to_status = "closed"
        changes.update({"reasonCode": payload.reason_code})
        if reporter:
            await notify(conn, org_id=org_id, recipients=[reporter], event_type="observation_closed", record_type="observation", record_id=o["id"], key="observation_closed",
                         params={**params, "summary": payload.reason_text[:300]}, link=link_for("observation", o["id"]), exclude=[actor.id])
    elif d == "return_to_reporter":
        if not payload.question.strip():
            raise bad_request("Write the question for the reporter.", key="err.question_required")
        if o["anonymous"] or o["channel"] == "qr" or not o["reporter_user_id"]:
            raise bad_request("Anonymous and QR reports cannot be returned to the reporter.", key="err.anonymous_no_return")
        await db.execute("update observations set status = 'returned', triaged_by = $2, triaged_at = now() where id = $1", [o["id"], actor.id], conn)
        await db.execute("insert into comments (client_uuid, owner_type, owner_id, user_id, kind, body, captured_at) values ($1, 'observation', $2, $3, 'return_question', $4, $5)",
                         [new_uuid(), o["id"], actor.id, payload.question, payload.captured_at], conn)
        to_status = "returned"
        await notify(conn, org_id=org_id, recipients=[o["reporter_user_id"]], event_type="observation_returned", record_type="observation", record_id=o["id"],
                     key="observation_returned", params={**params, "question": payload.question[:300]}, link=link_for("observation", o["id"]))
    elif d == "merge_duplicate":
        if not payload.master_observation_id:
            raise bad_request("Choose the master observation.", key="err.master_required")
        master = await db.one("select id, case_no, site_id, status from observations where id = $1", [payload.master_observation_id], conn)
        if not master or master["site_id"] != o["site_id"] or master["id"] == o["id"] or master["status"] in ("closed", "merged", "discarded"):
            raise bad_request("The master observation must be open and at the same site.", key="err.master_not_open")
        await db.execute("update observations set status = 'merged', master_observation_id = $2, triaged_by = $3, triaged_at = now() where id = $1", [o["id"], master["id"], actor.id], conn)
        await db.execute("insert into comments (owner_type, owner_id, user_id, kind, body) values ('observation', $1, null, 'system', $2)",
                         [master["id"], f"Merged: {o['case_no']}"], conn)
        await db.execute("insert into comments (owner_type, owner_id, user_id, kind, body) values ('observation', $1, null, 'system', $2)",
                         [o["id"], t("sys.merged_into", lang, org_id, caseNo=master["case_no"])], conn)
        await touch(conn, "observations", master["id"])
        to_status = "merged"
        changes.update({"masterObservationId": master["id"], "masterCaseNo": master["case_no"]})
    elif d == "discard":
        _reason_required(payload)
        await db.execute("update observations set status = 'discarded', closed_at = now(), closure_summary = $2, triaged_by = $3, triaged_at = now() where id = $1",
                         [o["id"], f"{payload.reason_code}: {payload.reason_text}", actor.id], conn)
        to_status = "discarded"
        changes.update({"reasonCode": payload.reason_code})
        if reporter:
            await notify(conn, org_id=org_id, recipients=[reporter], event_type="observation_discarded", record_type="observation", record_id=o["id"],
                         key="observation_discarded", params={**params, "reason": payload.reason_code}, link=link_for("observation", o["id"]), exclude=[actor.id])
    elif d == "escalate_incident":
        learned = payload.learned_at or now()
        inc = await db.one(
            """insert into incidents (org_id, site_id, case_no, observation_id, event_class, learned_at, status, created_by)
               values ($1,$2,$3,$4,$5,$6,'escalated',$7) returning id""",
            [org_id, o["site_id"], o["case_no"], o["id"], "near_miss" if o["type"] == "near_miss" else "dangerous_occurrence", learned, actor.id], conn,
        )
        await db.execute(
            """update observations set status = 'escalated', escalated_incident_id = $2, learned_at = $3, triaged_by = $4, triaged_at = coalesce(triaged_at, now()),
                                       likelihood = coalesce($5, likelihood), severity = coalesce($6, severity), risk_score = coalesce($7, risk_score), risk_band = coalesce($8, risk_band),
                                       risk_matrix_version_id = coalesce($9, risk_matrix_version_id) where id = $1""",
            [o["id"], inc["id"], learned, actor.id, payload.likelihood, payload.severity, score, band, matrix["id"] if matrix else None], conn,
        )
        to_status = "escalated"
        changes.update({"incidentId": inc["id"], "learnedAt": learned})
        targets = await users_with_roles(conn, o["site_id"], ["site_safety_officer", "site_head", "hse_manager"], org_id)
        await notify(conn, org_id=org_id, recipients=targets, event_type="observation_escalated", record_type="observation", record_id=o["id"], key="observation_escalated",
                     params={**params, "learnedAt": fmt_dt(learned)}, link=link_for("observation", o["id"]), email=True, exclude=[actor.id])
    else:
        raise bad_request("Unknown triage decision.", key="err.decision_invalid")

    await db.one(
        """insert into triage_decisions (client_uuid, observation_id, decision, reason_code, reason_text, likelihood, severity, band, risk_matrix_version_id, decided_by, device_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id""",
        [payload.client_uuid.lower(), o["id"], d, payload.reason_code, payload.reason_text or payload.question, payload.likelihood, payload.severity, band,
         matrix["id"] if matrix else None, actor.id, actor.device_id], conn,
    )
    await touch(conn, "observations", o["id"])
    changes["status"] = [o["status"], to_status]
    await audit(conn, org_id=org_id, actor=actor, action="transition", record_type="observation", record_id=o["id"], site_id=o["site_id"], changes=changes,
                reason=payload.reason_text or payload.question or "")
    return await detail(conn, actor, obs_id)


# ---------- comments, replies, reopen, ack ----------

async def add_comment(conn, actor: AuthUser, obs_id: str, payload: CommentBody) -> dict:
    o = await load(conn, obs_id)
    mine = await is_mine(conn, actor, o)
    if not (mine or actor.is_officer_plus(o["site_id"])):
        if actor.in_scope(o["site_id"]) and await _linked_action_user(conn, actor, o):
            pass
        else:
            raise not_found()
    existing = await db.one("select * from comments where client_uuid = $1", [payload.client_uuid.lower()], conn)
    if existing:
        row = existing
    else:
        row = await db.one(
            "insert into comments (client_uuid, owner_type, owner_id, user_id, kind, body, captured_at) values ($1, 'observation', $2, $3, 'comment', $4, $5) returning *",
            [payload.client_uuid.lower(), o["id"], actor.id, payload.body, payload.captured_at], conn,
        )
        await touch(conn, "observations", o["id"])
        await audit(conn, org_id=o["org_id"], actor=actor, action="create", record_type="comment", record_id=row["id"], site_id=o["site_id"], changes={"observationId": o["id"], "body": payload.body[:200]})
    hide = o["anonymous"] and mine  # an anonymous reporter's comment shows no name
    return comment_view({**row, "user_name": None if hide else actor.name}, actor.id)


async def reply(conn, actor: AuthUser, obs_id: str, payload: ReplyBody) -> dict:
    o = await load(conn, obs_id)
    if not await is_mine(conn, actor, o):
        raise not_found()
    if await db.one("select 1 from comments where client_uuid = $1", [payload.client_uuid.lower()], conn):
        return await detail(conn, actor, obs_id)
    ensure_status(o, ("returned",))
    row = await db.one(
        "insert into comments (client_uuid, owner_type, owner_id, user_id, kind, body, captured_at) values ($1, 'observation', $2, $3, 'reporter_reply', $4, $5) returning *",
        [payload.client_uuid.lower(), o["id"], actor.id, payload.body, payload.captured_at], conn,
    )
    uploads: list[dict] = []
    if payload.media:
        settings = await org_settings(o["org_id"], conn)
        _, uploads = await create_media_rows(conn, org_id=o["org_id"], owner_type="observation", owner_id=o["id"], refs=payload.media, created_by=actor.id,
                                             device_id=actor.device_id, max_photos=int(settings.get("maxPhotosPerRecord", 10)))
    await db.execute("update observations set status = 'submitted' where id = $1", [o["id"]], conn)
    await touch(conn, "observations", o["id"])
    await audit(conn, org_id=o["org_id"], actor=actor, action="transition", record_type="observation", record_id=o["id"], site_id=o["site_id"],
                changes={"status": ["returned", "submitted"], "commentId": row["id"]})
    officers = await users_with_roles(conn, o["site_id"], ["site_safety_officer"], o["org_id"])
    await notify(conn, org_id=o["org_id"], recipients=officers, event_type="observation_reply", record_type="observation", record_id=o["id"], key="observation_reply",
                 params={"caseNo": o["case_no"], "body": payload.body[:300]}, link=link_for("observation", o["id"]))
    out = await detail(conn, actor, obs_id)
    out["uploads"] = uploads
    return out


async def reopen(conn, actor: AuthUser, obs_id: str, reason: str) -> dict:
    o = await load(conn, obs_id)
    require_officer(actor, o["site_id"])
    ensure_status(o, ("closed",))
    if not reason.strip():
        raise bad_request("A reason code and text are required.", key="err.reason_required")
    await db.execute("update observations set status = 'action_assigned', closed_at = null, closure_feedback_sent_at = null where id = $1", [o["id"]], conn)
    await db.execute("insert into triage_decisions (observation_id, decision, reason_text, decided_by, device_id) values ($1, 'reopen', $2, $3, $4)",
                     [o["id"], reason, actor.id, actor.device_id], conn)
    settings = await org_settings(o["org_id"], conn)
    lang = settings.get("defaultLanguage", "en")
    await db.execute("insert into comments (owner_type, owner_id, user_id, kind, body) values ('observation', $1, $2, 'system', $3)",
                     [o["id"], actor.id, t("sys.reopened", lang, o["org_id"], reason=reason)], conn)
    await touch(conn, "observations", o["id"])
    await audit(conn, org_id=o["org_id"], actor=actor, action="transition", record_type="observation", record_id=o["id"], site_id=o["site_id"],
                changes={"status": ["closed", "action_assigned"]}, reason=reason)
    owners = await db.q("select distinct owner_user_id from actions where source_type = 'observation' and source_id = $1 and status <> 'cancelled'", [o["id"]], conn)
    await notify(conn, org_id=o["org_id"], recipients=[r["owner_user_id"] for r in owners], event_type="observation_reopened", record_type="observation", record_id=o["id"],
                 key="observation_reopened", params={"caseNo": o["case_no"], "reason": reason[:300]}, link=link_for("observation", o["id"]), exclude=[actor.id])
    return await detail(conn, actor, obs_id)


async def ack_critical(conn, actor: AuthUser, obs_id: str) -> dict:
    o = await load(conn, obs_id)
    require_scope(actor, o["site_id"])
    if not (actor.roles_at(o["site_id"]) & {"site_head", "site_safety_officer", "hse_manager"}):
        raise forbidden()
    if not o["critical_acked_at"]:
        await db.execute("update observations set critical_acked_at = now(), critical_acked_by = $2 where id = $1", [o["id"], actor.id], conn)
        await touch(conn, "observations", o["id"])
        await db.execute("update escalations set resolved_at = now() where record_type = 'observation' and record_id = $1 and reason = 'critical_unacknowledged' and resolved_at is null", [o["id"]], conn)
        await audit(conn, org_id=o["org_id"], actor=actor, action="transition", record_type="observation", record_id=o["id"], site_id=o["site_id"], changes={"criticalAcked": True})
    await db.execute("update notifications set acked_at = coalesce(acked_at, now()), status = 'acknowledged' where record_type = 'observation' and record_id = $1 and critical and recipient_user_id = $2",
                     [o["id"], actor.id], conn)
    return await detail(conn, actor, obs_id)


async def set_closure_summary(conn, actor: AuthUser, obs_id: str, summary: str) -> dict:
    o = await load(conn, obs_id)
    require_officer(actor, o["site_id"])
    ensure_status(o, ("closed",), as_conflict=False)
    await db.execute("update observations set closure_summary = $2 where id = $1", [o["id"], summary], conn)
    await touch(conn, "observations", o["id"])
    await audit(conn, org_id=o["org_id"], actor=actor, action="update", record_type="observation", record_id=o["id"], site_id=o["site_id"],
                changes={"closureSummary": [o["closure_summary"], summary]})
    return await detail(conn, actor, obs_id)


async def close_if_done(conn, actor: AuthUser | None, obs_id: str) -> bool:
    """When the last action is verified (none left open), close the observation; the notice goes out 30 min later (job)."""
    o = await db.one("select * from observations where id = $1", [obs_id], conn)
    if not o or o["status"] != "action_assigned":
        return False
    counts = await db.one(
        """select count(*) filter (where status not in ('verified','cancelled'))::int as open_n, count(*) filter (where status = 'verified')::int as verified_n,
                  string_agg(nullif(completion_note, ''), ' | ' order by verified_at) filter (where status = 'verified') as notes
             from actions where source_type = 'observation' and source_id = $1""",
        [obs_id], conn,
    )
    if counts["open_n"] > 0 or counts["verified_n"] == 0:
        return False
    settings = await org_settings(o["org_id"], conn)
    summary = counts["notes"] or t("sys.closure_summary_none", settings.get("defaultLanguage", "en"), o["org_id"])
    await db.execute("update observations set status = 'closed', closed_at = now(), closure_summary = $2, closure_feedback_sent_at = null where id = $1", [obs_id, summary], conn)
    await touch(conn, "observations", obs_id)
    await audit(conn, org_id=o["org_id"], actor=actor, actor_role="system" if actor is None else "", action="transition", record_type="observation", record_id=obs_id,
                site_id=o["site_id"], changes={"status": ["action_assigned", "closed"], "closureSummary": summary[:300]})
    return True


# ---------- duplicates ----------

def _distance_m(lat1, lng1, lat2, lng2) -> float | None:
    if None in (lat1, lng1, lat2, lng2):
        return None
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


async def duplicates(conn, o: dict) -> list[dict]:
    settings = await org_settings(o["org_id"], conn)
    hours = int(settings.get("duplicateWindowHours", 24))
    radius = float(settings.get("duplicateRadiusM", 30))
    cands = await db.q(
        """select id, case_no, type, status, description, received_at, category_codes, asset_id, lat, lng from observations
            where site_id = $1 and area_id is not distinct from $2 and id <> $3 and status not in ('closed', 'discarded', 'merged')
              and received_at between $4::timestamptz - make_interval(hours => $5) and $4::timestamptz + make_interval(hours => $5)
              and category_codes && $6::text[]
            order by received_at desc limit 50""",
        [o["site_id"], o["area_id"], o["id"], o["received_at"], hours, list(o["category_codes"] or []) or ["__none__"]], conn,
    )
    out = []
    mine_cats = set(o["category_codes"] or [])
    for c in cands:
        score = 40.0
        reasons = ["same_area"]
        overlap = mine_cats & set(c["category_codes"] or [])
        if overlap:
            score += 20 + 5 * (len(overlap) - 1)
            reasons.append("category_overlap")
        gap_h = abs((o["received_at"] - c["received_at"]).total_seconds()) / 3600
        score += max(0.0, 15 * (1 - gap_h / max(hours, 1)))
        reasons.append("within_window")
        if o["asset_id"] and c["asset_id"] == o["asset_id"]:
            score += 15
            reasons.append("same_asset")
        dist = _distance_m(o["lat"], o["lng"], c["lat"], c["lng"])
        if dist is not None and dist <= radius:
            score += 10
            reasons.append("gps_within_radius")
        if c["type"] == o["type"]:
            score += 5
            reasons.append("same_type")
        out.append({"id": c["id"], "caseNo": c["case_no"], "type": c["type"], "status": c["status"], "description": c["description"], "receivedAt": c["received_at"],
                    "score": round(min(score, 100.0), 1), "reasons": reasons})
    out.sort(key=lambda x: -x["score"])
    return out[:5]


# ---------- reads ----------

async def _linked_action_user(conn, viewer: AuthUser, o: dict) -> bool:
    return bool(await conn.fetchval(
        "select 1 from actions where source_type = 'observation' and source_id = $1 and (owner_user_id = $2 or verifier_user_id = $2 or completed_by = $2) limit 1", o["id"], viewer.id
    ))


async def can_view(conn, viewer: AuthUser, o: dict) -> tuple[bool, bool]:
    """(may view, mine)."""
    mine = await is_mine(conn, viewer, o)
    if mine:
        return True, True
    if not viewer.in_scope(o["site_id"]):
        return False, False
    if viewer.can_view_site(o["site_id"]):
        return True, False
    return await _linked_action_user(conn, viewer, o), False


async def detail(conn, viewer: AuthUser, obs_id: str, *, with_duplicates: bool = False) -> dict:
    o = await load(conn, obs_id)
    ok, mine = await can_view(conn, viewer, o)
    if not ok:
        raise not_found()
    show_identity = viewer.sees_reporter_identity(o["site_id"])
    media = (await media_for(conn, "observation", [o["id"]])).get(o["id"], [])
    out = observation_summary(o, mine=mine, show_reporter=show_identity, thumb=first_thumb(media))
    decisions = await db.q(
        """select d.*, coalesce(p.full_name, u.employee_code) as decided_by_name from triage_decisions d join users u on u.id = d.decided_by
             left join people p on p.id = u.person_id where d.observation_id = $1 order by d.decided_at""",
        [o["id"]], conn,
    )
    comments = await db.q(
        """select c.*, coalesce(p.full_name, u.employee_code) as user_name from comments c left join users u on u.id = c.user_id left join people p on p.id = u.person_id
            where c.owner_type = 'observation' and c.owner_id = $1 order by c.created_at""",
        [o["id"]], conn,
    )
    extra: dict = {}
    visible_comments = []
    for c in comments:
        if c["kind"] == "system" and c["body"].startswith("extra:"):
            try:
                extra = json.loads(c["body"][6:])
            except Exception:
                extra = {}
            continue
        # the anonymous reporter's own comments and replies carry no name
        hide = (o["anonymous"] or o["channel"] == "qr") and c["kind"] in ("comment", "reporter_reply") and c["user_id"] is not None and c["user_id"] != o["triaged_by"] \
            and not await _is_staff_comment(conn, c["user_id"], o["site_id"])
        visible_comments.append(comment_view(c, viewer.id, hide_name=hide))
    acts = await db.q(actions_wf.ACTION_SELECT + " where a.source_type = 'observation' and a.source_id = $1 order by a.created_at", [o["id"]], conn)
    contact = None
    if show_identity and o["reporter_contact_enc"] and not o["anonymous"]:
        try:
            c = decrypt_json(o["reporter_contact_enc"]) or {}
            contact = {"name": c.get("name", ""), "phone": c.get("phone", "")}
        except Exception:
            contact = None
    officer = viewer.is_officer_plus(o["site_id"])
    out.update({
        "assetId": o["asset_id"], "lat": o["lat"], "lng": o["lng"], "accuracyM": o["accuracy_m"], "taskObserved": o["task_observed"], "descriptionLang": o["description_lang"],
        "immediateAction": o["immediate_action"], "employerInvolvedId": o["employer_involved_id"], "trade": o["trade"], "extra": extra, "likelihood": o["likelihood"],
        "severity": o["severity"], "riskScore": o["risk_score"], "riskMatrixVersionId": o["risk_matrix_version_id"], "is3786Code": o["is3786_code"],
        "masterObservationId": o["master_observation_id"], "masterCaseNo": o.get("master_case_no"), "escalatedIncidentId": o["escalated_incident_id"], "learnedAt": o["learned_at"],
        "closureSummary": o["closure_summary"], "media": media, "triage": [triage_record(d) for d in decisions], "comments": visible_comments,
        "actions": [action_summary(a) for a in acts], "reporterContact": contact,
        "can": {"triage": officer and o["status"] in ("submitted", "returned"), "comment": mine or officer or bool(acts and await _linked_action_user(conn, viewer, o)),
                "reopen": officer and o["status"] == "closed", "ackCritical": bool(o["imminent_danger"] or o["risk_band"] == "extreme") and not o["critical_acked_at"] and
                bool(viewer.roles_at(o["site_id"]) & {"site_head", "site_safety_officer", "hse_manager"}), "reply": mine and o["status"] == "returned"},
    })
    if with_duplicates and officer:
        out["duplicates"] = await duplicates(conn, o)
    return out


async def _is_staff_comment(conn, user_id: str, site_id: str) -> bool:
    roles = await db.q("select role::text as role from user_site_roles where user_id = $1 and (site_id = $2 or site_id is null)", [user_id, site_id], conn)
    return bool({r["role"] for r in roles} & {"site_safety_officer", "site_head", "hse_manager", "admin", "verifier", "action_owner"})


async def summary_for(conn, viewer: AuthUser, rows: list[dict]) -> list[dict]:
    """ObservationSummary list with `mine`, reporter visibility and thumbnails resolved in bulk."""
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    media = await media_for(conn, "observation", ids)
    mine_ids = {r["id"] for r in rows if r["reporter_user_id"] == viewer.id}
    sealed = await db.q("select observation_id from observation_reporter_seals where observation_id = any($1::uuid[]) and reporter_user_hash = $2", [ids, hmac_id(viewer.id)], conn)
    mine_ids |= {s["observation_id"] for s in sealed}
    return [observation_summary(r, mine=r["id"] in mine_ids, show_reporter=viewer.sees_reporter_identity(r["site_id"]), thumb=first_thumb(media.get(r["id"]))) for r in rows]


def public_status(o: dict, actions: list[dict], decisions: list[dict], lang: str) -> dict:
    timeline = [{"at": o["received_at"], "text": t("status.timeline.received", lang, o["org_id"])}]
    for d in decisions:
        timeline.append({"at": d["decided_at"], "text": t("status.timeline.triaged", lang, o["org_id"], decision=t(f"label.decision.{d['decision']}", lang, o["org_id"]))})
    for a in actions:
        timeline.append({"at": a["updated_at"], "text": t("status.timeline.action", lang, o["org_id"], caseNo=a["case_no"], status=a["status"])})
    if o["closed_at"]:
        timeline.append({"at": o["closed_at"], "text": t("status.timeline.closed", lang, o["org_id"])})
    timeline.sort(key=lambda x: x["at"])
    return {"caseNo": o["case_no"], "status": o["status"], "type": o["type"], "receivedAt": o["received_at"], "timeline": timeline,
            "closureSummary": o["closure_summary"] if o["status"] == "closed" else ""}
