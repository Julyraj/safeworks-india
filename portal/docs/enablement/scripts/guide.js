/* SafeWorks User Guide as a Word document (A4). */
const fs = require("fs");
const path = require("path");
const D = require("docx");
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, BorderStyle, ImageRun, PageBreak, LevelFormat, Header, Footer, PageNumber } = D;

const SHOTS = process.env.SHOTS;
const OUT = process.argv[2];
const FONT = "Calibri";
const INK = "0F172A", MUTED = "5B6676", LINE = "E4E7EC", TINT = "F5F6F8", HIVIS = "F5C400";
const PAGE_W = 11906, MARGIN = 1134, CONTENT_W = PAGE_W - 2 * MARGIN; // DXA

const p = (text, opts = {}) => new Paragraph({ spacing: { after: 120 }, ...opts.para, children: typeof text === "string" ? [new TextRun({ text, font: FONT, size: 22, ...opts.run })] : text });
const run = (text, o = {}) => new TextRun({ text, font: FONT, size: 22, ...o });
const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t, font: "Arial" })] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t, font: "Arial" })] });
const h3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: t, font: "Arial" })] });
const bullet = (t) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 60 }, children: typeof t === "string" ? [run(t)] : t });
let numRef = 0;
const numbered = (items) => { numRef++; return items.map((t) => new Paragraph({ numbering: { reference: `num${numRef}`, level: 0 }, spacing: { after: 80 }, children: typeof t === "string" ? [run(t)] : t })); };
const cell = (content, w, opts = {}) => new TableCell({
  width: { size: w, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 100, right: 100 },
  shading: opts.head ? { type: ShadingType.CLEAR, fill: TINT, color: "auto" } : undefined,
  children: (Array.isArray(content) ? content : [content]).map((c) => typeof c === "string" ? new Paragraph({ spacing: { after: 0 }, children: [run(c, { bold: !!opts.head, size: 20, color: opts.head ? INK : undefined })] }) : c),
});
const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const table = (widths, rows) => new Table({
  width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths,
  borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
  rows: rows.map((r, i) => new TableRow({ tableHeader: i === 0, cantSplit: true, children: r.map((c, j) => cell(c, widths[j], { head: i === 0 })) })),
});
const image = (file, widthPx, aspect, caption) => {
  const buf = fs.readFileSync(path.join(SHOTS, file));
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, children: [new ImageRun({ type: "png", data: buf, transformation: { width: widthPx, height: Math.round(widthPx * aspect) }, altText: { title: caption, description: caption, name: caption } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [run(caption, { size: 18, italics: true, color: MUTED })] }),
  ];
};
const W = (fr) => Math.round(CONTENT_W * fr);

const children = [];
// ---- cover
children.push(
  new Paragraph({ spacing: { before: 2400, after: 200 }, children: [new TextRun({ text: "SW", font: "Arial", size: 56, bold: true, color: INK, shading: { type: ShadingType.CLEAR, fill: HIVIS, color: "auto" } })] }),
  new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: "SafeWorks", font: "Arial", size: 72, bold: true, color: INK })] }),
  new Paragraph({ spacing: { after: 600 }, children: [new TextRun({ text: "User Guide", font: "Arial", size: 44, color: MUTED })] }),
  p([run("Workplace safety for Indian construction sites, factories and industrial facilities: report a hazard in 30 seconds, close it with proof.", { size: 24, color: "334155" })]),
  new Paragraph({ spacing: { before: 3600, after: 0 }, children: [run("Portal 2.1 · UI version 2 · November 2026", { size: 20, color: MUTED })] }),
  new Paragraph({ children: [run("Covers the phone app, the QR form and the admin console.", { size: 20, color: MUTED })] }),
  new Paragraph({ children: [new PageBreak()] }),
);
// ---- contents
children.push(h1("Contents"));
children.push(...["1. Executive overview", "2. How it works: architecture and workflow", "3. Core features", "4. How-to: step-by-step use cases", "5. Troubleshooting and FAQ"].map((t) => p(t)));
children.push(new Paragraph({ children: [new PageBreak()] }));

