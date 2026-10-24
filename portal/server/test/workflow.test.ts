/**
 * End-to-end tests of the observation workflow and the permission rules, run against a real PostgreSQL.
 *   TEST_DATABASE_URL=postgres://… npm test
 * The test database is wiped and rebuilt on every run.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://safeworks:safeworks@127.0.0.1:55432/safeworks_test";
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sw-test-"));
process.env.RUN_JOBS = "false";

const PHOTO = fs.readFileSync(path.join(here, "fixtures", "photo-1.jpg"));
const PW = "Test@1234";

let app: any;
let db: typeof import("../src/db.js");
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};

function multipart(data: unknown, files: { field: string; buf: Buffer }[]) {
  const boundary = "----sw" + crypto.randomBytes(8).toString("hex");
  const parts: Buffer[] = [];
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="data"\r\n\r\n${JSON.stringify(data)}\r\n`));
  files.forEach((f, i) => {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="p${i}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`));
    parts.push(f.buf, Buffer.from("\r\n"));
  });
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

async function call(who: string | null, method: string, url: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (who) headers.authorization = `Bearer ${tokens[who]}`;
  const res = await app.inject({ method, url, headers, payload: body as any });
  let json: any = null;
  try {
    json = res.json();
  } catch {
    /* not json */
  }
  return { status: res.statusCode, json, body: res.body };
}

async function upload(who: string, url: string, data: unknown, files: { field: string; buf: Buffer }[]) {
  const m = multipart(data, files);
  const res = await app.inject({ method: "POST", url, payload: m.payload, headers: { ...m.headers, authorization: `Bearer ${tokens[who]}` } });
  return { status: res.statusCode, json: res.json() };
}

async function login(emp: string, password = PW, appName = "portal") {
  return app.inject({ method: "POST", url: "/api/auth/login", payload: { employeeId: emp, password, app: appName } });
}

function point(siteId: string, extra: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    siteId,
    type: "unsafe_condition",
    categoryCode: "C02",
    itemCode: "C02-01",
    hazard: "Fall from height",
    severity: 4,
    likelihood: 3,
    description: "Guardrail missing on slab edge at level 3.",
    immediateAction: "Barricaded / tagged out",
    rootCause: "Procedure or supervision",
    correctiveAction: "Fix guardrail, mid-rail and toe board.",
    ownerId: ids.sup1,
    ...extra,
  };
}

before(async () => {
  db = await import("../src/db.js");
  await db.pool.query("drop schema public cascade; create schema public;");
  const { migrate } = await import("../src/migrate.js");
  await migrate(false);
  const { buildMasterRows } = await import("../scripts/master-data.js");
  for (const r of buildMasterRows()) {
    await db.pool.query(`insert into master_items (org_id, list, code, label, parent_code, sort) values (null,$1,$2,$3,$4,$5)`, [r.list, r.code, r.label, r.parent ?? null, r.sort]);
  }
  const { hashPassword } = await import("../src/security.js");
  const hash = await hashPassword(PW);
  const org = (await db.pool.query(`insert into organisations (name) values ('Test Co') returning id`)).rows[0].id;
  ids.org = org;
  ids.siteA = (await db.pool.query(`insert into sites (org_id, code, name, state) values ($1,'SA','Site A','Karnataka') returning id`, [org])).rows[0].id;
  ids.siteB = (await db.pool.query(`insert into sites (org_id, code, name, state) values ($1,'SB','Site B','Tamil Nadu') returning id`, [org])).rows[0].id;
  const mk = async (emp: string, roles: [string, string | null][], mustChange = false) => {
    const id = (await db.pool.query(`insert into users (org_id, employee_id, name, password_hash, must_change_password) values ($1,$2,$3,$4,$5) returning id`, [org, emp, emp, hash, mustChange])).rows[0].id;
    for (const [role, site] of roles) await db.pool.query(`insert into memberships (user_id, org_id, site_id, role) values ($1,$2,$3,$4)`, [id, org, site, role]);
    ids[emp.toLowerCase()] = id;
  };
  await mk("ADMIN", [["org_admin", null]]);
  await mk("SO1", [["safety_officer", ids.siteA]]);
  await mk("SO2", [["safety_officer", ids.siteA]]);
  await mk("SUP1", [["supervisor", ids.siteA]]);
  await mk("SOB", [["safety_officer", ids.siteB]]);
  await mk("VIEW", [["viewer", null]]);
  await mk("NEW1", [["supervisor", ids.siteA]], true);
  await mk("LOCKME", [["supervisor", ids.siteA]]);
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  for (const u of ["SO1", "SO2", "SUP1", "SOB", "VIEW"]) {
    const r = await login(u);
    assert.equal(r.statusCode, 200, `login ${u}: ${r.body}`);
    tokens[u] = r.json().token;
  }
  const a = await login("ADMIN", PW, "admin");
  assert.equal(a.statusCode, 200);
  tokens.ADMIN = a.json().token;
});

