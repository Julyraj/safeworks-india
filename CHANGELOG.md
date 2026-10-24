# Changelog

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
