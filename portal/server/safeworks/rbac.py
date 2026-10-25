"""Roles per site (brief §4) and the scope rules every route applies on the server.

A record outside the caller's sites answers 404 (never 403) so ids cannot be probed.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from .errors import HttpError, forbidden, not_found

ROLES = ["reporter", "action_owner", "verifier", "site_safety_officer", "site_head", "hse_manager", "admin", "auditor"]
STAFF_ROLES = {"site_safety_officer", "site_head", "hse_manager", "admin", "auditor"}
ALL_SITES_ROLES = {"hse_manager", "admin", "auditor"}
OFFICER_PLUS = {"site_safety_officer", "site_head", "hse_manager"}
VERIFY_ROLES = {"verifier", "site_safety_officer", "site_head", "hse_manager"}
SITE_VIEW_ROLES = {"verifier", "site_safety_officer", "site_head", "hse_manager", "admin", "auditor"}
IDENTITY_ROLES = {"site_safety_officer", "site_head", "hse_manager"}  # see named reporters
CONSOLE_ROLES = {"admin", "hse_manager", "site_head", "site_safety_officer", "auditor"}
SAFETY_CONFIG_ROLES = {"hse_manager"}  # templates, categories, matrix, due dates, ladders, rule sets


@dataclass
class SiteRole:
    site_id: str | None
    role: str
    medical_data: bool = False
    expires_at: datetime | None = None

    def to_json(self) -> dict:
        return {"siteId": self.site_id, "role": self.role, "medicalData": self.medical_data, "expiresAt": self.expires_at}


@dataclass
class AuthUser:
    id: str
    org_id: str
    name: str
    employee_code: str
    email: str
    language: str
    login_type: str
    must_change_password: bool
    mfa_enabled: bool
    employer_id: str | None
    roles: list[SiteRole] = field(default_factory=list)
    all_site_ids: list[str] = field(default_factory=list)  # every active site of the organisation
    session_id: str = ""
    kind: str = "field"
    mfa_passed: bool = False
    device_id: str = ""
    ip: str = ""

    # ---- role helpers ----
    def role_set(self) -> set[str]:
        return {r.role for r in self.roles}

    def roles_at(self, site_id: str | None) -> set[str]:
        return {r.role for r in self.roles if r.site_id is None or (site_id is not None and r.site_id == site_id)}

    @property
    def is_admin(self) -> bool:
        return "admin" in self.role_set()

    @property
    def is_auditor(self) -> bool:
        return "auditor" in self.role_set()

    @property
    def is_hse(self) -> bool:
        return "hse_manager" in self.role_set()

    @property
    def is_all_sites_role(self) -> bool:
        return any(r.site_id is None and r.role in ALL_SITES_ROLES for r in self.roles)

    @property
    def is_staff(self) -> bool:
        return bool(self.role_set() & STAFF_ROLES)

    def sites_in_scope(self) -> list[str]:
        if self.is_all_sites_role:
            return list(self.all_site_ids)
        out: list[str] = []
        for r in self.roles:
            if r.site_id and r.site_id in self.all_site_ids and r.site_id not in out:
                out.append(r.site_id)
        return out

    def in_scope(self, site_id: str | None) -> bool:
        return site_id is not None and site_id in self.sites_in_scope()

    def is_officer_plus(self, site_id: str | None) -> bool:
        return bool(self.roles_at(site_id) & OFFICER_PLUS)

    def can_verify(self, site_id: str | None) -> bool:
        return bool(self.roles_at(site_id) & VERIFY_ROLES)

    def can_view_site(self, site_id: str | None) -> bool:
        """May see every record of the site (not only their own)."""
        return self.in_scope(site_id) and bool(self.roles_at(site_id) & SITE_VIEW_ROLES)

    def sees_reporter_identity(self, site_id: str | None) -> bool:
        return bool(self.roles_at(site_id) & IDENTITY_ROLES)

    def is_site_head(self, site_id: str | None) -> bool:
        return bool(self.roles_at(site_id) & {"site_head", "hse_manager"})

    def can_configure_site(self, site_id: str | None) -> bool:
        """Officers manage their site's areas, QR codes, schedules and template copies; admin manages everything."""
        return self.is_admin or bool(self.roles_at(site_id) & OFFICER_PLUS)

    @property
    def can_use_admin_console(self) -> bool:
        return bool(self.role_set() & CONSOLE_ROLES)

    @property
    def can_safety_config(self) -> bool:
        return bool(self.role_set() & SAFETY_CONFIG_ROLES)

    def officer_sites(self) -> list[str]:
        """Sites where the user is officer or above (all sites for an HSE manager)."""
        if self.is_hse:
            return list(self.all_site_ids)
        return [r.site_id for r in self.roles if r.site_id and r.role in OFFICER_PLUS and r.site_id in self.all_site_ids]


# ---- shared checks (raise HttpError) ----

def require_scope(user: AuthUser, site_id: str | None) -> None:
    """404 when the record's site is outside the caller's scope."""
    if not user.in_scope(site_id):
        raise not_found()


def require_officer(user: AuthUser, site_id: str | None) -> None:
    require_scope(user, site_id)
    if not user.is_officer_plus(site_id):
        if user.is_admin:
            raise forbidden("Admins configure the system; triage is for safety officers.", key="err.admin_no_triage")
        raise forbidden()


def require_site_view(user: AuthUser, site_id: str | None) -> None:
    require_scope(user, site_id)
    if not user.can_view_site(site_id):
        raise not_found()


def require_role(user: AuthUser, *roles: str, site_id: str | None = None) -> None:
    have = user.roles_at(site_id) if site_id else user.role_set()
    if not (have & set(roles)):
        raise forbidden()


def require_admin(user: AuthUser) -> None:
    if not user.is_admin:
        raise forbidden()


def require_not_auditor(user: AuthUser) -> None:
    """Auditors are read-only."""
    if user.role_set() == {"auditor"}:
        raise HttpError(403, "Auditor accounts are read-only.", "forbidden", key="err.forbidden")
