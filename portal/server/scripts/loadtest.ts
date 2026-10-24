/**
 * Load test: N people on one site using SafeWorks at the same time.
 *
 *   BASE_URL=https://safeworks.example.in ADMIN_ID=ADMIN01 ADMIN_PASSWORD=… USERS=100 DURATION=1800 npm run loadtest
 *
 * Options: SITES=10 spreads the users over 10 sites (scale gate: 1,000 users across 10 sites); RAMP=60 spreads sign-ins over 60 s.
 * Setup (through the admin API, so it works against any deployment):
 *   - creates sites LT01… "Load test site n" if missing; per site up to 5 safety officers, the rest supervisors (LT-LT01-SO-n / LT-LT01-SUP-n)
 *   - each virtual user signs in and replaces the temporary password, like a real first login
 * Scenario (repeats until DURATION seconds):
 *   - safety officers: dashboard → raise a point with 2 photos (~0.9 MB) assigned to a supervisor → open lists → approve closures
 *   - supervisors: dashboard → my open points → open one → submit closure with 1 photo → notifications
 * Then a resilience check: uploads cut off mid-way and retried with the same ID must give exactly one point each.
 * Pass mark (from the structure document): < 0.1% failed requests, 95% of screens < 2 s, a 2-photo upload < 10 s, no lost or duplicate points.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL || "http://localhost:8080").replace(/\/$/, "");
const USERS = Number(process.env.USERS || 100);
const DURATION = Number(process.env.DURATION || 180) * 1000;
const ADMIN_ID = process.env.ADMIN_ID || "ADMIN01";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SITES = Math.max(1, Number(process.env.SITES || 1));
const RAMP = Number(process.env.RAMP || 10) * 1000;
const PER_SITE = Math.ceil(USERS / SITES);
const OFFICERS = Math.min(5, Math.max(1, Math.round(PER_SITE / 20)));
const siteCode = (i: number) => `LT${String(i + 1).padStart(2, "0")}`;
const PASSWORD = "LoadTest2026";
const REPORT = process.env.REPORT || path.join(process.cwd(), `loadtest-report-${Date.now()}.json`);
const photos = [fs.readFileSync(path.join(here, "..", "test", "fixtures", "photo-1.jpg")), fs.readFileSync(path.join(here, "..", "test", "fixtures", "photo-2.jpg"))];

type Sample = { label: string; ms: number; ok: boolean; status: number };
const samples: Sample[] = [];
const errors: Record<string, number> = {};

// A second officer approving the same closure a moment later gets 409: correct behaviour, not a failure.
const EXPECTED: Record<string, number[]> = { "approve closure": [409] };
let expectedConflicts = 0;

async function req(label: string, token: string | null, method: string, p: string, body?: unknown, form?: FormData): Promise<any> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload: any;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const t0 = performance.now();
  let status = 0;
  try {
    const res = await fetch(BASE + p, { method, headers, body: payload });
    status = res.status;
    const text = await res.text();
    const ms = performance.now() - t0;
    const expected = !res.ok && (EXPECTED[label] ?? []).includes(res.status);
    if (expected) expectedConflicts++;
    const ok = res.ok || expected;
    samples.push({ label, ms, ok, status });
    if (!ok) {
      const k = `${label} → ${status} ${text.slice(0, 120)}`;
      errors[k] = (errors[k] ?? 0) + 1;
      return null;
    }
    return text ? JSON.parse(text) : null;
  } catch (e: any) {
    samples.push({ label, ms: performance.now() - t0, ok: false, status });
    const k = `${label} → network ${e?.cause?.code ?? e?.message}`;
    errors[k] = (errors[k] ?? 0) + 1;
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const think = (a: number, b: number) => sleep(a + Math.random() * (b - a));
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

async function setup() {
  if (!ADMIN_PASSWORD) throw new Error("Set ADMIN_PASSWORD (and ADMIN_ID) of an admin login.");
  const login = await req("setup", null, "POST", "/api/auth/login", { employeeId: ADMIN_ID, password: ADMIN_PASSWORD, app: "admin" });
  if (!login) throw new Error("Admin login failed: " + JSON.stringify(errors));
  const at = login.token as string;
  const existingSites = (await req("setup", at, "GET", "/api/admin/sites")).sites as any[];
  const siteIds: string[] = [];
  for (let k = 0; k < SITES; k++) {
    let site = existingSites.find((x: any) => x.code === siteCode(k));
    if (!site) {
      const c = await req("setup", at, "POST", "/api/admin/sites", { code: siteCode(k), name: `Load test site ${k + 1}`, siteType: "construction", state: k % 2 ? "Tamil Nadu" : "Karnataka" });
      site = { id: c.id };
      for (const a of ["Block A", "Block B", "Yard"]) await req("setup", at, "POST", `/api/admin/sites/${site.id}/areas`, { name: a });
    }
    siteIds.push(site.id);
  }
  const have = new Set(((await req("setup", at, "GET", `/api/admin/users?q=LT-&pageSize=500&status=all`))?.users ?? []).map((u: any) => u.employeeId));
  const lines = ["employee_id,name,designation,role,site_code"];
  const users: { emp: string; role: "so" | "sup"; site: number }[] = [];
  for (let i = 0; i < USERS; i++) {
    const k = Math.floor(i / PER_SITE);
    const j = i % PER_SITE;
    const so = j < OFFICERS;
    const emp = so ? `LT-${siteCode(k)}-SO-${j + 1}` : `LT-${siteCode(k)}-SUP-${j - OFFICERS + 1}`;
    users.push({ emp, role: so ? "so" : "sup", site: k });
    if (!have.has(emp)) lines.push(`${emp},Load ${so ? "Officer" : "Supervisor"} ${i + 1},${so ? "Safety Officer" : "Supervisor"},${so ? "safety officer" : "supervisor"},${siteCode(k)}`);
  }
  const temp = new Map<string, string>();
  for (let i = 1; i < lines.length; i += 400) {
    const chunk = [lines[0], ...lines.slice(i, i + 400)];
    const imp = await req("setup", at, "POST", "/api/admin/users/import", { csv: chunk.join("\n") });
    if (!imp || imp.errors?.length) throw new Error("Import failed: " + JSON.stringify(imp?.errors ?? errors));
    for (const c of imp.created) temp.set(c.employeeId, c.tempPassword);
  }
  // Existing load-test users: reset to a known password so the run is repeatable.
  const all: any[] = [];
  for (let page = 1; ; page++) {
    const r = await req("setup", at, "GET", `/api/admin/users?q=LT-&pageSize=500&page=${page}`);
    all.push(...(r?.users ?? []));
    if (!r || all.length >= r.total) break;
  }
  for (const u of all) {
    if (!users.some((x) => x.emp === u.employeeId)) continue;
    if (!temp.has(u.employeeId)) {
      await req("setup", at, "POST", `/api/admin/users/${u.id}/password`, { mode: "set", password: PASSWORD, mustChange: false });
      if (u.locked) await req("setup", at, "POST", `/api/admin/users/${u.id}/unlock`);
    }
  }
  samples.length = 0;
  for (const k of Object.keys(errors)) delete errors[k];
  return { siteIds, users, temp };
}

interface VU {
  emp: string;
  role: "so" | "sup";
  site: number;
  token: string;
}

async function signIn(u: { emp: string; role: "so" | "sup"; site: number }, temp: Map<string, string>): Promise<VU | null> {
  const pw = temp.get(u.emp) ?? PASSWORD;
  const r = await req("login", null, "POST", "/api/auth/login", { employeeId: u.emp, password: pw, app: "portal" });
  if (!r) return null;
  if (r.mustChangePassword) {
    await req("change password", r.token, "POST", "/api/auth/change-password", { currentPassword: pw, newPassword: PASSWORD });
  }
  return { ...u, token: r.token };
}

const created: string[] = [];

async function officer(v: VU, siteId: string, owners: string[], end: number) {
  await req("home dashboard", v.token, "GET", "/api/dashboard/me");
  await req("sites + master", v.token, "GET", "/api/sites");
  await req("sites + master", v.token, "GET", "/api/master");
  while (Date.now() < end) {
    const id = crypto.randomUUID();
    const f = new FormData();
    f.append(
      "data",
      JSON.stringify({
        id, siteId, type: pick(["unsafe_condition", "unsafe_act"]), categoryCode: "C02", itemCode: "C02-01", hazard: "Fall from height",
        personObserved: "Fitter – contractor", severity: 1 + Math.floor(Math.random() * 4), likelihood: 1 + Math.floor(Math.random() * 5),
        description: "Load test point: guardrail missing at slab edge.", immediateAction: "Barricaded / tagged out", rootCause: "Procedure or supervision",
        correctiveAction: "Fix guardrail.", ownerId: pick(owners),
      }),
    );
    f.append("photos", new Blob([photos[0]], { type: "image/jpeg" }), "p1.jpg");
    f.append("photos", new Blob([photos[1]], { type: "image/jpeg" }), "p2.jpg");
    const o = await req("raise point (2 photos)", v.token, "POST", "/api/observations", undefined, f);
    if (o) created.push(o.id);
    await think(800, 2500);
    await req("observation list", v.token, "GET", "/api/observations?status=open&pageSize=50");
    if (o) await req("observation detail", v.token, "GET", `/api/observations/${o.id}`);
    await think(800, 2500);
    const q = await req("approval queue", v.token, "GET", "/api/observations?scope=approvals&status=awaiting&pageSize=20");
    for (const it of (q?.items ?? []).slice(0, 2)) {
      await req("observation detail", v.token, "GET", `/api/observations/${it.id}`);
      await req("approve closure", v.token, "POST", `/api/observations/${it.id}/decision`, { decision: "approve", remarks: "Verified" });
    }
    await req("home dashboard", v.token, "GET", "/api/dashboard/me");
    await think(1500, 4000);
  }
}

async function supervisor(v: VU, end: number) {
  await req("home dashboard", v.token, "GET", "/api/dashboard/me");
  await req("sites + master", v.token, "GET", "/api/sites");
  while (Date.now() < end) {
    const list = await req("my points", v.token, "GET", "/api/observations?scope=assigned&status=open&pageSize=50");
    await think(1500, 5000);
    const it = list?.items?.[0];
    if (it) {
      await req("observation detail", v.token, "GET", `/api/observations/${it.id}`);
      await think(1000, 4000);
      if (Math.random() < 0.6) {
        const f = new FormData();
        f.append("data", JSON.stringify({ comment: "Fixed during load test." }));
        f.append("photos", new Blob([photos[1]], { type: "image/jpeg" }), "after.jpg");
        await req("submit closure (1 photo)", v.token, "POST", `/api/observations/${it.id}/closure`, undefined, f);
      }
    }
    await req("notifications", v.token, "GET", "/api/notifications");
    await req("home dashboard", v.token, "GET", "/api/dashboard/me");
    await think(3000, 9000);
  }
}

/** Cut uploads off mid-way, then retry with the same ID; each must end up as exactly one point. */
async function resilience(v: VU, siteId: string, owners: string[]): Promise<{ tried: number; ok: number; duplicates: number; lost: number }> {
  let ok = 0, dup = 0, lost = 0;
  const N = 10;
  for (let i = 0; i < N; i++) {
    const id = crypto.randomUUID();
    const data = JSON.stringify({
      id, siteId, type: "unsafe_condition", categoryCode: "C02", itemCode: "C02-01", hazard: "Fall from height", severity: 2, likelihood: 2,
      description: "Resilience check point.", immediateAction: "Barricaded / tagged out", rootCause: "Procedure or supervision", correctiveAction: "Fix.", ownerId: pick(owners),
    });
    const make = () => {
      const f = new FormData();
      f.append("data", data);
      f.append("photos", new Blob([photos[0]], { type: "image/jpeg" }), "p1.jpg");
      f.append("photos", new Blob([photos[1]], { type: "image/jpeg" }), "p2.jpg");
      return f;
    };
    const ac = new AbortController();
    const cut = setTimeout(() => ac.abort(), 5 + Math.random() * 40);
    try {
      await fetch(`${BASE}/api/observations`, { method: "POST", headers: { authorization: `Bearer ${v.token}` }, body: make(), signal: ac.signal });
    } catch {
      /* connection dropped on purpose */
    }
    clearTimeout(cut);
    // The phone retries from its queue, sometimes twice.
    const first = await fetch(`${BASE}/api/observations`, { method: "POST", headers: { authorization: `Bearer ${v.token}` }, body: make() });
    const second = await fetch(`${BASE}/api/observations`, { method: "POST", headers: { authorization: `Bearer ${v.token}` }, body: make() });
    const a = first.ok ? await first.json() : null;
    const b = second.ok ? await second.json() : null;
    if (!a || !b) lost++;
    else if (a.code !== b.code || a.id !== id) dup++;
    else ok++;
    const list = await req("resilience check", v.token, "GET", `/api/observations?q=${encodeURIComponent(a?.code ?? "x")}&status=any`);
    if (list && list.total !== 1) dup++;
  }
  return { tried: N, ok, duplicates: dup, lost };
}

