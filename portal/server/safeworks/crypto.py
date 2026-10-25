"""Field encryption (AES-256-GCM) and keyed hashes for the reporter seal.

FIELD_ENCRYPTION_KEY is base64 of 32 random bytes (`openssl rand -base64 32`). Outside production a fixed
development key is used so a local server starts without configuration.
Ciphertext format: base64url(nonce[12] || ciphertext || tag), prefixed with "v1:" so the key can be rotated later.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import config

_key: bytes | None = None


def _load_key() -> bytes:
    global _key
    if _key is None:
        raw = config.field_encryption_key or ""
        try:
            k = base64.b64decode(raw + "=" * (-len(raw) % 4))
        except Exception as e:  # pragma: no cover - configuration error
            raise RuntimeError("FIELD_ENCRYPTION_KEY is not valid base64") from e
        if len(k) != 32:
            raise RuntimeError("FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes")
        _key = k
    return _key


def encrypt(plain: str) -> str:
    if plain is None or plain == "":
        return ""
    nonce = secrets.token_bytes(12)
    ct = AESGCM(_load_key()).encrypt(nonce, plain.encode("utf-8"), b"safeworks")
    return "v1:" + base64.urlsafe_b64encode(nonce + ct).decode().rstrip("=")


def decrypt(token: str) -> str:
    if not token:
        return ""
    if not token.startswith("v1:"):
        raise ValueError("unknown ciphertext version")
    raw = base64.urlsafe_b64decode(token[3:] + "=" * (-len(token[3:]) % 4))
    nonce, ct = raw[:12], raw[12:]
    return AESGCM(_load_key()).decrypt(nonce, ct, b"safeworks").decode("utf-8")


def encrypt_json(obj: Any) -> str:
    return encrypt(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def decrypt_json(token: str) -> Any:
    s = decrypt(token)
    return json.loads(s) if s else None


def hmac_id(value: str, purpose: str = "reporter-seal") -> str:
    """Keyed hash of an id so "my reports" can be found without decrypting the seal."""
    return hmac.new(_load_key(), f"{purpose}|{value}".encode("utf-8"), hashlib.sha256).hexdigest()


def mask_phone(phone: str) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if not digits:
        return ""
    return "•" * max(len(digits) - 4, 0) + digits[-4:]
