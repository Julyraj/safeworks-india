"""Multipart uploads: a JSON `data` field plus photo files."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from fastapi import Request
from starlette.datastructures import UploadFile

from .config import config
from .errors import HttpError, bad_request
from .storage import photo_key, sniff_image, storage


@dataclass
class UploadedImage:
    data: bytes
    info: dict


@dataclass
class StoredPhoto:
    key: str
    mime: str
    bytes: int
    width: int | None
    height: int | None


async def read_multipart(request: Request, file_fields: list[str], max_files: int) -> tuple[Any, dict[str, list[UploadedImage]]]:
    ctype = request.headers.get("content-type", "")
    if not ctype.startswith("multipart/form-data"):
        raise bad_request("Expected a form upload (multipart/form-data).")
    try:
        form = await request.form(max_files=max_files, max_fields=10, max_part_size=256 * 1024)
    except HttpError:
        raise
    except Exception as e:  # malformed body or too many parts
        msg = str(e)
        if "Too many files" in msg:
            raise HttpError(413, "Too many photos in one upload.", "too_many_files")
        raise bad_request(f"Could not read the upload: {msg}")
    files: dict[str, list[UploadedImage]] = {}
    data: Any = {}
    try:
        for name, value in form.multi_items():
            if isinstance(value, UploadFile):
                content = await value.read(config.max_photo_bytes + 1)
                if len(content) > config.max_photo_bytes:
                    raise HttpError(413, f"A photo is too large (limit {round(config.max_photo_bytes / 1024 / 1024)} MB).", "too_large")
                if name not in file_fields:
                    continue
                info = sniff_image(content)
                if not info:
                    raise bad_request("Only JPEG, PNG or WebP photos are accepted.")
                files.setdefault(name, []).append(UploadedImage(content, info))
            elif name == "data":
                try:
                    data = json.loads(value)
                except ValueError:
                    raise bad_request("Form data is not valid JSON.")
    finally:
        await form.close()
    return data, files


async def store_photos(images: list[UploadedImage]) -> list[StoredPhoto]:
    out: list[StoredPhoto] = []
    try:
        for img in images:
            key = photo_key(img.info["ext"])
            await storage.put(key, img.data, img.info["mime"])
            out.append(StoredPhoto(key, img.info["mime"], len(img.data), img.info["width"], img.info["height"]))
    except Exception:
        await discard_photos(out)
        raise
    return out


async def discard_photos(photos: list[StoredPhoto]) -> None:
    for p in photos:
        try:
            await storage.remove(p.key)
        except Exception:
            pass
