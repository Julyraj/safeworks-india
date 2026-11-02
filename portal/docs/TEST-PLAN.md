# SafeWorks Portal 2.1: complete QA test plan

Written as an EHS QA team (test architect, role-access specialist, functional/UI tester, edge-case tester, security and audit-trail inspector) for **SafeWorks Portal 2.1** (branch `main-d2jizp`). Every case is tied to the code as it is today, not to a generic EHS product. Features from the generic EHS template that SafeWorks does not have are listed as **gaps** (section 1.4) instead of being tested.

**Test logins (demo seed):** `ADMIN01`, `HSE01`, `SH-TN1`, `SO-TN1`, `VER-TN1`, `OWN-TN1-1`, `WORKER-TN1-1`, `WORKER-TN1-2`, `AUD01`. Passwords are never written here.

**Role short forms:** REP field employee · OWN supervisor / action owner · VER verifier · SSO safety officer · SH plant head · HSE EHS manager · ADM super admin · AUD external auditor · QR guest without login.

**Test types:** Positive · Negative · Security · Workflow · UI · Edge.

## Possible defects found while reading the code (confirm by running the marked tests)

| # | Where | What the code does | What it should do | Test |
|---|---|---|---|---|
| F1 | Report create (server) | Accepts a report dated in the future | Refuse, or use the received time | EHS-OBS-020 |
| F2 | Report create (server) | Accepts a report with no category (only the phone checks) | Refuse with 400 | EHS-OBS-016 |
| F3 | Report create (server) | "Fixed on the spot" without "what you did" is accepted (only the phone checks) | Refuse with 400 | EHS-OBS-030 |
| F4 | Exports (server) | Anyone who can view a site may export, which includes verifiers; API.md says "officer+ and auditor" | Match the written rule, or change the rule | EHS-DSH-033, EHS-RPT-012 |
| F5 | Console menu vs server | The menu shows "Notifications log" to auditors, but the server answers 404 for them | Hide the menu item, or allow auditors | EHS-ADM-262 |
| F6 | Console menu vs server | The server allows HSE managers to open Health, but the menu hides it from them | Pick one rule | EHS-ADM-290 |
| F7 | Dashboard (server) | "From" after "To" is not swapped or refused | Refuse, or swap the dates | EHS-DSH-009 |
| F8 | Danger-now acknowledgement | Which roles may acknowledge was not confirmed | Only officers and site heads of the site | EHS-OBS-210 |
| F9 | CSV exports | Text starting with `=`, `+`, `-` or `@` is written as-is, so Excel may run it as a formula ("CSV injection"). The `.xlsx` exports are safe. | Prefix such values with `'` in CSV | EHS-RPT-024 |

---

## Phase 1: Portal mapping and role matrix

### 1.1 Template roles mapped to SafeWorks roles

| Template role | SafeWorks role (code) | Scope | Admin console | Two-step login code (MFA) |
|---|---|---|---|---|
| Super Admin / Corporate Admin | `admin` (ADM) | All sites | Yes | Required |
| EHS Manager | `hse_manager` (HSE) | All sites | Yes | Required |
| Plant Head | `site_head` (SH) | Own site(s) | Yes | Required |
| Safety Officer | `site_safety_officer` (SSO) | Own site(s) | Yes | Not by default |
| Department Supervisor | `action_owner` (OWN) + department member (2.1) | Own site(s) | No (403) | No |
| Department Supervisor (checks fixes) | `verifier` (VER) | Own site(s) | No (403) | No |
| Field Employee | `reporter` (REP) | Own site(s) | No (403) | No |
| External Auditor | `auditor` (AUD) | All sites, read-only, account expires | Yes | Not by default |
| Contractor with a login | `reporter` whose employer is a contractor | Own site(s) | No | No |
| Guest / visitor (no login) | QR form `/q/<token>` (QR) | One area | No | — |

### 1.2 Portal map

**A. Field app (web app + Android APK)**
- **Server address** (Android only)
- **Sign in:** employee code or email, password, enrolment code, two-step code (set up / enter), forced password change, privacy notice acknowledgement
- **Home:** "Needs you now" cards, Report button
- **Quick report:** location chip and change-location sheet, 4 type tiles, category chips, photo strip (up to 3), voice note, description (500 characters), fixed on the spot + what you did, danger now, anonymous, employer/trade, extra category fields, Submit → saved screen → Report another / View / *Score risk and assign owner now* (officers, 2.1)
- **Reports:** tabs Mine / Triage (officers) / Site (officers); search; filter chips (status, type, risk band); site, area and category dropdowns; saved filters
- **Report detail:** photos, timeline, comments, reply to a returned report, triage sheet (7 decisions, risk matrix, categories, IS 3786, employer, action builder, interim control), acknowledge critical
- **Actions:** tabs Mine / To verify / Department (2.1) / Site; search; status and band chips
- **Action detail:** Start, Request new date, Dispute, Complete (after-photo + note + cause), Verify (before/after, effective / not effective, method, evidence photo), comments
- **Inspections:** list, start a run, answer the checklist (fail follow-up, photos, signature), submit, report link
- **Charts (2.1):** tabs Mine / Department / Site; 30 / 90 / 365-day chips; site dropdown; Excel button (officers)
- **Scan QR**, **Notifications**, **Outbox** (pending / failed items, retry, diagnostics)
- **Settings:** language, email digest, quiet hours, push, change password, library link, sign out
- **More menu**

**B. QR form without login (`/q/<token>`):** 4 languages, type, photo, description, optional name/phone, anonymous, case number + status link.

**C. Admin console (`/admin/`)**
- **Overview:** Dashboard (KPI tiles, weekly chart, by type / category / area / employer, ageing, days to close, by department (2.1), repeat findings, export view, full report Excel (2.1)); Attention board
- **Registers:** Observations, Actions, Inspections (each with search, filters, sorting, paging, saved filters, CSV + Excel export, detail drawer)
- **Configure:** Sites & areas (3-step set-up, areas import), Equipment, QR codes (poster link, rotate), People & contractors (People / Contractors / Departments (2.1) tabs), Users (create, roles, reset password, enrolment code, unlock, suspend / deactivate, MFA reset, revoke device, CSV import), Categories, Risk matrix, Due dates & reminder ladders, Rule sets, Templates (builder, approve), Schedules, Languages
- **Oversight:** Audit log (chain verify), Notifications log, Privacy, Retention (dry run, legal holds), Settings, Health

**D. Server-side jobs:** email and push senders, danger-now acknowledgement watcher, reminder/escalation ladder, inspection scheduler (missed runs), closure notices, daily/weekly digests, retention report.

### 1.3 Role-permission matrix

Key: **C** create, **R** read, **U** update/act, **D** delete/cancel, **A** approve/verify/decide, **X** export, **—** no access.

| Module / function | ADM | HSE | SH | SSO | VER | OWN | REP | AUD | QR |
|---|---|---|---|---|---|---|---|---|---|
| Field app sign-in | R | R | R | R | R | R | R | R | — |
| Admin console sign-in | R | R | R | R | — | — | — | R | — |
| Report: create | C | C | C | C | C | C | C | — | C |
| Report: read own | R | R | R | R | R | R | R | R | Status link |
| Report: read site list | R | R | R | R | R | — | — | R | — |
| Report: see named reporter | — | R | R | R | — | — | — | — | — |
| Report: triage / return / discard / merge / escalate | — | A | A | A | — | — | — | — | — |
| Report and assign (2.1) | — | A | A | A | — | — | — | — | — |
| Action: read own | R | R | R | R | R | R | R | R | — |
| Action: read department's, read-only (2.1) | dept | dept | dept | dept | dept | dept | dept | dept | — |
| Action: start / complete / request date / dispute | — | owner | owner | owner | owner | U | owner | — | — |
| Action: verify (not owner, not completer) | — | A | A | A | A | — | — | — | — |
| Action: decide requests / reassign / cancel / create manual | — | A | A | A | — | — | — | — | — |
| Inspection run: start / answer / submit | C | C | C | C | C | C | C | — | — |
| Inspection run: cancel | — | D | D | D | — | — | — | — | — |
| Templates: create / edit / retire | C U | C U | site copy | site copy | — | — | — | R | — |
| Templates: approve (approver ≠ author) | A | A | — | — | — | — | — | — | — |
| Schedules | C U D | C U D | site | site | — | — | — | R | — |
| Console dashboard | R | R | R (site) | R (site) | — | — | — | R | — |
| Charts: Mine / Department / Site (2.1) | R | R | R | R | R | R | R | R | — |
| Exports: CSV / Excel / full report | X | X | X | X | ⚠ F4 | — | — | X | — |
| Sites (create / edit / delete / set-up) | C U D | R | R | R | — | — | — | R | — |
| Areas, QR codes, equipment | C R U D | C R U D | site | site | — | — | — | R | — |
| People, contractors | C R U D | R | R | R | — | — | — | R | — |
| Departments (2.1) | C R U D | R | R | R | — | — | — | R | — |
| Users | C R U D | R | — | — | — | — | — | — | — |
| Enrolment code for a worker | C | C | C (site) | C (site) | — | — | — | — | — |
| Reset password / unlock / MFA reset | U | — | — | — | — | — | — | — | — |
| Categories, risk matrix, due dates, ladders, rule sets | C R U D | C R U D | — | — | — | — | — | R | — |
| Languages, privacy notices, retention, legal holds | U | — | — | — | — | — | — | — | — |
| Settings | U | U (safety fields) | — | — | — | — | — | — | — |
| Audit log | R | R | R (site) | R (site) | — | — | — | R | — |
| Notifications log | R | R | — | — | — | — | — | ⚠ F5 | — |
| Health | R | ⚠ F6 | — | — | — | — | — | — | — |

### 1.4 Template features not in SafeWorks 2.1 (gaps, not tested)

| Template feature | SafeWorks today |
|---|---|
| SSO (single sign-on) | Not built. Login is by password plus two-step code. |
| Self-service "Forgot password" | Not built, on purpose: the admin resets the password, or an officer issues an enrolment code. |
| Role switching | Not needed: a person's roles across sites are combined. |
| TRIR / LTIFR, heatmaps | Not built. They need the incident register and man-hours (Phase 2). |
| Incident / FIR / injury log / RCA (5 Whys, Fishbone) / witnesses / medical log | Phase 2. Only "Escalate to incident" exists; it records the time learned and the paper procedure. |
| Video evidence | Not built. Photos and voice notes only. |
| CAPA approval of the plan before work starts | Not built. The control is at the end: independent verification (effective / not effective). |
| Custom report builder, scheduled report emails | Not built. Fixed exports plus the daily/weekly digest email instead. |
| Real-time dashboard push | Not built. Figures refresh on reload or when a filter changes. |

---

## Batch 1: Sign-in, profile and dashboards

