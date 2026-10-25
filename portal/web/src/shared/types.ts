/* SafeWorks Portal 2.0 — the API contract shared by the server (Pydantic models mirror these),
   the field app and the admin console. Every type here is JSON over HTTPS under /api/v1 (see portal/docs/API.md).
   Times are ISO 8601 strings in UTC; ids are UUID strings; money is INR. */

export type Lang = "en" | "hi" | "ta" | "kn";
export type I18n = Partial<Record<Lang, string>> & { en: string };

export type Role =
  | "reporter"
  | "action_owner"
  | "verifier"
  | "site_safety_officer"
  | "site_head"
  | "hse_manager"
  | "admin"
  | "auditor";

export const STAFF_ROLES: Role[] = ["site_safety_officer", "site_head", "hse_manager", "admin"];
export const ALL_SITES_ROLES: Role[] = ["hse_manager", "admin", "auditor"];

export type Band = "low" | "moderate" | "high" | "extreme";
export type ObservationType = "good_practice" | "unsafe_act" | "unsafe_condition" | "near_miss";
export type ObservationStatus = "submitted" | "returned" | "merged" | "discarded" | "closed" | "action_assigned" | "escalated";
export type ActionStatus = "open" | "in_progress" | "completed" | "verified" | "reopened" | "disputed" | "cancelled";
export type RunStatus = "scheduled" | "in_progress" | "completed" | "closed" | "missed" | "cancelled" | "reopened";
export type Channel = "app" | "web" | "qr" | "on_behalf";
export type ReporterType = "employee" | "contractor" | "temporary" | "visitor";
export type EstablishmentType = "factory" | "hazardous_process_factory" | "construction_site" | "mine" | "port" | "plantation" | "office" | "other";
export type AreaType =
  | "production" | "utilities" | "store" | "yard" | "scaffold_zone" | "excavation_zone" | "substation"
  | "office" | "canteen" | "gate" | "labour_camp" | "loading_bay" | "other";
export type AssetClass =
  | "lifting_appliance" | "lifting_gear" | "pressure_plant" | "boiler" | "extinguisher" | "first_aid_box" | "ladder"
  | "scaffold" | "harness" | "earth_pit" | "insulating_mat" | "rcd" | "earth_moving" | "vehicle" | "machine" | "other";
export type ControlLevel = "elimination" | "substitution" | "engineering" | "administrative" | "ppe";
export type ActionType = "correction" | "corrective" | "preventive" | "improvement";
export type VerificationMethod = "re_inspection" | "observation_sampling" | "recurrence_check" | "audit";
export type TriageDecision =
  | "accept_assign" | "accept_fixed_on_spot" | "return_to_reporter" | "reviewed_no_action"
  | "merge_duplicate" | "discard" | "escalate_incident";
export type AnswerType = "pass_fail_na" | "number" | "text" | "photo" | "signature" | "date" | "single_choice" | "multi_choice";
export type StatusLabel = "verified_primary" | "verified_secondary" | "voluntary_standard" | "company_standard" | "reference_to_confirm";

/* ---------- errors ---------- */
export interface ApiError {
  error: string; // human message, already translated when the request sent Accept-Language
  code: string; // machine code: bad_request, unauthorized, forbidden, not_found, conflict, too_large, rate_limited, must_change_password, mfa_required, server_error, ...
  details?: unknown;
}

/* ---------- auth & me ---------- */
export interface LoginRequest { login: string; password: string; kind: "field" | "admin"; deviceUuid?: string; platform?: string; appVersion?: string }
export interface LoginResponse {
  token: string;
  expiresAt: string;
  mfaRequired?: boolean; // true → token is a pre-auth token; call POST /auth/mfa (or /auth/mfa/enrol first when mfaEnrolled is false)
  mfaEnrolled?: boolean;
  mustChangePassword?: boolean;
  me?: Me; // present when fully signed in
}
export interface MfaEnrolResponse { secret: string; otpauthUrl: string }
export interface EnrolRequest { code: string; newPassword: string; deviceUuid?: string; platform?: string; appVersion?: string }

