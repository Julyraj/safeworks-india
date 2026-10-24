"""Health, master lists and the sites a user works on."""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends

from .. import db
from ..auth import require_user
from ..http import JSON
from ..rbac import AuthUser, can_manage, can_raise, can_view_whole_site, has_company_wide_read, roles_at
from ..settings import get_org

router = APIRouter()
_master_cache: dict | None = None


def clear_master_cache() -> None:
    global _master_cache
    _master_cache = None


async def master_lists(org_id: str) -> dict:
    global _master_cache
    if _master_cache and _master_cache["org_id"] == org_id and time.time() - _master_cache["at"] < 60:
        return _master_cache["data"]
    rows = await db.q(
        """select distinct on (list, code) list, code, label, parent_code, sort, version, active
             from master_items where org_id = $1 or org_id is null
            order by list, code, org_id nulls last""",
        [org_id],
    )
    lists: dict[str, list[dict]] = {}
    for r in rows:
        if not r["active"]:
            continue
        lists.setdefault(r["list"], []).append({"code": r["code"], "label": r["label"], "parent": r["parent_code"], "sort": r["sort"], "version": r["version"]})
    for k in lists:
        lists[k].sort(key=lambda x: (x["sort"], x["label"].lower()))
    org = await get_org(org_id)
    data = {"lists": lists, "settings": org["settings"], "company": org["name"]}
    _master_cache = {"org_id": org_id, "at": time.time(), "data": data}
    return data


async def sites_for(u: AuthUser) -> list[dict]:
    all_sites = await db.q("select * from sites where org_id = $1 and active order by name", [u.org_id])
    company = has_company_wide_read(u)
    mine = [s for s in all_sites if company or any(m.site_id == s["id"] for m in u.memberships)]
    ids = [s["id"] for s in mine]
    if not ids:
        return []
    areas = await db.q("select id, site_id, name from areas where site_id = any($1::uuid[]) and active order by name", [ids])
    contractors = await db.q(
        """select c.id, c.name, cs.site_id from contractors c join contractor_sites cs on cs.contractor_id = c.id
            where cs.site_id = any($1::uuid[]) and c.active order by c.name""",
        [ids],
    )
    people = await db.q(
        """select u.id, u.name, u.designation, u.phone, u.employee_id, m.site_id, m.role::text as role, ct.name as contractor_name
             from memberships m join users u on u.id = m.user_id left join contractors ct on ct.id = u.contractor_id
            where m.site_id = any($1::uuid[]) and u.active and m.role in ('supervisor','safety_officer')
            order by u.name""",
        [ids],
    )
    out = []
    for s in mine:
        site_people = [p for p in people if p["site_id"] == s["id"]]
        owners: dict[str, dict] = {}
        for p in site_people:
            owners[p["id"]] = {"id": p["id"], "name": p["name"], "designation": p["designation"], "role": p["role"], "contractor": p["contractor_name"]}
        out.append({
            "id": s["id"], "code": s["code"], "name": s["name"], "type": s["site_type"], "state": s["state"], "address": s["address"],
            "siteHead": {"name": s["site_head_name"], "phone": s["site_head_phone"]},
            "myRoles": sorted(roles_at(u, s["id"])),
            "can": {"raise": can_raise(u, s["id"]), "manage": can_manage(u, s["id"]), "viewAll": can_view_whole_site(u, s["id"])},
            "areas": [{"id": a["id"], "name": a["name"]} for a in areas if a["site_id"] == s["id"]],
            "contractors": [{"id": c["id"], "name": c["name"]} for c in contractors if c["site_id"] == s["id"]],
            "owners": list(owners.values()),
            "safetyOfficers": [{"name": p["name"], "phone": p["phone"]} for p in site_people if p["role"] == "safety_officer"],
        })
    return out


@router.get("/api/health")
async def health():
    await db.one("select 1 as ok")
    from datetime import datetime, timezone

    return JSON({"ok": True, "time": datetime.now(timezone.utc)})


@router.get("/api/master")
async def master(u: AuthUser = Depends(require_user())):
    return JSON(await master_lists(u.org_id))


@router.get("/api/sites")
async def sites(u: AuthUser = Depends(require_user())):
    return JSON({"sites": await sites_for(u)})
