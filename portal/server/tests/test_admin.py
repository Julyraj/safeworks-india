"""Admin console: audit chain (test 22), rule packs (test 20), exports with Tamil text, QR poster, site setup, health."""
from __future__ import annotations

import uuid

from conftest import now_iso, run, run_async, run_job


def test_audit_chain_verify_and_tamper(ctx):
    """Test 22: editing an audit row in the database fails chain verification."""
    r = ctx.post("HSE-admin", "/api/v1/admin/audit-log/verify")
    assert r.status_code == 200 and r.json()["ok"] is True and r.json()["rows"] > 10 and r.json()["firstBadId"] is None
    row = run(lambda c: c.fetchrow("select id from audit_log where org_id = $1 order by id limit 1", uuid.UUID(ctx.ids["org"])))
    run(lambda c: c.execute("update audit_log set changes = changes || '{\"tampered\": true}'::jsonb where id = $1", row["id"]))
    r = ctx.post("HSE-admin", "/api/v1/admin/audit-log/verify")
    assert r.json()["ok"] is False and r.json()["firstBadId"] == row["id"]
    run(lambda c: c.execute("update audit_log set changes = changes - 'tampered' where id = $1", row["id"]))
    assert ctx.post("HSE-admin", "/api/v1/admin/audit-log/verify").json()["ok"] is True
    log = ctx.get("HSE-admin", "/api/v1/admin/audit-log?action=login").json()
    assert log["total"] > 0 and log["items"][0]["hash"]
    # phones are masked inside changes
    assert "9876543210" not in ctx.get("HSE-admin", "/api/v1/admin/audit-log?recordType=media").text


def test_disabled_packs(ctx):
    """Test 20: a draft pack cannot be assigned until a reviewer is named; a KA factory timer without a reviewed deadline cannot be enabled."""
    sets = {s["code"]: s for s in ctx.get("HSE-admin", "/api/v1/admin/rule-sets").json()}
    assert sets["KA_OSH_DRAFT_2026"]["status"] == "draft_rule" and sets["KA_OSH_DRAFT_2026"]["enabled"] is False
    assert any(t["deadlineMinutes"] is None for t in sets["KA_FACTORY_LEGACY"]["timerRules"])
    r = ctx.post("HSE-admin", f"/api/v1/admin/sites/{ctx.ids['siteA']}/rule-set", {"code": "KA_OSH_DRAFT_2026", "effectiveFrom": "2026-11-01"})
    assert r.status_code == 400 and "reviewer" in r.json()["error"].lower()
    r = ctx.post("HSE-admin", "/api/v1/admin/rule-sets/KA_FACTORY_LEGACY/enable", {"reviewedBy": "Legal counsel"})
    assert r.status_code == 400 and "deadline" in r.json()["error"].lower()
    r = ctx.post("HSE-admin", f"/api/v1/admin/sites/{ctx.ids['siteA']}/rule-set", {"code": "OSH_CENTRAL", "effectiveFrom": "2026-11-01"})
    assert r.status_code == 200 and r.json()["ruleSetCode"] == "OSH_CENTRAL"
    assert ctx.post("AUD-admin", "/api/v1/admin/rule-sets/OSH_CENTRAL/disable").status_code == 403


def test_export_tamil_and_limits(ctx):
    obs = ctx.create_obs("W1", description="சாரக்கட்டில் நடுத் தண்டவாளம் இல்லை", descriptionLang="ta")
    r = ctx.get("HSE-admin", f"/api/v1/exports/observations.csv?siteId={ctx.ids['siteA']}")
    assert r.status_code == 200
    assert r.content[:3] == b"\xef\xbb\xbf" and "சாரக்கட்டில்" in r.text and obs["caseNo"] in r.text
    assert ctx.get("W1", "/api/v1/exports/observations.csv").status_code == 403
    assert ctx.get("HSE-admin", f"/api/v1/exports/actions.csv?siteId={ctx.ids['siteA']}").status_code == 200
    assert ctx.get("HSE-admin", f"/api/v1/exports/inspections.csv?siteId={ctx.ids['siteA']}").status_code == 200
    n = run(lambda c: c.fetchval("select count(*) from audit_log where action = 'export'"))
    assert n >= 3


