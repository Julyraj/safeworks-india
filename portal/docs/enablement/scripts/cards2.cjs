/* Layers for the complete walkthrough: title cards and per-scene frames (phone bezel or monitor, captions). 1920x1080. */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const CSS = `
  * { box-sizing: border-box; margin: 0; }
  body { width: 1920px; height: 1080px; overflow: hidden; font-family: "Inter", system-ui, sans-serif; color: #0b1220; background: #f5f6f8; -webkit-font-smoothing: antialiased; }
  .dark { background: #0f172a; color: #fff; }
  .mark { display: inline-grid; place-items: center; width: 72px; height: 72px; border-radius: 18px; background: #f5c400; color: #0b1220; font-weight: 800; font-size: 30px; }
  .brand { position: absolute; left: 72px; top: 56px; display: flex; align-items: center; gap: 18px; font-weight: 700; font-size: 30px; }
  .brand.small { left: auto; right: 72px; top: 44px; font-size: 22px; } .brand.small .mark { width: 48px; height: 48px; border-radius: 12px; font-size: 20px; }
  h1 { font-weight: 750; letter-spacing: -0.03em; line-height: 1.05; }
  .sub { color: #5b6676; font-size: 30px; line-height: 1.4; } .dark .sub { color: #cbd5e1; }
  .bezel { position: absolute; background: #0f172a; border-radius: 48px; box-shadow: 0 30px 80px -20px rgba(16,24,40,.35); }
  .monitor { position: absolute; background: #0f172a; border-radius: 22px; box-shadow: 0 30px 80px -20px rgba(16,24,40,.35); }
  .cap { position: absolute; }
  .cap .kicker { display: inline-block; background: #fff8d6; color: #7a5900; font-weight: 650; font-size: 22px; padding: 8px 16px; border-radius: 10px; margin-bottom: 20px; }
  .cap h2 { font-size: 50px; font-weight: 750; letter-spacing: -0.03em; line-height: 1.08; margin-bottom: 18px; }
  .cap ul { list-style: none; margin-top: 22px; display: grid; gap: 12px; }
  .cap li { font-size: 25px; color: #334155; display: flex; gap: 14px; align-items: flex-start; }
  .cap li::before { content: ""; width: 12px; height: 12px; border-radius: 50%; background: #f5c400; flex: none; margin-top: 11px; }
  .chips { display: flex; gap: 18px; margin-top: 44px; flex-wrap: wrap; }
  .chip { background: #1e293b; color: #fff; border: 1px solid #334155; padding: 16px 26px; border-radius: 999px; font-size: 26px; font-weight: 600; } .chip b { color: #f5c400; margin-right: 10px; }
  .foot { position: absolute; left: 72px; bottom: 120px; color: #94a3b8; font-size: 22px; }
  .capband { position: absolute; left: 0; right: 0; bottom: 0; height: 150px; background: rgba(2,6,23,.0); }
`;
const PHONE = { x: 190, y: 40, w: 407, h: 880, pad: 15 };
const CONSOLE = { x: 60, y: 50, w: 1440, h: 810, pad: 13 };
const phoneScene = (kicker, title, lines) => `<div class="brand small"><span class="mark">SW</span>SafeWorks</div>
  <div class="bezel" style="left:${PHONE.x - PHONE.pad}px;top:${PHONE.y - PHONE.pad}px;width:${PHONE.w + 2 * PHONE.pad}px;height:${PHONE.h + 2 * PHONE.pad}px"></div>
  <div class="cap" style="left:740px;top:150px;width:1100px"><span class="kicker">${kicker}</span><h2>${title}</h2><ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul></div>`;
const consoleScene = (kicker, title, text) => `<div class="monitor" style="left:${CONSOLE.x - CONSOLE.pad}px;top:${CONSOLE.y - CONSOLE.pad}px;width:${CONSOLE.w + 2 * CONSOLE.pad}px;height:${CONSOLE.h + 2 * CONSOLE.pad}px"></div>
  <div class="brand small"><span class="mark">SW</span></div><div class="cap" style="left:1540px;top:140px;width:340px"><span class="kicker" style="font-size:19px;padding:6px 12px">${kicker}</span><h2 style="font-size:34px">${title}</h2><p style="font-size:22px;line-height:1.4;color:#334155">${text}</p></div>`;
