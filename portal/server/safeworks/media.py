"""Media rows (photos, voice notes, signatures, reports) and the raw upload path.

Text first: a record's payload carries `MediaRef`s; each becomes a `media` row with `upload_status = pending` and the
response lists one `PUT /api/v1/media/{clientUuid}` URL per file. The bytes follow; the server sniffs the type, checks
the capture hash (`hash_match`), stores the file and never re-encodes it. Repeating an upload is idempotent.
"""
from __future__ import annotations

import time
from typing import Any

from . import db
from .config import config
from .crypto import hmac_id
from .errors import bad_request, not_found
from .rbac import AuthUser
from .schemas import MediaRef
from .security import sign_ticket, verify_ticket
from .storage import media_key, storage
from .upload import UploadedFile
from .views import media as media_view

ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "audio/webm", "audio/mp4", "audio/ogg", "application/pdf", "text/html"}


def upload_url(client_uuid: str) -> str:
    return f"/api/v1/media/{client_uuid}"


def public_upload_ticket(client_uuid: str) -> str:
    return sign_ticket("upload", client_uuid, int(time.time()) + 3600)


def public_upload_url(client_uuid: str) -> str:
    return f"/api/v1/public/upload/{public_upload_ticket(client_uuid)}"


def client_uuid_from_ticket(ticket: str) -> str | None:
    return verify_ticket("upload", ticket)