// ---- 1
children.push(h1("1. Executive overview"));
children.push(p([run("SafeWorks", { bold: true }), run(" is a workplace safety platform for Indian construction sites, factories and industrial facilities. It replaces paper observation cards, WhatsApp photos and spreadsheet trackers with one connected system: workers report hazards in seconds from a phone, safety officers score the risk and assign fixes, owners close the actions with photo evidence, verifiers confirm they worked, and managers see the whole picture live.")]));
children.push(p([run("Core value: ", { bold: true }), run("every hazard someone notices is captured, risk-scored, owned, fixed and proven closed, with a complete audit trail. Nothing is lost between the shop floor and the boardroom.")]));
children.push(h2("Who it serves"));
children.push(table([W(0.3), W(0.3), W(0.4)], [
  ["Audience", "What they use", "What they get"],
  ["Workers, visitors, contract staff", "Phone app or QR form (no sign-in needed)", "Report a hazard or good practice in about 30 seconds, in English, Hindi, Tamil or Kannada, even offline"],
  ["Action owners", "Phone app", "A clear list of what to fix and by when, with reminders"],
  ["Safety officers and verifiers", "Phone app", "Triage queue, risk scoring, action assignment, verification"],
  ["Site heads and HSE managers", "Admin console and phone", "Dashboards, overdue escalations, danger-now alerts, Excel reports"],
  ["Administrators", "Admin console", "Sites, users, roles, checklists, rules, languages, audit log"],
  ["External auditors", "Admin console (read-only, time-limited)", "Read and export everything, change nothing"],
]));
children.push(...image("phone-worker-home-light.png", 220, 1688 / 780, "The phone app's Home screen"));

// ---- 2
children.push(h1("2. How it works: architecture and workflow"));
children.push(h2("The four parts"));
children.push(...numbered([
  [run("Phone app (field app): ", { bold: true }), run("an installable web app (also packaged for Android) built for one-handed use with gloves and in sunlight. It keeps working offline: everything you save goes into an Outbox on the phone and is sent automatically when signal returns.")],
  [run("QR form: ", { bold: true }), run("a sign-in-free web form opened by scanning a QR poster at an area or piece of equipment. It is meant for visitors and contract workers, and can be anonymous.")],
  [run("Admin console: ", { bold: true }), run("a desktop web application for registers, dashboards, configuration and oversight.")],
  [run("SafeWorks server: ", { bold: true }), run("stores all records in a PostgreSQL database. It runs the timed jobs (reminders, escalations, digests, danger-now alert watching) and writes every change to a tamper-evident audit log.")],
]));
children.push(h2("The safety loop: from noticing to proven closed"));
children.push(table([W(1 / 6), W(1 / 6), W(1 / 6), W(1 / 6), W(1 / 6), W(1 / 6)], [
  ["Report", "Triage", "Action", "Complete", "Verify", "Closed"],
  ["Worker", "Safety officer", "Owner assigned", "Owner, with after-photo", "Verifier (a different person)", "Reporter sees the result"],
]));
children.push(h2("The user journey, step by step"));
children.push(...numbered([
  [run("Sign in. ", { bold: true }), run("Open the app and pick your language (English is the default; Hindi, Tamil and Kannada are one tap away). Enter your employee code or email and password. A new worker may instead receive an enrolment code from their safety officer. Admins, HSE managers and site heads also confirm a code from an authenticator app (MFA).")],
  [run("Home. ", { bold: true }), run("You see your sync status, the big yellow Report a hazard or good practice button, the items that need you now (overdue actions, items to verify, reports to triage, inspections due), this week's picture for your site, and your recent reports.")],
  [run("Report. ", { bold: true }), run("Choose what you saw (Good practice, Unsafe act, Unsafe condition, Near miss), pick a category, then add photos and a description. The location is filled from GPS and your site's areas. Turn on Danger now if people are at immediate risk. Submit. Offline, you get a pending number, replaced by the real case number (for example TN1-OBS-2026-00041) once it syncs.")],
  [run("Triage. ", { bold: true }), run("A safety officer opens the report from Reports > Triage. They confirm the category, score likelihood × severity on the risk matrix (giving a band: Low, Moderate, High or Extreme), record the employer involved and the IS 3786 classification, and assign one or more corrective actions with owners. Due dates follow the band. The officer may instead mark the report a duplicate, discard it with a reason, or escalate it to an incident.")],
  [run("Action. ", { bold: true }), run("The owner is notified, taps Start, does the work, then taps Complete with an after-photo and an explanation of the root cause addressed. If the date cannot be met they request a new date; if the action is wrong, they dispute it.")],
  [run("Verify. ", { bold: true }), run("A verifier (not the owner) inspects the fix and records it as Effective (the action closes) or Not effective (it goes back to the owner).")],
  [run("Close and learn. ", { bold: true }), run("When every action is verified, the report closes with a closure summary. The worker who reported it sees Closed in My reports. Dashboards, charts, digests and Excel reports update automatically.")],
]));
children.push(h2("What runs in the background"));
children.push(bullet([run("Reminder ladder: ", { bold: true }), run("reminders before and after each due date, escalating to the officer and then the site head. Extreme-risk reminders ignore quiet hours and the daily push limit.")]));
children.push(bullet([run("Triage clock: ", { bold: true }), run("a report left untriaged past the triage deadline (by default 1 working day, escalating at 2) alerts the site head.")]));
children.push(bullet([run("Danger-now watcher: ", { bold: true }), run("a danger-now alert not acknowledged within the set time (by default 30 minutes) escalates.")]));
children.push(bullet([run("Digests: ", { bold: true }), run("daily or weekly summary emails, chosen by each person.")]));
children.push(new Paragraph({ children: [new PageBreak()] }));

