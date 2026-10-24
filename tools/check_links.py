#!/usr/bin/env python3
"""Check every official document link in the library (data/regulations.json → docs).

    python3 tools/check_links.py [--report report.md] [--issue issue.md] [--strict]
    python3 tools/check_links.py --only URL [URL …]     # check given links and print the details

Each link is opened (HEAD, then a small GET if HEAD is refused) and sorted into:
  ok           – the page or PDF answered (also when only the site's certificate chain is incomplete,
                 which browsers handle but scripts reject — common on Indian government sites)
  broken       – gone for sure: 404/410 while the site's home page still answers,
                 or the site name no longer exists
  unreachable  – could not be checked from here: time-out, 403/429/5xx, refused connection,
                 or 404 from a site whose home page also refuses us (a block, not a missing page).
                 Several Indian government sites block or slow down visitors from abroad
                 (including GitHub's servers), so these are listed for a manual look, not as failures.
Checks the "Official documents" links and each card's "official site" link.
Writes a full Markdown report (also to the GitHub job summary when run in Actions) and a short
issue text with only the broken links (--issue).
Exit code: 0, or 1 with --strict when any link is broken.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import ssl
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 SafeWorks-link-check"
TIMEOUT = 30


NO_VERIFY = ssl._create_unverified_context()  # only to see whether a site with a broken certificate chain answers


def probe(url: str, insecure: bool = False) -> tuple[str, str]:
    """Return (state, detail)."""
    last = ""
    for method in ("HEAD", "GET"):
        headers = {"User-Agent": UA, "Accept": "*/*"}
        if method == "GET":
            headers["Range"] = "bytes=0-2047"
        req = urllib.request.Request(url, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=NO_VERIFY if insecure else None) as res:
                return "ok", f"{res.status}" + (" (certificate chain incomplete)" if insecure else "")
        except urllib.error.HTTPError as e:
            if e.code == 416:  # range not satisfiable: the file is there
                return "ok", "416"
            last = f"HTTP {e.code}"
            if method == "HEAD" and e.code in (400, 403, 404, 405, 406, 410, 429, 500, 501, 503):
                continue  # many servers refuse or mishandle HEAD; confirm with a small GET
            if e.code in (404, 410):
                return "broken", last
            return "unreachable", last
        except urllib.error.URLError as e:
            reason = e.reason
            if isinstance(reason, socket.gaierror):
                if reason.errno == socket.EAI_NONAME:
                    return "broken", "site name not found (DNS)"
                return "unreachable", f"DNS lookup failed ({reason})"
            if isinstance(reason, ssl.SSLCertVerificationError):
                if not insecure:
                    state, detail = probe(url, insecure=True)
                    return (state, detail) if state != "unreachable" else ("unreachable", "certificate problem; " + detail)
                return "unreachable", "certificate problem"
            last = f"{type(reason).__name__}: {reason}"
        except (TimeoutError, socket.timeout):
            last = "time-out"
        except Exception as e:  # noqa: BLE001 – report anything else as unreachable
            last = f"{type(e).__name__}: {e}"
        if method == "HEAD":
            continue
    return "unreachable", last or "no answer"


_roots: dict[str, tuple[str, str]] = {}
_roots_lock = threading.Lock()


def root_state(url: str) -> tuple[str, str]:
    """State of the site's home page, cached per site."""
    p = urllib.parse.urlsplit(url)
    root = f"{p.scheme}://{p.netloc}/"
    with _roots_lock:
        if root in _roots:
            return _roots[root]
    st = probe(root) if root.rstrip("/") != url.rstrip("/") else ("broken", "")
    with _roots_lock:
        _roots[root] = st
    return st


def check(url: str) -> tuple[str, str]:
    state, detail = probe(url)
    if state == "broken" and detail.startswith("HTTP"):
        r_state, _ = root_state(url)
        if r_state != "ok":  # the home page refuses us too: a block, not a missing page
            return "unreachable", f"{detail}; the site's home page also refuses GitHub (probably blocks visitors from abroad)"
    return state, detail


