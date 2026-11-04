/* Extra quality checks beyond the test plan: accessibility (axe-core, WCAG 2.1 A/AA) on every main screen, phone-width
   layout (no sideways scrolling at 320 px), HTTP security headers, CORS, login lockout, and a short load test.
   Run: DATABASE_URL=... AXE=/path/to/axe.min.js NODE_PATH=$(npm root -g) node portal/e2e/qa_extra.cjs   (WIPES that database)
   Writes qa-extra-results.json and prints a summary. */
const { chromium } = require("playwright");
const { spawn, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const SERVER_DIR = path.join(REPO, "portal/server");
const PY = process.env.PYTHON || "/srv/swvenv/bin/python";
const OUT = process.env.E2E_OUT || path.join(__dirname, "out");
const SQLQ = path.join(__dirname, "sqlq.py");
const DB = process.env.DATABASE_URL || "postgres://safeworks:safeworks@127.0.0.1:55432/safeworks";
const AXE = process.env.AXE;
const ADMIN_PW = "Qa-Admin-2026x";
const PW = "Qa-Demo-2026x";
fs.mkdirSync(OUT, { recursive: true });
let BASE = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sql(query, params = []) {
  const r = spawnSync(PY, ["-I", SQLQ, DB, query, JSON.stringify(params)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`sql failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim() || "[]");
}
function freePort() { return new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); }); }
async function startServer() {
  sql("drop schema if exists v1_archive cascade"); sql("drop schema if exists public cascade"); sql("create schema public");
  const env = { ...process.env, DATABASE_URL: DB, SEED_ADMIN_PASSWORD: ADMIN_PW, DEMO_PASSWORD: PW };
  const seed = spawnSync(PY, ["scripts/seed.py", "--demo"], { cwd: SERVER_DIR, env, encoding: "utf8" });
  if (seed.status !== 0) throw new Error(`seed failed: ${seed.stderr || seed.stdout}`);
  const port = await freePort();
  BASE = `http://127.0.0.1:${port}`;
  const log = fs.openSync(path.join(OUT, "qa-server.log"), "w");
  // normal rate limits on purpose (the lockout check needs them); RUN_JOBS off so timings are the API only
  const proc = spawn(PY, ["-m", "safeworks"], { cwd: SERVER_DIR, env: { ...env, PORT: String(port), RUN_JOBS: "false", PUBLIC_URL: BASE }, stdio: ["ignore", log, log] });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${BASE}/api/v1/health`)).ok) return proc; } catch { /* starting */ } await sleep(300); }
  throw new Error("server did not start");
}
async function api(token, method, p, body, extra = {}) {
  const headers = { "Accept-Language": "en", ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(`${BASE}/api/v1${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data = text; try { data = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, data, headers: r.headers };
}
function base32(s) {
  const al = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += al.indexOf(ch).toString(2).padStart(5, "0");
  const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac("sha1", base32(secret)).update(msg).digest(); const o = h[h.length - 1] & 0xf;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, "0");
}
async function login(code, password = PW, kind = "field") {
  const r = await api(null, "POST", "/auth/login", { login: code, password, kind, deviceUuid: `qa-${code}-${kind}`, platform: "qa", appVersion: "2.0.0" });
  if (r.status !== 200) throw new Error(`login ${code}: ${r.status} ${JSON.stringify(r.data)}`);
  if (!r.data.mfaRequired) return r.data.token;
  const secret = (await api(r.data.token, "POST", "/auth/mfa/enrol")).data.secret;
  const c = await api(r.data.token, "POST", "/auth/mfa/confirm", { code: totp(secret) });
  if (c.status !== 200) throw new Error(`mfa ${code}: ${c.status}`);
  return c.data.token;
}

const R = { a11y: [], layout: [], headers: {}, cors: {}, lockout: {}, load: {} };

async function axe(page, label) {
  await page.addScriptTag({ path: AXE });
  const res = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, sample: v.nodes.slice(0, 2).map((x) => x.target.join(" ")) }));
  });
  R.a11y.push({ page: label, violations: res });
}
async function overflow(page, label) {
  const o = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 1; })
      .slice(0, 3).map((e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === "string" ? "." + e.className.split(" ").join(".") : ""}`);
    return { scroll: document.documentElement.scrollWidth, width: w, wide };
  });
  R.layout.push({ page: label, ok: o.scroll <= o.width + 1, ...o });
}

(async () => {
  let proc, browser;
  try {
    proc = await startServer();
    console.log(`server ${BASE}`);
    browser = await chromium.launch();

    /* ---------- accessibility + 320 px layout: phone app */
    const fieldPages = ["/", "/report", "/reports", "/actions", "/inspections", "/insights", "/notifications", "/outbox", "/more", "/settings"];
    for (const who of ["WORKER-TN1-1", "SO-TN1"]) {
      const ctx = await browser.newContext({ viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true, locale: "en-IN", timezoneId: "Asia/Kolkata", bypassCSP: true });
      const page = await ctx.newPage(); page.setDefaultTimeout(15000);
      await page.goto(`${BASE}/`);
      await page.locator('input[autocomplete="username"]').fill(who);
      await page.locator('input[type="password"]').fill(PW);
      await page.locator('button[type="submit"]').click();
      await page.locator('[data-testid="home-report"]').waitFor({ timeout: 30000 });
      for (const p of fieldPages) {
        await page.goto(`${BASE}${p}`); await page.waitForLoadState("networkidle"); await sleep(400);
        await axe(page, `phone ${who} ${p}`); await overflow(page, `phone 320px ${who} ${p}`);
      }
      await ctx.close();
    }
    // sign-in page and QR form (no sign-in)
    {
      const ctx = await browser.newContext({ viewport: { width: 320, height: 720 }, isMobile: true, locale: "en-IN", bypassCSP: true });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/login`); await page.waitForLoadState("networkidle");
      await axe(page, "phone sign-in"); await overflow(page, "phone 320px sign-in");
      const tok = sql("select token from qr_codes where active order by created_at limit 1")[0].token;
      await page.goto(`${BASE}/q/${tok}`); await page.waitForLoadState("networkidle"); await sleep(500);
      await axe(page, "QR form"); await overflow(page, "QR form 320px");
      await ctx.close();
    }
    /* ---------- accessibility: console */
    {
      const tok = await login("ADMIN01", ADMIN_PW, "admin");
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-IN", timezoneId: "Asia/Kolkata", bypassCSP: true });
      const page = await ctx.newPage(); page.setDefaultTimeout(15000);
      await page.goto(`${BASE}/admin/`); await page.evaluate((t) => localStorage.setItem("sw.admin.token", t), tok);
      for (const p of ["", "attention", "observations", "actions", "inspections", "users", "people", "sites", "departments", "categories", "qr", "templates", "settings", "audit-log", "languages"]) {
        await page.goto(`${BASE}/admin/${p}`); await page.locator("nav").first().waitFor({ timeout: 30000 }); await page.waitForLoadState("networkidle"); await sleep(400);
        await axe(page, `console /admin/${p}`);
      }
      await page.setViewportSize({ width: 768, height: 1000 });
      for (const p of ["", "observations", "users"]) { await page.goto(`${BASE}/admin/${p}`); await page.waitForLoadState("networkidle"); await sleep(300); await overflow(page, `console 768px /admin/${p}`); }
      await ctx.close();
    }

    /* ---------- HTTP security headers and CORS */
    for (const [label, url] of [["phone app page", `${BASE}/`], ["console page", `${BASE}/admin/`], ["API", `${BASE}/api/v1/health`]]) {
      const r = await fetch(url);
      const h = {};
      for (const k of ["content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy", "strict-transport-security", "cache-control", "server"]) h[k] = r.headers.get(k);
      R.headers[label] = h;
    }
    {
      const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,authorization" } });
      const g = await fetch(`${BASE}/api/v1/health`, { headers: { Origin: "https://evil.example" } });
      R.cors = { preflightStatus: r.status, preflightAllowOrigin: r.headers.get("access-control-allow-origin"), getAllowOrigin: g.headers.get("access-control-allow-origin"), allowCredentials: g.headers.get("access-control-allow-credentials") };
    }

    /* ---------- login lockout (wrong password repeatedly, then the right one) */
    {
      const codes = [];
      for (let i = 0; i < 11; i++) codes.push((await api(null, "POST", "/auth/login", { login: "WORKER-KA2-5", password: "wrong-password-1", kind: "field", deviceUuid: "qa-lock", platform: "qa", appVersion: "2.0.0" })).status);
      const after = (await api(null, "POST", "/auth/login", { login: "WORKER-KA2-5", password: PW, kind: "field", deviceUuid: "qa-lock", platform: "qa", appVersion: "2.0.0" })).status;
      const unknown = [];
      for (let i = 0; i < 3; i++) { const t0 = Date.now(); await api(null, "POST", "/auth/login", { login: `NO-SUCH-${i}`, password: "x-wrong-12345", kind: "field", deviceUuid: "qa-u", platform: "qa", appVersion: "2.0.0" }); unknown.push(Date.now() - t0); }
      R.lockout = { wrongAttempts: codes, rightPasswordAfter: after };
    }

    /* ---------- load: 40 signed-in users at once, 10 rounds of the busiest reads */
    {
      const users = [];
      for (const site of ["TN1", "TN2", "TN3", "KA1", "KA2"]) for (let i = 1; i <= 4; i++) users.push(await login(`WORKER-${site}-${i}`));
      for (const site of ["TN1", "TN2", "TN3", "KA1", "KA2"]) users.push(await login(`SO-${site}`), await login(`VER-${site}`), await login(`OWN-${site}-1`), await login(`OWN-${site}-2`));
      const paths = ["/me", "/observations?pageSize=50", "/actions?pageSize=50", "/sync/pull", "/insights?level=me", "/me/notifications"];
      const times = []; let errors = 0; const errSample = [];
      const t0 = Date.now();
      for (let round = 0; round < 10; round++) {
        await Promise.all(users.map(async (tok, i) => {
          const p = paths[(i + round) % paths.length];
          const s = Date.now();
          const r = await fetch(`${BASE}/api/v1${p}`, { headers: { Authorization: `Bearer ${tok}` } });
          await r.arrayBuffer();
          times.push(Date.now() - s);
          if (r.status >= 400) { errors++; if (errSample.length < 3) errSample.push(`${p}: ${r.status}`); }
        }));
      }
      const wall = Date.now() - t0;
      times.sort((a, b) => a - b);
      const q = (f) => times[Math.min(times.length - 1, Math.floor(times.length * f))];
      R.load = { users: users.length, requests: times.length, errors, errSample, p50: q(0.5), p95: q(0.95), max: times[times.length - 1], wallMs: wall, perSecond: Math.round(times.length / (wall / 1000)) };
    }
  } catch (e) {
    R.error = String(e && e.stack || e);
  } finally {
    if (browser) await browser.close();
    if (proc) proc.kill();
    fs.writeFileSync(path.join(OUT, "qa-extra-results.json"), JSON.stringify(R, null, 2));
    const serious = R.a11y.flatMap((p) => p.violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => `${p.page}: ${v.id} (${v.impact}, ${v.n})`));
    const byRule = {};
    for (const p of R.a11y) for (const v of p.violations) { byRule[v.id] = byRule[v.id] || { impact: v.impact, help: v.help, pages: 0, nodes: 0, sample: v.sample }; byRule[v.id].pages++; byRule[v.id].nodes += v.n; }
    console.log(`\nACCESSIBILITY: ${R.a11y.length} screens, ${serious.length} serious/critical findings`);
    for (const [id, x] of Object.entries(byRule)) console.log(`  ${id} [${x.impact}] on ${x.pages} screens (${x.nodes} elements): ${x.help} — e.g. ${x.sample.join(" | ")}`);
    const bad = R.layout.filter((l) => !l.ok);
    console.log(`LAYOUT: ${R.layout.length} screens checked, ${bad.length} scroll sideways`);
    for (const l of bad) console.log(`  ${l.page}: page ${l.scroll}px wide in ${l.width}px; ${l.wide.join(", ")}`);
    console.log("HEADERS:", JSON.stringify(R.headers, null, 1));
    console.log("CORS:", JSON.stringify(R.cors));
    console.log("LOCKOUT:", JSON.stringify(R.lockout));
    console.log("LOAD:", JSON.stringify(R.load));
    if (R.error) console.log("ERROR:", R.error);
  }
})();
