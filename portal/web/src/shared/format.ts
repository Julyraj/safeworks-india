import type { ObsType, Status } from "./types";

const TZ = "Asia/Kolkata";

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

export function dueText(dueAt: string | null, status: Status): { text: string; late: boolean } {
  if (!dueAt) return { text: "No due date", late: false };
  if (!["open", "in_progress"].includes(status)) return { text: `Due ${fmtDate(dueAt)}`, late: false };
  const ms = new Date(dueAt).getTime() - Date.now();
  const days = Math.round(Math.abs(ms) / 86_400_000);
  const hours = Math.round(Math.abs(ms) / 3_600_000);
  if (ms < 0) return { text: days >= 1 ? `${days} day${days === 1 ? "" : "s"} overdue` : `${hours} h overdue`, late: true };
  if (hours < 24) return { text: `Due in ${Math.max(hours, 1)} h`, late: false };
  return { text: `Due in ${days} day${days === 1 ? "" : "s"}`, late: false };
}

export const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
  in_progress: "In progress",
  closure_submitted: "Awaiting approval",
  closed: "Closed",
  cancelled: "Cancelled",
  noted: "Noted (safe)",
};

export const TYPE_LABEL: Record<ObsType, string> = {
  unsafe_act: "Unsafe act",
  unsafe_condition: "Unsafe condition",
  near_miss: "Near miss",
  safe_behaviour: "Safe behaviour",
};

export const ACTION_LABEL: Record<string, string> = {
  created: "Raised",
  created_closed_on_spot: "Raised and corrected on the spot",
  edited: "Edited",
  assigned: "Assigned",
  started: "Work started",
  closure_submitted: "Closure submitted",
  approved: "Closure approved – closed",
  rejected: "Closure rejected",
  cancelled: "Cancelled",
  reopened: "Reopened",
  due_extended: "Due date extended",
  photo_withdrawn: "Photo withdrawn",
  photo_added: "Photo added",
};

export const FIELD_LABEL: Record<string, string> = {
  area_id: "Area", location: "Location", hazard: "Hazard", activity: "Work activity", lsr: "Life-Saving Rule", permit_type: "Permit type",
  permit_no: "Permit no.", equipment: "Equipment", person_observed: "Person observed", contractor_id: "Contractor", crew_size: "Crew size",
  severity: "Severity", likelihood: "Likelihood", work_stopped: "Work stopped", description: "Description", immediate_action: "Immediate action",
  root_cause: "Root cause", corrective_action: "Corrective action", control_level: "Control level", legal_ref: "Legal reference",
  owner_id: "Action owner", assigned_at: "Assigned at", risk_score: "Risk score", risk_level: "Risk level", category: "Category", category_code: "Category code",
  item: "Observation", item_code: "Item code", due_at: "Due date", status: "Status", closure_attempt: "Closure attempt",
};

export function riskLevelOf(sev: number | null, lik: number | null, stopped: boolean): "Low" | "Medium" | "High" | "Critical" | null {
  if (!sev || !lik) return stopped ? "Critical" : null;
  const s = sev * lik;
  if (stopped) return "Critical";
  return s >= 15 ? "Critical" : s >= 10 ? "High" : s >= 5 ? "Medium" : "Low";
}

export const SEVERITY = ["First aid", "Medical treatment", "Lost time / reportable", "Permanent disability / major loss", "Fatality / major accident"];
export const LIKELIHOOD = ["Rare", "Unlikely", "Possible", "Likely", "Almost certain"];

export function greeting(): string {
  const h = Number(new Date().toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: TZ }));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function daysAgo(n: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - n * 86_400_000));
}
