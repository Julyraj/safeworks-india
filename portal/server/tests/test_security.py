"""Security defects S1–S4 found in the detailed review (Nov 2026). Each test shows the attack and expects it refused."""
import uuid

import pyotp

from conftest import PHOTO, PHOTO2, run


def _admin_login(ctx, code: str, pw: str):
    return ctx.login(code, pw, "admin")


def test_s1_mfa_cannot_be_reenrolled_with_password_only(ctx):
    """S1: with only the password, a pre-auth session could enrol a new authenticator and get a full session."""
    run(lambda c: c.execute("update users set mfa_enabled = false, mfa_secret_enc = '' where employee_code = 'ADMIN01'"))
    r = _admin_login(ctx, "ADMIN01", "Admin-Pass-2026")
    pre = r.json()["token"]
    secret = ctx.client.post("/api/v1/auth/mfa/enrol", headers={"authorization": f"Bearer {pre}"}).json()["secret"]
    r = ctx.client.post("/api/v1/auth/mfa/confirm", json={"code": pyotp.TOTP(secret).now()}, headers={"authorization": f"Bearer {pre}"})
    assert r.status_code == 200  # first enrolment is allowed
    # the attacker knows the password only
    r = _admin_login(ctx, "ADMIN01", "Admin-Pass-2026")
    body = r.json()
    assert body["mfaRequired"] is True and body["mfaEnrolled"] is True
    pre2 = body["token"]
    r = ctx.client.post("/api/v1/auth/mfa/enrol", headers={"authorization": f"Bearer {pre2}"})
    assert r.status_code == 403, r.text
    r = ctx.client.post("/api/v1/auth/mfa/confirm", json={"code": "123456"}, headers={"authorization": f"Bearer {pre2}"})
    assert r.status_code == 403, r.text
    # the real authenticator still works and the secret was not replaced
    r = ctx.client.post("/api/v1/auth/mfa", json={"code": pyotp.TOTP(secret).now()}, headers={"authorization": f"Bearer {pre2}"})
    assert r.status_code in (200, 401)  # 401 only if the same 30-second code was just used
    assert run(lambda c: c.fetchval("select mfa_enabled from users where employee_code = 'ADMIN01'")) is True


def test_s2_officer_cannot_issue_enrolment_code_for_peer_or_superior(ctx):
    """S2: an officer could issue an enrolment code for the site head (or another officer) and sign in as them."""
    so1 = ctx.tokens["SO1-admin"]
    h = {"authorization": f"Bearer {so1}"}
    for target in ("sh1", "so2"):
        r = ctx.client.post(f"/api/v1/admin/users/{ctx.ids[target]}/enrolment-code", headers=h)
        assert r.status_code in (403, 404), f"{target}: {r.status_code} {r.text}"
    # a worker or owner at the officer's site is still fine
    r = ctx.client.post(f"/api/v1/admin/users/{ctx.ids['w2']}/enrolment-code", headers=h)
    assert r.status_code == 200, r.text
    # HSE may issue for a site head; signing in with that code still asks for MFA when the role needs it
    from safeworks.settings import clear_org_cache
    run(lambda c: c.execute("update organisations set settings = settings || '{\"mfaRequiredRoles\": [\"admin\", \"site_head\"]}'::jsonb"))
    clear_org_cache()
    try:
        r = ctx.client.post(f"/api/v1/admin/users/{ctx.ids['sh1']}/enrolment-code", headers={"authorization": f"Bearer {ctx.tokens['HSE-admin']}"})
        assert r.status_code == 200, r.text
        r = ctx.client.post("/api/v1/auth/enrol", json={"code": r.json()["code"], "newPassword": "Site-Head-New-2026x", "deviceUuid": "dev-sh1-enrol", "platform": "test", "appVersion": "2.0.0"})
        assert r.status_code == 200, r.text
        assert r.json().get("mfaRequired") is True and "me" not in r.json(), r.text
    finally:
        run(lambda c: c.execute("update organisations set settings = settings || '{\"mfaRequiredRoles\": [\"admin\"]}'::jsonb"))
        clear_org_cache()
        from safeworks.security import hash_password
        from conftest import PW
        run(lambda c: _reset_pw(c, ctx.ids["sh1"], PW, hash_password))


async def _reset_pw(c, uid, pw, hasher):
    await c.execute("update users set password_hash = $2 where id = $1", uuid.UUID(uid), await hasher(pw))


