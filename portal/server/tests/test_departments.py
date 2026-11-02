"""2.1: departments, department actions, insights (me / department / site) and Excel exports."""
import io
import uuid
import zipfile
import xml.dom.minidom

from conftest import run


def _admin(ctx):
    if "ADMIN" not in ctx.tokens:
        from test_auth_scope import test_mfa_flow
        test_mfa_flow(ctx)


def test_department_admin_crud_and_user_assignment(ctx):
    _admin(ctx)
    r = ctx.post("ADMIN", "/api/v1/admin/departments", {"code": "civ", "name": {"en": "Civil works", "ta": "சிவில் பணிகள்"}})
    assert r.status_code == 201, r.text
    civ = r.json()
    assert civ["code"] == "CIV" and civ["memberCount"] == 0
    assert ctx.post("ADMIN", "/api/v1/admin/departments", {"code": "CIV", "name": {"en": "Dup"}}).status_code == 409
    assert ctx.post("ADMIN", "/api/v1/admin/departments", {"code": "bad code!", "name": {"en": "x"}}).status_code == 400
    elec = ctx.post("ADMIN", "/api/v1/admin/departments", {"code": "ELE", "name": {"en": "Electrical"}}).json()
    # officers cannot change the list
    assert ctx.post("SO1", "/api/v1/admin/departments", {"code": "X1", "name": {"en": "X"}}).status_code in (401, 403)
    # the console may PUT back what it loaded (memberCount, id, version are echo keys)
    loaded = next(d for d in ctx.get("ADMIN", "/api/v1/admin/departments").json() if d["id"] == civ["id"])
    loaded["name"]["hi"] = "सिविल"
    assert ctx.put("ADMIN", f"/api/v1/admin/departments/{civ['id']}", loaded).status_code == 200

    # set OWN1 and W1 to Civil, OWN2 to Electrical (PUT back the loaded user, as the console does)
    for who, dept in (("own1", civ), ("w1", civ), ("own2", elec)):
        u = ctx.get("ADMIN", f"/api/v1/admin/users/{ctx.ids[who]}").json()
        u["departmentId"] = dept["id"]
        r = ctx.put("ADMIN", f"/api/v1/admin/users/{ctx.ids[who]}", {k: v for k, v in u.items() if k in ("name", "email", "employeeCode", "language", "departmentId", "employerName", "departmentName")})
        assert r.status_code == 200, r.text
        assert r.json()["departmentId"] == dept["id"] and r.json()["departmentName"] == dept["name"]["en"]
    # leaving departmentId out keeps it; an unknown id is refused
    assert ctx.put("ADMIN", f"/api/v1/admin/users/{ctx.ids['own1']}", {"language": "en"}).json()["departmentId"] == civ["id"]
    assert ctx.put("ADMIN", f"/api/v1/admin/users/{ctx.ids['own1']}", {"departmentId": str(uuid.uuid4())}).status_code == 400
    assert next(d for d in ctx.get("ADMIN", "/api/v1/admin/departments").json() if d["id"] == civ["id"])["memberCount"] == 2
    # the field app learns its department from /me and the department list from sync
    for who in ("OWN1", "W1"):
        r = ctx.login(who)
        ctx.tokens[who] = r.json()["token"]
    assert ctx.get("W1", "/api/v1/me").json()["departmentId"] == civ["id"]
    pull = ctx.get("W1", "/api/v1/sync/pull").json()
    assert {d["code"] for d in pull["departments"]} >= {"CIV", "ELE"}
    ctx.ids["deptCiv"], ctx.ids["deptEle"] = civ["id"], elec["id"]


def test_department_actions_snapshot_and_visibility(ctx):
    if "deptCiv" not in ctx.ids:
        test_department_admin_crud_and_user_assignment(ctx)
    obs = ctx.create_obs("W2")
    out = ctx.triage_assign(obs["id"], owner="own1")
    aid = out["actions"][0]["id"] if out.get("actions") else run(lambda c: c.fetchval("select id::text from actions where source_id = $1", uuid.UUID(obs["id"])))
    a = ctx.get("OWN1", f"/api/v1/actions/{aid}").json()
    assert a["departmentId"] == ctx.ids["deptCiv"]
    # W1 (Civil, not owner, not officer) sees it in the department list and can open it read-only
    lst = ctx.get("W1", "/api/v1/actions?department=1").json()
    assert aid in [x["id"] for x in lst["items"]]
    d = ctx.get("W1", f"/api/v1/actions/{aid}")
    assert d.status_code == 200 and not d.json()["can"]["complete"]
    # W2 has no department: the department list is empty and the action is hidden
    assert ctx.get("W2", "/api/v1/actions?department=1").json()["total"] == 0
    assert ctx.get("W2", f"/api/v1/actions/{aid}").status_code == 404
    # sync pull carries department actions for members
    assert aid in [x["id"] for x in ctx.get("W1", "/api/v1/sync/pull").json()["actions"]]
    # reassigning to an Electrical owner moves the action's department; the snapshot does not follow later moves
    run(lambda c: c.execute("update actions set owner_user_id = $1 where id = $2", uuid.UUID(ctx.ids["own2"]), uuid.UUID(aid)))
    assert run(lambda c: c.fetchval("select department_id::text from actions where id = $1", uuid.UUID(aid))) == ctx.ids["deptEle"]


