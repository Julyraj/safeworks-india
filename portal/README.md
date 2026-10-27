# SafeWorks Portal

Safety observation system for one company with many construction sites, factories and plants:

- **User portal (website + installable web app) and Android app**: safety officers raise observation points with 1–2 photos, assign an action owner and a due date; supervisors, each with their own login, close the points assigned to them with a comment and an optional after-photo; the site safety officer approves the closure.
- **Admin console** at `/admin/`, a separate sign-in for a few named admins: sites and areas, users and roles, setting and resetting passwords, bulk user import, contractors, master lists, settings (due dates by risk), observations across all sites, audit log and CSV export.
- **Safety library** at `/library/`: the existing SafeWorks India procedures, first aid, checklists and regulations.

The design is in the *SafeWorks Portal – System Structure* document. This folder is Phase 1 (MVP pilot).

## How it is built

| Part | Stack |
| --- | --- |
| API | Python 3.12, FastAPI, asyncpg, run by uvicorn (`server/`) |
| Database | PostgreSQL 16, numbered SQL migrations (`server/migrations/`) |
| Photos | Server disk (`STORAGE_DIR`) for the pilot; short-lived signed links; an S3-compatible store can replace it |
| Portal + admin console | React + TypeScript, Vite (`web/`), one build, two entry pages. Node is needed only to build them. |
| Android app | Capacitor wrapper around the portal (`mobile/`) |

One container serves the API, the portal, the admin console and the library. It runs on a cloud server in India or on a company server; hosting is still to be decided.

## Roles and rules (enforced on the server)

- **Safety officer** (1–5 per site): raises points (any number, up to about 50 a day), assigns owners, edits, extends due dates, cancels and reopens, and approves or rejects closures. They cannot approve a closure they submitted themselves.
- **Supervisor**: has their own login and sees only the points assigned to them. They submit the closure (comment required, photos optional). They cannot raise or approve points.
- **Admin**: everything, plus the admin console, including setting and resetting any user's password.
- **Management viewer / auditor**: read only.
- Every point needs at least 1 photo and can have at most 2. Due dates come from the risk level (Critical 1 day, High 3, Medium 7, Low 15), and admins can change these in Settings.
- Login is employee ID + password. A temporary password must be changed at first sign-in. After 5 wrong passwords the account locks for 15 minutes, and an admin can unlock it. Admins never see existing passwords. Every reset is in the audit log, and a reset signs the user out everywhere.
- Every change to a point is stored as a new version (who, when, which fields changed, and the reason).

## Run it locally

Requires Python 3.12, PostgreSQL 16, and Node 22 (only to build the screens).

```bash
cd portal
npm install && npm run build                # builds the screens into web/dist
cd server
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
createdb safeworks                           # or use docker compose below
export DATABASE_URL=postgres://USER:PASS@localhost:5432/safeworks
python scripts/seed.py                       # 2.0 configuration (matrix, rules, categories, 15 templates, 23 industries, 5 sites) and ADMIN01
python -m safeworks                          # http://localhost:8080  (field app: /, QR form: /q/<token>, admin console: /admin/)
```

`python scripts/seed.py --demo` adds one user per role per site (`SO-TN1`, `SH-TN1`, `VER-TN1`, `OWN-TN1-1..3`, `WORKER-TN1-1..5`, same for TN2, TN3, KA1, KA2, plus `HSE01` and `AUD01`), contractors, people, 200 observations in every status with Tamil, Kannada, Hindi and English text, actions, inspection runs and notifications. The demo password is `DEMO_PASSWORD`, or the admin password when it is empty. The seed is idempotent. `ADMIN01` must set up an authenticator app at first sign-in (`OrgSettings.mfaRequiredRoles`, default admin, HSE manager, site head).

The API contract is `docs/API.md` (types in `web/src/shared/types.ts`). Server-side texts (errors, notifications, posters, reports) are in `server/safeworks/i18n/{en,hi,ta,kn}.json`; the Hindi, Tamil and Kannada packs are drafts for review by site staff and can be overridden per company from the admin console.

For several CPU cores, set `WEB_CONCURRENCY` (number of API processes, e.g. `2` on a 2-vCPU server). Background jobs (critical-alert watcher, reminder ladder and SLAs, inspection scheduler, closure notices, digests, push and email senders, retention dry run) run inside the API process when `RUN_JOBS=true`; one process wins each job through `job_marks`. `python -m safeworks.jobs` runs every job once.

## Free test server (Render, about 10 minutes)

For trying the app before hosting is chosen, `render.yaml` at the repository root sets up a test server on Render's free plan:
1. Sign in at render.com with GitHub, then choose **New → Blueprint** and pick this repository.
2. Enter a password for `ADMIN01` (8+ characters with letters and numbers). Leave the demo password empty to use the same one, then apply.
3. When it shows *Live*, copy the address, e.g. `https://safeworks-portal.onrender.com`.
   - Type it into the Android app's *Server address*.
   - Or open it in a browser. The admin console is at `/admin/`.
4. Sign in with one of these:
   - `ADMIN01` (admin)
   - `SO-PS01-1` (safety officer)
   - `SUP-PS01-1` (supervisor)

