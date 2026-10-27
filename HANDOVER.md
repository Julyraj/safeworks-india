# SafeWorks — complete handover (27 October 2026)

This file is the single source of truth for continuing SafeWorks in a **new Claude session** (claude.ai/code cloud session or any other). It covers everything done since the project started, the exact state of every part, every decision, every login, the hosting, the open items, and step-by-step instructions to finish the work. A new Claude session should read this file first, then `portal/docs/API.md`, `portal/docs/DECISIONS.md`, `VERIFY.md` and `CONTENT-REVIEW.md`.

Owner: **Makesh** (GitHub `Julyraj`), security engineer with an ME in Industrial Safety Engineering. Wants mentor-style explanations: one simple story with a small cast, technical terms mapped separately at the end; short, precise answers; no fluff.

---

## 1. What SafeWorks is

Two products in one public repository, **https://github.com/Julyraj/safeworks-india**:

| Product | What it is | Where |
|---|---|---|
| **SafeWorks India** (the "library" / website) | Offline safety library for Indian workplaces: 23 industries → task packs (rules, procedure, live checklist, permit, toolbox talk, official documents). 123 regulations (India central, Karnataka, Tamil Nadu, OSHA, UK/EU, international), 396 official document links, 117 procedures, 107 checklists, 96 toolbox talks, first aid, unsafe acts/conditions, protocols, glossary, forms, deadlines, limits, TN vs KA matrix, SOS, permit builder, incident navigator, observation card, carbon/ESG desk, risk matrix calculator, deadline calculator, checklist runner. Single HTML page + PWA + Android APK. | Repo root (`src/`, `build.py`, `index.html`). Published on GitHub Pages and inside the portal at `/library/`. |
| **SafeWorks Portal** | Multi-site safety observation system for one company with 5 sites (TN and KA): report a hazard in 30 s (offline, QR without login, anonymous option), officer triage on a 5×5 matrix, corrective actions with after-photo and independent verification, inspections from versioned checklists, reminders/escalation, dashboards, admin console, English/Hindi/Tamil/Kannada. Python server + React PWA + Android APK + admin console. | `portal/` |

---

## 2. Everything done so far, in order

