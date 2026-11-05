/* Records the complete-walkthrough scenes (24 app scenes) from the running SafeWorks app as timestamped frames with a
   visible cursor. Usage: SCENES=a,b DATABASE_URL=.. DEMO_PW=.. ADMIN_PW=.. node record2.cjs <frames dir> */
const { chromium } = require("playwright");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const BASE = process.env.BASE || "http://127.0.0.1:18090";
const DB = process.env.DATABASE_URL, PW = process.env.DEMO_PW, APW = process.env.ADMIN_PW;
const OUT = process.argv[2];
const PY = "/srv/swvenv/bin/python";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q, p = []) => { const r = spawnSync(PY, ["-I", "/home/user/safeworks-india/portal/e2e/sqlq.py", DB, q, JSON.stringify(p)], { encoding: "utf8" }); if (r.status) throw new Error(r.stderr); return JSON.parse(r.stdout.trim() || "[]"); };
const sql1 = (q, p) => { const r = sql(q, p); return r.length ? Object.values(r[0])[0] : null; };
const ONLY = (process.env.SCENES || "").split(",").filter(Boolean);
const report = { scenes: {}, errors: {} };
const CURSOR = `(() => { function mk(){ if (document.getElementById('__cur') || !document.body) return; const d = document.createElement('div'); d.id = '__cur'; d.style.cssText = 'position:fixed;left:-50px;top:-50px;width:34px;height:34px;border-radius:50%;background:rgba(15,23,42,.45);border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.4);pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);transition:left .38s cubic-bezier(.2,.7,.2,1),top .38s cubic-bezier(.2,.7,.2,1),transform .15s,background .15s;opacity:0'; document.body.appendChild(d); }
  if (document.body) mk(); else document.addEventListener('DOMContentLoaded', mk);
  window.__curMove = (x, y) => { mk(); const d = document.getElementById('__cur'); if (!d) return; d.style.opacity = '1'; d.style.left = x + 'px'; d.style.top = y + 'px'; };
  window.__curTap = () => { const d = document.getElementById('__cur'); if (!d) return; d.style.transform = 'translate(-50%,-50%) scale(.55)'; d.style.background = 'rgba(245,196,0,.95)'; setTimeout(() => { d.style.transform = 'translate(-50%,-50%)'; d.style.background = 'rgba(15,23,42,.45)'; }, 220); }; })();`;
