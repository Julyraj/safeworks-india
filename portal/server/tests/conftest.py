"""Test setup: a fresh schema per run, the base seed (no demo), two sites with test logins, a TestClient.

    TEST_DATABASE_URL=postgres://… pytest
The test database is wiped and rebuilt on every run.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER))
sys.path.insert(0, str(SERVER / "scripts"))

os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "postgres://safeworks:safeworks@127.0.0.1:55432/safeworks_test")
os.environ.setdefault("STORAGE_DIR", tempfile.mkdtemp(prefix="sw-test-"))
os.environ["RUN_JOBS"] = "false"
os.environ["USER_RATE_LIMIT"] = "100000"
os.environ["QR_PER_IP_HOUR"] = "100000"
os.environ["EXPORTS_PER_HOUR"] = "100000"
os.environ["SEED_ADMIN_PASSWORD"] = "Admin-Pass-2026"
os.environ["PUBLIC_URL"] = "http://testserver"

import asyncpg  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from safeworks import db  # noqa: E402
from safeworks.security import hash_password  # noqa: E402
import seed  # noqa: E402

PW = "Test-Pass-12345"
PHOTO = (SERVER / "tests" / "fixtures" / "photo-1.jpg").read_bytes()
PHOTO2 = (SERVER / "tests" / "fixtures" / "photo-2.jpg").read_bytes()


async def _prepare(ids: dict) -> None:
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        await conn.execute("drop schema public cascade; create schema public;")
    finally:
        await conn.close()
    await db.init_pool()
    try:
        from safeworks.migrate import migrate
        await migrate(verbose=False)
        async with db.tx() as c:
            org_id, admin_id, sites, _ = await seed.seed_base(c)
            ids["org"] = org_id
            ids["admin"] = admin_id
            ids["siteA"] = sites["TN1"]
            ids["siteB"] = sites["TN2"]
            pw = await hash_password(PW)
            own = await db.one("select id from contractors where org_id = $1 and is_own_company", [org_id], c)
            ids["own"] = own["id"]
            a, b = sites["TN1"], sites["TN2"]
            ids["so1"] = await seed.ensure_user(c, org_id, "SO1", "Officer One", pw, [("site_safety_officer", a)], email="so1@test.local", login_type="email")
            ids["so2"] = await seed.ensure_user(c, org_id, "SO2", "Officer Two", pw, [("site_safety_officer", a)])
            ids["sh1"] = await seed.ensure_user(c, org_id, "SH1", "Site Head One", pw, [("site_head", a)])
            ids["ver1"] = await seed.ensure_user(c, org_id, "VER1", "Verifier One", pw, [("verifier", a)])
            ids["own1"] = await seed.ensure_user(c, org_id, "OWN1", "Owner One", pw, [("action_owner", a)], employer_id=own["id"])
            ids["own2"] = await seed.ensure_user(c, org_id, "OWN2", "Owner Two", pw, [("action_owner", a)], employer_id=own["id"])
            ids["w1"] = await seed.ensure_user(c, org_id, "W1", "Worker One", pw, [("reporter", a)], lang="ta")
            ids["w2"] = await seed.ensure_user(c, org_id, "W2", "Worker Two", pw, [("reporter", a)])
            ids["sob"] = await seed.ensure_user(c, org_id, "SOB", "Officer B", pw, [("site_safety_officer", b)])
            ids["hse"] = await seed.ensure_user(c, org_id, "HSE", "HSE Manager", pw, [("hse_manager", None)], email="hse@test.local", login_type="email")
            ids["aud"] = await seed.ensure_user(c, org_id, "AUD", "Auditor", pw, [("auditor", None)])
            # the test site head, HSE and admin are exempt from MFA except in the MFA test (which enrols ADMIN01)
            await c.execute("update organisations set settings = settings || '{\"mfaRequiredRoles\": [\"admin\"]}'::jsonb where id = $1", org_id)
            areas = await db.q("select id, code from areas where site_id = $1 order by sort", [a], c)
            ids["areaA1"], ids["areaA2"] = areas[0]["id"], areas[1]["id"]
            areas_b = await db.q("select id from areas where site_id = $1 order by sort", [b], c)
            ids["areaB1"] = areas_b[0]["id"]
            qr = await db.one("select token from qr_codes where target_type = 'area' and target_id = $1", [ids["areaA1"]], c)
            ids["qrTokenA1"] = qr["token"]
            tv = await db.one("select v.id, t.id as tid from inspection_template_versions v join inspection_templates t on t.id = v.template_id where t.code = 'T1' and v.status = 'active'", [], c)
            ids["t1Version"], ids["t1Template"] = tv["id"], tv["tid"]
    finally:
        await db.close_pool()


class Ctx:
    def __init__(self, client: TestClient, ids: dict):
        self.client = client
        self.ids = ids
        self.tokens: dict[str, str] = {}

    def login(self, code: str, password: str = PW, kind: str = "field"):
        return self.client.post("/api/v1/auth/login", json={"login": code, "password": password, "kind": kind, "deviceUuid": f"dev-{code}", "platform": "test", "appVersion": "2.0.0"})

    def call(self, who: str | None, method: str, url: str, body=None, headers: dict | None = None, **kw):
        h = dict(headers or {})
        if who:
            h["authorization"] = f"Bearer {self.tokens[who]}"
        return self.client.request(method, url, json=body, headers=h, **kw)

    def get(self, who, url, **kw):
        return self.call(who, "GET", url, **kw)

    def post(self, who, url, body=None, **kw):
        return self.call(who, "POST", url, body, **kw)

    def put(self, who, url, body=None, **kw):
        return self.call(who, "PUT", url, body, **kw)

    def upload(self, who: str | None, url: str, data: bytes, mime: str = "image/jpeg"):
        h = {"content-type": mime}
        if who:
            h["authorization"] = f"Bearer {self.tokens[who]}"
        return self.client.put(url, content=data, headers=h)

    # ---- builders ----
    @staticmethod
    def media_ref(data: bytes, purpose: str = "before") -> dict:
        return {"clientUuid": str(uuid.uuid4()), "kind": "photo", "purpose": purpose, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "mime": "image/jpeg",
                "capturedAt": now_iso()}

    def obs_payload(self, site="siteA", area="areaA1", **over) -> dict:
        p = {"clientUuid": str(uuid.uuid4()), "siteId": self.ids[site], "areaId": self.ids[area], "lat": None, "lng": None, "accuracyM": None, "capturedAt": now_iso(), "channel": "app",
             "reporterType": "employee", "anonymous": False, "type": "unsafe_condition", "categoryCodes": ["HEIGHT"], "description": "Scaffold without mid-rail on level 3",
             "descriptionLang": "en", "fixedOnSpot": False, "imminentDanger": False, "media": []}
        p.update(over)
        return p

    def create_obs(self, who="W1", **over) -> dict:
        r = self.post(who, "/api/v1/observations", self.obs_payload(**over))
        assert r.status_code in (200, 201), r.text
        return r.json()

    def triage_assign(self, obs_id: str, who="SO1", owner="own1", likelihood=2, severity=3, **over) -> dict:
        body = {"clientUuid": str(uuid.uuid4()), "decision": "accept_assign", "categoryCodes": ["HEIGHT"], "likelihood": likelihood, "severity": severity, "is3786Code": "B-2",
                "employerInvolvedId": self.ids["own"], "capturedAt": now_iso(),
                "actions": [{"clientUuid": str(uuid.uuid4()), "title": "Fit the mid-rail", "problem": "Missing mid-rail", "actionType": "corrective", "controlLevel": "engineering",
                             "ownerUserId": self.ids[owner]}]}
        body.update(over)
        r = self.post(who, f"/api/v1/observations/{obs_id}/triage", body)
        assert r.status_code == 200, r.text
        return r.json()

    def complete(self, action_id: str, who="OWN1", photos: int = 1, **over):
        refs = [self.media_ref(PHOTO2, "after") for _ in range(photos)]
        body = {"clientUuid": str(uuid.uuid4()), "completionNote": "Mid-rail fitted and tagged", "causeAddressed": "Rail removed during material handling", "media": refs, "capturedAt": now_iso()}
        body.update(over)
        r = self.post(who, f"/api/v1/actions/{action_id}/complete", body)
        if r.status_code == 200:
            for u in r.json().get("uploads", []):
                assert self.upload(who, u["url"], PHOTO2).status_code == 200
        return r

    def verify(self, action_id: str, who="VER1", result="effective", reason=""):
        return self.post(who, f"/api/v1/actions/{action_id}/verify", {"clientUuid": str(uuid.uuid4()), "result": result, "method": "re_inspection", "reason": reason, "capturedAt": now_iso()})


def run_job(ctx, fn, *args):
    """Run a job function `fn(conn, *args)` inside a transaction on the app's own event loop and pool."""
    async def go():
        async with db.tx() as c:
            return await fn(c, *args)
    return ctx.client.portal.call(go)


def run_async(ctx, fn, *args):
    """Run an async function on the app's event loop (uses the app's pool)."""
    return ctx.client.portal.call(fn, *args)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def run(coro):
    """Run a coroutine against the test database from a sync test (the app's pool is owned by the running TestClient loop)."""
    async def go():
        conn = await asyncpg.connect(os.environ["DATABASE_URL"])
        try:
            return await coro(conn)
        finally:
            await conn.close()
    return asyncio.run(go())


@pytest.fixture(scope="session")
def ctx():
    ids: dict = {}
    asyncio.run(_prepare(ids))
    from safeworks.app import app

    with TestClient(app) as client:
        c = Ctx(client, ids)
        for u in ["SO1", "SO2", "SH1", "VER1", "OWN1", "OWN2", "W1", "W2", "SOB", "HSE"]:
            r = c.login(u)
            assert r.status_code == 200, f"login {u}: {r.text}"
            c.tokens[u] = r.json()["token"]
        for u in ["HSE", "AUD", "SO1"]:
            r = c.login(u, PW, "admin")
            assert r.status_code == 200, f"admin login {u}: {r.text}"
            c.tokens[f"{u}-admin"] = r.json()["token"]
        yield c
