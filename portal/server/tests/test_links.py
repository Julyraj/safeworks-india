"""Signed links for pages opened in a new tab (QR posters, inspection reports): no bearer token in any URL."""
from __future__ import annotations

import uuid
from urllib.parse import parse_qs, urlsplit

from conftest import now_iso
from test_workflow import _answers

from safeworks import links


def _ticket(url: str) -> str:
    return parse_qs(urlsplit(url).query)["t"][0]


def _tamper(ticket: str) -> str:
    subject, exp, sig = ticket.rsplit(".", 2)
    return f"{subject}.{exp}.{('A' if sig[0] != 'A' else 'B') + sig[1:]}"


def _completed_run(ctx) -> str:
    tv = [t for t in ctx.get("SO1", f"/api/v1/inspections/templates?siteId={ctx.ids['siteA']}").json() if t["code"] == "T1"][0]
    r = ctx.post("SO1", "/api/v1/inspections/runs", {"clientUuid": str(uuid.uuid4()), "templateVersionId": tv["id"], "siteId": ctx.ids["siteA"], "areaId": ctx.ids["areaA1"],
                                                      "trigger": "spot", "header": {}, "startedAt": now_iso()})
    assert r.status_code == 201, r.text
    rid = r.json()["id"]
    r = ctx.post("SO1", f"/api/v1/inspections/runs/{rid}/submit", {"clientUuid": str(uuid.uuid4()), "answers": _answers(tv["sections"][0]["questions"]), "completedAt": now_iso()})
    assert r.status_code == 200 and r.json()["reportUrl"], r.text
    return rid


def test_report_link(ctx):
    rid = _completed_run(ctx)
    other = _completed_run(ctx)
    r = ctx.post("SO1", f"/api/v1/inspections/runs/{rid}/report-link")
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    assert url.startswith(f"/api/v1/links/inspection-runs/{rid}/report?t=") and "access_token" not in url and ctx.tokens["SO1"] not in url
    # valid link works with no Authorization header
    page = ctx.client.get(url)
    assert page.status_code == 200 and page.headers["content-type"].startswith("text/html") and "T1" in page.text
    # tampered signature → 403
    t = _ticket(url)
    bad = ctx.client.get(f"/api/v1/links/inspection-runs/{rid}/report?t={_tamper(t)}")
    assert bad.status_code == 403 and bad.json()["code"] == "link_expired"
    # a link issued for one run does not open another run → 403
    assert ctx.client.get(f"/api/v1/links/inspection-runs/{other}/report?t={t}").status_code == 403
    # expired → 403
    old, _ = links.issue(links.PURPOSE_RUN_REPORT, rid, ctx.ids["so1"], ttl=-5)
    assert ctx.client.get(f"/api/v1/links/inspection-runs/{rid}/report?t={old}").status_code == 403
    # a poster ticket is not a report ticket (purpose is part of the signature)
    poster_t, _ = links.issue(links.PURPOSE_POSTER, rid, ctx.ids["so1"])
    assert ctx.client.get(f"/api/v1/links/inspection-runs/{rid}/report?t={poster_t}").status_code == 403
    # out of scope: an officer of another site cannot get a link (404) and the issue is audited
    assert ctx.post("SOB", f"/api/v1/inspections/runs/{rid}/report-link").status_code == 404
    log = ctx.get("HSE-admin", f"/api/v1/admin/audit-log?recordId={rid}&action=export").json()
    assert log["total"] >= 1 and log["items"][0]["changes"]["signedLink"] == "report"


def test_poster_link(ctx):
    qrs = ctx.get("HSE-admin", f"/api/v1/admin/qr-codes?siteId={ctx.ids['siteA']}").json()
    assert len(qrs) >= 2
    a, b = qrs[0]["id"], qrs[1]["id"]
    r = ctx.post("HSE-admin", f"/api/v1/admin/qr-codes/{a}/poster-link", {"lang": "en,ta", "size": "A5"})
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    assert url.startswith(f"/api/v1/links/qr-codes/{a}/poster?") and "access_token" not in url
    page = ctx.client.get(url)
    assert page.status_code == 200 and "<svg" in page.text and "size:A5" in page.text and "ஸ்கேன்" in page.text
    t = _ticket(url)
    assert ctx.client.get(f"/api/v1/links/qr-codes/{a}/poster?t={_tamper(t)}").status_code == 403
    assert ctx.client.get(f"/api/v1/links/qr-codes/{b}/poster?t={t}").status_code == 403
    old, _ = links.issue(links.PURPOSE_POSTER, a, ctx.ids["hse"], ttl=-5)
    assert ctx.client.get(f"/api/v1/links/qr-codes/{a}/poster?t={old}").status_code == 403
    assert ctx.client.get(f"/api/v1/links/qr-codes/{a}/poster").status_code == 403
    # field sessions cannot issue poster links; the bearer route still works for API clients
    assert ctx.post("SO1", f"/api/v1/admin/qr-codes/{a}/poster-link", {}).status_code == 403
    assert ctx.get("HSE-admin", f"/api/v1/admin/qr-codes/{a}/poster").status_code == 200
