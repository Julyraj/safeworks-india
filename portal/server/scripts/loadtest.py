"""Load test: N people on one site using SafeWorks at the same time.

    BASE_URL=https://safeworks.example.in ADMIN_ID=ADMIN01 ADMIN_PASSWORD=… USERS=100 DURATION=1800 python scripts/loadtest.py

Options:
  SITES=10    spread the users over 10 sites (scale gate: USERS=1000 SITES=10 RAMP=120)
  RAMP=60     spread the sign-ins over 60 s
  PROCS=4     drive the virtual users from 4 processes (default: one per 250 users, at most the CPU count)
Setup (through the admin API, so it works against any deployment):
  - creates sites LT01… "Load test site n" if missing; per site up to 5 safety officers, the rest supervisors (LT-LT01-SO-n / LT-LT01-SUP-n)
  - each virtual user signs in and replaces the temporary password, like a real first login
Scenario (repeats until DURATION seconds):
  - safety officers: dashboard → raise a point with 2 photos (~0.9 MB) assigned to a supervisor → open lists → approve closures
  - supervisors: dashboard → my open points → open one → submit closure with 1 photo → notifications
Then a resilience check: uploads cut off mid-way and retried with the same ID must give exactly one point each.
Pass mark (from the structure document): < 0.1% failed requests, 95% of screens < 2 s, a 2-photo upload < 10 s, no lost or duplicate points.
If the test machine itself runs out of CPU, its own delay is reported and the result says so: rerun from a bigger machine or with more PROCS.
Needs: pip install httpx
"""
from __future__ import annotations

import asyncio
import json
import math
import multiprocessing as mp
import os
import random
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import quote

import httpx

HERE = Path(__file__).resolve().parent
BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
USERS = int(os.environ.get("USERS", "100"))
DURATION = float(os.environ.get("DURATION", "180"))
ADMIN_ID = os.environ.get("ADMIN_ID", "ADMIN01")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
SITES = max(1, int(os.environ.get("SITES", "1")))
RAMP = float(os.environ.get("RAMP", "10"))
PROCS = max(1, int(os.environ.get("PROCS") or min(os.cpu_count() or 1, math.ceil(USERS / 250))))
PER_SITE = math.ceil(USERS / SITES)
OFFICERS = min(5, max(1, round(PER_SITE / 20)))
PASSWORD = "LoadTest2026"
REPORT = os.environ.get("REPORT") or str(Path.cwd() / f"loadtest-report-{int(time.time() * 1000)}.json")
PHOTOS = [(HERE.parent / "tests" / "fixtures" / f"photo-{i}.jpg").read_bytes() for i in (1, 2)]
LAG_LIMIT_MS = 250  # test-machine delay above which its own timings are not trustworthy

# A second officer approving the same closure a moment later gets 409: correct behaviour, not a failure.
EXPECTED = {"approve closure": {409}}


def site_code(i: int) -> str:
    return f"LT{i + 1:02d}"


# Per process: (label, ms seen by the test, ok, status, ms inside the server or None)
samples: list[tuple[str, float, bool, int, float | None]] = []
errors: dict[str, int] = {}
counters = {"expected_conflicts": 0, "created": 0}
client: httpx.AsyncClient


def _form(data: dict, photos: list[tuple[str, bytes, str]]) -> list:
    return [("data", (None, json.dumps(data)))] + [(field, (name, buf, "image/jpeg")) for field, buf, name in photos]


async def req(label: str, token: str | None, method: str, path: str, body=None, files=None):
    headers = {"authorization": f"Bearer {token}"} if token else {}
    t0 = time.perf_counter()
    status = 0
    try:
        res = await client.request(method, BASE + path, headers=headers, json=body, files=files)
        status = res.status_code
        text = res.text
        ms = (time.perf_counter() - t0) * 1000
        good = 200 <= status < 300
        expected = not good and status in EXPECTED.get(label, set())
        if expected:
            counters["expected_conflicts"] += 1
        ok = good or expected
        st = res.headers.get("server-timing", "")
        srv = float(st.split("dur=")[1]) if "dur=" in st else None
        samples.append((label, ms, ok, status, srv))
        if not ok:
            k = f"{label} → {status} {text[:120]}"
            errors[k] = errors.get(k, 0) + 1
            return None
        return json.loads(text) if text else None
    except Exception as e:  # network error, timeout
        samples.append((label, (time.perf_counter() - t0) * 1000, False, status, None))
        k = f"{label} → network {type(e).__name__} {e}"[:200]
        errors[k] = errors.get(k, 0) + 1
        return None


