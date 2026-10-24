"""Roles and who may do what. Every rule is checked on the server."""
from __future__ import annotations

from dataclasses import dataclass, field

ROLES = ["platform_admin", "org_admin", "viewer", "safety_officer", "supervisor", "auditor"]

ROLE_LABEL = {
    "platform_admin": "Platform admin",
    "org_admin": "Admin",
    "viewer": "Management viewer",
    "safety_officer": "Safety officer",
    "supervisor": "Supervisor",
    "auditor": "Auditor",
}

ADMIN_ROLES = ("platform_admin", "org_admin")


@dataclass
class Membership:
    site_id: str | None
    role: str


@dataclass
class AuthUser:
    id: str
    org_id: str
    employee_id: str
    name: str
    designation: str
    email: str
    must_change_password: bool
    memberships: list[Membership] = field(default_factory=list)
    session_id: str = ""
    kind: str = "portal"


def is_admin(u: AuthUser) -> bool:
    return any(m.site_id is None and m.role in ADMIN_ROLES for m in u.memberships)


def can_use_admin_console(memberships: list[Membership]) -> bool:
    return any(m.role in ADMIN_ROLES or m.role == "viewer" for m in memberships)


def roles_at(u: AuthUser, site_id: str) -> set[str]:
    return {m.role for m in u.memberships if m.site_id is None or m.site_id == site_id}


def can_view_whole_site(u: AuthUser, site_id: str) -> bool:
    """Can see every observation of the site (not only the ones assigned to them)."""
    if is_admin(u):
        return True
    r = roles_at(u, site_id)
    return bool(r & {"safety_officer", "viewer", "auditor"})


def can_raise(u: AuthUser, site_id: str) -> bool:
    """Only safety officers (and admins) raise observation points."""
    return is_admin(u) or "safety_officer" in roles_at(u, site_id)


def can_manage(u: AuthUser, site_id: str) -> bool:
    """Safety officers of the site (and admins) assign, edit, approve, cancel, reopen and extend."""
    return is_admin(u) or "safety_officer" in roles_at(u, site_id)


def has_company_wide_read(u: AuthUser) -> bool:
    return any(m.site_id is None and (m.role in ADMIN_ROLES or m.role in ("viewer", "auditor")) for m in u.memberships)
