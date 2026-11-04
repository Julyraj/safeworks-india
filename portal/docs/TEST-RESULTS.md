# SafeWorks Portal 2.1: test results

Run on 2026-11-04 19:22 UTC against a fresh demo database with `portal/e2e/run_test_plan.py` (API and timed-job cases), `portal/e2e/ui_plan.cjs` (screen cases) and `portal/e2e/e2e-real.cjs` (end-to-end browser run). Test cases are those of `portal/docs/TEST-PLAN.md`.

| | Count |
|---|---|
| Cases in the plan | 770 |
| Run automatically (API, timed jobs and browser) | 757 |
| Passed | 757 |
| Failed | 0 |
| Runner error | 0 |
| Not automated (UI, timing or manual; see the browser run and the list below) | 13 |

## Defects found and fixed

| # | Defect | Fix | Proved by |
|---|---|---|---|
| F1 | A report dated in the future was stored as sent | Capture times more than 5 minutes ahead are replaced by the time the server received the report; the claimed time is kept with the report's details | EHS-OBS-020, `test_f1_*` |
| F2 | The server accepted a report with no category | Server requires at least one category (phone, web and QR form) | EHS-OBS-014/016, `test_f2_*` |
| F3 | "Fixed on the spot" without what was done was accepted | Server requires the text | EHS-OBS-029/030, `test_f3_*` |
| F4 | Verifiers could export | Exports limited to officers, site heads, HSE managers, admins and auditors, and only for the sites where they hold that role | EHS-DSH-033, EHS-RPT-012, `test_f4_*` |
| F5 | Console showed Notifications log to auditors; the server refused them | Menu item shown to admin and HSE manager only (matches the server) | EHS-ADM-262 |
| F6 | Server allowed HSE managers into Health; the menu hid it | Menu shows Health to admin and HSE manager | EHS-ADM-290 |
| F7 | Dashboard with "from" after "to" showed zeros | Dates are swapped into a range (as Charts already did) | EHS-DSH-009, `test_f7_*` |
| F8 | Who may acknowledge a danger-now alert | Not a defect: only safety officers, site heads and HSE managers of the site (confirmed) | EHS-OBS-210, `test_f8_*` |
| F9 | CSV export could carry spreadsheet formulas (CSV injection) | Text starting with = + - @ tab or CR gets a leading apostrophe; .xlsx was already safe | EHS-RPT-024, `test_f9_*` |
| F10 | External auditors could create reports, comments and inspection runs from the phone app | Auditor-only accounts are read-only in the field API too | EHS-OBS-055, `test_f10_*` |
| F11 | A site could be created with an empty name | English name required | EHS-ADM-006, `test_f11_*` |
| F12 | The server accepted malformed emails such as `abc@` | Same email rule as the console form, on create and edit | EHS-ADM-097, `test_f12_*` |
| F13 | Phone-app pages never opened while online could not open offline | After sign-in with a connection, every page is fetched in the background so the offline cache holds all of them | Browser run step 1 (outbox offline) |
| F14 | Reminders and escalations for Extreme-risk actions were held by quiet hours (e.g. 2 am → 7 am) and counted against the daily push limit | Extreme-band reminders are sent as urgent: never held, never capped | EHS-ACT-138, `test_f14_*` |
| F15 | Daily and weekly digest emails showed a raw code `ntf.digest_daily.body` | Digest closing text added in English, Hindi, Tamil and Kannada; a test now checks every notification text exists in all four | EHS-RPT-044, `test_f15_*` |
| F16 | The "triage overdue" reminder (app and email to the site head) linked to `/inbox`, a page the phone app does not have | Links to Reports → Triage | EHS-OBS-184, `test_f16_*` |
| F17 | An external-auditor account could be created (or imported by CSV) with no expiry date, i.e. permanent access | Expiry required for auditors; CSV-imported auditors get 30 days | EHS-ADM-101, `test_f17_*` |
| F18 | Required category details (extra fields) were checked only by the phone form | Server requires them for signed-in reports (the QR form does not ask them) | EHS-ADM-133, EHS-OBS-037/038, `test_f18_*` |
| F19 | A contractor could be saved with an email such as `abc@` | Same email rule as users | EHS-ADM-069, `test_f19_*` |
| F20 | "Request new date" accepted a date in the past (also when approving) | The new date must be in the future | EHS-ACT-082, `test_f20_*` |
| F21 | A checklist number question accepted text ("abc"), and a choice question an option it does not have | Answers must fit the question; the phone form already only offers valid values | EHS-INS-068, `test_f21_*` |
| F22 | "Danger now" could be switched on for a good-practice report, raising a danger alert for good news | The switch is hidden for good practice and the server ignores it | EHS-OBS-027, `test_f22_*` |
| F23 | Charts opened offline showed a generic error; charts already on screen gave no sign they were out of date | Clear "Charts need a connection" message; a notice when the shown figures could not be refreshed | EHS-DSH-047/048 (browser) |
| F24 | Phone numbers were not checked (letters, 2 digits) on users, people, contractors and the QR form; CSV imports took them too | Phone must be 7–16 digits, may start with +; bad CSV rows are skipped with a reason | EHS-ADM-061, `test_f24_*` |
| F25 | Typing a case number in the console search did nothing when already on that register, and leftover saved filters could hide the case | The jump re-reads the address and clears other filters | EHS-OBS-232 (browser) |
| F26 | Work saved offline stayed Pending after the app was closed and reopened with signal ("No connection · next retry") | On start with a connection, waiting items are sent at once | EHS-OBS-084, EHS-ACT-034/053 (browser) |
| F27 | After a failed send, the retry waited for the 2-minute background timer instead of its back-off (seen first in Firefox) | The retry is scheduled after each sync run ends | EHS-OBS-233, EHS-OBS-082 (browser) |
| S1–S4, C1–C4 | Detailed review (4 Nov): MFA could be re-enrolled with the password only; officers could issue enrolment codes for site heads; lists showed sites where the user only reports; viewers could overwrite photos; export checked a different site parameter than it exported; reversed dates in Charts and the Excel report; "At risk" label | See `QA-DETAILED.md` | `tests/test_security.py` |

