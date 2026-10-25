"""API errors. A message may carry a translation key so the response honours Accept-Language (see app.py)."""
from __future__ import annotations

from typing import Any


class HttpError(Exception):
    def __init__(self, status: int, message: str, code: str = "error", details: Any = None, key: str | None = None, params: dict | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code
        self.details = details
        self.key = key
        self.params = params or {}


def bad_request(msg: str, details: Any = None, key: str | None = None, **params) -> HttpError:
    return HttpError(400, msg, "bad_request", details, key, params)


def unauthorized(msg: str = "Please sign in.", key: str = "err.sign_in") -> HttpError:
    return HttpError(401, msg, "unauthorized", key=key)


def forbidden(msg: str = "You do not have permission for this.", key: str = "err.forbidden", **params) -> HttpError:
    return HttpError(403, msg, "forbidden", key=key, params=params)


def not_found(msg: str = "Not found.", key: str = "err.not_found") -> HttpError:
    return HttpError(404, msg, "not_found", key=key)


def conflict(msg: str, key: str | None = None, **params) -> HttpError:
    return HttpError(409, msg, "conflict", key=key, params=params)


def too_large(msg: str = "The upload is too large.", key: str = "err.too_large") -> HttpError:
    return HttpError(413, msg, "too_large", key=key)


def rate_limited(msg: str = "Too many requests. Please try again later.", key: str = "err.rate_limited", **params) -> HttpError:
    return HttpError(429, msg, "rate_limited", key=key, params=params)
