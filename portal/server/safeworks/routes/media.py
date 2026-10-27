"""PUT /media/{clientUuid} (raw bytes), GET /media/{id}."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from .. import db
from ..audit import audit
from ..auth import require_user
from ..errors import not_found
from ..http import JSON, uuid_param
from ..media import can_view_media, get_media_row, store_upload
from ..rbac import AuthUser
from ..upload import read_raw_upload
from ..views import media as media_view

router = APIRouter(prefix="/api/v1/media")


@router.put("/{client_uuid}")
async def upload(client_uuid: str, request: Request, user: AuthUser = Depends(require_user())):
    client_uuid = uuid_param(client_uuid)
    row = await get_media_row(None, client_uuid=client_uuid)
    if not await can_view_media(None, user, row):
        raise not_found()
    up = await read_raw_upload(request)
    async with db.tx() as c:
        out = await store_upload(c, row, up)
        await audit(c, org_id=row["org_id"], actor=user, action="update", record_type="media", record_id=row["id"],
                    changes={"ownerType": row["owner_type"], "ownerId": row["owner_id"], "bytes": len(up.data), "hashMatch": out["hashMatch"], "mime": up.mime})
    return JSON(out)


@router.get("/{media_id}")
async def get_media(media_id: str, user: AuthUser = Depends(require_user())):
    row = await get_media_row(None, media_id=uuid_param(media_id))
    if not await can_view_media(None, user, row):
        raise not_found()
    return JSON(media_view(row))