async def think(a: float, b: float) -> None:
    await asyncio.sleep(random.uniform(a, b) / 1000)


def new_client(n: int) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(60, connect=30), limits=httpx.Limits(max_connections=n + 20, max_keepalive_connections=n + 20))


# ------------------------------------------------------------------ setup (main process)

async def setup() -> dict:
    if not ADMIN_PASSWORD:
        raise SystemExit("Set ADMIN_PASSWORD (and ADMIN_ID) of an admin login.")
    login = await req("setup", None, "POST", "/api/auth/login", {"employeeId": ADMIN_ID, "password": ADMIN_PASSWORD, "app": "admin"})
    if not login:
        raise SystemExit("Admin login failed: " + json.dumps(errors))
    at = login["token"]
    existing = (await req("setup", at, "GET", "/api/admin/sites"))["sites"]
    site_ids: list[str] = []
    for k in range(SITES):
        site = next((x for x in existing if x["code"] == site_code(k)), None)
        if not site:
            c = await req("setup", at, "POST", "/api/admin/sites",
                          {"code": site_code(k), "name": f"Load test site {k + 1}", "siteType": "construction", "state": "Tamil Nadu" if k % 2 else "Karnataka"})
            site = {"id": c["id"]}
            for a in ["Block A", "Block B", "Yard"]:
                await req("setup", at, "POST", f"/api/admin/sites/{site['id']}/areas", {"name": a})
        site_ids.append(site["id"])

    async def all_lt_users() -> list[dict]:
        out: list[dict] = []
        page = 1
        while True:
            r = await req("setup", at, "GET", f"/api/admin/users?q=LT-&pageSize=500&page={page}&status=all")
            out += (r or {}).get("users", [])
            if not r or len(out) >= r["total"]:
                return out
            page += 1

    have = {u["employeeId"] for u in await all_lt_users()}
    lines = ["employee_id,name,designation,role,site_code"]
    users: list[dict] = []
    for i in range(USERS):
        k, j = divmod(i, PER_SITE)
        so = j < OFFICERS
        emp = f"LT-{site_code(k)}-SO-{j + 1}" if so else f"LT-{site_code(k)}-SUP-{j - OFFICERS + 1}"
        users.append({"i": i, "emp": emp, "role": "so" if so else "sup", "site": k})
        if emp not in have:
            lines.append(f"{emp},Load {'Officer' if so else 'Supervisor'} {i + 1},{'Safety Officer' if so else 'Supervisor'},{'safety officer' if so else 'supervisor'},{site_code(k)}")
    temp: dict[str, str] = {}
    for i in range(1, len(lines), 400):
        chunk = [lines[0], *lines[i:i + 400]]
        imp = await req("setup", at, "POST", "/api/admin/users/import", {"csv": "\n".join(chunk)})
        if not imp or imp.get("errors"):
            raise SystemExit("Import failed: " + json.dumps((imp or {}).get("errors") or errors))
        for c in imp["created"]:
            temp[c["employeeId"]] = c["tempPassword"]
    # Existing load-test users: reset to a known password so the run is repeatable.
    wanted = {u["emp"] for u in users}
    ids: dict[str, str] = {}
    for u in await all_lt_users():
        ids[u["employeeId"]] = u["id"]
        if u["employeeId"] in wanted and u["employeeId"] not in temp:
            await req("setup", at, "POST", f"/api/admin/users/{u['id']}/password", {"mode": "set", "password": PASSWORD, "mustChange": False})
            if u.get("locked"):
                await req("setup", at, "POST", f"/api/admin/users/{u['id']}/unlock")
    owners = [[ids[u["emp"]] for u in users if u["site"] == k and u["role"] == "sup" and u["emp"] in ids] for k in range(SITES)]
    for k in range(SITES):
        if not owners[k]:
            raise SystemExit(f"Site {site_code(k)} has no supervisors: use more USERS per site.")
    return {"site_ids": site_ids, "users": users, "temp": temp, "owners": owners}


# ------------------------------------------------------------------ virtual users (worker processes)