def test_s3_reporter_site_is_not_visible_in_lists(ctx):
    """S3: an officer at site A who is only a reporter at site B could list every record of site B with ?siteId=B."""
    run(lambda c: c.execute("insert into user_site_roles (user_id, site_id, role) values ($1, $2, 'reporter') on conflict do nothing", uuid.UUID(ctx.ids["so1"]), uuid.UUID(ctx.ids["siteB"])))
    try:
        ctx.tokens["SO1"] = ctx.login("SO1").json()["token"]
        ctx.create_obs("SOB", site="siteB", area="areaB1", description="Site B private report S3B")
        b = ctx.ids["siteB"]
        for path in (f"/api/v1/observations?siteId={b}", f"/api/v1/actions?siteId={b}", f"/api/v1/inspections/runs?siteId={b}"):
            r = ctx.get("SO1", path)
            assert r.status_code == 404 or "S3B" not in r.text, f"{path}: {r.status_code}"
        r = ctx.get("SO1", f"/api/v1/observations?siteId={b}&mine=1")  # their own reports at B are fine
        assert r.status_code == 200
        r = ctx.get("SO1", f"/api/v1/dashboard?siteId={b}")
        assert r.status_code in (403, 404), r.status_code
    finally:
        run(lambda c: c.execute("delete from user_site_roles where user_id = $1 and site_id = $2 and role = 'reporter'", uuid.UUID(ctx.ids["so1"]), uuid.UUID(ctx.ids["siteB"])))
        ctx.tokens["SO1"] = ctx.login("SO1").json()["token"]


def test_s4_only_the_uploader_can_send_photo_bytes(ctx):
    """S4: anyone who could view a photo (verifier, auditor, officer) could overwrite its bytes."""
    payload = ctx.obs_payload(media=[ctx.media_ref(PHOTO)])
    r = ctx.post("W1", "/api/v1/observations", payload)
    assert r.status_code in (200, 201), r.text
    up = r.json()["uploads"][0]
    cu = up.get("clientUuid") or payload["media"][0]["clientUuid"]
    assert ctx.upload("W1", f"/api/v1/media/{cu}", PHOTO).status_code == 200
    for who in ("VER1", "SO1"):
        r = ctx.upload(who, f"/api/v1/media/{cu}", PHOTO2)
        assert r.status_code in (403, 404), f"{who}: {r.status_code} {r.text}"
    r = ctx.client.put(f"/api/v1/media/{cu}", content=PHOTO2, headers={"content-type": "image/jpeg", "authorization": f"Bearer {ctx.tokens['AUD-admin']}"})
    assert r.status_code in (403, 404), r.text
    assert run(lambda c: c.fetchval("select hash_match from media where client_uuid = $1", uuid.UUID(cu))) is not False


def test_c1_export_checks_both_site_parameters(ctx):
    """C1: ?siteIds=<my site>&siteId=<other site> passed the check on the first and exported the second."""
    run(lambda c: c.execute("insert into user_site_roles (user_id, site_id, role) values ($1, $2, 'verifier') on conflict do nothing", uuid.UUID(ctx.ids["so1"]), uuid.UUID(ctx.ids["siteB"])))
    try:
        ctx.tokens["SO1"] = ctx.login("SO1").json()["token"]
        ctx.create_obs("SOB", site="siteB", area="areaB1", description="Site B export check C1B")
        a, b = ctx.ids["siteA"], ctx.ids["siteB"]
        for path in (f"observations.csv?siteIds={a}&siteId={b}", f"actions.csv?siteIds={a}&siteId={b}", f"report.xlsx?siteIds={a}&siteId={b}"):
            r = ctx.get("SO1", f"/api/v1/exports/{path}")
            assert r.status_code == 404, f"{path}: {r.status_code}"
        r = ctx.get("SO1", f"/api/v1/exports/observations.csv?siteIds={a}")
        assert r.status_code == 200 and "C1B" not in r.text
    finally:
        run(lambda c: c.execute("delete from user_site_roles where user_id = $1 and site_id = $2 and role = 'verifier'", uuid.UUID(ctx.ids["so1"]), uuid.UUID(ctx.ids["siteB"])))
        ctx.tokens["SO1"] = ctx.login("SO1").json()["token"]


def _ist_today():
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone(timedelta(hours=5, minutes=30)))
    return now.date(), (now - timedelta(days=30)).date()


def test_c2_insights_reversed_dates_keep_whole_days(ctx):
    """C2: from/to entered the wrong way round dropped most of the first and last day from Charts."""
    ctx.create_obs("W1", description="C2 today report")
    today, before = _ist_today()
    right = ctx.get("SO1", f"/api/v1/insights?level=site&from={before}&to={today}").json()
    wrong = ctx.get("SO1", f"/api/v1/insights?level=site&from={today}&to={before}").json()
    assert right["reports"]["total"] >= 1
    assert wrong["reports"]["total"] == right["reports"]["total"]


def test_c3_report_xlsx_reversed_dates_fill_the_sheets(ctx):
    """C3: report.xlsx with reversed dates had a Summary with N reports but empty Reports and Actions sheets."""
    import io
    import re
    import zipfile
    ctx.create_obs("W1", description="C3 report row")
    today, before = _ist_today()
    a = ctx.ids["siteA"]

    def rows(frm, to):
        r = ctx.get("SH1", f"/api/v1/exports/report.xlsx?siteIds={a}&from={frm}&to={to}")
        assert r.status_code == 200, r.text
        z = zipfile.ZipFile(io.BytesIO(r.content))
        return len(re.findall(r"<row ", z.read("xl/worksheets/sheet2.xml").decode()))
    right = rows(before, today)
    assert right > 1
    assert rows(today, before) == right
