"""HTTP layer: security headers, timing header, body size limit, web folder containment."""
from __future__ import annotations

import pytest
from safeworks.config import config


def test_api_headers(ctx):
    r = ctx.client.get("/api/health")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["server-timing"].startswith("app;dur=")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "no-referrer"


@pytest.mark.skipif(not (config.web_dist / "index.html").is_file(), reason="web screens not built")
def test_page_csp(ctx):
    app = ctx.client.get("/")
    assert app.status_code == 200 and "script-src 'self';" in app.headers["content-security-policy"]
    assert "frame-ancestors 'none'" in app.headers["content-security-policy"]
    assert ctx.client.get("/admin/users").headers["content-type"].startswith("text/html"), "admin routes fall back to the admin page"


def test_no_way_out_of_the_web_folder(ctx):
    for p in ["/%2e%2e/%2e%2e/README.md", "/..%2f..%2fREADME.md", "/%2e%2e/server/safeworks/config.py"]:
        assert ctx.client.get(p).status_code == 404, p


def test_body_limit_declared_and_chunked(ctx):
    big = b"x" * (15 * 1024 * 1024)
    declared = ctx.client.post("/api/auth/login", content=big, headers={"content-type": "application/json"})
    assert declared.status_code == 413 and declared.json()["code"] == "too_large"

    def chunks():
        for i in range(0, len(big), 1024 * 1024):
            yield big[i:i + 1024 * 1024]

    chunked = ctx.client.post("/api/observations", content=chunks(),
                              headers={"content-type": "multipart/form-data; boundary=x", "authorization": f"Bearer {ctx.tokens['SO1']}"})
    assert chunked.status_code == 413 and chunked.json()["code"] == "too_large"


def test_signed_photo_link_tampering(ctx):
    assert ctx.client.get("/files/obs/2026/10/x.jpg?e=9999999999&s=bad").status_code == 403