### 2.1 Library (SafeWorks India)
1. Built the offline library (versions 1.x–3.2): regulations, procedures, checklists, first aid, protocols, unsafe acts, glossary, TN vs KA matrix, sector guides, permit builder, incident navigator, observation card, carbon desk, SOS; PWA; Android APK through Capacitor (`app/`); GitHub Actions builds the APK and publishes releases `v3.x.N`.
2. **3.3 (released, on `main`)** — "official documents": every regulation card got Download PDF / Open page buttons labelled **Free / Free · login / Paid**, an Internet Archive fallback, and a **Document downloads** screen (search + filters). Data in `src/data/data-docs.js` (fields `n` name, `u` url, `k` pdf|page, `a` free|free-login|paid, `share` gazette|act|public-domain|open-licence|no|unknown, `c` own-copy path, `v:false` unverified, `note`). Decision: link to official sources, don't host copies (Acts/BIS/ISO are copyrighted; links stay current); shareable documents (Gazette, US public domain, UK open licence) may be hosted in `files/` (rules in `files/README.md`; none hosted yet).
3. **Weekly link check** (`tools/check_links.py`, `.github/workflows/links.yml`, Sunday 22:00 UTC = Monday 03:30 IST): HEAD then GET, accepts incomplete certificate chains and HTTP 416, confirms a 404 against the site's home page (sites that block GitHub are "could not be checked", not broken), DNS NXDOMAIN = broken, also checks each card's official-site link; opens/updates/closes the GitHub issue **"Broken document links"**; manual mode: Actions → Check document links → Run workflow → paste URLs (results appear as a run annotation). Last run: **0 broken**; issue #1 closed. 8 dead links removed; Karnataka lifts card → India Code; Tamil Nadu lifts card → `tnei.tn.gov.in/pages/downloads` (`ceig.tn.gov.in` and `ceig.karnataka.gov.in` no longer exist).
4. `CONTENT-REVIEW.md` — about 30 places where library text may be outdated (NBC 2016 → SP 7:2026, IBR 2026, IS 15298-2:2024, TN Fire and Rescue Services Act 2025, KA fire NOC 21 m, ISO 14001:2026 …). Not changed yet — needs the owner's check.
5. **4.0 (on branch `feature/safeworks-2.0`, not released yet)** — complete redesign, industry-first:
   - `src/data/data-industries.js`: **23 industries** (construction, infrastructure, manufacturing, automotive, chemical, pharma, food, foundry, heavy/cement/steel, textiles, plastics/rubber, electronics, wind, solar, power, oil & gas/LPG/fuel, warehousing, mining, water, ports, agri-processing, facilities, corporate ESG), each with names in Hindi/Tamil/Kannada, hazards, **5–8 tasks (181 task packs total)**, regs, procedures, checklists, talks, PPE, statutory duties, portal categories, KPIs. Plus **57 new procedures (`PROCS3`, ids `p3-*`), 57 checklists (`CHECKLISTS4`, `cl4-*`), 57 toolbox talks (`TALKS4`)**. Uncertain numbers carry "(verify)".
   - `src/shell.html` rewritten: Home (hero search + industry tiles, My industry, Recently used, quick tools) → Industry hub `#industry/<id>/<tab>` → Task pack `#pack/<industry>/<task>` (Rules → Procedures → Checklist → Permits → Toolbox talk → Documents; print/save PDF, copy link, My packs). Command palette (`/`, Ctrl/Cmd+K), shortcuts (`?`, `g h/i/r/c`, Esc), risk matrix `#risk`, deadline calculator `#deadlines`, checklist runner with Undo, skeletons, error cards, empty states, dark mode, phone bottom bar + desktop rail. All old routes still work.
   - `design/tokens.css` = one palette for the library, field app and admin console (navy ink, concrete paper, hi-vis yellow primary, ISO 7010 colours for meaning). `build.py` inlines it at `/*__TOKENS__*/`.
   - Tested with Playwright: every route at 390×844 and 1280×800, 207 hub-tab routes and 181 packs, 0 errors, 0 horizontal overflow.

### 2.2 Portal 1.x (live now on Render, on `main`)
1. Built in TypeScript, then **rewritten in Python** at the owner's request ("lowest risk"): FastAPI 0.162, asyncpg, uvicorn, PostgreSQL 16, pure-ASGI guard middleware, scrypt passwords, signed photo links, Server-Timing. Load test: **1,000 users, 0 failures in 69,349 requests, screens p95 167 ms**.
2. Deployment kit: `portal/Dockerfile` (Node only builds the web; Python 3.12-slim runtime, non-root), `portal/docker-compose.yml`, `portal/deploy/install.sh` (one command on Ubuntu: Docker, firewall incl. Oracle iptables, `.env` with random secrets, Caddy HTTPS via `<ip-dashes>.sslip.io`, daily `pg_dump` + photo backups to `/var/backups/safeworks`, `restore.sh`), CI `.github/workflows/portal.yml` (pytest ×2, load test, Docker, Arm install test on `ubuntu-24.04-arm`, Android APK, releases `portal-v1.0.N`).
3. **Render test server — LIVE: https://safeworks-portal.onrender.com** (Blueprint `render.yaml`, free plan, Singapore, `STORAGE_DRIVER=db`, `autoDeployTrigger: checksPass` = deploys a new `main` commit only after CI passes). Free-plan limits: sleeps after 15 min idle (~1 min to wake), free database expires 30 days after creation (created ~24 Oct 2026 → **expires around 23 Nov 2026** unless upgraded or recreated), Singapore region → test data only.
4. **Oracle Cloud Always Free** was chosen for testing but sign-up failed 3 times (card/verification). Advice given: use a credit card (not debit/prepaid), home Wi-Fi, wait a day; Plan B = Render (done). Production recommendation: AWS Lightsail Mumbai ~US$12/month or Oracle Mumbai when sign-up works.

### 2.3 Portal 2.0 (on branch `feature/safeworks-2.0`, in progress)
Rebuilt to the owner's Portal Build Brief (Parts 1–3) and the request: "3 steps or fewer for the primary goal, smart defaults, automation, proactive insights, clean responsive UI with keyboard shortcuts, full error handling, empty states, loading skeletons, undo safeguards, complete code with zero placeholders or TODOs."

