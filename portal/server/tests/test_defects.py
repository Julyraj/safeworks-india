"""Regression tests for the defects F1–F9 found while writing portal/docs/TEST-PLAN.md."""
import uuid
from datetime import datetime, timedelta, timezone

from conftest import run


def test_f1_future_capture_time_is_not_trusted(ctx):  # EHS-OBS-020
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    o = ctx.create_obs("W1", capturedAt=future)
    row = run(lambda c: c.fetchrow("select captured_at, received_at from observations where id = $1", uuid.UUID(o["id"])))
    assert row["captured_at"] == row["received_at"]
    extra = run(lambda c: c.fetchval("select body from comments where owner_id = $1 and kind = 'system' and body like 'extra:%'", uuid.UUID(o["id"])))
    assert extra and "capturedAtClaimed" in extra
    # a small drift (2 minutes ahead) is kept as sent
    near = (datetime.now(timezone.utc) + timedelta(minutes=2)).replace(microsecond=0)
    o2 = ctx.create_obs("W1", capturedAt=near.isoformat())
    assert run(lambda c: c.fetchval("select captured_at from observations where id = $1", uuid.UUID(o2["id"]))) == near
    # a time without an offset is read as India time and does not crash
    o3 = ctx.create_obs("W1", capturedAt=datetime.now().strftime("%Y-%m-%dT%H:%M:%S"))
    assert o3["caseNo"]


def test_f2_category_required_on_server(ctx):  # EHS-OBS-016
    r = ctx.post("W1", "/api/v1/observations", ctx.obs_payload(categoryCodes=[]))
    assert r.status_code == 400 and r.json()["code"] == "bad_request"


def test_f2_category_required_on_qr_form(ctx):
    run(lambda c: c.execute("delete from public_rate_counters"))  # other tests use the QR form from the same address
    body = {"clientUuid": str(uuid.uuid4()), "type": "unsafe_condition", "categoryCodes": [], "description": "Loose cable", "capturedAt": datetime.now(timezone.utc).isoformat(), "media": []}
    r = ctx.client.post(f"/api/v1/public/qr/{ctx.ids['qrTokenA1']}/observations", json=body)
    assert r.status_code == 400


def test_f3_fixed_on_spot_needs_what_was_done(ctx):  # EHS-OBS-030
    r = ctx.post("W1", "/api/v1/observations", ctx.obs_payload(fixedOnSpot=True, immediateAction=""))
    assert r.status_code == 400
    r = ctx.post("W1", "/api/v1/observations", ctx.obs_payload(fixedOnSpot=True, immediateAction="   "))
    assert r.status_code == 400
    assert ctx.post("W1", "/api/v1/observations", ctx.obs_payload(fixedOnSpot=True, immediateAction="Barricaded the edge")).status_code in (200, 201)


def test_f4_verifier_cannot_export(ctx):  # EHS-DSH-033, EHS-RPT-012
    for path in ("observations.csv", "observations.xlsx", "actions.csv", "actions.xlsx", "inspections.csv", "inspections.xlsx", "report.xlsx"):
        assert ctx.get("VER1", f"/api/v1/exports/{path}").status_code == 403, path
    assert ctx.get("SH1", f"/api/v1/exports/report.xlsx?siteId={ctx.ids['siteA']}").status_code == 200
    # an officer cannot widen an export to a site where they are not an officer
    assert ctx.get("SH1", f"/api/v1/exports/observations.csv?siteId={ctx.ids['siteB']}").status_code == 404


def test_f4_export_limited_to_officer_sites(ctx):
    # SO1 is an officer at site A; give SO1 a verifier role at site B: B may be read but not exported
    run(lambda c: c.execute("insert into user_site_roles (user_id, site_id, role) values ($1, $2, 'verifier') on conflict do nothing", uuid.UUID(ctx.ids["so1"]), uuid.UUID(ctx.ids["siteB"])))
    try:
        r = ctx.login("SO1")
        ctx.tokens["SO1"] = r.json()["token"]
        ctx.create_obs("SOB", site="siteB", area="areaB1", description="Site B only report XYZB")
        csv = ctx.get("SO1", "/api/v1/exports/observations.csv").text
        assert "XYZB" not in csv
        assert ctx.get("SO1", f"/api/v1/exports/observations.csv?siteId={ctx.ids['siteB']}").status_code == 404
    finally:
        run(lambda c: c.execute("delete from user_site_roles where user_id = $1 and site_id = $2 and role = 'verifier'", uuid.UUID(ctx.ids["so1"]), uuid.UUID(ctx.ids["siteB"])))
        ctx.tokens["SO1"] = ctx.login("SO1").json()["token"]