async def create_media_rows(conn, *, org_id: str, owner_type: str, owner_id: str, refs: list[MediaRef], created_by: str | None,
                            device_id: str = "", max_photos: int = 10, public: bool = False) -> tuple[list[dict], list[dict]]:
    """Insert pending media rows for `refs`. Returns (rows, uploads) where uploads = [{clientUuid, url}]."""
    if not refs:
        return [], []
    photos = [r for r in refs if r.kind in ("photo", "signature")]
    existing = await db.one("select count(*)::int as n from media where owner_type = $1 and owner_id = $2 and kind = 'photo'", [owner_type, owner_id], conn)
    if len(photos) + (existing["n"] if existing else 0) > max_photos:
        raise bad_request(f"At most {max_photos} photos per record.", key="err.photo_limit", max=max_photos)
    rows: list[dict] = []
    uploads: list[dict] = []
    for ref in refs:
        mime = (ref.mime or "").lower().split(";")[0]
        if mime not in ALLOWED_MIME or (ref.kind == "audio" and not mime.startswith("audio/")) or (ref.kind == "photo" and not mime.startswith("image/")):
            raise bad_request("Only JPEG, PNG or WebP photos and WebM, MP4 or OGG voice notes are accepted.", key="err.media_type")
        if ref.kind == "audio" and ref.duration_s and ref.duration_s > 60.5:
            raise bad_request("Voice notes may be up to 60 seconds.", key="err.audio_limit")
        if ref.bytes > config.max_media_bytes:
            raise bad_request(f"The upload is too large (limit {config.max_media_bytes // (1024 * 1024)} MB).", key="err.too_large", mb=config.max_media_bytes // (1024 * 1024))
        row = await db.one(
            """insert into media (client_uuid, org_id, owner_type, owner_id, kind, purpose, storage_key, mime, bytes, width, height, duration_s, sha256_capture,
                                 captured_at, device_id, lat, lng, annotation, redacted, upload_status, created_by)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'pending',$20)
               on conflict (client_uuid) do update set annotation = excluded.annotation
               returning *""",
            [ref.client_uuid.lower(), org_id, owner_type, owner_id, ref.kind, ref.purpose, media_key(ref.kind, mime), mime, ref.bytes, ref.width, ref.height,
             ref.duration_s, ref.sha256.lower(), ref.captured_at, device_id or "", ref.lat, ref.lng, ref.annotation, ref.redacted, created_by],
            conn,
        )
        if row["owner_id"] != owner_id or row["owner_type"] != owner_type:
            raise bad_request("This file belongs to another record.", key="err.media_owner")
        rows.append(row)
        if row["upload_status"] == "pending":
            uploads.append({"clientUuid": row["client_uuid"], "url": public_upload_url(row["client_uuid"]) if public else upload_url(row["client_uuid"])})
    return rows, uploads


async def store_upload(conn, row: dict, up: UploadedFile) -> dict:
    """Store the bytes for a media row (idempotent) and return the Media view."""
    if row["kind"] == "photo" and up.kind != "photo" or row["kind"] == "audio" and up.kind != "audio":
        raise bad_request("The file type does not match the media record.", key="err.media_type")
    if row["upload_status"] in ("uploaded", "verified") and row["sha256_server"] == up.sha256:
        return media_view(row)
    key = row["storage_key"]
    if not key.endswith("." + up.ext):
        key = key.rsplit(".", 1)[0] + "." + up.ext
    await storage.put(key, up.data, up.mime)
    hash_match = up.sha256 == (row["sha256_capture"] or "").lower()
    updated = await db.one(
        """update media set storage_key = $2, mime = $3, bytes = $4, width = coalesce($5, width), height = coalesce($6, height), sha256_server = $7,
                            hash_match = $8, upload_status = $9, received_at = now()
            where id = $1 returning *""",
        [row["id"], key, up.mime, len(up.data), up.width, up.height, up.sha256, hash_match, "verified" if hash_match else "uploaded"],
        conn,
    )
    return media_view(updated)


async def record_site(conn, owner_type: str, owner_id: str) -> dict | None:
    """{site_id, reporter_user_id?, owner_user_id?, inspector_user_id?, ...} of the record a media row belongs to."""
    if owner_type == "observation":
        return await db.one("select site_id, reporter_user_id, id as observation_id from observations where id = $1", [owner_id], conn)
    if owner_type == "action_event":  # media.owner_id is the event's client_uuid (events are keyed by bigserial)
        return await db.one(
            "select a.site_id, a.owner_user_id, a.verifier_user_id, a.completed_by, a.id as action_id from action_events e join actions a on a.id = e.action_id where e.client_uuid = $1::uuid",
            [owner_id], conn,
        )
    if owner_type == "inspection_answer":
        return await db.one("select r.site_id, r.inspector_user_id from inspection_answers ia join inspection_runs r on r.id = ia.run_id where ia.id = $1", [owner_id], conn)
    if owner_type == "inspection_run":
        return await db.one("select site_id, inspector_user_id from inspection_runs where id = $1", [owner_id], conn)
    if owner_type == "comment":
        return await db.one(
            """select coalesce(o.site_id, r.site_id) as site_id, o.reporter_user_id, c.user_id as owner_user_id from comments c
                 left join observations o on c.owner_type = 'observation' and o.id = c.owner_id
                 left join inspection_runs r on c.owner_type = 'inspection_run' and r.id = c.owner_id where c.id = $1""",
            [owner_id], conn,
        )
    if owner_type == "asset":
        return await db.one("select site_id from assets where id = $1", [owner_id], conn)
    if owner_type == "incident":
        return await db.one("select site_id from incidents where id = $1", [owner_id], conn)
    return None


async def can_view_media(conn, user: AuthUser, row: dict) -> bool:
    if row["created_by"] == user.id:
        return True
    rec = await record_site(conn, row["owner_type"], row["owner_id"])
    if not rec or not user.in_scope(rec["site_id"]):
        return False
    if user.can_view_site(rec["site_id"]):
        return True
    if user.id in (rec.get("reporter_user_id"), rec.get("owner_user_id"), rec.get("verifier_user_id"), rec.get("completed_by"), rec.get("inspector_user_id")):
        return True
    if rec.get("observation_id"):
        seal = await db.one("select 1 from observation_reporter_seals where observation_id = $1 and reporter_user_hash = $2", [rec["observation_id"], hmac_id(user.id)], conn)
        if seal:
            return True
        # owner or verifier of an action linked to the observation
        linked = await db.one(
            "select 1 from actions where source_type = 'observation' and source_id = $1 and (owner_user_id = $2 or verifier_user_id = $2) limit 1",
            [rec["observation_id"], user.id], conn,
        )
        if linked:
            return True
    return False


async def get_media_row(conn, client_uuid: str | None = None, media_id: str | None = None) -> dict:
    row = await db.one("select * from media where client_uuid = $1", [client_uuid], conn) if client_uuid else await db.one("select * from media where id = $1", [media_id], conn)
    if not row:
        raise not_found()
    return row


def uploads_for(rows: list[dict], public: bool = False) -> list[dict[str, Any]]:
    return [{"clientUuid": r["client_uuid"], "url": public_upload_url(r["client_uuid"]) if public else upload_url(r["client_uuid"])} for r in rows if r["upload_status"] == "pending"]