after(async () => {
  await app?.close();
  await db?.pool.end();
});

test("wrong password 5 times locks the account; admin unlock restores it", async () => {
  for (let i = 0; i < 4; i++) assert.equal((await login("LOCKME", "wrong-pass1")).statusCode, 401);
  assert.equal((await login("LOCKME", "wrong-pass1")).statusCode, 423);
  assert.equal((await login("LOCKME", PW)).statusCode, 423, "still locked even with the right password");
  const un = await call("ADMIN", "POST", `/api/admin/users/${ids.lockme}/unlock`);
  assert.equal(un.status, 200);
  assert.equal((await login("LOCKME", PW)).statusCode, 200);
});

test("a user with a temporary password must change it before using the portal", async () => {
  const r = await login("NEW1");
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().mustChangePassword, true);
  tokens.NEW1 = r.json().token;
  const blocked = await call("NEW1", "GET", "/api/sites");
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, "must_change_password");
  const weak = await call("NEW1", "POST", "/api/auth/change-password", { currentPassword: PW, newPassword: "short" });
  assert.equal(weak.status, 400);
  const ok = await call("NEW1", "POST", "/api/auth/change-password", { currentPassword: PW, newPassword: "NewPass2026" });
  assert.equal(ok.status, 200);
  assert.equal((await call("NEW1", "GET", "/api/sites")).status, 200);
});

test("only admins and viewers can sign in to the admin console", async () => {
  assert.equal((await login("SO1", PW, "admin")).statusCode, 403);
  assert.equal((await login("VIEW", PW, "admin")).statusCode, 200);
  assert.equal((await call("SO1", "GET", "/api/admin/users")).status, 403, "portal token cannot call admin API");
});

test("supervisors cannot raise points; safety officers need 1–2 photos", async () => {
  const sup = await upload("SUP1", "/api/observations", point(ids.siteA), [{ field: "photos", buf: PHOTO }]);
  assert.equal(sup.status, 403);
  const none = await upload("SO1", "/api/observations", point(ids.siteA), []);
  assert.equal(none.status, 400);
  assert.match(none.json.error, /photo/i);
  const three = await upload("SO1", "/api/observations", point(ids.siteA), [
    { field: "photos", buf: PHOTO }, { field: "photos", buf: PHOTO }, { field: "photos", buf: PHOTO },
  ]);
  assert.equal(three.status, 400);
  const notImage = await upload("SO1", "/api/observations", point(ids.siteA), [{ field: "photos", buf: Buffer.from("not an image at all") }]);
  assert.equal(notImage.status, 400);
});

