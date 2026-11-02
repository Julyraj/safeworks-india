"""Short-lived signed links for pages a browser opens in a new tab (QR posters, inspection reports).

A new tab cannot send the `Authorization` header, and a bearer token must never travel in a URL (it ends up in
history, logs and Referer headers). Instead the signed-in client asks for a link (`POST …/poster-link`,
`POST …/report-link`); the server checks scope at that moment, writes an audit row and answers a URL that carries a
ticket signed with FILE_SIGNING_SECRET (`security.sign_ticket`). The ticket is bound to one record and one user and
expires after `LINK_TTL_SECONDS`. The GET route that serves the page checks the signature, the expiry, that the
ticket's record is the one in the path, and the user's scope again (a user suspended or moved off the site after the
link was issued gets a 404).
"""
from __future__ import annotations

import time

from . import db
from .auth import build_user
from .errors import HttpError, not_found
from .rbac import AuthUser
from .security import sign_ticket, verify_ticket

LINK_TTL_SECONDS = 300
PURPOSE_POSTER = "link:qr-poster"
PURPOSE_RUN_REPORT = "link:run-report"


def link_expired() -> HttpError:
    return HttpError(403, "This link has expired or is not valid. Open it again from SafeWorks.", "link_expired", key="err.link_expired")


def issue(purpose: str, record_id: str, user_id: str, ttl: int = LINK_TTL_SECONDS) -> tuple[str, int]:
    """(ticket, expiry as unix seconds) for `record_id` and `user_id`."""
    exp = int(time.time()) + ttl
    return sign_ticket(purpose, f"{record_id}~{user_id}", exp), exp


async def redeem(purpose: str, record_id: str, ticket: str) -> AuthUser:
    """The user the ticket was issued to, after checking signature, expiry and record binding (each failure is 403)."""
    subject = verify_ticket(purpose, ticket or "")
    if not subject or "~" not in subject:
        raise link_expired()
    rid, uid = subject.split("~", 1)
    if rid.lower() != (record_id or "").lower():
        raise link_expired()
    row = await db.one(
        """select u.id, u.org_id, coalesce(nullif(p.full_name, ''), nullif(u.employee_code, ''), u.email) as name, u.employee_code, u.email,
                  u.language, u.login_type, u.must_change_password, u.mfa_enabled, p.employer_id
             from users u left join people p on p.id = u.person_id
            where u.id = $1 and u.status = 'active' and (u.expires_at is null or u.expires_at > now())""",
        [uid],
    )
    if not row:
        raise not_found()
    return await build_user({**row, "kind": "link", "mfa_passed": True})
