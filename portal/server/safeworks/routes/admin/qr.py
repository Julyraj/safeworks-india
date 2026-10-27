"""Admin: QR codes per site, area or asset, rotation, and the printable poster (inline SVG QR)."""
from __future__ import annotations

import html
import io

import qrcode
import qrcode.image.svg
from fastapi import APIRouter, Depends, Request
from starlette.responses import Response

from ... import db
from ...audit import audit
from ...config import config
from ...errors import not_found
from ...http import JSON, json_body, opt_uuid, uuid_param
from ...i18n import LANGS, pick, t
from ...rbac import AuthUser
from ...schemas import QrCodeIn, QrCodeUpdate, parse
from ...security import qr_token
from ...views import qr_code as qr_view
from ._common import console_user, need_site_config, scope_sites

router = APIRouter(prefix="/api/v1/admin")


async def _target_info(q: dict) -> tuple[str | None, str, dict | None, dict | None, dict | None]:
    """(site_id, target name, site, area, asset)."""
    if q["target_type"] == "site":
        s = await db.one("select * from sites where id = $1", [q["target_id"]])
        return (s["id"], s["code"], s, None, None) if s else (None, "", None, None, None)
    if q["target_type"] == "area":
        a = await db.one("select * from areas where id = $1", [q["target_id"]])
        if not a:
            return None, "", None, None, None
        s = await db.one("select * from sites where id = $1", [a["site_id"]])
        return a["site_id"], pick(a["name_i18n"], "en"), s, a, None
    ast = await db.one("select * from assets where id = $1", [q["target_id"]])
    if not ast:
        return None, "", None, None, None
    s = await db.one("select * from sites where id = $1", [ast["site_id"]])
    a = await db.one("select * from areas where id = $1", [ast["area_id"]]) if ast["area_id"] else None
    return ast["site_id"], ast["tag_no"], s, a, ast


@router.get("/qr-codes")
async def list_qr(request: Request, user: AuthUser = Depends(console_user)):
    site_id = opt_uuid(request.query_params.get("siteId"))
    sites = scope_sites(user, site_id)
    rows = await db.q(
        """select q.*, coalesce(s.code, a.name_i18n->>'en', ast.tag_no, '') as target_name, coalesce(s.id, a.site_id, ast.site_id) as site_id
             from qr_codes q left join sites s on q.target_type = 'site' and s.id = q.target_id left join areas a on q.target_type = 'area' and a.id = q.target_id
             left join assets ast on q.target_type = 'asset' and ast.id = q.target_id
            where q.org_id = $1 and coalesce(s.id, a.site_id, ast.site_id) = any($2::uuid[]) order by q.created_at desc""", [user.org_id, sites])
    return JSON([qr_view(r, config.public_url) for r in rows])


@router.post("/qr-codes")
async def create_qr(request: Request, user: AuthUser = Depends(console_user)):
    inp = parse(QrCodeIn, await json_body(request))
    site_id, name, *_ = await _target_info({"target_type": inp.target_type, "target_id": inp.target_id})
    if not site_id:
        raise not_found()
    need_site_config(user, site_id)
    async with db.tx() as c:
        row = await db.one("insert into qr_codes (org_id, token, target_type, target_id, label, prefill, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *",
                           [user.org_id, qr_token(), inp.target_type, inp.target_id, inp.label or name, inp.prefill, user.id], c)
        await audit(c, org_id=user.org_id, actor=user, action="create", record_type="qr_code", record_id=row["id"], site_id=site_id, changes={"targetType": inp.target_type, "targetId": inp.target_id, "label": inp.label})
    return JSON(qr_view({**row, "target_name": name}, config.public_url), status_code=201)


@router.post("/qr-codes/{qr_id}/rotate")
async def rotate_qr(qr_id: str, user: AuthUser = Depends(console_user)):
    q = await db.one("select * from qr_codes where id = $1 and org_id = $2", [uuid_param(qr_id), user.org_id])
    if not q:
        raise not_found()
    site_id, name, *_ = await _target_info(q)
    need_site_config(user, site_id)
    async with db.tx() as c:
        await c.execute("update qr_codes set active = false where id = $1", q["id"])
        row = await db.one("insert into qr_codes (org_id, token, target_type, target_id, label, prefill, rotated_from_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *",
                           [user.org_id, qr_token(), q["target_type"], q["target_id"], q["label"], q["prefill"], q["id"], user.id], c)
        await audit(c, org_id=user.org_id, actor=user, action="config_change", record_type="qr_code", record_id=row["id"], site_id=site_id, changes={"rotatedFrom": q["id"]})
    return JSON(qr_view({**row, "target_name": name}, config.public_url), status_code=201)


