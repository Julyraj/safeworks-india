"""Raw-body uploads for PUT /media/{clientUuid} and PUT /public/upload/{ticket}.

The body is the file itself (no multipart). The server sniffs the type from the bytes, refuses anything that is not a
photo (JPEG/PNG/WebP) or a voice note (WebM/MP4/OGG), enforces the 10 MB cap and never re-encodes (brief §8.8).
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass

from fastapi import Request

from .config import config
from .errors import HttpError, bad_request
from .storage import sniff_media


@dataclass
class UploadedFile:
    data: bytes
    mime: str
    ext: str
    kind: str
    width: int | None
    height: int | None
    sha256: str


async def read_raw_upload(request: Request, max_bytes: int | None = None) -> UploadedFile:
    limit = max_bytes or config.max_media_bytes
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise HttpError(413, f"The upload is too large (limit {limit // (1024 * 1024)} MB).", "too_large", key="err.too_large", params={"mb": limit // (1024 * 1024)})
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data:
        raise bad_request("Empty upload.", key="err.media_type")
    info = sniff_media(data)
    if not info:
        raise bad_request("Only JPEG, PNG or WebP photos and WebM, MP4 or OGG voice notes are accepted.", key="err.media_type")
    return UploadedFile(data, info["mime"], info["ext"], info["kind"], info.get("width"), info.get("height"), hashlib.sha256(data).hexdigest())