test("full cycle: raise → assign → supervisor closes → safety officer approves", async () => {
  const p = point(ids.siteA);
  const r = await upload("SO1", "/api/observations", p, [{ field: "photos", buf: PHOTO }, { field: "photos", buf: PHOTO }]);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.match(r.json.code, /^OBS-SA-\d{4}-00001$/);
  assert.equal(r.json.riskLevel, "High");
  assert.equal(r.json.status, "open");
  assert.equal(r.json.owner.id, ids.sup1);
  assert.equal(r.json.photos.length, 2);
  const due = new Date(r.json.dueAt).getTime() - new Date(r.json.raisedAt).getTime();
  assert.ok(Math.abs(due - 3 * 86_400_000) < 120_000, "High risk is due in 3 days");

  // Retry of the same point (offline queue) does not duplicate it
  const again = await upload("SO1", "/api/observations", p, [{ field: "photos", buf: PHOTO }]);
  assert.equal(again.status, 200);
  assert.equal(again.json.code, r.json.code);

  // Photo link works and is signed
  const photoUrl = r.json.photos[0].url as string;
  const img = await app.inject({ method: "GET", url: photoUrl });
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers["content-type"], "image/jpeg");
  const tampered = await app.inject({ method: "GET", url: photoUrl.replace(/s=[^&]+/, "s=forged") });
  assert.equal(tampered.statusCode, 403);

  // Supervisor sees it in "assigned", submits closure
  const mine = await call("SUP1", "GET", "/api/observations?scope=assigned&status=open");
  assert.ok(mine.json.items.some((x: any) => x.id === p.id));
  const cl = await upload("SUP1", `/api/observations/${p.id}/closure`, { comment: "Guardrail fixed and checked." }, [{ field: "photos", buf: PHOTO }]);
  assert.equal(cl.status, 200, JSON.stringify(cl.json));
  assert.equal(cl.json.status, "closure_submitted");

  // Supervisor cannot approve
  const supDecide = await call("SUP1", "POST", `/api/observations/${p.id}/decision`, { decision: "approve" });
  assert.equal(supDecide.status, 403);

  // Safety officer B of another site cannot see or approve it
  assert.equal((await call("SOB", "GET", `/api/observations/${p.id}`)).status, 403);
  assert.equal((await call("SOB", "POST", `/api/observations/${p.id}/decision`, { decision: "approve" })).status, 403);
  const listB = await call("SOB", "GET", "/api/observations?status=any");
  assert.ok(!listB.json.items.some((x: any) => x.id === p.id));

  // Reject needs a reason
  assert.equal((await call("SO1", "POST", `/api/observations/${p.id}/decision`, { decision: "reject" })).status, 400);
  const rej = await call("SO1", "POST", `/api/observations/${p.id}/decision`, { decision: "reject", remarks: "Toe board missing." });
  assert.equal(rej.status, 200);
  assert.equal(rej.json.status, "in_progress");

  await upload("SUP1", `/api/observations/${p.id}/closure`, { comment: "Toe board added." }, []);
  const ok = await call("SO1", "POST", `/api/observations/${p.id}/decision`, { decision: "approve", remarks: "Verified", onsiteVerified: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.status, "closed");
  assert.ok(ok.json.closedAt);
  assert.equal(ok.json.closures.length, 2);
  assert.deepEqual(ok.json.closures.map((c: any) => c.decision), ["rejected", "approved"]);
  assert.deepEqual(ok.json.timeline.map((t: any) => t.action), ["created", "closure_submitted", "rejected", "closure_submitted", "approved"], "every step is a version in the history");
});

test("a safety officer cannot approve a closure they submitted; another officer can", async () => {
  const p = point(ids.siteA, { ownerId: ids.so1 });
  assert.equal((await upload("SO1", "/api/observations", p, [{ field: "photos", buf: PHOTO }])).status, 201);
  assert.equal((await upload("SO1", `/api/observations/${p.id}/closure`, { comment: "Done by me." }, [])).status, 200);
  const own = await call("SO1", "POST", `/api/observations/${p.id}/decision`, { decision: "approve" });
  assert.equal(own.status, 403);
  const approvals = await call("SO1", "GET", "/api/observations?scope=approvals&status=awaiting");
  assert.ok(!approvals.json.items.some((x: any) => x.id === p.id), "own closures are not in your approval queue");
  const other = await call("SO2", "POST", `/api/observations/${p.id}/decision`, { decision: "approve" });
  assert.equal(other.status, 200);
});