export interface SiteRole { siteId: string | null; role: Role; medicalData: boolean; expiresAt?: string | null }
export interface Me {
  id: string;
  name: string;
  employeeCode: string;
  email: string;
  language: Lang;
  loginType: "employee_code" | "email" | "enrolment_code";
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  roles: SiteRole[];
  sites: Site[]; // sites in scope (all active sites for all-sites roles)
  employerId: string | null;
  org: { id: string; name: string; settings: OrgSettings };
  privacyNoticeVersion: number; // current notice version
  privacyAckedVersion: number | null;
  serverTime: string;
}
export interface OrgSettings {
  mfaRequiredRoles: Role[];
  triageSlaWorkingDays: number; // 1
  triageEscalateWorkingDays: number; // 2
  criticalAckMinutes: number; // 30
  quietHours: { start: string; end: string }; // "21:00"–"07:00"
  dailyPushCap: number; // 5
  duplicateWindowHours: number; // 24
  duplicateRadiusM: number; // 30
  photoMaxEdgePx: number; // 1600
  photoQuality: number; // 0.8
  defaultLanguage: Lang;
  languages: Lang[];
  dateChangeRequestsBeforeSiteHead: number; // 3rd request needs the site head
  disputePauseDays: number; // 3
  statusLabels: Record<string, string>; // e.g. {"risk_matrix":"design default"}
}

/* ---------- reference data (pulled to the phone) ---------- */
export interface Site {
  id: string;
  code: string;
  name: I18n;
  address: string;
  state: string;
  district: string;
  lat: number | null;
  lng: number | null;
  geofenceRadiusM: number | null;
  industryCode: string | null;
  establishmentType: EstablishmentType;
  appropriateGovernment: "state" | "centre";
  ruleSetCode: string | null;
  ruleSetEffectiveFrom: string | null;
  riskMatrixVersionId: string | null;
  hazardousProcess: boolean;
  workingCalendar: { weeklyOff: number[]; shiftStart: string; shiftEnd: string };
  workerCount: number | null;
  siteHeadUserId: string | null;
  active: boolean;
  version: number;
  updatedAt: string;
}
export interface Area {
  id: string; siteId: string; parentAreaId: string | null; code: string; name: I18n; areaType: AreaType;
  hazardousProcess: boolean; ownerUserId: string | null; sort: number; active: boolean; version: number; updatedAt: string;
}
export interface Asset {
  id: string; siteId: string; areaId: string | null; assetClass: AssetClass; tagNo: string; serialNo: string; makeModel: string;
  swlKg: number | null; ownerEmployerId: string | null; status: "in_service" | "do_not_use" | "retired"; statusReason: string;
  nextExamDue: string | null; qrToken?: string | null; version: number; updatedAt: string;
}
export interface Category {
  id: string; code: string; parentCode: string | null; name: I18n; icon: string;
  appliesTo: { industries?: string[]; types?: ObservationType[] };
  criticalCapable: boolean; incidentPrompt: string; is3786Default: string;
  extraFields: ExtraField[]; defaultRecipientRoles: Role[]; emailDetail: "private" | "summary" | "detailed"; sort: number; active: boolean; updatedAt: string;
}
export interface ExtraField { key: string; label: I18n; type: "text" | "number" | "choice" | "boolean"; options?: I18n[]; required?: boolean }
export interface Contractor {
  id: string; name: string; isOwnCompany: boolean; parentId: string | null; registrationNo: string; contactName: string; phone: string; email: string;
  trades: string[]; siteIds: string[]; active: boolean; updatedAt: string;
}
export interface Person { id: string; fullName: string; employerId: string | null; phoneMasked: string; preferredLanguage: Lang; trade: string; workerType: ReporterType; active: boolean }
export interface DirectoryUser { id: string; name: string; employeeCode: string; employerId: string | null; roles: SiteRole[]; active: boolean }
export interface RiskMatrixVersion {
  id: string; matrixId: string; name: string; size: 3 | 4 | 5; version: number; status: "draft" | "active" | "retired"; effectiveFrom: string | null;
  likelihoodLabels: { v: number; label: I18n }[];
  severityLabels: { v: number; label: I18n; anchor?: I18n }[];
  bands: { band: Band; min: number; max: number; colour: "green" | "amber" | "orange" | "red"; response: I18n }[];
  statusLabel: string;
}
export interface DueDateRule { id: string; siteId: string | null; band: Band; dueAmount: number; dueUnit: "hours" | "days" | "working_days"; interimControlRequired: boolean; verifyWithinHours: number; statusLabel: string }
export interface ReminderLadder { id: string; band: Band; steps: { offsetMinutes: number; recipient: "owner" | "verifier" | "site_safety_officer" | "site_head" | "hse_manager"; channel: "push" | "email" | "both" }[]; dailyCap: number; statusLabel: string }
export interface IndustryProfile {
  code: string; name: I18n; tagline: string; icon: string; establishmentTypes: EstablishmentType[]; categoryCodes: string[]; templateCodes: string[];
  hazards: string[]; ppe: string[]; library: { regs?: string[]; procs?: string[]; cks?: string[]; talks?: string[]; tasks?: { id: string; t: string }[] };
}
export interface RuleSet {
  code: string; name: string; state: string; siteType: string; regime: "legacy" | "osh_state_final" | "osh_central" | "draft";
  status: "verified_primary" | "verified_secondary" | "draft_rule" | "unverified" | "provisional"; enabled: boolean; version: string;
  effectiveFrom: string | null; reviewedBy: string; reviewedAt: string | null; notes: string; timerRules: TimerRule[];
}
export interface TimerRule { id: string; trigger: { eventClass: string; conditions?: string[] }; deadlineBasis: "from_learned_at" | "from_condition_met"; deadlineMinutes: number | null; recipient: string; formCode: string; status: RuleSet["status"]; sourceNote: string }

