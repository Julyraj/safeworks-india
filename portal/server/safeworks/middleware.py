"""Request guard, as plain ASGI middleware (cheaper than Starlette's BaseHTTPMiddleware on every request).

- refuses bodies over 14 MB, whether or not the client declares the size up front
- per-user (or per-IP) API rate limit
- security headers on every response; the strict CSP for the app, a relaxed one for the bundled library
- `Server-Timing: app;dur=<ms>` on API responses, and a warning in the log for slow API requests
"""
from __future__ import annotations

import logging
import time

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import config
from .errors import HttpError
from .http import JSON
from .ratelimit import api_limiter
from .security import sha256

log = logging.getLogger("safeworks")

MAX_BODY = 16 * 1024 * 1024  # media PUT is capped at 10 MB by upload.py; QR JSON at 15 MB by the public route
STRICT_CSP = (
    "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; "
    "connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
)
# The bundled SafeWorks library is a single self-contained page with inline script.
LIBRARY_CSP = (
    "default-src 'self'; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'self'; object-src 'none'"
)
SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "referrer-policy": "no-referrer",
    "strict-transport-security": "max-age=15552000; includeSubDomains",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-site",
    "origin-agent-cluster": "?1",
    "x-dns-prefetch-control": "off",
    "x-permitted-cross-domain-policies": "none",
}


def _too_large() -> HttpError:
    return HttpError(413, "The upload is too large.", "too_large")


class Guard:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path: str = scope["path"]
        is_api = path.startswith("/api/")
        is_library = path.startswith("/library/")
        t0 = time.perf_counter()

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if is_api:
                    ms = (time.perf_counter() - t0) * 1000
                    headers["server-timing"] = f"app;dur={ms:.1f}"
                    headers["cache-control"] = "no-store"
                    if ms > config.slow_ms:
                        log.warning("slow request %s %s %d %.0f ms", scope["method"], path, message["status"], ms)
                for k, v in SECURITY_HEADERS.items():
                    headers.setdefault(k, v)
                if headers.get("content-type", "").startswith("text/html"):
                    headers["content-security-policy"] = LIBRARY_CSP if is_library else STRICT_CSP
                    headers["cache-control"] = "no-cache"
            await send(message)

        async def refuse(e: HttpError) -> None:
            await JSON({"error": e.message, "code": e.code}, status_code=e.status)(scope, receive, send_with_headers)

        req_headers = Headers(scope=scope)
        cl = req_headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > MAX_BODY:
            await refuse(_too_large())
            return
        if is_api:
            auth = req_headers.get("authorization", "")
            token = auth[7:].strip() if auth.startswith("Bearer ") else ""
            client = scope.get("client")
            key = f"u:{sha256(token)[:24]}" if token else f"ip:{client[0] if client else ''}"
            try:
                api_limiter.check(key, config.user_rate_limit)
            except HttpError as e:
                await refuse(e)
                return

        received = 0

        async def counted_receive() -> Message:
            # Bodies sent without a Content-Length (chunked) are counted as they arrive.
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > MAX_BODY:
                    raise _too_large()
            return message

        await self.app(scope, counted_receive, send_with_headers)
