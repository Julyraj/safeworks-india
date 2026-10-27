"""Corrective actions (brief §5.3, §6.2; API.md "Actions")."""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from .. import db
from ..audit import audit
from ..errors import bad_request, conflict, forbidden, not_found
from ..media import create_media_rows
from ..notify import link_for, notify, users_with_roles
from ..numbers import next_case_no
from ..rbac import AuthUser, require_officer, require_scope
from ..schemas import (ActionCancelRequest, ActionCommentBody, ActionCompleteRequest, ActionCreateRequest, ActionDraft, ActionReassignRequest,
                       ActionRequestCreate, ActionRequestDecide, ActionVerifyRequest)
from ..settings import org_settings
from ..views import ACTION_SELECT, action_event, action_request, action_summary, first_thumb, media_for
from .common import DuplicateRecord, compute_due, device_of, due_rule, ensure_status, fmt_dt, get_site, new_uuid, now, touch, user_has_site, user_roles_at

FINAL = ("verified", "cancelled")
OPEN = ("open", "in_progress", "reopened")


async def load(conn, action_id: str) -> dict:
    a = await db.one(ACTION_SELECT + " where a.id = $1", [action_id], conn)
    if not a:
        raise not_found()
    return a


async def _event(conn, action: dict, actor: AuthUser | None, event_type: str, *, from_status: str | None = None, to_status: str | None = None,
                 body: str = "", payload: dict | None = None, client_uuid: str | None = None, captured_at=None) -> dict:
    row = await db.one(
        """insert into action_events (action_id, client_uuid, event_type, from_status, to_status, body, payload, actor_user_id, captured_at, device_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *""",
        [action["id"], (client_uuid or new_uuid()).lower(), event_type, from_status, to_status, body or "", payload or {}, actor.id if actor else None, captured_at,
         device_of(actor)], conn,
    )
    return row


async def _notify_owner(conn, action: dict, key: str, params: dict, *, exclude: list | None = None, email: bool = False, critical: bool = False) -> None:
    await notify(conn, org_id=action["org_id"], recipients=[action["owner_user_id"]], event_type=key, record_type="action", record_id=action["id"], key=key,
                 params=params, link=link_for("action", action["id"]), critical=critical, email=email, exclude=exclude or [])


async def _officers(conn, action: dict, include_head: bool = False) -> list[str]:
    roles = ["site_safety_officer", "site_head"] if include_head else ["site_safety_officer"]
    return await users_with_roles(conn, action["site_id"], roles, action["org_id"])


def _params(action: dict, **extra: Any) -> dict:
    p = {"caseNo": action["case_no"], "title": action["title"], "band": action["band"], "due": fmt_dt(action["due_at"]), "owner": action.get("owner_name") or "",
         "site": action.get("site_code") or ""}
    p.update(extra)
    return p


# ---------- create ----------

async def create(conn, actor: AuthUser | None, draft: ActionDraft | ActionCreateRequest, *, org_id: str, site: dict, area_id: str | None,
                 source_type: str, source_id: str | None, default_band: str | None = None, triage_interim: str = "", captured_at=None, quiet: bool = False) -> dict:
    """Create an action from a draft (triage, inspection submit or POST /actions). Returns the action row."""
    existing = await db.one("select id, case_no from actions where client_uuid = $1", [draft.client_uuid.lower()], conn)
    if existing:
        raise DuplicateRecord(existing["id"], existing["case_no"], "action")
    if not await user_has_site(conn, draft.owner_user_id, site["id"]):
        raise bad_request("Choose an action owner at this site.", key="err.owner_required")
    band = draft.band or default_band
    if not band:
        raise bad_request("Choose the risk band.", key="err.likelihood_severity_required")
    rule = await due_rule(conn, org_id, site["id"], band)
    created_at = now()
    due_at = draft.due_at or compute_due(rule, created_at, site)
    interim = draft.interim_control or triage_interim
    if rule["interim_control_required"] and not interim:
        raise bad_request("An interim control is required for this risk band.", key="err.interim_required")
    case_no = await next_case_no(conn, site["code"], "action", created_at)
    row = await db.one(
        """insert into actions (client_uuid, org_id, site_id, area_id, case_no, source_type, source_id, title, problem, action_type, control_level, owner_user_id,
                                responsible_employer_id, band, original_due_at, due_at, interim_control, interim_review_at, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16,$17,$18) returning id""",
        [draft.client_uuid.lower(), org_id, site["id"], area_id, case_no, source_type, source_id, draft.title, draft.problem, draft.action_type, draft.control_level,
         draft.owner_user_id, draft.responsible_employer_id, band, due_at, interim, draft.interim_review_at, actor.id if actor else None], conn,
    )
    action = await load(conn, row["id"])
    action["site_code"] = site["code"]
    await _event(conn, action, actor, "created", to_status="open", body=draft.title, captured_at=captured_at,
                 payload={"band": band, "dueAt": due_at, "sourceType": source_type, "sourceId": source_id})
    await audit(conn, org_id=org_id, actor=actor, action="create", record_type="action", record_id=action["id"], site_id=site["id"],
                changes={"caseNo": case_no, "title": draft.title, "band": band, "ownerUserId": draft.owner_user_id, "dueAt": due_at, "sourceType": source_type, "sourceId": source_id})
    if not quiet:
        await _notify_owner(conn, action, "action_assigned", _params(action), exclude=[actor.id if actor else None])
    return action