test("safe behaviour is noted without an action; corrected-on-the-spot closes at once", async () => {
  const safe = await upload("SO1", "/api/observations", { id: crypto.randomUUID(), siteId: ids.siteA, type: "safe_behaviour", description: "Full tie-off while shifting." }, [{ field: "photos", buf: PHOTO }]);
  assert.equal(safe.status, 201, JSON.stringify(safe.json));
  assert.equal(safe.json.status, "noted");
  assert.equal(safe.json.dueAt, null);
  const spot = await upload("SO1", "/api/observations", point(ids.siteA, { correctedOnSpot: true, ownerId: null }), [{ field: "photos", buf: PHOTO }, { field: "afterPhotos", buf: PHOTO }]);
  assert.equal(spot.status, 201, JSON.stringify(spot.json));
  assert.equal(spot.json.status, "closed");
  assert.equal(spot.json.photos.filter((x: any) => x.kind === "closure").length, 1);
});

test("edits, due-date extension and cancel are versioned and need the right role", async () => {
  const p = point(ids.siteA);
  await upload("SO1", "/api/observations", p, [{ field: "photos", buf: PHOTO }]);
  assert.equal((await call("SUP1", "PATCH", `/api/observations/${p.id}`, { description: "changed by supervisor" })).status, 403);
  const ed = await call("SO2", "PATCH", `/api/observations/${p.id}`, { severity: 5, likelihood: 4, reason: "Higher drop than first noted" });
  assert.equal(ed.status, 200);
  assert.equal(ed.json.riskLevel, "Critical");
  assert.equal(ed.json.version, 2);
  const ex = await call("SO1", "POST", `/api/observations/${p.id}/extend`, { dueAt: new Date(Date.now() + 10 * 86_400_000).toISOString(), reason: "Material on order" });
  assert.equal(ex.status, 200);
  assert.ok(ex.json.originalDueAt);
  assert.equal((await call("SO1", "POST", `/api/observations/${p.id}/cancel`, {})).status, 400, "cancel needs a reason");
  const c = await call("SO1", "POST", `/api/observations/${p.id}/cancel`, { reason: "Duplicate of an earlier point" });
  assert.equal(c.json.status, "cancelled");
});

