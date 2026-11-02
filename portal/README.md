# SafeWorks Portal 2.0

Multi-site safety observation system for one company with several construction sites, factories and plants (Tamil Nadu and Karnataka first). Anyone on site reports a hazard in about 30 seconds — offline, from a QR poster without an account, or anonymously; the site safety officer triages it on a 5×5 risk matrix and assigns corrective actions; the action owner fixes it with an after-photo; a different person verifies it, and the report closes. Inspections run from versioned checklists, reminders and escalations run on their own, and dashboards show where the risk is. Four languages: English, Hindi, Tamil, Kannada.

| Part | Where | Who uses it |
|---|---|---|
| **Field app** (installable web app + Android app) | `/` | workers, action owners, verifiers, safety officers, site heads |
| **QR form** (no login) | `/q/<token>` | anyone who scans a poster: visitors, contract workers |
| **Admin console** | `/admin/` | admin, HSE manager, site heads, safety officers, auditors |
| **Safety library** (SafeWorks India 4.0) | `/library/` | everyone |

The API contract is `docs/API.md` (types in `web/src/shared/types.ts`), the design decisions are in `docs/DECISIONS.md`, and the values that still need a qualified person's check are in `../VERIFY.md`.

## Roles (per site, enforced on the server)

| Role | Can | Never |
|---|---|---|
| Reporter (worker) | report, see own reports (also anonymous ones), reply to a question | see who reported anything else |
| Action owner | start and complete assigned actions (completion note, cause addressed, after-photo), ask for a date change, dispute | verify their own action |
| Verifier | verify completed actions at their site (effective / not effective) | verify an action they own or completed |
| Site safety officer | triage, assign, reassign, comment, run inspections, issue enrolment codes, site areas/QR/schedules | approve a template they wrote |
| Site head | as officer, plus approvals (3rd date change, cancellations), stop-work acknowledgement | — |
| HSE manager (all sites) | safety configuration: templates, categories, risk matrix, due dates, ladders, rule sets | — |
| Admin (all sites) | people, sites, users, settings, privacy, retention | triage, assign, verify, see medical data or an anonymous reporter |
| Auditor (all sites, time-limited) | read everything in scope | change anything |

A record outside your sites answers **404**, never 403, so ids cannot be probed. Admin, HSE manager and site head sign in with a TOTP authenticator app (MFA). Every change, sign-in, export and sensitive view writes a hash-chained audit row.

## The flows (3 steps or fewer)

1. **Report** — field app: tap *Report* → pick the type (category pre-selected), take a photo → *Submit*. It is saved on the phone first, shows a case number like `TN1-OBS-2026-00041` as soon as it syncs, and works with no signal (outbox, photos upload after the text, SHA-256 checked on the server). QR poster: scan → choose language → type + photo → *Submit* → case number and a status link.
2. **Triage** — officer: open the report → tap a matrix cell → *Assign* (the action is pre-filled: owner from the area, due date from the band rule). Extreme band or *danger now* asks for an interim control and sends the stop-work alert to the site head and HSE manager.
3. **Close** — owner: *Complete* with an after-photo (refused without one). Verifier: compare before/after → *Effective*. The last verified action closes the report and the reporter is told (also anonymous reporters, through the seal).
4. **Inspect** — *Start inspection* → template → answer (a Fail asks for photo, note and a draft action; submit is blocked until every failed item has an action) → sign → *Submit*. Score, any-Fail result, repeat findings and a locked printable report.
5. **Set up a site** — console: *Sites → New site* → name/code → pick the industry → *Create*. Default areas, categories, templates and a QR poster per area are ready to print.

Posters and inspection reports open in a new tab through a **5-minute signed link** (`POST …/poster-link`, `POST …/report-link`); a bearer token is never put in a URL.

## How it is built

| Part | Stack |
|---|---|
| API | Python 3.12, FastAPI, asyncpg, uvicorn (`server/`); jobs as asyncio tasks in the same process |
| Database | PostgreSQL 16, SQL migrations (`server/migrations/`); 1.x tables are moved to schema `v1_archive`, nothing is dropped |
| Files | disk (`STORAGE_DIR`) or the database (`STORAGE_DRIVER=db`); short-lived signed links |
| Web | React 18 + TypeScript, Vite (`web/`): field app, QR form and admin console from one build; IndexedDB outbox for offline use |
| Android | Capacitor wrapper around the field app (`mobile/`) |
| Push | Web Push (VAPID) for the installed web app; email through SMTP |

One container serves the API, the three front ends and the library.

## Run it locally

Requires Python 3.12, PostgreSQL 16 and Node 22 (Node only builds the screens).

```bash
cd portal
npm ci && npm run build -w web              # builds web/dist (index.html, q/, admin/, library/)
cd server
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
createdb safeworks
export DATABASE_URL=postgres://USER:PASS@localhost:5432/safeworks
SEED_ADMIN_PASSWORD='choose-one-2026' python scripts/seed.py --demo
python -m safeworks                          # http://localhost:8080   field app /, QR form /q/<token>, console /admin/
```