def test_reporter_department_named_only(ctx):
    if "deptCiv" not in ctx.ids:
        test_department_admin_crud_and_user_assignment(ctx)
    named = ctx.create_obs("W1")
    anon = ctx.create_obs("W1", anonymous=True)
    dep = lambda oid: run(lambda c: c.fetchval("select reporter_department_id::text from observations where id = $1", uuid.UUID(oid)))  # noqa: E731
    assert dep(named["id"]) == ctx.ids["deptCiv"]
    assert dep(anon["id"]) is None


def test_insights_levels(ctx):
    if "deptCiv" not in ctx.ids:
        test_department_admin_crud_and_user_assignment(ctx)
    ctx.create_obs("W1", type="good_practice", description="Walkway kept clear")
    anon = ctx.create_obs("W1", anonymous=True, description="Anonymous one")
    me = ctx.get("W1", "/api/v1/insights?level=me").json()
    assert me["level"] == "me" and me["reports"]["total"] >= 2 and me["reports"]["goodPractice"] >= 1
    assert {x["key"] for x in me["byType"]} == {"good_practice", "unsafe_act", "unsafe_condition", "near_miss"}
    # my own anonymous report counts for me (through the seal), never for the department
    dept = ctx.get("W1", "/api/v1/insights?level=department").json()
    assert dept["departmentId"] == ctx.ids["deptCiv"] and dept["departmentName"]["en"] == "Civil works"
    n_dept_anon = run(lambda c: c.fetchval("select count(*) from observations where id = $1 and reporter_department_id is not null", uuid.UUID(anon["id"])))
    assert n_dept_anon == 0
    assert dept["reports"]["total"] >= 2  # W1's named reports (W1 is in Civil)
    # no department → 404 for the department level
    assert ctx.get("W2", "/api/v1/insights?level=department").status_code == 404
    site = ctx.get("SO1", f"/api/v1/insights?level=site&siteId={ctx.ids['siteA']}").json()
    assert site["reports"]["total"] >= me["reports"]["total"]
    assert {d["code"] for d in site["byDepartment"]} >= {"CIV", "ELE"}
    assert next(d for d in site["byDepartment"] if d["code"] == "ELE")["assigned"] >= 1  # the action reassigned to Electrical
    assert all(set(d) == {"departmentId", "code", "name", "reports", "assigned", "open", "overdue"} for d in site["byDepartment"])  # counts only
    assert ctx.get("SO1", f"/api/v1/insights?level=site&siteId={ctx.ids['siteB']}").status_code == 404  # outside scope
    # a long period switches to monthly buckets
    assert ctx.get("SO1", "/api/v1/insights?level=site&from=2025-01-01").json()["bucket"] == "month"


def _xlsx_sheets(content: bytes) -> list[str]:
    z = zipfile.ZipFile(io.BytesIO(content))
    for n in z.namelist():
        xml.dom.minidom.parseString(z.read(n))  # every part is well-formed XML
    wb = xml.dom.minidom.parseString(z.read("xl/workbook.xml"))
    return [s.getAttribute("name") for s in wb.getElementsByTagName("sheet")]


def test_xlsx_exports(ctx):
    if "deptCiv" not in ctx.ids:
        test_department_admin_crud_and_user_assignment(ctx)
    ctx.create_obs("W1", description="சாரக்கட்டில் நடுத் தண்டவாளம் இல்லை", descriptionLang="ta")
    r = ctx.get("SH1", f"/api/v1/exports/observations.xlsx?siteId={ctx.ids['siteA']}")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert _xlsx_sheets(r.content) == ["Reports"]
    sheet = zipfile.ZipFile(io.BytesIO(r.content)).read("xl/worksheets/sheet1.xml").decode()
    assert "சாரக்கட்டில்" in sheet and "Reporter department" in sheet
    r = ctx.get("SH1", f"/api/v1/exports/report.xlsx?siteId={ctx.ids['siteA']}")
    assert r.status_code == 200, r.text
    assert _xlsx_sheets(r.content) == ["Summary", "Reports", "Actions", "Departments"]
    assert "attachment" in r.headers["content-disposition"]
    # CSV still works and gains the Department column; workers cannot export; unknown lists are 404
    assert "Department" in ctx.get("SH1", f"/api/v1/exports/actions.csv?siteId={ctx.ids['siteA']}").text.splitlines()[0]
    assert ctx.get("W1", "/api/v1/exports/report.xlsx").status_code == 403
    assert ctx.get("SH1", "/api/v1/exports/users.xlsx").status_code == 404
    n = run(lambda c: c.fetchval("select count(*) from audit_log where action = 'export' and record_id = 'xlsx'"))
    assert n >= 2


def test_xlsx_writer_units():
    from datetime import datetime, timezone
    from safeworks.xlsx import Sheet, _col, workbook
    assert [_col(i) for i in (0, 25, 26, 701, 702)] == ["A", "Z", "AA", "ZZ", "AAA"]
    data = workbook([Sheet("a/b:c", [["H1", "H2"], ["x\x01y", datetime(2026, 1, 1, tzinfo=timezone.utc)], [True, 3.5]]), Sheet("a/b:c", [["z"]])])
    names = _xlsx_sheets(data)
    assert names[0] == "a b c" and names[1] != names[0]  # cleaned and unique
    s1 = zipfile.ZipFile(io.BytesIO(data)).read("xl/worksheets/sheet1.xml").decode()
    assert "\x01" not in s1 and ">Yes<" in s1 and "<v>3.5</v>" in s1
