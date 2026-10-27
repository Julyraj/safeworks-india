"""Retention (brief §8.10): dry-run counts of what would be erased or anonymised. 2.0 only reports; nothing is deleted."""
from __future__ import annotations

from datetime import datetime, timezone

from . import db

DEFAULT_POLICIES = [
    ("observation", 5, "5 years after closure (design default; open decision)", "anonymise", "design default"),
    ("action", 5, "5 years after closure (design default; open decision)", "anonymise", "design default"),
    ("inspection_run", 5, "5 years after closure (design default; open decision)", "anonymise", "design default"),
    ("incident", 5, "5 years after closure (design default; open decision)", "anonymise", "design default"),
    ("lifting_register", 5, "5 years after the last entry (Verified primary)", "erase", "verified_primary"),
    ("osh_central_register", 5, "OSH Central registers 5 years (Verified secondary)", "erase", "verified_secondary"),
    ("earth_test_record", 2, "Earth-test records 2 years, CEA 2023 reg 43 (Verified primary)", "erase", "verified_primary"),
    ("personal_data", 1, "DPDP r.8(3): at least 1 year (Verified primary)", "anonymise", "verified_primary"),
    ("audit_log", 1, "Logs kept 1 year or more (DPDP r.8(3), Verified primary)", "erase", "verified_primary"),
    ("notification", 1, "Notification log 1 year (design default)", "erase", "design default"),
]


async def dry_run(org_id: str, conn=None) -> dict:
    """Counts per record type past its retention period and not under a legal hold."""
    policies = await db.q("select * from retention_policies where org_id = $1", [org_id], conn)
    holds = await db.q("select scope_type, scope_id from legal_holds where org_id = $1 and released_at is null", [org_id], conn)
    held_types = {h["scope_type"] for h in holds if h["scope_id"] is None}
    held_ids = {h["scope_id"] for h in holds if h["scope_id"]}
    out: dict[str, dict] = {}
    for p in policies:
        rt, years = p["record_type"], int(p["retention_years"])
        n = 0
        if rt in held_types:
            out[rt] = {"candidates": 0, "endAction": p["end_action"], "retentionYears": years, "legalHold": True}
            continue
        if rt == "observation":
            rows = await db.q("select id from observations where org_id = $1 and status in ('closed','discarded','merged') and coalesce(closed_at, updated_at) < now() - make_interval(years => $2)", [org_id, years], conn)
            n = len([r for r in rows if r["id"] not in held_ids])
        elif rt == "action":
            rows = await db.q("select id from actions where org_id = $1 and status in ('verified','cancelled') and updated_at < now() - make_interval(years => $2)", [org_id, years], conn)
            n = len([r for r in rows if r["id"] not in held_ids])
        elif rt == "inspection_run":
            rows = await db.q("select id from inspection_runs where org_id = $1 and status in ('closed','cancelled','missed') and updated_at < now() - make_interval(years => $2)", [org_id, years], conn)
            n = len([r for r in rows if r["id"] not in held_ids])
        elif rt == "incident":
            n = await conn_fetchval(conn, "select count(*) from incidents where org_id = $1 and created_at < now() - make_interval(years => $2)", org_id, years)
        elif rt == "personal_data":
            n = await conn_fetchval(conn, "select count(*) from people where org_id = $1 and not active and updated_at < now() - make_interval(years => $2)", org_id, years)
        elif rt == "audit_log":
            n = await conn_fetchval(conn, "select count(*) from audit_log where org_id = $1 and at < now() - make_interval(years => $2)", org_id, years)
        elif rt == "notification":
            n = await conn_fetchval(conn, "select count(*) from notifications where org_id = $1 and created_at < now() - make_interval(years => $2)", org_id, years)
        out[rt] = {"candidates": int(n or 0), "endAction": p["end_action"], "retentionYears": years, "legalHold": False}
    return {"checkedAt": datetime.now(timezone.utc), "byRecordType": out, "legalHolds": len(holds), "note": "Dry run only: 2.0 never erases or anonymises automatically."}


async def conn_fetchval(conn, sql: str, *args):
    if conn is not None:
        return await conn.fetchval(sql, *args)
    return await db._db(None).fetchval(sql, *args)
