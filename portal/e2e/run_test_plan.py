"""Runs the API-checkable cases of portal/docs/TEST-PLAN.md against a real server on a fresh demo database.

    DATABASE_URL=postgres://safeworks:safeworks@127.0.0.1:55432/safeworks_plan \
    /srv/swvenv/bin/python portal/e2e/run_test_plan.py            # WIPES that database

Each case is registered under its test-plan ID. Results go to portal/docs/TEST-RESULTS.md (and out/plan-results.json).
UI-only, clock-dependent and job-timing cases are listed as "not automated"; the browser run (e2e-real.cjs) covers the
main screens.
"""
from __future__ import annotations

import asyncio
import base64
import email
import email.policy
import hashlib
import hmac
import io
import json
import os
import re
import socket
import socketserver
import struct
import subprocess
import sys
import threading
import time
import traceback
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import asyncpg
import httpx

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / "portal" / "server"
PLAN = ROOT / "portal" / "docs" / "TEST-PLAN.md"
RESULTS_MD = ROOT / "portal" / "docs" / "TEST-RESULTS.md"
OUT = Path(os.environ.get("PLAN_OUT", ROOT / "portal" / "e2e" / "out"))
DB = os.environ.get("DATABASE_URL", "postgres://safeworks:safeworks@127.0.0.1:55432/safeworks_plan")
PY = os.environ.get("PYTHON", sys.executable)
ADMIN_PW = "PlanAdmin2026x"
PW = "PlanDemo2026x"
PHOTO = (SERVER / "tests" / "fixtures" / "photo-1.jpg").read_bytes()
PHOTO2 = (SERVER / "tests" / "fixtures" / "photo-2.jpg").read_bytes()

CASES: list[tuple[str, callable]] = []
RESULTS: dict[str, tuple[str, str]] = {}


def case(*ids: str):
    def wrap(fn):
        CASES.append((ids, fn))
        return fn
    return wrap


class Fail(Exception):
    pass


def check(cond, msg=""):
    if not cond:
        raise Fail(msg or "check failed")


def now_iso(delta: timedelta = timedelta()) -> str:
    return (datetime.now(timezone.utc) + delta).isoformat()


def U() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------- database helpers
def sql(query: str, *args):
    async def go():
        c = await asyncpg.connect(DB)
        try:
            return await c.fetch(query, *args)
        finally:
            await c.close()
    return asyncio.run(go())


def sql1(query: str, *args):
    rows = sql(query, *args)
    return rows[0][0] if rows else None


