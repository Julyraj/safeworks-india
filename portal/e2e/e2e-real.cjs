/* SafeWorks Portal 2.0 — real end-to-end test: Playwright against the real Python server and a fresh PostgreSQL database.
   Run: node portal/e2e/e2e-real.cjs  (see portal/e2e/README.md; WIPES the database in DATABASE_URL)
   Each user has their own browser context (390×844 for field users, 1280×800 for the console). Every context fails the
   run on a console error or a failed request, except the refusals the test provokes on purpose (declared with allow()). */
const { chromium } = require("playwright");
const { spawn, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const SERVER_DIR = path.join(REPO, "portal/server");
const PY = process.env.PYTHON || "/srv/swvenv/bin/python";
const SCRATCH = process.env.E2E_OUT || path.join(__dirname, "out");
const SHOTS = path.join(SCRATCH, "e2e-shots");
const SQLQ = path.join(__dirname, "sqlq.py");
const DB = process.env.DATABASE_URL || "postgres://safeworks:safeworks@127.0.0.1:55432/safeworks";
const ADMIN_PW = "E2e-Admin-2026";
const DEMO_PW = "E2e-Demo-2026";
const TN1 = { latitude: 13.0827, longitude: 80.2707 };
fs.mkdirSync(SHOTS, { recursive: true });

let BASE = "";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).replace(/\s+/g, " ").slice(0, 300) : ""}`);
  if (!ok) throw new Error(`check failed: ${name} ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, timeout = 20000, every = 400) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ""}`);
}

/* ---------------------------------------------------------------- database, server */
function sql(query, params = []) {
  const r = spawnSync(PY, ["-I", SQLQ, DB, query, JSON.stringify(params)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`sql failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim() || "[]");
}
function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
}
async function startServer() {
  sql("drop schema if exists v1_archive cascade");
  sql("drop schema if exists public cascade");
  sql("create schema public");
  const env = { ...process.env, DATABASE_URL: DB, SEED_ADMIN_PASSWORD: ADMIN_PW, DEMO_PASSWORD: DEMO_PW };
  const seed = spawnSync(PY, ["scripts/seed.py", "--demo"], { cwd: SERVER_DIR, env, encoding: "utf8" });
  if (seed.status !== 0) throw new Error(`seed failed: ${seed.stderr || seed.stdout}`);
  const port = await freePort();
  BASE = `http://127.0.0.1:${port}`;
  const logFile = fs.openSync(path.join(SCRATCH, "e2e-server.log"), "w");
  const proc = spawn(PY, ["-m", "safeworks"], { cwd: SERVER_DIR, env: { ...env, PORT: String(port), RUN_JOBS: "true", PUBLIC_URL: BASE, LOG_LEVEL: "warning" }, stdio: ["ignore", logFile, logFile] });
  await until(async () => (await fetch(`${BASE}/api/v1/health`)).ok, "server health", 30000);
  return proc;
}

