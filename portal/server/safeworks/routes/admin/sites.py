"""Admin: sites (with the 3-step setup wizard), areas, assets, site risk matrix and rule set."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ... import db
from ...audit import audit
from ...defaults import default_areas
from ...errors import HttpError, bad_request, not_found
from ...http import JSON, json_body, opt_uuid, page_params, uuid_param
from ...rbac import AuthUser
from ...schemas import AreaIn, AssetIn, SiteIn, SiteRuleSetBody, SiteSetupIn, VersionIdBody, parse
from ...security import qr_token
from ...settings import clear_org_cache
from ...views import area as area_view, asset as asset_view, paged, qr_code as qr_view, site as site_view
from ...config import config
from ._common import console_user, need_admin, need_safety_config, need_site_config, need_write, read_csv, scope_sites

router = APIRouter(prefix="/api/v1/admin")


async def _site(site_id: str, user: AuthUser) -> dict:
    s = await db.one("select * from sites where id = $1 and org_id = $2", [site_id, user.org_id])
    if not s or site_id not in user.sites_in_scope() and not user.is_admin:
        raise not_found()
    return s


# ---------- sites ----------

@router.get("/sites")
async def list_sites(request: Request, user: AuthUser = Depends(console_user)):
    include_deleted = request.query_params.get("deleted") == "1" and user.is_admin
    rows = await db.q("select * from sites where org_id = $1 and ($2 or deleted_at is null) order by code", [user.org_id, include_deleted])
    scope = set(user.sites_in_scope())
    return JSON([site_view(s) for s in rows if user.is_admin or s["id"] in scope])


@router.post("/sites")
async def create_site(request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    inp = parse(SiteIn, await json_body(request))
    if not inp.code:
        raise bad_request("Site code: 2 to 6 capital letters or digits.", key="err.site_code")
    if not inp.name:
        raise bad_request("name: required")
    if await db.one("select 1 from sites where org_id = $1 and code = $2", [user.org_id, inp.code]):
        raise HttpError(409, "This code is already in use.", "conflict", key="err.duplicate_code")
    async with db.tx() as c:
        row = await db.one(
            """insert into sites (org_id, code, name_i18n, address, state, district, lat, lng, geofence_radius_m, industry_code, establishment_type, appropriate_government,
                                  rule_set_code, rule_set_effective_from, risk_matrix_version_id, hazardous_process, working_calendar, worker_count, site_head_user_id, created_by, updated_by)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::date,$15,$16,$17,$18,$19,$20,$20) returning *""",
            [user.org_id, inp.code, inp.name.dump(), inp.address, inp.state, inp.district, inp.lat, inp.lng, inp.geofence_radius_m, inp.industry_code, inp.establishment_type,
             inp.appropriate_government, inp.rule_set_code, inp.rule_set_effective_from, inp.risk_matrix_version_id, inp.hazardous_process,
             inp.working_calendar.model_dump(by_alias=True) if inp.working_calendar else {"weeklyOff": [0], "shiftStart": "08:00", "shiftEnd": "17:00"}, inp.worker_count,
             inp.site_head_user_id, user.id], c,
        )
        await audit(c, org_id=user.org_id, actor=user, action="create", record_type="site", record_id=row["id"], site_id=row["id"], changes={"code": inp.code, "name": inp.name.dump()})
    return JSON(site_view(row), status_code=201)


@router.get("/sites/{site_id}")
async def get_site(site_id: str, user: AuthUser = Depends(console_user)):
    s = await _site(uuid_param(site_id), user)
    areas = await db.q("select * from areas where site_id = $1 and deleted_at is null order by sort, code", [s["id"]])
    qrs = await db.q("select * from qr_codes where target_type = 'site' and target_id = $1 and active", [s["id"]])
    out = site_view(s)
    out["areas"] = [area_view(a) for a in areas]
    out["qrCodes"] = [qr_view({**q, "target_name": s["code"]}, config.public_url) for q in qrs]
    return JSON(out)


@router.put("/sites/{site_id}")
async def update_site(site_id: str, request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    s = await _site(uuid_param(site_id), user)
    inp = parse(SiteIn, await json_body(request))
    name = inp.name.dump() if inp.name else s["name_i18n"]
    async with db.tx() as c:
        row = await db.one(
            """update sites set name_i18n = $2, address = $3, state = $4, district = $5, lat = $6, lng = $7, geofence_radius_m = $8, industry_code = $9, establishment_type = $10,
                               appropriate_government = $11, hazardous_process = $12, working_calendar = coalesce($13, working_calendar), worker_count = $14, site_head_user_id = $15,
                               active = $16, version = version + 1, updated_at = now(), updated_by = $17 where id = $1 returning *""",
            [s["id"], name, inp.address, inp.state, inp.district, inp.lat, inp.lng, inp.geofence_radius_m, inp.industry_code, inp.establishment_type, inp.appropriate_government,
             inp.hazardous_process, inp.working_calendar.model_dump(by_alias=True) if inp.working_calendar else None, inp.worker_count, inp.site_head_user_id, inp.active, user.id], c,
        )
        await audit(c, org_id=user.org_id, actor=user, action="update", record_type="site", record_id=s["id"], site_id=s["id"],
                    changes={k: [s[k], row[k]] for k in ("address", "state", "district", "industry_code", "establishment_type", "active", "worker_count") if s[k] != row[k]})
    return JSON(site_view(row))


@router.delete("/sites/{site_id}")
async def delete_site(site_id: str, request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    s = await _site(uuid_param(site_id), user)
    reason = (await json_body(request) or {}).get("reason") or request.query_params.get("reason") or ""
    if not reason:
        raise bad_request("A reason code and text are required.", key="err.reason_required")
    async with db.tx() as c:
        await c.execute("update sites set active = false, deleted_at = now(), deleted_by = $2, delete_reason = $3, version = version + 1, updated_at = now() where id = $1", s["id"], user.id, reason)
        await audit(c, org_id=user.org_id, actor=user, action="delete", record_type="site", record_id=s["id"], site_id=s["id"], reason=reason)
    return JSON({"ok": True})


@router.post("/sites/{site_id}/setup")
async def setup_site(site_id: str, request: Request, user: AuthUser = Depends(console_user)):
    """The 3-step wizard: industry → default areas → templates/categories enabled and a QR per area (plus one for the site)."""
    need_admin(user)
    s = await _site(uuid_param(site_id), user)
    inp = parse(SiteSetupIn, await json_body(request))
    ind = await db.one("select * from industry_profiles where code = $1", [inp.industry_code])
    if not ind:
        raise bad_request("Unknown industry code.", key="err.industry_unknown")
    posters: list[dict] = []
    async with db.tx() as c:
        est = ind["establishment_types"][0] if ind["establishment_types"] else s["establishment_type"]
        await c.execute("update sites set industry_code = $2, establishment_type = $3, version = version + 1, updated_at = now(), updated_by = $4 where id = $1", s["id"], ind["code"], est, user.id)
        created_areas = []
        names = inp.areas
        if names:
            spec = [(f"A{i + 1:02d}", {"en": n}, "other") for i, n in enumerate(names)]
        else:
            spec = default_areas(ind["code"])
        for i, (code, name, atype) in enumerate(spec):
            existing = await db.one("select id from areas where site_id = $1 and (code = $2 or name_i18n->>'en' = $3) and deleted_at is null", [s["id"], code, name["en"]], c)
            if existing:
                created_areas.append(existing["id"])
                continue
            row = await db.one("insert into areas (site_id, code, name_i18n, area_type, sort) values ($1, $2, $3, $4, $5) returning id", [s["id"], code, name, atype, i], c)
            created_areas.append(row["id"])
        # categories and templates: the industry profile lists what applies; activate them (they stay available to every site of the org)
        if ind["category_codes"]:
            await c.execute("update categories set active = true, updated_at = now() where org_id = $1 and code = any($2::text[])", user.org_id, list(ind["category_codes"]))
        if ind["template_codes"]:
            await c.execute(
                """update inspection_templates t set applies_to = jsonb_set(coalesce(applies_to, '{}'::jsonb), '{industries}',
                       (select to_jsonb(array(select distinct x from unnest(array_append(coalesce(array(select jsonb_array_elements_text(applies_to->'industries')), '{}'), $3)) x)))), updated_at = now()
                    where t.org_id = $1 and t.code = any($2::text[]) and t.deleted_at is null""", user.org_id, list(ind["template_codes"]), ind["code"])
        # QR codes: one for the site, one per area
        async def ensure_qr(target_type: str, target_id: str, label: str) -> dict:
            q = await db.one("select * from qr_codes where target_type = $1 and target_id = $2 and active", [target_type, target_id], c)
            if q:
                return q
            return await db.one("insert into qr_codes (org_id, token, target_type, target_id, label, created_by) values ($1, $2, $3, $4, $5, $6) returning *",
                                [user.org_id, qr_token(), target_type, target_id, label, user.id], c)
        q = await ensure_qr("site", s["id"], s["code"])
        posters.append({**qr_view({**q, "target_name": s["code"]}, config.public_url), "posterUrl": f"/api/v1/admin/qr-codes/{q['id']}/poster"})
        for aid in created_areas:
            a = await db.one("select * from areas where id = $1", [aid], c)
            q = await ensure_qr("area", aid, f"{s['code']} / {a['name_i18n'].get('en', '')}")
            posters.append({**qr_view({**q, "target_name": a["name_i18n"].get("en", "")}, config.public_url), "posterUrl": f"/api/v1/admin/qr-codes/{q['id']}/poster"})
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="site", record_id=s["id"], site_id=s["id"],
                    changes={"setup": True, "industryCode": ind["code"], "areas": len(created_areas), "qrCodes": len(posters)})
    clear_org_cache(user.org_id)
    site = await db.one("select * from sites where id = $1", [s["id"]])
    return JSON({"site": site_view(site), "areas": [area_view(a) for a in await db.q("select * from areas where site_id = $1 and deleted_at is null order by sort", [s["id"]])], "posters": posters})


@router.post("/sites/{site_id}/risk-matrix")
async def site_matrix(site_id: str, request: Request, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    s = await _site(uuid_param(site_id), user)
    inp = parse(VersionIdBody, await json_body(request))
    v = await db.one("select v.id from risk_matrix_versions v join risk_matrices m on m.id = v.matrix_id where v.id = $1 and m.org_id = $2 and v.status = 'active'", [inp.version_id, user.org_id])
    if not v:
        raise not_found()
    async with db.tx() as c:
        await c.execute("update sites set risk_matrix_version_id = $2, version = version + 1, updated_at = now(), updated_by = $3 where id = $1", s["id"], inp.version_id, user.id)
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="site", record_id=s["id"], site_id=s["id"], changes={"riskMatrixVersionId": [s["risk_matrix_version_id"], inp.version_id]})
    return JSON(site_view(await db.one("select * from sites where id = $1", [s["id"]])))


@router.post("/sites/{site_id}/rule-set")
async def site_rule_set(site_id: str, request: Request, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    s = await _site(uuid_param(site_id), user)
    inp = parse(SiteRuleSetBody, await json_body(request))
    rs = await db.one("select * from rule_sets where code = $1", [inp.code])
    if not rs:
        raise not_found()
    if rs["status"] == "draft_rule":
        if not rs["reviewed_by"]:  # brief §17.2 test 20: a draft pack cannot be assigned until a reviewer is named
            raise bad_request("A draft rule pack needs a named reviewer before it can be enabled.", key="err.rule_set_draft")
    elif not rs["enabled"]:
        raise bad_request("This rule set is not enabled.", key="err.rule_set_disabled")
    async with db.tx() as c:
        await c.execute("update sites set rule_set_code = $2, rule_set_effective_from = $3::date, version = version + 1, updated_at = now(), updated_by = $4 where id = $1",
                        s["id"], inp.code, inp.effective_from, user.id)
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="site", record_id=s["id"], site_id=s["id"],
                    changes={"ruleSetCode": [s["rule_set_code"], inp.code], "effectiveFrom": inp.effective_from})
    return JSON(site_view(await db.one("select * from sites where id = $1", [s["id"]])))


# ---------- areas ----------

@router.get("/sites/{site_id}/areas")
async def list_areas(site_id: str, user: AuthUser = Depends(console_user)):
    s = await _site(uuid_param(site_id), user)
    rows = await db.q("select * from areas where site_id = $1 and deleted_at is null order by sort, code", [s["id"]])
    return JSON([area_view(a) for a in rows])


@router.post("/sites/{site_id}/areas")
async def create_area(site_id: str, request: Request, user: AuthUser = Depends(console_user)):
    s = await _site(uuid_param(site_id), user)
    need_site_config(user, s["id"])
    inp = parse(AreaIn, await json_body(request))
    async with db.tx() as c:
        row = await db.one(
            "insert into areas (site_id, parent_area_id, code, name_i18n, area_type, hazardous_process, owner_user_id, sort) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *",
            [s["id"], inp.parent_area_id, inp.code, inp.name.dump(), inp.area_type, inp.hazardous_process, inp.owner_user_id, inp.sort], c,
        )
        await audit(c, org_id=user.org_id, actor=user, action="create", record_type="area", record_id=row["id"], site_id=s["id"], changes={"name": inp.name.dump(), "code": inp.code})
    return JSON(area_view(row), status_code=201)


@router.put("/areas/{area_id}")
async def update_area(area_id: str, request: Request, user: AuthUser = Depends(console_user)):
    a = await db.one("select * from areas where id = $1", [uuid_param(area_id)])
    if not a:
        raise not_found()
    need_site_config(user, a["site_id"])
    inp = parse(AreaIn, await json_body(request))
    async with db.tx() as c:
        row = await db.one(
            """update areas set parent_area_id = $2, code = $3, name_i18n = $4, area_type = $5, hazardous_process = $6, owner_user_id = $7, sort = $8, active = $9,
                               version = version + 1, updated_at = now() where id = $1 returning *""",
            [a["id"], inp.parent_area_id, inp.code, inp.name.dump(), inp.area_type, inp.hazardous_process, inp.owner_user_id, inp.sort, inp.active], c,
        )
        await audit(c, org_id=user.org_id, actor=user, action="update", record_type="area", record_id=a["id"], site_id=a["site_id"], changes={"name": [a["name_i18n"], row["name_i18n"]], "active": [a["active"], row["active"]]})
    return JSON(area_view(row))


@router.delete("/areas/{area_id}")
async def delete_area(area_id: str, request: Request, user: AuthUser = Depends(console_user)):
    a = await db.one("select * from areas where id = $1", [uuid_param(area_id)])
    if not a:
        raise not_found()
    need_site_config(user, a["site_id"])
    reason = (await json_body(request) or {}).get("reason") or request.query_params.get("reason") or ""
    async with db.tx() as c:
        await c.execute("update areas set active = false, deleted_at = now(), deleted_by = $2, delete_reason = $3, version = version + 1, updated_at = now() where id = $1", a["id"], user.id, reason)
        await c.execute("update qr_codes set active = false where target_type = 'area' and target_id = $1", a["id"])
        await audit(c, org_id=user.org_id, actor=user, action="delete", record_type="area", record_id=a["id"], site_id=a["site_id"], reason=reason)
    return JSON({"ok": True})


@router.post("/sites/{site_id}/areas/import")
async def import_areas(site_id: str, request: Request, user: AuthUser = Depends(console_user)):
    s = await _site(uuid_param(site_id), user)
    need_site_config(user, s["id"])
    rows = await read_csv(request, ["code", "name"])
    created = updated = skipped = 0
    errors = []
    valid_types = {"production", "utilities", "store", "yard", "scaffold_zone", "excavation_zone", "substation", "office", "canteen", "gate", "labour_camp", "loading_bay", "other"}
    async with db.tx() as c:
        for i, r in enumerate(rows, start=2):
            code, name = r.get("code", ""), r.get("name", "")
            if not code or not name:
                errors.append({"row": i, "message": "code and name are required"})
                skipped += 1
                continue
            atype = r.get("type") or "other"
            if atype not in valid_types:
                atype = "other"
            parent_id = None
            if r.get("parent"):
                p = await db.one("select id from areas where site_id = $1 and code = $2 and deleted_at is null", [s["id"], r["parent"]], c)
                parent_id = p["id"] if p else None
            existing = await db.one("select id from areas where site_id = $1 and code = $2 and deleted_at is null", [s["id"], code], c)
            name_i18n = {"en": name}
            for lang in ("hi", "ta", "kn"):
                if r.get(f"name_{lang}"):
                    name_i18n[lang] = r[f"name_{lang}"]
            if existing:
                await c.execute("update areas set name_i18n = $2, area_type = $3, parent_area_id = $4, version = version + 1, updated_at = now() where id = $1", existing["id"], name_i18n, atype, parent_id)
                updated += 1
            else:
                await c.execute("insert into areas (site_id, code, name_i18n, area_type, parent_area_id, sort) values ($1,$2,$3,$4,$5,$6)", s["id"], code, name_i18n, atype, parent_id, i)
                created += 1
        await audit(c, org_id=user.org_id, actor=user, action="create", record_type="area", record_id="import", site_id=s["id"], changes={"created": created, "updated": updated, "skipped": skipped})
    return JSON({"created": created, "updated": updated, "skipped": skipped, "errors": errors})


# ---------- assets ----------

@router.get("/assets")
async def list_assets(request: Request, user: AuthUser = Depends(console_user)):
    site_id = opt_uuid(request.query_params.get("siteId"))
    sites = scope_sites(user, site_id)
    page, size = page_params(request, 100, 500)
    rows = await db.q(
        """select a.*, (select token from qr_codes q where q.target_type = 'asset' and q.target_id = a.id and q.active order by created_at desc limit 1) as qr_token
             from assets a where a.site_id = any($1::uuid[]) and a.deleted_at is null order by a.tag_no limit $2 offset $3""", [sites, size, (page - 1) * size])
    total = await db.one("select count(*)::int as n from assets where site_id = any($1::uuid[]) and deleted_at is null", [sites])
    return JSON(paged([asset_view(a) for a in rows], total["n"], page, size))


@router.post("/assets")
async def create_asset(request: Request, user: AuthUser = Depends(console_user)):
    inp = parse(AssetIn, await json_body(request))
    if not inp.site_id:
        raise bad_request("Choose the site.", key="err.site_required")
    need_site_config(user, inp.site_id)
    if await db.one("select 1 from assets where site_id = $1 and tag_no = $2", [inp.site_id, inp.tag_no]):
        raise HttpError(409, "This code is already in use.", "conflict", key="err.duplicate_code")
    async with db.tx() as c:
        row = await db.one(
            """insert into assets (org_id, site_id, area_id, asset_class, tag_no, serial_no, make_model, swl_kg, owner_employer_id, status, status_reason, next_exam_due)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::date) returning *""",
            [user.org_id, inp.site_id, inp.area_id, inp.asset_class, inp.tag_no, inp.serial_no, inp.make_model, inp.swl_kg, inp.owner_employer_id, inp.status, inp.status_reason, inp.next_exam_due], c,
        )
        await audit(c, org_id=user.org_id, actor=user, action="create", record_type="asset", record_id=row["id"], site_id=inp.site_id, changes={"tagNo": inp.tag_no, "assetClass": inp.asset_class})
    return JSON(asset_view(row), status_code=201)


@router.put("/assets/{asset_id}")
async def update_asset(asset_id: str, request: Request, user: AuthUser = Depends(console_user)):
    a = await db.one("select * from assets where id = $1", [uuid_param(asset_id)])
    if not a:
        raise not_found()
    need_site_config(user, a["site_id"])
    inp = parse(AssetIn, await json_body(request))
    async with db.tx() as c:
        row = await db.one(
            """update assets set area_id = $2, asset_class = $3, tag_no = $4, serial_no = $5, make_model = $6, swl_kg = $7, owner_employer_id = $8, status = $9, status_reason = $10,
                                next_exam_due = $11::date, version = version + 1, updated_at = now() where id = $1 returning *""",
            [a["id"], inp.area_id, inp.asset_class, inp.tag_no, inp.serial_no, inp.make_model, inp.swl_kg, inp.owner_employer_id, inp.status, inp.status_reason, inp.next_exam_due], c,
        )
        await audit(c, org_id=user.org_id, actor=user, action="update", record_type="asset", record_id=a["id"], site_id=a["site_id"],
                    changes={k: [a[k], row[k]] for k in ("tag_no", "status", "status_reason", "asset_class") if a[k] != row[k]})
    return JSON(asset_view(row))


@router.delete("/assets/{asset_id}")
async def delete_asset(asset_id: str, request: Request, user: AuthUser = Depends(console_user)):
    a = await db.one("select * from assets where id = $1", [uuid_param(asset_id)])
    if not a:
        raise not_found()
    need_site_config(user, a["site_id"])
    reason = (await json_body(request) or {}).get("reason") or request.query_params.get("reason") or ""
    async with db.tx() as c:
        await c.execute("update assets set status = 'retired', deleted_at = now(), deleted_by = $2, delete_reason = $3, version = version + 1, updated_at = now() where id = $1", a["id"], user.id, reason)
        await c.execute("update qr_codes set active = false where target_type = 'asset' and target_id = $1", a["id"])
        await audit(c, org_id=user.org_id, actor=user, action="delete", record_type="asset", record_id=a["id"], site_id=a["site_id"], reason=reason)
    return JSON({"ok": True})


@router.post("/assets/import")
async def import_assets(request: Request, user: AuthUser = Depends(console_user)):
    need_write(user)
    rows = await read_csv(request, ["site_code", "tag_no", "asset_class"])
    created = updated = skipped = 0
    errors = []
    classes = {"lifting_appliance", "lifting_gear", "pressure_plant", "boiler", "extinguisher", "first_aid_box", "ladder", "scaffold", "harness", "earth_pit", "insulating_mat", "rcd", "earth_moving", "vehicle", "machine", "other"}
    async with db.tx() as c:
        for i, r in enumerate(rows, start=2):
            site = await db.one("select id from sites where org_id = $1 and code = $2 and deleted_at is null", [user.org_id, r.get("site_code", "").upper()], c)
            if not site or not (user.is_admin or user.is_hse or user.is_officer_plus(site["id"])):
                errors.append({"row": i, "message": f"unknown site {r.get('site_code')}"})
                skipped += 1
                continue
            if not r.get("tag_no") or r.get("asset_class") not in classes:
                errors.append({"row": i, "message": "tag_no and a valid asset_class are required"})
                skipped += 1
                continue
            area_id = None
            if r.get("area_code"):
                ar = await db.one("select id from areas where site_id = $1 and code = $2 and deleted_at is null", [site["id"], r["area_code"]], c)
                area_id = ar["id"] if ar else None
            swl = float(r["swl_kg"]) if r.get("swl_kg") else None
            existing = await db.one("select id from assets where site_id = $1 and tag_no = $2", [site["id"], r["tag_no"]], c)
            if existing:
                await c.execute("update assets set asset_class = $2, serial_no = $3, make_model = $4, swl_kg = $5, area_id = coalesce($6, area_id), deleted_at = null, version = version + 1, updated_at = now() where id = $1",
                                existing["id"], r["asset_class"], r.get("serial_no", ""), r.get("make_model", ""), swl, area_id)
                updated += 1
            else:
                await c.execute("insert into assets (org_id, site_id, area_id, asset_class, tag_no, serial_no, make_model, swl_kg) values ($1,$2,$3,$4,$5,$6,$7,$8)",
                                user.org_id, site["id"], area_id, r["asset_class"], r["tag_no"], r.get("serial_no", ""), r.get("make_model", ""), swl)
                created += 1
        await audit(c, org_id=user.org_id, actor=user, action="create", record_type="asset", record_id="import", changes={"created": created, "updated": updated, "skipped": skipped})
    return JSON({"created": created, "updated": updated, "skipped": skipped, "errors": errors})