async def create_rest(conn, actor: AuthUser, payload: ActionCreateRequest) -> dict:
    site = await get_site(conn, payload.site_id)
    require_officer(actor, site["id"])
    source_type = payload.source_type or "manual"
    if source_type == "observation" and payload.source_id:
        obs = await db.one("select id, site_id, risk_band, area_id from observations where id = $1", [payload.source_id], conn)
        if not obs or obs["site_id"] != site["id"]:
            raise not_found()
        default_band = obs["risk_band"]
        area_id = payload.area_id or obs["area_id"]
    else:
        default_band = None
        area_id = payload.area_id
    try:
        action = await create(conn, actor, payload, org_id=actor.org_id, site=site, area_id=area_id, source_type=source_type, source_id=payload.source_id,
                              default_band=default_band, captured_at=payload.captured_at)
    except DuplicateRecord as d:
        return await detail(conn, actor, d.record_id)
    return await detail(conn, actor, action["id"])


# ---------- transitions ----------

def _require_owner(actor: AuthUser, action: dict) -> None:
    require_scope(actor, action["site_id"])
    if action["owner_user_id"] != actor.id:
        raise forbidden("Only the action owner can do this.", key="err.not_owner")


async def start(conn, actor: AuthUser, action_id: str, captured_at=None, client_uuid: str | None = None) -> dict:
    a = await load(conn, action_id)
    _require_owner(actor, a)
    if client_uuid and await db.one("select 1 from action_events where client_uuid = $1", [client_uuid.lower()], conn):
        return await detail(conn, actor, action_id)
    ensure_status(a, ("open", "reopened"))
    await db.execute("update actions set status = 'in_progress' where id = $1", [a["id"]], conn)
    await touch(conn, "actions", a["id"])
    await _event(conn, a, actor, "status_change", from_status=a["status"], to_status="in_progress", client_uuid=client_uuid, captured_at=captured_at)
    await audit(conn, org_id=a["org_id"], actor=actor, action="transition", record_type="action", record_id=a["id"], site_id=a["site_id"], changes={"status": [a["status"], "in_progress"]})
    return await detail(conn, actor, action_id)


