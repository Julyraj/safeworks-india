"""Triage, actions, verification, requests, duplicates, inspections (brief §17.2 tests 6–10, 12, 14–16, 18)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from conftest import PHOTO, now_iso, run, run_job


def test_critical_at_triage_needs_interim_and_alerts(ctx):
    """Test 7: 4 × 4 = 16 (extreme) requires an interim control and sends the stop-work alert."""
    obs = ctx.create_obs("W1")
    body = {"clientUuid": str(uuid.uuid4()), "decision": "accept_assign", "categoryCodes": ["HEIGHT"], "likelihood": 4, "severity": 4, "is3786Code": "B-2", "employerInvolvedId": ctx.ids["own"],
            "capturedAt": now_iso(), "actions": [{"clientUuid": str(uuid.uuid4()), "title": "Stop work and fit rails", "actionType": "correction", "controlLevel": "engineering", "ownerUserId": ctx.ids["own1"]}]}
    r = ctx.post("SO1", f"/api/v1/observations/{obs['id']}/triage", body)
    assert r.status_code == 400 and r.json()["code"] == "bad_request" and "interim" in r.json()["error"].lower()
    body["interimControl"] = "Area barricaded, work stopped"
    body["clientUuid"] = str(uuid.uuid4())
    r = ctx.post("SO1", f"/api/v1/observations/{obs['id']}/triage", body)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["riskBand"] == "extreme" and d["riskScore"] == 16 and d["status"] == "action_assigned" and d["riskMatrixVersionId"]
    assert d["actions"][0]["band"] == "extreme"
    due = datetime.fromisoformat(d["actions"][0]["dueAt"].replace("Z", "+00:00"))
    assert timedelta(hours=71) < due - datetime.now(timezone.utc) < timedelta(hours=73)
    # stop-work alert to site head and HSE manager, critical, needs acknowledgement
    for who in ("SH1", "HSE"):
        n = ctx.get(who, "/api/v1/me/notifications").json()["items"]
        hit = [x for x in n if x["recordId"] == obs["id"] and x["critical"]]
        assert hit, who
    email = run(lambda c: c.fetchval("select count(*) from notifications where record_id = $1 and channel = 'email' and critical", uuid.UUID(obs["id"])))
    assert email >= 1
    # acknowledge
    r = ctx.post("SH1", f"/api/v1/observations/{obs['id']}/ack-critical")
    assert r.status_code == 200 and r.json()["criticalAckedAt"]


def test_danger_now_alert_and_escalation(ctx):
    """Test 6: danger-now alerts the site head and officer at once; no acknowledgement in 30 min → escalation."""
    obs = ctx.create_obs("W1", imminentDanger=True, description="Crane boom over the gate; stop work")
    n = ctx.get("SH1", "/api/v1/me/notifications").json()["items"]
    assert any(x["recordId"] == obs["id"] and x["critical"] and x["eventType"] == "critical" for x in n)
    n = ctx.get("SO1", "/api/v1/me/notifications").json()["items"]
    assert any(x["recordId"] == obs["id"] and x["critical"] for x in n)
    run(lambda c: c.execute("update observations set received_at = now() - interval '31 minutes' where id = $1", uuid.UUID(obs["id"])))
    from safeworks.jobs import critical_ack_watcher
    run_job(ctx, critical_ack_watcher)
    assert run(lambda c: c.fetchval("select count(*) from escalations where record_id = $1 and reason = 'critical_unacknowledged'", uuid.UUID(obs["id"]))) == 1
    n = ctx.get("HSE", "/api/v1/me/notifications").json()["items"]
    assert any(x["recordId"] == obs["id"] and x["eventType"] == "critical_repeat" for x in n)
    # acknowledging through the notification resolves the escalation
    nid = [x for x in ctx.get("SH1", "/api/v1/me/notifications").json()["items"] if x["recordId"] == obs["id"] and x["critical"]][0]["id"]
    assert ctx.post("SH1", f"/api/v1/me/notifications/{nid}/ack").status_code == 200
    assert run(lambda c: c.fetchval("select resolved_at is not null from escalations where record_id = $1", uuid.UUID(obs["id"])))


def test_after_photo_required(ctx):
    """Test 8: completion without note, cause and an after-photo is rejected."""
    obs = ctx.create_obs("W1")
    d = ctx.triage_assign(obs["id"])
    aid = d["actions"][0]["id"]
    assert ctx.post("OWN1", f"/api/v1/actions/{aid}/start").status_code == 200
    r = ctx.complete(aid, photos=0)
    assert r.status_code == 400 and "photo" in r.json()["error"].lower()
    r = ctx.complete(aid, completionNote="")
    assert r.status_code == 400
    r = ctx.complete(aid, causeAddressed="")
    assert r.status_code == 400
    r = ctx.complete(aid)
    assert r.status_code == 200 and r.json()["status"] == "completed" and r.json()["can"]["verify"] is False
    assert ctx.get("OWN1", f"/api/v1/actions/{aid}").json()["thumbUrl"]
    ctx.ids["completedAction"] = aid
    ctx.ids["completedObs"] = obs["id"]


def test_verifier_separation_and_close_loop(ctx):
    """Test 9: owner and completer get 403; another verifier succeeds; the observation closes when the last action is verified."""
    aid, oid = ctx.ids["completedAction"], ctx.ids["completedObs"]
    assert ctx.verify(aid, "OWN1").status_code == 403
    assert ctx.verify(aid, "W1").status_code in (403, 404)
    r = ctx.verify(aid, "VER1")
    assert r.status_code == 200 and r.json()["status"] == "verified" and r.json()["verifierName"] == "Verifier One"
    o = ctx.get("SO1", f"/api/v1/observations/{oid}").json()
    assert o["status"] == "closed" and "Mid-rail fitted" in o["closureSummary"]
    # officer edits the summary before the notice goes; the closure job then tells the reporter
    r = ctx.put("SO1", f"/api/v1/observations/{oid}/closure-summary", {"closureSummary": "Rail fitted and inspected."})
    assert r.status_code == 200 and r.json()["closureSummary"] == "Rail fitted and inspected."
    run(lambda c: c.execute("update observations set closed_at = now() - interval '31 minutes' where id = $1", uuid.UUID(oid)))
    from safeworks.jobs import closure_notices
    run_job(ctx, closure_notices)
    n = ctx.get("W1", "/api/v1/me/notifications").json()["items"]
    assert any(x["recordId"] == oid and x["eventType"] == "observation_closed" and "Rail fitted" in x["body"] for x in n)
    # the officer may verify too (officer+), but the completer never
    assert ctx.verify(aid, "VER1").status_code == 409  # already verified


def test_not_effective_reopens(ctx):
    """Test 10: not effective reopens to the same owner with a new due date; reopen_count rises."""
    obs = ctx.create_obs("W1")
    d = ctx.triage_assign(obs["id"])
    a = d["actions"][0]
    old_due = a["dueAt"]
    run(lambda c: c.execute("update actions set due_at = now() - interval '2 days' where id = $1", uuid.UUID(a["id"])))
    assert ctx.complete(a["id"]).status_code == 200
    r = ctx.verify(a["id"], "VER1", "not_effective", "")
    assert r.status_code == 400  # reason required
    r = ctx.verify(a["id"], "VER1", "not_effective", "Only one side done")
    assert r.status_code == 200
    x = r.json()
    assert x["status"] == "reopened" and x["ownerUserId"] == ctx.ids["own1"] and x["reopenCount"] == 1
    assert x["dueAt"] > now_iso() and x["originalDueAt"] == a["originalDueAt"] and x["dueAt"] != old_due
    assert ctx.post("OWN1", f"/api/v1/actions/{a['id']}/start").status_code == 200
    assert ctx.complete(a["id"]).status_code == 200
    assert ctx.verify(a["id"], "SO2").status_code == 200  # an officer who is neither owner nor completer


def test_date_change_and_dispute(ctx):
    """Test 12: an approved date change moves dueAt not originalDueAt; a dispute pauses the ladder and its rejection returns the action to open."""
    obs = ctx.create_obs("W1")
    d = ctx.triage_assign(obs["id"])
    a = d["actions"][0]
    proposed = (datetime.now(timezone.utc) + timedelta(days=45)).isoformat()
    r = ctx.post("OWN1", f"/api/v1/actions/{a['id']}/requests", {"clientUuid": str(uuid.uuid4()), "type": "date_change", "proposedDueAt": proposed, "reasonCode": "material", "reason": "Rails arrive next week", "capturedAt": now_iso()})
    assert r.status_code == 200 and r.json()["pendingRequest"] == "date_change"
    rid = r.json()["requests"][0]["id"]
    assert ctx.post("OWN1", f"/api/v1/actions/{a['id']}/requests/{rid}/decide", {"decision": "approved"}).status_code in (403, 404)
    r = ctx.post("SO1", f"/api/v1/actions/{a['id']}/requests/{rid}/decide", {"decision": "approved", "note": "ok"})
    assert r.status_code == 200
    x = r.json()
    assert x["dueAt"][:16] == proposed[:16] and x["originalDueAt"] == a["originalDueAt"] and x["pendingRequest"] is None
    # dispute
    r = ctx.post("OWN1", f"/api/v1/actions/{a['id']}/requests", {"clientUuid": str(uuid.uuid4()), "type": "dispute", "reasonCode": "not_our_scope", "reason": "Scaffold belongs to contractor B", "capturedAt": now_iso()})
    assert r.status_code == 200 and r.json()["status"] == "disputed"
    paused = run(lambda c: c.fetchval("select ladder_paused_until > now() from actions where id = $1", uuid.UUID(a["id"])))
    assert paused
    rid = [q for q in r.json()["requests"] if q["type"] == "dispute"][0]["id"]
    r = ctx.post("SO1", f"/api/v1/actions/{a['id']}/requests/{rid}/decide", {"decision": "rejected", "note": "It is in your scope"})
    assert r.status_code == 200 and r.json()["status"] == "open"
    # 3rd date change needs the site head
    for i in range(2):
        r = ctx.post("OWN1", f"/api/v1/actions/{a['id']}/requests", {"clientUuid": str(uuid.uuid4()), "type": "date_change", "proposedDueAt": proposed, "reasonCode": "m", "reason": "again", "capturedAt": now_iso()})
        assert r.status_code == 200
        rid = [q for q in r.json()["requests"] if q["status"] == "pending"][0]["id"]
        if i == 0:
            assert ctx.post("SO1", f"/api/v1/actions/{a['id']}/requests/{rid}/decide", {"decision": "rejected"}).status_code == 200
    assert ctx.post("SO1", f"/api/v1/actions/{a['id']}/requests/{rid}/decide", {"decision": "rejected"}).status_code == 403
    assert ctx.post("SH1", f"/api/v1/actions/{a['id']}/requests/{rid}/decide", {"decision": "rejected"}).status_code == 200
    # cancel needs site head approval; reassign
    r = ctx.post("SO1", f"/api/v1/actions/{a['id']}/cancel", {"reason": "duplicate", "approvedByUserId": ctx.ids["so2"]})
    assert r.status_code == 400
    r = ctx.post("SO1", f"/api/v1/actions/{a['id']}/reassign", {"newOwnerUserId": ctx.ids["own2"], "reason": "load balancing"})
    assert r.status_code == 200 and r.json()["ownerUserId"] == ctx.ids["own2"]
    r = ctx.post("SO1", f"/api/v1/actions/{a['id']}/cancel", {"reason": "duplicate of another action", "approvedByUserId": ctx.ids["sh1"]})
    assert r.status_code == 200 and r.json()["status"] == "cancelled"


def test_duplicates_and_merge(ctx):
    """Test 18: a second report in the same area and category within 24 h shows the first; after a merge both reporters are told when the master closes."""
    first = ctx.create_obs("W1", categoryCodes=["ELEC"], description="Exposed cable near batching plant", areaId=ctx.ids["areaA2"], area="areaA2")
    second = ctx.create_obs("W2", categoryCodes=["ELEC", "HOUSE"], description="Cable with bare copper at batching plant", areaId=ctx.ids["areaA2"], area="areaA2")
    r = ctx.get("SO1", f"/api/v1/observations/{second['id']}/duplicates")
    assert r.status_code == 200
    assert any(s["id"] == first["id"] and "category_overlap" in s["reasons"] for s in r.json())
    assert ctx.get("W1", f"/api/v1/observations/{second['id']}/duplicates").status_code in (403, 404)
    r = ctx.post("SO1", f"/api/v1/observations/{second['id']}/triage", {"clientUuid": str(uuid.uuid4()), "decision": "merge_duplicate", "masterObservationId": first["id"], "capturedAt": now_iso()})
    assert r.status_code == 200 and r.json()["status"] == "merged" and r.json()["masterCaseNo"] == first["caseNo"]
    d = ctx.triage_assign(first["id"])
    aid = d["actions"][0]["id"]
    assert ctx.complete(aid).status_code == 200
    assert ctx.verify(aid, "VER1").status_code == 200
    run(lambda c: c.execute("update observations set closed_at = now() - interval '31 minutes' where id = $1", uuid.UUID(first["id"])))
    from safeworks.jobs import closure_notices
    run_job(ctx, closure_notices)
    for who in ("W1", "W2"):
        n = ctx.get(who, "/api/v1/me/notifications").json()["items"]
        assert any(x["recordId"] == first["id"] and x["eventType"] == "observation_closed" for x in n), who


def test_return_and_reply(ctx):
    obs = ctx.create_obs("W1")
    r = ctx.post("SO1", f"/api/v1/observations/{obs['id']}/triage", {"clientUuid": str(uuid.uuid4()), "decision": "return_to_reporter", "question": "Which bay?", "capturedAt": now_iso()})
    assert r.status_code == 200 and r.json()["status"] == "returned"
    assert ctx.get("W1", f"/api/v1/observations/{obs['id']}").json()["can"]["reply"] is True
    r = ctx.post("W1", f"/api/v1/observations/{obs['id']}/reply", {"clientUuid": str(uuid.uuid4()), "body": "Bay 3, west side", "media": []})
    assert r.status_code == 200 and r.json()["status"] == "submitted"
    r = ctx.post("SO1", f"/api/v1/observations/{obs['id']}/triage", {"clientUuid": str(uuid.uuid4()), "decision": "reviewed_no_action", "reasonCode": "controlled", "reasonText": "Already fixed", "capturedAt": now_iso()})
    assert r.status_code == 200 and r.json()["status"] == "closed"
    r = ctx.post("SO1", f"/api/v1/observations/{obs['id']}/reopen", {"reason": "Found again on Monday"})
    assert r.status_code == 200 and r.json()["status"] == "action_assigned"
    r = ctx.post("W1", f"/api/v1/observations/{obs['id']}/comments", {"clientUuid": str(uuid.uuid4()), "body": "Thanks"})
    assert r.status_code == 201 and r.json()["mine"] is True


def test_escalate_incident(ctx):
    obs = ctx.create_obs("W1", type="near_miss")
    r = ctx.post("SO1", f"/api/v1/observations/{obs['id']}/triage", {"clientUuid": str(uuid.uuid4()), "decision": "escalate_incident", "learnedAt": now_iso(), "capturedAt": now_iso()})
    assert r.status_code == 200 and r.json()["status"] == "escalated" and r.json()["escalatedIncidentId"] and r.json()["learnedAt"]
    inc = run(lambda c: c.fetchrow("select case_no, status from incidents where observation_id = $1", uuid.UUID(obs["id"])))
    assert inc["case_no"] == obs["caseNo"] and inc["status"] == "escalated"


# ---------------------------------------------------------------- inspections

def _answers(questions, fail_codes=(), na_codes=(), with_action=True):
    out = []
    for q in questions:
        v = "fail" if q["code"] in fail_codes else ("na" if q["code"] in na_codes else "pass")
        a = {"clientUuid": str(uuid.uuid4()), "questionId": q["id"], "repeatIndex": 0, "value": v, "answeredAt": now_iso(), "note": "bay 3" if v == "fail" else ""}
        if v == "fail":
            a["media"] = [ {"clientUuid": str(uuid.uuid4()), "kind": "photo", "purpose": "evidence", "sha256": __import__("hashlib").sha256(PHOTO).hexdigest(), "bytes": len(PHOTO), "mime": "image/jpeg", "capturedAt": now_iso()} ]
            if with_action:
                a["action"] = {"clientUuid": str(uuid.uuid4()), "title": f"Fix {q['code']}", "actionType": "corrective", "controlLevel": "engineering", "ownerUserId": None, "band": "high", "interimControl": "Access closed"}
        out.append(a)
    return out


def test_inspection_blocks_any_fail_and_report(ctx):
    """Tests 14 and 15: a failed action-on-fail answer blocks submit; after submit answers lock and the report shows each photo beside its item; 95 % with one Fail is Fail."""
    tv = [t for t in ctx.get("SO1", f"/api/v1/inspections/templates?siteId={ctx.ids['siteA']}").json() if t["code"] == "T1"][0]
    questions = tv["sections"][0]["questions"]
    r = ctx.post("SO1", "/api/v1/inspections/runs", {"clientUuid": str(uuid.uuid4()), "templateVersionId": tv["id"], "siteId": ctx.ids["siteA"], "areaId": ctx.ids["areaA1"], "trigger": "spot",
                                                      "header": {"document_no": "DOC-1"}, "startedAt": now_iso(), "lat": 13.0, "lng": 80.2})
    assert r.status_code == 201, r.text
    run_ = r.json()
    assert run_["status"] == "in_progress" and run_["caseNo"].startswith("TN1-INS-")
    ans = _answers(questions, fail_codes=("T1-2",), with_action=False)
    r = ctx.put("SO1", f"/api/v1/inspections/runs/{run_['id']}/answers", {"answers": ans})
    assert r.status_code == 200 and len(r.json()["answers"]) == len(questions)
    for a in r.json()["answers"]:
        for m in a["media"]:
            assert ctx.upload("SO1", f"/api/v1/media/{m['clientUuid']}", PHOTO).status_code == 200
    submit = {"clientUuid": str(uuid.uuid4()), "answers": [], "signature": None, "completedAt": now_iso()}
    r = ctx.post("SO1", f"/api/v1/inspections/runs/{run_['id']}/submit", submit)
    assert r.status_code == 400 and "action" in r.json()["error"].lower()
    # missing required answer also blocks
    fail_answer = [a for a in ans if a["value"] == "fail"][0]
    fail_answer["action"] = {"clientUuid": str(uuid.uuid4()), "title": "Guard the open edge", "actionType": "corrective", "controlLevel": "engineering", "ownerUserId": ctx.ids["own1"], "band": "high", "interimControl": "Barricade"}
    fail_answer["clientUuid"] = str(uuid.uuid4())
    fail_answer["media"] = []
    fail_answer["answeredAt"] = now_iso()
    r = ctx.post("SO1", f"/api/v1/inspections/runs/{run_['id']}/submit", {**submit, "clientUuid": str(uuid.uuid4()), "answers": [fail_answer]})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "completed" and d["result"] == "fail" and d["scorePct"] >= 85 and d["failedCount"] == 1 and d["actionsRaised"] == 1
    assert d["reportUrl"]
    # answers are locked: late answers become an addendum, values unchanged
    r = ctx.put("SO1", f"/api/v1/inspections/runs/{run_['id']}/answers", {"answers": _answers(questions)})
    assert r.status_code == 200 and r.json()["failedCount"] == 1
    rep = ctx.get("SO1", f"/api/v1/inspections/runs/{run_['id']}/report")
    assert rep.status_code == 200 and rep.headers["content-type"].startswith("text/html")
    html = rep.text
    assert "T1-2" in html and "<img src='/files/" in html and html.index("T1-2") < html.index("<img src='/files/") and "FAIL" in html
    assert ctx.get("SOB", f"/api/v1/inspections/runs/{run_['id']}/report").status_code == 404
    # the raised action verified → run closes
    aid = [a for a in d["answers"] if a["actionId"]][0]["actionId"]
    assert ctx.complete(aid).status_code == 200
    assert ctx.verify(aid, "VER1").status_code == 200
    assert ctx.get("SO1", f"/api/v1/inspections/runs/{run_['id']}").json()["status"] == "closed"
    # reopen by HSE marks the report superseded
    r = ctx.post("HSE", f"/api/v1/inspections/runs/{run_['id']}/reopen", {"reason": "Photo missing"})
    assert r.status_code == 200 and r.json()["status"] == "reopened"
    assert ctx.post("SO1", f"/api/v1/inspections/runs/{run_['id']}/reopen", {"reason": "x"}).status_code == 403


def test_template_versions(ctx):
    """Test 16: editing an active template creates version n+1; a run in progress finishes on n; authors cannot approve their own version."""
    tid = ctx.ids["t1Template"]
    r = ctx.post("SO1", "/api/v1/inspections/runs", {"clientUuid": str(uuid.uuid4()), "templateVersionId": ctx.ids["t1Version"], "siteId": ctx.ids["siteA"], "areaId": ctx.ids["areaA2"], "header": {}, "startedAt": now_iso()})
    assert r.status_code == 201
    run_ = r.json()
    r = ctx.post("HSE-admin", f"/api/v1/admin/inspections/templates/{tid}/versions", {"changeNote": "Add noise item"})
    assert r.status_code == 201, r.text
    v2 = r.json()
    assert v2["version"] == 2 and v2["status"] == "draft" and len(v2["sections"][0]["questions"]) == 9
    doc = {"sections": [{**v2["sections"][0], "questions": v2["sections"][0]["questions"] + [{"code": "T1-10", "text": {"en": "Hearing protection where noise exceeds 90 dB(A)"}, "referenceText": "FA s.87 (C)", "referenceStatus": "reference_to_confirm"}]}]}
    r = ctx.put("HSE-admin", f"/api/v1/admin/inspections/template-versions/{v2['id']}", doc)
    assert r.status_code == 200, r.text
    assert len(r.json()["sections"][0]["questions"]) == 10
    assert ctx.post("HSE-admin", f"/api/v1/admin/inspections/template-versions/{v2['id']}/submit").status_code == 200
    assert ctx.post("HSE-admin", f"/api/v1/admin/inspections/template-versions/{v2['id']}/approve").status_code == 403
    if "ADMIN" not in ctx.tokens:
        from test_auth_scope import test_mfa_flow
        test_mfa_flow(ctx)
    r = ctx.post("ADMIN", f"/api/v1/admin/inspections/template-versions/{v2['id']}/approve")
    assert r.status_code == 200 and r.json()["status"] == "active"
    t = ctx.get("ADMIN", f"/api/v1/admin/inspections/templates/{tid}").json()
    assert t["activeVersionId"] == v2["id"] and [v["status"] for v in t["versions"]] == ["retired", "active"]
    # the run in progress keeps version 1 and can still be submitted
    questions = ctx.get("SO1", f"/api/v1/inspections/runs/{run_['id']}").json()
    assert questions["templateVersionId"] == ctx.ids["t1Version"]
    qs = run(lambda c: c.fetch("select q.id, q.code from inspection_questions q join inspection_sections s on s.id = q.section_id where s.version_id = $1", uuid.UUID(ctx.ids["t1Version"])))
    r = ctx.post("SO1", f"/api/v1/inspections/runs/{run_['id']}/submit", {"clientUuid": str(uuid.uuid4()), "answers": _answers([{"id": str(q["id"]), "code": q["code"]} for q in qs], na_codes=("T1-5",)), "signature": None, "completedAt": now_iso()})
    assert r.status_code == 200 and r.json()["result"] == "pass" and r.json()["scorePct"] == 100.0 and r.json()["templateVersionId"] == ctx.ids["t1Version"]
    # pull now carries v2 as the active version
    pull = ctx.get("SO1", "/api/v1/sync/pull").json()
    assert any(t["id"] == v2["id"] for t in pull["templates"])


def test_repeat_finding_and_schedule(ctx):
    tv = [t for t in ctx.get("SO1", f"/api/v1/inspections/templates?siteId={ctx.ids['siteA']}").json() if t["code"] == "T7"][0]
    qs = tv["sections"][0]["questions"]
    for i in range(2):
        r = ctx.post("SO1", "/api/v1/inspections/runs", {"clientUuid": str(uuid.uuid4()), "templateVersionId": tv["id"], "siteId": ctx.ids["siteA"], "areaId": ctx.ids["areaA2"], "header": {}, "startedAt": now_iso()})
        rid = r.json()["id"]
        ans = _answers(qs, fail_codes=("T7-1",), with_action=False)
        fa = [a for a in ans if a["value"] == "fail"][0]
        fa["media"] = []
        fa["action"] = {"clientUuid": str(uuid.uuid4()), "title": "Clear aisle", "actionType": "corrective", "controlLevel": "administrative", "ownerUserId": ctx.ids["own2"]}
        r = ctx.post("SO1", f"/api/v1/inspections/runs/{rid}/submit", {"clientUuid": str(uuid.uuid4()), "answers": ans, "signature": None, "completedAt": now_iso()})
        assert r.status_code == 200, r.text
        rep = [a for a in r.json()["answers"] if a["flag"]][0]["repeatFinding"]
        assert rep is (i == 1)
    # schedule → scheduled run → start by schedule id
    r = ctx.post("SO1-admin", "/api/v1/admin/inspections/schedules", {"templateId": tv["templateId"], "siteId": ctx.ids["siteA"], "areaId": ctx.ids["areaA1"], "frequency": {"every": 1, "unit": "day", "time": "23:59"},
                                                                        "assigneeUserId": ctx.ids["so1"], "leadDays": 2, "graceHours": 24})
    assert r.status_code == 201, r.text
    sched = r.json()
    runs = ctx.get("SO1", f"/api/v1/inspections/runs?siteId={ctx.ids['siteA']}&status=scheduled").json()["items"]
    mine = [x for x in runs if x["scheduleId"] == sched["id"]]
    assert mine and mine[0]["trigger"] == "scheduled"
    r = ctx.post("SO1", "/api/v1/inspections/runs", {"clientUuid": str(uuid.uuid4()), "templateVersionId": tv["id"], "siteId": ctx.ids["siteA"], "scheduleId": sched["id"], "header": {}, "startedAt": now_iso()})
    assert r.status_code == 201 and r.json()["id"] == mine[0]["id"] and r.json()["status"] == "in_progress"
    assert ctx.get("SO1-admin", f"/api/v1/inspections/runs?siteId={ctx.ids['siteA']}").status_code == 200
    assert ctx.get("SO1-admin", f"/api/v1/dashboard?siteIds={ctx.ids['siteA']}").json()["kpis"]
