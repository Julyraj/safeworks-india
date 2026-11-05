/* Renders the video's static layers at 1920x1080 with Playwright: title cards, and per-scene frames (background,
   phone bezel or monitor frame, and captions) that ffmpeg overlays the screen recording onto. */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });

const CSS = `
  * { box-sizing: border-box; margin: 0; }
  body { width: 1920px; height: 1080px; overflow: hidden; font-family: "Inter", system-ui, sans-serif; color: #0b1220; background: #f5f6f8; -webkit-font-smoothing: antialiased; }
  .dark { background: #0f172a; color: #fff; }
  .mark { display: inline-grid; place-items: center; width: 72px; height: 72px; border-radius: 18px; background: #f5c400; color: #0b1220; font-weight: 800; font-size: 30px; letter-spacing: -0.02em; }
  .brand { position: absolute; left: 72px; top: 56px; display: flex; align-items: center; gap: 18px; font-weight: 700; font-size: 30px; }
  .brand.small .mark { width: 48px; height: 48px; border-radius: 12px; font-size: 20px; } .brand.small { font-size: 22px; left: auto; right: 72px; top: 44px; }
  h1 { font-weight: 750; letter-spacing: -0.03em; line-height: 1.05; }
  .sub { color: #5b6676; font-size: 30px; line-height: 1.4; }
  .dark .sub { color: #cbd5e1; }
  .bezel { position: absolute; background: #0f172a; border-radius: 48px; box-shadow: 0 30px 80px -20px rgba(16,24,40,.35); }
  .monitor { position: absolute; background: #0f172a; border-radius: 22px; box-shadow: 0 30px 80px -20px rgba(16,24,40,.35); }
  .cap { position: absolute; }
  .cap .kicker { display: inline-block; background: #fff8d6; color: #7a5900; font-weight: 650; font-size: 22px; padding: 8px 16px; border-radius: 10px; margin-bottom: 22px; letter-spacing: 0.02em; }
  .cap h2 { font-size: 54px; font-weight: 750; letter-spacing: -0.03em; line-height: 1.08; margin-bottom: 22px; }
  .cap p { font-size: 28px; line-height: 1.45; color: #334155; }
  .cap ul { list-style: none; margin-top: 26px; display: grid; gap: 14px; }
  .cap li { font-size: 26px; color: #334155; display: flex; gap: 14px; align-items: flex-start; }
  .cap li::before { content: ""; width: 12px; height: 12px; border-radius: 50%; background: #f5c400; flex: none; margin-top: 12px; }
  .chips { display: flex; gap: 18px; margin-top: 44px; flex-wrap: wrap; }
  .chip { background: #1e293b; color: #fff; border: 1px solid #334155; padding: 16px 26px; border-radius: 999px; font-size: 26px; font-weight: 600; }
  .chip b { color: #f5c400; margin-right: 10px; }
  .foot { position: absolute; left: 72px; bottom: 48px; color: #94a3b8; font-size: 22px; }
`;

const PHONE = { x: 180, y: 60, w: 444, h: 960, pad: 16 };   // where the 780x1688 recording lands (scaled to 444x960)
const CONSOLE = { x: 120, y: 60, w: 1680, h: 945, pad: 14 };  // where the 1600x900 recording lands

function phoneScene(kicker, title, lines) {
  return `<div class="brand small"><span class="mark">SW</span>SafeWorks</div>
  <div class="bezel" style="left:${PHONE.x - PHONE.pad}px;top:${PHONE.y - PHONE.pad}px;width:${PHONE.w + 2 * PHONE.pad}px;height:${PHONE.h + 2 * PHONE.pad}px"></div>
  <div class="cap" style="left:760px;top:250px;width:1040px"><span class="kicker">${kicker}</span><h2>${title}</h2>${lines.length ? "<ul>" + lines.map((l) => `<li>${l}</li>`).join("") + "</ul>" : ""}</div>`;
}
function consoleScene(kicker, title, text) {
  return `<div class="monitor" style="left:${CONSOLE.x - CONSOLE.pad}px;top:${CONSOLE.y - CONSOLE.pad}px;width:${CONSOLE.w + 2 * CONSOLE.pad}px;height:${CONSOLE.h + 2 * CONSOLE.pad}px"></div>
  <div class="cap" style="left:120px;top:1020px;width:1680px;display:flex;gap:28px;align-items:center"><span class="kicker" style="margin:0">${kicker}</span><span style="font-size:30px;font-weight:700">${title}</span><span style="font-size:26px;color:#5b6676">${text}</span></div>`;
}