async def complete(conn, actor: AuthUser, action_id: str, payload: ActionCompleteRequest) -> dict:
    a = await load(conn, action_id)
    _require_owner(actor, a)
    if await db.one("select 1 from action_events where client_uuid = $1", [payload.client_uuid.lower()], conn):
        return await detail(conn, actor, action_id)
    ensure_status(a, OPEN)
    if not payload.completion_note.strip():
        raise bad_request("Write what was done.", key="err.completion_note_required")
    if not payload.cause_addressed.strip():
        raise bad_request("Record the cause addressed.", key="err.cause_required")
    if not any(m.kind == "photo" and m.purpose == "after" for m in payload.media):
        raise bad_request("At least one after-photo is required.", key="err.after_photo_required")
    ev = await _event(conn, a, actor, "status_change", from_status=a["status"], to_status="completed", body=payload.completion_note,
                      payload={"causeAddressed": payload.cause_addressed}, client_uuid=payload.client_uuid, captured_at=payload.captured_at)
    settings = await org_settings(a["org_id"], conn)
    rows, uploads = await create_media_rows(conn, org_id=a["org_id"], owner_type="action_event", owner_id=ev["client_uuid"], refs=payload.media, created_by=actor.id,
                                            device_id=actor.device_id, max_photos=int(settings.get("maxPhotosPerRecord", 10)))
    await db.execute(
        "update actions set status = 'completed', completed_at = $2, completed_by = $3, completion_note = $4, cause_addressed = $5 where id = $1",
        [a["id"], now(), actor.id, payload.completion_note, payload.cause_addressed], conn,
    )
    await touch(conn, "actions", a["id"])
    await audit(conn, org_id=a["org_id"], actor=actor, action="transition", record_type="action", record_id=a["id"], site_id=a["site_id"],
                changes={"status": [a["status"], "completed"], "completionNote": payload.completion_note, "causeAddressed": payload.cause_addressed, "afterPhotos": len(rows)})
    verifiers = await users_with_roles(conn, a["site_id"], ["verifier", "site_safety_officer"], a["org_id"])
    await notify(conn, org_id=a["org_id"], recipients=verifiers, event_type="action_completed", record_type="action", record_id=a["id"], key="action_completed",
                 params=_params(a, note=payload.completion_note[:200]), link=link_for("action", a["id"]), exclude=[actor.id])
    out = await detail(conn, actor, action_id)
    out["uploads"] = uploads
    return out


async def verify(conn, actor: AuthUser, action_id: str, payload: ActionVerifyRequest) -> dict:
    a = await load(conn, action_id)
    require_scope(actor, a["site_id"])
    if await db.one("select 1 from action_events where client_uuid = $1", [payload.client_uuid.lower()], conn):
        return await detail(conn, actor, action_id)
    if actor.id in (a["owner_user_id"], a["completed_by"]):
        raise forbidden("The owner or completer of an action cannot verify it.", key="err.verifier_separation")
    if not actor.can_verify(a["site_id"]):
        raise forbidden("Only a verifier or safety officer of this site can verify.", key="err.not_verifier")
    ensure_status(a, ("completed",))
    if payload.result == "not_effective" and not payload.reason.strip():
        raise bad_request("Give the reason the action was not effective.", key="err.verification_reason_required")
    to_status = "verified" if payload.result == "effective" else "reopened"
    ev = await _event(conn, a, actor, "verification", from_status="completed", to_status=to_status, body=payload.reason,
                      payload={"result": payload.result, "method": payload.method}, client_uuid=payload.client_uuid, captured_at=payload.captured_at)
    uploads: list[dict] = []
    if payload.media:
        settings = await org_settings(a["org_id"], conn)
        _, uploads = await create_media_rows(conn, org_id=a["org_id"], owner_type="action_event", owner_id=ev["client_uuid"], refs=payload.media, created_by=actor.id,
                                             device_id=actor.device_id, max_photos=int(settings.get("maxPhotosPerRecord", 10)))
    if to_status == "verified":
        await db.execute(
            """update actions set status = 'verified', verified_at = $2, verifier_user_id = $3, verification_method = $4, verification_result = 'effective',
                                  verification_reason = $5 where id = $1""",
            [a["id"], now(), actor.id, payload.method, payload.reason], conn,
        )
    else:
        site = await get_site(conn, a["site_id"])
        rule = await due_rule(conn, a["org_id"], a["site_id"], a["band"])
        new_due = compute_due(rule, now(), site)
        await db.execute(
            """update actions set status = 'reopened', verifier_user_id = $2, verification_method = $3, verification_result = 'not_effective', verification_reason = $4,
                                  reopen_count = reopen_count + 1, due_at = $5, completed_at = null, completed_by = null where id = $1""",
            [a["id"], actor.id, payload.method, payload.reason, new_due], conn,
        )
    await touch(conn, "actions", a["id"])
    await audit(conn, org_id=a["org_id"], actor=actor, action="transition", record_type="action", record_id=a["id"], site_id=a["site_id"],
                changes={"status": ["completed", to_status], "result": payload.result, "method": payload.method, "reason": payload.reason})
    fresh = await load(conn, action_id)
    if to_status == "verified":
        officers = await _officers(conn, a)
        await notify(conn, org_id=a["org_id"], recipients=[a["owner_user_id"], *officers], event_type="action_verified", record_type="action", record_id=a["id"],
                     key="action_verified", params=_params(fresh, verifier=actor.name), link=link_for("action", a["id"]), exclude=[actor.id])
        await _source_reevaluate(conn, actor, fresh)
    else:
        await _notify_owner(conn, fresh, "action_reopened", _params(fresh, reason=payload.reason[:200]), exclude=[actor.id])
    out = await detail(conn, actor, action_id)
    out["uploads"] = uploads
    return out