// ---- 3
children.push(h1("3. Core features"));
children.push(h2("Phone app"));
children.push(table([W(0.22), W(0.5), W(0.28)], [
  ["Feature", "What it does", "Business value"],
  ["Quick report", "Four report types, category chips ordered by what is most used at the site, up to 10 photos per record, description, location (site, area, equipment), time and GPS locked at capture", "Raises reporting volume by making it faster than not reporting"],
  ["Danger now", "A switch on hazard reports that sends an urgent alert to the site's safety officers, site head and HSE managers, who must acknowledge it", "Gets the right people moving within minutes on life-threatening hazards"],
  ["Fixed on the spot", "Records a hazard the reporter already fixed, with a required note of what was done", "Credits quick action and still captures the learning"],
  ["Anonymous reporting", "Hides the reporter's identity from everyone except where policy allows", "Surfaces issues people would otherwise keep quiet about"],
  ["Report on behalf", "An officer files a report for a worker who has no phone", "Includes workers without smartphones"],
  ["Voice input", "Voice notes and voice-to-text in the description, where the phone supports it", "Helps workers who find typing slow"],
  ["Offline outbox", "Saves everything on the phone without signal and syncs automatically when it returns, retrying failed sends after a short wait; includes Sync now, Retry and diagnostics export", "Sites with poor signal lose nothing"],
  ["My reports", "Every report you made, with its status through to Closed", "Reporters see their reports acted on, which builds trust and encourages more reporting"],
  ["Triage", "Risk matrix scoring, IS 3786 classification, employer involved, duplicate merge, discard with reasons, escalate to incident, assign actions", "Consistent, defensible risk decisions"],
  ["Report and assign", "An officer can score and assign immediately after submitting their own report, even offline", "Removes a separate triage step for officers"],
  ["Actions", "My actions, Verify and Department tabs; Start, Complete with after-photo and root cause, Request new date, Dispute", "Clear ownership and evidence of closure"],
  ["Verification", "An independent verifier marks a completed action Effective or Not effective", "Fixes are proven to work, not just reported"],
  ["Inspections", "Scheduled and spot checklists with pass/fail/N/A, number and choice questions, photos, signature, score, and an action raised automatically on a failed item", "Turns routine checks into tracked findings"],
  ["Charts", "Mine, Department and Site views over 30, 90 or 365 days: reports, hazards, good practice, open and overdue actions, on-time closure, trend, and breakdowns by type, risk, category and status", "Everyone sees how their area is doing"],
  ["Excel from the phone", "Officers download the full period report as an Excel workbook, or share it", "Reports reach managers without a laptop"],
  ["Notifications", "Inbox of alerts; danger-now items need an explicit acknowledgement", "Nothing urgent gets lost among routine messages"],
  ["QR scan", "Scan an area or equipment QR code to start a report with the location filled in", "Correct locations without typing"],
  ["Settings", "Language (English, Hindi, Tamil, Kannada), light or dark appearance, digest frequency, quiet hours, privacy notice", "Each person uses the app the way they work best"],
]));
children.push(h2("QR form (no sign-in)"));
children.push(table([W(0.22), W(0.5), W(0.28)], [
  ["Feature", "What it does", "Business value"],
  ["Public QR form", "Scan the poster to open a short form in four languages: type, category, up to 3 photos, description, optional name and phone, or anonymous", "Visitors and contract workers can report without an account"],
  ["Printable posters", "A4 or A5 posters per area or equipment, with the four languages on the poster", "Reporting points appear wherever work happens"],
]));
children.push(h2("Admin console"));
children.push(...image("console-dashboard-light.png", 640, 900 / 1440, "The admin console dashboard"));
children.push(table([W(0.22), W(0.5), W(0.28)], [
  ["Feature", "What it does", "Business value"],
  ["Dashboard", "KPIs for the chosen sites and dates: open actions, overdue actions, triage backlog, on-time closure, median days to close, participation, danger-now acknowledgement time, inspection completion, repeat findings, discard rate and percent safe, plus weekly trend and breakdowns by type, category, area, employer and department", "Leadership sees the true state of safety at a glance"],
  ["Attention board", "Cards for what needs action now: unacknowledged danger-now alerts, overdue actions, triage backlog, missed inspections and more", "Managers start each day on what matters"],
  ["Registers", "Observations, Actions and Inspections registers with search, filters, saved filters and a detail drawer for each record", "Fast answers to what is happening with a case"],
  ["Case-number jump", "Type or paste a case number in the top search to open it", "Finds any record in one step"],
  ["Command menu (UI version 2)", "Ctrl+K (⌘K on Mac) to jump to any page the role may open, or to paste a case number", "Faster navigation for daily console users"],
  ["Exports", "CSV or Excel for every register, and Full report (Excel) with Summary, Reports, Actions and Departments sheets; limited to officers and above, and auditors, for their own sites", "Board-ready reporting in seconds, with controlled data access"],
  ["Sites and areas", "A site wizard by industry that creates default areas, QR posters and settings; an area tree; site details", "New sites go live in minutes"],
  ["Equipment", "Register equipment per area, linkable to reports and QR codes", "Tracks hazards per machine"],
  ["QR codes", "Create, label, rotate (the old code stops working) and print posters", "Controls reporting points"],
  ["People and contractors", "Workers without logins, contractor companies, CSV import, phone numbers stored encrypted", "Accurate employer-involved data for contractor management"],
  ["Departments", "One company-wide department list; each user belongs to one; actions and reports are counted per department", "Accountability by department"],
  ["Users and roles", "Roles per site (reporter, action owner, verifier, safety officer, site head) or company-wide (HSE manager, admin, auditor); CSV import; enrolment codes; password resets; MFA reset; unlock", "Least-privilege access that is easy to manage"],
  ["Categories", "Hazard categories with optional required extra fields", "Reports capture exactly the details each hazard type needs"],
  ["Risk matrix", "Versioned likelihood × severity matrix with band definitions", "One consistent risk language across sites"],
  ["Due dates and reminders", "Due dates per band and the reminder and escalation ladder", "Matches your SLAs and escalation policy"],
  ["Rule sets", "The statutory rule set applying to each site (for example construction BOCW rules), shown when escalating to an incident", "Keeps statutory duties visible"],
  ["Templates", "An inspection checklist builder with sections, question types, action-on-fail and a live phone preview; versions are approved by someone other than the author", "Controlled, auditable checklists"],
  ["Schedules", "Recurring inspections assigned to people", "Inspections happen on time"],
  ["Languages", "Translation completeness per language, with editable overrides", "The wording fits your workforce"],
  ["Settings", "Organisation details, which roles must use MFA, SLAs, quiet hours, daily push limit, duplicate window, languages, photo quality", "One place for company policy"],
  ["Audit log", "Every change, sign-in and export, linked in a tamper-evident chain with a Verify chain check", "Evidence for audits and investigations"],
  ["Notifications log, Health, Privacy, Retention", "Delivery history, system health, privacy notices with acknowledgement, and retention rules with a dry run", "Operational control and data-protection compliance"],
]));
children.push(new Paragraph({ children: [new PageBreak()] }));

