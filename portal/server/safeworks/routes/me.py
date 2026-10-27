"""Who am I, preferences, devices (Web Push), privacy acknowledgement, notifications inbox."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from .. import db
from ..audit import audit
from ..auth import forget_user_in_cache, require_user
from ..errors import HttpError, not_found
from ..http import JSON, json_body, page_params
from ..profile import me_payload
from ..rbac import AuthUser
from ..schemas import Preferences, PrivacyAck, PushSubscriptionBody, parse
from ..views import notification, paged

router = APIRouter(prefix="/api/v1/me")


@router.get("")
async def me(user: AuthUser = Depends(require_user(allow_must_change=True))):
    return JSON(await me_payload(user))


@router.put("/preferences")
async def preferences(request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(Preferences, await json_body(request))
    async with db.tx() as c:
        await c.execute("update users set language = $2, preferences = $3, updated_at = now() where id = $1", user.id, inp.language,
                        {"digest": inp.digest, "quietHours": inp.quiet_hours})
        await audit(c, org_id=user.org_id, actor=user, action="update", record_type="user", record_id=user.id, changes={"preferences": inp.model_dump(by_alias=True)})
    forget_user_in_cache(user.id)
    user.language = inp.language
    return JSON(await me_payload(user))


@router.post("/devices")
async def devices(request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(PushSubscriptionBody, await json_body(request))
    async with db.tx() as c:
        await c.execute(
            """insert into devices (user_id, device_uuid, platform, app_version, push_subscription, last_seen_at)
               values ($1, $2, $3, $4, $5, now())
               on conflict (device_uuid) do update set user_id = excluded.user_id, platform = coalesce(nullif(excluded.platform, ''), devices.platform),
                   app_version = coalesce(nullif(excluded.app_version, ''), devices.app_version), push_subscription = excluded.push_subscription, last_seen_at = now(), revoked_at = null""",
            user.id, inp.device_uuid[:200], inp.platform, inp.app_version, inp.subscription if inp.subscription else None,
        )
    return JSON({"ok": True})


@router.post("/privacy-ack")
async def privacy_ack(request: Request, user: AuthUser = Depends(require_user(allow_must_change=True))):
    inp = parse(PrivacyAck, await json_body(request))
    exists = await db.one("select 1 from privacy_notices where org_id = $1 and version = $2", [user.org_id, inp.version])
    if not exists:
        raise HttpError(400, "Unknown privacy notice version.", "bad_request", key="err.privacy_version")
    async with db.tx() as c:
        await c.execute("insert into privacy_acks (user_id, notice_version, channel) values ($1, $2, $3)", user.id, inp.version, user.kind)
        await audit(c, org_id=user.org_id, actor=user, action="update", record_type="privacy_ack", record_id=user.id, changes={"version": inp.version})
    return JSON({"ok": True})


@router.get("/notifications")
async def notifications(request: Request, user: AuthUser = Depends(require_user())):
    page, size = page_params(request, 50, 200)
    unread = request.query_params.get("unread") == "1"
    where = "recipient_user_id = $1 and channel = 'inapp'" + (" and read_at is null" if unread else "")
    total = await db.one(f"select count(*)::int as n from notifications where {where}", [user.id])
    rows = await db.q(f"select * from notifications where {where} order by created_at desc limit $2 offset $3", [user.id, size, (page - 1) * size])
    return JSON(paged([notification(r) for r in rows], total["n"], page, size))


@router.post("/notifications/read-all")
async def read_all(user: AuthUser = Depends(require_user())):
    await db.execute("update notifications set read_at = now() where recipient_user_id = $1 and channel = 'inapp' and read_at is null", [user.id])
    return JSON({"ok": True})


@router.post("/notifications/{nid}/read")
async def read_one(nid: int, user: AuthUser = Depends(require_user())):
    row = await db.one("update notifications set read_at = coalesce(read_at, now()) where id = $1 and recipient_user_id = $2 returning id", [nid, user.id])
    if not row:
        raise not_found()
    return JSON({"ok": True})


@router.post("/notifications/{nid}/ack")
async def ack_one(nid: int, user: AuthUser = Depends(require_user())):
    row = await db.one("select * from notifications where id = $1 and recipient_user_id = $2", [nid, user.id])
    if not row:
        raise not_found()
    async with db.tx() as c:
        await c.execute("update notifications set read_at = coalesce(read_at, now()), acked_at = coalesce(acked_at, now()), status = 'acknowledged' where id = $1", nid)
        if row["critical"] and row["record_type"] == "observation" and row["record_id"]:
            from ..workflow import observations as obs_wf
            try:
                await obs_wf.ack_critical(c, user, row["record_id"])
            except HttpError:
                pass
    return JSON({"ok": True})
