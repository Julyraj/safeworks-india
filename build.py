#!/usr/bin/env python3
"""Build SafeWorks India.

Outputs
  index.html            standalone app page (PWA: manifest, service worker, icons) — served by GitHub Pages
  safeworks-india.html  same app without the document skeleton (for embedding / Claude artifact)
  sw.js                 service worker stamped with a cache version
  app/www/              web assets for the Android (Capacitor) app
  data/*.json           machine-readable export of every dataset (needs node; skip with --no-json)
"""
import hashlib, re, pathlib, shutil, subprocess, sys
ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"
DATA_FILES = ["data-regs.js","data-procs.js","data-misc.js","data-regs2.js","data-procs2.js","data-misc2.js","data-safety3.js","data-matrix.js","data-docs.js","data-industries.js"]
TOKENS = ROOT / "design" / "tokens.css"   # one palette shared with the portal; inlined at /*__TOKENS__*/

HEAD = """<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f1c2b">
<meta name="color-scheme" content="light dark">
<meta name="description" content="SafeWorks India – offline safety library for Indian workplaces: pick your industry, pick the task, get the rules, procedure, checklist, permit and toolbox talk. OSH Code, Karnataka and Tamil Nadu rules, BIS, OSHA, ISO.">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="SafeWorks">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<style>body{margin:0;font:15px system-ui,sans-serif;background:#eef1f3}img{max-width:100%}[hidden]{display:none!important}</style>
"""

def build():
    shell = (SRC / "shell.html").read_text(encoding="utf-8")
    data = "\n".join((SRC / "data" / f).read_text(encoding="utf-8") for f in DATA_FILES)
    for k in ["REGS","PROCS","CHECKLISTS","FORMS","REPORTING","TALKS","EMERGENCY","NUMBERS","GLOSSARY","DOCS","DOCS_CHECKED"]:
        data = data.replace("window."+k+" =","const "+k+" =").replace("window."+k+"=","const "+k+"=")
    tokens = TOKENS.read_text(encoding="utf-8") if TOKENS.exists() else ""
    fragment = shell.replace("/*__TOKENS__*/", tokens).replace("//__DATA__", data)
    (ROOT / "safeworks-india.html").write_text(fragment, encoding="utf-8")
    # standalone document: head metas + fragment (title/style/meta land in head, the rest in body)
    title_end = fragment.index("</style>") + len("</style>")
    doc = HEAD + fragment[:title_end] + "\n</head>\n<body>\n" + fragment[title_end:] + "\n</body>\n</html>\n"
    (ROOT / "index.html").write_text(doc, encoding="utf-8")
    ver = hashlib.sha1(doc.encode()).hexdigest()[:10]
    (ROOT / "sw.js").write_text((SRC / "sw.template.js").read_text(encoding="utf-8").replace("__CACHE_VERSION__", ver), encoding="utf-8")
    # Android web assets
    www = ROOT / "app" / "www"
    if www.exists(): shutil.rmtree(www)
    (www / "icons").mkdir(parents=True)
    shutil.copy(ROOT / "index.html", www / "index.html")
    shutil.copy(ROOT / "manifest.webmanifest", www / "manifest.webmanifest")
    for f in (ROOT / "icons").glob("*.png"):
        shutil.copy(f, www / "icons" / f.name)
    # our own copies of shareable documents (see files/README.md)
    if (ROOT / "files").is_dir():
        shutil.copytree(ROOT / "files", www / "files", ignore=shutil.ignore_patterns("README.md"))
    print(f"built index.html ({len(doc)//1024} KB), sw.js (cache {ver}), app/www")
    return fragment

def export_json(out):
    scripts = re.findall(r"<script>(.*?)</script>", out, re.S)
    data_block = "\n".join(scripts).split("(function(){")[0].replace("\nconst ", "\nvar ").replace("const REGS", "var REGS", 1)
    js = data_block + """
const fs=require('fs');const dir=process.argv[2];
const dump=(n,v)=>fs.writeFileSync(dir+'/'+n+'.json',JSON.stringify(v,null,1));
Object.entries(REG_EXTRA).forEach(([id,ds])=>{const r=REGS.find(x=>x.id===id);if(r)ds.forEach(d=>{if(!r.d.includes(d))r.d.push(d)})});
dump('regulations',[...REGS,...REGS2,...REGS4].map(r=>({...r,docs:DOCS[r.id]||[]})));dump('documents',{checked:DOCS_CHECKED,docs:DOCS});dump('procedures',[...PROCS,...PROCS2,...PROCS3]);dump('checklists',[...CHECKLISTS,...CHECKLISTS2,...CHECKLISTS3,...CHECKLISTS4]);
dump('forms',[...FORMS,...FORMS2,...FORMS3,...FORMS4]);dump('reporting-deadlines',[...REPORTING,...REPORTING2]);dump('toolbox-talks',[...TALKS,...TALKS2,...TALKS3,...TALKS4]);
dump('limits',[...NUMBERS,...NUMBERS2,...NUMBERS4]);dump('glossary',[...GLOSSARY,...GLOSSARY2]);dump('keywords',[...KEYWORDS,...KEYWORDS4]);dump('emergency-contacts',[...EMERGENCY,...EMERGENCY4]);
dump('sectors',SECTORS);dump('industries',INDUSTRIES);dump('state-matrix',MATRIX);dump('unsafe-acts-conditions',UNSAFE);dump('protocols',PROTOCOLS);dump('first-aid',FIRSTAID);
console.log('exported JSON');
"""
    (ROOT / "data").mkdir(exist_ok=True)
    tmp = ROOT / "data" / "_export.js"
    tmp.write_text(js, encoding="utf-8")
    try:
        subprocess.run(["node", str(tmp), str(ROOT / "data")], check=True)
    finally:
        tmp.unlink(missing_ok=True)

if __name__ == "__main__":
    out = build()
    if "--no-json" not in sys.argv:
        export_json(out)
