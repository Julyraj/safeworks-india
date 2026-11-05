/* SafeWorks complete reference (Word, A4): every screen and every option, with defaults and who can use them. */
const fs = require("fs");
const path = require("path");
const D = require("docx");
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, BorderStyle, ImageRun, PageBreak, LevelFormat, Header, Footer, PageNumber } = D;
const SHOTS = process.env.SHOTS, SHOTS1 = process.env.SHOTS1, OUT = process.argv[2];
const FONT = "Calibri", INK = "0F172A", MUTED = "5B6676", LINE = "E4E7EC", TINT = "F5F6F8", HIVIS = "F5C400";
const PAGE_W = 11906, MARGIN = 1134, CONTENT_W = PAGE_W - 2 * MARGIN;
const run = (text, o = {}) => new TextRun({ text, font: FONT, size: 21, ...o });
const p = (c, o = {}) => new Paragraph({ spacing: { after: 110 }, ...o, children: typeof c === "string" ? [run(c)] : c });
const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun({ text: t, font: "Arial" })] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t, font: "Arial" })] });
const h3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: t, font: "Arial" })] });
const bullet = (t) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 50 }, children: typeof t === "string" ? [run(t)] : t });
const B = (label, text) => bullet([run(label + ": ", { bold: true }), run(text)]);
const cell = (content, w, head) => new TableCell({ width: { size: w, type: WidthType.DXA }, margins: { top: 70, bottom: 70, left: 90, right: 90 }, shading: head ? { type: ShadingType.CLEAR, fill: TINT, color: "auto" } : undefined, children: (Array.isArray(content) ? content : [content]).map((c) => typeof c === "string" ? new Paragraph({ spacing: { after: 0 }, children: [run(c, { bold: !!head, size: 19 })] }) : c) });
const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const table = (fr, rows) => { const widths = fr.map((f) => Math.round(CONTENT_W * f)); return new Table({ width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths, borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border }, rows: rows.map((r, i) => new TableRow({ tableHeader: i === 0, cantSplit: true, children: r.map((c, j) => cell(c, widths[j], i === 0)) })) }); };
const shotPath = (n) => { for (const d of [SHOTS, SHOTS1]) { const f = path.join(d, n); if (fs.existsSync(f)) return f; } return null; };
const img = (file, widthPx, aspect, caption) => { const f = shotPath(file); if (!f) return []; return [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100, after: 40 }, children: [new ImageRun({ type: "png", data: fs.readFileSync(f), transformation: { width: widthPx, height: Math.round(widthPx * aspect) }, altText: { title: caption, description: caption, name: caption } })] }), new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [run(caption, { size: 17, italics: true, color: MUTED })] })]; };
const phoneImg = (file, cap) => img(file, 200, 1688 / 780, cap);
const consoleImg = (file, cap) => img(file, 620, 900 / 1440, cap);
const twoPhones = (a, b, ca, cb) => { const fa = shotPath(a), fb = shotPath(b); if (!fa || !fb) return [...phoneImg(a, ca), ...phoneImg(b, cb)]; const mk = (f) => new ImageRun({ type: "png", data: fs.readFileSync(f), transformation: { width: 190, height: Math.round(190 * 1688 / 780) }, altText: { title: ca, description: ca, name: ca } }); return [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100, after: 40 }, children: [mk(fa), new TextRun({ text: "    " }), mk(fb)] }), new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [run(`${ca} · ${cb}`, { size: 17, italics: true, color: MUTED })] })]; };
const pb = () => new Paragraph({ children: [new PageBreak()] });
const c = [];

/* ---- cover + contents */
c.push(new Paragraph({ spacing: { before: 2400, after: 200 }, children: [new TextRun({ text: " SW ", font: "Arial", size: 56, bold: true, color: INK, shading: { type: ShadingType.CLEAR, fill: HIVIS, color: "auto" } })] }),
  new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: "SafeWorks", font: "Arial", size: 72, bold: true, color: INK })] }),
  new Paragraph({ spacing: { after: 600 }, children: [new TextRun({ text: "Complete reference: every screen, every option", font: "Arial", size: 40, color: MUTED })] }),
  p([run("Phone app, QR form, admin console, settings and background jobs. For administrators, HSE managers, site teams and trainers.", { size: 24, color: "334155" })]),
  new Paragraph({ spacing: { before: 3400, after: 0 }, children: [run("Portal 2.1 · UI version 2 · November 2026", { size: 20, color: MUTED })] }),
  new Paragraph({ children: [run("Defaults quoted are the values the system ships with; an administrator may have changed them in Settings.", { size: 20, color: MUTED })] }));
c.push(h1("Contents"));
["1. Roles and permissions", "2. Phone app, screen by screen", "3. QR form", "4. Admin console: overview and registers", "5. Admin console: configuration pages", "6. Admin console: oversight pages", "7. Settings: every option and its default", "8. Notifications: every event", "9. Background jobs", "10. Security rules", "11. Statuses and glossary"].forEach((t) => c.push(p(t)));

