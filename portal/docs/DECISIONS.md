# SafeWorks Portal 2.0 — decisions

The build briefs (`SafeWorks_India_Build_Brief.md`, `SafeWorks_Portal_Build_Brief.md` = Parts 1–3) left these open. Each line says what 2.0 does and why; change a line here before changing the code.

## Open decisions from the Portal brief §18

| # | Decision | What 2.0 does | Why |
|---|---|---|---|
| 1 | Repository | Stays in `Julyraj/safeworks-india` (library at the root, portal in `portal/`). Company data never enters the repo: seeds are synthetic, secrets come from the environment. | Already public, CI, releases and the Render blueprint point here; the library is served inside the portal at `/library/`. |
| 2 | Stack | **Python 3.12 FastAPI + asyncpg + PostgreSQL 16** server; React + TypeScript (Vite) PWA; Capacitor Android; one Docker image. Not PocketBase. | Makesh chose Python the day before; the 1.x Python server is load-tested (1,000 users, 0 failures) and deployed. PocketBase would discard that and add a pre-1.0 dependency run by one volunteer. The schema is plain SQL and portable. |
| 3 | Android app or PWA only | PWA + Capacitor Android APK built by CI (`SafeWorks-Portal.apk`). No iOS store app; iPhone users get the PWA. | As the brief recommends. |
| 4 | Production hosting | Undecided; the layout runs on Render (test), Oracle Always Free (`portal/deploy/install.sh`), or any small VM. No code change between them. | Decide before Gate B. |
| 5 | WhatsApp provider | Not in 2.0 (Phase 2). The notification table has the `whatsapp` channel ready. | Paid; needs an INR-billed BSP before 31 Dec 2026. |
| 6 | SMS / DLT / worker OTP | Not in 2.0. Workers sign in with an employee code + password or an officer-issued **enrolment code** (free). Staff use email + password + TOTP. | Both OTP channels cost money; enrolment codes meet the "no login friction" goal for the pilot. |
| 7 | India-region hosting | Render has no India region (Singapore). Oracle Mumbai/Hyderabad or Lightsail Mumbai for production. | Data residency preference, not a legal requirement found. |
| 8 | User count | Built and load-tested for 150–1,000 users; no per-seat limits anywhere. | — |
| 9 | Languages per site | English, Hindi, Tamil, Kannada everywhere, per user; translations marked *draft — review by site staff*. | — |
| 10 | Rule set per site | Seeded as brief §16.5: TN construction → `BOCW_TN_LEGACY`, TN factory → `TN_FACTORY_LEGACY`, KA construction → `BOCW_KA_PROVISIONAL`, KA factory → `KA_FACTORY_LEGACY`. Drafts (`KA_OSH_DRAFT_2026`, `TN_OSH_DRAFT_2022`) ship disabled and cannot be assigned until a reviewer is named. | — |
| 11 | Legal reviewer | Not named. `rule_sets.reviewed_by` is empty; the admin screen shows which packs are unreviewed. | Needed before Gate C (Phase 2 incidents). |
| 12 | Data retention | 5 years after closure for observations, actions, inspections (design default); registers per statute; audit log ≥ 1 year. 2.0 only **reports** what retention would erase (dry run); nothing is deleted automatically. | Needs legal review first. |
| 13 | Anonymity | As brief §8.9: the anonymous reporter's id is stored only in an encrypted seal; no role sees it; "My reports" and the closure notice work through an HMAC. Break-glass database access is not built; it would be a logged manual query under a written legal requirement. | — |
| 14 | Who verifies | Anyone with the `verifier`, `site_safety_officer`, `site_head` or `hse_manager` role at the site who is neither the owner nor the completer (server returns 403 otherwise). | — |
| 15 | Pilot site and budget | Not decided. No paid service is enabled in 2.0 (push is Web Push/VAPID, free; email through the company SMTP). | — |

## Decisions made while building

- **Industries are first-class.** `industry_profiles` (the same 23 codes as the SafeWorks India library) seed a site's categories, inspection templates, default areas and library links. `POST /admin/sites/{id}/setup {industryCode}` is the 3-step site set-up.
- **Commands, not rows.** The phone never writes a status; it queues commands (`observation.create`, `observation.triage`, `action.complete`, `inspection_run.submit` …) with a `commandId`; the server applies them idempotently and both REST and sync paths call the same workflow functions.
- **Text first, photos after.** A report syncs without its photos; media rows start `pending`, bytes follow through `PUT /media/{clientUuid}` with a SHA-256 taken on the phone; the server records `hash_match`.
- **Inspection reports are locked HTML, printed to PDF by the browser.** Server-side PDF with Tamil/Kannada shaping needs a browser engine the free hosts cannot run; a self-contained HTML snapshot (photos beside items, signatures, times, GPS, template version) stored as media is immutable and prints to PDF correctly in every script. Labelled a design decision.
- **Web Push, not FCM.** Free, no Google account, works in the installed PWA and Chrome; the Android wrapper gets in-app notifications and email until FCM is added (needs a Firebase project — the owner's decision).
- **Fresh 2.0 schema; 1.x archived, not dropped.** A database with 1.x tables is moved into schema `v1_archive` on first start. Nothing is deleted.
- **MFA** (TOTP) is required for `admin`, `hse_manager`, `site_head` by default (`OrgSettings.mfaRequiredRoles`); officers can be added by the admin. Enrolment happens at first sign-in.
- **Statutory timers are configuration only in 2.0.** `rule_sets` and `timer_rules` are seeded with their status labels and shown in the admin console; incidents (Phase 2) will start clocks from them. Phase 1 "escalate" records `learned_at` and the paper procedure.
