/* Screenshots of every screen of SafeWorks (phone app, QR form, console) from the running demo server, for the
   complete deck and reference guide. Usage: BASE=... DATABASE_URL=... DEMO_PW=... ADMIN_PW=... node screens-all.cjs <outdir> */
const { chromium } = require("playwright");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const BASE = process.env.BASE || "http://127.0.0.1:18090";
const DB = process.env.DATABASE_URL, PW = process.env.DEMO_PW, APW = process.env.ADMIN_PW;
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const PY = "/srv/swvenv/bin/python";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q, p = []) => { const r = spawnSync(PY, ["-I", "/home/user/safeworks-india/portal/e2e/sqlq.py", DB, q, JSON.stringify(p)], { encoding: "utf8" }); if (r.status) throw new Error(r.stderr); return JSON.parse(r.stdout.trim() || "[]"); };
const sql1 = (q, p) => { const r = sql(q, p); return r.length ? Object.values(r[0])[0] : null; };
const done = [], failed = [];
async function shot(page, name, fn) {
  try { if (fn) await fn(); await page.waitForLoadState("networkidle").catch(() => {}); await sleep(600); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); done.push(name); }
  catch (e) { failed.push(`${name}: ${String(e.message).split("\n")[0].slice(0, 120)}`); }
}
async function phoneCtx(browser, login) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-IN", timezoneId: "Asia/Kolkata", geolocation: { latitude: 13.0827, longitude: 80.2707 }, permissions: ["geolocation"], colorScheme: "light" });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  if (login) { await page.goto(`${BASE}/`); await page.locator('input[autocomplete="username"]').fill(login); await page.locator('input[type="password"]').fill(PW); await page.locator('button[type="submit"]').click(); await page.locator('[data-testid="home-report"]').waitFor({ timeout: 30000 }); await sleep(1200); }
  return page;
}
async function api(token, method, p, body) { const headers = { "Content-Type": "application/json" }; if (token) headers.Authorization = `Bearer ${token}`; const r = await fetch(`${BASE}/api/v1${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); return r.json(); }
function base32(s) { const al = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += al.indexOf(ch).toString(2).padStart(5, "0"); const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(o); }
function totp(secret) { const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = crypto.createHmac("sha1", base32(secret)).update(m).digest(); const o = h[h.length - 1] & 0xf; return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, "0"); }

(async () => {
  const browser = await chromium.launch();
  const ids = {
    closedObs: sql1("select id::text from observations where status = 'closed' and case_no like 'TN1-%' order by closed_at desc nulls last limit 1"),
    submittedObs: sql1("select o.id::text from observations o join sites s on s.id = o.site_id where s.code = 'TN1' and o.status = 'submitted' and o.imminent_danger = false order by o.received_at desc limit 1"),
    openAction: sql1("select a.id::text from actions a join users u on u.id = a.owner_user_id where u.employee_code = 'OWN-TN1-1' and a.status in ('open', 'in_progress') order by a.created_at desc limit 1"),
    anyAction: sql1("select a.id::text from actions a join users u on u.id = a.owner_user_id where u.employee_code = 'OWN-TN1-1' order by a.created_at desc limit 1"),
    run: sql1("select r.id::text from inspection_runs r join sites s on s.id = r.site_id where s.code = 'TN1' and r.status = 'in_progress' order by r.started_at desc nulls last limit 1"),
    site: sql1("select id::text from sites where code = 'TN1'"),
    template: sql1("select t.id::text from inspection_templates t where t.code = 'T1' limit 1"),
    qr: sql1("select q.token from qr_codes q join areas a on a.id = q.target_id where q.target_type = 'area' and q.active and a.site_id = (select id from sites where code = 'TN1') order by q.created_at limit 1"),
  };

  /* ---- phone: worker */
  const W = await phoneCtx(browser, null);
  await shot(W, "phone-signin", async () => { await W.goto(`${BASE}/`); await W.locator('input[autocomplete="username"]').waitFor(); });
  await shot(W, "phone-enrol", async () => { await W.getByRole("button", { name: /enrolment code/i }).click(); await sleep(300); });
  await W.goto(`${BASE}/`); await W.locator('input[autocomplete="username"]').fill("WORKER-TN1-1"); await W.locator('input[type="password"]').fill(PW); await W.locator('button[type="submit"]').click(); await W.locator('[data-testid="home-report"]').waitFor({ timeout: 30000 }); await sleep(1500);
  await shot(W, "phone-home-worker");
  await shot(W, "phone-report-top", async () => { await W.goto(`${BASE}/report`); await W.locator('[data-testid="type-unsafe_condition"]').waitFor(); await W.locator('[data-testid="type-unsafe_condition"]').click(); await sleep(400); });
  await shot(W, "phone-report-options", async () => { await W.locator('[data-testid="submit"]').scrollIntoViewIfNeeded(); await sleep(300); });
  await shot(W, "phone-report-more", async () => { await W.locator('[data-testid="more-details"]').click(); await sleep(300); await W.locator('[data-testid="more-details"]').scrollIntoViewIfNeeded(); });
  await shot(W, "phone-reports-mine", async () => { await W.goto(`${BASE}/reports`); await W.locator('[data-testid="reports-list"]').waitFor(); });
  await shot(W, "phone-report-detail", async () => { await W.goto(`${BASE}/o/${ids.closedObs}`); await W.locator(".page").getByText("Closed", { exact: true }).first().waitFor(); });
  await shot(W, "phone-charts-mine", async () => { await W.goto(`${BASE}/insights`); await W.locator('[data-testid="insights-kpis"]').waitFor(); });
  await shot(W, "phone-outbox", async () => { await W.goto(`${BASE}/outbox`); await sleep(500); });
  await shot(W, "phone-more", async () => { await W.goto(`${BASE}/more`); await sleep(400); });
  await shot(W, "phone-settings", async () => { await W.goto(`${BASE}/settings`); await W.getByRole("button", { name: "English", exact: true }).waitFor(); });
  await shot(W, "phone-settings-bottom", async () => { await W.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sleep(300); });
  await shot(W, "phone-scan", async () => { await W.goto(`${BASE}/scan`); await sleep(1200); });
  await shot(W, "phone-notifications-worker", async () => { await W.goto(`${BASE}/notifications`); await sleep(600); });

  /* ---- phone: officer */
  const S = await phoneCtx(browser, "SO-TN1");
  await shot(S, "phone-home-officer");
  await shot(S, "phone-reports-triage", async () => { await S.goto(`${BASE}/reports?tab=triage`); await S.locator('[data-testid="reports-list"]').waitFor(); });
  await shot(S, "phone-reports-site", async () => { await S.goto(`${BASE}/reports?tab=site`); await S.locator('[data-testid="reports-list"]').waitFor(); });
  await shot(S, "phone-triage-decisions", async () => { await S.goto(`${BASE}/o/${ids.submittedObs}`); await S.locator('[data-testid="triage-open"]').click(); await S.locator('[data-testid="decision-accept_assign"]').waitFor(); });
  await shot(S, "phone-triage-matrix", async () => { await S.locator('[data-testid="decision-accept_assign"]').click(); await S.locator('[role="gridcell"]').first().waitFor(); await S.locator('[role="gridcell"][aria-label$="= 12"]').click(); await sleep(400); });
  await shot(S, "phone-actions-verify-tab", async () => { await S.goto(`${BASE}/actions?tab=verify`); await S.locator('[data-testid="actions-list"]').waitFor(); });
  await shot(S, "phone-inspections", async () => { await S.goto(`${BASE}/inspections`); await S.locator('[data-testid="start-inspection"]').waitFor(); });
  await shot(S, "phone-inspection-start", async () => { await S.locator('[data-testid="start-inspection"]').click(); await S.locator('[data-testid="tpl-T1"]').waitFor(); });
  await shot(S, "phone-inspection-run", async () => { await S.keyboard.press("Escape"); await S.goto(`${BASE}/inspections/runs/${ids.run}`); await sleep(800); const n = S.locator('[data-testid="header-next"]'); if (await n.count()) { await n.click(); await sleep(400); } });
  await shot(S, "phone-charts-site", async () => { await S.goto(`${BASE}/insights`); await S.locator('[data-testid="insights-kpis"]').waitFor(); const tab = S.getByRole("tab", { name: /Site/ }); if (await tab.count()) await tab.click(); await sleep(800); });
  await shot(S, "phone-notifications-officer", async () => { await S.goto(`${BASE}/notifications`); await S.locator(".notif").first().waitFor(); });

  /* ---- phone: owner */
  const O = await phoneCtx(browser, "OWN-TN1-1");
  await shot(O, "phone-actions-mine", async () => { await O.goto(`${BASE}/actions`); await O.locator('[data-testid="actions-list"]').waitFor(); });
  await shot(O, "phone-actions-department", async () => { await O.goto(`${BASE}/actions?tab=department`); await sleep(800); });
  await shot(O, "phone-action-detail", async () => { await O.goto(`${BASE}/a/${ids.openAction || ids.anyAction}`); await O.locator(".page").first().waitFor(); await sleep(600); });
  await shot(O, "phone-action-complete-sheet", async () => { await O.locator('[data-testid="complete-open"]').click(); await O.locator(".sheet textarea").first().waitFor(); });
  await shot(O, "phone-action-request-date", async () => { await O.keyboard.press("Escape"); await sleep(300); await O.getByRole("button", { name: /Request new date/ }).click(); await O.locator(".sheet").waitFor(); });
  await shot(O, "phone-action-dispute", async () => { await O.keyboard.press("Escape"); await sleep(300); await O.getByRole("button", { name: /^Dispute$/ }).click(); await O.locator(".sheet").waitFor(); });

  /* ---- QR form */
  const Q = await phoneCtx(browser, null);
  await shot(Q, "qr-languages", async () => { await Q.goto(`${BASE}/q/${ids.qr}`); await Q.locator(".lang-grid button, .type-btn").first().waitFor(); });
  await shot(Q, "qr-form", async () => { const en = Q.getByRole("button", { name: /English/ }); if (await en.count()) await en.click(); await Q.locator(".type-btn").first().waitFor(); await Q.locator(".type-btn").nth(2).click(); await sleep(300); });
  await shot(Q, "qr-form-bottom", async () => { await Q.locator('[data-testid="submit"]').scrollIntoViewIfNeeded(); await sleep(300); });

  /* ---- console */
  sql("update users set mfa_enabled = false, mfa_secret_enc = '' where employee_code = 'ADMIN01'");
  const r = await api(null, "POST", "/auth/login", { login: "ADMIN01", password: APW, kind: "admin", deviceUuid: "shots-admin", platform: "shots", appVersion: "2.0.0" });
  let tok = r.token; if (r.mfaRequired) { const s = (await api(tok, "POST", "/auth/mfa/enrol")).secret; tok = (await api(tok, "POST", "/auth/mfa/confirm", { code: totp(s) })).token; }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: "en-IN", timezoneId: "Asia/Kolkata", colorScheme: "light" });
  const A = await ctx.newPage(); A.setDefaultTimeout(15000);
  await A.goto(`${BASE}/admin/`); await A.evaluate((t) => localStorage.setItem("sw.admin.token", t), tok);
  const go = async (p) => { await A.goto(`${BASE}/admin/${p}`); await A.locator("nav").first().waitFor({ timeout: 30000 }); await A.waitForLoadState("networkidle").catch(() => {}); await sleep(500); };
  for (const [name, p] of [["dashboard", ""], ["attention", "attention"], ["observations", "observations"], ["actions", "actions"], ["inspections", "inspections"], ["sites", "sites"], ["equipment", "equipment"], ["qr", "qr"], ["people", "people"], ["departments", "departments"], ["users", "users"], ["categories", "categories"], ["risk-matrix", "risk-matrix"], ["due-dates", "due-dates"], ["rule-sets", "rule-sets"], ["templates", "templates"], ["schedules", "schedules"], ["languages", "languages"], ["settings", "settings"], ["audit-log", "audit-log"], ["notifications-log", "notifications-log"], ["privacy", "privacy"], ["retention", "retention"], ["health", "health"]]) {
    await shot(A, `console-${name}`, () => go(p));
  }
  await shot(A, "console-observations-drawer", async () => { await go("observations"); await A.locator("tbody tr").first().click(); await A.locator(".drawer").waitFor(); });
  await shot(A, "console-site-detail", async () => { await go(`sites/${ids.site}`); });
  await shot(A, "console-site-areas", async () => { await go(`sites/${ids.site}/areas`); });
  await shot(A, "console-site-wizard", async () => { await go("sites/new"); });
  await shot(A, "console-contractors", async () => { await go("people"); const t = A.getByRole("tab", { name: /Contractors/ }); if (await t.count()) await t.click(); else await A.getByText("Contractors", { exact: true }).first().click(); await sleep(600); });
  await shot(A, "console-user-new", async () => { await go("users"); await A.getByRole("button", { name: /Add user|New user/ }).first().click(); await A.locator(".sheet, .drawer").first().waitFor(); });
  await shot(A, "console-template-builder", async () => { await go(`templates/${ids.template}`); await A.locator(".builder").waitFor(); });
  await shot(A, "console-settings-bottom", async () => { await go("settings"); await A.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sleep(400); });
  await shot(A, "console-command-menu", async () => { await go(""); await A.locator('[data-testid="command-open"]').click(); await A.locator('[data-testid="command-menu"]').waitFor(); });
  await shot(A, "console-account", async () => { await A.keyboard.press("Escape"); await sleep(300); await A.locator("header .who").click(); await A.locator('[data-testid="account-language"]').waitFor(); });
  await shot(A, "console-dashboard-dark", async () => { await A.keyboard.press("Escape"); await A.emulateMedia({ colorScheme: "dark" }); await go(""); });
  await browser.close();
  fs.writeFileSync(path.join(OUT, "shots.json"), JSON.stringify({ done, failed }, null, 1));
  console.log(`${done.length} screenshots; ${failed.length} failed${failed.length ? ":\n  " + failed.join("\n  ") : ""}`);
})().catch((e) => { console.error(e); process.exit(1); });
