"""Small helpers for route handlers."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

import orjson
from fastapi import Request
from starlette.responses import Response

from .errors import bad_request, not_found
from .i18n import from_accept_language

UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _default(o: Any) -> Any:
    from decimal import Decimal

    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, (bytes, bytearray, memoryview)):
        return None
    if isinstance(o, set):
        return sorted(o)
    raise TypeError


class JSON(Response):
    """Fast JSON responses (datetimes as ISO 8601, UUIDs as strings)."""

    media_type = "application/json"

    def render(self, content: Any) -> bytes:
        return orjson.dumps(content, default=_default, option=orjson.OPT_NON_STR_KEYS | orjson.OPT_UTC_Z)


async def json_body(request: Request) -> Any:
    raw = await request.body()
    if not raw or not raw.strip():
        return {}
    try:
        return orjson.loads(raw)
    except orjson.JSONDecodeError:
        raise bad_request("Body is not valid JSON.", key="err.bad_json")


def query(request: Request) -> dict[str, str]:
    return dict(request.query_params)


def uuid_param(v: str, what: str = "Not found.") -> str:
    if not UUID_RE.match(v or ""):
        raise not_found(what)
    return v.lower()


def opt_uuid(v: str | None) -> str | None:
    if not v:
        return None
    return uuid_param(v)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


def lang_of(request: Request) -> str:
    lang = getattr(request.state, "lang", None)
    return lang or from_accept_language(request.headers.get("accept-language"))


def page_params(request: Request, default_size: int = 50, max_size: int = 500) -> tuple[int, int]:
    q = request.query_params
    try:
        page = max(1, int(q.get("page", "1")))
    except ValueError:
        page = 1
    try:
        size = min(max_size, max(1, int(q.get("pageSize", str(default_size)))))
    except ValueError:
        size = default_size
    return page, size


def parse_dt(v: str | None, end_of_day: bool = False) -> datetime | None:
    if not v:
        return None
    try:
        if len(v) == 10:
            d = datetime.fromisoformat(v + ("T23:59:59" if end_of_day else "T00:00:00"))
        else:
            d = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        raise bad_request(f"Bad date: {v}")
    if d.tzinfo is None:
        from . import db
        d = d.replace(tzinfo=db.TZ)
    return d.astimezone(timezone.utc)


def csv_response(rows: list[list[Any]], filename: str) -> Response:
    """UTF-8 CSV with a BOM so Excel opens Tamil, Kannada and Hindi text correctly."""
    import csv
    import io

    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    for r in rows:
        w.writerow(["" if v is None else (v.isoformat() if isinstance(v, datetime) else v) for v in r])
    data = "﻿" + buf.getvalue()
    return Response(data.encode("utf-8"), media_type="text/csv; charset=utf-8", headers={"content-disposition": f'attachment; filename="{filename}"'})
