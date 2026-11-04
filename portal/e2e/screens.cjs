/* Screenshots of the main screens (phone app as a worker and an officer, console as an admin), light and dark, for
   comparing design versions. Starts its own server on a fresh demo database.
   Run: DATABASE_URL=... SHOTS_DIR=/some/dir NODE_PATH=$(npm root -g) node portal/e2e/screens.cjs   (WIPES that database) */
const { chromium } = require("playwright");
const { spawn, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const SERVER_DIR = path.join(REPO, "portal/server");
const PY = process.env.PYTHON || "/srv/swvenv/bin/python";
const SQLQ = path.join(__dirname, "sqlq.py");
const DB = process.env.DATABASE_URL || "postgres://safeworks:safeworks@127.0.0.1:55432/safeworks";
const OUT = process.env.SHOTS_DIR || path.join(__dirname, "out", "screens");
const ADMIN_PW = "Shot-Admin-2026x";
const PW = "Shot-Demo-2026x";
fs.mkdirSync(OUT, { recursive: true });
let BASE = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) => { const r = spawnSync(PY, ["-I", SQLQ, DB, q, "[]"], { encoding: "utf8" }); if (r.status) throw new Error(r.stderr); return JSON.parse(r.stdout.trim() || "[]"); };
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
function base32(s) { const al = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += al.indexOf(ch).toString(2).padStart(5, "0"); const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(o); }
function totp(secret) { const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = crypto.createHmac("sha1", base32(secret)).update(m).digest(); const o = h[h.length - 1] & 0xf; return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, "0"); }
async function api(token, method, p, body) {
  const headers = { "Content-Type": "application/json" }; if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}/api/v1${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return r.json();
}
async function consoleToken(code, pw) {
  const r = await api(null, "POST", "/auth/login", { login: code, password: pw, kind: "admin", deviceUuid: `shot-${code}`, platform: "shot", appVersion: "2.0.0" });
  if (!r.mfaRequired) return r.token;
  const s = (await api(r.token, "POST", "/auth/mfa/enrol")).secret;
  return (await api(r.token, "POST", "/auth/mfa/confirm", { code: totp(s) })).token;
}

(async () => {
  sql("drop schema if exists v1_archive cascade"); sql("drop schema if exists public cascade"); sql("create schema public");
  const env = { ...process.env, DATABASE_URL: DB, SEED_ADMIN_PASSWORD: ADMIN_PW, DEMO_PASSWORD: PW };
  const seed = spawnSync(PY, ["scripts/seed.py", "--demo"], { cwd: SERVER_DIR, env, encoding: "utf8" });
  if (seed.status) throw new Error(seed.stderr);
  const port = await freePort(); BASE = `http://127.0.0.1:${port}`;
  const proc = spawn(PY, ["-m", "safeworks"], { cwd: SERVER_DIR, env: { ...env, PORT: String(port), RUN_JOBS: "false", PUBLIC_URL: BASE, USER_RATE_LIMIT: "100000" }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${BASE}/api/v1/health`)).ok) break; } catch { /* starting */ } await sleep(300); }
  const browser = await chromium.launch();
  const shots = [];
  let adminTok = "";
  try {
    for (const scheme of ["light", "dark"]) {
      // phone app
      for (const who of ["WORKER-TN1-1", "SO-TN1"]) {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-IN", timezoneId: "Asia/Kolkata", colorScheme: scheme, geolocation: { latitude: 13.0827, longitude: 80.2707 }, permissions: ["geolocation"] });
        const p = await ctx.newPage();
        await p.goto(`${BASE}/`);
        if (who === "WORKER-TN1-1" && scheme === "light") { await p.waitForLoadState("networkidle"); await p.screenshot({ path: path.join(OUT, "phone-signin.png") }); shots.push("phone-signin"); }
        await p.locator('input[autocomplete="username"]').fill(who); await p.locator('input[type="password"]').fill(PW);
        await p.locator('button[type="submit"]').click(); await p.locator('[data-testid="home-report"]').waitFor({ timeout: 30000 });
        const pages = who === "SO-TN1" ? [["home", "/"], ["reports", "/reports"]] : [["home", "/"], ["report", "/report"], ["reports", "/reports"], ["actions", "/actions"], ["charts", "/insights"], ["settings", "/settings"], ["more", "/more"]];
        if (scheme === "dark" && who === "WORKER-TN1-1") pages.splice(2);
        for (const [name, url] of pages) {
          await p.goto(`${BASE}${url}`); await p.waitForLoadState("networkidle"); await sleep(700);
          if (name === "report") { await p.locator('[data-testid="type-unsafe_condition"]').click(); await sleep(300); }
          const file = `phone-${who === "SO-TN1" ? "officer" : "worker"}-${name}-${scheme}`;
          await p.screenshot({ path: path.join(OUT, `${file}.png`) }); shots.push(file);
        }
        await ctx.close();
      }
      // console
      const tok = adminTok || (adminTok = await consoleToken("ADMIN01", ADMIN_PW));  // MFA is set up once (it cannot be re-enrolled)
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-IN", timezoneId: "Asia/Kolkata", colorScheme: scheme });
      const p = await ctx.newPage();
      await p.goto(`${BASE}/admin/`); await p.evaluate((t) => localStorage.setItem("sw.admin.token", t), tok);
      const pages = scheme === "dark" ? [["dashboard", ""], ["observations", "observations"]] : [["dashboard", ""], ["attention", "attention"], ["observations", "observations"], ["actions", "actions"], ["users", "users"], ["sites", "sites"]];
      for (const [name, url] of pages) {
        await p.goto(`${BASE}/admin/${url}`); await p.locator("nav").first().waitFor({ timeout: 30000 }); await p.waitForLoadState("networkidle"); await sleep(800);
        const file = `console-${name}-${scheme}`; await p.screenshot({ path: path.join(OUT, `${file}.png`) }); shots.push(file);
      }
      await ctx.close();
    }
  } finally {
    await browser.close(); proc.kill();
    console.log(`${shots.length} screenshots in ${OUT}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
