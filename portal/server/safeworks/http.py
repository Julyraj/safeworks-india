"""Small helpers for route handlers."""
from __future__ import annotations

from typing import Any

import orjson
from fastapi import Request
from starlette.responses import Response

from .errors import bad_request, not_found
from .observations import UUID_RE


def _default(o: Any) -> Any:
    from decimal import Decimal

    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, (bytes, bytearray, memoryview)):
        return None
    raise TypeError


class JSON(Response):
    """Fast JSON responses (datetimes as ISO 8601, UUIDs as strings)."""

    media_type = "application/json"

    def render(self, content: Any) -> bytes:
        return orjson.dumps(content, default=_default, option=orjson.OPT_NON_STR_KEYS)


async def json_body(request: Request) -> Any:
    raw = await request.body()
    if not raw or not raw.strip():
        return {}
    try:
        return orjson.loads(raw)
    except orjson.JSONDecodeError:
        raise bad_request("Body is not valid JSON.")


def query(request: Request) -> dict[str, str]:
    return dict(request.query_params)


def uuid_param(v: str, what: str = "Not found.") -> str:
    if not UUID_RE.match(v or ""):
        raise not_found(what)
    return v.lower()


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""
