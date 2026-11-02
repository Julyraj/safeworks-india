# Portal end-to-end test (real server, real browser)

`e2e-real.cjs` seeds a fresh demo database, starts the real Python server on a free port and drives the field app, the QR form and the admin console in Chromium: worker report online and offline → sync, officer triage (incl. extreme → stop-work alert), owner completion with after-photo, verifier separation, closure, inspection with a failed item, QR form in Tamil, admin MFA enrolment, site set-up wizard, posters through signed links, user import, template approval by a different HSE manager, audit-chain verify, language switch, site-scope isolation. 84 checks.

**It wipes the database in `DATABASE_URL`. Never point it at a real one.**

```bash
# once: PostgreSQL with an empty database "safeworks" (see HANDOVER.md §7), Python venv, Node 22, Playwright
cd portal && npm ci && cd web && npm run build && cd ../..
DATABASE_URL=postgres://safeworks:safeworks@127.0.0.1:55432/safeworks \
PYTHON=/srv/swvenv/bin/python \
node portal/e2e/e2e-real.cjs        # screenshots, server log and results.json land in portal/e2e/out/
```
Needs `npm i -D playwright` (or a global Playwright with Chromium) if `require("playwright")` is not available.