def test_f7_dashboard_dates_wrong_way_round(ctx):  # EHS-DSH-009
    a = ctx.get("SO1", "/api/v1/dashboard?from=2026-01-01&to=2026-12-31").json()
    b = ctx.get("SO1", "/api/v1/dashboard?from=2026-12-31&to=2026-01-01").json()
    assert b["from"] < b["to"]
    assert [k["value"] for k in a["kpis"]] == [k["value"] for k in b["kpis"]]
    assert ctx.get("SO1", "/api/v1/dashboard?from=2099-01-01").status_code == 200  # a future "from" alone does not crash


def test_f8_only_officers_acknowledge_danger(ctx):  # EHS-OBS-210
    o = ctx.create_obs("W1", imminentDanger=True)
    assert ctx.post("W1", f"/api/v1/observations/{o['id']}/ack-critical", {}).status_code == 403
    assert ctx.post("VER1", f"/api/v1/observations/{o['id']}/ack-critical", {}).status_code in (403, 404)
    assert ctx.post("SO1", f"/api/v1/observations/{o['id']}/ack-critical", {}).status_code == 200


def test_f9_csv_formula_guard(ctx):  # EHS-RPT-024
    ctx.create_obs("W1", description='=HYPERLINK("http://x","click")')
    text = ctx.get("SH1", f"/api/v1/exports/observations.csv?siteId={ctx.ids['siteA']}").text
    assert "'=HYPERLINK" in text
    assert ',=HYPERLINK' not in text and '"=HYPERLINK' not in text
    from safeworks.http import csv_safe
    assert csv_safe("+91 98765") == "'+91 98765" and csv_safe("-1") == "'-1" and csv_safe("@x") == "'@x"
    assert csv_safe(-1) == -1 and csv_safe("Normal text") == "Normal text"


def test_f10_auditor_is_read_only_in_the_field_api(ctx):  # EHS-OBS-055
    r = ctx.login("AUD")
    ctx.tokens["AUD"] = r.json()["token"]
    assert ctx.post("AUD", "/api/v1/observations", ctx.obs_payload()).status_code == 403
    o = ctx.create_obs("W1")
    assert ctx.post("AUD", f"/api/v1/observations/{o['id']}/comments", {"clientUuid": str(uuid.uuid4()), "body": "x"}).status_code in (403, 404)
    res = ctx.post("AUD", "/api/v1/sync/push", {"deviceId": "dev-AUD", "commands": [{"commandId": str(uuid.uuid4()), "entityType": "observation", "op": "create",
                                                                                     "payload": ctx.obs_payload()}]}).json()["results"]
    assert res[0]["status"] == "rejected"
    assert ctx.get("AUD", "/api/v1/insights?level=site").status_code == 200  # reading still works


def test_f11_site_needs_an_english_name(ctx):  # EHS-ADM-006
    if "ADMIN" not in ctx.tokens:
        from test_auth_scope import test_mfa_flow
        test_mfa_flow(ctx)
    r = ctx.post("ADMIN", "/api/v1/admin/sites", {"code": "KA8", "name": {"en": ""}, "state": "KA", "district": "x", "establishmentType": "other"})
    assert r.status_code == 400
    r = ctx.post("ADMIN", "/api/v1/admin/sites", {"code": "KA8", "name": {"kn": "ಹೆಸರು"}, "state": "KA", "district": "x", "establishmentType": "other"})
    assert r.status_code == 400


def test_f12_email_must_look_like_an_email(ctx):  # EHS-ADM-097
    if "ADMIN" not in ctx.tokens:
        from test_auth_scope import test_mfa_flow
        test_mfa_flow(ctx)
    for bad in ("abc@", "@x.in", "a b@x.in", "abc@x"):
        r = ctx.post("ADMIN", "/api/v1/admin/users", {"name": "x", "email": bad, "loginType": "email", "language": "en", "roles": [{"siteId": ctx.ids["siteA"], "role": "reporter"}]})
        assert r.status_code == 400, bad
    assert ctx.put("ADMIN", f"/api/v1/admin/users/{ctx.ids['w2']}", {"email": "abc@"}).status_code == 400