/* ---------- media ---------- */
export interface MediaRef {
  clientUuid: string; // generated on the device
  kind: "photo" | "audio" | "signature" | "pdf" | "html";
  purpose: "before" | "after" | "evidence" | "signature" | "voice" | "report";
  sha256: string; // hex of the bytes about to be uploaded
  bytes: number;
  mime: string;
  width?: number | null;
  height?: number | null;
  durationS?: number | null;
  capturedAt: string;
  lat?: number | null;
  lng?: number | null;
  annotation?: unknown; // vector overlay kept with the pixels untouched
  redacted?: boolean;
}
export interface Media extends MediaRef {
  id: string;
  ownerType: "observation" | "action_event" | "inspection_answer" | "inspection_run" | "incident" | "asset" | "comment";
  ownerId: string;
  url: string | null; // short-lived signed URL, null while upload_status is pending
  thumbUrl?: string | null;
  uploadStatus: "pending" | "uploaded" | "verified" | "failed";
  hashMatch: boolean | null;
}

/* ---------- observations ---------- */
export interface ObservationCreate {
  clientUuid: string;
  siteId: string;
  areaId: string | null;
  assetId?: string | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  capturedAt: string;
  channel: Channel;
  reporterType: ReporterType;
  anonymous: boolean;
  type: ObservationType;
  categoryCodes: string[];
  taskObserved?: string;
  description: string; // ≤ 500 chars
  descriptionLang: Lang;
  fixedOnSpot: boolean;
  immediateAction?: string;
  imminentDanger: boolean;
  employerInvolvedId?: string | null;
  trade?: string;
  extra?: Record<string, unknown>; // category extra fields
  media: MediaRef[]; // text first; bytes follow through POST /media/{clientUuid}
  onBehalfOf?: { name: string; employerId?: string | null } | null;
}
export interface ObservationSummary {
  id: string;
  clientUuid: string;
  caseNo: string;
  siteId: string;
  areaId: string | null;
  areaName: I18n | null;
  type: ObservationType;
  categoryCodes: string[];
  description: string;
  status: ObservationStatus;
  riskBand: Band | null;
  imminentDanger: boolean;
  fixedOnSpot: boolean;
  anonymous: boolean;
  channel: Channel;
  reporterName: string | null; // null when anonymous or when the viewer may not see it
  capturedAt: string;
  receivedAt: string;
  triagedAt: string | null;
  closedAt: string | null;
  thumbUrl: string | null;
  openActions: number;
  totalActions: number;
  criticalAckedAt: string | null;
  mine: boolean; // reported by the viewer (works for anonymous via the seal)
  version: number;
  updatedAt: string;
}
export interface TriageRecord {
  id: string; decision: TriageDecision | "reopen"; reasonCode: string; reasonText: string; likelihood: number | null; severity: number | null;
  band: Band | null; decidedByName: string; decidedAt: string;
}
export interface Comment { id: string; kind: "comment" | "return_question" | "reporter_reply" | "system" | "rejected_offline_decision"; userName: string | null; body: string; createdAt: string; mine: boolean }
export interface ObservationDetail extends ObservationSummary {
  assetId: string | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  taskObserved: string;
  descriptionLang: Lang;
  immediateAction: string;
  employerInvolvedId: string | null;
  trade: string;
  extra: Record<string, unknown>;
  likelihood: number | null;
  severity: number | null;
  riskScore: number | null;
  riskMatrixVersionId: string | null;
  is3786Code: string;
  masterObservationId: string | null;
  masterCaseNo: string | null;
  escalatedIncidentId: string | null;
  learnedAt: string | null;
  closureSummary: string;
  media: Media[];
  triage: TriageRecord[];
  comments: Comment[];
  actions: ActionSummary[];
  duplicates?: DuplicateSuggestion[];
  reporterContact?: { name: string; phone: string } | null; // officer/site head/HSE only, named QR reports
  can: { triage: boolean; comment: boolean; reopen: boolean; ackCritical: boolean; reply: boolean };
}
export interface DuplicateSuggestion { id: string; caseNo: string; type: ObservationType; status: ObservationStatus; description: string; receivedAt: string; score: number; reasons: string[] }

