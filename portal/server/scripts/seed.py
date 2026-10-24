"""Seed the database.

    python scripts/seed.py          master lists, the company, 5 pilot sites (rename them in the admin console) and the first admin login
    python scripts/seed.py --demo   the above plus sample areas, contractors, users and observations (testing only, never a live system)

Safe to run again: it only adds what is missing.
"""
from __future__ import annotations

import asyncio
import os
import random
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from master_data import build_master_rows  # noqa: E402
from safeworks import db  # noqa: E402
from safeworks.auth import load_memberships  # noqa: E402
from safeworks.migrate import migrate  # noqa: E402
from safeworks.rbac import AuthUser  # noqa: E402
from safeworks.security import hash_password, password_problem, temp_password  # noqa: E402

HERE = Path(__file__).resolve().parent
# Demo logins (testing only). On a server reachable from the internet, set DEMO_PASSWORD (or SEED_ADMIN_PASSWORD).
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD") or os.environ.get("SEED_ADMIN_PASSWORD") or "Safe@1234"

PILOT_SITES = [
    ("PS01", "Pilot Site 1", "construction", "Karnataka"),
    ("PS02", "Pilot Site 2", "factory", "Tamil Nadu"),
    ("PS03", "Pilot Site 3", "construction", "Tamil Nadu"),
    ("PS04", "Pilot Site 4", "plant", "Karnataka"),
    ("PS05", "Pilot Site 5", "warehouse", "Tamil Nadu"),
]


async def seed_master() -> None:
    rows = build_master_rows()
    for r in rows:
        await db.execute(
            """insert into master_items (org_id, list, code, label, parent_code, sort) values (null, $1, $2, $3, $4, $5)
               on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), list, code)
               do update set label = excluded.label, parent_code = excluded.parent_code, sort = excluded.sort""",
            [r["list"], r["code"], r["label"], r.get("parent"), r["sort"]],
        )
    print(f"[seed] master lists: {len(rows)} items")


async def seed_company() -> str:
    org = await db.one("select id from organisations order by created_at limit 1")
    if not org:
        org = await db.one("insert into organisations (name) values ($1) returning id", [os.environ.get("SEED_COMPANY") or "Your Company (rename in Settings)"])
        print("[seed] company created")
    org_id = org["id"]
    n = await db.one("select count(*)::int as n from sites where org_id = $1", [org_id])
    if not n["n"]:
        for code, name, kind, state in PILOT_SITES:
            await db.execute("insert into sites (org_id, code, name, site_type, state) values ($1,$2,$3,$4,$5)", [org_id, code, name, kind, state])
        print(f"[seed] {len(PILOT_SITES)} pilot sites created (rename them in the admin console)")
    if not await db.one("select 1 as ok from memberships where org_id = $1 and role = 'org_admin' limit 1", [org_id]):
        emp = os.environ.get("SEED_ADMIN_ID") or "ADMIN01"
        chosen = os.environ.get("SEED_ADMIN_PASSWORD") or ""
        if chosen and password_problem(chosen):
            print(f"[seed] SEED_ADMIN_PASSWORD ignored: {password_problem(chosen)} A temporary password is used instead.")
            chosen = ""
        pw = chosen or temp_password()
        u = await db.one(
            "insert into users (org_id, employee_id, name, designation, password_hash, must_change_password) values ($1,$2,$3,$4,$5,$6) returning id",
            [org_id, emp, "Administrator", "Admin", await hash_password(pw), not chosen],
        )
        await db.execute("insert into memberships (user_id, org_id, site_id, role) values ($1,$2,null,'platform_admin'), ($1,$2,null,'org_admin')", [u["id"], org_id])
        print("\n================ FIRST ADMIN LOGIN ================")
        print(f"  Employee ID : {emp}")
        print("  Password    : the SEED_ADMIN_PASSWORD you set" if chosen else f"  Password    : {pw}   (temporary; you must change it at first login)")
        print("====================================================\n")
    return org_id


FIRST = ["Arun", "Priya", "Karthik", "Lakshmi", "Suresh", "Divya", "Ravi", "Meena", "Vignesh", "Anitha", "Manoj", "Kavya", "Prakash", "Revathi", "Ganesh",
         "Sowmya", "Rajesh", "Deepa", "Naveen", "Shalini", "Senthil", "Harish", "Bhavana", "Mohan"]
LAST = ["Kumar", "Raj", "Murugan", "Rao", "Reddy", "Shetty", "Iyer", "Natarajan", "Gowda", "Pillai", "Subramanian", "Naidu", "Hegde", "Krishnan"]
AREAS = ["Block A", "Block B", "Batching plant", "Store yard", "Main gate", "Workshop"]
CONTRACTORS = ["Sri Balaji Scaffolding Pvt Ltd", "Kaveri Electricals", "Deccan Civil Works", "Coromandel Fabricators"]