def _timed_action(ctx, band: str) -> str:
    body = {"clientUuid": str(uuid.uuid4()), "siteId": ctx.ids["siteA"], "title": f"Timed {band}", "problem": "p", "actionType": "corrective", "controlLevel": "engineering",
            "ownerUserId": ctx.ids["own2"], "band": band, "interimControl": "Barricaded", "sourceType": "manual", "capturedAt": datetime.now(timezone.utc).isoformat()}
    r = ctx.post("SO1", "/api/v1/actions", body)
    assert r.status_code in (200, 201), r.text
    aid = r.json()["id"]
    run(lambda c: c.execute("update actions set created_at = now() - interval '10 days', due_at = now() + interval '1 day' - interval '2 minutes' where id = $1", uuid.UUID(aid)))
    return aid


def test_f14_extreme_reminders_are_urgent(ctx):  # EHS-ACT-138
    from safeworks.jobs import ladder_job
    from conftest import run_job
    aid = _timed_action(ctx, "extreme")
    run_job(ctx, ladder_job)
    rows = run(lambda c: c.fetch("select critical, send_after from notifications where record_id = $1 and channel = 'push' and event_type = 'action_due_soon'", aid))
    assert rows and all(r["critical"] and r["send_after"] is None for r in rows)


def test_f15_every_notification_text_exists_in_every_language():
    import json, re
    from pathlib import Path
    root = Path(__file__).resolve().parents[1] / "safeworks"
    keys = set()
    for f in root.rglob("*.py"):
        keys |= set(re.findall(r'key=["\']([a-z_]+)["\']', f.read_text()))
    keys |= {"action_overdue", "action_due_today", "action_due_soon", "digest_daily", "digest_weekly", "critical", "critical_repeat"}
    for lang in ("en", "hi", "ta", "kn"):
        pack = json.loads((root / "i18n" / f"{lang}.json").read_text())
        missing = [f"ntf.{k}.{p}" for k in keys for p in ("title", "body") if f"ntf.{k}.{p}" not in pack and f"ntf.{k}.title" in pack]
        assert not missing, f"{lang}: {missing}"


def test_f16_triage_reminder_opens_the_triage_list(ctx):  # EHS-OBS-184
    from safeworks.jobs import ladder_job
    from conftest import run_job
    o = ctx.create_obs("W1")
    run(lambda c: c.execute("update observations set received_at = now() - interval '6 days' where id = $1", uuid.UUID(o["id"])))
    run(lambda c: c.execute("delete from job_marks where key like 'triage_%'"))
    run_job(ctx, ladder_job)
    links = run(lambda c: c.fetch("select distinct link from notifications where event_type = 'triage_sla' and channel = 'inapp'"))
    assert {r["link"] for r in links} == {"/reports?tab=triage"}


def _admin(ctx):
    if "ADMIN" not in ctx.tokens:
        from test_auth_scope import test_mfa_flow
        test_mfa_flow(ctx)


def test_f17_auditor_needs_an_expiry(ctx):  # EHS-ADM-101
    _admin(ctx)
    base = {"name": "Ext Auditor", "loginType": "employee_code", "language": "en", "roles": [{"siteId": None, "role": "auditor"}]}
    assert ctx.post("ADMIN", "/api/v1/admin/users", {**base, "employeeCode": "EXT-A1"}).status_code == 400
    exp = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    assert ctx.post("ADMIN", "/api/v1/admin/users", {**base, "employeeCode": "EXT-A2", "expiresAt": exp}).status_code == 201
    # making an existing permanent user an auditor needs an expiry first
    assert ctx.post("ADMIN", f"/api/v1/admin/users/{ctx.ids['w2']}/roles", {"roles": [{"siteId": None, "role": "auditor"}]}).status_code == 400
    # an auditor imported by CSV gets 30 days
    r = ctx.post("ADMIN", "/api/v1/admin/users/import", {"csv": "name,employee_code,role,site_code\nCsv Auditor,EXT-A3,auditor,\n"})
    assert r.status_code == 200 and r.json()["created"] == 1, r.text
    days = run(lambda c: c.fetchval("select extract(day from expires_at - now()) from users where employee_code = 'EXT-A3'"))
    assert 29 <= days <= 30


