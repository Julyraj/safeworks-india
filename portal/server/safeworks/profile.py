"""The `Me` payload shared by /me, login responses and sync pull."""
from __future__ import annotations

from datetime import datetime, timezone

from . import db
from .rbac import AuthUser
from .settings import get_org
from .views import site as site_view


async def me_payload(user: AuthUser, conn=None) -> dict:
    org = await get_org(user.org_id, conn)
    scope = user.sites_in_scope()
    sites = await db.q("select * from sites where id = any($1::uuid[]) and deleted_at is null order by code", [scope], conn) if scope else []
    notice = await db.one("select max(version) as v from privacy_notices where org_id = $1 and status = 'active'", [user.org_id], conn)
    acked = await db.one("select max(notice_version) as v from privacy_acks where user_id = $1", [user.id], conn)
    return {
        "id": user.id, "name": user.name, "employeeCode": user.employee_code, "email": user.email, "language": user.language, "loginType": user.login_type,
        "mfaEnabled": user.mfa_enabled, "mustChangePassword": user.must_change_password, "roles": [r.to_json() for r in user.roles], "sites": [site_view(s) for s in sites],
        "employerId": user.employer_id, "org": {"id": org["id"], "name": org["name"], "settings": org["settings"]},
        "privacyNoticeVersion": (notice["v"] if notice and notice["v"] else 0), "privacyAckedVersion": (acked["v"] if acked and acked["v"] else None),
        "serverTime": datetime.now(timezone.utc),
    }