/* ---------------------------------------------------------------- API helpers (checks only; the UI does the work) */
async function api(token, method, p, body) {
  const headers = { "Accept-Language": "en" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(`${BASE}/api/v1${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* html or empty */ }
  return { status: r.status, data, headers: r.headers };
}
function base32(s) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/=+$/, "").replace(/\s/g, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
/** RFC 6238 TOTP (HMAC-SHA1, 30 s, 6 digits). */
function totp(secret, step = Math.floor(Date.now() / 30000)) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", base32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}
const usedSteps = {};
/** A TOTP code for a step this user has not used yet (the server refuses a replayed code). */
async function freshTotp(user, secret) {
  let step = Math.floor(Date.now() / 30000);
  if (usedSteps[user] !== undefined && step <= usedSteps[user]) { await sleep((usedSteps[user] + 1) * 30000 - Date.now() + 300); step = Math.floor(Date.now() / 30000); }
  usedSteps[user] = step;
  return totp(secret, step);
}
const secrets = {};
async function apiLogin(login, password, kind = "field") {
  const r = await api(null, "POST", "/auth/login", { login, password, kind, deviceUuid: `e2e-api-${login}-${kind}`, platform: "e2e", appVersion: "2.0.0" });
  if (r.status !== 200) throw new Error(`api login ${login}: ${r.status} ${JSON.stringify(r.data)}`);
  if (!r.data.mfaRequired) return r.data.token;
  const pre = r.data.token;
  if (!secrets[login]) {
    const en = await api(pre, "POST", "/auth/mfa/enrol");
    secrets[login] = en.data.secret;
    const c = await api(pre, "POST", "/auth/mfa/confirm", { code: await freshTotp(login, secrets[login]) });
    if (c.status !== 200) throw new Error(`mfa confirm ${login}: ${c.status} ${JSON.stringify(c.data)}`);
    return c.data.token;
  }
  const m = await api(pre, "POST", "/auth/mfa", { code: await freshTotp(login, secrets[login]) });
  if (m.status !== 200) throw new Error(`mfa ${login}: ${m.status} ${JSON.stringify(m.data)}`);
  return m.data.token;
}

/* ---------------------------------------------------------------- browser helpers */
const trackers = [];
function newTracker(label) {
  // a fetch cancelled because the test navigates away (net::ERR_ABORTED) is not a failure of the app
  const t = { label, errors: [], allowList: [/requestfailed .* net::ERR_ABORTED$/] };
  t.allow = (re) => { t.allowList.push(re); return () => { t.allowList = t.allowList.filter((x) => x !== re); }; };
  t.allowed = (s) => t.allowList.some((re) => re.test(s));
  trackers.push(t);
  return t;
}
function watchPage(page, t) {
  page.on("console", (m) => { if (m.type() !== "error") return; const s = `console ${m.text()} @ ${m.location()?.url ?? ""}`; if (!t.allowed(s)) t.errors.push(s); });
  page.on("pageerror", (e) => { const s = `pageerror ${e.message}`; if (!t.allowed(s)) t.errors.push(s); });
  page.on("response", (r) => { if (r.status() >= 400) { const s = `http ${r.status()} ${r.request().method()} ${r.url()}`; if (!t.allowed(s)) t.errors.push(s); } });
  page.on("requestfailed", (r) => { const s = `requestfailed ${r.method()} ${r.url()} ${r.failure()?.errorText ?? ""}`; if (!t.allowed(s)) t.errors.push(s); });
}
async function newContext(browser, label, phone) {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-IN", timezoneId: "Asia/Kolkata", geolocation: TN1, permissions: ["geolocation"] }
    : { viewport: { width: 1280, height: 800 }, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  const t = newTracker(label);
  ctx.on("page", (p) => watchPage(p, t));
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  return { ctx, page, t };
}
function assertClean(t, step) {
  const errs = t.errors.splice(0);
  check(`${step}: no console errors or failed requests [${t.label}]`, errs.length === 0, errs.join(" | "));
}
let shotN = 0;
async function shot(page, name) {
  shotN++;
  const file = path.join(SHOTS, `${String(shotN).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}
async function jpeg(page, text, colour = "#c9a35e") {
  const b64 = await page.evaluate(([txt, col]) => {
    const c = document.createElement("canvas"); c.width = 1280; c.height = 960; const g = c.getContext("2d");
    g.fillStyle = col; g.fillRect(0, 0, 1280, 960); g.fillStyle = "#333"; g.fillRect(100, 540, 1080, 300);
    g.fillStyle = "#f5c400"; g.font = "bold 72px sans-serif"; g.fillText(txt, 110, 220); g.font = "28px sans-serif"; g.fillText(new Date().toISOString(), 110, 300);
    return c.toDataURL("image/jpeg", 0.85).split(",")[1];
  }, [text, colour]);
  return Buffer.from(b64, "base64");
}
async function attachPhoto(page, text, scope = "") {
  const buf = await jpeg(page, text);
  const before = await page.locator(`${scope} .thumb img`).count();
  await page.locator(`${scope} [data-testid="photo-input"]`.trim()).last().setInputFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: buf });
  await until(async () => (await page.locator(`${scope} .thumb img`).count()) > before, `photo thumbnail (${text})`, 15000, 200);
}
async function toastSuccess(page, label) {
  const toast = page.locator(".toast.success").last();
  await toast.waitFor({ timeout: 15000 });
  check(label, true, await toast.innerText());
}
async function fieldLogin(page, login, password = DEMO_PW) {
  await page.goto(`${BASE}/`);
  await page.locator('input[autocomplete="username"]').fill(login);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.locator('[data-testid="home-report"]').waitFor({ timeout: 30000 });
}
async function syncNow(page) {
  // the app syncs on its own within seconds; a reload starts a pull at once
  await page.reload();
  await page.locator('[data-testid="home-report"], .page').first().waitFor();
}
const label = (page, text) => page.getByLabel(new RegExp("^" + text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\*?$"));

/* ---------------------------------------------------------------- the run */
(async () => {
  let server;
  let browser;
  const t0 = Date.now();
  try {
    server = await startServer();
    console.log(`server ${BASE} (fresh database, demo seed)`);
    browser = await chromium.launch();

    // reference ids
    const ids = Object.fromEntries(sql("select employee_code as code, id::text from users where employee_code <> ''").map((r) => [r.code, r.id]));
    const sites = Object.fromEntries(sql("select code, id::text from sites").map((r) => [r.code, r.id]));
    // every field user signs in in English for stable labels (their own preference; the console test switches languages)
    for (const u of ["WORKER-TN1-1", "WORKER-TN1-2", "SO-TN1", "OWN-TN1-1", "VER-TN1"]) {
      const tok = await apiLogin(u, DEMO_PW);
      await api(tok, "PUT", "/me/preferences", { language: "en", digest: "daily", quietHours: true });
    }
    const tok = {};
    for (const u of ["WORKER-TN1-1", "SO-TN1", "OWN-TN1-1", "VER-TN1"]) tok[u] = await apiLogin(u, DEMO_PW);

    /* ======================================================= 1. worker: quick report online, then offline */
    const W = await newContext(browser, "WORKER-TN1-1", true);
    await fieldLogin(W.page, "WORKER-TN1-1");
    await shot(W.page, "worker-home");
    await W.page.locator('[data-testid="home-report"]').click();
    await W.page.locator('[data-testid="type-unsafe_condition"]').waitFor();
    await until(async () => /TN1/.test(await W.page.locator('[data-testid="loc-chip"]').innerText()), "location chip TN1");
    await W.page.locator('[data-testid="type-unsafe_condition"]').click();
    await attachPhoto(W.page, "OPEN EDGE L3");
    await W.page.locator('[data-testid="description"]').fill("Open edge on level 3 near the lift shaft, no guard rail");
    await shot(W.page, "worker-quick-report");
    await W.page.locator('[data-testid="submit"]').click();
    await W.page.locator('[data-testid="submitted"]').waitFor();
    const case1 = await until(async () => { const s = await W.page.locator('[data-testid="case-no"]').innerText(); return /TN1-OBS-2026-\d{5}/.test(s) && s.match(/TN1-OBS-2026-\d{5}/)[0]; }, "case number after sync");
    check("1. quick report: case number appears after sync", true, case1);
    await shot(W.page, "worker-case-number");
    const obs1 = await until(async () => { const r = await api(tok["WORKER-TN1-1"], "GET", `/observations?mine=1&q=${case1}`); return r.data.items?.[0]; }, "observation in API");
    const media1 = await until(async () => { const d = (await api(tok["WORKER-TN1-1"], "GET", `/observations/${obs1.id}`)).data; return d.media.length && d.media.every((m) => m.uploadStatus !== "pending") && d.media; }, "photo uploaded");
    check("1. photo uploaded with SHA-256 match", media1.length === 1 && media1[0].hashMatch === true && media1[0].uploadStatus !== "failed", JSON.stringify(media1.map((m) => [m.uploadStatus, m.hashMatch])));
    // offline: second report, anonymous
    const unallowOffline = W.t.allow(/ERR_INTERNET_DISCONNECTED|net::ERR_|Failed to load resource|Failed to fetch/);
    await W.ctx.setOffline(true);
    await W.page.getByRole("button", { name: "Report another" }).click();
    await W.page.locator('[data-testid="type-near_miss"]').waitFor();
    await W.page.locator('[data-testid="type-near_miss"]').click();
    await attachPhoto(W.page, "NEAR MISS");
    await W.page.locator('[data-testid="description"]').fill("Bricks fell from the hoist landing, nobody hurt");
    await W.page.locator(".toggle", { hasText: "Report anonymously" }).locator('[role="switch"]').click();
    await W.page.locator('[data-testid="submit"]').click();
    await W.page.locator('[data-testid="submitted"]').waitFor();
    const pendingTxt = await W.page.locator('[data-testid="case-no"]').innerText();
    check("1. offline submit shows a pending number", /pending/i.test(pendingTxt), pendingTxt);
    await W.page.goto(`${BASE}/outbox`).catch(() => {}); // the service worker serves the app shell offline
    await W.page.locator('[data-testid="outbox-list"]').waitFor();
    const pendingRows = await until(async () => W.page.locator('.ob-row[data-status="pending"], .ob-row[data-status="sending"]').count(), "pending row in the outbox", 10000);
    check("1. outbox shows the report as pending", pendingRows >= 1, `${pendingRows} pending`);
    await shot(W.page, "worker-outbox-offline");
    await W.ctx.setOffline(false);
    await until(async () => (await W.page.locator('.ob-row[data-status="pending"], .ob-row[data-status="sending"]').count()) === 0 && (await W.page.locator('.ob-row[data-status="synced"]').count()) >= 2, "outbox synced", 30000);
    check("1. back online: outbox synced", true);
    await shot(W.page, "worker-outbox-synced");
    unallowOffline();
    const anon = await until(async () => { const r = await api(tok["WORKER-TN1-1"], "GET", "/observations?mine=1&type=near_miss"); return r.data.items?.find((o) => o.anonymous); }, "anonymous report listed as mine");
    check("1. anonymous report: mine, no reporter name", anon.mine === true && anon.reporterName === null, anon.caseNo);
    const media2 = await until(async () => { const d = (await api(tok["WORKER-TN1-1"], "GET", `/observations/${anon.id}`)).data; return d.media.length && d.media.every((m) => m.uploadStatus !== "pending") && d.media; }, "offline photo uploaded");
    check("1. offline photo uploaded with SHA-256 match", media2.every((m) => m.hashMatch === true), JSON.stringify(media2.map((m) => m.hashMatch)));
    const sealed = sql("select reporter_user_id from observations where id = $1::uuid", [anon.id])[0];
    check("1. anonymous report stores no reporter id", sealed.reporter_user_id === null);
    assertClean(W.t, "1");

    /* ======================================================= 2. officer triage: accept_assign with an inline action; extreme → interim + stop-work */
    const S = await newContext(browser, "SO-TN1", true);
    await fieldLogin(S.page, "SO-TN1");
    await S.page.goto(`${BASE}/o/${obs1.id}`);
    await S.page.locator('[data-testid="triage-open"]').click();
    await S.page.locator('[data-testid="decision-accept_assign"]').click();
    await S.page.locator('[role="gridcell"][aria-label$="= 4"]').first().click();
    await S.page.locator('select:has(option[value="B-2"])').selectOption("B-2");
    const employerSel = S.page.locator(".sheet select").filter({ has: S.page.locator('option:has-text("Our company")') }).first();
    if (!(await employerSel.inputValue())) await employerSel.selectOption({ index: 1 });
    const draft1 = S.page.locator('[data-testid="action-draft"]').first();
    await draft1.locator("input").first().fill("Fit guard rail, mid-rail and toe board at the level 3 open edge");
    await draft1.locator("select").first().selectOption(ids["OWN-TN1-1"]);
    await shot(S.page, "officer-triage-assign");
    await S.page.locator('[data-testid="triage-submit"]').click();
    await toastSuccess(S.page, "2. triage accept_assign saved");
    const act1 = await until(async () => { const d = (await api(tok["SO-TN1"], "GET", `/observations/${obs1.id}`)).data; return d.status === "action_assigned" && d.actions?.[0]; }, "observation action_assigned");
    check("2. action created for OWN-TN1-1", act1.ownerUserId === ids["OWN-TN1-1"], `${act1.caseNo} ${act1.status}`);
    // a second report triaged as extreme
    const w2 = await apiLogin("WORKER-TN1-2", DEMO_PW);
    const area = sql("select id::text from areas where site_id = $1::uuid and code = 'SCAF'", [sites.TN1])[0].id;
    const created = await api(w2, "POST", "/observations", { clientUuid: crypto.randomUUID(), siteId: sites.TN1, areaId: area, capturedAt: new Date().toISOString(), channel: "web", type: "unsafe_act", categoryCodes: ["HEIGHT"], description: "Two men on the scaffold top lift without harness, 12 m drop", descriptionLang: "en", media: [] });
    check("2. second report created (API, WORKER-TN1-2)", created.status === 201, created.data.caseNo);
    const obs2 = created.data;
    await S.page.goto(`${BASE}/o/${obs2.id}`);
    await S.page.locator('[data-testid="triage-open"]').click();
    await S.page.locator('[data-testid="decision-accept_assign"]').click();
    await S.page.locator('[role="gridcell"][aria-label$="= 25"]').click();
    await S.page.locator(".sheet .banner.critical").waitFor();
    check("2. extreme band shows the stop-work banner", true);
    await S.page.locator('select:has(option[value="B-2"])').selectOption("B-2");
    const emp2 = S.page.locator(".sheet select").filter({ has: S.page.locator('option:has-text("Our company")') }).first();
    if (!(await emp2.inputValue())) await emp2.selectOption({ index: 1 });
    const draft2 = S.page.locator('[data-testid="action-draft"]').first();
    await draft2.locator("input").first().fill("Stop scaffold top-lift work until lifelines are rigged");
    await draft2.locator("select").first().selectOption(ids["OWN-TN1-1"]);
    await S.page.locator('[data-testid="triage-submit"]').click();
    const interimErr = S.page.locator(".sheet .field.invalid, .sheet [role=alert]").first();
    await interimErr.waitFor();
    check("2. extreme without interim control is refused", /interim/i.test(await S.page.locator(".sheet").innerText()), await interimErr.innerText());
    await label(S.page, "Interim control (this shift)").fill("Scaffold top lift closed and tagged; supervisor posted at the access ladder");
    const interimInput = draft2.getByLabel(/^Interim control/);
    if (await interimInput.count()) await interimInput.fill("Area barricaded, no access above lift 3");
    await shot(S.page, "officer-triage-extreme");
    await S.page.locator('[data-testid="triage-submit"]').click();
    await toastSuccess(S.page, "2. extreme triage saved");
    await until(async () => (await api(tok["SO-TN1"], "GET", `/observations/${obs2.id}`)).data.riskBand === "extreme", "obs2 extreme");
    const alerts = await until(() => { const rows = sql(`select n.title, n.critical, n.event_type from notifications n join users u on u.id = n.recipient_user_id
                                                          where u.employee_code = 'SH-TN1' and n.record_id = $1::uuid and n.critical`, [obs2.id]); return rows.length && rows; }, "stop-work alert for SH-TN1");
    check("2. stop-work alert notification exists for SH-TN1", alerts.length >= 1, `${alerts[0].event_type}: ${alerts[0].title}`);
    assertClean(S.t, "2");

    /* ======================================================= 3. owner completes: refused without after-photo; owner cannot verify */
    const O = await newContext(browser, "OWN-TN1-1", true);
    await fieldLogin(O.page, "OWN-TN1-1");
    await O.page.goto(`${BASE}/a/${act1.id}`);
    await O.page.locator('[data-testid="complete-open"]').click();
    await until(async () => (await O.page.locator(".sheet textarea").count()) === 2, "both text boxes of the Complete sheet");  // typing before the sheet settles could land both texts in one box
    // The sheet may re-render once while it settles and drop typed text, so re-type until both boxes hold it.
    await until(async () => {
      const box = O.page.locator(".sheet textarea");
      if (!(await box.nth(0).inputValue()).startsWith("Guard rail")) await box.nth(0).fill("Guard rail, mid-rail and toe board fitted along the 14 m edge");
      if (!(await box.nth(1).inputValue()).startsWith("No edge protection")) await box.nth(1).fill("No edge protection step in the slab pour sequence; added to the method statement");
      return (await box.nth(0).inputValue()).startsWith("Guard rail") && (await box.nth(1).inputValue()).startsWith("No edge protection");
    }, "both Complete texts filled");
    await O.page.locator('[data-testid="complete-submit"]').click();
    await O.page.locator('[data-testid="after-photo-error"]').waitFor();
    check("3. complete without an after-photo is refused", true);
    await shot(O.page, "owner-complete-needs-photo");
    await attachPhoto(O.page, "AFTER: GUARD RAIL", ".sheet");
    await O.page.locator('[data-testid="complete-submit"]').click();
    await toastSuccess(O.page, "3. complete with after-photo saved");
    await until(async () => (await api(tok["OWN-TN1-1"], "GET", `/actions/${act1.id}`)).data.status === "completed", "action completed", 30000);
    const afterMedia = await until(async () => { const d = (await api(tok["OWN-TN1-1"], "GET", `/actions/${act1.id}`)).data; const m = d.events.flatMap((e) => e.media).filter((x) => x.purpose === "after"); return m.length && m.every((x) => x.uploadStatus !== "pending") && m; }, "after-photo uploaded", 30000);
    check("3. after-photo uploaded with SHA-256 match", afterMedia.every((m) => m.hashMatch === true));
    await O.page.reload();
    await O.page.locator(".page").first().waitFor();
    await sleep(800);
    check("3. owner sees no Verify button on their own action", (await O.page.locator('[data-testid="verify-open"]').count()) === 0);
    const ownVerify = await api(tok["OWN-TN1-1"], "POST", `/actions/${act1.id}/verify`, { clientUuid: crypto.randomUUID(), result: "effective", method: "re_inspection", capturedAt: new Date().toISOString() });
    check("3. owner trying to verify is refused (403)", ownVerify.status === 403, ownVerify.data.error);
    await shot(O.page, "owner-completed");
    assertClean(O.t, "3");

    /* ======================================================= 4. verifier verifies → Closed; worker sees it */
    const V = await newContext(browser, "VER-TN1", true);
    await fieldLogin(V.page, "VER-TN1");
    await V.page.goto(`${BASE}/a/${act1.id}`);
    await V.page.locator('[data-testid="verify-open"]').click();
    await V.page.locator(".compare img").first().waitFor();
    await shot(V.page, "verifier-compare");
    await V.page.locator('[data-testid="result-effective"]').click();
    await V.page.locator('[data-testid="verify-submit"]').click();
    await toastSuccess(V.page, "4. verification saved");
    await until(async () => (await api(tok["VER-TN1"], "GET", `/observations/${obs1.id}`)).data.status === "closed", "observation closed", 30000);
    check("4. observation status is closed (API)", true);
    await V.page.goto(`${BASE}/o/${obs1.id}`);
    await V.page.locator(".page").getByText("Closed", { exact: true }).first().waitFor();
    check("4. observation shows Closed", true);
    await shot(V.page, "verifier-closed");
    await W.page.goto(`${BASE}/reports`);
    await W.page.locator('[data-testid="reports-list"]').waitFor();
    const myRow = W.page.locator('[data-testid="reports-list"] a', { hasText: case1 });
    await until(async () => { await syncNow(W.page); await W.page.goto(`${BASE}/reports`); await W.page.locator('[data-testid="reports-list"]').waitFor(); return /Closed/.test(await myRow.innerText()); }, "worker sees Closed in My reports", 30000, 1500);
    check("4. worker sees the closure in My reports", true, (await myRow.innerText()).replace(/\n/g, " · "));
    await shot(W.page, "worker-my-reports-closed");
    assertClean(V.t, "4");
    assertClean(W.t, "4");

    /* ======================================================= 5. inspection: fail item → blocked until a draft action exists → sign → submit → report */
    const tpl = (await api(tok["SO-TN1"], "GET", `/inspections/templates?siteId=${sites.TN1}`)).data.find((t) => t.code === "T1");
    const qs = tpl.sections.flatMap((s) => s.questions);
    const failQ = qs.find((q) => q.actionOnFail && q.answerType === "pass_fail_na");
    await S.page.goto(`${BASE}/inspections`);
    await S.page.locator('[data-testid="start-inspection"]').click();
    await S.page.locator('[data-testid="tpl-T1"]').click();
    await S.page.locator('[data-testid="start-run"]').click();
    await S.page.waitForURL(/\/inspections\/runs\/[0-9a-f-]{36}$/);
    const runClientUuid = S.page.url().split("/").pop();
    await S.page.locator('[data-testid="header-next"]').click();
    for (let si = 0; si < tpl.sections.length; si++) {
      for (const q of tpl.sections[si].questions) {
        const card = S.page.locator(`[data-testid="q-${q.code}"]`);
        if (q.answerType !== "pass_fail_na") continue;
        if (q.id === failQ.id) {
          await card.locator('[data-testid="ans-fail"]').click();
          await card.locator('[data-testid="fail-follow"]').waitFor();
          if (q.photoOnFail) await attachPhoto(S.page, `FAIL ${q.code}`, `[data-testid="q-${q.code}"]`);
          if (q.noteOnFail) await card.locator("textarea").first().fill("West edge of level 3, 6 m drop, no toe board");
          await card.locator('[data-testid="remove-draft"]').click();
          await card.locator('[data-testid="draft-action"]').waitFor();
        } else {
          await card.locator('[data-testid="ans-pass"]').click();
        }
      }
      await S.page.locator('[data-testid="section-next"]').click();
    }
    await S.page.locator('[data-testid="run-submit"]').waitFor();
    await S.page.locator('[data-testid="missing-actions"]').waitFor();
    await S.page.locator('[data-testid="run-submit"]').click();
    await S.page.locator(".error-card").first().waitFor();
    check("5. submit blocked while the failed item has no action", /action/i.test(await S.page.locator(".error-card").first().innerText()));
    await shot(S.page, "inspection-blocked");
    // back to the failed question, add the draft action
    const failCard = S.page.locator(`[data-testid="q-${failQ.code}"]`);
    for (let i = 0; i < tpl.sections.length + 2 && !(await failCard.count()); i++) await S.page.locator(".row.between").getByRole("button", { name: /Back/ }).first().click();
    await failCard.locator('[data-testid="draft-action"]').click();
    await failCard.locator(".action-draft select").first().selectOption(ids["OWN-TN1-2"]);
    const interimField = failCard.locator(".action-draft").getByLabel(/^Interim control/);
    if (await interimField.count()) await interimField.fill("Edge barricaded with hard barrier");
    for (let i = 0; i < tpl.sections.length + 2 && !(await S.page.locator('[data-testid="run-submit"]').count()); i++) await S.page.locator('[data-testid="section-next"]').click();
    check("5. missing-action banner gone once the draft exists", (await S.page.locator('[data-testid="missing-actions"]').count()) === 0);
    const pad = await S.page.locator(".sig-pad").boundingBox();
    await S.page.mouse.move(pad.x + 20, pad.y + 40); await S.page.mouse.down(); await S.page.mouse.move(pad.x + 120, pad.y + 80, { steps: 8 }); await S.page.mouse.move(pad.x + 200, pad.y + 30, { steps: 8 }); await S.page.mouse.up();
    await shot(S.page, "inspection-signed");
    await S.page.locator('[data-testid="run-submit"]').click();
    await S.page.waitForURL(/\/inspections$/);
    const run = await until(async () => { const r = (await api(tok["SO-TN1"], "GET", `/inspections/runs?siteId=${sites.TN1}&mine=1&pageSize=200`)).data.items.find((x) => x.clientUuid === runClientUuid); return r && r.status === "completed" && r; }, "run completed", 40000);
    check("5. run submitted: action raised, score and result", run.actionsRaised === 1 && run.result === "fail" && run.scorePct !== null, `${run.caseNo} ${run.scorePct}% ${run.result}, actions ${run.actionsRaised}`);
    await S.page.goto(`${BASE}/inspections/runs/${run.id}`);
    await S.page.locator(".kpi").first().waitFor();
    // the phone's copy shows first, the server's detail (score, result) replaces it a moment later
    const kpiText = await until(async () => { const tx = await S.page.locator(".page").innerText(); return /\d%/.test(tx) && tx; }, "score on the run page", 20000).catch(async () => S.page.locator(".page").innerText());
    check("5. score and result shown on the run", (kpiText.includes(`${run.scorePct}%`) || kpiText.includes(`${Math.round(run.scorePct)}%`)) && /Fail/.test(kpiText), kpiText.match(/[\d.]+%/)?.[0]);
    await shot(S.page, "inspection-result");
    const [reportPage] = await Promise.all([S.ctx.waitForEvent("page"), S.page.getByRole("button", { name: /Report/ }).click()]);
    await reportPage.waitForURL(/\/api\/v1\/links\//); // the tab opens blank inside the click, then goes to the signed link
    await reportPage.waitForLoadState();
    const reportUrl = reportPage.url();
    check("5. report opens via the signed link (no token in the URL)", /\/api\/v1\/links\/inspection-runs\/.+\/report\?t=/.test(reportUrl) && !reportUrl.includes(tok["SO-TN1"]) && !/access_token/.test(reportUrl) && (await reportPage.content()).includes(run.caseNo), reportUrl.replace(/t=[^&]+/, "t=…"));
    await reportPage.screenshot({ path: path.join(SHOTS, `${String(++shotN).padStart(2, "0")}-inspection-report.png`) });
    await reportPage.close();
    assertClean(S.t, "5");

    /* ======================================================= 6. QR form without login, in Tamil */
    const qrToken = sql("select q.token from qr_codes q join areas a on a.id = q.target_id where q.target_type = 'area' and q.active and a.site_id = $1::uuid order by a.sort limit 1", [sites.TN1])[0].token;
    const Q = await newContext(browser, "QR (no login)", true);
    await Q.page.goto(`${BASE}/q/${qrToken}`);
    await Q.page.locator('[data-testid="lang-ta"]').click();
    await Q.page.locator('[data-testid="type-unsafe_condition"]').waitFor();
    const heading = await Q.page.locator(".topbar h1").innerText();
    check("6. QR form switched to Tamil", /[஀-௿]/.test(heading), heading);
    await Q.page.locator('[data-testid="type-unsafe_condition"]').click();
    await attachPhoto(Q.page, "QR PHOTO");
    await Q.page.locator('[data-testid="description"]').fill("கடையில் மின் கம்பி வெட்டப்பட்டுள்ளது");
    await shot(Q.page, "qr-form-tamil");
    await Q.page.locator('[data-testid="submit"]').click();
    const qrCase = await until(async () => { const s = await Q.page.locator('[data-testid="case-no"]').innerText(); return /TN1-OBS-2026-\d{5}/.test(s) && s.match(/TN1-OBS-2026-\d{5}/)[0]; }, "QR case number");
    check("6. QR submit returns a case number", true, qrCase);
    await shot(Q.page, "qr-submitted");
    const statusHref = await Q.page.locator('a[href*="/q/status/"]').first().getAttribute("href");
    await Q.page.goto(new URL(statusHref, BASE).toString());
    await Q.page.locator(".timeline").waitFor();
    check("6. status link opens the public status page", (await Q.page.locator("body").innerText()).includes(qrCase));
    await shot(Q.page, "qr-status");
    const qrObs = sql("select channel, reporter_user_id, (select count(*) from media m where m.owner_id = o.id and m.upload_status <> 'pending' and m.hash_match)::int as photos from observations o where case_no = $1", [qrCase])[0];
    check("6. QR report stored anonymous with its photo", qrObs.channel === "qr" && qrObs.reporter_user_id === null && qrObs.photos === 1, JSON.stringify(qrObs));
    assertClean(Q.t, "6");

    /* ======================================================= 7. admin console */
    const A = await newContext(browser, "ADMIN01", false);
    const P = A.page;
    await P.goto(`${BASE}/admin/`);
    await label(P, "Employee code or email").fill("ADMIN01");
    await label(P, "Password").fill(ADMIN_PW);
    await P.getByRole("button", { name: "Sign in" }).click();
    await P.locator(".qr-box svg").waitFor();
    const secret = (await P.locator(".copyable code, code.mono-sm").first().innerText()).trim();
    check("7. MFA enrolment shows the QR and the secret", /^[A-Z2-7]{16,}$/.test(secret), secret.replace(/.{6}$/, "******"));
    secrets.ADMIN01 = secret;
    await shot(P, "admin-mfa-enrol");
    await label(P, "Code from the app").fill(await freshTotp("ADMIN01", secret));
    await P.getByRole("button", { name: /Confirm|Turn on|Verify/ }).click();
    await P.locator(".rail").waitFor();
    check("7. ADMIN01 signed in with TOTP (RFC 6238)", true);
    await P.locator(".kpis .kpi .v").first().waitFor();
    const kpis = await P.locator(".kpis .kpi").count();
    check("7. dashboard KPIs", kpis >= 6, `${kpis} KPI tiles`);
    await shot(P, "admin-dashboard");
    await P.getByRole("link", { name: /Attention/ }).first().click();
    await P.locator(".attention .card").first().waitFor();
    check("7. attention board", (await P.locator(".attention .card").count()) >= 3, `${await P.locator(".attention .card").count()} cards`);
    await shot(P, "admin-attention");
    // site wizard → food industry
    await P.goto(`${BASE}/admin/sites`);
    await P.getByRole("button", { name: "New site" }).first().click();
    await label(P, "Site name").fill("Hosur Dairy Plant");
    await label(P, "Code").fill("TN7");
    await label(P, "District").fill("Krishnagiri");
    await P.getByRole("button", { name: /^Next/ }).click();
    await P.locator('[data-industry="food"]').click();
    await shot(P, "admin-wizard-industry");
    await P.getByRole("button", { name: /^Next/ }).click();
    await P.getByTestId("create-site").click();
    await P.locator(".poster-list .pr").first().waitFor();
    const posters = await P.locator(".poster-list .pr").count();
    const tn7 = sql("select id::text, industry_code from sites where code = 'TN7'")[0];
    const tn7Areas = sql("select count(*)::int as n from areas where site_id = $1::uuid", [tn7.id])[0].n;
    check("7. site wizard created TN7 for industry food with a poster per area + site", tn7.industry_code === "food" && posters === tn7Areas + 1 && tn7Areas >= 8, `${tn7Areas} areas, ${posters} posters`);
    const coldStore = sql("select area_type from areas where site_id = $1::uuid and code = 'COLD'", [tn7.id])[0];
    check("7. default areas keep their codes and types", coldStore && coldStore.area_type === "utilities");
    await shot(P, "admin-wizard-posters");
    const [poster] = await Promise.all([A.ctx.waitForEvent("page"), P.locator(".poster-list .pr").nth(1).getByRole("button", { name: /Print poster/ }).click()]);
    await poster.waitForURL(/\/api\/v1\/links\//);
    await poster.waitForLoadState();
    const posterUrl = poster.url();
    check("7. poster opens in a new tab through the signed link (no bearer token)", /\/api\/v1\/links\/qr-codes\/.+\/poster\?t=/.test(posterUrl) && !/access_token|Bearer/.test(posterUrl) && (await poster.content()).includes("Scan to report in 30 seconds"), posterUrl.replace(/t=[^&]+/, "t=…"));
    await poster.screenshot({ path: path.join(SHOTS, `${String(++shotN).padStart(2, "0")}-admin-poster.png`) });
    await poster.close();
    // users CSV import (3 users)
    await P.goto(`${BASE}/admin/users`);
    await P.locator("tbody tr").first().waitFor();
    await P.getByRole("button", { name: "Import CSV" }).first().click();
    await label(P, "Or paste CSV").fill("name,employee_code,email,language,employer,trade,phone,role,site_code\nPriya Rao,E2001,,ta,,,9876501234,reporter,TN7\nKarthik Iyer,E2002,karthik.i@example.in,en,,,,site_safety_officer,TN7\nMeena Pillai,E2003,,kn,,,,action_owner,TN7");
    await P.getByText("All rows valid").waitFor();
    await P.getByRole("button", { name: "Import 3 rows" }).click();
    await P.getByText("Import finished").waitFor();
    const imported = sql("select count(*)::int as n from users where employee_code in ('E2001','E2002','E2003')")[0].n;
    check("7. users CSV import of 3 users", imported === 3 && (await P.locator(".secret code").count()) === 1, `${imported} users; one-time passwords shown once`);
    await shot(P, "admin-users-import");
    await P.keyboard.press("Escape");
    // template copy + a question with action-on-fail → submit for review
    await P.goto(`${BASE}/admin/templates`);
    await P.locator("tbody tr", { hasText: "T1" }).first().waitFor();
    await P.locator("tbody tr", { hasText: "T1" }).first().getByTitle("Duplicate").click();
    await label(P, "Code").fill("T1-TN7");
    await P.locator(".sheet").getByRole("button", { name: "Duplicate" }).click();
    await P.locator(".builder").waitFor();
    const before = await P.locator(".builder .q").count();
    await P.getByTestId("add-question").first().click();
    const newQ = P.locator(".builder .q").nth(before);
    await newQ.locator(".qtitle input").fill("Ammonia detector bump-tested this week");
    const aof = newQ.locator(".q-editor .toggle", { hasText: "Action on fail" }).locator("[role=switch]");
    if ((await aof.getAttribute("aria-checked")) !== "true") await aof.click();
    await P.getByTestId("save-template").click();
    await P.getByText("All changes saved").waitFor();
    await P.getByRole("button", { name: "Submit for review" }).click();
    await P.locator(".pill", { hasText: "In review" }).first().waitFor();
    const copied = sql(`select v.id::text, v.status, (select count(*) from inspection_questions q join inspection_sections s on s.id = q.section_id where s.version_id = v.id and q.action_on_fail and q.text_i18n->>'en' like 'Ammonia detector%')::int as aof
                          from inspection_template_versions v join inspection_templates t on t.id = v.template_id where t.code = 'T1-TN7'`)[0];
    check("7. template copied, question with action-on-fail added, submitted for review", copied.status === "in_review" && copied.aof === 1, JSON.stringify(copied));
    await shot(P, "admin-template-in-review");
    // approve as HSE01 (another person; MFA too)
    const H = await newContext(browser, "HSE01", false);
    await H.page.goto(`${BASE}/admin/`);
    await label(H.page, "Employee code or email").fill("HSE01");
    await label(H.page, "Password").fill(DEMO_PW);
    await H.page.getByRole("button", { name: "Sign in" }).click();
    await H.page.locator(".qr-box svg").waitFor();
    secrets.HSE01 = (await H.page.locator(".copyable code, code.mono-sm").first().innerText()).trim();
    await label(H.page, "Code from the app").fill(await freshTotp("HSE01", secrets.HSE01));
    await H.page.getByRole("button", { name: /Confirm|Turn on|Verify/ }).click();
    await H.page.locator(".rail").waitFor();
    const tplId = sql("select id::text from inspection_templates where code = 'T1-TN7'")[0].id;
    await H.page.goto(`${BASE}/admin/templates/${tplId}`);
    await H.page.getByRole("button", { name: "Approve" }).click();
    await H.page.locator(".pill", { hasText: "Active" }).first().waitFor();
    const approved = sql("select v.status, coalesce(p.full_name, u.employee_code) as approver from inspection_template_versions v join users u on u.id = v.approved_by left join people p on p.id = u.person_id where v.id = $1::uuid", [copied.id])[0];
    check("7. approved by HSE01 (approver ≠ author)", approved.status === "active", JSON.stringify(approved));
    await H.page.screenshot({ path: path.join(SHOTS, `${String(++shotN).padStart(2, "0")}-hse-approved.png`) });
    assertClean(H.t, "7 (HSE01)");
    // audit chain verify
    await P.goto(`${BASE}/admin/audit-log`);
    await P.locator("tbody tr").first().waitFor();
    await P.getByRole("button", { name: "Verify chain" }).click();
    await P.getByText(/Chain intact/).waitFor();
    check("7. audit-log chain verified", true, await P.getByText(/Chain intact/).innerText());
    await shot(P, "admin-audit-verify");
    // reconciled screens save through the real routes
    await P.goto(`${BASE}/admin/sites/${tn7.id}`);
    await label(P, "District").fill("Krishnagiri (Hosur)");
    await P.locator(".sticky-foot").getByRole("button", { name: "Save" }).click();
    await P.locator(".toast.success").last().waitFor();
    check("7. site details saved (the loaded record is PUT back)", sql("select district from sites where id = $1::uuid", [tn7.id])[0].district === "Krishnagiri (Hosur)");
    await P.goto(`${BASE}/admin/sites/${tn7.id}/equipment`);
    await P.getByRole("button", { name: "Import CSV" }).first().click();
    await label(P, "Or paste CSV").fill("tag_no,asset_class,make_model,serial_no,swl_kg,area_code,next_exam_due\nCR-01,lifting_appliance,ACE 14XW,SN1234,14000,STORE,2027-03-31\nFE-07,extinguisher,ABC 6 kg,FE7781,,COLD,2027-01-15");
    await P.getByRole("button", { name: /^Import 2 rows$/ }).click();
    await P.getByText("Import finished").waitFor();
    const cr01 = sql("select next_exam_due::text as due, (select code from areas where id = area_id) as area from assets where site_id = $1::uuid and tag_no = 'CR-01'", [tn7.id])[0];
    check("7. equipment CSV import into the site on screen (siteId + next exam date)", cr01 && cr01.due === "2027-03-31" && cr01.area === "STORE", JSON.stringify(cr01));
    await P.keyboard.press("Escape");
    await P.goto(`${BASE}/admin/settings`);
    await label(P, "Daily push cap").fill("6");
    await P.locator(".sticky-foot").getByRole("button", { name: "Save" }).click();
    await P.locator(".toast.success").last().waitFor();
    const orgSettings = JSON.parse(sql("select settings::text as s from organisations limit 1")[0].s);
    check("7. settings saved; organisation fields stay out of settings", orgSettings.dailyPushCap === 6 && !("orgName" in orgSettings) && !("legalName" in orgSettings), `cap ${orgSettings.dailyPushCap}`);
    await P.goto(`${BASE}/admin/retention`);
    await P.getByRole("button", { name: "Run dry run" }).click();
    await P.getByText("Dry-run report").waitFor();
    await P.getByRole("button", { name: "New hold" }).click();
    await P.locator(".sheet textarea").first().waitFor();
    await sleep(400);
    await label(P, "Reason").fill("Labour court claim, case 114 of 2026");
    await P.getByRole("button", { name: "Place hold" }).click();
    await P.locator(".list-compact .li", { hasText: "Labour court claim" }).waitFor();
    check("7. retention dry run and a legal hold", sql("select count(*)::int as n from legal_holds")[0].n === 1);
    await shot(P, "admin-retention");
    await P.goto(`${BASE}/admin/privacy`);
    await P.getByRole("button", { name: "Log a request" }).click();
    await P.locator(".sheet input").first().waitFor();
    await sleep(400); // the sheet slides in
    await label(P, "Requester").fill("Selvi R");
    await label(P, "Employee id or mobile").fill("••••1234");
    await P.locator(".sheet").getByRole("button", { name: "Save" }).click();
    await P.locator("tbody tr", { hasText: "Selvi R" }).waitFor();
    check("7. privacy request logged", sql("select count(*)::int as n from privacy_requests where person_name = 'Selvi R'")[0].n === 1);
    // every console page loads without errors (the admin can open all of them)
    for (const route of ["observations", "actions", "inspections", "sites", `sites/${tn7.id}/areas`, `sites/${tn7.id}/qr`, "equipment", "qr", "people", "contractors", "users", "categories", "risk-matrix", "due-dates", "rule-sets", "templates", "schedules", "languages", "notifications-log", "privacy", "retention", "settings", "health"]) {
      // in-app navigation like a person clicking the rail (a full reload per page would only measure the test)
      const link = P.locator(`.rail a[href="/admin/${route}"]`);
      if (await link.count()) await link.first().click(); else await P.goto(`${BASE}/admin/${route}`);
      await P.waitForURL(new RegExp(`/admin/${route.replace(/[/]/g, "\\/")}$`));
      await P.locator(".ph h1, .tabs").first().waitFor();
      await P.waitForLoadState("networkidle");
    }
    assertClean(A.t, "7 (every console page)");
    check("7. every console page opened", true);
    // Hindi and back
    await P.goto(`${BASE}/admin/`);
    await P.locator(".kpis .kpi").first().waitFor();
    const langSel = P.locator(".console-top select").filter({ has: P.locator('option[value="hi"]') }).first();
    await langSel.selectOption("hi");
    await P.locator(".rail").getByText("डैशबोर्ड").waitFor();
    await shot(P, "admin-hindi");
    await langSel.selectOption("en");
    await P.locator(".rail").getByText("Dashboard", { exact: true }).waitFor();
    check("7. language switched to Hindi and back", true);
    assertClean(A.t, "7");

    /* ======================================================= 8. site scope */
    const ka1Obs = sql("select id::text from observations where site_id = $1::uuid limit 1", [sites.KA1])[0].id;
    const scoped = await api(tok["SO-TN1"], "GET", `/observations/${ka1Obs}`);
    check("8. SO-TN1 cannot fetch a KA1 observation (404)", scoped.status === 404, JSON.stringify(scoped.data));

    /* ======================================================= 9. the field app's other sync ops and REST calls, with the exact bodies it builds */
    const now = () => new Date().toISOString();
    const push = async (token, entityType, op, payload) => {
      const commandId = crypto.randomUUID();
      const r = await api(token, "POST", "/sync/push", { deviceId: `e2e-contract-${entityType}`, appVersion: "2.0.0", commands: [{ commandId, seq: 1, entityType, op, payload, capturedAt: now() }] });
      return r.data.results?.[0] ?? { status: `http ${r.status}`, error: r.data };
    };
    const act2 = (await api(tok["SO-TN1"], "GET", `/observations/${obs2.id}`)).data.actions[0];
    const ops = [
      ["observation.comment", await push(tok["SO-TN1"], "observation", "comment", { observationId: obs1.id, clientUuid: crypto.randomUUID(), body: "Checked on the evening walk", capturedAt: now() })],
      ["observation.ack_critical", await push(tok["SO-TN1"], "observation", "ack_critical", { observationId: obs2.id, capturedAt: now() })],
      ["action.start", await push(tok["OWN-TN1-1"], "action", "start", { actionId: act2.id, capturedAt: now() })],
      ["action.comment", await push(tok["OWN-TN1-1"], "action", "comment", { actionId: act2.id, clientUuid: crypto.randomUUID(), body: "Lifelines ordered", media: [], capturedAt: now() })],
      ["action.request date_change", await push(tok["OWN-TN1-1"], "action", "request", { actionId: act2.id, clientUuid: crypto.randomUUID(), type: "date_change", proposedDueAt: new Date(Date.now() + 5 * 86400000).toISOString(), reasonCode: "material", reason: "Lifeline kit arrives Friday", capturedAt: now() })],
    ];
    for (const [name, r] of ops) check(`9. sync ${name} applied`, r.status === "applied", JSON.stringify(r.error ?? r.status));
    let a2 = (await api(tok["SO-TN1"], "GET", `/actions/${act2.id}`)).data;
    const req1 = a2.requests.find((r) => r.status === "pending");
    const dec1 = await api(tok["SO-TN1"], "POST", `/actions/${act2.id}/requests/${req1.id}/decide`, { decision: "approved", note: "Agreed", newDueAt: req1.proposedDueAt });
    check("9. REST decide date change (approved)", dec1.status === 200 && dec1.data.dueAt === req1.proposedDueAt, dec1.data.error);
    const disp = await push(tok["OWN-TN1-1"], "action", "request", { actionId: act2.id, clientUuid: crypto.randomUUID(), type: "dispute", reasonCode: "not_mine", reason: "Scaffold contractor owns lifelines", capturedAt: now() });
    check("9. sync action.request dispute applied", disp.status === "applied", JSON.stringify(disp.error ?? ""));
    a2 = (await api(tok["SO-TN1"], "GET", `/actions/${act2.id}`)).data;
    const req2 = a2.requests.find((r) => r.status === "pending" && r.type === "dispute");
    const noOwner = await api(tok["SO-TN1"], "POST", `/actions/${act2.id}/requests/${req2.id}/decide`, { decision: "approved" });
    check("9. approving a dispute without a new owner is refused", noOwner.status === 400, noOwner.data.error);
    const dec2 = await api(tok["SO-TN1"], "POST", `/actions/${act2.id}/requests/${req2.id}/decide`, { decision: "approved", newOwnerUserId: ids["OWN-TN1-2"] });
    check("9. approved dispute reassigns to the new owner", dec2.status === 200 && dec2.data.ownerUserId === ids["OWN-TN1-2"] && dec2.data.status === "open", `${dec2.data.status}`);
    const re = await api(tok["SO-TN1"], "POST", `/actions/${act2.id}/reassign`, { newOwnerUserId: ids["OWN-TN1-3"], reason: "OWN-TN1-2 on leave" });
    check("9. REST reassign", re.status === 200 && re.data.ownerUserId === ids["OWN-TN1-3"], re.data.error);
    const cancel = await api(tok["SO-TN1"], "POST", `/actions/${act2.id}/cancel`, { reason: "Scaffold dismantled", approvedByUserId: ids["SH-TN1"] });
    check("9. REST cancel with site-head approval", cancel.status === 200 && cancel.data.status === "cancelled", cancel.data.error);
    const notes = (await api(tok["OWN-TN1-1"], "GET", "/me/notifications?unread=1")).data;
    if (notes.items?.length) check("9. REST notification read", (await api(tok["OWN-TN1-1"], "POST", `/me/notifications/${notes.items[0].id}/read`)).status === 200);
    check("9. REST read-all", (await api(tok["OWN-TN1-1"], "POST", "/me/notifications/read-all")).status === 200);
    const prefs = await api(tok["OWN-TN1-1"], "PUT", "/me/preferences", { language: "en", digest: "weekly", quietHours: false });
    check("9. preferences saved and returned on Me", prefs.status === 200 && prefs.data.preferences.digest === "weekly" && prefs.data.preferences.quietHours === false);
    const dev = await api(tok["OWN-TN1-1"], "POST", "/me/devices", { deviceUuid: "e2e-device-1", platform: "web", appVersion: "2.0.0", subscription: { endpoint: "https://push.example.invalid/sub/1", keys: { p256dh: "BNc", auth: "x" } } });
    check("9. push subscription registered", dev.status === 200);

    for (const t of trackers) assertClean(t, "end");
    const passed = results.filter((r) => r.ok).length;
    console.log(`\nALL PASSED: ${passed}/${results.length} checks in ${Math.round((Date.now() - t0) / 1000)} s; screenshots in ${SHOTS}`);
    fs.writeFileSync(path.join(SCRATCH, "e2e-real-results.json"), JSON.stringify({ base: BASE, results }, null, 2));
    process.exitCode = 0;
  } catch (e) {
    console.error(`\nFAILED: ${e.stack || e}`);
    if (browser) for (const c of browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: path.join(SHOTS, `failure-${crypto.randomUUID().slice(0, 6)}.png`) }).catch(() => {});
    for (const t of trackers) if (t.errors.length) console.error(`[${t.label}] ${t.errors.join("\n  ")}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill("SIGTERM");
  }
})();
