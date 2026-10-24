#!/usr/bin/env python3
"""Check every official document link in the library (data/regulations.json → docs).

    python3 tools/check_links.py [--report report.md] [--strict]

Each link is opened (HEAD, then a small GET if HEAD is refused) and sorted into:
  ok           – the page or PDF answered
  broken       – gone for sure: 404/410, or the site name no longer exists
  unreachable  – could not be checked from here: time-out, 403/429/5xx, refused connection.
                 Several Indian government sites block or slow down visitors from abroad
                 (including GitHub's servers), so these are listed for a manual look, not as failures.
Writes a Markdown report (also to the GitHub job summary when run in Actions).
Exit code: 0, or 1 with --strict when any link is broken.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import ssl
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 SafeWorks-link-check"
TIMEOUT = 30


def probe(url: str) -> tuple[str, str]:
    """Return (state, detail)."""
    last = ""
    for method in ("HEAD", "GET"):
        req = urllib.request.Request(url, method=method, headers={"User-Agent": UA, "Accept": "*/*", "Range": "bytes=0-2047"})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
                return "ok", f"{res.status}"
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return "broken", f"HTTP {e.code}"
            last = f"HTTP {e.code}"
            if method == "HEAD" and e.code in (400, 403, 405, 406, 429, 500, 501, 503):
                continue  # many servers refuse HEAD; try a small GET
            return "unreachable", last
        except urllib.error.URLError as e:
            reason = e.reason
            if isinstance(reason, socket.gaierror):
                return "broken", "site name not found (DNS)"
            if isinstance(reason, ssl.SSLCertVerificationError):
                return "unreachable", "certificate problem"
            last = f"{type(reason).__name__}: {reason}"
        except (TimeoutError, socket.timeout):
            last = "time-out"
        except Exception as e:  # noqa: BLE001 – report anything else as unreachable
            last = f"{type(e).__name__}: {e}"
        if method == "HEAD":
            continue
    return "unreachable", last or "no answer"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", default="link-report.md")
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args()

    regs = json.loads((ROOT / "data" / "regulations.json").read_text(encoding="utf-8"))
    links: dict[str, list[str]] = {}
    for r in regs:
        for d in r.get("docs", []):
            links.setdefault(d["u"], []).append(f"{r['t']} — {d['n']}")
    print(f"Checking {len(links)} links…", flush=True)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = dict(zip(links, pool.map(probe, links)))

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
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(report)
    print(lines[2])
    print(f"BROKEN={len(groups['broken'])}")
    return 1 if (args.strict and groups["broken"]) else 0


if __name__ == "__main__":
    sys.exit(main())