### 1A. Authentication and profile

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-AUTH-001 | Field Employee (REP) | Field app → Sign in | Login field, Password field, Sign in button | Open `/`. Enter `WORKER-TN1-1` and the correct password. Tap Sign in. | Positive | Home screen opens with the Report button; audit log has a `login` row with kind `field`. |
| EHS-AUTH-002 | Field Employee (REP) | Field app → Sign in | Login field (letter case) | Enter `worker-tn1-1` in lowercase with the correct password. Tap Sign in. | Positive | Signs in; the login is not case-sensitive. |
| EHS-AUTH-003 | Safety Officer (SSO) | Field app → Sign in | Login field (email) | Enter `so-tn1@safeworks.local` and the correct password. | Positive | Signs in with the email login. |
| EHS-AUTH-004 | Field Employee (REP) | Field app → Sign in | Password field | Enter `WORKER-TN1-1` with a wrong password. | Negative | Message "Login or password is incorrect."; failed attempts goes up by 1; audit row `login_failed` with reason `password`. |
| EHS-AUTH-005 | Unknown person | Field app → Sign in | Login field | Enter `NOBODY-999` and any password. | Security | Same message as AUTH-004 (no hint whether the account exists); response time similar to AUTH-004; audit `login_failed` with reason `unknown`. |
| EHS-AUTH-006 | Field Employee (REP) | Field app → Sign in | Login field (empty) | Leave Login empty and tap Sign in. | Negative | Field shows "required"; nothing is sent, or the server answers 400. |
| EHS-AUTH-007 | Field Employee (REP) | Field app → Sign in | Password field (length) | Paste a 201-character password and tap Sign in. | Negative | 400 validation error; no crash; no login attempt counted. |
| EHS-AUTH-008 | Field Employee (REP) | Field app → Sign in | Login field (length) | Paste a 201-character login and tap Sign in. | Negative | 400 validation error. |
| EHS-AUTH-009 | Field Employee (REP) | Field app → Sign in | Account lock | Enter a wrong password 10 times in a row, then the correct password. | Security | 11th attempt refused: "Too many failed attempts. Try again in N minutes." (N ≤ 15); audit `login_failed` with `locked: true`. |
| EHS-AUTH-010 | Field Employee (REP) | Field app → Sign in | Lock expiry | After AUTH-009, wait 15 minutes and sign in with the correct password. | Positive | Signs in; failed attempts back to 0. |
| EHS-AUTH-011 | Field Employee (REP) | Field app → Sign in | Failed-attempt counter reset | Enter a wrong password 9 times, then the correct one, then a wrong one once. | Positive | Correct login succeeds and resets the counter; the next wrong attempt counts as 1, with no lock. |
| EHS-AUTH-012 | Super Admin (ADM) | Console → Users → Unlock | Unlock button | Lock `OWN-TN1-1` as in AUTH-009. As ADM, open the user and click Unlock. Sign in as `OWN-TN1-1`. | Positive | Signs in at once; audit row for the unlock. |
| EHS-AUTH-013 | Any login | Field app → Sign in | Rate limit by IP + login | Send more than 30 login requests for one login from one IP within the limit window. | Security | 429 "too many requests" before the password is checked. |
| EHS-AUTH-014 | Field Employee (suspended) | Field app → Sign in | Account status | ADM suspends `WORKER-TN1-2`. Sign in with the correct password. | Negative | 403 "This account is not active. Contact your safety officer." |
| EHS-AUTH-015 | Field Employee (deactivated) | Field app → Sign in | Account status | ADM deactivates `WORKER-TN1-3`. Sign in with the correct password. | Negative | 403 "This account is not active." |
| EHS-AUTH-016 | Field Employee (suspended mid-session) | Field app → any page | Session after suspension | `WORKER-TN1-2` is signed in. ADM suspends the account. The worker opens Reports. | Security | Session refused (401) on the next server call (within the user cache time); app returns to sign-in. |
| EHS-AUTH-017 | External Auditor (AUD) | Console → Sign in | Account expiry date | ADM sets `AUD01` to expire yesterday. Sign in at `/admin/`. | Negative | 403 "This account has expired." |
| EHS-AUTH-018 | External Auditor (AUD) | Console → Sign in | Read-only console | Sign in as `AUD01` (not expired). | Positive | Console opens; no Create / Edit / Delete buttons anywhere; the Audit log menu is visible. |
| EHS-AUTH-019 | Field Employee (REP) | Console → Sign in | Console role check | Sign in at `/admin/` as `WORKER-TN1-1`. | Security | 403 "Admin console access only." |
| EHS-AUTH-020 | Supervisor (OWN) | Console → Sign in | Console role check | Sign in at `/admin/` as `OWN-TN1-1`. | Security | 403 "Admin console access only." |
| EHS-AUTH-021 | Verifier (VER) | Console → Sign in | Console role check | Sign in at `/admin/` as `VER-TN1`. | Security | 403 "Admin console access only." |
| EHS-AUTH-022 | Field Employee (REP) | API | Field token used on the console API | Sign in to the field app as `WORKER-TN1-1`. Call `GET /api/v1/admin/users` with that token. | Security | 401/403; no user data returned. |
| EHS-AUTH-023 | Safety Officer (SSO) | Console → Sign in | No two-step code needed | Sign in at `/admin/` as `SO-TN1`. | Positive | Dashboard opens without a code request (SSO isn't in the two-step roles by default). |
| EHS-AUTH-024 | Plant Head (SH) | Console → Sign in → Set up two-step code | QR code, Secret, Code field | First sign-in as `SH-TN1`. Scan the QR with an authenticator app. Enter the 6-digit code. | Positive | Set-up confirmed; dashboard opens; audit rows for the pre-login stage and the login. |
| EHS-AUTH-025 | Plant Head (SH) | Console → Two-step code | Code field (wrong) | Enter `000000` as the code. | Negative | Refused; stays on the code screen; no full session issued. |
| EHS-AUTH-026 | EHS Manager (HSE) | Console → Two-step code | Code field (second login) | `HSE01`, already set up, signs in again. | Positive | Asks only for the code (no QR); correct code opens the dashboard. |
| EHS-AUTH-027 | Super Admin (ADM) | API | Pre-login token | Sign in as `ADMIN01` but don't enter the code. Call `GET /api/v1/dashboard` with the pre-login token. | Security | 403 "Please enter your authenticator code to continue."; no data. |
| EHS-AUTH-028 | Super Admin (ADM) | Console → Two-step code | Pre-login time limit | Sign in as `ADMIN01`, wait 11 minutes, then enter a correct code. | Negative | Pre-login has expired (10-minute limit); asked to sign in again. |
| EHS-AUTH-029 | Plant Head (SH) | Field app → Sign in | Two-step code on the phone | Sign in to the field app as `SH-TN1`. | Positive | Code is required on the phone too (it's tied to the role, not the app). |
| EHS-AUTH-030 | Super Admin (ADM) | Console → Users → Reset two-step code | Reset button | ADM resets the code for `SH-TN1`. `SH-TN1` signs in. | Positive | `SH-TN1` is asked to set up a new code; audit row for the reset. |
| EHS-AUTH-031 | New Field Employee | Field app → Change password | Forced change | ADM creates user `E2001` and gets a temporary password. Sign in with it. | Positive | Change-password screen appears first; other screens and the API are blocked until the change is made. |
| EHS-AUTH-032 | New Field Employee | Field app → Change password | New password (7 characters) | Enter a 7-character password with letters and digits. | Negative | Refused: rule for workers (8+ characters, letters and numbers). |
| EHS-AUTH-033 | New Field Employee | Field app → Change password | New password (letters only) | Enter `abcdefghij`. | Negative | Refused: must contain a number. |
| EHS-AUTH-034 | New Field Employee | Field app → Change password | New password (digits only) | Enter `1234567890`. | Negative | Refused: must contain a letter. |
| EHS-AUTH-035 | Safety Officer (staff) | Settings → Change password | New password (11 characters) | `SO-TN1` enters an 11-character password with letters and digits. | Negative | Refused: staff rule is 12+ characters. |
| EHS-AUTH-036 | Safety Officer (staff) | Settings → Change password | New password (valid) | `SO-TN1` enters the correct current password and a valid 14-character password. | Positive | Saved; audit `password_reset` with `via: self`. |
| EHS-AUTH-037 | Any role | Settings → Change password | Current password field | Enter a wrong current password and a valid new one. | Negative | "Your current password is not correct."; nothing changes. |
| EHS-AUTH-038 | Any role | Settings → Change password | New password (129 characters) | Enter a 129-character new password. | Negative | Refused: too long. |
| EHS-AUTH-039 | Field Employee (REP) | Settings → Change password | Other devices signed out | Sign in on phone A and phone B. Change the password on phone A. Use phone B. | Security | Phone B gets 401 and returns to sign-in; phone A stays signed in. |
| EHS-AUTH-040 | Worker with enrolment-code login | Field app → Sign in → Enrolment code | Code field `ABCD-EFGH`, New password | ADM creates a user with login type "enrolment code" and gets the code. Worker enters the code and a valid new password. | Positive | Signed in; the code can't be used again. |
| EHS-AUTH-041 | Worker with enrolment-code login | Field app → Enrolment code | Expired code | Use a code issued more than 24 hours ago. | Negative | Refused as expired; no account change. |
| EHS-AUTH-042 | Worker with enrolment-code login | Field app → Enrolment code | Used code | Use the code from AUTH-040 a second time. | Security | Refused; no session issued. |
| EHS-AUTH-043 | Safety Officer (SSO) | Console → Users → Enrolment code | Issue code (own site) | `SO-TN1` issues a code for a TN1 worker. | Positive | Code `XXXX-XXXX` shown once with expiry time; audit row. |
| EHS-AUTH-044 | Safety Officer (SSO) | API | Issue code (other site) | `SO-TN1` calls `POST /admin/users/{id}/enrolment-code` for a TN2-only worker. | Security | 403/404; no code issued. |
| EHS-AUTH-045 | External Auditor (AUD) | Console → Users → Enrolment code | Read-only account | `AUD01` calls the enrolment-code endpoint for any user. | Security | 403 "Auditor accounts are read-only." |
| EHS-AUTH-046 | Super Admin (ADM) | Console → Users → Reset password | Reset password button (forgot-password route) | Worker reports a forgotten password. ADM clicks Reset password on the user. | Positive | Temporary password shown once; the user must change it at next sign-in; audit row. |
| EHS-AUTH-047 | EHS Manager (HSE) | API | Reset password (not admin) | `HSE01` calls `POST /admin/users/{id}/reset-password`. | Security | 403; only admin can reset passwords. |
| EHS-AUTH-048 | Field Employee (REP) | Field app → Sign-in screen | No "Forgot password" link | Look at the sign-in screen. | UI | No self-service reset link; help text says to ask the safety officer (by design: no paid OTP). |
| EHS-AUTH-049 | Any role | Field app → More → Sign out | Sign out button | Sign out with nothing waiting in the outbox. Reuse the old token in an API call. | Security | Session revoked; old token gets 401; audit `logout`. |
| EHS-AUTH-050 | Field Employee (REP) | Field app → More → Sign out | Sign out with unsent reports | Go offline, make a report, try to sign out. | Negative | Sign-out is held back with a warning about unsent items; the report is not lost. |
| EHS-AUTH-051 | Super Admin (ADM) | Console | Console session limit | Sign in to the console and leave it idle for 8 hours and 1 minute. Click any menu. | Security | 401; returns to sign-in (console sessions last 8 hours). |
| EHS-AUTH-052 | Field Employee (REP) | Field app | Phone session limit | Check `expiresAt` in the login response. | Positive | About 30 days (720 hours) after sign-in. |
| EHS-AUTH-053 | Any role | API | Token in the address bar | Call `GET /api/v1/me?access_token=<valid token>` with no Authorization header. | Security | 401; tokens are never accepted in a URL. |
| EHS-AUTH-054 | Super Admin (ADM) | Console → Users → Revoke device | Revoke device button | Revoke `WORKER-TN1-1`'s phone. The worker uses that phone. | Security | Phone gets 401 and must sign in again; audit row. |
| EHS-AUTH-055 | Any role | Console → Audit log | Sign-in events | After AUTH-001, 004, 009, 036 and 049, filter the audit log by user. | Positive | Rows `login`, `login_failed`, `password_reset`, `logout`, each with time and IP. |
| EHS-AUTH-056 | Field Employee (REP) | First sign-in → Privacy notice | Accept button | First sign-in as a new worker. | Positive | Privacy notice shown in the user's language; accepting records the version; it isn't shown again until a new version is published. |
| EHS-AUTH-057 | Field Employee (REP) | Settings → Language | Language dropdown | Change English to Tamil. | Positive | Screens switch to Tamil at once; after sign-out and sign-in Tamil is kept (saved on the server). |
| EHS-AUTH-058 | Field Employee (REP) | API → Preferences | Language value | `PUT /me/preferences` with `language: "fr"`. | Negative | 400 validation error; language unchanged. |
| EHS-AUTH-059 | Field Employee (REP) | Settings → Email digest | Digest dropdown | Set Daily, then Weekly, then Off; reload after each. | Positive | Each choice is saved and shown after reload. |
| EHS-AUTH-060 | Field Employee (REP) | Settings → Quiet hours | Toggle | Turn quiet hours on. Trigger a non-critical push at night (India time). | Positive | Push is held until morning; a critical (extreme / danger-now) alert is not held. |
| EHS-AUTH-061 | Field Employee (REP) | Notifications | Mark all read button | Open Notifications and tap Mark all read. | Positive | Unread count on the bell and the More menu goes to 0. |
| EHS-AUTH-062 | Safety Officer (SSO) | Notifications → critical alert | Acknowledge button | Acknowledge a stop-work alert. | Positive | Alert marked acknowledged with time; the report shows when it was acknowledged. |
| EHS-AUTH-063 | Person with roles at 2 sites | Field app → any list | No role switching | Give `SO-TN1` the officer role at TN2 too. Sign in. | Positive | Both sites appear together (combined roles); no switch is needed. |
| EHS-AUTH-064 | Any role | Android app → Server address | Server address field | Enter `htp:/bad`. | Negative | Error shown; app doesn't continue. |
| EHS-AUTH-065 | Any role | Android app → Server address | Server address field | Enter `https://safeworks-portal.onrender.com`. | Positive | Server checked; sign-in screen opens. |
| EHS-AUTH-066 | Guest (QR) | QR form `/q/<token>` | No sign-in | Open a valid area QR link in a private window. | Positive | Report form opens without sign-in; no access to any other page or API. |
| EHS-AUTH-067 | Guest (QR) | API | Calls without sign-in | Call `GET /api/v1/insights` and `GET /api/v1/observations` with no token. | Security | 401 for both. |

### 1B. Dashboards (console dashboard + field app Charts)

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-DSH-001 | Super Admin (ADM) | Console → Dashboard | Site dropdown "All sites" | Open the dashboard with All sites. | Positive | 11 KPI tiles, each with its `n` count; data from all 5 sites. |
| EHS-DSH-002 | EHS Manager (HSE) | Console → Dashboard | Site dropdown | Choose TN1, then KA1. | Positive | Every tile and chart changes to the chosen site. |
| EHS-DSH-003 | Plant Head (SH) | Console → Dashboard | Site dropdown | Open the site dropdown as `SH-TN1`. | Security | Only TN1 is listed; the figures cover TN1 only. |
| EHS-DSH-004 | Safety Officer (SSO) | API | Other plant's ID in the address | `SO-TN1` calls `GET /dashboard?siteIds=<TN2 id>`. | Security | 404 (outside scope); no TN2 figures. |
| EHS-DSH-005 | Safety Officer (SSO) | API | Mixed site IDs | `SO-TN1` calls `GET /dashboard?siteIds=<TN1>,<TN2>`. | Security | 404; nothing partial is returned. |
| EHS-DSH-006 | External Auditor (AUD) | Console → Dashboard | Read-only view | Open the dashboard as `AUD01`. | Positive | Every tile and chart visible; no edit controls. |
| EHS-DSH-007 | Super Admin (ADM) | Console → Dashboard | From / To dates | Set From 2026-08-01 and To 2026-08-31. | Positive | Period-based figures cover August only; "open actions now" stays a live count. |
| EHS-DSH-008 | Super Admin (ADM) | API | Bad date | `GET /dashboard?from=2026-13-40`. | Negative | 400 "Bad date"; no server error. |
| EHS-DSH-009 | Super Admin (ADM) | Console → Dashboard | From after To ⚠ F7 | Set From 2026-10-31 and To 2026-10-01. | Negative | No server error; either a validation message or the dates swapped. If it silently shows zeros, log defect F7. |
| EHS-DSH-010 | Super Admin (ADM) | Console → Dashboard | Future dates | Set From 2027-01-01 and To 2027-01-31. | Negative | All period figures 0 or "—"; no error. |
| EHS-DSH-011 | Super Admin (ADM) | Console → Dashboard | KPI "Open actions" | Count open, in-progress, reopened and disputed actions in the Actions register for the same site. | Positive | Tile equals the register count. |
| EHS-DSH-012 | Super Admin (ADM) | Console → Dashboard | KPI "Overdue actions" | Compare with Actions register → Overdue filter. | Positive | Equal; tile is red when above 0, green at 0. |
| EHS-DSH-013 | Super Admin (ADM) | Console → Dashboard | KPI "Triage backlog" | Compare with reports in status Submitted + Returned. | Positive | Equal. |
| EHS-DSH-014 | Super Admin (ADM) | Console → Dashboard | KPI "On-time closure %" | Hover the tile. | UI | Hint shows the formula "verified effective by original due date ÷ actions due in period × 100" and `n`. |
| EHS-DSH-015 | Super Admin (ADM) | Console → Dashboard | KPI "Percent safe" | Choose a site and period with fewer than 30 good-practice + at-risk reports. | Positive | Tile shows "—" (hidden below the minimum of 30), not a misleading %. |
| EHS-DSH-016 | Super Admin (ADM) | Console → Dashboard | KPI "Participation %" | Hover the tile. | UI | Formula "distinct reporters ÷ site worker count × 100"; anonymous reporters counted once through the seal. |
| EHS-DSH-017 | Super Admin (ADM) | Console → Dashboard | KPI "Critical acknowledgement median" | Raise one danger-now report, acknowledge it after 5 minutes, reload. | Workflow | Median includes the new case (minutes). |
| EHS-DSH-018 | Super Admin (ADM) | Console → Dashboard | KPI "Inspection completion %" | Mark one scheduled run as missed; reload. | Workflow | % drops (a missed run counts as not completed). |
| EHS-DSH-019 | Super Admin (ADM) | Console → Dashboard | Weekly chart bars | Hover a bar segment. | UI | Tooltip with the week and the good-practice or at-risk count. |
| EHS-DSH-020 | Super Admin (ADM) | Console → Dashboard | "By category" row link | Click a category name. | Positive | Observations register opens, filtered to that category (drill-down). |
| EHS-DSH-021 | Super Admin (ADM) | Console → Dashboard | By type / By area / By employer bars | Compare each bar with the register filtered the same way. | Positive | Counts match; discarded and merged reports are not counted. |
| EHS-DSH-022 | Super Admin (ADM) | Console → Dashboard | Ageing buckets | Compare 0–7 / 8–30 / 31–90 / 90+ days with open actions by creation date. | Positive | Bucket counts match. |
| EHS-DSH-023 | Super Admin (ADM) | Console → Dashboard | Days to close by band table | Verify one High action within the period; reload. | Workflow | High row `n` goes up by 1 and the median updates. |
| EHS-DSH-024 | Super Admin (ADM) | Console → Dashboard | Repeat findings table | Fail the same question at the same area in two runs in a row. | Workflow | The question appears with count ≥ 1. |
| EHS-DSH-025 | Super Admin (ADM) | Console → Dashboard | By department table (2.1) | Open the dashboard on demo data. | Positive | 5 departments with Reports / Assigned / Open / Overdue; the overdue cell is red when above 0. |
| EHS-DSH-026 | Super Admin (ADM) | Console → Dashboard | By department, empty state | Use a company with no departments. | UI | Empty message "No departments set up" with a link to add one. |
| EHS-DSH-027 | Super Admin (ADM) | Console → Dashboard | Departments → link | Click "Departments →". | UI | Opens People & contractors → Departments. |
| EHS-DSH-028 | Super Admin (ADM) | Console → Dashboard | Export view (CSV) button | Click Export view. | Positive | CSV of every tile and breakdown downloads, named with the site and dates. |
| EHS-DSH-029 | Super Admin (ADM) | Console → Dashboard | Full report (Excel) button (2.1) | Click Full report (Excel). | Positive | `.xlsx` downloads with sheets Summary, Reports, Actions, Departments; opens in Excel and LibreOffice; audit `export` row with format `xlsx`. |
| EHS-DSH-030 | Plant Head (SH) | Console → Dashboard | Full report (Excel) content | `SH-TN1` downloads the full report. | Security | Only TN1 rows; Summary lists site TN1 only. |
| EHS-DSH-031 | Safety Officer (SSO) | Console → Dashboard | Hourly export limit | Export 10 times within an hour, then once more. | Negative | 11th gives 429 "Export limit reached (10 per hour)." |
| EHS-DSH-032 | External Auditor (AUD) | Console → Dashboard | Full report (Excel) | `AUD01` downloads the full report. | Positive | Allowed; audit row records the auditor. |
| EHS-DSH-033 | Verifier (VER) | API | Export ⚠ F4 | `VER-TN1` calls `GET /exports/report.xlsx`. | Security | Per the written rule: 403. If it returns 200, log defect F4. |
| EHS-DSH-034 | Field Employee (REP) | API | Export | `WORKER-TN1-1` calls `GET /exports/report.xlsx`. | Security | 403. |
| EHS-DSH-035 | Super Admin (ADM) | Console → Dashboard | Figures after a change | Open the dashboard; in another tab verify an action; return and change the date filter. | Workflow | Figures refresh on reload or filter change (no live push in 2.1). |
| EHS-DSH-036 | Super Admin (ADM) | Console → Attention | Attention menu red badge | Create one overdue Extreme action. | Positive | Badge count goes up; the item is listed on the Attention board. |
| EHS-DSH-037 | Field Employee (REP) | Field app → More → Charts | Mine tab | Open Charts as `WORKER-TN1-1`. | Positive | Mine is selected; tiles show only this worker's reports and actions. |
| EHS-DSH-038 | Field Employee (REP) | Field app → Charts → Mine | Own anonymous reports | Make one anonymous report; reload Charts → Mine. | Positive | The total includes the anonymous report (only the reporter sees it in Mine). |
| EHS-DSH-039 | Field Employee (REP) | Field app → Charts | Department tab hidden | Open Charts as a worker with no department. | UI | Only Mine and Site tabs; no Department tab. |
| EHS-DSH-040 | Field Employee (REP) | API | Department level without a department | `GET /insights?level=department` as a worker with no department. | Negative | 404. |
| EHS-DSH-041 | Field Employee (REP) | Field app → Charts → Department | Department tab | `WORKER-TN1-1` (Civil works) opens Department. | Positive | Subtitle names "Civil works"; named reports by Civil members and actions assigned to Civil. |
| EHS-DSH-042 | Field Employee (REP) | Field app → Charts → Department | Anonymous not counted | A Civil member makes an anonymous report; reload Department. | Security | Department total unchanged (anonymous reports never count towards a department). |
| EHS-DSH-043 | Field Employee (REP) | Field app → Charts → Site | Site tab | Open Site. | Positive | Site totals and the By department table; no person names anywhere. |
| EHS-DSH-044 | Field Employee (REP) | Field app → Charts | Excel button hidden | Look at the page header. | UI | No Excel button for a worker. |
| EHS-DSH-045 | Supervisor (OWN) | Field app → Charts | Excel button hidden | Open Charts as `OWN-TN1-1`. | UI | No Excel button. |
| EHS-DSH-046 | Safety Officer (SSO) | Field app → Charts | Excel button | `SO-TN1` taps Excel. | Positive | Share sheet (phone) or download (browser) with `safeworks-report-<date>.xlsx`; message "Excel file downloaded." |
| EHS-DSH-047 | Safety Officer (SSO) | Field app → Charts | Excel while offline | Go offline; look at the Excel button. | Negative | Button disabled. |
| EHS-DSH-048 | Any role | Field app → Charts | Offline | Go offline and open Charts. | Negative | "Charts need a connection"; reporting still works offline. |
| EHS-DSH-049 | Any role | Field app → Charts | 30 / 90 / 365-day chips | Tap each chip. | Positive | Figures change; 30 and 90 days show the trend per week, 365 days per month. |
| EHS-DSH-050 | Any role | Field app → Charts | Chosen period kept | Choose 365 days, leave the page, come back. | UI | 365 days still selected (remembered on this phone). |
| EHS-DSH-051 | HSE / multi-site role | Field app → Charts | Site dropdown | `HSE01` chooses KA1. | Positive | All figures for KA1 only. |
| EHS-DSH-052 | Safety Officer (SSO) | API | Other plant's insights | `SO-TN1` calls `GET /insights?level=site&siteId=<TN2 id>`. | Security | 404. |
| EHS-DSH-053 | Any role | Field app → Charts | Trend chart bars | Hover or long-press a column. | UI | Period, total, good practice and at-risk counts; green = good practice, orange = at-risk; legend shown. |
| EHS-DSH-054 | Any role | Field app → Charts | By risk card | Compare with triaged reports. | Positive | Only triaged reports counted (subtitle "after triage"). |
| EHS-DSH-055 | Any role | Field app → Charts | Empty period | Choose a period with no activity. | UI | "Nothing in this period" with a hint; no broken chart. |
| EHS-DSH-056 | Any role | Field app → Charts | Phone layout at 390 px | Open on a 390 × 844 screen. | UI | Two tiles per row; no sideways page scroll; the department table scrolls inside its own box. |
| EHS-DSH-057 | Any role | Field app → Charts | Language | Switch to Tamil, Hindi, then Kannada. | UI | Every heading, tile label and chip translated; numbers in the local format. |
| EHS-DSH-058 | Super Admin (ADM) | API | Level value | `GET /insights?level=everything`. | Negative | Treated as `me`; no error and no extra data. |
| EHS-DSH-059 | Guest (QR) | API | Charts without sign-in | `GET /insights` with no token. | Security | 401. |

---

## Batch 2: Safety observations

### 2A. Quick report: create (field app → Report)

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-OBS-001 | Field Employee (REP) | Field app → Report | Report button (home, + button) | Tap the yellow + button. | UI | Quick report opens on one screen: location chip, 4 type tiles, categories, camera strip, description, toggles, Submit. |
| EHS-OBS-002 | Field Employee (REP) | Report | Location chip (GPS) | Allow location at the TN1 site and open Report. | Positive | Chip shows "TN1 · nearest area", filled in from GPS. |
| EHS-OBS-003 | Field Employee (REP) | Report | Location chip (no GPS) | Deny location and open Report. | Positive | Chip shows the last place used, or asks for site and area; nothing is blank without a prompt. |
| EHS-OBS-004 | Field Employee (REP) | Report → Change location | Site dropdown | Tap the chip, pick a site in your scope, tap Done. | Positive | Chip updates; the area list now shows only that site's areas. |
| EHS-OBS-005 | Field Employee (REP) | Report → Change location | Area dropdown | Pick an area. | Positive | Chip shows the area name in the user's language. |
| EHS-OBS-006 | Field Employee (REP) | Report → Change location | Equipment dropdown | Pick a piece of equipment in the area. | Positive | Equipment saved with the report and shown on its detail page. |
| EHS-OBS-007 | Field Employee (REP) | Report | Type tile "Good practice" | Tap Good practice. | Positive | Tile selected; categories suited to good practice are suggested. |
| EHS-OBS-008 | Field Employee (REP) | Report | Type tile "Unsafe act" | Tap Unsafe act. | Positive | Tile selected; suggested categories change. |
| EHS-OBS-009 | Field Employee (REP) | Report | Type tile "Unsafe condition" | Tap Unsafe condition. | Positive | Tile selected. |
| EHS-OBS-010 | Field Employee (REP) | Report | Type tile "Near miss" | Tap Near miss. | Positive | Tile selected. |
| EHS-OBS-011 | Field Employee (REP) | Report | No type chosen | Fill everything except type and tap Submit. | Negative | "Choose the type" shown at the type tiles; nothing saved. |
| EHS-OBS-012 | Field Employee (REP) | Report | Category chips (suggested) | Look at the category chips after choosing a type. | UI | Up to 6 suggested, from recent reports at this site and area; "more" shows the rest. |
| EHS-OBS-013 | Field Employee (REP) | Report | Category chips (several) | Select 3 categories. | Positive | All 3 saved on the report. |
| EHS-OBS-014 | Field Employee (REP) | Report | Category chips (none) | Choose a type, no category, tap Submit. | Negative | "Choose at least one category"; nothing saved. |
| EHS-OBS-015 | Field Employee (REP) | API | Unknown category code | Send a create with `categoryCodes: ["NOT_A_CODE"]`. | Negative | 400 "Choose at least one category."; nothing saved. |
| EHS-OBS-016 | Field Employee (REP) | API | Empty category list ⚠ F2 | Send a create with `categoryCodes: []`, a description and an area. | Negative | Correct behaviour: 400. If it returns 201, log defect F2. |
| EHS-OBS-017 | Field Employee (REP) | Report | Description (500 characters) | Type exactly 500 characters and submit. | Positive | Saved; full text shown on the detail page. |
| EHS-OBS-018 | Field Employee (REP) | Report | Description (501 characters) | Paste 501 characters. | Negative | Field stops at 500, or "Too long" on submit; the API refuses 501 with 400. |
| EHS-OBS-019 | Field Employee (REP) | Report | No description and no photo | Choose type and category; no text, no photo; tap Submit. | Negative | "Add a photo or describe it"; API gives 400 "Describe what you observed." |
| EHS-OBS-020 | Field Employee (REP) | API | Report dated in the future ⚠ F1 | Send a create with `capturedAt` = tomorrow. | Negative | Correct behaviour: refused (400) or clamped to the received time. If stored as tomorrow, log defect F1. |
| EHS-OBS-021 | Field Employee (REP) | API | Very old date | Send a create with `capturedAt` = 2020-01-01. | Edge | Stored with captured time 2020-01-01 and received time = now; list sorted by received time; no crash. |
| EHS-OBS-022 | Field Employee (REP) | API | Bad date | `capturedAt: "yesterday"`. | Negative | 400 validation error. |
| EHS-OBS-023 | Field Employee (REP) | Report | Description with Tamil text | Type a Tamil sentence, submit. | Positive | Saved and shown exactly; language recorded as `ta` when the phone is in Tamil. |
| EHS-OBS-024 | Field Employee (REP) | Report | Description with emoji and `<script>` | Type `⚠️ <script>alert(1)</script>`. | Security | Saved as plain text; shown escaped on the phone and in the console; no script runs. |
| EHS-OBS-025 | Field Employee (REP) | Report | Voice-to-text (mic in description) | Tap the mic and speak. | Positive | Spoken words appear in the description where the phone supports it; the button is hidden where it doesn't. |
| EHS-OBS-026 | Field Employee (REP) | Report | "Danger now" toggle | Turn on Danger now and submit. | Positive | Saved with danger now; a critical alert goes at once to the site's officers and site head (push, in-app, email). |
| EHS-OBS-027 | Field Employee (REP) | Report | "Danger now" with good practice | Choose Good practice and look for Danger now. | UI | Not offered for good practice, or disabled. |
| EHS-OBS-028 | Field Employee (REP) | Report | "Fixed on the spot" toggle | Turn it on, fill "What you did", submit. | Positive | Saved; the triage sheet later defaults to "Fixed on the spot". |
| EHS-OBS-029 | Field Employee (REP) | Report | "Fixed on the spot" without what you did | Turn it on, leave "What you did" empty, submit. | Negative | "Say what you did" at the field; nothing saved. |
| EHS-OBS-030 | Field Employee (REP) | API | "Fixed on the spot" without what you did ⚠ F3 | API create with `fixedOnSpot: true`, `immediateAction: ""`. | Negative | Correct behaviour: 400. If it returns 201, log defect F3. |
| EHS-OBS-031 | Field Employee (REP) | Report | What you did (2,000 characters) | Enter 2,000 characters. | Positive | Saved. |
| EHS-OBS-032 | Field Employee (REP) | API | What you did (2,001 characters) | API create with 2,001 characters. | Negative | 400. |
| EHS-OBS-033 | Field Employee (REP) | Report | "Anonymous" toggle | Turn on Anonymous and submit. | Positive | Saved; detail shows "Anonymous"; the reporter's ID isn't stored on the report (only an encrypted seal). |
| EHS-OBS-034 | Contractor worker (REP) | Report | Employer (automatic) | A worker whose employer is a contractor submits. | Positive | Employer filled with their contractor; reporter type "contractor". |
| EHS-OBS-035 | Field Employee (REP) | Report | Employer involved dropdown | Pick another contractor as the employer involved. | Positive | That contractor saved as employer involved. |
| EHS-OBS-036 | Field Employee (REP) | Report | Trade dropdown | Pick "Scaffolding". | Positive | Trade saved. |
| EHS-OBS-037 | Field Employee (REP) | Report | Category extra field (required) | Pick a category set up with a required extra field; leave it empty; submit. | Negative | "Required" at that field; nothing saved. |
| EHS-OBS-038 | Field Employee (REP) | Report | Category extra field (filled) | Fill the extra field and submit. | Positive | Value saved and shown on the detail page. |
| EHS-OBS-039 | Field Employee (REP) | Report | Submit button | Fill a valid report and tap Submit. | Positive | Saved on the phone within 2 seconds; screen "Saved" with a pending number, then the case number `TN1-OBS-2026-NNNNN` once synced. |
| EHS-OBS-040 | Field Employee (REP) | Report → Saved | Report another | Tap Report another. | Positive | New empty form with the same site and area. |
| EHS-OBS-041 | Field Employee (REP) | Report → Saved | View | Tap View. | Positive | Detail page of the new report. |
| EHS-OBS-042 | Field Employee (REP) | Report | Draft autosave | Fill half the form, close the app, reopen Report. | Positive | "We kept your unfinished report"; fields restored. |
| EHS-OBS-043 | Field Employee (REP) | Report | Discard draft | Tap Discard, then Undo within the toast time. | Positive | Draft cleared; Undo brings it back. |
| EHS-OBS-044 | Field Employee (REP) | Report | Leave page with unsaved draft | Fill fields and press back in the browser. | UI | Browser asks before leaving. |
| EHS-OBS-045 | Field Employee (REP) | API | Site outside scope | API create with `siteId` = TN2 as a TN1-only worker. | Security | 404; nothing saved. |
| EHS-OBS-046 | Field Employee (REP) | API | Area from another site | API create with `siteId` = TN1 and `areaId` = a TN2 area. | Negative | 400 "Choose the area (no GPS fix)."; nothing saved. |
| EHS-OBS-047 | Field Employee (REP) | API | Equipment from another site | API create with a TN2 equipment ID. | Security | 404. |
| EHS-OBS-048 | Field Employee (REP) | API | No area and no GPS | API create with `areaId: null`, `lat: null`. | Negative | 400 "Choose the area (no GPS fix)." |
| EHS-OBS-049 | Field Employee (REP) | API | GPS without area | API create with `areaId: null` and valid coordinates. | Positive | Saved with coordinates; officers set the area later. |
| EHS-OBS-050 | Field Employee (REP) | API | Same report sent twice | Send the same create (same `clientUuid`) twice. | Positive | One report only; the second answer is "duplicate" with the same case number. |
| EHS-OBS-051 | Field Employee (REP) | API | Unknown field | API create with an extra key `"severityLevel": 5`. | Negative | 400 (unknown keys refused). |
| EHS-OBS-052 | Supervisor (OWN) | Report | Create | `OWN-TN1-1` submits a report. | Positive | Saved; appears under Reports → Mine. |
| EHS-OBS-053 | Verifier (VER) | Report | Create | `VER-TN1` submits a report. | Positive | Saved. |
| EHS-OBS-054 | Safety Officer (SSO) | Report | Create | `SO-TN1` submits a report. | Positive | Saved; the "Score risk and assign owner now" button appears (see 2H). |
| EHS-OBS-055 | External Auditor (AUD) | API | Create | `AUD01` calls the create API. | Security | 403 (auditor is read-only). |
| EHS-OBS-056 | Field Employee (REP) | Report | Case number format | Make reports at TN1 and KA1. | Positive | Numbers are `TN1-OBS-2026-…` and `KA1-OBS-2026-…`, each counting up per site. |
| EHS-OBS-057 | Safety Officer (SSO) | Report | Report on behalf of a worker without a phone | Officer uses "on behalf of" with name and employer. | Positive | Channel "on behalf"; the person's name kept in the report details. |

### 2B. Photo and voice evidence

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-OBS-060 | Field Employee (REP) | Report | Camera strip (1 photo) | Take 1 photo and submit. | Positive | Thumbnail on the report; after upload the photo is marked verified (hash matches). |
| EHS-OBS-061 | Field Employee (REP) | Report | Camera strip (3 photos) | Add 3 photos. | Positive | All 3 saved. |
| EHS-OBS-062 | Field Employee (REP) | Report | Camera strip (4th photo) | Try to add a 4th photo in the quick report. | Negative | Add button hidden or refused at 3. |
| EHS-OBS-063 | Field Employee (REP) | API | Photo count above the server limit | API create with 11 photo references. | Negative | 400 "At most 10 photos per record." |
| EHS-OBS-064 | Field Employee (REP) | Report | Photo from gallery | Pick a JPEG from the gallery. | Positive | Accepted; resized to 1,600 px; location data in the photo (EXIF) removed before saving. |
| EHS-OBS-065 | Field Employee (REP) | Report | PNG and WebP photos | Pick one PNG and one WebP. | Positive | Both accepted. |
| EHS-OBS-066 | Field Employee (REP) | API | PDF sent as a photo | Upload a PDF to the photo's upload address. | Negative | 400 "Only JPEG, PNG or WebP photos and WebM, MP4 or OGG voice notes are accepted." |
| EHS-OBS-067 | Field Employee (REP) | API | Renamed file | Upload a `.exe` renamed to `.jpg`. | Security | 400; the type is read from the file's bytes, not its name. |
| EHS-OBS-068 | Field Employee (REP) | API | File over 10 MB | Upload an 11 MB JPEG. | Negative | 413 / 400 "The upload is too large (limit 10 MB)." |
| EHS-OBS-069 | Field Employee (REP) | API | Empty upload | Upload 0 bytes. | Negative | 400 "Empty upload." |
| EHS-OBS-070 | Field Employee (REP) | API | Photo changed after capture | Upload a different image from the one whose hash was recorded. | Security | Stored but marked "hash does not match"; the console shows that warning. |
| EHS-OBS-071 | Field Employee (REP) | API | Upload to someone else's photo slot | Use another user's report photo ID. | Security | 400 "This file belongs to another record." or 404. |
| EHS-OBS-072 | Field Employee (REP) | API | Same upload twice | Repeat a finished upload. | Positive | Accepted without a second copy. |
| EHS-OBS-073 | Field Employee (REP) | Report | Blur boxes | Draw a blur box over a face before submitting. | Positive | Saved photo has the area blurred. |
| EHS-OBS-074 | Field Employee (REP) | Report | Voice note (30 seconds) | Record a 30-second voice note and submit. | Positive | Voice note saved and playable on the detail page. |
| EHS-OBS-075 | Field Employee (REP) | API | Voice note over 60 seconds | Send a voice note recorded as 75 seconds. | Negative | 400 "Voice notes may be up to 60 seconds." |
| EHS-OBS-076 | Field Employee (REP) | Report | Video | Look for a video option. | UI | None (video isn't supported in 2.1; see gaps 1.4). |
| EHS-OBS-077 | Any role | Report detail | Photo link | Copy a photo address and open it 2 hours later in another browser. | Security | Refused once the signed link expires (1 hour); no photo served without a valid signature. |
| EHS-OBS-078 | Field Employee (REP) | Report detail | Lightbox | Tap a photo. | UI | Full-screen view; close returns to the detail page. |

### 2C. Working offline and syncing

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-OBS-080 | Field Employee (REP) | Report (offline) | Submit | Turn on airplane mode, submit a report with 1 photo. | Positive | "Kept on this phone"; pending number; item listed in the Outbox. |
| EHS-OBS-081 | Field Employee (REP) | Outbox | Automatic sync | Turn the network back on. | Positive | Text sent first, then the photo; case number appears; Outbox item shows "Synced". |
| EHS-OBS-082 | Field Employee (REP) | Outbox | Network lost during the photo upload | Cut the network while the photo uploads. | Edge | Report already on the server; photo retried later; no duplicate report. |
| EHS-OBS-083 | Field Employee (REP) | Outbox | 5 reports offline | Make 5 reports offline, then reconnect. | Positive | All 5 synced in order; 5 different case numbers. |
| EHS-OBS-084 | Field Employee (REP) | Outbox | App closed while offline | Report offline, close the app completely, reconnect, open the app. | Positive | Sync resumes; nothing lost. |
| EHS-OBS-085 | Field Employee (REP) | Outbox | Server refuses a report | Make a report offline at an area that the admin deletes before you reconnect. | Negative | Outbox item "Failed" with the reason; Fix opens the report to correct the area; resend works. |
| EHS-OBS-086 | Field Employee (REP) | Outbox | Retry button | Tap Retry on a failed item after fixing it. | Positive | Sent; status "Synced". |
| EHS-OBS-087 | Field Employee (REP) | Outbox | Diagnostics | Tap Share diagnostics. | Positive | Share sheet or copy with sync details (no passwords or tokens). |
| EHS-OBS-088 | Field Employee (REP) | Reports (offline) | Lists | Open Reports while offline. | Positive | Your reports shown from the phone's copy; a banner says offline. |
| EHS-OBS-089 | Field Employee (REP) | Sync | Clock wrong on the phone | Set the phone clock 2 days ahead, report, sync. | Edge | Received time = server time; captured time as sent (see F1). |
| EHS-OBS-090 | Safety Officer (SSO) | Sync | Triage queued behind an unsent report | Officer reports offline, then triages it offline (2H). Reconnect. | Workflow | Report sent first, then the triage decision; both applied; action created. |
| EHS-OBS-091 | Two officers (SSO, SO2) | Sync | Two offline triage decisions on one report | Both triage the same report offline differently, then reconnect one after the other. | Edge | First applied; second kept as a comment "rejected offline decision"; the second officer is told. |

### 2D. Anonymity and seeing who reported

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-OBS-095 | Field Employee (REP) | Reports → Mine | Own anonymous report | Make an anonymous report; open Mine. | Positive | Listed under Mine (found through the seal) with "Anonymous". |
| EHS-OBS-096 | Safety Officer (SSO) | Report detail | Anonymous reporter | Open the anonymous report. | Security | Reporter shows "Anonymous"; no name, code or phone anywhere in the page or API answer. |
| EHS-OBS-097 | EHS Manager (HSE) | Console → Observations | Anonymous reporter | Open the same report in the console. | Security | "Anonymous"; nothing identifying. |
| EHS-OBS-098 | Super Admin (ADM) | Console → Observations → Export | Reporter column for an anonymous report | Export observations as CSV and Excel. | Security | Reporter and Reporter department empty for anonymous reports. |
| EHS-OBS-099 | Safety Officer (SSO) | Report detail | Named reporter | Open a named report. | Positive | Reporter name shown (officers may see names). |
| EHS-OBS-100 | Super Admin (ADM) | Console → Observations | Named reporter | Open a named report as `ADMIN01`. | Security | Name hidden (admins aren't in the roles allowed to see reporter names: SSO, SH, HSE). |
| EHS-OBS-101 | External Auditor (AUD) | Console → Observations | Named reporter | Open a named report as `AUD01`. | Security | Name hidden. |
| EHS-OBS-102 | Verifier (VER) | Field app → report linked to my action | Named reporter | Open the report behind an action you verify. | Security | Name hidden. |
| EHS-OBS-103 | Field Employee (REP) | Report → Anonymous | Closure notice | Anonymous report gets closed. | Positive | Reporter still gets the closure notice in the app, without being identified to anyone. |
| EHS-OBS-104 | Safety Officer (SSO) | Triage | Return question to an anonymous reporter | Choose "Return with question" on an anonymous report. | Negative | 400 "Anonymous and QR reports cannot be returned to the reporter." |
| EHS-OBS-105 | Safety Officer (SSO) | Charts / export | Department of an anonymous report | Check the anonymous report's department in the charts and the export. | Security | No department recorded (2.1 rule). |

### 2E. QR form for guests and contractors without a login

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-OBS-110 | Guest (QR) | `/q/<token>` | Page load | Scan an area poster QR. | Positive | Form opens without sign-in; site and area named; language buttons for English, Hindi, Tamil and Kannada. |
| EHS-OBS-111 | Guest (QR) | `/q/<token>` | Language buttons | Tap each language. | UI | Whole form switches language. |
| EHS-OBS-112 | Guest (QR) | `/q/<token>` | Type, photo, description | Choose Unsafe condition, add a photo and text, submit. | Positive | Case number shown, plus a status link. |
| EHS-OBS-113 | Guest (QR) | `/q/<token>` | Name and phone (optional) | Enter name and phone, submit. | Positive | Saved encrypted; officers see them; not shown in charts or exports to other roles. |
| EHS-OBS-114 | Guest (QR) | `/q/<token>` | Anonymous | Tick anonymous, submit. | Positive | No name or phone stored even if typed. |
| EHS-OBS-115 | Guest (QR) | `/q/<token>` | Employer name | Type a contractor name. | Positive | Saved in the report details as employer name. |
| EHS-OBS-116 | Guest (QR) | `/q/<token>` | Status link | Open the status link later. | Positive | Shows the status (submitted / action assigned / closed) with no internal details. |
| EHS-OBS-117 | Guest (QR) | `/q/<token>` | Altered status link | Change one character of the status link. | Security | 404 "This status link is not valid." |
| EHS-OBS-118 | Guest (QR) | `/q/<token>` | Rotated or disabled QR | Admin rotates the poster; scan the old QR. | Negative | 410 "This QR code is no longer active." |
| EHS-OBS-119 | Guest (QR) | `/q/<token>` | Made-up token | Open `/q/AAAAAAAA`. | Negative | 404; no site details shown. |
| EHS-OBS-120 | Bot | `/q/<token>` | Hidden trap field | Fill the hidden "honeypot" field through the API. | Security | 400 "The form could not be accepted."; nothing saved. |
| EHS-OBS-121 | Bot | `/q/<token>` | Many reports from one IP | Send reports quickly from one IP until refused. | Security | 429 (per-IP limit); earlier ones saved. |
| EHS-OBS-122 | Bot | `/q/<token>` | Many reports on one QR | Send reports to one token from several IPs until refused. | Security | 429 (per-QR limit). |
| EHS-OBS-123 | Guest (QR) | `/q/<token>` | Upload over 15 MB | Send a 16 MB report. | Negative | 413 "The upload is too large." |
| EHS-OBS-124 | Guest (QR) | `/q/<token>` | 11 photos | Send 11 photos. | Negative | 400 "At most 10 photos per record." |
| EHS-OBS-125 | Guest (QR) | `/q/<token>` | No text and no photo | Submit an empty form. | Negative | Refused with a message in the chosen language. |
| EHS-OBS-126 | Safety Officer (SSO) | Reports → Triage | QR report arrives | After OBS-112, open Triage. | Workflow | Report listed with channel "QR"; return-to-reporter not offered. |

### 2F. Report lists, search, filters and who can see what

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-OBS-130 | Field Employee (REP) | Reports | Tabs | Open Reports as `WORKER-TN1-1`. | UI | No tabs: only "My reports". No Triage or Site tab. |
| EHS-OBS-131 | Field Employee (REP) | API | Site list | Call `GET /observations` (no `mine`). | Security | Only your own reports (workers always get "mine"). |
| EHS-OBS-132 | Field Employee (REP) | API | Someone else's report | Call `GET /observations/{id}` for `WORKER-TN1-2`'s report. | Security | 404. |
| EHS-OBS-133 | Supervisor (OWN) | API | Report behind my action | Open the report linked to an action you own. | Positive | 200 (you may see the report your action came from). |
| EHS-OBS-134 | Supervisor (OWN) | API | Unrelated report at the same site | Open a report with no link to you. | Security | 404. |
| EHS-OBS-135 | Safety Officer (SSO) | Reports | Tabs | Open Reports as `SO-TN1`. | UI | Tabs Mine / Triage (with count) / Site. |
| EHS-OBS-136 | Safety Officer (SSO) | Reports → Triage | Order | Have one danger-now report and two normal ones. | Positive | Danger-now first, then oldest first; each shows "Triage by" time and turns orange/red near or past the deadline. |
| EHS-OBS-137 | Safety Officer (SSO) | Reports → Site | Status chips | Tap each status: Submitted, Returned, Action assigned, Closed, Discarded, Merged, Escalated. | Positive | List shows only that status each time. |
| EHS-OBS-138 | Safety Officer (SSO) | Reports → Site | Type chips | Tap each type. | Positive | Filtered by type. |
| EHS-OBS-139 | Safety Officer (SSO) | Reports → Site | Band chips | Tap Extreme, High, Moderate, Low. | Positive | Filtered by risk band. |
| EHS-OBS-140 | Safety Officer (SSO) | Reports → Site | Area dropdown | Pick an area. | Positive | Only that area. |
| EHS-OBS-141 | Safety Officer (SSO) | Reports → Site | Category dropdown | Pick a category. | Positive | Only reports with that category. |
| EHS-OBS-142 | Safety Officer (SSO) | Reports | Search | Search by case number, then by a word in the description. | Positive | Matching reports only; "No matches" with Clear when none. |
| EHS-OBS-143 | Safety Officer (SSO) | Reports | Save filter | Set filters, tap Save filter, name it. | Positive | Chip appears; tapping it restores the filters; × deletes it with Undo. |
| EHS-OBS-144 | Safety Officer (SSO) | API | Other plant's report | `SO-TN1` opens a TN2 report by ID. | Security | 404. |
| EHS-OBS-145 | Safety Officer (SSO) | API | Other plant in the filter | `GET /observations?siteId=<TN2>`. | Security | 404. |
| EHS-OBS-146 | EHS Manager (HSE) | Reports → Site | Site dropdown | Pick each of the 5 sites. | Positive | Each site's reports (HSE has all sites). |
| EHS-OBS-147 | Verifier (VER) | API | Site list | `GET /observations?siteId=<TN1>`. | Positive | Allowed (verifiers can view the site); reporter names hidden. |
| EHS-OBS-148 | Any role | Report detail | Timeline | Open a closed report. | UI | Submitted → triaged → action assigned → completed → verified → closed, each with time and who. |
| EHS-OBS-149 | Safety Officer (SSO) | Report detail | Possible duplicates | Open a new report where another open report exists at the same area. | Positive | "Possible duplicates" lists it, with case number and how long ago. |

### 2G. Triage (officers): every decision

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-OBS-150 | Safety Officer (SSO) | Report detail → Triage | Triage button | Open a submitted report. | UI | Triage button shown; the sheet opens with 7 decisions. |
| EHS-OBS-151 | Field Employee (REP) | API | Triage | `WORKER-TN1-1` sends a triage. | Security | 403. |
| EHS-OBS-152 | Verifier (VER) | API | Triage | `VER-TN1` sends a triage. | Security | 403. |
| EHS-OBS-153 | Safety Officer (SSO) | API | Triage at another plant | `SO-TN1` triages a TN2 report. | Security | 404. |
| EHS-OBS-154 | Safety Officer (SSO) | Triage → Accept & assign | Risk matrix (likelihood 2, severity 3) | Tap the cell L2 × S3. | Positive | Score and band shown (Moderate on the default matrix); due date filled from the band's rule. |
| EHS-OBS-155 | Safety Officer (SSO) | Triage → Accept & assign | Matrix not rated | Leave the matrix empty and tap Assign. | Negative | 400 "Rate likelihood and severity." |
| EHS-OBS-156 | Safety Officer (SSO) | API | Only likelihood | Send `likelihood: 3` with no severity. | Negative | 400 "Rate likelihood and severity." |
| EHS-OBS-157 | Safety Officer (SSO) | Triage → Accept & assign | Categories cleared | Remove every category, tap Assign. | Negative | 400 "Choose at least one category." |
| EHS-OBS-158 | Safety Officer (SSO) | Triage → Accept & assign | IS 3786 code | Clear the IS 3786 code, tap Assign. | Negative | 400 "Choose the IS 3786 code." |
| EHS-OBS-159 | Safety Officer (SSO) | Triage → Accept & assign | Employer involved | Report has no employer; leave it empty; tap Assign. | Negative | 400 "Choose the employer involved." |
| EHS-OBS-160 | Safety Officer (SSO) | Triage → Accept & assign | No action | Remove every action draft, tap Assign. | Negative | 400 "Add at least one action." |
| EHS-OBS-161 | Safety Officer (SSO) | Triage → Accept & assign | Action owner (suggested) | Look at the owner field in the action draft. | UI | Pre-filled with the area owner, or the last owner for this category at the site. |
| EHS-OBS-162 | Safety Officer (SSO) | Triage → Accept & assign | Valid assign | Fill everything with owner `OWN-TN1-1` and tap Assign. | Positive | Report status "Action assigned"; action created `TN1-ACT-…`; owner notified; action gets the owner's department (2.1). |
| EHS-OBS-163 | Safety Officer (SSO) | Triage → Accept & assign | Two actions | Add 2 action drafts with different owners. | Positive | 2 actions created, each owner notified. |
| EHS-OBS-164 | Safety Officer (SSO) | Triage → Accept & assign | Extreme band without interim control | Rate L5 × S5 and leave the interim control empty. | Negative | 400 "An interim control is required for this risk band." |
| EHS-OBS-165 | Safety Officer (SSO) | Triage → Accept & assign | Danger-now report without interim control | Report has danger now; band Moderate; interim empty. | Negative | 400 "An interim control is required for this risk band." |
| EHS-OBS-166 | Safety Officer (SSO) | Triage → Accept & assign | Extreme with interim control | Rate L5 × S5, fill the interim control. | Positive | Assigned; stop-work alert to the site head; due date within 72 hours. |
| EHS-OBS-167 | Safety Officer (SSO) | Triage | Fixed on the spot | Choose "Fixed on the spot" on a report the worker fixed. | Positive | Report closed with a closure summary; reporter gets the closure notice. |
| EHS-OBS-168 | Safety Officer (SSO) | Triage | Return with question (empty) | Choose Return with question; leave the question empty. | Negative | 400 "Write the question for the reporter." |
| EHS-OBS-169 | Safety Officer (SSO) | Triage | Return with question | Write "Which floor?" and send. | Positive | Status "Returned"; reporter notified with the question. |
| EHS-OBS-170 | Field Employee (REP) | Report detail → Reply | Reply (text + photo) | Reporter answers with text and a photo. | Positive | Status back to "Submitted"; the report is in the officer's Triage list again. |
| EHS-OBS-171 | Field Employee (REP) | API | Reply when not returned | Reply to a report that is "Submitted". | Negative | 409 conflict (wrong status). |
| EHS-OBS-172 | Safety Officer (SSO) | Triage | Reviewed, no action (no reason) | Choose it with no reason. | Negative | 400 "A reason code and text are required." |
| EHS-OBS-173 | Safety Officer (SSO) | Triage | Reviewed, no action | Pick reason "Already controlled" and text. | Positive | Closed; reporter told; reason in the timeline. |
| EHS-OBS-174 | Safety Officer (SSO) | Triage | Discard | Pick "Test entry" with text. | Positive | Status "Discarded"; excluded from dashboard counts; counted in the discard rate. |
| EHS-OBS-175 | Safety Officer (SSO) | Triage | Merge into duplicate | Search and pick an open report at the same site. | Positive | Status "Merged" with a link to the master report. |
| EHS-OBS-176 | Safety Officer (SSO) | Triage | Merge into a closed report | Pick a closed report as master. | Negative | 400 "The master observation must be open and at the same site." |
| EHS-OBS-177 | Safety Officer (SSO) | Triage | Merge into another plant's report | Use the API with a TN2 master. | Negative | 400 (same message). |
| EHS-OBS-178 | Safety Officer (SSO) | Triage | Merge into itself | Use the API with master = same report. | Negative | 400 (same message). |
| EHS-OBS-179 | Safety Officer (SSO) | Triage | Escalate to incident | Choose Escalate; set "learned at" time. | Positive | Status "Escalated"; incident record started; site head and HSE notified; message shows the paper procedure (incident register is Phase 2). |
| EHS-OBS-180 | Safety Officer (SSO) | Triage | Escalate after assignment | Escalate a report already in "Action assigned". | Positive | Allowed (escalation is the one decision possible after assignment). |
| EHS-OBS-181 | Safety Officer (SSO) | API | Unknown decision | Send `decision: "approve"`. | Negative | 400. |
| EHS-OBS-182 | Safety Officer (SSO) | API | Triage twice by mistake | Send the same triage (same `clientUuid`) twice. | Positive | Applied once; the second returns the same result. |
| EHS-OBS-183 | Two officers | API | Second triage by someone else | Officer 1 assigns; officer 2 then sends a different decision. | Negative | 409 "This report was already triaged by someone else." |
| EHS-OBS-184 | Safety Officer (SSO) | Reports → Triage | Triage deadline | Leave a report untriaged past the working-day limit. | Workflow | Shown as late; reminder to the officer, then escalation to the site head per the ladder. |

### 2H. Report and assign (2.1)

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-OBS-190 | Safety Officer (SSO) | Report → Saved | "Score risk and assign owner now" | `SO-TN1` submits a TN1 report. | UI | Button shown under Report another / View. |
| EHS-OBS-191 | Field Employee (REP) | Report → Saved | Button hidden | Worker submits a report. | UI | No assign button. |
| EHS-OBS-192 | Supervisor (OWN) | Report → Saved | Button hidden | Owner submits a report. | UI | No assign button. |
| EHS-OBS-193 | Officer of TN1 only | Report → Saved | Button at another site | Officer with TN1 rights and reporter rights at TN2 reports at TN2. | UI | No button (not an officer at TN2). |
| EHS-OBS-194 | Safety Officer (SSO) | Report → Saved → Triage sheet | Assign online | Tap the button, fill the matrix and owner, tap Assign. | Workflow | Message "Decision saved…"; report "Action assigned" with the action created; button disappears. |
| EHS-OBS-195 | Safety Officer (SSO) | Report → Saved → Triage sheet | Assign offline | In airplane mode: report, then assign. Reconnect. | Workflow | Report sent first, then the decision; action created; no errors in the Outbox. |
| EHS-OBS-196 | Safety Officer (SSO) | Triage sheet | Cancel | Open the sheet and tap Cancel. | UI | Sheet closes; report stays "Submitted"; button still shown. |
| EHS-OBS-197 | Safety Officer (SSO) | Triage sheet | Other decisions | Choose Discard from the sheet. | Positive | Report discarded the normal way; same rules as 2G. |

### 2I. After triage: comments, reopen, danger acknowledgement, closure summary

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-OBS-200 | Field Employee (REP) | Report detail → Comment | Comment box | Reporter adds a comment to own report. | Positive | Comment shown with time; officers see it. |
| EHS-OBS-201 | Safety Officer (SSO) | Report detail → Comment | Comment box | Officer comments. | Positive | Shown; reporter notified in the app. |
| EHS-OBS-202 | Field Employee (REP) | API | Comment on someone else's report | Comment on `WORKER-TN1-2`'s report. | Security | 404. |
| EHS-OBS-203 | Field Employee (REP) | Report detail → Comment | Comment over 2,000 characters | Send 2,001 characters. | Negative | 400. |
| EHS-OBS-204 | Safety Officer (SSO) | Report detail → Reopen | Reopen a closed report | Give reason code and text. | Positive | Status "Action assigned"; closure cleared; audit row. |
| EHS-OBS-205 | Safety Officer (SSO) | Report detail → Reopen | No reason | Reopen with an empty reason. | Negative | 400 "A reason code and text are required." |
| EHS-OBS-206 | Field Employee (REP) | API | Reopen | Worker calls reopen. | Security | 403. |
| EHS-OBS-207 | Safety Officer (SSO) | API | Reopen an open report | Reopen a "Submitted" report. | Negative | 409 (wrong status). |
| EHS-OBS-208 | Safety Officer (SSO) | Notifications → danger alert | Acknowledge | Acknowledge within 30 minutes. | Positive | Acknowledged time saved; counts in the "critical acknowledgement median" figure. |
| EHS-OBS-209 | Safety Officer (SSO) | Danger alert | Not acknowledged | Don't acknowledge for longer than the set minutes (default 30). | Workflow | Escalation to the site head, then HSE, per the watcher. |
| EHS-OBS-210 | Field Employee (REP) | API | Acknowledge a danger alert ⚠ F8 | Worker calls `POST /observations/{id}/ack-critical`. | Security | Correct behaviour: 403. If not, log defect F8. |
| EHS-OBS-211 | Safety Officer (SSO) | Report detail → Closure summary | Edit summary on a closed report | Change the summary text. | Positive | Saved; reporter sees the new summary. |
| EHS-OBS-212 | Safety Officer (SSO) | API | Closure summary on an open report | Send a summary for a "Submitted" report. | Negative | 400 (only closed reports). |
| EHS-OBS-213 | Field Employee (REP) | Notifications | Closure notice | A report the worker made gets closed. | Positive | "Your report TN1-OBS-… was closed: <summary>" in the worker's language. |

### 2J. Console: Observations register

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-OBS-220 | Safety Officer (SSO) | Console → Observations | Table | Open the register. | UI | Columns: case number, type, category, status, band, area, received date; 50 per page; total count shown. |
| EHS-OBS-221 | Safety Officer (SSO) | Console → Observations | Sort by column | Click Received, then click it again. | Positive | Order flips between newest first and oldest first. |
| EHS-OBS-222 | Safety Officer (SSO) | Console → Observations | Paging | Go to page 2, then the last page. | Positive | Correct rows; page number shown; no repeated rows. |
| EHS-OBS-223 | Safety Officer (SSO) | Console → Observations | Filter: status, type, band, channel, area, employer, from/to dates | Apply each filter one at a time. | Positive | Count and rows match each filter. |
| EHS-OBS-224 | Safety Officer (SSO) | Console → Observations | Filters in the address | Copy the address with filters into a new tab. | UI | Same filtered view opens. |
| EHS-OBS-225 | Safety Officer (SSO) | Console → Observations | Search | Search a case number. | Positive | That one report. |
| EHS-OBS-226 | Safety Officer (SSO) | Console → Observations | Keyboard j / k / Enter | Press j, j, k, Enter. | UI | Focus moves between rows; Enter opens the detail drawer. |
| EHS-OBS-227 | Safety Officer (SSO) | Console → Observations → drawer | Triage from the console | Open a submitted report and triage it from the drawer. | Positive | Same rules and results as 2G. |
| EHS-OBS-228 | Safety Officer (SSO) | Console → Observations | CSV button | Export with a filter set. | Positive | CSV with the same filters; Tamil text readable in Excel; audit row. |
| EHS-OBS-229 | Safety Officer (SSO) | Console → Observations | Excel button (2.1) | Export with a filter set. | Positive | `.xlsx` with one sheet "Reports", bold frozen header with filters, India-time dates; audit row with format `xlsx`. |
| EHS-OBS-230 | External Auditor (AUD) | Console → Observations | Read-only | Open a report as `AUD01`. | Security | No Triage, Reopen or Comment buttons; export allowed. |
| EHS-OBS-231 | Plant Head (SH) | Console → Observations | Site scope | `SH-TN1` opens the register. | Security | TN1 reports only; site dropdown has TN1 only. |
| EHS-OBS-232 | Any console role | Console → top bar | Jump to case number | Type a case number in the top search. | Positive | Opens that report (if in scope); otherwise "not found". |

---

## Batch 3: Corrective and preventive actions (CAPA)

In SafeWorks, a CAPA is an **action**. It has these statuses: open → in progress → completed → verified (effective) or reopened (not effective). It can also be disputed or cancelled. Default due dates: Extreme 72 hours, High 7 days, Moderate 30 days, Low 90 days. Extreme and High need an interim control.

### 3A. Action lists and visibility (field app → Actions)

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-ACT-001 | Field Employee (REP), no department | Actions | Tabs | Open Actions as a worker with no department and no actions. | UI | Only "Mine" (count 0); empty message "Actions assigned to you appear here"; no To verify, Department or Site tab. |
| EHS-ACT-002 | Field Employee (REP) in Civil | Actions | Department tab (2.1) | Open Actions as `WORKER-TN1-1`. | UI | Tabs Mine and Department. |
| EHS-ACT-003 | Supervisor (OWN) | Actions → Mine | List order | Have one overdue, one open, one completed and one verified action. | Positive | Overdue first, then open, then completed, then verified; within a group, earliest due first. |
| EHS-ACT-004 | Supervisor (OWN) | Actions → Mine | Mine count | Look at the number on the Mine tab. | UI | Counts only open, in-progress, reopened and disputed actions you own. |
| EHS-ACT-005 | Verifier (VER) | Actions | To verify tab | Open Actions as `VER-TN1`. | UI | Tabs Mine and To verify (with count of completed actions you didn't own). |
| EHS-ACT-006 | Safety Officer (SSO) | Actions | Site tab | Open Actions as `SO-TN1`. | UI | Tabs Mine, To verify, Site (plus Department if `SO-TN1` has one). |
| EHS-ACT-007 | Any role | Actions | "Open only" chip | Tap Open only. | Positive | Only open, in-progress, reopened and disputed actions. |
| EHS-ACT-008 | Any role | Actions | Status chips | Tap each: Completed, Verified, Reopened, Disputed, Cancelled. | Positive | Filtered by that status each time. |
| EHS-ACT-009 | Any role | Actions | Band chips | Tap Extreme, High, Moderate, Low. | Positive | Filtered by band. |
| EHS-ACT-010 | Any role | Actions | Search | Search by case number, then by part of the title, then by the owner's name. | Positive | Matching actions only; "No matches" with Clear when none. |
| EHS-ACT-011 | Any role | Actions | Action row | Look at one row. | UI | Title, case number, source case number, owner, due text ("Due in 7 days" / "Overdue 2 days"), status and band pills, before-photo thumbnail. |
| EHS-ACT-012 | Field Employee (REP) | Actions → Department | Department list online | `WORKER-TN1-1` opens Department while online. | Positive | Every open action assigned to Civil works at your sites, including ones created before the phone last synced. |
| EHS-ACT-013 | Field Employee (REP) | Actions → Department | Department list offline | Go offline and open Department. | Positive | The phone's saved copy is shown; no error. |
| EHS-ACT-014 | Field Employee (REP) | Action detail (department) | Buttons on someone else's action | Open a Civil action owned by `OWN-TN1-1`. | Security | Read-only: no Start, Complete, Request new date or Dispute buttons. |
| EHS-ACT-015 | Field Employee (REP) | API | Department action of another department | Open an Electrical action by ID. | Security | 404. |
| EHS-ACT-016 | Field Employee (REP), no department | API | `?department=1` | `GET /actions?department=1`. | Positive | Empty list (total 0), not an error. |
| EHS-ACT-017 | Field Employee (REP) | API | Someone else's action, no department link | Open an action at TN1 owned by another person in another department. | Security | 404. |
| EHS-ACT-018 | Safety Officer (SSO) | API | Other plant's action | `SO-TN1` opens a TN2 action. | Security | 404. |
| EHS-ACT-019 | Safety Officer (SSO) | API | Other plant in the filter | `GET /actions?siteId=<TN2>`. | Security | 404. |
| EHS-ACT-020 | Safety Officer (SSO) | API | `departmentId` filter | `GET /actions?departmentId=<Electrical>`. | Positive | Only TN1 actions assigned to Electrical. |

### 3B. Start an action

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-ACT-030 | Supervisor (OWN) | Action detail | Start button | Open your "Open" action and tap Start. | Positive | Status "In progress"; event in the timeline; audit row. |
| EHS-ACT-031 | Supervisor (OWN) | Action detail | Start on a reopened action | Open a "Reopened" action and tap Start. | Positive | Status "In progress". |
| EHS-ACT-032 | Supervisor (OWN) | API | Start an in-progress action | Call start twice. | Negative | Second call: 409 (wrong status). |
| EHS-ACT-033 | Safety Officer (SSO) | API | Start someone else's action | `SO-TN1` starts an action owned by `OWN-TN1-1`. | Security | 403 "Only the action owner can do this." |
| EHS-ACT-034 | Supervisor (OWN) | Action detail (offline) | Start while offline | Tap Start in airplane mode, then reconnect. | Positive | Shown as pending; applied after sync. |

### 3C. Complete an action (evidence of closure)

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-ACT-040 | Supervisor (OWN) | Action detail → Complete | Complete sheet | Tap Complete. | UI | Sheet with After photo (required), What was done (required, 500 in the phone), Cause addressed, Save. |
| EHS-ACT-041 | Supervisor (OWN) | Complete | No after-photo | Fill the note and cause, no photo, tap Save. | Negative | "Add an after-photo" at the photo strip; API gives 400 "At least one after-photo is required." |
| EHS-ACT-042 | Supervisor (OWN) | Complete | Note too short | Type "ok" (2 characters). | Negative | "Write what was done" (at least 3 characters). |
| EHS-ACT-043 | Supervisor (OWN) | API | Empty note | Complete with `completionNote: ""`. | Negative | 400 "Write what was done." |
| EHS-ACT-044 | Supervisor (OWN) | API | Empty cause | Complete with `causeAddressed: ""`. | Negative | 400 "Record the cause addressed." |
| EHS-ACT-045 | Supervisor (OWN) | Complete | Valid | 1 after-photo, note "Guard rail fitted", cause "Rail removed during unloading", Save. | Positive | Status "Completed"; completed by and time saved; verifiers and officers of the site notified; the photo uploads after the text. |
| EHS-ACT-046 | Supervisor (OWN) | Complete | 10 after-photos | Add 10 photos. | Positive | All 10 saved. |
| EHS-ACT-047 | Supervisor (OWN) | API | 11 after-photos | Complete with 11 photo references. | Negative | 400 "At most 10 photos per record." |
| EHS-ACT-048 | Supervisor (OWN) | API | Note 2,001 characters | Complete with a 2,001-character note. | Negative | 400. |
| EHS-ACT-049 | Supervisor (OWN) | Complete | Complete directly from Open | Without Start, complete an Open action. | Positive | Allowed; status "Completed". |
| EHS-ACT-050 | Supervisor (OWN) | Complete | Complete a disputed action | Complete while the action is "Disputed". | Positive | Allowed (disputed counts as open); pending dispute stays for the officer. |
| EHS-ACT-051 | Supervisor (OWN) | API | Complete a verified action | Complete an action already verified. | Negative | 409 (wrong status). |
| EHS-ACT-052 | Field Employee (REP) | API | Complete someone else's action | Worker completes `OWN-TN1-1`'s action. | Security | 403 "Only the action owner can do this." (or 404 if out of scope). |
| EHS-ACT-053 | Supervisor (OWN) | Complete (offline) | Complete offline with photo | Complete in airplane mode, then reconnect. | Positive | Pending on the phone; text then photo synced; status Completed. |
| EHS-ACT-054 | Supervisor (OWN) | Complete | Same completion sent twice | Resend the same completion (same `clientUuid`). | Positive | Applied once. |

### 3D. Verify (approve or reject the fix)

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-ACT-060 | Verifier (VER) | Actions → To verify → detail | Verify sheet | Open a completed action and tap Verify. | UI | Before photo (from the report) and after photo side by side; Effective / Not effective; Method; Reason; Evidence photo (optional). |
| EHS-ACT-061 | Verifier (VER) | Verify | Effective | Choose Effective, method "Re-inspection", Save. | Positive | Status "Verified"; verifier, method and time saved; owner and officers notified. |
| EHS-ACT-062 | Verifier (VER) | Verify | Report closes when every action is verified | Verify the last open action of a report. | Workflow | Report status "Closed" with a closure summary; reporter (also anonymous) gets the closure notice. |
| EHS-ACT-063 | Verifier (VER) | Verify | Report stays open with other actions | Report has 2 actions; verify only one. | Workflow | Report stays "Action assigned". |
| EHS-ACT-064 | Verifier (VER) | Verify | Not effective without reason | Choose Not effective, no reason, Save. | Negative | 400 "Give the reason the action was not effective." |
| EHS-ACT-065 | Verifier (VER) | Verify | Not effective with reason | Choose Not effective, reason "Rail loose", Save. | Positive | Status "Reopened"; reopen count +1; new due date from the band rule; completion cleared; owner notified with the reason. |
| EHS-ACT-066 | Verifier (VER) | Verify | Evidence photo | Add 1 evidence photo with Effective. | Positive | Photo saved on the verification event. |
| EHS-ACT-067 | Supervisor (OWN) | API | Owner verifies own action | `OWN-TN1-1` verifies an action they own. | Security | 403 "The owner or completer of an action cannot verify it." |
| EHS-ACT-068 | Safety Officer (SSO) | API | Completer verifies | `SO-TN1` completed an action (as owner) then tries to verify. | Security | 403 (same message). |
| EHS-ACT-069 | Field Employee (REP) | API | Worker verifies | Worker calls verify. | Security | 403 "Only a verifier or safety officer of this site can verify." |
| EHS-ACT-070 | Supervisor (OWN), not owner | API | Owner role verifies another's action | `OWN-TN1-2` verifies `OWN-TN1-1`'s completed action. | Security | 403 (action owners are not verifiers). |
| EHS-ACT-071 | Safety Officer (SSO) | Verify | Officer verifies | `SO-TN1` verifies an action owned by `OWN-TN1-1`. | Positive | Allowed. |
| EHS-ACT-072 | EHS Manager (HSE) | Verify | HSE verifies at any site | `HSE01` verifies a KA1 action. | Positive | Allowed. |
| EHS-ACT-073 | Verifier (VER) | API | Verify an open action | Verify an action that is "In progress". | Negative | 409 (only completed actions). |
| EHS-ACT-074 | Verifier at TN2 | API | Verify another plant's action | TN2 verifier verifies a TN1 action. | Security | 404. |
| EHS-ACT-075 | Two verifiers | API | Verify twice | `VER-TN1` verifies; `SO-TN1` then verifies the same action. | Negative | Second gets 409 (already verified). |
| EHS-ACT-076 | Super Admin (ADM) | API | Admin verifies | `ADMIN01` (admin only, no verifier role) verifies. | Security | 403 (admin is not a verifier role). |
| EHS-ACT-077 | Verifier (VER) | Verify | Verify within the band's time | Leave a completed High action unverified past 72 hours. | Workflow | Shown on the Attention board as waiting for verification. |

### 3E. Requests: new due date and dispute

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-ACT-080 | Supervisor (OWN) | Action detail → Request new date | Date picker, Reason | Choose a date 10 days later, reason "Material delayed", Send. | Positive | Request pending; officer notified; the reminder ladder pauses up to 3 days. |
| EHS-ACT-081 | Supervisor (OWN) | API | Date change without a date | Send a date-change request with no proposed date. | Negative | 400 "Choose the proposed date." |
| EHS-ACT-082 | Supervisor (OWN) | Request new date | Date in the past | Choose yesterday. | Negative | Refused by the date picker, or refused by the server; no request created. |
| EHS-ACT-083 | Supervisor (OWN) | API | Second request while one is pending | Send another request while the first is pending. | Negative | 409 "A request is already pending on this action." |
| EHS-ACT-084 | Safety Officer (SSO) | Action detail → Requests | Approve date change | Approve the request. | Positive | Due date changes to the new date; the original due date stays unchanged (on-time % still uses it); owner notified. |
| EHS-ACT-085 | Safety Officer (SSO) | Action detail → Requests | Reject date change | Reject with a note. | Positive | Due date unchanged; owner notified with the note. |
| EHS-ACT-086 | Safety Officer (SSO) | Requests | Third date change goes to the site head | Owner makes a 3rd date-change request; `SO-TN1` tries to decide. | Security | 403 "The site head must decide this request."; `SH-TN1` can decide it. |
| EHS-ACT-087 | Plant Head (SH) | Requests | Owner is a safety officer | Action owned by `SO-TN1`; another officer tries to decide its request. | Security | 403; only the site head or HSE decides. |
| EHS-ACT-088 | Safety Officer (SSO) | API | Decide own action's request | `SO-TN1` decides a request on an action they own. | Security | 403 "The site head must decide this request." |
| EHS-ACT-089 | Safety Officer (SSO) | API | Decide twice | Decide the same request again. | Negative | 409 "This request was already decided." |
| EHS-ACT-090 | Supervisor (OWN) | Action detail → Dispute | Reason | Tap Dispute, reason "Not my area", Send. | Positive | Status "Disputed"; ladder paused 3 days; officer notified. |
| EHS-ACT-091 | Safety Officer (SSO) | Requests | Approve dispute without new owner | Approve the dispute with no new owner. | Negative | 400 "Choose the new owner." |
| EHS-ACT-092 | Safety Officer (SSO) | Requests | Approve dispute with new owner | Approve and pick `OWN-TN1-2`. | Positive | Owner changes; status "Open"; the action's department changes to the new owner's (2.1); both owners notified. |
| EHS-ACT-093 | Safety Officer (SSO) | Requests | Reject dispute | Reject with a note. | Positive | Status back to "Open"; same owner; ladder resumes. |
| EHS-ACT-094 | Safety Officer (SSO) | Requests | Approve dispute to the same owner | Pick the current owner as new owner. | Negative | 400 "Choose a different owner." |
| EHS-ACT-095 | Safety Officer (SSO) | Requests | New owner from another site | Pick a TN2-only person. | Negative | 400 "Choose an action owner at this site." |
| EHS-ACT-096 | Field Employee (REP) | API | Request on someone else's action | Worker sends a date-change request on another owner's action. | Security | 403 "Only the action owner can do this." |

### 3F. Reassign, cancel, create manually, comments

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-ACT-100 | Safety Officer (SSO) | Action detail → Reassign | New owner, Reason | Reassign from `OWN-TN1-1` to `OWN-TN1-2` with a reason. | Positive | Owner changed; department snapshot updated; pending requests marked "reassigned"; both owners notified; audit row. |
| EHS-ACT-101 | Safety Officer (SSO) | Reassign | Same owner | Pick the current owner. | Negative | 400 "Choose a different owner." |
| EHS-ACT-102 | Safety Officer (SSO) | Reassign | Owner from another site | Pick a TN2-only person. | Negative | 400 "Choose an action owner at this site." |
| EHS-ACT-103 | Safety Officer (SSO) | Reassign | Verified action | Reassign a verified action. | Negative | 409 "This cannot be done while the record is verified." |
| EHS-ACT-104 | Safety Officer (SSO) | Reassign | Disputed action | Reassign a disputed action. | Positive | Status "Open" with the new owner. |
| EHS-ACT-105 | Supervisor (OWN) | API | Owner reassigns | `OWN-TN1-1` calls reassign. | Security | 403. |
| EHS-ACT-106 | Safety Officer (SSO) | Action detail → Cancel | Approver dropdown, Reason | Cancel with approver `SH-TN1` and reason "Area demolished". | Positive | Status "Cancelled"; reason and approver saved; pending requests cancelled; owner notified. |
| EHS-ACT-107 | Safety Officer (SSO) | Cancel | Approver is not a site head | Pick `VER-TN1` as approver. | Negative | 400 "Cancelling needs approval from a site head or HSE manager of this site." |
| EHS-ACT-108 | Safety Officer (SSO) | Cancel | Approver from another site | Pick the TN2 site head. | Negative | 400 (same message). |
| EHS-ACT-109 | Safety Officer (SSO) | Cancel | Cancel a verified action | Try it. | Negative | 409 "This cannot be done while the record is verified." |
| EHS-ACT-110 | Safety Officer (SSO) | Cancel | Cancelled action in charts | Check Charts and the dashboard after cancelling. | Positive | Cancelled actions not counted as assigned or open. |
| EHS-ACT-111 | Safety Officer (SSO) | Console → Actions → New action | Manual action | Create an action with site TN1, title, owner, band Moderate. | Positive | Created with source "manual"; due date from the Moderate rule (30 days). |
| EHS-ACT-112 | Safety Officer (SSO) | New action | No band | Leave the band empty. | Negative | 400 "Choose the risk band." |
| EHS-ACT-113 | Safety Officer (SSO) | New action | Extreme without interim control | Band Extreme, interim empty. | Negative | 400 "An interim control is required for this risk band." |
| EHS-ACT-114 | Safety Officer (SSO) | New action | Owner from another site | Owner is TN2-only. | Negative | 400 "Choose an action owner at this site." |
| EHS-ACT-115 | Supervisor (OWN) | API | Owner creates an action | `OWN-TN1-1` calls `POST /actions`. | Security | 403. |
| EHS-ACT-116 | Safety Officer (SSO) | API | Action linked to another plant's report | Create with `sourceType: observation` and a TN2 report ID. | Security | 404. |
| EHS-ACT-117 | Supervisor (OWN) | Action detail → Comment | Text comment | Add "Ordering rail today". | Positive | Shown in the timeline with time and name. |
| EHS-ACT-118 | Supervisor (OWN) | Comment | Photo-only comment | Add a photo with no text. | Positive | Saved. |
| EHS-ACT-119 | Supervisor (OWN) | Comment | Empty comment | Send with no text and no photo. | Negative | 400 "Write a comment or add a photo." |

### 3G. Reminders and escalation for overdue actions

Standard ladder (Low / Moderate / High): owner push 7 days and 3 days before due and on the due day; safety officer and site head push 1 day after; HSE manager push + email and site head email 3 days after. Extreme ladder: owner push 1 day and 4 hours before; owner push + email at due time; officer and site head push + email 2 hours after; HSE manager push + email 1 day after.

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-ACT-130 | Supervisor (OWN) | Reminder job | 7 days before due | Create a Moderate action due in 7 days; run the ladder job. | Workflow | One push reminder to the owner; not sent again on the next run. |
| EHS-ACT-131 | Supervisor (OWN) | Reminder job | 3 days before due | Move the due date to 3 days away; run the job. | Workflow | One push to the owner. |
| EHS-ACT-132 | Supervisor (OWN) | Reminder job | Due day | Due today; run the job. | Workflow | One push to the owner. |
| EHS-ACT-133 | Safety Officer (SSO), Plant Head (SH) | Escalation job | 1 day overdue | Due yesterday, still open; run the job. | Workflow | Push to the site's safety officer and site head. |
| EHS-ACT-134 | EHS Manager (HSE), Plant Head (SH) | Escalation job | 3 days overdue | Due 3 days ago; run the job. | Workflow | HSE manager gets push + email; site head gets email. |
| EHS-ACT-135 | Owner, officer, site head, HSE | Escalation job | Extreme ladder | Extreme action due now; run the job at -1 day, -4 h, 0, +2 h and +1 day. | Workflow | Each step sent once to the right person on the right channel, as in the ladder above. |
| EHS-ACT-136 | Supervisor (OWN) | Escalation job | Completed before due | Complete the action, then run the job past the due date. | Positive | No more reminders (only open actions are chased). |
| EHS-ACT-137 | Supervisor (OWN) | Escalation job | Paused by a dispute | Dispute an overdue action; run the job during the 3-day pause. | Positive | No escalation during the pause; it resumes afterwards if still open. |
| EHS-ACT-138 | Supervisor (OWN) | Escalation job | Quiet hours | Owner has quiet hours on; a Moderate reminder falls at 23:00 India time. | Positive | Push held until morning; Extreme pushes are not held. |
| EHS-ACT-139 | Supervisor (OWN) | Escalation job | Daily push limit | Generate more pushes for one person than the daily cap. | Positive | Extra non-critical pushes are not sent; they stay in the app's notification list. |
| EHS-ACT-140 | EHS Manager (HSE) | Console → Due dates → Ladder | Edit a ladder step | Change the 1-day officer step to 2 days; save. | Positive | Saved; next run uses 2 days; audit row. |
| EHS-ACT-141 | Super Admin (ADM) | Email outbox | No email server | Run the escalation without SMTP set. | Negative | Emails stay queued in the outbox; the in-app and push parts still go; Health shows email not configured. |
| EHS-ACT-142 | Any | Escalation job | Two server processes | Run the ladder job on 2 processes at once. | Edge | Each step sent once (one process wins each job). |

### 3H. Console: Actions register

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-ACT-150 | Safety Officer (SSO) | Console → Actions | Table | Open the register. | UI | Columns: case number, title, owner, status, band, due date (red when overdue); 50 per page. |
| EHS-ACT-151 | Safety Officer (SSO) | Console → Actions | Sort | Sort by due date, case number, then status. | Positive | Order changes correctly each time. |
| EHS-ACT-152 | Safety Officer (SSO) | Console → Actions | Filter: status, band, owner, overdue, from/to | Apply each filter one at a time. | Positive | Rows and count match. |
| EHS-ACT-153 | Safety Officer (SSO) | Console → Actions → drawer | Detail drawer | Open an action. | UI | Timeline, requests, before/after photos, and the buttons this role may use. |
| EHS-ACT-154 | Safety Officer (SSO) | Console → Actions | CSV export | Export with filter "Overdue". | Positive | Only overdue rows; columns include Overdue and Department (2.1). |
| EHS-ACT-155 | Safety Officer (SSO) | Console → Actions | Excel export (2.1) | Export to Excel. | Positive | One sheet "Actions"; dates as real dates in India time; Overdue as Yes/No. |
| EHS-ACT-156 | External Auditor (AUD) | Console → Actions | Read-only | Open an action. | Security | No Reassign, Cancel, Decide or Verify buttons. |
| EHS-ACT-157 | Plant Head (SH) | Console → Attention | Overdue Extreme | An Extreme action is overdue. | Positive | Listed at the top of Attention with a red badge on the menu. |

---

## Batch 4: Inspections, audits and checklists

Answer types in SafeWorks: pass/fail/N.A., number (with pass range), text, photo, signature, date, single choice, multiple choice. Defaults per question: required, photo on fail, note on fail, action on fail. Scoring defaults: any fail = fail, pass mark 80%.

### 4A. Template builder (console → Templates)

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-INS-001 | EHS Manager (HSE) | Console → Templates | New template | Create code `SCAF-01`, name "Scaffold check" in English and Tamil. | Positive | Template created with version 1 as a draft; audit row. |
| EHS-INS-002 | EHS Manager (HSE) | Templates | Code with a space | Code `SCAF 01`. | Negative | 400 (letters, digits, `-` and `_` only, up to 40). |
| EHS-INS-003 | EHS Manager (HSE) | Templates | Code 41 characters | Enter 41 characters. | Negative | 400. |
| EHS-INS-004 | EHS Manager (HSE) | Templates | Duplicate code | Create `SCAF-01` again. | Negative | 409 "This code is already in use." |
| EHS-INS-005 | EHS Manager (HSE) | Templates → Builder | Add section | Add section "Base and ties". | Positive | Section shown; order can be changed. |
| EHS-INS-006 | EHS Manager (HSE) | Builder | Repeatable section | Tick "repeatable" with label "Bay". | Positive | Inspectors can add Bay 1, Bay 2… in a run. |
| EHS-INS-007 | EHS Manager (HSE) | Builder | Question type pass/fail/N.A. | Add "Base plates on sole boards?". | Positive | Saved with the defaults (required, photo/note/action on fail). |
| EHS-INS-008 | EHS Manager (HSE) | Builder | Question type number | Add "Guard rail height (mm)", pass range 950–1100. | Positive | A value outside 950–1100 is marked as fail in runs. |
| EHS-INS-009 | EHS Manager (HSE) | Builder | Question type text | Add "Comments". | Positive | Free text in runs. |
| EHS-INS-010 | EHS Manager (HSE) | Builder | Question type photo | Add "Photo of the tag". | Positive | Run requires a photo for this question. |
| EHS-INS-011 | EHS Manager (HSE) | Builder | Question type signature | Add "Inspector signature". | Positive | Run shows a signature pad. |
| EHS-INS-012 | EHS Manager (HSE) | Builder | Question type date | Add "Last examination date". | Positive | Run shows a date picker. |
| EHS-INS-013 | EHS Manager (HSE) | Builder | Single choice with options | Add "Tag colour" with Green, Yellow, Red; mark Red as a fail. | Positive | Choosing Red marks the item as failed. |
| EHS-INS-014 | EHS Manager (HSE) | Builder | Multiple choice | Add "PPE seen" with Helmet, Harness, Boots. | Positive | Several answers can be ticked. |
| EHS-INS-015 | EHS Manager (HSE) | Builder | Show-if rule | Show "Why not?" only when the previous answer is Fail. | Positive | Question appears only after a Fail in a run. |
| EHS-INS-016 | EHS Manager (HSE) | Builder | Not required | Untick required on "Comments". | Positive | A run can be submitted with it empty. |
| EHS-INS-017 | EHS Manager (HSE) | Builder | Action on fail off | Untick "action on fail" on one question. | Positive | A fail on it doesn't need an action before submit. |
| EHS-INS-018 | EHS Manager (HSE) | Builder | Reference text and status label | Add a reference "BOCW rule 43" with status "Reference to confirm". | Positive | Reference and its label shown to the inspector. |
| EHS-INS-019 | EHS Manager (HSE) | Builder | Scoring | Set pass mark 90%. | Positive | Runs below 90% are "Fail". |
| EHS-INS-020 | EHS Manager (HSE) | Templates → Version | Submit for review | Submit the draft. | Positive | Status "In review". |
| EHS-INS-021 | EHS Manager (HSE) | Templates → Version | Author approves own version | The same HSE manager clicks Approve. | Security | 403 "The author cannot approve their own version." |
| EHS-INS-022 | Super Admin (ADM) | Templates → Version | Approve | Another person (ADM) approves. | Positive | Version "Active"; the previous active version is retired; phones receive it at the next sync. |
| EHS-INS-023 | EHS Manager (HSE) | Templates → Version | Edit an active version | Change a question in the active version. | Negative | 400 "Only a draft version can be edited."; must create a new version. |
| EHS-INS-024 | EHS Manager (HSE) | Templates → Version | New version | Create version 2 from version 1, change a question, approve via ADM. | Positive | Version 2 active; runs already started on version 1 stay on version 1. |
| EHS-INS-025 | EHS Manager (HSE) | Templates → Version | Retire | Retire the active version. | Positive | No new runs can start on it; open runs on it can still be finished. |
| EHS-INS-026 | Safety Officer (SSO) | Templates | Copy for my site | `SO-TN1` copies `SCAF-01` as `SCAF-TN1`. | Positive | Site copy created as a draft. |
| EHS-INS-027 | Safety Officer (SSO) | API | Create a company template | `SO-TN1` calls `POST /admin/templates`. | Security | 403 (only admin and HSE manager). |
| EHS-INS-028 | External Auditor (AUD) | Templates | Read-only | Open a template as `AUD01`. | Security | Can read; no Edit, Approve or Copy buttons; API writes give 403. |
| EHS-INS-029 | EHS Manager (HSE) | Templates | Delete a template | Delete a template that has no runs. | Positive | Soft-deleted; gone from phones after sync. |

### 4B. Schedules

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-INS-040 | Safety Officer (SSO) | Console → Schedules | New schedule | Template `SCAF-01`, site TN1, area "Block A", every 1 week Monday 08:00, assignee role verifier. | Positive | Schedule saved; next due shown; runs created ahead by the lead days (default 1). |
| EHS-INS-041 | Safety Officer (SSO) | Schedules | Frequency incomplete | Leave the time empty. | Negative | 400 "Schedule frequency needs every, unit and time." |
| EHS-INS-042 | Safety Officer (SSO) | Schedules | Negative lead days | Enter lead days −1. | Negative | 400 (must be 0 or more). |
| EHS-INS-043 | Safety Officer (SSO) | API | Schedule at another plant | `SO-TN1` creates a schedule at TN2. | Security | 404. |
| EHS-INS-044 | Safety Officer (SSO) | Schedules | Assign to a person | Assignee `VER-TN1`. | Positive | The run appears in `VER-TN1`'s Inspections list. |
| EHS-INS-045 | Safety Officer (SSO) | Schedules | Assign to a role | Assignee role "verifier". | Positive | The run appears for every verifier at TN1. |
| EHS-INS-046 | Safety Officer (SSO) | Schedules | Pause | Turn Active off. | Positive | No new runs created; phones drop it after sync. |
| EHS-INS-047 | Scheduler job | Inspection scheduler | Missed run | A scheduled run passes its due time + grace hours (default 24) unstarted; run the job. | Workflow | Run status "Missed"; counts against inspection completion %; officer notified. |
| EHS-INS-048 | Scheduler job | Inspection scheduler | No duplicates | Run the scheduler twice in a row. | Edge | One run per due date, not two. |

### 4C. Doing an inspection (field app → Inspections)

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-INS-060 | Verifier (VER) | Inspections | Due list | Open Inspections. | UI | Scheduled runs assigned to you or your role, earliest due first. |
| EHS-INS-061 | Field Employee (REP) | Inspections → Start spot inspection | Template list | Tap Start; pick site and area. | Positive | Only active templates that apply to that site, area and equipment type. |
| EHS-INS-062 | Field Employee (REP) | API | Start on a retired version | Start a run with a retired template version. | Negative | 400 "This template version is not active." |
| EHS-INS-063 | Any role | Scan | QR on equipment | Scan an equipment QR and choose Inspect. | Positive | Run starts with that equipment filled in. |
| EHS-INS-064 | Inspector | Run | Pass answer | Answer Pass. | Positive | Saved on the phone at once. |
| EHS-INS-065 | Inspector | Run | Fail answer | Answer Fail. | Positive | Photo and note fields open (photo on fail, note on fail); "Add action" draft offered. |
| EHS-INS-066 | Inspector | Run | N.A. answer | Answer N.A. | Positive | Excluded from the score. |
| EHS-INS-067 | Inspector | Run | Number below range | Enter 900 for the 950–1100 question. | Positive | Marked fail; action needed. |
| EHS-INS-068 | Inspector | Run | Number not a number | Type "abc" in a number question. | Negative | Refused by the field. |
| EHS-INS-069 | Inspector | Run | Repeatable section | Add Bay 1 and Bay 2; answer both. | Positive | Answers kept separately per bay. |
| EHS-INS-070 | Inspector | Run | Signature | Sign on the pad. | Positive | Signature saved as an image with the run. |
| EHS-INS-071 | Inspector | Run | Submit with a required question unanswered | Leave 2 required questions empty and tap Submit. | Negative | 400 "Answer every required question first (2 unanswered)." |
| EHS-INS-072 | Inspector | Run | Submit with a failed item without action | Fail one item, no action draft, tap Submit. | Negative | 400 "Every failed item needs an action (1 missing)." |
| EHS-INS-073 | Inspector | Run | Submit valid | Answer all; add an action draft for each fail; Submit. | Positive | Status "Completed"; score % and Pass/Fail result; actions created with the inspector's site; officers notified (push only if Fail). |
| EHS-INS-074 | Inspector | Run | Equipment tag "Do not use" | Submit an equipment inspection with tag "Do not use". | Positive | Equipment status becomes "Do not use" with the run's case number. |
| EHS-INS-075 | Inspector | Run | Equipment tag "In service" | Submit with tag "In service". | Positive | Equipment back to "In service". |
| EHS-INS-076 | Inspector | Run | Repeat finding | Fail the same question at the same area as the previous completed run. | Positive | Marked as a repeat finding; shown on the dashboard. |
| EHS-INS-077 | Another user | API | Answer someone else's run | User B sends answers to user A's run. | Security | 403 "Only the inspector of this run can do this." |
| EHS-INS-078 | Inspector | API | Unknown question | Send an answer for a question not in the version. | Negative | 400 "Unknown question …". |
| EHS-INS-079 | Inspector | Run (offline) | Whole run offline | Start, answer with photos and submit in airplane mode; reconnect. | Positive | Start, answers and submit sent in order; case number assigned; actions created. |
| EHS-INS-080 | Inspector | Run | Late answers | After submit (offline), another answer arrives for the same run. | Edge | Stored and marked "late answers received after submit". |
| EHS-INS-081 | Inspector | Run detail | Report link | Tap Report. | Positive | Locked report opens in a new tab through a 5-minute signed link; it prints to PDF with photos, signature, times and GPS. |
| EHS-INS-082 | Any | Report link | Expired report link | Open the report link after 6 minutes. | Security | Refused "This link has expired. Refresh the page." |
| EHS-INS-083 | Any | Report link | Report link used by another user | Send the link to another person; they open it in time. | Security | Refused (the link is tied to the user who asked for it). |
| EHS-INS-084 | Safety Officer (SSO) | Run detail | Reopen a completed run | Reopen with reason "Wrong area". | Positive | Status "Reopened"; old report marked superseded; audit row. |
| EHS-INS-085 | Safety Officer (SSO) | Run detail | Reopen without reason | Empty reason. | Negative | 400 "A reason code and text are required." |
| EHS-INS-086 | Safety Officer (SSO) | Run detail | Cancel a scheduled run | Cancel with reason "Area closed". | Positive | Status "Cancelled". |
| EHS-INS-087 | Safety Officer (SSO) | Run detail | Cancel a completed run | Try to cancel a completed run. | Negative | 409 (only scheduled or in-progress runs). |
| EHS-INS-088 | Field Employee (REP) | API | Cancel a run | Worker calls cancel. | Security | 403. |
| EHS-INS-089 | Safety Officer (SSO) | API | Run at another plant | `SO-TN1` opens a TN2 run. | Security | 404. |

### 4D. Console: Inspections register

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-INS-100 | Safety Officer (SSO) | Console → Inspections | Table | Open the register. | UI | Case number, template, area / equipment, status, inspector, due, completed, score, result. |
| EHS-INS-101 | Safety Officer (SSO) | Console → Inspections | Filter: status, from/to | Filter Missed. | Positive | Missed runs only. |
| EHS-INS-102 | Safety Officer (SSO) | Console → Inspections | CSV and Excel export | Export both. | Positive | Same rows; Excel sheet "Inspections"; score as a number. |
| EHS-INS-103 | External Auditor (AUD) | Console → Inspections | Read-only | Open a run. | Security | No Reopen or Cancel buttons; report link allowed. |

---

## Batch 5: Reports, exports and notifications

### 5A. Exports (every list, every format)

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-RPT-001 | Safety Officer (SSO) | API | Observations CSV | `GET /exports/observations.csv?siteId=<TN1>`. | Positive | 200; starts with the UTF-8 byte-order mark; header row first; Tamil text readable when opened in Excel. |
| EHS-RPT-002 | Safety Officer (SSO) | API | Observations Excel | `GET /exports/observations.xlsx?siteId=<TN1>`. | Positive | 200; Excel file type; one sheet "Reports". |
| EHS-RPT-003 | Safety Officer (SSO) | API | Actions CSV | `GET /exports/actions.csv`. | Positive | 200; columns include Overdue and Department. |
| EHS-RPT-004 | Safety Officer (SSO) | API | Actions Excel | `GET /exports/actions.xlsx`. | Positive | 200; sheet "Actions". |
| EHS-RPT-005 | Safety Officer (SSO) | API | Inspections CSV | `GET /exports/inspections.csv`. | Positive | 200. |
| EHS-RPT-006 | Safety Officer (SSO) | API | Inspections Excel | `GET /exports/inspections.xlsx`. | Positive | 200; sheet "Inspections". |
| EHS-RPT-007 | Safety Officer (SSO) | API | Full report | `GET /exports/report.xlsx?from=2026-09-01&to=2026-10-31`. | Positive | Sheets Summary, Reports, Actions, Departments; Summary shows the sites, the period and the generated time. |
| EHS-RPT-008 | Safety Officer (SSO) | API | Unknown list | `GET /exports/users.xlsx`. | Negative | 404. |
| EHS-RPT-009 | Safety Officer (SSO) | API | Unknown format | `GET /exports/observations.pdf`. | Negative | 404. |
| EHS-RPT-010 | Field Employee (REP) | API | Any export | Worker calls each export. | Security | 403 for every one. |
| EHS-RPT-011 | Supervisor (OWN) | API | Any export | Owner calls each export. | Security | 403. |
| EHS-RPT-012 | Verifier (VER) | API | Any export ⚠ F4 | Verifier calls each export. | Security | Per the written rule: 403. If 200, log defect F4. |
| EHS-RPT-013 | External Auditor (AUD) | API | Any export | Auditor calls each export. | Positive | 200; audit rows record the auditor. |
| EHS-RPT-014 | Plant Head (SH) | API | Export another plant | `SH-TN1` exports with `siteId=<TN2>`. | Security | 404. |
| EHS-RPT-015 | Safety Officer (SSO) | Exports | Filters respected | Export observations with status Closed and band High. | Positive | Only closed High reports in the file. |
| EHS-RPT-016 | Safety Officer (SSO) | Exports | Hourly limit | 10 exports in an hour, then one more. | Negative | 11th: 429 "Export limit reached (10 per hour)." |
| EHS-RPT-017 | Safety Officer (SSO) | Exports | Audit trail | After an export, open the audit log. | Positive | Row `export` with the record type, format (`csv` / `xlsx`), row count and the filters used. |
| EHS-RPT-018 | Safety Officer (SSO) | Excel file | Header row | Open any `.xlsx`. | UI | Bold yellow header, frozen, with filter buttons; columns sized to fit. |
| EHS-RPT-019 | Safety Officer (SSO) | Excel file | Dates | Check a date cell. | Positive | A real date (sortable) in India time, shown as `yyyy-mm-dd hh:mm`. |
| EHS-RPT-020 | Safety Officer (SSO) | Excel file | Yes/No values | Check Danger now and Anonymous columns. | Positive | "Yes" / "No", not true/false. |
| EHS-RPT-021 | Safety Officer (SSO) | Excel file | Very long text | Export a report whose text is longer than Excel's 32,767-character cell limit (through a long closure summary). | Edge | File opens; the cell is cut at the limit; no "file is damaged" message. |
| EHS-RPT-022 | Safety Officer (SSO) | Excel file | Hidden control characters | Export a report whose text contains a control character. | Edge | Character removed; file opens. |
| EHS-RPT-023 | Safety Officer (SSO) | Excel file | Text that looks like a formula | Report description `=HYPERLINK("http://x")`. | Security | Shown as text in the Excel file, not run as a formula. |
| EHS-RPT-024 | Safety Officer (SSO) | CSV file | Text that looks like a formula ⚠ F9 | Same report exported as CSV and opened in Excel. | Security | Should not run as a formula. If Excel runs it (or offers to), log defect F9. |
| EHS-RPT-025 | Safety Officer (SSO) | Exports | 50,000-row cap | Export a list with more than 50,000 rows. | Edge | First 50,000 rows (newest first); no timeout. |
| EHS-RPT-026 | Safety Officer (SSO) | Exports | Excel in LibreOffice and Google Sheets | Open the same file in both. | Positive | Opens without repair in both. |
| EHS-RPT-027 | Any console role | Console → Dashboard | Export view (CSV) | Click Export view. | Positive | Client-side CSV of the dashboard figures. |
| EHS-RPT-028 | Safety Officer (SSO) | Field app → Charts | Excel button | Tap Excel. | Positive | Same full report as RPT-007 for the chosen period and site. |
| EHS-RPT-029 | Any console role | Console → config tables | Export CSV (contractors, people, departments) | Click Export CSV on each table. | Positive | CSV of the rows on screen. |

### 5B. Notifications and email digests

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-RPT-040 | Safety Officer (SSO) | Notifications | New report alert | A worker submits a report at TN1. | Positive | In-app notification to the TN1 officers with the case number and area. |
| EHS-RPT-041 | Supervisor (OWN) | Notifications | Assigned alert | An officer assigns an action to you. | Positive | In-app + push (if enabled) with title and due date; tapping opens the action. |
| EHS-RPT-042 | Field Employee (REP) | Notifications | Notification language | Worker's language is Tamil. | Positive | The notification text is in Tamil. |
| EHS-RPT-043 | Field Employee (REP) | Settings → Push | Enable push | Allow notifications in the browser. | Positive | Push subscription saved; test notification arrives (only when the server has push keys set). |
| EHS-RPT-044 | Any | Daily digest | Daily email | User with digest "Daily"; run the daily job. | Workflow | One email summarising open and overdue items for the user's sites; not sent to users with digest Off. |
| EHS-RPT-045 | Any | Weekly digest | Weekly email | User with digest "Weekly"; run the weekly job on the set weekday. | Workflow | One email per week. |
| EHS-RPT-046 | Super Admin (ADM) | Console → Notifications log | Log | Open the log. | Positive | Every notification with channel, recipient, status (queued / sent / failed / acknowledged) and error. |
| EHS-RPT-047 | EHS Manager (HSE) | Console → Notifications log | Log | Open the log as `HSE01`. | Positive | Allowed. |
| EHS-RPT-048 | Super Admin (ADM) | Notifications log | Failed push without keys | Push with no server push keys configured. | Negative | Status "failed" with error starting "VAPID". |
| EHS-RPT-049 | Super Admin (ADM) | Notifications log | Filter by status | Filter Failed. | Positive | Only failed rows. |
| EHS-RPT-050 | Gap | Scheduled custom reports by email | — | Look for a "schedule this report" option. | UI | Not built (gap 1.4). Digests are the only scheduled emails. |
| EHS-RPT-051 | Gap | Custom report builder | — | Look for a report builder. | UI | Not built (gap 1.4). |

---

## Batch 6: Admin and master settings

### 6A. Sites and areas (plant / location hierarchy)

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-ADM-001 | Super Admin (ADM) | Console → Sites → New site | Code, Name, State, District, Type | Create code `KA9`, name "Warehouse 9" (English + Kannada), state KA, district Hubballi. | Positive | Site created; audit row; appears in every site dropdown for all-site roles. |
| EHS-ADM-002 | Super Admin (ADM) | New site | Code in lowercase | Code `ka9`. | Negative | 400 "Site code: 2 to 6 capital letters or digits." |
| EHS-ADM-003 | Super Admin (ADM) | New site | Code 1 character | Code `K`. | Negative | 400 (same message). |
| EHS-ADM-004 | Super Admin (ADM) | New site | Code 7 characters | Code `KA12345`. | Negative | 400 (same message). |
| EHS-ADM-005 | Super Admin (ADM) | New site | Duplicate code | Code `TN1`. | Negative | 409 "This code is already in use." |
| EHS-ADM-006 | Super Admin (ADM) | New site | Name empty | Leave name empty. | Negative | 400 "name: required". |
| EHS-ADM-007 | Super Admin (ADM) | Sites → KA9 → Set up | Industry dropdown (step 2) | Choose "Warehouse"; Create. | Positive | Categories, inspection templates and default areas added for the industry; each area gets a QR poster. |
| EHS-ADM-008 | Super Admin (ADM) | Set up | Run set-up twice | Run the same set-up again. | Edge | Nothing duplicated (same number of areas). |
| EHS-ADM-009 | Super Admin (ADM) | API | Unknown industry | Set-up with `industryCode: "mars"`. | Negative | 400 "Unknown industry code." |
| EHS-ADM-010 | Super Admin (ADM) | Sites → Edit | Worker count, working calendar | Set worker count 120, weekly off Sunday, shift 08:00–17:00. | Positive | Saved; participation % uses 120; triage deadlines skip Sunday. |
| EHS-ADM-011 | Super Admin (ADM) | Sites → Edit | Site head | Choose `SH-TN1` as site head of TN1. | Positive | Saved; escalations go to this person. |
| EHS-ADM-012 | Super Admin (ADM) | Sites → Delete | Delete without reason | Delete KA9 with an empty reason. | Negative | 400 "A reason code and text are required." |
| EHS-ADM-013 | Super Admin (ADM) | Sites → Delete | Delete with reason | Delete KA9 with a reason. | Positive | Soft-deleted (records kept); hidden from lists; visible with "show deleted" for admin; audit row. |
| EHS-ADM-014 | EHS Manager (HSE) | API | Create a site | `HSE01` calls `POST /admin/sites`. | Security | 403 (admin only). |
| EHS-ADM-015 | EHS Manager (HSE) | Sites → Risk matrix | Assign matrix version to a site | Pick a matrix version for TN1. | Positive | Saved; new triage at TN1 uses that matrix. |
| EHS-ADM-016 | EHS Manager (HSE) | Sites → Rule set | Assign a draft rule pack | Pick `KA_OSH_DRAFT_2026` for KA1. | Negative | 400 "A draft rule pack needs a named reviewer before it can be enabled." |
| EHS-ADM-017 | EHS Manager (HSE) | Sites → Rule set | Assign a disabled rule set | Pick a disabled pack. | Negative | 400 "This rule set is not enabled." |
| EHS-ADM-018 | Safety Officer (SSO) | Sites | Site list | `SO-TN1` opens Sites. | Security | Only TN1; no New site or Delete buttons. |
| EHS-ADM-019 | Safety Officer (SSO) | Sites → TN1 → Areas | Add area | Add area "Loading bay", type "yard". | Positive | Area created with a QR code; phones get it at the next sync. |
| EHS-ADM-020 | Safety Officer (SSO) | API | Add area at another plant | `SO-TN1` adds an area at TN2. | Security | 404. |
| EHS-ADM-021 | Safety Officer (SSO) | Areas | Edit area owner | Set the area owner to `OWN-TN1-1`. | Positive | Triage suggests `OWN-TN1-1` as owner for this area. |
| EHS-ADM-022 | Safety Officer (SSO) | Areas | Parent area | Set "Level 3" under "Block A". | Positive | Shown nested. |
| EHS-ADM-023 | Safety Officer (SSO) | Areas → Delete | Delete with reason | Delete "Loading bay" with a reason. | Positive | Soft-deleted; removed from phones at the next sync; old reports keep the area name. |
| EHS-ADM-024 | Safety Officer (SSO) | Areas → Import CSV | Valid file | Import `code,name,type,parent,name_hi,name_ta,name_kn` with 3 rows. | Positive | Preview first; then "3 created". |
| EHS-ADM-025 | Safety Officer (SSO) | Areas → Import CSV | Wrong header | Header `area,title`. | Negative | 400 "The CSV header must be: code, name, type, parent." |
| EHS-ADM-026 | Safety Officer (SSO) | Areas → Import CSV | Same file twice | Import the same file again. | Edge | Rows updated, not duplicated. |
| EHS-ADM-027 | External Auditor (AUD) | Sites & areas | Read-only | `AUD01` opens Sites. | Security | No edit buttons; writes give 403 "Auditor accounts are read-only." |

### 6B. Equipment and QR codes

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-ADM-040 | Safety Officer (SSO) | Console → Equipment → Add | Site, Class, Tag no., Make/model, Safe working load | Add a forklift `FLT-01` at TN1. | Positive | Created; status "In service". |
| EHS-ADM-041 | Safety Officer (SSO) | Add equipment | No site | Leave site empty. | Negative | 400 "Choose the site." |
| EHS-ADM-042 | Safety Officer (SSO) | Add equipment | Duplicate tag | Add `FLT-01` again at TN1. | Negative | 409 "This code is already in use." |
| EHS-ADM-043 | Safety Officer (SSO) | API | Equipment at another plant | Add equipment at TN2. | Security | 404. |
| EHS-ADM-044 | Safety Officer (SSO) | Equipment → Import CSV | Valid file | `site_code,tag_no,asset_class,make_model,serial_no,swl_kg,area_code,next_exam_due`. | Positive | Rows created; results shown per row. |
| EHS-ADM-045 | Safety Officer (SSO) | Equipment → Import CSV | Unknown site code | A row with site `ZZ9`. | Negative | That row skipped with an error message; others imported. |
| EHS-ADM-046 | Safety Officer (SSO) | Equipment | Next examination due | Set a date in the past. | Positive | Shown as overdue on the equipment list and Attention board. |
| EHS-ADM-047 | Safety Officer (SSO) | Console → QR codes | New QR for equipment | Create a QR for `FLT-01`. | Positive | QR with label `FLT-01`; scanning opens the equipment's report/inspect options. |
| EHS-ADM-048 | Safety Officer (SSO) | QR codes | Poster | Click Poster; choose English, Tamil, Kannada and A4. | Positive | Poster opens in a new tab through a 5-minute signed link; prints in all 3 languages. |
| EHS-ADM-049 | Safety Officer (SSO) | QR codes | Poster link reused later | Open the poster link after 6 minutes. | Security | Refused (expired). |
| EHS-ADM-050 | Safety Officer (SSO) | QR codes | Rotate | Rotate with reason "Poster damaged". | Positive | New token; old QR gives 410; audit row. |
| EHS-ADM-051 | Safety Officer (SSO) | QR codes | Disable | Turn a QR off. | Positive | Scanning it gives 410 "This QR code is no longer active." |
| EHS-ADM-052 | Safety Officer (SSO) | API | QR at another plant | Rotate a TN2 QR. | Security | 404. |

### 6C. People, contractors and departments

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-ADM-060 | Super Admin (ADM) | People → Add | Name, Phone, Employer, Trade, Worker type, Language, Department (2.1) | Add a worker without a login. | Positive | Saved; phone stored encrypted; list shows only the last 4 digits. |
| EHS-ADM-061 | Super Admin (ADM) | People → Add | Bad phone | Phone `abc`. | Negative | "Enter a valid phone number." |
| EHS-ADM-062 | Super Admin (ADM) | People → Add | Unknown department | API with a random `departmentId`. | Negative | 400 "Unknown department." |
| EHS-ADM-063 | Super Admin (ADM) | People → Import CSV | Valid file | `name,phone,employer,trade,worker_type,language`. | Positive | Rows created. |
| EHS-ADM-064 | Super Admin (ADM) | People → Import CSV | Unknown employer | A row with an employer not in the list. | Negative | Preview marks the row "unknown employer". |
| EHS-ADM-065 | Super Admin (ADM) | People → Delete | Delete with reason | Delete a person. | Positive | Soft-deleted with reason; audit row. |
| EHS-ADM-066 | Safety Officer (SSO) | API | Change a person | `SO-TN1` calls `PUT /admin/people/{id}`. | Security | 403 (admin only). |
| EHS-ADM-067 | Super Admin (ADM) | Contractors → Add | Name, Registration, Contact, Phone, Email, Trades, Sites | Add "Sri Ganesh Constructions" for TN1 and TN2. | Positive | Saved; available in the employer dropdowns at TN1 and TN2 only. |
| EHS-ADM-068 | Super Admin (ADM) | Contractors → Add | Duplicate name | Add the same name again. | Negative | 409 "This code is already in use." |
| EHS-ADM-069 | Super Admin (ADM) | Contractors → Add | Bad email | Email `abc@`. | Negative | "Enter a valid email address."; Save disabled. |
| EHS-ADM-070 | Super Admin (ADM) | Contractors | Sub-contractor | Set parent "Sri Ganesh Constructions". | Positive | Shown as "sub-contractor of …". |
| EHS-ADM-071 | Super Admin (ADM) | Contractors | Own company row | Look for Remove on the own-company row. | UI | No Remove button for the own company. |
| EHS-ADM-072 | Super Admin (ADM) | Contractors → Remove | Remove with Undo | Remove a contractor; click Undo within the toast time. | Positive | Undo keeps it; without Undo it is soft-deleted. |
| EHS-ADM-073 | Super Admin (ADM) | Departments (2.1) → Add | Code, Names (4 languages), Order | Add `CIV`, "Civil works", Tamil name. | Positive | Saved as `CIV` (upper case); member count 0. |
| EHS-ADM-074 | Super Admin (ADM) | Departments → Add | Duplicate code | Add `civ` again. | Negative | 409 "This code is already in use." |
| EHS-ADM-075 | Super Admin (ADM) | Departments → Add | Code with a space | Code `CIV 1`. | Negative | "Letters, numbers, - and _ only (up to 20)."; API 400. |
| EHS-ADM-076 | Super Admin (ADM) | Departments → Add | English name empty | Leave the English name empty. | Negative | Save disabled; API 400 "name.en: required". |
| EHS-ADM-077 | Super Admin (ADM) | Departments → Edit | Inactive | Turn Active off. | Positive | Hidden from new user assignments; existing members keep it. |
| EHS-ADM-078 | Super Admin (ADM) | Departments → Remove | Remove | Remove "Civil works". | Positive | Members now have no department; past actions and reports keep "Civil works"; audit row. |
| EHS-ADM-079 | Safety Officer (SSO) | Departments | Read-only for officers | `SO-TN1` opens the Departments tab. | Security | List visible; no Add, Edit or Remove; API writes give 403. |

### 6D. Users and roles

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-ADM-090 | Super Admin (ADM) | Users → New user | Employee-code login | Name, code `E3001`, language Tamil, employer, department, role reporter at TN1. | Positive | Created; temporary password shown once with "copy" and a warning that it won't be shown again. |
| EHS-ADM-091 | Super Admin (ADM) | New user | Email login | Login type email, email `so9@example.in`, role site safety officer at TN1. | Positive | Created; temporary password shown once. |
| EHS-ADM-092 | Super Admin (ADM) | New user | Enrolment-code login | Login type enrolment code. | Positive | 24-hour code `XXXX-XXXX` shown once (no password). |
| EHS-ADM-093 | Super Admin (ADM) | New user | Email login without email | Email empty. | Negative | 400 "email: required for email login". |
| EHS-ADM-094 | Super Admin (ADM) | New user | Code login without code | Code empty. | Negative | 400 "employeeCode: required". |
| EHS-ADM-095 | Super Admin (ADM) | New user | Duplicate code | Code `WORKER-TN1-1`. | Negative | 409 "This code is already in use." |
| EHS-ADM-096 | Super Admin (ADM) | New user | Duplicate email | An email already used. | Negative | 409 "This email is already in use." |
| EHS-ADM-097 | Super Admin (ADM) | New user | Bad email | `abc@`. | Negative | "Enter a valid email address."; API 400. |
| EHS-ADM-098 | Super Admin (ADM) | New user | No role | Remove every role. | Negative | Save disabled ("add at least one role"). |
| EHS-ADM-099 | Super Admin (ADM) | API | Site role for all sites | Grant `site_safety_officer` with `siteId: null`. | Negative | 400 "Role site_safety_officer cannot be granted for all sites." |
| EHS-ADM-100 | Super Admin (ADM) | API | Unknown role | Grant role `plant_head`. | Negative | 400. |
| EHS-ADM-101 | Super Admin (ADM) | New user | Auditor | Role auditor. | Positive | Expiry date required and pre-filled 30 days ahead; account stops working after it. |
| EHS-ADM-102 | Super Admin (ADM) | Users → Edit | Change roles | Add verifier at TN2 to `OWN-TN1-1`. | Positive | Saved; at the next sign-in or cache refresh, TN2 appears for the user. |
| EHS-ADM-103 | Super Admin (ADM) | Users → Edit | Change department (2.1) | Move `WORKER-TN1-1` to Electrical. | Positive | `/me` shows Electrical; old actions keep Civil; new assignments get Electrical. |
| EHS-ADM-104 | Super Admin (ADM) | Users → Suspend | Suspend with reason | Suspend `WORKER-TN1-2`. | Positive | Status "Suspended"; all the user's sessions ended; audit row with reason. |
| EHS-ADM-105 | Super Admin (ADM) | Users → Reactivate | Reactivate | Set status Active. | Positive | User can sign in again. |
| EHS-ADM-106 | Super Admin (ADM) | Users → Deactivate | Deactivate with Undo | Deactivate, then Undo within the toast time. | Positive | Undo restores Active. |
| EHS-ADM-107 | Super Admin (ADM) | Users | Search and filters | Search "Ram"; filter by site TN1, role verifier, status Active. | Positive | Matching users only; count shown. |
| EHS-ADM-108 | Super Admin (ADM) | Users → detail | Devices | Open a user with 2 phones. | UI | Each device with platform, app version, last seen, Revoke button. |
| EHS-ADM-109 | Super Admin (ADM) | Users → Import CSV | Valid file | `name,employee_code,email,language,employer,department,trade,phone,role,site_code`, 3 rows. | Positive | Preview, then "3 created"; one-time temporary passwords listed once. |
| EHS-ADM-110 | Super Admin (ADM) | Users → Import CSV | Missing role | A row with no role. | Negative | Row skipped: "name, employee_code and a valid role are required". |
| EHS-ADM-111 | Super Admin (ADM) | Users → Import CSV | Unknown site | Site `ZZ9`. | Negative | Row skipped: "unknown site_code ZZ9". |
| EHS-ADM-112 | Super Admin (ADM) | Users → Import CSV | Unknown department (2.1) | Department `NOPE`. | Negative | Row skipped: "unknown department NOPE". |
| EHS-ADM-113 | Super Admin (ADM) | Users → Import CSV | Existing code | Import a code that already exists. | Positive | User updated and the role added; no new password. |
| EHS-ADM-114 | EHS Manager (HSE) | Users | Read users | `HSE01` opens Users. | Positive | List visible. |
| EHS-ADM-115 | EHS Manager (HSE) | API | Create a user | `HSE01` calls `POST /admin/users`. | Security | 403 (admin only). |
| EHS-ADM-116 | Safety Officer (SSO) | Console menu | Users menu | Look at the menu as `SO-TN1`. | UI | No Users item. |
| EHS-ADM-117 | Safety Officer (SSO) | API | List users | `GET /admin/users`. | Security | Refused, or limited to issuing enrolment codes for own-site workers only. |

### 6E. Safety configuration: categories, risk matrix, due dates, ladders, rule sets

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-ADM-130 | EHS Manager (HSE) | Categories → Add | Code, Names, Icon, Critical capable, Default IS 3786 | Add `CONFINED` with 4 language names. | Positive | Saved; shown in the phone's category chips after sync. |
| EHS-ADM-131 | EHS Manager (HSE) | Categories → Add | Empty code | Leave code empty. | Negative | 400 "code: required". |
| EHS-ADM-132 | EHS Manager (HSE) | Categories → Add | Duplicate code | Add `HEIGHT` again. | Negative | 409. |
| EHS-ADM-133 | EHS Manager (HSE) | Categories | Extra field | Add a required number field "Height (m)" to `HEIGHT`. | Positive | Quick report asks for it when `HEIGHT` is chosen. |
| EHS-ADM-134 | EHS Manager (HSE) | Categories | Reorder | Drag `PPE` to the top. | Positive | Order saved; phone shows the new order. |
| EHS-ADM-135 | EHS Manager (HSE) | Categories | Delete | Delete a category with a reason. | Positive | Hidden for new reports; old reports keep it. |
| EHS-ADM-136 | Safety Officer (SSO) | API | Change categories | `SO-TN1` adds a category. | Security | 403. |
| EHS-ADM-137 | EHS Manager (HSE) | Risk matrix → New version | 5×5 labels | Create a draft version and change "Likelihood 4" label. | Positive | Draft saved. |
| EHS-ADM-138 | EHS Manager (HSE) | Risk matrix | Edit active version | Edit the active version. | Negative | 400 "Only a draft version can be edited." |
| EHS-ADM-139 | EHS Manager (HSE) | Risk matrix | Author activates own version | The same person activates the draft. | Security | 403 "The author cannot approve their own version." |
| EHS-ADM-140 | Super Admin (ADM) | Risk matrix | Activate | Another person activates. | Positive | New version active; earlier triages keep their old version number. |
| EHS-ADM-141 | EHS Manager (HSE) | Due dates | Change a rule | High: 7 days → 5 days. | Positive | New High actions get 5 days; existing actions unchanged; audit row. |
| EHS-ADM-142 | EHS Manager (HSE) | Due dates | Site-specific rule | Add a TN1-only High rule of 3 days. | Positive | TN1 uses 3 days; other sites keep the company rule. |
| EHS-ADM-143 | EHS Manager (HSE) | Due dates | Invalid value | Amount −1. | Negative | Refused. |
| EHS-ADM-144 | EHS Manager (HSE) | Ladders | Edit a step | See EHS-ACT-140. | Positive | As ACT-140. |
| EHS-ADM-145 | EHS Manager (HSE) | Rule sets | Enable a draft pack without reviewer | Enable `KA_OSH_DRAFT_2026`. | Negative | 400 "A draft rule pack needs a named reviewer before it can be enabled." |
| EHS-ADM-146 | EHS Manager (HSE) | Rule sets | Enable a pack with an unreviewed timer | Enable a pack that has a timer without a deadline. | Negative | 400 "A timer rule without a reviewed deadline cannot be enabled." |
| EHS-ADM-147 | EHS Manager (HSE) | Rule sets | Status labels | Open `TN_FACTORY_LEGACY`. | UI | Each timer shows its label (verified primary / verified secondary / reference to confirm) and its source note. |
| EHS-ADM-148 | EHS Manager (HSE) | Rule sets | Disable | Disable a pack in use. | Positive | Disabled; sites using it show a warning. |

### 6F. Languages, settings, privacy, retention, health

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-ADM-200 | Super Admin (ADM) | Languages | Search a text | Search "poster" in Tamil. | Positive | Matching keys with the English text and the Tamil text side by side. |
| EHS-ADM-201 | Super Admin (ADM) | Languages | Override a text | Change `poster.headline` in Tamil; save. | Positive | Phones show the new text after the next sync. |
| EHS-ADM-202 | Super Admin (ADM) | Languages → Import | Valid file | Import `{lang: "kn", strings: {...}}`. | Positive | Strings saved. |
| EHS-ADM-203 | Super Admin (ADM) | Languages → Import | Bad shape | Import `{strings: "x"}`. | Negative | 400 "Expected {lang, strings}." or "strings must be an object of key → text." |
| EHS-ADM-204 | EHS Manager (HSE) | API | Change a text | `HSE01` calls `PUT /admin/translations/ta`. | Security | 403. |
| EHS-ADM-210 | Super Admin (ADM) | Settings | Company name | Change the company name. | Positive | Saved; shown in the console footer and emails. |
| EHS-ADM-211 | Super Admin (ADM) | Settings | Empty company name | Clear it. | Negative | 400 "orgName: required". |
| EHS-ADM-212 | Super Admin (ADM) | Settings | Two-step code roles | Add `site_safety_officer` to the MFA roles. | Positive | `SO-TN1` must set up a code at next sign-in. |
| EHS-ADM-213 | Super Admin (ADM) | Settings | Triage time limit, danger acknowledgement minutes, percent-safe minimum, max photos, dispute pause days, date changes before site head | Change each value once. | Positive | Each saved; the matching behaviour in Batches 2–3 uses the new value. |
| EHS-ADM-214 | EHS Manager (HSE) | Settings | Safety fields | `HSE01` changes the triage time limit. | Positive | Allowed. |
| EHS-ADM-215 | EHS Manager (HSE) | Settings | Company fields | `HSE01` changes the company name. | Security | 403 (only admin changes company details). |
| EHS-ADM-216 | Safety Officer (SSO) | API | Settings | `SO-TN1` calls `PUT /admin/settings`. | Security | 403. |
| EHS-ADM-220 | Super Admin (ADM) | Privacy → Notices | Publish a new version | Publish version 2 in English and Tamil. | Positive | Version 1 retired; every user must accept version 2 at their next sign-in (AUTH-056). |
| EHS-ADM-221 | Super Admin (ADM) | Privacy → Notices | No English text | Publish with English empty. | Negative | 400 "body.en: required". |
| EHS-ADM-222 | Super Admin (ADM) | Privacy → Requests | Record a request | Log a "copy of my data" request for a worker. | Positive | Request listed with due date and status; updates saved; audit row. |
| EHS-ADM-223 | EHS Manager (HSE) | API | Privacy requests | `HSE01` lists privacy requests. | Security | 403. |
| EHS-ADM-230 | Super Admin (ADM) | Retention | Policies | Change observations to 5 years. | Positive | Saved; label "needs legal review" kept. |
| EHS-ADM-231 | Super Admin (ADM) | Retention | Dry run | Click Dry run. | Positive | Counts what would be removed per record type; **nothing is deleted**. |
| EHS-ADM-232 | Super Admin (ADM) | Retention → Legal hold | Place a hold | Hold all records of TN1 with a reason. | Positive | Dry run then counts 0 for TN1. |
| EHS-ADM-233 | Super Admin (ADM) | Retention → Legal hold | Release | Release the hold. | Positive | Released with time and who; audit row. |
| EHS-ADM-234 | EHS Manager (HSE) | API | Retention | `HSE01` calls the dry run. | Security | 403. |
| EHS-ADM-240 | Super Admin (ADM) | Health | Page | Open Health. | Positive | Database, storage, email (configured or not), push keys, jobs last run, version. |

### 6G. Audit log and notifications log (immutable trail)

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-ADM-250 | Super Admin (ADM) | Audit log | List | Open the audit log. | UI | Time, actor, role, site, action, record, changes, reason, hash; newest first. |
| EHS-ADM-251 | Super Admin (ADM) | Audit log | Filters | Filter by action "export", by user, by record type, by date. | Positive | Matching rows only. |
| EHS-ADM-252 | Safety Officer (SSO) | Audit log | Site scope | `SO-TN1` opens the audit log. | Security | Only TN1 rows (and own sign-in rows); no TN2 rows. |
| EHS-ADM-253 | External Auditor (AUD) | Audit log | Read | `AUD01` opens the audit log. | Positive | All sites' rows. |
| EHS-ADM-254 | Super Admin (ADM) | Audit log | Verify chain | Click Verify chain. | Positive | "Chain intact" with the number of rows checked. |
| EHS-ADM-255 | Database tester | Audit log | Tampering | Change one old audit row's `changes` directly in the database; click Verify chain. | Security | "Chain broken at row N" naming the first altered row. |
| EHS-ADM-256 | Any role | API | Edit or delete an audit row | Look for any PUT or DELETE on the audit log. | Security | None exists (404/405). |
| EHS-ADM-257 | Super Admin (ADM) | Audit log | Sensitive data | Look at a user-create row. | Security | Changes show name and code; no password or hash; phone shown masked or encrypted. |
| EHS-ADM-258 | Super Admin (ADM) | Audit log | Every write is logged | Do one create, update, delete, transition and export; check the log. | Positive | 5 rows with before/after values. |
| EHS-ADM-260 | Super Admin (ADM) | Notifications log | Open | See EHS-RPT-046. | Positive | As RPT-046. |
| EHS-ADM-261 | EHS Manager (HSE) | Notifications log | Open | See EHS-RPT-047. | Positive | As RPT-047. |
| EHS-ADM-262 | External Auditor (AUD) | Console menu → Notifications log ⚠ F5 | Menu item | `AUD01` clicks Notifications log in the menu. | Security | Menu and server must agree. Today the menu shows it and the server answers 404 → log defect F5. |
| EHS-ADM-290 | EHS Manager (HSE) | Console menu → Health ⚠ F6 | Menu item | Look for Health as `HSE01`; then call `GET /admin/health`. | UI | Menu and server must agree. Today the menu hides it and the server allows it → log defect F6. |

---

## Batch 7: Cross-role workflows, escalation chains and plant isolation

### Flow 1: Unsafe condition with photo → assigned → fixed → verified → closed → figures update

In SafeWorks, the independent check is done by a **verifier** (or any officer who is neither the owner nor the person who completed the action). The EHS manager can also verify if they did neither.

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-WF1-01 | Field Employee (REP) | Field app → Report | Unsafe condition + 1 photo | `WORKER-TN1-1` reports "Open edge on level 3, no guard rail" at TN1 Block A with 1 photo. | Workflow | Case `TN1-OBS-2026-…`; photo uploaded with a matching hash. |
| EHS-WF1-02 | Safety Officer (SSO) | Notifications | New report alert | Check `SO-TN1`'s notifications. | Workflow | In-app alert for the new report; it's in Reports → Triage. |
| EHS-WF1-03 | Plant Head (SH) / EHS Manager (HSE) | Console → Dashboard | Triage backlog | Reload the dashboard. | Workflow | Triage backlog +1. |
| EHS-WF1-04 | Safety Officer (SSO) | Triage → Accept & assign | Matrix L3 × S4, owner `OWN-TN1-1`, interim control | Assign with one corrective action, engineering control. | Workflow | Report "Action assigned"; action `TN1-ACT-…` with due date from the band; owner notified; action department = Civil works. |
| EHS-WF1-05 | Supervisor (OWN) | Actions → Mine | New action | `OWN-TN1-1` opens Actions. | Workflow | Action listed with "Due in N days". |
| EHS-WF1-06 | Field Employee (REP), Civil | Actions → Department | Department tab (2.1) | `WORKER-TN1-1` opens Department. | Workflow | The same action listed, read-only. |
| EHS-WF1-07 | Supervisor (OWN) | Action detail | Start | Tap Start. | Workflow | "In progress". |
| EHS-WF1-08 | Supervisor (OWN) | Action detail → Complete | After photo, note, cause | Complete with 1 after-photo. | Workflow | "Completed"; verifiers notified; the action is in `VER-TN1`'s To verify list. |
| EHS-WF1-09 | Verifier (VER) | Verify | Before/after, Effective | `VER-TN1` checks both photos, chooses Effective. | Workflow | Action "Verified". |
| EHS-WF1-10 | System | Report | Closure | — | Workflow | Report "Closed" with a closure summary; `WORKER-TN1-1` gets the closure notice in Tamil. |
| EHS-WF1-11 | Any console role | Dashboard | Figures | Reload the dashboard. | Workflow | Open actions −1; on-time closure % and days to close updated; weekly chart includes the report. |
| EHS-WF1-12 | Field Employee (REP) | Charts → Mine / Department / Site | Figures (2.1) | Reload Charts. | Workflow | Report counted in Mine, Department (Civil) and Site; action counted as verified. |
| EHS-WF1-13 | Super Admin (ADM) | Audit log | Trail | Filter by the report and the action. | Workflow | Every step logged in order with who and when; chain verifies intact. |
| EHS-WF1-14 | Verifier (VER) | Verify → Not effective (variant) | Repeat the flow; at step 9 choose Not effective with reason. | — | Workflow | Action "Reopened", reopen count 1, new due date; owner notified; report stays "Action assigned"; after a second completion and Effective, the report closes. |

### Flow 2: Action past its due date → automatic escalation to the plant head

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-WF2-01 | Safety Officer (SSO) | Action set-up | Moderate action | Create an action for `OWN-TN1-1`, due in 7 days. Set an email server (SMTP) for the test. | Workflow | Due date set. |
| EHS-WF2-02 | System | Ladder job | 7 days, 3 days, due day | Move the clock through each step and run the job. | Workflow | Owner gets 3 push reminders, one per step. |
| EHS-WF2-03 | System | Ladder job | 1 day overdue | Move the clock to due + 1 day. | Workflow | `SO-TN1` and `SH-TN1` get a push. |
| EHS-WF2-04 | System | Ladder job | 3 days overdue | Move the clock to due + 3 days. | Workflow | `SH-TN1` (plant head) gets an **email**; `HSE01` gets push + email. Email visible in the email outbox as sent. |
| EHS-WF2-05 | Plant Head (SH) | Email | Email content | Open the email. | Workflow | Case number, title, owner, days overdue and a link to the action; in the site head's language. |
| EHS-WF2-06 | System | Ladder job | Each step once | Run the job again at the same time. | Workflow | No second email or push for the same step. |
| EHS-WF2-07 | Console | Attention / Dashboard | Overdue figures | Open both. | Workflow | Overdue count includes the action; Attention lists it. |
| EHS-WF2-08 | Supervisor (OWN) | Complete late | Complete after the due date | Complete and verify. | Workflow | Ladder stops; on-time closure % counts it as not on time (original due date). |
| EHS-WF2-09 | System | Extreme ladder (variant) | Extreme action | Repeat with an Extreme action. | Workflow | Plant head gets push + email 2 hours after due; HSE 1 day after. |
| EHS-WF2-10 | System | No email server (variant) | SMTP not set | Repeat step 4 without SMTP. | Negative | Email stays queued (not lost); in-app and push still delivered; Health shows email not configured. |

### Flow 3: Plant isolation (Plant A cannot see or change Plant B, including by changing IDs in the address)

Setup: `SO-TN1` (TN1 only), `SH-TN1` (TN1 only), and the TN2 officer `SO-TN2` with records at TN2. Each test uses a real TN2 record ID.

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-WF3-01 | SSO TN1 | API | Report detail | `GET /observations/<TN2 report>`. | Security | 404 (never 403, so IDs can't be probed). |
| EHS-WF3-02 | SSO TN1 | API | Report triage | `POST /observations/<TN2 report>/triage`. | Security | 404; report unchanged. |
| EHS-WF3-03 | SSO TN1 | API | Report comment | `POST /observations/<TN2 report>/comments`. | Security | 404. |
| EHS-WF3-04 | SSO TN1 | API | Report duplicates | `GET /observations/<TN2 report>/duplicates`. | Security | 404. |
| EHS-WF3-05 | SSO TN1 | API | Action detail | `GET /actions/<TN2 action>`. | Security | 404. |
| EHS-WF3-06 | SSO TN1 | API | Action reassign / cancel / decide | Each call on a TN2 action. | Security | 404 each; action unchanged. |
| EHS-WF3-07 | SSO TN1 | API | Inspection run | `GET /inspections/runs/<TN2 run>` and its report link. | Security | 404. |
| EHS-WF3-08 | SSO TN1 | API | Media | `GET /media/<TN2 photo>`. | Security | 404. |
| EHS-WF3-09 | SSO TN1 | Signed link | TN2 photo link copied from a TN2 user | Open a valid signed TN2 photo link copied from the TN2 officer. | Security | Signed links are tied to the record and user; refused for the wrong user, or expires within 1 hour. Note the result. |
| EHS-WF3-10 | SSO TN1 | API | List filters | `GET /observations?siteId=<TN2>`, `/actions?siteId=<TN2>`, `/inspections/runs?siteId=<TN2>`. | Security | 404 each. |
| EHS-WF3-11 | SSO TN1 | API | Dashboard, charts, exports | `/dashboard?siteIds=<TN2>`, `/insights?siteId=<TN2>`, `/exports/observations.csv?siteId=<TN2>`. | Security | 404 each. |
| EHS-WF3-12 | SSO TN1 | API | Sync pull | `GET /sync/pull`. | Security | No TN2 sites, areas, reports, actions or runs in the answer. |
| EHS-WF3-13 | SSO TN1 | API | Sync push into TN2 | Push an `observation create` with `siteId=<TN2>`. | Security | Rejected (404); nothing created. |
| EHS-WF3-14 | SSO TN1 | API | Admin areas, equipment, QR, schedules | Create/edit/delete each at TN2. | Security | 404 each. |
| EHS-WF3-15 | SSO TN1 | API | Audit log | `GET /admin/audit-log`. | Security | No TN2 rows. |
| EHS-WF3-16 | Plant Head TN1 | Console | Site dropdown and URL | Type the TN2 site ID into the console address. | Security | "Not found" page; no TN2 data shown. |
| EHS-WF3-17 | Field Employee TN1 | API | Another worker's report at the same plant | `GET /observations/<WORKER-TN1-2 report>`. | Security | 404. |
| EHS-WF3-18 | Field Employee TN1, Civil | API | Department action at another plant | A Civil action at TN2 (when the worker has no TN2 role). | Security | 404 (department view is limited to your own sites). |
| EHS-WF3-19 | Any | API | Guessing case numbers | Search `TN2-OBS-2026-00001` as `SO-TN1`. | Security | No result. |
| EHS-WF3-20 | EHS Manager (HSE) | API | All sites | Repeat WF3-01, 05 and 07 as `HSE01`. | Positive | 200 each (all-sites role). |

### Flow 4: Danger now → stop-work alert → acknowledgement chain

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-WF4-01 | Field Employee (REP) | Report | Danger now | Report "Live cable in water" with Danger now. | Workflow | Critical alert at once to TN1 officers and site head (push even in quiet hours, in-app, email). |
| EHS-WF4-02 | Safety Officer (SSO) | Alert | No acknowledgement | Wait past the acknowledgement minutes (default 30); run the watcher. | Workflow | Escalated to the site head, then HSE. |
| EHS-WF4-03 | Safety Officer (SSO) | Alert | Acknowledge | Acknowledge. | Workflow | Acknowledged time saved; no further escalation. |
| EHS-WF4-04 | Safety Officer (SSO) | Triage | Interim control required | Triage: any band, interim empty. | Negative | 400 "An interim control is required for this risk band." |
| EHS-WF4-05 | Any console role | Dashboard | Critical acknowledgement median | Reload. | Workflow | Median includes this case. |

### Flow 5: Dispute and handover between departments (2.1)

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-WF5-01 | Supervisor (OWN), Civil | Action → Dispute | Reason "Electrical job" | `OWN-TN1-1` disputes a Civil action. | Workflow | "Disputed"; ladder paused; officer notified. |
| EHS-WF5-02 | Safety Officer (SSO) | Requests → Approve | New owner `OWN-TN1-2` (Electrical) | Approve the dispute. | Workflow | Owner changes; status "Open"; action department now Electrical. |
| EHS-WF5-03 | Field Employee (REP), Civil | Actions → Department | List | Reload Department. | Workflow | Action no longer listed for Civil. |
| EHS-WF5-04 | Any | Charts → Site → By department | Table | Reload. | Workflow | Assigned count moves from Civil to Electrical. |

### Flow 6: Checklist change control (author ≠ approver)

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-WF6-01 | EHS Manager (HSE) | Templates | New version | `HSE01` drafts version 2 and submits for review. | Workflow | "In review". |
| EHS-WF6-02 | EHS Manager (HSE) | Templates | Self-approve | `HSE01` approves. | Security | 403. |
| EHS-WF6-03 | Super Admin (ADM) | Templates | Approve | `ADMIN01` approves. | Workflow | Version 2 active; version 1 retired. |
| EHS-WF6-04 | Inspector | Field app | Next run | Start a new run after sync. | Workflow | Uses version 2; a run already open on version 1 is finished on version 1. |

### Flow 7: Guest QR report → closure → status link

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-WF7-01 | Guest (QR) | QR form | Report | A visitor reports through the poster. | Workflow | Case number + status link. |
| EHS-WF7-02 | Safety Officer (SSO) | Triage | Assign | Assign an action; complete and verify it. | Workflow | Report closed. |
| EHS-WF7-03 | Guest (QR) | Status link | Status | Open the status link. | Workflow | Shows "Closed"; no names or internal notes. |

### Flow 8: Auditor visit from start to end

| Test ID | User role | Module / sub-menu | UI option / element | Test scenario and exact steps | Test type | Expected result |
|---|---|---|---|---|---|---|
| EHS-WF8-01 | Super Admin (ADM) | Users | Create auditor | Create `AUD02`, expiry 7 days. | Workflow | Created; temporary password once. |
| EHS-WF8-02 | External Auditor (AUD) | Console | Read and export | Read registers, dashboard, audit log; export the full report. | Workflow | All readable; exports allowed; no write anywhere (every write 403). |
| EHS-WF8-03 | External Auditor (AUD) | Console | After expiry | Sign in on day 8. | Security | 403 "This account has expired." |
| EHS-WF8-04 | Super Admin (ADM) | Audit log | Auditor trail | Filter by `AUD02`. | Workflow | Every sign-in and export by the auditor listed. |

### Incident module (template Flows: FIR, injury, RCA, witnesses, medical)

Not testable in 2.1: these are Phase 2 (gap 1.4). The only incident step today is **EHS-OBS-179 / 180 (Escalate to incident)**, which records when the event was learned and shows the paper procedure and the statutory timers from the site's rule set.

---

## Totals

| Batch | Module | Test cases |
|---|---|---|
| 1A | Authentication and profile | 67 |
| 1B | Dashboards and Charts | 59 |
| 2 | Safety observations | 206 |
| 3 | Corrective and preventive actions | 116 |
| 4 | Inspections, audits, checklists | 72 |
| 5 | Reports, exports, notifications | 41 |
| 6 | Admin and master settings | 142 |
| 7 | Cross-role workflows and isolation | 64 |
| **Total** | | **767** |

## How to run this plan

1. Use a fresh database with the demo seed (`python scripts/seed.py --demo`); see HANDOVER.md §7–8.
2. Run the ⚠ tests (F1–F9) first; they are the most likely defects.
3. Many security rows are API calls; use the field token (`kind: field`) or console token (`kind: admin`) from `POST /api/v1/auth/login`.
4. Time-based rows (ladder, missed runs, digests, link expiry, account expiry) need either a changed server clock or the job run on demand.
5. Record each result as Pass / Fail / Blocked with the date, tester and evidence (screenshot or API answer).