async def _source_reevaluate(conn, actor: AuthUser | None, a: dict) -> None:
    if a["source_type"] == "observation" and a["source_id"]:
        from . import observations
        await observations.close_if_done(conn, actor, a["source_id"])
    elif a["source_type"] == "inspection_answer" and a["source_id"]:
        from . import inspections
        run_id = await db._db(conn).fetchval("select run_id from inspection_answers where id = $1", a["source_id"])
        if run_id:
            await inspections.close_if_done(conn, run_id)


async def request(conn, actor: AuthUser, action_id: str, payload: ActionRequestCreate) -> dict:
    a = await load(conn, action_id)
    _require_owner(actor, a)
    if await db.one("select 1 from action_events where client_uuid = $1", [payload.client_uuid.lower()], conn):
        return await detail(conn, actor, action_id)
    ensure_status(a, OPEN)
    if await db.one("select 1 from action_requests where action_id = $1 and status = 'pending'", [a["id"]], conn):
        raise conflict("A request is already pending on this action.", key="err.request_pending")
    if payload.type == "date_change" and not payload.proposed_due_at:
        raise bad_request("Choose the proposed date.", key="err.date_required")
    settings = await org_settings(a["org_id"], conn)
    earlier = await db._db(conn).fetchval("select count(*) from action_requests where action_id = $1 and type = 'date_change'", a["id"]) if payload.type == "date_change" else 0
    needs_head = payload.type == "date_change" and (earlier or 0) + 1 >= int(settings.get("dateChangeRequestsBeforeSiteHead", 3))
    req = await db.one(
        """insert into action_requests (action_id, type, requested_by, proposed_due_at, reason_code, reason)
           values ($1,$2,$3,$4,$5,$6) returning *""",
        [a["id"], payload.type, actor.id, payload.proposed_due_at, (payload.reason_code or "") + ("|site_head" if needs_head else ""), payload.reason], conn,
    )
    from_status = a["status"]
    if payload.type == "dispute":
        pause = int(settings.get("disputePauseDays", 3))
        await db.execute("update actions set status = 'disputed', ladder_paused_until = now() + make_interval(days => $2) where id = $1", [a["id"], pause], conn)
        await _event(conn, a, actor, "dispute_raised", from_status=from_status, to_status="disputed", body=payload.reason, payload={"requestId": req["id"], "reasonCode": payload.reason_code},
                     client_uuid=payload.client_uuid, captured_at=payload.captured_at)
    else:
        await db.execute("update actions set ladder_paused_until = greatest(coalesce(ladder_paused_until, now()), now() + interval '3 days') where id = $1", [a["id"]], conn)
        await _event(conn, a, actor, "date_change_requested", body=payload.reason, payload={"requestId": req["id"], "proposedDueAt": payload.proposed_due_at, "needsSiteHead": needs_head},
                     client_uuid=payload.client_uuid, captured_at=payload.captured_at)
    await touch(conn, "actions", a["id"])
    await audit(conn, org_id=a["org_id"], actor=actor, action="create", record_type="action_request", record_id=req["id"], site_id=a["site_id"],
                changes={"actionId": a["id"], "type": payload.type, "proposedDueAt": payload.proposed_due_at, "reason": payload.reason, "needsSiteHead": needs_head})
    # Officer decides; the site head when the officer owns the action or when the 3rd date change needs the site head
    owner_roles = await user_roles_at(conn, a["owner_user_id"], a["site_id"])
    roles = ["site_head", "hse_manager"] if (needs_head or "site_safety_officer" in owner_roles) else ["site_safety_officer"]
    deciders = await users_with_roles(conn, a["site_id"], roles, a["org_id"])
    key = "dispute_raised" if payload.type == "dispute" else "date_change_requested"
    await notify(conn, org_id=a["org_id"], recipients=deciders, event_type=key, record_type="action", record_id=a["id"], key=key,
                 params=_params(a, reason=payload.reason[:200], proposed=fmt_dt(payload.proposed_due_at)), link=link_for("action", a["id"]), exclude=[actor.id])
    return await detail(conn, actor, action_id)


