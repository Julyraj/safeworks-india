import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// SafeWorks India library data, exported by the root build.py into /data
const DATA = path.resolve(here, "..", "..", "..", "data");

export interface MasterRow {
  list: string;
  code: string;
  label: string;
  parent?: string | null;
  sort: number;
}

function readJson(name: string): any {
  return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8"));
}

const pad = (n: number) => String(n).padStart(2, "0");

export function buildMasterRows(): MasterRow[] {
  const rows: MasterRow[] = [];
  const ua = readJson("unsafe-acts-conditions.json");
  ua.acts.forEach((g: any, i: number) => {
    const cat = `A${pad(i + 1)}`;
    rows.push({ list: "category", code: cat, label: g.cat, parent: "unsafe_act", sort: i + 1 });
    g.items.forEach((it: string, j: number) => rows.push({ list: "item", code: `${cat}-${pad(j + 1)}`, label: it, parent: cat, sort: j + 1 }));
  });
  ua.conditions.forEach((g: any, i: number) => {
    const cat = `C${pad(i + 1)}`;
    rows.push({ list: "category", code: cat, label: g.cat, parent: "unsafe_condition", sort: 100 + i + 1 });
    g.items.forEach((it: string, j: number) => rows.push({ list: "item", code: `${cat}-${pad(j + 1)}`, label: it, parent: cat, sort: j + 1 }));
  });

  const hazards = [
    "Fall from height", "Falling objects", "Line of fire / struck by", "Vehicles & mobile plant", "Lifting operations", "Excavation & ground collapse",
    "Electrical", "Fire & explosion", "Chemical / toxic gas", "Confined space", "Machinery & tools", "Pressure / stored energy", "Hot metal / burns",
    "Slips, trips & housekeeping", "Manual handling", "Health – noise, dust, heat", "Biological / welfare", "Environment", "Security / public", "Radiation",
  ];
  hazards.forEach((h, i) => rows.push({ list: "hazard", code: `H${pad(i + 1)}`, label: h, sort: i + 1 }));

  const procs = readJson("procedures.json") as { id: string; t: string }[];
  procs.forEach((p, i) => rows.push({ list: "activity", code: `P-${p.id}`, label: p.t, sort: i + 1 }));

  const causes = ["Lack of knowledge or skill", "Shortcut / production pressure", "Fatigue / capability", "Equipment or environment", "Procedure or supervision", "Management system"];
  causes.forEach((c, i) => rows.push({ list: "root_cause", code: `RC${pad(i + 1)}`, label: c, sort: i + 1 }));

  const lsr = readJson("protocols.json").lsr as { t: string }[];
  lsr.forEach((r, i) => rows.push({ list: "lsr", code: `LSR${pad(i + 1)}`, label: r.t, sort: i + 1 }));

  const actions = ["Corrected on the spot", "Work stopped", "Barricaded / tagged out", "Person coached", "Reported to supervisor", "Recognised (safe behaviour)"];
  actions.forEach((a, i) => rows.push({ list: "immediate_action", code: `IA${pad(i + 1)}`, label: a, sort: i + 1 }));

  ["Eliminate", "Substitute", "Engineering", "Administrative", "PPE"].forEach((c, i) => rows.push({ list: "control_level", code: `CL${i + 1}`, label: c, sort: i + 1 }));

  const roundTypes = ["Daily site walk", "Weekly inspection", "Management walk", "Contractor audit", "Night inspection", "Pre-monsoon / pre-summer check", "Special (after incident)"];
  roundTypes.forEach((r, i) => rows.push({ list: "round_type", code: `RT${pad(i + 1)}`, label: r, sort: i + 1 }));

  ["Day", "Night", "General"].forEach((s, i) => rows.push({ list: "shift", code: `SH${i + 1}`, label: s, sort: i + 1 }));

  const permits = [
    "Hot work", "Cold work", "Work at height", "Confined space entry", "Electrical isolation (LV/HV)", "Excavation", "Critical lift",
    "Radiography", "Line breaking / process isolation", "Vehicle entry to hazardous area", "Roof work", "Demolition",
  ];
  permits.forEach((p, i) => rows.push({ list: "permit_type", code: `PT${pad(i + 1)}`, label: p, sort: i + 1 }));
  return rows;
}