/* ---- 1 roles */
c.push(h1("1. Roles and permissions"));
c.push(p("A person holds one or more roles. Site roles apply at one site each; company-wide roles apply everywhere. The table lists what each role can do."));
c.push(table([0.2, 0.14, 0.66], [["Role", "Scope", "Can"],
  ["Reporter", "Per site", "Phone app: report, follow own reports, reply to questions, see own charts"],
  ["Action owner", "Per site", "Reporter, plus: own actions, start, complete with after-photo, request new date, dispute, Department tab"],
  ["Verifier", "Per site", "Reporter, plus: see every record at the site, verify completed actions (not their own)"],
  ["Site safety officer", "Per site", "Verifier, plus: triage, assign actions, acknowledge alerts, run inspections, console registers and exports for own sites, manage users below them at own sites, issue enrolment codes"],
  ["Site head", "Per site", "Safety officer, plus: decides the third date-change request; receives triage and critical escalations"],
  ["HSE manager", "All sites", "Site head everywhere, plus: safety configuration (templates, categories, risk matrix, due dates, ladders, rule sets), Health"],
  ["Admin", "All sites", "Platform: sites, areas, equipment, QR codes, people, contractors, departments, users, settings, privacy, retention, languages, audit log, notifications log, health. Does not triage or verify"],
  ["External auditor", "All sites, must expire", "Read everything, export everything, change nothing (every write is refused)"]]));
c.push(p([run("Rules of thumb: ", { bold: true }), run("a verifier never verifies their own action; an officer never issues an enrolment code for a peer or a site head; only officers, site heads and HSE managers of the site may acknowledge a danger-now alert; exports are limited to officers and above and auditors, for the sites where they hold that role.")], { spacing: { before: 160 } }));

/* ---- 2 phone app */
c.push(h1("2. Phone app, screen by screen"));
c.push(p("The phone app is an installable web app, also packaged for Android. It keeps working without signal: everything you save goes to the Outbox and is sent when the connection returns. Every screen is cached after sign-in, so all of them open offline."));
c.push(h2("2.1 Sign in"));
c.push(...twoPhones("phone-signin.png", "phone-enrol.png", "Sign-in", "Enrolment code"));
c.push(table([0.28, 0.72], [["Option", "What it does"],
  ["Language buttons", "English (default), हिन्दी · Hindi, தமிழ் · Tamil, ಕನ್ನಡ · Kannada. The choice is kept on the phone and saved to the account after sign-in."],
  ["Employee code or email", "Which one depends on the user's login type (set by the administrator)."],
  ["Password", "At least 8 characters with letters and numbers; 12 for staff roles. 10 wrong attempts lock the account for 15 minutes."],
  ["I have an enrolment code", "A one-time code from the site safety officer, valid 24 hours. Choose a password and sign in. Roles that need two-step sign-in still get the authenticator step."],
  ["Authenticator (MFA)", "Admin, HSE manager and site head by default. The key is shown once at first sign-in; a lost phone is reset by an administrator. An enrolled authenticator cannot be replaced from a password-only session."],
  ["Choose a new password", "Shown when an administrator issued or reset the password."],
  ["Unsent items", "Items left in the Outbox are kept and sent after sign-in."],
  ["Safety library", "Link to the public safety library."]]));
c.push(h2("2.2 Home"));
c.push(...phoneImg("phone-home-officer.png", "Home, as a safety officer"));
c.push(table([0.28, 0.72], [["Element", "What it shows"],
  ["Sync banner", "All synced with the time; Offline; N pending; failed items. Tap to open the Outbox."],
  ["Report a hazard or good practice", "Opens Quick report. The yellow + in the bottom bar does the same."],
  ["Top bar", "Scan QR; Notifications with the unread count."],
  ["Needs you now", "Cards by role: Critical, not acknowledged (minutes target); Actions overdue; Actions due today; Waiting for your verification; Triage backlog (next SLA due, reports past the SLA); Inspections due; Returned to you with a question."],
  ["This week in <site>", "Top categories; N reports in 7 days; at-risk vs good practice split; Repeat findings (a category reported more than once, inspections failed)."],
  ["My next actions, My recent reports", "Short lists with All links."],
  ["Bottom bar", "Home, Reports, +, Actions, More (with unread badge). On a large screen the bar becomes a side rail with sync status and sign-out."]]));
c.push(h2("2.3 Quick report"));
c.push(...twoPhones("phone-report-top.png", "phone-report-options.png", "Top of the form", "Switches and Submit"));
c.push(table([0.26, 0.74], [["Option", "Details"],
  ["Location card", "Site, area and equipment. Tap to change (site picker, area list, equipment). Required without a GPS fix. Scanning a QR poster prefills it."],
  ["Time and GPS", "Locked at capture. A time more than 5 minutes ahead of the server is replaced by the received time (the claimed time is kept in the details). Reports outside the site's geofence are flagged, never blocked."],
  ["What did you see?", "Good practice, Unsafe act, Unsafe condition, Near miss. Choosing a type may preselect a category."],
  ["Categories", "At least one. Ordered by what the site reports most; More opens the full list. A category may ask required extra fields (number, text, choice), checked by the server too."],
  ["Photos", "Take photo or From gallery; JPEG, PNG and WebP; up to 10 per record (3 on the QR form). Blur boxes over faces before sending. Resized on the phone to the max edge and quality set by the company; each photo carries a fingerprint checked on upload."],
  ["Describe", "Up to 500 characters. Microphone for voice-to-text where the phone supports it; voice note up to 60 seconds."],
  ["Fixed on the spot?", "Then What did you do? is required. The report is accepted as fixed at triage."],
  ["Danger now, stop work", "Sends the critical alert to the site's safety officers, site head and HSE managers, who must acknowledge it. Not offered on good-practice reports."],
  ["Report anonymously", "The reporter's identity is sealed: nobody, not even the admin, can see it. The report still appears under My reports on this phone."],
  ["More details", "Employer involved (own company or a contractor) and Trade."],
  ["Submit", "Enabled once type, category and a photo or description are present. Offline: a pending number, replaced by the case number (e.g. TN1-OBS-2026-00041) when sent."],
  ["Saved screen", "Case number or pending number; We will tell you when it is fixed; Report another; View report; Home."],
  ["Draft", "An unfinished report is kept when you leave; Discard draft removes it."],
  ["Report on behalf", "Officers can file a report for a worker without a phone, naming the person."],
  ["Report and assign", "After submitting, an officer can score and assign at once, offline too."]]));