export interface ActionDraft {
  clientUuid: string;
  title: string;
  problem?: string;
  actionType: ActionType;
  controlLevel: ControlLevel;
  ownerUserId: string;
  responsibleEmployerId?: string | null;
  band?: Band; // defaults to the observation's band
  dueAt?: string; // defaults from the due-date rule
  interimControl?: string;
  interimReviewAt?: string;
}
export interface TriageRequest {
  clientUuid: string; // idempotency key of the decision
  decision: TriageDecision;
  categoryCodes?: string[];
  likelihood?: number;
  severity?: number;
  is3786Code?: "B-2" | "B-3" | "B-4" | "";
  employerInvolvedId?: string | null;
  trade?: string;
  reasonCode?: string;
  reasonText?: string;
  question?: string; // return_to_reporter
  masterObservationId?: string; // merge_duplicate
  actions?: ActionDraft[]; // accept_assign: at least one
  interimControl?: string; // required when band is extreme
  learnedAt?: string; // escalate_incident
  capturedAt: string;
}

/* ---------- actions ---------- */
export interface ActionSummary {
  id: string;
  clientUuid: string;
  caseNo: string;
  siteId: string;
  areaId: string | null;
  sourceType: "observation" | "inspection_answer" | "incident" | "root_cause" | "examination" | "committee_recommendation" | "permit_audit" | "manual";
  sourceId: string | null;
  sourceCaseNo: string | null;
  title: string;
  band: Band;
  status: ActionStatus;
  ownerUserId: string;
  ownerName: string;
  responsibleEmployerId: string | null;
  dueAt: string;
  originalDueAt: string;
  overdue: boolean;
  completedAt: string | null;
  verifiedAt: string | null;
  reopenCount: number;
  pendingRequest: "date_change" | "dispute" | null;
  thumbUrl: string | null;
  version: number;
  updatedAt: string;
}
export interface ActionEvent {
  id: number;
  eventType: "created" | "comment" | "status_change" | "attachment" | "date_change_requested" | "date_change_decided" | "dispute_raised" | "dispute_decided" | "reassigned" | "reminder_sent" | "escalated" | "verification";
  fromStatus: ActionStatus | null;
  toStatus: ActionStatus | null;
  body: string;
  payload: Record<string, unknown>;
  actorName: string | null;
  at: string;
  media: Media[];
}
export interface ActionRequest { id: string; type: "date_change" | "dispute"; requestedByName: string; proposedDueAt: string | null; reasonCode: string; reason: string; status: "pending" | "approved" | "rejected" | "reassigned" | "cancelled"; decidedByName: string | null; decidedAt: string | null; decisionNote: string; createdAt: string }
export interface ActionDetail extends ActionSummary {
  problem: string;
  causeAddressed: string;
  actionType: ActionType;
  controlLevel: ControlLevel;
  interimControl: string;
  interimReviewAt: string | null;
  statutoryClock: string;
  completedByName: string | null;
  completionNote: string;
  verificationMethod: VerificationMethod | "";
  verifierName: string | null;
  verificationResult: "effective" | "not_effective" | "";
  verificationReason: string;
  escalationLevel: number;
  cancelReason: string;
  sourceMedia: Media[]; // before photos from the source
  events: ActionEvent[];
  requests: ActionRequest[];
  can: { start: boolean; complete: boolean; verify: boolean; request: boolean; decide: boolean; cancel: boolean; reassign: boolean; comment: boolean };
}
export interface ActionCompleteRequest { clientUuid: string; completionNote: string; causeAddressed: string; media: MediaRef[]; capturedAt: string }
export interface ActionVerifyRequest { clientUuid: string; result: "effective" | "not_effective"; method: VerificationMethod; reason?: string; media?: MediaRef[]; capturedAt: string }
export interface ActionRequestCreate { clientUuid: string; type: "date_change" | "dispute"; proposedDueAt?: string; reasonCode: string; reason: string; capturedAt: string }
export interface ActionRequestDecide { decision: "approved" | "rejected" | "reassigned"; note?: string; newOwnerUserId?: string; newDueAt?: string }
export interface ActionCancelRequest { reason: string; approvedByUserId: string } // site head approval recorded with the request
export interface ActionCreateRequest extends ActionDraft { siteId: string; areaId?: string | null; sourceType?: ActionSummary["sourceType"]; sourceId?: string | null; capturedAt: string }

