export type Role = "platform_admin" | "org_admin" | "viewer" | "safety_officer" | "supervisor" | "auditor";

export const ROLES: Role[] = ["platform_admin", "org_admin", "viewer", "safety_officer", "supervisor", "auditor"];

export const ROLE_LABEL: Record<Role, string> = {
  platform_admin: "Platform admin",
  org_admin: "Admin",
  viewer: "Management viewer",
  safety_officer: "Safety officer",
  supervisor: "Supervisor",
  auditor: "Auditor",
};

export interface Membership {
  siteId: string | null;
  role: Role;
}

export interface AuthUser {
  id: string;
  orgId: string;
  employeeId: string;
  name: string;
  designation: string;
  email: string;
  mustChangePassword: boolean;
  memberships: Membership[];
  sessionId: string;
  kind: "portal" | "admin";
}

const ADMIN_ROLES: Role[] = ["platform_admin", "org_admin"];

export function isAdmin(u: AuthUser): boolean {
  return u.memberships.some((m) => m.siteId === null && ADMIN_ROLES.includes(m.role));
}

export function canUseAdminConsole(u: AuthUser): boolean {
  return u.memberships.some((m) => ADMIN_ROLES.includes(m.role) || m.role === "viewer");
}

export function rolesAt(u: AuthUser, siteId: string): Set<Role> {
  const s = new Set<Role>();
  for (const m of u.memberships) if (m.siteId === null || m.siteId === siteId) s.add(m.role);
  return s;
}

/** Can see every observation of the site (not only the ones assigned to them). */
export function canViewWholeSite(u: AuthUser, siteId: string): boolean {
  if (isAdmin(u)) return true;
  const r = rolesAt(u, siteId);
  return r.has("safety_officer") || r.has("viewer") || r.has("auditor");
}

/** Only safety officers (and admins) raise observation points. */
export function canRaise(u: AuthUser, siteId: string): boolean {
  return isAdmin(u) || rolesAt(u, siteId).has("safety_officer");
}

/** Safety officers of the site (and admins) assign, edit, approve, cancel, reopen and extend. */
export function canManage(u: AuthUser, siteId: string): boolean {
  return isAdmin(u) || rolesAt(u, siteId).has("safety_officer");
}

/** Has any membership on the site (any role), or a company-wide role. */
export function hasSiteAccess(u: AuthUser, siteId: string): boolean {
  return u.memberships.some((m) => m.siteId === null || m.siteId === siteId);
}

/** Company-wide read access: admins, company-wide viewers and auditors. */
export function hasCompanyWideRead(u: AuthUser): boolean {
  return u.memberships.some((m) => m.siteId === null && (ADMIN_ROLES.includes(m.role) || m.role === "viewer" || m.role === "auditor"));
}

export function siteIdsWithRole(u: AuthUser, roles: Role[]): string[] {
  return [...new Set(u.memberships.filter((m) => m.siteId && roles.includes(m.role)).map((m) => m.siteId as string))];
}
