/* SafeWorks complete guide deck: every screen and every option, 33 slides, structured (theme, layouts, placeholders). */
const path = require("path");
const fs = require("fs");
const pptxgen = require("pptxgenjs");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const sharp = require("sharp");
const Fi = require("react-icons/fi");
const { applyTheme } = require(process.env.PPTX_SKILL + "/scripts/apply_theme.js");

const SHOTS = process.env.SHOTS;      // shots2 (every screen)
const SHOTS1 = process.env.SHOTS1;    // earlier screenshots (fallbacks)
const OUT = process.argv[2];
const THEME = { name: "SafeWorks", headFontFace: "Arial", bodyFontFace: "Calibri", colors: { dk1: "0F172A", lt1: "FFFFFF", dk2: "334155", lt2: "F5F6F8", accent1: "F5C400", accent2: "1D5FA7", accent3: "1F7A4D", accent4: "D9620B", accent5: "C62828", accent6: "5B6676", hlink: "1D5FA7", folHlink: "5B6676" } };
const H = THEME.colors;
async function icon(Icon, color, size = 256) { const svg = renderToStaticMarkup(React.createElement(Icon, { color: "#" + color, size })); const buf = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer(); return "image/png;base64," + buf.toString("base64"); }
function shot(name) { for (const d of [SHOTS, SHOTS1]) { const p = path.join(d, name); if (fs.existsSync(p)) return p; } return null; }