`scripts/seed.py` creates the configuration (risk matrix, due-date rules, reminder ladders, rule sets with their status labels, categories, inspection templates, the 23 industry profiles, five sample sites TN1, TN2, TN3, KA1, KA2 with areas and QR codes) and `ADMIN01`. `--demo` adds the demo users below, contractors, people, 200 observations in every status (English, Hindi, Tamil, Kannada text), actions, inspection runs and notifications. The demo password is `DEMO_PASSWORD`, or the admin password when that is empty. The seed is idempotent.

| Login | Role | Notes |
|---|---|---|
| `ADMIN01` | Admin | MFA: the first sign-in shows a QR for an authenticator app |
| `HSE01` | HSE manager (all sites) | MFA |
| `AUD01` | Auditor (all sites, read only, time-limited) | |
| `SO-TN1` | Site safety officer, TN1 | same pattern for TN2, TN3, KA1, KA2 |
| `SH-TN1` | Site head, TN1 | MFA |
| `VER-TN1` | Verifier, TN1 | |
| `OWN-TN1-1` … `OWN-TN1-3` | Action owners, TN1 | |
| `WORKER-TN1-1` … `WORKER-TN1-5` | Reporters (workers), TN1 | |

Never put a password in the repository or in chat; each environment sets its own through `SEED_ADMIN_PASSWORD` / `DEMO_PASSWORD`.

## Tests

```bash
cd portal/server
TEST_DATABASE_URL=postgres://USER:PASS@localhost:5432/safeworks_test python -m pytest tests                     # wipes that database
STORAGE_DRIVER=db TEST_DATABASE_URL=postgres://USER:PASS@localhost:5432/safeworks_test python -m pytest tests   # photos in PostgreSQL
cd ../web && npm run typecheck && npm run build
```

35 server tests through the FastAPI TestClient against a fresh schema: the brief's acceptance tests (exactly-once sync with photos, QR without login and the 31st-in-an-hour 429, anonymity through the reporter seal, locked capture time and GPS, danger-now alerts and escalation, extreme band interim control and stop-work alert, after-photo rule, verifier separation, not-effective reopening, date change and dispute, inspection submit blocks, any-Fail rule, template versions with approver ≠ author, site scope 404s, duplicates and merge notices, disabled rule packs, audit chain verification after tampering) plus MFA, enrolment codes, password rules, sync conflicts saved as comments, admin-cannot-triage, the reminder ladder job, Web Push without VAPID keys, CSV exports with a BOM and Tamil text, site setup and posters, signed poster/report links (valid, expired, tampered, other record) and the console's request and response shapes.

The release was also checked end to end in Chromium (Playwright) against the real server and a freshly seeded database, at 390×844 for field users and 1280×800 for the console: online and offline reports with photos and hash checks, triage (with an extreme band), completion with an after-photo, verification and closure seen by the reporter, an inspection with a failed item, the Tamil QR form, the console (MFA with TOTP, dashboard, site wizard, poster through a signed link, user import, template copy → review → approval by another person, audit chain, Hindi), site scope — with no console errors and no failed requests.

## Load test

```bash
cd portal/server
python scripts/seed.py --demo        # the run signs in as SO-TN1, OWN-TN1-1..3 and WORKER-TN1-1..5
BASE_URL=https://your-server ADMIN_PASSWORD=… USERS=300 DURATION=120 REPORT=loadtest-report.json python scripts/loadtest.py
```

Mixed run: workers pull, push observations with a photo and upload it, list their reports and notifications; owners open their actions; officers work the inbox, triage with an action and open the dashboard. The JSON report has p50/p95/max per request type and the server's `Server-Timing`; the exit status is non-zero when any request fails. Other variables: `RAMP` (seconds to start all users), `SITE` (default TN1), `ADMIN_ID`, `DEMO_PASSWORD`. Run the client on a different machine from the server. Last results: 300 users, 0 failed (2.0); writes queue on the per-organisation audit-chain lock (create p50 ≈ 1.3 s at 300 concurrent users on one worker).

## Render test server

`render.yaml` at the repository root sets up a free test server: Render → **New → Blueprint** → this repository → enter a password for `ADMIN01` (and optionally a separate demo password) → **Apply**. It seeds the demo company on start (`SEED_ON_START`, `SEED_DEMO`), keeps photos in the database (`STORAGE_DRIVER=db`) and deploys a new `main` commit only after CI passes. Address: https://safeworks-portal.onrender.com — sign in with the logins in the table above.

Free-plan limits: it sleeps after 15 minutes idle (about a minute to wake), the free database expires 30 days after creation, and it is hosted in Singapore, so use test data only.

## Run it on a server

One command on a fresh Ubuntu server with ports 80 and 443 open:

```bash
git clone https://github.com/Julyraj/safeworks-india.git
sudo bash safeworks-india/portal/deploy/install.sh --demo     # leave out --demo for an empty company
```

