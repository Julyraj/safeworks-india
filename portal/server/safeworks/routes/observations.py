"""Safety walks, observation points and notifications."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import Field, field_validator

from .. import db
from ..auth import require_user
from ..errors import bad_request, conflict, forbidden, not_found
from ..http import JSON, client_ip, json_body, query, uuid_param
from ..observations import (
    add_comment, add_evidence_photo, cancel_observation, check_uuid, create_observation, decide_closure, edit_observation, extend_due,
    get_observation, list_observations, next_round_code, reopen_observation, start_work, submit_closure, withdraw_photo,
)
from ..rbac import AuthUser, can_raise, can_view_whole_site, is_admin
from ..upload import read_multipart
from ..validation import In, Str, parse

router = APIRouter()
auth = require_user()


class RoundIn(In):
    id: str
    site_id: str
    round_type: Str(80, 1)
    shift: Str(40, 1)
    area_names: list[Str(120)] = Field(default_factory=list, max_length=30)
    accompanied_by: Str(300) = ""
    weather: Str(120) = ""
    persons_on_site: int | None = Field(default=None, ge=0, le=100000)

    @field_validator("id", "site_id")
    @classmethod
    def _uuid(cls, v: str) -> str:
        r = check_uuid(v)
        if not r:
            raise ValueError("Invalid ID")
        return r


# ----- Rounds (safety walks) ------------------------------------------------------------------


@router.post("/api/rounds")
async def create_round(request: Request, u: AuthUser = Depends(auth)):
    inp = parse(RoundIn, await json_body(request))
    existing = await db.one("select id, observer_id from rounds where id = $1", [inp.id])
    if existing:
        if existing["observer_id"] != u.id:
            raise conflict("Round ID already used.")
        return JSON({"id": inp.id, "duplicate": True})
    if not can_raise(u, inp.site_id):
        raise forbidden("Only safety officers start safety walks.")
    site = await db.one("select id, code from sites where id = $1 and org_id = $2 and active", [inp.site_id, u.org_id])
    if not site:
        raise bad_request("Site not found.")
    code = await next_round_code(None, site["code"])
    await db.execute(
        """insert into rounds (id, org_id, site_id, code, observer_id, round_type, shift, area_names, accompanied_by, weather, persons_on_site)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)""",
        [inp.id, u.org_id, site["id"], code, u.id, inp.round_type, inp.shift, inp.area_names, inp.accompanied_by, inp.weather, inp.persons_on_site],
    )
    return JSON({"id": inp.id, "code": code}, status_code=201)


@router.post("/api/rounds/{rid}/finish")
async def finish_round(rid: str, u: AuthUser = Depends(auth)):
    rid = uuid_param(rid, "Round not found.")
    r = await db.one("select * from rounds where id = $1 and org_id = $2", [rid, u.org_id])
    if not r:
        raise not_found("Round not found.")
    if r["observer_id"] != u.id and not is_admin(u):
        raise forbidden()
    await db.execute("update rounds set status = 'finished', ended_at = coalesce(ended_at, now()) where id = $1", [rid])
    return JSON({"ok": True})


class RoundsQ(In):
    site_id: str | None = None
    mine: str | None = None

    @field_validator("site_id")
    @classmethod
    def _uuid(cls, v: str | None) -> str | None:
        return check_uuid(v)


@router.get("/api/rounds")
async def list_rounds(request: Request, u: AuthUser = Depends(auth)):
    f = parse(RoundsQ, query(request))
    rows = await db.q(
        """select r.id, r.code, r.round_type, r.shift, r.status, r.started_at, r.ended_at, r.area_names, s.name as site_name, s.id as site_id,
                  u.name as observer_name, r.observer_id,
                  (select count(*)::int from observations o where o.round_id = r.id and o.status <> 'cancelled') as points
             from rounds r join sites s on s.id = r.site_id join users u on u.id = r.observer_id
            where r.org_id = $1 and ($2::uuid is null or r.site_id = $2::uuid) and ($3::boolean is not true or r.observer_id = $4::uuid)
            order by r.started_at desc limit 50""",
        [u.org_id, f.site_id, f.mine == "1", u.id],
    )
    return JSON({
        "rounds": [
            {"id": r["id"], "code": r["code"], "roundType": r["round_type"], "shift": r["shift"], "status": r["status"], "startedAt": r["started_at"],
             "endedAt": r["ended_at"], "areaNames": r["area_names"], "site": {"id": r["site_id"], "name": r["site_name"]},
             "observerName": r["observer_name"], "points": r["points"], "mine": r["observer_id"] == u.id}
            for r in rows
            if r["observer_id"] == u.id or can_view_whole_site(u, r["site_id"])
        ]
    })


@router.get("/api/rounds/{rid}")
async def get_round(rid: str, u: AuthUser = Depends(auth)):
    rid = uuid_param(rid, "Round not found.")
    r = await db.one(
        """select r.*, s.name as site_name, s.code as site_code, u.name as observer_name, u.designation as observer_designation, u.employee_id as observer_employee_id
             from rounds r join sites s on s.id = r.site_id join users u on u.id = r.observer_id where r.id = $1 and r.org_id = $2""",
        [rid, u.org_id],
    )
    if not r:
        raise not_found("Round not found.")
    if r["observer_id"] != u.id and not can_view_whole_site(u, r["site_id"]):
        raise forbidden()
    lst = await list_observations(u, {"roundId": rid, "pageSize": 200, "status": "any"})
    return JSON({
        "id": r["id"], "code": r["code"], "status": r["status"], "roundType": r["round_type"], "shift": r["shift"], "areaNames": r["area_names"],
        "accompaniedBy": r["accompanied_by"], "weather": r["weather"], "personsOnSite": r["persons_on_site"], "startedAt": r["started_at"],
        "endedAt": r["ended_at"], "site": {"id": r["site_id"], "name": r["site_name"], "code": r["site_code"]},
        "observer": {"name": r["observer_name"], "designation": r["observer_designation"], "employeeId": r["observer_employee_id"]},
        "mine": r["observer_id"] == u.id, "points": lst["items"],
    })


# ----- Observations ---------------------------------------------------------------------------


@router.post("/api/observations")
async def create(request: Request, u: AuthUser = Depends(auth)):
    data, files = await read_multipart(request, ["photos", "afterPhotos"], 4)
    obs_id, duplicate = await create_observation(u, data, files.get("photos", []), files.get("afterPhotos", []), client_ip(request))
    return JSON(await get_observation(u, obs_id), status_code=200 if duplicate else 201)


@router.get("/api/observations")
async def list_(request: Request, u: AuthUser = Depends(auth)):
    return JSON(await list_observations(u, query(request)))


@router.get("/api/observations/{oid}")
async def get_(oid: str, u: AuthUser = Depends(auth)):
    return JSON(await get_observation(u, uuid_param(oid, "Observation not found.")))


@router.patch("/api/observations/{oid}")
async def edit(oid: str, request: Request, u: AuthUser = Depends(auth)):
    oid = uuid_param(oid, "Observation not found.")
    await edit_observation(u, oid, await json_body(request))
    return JSON(await get_observation(u, oid))


@router.post("/api/observations/{oid}/start")
async def start(oid: str, u: AuthUser = Depends(auth)):
    oid = uuid_param(oid, "Observation not found.")
    await start_work(u, oid)
    return JSON(await get_observation(u, oid))


@router.post("/api/observations/{oid}/closure")
async def closure(oid: str, request: Request, u: AuthUser = Depends(auth)):
    oid = uuid_param(oid, "Observation not found.")
    data, files = await read_multipart(request, ["photos"], 2)
    await submit_closure(u, oid, data, files.get("photos", []))
    return JSON(await get_observation(u, oid))


async def _simple(fn: Any, oid: str, request: Request, u: AuthUser) -> JSON:
    oid = uuid_param(oid, "Observation not found.")
    await fn(u, oid, await json_body(request))
    return JSON(await get_observation(u, oid))


@router.post("/api/observations/{oid}/decision")
async def decision(oid: str, request: Request, u: AuthUser = Depends(auth)):
    return await _simple(decide_closure, oid, request, u)


@router.post("/api/observations/{oid}/cancel")
async def cancel(oid: str, request: Request, u: AuthUser = Depends(auth)):
    return await _simple(cancel_observation, oid, request, u)


@router.post("/api/observations/{oid}/reopen")
async def reopen(oid: str, request: Request, u: AuthUser = Depends(auth)):
    return await _simple(reopen_observation, oid, request, u)


@router.post("/api/observations/{oid}/extend")
async def extend(oid: str, request: Request, u: AuthUser = Depends(auth)):
    return await _simple(extend_due, oid, request, u)


@router.post("/api/observations/{oid}/comments")
async def comment(oid: str, request: Request, u: AuthUser = Depends(auth)):
    return await _simple(add_comment, oid, request, u)


@router.post("/api/observations/{oid}/photos")
async def add_photos(oid: str, request: Request, u: AuthUser = Depends(auth)):
    oid = uuid_param(oid, "Observation not found.")
    _, files = await read_multipart(request, ["photos"], 2)
    await add_evidence_photo(u, oid, files.get("photos", []))
    return JSON(await get_observation(u, oid))


@router.post("/api/photos/{pid}/withdraw")
async def withdraw(pid: str, request: Request, u: AuthUser = Depends(auth)):
    await withdraw_photo(u, uuid_param(pid, "Photo not found."), await json_body(request))
    return JSON({"ok": True})


# ----- Notifications --------------------------------------------------------------------------


@router.get("/api/notifications")
async def notifications(u: AuthUser = Depends(auth)):
    rows = await db.q(
        "select n.id, n.kind, n.title, n.body, n.created_at, n.read_at, n.observation_id from notifications n where n.user_id = $1 order by n.created_at desc limit 100",
        [u.id],
    )
    return JSON({"items": [
        {"id": r["id"], "kind": r["kind"], "title": r["title"], "body": r["body"], "at": r["created_at"], "read": r["read_at"] is not None, "observationId": r["observation_id"]}
        for r in rows
    ]})


class ReadIn(In):
    ids: list[int] | None = Field(default=None, max_length=500)


@router.post("/api/notifications/read")
async def notifications_read(request: Request, u: AuthUser = Depends(auth)):
    inp = parse(ReadIn, await json_body(request))
    if inp.ids:
        await db.execute("update notifications set read_at = now() where user_id = $1 and id = any($2::bigint[]) and read_at is null", [u.id, inp.ids])
    else:
        await db.execute("update notifications set read_at = now() where user_id = $1 and read_at is null", [u.id])
    return JSON({"ok": True})
