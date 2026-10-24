# SafeWorks India

**A single-file safety procedure desk for construction and industry — India (central, Karnataka, Tamil Nadu) mapped against OSHA, ISO/ILO, NFPA and UK/EU practice.**

Open `index.html` in any browser (no server, no build step, no tracking). Everything is in one HTML file so it works offline on a site laptop or phone.

> Regulatory snapshot: **20 October 2026**. Items marked *verify* (state-rule form numbers, some thresholds, DGMS vibration table) must be checked against the current gazetted text before use in a statutory filing. This is a working reference, not legal advice.

## Get the app

| Platform | How |
|---|---|
| **Android (APK)** | Download **[SafeWorks-India.apk](https://github.com/Julyraj/safeworks-india/releases/latest/download/SafeWorks-India.apk)** from the latest release, open it, allow *Install unknown apps* when asked. New versions install as updates. |
| **Android / iPhone / desktop (installable web app)** | Open **https://julyraj.github.io/safeworks-india/** → Chrome: menu ⋮ → *Install app* · Safari (iPhone): Share → *Add to Home Screen* · Edge/Chrome desktop: install icon in the address bar. |
| **Offline file** | Download `index.html` and open it in any browser. |

Once installed it works **without internet**. Your observations, photos, checklists, site contacts and carbon figures stay **on your device** (back them up from *App & my data*).

### App features
- **SOS screen** – one-tap calling of 112, 108, 101, 100, 1077, poison centre, coast guard and your own site contacts (site main controller, safety officer, first-aider, hospital, ambulance tie-up); emergency cards for fire, medical/CPR, gas release, electrocution, fall, confined space, collapse, snake bite, heat stroke, burns, spills, evacuation. Red SOS button always one tap away.
- **Observation card with camera** – record unsafe acts/conditions or safe behaviour with a photo, risk rating, action owner and status; share to WhatsApp; on-device log with CSV export.
- **Share** permits, incident notices, observation cards and emergency sheets through the phone's share menu.
- Bottom tab bar (Home · Observe · SOS · Permit · Menu), offline cache, install prompt, Android back-button support, backup/restore of your data.

## SafeWorks Portal (multi-site observation system)

The [`portal/`](portal/) folder holds the company-wide version, a server-backed system for many sites:
- Safety officers raise observation points with photos (at least 1, at most 2).
- Supervisors close the points with their own logins.
- Safety officers approve the closures.
- Admins run sites, users and passwords from a separate admin console.

It has a website, an Android app (`SafeWorks-Portal.apk`, releases tagged `portal-v…`) and an admin console. The server is written in Python (FastAPI) with a PostgreSQL database, and is load-tested for 100 people per site working at the same time. See [portal/README.md](portal/README.md) to run it.

## What is inside

| Section | Count | What it gives you |
|---|---|---|
| TN vs Karnataka matrix | 9 domains | Side-by-side enforcement table (DISH/FBISH, Factories Rules, OSH rules, BOCW, CIMAH/MAH, boilers, SPCBs, fire/electrical) and nine domains with central law, Tamil Nadu rule, Karnataka rule and BIS standards — rule numbers, forms (TN Forms 8/9/8-A; KA Forms 6/7/8), portals (e-Surakshate, OCMMS, XGN, e-LORA), PESO circles, TSDFs. |
| Regulations & standards | 123 | Acts, rules, codes and standards with scope, key sections, authority, status and official link. Filter by jurisdiction (India central / Karnataka / Tamil Nadu / USA-OSHA / International / UK-EU), domain and status. |
| Document downloads | 396 | The official full text behind every regulation: 149 direct PDFs and official pages from India Code, ministries, state departments, BIS, eCFR, legislation.gov.uk, EUR-Lex and the standards publishers. Each is marked Free, Free · login or Paid, with an Internet Archive fallback. Links are checked every week. |
| Safe work procedures | 60 | Permit-to-work, hot work, confined space, LOTO, work at height, scaffolds, excavation, lifting & cranes, tower/EOT cranes, lifting tackles, tools, forklifts, demolition, electrical, substations/HT, batteries/solar/EV, chemicals, process safety (PSM), storage tanks (AST/UST), tank cleaning, toxic gas, combustible dust, foundry, pressure systems, radiography, tunnelling, piling, blasting, painting/blasting, water works, road works, labs, bio hazards, legionella, fire systems, emergency planning, incident reporting, HIRA, PPE, contractors, training, manual handling, heat, noise, respiratory, machinery, cylinders, traffic, concrete, steel, housekeeping/waste, health & welfare, governance, MoC, security, drones, GHG inventory/CCTS, ESG/BRSR. Each has steps, PPE, stop-work triggers, records and India / Karnataka / Tamil Nadu / OSHA / international references. |
| Safety protocols | 54 | 12 Life-Saving Rules (always / never), site safety rule book (7 groups), 17 standing protocols (stop-work authority, PTW, LOTO, toolbox talk, reporting, BBS observation, management walk, visitors, driving, alcohol & drugs, weather triggers, night/lone work, pressure testing, MoC, contractors, incident scene, consequence management) and 25 one-card emergency protocols (fire, evacuation, medical, gas release, spill, electrocution, fall/suspension, confined space, collapse, trench, crane, vehicle, drowning, heat stroke, snake bite, lightning, flood/cyclone, earthquake, bomb threat, unrest, power failure, explosion, radiation, burns, outbreak). |
| Unsafe acts & conditions | 165 | Master list in 9 + 11 groups, root-cause categories and accident-causation models, with an **Observation card** tool (BBS card generator + on-device log, CSV export). |
| First aid | 34 topics | DRSABCD, CPR/AED (adult, child, infant), choking, bleeding/tourniquet, shock, anaphylaxis, heart attack, stroke, burns (thermal/chemical/electrical/bitumen), fractures/spinal, head, eye, amputation, crush, high-pressure injection, suspension trauma, wounds, heat, cold, drowning, snake bite (R.I.G.H.T.), scorpion/stings, animal bites (rabies), inhalation, ingestion/poisoning, asthma, seizure, diabetic, fainting, nosebleed, lightning, needle-stick — plus the first-aid programme (statutory basis, people, equipment, box contents, records). Aligned with ILCOR/AHA/ERC 2020–2025 and the Indian national snakebite protocol. |
| Checklists | 50 | Interactive, progress saved on device, copyable summary: daily site, scaffold, excavation, lifting, confined space, hot work, LOTO, WAH, electrical, fire, chemical, PPE, welfare, statutory (factory & construction site), environment, emergency, heat, training, contractor, incident, night work, foundry, PSM, tanks, tank cleaning, tackles, tools, tower crane, forklift, HT permit, battery/solar, dust, toxic gas, tunnel, piling, blasting, painting, water, road works, lab, camp health, security, GHG, ESG, fire systems, legionella, first aid, observation walk. |
| Sector guides | 12 | Building sites, infrastructure/metro, factories, foundries, chemical/MAH plants, terminals, power/solar/ESS, warehouses, heavy industry (CCTS/CBAM), mining, water treatment, corporate ESG office — each bundling hazards, statutory essentials and the relevant regs/procedures/checklists. |
| Tools | — | **Permit builder** (IS 17893:2023 permit types; gas readings validated against limits) (gas readings validated against limits), **Incident navigator** (state + event → who to notify, deadline, form, drafted notice), **Carbon & ESG desk** (Scope 1/2 calculator, CCTS/CBAM/BRSR checklists), **Reporting deadlines** (28 clocks), **Toolbox talks** (39), **Emergency contacts**, **Limits & thresholds** (55 cards), **Keywords & glossary** (369 terms). |

## Repository layout

```
index.html                 built app – standalone installable web app (PWA)
safeworks-india.html       same app without document skeleton (embedding)
manifest.webmanifest, sw.js, icons/   PWA manifest, offline service worker, icons
app/                       Android app (Capacitor 8): package.json, capacitor.config.json, android/ project
.github/workflows/android.yml   builds the APK on every push and publishes it as a GitHub Release
src/shell.html             UI, styles and logic (data injected at //__DATA__)
src/data/*.js              datasets (regulations, procedures, checklists, protocols, first aid, keywords…)
data/*.json                machine-readable export of every dataset (regenerated by build.py)
build.py                   python3 build.py  → rebuilds index.html and data/*.json (needs node for the JSON export)
```

## Editing

1. Edit the dataset in `src/data/` (plain JavaScript arrays/objects) or the UI in `src/shell.html`.
2. Run `python3 build.py` (or `python3 build.py --no-json` without node) — rebuilds `index.html`, `sw.js`, `app/www/` and `data/*.json`.
3. Open `index.html`, or serve the folder (`python3 -m http.server`) to test install/offline.
4. Push to `main`: GitHub Actions builds `SafeWorks-India.apk` and publishes it under Releases.
   Local Android build: `cd app && npm ci && npx cap sync android && cd android && ./gradlew assembleDebug` (JDK 21 + Android SDK).

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
