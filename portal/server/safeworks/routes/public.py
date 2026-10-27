"""No-login routes: QR info and submission, public upload tickets, status link, health and version."""
from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timezone

from fastapi import APIRouter, Request

from .. import db
from ..audit import audit
from ..config import config
from ..errors import HttpError, bad_request, not_found, rate_limited
from ..http import JSON, client_ip, json_body, lang_of
from ..i18n import LANGS, from_accept_language, t
from ..media import client_uuid_from_ticket, get_media_row, store_upload, uploads_for
from ..schemas import QrObservationCreate, parse
from ..settings import org_settings
from ..upload import read_raw_upload
from ..views import category as category_view
from ..workflow import observations as obs_wf
from ..workflow.common import DuplicateRecord

router = APIRouter(prefix="/api/v1")


async def _qr(token: str) -> dict:
    row = await db.one("select * from qr_codes where token = $1", [token])
    if not row:
        raise not_found()
    if not row["active"]:
        raise HttpError(410, "This QR code is no longer active.", "not_found", key="err.qr_inactive")
    return row


async def _target(qr: dict) -> tuple[dict, dict | None, dict | None]:
    site = area = asset = None
    if qr["target_type"] == "site":
        site = await db.one("select * from sites where id = $1 and deleted_at is null and active", [qr["target_id"]])
    elif qr["target_type"] == "area":
        area = await db.one("select * from areas where id = $1 and deleted_at is null and active", [qr["target_id"]])
        if area:
            site = await db.one("select * from sites where id = $1 and deleted_at is null and active", [area["site_id"]])
    else:
        asset = await db.one("select * from assets where id = $1 and deleted_at is null", [qr["target_id"]])
        if asset:
            site = await db.one("select * from sites where id = $1 and deleted_at is null and active", [asset["site_id"]])
            if asset["area_id"]:
                area = await db.one("select * from areas where id = $1 and deleted_at is null", [asset["area_id"]])
    if not site:
        raise not_found()
    return site, area, asset


@router.get("/public/qr/{token}")
async def qr_info(token: str, request: Request):
    qr = await _qr(token)
    site, area, asset = await _target(qr)
    await db.execute("update qr_codes set scan_count = scan_count + 1, last_scan_at = now() where id = $1", [qr["id"]])
    settings = await org_settings(site["org_id"])
    cats = await db.q("select * from categories where org_id = $1 and active and deleted_at is null order by sort, code", [site["org_id"]])
    ind = site["industry_code"]
    cats = [c for c in cats if not ((c["applies_to"] or {}).get("industries")) or ind in (c["applies_to"] or {}).get("industries", [])]
    notices = await db.q("select lang, body from privacy_notices where org_id = $1 and status = 'active' and version = (select max(version) from privacy_notices where org_id = $1 and status = 'active')", [site["org_id"]])
    org = await db.one("select name from organisations where id = $1", [site["org_id"]])
    return JSON({
        "token": token, "site": {"id": site["id"], "code": site["code"], "name": site["name_i18n"]},
        "area": {"id": area["id"], "name": area["name_i18n"]} if area else None,
        "asset": {"id": asset["id"], "tagNo": asset["tag_no"], "assetClass": asset["asset_class"]} if asset else None,
        "areas": [{"id": a["id"], "name": a["name_i18n"]} for a in await db.q("select id, name_i18n from areas where site_id = $1 and active and deleted_at is null order by sort", [site["id"]])] if not area else [],
        "categories": [category_view(c) for c in cats], "languages": settings.get("languages", list(LANGS)), "defaultLanguage": settings.get("defaultLanguage", "en"),
        "privacyNotice": {n["lang"]: n["body"] for n in notices}, "orgName": org["name"] if org else "", "maxPhotos": int(settings.get("maxPhotosQuickForm", 3)),
        "prefill": qr["prefill"] or {},
    })


async def _bump_counter(conn, key: str, limit: int) -> bool:
    """Fixed hourly window in the database (shared by every server process). True when within the limit."""
    row = await db.one(
        """insert into public_rate_counters (key, window_start, count) values ($1, date_trunc('hour', now()), 1)
           on conflict (key) do update set count = case when public_rate_counters.window_start < date_trunc('hour', now()) then 1 else public_rate_counters.count + 1 end,
                                            window_start = date_trunc('hour', now())
           returning count""",
        [key], conn,
    )
    return row["count"] <= limit


