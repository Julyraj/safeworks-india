"""Admin: inspection templates, versions (draft → in_review → active → retired), copies, schedules."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ... import db
from ...audit import audit
from ...errors import HttpError, bad_request, forbidden, not_found
from ...http import JSON, json_body, opt_uuid, uuid_param
from ...rbac import AuthUser
from ...scheduling import ensure_scheduled_run, next_due
from ...schemas import ScheduleIn, SectionIn, TemplateCopyBody, TemplateIn, TemplateVersionIn, parse
from ...views import load_template_versions, schedule as schedule_view
from ...workflow.common import now
from ._common import console_user, need_safety_config, need_site_config, need_write, scope_sites

router = APIRouter(prefix="/api/v1/admin/inspections")


async def _template(tid: str, user: AuthUser) -> dict:
    t = await db.one("select * from inspection_templates where id = $1 and org_id = $2 and deleted_at is null", [tid, user.org_id])
    if not t:
        raise not_found()
    return t


async def _write_sections(conn, version_id: str, sections: list[SectionIn]) -> None:
    await conn.execute("delete from inspection_questions where section_id in (select id from inspection_sections where version_id = $1)", version_id)
    await conn.execute("delete from inspection_sections where version_id = $1", version_id)
    for si, s in enumerate(sections):
        sec = await db.one("insert into inspection_sections (version_id, sort, title_i18n, repeatable, repeat_label) values ($1,$2,$3,$4,$5) returning id",
                           [version_id, s.sort or si, s.title.dump(), s.repeatable, s.repeat_label], conn)
        for qi, q in enumerate(s.questions):
            rs = [{"value": o.value, "label": o.label.dump(), "colour": o.colour, "flag": o.flag, "score": o.score} for o in q.response_set]
            if q.answer_type == "pass_fail_na" and not rs:
                rs = DEFAULT_PFN
            await conn.execute(
                """insert into inspection_questions (section_id, sort, code, text_i18n, guidance_i18n, answer_type, response_set, unit, min, max, pass_min, pass_max, required, photo_on_fail,
                                                     note_on_fail, action_on_fail, action_defaults, show_if, reference_text, reference_status)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)""",
                sec["id"], q.sort or qi, q.code or f"Q{qi + 1}", q.text.dump(), q.guidance.dump() if q.guidance else {}, q.answer_type, rs, q.unit, q.min, q.max, q.pass_min, q.pass_max,
                q.required, q.photo_on_fail, q.note_on_fail, q.action_on_fail, q.action_defaults, q.show_if, q.reference_text, q.reference_status,
            )


DEFAULT_PFN = [
    {"value": "pass", "label": {"en": "Pass", "hi": "ठीक", "ta": "சரி", "kn": "ಸರಿ"}, "colour": "green", "flag": False, "score": 1},
    {"value": "fail", "label": {"en": "Fail", "hi": "असफल", "ta": "தவறு", "kn": "ವಿಫಲ"}, "colour": "red", "flag": True, "score": 0},
    {"value": "na", "label": {"en": "N/A", "hi": "लागू नहीं", "ta": "பொருந்தாது", "kn": "ಅನ್ವಯಿಸದು"}, "colour": "grey", "flag": False, "score": None},
]


async def _copy_sections(conn, from_version: str, to_version: str) -> None:
    secs = await db.q("select * from inspection_sections where version_id = $1 order by sort, id", [from_version], conn)
    for s in secs:
        new = await db.one("insert into inspection_sections (version_id, sort, title_i18n, repeatable, repeat_label) values ($1,$2,$3,$4,$5) returning id",
                           [to_version, s["sort"], s["title_i18n"], s["repeatable"], s["repeat_label"]], conn)
        await conn.execute(
            """insert into inspection_questions (section_id, sort, code, text_i18n, guidance_i18n, guidance_media_id, answer_type, response_set, unit, min, max, pass_min, pass_max, required,
                                                 photo_on_fail, note_on_fail, action_on_fail, action_defaults, show_if, reference_text, reference_status)
               select $2, sort, code, text_i18n, guidance_i18n, guidance_media_id, answer_type, response_set, unit, min, max, pass_min, pass_max, required, photo_on_fail, note_on_fail,
                      action_on_fail, action_defaults, show_if, reference_text, reference_status from inspection_questions where section_id = $1 order by sort, id""",
            s["id"], new["id"],
        )


async def _out(conn, template_id: str) -> dict:
    t = await db.one("select * from inspection_templates where id = $1", [template_id], conn)
    versions = await db.q("select id from inspection_template_versions where template_id = $1 order by version", [template_id], conn)
    docs = await load_template_versions(conn, [v["id"] for v in versions])
    return {"id": t["id"], "code": t["code"], "name": t["name_i18n"], "type": t["type"], "appliesTo": t["applies_to"] or {}, "activeVersionId": t["active_version_id"],
            "ownerUserId": t["owner_user_id"], "updatedAt": t["updated_at"], "versions": docs}


@router.get("/templates")
async def list_templates(user: AuthUser = Depends(console_user)):
    rows = await db.q(
        """select t.*, v.version as active_version_no, (select count(*) from inspection_template_versions x where x.template_id = t.id)::int as version_count,
                  (select max(x.version) from inspection_template_versions x where x.template_id = t.id and x.status = 'draft') as draft_version
             from inspection_templates t left join inspection_template_versions v on v.id = t.active_version_id where t.org_id = $1 and t.deleted_at is null order by t.code""", [user.org_id])
    return JSON([{"id": t["id"], "code": t["code"], "name": t["name_i18n"], "type": t["type"], "appliesTo": t["applies_to"] or {}, "activeVersionId": t["active_version_id"],
                  "activeVersion": t["active_version_no"], "versionCount": t["version_count"], "draftVersion": t["draft_version"], "updatedAt": t["updated_at"]} for t in rows])


@router.post("/templates")
async def create_template(request: Request, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    inp = parse(TemplateIn, await json_body(request))
    if await db.one("select 1 from inspection_templates where org_id = $1 and code = $2", [user.org_id, inp.code]):
        raise HttpError(409, "This code is already in use.", "conflict", key="err.duplicate_code")
    async with db.tx() as c:
        t = await db.one("insert into inspection_templates (org_id, code, name_i18n, type, applies_to, owner_user_id) values ($1,$2,$3,$4,$5,$6) returning id",
                         [user.org_id, inp.code, inp.name.dump(), inp.type, inp.applies_to, user.id], c)
        v = await db.one("insert into inspection_template_versions (template_id, version, status, title_fields, scoring, required_competence_type, author_id) values ($1,1,'draft',$2,$3,$4,$5) returning id",
                         [t["id"], inp.title_fields, inp.scoring, inp.required_competence_type, user.id], c)
        await _write_sections(c, v["id"], inp.sections)
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="inspection_template", record_id=t["id"], changes={"code": inp.code, "version": 1})
        out = await _out(c, t["id"])
    return JSON(out, status_code=201)


@router.get("/templates/{tid}")
async def get_template(tid: str, user: AuthUser = Depends(console_user)):
    t = await _template(uuid_param(tid), user)
    return JSON(await _out(None, t["id"]))


@router.delete("/templates/{tid}")
async def delete_template(tid: str, request: Request, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    t = await _template(uuid_param(tid), user)
    reason = (await json_body(request) or {}).get("reason") or ""
    async with db.tx() as c:
        await c.execute("update inspection_templates set deleted_at = now(), deleted_by = $2, delete_reason = $3, updated_at = now() where id = $1", t["id"], user.id, reason)
        await c.execute("update inspection_schedules set active = false, updated_at = now() where template_id = $1", t["id"])
        await audit(c, org_id=user.org_id, actor=user, action="delete", record_type="inspection_template", record_id=t["id"], reason=reason)
    return JSON({"ok": True})


@router.post("/templates/{tid}/versions")
async def new_version(tid: str, request: Request, user: AuthUser = Depends(console_user)):
    """A new draft copied from the latest version (editing an active template never changes it: brief §17.2 test 16)."""
    need_safety_config(user)
    t = await _template(uuid_param(tid), user)
    inp = parse(TemplateVersionIn, await json_body(request) or {})
    latest = await db.one("select * from inspection_template_versions where template_id = $1 order by version desc limit 1", [t["id"]])
    async with db.tx() as c:
        v = await db.one(
            "insert into inspection_template_versions (template_id, version, status, title_fields, scoring, required_competence_type, author_id, change_note) values ($1,$2,'draft',$3,$4,$5,$6,$7) returning id",
            [t["id"], (latest["version"] if latest else 0) + 1, inp.title_fields or (latest["title_fields"] if latest else []), inp.scoring or (latest["scoring"] if latest else {}),
             inp.required_competence_type if inp.required_competence_type is not None else (latest["required_competence_type"] if latest else ""), user.id, inp.change_note or ""], c,
        )
        if inp.sections is not None:
            await _write_sections(c, v["id"], inp.sections)
        elif latest:
            await _copy_sections(c, latest["id"], v["id"])
        if inp.name or inp.applies_to is not None:
            await c.execute("update inspection_templates set name_i18n = coalesce($2, name_i18n), applies_to = coalesce($3, applies_to), updated_at = now() where id = $1",
                            t["id"], inp.name.dump() if inp.name else None, inp.applies_to)
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="inspection_template_version", record_id=v["id"], changes={"templateId": t["id"], "status": "draft"})
        out = (await load_template_versions(c, [v["id"]]))[0]
    return JSON(out, status_code=201)


async def _version(vid: str, user: AuthUser) -> dict:
    v = await db.one("select v.*, t.org_id from inspection_template_versions v join inspection_templates t on t.id = v.template_id where v.id = $1 and t.org_id = $2 and t.deleted_at is null", [vid, user.org_id])
    if not v:
        raise not_found()
    return v


@router.put("/template-versions/{vid}")
async def update_version(vid: str, request: Request, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    v = await _version(uuid_param(vid), user)
    if v["status"] != "draft":
        raise bad_request("Only a draft version can be edited.", key="err.version_not_draft")
    inp = parse(TemplateVersionIn, await json_body(request))
    async with db.tx() as c:
        await c.execute(
            "update inspection_template_versions set title_fields = coalesce($2, title_fields), scoring = coalesce($3, scoring), required_competence_type = coalesce($4, required_competence_type), change_note = coalesce($5, change_note) where id = $1",
            v["id"], inp.title_fields, inp.scoring, inp.required_competence_type, inp.change_note,
        )
        if inp.sections is not None:
            await _write_sections(c, v["id"], inp.sections)
        if inp.name or inp.applies_to is not None:
            await c.execute("update inspection_templates set name_i18n = coalesce($2, name_i18n), applies_to = coalesce($3, applies_to), updated_at = now() where id = $1",
                            v["template_id"], inp.name.dump() if inp.name else None, inp.applies_to)
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="inspection_template_version", record_id=v["id"], changes={"edited": True})
        out = (await load_template_versions(c, [v["id"]]))[0]
    return JSON(out)


@router.post("/template-versions/{vid}/submit")
async def submit_version(vid: str, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    v = await _version(uuid_param(vid), user)
    if v["status"] != "draft":
        raise bad_request("Only a draft version can be submitted for review.", key="err.version_not_draft")
    async with db.tx() as c:
        await c.execute("update inspection_template_versions set status = 'in_review' where id = $1", v["id"])
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="inspection_template_version", record_id=v["id"], changes={"status": ["draft", "in_review"]})
        out = (await load_template_versions(c, [v["id"]]))[0]
    return JSON(out)


@router.post("/template-versions/{vid}/approve")
async def approve_version(vid: str, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    v = await _version(uuid_param(vid), user)
    if v["status"] not in ("draft", "in_review"):
        raise bad_request("Only a draft or in-review version can be approved.", key="err.version_not_draft")
    if v["author_id"] == user.id:
        raise forbidden("The author cannot approve their own version.", key="err.approver_is_author")
    async with db.tx() as c:
        await c.execute("update inspection_template_versions set status = 'retired' where template_id = $1 and status = 'active'", v["template_id"])
        await c.execute("update inspection_template_versions set status = 'active', approved_by = $2, approved_at = now() where id = $1", v["id"], user.id)
        await c.execute("update inspection_templates set active_version_id = $2, version = version + 1, updated_at = now() where id = $1", v["template_id"], v["id"])
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="inspection_template_version", record_id=v["id"], changes={"status": [v["status"], "active"], "approvedBy": user.id})
        out = (await load_template_versions(c, [v["id"]]))[0]
    return JSON(out)


@router.post("/template-versions/{vid}/retire")
async def retire_version(vid: str, user: AuthUser = Depends(console_user)):
    need_safety_config(user)
    v = await _version(uuid_param(vid), user)
    async with db.tx() as c:
        await c.execute("update inspection_template_versions set status = 'retired' where id = $1", v["id"])
        await c.execute("update inspection_templates set active_version_id = null, version = version + 1, updated_at = now() where id = $1 and active_version_id = $2", v["template_id"], v["id"])
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="inspection_template_version", record_id=v["id"], changes={"status": [v["status"], "retired"]})
        out = (await load_template_versions(c, [v["id"]]))[0]
    return JSON(out)


@router.post("/templates/{tid}/copy")
async def copy_template(tid: str, request: Request, user: AuthUser = Depends(console_user)):
    need_write(user)
    if not (user.is_admin or user.is_hse or user.officer_sites()):
        raise forbidden()
    t = await _template(uuid_param(tid), user)
    inp = parse(TemplateCopyBody, await json_body(request))
    if await db.one("select 1 from inspection_templates where org_id = $1 and code = $2", [user.org_id, inp.code]):
        raise HttpError(409, "This code is already in use.", "conflict", key="err.duplicate_code")
    src = await db.one("select * from inspection_template_versions where template_id = $1 order by (status = 'active') desc, version desc limit 1", [t["id"]])
    async with db.tx() as c:
        nt = await db.one("insert into inspection_templates (org_id, code, name_i18n, type, applies_to, owner_user_id) values ($1,$2,$3,$4,$5,$6) returning id",
                          [user.org_id, inp.code, inp.name.dump() if inp.name else {**t["name_i18n"], "en": f"{t['name_i18n'].get('en', '')} (copy)"}, t["type"], t["applies_to"], user.id], c)
        nv = await db.one("insert into inspection_template_versions (template_id, version, status, title_fields, scoring, required_competence_type, author_id, change_note) values ($1,1,'draft',$2,$3,$4,$5,$6) returning id",
                          [nt["id"], src["title_fields"] if src else [], src["scoring"] if src else {}, src["required_competence_type"] if src else "", user.id, f"Copied from {t['code']}"], c)
        if src:
            await _copy_sections(c, src["id"], nv["id"])
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="inspection_template", record_id=nt["id"], changes={"copiedFrom": t["id"], "code": inp.code})
        out = await _out(c, nt["id"])
    return JSON(out, status_code=201)


# ---------- schedules ----------

@router.get("/schedules")
async def list_schedules(request: Request, user: AuthUser = Depends(console_user)):
    sites = scope_sites(user, opt_uuid(request.query_params.get("siteId")))
    rows = await db.q("select * from inspection_schedules where org_id = $1 and site_id = any($2::uuid[]) order by site_id, next_due_at", [user.org_id, sites])
    return JSON([schedule_view(s) for s in rows])


def _check_freq(freq: dict) -> None:
    if not isinstance(freq, dict) or freq.get("unit") not in ("day", "week", "month") or not freq.get("time") or not freq.get("every"):
        raise bad_request("Schedule frequency needs every, unit and time.", key="err.schedule_frequency")


@router.post("/schedules")
async def create_schedule(request: Request, user: AuthUser = Depends(console_user)):
    inp = parse(ScheduleIn, await json_body(request))
    need_site_config(user, inp.site_id)
    _check_freq(inp.frequency)
    await _template(inp.template_id, user)
    async with db.tx() as c:
        row = await db.one(
            """insert into inspection_schedules (org_id, template_id, site_id, area_id, asset_id, frequency, assignee_user_id, assignee_role, lead_days, grace_hours, next_due_at, active)
               values ($1,$2,$3,$4,$5,$6,$7,$8::role_t,$9,$10,$11,$12) returning *""",
            [user.org_id, inp.template_id, inp.site_id, inp.area_id, inp.asset_id, inp.frequency, inp.assignee_user_id, inp.assignee_role, inp.lead_days, inp.grace_hours,
             next_due(inp.frequency, now()), inp.active], c,
        )
        await ensure_scheduled_run(c, row)
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="inspection_schedule", record_id=row["id"], site_id=inp.site_id, changes={"templateId": inp.template_id, "frequency": inp.frequency})
        row = await db.one("select * from inspection_schedules where id = $1", [row["id"]], c)
    return JSON(schedule_view(row), status_code=201)


@router.put("/schedules/{sid}")
async def update_schedule(sid: str, request: Request, user: AuthUser = Depends(console_user)):
    s = await db.one("select * from inspection_schedules where id = $1 and org_id = $2", [uuid_param(sid), user.org_id])
    if not s:
        raise not_found()
    need_site_config(user, s["site_id"])
    inp = parse(ScheduleIn, await json_body(request))
    _check_freq(inp.frequency)
    async with db.tx() as c:
        row = await db.one(
            """update inspection_schedules set template_id = $2, area_id = $3, asset_id = $4, frequency = $5, assignee_user_id = $6, assignee_role = $7::role_t, lead_days = $8, grace_hours = $9,
                                               next_due_at = $10, active = $11, updated_at = now() where id = $1 returning *""",
            [s["id"], inp.template_id, inp.area_id, inp.asset_id, inp.frequency, inp.assignee_user_id, inp.assignee_role, inp.lead_days, inp.grace_hours, next_due(inp.frequency, now()), inp.active], c,
        )
        await ensure_scheduled_run(c, row)
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="inspection_schedule", record_id=s["id"], site_id=s["site_id"], changes={"frequency": [s["frequency"], inp.frequency], "active": [s["active"], inp.active]})
        row = await db.one("select * from inspection_schedules where id = $1", [s["id"]], c)
    return JSON(schedule_view(row))


@router.delete("/schedules/{sid}")
async def delete_schedule(sid: str, user: AuthUser = Depends(console_user)):
    s = await db.one("select * from inspection_schedules where id = $1 and org_id = $2", [uuid_param(sid), user.org_id])
    if not s:
        raise not_found()
    need_site_config(user, s["site_id"])
    async with db.tx() as c:
        await c.execute("update inspection_schedules set active = false, updated_at = now() where id = $1", s["id"])
        await c.execute("update inspection_runs set status = 'cancelled', updated_at = now() where schedule_id = $1 and status = 'scheduled'", s["id"])
        await audit(c, org_id=user.org_id, actor=user, action="delete", record_type="inspection_schedule", record_id=s["id"], site_id=s["site_id"])
    return JSON({"ok": True})
