"""Photo storage: server disk (STORAGE_DIR, default) or PostgreSQL (STORAGE_DRIVER=db).

The interface is small so an S3-compatible store can replace it when hosting is decided.
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

import anyio

from . import db
from .config import config
from .errors import bad_request

SAFE_KEY = re.compile(r"^[a-z0-9][a-z0-9/_\-.]{0,200}$")


class Storage(Protocol):
    async def put(self, key: str, data: bytes, mime: str) -> None: ...
    async def get(self, key: str) -> bytes | None: ...
    async def remove(self, key: str) -> None: ...


def _check(key: str) -> None:
    if not SAFE_KEY.match(key) or ".." in key:
        raise bad_request("Invalid file key.")


class DiskStorage:
    def _path(self, key: str) -> Path:
        _check(key)
        full = (config.storage_dir / key).resolve()
        if not str(full).startswith(str(config.storage_dir) + os.sep):
            raise bad_request("Invalid file key.")
        return full

    async def put(self, key: str, data: bytes, mime: str) -> None:
        full = self._path(key)

        def write() -> None:
            full.parent.mkdir(parents=True, exist_ok=True)
            tmp = full.with_name(f"{full.name}.{os.getpid()}.tmp")
            tmp.write_bytes(data)
            os.replace(tmp, full)

        await anyio.to_thread.run_sync(write)

    async def get(self, key: str) -> bytes | None:
        try:
            full = self._path(key)
        except Exception:
            return None
        if not full.is_file():
            return None
        return await anyio.to_thread.run_sync(full.read_bytes)

    async def remove(self, key: str) -> None:
        try:
            self._path(key).unlink(missing_ok=True)
        except Exception:
            pass


class DbStorage:
    async def put(self, key: str, data: bytes, mime: str) -> None:
        _check(key)
        await db.execute(
            "insert into file_blobs (key, mime, data) values ($1, $2, $3) on conflict (key) do update set data = excluded.data, mime = excluded.mime",
            [key, mime, data],
        )

    async def get(self, key: str) -> bytes | None:
        if not SAFE_KEY.match(key):
            return None
        row = await db.one("select data from file_blobs where key = $1", [key])
        return bytes(row["data"]) if row else None

    async def remove(self, key: str) -> None:
        await db.execute("delete from file_blobs where key = $1", [key])


storage: Storage = DbStorage() if config.storage_driver == "db" else DiskStorage()


def sniff_image(buf: bytes) -> dict | None:
    """Identify an image by its magic bytes (never trust the browser's content type)."""
    if len(buf) > 3 and buf[0] == 0xFF and buf[1] == 0xD8 and buf[2] == 0xFF:
        w, h = _jpeg_size(buf)
        return {"mime": "image/jpeg", "ext": "jpg", "width": w, "height": h}
    if len(buf) > 24 and buf[:8] == b"\x89PNG\r\n\x1a\n":
        return {"mime": "image/png", "ext": "png", "width": int.from_bytes(buf[16:20], "big"), "height": int.from_bytes(buf[20:24], "big")}
    if len(buf) > 30 and buf[:4] == b"RIFF" and buf[8:12] == b"WEBP":
        return {"mime": "image/webp", "ext": "webp", "width": None, "height": None}
    return None


def _jpeg_size(buf: bytes) -> tuple[int | None, int | None]:
    i = 2
    while i + 9 < len(buf):
        if buf[i] != 0xFF:
            return None, None
        marker = buf[i + 1]
        length = int.from_bytes(buf[i + 2 : i + 4], "big")
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            return int.from_bytes(buf[i + 7 : i + 9], "big"), int.from_bytes(buf[i + 5 : i + 7], "big")
        i += 2 + length
    return None, None


def photo_key(ext: str) -> str:
    d = datetime.now(timezone.utc)
    return f"obs/{d.year}/{d.month:02d}/{uuid.uuid4()}.{ext}"