| Piece | Files | State at commit `81ae381` |
|---|---|---|
| Database schema | `portal/server/migrations/001_schema.sql`, `002_prefs_push.sql` | **Done, tested** on a fresh DB and on a 1.x DB (1.x tables are moved to schema `v1_archive`, nothing dropped; `file_blobs` kept). 52 tables: organisations, industry_profiles, risk matrices/versions, rule_sets/timer_rules, sites, areas, contractors, assets, qr_codes, people, users, user_site_roles, sessions, devices, enrolment_codes, categories, due_date_rules, reminder_ladders, translations, privacy notices/acks/requests, retention_policies, legal_holds, observations (+ reporter seals), media, triage_decisions, comments, actions, action_events, action_requests, inspection templates/versions/sections/questions/schedules/runs/answers, incidents (Phase 2 stub), notifications, escalations, email_outbox, job_marks, audit_log (hash chain), sync_commands, public_rate_counters. |
| API contract | `portal/docs/API.md`, `portal/web/src/shared/types.ts` | **Done.** All routes under `/api/v1`. |
| Python server | `portal/server/safeworks/**` (~11,400 lines incl. tests): config, crypto (AES-GCM), mfa (TOTP), audit (hash chain), rbac (per-site roles, out-of-scope = 404), numbers (case numbers `TN1-OBS-2026-00001`), i18n (4 languages), media (PUT upload, SHA-256 check), notify (in-app, email, Web Push, quiet hours, daily cap), sync (push/pull, idempotent commands, conflicts → comments), workflow/observations, actions, inspections, reports (locked HTML inspection report), scheduling, jobs, routes (auth, me, sync, media, observations, actions, inspections, dashboard + CSV, public QR, admin: sites/areas/assets/qr+posters/users/people/contractors/categories/matrix/due dates/ladders/rule sets/industries/templates/schedules/translations/audit/notifications/privacy/retention/settings/health), seed (`scripts/seed.py`, `seed_data.py`, demo photos), `loadtest.py`, tests (`test_workflow.py`, `test_auth_scope.py`, `test_admin.py`) | **Code written; pyflakes clean.** Was finishing seed + tests + smoke test when the session moved. **Remaining: run pytest to green, fix failures, curl smoke test.** |
| Shared web kit | `portal/web/src/shared/**` (api, storage, hooks, format, risk, image (1,600 px JPEG, EXIF stripped, blur boxes, SHA-256), icons, ui components, base.css, i18n with `shared/field/admin/qr` packs in en/hi/ta/kn) | **Done**; typecheck clean. |
| Field app (PWA + Android) | `portal/web/src/field/**`: offline IndexedDB store + outbox + sync engine, session (login, MFA, enrolment code, logout blocked while unsynced), Home ("Needs you now"), QuickReport (one screen), Reports, ObservationDetail, triage sheet, Actions, ActionDetail (complete with after-photo, verify side-by-side), Inspections, RunRoute (answering a checklist), Scan, Outbox, Notifications, Settings, ServerAddress | **Screens written; typecheck clean.** Remaining: `npm run build`, its Playwright test, fixes. |
| QR public form | `portal/web/src/qr/QrApp.tsx`, `portal/web/q/index.html` | Written. Needs build + test. |
| Admin console | `portal/web/src/admin/**`: login with MFA, shell with rail + site scope, Dashboard, Attention board, Observations (+ triage drawer), Actions, Inspections, Sites (3-step set-up wizard), Assets, QR codes (posters), People, Contractors, Users (CSV import), Categories, Risk matrix, Due dates & reminders, Rule sets, Templates (builder), Languages, Audit log (chain verify), Privacy, Retention, Settings, Health | **Screens written; typecheck clean.** Remaining: build + Playwright test + fixes. |
| Deploy/CI for 2.0 | `portal/Dockerfile` (copies `design/`), `render.yaml` (health `/api/v1/health`, new `FIELD_ENCRYPTION_KEY` generated), `docker-compose.yml`, `deploy/install.sh` (adds `FIELD_ENCRYPTION_KEY`, also to existing installs), `.github/workflows/portal.yml` (v2 login bodies, APK `2.0.N`, releases `portal-v2.0.N`) | **Updated**, not yet run in CI (runs when merged to `main`). |
| Docs | `portal/docs/API.md`, `portal/docs/DECISIONS.md`, `VERIFY.md` (root), `portal/web/src/shared/README.md` | Done. `portal/README.md` still describes 1.x → **update before merge**. `CHANGELOG.md`/`README.md` need 4.0 / 2.0 entries. |