async def decide(conn, actor: AuthUser, action_id: str, request_id: str, payload: ActionRequestDecide) -> dict:
    a = await load(conn, action_id)
    require_officer(actor, a["site_id"])
    req = await db.one("select * from action_requests where id = $1 and action_id = $2", [request_id, a["id"]], conn)
    if not req:
        raise not_found()
    if req["status"] != "pending":
        raise conflict("This request was already decided.", key="err.conflict")
    owner_roles = await user_roles_at(conn, a["owner_user_id"], a["site_id"])
    needs_head = "|site_head" in (req["reason_code"] or "") or a["owner_user_id"] == actor.id or ("site_safety_officer" in owner_roles and not actor.is_site_head(a["site_id"]))
    if needs_head and not actor.is_site_head(a["site_id"]):
        raise forbidden("The site head must decide this request.", key="err.site_head_needed")
    decision = payload.decision
    new_owner = payload.new_owner_user_id
    if decision == "reassigned" or (decision == "approved" and req["type"] == "dispute"):
        if not new_owner:
            raise bad_request("Choose a different owner.", key="err.self_reassign")
        if new_owner == a["owner_user_id"]:
            raise bad_request("Choose a different owner.", key="err.self_reassign")
        if not await user_has_site(conn, new_owner, a["site_id"]):
            raise bad_request("Choose an action owner at this site.", key="err.owner_required")
        decision = "reassigned"
    await db.execute("update action_requests set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1",
                     [req["id"], decision, actor.id, payload.note], conn)
    from_status = a["status"]
    to_status = a["status"]
    changes: dict[str, Any] = {"requestId": req["id"], "type": req["type"], "decision": decision, "note": payload.note}
    if req["type"] == "date_change":
        if decision == "approved":
            new_due = payload.new_due_at or req["proposed_due_at"]
            await db.execute("update actions set due_at = $2, ladder_paused_until = null where id = $1", [a["id"], new_due], conn)
            changes["dueAt"] = [a["due_at"], new_due]
        else:
            await db.execute("update actions set ladder_paused_until = null where id = $1", [a["id"]], conn)
        if decision == "reassigned":
            await db.execute("update actions set owner_user_id = $2, ladder_paused_until = null where id = $1", [a["id"], new_owner], conn)
        await _event(conn, a, actor, "date_change_decided", body=payload.note, payload={"requestId": req["id"], "decision": decision, "newDueAt": payload.new_due_at or req["proposed_due_at"]})
    else:
        if a["status"] == "disputed":
            to_status = "open"
        if decision == "reassigned":
            await db.execute("update actions set owner_user_id = $2, status = 'open', ladder_paused_until = null where id = $1", [a["id"], new_owner], conn)
            changes["ownerUserId"] = [a["owner_user_id"], new_owner]
        else:
            await db.execute("update actions set status = 'open', ladder_paused_until = null where id = $1", [a["id"]], conn)
        await _event(conn, a, actor, "dispute_decided", from_status=from_status, to_status=to_status, body=payload.note, payload={"requestId": req["id"], "decision": decision})
    if decision == "reassigned":
        await _event(conn, a, actor, "reassigned", body=payload.note, payload={"from": a["owner_user_id"], "to": new_owner})
    await touch(conn, "actions", a["id"])
    await audit(conn, org_id=a["org_id"], actor=actor, action="transition", record_type="action_request", record_id=req["id"], site_id=a["site_id"], changes=changes)
    fresh = await load(conn, action_id)
    await notify(conn, org_id=a["org_id"], recipients=[req["requested_by"]], event_type="request_decided", record_type="action", record_id=a["id"], key="request_decided",
                 params=_params(fresh, decision=decision, note=payload.note or ""), link=link_for("action", a["id"]), exclude=[actor.id])
    if decision == "reassigned":
        await _notify_owner(conn, fresh, "action_reassigned", _params(fresh, reason=payload.note or ""), exclude=[actor.id])
    return await detail(conn, actor, action_id)