/* ---------- inspections ---------- */
export interface ResponseOption { value: string; label: I18n; colour: "green" | "red" | "grey" | "amber" | "blue"; flag: boolean; score: number | null }
export interface Question {
  id: string; code: string; sort: number; text: I18n; guidance: I18n; guidanceMediaUrl: string | null; answerType: AnswerType;
  responseSet: ResponseOption[]; unit: string; min: number | null; max: number | null; passMin: number | null; passMax: number | null;
  required: boolean; photoOnFail: boolean; noteOnFail: boolean; actionOnFail: boolean;
  actionDefaults: { ownerRole?: Role; ownerUserId?: string; band?: Band; dueOffsetHours?: number; controlLevel?: ControlLevel };
  showIf: { questionCode: string; equals: string } | null; referenceText: string; referenceStatus: StatusLabel;
}
export interface Section { id: string; sort: number; title: I18n; repeatable: boolean; repeatLabel: string; questions: Question[] }
export interface TemplateVersion {
  id: string; templateId: string; code: string; name: I18n; type: string; version: number; status: "draft" | "in_review" | "active" | "retired";
  titleFields: string[]; scoring: { anyFailRule: boolean; passMarkPct: number }; requiredCompetenceType: string;
  appliesTo: { industries?: string[]; areaTypes?: AreaType[]; assetClasses?: AssetClass[] };
  authorName: string | null; approvedByName: string | null; approvedAt: string | null; changeNote: string; sections: Section[]; updatedAt: string;
}
export interface Schedule { id: string; templateId: string; siteId: string; areaId: string | null; assetId: string | null; frequency: { every: number; unit: "day" | "week" | "month"; weekdays?: number[]; time: string }; assigneeUserId: string | null; assigneeRole: Role | null; leadDays: number; graceHours: number; nextDueAt: string | null; active: boolean }
export interface Answer { clientUuid: string; questionId: string; repeatIndex: number; value: unknown; note?: string; likelihood?: number | null; severity?: number | null; media?: MediaRef[]; action?: ActionDraft | null; answeredAt: string; lat?: number | null; lng?: number | null }
export interface RunSummary {
  id: string; clientUuid: string; caseNo: string; templateVersionId: string; templateCode: string; templateName: I18n; siteId: string; areaId: string | null; assetId: string | null;
  scheduleId: string | null; trigger: "scheduled" | "spot" | "after_incident" | "after_change" | "weather_event"; dueAt: string | null; startedAt: string | null; completedAt: string | null;
  status: RunStatus; inspectorUserId: string | null; inspectorName: string | null; scorePct: number | null; result: "pass" | "fail" | null; tagStatus: "safe_to_use" | "do_not_use" | null;
  failedCount: number; actionsRaised: number; version: number; updatedAt: string;
}
export interface RunDetail extends RunSummary {
  header: Record<string, string>; answers: (Answer & { id: string; flag: boolean; score: number | null; actionId: string | null; media: Media[]; repeatFinding: boolean })[];
  signature: Media | null; reportUrl: string | null; immediateAction: string; reopenReason: string; can: { answer: boolean; submit: boolean; reopen: boolean; cancel: boolean };
}
export interface RunStartRequest { clientUuid: string; templateVersionId: string; siteId: string; areaId?: string | null; assetId?: string | null; scheduleId?: string | null; trigger?: RunSummary["trigger"]; header: Record<string, string>; startedAt: string; lat?: number | null; lng?: number | null }
export interface RunSubmitRequest { clientUuid: string; answers: Answer[]; signature: MediaRef | null; immediateAction?: string; tagStatus?: "safe_to_use" | "do_not_use" | null; completedAt: string; lat?: number | null; lng?: number | null }