c.push(h2("2.4 Reports and the report page"));
c.push(...twoPhones("phone-reports-mine.png", "phone-report-detail.png", "My reports", "Report page"));
c.push(table([0.26, 0.74], [["Option", "Details"],
  ["Tabs", "My reports (everyone); Triage and Site (officers and above). Danger-now reports are first in Triage."],
  ["Search and filters", "Case number, text, area; status, type, risk band chips; Save filter with a name; saved filters are listed as chips."],
  ["Offline", "Your own reports are listed with their status from the phone's copy; an Offline copy note shows when the server could not be reached."],
  ["Report page", "Type and status pills, band and score; title; photos (tap to enlarge); description; area, time (locked), GPS, categories, reporter (or dash when anonymous), employer, IS 3786 class; What was done; closure summary; danger banner with Acknowledge (officers); Actions with status; timeline; comments and replies; Triage button (officers); Report link for a new tab (5-minute signed link)."],
  ["Reply to a question", "When an officer returns the report with a question, the reporter answers from the report page."]]));
c.push(h2("2.5 Triage"));
c.push(...twoPhones("phone-triage-decisions.png", "phone-triage-matrix.png", "Decisions", "Accept and assign"));
c.push(table([0.26, 0.74], [["Decision", "What happens"],
  ["Accept & assign", "Confirm categories; score likelihood × severity on the risk matrix (the version is frozen on the record); band Low, Moderate, High or Extreme; IS 3786 class (required); employer involved (required); interim control (required for Extreme, danger-now reports and where the band rule says so); one or more actions, each with title, problem, owner, due date (from the band rule, editable), type, control level, employer, interim control and review time. The owner is notified and the reminder ladder starts."],
  ["Fixed on the spot", "Accepts the reporter's own fix as the closure."],
  ["Return with question", "The report goes back to the reporter, who replies; triage continues after the answer."],
  ["Reviewed, no action", "Recorded as reviewed; no action is created."],
  ["Merge into duplicate", "Choose the master case. Suggestions come from the duplicate window (24 h) and GPS radius (30 m) in Settings."],
  ["Discard", "Reason: Not a hazard, Test entry, Not enough information, Out of scope, Already controlled, Accepted risk, Not applicable here, Resolved elsewhere, Other; plus an explanation. The reporter is told their report was reviewed."],
  ["Escalate to incident", "Records when the organisation learned of it and shows the site's rule set and statutory timers; the paper incident procedure follows."],
  ["Reopen", "A decided report can be reopened; every decision is in the timeline and the audit log."],
  ["Triage clock", "Triage within 1 working day (default); officers are reminded and the site head at 2 working days."]]));
c.push(h2("2.6 Actions"));
c.push(...twoPhones("phone-actions-mine.png", "phone-action-detail.png", "Actions list", "Action page"));
c.push(table([0.26, 0.74], [["Option", "Details"],
  ["Tabs", "Mine; To verify (verifiers, officers); Department (everything assigned to your department, read-only unless yours)."],
  ["Filters", "Open only; Completed, awaiting verification; search by case, title or owner. Overdue first."],
  ["Action page", "Status and band; title; Due in N days or overdue; owner; source report; area; type and control level; interim control and review time; evidence (before and after); timeline; comments."],
  ["Start", "Marks the action in progress."],
  ["Complete", "What was done; cause addressed; after-photo required (refused without it). The verifier is notified."],
  ["Request new date", "Proposed date (future only) and reason. The officer decides; the third request on an action goes to the site head. Approval moves the due date."],
  ["Dispute", "Reason (for example not our scope). The reminder ladder pauses 3 days (default) while the officer decides; approving a dispute reassigns the action to a new owner. A disputed action cannot be completed until decided."],
  ["Statuses", "Open, In progress, Completed (awaiting verification), Verified, Reopened, Disputed, Cancelled."]]));
c.push(...img("phone-action-complete-sheet.png", 170, 1688 / 780, "Complete sheet"));
c.push(h2("2.7 Verification"));
c.push(...phoneImg("phone-actions-verify-tab.png", "To verify"));
c.push(table([0.26, 0.74], [["Option", "Details"],
  ["Who", "Verifiers, officers, site heads and HSE managers of the site; never the owner or the person who completed it."],
  ["Compare", "Before and after photos side by side."],
  ["Result", "Effective: the action is verified. Not effective: with a reason, the action reopens to the owner. An optional verification photo."],
  ["Closure", "When every action on a report is verified, the report closes with a closure summary, and the reporter is notified."],
  ["Verification SLA", "A completed action that waits too long raises a reminder."]]));