const CARDS = {
  "01-hook": { dark: true, html: `<div class="brand"><span class="mark">SW</span></div>
    <div style="position:absolute;left:72px;top:330px;width:1500px"><h1 style="font-size:96px">Someone on your site<br>just spotted a hazard.</h1>
    <p class="sub" style="margin-top:40px;font-size:40px">What happens next decides whether it gets fixed, <span style="color:#f5c400;font-weight:700">or forgotten.</span></p></div>` },
  "02-intro": { dark: true, html: `<div style="position:absolute;left:72px;top:170px;width:1700px">
    <div style="display:flex;align-items:center;gap:28px"><span class="mark" style="width:120px;height:120px;border-radius:30px;font-size:52px">SW</span><span style="font-size:88px;font-weight:800;letter-spacing:-0.03em">SafeWorks</span></div>
    <h1 style="font-size:60px;margin-top:70px;max-width:1500px">One connected system that turns what your people notice into fixes you can prove.</h1>
    <p class="sub" style="margin-top:44px;font-size:32px">In the next three minutes:</p>
    <div class="chips"><span class="chip"><b>1</b>Report a hazard in 30 seconds</span><span class="chip"><b>2</b>Triage and assign the fix</span><span class="chip"><b>3</b>Track and prove it, start to finish</span></div></div>
    <div class="foot">Product walkthrough · Portal 2.1</div>` },
  "13-recap": { dark: true, html: `<div class="brand"><span class="mark">SW</span>SafeWorks</div>
    <div style="position:absolute;left:72px;top:260px;width:1780px"><h1 style="font-size:72px">That's SafeWorks.</h1>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:36px;margin-top:70px">
      ${[["Reports in seconds", "Four types, photos, voice, offline, four languages"], ["Fixes owned and verified", "Risk-scored, one owner, after-photo, independent check"], ["Measured every day", "Live KPIs, attention board, one-click Excel report"]].map(([h, t]) => `<div style="background:#1e293b;border:1px solid #334155;border-radius:28px;padding:40px"><div style="width:16px;height:16px;border-radius:50%;background:#f5c400;margin-bottom:26px"></div><div style="font-size:40px;font-weight:750;letter-spacing:-0.02em;margin-bottom:16px">${h}</div><div style="font-size:27px;color:#cbd5e1;line-height:1.4">${t}</div></div>`).join("")}
    </div></div>` },
  "15-end": { dark: true, html: `<div style="position:absolute;left:72px;top:250px;width:1780px;text-align:center">
    <span class="mark" style="width:140px;height:140px;border-radius:34px;font-size:60px">SW</span>
    <h1 style="font-size:84px;margin-top:50px">Start with your pilot site today</h1>
    <p class="sub" style="margin-top:36px;font-size:36px">Choose the site · scan your first poster · make your first report</p>
    <div style="display:inline-block;margin-top:70px;background:#f5c400;color:#0b1220;font-weight:750;font-size:36px;padding:26px 54px;border-radius:22px">Report a hazard or good practice</div></div>
    <div class="foot" style="left:0;right:0;text-align:center">Welcome to SafeWorks</div>` },
  // scene layers
  "03-signin": { html: phoneScene("Step 1", "Sign in, in your language", ["English, Hindi, Tamil or Kannada", "Employee code or email", "Home: sync status, Report button, what needs you now"]) },
  "04-report": { html: phoneScene("Step 2", "Report in about 30 seconds", ["Location already filled in", "Type, category, photo, description", "Case number straight away"]) },
  "05-triage": { html: phoneScene("Step 3", "Triage and assign", ["Likelihood × severity on your risk matrix", "Band sets the due date", "One owner per action"]) },
  "06-close": { html: phoneScene("Steps 4 to 6", "Complete, verify, close", ["Complete needs an after-photo and the cause", "A different person verifies", "The reporter sees Closed"]) },
  "07-danger": { html: phoneScene("Danger now", "Immediate danger, immediate alert", ["Officers, site head and HSE alerted at once", "Must be acknowledged", "Escalates if nobody does"]) },
  "08-offline": { html: phoneScene("Offline", "No signal? Keeps working", ["Saved to the outbox on the phone", "Sends itself when signal returns", "Nothing is lost"]) },
  "09-qr": { html: phoneScene("QR form", "No account needed", ["Scan the poster at the area", "Four languages", "Anonymous if they wish"]) },
  "10-inspect": { html: phoneScene("Inspections", "Checklists with proof", ["Pass, fail or N/A, with photos", "Sign on the phone", "A failed item raises an action"]) },
  "14-language": { html: phoneScene("Settings", "Your language, everywhere", ["Choose it in Settings", "Follows you to the console and emails", "English is the default"]) },
  "11-console": { html: consoleScene("Admin console", "Dashboard and attention board", "Live KPIs by site, date and department") },
  "12-cmdk": { html: consoleScene("Admin console", "Command menu and Excel report", "Ctrl+K to find any case · Full report in one click") },
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [name, c] of Object.entries(CARDS)) {
    await p.setContent(`<!doctype html><html><head><style>${CSS}</style></head><body class="${c.dark ? "dark" : ""}">${c.html}</body></html>`);
    await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(OUT, `${name}.png`) });
  }
  await b.close();
  fs.writeFileSync(path.join(OUT, "layout.json"), JSON.stringify({ PHONE, CONSOLE }));
  console.log(`${Object.keys(CARDS).length} layers in ${OUT}`);
})();