def new_point(site_id: str, owners: list[str], **extra) -> dict:
    p = {
        "id": str(uuid.uuid4()), "siteId": site_id, "type": random.choice(["unsafe_condition", "unsafe_act"]), "categoryCode": "C02", "itemCode": "C02-01",
        "hazard": "Fall from height", "personObserved": "Fitter – contractor", "severity": random.randint(1, 4), "likelihood": random.randint(1, 5),
        "description": "Load test point: guardrail missing at slab edge.", "immediateAction": "Barricaded / tagged out", "rootCause": "Procedure or supervision",
        "correctiveAction": "Fix guardrail.", "ownerId": random.choice(owners),
    }
    p.update(extra)
    return p


async def sign_in(u: dict, temp: dict[str, str]) -> dict | None:
    pw = temp.get(u["emp"], PASSWORD)
    r = await req("login", None, "POST", "/api/auth/login", {"employeeId": u["emp"], "password": pw, "app": "portal"})
    if not r:
        return None
    if r.get("mustChangePassword"):
        await req("change password", r["token"], "POST", "/api/auth/change-password", {"currentPassword": pw, "newPassword": PASSWORD})
    return {**u, "token": r["token"]}


async def officer(v: dict, site_id: str, owners: list[str], end: float) -> None:
    await req("home dashboard", v["token"], "GET", "/api/dashboard/me")
    await req("sites + master", v["token"], "GET", "/api/sites")
    await req("sites + master", v["token"], "GET", "/api/master")
    while time.time() < end:
        files = _form(new_point(site_id, owners), [("photos", PHOTOS[0], "p1.jpg"), ("photos", PHOTOS[1], "p2.jpg")])
        o = await req("raise point (2 photos)", v["token"], "POST", "/api/observations", files=files)
        if o:
            counters["created"] += 1
        await think(800, 2500)
        await req("observation list", v["token"], "GET", "/api/observations?status=open&pageSize=50")
        if o:
            await req("observation detail", v["token"], "GET", f"/api/observations/{o['id']}")
        await think(800, 2500)
        q = await req("approval queue", v["token"], "GET", "/api/observations?scope=approvals&status=awaiting&pageSize=20")
        for it in ((q or {}).get("items") or [])[:2]:
            await req("observation detail", v["token"], "GET", f"/api/observations/{it['id']}")
            await req("approve closure", v["token"], "POST", f"/api/observations/{it['id']}/decision", {"decision": "approve", "remarks": "Verified"})
        await req("home dashboard", v["token"], "GET", "/api/dashboard/me")
        await think(1500, 4000)


async def supervisor(v: dict, end: float) -> None:
    await req("home dashboard", v["token"], "GET", "/api/dashboard/me")
    await req("sites + master", v["token"], "GET", "/api/sites")
    while time.time() < end:
        lst = await req("my points", v["token"], "GET", "/api/observations?scope=assigned&status=open&pageSize=50")
        await think(1500, 5000)
        items = (lst or {}).get("items") or []
        if items:
            it = items[0]
            await req("observation detail", v["token"], "GET", f"/api/observations/{it['id']}")
            await think(1000, 4000)
            if random.random() < 0.6:
                files = _form({"comment": "Fixed during load test."}, [("photos", PHOTOS[1], "after.jpg")])
                await req("submit closure (1 photo)", v["token"], "POST", f"/api/observations/{it['id']}/closure", files=files)
        await req("notifications", v["token"], "GET", "/api/notifications")
        await req("home dashboard", v["token"], "GET", "/api/dashboard/me")
        await think(3000, 9000)


async def _slice(job: dict) -> dict:
    """One process: sign in its share of the users (staggered over RAMP), wait for the common start, run until the common end."""
    global client
    samples.clear()
    errors.clear()
    counters.update(expected_conflicts=0, created=0)
    lag: list[float] = []
    stop = asyncio.Event()

    async def watch_lag():
        # How late this process wakes up = how far behind the test machine itself is.
        while not stop.is_set():
            t = time.perf_counter()
            await asyncio.sleep(0.5)
            lag.append((time.perf_counter() - t - 0.5) * 1000)

    watcher = asyncio.create_task(watch_lag())
    async with new_client(len(job["users"])) as c:
        client = c

        async def staggered(u: dict):
            await asyncio.sleep(max(0.0, job["t0"] + u["i"] / USERS * RAMP - time.time()))
            return await sign_in(u, job["temp"])

        vus = [x for x in await asyncio.gather(*(staggered(u) for u in job["users"])) if x]
        signed_in_at = time.time()
        await asyncio.sleep(max(0.0, job["go"] - time.time()))
        await asyncio.gather(*(officer(v, job["site_ids"][v["site"]], job["owners"][v["site"]], job["end"]) if v["role"] == "so" else supervisor(v, job["end"]) for v in vus))
    stop.set()
    await watcher
    return {"samples": samples, "errors": errors, "counters": counters, "lag": lag, "signedIn": len(vus), "signedInAt": signed_in_at}


