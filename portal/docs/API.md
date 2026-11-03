# SafeWorks Portal 2.0 — API contract

JSON over HTTPS under `/api/v1`. Types are in `web/src/shared/types.ts` (the server's Pydantic models mirror them; names below refer to those types). Auth is `Authorization: Bearer <token>`. Every route checks role **and site scope** on the server; a record outside the caller's sites answers `404` (never `403`, so ids cannot be probed). Errors are `ApiError` with these codes: `bad_request` 400, `unauthorized` 401, `forbidden` 403, `must_change_password` 403, `mfa_required` 403, `not_found` 404, `conflict` 409, `too_large` 413, `rate_limited` 429, `server_error` 500. Error messages honour `Accept-Language` (en, hi, ta, kn) through the server's translation packs.

Role scope (brief §4): roles are per site (`user_site_roles`; `site_id null` = all sites, only `hse_manager`, `admin`, `auditor`). "Officer and above" = `site_safety_officer`, `site_head`, `hse_manager`. `admin` configures but never triages, assigns, verifies or sees medical data or anonymous identity. `auditor` is read-only, time-limited. Reporters see only their own reports; action owners their own reports and assigned actions.

## Auth and me

| Method, path | Who | Body → response | Notes |
|---|---|---|---|
| POST `/auth/login` | anyone | `LoginRequest` → `LoginResponse` | `login` is an employee code or an email. Lock after `MAX_FAILED_LOGINS` in 15 min. If the user's roles need MFA (`OrgSettings.mfaRequiredRoles`) the response has `mfaRequired: true` and a pre-auth token valid 10 min only for `/auth/mfa*` (and `mfaEnrolled`). Kind `admin` is for the console (admin, hse_manager, site_head, site_safety_officer, auditor); kind `field` for everyone. |
| POST `/auth/mfa/enrol` | pre-auth or signed in | → `MfaEnrolResponse` | TOTP secret (encrypted at rest) is pending until confirmed. |
| POST `/auth/mfa/confirm` | pre-auth or signed in | `{code}` → `LoginResponse` | Confirms enrolment and signs in. Audit `mfa_enrol`. |
| POST `/auth/mfa` | pre-auth | `{code}` → `LoginResponse` | 6-digit TOTP, ±1 step; 5 tries then lock 15 min. |
| POST `/auth/enrol` | anyone | `EnrolRequest` → `LoginResponse` | One-time enrolment code issued by an officer (24 h); sets the password; signs in as `field`. |
| POST `/auth/logout` | signed in | → `{ok:true}` | Revokes the session. |
| POST `/auth/password` | signed in (also when must_change) | `{current,new}` → `{ok:true}` | Rule: 12+ chars for staff, 8+ for workers, letters and numbers; revokes other sessions. |
| GET `/me` | signed in | → `Me` | `Me.preferences` = `{digest, quietHours}` as saved; `Me.pushPublicKey` = the VAPID application server key, `null` when the server has no VAPID keys. |
| PUT `/me/preferences` | signed in | `Preferences` → `Me` | |
| POST `/me/devices` | signed in | `PushSubscriptionBody` → `{ok:true}` | Web Push (VAPID) subscription (`PushSubscription.toJSON()`), keyed by `deviceUuid`; `subscription: null` unsubscribes. The field app's *Alerts on this phone* switch calls it. |
| POST `/me/privacy-ack` | signed in | `{version}` → `{ok:true}` | |

## Sync (the field app's main channel)

| Method, path | Who | Body → response |
|---|---|---|
| POST `/sync/push` | signed in | `SyncPushRequest` → `SyncPushResponse` |
| GET `/sync/pull?cursor=&deviceId=` | signed in | → `SyncPullResponse` (2.1 adds `departments`, `me.departmentId`, `directory[].departmentId`, and the open + last-30-days actions of my department) |

Push rules (brief §13): each command is applied inside one transaction; `commandId` is the idempotency key — a repeat returns the stored result with status `duplicate`, **except a command whose stored result is `rejected`: it can be re-sent with the same `commandId` (after the person fixed it, or after a dependency synced) and is applied afresh**. Commands are applied in request order after their `dependsOn`; a command whose dependency failed is `rejected` with code `dependency_failed`. Validation failures are `rejected` with a readable `error` (the phone shows "fix and resend"). A triage or a transition on a record someone else already changed is `conflict_saved_as_comment`: the content is stored as a `comments` row of kind `rejected_offline_decision` and the result says so. `observation create` with an existing `clientUuid` is `duplicate`. Server assigns `caseNo` (`<site code>-OBS-<year>-<00001>`, ACT, INS). Media referenced in a payload becomes `media` rows with `upload_status = pending`; the result carries `uploads` (one `PUT /media/{clientUuid}` URL each). The same ops exist as plain REST routes below for online clients (web, admin); both paths call the same workflow functions.

Pull: with no cursor (or one older than 30 days) `full: true` and the whole scope; otherwise only rows with `updated_at > cursor` plus tombstones. Scope: reference data for the caller's sites; observations = mine (via reporter id or the anonymous seal hash) plus, for officer and above, the site's open observations and the last 30 days; actions = owner/verifier mine plus site scope for officer and above; runs = mine plus scheduled runs for my role at my sites; templates = active versions in scope plus versions used by my open runs.

## Media

| Method, path | Who | Notes |
|---|---|---|
| PUT `/media/{clientUuid}` | signed in (owner of the record) or a public upload ticket | Raw bytes with `Content-Type` (image/jpeg, image/png, image/webp, audio/webm, audio/mp4, audio/ogg). Server sniffs the type, enforces 10 MB, computes SHA-256 and sets `hash_match`, never re-encodes. Returns `Media`. Repeating an upload is idempotent. |
| GET `/media/{id}` | viewer of the parent record | → `Media` (fresh signed `url`). |
| GET `/files/{key}?e=&s=` | signed link | Bytes (existing route; thumbnails are the same file — the client scales). |

## Observations

| Method, path | Who | Body → response |
|---|---|---|
| GET `/observations?siteId=&status=&band=&type=&category=&areaId=&employerId=&q=&from=&to=&mine=1&page=&pageSize=` | reporter (mine=1 only), officer+ | → `Paged<ObservationSummary>` critical first then oldest when `status=submitted` |
| GET `/observations/{id}` | reporter (own), owner/verifier of a linked action (no reporter identity), officer+ | → `ObservationDetail` |
| GET `/observations/{id}/duplicates` | officer+ | → `DuplicateSuggestion[]` (same site+area, category overlap, within `duplicateWindowHours`, not closed/discarded; same asset or GPS within `duplicateRadiusM` add weight; max 5) |
| POST `/observations` | signed in (not auditor-only accounts: 403) | `ObservationCreate` → `ObservationDetail` + `uploads` (online create; same as sync op). At least one category; `immediateAction` required when `fixedOnSpot`; a `capturedAt` more than 5 minutes ahead of the server is replaced by the received time (claimed time kept in the report's extra details); a category's required extra fields are required when `extra` is sent (signed-in reports); `imminentDanger` is ignored for `good_practice` |
| POST `/observations/{id}/triage` | officer+ of the site | `TriageRequest` → `ObservationDetail` |
| POST `/observations/{id}/comments` | reporter (own), officer+ | `{clientUuid, body}` → `Comment` |
| POST `/observations/{id}/reply` | reporter (own), status returned | `{clientUuid, body, media}` → `ObservationDetail` (status back to submitted) |
| POST `/observations/{id}/reopen` | officer+, hse_manager | `{reason}` → `ObservationDetail` (closed → action_assigned) |
| POST `/observations/{id}/ack-critical` | site_head, officer, hse_manager | → `ObservationDetail` |

Triage rules (brief §5.2, §6.1): `accept_assign` needs `categoryCodes` (≥1), `likelihood`, `severity`, `is3786Code`, `employerInvolvedId` (may be the own company) and ≥1 action; band from the site's active matrix version, version id stored on the observation and the decision; band `extreme` (or `imminentDanger`) requires `interimControl` and fires the stop-work alert to site head + HSE manager (push+email, `critical: true`, needs ack). `accept_fixed_on_spot` and `reviewed_no_action` close the observation (reason code+text required for reviewed_no_action and discard). `return_to_reporter` needs `question` and is refused for anonymous/QR reports. `merge_duplicate` needs an open master in the same site; the duplicate's reporter is notified when the master closes. `escalate_incident` records `learnedAt`, creates an `incidents` row with the same case number and status `escalated`. Decisions are append-only (`triage_decisions`). Un-triaged reports: reminder to the officer after `triageSlaWorkingDays`, to the site head after `triageEscalateWorkingDays` (job). When the last action of an observation is verified → observation `closed`, `closureSummary` = joined completion notes (officer may edit via `PUT /observations/{id}/closure-summary` before the notice goes; notice sent by job 30 min later). Category extra fields (`ObservationCreate.extra`, defined per category in `Category.extraFields`, plus `onBehalfOf` and a QR reporter's `employerName`) have no column of their own: they are stored as one system comment (`extra:{…}`, hidden from comment lists) and returned as `ObservationDetail.extra`. Reporter identity: `reporterName` is visible only to officer+ of that site; anonymous reports store the id only in `observation_reporter_seals` (AES-GCM + HMAC) and `mine` is computed from the hash.

## Actions

| Method, path | Who | Body → response |
|---|---|---|
| GET `/actions?siteId=&status=&band=&ownerId=&departmentId=&mine=1&verify=1&department=1&overdue=1&q=&page=` | owner (mine), verifier (`verify=1` = completed actions at my sites not mine), department members (`department=1` = actions assigned to my department at my sites; empty when I have none), officer+ | → `Paged<ActionSummary>` (each carries `departmentId`, the owner's department when it was assigned) |
| GET `/actions/{id}` | owner, verifier, officer+, members of the action's department (read-only: `can` stays false) | → `ActionDetail` |
| POST `/actions` | officer+ | `ActionCreateRequest` → `ActionDetail` |
| POST `/actions/{id}/start` | owner | → `ActionDetail` |
| POST `/actions/{id}/complete` | owner | `ActionCompleteRequest` → `ActionDetail` (+uploads). Rejected without `completionNote`, `causeAddressed` and ≥1 `purpose:"after"` photo. |
| POST `/actions/{id}/verify` | a user with `verifier` or officer+ role at the site who is neither owner nor completer | `ActionVerifyRequest` → `ActionDetail`. Owner/completer get **403**. `not_effective` → `reopened`, same owner, new `dueAt` from the band rule, `reopenCount+1`. |
| POST `/actions/{id}/requests` | owner | `ActionRequestCreate` → `ActionDetail`. A dispute sets status `disputed` and pauses the ladder `disputePauseDays`. The 3rd date-change request needs the site head. A date change's `proposedDueAt` must be in the future (400). |
| POST `/actions/{id}/requests/{rid}/decide` | officer (site head when the officer is the owner), site_head, hse_manager | `ActionRequestDecide` → `ActionDetail`. Approved date change moves `dueAt` (to `newDueAt`, else the proposed date), never `originalDueAt`. Rejected dispute → `open`, same owner. Reassigned → new owner, `open`. **An approved dispute requires `newOwnerUserId` (400 "Choose the new owner." without it) and acts as a reassignment**: the action goes to the new owner, status `open`. |
| POST `/actions/{id}/cancel` | officer+ with `approvedByUserId` = a site head/HSE manager of the site | `ActionCancelRequest` → `ActionDetail` |
| POST `/actions/{id}/reassign` | officer+ | `{newOwnerUserId, reason}` → `ActionDetail` |
| POST `/actions/{id}/comments` | owner, verifier, officer+ | `{clientUuid, body, media?}` → `ActionEvent` |

Due date (brief §8.2): from `due_date_rules` for the site (or company default) at creation — extreme 72 h, high 7 d, moderate 30 d, low 90 d; extreme/high need `interimControl`. Overdue is computed. Ladder (§8.4) run by the jobs: owner reminders at T-7, T-3, T-0 days (extreme: T-24 h, T-4 h, T-0), escalation T+1 d to officer and site head, T+3 d to HSE manager (extreme: T+2 h, T+24 h); at most `dailyPushCap` reminder pushes per person per day, the rest into the digest; critical alerts never capped; quiet hours for non-critical pushes.

## Inspections

| Method, path | Who | Body → response |
|---|---|---|
| GET `/inspections/templates?siteId=` | signed in | → `TemplateVersion[]` active versions that apply to the site (industry/area/asset) |
| GET `/inspections/runs?siteId=&status=&mine=1&page=` | inspector (mine), officer+ | → `Paged<RunSummary>` |
| GET `/inspections/runs/{id}` | inspector, officer+ | → `RunDetail` |
| POST `/inspections/runs` | signed in (any role at the site) | `RunStartRequest` → `RunDetail` (locks the template version; `scheduled` → `in_progress` when `scheduleId` given) |
| PUT `/inspections/runs/{id}/answers` | inspector | `{answers: Answer[]}` → `RunDetail` (upsert by question+repeatIndex; last write wins by `answeredAt`). A number answer must be numeric and a choice answer one of the question's options or NA (400 `err.answer_invalid`) |
| POST `/inspections/runs/{id}/submit` | inspector | `RunSubmitRequest` → `RunDetail`. Rejected while any required question is unanswered, or any flagged answer with `actionOnFail` has no `action`. Creates actions (source `inspection_answer`), computes `scorePct` (N/A excluded) and `result` (any-Fail rule), sets status `completed` — or `closed` straight away when the run raised no actions and has none open (a clean run is finished at submit; otherwise it closes when its last action is verified) — marks `repeatFinding` when the same question failed in the previous completed run at the same area/asset, stores the locked HTML report (`report_media_id`, kind html) and sets asset `do_not_use` when `tagStatus` says so. |
| GET `/inspections/runs/{id}/report` | inspector, officer+ | → `text/html` printable report (each photo beside its item; browser "Save as PDF") for API clients that send the bearer header |
| POST `/inspections/runs/{id}/report-link` | inspector, officer+ (scope checked now) | → `{url, expiresAt}`: a 5-minute signed link to the report for a new browser tab (see "Signed links"); audit `export` |
| POST `/inspections/runs/{id}/reopen` | admin, hse_manager | `{reason}` → `RunDetail` (report marked superseded) |
| POST `/inspections/runs/{id}/cancel` | officer+ | `{reason}` → `RunDetail` |

## Notifications, dashboard, exports

| Method, path | Who | Response |
|---|---|---|
| GET `/me/notifications?unread=1&page=` | signed in | `Paged<Notification>` |
| POST `/me/notifications/{id}/read`, `/ack` | signed in | `{ok:true}`; ack on a critical item also sets `observations.critical_acked_at` |
| POST `/me/notifications/read-all` | signed in | `{ok:true}` |
| GET `/dashboard?siteIds=a,b&from=&to=` | officer+, auditor, site viewers | `Dashboard` (drafts never counted; `n` on every KPI; percent-safe hidden under 30 behaviours) |
| GET `/exports/{observations|actions|inspections}.{csv|xlsx}?…same filters…` | officer+, admin, auditor — only for the sites where they hold that role (a verifier cannot export; with no site given, only those sites are exported) | `.csv`: UTF-8 with BOM (Excel opens Tamil correctly); text that starts with = + - @ tab or CR gets a leading apostrophe so a spreadsheet never runs it as a formula. `.xlsx`: a real Excel workbook (bold frozen header with filters, India-time dates). Audit `export` (`recordId` = format). Observations add *Reporter department* (only where the viewer sees reporter names); actions add *Overdue* and *Department* |
| GET `/exports/report.xlsx?siteIds=&from=&to=` | officer+, auditor | One workbook: *Summary* (site-level insights for the period, in the viewer's language), *Reports*, *Actions*, *Departments*. Period defaults to the last 90 days. One export towards the hourly limit |
| GET `/insights?level=me|department|site&siteIds=&from=&to=` | signed in (any role) | → `Insights` (2.1). `me`: my reports (named and my own anonymous ones, found through the seal; only I see them) and actions owned by me. `department`: named reports by members of my department and actions assigned to it; 404 when I have no department. `site`: everything at my sites (or the chosen ones in scope), plus `byDepartment`. Counts only, never names; anonymous and QR reports never count towards a department. Period defaults to 90 days; ≤ 120 days → weekly `trend`, else monthly |

## Public (no login)

| Method, path | Response |
|---|---|
| GET `/public/qr/{token}` | `QrInfo`; increments `scan_count` |
| POST `/public/qr/{token}/observations` | `QrObservationCreate` → `QrObservationResponse`. Rate limits: 30 per token per hour, 10 per IP per hour (salted hash, 24 h), 15 MB, honeypot field must be empty → else 429/400. Channel `qr`, no account; named reports store name/phone encrypted. |
| PUT `/public/upload/{ticket}` | bytes → `Media` (ticket = signed, 1 h, one media row) |
| GET `/public/status/{caseNo}?s=` | `PublicStatus` |
| GET `/health` | `{ok:true, version, time}` |
| GET `/links/qr-codes/{id}/poster?t=&lang=&size=` | signed link (no bearer token) → the poster HTML (see "Signed links") |
| GET `/links/inspection-runs/{id}/report?t=` | signed link (no bearer token) → the locked report HTML |

## Signed links (pages opened in a new tab)

A new browser tab cannot send the `Authorization` header, and a bearer token must never be put in a URL (history, logs, `Referer`). So the console and the field app ask for a link first and open that:

1. `POST /admin/qr-codes/{id}/poster-link` `{lang?: "en,hi,ta,kn", size?: "A4"|"A5"}` or `POST /inspections/runs/{id}/report-link` (bearer, normal role and site-scope checks; out of scope = 404) → `{url, expiresAt}`. Each issue writes an audit row (`export`, `changes.signedLink`).
2. The client opens `url` (`/api/v1/links/…?t=<ticket>`). The ticket is `security.sign_ticket` (HMAC-SHA256 with `FILE_SIGNING_SECRET`) over a purpose (`link:qr-poster` / `link:run-report`), the record id and the user id, and expires after **5 minutes**.
3. The GET route checks the signature, the purpose, the expiry and that the ticket's record is the one in the path — any failure is **403 `link_expired`** — then loads the user again and re-checks role and scope (a user suspended or moved off the site meanwhile gets 404).

The bearer routes `GET /admin/qr-codes/{id}/poster` and `GET /inspections/runs/{id}/report` stay for API clients. There is no `access_token` query parameter anywhere.

## Admin (`kind: admin` session; `admin` for people/config, `hse_manager` for safety configuration, officers for their site's areas/QR/schedules/template copies, `auditor` read-only)

| Resource | Routes |
|---|---|
| Sites | GET/POST `/admin/sites`, GET `/admin/sites/{id}` (→ `Site` + `areas` + `qrCodes`), PUT `/admin/sites/{id}` (admin), DELETE `/admin/sites/{id}` with JSON body `{reason}` (soft delete; reason required), POST `/admin/sites/{id}/setup` `{industryCode, areas?: string[]}` = the 3-step wizard: sets the industry, creates the areas (names that match the industry's default areas keep their code, translations and area type; other names become `A01…` of type `other`; no `areas` = the industry defaults), activates the industry's categories and templates, creates a site QR and one QR per area → `SiteSetupResult` `{site, areas, areasCreated, categoriesEnabled: string[], templatesEnabled: string[], posters: QrCode[]}` (posters = the site QR first, then one per area; idempotent) |
| Areas | GET/POST `/admin/sites/{id}/areas`, PUT/DELETE `/admin/areas/{id}` (DELETE body `{reason}`), POST `/admin/sites/{id}/areas/import` (CSV: code,name,type,parent[,name_hi,name_ta,name_kn]) → `ImportResult` |
| Assets | GET/POST `/admin/assets?siteId=`, PUT/DELETE `/admin/assets/{id}`, POST `/admin/assets/import` (CSV: site_code,tag_no,asset_class[,make_model,serial_no,swl_kg,area_code,next_exam_due]; with `{siteId, csv}` the site_code column may be left out and rows go to that site) → `ImportResult` |
| QR codes | GET `/admin/qr-codes?siteId=`, POST `/admin/qr-codes` `{targetType,targetId,label,prefill}`, POST `/admin/qr-codes/{id}/rotate` `{reason}` (old token answers 410; the reason goes in the audit row), PUT `/admin/qr-codes/{id}` (label/active), POST `/admin/qr-codes/{id}/poster-link` `{lang?, size?}` → `{url, expiresAt}` (see "Signed links"), GET `/admin/qr-codes/{id}/poster?lang=en,hi,ta,kn&size=A4` (bearer) → printable HTML poster ("See a hazard? Scan to report in 30 seconds" in the chosen languages, QR as inline SVG) |
| Users | GET `/admin/users?q=&siteId=&role=&status=&page=&pageSize=&sort=&dir=` → `Paged<UserAdmin>`, GET `/admin/users/{id}` → `UserAdmin`, POST `/admin/users` `UserCreate` (an `auditor` role needs `expiresAt`; phone, where given, 7–16 digits with an optional +, also for people, contractors and the QR form) → `UserAdmin` + `UserCreated` `{tempPassword, enrolmentCode, enrolmentExpiresAt}` (one is set: a temporary password for `employee_code`/`email` logins, or the first 24-hour enrolment code `ABCD-EFGH` for `enrolment_code` logins; shown once), PUT `/admin/users/{id}`, POST `/admin/users/{id}/roles` `{roles}`, POST `/admin/users/{id}/reset-password` → `{tempPassword}`, POST `/admin/users/{id}/enrolment-code` → `{code, expiresAt}`, POST `/admin/users/{id}/unlock`, POST `/admin/users/{id}/status` `{status}`, POST `/admin/users/{id}/mfa/reset`, POST `/admin/users/{id}/devices/{deviceId}/revoke`, POST `/admin/users/import` (CSV: name,employee_code,email,language,employer,trade,phone,role,site_code) → `ImportResult` + `tempPasswords` (employee code → one-time password for each new user) |
| Departments (2.1) | GET `/admin/departments` → `Department[]` (with `memberCount`); POST/PUT `/admin/departments/{id}` `{code, name: I18n, sort, active}` (admin; `code` 1–20 letters, digits, `-`, `_`, stored upper-case, unique per company); DELETE (body `{reason}`) soft-deletes and takes the department off its members — past actions and reports keep their snapshot. Users and people take `departmentId` (null = none; left out of a user PUT = unchanged); the user CSV import takes an optional `department` column (department code) |
| People, contractors | CRUD `/admin/people`, `/admin/contractors` (+ `siteIds`; DELETE body `{reason}`), POST `/admin/people/import` (CSV: name[,phone,employer,trade,worker_type,language]) → `ImportResult` |
| Categories | GET/POST `/admin/categories` (`?all=1` includes inactive), PUT/DELETE `/admin/categories/{id}`, POST `/admin/categories/reorder` `{ids: string[]}` (new order) → `Category[]` |
| Risk matrices | GET `/admin/risk-matrices` → `RiskMatrixVersion[]` (every version of every matrix, flat; each carries `matrixId`, `name`, `size`), POST `/admin/risk-matrices/{id}/versions` (new draft from current), PUT `/admin/risk-matrix-versions/{id}`, POST `/admin/risk-matrix-versions/{id}/activate` (approver ≠ author; retires the previous active; sites keep their version until changed), POST `/admin/sites/{id}/risk-matrix` `{versionId}` |
| Due-date rules, ladders | GET/PUT `/admin/due-date-rules` (array), GET/PUT `/admin/ladders` |
| Rule sets | GET `/admin/rule-sets`, POST `/admin/rule-sets/{code}/enable` `{reviewedBy}` (refused for `draft_rule`, or when a timer rule has no deadline), POST `/admin/rule-sets/{code}/disable`, POST `/admin/sites/{id}/rule-set` `{code, effectiveFrom}` (audit `config_change`) |
| Industries | GET `/admin/industries` → `IndustryProfile[]` (with `defaultAreas`: English names of the industry's default areas, step 2 of the wizard) |
| Inspection templates | GET `/admin/inspections/templates` → `TemplateVersion[]` (one per template: its newest version, so drafts in progress show), POST `/admin/inspections/templates` `{code,name,type,…}` → the new draft `TemplateVersion` (v1), GET `/admin/inspections/templates/{id}` → `TemplateVersion[]` (all versions, oldest first), POST `/admin/inspections/templates/{id}/versions` (new draft copied from the latest), PUT `/admin/inspections/template-versions/{id}` (full sections/questions document while draft), POST `/admin/inspections/template-versions/{id}/submit` (→ in_review), POST `.../approve` (approver ≠ author → active; previous active → retired; `active_version_id` updated), POST `.../retire`, POST `/admin/inspections/templates/{id}/copy` `{code,name}` → the copy's draft `TemplateVersion` (officers may copy; editing, submitting and approving are admin / HSE manager), DELETE template (soft). Create, versions, PUT, submit, approve and retire all answer `TemplateVersion`. |
| Schedules | GET/POST `/admin/inspections/schedules?siteId=`, PUT/DELETE `/admin/inspections/schedules/{id}` |
| Translations | GET `/admin/translations?lang=` → `TranslationPack` (the web packs `web/src/shared/i18n/*.<lang>.json` + overrides + missing keys), PUT `/admin/translations/{lang}` `{overrides}` (empty text removes an override), GET `/admin/translations/export?lang=` (JSON file `{lang, strings}`), POST `/admin/translations/import` `{lang, overrides}` (or `{lang, strings}`) → `{imported}` + `TranslationPack` |
| Audit | GET `/admin/audit-log?from=&to=&actor=&action=&recordType=&recordId=&siteId=&siteCode=&q=&page=&pageSize=&sort=at&dir=` → `Paged<AuditRow>` (`q` searches action, record type, record id and reason), POST `/admin/audit-log/verify` → `AuditVerify` (recomputes the hash chain) |
| Notifications log | GET `/admin/notifications-log?status=&channel=&eventType=&from=&to=&q=&page=&sort=at&dir=` (admin, HSE manager) → `Paged<NotificationLogRow>` |
| Privacy | GET `/admin/privacy/notices` → `PrivacyNotice[]`, POST `{version?, body: {en, hi?, ta?, kn?}, effectiveFrom}` (publishes the next version, retires the previous) → `PrivacyNotice[]`; GET `/admin/privacy/requests` → `PrivacyRequest[]`, POST `{personName, identifier, type, details}` (due 30 days after receipt) → `PrivacyRequest[]`, PUT `/admin/privacy/requests/{id}` `{status?, response?}` (`answered`/`rejected` close it) → `PrivacyRequest[]` |
| Retention | GET/PUT `/admin/retention-policies` (array of `RetentionPolicy`) → `RetentionPolicy[]`, GET `/admin/legal-holds` → `LegalHold[]`, POST `{scopeType, scopeId?, reason}` (`scopeId` null = every record of that type) → `LegalHold[]`, POST `/admin/legal-holds/{id}/release` → `LegalHold[]`, POST `/admin/retention/dry-run` → `RetentionDryRun` (counts only; no deletion in 2.0; the weekly job only reports) |
| Settings | GET `/admin/settings` → `OrgSettingsAdmin` = the flat `OrgSettings` + `orgName`, `legalName`, `address`, `phone`; PUT the same shape (unknown keys are dropped, `statusLabels` are read-only, the four organisation fields need the admin role) → `OrgSettingsAdmin` |
| Health | GET `/admin/health` → `Health` |
| Observations/actions/runs | the same read routes as above with all-sites scope for admin/HSE/auditor; admin console triage uses the same `/observations/{id}/triage` |

### Admin request conventions

- **CSV imports** (users, people, areas, assets) are sent as JSON `{csv: "<text>"}` (assets may add `siteId`); raw `text/csv` and multipart `file` uploads are accepted too. The first row is the header (case-insensitive). → `ImportResult {created, updated, skipped, errors: [{row, message}]}`.
- **Edit bodies** (sites, areas, assets, categories, contractors, people, users, schedules, due-date rules, ladders, retention policies, risk-matrix versions) may carry the read-only fields of the record as it was loaded (`id`, `version`, `createdAt`, `updatedAt`, and e.g. `Site.areas`/`qrCodes`, `Area.siteId`, `Asset.qrToken`, `PersonAdmin.phoneMasked`, `RiskMatrixVersion.matrixId/name/size/status/statusLabel`); they are ignored. Any other unknown key is still refused with 400.
- **Registers** take `?sort=<column>&dir=asc|desc` (unknown columns fall back to the default order; empty values sort last): observations `receivedAt|caseNo|status|capturedAt`, actions `dueAt|caseNo|status`, inspection runs `dueAt|caseNo|status`, users `lastLoginAt|name|status`, audit log and notifications log `at`.
- **Deletes with a reason** send it as a JSON body: `DELETE …` `{reason}`.

### Admin response shapes (console only; TypeScript in `web/src/admin/types.ts`)

| Type | Fields |
|---|---|
| `SiteSetupResult` | `site: Site, areas: Area[], areasCreated: number, categoriesEnabled: string[], templatesEnabled: string[], posters: QrCode[]` |
| `UserCreated` (merged into `UserAdmin`) | `tempPassword: string \| null, enrolmentCode: string \| null, enrolmentExpiresAt: string \| null` |
| `OrgSettingsAdmin` | `OrgSettings` + `orgName, legalName, address, phone` |
| `NotificationLogRow` | `id, at, eventType, recordType, recordId, recipientName, channel (inapp\|push\|email\|whatsapp\|sms), language, title, critical, status (queued\|sent\|delivered\|failed\|acknowledged), attempts, sentAt, error, costEstimateInr` |
| `PrivacyNotice` | `version, status (active\|retired), effectiveFrom, body: {en, hi?, ta?, kn?}, createdAt` |
| `PrivacyRequest` | `id, personName, identifier, type (access\|correction\|erasure\|nomination\|grievance), details, receivedAt, dueAt, status (open\|in_progress\|answered\|rejected), handledBy, handledByName, response, closedAt` |
| `RetentionPolicy` | `id, recordType, retentionYears, basisNote, endAction (erase\|anonymise), statusLabel` |
| `LegalHold` | `id, scopeType, scopeId, reason, placedBy, placedByName, placedAt, releasedAt, releasedBy` |
| `RetentionDryRun` | `checkedAt, byRecordType: {<type>: {candidates, endAction, retentionYears, legalHold}}, legalHolds, note` |

## Audit log and hash chain

Every create/update/transition/delete, login (success/fail), permission or configuration change, export and sensitive view writes one `audit_log` row inside the same transaction. `hash = sha256(prev_hash + "|" + canonical_json(at, org_id, actor_user_id, action, record_type, record_id, changes, reason))`; `prev_hash` is the previous row's hash in the same organisation (a per-org advisory lock serialises inserts). `POST /admin/audit-log/verify` walks the chain and reports the first bad id. Sensitive fields (phones, contacts) are masked inside `changes`.

## Jobs (asyncio tasks in the server process, `RUN_JOBS=true`; one process wins each job through `job_marks` + `select … for update skip locked`)

| Job | Every | Does |
|---|---|---|
| critical_ack_watcher | 1 min | critical alert not acknowledged in `criticalAckMinutes` → repeat push + email to site head and HSE manager, `escalations` row |
| ladder | 15 min | reminder ladder steps, triage SLA reminders, verification SLA reminders; respects quiet hours and the daily cap; marks `reminder_sent`/`escalated` events |
| inspection_scheduler | daily 00:30 IST and on schedule change | creates `scheduled` runs from `inspection_schedules`, marks `missed` after grace |
| closure_notices | 5 min | sends the reporter the closure notice 30 min after the last verification (status link for QR) |
| digests | daily 07:30, Monday 07:00/08:00 IST | officer daily digest; weekly digests for site heads, HSE managers and owners |
| push_sender | 30 s | sends queued `push` notifications through Web Push (VAPID keys in env); failures recorded |
| email_sender | 30 s | existing outbox sender |
| retention_report | Sunday 03:00 | dry-run counts into `job_marks`/log only |
