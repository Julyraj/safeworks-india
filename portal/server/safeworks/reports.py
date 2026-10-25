"""The locked inspection report: self-contained printable HTML stored as media kind `html` on submit.

Each photo sits beside its item (long-lived signed links to /files, same origin, so the browser's "Save as PDF" works),
Tamil, Kannada and Hindi text render with system fonts, and print CSS keeps items together on the page.
"""
from __future__ import annotations

import hashlib
import html
from datetime import datetime, timezone

from . import db
from .i18n import pick, t
from .storage import storage
from .views import media as media_view

CSS = """
:root{color-scheme:light}body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Tamil","Noto Sans Kannada","Noto Sans Devanagari",sans-serif;margin:0;color:#1b1f23;background:#fff}
.page{max-width:900px;margin:0 auto;padding:24px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 8px;border-bottom:2px solid #1b1f23;padding-bottom:4px}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:6px 18px;font-size:13px;margin:12px 0 4px}.meta b{display:block;color:#555;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.result{display:inline-block;padding:6px 14px;border-radius:6px;font-weight:700;font-size:15px;color:#fff}.pass{background:#2e7d32}.fail{background:#c62828}.tag-do-not-use{background:#c62828}.tag-safe{background:#2e7d32}
.banner{background:#fff3cd;border:1px solid #ffe08a;color:#6b4e00;padding:10px 14px;border-radius:6px;margin:12px 0;font-weight:600}
.item{display:grid;grid-template-columns:1fr 220px;gap:12px;border:1px solid #ddd;border-radius:8px;padding:12px;margin:8px 0;page-break-inside:avoid;break-inside:avoid}
.item.flag{border-color:#c62828;background:#fff7f7}.item .q{font-weight:600}.item .ans{margin-top:6px;font-size:13px}.item .ans span{display:inline-block;padding:2px 8px;border-radius:4px;background:#eee;margin-right:6px}
.item .ans span.red{background:#ffcdd2}.item .ans span.green{background:#c8e6c9}.item .ans span.grey{background:#e0e0e0}.item .photos img{width:100%;height:auto;border-radius:6px;margin-bottom:6px;border:1px solid #ccc}
.item .ref{font-size:11px;color:#666;margin-top:6px}.repeat{color:#c62828;font-weight:700;font-size:12px}.sig img{max-height:120px;border:1px solid #ccc;border-radius:6px}
.foot{margin-top:28px;font-size:11px;color:#666;border-top:1px solid #ddd;padding-top:8px}
@media print{.page{padding:0}.item{break-inside:avoid}a{color:inherit;text-decoration:none}}
"""


def _e(v) -> str:
    return html.escape("" if v is None else str(v), quote=True)


def _answer_text(q: dict, value, lang: str) -> tuple[str, str]:
    """(label, colour) for an answer value."""
    if value is None or value == "" or value == []:
        return t("report.not_answered", lang), "grey"
    if q["answer_type"] in ("pass_fail_na", "single_choice", "multi_choice"):
        values = value if isinstance(value, list) else [value]
        labels, colour = [], "grey"
        for v in values:
            opt = next((o for o in (q["response_set"] or []) if str(o.get("value")) == str(v)), None)
            if opt:
                labels.append(pick(opt.get("label") or opt.get("label_i18n") or {}, lang) or str(v))
                if opt.get("colour") in ("red", "green", "amber"):
                    colour = opt["colour"] if colour != "red" else "red"
            else:
                labels.append(str(v))
        return ", ".join(labels), colour
    if q["answer_type"] == "number":
        return f"{value} {q['unit'] or ''}".strip(), "grey"
    if q["answer_type"] in ("photo", "signature"):
        return t("report.photo", lang), "grey"
    return str(value), "grey"


