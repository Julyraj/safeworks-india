"""A small, dependency-free .xlsx writer (Office Open XML, standard library only).

Enough for exports: several sheets, a bold frozen header row with filters, column widths, numbers, Yes/No for booleans and
real Excel date-times (India time, `yyyy-mm-dd hh:mm`). Text is written as inline strings, so Tamil, Kannada and Hindi
open correctly without the CSV byte-order-mark trick.
"""
from __future__ import annotations

import io
import re
import zipfile
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Iterable
from xml.sax.saxutils import escape

from fastapi.responses import Response

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_BAD_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]")
_EPOCH = datetime(1899, 12, 30)
_MAX_TEXT = 32_767  # Excel's limit per cell
STYLE_TEXT, STYLE_HEADER, STYLE_DATETIME, STYLE_DATE, STYLE_TITLE = 0, 1, 2, 3, 4


def _col(n: int) -> str:
    """0 → A, 25 → Z, 26 → AA."""
    s = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def _ist(d: datetime) -> datetime:
    from . import db
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(db.TZ).replace(tzinfo=None)


def _text(v: str) -> str:
    return escape(_BAD_XML.sub("", v)[:_MAX_TEXT])


def _cell(ref: str, v: Any, header: bool, style: int = STYLE_TEXT) -> str:
    if v is None or v == "":
        return ""
    if header:
        return f'<c r="{ref}" t="inlineStr" s="{STYLE_HEADER}"><is><t xml:space="preserve">{_text(str(v))}</t></is></c>'
    st = f' s="{style}"' if style else ""
    if isinstance(v, bool):
        v = "Yes" if v else "No"
    if isinstance(v, datetime):
        serial = (_ist(v) - _EPOCH).total_seconds() / 86400
        return f'<c r="{ref}" s="{STYLE_DATETIME}"><v>{serial:.6f}</v></c>'
    if isinstance(v, date):
        return f'<c r="{ref}" s="{STYLE_DATE}"><v>{(datetime(v.year, v.month, v.day) - _EPOCH).days}</v></c>'
    if isinstance(v, (int, float, Decimal)):
        return f'<c r="{ref}"{st}><v>{v}</v></c>'
    if isinstance(v, (list, tuple)):
        v = ", ".join(str(x) for x in v)
    return f'<c r="{ref}" t="inlineStr"{st}><is><t xml:space="preserve">{_text(str(v))}</t></is></c>'


def _width(v: Any) -> int:
    if v is None:
        return 0
    if isinstance(v, datetime):
        return 16
    return min(60, max(len(line) for line in str(v).split("\n")) if str(v) else 0)


class Sheet:
    def __init__(self, name: str, rows: Iterable[list[Any]], *, header: bool = True, bold_rows: Iterable[int] = ()):
        # Excel sheet names: ≤ 31 characters, none of []:*?/\
        self.name = re.sub(r"[\[\]:*?/\\]", " ", name)[:31] or "Sheet"
        self.rows = [list(r) for r in rows]
        self.header = header
        self.bold_rows = set(bold_rows)  # row indexes printed bold (section titles in a summary sheet)

    def xml(self) -> str:
        ncols = max((len(r) for r in self.rows), default=1) or 1
        widths = [8] * ncols
        for r in self.rows[:2000]:
            for i, v in enumerate(r):
                widths[i] = max(widths[i], _width(v) + 2)
        cols = "".join(f'<col min="{i + 1}" max="{i + 1}" width="{min(w, 62)}" customWidth="1"/>' for i, w in enumerate(widths))
        body = []
        for ri, r in enumerate(self.rows):
            if self.header and ri == 0:
                cells = "".join(_cell(f"{_col(ci)}{ri + 1}", v, True) for ci, v in enumerate(r))
            elif ri in self.bold_rows:
                cells = "".join(_cell(f"{_col(ci)}{ri + 1}", v, False, STYLE_TITLE) for ci, v in enumerate(r))
            else:
                cells = "".join(_cell(f"{_col(ci)}{ri + 1}", v, False) for ci, v in enumerate(r))
            body.append(f'<row r="{ri + 1}">{cells}</row>')
        pane = ('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
                if self.header and len(self.rows) > 1 else '<sheetViews><sheetView workbookViewId="0"/></sheetViews>')
        filt = f'<autoFilter ref="A1:{_col(ncols - 1)}{len(self.rows)}"/>' if self.header and len(self.rows) > 1 else ""
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                f'{pane}<cols>{cols}</cols><sheetData>{"".join(body)}</sheetData>{filt}</worksheet>')


_STYLES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
           '<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts>'
           '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
           '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
           '<fill><patternFill patternType="solid"><fgColor rgb="FFFFD400"/><bgColor indexed="64"/></patternFill></fill></fills>'
           '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
           '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
           '<cellXfs count="5">'
           '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
           '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
           '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
           '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
           '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
           '</cellXfs></styleSheet>')


def workbook(sheets: list[Sheet]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        overrides = "".join(f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                            for i in range(len(sheets)))
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                   f'{overrides}</Types>')
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                   '</Relationships>')
        names, seen = [], set()
        for s in sheets:  # sheet names must be unique (case-insensitive)
            n, k = s.name, 2
            while n.lower() in seen:
                n = f"{s.name[:28]} {k}"
                k += 1
            seen.add(n.lower())
            names.append(n)
        z.writestr("xl/workbook.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                   '<sheets>' + "".join(f'<sheet name="{escape(n, {chr(34): "&quot;"})}" sheetId="{i + 1}" r:id="rId{i + 1}"/>' for i, n in enumerate(names)) + '</sheets>'
                   '</workbook>')
        z.writestr("xl/_rels/workbook.xml.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   + "".join(f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i + 1}.xml"/>'
                             for i in range(len(sheets)))
                   + f'<Relationship Id="rId{len(sheets) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                   '</Relationships>')
        z.writestr("xl/styles.xml", _STYLES)
        for i, s in enumerate(sheets):
            z.writestr(f"xl/worksheets/sheet{i + 1}.xml", s.xml())
    return buf.getvalue()


def xlsx_response(sheets: list[Sheet], filename: str) -> Response:
    return Response(workbook(sheets), media_type=XLSX_MEDIA_TYPE, headers={"content-disposition": f'attachment; filename="{filename}"'})