c.push(h2("2.8 Inspections"));
c.push(...twoPhones("phone-inspections.png", "phone-inspection-run.png", "Inspections", "A run"));
c.push(table([0.26, 0.74], [["Option", "Details"],
  ["List", "All, Mine, Completed; Scan QR to open the run for an area or equipment; Start inspection (spot check): template, site, area or equipment."],
  ["Header", "Title fields asked once (for example document number, scaffold bay)."],
  ["Sections", "Section navigation chips with done and flag states; repeatable sections add copies with a label (for example Bay)."],
  ["Answer types", "Pass / Fail / N/A; number (with unit, min and max); text; date; single choice; multiple choice; photo; signature. Choice answers must be one of the template's responses; numbers must be numeric."],
  ["On Fail", "Photo on fail, note on fail and action on fail, as set per question: a draft corrective action with owner and interim control. Submit is blocked while a required action is missing."],
  ["Finish", "Signature pad; score excludes N/A; pass mark % and the any-fail rule decide Pass or Fail; actions raised are listed."],
  ["Statuses", "Scheduled, In progress, Completed, Missed (not started by due + grace), Reopened, Cancelled, Closed."],
  ["Report link", "A 5-minute signed link opens the run's report in a new tab."]]));
c.push(h2("2.9 Notifications"));
c.push(...phoneImg("phone-notifications-officer.png", "Notifications with a critical alert"));
c.push(table([0.26, 0.74], [["Option", "Details"],
  ["Inbox", "Newest first; New pill until read; Mark all read; tap to open the linked record."],
  ["Critical items", "STOP WORK alerts carry Acknowledge; only officers, site heads and HSE managers of the site may acknowledge; acknowledged is shown afterwards."],
  ["Channels", "In app (always), push (where enabled), email (per event and digest settings)."],
  ["Quiet hours and cap", "No non-critical pushes during quiet hours; at most the daily push cap per person; Extreme reminders and stop-work alerts ignore both."]]));
c.push(h2("2.10 Outbox"));
c.push(...phoneImg("phone-outbox.png", "Outbox"));
c.push(table([0.26, 0.74], [["Option", "Details"],
  ["What is kept", "New report, comment, reply, triage decision, new action, action started, completed, verified, request, comment; photos with fingerprints."],
  ["Item states", "Pending (with next retry), sending, synced (with case number), failed (rejected by the server, with the reason), conflict (someone changed the record first; your decision is kept as a comment)."],
  ["Sync now", "Sends everything at once, ignoring back-off."],
  ["Retry failed", "Retries rejected items after you fixed the cause."],
  ["Fix and resend", "Loads a rejected report back into the form with the server's reason."],
  ["Export diagnostics", "Copies a diagnostics text for support."],
  ["Clear synced", "Removes synced items from the list."],
  ["Retries", "After a failed send: 5 s, 15 s, 1 min, 5 min, 15 min, then hourly. Sent at once when signal returns or the app reopens online; a background sync also runs every 2 minutes."]]));
c.push(h2("2.11 Charts"));
c.push(...twoPhones("phone-charts-mine.png", "phone-charts-site.png", "Mine", "Site"));
c.push(table([0.26, 0.74], [["Option", "Details"],
  ["Levels", "Mine (my reports and my actions); Department (reports by its members, actions assigned to it); Site (everything at my sites). Site picker for people at several sites."],
  ["Period", "Last 30, 90 or 365 days."],
  ["Tiles", "Reports (open/closed); hazards and near misses with the danger-now count; good practice; open actions (assigned); overdue; on-time closure % (verified)."],
  ["Charts", "Trend per week or month; by type; by risk band (after triage); by category; report status; action status; the department table at site level."],
  ["Export", "Officers: Full report as Excel (Summary, Reports, Actions, Departments), downloaded or shared."],
  ["Connection", "Charts come from the server; offline shows Charts need a connection; a notice shows when figures on screen could not be refreshed."]]));
c.push(h2("2.12 More and Settings"));
c.push(...twoPhones("phone-more.png", "phone-settings.png", "More", "Settings"));
c.push(table([0.26, 0.74], [["Option", "Details"],
  ["More", "Inspections, Charts, Notifications, Outbox, Settings, Scan QR, Safety library, Report a problem, Sign out."],
  ["Language", "English, Hindi, Tamil, Kannada; saved to the account and used by the console and emails."],
  ["Appearance", "Auto (follows the phone), Light, Dark."],
  ["Email digest", "Daily, Weekly, Off: overdue actions and reminders beyond the push cap are bundled here."],
  ["Quiet hours", "On or off for this person, within the company's quiet hours."],
  ["Push notifications", "Enable in the browser where the server has push keys."],
  ["Privacy notice", "Read the current version and acknowledge it; the acknowledgement is recorded."],
  ["Scan QR", "Camera scanner for posters; the frame prefills the report or opens the inspection."],
  ["Android", "Server address screen on first start; the hardware back button works."]]));