(async () => {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9";
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  pres.author = "SafeWorks"; pres.title = "SafeWorks complete guide";
  const C = pres.SchemeColor;
  pres.defineSlideMaster({ title: "TITLE_DARK", background: { color: H.dk1 }, objects: [{ placeholder: { options: { name: "title", type: "title", x: 0.6, y: 1.5, w: 5.6, h: 1.8, fontSize: 38, bold: true, color: C.background1, valign: "middle", align: "left", margin: 0 } } }] });
  pres.defineSlideMaster({ title: "CONTENT", background: { color: H.lt1 }, objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.5, y: 0.3, w: 9, h: 0.65, fontSize: 26, bold: true, color: C.text1, valign: "middle", align: "left", margin: 0 } } },
    { text: { text: "SafeWorks · Complete guide", options: { x: 0.5, y: 5.22, w: 5, h: 0.3, fontSize: 10, color: C.accent6, margin: 0 } } },
  ], slideNumber: { x: 9.1, y: 5.22, w: 0.5, h: 0.3, fontSize: 10, color: H.accent6 } });
  pres.defineSlideMaster({ title: "SECTION", background: { color: H.dk1 }, objects: [{ placeholder: { options: { name: "title", type: "title", x: 0.6, y: 2.0, w: 8.8, h: 1.2, fontSize: 40, bold: true, color: C.background1, valign: "middle", align: "left", margin: 0 } } }] });

  const mark = (s, x, y, d = 0.6) => { s.addShape(pres.ShapeType.roundRect, { x, y, w: d, h: d, fill: { color: C.accent1 }, line: { color: C.accent1 }, rectRadius: 0.12, objectName: "mark" }); s.addText("SW", { x, y, w: d, h: d, fontSize: d * 24, bold: true, color: C.text1, align: "center", valign: "middle", margin: 0, isTextBox: true, objectName: "SW" }); };
  const card = (s, x, y, w, h, name) => s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: C.background2 }, line: { color: "E4E7EC", width: 0.75 }, rectRadius: 0.12, objectName: name });
  const phone = (s, file, x, y, h, name) => { const p = shot(file); if (!p) return 0; const w = h * 780 / 1688; s.addShape(pres.ShapeType.roundRect, { x: x - 0.07, y: y - 0.07, w: w + 0.14, h: h + 0.14, fill: { color: "1E293B" }, line: { color: "1E293B" }, rectRadius: 0.22, objectName: name + " frame" }); s.addImage({ path: p, x, y, w, h, objectName: name }); return w; };
  const monitor = (s, file, x, y, w, name) => { const p = shot(file); if (!p) return 0; const h = w * 900 / 1440; s.addShape(pres.ShapeType.roundRect, { x: x - 0.06, y: y - 0.06, w: w + 0.12, h: h + 0.12, fill: { color: "1E293B" }, line: { color: "1E293B" }, rectRadius: 0.08, objectName: name + " frame" }); s.addImage({ path: p, x, y, w, h, objectName: name }); return h; };
  // option groups as rich bullet text: [{head, items}]
  const options = (s, groups, x, y, w, h, size = 12) => {
    const runs = [];
    groups.forEach((g, gi) => {
      if (g.head) runs.push({ text: g.head, options: { bold: true, fontSize: size + 1, color: C.text1, breakLine: true, paraSpaceBefore: gi ? 6 : 0, paraSpaceAfter: 2 } });
      g.items.forEach((it, i) => {
        const last = gi === groups.length - 1 && i === g.items.length - 1;
        if (Array.isArray(it)) runs.push({ text: it[0] + ": ", options: { bold: true, bullet: true, fontSize: size, color: C.text1, paraSpaceAfter: 2 } }, { text: it[1], options: { fontSize: size, color: C.text2, breakLine: !last } });
        else runs.push({ text: it, options: { bullet: true, fontSize: size, color: C.text2, breakLine: !last, paraSpaceAfter: 2 } });
      });
    });
    s.addText(runs, { x, y, w, h, valign: "top", margin: 0, isTextBox: true, objectName: "options" });
  };
  const content = (title, section) => { const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: section }); s.addText(title, { placeholder: "title" }); return s; };
  const sectionSlide = (title, sub, section) => { const s = pres.addSlide({ masterName: "SECTION", sectionTitle: section }); s.addText(title, { placeholder: "title" }); s.addText(sub, { x: 0.6, y: 3.25, w: 8.8, h: 0.8, fontSize: 18, color: "CBD5E1", margin: 0, isTextBox: true, objectName: "Section sub" }); mark(s, 8.8, 0.6); return s; };
  // one phone shot on the right, options on the left
  const phoneSlide = (title, section, file, groups, notes, size) => { const s = content(title, section); const w = phone(s, file, 7.05, 1.1, 3.95, title); options(s, groups, 0.5, 1.1, w ? 6.3 : 9, 4.0, size); s.addNotes(notes); return s; };
  const twoPhoneSlide = (title, section, files, groups, notes, size) => { const s = content(title, section); let x = 5.35; for (const f of files) { const w = phone(s, f, x, 1.1, 3.95, f); x += w + 0.3; } options(s, groups, 0.5, 1.1, 4.6, 4.0, size); s.addNotes(notes); return s; };
  const consoleSlide = (title, section, file, groups, notes, size) => { const s = content(title, section); monitor(s, file, 0.5, 1.1, 5.3, title); options(s, groups, 6.05, 1.1, 3.55, 4.05, size || 11.5); s.addNotes(notes); return s; };

  /* ================= OPENING */
  pres.addSection({ title: "Opening" });
  { const s = pres.addSlide({ masterName: "TITLE_DARK", sectionTitle: "Opening" }); mark(s, 0.6, 0.6, 0.7); s.addText("SafeWorks", { x: 1.45, y: 0.6, w: 4, h: 0.7, fontSize: 22, bold: true, color: C.background1, valign: "middle", margin: 0, isTextBox: true, objectName: "Brand" });
    s.addText("The complete guide: every screen, every option", { placeholder: "title" });
    s.addText("Phone app · QR form · Admin console · Settings and background jobs. Portal 2.1, UI version 2.", { x: 0.6, y: 3.4, w: 5.4, h: 0.9, fontSize: 15, color: "CBD5E1", margin: 0, isTextBox: true, objectName: "Tagline" });
    s.addText("November 2026", { x: 0.6, y: 4.8, w: 5, h: 0.4, fontSize: 12, color: C.accent1, margin: 0, isTextBox: true, objectName: "Date" });
    phone(s, "phone-home-officer.png", 7.1, 0.45, 4.75, "Home");
    s.addNotes("This deck walks through every screen and every option of SafeWorks, in the order a new team meets them: the phone app, the QR form for people without an account, the admin console, and finally the settings and background jobs that shape how a site runs. Use it as a training deck or a reference; each slide's notes carry the detail."); }
  { const s = content("What this guide covers", "Opening");
    const cards = [[Fi.FiSmartphone, "Phone app", "Sign-in, Home, Quick report, Reports, Triage, Actions, Verification, Inspections, Charts, Notifications, Outbox, Settings"], [Fi.FiGrid, "QR form", "Sign-in-free reporting for visitors and contract workers, in four languages"], [Fi.FiMonitor, "Admin console", "Dashboard, Attention, three registers, 18 configuration pages, oversight pages, command menu"], [Fi.FiSettings, "Settings and jobs", "Every company setting with its default; the reminders, alerts, digests and retention that run on their own"]];
    for (let i = 0; i < 4; i++) { const x = 0.5 + (i % 2) * 4.6, y = 1.15 + Math.floor(i / 2) * 1.95, w = 4.4, h = 1.75; card(s, x, y, w, h, `Cover card ${i + 1}`); s.addShape(pres.ShapeType.ellipse, { x: x + 0.2, y: y + 0.2, w: 0.55, h: 0.55, fill: { color: C.accent1 }, line: { color: C.accent1 }, objectName: `c${i}` }); s.addImage({ data: await icon(cards[i][0], H.dk1), x: x + 0.33, y: y + 0.33, w: 0.29, h: 0.29, objectName: `ci${i}` }); s.addText(cards[i][1], { x: x + 0.9, y: y + 0.22, w: w - 1.1, h: 0.5, fontSize: 16, bold: true, color: C.text1, valign: "middle", margin: 0, isTextBox: true, objectName: `ch${i}` }); s.addText(cards[i][2], { x: x + 0.2, y: y + 0.85, w: w - 0.4, h: 0.85, fontSize: 12, color: C.text2, valign: "top", margin: 0, isTextBox: true, objectName: `cb${i}` }); }
    s.addNotes("Four parts. We start where most people start, on the phone, then the QR form, then the console pages one by one, and finish with the settings and the jobs that run in the background."); }
  { const s = content("Roles: who can do what", "Opening");
    const hdr = ["Role", "Scope", "Phone", "Console", "Report", "Triage", "Verify", "Configure", "Export"];
    const rows = [["Reporter", "Per site", "Yes", "No", "Yes", "No", "No", "No", "No"], ["Action owner", "Per site", "Yes", "No", "Yes", "No", "No", "No", "No"], ["Verifier", "Per site", "Yes", "No", "Yes", "No", "Yes", "No", "No"], ["Site safety officer", "Per site", "Yes", "Yes", "Yes", "Yes", "Yes", "Users at own sites", "Own sites"], ["Site head", "Per site", "Yes", "Yes", "Yes", "Yes", "Yes", "Users at own sites", "Own sites"], ["HSE manager", "All sites", "Yes", "Yes", "Yes", "Yes", "Yes", "Safety config", "All"], ["Admin", "All sites", "Yes", "Yes", "Yes", "No", "No", "Everything", "All"], ["External auditor", "All sites, expires", "Read only", "Read only", "No", "No", "No", "No", "All"]];
    const tbl = [hdr.map((t) => ({ text: t, options: { bold: true, fill: { color: H.lt2 }, color: H.dk1 } })), ...rows.map((r) => r.map((t, i) => ({ text: t, options: { bold: i === 0, color: i === 0 ? H.dk1 : H.dk2 } })))];
    s.addTable(tbl, { x: 0.5, y: 1.1, w: 9, colW: [1.55, 1.25, 0.85, 0.85, 0.8, 0.8, 0.8, 1.3, 0.8], fontSize: 10.5, fontFace: "+mn-lt", border: { type: "solid", color: "E4E7EC", pt: 0.75 }, rowH: 0.36, valign: "middle", margin: 0.05, objectName: "Roles table" });
    s.addText("Safety configuration (templates, categories, risk matrix, due dates, ladders, rule sets) is the HSE manager's. Admin owns sites, users, QR codes, settings, privacy, retention and health. Officers and site heads manage users below them at their own sites.", { x: 0.5, y: 4.55, w: 9, h: 0.6, fontSize: 11, italic: true, color: C.accent6, margin: 0, isTextBox: true, objectName: "Roles note" });
    s.addNotes("Eight roles. Reporter, action owner and verifier are per site and use only the phone. Site safety officer and site head run their sites: triage, verify, manage users below them. HSE manager and admin are company-wide; the HSE manager owns the safety configuration, the admin owns the platform. External auditors read and export everything, change nothing, and their access expires."); }

  /* ================= PHONE APP */
  pres.addSection({ title: "Phone app" });
  sectionSlide("Phone app", "Sixteen screens, built for one hand, gloves, sunlight and no signal.", "Phone app").addNotes("The phone app is an installable web app, also packaged for Android. Everything you do on it is kept on the phone first and synced when there is signal.");
  twoPhoneSlide("Sign in and enrolment", "Phone app", ["phone-signin.png", "phone-enrol.png"], [
    { head: "Sign-in screen", items: [["Language", "English, हिन्दी, தமிழ், ಕನ್ನಡ; English by default"], ["Login", "employee code or email, plus password"], ["Password rule", "8+ characters with letters and numbers; 12 for staff"], ["Lockout", "10 wrong passwords lock the account for 15 minutes"], ["Unsent items", "kept on the phone and sent after sign-in"]] },
    { head: "Enrolment code", items: ["One-time code from the safety officer, valid 24 hours", "Choose a password, then sign in", "Roles that need MFA still get the authenticator step"] },
    { head: "Two-step sign-in (MFA)", items: ["Admin, HSE manager and site head by default (configurable)", "Authenticator app key shown once at first sign-in", "Lost phone: an administrator resets it"] },
  ], "Three ways in: employee code, email, or a one-time enrolment code. Staff roles add an authenticator code. The language choice here is remembered and later saved to the account.", 11.5);
  phoneSlide("Home", "Phone app", "phone-home-officer.png", [
    { head: "Top", items: [["Sync banner", "All synced, Offline, pending count, or failed; tap to open the Outbox"], ["Report button", "Report a hazard or good practice"], ["Top bar", "QR scan and Notifications with unread badge"]] },
    { head: "Needs you now (by role)", items: ["Critical alerts not acknowledged (with the minutes target)", "Actions overdue, and due today", "Waiting for your verification", "Triage backlog, with the next SLA due time", "Inspections due by tomorrow", "Returned to you with a question"] },
    { head: "This week at your site", items: ["Top categories, at-risk vs good practice", "Repeat findings: a category reported more than once, failed inspections"] },
    { head: "Lists", items: ["My next actions, My recent reports, with All links"] },
  ], "Home is personal: a worker sees sync status, the Report button, this week's picture and their reports; an officer also sees the triage backlog and alerts to acknowledge; an owner sees overdue and due-today actions; a verifier sees what is waiting.", 11.5);
  twoPhoneSlide("Quick report, part 1: location, type, photos", "Phone app", ["phone-report-top.png", "phone-report-options.png"], [
    { head: "Location", items: [["Card", "site, area and equipment; tap to change"], ["GPS", "locked at capture with the time; geofence flags reports outside the site"], ["QR", "scan a poster to prefill the area or equipment"]] },
    { head: "What did you see?", items: ["Good practice, Unsafe act, Unsafe condition, Near miss"] },
    { head: "Categories", items: ["Most used at the site first; More opens the full list", "Some categories ask required extra fields"] },
    { head: "Photos", items: ["Take photo or From gallery; up to 10 per record", "Blur boxes over faces before sending", "Resized on the phone (max edge and quality from Settings)"] },
    { head: "Describe", items: ["Up to 500 characters; voice-to-text; voice note up to 60 s", "Guidance: say what, where and who could be hurt, not who did it"] },
  ], "Everything needed for a report is on one screen. The location is already right in most cases, and the category chips are ordered by what the site reports most.", 11);
  phoneSlide("Quick report, part 2: switches, details and saving", "Phone app", "phone-report-more.png", [
    { head: "Switches", items: [["Fixed on the spot?", "then say what you did (required)"], ["Danger now, stop work", "alerts the site head and safety officer at once"], ["Report anonymously", "nobody, not even the admin, sees who sent it; it still shows under My reports"]] },
    { head: "More details", items: [["Employer involved", "own company or a contractor"], ["Trade", "of the people involved"]] },
    { head: "Checks before sending", items: ["Site, area (without GPS), type, at least one category", "A photo or a short description", "What you did, when fixed on the spot"] },
    { head: "Drafts and saving", items: ["An unfinished report is kept; Discard draft removes it", "Saved screen: case number, or a pending number when offline", "Report another, View report, Home"] },
  ], "The three switches change what happens next: fixed on the spot credits the reporter and records the fix; danger now starts the stop-work alert; anonymous seals the reporter's identity.", 11.5);
  twoPhoneSlide("Reports and the report page", "Phone app", ["phone-reports-mine.png", "phone-report-detail.png"], [
    { head: "Reports", items: [["Tabs", "My reports; Triage and Site for officers"], ["Search", "case number, text, area"], ["Filters", "status, type, band; Save filter with a name"], ["Offline", "your reports are listed with their status, offline too"]] },
    { head: "Report statuses", items: ["Submitted, Returned to reporter, Action assigned, Merged, Discarded, Escalated to incident, Closed"] },
    { head: "Report page", items: ["Photos (tap to enlarge), description, area, time, GPS, categories, reporter, employer, IS 3786 class", "Danger banner with Acknowledge for officers", "What was done, closure summary, actions with status", "Timeline, comments and replies", "Triage button for officers; Report link for a new tab"] },
  ], "My reports shows a reporter what happened to each report, through to Closed. Officers get two more tabs: Triage, the queue, and Site, everything at the site.", 11);
  phoneSlide("Triage: the seven decisions", "Phone app", "phone-triage-decisions.png", [
    { head: "Decisions", items: [["Accept & assign", "score the risk and create actions (next slide)"], ["Fixed on the spot", "accept the reporter's own fix"], ["Return with question", "the reporter replies from My reports"], ["Reviewed, no action", "noted, nothing to do"], ["Merge into duplicate", "choose the master case; suggestions use the duplicate window and GPS radius"], ["Discard", "with a reason"], ["Escalate to incident", "records when it was learned and shows the rule set's statutory timers"]] },
    { head: "Discard reasons", items: ["Not a hazard, Test entry, Not enough information, Out of scope, Already controlled, Accepted risk, Not applicable here, Resolved elsewhere, Other"] },
    { head: "Also", items: ["Reopen a decided report; every decision is in the timeline and audit log", "Triage SLA: 1 working day by default, site head reminded at 2"] },
  ], "Every report gets one of seven decisions. Discards need a reason from a fixed list; merges pick the master case; escalations record the moment the organisation learned of it, which starts statutory clocks.", 11);
  phoneSlide("Accept and assign: scoring and actions", "Phone app", "phone-triage-matrix.png", [
    { head: "Scoring", items: [["Categories", "confirm or change"], ["Risk matrix", "likelihood × severity, 5 × 5; the version is frozen on the record"], ["Bands", "Low 1–3, Moderate 4–6, High 8–12, Extreme 15–25 (default)"], ["IS 3786 class", "required"], ["Employer involved", "own company or a contractor"], ["Interim control", "required for Extreme, danger-now and where the band rule says so"]] },
    { head: "Each action", items: ["Title, problem, owner, due date (from the band rule), type and control level", "Employer, interim control with a review time", "Add action for more than one"] },
    { head: "Officers' shortcut", items: ["Report and assign: score and assign right after submitting, offline too"] },
  ], "Accept and assign is where the risk decision is made. The matrix gives a band; the band sets the due date and how hard reminders push. High and extreme risks need an interim control, something done this shift.", 11);
  twoPhoneSlide("Actions", "Phone app", ["phone-actions-mine.png", "phone-action-detail.png"], [
    { head: "Actions list", items: [["Tabs", "Mine; To verify for verifiers; Department"], ["Filters", "open only, completed awaiting verification; search by case, title, owner"], ["Order", "overdue first"]] },
    { head: "Action page", items: ["Status and band, title, due date (Due in N days, overdue in red)", "Owner, source report, area, type and control level, interim control and review time", "Evidence: before and after photos", "Timeline and comments"] },
    { head: "Buttons", items: ["Start · Complete · Request new date · Dispute"] },
    { head: "Statuses", items: ["Open, In progress, Completed (awaiting verification), Verified, Reopened, Disputed, Cancelled"] },
  ], "Owners work from the Actions list, overdue first. The action page carries everything they need, including the interim control agreed at triage and the before photo.", 11);
  { const s = content("Complete, request a new date, dispute", "Phone app"); let x = 0.5; for (const f of ["phone-action-complete-sheet.png", "phone-action-request-date.png", "phone-action-dispute.png"]) { const w = phone(s, f, x, 1.1, 2.55, f); x += (w || 1.2) + 0.2; }
    options(s, [{ head: "Complete", items: ["What was done, cause addressed", "After-photo required (the fix is refused without it)", "Then the verifier is notified"] }, { head: "Request new date", items: ["Proposed date, in the future only, and a reason", "The officer decides; the third request goes to the site head", "Approval moves the due date; refusal keeps it"] }, { head: "Dispute", items: ["Reason, e.g. not our scope, needs another trade", "The reminder ladder pauses (3 days by default)", "Approving reassigns the action to a new owner"] }], 4.5, 1.1, 5.1, 4.0, 11.5);
    s.addNotes("Three sheets. Complete needs an after-photo and the cause addressed. Request new date and Dispute both go to the officer; a dispute pauses reminders while it is decided, and the third date request escalates to the site head."); }
  phoneSlide("Verification and closure", "Phone app", "phone-actions-verify-tab.png", [
    { head: "To verify", items: ["Completed actions at the verifier's sites, never their own", "Compare before and after photos side by side"] },
    { head: "Result", items: [["Effective", "the action is verified"], ["Not effective", "with a reason; the action reopens to the owner"], ["Photo", "an optional verification photo"]] },
    { head: "Closure", items: ["When every action on a report is verified, the report closes", "Closure summary on the report; the reporter is notified", "Verification SLA reminder if a completed action waits too long"] },
  ], "Verification is by a different person, by design. Effective closes the action; not effective sends it back with a reason. When the last action is verified, the report closes and the reporter sees it.", 11.5);
  { const s = content("Inspections", "Phone app"); let x = 5.0; for (const f of ["phone-inspections.png", "phone-inspection-run.png"]) { const w = phone(s, f, x, 1.1, 3.95, f); x += (w || 1.8) + 0.3; }
    options(s, [{ head: "List", items: ["All, Mine, Completed; Scan QR; Start inspection", "Statuses: Scheduled, In progress, Completed, Missed, Reopened, Cancelled, Closed"] }, { head: "Run", items: ["Template, site, area or equipment; header fields asked once", "Sections (some repeatable, e.g. per scaffold bay)", "Answers: pass / fail / N/A, number with unit, text, date, single or multiple choice, photo, signature"] }, { head: "On a Fail", items: ["Photo on fail, note on fail, action on fail (draft with owner and interim control)", "Submit is blocked while a required action is missing"] }, { head: "Finish", items: ["Signature on screen; score excludes N/A; pass mark and any-fail rule", "Report link (5-minute signed link) for a new tab"] }], 0.5, 1.1, 4.3, 4.05, 11);
    s.addNotes("Inspections use the same loop. A checklist run collects answers of eight types; a fail can demand a photo, a note and a corrective action; the inspector signs; the run is scored against its pass mark."); }
  phoneSlide("Notifications and the danger-now alert", "Phone app", "phone-notifications-officer.png", [
    { head: "Inbox", items: ["New pill until read; Mark all read; tap to open the record", "Critical items carry Acknowledge; acknowledged shown afterwards"] },
    { head: "Reports", items: ["New report, STOP WORK alert and repeat, question about your report, reply, closed, reviewed, reopened, escalated"] },
    { head: "Actions", items: ["Assigned, due soon, due today, overdue, ready to verify, verified, reopened, cancelled, reassigned, date change requested, dispute raised, your request decided, waits for verification"] },
    { head: "Site and system", items: ["Reports waiting for triage, triage overdue, inspection due, missed, submitted", "Daily and weekly digests, authenticator reset"] },
    { head: "Channels", items: ["In app, push and email; quiet hours and a daily push cap, which Extreme alerts ignore"] },
  ], "Every event in the loop can notify someone. Danger-now alerts are critical: they bypass quiet hours and must be acknowledged within the target, or they repeat and escalate.", 10.5);
  phoneSlide("Outbox and working offline", "Phone app", "phone-outbox.png", [
    { head: "What is kept", items: ["New reports, comments and replies, triage decisions, new actions, start, complete, verify, requests, comments; photos with their fingerprints"] },
    { head: "Item states", items: ["Pending, sending, synced, failed (rejected by the server), conflict (someone changed the record first)"] },
    { head: "Buttons", items: [["Sync now", "send everything at once"], ["Retry failed", "after fixing the cause"], ["Fix and resend", "loads a rejected report back into the form"], ["Export diagnostics", "for support"], ["Clear synced", "tidy the list"]] },
    { head: "How retries work", items: ["Back-off after a failed send: 5 s, 15 s, 1 min, 5 min, 15 min, then hourly", "Sent at once when signal returns or the app reopens", "Every page is cached after sign-in, so all screens open offline"] },
  ], "The Outbox is the phone's memory. Nothing is lost without signal; failed items say why; a rejected report can be fixed and resent.", 11);
  twoPhoneSlide("Charts", "Phone app", ["phone-charts-mine.png", "phone-charts-site.png"], [
    { head: "Levels and periods", items: ["Mine, Department (if you have one), Site; a site picker for people at several sites", "Last 30, 90 or 365 days"] },
    { head: "Tiles", items: ["Reports (open/closed), hazards and near misses (danger-now count), good practice", "Open actions (assigned), overdue, on-time closure % (verified)"] },
    { head: "Charts", items: ["Trend per week or month", "By type, by risk band, by category, report status, action status", "Site level adds the department table"] },
    { head: "Export", items: ["Officers: Full report as an Excel workbook (Summary, Reports, Actions, Departments), downloaded or shared"] },
    { head: "Connection", items: ["Charts need the server; a notice shows when figures could not be refreshed"] },
  ], "Charts give everyone the same picture at three levels. Officers can take the full Excel report from the phone and share it.", 11);
  twoPhoneSlide("More and Settings", "Phone app", ["phone-more.png", "phone-settings.png"], [
    { head: "More", items: ["Inspections, Charts, Notifications, Outbox, Settings", "Scan QR, Safety library, Report a problem, Sign out"] },
    { head: "Settings", items: [["Language", "English, Hindi, Tamil, Kannada; saved to your account"], ["Appearance", "Auto, Light, Dark"], ["Email digest", "Daily, Weekly, Off"], ["Quiet hours", "no non-critical pushes at night; stop-work alerts still come"], ["Push notifications", "enable in the browser where available"], ["Privacy notice", "read and acknowledge the current version"]] },
    { head: "Android app", items: ["Server address screen, hardware back button, installable from the store build"] },
  ], "Settings are personal and follow the account: the language chosen here is the language of the console and of emails too.", 11.5);

  /* ================= QR FORM */
  pres.addSection({ title: "QR form" });
  { const s = content("QR form: reporting without an account", "QR form"); let x = 0.5; for (const f of ["qr-languages.png", "qr-form.png", "qr-form-bottom.png"]) { const w = phone(s, f, x, 1.1, 2.55, f); x += (w || 1.2) + 0.2; }
    options(s, [{ head: "Steps", items: ["Scan the poster at the area or equipment", "Choose a language (4), the type, categories", "Up to 3 photos, description, Fixed on the spot, Danger now"] }, { head: "Identity", items: ["Anonymous by default; or give a name and phone, seen by the site safety team only", "Privacy line names the company"] }, { head: "After sending", items: ["Case number and a private status link to follow progress", "Report another"] }, { head: "Protection", items: ["Rate limits per poster and per address; honeypot field; 15 MB limit", "Posters: A4 or A5, with the four languages; codes can be rotated"] }], 4.5, 1.1, 5.1, 4.0, 11.5);
    s.addNotes("The QR form needs no account. It is deliberately short: language, type, category, photo, description, and the two safety switches. The reporter gets a private link to follow what happens."); }

  /* ================= CONSOLE */
  pres.addSection({ title: "Admin console" });
  sectionSlide("Admin console", "Dashboard, Attention, three registers, eighteen configuration pages, five oversight pages, and a command menu.", "Admin console").addNotes("The console is for officers, site heads, HSE managers, admins and auditors. The left menu groups Overview, Registers, Configure and Oversight; the top bar has the case search, Go to (Ctrl+K), the site filter, the language and your account.");
  consoleSlide("Dashboard", "Admin console", "console-dashboard.png", [
    { head: "Filters", items: ["Site or All sites, From and To dates (swapped if reversed)"] },
    { head: "KPI tiles", items: ["Open actions, Overdue actions, Triage backlog, On-time closure, Median days to close, Participation, Critical acknowledgement (median minutes), Inspection completion, Repeat findings, Discard rate, Percent safe (hidden below 30 behaviours)"] },
    { head: "Charts", items: ["Reports per week (good vs at-risk, with total)", "By type, by category (safe vs at-risk), by area, by employer, by department"] },
    { head: "Exports", items: ["Export this view (CSV); Full report (Excel): Summary, Reports, Actions, Departments"] },
  ], "The dashboard answers the monthly review's questions in one place. Every tile shows n, the sample size, and the KPIs are defined in the hover hints.");
  consoleSlide("Attention board", "Admin console", "console-attention.png", [
    { head: "Cards (each links to the fix)", items: ["Reports waiting for triage (with the SLA)", "Critical alerts not acknowledged", "Overdue actions", "Missed inspections", "Repeat findings", "Rule sets still unverified", "Language packs incomplete", "Backups and health warnings"] },
    { head: "Behaviour", items: ["Scoped by the site filter; Refresh; counts in the sidebar badge", "All clear cards stay visible so the list is complete"] },
  ], "Managers start the day here. Each card is a count and a link to the page where it is handled.");
  consoleSlide("Registers: Observations, Actions, Inspections", "Admin console", "console-observations-drawer.png", [
    { head: "Filters", items: ["Search (case, description, reporter), status, risk, type, category, employer, from and to; saved filters with names; count line"] },
    { head: "Rows and side panel", items: ["Case, type, description with category and area, risk, status, received, reporter, actions", "Click a row: details, photos, timeline, actions; triage from the console"] },
    { head: "Finding things", items: ["Case search in the top bar jumps to the case", "Keyboard: g d/t/o/a/i/u/s, / search, j k Enter Esc, ? help", "Go to… (Ctrl+K / ⌘K) for pages and case numbers"] },
    { head: "Exports", items: ["CSV and Excel per register with the current filters; officers and above, own sites; audited"] },
  ], "Three registers share the same filters, saved filters and export buttons. Rows open a side panel so the list stays in view.");
  consoleSlide("Sites and areas", "Admin console", "console-site-wizard.png", [
    { head: "New site wizard", items: ["Name and code (2–6 capitals or digits, used in case numbers), establishment type, state, district, address, appropriate government", "Pick the industry: preview of default areas, hazards, templates and categories", "Create: areas, templates, categories and printable QR posters are ready"] },
    { head: "Site details", items: ["Rule set with effective-from date, risk matrix version, worker count, site head, hazardous process (MSIHC timers)", "Latitude, longitude, geofence radius (flags, never blocks)", "Working calendar: weekly off, shift start and end", "Deactivate with a reason (records kept)"] },
    { head: "Areas", items: ["Tree with codes and types; drag to reorder; add, rename, remove (with reason)"] },
  ], "A site goes live in three steps. Afterwards, every detail that drives the rules lives on the site: rule set, matrix version, calendar, geofence.");
  consoleSlide("Equipment and QR codes", "Admin console", "console-qr.png", [
    { head: "Equipment (per site)", items: ["Class, tag number, make and model, serial, SWL (kg), owner employer, area", "Next exam due: overdue shows DO NOT USE on scan, offline too", "Status and reason (retired), CSV import"] },
    { head: "QR codes", items: ["Points to: site, area or equipment; label printed under the code", "Link, scan count, never scanned", "Rotate: the old code answers 410 Gone; reason recorded", "Print or open the poster: A4 or A5, with the languages on it"] },
  ], "QR codes are the reporting points. Equipment codes add a safety check: scanning an item past its examination date shows DO NOT USE.");
  consoleSlide("People, contractors and departments", "Admin console", "console-people.png", [
    { head: "People (no login)", items: ["Name, phone (stored encrypted, shown masked), employer, trade, worker type, language", "Used for names on reports and on-behalf entries; CSV import skips bad rows with a reason"] },
    { head: "Contractors", items: ["Name, contact, email, trades, registration number, sub-contractor of, sites where they work", "Named as employer involved on reports and actions"] },
    { head: "Departments", items: ["One company-wide list; each user belongs to one", "Reports and actions count per department on the dashboard and in Charts"] },
  ], "People and contractors give the reports accurate names and employers without creating logins. Departments give accountability by team.");
  consoleSlide("Users and roles", "Admin console", "console-user-new.png", [
    { head: "New user", items: ["Name, login type: employee code + password, email + password + authenticator, or enrolment code", "Employer, department, trade, phone, language", "Roles: per site (reporter, action owner, verifier, safety officer, site head) or company-wide (HSE manager, admin, auditor); medical data flag; expiry per role", "Auditor accounts must have an expiry date"] },
    { head: "On a user", items: ["Issue enrolment code (24 h), reset password (temporary, must change), reset authenticator, unlock, deactivate with Undo, change roles", "Officers and site heads only for people below them at their own sites"] },
    { head: "Import", items: ["CSV with name, code, email, language, employer, department, trade, phone, role, site"] },
  ], "Users carry roles per site. Managers below the admin can only act on people below them, which keeps a safety officer from taking over a site head's account.");
  consoleSlide("Categories and rule sets", "Admin console", "console-categories.png", [
    { head: "Category", items: ["Code, name in four languages, parent, icon", "Applies to: industries and report types (empty = all)", "Flags: critical-capable (may be Extreme and raise the stop-work alert), incident prompt text", "Recipients: roles notified on a new report", "Extra fields: typed, optionally required, asked on the phone and checked by the server", "IS 3786 default class, email detail"] },
    { head: "Rule sets", items: ["Statutory timer packs per site (for example BOCW rules), draft until a reviewer verifies them", "Shown when a report is escalated to an incident; effective-from date"] },
  ], "Categories carry behaviour, not just a name: who is told, what extra details are asked, and whether the category can be critical.");
  consoleSlide("Risk matrix, due dates and reminders", "Admin console", "console-due-dates.png", [
    { head: "Risk matrix", items: ["Versions: new draft, edit bands (min, max, colour, response text), activate; records keep the version they were rated with"] },
    { head: "Due-date rules per band", items: ["Days to due date; interim control required; interim review hours", "Defaults: Low 90 days, Moderate 30, High 7 with interim control, Extreme 72 hours with interim control this shift"] },
    { head: "Reminder ladder", items: ["Steps before and after the due date: who is told (owner, officer, site head) and how", "Extreme actions ignore quiet hours and the push cap", "Dispute pause days and date-change requests before the site head come from Settings"] },
  ], "The matrix decides the band; the band decides the due date and the reminders. Everything here is versioned or logged, so a decision can always be explained.");
  consoleSlide("Templates and schedules", "Admin console", "console-template-builder.png", [
    { head: "Checklist settings", items: ["Name in four languages, pass mark %, any-fail rule, required competence, title fields, applies to sites/industries, change note"] },
    { head: "Sections and questions", items: ["Sections, repeatable with a label", "Question: code, text, 8 answer types, guidance, responses with flag and score, unit, min, max, required", "Photo, note and action on fail"] },
    { head: "Versions", items: ["Draft, in review, active, retired; approved by a second person"] },
    { head: "Schedules", items: ["Template, place, every N days, weeks or months; assignee user or role", "Lead days; grace hours, then Missed; next due"] },
  ], "The builder shows a live phone preview while you work. Approval by a second person makes checklists auditable; schedules make them happen on time.");
  consoleSlide("Languages and Settings", "Admin console", "console-settings.png", [
    { head: "Languages", items: ["Completeness per pack (English, Hindi, Tamil, Kannada); edit any wording as an override"] },
    { head: "Company", items: ["Company name, legal name, address, privacy contact phone"] },
    { head: "Security and languages", items: ["Roles that need two-step sign-in; languages offered; default language"] },
    { head: "Service levels", items: ["Triage SLA 1 working day; escalate at 2; critical acknowledgement 30 min; date-change requests before the site head 3; dispute pause 3 days"] },
    { head: "Notifications, duplicates, photos", items: ["Quiet hours 21:00–07:00; daily push cap 5", "Duplicate window 24 h, GPS radius 30 m", "Max edge 1,600 px, JPEG quality 0.8; photos per record 10, per QR form 3; voice note 60 s"] },
  ], "Settings are the company's defaults; every site inherits them. The values shown are the defaults the system ships with.", 11);
  consoleSlide("Oversight pages", "Admin console", "console-audit-log.png", [
    { head: "Audit log", items: ["Every change, sign-in, export and sensitive view; filter by actor, record, action, dates", "Diff view of what changed; Verify chain checks the tamper-evident hash chain"] },
    { head: "Notifications log", items: ["Every delivery: channel, status, attempts, errors"] },
    { head: "Health", items: ["Backups, jobs, queues and warnings; also on the attention board"] },
    { head: "Privacy", items: ["Notice versions in four languages; workers acknowledge on the phone"] },
    { head: "Retention", items: ["Policy per record type (years, end action), legal holds, dry run before anything is removed"] },
  ], "Oversight pages are where auditors live. The audit log is chained, so any tampering shows up in the verify check.");
  { const s = content("Security options and background jobs", "Admin console");
    options(s, [{ head: "Security", items: ["Two-step sign-in for chosen roles; an enrolled authenticator cannot be replaced with a password alone", "10 wrong passwords lock the account for 15 minutes", "Auditors are read-only everywhere and expire", "Exports limited to officers and above, for their own sites, and audited", "Phone numbers encrypted; anonymous reports sealed", "Signed, short-lived links for posters and reports; strict content security headers; CSV formula guard"] }], 0.5, 1.1, 4.4, 4.0, 11.5);
    options(s, [{ head: "Jobs that run on their own", items: [["Reminder ladder", "before and after due dates, escalating"], ["Triage clock", "reminds officers, then the site head"], ["Danger-now watcher", "repeats and escalates unacknowledged alerts"], ["Inspection scheduler", "creates runs, marks Missed"], ["Closure notices", "tells reporters when their report closes"], ["Digests", "daily and weekly emails"], ["Senders", "push and email delivery with retries"], ["Retention", "applies policies after a dry run"]] }], 5.1, 1.1, 4.5, 4.0, 11.5);
    s.addNotes("Two lists that are easy to forget in a demo: the security rules that are always on, and the jobs that run without anyone clicking."); }

  /* ================= CLOSING */
  pres.addSection({ title: "Closing" });
  { const s = pres.addSlide({ masterName: "TITLE_DARK", sectionTitle: "Closing" }); s.addText("Where to go next", { placeholder: "title" });
    s.addText("User guide and complete reference (Word) · Product walkthrough video · API reference for integrations · Your pilot site, this week.", { x: 0.6, y: 3.4, w: 5.4, h: 1.2, fontSize: 15, color: "CBD5E1", margin: 0, isTextBox: true, objectName: "Next" });
    mark(s, 0.6, 0.6, 0.7); phone(s, "phone-report-detail.png", 7.1, 0.45, 4.75, "Report page");
    s.addNotes("The companion documents carry the same content in more depth: the complete reference for every option, the walkthrough video for training, and the API reference for IT. The next step is the pilot site."); }

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
})().catch((e) => { console.error(e); process.exit(1); });
