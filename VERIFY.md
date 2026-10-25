# VERIFY — legal and numeric values that need a qualified check before go-live

Every value below is configuration or seed data in the app (never hard-coded) and carries its status label on screen: **Verified (primary)**, **Verified (secondary)**, **Draft rule**, **Unverified**, **Provisional**, **design default**, **company standard**, **reference to confirm**. A qualified reviewer (factories inspectorate officer, labour-law counsel) should confirm each before a site relies on it. This file lists the ones that matter most; `CONTENT-REVIEW.md` lists the library-text items.

## Portal — rule sets and clocks (`portal/server/seed/`, admin → Rule sets)

| Item | Current value | Status | Where used |
|---|---|---|---|
| TN Factories Rules 1950 r.96 accident notice | phone at once; Form 18 within 12 h; 48-h incapacity → within 24 h after the 48 h; return before day 21 → report within 7 days; Form 18-B within 28 days | Verified (secondary) | `TN_FACTORY_LEGACY` timer rules (Phase 2) |
| Karnataka Factories Rules 1969 accident notice | Form 17 to the Inspector; **time limit not found** (deadline null → cannot be enabled); Form 23 monthly register copy before the 5th | Form Verified (secondary); clock Unverified | `KA_FACTORY_LEGACY` |
| BOCW (TN) accident notice | death 4 h; 48 h+ incapacity 72 h; death or disablement > 10 days adds police and DM/SDM; scene undisturbed | Verified (secondary) | `BOCW_TN_LEGACY` |
| BOCW Karnataka | TN structure copied as **provisional**, all clocks provisional; Form IV 30 days before work | Unverified / notice Verified (secondary) | `BOCW_KA_PROVISIONAL` |
| OSH (Central) Rules 2026 r.7 | death forthwith (Form XI); 48 h+ incapacity → 12 h after; cumulative 48 h → 24 h after; dangerous occurrence (27 types) 12 h | Verified (secondary) | `OSH_CENTRAL` (only where the Centre is the appropriate government) |
| KA draft OSH Rules 2026; TN draft OSH Rules 2022 | shipped **disabled**; cannot be assigned until `reviewed_by` is set | Draft rule | `KA_OSH_DRAFT_2026`, `TN_OSH_DRAFT_2022` |
| Electrical accident (Intimation of Accidents Rules 2005) | phone at once; fatal report 24 h; Form A 48 h | Verified (primary) | all sites |
| Boilers Act 2025 s.23; MSIHC r.5; Gas Cylinders Rules r.67; PESO | 24 h; 48 h Schedule 6; letter 12 h; letter 24 h | Verified (primary) / Gas Cylinders on the legal-review list | all sites |
| DPDP Rules r.7 breach | people and the Board without delay; detailed report within 72 h | Verified (primary) | privacy runbook |
| Fatal inquiry FA s.88(2) / BOCW s.39 | within 1 month | Verified (primary) | Phase 2 |

## Portal — operating defaults (admin → Risk matrix, Due dates & reminders, Settings)

| Item | Current value | Status |
|---|---|---|
| 5×5 risk matrix bands | 1–3 low, 4–6 moderate, 8–12 high, 15–25 extreme; severity anchors 1 first aid … 5 fatality | design default (NPSA-style, OSHA 1904.7 anchors) |
| Due dates by band | extreme 72 h, high 7 d, moderate 30 d, low 90 d; interim control required for extreme and high | design default |
| Verification windows | extreme 24 h, high 3 working days, moderate 5, low 10 | design default |
| Reminder ladder | T-7, T-3, T-0 → T+1 (officer, site head) → T+3 (HSE manager); extreme T-24 h, T-4 h, T-0 → T+2 h → T+24 h | TeamLease RegTrack pattern; design default |
| Triage SLA | officer reminder after 1 working day, site head after 2; critical acknowledgement 30 min | design default |
| Daily push cap / quiet hours | 5 reminder pushes per person per day; 21:00–07:00 IST for non-critical | design default |
| Duplicate suggestion | same site + area, category overlap, within 24 h, ±30 m GPS adds weight | design default |
| Photos | 1,600 px long edge, ~300–500 KB JPEG, EXIF removed, SHA-256 at capture; 3 on the quick form, 10 per record; voice 60 s | design default |
| Retention | 5 years after closure (observations, actions, inspections); lifting registers 5 years after the last entry (Verified primary); earth tests 2 years (Verified primary); logs ≥ 1 year (DPDP r.8(3), Verified primary) | design default except where marked |
| MFA roles | admin, hse_manager, site_head (officers optional) | brief research + design default |
| Percent-safe minimum sample | 30 behaviours | design default |

## Portal — inspection template references (admin → Templates; status shown per question)

T1–T9 follow brief §16.3 with each item's reference status (P/S/V/C). Items to confirm first: FA ss.11, 13, 17, 21, 32 as applied through the TN/KA Factories Rules (**C**); BOCW r.189 scaffold tag title (**C**); the BOCW excavation notice lead time (**C**); first-aid box contents per state (**C**); IS 2190:2024 intervals (2010 defaults used, **Unverified**); IS 3521 Part 1:2021 content (**V**, content Unverified); scaffold 14-day interval and ladder intervals (**company standard**, BOCW interval not found).

## Library (SafeWorks India) — see `CONTENT-REVIEW.md`

About 30 places where the library text may be out of date (NBC 2016 → SP 7:2026, IBR 2026, IS 15298 Part 2:2024, TN Fire and Rescue Services Act 2025, KA fire NOC threshold, …). Every new industry procedure or checklist item written in version 4.0 with an uncertain number or clause carries "(verify)" in its text.

## How to clear an item

1. Confirm the value against the official text (India Code, eGazette, the state rules PDF, BIS/CEA/PESO sites).
2. Change the seed or the admin setting; set the status label to *Verified (primary)* and record the reviewer's name in `rule_sets.reviewed_by` or the admin audit reason.
3. Remove the row here in the same commit.
