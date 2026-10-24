"""Passwords, tokens and signed photo links.

The password format is identical to the earlier TypeScript server
(scrypt$N$r$p$salt$hash), so existing logins keep working.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import math
import re
import secrets
import time
from functools import partial

import anyio

from .config import config

N, R, P, KEYLEN = 16384, 8, 1, 32
MAXMEM = 64 * 1024 * 1024
_limiter: anyio.CapacityLimiter | None = None


def _get_limiter() -> anyio.CapacityLimiter:
    global _limiter
    if _limiter is None:
        _limiter = anyio.CapacityLimiter(config.hash_threads)
    return _limiter


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int, dklen: int) -> bytes:
    # hashlib.scrypt releases the GIL, so several logins hash in parallel threads.
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, maxmem=MAXMEM, dklen=dklen)


async def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    key = await anyio.to_thread.run_sync(partial(_scrypt, password, salt, N, R, P, KEYLEN), limiter=_get_limiter())
    return f"scrypt${N}${R}${P}${base64.b64encode(salt).decode()}${base64.b64encode(key).decode()}"


async def verify_password(password: str, stored: str) -> bool:
    parts = (stored or "").split("$")
    if len(parts) != 6 or parts[0] != "scrypt":
        return False
    _, n, r, p, salt_b64, key_b64 = parts
    try:
        expected = base64.b64decode(key_b64)
        salt = base64.b64decode(salt_b64)
        key = await anyio.to_thread.run_sync(partial(_scrypt, password, salt, int(n), int(r), int(p), len(expected)), limiter=_get_limiter())
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(key, expected)


_dummy_hash: str | None = None


async def dummy_verify(password: str) -> None:
    """Spend the same time as a real check, so unknown employee IDs can't be told apart by timing."""
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = await hash_password("not-a-real-password-0")
    await verify_password(password, _dummy_hash)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def password_problem(pw: str) -> str | None:
    """Password rule: at least 8 characters with at least one letter and one number."""
    if not isinstance(pw, str) or len(pw) < 8:
        return "Password must be at least 8 characters."
    if len(pw) > 128:
        return "Password is too long."
    if not re.search(r"[A-Za-z]", pw) or not re.search(r"[0-9]", pw):
        return "Password must contain letters and numbers."
    return None


WORDS = ["Bolt", "Crane", "Delta", "Ember", "Flint", "Grove", "Harbor", "Iron", "Jade", "Kite", "Lumen", "Maple", "Nova", "Onyx", "Pine", "Quartz",
         "Ridge", "Stone", "Tide", "Umber", "Vale", "Willow", "Yarrow", "Zinc", "Moss", "Brook", "Cedar", "Dune"]


def temp_password() -> str:
    """Readable temporary password, e.g. "Kite-4827-Moss"."""
    return f"{secrets.choice(WORDS)}-{1000 + secrets.randbelow(9000)}-{secrets.choice(WORDS)}"


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def sign_file(key: str, exp: int) -> str:
    return _b64url(hmac.new(config.file_signing_secret.encode(), f"{key}|{exp}".encode(), hashlib.sha256).digest())


def verify_file_sig(key: str, exp: int | None, sig: str) -> bool:
    if exp is None or exp < int(time.time()):
        return False
    return hmac.compare_digest(sign_file(key, exp).encode(), (sig or "").encode())


def signed_file_url(key: str) -> str:
    # Expiry rounded to 10 minutes so the same photo keeps the same URL for a while (cache friendly).
    exp = int(math.ceil((int(time.time()) + config.file_link_ttl_seconds) / 600) * 600)
    return f"/files/{key}?e={exp}&s={sign_file(key, exp)}"
