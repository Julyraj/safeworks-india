"""Auth, MFA, site scope, anonymity, sync idempotency and conflicts, QR (brief §17.2 tests 1, 3, 4, 5, 17)."""
from __future__ import annotations

import hashlib
import uuid

import pyotp

from conftest import PHOTO, PHOTO2, PW, now_iso, run


def test_login_and_me(ctx):
    r = ctx.get("W1", "/api/v1/me")
    assert r.status_code == 200
    me = r.json()
    assert me["employeeCode"] == "W1" and me["roles"][0]["role"] == "reporter" and me["sites"][0]["code"] == "TN1"
    assert me["org"]["settings"]["triageSlaWorkingDays"] == 1
    bad = ctx.login("W1", "wrong-password-1")
    assert bad.status_code == 401 and bad.json()["code"] == "unauthorized"
    # translated error
    r = ctx.client.post("/api/v1/auth/login", json={"login": "W1", "password": "wrong-password-1", "kind": "field"}, headers={"accept-language": "ta"})
    assert r.status_code == 401 and "கடவுச்சொல்" in r.json()["error"]


def test_worker_cannot_use_admin_console(ctx):
    r = ctx.login("W1", PW, "admin")
    assert r.status_code == 403 and r.json()["code"] == "forbidden"


def test_mfa_flow(ctx):
    run(lambda c: c.execute("update users set mfa_enabled = false, mfa_secret_enc = '' where employee_code = 'ADMIN01'"))  # start from an un-enrolled admin
    r = ctx.login("ADMIN01", "Admin-Pass-2026", "admin")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mfaRequired"] is True and body["mfaEnrolled"] is False and "me" not in body
    pre = body["token"]
    # pre-auth token cannot reach normal routes
    r = ctx.client.get("/api/v1/me", headers={"authorization": f"Bearer {pre}"})
    assert r.status_code == 403 and r.json()["code"] == "mfa_required"
    r = ctx.client.post("/api/v1/auth/mfa/enrol", headers={"authorization": f"Bearer {pre}"})
    assert r.status_code == 200
    secret = r.json()["secret"]
    assert r.json()["otpauthUrl"].startswith("otpauth://totp/")
    r = ctx.client.post("/api/v1/auth/mfa/confirm", json={"code": "000000"}, headers={"authorization": f"Bearer {pre}"})
    assert r.status_code == 401
    r = ctx.client.post("/api/v1/auth/mfa/confirm", json={"code": pyotp.TOTP(secret).now()}, headers={"authorization": f"Bearer {pre}"})
    assert r.status_code == 200, r.text
    assert r.json()["me"]["mfaEnabled"] is True
    ctx.tokens["ADMIN"] = r.json()["token"]
    assert ctx.get("ADMIN", "/api/v1/me").status_code == 200
    # second login: password then code
    r = ctx.login("ADMIN01", "Admin-Pass-2026", "admin")
    assert r.json()["mfaRequired"] is True and r.json()["mfaEnrolled"] is True
    pre2 = r.json()["token"]
    r = ctx.client.post("/api/v1/auth/mfa", json={"code": pyotp.TOTP(secret).now()}, headers={"authorization": f"Bearer {pre2}"})
    assert r.status_code == 200 and r.json()["me"]["employeeCode"] == "ADMIN01"
    ctx.tokens["ADMIN"] = r.json()["token"]


