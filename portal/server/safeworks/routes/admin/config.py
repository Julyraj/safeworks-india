"""Admin: categories, risk matrices and versions, due-date rules, ladders, rule sets, industries, organisation settings."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ... import db
from ...audit import audit
from ...errors import HttpError, bad_request, forbidden, not_found
from ...http import JSON, json_body, uuid_param
from ...i18n import clear_overrides
from ...rbac import AuthUser
from ...schemas import (CategoryIn, DueDateRuleIn, LadderIn, MatrixVersionIn, OrgSettingsIn, ReorderBody, RuleSetEnableBody, parse)
from ...settings import clear_org_cache, get_org, merge_settings, org_settings
from ...views import category as category_view, due_date_rule, industry as industry_view, ladder as ladder_view, matrix_version, rule_set as rule_set_view
from ._common import console_user, need_admin, need_safety_config

router = APIRouter(prefix="/api/v1/admin")


# ---------- categories ----------

@router.get("/categories")
async def list_categories(request: Request, user: AuthUser = Depends(console_user)):
    include_inactive = request.query_params.get("all") == "1"
    rows = await db.q("select * from categories where org_id = $1 and deleted_at is null and ($2 or active) order by sort, code", [user.org_id, include_inactive])
    return JSON([category_view(c) for c in rows])


def _extra_fields(inp: CategoryIn) -> list[dict]:
    out = []
    for f in inp.extra_fields:
        out.append({"key": f.key, "label": f.label.dump(), "type": f.type, "options": [o.dump() for o in (f.options or [])] or None, "required": f.required})
    return out


@router.post("/categories")
async def create_category(request: Request, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    inp = parse(CategoryIn, await json_body(request))
    if not inp.code:
        raise bad_request("code: required")
    if await db.one("select 1 from categories where org_id = $1 and code = $2", [user.org_id, inp.code]):
        raise HttpError(409, "This code is already in use.", "conflict", key="err.duplicate_code")
    async with db.tx() as c:
        row = await db.one(
            """insert into categories (org_id, code, parent_code, name_i18n, icon, applies_to, critical_capable, incident_prompt, is3786_default, extra_fields, default_recipient_roles,
                                       email_detail, sort, active) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *""",
            [user.org_id, inp.code, inp.parent_code, inp.name.dump(), inp.icon, inp.applies_to, inp.critical_capable, inp.incident_prompt, inp.is3786_default, _extra_fields(inp),
             inp.default_recipient_roles, inp.email_detail, inp.sort, inp.active], c,
        )
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="category", record_id=row["id"], changes={"code": inp.code, "name": inp.name.dump()})
    return JSON(category_view(row), status_code=201)


@router.put("/categories/{cat_id}")
async def update_category(cat_id: str, request: Request, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    cat = await db.one("select * from categories where id = $1 and org_id = $2", [uuid_param(cat_id), user.org_id])
    if not cat:
        raise not_found()
    inp = parse(CategoryIn, await json_body(request))
    async with db.tx() as c:
        row = await db.one(
            """update categories set parent_code = $2, name_i18n = $3, icon = $4, applies_to = $5, critical_capable = $6, incident_prompt = $7, is3786_default = $8, extra_fields = $9,
                                     default_recipient_roles = $10, email_detail = $11, sort = $12, active = $13, version = version + 1, updated_at = now() where id = $1 returning *""",
            [cat["id"], inp.parent_code, inp.name.dump(), inp.icon, inp.applies_to, inp.critical_capable, inp.incident_prompt, inp.is3786_default, _extra_fields(inp),
             inp.default_recipient_roles, inp.email_detail, inp.sort, inp.active], c,
        )
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="category", record_id=cat["id"],
                    changes={"name": [cat["name_i18n"], row["name_i18n"]], "active": [cat["active"], row["active"]], "criticalCapable": [cat["critical_capable"], row["critical_capable"]]})
    return JSON(category_view(row))


@router.delete("/categories/{cat_id}")
async def delete_category(cat_id: str, request: Request, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    cat = await db.one("select * from categories where id = $1 and org_id = $2", [uuid_param(cat_id), user.org_id])
    if not cat:
        raise not_found()
    reason = (await json_body(request) or {}).get("reason") or ""
    async with db.tx() as c:
        await c.execute("update categories set active = false, deleted_at = now(), deleted_by = $2, delete_reason = $3, updated_at = now() where id = $1", cat["id"], user.id, reason)
        await audit(c, org_id=user.org_id, actor=user, action="delete", record_type="category", record_id=cat["id"], reason=reason)
    return JSON({"ok": True})


@router.post("/categories/reorder")
async def reorder_categories(request: Request, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    inp = parse(ReorderBody, await json_body(request))
    async with db.tx() as c:
        for i, cid in enumerate(inp.ids):
            await c.execute("update categories set sort = $2, updated_at = now() where id = $1 and org_id = $3", cid, i, user.org_id)
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="category", record_id="reorder", changes={"order": inp.ids})
    rows = await db.q("select * from categories where org_id = $1 and deleted_at is null order by sort, code", [user.org_id])
    return JSON([category_view(r) for r in rows])


# ---------- risk matrices ----------

async def _matrix_out(conn, org_id: str) -> list[dict]:
    settings = await org_settings(org_id, conn)
    label = settings["statusLabels"].get("risk_matrix", "design default")
    matrices = await db.q("select * from risk_matrices where org_id = $1 order by created_at", [org_id], conn)
    out = []
    for m in matrices:
        versions = await db.q("select v.*, $2::text as name, $3::int as size from risk_matrix_versions v where v.matrix_id = $1 order by v.version", [m["id"], m["name"], m["size"]], conn)
        out.append({"id": m["id"], "name": m["name"], "size": m["size"], "versions": [matrix_version({**v, "status_label": label}) for v in versions]})
    return out


@router.get("/risk-matrices")
async def list_matrices(user: AuthUser = Depends(console_user)):
    return JSON(await _matrix_out(None, user.org_id))


@router.post("/risk-matrices/{matrix_id}/versions")
async def new_matrix_version(matrix_id: str, request: Request, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    m = await db.one("select * from risk_matrices where id = $1 and org_id = $2", [uuid_param(matrix_id), user.org_id])
    if not m:
        raise not_found()
    inp = parse(MatrixVersionIn, await json_body(request) or {})
    cur = await db.one("select * from risk_matrix_versions where matrix_id = $1 order by (status = 'active') desc, version desc limit 1", [m["id"]])
    async with db.tx() as c:
        n = (await c.fetchval("select coalesce(max(version), 0) + 1 from risk_matrix_versions where matrix_id = $1", m["id"]))
        row = await db.one(
            "insert into risk_matrix_versions (matrix_id, version, likelihood_labels, severity_labels, bands, status, effective_from) values ($1,$2,$3,$4,$5,'draft',$6::text::date) returning *",
            [m["id"], n, [x.model_dump(by_alias=True) for x in inp.likelihood_labels] if inp.likelihood_labels else (cur["likelihood_labels"] if cur else []),
             [x.model_dump(by_alias=True) for x in inp.severity_labels] if inp.severity_labels else (cur["severity_labels"] if cur else []),
             [x.model_dump(by_alias=True) for x in inp.bands] if inp.bands else (cur["bands"] if cur else []), inp.effective_from], c,
        )
        await c.execute("update risk_matrix_versions set approved_by = null where id = $1", row["id"])
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="risk_matrix_version", record_id=row["id"], changes={"matrixId": m["id"], "version": n, "author": user.id})
        # record the author in the audit trail (the table keeps approver only); the approver ≠ author rule reads the audit row
    return JSON(matrix_version({**row, "name": m["name"], "size": m["size"], "status_label": "draft"}), status_code=201)


@router.put("/risk-matrix-versions/{version_id}")
async def update_matrix_version(version_id: str, request: Request, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    v = await db.one("select v.*, m.name, m.size, m.org_id from risk_matrix_versions v join risk_matrices m on m.id = v.matrix_id where v.id = $1 and m.org_id = $2", [uuid_param(version_id), user.org_id])
    if not v:
        raise not_found()
    if v["status"] != "draft":
        raise bad_request("Only a draft version can be edited.", key="err.version_not_draft")
    inp = parse(MatrixVersionIn, await json_body(request))
    async with db.tx() as c:
        row = await db.one(
            "update risk_matrix_versions set likelihood_labels = coalesce($2, likelihood_labels), severity_labels = coalesce($3, severity_labels), bands = coalesce($4, bands), effective_from = coalesce($5::text::date, effective_from) where id = $1 returning *",
            [v["id"], [x.model_dump(by_alias=True) for x in inp.likelihood_labels] if inp.likelihood_labels else None,
             [x.model_dump(by_alias=True) for x in inp.severity_labels] if inp.severity_labels else None,
             [x.model_dump(by_alias=True) for x in inp.bands] if inp.bands else None, inp.effective_from], c,
        )
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="risk_matrix_version", record_id=v["id"], changes={"edited": True, "author": user.id})
    return JSON(matrix_version({**row, "name": v["name"], "size": v["size"], "status_label": "draft"}))


@router.post("/risk-matrix-versions/{version_id}/activate")
async def activate_matrix_version(version_id: str, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    v = await db.one("select v.*, m.name, m.size from risk_matrix_versions v join risk_matrices m on m.id = v.matrix_id where v.id = $1 and m.org_id = $2", [uuid_param(version_id), user.org_id])
    if not v:
        raise not_found()
    if v["status"] != "draft":
        raise bad_request("Only a draft version can be activated.", key="err.version_not_draft")
    author = await db.one("select actor_user_id from audit_log where record_type = 'risk_matrix_version' and record_id = $1 and action = 'config_change' order by id limit 1", [v["id"]])
    if author and author["actor_user_id"] == user.id:
        raise forbidden("The author cannot approve their own version.", key="err.approver_is_author")
    async with db.tx() as c:
        await c.execute("update risk_matrix_versions set status = 'retired' where matrix_id = $1 and status = 'active'", v["matrix_id"])
        row = await db.one("update risk_matrix_versions set status = 'active', approved_by = $2, effective_from = coalesce(effective_from, current_date) where id = $1 returning *", [v["id"], user.id], c)
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="risk_matrix_version", record_id=v["id"], changes={"status": ["draft", "active"], "approvedBy": user.id})
    return JSON(matrix_version({**row, "name": v["name"], "size": v["size"], "status_label": "active"}))


# ---------- due-date rules, ladders ----------

@router.get("/due-date-rules")
async def list_due_rules(user: AuthUser = Depends(console_user)):
    rows = await db.q("select * from due_date_rules where org_id = $1 order by site_id nulls first, array_position(array['low','moderate','high','extreme'], band)", [user.org_id])
    return JSON([due_date_rule(r) for r in rows])


@router.put("/due-date-rules")
async def put_due_rules(request: Request, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    body = await json_body(request)
    items = [parse(DueDateRuleIn, x) for x in (body if isinstance(body, list) else body.get("items", []))]
    async with db.tx() as c:
        for r in items:
            await c.execute(
                """insert into due_date_rules (org_id, site_id, band, due_amount, due_unit, interim_control_required, verify_within_hours, status_label)
                   values ($1,$2,$3,$4,$5,$6,$7,$8)
                   on conflict (org_id, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid), band) do update set due_amount = excluded.due_amount, due_unit = excluded.due_unit,
                     interim_control_required = excluded.interim_control_required, verify_within_hours = excluded.verify_within_hours, status_label = excluded.status_label, updated_at = now()""",
                user.org_id, r.site_id, r.band, r.due_amount, r.due_unit, r.interim_control_required, r.verify_within_hours, r.status_label,
            )
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="due_date_rules", record_id="all", changes={"rules": [x.model_dump(by_alias=True) for x in items]})
    return await list_due_rules(user)


@router.get("/ladders")
async def list_ladders(user: AuthUser = Depends(console_user)):
    rows = await db.q("select * from reminder_ladders where org_id = $1 order by array_position(array['low','moderate','high','extreme'], band)", [user.org_id])
    return JSON([ladder_view(r) for r in rows])


@router.put("/ladders")
async def put_ladders(request: Request, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    body = await json_body(request)
    items = [parse(LadderIn, x) for x in (body if isinstance(body, list) else body.get("items", []))]
    async with db.tx() as c:
        for l in items:
            await c.execute(
                """insert into reminder_ladders (org_id, band, steps, daily_cap, status_label) values ($1,$2,$3,$4,$5)
                   on conflict (org_id, band) do update set steps = excluded.steps, daily_cap = excluded.daily_cap, status_label = excluded.status_label, updated_at = now()""",
                user.org_id, l.band, [s.model_dump(by_alias=True) for s in l.steps], l.daily_cap, l.status_label,
            )
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="reminder_ladders", record_id="all", changes={"ladders": [x.model_dump(by_alias=True) for x in items]})
    return await list_ladders(user)


# ---------- rule sets ----------

async def _rule_sets(conn=None) -> list[dict]:
    sets = await db.q("select * from rule_sets order by state, code", [], conn)
    timers = await db.q("select * from timer_rules order by rule_set_code, id", [], conn)
    by_code: dict[str, list[dict]] = {}
    for t in timers:
        by_code.setdefault(t["rule_set_code"], []).append(t)
    return [rule_set_view(s, by_code.get(s["code"], [])) for s in sets]


@router.get("/rule-sets")
async def list_rule_sets(user: AuthUser = Depends(console_user)):
    return JSON(await _rule_sets())


@router.post("/rule-sets/{code}/enable")
async def enable_rule_set(code: str, request: Request, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    rs = await db.one("select * from rule_sets where code = $1", [code])
    if not rs:
        raise not_found()
    inp = parse(RuleSetEnableBody, await json_body(request) or {})
    reviewed_by = inp.reviewed_by or rs["reviewed_by"]
    if rs["status"] == "draft_rule":  # shipped disabled: a draft rule can be named a reviewer but never enabled (API.md)
        raise bad_request("A draft rule pack needs a named reviewer before it can be enabled.", key="err.rule_set_draft")
    missing = await db.one("select count(*)::int as n from timer_rules where rule_set_code = $1 and deadline_minutes is null", [code])
    if missing and missing["n"]:
        raise bad_request("A timer rule without a reviewed deadline cannot be enabled.", key="err.timer_no_deadline")
    async with db.tx() as c:
        await c.execute("update rule_sets set enabled = true, reviewed_by = $2, reviewed_at = now() where code = $1", code, reviewed_by)
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="rule_set", record_id=code, changes={"enabled": [rs["enabled"], True], "reviewedBy": reviewed_by})
    return JSON([r for r in await _rule_sets() if r["code"] == code][0])


@router.post("/rule-sets/{code}/disable")
async def disable_rule_set(code: str, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    rs = await db.one("select * from rule_sets where code = $1", [code])
    if not rs:
        raise not_found()
    async with db.tx() as c:
        await c.execute("update rule_sets set enabled = false where code = $1", code)
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="rule_set", record_id=code, changes={"enabled": [rs["enabled"], False]})
    return JSON([r for r in await _rule_sets() if r["code"] == code][0])


# ---------- industries ----------

@router.get("/industries")
async def list_industries(user: AuthUser = Depends(console_user)):
    rows = await db.q("select * from industry_profiles where active order by sort, code")
    return JSON([industry_view(r) for r in rows])


# ---------- settings ----------

@router.get("/settings")
async def get_settings(user: AuthUser = Depends(console_user)):
    org = await get_org(user.org_id)
    return JSON({"name": org["name"], "legalName": org["legalName"], "address": org["address"], "phone": org["phone"], **org["settings"]})


@router.put("/settings")
async def put_settings(request: Request, user: AuthUser = Depends(console_user)):
    if not (user.is_admin or user.is_hse):
        raise forbidden()
    body = await json_body(request)
    inp = parse(OrgSettingsIn, body)
    org = await db.one("select * from organisations where id = $1", [user.org_id])
    # accept either {settings: {...}} or the flat OrgSettings shape
    flat = {k: v for k, v in body.items() if k not in ("name", "legalName", "address", "phone", "settings")}
    new_settings = merge_settings({**(org["settings"] or {}), **(inp.settings or {}), **flat})
    if not user.is_admin and (inp.name or inp.legal_name or inp.address or inp.phone):
        need_admin(user)
    async with db.tx() as c:
        await c.execute(
            "update organisations set name = coalesce($2, name), legal_name = coalesce($3, legal_name), address = coalesce($4, address), phone = coalesce($5, phone), settings = $6, updated_at = now() where id = $1",
            user.org_id, inp.name, inp.legal_name, inp.address, inp.phone, new_settings,
        )
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="organisation", record_id=user.org_id,
                    changes={"settings": [merge_settings(org["settings"]), new_settings], "name": [org["name"], inp.name or org["name"]], "phone": inp.phone})
    clear_org_cache(user.org_id)
    clear_overrides(user.org_id)
    return await get_settings(user)