def run_slice(job: dict) -> dict:
    return asyncio.run(_slice(job))


# ------------------------------------------------------------------ resilience + report (main process)

async def resilience(site_id: str, owners: list[str], emp: str) -> dict:
    """Cut uploads off mid-way, then retry with the same ID; each must end up as exactly one point."""
    ok = dup = lost = 0
    tries = 10
    login = await req("login", None, "POST", "/api/auth/login", {"employeeId": emp, "password": PASSWORD, "app": "portal"})
    if not login:
        return {"tried": tries, "ok": 0, "duplicates": 0, "lost": tries}
    token = login["token"]
    headers = {"authorization": f"Bearer {token}"}
    for _ in range(tries):
        data = new_point(site_id, owners, type="unsafe_condition", severity=2, likelihood=2, description="Resilience check point.", correctiveAction="Fix.")

        def make() -> list:
            return _form(data, [("photos", PHOTOS[0], "p1.jpg"), ("photos", PHOTOS[1], "p2.jpg")])

        async with httpx.AsyncClient(timeout=30) as cut_client:
            try:
                await asyncio.wait_for(cut_client.post(f"{BASE}/api/observations", headers=headers, files=make()), timeout=random.uniform(0.005, 0.045))
            except Exception:
                pass  # connection dropped on purpose
        # The phone retries from its queue, sometimes twice.
        first = await client.post(f"{BASE}/api/observations", headers=headers, files=make())
        second = await client.post(f"{BASE}/api/observations", headers=headers, files=make())
        a = first.json() if first.is_success else None
        b = second.json() if second.is_success else None
        if not a or not b:
            lost += 1
        elif a["code"] != b["code"] or a["id"] != data["id"]:
            dup += 1
        else:
            ok += 1
        lst = await req("resilience check", token, "GET", f"/api/observations?q={quote((a or {}).get('code', 'x'))}&status=any")
        if lst and lst["total"] != 1:
            dup += 1
    return {"tried": tries, "ok": ok, "duplicates": dup, "lost": lost}


def pctl(xs: list[float], p: float) -> float:
    if not xs:
        return 0
    s = sorted(xs)
    return s[min(len(s) - 1, int(p / 100 * len(s)))]


async def main_setup() -> dict:
    global client
    async with new_client(10) as c:
        client = c
        return await setup()


async def main_resilience(plan: dict) -> dict:
    global client
    async with new_client(10) as c:
        client = c
        so = next(u for u in plan["users"] if u["role"] == "so" and u["site"] == 0)
        return await resilience(plan["site_ids"][0], plan["owners"][0], so["emp"])


