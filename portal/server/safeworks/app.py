"""The web application: API routes, photo links, the web front ends and security headers."""
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
from .config import config
from .errors import HttpError
from .http import JSON
from .jobs import start_jobs
from .migrate import migrate
from .routes import admin, auth, dashboard, meta, observations
from .middleware import Guard
from .security import verify_file_sig
from .storage import storage

log = logging.getLogger("safeworks")

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")

PHOTO_MIME = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


def error(status: int, message: str, code: str, details=None) -> JSON:
    body = {"error": message, "code": code}
    if details is not None:
        body["details"] = details
    return JSON(body, status_code=status)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if config.is_prod and len(config.file_signing_secret) < 32:
        raise RuntimeError("FILE_SIGNING_SECRET must be at least 32 characters.")
    await db.init_pool()
    if config.auto_migrate:
        await migrate()
    tasks = start_jobs() if config.run_jobs else []
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await db.close_pool()


def create_app() -> FastAPI:
    app = FastAPI(title="SafeWorks Portal", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None, default_response_class=JSON)

    @app.exception_handler(HttpError)
    async def _http_error(_: Request, e: HttpError):
        return error(e.status, e.message, e.code, e.details)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, e: RequestValidationError):
        first = e.errors()[0] if e.errors() else {}
        return error(400, f"{'.'.join(str(x) for x in first.get('loc', ()))}: {first.get('msg', 'invalid')}", "bad_request")

    @app.exception_handler(StarletteHTTPException)
    async def _starlette(_: Request, e: StarletteHTTPException):
        code = {404: "not_found", 405: "method_not_allowed", 413: "too_large"}.get(e.status_code, "error")
        return error(e.status_code, str(e.detail) if e.detail else "Request failed.", code)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, e: Exception):
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return error(500, "Something went wrong on the server. Please try again.", "server_error")

    # Order: CORS outermost (answers preflights), then the guard (size limit, rate limit, headers), then the routes.
    app.add_middleware(Guard)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=600,
    )

    for r in (auth.router, meta.router, observations.router, dashboard.router, admin.router):
        app.include_router(r)

    # Signed photo links: /files/obs/2026/10/<uuid>.jpg?e=<expiry>&s=<signature>
    @app.get("/files/{key:path}")
    async def files(key: str, e: str = "", s: str = ""):
        exp = int(e) if e.isdigit() else None
        if not verify_file_sig(key, exp, s):
            return error(403, "This photo link has expired. Refresh the page.", "link_expired")
        data = await storage.get(key)
        if data is None:
            return error(404, "Photo not found.", "not_found")
        ext = key.rsplit(".", 1)[-1]
        return Response(data, media_type=PHOTO_MIME.get(ext, "application/octet-stream"),
                        headers={"cache-control": "private, max-age=3600, immutable", "x-content-type-options": "nosniff"})

    # Web front ends (built by `npm run build -w web`): portal at /, admin console at /admin/, library at /library/
    dist: Path = Path(config.web_dist).resolve()

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def web(path: str, request: Request):
        if path.startswith("api/") or path == "api" or path.startswith("files/"):
            return error(404, "Not found.", "not_found")
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
        if "." not in last:  # app routes such as /o/<id> or /admin/users → the single-page app
            page = "admin/index.html" if path.startswith("admin") else "library/index.html" if path.startswith("library") else "index.html"
            if (dist / page).is_file():
                return FileResponse(dist / page, media_type="text/html")
        return error(404, "Not found.", "not_found")

    return app


app = create_app()