async def cancel(conn, actor: AuthUser, action_id: str, payload: ActionCancelRequest) -> dict:
    a = await load(conn, action_id)
    require_officer(actor, a["site_id"])
    if a["status"] in FINAL:
        raise conflict(f"This cannot be done while the record is {a['status']}.", key="err.wrong_status", status=a["status"])
    approver_roles = await user_roles_at(conn, payload.approved_by_user_id, a["site_id"])
    if not approver_roles & {"site_head", "hse_manager"}:
        raise bad_request("Cancelling needs approval from a site head or HSE manager of this site.", key="err.approver_not_site_head")
    await db.execute("update actions set status = 'cancelled', cancel_reason = $2, cancel_approved_by = $3 where id = $1", [a["id"], payload.reason, payload.approved_by_user_id], conn)
    await db.execute("update action_requests set status = 'cancelled' where action_id = $1 and status = 'pending'", [a["id"]], conn)
    await touch(conn, "actions", a["id"])
    await _event(conn, a, actor, "status_change", from_status=a["status"], to_status="cancelled", body=payload.reason, payload={"approvedBy": payload.approved_by_user_id})
    await audit(conn, org_id=a["org_id"], actor=actor, action="transition", record_type="action", record_id=a["id"], site_id=a["site_id"],
                changes={"status": [a["status"], "cancelled"], "approvedByUserId": payload.approved_by_user_id}, reason=payload.reason)
    fresh = await load(conn, action_id)
    await _notify_owner(conn, fresh, "action_cancelled", _params(fresh, reason=payload.reason), exclude=[actor.id])
    await _source_reevaluate(conn, actor, fresh)
    return await detail(conn, actor, action_id)


async def reassign(conn, actor: AuthUser, action_id: str, payload: ActionReassignRequest) -> dict:
    a = await load(conn, action_id)
    require_officer(actor, a["site_id"])
    if a["status"] in FINAL:
        raise conflict(f"This cannot be done while the record is {a['status']}.", key="err.wrong_status", status=a["status"])
    if payload.new_owner_user_id == a["owner_user_id"]:
        raise bad_request("Choose a different owner.", key="err.self_reassign")
    if not await user_has_site(conn, payload.new_owner_user_id, a["site_id"]):
        raise bad_request("Choose an action owner at this site.", key="err.owner_required")
    to_status = "open" if a["status"] == "disputed" else a["status"]
    await db.execute("update actions set owner_user_id = $2, status = $3, ladder_paused_until = null where id = $1", [a["id"], payload.new_owner_user_id, to_status], conn)
    await db.execute("update action_requests set status = 'reassigned', decided_by = $2, decided_at = now() where action_id = $1 and status = 'pending'", [a["id"], actor.id], conn)
    await touch(conn, "actions", a["id"])
    await _event(conn, a, actor, "reassigned", from_status=a["status"], to_status=to_status, body=payload.reason, payload={"from": a["owner_user_id"], "to": payload.new_owner_user_id})
    await audit(conn, org_id=a["org_id"], actor=actor, action="update", record_type="action", record_id=a["id"], site_id=a["site_id"],
                changes={"ownerUserId": [a["owner_user_id"], payload.new_owner_user_id]}, reason=payload.reason)
    fresh = await load(conn, action_id)
    await _notify_owner(conn, fresh, "action_reassigned", _params(fresh, reason=payload.reason), exclude=[actor.id])
    return await detail(conn, actor, action_id)


async def add_comment(conn, actor: AuthUser, action_id: str, payload: ActionCommentBody) -> dict:
    a = await load(conn, action_id)
    if not await can_view(conn, actor, a):
        raise not_found()
    existing = await db.one("select * from action_events where client_uuid = $1", [payload.client_uuid.lower()], conn)
    uploads: list[dict] = []
    if existing:
        ev = existing
    else:
        if not payload.body.strip() and not payload.media:
            raise bad_request("Write a comment or add a photo.", key="err.description_required")
        ev = await _event(conn, a, actor, "comment" if payload.body.strip() else "attachment", body=payload.body, client_uuid=payload.client_uuid, captured_at=payload.captured_at)
        if payload.media:
            settings = await org_settings(a["org_id"], conn)
            _, uploads = await create_media_rows(conn, org_id=a["org_id"], owner_type="action_event", owner_id=ev["client_uuid"], refs=payload.media, created_by=actor.id,
                                                 device_id=actor.device_id, max_photos=int(settings.get("maxPhotosPerRecord", 10)))
        await touch(conn, "actions", a["id"])
    media = await media_for(conn, "action_event", [ev["client_uuid"]])
    out = action_event({**ev, "actor_name": actor.name}, media.get(ev["client_uuid"], []))
    out["uploads"] = uploads
    return out


