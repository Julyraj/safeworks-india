"""Server-side messages in en, hi, ta, kn: errors, notification texts, poster, report and digest strings.

Packs live in safeworks/i18n/<lang>.json. English is the fallback; the company's overrides
(`translations` table) win over the repo pack. Pick the language from the user or from Accept-Language.
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from . import db

LANGS = ("en", "hi", "ta", "kn")
PACK_DIR = Path(__file__).resolve().parent / "i18n"

_packs: dict[str, dict[str, str]] = {}
_overrides: dict[str, tuple[float, dict[str, dict[str, str]]]] = {}  # org_id → (loaded_at, {lang: {key: text}})
OVERRIDE_TTL = 30


def _load() -> None:
    if _packs:
        return
    for lang in LANGS:
        p = PACK_DIR / f"{lang}.json"
        data = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}
        _packs[lang] = {k: v for k, v in data.items() if not k.startswith("_") and isinstance(v, str)}


def pack(lang: str) -> dict[str, str]:
    _load()
    return _packs.get(lang, {})


def keys() -> list[str]:
    _load()
    return sorted(_packs["en"].keys())


def norm_lang(lang: str | None) -> str:
    lang = (lang or "en").lower()[:2]
    return lang if lang in LANGS else "en"


def from_accept_language(header: str | None) -> str:
    """First supported language in an Accept-Language header, by quality."""
    if not header:
        return "en"
    items = []
    for i, part in enumerate(header.split(",")):
        bits = part.strip().split(";")
        tag = bits[0].strip().lower()
        q = 1.0
        for b in bits[1:]:
            m = re.match(r"\s*q\s*=\s*([0-9.]+)", b)
            if m:
                try:
                    q = float(m.group(1))
                except ValueError:
                    q = 0.0
        if tag:
            items.append((-q, i, tag))
    for _, _, tag in sorted(items):
        if tag[:2] in LANGS:
            return tag[:2]
    return "en"


def _format(text: str, params: dict[str, Any]) -> str:
    if not params:
        return text

    def rep(m: re.Match) -> str:
        v = params.get(m.group(1))
        return "" if v is None else str(v)

    return re.sub(r"\{(\w+)\}", rep, text)


def t(key: str, lang: str = "en", org_id: str | None = None, **params: Any) -> str:
    """Translate `key` into `lang`; company overrides first, then the pack, then English, then the key itself."""
    _load()
    lang = norm_lang(lang)
    if org_id:
        ov = _overrides.get(org_id)
        if ov and time.time() - ov[0] < OVERRIDE_TTL:
            text = ov[1].get(lang, {}).get(key)
            if text:
                return _format(text, params)
    text = _packs.get(lang, {}).get(key) or _packs["en"].get(key) or key
    return _format(text, params)


async def load_overrides(org_id: str, conn=None) -> dict[str, dict[str, str]]:
    ov = _overrides.get(org_id)
    if ov and time.time() - ov[0] < OVERRIDE_TTL:
        return ov[1]
    rows = await db.q("select key, lang, text from translations where org_id = $1", [org_id], conn)
    out: dict[str, dict[str, str]] = {l: {} for l in LANGS}
    for r in rows:
        out.setdefault(r["lang"], {})[r["key"]] = r["text"]
    _overrides[org_id] = (time.time(), out)
    return out


def clear_overrides(org_id: str | None = None) -> None:
    if org_id:
        _overrides.pop(org_id, None)
    else:
        _overrides.clear()


def pick(i18n: Any, lang: str) -> str:
    """Pick a language from an {"en":..,"hi":..} object with English fallback."""
    if isinstance(i18n, dict):
        return i18n.get(norm_lang(lang)) or i18n.get("en") or next((v for v in i18n.values() if v), "")
    return str(i18n or "")