/* ---- 3 QR form */
c.push(h1("3. QR form"));
c.push(...twoPhones("qr-languages.png", "qr-form.png", "Language choice", "Form"));
c.push(table([0.26, 0.74], [["Option", "Details"],
  ["Opening", "Scan the poster at a site, area or equipment. First screen: choose the language (English, Hindi, Tamil, Kannada)."],
  ["Form", "Type (4), categories, up to 3 photos, description, Fixed on the spot, Danger now, Report anonymously (on by default) or name and phone, seen by the site safety team only."],
  ["Privacy", "A line names the company and links to the notice."],
  ["After sending", "Case number; a private status link to follow progress (only the holder can see it); Report another."],
  ["Equipment", "Scanning equipment past its examination date shows DO NOT USE, offline too."],
  ["Protection", "30 reports per poster per hour, 10 per address per hour; honeypot field; 15 MB limit; duplicate suggestions still apply at triage."],
  ["Posters", "A4 or A5 per site, area or equipment, with the chosen languages printed; a rotated code stops working (410) and the reason is logged."]]));

/* ---- 4 console overview */
c.push(h1("4. Admin console: overview and registers"));
c.push(p("For officers, site heads, HSE managers, admins and auditors. The left menu groups Overview, Registers, Configure and Oversight; the top bar has the case search, Go to (Ctrl+K, ⌘K on Mac), the site filter, the language and the account panel. Pages a role may not open are hidden."));
c.push(h2("4.1 Dashboard"));
c.push(...consoleImg("console-dashboard.png", "Dashboard"));
c.push(table([0.28, 0.72], [["KPI", "Meaning"],
  ["Open actions", "Actions not yet verified, with n"], ["Overdue actions", "Open actions past their due date"], ["Triage backlog", "Reports still Submitted"], ["On-time closure", "Share of verified actions closed by their due date"], ["Median days to close", "From report to closure"], ["Participation", "Share of workers who reported in the period"], ["Critical acknowledgement", "Median minutes to acknowledge danger-now alerts"], ["Inspection completion", "Completed runs as a share of due runs"], ["Repeat findings", "Same category at the same place"], ["Discard rate", "Discarded reports as a share of triaged"], ["Percent safe", "Safe behaviours as a share of observed; hidden below 30 behaviours"]]));
c.push(p([run("Filters: ", { bold: true }), run("site or All sites, From and To (swapped if entered the wrong way round). Charts: reports per week (good vs at-risk with total), by type, by category (safe vs at-risk), by area, by employer, by department. Buttons: Export this view, Full report (Excel) with Summary, Reports, Actions and Departments sheets. Dark mode follows the system or the account setting.")], { spacing: { before: 120 } }));
c.push(h2("4.2 Attention board"));
c.push(...consoleImg("console-attention.png", "Attention board"));
c.push(p("Eight cards, each a count and a link: Reports waiting for triage (with the SLA), Critical alerts not acknowledged, Overdue actions, Missed inspections, Repeat findings, Rule sets still unverified, Language packs incomplete, Backups and health warnings. Scoped by the site filter; Refresh; the sidebar badge shows the urgent count."));
c.push(h2("4.3 Registers: Observations, Actions, Inspections"));
c.push(...consoleImg("console-observations-drawer.png", "Observations register with the side panel"));
c.push(table([0.28, 0.72], [["Option", "Details"],
  ["Filters", "Search (case, description, reporter); status; risk; type; category; employer; from and to. Actions: status, band, owner, overdue. Inspections: status, template, result."],
  ["Saved filters", "Save the current filter with a name; saved filters are chips; delete with the x."],
  ["Rows", "Observations: case, type, description with category and area, risk, status, received, reporter, actions. Actions: case, title, owner, due, status, band. Inspections: case, template, area, inspector, result, score, actions raised."],
  ["Side panel", "Details, photos, timeline, comments, actions; triage decisions from the console; close with Esc."],
  ["Case search", "Type or paste a case number in the top bar to open it; the register is filtered to the case and other filters are cleared."],
  ["Keyboard", "g d dashboard, g t attention, g o observations, g a actions, g i inspections, g u users, g s sites; / search; j and k move; Enter opens; Esc closes; ? help."],
  ["Go to (Ctrl+K)", "Command menu: pages the role may open, grouped as in the sidebar, or a pasted case number."],
  ["Exports", "CSV and Excel with the current filters; officers and above and auditors, for their own sites; text that could run as a spreadsheet formula is neutralised in CSV; every export is in the audit log; a per-user hourly limit."]]));

/* ---- 5 configuration */
c.push(h1("5. Admin console: configuration pages"));
c.push(h2("5.1 Sites and areas"));
c.push(...consoleImg("console-site-wizard.png", "New site wizard"));
c.push(table([0.28, 0.72], [["Field or option", "Details"],
  ["Wizard", "Step 1 name the site; step 2 pick the industry (preview of default areas, typical hazards, templates and categories; click an area to leave it out, add your own); step 3 review and create. Posters for the site and each area open from the ready screen."],
  ["Code", "2–6 capital letters or digits (e.g. TN1), used in case numbers."], ["Name", "English required; translations later."], ["Establishment type, state, district, address", "Identity fields."], ["Appropriate government", "State or Centre; decides which OSH Code rules apply."], ["Industry", "Drives default areas, templates and categories."], ["Rule set", "Statutory timer pack; drafts cannot be assigned until verified; effective-from date is logged."], ["Risk matrix version", "Sites keep their version until changed."], ["Worker count, site head", "Used in participation and escalations."], ["Hazardous process", "Factories Act s.2(cb): adds the MSIHC timers."], ["Latitude, longitude, geofence radius", "Reports outside the radius are flagged, never blocked; Open on a map."], ["Working calendar", "Weekly off, shift start and end; used by SLAs in working days."], ["Deactivate", "With a reason; records and history are kept; hidden from pickers."], ["Areas", "Tree with codes and types; drag to reorder; add, edit, remove with reason; QR poster per area."]]));
