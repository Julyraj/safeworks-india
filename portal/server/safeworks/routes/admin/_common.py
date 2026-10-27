"""Shared pieces for the admin console routes (`kind: admin` sessions)."""
from __future__ import annotations

import csv
import io

from fastapi import Depends, Request

from ...auth import require_user
from ...errors import HttpError, forbidden, not_found
from ...rbac import AuthUser

console_user = require_user("admin")


def admin_dep():
    return Depends(console_user)


def need_admin(user: AuthUser) -> None:
    if not user.is_admin:
        raise forbidden()


def need_safety_config(user: AuthUser) -> None:
    """Templates, categories, risk matrix, due-date rules, ladders, rule sets: HSE manager (admin configures too)."""
    if not (user.is_admin or user.is_hse):
        raise forbidden()


def need_site_config(user: AuthUser, site_id: str | None) -> None:
    """Areas, QR codes, schedules, template copies: officers for their site; admin and HSE manager everywhere."""
    if site_id is None or not user.in_scope(site_id):
        raise not_found()
    if not (user.is_admin or user.is_hse or user.is_officer_plus(site_id)):
        raise forbidden()


def need_write(user: AuthUser) -> None:
    if user.role_set() == {"auditor"}:
        raise HttpError(403, "Auditor accounts are read-only.", "forbidden", key="err.forbidden")


def scope_sites(user: AuthUser, site_id: str | None = None) -> list[str]:
    scope = user.sites_in_scope()
    if site_id:
        if site_id not in scope:
            raise not_found()
        return [site_id]
    return scope


async def read_csv(request: Request, required: list[str]) -> list[dict[str, str]]:
    """Reads a CSV body (raw text or multipart `file`) with a header row; returns dict rows with stripped values."""
    ctype = request.headers.get("content-type", "")
    if ctype.startswith("multipart/form-data"):
        form = await request.form()
        f = form.get("file")
        raw = (await f.read()) if f is not None and hasattr(f, "read") else b""
    else:
        raw = await request.body()
    text = raw.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    header = [h.strip().lower() for h in (reader.fieldnames or [])]
    if any(r not in header for r in required):
        raise HttpError(400, f"The CSV header must be: {', '.join(required)}.", "bad_request", key="err.import_bad_header", params={"header": ", ".join(required)})
    rows = []
    for r in reader:
        rows.append({(k or "").strip().lower(): (v or "").strip() for k, v in r.items()})
    return rows


def i18n_or(value, fallback: dict | None = None) -> dict:
    if value is None:
        return fallback or {"en": ""}
    if hasattr(value, "dump"):
        return value.dump()
    return dict(value)
