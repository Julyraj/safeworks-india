#!/usr/bin/env python
"""Load test: a 300-user mixed run against the 2.0 API (sync pull/push with photos, lists, triage, dashboard).

    BASE_URL=https://safeworks.example.in ADMIN_PASSWORD=… USERS=300 DURATION=120 REPORT=loadtest-report.json python scripts/loadtest.py

Environment (same names as 1.x): BASE_URL, ADMIN_ID, ADMIN_PASSWORD, USERS, DURATION, REPORT, plus DEMO_PASSWORD (falls back to
ADMIN_PASSWORD, exactly like the seed) and RAMP (seconds to spread the start). The run signs in as the demo site safety officer
SO-TN1, the owners OWN-TN1-1..3 and the workers WORKER-TN1-1..5 (`python scripts/seed.py --demo`); ADMIN01 needs MFA and is not used.
Scenario per virtual user (repeats until DURATION):
  worker  : pull → push one observation (1 photo) → upload the photo → my observations → notifications → delta pull
  owner   : my actions → action detail → notifications
  officer : inbox (submitted, critical first) → detail with duplicates → triage accept_assign (one action) → dashboard
Exit status is non-zero when any request fails (a 409 on a report two officers triage at the same moment is expected, not a failure).
Needs: pip install httpx
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import random
import statistics
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import httpx

HERE = Path(__file__).resolve().parent
BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
USERS = int(os.environ.get("USERS", "300"))
DURATION = float(os.environ.get("DURATION", "120"))
RAMP = float(os.environ.get("RAMP", "15"))
ADMIN_ID = os.environ.get("ADMIN_ID", "ADMIN01")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD") or ADMIN_PASSWORD
REPORT = os.environ.get("REPORT") or str(Path.cwd() / f"loadtest-report-{int(time.time() * 1000)}.json")
PHOTO = (HERE.parent / "tests" / "fixtures" / "photo-1.jpg").read_bytes()
SITE = os.environ.get("SITE", "TN1")
OFFICERS = ["SO-" + SITE]
OWNERS = [f"OWN-{SITE}-{i}" for i in (1, 2, 3)]
WORKERS = [f"WORKER-{SITE}-{i}" for i in range(1, 6)]
EXPECTED = {"triage": {409, 404}}  # someone else triaged it first / it left the inbox

results: list[tuple[str, float, bool, int, float | None]] = []
errors: list[dict] = []


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def call(client: httpx.AsyncClient, label: str, method: str, url: str, token: str | None = None, **kw) -> httpx.Response | None:
    headers = dict(kw.pop("headers", {}) or {})
    if token:
        headers["authorization"] = f"Bearer {token}"
    t0 = time.perf_counter()
    try:
        r = await client.request(method, BASE + url, headers=headers, timeout=60, **kw)
    except Exception as e:
        results.append((label, (time.perf_counter() - t0) * 1000, False, 0, None))
        errors.append({"label": label, "url": url, "error": str(e)[:300]})
        return None
    ms = (time.perf_counter() - t0) * 1000
    st = r.headers.get("server-timing", "")
    server_ms = float(st.split("dur=")[1].split(",")[0]) if "dur=" in st else None
    ok = r.status_code < 400 or r.status_code in EXPECTED.get(label, set())
    results.append((label, ms, ok, r.status_code, server_ms))
    if not ok:
        errors.append({"label": label, "url": url, "status": r.status_code, "body": r.text[:300]})
    return r


async def login(client: httpx.AsyncClient, code: str, kind: str = "field") -> str | None:
    r = await call(client, "login", "POST", "/api/v1/auth/login", json={"login": code, "password": DEMO_PASSWORD, "kind": kind, "deviceUuid": f"lt-{code}-{uuid.uuid4().hex[:6]}", "appVersion": "loadtest"})
    if r is None or r.status_code != 200:
        return None
    return r.json().get("token")


async def worker_loop(client: httpx.AsyncClient, token: str, me: dict, deadline: float, vu: int) -> None:
    site = me["sites"][0]
    device = f"lt-dev-{vu}"
    cursor = None
    while time.time() < deadline:
        r = await call(client, "pull", "GET", f"/api/v1/sync/pull?deviceId={device}" + (f"&cursor={quote(cursor)}" if cursor else ""), token)
        if r is not None and r.status_code == 200:
            pull = r.json()
            cursor = pull["cursor"]
            areas = [a for a in pull["areas"] if a["siteId"] == site["id"]]
            cats = [c["code"] for c in pull["categories"]] or ["HOUSE"]
            if areas:
                ref = {"clientUuid": str(uuid.uuid4()), "kind": "photo", "purpose": "before", "sha256": hashlib.sha256(PHOTO).hexdigest(), "bytes": len(PHOTO), "mime": "image/jpeg", "capturedAt": now_iso()}
                payload = {"clientUuid": str(uuid.uuid4()), "siteId": site["id"], "areaId": random.choice(areas)["id"], "lat": None, "lng": None, "accuracyM": None, "capturedAt": now_iso(),
                           "channel": "app", "reporterType": "contractor", "anonymous": random.random() < 0.1, "type": random.choice(["unsafe_condition", "unsafe_act", "good_practice", "near_miss"]),
                           "categoryCodes": [random.choice(cats)], "description": f"Load test report {vu} {random.randint(1, 9999)}: loose cable on the walkway", "descriptionLang": "en",
                           "fixedOnSpot": False, "imminentDanger": False, "media": [ref]}
                cmd = {"commandId": str(uuid.uuid4()), "seq": 1, "entityType": "observation", "op": "create", "entityClientUuid": payload["clientUuid"], "capturedAt": now_iso(), "payload": payload}
                r = await call(client, "push create", "POST", "/api/v1/sync/push", token, json={"deviceId": device, "appVersion": "loadtest", "commands": [cmd]})
                if r is not None and r.status_code == 200:
                    res = r.json()["results"][0]
                    if res["status"] != "applied":
                        errors.append({"label": "push create", "status": res["status"], "body": json.dumps(res)[:300]})
                        results.append(("push create", 0.0, False, 200, None))
                    for u in res.get("uploads", []):
                        await call(client, "upload photo", "PUT", u["url"], token, content=PHOTO, headers={"content-type": "image/jpeg"})
        await call(client, "my observations", "GET", "/api/v1/observations?mine=1&pageSize=20", token)
        await call(client, "notifications", "GET", "/api/v1/me/notifications?unread=1", token)
        await asyncio.sleep(random.uniform(0.5, 2.0))


async def owner_loop(client: httpx.AsyncClient, token: str, deadline: float) -> None:
    while time.time() < deadline:
        r = await call(client, "my actions", "GET", "/api/v1/actions?mine=1&pageSize=20", token)
        if r is not None and r.status_code == 200 and r.json()["items"]:
            a = random.choice(r.json()["items"])
            await call(client, "action detail", "GET", f"/api/v1/actions/{a['id']}", token)
        await call(client, "notifications", "GET", "/api/v1/me/notifications?unread=1", token)
        await asyncio.sleep(random.uniform(1.0, 3.0))


async def officer_loop(client: httpx.AsyncClient, token: str, me: dict, owners: list[str], deadline: float) -> None:
    site = me["sites"][0]
    employer = None
    while time.time() < deadline:
        r = await call(client, "inbox", "GET", f"/api/v1/observations?siteId={site['id']}&status=submitted&pageSize=20", token)
        if r is not None and r.status_code == 200 and r.json()["items"]:
            o = random.choice(r.json()["items"])
            d = await call(client, "observation detail", "GET", f"/api/v1/observations/{o['id']}?duplicates=1", token)
            if d is not None and d.status_code == 200 and owners:
                if employer is None:
                    pull = await call(client, "pull", "GET", "/api/v1/sync/pull", token)
                    if pull is not None and pull.status_code == 200:
                        own = [k for k in pull.json()["contractors"] if k["isOwnCompany"]]
                        employer = own[0]["id"] if own else (pull.json()["contractors"][0]["id"] if pull.json()["contractors"] else None)
                body = {"clientUuid": str(uuid.uuid4()), "decision": "accept_assign", "categoryCodes": o["categoryCodes"] or ["HOUSE"], "likelihood": 2, "severity": 2, "is3786Code": "B-2",
                        "employerInvolvedId": employer, "capturedAt": now_iso(),
                        "actions": [{"clientUuid": str(uuid.uuid4()), "title": "Load test action", "actionType": "corrective", "controlLevel": "administrative", "ownerUserId": random.choice(owners)}]}
                await call(client, "triage", "POST", f"/api/v1/observations/{o['id']}/triage", token, json=body)
        await call(client, "dashboard", "GET", f"/api/v1/dashboard?siteIds={site['id']}", token)
        await asyncio.sleep(random.uniform(1.0, 2.5))


async def main() -> int:
    if not DEMO_PASSWORD:
        print("Set ADMIN_PASSWORD (or DEMO_PASSWORD): the demo users sign in with it.", file=sys.stderr)
        return 2
    limits = httpx.Limits(max_connections=USERS + 20, max_keepalive_connections=USERS + 20)
    async with httpx.AsyncClient(limits=limits, http2=False) as client:
        h = await client.get(BASE + "/api/v1/health", timeout=30)
        if h.status_code != 200:
            print(f"Server not healthy: {h.status_code} {h.text[:200]}", file=sys.stderr)
            return 2
        tokens: dict[str, str] = {}
        for code in OFFICERS + OWNERS + WORKERS:
            tok = await login(client, code)
            if not tok:
                print(f"Login failed for {code}. Seed the demo users first: python scripts/seed.py --demo (DEMO_PASSWORD unset → ADMIN_PASSWORD).", file=sys.stderr)
                return 2
            tokens[code] = tok
        me = {}
        for code in (OFFICERS[0], WORKERS[0]):
            r = await call(client, "me", "GET", "/api/v1/me", tokens[code])
            me[code] = r.json()
        owner_ids = []
        pull = await call(client, "pull", "GET", "/api/v1/sync/pull", tokens[OFFICERS[0]])
        if pull is not None and pull.status_code == 200:
            owner_ids = [u["id"] for u in pull.json()["directory"] if any(r["role"] == "action_owner" for r in u["roles"])]
        deadline = time.time() + DURATION
        tasks = []
        n_officers = max(1, USERS // 30)
        n_owners = max(1, USERS // 10)
        for vu in range(USERS):
            if vu < n_officers:
                coro = officer_loop(client, tokens[OFFICERS[0]], me[OFFICERS[0]], owner_ids, deadline)
            elif vu < n_officers + n_owners:
                coro = owner_loop(client, tokens[OWNERS[vu % len(OWNERS)]], deadline)
            else:
                coro = worker_loop(client, tokens[WORKERS[vu % len(WORKERS)]], me[WORKERS[0]], deadline, vu)

            async def ramped(c=coro, delay=RAMP * vu / max(USERS, 1)):
                await asyncio.sleep(delay)
                await c
            tasks.append(asyncio.create_task(ramped()))
        await asyncio.gather(*tasks, return_exceptions=True)
    by_label: dict[str, list[float]] = {}
    server: dict[str, list[float]] = {}
    failed = 0
    for label, ms, ok, _status, sms in results:
        by_label.setdefault(label, []).append(ms)
        if sms is not None:
            server.setdefault(label, []).append(sms)
        if not ok:
            failed += 1
    summary = {}
    for label, xs in sorted(by_label.items()):
        xs_sorted = sorted(xs)
        summary[label] = {"count": len(xs), "p50_ms": round(statistics.median(xs), 1), "p95_ms": round(xs_sorted[int(len(xs) * 0.95) - 1 if len(xs) > 1 else 0], 1), "max_ms": round(max(xs), 1),
                          "server_p50_ms": round(statistics.median(server[label]), 1) if server.get(label) else None}
    total = len(results)
    report = {"baseUrl": BASE, "users": USERS, "durationS": DURATION, "requests": total, "failed": failed, "failedPct": round(100.0 * failed / total, 3) if total else 0,
              "byLabel": summary, "errors": errors[:50], "at": now_iso()}
    Path(REPORT).write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"{USERS} users for {DURATION:.0f}s: {total} requests, {failed} failed ({report['failedPct']}%)")
    for label, s in summary.items():
        print(f"  {label:20s} n={s['count']:6d} p50={s['p50_ms']:8.1f} ms p95={s['p95_ms']:8.1f} ms max={s['max_ms']:8.1f} ms server p50={s['server_p50_ms']}")
    if errors:
        print("Errors:", json.dumps(errors[:10], indent=2, ensure_ascii=False))
    print(f"Report: {REPORT}")
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(2)