@router.put("/qr-codes/{qr_id}")
async def update_qr(qr_id: str, request: Request, user: AuthUser = Depends(console_user)):
    q = await db.one("select * from qr_codes where id = $1 and org_id = $2", [uuid_param(qr_id), user.org_id])
    if not q:
        raise not_found()
    site_id, name, *_ = await _target_info(q)
    need_site_config(user, site_id)
    inp = parse(QrCodeUpdate, await json_body(request))
    async with db.tx() as c:
        row = await db.one("update qr_codes set label = coalesce($2, label), active = coalesce($3, active) where id = $1 returning *", [q["id"], inp.label, inp.active], c)
        await audit(c, org_id=user.org_id, actor=user, action="update", record_type="qr_code", record_id=q["id"], site_id=site_id, changes={"label": [q["label"], row["label"]], "active": [q["active"], row["active"]]})
    return JSON(qr_view({**row, "target_name": name}, config.public_url))


def qr_svg(data: str) -> str:
    img = qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2, error_correction=qrcode.constants.ERROR_CORRECT_M)
    buf = io.BytesIO()
    img.save(buf)
    svg = buf.getvalue().decode("utf-8")
    svg = svg[svg.index("<svg"):]
    return svg.replace("<svg ", "<svg role='img' aria-label='QR code' ", 1)


@router.get("/qr-codes/{qr_id}/poster")
async def poster(qr_id: str, request: Request, user: AuthUser = Depends(console_user)):
    q = await db.one("select * from qr_codes where id = $1 and org_id = $2", [uuid_param(qr_id), user.org_id])
    if not q:
        raise not_found()
    site_id, name, site, area, asset = await _target_info(q)
    if not site_id or site_id not in user.sites_in_scope():
        raise not_found()
    langs = [l for l in (request.query_params.get("lang") or "en,hi,ta,kn").split(",") if l in LANGS] or ["en"]
    size = "A5" if request.query_params.get("size", "A4").upper() == "A5" else "A4"
    org = await db.one("select name from organisations where id = $1", [user.org_id])
    url = f"{config.public_url}/q/{q['token']}"
    svg = qr_svg(url)
    e = html.escape
    blocks = []
    for lang in langs:
        blocks.append(f"<div class='lang'><div class='h'>{e(t('poster.headline', lang, user.org_id))}</div><div class='s'>{e(t('poster.scan', lang, user.org_id))}</div>"
                      f"<div class='sub'>{e(t('poster.sub', lang, user.org_id))}</div></div>")
    where = [f"{e(t('poster.site', 'en', user.org_id))}: {e(pick(site['name_i18n'], 'en'))} ({e(site['code'])})"]
    if area:
        where.append(f"{e(t('poster.area', 'en', user.org_id))}: {e(pick(area['name_i18n'], 'en'))}")
    if asset:
        where.append(f"{e(t('poster.asset', 'en', user.org_id))}: {e(asset['tag_no'])}")
    qr_mm = 90 if size == "A4" else 60
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SafeWorks poster {e(name)}</title>
<style>@page{{size:{size};margin:12mm}}body{{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Tamil","Noto Sans Kannada","Noto Sans Devanagari",sans-serif;margin:0;color:#111;background:#fff}}
.poster{{max-width:{'190mm' if size == 'A4' else '125mm'};margin:0 auto;padding:10mm;text-align:center;border:3px solid #d32f2f;border-radius:12px}}
.top{{background:#d32f2f;color:#fff;padding:8px 12px;border-radius:8px;font-weight:800;font-size:{'22px' if size == 'A4' else '16px'};letter-spacing:.02em}}
.qr svg{{width:{qr_mm}mm;height:{qr_mm}mm;margin:10px auto;display:block}}
.lang{{margin:8px 0;border-top:1px solid #eee;padding-top:8px}}.lang .h{{font-size:{'24px' if size == 'A4' else '17px'};font-weight:800}}.lang .s{{font-size:{'18px' if size == 'A4' else '13px'};font-weight:600;color:#d32f2f}}
.lang .sub{{font-size:{'13px' if size == 'A4' else '10px'};color:#444;margin-top:2px}}.where{{font-size:{'15px' if size == 'A4' else '11px'};margin-top:8px;font-weight:600}}
.url{{font-size:11px;color:#555;word-break:break-all;margin-top:6px}}.foot{{font-size:11px;color:#777;margin-top:10px}}
@media print{{body{{-webkit-print-color-adjust:exact;print-color-adjust:exact}}}}</style></head>
<body><div class="poster"><div class="top">SafeWorks · {e(org['name'] if org else '')}</div><div class="qr">{svg}</div>
<div class="where">{' · '.join(where)}</div>{''.join(blocks)}<div class="url">{e(url)}</div>
<div class="foot">{e(t('poster.footer', 'en', user.org_id, org=org['name'] if org else ''))} · {e(q['token'][:6])}…</div></div></body></html>"""
    async with db.tx() as c:
        await audit(c, org_id=user.org_id, actor=user, action="view_sensitive", record_type="qr_code", record_id=q["id"], site_id=site_id, changes={"poster": True, "langs": langs, "size": size})
    return Response(page, media_type="text/html; charset=utf-8", headers={"content-disposition": f'inline; filename="poster-{e(name).replace(" ", "_")}.html"'})