def test_site_setup_and_poster(ctx):
    if "ADMIN" not in ctx.tokens:
        from test_auth_scope import test_mfa_flow
        test_mfa_flow(ctx)
    r = ctx.post("ADMIN", "/api/v1/admin/sites", {"code": "KA9", "name": {"en": "Warehouse 9", "kn": "ಗೋದಾಮು 9"}, "state": "KA", "district": "Hubballi", "establishmentType": "other"})
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    r = ctx.post("ADMIN", f"/api/v1/admin/sites/{sid}/setup", {"industryCode": "warehouse"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["site"]["industryCode"] == "warehouse" and len(out["areas"]) >= 8 and len(out["posters"]) == len(out["areas"]) + 1
    poster = ctx.get("ADMIN", out["posters"][1]["posterUrl"] + "?lang=en,ta,kn&size=A4")
    assert poster.status_code == 200 and "<svg" in poster.text and "Scan to report in 30 seconds" in poster.text and "ஸ்கேன்" in poster.text
    assert ctx.post("ADMIN", f"/api/v1/admin/sites/{sid}/setup", {"industryCode": "warehouse"}).json()["areas"].__len__() == len(out["areas"])  # idempotent
    # areas import, assets, QR rotate
    csv = "code,name,type,parent\nDOCK1,Dock 1,loading_bay,\nDOCK2,Dock 2,loading_bay,\n"
    r = ctx.client.post(f"/api/v1/admin/sites/{sid}/areas/import", content=csv, headers={"authorization": f"Bearer {ctx.tokens['ADMIN']}", "content-type": "text/csv"})
    assert r.status_code == 200 and r.json()["created"] == 2
    r = ctx.post("ADMIN", "/api/v1/admin/assets", {"siteId": sid, "assetClass": "vehicle", "tagNo": "FLT-01", "makeModel": "Toyota 8FB"})
    assert r.status_code == 201
    q = ctx.post("ADMIN", "/api/v1/admin/qr-codes", {"targetType": "asset", "targetId": r.json()["id"], "label": "FLT-01"})
    assert q.status_code == 201 and q.json()["url"].endswith(q.json()["token"])
    rot = ctx.post("ADMIN", f"/api/v1/admin/qr-codes/{q.json()['id']}/rotate")
    assert rot.status_code == 201 and rot.json()["token"] != q.json()["token"]
    assert ctx.client.get(f"/api/v1/public/qr/{q.json()['token']}").status_code == 410
    assert ctx.client.get(f"/api/v1/public/qr/{rot.json()['token']}").json()["asset"]["tagNo"] == "FLT-01"
    # users: create, roles, reset, import
    r = ctx.post("ADMIN", "/api/v1/admin/users", {"name": "New Officer", "employeeCode": "SO9", "email": "so9@test.local", "loginType": "email", "language": "kn",
                                                   "roles": [{"siteId": sid, "role": "site_safety_officer"}]})
    assert r.status_code == 201 and r.json()["tempPassword"] and r.json()["roles"][0]["siteId"] == sid
    uid = r.json()["id"]
    assert ctx.post("ADMIN", f"/api/v1/admin/users/{uid}/roles", {"roles": [{"siteId": None, "role": "site_safety_officer"}]}).status_code == 400
    r = ctx.client.post("/api/v1/admin/users/import", content="name,employee_code,email,language,employer,trade,phone,role,site_code\nRam K,W90,,ta,,civil,9999999999,reporter,KA9\n",
                        headers={"authorization": f"Bearer {ctx.tokens['ADMIN']}", "content-type": "text/csv"})
    assert r.status_code == 200 and r.json()["created"] == 1
    assert ctx.get("ADMIN", "/api/v1/admin/users?q=Ram").json()["total"] == 1
    h = ctx.get("ADMIN", "/api/v1/admin/health").json()
    assert h["db"] == "ok" and "queuedEmails" in h
    assert ctx.get("ADMIN", "/api/v1/admin/translations?lang=ta").json()["total"] > 100
    r = ctx.put("ADMIN", "/api/v1/admin/translations/ta", {"overrides": {"poster.headline": "ஆபத்து கண்டீர்களா?"}})
    assert r.status_code == 200 and r.json()["overrides"]["poster.headline"]
    assert ctx.get("ADMIN", "/api/v1/admin/categories").json()[0]["code"] == "PPE"
    assert ctx.get("ADMIN", "/api/v1/admin/industries").json().__len__() == 23
    r = ctx.post("ADMIN", "/api/v1/admin/retention/dry-run")
    assert r.status_code == 200 and "observation" in r.json()["byRecordType"]
    assert ctx.get("ADMIN", "/api/v1/admin/settings").json()["criticalAckMinutes"] == 30


def test_ladder_job_marks_overdue(ctx):
    """Test 11 (job): owner reminders at D-7/D-3/D, escalation at D+1 to officer and site head, D+3 to the HSE manager."""
    obs = ctx.create_obs("W1")
    d = ctx.triage_assign(obs["id"], likelihood=1, severity=2)  # low: 90 days
    aid = d["actions"][0]["id"]
    run(lambda c: c.execute("update actions set due_at = now() - interval '3 days' - interval '1 hour', created_at = now() - interval '30 days' where id = $1", uuid.UUID(aid)))
    from safeworks.jobs import ladder_job
    run_job(ctx, ladder_job)
    run_job(ctx, ladder_job)
    ev = run(lambda c: c.fetch("select event_type, body from action_events where action_id = $1 and event_type in ('reminder_sent','escalated') order by id", uuid.UUID(aid)))
    bodies = [e["body"] for e in ev]
    assert any("owner +0" in b for b in bodies) and any("site_safety_officer +1440" in b for b in bodies) and any("hse_manager +4320" in b for b in bodies)
    assert run(lambda c: c.fetchval("select escalation_level from actions where id = $1", uuid.UUID(aid))) == 2
    assert any(x["recordId"] == aid and x["eventType"] == "action_overdue" for x in ctx.get("HSE", "/api/v1/me/notifications").json()["items"])
    # daily cap: a second run adds nothing (steps already marked)
    run_job(ctx, ladder_job)
    assert run(lambda c: c.fetchval("select count(*) from action_events where action_id = $1 and event_type in ('reminder_sent','escalated')", uuid.UUID(aid))) == len(ev)


def test_push_sender_without_vapid(ctx):
    from safeworks.jobs import send_pushes
    run_async(ctx, send_pushes)
    assert run(lambda c: c.fetchval("select count(*) from notifications where channel = 'push' and status = 'failed' and error like 'VAPID%'")) > 0
    assert ctx.post("W1", "/api/v1/me/devices", {"deviceUuid": "dev-W1", "platform": "web", "appVersion": "2.0.0", "subscription": {"endpoint": "https://push.example/abc", "keys": {"p256dh": "x", "auth": "y"}}}).status_code == 200
    assert ctx.put("W1", "/api/v1/me/preferences", {"language": "kn", "digest": "weekly", "quietHours": False}).json()["language"] == "kn"
    assert ctx.post("W1", "/api/v1/me/privacy-ack", {"version": 1}).status_code == 200
    assert ctx.get("W1", "/api/v1/me").json()["privacyAckedVersion"] == 1
    assert ctx.put("W1", "/api/v1/me/preferences", {"language": "ta", "digest": "daily", "quietHours": True}).status_code == 200


def test_health_and_version(ctx):
    assert ctx.client.get("/api/v1/health").json()["ok"] is True
    assert ctx.client.get("/api/v1/version").json()["version"] == "2.0.0"
    assert ctx.client.get("/api/v1/nothing").status_code in (401, 404)
    _ = now_iso