# ---------------------------------------------------------------- server
def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def start_server() -> tuple[subprocess.Popen, str]:
    sql("drop schema if exists public cascade")
    sql("drop schema if exists v1_archive cascade")
    sql("create schema public")
    env = {**os.environ, "DATABASE_URL": DB, "SEED_ADMIN_PASSWORD": ADMIN_PW, "DEMO_PASSWORD": PW, "RUN_JOBS": "false", "USER_RATE_LIMIT": "100000",
           "STORAGE_DIR": str(OUT / "storage"), "EXPORTS_PER_HOUR": "10"}
    seed = subprocess.run([PY, "scripts/seed.py", "--demo"], cwd=SERVER, env=env, capture_output=True, text=True)
    if seed.returncode != 0:
        raise SystemExit(f"seed failed: {seed.stderr or seed.stdout}")
    port = free_port()
    env["PORT"] = str(port)
    log = open(OUT / "plan-server.log", "w")
    proc = subprocess.Popen([PY, "-m", "safeworks"], cwd=SERVER, env=env, stdout=log, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    for _ in range(60):
        try:
            if httpx.get(base + "/api/v1/health", timeout=1).status_code == 200:
                return proc, base
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    raise SystemExit("server did not start; see out/plan-server.log")


# ---------------------------------------------------------------- API client
class Api:
    def __init__(self, base: str):
        self.base = base
        self.c = httpx.Client(base_url=base + "/api/v1", timeout=60)
        self.tokens: dict[str, str] = {}
        self.secrets: dict[str, str] = {}
        self.last_step: dict[str, int] = {}

    def req(self, who: str | None, method: str, path: str, body=None, token: str | None = None, **kw) -> httpx.Response:
        h = kw.pop("headers", {})
        tok = token or (self.tokens.get(who) if who else None)
        if tok:
            h["authorization"] = f"Bearer {tok}"
        return self.c.request(method, path, json=body, headers=h, **kw)

    def get(self, who, path, **kw):
        return self.req(who, "GET", path, **kw)

    def post(self, who, path, body=None, **kw):
        return self.req(who, "POST", path, {} if body is None else body, **kw)

    def put(self, who, path, body=None, **kw):
        return self.req(who, "PUT", path, body, **kw)

    def delete(self, who, path, body=None, **kw):
        return self.req(who, "DELETE", path, body, **kw)

    def raw_login(self, login: str, password: str, kind: str = "field") -> httpx.Response:
        return self.c.post("/auth/login", json={"login": login, "password": password, "kind": kind, "deviceUuid": f"plan-{login}-{kind}", "platform": "plan", "appVersion": "2.0.0"})

    def totp(self, user: str, secret: str) -> str:
        key = base64.b32decode(secret.upper() + "=" * (-len(secret) % 8))
        while True:
            step = int(time.time() // 30)
            if self.last_step.get(user) != step:
                break
            time.sleep(1)
        self.last_step[user] = step
        mac = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
        o = mac[-1] & 15
        return f"{(struct.unpack('>I', mac[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}"

    def login(self, login: str, password: str = PW, kind: str = "field", name: str | None = None) -> str:
        r = self.raw_login(login, password, kind)
        if r.status_code != 200:
            raise Fail(f"login {login}: {r.status_code} {r.text[:200]}")
        d = r.json()
        tok = d["token"]
        if d.get("mfaRequired"):
            if not d.get("mfaEnrolled"):
                en = self.post(None, "/auth/mfa/enrol", token=tok).json()
                self.secrets[login] = en["secret"]
                r = self.post(None, "/auth/mfa/confirm", {"code": self.totp(login, en["secret"])}, token=tok)
            else:
                r = self.post(None, "/auth/mfa", {"code": self.totp(login, self.secrets[login])}, token=tok)
            if r.status_code != 200:
                raise Fail(f"mfa {login}: {r.status_code} {r.text[:200]}")
            tok = r.json()["token"]
        self.tokens[name or login] = tok
        self.put(name or login, "/me/preferences", {"language": "en", "digest": "daily", "quietHours": True})
        return tok


A: Api
IDS: dict[str, str] = {}


def uid(code: str) -> str:
    return IDS["u:" + code]


def site(code: str) -> str:
    return IDS["s:" + code]


def media_ref(data: bytes = PHOTO, purpose: str = "before") -> dict:
    return {"clientUuid": U(), "kind": "photo", "purpose": purpose, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "mime": "image/jpeg", "capturedAt": now_iso()}


def area_of(site_code: str, n: int = 0) -> str:
    return sql1("select a.id::text from areas a join sites s on s.id = a.site_id where s.code = $1 and a.deleted_at is null order by a.sort, a.code offset $2 limit 1", site_code, n)


def obs_body(site_code="TN1", **over) -> dict:
    b = {"clientUuid": U(), "siteId": site(site_code), "areaId": area_of(site_code), "capturedAt": now_iso(), "channel": "app", "reporterType": "employee",
         "anonymous": False, "type": "unsafe_condition", "categoryCodes": ["HOUSE"], "description": "Plan test: loose cable across the walkway", "descriptionLang": "en",
         "fixedOnSpot": False, "imminentDanger": False, "media": []}
    b.update(over)
    return b


def create_obs(who="WORKER-TN1-1", site_code="TN1", upload=True, **over) -> dict:
    r = A.post(who, "/observations", obs_body(site_code, **over))
    check(r.status_code in (200, 201), f"create obs: {r.status_code} {r.text[:200]}")
    d = r.json()
    if upload:
        for u in d.get("uploads", []):
            put_upload(who, u, PHOTO)
    return d


def put_upload(who: str, u: dict, data: bytes) -> httpx.Response:
    url = u["url"]
    url = url.split("/api/v1", 1)[1] if "/api/v1" in url else url
    return A.req(who, "PUT", url, None, content=data, headers={"content-type": "image/jpeg"})


def triage_body(decision="accept_assign", owner="OWN-TN1-1", l=2, s=3, **over) -> dict:
    b = {"clientUuid": U(), "decision": decision, "capturedAt": now_iso()}
    if decision in ("accept_assign", "accept_fixed_on_spot"):
        b.update({"categoryCodes": ["HOUSE"], "likelihood": l, "severity": s, "is3786Code": "B-2", "employerInvolvedId": IDS["own_company"]})
    if decision == "accept_assign":
        b["actions"] = [{"clientUuid": U(), "title": "Plan test: fix it", "problem": "Hazard", "actionType": "corrective", "controlLevel": "engineering", "ownerUserId": uid(owner)}]
    b.update(over)
    return b


def assign(obs_id: str, who="SO-TN1", owner="OWN-TN1-1", **over) -> dict:
    r = A.post(who, f"/observations/{obs_id}/triage", triage_body(owner=owner, **over))
    check(r.status_code == 200, f"triage: {r.status_code} {r.text[:200]}")
    return r.json()


def new_action(owner="OWN-TN1-1", reporter="WORKER-TN1-1") -> tuple[dict, str]:
    o = create_obs(reporter)
    d = assign(o["id"], owner=owner)
    return o, d["actions"][0]["id"]


def complete(aid: str, who="OWN-TN1-1", photos: int = 1, **over) -> httpx.Response:
    refs = [media_ref(PHOTO2, "after") for _ in range(photos)]
    body = {"clientUuid": U(), "completionNote": "Guard fitted and tagged", "causeAddressed": "Removed during unloading", "media": refs, "capturedAt": now_iso()}
    body.update(over)
    r = A.post(who, f"/actions/{aid}/complete", body)
    if r.status_code == 200:
        for u in r.json().get("uploads", []):
            put_upload(who, u, PHOTO2)
    return r


def verify(aid: str, who="VER-TN1", result="effective", reason="") -> httpx.Response:
    return A.post(who, f"/actions/{aid}/verify", {"clientUuid": U(), "result": result, "method": "re_inspection", "reason": reason, "capturedAt": now_iso()})


def xlsx_sheets(content: bytes) -> list[str]:
    z = zipfile.ZipFile(io.BytesIO(content))
    wb = z.read("xl/workbook.xml").decode()
    return re.findall(r'<sheet name="([^"]+)"', wb)


def st(r: httpx.Response, *codes):
    check(r.status_code in codes, f"expected {codes}, got {r.status_code}: {r.text[:200]}")
    return r


# ================================================================ Batch 1A: authentication and profile
@case("EHS-AUTH-001")
def _():
    r = st(A.raw_login("WORKER-TN1-1", PW), 200)
    check(r.json().get("token"))
    check(sql1("select count(*) from audit_log where action = 'login' and record_id = $1", uid("WORKER-TN1-1")) >= 1, "audit login row")


@case("EHS-AUTH-002")
def _():
    st(A.raw_login("worker-tn1-1", PW), 200)


@case("EHS-AUTH-003")
def _():
    st(A.raw_login("so-tn1@safeworks.local", PW), 200)


@case("EHS-AUTH-004", "EHS-AUTH-005")
def _():
    r1 = st(A.raw_login("WORKER-TN1-2", "WrongPass123"), 401)
    r2 = st(A.raw_login("NOBODY-999", "WrongPass123"), 401)
    check(r1.json()["error"] == r2.json()["error"], "same message for unknown and wrong password")
    check(sql1("select failed_attempts from users where employee_code = 'WORKER-TN1-2'") >= 1)


@case("EHS-AUTH-006", "EHS-AUTH-007", "EHS-AUTH-008")
def _():
    st(A.c.post("/auth/login", json={"login": "", "password": "x"}), 400, 401)
    st(A.raw_login("WORKER-TN1-1", "x" * 201), 400)
    st(A.raw_login("W" * 201, "x"), 400)


@case("EHS-AUTH-009", "EHS-AUTH-011", "EHS-AUTH-012")
def _():
    for _ in range(9):
        A.raw_login("WORKER-TN2-5", "WrongPass123")
    st(A.raw_login("WORKER-TN2-5", PW), 200)  # 011: success resets
    check(sql1("select failed_attempts from users where employee_code = 'WORKER-TN2-5'") == 0)
    for _ in range(10):
        A.raw_login("WORKER-TN2-5", "WrongPass123")
    r = st(A.raw_login("WORKER-TN2-5", PW), 429)
    check("minutes" in r.json()["error"].lower() or "min" in r.json()["error"].lower(), r.text)
    st(A.post("ADMIN01", f"/admin/users/{uid('WORKER-TN2-5')}/unlock"), 200)
    st(A.raw_login("WORKER-TN2-5", PW), 200)


@case("EHS-AUTH-014", "EHS-AUTH-016")
def _():
    tok = A.login("WORKER-TN2-4", name="w24")
    st(A.post("ADMIN01", f"/admin/users/{uid('WORKER-TN2-4')}/status", {"status": "suspended", "reason": "Plan test"}), 200)
    st(A.get(None, "/me", token=tok), 401)
    r = st(A.raw_login("WORKER-TN2-4", PW), 403)
    check("not active" in r.json()["error"], r.text)
    st(A.post("ADMIN01", f"/admin/users/{uid('WORKER-TN2-4')}/status", {"status": "active", "reason": "Plan test"}), 200)


@case("EHS-AUTH-015")
def _():
    st(A.post("ADMIN01", f"/admin/users/{uid('WORKER-TN2-3')}/status", {"status": "deactivated", "reason": "Plan test"}), 200)
    st(A.raw_login("WORKER-TN2-3", PW), 403)
    st(A.post("ADMIN01", f"/admin/users/{uid('WORKER-TN2-3')}/status", {"status": "active", "reason": "Plan test"}), 200)


@case("EHS-AUTH-017", "EHS-AUTH-018")
def _():
    st(A.raw_login("AUD01", PW, "admin"), 200)
    sql("update users set expires_at = now() - interval '1 day' where employee_code = 'AUD01'")
    try:
        r = st(A.raw_login("AUD01", PW, "admin"), 403)
        check("expired" in r.json()["error"], r.text)
    finally:
        sql("update users set expires_at = now() + interval '30 days' where employee_code = 'AUD01'")


@case("EHS-AUTH-019", "EHS-AUTH-020", "EHS-AUTH-021")
def _():
    for u in ("WORKER-TN1-1", "OWN-TN1-1", "VER-TN1"):
        r = st(A.raw_login(u, PW, "admin"), 403)
        check("console" in r.json()["error"].lower(), r.text)


@case("EHS-AUTH-022")
def _():
    st(A.get("WORKER-TN1-1", "/admin/users"), 401, 403)


@case("EHS-AUTH-023")
def _():
    r = st(A.raw_login("SO-TN1", PW, "admin"), 200)
    check(not r.json().get("mfaRequired"), "SSO should not need MFA by default")


@case("EHS-AUTH-024", "EHS-AUTH-029")
def _():
    r = st(A.raw_login("SH-TN1", PW, "field"), 200)
    check(r.json().get("mfaRequired") is True, "site head needs MFA on the phone too")
    A.login("SH-TN1", kind="admin", name="SH-TN1-admin")
    check(sql1("select mfa_enabled from users where employee_code = 'SH-TN1'") is True)


@case("EHS-AUTH-025")
def _():
    pre = A.raw_login("SH-TN1", PW, "admin").json()["token"]
    st(A.post(None, "/auth/mfa", {"code": "000000"}, token=pre), 401)


@case("EHS-AUTH-026")
def _():
    r = st(A.raw_login("HSE01", PW, "admin"), 200)
    check(r.json()["mfaRequired"] and r.json()["mfaEnrolled"], "second login asks only for the code")


@case("EHS-AUTH-027")
def _():
    pre = A.raw_login("ADMIN01", ADMIN_PW, "admin").json()["token"]
    r = st(A.get(None, "/dashboard", token=pre), 403)
    check(r.json()["code"] == "mfa_required", r.text)


@case("EHS-AUTH-030")
def _():
    st(A.post("ADMIN01", f"/admin/users/{uid('SH-TN2')}/mfa/reset"), 200)
    r = A.raw_login("SH-TN2", PW, "admin").json()
    check(r["mfaRequired"] and not r["mfaEnrolled"], str(r))


def _new_user(code: str, login_type="employee_code", role="reporter", site_code="TN1", **extra) -> dict:
    body = {"name": f"Plan {code}", "employeeCode": code, "loginType": login_type, "language": "en", "roles": [{"siteId": site(site_code), "role": role}], **extra}
    r = st(A.post("ADMIN01", "/admin/users", body), 201)
    return r.json()


@case("EHS-AUTH-031", "EHS-AUTH-032", "EHS-AUTH-033", "EHS-AUTH-034", "EHS-AUTH-037", "EHS-AUTH-038", "EHS-AUTH-046")
def _():
    u = _new_user("PLAN-E1")
    temp = u["tempPassword"]
    check(temp, "temporary password shown once")
    d = st(A.raw_login("PLAN-E1", temp), 200).json()
    check(d.get("mustChangePassword") is True)
    tok = d["token"]
    st(A.get(None, "/observations", token=tok), 403)  # 031: blocked until the change
    for bad in ("Abc1234", "abcdefghij", "1234567890"):  # 032-034
        st(A.post(None, "/auth/password", {"current": temp, "new": bad}, token=tok), 400)
    st(A.post(None, "/auth/password", {"current": "WrongCurrent1", "new": "GoodPass1234"}, token=tok), 400)  # 037
    st(A.post(None, "/auth/password", {"current": temp, "new": "A1" + "x" * 127}, token=tok), 400)  # 038
    st(A.post(None, "/auth/password", {"current": temp, "new": "GoodPass1234"}, token=tok), 200)
    # 046: admin reset gives a new temporary password that must be changed
    r = st(A.post("ADMIN01", f"/admin/users/{u['id']}/reset-password"), 200)
    d = st(A.raw_login("PLAN-E1", r.json()["tempPassword"]), 200).json()
    check(d.get("mustChangePassword") is True)


@case("EHS-AUTH-035", "EHS-AUTH-036", "EHS-AUTH-039")
def _():
    t1 = A.login("SO-TN3", name="so3a")
    t2 = A.login("SO-TN3", name="so3b")
    st(A.post("so3a", "/auth/password", {"current": PW, "new": "Short12345a"}), 400)  # 11 characters, staff
    st(A.post("so3a", "/auth/password", {"current": PW, "new": "NewStaffPass2026"}), 200)
    st(A.get(None, "/me", token=t2), 401)  # other session ended
    st(A.get(None, "/me", token=t1), 200)
    check(sql1("select count(*) from audit_log where action = 'password_reset' and record_id = $1", uid("SO-TN3")) >= 1)


@case("EHS-AUTH-040", "EHS-AUTH-042")
def _():
    u = _new_user("PLAN-EN1", login_type="enrolment_code")
    code = u["enrolmentCode"]
    check(re.match(r"^[A-Z0-9]{4}-[A-Z0-9]{4}$", code or ""), str(code))
    r = st(A.c.post("/auth/enrol", json={"code": code, "newPassword": "Worker2026a", "deviceUuid": "plan-en1"}), 200)
    check(r.json().get("token"))
    st(A.c.post("/auth/enrol", json={"code": code, "newPassword": "Worker2026b"}), 400, 401, 404)


@case("EHS-AUTH-041")
def _():
    u = _new_user("PLAN-EN2", login_type="enrolment_code")
    sql("update enrolment_codes set expires_at = now() - interval '1 minute' where user_id = $1::uuid", u["id"])
    st(A.c.post("/auth/enrol", json={"code": u["enrolmentCode"], "newPassword": "Worker2026a"}), 400, 401, 404)


@case("EHS-AUTH-043", "EHS-AUTH-044", "EHS-AUTH-045")
def _():
    A.login("SO-TN1", kind="admin", name="SO-TN1-admin")
    r = st(A.post("SO-TN1-admin", f"/admin/users/{uid('WORKER-TN1-3')}/enrolment-code"), 200)
    check(re.match(r"^[A-Z0-9]{4}-[A-Z0-9]{4}$", r.json()["code"]))
    st(A.post("SO-TN1-admin", f"/admin/users/{uid('WORKER-TN2-1')}/enrolment-code"), 403, 404)
    st(A.post("AUD01-admin", f"/admin/users/{uid('WORKER-TN1-3')}/enrolment-code"), 403)


@case("EHS-AUTH-047")
def _():
    st(A.post("HSE01", f"/admin/users/{uid('WORKER-TN1-3')}/reset-password"), 403)


@case("EHS-AUTH-049")
def _():
    tok = A.login("WORKER-TN1-4", name="w14")
    st(A.post("w14", "/auth/logout"), 200)
    st(A.get(None, "/me", token=tok), 401)
    check(sql1("select count(*) from audit_log where action = 'logout' and record_id = $1", uid("WORKER-TN1-4")) >= 1)


@case("EHS-AUTH-052")
def _():
    exp = datetime.fromisoformat(A.raw_login("WORKER-TN1-5", PW).json()["expiresAt"].replace("Z", "+00:00"))
    hours = (exp - datetime.now(timezone.utc)).total_seconds() / 3600
    check(700 < hours <= 721, f"{hours:.0f} hours")


@case("EHS-AUTH-053")
def _():
    tok = A.tokens["WORKER-TN1-1"]
    st(A.c.get("/me", params={"access_token": tok}), 401)


@case("EHS-AUTH-054")
def _():
    tok = A.login("WORKER-TN1-5", name="w15")
    dev = sql1("select id::text from devices where user_id = $1::uuid order by last_seen_at desc nulls last limit 1", uid("WORKER-TN1-5"))
    st(A.post("ADMIN01", f"/admin/users/{uid('WORKER-TN1-5')}/devices/{dev}/revoke"), 200)
    st(A.get(None, "/me", token=tok), 401)


@case("EHS-AUTH-055")
def _():
    acts = {r[0] for r in sql("select distinct action from audit_log where action in ('login','login_failed','logout','password_reset')")}
    check(acts == {"login", "login_failed", "logout", "password_reset"}, str(acts))


@case("EHS-AUTH-056")
def _():
    me = st(A.get("WORKER-TN1-2", "/me"), 200).json()
    check(me["privacyNoticeVersion"] >= 1)
    st(A.post("WORKER-TN1-2", "/me/privacy-ack", {"version": me["privacyNoticeVersion"]}), 200)
    check(A.get("WORKER-TN1-2", "/me").json()["privacyAckedVersion"] == me["privacyNoticeVersion"])


@case("EHS-AUTH-057", "EHS-AUTH-058", "EHS-AUTH-059")
def _():
    st(A.put("WORKER-TN1-2", "/me/preferences", {"language": "ta", "digest": "weekly", "quietHours": False}), 200)
    me = A.get("WORKER-TN1-2", "/me").json()
    check(me["language"] == "ta" and me["preferences"]["digest"] == "weekly" and me["preferences"]["quietHours"] is False, str(me["preferences"]))
    st(A.put("WORKER-TN1-2", "/me/preferences", {"language": "fr", "digest": "daily", "quietHours": True}), 400)
    st(A.put("WORKER-TN1-2", "/me/preferences", {"language": "en", "digest": "off", "quietHours": True}), 200)
    check(A.get("WORKER-TN1-2", "/me").json()["preferences"]["digest"] == "off")
    A.put("WORKER-TN1-2", "/me/preferences", {"language": "en", "digest": "daily", "quietHours": True})


@case("EHS-AUTH-061")
def _():
    st(A.post("SO-TN1", "/me/notifications/read-all"), 200)
    n = A.get("SO-TN1", "/me/notifications").json()
    items = n["items"] if isinstance(n, dict) else n
    check(all(x.get("readAt") for x in items), "all read")


@case("EHS-AUTH-063")
def _():
    sql("insert into user_site_roles (user_id, site_id, role) values ($1::uuid, $2::uuid, 'site_safety_officer') on conflict do nothing", uid("SO-TN2"), site("TN3"))
    try:
        A.login("SO-TN2", name="so2x")
        codes = {s["code"] for s in A.get("so2x", "/me").json()["sites"]}
        check({"TN2", "TN3"} <= codes, str(codes))
    finally:
        sql("delete from user_site_roles where user_id = $1::uuid and site_id = $2::uuid", uid("SO-TN2"), site("TN3"))


@case("EHS-AUTH-066", "EHS-AUTH-067")
def _():
    st(A.c.get(f"/public/qr/{IDS['qr:TN1']}"), 200)
    st(A.c.get("/insights"), 401)
    st(A.c.get("/observations"), 401)


# ================================================================ Batch 1B: dashboards
@case("EHS-DSH-001")
def _():
    d = st(A.get("ADMIN01", "/dashboard"), 200).json()
    check(len(d["kpis"]) == 11 and all("n" in k for k in d["kpis"]), str(len(d["kpis"])))
    check(len(d["siteIds"]) == 5)


@case("EHS-DSH-002")
def _():
    d = st(A.get("HSE01", "/dashboard", params={"siteIds": site("KA1")}), 200).json()
    check(d["siteIds"] == [site("KA1")])


@case("EHS-DSH-003")
def _():
    d = st(A.get("SH-TN1-admin", "/dashboard"), 200).json()
    check(d["siteIds"] == [site("TN1")], str(d["siteIds"]))


@case("EHS-DSH-004", "EHS-DSH-005")
def _():
    st(A.get("SO-TN1", "/dashboard", params={"siteIds": site("TN2")}), 404)
    st(A.get("SO-TN1", "/dashboard", params={"siteIds": f"{site('TN1')},{site('TN2')}"}), 404)


@case("EHS-DSH-006")
def _():
    st(A.get("AUD01-admin", "/dashboard"), 200)


@case("EHS-DSH-007", "EHS-DSH-008", "EHS-DSH-009", "EHS-DSH-010")
def _():
    st(A.get("ADMIN01", "/dashboard", params={"from": "2026-08-01", "to": "2026-08-31"}), 200)
    st(A.get("ADMIN01", "/dashboard", params={"from": "2026-13-40"}), 400)
    a = st(A.get("ADMIN01", "/dashboard", params={"from": "2026-01-01", "to": "2026-12-31"}), 200).json()
    b = st(A.get("ADMIN01", "/dashboard", params={"from": "2026-12-31", "to": "2026-01-01"}), 200).json()
    check([k["value"] for k in a["kpis"]] == [k["value"] for k in b["kpis"]], "swapped dates give the same figures")
    st(A.get("ADMIN01", "/dashboard", params={"from": "2027-01-01", "to": "2027-01-31"}), 200)


@case("EHS-DSH-011", "EHS-DSH-012", "EHS-DSH-013")
def _():
    d = A.get("SO-TN1", "/dashboard").json()
    k = {x["key"]: x["value"] for x in d["kpis"]}
    open_n = A.get("SO-TN1", "/actions", params={"status": "open,in_progress,reopened,disputed", "pageSize": 1}).json()["total"]
    over_n = A.get("SO-TN1", "/actions", params={"overdue": "1", "pageSize": 1}).json()["total"]
    back_n = A.get("SO-TN1", "/observations", params={"status": "submitted,returned", "pageSize": 1}).json()["total"]
    check(k["open_actions"] == open_n, f"open {k['open_actions']} vs {open_n}")
    check(k["overdue_actions"] == over_n, f"overdue {k['overdue_actions']} vs {over_n}")
    check(k["triage_backlog"] == back_n, f"backlog {k['triage_backlog']} vs {back_n}")


@case("EHS-DSH-014", "EHS-DSH-016")
def _():
    k = {x["key"]: x for x in A.get("ADMIN01", "/dashboard").json()["kpis"]}
    check("original due" in k["on_time_closure"]["formula"] and "worker count" in k["participation"]["formula"])


@case("EHS-DSH-025", "EHS-DSH-043")
def _():
    d = st(A.get("ADMIN01", "/insights", params={"level": "site"}), 200).json()
    check(len(d["byDepartment"]) == 5, str(len(d["byDepartment"])))
    check("reporterName" not in json.dumps(d) and "ownerName" not in json.dumps(d), "no names")


@case("EHS-DSH-029", "EHS-DSH-032")
def _():
    for who in ("ADMIN01", "AUD01-admin"):
        r = st(A.get(who, "/exports/report.xlsx"), 200)
        check(xlsx_sheets(r.content) == ["Summary", "Reports", "Actions", "Departments"], str(xlsx_sheets(r.content)))
    check(sql1("select count(*) from audit_log where action = 'export' and record_id = 'xlsx' and actor_user_id = $1::uuid", uid("AUD01")) >= 1)


@case("EHS-DSH-030")
def _():
    r = st(A.get("SH-TN1-admin", "/exports/report.xlsx"), 200)
    s1 = zipfile.ZipFile(io.BytesIO(r.content)).read("xl/worksheets/sheet1.xml").decode()
    check(">TN1<" in s1 and ">TN2<" not in s1, "summary lists TN1 only")
    s2 = zipfile.ZipFile(io.BytesIO(r.content)).read("xl/worksheets/sheet2.xml").decode()
    check("TN2-OBS" not in s2, "no TN2 rows")


@case("EHS-DSH-031", "EHS-RPT-016")
def _():
    A.login("SO-KA2", kind="admin", name="soka2")
    codes = [A.get("soka2", "/exports/observations.csv").status_code for _ in range(11)]
    check(codes[:10] == [200] * 10 and codes[10] == 429, str(codes))


@case("EHS-DSH-033", "EHS-RPT-012")
def _():
    for p in ("observations.csv", "observations.xlsx", "actions.csv", "actions.xlsx", "inspections.csv", "inspections.xlsx", "report.xlsx"):
        st(A.get("VER-TN1", f"/exports/{p}"), 403)


@case("EHS-DSH-034", "EHS-RPT-010", "EHS-RPT-011")
def _():
    for who in ("WORKER-TN1-1", "OWN-TN1-1"):
        for p in ("observations.csv", "observations.xlsx", "actions.csv", "actions.xlsx", "inspections.csv", "inspections.xlsx", "report.xlsx"):
            st(A.get(who, f"/exports/{p}"), 403)


@case("EHS-DSH-037", "EHS-DSH-041")
def _():
    me = st(A.get("WORKER-TN1-1", "/insights", params={"level": "me"}), 200).json()
    check(me["level"] == "me")
    dep = st(A.get("WORKER-TN1-1", "/insights", params={"level": "department"}), 200).json()
    check(dep["departmentName"]["en"] == "Civil works", str(dep["departmentName"]))


@case("EHS-DSH-038", "EHS-DSH-042")
def _():
    before_me = A.get("WORKER-TN1-1", "/insights", params={"level": "me"}).json()["reports"]["total"]
    before_dep = A.get("WORKER-TN1-1", "/insights", params={"level": "department"}).json()["reports"]["total"]
    create_obs("WORKER-TN1-1", anonymous=True, description="Plan anonymous for charts")
    check(A.get("WORKER-TN1-1", "/insights", params={"level": "me"}).json()["reports"]["total"] == before_me + 1)
    check(A.get("WORKER-TN1-1", "/insights", params={"level": "department"}).json()["reports"]["total"] == before_dep)


@case("EHS-DSH-040")
def _():
    A.login("AUD01", name="aud-field")
    st(A.get("aud-field", "/insights", params={"level": "department"}), 404)


@case("EHS-DSH-049")
def _():
    a = A.get("SO-TN1", "/insights", params={"level": "site", "from": (datetime.now() - timedelta(days=89)).strftime("%Y-%m-%d")}).json()
    b = A.get("SO-TN1", "/insights", params={"level": "site", "from": (datetime.now() - timedelta(days=364)).strftime("%Y-%m-%d")}).json()
    check(a["bucket"] == "week" and b["bucket"] == "month", f"{a['bucket']} {b['bucket']}")


@case("EHS-DSH-051")
def _():
    d = st(A.get("HSE01", "/insights", params={"level": "site", "siteId": site("KA1")}), 200).json()
    check(d["siteIds"] == [site("KA1")])


@case("EHS-DSH-052")
def _():
    st(A.get("SO-TN1", "/insights", params={"level": "site", "siteId": site("TN2")}), 404)


@case("EHS-DSH-054")
def _():
    d = A.get("SO-TN1", "/insights", params={"level": "site", "siteId": site("TN1")}).json()
    triaged = sql1("""select count(*) from observations where site_id = $1::uuid and risk_band is not null and status not in ('discarded','merged')
                      and received_at > now() - interval '90 days'""", site("TN1"))
    check(sum(x["count"] for x in d["byBand"]) == triaged, f"{sum(x['count'] for x in d['byBand'])} vs {triaged}")


@case("EHS-DSH-058", "EHS-DSH-059")
def _():
    check(st(A.get("ADMIN01", "/insights", params={"level": "everything"}), 200).json()["level"] == "me")
    st(A.c.get("/insights"), 401)


# ================================================================ Batch 2: observations
@case("EHS-OBS-011")
def _():
    b = obs_body()
    b.pop("type")
    st(A.post("WORKER-TN1-1", "/observations", b), 400)


@case("EHS-OBS-014", "EHS-OBS-016")
def _():
    st(A.post("WORKER-TN1-1", "/observations", obs_body(categoryCodes=[])), 400)


@case("EHS-OBS-015")
def _():
    st(A.post("WORKER-TN1-1", "/observations", obs_body(categoryCodes=["NOT_A_CODE"])), 400)


@case("EHS-OBS-017", "EHS-OBS-018")
def _():
    o = create_obs(description="x" * 500)
    check(len(A.get("WORKER-TN1-1", f"/observations/{o['id']}").json()["description"]) == 500)
    st(A.post("WORKER-TN1-1", "/observations", obs_body(description="x" * 501)), 400)


@case("EHS-OBS-019")
def _():
    st(A.post("WORKER-TN1-1", "/observations", obs_body(description="")), 400)


@case("EHS-OBS-020")
def _():
    o = create_obs(capturedAt=now_iso(timedelta(days=1)))
    r = sql("select captured_at, received_at from observations where id = $1::uuid", o["id"])[0]
    check(r["captured_at"] == r["received_at"], "future time replaced by the received time")


@case("EHS-OBS-021", "EHS-OBS-022")
def _():
    o = create_obs(capturedAt="2020-01-01T10:00:00+05:30")
    check(sql1("select extract(year from captured_at)::int from observations where id = $1::uuid", o["id"]) == 2020)
    st(A.post("WORKER-TN1-1", "/observations", obs_body(capturedAt="yesterday")), 400)


@case("EHS-OBS-023", "EHS-OBS-024")
def _():
    o = create_obs(description="சாரக்கட்டில் நடுத் தண்டவாளம் இல்லை", descriptionLang="ta")
    check(A.get("WORKER-TN1-1", f"/observations/{o['id']}").json()["description"].startswith("சாரக்கட்டில்"))
    s = "⚠️ <script>alert(1)</script>"
    o = create_obs(description=s)
    check(A.get("WORKER-TN1-1", f"/observations/{o['id']}").json()["description"] == s, "stored as plain text")


@case("EHS-OBS-026")
def _():
    o = create_obs(imminentDanger=True, description="Plan: live cable in water")
    n = sql1("select count(*) from notifications where record_id = $1 and critical and recipient_user_id = $2::uuid", o["id"], uid("SO-TN1"))
    check(n >= 1, "critical alert to the officer")


@case("EHS-OBS-029", "EHS-OBS-030")
def _():
    st(A.post("WORKER-TN1-1", "/observations", obs_body(fixedOnSpot=True, immediateAction="")), 400)


@case("EHS-OBS-031", "EHS-OBS-032")
def _():
    create_obs(fixedOnSpot=True, immediateAction="x" * 2000)
    st(A.post("WORKER-TN1-1", "/observations", obs_body(fixedOnSpot=True, immediateAction="x" * 2001)), 400)


@case("EHS-OBS-033")
def _():
    o = create_obs(anonymous=True)
    check(sql1("select reporter_user_id from observations where id = $1::uuid", o["id"]) is None)
    check(sql1("select count(*) from observation_reporter_seals where observation_id = $1::uuid", o["id"]) == 1)


@case("EHS-OBS-034")
def _():
    emp = sql1("select p.employer_id::text from users u join people p on p.id = u.person_id where u.employee_code = 'WORKER-TN1-1'")
    o = create_obs()
    check(sql1("select employer_involved_id::text from observations where id = $1::uuid", o["id"]) == emp)


@case("EHS-OBS-045", "EHS-OBS-046", "EHS-OBS-047", "EHS-OBS-048", "EHS-OBS-049")
def _():
    st(A.post("WORKER-TN1-1", "/observations", obs_body("TN2")), 404)
    st(A.post("WORKER-TN1-1", "/observations", obs_body(areaId=area_of("TN2"))), 400)
    asset_tn2 = sql1("select a.id::text from assets a join sites s on s.id = a.site_id where s.code = 'TN2' limit 1")
    if asset_tn2:
        st(A.post("WORKER-TN1-1", "/observations", obs_body(assetId=asset_tn2)), 404)
    st(A.post("WORKER-TN1-1", "/observations", obs_body(areaId=None, lat=None, lng=None)), 400)
    st(A.post("WORKER-TN1-1", "/observations", obs_body(areaId=None, lat=13.0827, lng=80.2707)), 200, 201)


@case("EHS-OBS-050")
def _():
    b = obs_body()
    r1 = st(A.post("WORKER-TN1-1", "/observations", b), 200, 201)
    r2 = st(A.post("WORKER-TN1-1", "/observations", b), 200, 201)
    check(r1.json()["caseNo"] == r2.json()["caseNo"])


@case("EHS-OBS-051")
def _():
    st(A.post("WORKER-TN1-1", "/observations", obs_body(severityLevel=5)), 400)


@case("EHS-OBS-052", "EHS-OBS-053", "EHS-OBS-054", "EHS-OBS-055")
def _():
    for who in ("OWN-TN1-1", "VER-TN1", "SO-TN1"):
        create_obs(who)
    st(A.post("aud-field", "/observations", obs_body()), 403)


@case("EHS-OBS-056")
def _():
    a = create_obs()
    b = create_obs("WORKER-KA1-1", "KA1")
    check(re.match(r"^TN1-OBS-2026-\d{5}$", a["caseNo"]) and re.match(r"^KA1-OBS-2026-\d{5}$", b["caseNo"]), f"{a['caseNo']} {b['caseNo']}")


@case("EHS-OBS-060", "EHS-OBS-072")
def _():
    o = create_obs(media=[media_ref()], upload=False)
    u = o["uploads"][0]
    st(put_upload("WORKER-TN1-1", u, PHOTO), 200)
    st(put_upload("WORKER-TN1-1", u, PHOTO), 200)
    check(sql1("select hash_match from media where client_uuid = $1::uuid", u["clientUuid"]) is True)


@case("EHS-OBS-063", "EHS-OBS-124")
def _():
    st(A.post("WORKER-TN1-1", "/observations", obs_body(media=[media_ref() for _ in range(11)])), 400)


@case("EHS-OBS-066", "EHS-OBS-067", "EHS-OBS-069")
def _():
    o = create_obs(media=[media_ref(), media_ref(), media_ref()], upload=False)
    us = o["uploads"]
    st(A.req("WORKER-TN1-1", "PUT", us[0]["url"].split("/api/v1", 1)[-1], content=b"%PDF-1.4 fake", headers={"content-type": "image/jpeg"}), 400)
    st(A.req("WORKER-TN1-1", "PUT", us[1]["url"].split("/api/v1", 1)[-1], content=b"MZ\x90\x00 exe", headers={"content-type": "image/jpeg"}), 400)
    st(A.req("WORKER-TN1-1", "PUT", us[2]["url"].split("/api/v1", 1)[-1], content=b"", headers={"content-type": "image/jpeg"}), 400)


@case("EHS-OBS-068")
def _():
    o = create_obs(media=[media_ref()], upload=False)
    big = PHOTO + b"\0" * (11 * 1024 * 1024)
    st(A.req("WORKER-TN1-1", "PUT", o["uploads"][0]["url"].split("/api/v1", 1)[-1], content=big, headers={"content-type": "image/jpeg"}), 400, 413)


@case("EHS-OBS-070")
def _():
    o = create_obs(media=[media_ref(PHOTO)], upload=False)
    put_upload("WORKER-TN1-1", o["uploads"][0], PHOTO2)
    check(sql1("select hash_match from media where client_uuid = $1::uuid", o["uploads"][0]["clientUuid"]) is False)


@case("EHS-OBS-071")
def _():
    o = create_obs(media=[media_ref()], upload=False)
    st(put_upload("WORKER-TN1-2", o["uploads"][0], PHOTO), 400, 403, 404)


@case("EHS-OBS-075")
def _():
    ref = {**media_ref(), "kind": "audio", "purpose": "voice", "mime": "audio/webm", "durationS": 75}
    st(A.post("WORKER-TN1-1", "/observations", obs_body(media=[ref])), 400)


def sync_push(who: str, commands: list[dict]) -> list[dict]:
    r = st(A.post(who, "/sync/push", {"deviceId": f"plan-{who}", "appVersion": "2.0.0", "commands": commands}), 200)
    return r.json()["results"]


@case("EHS-OBS-083")
def _():
    cmds = [{"commandId": U(), "entityType": "observation", "op": "create", "entityClientUuid": (b := obs_body())["clientUuid"], "payload": b} for _ in range(5)]
    res = sync_push("WORKER-TN1-1", cmds)
    check([r["status"] for r in res] == ["applied"] * 5 and len({r["caseNo"] for r in res}) == 5, str(res)[:300])


@case("EHS-OBS-090", "EHS-OBS-195")
def _():
    b = obs_body()
    c1 = U()
    cmds = [{"commandId": c1, "entityType": "observation", "op": "create", "entityClientUuid": b["clientUuid"], "payload": b}]
    res = sync_push("SO-TN1", cmds)
    server_id = res[0]["serverId"]
    t = triage_body()
    res2 = sync_push("SO-TN1", [{"commandId": U(), "entityType": "observation", "op": "triage", "entityClientUuid": t["clientUuid"], "dependsOn": [c1], "payload": {"observationId": server_id, **t}}])
    check(res2[0]["status"] == "applied", str(res2))
    check(A.get("SO-TN1", f"/observations/{server_id}").json()["status"] == "action_assigned")


@case("EHS-OBS-091")
def _():
    o = create_obs()
    assign(o["id"])
    t = triage_body(decision="discard", reasonCode="test_entry", reasonText="dup")
    res = sync_push("SO2-TN1" if "SO2-TN1" in A.tokens else "SH-TN1-field", [{"commandId": U(), "entityType": "observation", "op": "triage", "entityClientUuid": t["clientUuid"], "payload": {"observationId": o["id"], **t}}])
    check(res[0]["status"] == "conflict_saved_as_comment", str(res))


@case("EHS-OBS-095", "EHS-OBS-096", "EHS-OBS-097")
def _():
    o = create_obs(anonymous=True, description="Plan anonymous detail")
    mine = A.get("WORKER-TN1-1", "/observations", params={"mine": "1", "pageSize": 200}).json()["items"]
    check(any(x["id"] == o["id"] for x in mine), "own anonymous report in Mine")
    for who in ("SO-TN1", "HSE01"):
        d = A.get(who, f"/observations/{o['id']}").json()
        check(d.get("reporterName") is None and "WORKER-TN1-1" not in json.dumps(d), f"{who} sees no name")


@case("EHS-OBS-098")
def _():
    create_obs(anonymous=True, description="PLANANONEXPORT")
    text = A.get("SH-TN1-admin", "/exports/observations.csv").text
    line = next(l for l in text.splitlines() if "PLANANONEXPORT" in l)
    check("WORKER-TN1-1" not in line and "Civil" not in line, line)


@case("EHS-OBS-099", "EHS-OBS-100", "EHS-OBS-101", "EHS-OBS-102")
def _():
    o, aid = new_action()
    check(A.get("SO-TN1", f"/observations/{o['id']}").json().get("reporterName"), "officer sees the name")
    for who in ("ADMIN01", "AUD01-admin", "VER-TN1"):
        d = st(A.get(who, f"/observations/{o['id']}"), 200).json()
        check(d.get("reporterName") is None, f"{who} must not see the name")


@case("EHS-OBS-104")
def _():
    o = create_obs(anonymous=True)
    st(A.post("SO-TN1", f"/observations/{o['id']}/triage", triage_body("return_to_reporter", question="Which floor?")), 400)


@case("EHS-OBS-105")
def _():
    o = create_obs(anonymous=True)
    check(sql1("select reporter_department_id from observations where id = $1::uuid", o["id"]) is None)


def qr_body(**over) -> dict:
    b = {"clientUuid": U(), "type": "unsafe_condition", "categoryCodes": ["HOUSE"], "description": "QR plan report", "descriptionLang": "en", "anonymous": False,
         "name": "Visitor Plan", "phone": "9876543210", "reporterType": "visitor", "capturedAt": now_iso(), "media": []}
    b.update(over)
    return b


def qr_post(token: str, body: dict) -> httpx.Response:
    sql("delete from public_rate_counters")
    return A.c.post(f"/public/qr/{token}/observations", json=body)


@case("EHS-OBS-110", "EHS-OBS-112", "EHS-OBS-113", "EHS-OBS-116", "EHS-OBS-117", "EHS-WF7-01")
def _():
    info = st(A.c.get(f"/public/qr/{IDS['qr:TN1']}"), 200).json()
    check("site" in json.dumps(info).lower())
    r = st(qr_post(IDS["qr:TN1"], qr_body()), 200, 201).json()
    check(r.get("caseNo") and r.get("statusUrl"), str(r))
    check(sql1("select reporter_contact_enc <> '' from observations where case_no = $1", r["caseNo"]) is True, "contact stored encrypted")
    m = re.search(r"/q/status/([^?]+)\?s=(.+)$", r["statusUrl"])
    check(m, r["statusUrl"])
    path = f"/public/status/{m.group(1)}?s={m.group(2)}"
    s = A.c.get(path)
    check(s.status_code == 200 and "status" in s.text, s.text[:200])
    bad = path[:-1] + ("A" if path[-1] != "A" else "B")
    st(A.c.get(bad), 404)
    IDS["qrcase"] = r["caseNo"]
    IDS["qrstatus"] = path


@case("EHS-OBS-114")
def _():
    r = st(qr_post(IDS["qr:TN1"], qr_body(anonymous=True, name="Should not store", phone="9999999999")), 200, 201).json()
    check(sql1("select reporter_contact_enc from observations where case_no = $1", r["caseNo"]) == "")


@case("EHS-OBS-119", "EHS-OBS-120", "EHS-OBS-125")
def _():
    st(A.c.get("/public/qr/AAAAAAAA"), 404)
    st(qr_post(IDS["qr:TN1"], qr_body(honeypot="bot")), 400)
    st(qr_post(IDS["qr:TN1"], qr_body(description="", media=[])), 400)


@case("EHS-OBS-121")
def _():
    sql("delete from public_rate_counters")
    codes = [A.c.post(f"/public/qr/{IDS['qr:TN1']}/observations", json=qr_body()).status_code for _ in range(60)]
    check(429 in codes and codes[0] in (200, 201), str(codes[-5:]))
    sql("delete from public_rate_counters")


@case("EHS-OBS-130", "EHS-OBS-131", "EHS-OBS-132")
def _():
    items = A.get("WORKER-TN1-1", "/observations", params={"pageSize": 200}).json()["items"]
    check(all(x["mine"] for x in items), "worker list only own")
    other = create_obs("WORKER-TN1-2")
    st(A.get("WORKER-TN1-1", f"/observations/{other['id']}"), 404)


@case("EHS-OBS-133", "EHS-OBS-134")
def _():
    o, aid = new_action(owner="OWN-TN1-1", reporter="WORKER-TN1-2")
    st(A.get("OWN-TN1-1", f"/observations/{o['id']}"), 200)
    other = create_obs("WORKER-TN1-2")
    st(A.get("OWN-TN1-1", f"/observations/{other['id']}"), 404)


@case("EHS-OBS-144", "EHS-OBS-145", "EHS-WF3-01", "EHS-WF3-10")
def _():
    o = create_obs("WORKER-TN2-1", "TN2")
    IDS["tn2obs"] = o["id"]
    st(A.get("SO-TN1", f"/observations/{o['id']}"), 404)
    st(A.get("SO-TN1", "/observations", params={"siteId": site("TN2")}), 404)
    st(A.get("SO-TN1", "/actions", params={"siteId": site("TN2")}), 404)


@case("EHS-OBS-146", "EHS-OBS-147")
def _():
    for code in ("TN1", "TN2", "TN3", "KA1", "KA2"):
        st(A.get("HSE01", "/observations", params={"siteId": site(code)}), 200)
    st(A.get("VER-TN1", "/observations", params={"siteId": site("TN1")}), 200)


@case("EHS-OBS-149")
def _():
    a = create_obs(description="Plan duplicate A")
    b = create_obs(description="Plan duplicate B")
    d = st(A.get("SO-TN1", f"/observations/{b['id']}/duplicates"), 200).json()
    items = d if isinstance(d, list) else d.get("items", d.get("duplicates", []))
    check(any(x.get("id") == a["id"] for x in items), "A listed as possible duplicate of B")


@case("EHS-OBS-151", "EHS-OBS-152", "EHS-OBS-153", "EHS-WF3-02")
def _():
    o = create_obs()
    st(A.post("WORKER-TN1-1", f"/observations/{o['id']}/triage", triage_body()), 403)
    st(A.post("VER-TN1", f"/observations/{o['id']}/triage", triage_body()), 403)
    st(A.post("SO-TN1", f"/observations/{IDS['tn2obs']}/triage", triage_body()), 404)


@case("EHS-OBS-155", "EHS-OBS-156", "EHS-OBS-157", "EHS-OBS-158", "EHS-OBS-159", "EHS-OBS-160")
def _():
    o = create_obs()
    oid = o["id"]
    st(A.post("SO-TN1", f"/observations/{oid}/triage", triage_body(likelihood=None, severity=None)), 400)
    st(A.post("SO-TN1", f"/observations/{oid}/triage", triage_body(severity=None)), 400)
    st(A.post("SO-TN1", f"/observations/{oid}/triage", triage_body(categoryCodes=[])), 400)
    st(A.post("SO-TN1", f"/observations/{oid}/triage", triage_body(is3786Code="")), 400)
    sql("update observations set employer_involved_id = null where id = $1::uuid", oid)
    st(A.post("SO-TN1", f"/observations/{oid}/triage", triage_body(employerInvolvedId=None)), 400)
    st(A.post("SO-TN1", f"/observations/{oid}/triage", triage_body(actions=[])), 400)


@case("EHS-OBS-162", "EHS-OBS-163")
def _():
    o = create_obs()
    t = triage_body()
    t["actions"].append({"clientUuid": U(), "title": "Second", "problem": "p", "actionType": "preventive", "controlLevel": "administrative", "ownerUserId": uid("OWN-TN1-2")})
    d = st(A.post("SO-TN1", f"/observations/{o['id']}/triage", t), 200).json()
    check(d["status"] == "action_assigned" and len(d["actions"]) == 2)
    a = A.get("OWN-TN1-1", f"/actions/{d['actions'][0]['id']}").json()
    check(re.match(r"^TN1-ACT-2026-\d{5}$", a["caseNo"]))
    check(a["departmentId"] == sql1("select department_id::text from people p join users u on u.person_id = p.id where u.employee_code = 'OWN-TN1-1'"))


@case("EHS-OBS-164", "EHS-OBS-165", "EHS-OBS-166", "EHS-WF4-04")
def _():
    o = create_obs()
    st(A.post("SO-TN1", f"/observations/{o['id']}/triage", triage_body(l=5, s=5)), 400)
    d = create_obs(imminentDanger=True)
    st(A.post("SO-TN1", f"/observations/{d['id']}/triage", triage_body(l=2, s=2)), 400)
    r = st(A.post("SO-TN1", f"/observations/{o['id']}/triage", triage_body(l=5, s=5, interimControl="Area barricaded")), 200).json()
    a = A.get("OWN-TN1-1", f"/actions/{r['actions'][0]['id']}").json()
    hours = (datetime.fromisoformat(a["dueAt"].replace("Z", "+00:00")) - datetime.now(timezone.utc)).total_seconds() / 3600
    check(a["band"] == "extreme" and hours <= 73, f"{a['band']} {hours:.0f}h")


@case("EHS-OBS-167")
def _():
    o = create_obs(fixedOnSpot=True, immediateAction="Barricaded")
    d = st(A.post("SO-TN1", f"/observations/{o['id']}/triage", triage_body("accept_fixed_on_spot")), 200).json()
    check(d["status"] == "closed")


@case("EHS-OBS-168", "EHS-OBS-169", "EHS-OBS-170", "EHS-OBS-171")
def _():
    o = create_obs()
    st(A.post("WORKER-TN1-1", f"/observations/{o['id']}/reply", {"clientUuid": U(), "body": "early"}), 409)
    st(A.post("SO-TN1", f"/observations/{o['id']}/triage", triage_body("return_to_reporter", question="")), 400)
    d = st(A.post("SO-TN1", f"/observations/{o['id']}/triage", triage_body("return_to_reporter", question="Which floor?")), 200).json()
    check(d["status"] == "returned")
    r = st(A.post("WORKER-TN1-1", f"/observations/{o['id']}/reply", {"clientUuid": U(), "body": "Level 3"}), 200).json()
    check(r["status"] == "submitted", r["status"])


@case("EHS-OBS-172", "EHS-OBS-173", "EHS-OBS-174")
def _():
    o = create_obs()
    st(A.post("SO-TN1", f"/observations/{o['id']}/triage", triage_body("reviewed_no_action")), 400)
    check(st(A.post("SO-TN1", f"/observations/{o['id']}/triage", triage_body("reviewed_no_action", reasonCode="already_controlled", reasonText="Rail exists")), 200).json()["status"] == "closed")
    o2 = create_obs()
    check(st(A.post("SO-TN1", f"/observations/{o2['id']}/triage", triage_body("discard", reasonCode="test_entry", reasonText="Test")), 200).json()["status"] == "discarded")


@case("EHS-OBS-175", "EHS-OBS-176", "EHS-OBS-177", "EHS-OBS-178")
def _():
    master = create_obs()
    dup = create_obs()
    st(A.post("SO-TN1", f"/observations/{dup['id']}/triage", triage_body("merge_duplicate", masterObservationId=dup["id"])), 400)
    st(A.post("SO-TN1", f"/observations/{dup['id']}/triage", triage_body("merge_duplicate", masterObservationId=IDS["tn2obs"])), 400)
    closed = create_obs(fixedOnSpot=True, immediateAction="done")
    A.post("SO-TN1", f"/observations/{closed['id']}/triage", triage_body("accept_fixed_on_spot"))
    st(A.post("SO-TN1", f"/observations/{dup['id']}/triage", triage_body("merge_duplicate", masterObservationId=closed["id"])), 400)
    check(st(A.post("SO-TN1", f"/observations/{dup['id']}/triage", triage_body("merge_duplicate", masterObservationId=master["id"])), 200).json()["status"] == "merged")


@case("EHS-OBS-179", "EHS-OBS-180")
def _():
    o = create_obs()
    d = st(A.post("SO-TN1", f"/observations/{o['id']}/triage", triage_body("escalate_incident", learnedAt=now_iso())), 200).json()
    check(d["status"] == "escalated")
    o2, _aid = new_action()
    check(st(A.post("SO-TN1", f"/observations/{o2['id']}/triage", triage_body("escalate_incident", learnedAt=now_iso())), 200).json()["status"] == "escalated")


@case("EHS-OBS-181", "EHS-OBS-182", "EHS-OBS-183")
def _():
    o = create_obs()
    st(A.post("SO-TN1", f"/observations/{o['id']}/triage", triage_body("approve")), 400)
    t = triage_body()
    st(A.post("SO-TN1", f"/observations/{o['id']}/triage", t), 200)
    st(A.post("SO-TN1", f"/observations/{o['id']}/triage", t), 200)  # same clientUuid → same result
    check(sql1("select count(*) from actions where source_id = $1::uuid", o["id"]) == 1)
    st(A.post("SH-TN1-field", f"/observations/{o['id']}/triage", triage_body("discard", reasonCode="x", reasonText="y")), 409)


@case("EHS-OBS-200", "EHS-OBS-201", "EHS-OBS-202", "EHS-OBS-203")
def _():
    o = create_obs()
    st(A.post("WORKER-TN1-1", f"/observations/{o['id']}/comments", {"clientUuid": U(), "body": "More info"}), 200, 201)
    st(A.post("SO-TN1", f"/observations/{o['id']}/comments", {"clientUuid": U(), "body": "Thanks"}), 200, 201)
    st(A.post("WORKER-TN1-2", f"/observations/{o['id']}/comments", {"clientUuid": U(), "body": "x"}), 404)
    st(A.post("WORKER-TN1-1", f"/observations/{o['id']}/comments", {"clientUuid": U(), "body": "x" * 2001}), 400)


@case("EHS-OBS-204", "EHS-OBS-205", "EHS-OBS-206", "EHS-OBS-207", "EHS-OBS-211", "EHS-OBS-212")
def _():
    o = create_obs(fixedOnSpot=True, immediateAction="done")
    A.post("SO-TN1", f"/observations/{o['id']}/triage", triage_body("accept_fixed_on_spot"))
    st(A.put("SO-TN1", f"/observations/{o['id']}/closure-summary", {"closureSummary": "Edge guarded permanently"}), 200)
    st(A.post("SO-TN1", f"/observations/{o['id']}/reopen", {"reason": ""}), 400)
    st(A.post("WORKER-TN1-1", f"/observations/{o['id']}/reopen", {"reason": "x"}), 403)
    check(st(A.post("SO-TN1", f"/observations/{o['id']}/reopen", {"reason": "Rail removed again"}), 200).json()["status"] == "action_assigned")
    open_o = create_obs()
    st(A.post("SO-TN1", f"/observations/{open_o['id']}/reopen", {"reason": "x"}), 409)
    st(A.put("SO-TN1", f"/observations/{open_o['id']}/closure-summary", {"closureSummary": "x"}), 400)


@case("EHS-OBS-208", "EHS-OBS-210", "EHS-WF4-03")
def _():
    o = create_obs(imminentDanger=True)
    st(A.post("WORKER-TN1-1", f"/observations/{o['id']}/ack-critical"), 403)
    st(A.post("VER-TN1", f"/observations/{o['id']}/ack-critical"), 403)
    st(A.post("SO-TN1", f"/observations/{o['id']}/ack-critical"), 200)
    check(sql1("select critical_acked_at is not null from observations where id = $1::uuid", o["id"]) is True)


@case("EHS-OBS-213", "EHS-WF1-10")
def _():
    o, aid = new_action()
    complete(aid)
    st(verify(aid), 200)
    check(sql1("select status from observations where id = $1::uuid", o["id"]) == "closed")
    # the notice itself is queued by the closure-notice job (jobs are off in this run): the report must be waiting for it
    check(sql1("select closure_feedback_sent_at is null and closed_at is not null from observations where id = $1::uuid", o["id"]) is True, "waiting for the closure job")


@case("EHS-OBS-221", "EHS-OBS-222", "EHS-OBS-223", "EHS-OBS-225")
def _():
    a = A.get("SO-TN1", "/observations", params={"sort": "receivedAt", "dir": "asc", "pageSize": 5}).json()
    b = A.get("SO-TN1", "/observations", params={"sort": "receivedAt", "dir": "desc", "pageSize": 5}).json()
    check(a["items"][0]["id"] != b["items"][0]["id"], "sort flips")
    p1 = A.get("SO-TN1", "/observations", params={"page": 1, "pageSize": 10}).json()["items"]
    p2 = A.get("SO-TN1", "/observations", params={"page": 2, "pageSize": 10}).json()["items"]
    check(not ({x["id"] for x in p1} & {x["id"] for x in p2}), "no repeated rows")
    for k, v in (("status", "closed"), ("type", "near_miss"), ("band", "high"), ("channel", "qr")):
        items = A.get("SO-TN1", "/observations", params={k: v, "pageSize": 200}).json()["items"]
        field = {"band": "riskBand"}.get(k, k)
        check(all(x[field] == v for x in items), f"filter {k}")
    cno = A.get("SO-TN1", "/observations", params={"pageSize": 1}).json()["items"][0]["caseNo"]
    check(A.get("SO-TN1", "/observations", params={"q": cno}).json()["total"] == 1)


@case("EHS-OBS-228", "EHS-OBS-229", "EHS-RPT-001", "EHS-RPT-002")
def _():
    r = st(A.get("SO-TN1", "/exports/observations.csv", params={"status": "closed"}), 200)
    check(r.content[:3] == b"\xef\xbb\xbf")
    rows = r.text.splitlines()[1:]
    check(all(",closed," in l for l in rows if l.count(",") > 5), "status filter applied")
    x = st(A.get("SO-TN1", "/exports/observations.xlsx"), 200)
    check(xlsx_sheets(x.content) == ["Reports"])


# ================================================================ Batch 3: actions
@case("EHS-ACT-012", "EHS-ACT-014", "EHS-ACT-016", "EHS-WF1-06")
def _():
    o, aid = new_action(owner="OWN-TN1-1")
    items = A.get("WORKER-TN1-1", "/actions", params={"department": "1", "pageSize": 200}).json()["items"]
    check(any(x["id"] == aid for x in items), "Civil member sees Civil action")
    d = st(A.get("WORKER-TN1-1", f"/actions/{aid}"), 200).json()
    check(not any(d["can"].get(k) for k in ("start", "complete", "verify", "request", "decide", "cancel", "reassign")), str(d["can"]))
    check(A.get("aud-field", "/actions", params={"department": "1"}).json()["total"] == 0)
    IDS["civil_action"] = aid


@case("EHS-ACT-015", "EHS-ACT-017")
def _():
    o, aid = new_action(owner="OWN-TN1-2")  # Electrical
    st(A.get("WORKER-TN1-1", f"/actions/{aid}"), 404)


@case("EHS-ACT-018", "EHS-ACT-019", "EHS-WF3-05")
def _():
    o = create_obs("WORKER-TN2-1", "TN2")
    d = assign(o["id"], who="SO-TN2-f", owner="OWN-TN2-1")
    IDS["tn2action"] = d["actions"][0]["id"]
    st(A.get("SO-TN1", f"/actions/{IDS['tn2action']}"), 404)
    st(A.get("SO-TN1", "/actions", params={"siteId": site("TN2")}), 404)


@case("EHS-ACT-020")
def _():
    elec = sql1("select id::text from departments where code = 'ELEC'")
    items = A.get("SO-TN1", "/actions", params={"departmentId": elec, "pageSize": 200}).json()["items"]
    check(items and all(x["departmentId"] == elec for x in items))


@case("EHS-ACT-030", "EHS-ACT-032", "EHS-ACT-033")
def _():
    o, aid = new_action()
    st(A.post("SO-TN1", f"/actions/{aid}/start", {}), 403)
    check(st(A.post("OWN-TN1-1", f"/actions/{aid}/start", {}), 200).json()["status"] == "in_progress")
    st(A.post("OWN-TN1-1", f"/actions/{aid}/start", {}), 409)


@case("EHS-ACT-041", "EHS-ACT-043", "EHS-ACT-044", "EHS-ACT-047", "EHS-ACT-048")
def _():
    o, aid = new_action()
    st(complete(aid, photos=0), 400)
    st(complete(aid, completionNote=""), 400)
    st(complete(aid, causeAddressed=""), 400)
    st(complete(aid, photos=11), 400)
    st(complete(aid, completionNote="x" * 2001), 400)


@case("EHS-ACT-045", "EHS-ACT-049", "EHS-ACT-054")
def _():
    o, aid = new_action()
    body_uuid = U()
    r = st(complete(aid, clientUuid=body_uuid), 200)
    check(r.json()["status"] == "completed")
    st(complete(aid, clientUuid=body_uuid), 200)  # same clientUuid: applied once
    check(sql1("select count(*) from action_events where action_id = $1::uuid and to_status = 'completed'", aid) == 1)
    n = sql1("select count(*) from notifications where record_id = $1 and recipient_user_id = $2::uuid", aid, uid("VER-TN1"))
    check(n >= 1, "verifier notified")


@case("EHS-ACT-046")
def _():
    o, aid = new_action()
    st(complete(aid, photos=10), 200)


@case("EHS-ACT-051", "EHS-ACT-052")
def _():
    o, aid = new_action()
    st(complete(aid, who="WORKER-TN1-1"), 403, 404)
    complete(aid)
    st(verify(aid), 200)
    st(complete(aid), 409)


@case("EHS-ACT-061", "EHS-ACT-062", "EHS-ACT-063", "EHS-WF1-09")
def _():
    o = create_obs()
    t = triage_body()
    t["actions"].append({"clientUuid": U(), "title": "Second", "problem": "p", "actionType": "preventive", "controlLevel": "administrative", "ownerUserId": uid("OWN-TN1-1")})
    d = st(A.post("SO-TN1", f"/observations/{o['id']}/triage", t), 200).json()
    a1, a2 = d["actions"][0]["id"], d["actions"][1]["id"]
    complete(a1)
    complete(a2)
    check(st(verify(a1), 200).json()["status"] == "verified")
    check(sql1("select status from observations where id = $1::uuid", o["id"]) == "action_assigned")
    st(verify(a2), 200)
    check(sql1("select status from observations where id = $1::uuid", o["id"]) == "closed")


@case("EHS-ACT-064", "EHS-ACT-065", "EHS-WF1-14")
def _():
    o, aid = new_action()
    complete(aid)
    st(verify(aid, result="not_effective"), 400)
    d = st(verify(aid, result="not_effective", reason="Rail loose"), 200).json()
    check(d["status"] == "reopened" and d["reopenCount"] == 1, f"{d['status']} {d['reopenCount']}")
    complete(aid)
    st(verify(aid), 200)
    check(sql1("select status from observations where id = $1::uuid", o["id"]) == "closed")


@case("EHS-ACT-067", "EHS-ACT-069", "EHS-ACT-070", "EHS-ACT-071", "EHS-ACT-073", "EHS-ACT-075", "EHS-ACT-076")
def _():
    o, aid = new_action()
    st(verify(aid), 409)  # 073: not completed yet
    complete(aid)
    st(verify(aid, who="OWN-TN1-1"), 403)
    st(verify(aid, who="WORKER-TN1-1"), 403, 404)
    st(verify(aid, who="OWN-TN1-2"), 403, 404)
    st(verify(aid, who="ADMIN01"), 403)
    st(verify(aid, who="SO-TN1"), 200)
    st(verify(aid, who="VER-TN1"), 409)


@case("EHS-ACT-068")
def _():
    o, aid = new_action(owner="SO-TN1")
    complete(aid, who="SO-TN1")
    st(verify(aid, who="SO-TN1"), 403)


@case("EHS-ACT-072")
def _():
    o = create_obs("WORKER-KA1-1", "KA1")
    d = assign(o["id"], who="SO-KA1-f", owner="OWN-KA1-1")
    aid = d["actions"][0]["id"]
    complete(aid, who="OWN-KA1-1")
    st(verify(aid, who="HSE01"), 200)


@case("EHS-ACT-074", "EHS-WF3-06")
def _():
    st(verify(IDS["tn2action"], who="VER-TN1"), 404)
    st(A.post("SO-TN1", f"/actions/{IDS['tn2action']}/reassign", {"newOwnerUserId": uid("OWN-TN1-1"), "reason": "x"}), 404)
    st(A.post("SO-TN1", f"/actions/{IDS['tn2action']}/cancel", {"reason": "x", "approvedByUserId": uid("SH-TN1")}), 404)


def req_body(type_="date_change", days=10, **over):
    b = {"clientUuid": U(), "type": type_, "reason": "Material delayed", "capturedAt": now_iso()}
    if type_ == "date_change":
        b["proposedDueAt"] = now_iso(timedelta(days=days))
    b.update(over)
    return b


@case("EHS-ACT-080", "EHS-ACT-081", "EHS-ACT-083", "EHS-ACT-084", "EHS-ACT-089", "EHS-ACT-096")
def _():
    o, aid = new_action()
    st(A.post("OWN-TN1-1", f"/actions/{aid}/requests", req_body(proposedDueAt=None)), 400)
    st(A.post("WORKER-TN1-1", f"/actions/{aid}/requests", req_body()), 403, 404)
    st(A.post("OWN-TN1-1", f"/actions/{aid}/requests", req_body()), 200, 201)
    st(A.post("OWN-TN1-1", f"/actions/{aid}/requests", req_body()), 409)
    before = A.get("SO-TN1", f"/actions/{aid}").json()
    rid = before["requests"][-1]["id"]
    st(A.post("SO-TN1", f"/actions/{aid}/requests/{rid}/decide", {"decision": "approved"}), 200)
    after = A.get("SO-TN1", f"/actions/{aid}").json()
    check(after["dueAt"] != before["dueAt"] and after["originalDueAt"] == before["originalDueAt"], "due changed, original kept")
    st(A.post("SO-TN1", f"/actions/{aid}/requests/{rid}/decide", {"decision": "approved"}), 409)


@case("EHS-ACT-085")
def _():
    o, aid = new_action()
    A.post("OWN-TN1-1", f"/actions/{aid}/requests", req_body())
    a = A.get("SO-TN1", f"/actions/{aid}").json()
    st(A.post("SO-TN1", f"/actions/{aid}/requests/{a['requests'][-1]['id']}/decide", {"decision": "rejected", "note": "No"}), 200)
    check(A.get("SO-TN1", f"/actions/{aid}").json()["dueAt"] == a["dueAt"])


@case("EHS-ACT-086")
def _():
    o, aid = new_action()
    for i in range(3):
        st(A.post("OWN-TN1-1", f"/actions/{aid}/requests", req_body(days=10 + i)), 200, 201)
        rid = A.get("SO-TN1", f"/actions/{aid}").json()["requests"][-1]["id"]
        if i < 2:
            st(A.post("SO-TN1", f"/actions/{aid}/requests/{rid}/decide", {"decision": "approved"}), 200)
    st(A.post("SO-TN1", f"/actions/{aid}/requests/{rid}/decide", {"decision": "approved"}), 403)
    st(A.post("SH-TN1-field", f"/actions/{aid}/requests/{rid}/decide", {"decision": "approved"}), 200)


@case("EHS-ACT-088")
def _():
    o, aid = new_action(owner="SO-TN1")
    st(A.post("SO-TN1", f"/actions/{aid}/requests", req_body()), 200, 201)
    rid = A.get("SO-TN1", f"/actions/{aid}").json()["requests"][-1]["id"]
    st(A.post("SO-TN1", f"/actions/{aid}/requests/{rid}/decide", {"decision": "approved"}), 403)


@case("EHS-ACT-090", "EHS-ACT-091", "EHS-ACT-092", "EHS-ACT-094", "EHS-ACT-095", "EHS-WF5-01", "EHS-WF5-02")
def _():
    o, aid = new_action(owner="OWN-TN1-1")
    st(A.post("OWN-TN1-1", f"/actions/{aid}/requests", req_body("dispute", reason="Electrical job")), 200, 201)
    check(A.get("SO-TN1", f"/actions/{aid}").json()["status"] == "disputed")
    rid = A.get("SO-TN1", f"/actions/{aid}").json()["requests"][-1]["id"]
    st(A.post("SO-TN1", f"/actions/{aid}/requests/{rid}/decide", {"decision": "approved"}), 400)
    st(A.post("SO-TN1", f"/actions/{aid}/requests/{rid}/decide", {"decision": "approved", "newOwnerUserId": uid("OWN-TN1-1")}), 400)
    st(A.post("SO-TN1", f"/actions/{aid}/requests/{rid}/decide", {"decision": "approved", "newOwnerUserId": uid("OWN-TN2-1")}), 400)
    st(A.post("SO-TN1", f"/actions/{aid}/requests/{rid}/decide", {"decision": "approved", "newOwnerUserId": uid("OWN-TN1-2")}), 200)
    a = A.get("SO-TN1", f"/actions/{aid}").json()
    elec = sql1("select id::text from departments where code = 'ELEC'")
    check(a["status"] == "open" and a["ownerUserId"] == uid("OWN-TN1-2") and a["departmentId"] == elec, f"{a['status']} {a['departmentId']}")
    IDS["moved_action"] = aid


@case("EHS-WF5-03")
def _():
    items = A.get("WORKER-TN1-1", "/actions", params={"department": "1", "pageSize": 500}).json()["items"]
    check(all(x["id"] != IDS["moved_action"] for x in items))


@case("EHS-ACT-093")
def _():
    o, aid = new_action()
    A.post("OWN-TN1-1", f"/actions/{aid}/requests", req_body("dispute"))
    rid = A.get("SO-TN1", f"/actions/{aid}").json()["requests"][-1]["id"]
    st(A.post("SO-TN1", f"/actions/{aid}/requests/{rid}/decide", {"decision": "rejected", "note": "Yours"}), 200)
    a = A.get("SO-TN1", f"/actions/{aid}").json()
    check(a["status"] == "open" and a["ownerUserId"] == uid("OWN-TN1-1"))


@case("EHS-ACT-100", "EHS-ACT-101", "EHS-ACT-102", "EHS-ACT-103", "EHS-ACT-105")
def _():
    o, aid = new_action()
    st(A.post("OWN-TN1-1", f"/actions/{aid}/reassign", {"newOwnerUserId": uid("OWN-TN1-2")}), 403)
    st(A.post("SO-TN1", f"/actions/{aid}/reassign", {"newOwnerUserId": uid("OWN-TN1-1")}), 400)
    st(A.post("SO-TN1", f"/actions/{aid}/reassign", {"newOwnerUserId": uid("OWN-TN2-1")}), 400)
    st(A.post("SO-TN1", f"/actions/{aid}/reassign", {"newOwnerUserId": uid("OWN-TN1-2"), "reason": "Electrical"}), 200)
    check(A.get("SO-TN1", f"/actions/{aid}").json()["ownerUserId"] == uid("OWN-TN1-2"))
    o2, a2 = new_action()
    complete(a2)
    verify(a2)
    st(A.post("SO-TN1", f"/actions/{a2}/reassign", {"newOwnerUserId": uid("OWN-TN1-2")}), 409)


@case("EHS-ACT-106", "EHS-ACT-107", "EHS-ACT-108", "EHS-ACT-109")
def _():
    o, aid = new_action()
    st(A.post("SO-TN1", f"/actions/{aid}/cancel", {"reason": "x", "approvedByUserId": uid("VER-TN1")}), 400)
    st(A.post("SO-TN1", f"/actions/{aid}/cancel", {"reason": "x", "approvedByUserId": uid("SH-TN2")}), 400)
    check(st(A.post("SO-TN1", f"/actions/{aid}/cancel", {"reason": "Area demolished", "approvedByUserId": uid("SH-TN1")}), 200).json()["status"] == "cancelled")
    o2, a2 = new_action()
    complete(a2)
    verify(a2)
    st(A.post("SO-TN1", f"/actions/{a2}/cancel", {"reason": "x", "approvedByUserId": uid("SH-TN1")}), 409)


def manual_action(**over):
    b = {"clientUuid": U(), "siteId": site("TN1"), "title": "Plan manual action", "problem": "p", "actionType": "corrective", "controlLevel": "administrative",
         "ownerUserId": uid("OWN-TN1-1"), "band": "moderate", "sourceType": "manual", "capturedAt": now_iso()}
    b.update(over)
    return b


@case("EHS-ACT-111", "EHS-ACT-112", "EHS-ACT-113", "EHS-ACT-114", "EHS-ACT-115", "EHS-ACT-116")
def _():
    d = st(A.post("SO-TN1", "/actions", manual_action()), 200, 201).json()
    days = (datetime.fromisoformat(d["dueAt"].replace("Z", "+00:00")) - datetime.now(timezone.utc)).days
    check(d["sourceType"] == "manual" and 28 <= days <= 30, f"{d['sourceType']} {days}")
    st(A.post("SO-TN1", "/actions", manual_action(band=None)), 400)
    st(A.post("SO-TN1", "/actions", manual_action(band="extreme")), 400)
    st(A.post("SO-TN1", "/actions", manual_action(ownerUserId=uid("OWN-TN2-1"))), 400)
    st(A.post("OWN-TN1-1", "/actions", manual_action()), 403)
    st(A.post("SO-TN1", "/actions", manual_action(sourceType="observation", sourceId=IDS["tn2obs"])), 404)


@case("EHS-ACT-117", "EHS-ACT-118", "EHS-ACT-119")
def _():
    o, aid = new_action()
    st(A.post("OWN-TN1-1", f"/actions/{aid}/comments", {"clientUuid": U(), "body": "Ordering rail"}), 200, 201)
    st(A.post("OWN-TN1-1", f"/actions/{aid}/comments", {"clientUuid": U(), "body": "", "media": [media_ref()]}), 200, 201)
    st(A.post("OWN-TN1-1", f"/actions/{aid}/comments", {"clientUuid": U(), "body": ""}), 400)


@case("EHS-ACT-154", "EHS-ACT-155", "EHS-RPT-003", "EHS-RPT-004")
def _():
    r = st(A.get("SO-TN1", "/exports/actions.csv", params={"overdue": "1"}), 200)
    head = r.text.splitlines()[0]
    check("Overdue" in head and "Department" in head, head)
    x = st(A.get("SO-TN1", "/exports/actions.xlsx"), 200)
    check(xlsx_sheets(x.content) == ["Actions"])
    s = zipfile.ZipFile(io.BytesIO(x.content)).read("xl/worksheets/sheet1.xml").decode()
    check(">Yes<" in s or ">No<" in s, "Yes/No values")


# ================================================================ Batch 4: inspections
def tmpl_body(code: str) -> dict:
    return {"code": code, "name": {"en": "Plan scaffold check", "ta": "சாரக்கட்டு சோதனை"}, "type": "site_walk",
            "sections": [{"sort": 0, "title": {"en": "Base"}, "questions": [
                {"code": "Q1", "sort": 0, "text": {"en": "Base plates on sole boards?"}, "answerType": "pass_fail_na"},
                {"code": "Q2", "sort": 1, "text": {"en": "Rail height (mm)"}, "answerType": "number", "passMin": 950, "passMax": 1100},
                {"code": "Q3", "sort": 2, "text": {"en": "Comments"}, "answerType": "text", "required": False, "actionOnFail": False}]}]}


@case("EHS-INS-001", "EHS-INS-002", "EHS-INS-003", "EHS-INS-004", "EHS-INS-020", "EHS-INS-021", "EHS-INS-022", "EHS-INS-023", "EHS-WF6-01", "EHS-WF6-02", "EHS-WF6-03")
def _():
    d = st(A.post("HSE01", "/admin/inspections/templates", tmpl_body("PLAN-SCAF")), 200, 201).json()
    IDS["tmpl"] = d["id"]
    st(A.post("HSE01", "/admin/inspections/templates", tmpl_body("PLAN SCAF")), 400)
    st(A.post("HSE01", "/admin/inspections/templates", tmpl_body("P" * 41)), 400)
    st(A.post("HSE01", "/admin/inspections/templates", tmpl_body("PLAN-SCAF")), 409)
    v = next(x for x in A.get("HSE01", "/admin/inspections/templates").json() if x["code"] == "PLAN-SCAF")
    IDS["tmpl"] = v["templateId"]
    vid = v["id"]
    st(A.post("HSE01", f"/admin/inspections/template-versions/{vid}/submit"), 200)
    st(A.post("HSE01", f"/admin/inspections/template-versions/{vid}/approve"), 403)
    st(A.post("ADMIN01", f"/admin/inspections/template-versions/{vid}/approve"), 200)
    st(A.put("HSE01", f"/admin/inspections/template-versions/{vid}", {"changeNote": "edit active"}), 400)
    IDS["tv"] = vid


@case("EHS-INS-026", "EHS-INS-027", "EHS-INS-028")
def _():
    st(A.post("SO-TN1-admin", f"/admin/inspections/templates/{IDS['tmpl']}/copy", {"code": "PLAN-SCAF-TN1"}), 200, 201)
    st(A.post("SO-TN1-admin", "/admin/inspections/templates", tmpl_body("PLAN-X")), 403)
    st(A.get("AUD01-admin", f"/admin/inspections/templates/{IDS['tmpl']}"), 200)
    st(A.post("AUD01-admin", "/admin/inspections/templates", tmpl_body("PLAN-Y")), 403)


def sched_body(**over):
    b = {"templateId": IDS["tmpl"], "siteId": site("TN1"), "areaId": area_of("TN1"), "frequency": {"every": 1, "unit": "week", "time": "08:00", "weekday": 1},
         "assigneeRole": "verifier", "leadDays": 1, "graceHours": 24, "active": True}
    b.update(over)
    return b


@case("EHS-INS-040", "EHS-INS-041", "EHS-INS-042", "EHS-INS-043")
def _():
    st(A.post("SO-TN1-admin", "/admin/inspections/schedules", sched_body()), 200, 201)
    st(A.post("SO-TN1-admin", "/admin/inspections/schedules", sched_body(frequency={"every": 1})), 400)
    st(A.post("SO-TN1-admin", "/admin/inspections/schedules", sched_body(leadDays=-1)), 400)
    st(A.post("SO-TN1-admin", "/admin/inspections/schedules", sched_body(siteId=site("TN2"), areaId=area_of("TN2"))), 404)


def start_run(who="VER-TN1", vid=None):
    vid = vid or IDS["tv"]
    r = st(A.post(who, "/inspections/runs", {"clientUuid": U(), "templateVersionId": vid, "siteId": site("TN1"), "areaId": area_of("TN1"), "startedAt": now_iso()}), 200, 201)
    return r.json()


def questions(vid):
    tv = next(t for t in A.get("VER-TN1", "/inspections/templates").json() if t["id"] == vid)
    return [q for s in tv["sections"] for q in s["questions"]]


def ans(q, value, **over):
    a = {"clientUuid": U(), "questionId": q["id"], "value": value, "answeredAt": now_iso()}
    a.update(over)
    return a


@case("EHS-INS-071", "EHS-INS-072", "EHS-INS-073", "EHS-INS-077", "EHS-INS-078", "EHS-INS-081")
def _():
    run = start_run()
    qs = questions(IDS["tv"])
    q1, q2 = qs[0], qs[1]
    sub = lambda answers: A.post("VER-TN1", f"/inspections/runs/{run['id']}/submit", {"clientUuid": U(), "answers": answers, "completedAt": now_iso()})  # noqa: E731
    st(sub([ans(q1, "pass")]), 400)  # Q2 unanswered
    st(sub([ans(q1, "fail", note="loose"), ans(q2, 1000)]), 400)  # fail without action
    st(A.put("WORKER-TN1-1", f"/inspections/runs/{run['id']}/answers", {"answers": [ans(q1, "pass")]}), 403, 404)
    st(A.put("VER-TN1", f"/inspections/runs/{run['id']}/answers", {"answers": [ans({"id": U()}, "pass")]}), 400)
    act = {"clientUuid": U(), "title": "Fix base", "problem": "p", "actionType": "corrective", "controlLevel": "engineering", "ownerUserId": uid("OWN-TN1-1"), "band": "moderate"}
    d = st(sub([ans(q1, "fail", note="loose", action=act), ans(q2, 1000)]), 200).json()
    check(d["status"] in ("completed", "closed") and d["result"] == "fail", f"{d['status']} {d['result']}")
    link = st(A.post("VER-TN1", f"/inspections/runs/{run['id']}/report-link"), 200).json()["url"]
    path = link.split("/api/v1", 1)[-1]
    st(A.c.get(path), 200)
    IDS["done_run"] = run["id"]


@case("EHS-INS-084", "EHS-INS-085", "EHS-INS-087")
def _():
    rid = IDS["done_run"]
    st(A.post("SO-TN1", f"/inspections/runs/{rid}/cancel", {"reason": "x"}), 409)
    st(A.post("SO-TN1", f"/inspections/runs/{rid}/reopen", {"reason": "Wrong area"}), 403)  # locked report: admin / HSE only
    st(A.post("HSE01", f"/inspections/runs/{rid}/reopen", {"reason": ""}), 400)
    check(st(A.post("HSE01", f"/inspections/runs/{rid}/reopen", {"reason": "Wrong area"}), 200).json()["status"] == "reopened")


@case("EHS-INS-086", "EHS-INS-088")
def _():
    run = start_run()
    st(A.post("WORKER-TN1-1", f"/inspections/runs/{run['id']}/cancel", {"reason": "x"}), 403, 404)
    check(st(A.post("SO-TN1", f"/inspections/runs/{run['id']}/cancel", {"reason": "Area closed"}), 200).json()["status"] == "cancelled")


@case("EHS-INS-089", "EHS-WF3-07")
def _():
    rid = sql1("select r.id::text from inspection_runs r join sites s on s.id = r.site_id where s.code = 'TN2' limit 1")
    check(rid, "a TN2 run exists in the demo data")
    st(A.get("SO-TN1", f"/inspections/runs/{rid}"), 404)
    st(A.post("SO-TN1", f"/inspections/runs/{rid}/report-link"), 404)


@case("EHS-INS-062", "EHS-INS-025")
def _():
    st(A.post("HSE01", f"/admin/inspections/template-versions/{IDS['tv']}/retire"), 200)
    st(A.post("VER-TN1", "/inspections/runs", {"clientUuid": U(), "templateVersionId": IDS["tv"], "siteId": site("TN1"), "startedAt": now_iso()}), 400)


@case("EHS-INS-102", "EHS-RPT-005", "EHS-RPT-006")
def _():
    st(A.get("SO-TN1", "/exports/inspections.csv"), 200)
    check(xlsx_sheets(st(A.get("SO-TN1", "/exports/inspections.xlsx"), 200).content) == ["Inspections"])


# ================================================================ Batch 5: reports and exports
@case("EHS-RPT-007", "EHS-RPT-008", "EHS-RPT-009")
def _():
    r = st(A.get("SO-TN1", "/exports/report.xlsx", params={"from": "2026-09-01", "to": "2026-10-31"}), 200)
    check(xlsx_sheets(r.content) == ["Summary", "Reports", "Actions", "Departments"])
    st(A.get("SO-TN1", "/exports/users.xlsx"), 404)
    st(A.get("SO-TN1", "/exports/observations.pdf"), 404)


@case("EHS-RPT-013")
def _():
    for p in ("observations.csv", "actions.xlsx", "inspections.csv"):
        st(A.get("AUD01-admin", f"/exports/{p}"), 200)


@case("EHS-RPT-014")
def _():
    st(A.get("SH-TN1-admin", "/exports/observations.csv", params={"siteId": site("TN2")}), 404)


@case("EHS-RPT-017")
def _():
    r = sql("select changes from audit_log where action = 'export' order by id desc limit 1")[0]["changes"]
    c = json.loads(r) if isinstance(r, str) else r
    check("rows" in c and "filters" in c, str(c))


@case("EHS-RPT-019", "EHS-RPT-020", "EHS-RPT-022", "EHS-RPT-023")
def _():
    create_obs(description="Plan\x01 control =HYPERLINK(\"http://x\")", imminentDanger=True)
    x = st(A.get("SO-TN1", "/exports/observations.xlsx"), 200)
    s = zipfile.ZipFile(io.BytesIO(x.content)).read("xl/worksheets/sheet1.xml").decode()
    check('s="2"><v>' in s, "date cells use the date style")
    check(">Yes<" in s and ">No<" in s)
    check("\x01" not in s, "control character removed")
    check('t="inlineStr"' in s and "<f>" not in s, "formula text stored as text, never as a formula")


@case("EHS-RPT-024")
def _():
    create_obs(description='=HYPERLINK("http://x","click")')
    text = A.get("SO-TN1", "/exports/observations.csv").text
    check("'=HYPERLINK" in text and ',=HYPERLINK' not in text and '"=HYPERLINK' not in text, "formula guarded")


@case("EHS-RPT-040", "EHS-WF1-02")
def _():
    o = create_obs()
    check(sql1("select count(*) from notifications where record_id = $1 and recipient_user_id = $2::uuid", o["id"], uid("SO-TN1")) >= 1)


@case("EHS-RPT-041")
def _():
    o, aid = new_action()
    check(sql1("select count(*) from notifications where record_id = $1 and recipient_user_id = $2::uuid", aid, uid("OWN-TN1-1")) >= 1)


@case("EHS-RPT-042")
def _():
    sql("update users set language = 'ta' where employee_code = 'OWN-TN1-2'")
    o, aid = new_action(owner="OWN-TN1-2")
    body = sql1("select title || ' ' || body from notifications where record_id = $1 and recipient_user_id = $2::uuid and channel = 'inapp' order by id desc limit 1", aid, uid("OWN-TN1-2"))
    check(body and re.search(r"[஀-௿]", body), body)
    sql("update users set language = 'en' where employee_code = 'OWN-TN1-2'")


@case("EHS-RPT-046", "EHS-RPT-047", "EHS-RPT-049", "EHS-ADM-260", "EHS-ADM-261")
def _():
    st(A.get("ADMIN01", "/admin/notifications-log"), 200)
    st(A.get("HSE01", "/admin/notifications-log"), 200)
    st(A.get("ADMIN01", "/admin/notifications-log", params={"status": "queued"}), 200)


# ================================================================ Batch 6: admin
@case("EHS-ADM-001", "EHS-ADM-002", "EHS-ADM-003", "EHS-ADM-004", "EHS-ADM-005", "EHS-ADM-006", "EHS-ADM-014")
def _():
    body = {"code": "KA9", "name": {"en": "Warehouse 9", "kn": "ಗೋದಾಮು 9"}, "state": "KA", "district": "Hubballi", "establishmentType": "other"}
    d = st(A.post("ADMIN01", "/admin/sites", body), 200, 201).json()
    IDS["s:KA9"] = d["id"]
    for code in ("ka9", "K", "KA12345"):
        st(A.post("ADMIN01", "/admin/sites", {**body, "code": code}), 400)
    st(A.post("ADMIN01", "/admin/sites", {**body, "code": "TN1"}), 409)
    st(A.post("ADMIN01", "/admin/sites", {**body, "code": "KA8", "name": {"en": ""}}), 400)
    st(A.post("HSE01", "/admin/sites", {**body, "code": "KA7"}), 403)


@case("EHS-ADM-007", "EHS-ADM-008", "EHS-ADM-009")
def _():
    a = st(A.post("ADMIN01", f"/admin/sites/{IDS['s:KA9']}/setup", {"industryCode": "warehouse"}), 200).json()
    b = st(A.post("ADMIN01", f"/admin/sites/{IDS['s:KA9']}/setup", {"industryCode": "warehouse"}), 200).json()
    check(len(a["areas"]) == len(b["areas"]) and len(a["areas"]) > 0)
    st(A.post("ADMIN01", f"/admin/sites/{IDS['s:KA9']}/setup", {"industryCode": "mars"}), 400)


@case("EHS-ADM-012", "EHS-ADM-013")
def _():
    st(A.delete("ADMIN01", f"/admin/sites/{IDS['s:KA9']}", {"reason": ""}), 400)
    st(A.delete("ADMIN01", f"/admin/sites/{IDS['s:KA9']}", {"reason": "Plan test site"}), 200)
    codes = [s["code"] for s in A.get("ADMIN01", "/admin/sites").json()]
    check("KA9" not in codes)


@case("EHS-ADM-016")
def _():
    st(A.post("HSE01", f"/admin/sites/{site('KA1')}/rule-set", {"code": "KA_OSH_DRAFT_2026"}), 400)


@case("EHS-ADM-018", "EHS-ADM-019", "EHS-ADM-020", "EHS-ADM-023")
def _():
    sites = A.get("SO-TN1-admin", "/admin/sites").json()
    check([s["code"] for s in sites] == ["TN1"], str([s["code"] for s in sites]))
    a = st(A.post("SO-TN1-admin", f"/admin/sites/{site('TN1')}/areas", {"code": "PLB", "name": {"en": "Plan loading bay"}, "areaType": "other"}), 200, 201).json()
    st(A.post("SO-TN1-admin", f"/admin/sites/{site('TN2')}/areas", {"code": "PLB", "name": {"en": "x"}}), 404)
    st(A.delete("SO-TN1-admin", f"/admin/areas/{a['id']}", {"reason": "Plan test"}), 200)


@case("EHS-ADM-024", "EHS-ADM-025", "EHS-ADM-026")
def _():
    csv = "code,name,type,parent\nPA1,Plan area 1,other,\nPA2,Plan area 2,other,\nPA3,Plan area 3,other,\n"
    r = st(A.post("SO-TN1-admin", f"/admin/sites/{site('TN1')}/areas/import", {"csv": csv}), 200).json()
    check(r["created"] == 3, str(r))
    st(A.post("SO-TN1-admin", f"/admin/sites/{site('TN1')}/areas/import", {"csv": "area,title\nx,y\n"}), 400)
    r2 = st(A.post("SO-TN1-admin", f"/admin/sites/{site('TN1')}/areas/import", {"csv": csv}), 200).json()
    check(r2["created"] == 0, str(r2))


@case("EHS-ADM-027", "EHS-WF8-02")
def _():
    st(A.post("AUD01-admin", f"/admin/sites/{site('TN1')}/areas", {"code": "AUD", "name": {"en": "x"}}), 403)
    st(A.post("AUD01-admin", "/admin/departments", {"code": "AUD", "name": {"en": "x"}}), 403)


@case("EHS-ADM-040", "EHS-ADM-041", "EHS-ADM-042", "EHS-ADM-043")
def _():
    b = {"siteId": site("TN1"), "assetClass": "vehicle", "tagNo": "PLAN-FLT-01", "makeModel": "Toyota 8FB"}
    d = st(A.post("SO-TN1-admin", "/admin/assets", b), 200, 201).json()
    IDS["asset"] = d["id"]
    st(A.post("SO-TN1-admin", "/admin/assets", {**b, "siteId": None}), 400)
    st(A.post("SO-TN1-admin", "/admin/assets", b), 409)
    st(A.post("SO-TN1-admin", "/admin/assets", {**b, "siteId": site("TN2"), "tagNo": "X1"}), 404)


@case("EHS-ADM-047", "EHS-ADM-048", "EHS-ADM-050", "EHS-ADM-052", "EHS-OBS-118")
def _():
    q = st(A.post("SO-TN1-admin", "/admin/qr-codes", {"targetType": "asset", "targetId": IDS["asset"], "label": "PLAN-FLT-01"}), 200, 201).json()
    link = st(A.post("SO-TN1-admin", f"/admin/qr-codes/{q['id']}/poster-link"), 200, 201).json()["url"]
    st(A.c.get(link.split("/api/v1", 1)[-1]), 200)
    old = q["token"]
    st(A.post("SO-TN1-admin", f"/admin/qr-codes/{q['id']}/rotate", {"reason": "Poster damaged"}), 200, 201)
    st(A.c.get(f"/public/qr/{old}"), 410)
    tn2q = sql1("select q.id::text from qr_codes q join areas a on a.id = q.target_id join sites s on s.id = a.site_id where s.code = 'TN2' limit 1")
    st(A.post("SO-TN1-admin", f"/admin/qr-codes/{tn2q}/rotate", {"reason": "x"}), 404)


@case("EHS-ADM-060", "EHS-ADM-062", "EHS-ADM-065", "EHS-ADM-066")
def _():
    p = st(A.post("ADMIN01", "/admin/people", {"fullName": "Plan Person", "phone": "9876501234", "preferredLanguage": "ta", "trade": "civil", "workerType": "contract"}), 200, 201).json()
    check(p["phoneMasked"].endswith("1234") and "98765" not in p["phoneMasked"])
    check(sql1("select phone_enc not like '%9876501234%' from people where id = $1::uuid", p["id"]) is True, "phone encrypted")
    st(A.post("ADMIN01", "/admin/people", {"fullName": "X", "departmentId": U()}), 400)
    st(A.put("SO-TN1-admin", f"/admin/people/{p['id']}", {"fullName": "Y"}), 403)
    st(A.delete("ADMIN01", f"/admin/people/{p['id']}", {"reason": "Plan test"}), 200)


@case("EHS-ADM-067", "EHS-ADM-068")
def _():
    b = {"name": "Plan Contractors Pvt Ltd", "trades": ["civil"], "siteIds": [site("TN1"), site("TN2")]}
    st(A.post("ADMIN01", "/admin/contractors", b), 200, 201)
    st(A.post("ADMIN01", "/admin/contractors", b), 409)


@case("EHS-ADM-073", "EHS-ADM-074", "EHS-ADM-075", "EHS-ADM-076", "EHS-ADM-078", "EHS-ADM-079")
def _():
    d = st(A.post("ADMIN01", "/admin/departments", {"code": "plan", "name": {"en": "Plan dept", "ta": "திட்டம்"}}), 201).json()
    check(d["code"] == "PLAN" and d["memberCount"] == 0)
    st(A.post("ADMIN01", "/admin/departments", {"code": "PLAN", "name": {"en": "x"}}), 409)
    st(A.post("ADMIN01", "/admin/departments", {"code": "PLAN 1", "name": {"en": "x"}}), 400)
    st(A.post("ADMIN01", "/admin/departments", {"code": "PLAN2", "name": {"en": ""}}), 400)
    st(A.post("SO-TN1-admin", "/admin/departments", {"code": "PLAN3", "name": {"en": "x"}}), 403)
    st(A.get("SO-TN1-admin", "/admin/departments"), 200)
    st(A.delete("ADMIN01", f"/admin/departments/{d['id']}", {"reason": "Plan test"}), 200)


@case("EHS-ADM-090", "EHS-ADM-091", "EHS-ADM-092", "EHS-ADM-093", "EHS-ADM-094", "EHS-ADM-095", "EHS-ADM-096", "EHS-ADM-097", "EHS-ADM-099", "EHS-ADM-100")
def _():
    civ = sql1("select id::text from departments where code = 'CIVIL'")
    u = _new_user("PLAN-E3001", departmentId=civ)
    check(u["tempPassword"] and u["departmentId"] == civ)
    u2 = st(A.post("ADMIN01", "/admin/users", {"name": "Plan SO9", "email": "so9@plan.test", "loginType": "email", "language": "kn",
                                              "roles": [{"siteId": site("TN1"), "role": "site_safety_officer"}]}), 201).json()
    check(u2["tempPassword"])
    st(A.post("ADMIN01", "/admin/users", {"name": "x", "loginType": "email", "language": "en", "roles": [{"siteId": site("TN1"), "role": "reporter"}]}), 400)
    st(A.post("ADMIN01", "/admin/users", {"name": "x", "loginType": "employee_code", "language": "en", "roles": [{"siteId": site("TN1"), "role": "reporter"}]}), 400)
    st(A.post("ADMIN01", "/admin/users", {"name": "x", "employeeCode": "WORKER-TN1-1", "loginType": "employee_code", "language": "en", "roles": []}), 409)
    st(A.post("ADMIN01", "/admin/users", {"name": "x", "email": "so9@plan.test", "loginType": "email", "language": "en", "roles": []}), 409)
    st(A.post("ADMIN01", "/admin/users", {"name": "x", "email": "abc@", "loginType": "email", "language": "en", "roles": []}), 400)
    st(A.post("ADMIN01", "/admin/users", {"name": "x", "employeeCode": "PLAN-R1", "loginType": "employee_code", "language": "en", "roles": [{"siteId": None, "role": "site_safety_officer"}]}), 400)
    st(A.post("ADMIN01", "/admin/users", {"name": "x", "employeeCode": "PLAN-R2", "loginType": "employee_code", "language": "en", "roles": [{"siteId": site("TN1"), "role": "plant_head"}]}), 400)


@case("EHS-ADM-103")
def _():
    elec = sql1("select id::text from departments where code = 'ELEC'")
    civ = sql1("select id::text from departments where code = 'CIVIL'")
    st(A.put("ADMIN01", f"/admin/users/{uid('WORKER-TN1-3')}", {"departmentId": elec}), 200)
    A.login("WORKER-TN1-3", name="w13")
    check(A.get("w13", "/me").json()["departmentId"] == elec)
    st(A.put("ADMIN01", f"/admin/users/{uid('WORKER-TN1-3')}", {"departmentId": civ}), 200)


@case("EHS-ADM-104", "EHS-ADM-105")
def _():
    tok = A.login("WORKER-TN3-2", name="w32")
    st(A.post("ADMIN01", f"/admin/users/{uid('WORKER-TN3-2')}/status", {"status": "suspended", "reason": "Plan"}), 200)
    st(A.get(None, "/me", token=tok), 401)
    st(A.post("ADMIN01", f"/admin/users/{uid('WORKER-TN3-2')}/status", {"status": "active", "reason": "Plan"}), 200)
    st(A.raw_login("WORKER-TN3-2", PW), 200)


@case("EHS-ADM-107")
def _():
    r = st(A.get("ADMIN01", "/admin/users", params={"siteId": site("TN1"), "role": "verifier", "status": "active"}), 200).json()
    check(r["total"] >= 1 and all(any(x["role"] == "verifier" for x in u["roles"]) for u in r["items"]))


@case("EHS-ADM-109", "EHS-ADM-110", "EHS-ADM-111", "EHS-ADM-112", "EHS-ADM-113")
def _():
    csv = ("name,employee_code,email,language,employer,department,trade,phone,role,site_code\n"
           "Plan Imp One,PLAN-I1,,ta,,CIVIL,,9876501111,reporter,TN1\n"
           "Plan Imp Two,PLAN-I2,,en,,,,,,TN1\n"
           "Plan Imp Three,PLAN-I3,,en,,,,,reporter,ZZ9\n"
           "Plan Imp Four,PLAN-I4,,en,,NOPE,,,reporter,TN1\n"
           "Worker Existing,WORKER-TN1-5,,en,,,,,verifier,TN1\n")
    r = st(A.post("ADMIN01", "/admin/users/import", {"csv": csv}), 200).json()
    check(r["created"] == 1 and r["updated"] == 1 and r["skipped"] == 3 and list(r["tempPasswords"]) == ["PLAN-I1"], str(r))


@case("EHS-ADM-114", "EHS-ADM-115", "EHS-ADM-117")
def _():
    st(A.get("HSE01", "/admin/users"), 200)
    st(A.post("HSE01", "/admin/users", {"name": "x", "employeeCode": "PLAN-H1", "loginType": "employee_code", "language": "en", "roles": [{"siteId": site("TN1"), "role": "reporter"}]}), 403)
    st(A.post("SO-TN1-admin", "/admin/users", {"name": "x", "employeeCode": "PLAN-H2", "loginType": "employee_code", "language": "en", "roles": [{"siteId": site("TN1"), "role": "reporter"}]}), 403)


@case("EHS-ADM-130", "EHS-ADM-131", "EHS-ADM-132", "EHS-ADM-136")
def _():
    st(A.post("HSE01", "/admin/categories", {"code": "PLANCONF", "name": {"en": "Plan confined", "ta": "அடைபட்ட இடம்"}}), 200, 201)
    st(A.post("HSE01", "/admin/categories", {"code": "", "name": {"en": "x"}}), 400)
    st(A.post("HSE01", "/admin/categories", {"code": "HOUSE", "name": {"en": "x"}}), 409)
    st(A.post("SO-TN1-admin", "/admin/categories", {"code": "PLANX", "name": {"en": "x"}}), 403)


@case("EHS-ADM-137", "EHS-ADM-138", "EHS-ADM-139", "EHS-ADM-140")
def _():
    versions = A.get("HSE01", "/admin/risk-matrices").json()
    active = next(v for v in versions if v["status"] == "active")
    m = {"id": active["matrixId"]}
    st(A.put("HSE01", f"/admin/risk-matrix-versions/{active['id']}", {"effectiveFrom": "2026-12-01"}), 400)
    d = st(A.post("HSE01", f"/admin/risk-matrices/{m['id']}/versions", {}), 200, 201).json()
    st(A.post("HSE01", f"/admin/risk-matrix-versions/{d['id']}/activate"), 403)
    st(A.post("ADMIN01", f"/admin/risk-matrix-versions/{d['id']}/activate"), 200)


@case("EHS-ADM-145")
def _():
    st(A.post("HSE01", "/admin/rule-sets/KA_OSH_DRAFT_2026/enable"), 400)


@case("EHS-ADM-201", "EHS-ADM-203", "EHS-ADM-204")
def _():
    st(A.put("ADMIN01", "/admin/translations/ta", {"overrides": {"poster.headline": "ஆபத்து கண்டீர்களா?"}}), 200)
    st(A.post("ADMIN01", "/admin/translations/import", {"strings": "x"}), 400)
    st(A.put("HSE01", "/admin/translations/ta", {"overrides": {"poster.headline": "x"}}), 403)


@case("EHS-ADM-210", "EHS-ADM-211", "EHS-ADM-214", "EHS-ADM-215", "EHS-ADM-216")
def _():
    s = A.get("ADMIN01", "/admin/settings").json()
    st(A.put("ADMIN01", "/admin/settings", {**s, "orgName": "SafeWorks demo company (plan)"}), 200)
    st(A.put("ADMIN01", "/admin/settings", {**s, "orgName": ""}), 400)
    s = A.get("HSE01", "/admin/settings").json()
    st(A.put("HSE01", "/admin/settings", {**s, "orgName": "Hijack"}), 403)
    st(A.put("HSE01", "/admin/settings", s), 200)
    st(A.put("SO-TN1-admin", "/admin/settings", s), 403)


@case("EHS-ADM-220", "EHS-ADM-221", "EHS-ADM-223")
def _():
    st(A.post("ADMIN01", "/admin/privacy/notices", {"body": {"ta": "x"}, "effectiveFrom": "2026-11-03"}), 400)
    st(A.post("ADMIN01", "/admin/privacy/notices", {"body": {"en": "Plan notice v2", "ta": "அறிவிப்பு"}, "effectiveFrom": "2026-11-03"}), 200, 201)
    me = A.get("WORKER-TN1-2", "/me").json()
    check(me["privacyNoticeVersion"] > (me["privacyAckedVersion"] or 0), "users must accept the new version")
    st(A.get("HSE01", "/admin/privacy/requests"), 403)


@case("EHS-ADM-231", "EHS-ADM-234")
def _():
    n = sql1("select count(*) from observations")
    st(A.post("ADMIN01", "/admin/retention/dry-run"), 200)
    check(sql1("select count(*) from observations") == n, "nothing deleted")
    st(A.post("HSE01", "/admin/retention/dry-run"), 403)


@case("EHS-ADM-240", "EHS-ADM-290")
def _():
    st(A.get("ADMIN01", "/admin/health"), 200)
    st(A.get("HSE01", "/admin/health"), 200)


@case("EHS-ADM-252", "EHS-WF3-15")
def _():
    r = A.get("SO-TN1-admin", "/admin/audit-log", params={"pageSize": 500}).json()
    items = r["items"] if isinstance(r, dict) else r
    check(items and not any(x.get("siteCode") in ("TN2", "TN3", "KA1", "KA2") for x in items), "no other-site rows")


@case("EHS-ADM-253", "EHS-ADM-254")
def _():
    st(A.get("AUD01-admin", "/admin/audit-log"), 200)
    v = st(A.post("ADMIN01", "/admin/audit-log/verify"), 200).json()
    check(v.get("ok") is True or v.get("intact") is True, str(v))


@case("EHS-ADM-255")
def _():
    rid = sql1("select id from audit_log order by id limit 1 offset 5")
    old = sql1("select changes::text from audit_log where id = $1", rid)
    sql("update audit_log set changes = '{\"tampered\": true}'::jsonb where id = $1", rid)
    try:
        v = A.post("ADMIN01", "/admin/audit-log/verify").json()
        check(not (v.get("ok") is True or v.get("intact") is True), str(v))
    finally:
        sql("update audit_log set changes = $2::jsonb where id = $1", rid, old)


@case("EHS-ADM-256")
def _():
    st(A.delete("ADMIN01", "/admin/audit-log"), 404, 405)
    st(A.put("ADMIN01", "/admin/audit-log", {}), 404, 405)


@case("EHS-ADM-262")
def _():
    st(A.get("AUD01-admin", "/admin/notifications-log"), 404)  # menu now hidden for auditors (F5)


# ================================================================ Batch 7: flows and isolation
@case("EHS-WF1-01", "EHS-WF1-04", "EHS-WF1-05", "EHS-WF1-07", "EHS-WF1-08", "EHS-WF1-11", "EHS-WF1-12", "EHS-WF1-13")
def _():
    k0 = {x["key"]: x["value"] for x in A.get("SO-TN1", "/dashboard").json()["kpis"]}
    o = create_obs(media=[media_ref()], description="Open edge on level 3, no guard rail")
    check(sql1("select bool_and(hash_match) from media where owner_id = $1::uuid", o["id"]) is True, "photo hash")
    d = assign(o["id"], l=3, s=4, interimControl="Barricade placed")
    aid = d["actions"][0]["id"]
    check(any(x["id"] == aid for x in A.get("OWN-TN1-1", "/actions", params={"mine": "1", "pageSize": 500}).json()["items"]))
    st(A.post("OWN-TN1-1", f"/actions/{aid}/start", {}), 200)
    st(complete(aid), 200)
    check(any(x["id"] == aid for x in A.get("VER-TN1", "/actions", params={"verify": "1", "pageSize": 500}).json()["items"]))
    st(verify(aid), 200)
    k1 = {x["key"]: x["value"] for x in A.get("SO-TN1", "/dashboard").json()["kpis"]}
    check(k1["open_actions"] == k0["open_actions"], "opened and closed again: open count back where it was")
    me = A.get("WORKER-TN1-1", "/insights", params={"level": "me"}).json()
    check(me["reports"]["closed"] >= 1)
    trail = [r[0] for r in sql("select action from audit_log where record_id in ($1, $2) order by id", o["id"], aid)]
    check(len(trail) >= 5, str(trail))


@case("EHS-WF3-03", "EHS-WF3-04")
def _():
    st(A.post("SO-TN1", f"/observations/{IDS['tn2obs']}/comments", {"clientUuid": U(), "body": "x"}), 404)
    st(A.get("SO-TN1", f"/observations/{IDS['tn2obs']}/duplicates"), 404)


@case("EHS-WF3-08")
def _():
    m = sql1("select m.client_uuid::text from media m join observations o on o.id = m.owner_id where o.site_id = $1::uuid limit 1", site("TN2"))
    check(m, "a TN2 photo exists")
    st(A.get("SO-TN1", f"/media/{m}"), 404)


@case("EHS-WF3-11")
def _():
    st(A.get("SO-TN1", "/dashboard", params={"siteIds": site("TN2")}), 404)
    st(A.get("SO-TN1", "/insights", params={"siteId": site("TN2")}), 404)
    st(A.get("SO-TN1", "/exports/observations.csv", params={"siteId": site("TN2")}), 404)


@case("EHS-WF3-12", "EHS-WF3-13")
def _():
    d = st(A.get("SO-TN1", "/sync/pull"), 200).json()
    check(all(s["code"] == "TN1" for s in d["sites"]), "only TN1")
    check(all(x["siteId"] == site("TN1") for x in d["observations"] + d["actions"] + d["runs"] if not x.get("mine")), "no other-site records")
    b = obs_body("TN2")
    res = sync_push("SO-TN1", [{"commandId": U(), "entityType": "observation", "op": "create", "entityClientUuid": b["clientUuid"], "payload": b}])
    check(res[0]["status"] == "rejected", str(res))


@case("EHS-WF3-14")
def _():
    st(A.post("SO-TN1-admin", f"/admin/sites/{site('TN2')}/areas", {"code": "X", "name": {"en": "x"}}), 404)
    st(A.post("SO-TN1-admin", "/admin/assets", {"siteId": site("TN2"), "tagNo": "X2"}), 404)
    st(A.post("SO-TN1-admin", "/admin/inspections/schedules", sched_body(siteId=site("TN2"), areaId=area_of("TN2"))), 404)


@case("EHS-WF3-17")
def _():
    o = create_obs("WORKER-TN1-2")
    st(A.get("WORKER-TN1-1", f"/observations/{o['id']}"), 404)


@case("EHS-WF3-18")
def _():
    st(A.get("WORKER-TN1-1", f"/actions/{IDS['tn2action']}"), 404)


@case("EHS-WF3-19")
def _():
    cno = sql1("select case_no from observations where case_no like 'TN2-OBS-%' limit 1")
    check(A.get("SO-TN1", "/observations", params={"q": cno}).json()["total"] == 0)


@case("EHS-WF3-20")
def _():
    st(A.get("HSE01", f"/observations/{IDS['tn2obs']}"), 200)
    st(A.get("HSE01", f"/actions/{IDS['tn2action']}"), 200)


@case("EHS-WF7-02", "EHS-WF7-03")
def _():
    oid = sql1("select id::text from observations where case_no = $1", IDS["qrcase"])
    d = assign(oid)
    aid = d["actions"][0]["id"]
    complete(aid)
    verify(aid)
    s = A.c.get(IDS["qrstatus"])
    check(s.status_code == 200 and "closed" in s.text and "Plan test: fix it" not in s.text, s.text[:200])


@case("EHS-WF8-01", "EHS-WF8-03", "EHS-WF8-04")
def _():
    u = st(A.post("ADMIN01", "/admin/users", {"name": "Plan Auditor", "employeeCode": "PLAN-AUD2", "loginType": "employee_code", "language": "en",
                                             "roles": [{"siteId": None, "role": "auditor"}], "expiresAt": now_iso(timedelta(days=7))}), 201).json()
    tok = st(A.raw_login("PLAN-AUD2", u["tempPassword"], "admin"), 200).json()["token"]
    A.post(None, "/auth/password", {"current": u["tempPassword"], "new": "AuditorPass2026"}, token=tok)
    sql("update users set expires_at = now() - interval '1 minute' where employee_code = 'PLAN-AUD2'")
    st(A.raw_login("PLAN-AUD2", "AuditorPass2026", "admin"), 403)
    check(sql1("select count(*) from audit_log where actor_user_id = $1::uuid or record_id = $2", u["id"], u["id"]) >= 1)


# ================================================================ timed jobs (run once each, with times moved instead of waiting)
MAILS: list = []
SMTP_URL = ""


class _SmtpSink(socketserver.StreamRequestHandler):
    """A minimal SMTP server that keeps every message (no TLS, no auth): enough for smtplib."""

    def handle(self):
        def w(s: str):
            self.wfile.write((s + "\r\n").encode())
        w("220 plan-sink")
        data, buf = False, []
        while True:
            line = self.rfile.readline()
            if not line:
                return
            text = line.decode("utf-8", "replace").rstrip("\r\n")
            if data:
                if text == ".":
                    MAILS.append(email.message_from_string("\n".join(buf), policy=email.policy.default))
                    buf, data = [], False
                    w("250 ok")
                else:
                    buf.append(text[1:] if text.startswith("..") else text)
                continue
            cmd = text[:4].upper()
            if cmd == "EHLO":
                w("250-plan-sink")
                w("250 OK")
            elif cmd == "DATA":
                w("354 go")
                data = True
            elif cmd == "QUIT":
                w("221 bye")
                return
            else:
                w("250 ok")


def start_smtp_sink() -> str:
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _SmtpSink)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"smtp://127.0.0.1:{srv.server_address[1]}"


def run_job(name: str, arg: str = "", smtp: bool = True) -> None:
    env = {**os.environ, "DATABASE_URL": DB, "SMTP_URL": SMTP_URL if smtp else "", "SEED_ADMIN_PASSWORD": ADMIN_PW}
    r = subprocess.run([PY, str(ROOT / "portal" / "e2e" / "run_job.py"), name, arg], cwd=SERVER, env=env, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise Fail(f"job {name}: {r.stderr[-400:]}")


def ntf(record_id: str, code: str, channel: str = "inapp", event: str | None = None) -> int:
    return sql1("select count(*) from notifications where record_id = $1 and recipient_user_id = $2::uuid and channel = $3 and ($4::text is null or event_type = $4)",
                record_id, uid(code), channel, event)


def outbox_to(record_id: str, code: str) -> int:
    return sql1("""select count(*) from email_outbox e join notifications n on n.id = e.notification_id
                   where n.record_id = $1 and n.recipient_user_id = $2::uuid""", record_id, uid(code))


TOWN = "OWN-TN1-3"  # used only by the timed cases, so its push count and reminders are its own


def timed_action(band="moderate", owner=TOWN, **over) -> str:
    extra = {"interimControl": "Barricaded"} if band in ("extreme", "high") else {}
    d = st(A.post("SO-TN1", "/actions", manual_action(band=band, ownerUserId=uid(owner), title=f"Plan timed {band} {U()[:6]}", **extra, **over)), 200, 201).json()
    sql("update actions set created_at = now() - interval '60 days' where id = $1::uuid", d["id"])
    return d["id"]


def due_in(aid: str, delta: timedelta, original: bool = False) -> None:
    sql("update actions set due_at = now() + $2::interval" + (", original_due_at = now() + $2::interval" if original else "") + " where id = $1::uuid", aid, delta)


@case("EHS-ACT-130", "EHS-ACT-131", "EHS-ACT-132", "EHS-ACT-133", "EHS-ACT-134", "EHS-WF2-01", "EHS-WF2-02", "EHS-WF2-03", "EHS-WF2-04", "EHS-WF2-06", "EHS-WF2-07")
def _():
    aid = timed_action()
    IDS["timed"] = aid
    m = timedelta(minutes=2)
    due_in(aid, timedelta(days=7) - m)
    run_job("ladder_job")
    check(ntf(aid, TOWN, event="action_due_soon") == 1, "7 days before: owner reminded once")
    check(ntf(aid, TOWN, "push", "action_due_soon") == 1, "push queued")
    run_job("ladder_job")
    check(ntf(aid, TOWN, event="action_due_soon") == 1, "WF2-06: same step not sent twice")
    due_in(aid, timedelta(days=3) - m)
    run_job("ladder_job")
    check(ntf(aid, TOWN, event="action_due_soon") == 2, "3 days before")
    due_in(aid, -m)
    run_job("ladder_job")
    check(ntf(aid, TOWN, event="action_due_today") == 1, "due day")
    check(ntf(aid, "SO-TN1", event="action_overdue") == 0 and ntf(aid, "SH-TN1", event="action_overdue") == 0, "no escalation yet")
    due_in(aid, -timedelta(days=1) - m, original=True)
    run_job("ladder_job")
    check(ntf(aid, "SO-TN1", event="action_overdue") == 1 and ntf(aid, "SH-TN1", event="action_overdue") == 1, "1 day overdue: officer and site head")
    check(outbox_to(aid, "SH-TN1") == 0, "no email to the site head yet")
    due_in(aid, -timedelta(days=3) - m, original=True)
    run_job("ladder_job")
    check(ntf(aid, "HSE01", event="action_overdue") == 1 and outbox_to(aid, "HSE01") == 1, "3 days overdue: HSE push + email")
    check(outbox_to(aid, "SH-TN1") == 1, "3 days overdue: site head email")
    check(sql1("select escalation_level from actions where id = $1::uuid", aid) == 2)
    check(aid in [x["id"] for x in A.get("SO-TN1", "/actions", params={"overdue": "1", "pageSize": 500}).json()["items"]], "WF2-07: in the overdue list")


@case("EHS-ACT-141", "EHS-WF2-10", "EHS-WF2-05", "EHS-RPT-048")
def _():
    aid = IDS["timed"]
    run_job("send_emails", smtp=False)
    check(sql1("""select count(*) from email_outbox e join notifications n on n.id = e.notification_id where n.record_id = $1 and e.sent_at is null""", aid) >= 2,
          "without an email server the emails stay queued")
    MAILS.clear()
    for _ in range(40):  # the sender takes 50 queued emails per run; earlier cases left a backlog
        run_job("send_emails")
        if not sql1("select count(*) from email_outbox where sent_at is null and attempts < 8"):
            break
    sh_mail = sql1("select email from users where employee_code = 'SH-TN1'")
    case_no = sql1("select case_no from actions where id = $1::uuid", aid)
    got = [m for m in MAILS if sh_mail in str(m["To"]) and case_no in str(m["Subject"])]
    check(got, f"site head email about {case_no} delivered ({len(MAILS)} mails caught)")
    body = got[0].get_content()
    check(case_no in str(got[0]["Subject"]) + body, "case number in the email")
    check(f"/a/{aid}" in body, "link to the action in the email")
    check(sql1("select count(*) from email_outbox e join notifications n on n.id = e.notification_id where n.record_id = $1 and e.sent_at is null", aid) == 0, "all sent")
    check(sql1("select count(*) from notifications where record_id = $1 and channel = 'email' and status = 'sent'", aid) >= 2, "log shows sent")


@case("EHS-ACT-136", "EHS-WF2-08")
def _():
    aid = IDS["timed"]
    st(complete(aid, who=TOWN), 200)
    st(verify(aid), 200)
    reminders = lambda: sql1("select count(*) from notifications where record_id = $1 and event_type in ('action_due_soon','action_due_today','action_overdue')", aid)  # noqa: E731
    before = reminders()
    sql("delete from job_marks where key like $1", f"ladder:{aid}:%")  # even with the marks gone, a closed action is not chased
    run_job("ladder_job")
    check(reminders() == before, "no reminders after completion")
    check(sql1("select completed_at > original_due_at from actions where id = $1::uuid", aid) is True, "completed late: not counted on time")


@case("EHS-ACT-135", "EHS-WF2-09")
def _():
    aid = timed_action("extreme")
    m = timedelta(minutes=2)
    for delta, who, ev in ((timedelta(days=1) - m, "OWN-TN1-1", "action_due_soon"), (timedelta(hours=4) - m, "OWN-TN1-1", "action_due_soon"), (-m, "OWN-TN1-1", "action_due_today")):
        due_in(aid, delta)
        run_job("ladder_job")
    check(ntf(aid, TOWN, event="action_due_soon") == 2 and ntf(aid, TOWN, event="action_due_today") == 1, "owner steps")
    due_in(aid, -timedelta(hours=2) - m)
    run_job("ladder_job")
    for code in ("SO-TN1", "SH-TN1"):
        check(ntf(aid, code, event="action_overdue") == 1 and outbox_to(aid, code) == 1, f"{code}: push + email 2 hours after due")
    check(ntf(aid, "HSE01", event="action_overdue") == 0, "HSE not yet")
    due_in(aid, -timedelta(days=1) - m)
    run_job("ladder_job")
    check(ntf(aid, "HSE01", event="action_overdue") == 1 and outbox_to(aid, "HSE01") == 1, "HSE 1 day after")
    IDS["timed_extreme"] = aid


@case("EHS-ACT-138")
def _():
    s = A.get("ADMIN01", "/admin/settings").json()
    now_l = datetime.now(timezone(timedelta(hours=5, minutes=30)))
    window = {"start": (now_l - timedelta(hours=1)).strftime("%H:%M"), "end": (now_l + timedelta(hours=1)).strftime("%H:%M")}
    st(A.put("ADMIN01", "/admin/settings", {**s, "quietHours": window}), 200)
    try:
        mod = timed_action()
        ext = timed_action("extreme")
        due_in(mod, timedelta(days=7) - timedelta(minutes=2))
        due_in(ext, timedelta(days=1) - timedelta(minutes=2))
        run_job("ladder_job")
        held = sql1("select send_after is not null from notifications where record_id = $1 and channel = 'push' order by id desc limit 1", mod)
        ext_row = sql("select send_after, critical from notifications where record_id = $1 and channel = 'push' and event_type = 'action_due_soon' order by id desc limit 1", ext)
        check(held is True, "moderate reminder held until quiet hours end")
        check(ext_row and ext_row[0]["send_after"] is None and ext_row[0]["critical"] is True, f"extreme reminder not held (F14): {ext_row}")
    finally:
        st(A.put("ADMIN01", "/admin/settings", s), 200)


@case("EHS-ACT-139")
def _():
    owner = "OWN-TN3-1"
    sql("update users set preferences = '{\"quietHours\": false}'::jsonb where employee_code = $1", owner)
    sql("insert into user_site_roles (user_id, site_id, role) values ($1::uuid, $2::uuid, 'action_owner') on conflict do nothing", uid(owner), site("TN1"))
    ids = [timed_action(owner=owner) for _ in range(7)]
    for aid in ids:
        due_in(aid, timedelta(days=7) - timedelta(minutes=2))
    run_job("ladder_job")
    pushes = sql1("""select count(*) from notifications where recipient_user_id = $1::uuid and channel = 'push' and created_at > now() - interval '24 hours'
                     and event_type in ('action_due_soon','action_due_today','action_overdue')""", uid(owner))
    inapp = sum(ntf(a, owner, event="action_due_soon") for a in ids)
    check(pushes == 5 and inapp == 7, f"push capped at 5 a day ({pushes}); all 7 in the app ({inapp})")


@case("EHS-ACT-137")
def _():
    aid = timed_action()
    st(A.post(TOWN, f"/actions/{aid}/requests", req_body("dispute", reason="Not my area")), 200, 201)
    due_in(aid, -timedelta(days=3) - timedelta(minutes=2))
    run_job("ladder_job")
    check(sql1("select count(*) from notifications where record_id = $1 and event_type in ('action_due_soon','action_due_today','action_overdue')", aid) == 0, "no reminders while disputed")


@case("EHS-ACT-140", "EHS-ADM-144")
def _():
    lads = A.get("HSE01", "/admin/ladders").json()
    orig = json.loads(json.dumps(lads))
    mod = next(l for l in lads if l["band"] == "moderate")
    for stp in mod["steps"]:
        if stp["recipient"] == "site_safety_officer" and stp["offsetMinutes"] == 1440:
            stp["offsetMinutes"] = 2880
    st(A.put("HSE01", "/admin/ladders", {"items": [mod]}), 200)
    try:
        aid = timed_action()
        due_in(aid, -timedelta(days=1) - timedelta(minutes=2))
        run_job("ladder_job")
        check(ntf(aid, "SO-TN1", event="action_overdue") == 0, "officer step moved to 2 days")
        due_in(aid, -timedelta(days=2) - timedelta(minutes=2))
        run_job("ladder_job")
        check(ntf(aid, "SO-TN1", event="action_overdue") == 1, "officer told at 2 days")
        check(sql1("select count(*) from audit_log where record_type = 'reminder_ladders' and action = 'config_change'") >= 1, "audit row")
    finally:
        st(A.put("HSE01", "/admin/ladders", {"items": [next(l for l in orig if l["band"] == "moderate")]}), 200)


@case("EHS-ACT-142")
def _():
    aid = timed_action()
    due_in(aid, timedelta(days=7) - timedelta(minutes=2))
    env = {**os.environ, "DATABASE_URL": DB, "SMTP_URL": ""}
    procs = [subprocess.Popen([PY, str(ROOT / "portal" / "e2e" / "run_job.py"), "ladder_job"], cwd=SERVER, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE) for _ in range(2)]
    for p in procs:
        p.wait(timeout=300)
    check(ntf(aid, TOWN, event="action_due_soon") == 1, "two processes at once: the step is sent once")


@case("EHS-ACT-077")
def _():
    aid = timed_action("high")
    st(complete(aid, who=TOWN), 200)
    sql("update actions set completed_at = now() - interval '73 hours' where id = $1::uuid", aid)
    run_job("ladder_job")
    check(ntf(aid, "VER-TN1", event="verification_sla") == 1, "verifier told: waiting longer than 72 hours")


@case("EHS-ADM-141", "EHS-ADM-142", "EHS-ADM-143")
def _():
    rules = A.get("HSE01", "/admin/due-date-rules").json()
    orig = [r for r in rules if r.get("siteId") is None]
    high = dict(next(r for r in orig if r["band"] == "high"))
    try:
        st(A.put("HSE01", "/admin/due-date-rules", {"items": [{**high, "dueAmount": 5, "dueUnit": "days"}]}), 200)
        d = st(A.post("SO-TN2-f", "/actions", manual_action(siteId=site("TN2"), band="high", interimControl="x", ownerUserId=uid("OWN-TN2-1"))), 200, 201).json()
        days = (datetime.fromisoformat(d["dueAt"].replace("Z", "+00:00")) - datetime.now(timezone.utc)).total_seconds() / 86400
        check(4.9 < days < 5.1, f"high now 5 days ({days:.1f})")
        st(A.put("HSE01", "/admin/due-date-rules", {"items": [{**high, "id": None, "siteId": site("TN1"), "dueAmount": 3, "dueUnit": "days"}]}), 200)
        d1 = st(A.post("SO-TN1", "/actions", manual_action(band="high", interimControl="x")), 200, 201).json()
        days1 = (datetime.fromisoformat(d1["dueAt"].replace("Z", "+00:00")) - datetime.now(timezone.utc)).total_seconds() / 86400
        check(2.9 < days1 < 3.1, f"TN1 site rule 3 days ({days1:.1f})")
        st(A.put("HSE01", "/admin/due-date-rules", {"items": [{**high, "dueAmount": -1}]}), 400)
    finally:
        sql("delete from due_date_rules where site_id is not null and band = 'high'")
        A.put("HSE01", "/admin/due-date-rules", {"items": [high]})


@case("EHS-INS-047", "EHS-INS-048")
def _():
    run_job("inspection_scheduler")
    run_job("inspection_scheduler")
    dup = sql1("select count(*) from (select schedule_id, due_at from inspection_runs where schedule_id is not null group by 1, 2 having count(*) > 1) x")
    check(dup == 0, f"{dup} schedules with two runs for one due time")
    tv = next(t for t in A.get("VER-TN1", "/inspections/templates").json() if t["status"] == "active")
    st(A.post("SO-TN1-admin", "/admin/inspections/schedules", sched_body(templateId=tv["templateId"], frequency={"every": 1, "unit": "day", "time": "08:00"})), 200, 201)
    run_job("inspection_scheduler")
    rid = sql1("""select r.id::text from inspection_runs r join sites s on s.id = r.site_id where r.status = 'scheduled' and s.code = 'TN1' and r.schedule_id is not null limit 1""")
    check(rid, "a scheduled TN1 run exists")
    sql("update inspection_runs set due_at = now() - interval '3 days' where id = $1::uuid", rid)
    run_job("inspection_scheduler")
    check(sql1("select status from inspection_runs where id = $1::uuid", rid) == "missed", "marked missed")
    check(ntf(rid, "SO-TN1", event="inspection_missed") == 1, "officer told")


@case("EHS-RPT-044", "EHS-RPT-045")
def _():
    A.put("SO-TN2-f", "/me/preferences", {"language": "en", "digest": "off", "quietHours": True})
    before = {c: sql1("select count(*) from notifications where recipient_user_id = $1::uuid and event_type = 'digest_daily' and channel = 'inapp'", uid(c)) for c in ("SO-TN1", "SO-TN2")}
    run_job("digests", "daily")
    check(sql1("select count(*) from notifications where recipient_user_id = $1::uuid and event_type = 'digest_daily' and channel = 'inapp'", uid("SO-TN1")) == before["SO-TN1"] + 1, "officer gets the daily digest")
    check(sql1("select count(*) from notifications where recipient_user_id = $1::uuid and event_type = 'digest_daily' and channel = 'inapp'", uid("SO-TN2")) == before["SO-TN2"], "digest Off: none")
    body = sql1("select body from notifications where recipient_user_id = $1::uuid and event_type = 'digest_daily' and channel = 'inapp' order by id desc limit 1", uid("SO-TN1"))
    check(body and len(body.splitlines()) >= 3, "digest lists the counts")
    mail_body = sql1("select body from email_outbox where to_addr = (select email from users where employee_code = 'SO-TN1') order by id desc limit 1")
    check("ntf." not in mail_body, f"no raw text codes in the digest email (F15): {mail_body[-160:]!r}")
    so_mail = sql1("select email from users where employee_code = 'SO-TN1'")
    check(sql1("select count(*) from email_outbox where to_addr = $1 and created_at > now() - interval '5 minutes'", so_mail) >= 1, "digest email queued")
    run_job("digests", "weekly")
    check(sql1("select count(*) from notifications where recipient_user_id = $1::uuid and event_type = 'digest_weekly'", uid("SH-TN1")) >= 1, "site head weekly digest")


@case("EHS-OBS-209", "EHS-WF4-01", "EHS-WF4-02", "EHS-WF4-05")
def _():
    o = create_obs(imminentDanger=True, description="Plan: live cable in water (timed)")
    check(ntf(o["id"], "SO-TN1") >= 1 and ntf(o["id"], "SH-TN1") >= 1, "WF4-01: officer and site head alerted at once")
    sql("update observations set received_at = now() - interval '31 minutes' where id = $1::uuid", o["id"])
    run_job("critical_ack_watcher")
    check(sql1("select count(*) from escalations where record_id = $1::uuid and reason = 'critical_unacknowledged'", o["id"]) == 1, "escalated after 30 minutes")
    run_job("critical_ack_watcher")
    check(sql1("select count(*) from escalations where record_id = $1::uuid and reason = 'critical_unacknowledged'", o["id"]) == 1, "not twice for the same level")
    n0 = {x["key"]: x for x in A.get("SO-TN1", "/dashboard").json()["kpis"]}["critical_ack_median"]["n"] or 0
    st(A.post("SO-TN1", f"/observations/{o['id']}/ack-critical"), 200)
    sql("update observations set received_at = now() - interval '95 minutes' where id = $1::uuid", o["id"])
    run_job("critical_ack_watcher")
    check(sql1("select count(*) from escalations where record_id = $1::uuid", o["id"]) == 1, "no escalation after acknowledgement")
    n1 = {x["key"]: x for x in A.get("SO-TN1", "/dashboard").json()["kpis"]}["critical_ack_median"]["n"] or 0
    check(n1 == n0 + 1, f"WF4-05: median includes the case ({n0} → {n1})")


@case("EHS-OBS-184")
def _():
    o = create_obs(description="Plan: waiting for triage")
    sql("update observations set received_at = now() - interval '6 days' where id = $1::uuid", o["id"])
    sql("delete from job_marks where key like 'triage_%'")
    run_job("ladder_job")
    tn1 = site("TN1")
    check(sql1("select count(*) from notifications where event_type = 'triage_sla' and recipient_user_id = $1::uuid and created_at > now() - interval '2 minutes'", uid("SO-TN1")) >= 1, "officer reminded")
    check(sql1("select count(*) from notifications where template_code = 'triage_escalate' and recipient_user_id = $1::uuid and created_at > now() - interval '2 minutes'", uid("SH-TN1")) >= 1, "site head told")
    check(sql1("select count(*) from escalations where record_id = $1::uuid and reason = 'triage_sla'", o["id"]) == 1, "escalation row")
    links = {r[0] for r in sql("select distinct link from notifications where event_type = 'triage_sla' and channel = 'inapp' and created_at > now() - interval '2 minutes'")}
    check(links == {"/reports?tab=triage"}, f"reminder opens Reports → Triage (F16): {links}")
    _ = tn1


@case("EHS-OBS-213", "EHS-OBS-103")
def _():
    o, aid = new_action()
    oa = create_obs(anonymous=True, description="Plan anonymous closure")
    d = assign(oa["id"])
    for a in (aid, d["actions"][0]["id"]):
        complete(a)
        verify(a)
    sql("update observations set closed_at = now() - interval '31 minutes' where id = any($1::uuid[])", [o["id"], oa["id"]])
    run_job("closure_notices")
    check(ntf(o["id"], "WORKER-TN1-1", event="observation_closed") >= 1, "named reporter told")
    check(ntf(oa["id"], "WORKER-TN1-1", event="observation_closed") >= 1, "anonymous reporter told through the seal")


@case("EHS-ADM-212")
def _():
    s = A.get("ADMIN01", "/admin/settings").json()
    roles = s.get("mfaRequiredRoles", ["admin", "hse_manager", "site_head"])
    st(A.put("ADMIN01", "/admin/settings", {**s, "mfaRequiredRoles": roles + ["site_safety_officer"]}), 200)
    try:
        r = st(A.raw_login("SO-TN3", "NewStaffPass2026", "admin"), 200).json()
        check(r.get("mfaRequired") is True, "officer now asked for a code")
    finally:
        st(A.put("ADMIN01", "/admin/settings", s), 200)


@case("EHS-ADM-213")
def _():
    s = A.get("ADMIN01", "/admin/settings").json()
    st(A.put("ADMIN01", "/admin/settings", {**s, "maxPhotosPerRecord": 4}), 200)
    try:
        st(A.post("WORKER-TN1-1", "/observations", obs_body(media=[media_ref() for _ in range(5)])), 400)
        st(A.post("WORKER-TN1-1", "/observations", obs_body(media=[media_ref() for _ in range(4)])), 200, 201)
    finally:
        st(A.put("ADMIN01", "/admin/settings", s), 200)


@case("EHS-ADM-222")
def _():
    r = st(A.post("ADMIN01", "/admin/privacy/requests", {"personName": "Plan Worker", "identifier": "PLAN-PRIV-1", "type": "access", "details": "Copy of my data"}), 200, 201).json()
    rid = next(x["id"] for x in r if x["identifier"] == "PLAN-PRIV-1")
    st(A.put("ADMIN01", f"/admin/privacy/requests/{rid}", {"status": "answered", "response": "Sent"}), 200)
    check(sql1("select count(*) from audit_log where record_id = $1", rid) >= 1, "audit row")


@case("EHS-ADM-230", "EHS-ADM-232", "EHS-ADM-233")
def _():
    pols = A.get("ADMIN01", "/admin/retention-policies").json()
    obs = next(p for p in pols if p["recordType"] == "observation")
    st(A.put("ADMIN01", "/admin/retention-policies", {"items": [{**obs, "retentionYears": 5}]}), 200)
    st(A.put("ADMIN01", "/admin/retention-policies", {"items": [{**obs, "retentionYears": 0}]}), 400)
    r = st(A.post("ADMIN01", "/admin/legal-holds", {"scopeType": "site", "scopeId": site("TN1"), "reason": "Plan inspection by the Inspector of Factories"}), 200, 201).json()
    h = next(x for x in (r if isinstance(r, list) else [r]) if x["reason"].startswith("Plan inspection"))
    st(A.post("ADMIN01", f"/admin/legal-holds/{h['id']}/release"), 200)
    check(sql1("select released_at is not null from legal_holds where id = $1::uuid", h["id"]) is True, "released with time")


# ---------------------------------------------------------------- run
def plan_ids() -> list[tuple[str, str]]:
    out = []
    for line in PLAN.read_text().splitlines():
        m = re.match(r"^\| (EHS-[A-Z0-9]+-[0-9]+) \| ([^|]*) \| ([^|]*) \| ([^|]*) \|", line)
        if m:
            out.append((m.group(1), f"{m.group(3).strip()} — {m.group(4).strip()}"))
    return out


def main() -> None:
    global A
    OUT.mkdir(parents=True, exist_ok=True)
    global SMTP_URL
    proc, base = start_server()
    SMTP_URL = start_smtp_sink()
    A = Api(base)
    try:
        for r in sql("select employee_code, id::text from users where employee_code <> ''"):
            IDS["u:" + r[0]] = r[1]
        for r in sql("select code, id::text from sites"):
            IDS["s:" + r[0]] = r[1]
        IDS["own_company"] = sql1("select id::text from contractors where is_own_company")
        IDS["qr:TN1"] = sql1("select q.token from qr_codes q join areas a on a.id = q.target_id join sites s on s.id = a.site_id where s.code = 'TN1' and q.target_type = 'area' and q.active limit 1")
        for code in ("WORKER-TN1-1", "WORKER-TN1-2", "OWN-TN1-1", "OWN-TN1-2", "OWN-TN1-3", "VER-TN1", "SO-TN1", "OWN-TN2-1", "WORKER-TN2-1", "WORKER-KA1-1", "OWN-KA1-1"):
            A.login(code)
        A.login("SO-TN2", name="SO-TN2-f")
        A.login("SO-KA1", name="SO-KA1-f")
        A.login("ADMIN01", ADMIN_PW, "admin")
        A.login("HSE01", kind="admin")
        A.login("AUD01", kind="admin", name="AUD01-admin")
        A.login("SH-TN1", kind="field", name="SH-TN1-field")
        A.login("SH-TN1", kind="admin", name="SH-TN1-admin")
        A.login("SO-TN1", kind="admin", name="SO-TN1-admin")
        for ids, fn in CASES:
            t0 = time.time()
            try:
                fn()
                res = ("PASS", "")
            except Fail as e:
                res = ("FAIL", str(e))
            except Exception as e:  # a crash in the runner or an unexpected answer shape
                res = ("ERROR", f"{type(e).__name__}: {e}")
                traceback.print_exc()
            for i in ids:
                RESULTS[i] = res
            print(f"{res[0]:5} {', '.join(ids)} ({time.time() - t0:.1f}s) {res[1][:160]}")
    finally:
        proc.terminate()
    write_results()


DEFECTS = [
    "## Defects found and fixed",
    "",
    "| # | Defect | Fix | Proved by |",
    "|---|---|---|---|",
    "| F1 | A report dated in the future was stored as sent | Capture times more than 5 minutes ahead are replaced by the time the server received the report; the claimed time is kept with the report's details | EHS-OBS-020, `test_f1_*` |",
    "| F2 | The server accepted a report with no category | Server requires at least one category (phone, web and QR form) | EHS-OBS-014/016, `test_f2_*` |",
    "| F3 | \"Fixed on the spot\" without what was done was accepted | Server requires the text | EHS-OBS-029/030, `test_f3_*` |",
    "| F4 | Verifiers could export | Exports limited to officers, site heads, HSE managers, admins and auditors, and only for the sites where they hold that role | EHS-DSH-033, EHS-RPT-012, `test_f4_*` |",
    "| F5 | Console showed Notifications log to auditors; the server refused them | Menu item shown to admin and HSE manager only (matches the server) | EHS-ADM-262 |",
    "| F6 | Server allowed HSE managers into Health; the menu hid it | Menu shows Health to admin and HSE manager | EHS-ADM-290 |",
    "| F7 | Dashboard with \"from\" after \"to\" showed zeros | Dates are swapped into a range (as Charts already did) | EHS-DSH-009, `test_f7_*` |",
    "| F8 | Who may acknowledge a danger-now alert | Not a defect: only safety officers, site heads and HSE managers of the site (confirmed) | EHS-OBS-210, `test_f8_*` |",
    "| F9 | CSV export could carry spreadsheet formulas (CSV injection) | Text starting with = + - @ tab or CR gets a leading apostrophe; .xlsx was already safe | EHS-RPT-024, `test_f9_*` |",
    "| F10 | External auditors could create reports, comments and inspection runs from the phone app | Auditor-only accounts are read-only in the field API too | EHS-OBS-055, `test_f10_*` |",
    "| F11 | A site could be created with an empty name | English name required | EHS-ADM-006, `test_f11_*` |",
    "| F12 | The server accepted malformed emails such as `abc@` | Same email rule as the console form, on create and edit | EHS-ADM-097, `test_f12_*` |",
    "| F13 | Phone-app pages never opened while online could not open offline | After sign-in with a connection, every page is fetched in the background so the offline cache holds all of them | Browser run step 1 (outbox offline) |",
    "| F14 | Reminders and escalations for Extreme-risk actions were held by quiet hours (e.g. 2 am → 7 am) and counted against the daily push limit | Extreme-band reminders are sent as urgent: never held, never capped | EHS-ACT-138, `test_f14_*` |",
    "| F15 | Daily and weekly digest emails showed a raw code `ntf.digest_daily.body` | Digest closing text added in English, Hindi, Tamil and Kannada; a test now checks every notification text exists in all four | EHS-RPT-044, `test_f15_*` |",
    "| F16 | The \"triage overdue\" reminder (app and email to the site head) linked to `/inbox`, a page the phone app does not have | Links to Reports → Triage | EHS-OBS-184, `test_f16_*` |",
    "",
    "Plan correction: EHS-INS-084/085 said a safety officer may reopen a submitted inspection; the system (by design) allows only admin and HSE manager, because a submitted report is locked. The plan was corrected.",
]


def write_results() -> None:
    plan = plan_ids()
    known = {i for i, _ in plan}
    extra = sorted(set(RESULTS) - known)
    counts = {"PASS": 0, "FAIL": 0, "ERROR": 0}
    for i, _ in plan:
        if i in RESULTS:
            counts[RESULTS[i][0]] += 1
    total, run_n = len(plan), sum(counts.values())
    lines = [
        "# SafeWorks Portal 2.1: test results",
        "",
        f"Run on {datetime.now(timezone.utc).astimezone().strftime('%Y-%m-%d %H:%M %Z')} against a fresh demo database with `portal/e2e/run_test_plan.py` "
        "(API cases) and `portal/e2e/e2e-real.cjs` (browser). Test cases are those of `portal/docs/TEST-PLAN.md`.",
        "",
        "| | Count |",
        "|---|---|",
        f"| Cases in the plan | {total} |",
        f"| Run automatically (API) | {run_n} |",
        f"| Passed | {counts['PASS']} |",
        f"| Failed | {counts['FAIL']} |",
        f"| Runner error | {counts['ERROR']} |",
        f"| Not automated (UI, timing or manual; see the browser run and the list below) | {total - run_n} |",
        "",
        "## Results by case",
        "",
        "| Test ID | What | Result | Note |",
        "|---|---|---|---|",
    ]
    for i, what in plan:
        r = RESULTS.get(i)
        res, note = r if r else ("Not automated", "")
        lines.append(f"| {i} | {what.replace('|', '/')} | {res} | {note.replace('|', '/')[:200]} |")
    if extra:
        lines += ["", "Runner IDs not found in the plan: " + ", ".join(extra)]
    browser = Path(os.environ.get("E2E_RESULTS", OUT / "e2e-real-results.json"))
    if browser.exists():
        checks = json.loads(browser.read_text())["results"]
        ok = sum(1 for c in checks if c["ok"])
        lines += ["", "## Browser run (`e2e-real.cjs`: field app 390×844, QR form, admin console 1280×800)", "",
                  f"**{ok} of {len(checks)} checks passed.** It covers the screens behind many of the \"not automated\" UI cases above "
                  "(quick report online and offline, outbox, triage sheet, completion with after-photo, verification, QR form in Tamil, "
                  "console MFA, site set-up, posters, user import, template approval, audit-chain verify, language switch, site isolation).", "",
                  "| Check | Result |", "|---|---|"]
        lines += [f"| {c['name'].replace('|', '/')} | {'PASS' if c['ok'] else 'FAIL'} |" for c in checks]
    lines[lines.index("## Results by case"):lines.index("## Results by case")] = DEFECTS + [""]
    RESULTS_MD.write_text("\n".join(lines) + "\n")
    (OUT / "plan-results.json").write_text(json.dumps({k: {"result": v[0], "note": v[1]} for k, v in RESULTS.items()}, indent=1))
    print(f"\n{counts['PASS']} passed, {counts['FAIL']} failed, {counts['ERROR']} errors, {total - run_n} not automated (of {total})")


if __name__ == "__main__":
    main()