---

## 3. Logins

**Never put passwords in chat or in the repo.** The password for every login below is whatever was typed into Render's `SEED_ADMIN_PASSWORD` when the Blueprint was created (`DEMO_PASSWORD` was left empty, so the demo users share it).

### Portal 1.x — live now on https://safeworks-portal.onrender.com
| Login (employee ID) | Role | Where |
|---|---|---|
| `ADMIN01` | Admin | Admin console `/admin/` (and the portal) |
| `SO-PS01-1`, `SO-PS01-2` … `SO-PS05-x` | Safety officers, sites PS01–PS05 | Portal `/` |
| `SUP-PS01-1` … `SUP-PS0x-6` | Supervisors | Portal `/` |
| `VIEW01` | Management viewer | Admin console (read only) |
| `AUD01` | Auditor | Read only |

### Portal 2.0 — after it is merged and Render redeploys (the database is re-seeded with these)
| Login | Role | Notes |
|---|---|---|
| `ADMIN01` | Admin | **MFA required**: first sign-in shows a QR to scan with an authenticator app (Google Authenticator, Microsoft Authenticator, Aegis) |
| `HSE01` | HSE manager (all sites) | MFA required |
| `AUD01` | Auditor (all sites, read only, time-limited) | |
| `SO-TN1` | Site safety officer, TN1 | same pattern for TN2, TN3, KA1, KA2 |
| `SH-TN1` | Site head, TN1 | MFA required |
| `VER-TN1` | Verifier, TN1 | |
| `OWN-TN1-1` … `OWN-TN1-3` | Action owners, TN1 | |
| `WORKER-TN1-1` … `WORKER-TN1-5` | Reporters (workers), TN1 | |

Sample sites (placeholders until the real 5 sites are known): **TN1** construction site (Chennai, `BOCW_TN_LEGACY`), **TN2** construction site, **TN3** factory (`TN_FACTORY_LEGACY`), **KA1** construction site (`BOCW_KA_PROVISIONAL`), **KA2** chemical factory (`KA_FACTORY_LEGACY`).

QR form for a site area: `https://<server>/q/<token>` (tokens are printed on the posters in the admin console → QR codes).

---

## 4. Key decisions (full list in `portal/docs/DECISIONS.md`)