Free-plan limits:
- The server sleeps after 15 minutes without use and takes about a minute to wake.
- The free database expires after 30 days.
- It's hosted in Singapore, so use test data only.

Photos are kept in the database (`STORAGE_DRIVER=db`), because free servers have no permanent disk.

## Run it on a server (one command)

On a fresh Ubuntu server (Oracle Cloud Always Free, AWS Lightsail, DigitalOcean or a company server) with ports 80 and 443 open:

```bash
git clone https://github.com/Julyraj/safeworks-india.git
sudo bash safeworks-india/portal/deploy/install.sh --demo     # leave out --demo for an empty company
```

It installs Docker, opens the server firewall, writes `portal/.env` with random secrets, starts SafeWorks with PostgreSQL and HTTPS (Caddy, free certificate; address `https://<server-ip>.sslip.io` unless you pass `--domain`), creates the `ADMIN01` login and sets up a daily backup to `/var/backups/safeworks`. Run it again after `git pull` to update. `deploy/restore.sh` restores a backup, which is also how to move to another server.

## Run it on a server (Docker by hand)

```bash
cd portal
cp .env.example .env          # set DB_PASSWORD, FILE_SIGNING_SECRET, PUBLIC_URL, SMTP_URL
docker compose up -d --build
docker compose exec app python scripts/seed.py
```

Put HTTPS in front of port 8080 before anyone signs in, using Caddy, Nginx or the cloud load balancer. Back up the `pgdata` and `storage` volumes daily.

## Tests

```bash
cd portal/server
pip install -r requirements-dev.txt
TEST_DATABASE_URL=postgres://USER:PASS@localhost:5432/safeworks_test python -m pytest tests     # wipes that database
```

32 end-to-end tests through the FastAPI TestClient against a fresh schema and the base seed, covering the brief's acceptance tests 1, 3–10, 12, 14–18, 20 and 22: exactly-once sync with three photos, QR without login and the 31st-in-an-hour 429, anonymity through the reporter seal, locked captured time and GPS, danger-now alerts and the 30-minute escalation, extreme-band interim control and stop-work alert, after-photo rule, verifier separation, not-effective reopening, date change and dispute, inspection submit blocks, any-Fail rule, template versions (approver ≠ author), site scope 404s, duplicate suggestions and merge notices, disabled rule packs, audit chain verification after a direct `update audit_log`, plus MFA, enrolment codes, password rules, sync conflicts saved as comments, admin-cannot-triage, the reminder ladder job, Web Push without VAPID keys, CSV exports with a BOM and Tamil text, site setup and posters.

## Load test

```bash
cd portal/server
pip install -r requirements-dev.txt
python scripts/seed.py --demo        # the run signs in as SO-TN1, OWN-TN1-1..3 and WORKER-TN1-1..5
BASE_URL=https://your-server ADMIN_PASSWORD=… USERS=300 DURATION=120 REPORT=loadtest-report.json python scripts/loadtest.py
```

A 300-user mixed run: workers pull, push observations with a photo and upload it, list their reports and notifications; owners open their actions; officers work the inbox, triage with an action and open the dashboard. The JSON report has p50/p95/max per request type and the server's own `Server-Timing`; the exit status is non-zero when any request fails. `ADMIN01` is not used because it needs MFA; `DEMO_PASSWORD` falls back to `ADMIN_PASSWORD` exactly like the seed.

## Android app

GitHub Actions builds `SafeWorks-Portal.apk` on every push to `main` (releases tagged `portal-v1.0.N`). On first launch, enter the server address (HTTPS) and sign in with your employee ID. To build locally: `npm run build -w web`, then `cd mobile && npm install && npx cap sync android && cd android && ./gradlew assembleDebug`.

## Configuration

Every variable is listed with one line each in `server/.env.example`. The ones that matter most:

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection |
| `FILE_SIGNING_SECRET` | Signs file links, public upload tickets and status links. Required in production, 32+ characters. |
| `FIELD_ENCRYPTION_KEY` | AES-GCM key for phones, QR reporter contacts, anonymous-report seals and TOTP secrets (`openssl rand -base64 32`; any 32+ character random string also works). Required in production. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push. When unset, push rows are marked failed with a clear error and nothing else changes. |
| `STORAGE_DIR` / `STORAGE_DRIVER` | Where photos, voice notes and reports live: `disk` (default) or `db` for hosts without a persistent disk |
| `SEED_ON_START`, `SEED_DEMO`, `SEED_ORG_NAME`, `SEED_ADMIN_PASSWORD`, `DEMO_PASSWORD` | Seeding at container start |
| `PUBLIC_URL` | Address in QR posters, status links and emails |
| `SMTP_URL`, `MAIL_FROM` | Email delivery. Without it, emails stay queued. |
| `QR_PER_TOKEN_HOUR`, `QR_PER_IP_HOUR`, `EXPORTS_PER_HOUR` | Public-form and export rate limits (design defaults 30, 10, 10) |
| `CORS_ORIGINS`, `TRUST_PROXY`, `APP_TIMEZONE`, `WEB_CONCURRENCY`, `DB_POOL_MAX`, `RUN_JOBS` | Hosting and process settings |
