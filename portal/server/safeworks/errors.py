from __future__ import annotations

from typing import Any


class HttpError(Exception):
    def __init__(self, status: int, message: str, code: str = "error", details: Any = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code
        self.details = details


def bad_request(msg: str, details: Any = None) -> HttpError:
    return HttpError(400, msg, "bad_request", details)


def unauthorized(msg: str = "Please sign in.") -> HttpError:
    return HttpError(401, msg, "unauthorized")


def forbidden(msg: str = "You do not have permission for this.") -> HttpError:
    return HttpError(403, msg, "forbidden")


def not_found(msg: str = "Not found.") -> HttpError:
    return HttpError(404, msg, "not_found")


def conflict(msg: str) -> HttpError:
    return HttpError(409, msg, "conflict")
