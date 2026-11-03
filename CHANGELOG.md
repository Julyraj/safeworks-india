# Changelog

## Portal 2.1 — departments, charts and Excel reports (draft, not released)
- **Departments**: one company-wide list in the admin console (People & contractors → Departments), a department on each user (also in the user CSV import as `department`), and a *By department* table on the dashboard. An action records its owner's department when assigned; named reports record the reporter's. Anonymous and QR reports never count towards a department.
- **Field app → Actions → Department**: everything assigned to your department (read-only unless it is yours). Works from the offline copy and refreshes from the server when online.
- **Field app → Charts** (More → Charts): Mine / Department / Site, for the last 30, 90 or 365 days: reports, hazards, good practice, open and overdue actions, closed-on-time %, a trend chart, and breakdowns by type, risk, category and status; Site adds the department table. Counts only, never names.
- **Report and assign**: after an officer submits a report, *Score risk and assign owner now* opens the triage sheet at once (works offline).
- **Excel**: every register exports as `.xlsx` as well as CSV, and **Full report (Excel)** (dashboard and the phone's Charts page, officers) gives one workbook with a Summary, Reports, Actions and Departments sheet. No new library.
- **Fixes from the QA test plan** (`portal/docs/TEST-PLAN.md`, results in `TEST-RESULTS.md`): a report dated in the future keeps the received time; category and "what you did" (fixed on the spot) are checked on the server; exports limited to officers, site heads, HSE managers, admins and auditors for their own sites; CSV exports guard against spreadsheet formulas; dashboard dates entered the wrong way round are swapped; auditors are read-only in the phone app too; a site needs a name; emails are checked properly; console menus match the server for Notifications log and Health; every phone-app page now opens offline, also ones never opened before. From the second run (F14–F26): Extreme-risk reminders ignore quiet hours and the daily push limit; digest emails show real text; the triage-overdue reminder opens Reports → Triage; auditor accounts always have an expiry (CSV: 30 days); required category details, contractor emails, phone numbers, future-only new due dates and checklist answers are checked on the server; "Danger now" is not offered on good-practice reports; Charts explain when they are offline or out of date; the console case-number jump works from the same register and clears old filters; and work saved offline is sent as soon as the app reopens with signal.
- Database migration `003_departments.sql` (new table, three columns, two triggers; nothing dropped). Demo seed adds five departments. 28 new server tests (63 in total). The QA plan (767 cases) passes 753 of 767 automatically (API, timed jobs, 120 screen cases in `portal/e2e/ui_plan.cjs` and the 84-step browser run); the other 14 need a phone, microphone or manual steps (reasons in `TEST-RESULTS.md`).

## Portal 2.0 — rebuilt to the Portal Build Brief
- **New database schema** (52 tables) for one company with many sites: per-site roles, industries, risk matrices with versions, rule sets with status labels, areas, assets, QR codes, people and contractors, observations with anonymous reporter seals, media with SHA-256 checks, triage decisions, actions with events and requests, versioned inspection templates and runs, notifications, escalations, privacy notices and requests, retention policies and legal holds, hash-chained audit log. Portal 1.x tables are moved to schema `v1_archive`; nothing is dropped.
- **Field app** (installable web app + Android): one-screen quick report (type → photo → submit) that works offline with an outbox, photos uploaded after the text with a hash check, anonymous option, "Needs you now" home, triage sheet with a tap-to-set 5×5 matrix and a pre-filled action, complete with after-photo, side-by-side verification, inspections with fail follow-up and signature, notifications, Web Push alerts on the installed web app, English/Hindi/Tamil/Kannada.
- **QR form without login** at `/q/<token>`: report in four languages with a photo, case number and a status link; rate-limited.
- **Admin console** at `/admin/`: MFA (TOTP) for admin, HSE manager and site head; dashboard and attention board; observation, action and inspection registers with sorting, filters and CSV export; 3-step site set-up by industry with a QR poster per area; areas, equipment, QR codes, people, contractors, users (CSV import, enrolment codes), categories, risk matrix, due dates and reminder ladders, rule sets (a draft rule can't be enabled without a named reviewer), template builder (approver ≠ author), languages, audit log with chain verification, notifications log, privacy, retention dry run and legal holds, settings, health.
- **Workflow rules on the server**: site scope (out of scope = 404), verifier ≠ owner ≠ completer, extreme band needs an interim control and fires a stop-work alert, approved disputes reassign, inspection submit blocked while a failed item has no action, closure notices to the reporter (also anonymous), reminder ladder and escalations, quiet hours and a daily push cap.
- **Signed links** for posters and inspection reports opened in a new tab: 5-minute HMAC-signed, bound to the record and the user, scope-checked when issued and when opened, audited. Bearer tokens never go into a URL.
- Tests: 35 server tests (photos on disk and in the database), TypeScript typecheck and build, and a Playwright end-to-end run against the real server (field app at 390×844, console at 1280×800). Docker image, Render Blueprint, one-command installer (adds `FIELD_ENCRYPTION_KEY`) and CI updated for 2.0; Android releases `portal-v2.0.N`.

## Library 4.0 — industry-first (27 Oct 2026)
- New home: search plus **23 industry tiles** (names in Hindi, Tamil and Kannada). Each industry hub lists its hazards, PPE, statutory duties, regulations, procedures, checklists, toolbox talks, portal categories and KPIs.
- **181 task packs** (5–8 per industry): rules → procedures → live checklist → permits → toolbox talk → official documents for one job, printable to PDF, with copy link and *My packs*.
- New content: 57 procedures (now **117**), 57 checklists (now **107**) and 57 toolbox talks (now **96**). Totals: **123 regulations, 396 official documents**. Uncertain numbers carry "(verify)".
- Command palette (`/`, Ctrl/Cmd+K), keyboard shortcuts (`?`, `g h/i/r/c`), risk matrix and deadline calculators, checklist runner with Undo, skeleton loading, error cards, empty states, dark mode, phone bottom bar and desktop rail. One design-token palette shared with the portal (`design/tokens.css`). Every older link still works.

## 3.3 — 2026-10-25 — official documents
- New **Document downloads** view: 396 official documents for all 123 regulations (149 direct PDFs), from India Code, central ministries, Karnataka and Tamil Nadu departments, BIS, eCFR/govinfo, legislation.gov.uk, EUR-Lex and the standards publishers. Filter by jurisdiction, access and type, or search.
- Every regulation card now lists its **Official documents**: Download PDF / Open page, labelled Free, Free · login (e.g. BIS free download after registering) or Paid (e.g. ISO, NFPA, ASME), with an Internet Archive copy as a fallback.
- Links rather than copies: Indian Acts and BIS/ISO standards are copyrighted, and a link always gives the current amended text. Documents that may be shared (Gazette rules, US public-domain, UK open licence) can also be hosted in `files/` — see `files/README.md`.
- Weekly link check (GitHub Actions) opens an issue when an official link breaks.
- `CONTENT-REVIEW.md` lists about 30 places where the library text may be out of date (e.g. NBC 2016 → SP 7:2026, Tamil Nadu Fire and Rescue Services Act 2025, IS 15298 Part 2:2024), to verify and update.

## Portal 1.1 — 2026-10-24 — server rewritten in Python
- The portal server (`portal/server/`) is now Python 3.12: FastAPI, asyncpg and uvicorn. The old TypeScript server is removed.
- Same web addresses, request and response formats, database tables and password format. The website, the admin console and the installed Android app work unchanged, and an existing database and existing logins carry over.
- Tests are now pytest: the same 12 workflow and permission tests (run with photos on disk and in the database) plus 5 HTTP-layer tests. The load test is `scripts/loadtest.py`; it can drive users from several processes (`PROCS`) and reports when the test machine itself is the bottleneck.
- Docker image: Python runtime; Node is used only to build the screens. `WEB_CONCURRENCY` sets the number of API processes.
- Responses carry a `Server-Timing` header; slow API requests are logged (`SLOW_MS`).
- Uploads over 14 MB are refused even when the size is not declared up front. Database connections are kept warm and are not reset after every query.
- Fixed: the History list on a point squeezed its text into a narrow column.

## Portal 1.0 (Phase 1 MVP) — 2026-10-24
- New `portal/`: multi-site safety observation system with a user portal and installable web app, an Android app (Capacitor), and a separate admin console.
- Employee ID + password login, forced change of temporary passwords, lockout after 5 wrong attempts, admin set/reset/unlock/force-change, bulk user import, audit log.
- Observation points:
  - 1–2 photos, compressed and stamped on the phone
  - 165-item unsafe act/condition master list, hazards, 60 work activities, 12 Life-Saving Rules
  - tap-to-set 5×5 risk matrix, due dates by risk (editable in Settings)
  - safety walks, corrected-on-the-spot, repeat detection, offline queue
- Workflow: assign → supervisor closure (comment + optional photo) → safety officer approval or rejection. No self-approval. Every change is versioned.
- Dashboards: personal counters (created, open, overdue, awaiting approval, closed), site dashboard, company overview, CSV export with photo links.
- Tests:
  - 12 end-to-end workflow and permission tests
  - load test script, passed with 100 users on one site
  - Docker Compose deployment and a GitHub Actions workflow for tests and the APK


## 3.2 — 2026-10-24 — the app release
- Installable app: PWA manifest, offline service worker, app icons, install button; standalone `index.html` with proper document head.
- Android app (Capacitor 8.5.2) with launcher icons, splash, camera permission, native share and back button; GitHub Actions builds the APK and publishes it to Releases on every push.
- New SOS screen (one-tap emergency numbers, site emergency contacts, emergency cards) with a persistent SOS button and mobile bottom tab bar (Home · Observe · SOS · Permit · Menu).
- Observation card: camera photo capture (compressed, stored on device), photo thumbnails in the log, share card with photo.
- Share buttons for permits, incident notices and emergency sheets; App & my data screen with backup, restore and erase.

## 3.1 — 2026-10-20
- TN vs Karnataka regulatory & enforcement matrix view (table + 9 domains: PTW/LOTO, confined space, work at height, machinery/lifting/pressure, chemical/hazardous/explosives, construction, environment/waste/hygiene, electrical/fire/radiation, PPE BIS set).
- New regulation entries: IS 17893:2023, TN CIMAH Rules 1994, MAH Control (Karnataka) Rules 1994, BOCW (Karnataka Amendment) Rules 2024, Karnataka Boiler Rules 1982, TN Boiler Rules, BIS hygiene/electrical/construction/PPE sets.
- State rule/section/form citations injected into 35 procedures; Karnataka dangerous-operations rule corrected to Rule 129; KSPCB/TNPCB entries extended (portals, ZLD, river G.O.s, lake buffers, OCEMS, STP dual piping, TSDFs).
- Forms & registers: TN Forms 8/9/8-A, KA Forms 6/7/8, HW Forms 1/3/4/8/9/10, CTE/CTO portals, IS 17893 permit formats; new limits, keywords and portal contacts.

## 3.0 — 2026-10-20
- Safety protocols view: 12 Life-Saving Rules, site rule book, 17 standing protocols, 25 emergency protocols.
- Unsafe acts & conditions master list (165 items), causes and causation models; Observation card tool with on-device log and CSV export.
- First aid: 34 topics + programme (statutory basis, people, equipment, box contents, records); first-aid readiness checklist.
- Keywords & glossary merged: 357 terms across 17 categories.
- Extra toolbox talks (unsafe acts, unsafe conditions, Life-Saving Rules, first aid) and forms.
- Repository structure: `src/`, `build.py`, JSON export in `data/`.

## 2.0 — 2026-10-20
- 33 new regulation entries (energy/carbon/ESG: EC Act, CCTS, BRSR, CBAM, GHG standards, EPR, ECSBC, ODS; process safety & tanks; lifting gear, cranes, tools, forklifts/racking, machinery; foundry & dangerous-operations schedules; HT, batteries/solar; fire systems; tunnelling, piling, blasting, water, labs, bio, security, drones, road works).
- 26 new procedures (foundry, PSM, tanks, tank cleaning, tackles, tools, tower/EOT cranes, forklifts, substations, batteries/solar/EV, dust, toxic gas, tunnelling, piling, blasting, painting, water, road works, lab, bio, security, drones, GHG, ESG, fire systems, legionella) with matching checklists.
- Sector guides (12) and Carbon & ESG desk (Scope 1/2 calculator, CCTS/CBAM/BRSR checklists).

## 1.0 — 2026-10-20
- Initial release: 81 regulations, 34 procedures, 23 checklists, forms, reporting deadlines, toolbox talks, emergency contacts, limits, glossary, permit builder, incident navigator.