test("admin creates users, resets and sets passwords; old sessions end", async () => {
  const created = await call("ADMIN", "POST", "/api/admin/users", {
    employeeId: "E900", name: "New Supervisor", roles: [{ role: "supervisor", siteId: ids.siteA }], password: { mode: "temp" },
  });
  assert.equal(created.status, 201, created.body);
  assert.match(created.json.tempPassword, /^[A-Za-z]+-\d{4}-[A-Za-z]+$/);
  const dup = await call("ADMIN", "POST", "/api/admin/users", { employeeId: "e900", name: "Dup", roles: [{ role: "supervisor", siteId: ids.siteA }] });
  assert.equal(dup.status, 409, "employee IDs are unique regardless of case");
  const badScope = await call("ADMIN", "POST", "/api/admin/users", { employeeId: "E901", name: "Bad", roles: [{ role: "safety_officer", siteId: null }] });
  assert.equal(badScope.status, 400);

  const before = tokens.SUP1;
  const reset = await call("ADMIN", "POST", `/api/admin/users/${ids.sup1}/password`, { mode: "temp" });
  assert.equal(reset.status, 200);
  assert.ok(reset.json.tempPassword);
  const old = await app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${before}` } });
  assert.equal(old.statusCode, 401, "reset signs the user out everywhere");
  const l = await login("SUP1", reset.json.tempPassword);
  assert.equal(l.statusCode, 200);
  assert.equal(l.json().mustChangePassword, true);

  const weak = await call("ADMIN", "POST", `/api/admin/users/${ids.sup1}/password`, { mode: "set", password: "abc" });
  assert.equal(weak.status, 400);
  const set = await call("ADMIN", "POST", `/api/admin/users/${ids.sup1}/password`, { mode: "set", password: "Chosen2026", mustChange: false });
  assert.equal(set.status, 200);
  const l2 = await login("SUP1", "Chosen2026");
  assert.equal(l2.statusCode, 200);
  assert.equal(l2.json().mustChangePassword, false);
  tokens.SUP1 = l2.json().token;

  const viewerTry = await call("VIEW", "POST", "/api/admin/users", { employeeId: "X1", name: "X", roles: [{ role: "viewer", siteId: null }] });
  assert.equal(viewerTry.status, 403, "a portal session cannot use the admin API");
  const va = await login("VIEW", PW, "admin");
  tokens.VIEWA = va.json().token;
  const viewerAdmin = await call("VIEWA", "POST", "/api/admin/users", { employeeId: "X1", name: "X", roles: [{ role: "viewer", siteId: null }] });
  assert.equal(viewerAdmin.status, 403, "management viewers are read-only");

  const audit = await call("ADMIN", "GET", "/api/admin/audit?action=password");
  assert.ok(audit.json.items.length >= 2, "password resets are in the audit log");
});

test("bulk import validates first, then creates users with temporary passwords", async () => {
  const csv = "employee_id,name,designation,role,site_code\nB100,Bulk One,Supervisor,supervisor,SA\nB101,Bulk Two,Safety Officer,safety officer,SB\n";
  const dry = await call("ADMIN", "POST", "/api/admin/users/import", { csv, dryRun: true });
  assert.equal(dry.json.ready, 2);
  assert.equal(dry.json.errors.length, 0);
  const bad = await call("ADMIN", "POST", "/api/admin/users/import", { csv: "employee_id,name,role,site_code\nB200,X,supervisor,NOPE\n" });
  assert.equal(bad.json.errors.length, 1);
  const real = await call("ADMIN", "POST", "/api/admin/users/import", { csv });
  assert.equal(real.json.created.length, 2);
  assert.ok(real.json.created.every((c: any) => c.tempPassword));
});

test("dashboards count by status and the CSV export lists points", async () => {
  const me = await call("SO1", "GET", "/api/dashboard/me");
  assert.equal(me.status, 200);
  assert.equal(me.json.scope, "site");
  assert.ok(me.json.counters.created >= 4);
  assert.ok(me.json.counters.closed >= 2);
  const site = await call("SO1", "GET", `/api/dashboard/site/${ids.siteA}`);
  assert.equal(site.status, 200);
  assert.equal(site.json.weekly.length, 12);
  assert.equal((await call("SUP1", "GET", `/api/dashboard/site/${ids.siteA}`)).status, 403);
  const csv = await call("ADMIN", "GET", "/api/admin/export/observations.csv");
  assert.equal(csv.status, 200);
  assert.match(csv.body, /Observation ID,Site code/);
  assert.match(csv.body, /OBS-SA-/);
});

test("settings change the due date of new points", async () => {
  const s = await call("ADMIN", "PUT", "/api/admin/settings", { companyName: "Test Co", dueDays: { Critical: 1, High: 2, Medium: 7, Low: 15 }, escalation: { siteHeadDays: 3, adminDays: 7 } });
  assert.equal(s.status, 200, s.body);
  const bad = await call("ADMIN", "PUT", "/api/admin/settings", { companyName: "Test Co", dueDays: { Critical: 9, High: 2, Medium: 7, Low: 15 }, escalation: { siteHeadDays: 3, adminDays: 7 } });
  assert.equal(bad.status, 400);
  const r = await upload("SO1", "/api/observations", point(ids.siteA), [{ field: "photos", buf: PHOTO }]);
  const due = new Date(r.json.dueAt).getTime() - new Date(r.json.raisedAt).getTime();
  assert.ok(Math.abs(due - 2 * 86_400_000) < 120_000, "High risk now due in 2 days");
});
