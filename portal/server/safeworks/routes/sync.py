"""POST /sync/push and GET /sync/pull — the field app's main channel."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ..auth import require_user
from ..http import JSON, json_body, lang_of
from ..ratelimit import Limiter
from ..rbac import AuthUser
from ..schemas import SyncPushRequest, parse
from ..sync import pull, push

router = APIRouter(prefix="/api/v1/sync")
push_limiter = Limiter(60)


@router.post("/push")
async def sync_push(request: Request, user: AuthUser = Depends(require_user())):
    inp = parse(SyncPushRequest, await json_body(request))
    push_limiter.check(f"push:{inp.device_id}", 120)  # brief §14.2: 120 requests per device per minute
    return JSON(await push(user, inp, lang_of(request)))


@router.get("/pull")
async def sync_pull(request: Request, user: AuthUser = Depends(require_user())):
    q = request.query_params
    return JSON(await pull(user, q.get("cursor"), q.get("deviceId")))
