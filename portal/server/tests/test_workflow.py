"""End-to-end tests of the observation workflow and the permission rules, against a real PostgreSQL."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone

from conftest import PHOTO, PW


def point(c, site: str, **extra):
    p = {
        "id": str(uuid.uuid4()), "siteId": site, "type": "unsafe_condition", "categoryCode": "C02", "itemCode": "C02-01", "hazard": "Fall from height",
        "severity": 4, "likelihood": 3, "description": "Guardrail missing on slab edge at level 3.", "immediateAction": "Barricaded / tagged out",
        "rootCause": "Procedure or supervision", "correctiveAction": "Fix guardrail, mid-rail and toe board.", "ownerId": c.ids["sup1"],
    }
    p.update(extra)
    return p


def iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def test_lockout_and_admin_unlock(ctx):
    for _ in range(4):
        assert ctx.login("LOCKME", "wrong-pass1").status_code == 401
    assert ctx.login("LOCKME", "wrong-pass1").status_code == 423
    assert ctx.login("LOCKME", PW).status_code == 423, "still locked even with the right password"
    assert ctx.call("ADMIN", "POST", f"/api/admin/users/{ctx.ids['lockme']}/unlock").status_code == 200
    assert ctx.login("LOCKME", PW).status_code == 200


def test_temporary_password_must_be_changed(ctx):
    r = ctx.login("NEW1")
    assert r.status_code == 200 and r.json()["mustChangePassword"] is True
    ctx.tokens["NEW1"] = r.json()["token"]
    blocked = ctx.call("NEW1", "GET", "/api/sites")
    assert blocked.status_code == 403 and blocked.json()["code"] == "must_change_password"
    assert ctx.call("NEW1", "POST", "/api/auth/change-password", {"currentPassword": PW, "newPassword": "short"}).status_code == 400
    assert ctx.call("NEW1", "POST", "/api/auth/change-password", {"currentPassword": PW, "newPassword": "NewPass2026"}).status_code == 200
    assert ctx.call("NEW1", "GET", "/api/sites").status_code == 200


def test_admin_console_access(ctx):
    assert ctx.login("SO1", PW, "admin").status_code == 403
    assert ctx.login("VIEW", PW, "admin").status_code == 200
    assert ctx.call("SO1", "GET", "/api/admin/users").status_code == 403, "portal token cannot call admin API"


def test_photo_rules_and_supervisors_cannot_raise(ctx):
    a = ctx.ids["siteA"]
    assert ctx.upload("SUP1", "/api/observations", point(ctx, a), [("photos", PHOTO)]).status_code == 403
    none = ctx.upload("SO1", "/api/observations", point(ctx, a), [])
    assert none.status_code == 400 and re.search("photo", none.json()["error"], re.I)
    three = ctx.upload("SO1", "/api/observations", point(ctx, a), [("photos", PHOTO)] * 3)
    assert three.status_code in (400, 413)
    assert ctx.upload("SO1", "/api/observations", point(ctx, a), [("photos", b"not an image at all")]).status_code == 400


def test_full_cycle(ctx):
    p = point(ctx, ctx.ids["siteA"])
    r = ctx.upload("SO1", "/api/observations", p, [("photos", PHOTO), ("photos", PHOTO)])
    assert r.status_code == 201, r.text
    o = r.json()
    assert re.match(r"^OBS-SA-\d{4}-00001$", o["code"])
    assert o["riskLevel"] == "High" and o["status"] == "open" and o["owner"]["id"] == ctx.ids["sup1"] and len(o["photos"]) == 2
    assert abs((iso(o["dueAt"]) - iso(o["raisedAt"])).total_seconds() - 3 * 86400) < 120, "High risk is due in 3 days"

    again = ctx.upload("SO1", "/api/observations", p, [("photos", PHOTO)])
    assert again.status_code == 200 and again.json()["code"] == o["code"], "offline retry does not duplicate"

    url = o["photos"][0]["url"]
    img = ctx.client.get(url)
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    assert ctx.client.get(re.sub(r"s=[^&]+", "s=forged", url)).status_code == 403

    mine = ctx.call("SUP1", "GET", "/api/observations?scope=assigned&status=open").json()
    assert any(x["id"] == p["id"] for x in mine["items"])
    cl = ctx.upload("SUP1", f"/api/observations/{p['id']}/closure", {"comment": "Guardrail fixed and checked."}, [("photos", PHOTO)])
    assert cl.status_code == 200 and cl.json()["status"] == "closure_submitted", cl.text
    assert ctx.call("SUP1", "POST", f"/api/observations/{p['id']}/decision", {"decision": "approve"}).status_code == 403

    assert ctx.call("SOB", "GET", f"/api/observations/{p['id']}").status_code == 403
    assert ctx.call("SOB", "POST", f"/api/observations/{p['id']}/decision", {"decision": "approve"}).status_code == 403
    assert not any(x["id"] == p["id"] for x in ctx.call("SOB", "GET", "/api/observations?status=any").json()["items"])

    assert ctx.call("SO1", "POST", f"/api/observations/{p['id']}/decision", {"decision": "reject"}).status_code == 400
    rej = ctx.call("SO1", "POST", f"/api/observations/{p['id']}/decision", {"decision": "reject", "remarks": "Toe board missing."})
    assert rej.status_code == 200 and rej.json()["status"] == "in_progress"
    ctx.upload("SUP1", f"/api/observations/{p['id']}/closure", {"comment": "Toe board added."}, [])
    ok = ctx.call("SO1", "POST", f"/api/observations/{p['id']}/decision", {"decision": "approve", "remarks": "Verified", "onsiteVerified": True})
    j = ok.json()
    assert ok.status_code == 200 and j["status"] == "closed" and j["closedAt"]
    assert [c["decision"] for c in j["closures"]] == ["rejected", "approved"]
    assert [t["action"] for t in j["timeline"]] == ["created", "closure_submitted", "rejected", "closure_submitted", "approved"]
    again = ctx.call("SO2", "POST", f"/api/observations/{p['id']}/decision", {"decision": "approve"})
    assert again.status_code == 409, "a second approval of the same closure is a conflict"


def test_no_self_approval(ctx):
    p = point(ctx, ctx.ids["siteA"], ownerId=ctx.ids["so1"])
    assert ctx.upload("SO1", "/api/observations", p, [("photos", PHOTO)]).status_code == 201
    assert ctx.upload("SO1", f"/api/observations/{p['id']}/closure", {"comment": "Done by me."}, []).status_code == 200
    assert ctx.call("SO1", "POST", f"/api/observations/{p['id']}/decision", {"decision": "approve"}).status_code == 403
    queue = ctx.call("SO1", "GET", "/api/observations?scope=approvals&status=awaiting").json()
    assert not any(x["id"] == p["id"] for x in queue["items"]), "own closures are not in your approval queue"
    assert ctx.call("SO2", "POST", f"/api/observations/{p['id']}/decision", {"decision": "approve"}).status_code == 200


def test_safe_behaviour_and_corrected_on_spot(ctx):
    a = ctx.ids["siteA"]
    safe = ctx.upload("SO1", "/api/observations", {"id": str(uuid.uuid4()), "siteId": a, "type": "safe_behaviour", "description": "Full tie-off while shifting."}, [("photos", PHOTO)])
    assert safe.status_code == 201, safe.text
    assert safe.json()["status"] == "noted" and safe.json()["dueAt"] is None
    spot = ctx.upload("SO1", "/api/observations", point(ctx, a, correctedOnSpot=True, ownerId=None), [("photos", PHOTO), ("afterPhotos", PHOTO)])
    assert spot.status_code == 201, spot.text
    assert spot.json()["status"] == "closed"
    assert len([x for x in spot.json()["photos"] if x["kind"] == "closure"]) == 1


def test_versioned_edits_extension_cancel(ctx):
    p = point(ctx, ctx.ids["siteA"])
    ctx.upload("SO1", "/api/observations", p, [("photos", PHOTO)])
    assert ctx.call("SUP1", "PATCH", f"/api/observations/{p['id']}", {"description": "changed by supervisor"}).status_code == 403
    ed = ctx.call("SO2", "PATCH", f"/api/observations/{p['id']}", {"severity": 5, "likelihood": 4, "reason": "Higher drop than first noted"})
    assert ed.status_code == 200, ed.text
    assert ed.json()["riskLevel"] == "Critical" and ed.json()["version"] == 2
    new_due = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
    ex = ctx.call("SO1", "POST", f"/api/observations/{p['id']}/extend", {"dueAt": new_due, "reason": "Material on order"})
    assert ex.status_code == 200 and ex.json()["originalDueAt"]
    assert ctx.call("SO1", "POST", f"/api/observations/{p['id']}/cancel", {}).status_code == 400, "cancel needs a reason"
    assert ctx.call("SO1", "POST", f"/api/observations/{p['id']}/cancel", {"reason": "Duplicate of an earlier point"}).json()["status"] == "cancelled"


def test_admin_users_and_passwords(ctx):
    created = ctx.call("ADMIN", "POST", "/api/admin/users", {"employeeId": "E900", "name": "New Supervisor", "roles": [{"role": "supervisor", "siteId": ctx.ids["siteA"]}], "password": {"mode": "temp"}})
    assert created.status_code == 201, created.text
    assert re.match(r"^[A-Za-z]+-\d{4}-[A-Za-z]+$", created.json()["tempPassword"])
    dup = ctx.call("ADMIN", "POST", "/api/admin/users", {"employeeId": "e900", "name": "Dup", "roles": [{"role": "supervisor", "siteId": ctx.ids["siteA"]}]})
    assert dup.status_code == 409, "employee IDs are unique regardless of case"
    assert ctx.call("ADMIN", "POST", "/api/admin/users", {"employeeId": "E901", "name": "Bad", "roles": [{"role": "safety_officer", "siteId": None}]}).status_code == 400

    old = ctx.tokens["SUP1"]
    reset = ctx.call("ADMIN", "POST", f"/api/admin/users/{ctx.ids['sup1']}/password", {"mode": "temp"})
    assert reset.status_code == 200 and reset.json()["tempPassword"]
    assert ctx.client.get("/api/me", headers={"authorization": f"Bearer {old}"}).status_code == 401, "reset signs the user out everywhere"
    l1 = ctx.login("SUP1", reset.json()["tempPassword"])
    assert l1.status_code == 200 and l1.json()["mustChangePassword"] is True
    assert ctx.call("ADMIN", "POST", f"/api/admin/users/{ctx.ids['sup1']}/password", {"mode": "set", "password": "abc"}).status_code == 400
    assert ctx.call("ADMIN", "POST", f"/api/admin/users/{ctx.ids['sup1']}/password", {"mode": "set", "password": "Chosen2026", "mustChange": False}).status_code == 200
    l2 = ctx.login("SUP1", "Chosen2026")
    assert l2.status_code == 200 and l2.json()["mustChangePassword"] is False
    ctx.tokens["SUP1"] = l2.json()["token"]

    assert ctx.call("VIEW", "POST", "/api/admin/users", {"employeeId": "X1", "name": "X", "roles": [{"role": "viewer", "siteId": None}]}).status_code == 403
    ctx.tokens["VIEWA"] = ctx.login("VIEW", PW, "admin").json()["token"]
    assert ctx.call("VIEWA", "POST", "/api/admin/users", {"employeeId": "X1", "name": "X", "roles": [{"role": "viewer", "siteId": None}]}).status_code == 403, "viewers are read-only"
    assert len(ctx.call("ADMIN", "GET", "/api/admin/audit?action=password").json()["items"]) >= 2


def test_bulk_import(ctx):
    csv = "employee_id,name,designation,role,site_code\nB100,Bulk One,Supervisor,supervisor,SA\nB101,Bulk Two,Safety Officer,safety officer,SB\n"
    dry = ctx.call("ADMIN", "POST", "/api/admin/users/import", {"csv": csv, "dryRun": True}).json()
    assert dry["ready"] == 2 and dry["errors"] == []
    bad = ctx.call("ADMIN", "POST", "/api/admin/users/import", {"csv": "employee_id,name,role,site_code\nB200,X,supervisor,NOPE\n"}).json()
    assert len(bad["errors"]) == 1
    real = ctx.call("ADMIN", "POST", "/api/admin/users/import", {"csv": csv}).json()
    assert len(real["created"]) == 2 and all(c["tempPassword"] for c in real["created"])


def test_dashboards_and_export(ctx):
    me = ctx.call("SO1", "GET", "/api/dashboard/me")
    assert me.status_code == 200 and me.json()["scope"] == "site"
    assert me.json()["counters"]["created"] >= 4 and me.json()["counters"]["closed"] >= 2
    site = ctx.call("SO1", "GET", f"/api/dashboard/site/{ctx.ids['siteA']}")
    assert site.status_code == 200 and len(site.json()["weekly"]) == 12
    assert ctx.call("SUP1", "GET", f"/api/dashboard/site/{ctx.ids['siteA']}").status_code == 403
    ov = ctx.call("ADMIN", "GET", "/api/admin/overview")
    assert ov.status_code == 200 and len(ov.json()["sites"]) == 2
    csv = ctx.call("ADMIN", "GET", "/api/admin/export/observations.csv")
    assert csv.status_code == 200 and "Observation ID,Site code" in csv.text and "OBS-SA-" in csv.text


def test_settings_change_due_dates(ctx):
    body = {"companyName": "Test Co", "dueDays": {"Critical": 1, "High": 2, "Medium": 7, "Low": 15}, "escalation": {"siteHeadDays": 3, "adminDays": 7}}
    assert ctx.call("ADMIN", "PUT", "/api/admin/settings", body).status_code == 200
    bad = dict(body, dueDays={"Critical": 9, "High": 2, "Medium": 7, "Low": 15})
    assert ctx.call("ADMIN", "PUT", "/api/admin/settings", bad).status_code == 400
    o = ctx.upload("SO1", "/api/observations", point(ctx, ctx.ids["siteA"]), [("photos", PHOTO)]).json()
    assert abs((iso(o["dueAt"]) - iso(o["raisedAt"])).total_seconds() - 2 * 86400) < 120, "High risk now due in 2 days"
