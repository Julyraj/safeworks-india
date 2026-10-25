"""Row → wire shape (camelCase dicts mirroring types.ts). Reference data and record summaries."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from . import db
from .security import signed_file_url

ZERO_UUID = "00000000-0000-0000-0000-000000000000"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ---------- reference data ----------

def site(r: dict) -> dict:
    return {
        "id": r["id"], "code": r["code"], "name": r["name_i18n"], "address": r["address"], "state": r["state"], "district": r["district"],
        "lat": r["lat"], "lng": r["lng"], "geofenceRadiusM": r["geofence_radius_m"], "industryCode": r["industry_code"],
        "establishmentType": r["establishment_type"], "appropriateGovernment": r["appropriate_government"], "ruleSetCode": r["rule_set_code"],
        "ruleSetEffectiveFrom": r["rule_set_effective_from"], "riskMatrixVersionId": r["risk_matrix_version_id"],
        "hazardousProcess": r["hazardous_process"], "workingCalendar": r["working_calendar"], "workerCount": r["worker_count"],
        "siteHeadUserId": r["site_head_user_id"], "active": r["active"] and r.get("deleted_at") is None, "version": r["version"], "updatedAt": r["updated_at"],
    }


def area(r: dict) -> dict:
    return {
        "id": r["id"], "siteId": r["site_id"], "parentAreaId": r["parent_area_id"], "code": r["code"], "name": r["name_i18n"],
        "areaType": r["area_type"], "hazardousProcess": r["hazardous_process"], "ownerUserId": r["owner_user_id"], "sort": r["sort"],
        "active": r["active"] and r.get("deleted_at") is None, "version": r["version"], "updatedAt": r["updated_at"],
    }


def asset(r: dict) -> dict:
    return {
        "id": r["id"], "siteId": r["site_id"], "areaId": r["area_id"], "assetClass": r["asset_class"], "tagNo": r["tag_no"], "serialNo": r["serial_no"],
        "makeModel": r["make_model"], "swlKg": float(r["swl_kg"]) if r["swl_kg"] is not None else None, "ownerEmployerId": r["owner_employer_id"],
        "status": r["status"], "statusReason": r["status_reason"], "nextExamDue": r["next_exam_due"], "qrToken": r.get("qr_token"),
        "version": r["version"], "updatedAt": r["updated_at"],
    }


def category(r: dict) -> dict:
    return {
        "id": r["id"], "code": r["code"], "parentCode": r["parent_code"], "name": r["name_i18n"], "icon": r["icon"], "appliesTo": r["applies_to"] or {},
        "criticalCapable": r["critical_capable"], "incidentPrompt": r["incident_prompt"], "is3786Default": r["is3786_default"],
        "extraFields": r["extra_fields"] or [], "defaultRecipientRoles": list(r["default_recipient_roles"] or []), "emailDetail": r["email_detail"],
        "sort": r["sort"], "active": r["active"] and r.get("deleted_at") is None, "updatedAt": r["updated_at"],
    }


def contractor(r: dict) -> dict:
    return {
        "id": r["id"], "name": r["name"], "isOwnCompany": r["is_own_company"], "parentId": r["parent_id"], "registrationNo": r["registration_no"],
        "contactName": r["contact_name"], "phone": r["phone"], "email": r["email"], "trades": list(r["trades"] or []),
        "siteIds": list(r.get("site_ids") or []), "active": r["active"] and r.get("deleted_at") is None, "updatedAt": r["updated_at"],
    }


def person(r: dict) -> dict:
    last4 = r.get("phone_last4") or ""
    return {
        "id": r["id"], "fullName": r["full_name"], "employerId": r["employer_id"], "phoneMasked": ("••••••" + last4) if last4 else "",
        "preferredLanguage": r["preferred_language"], "trade": r["trade"], "workerType": "contractor" if r["worker_type"] == "contract" else r["worker_type"],
        "active": r["active"] and r.get("deleted_at") is None,
    }


def directory_user(r: dict, roles: list[dict]) -> dict:
    return {"id": r["id"], "name": r["name"], "employeeCode": r["employee_code"], "employerId": r.get("employer_id"), "roles": roles, "active": r["status"] == "active"}


def matrix_version(r: dict) -> dict:
    return {
        "id": r["id"], "matrixId": r["matrix_id"], "name": r["name"], "size": r["size"], "version": r["version"], "status": r["status"],
        "effectiveFrom": r["effective_from"],
        "likelihoodLabels": [{"v": x["v"], "label": x.get("label") or x.get("label_i18n") or {}} for x in (r["likelihood_labels"] or [])],
        "severityLabels": [{"v": x["v"], "label": x.get("label") or x.get("label_i18n") or {}, "anchor": x.get("anchor") or x.get("anchor_i18n")} for x in (r["severity_labels"] or [])],
        "bands": [{"band": b["band"], "min": b["min"], "max": b["max"], "colour": b["colour"], "response": b.get("response") or b.get("response_i18n") or {}} for b in (r["bands"] or [])],
        "statusLabel": r.get("status_label") or "design default",
    }


def due_date_rule(r: dict) -> dict:
    return {"id": r["id"], "siteId": r["site_id"], "band": r["band"], "dueAmount": r["due_amount"], "dueUnit": r["due_unit"],
            "interimControlRequired": r["interim_control_required"], "verifyWithinHours": r["verify_within_hours"], "statusLabel": r["status_label"]}


def ladder(r: dict) -> dict:
    return {"id": r["id"], "band": r["band"], "steps": r["steps"] or [], "dailyCap": r["daily_cap"], "statusLabel": r["status_label"]}


def industry(r: dict) -> dict:
    return {"code": r["code"], "name": r["name_i18n"], "tagline": r["tagline"], "icon": r["icon"], "establishmentTypes": list(r["establishment_types"] or []),
            "categoryCodes": list(r["category_codes"] or []), "templateCodes": list(r["template_codes"] or []), "hazards": list(r["hazards"] or []),
            "ppe": list(r["ppe"] or []), "library": r["library"] or {}}


def timer_rule(r: dict) -> dict:
    trig = r["trigger"] or {}
    return {"id": r["id"], "trigger": {"eventClass": trig.get("event_class") or trig.get("eventClass") or "", "conditions": trig.get("conditions") or []},
            "deadlineBasis": r["deadline_basis"], "deadlineMinutes": r["deadline_minutes"], "recipient": r["recipient"], "formCode": r["form_code"],
            "status": r["status"], "sourceNote": r["source_note"]}


def rule_set(r: dict, timers: list[dict]) -> dict:
    return {"code": r["code"], "name": r["name"], "state": r["state"], "siteType": r["site_type"], "regime": r["regime"], "status": r["status"],
            "enabled": r["enabled"], "version": r["version"], "effectiveFrom": r["effective_from"], "reviewedBy": r["reviewed_by"], "reviewedAt": r["reviewed_at"],
            "notes": r["notes"], "timerRules": [timer_rule(t) for t in timers]}


def schedule(r: dict) -> dict:
    return {"id": r["id"], "templateId": r["template_id"], "siteId": r["site_id"], "areaId": r["area_id"], "assetId": r["asset_id"], "frequency": r["frequency"],
            "assigneeUserId": r["assignee_user_id"], "assigneeRole": r["assignee_role"], "leadDays": r["lead_days"], "graceHours": r["grace_hours"],
            "nextDueAt": r["next_due_at"], "active": r["active"]}


def qr_code(r: dict, public_url: str) -> dict:
    return {"id": r["id"], "token": r["token"], "targetType": r["target_type"], "targetId": r["target_id"], "targetName": r.get("target_name") or "",
            "label": r["label"], "prefill": r["prefill"] or {}, "active": r["active"], "scanCount": r["scan_count"], "lastScanAt": r["last_scan_at"],
            "createdAt": r["created_at"], "url": f"{public_url}/q/{r['token']}"}


def notification(r: dict) -> dict:
    return {"id": r["id"], "eventType": r["event_type"], "recordType": r["record_type"], "recordId": r["record_id"], "title": r["title"], "body": r["body"],
            "link": r["link"], "critical": r["critical"], "status": r["status"], "readAt": r["read_at"], "ackedAt": r["acked_at"], "createdAt": r["created_at"]}


# ---------- media ----------

def media(r: dict, long_lived: bool = False) -> dict:
    uploaded = r["upload_status"] in ("uploaded", "verified")
    url = signed_file_url(r["storage_key"], 10 * 365 * 86400 if long_lived else None) if uploaded else None
    return {
        "id": r["id"], "clientUuid": r["client_uuid"], "kind": r["kind"], "purpose": r["purpose"], "sha256": r["sha256_capture"], "bytes": r["bytes"],
        "mime": r["mime"], "width": r["width"], "height": r["height"], "durationS": r["duration_s"], "capturedAt": r["captured_at"], "lat": r["lat"], "lng": r["lng"],
        "annotation": r["annotation"], "redacted": r["redacted"], "ownerType": r["owner_type"], "ownerId": r["owner_id"], "url": url, "thumbUrl": url,
        "uploadStatus": r["upload_status"], "hashMatch": r["hash_match"],
    }


async def media_for(conn, owner_type: str, owner_ids: list[str]) -> dict[str, list[dict]]:
    if not owner_ids:
        return {}
    rows = await db.q("select * from media where owner_type = $1 and owner_id = any($2::uuid[]) order by received_at, id", [owner_type, owner_ids], conn)
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(r["owner_id"], []).append(media(r))
    return out


def first_thumb(items: list[dict] | None) -> str | None:
    for m in items or []:
        if m["kind"] == "photo" and m["url"]:
            return m["url"]
    return None


# ---------- templates ----------

def question(r: dict) -> dict:
    return {
        "id": r["id"], "code": r["code"], "sort": r["sort"], "text": r["text_i18n"], "guidance": r["guidance_i18n"] or {}, "guidanceMediaUrl": r.get("guidance_media_url"),
        "answerType": r["answer_type"],
        "responseSet": [{"value": o["value"], "label": o.get("label") or o.get("label_i18n") or {}, "colour": o.get("colour", "grey"), "flag": bool(o.get("flag")), "score": o.get("score")} for o in (r["response_set"] or [])],
        "unit": r["unit"], "min": _num(r["min"]), "max": _num(r["max"]), "passMin": _num(r["pass_min"]), "passMax": _num(r["pass_max"]),
        "required": r["required"], "photoOnFail": r["photo_on_fail"], "noteOnFail": r["note_on_fail"], "actionOnFail": r["action_on_fail"],
        "actionDefaults": r["action_defaults"] or {}, "showIf": r["show_if"], "referenceText": r["reference_text"], "referenceStatus": r["reference_status"],
    }


def _num(v: Any) -> float | None:
    return float(v) if v is not None else None


def template_version(v: dict, tmpl: dict, sections: list[dict], author_name: str | None, approver_name: str | None) -> dict:
    return {
        "id": v["id"], "templateId": tmpl["id"], "code": tmpl["code"], "name": tmpl["name_i18n"], "type": tmpl["type"], "version": v["version"], "status": v["status"],
        "titleFields": v["title_fields"] or [], "scoring": v["scoring"] or {}, "requiredCompetenceType": v["required_competence_type"], "appliesTo": tmpl["applies_to"] or {},
        "authorName": author_name, "approvedByName": approver_name, "approvedAt": v["approved_at"], "changeNote": v["change_note"], "sections": sections,
        "updatedAt": max(v["created_at"], tmpl["updated_at"]),
    }


async def load_template_versions(conn, version_ids: list[str]) -> list[dict]:
    """Full TemplateVersion documents (sections and questions) for the given version ids."""
    if not version_ids:
        return []
    versions = await db.q(
        """select v.*, t.id as t_id, t.code as t_code, t.name_i18n as t_name, t.type as t_type, t.applies_to as t_applies, t.updated_at as t_updated,
                  coalesce(pa.full_name, ua.employee_code) as author_name, coalesce(pb.full_name, ub.employee_code) as approver_name
             from inspection_template_versions v join inspection_templates t on t.id = v.template_id
             left join users ua on ua.id = v.author_id left join people pa on pa.id = ua.person_id
             left join users ub on ub.id = v.approved_by left join people pb on pb.id = ub.person_id
            where v.id = any($1::uuid[]) order by t.code, v.version""",
        [version_ids], conn,
    )
    secs = await db.q("select * from inspection_sections where version_id = any($1::uuid[]) order by version_id, sort, id", [version_ids], conn)
    sec_ids = [s["id"] for s in secs]
    qs = await db.q("select * from inspection_questions where section_id = any($1::uuid[]) order by section_id, sort, id", [sec_ids], conn) if sec_ids else []
    q_by_sec: dict[str, list[dict]] = {}
    for q in qs:
        q_by_sec.setdefault(q["section_id"], []).append(question(q))
    sec_by_ver: dict[str, list[dict]] = {}
    for s in secs:
        sec_by_ver.setdefault(s["version_id"], []).append(
            {"id": s["id"], "sort": s["sort"], "title": s["title_i18n"], "repeatable": s["repeatable"], "repeatLabel": s["repeat_label"], "questions": q_by_sec.get(s["id"], [])}
        )
    out = []
    for v in versions:
        tmpl = {"id": v["t_id"], "code": v["t_code"], "name_i18n": v["t_name"], "type": v["t_type"], "applies_to": v["t_applies"], "updated_at": v["t_updated"]}
        out.append(template_version(v, tmpl, sec_by_ver.get(v["id"], []), v["author_name"], v["approver_name"]))
    return out


# ---------- observations ----------

OBS_SELECT = """select o.*, a.name_i18n as area_name, s.code as site_code, s.name_i18n as site_name,
                       coalesce(rp.full_name, ru.employee_code, ru.email) as reporter_name,
                       (select count(*) from actions x where x.source_type = 'observation' and x.source_id = o.id and x.status not in ('verified','cancelled'))::int as open_actions,
                       (select count(*) from actions x where x.source_type = 'observation' and x.source_id = o.id and x.status <> 'cancelled')::int as total_actions,
                       m.case_no as master_case_no
                  from observations o join sites s on s.id = o.site_id left join areas a on a.id = o.area_id
                  left join users ru on ru.id = o.reporter_user_id left join people rp on rp.id = ru.person_id
                  left join observations m on m.id = o.master_observation_id"""


def observation_summary(r: dict, *, mine: bool, show_reporter: bool, thumb: str | None) -> dict:
    anonymous = r["anonymous"] or r["channel"] == "qr" and r["reporter_user_id"] is None
    return {
        "id": r["id"], "clientUuid": r["client_uuid"], "caseNo": r["case_no"], "siteId": r["site_id"], "areaId": r["area_id"], "areaName": r.get("area_name"),
        "type": r["type"], "categoryCodes": list(r["category_codes"] or []), "description": r["description"], "status": r["status"], "riskBand": r["risk_band"],
        "imminentDanger": r["imminent_danger"], "fixedOnSpot": r["fixed_on_spot"], "anonymous": r["anonymous"], "channel": r["channel"],
        "reporterName": (r.get("reporter_name") if (show_reporter and not anonymous) else None),
        "capturedAt": r["captured_at"], "receivedAt": r["received_at"], "triagedAt": r["triaged_at"], "closedAt": r["closed_at"], "thumbUrl": thumb,
        "openActions": r.get("open_actions", 0), "totalActions": r.get("total_actions", 0), "criticalAckedAt": r["critical_acked_at"], "mine": mine,
        "version": r["version"], "updatedAt": r["updated_at"],
    }


def triage_record(r: dict) -> dict:
    return {"id": r["id"], "decision": r["decision"], "reasonCode": r["reason_code"], "reasonText": r["reason_text"], "likelihood": r["likelihood"],
            "severity": r["severity"], "band": r["band"], "decidedByName": r.get("decided_by_name") or "", "decidedAt": r["decided_at"]}


def comment(r: dict, viewer_id: str | None, hide_name: bool = False) -> dict:
    return {"id": r["id"], "kind": r["kind"], "userName": None if hide_name else r.get("user_name"), "body": r["body"], "createdAt": r["created_at"],
            "mine": bool(viewer_id and r["user_id"] == viewer_id)}


# ---------- actions ----------

ACTION_SELECT = """select a.*, s.code as site_code, s.name_i18n as site_name, coalesce(po.full_name, uo.employee_code, uo.email) as owner_name,
                          coalesce(pc.full_name, uc.employee_code) as completed_by_name, coalesce(pv.full_name, uv.employee_code) as verifier_name,
                          (select case_no from observations o where a.source_type = 'observation' and o.id = a.source_id) as obs_case_no,
                          (select r.case_no from inspection_answers ia join inspection_runs r on r.id = ia.run_id where a.source_type = 'inspection_answer' and ia.id = a.source_id limit 1) as run_case_no,
                          (select type from action_requests q where q.action_id = a.id and q.status = 'pending' order by created_at desc limit 1) as pending_request
                     from actions a join sites s on s.id = a.site_id join users uo on uo.id = a.owner_user_id left join people po on po.id = uo.person_id
                     left join users uc on uc.id = a.completed_by left join people pc on pc.id = uc.person_id
                     left join users uv on uv.id = a.verifier_user_id left join people pv on pv.id = uv.person_id"""

OPEN_ACTION_STATUSES = ("open", "in_progress", "reopened", "disputed")


def action_summary(r: dict, thumb: str | None = None) -> dict:
    overdue = r["status"] in OPEN_ACTION_STATUSES and r["due_at"] < now_utc()
    return {
        "id": r["id"], "clientUuid": r["client_uuid"], "caseNo": r["case_no"], "siteId": r["site_id"], "areaId": r["area_id"], "sourceType": r["source_type"],
        "sourceId": r["source_id"], "sourceCaseNo": r.get("obs_case_no") or r.get("run_case_no"), "title": r["title"], "band": r["band"], "status": r["status"],
        "ownerUserId": r["owner_user_id"], "ownerName": r.get("owner_name") or "", "responsibleEmployerId": r["responsible_employer_id"], "dueAt": r["due_at"],
        "originalDueAt": r["original_due_at"], "overdue": overdue, "completedAt": r["completed_at"], "verifiedAt": r["verified_at"], "reopenCount": r["reopen_count"],
        "pendingRequest": r.get("pending_request"), "thumbUrl": thumb, "version": r["version"], "updatedAt": r["updated_at"],
    }


def action_event(r: dict, media_items: list[dict]) -> dict:
    return {"id": r["id"], "eventType": r["event_type"], "fromStatus": r["from_status"], "toStatus": r["to_status"], "body": r["body"], "payload": r["payload"] or {},
            "actorName": r.get("actor_name"), "at": r["received_at"], "media": media_items}


def action_request(r: dict) -> dict:
    return {"id": r["id"], "type": r["type"], "requestedByName": r.get("requested_by_name") or "", "proposedDueAt": r["proposed_due_at"], "reasonCode": r["reason_code"],
            "reason": r["reason"], "status": r["status"], "decidedByName": r.get("decided_by_name"), "decidedAt": r["decided_at"], "decisionNote": r["decision_note"],
            "createdAt": r["created_at"]}


# ---------- inspection runs ----------

RUN_SELECT = """select r.*, t.code as template_code, t.name_i18n as template_name, t.id as template_id, v.version as template_version_no,
                       coalesce(pi.full_name, ui.employee_code) as inspector_name,
                       (select count(*) from inspection_answers ia where ia.run_id = r.id and ia.flag)::int as failed_count,
                       (select count(*) from inspection_answers ia where ia.run_id = r.id and ia.action_id is not null)::int as actions_raised
                  from inspection_runs r join inspection_template_versions v on v.id = r.template_version_id join inspection_templates t on t.id = v.template_id
                  left join users ui on ui.id = r.inspector_user_id left join people pi on pi.id = ui.person_id"""


def run_summary(r: dict) -> dict:
    return {
        "id": r["id"], "clientUuid": r["client_uuid"], "caseNo": r["case_no"], "templateVersionId": r["template_version_id"], "templateCode": r["template_code"],
        "templateName": r["template_name"], "siteId": r["site_id"], "areaId": r["area_id"], "assetId": r["asset_id"], "scheduleId": r["schedule_id"], "trigger": r["trigger"],
        "dueAt": r["due_at"], "startedAt": r["started_at"], "completedAt": r["completed_at"], "status": r["status"], "inspectorUserId": r["inspector_user_id"],
        "inspectorName": r.get("inspector_name"), "scorePct": _num(r["score_pct"]), "result": r["result"], "tagStatus": r["tag_status"],
        "failedCount": r.get("failed_count", 0), "actionsRaised": r.get("actions_raised", 0), "version": r["version"], "updatedAt": r["updated_at"],
    }


def answer(r: dict, media_items: list[dict]) -> dict:
    return {"id": r["id"], "clientUuid": r["client_uuid"], "questionId": r["question_id"], "repeatIndex": r["repeat_index"], "value": r["value"], "note": r["note"],
            "likelihood": r["likelihood"], "severity": r["severity"], "media": media_items, "action": None, "actionId": r["action_id"], "answeredAt": r["answered_at"],
            "lat": r["lat"], "lng": r["lng"], "flag": r["flag"], "score": _num(r["score"]), "repeatFinding": r["repeat_finding"]}


# ---------- admin ----------

def user_admin(r: dict, roles: list[dict], devices: list[dict]) -> dict:
    return {
        "id": r["id"], "name": r["name"], "personId": r["person_id"], "employeeCode": r["employee_code"], "email": r["email"], "loginType": r["login_type"],
        "status": r["status"], "language": r["language"], "mfaEnabled": r["mfa_enabled"], "mustChangePassword": r["must_change_password"], "lockedUntil": r["locked_until"],
        "failedAttempts": r["failed_attempts"], "expiresAt": r["expires_at"], "lastLoginAt": r["last_login_at"], "roles": roles, "employerId": r.get("employer_id"),
        "employerName": r.get("employer_name"),
        "devices": [{"id": d["id"], "platform": d["platform"], "appVersion": d["app_version"], "lastSeenAt": d["last_seen_at"], "revokedAt": d["revoked_at"]} for d in devices],
        "createdAt": r["created_at"],
    }


def audit_row(r: dict) -> dict:
    return {"id": r["id"], "at": r["at"], "actorName": r.get("actor_name"), "actorRole": r["actor_role"], "siteCode": r.get("site_code"), "action": r["action"],
            "recordType": r["record_type"], "recordId": r["record_id"], "changes": r["changes"] or {}, "reason": r["reason"], "hash": r["hash"]}


def paged(items: list, total: int, page: int, page_size: int) -> dict:
    return {"items": items, "total": total, "page": page, "pageSize": page_size}
