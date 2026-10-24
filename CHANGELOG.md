# Changelog

## 3.2 — 2026-10-24 — the app release
- Installable app: PWA manifest, offline service worker, app icons, install button; standalone `index.html` with proper document head.
- Android app (Capacitor 8.5.2) with launcher icons, splash, camera permission, native share and back button; GitHub Actions builds the APK and publishes it to Releases on every push.
- New SOS screen (one-tap emergency numbers, site emergency contacts, emergency cards) with a persistent SOS button and mobile bottom tab bar (Home · Observe · SOS · Permit · Menu).
- Observation card: camera photo capture (compressed, stored on device), photo thumbnails in the log, share card with photo.
- Share buttons for permits, incident notices and emergency sheets; App & my data screen with backup, restore and erase.

## 3.1 — 2026-10-20
- TN vs Karnataka regulatory & enforcement matrix view (table + 9 domains: PTW/LOTO, confined space, work at height, machinery/lifting/pressure, chemical/hazardous/explosives, construction, environment/waste/hygiene, electrical/fire/radiation, PPE BIS set).
- New regulation entries: IS 17893:2023, TN CIMAH Rules 1994, MAH Control (Karnataka) Rules 1994, BOCW (Karnataka Amendment) Rules 2024, Karnataka Boiler Rules 1982, TN Boiler Rules, BIS hygiene/electrical/construction/PPE sets.
- State rule/section/form citations injected into 35 procedures; Karnataka dangerous-operations rule corrected to Rule 129; KSPCB/TNPCB entries extended (portals, ZLD, river G.O.s, lake buffers, OCEMS, STP dual piping, TSDFs).
- Forms & registers: TN Forms 8/9/8-A, KA Forms 6/7/8, HW Forms 1/3/4/8/9/10, CTE/CTO portals, IS 17893 permit formats; new limits, keywords and portal contacts.

## 3.0 — 2026-10-20
- Safety protocols view: 12 Life-Saving Rules, site rule book, 17 standing protocols, 25 emergency protocols.
- Unsafe acts & conditions master list (165 items), causes and causation models; Observation card tool with on-device log and CSV export.
- First aid: 34 topics + programme (statutory basis, people, equipment, box contents, records); first-aid readiness checklist.
- Keywords & glossary merged: 357 terms across 17 categories.
- Extra toolbox talks (unsafe acts, unsafe conditions, Life-Saving Rules, first aid) and forms.
- Repository structure: `src/`, `build.py`, JSON export in `data/`.

## 2.0 — 2026-10-20
- 33 new regulation entries (energy/carbon/ESG: EC Act, CCTS, BRSR, CBAM, GHG standards, EPR, ECSBC, ODS; process safety & tanks; lifting gear, cranes, tools, forklifts/racking, machinery; foundry & dangerous-operations schedules; HT, batteries/solar; fire systems; tunnelling, piling, blasting, water, labs, bio, security, drones, road works).
- 26 new procedures (foundry, PSM, tanks, tank cleaning, tackles, tools, tower/EOT cranes, forklifts, substations, batteries/solar/EV, dust, toxic gas, tunnelling, piling, blasting, painting, water, road works, lab, bio, security, drones, GHG, ESG, fire systems, legionella) with matching checklists.
- Sector guides (12) and Carbon & ESG desk (Scope 1/2 calculator, CCTS/CBAM/BRSR checklists).

## 1.0 — 2026-10-20
- Initial release: 81 regulations, 34 procedures, 23 checklists, forms, reporting deadlines, toolbox talks, emergency contacts, limits, glossary, permit builder, incident navigator.