c.push(h2("5.2 Equipment"));
c.push(...consoleImg("console-equipment.png", "Equipment"));
c.push(table([0.28, 0.72], [["Field", "Details"], ["Class, tag number, make and model, serial", "Identity of the item; search by tag, serial or make."], ["SWL (kg)", "Safe working load for lifting equipment."], ["Owner employer", "Own company or a contractor."], ["Area", "Where the item is."], ["Next exam due", "Statutory examination date; overdue shows DO NOT USE on scan, offline too."], ["Status and reason", "Active or retired."], ["Import", "CSV of equipment."]]));
c.push(h2("5.3 QR codes"));
c.push(...consoleImg("console-qr.png", "QR codes"));
c.push(table([0.28, 0.72], [["Option", "Details"], ["Points to", "Site, Area or Equipment."], ["Label", "Printed under the code."], ["Link and scans", "The public link; scan count; never scanned."], ["Rotate", "Issues a new token; the old one answers 410 Gone; the reason is recorded."], ["Print poster", "A4 or A5; languages on the poster; opens through a signed link in a new tab."]]));
c.push(h2("5.4 People, contractors and departments"));
c.push(...consoleImg("console-people.png", "People and contractors"));
c.push(table([0.28, 0.72], [["Page", "Fields and options"], ["People", "Name, phone (encrypted, shown masked; 7–16 digits, optional +), employer, trade, worker type, language. CSV import (name, phone, employer, trade, worker type, language); rows with a bad phone are skipped with a reason."], ["Contractors", "Name, contact, email (checked), trades, registration number, sub-contractor of, sites where they work. Named as the employer involved on reports and actions."], ["Departments", "Code and name; one company-wide list; each user belongs to one; actions and reports are counted per department on the dashboard and in Charts."]]));
c.push(h2("5.5 Users and roles"));
c.push(...consoleImg("console-user-new.png", "New user"));
c.push(table([0.28, 0.72], [["Option", "Details"],
  ["Login type", "Employee code + password; email + password + authenticator; enrolment code (first sign-in with a one-time code)."],
  ["Profile", "Name, employer, department, trade, phone (checked), language."],
  ["Roles", "Per site: reporter, action owner, verifier, site safety officer, site head. Company-wide: HSE manager, admin, auditor. Medical-data flag per role; expiry per role; an auditor account must have an expiry (CSV-imported auditors get 30 days)."],
  ["Created", "A temporary password or a 24-hour enrolment code is shown once."],
  ["Enrolment code", "Admin and HSE manager for anyone; officers and site heads only for people below them at their own sites."],
  ["Reset password", "Temporary password shown once; the user must change it at sign-in; sessions are signed out."],
  ["Reset authenticator", "Clears MFA; the user sets it up again at the next sign-in."],
  ["Unlock", "Clears a lockout early."],
  ["Deactivate", "With Undo; the user can no longer sign in."],
  ["Import", "CSV: name, employee code, email, language, employer, department, trade, phone, role, site code."]]));