def test_f18_required_category_details(ctx):  # EHS-OBS-037/038
    run(lambda c: c.execute("""update categories set extra_fields = '[{"key": "heightM", "label": {"en": "Height (m)"}, "type": "number", "required": true}]'::jsonb
                               where code = 'HEIGHT'"""))
    try:
        assert ctx.post("W1", "/api/v1/observations", ctx.obs_payload()).status_code == 400
        assert ctx.post("W1", "/api/v1/observations", ctx.obs_payload(extra={"heightM": 6})).status_code in (200, 201)
    finally:
        run(lambda c: c.execute("update categories set extra_fields = '[]'::jsonb where code = 'HEIGHT'"))


def test_f19_contractor_email(ctx):  # EHS-ADM-069
    _admin(ctx)
    assert ctx.post("ADMIN", "/api/v1/admin/contractors", {"name": "Bad Mail Ltd", "email": "abc@"}).status_code == 400
    assert ctx.post("ADMIN", "/api/v1/admin/contractors", {"name": "Good Mail Ltd", "email": "site@goodmail.in"}).status_code == 201


def test_f20_new_due_date_must_be_in_the_future(ctx):  # EHS-ACT-082
    o = ctx.create_obs("W1")
    d = ctx.triage_assign(o["id"])
    aid = d["actions"][0]["id"]
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    r = ctx.post("OWN1", f"/api/v1/actions/{aid}/requests", {"clientUuid": str(uuid.uuid4()), "type": "date_change", "proposedDueAt": past, "reason": "x",
                                                            "capturedAt": datetime.now(timezone.utc).isoformat()})
    assert r.status_code == 400
    naive = (datetime.now() + timedelta(days=5)).strftime("%Y-%m-%dT%H:%M:%S")
    r = ctx.post("OWN1", f"/api/v1/actions/{aid}/requests", {"clientUuid": str(uuid.uuid4()), "type": "date_change", "proposedDueAt": naive, "reason": "x",
                                                            "capturedAt": datetime.now(timezone.utc).isoformat()})
    assert r.status_code in (200, 201), r.text


def test_f21_checklist_answers_must_fit_the_question(ctx):  # EHS-INS-068
    from safeworks.workflow.inspections import _check_value
    from safeworks.errors import HttpError
    import pytest
    num = {"answer_type": "number", "code": "N", "id": "x", "response_set": []}
    pf = {"answer_type": "pass_fail_na", "code": "P", "id": "y", "response_set": [{"value": "pass"}, {"value": "fail", "flag": True}]}
    multi = {"answer_type": "multi_choice", "code": "M", "id": "z", "response_set": [{"value": "a"}, {"value": "b"}]}
    for q, ok in ((num, 12), (num, "12.5"), (pf, "pass"), (pf, "N/A"), (multi, ["a", "b"]), (num, None)):
        _check_value(q, ok)
    for q, bad in ((num, "abc"), (num, True), (pf, "purple"), (pf, ["pass", "fail"]), (multi, ["a", "c"])):
        with pytest.raises(HttpError):
            _check_value(q, bad)


def test_f22_good_practice_never_raises_danger(ctx):  # EHS-OBS-027
    o = ctx.create_obs("W1", type="good_practice", imminentDanger=True)
    row = run(lambda c: c.fetchrow("select imminent_danger from observations where id = $1", uuid.UUID(o["id"])))
    assert row["imminent_danger"] is False
    assert run(lambda c: c.fetchval("select count(*) from notifications where record_id = $1 and critical", o["id"])) == 0


def test_f24_phone_numbers_are_checked(ctx):  # EHS-ADM-061
    _admin(ctx)
    assert ctx.post("ADMIN", "/api/v1/admin/people", {"fullName": "Bad Phone", "phone": "abc"}).status_code == 400
    assert ctx.post("ADMIN", "/api/v1/admin/people", {"fullName": "Good Phone", "phone": "+91 98765 43210"}).status_code == 201
    assert ctx.post("ADMIN", "/api/v1/admin/contractors", {"name": "Bad Phone Ltd", "phone": "12"}).status_code == 400
    assert ctx.put("ADMIN", f"/api/v1/admin/users/{ctx.ids['w2']}", {"phone": "call me"}).status_code == 400
    r = ctx.post("ADMIN", "/api/v1/admin/users/import", {"csv": "name,employee_code,role,site_code,phone\nBad P,EXT-P1,reporter,TN1,abc\n"}).json()
    assert r["created"] == 0 and r["skipped"] == 1
    r = ctx.post("ADMIN", "/api/v1/admin/people/import", {"csv": "name,phone\nBad Q,xyz\n"}).json()
    assert r["created"] == 0 and r["skipped"] == 1
