"""Company settings (due dates by risk, escalation) and the risk calculation."""
from __future__ import annotations

import time
from typing import Any

from . import db

DEFAULT_SETTINGS: dict[str, Any] = {
    "dueDays": {"Critical": 1, "High": 3, "Medium": 7, "Low": 15},
    "escalation": {"siteHeadDays": 3, "adminDays": 7},
    "dueReminderHours": 24,
}


def merge_settings(raw: Any) -> dict[str, Any]:
    s = raw if isinstance(raw, dict) else {}
    return {
        "dueDays": {**DEFAULT_SETTINGS["dueDays"], **(s.get("dueDays") or {})},
        "escalation": {**DEFAULT_SETTINGS["escalation"], **(s.get("escalation") or {})},
        "dueReminderHours": int(s.get("dueReminderHours", DEFAULT_SETTINGS["dueReminderHours"])),
    }


_cache: dict[str, Any] | None = None


async def get_org(org_id: str, conn=None) -> dict[str, Any]:
    global _cache
    if _cache and _cache["org_id"] == org_id and time.time() - _cache["at"] < 15:
        return {"name": _cache["name"], "settings": _cache["settings"]}
    row = await db.one("select name, settings from organisations where id = $1", [org_id], conn)
    settings = merge_settings(row["settings"] if row else None)
    name = row["name"] if row else ""
    _cache = {"org_id": org_id, "at": time.time(), "settings": settings, "name": name}
    return {"name": name, "settings": settings}


def clear_org_cache() -> None:
    global _cache
    _cache = None


def risk_of(severity: int | None, likelihood: int | None, work_stopped: bool) -> tuple[int | None, str | None]:
    """Severity × likelihood: 1–4 Low, 5–9 Medium, 10–14 High, 15–25 Critical; work stopped forces Critical."""
    if not severity or not likelihood:
        return None, ("Critical" if work_stopped else None)
    score = severity * likelihood
    level = "Critical" if score >= 15 else "High" if score >= 10 else "Medium" if score >= 5 else "Low"
    if work_stopped:
        level = "Critical"
    return score, level
