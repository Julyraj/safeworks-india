/* SafeWorks client-onboarding deck: 10 slides, structured (theme, layouts, placeholders, sections). */
const path = require("path");
const fs = require("fs");
const pptxgen = require("pptxgenjs");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const sharp = require("sharp");
const Fi = require("react-icons/fi");
const { applyTheme } = require(process.env.PPTX_SKILL + "/scripts/apply_theme.js");

const SHOTS = process.env.SHOTS;
const OUT = process.argv[2];

const THEME = {
  name: "SafeWorks",
  headFontFace: "Arial",
  bodyFontFace: "Calibri",
  colors: { dk1: "0F172A", lt1: "FFFFFF", dk2: "334155", lt2: "F5F6F8", accent1: "F5C400", accent2: "1D5FA7", accent3: "1F7A4D", accent4: "D9620B", accent5: "C62828", accent6: "5B6676", hlink: "1D5FA7", folHlink: "5B6676" },
};
const H = THEME.colors;

async function icon(Icon, color, size = 256) {
  const svg = renderToStaticMarkup(React.createElement(Icon, { color: "#" + color, size }));
  const buf = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}
function shot(name) { return path.join(SHOTS, name); }

(async () => {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9"; // 10 x 5.625 in
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  pres.author = "SafeWorks";
  pres.title = "SafeWorks client onboarding";
  const C = pres.SchemeColor;

  // ---- layouts
  pres.defineSlideMaster({
    title: "TITLE_DARK", background: { color: H.dk1 },
    objects: [{ placeholder: { options: { name: "title", type: "title", x: 0.6, y: 1.5, w: 5.4, h: 1.8, fontSize: 40, bold: true, color: C.background1, valign: "middle", align: "left", margin: 0 } } }],
  });
  pres.defineSlideMaster({
    title: "CONTENT", background: { color: H.lt1 },
    objects: [
      { placeholder: { options: { name: "title", type: "title", x: 0.5, y: 0.35, w: 9, h: 0.75, fontSize: 30, bold: true, color: C.text1, valign: "middle", margin: 0 } } },
      { text: { text: "SafeWorks · Client onboarding", options: { x: 0.5, y: 5.2, w: 5, h: 0.3, fontSize: 10, color: C.accent6, margin: 0 } } },
    ],
    slideNumber: { x: 9.1, y: 5.2, w: 0.5, h: 0.3, fontSize: 10, color: H.accent6 },
  });
  pres.defineSlideMaster({
    title: "CLOSE_DARK", background: { color: H.dk1 },
    objects: [{ placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.45, w: 8.8, h: 0.9, fontSize: 34, bold: true, color: C.background1, valign: "middle", margin: 0 } } }],
  });

  // ---- helpers
  const mark = (slide, x, y, s = 0.6) => {
    slide.addShape(pres.ShapeType.roundRect, { x, y, w: s, h: s, fill: { color: C.accent1 }, line: { color: C.accent1 }, rectRadius: 0.12, objectName: "SafeWorks mark" });
    slide.addText("SW", { x, y, w: s, h: s, fontSize: s * 24, bold: true, color: C.text1, align: "center", valign: "middle", margin: 0, isTextBox: true, objectName: "SW" });
  };
  const card = (slide, x, y, w, h, name) => slide.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: C.background2 }, line: { color: "E4E7EC", width: 0.75 }, rectRadius: 0.12, objectName: name });
  const iconCircle = async (slide, Icon, x, y, d, bg, fg, name) => {
    slide.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color: bg }, line: { color: bg }, objectName: name + " circle" });
    slide.addImage({ data: await icon(Icon, fg), x: x + d * 0.24, y: y + d * 0.24, w: d * 0.52, h: d * 0.52, objectName: name + " icon" });
  };
  const bullets = (items) => items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < items.length - 1, paraSpaceAfter: 6 } }));
  // phone screenshot inside a dark frame (the screenshots are 780 x 1688)
  const phone = (slide, file, x, y, h, name) => {
    const w = h * 780 / 1688;
    slide.addShape(pres.ShapeType.roundRect, { x: x - 0.08, y: y - 0.08, w: w + 0.16, h: h + 0.16, fill: { color: "1E293B" }, line: { color: "1E293B" }, rectRadius: 0.25, objectName: name + " frame" });
    slide.addImage({ path: shot(file), x, y, w, h, objectName: name });
    return w;
  };
  const iconRow = async (slide, Icon, x, y, w, head, body, name, tone = C.accent1) => {
    await iconCircle(slide, Icon, x, y + 0.02, 0.5, tone, H.dk1, name);
    slide.addText([{ text: head, options: { bold: true, breakLine: true } }, { text: body, options: { color: C.text2 } }], { x: x + 0.65, y, w: w - 0.65, h: 0.78, fontSize: 13, color: C.text1, valign: "top", margin: 0, isTextBox: true, objectName: name + " text" });
  };

  // =============== 1. Title
  pres.addSection({ title: "Opening" });
  {
    const s = pres.addSlide({ masterName: "TITLE_DARK", sectionTitle: "Opening" });
    mark(s, 0.6, 0.6, 0.7);
    s.addText("SafeWorks", { x: 1.45, y: 0.6, w: 4, h: 0.7, fontSize: 22, bold: true, color: C.background1, valign: "middle", margin: 0, isTextBox: true, objectName: "Brand" });
    s.addText("Every hazard noticed. Every fix proven.", { placeholder: "title" });
    s.addText("Workplace safety, connected. Report in 30 seconds, close with proof, in four languages.", { x: 0.6, y: 3.4, w: 5.2, h: 0.9, fontSize: 16, color: "CBD5E1", valign: "top", margin: 0, isTextBox: true, objectName: "Tagline" });
    s.addText("Client onboarding · November 2026", { x: 0.6, y: 4.8, w: 5, h: 0.4, fontSize: 12, color: C.accent1, margin: 0, isTextBox: true, objectName: "Date" });
    phone(s, "phone-worker-home-light.png", 7.1, 0.45, 4.75, "Home screen");
    s.addNotes("Welcome, and thank you for choosing SafeWorks. Think about the last near miss on your site. Someone saw it. Did it get written down, did someone own the fix, and can you prove today that it was fixed? SafeWorks exists so the answer to all three is always yes. Over the next few minutes I will show you how the platform works, what your teams will do day to day, and how you will measure the difference.");
  }

  // =============== 2. Problem
  pres.addSection({ title: "Why" });
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Why" });
    s.addText("The problem: safety information leaks", { placeholder: "title" });
    s.addText("Most sites do not lack people who care. They lack a system that holds on to what those people notice. At every hand-off, something is lost.", { x: 0.5, y: 1.25, w: 3.4, h: 1.6, fontSize: 15, color: C.text2, valign: "top", margin: 0, isTextBox: true, objectName: "Problem intro" });
    s.addText("Four leaks in the pipeline, shown on the right", { x: 0.5, y: 2.95, w: 3.4, h: 0.4, fontSize: 13, italic: true, color: C.accent6, margin: 0, isTextBox: true, objectName: "Problem caption" });
    const leaks = [
      [Fi.FiFileText, "Lost", "Paper cards go missing; photos sit in group chats"],
      [Fi.FiUserX, "Unowned", "No single owner and no due date for the fix"],
      [Fi.FiHelpCircle, "Unproven", "Fixes are claimed, never independently checked"],
      [Fi.FiClock, "Late", "Audit trails rebuilt by hand, days before the audit"],
    ];
    const gx = 4.3, gy = 1.25, cw = 2.55, ch = 1.75, gap = 0.3;
    for (let i = 0; i < 4; i++) {
      const x = gx + (i % 2) * (cw + gap), y = gy + Math.floor(i / 2) * (ch + gap);
      card(s, x, y, cw, ch, `Leak card ${i + 1}`);
      await iconCircle(s, leaks[i][0], x + 0.2, y + 0.2, 0.55, "FDECEC", H.accent5, `Leak ${i + 1}`);
      s.addText([{ text: leaks[i][1], options: { bold: true, fontSize: 15, breakLine: true } }, { text: leaks[i][2], options: { fontSize: 12.5, color: C.text2 } }], { x: x + 0.2, y: y + 0.85, w: cw - 0.4, h: 0.8, color: C.text1, valign: "top", margin: 0, isTextBox: true, objectName: `Leak text ${i + 1}` });
    }
    s.addNotes("Most sites do not lack people who care about safety. They lack a system that holds on to what those people notice. Observations live on paper cards that go missing, and photos sit in group chats. Actions have no single owner and no deadline. When something is fixed, nobody independently checks it, and when the auditor arrives, someone spends days rebuilding the trail from spreadsheets. Every leak in that pipeline is a hazard that can come back.");
  }

  // =============== 3. Solution
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Why" });
    s.addText("The solution: one connected safety loop", { placeholder: "title" });
    const steps = [[Fi.FiCamera, "Report"], [Fi.FiTarget, "Triage"], [Fi.FiUserCheck, "Action"], [Fi.FiCheckSquare, "Complete"], [Fi.FiShield, "Verify"], [Fi.FiCheckCircle, "Closed"]];
    const d = 0.8, x0 = 0.7, y0 = 1.35, pitch = 1.56;
    for (let i = 0; i < steps.length; i++) {
      const x = x0 + i * pitch;
      if (i < steps.length - 1) s.addShape(pres.ShapeType.line, { x: x + d, y: y0 + d / 2, w: pitch - d, h: 0, line: { color: "CDD3DB", width: 1.5, endArrowType: "triangle" }, objectName: `Arrow ${i + 1}` });
      await iconCircle(s, steps[i][0], x, y0, d, i === steps.length - 1 ? H.accent3 : H.accent1, i === steps.length - 1 ? H.lt1 : H.dk1, `Loop ${i + 1}`);
      s.addText(steps[i][1], { x: x - 0.3, y: y0 + d + 0.08, w: d + 0.6, h: 0.35, fontSize: 13, bold: true, align: "center", color: C.text1, margin: 0, isTextBox: true, objectName: `Loop label ${i + 1}` });
    }
    const devices = [
      [Fi.FiSmartphone, "Phone app", "Workers, owners, officers and verifiers. Works offline and syncs by itself."],
      [Fi.FiGrid, "QR form", "Visitors and contract workers scan a poster. No account, four languages, anonymous if they wish."],
      [Fi.FiMonitor, "Admin console", "Registers, dashboards, Excel reports, roles, checklists and the audit log."],
    ];
    for (let i = 0; i < 3; i++) {
      const x = 0.5 + i * 3.05, y = 2.95, w = 2.9, h = 2.05;
      card(s, x, y, w, h, `Device card ${i + 1}`);
      await iconCircle(s, devices[i][0], x + 0.2, y + 0.2, 0.55, H.lt1, H.accent2, `Device ${i + 1}`);
      s.addText(devices[i][1], { x: x + 0.9, y: y + 0.22, w: w - 1.1, h: 0.5, fontSize: 15, bold: true, color: C.text1, valign: "middle", margin: 0, isTextBox: true, objectName: `Device head ${i + 1}` });
      s.addText(devices[i][2], { x: x + 0.2, y: y + 0.9, w: w - 0.4, h: 1.05, fontSize: 12.5, color: C.text2, valign: "top", margin: 0, isTextBox: true, objectName: `Device body ${i + 1}` });
    }
    s.addNotes("SafeWorks closes that pipeline into a single loop. Workers report from the phone app, or visitors and contract workers scan a QR poster with no account at all. Safety officers triage and assign. Owners fix and prove it with photos, and an independent verifier confirms it worked. Your managers watch it all live in the admin console. Because the app works offline, a site with patchy signal loses nothing, and because every step is recorded in a tamper-evident audit log, your evidence builds itself as people work.");
  }

  // =============== 4. Workflow
  pres.addSection({ title: "How it works" });
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "How it works" });
    s.addText("How it works, in seven steps", { placeholder: "title" });
    const steps = [
      ["Sign in", "Worker", "In English, Hindi, Tamil or Kannada"],
      ["Report", "Worker", "Type, category, photo, submit, in about 30 seconds"],
      ["Triage", "Safety officer", "Risk score sets the band and the due date; owner assigned"],
      ["Fix", "Action owner", "Start, then complete with an after-photo"],
      ["Verify", "Verifier", "Effective or not effective, by a different person"],
      ["Close", "SafeWorks", "Report closes; the reporter sees the result"],
      ["Measure", "Manager", "Dashboards, digests and Excel"],
    ];
    const cols = 4, cw = 2.15, ch = 1.6, gx = 0.5, gy = 1.3, gap = 0.13;
    for (let i = 0; i < steps.length; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const x = gx + c * (cw + gap) + (r === 1 ? (cw + gap) / 2 : 0), y = gy + r * (ch + 0.3);
      card(s, x, y, cw, ch, `Step card ${i + 1}`);
      s.addShape(pres.ShapeType.ellipse, { x: x + 0.18, y: y + 0.18, w: 0.46, h: 0.46, fill: { color: C.accent1 }, line: { color: C.accent1 }, objectName: `Step number circle ${i + 1}` });
      s.addText(String(i + 1), { x: x + 0.18, y: y + 0.18, w: 0.46, h: 0.46, fontSize: 14, bold: true, align: "center", valign: "middle", color: C.text1, margin: 0, isTextBox: true, objectName: `Step number ${i + 1}` });
      s.addText([{ text: steps[i][0], options: { bold: true, fontSize: 15, breakLine: true } }, { text: steps[i][1], options: { fontSize: 11, color: C.accent2, bold: true } }], { x: x + 0.75, y: y + 0.15, w: cw - 0.9, h: 0.55, color: C.text1, valign: "top", margin: 0, isTextBox: true, objectName: `Step head ${i + 1}` });
      s.addText(steps[i][2], { x: x + 0.18, y: y + 0.8, w: cw - 0.36, h: 0.72, fontSize: 12, color: C.text2, valign: "top", margin: 0, isTextBox: true, objectName: `Step body ${i + 1}` });
    }
    s.addText("Reminders, escalations and danger-now alerts run in the background the whole time.", { x: 0.5, y: 4.78, w: 9, h: 0.35, fontSize: 12, italic: true, color: C.accent6, margin: 0, isTextBox: true, objectName: "Workflow footnote" });
    s.addNotes("Here is the journey. A worker signs in, in English, Hindi, Tamil or Kannada, and reports in about thirty seconds. A safety officer scores the risk on your matrix, which sets the band and the due date, and assigns an owner. The owner gets reminders, does the work and completes it with an after-photo. A verifier, never the same person, marks it effective. The report closes, and the person who raised it sees that it closed. That visible result is what keeps people reporting. Meanwhile, reminders and escalations run automatically, so nothing goes overdue quietly.");
  }

  // =============== 5. Reporting
  pres.addSection({ title: "Features" });
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Features" });
    s.addText("Reporting that people actually use", { placeholder: "title" });
    phone(s, "phone-worker-report-light.png", 0.75, 1.25, 3.85, "Quick report screen");
    const rows = [
      [Fi.FiLayers, "Four types, including good practice", "Not only about blame; safe behaviour is recorded too"],
      [Fi.FiCamera, "Up to 10 photos and voice input", "Time and GPS locked at capture"],
      [Fi.FiAlertTriangle, "Danger now", "Urgent alert to officers, site head and HSE; must be acknowledged"],
      [Fi.FiEyeOff, "Anonymous and QR options", "Report without a name, or without an account"],
      [Fi.FiWifiOff, "Offline outbox", "Saves without signal and sends itself later"],
    ];
    for (let i = 0; i < rows.length; i++) await iconRow(s, rows[i][0], 3.4, 1.25 + i * 0.78, 6.1, rows[i][1], rows[i][2], `Report row ${i + 1}`);
    s.addNotes("Reporting has to be faster than not reporting, or people will not do it. One big yellow button, four clear types including good practice, so it is not only about blame, and category chips ordered by what your site sees most. Time and GPS are locked at capture. If someone is in immediate danger, the Danger now switch alerts your officers, site head and HSE managers, and they must acknowledge it. Workers can report anonymously, visitors can scan a QR poster, and with no signal, the report waits in the outbox and sends itself when signal returns.");
  }

  // =============== 6. Triage and actions
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Features" });
    s.addText("Triage and actions with clear ownership", { placeholder: "title" });
    const rows = [
      [Fi.FiTarget, "Your risk matrix sets band and due date", "Likelihood × severity: Low, Moderate, High or Extreme"],
      [Fi.FiFileText, "IS 3786 classification, employer involved", "Real contractor data for every hazard"],
      [Fi.FiBell, "One owner, reminders, escalation ladder", "Before and after the due date, up to the site head"],
      [Fi.FiImage, "Complete needs an after-photo", "Plus the root cause addressed; owners can request a new date or dispute"],
      [Fi.FiShield, "Independent verification", "A different person marks the fix effective or not"],
    ];
    for (let i = 0; i < rows.length; i++) await iconRow(s, rows[i][0], 0.5, 1.25 + i * 0.78, 5.6, rows[i][1], rows[i][2], `Triage row ${i + 1}`);
    phone(s, fs.existsSync(shot("triage-sheet.png")) ? "triage-sheet.png" : "phone-worker-actions-light.png", 6.9, 1.25, 3.85, "Triage screen");
    s.addNotes("Triage is where SafeWorks makes risk decisions consistent. Officers score likelihood and severity on your own matrix; the band sets the due date and how hard reminders push. They record the IS 3786 classification and the employer involved, which gives you real contractor data. Each action has one owner. Completing it requires an after-photo and the root cause addressed, and a different person verifies it. Owners can request a new date or dispute an action, and both are recorded and decided, not lost in a conversation.");
  }

  // =============== 7. Managers
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Features" });
    s.addText("Visibility and control for managers", { placeholder: "title" });
    s.addShape(pres.ShapeType.roundRect, { x: 0.42, y: 1.17, w: 5.76, h: 3.66, fill: { color: "1E293B" }, line: { color: "1E293B" }, rectRadius: 0.1, objectName: "Dashboard frame" });
    s.addImage({ path: shot("console-dashboard-light.png"), x: 0.5, y: 1.25, w: 5.6, h: 3.5, objectName: "Console dashboard" });
    const rows = [
      [Fi.FiBarChart2, "Live KPIs", "By site, date and department"],
      [Fi.FiFlag, "Attention board", "What needs action today"],
      [Fi.FiDownload, "Full report (Excel)", "One click, four sheets"],
      [Fi.FiLock, "Roles, MFA, auditors", "Time-limited, read-only auditor access"],
      [Fi.FiList, "Audit log", "Tamper-evident, verified in one click"],
    ];
    for (let i = 0; i < rows.length; i++) await iconRow(s, rows[i][0], 6.5, 1.25 + i * 0.75, 3.1, rows[i][1], rows[i][2], `Manager row ${i + 1}`);
    s.addNotes("For managers, the admin console is the control room. The dashboard shows open and overdue actions, triage backlog, on-time closure, median days to close and participation, filtered by site, dates and department. The attention board lists what needs someone today. One click produces a full Excel report for your monthly review. Access is role-based per site, admins and site heads use an authenticator code, and external auditors get read-only access that expires. Every change is in an audit log you can verify in one click.");
  }

  // =============== 8. Use case
  pres.addSection({ title: "In practice" });
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "In practice" });
    s.addText("A near miss on level 3, start to finish", { placeholder: "title" });
    const ev = [
      ["10:02", "Bricks fall from the hoist landing. Nobody hurt. A worker reports a near miss with a photo, offline at first."],
      ["10:04", "Signal returns on the way back; the outbox sends it. Case number assigned."],
      ["10:15", "The safety officer scores it High and assigns edge protection to the site engineer."],
      ["Next day", "Guard rail, mid-rail and toe board fitted. Completed with an after-photo and the cause addressed."],
      ["Next day", "The verifier marks it effective. The report closes; the worker sees Closed in My reports."],
      ["Month end", "The fix appears in the Excel report, with nothing retyped."],
    ];
    const cw = 2.9, ch = 1.72, gx = 0.5, gy = 1.25, gap = 0.15;
    for (let i = 0; i < ev.length; i++) {
      const x = gx + (i % 3) * (cw + gap), y = gy + Math.floor(i / 3) * (ch + gap);
      card(s, x, y, cw, ch, `Event card ${i + 1}`);
      s.addShape(pres.ShapeType.roundRect, { x: x + 0.18, y: y + 0.18, w: 1.0, h: 0.36, fill: { color: i >= 4 ? C.accent3 : C.accent1 }, line: { color: i >= 4 ? C.accent3 : C.accent1 }, rectRadius: 0.08, objectName: `Event time box ${i + 1}` });
      s.addText(ev[i][0], { x: x + 0.18, y: y + 0.18, w: 1.0, h: 0.36, fontSize: 12, bold: true, align: "center", valign: "middle", color: i >= 4 ? C.background1 : C.text1, margin: 0, isTextBox: true, objectName: `Event time ${i + 1}` });
      s.addText(ev[i][1], { x: x + 0.18, y: y + 0.65, w: cw - 0.36, h: 1.0, fontSize: 12.5, color: C.text2, valign: "top", margin: 0, isTextBox: true, objectName: `Event text ${i + 1}` });
    }
    s.addNotes("Here is a real pattern. At 10:02, bricks fall from the hoist landing; nobody is hurt. A worker reports a near miss with a photo, offline at first, and it syncs as he walks back. By 10:15 the safety officer has scored it High and assigned edge protection to the site engineer, with a due date set by the band. The next day the guard rail, mid-rail and toe board are fitted, photographed and completed. The verifier walks past, marks it effective, and the report closes. The worker sees it closed, and at month end the fix appears in the Excel report without anyone retyping it.");
  }

  // =============== 9. ROI
  {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "In practice" });
    s.addText("What you will measure from day one", { placeholder: "title" });
    const kpis = [["Participation", "share of workers reporting"], ["On-time closure", "and median days to close"], ["Overdue actions", "and triage backlog"], ["Danger-now", "acknowledgement time"], ["Repeat findings", "same hazard, same place"], ["Percent safe", "from inspections"]];
    const cw = 1.75, ch = 1.05, gx = 0.5, gy = 1.25, gap = 0.15;
    for (let i = 0; i < kpis.length; i++) {
      const x = gx + (i % 2) * (cw + gap), y = gy + Math.floor(i / 2) * (ch + gap);
      card(s, x, y, cw, ch, `KPI card ${i + 1}`);
      s.addText([{ text: kpis[i][0], options: { bold: true, fontSize: 14, breakLine: true } }, { text: kpis[i][1], options: { fontSize: 11, color: C.text2 } }], { x: x + 0.15, y: y + 0.12, w: cw - 0.3, h: ch - 0.2, color: C.text1, valign: "top", margin: 0, isTextBox: true, objectName: `KPI text ${i + 1}` });
    }
    s.addChart(pres.ChartType.bar, [{ name: "Hours per month compiling reports", labels: ["Before: registers by hand", "After: Full report (Excel)"], values: [24, 1] }], {
      x: 4.5, y: 1.2, w: 5.1, h: 3.35, barDir: "col", chartColors: [H.accent6, H.accent1], showTitle: true, title: "Illustrative example: hours per month compiling reports", titleFontSize: 12, titleFontFace: "+mn-lt", titleColor: H.dk2,
      showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: 12, dataLabelFontFace: "+mn-lt", dataLabelColor: H.dk1, dataLabelFormatCode: "0",
      catAxisLabelFontSize: 11, catAxisLabelFontFace: "+mn-lt", catAxisLabelColor: H.accent6, valAxisLabelFontSize: 10, valAxisLabelFontFace: "+mn-lt", valAxisLabelColor: H.accent6,
      valGridLine: { color: "E4E7EC", size: 0.5 }, catGridLine: { style: "none" }, showLegend: false, valAxisMaxVal: 30,
    });
    s.addText("Assumes one officer spending about three days a month compiling registers and reports, replaced by minutes of review. An example of scale, not a guarantee; agree your own baseline in week one.", { x: 4.5, y: 4.6, w: 5.1, h: 0.55, fontSize: 10, italic: true, color: C.accent6, valign: "top", margin: 0, isTextBox: true, objectName: "ROI assumptions" });
    s.addNotes("We will not ask you to take ROI on faith. SafeWorks measures it for you from the first day: participation, on-time closure, median days to close, overdue actions, how quickly danger-now alerts are acknowledged, and repeat findings. Agree your baseline with us in week one and track it monthly. To give a sense of scale, here is an illustrative example, not a guarantee. If one officer currently spends about three days a month compiling registers and reports, Full report Excel replaces that with a few minutes of review. The bigger return is harder to put a number on: hazards that get fixed before they hurt someone.");
  }

  // =============== 10. CTA
  pres.addSection({ title: "Next steps" });
  {
    const s = pres.addSlide({ masterName: "CLOSE_DARK", sectionTitle: "Next steps" });
    s.addText("Let's go live", { placeholder: "title" });
    const weeks = [
      ["Week 1", "Set up", "Sites by industry wizard, users imported, QR posters printed in four languages"],
      ["Week 2", "Pilot", "One site live; safety officers trained on triage and actions"],
      ["Week 3", "Roll out", "All sites live; first monthly report from the dashboard"],
    ];
    for (let i = 0; i < 3; i++) {
      const x = 0.6 + i * 3.0, y = 1.65, w = 2.8, h = 2.1;
      s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: "1E293B" }, line: { color: "334155", width: 0.75 }, rectRadius: 0.12, objectName: `Week card ${i + 1}` });
      s.addText(weeks[i][0], { x: x + 0.25, y: y + 0.2, w: w - 0.5, h: 0.35, fontSize: 12, bold: true, color: C.accent1, margin: 0, isTextBox: true, objectName: `Week label ${i + 1}` });
      s.addText(weeks[i][1], { x: x + 0.25, y: y + 0.55, w: w - 0.5, h: 0.5, fontSize: 22, bold: true, color: C.background1, margin: 0, isTextBox: true, objectName: `Week head ${i + 1}` });
      s.addText(weeks[i][2], { x: x + 0.25, y: y + 1.1, w: w - 0.5, h: 0.9, fontSize: 12.5, color: "CBD5E1", valign: "top", margin: 0, isTextBox: true, objectName: `Week body ${i + 1}` });
    }
    s.addShape(pres.ShapeType.roundRect, { x: 0.6, y: 4.15, w: 8.8, h: 0.85, fill: { color: C.accent1 }, line: { color: C.accent1 }, rectRadius: 0.12, objectName: "CTA band" });
    s.addText([{ text: "Next step: ", options: { bold: true } }, { text: "confirm your pilot site today, and your first reports come in this week." }], { x: 0.85, y: 4.15, w: 8.3, h: 0.85, fontSize: 16, color: C.text1, valign: "middle", margin: 0, isTextBox: true, objectName: "CTA text" });
    mark(s, 8.8, 0.6, 0.6);
    s.addNotes("Going live is quick. In week one we set up your sites with the industry wizard, import your users and print QR posters in four languages. In week two we run a pilot on one site and train your safety officers on triage. In week three we roll out across sites, and you produce your first monthly report from the dashboard. The one decision we need today is your pilot site. Choose it with us, and we will have your first reports coming in this week.");
  }

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
})().catch((e) => { console.error(e); process.exit(1); });