Plan corrections (the system was right, the plan was not): EHS-INS-084/085 (only admin and HSE manager may reopen a submitted inspection, because its report is locked); EHS-ACT-050 (an owner who disputed an action cannot complete it until the dispute is decided); EHS-INS-083 and EHS-WF3-09 (a report link is a 5-minute ticket bound to one record and to the requester's scope, by design, because a page opened in a new tab cannot carry a sign-in).

## Results by case

| Test ID | What | Result | Note |
|---|---|---|---|
| EHS-AUTH-001 | Field app → Sign in — Login field, Password field, Sign in button | PASS |  |
| EHS-AUTH-002 | Field app → Sign in — Login field (letter case) | PASS |  |
| EHS-AUTH-003 | Field app → Sign in — Login field (email) | PASS |  |
| EHS-AUTH-004 | Field app → Sign in — Password field | PASS |  |
| EHS-AUTH-005 | Field app → Sign in — Login field | PASS |  |
| EHS-AUTH-006 | Field app → Sign in — Login field (empty) | PASS |  |
| EHS-AUTH-007 | Field app → Sign in — Password field (length) | PASS |  |
| EHS-AUTH-008 | Field app → Sign in — Login field (length) | PASS |  |
| EHS-AUTH-009 | Field app → Sign in — Account lock | PASS |  |
| EHS-AUTH-010 | Field app → Sign in — Lock expiry | PASS |  |
| EHS-AUTH-011 | Field app → Sign in — Failed-attempt counter reset | PASS |  |
| EHS-AUTH-012 | Console → Users → Unlock — Unlock button | PASS |  |
| EHS-AUTH-013 | Field app → Sign in — Rate limit by IP + login | PASS |  |
| EHS-AUTH-014 | Field app → Sign in — Account status | PASS |  |
| EHS-AUTH-015 | Field app → Sign in — Account status | PASS |  |
| EHS-AUTH-016 | Field app → any page — Session after suspension | PASS |  |
| EHS-AUTH-017 | Console → Sign in — Account expiry date | PASS |  |
| EHS-AUTH-018 | Console → Sign in — Read-only console | PASS |  |
| EHS-AUTH-019 | Console → Sign in — Console role check | PASS |  |
| EHS-AUTH-020 | Console → Sign in — Console role check | PASS |  |
| EHS-AUTH-021 | Console → Sign in — Console role check | PASS |  |
| EHS-AUTH-022 | API — Field token used on the console API | PASS |  |
| EHS-AUTH-023 | Console → Sign in — No two-step code needed | PASS |  |
| EHS-AUTH-024 | Console → Sign in → Set up two-step code — QR code, Secret, Code field | PASS |  |
| EHS-AUTH-025 | Console → Two-step code — Code field (wrong) | PASS |  |
| EHS-AUTH-026 | Console → Two-step code — Code field (second login) | PASS |  |
| EHS-AUTH-027 | API — Pre-login token | PASS |  |
| EHS-AUTH-028 | Console → Two-step code — Pre-login time limit | PASS |  |
| EHS-AUTH-029 | Field app → Sign in — Two-step code on the phone | PASS |  |
| EHS-AUTH-030 | Console → Users → Reset two-step code — Reset button | PASS |  |
| EHS-AUTH-031 | Field app → Change password — Forced change | PASS |  |
| EHS-AUTH-032 | Field app → Change password — New password (7 characters) | PASS |  |
| EHS-AUTH-033 | Field app → Change password — New password (letters only) | PASS |  |
| EHS-AUTH-034 | Field app → Change password — New password (digits only) | PASS |  |
| EHS-AUTH-035 | Settings → Change password — New password (11 characters) | PASS |  |
| EHS-AUTH-036 | Settings → Change password — New password (valid) | PASS |  |
| EHS-AUTH-037 | Settings → Change password — Current password field | PASS |  |
| EHS-AUTH-038 | Settings → Change password — New password (129 characters) | PASS |  |
| EHS-AUTH-039 | Settings → Change password — Other devices signed out | PASS |  |
| EHS-AUTH-040 | Field app → Sign in → Enrolment code — Code field `ABCD-EFGH`, New password | PASS |  |
| EHS-AUTH-041 | Field app → Enrolment code — Expired code | PASS |  |
| EHS-AUTH-042 | Field app → Enrolment code — Used code | PASS |  |
| EHS-AUTH-043 | Console → Users → Enrolment code — Issue code (own site) | PASS |  |
| EHS-AUTH-044 | API — Issue code (other site) | PASS |  |
| EHS-AUTH-045 | Console → Users → Enrolment code — Read-only account | PASS |  |
| EHS-AUTH-046 | Console → Users → Reset password — Reset password button (forgot-password route) | PASS |  |
| EHS-AUTH-047 | API — Reset password (not admin) | PASS |  |
| EHS-AUTH-048 | Field app → Sign-in screen — No "Forgot password" link | PASS | browser |
| EHS-AUTH-049 | Field app → More → Sign out — Sign out button | PASS |  |
| EHS-AUTH-050 | Field app → More → Sign out — Sign out with unsent reports | PASS | browser |
| EHS-AUTH-051 | Console — Console session limit | PASS |  |
| EHS-AUTH-052 | Field app — Phone session limit | PASS |  |
| EHS-AUTH-053 | API — Token in the address bar | PASS |  |
| EHS-AUTH-054 | Console → Users → Revoke device — Revoke device button | PASS |  |
| EHS-AUTH-055 | Console → Audit log — Sign-in events | PASS |  |
| EHS-AUTH-056 | First sign-in → Privacy notice — Accept button | PASS |  |
| EHS-AUTH-057 | Settings → Language — Language dropdown | PASS |  |
| EHS-AUTH-058 | API → Preferences — Language value | PASS |  |
| EHS-AUTH-059 | Settings → Email digest — Digest dropdown | PASS |  |
| EHS-AUTH-060 | Settings → Quiet hours — Toggle | PASS | browser |
| EHS-AUTH-061 | Notifications — Mark all read button | PASS |  |
| EHS-AUTH-062 | Notifications → critical alert — Acknowledge button | PASS |  |
| EHS-AUTH-063 | Field app → any list — No role switching | PASS |  |
| EHS-AUTH-064 | Android app → Server address — Server address field | Not automated | Android app only (needs a phone or emulator) |
| EHS-AUTH-065 | Android app → Server address — Server address field | Not automated | Android app only (needs a phone or emulator) |
| EHS-AUTH-066 | QR form `/q/<token>` — No sign-in | PASS |  |
| EHS-AUTH-067 | API — Calls without sign-in | PASS |  |
| EHS-AUTH-068 | Sign-in and first screens — Default language | PASS | browser |
| EHS-AUTH-069 | Console → Account → Language — Pick a language | PASS | browser |
| EHS-DSH-001 | Console → Dashboard — Site dropdown "All sites" | PASS |  |
| EHS-DSH-002 | Console → Dashboard — Site dropdown | PASS |  |
| EHS-DSH-003 | Console → Dashboard — Site dropdown | PASS |  |
| EHS-DSH-004 | API — Other plant's ID in the address | PASS |  |
| EHS-DSH-005 | API — Mixed site IDs | PASS |  |
| EHS-DSH-006 | Console → Dashboard — Read-only view | PASS |  |
| EHS-DSH-007 | Console → Dashboard — From / To dates | PASS |  |
| EHS-DSH-008 | API — Bad date | PASS |  |
| EHS-DSH-009 | Console → Dashboard — From after To ⚠ F7 | PASS |  |
| EHS-DSH-010 | Console → Dashboard — Future dates | PASS |  |
| EHS-DSH-011 | Console → Dashboard — KPI "Open actions" | PASS |  |
| EHS-DSH-012 | Console → Dashboard — KPI "Overdue actions" | PASS |  |
| EHS-DSH-013 | Console → Dashboard — KPI "Triage backlog" | PASS |  |
| EHS-DSH-014 | Console → Dashboard — KPI "On-time closure %" | PASS |  |
| EHS-DSH-015 | Console → Dashboard — KPI "Percent safe" | PASS |  |
| EHS-DSH-016 | Console → Dashboard — KPI "Participation %" | PASS |  |
| EHS-DSH-017 | Console → Dashboard — KPI "Critical acknowledgement median" | PASS |  |
| EHS-DSH-018 | Console → Dashboard — KPI "Inspection completion %" | PASS |  |
| EHS-DSH-019 | Console → Dashboard — Weekly chart bars | PASS | browser |
| EHS-DSH-020 | Console → Dashboard — "By category" row link | PASS | browser |
| EHS-DSH-021 | Console → Dashboard — By type / By area / By employer bars | PASS |  |
| EHS-DSH-022 | Console → Dashboard — Ageing buckets | PASS |  |
| EHS-DSH-023 | Console → Dashboard — Days to close by band table | PASS |  |
| EHS-DSH-024 | Console → Dashboard — Repeat findings table | PASS |  |
| EHS-DSH-025 | Console → Dashboard — By department table (2.1) | PASS |  |
| EHS-DSH-026 | Console → Dashboard — By department, empty state | PASS | browser |
| EHS-DSH-027 | Console → Dashboard — Departments → link | PASS | browser |
| EHS-DSH-028 | Console → Dashboard — Export view (CSV) button | PASS | browser |
| EHS-DSH-029 | Console → Dashboard — Full report (Excel) button (2.1) | PASS |  |
| EHS-DSH-030 | Console → Dashboard — Full report (Excel) content | PASS |  |
| EHS-DSH-031 | Console → Dashboard — Hourly export limit | PASS |  |
| EHS-DSH-032 | Console → Dashboard — Full report (Excel) | PASS |  |
| EHS-DSH-033 | API — Export ⚠ F4 | PASS |  |
| EHS-DSH-034 | API — Export | PASS |  |
| EHS-DSH-035 | Console → Dashboard — Figures after a change | PASS |  |
| EHS-DSH-036 | Console → Attention — Attention menu red badge | PASS | browser |
| EHS-DSH-037 | Field app → More → Charts — Mine tab | PASS |  |
| EHS-DSH-038 | Field app → Charts → Mine — Own anonymous reports | PASS |  |
| EHS-DSH-039 | Field app → Charts — Department tab hidden | PASS | browser |
| EHS-DSH-040 | API — Department level without a department | PASS |  |
| EHS-DSH-041 | Field app → Charts → Department — Department tab | PASS |  |
| EHS-DSH-042 | Field app → Charts → Department — Anonymous not counted | PASS |  |
| EHS-DSH-043 | Field app → Charts → Site — Site tab | PASS |  |
| EHS-DSH-044 | Field app → Charts — Excel button hidden | PASS | browser |
| EHS-DSH-045 | Field app → Charts — Excel button hidden | PASS | browser |
| EHS-DSH-046 | Field app → Charts — Excel button | PASS | browser |
| EHS-DSH-047 | Field app → Charts — Excel while offline | PASS | browser |
| EHS-DSH-048 | Field app → Charts — Offline | PASS | browser |
| EHS-DSH-049 | Field app → Charts — 30 / 90 / 365-day chips | PASS |  |
| EHS-DSH-050 | Field app → Charts — Chosen period kept | PASS | browser |
| EHS-DSH-051 | Field app → Charts — Site dropdown | PASS |  |
| EHS-DSH-052 | API — Other plant's insights | PASS |  |
| EHS-DSH-053 | Field app → Charts — Trend chart bars | PASS | browser |
| EHS-DSH-054 | Field app → Charts — By risk card | PASS |  |
| EHS-DSH-055 | Field app → Charts — Empty period | PASS | browser |
| EHS-DSH-056 | Field app → Charts — Phone layout at 390 px | PASS | browser |
| EHS-DSH-057 | Field app → Charts — Language | PASS | browser |
| EHS-DSH-058 | API — Level value | PASS |  |
| EHS-DSH-059 | API — Charts without sign-in | PASS |  |
| EHS-OBS-001 | Field app → Report — Report button (home, + button) | PASS | browser |
| EHS-OBS-002 | Report — Location chip (GPS) | PASS | browser |
| EHS-OBS-003 | Report — Location chip (no GPS) | PASS | browser |
| EHS-OBS-004 | Report → Change location — Site dropdown | PASS | browser |
| EHS-OBS-005 | Report → Change location — Area dropdown | PASS | browser |
| EHS-OBS-006 | Report → Change location — Equipment dropdown | Not automated | Manual check: equipment picker in Change location |
| EHS-OBS-007 | Report — Type tile "Good practice" | PASS | browser |
| EHS-OBS-008 | Report — Type tile "Unsafe act" | PASS | browser |
| EHS-OBS-009 | Report — Type tile "Unsafe condition" | PASS | browser |
| EHS-OBS-010 | Report — Type tile "Near miss" | PASS | browser |
| EHS-OBS-011 | Report — No type chosen | PASS |  |
| EHS-OBS-012 | Report — Category chips (suggested) | PASS | browser |
| EHS-OBS-013 | Report — Category chips (several) | PASS | browser |
| EHS-OBS-014 | Report — Category chips (none) | PASS |  |
| EHS-OBS-015 | API — Unknown category code | PASS |  |
| EHS-OBS-016 | API — Empty category list ⚠ F2 | PASS |  |
| EHS-OBS-017 | Report — Description (500 characters) | PASS |  |
| EHS-OBS-018 | Report — Description (501 characters) | PASS |  |
| EHS-OBS-019 | Report — No description and no photo | PASS |  |
| EHS-OBS-020 | API — Report dated in the future ⚠ F1 | PASS |  |
| EHS-OBS-021 | API — Very old date | PASS |  |
| EHS-OBS-022 | API — Bad date | PASS |  |
| EHS-OBS-023 | Report — Description with Tamil text | PASS |  |
| EHS-OBS-024 | Report — Description with emoji and `<script>` | PASS |  |
| EHS-OBS-025 | Report — Voice-to-text (mic in description) | Not automated | Needs a microphone and the phone's speech service |
| EHS-OBS-026 | Report — "Danger now" toggle | PASS |  |
| EHS-OBS-027 | Report — "Danger now" with good practice | PASS | browser |
| EHS-OBS-028 | Report — "Fixed on the spot" toggle | PASS | browser |
| EHS-OBS-029 | Report — "Fixed on the spot" without what you did | PASS |  |
| EHS-OBS-030 | API — "Fixed on the spot" without what you did ⚠ F3 | PASS |  |
| EHS-OBS-031 | Report — What you did (2,000 characters) | PASS |  |
| EHS-OBS-032 | API — What you did (2,001 characters) | PASS |  |
| EHS-OBS-033 | Report — "Anonymous" toggle | PASS |  |
| EHS-OBS-034 | Report — Employer (automatic) | PASS |  |
| EHS-OBS-035 | Report — Employer involved dropdown | PASS | browser |
| EHS-OBS-036 | Report — Trade dropdown | PASS | browser |
| EHS-OBS-037 | Report — Category extra field (required) | PASS |  |
| EHS-OBS-038 | Report — Category extra field (filled) | PASS |  |
| EHS-OBS-039 | Report — Submit button | PASS | browser |
| EHS-OBS-040 | Report → Saved — Report another | PASS | browser |
| EHS-OBS-041 | Report → Saved — View | PASS | browser |
| EHS-OBS-042 | Report — Draft autosave | PASS | browser |
| EHS-OBS-043 | Report — Discard draft | PASS | browser |
| EHS-OBS-044 | Report — Leave page with unsaved draft | PASS | browser |
| EHS-OBS-045 | API — Site outside scope | PASS |  |
| EHS-OBS-046 | API — Area from another site | PASS |  |
| EHS-OBS-047 | API — Equipment from another site | PASS |  |
| EHS-OBS-048 | API — No area and no GPS | PASS |  |
| EHS-OBS-049 | API — GPS without area | PASS |  |
| EHS-OBS-050 | API — Same report sent twice | PASS |  |
| EHS-OBS-051 | API — Unknown field | PASS |  |
| EHS-OBS-052 | Report — Create | PASS |  |
| EHS-OBS-053 | Report — Create | PASS |  |
| EHS-OBS-054 | Report — Create | PASS |  |
| EHS-OBS-055 | API — Create ⚠ F10 | PASS |  |
| EHS-OBS-056 | Report — Case number format | PASS |  |
| EHS-OBS-057 | Report — Report on behalf of a worker without a phone | PASS |  |
| EHS-OBS-060 | Report — Camera strip (1 photo) | PASS |  |
| EHS-OBS-061 | Report — Camera strip (3 photos) | PASS | browser |
| EHS-OBS-062 | Report — Camera strip (4th photo) | PASS | browser |
| EHS-OBS-063 | API — Photo count above the server limit | PASS |  |
| EHS-OBS-064 | Report — Photo from gallery | PASS | browser |
| EHS-OBS-065 | Report — PNG and WebP photos | PASS |  |
| EHS-OBS-066 | API — PDF sent as a photo | PASS |  |
| EHS-OBS-067 | API — Renamed file | PASS |  |
| EHS-OBS-068 | API — File over 10 MB | PASS |  |
| EHS-OBS-069 | API — Empty upload | PASS |  |
| EHS-OBS-070 | API — Photo changed after capture | PASS |  |
| EHS-OBS-071 | API — Upload to someone else's photo slot | PASS |  |
| EHS-OBS-072 | API — Same upload twice | PASS |  |
| EHS-OBS-073 | Report — Blur boxes | Not automated | Manual check: drawing a blur box and looking at the saved photo |
| EHS-OBS-074 | Report — Voice note (30 seconds) | Not automated | Needs a microphone to record |
| EHS-OBS-075 | API — Voice note over 60 seconds | PASS |  |
| EHS-OBS-076 | Report — Video | Not automated | Checks that a feature is absent (gap 1.4, video not in 2.1); not automated |
| EHS-OBS-077 | Report detail — Photo link | PASS |  |
| EHS-OBS-078 | Report detail — Lightbox | PASS | browser |
| EHS-OBS-080 | Report (offline) — Submit | PASS | browser |
| EHS-OBS-081 | Outbox — Automatic sync | PASS | browser |
| EHS-OBS-082 | Outbox — Network lost during the photo upload | PASS | browser |
| EHS-OBS-083 | Outbox — 5 reports offline | PASS |  |
| EHS-OBS-084 | Outbox — App closed while offline | PASS | browser |
| EHS-OBS-085 | Outbox — Server refuses a report | PASS |  |
| EHS-OBS-086 | Outbox — Retry button | Not automated | Manual check: needs a refused item that is then fixed on the phone |
| EHS-OBS-087 | Outbox — Diagnostics | PASS | browser |
| EHS-OBS-088 | Reports (offline) — Lists | PASS | browser |
| EHS-OBS-089 | Sync — Clock wrong on the phone | PASS |  |
| EHS-OBS-090 | Sync — Triage queued behind an unsent report | PASS |  |
| EHS-OBS-091 | Sync — Two offline triage decisions on one report | PASS |  |
| EHS-OBS-095 | Reports → Mine — Own anonymous report | PASS |  |
| EHS-OBS-096 | Report detail — Anonymous reporter | PASS |  |
| EHS-OBS-097 | Console → Observations — Anonymous reporter | PASS |  |
| EHS-OBS-098 | Console → Observations → Export — Reporter column for an anonymous report | PASS |  |
| EHS-OBS-099 | Report detail — Named reporter | PASS |  |
| EHS-OBS-100 | Console → Observations — Named reporter | PASS |  |
| EHS-OBS-101 | Console → Observations — Named reporter | PASS |  |
| EHS-OBS-102 | Field app → report linked to my action — Named reporter | PASS |  |
| EHS-OBS-103 | Report → Anonymous — Closure notice | PASS |  |
| EHS-OBS-104 | Triage — Return question to an anonymous reporter | PASS |  |
| EHS-OBS-105 | Charts / export — Department of an anonymous report | PASS |  |
| EHS-OBS-110 | `/q/<token>` — Page load | PASS |  |
| EHS-OBS-111 | `/q/<token>` — Language buttons | PASS | browser |
| EHS-OBS-112 | `/q/<token>` — Type, photo, description | PASS |  |
| EHS-OBS-113 | `/q/<token>` — Name and phone (optional) | PASS |  |
| EHS-OBS-114 | `/q/<token>` — Anonymous | PASS |  |
| EHS-OBS-115 | `/q/<token>` — Employer name | PASS |  |
| EHS-OBS-116 | `/q/<token>` — Status link | PASS |  |
| EHS-OBS-117 | `/q/<token>` — Altered status link | PASS |  |
| EHS-OBS-118 | `/q/<token>` — Rotated or disabled QR | PASS |  |
| EHS-OBS-119 | `/q/<token>` — Made-up token | PASS |  |
| EHS-OBS-120 | `/q/<token>` — Hidden trap field | PASS |  |
| EHS-OBS-121 | `/q/<token>` — Many reports from one IP | PASS |  |
| EHS-OBS-122 | `/q/<token>` — Many reports on one QR | PASS |  |
| EHS-OBS-123 | `/q/<token>` — Upload over 15 MB | PASS |  |
| EHS-OBS-124 | `/q/<token>` — 11 photos | PASS |  |
| EHS-OBS-125 | `/q/<token>` — No text and no photo | PASS |  |
| EHS-OBS-126 | Reports → Triage — QR report arrives | PASS |  |
| EHS-OBS-130 | Reports — Tabs | PASS |  |
| EHS-OBS-131 | API — Site list | PASS |  |
| EHS-OBS-132 | API — Someone else's report | PASS |  |
| EHS-OBS-133 | API — Report behind my action | PASS |  |
| EHS-OBS-134 | API — Unrelated report at the same site | PASS |  |
| EHS-OBS-135 | Reports — Tabs | PASS | browser |
| EHS-OBS-136 | Reports → Triage — Order | PASS | browser |
| EHS-OBS-137 | Reports → Site — Status chips | PASS | browser |
| EHS-OBS-138 | Reports → Site — Type chips | PASS | browser |
| EHS-OBS-139 | Reports → Site — Band chips | PASS | browser |
| EHS-OBS-140 | Reports → Site — Area dropdown | PASS | browser |
| EHS-OBS-141 | Reports → Site — Category dropdown | PASS | browser |
| EHS-OBS-142 | Reports — Search | PASS | browser |
| EHS-OBS-143 | Reports — Save filter | PASS | browser |
| EHS-OBS-144 | API — Other plant's report | PASS |  |
| EHS-OBS-145 | API — Other plant in the filter | PASS |  |
| EHS-OBS-146 | Reports → Site — Site dropdown | PASS |  |
| EHS-OBS-147 | API — Site list | PASS |  |
| EHS-OBS-148 | Report detail — Timeline | PASS |  |
| EHS-OBS-149 | Report detail — Possible duplicates | PASS |  |
| EHS-OBS-150 | Report detail → Triage — Triage button | PASS | browser |
| EHS-OBS-151 | API — Triage | PASS |  |
| EHS-OBS-152 | API — Triage | PASS |  |
| EHS-OBS-153 | API — Triage at another plant | PASS |  |
| EHS-OBS-154 | Triage → Accept & assign — Risk matrix (likelihood 2, severity 3) | PASS | browser |
| EHS-OBS-155 | Triage → Accept & assign — Matrix not rated | PASS |  |
| EHS-OBS-156 | API — Only likelihood | PASS |  |
| EHS-OBS-157 | Triage → Accept & assign — Categories cleared | PASS |  |
| EHS-OBS-158 | Triage → Accept & assign — IS 3786 code | PASS |  |
| EHS-OBS-159 | Triage → Accept & assign — Employer involved | PASS |  |
| EHS-OBS-160 | Triage → Accept & assign — No action | PASS |  |
| EHS-OBS-161 | Triage → Accept & assign — Action owner (suggested) | PASS | browser |
| EHS-OBS-162 | Triage → Accept & assign — Valid assign | PASS |  |
| EHS-OBS-163 | Triage → Accept & assign — Two actions | PASS |  |
| EHS-OBS-164 | Triage → Accept & assign — Extreme band without interim control | PASS |  |
| EHS-OBS-165 | Triage → Accept & assign — Danger-now report without interim control | PASS |  |
| EHS-OBS-166 | Triage → Accept & assign — Extreme with interim control | PASS |  |
| EHS-OBS-167 | Triage — Fixed on the spot | PASS |  |
| EHS-OBS-168 | Triage — Return with question (empty) | PASS |  |
| EHS-OBS-169 | Triage — Return with question | PASS |  |
| EHS-OBS-170 | Report detail → Reply — Reply (text + photo) | PASS |  |
| EHS-OBS-171 | API — Reply when not returned | PASS |  |
| EHS-OBS-172 | Triage — Reviewed, no action (no reason) | PASS |  |
| EHS-OBS-173 | Triage — Reviewed, no action | PASS |  |
| EHS-OBS-174 | Triage — Discard | PASS |  |
| EHS-OBS-175 | Triage — Merge into duplicate | PASS |  |
| EHS-OBS-176 | Triage — Merge into a closed report | PASS |  |
| EHS-OBS-177 | Triage — Merge into another plant's report | PASS |  |
| EHS-OBS-178 | Triage — Merge into itself | PASS |  |
| EHS-OBS-179 | Triage — Escalate to incident | PASS |  |
| EHS-OBS-180 | Triage — Escalate after assignment | PASS |  |
| EHS-OBS-181 | API — Unknown decision | PASS |  |
| EHS-OBS-182 | API — Triage twice by mistake | PASS |  |
| EHS-OBS-183 | API — Second triage by someone else | PASS |  |
| EHS-OBS-184 | Reports → Triage — Triage deadline | PASS |  |
| EHS-OBS-190 | Report → Saved — "Score risk and assign owner now" | PASS | browser |
| EHS-OBS-191 | Report → Saved — Button hidden | PASS | browser |
| EHS-OBS-192 | Report → Saved — Button hidden | PASS | browser |
| EHS-OBS-193 | Report → Saved — Button at another site | Not automated | Manual check: needs a user who is officer at one site and reporter at another |
| EHS-OBS-194 | Report → Saved → Triage sheet — Assign online | PASS | browser |
| EHS-OBS-195 | Report → Saved → Triage sheet — Assign offline | PASS |  |
| EHS-OBS-196 | Triage sheet — Cancel | PASS | browser |
| EHS-OBS-197 | Triage sheet — Other decisions | PASS | browser |
| EHS-OBS-200 | Report detail → Comment — Comment box | PASS |  |
| EHS-OBS-201 | Report detail → Comment — Comment box | PASS |  |
| EHS-OBS-202 | API — Comment on someone else's report | PASS |  |
| EHS-OBS-203 | Report detail → Comment — Comment over 2,000 characters | PASS |  |
| EHS-OBS-204 | Report detail → Reopen — Reopen a closed report | PASS |  |
| EHS-OBS-205 | Report detail → Reopen — No reason | PASS |  |
| EHS-OBS-206 | API — Reopen | PASS |  |
| EHS-OBS-207 | API — Reopen an open report | PASS |  |
| EHS-OBS-208 | Notifications → danger alert — Acknowledge | PASS |  |
| EHS-OBS-209 | Danger alert — Not acknowledged | PASS |  |
| EHS-OBS-210 | API — Acknowledge a danger alert ⚠ F8 | PASS |  |
| EHS-OBS-211 | Report detail → Closure summary — Edit summary on a closed report | PASS |  |
| EHS-OBS-212 | API — Closure summary on an open report | PASS |  |
| EHS-OBS-213 | Notifications — Closure notice | PASS |  |
| EHS-OBS-220 | Console → Observations — Table | PASS | browser |
| EHS-OBS-221 | Console → Observations — Sort by column | PASS |  |
| EHS-OBS-222 | Console → Observations — Paging | PASS |  |
| EHS-OBS-223 | Console → Observations — Filter: status, type, band, channel, area, employer, from/to dates | PASS |  |
| EHS-OBS-224 | Console → Observations — Filters in the address | PASS | browser |
| EHS-OBS-225 | Console → Observations — Search | PASS |  |
| EHS-OBS-226 | Console → Observations — Keyboard j / k / Enter | PASS | browser |
| EHS-OBS-227 | Console → Observations → drawer — Triage from the console | PASS | browser |
| EHS-OBS-228 | Console → Observations — CSV button | PASS |  |
| EHS-OBS-229 | Console → Observations — Excel button (2.1) | PASS |  |
| EHS-OBS-230 | Console → Observations — Read-only | PASS | browser |
| EHS-OBS-231 | Console → Observations — Site scope | PASS | browser |
| EHS-OBS-232 | Console → top bar — Jump to case number | PASS | browser |
| EHS-OBS-233 | Outbox — Automatic retry after a failed send | PASS | browser |
| EHS-ACT-001 | Actions — Tabs | PASS | browser |
| EHS-ACT-002 | Actions — Department tab (2.1) | PASS | browser |
| EHS-ACT-003 | Actions → Mine — List order | PASS | browser |
| EHS-ACT-004 | Actions → Mine — Mine count | PASS | browser |
| EHS-ACT-005 | Actions — To verify tab | PASS | browser |
| EHS-ACT-006 | Actions — Site tab | PASS | browser |
| EHS-ACT-007 | Actions — "Open only" chip | PASS | browser |
| EHS-ACT-008 | Actions — Status chips | PASS | browser |
| EHS-ACT-009 | Actions — Band chips | PASS | browser |
| EHS-ACT-010 | Actions — Search | PASS | browser |
| EHS-ACT-011 | Actions — Action row | PASS | browser |
| EHS-ACT-012 | Actions → Department — Department list online | PASS |  |
| EHS-ACT-013 | Actions → Department — Department list offline | PASS | browser |
| EHS-ACT-014 | Action detail (department) — Buttons on someone else's action | PASS |  |
| EHS-ACT-015 | API — Department action of another department | PASS |  |
| EHS-ACT-016 | API — `?department=1` | PASS |  |
| EHS-ACT-017 | API — Someone else's action, no department link | PASS |  |
| EHS-ACT-018 | API — Other plant's action | PASS |  |
| EHS-ACT-019 | API — Other plant in the filter | PASS |  |
| EHS-ACT-020 | API — `departmentId` filter | PASS |  |
| EHS-ACT-030 | Action detail — Start button | PASS |  |
| EHS-ACT-031 | Action detail — Start on a reopened action | PASS |  |
| EHS-ACT-032 | API — Start an in-progress action | PASS |  |
| EHS-ACT-033 | API — Start someone else's action | PASS |  |
| EHS-ACT-034 | Action detail (offline) — Start while offline | PASS | browser |
| EHS-ACT-040 | Action detail → Complete — Complete sheet | PASS | browser |
| EHS-ACT-041 | Complete — No after-photo | PASS |  |
| EHS-ACT-042 | Complete — Note too short | PASS | browser |
| EHS-ACT-043 | API — Empty note | PASS |  |
| EHS-ACT-044 | API — Empty cause | PASS |  |
| EHS-ACT-045 | Complete — Valid | PASS |  |
| EHS-ACT-046 | Complete — 10 after-photos | PASS |  |
| EHS-ACT-047 | API — 11 after-photos | PASS |  |
| EHS-ACT-048 | API — Note 2,001 characters | PASS |  |
| EHS-ACT-049 | Complete — Complete directly from Open | PASS |  |
| EHS-ACT-050 | Complete — Complete a disputed action | PASS |  |
| EHS-ACT-051 | API — Complete a verified action | PASS |  |
| EHS-ACT-052 | API — Complete someone else's action | PASS |  |
| EHS-ACT-053 | Complete (offline) — Complete offline with photo | PASS | browser |
| EHS-ACT-054 | Complete — Same completion sent twice | PASS |  |
| EHS-ACT-060 | Actions → To verify → detail — Verify sheet | PASS | browser |
| EHS-ACT-061 | Verify — Effective | PASS |  |
| EHS-ACT-062 | Verify — Report closes when every action is verified | PASS |  |
| EHS-ACT-063 | Verify — Report stays open with other actions | PASS |  |
| EHS-ACT-064 | Verify — Not effective without reason | PASS |  |
| EHS-ACT-065 | Verify — Not effective with reason | PASS |  |
| EHS-ACT-066 | Verify — Evidence photo | PASS |  |
| EHS-ACT-067 | API — Owner verifies own action | PASS |  |
| EHS-ACT-068 | API — Completer verifies | PASS |  |
| EHS-ACT-069 | API — Worker verifies | PASS |  |
| EHS-ACT-070 | API — Owner role verifies another's action | PASS |  |
| EHS-ACT-071 | Verify — Officer verifies | PASS |  |
| EHS-ACT-072 | Verify — HSE verifies at any site | PASS |  |
| EHS-ACT-073 | API — Verify an open action | PASS |  |
| EHS-ACT-074 | API — Verify another plant's action | PASS |  |
| EHS-ACT-075 | API — Verify twice | PASS |  |
| EHS-ACT-076 | API — Admin verifies | PASS |  |
| EHS-ACT-077 | Verify — Verify within the band's time | PASS |  |
| EHS-ACT-080 | Action detail → Request new date — Date picker, Reason | PASS |  |
| EHS-ACT-081 | API — Date change without a date | PASS |  |
| EHS-ACT-082 | Request new date — Date in the past ⚠ F20 | PASS |  |
| EHS-ACT-083 | API — Second request while one is pending | PASS |  |
| EHS-ACT-084 | Action detail → Requests — Approve date change | PASS |  |
| EHS-ACT-085 | Action detail → Requests — Reject date change | PASS |  |
| EHS-ACT-086 | Requests — Third date change goes to the site head | PASS |  |
| EHS-ACT-087 | Requests — Owner is a safety officer | PASS |  |
| EHS-ACT-088 | API — Decide own action's request | PASS |  |
| EHS-ACT-089 | API — Decide twice | PASS |  |
| EHS-ACT-090 | Action detail → Dispute — Reason | PASS |  |
| EHS-ACT-091 | Requests — Approve dispute without new owner | PASS |  |
| EHS-ACT-092 | Requests — Approve dispute with new owner | PASS |  |
| EHS-ACT-093 | Requests — Reject dispute | PASS |  |
| EHS-ACT-094 | Requests — Approve dispute to the same owner | PASS |  |
| EHS-ACT-095 | Requests — New owner from another site | PASS |  |
| EHS-ACT-096 | API — Request on someone else's action | PASS |  |
| EHS-ACT-100 | Action detail → Reassign — New owner, Reason | PASS |  |
| EHS-ACT-101 | Reassign — Same owner | PASS |  |
| EHS-ACT-102 | Reassign — Owner from another site | PASS |  |
| EHS-ACT-103 | Reassign — Verified action | PASS |  |
| EHS-ACT-104 | Reassign — Disputed action | PASS |  |
| EHS-ACT-105 | API — Owner reassigns | PASS |  |
| EHS-ACT-106 | Action detail → Cancel — Approver dropdown, Reason | PASS |  |
| EHS-ACT-107 | Cancel — Approver is not a site head | PASS |  |
| EHS-ACT-108 | Cancel — Approver from another site | PASS |  |
| EHS-ACT-109 | Cancel — Cancel a verified action | PASS |  |
| EHS-ACT-110 | Cancel — Cancelled action in charts | PASS |  |
| EHS-ACT-111 | Console → Actions → New action — Manual action | PASS |  |
| EHS-ACT-112 | New action — No band | PASS |  |
| EHS-ACT-113 | New action — Extreme without interim control | PASS |  |
| EHS-ACT-114 | New action — Owner from another site | PASS |  |
| EHS-ACT-115 | API — Owner creates an action | PASS |  |
| EHS-ACT-116 | API — Action linked to another plant's report | PASS |  |
| EHS-ACT-117 | Action detail → Comment — Text comment | PASS |  |
| EHS-ACT-118 | Comment — Photo-only comment | PASS |  |
| EHS-ACT-119 | Comment — Empty comment | PASS |  |
| EHS-ACT-130 | Reminder job — 7 days before due | PASS |  |
| EHS-ACT-131 | Reminder job — 3 days before due | PASS |  |
| EHS-ACT-132 | Reminder job — Due day | PASS |  |
| EHS-ACT-133 | Escalation job — 1 day overdue | PASS |  |
| EHS-ACT-134 | Escalation job — 3 days overdue | PASS |  |
| EHS-ACT-135 | Escalation job — Extreme ladder | PASS |  |
| EHS-ACT-136 | Escalation job — Completed before due | PASS |  |
| EHS-ACT-137 | Escalation job — Paused by a dispute | PASS |  |
| EHS-ACT-138 | Escalation job — Quiet hours | PASS |  |
| EHS-ACT-139 | Escalation job — Daily push limit | PASS |  |
| EHS-ACT-140 | Console → Due dates → Ladder — Edit a ladder step | PASS |  |
| EHS-ACT-141 | Email outbox — No email server | PASS |  |
| EHS-ACT-142 | Escalation job — Two server processes | PASS |  |
| EHS-ACT-150 | Console → Actions — Table | PASS | browser |
| EHS-ACT-151 | Console → Actions — Sort | PASS | browser |
| EHS-ACT-152 | Console → Actions — Filter: status, band, owner, overdue, from/to | PASS | browser |
| EHS-ACT-153 | Console → Actions → drawer — Detail drawer | PASS | browser |
| EHS-ACT-154 | Console → Actions — CSV export | PASS |  |
| EHS-ACT-155 | Console → Actions — Excel export (2.1) | PASS |  |
| EHS-ACT-156 | Console → Actions — Read-only | PASS | browser |
| EHS-ACT-157 | Console → Attention — Overdue Extreme | PASS | browser |
| EHS-INS-001 | Console → Templates — New template | PASS |  |
| EHS-INS-002 | Templates — Code with a space | PASS |  |
| EHS-INS-003 | Templates — Code 41 characters | PASS |  |
| EHS-INS-004 | Templates — Duplicate code | PASS |  |
| EHS-INS-005 | Templates → Builder — Add section | PASS |  |
| EHS-INS-006 | Builder — Repeatable section | PASS |  |
| EHS-INS-007 | Builder — Question type pass/fail/N.A. | PASS |  |
| EHS-INS-008 | Builder — Question type number | PASS |  |
| EHS-INS-009 | Builder — Question type text | PASS |  |
| EHS-INS-010 | Builder — Question type photo | PASS |  |
| EHS-INS-011 | Builder — Question type signature | PASS |  |
| EHS-INS-012 | Builder — Question type date | PASS |  |
| EHS-INS-013 | Builder — Single choice with options | PASS |  |
| EHS-INS-014 | Builder — Multiple choice | PASS |  |
| EHS-INS-015 | Builder — Show-if rule | PASS |  |
| EHS-INS-016 | Builder — Not required | PASS |  |
| EHS-INS-017 | Builder — Action on fail off | PASS |  |
| EHS-INS-018 | Builder — Reference text and status label | PASS |  |
| EHS-INS-019 | Builder — Scoring | PASS |  |
| EHS-INS-020 | Templates → Version — Submit for review | PASS |  |
| EHS-INS-021 | Templates → Version — Author approves own version | PASS |  |
| EHS-INS-022 | Templates → Version — Approve | PASS |  |
| EHS-INS-023 | Templates → Version — Edit an active version | PASS |  |
| EHS-INS-024 | Templates → Version — New version | PASS |  |
| EHS-INS-025 | Templates → Version — Retire | PASS |  |
| EHS-INS-026 | Templates — Copy for my site | PASS |  |
| EHS-INS-027 | API — Create a company template | PASS |  |
| EHS-INS-028 | Templates — Read-only | PASS |  |
| EHS-INS-029 | Templates — Delete a template | PASS |  |
| EHS-INS-040 | Console → Schedules — New schedule | PASS |  |
| EHS-INS-041 | Schedules — Frequency incomplete | PASS |  |
| EHS-INS-042 | Schedules — Negative lead days | PASS |  |
| EHS-INS-043 | API — Schedule at another plant | PASS |  |
| EHS-INS-044 | Schedules — Assign to a person | PASS |  |
| EHS-INS-045 | Schedules — Assign to a role | PASS |  |
| EHS-INS-046 | Schedules — Pause | PASS |  |
| EHS-INS-047 | Inspection scheduler — Missed run | PASS |  |
| EHS-INS-048 | Inspection scheduler — No duplicates | PASS |  |
| EHS-INS-060 | Inspections — Due list | PASS |  |
| EHS-INS-061 | Inspections → Start spot inspection — Template list | PASS | browser |
| EHS-INS-062 | API — Start on a retired version | PASS |  |
| EHS-INS-063 | Scan — QR on equipment | PASS |  |
| EHS-INS-064 | Run — Pass answer | PASS |  |
| EHS-INS-065 | Run — Fail answer | PASS |  |
| EHS-INS-066 | Run — N.A. answer | PASS |  |
| EHS-INS-067 | Run — Number below range | PASS |  |
| EHS-INS-068 | Run — Number not a number ⚠ F21 | PASS |  |
| EHS-INS-069 | Run — Repeatable section | PASS |  |
| EHS-INS-070 | Run — Signature | PASS | browser |
| EHS-INS-071 | Run — Submit with a required question unanswered | PASS |  |
| EHS-INS-072 | Run — Submit with a failed item without action | PASS |  |
| EHS-INS-073 | Run — Submit valid | PASS |  |
| EHS-INS-074 | Run — Equipment tag "Do not use" | PASS |  |
| EHS-INS-075 | Run — Equipment tag "In service" | PASS |  |
| EHS-INS-076 | Run — Repeat finding | PASS |  |
| EHS-INS-077 | API — Answer someone else's run | PASS |  |
| EHS-INS-078 | API — Unknown question | PASS |  |
| EHS-INS-079 | Run (offline) — Whole run offline | Not automated | Manual check: a whole inspection run in airplane mode (parts covered by EHS-OBS-084 and EHS-ACT-034/053) |
| EHS-INS-080 | Run — Late answers | PASS |  |
| EHS-INS-081 | Run detail — Report link | PASS |  |
| EHS-INS-082 | Report link — Expired report link | PASS |  |
| EHS-INS-083 | Report link — Report link passed to another person | PASS |  |
| EHS-INS-084 | Run detail — Reopen a completed run | PASS |  |
| EHS-INS-085 | Run detail — Reopen without reason | PASS |  |
| EHS-INS-086 | Run detail — Cancel a scheduled run | PASS |  |
| EHS-INS-087 | Run detail — Cancel a completed run | PASS |  |
| EHS-INS-088 | API — Cancel a run | PASS |  |
| EHS-INS-089 | API — Run at another plant | PASS |  |
| EHS-INS-100 | Console → Inspections — Table | PASS | browser |
| EHS-INS-101 | Console → Inspections — Filter: status, from/to | PASS | browser |
| EHS-INS-102 | Console → Inspections — CSV and Excel export | PASS |  |
| EHS-INS-103 | Console → Inspections — Read-only | PASS | browser |
| EHS-RPT-001 | API — Observations CSV | PASS |  |
| EHS-RPT-002 | API — Observations Excel | PASS |  |
| EHS-RPT-003 | API — Actions CSV | PASS |  |
| EHS-RPT-004 | API — Actions Excel | PASS |  |
| EHS-RPT-005 | API — Inspections CSV | PASS |  |
| EHS-RPT-006 | API — Inspections Excel | PASS |  |
| EHS-RPT-007 | API — Full report | PASS |  |
| EHS-RPT-008 | API — Unknown list | PASS |  |
| EHS-RPT-009 | API — Unknown format | PASS |  |
| EHS-RPT-010 | API — Any export | PASS |  |
| EHS-RPT-011 | API — Any export | PASS |  |
| EHS-RPT-012 | API — Any export ⚠ F4 | PASS |  |
| EHS-RPT-013 | API — Any export | PASS |  |
| EHS-RPT-014 | API — Export another plant | PASS |  |
| EHS-RPT-015 | Exports — Filters respected | PASS |  |
| EHS-RPT-016 | Exports — Hourly limit | PASS |  |
| EHS-RPT-017 | Exports — Audit trail | PASS |  |
| EHS-RPT-018 | Excel file — Header row | PASS |  |
| EHS-RPT-019 | Excel file — Dates | PASS |  |
| EHS-RPT-020 | Excel file — Yes/No values | PASS |  |
| EHS-RPT-021 | Excel file — Very long text | PASS |  |
| EHS-RPT-022 | Excel file — Hidden control characters | PASS |  |
| EHS-RPT-023 | Excel file — Text that looks like a formula | PASS |  |
| EHS-RPT-024 | CSV file — Text that looks like a formula ⚠ F9 | PASS |  |
| EHS-RPT-025 | Exports — 50,000-row cap | PASS |  |
| EHS-RPT-026 | Exports — Excel in LibreOffice and Google Sheets | PASS |  |
| EHS-RPT-027 | Console → Dashboard — Export view (CSV) | PASS | browser |
| EHS-RPT-028 | Field app → Charts — Excel button | PASS | browser |
| EHS-RPT-029 | Console → config tables — Export CSV (contractors, people, departments) | PASS | browser |
| EHS-RPT-040 | Notifications — New report alert | PASS |  |
| EHS-RPT-041 | Notifications — Assigned alert | PASS |  |
| EHS-RPT-042 | Notifications — Notification language | PASS |  |
| EHS-RPT-043 | Settings → Push — Enable push | Not automated | Needs a real push service (browser push to a phone) |
| EHS-RPT-044 | Daily digest — Daily email | PASS |  |
| EHS-RPT-045 | Weekly digest — Weekly email | PASS |  |
| EHS-RPT-046 | Console → Notifications log — Log | PASS |  |
| EHS-RPT-047 | Console → Notifications log — Log | PASS |  |
| EHS-RPT-048 | Notifications log — Failed push without keys | PASS |  |
| EHS-RPT-049 | Notifications log — Filter by status | PASS |  |
| EHS-RPT-050 | Scheduled custom reports by email — — | Not automated | Checks that a feature is absent (gap 1.4); not automated |
| EHS-RPT-051 | Custom report builder — — | Not automated | Checks that a feature is absent (gap 1.4); not automated |
| EHS-ADM-001 | Console → Sites → New site — Code, Name, State, District, Type | PASS |  |
| EHS-ADM-002 | New site — Code in lowercase | PASS |  |
| EHS-ADM-003 | New site — Code 1 character | PASS |  |
| EHS-ADM-004 | New site — Code 7 characters | PASS |  |
| EHS-ADM-005 | New site — Duplicate code | PASS |  |
| EHS-ADM-006 | New site — Name empty | PASS |  |
| EHS-ADM-007 | Sites → KA9 → Set up — Industry dropdown (step 2) | PASS |  |
| EHS-ADM-008 | Set up — Run set-up twice | PASS |  |
| EHS-ADM-009 | API — Unknown industry | PASS |  |
| EHS-ADM-010 | Sites → Edit — Worker count, working calendar | PASS |  |
| EHS-ADM-011 | Sites → Edit — Site head | PASS |  |
| EHS-ADM-012 | Sites → Delete — Delete without reason | PASS |  |
| EHS-ADM-013 | Sites → Delete — Delete with reason | PASS |  |
| EHS-ADM-014 | API — Create a site | PASS |  |
| EHS-ADM-015 | Sites → Risk matrix — Assign matrix version to a site | PASS |  |
| EHS-ADM-016 | Sites → Rule set — Assign a draft rule pack | PASS |  |
| EHS-ADM-017 | Sites → Rule set — Assign a disabled rule set | PASS |  |
| EHS-ADM-018 | Sites — Site list | PASS |  |
| EHS-ADM-019 | Sites → TN1 → Areas — Add area | PASS |  |
| EHS-ADM-020 | API — Add area at another plant | PASS |  |
| EHS-ADM-021 | Areas — Edit area owner | PASS |  |
| EHS-ADM-022 | Areas — Parent area | PASS |  |
| EHS-ADM-023 | Areas → Delete — Delete with reason | PASS |  |
| EHS-ADM-024 | Areas → Import CSV — Valid file | PASS |  |
| EHS-ADM-025 | Areas → Import CSV — Wrong header | PASS |  |
| EHS-ADM-026 | Areas → Import CSV — Same file twice | PASS |  |
| EHS-ADM-027 | Sites & areas — Read-only | PASS |  |
| EHS-ADM-040 | Console → Equipment → Add — Site, Class, Tag no., Make/model, Safe working load | PASS |  |
| EHS-ADM-041 | Add equipment — No site | PASS |  |
| EHS-ADM-042 | Add equipment — Duplicate tag | PASS |  |
| EHS-ADM-043 | API — Equipment at another plant | PASS |  |
| EHS-ADM-044 | Equipment → Import CSV — Valid file | PASS |  |
| EHS-ADM-045 | Equipment → Import CSV — Unknown site code | PASS |  |
| EHS-ADM-046 | Equipment — Next examination due | PASS |  |
| EHS-ADM-047 | Console → QR codes — New QR for equipment | PASS |  |
| EHS-ADM-048 | QR codes — Poster | PASS |  |
| EHS-ADM-049 | QR codes — Poster link reused later | PASS |  |
| EHS-ADM-050 | QR codes — Rotate | PASS |  |
| EHS-ADM-051 | QR codes — Disable | PASS |  |
| EHS-ADM-052 | API — QR at another plant | PASS |  |
| EHS-ADM-060 | People → Add — Name, Phone, Employer, Trade, Worker type, Language, Department (2.1) | PASS |  |
| EHS-ADM-061 | People → Add — Bad phone | PASS | browser |
| EHS-ADM-062 | People → Add — Unknown department | PASS |  |
| EHS-ADM-063 | People → Import CSV — Valid file | PASS |  |
| EHS-ADM-064 | People → Import CSV — Unknown employer | PASS |  |
| EHS-ADM-065 | People → Delete — Delete with reason | PASS |  |
| EHS-ADM-066 | API — Change a person | PASS |  |
| EHS-ADM-067 | Contractors → Add — Name, Registration, Contact, Phone, Email, Trades, Sites | PASS |  |
| EHS-ADM-068 | Contractors → Add — Duplicate name | PASS |  |
| EHS-ADM-069 | Contractors → Add — Bad email | PASS |  |
| EHS-ADM-070 | Contractors — Sub-contractor | PASS |  |
| EHS-ADM-071 | Contractors — Own company row | PASS | browser |
| EHS-ADM-072 | Contractors → Remove — Remove with Undo | PASS |  |
| EHS-ADM-073 | Departments (2.1) → Add — Code, Names (4 languages), Order | PASS |  |
| EHS-ADM-074 | Departments → Add — Duplicate code | PASS |  |
| EHS-ADM-075 | Departments → Add — Code with a space | PASS |  |
| EHS-ADM-076 | Departments → Add — English name empty | PASS |  |
| EHS-ADM-077 | Departments → Edit — Inactive | PASS |  |
| EHS-ADM-078 | Departments → Remove — Remove | PASS |  |
| EHS-ADM-079 | Departments — Read-only for officers | PASS |  |
| EHS-ADM-090 | Users → New user — Employee-code login | PASS |  |
| EHS-ADM-091 | New user — Email login | PASS |  |
| EHS-ADM-092 | New user — Enrolment-code login | PASS |  |
| EHS-ADM-093 | New user — Email login without email | PASS |  |
| EHS-ADM-094 | New user — Code login without code | PASS |  |
| EHS-ADM-095 | New user — Duplicate code | PASS |  |
| EHS-ADM-096 | New user — Duplicate email | PASS |  |
| EHS-ADM-097 | New user — Bad email | PASS |  |
| EHS-ADM-098 | New user — No role | PASS | browser |
| EHS-ADM-099 | API — Site role for all sites | PASS |  |
| EHS-ADM-100 | API — Unknown role | PASS |  |
| EHS-ADM-101 | New user — Auditor | PASS |  |
| EHS-ADM-102 | Users → Edit — Change roles | PASS |  |
| EHS-ADM-103 | Users → Edit — Change department (2.1) | PASS |  |
| EHS-ADM-104 | Users → Suspend — Suspend with reason | PASS |  |
| EHS-ADM-105 | Users → Reactivate — Reactivate | PASS |  |
| EHS-ADM-106 | Users → Deactivate — Deactivate with Undo | PASS | browser |
| EHS-ADM-107 | Users — Search and filters | PASS |  |
| EHS-ADM-108 | Users → detail — Devices | PASS |  |
| EHS-ADM-109 | Users → Import CSV — Valid file | PASS |  |
| EHS-ADM-110 | Users → Import CSV — Missing role | PASS |  |
| EHS-ADM-111 | Users → Import CSV — Unknown site | PASS |  |
| EHS-ADM-112 | Users → Import CSV — Unknown department (2.1) | PASS |  |
| EHS-ADM-113 | Users → Import CSV — Existing code | PASS |  |
| EHS-ADM-114 | Users — Read users | PASS |  |
| EHS-ADM-115 | API — Create a user | PASS |  |
| EHS-ADM-116 | Console menu — Users menu | PASS | browser |
| EHS-ADM-117 | API — List users | PASS |  |
| EHS-ADM-130 | Categories → Add — Code, Names, Icon, Critical capable, Default IS 3786 | PASS |  |
| EHS-ADM-131 | Categories → Add — Empty code | PASS |  |
| EHS-ADM-132 | Categories → Add — Duplicate code | PASS |  |
| EHS-ADM-133 | Categories — Extra field | PASS |  |
| EHS-ADM-134 | Categories — Reorder | PASS |  |
| EHS-ADM-135 | Categories — Delete | PASS |  |
| EHS-ADM-136 | API — Change categories | PASS |  |
| EHS-ADM-137 | Risk matrix → New version — 5×5 labels | PASS |  |
| EHS-ADM-138 | Risk matrix — Edit active version | PASS |  |
| EHS-ADM-139 | Risk matrix — Author activates own version | PASS |  |
| EHS-ADM-140 | Risk matrix — Activate | PASS |  |
| EHS-ADM-141 | Due dates — Change a rule | PASS |  |
| EHS-ADM-142 | Due dates — Site-specific rule | PASS |  |
| EHS-ADM-143 | Due dates — Invalid value | PASS |  |
| EHS-ADM-144 | Ladders — Edit a step | PASS |  |
| EHS-ADM-145 | Rule sets — Enable a draft pack without reviewer | PASS |  |
| EHS-ADM-146 | Rule sets — Enable a pack with an unreviewed timer | PASS |  |
| EHS-ADM-147 | Rule sets — Status labels | PASS |  |
| EHS-ADM-148 | Rule sets — Disable | PASS |  |
| EHS-ADM-200 | Languages — Search a text | PASS |  |
| EHS-ADM-201 | Languages — Override a text | PASS |  |
| EHS-ADM-202 | Languages → Import — Valid file | PASS |  |
| EHS-ADM-203 | Languages → Import — Bad shape | PASS |  |
| EHS-ADM-204 | API — Change a text | PASS |  |
| EHS-ADM-210 | Settings — Company name | PASS |  |
| EHS-ADM-211 | Settings — Empty company name | PASS |  |
| EHS-ADM-212 | Settings — Two-step code roles | PASS |  |
| EHS-ADM-213 | Settings — Triage time limit, danger acknowledgement minutes, percent-safe minimum, max photos, dispute pause days, date changes before site head | PASS |  |
| EHS-ADM-214 | Settings — Safety fields | PASS |  |
| EHS-ADM-215 | Settings — Company fields | PASS |  |
| EHS-ADM-216 | API — Settings | PASS |  |
| EHS-ADM-220 | Privacy → Notices — Publish a new version | PASS |  |
| EHS-ADM-221 | Privacy → Notices — No English text | PASS |  |
| EHS-ADM-222 | Privacy → Requests — Record a request | PASS |  |
| EHS-ADM-223 | API — Privacy requests | PASS |  |
| EHS-ADM-230 | Retention — Policies | PASS |  |
| EHS-ADM-231 | Retention — Dry run | PASS |  |
| EHS-ADM-232 | Retention → Legal hold — Place a hold | PASS |  |
| EHS-ADM-233 | Retention → Legal hold — Release | PASS |  |
| EHS-ADM-234 | API — Retention | PASS |  |
| EHS-ADM-240 | Health — Page | PASS |  |
| EHS-ADM-250 | Audit log — List | PASS |  |
| EHS-ADM-251 | Audit log — Filters | PASS |  |
| EHS-ADM-252 | Audit log — Site scope | PASS |  |
| EHS-ADM-253 | Audit log — Read | PASS |  |
| EHS-ADM-254 | Audit log — Verify chain | PASS |  |
| EHS-ADM-255 | Audit log — Tampering | PASS |  |
| EHS-ADM-256 | API — Edit or delete an audit row | PASS |  |
| EHS-ADM-257 | Audit log — Sensitive data | PASS |  |
| EHS-ADM-258 | Audit log — Every write is logged | PASS |  |
| EHS-ADM-260 | Notifications log — Open | PASS |  |
| EHS-ADM-261 | Notifications log — Open | PASS |  |
| EHS-ADM-262 | Console menu → Notifications log ⚠ F5 — Menu item | PASS |  |
| EHS-ADM-290 | Console menu → Health ⚠ F6 — Menu item | PASS |  |
| EHS-WF1-01 | Field app → Report — Unsafe condition + 1 photo | PASS |  |
| EHS-WF1-02 | Notifications — New report alert | PASS |  |
| EHS-WF1-03 | Console → Dashboard — Triage backlog | PASS |  |
| EHS-WF1-04 | Triage → Accept & assign — Matrix L3 × S4, owner `OWN-TN1-1`, interim control | PASS |  |
| EHS-WF1-05 | Actions → Mine — New action | PASS |  |
| EHS-WF1-06 | Actions → Department — Department tab (2.1) | PASS |  |
| EHS-WF1-07 | Action detail — Start | PASS |  |
| EHS-WF1-08 | Action detail → Complete — After photo, note, cause | PASS |  |
| EHS-WF1-09 | Verify — Before/after, Effective | PASS |  |
| EHS-WF1-10 | Report — Closure | PASS |  |
| EHS-WF1-11 | Dashboard — Figures | PASS |  |
| EHS-WF1-12 | Charts → Mine / Department / Site — Figures (2.1) | PASS |  |
| EHS-WF1-13 | Audit log — Trail | PASS |  |
| EHS-WF1-14 | Verify → Not effective (variant) — Repeat the flow; at step 9 choose Not effective with reason. | PASS |  |
| EHS-WF2-01 | Action set-up — Moderate action | PASS |  |
| EHS-WF2-02 | Ladder job — 7 days, 3 days, due day | PASS |  |
| EHS-WF2-03 | Ladder job — 1 day overdue | PASS |  |
| EHS-WF2-04 | Ladder job — 3 days overdue | PASS |  |
| EHS-WF2-05 | Email — Email content | PASS |  |
| EHS-WF2-06 | Ladder job — Each step once | PASS |  |
| EHS-WF2-07 | Attention / Dashboard — Overdue figures | PASS |  |
| EHS-WF2-08 | Complete late — Complete after the due date | PASS |  |
| EHS-WF2-09 | Extreme ladder (variant) — Extreme action | PASS |  |
| EHS-WF2-10 | No email server (variant) — SMTP not set | PASS |  |
| EHS-WF3-01 | API — Report detail | PASS |  |
| EHS-WF3-02 | API — Report triage | PASS |  |
| EHS-WF3-03 | API — Report comment | PASS |  |
| EHS-WF3-04 | API — Report duplicates | PASS |  |
| EHS-WF3-05 | API — Action detail | PASS |  |
| EHS-WF3-06 | API — Action reassign / cancel / decide | PASS |  |
| EHS-WF3-07 | API — Inspection run | PASS |  |
| EHS-WF3-08 | API — Media | PASS |  |
| EHS-WF3-09 | Signed link — A TN2 link used for another record | PASS |  |
| EHS-WF3-10 | API — List filters | PASS |  |
| EHS-WF3-11 | API — Dashboard, charts, exports | PASS |  |
| EHS-WF3-12 | API — Sync pull | PASS |  |
| EHS-WF3-13 | API — Sync push into TN2 | PASS |  |
| EHS-WF3-14 | API — Admin areas, equipment, QR, schedules | PASS |  |
| EHS-WF3-15 | API — Audit log | PASS |  |
| EHS-WF3-16 | Console — Site dropdown and URL | PASS | browser |
| EHS-WF3-17 | API — Another worker's report at the same plant | PASS |  |
| EHS-WF3-18 | API — Department action at another plant | PASS |  |
| EHS-WF3-19 | API — Guessing case numbers | PASS |  |
| EHS-WF3-20 | API — All sites | PASS |  |
| EHS-WF4-01 | Report — Danger now | PASS |  |
| EHS-WF4-02 | Alert — No acknowledgement | PASS |  |
| EHS-WF4-03 | Alert — Acknowledge | PASS |  |
| EHS-WF4-04 | Triage — Interim control required | PASS |  |
| EHS-WF4-05 | Dashboard — Critical acknowledgement median | PASS |  |
| EHS-WF5-01 | Action → Dispute — Reason "Electrical job" | PASS |  |
| EHS-WF5-02 | Requests → Approve — New owner `OWN-TN1-2` (Electrical) | PASS |  |
| EHS-WF5-03 | Actions → Department — List | PASS |  |
| EHS-WF5-04 | Charts → Site → By department — Table | PASS |  |
| EHS-WF6-01 | Templates — New version | PASS |  |
| EHS-WF6-02 | Templates — Self-approve | PASS |  |
| EHS-WF6-03 | Templates — Approve | PASS |  |
| EHS-WF6-04 | Field app — Next run | PASS |  |
| EHS-WF7-01 | QR form — Report | PASS |  |
| EHS-WF7-02 | Triage — Assign | PASS |  |
| EHS-WF7-03 | Status link — Status | PASS |  |
| EHS-WF8-01 | Users — Create auditor | PASS |  |
| EHS-WF8-02 | Console — Read and export | PASS |  |
| EHS-WF8-03 | Console — After expiry | PASS |  |
| EHS-WF8-04 | Audit log — Auditor trail | PASS |  |

## Browser run (`e2e-real.cjs`: field app 390×844, QR form, admin console 1280×800)

**84 of 84 checks passed.** It covers the screens behind many of the "not automated" UI cases above (quick report online and offline, outbox, triage sheet, completion with after-photo, verification, QR form in Tamil, console MFA, site set-up, posters, user import, template approval, audit-chain verify, language switch, site isolation).

| Check | Result |
|---|---|
| 1. quick report: case number appears after sync | PASS |
| 1. photo uploaded with SHA-256 match | PASS |
| 1. offline submit shows a pending number | PASS |
| 1. outbox shows the report as pending | PASS |
| 1. back online: outbox synced | PASS |
| 1. anonymous report: mine, no reporter name | PASS |
| 1. offline photo uploaded with SHA-256 match | PASS |
| 1. anonymous report stores no reporter id | PASS |
| 1: no console errors or failed requests [WORKER-TN1-1] | PASS |
| 2. triage accept_assign saved | PASS |
| 2. action created for OWN-TN1-1 | PASS |
| 2. second report created (API, WORKER-TN1-2) | PASS |
| 2. extreme band shows the stop-work banner | PASS |
| 2. extreme without interim control is refused | PASS |
| 2. extreme triage saved | PASS |
| 2. stop-work alert notification exists for SH-TN1 | PASS |
| 2: no console errors or failed requests [SO-TN1] | PASS |
| 3. complete without an after-photo is refused | PASS |
| 3. complete with after-photo saved | PASS |
| 3. after-photo uploaded with SHA-256 match | PASS |
| 3. owner sees no Verify button on their own action | PASS |
| 3. owner trying to verify is refused (403) | PASS |
| 3: no console errors or failed requests [OWN-TN1-1] | PASS |
| 4. verification saved | PASS |
| 4. observation status is closed (API) | PASS |
| 4. observation shows Closed | PASS |
| 4. worker sees the closure in My reports | PASS |
| 4: no console errors or failed requests [VER-TN1] | PASS |
| 4: no console errors or failed requests [WORKER-TN1-1] | PASS |
| 5. submit blocked while the failed item has no action | PASS |
| 5. missing-action banner gone once the draft exists | PASS |
| 5. run submitted: action raised, score and result | PASS |
| 5. score and result shown on the run | PASS |
| 5. report opens via the signed link (no token in the URL) | PASS |
| 5: no console errors or failed requests [SO-TN1] | PASS |
| 6. QR form switched to Tamil | PASS |
| 6. QR submit returns a case number | PASS |
| 6. status link opens the public status page | PASS |
| 6. QR report stored anonymous with its photo | PASS |
| 6: no console errors or failed requests [QR (no login)] | PASS |
| 7. MFA enrolment shows the QR and the secret | PASS |
| 7. ADMIN01 signed in with TOTP (RFC 6238) | PASS |
| 7. dashboard KPIs | PASS |
| 7. attention board | PASS |
| 7. site wizard created TN7 for industry food with a poster per area + site | PASS |
| 7. default areas keep their codes and types | PASS |
| 7. poster opens in a new tab through the signed link (no bearer token) | PASS |
| 7. users CSV import of 3 users | PASS |
| 7. template copied, question with action-on-fail added, submitted for review | PASS |
| 7. approved by HSE01 (approver ≠ author) | PASS |
| 7 (HSE01): no console errors or failed requests [HSE01] | PASS |
| 7. audit-log chain verified | PASS |
| 7. site details saved (the loaded record is PUT back) | PASS |
| 7. equipment CSV import into the site on screen (siteId + next exam date) | PASS |
| 7. settings saved; organisation fields stay out of settings | PASS |
| 7. retention dry run and a legal hold | PASS |
| 7. privacy request logged | PASS |
| 7 (every console page): no console errors or failed requests [ADMIN01] | PASS |
| 7. every console page opened | PASS |
| 7. language switched to Hindi and back | PASS |
| 7: no console errors or failed requests [ADMIN01] | PASS |
| 8. SO-TN1 cannot fetch a KA1 observation (404) | PASS |
| 9. sync observation.comment applied | PASS |
| 9. sync observation.ack_critical applied | PASS |
| 9. sync action.start applied | PASS |
| 9. sync action.comment applied | PASS |
| 9. sync action.request date_change applied | PASS |
| 9. REST decide date change (approved) | PASS |
| 9. sync action.request dispute applied | PASS |
| 9. approving a dispute without a new owner is refused | PASS |
| 9. approved dispute reassigns to the new owner | PASS |
| 9. REST reassign | PASS |
| 9. REST cancel with site-head approval | PASS |
| 9. REST notification read | PASS |
| 9. REST read-all | PASS |
| 9. preferences saved and returned on Me | PASS |
| 9. push subscription registered | PASS |
| end: no console errors or failed requests [WORKER-TN1-1] | PASS |
| end: no console errors or failed requests [SO-TN1] | PASS |
| end: no console errors or failed requests [OWN-TN1-1] | PASS |
| end: no console errors or failed requests [VER-TN1] | PASS |
| end: no console errors or failed requests [QR (no login)] | PASS |
| end: no console errors or failed requests [ADMIN01] | PASS |
| end: no console errors or failed requests [HSE01] | PASS |
