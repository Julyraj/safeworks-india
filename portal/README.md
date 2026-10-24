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
python scripts/seed.py                       # master lists, company, 5 pilot sites, prints the first admin login
python -m safeworks                          # http://localhost:8080  (admin console: /admin/)
```

`python scripts/seed.py --demo` adds sample users and about 180 observations. It is for testing only, and the demo password is `Safe@1234`.

For several CPU cores, set `WEB_CONCURRENCY` (number of API processes, e.g. `2` on a 2-vCPU server).

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

There are 12 end-to-end tests of the workflow and the permission rules:
- lockout and admin unlock
- forced password change
- admin-console access
- photo rules
- the full raise → close → reject → resubmit → approve cycle, including site isolation
- no self-approval
- safe behaviour and corrected-on-the-spot points
- versioned edits
- user creation, password reset and set
- bulk import
- dashboards and CSV export
- settings

And 5 tests of the HTTP layer: security headers, the 14 MB upload limit (also for uploads sent without a declared size), photo-link signatures and the web-folder boundary.

## Load test

```bash
cd portal/server
pip install -r requirements-dev.txt
BASE_URL=https://your-server ADMIN_ID=ADMIN01 ADMIN_PASSWORD=… USERS=100 DURATION=1800 python scripts/loadtest.py
# scale gate: USERS=1000 SITES=10 RAMP=120
```

The test creates load-test users on sites `LT01…` and signs everyone in, like a shift-start rush. It then runs safety officers and supervisors through the real screens with real photo uploads. Finally it cuts uploads off mid-way and retries them, checking that no point is lost or duplicated. The pass mark is under 0.1% failed requests, 95% of screens in under 2 s, and a 2-photo upload in under 10 s. Deactivate the `LT-` users afterwards on a live system. Run the test from a different machine than the server, so the two do not compete for CPU: at 1,000 users the test itself needs about one CPU core. Each response carries a `Server-Timing` header, and the report shows time inside the server next to the time seen by the test machine; API requests slower than `SLOW_MS` (default 1000) are logged.

## Android app

GitHub Actions builds `SafeWorks-Portal.apk` on every push to `main` (releases tagged `portal-v1.0.N`). On first launch, enter the server address (HTTPS) and sign in with your employee ID. To build locally: `npm run build -w web`, then `cd mobile && npm install && npx cap sync android && cd android && ./gradlew assembleDebug`.

## Configuration

See `.env.example` and `server/safeworks/config.py`. The main settings:

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection |
| `FILE_SIGNING_SECRET` | Signs photo links. Required in production, 32+ characters. |
| `STORAGE_DIR` | Where photos are stored |
| `STORAGE_DRIVER` | `disk` (default) or `db`, which keeps photos in PostgreSQL for hosts without a persistent disk |
| `SEED_ON_START`, `SEED_DEMO` | Run the idempotent seed (and sample data) when the container starts |
| `PUBLIC_URL` | Links in emails |
| `SMTP_URL` | Email delivery. Without it, emails stay queued. |
| `CORS_ORIGINS` | Origins allowed for the Android app |
| `TRUST_PROXY` | Set to `true` behind a reverse proxy |
| `APP_TIMEZONE` | Defaults to `Asia/Kolkata` |
| `WEB_CONCURRENCY` | Number of API processes (default 1; the Docker image uses 2) |
| `DB_POOL_MAX` | Database connections per API process (default 20) |
