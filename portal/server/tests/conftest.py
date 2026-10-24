"""Test setup: a fresh PostgreSQL schema, a small company with two sites and test logins.

    TEST_DATABASE_URL=postgres://… pytest
The test database is wiped and rebuilt on every run.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import secrets
import sys
import tempfile
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER))
sys.path.insert(0, str(SERVER / "scripts"))

os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "postgres://safeworks:safeworks@127.0.0.1:55432/safeworks_test")
os.environ.setdefault("STORAGE_DIR", tempfile.mkdtemp(prefix="sw-test-"))
os.environ["RUN_JOBS"] = "false"
os.environ["USER_RATE_LIMIT"] = "100000"

import asyncpg  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from master_data import build_master_rows  # noqa: E402
from safeworks.security import KEYLEN, N, P, R, _scrypt  # noqa: E402

PW = "Test@1234"
PHOTO = (SERVER / "tests" / "fixtures" / "photo-1.jpg").read_bytes()


def _hash(pw: str) -> str:
    salt = secrets.token_bytes(16)
    key = _scrypt(pw, salt, N, R, P, KEYLEN)
    return f"scrypt${N}${R}${P}${base64.b64encode(salt).decode()}${base64.b64encode(key).decode()}"


async def _prepare(ids: dict) -> None:
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        await conn.execute("drop schema public cascade; create schema public;")
        await conn.execute("create table schema_migrations (name text primary key, applied_at timestamptz not null default now())")
        for f in sorted((SERVER / "migrations").glob("*.sql")):
            await conn.execute(f.read_text())
            await conn.execute("insert into schema_migrations (name) values ($1)", f.name)
        for r in build_master_rows():
            await conn.execute("insert into master_items (org_id, list, code, label, parent_code, sort) values (null,$1,$2,$3,$4,$5)",
                               r["list"], r["code"], r["label"], r.get("parent"), r["sort"])
        h = _hash(PW)
        org = await conn.fetchval("insert into organisations (name) values ('Test Co') returning id")
        ids["org"] = str(org)
        ids["siteA"] = str(await conn.fetchval("insert into sites (org_id, code, name, state) values ($1,'SA','Site A','Karnataka') returning id", org))
        ids["siteB"] = str(await conn.fetchval("insert into sites (org_id, code, name, state) values ($1,'SB','Site B','Tamil Nadu') returning id", org))

        async def mk(emp: str, roles: list[tuple[str, str | None]], must_change: bool = False) -> None:
            uid = await conn.fetchval(
                "insert into users (org_id, employee_id, name, password_hash, must_change_password) values ($1,$2,$3,$4,$5) returning id", org, emp, emp, h, must_change
            )
            for role, site in roles:
                await conn.execute("insert into memberships (user_id, org_id, site_id, role) values ($1,$2,$3,$4)", uid, org, site, role)
            ids[emp.lower()] = str(uid)

        await mk("ADMIN", [("org_admin", None)])
        await mk("SO1", [("safety_officer", ids["siteA"])])
        await mk("SO2", [("safety_officer", ids["siteA"])])
        await mk("SUP1", [("supervisor", ids["siteA"])])
        await mk("SOB", [("safety_officer", ids["siteB"])])
        await mk("VIEW", [("viewer", None)])
        await mk("NEW1", [("supervisor", ids["siteA"])], must_change=True)
        await mk("LOCKME", [("supervisor", ids["siteA"])])
    finally:
        await conn.close()


class Ctx:
    def __init__(self, client: TestClient, ids: dict):
        self.client = client
        self.ids = ids
        self.tokens: dict[str, str] = {}

    def login(self, emp: str, password: str = PW, app: str = "portal"):
        return self.client.post("/api/auth/login", json={"employeeId": emp, "password": password, "app": app})

    def call(self, who: str | None, method: str, url: str, body=None):
        headers = {"authorization": f"Bearer {self.tokens[who]}"} if who else {}
        return self.client.request(method, url, json=body, headers=headers)

    def upload(self, who: str, url: str, data, files: list[tuple[str, bytes]]):
        # Always multipart, like the browser's FormData (the data field goes in as a plain part).
        return self.client.post(
            url,
            files=[("data", (None, json.dumps(data)))] + [(field, (f"p{i}.jpg", buf, "image/jpeg")) for i, (field, buf) in enumerate(files)],
            headers={"authorization": f"Bearer {self.tokens[who]}"},
        )


@pytest.fixture(scope="session")
def ctx():
    ids: dict = {}
    asyncio.run(_prepare(ids))
    from safeworks.app import app

    with TestClient(app) as client:
        c = Ctx(client, ids)
        for u in ["SO1", "SO2", "SUP1", "SOB", "VIEW"]:
            r = c.login(u)
            assert r.status_code == 200, f"login {u}: {r.text}"
            c.tokens[u] = r.json()["token"]
        r = c.login("ADMIN", PW, "admin")
        assert r.status_code == 200, r.text
        c.tokens["ADMIN"] = r.json()["token"]
        yield c
