# SafeWorks enablement suite

Three deliverables for onboarding clients, built from the real application (Portal 2.1, UI version 2):

| File | What it is |
|---|---|
| `SafeWorks-Client-Onboarding.pptx` | 10-slide onboarding deck with speaker notes: hook, problem, solution, workflow, three feature deep dives, use case, what you will measure, call to action |
| `SafeWorks-User-Guide.docx` | User guide: executive overview, how it works, feature matrix, three step-by-step use cases, troubleshooting and FAQ |
| `SafeWorks-Product-Walkthrough.mp4` | 3-minute narrated walkthrough recorded from the app (kept out of git because of its size; regenerate with the scripts below) |

## Regenerating

The scripts in `scripts/` rebuild everything from a running demo server (`DATABASE_URL`, `DEMO_PW`, `ADMIN_PW` in the environment; never commit passwords):

1. `node scripts/deck.js out/deck.pptx` and `node scripts/guide.js out/guide.docx` (need `pptxgenjs`, `docx`, `sharp`, `react-icons`, `jszip`; screenshots from `portal/e2e/screens.cjs` in `SHOTS`).
2. `node scripts/cards.cjs layers/` renders the title cards and scene layers.
3. `node scripts/record.cjs frames/ shots/` records the scenes from the app with a visible cursor (`SCENES=` to re-record some).
4. Narration: `piper` with the `en-us-lessac-medium` voice reads `segments.json` into `vo/*.wav`.
5. `python scripts/compose.py <video dir> out/walkthrough.mp4` assembles the video.

The video's B-roll suggestions (cinematic prompts for an AI video generator) are in the storyboard in the session notes; the produced video uses real screen recordings instead.