async def render_run_report(conn, run_id: str, lang: str | None = None) -> str:
    run = await db.one(
        """select r.*, t.code as template_code, t.name_i18n as template_name, v.version as template_version_no, s.code as site_code, s.name_i18n as site_name,
                  a.name_i18n as area_name, ast.tag_no, ast.asset_class, coalesce(p.full_name, u.employee_code) as inspector_name, o.name as org_name
             from inspection_runs r join inspection_template_versions v on v.id = r.template_version_id join inspection_templates t on t.id = v.template_id
             join sites s on s.id = r.site_id join organisations o on o.id = r.org_id left join areas a on a.id = r.area_id left join assets ast on ast.id = r.asset_id
             left join users u on u.id = r.inspector_user_id left join people p on p.id = u.person_id where r.id = $1""",
        [run_id], conn,
    )
    if not run:
        return ""
    lang = lang or (await conn.fetchval("select language from users where id = $1", run["inspector_user_id"]) if run["inspector_user_id"] else None) or "en"
    org = run["org_id"]
    sections = await db.q("select * from inspection_sections where version_id = $1 order by sort, id", [run["template_version_id"]], conn)
    questions = await db.q(
        "select q.* from inspection_questions q join inspection_sections s on s.id = q.section_id where s.version_id = $1 order by s.sort, q.sort, q.id", [run["template_version_id"]], conn
    )
    answers = await db.q(
        """select ia.*, act.case_no as action_case_no, act.title as action_title, act.status as action_status from inspection_answers ia
             left join actions act on act.id = ia.action_id where ia.run_id = $1 order by ia.repeat_index, ia.answered_at""",
        [run_id], conn,
    )
    media_rows = await db.q("select * from media where owner_type = 'inspection_answer' and owner_id = any($1::uuid[]) and upload_status in ('uploaded','verified') order by received_at",
                            [[a["id"] for a in answers]], conn) if answers else []
    media_by_answer: dict[str, list[dict]] = {}
    for m in media_rows:
        media_by_answer.setdefault(m["owner_id"], []).append(media_view(m, long_lived=True))
    sig = None
    if run["signature_media_id"]:
        sm = await db.one("select * from media where id = $1 and upload_status in ('uploaded','verified')", [run["signature_media_id"]], conn)
        sig = media_view(sm, long_lived=True) if sm else None
    ans_by_q: dict[str, list[dict]] = {}
    for a in answers:
        ans_by_q.setdefault(a["question_id"], []).append(a)

    parts: list[str] = []
    title = pick(run["template_name"], lang)
    parts.append(f"<!doctype html><html lang='{_e(lang)}'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>")
    parts.append(f"<title>{_e(t('report.title', lang, org))} {_e(run['case_no'])}</title><style>{CSS}</style></head><body><div class='page'>")
    if run.get("report_superseded"):
        parts.append(f"<div class='banner'>{_e(t('report.superseded', lang, org))}</div>")
    parts.append(f"<h1>{_e(t('report.title', lang, org))} · {_e(run['case_no'])}</h1><div>{_e(title)} — {_e(t('report.version', lang, org))} {run['template_version_no']}</div>")
    res = run["result"]
    if res:
        cls = "pass" if res == "pass" else "fail"
        parts.append(f"<p><span class='result {cls}'>{_e(t('report.' + res, lang, org))}</span> &nbsp; {_e(t('report.score', lang, org))}: {float(run['score_pct']) if run['score_pct'] is not None else '—'}%")
        if run["tag_status"]:
            tcls = "tag-do-not-use" if run["tag_status"] == "do_not_use" else "tag-safe"
            parts.append(f" &nbsp; <span class='result {tcls}'>{_e(t('report.' + run['tag_status'], lang, org))}</span>")
        parts.append("</p>")
    meta = [
        (t("report.site", lang, org), f"{pick(run['site_name'], lang)} ({run['site_code']})"),
        (t("report.area", lang, org), pick(run["area_name"], lang) if run["area_name"] else "—"),
        (t("report.asset", lang, org), f"{run['tag_no']} ({run['asset_class']})" if run["tag_no"] else "—"),
        (t("report.inspector", lang, org), run["inspector_name"] or "—"),
        (t("report.started", lang, org), _fmt(run["started_at"])),
        (t("report.completed", lang, org), _fmt(run["completed_at"])),
        (t("report.gps", lang, org), f"{run['submit_lat']:.5f}, {run['submit_lng']:.5f}" if run["submit_lat"] is not None else "—"),
    ]
    for k, v in (run["header"] or {}).items():
        meta.append((str(k), str(v)))
    parts.append("<div class='meta'>" + "".join(f"<div><b>{_e(k)}</b>{_e(v)}</div>" for k, v in meta) + "</div>")
    if run["immediate_action"]:
        parts.append(f"<p><b>{_e(t('report.immediate_action', lang, org))}:</b> {_e(run['immediate_action'])}</p>")
    failed = [a for a in answers if a["flag"]]
    parts.append(f"<p>{_e(t('report.failed_items', lang, org))}: {len(failed)} · {_e(t('report.actions_raised', lang, org))}: {sum(1 for a in answers if a['action_id'])}</p>")
    for s in sections:
        parts.append(f"<h2>{_e(pick(s['title_i18n'], lang))}</h2>")
        for q in [x for x in questions if x["section_id"] == s["id"]]:
            qa = ans_by_q.get(q["id"]) or [None]
            for a in qa:
                label, colour = _answer_text(q, a["value"] if a else None, lang)
                flag = bool(a and a["flag"])
                photos = media_by_answer.get(a["id"], []) if a else []
                rep = f"<span class='repeat'>⟳ {_e(t('report.repeat_finding', lang, org))}</span>" if a and a["repeat_finding"] else ""
                idx = f" #{a['repeat_index'] + 1}" if a and s["repeatable"] else ""
                parts.append(f"<div class='item{' flag' if flag else ''}'><div><div class='q'>{_e(q['code'])}{idx} {_e(pick(q['text_i18n'], lang))} {rep}</div>")
                parts.append(f"<div class='ans'><span class='{colour}'>{_e(label)}</span>")
                if a and a["note"]:
                    parts.append(f"{_e(t('report.note', lang, org))}: {_e(a['note'])}")
                parts.append("</div>")
                if a and a["action_case_no"]:
                    parts.append(f"<div class='ans'>{_e(t('report.action', lang, org))}: {_e(a['action_case_no'])} — {_e(a['action_title'])} ({_e(a['action_status'])})</div>")
                if q["reference_text"]:
                    parts.append(f"<div class='ref'>{_e(t('report.reference', lang, org))}: {_e(q['reference_text'])} [{_e(q['reference_status'])}]</div>")
                parts.append("</div><div class='photos'>")
                for m in photos:
                    if m["kind"] == "photo" and m["url"]:
                        parts.append(f"<img src='{_e(m['url'])}' alt='{_e(t('report.photo', lang, org))}' loading='lazy'>")
                parts.append("</div></div>")
    if sig and sig["url"]:
        parts.append(f"<h2>{_e(t('report.signature', lang, org))}</h2><div class='sig'><img src='{_e(sig['url'])}' alt='signature'></div>")
    gen = datetime.now(timezone.utc)
    parts.append(f"<div class='foot'>{_e(t('report.locked', lang, org))} · {_e(t('report.generated', lang, org, at=_fmt(gen)))} · {_e(run['org_name'])}</div>")
    parts.append("</div></body></html>")
    return "".join(parts)