const CARDS = {
  "01-hook": { dark: true, html: `<div class="brand"><span class="mark">SW</span></div><div style="position:absolute;left:72px;top:330px;width:1500px"><h1 style="font-size:96px">Someone on your site<br>just spotted a hazard.</h1><p class="sub" style="margin-top:40px;font-size:40px">What happens next decides whether it gets fixed, <span style="color:#f5c400;font-weight:700">or forgotten.</span></p></div>` },
  "02-intro": { dark: true, html: `<div style="position:absolute;left:72px;top:150px;width:1760px"><div style="display:flex;align-items:center;gap:28px"><span class="mark" style="width:120px;height:120px;border-radius:30px;font-size:52px">SW</span><span style="font-size:88px;font-weight:800;letter-spacing:-0.03em">SafeWorks</span></div><h1 style="font-size:58px;margin-top:60px;max-width:1500px">The complete walkthrough: every part, every option.</h1><div class="chips"><span class="chip"><b>1</b>Phone app</span><span class="chip"><b>2</b>QR form</span><span class="chip"><b>3</b>Admin console</span><span class="chip"><b>4</b>Settings and jobs</span></div></div><div class="foot">Product walkthrough · Portal 2.1 · UI version 2</div>` },
  "27-recap": { dark: true, html: `<div class="brand"><span class="mark">SW</span>SafeWorks</div><div style="position:absolute;left:72px;top:250px;width:1780px"><h1 style="font-size:72px">That's SafeWorks.</h1><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:28px;margin-top:64px">${[["Reports in seconds", "Four types, photos, voice, offline, four languages"], ["Owned and verified", "Risk-scored, one owner, after-photo, independent check"], ["Inspections with proof", "Eight question types, action on fail, signature, score"], ["Managers in control", "Dashboard, attention board, registers, audit log"]].map(([h, t]) => `<div style="background:#1e293b;border:1px solid #334155;border-radius:28px;padding:34px"><div style="width:16px;height:16px;border-radius:50%;background:#f5c400;margin-bottom:22px"></div><div style="font-size:34px;font-weight:750;letter-spacing:-0.02em;margin-bottom:14px">${h}</div><div style="font-size:24px;color:#cbd5e1;line-height:1.4">${t}</div></div>`).join("")}</div></div>` },
  "28-end": { dark: true, html: `<div style="position:absolute;left:72px;top:250px;width:1780px;text-align:center"><span class="mark" style="width:140px;height:140px;border-radius:34px;font-size:60px">SW</span><h1 style="font-size:84px;margin-top:50px">Start with your pilot site today</h1><p class="sub" style="margin-top:36px;font-size:36px">Choose the site · print your posters · make your first report</p><div style="display:inline-block;margin-top:70px;background:#f5c400;color:#0b1220;font-weight:750;font-size:36px;padding:26px 54px;border-radius:22px">Report a hazard or good practice</div></div><div class="foot" style="left:0;right:0;text-align:center">Welcome to SafeWorks</div>` },
  "03-signin": { html: phoneScene("Phone app · 1", "Sign in, in your language", ["English, Hindi, Tamil or Kannada", "Employee code, email, or a one-time enrolment code", "Authenticator code for managers and site heads"]) },
  "04-home": { html: phoneScene("Phone app · 2", "Home: what needs you now", ["Sync status and the Report button", "Overdue, to verify, triage backlog, inspections due", "This week at your site; your recent reports"]) },
  "05-report": { html: phoneScene("Phone app · 3", "Quick report, every option", ["Location from GPS or the QR poster", "Type, categories, up to 10 photos, voice or text", "Fixed on the spot · Danger now · Anonymous", "More details: employer and trade"]) },
  "06-reports": { html: phoneScene("Phone app · 4", "Reports and the report page", ["My reports · Triage · Site", "Search and saved filters", "Photos, timeline, comments, actions"]) },
  "07-triage": { html: phoneScene("Phone app · 5", "Triage: seven decisions", ["Accept & assign · Fixed on the spot · Return with question", "Reviewed, no action · Merge · Discard · Escalate", "Risk matrix, IS 3786, employer, interim control, actions"]) },
  "08-actions": { html: phoneScene("Phone app · 6", "Actions: own it, fix it, prove it", ["Start · Complete with after-photo and cause", "Request new date · Dispute (reminders pause)", "Department tab"]) },
  "09-verify": { html: phoneScene("Phone app · 7", "Verify and close", ["A different person compares before and after", "Effective or not effective", "The report closes; the reporter sees Closed"]) },
  "10-danger": { html: phoneScene("Phone app · 8", "Danger now", ["Stop-work alert to officers, site head and HSE", "Must be acknowledged within the target", "Escalates if nobody does"]) },
  "11-offline": { html: phoneScene("Phone app · 9", "Outbox and offline", ["Pending, synced, failed, conflict", "Sync now · Retry failed · Fix and resend", "Export diagnostics · Clear synced"]) },
  "12-qr": { html: phoneScene("QR form", "No account needed", ["Scan the poster, choose a language", "Anonymous, or name and phone", "Private status link"]) },
  "13-inspect": { html: phoneScene("Phone app · 10", "Inspections", ["Pass / fail / N/A, numbers, choices, text, photos", "Fail: photo, note, corrective action", "Signature, score, pass mark"]) },
  "14-charts": { html: phoneScene("Phone app · 11", "Charts", ["Mine · Department · Site", "30, 90 or 365 days", "Excel report for officers"]) },
  "15-settings": { html: phoneScene("Phone app · 12", "Notifications and Settings", ["Alerts, reminders, closure notices", "Language, appearance, email digest", "Quiet hours, privacy notice"]) },
  "16-dashboard": { html: consoleScene("Console · 1", "Dashboard", "Eleven KPIs, trends and breakdowns · Export this view · Full report (Excel)") },
  "17-attention": { html: consoleScene("Console · 2", "Attention board", "Triage, alerts, overdue, missed inspections, repeat findings, health") },
  "18-registers": { html: consoleScene("Console · 3", "Registers", "Observations, Actions, Inspections · filters, saved filters, side panel, exports") },
  "19-cmdk": { html: consoleScene("Console · 4", "Command menu", "Ctrl+K / ⌘K: any page, or a case number") },
  "20-sites": { html: consoleScene("Console · 5", "Sites, areas, equipment, QR codes", "Site wizard by industry · rule set, matrix, calendar, geofence · rotate and print posters") },
  "21-people": { html: consoleScene("Console · 6", "People, contractors, departments", "Workers without a login · contractors and their sites · CSV import") },
  "22-users": { html: consoleScene("Console · 7", "Users and roles", "Login types · roles per site or company-wide · enrolment codes, resets, unlock, expiry") },
  "23-config": { html: consoleScene("Console · 8", "Categories, risk matrix, due dates, rule sets", "Extra fields and recipients · matrix versions · days per band and the reminder ladder") },
  "24-templates": { html: consoleScene("Console · 9", "Templates and schedules", "Checklist builder with phone preview · approval by a second person · recurring runs") },
  "25-languages-settings": { html: consoleScene("Console · 10", "Languages and Settings", "Translation completeness · every company default in one place") },
  "26-oversight": { html: consoleScene("Console · 11", "Oversight", "Audit log with Verify chain · notifications log · Health · Privacy · Retention") },
};
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [name, c] of Object.entries(CARDS)) { await p.setContent(`<!doctype html><html><head><style>${CSS}</style></head><body class="${c.dark ? "dark" : ""}">${c.html}</body></html>`); await p.waitForTimeout(120); await p.screenshot({ path: path.join(OUT, `${name}.png`) }); }
  await b.close(); fs.writeFileSync(path.join(OUT, "layout.json"), JSON.stringify({ PHONE, CONSOLE })); console.log(`${Object.keys(CARDS).length} layers`);
})();
