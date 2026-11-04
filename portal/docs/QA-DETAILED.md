# SafeWorks Portal 2.1: detailed QA pass (4 Nov 2026)

This pass goes beyond the 769-case plan (`TEST-PLAN.md`, results in `TEST-RESULTS.md`). It covers code review, security
review, dependency audit, accessibility, small-screen layout, HTTP hardening, login lockout and load. Every finding
below was reproduced against a running server and real database before it was fixed. Each fix has an automated test.

## Summary

| Check | Tool | Result before | After fixes |
|---|---|---|---|
| Security code review (auth, scoping, uploads, links) | manual review + live tests | **4 defects (S1–S4)**, two of them high | Fixed; `tests/test_security.py` |
| Correctness review of the 2.1 changes | manual review + live tests | **4 defects (C1–C4)** | Fixed; `tests/test_security.py` |
| SQL injection (30 string-built queries flagged by Bandit) | Bandit B608 + reading each one | 0 injectable: every value is a `$n` parameter, sort columns come from a whitelist | — |
| Python lint (errors, unused/undefined names) | Ruff (E9, F, B) | 0 errors (206 B008 warnings are FastAPI's normal `Depends()` pattern) | — |
| Python dependencies | pip-audit | **`cryptography` 46.0.3: 13 known vulnerabilities** | Upgraded to 50.0.0; 0 known |
| Web dependencies | npm audit | 0 known vulnerabilities | — |
| Accessibility, WCAG 2.1 A/AA, 37 screens (phone app as worker and officer, sign-in, QR form, 15 console pages) | axe-core 4.10 | **13 serious**: low-contrast amber/orange text on 12 screens; a button inside a button (notifications) | **0 serious or critical** |
| Phone-width layout (320 px; console at 768 px), 25 screens | Playwright | 0 screens scroll sideways | — |
| HTTP security headers | live request | CSP (`script-src 'self'`, `frame-ancestors 'none'`), nosniff, HSTS, no-referrer present; **Permissions-Policy missing** | Added (camera, microphone, location: this site only) |
| CORS from another site | live request | Refused (no `Access-Control-Allow-Origin`) | — |
| Login lockout | live request | Locks after 10 wrong passwords (429), also refusing the right password while locked | — |
| Load: 40 signed-in users at once, 400 requests (me, lists, sync pull, charts, notifications) | Node fetch | 0 errors; median 120 ms, 95th percentile 237 ms, slowest 349 ms | — |

## Defects found and fixed

| # | Severity | Defect | Fix | Test |
|---|---|---|---|---|
| S1 | High | With only the password, a pre-MFA session could enrol a **new** authenticator over the existing one and get a full session, so MFA gave no protection (and wiped the real authenticator) | Once MFA is set up, enrol/confirm need a session that has passed MFA (403 `err.mfa_already_enrolled`); a lost phone is reset by an administrator | `test_s1_*` |
| S2 | High | Any officer could issue an enrolment code for the site head or another officer, set their password and be signed in as them, without MFA | Officers and site heads may issue codes only for people below them, at sites where they are officer or above; signing in with a code still asks for MFA when the role needs it | `test_s2_*` |
| S3 | Medium | A user who was an officer at one site and only a reporter at another could list **every** report, action and inspection of the second site with `?siteId=` (detail pages were already refused) | Lists, dashboard and exports accept only sites where the user may see every record; the console's site filter lists only those sites | `test_s3_*` |
| S4 | Medium | Anyone who could view a photo (verifier, officer, auditor) could overwrite its bytes, so evidence could be swapped | Only the person who took the photo uploads it; a photo whose bytes matched its capture fingerprint is locked (409 `err.media_locked`) | `test_s4_*` |
| C1 | High | Export site check read `siteIds`, the export read `siteId`: `?siteIds=A&siteId=B` checked A and exported B | Both parameters are checked and the export uses exactly the checked list | `test_c1_*` |
| C2 | Medium | Charts with dates entered the wrong way round left out most of the first and last day | Swap the dates, then take whole days again | `test_c2_*` |
| C3 | Medium | Full report (Excel) with reversed dates: Summary showed N reports, Reports and Actions sheets were empty | Sheets use the same period as the Summary | `test_c3_*` |
| C4 | Low | In the Excel report, "At risk" meant unsafe act/condition in the Summary but also included near misses in the Trend table | Trend column renamed "Unsafe act, condition or near miss" (4 languages) | — |
| A1 | Serious (WCAG 1.4.3) | Amber and orange text on pills, risk bands, SLA and KPI figures was 2.4:1 and 3.3:1 (minimum 4.5:1) | New text shades `--amber-ink` (5.9:1) and `--orange-ink` (5.4:1); fills and swatches unchanged; dark mode unchanged | axe run: 0 |
| A2 | Serious (WCAG 4.1.2) | Notification rows were a button with the Acknowledge button inside | Only the text part opens the item | axe run: 0 |
| A3 | Serious (WCAG 1.4.3) | Attention board "all clear" cards were drawn at 75% opacity, so their small text lost contrast | Light background instead of opacity | axe run: 0 |
| H1 | Low | No Permissions-Policy header | Added | live header check |

## Not covered here (and why)

- **Android app and real phones**: only browsers are available in this test setup (see the 14 manual cases in `TEST-RESULTS.md`).
- **Penetration test by an outside party**: recommended before go-live; this pass is an internal review.
- **Other browsers**: only Chromium is installed here; Firefox and Safari should be checked by hand.
- **Load beyond 40 users**: the test server runs one process on a shared machine; a sizing test should run on the real hosting.

## How to repeat

```
cd portal/server && STORAGE_DRIVER=disk TEST_DATABASE_URL=... python -m pytest tests -q        # 70 server tests, incl. security
bandit -q -r safeworks -ll ; ruff check safeworks --select E9,F,B ; pip-audit -r requirements.txt
cd portal/web && npm audit
DATABASE_URL=... AXE=/path/to/axe.min.js node portal/e2e/qa_extra.cjs      # accessibility, layout, headers, CORS, lockout, load (WIPES that database)
```
