"""Pydantic v2 request models mirroring web/src/shared/types.ts (camelCase on the wire).

Request models forbid unknown keys so a typo on the client fails loudly instead of being dropped.
Responses are built as plain camelCase dicts by `views.py` (fast path through orjson).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError, field_validator
from pydantic.alias_generators import to_camel
from typing_extensions import Annotated

from .errors import bad_request

Lang = Literal["en", "hi", "ta", "kn"]
Role = Literal["reporter", "action_owner", "verifier", "site_safety_officer", "site_head", "hse_manager", "admin", "auditor"]
Band = Literal["low", "moderate", "high", "extreme"]
ObservationType = Literal["good_practice", "unsafe_act", "unsafe_condition", "near_miss"]
Channel = Literal["app", "web", "qr", "on_behalf"]
ReporterType = Literal["employee", "contractor", "temporary", "visitor"]
EstablishmentType = Literal["factory", "hazardous_process_factory", "construction_site", "mine", "port", "plantation", "office", "other"]
AreaType = Literal["production", "utilities", "store", "yard", "scaffold_zone", "excavation_zone", "substation", "office", "canteen", "gate", "labour_camp", "loading_bay", "other"]
AssetClass = Literal["lifting_appliance", "lifting_gear", "pressure_plant", "boiler", "extinguisher", "first_aid_box", "ladder", "scaffold", "harness", "earth_pit", "insulating_mat", "rcd", "earth_moving", "vehicle", "machine", "other"]
ControlLevel = Literal["elimination", "substitution", "engineering", "administrative", "ppe"]
ActionType = Literal["correction", "corrective", "preventive", "improvement"]
VerificationMethod = Literal["re_inspection", "observation_sampling", "recurrence_check", "audit"]
TriageDecision = Literal["accept_assign", "accept_fixed_on_spot", "return_to_reporter", "reviewed_no_action", "merge_duplicate", "discard", "escalate_incident"]
AnswerType = Literal["pass_fail_na", "number", "text", "photo", "signature", "date", "single_choice", "multi_choice"]
StatusLabel = Literal["verified_primary", "verified_secondary", "voluntary_standard", "company_standard", "reference_to_confirm"]
SourceType = Literal["observation", "inspection_answer", "incident", "root_cause", "examination", "committee_recommendation", "permit_audit", "manual"]
RunTrigger = Literal["scheduled", "spot", "after_incident", "after_change", "weather_event"]

Str500 = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
Str200 = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
Str2000 = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
Str5000 = Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)]
UuidStr = Annotated[str, StringConstraints(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")]


class In(BaseModel):
    """Base for request bodies: camelCase keys, unknown keys refused, defaults validated."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, validate_default=True, extra="forbid", str_strip_whitespace=True)


