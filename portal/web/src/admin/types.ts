/* Admin-console-only shapes: the response bodies of the admin routes that only the console uses. They match the server
   (portal/server/safeworks/routes/admin/*.py) and are documented in portal/docs/API.md ("Admin shapes"). Everything the
   field app also needs lives in ../shared/types.ts (the contract). */
import type { Area, Lang, OrgSettings, QrCode, Role, Site, StatusLabel } from "../shared/types";

/** GET/PUT /admin/settings: OrgSettings plus the organisation's own fields (statusLabels are read-only). */
export interface OrgSettingsAdmin extends OrgSettings {
  orgName: string;
  legalName: string;
  address: string;
  phone: string;
}

/** POST /admin/sites/{id}/setup response: the site, all its areas, what the wizard did and one QR per area plus the site QR. */
export interface SiteSetupResult {
  site: Site;
  areas: Area[];
  areasCreated: number;
  categoriesEnabled: string[];
  templatesEnabled: string[];
  posters: QrCode[];
}

/** POST /admin/users response: the user plus the one-time secret (shown once). */
export interface UserCreated {
  tempPassword: string | null; // employee_code and email logins
  enrolmentCode: string | null; // enrolment_code logins: "ABCD-EFGH", valid 24 h
  enrolmentExpiresAt: string | null;
}

/** GET /admin/notifications-log rows. */
export interface NotificationLogRow {
  id: number;
  at: string;
  eventType: string;
  recordType: string;
  recordId: string | null;
  recipientName: string | null;
  channel: "inapp" | "push" | "email" | "whatsapp" | "sms";
  language: Lang;
  title: string;
  critical: boolean;
  status: "queued" | "sent" | "delivered" | "failed" | "acknowledged";
  attempts: number;
  sentAt: string | null;
  error: string;
  costEstimateInr: number;
}

/** GET/POST /admin/privacy/notices (one entry per version; body per language). */
export interface PrivacyNotice { version: number; status: "active" | "retired"; effectiveFrom: string; body: Partial<Record<Lang, string>>; createdAt: string }
export type PrivacyRequestType = "access" | "correction" | "erasure" | "nomination" | "grievance";
export type PrivacyRequestStatus = "open" | "in_progress" | "answered" | "rejected";
/** GET /admin/privacy/requests; POST {personName, identifier, type, details}; PUT {status, response}. Due 30 days after receipt. */
export interface PrivacyRequest {
  id: string; personName: string; identifier: string; type: PrivacyRequestType; details: string; receivedAt: string; dueAt: string;
  status: PrivacyRequestStatus; handledBy: string | null; handledByName: string | null; response: string; closedAt: string | null;
}

/** GET/PUT /admin/retention-policies */
export interface RetentionPolicy { id?: string; recordType: string; retentionYears: number; basisNote: string; endAction: "erase" | "anonymise"; statusLabel: string }
/** GET/POST /admin/legal-holds (POST {scopeType, scopeId?, reason}; scopeId null = every record of that type) */
export interface LegalHold { id: string; scopeType: string; scopeId: string | null; reason: string; placedBy: string; placedByName: string | null; placedAt: string; releasedAt: string | null; releasedBy: string | null }
/** POST /admin/retention/dry-run: counts only, nothing is deleted in 2.0. */
export interface RetentionDryRun {
  checkedAt: string;
  byRecordType: Record<string, { candidates: number; endAction: "erase" | "anonymise"; retentionYears: number; legalHold: boolean }>;
  legalHolds: number;
  note: string;
}

/** Admin console: saved register filters (per screen, in localStorage). */
export interface SavedFilter { name: string; values: Record<string, string> }

export type AttentionKind =
  | "overdue_actions" | "triage_backlog" | "critical_unacked" | "missed_inspections" | "repeat_findings"
  | "rule_sets_unverified" | "language_incomplete" | "health";

export interface AttentionItem { kind: AttentionKind; count: number; tone: "red" | "orange" | "amber" | "blue" | "grey"; to: string; detail?: string }

export const ADMIN_ROLES: Role[] = ["admin", "hse_manager", "site_head", "site_safety_officer", "auditor"];
export const STATUS_LABELS: StatusLabel[] = ["verified_primary", "verified_secondary", "voluntary_standard", "company_standard", "reference_to_confirm"];