def _fmt(d: datetime | None) -> str:
    return d.astimezone(db.TZ).strftime("%d %b %Y, %H:%M") if d else "—"


async def store_run_report(conn, run_id: str, lang: str | None = None) -> str | None:
    """Render and store the report as a media row (kind html); returns the media id."""
    body = await render_run_report(conn, run_id, lang)
    if not body:
        return None
    data = body.encode("utf-8")
    key = f"reports/{run_id}/{int(datetime.now(timezone.utc).timestamp())}.html"
    await storage.put(key, data, "text/html")
    sha = hashlib.sha256(data).hexdigest()
    import uuid as _uuid
    row = await db.one(
        """insert into media (client_uuid, org_id, owner_type, owner_id, kind, purpose, storage_key, mime, bytes, sha256_capture, sha256_server, hash_match, captured_at, upload_status)
           select $1, org_id, 'inspection_run', id, 'html', 'report', $2, 'text/html', $3, $4, $4, true, now(), 'verified' from inspection_runs where id = $5 returning id""",
        [str(_uuid.uuid4()), key, len(data), sha, run_id], conn,
    )
    await db.execute("update inspection_runs set report_media_id = $2, report_superseded = false where id = $1", [run_id, row["id"]], conn)
    return row["id"]


async def read_run_report(conn, run_id: str) -> bytes | None:
    key = await conn.fetchval("select m.storage_key from inspection_runs r join media m on m.id = r.report_media_id where r.id = $1", run_id)
    if not key:
        return None
    return await storage.get(key)
