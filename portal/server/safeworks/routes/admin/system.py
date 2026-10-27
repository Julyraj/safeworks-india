"""Admin: translations, audit log (+ chain verify), notifications log, privacy notices/requests, retention, legal holds, health."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from starlette.responses import Response

from ... import db
from ...audit import audit, verify_chain
from ...config import PORTAL_ROOT, config
from ...errors import bad_request, not_found
from ...http import JSON, json_body, page_params, parse_dt, uuid_param
from ...i18n import LANGS, clear_overrides, keys as pack_keys, load_overrides, norm_lang, pack
from ...rbac import AuthUser
from ...retention import dry_run
from ...schemas import LegalHoldIn, PrivacyNoticeIn, PrivacyRequestIn, PrivacyRequestUpdate, RetentionPolicyIn, TranslationsPut, parse
from ...views import audit_row, paged
from ._common import console_user, need_admin

router = APIRouter(prefix="/api/v1/admin")


# ---------- translations ----------

def _web_keys() -> list[str] | None:
    p = PORTAL_ROOT / "web" / "src" / "shared" / "i18n" / "en.json"
    if p.is_file():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            return sorted(k for k in data.keys() if not k.startswith("_"))
        except Exception:
            return None
    return None


async def _pack_out(org_id: str, lang: str) -> dict:
    lang = norm_lang(lang)
    overrides = (await load_overrides(org_id)).get(lang, {})
    web = _web_keys()
    base_keys = web if web else pack_keys()
    repo = pack(lang) if not web else {}
    if web:
        wp = PORTAL_ROOT / "web" / "src" / "shared" / "i18n" / f"{lang}.json"
        if wp.is_file():
            try:
                repo = json.loads(wp.read_text(encoding="utf-8"))
            except Exception:
                repo = {}
    translated = [k for k in base_keys if (overrides.get(k) or repo.get(k))]
    missing = [k for k in base_keys if k not in translated]
    return {"lang": lang, "total": len(base_keys), "translated": len(translated), "missing": missing, "overrides": overrides, "source": "web" if web else "server"}


@router.get("/translations")
async def get_translations(request: Request, user: AuthUser = Depends(console_user)):
    return JSON(await _pack_out(user.org_id, request.query_params.get("lang", "en")))


@router.put("/translations/{lang}")
async def put_translations(lang: str, request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    if lang not in LANGS:
        raise not_found()
    inp = parse(TranslationsPut, await json_body(request))
    async with db.tx() as c:
        for k, v in inp.overrides.items():
            if v is None or v == "":
                await c.execute("delete from translations where org_id = $1 and key = $2 and lang = $3", user.org_id, k, lang)
            else:
                await c.execute(
                    """insert into translations (org_id, key, lang, text, updated_by) values ($1,$2,$3,$4,$5)
                       on conflict (org_id, key, lang) do update set text = excluded.text, updated_by = excluded.updated_by, updated_at = now()""", user.org_id, k[:200], lang, v[:2000], user.id)
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="translations", record_id=lang, changes={"keys": sorted(inp.overrides.keys())[:200]})
    clear_overrides(user.org_id)
    return JSON(await _pack_out(user.org_id, lang))


@router.get("/translations/export")
async def export_translations(request: Request, user: AuthUser = Depends(console_user)):
    lang = norm_lang(request.query_params.get("lang", "en"))
    out = await _pack_out(user.org_id, lang)
    merged = {**pack(lang), **out["overrides"]}
    body = json.dumps({"lang": lang, "_status": "export", "strings": merged}, ensure_ascii=False, indent=2)
    return Response(body, media_type="application/json; charset=utf-8", headers={"content-disposition": f'attachment; filename="safeworks-{lang}.json"'})


@router.post("/translations/import")
async def import_translations(request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    body = await json_body(request)
    if not isinstance(body, dict):
        raise bad_request("Expected {lang, strings}.")
    lang = norm_lang(body.get("lang", "en"))
    strings = body.get("strings") or body.get("overrides") or {}
    if not isinstance(strings, dict):
        raise bad_request("strings must be an object of key → text.")
    n = 0
    async with db.tx() as c:
        for k, v in strings.items():
            if isinstance(v, str) and v:
                await c.execute(
                    """insert into translations (org_id, key, lang, text, updated_by) values ($1,$2,$3,$4,$5)
                       on conflict (org_id, key, lang) do update set text = excluded.text, updated_by = excluded.updated_by, updated_at = now()""", user.org_id, str(k)[:200], lang, v[:2000], user.id)
                n += 1
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="translations", record_id=lang, changes={"imported": n})
    clear_overrides(user.org_id)
    return JSON({"imported": n, **(await _pack_out(user.org_id, lang))})


# ---------- audit log ----------

@router.get("/audit-log")
async def audit_log(request: Request, user: AuthUser = Depends(console_user)):
    q = request.query_params
    page, size = page_params(request, 100, 500)
    params: list = [user.org_id]
    where = ["l.org_id = $1"]
    if not user.is_all_sites_role:
        params.append(user.sites_in_scope())
        where.append(f"(l.site_id = any(${len(params)}::uuid[]) or l.actor_user_id = '{user.id}'::uuid)")
    if q.get("from"):
        params.append(parse_dt(q["from"]))
        where.append(f"l.at >= ${len(params)}")
    if q.get("to"):
        params.append(parse_dt(q["to"], end_of_day=True))
        where.append(f"l.at <= ${len(params)}")
    if q.get("actor"):
        params.append(f"%{q['actor']}%")
        where.append(f"(coalesce(p.full_name, '') ilike ${len(params)} or coalesce(u.employee_code, '') ilike ${len(params)} or l.actor_user_id::text = trim(both '%' from ${len(params)}))")
    if q.get("action"):
        params.append(q["action"])
        where.append(f"l.action = ${len(params)}")
    if q.get("recordType"):
        params.append(q["recordType"])
        where.append(f"l.record_type = ${len(params)}")
    if q.get("recordId"):
        params.append(q["recordId"])
        where.append(f"l.record_id = ${len(params)}")
    if q.get("siteId"):
        params.append(uuid_param(q["siteId"]))
        where.append(f"l.site_id = ${len(params)}")
    base = "from audit_log l left join users u on u.id = l.actor_user_id left join people p on p.id = u.person_id left join sites s on s.id = l.site_id"
    total = await db.one(f"select count(*)::int as n {base} where {' and '.join(where)}", params)
    rows = await db.q(f"select l.*, coalesce(p.full_name, u.employee_code) as actor_name, s.code as site_code {base} where {' and '.join(where)} order by l.id desc limit {size} offset {(page - 1) * size}", params)
    return JSON(paged([audit_row(r) for r in rows], total["n"], page, size))


@router.post("/audit-log/verify")
async def audit_verify(user: AuthUser = Depends(console_user)):
    result = await verify_chain(user.org_id)
    async with db.tx() as c:
        await audit(c, org_id=user.org_id, actor=user, action="view_sensitive", record_type="audit_log", record_id="verify", changes={"ok": result["ok"], "rows": result["rows"], "firstBadId": result["firstBadId"]})
    return JSON(result)


# ---------- notifications log ----------

@router.get("/notifications-log")
async def notifications_log(request: Request, user: AuthUser = Depends(console_user)):
    if not (user.is_admin or user.is_hse):
        raise not_found()
    q = request.query_params
    page, size = page_params(request, 100, 500)
    params: list = [user.org_id]
    where = ["n.org_id = $1"]
    for key, col in (("status", "status"), ("channel", "channel"), ("eventType", "event_type")):
        if q.get(key):
            params.append(q[key])
            where.append(f"n.{col} = ${len(params)}")
    if q.get("from"):
        params.append(parse_dt(q["from"]))
        where.append(f"n.created_at >= ${len(params)}")
    total = await db.one(f"select count(*)::int as n from notifications n where {' and '.join(where)}", params)
    rows = await db.q(
        f"""select n.*, coalesce(p.full_name, u.employee_code) as recipient_name from notifications n join users u on u.id = n.recipient_user_id left join people p on p.id = u.person_id
             where {' and '.join(where)} order by n.id desc limit {size} offset {(page - 1) * size}""", params)
    items = [{"id": r["id"], "eventType": r["event_type"], "recordType": r["record_type"], "recordId": r["record_id"], "recipientName": r["recipient_name"], "channel": r["channel"],
              "language": r["language"], "title": r["title"], "critical": r["critical"], "status": r["status"], "attempts": r["attempts"], "sentAt": r["sent_at"], "error": r["error"],
              "costEstimateInr": float(r["cost_estimate_inr"]), "createdAt": r["created_at"]} for r in rows]
    return JSON(paged(items, total["n"], page, size))


# ---------- privacy ----------

@router.get("/privacy/notices")
async def list_notices(user: AuthUser = Depends(console_user)):
    rows = await db.q("select * from privacy_notices where org_id = $1 order by version desc, lang", [user.org_id])
    by_v: dict[int, dict] = {}
    for r in rows:
        v = by_v.setdefault(r["version"], {"version": r["version"], "status": r["status"], "effectiveFrom": r["effective_from"], "body": {}, "createdAt": r["created_at"]})
        v["body"][r["lang"]] = r["body"]
    return JSON(sorted(by_v.values(), key=lambda x: -x["version"]))


@router.post("/privacy/notices")
async def create_notice(request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    inp = parse(PrivacyNoticeIn, await json_body(request))
    if "en" not in inp.body or not inp.body["en"]:
        raise bad_request("body.en: required")
    async with db.tx() as c:
        version = inp.version or ((await c.fetchval("select coalesce(max(version), 0) from privacy_notices where org_id = $1", user.org_id)) + 1)
        await c.execute("update privacy_notices set status = 'retired' where org_id = $1 and status = 'active' and version <> $2", user.org_id, version)
        for lang, body in inp.body.items():
            if lang in LANGS and body:
                await c.execute(
                    """insert into privacy_notices (org_id, version, lang, body, effective_from, status) values ($1,$2,$3,$4,$5::date,'active')
                       on conflict (org_id, version, lang) do update set body = excluded.body, effective_from = excluded.effective_from, status = 'active'""", user.org_id, version, lang, body, inp.effective_from)
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="privacy_notice", record_id=str(version), changes={"langs": sorted(inp.body.keys()), "effectiveFrom": inp.effective_from})
    return await list_notices(user)


@router.get("/privacy/requests")
async def list_requests(user: AuthUser = Depends(console_user)):
    need_admin(user)
    rows = await db.q("select * from privacy_requests where org_id = $1 order by received_at desc", [user.org_id])
    return JSON([{"id": r["id"], "personName": r["person_name"], "identifier": r["identifier"], "type": r["type"], "details": r["details"], "receivedAt": r["received_at"],
                  "dueAt": r["due_at"], "status": r["status"], "handledBy": r["handled_by"], "response": r["response"], "closedAt": r["closed_at"]} for r in rows])


@router.post("/privacy/requests")
async def create_request(request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    inp = parse(PrivacyRequestIn, await json_body(request))
    async with db.tx() as c:
        row = await db.one("insert into privacy_requests (org_id, person_name, identifier, type, details, due_at) values ($1,$2,$3,$4,$5, now() + interval '30 days') returning id",
                           [user.org_id, inp.person_name, inp.identifier, inp.type, inp.details], c)
        await audit(c, org_id=user.org_id, actor=user, action="create", record_type="privacy_request", record_id=row["id"], changes={"type": inp.type, "identifier": inp.identifier})
    return await list_requests(user)


@router.put("/privacy/requests/{rid}")
async def update_request(rid: str, request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    r = await db.one("select * from privacy_requests where id = $1 and org_id = $2", [uuid_param(rid), user.org_id])
    if not r:
        raise not_found()
    inp = parse(PrivacyRequestUpdate, await json_body(request))
    async with db.tx() as c:
        await c.execute(
            "update privacy_requests set status = coalesce($2, status), response = coalesce($3, response), handled_by = $4, closed_at = case when $2 in ('answered','rejected') then now() else closed_at end where id = $1",
            r["id"], inp.status, inp.response, user.id,
        )
        await audit(c, org_id=user.org_id, actor=user, action="update", record_type="privacy_request", record_id=r["id"], changes={"status": [r["status"], inp.status]})
    return await list_requests(user)


# ---------- retention, legal holds ----------

@router.get("/retention-policies")
async def list_policies(user: AuthUser = Depends(console_user)):
    rows = await db.q("select * from retention_policies where org_id = $1 order by record_type", [user.org_id])
    return JSON([{"id": r["id"], "recordType": r["record_type"], "retentionYears": r["retention_years"], "basisNote": r["basis_note"], "endAction": r["end_action"], "statusLabel": r["status_label"]} for r in rows])


@router.put("/retention-policies")
async def put_policies(request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    body = await json_body(request)
    items = [parse(RetentionPolicyIn, x) for x in (body if isinstance(body, list) else body.get("items", []))]
    async with db.tx() as c:
        for p in items:
            await c.execute(
                """insert into retention_policies (org_id, record_type, retention_years, basis_note, end_action, status_label) values ($1,$2,$3,$4,$5,$6)
                   on conflict (org_id, record_type) do update set retention_years = excluded.retention_years, basis_note = excluded.basis_note, end_action = excluded.end_action, status_label = excluded.status_label""",
                user.org_id, p.record_type, p.retention_years, p.basis_note, p.end_action, p.status_label)
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="retention_policies", record_id="all", changes={"policies": [x.model_dump(by_alias=True) for x in items]})
    return await list_policies(user)


@router.get("/legal-holds")
async def list_holds(user: AuthUser = Depends(console_user)):
    rows = await db.q("select * from legal_holds where org_id = $1 order by placed_at desc", [user.org_id])
    return JSON([{"id": r["id"], "scopeType": r["scope_type"], "scopeId": r["scope_id"], "reason": r["reason"], "placedBy": r["placed_by"], "placedAt": r["placed_at"], "releasedAt": r["released_at"], "releasedBy": r["released_by"]} for r in rows])


@router.post("/legal-holds")
async def create_hold(request: Request, user: AuthUser = Depends(console_user)):
    need_admin(user)
    inp = parse(LegalHoldIn, await json_body(request))
    async with db.tx() as c:
        row = await db.one("insert into legal_holds (org_id, scope_type, scope_id, reason, placed_by) values ($1,$2,$3,$4,$5) returning id", [user.org_id, inp.scope_type, inp.scope_id, inp.reason, user.id], c)
        await audit(c, org_id=user.org_id, actor=user, action="create", record_type="legal_hold", record_id=row["id"], changes={"scopeType": inp.scope_type, "scopeId": inp.scope_id}, reason=inp.reason)
    return await list_holds(user)


@router.post("/legal-holds/{hid}/release")
async def release_hold(hid: str, user: AuthUser = Depends(console_user)):
    need_admin(user)
    async with db.tx() as c:
        row = await db.one("update legal_holds set released_at = now(), released_by = $2 where id = $1 and org_id = $3 and released_at is null returning id", [uuid_param(hid), user.id, user.org_id], c)
        if not row:
            raise not_found()
        await audit(c, org_id=user.org_id, actor=user, action="update", record_type="legal_hold", record_id=row["id"], changes={"released": True})
    return await list_holds(user)


@router.post("/retention/dry-run")
async def retention_dry_run(user: AuthUser = Depends(console_user)):
    need_admin(user)
    result = await dry_run(user.org_id)
    async with db.tx() as c:
        await audit(c, org_id=user.org_id, actor=user, action="view_sensitive", record_type="retention", record_id="dry-run", changes=result)
    return JSON(result)


# ---------- health ----------

@router.get("/health")
async def admin_health(user: AuthUser = Depends(console_user)):
    if not (user.is_admin or user.is_hse):
        raise not_found()
    try:
        await db.execute("select 1")
        db_ok = "ok"
    except Exception:
        db_ok = "error"
    queued = await db.one("select count(*)::int as n from email_outbox where sent_at is null")
    failed = await db.one("select count(*)::int as n from notifications where org_id = $1 and status = 'failed' and created_at > now() - interval '24 hours'", [user.org_id])
    rejected = await db.one("select count(*)::int as n from sync_commands where result_status = 'rejected' and received_at > now() - interval '24 hours'")
    versions = await db.q("select coalesce(nullif(app_version, ''), 'unknown') as app_version, count(*)::int as count from devices where revoked_at is null and last_seen_at > now() - interval '30 days' group by 1 order by 2 desc")
    jobs = await db.q("select key, at from job_marks where key like 'job:%' order by key")
    backup = await db.one("select at from job_marks where key = 'backup:last'")
    return JSON({
        "serverTime": datetime.now(timezone.utc), "version": config.version, "db": db_ok, "storageDriver": config.storage_driver, "queuedEmails": queued["n"],
        "failedNotifications24h": failed["n"], "syncRejected24h": rejected["n"], "devicesByVersion": [{"appVersion": v["app_version"], "count": v["count"]} for v in versions],
        "lastJobRuns": [{"key": j["key"][4:], "at": j["at"]} for j in jobs],
        "backups": {"lastAt": backup["at"] if backup else None, "note": "deploy/backup.sh writes job_marks key backup:last; on Render use the managed database backups."},
        "smtpConfigured": bool(config.smtp_url), "pushConfigured": bool(config.vapid_private_key and config.vapid_public_key),
        "uptimeHint": (datetime.now(timezone.utc) - timedelta(seconds=0)).isoformat(),
    })


