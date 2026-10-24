"""Master lists built from the SafeWorks India library data in /data."""
from __future__ import annotations

import json
from pathlib import Path

from safeworks.config import config


def _read(name: str):
    return json.loads((Path(config.data_dir) / name).read_text(encoding="utf-8"))


def build_master_rows() -> list[dict]:
    rows: list[dict] = []
    ua = _read("unsafe-acts-conditions.json")
    for i, g in enumerate(ua["acts"]):
        cat = f"A{i + 1:02d}"
        rows.append({"list": "category", "code": cat, "label": g["cat"], "parent": "unsafe_act", "sort": i + 1})
        rows += [{"list": "item", "code": f"{cat}-{j + 1:02d}", "label": it, "parent": cat, "sort": j + 1} for j, it in enumerate(g["items"])]
    for i, g in enumerate(ua["conditions"]):
        cat = f"C{i + 1:02d}"
        rows.append({"list": "category", "code": cat, "label": g["cat"], "parent": "unsafe_condition", "sort": 100 + i + 1})
        rows += [{"list": "item", "code": f"{cat}-{j + 1:02d}", "label": it, "parent": cat, "sort": j + 1} for j, it in enumerate(g["items"])]

    hazards = [
        "Fall from height", "Falling objects", "Line of fire / struck by", "Vehicles & mobile plant", "Lifting operations", "Excavation & ground collapse",
        "Electrical", "Fire & explosion", "Chemical / toxic gas", "Confined space", "Machinery & tools", "Pressure / stored energy", "Hot metal / burns",
        "Slips, trips & housekeeping", "Manual handling", "Health – noise, dust, heat", "Biological / welfare", "Environment", "Security / public", "Radiation",
    ]
    rows += [{"list": "hazard", "code": f"H{i + 1:02d}", "label": h, "sort": i + 1} for i, h in enumerate(hazards)]
    rows += [{"list": "activity", "code": f"P-{p['id']}", "label": p["t"], "sort": i + 1} for i, p in enumerate(_read("procedures.json"))]
    causes = ["Lack of knowledge or skill", "Shortcut / production pressure", "Fatigue / capability", "Equipment or environment", "Procedure or supervision", "Management system"]
    rows += [{"list": "root_cause", "code": f"RC{i + 1:02d}", "label": c, "sort": i + 1} for i, c in enumerate(causes)]
    rows += [{"list": "lsr", "code": f"LSR{i + 1:02d}", "label": r["t"], "sort": i + 1} for i, r in enumerate(_read("protocols.json")["lsr"])]
    actions = ["Corrected on the spot", "Work stopped", "Barricaded / tagged out", "Person coached", "Reported to supervisor", "Recognised (safe behaviour)"]
    rows += [{"list": "immediate_action", "code": f"IA{i + 1:02d}", "label": a, "sort": i + 1} for i, a in enumerate(actions)]
    rows += [{"list": "control_level", "code": f"CL{i + 1}", "label": c, "sort": i + 1} for i, c in enumerate(["Eliminate", "Substitute", "Engineering", "Administrative", "PPE"])]
    rounds = ["Daily site walk", "Weekly inspection", "Management walk", "Contractor audit", "Night inspection", "Pre-monsoon / pre-summer check", "Special (after incident)"]
    rows += [{"list": "round_type", "code": f"RT{i + 1:02d}", "label": r, "sort": i + 1} for i, r in enumerate(rounds)]
    rows += [{"list": "shift", "code": f"SH{i + 1}", "label": s, "sort": i + 1} for i, s in enumerate(["Day", "Night", "General"])]
    permits = ["Hot work", "Cold work", "Work at height", "Confined space entry", "Electrical isolation (LV/HV)", "Excavation", "Critical lift",
               "Radiography", "Line breaking / process isolation", "Vehicle entry to hazardous area", "Roof work", "Demolition"]
    rows += [{"list": "permit_type", "code": f"PT{i + 1:02d}", "label": p, "sort": i + 1} for i, p in enumerate(permits)]
    return rows
