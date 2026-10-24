export type Role = "platform_admin" | "org_admin" | "viewer" | "safety_officer" | "supervisor" | "auditor";
export type ObsType = "unsafe_act" | "unsafe_condition" | "near_miss" | "safe_behaviour";
export type Status = "open" | "in_progress" | "closure_submitted" | "closed" | "cancelled" | "noted";
export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

export interface Me {
  id: string;
  employeeId: string;
  name: string;
  designation: string;
  phone: string;
  email: string;
  mustChangePassword: boolean;
  company: string;
  roles: { role: Role; roleLabel: string; siteId: string | null; siteCode: string | null; siteName: string | null }[];
  unreadNotifications: number;
}

export interface Person {
  id: string;
  name: string;
  designation: string;
  role: Role;
  contractor?: string | null;
}

export interface Site {
  id: string;
  code: string;
  name: string;
  type: string;
  state: string;
  address: string;
  siteHead: { name: string; phone: string };
  myRoles: Role[];
  can: { raise: boolean; manage: boolean; viewAll: boolean };
  areas: { id: string; name: string }[];
  contractors: { id: string; name: string }[];
  owners: Person[];
  safetyOfficers: { name: string; phone: string }[];
}

export interface MasterItem {
  code: string;
  label: string;
  parent: string | null;
  sort: number;
  version: string;
}

export interface Master {
  lists: Record<string, MasterItem[]>;
  settings: { dueDays: Record<RiskLevel, number>; escalation: { siteHeadDays: number; adminDays: number } };
  company: string;
}

export interface ObsListItem {
  id: string;
  code: string;
  type: ObsType;
  typeLabel: string;
  category: string;
  item: string;
  hazard: string;
  riskLevel: RiskLevel | null;
  status: Status;
  overdue: boolean;
  dueAt: string | null;
  raisedAt: string;
  closedAt: string | null;
  closureSubmittedAt: string | null;
  description: string;
  isRepeat: boolean;
  workStopped: boolean;
  lsr: string;
  site: { id: string; code: string; name: string };
  area: string | null;
  location: string;
  ownerName: string | null;
  raisedByName: string;
  contractorName: string | null;
  thumbUrl: string | null;
}

export interface ObsPhoto {
  id: string;
  kind: "evidence" | "closure";
  closureId: string | null;
  url: string;
  uploadedAt: string;
  withdrawn: boolean;
  withdrawnReason: string;
}

export interface Closure {
  id: string;
  attempt: number;
  comment: string;
  completedOn: string;
  controlLevel: string;
  submittedBy: string;
  submittedById: string;
  submittedAt: string;
  decision: "pending" | "approved" | "rejected";
  decidedBy: string | null;
  decidedAt: string | null;
  remarks: string;
  onsiteVerified: boolean;
}

export interface ObsDetail {
  id: string;
  code: string;
  type: ObsType;
  typeLabel: string;
  status: Status;
  overdue: boolean;
  site: { id: string; code: string; name: string; state: string };
  round: { id: string; code: string } | null;
  areaId: string | null;
  area: string | null;
  location: string;
  observedAt: string;
  raisedAt: string;
  raisedBy: { id: string; name: string; designation: string; employeeId: string };
  categoryCode: string;
  category: string;
  itemCode: string;
  item: string;
  hazard: string;
  activity: string;
  lsr: string;
  permitType: string;
  permitNo: string;
  equipment: string;
  personObserved: string;
  contractorId: string | null;
  contractorName: string | null;
  crewSize: number | null;
  severity: number | null;
  likelihood: number | null;
  riskScore: number | null;
  riskLevel: RiskLevel | null;
  workStopped: boolean;
  description: string;
  immediateAction: string;
  rootCause: string;
  correctiveAction: string;
  controlLevel: string;
  correctedOnSpot: boolean;
  owner: { id: string; name: string; designation: string } | null;
  assignedAt: string | null;
  dueAt: string | null;
  originalDueAt: string | null;
  legalRef: string;
  repeatOf: { id: string; code: string } | null;
  closureSubmittedAt: string | null;
  closedAt: string | null;
  closedBy: string | null;
  cancelReason: string;
  version: number;
  photos: ObsPhoto[];
  closures: Closure[];
  timeline: { id: number; version: number; at: string; action: string; changes: Record<string, [unknown, unknown]>; reason: string; actor: string | null }[];
  comments: { id: string; body: string; at: string; user: string; userId: string }[];
  can: { edit: boolean; assign: boolean; extend: boolean; start: boolean; submitClosure: boolean; decide: boolean; cancel: boolean; reopen: boolean; comment: boolean; withdrawPhoto: boolean };
}

export interface Counters {
  created: number;
  open: number;
  overdue: number;
  awaiting: number;
  closed: number;
  noted: number;
}

export interface Kpis {
  raised: number;
  closed: number;
  closureRate: number | null;
  onTimeClosure: number | null;
  avgDaysToClose: number | null;
  actConditionRatio: number | null;
  acts: number;
  conditions: number;
  nearMisses: number;
  safeBehaviourShare: number | null;
  repeatRate: number | null;
  highCritical: number;
}

export interface SiteDashboard {
  period: { from: string; to: string };
  counters: Counters;
  kpis: Kpis;
  byCategory: { label: string; n: number }[];
  byHazard: { label: string; n: number }[];
  byArea: { label: string; n: number }[];
  byContractor: { label: string; n: number }[];
  byRisk: { label: string; n: number }[];
  byType: { label: string; n: number }[];
  weekly: { week: string; raised: number; closed: number }[];
  overdue: { id: string; code: string; item: string; riskLevel: RiskLevel | null; dueAt: string; ownerName: string | null; siteName: string; daysOverdue: number }[];
  repeats: { label: string; area: string; n: number }[];
  lsrBreaches: { label: string; n: number }[];
  perOfficer: { officer: string; day: string; n: number }[];
}