class Loose(In):
    """Base for bodies that legitimately carry free-form keys (e.g. extra fields)."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, validate_default=True, extra="ignore", str_strip_whitespace=True)


M = TypeVar("M", bound=BaseModel)


def parse(model: type[M], data: Any) -> M:
    """Validate a body; the first problem becomes a 400 `path: message` with every issue in `details`."""
    try:
        return model.model_validate(data if data is not None else {})
    except ValidationError as e:
        issues = []
        for err in e.errors():
            path = ".".join(str(p) for p in err.get("loc", ())) or "input"
            msg = str(err.get("msg", "invalid"))
            if msg.startswith("Value error, "):
                msg = msg[len("Value error, "):]
            issues.append({"path": path, "message": msg})
        first = issues[0] if issues else {"path": "input", "message": "invalid"}
        raise bad_request(f"{first['path']}: {first['message']}", issues, key="err.validation", path=first["path"], message=first["message"])


# ---------- auth & me ----------
class LoginRequest(In):
    login: Str200
    password: Annotated[str, StringConstraints(max_length=200)]
    kind: Literal["field", "admin"] = "field"
    device_uuid: Str200 | None = None
    platform: Str200 | None = None
    app_version: Str200 | None = None


class MfaCode(In):
    code: Annotated[str, StringConstraints(max_length=12)]


class EnrolRequest(In):
    code: Str200
    new_password: Annotated[str, StringConstraints(max_length=200)]
    device_uuid: Str200 | None = None
    platform: Str200 | None = None
    app_version: Str200 | None = None


class PasswordChange(In):
    current: Annotated[str, StringConstraints(max_length=200)] = ""
    new: Annotated[str, StringConstraints(max_length=200)]


class Preferences(In):
    language: Lang = "en"
    digest: Literal["daily", "weekly", "off"] = "daily"
    quiet_hours: bool = True


class PushSubscriptionBody(In):
    device_uuid: Str200
    platform: Str200 = ""
    app_version: Str200 = ""
    subscription: Any = None


class PrivacyAck(In):
    version: int


# ---------- media ----------
class MediaRef(In):
    client_uuid: UuidStr
    kind: Literal["photo", "audio", "signature", "pdf", "html"] = "photo"
    purpose: Literal["before", "after", "evidence", "signature", "voice", "report"] = "evidence"
    sha256: Annotated[str, StringConstraints(pattern=r"^[0-9a-fA-F]{64}$")]
    bytes: int = Field(ge=1, le=15 * 1024 * 1024)
    mime: Str200
    width: int | None = None
    height: int | None = None
    duration_s: float | None = None
    captured_at: datetime
    lat: float | None = None
    lng: float | None = None
    annotation: Any = None
    redacted: bool = False


# ---------- observations ----------
class OnBehalfOf(In):
    name: Str200
    employer_id: UuidStr | None = None


class ObservationCreate(In):
    client_uuid: UuidStr
    site_id: UuidStr
    area_id: UuidStr | None = None
    asset_id: UuidStr | None = None
    lat: float | None = None
    lng: float | None = None
    accuracy_m: float | None = None
    captured_at: datetime
    channel: Channel = "app"
    reporter_type: ReporterType = "employee"
    anonymous: bool = False
    type: ObservationType
    category_codes: list[Str200] = Field(default_factory=list)
    task_observed: Str500 = ""
    description: Str500 = ""
    description_lang: Lang = "en"
    fixed_on_spot: bool = False
    immediate_action: Str2000 = ""
    imminent_danger: bool = False
    employer_involved_id: UuidStr | None = None
    trade: Str200 = ""
    extra: dict[str, Any] = Field(default_factory=dict)
    media: list[MediaRef] = Field(default_factory=list)
    on_behalf_of: OnBehalfOf | None = None


class ActionDraft(In):
    client_uuid: UuidStr
    title: Str500
    problem: Str2000 = ""
    action_type: ActionType = "corrective"
    control_level: ControlLevel = "administrative"
    owner_user_id: UuidStr
    responsible_employer_id: UuidStr | None = None
    band: Band | None = None
    due_at: datetime | None = None
    interim_control: Str2000 = ""
    interim_review_at: datetime | None = None


class TriageRequest(In):
    client_uuid: UuidStr
    decision: TriageDecision
    category_codes: list[Str200] | None = None
    likelihood: int | None = Field(default=None, ge=1, le=5)
    severity: int | None = Field(default=None, ge=1, le=5)
    is3786_code: Literal["B-2", "B-3", "B-4", ""] | None = None
    employer_involved_id: UuidStr | None = None
    trade: Str200 | None = None
    reason_code: Str200 = ""
    reason_text: Str2000 = ""
    question: Str2000 = ""
    master_observation_id: UuidStr | None = None
    actions: list[ActionDraft] | None = None
    interim_control: Str2000 = ""
    learned_at: datetime | None = None
    captured_at: datetime


class CommentBody(In):
    client_uuid: UuidStr
    body: Str2000
    captured_at: datetime | None = None


class ReplyBody(In):
    client_uuid: UuidStr
    body: Str2000
    media: list[MediaRef] = Field(default_factory=list)
    captured_at: datetime | None = None


class ReasonBody(In):
    reason: Str2000
    client_uuid: UuidStr | None = None
    captured_at: datetime | None = None


class ClosureSummaryBody(In):
    closure_summary: Str5000


# ---------- actions ----------
class ActionCreateRequest(ActionDraft):
    site_id: UuidStr
    area_id: UuidStr | None = None
    source_type: SourceType = "manual"
    source_id: UuidStr | None = None
    captured_at: datetime


class ActionCompleteRequest(In):
    client_uuid: UuidStr
    completion_note: Str2000 = ""
    cause_addressed: Str2000 = ""
    media: list[MediaRef] = Field(default_factory=list)
    captured_at: datetime


class ActionVerifyRequest(In):
    client_uuid: UuidStr
    result: Literal["effective", "not_effective"]
    method: VerificationMethod
    reason: Str2000 = ""
    media: list[MediaRef] = Field(default_factory=list)
    captured_at: datetime


class ActionRequestCreate(In):
    client_uuid: UuidStr
    type: Literal["date_change", "dispute"]
    proposed_due_at: datetime | None = None
    reason_code: Str200 = ""
    reason: Str2000
    captured_at: datetime


class ActionRequestDecide(In):
    decision: Literal["approved", "rejected", "reassigned"]
    note: Str2000 = ""
    new_owner_user_id: UuidStr | None = None
    new_due_at: datetime | None = None


class ActionCancelRequest(In):
    reason: Str2000
    approved_by_user_id: UuidStr


class ActionReassignRequest(In):
    new_owner_user_id: UuidStr
    reason: Str2000 = ""


class ActionCommentBody(In):
    client_uuid: UuidStr
    body: Str2000 = ""
    media: list[MediaRef] = Field(default_factory=list)
    captured_at: datetime | None = None


class SimpleTransition(In):
    client_uuid: UuidStr | None = None
    captured_at: datetime | None = None


# ---------- inspections ----------
class Answer(In):
    client_uuid: UuidStr
    question_id: UuidStr
    repeat_index: int = Field(default=0, ge=0, le=200)
    value: Any = None
    note: Str2000 = ""
    likelihood: int | None = Field(default=None, ge=1, le=5)
    severity: int | None = Field(default=None, ge=1, le=5)
    media: list[MediaRef] = Field(default_factory=list)
    action: ActionDraft | None = None
    answered_at: datetime
    lat: float | None = None
    lng: float | None = None


class RunStartRequest(In):
    client_uuid: UuidStr
    template_version_id: UuidStr
    site_id: UuidStr
    area_id: UuidStr | None = None
    asset_id: UuidStr | None = None
    schedule_id: UuidStr | None = None
    trigger: RunTrigger = "spot"
    header: dict[str, str] = Field(default_factory=dict)
    started_at: datetime
    lat: float | None = None
    lng: float | None = None


class AnswersBody(In):
    answers: list[Answer]


class RunSubmitRequest(In):
    client_uuid: UuidStr
    answers: list[Answer] = Field(default_factory=list)
    signature: MediaRef | None = None
    immediate_action: Str2000 = ""
    tag_status: Literal["safe_to_use", "do_not_use"] | None = None
    completed_at: datetime
    lat: float | None = None
    lng: float | None = None


# ---------- sync ----------
class SyncCommand(Loose):
    command_id: Annotated[str, StringConstraints(min_length=8, max_length=80)]
    seq: int = 0
    entity_type: Literal["observation", "action", "inspection_run"]
    op: Str200
    entity_client_uuid: UuidStr | None = None
    base_version: int | None = None
    captured_at: datetime | None = None
    depends_on: list[str] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)


class SyncPushRequest(In):
    device_id: Str200
    app_version: Str200 = ""
    commands: list[SyncCommand] = Field(default_factory=list, max_length=500)


# payloads per sync op (the record id travels with the payload)
class ObsRefPayload(In):
    observation_id: UuidStr
    client_uuid: UuidStr
    body: Str2000 = ""
    media: list[MediaRef] = Field(default_factory=list)
    captured_at: datetime | None = None


class ObsIdPayload(In):
    observation_id: UuidStr
    captured_at: datetime | None = None


class TriagePayload(TriageRequest):
    observation_id: UuidStr


class ActionIdPayload(In):
    action_id: UuidStr
    captured_at: datetime | None = None


class ActionCompletePayload(ActionCompleteRequest):
    action_id: UuidStr


class ActionVerifyPayload(ActionVerifyRequest):
    action_id: UuidStr


class ActionRequestPayload(ActionRequestCreate):
    action_id: UuidStr


class ActionCommentPayload(ActionCommentBody):
    action_id: UuidStr


class RunAnswersPayload(In):
    run_id: UuidStr
    answers: list[Answer]


class RunSubmitPayload(RunSubmitRequest):
    run_id: UuidStr


# ---------- public QR ----------
class QrObservationCreate(In):
    client_uuid: UuidStr
    type: ObservationType
    category_codes: list[Str200] = Field(default_factory=list)
    description: Str500 = ""
    description_lang: Lang = "en"
    fixed_on_spot: bool = False
    immediate_action: Str2000 = ""
    imminent_danger: bool = False
    anonymous: bool = True
    name: Str200 = ""
    phone: Annotated[str, StringConstraints(max_length=30)] = ""
    reporter_type: ReporterType = "contractor"
    employer_name: Str200 = ""
    lat: float | None = None
    lng: float | None = None
    accuracy_m: float | None = None
    captured_at: datetime
    media: list[MediaRef] = Field(default_factory=list)
    honeypot: Annotated[str, StringConstraints(max_length=500)] = ""


# ---------- admin ----------
class I18nText(Loose):
    en: Str500
    hi: Str500 | None = None
    ta: Str500 | None = None
    kn: Str500 | None = None

    def dump(self) -> dict:
        return {k: v for k, v in self.model_dump().items() if v}


class WorkingCalendar(In):
    weekly_off: list[int] = Field(default_factory=lambda: [0])
    shift_start: Annotated[str, StringConstraints(pattern=r"^\d{2}:\d{2}$")] = "08:00"
    shift_end: Annotated[str, StringConstraints(pattern=r"^\d{2}:\d{2}$")] = "17:00"


class SiteIn(In):
    code: Annotated[str, StringConstraints(pattern=r"^[A-Z0-9]{2,6}$")] | None = None
    name: I18nText | None = None
    address: Str500 = ""
    state: Str200 = "KA"
    district: Str200 = ""
    lat: float | None = None
    lng: float | None = None
    geofence_radius_m: int | None = None
    industry_code: Str200 | None = None
    establishment_type: EstablishmentType = "factory"
    appropriate_government: Literal["state", "centre"] = "state"
    rule_set_code: Str200 | None = None
    rule_set_effective_from: str | None = None
    risk_matrix_version_id: UuidStr | None = None
    hazardous_process: bool = False
    working_calendar: WorkingCalendar | None = None
    worker_count: int | None = None
    site_head_user_id: UuidStr | None = None
    active: bool = True
    reason: Str2000 = ""


class SiteSetupIn(In):
    industry_code: Str200
    areas: list[Str200] | None = None


class AreaIn(In):
    code: Str200 = ""
    name: I18nText
    parent_area_id: UuidStr | None = None
    area_type: AreaType = "other"
    hazardous_process: bool = False
    owner_user_id: UuidStr | None = None
    sort: int = 0
    active: bool = True
    reason: Str2000 = ""


class AssetIn(In):
    site_id: UuidStr | None = None
    area_id: UuidStr | None = None
    asset_class: AssetClass = "other"
    tag_no: Str200
    serial_no: Str200 = ""
    make_model: Str200 = ""
    swl_kg: float | None = None
    owner_employer_id: UuidStr | None = None
    status: Literal["in_service", "do_not_use", "retired"] = "in_service"
    status_reason: Str500 = ""
    next_exam_due: str | None = None
    reason: Str2000 = ""


class QrCodeIn(In):
    target_type: Literal["site", "area", "asset"]
    target_id: UuidStr
    label: Str200 = ""
    prefill: dict[str, Any] = Field(default_factory=dict)


class QrCodeUpdate(In):
    label: Str200 | None = None
    active: bool | None = None


class RoleGrant(In):
    site_id: UuidStr | None = None
    role: Role
    medical_data: bool = False
    expires_at: datetime | None = None


class UserCreate(In):
    name: Str200
    employee_code: Str200 = ""
    email: Str200 = ""
    login_type: Literal["employee_code", "email", "enrolment_code"] = "employee_code"
    language: Lang = "en"
    employer_id: UuidStr | None = None
    trade: Str200 = ""
    phone: Annotated[str, StringConstraints(max_length=30)] = ""
    roles: list[RoleGrant] = Field(default_factory=list)
    expires_at: datetime | None = None

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        if v and ("@" not in v or " " in v):
            raise ValueError("Enter a valid email address.")
        return v.lower()


class UserUpdate(In):
    name: Str200 | None = None
    email: Str200 | None = None
    employee_code: Str200 | None = None
    language: Lang | None = None
    employer_id: UuidStr | None = None
    trade: Str200 | None = None
    phone: Annotated[str, StringConstraints(max_length=30)] | None = None
    expires_at: datetime | None = None
    login_type: Literal["employee_code", "email", "enrolment_code"] | None = None


class RolesBody(In):
    roles: list[RoleGrant]


class StatusBody(In):
    status: Literal["active", "suspended", "deactivated"]
    reason: Str2000 = ""


class PersonIn(In):
    full_name: Str200
    employer_id: UuidStr | None = None
    phone: Annotated[str, StringConstraints(max_length=30)] = ""
    preferred_language: Lang = "en"
    trade: Str200 = ""
    worker_type: Literal["employee", "contract", "contractor", "temporary", "visitor"] = "employee"
    active: bool = True
    reason: Str2000 = ""


class ContractorIn(In):
    name: Str200
    is_own_company: bool = False
    parent_id: UuidStr | None = None
    registration_no: Str200 = ""
    contact_name: Str200 = ""
    phone: Annotated[str, StringConstraints(max_length=30)] = ""
    email: Str200 = ""
    trades: list[Str200] = Field(default_factory=list)
    site_ids: list[UuidStr] = Field(default_factory=list)
    active: bool = True
    reason: Str2000 = ""


class ExtraFieldIn(In):
    key: Str200
    label: I18nText
    type: Literal["text", "number", "choice", "boolean"] = "text"
    options: list[I18nText] | None = None
    required: bool = False


class CategoryIn(In):
    code: Annotated[str, StringConstraints(pattern=r"^[A-Z0-9_]{2,20}$")] | None = None
    parent_code: Str200 | None = None
    name: I18nText
    icon: Str200 = ""
    applies_to: dict[str, Any] = Field(default_factory=dict)
    critical_capable: bool = False
    incident_prompt: Str200 = ""
    is3786_default: Str200 = "B-2"
    extra_fields: list[ExtraFieldIn] = Field(default_factory=list)
    default_recipient_roles: list[Role] = Field(default_factory=lambda: ["site_safety_officer"])
    email_detail: Literal["private", "summary", "detailed"] = "summary"
    sort: int = 0
    active: bool = True
    reason: Str2000 = ""


class ReorderBody(In):
    ids: list[UuidStr]


class MatrixLabel(Loose):
    v: int
    label: I18nText
    anchor: I18nText | None = None


class MatrixBand(Loose):
    band: Band
    min: int
    max: int
    colour: Literal["green", "amber", "orange", "red"]
    response: I18nText


class MatrixVersionIn(In):
    likelihood_labels: list[MatrixLabel] | None = None
    severity_labels: list[MatrixLabel] | None = None
    bands: list[MatrixBand] | None = None
    effective_from: str | None = None


class VersionIdBody(In):
    version_id: UuidStr


class DueDateRuleIn(In):
    id: UuidStr | None = None
    site_id: UuidStr | None = None
    band: Band
    due_amount: int = Field(ge=1)
    due_unit: Literal["hours", "days", "working_days"]
    interim_control_required: bool = False
    verify_within_hours: int = Field(default=72, ge=1)
    status_label: Str200 = "design default"


class LadderStep(In):
    offset_minutes: int
    recipient: Literal["owner", "verifier", "site_safety_officer", "site_head", "hse_manager"]
    channel: Literal["push", "email", "both"] = "push"


class LadderIn(In):
    id: UuidStr | None = None
    band: Band
    steps: list[LadderStep]
    daily_cap: int = Field(default=5, ge=0)
    status_label: Str200 = "design default"


class RuleSetEnableBody(In):
    reviewed_by: Str200 = ""


class SiteRuleSetBody(In):
    code: Str200
    effective_from: str | None = None


class ResponseOptionIn(Loose):
    value: Str200
    label: I18nText
    colour: Literal["green", "red", "grey", "amber", "blue"] = "grey"
    flag: bool = False
    score: float | None = None


class QuestionIn(Loose):
    id: UuidStr | None = None
    code: Str200 = ""
    sort: int = 0
    text: I18nText
    guidance: I18nText | None = None
    answer_type: AnswerType = "pass_fail_na"
    response_set: list[ResponseOptionIn] = Field(default_factory=list)
    unit: Str200 = ""
    min: float | None = None
    max: float | None = None
    pass_min: float | None = None
    pass_max: float | None = None
    required: bool = True
    photo_on_fail: bool = True
    note_on_fail: bool = True
    action_on_fail: bool = True
    action_defaults: dict[str, Any] = Field(default_factory=dict)
    show_if: dict[str, Any] | None = None
    reference_text: Str2000 = ""
    reference_status: StatusLabel = "reference_to_confirm"


class SectionIn(Loose):
    id: UuidStr | None = None
    sort: int = 0
    title: I18nText
    repeatable: bool = False
    repeat_label: Str200 = ""
    questions: list[QuestionIn] = Field(default_factory=list)


class TemplateIn(In):
    code: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_\-]{1,40}$")]
    name: I18nText
    type: Str200 = "site_walk"
    applies_to: dict[str, Any] = Field(default_factory=dict)
    sections: list[SectionIn] = Field(default_factory=list)
    scoring: dict[str, Any] = Field(default_factory=lambda: {"anyFailRule": True, "passMarkPct": 80})
    title_fields: list[str] = Field(default_factory=lambda: ["site", "area", "asset", "date", "inspector", "document_no"])
    required_competence_type: Str200 = ""


class TemplateVersionIn(Loose):
    name: I18nText | None = None
    applies_to: dict[str, Any] | None = None
    sections: list[SectionIn] | None = None
    scoring: dict[str, Any] | None = None
    title_fields: list[str] | None = None
    required_competence_type: Str200 | None = None
    change_note: Str2000 | None = None


class TemplateCopyBody(In):
    code: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_\-]{1,40}$")]
    name: I18nText | None = None


class ScheduleIn(In):
    template_id: UuidStr
    site_id: UuidStr
    area_id: UuidStr | None = None
    asset_id: UuidStr | None = None
    frequency: dict[str, Any]
    assignee_user_id: UuidStr | None = None
    assignee_role: Role | None = None
    lead_days: int = Field(default=1, ge=0)
    grace_hours: int = Field(default=24, ge=0)
    active: bool = True


class TranslationsPut(In):
    overrides: dict[str, str]


class PrivacyNoticeIn(In):
    version: int | None = None
    body: dict[str, str]
    effective_from: str


class PrivacyRequestIn(In):
    person_name: Str200
    identifier: Str200
    type: Literal["access", "correction", "erasure", "nomination", "grievance"]
    details: Str5000 = ""


class PrivacyRequestUpdate(In):
    status: Literal["open", "in_progress", "answered", "rejected"] | None = None
    response: Str5000 | None = None


class RetentionPolicyIn(In):
    id: UuidStr | None = None
    record_type: Str200
    retention_years: int = Field(ge=1)
    basis_note: Str500 = ""
    end_action: Literal["erase", "anonymise"] = "anonymise"
    status_label: Str200 = "design default"


class LegalHoldIn(In):
    scope_type: Str200
    scope_id: UuidStr | None = None
    reason: Str2000


class OrgSettingsIn(Loose):
    name: Str200 | None = None
    legal_name: Str200 | None = None
    address: Str500 | None = None
    phone: Annotated[str, StringConstraints(max_length=30)] | None = None
    settings: dict[str, Any] | None = None
