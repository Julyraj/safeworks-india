#!/usr/bin/env python3
"""Build the single-file SafeWorks India app (index.html / safeworks-india.html) from src shell + data files,
and export the datasets as JSON for reuse."""
import json, re, pathlib, subprocess, sys
ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"
DATA_FILES = ["data-regs.js","data-procs.js","data-misc.js","data-regs2.js","data-procs2.js","data-misc2.js","data-safety3.js"]

def build():
    shell = (SRC / "shell.html").read_text(encoding="utf-8")
    data = "\n".join((SRC / "data" / f).read_text(encoding="utf-8") for f in DATA_FILES)
    for k in ["REGS","PROCS","CHECKLISTS","FORMS","REPORTING","TALKS","EMERGENCY","NUMBERS","GLOSSARY"]:
        data = data.replace("window."+k+" =","const "+k+" =").replace("window."+k+"=","const "+k+"=")
    out = shell.replace("//__DATA__", data)
    (ROOT / "index.html").write_text(out, encoding="utf-8")
    (ROOT / "safeworks-india.html").write_text(out, encoding="utf-8")
    print(f"built index.html ({len(out)//1024} KB)")
    return out

def export_json(out):
    """Evaluate the data block with node and dump each dataset to data/*.json."""
    scripts = re.findall(r"<script>(.*?)</script>", out, re.S)
    data_block = "\n".join(scripts).split("(function(){")[0].replace("\nconst ", "\nvar ").replace("const REGS", "var REGS",1)
    js = data_block + """
const fs=require('fs');const dir=process.argv[2];
const dump=(n,v)=>fs.writeFileSync(dir+'/'+n+'.json',JSON.stringify(v,null,1));
Object.entries(REG_EXTRA).forEach(([id,ds])=>{const r=REGS.find(x=>x.id===id);if(r)ds.forEach(d=>{if(!r.d.includes(d))r.d.push(d)})});
dump('regulations',[...REGS,...REGS2]);dump('procedures',[...PROCS,...PROCS2]);dump('checklists',[...CHECKLISTS,...CHECKLISTS2,...CHECKLISTS3]);
dump('forms',[...FORMS,...FORMS2,...FORMS3]);dump('reporting-deadlines',[...REPORTING,...REPORTING2]);dump('toolbox-talks',[...TALKS,...TALKS2,...TALKS3]);
dump('limits',[...NUMBERS,...NUMBERS2]);dump('glossary',[...GLOSSARY,...GLOSSARY2]);dump('keywords',KEYWORDS);dump('emergency-contacts',EMERGENCY);
dump('sectors',SECTORS);dump('unsafe-acts-conditions',UNSAFE);dump('protocols',PROTOCOLS);dump('first-aid',FIRSTAID);
console.log('exported JSON');
"""
    (ROOT / "data").mkdir(exist_ok=True)
    tmp = ROOT / "data" / "_export.js"
    tmp.write_text(js, encoding="utf-8")
    subprocess.run(["node", str(tmp), str(ROOT / "data")], check=True)
    tmp.unlink()

if __name__ == "__main__":
    out = build()
    if "--no-json" not in sys.argv:
        export_json(out)
