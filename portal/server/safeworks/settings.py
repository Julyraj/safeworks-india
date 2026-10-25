"""Organisation settings (`OrgSettings` in types.ts) merged over the defaults from the brief."""
from __future__ import annotations

import copy
import time
from typing import Any

from . import db

DEFAULT_SETTINGS: dict[str, Any] = {
    "mfaRequiredRoles": ["admin", "hse_manager", "site_head"],
    "triageSlaWorkingDays": 1,
    "triageEscalateWorkingDays": 2,
    "criticalAckMinutes": 30,
    "quietHours": {"start": "21:00", "end": "07:00"},
    "dailyPushCap": 5,
    "duplicateWindowHours": 24,
    "duplicateRadiusM": 30,
    "photoMaxEdgePx": 1600,
    "photoQuality": 0.8,
    "defaultLanguage": "en",
    "languages": ["en", "hi", "ta", "kn"],
    "dateChangeRequestsBeforeSiteHead": 3,
    "disputePauseDays": 3,
    "statusLabels": {
        "risk_matrix": "design default (NPSA 2008 style; Unverified)",
        "due_date_rules": "design default",
        "reminder_ladder": "design default (TeamLease RegTrack pattern)",
        "duplicate_window": "design default",
        "quiet_hours": "design default",
        "daily_push_cap": "design default",
        "critical_ack_minutes": "design target",
        "triage_sla": "design default",
        "retention": "design default; open decision",
        "mfa_roles": "from the research (admin, HSE manager, site head); officers: design default, off",
        "percent_safe_minimum": "derived (Campbell Institute), 30 behaviours",
    },
    "percentSafeMinimum": 30,
    "maxPhotosPerRecord": 10,
    "maxPhotosQuickForm": 3,
    "voiceNoteMaxSeconds": 60,
}

INT_KEYS = ("triageSlaWorkingDays", "triageEscalateWorkingDays", "criticalAckMinutes", "dailyPushCap", "duplicateWindowHours",
            "duplicateRadiusM", "photoMaxEdgePx", "dateChangeRequestsBeforeSiteHead", "disputePauseDays", "percentSafeMinimum",
            "maxPhotosPerRecord", "maxPhotosQuickForm", "voiceNoteMaxSeconds")


def merge_settings(raw: Any) -> dict[str, Any]:
    s = raw if isinstance(raw, dict) else {}
    out = copy.deepcopy(DEFAULT_SETTINGS)
    for k, v in s.items():
        if k in ("quietHours", "statusLabels") and isinstance(v, dict):
            out[k].update(v)
        elif k in INT_KEYS:
            try:
                out[k] = int(v)
            except (TypeError, ValueError):
                pass
        elif k == "photoQuality":
            try:
                out[k] = float(v)
            except (TypeError, ValueError):
                pass
        elif k in ("mfaRequiredRoles", "languages") and isinstance(v, list):
            out[k] = [str(x) for x in v]
        elif k == "defaultLanguage" and isinstance(v, str):
            out[k] = v
        else:
            out[k] = v
    return out


_cache: dict[str, tuple[float, dict]] = {}


async def get_org(org_id: str, conn=None) -> dict[str, Any]:
    """{id, name, legalName, address, phone, settings} with a 15 s cache."""
    hit = _cache.get(org_id)
    if hit and time.time() - hit[0] < 15:
        return hit[1]
    row = await db.one("select id, name, legal_name, address, phone, settings from organisations where id = $1", [org_id], conn)
    if not row:
        return {"id": org_id, "name": "", "legalName": "", "address": "", "phone": "", "settings": merge_settings(None)}
    org = {"id": row["id"], "name": row["name"], "legalName": row["legal_name"], "address": row["address"], "phone": row["phone"],
           "settings": merge_settings(row["settings"])}
    _cache[org_id] = (time.time(), org)
    return org


async def org_settings(org_id: str, conn=None) -> dict[str, Any]:
    return (await get_org(org_id, conn))["settings"]


def clear_org_cache(org_id: str | None = None) -> None:
    if org_id:
        _cache.pop(org_id, None)
    else:
        _cache.clear()
