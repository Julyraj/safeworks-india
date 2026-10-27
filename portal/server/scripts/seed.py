#!/usr/bin/env python
"""Seed the database (idempotent): organisation, settings, matrix, rules, categories, industries, templates, sites, ADMIN01.

    python scripts/seed.py            # base configuration + the first admin
    python scripts/seed.py --demo     # also one user per role per site, contractors, people, ~200 observations, actions, runs

Environment: DATABASE_URL, SEED_ORG_NAME (or SEED_COMPANY), SEED_ADMIN_ID (default ADMIN01), SEED_ADMIN_PASSWORD (generated and
printed when empty), DEMO_PASSWORD (falls back to the admin password, like 1.x).
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import secrets
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

SERVER = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER))
sys.path.insert(0, str(SERVER / "scripts"))

from safeworks import db  # noqa: E402
from safeworks.auth import USER_SQL, build_user  # noqa: E402
from safeworks.config import config  # noqa: E402
from safeworks.crypto import encrypt  # noqa: E402
from safeworks.defaults import default_areas  # noqa: E402
from safeworks.migrate import migrate  # noqa: E402
from safeworks.security import hash_password, qr_token  # noqa: E402
from safeworks.settings import DEFAULT_SETTINGS  # noqa: E402
import seed_data as sd  # noqa: E402

DEMO_PHOTOS = sorted((SERVER / "scripts" / "demo-photos").glob("*.jpg"))


def say(msg: str) -> None:
    print(f"[seed] {msg}", flush=True)


# ---------------------------------------------------------------- base seed

async def seed_org(c) -> str:
    name = config.seed_org_name
    row = await db.one("select id from organisations order by created_at limit 1", [], c)
    if row:
        return row["id"]
    row = await db.one("insert into organisations (name, legal_name, settings) values ($1, $1, $2) returning id", [name, DEFAULT_SETTINGS], c)
    say(f"organisation '{name}' created")
    return row["id"]


async def seed_industries(c) -> None:
    path = config.data_dir / "industries.json"
    rows = []
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            for i, x in enumerate(data):
                rows.append((x["id"], {"en": x["t"], **(x.get("n") or {})}, x.get("tag", ""), x.get("icon", ""), x.get("est") or [], x.get("cats") or [], x.get("templates") or [],
                             x.get("hazards") or [], x.get("ppe") or [],
                             {"regs": x.get("regs") or [], "procs": x.get("procs") or [], "cks": x.get("cks") or [], "talks": x.get("talks") or [], "tasks": x.get("tasks") or []}, i))
            say(f"industries from {path}")
        except Exception as e:
            say(f"industries.json unreadable ({e}); using the built-in list")
            rows = []
    if not rows:
        for i, (code, en, other, tag, icon, est, cats, tmpls, hazards, ppe) in enumerate(sd.INDUSTRIES_FALLBACK):
            rows.append((code, {"en": en, **other}, tag, icon, est, cats, tmpls, hazards, ppe, {}, i))
    for code, name, tag, icon, est, cats, tmpls, hazards, ppe, lib, sort in rows:
        await c.execute(
            """insert into industry_profiles (code, name_i18n, tagline, icon, establishment_types, category_codes, template_codes, hazards, ppe, library, sort)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
               on conflict (code) do update set name_i18n = excluded.name_i18n, tagline = excluded.tagline, icon = excluded.icon, establishment_types = excluded.establishment_types,
                 category_codes = case when cardinality(excluded.category_codes) > 0 then excluded.category_codes else industry_profiles.category_codes end,
                 template_codes = case when cardinality(excluded.template_codes) > 0 then excluded.template_codes else industry_profiles.template_codes end,
                 hazards = excluded.hazards, ppe = excluded.ppe, library = excluded.library, sort = excluded.sort""",
            code, name, tag, icon, est, cats, tmpls, hazards, ppe, lib, sort,
        )
    # library records without categories/templates get the fallback's defaults so site setup still enables something
    fb = {r[0]: r for r in sd.INDUSTRIES_FALLBACK}
    for code, r in fb.items():
        await c.execute("update industry_profiles set category_codes = $2 where code = $1 and cardinality(category_codes) = 0", code, r[6])
        await c.execute("update industry_profiles set template_codes = $2 where code = $1 and cardinality(template_codes) = 0", code, r[7])


async def seed_matrix(c, org_id: str) -> str:
    m = await db.one("select id from risk_matrices where org_id = $1 and name = $2", [org_id, sd.MATRIX_NAME], c)
    if not m:
        m = await db.one("insert into risk_matrices (org_id, name, size) values ($1, $2, 5) returning id", [org_id, sd.MATRIX_NAME], c)
    v = await db.one("select id from risk_matrix_versions where matrix_id = $1 and version = 1", [m["id"]], c)
    if not v:
        v = await db.one(
            "insert into risk_matrix_versions (matrix_id, version, likelihood_labels, severity_labels, bands, status, effective_from) values ($1, 1, $2, $3, $4, 'active', current_date) returning id",
            [m["id"], [{"v": v_, "label": lab} for v_, lab in sd.LIKELIHOOD], [{"v": v_, "label": lab, "anchor": anc} for v_, lab, anc in sd.SEVERITY], sd.BANDS], c,
        )
    return v["id"]


async def seed_rules(c, org_id: str) -> None:
    for band, amount, unit, interim, verify in sd.DUE_DATE_RULES:
        await c.execute(
            """insert into due_date_rules (org_id, site_id, band, due_amount, due_unit, interim_control_required, verify_within_hours, status_label) values ($1, null, $2, $3, $4, $5, $6, 'design default')
               on conflict (org_id, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid), band) do nothing""", org_id, band, amount, unit, interim, verify)
    for band, steps, label in sd.LADDERS:
        await c.execute("insert into reminder_ladders (org_id, band, steps, daily_cap, status_label) values ($1, $2, $3, 5, $4) on conflict (org_id, band) do nothing", org_id, band, steps, label)
    for code, name, state, site_type, regime, status, enabled, reviewed_by, notes in sd.RULE_SETS:
        await c.execute(
            """insert into rule_sets (code, name, state, site_type, regime, status, enabled, reviewed_by, reviewed_at, notes) values ($1,$2,$3,$4,$5,$6,$7,$8, case when $8 <> '' then now() end, $9)
               on conflict (code) do update set name = excluded.name, notes = excluded.notes, status = excluded.status""", code, name, state, site_type, regime, status, enabled, reviewed_by, notes)
    have = await c.fetchval("select count(*) from timer_rules")
    if not have:
        for rs, ev, conds, basis, minutes, recipient, form, status, note in sd.TIMER_RULES:
            await c.execute("insert into timer_rules (rule_set_code, trigger, deadline_basis, deadline_minutes, recipient, form_code, status, source_note) values ($1,$2,$3,$4,$5,$6,$7,$8)",
                            rs, {"event_class": ev, "conditions": conds}, basis, minutes, recipient, form, status, note)
    for rt, years, basis, action, label in __import__("safeworks.retention", fromlist=["DEFAULT_POLICIES"]).DEFAULT_POLICIES:
        await c.execute("insert into retention_policies (org_id, record_type, retention_years, basis_note, end_action, status_label) values ($1,$2,$3,$4,$5,$6) on conflict (org_id, record_type) do nothing",
                        org_id, rt, years, basis, action, label)
    for lang, body in sd.PRIVACY_NOTICE.items():
        await c.execute("insert into privacy_notices (org_id, version, lang, body, effective_from, status) values ($1, 1, $2, $3, current_date, 'active') on conflict (org_id, version, lang) do nothing", org_id, lang, body)


async def seed_categories(c, org_id: str) -> None:
    for i, (code, en, hi, ta, kn, critical, prompt, is3786, icon) in enumerate(sd.CATEGORIES):
        await c.execute(
            """insert into categories (org_id, code, name_i18n, icon, critical_capable, incident_prompt, is3786_default, sort) values ($1,$2,$3,$4,$5,$6,$7,$8)
               on conflict (org_id, code) do update set name_i18n = excluded.name_i18n, icon = excluded.icon, critical_capable = excluded.critical_capable, incident_prompt = excluded.incident_prompt,
                 is3786_default = excluded.is3786_default, updated_at = now()""", org_id, code, {"en": en, "hi": hi, "ta": ta, "kn": kn}, icon, critical, prompt, is3786, i)


async def seed_templates(c, org_id: str, admin_id: str) -> None:
    pfn = [{"value": "pass", "label": {"en": "Pass", "hi": "ठीक", "ta": "சரி", "kn": "ಸರಿ"}, "colour": "green", "flag": False, "score": 1},
           {"value": "fail", "label": {"en": "Fail", "hi": "असफल", "ta": "தவறு", "kn": "ವಿಫಲ"}, "colour": "red", "flag": True, "score": 0},
           {"value": "na", "label": {"en": "N/A", "hi": "लागू नहीं", "ta": "பொருந்தாது", "kn": "ಅನ್ವಯಿಸದು"}, "colour": "grey", "flag": False, "score": None}]
    for code, name, ttype, applies, items, freq in sd.TEMPLATES:
        t = await db.one("select id, active_version_id from inspection_templates where org_id = $1 and code = $2", [org_id, code], c)
        if t and t["active_version_id"]:
            continue
        if not t:
            t = await db.one("insert into inspection_templates (org_id, code, name_i18n, type, applies_to) values ($1,$2,$3,$4,$5) returning id", [org_id, code, name, ttype, applies], c)
        v = await db.one("insert into inspection_template_versions (template_id, version, status, approved_by, approved_at, change_note) values ($1, 1, 'active', $2, now(), $3) returning id",
                         [t["id"], admin_id, f"Seeded from the build brief §16.3 ({freq})"], c)
        sec = await db.one("insert into inspection_sections (version_id, sort, title_i18n) values ($1, 0, $2) returning id", [v["id"], name], c)
        for i, (qcode, en, hi, ta, kn, ref, status, extra) in enumerate(items):
            await c.execute(
                """insert into inspection_questions (section_id, sort, code, text_i18n, answer_type, response_set, required, photo_on_fail, note_on_fail, action_on_fail, action_defaults, reference_text, reference_status)
                   values ($1,$2,$3,$4,'pass_fail_na',$5,true,true,true,true,$6,$7,$8)""",
                sec["id"], i, qcode, {"en": en, "hi": hi, "ta": ta, "kn": kn}, pfn, {"ownerRole": "site_safety_officer", "band": "moderate", **(extra.get("actionDefaults") or {})}, ref, status,
            )
        await c.execute("update inspection_templates set active_version_id = $2, updated_at = now() where id = $1", t["id"], v["id"])


async def seed_sites(c, org_id: str, matrix_version_id: str) -> dict[str, str]:
    ids = {}
    for code, name, state, district, est, rule_set, industry, lat, lng, workers in sd.SITES:
        s = await db.one("select id from sites where org_id = $1 and code = $2", [org_id, code], c)
        if not s:
            s = await db.one(
                """insert into sites (org_id, code, name_i18n, address, state, district, lat, lng, geofence_radius_m, industry_code, establishment_type, rule_set_code, rule_set_effective_from,
                                      risk_matrix_version_id, hazardous_process, worker_count) values ($1,$2,$3,$4,$5,$6,$7,$8,500,$9,$10,$11::text, case when $11::text is null then null else current_date end,$12,$13,$14) returning id""",
                [org_id, code, name, f"{name['en']}, {district}", state, district, lat, lng, industry, est, rule_set, matrix_version_id, est == "hazardous_process_factory", workers], c,
            )
            for i, (acode, aname, atype) in enumerate(default_areas(industry)):
                await c.execute("insert into areas (site_id, code, name_i18n, area_type, sort) values ($1,$2,$3,$4,$5)", s["id"], acode, aname, atype, i)
            await c.execute("insert into qr_codes (org_id, token, target_type, target_id, label) values ($1,$2,'site',$3,$4)", org_id, qr_token(), s["id"], code)
            for a in await db.q("select id, name_i18n from areas where site_id = $1", [s["id"]], c):
                await c.execute("insert into qr_codes (org_id, token, target_type, target_id, label) values ($1,$2,'area',$3,$4)", org_id, qr_token(), a["id"], f"{code} / {a['name_i18n']['en']}")
            say(f"site {code} created with areas and QR codes")
        ids[code] = s["id"]
    return ids


async def ensure_user(c, org_id: str, code: str, name: str, pw_hash: str, roles: list[tuple[str, str | None]], *, lang: str = "en", email: str = "", login_type: str = "employee_code",
                      employer_id: str | None = None, trade: str = "", phone: str = "", must_change: bool = False) -> str:
    u = await db.one("select id from users where org_id = $1 and lower(employee_code) = lower($2)", [org_id, code], c)
    if u:
        return u["id"]
    p = await db.one("insert into people (org_id, full_name, employer_id, phone_enc, phone_last4, preferred_language, trade) values ($1,$2,$3,$4,$5,$6,$7) returning id",
                     [org_id, name, employer_id, encrypt(phone) if phone else "", phone[-4:] if phone else "", lang, trade], c)
    u = await db.one("insert into users (org_id, person_id, login_type, employee_code, email, password_hash, must_change_password, language) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
                     [org_id, p["id"], login_type, code, email, pw_hash, must_change, lang], c)
    for role, site_id in roles:
        await c.execute("insert into user_site_roles (user_id, site_id, role, granted_by) values ($1, $2, $3::role_t, null) on conflict do nothing", u["id"], site_id, role)
    return u["id"]


async def seed_base(c) -> tuple[str, str, dict[str, str], str]:
    org_id = await seed_org(c)
    await seed_industries(c)
    matrix_version = await seed_matrix(c, org_id)
    await seed_rules(c, org_id)
    await seed_categories(c, org_id)
    admin_pw = os.environ.get("SEED_ADMIN_PASSWORD", "")
    generated = False
    if not admin_pw:
        admin_pw = f"Sw{secrets.token_hex(3)}-{secrets.token_hex(3)}7"
        generated = True
    existing = await db.one("select id from users where org_id = $1 and lower(employee_code) = lower($2)", [org_id, config.seed_admin_code], c)
    admin_id = await ensure_user(c, org_id, config.seed_admin_code, "Administrator", await hash_password(admin_pw), [("admin", None)], email="admin@safeworks.local", login_type="employee_code")
    if not existing:
        say(f"admin {config.seed_admin_code} created" + (f" — password: {admin_pw}" if generated else ""))
    await seed_templates(c, org_id, admin_id)
    sites = await seed_sites(c, org_id, matrix_version)
    await c.execute("insert into contractors (org_id, name, is_own_company) values ($1, $2, true) on conflict (org_id, name) do nothing", org_id, config.seed_org_name)
    return org_id, admin_id, sites, admin_pw


# ---------------------------------------------------------------- demo data

async def _actor(c, user_id: str):
    row = await db.one(USER_SQL + " where u.id = $1", [user_id], c)
    u = await build_user({**row, "kind": "field"}, c)
    u.device_id = "seed"
    return u


async def seed_demo(c, org_id: str, sites: dict[str, str], demo_pw: str) -> None:
    from safeworks.schemas import ActionCompleteRequest, ActionDraft, ActionVerifyRequest, MediaRef, ObservationCreate, RunStartRequest, RunSubmitRequest, Answer, TriageRequest
    from safeworks.media import store_upload
    from safeworks.upload import UploadedFile
    from safeworks.storage import sniff_media
    from safeworks.workflow import actions as actions_wf, inspections as insp_wf, observations as obs_wf
    from safeworks.workflow.common import DuplicateRecord, get_site
    import hashlib

    if await c.fetchval("select count(*) from observations where org_id = $1", org_id) > 50:
        say("demo data already present; skipping")
        return
    rnd = random.Random(2026)
    pw = await hash_password(demo_pw)
    own = await db.one("select id from contractors where org_id = $1 and is_own_company", [org_id], c)
    contractors = {}
    for name, trades in (("Sri Ganesh Constructions", ["civil", "shuttering"]), ("Kaveri Scaffolding Pvt Ltd", ["scaffolding"]), ("Chola Electricals", ["electrical"]),
                         ("Vijaya Steel Fixers", ["steel fixing"]), ("Nandi Housekeeping Services", ["housekeeping"])):
        k = await db.one("insert into contractors (org_id, name, trades, contact_name, phone) values ($1,$2,$3,$4,$5) on conflict (org_id, name) do update set trades = excluded.trades returning id",
                         [org_id, name, trades, "Site supervisor", f"98{rnd.randint(10000000, 99999999)}"], c)
        contractors[name] = k["id"]
        for sid in sites.values():
            await c.execute("insert into contractor_sites (contractor_id, site_id) values ($1, $2) on conflict do nothing", k["id"], sid)
    await ensure_user(c, org_id, "HSE01", "Meenakshi Sundaram", pw, [("hse_manager", None)], email="hse01@safeworks.local", login_type="email")
    await ensure_user(c, org_id, "AUD01", "Auditor Rao", pw, [("auditor", None)], email="aud01@safeworks.local", login_type="email")
    users: dict[str, dict[str, str]] = {}
    names = ["Arun Kumar", "Priya Lakshmi", "Suresh Babu", "Deepa Nair", "Manoj Gowda", "Kavitha Raj", "Rahul Verma", "Lakshmi Devi", "Vikram Shetty", "Anitha Mohan", "Ramesh Yadav", "Sangeetha Pillai"]
    worker_names = ["Murugan", "Selvam", "Basavaraj", "Ravi", "Kumar", "Shankar", "Mahesh", "Raju", "Velu", "Nagaraj", "Prakash", "Mani"]
    for code, sid in sites.items():
        lang = "ta" if code.startswith("TN") else "kn"
        u = users[code] = {}
        u["SO"] = await ensure_user(c, org_id, f"SO-{code}", f"{rnd.choice(names)} (SO {code})", pw, [("site_safety_officer", sid)], lang=lang, email=f"so-{code.lower()}@safeworks.local", login_type="email")
        u["SH"] = await ensure_user(c, org_id, f"SH-{code}", f"{rnd.choice(names)} (Site head {code})", pw, [("site_head", sid)], lang="en", email=f"sh-{code.lower()}@safeworks.local", login_type="email")
        u["VER"] = await ensure_user(c, org_id, f"VER-{code}", f"{rnd.choice(names)} (Verifier {code})", pw, [("verifier", sid)], lang=lang)
        for i in range(1, 4):
            emp = rnd.choice(list(contractors.values()) + [own["id"]])
            u[f"OWN{i}"] = await ensure_user(c, org_id, f"OWN-{code}-{i}", f"{rnd.choice(names)} (Owner {i})", pw, [("action_owner", sid)], lang=lang, employer_id=emp, trade=rnd.choice(sd.TRADES))
        for i in range(1, 6):
            emp = rnd.choice(list(contractors.values()))
            u[f"W{i}"] = await ensure_user(c, org_id, f"WORKER-{code}-{i}", f"{rnd.choice(worker_names)} {rnd.choice('ABCDEFG')}", pw, [("reporter", sid)], lang=lang, employer_id=emp,
                                          trade=rnd.choice(sd.TRADES), phone=f"9{rnd.randint(100000000, 999999999)}")
        await c.execute("update sites set site_head_user_id = $2 where id = $1", sid, u["SH"])
        # people (workforce without logins)
        for i in range(8):
            await c.execute("insert into people (org_id, full_name, employer_id, phone_enc, phone_last4, preferred_language, trade, worker_type) values ($1,$2,$3,$4,$5,$6,$7,'contract')",
                            org_id, f"{rnd.choice(worker_names)} {rnd.choice(worker_names)}", rnd.choice(list(contractors.values())), encrypt(f"9{rnd.randint(100000000, 999999999)}"), str(rnd.randint(1000, 9999)), lang, rnd.choice(sd.TRADES))
    say("demo users, contractors and people ready")

    photos = [p.read_bytes() for p in DEMO_PHOTOS[:6]] or []

    def media_ref(purpose: str, data: bytes) -> MediaRef:
        info = sniff_media(data) or {"mime": "image/jpeg", "width": None, "height": None}
        return MediaRef(clientUuid=str(uuid.uuid4()), kind="photo", purpose=purpose, sha256=hashlib.sha256(data).hexdigest(), bytes=len(data), mime=info["mime"], width=info.get("width"),
                        height=info.get("height"), capturedAt=datetime.now(timezone.utc))

    async def upload(refs: list[MediaRef], datas: list[bytes]) -> None:
        for ref, data in zip(refs, datas):
            row = await db.one("select * from media where client_uuid = $1", [ref.client_uuid], c)
            info = sniff_media(data)
            await store_upload(c, row, UploadedFile(data, info["mime"], info["ext"], info["kind"], info.get("width"), info.get("height"), hashlib.sha256(data).hexdigest()))

    now = datetime.now(timezone.utc)
    created = 0
    status_plan = ["submitted"] * 4 + ["closed_spot", "discarded", "returned", "action_open", "action_open", "action_in_progress", "action_completed", "action_verified", "action_reopened",
                   "reviewed_no_action", "critical", "escalated", "merged", "action_disputed"]
    for code, sid in sites.items():
        site = await get_site(c, sid)
        areas = await db.q("select id from areas where site_id = $1 order by sort", [sid], c)
        u = users[code]
        so = await _actor(c, u["SO"])
        per_site = 40 if code == "TN1" else 40
        last_obs = None
        for n in range(per_site):
            plan = status_plan[n % len(status_plan)]
            typ, cats, lang, desc = sd.DEMO_OBSERVATIONS[(n * 7 + len(code)) % len(sd.DEMO_OBSERVATIONS)]
            reporter_key = rnd.choice(["W1", "W2", "W3", "W4", "W5", "OWN1", "SO"])
            reporter = await _actor(c, u[reporter_key])
            anonymous = rnd.random() < 0.15
            data = rnd.choice(photos) if photos else None
            refs = [media_ref("before", data)] if data else []
            days_ago = rnd.randint(0, 60)
            captured = now - timedelta(days=days_ago, hours=rnd.randint(0, 9))
            payload = ObservationCreate(clientUuid=str(uuid.uuid4()), siteId=sid, areaId=rnd.choice(areas)["id"], lat=site["lat"], lng=site["lng"], accuracyM=12.0, capturedAt=captured,
                                        channel="app", reporterType="contractor" if reporter_key.startswith("W") else "employee", anonymous=anonymous, type=typ, categoryCodes=cats,
                                        description=desc, descriptionLang=lang, fixedOnSpot=plan == "closed_spot", immediateAction="Area barricaded and supervisor informed." if plan == "closed_spot" else "",
                                        imminentDanger=plan == "critical", media=refs)
            try:
                o, _ = await obs_wf.create(c, reporter, payload, site=site, area_id=payload.area_id, asset_id=None, channel="app", device_id="seed")
            except DuplicateRecord:
                continue
            if refs:
                await upload(refs, [data])
            created += 1
            oid = o["id"]
            await c.execute("update observations set received_at = $2, updated_at = $2 where id = $1", oid, captured + timedelta(minutes=5))
            if plan == "submitted" or plan == "critical":
                last_obs = oid
                continue
            if typ == "good_practice" and plan not in ("closed_spot",):
                plan = "reviewed_no_action"
            tr = dict(clientUuid=str(uuid.uuid4()), capturedAt=captured + timedelta(hours=3))
            if plan == "closed_spot":
                await obs_wf.triage(c, so, oid, TriageRequest(decision="accept_fixed_on_spot", likelihood=2, severity=2, **tr))
            elif plan == "discarded":
                await obs_wf.triage(c, so, oid, TriageRequest(decision="discard", reasonCode="duplicate_or_test", reasonText="Test entry during training session.", **tr))
            elif plan == "reviewed_no_action":
                await obs_wf.triage(c, so, oid, TriageRequest(decision="reviewed_no_action", reasonCode="already_controlled", reasonText="Control already in place; good practice noted.", **tr))
            elif plan == "returned":
                if not anonymous and reporter_key != "SO":
                    await obs_wf.triage(c, so, oid, TriageRequest(decision="return_to_reporter", question="Which bay exactly? Please add a photo of the location.", **tr))
            elif plan == "escalated":
                await obs_wf.triage(c, so, oid, TriageRequest(decision="escalate_incident", likelihood=3, severity=4, learnedAt=captured + timedelta(hours=1), **tr))
            elif plan == "merged" and last_obs:
                await obs_wf.triage(c, so, oid, TriageRequest(decision="merge_duplicate", masterObservationId=last_obs, **tr))
            else:
                ls = {"action_open": (2, 3), "action_in_progress": (3, 3), "action_completed": (3, 2), "action_verified": (2, 2), "action_reopened": (3, 3), "action_disputed": (2, 2)}.get(plan, (2, 3))
                owner = u[rnd.choice(["OWN1", "OWN2", "OWN3"])]
                draft = ActionDraft(clientUuid=str(uuid.uuid4()), title=f"Fix: {desc[:60]}", problem=desc, actionType="corrective", controlLevel=rnd.choice(["engineering", "administrative", "ppe"]),
                                    ownerUserId=owner, interimControl="Area barricaded; supervisor briefed." if ls[0] * ls[1] >= 8 else "")
                await obs_wf.triage(c, so, oid, TriageRequest(decision="accept_assign", categoryCodes=cats, likelihood=ls[0], severity=ls[1], is3786Code="B-3" if typ == "unsafe_act" else "B-2",
                                                                employerInvolvedId=own["id"], actions=[draft], interimControl=draft.interim_control, **tr))
                a = await db.one("select id from actions where client_uuid = $1", [draft.client_uuid], c)
                if not a:
                    continue
                aid = a["id"]
                owner_actor = await _actor(c, owner)
                if plan in ("action_in_progress", "action_completed", "action_verified", "action_reopened"):
                    await actions_wf.start(c, owner_actor, aid, captured + timedelta(days=1))
                if plan in ("action_completed", "action_verified", "action_reopened"):
                    after = rnd.choice(photos) if photos else None
                    arefs = [media_ref("after", after)] if after else []
                    await actions_wf.complete(c, owner_actor, aid, ActionCompleteRequest(clientUuid=str(uuid.uuid4()), completionNote="Guard rail installed and tagged; toolbox talk held.",
                                                                                       causeAddressed="Missing mid-rail after material movement; procedure updated.", media=arefs, capturedAt=captured + timedelta(days=2)))
                    if arefs:
                        await upload(arefs, [after])
                if plan in ("action_verified", "action_reopened"):
                    ver = await _actor(c, u["VER"])
                    await actions_wf.verify(c, ver, aid, ActionVerifyRequest(clientUuid=str(uuid.uuid4()), result="effective" if plan == "action_verified" else "not_effective", method="re_inspection",
                                                                           reason="" if plan == "action_verified" else "Rail fitted on one side only.", capturedAt=captured + timedelta(days=3)))
                if plan == "action_disputed":
                    from safeworks.schemas import ActionRequestCreate
                    await actions_wf.request(c, owner_actor, aid, ActionRequestCreate(clientUuid=str(uuid.uuid4()), type="dispute", reasonCode="not_our_scope", reason="Scaffold belongs to the other contractor.", capturedAt=captured + timedelta(days=1)))
                if plan == "action_open" and rnd.random() < 0.5:
                    await c.execute("update actions set due_at = now() - interval '3 days', original_due_at = now() - interval '3 days' where id = $1", aid)
        # a few inspection runs
        tv = await db.one("select v.id from inspection_template_versions v join inspection_templates t on t.id = v.template_id where t.org_id = $1 and t.code = 'T1' and v.status = 'active'", [org_id], c)
        if tv:
            for k in range(3):
                inspector = await _actor(c, u["SO"])
                run = await insp_wf.start(c, inspector, RunStartRequest(clientUuid=str(uuid.uuid4()), templateVersionId=tv["id"], siteId=sid, areaId=rnd.choice(areas)["id"], trigger="spot",
                                                                        header={"document_no": f"DOC-{code}-{k + 1}"}, startedAt=now - timedelta(days=k * 7 + 1)))
                qs = await db.q("select q.id, q.code from inspection_questions q join inspection_sections s on s.id = q.section_id where s.version_id = $1 order by q.sort", [tv["id"]], c)
                answers = []
                for i, q in enumerate(qs):
                    fail = k < 2 and i in (1, 5)
                    act = ActionDraft(clientUuid=str(uuid.uuid4()), title=f"Inspection finding {q['code']}", ownerUserId=u["OWN1"], band="high", interimControl="Access restricted pending fix.") if fail else None
                    answers.append(Answer(clientUuid=str(uuid.uuid4()), questionId=q["id"], value="fail" if fail else ("na" if i == 4 else "pass"), note="Mid-rail missing on bay 3" if fail else "",
                                          answeredAt=now - timedelta(days=k * 7 + 1, hours=-1), action=act))
                if k == 2:
                    continue  # one run stays in progress
                await insp_wf.submit(c, inspector, run["id"], RunSubmitRequest(clientUuid=str(uuid.uuid4()), answers=answers, signature=None, completedAt=now - timedelta(days=k * 7 + 1, hours=-2)))
    await c.execute("delete from job_marks where key like 'job:%'")
    say(f"demo observations created: {created} (plus actions, inspection runs and notifications)")


async def main() -> None:
    demo = "--demo" in sys.argv
    await db.init_pool()
    try:
        await migrate(verbose=False)
        async with db.tx() as c:
            org_id, admin_id, sites, admin_pw = await seed_base(c)
        say("base configuration ready")
        if demo:
            demo_pw = os.environ.get("DEMO_PASSWORD") or admin_pw
            async with db.tx() as c:
                await seed_demo(c, org_id, sites, demo_pw)
            say("demo users: SO-TN1, SH-TN1, VER-TN1, OWN-TN1-1..3, WORKER-TN1-1..5 (same pattern for TN2, TN3, KA1, KA2), HSE01, AUD01")
    finally:
        await db.close_pool()


if __name__ == "__main__":
    asyncio.run(main())