// ---- 4
children.push(h1("4. How-to: step-by-step use cases"));
children.push(h2("Use case 1: Report a hazard from the field (worker)"));
children.push(...numbered([
  "Open SafeWorks on your phone. Check the top of Home: All synced means you are connected. Reporting works offline too.",
  "Tap Report a hazard or good practice, or the yellow + in the bottom bar.",
  "Check the location card at the top (for example TN1 · Construction site 1 · Gate). To change it, tap the card and choose the area or equipment. To skip this step, tap the QR icon in the top bar and scan the poster where you are standing.",
  "Under What did you see?, tap the type, for example Unsafe condition.",
  "Tap at least one category, for example Work at height and falls. Fill in any required details the category asks for.",
  "Tap the photo box and take one or more photos. Add a short description, or tap the microphone to speak it.",
  "If people are in immediate danger, turn on Danger now. If you already fixed it, turn on Fixed on the spot and say what you did. To hide your name, turn on Report anonymously.",
  "Tap Submit. You will see your case number, or a pending number if you are offline.",
  "Follow it later in Reports > My reports.",
]));
children.push(...image("phone-worker-report-light.png", 220, 1688 / 780, "The Quick report screen"));
children.push(h2("Use case 2: Triage a report and assign an action (safety officer)"));
children.push(...numbered([
  "In the phone app, go to Reports > Triage. Danger-now reports are listed first.",
  "Open the report and check the photos, location and description. If it repeats an open report, choose Duplicate. If it is not valid, choose Discard and pick a reason.",
  "Choose Accept and assign. Confirm the category, and set Likelihood and Severity on the matrix. The band (Low, Moderate, High or Extreme) appears.",
  "Select the IS 3786 classification and the Employer involved (your own company or a contractor).",
  "Under Actions, describe the fix, choose the Owner, and accept the suggested due date (set from the band) or change it. Add more actions if needed.",
  "Tap Save. The owner is notified at once and the reminder ladder starts.",
  "To track it, go to Actions in the phone app, or in the console go to Registers > Actions and filter by site or owner.",
]));
children.push(h2("Use case 3: Produce the monthly safety report (site head or HSE manager)"));
children.push(...numbered([
  "Open the admin console and sign in, entering your authenticator code.",
  "Go to Overview > Dashboard. In the top bar, choose the site, or All sites.",
  "Set From and To to the month. KPIs, the trend chart and breakdowns update.",
  "Review Overdue actions, On-time closure and Triage backlog. Click a breakdown (for example a category) to open the matching register.",
  "Click Full report (Excel). The workbook downloads with Summary, Reports, Actions and Departments sheets.",
  "For a single register, go to Registers > Observations (or Actions), apply filters, then click Excel or CSV.",
  "On a phone, an officer can do the same from More > Charts > Excel.",
]));
children.push(new Paragraph({ children: [new PageBreak()] }));