function pctl(xs: number[], p: number) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function main() {
  console.log(`SafeWorks load test → ${BASE}: ${USERS} users on ${SITES} site(s) (${OFFICERS} safety officers per site) for ${DURATION / 1000}s, sign-in spread over ${RAMP / 1000}s`);
  const { siteIds, users, temp } = await setup();
  const t0 = Date.now();
  // Shift-start rush: everyone signs in within ~10 seconds.
  const vus = (
    await Promise.all(
      users.map(async (u, i) => {
        await sleep((i / users.length) * RAMP);
        return signIn(u, temp);
      }),
    )
  ).filter((x): x is VU => !!x);
  const loginMs = Date.now() - t0;
  console.log(`  ${vus.length}/${users.length} signed in within ${(loginMs / 1000).toFixed(1)}s`);
  const ownersBySite: string[][] = [];
  for (let k = 0; k < SITES; k++) {
    const v = vus.find((x) => x.site === k)!;
    const sites = await req("sites + master", v.token, "GET", "/api/sites");
    const site = sites.sites.find((x: any) => x.id === siteIds[k]);
    ownersBySite.push(site.owners.filter((o: any) => o.role === "supervisor").map((o: any) => o.id));
  }
  const end = Date.now() + DURATION;
  const ticker = setInterval(() => {
    const last = samples.filter((s) => s.ms >= 0);
    process.stdout.write(`  … ${Math.round((Date.now() - t0) / 1000)}s, ${last.length} requests, ${last.filter((s) => !s.ok).length} failed\n`);
  }, 30_000);
  await Promise.all(vus.map((v) => (v.role === "so" ? officer(v, siteIds[v.site], ownersBySite[v.site], end) : supervisor(v, end))));
  clearInterval(ticker);
  const res = await resilience(vus.find((v) => v.role === "so" && v.site === 0)!, siteIds[0], ownersBySite[0]);
  const elapsed = (Date.now() - t0) / 1000;

  const labels = [...new Set(samples.map((s) => s.label))];
  const rows = labels.map((l) => {
    const xs = samples.filter((s) => s.label === l);
    const ms = xs.map((s) => s.ms);
    return { label: l, count: xs.length, failed: xs.filter((s) => !s.ok).length, p50: Math.round(pctl(ms, 50)), p95: Math.round(pctl(ms, 95)), p99: Math.round(pctl(ms, 99)), max: Math.round(Math.max(...ms)) };
  });
  const total = samples.length;
  const failed = samples.filter((s) => !s.ok).length;
  const screens = samples.filter((s) => !s.label.includes("photo") && s.label !== "login" && s.label !== "change password");
  const screensP95 = pctl(screens.map((s) => s.ms), 95);
  const uploadP95 = pctl(samples.filter((s) => s.label === "raise point (2 photos)").map((s) => s.ms), 95);
  const checks = [
    { check: "Failed requests under 0.1%", value: `${((failed / Math.max(total, 1)) * 100).toFixed(3)}% (${failed} of ${total})`, pass: failed / Math.max(total, 1) < 0.001 },
    { check: "95% of screens open in under 2 s", value: `p95 ${Math.round(screensP95)} ms`, pass: screensP95 < 2000 },
    { check: "2-photo upload under 10 s (server side, LAN)", value: `p95 ${Math.round(uploadP95)} ms`, pass: uploadP95 < 10_000 },
    { check: "No lost or duplicated points after cut uploads", value: `${res.ok}/${res.tried} exact, ${res.duplicates} duplicates, ${res.lost} lost`, pass: res.duplicates === 0 && res.lost === 0 },
  ];
  console.log(`\nRequests by screen (ms):`);
  console.table(rows);
  console.log(`Throughput: ${(total / elapsed).toFixed(1)} requests/s; points raised: ${created.length}; expected 409s (closure already approved by another officer): ${expectedConflicts}`);
  if (Object.keys(errors).length) console.log("Errors:", errors);
  console.table(checks);
  const pass = checks.every((c) => c.pass);
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  fs.writeFileSync(REPORT, JSON.stringify({ base: BASE, users: USERS, sites: SITES, officersPerSite: OFFICERS, expectedConflicts, durationS: DURATION / 1000, loginRushMs: loginMs, throughputRps: total / elapsed, pointsRaised: created.length, rows, checks, errors, resilience: res, pass, at: new Date().toISOString() }, null, 2));
  console.log(`Report: ${REPORT}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