/* ---------- sync ---------- */
export type SyncOp =
  | { entityType: "observation"; op: "create"; payload: ObservationCreate }
  | { entityType: "observation"; op: "comment"; payload: { observationId: string; clientUuid: string; body: string; capturedAt: string } }
  | { entityType: "observation"; op: "reply"; payload: { observationId: string; clientUuid: string; body: string; media: MediaRef[]; capturedAt: string } }
  | { entityType: "observation"; op: "triage"; payload: { observationId: string } & TriageRequest }
  | { entityType: "observation"; op: "ack_critical"; payload: { observationId: string; capturedAt: string } }
  | { entityType: "action"; op: "create"; payload: ActionCreateRequest }
  | { entityType: "action"; op: "start"; payload: { actionId: string; capturedAt: string } }
  | { entityType: "action"; op: "complete"; payload: { actionId: string } & ActionCompleteRequest }
  | { entityType: "action"; op: "verify"; payload: { actionId: string } & ActionVerifyRequest }
  | { entityType: "action"; op: "request"; payload: { actionId: string } & ActionRequestCreate }
  | { entityType: "action"; op: "comment"; payload: { actionId: string; clientUuid: string; body: string; media?: MediaRef[]; capturedAt: string } }
  | { entityType: "inspection_run"; op: "start"; payload: RunStartRequest }
  | { entityType: "inspection_run"; op: "answers"; payload: { runId: string; answers: Answer[] } }
  | { entityType: "inspection_run"; op: "submit"; payload: { runId: string } & RunSubmitRequest };

export type SyncCommand = SyncOp & {
  commandId: string; // idempotency key (uuid)
  seq: number; // per device, monotonic
  entityClientUuid: string; // the record this command is about (its client uuid)
  baseVersion?: number | null;
  capturedAt: string;
  dependsOn?: string[]; // command ids that must be applied first
};
export interface SyncPushRequest { deviceId: string; appVersion: string; commands: SyncCommand[] }
export interface SyncResult {
  commandId: string;
  status: "applied" | "duplicate" | "rejected" | "conflict_saved_as_comment";
  serverId?: string;
  caseNo?: string;
  error?: ApiError;
  uploads?: { clientUuid: string; url: string }[]; // where to PUT each pending media file
}
export interface SyncPushResponse { results: SyncResult[]; serverTime: string }

export interface SyncPullResponse {
  cursor: string; // pass back next time
  full: boolean; // true when the whole scope was sent (empty or stale cursor)
  serverTime: string;
  me: Me;
  sites: Site[];
  areas: Area[];
  assets: Asset[];
  categories: Category[];
  contractors: Contractor[];
  directory: DirectoryUser[]; // people the viewer may assign to or see as names
  matrixVersions: RiskMatrixVersion[];
  dueDateRules: DueDateRule[];
  ladders: ReminderLadder[];
  industries: IndustryProfile[];
  templates: TemplateVersion[]; // active versions in scope + versions of the viewer's open runs
  schedules: Schedule[];
  observations: ObservationSummary[]; // mine + site scope for officers (last 30 days + open)
  actions: ActionSummary[]; // mine (owner/verifier) + site scope for officers
  runs: RunSummary[]; // mine + due for my role
  notifications: Notification[]; // unread + last 7 days
  translations: Record<Lang, Record<string, string>>; // company overrides only
  deleted: { entityType: string; id: string }[]; // tombstones since cursor
  privacyNotice: { version: number; body: Record<Lang, string>; effectiveFrom: string } | null;
}

/* ---------- notifications ---------- */
export interface Notification {
  id: number; eventType: string; recordType: string; recordId: string | null; title: string; body: string; link: string; critical: boolean;
  status: "queued" | "sent" | "delivered" | "failed" | "acknowledged"; readAt: string | null; ackedAt: string | null; createdAt: string;
}
export interface Preferences { language: Lang; digest: "daily" | "weekly" | "off"; quietHours: boolean }
export interface PushSubscriptionBody { deviceUuid: string; platform: string; appVersion: string; subscription: unknown | null }