@router.post("/public/qr/{token}/observations")
async def qr_submit(token: str, request: Request):
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > config.qr_max_payload:
        raise HttpError(413, "The upload is too large.", "too_large", key="err.too_large", params={"mb": config.qr_max_payload // (1024 * 1024)})
    qr = await _qr(token)
    site, area, asset = await _target(qr)
    body = await json_body(request)
    if isinstance(body, dict) and body.get("honeypot"):
        raise bad_request("The form could not be accepted.", key="err.honeypot")
    inp = parse(QrObservationCreate, body)
    if inp.honeypot:
        raise bad_request("The form could not be accepted.", key="err.honeypot")
    if len(inp.media) > 10:
        raise bad_request("At most 10 photos per record.", key="err.photo_limit", max=10)
    ip = client_ip(request)
    hour = datetime.now(timezone.utc).strftime("%Y%m%d%H")
    ip_hash = hashlib.sha256(f"{config.ip_hash_salt}|{ip}|{datetime.now(timezone.utc).date()}".encode()).hexdigest()[:32]
    lang = lang_of(request)
    async with db.tx() as c:
        if not await _bump_counter(c, f"qr:{token}:{hour}", config.qr_per_token_hour):
            raise rate_limited(t("err.qr_token_limit", lang), key="err.qr_token_limit")
        if not await _bump_counter(c, f"ip:{ip_hash}:{hour}", config.qr_per_ip_hour):
            raise rate_limited(t("err.qr_ip_limit", lang), key="err.qr_ip_limit")
        await c.execute("delete from public_rate_counters where window_start < now() - interval '24 hours'")
    area_id = area["id"] if area else None
    if not area_id and isinstance(body, dict) and body.get("areaId"):
        a = await db.one("select id from areas where id = $1::uuid and site_id = $2 and deleted_at is null", [str(body["areaId"]), site["id"]])
        area_id = a["id"] if a else None
    contact = {"name": inp.name, "phone": inp.phone, "employerName": inp.employer_name}
    async with db.tx() as c:
        try:
            o, uploads = await obs_wf.create(c, None, inp, site=site, area_id=area_id, asset_id=asset["id"] if asset else None, channel="qr",
                                             device_id=f"qr:{token[:8]}", qr_contact=contact)
        except DuplicateRecord as d:
            o = await db.one("select * from observations where id = $1", [d.record_id], c)
            rows = await db.q("select * from media where owner_type = 'observation' and owner_id = $1 and upload_status = 'pending'", [d.record_id], c)
            uploads = uploads_for(rows, public=True)
    status_url = f"{config.public_url}/q/status/{o['case_no']}?s={o['status_secret']}"
    return JSON({"caseNo": o["case_no"], "statusUrl": status_url, "uploads": uploads}, status_code=201)


@router.put("/public/upload/{ticket}")
async def public_upload(ticket: str, request: Request):
    client_uuid = client_uuid_from_ticket(ticket)
    if not client_uuid:
        raise HttpError(403, "This link has expired. Refresh the page.", "forbidden", key="err.link_expired")
    row = await get_media_row(None, client_uuid=client_uuid)
    if row["owner_type"] != "observation" or row["created_by"] is not None:
        raise not_found()
    up = await read_raw_upload(request)
    async with db.tx() as c:
        out = await store_upload(c, row, up)
        await audit(c, org_id=row["org_id"], actor_role="public", action="update", record_type="media", record_id=row["id"],
                    changes={"ownerType": row["owner_type"], "ownerId": row["owner_id"], "bytes": len(up.data), "hashMatch": out["hashMatch"]})
    return JSON(out)


@router.get("/public/status/{case_no}")
async def public_status(case_no: str, request: Request):
    secret = request.query_params.get("s", "")
    o = await db.one("select * from observations where case_no = $1", [case_no.upper()])
    if not o or not o["status_secret"] or not secret or not _safe_eq(o["status_secret"], secret):
        raise HttpError(404, "This status link is not valid.", "not_found", key="err.status_secret_invalid")
    lang = from_accept_language(request.headers.get("accept-language"))
    if request.query_params.get("lang") in LANGS:
        lang = request.query_params["lang"]
    actions = await db.q("select case_no, status, updated_at from actions where source_type = 'observation' and source_id = $1 and status <> 'cancelled' order by created_at", [o["id"]])
    decisions = await db.q("select decision, decided_at from triage_decisions where observation_id = $1 order by decided_at", [o["id"]])
    return JSON(obs_wf.public_status(o, actions, decisions, lang))


def _safe_eq(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


@router.get("/health")
async def health():
    try:
        await db.execute("select 1")
        ok = True
    except Exception:
        ok = False
    return JSON({"ok": ok, "version": config.version, "time": datetime.now(timezone.utc)}, status_code=200 if ok else 503)


@router.get("/version")
async def version():
    return JSON({"version": config.version, "serverTime": datetime.now(timezone.utc)})