def only(urls: list[str]) -> int:
    for u in urls:
        state, detail = check(u)
        try:
            req = urllib.request.Request(u, headers={"User-Agent": UA, "Accept": "*/*", "Range": "bytes=0-511"})
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=NO_VERIFY) as res:
                head = res.read(512)
                extra = f"final={res.geturl()} type={res.headers.get('Content-Type')} pdf={head.startswith(b'%PDF')}"
                if not head.startswith(b"%PDF"):
                    t = head.decode("utf-8", "replace")
                    i = t.lower().find("<title>")
                    extra += f" title={t[i + 7:t.lower().find('</title>')].strip()[:100]!r}" if i >= 0 else ""
        except Exception as e:  # noqa: BLE001
            extra = f"GET failed: {type(e).__name__}: {e}"
        print(f"{state.upper():12} {u}\n             {detail} | {extra}", flush=True)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", default="link-report.md")
    ap.add_argument("--issue", default="link-issue.md")
    ap.add_argument("--run-url", default="")
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--only", nargs="+", metavar="URL")
    args = ap.parse_args()
    if args.only:
        return only(args.only)

    regs = json.loads((ROOT / "data" / "regulations.json").read_text(encoding="utf-8"))
    links: dict[str, list[str]] = {}
    for r in regs:
        for d in r.get("docs", []):
            links.setdefault(d["u"], []).append(f"{r['t']} — {d['n']}")
        if r.get("url"):
            links.setdefault(r["url"], []).append(f"{r['t']} — official site link on the card")
    print(f"Checking {len(links)} links…", flush=True)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = dict(zip(links, pool.map(check, links)))

    groups: dict[str, list[tuple[str, str]]] = {"broken": [], "unreachable": [], "ok": []}
    for url, (state, detail) in results.items():
        groups[state].append((url, detail))

    lines = [
        "# Document link check",
        "",
        f"{len(links)} links: **{len(groups['ok'])} ok**, **{len(groups['broken'])} broken**, {len(groups['unreachable'])} could not be checked from here.",
        "",
    ]
    if groups["broken"]:
        lines += ["## Broken (fix these)", "", "| Document | Link | Problem |", "| --- | --- | --- |"]
        for url, detail in sorted(groups["broken"]):
            lines.append(f"| {'<br>'.join(links[url])} | {url} | {detail} |")
        lines += [""]
    if groups["unreachable"]:
        lines += ["## Could not be checked from GitHub (open them by hand from India)", "", "| Document | Link | Problem |", "| --- | --- | --- |"]
        for url, detail in sorted(groups["unreachable"]):
            lines.append(f"| {'<br>'.join(links[url])} | {url} | {detail} |")
        lines += [""]
    lines += ["To fix a link, edit `src/data/data-docs.js`, run `python3 build.py`, and push."]
    report = "\n".join(lines) + "\n"
    Path(args.report).write_text(report, encoding="utf-8")
    issue = [lines[0], "", lines[2], ""]
    if groups["broken"]:
        issue += ["| Document | Link | Problem |", "| --- | --- | --- |"]
        issue += [f"| {'<br>'.join(links[u])} | {u} | {d} |" for u, d in sorted(groups["broken"])]
        issue += [""]
    issue += ["Links that could not be checked from GitHub (many Indian government sites time out for visitors from abroad) are listed in the full report"
              + (f" on the [workflow run]({args.run_url})." if args.run_url else "."),
              "", "To fix a link, edit `src/data/data-docs.js` (or the card's `url` in `src/data/`), run `python3 build.py`, and push."]
    Path(args.issue).write_text("\n".join(issue) + "\n", encoding="utf-8")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(report)
    print(lines[2])
    print(f"BROKEN={len(groups['broken'])}")
    return 1 if (args.strict and groups["broken"]) else 0


if __name__ == "__main__":
    sys.exit(main())
