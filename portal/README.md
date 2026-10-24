# SafeWorks Portal

Safety observation system for one company with many construction sites, factories and plants:

- **User portal (website + installable web app) and Android app**: safety officers raise observation points with 1–2 photos, assign an action owner and a due date; supervisors, each with their own login, close the points assigned to them with a comment and an optional after-photo; the site safety officer approves the closure.
- **Admin console** at `/admin/`, a separate sign-in for a few named admins: sites and areas, users and roles, setting and resetting passwords, bulk user import, contractors, master lists, settings (due dates by risk), observations across all sites, audit log and CSV export.
- **Safety library** at `/library/`: the existing SafeWorks India procedures, first aid, checklists and regulations.

The design is in the *SafeWorks Portal – System Structure* document. This folder is Phase 1 (MVP pilot).

## How it is built

| Part | Stack |
| --- | --- |
| API | Node.js 22, TypeScript, Fastify (`server/`) |
| Database | PostgreSQL 16, numbered SQL migrations (`server/migrations/`) |
| Photos | Server disk (`STORAGE_DIR`) for the pilot; short-lived signed links; an S3-compatible store can replace it |
| Portal + admin console | React + TypeScript, Vite (`web/`), one build, two entry pages |
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

Requires Node 22 and PostgreSQL 16.

```bash
cd portal
npm install
createdb safeworks            # or use docker compose below
export DATABASE_URL=postgres://USER:PASS@localhost:5432/safeworks
npm run build
npm run seed                   # master lists, company, 5 pilot sites, prints the first admin login
npm start                      # http://localhost:8080  (admin console: /admin/)
```

`npm run seed:demo` adds sample users and about 180 observations. It is for testing only, and the demo password is `Safe@1234`.

## Run it on a server (Docker)

```bash
cd portal
cp .env.example .env          # set DB_PASSWORD, FILE_SIGNING_SECRET, PUBLIC_URL, SMTP_URL
docker compose up -d --build
docker compose exec app npm run seed
```

Put HTTPS in front of port 8080 before anyone signs in, using Caddy, Nginx or the cloud load balancer. Back up the `pgdata` and `storage` volumes daily.

## Tests

```bash
TEST_DATABASE_URL=postgres://USER:PASS@localhost:5432/safeworks_test npm test
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

## Load test

```bash
BASE_URL=https://your-server ADMIN_ID=ADMIN01 ADMIN_PASSWORD=… USERS=100 DURATION=1800 npm run loadtest
# scale gate: USERS=1000 SITES=10 RAMP=120
```

The test creates load-test users on sites `LT01…` and signs everyone in, like a shift-start rush. It then runs safety officers and supervisors through the real screens with real photo uploads. Finally it cuts uploads off mid-way and retries them, checking that no point is lost or duplicated. The pass mark is under 0.1% failed requests, 95% of screens in under 2 s, and a 2-photo upload in under 10 s. Deactivate the `LT-` users afterwards on a live system.

## Android app

GitHub Actions builds `SafeWorks-Portal.apk` on every push to `main` (releases tagged `portal-v1.0.N`). On first launch, enter the server address (HTTPS) and sign in with your employee ID. To build locally: `npm run build -w web`, then `cd mobile && npm install && npx cap sync android && cd android && ./gradlew assembleDebug`.

## Configuration

See `.env.example` and `server/src/config.ts`. The main settings:

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection |
| `FILE_SIGNING_SECRET` | Signs photo links. Required in production, 32+ characters. |
| `STORAGE_DIR` | Where photos are stored |
| `PUBLIC_URL` | Links in emails |
| `SMTP_URL` | Email delivery. Without it, emails stay queued. |
| `CORS_ORIGINS` | Origins allowed for the Android app |
| `TRUST_PROXY` | Set to `true` behind a reverse proxy |
| `APP_TIMEZONE` | Defaults to `Asia/Kolkata` |