/* ---------- dashboard & exports ---------- */
export interface Kpi { key: string; label: I18n; value: number | null; unit?: string; n?: number; trend?: number | null; hint?: I18n; formula?: string }
export interface SeriesPoint { x: string; y: number; n?: number }
export interface Dashboard {
  siteIds: string[]; from: string; to: string;
  kpis: Kpi[]; // open actions, overdue, triage backlog, on-time closure %, median days to close, participation %, critical ack median minutes, inspection completion %, repeat findings %, discard rate %
  byType: { type: ObservationType; count: number }[];
  byCategory: { code: string; count: number; atRisk: number; safe: number }[];
  byArea: { areaId: string; name: I18n; count: number }[];
  byEmployer: { employerId: string | null; name: string; count: number }[];
  weekly: { week: string; reports: number; atRisk: number; good: number }[];
  ageing: { bucket: string; count: number }[]; // 0-7, 8-30, 31-90, 90+
  daysToCloseByBand: { band: Band; median: number | null; n: number }[];
  topRepeatFindings: { questionText: I18n; templateName: I18n; count: number }[];
  sampleNote: I18n;
}

/* ---------- public QR form ---------- */
export interface QrInfo {
  token: string; site: { id: string; code: string; name: I18n }; area: { id: string; name: I18n } | null; asset: { id: string; tagNo: string; assetClass: AssetClass } | null;
  categories: Category[]; languages: Lang[]; defaultLanguage: Lang; privacyNotice: Record<Lang, string>; orgName: string; maxPhotos: number;
}
export interface QrObservationCreate {
  clientUuid: string; type: ObservationType; categoryCodes: string[]; description: string; descriptionLang: Lang; fixedOnSpot: boolean; immediateAction?: string; imminentDanger: boolean;
  anonymous: boolean; name?: string; phone?: string; reporterType: ReporterType; employerName?: string; lat: number | null; lng: number | null; accuracyM: number | null; capturedAt: string; media: MediaRef[]; honeypot?: string;
}
export interface QrObservationResponse { caseNo: string; statusUrl: string; uploads: { clientUuid: string; url: string }[] }
export interface PublicStatus { caseNo: string; status: ObservationStatus; type: ObservationType; receivedAt: string; timeline: { at: string; text: string }[]; closureSummary: string }

/* ---------- admin ---------- */
export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }
export interface UserAdmin {
  id: string; name: string; personId: string | null; employeeCode: string; email: string; loginType: Me["loginType"]; status: "active" | "suspended" | "deactivated";
  language: Lang; mfaEnabled: boolean; mustChangePassword: boolean; lockedUntil: string | null; failedAttempts: number; expiresAt: string | null; lastLoginAt: string | null;
  roles: SiteRole[]; employerId: string | null; employerName: string | null; devices: { id: string; platform: string; appVersion: string; lastSeenAt: string; revokedAt: string | null }[]; createdAt: string;
}
export interface UserCreate { name: string; employeeCode?: string; email?: string; loginType: Me["loginType"]; language: Lang; employerId?: string | null; trade?: string; phone?: string; roles: { siteId: string | null; role: Role; medicalData?: boolean; expiresAt?: string | null }[]; expiresAt?: string | null }
export interface QrCode { id: string; token: string; targetType: "site" | "area" | "asset"; targetId: string; targetName: string; label: string; prefill: Record<string, unknown>; active: boolean; scanCount: number; lastScanAt: string | null; createdAt: string; url: string }
export interface AuditRow { id: number; at: string; actorName: string | null; actorRole: string; siteCode: string | null; action: string; recordType: string; recordId: string; changes: Record<string, unknown>; reason: string; hash: string }
export interface AuditVerify { ok: boolean; rows: number; firstBadId: number | null; checkedAt: string }
export interface TranslationPack { lang: Lang; total: number; translated: number; missing: string[]; overrides: Record<string, string> }
export interface Health { serverTime: string; version: string; db: "ok" | "error"; storageDriver: "disk" | "db"; queuedEmails: number; failedNotifications24h: number; syncRejected24h: number; devicesByVersion: { appVersion: string; count: number }[]; lastJobRuns: { key: string; at: string }[]; backups: { lastAt: string | null; note: string } }
export interface ImportResult { created: number; updated: number; skipped: number; errors: { row: number; message: string }[] }