async def seed_demo(org_id: str) -> None:
    from safeworks.observations import create_observation, decide_closure, submit_closure
    from safeworks.storage import sniff_image
    from safeworks.upload import UploadedImage

    rnd = random.Random()
    name_idx = 0

    def person() -> str:
        nonlocal name_idx
        n = f"{FIRST[name_idx % len(FIRST)]} {LAST[(name_idx * 7) % len(LAST)]}"
        name_idx += 1
        return n

    pw = await hash_password(DEMO_PASSWORD)
    sites = await db.q("select id, code, name from sites where org_id = $1 order by code", [org_id])
    contractor_ids = []
    for cname in CONTRACTORS:
        row = await db.one(
            "insert into contractors (org_id, name) values ($1,$2) on conflict (org_id, name) do update set name = excluded.name returning id", [org_id, cname]
        )
        contractor_ids.append(row["id"])
        for s in sites:
            await db.execute("insert into contractor_sites values ($1,$2) on conflict do nothing", [row["id"], s["id"]])

    async def mk_user(emp: str, name: str, designation: str, roles: list[tuple[str, str | None]], contractor_id: str | None = None) -> str:
        existing = await db.one("select id from users where org_id = $1 and lower(employee_id) = lower($2)", [org_id, emp])
        if existing:
            return existing["id"]
        u = await db.one(
            """insert into users (org_id, employee_id, name, designation, phone, password_hash, must_change_password, contractor_id)
               values ($1,$2,$3,$4,$5,$6,false,$7) returning id""",
            [org_id, emp, name, designation, f"9{rnd.randint(100000000, 999999999)}", pw, contractor_id],
        )
        for role, site_id in roles:
            await db.execute("insert into memberships (user_id, org_id, site_id, role) values ($1,$2,$3,$4)", [u["id"], org_id, site_id, role])
        return u["id"]

    await mk_user("VIEW01", "Management Viewer", "Director – Operations", [("viewer", None)])
    await mk_user("AUD01", "Internal Auditor", "HSE Auditor", [("auditor", None)])

    photos = sorted((HERE / "demo-photos").glob("*.jpg"))

    def img(p: Path) -> UploadedImage:
        data = p.read_bytes()
        return UploadedImage(data, sniff_image(data))

    master = await db.q("select list, code, label, parent_code from master_items where org_id is null")

    def pick(lst: str, parent: str | None = None) -> dict:
        return rnd.choice([m for m in master if m["list"] == lst and (parent is None or m["parent_code"] == parent)])

    async def as_user(uid: str) -> AuthUser:
        r = await db.one("select * from users where id = $1", [uid])
        return AuthUser(id=uid, org_id=org_id, employee_id=r["employee_id"], name=r["name"], designation=r["designation"], email=r["email"],
                        must_change_password=False, memberships=await load_memberships(uid), session_id="seed", kind="portal")

    total = 0
    for si, s in enumerate(sites):
        for a in AREAS:
            await db.execute("insert into areas (site_id, name) values ($1,$2) on conflict do nothing", [s["id"], a])
        areas = await db.q("select id from areas where site_id = $1", [s["id"]])
        sos = [
            await mk_user(f"SO-{s['code']}-1", person(), "Safety Officer", [("safety_officer", s["id"])]),
            await mk_user(f"SO-{s['code']}-2", person(), "Safety Engineer", [("safety_officer", s["id"])]),
        ]
        sups = []
        for k in range(1, 7):
            sups.append(await mk_user(f"SUP-{s['code']}-{k}", person(), "Site Supervisor" if k <= 3 else "Contractor Supervisor",
                                      [("supervisor", s["id"])], contractor_ids[(k + si) % len(contractor_ids)] if k > 3 else None))
        if (await db.one("select count(*)::int as n from observations where site_id = $1", [s["id"]]))["n"]:
            continue
        for n in range(36):
            so = await as_user(rnd.choice(sos))
            r = rnd.randrange(100)
            t = "unsafe_condition" if r < 45 else "unsafe_act" if r < 78 else "near_miss" if r < 88 else "safe_behaviour"
            cat = pick("category", t) if t in ("unsafe_act", "unsafe_condition") else None
            item = pick("item", cat["code"]) if cat else None
            sev, lik = 1 + rnd.randrange(4), 1 + rnd.randrange(5)
            oid = str(uuid.uuid4())
            owner = rnd.choice(sups)
            safe = t == "safe_behaviour"
            payload = {
                "id": oid, "siteId": s["id"], "areaId": rnd.choice(areas)["id"], "location": f"Grid {chr(65 + rnd.randrange(6))}-{1 + rnd.randrange(9)}",
                "type": t, "categoryCode": cat["code"] if cat else "", "itemCode": item["code"] if item else "", "hazard": pick("hazard")["label"],
                "activity": pick("activity")["label"], "lsr": pick("lsr")["label"] if rnd.randrange(10) == 0 else "",
                "personObserved": rnd.choice(["Fitter – Sri Balaji Scaffolding", "Electrician – Kaveri Electricals", "Helper – Deccan Civil Works", "Welder – own employee"]) if t == "unsafe_act" else "",
                "contractorId": rnd.choice(contractor_ids) if rnd.randrange(2) else None,
                "severity": None if safe else sev, "likelihood": None if safe else lik, "workStopped": sev * lik >= 15 and rnd.randrange(2) == 0,
                "description": "Crew used full-body harness with double lanyard and kept 100% tie-off while shifting." if safe
                else f"{item['label'] if item else pick('hazard')['label']} observed during {pick('round_type')['label'].lower()}.",
                "immediateAction": "Recognised (safe behaviour)" if safe else rnd.choice(["Work stopped", "Barricaded / tagged out", "Person coached", "Reported to supervisor"]),
                "rootCause": "" if safe else pick("root_cause")["label"],
                "correctiveAction": "" if safe else "Rectify the condition, brief the crew in the toolbox talk and verify before restarting work.",
                "controlLevel": "" if safe else rnd.choice(["Engineering", "Administrative", "PPE"]),
                "ownerId": None if safe else owner,
            }
            ev = [img(photos[n % 5])] + ([img(photos[(n + 1) % 5])] if n % 3 == 0 else [])
            await create_observation(so, payload, ev, [], "seed")
            total += 1
            days_ago = rnd.randrange(60)
            st = await db.one("select risk_level, status from observations where id = $1", [oid])
            due_days = {"Critical": 1, "High": 3, "Medium": 7, "Low": 15}.get(st["risk_level"] or "", 7)
            await db.execute(
                """update observations set raised_at = now() - make_interval(days => $2, hours => $3), observed_at = now() - make_interval(days => $2, hours => $3),
                          assigned_at = case when owner_id is null then null else now() - make_interval(days => $2, hours => $3) end,
                          due_at = case when due_at is null then null else now() - make_interval(days => $2, hours => $3) + make_interval(days => $4) end
                    where id = $1""",
                [oid, days_ago, rnd.randint(1, 7), due_days],
            )
            if st["status"] != "open":
                continue
            fate = rnd.randrange(100)
            sup = await as_user(owner)
            if fate < 55 and days_ago > 1:
                await submit_closure(sup, oid, {"comment": "Rectified and crew briefed; area checked with the supervisor.", "controlLevel": "Engineering"}, [img(photos[5])])
                approve = fate < 48
                approver = await as_user(sos[1] if sos[0] == so.id else sos[0])
                await decide_closure(approver, oid, {"decision": "approve", "remarks": "Verified on site.", "onsiteVerified": True} if approve
                                     else {"decision": "reject", "remarks": "Toe board still missing on the east side."})
                took = min(days_ago, 1 + rnd.randrange(max(2, due_days + 3)))
                await db.execute("update closures set submitted_at = now() - make_interval(days => $2), decided_at = now() - make_interval(days => $2) where observation_id = $1",
                                 [oid, days_ago - took])
                if approve:
                    await db.execute("update observations set closed_at = now() - make_interval(days => $2), closure_submitted_at = now() - make_interval(days => $2) where id = $1",
                                     [oid, days_ago - took])
            elif fate < 70:
                await submit_closure(sup, oid, {"comment": "Guardrail replaced and inspected; please verify.", "controlLevel": "Engineering"}, [])
    print(f"[seed] demo data: {len(sites)} sites × (2 safety officers, 6 supervisors, 6 areas), {total} observations")
    shown = "(the password you set)" if os.environ.get("DEMO_PASSWORD") or os.environ.get("SEED_ADMIN_PASSWORD") else DEMO_PASSWORD
    print(f"[seed] demo logins (testing only): SO-PS01-1, SUP-PS01-1, VIEW01, AUD01 … password {shown}")


async def main() -> None:
    await migrate()
    await seed_master()
    org_id = await seed_company()
    if "--demo" in sys.argv:
        await seed_demo(org_id)
    await db.close_pool()


if __name__ == "__main__":
    asyncio.run(main())