def test_password_rules(ctx):
    r = ctx.login("W2")
    tok = r.json()["token"]
    r = ctx.client.post("/api/v1/auth/password", json={"current": PW, "new": "short1"}, headers={"authorization": f"Bearer {tok}"})
    assert r.status_code == 400
    r = ctx.client.post("/api/v1/auth/password", json={"current": PW, "new": "worker-pass-9"}, headers={"authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    # staff need 12+
    r = ctx.client.post("/api/v1/auth/password", json={"current": PW, "new": "staff-pass9"}, headers={"authorization": f"Bearer {ctx.tokens['SO2']}"})
    assert r.status_code == 400
    # restore W2
    r = ctx.client.post("/api/v1/auth/password", json={"current": "worker-pass-9", "new": PW}, headers={"authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    ctx.tokens["W2"] = ctx.login("W2").json()["token"]


def test_enrolment_code(ctx):
    r = ctx.post("SO1-admin", f"/api/v1/admin/users/{ctx.ids['w2']}/enrolment-code")
    assert r.status_code == 200, r.text
    code = r.json()["code"]
    r = ctx.client.post("/api/v1/auth/enrol", json={"code": code, "newPassword": "new-worker-pw1", "deviceUuid": "dev-enrol"})
    assert r.status_code == 200 and r.json()["me"]["employeeCode"] == "W2"
    r = ctx.client.post("/api/v1/auth/enrol", json={"code": code, "newPassword": "new-worker-pw1"})
    assert r.status_code == 400  # one-time
    r = ctx.client.post("/api/v1/auth/password", json={"current": "new-worker-pw1", "new": PW}, headers={"authorization": f"Bearer {ctx.tokens['W2']}"})
    assert r.status_code in (200, 401)  # the old W2 session was revoked by the enrolment
    ctx.tokens["W2"] = ctx.login("W2").json()["token"]


def test_exactly_once_sync_create_with_photos(ctx):
    """Test 1: one observation and 3 media rows, hashes match; the same command twice → duplicate."""
    refs = [ctx.media_ref(PHOTO), ctx.media_ref(PHOTO2), ctx.media_ref(PHOTO)]
    payload = ctx.obs_payload(media=refs)
    cmd = {"commandId": str(uuid.uuid4()), "seq": 1, "entityType": "observation", "op": "create", "entityClientUuid": payload["clientUuid"], "capturedAt": now_iso(), "payload": payload}
    r = ctx.post("W1", "/api/v1/sync/push", {"deviceId": "dev-W1", "appVersion": "2.0.0", "commands": [cmd]})
    assert r.status_code == 200, r.text
    res = r.json()["results"][0]
    assert res["status"] == "applied" and res["caseNo"].startswith("TN1-OBS-") and len(res["uploads"]) == 3
    for u, data in zip(res["uploads"], [PHOTO, PHOTO2, PHOTO]):
        up = ctx.upload("W1", u["url"], data)
        assert up.status_code == 200, up.text
        assert up.json()["uploadStatus"] == "verified" and up.json()["hashMatch"] is True
    # repeat: duplicate, nothing new
    r = ctx.post("W1", "/api/v1/sync/push", {"deviceId": "dev-W1", "appVersion": "2.0.0", "commands": [cmd]})
    assert r.json()["results"][0]["status"] == "duplicate"
    # a new command id with the same clientUuid → duplicate as well
    cmd2 = {**cmd, "commandId": str(uuid.uuid4())}
    r = ctx.post("W1", "/api/v1/sync/push", {"deviceId": "dev-W1", "appVersion": "2.0.0", "commands": [cmd2]})
    assert r.json()["results"][0]["status"] == "duplicate"
    n = run(lambda c: c.fetchval("select count(*) from observations where client_uuid = $1", uuid.UUID(payload["clientUuid"])))
    m = run(lambda c: c.fetchval("select count(*) from media where owner_id = (select id from observations where client_uuid = $1) and upload_status = 'verified'", uuid.UUID(payload["clientUuid"])))
    assert n == 1 and m == 3
    # pull shows it as mine with a thumbnail
    r = ctx.get("W1", "/api/v1/sync/pull")
    assert r.status_code == 200
    pull = r.json()
    assert pull["full"] is True and any(o["clientUuid"] == payload["clientUuid"] and o["mine"] and o["thumbUrl"] for o in pull["observations"])
    assert pull["sites"] and pull["categories"] and pull["matrixVersions"] and pull["dueDateRules"] and pull["templates"]
    # delta pull
    from urllib.parse import quote
    r = ctx.get("W1", f"/api/v1/sync/pull?cursor={quote(pull['cursor'])}")
    assert r.json()["full"] is False


def test_sync_dependency_and_conflict_comment(ctx):
    obs = ctx.create_obs("W1")
    # triage once online
    ctx.triage_assign(obs["id"])
    # an offline triage by another officer on the already-triaged record → conflict_saved_as_comment
    cmd = {"commandId": str(uuid.uuid4()), "seq": 5, "entityType": "observation", "op": "triage", "entityClientUuid": obs["clientUuid"], "capturedAt": now_iso(),
           "payload": {"observationId": obs["id"], "clientUuid": str(uuid.uuid4()), "decision": "discard", "reasonCode": "x", "reasonText": "offline decision", "capturedAt": now_iso()}}
    dep = {"commandId": str(uuid.uuid4()), "seq": 6, "entityType": "observation", "op": "comment", "entityClientUuid": obs["clientUuid"], "capturedAt": now_iso(), "dependsOn": ["missing-command"],
           "payload": {"observationId": obs["id"], "clientUuid": str(uuid.uuid4()), "body": "hi", "capturedAt": now_iso()}}
    r = ctx.post("SO2", "/api/v1/sync/push", {"deviceId": "dev-SO2", "appVersion": "2.0.0", "commands": [cmd, dep]})
    res = r.json()["results"]
    assert res[0]["status"] == "conflict_saved_as_comment", res
    assert res[1]["status"] == "rejected" and res[1]["error"]["code"] == "dependency_failed"
    d = ctx.get("SO1", f"/api/v1/observations/{obs['id']}").json()
    assert any(c["kind"] == "rejected_offline_decision" and "offline decision" in c["body"] for c in d["comments"])
    assert d["status"] == "action_assigned"


def test_anonymous_report(ctx):
    """Test 4: nobody sees the reporter; the worker still sees it as mine and gets the closure notice."""
    obs = ctx.create_obs("W1", anonymous=True, description="Anonymous: open edge near the lift shaft")
    assert obs["reporterName"] is None and obs["mine"] is True and obs["anonymous"] is True
    for who in ("SO1", "SH1", "HSE", "AUD-admin", "HSE-admin"):
        d = ctx.get(who, f"/api/v1/observations/{obs['id']}")
        assert d.status_code == 200, (who, d.text)
        assert d.json()["reporterName"] is None and d.json()["mine"] is False
    assert "Worker One" not in ctx.get("SO1", f"/api/v1/observations/{obs['id']}").text
    r = ctx.get("W1", "/api/v1/observations?mine=1")
    assert any(o["id"] == obs["id"] and o["mine"] for o in r.json()["items"])
    reporter_col = run(lambda c: c.fetchval("select reporter_user_id from observations where id = $1", uuid.UUID(obs["id"])))
    assert reporter_col is None
    # export carries no name
    csv = ctx.get("SO1-admin", f"/api/v1/exports/observations.csv?siteId={ctx.ids['siteA']}")
    assert csv.status_code == 200 and csv.content.startswith("﻿".encode("utf-8"))
    line = [l for l in csv.text.splitlines() if obs["caseNo"] in l][0]
    assert "Worker One" not in line
    # close on the spot → the reporter is told through the seal, the notification carries no name
    r = ctx.post("SO1", f"/api/v1/observations/{obs['id']}/triage", {"clientUuid": str(uuid.uuid4()), "decision": "accept_fixed_on_spot", "capturedAt": now_iso()})
    assert r.status_code == 200 and r.json()["status"] == "closed"
    n = ctx.get("W1", "/api/v1/me/notifications").json()["items"]
    assert any(x["recordId"] == obs["id"] and x["eventType"] == "observation_closed" for x in n)
    assert all("Worker One" not in (x["title"] + x["body"]) for x in n)


def test_locked_fields(ctx):
    """Test 5: captured time and GPS cannot change after submit; the attempt is rejected and logged."""
    obs = ctx.create_obs("W1", lat=13.0, lng=80.2)
    r = ctx.put("W1", f"/api/v1/observations/{obs['id']}", {"capturedAt": now_iso(), "lat": 1.0})
    assert r.status_code in (404, 405)
    cmd = {"commandId": str(uuid.uuid4()), "seq": 9, "entityType": "observation", "op": "update", "entityClientUuid": obs["clientUuid"], "capturedAt": now_iso(),
           "payload": {"observationId": obs["id"], "capturedAt": "2020-01-01T00:00:00Z", "lat": 1.0}}
    r = ctx.post("W1", "/api/v1/sync/push", {"deviceId": "dev-W1", "appVersion": "2.0.0", "commands": [cmd]})
    assert r.json()["results"][0]["status"] == "rejected"
    d = ctx.get("W1", f"/api/v1/observations/{obs['id']}").json()
    assert d["capturedAt"] == obs["capturedAt"] and d["lat"] == 13.0
    logged = run(lambda c: c.fetchval("select count(*) from sync_commands where command_id = $1 and result_status = 'rejected'", cmd["commandId"]))
    assert logged == 1


def test_site_scope_404(ctx):
    """Test 17: a Site B token cannot read, export or fetch a photo for a Site A record, even by guessing ids."""
    refs = [ctx.media_ref(PHOTO)]
    obs = ctx.create_obs("W1", media=refs)
    ctx.upload("W1", obs["uploads"][0]["url"], PHOTO)
    d = ctx.get("SO1", f"/api/v1/observations/{obs['id']}").json()
    media = d["media"][0]
    assert ctx.get("SOB", f"/api/v1/observations/{obs['id']}").status_code == 404
    assert ctx.get("SOB", f"/api/v1/media/{media['id']}").status_code == 404
    assert ctx.get("SOB", f"/api/v1/observations?siteId={ctx.ids['siteA']}").status_code == 404
    assert ctx.post("SOB", f"/api/v1/observations/{obs['id']}/triage", {"clientUuid": str(uuid.uuid4()), "decision": "discard", "reasonCode": "x", "reasonText": "y", "capturedAt": now_iso()}).status_code == 404
    assert ctx.upload("SOB", obs["uploads"][0]["url"], PHOTO).status_code == 404
    # file links are signed; a tampered signature is refused
    assert ctx.client.get(media["url"]).status_code == 200
    assert ctx.client.get(media["url"][:-4] + "zzzz").status_code == 403
    # a Site B officer's export filtered to Site A → 404; their own site works
    assert ctx.get("SOB", f"/api/v1/exports/observations.csv?siteId={ctx.ids['siteA']}").status_code == 404
    r = ctx.get("SOB", "/api/v1/observations")
    assert r.status_code == 200 and all(o["siteId"] == ctx.ids["siteB"] for o in r.json()["items"])


def test_admin_cannot_triage(ctx):
    obs = ctx.create_obs("W1")
    if "ADMIN" not in ctx.tokens:
        test_mfa_flow(ctx)
    r = ctx.post("ADMIN", f"/api/v1/observations/{obs['id']}/triage", {"clientUuid": str(uuid.uuid4()), "decision": "discard", "reasonCode": "x", "reasonText": "y", "capturedAt": now_iso()})
    assert r.status_code == 403
    assert ctx.get("ADMIN", f"/api/v1/observations/{obs['id']}").status_code == 200


def test_qr_no_login_and_rate_limit(ctx):
    """Test 3: a phone with no account reports through an area QR with a photo; the 31st in an hour gets 429."""
    token = ctx.ids["qrTokenA1"]
    info = ctx.client.get(f"/api/v1/public/qr/{token}")
    assert info.status_code == 200 and info.json()["site"]["code"] == "TN1" and info.json()["area"]["id"] == ctx.ids["areaA1"] and info.json()["categories"]
    ref = ctx.media_ref(PHOTO)
    body = {"clientUuid": str(uuid.uuid4()), "type": "unsafe_condition", "categoryCodes": ["HOUSE"], "description": "Oil spill near the store", "descriptionLang": "en", "fixedOnSpot": False,
            "imminentDanger": False, "anonymous": False, "name": "Ravi", "phone": "9876543210", "reporterType": "contractor", "lat": None, "lng": None, "accuracyM": None, "capturedAt": now_iso(), "media": [ref]}
    r = ctx.client.post(f"/api/v1/public/qr/{token}/observations", json=body)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["caseNo"].startswith("TN1-OBS-") and out["statusUrl"].startswith("http://testserver/q/status/") and len(out["uploads"]) == 1
    up = ctx.client.put(out["uploads"][0]["url"], content=PHOTO, headers={"content-type": "image/jpeg"})
    assert up.status_code == 200 and up.json()["hashMatch"] is True
    # honeypot
    r = ctx.client.post(f"/api/v1/public/qr/{token}/observations", json={**body, "clientUuid": str(uuid.uuid4()), "honeypot": "spam"})
    assert r.status_code == 400
    # officer sees channel qr, site, area and the named contact; a verifier does not see the contact
    obs = ctx.get("SO1", f"/api/v1/observations?siteId={ctx.ids['siteA']}&channel=qr").json()["items"]
    o = [x for x in obs if x["caseNo"] == out["caseNo"]][0]
    assert o["channel"] == "qr" and o["areaId"] == ctx.ids["areaA1"]
    d = ctx.get("SO1", f"/api/v1/observations/{o['id']}").json()
    assert d["reporterContact"] == {"name": "Ravi", "phone": "9876543210"}
    assert "9876543210" not in ctx.get("HSE-admin", "/api/v1/admin/audit-log?recordType=observation").text
    # status link
    s = ctx.client.get(out["statusUrl"].replace("http://testserver/q/status/", "/api/v1/public/status/"))
    assert s.status_code == 200 and s.json()["status"] == "submitted" and s.json()["timeline"]
    assert ctx.client.get(f"/api/v1/public/status/{out['caseNo']}?s=wrong").status_code == 404
    # return_to_reporter is refused for QR reports
    r = ctx.post("SO1", f"/api/v1/observations/{o['id']}/triage", {"clientUuid": str(uuid.uuid4()), "decision": "return_to_reporter", "question": "where?", "capturedAt": now_iso()})
    assert r.status_code == 400
    # rate limit: 30 per token per hour (2 used)
    for i in range(29):  # 30 allowed in the hour, the 31st is refused
        r = ctx.client.post(f"/api/v1/public/qr/{token}/observations", json={**body, "clientUuid": str(uuid.uuid4()), "media": []})
        assert r.status_code == 201, (i, r.text)
    r = ctx.client.post(f"/api/v1/public/qr/{token}/observations", json={**body, "clientUuid": str(uuid.uuid4()), "media": []})
    assert r.status_code == 429 and r.json()["code"] == "rate_limited"


def test_hash_mismatch_is_recorded(ctx):
    ref = ctx.media_ref(PHOTO)
    ref["sha256"] = hashlib.sha256(b"other").hexdigest()
    obs = ctx.create_obs("W1", media=[ref])
    up = ctx.upload("W1", obs["uploads"][0]["url"], PHOTO)
    assert up.status_code == 200 and up.json()["hashMatch"] is False and up.json()["uploadStatus"] == "uploaded"
    bad = ctx.upload("W1", obs["uploads"][0]["url"], b"not an image at all", "image/jpeg")
    assert bad.status_code == 400
