# SafeWorks enablement suite

Deliverables for onboarding clients, built from the real application (Portal 2.1, UI version 2).

Short set (first meeting):

| File | What it is |
|---|---|
| `SafeWorks-Client-Onboarding.pptx` | 10-slide onboarding deck with speaker notes: hook, problem, solution, workflow, three feature deep dives, use case, what you will measure, call to action |
| `SafeWorks-User-Guide.docx` | User guide: executive overview, how it works, feature matrix, three step-by-step use cases, troubleshooting and FAQ |
| `SafeWorks-Product-Walkthrough.mp4` | 3-minute narrated walkthrough recorded from the app (kept out of git because of its size; regenerate with the scripts below) |

Complete set (training and reference, every screen and option):

| File | What it is |
|---|---|
| `SafeWorks-Complete-Guide.pptx` | 35-slide deck with speaker notes: roles, every phone screen (sign-in, home, quick report, reports, triage, actions, verification, inspections, notifications, outbox, charts, settings), the QR form, every console page, settings defaults, security options and background jobs |
| `SafeWorks-Complete-Reference.docx` | 36-page reference: roles matrix, screen-by-screen option tables with screenshots, QR form, console registers and configuration pages, every setting with its default, every notification event, background jobs, security rules, statuses and glossary |
| `SafeWorks-Complete-Walkthrough.mp4` | 5-minute narrated walkthrough of 24 screens recorded from the app, with burned-in captions (kept out of git; `SafeWorks-Complete-Walkthrough.srt` is the caption file) |

## Regenerating

The scripts in `scripts/` rebuild everything from a running demo server (`DATABASE_URL`, `DEMO_PW`, `ADMIN_PW` in the environment; never commit passwords):

1. `node scripts/deck.js out/deck.pptx` and `node scripts/guide.js out/guide.docx` (need `pptxgenjs`, `docx`, `sharp`, `react-icons`, `jszip`; screenshots from `portal/e2e/screens.cjs` in `SHOTS`).
2. `node scripts/cards.cjs layers/` renders the title cards and scene layers.
3. `node scripts/record.cjs frames/ shots/` records the scenes from the app with a visible cursor (`SCENES=` to re-record some).
4. Narration: `piper` with the `en-us-lessac-medium` voice reads `segments.json` into `vo/*.wav`.
5. `python scripts/compose.py <video dir> out/walkthrough.mp4` assembles the video.

The complete set uses the `*2` scripts the same way: `screens-all.cjs` captures every screen, `deck2.js` and `guide2.js` build the deck and the reference, `cards2.cjs` renders the layers, `record2.cjs` records the 24 scenes (`segments2.json` holds the narration), and `compose2.py` assembles the video, writes the `.srt` and burns the captions in.

The video's B-roll suggestions (cinematic prompts for an AI video generator) are in the storyboard in the session notes; the produced video uses real screen recordings instead.