It installs Docker, opens the firewall (also Oracle's iptables), writes `portal/.env` with random secrets (including `FIELD_ENCRYPTION_KEY`), starts SafeWorks with PostgreSQL and HTTPS (Caddy; `https://<ip-dashes>.sslip.io` unless you pass `--domain`), creates `ADMIN01` and a daily backup to `/var/backups/safeworks`. Run it again after `git pull` to update; `deploy/restore.sh` restores a backup (also how to move servers). By hand: `cp .env.example .env`, fill it in, `docker compose up -d --build`, `docker compose exec app python scripts/seed.py`, and put HTTPS in front of port 8080.

## Android app

GitHub Actions builds `SafeWorks-Portal.apk` on every push to `main` and publishes releases `portal-v2.0.N`. On first launch enter the server address (HTTPS), then sign in with your employee code and password, or with an enrolment code from your safety officer. Build locally: `npm run build -w web`, then `cd mobile && npm install && npx cap sync android && cd android && ./gradlew assembleDebug`. The Android app has no Web Push (that needs a Firebase project, an owner decision); it gets alerts in the app and by email.

## Configuration

Every variable, also listed one per line in `server/.env.example`:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://safeworks:safeworks@127.0.0.1:5432/safeworks` | PostgreSQL 16 connection |
| `APP_ENV` | — | `production` refuses the development secrets below |
| `PORT`, `HOST` | `8080`, `0.0.0.0` | listen address |
| `WEB_CONCURRENCY` | `1` | API processes (e.g. 2 on a 2-vCPU server) |
| `DB_POOL_MAX` | `20` | connection pool per process |
| `FILE_SIGNING_SECRET` | dev value | signs photo links, public upload tickets, status links and the 5-minute poster/report links. Required in production, 32+ random characters |
| `FIELD_ENCRYPTION_KEY` | dev value | AES-GCM key for phone numbers, QR reporter contacts, anonymous-report seals and TOTP secrets (`openssl rand -base64 32`). Required in production; keep it with the backups |
| `FILE_LINK_TTL_SECONDS` | `3600` | life of a signed photo link |
| `STORAGE_DRIVER` | `disk` | `disk` (files in `STORAGE_DIR`) or `db` (files in PostgreSQL, for hosts without a permanent disk) |
| `STORAGE_DIR` | `server/storage` | where photos, voice notes and reports live with `disk` |
| `DATA_DIR` | `<repo>/data` | library data (the seed reads `industries.json`) |
| `WEB_DIST` | `web/dist` | built front ends |
| `PUBLIC_URL` | `http://localhost:8080` (or `RENDER_EXTERNAL_URL`) | address printed on QR posters, status links and emails |
| `CORS_ORIGINS` | `https://localhost,capacitor://localhost,http://localhost:5173` | origins allowed to call the API (the Android app) |
| `TRUST_PROXY` | `false` | `true` behind a reverse proxy / load balancer |
| `RUN_JOBS` | `true` | run the background jobs in this process (one process wins each job) |
| `AUTO_MIGRATE` | `true` | apply `migrations/*.sql` at start |
| `LOG_LEVEL` | `warning` (`info` in production) | log level |
| `APP_TIMEZONE` | `Asia/Kolkata` | working days, quiet hours, job times |
| `SESSION_HOURS_FIELD` | `720` | field app session life (hours) |
| `SESSION_HOURS_ADMIN` | `8` | console session life (hours) |
| `MAX_FAILED_LOGINS`, `LOCK_MINUTES` | `10`, `15` | account lock after failed sign-ins |
| `USER_RATE_LIMIT` | `600` | API requests per minute per user (per process) |
| `MAX_MEDIA_BYTES` | `10485760` | upload cap per file (10 MB) |
| `QR_PER_TOKEN_HOUR`, `QR_PER_IP_HOUR` | `30`, `10` | public QR submissions per poster / per IP per hour |
| `QR_MAX_PAYLOAD` | `15728640` | public QR request cap (15 MB) |
| `IP_HASH_SALT` | `FILE_SIGNING_SECRET` | salt for the QR rate-limit IP hashes (kept 24 h) |
| `EXPORTS_PER_HOUR` | `10` | CSV exports per user per hour |
| `HASH_THREADS` | `8` | password-hashing threads |
| `SLOW_MS` | `1000` | log API requests slower than this |
| `SMTP_URL`, `MAIL_FROM` | empty, `SafeWorks <no-reply@safeworks.local>` | email; without `SMTP_URL` emails stay queued |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | empty | Web Push keys (`vapid --gen`). Without them the app's *Alerts on this phone* switch is off with an explanation, and push rows are marked failed with a clear error |
| `SEED_ORG_NAME` (or `SEED_COMPANY`) | `SafeWorks demo company` | organisation name on the first seed |
| `SEED_ADMIN_ID`, `SEED_ADMIN_PASSWORD` | `ADMIN01`, generated and printed | the first admin |
| `DEMO_PASSWORD` | `SEED_ADMIN_PASSWORD` | password of the `--demo` users |
| `SEED_ON_START`, `SEED_DEMO` | `false` | `scripts/start.sh` (the container): seed before starting, with `--demo` |