// ---- 5
children.push(h1("5. Troubleshooting and FAQ"));
children.push(table([W(0.05), W(0.25), W(0.28), W(0.42)], [
  ["#", "Problem", "Why it happens", "How to fix it"],
  ["1", "A report stays Pending in More > Outbox", "The phone had no connection when it tried to send", "Move to an area with signal. It sends automatically, retrying after a short wait. Tap Sync now to send at once. If an item shows Failed, open it to read why (for example, the area was deleted) and correct it. Use Export diagnostics if support asks for it."],
  ["2", "“Too many failed attempts. Try again in 15 minutes.”", "10 wrong passwords in a row lock the account", "Wait 15 minutes, or ask an administrator to use Users & roles > (user) > Unlock. A worker who has forgotten their password can get a new enrolment code from their safety officer."],
  ["3", "Lost or replaced phone with the authenticator app", "MFA codes come from the old phone, and for safety a new authenticator cannot be set up with just a password", "Ask an administrator to open Users & roles > (user) > Reset MFA. At the next sign-in you will set up the authenticator again."],
  ["4", "Complete is refused, or the button is missing on an action", "An after-photo is required; a disputed action cannot be completed until the dispute is decided; only the owner can complete", "Add an after-photo and the root-cause note. If you disputed the action, wait for the officer's decision. Check that you are the owner shown on the action."],
  ["5", "“Charts need a connection”, or the Excel button is greyed out", "Charts and exports come live from the server and are not stored offline; exports are limited to officers, site heads, HSE managers, admins and auditors", "Reconnect and reopen the page. A notice appears when the charts on screen could not be refreshed. If you need exports and do not have them, ask an administrator to review your role."],
]));
children.push(p([run("Support: ", { bold: true }), run("your site safety officer first, then your SafeWorks administrator. The Outbox's Export diagnostics file helps them see what happened on your phone.")], { para: { spacing: { before: 240 } } }));

const numbering = { config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }] };
for (let i = 1; i <= numRef; i++) numbering.config.push({ reference: `num${i}`, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] });

const doc = new Document({
  creator: "SafeWorks", title: "SafeWorks User Guide",
  styles: {
    default: {
      document: { run: { font: FONT, size: 22, color: INK } },
      heading1: { run: { font: "Arial", size: 36, bold: true, color: INK }, paragraph: { spacing: { before: 360, after: 160 }, keepNext: true } },
      heading2: { run: { font: "Arial", size: 28, bold: true, color: INK }, paragraph: { spacing: { before: 280, after: 120 }, keepNext: true } },
      heading3: { run: { font: "Arial", size: 24, bold: true, color: "334155" }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true } },
    },
  },
  numbering,
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
    headers: { default: new Header({ children: [new Paragraph({ children: [run("SafeWorks User Guide", { size: 18, color: MUTED })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run("Page ", { size: 18, color: MUTED }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: MUTED })] })] }) },
    children,
  }],
});
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(OUT, buf); console.log("wrote", OUT); });