- Same repo, Python FastAPI + PostgreSQL (not PocketBase), React PWA + Capacitor Android, one Docker image.
- Industries are first-class: the same 23 codes drive the library hubs and each portal site's categories, inspection templates and default areas (`POST /admin/sites/{id}/setup {industryCode}`).
- The phone sends **commands** (idempotent, `commandId`), never statuses; REST and sync call the same workflow functions.
- Photos: text syncs first, photos follow; SHA-256 at capture checked on the server; EXIF stripped; blur burnt in; annotation kept as vectors.
- Inspection report = locked self-contained HTML (prints to PDF in any script) — server-side PDF with Tamil/Kannada shaping isn't possible on free hosts.
- Push = Web Push (VAPID, free). FCM for the Android wrapper needs a Firebase project (owner's decision).
- Workers sign in with employee code + password or an officer-issued enrolment code (no paid OTP). MFA (TOTP) for admin, HSE manager, site head.
- Statutory timers are configuration in 2.0 (shown with status labels); incidents with live clocks are Phase 2.
- Everything marked Unverified / draft / design default lives in seed data with its label (`VERIFY.md`). Draft rule packs can't be enabled without a named reviewer.
- Nothing is deleted automatically: retention runs a dry-run report only.
- Anonymous reports: reporter id only in an encrypted seal; "My reports" works through an HMAC; no role can see the identity.

---

## 5. Open items for the owner (not code)

1. Review `CONTENT-REVIEW.md` (~30 library items) and `VERIFY.md` (legal clocks, form numbers, intervals) with a qualified person; name a legal reviewer before Phase 2 (incidents).
2. Send PDF links for Karnataka state rules that still link only to the Labour Department home page (Karnataka sites block automated access), and the eGazette PDFs for OSH (Central) Rules 2026 G.S.R. 345(E) and IR (Central) Rules 2026 G.S.R. 342(E).
3. Confirm the 5 real sites (names, state, type), user count, crew languages per site, pilot site.
4. Decide production hosting (Lightsail Mumbai or Oracle Mumbai) before the pilot; the Render database expires ~23 Nov 2026.
5. Optional, paid or account-bound: SMTP for emails, Firebase for Android push, WhatsApp provider (Phase 2), a domain name.
6. Delete the leftover GitHub branch `feature/document-downloads` (Claude's GitHub proxy can't delete branches).
7. Translations are drafts — have site staff review Hindi, Tamil and Kannada.

---

## 6. How to continue in a new Claude cloud session — step by step

### Step 1 — Start the session
1. Open **https://claude.ai/code** and start a new session (cloud environment).
2. Connect GitHub if asked, and choose the repository **Julyraj/safeworks-india**.
3. If you can pick a branch, pick **`feature/safeworks-2.0`**. If not, the prompt below tells Claude to switch.
4. Optional but helpful: start it from the **"EHS Safety"** project so the briefs are available, or attach these files to the first message: `SafeWorks_India_Build_Brief.md`, `SafeWorks_Portal_Build_Brief.md` (or Parts 1–3). The essentials are already in the repo (`HANDOVER.md`, `portal/docs/API.md`, `DECISIONS.md`, `VERIFY.md`), so the session can work without them.

### Step 2 — Paste this first message (copy everything inside the box)

```
You are continuing the SafeWorks project in the repo Julyraj/safeworks-india.
1. git fetch origin && git checkout feature/safeworks-2.0 && git pull
2. Read HANDOVER.md fully, then portal/docs/API.md, portal/docs/DECISIONS.md, VERIFY.md, portal/web/src/shared/README.md.
3. Set up the environment exactly as HANDOVER.md section 7 says (PostgreSQL 16 for tests, Python venv with portal/server/requirements-dev.txt, npm ci in portal/).
4. Finish Portal 2.0 in this order, fixing everything until green, without placeholders or TODOs:
   a) server: pyflakes, pytest (all tests), seed --demo, curl smoke test from HANDOVER.md section 8;
   b) web: npm run typecheck and npm run build in portal/web; fix errors;
   c) end-to-end in a real browser (Playwright) against the real server: worker quick report online and offline → sync; officer triage with an action; owner completes with an after-photo; a different verifier verifies; observation closes; inspection run with a failed item → action; QR form without login in Tamil; admin site set-up wizard, user import, template approval, audit chain verify; at 390x844 and 1280x800; no console errors;
   d) update portal/README.md for 2.0, README.md and CHANGELOG.md (library 4.0, portal 2.0), build.py output, then merge feature/safeworks-2.0 into main, push, watch CI (gh run watch), fix until all jobs pass, and confirm Render redeployed (https://safeworks-portal.onrender.com/api/v1/health).
5. Commit and push after every finished step (stop hook requires it). Never put passwords in chat or in the repo.
6. Explain results to me briefly, mentor-style, in plain words. Ask me only for decisions listed in HANDOVER.md section 5.
```

### Step 3 — While it works
- Watch the task list on the right. If the session stops (limits), open it again and type **"Continue from HANDOVER.md where you stopped; check git log first."**
- Do not paste passwords. If Claude needs to sign in to test, it uses the demo password it sets itself on its own local database.

### Step 4 — After the merge, check it yourself (10 minutes)
1. Open **https://github.com/Julyraj/safeworks-india/actions** — "SafeWorks Portal", "Build Android app" and "Check document links" should be green.
2. Wait for Render to redeploy (Render dashboard → safeworks-portal → Events → "Deploy live"), then open **https://safeworks-portal.onrender.com** (first load may take ~1 minute while it wakes).
3. Because 2.0 creates a new schema, the 1.x data is archived (schema `v1_archive`) and the demo company is re-seeded. Sign in as `WORKER-TN1-1` → tap **Report** → pick a type → take a photo → **Submit**. Then sign in as `SO-TN1` → **Triage** → tap a matrix cell → **Assign**. Then `OWN-TN1-1` → the action → after-photo → **Complete**. Then `VER-TN1` → **Verify** → **Effective**. The report should show **Closed**.
4. Admin console: **https://safeworks-portal.onrender.com/admin/** → `ADMIN01` → scan the MFA QR with an authenticator app → Dashboard; Sites → New site → pick an industry → Create → print a QR poster.
5. Library: **https://safeworks-portal.onrender.com/library/** (and GitHub Pages) → pick an industry → a task → the pack.
6. Android: GitHub → Releases → newest `portal-v2.0.N` → download `SafeWorks-Portal.apk` → install → enter the server address `https://safeworks-portal.onrender.com` → sign in.

---

## 7. Environment setup (for the Claude session)

```bash
# PostgreSQL 16 for tests (cloud sessions usually have it installed; if not: apt-get install -y postgresql-16)
PGBIN=/usr/lib/postgresql/16/bin
sudo -u postgres mkdir -p /srv/swpg && sudo -u postgres $PGBIN/initdb -D /srv/swpg >/dev/null 2>&1 || true
sudo -u postgres $PGBIN/pg_ctl -D /srv/swpg -o "-p 55432 -k /tmp -c max_connections=200" -l /srv/swpg/log.txt start
sudo -u postgres psql -h /tmp -p 55432 -c "create role safeworks login password 'safeworks' createdb" || true
sudo -u postgres psql -h /tmp -p 55432 -c "create database safeworks owner safeworks" || true
sudo -u postgres psql -h /tmp -p 55432 -c "create database safeworks_test owner safeworks" || true

# Python server
cd portal/server
python3 -m venv /srv/swvenv && /srv/swvenv/bin/pip install -r requirements-dev.txt
TEST_DATABASE_URL=postgres://safeworks:safeworks@127.0.0.1:55432/safeworks_test /srv/swvenv/bin/python -m pytest tests -q
STORAGE_DRIVER=db TEST_DATABASE_URL=postgres://safeworks:safeworks@127.0.0.1:55432/safeworks_test /srv/swvenv/bin/python -m pytest tests -q

# Web (field app, QR form, admin console) — Node 22
cd ../ && npm ci && cd web && npm run typecheck && npm run build    # output: portal/web/dist (index.html, q/, admin/, library/)

# Library
cd ../.. && python3 build.py      # builds index.html, safeworks-india.html, sw.js, app/www, data/*.json
```

If `requirements-dev.txt` lacks a package used by tests (pytest, httpx, pyflakes), add it there.

## 8. Smoke test (server running locally)

```bash
cd portal/server
export DATABASE_URL=postgres://safeworks:safeworks@127.0.0.1:55432/safeworks
export SEED_ADMIN_PASSWORD=LocalTest2026 DEMO_PASSWORD=LocalTest2026
/srv/swvenv/bin/python scripts/seed.py --demo
/srv/swvenv/bin/python -m safeworks &        # http://localhost:8080
curl -s localhost:8080/api/v1/health
T=$(curl -s -X POST localhost:8080/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"login":"SO-TN1","password":"LocalTest2026","kind":"field"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -H "Authorization: Bearer $T" "localhost:8080/api/v1/sync/pull" | head -c 400
```
Then (per `API.md`): push an `observation create` with one photo ref → `PUT /api/v1/media/{clientUuid}` the JPEG → triage `accept_assign` with an action for `OWN-TN1-1` → complete as the owner with an after-photo → verify as `VER-TN1` → the observation status is `closed`. Also `GET /api/v1/public/qr/<token>`, `POST /api/v1/public/qr/<token>/observations`, admin `GET /admin/health`, `POST /admin/audit-log/verify`, `GET /admin/qr-codes/<id>/poster`.

---

## 9. Repository map

```
/                         library (SafeWorks India)
  src/shell.html          the whole library UI (one IIFE starting "(function(){"; data constants before it)
  src/data/*.js           data: regs (REGS, REGS2, REGS4), procs (PROCS, PROCS2, PROCS3), checklists (1–4), talks (1–4),
                          forms, reporting deadlines, numbers, glossary, keywords, SECTORS, MATRIX, UNSAFE, PROTOCOLS,
                          FIRSTAID, DOCS (official documents), INDUSTRIES (data-industries.js)
  build.py                builds index.html, safeworks-india.html, sw.js, app/www, data/*.json
  design/tokens.css       shared design tokens (library + portal)
  app/                    Capacitor Android wrapper for the library
  files/                  own copies of shareable documents (none yet; rules in files/README.md)
  tools/check_links.py    weekly link checker
  CONTENT-REVIEW.md       library text to verify;  VERIFY.md  legal/numeric values to verify;  HANDOVER.md  this file
portal/
  server/                 Python FastAPI server (safeworks/), migrations/, scripts/ (seed, loadtest, start.sh), tests/
  web/                    Vite + React + TS: src/shared (kit), src/field (PWA), src/qr (QR form), src/admin (console);
                          pages: index.html, q/index.html, admin/index.html; scripts/ (sync-tokens, copy-library)
  mobile/                 Capacitor Android wrapper for the field app (webDir ../web/dist)
  deploy/                 install.sh, backup.sh, restore.sh, Caddyfile, docker-compose.https.yml
  docs/                   API.md (contract), DECISIONS.md
  Dockerfile, docker-compose.yml, README.md
render.yaml               Render Blueprint (test server)
.github/workflows/        portal.yml (tests, docker, arm install, APK), android.yml (library APK), links.yml (weekly link check)
```

Branches: `main` = library 3.3 + portal 1.1 (live). `feature/safeworks-2.0` = library 4.0 + portal 2.0 (in progress, last commit `81ae381` or later). `feature/document-downloads` = old, can be deleted.

Releases: library APK `v3.3.N` (latest `v3.3.7`), portal APK `portal-v1.0.N`; after the merge `portal-v2.0.N`.

---

## 10. Lessons learned (save time)

- **Stop hook**: the session requires every change to be committed and pushed before ending a turn. Use a feature branch for work in progress so `main` (which auto-deploys to Render after CI) isn't touched.
- **GitHub from Claude**: `gh` works for runs, issues, releases; the proxy blocks GraphQL (`gh issue view` fails → use `gh api repos/...`), blocks deleting branches, and blocks downloading Actions logs (use run annotations or issue comments to read results).
- **Web fetching** is rate-limited per hour; Karnataka government sites and eGazette block or time out from abroad (GitHub runners and Claude's tools). Use the link checker's by-hand mode on GitHub to probe URLs.
- **Docker Hub** is blocked in the Claude sandbox; container builds are verified in CI (`docker` and `install-arm` jobs).
- Free hosts have no permanent disk → `STORAGE_DRIVER=db` keeps photos in PostgreSQL.
- Running a Python load-test client on the same machine saturates the CPU; run load tests from a different machine (or use `PROCS`).
- Long builds by several parallel agents can stop on usage limits; commit often so a new session can pick up from git.

---

## 11. Rules every Claude session must follow on this project

- Never hard-code legal values marked Draft rule / Unverified / Verified (secondary) / provisional / design default — they stay configuration with their status label.
- Server-side authorisation and site scope on every request (out of scope → 404); audit log for every change; every user-facing string through translation keys (en, hi, ta, kn).
- Verifier ≠ owner ≠ completer; template approver ≠ author; anonymous identity never leaves the server.
- No paid service, new personal-data processor or non-permissive licence (AGPL, BSL, FSL, source-available, non-commercial) without asking the owner.
- No secrets, real worker data or company data in the public repo; `.env.example` only.
- One primary (hi-vis) action per screen; skeletons, empty states, error cards with retry, Undo for destructive actions; keyboard shortcuts with a `?` help sheet; no placeholders or TODOs.
- This is product-design research, not legal advice; the app records, reminds and drafts — people decide.
