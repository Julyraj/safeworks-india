/**
 * Seed the database.
 *   npm run seed        → master lists, the company, 5 pilot sites (rename them in the admin console) and the first admin login
 *   npm run seed:demo   → the above plus sample areas, contractors, users and observations for testing (never use on a live system)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { pool, q, one } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { hashPassword, passwordProblem, tempPassword } from "../src/security.js";
import { buildMasterRows } from "./master-data.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const demo = process.argv.includes("--demo");
// Demo logins (testing only). On a server reachable from the internet, set DEMO_PASSWORD (or SEED_ADMIN_PASSWORD) so it isn't the public default.
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || process.env.SEED_ADMIN_PASSWORD || "Safe@1234";

async function seedMaster() {
  const rows = buildMasterRows();
  for (const r of rows) {
    await q(
      `insert into master_items (org_id, list, code, label, parent_code, sort)
       values (null, $1, $2, $3, $4, $5)
       on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), list, code)
       do update set label = excluded.label, parent_code = excluded.parent_code, sort = excluded.sort`,
      [r.list, r.code, r.label, r.parent ?? null, r.sort],
    );
  }
  console.log(`[seed] master lists: ${rows.length} items`);
}

const PILOT_SITES = [
  { code: "PS01", name: "Pilot Site 1", type: "construction", state: "Karnataka" },
  { code: "PS02", name: "Pilot Site 2", type: "factory", state: "Tamil Nadu" },
  { code: "PS03", name: "Pilot Site 3", type: "construction", state: "Tamil Nadu" },
  { code: "PS04", name: "Pilot Site 4", type: "plant", state: "Karnataka" },
  { code: "PS05", name: "Pilot Site 5", type: "warehouse", state: "Tamil Nadu" },
];

async function seedCompany(): Promise<{ orgId: string }> {
  let org = await one<{ id: string }>(`select id from organisations order by created_at limit 1`);
  if (!org) {
    org = await one<{ id: string }>(`insert into organisations (name) values ($1) returning id`, [process.env.SEED_COMPANY || "Your Company (rename in Settings)"]);
    console.log("[seed] company created");
  }
  const orgId = org!.id;
  const siteCount = await one<{ n: number }>(`select count(*)::int as n from sites where org_id = $1`, [orgId]);
  if (!siteCount?.n) {
    for (const s of PILOT_SITES) {
      await q(`insert into sites (org_id, code, name, site_type, state) values ($1,$2,$3,$4,$5)`, [orgId, s.code, s.name, s.type, s.state]);
    }
    console.log(`[seed] ${PILOT_SITES.length} pilot sites created (rename them in the admin console)`);
  }
  const hasAdmin = await one(`select 1 from memberships where org_id = $1 and role = 'org_admin' limit 1`, [orgId]);
  if (!hasAdmin) {
    const emp = process.env.SEED_ADMIN_ID || "ADMIN01";
    let chosen = process.env.SEED_ADMIN_PASSWORD || "";
    if (chosen && passwordProblem(chosen)) {
      console.warn(`[seed] SEED_ADMIN_PASSWORD ignored: ${passwordProblem(chosen)} A temporary password is used instead.`);
      chosen = "";
    }
    const pw = chosen || tempPassword();
    const u = await one<{ id: string }>(
      `insert into users (org_id, employee_id, name, designation, password_hash, must_change_password) values ($1,$2,$3,$4,$5,$6) returning id`,
      [orgId, emp, "Administrator", "Admin", await hashPassword(pw), !chosen],
    );
    await q(`insert into memberships (user_id, org_id, site_id, role) values ($1,$2,null,'platform_admin'), ($1,$2,null,'org_admin')`, [u!.id, orgId]);
    console.log("\n================ FIRST ADMIN LOGIN ================");
    console.log(`  Employee ID : ${emp}`);
    console.log(chosen ? "  Password    : the SEED_ADMIN_PASSWORD you set" : `  Password    : ${pw}   (temporary; you must change it at first login)`);
    console.log("====================================================\n");
  }
  return { orgId };
}

// ---------------------------------------------------------------------------------------------
// Demo data (testing only)
// ---------------------------------------------------------------------------------------------

const FIRST = ["Arun", "Priya", "Karthik", "Lakshmi", "Suresh", "Divya", "Ravi", "Meena", "Vignesh", "Anitha", "Manoj", "Kavya", "Prakash", "Revathi", "Ganesh", "Sowmya", "Rajesh", "Deepa", "Naveen", "Shalini", "Senthil", "Harish", "Bhavana", "Mohan"];
const LAST = ["Kumar", "Raj", "Murugan", "Rao", "Reddy", "Shetty", "Iyer", "Natarajan", "Gowda", "Pillai", "Subramanian", "Naidu", "Hegde", "Krishnan"];
const AREAS = ["Block A", "Block B", "Batching plant", "Store yard", "Main gate", "Workshop"];
const CONTRACTORS = ["Sri Balaji Scaffolding Pvt Ltd", "Kaveri Electricals", "Deccan Civil Works", "Coromandel Fabricators"];

function rand<T>(a: T[]): T {
  return a[crypto.randomInt(a.length)];
}
let nameIdx = 0;
function personName(): string {
  const n = `${FIRST[nameIdx % FIRST.length]} ${LAST[(nameIdx * 7) % LAST.length]}`;
  nameIdx++;
  return n;
}

async function seedDemo(orgId: string) {
  const { createObservation, submitClosure, decideClosure } = await import("../src/observations.js");
  const { loadMemberships } = await import("../src/auth.js");
  const pw = await hashPassword(DEMO_PASSWORD);
  const sites = await q<any>(`select id, code, name from sites where org_id = $1 order by code`, [orgId]);
  const contractorIds: string[] = [];
  for (const c of CONTRACTORS) {
    const row = await one<any>(
      `insert into contractors (org_id, name) values ($1,$2) on conflict (org_id, name) do update set name = excluded.name returning id`,
      [orgId, c],
    );
    contractorIds.push(row.id);
    for (const s of sites) await q(`insert into contractor_sites values ($1,$2) on conflict do nothing`, [row.id, s.id]);
  }
  const mkUser = async (emp: string, name: string, designation: string, roles: { role: string; siteId: string | null }[], contractorId: string | null = null) => {
    const existing = await one<any>(`select id from users where org_id = $1 and lower(employee_id) = lower($2)`, [orgId, emp]);
    if (existing) return existing.id as string;
    const u = await one<any>(
      `insert into users (org_id, employee_id, name, designation, phone, password_hash, must_change_password, contractor_id)
       values ($1,$2,$3,$4,$5,$6,false,$7) returning id`,
      [orgId, emp, name, designation, `9${crypto.randomInt(100000000, 999999999)}`, pw, contractorId],
    );
    for (const r of roles) await q(`insert into memberships (user_id, org_id, site_id, role) values ($1,$2,$3,$4)`, [u.id, orgId, r.siteId, r.role]);
    return u.id as string;
  };
  await mkUser("VIEW01", "Management Viewer", "Director – Operations", [{ role: "viewer", siteId: null }]);
  await mkUser("AUD01", "Internal Auditor", "HSE Auditor", [{ role: "auditor", siteId: null }]);

  const photos = fs.readdirSync(path.join(here, "demo-photos")).filter((f) => f.endsWith(".jpg")).sort();
  const img = (f: string) => {
    const buf = fs.readFileSync(path.join(here, "demo-photos", f));
    return { buf, info: { mime: "image/jpeg" as const, ext: "jpg" as const, width: 800, height: 600 } };
  };
  const master = await q<any>(`select list, code, label, parent_code from master_items where org_id is null`);
  const pick = (list: string, parent?: string) => rand(master.filter((m) => m.list === list && (!parent || m.parent_code === parent)));
  const asUser = async (id: string) => {
    const r = await one<any>(`select * from users where id = $1`, [id]);
    return {
      id, orgId, employeeId: r.employee_id, name: r.name, designation: r.designation, email: r.email,
      mustChangePassword: false, memberships: await loadMemberships(id), sessionId: "seed", kind: "portal" as const,
    };
  };

  let total = 0;
  for (const [si, s] of sites.entries()) {
    for (const a of AREAS) await q(`insert into areas (site_id, name) values ($1,$2) on conflict do nothing`, [s.id, a]);
    const areas = await q<any>(`select id from areas where site_id = $1`, [s.id]);
    const sos = [
      await mkUser(`SO-${s.code}-1`, personName(), "Safety Officer", [{ role: "safety_officer", siteId: s.id }]),
      await mkUser(`SO-${s.code}-2`, personName(), "Safety Engineer", [{ role: "safety_officer", siteId: s.id }]),
    ];
    const sups: string[] = [];
    for (let k = 1; k <= 6; k++) {
      sups.push(await mkUser(`SUP-${s.code}-${k}`, personName(), k <= 3 ? "Site Supervisor" : "Contractor Supervisor", [{ role: "supervisor", siteId: s.id }], k > 3 ? contractorIds[(k + si) % contractorIds.length] : null));
    }
    const existing = await one<{ n: number }>(`select count(*)::int as n from observations where site_id = $1`, [s.id]);
    if (existing?.n) continue;

    for (let n = 0; n < 36; n++) {
      const so = await asUser(rand(sos));
      const r = crypto.randomInt(100);
      const type = r < 45 ? "unsafe_condition" : r < 78 ? "unsafe_act" : r < 88 ? "near_miss" : "safe_behaviour";
      const cat = type === "unsafe_act" ? pick("category", "unsafe_act") : type === "unsafe_condition" ? pick("category", "unsafe_condition") : null;
      const item = cat ? pick("item", cat.code) : null;
      const sev = 1 + crypto.randomInt(4);
      const lik = 1 + crypto.randomInt(5);
      const id = crypto.randomUUID();
      const owner = rand(sups);
      const payload: any = {
        id, siteId: s.id, areaId: rand(areas).id, location: `Grid ${String.fromCharCode(65 + crypto.randomInt(6))}-${1 + crypto.randomInt(9)}`,
        type, categoryCode: cat?.code ?? "", itemCode: item?.code ?? "", hazard: pick("hazard").label, activity: pick("activity").label,
        lsr: crypto.randomInt(10) === 0 ? pick("lsr").label : "", personObserved: type === "unsafe_act" ? rand(["Fitter – Sri Balaji Scaffolding", "Electrician – Kaveri Electricals", "Helper – Deccan Civil Works", "Welder – own employee"]) : "",
        contractorId: crypto.randomInt(2) ? rand(contractorIds) : null, severity: type === "safe_behaviour" ? null : sev, likelihood: type === "safe_behaviour" ? null : lik,
        workStopped: sev * lik >= 15 && crypto.randomInt(2) === 0,
        description: type === "safe_behaviour" ? "Crew used full-body harness with double lanyard and kept 100% tie-off while shifting." : `${item?.label ?? pick("hazard").label} observed during ${pick("round_type").label.toLowerCase()}.`,
        immediateAction: type === "safe_behaviour" ? "Recognised (safe behaviour)" : rand(["Work stopped", "Barricaded / tagged out", "Person coached", "Reported to supervisor"]),
        rootCause: type === "safe_behaviour" ? "" : pick("root_cause").label,
        correctiveAction: type === "safe_behaviour" ? "" : "Rectify the condition, brief the crew in the toolbox talk and verify before restarting work.",
        controlLevel: type === "safe_behaviour" ? "" : rand(["Engineering", "Administrative", "PPE"]),
        ownerId: type === "safe_behaviour" ? null : owner,
      };
      await createObservation(so, payload, { evidence: [img(photos[n % 5])].concat(n % 3 === 0 ? [img(photos[(n + 1) % 5])] : []), after: [] }, "seed");
      total++;
      // Spread over the last 60 days
      const daysAgo = crypto.randomInt(0, 60);
      const st = await one<any>(`select risk_level, status from observations where id = $1`, [id]);
      const dueDays = { Critical: 1, High: 3, Medium: 7, Low: 15 }[st.risk_level as "Low"] ?? 7;
      await q(
        `update observations set raised_at = now() - make_interval(days => $2, hours => $3), observed_at = now() - make_interval(days => $2, hours => $3),
                assigned_at = case when owner_id is null then null else now() - make_interval(days => $2, hours => $3) end,
                due_at = case when due_at is null then null else now() - make_interval(days => $2, hours => $3) + make_interval(days => $4) end
          where id = $1`,
        [id, daysAgo, crypto.randomInt(1, 8), dueDays],
      );
      if (st.status !== "open") continue;
      const fate = crypto.randomInt(100);
      const sup = await asUser(owner);
      if (fate < 55 && daysAgo > 1) {
        await submitClosure(sup, id, { comment: "Rectified and crew briefed; area checked with the supervisor.", controlLevel: "Engineering" }, [img(photos[5])]);
        const approve = fate < 48;
        await decideClosure(await asUser(sos[0] === so.id ? sos[1] : sos[0]), id, approve ? { decision: "approve", remarks: "Verified on site.", onsiteVerified: true } : { decision: "reject", remarks: "Toe board still missing on the east side." });
        const took = Math.min(daysAgo, 1 + crypto.randomInt(Math.max(2, dueDays + 3)));
        await q(`update closures set submitted_at = now() - make_interval(days => $2), decided_at = now() - make_interval(days => $2) where observation_id = $1`, [id, daysAgo - took]);
        if (approve) await q(`update observations set closed_at = now() - make_interval(days => $2), closure_submitted_at = now() - make_interval(days => $2) where id = $1`, [id, daysAgo - took]);
      } else if (fate < 70) {
        await submitClosure(sup, id, { comment: "Guardrail replaced and inspected; please verify.", controlLevel: "Engineering" }, []);
      }
    }
  }
  console.log(`[seed] demo data: ${sites.length} sites × (2 safety officers, 6 supervisors, 6 areas), ${total} observations`);
  console.log(`[seed] demo logins (testing only): SO-PS01-1, SUP-PS01-1, VIEW01, AUD01 … password ${process.env.DEMO_PASSWORD || process.env.SEED_ADMIN_PASSWORD ? "(the password you set)" : DEMO_PASSWORD}`);
}

async function main() {
  await migrate();
  await seedMaster();
  const { orgId } = await seedCompany();
  if (demo) await seedDemo(orgId);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