c.push(h2("5.6 Categories"));
c.push(...consoleImg("console-categories.png", "Categories"));
c.push(table([0.28, 0.72], [["Field", "Details"], ["Code, name", "Code and a name in four languages; parent category; icon from the shared set."], ["Applies to", "Industries and report types; empty means all."], ["Flags", "Critical-capable (reports may be rated Extreme and trigger the stop-work alert); incident prompt text shown at triage."], ["Recipients", "Roles notified when a report in this category arrives."], ["Extra fields", "Typed fields (number, text, choice) with required flag, asked on the phone and checked by the server."], ["IS 3786 default", "Default class suggested at triage."], ["Email detail", "What the notification email includes."]]));
c.push(h2("5.7 Risk matrix"));
c.push(...consoleImg("console-risk-matrix.png", "Risk matrix"));
c.push(p("Versions: New draft version, edit the bands (min, max, colour, response text), activate. Every rated record keeps the version it was scored with. Default bands: Low 1–3 (monitor; fix within 90 days or at the next review), Moderate 4–6 (planned reduction within 30 days), High 8–12 (continue only with approved interim controls; fix within 7 days), Extreme 15–25 (stop or do not start; interim control this shift; fix within 72 hours)."));
c.push(h2("5.8 Due dates and reminders"));
c.push(...consoleImg("console-due-dates.png", "Due dates and reminders"));
c.push(table([0.28, 0.72], [["Option", "Details"], ["Due-date rule per band", "Days to due date; interim control required; interim review hours (4 for Extreme, 24 for High by default)."], ["Reminder ladder", "Steps before and after the due date: offset in days, who is told (owner, officer, site head), channel. Extreme reminders ignore quiet hours and the push cap."], ["Related settings", "Dispute pause days; date-change requests before the site head decides (Settings)."]]));
c.push(h2("5.9 Rule sets"));
c.push(...consoleImg("console-rule-sets.png", "Rule sets"));
c.push(p("Statutory timer packs assigned per site (for example BOCW rules for a state). A rule set is a draft until a reviewer verifies it; unverified rule sets appear on the attention board. The timers are shown when a report is escalated to an incident."));
c.push(h2("5.10 Templates (checklist builder)"));
c.push(...consoleImg("console-template-builder.png", "Template builder with the phone preview"));
c.push(table([0.28, 0.72], [["Option", "Details"],
  ["Checklist settings", "Name in four languages; pass mark % (score excludes N/A); any-fail rule (one Fail fails the run, default on); required competence (phase 2); title fields asked once; applies to sites and industries; change note."],
  ["Sections", "Title in four languages; repeatable with a repeat label (e.g. Bay); move up and down; add or remove."],
  ["Questions", "Code; text; answer type: pass/fail/N/A, number (unit, min, max), text, date, single choice, multiple choice, photo, signature; guidance text and image URL; responses with value, label, flag (counts as failure) and score; required; photo on fail; note on fail; action on fail; duplicate question; drag to reorder."],
  ["Preview", "Live phone preview beside the builder."],
  ["Versions", "Draft, in review, active, retired. Submit for review; approved by someone other than the author (admin or HSE manager); copy a template; new draft version."]]));
c.push(h2("5.11 Schedules"));
c.push(...consoleImg("console-schedules.png", "Schedules"));
c.push(table([0.28, 0.72], [["Option", "Details"], ["Template and place", "Template; site; area (empty = whole site); equipment id (optional)."], ["Frequency", "Every N days, weeks or months; weekdays for weekly schedules."], ["Assignee", "A named user or a role (anyone with that role at the site sees the run as due)."], ["Lead and grace", "Lead days: how many days before due the run appears; grace hours: not started by due + grace means Missed."], ["Next due", "Shown, estimated for new schedules."]]));
c.push(h2("5.12 Languages"));
c.push(...consoleImg("console-languages.png", "Languages"));
c.push(p("Completeness per language pack (English, Hindi, Tamil, Kannada) for the phone app, the console and the QR form; any wording can be overridden; incomplete packs appear on the attention board."));
c.push(h2("5.13 Settings"));
c.push(...consoleImg("console-settings.png", "Settings"));
c.push(p("See section 7 for every field and its default."));

/* ---- 6 oversight */
c.push(h1("6. Admin console: oversight pages"));
c.push(...consoleImg("console-audit-log.png", "Audit log"));
c.push(table([0.22, 0.78], [["Page", "What it offers"],
  ["Audit log", "Every create, update, transition, delete, sign-in (success and failure), permission or configuration change, export and sensitive view. Filters by actor, record, action and dates; a diff view of what changed; Verify chain checks the tamper-evident hash chain and reports the number of rows verified."],
  ["Notifications log", "Every delivery: event, recipient, channel (in app, push, email), status, attempts, error, sent time."],
  ["Health", "Backups, jobs, queues and warnings; the same warnings appear on the attention board."],
  ["Privacy", "Privacy notice versions in four languages; which version each worker acknowledged; publish a new version."],
  ["Retention", "Policy per record type: years kept, basis note, end action; legal holds; dry run shows what would be removed before anything is."]]));

/* ---- 7 settings */
c.push(h1("7. Settings: every option and its default"));
c.push(table([0.22, 0.34, 0.44], [["Group", "Setting", "Default and meaning"],
  ["Company", "Company name, legal name, address, phone", "Shown on the privacy notice, posters and statutory forms; phone is the published privacy contact"],
  ["Security and languages", "Roles that need two-step verification", "Admin, HSE manager, site head"],
  ["", "Languages offered", "English, Hindi, Tamil, Kannada (English is always on)"],
  ["", "Default language", "English; must be one of the offered languages"],
  ["Service levels", "Triage SLA (working days)", "1"], ["", "Escalate triage to site head after (working days)", "2"], ["", "Critical acknowledgement target (minutes)", "30"], ["", "Date-change requests before the site head decides", "3"], ["", "Dispute pauses the ladder (days)", "3"],
  ["Notifications", "Quiet hours start and end", "21:00 to 07:00; no non-critical pushes"], ["", "Daily push cap", "5 reminder pushes per person per day; the rest go to the digest"],
  ["Duplicate suggestions", "Window (hours)", "24"], ["", "GPS radius (m)", "30"],
  ["Photos", "Max edge (px)", "1,600"], ["", "JPEG quality", "0.8 (0.3–1.0); about 300 KB per photo"], ["", "Photos per record", "10"], ["", "Photos on the QR form", "3"], ["", "Voice note (seconds)", "60"],
  ["Derived", "Percent safe minimum", "30 behaviours before the KPI is shown"],
  ["Status labels", "Shown beside each setting", "Design default, design target, from the research, or derived, until the company confirms the value"]]));