# ---------- reads ----------

async def can_view(conn, viewer: AuthUser, a: dict) -> bool:
    if not viewer.in_scope(a["site_id"]):
        return False
    if viewer.can_view_site(a["site_id"]):
        return True
    return viewer.id in (a["owner_user_id"], a["verifier_user_id"], a["completed_by"], a["created_by"])


def can_flags(viewer: AuthUser, a: dict) -> dict:
    owner = a["owner_user_id"] == viewer.id
    officer = viewer.is_officer_plus(a["site_id"])
    open_ = a["status"] in OPEN
    return {
        "start": owner and a["status"] in ("open", "reopened"),
        "complete": owner and open_,
        "verify": a["status"] == "completed" and viewer.can_verify(a["site_id"]) and viewer.id not in (a["owner_user_id"], a["completed_by"]),
        "request": owner and open_,
        "decide": officer and bool(a.get("pending_request")),
        "cancel": officer and a["status"] not in FINAL,
        "reassign": officer and a["status"] not in FINAL,
        "comment": True,
    }


async def detail(conn, viewer: AuthUser, action_id: str) -> dict:
    a = await load(conn, action_id)
    if not await can_view(conn, viewer, a):
        raise not_found()
    events = await db.q(
        """select e.*, coalesce(p.full_name, u.employee_code) as actor_name from action_events e left join users u on u.id = e.actor_user_id
             left join people p on p.id = u.person_id where e.action_id = $1 order by e.id""",
        [a["id"]], conn,
    )
    ev_media = await media_for(conn, "action_event", [e["client_uuid"] for e in events if e["client_uuid"]])
    reqs = await db.q(
        """select q.*, coalesce(pr.full_name, ur.employee_code) as requested_by_name, coalesce(pd.full_name, ud.employee_code) as decided_by_name
             from action_requests q join users ur on ur.id = q.requested_by left join people pr on pr.id = ur.person_id
             left join users ud on ud.id = q.decided_by left join people pd on pd.id = ud.person_id where q.action_id = $1 order by q.created_at""",
        [a["id"]], conn,
    )
    source_media: list[dict] = []
    if a["source_type"] == "observation" and a["source_id"]:
        source_media = (await media_for(conn, "observation", [a["source_id"]])).get(a["source_id"], [])
    elif a["source_type"] == "inspection_answer" and a["source_id"]:
        source_media = (await media_for(conn, "inspection_answer", [a["source_id"]])).get(a["source_id"], [])
    thumb = None
    for e in reversed(events):
        if e["to_status"] == "completed":
            thumb = first_thumb(ev_media.get(e["client_uuid"]))
            if thumb:
                break
    out = action_summary(a, thumb or first_thumb(source_media))
    out.update({
        "problem": a["problem"], "causeAddressed": a["cause_addressed"], "actionType": a["action_type"], "controlLevel": a["control_level"],
        "interimControl": a["interim_control"], "interimReviewAt": a["interim_review_at"], "statutoryClock": a["statutory_clock"], "completedByName": a.get("completed_by_name"),
        "completionNote": a["completion_note"], "verificationMethod": a["verification_method"], "verifierName": a.get("verifier_name"), "verificationResult": a["verification_result"],
        "verificationReason": a["verification_reason"], "escalationLevel": a["escalation_level"], "cancelReason": a["cancel_reason"], "sourceMedia": source_media,
        "events": [action_event(e, ev_media.get(e["client_uuid"], [])) for e in events], "requests": [action_request(r) for r in reqs], "can": can_flags(viewer, a),
    })
    return out


def overdue_after(due_at, days: int):
    return due_at + timedelta(days=days)