def main() -> int:
    print(f"SafeWorks load test → {BASE}: {USERS} users on {SITES} site(s) ({OFFICERS} safety officers per site) for {DURATION:g}s, "
          f"sign-in spread over {RAMP:g}s, {PROCS} test process{'es' if PROCS > 1 else ''}", flush=True)
    plan = asyncio.run(main_setup())
    samples.clear()
    errors.clear()
    t0 = time.time() + 2
    go = t0 + RAMP + 3
    end = go + DURATION
    jobs = [{**{k: plan[k] for k in ("site_ids", "temp", "owners")}, "users": plan["users"][p::PROCS], "t0": t0, "go": go, "end": end} for p in range(PROCS)]
    if PROCS == 1:
        results = [run_slice(jobs[0])]
    else:
        with mp.get_context("spawn").Pool(PROCS) as pool:
            pending = pool.map_async(run_slice, jobs)
            while not pending.ready():
                pending.wait(30)
                if not pending.ready():
                    print(f"  … {round(time.time() - t0)}s", flush=True)
            results = pending.get()
    signed = sum(r["signedIn"] for r in results)
    login_ms = (max(r["signedInAt"] for r in results) - t0) * 1000
    print(f"  {signed}/{USERS} signed in within {login_ms / 1000:.1f}s", flush=True)
    res = asyncio.run(main_resilience(plan))
    elapsed = time.time() - t0

    all_samples = [s for r in results for s in r["samples"]] + samples
    all_errors: dict[str, int] = dict(errors)
    for r in results:
        for k, v in r["errors"].items():
            all_errors[k] = all_errors.get(k, 0) + v
    expected_conflicts = sum(r["counters"]["expected_conflicts"] for r in results)
    created = sum(r["counters"]["created"] for r in results)
    lag = [x for r in results for x in r["lag"]]
    lag_p95 = pctl(lag, 95)

    labels = list(dict.fromkeys(s[0] for s in all_samples))
    rows = []
    for lb in labels:
        xs = [s for s in all_samples if s[0] == lb]
        ms = [s[1] for s in xs]
        srv = [s[4] for s in xs if s[4] is not None]
        rows.append({"label": lb, "count": len(xs), "failed": sum(1 for s in xs if not s[2]), "p50": round(pctl(ms, 50)), "p95": round(pctl(ms, 95)),
                     "p99": round(pctl(ms, 99)), "max": round(max(ms)), "serverP95": round(pctl(srv, 95)) if srv else None})
    total = len(all_samples)
    failed = sum(1 for s in all_samples if not s[2])
    is_screen = lambda s: "photo" not in s[0] and s[0] not in ("login", "change password")  # noqa: E731
    screens_p95 = pctl([s[1] for s in all_samples if is_screen(s)], 95)
    screens_srv_p95 = pctl([s[4] for s in all_samples if is_screen(s) and s[4] is not None], 95)
    upload_p95 = pctl([s[1] for s in all_samples if s[0] == "raise point (2 photos)"], 95)
    checks = [
        {"check": "Failed requests under 0.1%", "value": f"{failed / max(total, 1) * 100:.3f}% ({failed} of {total})", "pass": failed / max(total, 1) < 0.001},
        {"check": "95% of screens open in under 2 s", "value": f"p95 {round(screens_p95)} ms (inside the server {round(screens_srv_p95)} ms)", "pass": screens_p95 < 2000},
        {"check": "2-photo upload under 10 s (server side, LAN)", "value": f"p95 {round(upload_p95)} ms", "pass": upload_p95 < 10_000},
        {"check": "No lost or duplicated points after cut uploads", "value": f"{res['ok']}/{res['tried']} exact, {res['duplicates']} duplicates, {res['lost']} lost",
         "pass": res["duplicates"] == 0 and res["lost"] == 0},
    ]
    print("\nRequests by screen (ms):")
    print(f"  {'screen':32} {'count':>7} {'failed':>7} {'p50':>6} {'p95':>6} {'p99':>6} {'max':>7} {'server p95':>11}")
    for r in rows:
        print(f"  {r['label']:32} {r['count']:>7} {r['failed']:>7} {r['p50']:>6} {r['p95']:>6} {r['p99']:>6} {r['max']:>7} {r['serverP95'] if r['serverP95'] is not None else '-':>11}")
    print(f"Throughput: {total / elapsed:.1f} requests/s; points raised: {created}; expected 409s (closure already approved by another officer): {expected_conflicts}")
    if all_errors:
        print("Errors:", json.dumps(all_errors, indent=2, ensure_ascii=False))
    for ch in checks:
        print(f"  {'PASS' if ch['pass'] else 'FAIL'}  {ch['check']}: {ch['value']}")
    overloaded = lag_p95 > LAG_LIMIT_MS
    print(f"Test machine delay (p95): {round(lag_p95)} ms")
    passed = all(ch["pass"] for ch in checks)
    if overloaded:
        print(f"WARNING: the test machine itself fell behind (delay p95 {round(lag_p95)} ms > {LAG_LIMIT_MS} ms), so the times above include waiting inside\n"
              f"         the test machine. Compare the 'server p95' column, and rerun from a bigger machine or with more PROCS (now {PROCS}).")
    print("RESULT: PASS" if passed else ("RESULT: INCONCLUSIVE (test machine overloaded)" if overloaded and failed / max(total, 1) < 0.001 else "RESULT: FAIL"))
    Path(REPORT).write_text(json.dumps({
        "base": BASE, "users": USERS, "sites": SITES, "officersPerSite": OFFICERS, "procs": PROCS, "expectedConflicts": expected_conflicts, "durationS": DURATION,
        "loginRushMs": login_ms, "throughputRps": total / elapsed, "pointsRaised": created, "testMachineDelayP95Ms": lag_p95, "rows": rows, "checks": checks,
        "errors": all_errors, "resilience": res, "pass": passed, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }, indent=2, ensure_ascii=False))
    print(f"Report: {REPORT}")
    return 0 if passed else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"{type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(2)
