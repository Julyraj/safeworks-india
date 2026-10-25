/* Admin-console-only shapes. Everything that the field app also needs lives in ../shared/types.ts (the contract).
   The routes below are listed in portal/docs/API.md without a body type; these are the shapes the console sends and
   expects, kept here so they can be promoted into the contract when the server team confirms them. */
import type { Lang, OrgSettings, Role, StatusLabel } from "../shared/types";

/** GET/PUT /admin/settings */
export interface OrgSettingsAdmin extends OrgSettings {
  orgName: string;
  legalName: string;
  address: string;
  phone: string;
}

/** POST /admin/sites/{id}/setup response */
export interface SiteSetupResult {
  siteId: string;
  areasCreated: number;
  templatesEnabled: string[];
  categoriesEnabled: string[];
  posters: { qrCodeId: string; label: string; targetType: "site" | "area" | "asset"; posterUrl: string }[];
}

/** GET /admin/notifications-log */
export interface NotificationLogRow {
  id: number;
  at: string;
  eventType: string;
  channel: "push" | "email" | "both";
  recipientName: string | null;
  title: string;
  status: "queued" | "sent" | "delivered" | "failed" | "acknowledged";
  critical: boolean;
  error: string;
  recordType: string | null;
  recordId: string | null;
}

/** GET/POST /admin/privacy/notices */
export interface PrivacyNotice { id: string; version: number; effectiveFrom: string; body: Record<Lang, string>; createdByName: string | null; createdAt: string }
export type PrivacyRequestType = "access" | "correction" | "erasure" | "nomination" | "grievance";
export type PrivacyRequestStatus = "open" | "in_progress" | "done" | "rejected";
/** GET/POST/PUT /admin/privacy/requests */
export interface PrivacyRequest {
  id: string; type: PrivacyRequestType; requesterName: string; requesterRef: string; siteId: string | null; channel: string;
  receivedAt: string; dueAt: string; status: PrivacyRequestStatus; assigneeName: string | null; note: string; closedAt: string | null;
}

/** GET/PUT /admin/retention-policies */
export interface RetentionPolicy { recordType: string; keepMonths: number; action: "erase" | "anonymise" | "keep"; legalBasis: string; statusLabel: string }
/** GET/POST /admin/legal-holds */
export interface LegalHold { id: string; recordType: string; recordId: string | null; siteId: string | null; reason: string; createdByName: string; createdAt: string; releasedAt: string | null }
/** POST /admin/retention/dry-run */
export interface RetentionDryRun { ranAt: string; rows: { recordType: string; erase: number; anonymise: number; held: number }[] }

/** Minimal shape of a template in the list (the latest version's header plus the active version id). */
export interface TemplateHeader { templateId: string; code: string; name: Record<string, string>; type: string; activeVersionId: string | null; latestVersion: number; latestStatus: string }

/** Admin console: saved register filters (per screen, in localStorage). */
export interface SavedFilter { name: string; values: Record<string, string> }

export type AttentionKind =
  | "overdue_actions" | "triage_backlog" | "critical_unacked" | "missed_inspections" | "repeat_findings"
  | "rule_sets_unverified" | "language_incomplete" | "health";

export interface AttentionItem { kind: AttentionKind; count: number; tone: "red" | "orange" | "amber" | "blue" | "grey"; to: string; detail?: string }

export const ADMIN_ROLES: Role[] = ["admin", "hse_manager", "site_head", "site_safety_officer", "auditor"];
export const STATUS_LABELS: StatusLabel[] = ["verified_primary", "verified_secondary", "voluntary_standard", "company_standard", "reference_to_confirm"];
