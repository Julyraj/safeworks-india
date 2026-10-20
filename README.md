# SafeWorks India

**A single-file safety procedure desk for construction and industry — India (central, Karnataka, Tamil Nadu) mapped against OSHA, ISO/ILO, NFPA and UK/EU practice.**

Open `index.html` in any browser (no server, no build step, no tracking). Everything is in one HTML file so it works offline on a site laptop or phone.

> Regulatory snapshot: **20 October 2026**. Items marked *verify* (state-rule form numbers, some thresholds, DGMS vibration table) must be checked against the current gazetted text before use in a statutory filing. This is a working reference, not legal advice.

## What is inside

| Section | Count | What it gives you |
|---|---|---|
| Regulations & standards | 114 | Acts, rules, codes and standards with scope, key sections, authority, status and official link. Filter by jurisdiction (India central / Karnataka / Tamil Nadu / USA-OSHA / International / UK-EU), domain and status. |
| Safe work procedures | 60 | Permit-to-work, hot work, confined space, LOTO, work at height, scaffolds, excavation, lifting & cranes, tower/EOT cranes, lifting tackles, tools, forklifts, demolition, electrical, substations/HT, batteries/solar/EV, chemicals, process safety (PSM), storage tanks (AST/UST), tank cleaning, toxic gas, combustible dust, foundry, pressure systems, radiography, tunnelling, piling, blasting, painting/blasting, water works, road works, labs, bio hazards, legionella, fire systems, emergency planning, incident reporting, HIRA, PPE, contractors, training, manual handling, heat, noise, respiratory, machinery, cylinders, traffic, concrete, steel, housekeeping/waste, health & welfare, governance, MoC, security, drones, GHG inventory/CCTS, ESG/BRSR. Each has steps, PPE, stop-work triggers, records and India / Karnataka / Tamil Nadu / OSHA / international references. |
| Safety protocols | 54 | 12 Life-Saving Rules (always / never), site safety rule book (7 groups), 17 standing protocols (stop-work authority, PTW, LOTO, toolbox talk, reporting, BBS observation, management walk, visitors, driving, alcohol & drugs, weather triggers, night/lone work, pressure testing, MoC, contractors, incident scene, consequence management) and 25 one-card emergency protocols (fire, evacuation, medical, gas release, spill, electrocution, fall/suspension, confined space, collapse, trench, crane, vehicle, drowning, heat stroke, snake bite, lightning, flood/cyclone, earthquake, bomb threat, unrest, power failure, explosion, radiation, burns, outbreak). |
| Unsafe acts & conditions | 165 | Master list in 9 + 11 groups, root-cause categories and accident-causation models, with an **Observation card** tool (BBS card generator + on-device log, CSV export). |
| First aid | 34 topics | DRSABCD, CPR/AED (adult, child, infant), choking, bleeding/tourniquet, shock, anaphylaxis, heart attack, stroke, burns (thermal/chemical/electrical/bitumen), fractures/spinal, head, eye, amputation, crush, high-pressure injection, suspension trauma, wounds, heat, cold, drowning, snake bite (R.I.G.H.T.), scorpion/stings, animal bites (rabies), inhalation, ingestion/poisoning, asthma, seizure, diabetic, fainting, nosebleed, lightning, needle-stick — plus the first-aid programme (statutory basis, people, equipment, box contents, records). Aligned with ILCOR/AHA/ERC 2020–2025 and the Indian national snakebite protocol. |
| Checklists | 50 | Interactive, progress saved on device, copyable summary: daily site, scaffold, excavation, lifting, confined space, hot work, LOTO, WAH, electrical, fire, chemical, PPE, welfare, statutory (factory & construction site), environment, emergency, heat, training, contractor, incident, night work, foundry, PSM, tanks, tank cleaning, tackles, tools, tower crane, forklift, HT permit, battery/solar, dust, toxic gas, tunnel, piling, blasting, painting, water, road works, lab, camp health, security, GHG, ESG, fire systems, legionella, first aid, observation walk. |
| Sector guides | 12 | Building sites, infrastructure/metro, factories, foundries, chemical/MAH plants, terminals, power/solar/ESS, warehouses, heavy industry (CCTS/CBAM), mining, water treatment, corporate ESG office — each bundling hazards, statutory essentials and the relevant regs/procedures/checklists. |
| Tools | — | **Permit builder** (gas readings validated against limits), **Incident navigator** (state + event → who to notify, deadline, form, drafted notice), **Carbon & ESG desk** (Scope 1/2 calculator, CCTS/CBAM/BRSR checklists), **Reporting deadlines** (28 clocks), **Toolbox talks** (39), **Emergency contacts**, **Limits & thresholds** (48 cards), **Keywords & glossary** (357 terms). |

## Repository layout

```
index.html                 built app (open this) — identical to safeworks-india.html
src/shell.html             UI, styles and logic (data injected at //__DATA__)
src/data/*.js              datasets (regulations, procedures, checklists, protocols, first aid, keywords…)
data/*.json                machine-readable export of every dataset (regenerated by build.py)
build.py                   python3 build.py  → rebuilds index.html and data/*.json (needs node for the JSON export)
```

## Editing

1. Edit the dataset in `src/data/` (plain JavaScript arrays/objects) or the UI in `src/shell.html`.
2. Run `python3 build.py` (or `python3 build.py --no-json` without node).
3. Open `index.html`.

Each dataset entry carries its own references so a reviewer can trace a figure to the act, rule or standard it came from.

## Jurisdiction notes (as of the snapshot date)

- **OSH Code 2020** has been in force since 21 Nov 2025 and repealed the Factories Act 1948, BOCW Act 1996, Contract Labour Act 1970, Mines Act 1952 and nine other central Acts. **OSH (Central) Rules 2026** (8 May 2026) apply where the Centre is the appropriate Government.
- **Karnataka**: draft OSH (Karnataka) Rules 2026 published 23 Jan 2026; Karnataka Factories Rules 1969, Safety Audit Rules 2024 and BOCW Rules 2006 remain the working technical standard in transition.
- **Tamil Nadu**: OSH rules partly notified; TN Factories Rules 1950 (amended 2025) and TN BOCW Rules 2006 remain the working technical standard.
- **OSHA**: no final federal heat standard; Heat NEP revised 10 Apr 2026.
- **Carbon**: CCTS GEI targets notified for 7 sectors (Oct 2025 / Jan 2026), iron & steel draft (Jun 2026); EU CBAM definitive period from 1 Jan 2026; BRSR Core assurance covers all top-1,000 listed entities from FY2026-27.

## Disclaimer

Safety and legal content is provided for reference and training support. It does not replace statutory texts, certified training (first aid, confined space, rigging, electrical), professional engineering judgement or the advice of the competent authority. First-aid content follows international resuscitation guidance but is not a substitute for a certified first-aid course.

## License

MIT — see `LICENSE`.