/* ---- 8 notifications */
c.push(h1("8. Notifications: every event"));
c.push(table([0.3, 0.7], [["Event", "When and to whom"],
  ["New report", "A report arrives: the category's recipient roles at the site"], ["STOP WORK: needs your acknowledgement", "Danger-now report: safety officers, site head, HSE managers; critical"], ["Still unacknowledged", "Repeat after the acknowledgement target; escalates"],
  ["Action assigned to you / reassigned to you", "The owner"], ["Action due soon / due today / overdue", "The owner; later steps of the ladder reach the officer and site head"], ["Action ready to verify", "Verifiers of the site"], ["Action verified / reopened / cancelled", "The owner (and reporter on closure)"], ["Date change requested / Dispute on", "The officer who assigned; the site head for the third date request"], ["Your request was decided", "The owner"], ["Action waits for verification", "Verification SLA reminder"],
  ["Question about your report / Reply on", "Reporter, then the officer"], ["Your report is closed / was reviewed / reopened / escalated", "The reporter"],
  ["Reports waiting for triage at a site", "Officers at the SLA"], ["Triage overdue at a site", "The site head"],
  ["Inspection due / missed / submitted", "The assignee; the officer on a failed run"],
  ["Daily / weekly safety digest", "Everyone who chose a digest in Settings"], ["Your authenticator was reset", "The user, by email"]]));

/* ---- 9 jobs, 10 security, 11 glossary */
c.push(h1("9. Background jobs"));
["Reminder ladder: sends the due-soon, due-today and overdue reminders and escalations, pausing for disputes; Extreme actions bypass quiet hours and the push cap.", "Triage clock: reminds officers at the triage SLA and the site head at the escalation point.", "Danger-now watcher: repeats unacknowledged stop-work alerts and escalates them.", "Inspection scheduler: creates runs from schedules (lead days) and marks runs Missed after due + grace.", "Closure notices: tells reporters when their report closes.", "Digests: daily and weekly emails with open and overdue items.", "Senders: deliver queued push and email notifications with retries; the notifications log records every attempt.", "Retention: applies the policies after a dry run; legal holds are respected."].forEach((t) => c.push(bullet(t)));
c.push(h1("10. Security rules that are always on"));
["Two-step sign-in for the configured roles; an enrolled authenticator cannot be replaced from a password-only session; administrators reset it.", "10 wrong passwords lock the account for 15 minutes; sign-ins and failures are audited.", "Enrolment codes: 24 hours, one use; officers only for people below them; roles that need MFA still get it after an enrolment-code sign-in.", "External auditors are read-only everywhere and must expire.", "Lists, dashboards and exports show only sites where the person may see every record; exports are limited to officers and above and auditors, and audited.", "Only the person who took a photo can upload its bytes; a verified photo cannot be replaced.", "Phone numbers are encrypted; anonymous reports are sealed; CSV exports neutralise spreadsheet formulas.", "Signed, short-lived links for posters and reports; strict content security policy, no-referrer, HSTS and a permissions policy on every response."].forEach((t) => c.push(bullet(t)));
c.push(h1("11. Statuses and glossary"));
c.push(table([0.22, 0.78], [["Record", "Statuses"], ["Report (observation)", "Submitted, Returned to reporter, Action assigned, Merged, Discarded, Escalated to incident, Closed"], ["Action", "Open, In progress, Completed (awaiting verification), Verified, Reopened, Disputed, Cancelled"], ["Inspection run", "Scheduled, In progress, Completed, Missed, Reopened, Cancelled, Closed"], ["Outbox item", "Pending, sending, synced, failed, conflict"], ["Template version", "Draft, in review, active, retired"], ["Risk band", "Low, Moderate, High, Extreme"]]));
c.push(table([0.22, 0.78], [["Term", "Meaning"], ["Band", "The risk level from likelihood × severity on the matrix"], ["Interim control", "What is done this shift to make the place safe until the fix is complete"], ["IS 3786", "The Indian Standard classification of industrial accidents recorded at triage"], ["Danger now", "The reporter's stop-work flag; raises a critical alert that must be acknowledged"], ["Geofence", "The radius around a site; reports outside it are flagged"], ["Enrolment code", "A one-time code that lets a new user choose a password"], ["Reminder ladder", "The sequence of reminders and escalations around a due date"], ["Verify chain", "The check that the audit log has not been altered"]], ));

const numbering = { config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }] };
const doc = new Document({ creator: "SafeWorks", title: "SafeWorks complete reference",
  styles: { default: { document: { run: { font: FONT, size: 21, color: INK } }, heading1: { run: { font: "Arial", size: 34, bold: true, color: INK }, paragraph: { spacing: { before: 340, after: 150 }, keepNext: true } }, heading2: { run: { font: "Arial", size: 26, bold: true, color: INK }, paragraph: { spacing: { before: 260, after: 110 }, keepNext: true } }, heading3: { run: { font: "Arial", size: 23, bold: true, color: "334155" }, paragraph: { spacing: { before: 180, after: 80 }, keepNext: true } } } },
  numbering,
  sections: [{ properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
    headers: { default: new Header({ children: [new Paragraph({ children: [run("SafeWorks complete reference", { size: 18, color: MUTED })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run("Page ", { size: 18, color: MUTED }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: MUTED })] })] }) },
    children: c }] });
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(OUT, buf); console.log("wrote", OUT); });