class Rec {
  constructor(name) { this.name = name; this.dir = path.join(OUT, name); fs.mkdirSync(this.dir, { recursive: true }); this.frames = []; this.on = false; }
  start(page) { this.page = page; this.t0 = Date.now(); this.on = true; this.done = this.loop(); }
  async loop() { while (this.on) { const t = Date.now() - this.t0, f = path.join(this.dir, `f${String(this.frames.length).padStart(5, "0")}.jpg`); try { await this.page.screenshot({ path: f, type: "jpeg", quality: 86, timeout: 3000 }); this.frames.push({ f, t }); } catch { } await sleep(30); } }
  async stop(tail = 0.6) { this.on = false; await this.done; const lines = []; for (let i = 0; i < this.frames.length; i++) { const d = i + 1 < this.frames.length ? (this.frames[i + 1].t - this.frames[i].t) / 1000 : tail; lines.push(`file '${path.basename(this.frames[i].f)}'`, `duration ${Math.max(0.02, d).toFixed(3)}`); } if (this.frames.length) lines.push(`file '${path.basename(this.frames[this.frames.length - 1].f)}'`); fs.writeFileSync(path.join(this.dir, "list.txt"), lines.join("\n") + "\n"); const total = this.frames.length ? this.frames[this.frames.length - 1].t / 1000 + tail : 0; fs.writeFileSync(path.join(this.dir, "meta.json"), JSON.stringify({ frames: this.frames.length, duration: total })); report.scenes[this.name] = { frames: this.frames.length, duration: +total.toFixed(1) }; console.log(`  ${this.name}: ${this.frames.length} frames, ${total.toFixed(1)} s`); }
}
async function move(page, loc, hold = 380) { const l = loc.first(); await l.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {}); const b = await l.boundingBox({ timeout: 3000 }); if (b) { await page.evaluate(([x, y]) => window.__curMove && window.__curMove(x, y), [b.x + b.width / 2, b.y + b.height / 2]); await sleep(hold); } }
async function tap(page, loc, hold = 380, after = 300) { await move(page, loc, hold); await page.evaluate(() => window.__curTap && window.__curTap()); await loc.first().click({ timeout: 8000 }); await sleep(after); }
async function type(page, loc, text, hold = 350) { await tap(page, loc, hold, 120); await loc.first().pressSequentially(text, { delay: 26 }); await sleep(250); }
async function choose(page, loc, value, hold = 380) { await move(page, loc, hold); await page.evaluate(() => window.__curTap && window.__curTap()); await loc.first().selectOption(value); await sleep(400); }
async function until(fn, what, timeout = 20000) { const t0 = Date.now(); let last; while (Date.now() - t0 < timeout) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(250); } throw new Error(`timed out: ${what}${last instanceof Error ? ": " + last.message : ""}`); }
const opt = async (fn) => { try { await fn(); } catch (e) { console.log(`    (optional step skipped: ${String(e.message || e).split("\n")[0].slice(0, 90)})`); } };
async function photo(page, label, scope) {
  const b64 = await page.evaluate((txt) => { const c = document.createElement("canvas"); c.width = 1280; c.height = 960; const g = c.getContext("2d"); const sky = g.createLinearGradient(0, 0, 0, 960); sky.addColorStop(0, "#b9c7d6"); sky.addColorStop(1, "#6b7a8a"); g.fillStyle = sky; g.fillRect(0, 0, 1280, 960); g.fillStyle = "#8d8f92"; g.fillRect(0, 560, 1280, 400); g.fillStyle = "#6f7174"; g.fillRect(0, 540, 1280, 24); for (let i = 0; i < 14; i++) { g.fillStyle = i % 2 ? "#f5c400" : "#0f172a"; g.fillRect(80 + i * 80, 500, 80, 40); } g.fillStyle = "rgba(15,23,42,.55)"; g.fillRect(0, 860, 1280, 100); g.fillStyle = "#fff"; g.font = "bold 44px sans-serif"; g.fillText(txt, 40, 925); return c.toDataURL("image/jpeg", 0.86).split(",")[1]; }, label);
  const input = page.locator(`${scope || ""} [data-testid="photo-input"]`).last(); const add = page.locator(`${scope || ""} .photo-strip .add`).first();
  if (await add.count()) await move(page, add, 350); await page.evaluate(() => window.__curTap && window.__curTap());
  await input.setInputFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.from(b64, "base64") }); await until(async () => (await page.locator(`${scope || ""} .thumb img`).count()) > 0, "thumbnail"); await sleep(500);
}
async function ensureCat(page) { const chips = page.locator('[data-testid^="cat-"]'); await chips.first().waitFor(); if (!(await page.locator('[data-testid^="cat-"][aria-pressed="true"]').count())) await tap(page, chips.first()); else await move(page, page.locator('[data-testid^="cat-"][aria-pressed="true"]').first(), 250); }
let browser;
async function phoneCtx(login) { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-IN", timezoneId: "Asia/Kolkata", geolocation: { latitude: 13.0827, longitude: 80.2707 }, permissions: ["geolocation"], colorScheme: "light" }); await ctx.addInitScript(CURSOR); const page = await ctx.newPage(); page.setDefaultTimeout(20000); if (login) { await page.goto(`${BASE}/`); await page.waitForLoadState("networkidle"); await page.locator('input[autocomplete="username"]').fill(login); await page.locator('input[type="password"]').fill(PW); await page.locator('button[type="submit"]').click(); await page.locator('[data-testid="home-report"]').waitFor({ timeout: 30000 }); await sleep(1500); } return { ctx, page }; }
async function api(token, method, p, body) { const headers = { "Content-Type": "application/json" }; if (token) headers.Authorization = `Bearer ${token}`; const r = await fetch(`${BASE}/api/v1${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); return r.json(); }
function base32(s) { const al = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += al.indexOf(ch).toString(2).padStart(5, "0"); const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(o); }
function totp(secret) { const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = crypto.createHmac("sha1", base32(secret)).update(m).digest(); const o = h[h.length - 1] & 0xf; return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, "0"); }
async function consoleCtx() { sql("update users set mfa_enabled = false, mfa_secret_enc = '' where employee_code = 'ADMIN01'"); const r = await api(null, "POST", "/auth/login", { login: "ADMIN01", password: APW, kind: "admin", deviceUuid: "vid2-admin", platform: "video", appVersion: "2.0.0" }); let tok = r.token; if (r.mfaRequired) { const s = (await api(tok, "POST", "/auth/mfa/enrol")).secret; tok = (await api(tok, "POST", "/auth/mfa/confirm", { code: totp(s) })).token; } const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "en-IN", timezoneId: "Asia/Kolkata", colorScheme: "light", acceptDownloads: true }); await ctx.addInitScript(CURSOR); const page = await ctx.newPage(); page.setDefaultTimeout(20000); await page.goto(`${BASE}/admin/`); await page.evaluate((t) => localStorage.setItem("sw.admin.token", t), tok); await page.goto(`${BASE}/admin/`); await page.locator("nav").first().waitFor({ timeout: 30000 }); await page.waitForLoadState("networkidle"); return { ctx, page }; }
async function scene(name, fn) { if (ONLY.length && !ONLY.includes(name)) return; const rec = new Rec(name); try { await fn(rec); } catch (e) { report.errors[name] = String(e.message || e).split("\n")[0].slice(0, 200); console.log(`  ${name}: ERROR ${report.errors[name]}`); } if (rec.on || rec.frames.length) await rec.stop(); }
const go = async (A, p) => { await A.page.goto(`${BASE}/admin/${p}`); await A.page.locator("nav").first().waitFor(); await A.page.waitForLoadState("networkidle").catch(() => {}); };
const navTo = async (A, label) => { if (await A.page.locator(".drawer, .sheet, .modal, [role=\"dialog\"]").count()) { await A.page.keyboard.press("Escape"); await sleep(350); } await tap(A.page, A.page.locator("nav a", { hasText: label }), 420, 500); await A.page.waitForLoadState("networkidle").catch(() => {}); };

(async () => {
  browser = await chromium.launch(); fs.mkdirSync(OUT, { recursive: true });
  const ownerId = sql1("select id::text from users where employee_code = 'OWN-TN1-1'");
  let obsId = null, actId = null, caseNo = null;
  const W = await phoneCtx(null);
  await scene("03-signin", async (rec) => {
    await W.page.goto(`${BASE}/`); await W.page.locator('input[autocomplete="username"]').waitFor(); await W.page.waitForLoadState("networkidle"); rec.start(W.page); await sleep(900);
    await tap(W.page, W.page.getByRole("button", { name: "தமிழ் · Tamil", exact: true }), 450, 900); await tap(W.page, W.page.getByRole("button", { name: "English", exact: true }), 350, 400);
    await move(W.page, W.page.getByRole("button", { name: /enrolment code/i }), 500);
    await type(W.page, W.page.locator('input[autocomplete="username"]'), "WORKER-TN1-1"); await type(W.page, W.page.locator('input[type="password"]'), PW);
    await tap(W.page, W.page.locator('button[type="submit"]'), 350, 200); await W.page.locator('[data-testid="home-report"]').waitFor({ timeout: 30000 }); await sleep(2200);
  });
  const S = await phoneCtx("SO-TN1");
  await scene("04-home", async (rec) => {
    await S.page.goto(`${BASE}/`); await S.page.locator('[data-testid="home-report"]').waitFor(); await S.page.waitForLoadState("networkidle"); rec.start(S.page); await sleep(1500);
    await move(S.page, S.page.locator('[data-testid="home-report"]'), 700);
    for (let i = 0; i < 3; i++) { await S.page.mouse.wheel(0, 330); await sleep(900); }
    await sleep(800); for (let i = 0; i < 3; i++) { await S.page.mouse.wheel(0, -330); await sleep(500); } await sleep(1000);
  });
  await scene("05-report", async (rec) => {
    rec.start(W.page); await sleep(400); await tap(W.page, W.page.locator('[data-testid="home-report"]'), 450, 400); await W.page.locator('[data-testid="type-unsafe_condition"]').waitFor(); await sleep(500);
    await move(W.page, W.page.locator('[data-testid="loc-chip"]'), 700);
    await tap(W.page, W.page.locator('[data-testid="type-unsafe_condition"]'), 400, 400); await ensureCat(W.page); await photo(W.page, "OPEN EDGE, LEVEL 3");
    await type(W.page, W.page.locator('[data-testid="description"]'), "Open edge on level 3 near the lift shaft, no guard rail");
    for (const name of [/Fixed on the spot/, /Danger now/, /Report anonymously/]) await opt(async () => { await move(W.page, W.page.locator(".toggle", { hasText: name }).locator('[role="switch"]'), 650); });
    await opt(async () => { await tap(W.page, W.page.locator('[data-testid="more-details"]'), 400, 700); await move(W.page, W.page.locator(".page select").first(), 600); });
    await tap(W.page, W.page.locator('[data-testid="submit"]'), 450, 300); await W.page.locator('[data-testid="submitted"]').waitFor(); await sleep(2200);
    obsId = await until(() => sql1("select id::text from observations where description like 'Open edge on level 3%' and status = 'submitted' order by received_at desc limit 1"), "report row", 20000); caseNo = sql1("select case_no from observations where id = $1::uuid", [obsId]);
  });
  if (!obsId) { obsId = sql1("select id::text from observations where description like 'Open edge on level 3%' and status = 'submitted' order by received_at desc limit 1"); caseNo = sql1("select case_no from observations where id = $1::uuid", [obsId]); }
  await scene("06-reports", async (rec) => {
    await W.page.goto(`${BASE}/reports`); await W.page.locator('[data-testid="reports-list"]').waitFor(); await W.page.waitForLoadState("networkidle"); rec.start(W.page); await sleep(800);
    await opt(async () => { const sIn = W.page.locator(".search-row input, .list-head input").first(); await type(W.page, sIn, "edge", 300); await sleep(600); await sIn.fill(""); await sleep(300); });
    await tap(W.page, W.page.locator('[data-testid="reports-list"] a').first(), 450, 600); await W.page.locator(".page").first().waitFor(); await sleep(900); await W.page.mouse.wheel(0, 500); await sleep(900);
    await S.page.goto(`${BASE}/reports?tab=triage`); await S.page.locator('[data-testid="reports-list"]').waitFor(); rec.page = S.page; await sleep(1300);
    await opt(async () => { await tap(S.page, S.page.getByRole("tab", { name: /Site/ }), 400, 1000); });
  });
  await scene("07-triage", async (rec) => {
    await S.page.goto(`${BASE}/o/${obsId}`); await S.page.locator('[data-testid="triage-open"]').waitFor(); await S.page.waitForLoadState("networkidle"); rec.start(S.page); await sleep(700);
    await tap(S.page, S.page.locator('[data-testid="triage-open"]'), 400, 600);
    for (const d of ["decision-return_to_reporter", "decision-merge_duplicate", "decision-discard", "decision-escalate_incident"]) await opt(async () => { await move(S.page, S.page.locator(`[data-testid="${d}"]`), 420); });
    await tap(S.page, S.page.locator('[data-testid="decision-accept_assign"]'), 400, 500);
    await tap(S.page, S.page.locator('[role="gridcell"][aria-label$="= 12"]').first(), 450, 700);
    await opt(async () => { const si = S.page.locator(".sheet .sheet-body > div > .field, .sheet .sheet-body > .field", { hasText: "Interim control" }).locator("textarea"); if (await si.count()) await type(S.page, si.first(), "Edge barricaded, work at the edge stopped this shift", 300); });
    await choose(S.page, S.page.locator('select:has(option[value="B-2"])'), "B-2");
    const emp = S.page.locator(".sheet select").filter({ has: S.page.locator('option:has-text("Our company")') }).first(); if (await emp.count() && !(await emp.inputValue())) await choose(S.page, emp, { index: 1 });
    const draft = S.page.locator('[data-testid="action-draft"]').first(); const title = draft.locator("input").first(); await tap(S.page, title, 350, 120); await title.fill(""); await title.pressSequentially("Fit guard rail, mid-rail and toe board at the level 3 open edge", { delay: 24 }); await sleep(250);
    await choose(S.page, draft.locator("select").first(), ownerId);
    const anyInterim = S.page.locator(".sheet .field", { hasText: /Interim/ }).locator("input, textarea"); for (let i = 0; i < await anyInterim.count(); i++) if (!(await anyInterim.nth(i).inputValue())) await type(S.page, anyInterim.nth(i), "Edge barricaded with a hard barrier until the rail is fitted", 250);
    await tap(S.page, S.page.locator('[data-testid="triage-submit"]'), 450, 300); await S.page.locator(".toast.success").last().waitFor({ timeout: 15000 }); await sleep(1500);
    const stok = await S.page.evaluate(() => localStorage.getItem("sw.field.token")); actId = await until(async () => { const d = await api(stok, "GET", `/observations/${obsId}`); return d.actions && d.actions[0] && d.actions[0].id; }, "action on the report");
  });
  if (!actId && obsId) { const d = sql("select a.id::text as id from actions a where a.source_type = 'observation' and a.source_id = $1::uuid order by a.created_at limit 1", [obsId]); if (d.length) actId = d[0].id; }
  const O = await phoneCtx("OWN-TN1-1"); const V = await phoneCtx("VER-TN1");
  await scene("08-actions", async (rec) => {
    await O.page.goto(`${BASE}/actions`); await O.page.locator('[data-testid="actions-list"]').waitFor(); await O.page.waitForLoadState("networkidle"); rec.start(O.page); await sleep(900);
    const row = O.page.locator('[data-testid="actions-list"] a', { hasText: "guard rail" }); if (await row.count()) await tap(O.page, row, 450, 500); else await O.page.goto(`${BASE}/a/${actId}`);
    await O.page.locator('[data-testid="complete-open"]').waitFor(); await sleep(700);
    await opt(async () => { await tap(O.page, O.page.getByRole("button", { name: /Request new date/ }), 400, 1200); await O.page.keyboard.press("Escape"); await sleep(400); });
    await opt(async () => { await tap(O.page, O.page.getByRole("button", { name: /^Dispute$/ }), 400, 1200); await O.page.keyboard.press("Escape"); await sleep(400); });
    await opt(async () => { await tap(O.page, O.page.getByRole("button", { name: /^Start$/ }), 400, 800); });
    await tap(O.page, O.page.locator('[data-testid="complete-open"]'), 400, 500); await until(async () => (await O.page.locator(".sheet textarea").count()) === 2, "complete sheet");
    await type(O.page, O.page.locator(".sheet textarea").nth(0), "Guard rail, mid-rail and toe board fitted along the edge"); await type(O.page, O.page.locator(".sheet textarea").nth(1), "No edge-protection step in the pour sequence; method statement updated");
    await photo(O.page, "AFTER: GUARD RAIL FITTED", ".sheet"); await tap(O.page, O.page.locator('[data-testid="complete-submit"]'), 450, 300); await O.page.locator(".toast.success").last().waitFor({ timeout: 15000 }); await sleep(900);
    await O.page.goto(`${BASE}/actions?tab=department`); await sleep(1600);
  });
  await scene("09-verify", async (rec) => {
    await V.page.goto(`${BASE}/a/${actId}`); await V.page.locator('[data-testid="verify-open"]').waitFor(); await V.page.waitForLoadState("networkidle"); rec.start(V.page); await sleep(800);
    await tap(V.page, V.page.locator('[data-testid="verify-open"]'), 450, 500); await V.page.locator(".compare img").first().waitFor(); await sleep(1000);
    await move(V.page, V.page.locator('[data-testid="result-not-effective"]'), 500); await tap(V.page, V.page.locator('[data-testid="result-effective"]'), 400, 500); await tap(V.page, V.page.locator('[data-testid="verify-submit"]'), 400, 300); await V.page.locator(".toast.success").last().waitFor({ timeout: 15000 }); await sleep(600);
    await until(() => sql1("select status from observations where id = $1::uuid", [obsId]) === "closed", "closed", 30000);
    await W.page.goto(`${BASE}/reports`); await W.page.locator('[data-testid="reports-list"]').waitFor(); rec.page = W.page; await sleep(500); await move(W.page, W.page.locator('[data-testid="reports-list"] a', { hasText: "Open edge" }).first(), 1800);
  });
  const W2 = await phoneCtx("WORKER-TN1-2");
  await scene("10-danger", async (rec) => {
    await W2.page.goto(`${BASE}/report`); await W2.page.locator('[data-testid="type-near_miss"]').waitFor(); await W2.page.waitForLoadState("networkidle"); rec.start(W2.page); await sleep(500);
    await tap(W2.page, W2.page.locator('[data-testid="type-near_miss"]'), 400, 400); await ensureCat(W2.page); await type(W2.page, W2.page.locator('[data-testid="description"]'), "Crane load swung over the walkway with people below");
    await tap(W2.page, W2.page.locator(".toggle", { hasText: "Danger now" }).locator('[role="switch"]'), 500, 1000); await tap(W2.page, W2.page.locator('[data-testid="submit"]'), 450, 300); await W2.page.locator('[data-testid="submitted"]').waitFor(); await sleep(800);
    await S.page.goto(`${BASE}/notifications`); const stopRow = S.page.locator(".notif", { hasText: /STOP WORK/ }).first(); await stopRow.waitFor({ timeout: 30000 }); await S.page.waitForLoadState("networkidle"); rec.page = S.page; await sleep(900); await move(S.page, stopRow, 500); await tap(S.page, stopRow.locator("button").first(), 500, 300); await sleep(1600);
  });
  await scene("11-offline", async (rec) => {
    await W.ctx.setOffline(true); rec.start(W.page); await W.page.goto(`${BASE}/report`).catch(() => {}); await W.page.locator('[data-testid="type-unsafe_condition"]').waitFor(); await sleep(700);
    await tap(W.page, W.page.locator('[data-testid="type-unsafe_condition"]'), 350, 350); await ensureCat(W.page); await type(W.page, W.page.locator('[data-testid="description"]'), "Loose cable near the generator"); await tap(W.page, W.page.locator('[data-testid="submit"]'), 400, 300); await W.page.locator('[data-testid="submitted"]').waitFor(); await sleep(1200);
    await W.page.goto(`${BASE}/outbox`).catch(() => {}); await W.page.locator('[data-testid="outbox-list"]').waitFor(); await sleep(1200);
    for (const name of [/Sync now/, /Export diagnostics/, /Clear synced/]) await opt(async () => { await move(W.page, W.page.getByRole("button", { name }), 550); });
    await W.ctx.setOffline(false); await until(async () => (await W.page.locator('.ob-row[data-status="pending"], .ob-row[data-status="sending"]').count()) === 0 && (await W.page.locator('.ob-row[data-status="synced"]').count()) >= 1, "outbox synced", 40000); await sleep(1800);
  });
  const token = sql1("select q.token from qr_codes q join areas a on a.id = q.target_id where q.target_type = 'area' and q.active and a.site_id = (select id from sites where code = 'TN1') order by q.created_at limit 1");
  const Q = await phoneCtx(null);
  await scene("12-qr", async (rec) => {
    await Q.page.goto(`${BASE}/q/${token}`); await Q.page.locator(".lang-grid button, .type-btn").first().waitFor(); await Q.page.waitForLoadState("networkidle"); rec.start(Q.page); await sleep(800);
    const hi = Q.page.getByRole("button", { name: /हिन्दी/ }); if (await hi.count()) await tap(Q.page, hi, 450, 900); await Q.page.locator(".type-btn").first().waitFor();
    await tap(Q.page, Q.page.locator(".type-btn").nth(2), 400, 400); const chips = Q.page.locator(".cat-chips .chip, .cat-chips button"); await chips.first().waitFor(); await tap(Q.page, chips.first(), 350, 300); if (!(await Q.page.locator('.cat-chips [aria-pressed="true"]').count())) await tap(Q.page, chips.nth(1), 300, 300);
    await type(Q.page, Q.page.locator('[data-testid="description"]'), "Wet floor near the gate"); await until(async () => !(await Q.page.locator('[data-testid="submit"]').isDisabled()), "submit enabled", 8000).catch(() => {}); await tap(Q.page, Q.page.locator('[data-testid="submit"]'), 450, 300); await Q.page.locator('[data-testid="submitted"]').waitFor({ timeout: 30000 }); await sleep(2200);
  });
  await scene("13-inspect", async (rec) => {
    await S.page.goto(`${BASE}/inspections`); await S.page.locator('[data-testid="start-inspection"]').waitFor(); await S.page.waitForLoadState("networkidle"); rec.start(S.page); await sleep(600);
    await tap(S.page, S.page.locator('[data-testid="start-inspection"]'), 400, 400); await tap(S.page, S.page.locator('[data-testid="tpl-T1"]'), 400, 400); await tap(S.page, S.page.locator('[data-testid="start-run"]'), 400, 400); await S.page.waitForURL(/\/inspections\/runs\//); await sleep(500); await tap(S.page, S.page.locator('[data-testid="header-next"]'), 350, 400);
    let failed = false;
    for (let sec = 0; sec < 8 && !(await S.page.locator('[data-testid="run-submit"]').count()); sec++) {
      const cards = S.page.locator('[data-testid^="q-"]'); const n = await cards.count();
      for (let i = 0; i < n; i++) { const card = cards.nth(i); if (!(await card.locator('[data-testid="ans-pass"]').count())) continue;
        if (!failed && i === Math.min(2, n - 1)) { failed = true; await tap(S.page, card.locator('[data-testid="ans-fail"]'), 300, 500); if (await card.locator('[data-testid="photo-input"]').count()) await photo(S.page, "FAIL: NO TOE BOARD", `[data-testid="${await card.getAttribute("data-testid")}"]`); const ta = card.locator("textarea").first(); if (await ta.count()) await type(S.page, ta, "West edge, no toe board", 250); const da = card.locator('[data-testid="draft-action"]'); if (await da.count()) { await tap(S.page, da, 300, 400); const sel = card.locator(".action-draft select").first(); if (await sel.count()) await choose(S.page, sel, ownerId, 250); } }
        else await tap(S.page, card.locator('[data-testid="ans-pass"]'), 150, 110); }
      await tap(S.page, S.page.locator('[data-testid="section-next"]'), 300, 400);
    }
    const pad = await S.page.locator(".sig-pad").boundingBox(); if (pad) { await S.page.mouse.move(pad.x + 30, pad.y + 60); await S.page.mouse.down(); for (const [dx, dy] of [[90, 30], [150, -20], [210, 40], [270, 10]]) { await S.page.mouse.move(pad.x + dx, pad.y + 60 + dy, { steps: 10 }); await S.page.evaluate(([x, y]) => window.__curMove && window.__curMove(x, y), [pad.x + dx, pad.y + 60 + dy]); } await S.page.mouse.up(); await sleep(500); }
    await tap(S.page, S.page.locator('[data-testid="run-submit"]'), 400, 300); await S.page.waitForURL(/\/inspections$/, { timeout: 30000 }); await sleep(1800);
  });
  await scene("14-charts", async (rec) => {
    await S.page.goto(`${BASE}/insights`); await S.page.locator('[data-testid="insights-kpis"]').waitFor(); await S.page.waitForLoadState("networkidle"); rec.start(S.page); await sleep(1200);
    await opt(async () => { await tap(S.page, S.page.getByRole("tab", { name: /Site/ }), 450, 1200); }); await opt(async () => { await tap(S.page, S.page.locator(".chip", { hasText: "365" }), 400, 1200); });
    await S.page.mouse.wheel(0, 500); await sleep(900); await S.page.mouse.wheel(0, -500); await sleep(300);
    const dl = S.page.waitForEvent("download", { timeout: 30000 }).catch(() => null); await tap(S.page, S.page.locator('[data-testid="export-xlsx"]'), 500, 300); await dl; await sleep(1400);
  });
  await scene("15-settings", async (rec) => {
    await W.page.goto(`${BASE}/notifications`); await W.page.waitForLoadState("networkidle"); rec.start(W.page); await sleep(1500);
    await W.page.goto(`${BASE}/settings`); await W.page.getByRole("button", { name: "English", exact: true }).waitFor(); await sleep(600);
    await tap(W.page, W.page.getByRole("button", { name: "ಕನ್ನಡ · Kannada", exact: true }), 400, 1200); await tap(W.page, W.page.getByRole("button", { name: "English", exact: true }), 350, 600);
    await opt(async () => { await tap(W.page, W.page.getByRole("button", { name: /^Dark$/ }), 400, 1000); await tap(W.page, W.page.getByRole("button", { name: /^Auto$/ }), 350, 500); });
    await opt(async () => { await choose(W.page, W.page.locator(".page select").first(), "weekly", 400); });
    await W.page.mouse.wheel(0, 600); await sleep(1000); await W.page.goto(`${BASE}/more`); await sleep(1300);
  });
  const A = await consoleCtx();
  await scene("16-dashboard", async (rec) => {
    rec.start(A.page); await sleep(1400); const siteSel = A.page.locator("header select").first(); const siteVal = await siteSel.locator("option", { hasText: "TN1" }).first().getAttribute("value"); await choose(A.page, siteSel, siteVal, 450); await A.page.waitForLoadState("networkidle"); await sleep(900);
    await opt(async () => { const from = A.page.locator('input[type="date"]').first(); await move(A.page, from, 350); await from.fill("2026-08-01"); await sleep(1000); });
    await A.page.mouse.move(800, 600); await A.page.mouse.wheel(0, 450); await sleep(1200); await A.page.mouse.wheel(0, -450); await sleep(400);
    await opt(async () => { await move(A.page, A.page.getByRole("button", { name: /Export this view/ }), 600); }); const dl = A.page.waitForEvent("download", { timeout: 30000 }).catch(() => null); await tap(A.page, A.page.getByRole("button", { name: /Full report/ }), 500, 300); await dl; await sleep(1200);
  });
  await scene("17-attention", async (rec) => { rec.start(A.page); await navTo(A, "Attention"); await A.page.locator(".attention").waitFor(); await sleep(800); for (const k of ["critical_unacked", "overdue", "missed"]) await opt(async () => { await move(A.page, A.page.locator(`[data-kind*="${k}"]`).first(), 700); }); await sleep(900); });
  await scene("18-registers", async (rec) => {
    rec.start(A.page); await navTo(A, "Observations"); await A.page.locator("tbody tr").first().waitFor(); await sleep(600);
    await opt(async () => { const q = A.page.locator("[data-register-search]").first(); await type(A.page, q, "edge", 300); await sleep(900); await q.fill(""); await sleep(600); });
    await opt(async () => { await choose(A.page, A.page.locator(".filters select").first(), { index: 1 }, 400); await sleep(700); await A.page.locator(".filters select").first().selectOption({ index: 0 }); await sleep(400); });
    await tap(A.page, A.page.locator("tbody tr").first(), 450, 700); await A.page.locator(".drawer").waitFor(); await sleep(1200); await A.page.keyboard.press("Escape"); await sleep(400);
    await navTo(A, "Actions"); await sleep(1100); await navTo(A, "Inspections"); await sleep(900); await opt(async () => { await move(A.page, A.page.getByRole("button", { name: /Excel/ }).first(), 700); });
  });
  await scene("19-cmdk", async (rec) => { await go(A, ""); rec.start(A.page); await sleep(500); await tap(A.page, A.page.locator('[data-testid="command-open"]'), 450, 500); await A.page.locator('[data-testid="command-menu"] input').pressSequentially(caseNo || "TN1", { delay: 45 }); await sleep(800); await A.page.keyboard.press("Enter"); await until(() => A.page.url().includes("/observations"), "register"); await A.page.waitForLoadState("networkidle"); await sleep(1500); });
  const siteId = sql1("select id::text from sites where code = 'TN1'");
  await scene("20-sites", async (rec) => {
    rec.start(A.page); await navTo(A, "Sites & areas"); await sleep(800); await opt(async () => { await tap(A.page, A.page.locator("tbody tr, .card.clickable", { hasText: "TN1" }).first(), 400, 900); }); if (!A.page.url().includes("/sites/")) await go(A, `sites/${siteId}`);
    await A.page.mouse.wheel(0, 400); await sleep(900); await opt(async () => { await tap(A.page, A.page.getByRole("link", { name: /Areas/ }).first(), 400, 1000); }); if (!A.page.url().endsWith("/areas")) { await go(A, `sites/${siteId}/areas`); await sleep(800); }
    await go(A, "sites/new"); await sleep(1300); await navTo(A, "Equipment"); await sleep(1100); await navTo(A, "QR codes"); await sleep(700); await opt(async () => { await move(A.page, A.page.getByRole("button", { name: /Rotate/ }).first(), 600); await move(A.page, A.page.getByRole("button", { name: /poster/i }).first(), 600); }); await sleep(400);
  });
  await scene("21-people", async (rec) => { rec.start(A.page); await navTo(A, "People & contractors"); await sleep(1000); await opt(async () => { const t = A.page.getByRole("tab", { name: /Contractors/ }); if (await t.count()) await tap(A.page, t, 400, 1000); else await tap(A.page, A.page.getByText("Contractors", { exact: true }).first(), 400, 1000); }); await opt(async () => { await move(A.page, A.page.getByRole("button", { name: /Import/ }).first(), 600); }); await go(A, "departments"); await sleep(1300); });
  await scene("22-users", async (rec) => {
    rec.start(A.page); await navTo(A, "Users & roles"); await A.page.locator("tbody tr").first().waitFor(); await sleep(600); await tap(A.page, A.page.getByRole("button", { name: /Add user|New user/ }).first(), 420, 700); await A.page.locator(".sheet, .drawer").first().waitFor(); await sleep(600);
    await opt(async () => { const sel = A.page.locator(".sheet select, .drawer select").first(); await move(A.page, sel, 500); }); await A.page.mouse.wheel(0, 300); await sleep(900); await A.page.keyboard.press("Escape"); await sleep(400);
    await tap(A.page, A.page.locator("tbody tr").first(), 420, 900); await opt(async () => { for (const n of [/Enrolment code/i, /Reset password/i, /Reset (MFA|authenticator)/i, /Unlock/i]) await move(A.page, A.page.getByRole("button", { name: n }).first(), 480); }); await sleep(600); await A.page.keyboard.press("Escape"); await sleep(300);
  });
  await scene("23-config", async (rec) => { rec.start(A.page); for (const [l, ms] of [["Categories", 2300], ["Risk matrix", 2300], ["Due dates & reminders", 2600], ["Rule sets", 1800]]) { await navTo(A, l); await sleep(ms); } });
  const tplId = sql1("select id::text from inspection_templates where code = 'T1' limit 1");
  await scene("24-templates", async (rec) => { rec.start(A.page); await navTo(A, "Templates"); await sleep(900); await go(A, `templates/${tplId}`); await A.page.locator(".builder").waitFor(); await sleep(1200); await A.page.mouse.move(600, 500); await A.page.mouse.wheel(0, 500); await sleep(1300); await A.page.mouse.wheel(0, -500); await sleep(400); await navTo(A, "Schedules"); await sleep(1800); });
  await scene("25-languages-settings", async (rec) => { rec.start(A.page); await navTo(A, "Languages"); await sleep(1800); await navTo(A, "Settings"); await sleep(1300); await A.page.mouse.move(800, 600); await A.page.mouse.wheel(0, 500); await sleep(1200); await A.page.mouse.wheel(0, 500); await sleep(1000); });
  await scene("26-oversight", async (rec) => { rec.start(A.page); await navTo(A, "Audit log"); await A.page.locator("tbody tr").first().waitFor(); await sleep(500); await opt(async () => { await tap(A.page, A.page.getByRole("button", { name: /Verify chain/ }), 450, 300); await A.page.getByText(/Chain intact/).waitFor({ timeout: 20000 }); await sleep(900); }); for (const [l, ms] of [["Notifications log", 1400], ["Health", 1300], ["Privacy", 1200], ["Retention", 1500]]) { await navTo(A, l); await sleep(ms); } });
  await browser.close(); fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1)); console.log("errors:", Object.keys(report.errors).length ? JSON.stringify(report.errors) : "none");
})().catch((e) => { console.error(e); process.exit(1); });
