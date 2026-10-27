"""The web application: API routes under /api/v1, signed file links, the web front ends and security headers."""
from __future__ import annotations

import asyncio
import logging
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import FileResponse, RedirectResponse, Response

from . import db
from .config import DEV_FIELD_KEY, DEV_FILE_SECRET, config
from .crypto import _load_key
from .errors import HttpError
from .http import JSON
from .i18n import from_accept_language, t
from .jobs import start_jobs
from .middleware import Guard
from .migrate import migrate
from .routes import actions, auth, dashboard, inspections, me, media, observations, public, sync
from .routes.admin import routers as admin_routers
from .security import verify_file_sig
from .storage import MIME_FOR_EXT, storage

log = logging.getLogger("safeworks")

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")


def _lang(request: Request) -> str:
    lang = getattr(request.state, "lang", None)
    return lang or from_accept_language(request.headers.get("accept-language"))


def error(status: int, message: str, code: str, details=None) -> JSON:
    body = {"error": message, "code": code}
    if details is not None:
        body["details"] = details
    return JSON(body, status_code=status)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if config.is_prod:
        if not config.file_signing_secret or len(config.file_signing_secret) < 32 or config.file_signing_secret == DEV_FILE_SECRET:
            raise RuntimeError("FILE_SIGNING_SECRET must be at least 32 random characters in production.")
        if not config.field_encryption_key or config.field_encryption_key == DEV_FIELD_KEY or len(config.field_encryption_key.strip()) < 32:
            raise RuntimeError("FIELD_ENCRYPTION_KEY must be set in production (base64 of 32 random bytes, or any random string of 32+ characters).")
        _load_key()  # fails fast on an unusable key
    await db.init_pool()
    if config.auto_migrate:
        await migrate()
    tasks = start_jobs() if config.run_jobs else []
    try:
        yield
    finally:
        for t_ in tasks:
            t_.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await db.close_pool()


def create_app() -> FastAPI:
    app = FastAPI(title="SafeWorks Portal", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None, default_response_class=JSON)

    @app.exception_handler(HttpError)
    async def _http_error(request: Request, e: HttpError):
        message = t(e.key, _lang(request), **e.params) if e.key else e.message
        return error(e.status, message, e.code, e.details)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, e: RequestValidationError):
        first = e.errors()[0] if e.errors() else {}
        path = ".".join(str(x) for x in first.get("loc", ()))
        return error(400, t("err.validation", _lang(request), path=path, message=first.get("msg", "invalid")), "bad_request")

    @app.exception_handler(StarletteHTTPException)
    async def _starlette(request: Request, e: StarletteHTTPException):
        code = {404: "not_found", 405: "method_not_allowed", 413: "too_large"}.get(e.status_code, "error")
        msg = t("err.not_found", _lang(request)) if e.status_code == 404 else (str(e.detail) if e.detail else "Request failed.")
        return error(e.status_code, msg, code)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, e: Exception):
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return error(500, t("err.server", _lang(request)), "server_error")

    # Order: CORS outermost (answers preflights), then the guard (size limit, rate limit, headers), then the routes.
    app.add_middleware(Guard)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "Accept-Language"],
        max_age=600,
    )

    for r in (auth.router, me.router, sync.router, media.router, observations.router, actions.router, inspections.router, dashboard.router, public.router, *admin_routers):
        app.include_router(r)

    # Signed file links: /files/media/2026/10/<uuid>.jpg?e=<expiry>&s=<signature>
    @app.get("/files/{key:path}")
    async def files(key: str, e: str = "", s: str = "", request: Request = None):
        exp = int(e) if e.isdigit() else None
        if not verify_file_sig(key, exp, s):
            return error(403, t("err.link_expired", _lang(request)), "link_expired")
        data = await storage.get(key)
        if data is None:
            return error(404, t("err.not_found", _lang(request)), "not_found")
        ext = key.rsplit(".", 1)[-1].lower()
        return Response(data, media_type=MIME_FOR_EXT.get(ext, "application/octet-stream"),
                        headers={"cache-control": "private, max-age=3600, immutable", "x-content-type-options": "nosniff", "content-disposition": "inline"})

    # Web front ends (built by `npm run build -w web`): field app at /, QR form at /q/, admin console at /admin/, library at /library/
    dist: Path = Path(config.web_dist).resolve()

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def web(path: str, request: Request):
        if path.startswith("api/") or path == "api" or path.startswith("files/"):
            return error(404, t("err.not_found", _lang(request)), "not_found")
        if not dist.is_dir():
            return error(404, "Not found.", "not_found")
        target = (dist / path).resolve() if path else dist
        if not target.is_relative_to(dist):  # no way out of the web folder (../, absolute paths, sibling folders)
            return error(404, "Not found.", "not_found")
        if target.is_dir():
            if path and not path.endswith("/"):
                q = f"?{request.url.query}" if request.url.query else ""
                return RedirectResponse(f"/{path}/{q}", status_code=301)
            index = target / "index.html"
            if index.is_file():
                return FileResponse(index, media_type="text/html")
        elif target.is_file():
            headers = {}
            if "/assets/" in f"/{path}":
                headers["cache-control"] = "public, max-age=31536000, immutable"
            elif path.endswith("sw.js"):
                headers["cache-control"] = "no-cache"
            return FileResponse(target, headers=headers)
        last = path.rsplit("/", 1)[-1]
        if "." not in last:  # app routes → the single-page app that owns the prefix
            if path.startswith("q/") or path == "q":
                page = "q/index.html"
            elif path.startswith("admin"):
                page = "admin/index.html"
            elif path.startswith("library"):
                page = "library/index.html"
            else:
                page = "index.html"
            if (dist / page).is_file():
                return FileResponse(dist / page, media_type="text/html")
        return error(404, "Not found.", "not_found")

    return app


app = create_app()
