import type { Role, SiteDashboard } from "../shared/types";

export interface AdminArea {
  id: string;
  name: string;
  active: boolean;
}

export interface AdminSite {
  id: string;
  code: string;
  name: string;
  siteType: string;
  state: string;
  address: string;
  lat: number | null;
  lng: number | null;
  registrations: Record<string, string>;
  siteHeadName: string;
  siteHeadPhone: string;
  siteHeadEmail: string;
  active: boolean;
  areas: AdminArea[];
}

export interface AdminContractor {
  id: string;
  name: string;
  contact: string;
  active: boolean;
  siteIds: string[];
  users: number;
}

export interface UserRole {
  role: Role;
  roleLabel: string;
  siteId: string | null;
  siteName: string | null;
  siteCode: string | null;
}

export interface AdminUser {
  id: string;
  employeeId: string;
  name: string;
  designation: string;
  phone: string;
  email: string;
  active: boolean;
  locked: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  contractorId: string | null;
  contractorName: string | null;
  roles: UserRole[];
}

export type RoleScope = "company" | "site" | "either";

export interface RoleMeta {
  role: Role;
  label: string;
  scope: RoleScope;
}

export interface OverviewSite {
  id: string;
  code: string;
  name: string;
  state: string;
  type: string;
  active: boolean;
  users: number;
  open: number;
  overdue: number;
  awaiting: number;
  highCriticalOpen: number;
  raised: number;
  closed: number;
  closureRate: number | null;
  avgDaysToClose: number | null;
}

export interface Overview {
  period: { from: string; to: string };
  sites: OverviewSite[];
  dashboard: SiteDashboard;
}

export interface AdminMasterItem {
  id: string;
  list: string;
  code: string;
  label: string;
  parent: string | null;
  sort: number;
  version: string;
  active: boolean;
  custom: boolean;
  updatedAt: string;
}

export interface OrgSettings {
  dueDays: { Critical: number; High: number; Medium: number; Low: number };
  escalation: { siteHeadDays: number; adminDays: number };
  dueReminderHours: number;
}

export interface AuditItem {
  id: number;
  at: string;
  action: string;
  entity: string;
  entityId: string;
  ip: string;
  details: Record<string, unknown>;
  actor: string | null;
  actorEmployeeId: string | null;
}

export const SITE_TYPES: { value: string; label: string }[] = [
  { value: "construction", label: "Construction site" },
  { value: "factory", label: "Factory" },
  { value: "plant", label: "Plant" },
  { value: "warehouse", label: "Warehouse" },
  { value: "terminal", label: "Terminal" },
  { value: "quarry", label: "Quarry" },
  { value: "office", label: "Office" },
  { value: "other", label: "Other" },
];

export const STATES = [
  "Karnataka", "Tamil Nadu", "Kerala", "Andhra Pradesh", "Telangana", "Maharashtra", "Goa", "Gujarat", "Puducherry",
  "Delhi", "Haryana", "Uttar Pradesh", "Rajasthan", "Madhya Pradesh", "Odisha", "West Bengal", "Punjab", "Other",
];
