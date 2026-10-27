"""Seed content (brief §8, §16): matrix, due-date rules, ladders, rule sets, categories, templates, industries, sites.

Every regulated value carries its status label; translations are drafts to be reviewed by site staff before Gate B.
"""
from __future__ import annotations

# ---------------------------------------------------------------- risk matrix 5×5 (brief §8.1, NPSA 2008 style; Unverified)

MATRIX_NAME = "Default 5×5"
LIKELIHOOD = [
    (1, {"en": "Rare", "hi": "दुर्लभ", "ta": "அரிது", "kn": "ಅಪರೂಪ"}),
    (2, {"en": "Unlikely", "hi": "असंभावित", "ta": "சாத்தியம் குறைவு", "kn": "ಅಸಂಭವ"}),
    (3, {"en": "Possible", "hi": "संभव", "ta": "சாத்தியம்", "kn": "ಸಾಧ್ಯ"}),
    (4, {"en": "Likely", "hi": "संभावित", "ta": "நிகழக்கூடும்", "kn": "ಸಂಭವನೀಯ"}),
    (5, {"en": "Almost certain", "hi": "लगभग निश्चित", "ta": "கிட்டத்தட்ட நிச்சயம்", "kn": "ಬಹುತೇಕ ಖಚಿತ"}),
]
SEVERITY = [
    (1, {"en": "First aid", "hi": "प्राथमिक चिकित्सा", "ta": "முதலுதவி", "kn": "ಪ್ರಥಮ ಚಿಕಿತ್ಸೆ"}, {"en": "First-aid case only (OSHA 1904.7 ladder)", "hi": "केवल प्राथमिक चिकित्सा", "ta": "முதலுதவி மட்டும்", "kn": "ಪ್ರಥಮ ಚಿಕಿತ್ಸೆ ಮಾತ್ರ"}),
    (2, {"en": "Medical treatment", "hi": "चिकित्सा उपचार", "ta": "மருத்துவ சிகிச்சை", "kn": "ವೈದ್ಯಕೀಯ ಚಿಕಿತ್ಸೆ"}, {"en": "Medical treatment beyond first aid", "hi": "प्राथमिक चिकित्सा से आगे उपचार", "ta": "முதலுதவிக்கு மேல் சிகிச்சை", "kn": "ಪ್ರಥಮ ಚಿಕಿತ್ಸೆ ಮೀರಿದ ಚಿಕಿತ್ಸೆ"}),
    (3, {"en": "Restricted work or lost time", "hi": "सीमित कार्य या समय हानि", "ta": "கட்டுப்படுத்தப்பட்ட வேலை அல்லது நேர இழப்பு", "kn": "ನಿರ್ಬಂಧಿತ ಕೆಲಸ ಅಥವಾ ಸಮಯ ನಷ್ಟ"}, {"en": "Days away or restricted work", "hi": "काम से दूर या सीमित कार्य", "ta": "வேலையிலிருந்து விலகல்", "kn": "ಕೆಲಸದಿಂದ ದೂರ ಅಥವಾ ನಿರ್ಬಂಧಿತ ಕೆಲಸ"}),
    (4, {"en": "Permanent partial disablement", "hi": "स्थायी आंशिक अपंगता", "ta": "நிரந்தர பகுதி ஊனம்", "kn": "ಶಾಶ್ವತ ಭಾಗಶಃ ಅಂಗವೈಕಲ್ಯ"}, {"en": "IS 3786 permanent partial disablement", "hi": "IS 3786 स्थायी आंशिक अपंगता", "ta": "IS 3786 நிரந்தர பகுதி ஊனம்", "kn": "IS 3786 ಶಾಶ್ವತ ಭಾಗಶಃ ಅಂಗವೈಕಲ್ಯ"}),
    (5, {"en": "Fatality or permanent total disablement", "hi": "मृत्यु या स्थायी पूर्ण अपंगता", "ta": "மரணம் அல்லது நிரந்தர முழு ஊனம்", "kn": "ಸಾವು ಅಥವಾ ಶಾಶ್ವತ ಸಂಪೂರ್ಣ ಅಂಗವೈಕಲ್ಯ"}, {"en": "Death or permanent total disablement (6,000 man-days)", "hi": "मृत्यु या स्थायी पूर्ण अपंगता", "ta": "மரணம் அல்லது நிரந்தர முழு ஊனம்", "kn": "ಸಾವು ಅಥವಾ ಶಾಶ್ವತ ಸಂಪೂರ್ಣ ಅಂಗವೈಕಲ್ಯ"}),
]
BANDS = [
    {"band": "low", "min": 1, "max": 3, "colour": "green", "response": {"en": "Monitor; fix within 90 days or by the next review (Derived)", "hi": "निगरानी; 90 दिनों में या अगली समीक्षा तक ठीक करें", "ta": "கண்காணிக்கவும்; 90 நாட்களுக்குள் அல்லது அடுத்த மதிப்பாய்வில் சரிசெய்யவும்", "kn": "ಗಮನಿಸಿ; 90 ದಿನಗಳೊಳಗೆ ಅಥವಾ ಮುಂದಿನ ಪರಿಶೀಲನೆಗೆ ಸರಿಪಡಿಸಿ"}},
    {"band": "moderate", "min": 4, "max": 7, "colour": "amber", "response": {"en": "Planned reduction within 30 days (same month)", "hi": "30 दिनों में नियोजित कमी (उसी महीने)", "ta": "30 நாட்களுக்குள் திட்டமிட்ட குறைப்பு (அதே மாதம்)", "kn": "30 ದಿನಗಳೊಳಗೆ ಯೋಜಿತ ಕಡಿತ (ಅದೇ ತಿಂಗಳು)"}},
    {"band": "high", "min": 8, "max": 14, "colour": "orange", "response": {"en": "Continue only with approved interim controls; fix within 7 days (same week)", "hi": "केवल स्वीकृत अंतरिम नियंत्रणों के साथ जारी रखें; 7 दिनों में ठीक करें", "ta": "அங்கீகரிக்கப்பட்ட இடைக்காலக் கட்டுப்பாடுகளுடன் மட்டுமே தொடரவும்; 7 நாட்களுக்குள் சரிசெய்யவும்", "kn": "ಅನುಮೋದಿತ ಮಧ್ಯಂತರ ನಿಯಂತ್ರಣಗಳೊಂದಿಗೆ ಮಾತ್ರ ಮುಂದುವರಿಸಿ; 7 ದಿನಗಳೊಳಗೆ ಸರಿಪಡಿಸಿ"}},
    {"band": "extreme", "min": 15, "max": 25, "colour": "red", "response": {"en": "Stop or do not start; senior approval to resume; interim control the same shift; fix in 24–72 h (HSG250 para 55)", "hi": "रोकें या शुरू न करें; फिर से शुरू करने के लिए वरिष्ठ स्वीकृति; उसी शिफ्ट में अंतरिम नियंत्रण; 24–72 घंटे में ठीक करें", "ta": "நிறுத்தவும் அல்லது தொடங்க வேண்டாம்; மீண்டும் தொடங்க மூத்த ஒப்புதல்; அதே ஷிப்டில் இடைக்காலக் கட்டுப்பாடு; 24–72 மணி நேரத்தில் சரிசெய்யவும்", "kn": "ನಿಲ್ಲಿಸಿ ಅಥವಾ ಪ್ರಾರಂಭಿಸಬೇಡಿ; ಪುನರಾರಂಭಕ್ಕೆ ಹಿರಿಯ ಅನುಮೋದನೆ; ಅದೇ ಶಿಫ್ಟ್‌ನಲ್ಲಿ ಮಧ್ಯಂತರ ನಿಯಂತ್ರಣ; 24–72 ಗಂಟೆಗಳಲ್ಲಿ ಸರಿಪಡಿಸಿ"}},
]

# ---------------------------------------------------------------- due-date rules (§8.2) and ladders (§8.4), design defaults

DUE_DATE_RULES = [  # band, amount, unit, interim required, verify within hours
    ("extreme", 72, "hours", True, 24),
    ("high", 7, "days", True, 72),
    ("moderate", 30, "days", False, 120),
    ("low", 90, "days", False, 240),
]

STANDARD_LADDER = [
    {"offsetMinutes": -7 * 1440, "recipient": "owner", "channel": "push"},
    {"offsetMinutes": -3 * 1440, "recipient": "owner", "channel": "push"},
    {"offsetMinutes": 0, "recipient": "owner", "channel": "push"},
    {"offsetMinutes": 1440, "recipient": "site_safety_officer", "channel": "push"},
    {"offsetMinutes": 1440, "recipient": "site_head", "channel": "push"},
    {"offsetMinutes": 3 * 1440, "recipient": "hse_manager", "channel": "both"},
    {"offsetMinutes": 3 * 1440, "recipient": "site_head", "channel": "email"},
]
EXTREME_LADDER = [
    {"offsetMinutes": -1440, "recipient": "owner", "channel": "push"},
    {"offsetMinutes": -240, "recipient": "owner", "channel": "push"},
    {"offsetMinutes": 0, "recipient": "owner", "channel": "both"},
    {"offsetMinutes": 120, "recipient": "site_safety_officer", "channel": "both"},
    {"offsetMinutes": 120, "recipient": "site_head", "channel": "both"},
    {"offsetMinutes": 1440, "recipient": "hse_manager", "channel": "both"},
]
LADDERS = [("low", STANDARD_LADDER, "design default (TeamLease RegTrack pattern)"), ("moderate", STANDARD_LADDER, "design default (TeamLease RegTrack pattern)"),
           ("high", STANDARD_LADDER, "design default (TeamLease RegTrack pattern)"), ("extreme", EXTREME_LADDER, "design default")]

# ---------------------------------------------------------------- rule sets and timer rules (§8.3)

RULE_SETS = [
    # code, name, state, site_type, regime, status, enabled, reviewed_by, notes
    ("TN_FACTORY_LEGACY", "Tamil Nadu Factories Rules 1950 (legacy, savings position)", "TN", "factory", "legacy", "verified_secondary", True, "SafeWorks research pack", "TN FR 1950 r.96; FA s.88(2). In practical use under the savings position after the OSH Code."),
    ("KA_FACTORY_LEGACY", "Karnataka Factories Rules 1969 (legacy)", "KA", "factory", "legacy", "verified_secondary", False, "", "Form 17 verified (secondary); the accident clock was not found — never copy TN. Enable after the clock is reviewed."),
    ("BOCW_TN_LEGACY", "TN BOCW Rules 2006 (legacy)", "TN", "construction_site", "legacy", "verified_secondary", True, "SafeWorks research pack", "Death / 48 h+ incapacity: 4 h and 72 h to DISH, s.39 authority, next of kin; police and DM/SDM for death or >10-day disablement."),
    ("BOCW_KA_PROVISIONAL", "Karnataka BOCW (provisional, TN structure)", "KA", "construction_site", "legacy", "provisional", True, "SafeWorks research pack", "All clocks provisional; Form IV notice 30 days before work starts (Verified secondary)."),
    ("OSH_CENTRAL", "OSH Code central rules (Centre as appropriate government)", "ALL", "any", "osh_central", "verified_secondary", True, "SafeWorks research pack", "Form XI at once; 12 h after the 48 h; 24 h after reaching 48 h; dangerous occurrences 12 h to the Inspector-cum-Facilitator and DM/SDO."),
    ("KA_OSH_DRAFT_2026", "Karnataka OSH draft rules 2026 (draft)", "KA", "any", "draft", "draft_rule", False, "", "Draft rule: 12 h clocks, 17 classes. Shipped disabled."),
    ("TN_OSH_DRAFT_2022", "Tamil Nadu OSH draft rules 2022 (draft)", "TN", "any", "draft", "draft_rule", False, "", "Draft rule: Form V by day 28, then fortnightly. Shipped disabled."),
    ("COMMON_ANY_SITE", "Any site: electrical, boiler, chemical, gas, petroleum, DPDP breach", "ALL", "any", "legacy", "verified_primary", True, "SafeWorks research pack", "Intimation of Accidents Rules 2005; Boilers Act 2025 s.23; MSIHC r.5; Gas Cylinders Rules r.67; PESO; DPDP Rules r.7."),
]

TIMER_RULES = [
    # rule set, event class, conditions, basis, deadline minutes (None = blocks enabling), recipient, form, status, source note
    ("TN_FACTORY_LEGACY", "injury_illness", ["death_or_injury"], "from_learned_at", 12 * 60, "Inspector of Factories (phone at once; police and DM/SDO for certain items)", "Form 18", "verified_secondary", "TN FR 1950 r.96"),
    ("TN_FACTORY_LEGACY", "dangerous_occurrence", [], "from_learned_at", 12 * 60, "Inspector of Factories", "Form 18", "verified_secondary", "TN FR 1950 r.96"),
    ("TN_FACTORY_LEGACY", "injury_illness", ["incapacity_48h"], "from_condition_met", 24 * 60, "Inspector of Factories", "Form 18", "verified_secondary", "TN FR 1950 r.96: within 24 h after the 48 h ends"),
    ("TN_FACTORY_LEGACY", "injury_illness", ["return_before_day_21"], "from_condition_met", 7 * 24 * 60, "Inspector of Factories", "Form 18-B", "verified_secondary", "Report within 7 days of return; Form 18-B within 28 days"),
    ("TN_FACTORY_LEGACY", "injury_illness", ["death"], "from_learned_at", 30 * 24 * 60, "Inquiry (FA s.88(2))", "", "verified_primary", "Inquiry within 1 month"),
    ("KA_FACTORY_LEGACY", "injury_illness", ["accident"], "from_learned_at", None, "Inspector of Factories", "Form 17", "unverified", "KA FR 1969: time limit not found, never copy TN (form Verified secondary; clock Unverified)"),
    ("KA_FACTORY_LEGACY", "dangerous_occurrence", [], "from_learned_at", None, "Inspector of Factories", "Form 17", "unverified", "Clock Unverified"),
    ("KA_FACTORY_LEGACY", "monthly_return", [], "from_condition_met", 5 * 24 * 60, "Inspector of Factories", "Form 23", "verified_secondary", "Register copy before the 5th"),
    ("KA_FACTORY_LEGACY", "injury_illness", ["death"], "from_learned_at", 30 * 24 * 60, "Inquiry (FA s.88(2))", "", "verified_primary", "Inquiry within 1 month"),
    ("BOCW_TN_LEGACY", "injury_illness", ["death"], "from_learned_at", 4 * 60, "DISH, s.39 authority, next of kin", "BOCW notice", "verified_secondary", "Within 4 h"),
    ("BOCW_TN_LEGACY", "injury_illness", ["incapacity_48h"], "from_learned_at", 72 * 60, "DISH, s.39 authority, next of kin", "BOCW notice", "verified_secondary", "Within 72 h"),
    ("BOCW_TN_LEGACY", "injury_illness", ["death_or_disablement_over_10_days"], "from_learned_at", 4 * 60, "Add police and DM/SDM; scene undisturbed until inspected", "BOCW notice", "verified_secondary", "TN BOCW"),
    ("BOCW_TN_LEGACY", "dangerous_occurrence", ["lifting_appliance_collapse"], "from_learned_at", 4 * 60, "Police and DM/SDM", "BOCW notice", "verified_secondary", "TN BOCW"),
    ("BOCW_TN_LEGACY", "injury_illness", ["five_or_more_deaths"], "from_learned_at", 30 * 24 * 60, "Inquiry (BOCW Act s.39)", "", "verified_primary", "Inquiry within 1 month"),
    ("BOCW_KA_PROVISIONAL", "injury_illness", ["death"], "from_learned_at", 4 * 60, "Authority (provisional, TN structure)", "BOCW notice", "provisional", "Unverified; TN structure"),
    ("BOCW_KA_PROVISIONAL", "injury_illness", ["incapacity_48h"], "from_learned_at", 72 * 60, "Authority (provisional, TN structure)", "BOCW notice", "provisional", "Unverified; TN structure"),
    ("BOCW_KA_PROVISIONAL", "new_site", [], "from_condition_met", 30 * 24 * 60, "Form IV notice 30 days before work starts", "Form IV", "verified_secondary", "Notice Verified (secondary)"),
    ("OSH_CENTRAL", "injury_illness", ["death"], "from_learned_at", 60, "Inspector-cum-Facilitator (Form XI, at once)", "Form XI", "verified_secondary", "At once"),
    ("OSH_CENTRAL", "injury_illness", ["incapacity_48h"], "from_condition_met", 12 * 60, "Inspector-cum-Facilitator", "Form XI", "verified_secondary", "12 h after the 48 h"),
    ("OSH_CENTRAL", "injury_illness", ["absence_spells_48h"], "from_condition_met", 24 * 60, "Inspector-cum-Facilitator", "Form XI", "verified_secondary", "24 h after reaching 48 h"),
    ("OSH_CENTRAL", "dangerous_occurrence", [], "from_learned_at", 12 * 60, "Inspector-cum-Facilitator and DM/SDO", "Form XI", "verified_secondary", "27 types incl. scaffold collapse, crane failure, falls from height"),
    ("OSH_CENTRAL", "committee_recommendation", [], "from_condition_met", 15 * 24 * 60, "Employer", "", "verified_secondary", "Act within 15 days"),
    ("KA_OSH_DRAFT_2026", "injury_illness", ["death"], "from_learned_at", 12 * 60, "Inspector-cum-Facilitator", "", "draft_rule", "Draft: same 12 h clocks, 17 classes"),
    ("TN_OSH_DRAFT_2022", "monthly_return", [], "from_condition_met", 28 * 24 * 60, "Inspector-cum-Facilitator", "Form V", "draft_rule", "Draft: Form V by day 28, then fortnightly"),
    ("COMMON_ANY_SITE", "electrical_accident", ["fatal"], "from_learned_at", 24 * 60, "Electrical Inspector (phone at once)", "Fatal report", "verified_primary", "Intimation of Accidents Rules 2005 r.3"),
    ("COMMON_ANY_SITE", "electrical_accident", [], "from_learned_at", 48 * 60, "Electrical Inspector", "Form A", "verified_primary", "Intimation of Accidents Rules 2005 r.3"),
    ("COMMON_ANY_SITE", "boiler_accident", [], "from_learned_at", 24 * 60, "Chief Inspector of Boilers", "", "verified_primary", "Boilers Act 2025 s.23"),
    ("COMMON_ANY_SITE", "major_chemical_accident", [], "from_learned_at", 48 * 60, "Authority on Schedule 6", "Schedule 6", "verified_primary", "MSIHC Rules r.5"),
    ("COMMON_ANY_SITE", "gas_cylinder_accident", [], "from_learned_at", 12 * 60, "Chief Controller of Explosives", "Letter", "verified_primary", "Gas Cylinders Rules r.67 (legal-review list)"),
    ("COMMON_ANY_SITE", "petroleum_accident", [], "from_learned_at", 24 * 60, "PESO", "Letter", "verified_secondary", "PESO"),
    ("COMMON_ANY_SITE", "personal_data_breach", [], "from_learned_at", 72 * 60, "Affected people and the Data Protection Board (without delay; detailed report 72 h)", "", "verified_primary", "DPDP Rules r.7"),
]

# ---------------------------------------------------------------- categories (§16.1 extended)

CATEGORIES = [
    # code, en, hi, ta, kn, critical, incident prompt, IS 3786, icon
    ("PPE", "PPE", "पीपीई", "தனிநபர் பாதுகாப்பு உபகரணம்", "ವೈಯಕ್ತಿಕ ರಕ್ಷಣಾ ಸಾಧನ", False, "", "B-3", "helmet"),
    ("HEIGHT", "Work at height and falls", "ऊंचाई पर काम और गिरना", "உயரத்தில் வேலை மற்றும் வீழ்ச்சி", "ಎತ್ತರದಲ್ಲಿ ಕೆಲಸ ಮತ್ತು ಬೀಳುವಿಕೆ", True, "Fall from height", "B-2", "height"),
    ("ELEC", "Electrical", "विद्युत", "மின்சாரம்", "ವಿದ್ಯುತ್", True, "Electrical accident", "B-2", "bolt"),
    ("GUARD", "Machine guarding", "मशीन गार्डिंग", "இயந்திர பாதுகாப்பு", "ಯಂತ್ರ ರಕ್ಷಣೆ", True, "", "B-2", "gear"),
    ("HOUSE", "Housekeeping and access", "हाउसकीपिंग और पहुंच", "சுத்தம் மற்றும் அணுகல்", "ಮನೆಗೆಲಸ ಮತ್ತು ಪ್ರವೇಶ", False, "", "B-2", "broom"),
    ("FIRE", "Fire and hot work", "आग और हॉट वर्क", "தீ மற்றும் வெப்ப வேலை", "ಬೆಂಕಿ ಮತ್ತು ಹಾಟ್ ವರ್ಕ್", True, "Fire", "B-2", "fire"),
    ("CHEM", "Chemical, spill and gas", "रसायन, रिसाव और गैस", "வேதிப்பொருள், கசிவு மற்றும் வாயு", "ರಾಸಾಯನಿಕ, ಸೋರಿಕೆ ಮತ್ತು ಅನಿಲ", True, "Dangerous occurrence", "B-2", "flask"),
    ("LIFT", "Material handling and lifting", "सामग्री हैंडलिंग और उठाना", "பொருள் கையாளுதல் மற்றும் தூக்குதல்", "ವಸ್ತು ನಿರ್ವಹಣೆ ಮತ್ತು ಎತ್ತುವಿಕೆ", True, "Crane or lifting failure", "B-2", "crane"),
    ("EXCAV", "Excavation and trenches", "खुदाई और खाइयां", "அகழ்வு மற்றும் பள்ளங்கள்", "ಅಗೆತ ಮತ್ತು ಕಂದಕ", True, "Collapse", "B-2", "excavator"),
    ("SCAFF", "Scaffolding and ladders", "मचान और सीढ़ियां", "சாரக்கட்டு மற்றும் ஏணிகள்", "ಸ್ಕ್ಯಾಫೋಲ್ಡ್ ಮತ್ತು ಏಣಿ", True, "Scaffold collapse", "B-2", "scaffold"),
    ("CONFINED", "Confined space", "सीमित स्थान", "மூடிய இடம்", "ಸೀಮಿತ ಸ್ಥಳ", True, "Confined space incident", "B-2", "tank"),
    ("VEHICLE", "Vehicles and mobile plant", "वाहन और मोबाइल प्लांट", "வாகனங்கள் மற்றும் நகரும் இயந்திரங்கள்", "ವಾಹನ ಮತ್ತು ಚಲಿಸುವ ಯಂತ್ರ", True, "Vehicle", "B-2", "truck"),
    ("TOOLS", "Tools and equipment", "औज़ार और उपकरण", "கருவிகள் மற்றும் உபகரணங்கள்", "ಉಪಕರಣ ಮತ್ತು ಸಲಕರಣೆ", False, "", "B-2", "tool"),
    ("PROC", "Procedures and permits", "प्रक्रियाएं और परमिट", "நடைமுறைகள் மற்றும் அனுமதிகள்", "ಕಾರ್ಯವಿಧಾನ ಮತ್ತು ಪರವಾನಗಿ", False, "", "B-3", "clipboard"),
    ("HEALTH", "Health, welfare and first aid", "स्वास्थ्य, कल्याण और प्राथमिक चिकित्सा", "உடல்நலம், நலன் மற்றும் முதலுதவி", "ಆರೋಗ್ಯ, ಕಲ್ಯಾಣ ಮತ್ತು ಪ್ರಥಮ ಚಿಕಿತ್ಸೆ", False, "", "B-2", "heart"),
    ("ENV", "Environment", "पर्यावरण", "சுற்றுச்சூழல்", "ಪರಿಸರ", False, "", "B-2", "leaf"),
    ("HEAT", "Heat stress", "गर्मी का तनाव", "வெப்ப அழுத்தம்", "ಶಾಖದ ಒತ್ತಡ", False, "", "B-2", "sun"),
    ("NOISE", "Noise", "शोर", "இரைச்சல்", "ಶಬ್ದ", False, "", "B-2", "ear"),
    ("DUST", "Dust and fumes", "धूल और धुआं", "தூசி மற்றும் புகை", "ಧೂಳು ಮತ್ತು ಹೊಗೆ", False, "", "B-2", "cloud"),
    ("ERGO", "Ergonomics and manual handling", "एर्गोनॉमिक्स और हाथ से उठाना", "பணிச்சூழலியல் மற்றும் கையால் கையாளுதல்", "ದಕ್ಷತಾಶಾಸ್ತ್ರ ಮತ್ತು ಕೈ ನಿರ್ವಹಣೆ", False, "", "B-3", "back"),
    ("PRESSURE", "Pressure systems", "दबाव प्रणालियां", "அழுத்த அமைப்புகள்", "ಒತ್ತಡ ವ್ಯವಸ್ಥೆ", True, "Dangerous occurrence", "B-2", "gauge"),
    ("HOTMETAL", "Hot metal and furnaces", "गर्म धातु और भट्टियां", "சூடான உலோகம் மற்றும் உலைகள்", "ಬಿಸಿ ಲೋಹ ಮತ್ತು ಕುಲುಮೆ", True, "Dangerous occurrence", "B-2", "furnace"),
    ("RADIATION", "Radiation", "विकिरण", "கதிர்வீச்சு", "ವಿಕಿರಣ", True, "Dangerous occurrence", "B-2", "radiation"),
    ("BIO", "Biological hazards", "जैविक खतरे", "உயிரியல் ஆபத்துகள்", "ಜೈವಿಕ ಅಪಾಯ", False, "", "B-2", "bio"),
    ("SECURITY", "Security and access control", "सुरक्षा और प्रवेश नियंत्रण", "பாதுகாப்பு மற்றும் அணுகல் கட்டுப்பாடு", "ಭದ್ರತೆ ಮತ್ತು ಪ್ರವೇಶ ನಿಯಂತ್ರಣ", False, "", "B-3", "shield"),
    ("OTHER", "Other", "अन्य", "மற்றவை", "ಇತರೆ", False, "", "B-2", "dots"),
]

# ---------------------------------------------------------------- industry profiles (fallback for the 23 library codes)

INDUSTRIES_FALLBACK = [
    ("construction", "Building construction", {"hi": "भवन निर्माण", "ta": "கட்டிட கட்டுமானம்", "kn": "ಕಟ್ಟಡ ನಿರ್ಮಾಣ"}, "Residential, commercial and industrial sheds, PEB, high-rise", "construction", ["construction_site"],
     ["PPE", "HEIGHT", "ELEC", "HOUSE", "FIRE", "LIFT", "EXCAV", "SCAFF", "CONFINED", "VEHICLE", "TOOLS", "PROC", "HEALTH", "HEAT"], ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9"],
     ["Falls from height", "Scaffold collapse", "Excavation collapse", "Struck by plant or cranes", "Electrocution", "Falling objects", "Heat", "Monsoon flooding"], ["Helmet", "Safety shoes", "Hi-vis vest", "Harness at height", "Gloves", "Eye protection"]),
    ("infrastructure", "Infrastructure & civil works", {"hi": "बुनियादी ढांचा और सिविल कार्य", "ta": "உள்கட்டமைப்பு மற்றும் சிவில் பணிகள்", "kn": "ಮೂಲಸೌಕರ್ಯ ಮತ್ತು ಸಿವಿಲ್ ಕಾಮಗಾರಿ"}, "Roads, bridges, metro, tunnels, pipelines, water works", "road", ["construction_site"],
     ["PPE", "HEIGHT", "ELEC", "HOUSE", "LIFT", "EXCAV", "SCAFF", "CONFINED", "VEHICLE", "PROC", "HEAT", "DUST"], ["T1", "T2", "T3", "T4", "T6", "T7", "T8", "T9"],
     ["Traffic and plant movement", "Excavation collapse", "Tunnelling", "Falls", "Lifting"], ["Helmet", "Safety shoes", "Hi-vis vest", "Harness at height"]),
    ("manufacturing", "Engineering & manufacturing", {"hi": "इंजीनियरिंग और विनिर्माण", "ta": "பொறியியல் மற்றும் உற்பத்தி", "kn": "ಎಂಜಿನಿಯರಿಂಗ್ ಮತ್ತು ಉತ್ಪಾದನೆ"}, "Machining, fabrication, assembly, sheet metal, workshops", "factory", ["factory"],
     ["PPE", "GUARD", "ELEC", "HOUSE", "FIRE", "LIFT", "TOOLS", "PROC", "HEALTH", "NOISE", "ERGO", "PRESSURE"], ["T1", "T4", "T5", "T6", "T7", "T8", "T9"],
     ["Machine entanglement", "Electrical", "Hot work", "Lifting", "Noise"], ["Safety shoes", "Eye protection", "Gloves", "Hearing protection"]),
    ("automotive", "Automotive & auto components", {"hi": "ऑटोमोटिव और ऑटो कंपोनेंट", "ta": "வாகன மற்றும் வாகன உதிரிபாகங்கள்", "kn": "ಆಟೋಮೋಟಿವ್ ಮತ್ತು ಬಿಡಿಭಾಗಗಳು"}, "Press shop, body & weld, paint shop, assembly, EV battery and test tracks", "car", ["factory", "hazardous_process_factory"],
     ["PPE", "GUARD", "ELEC", "HOUSE", "FIRE", "CHEM", "LIFT", "TOOLS", "PROC", "NOISE", "ERGO", "VEHICLE"], ["T1", "T4", "T5", "T6", "T7", "T8", "T9", "IND_AUTO_PRESS"],
     ["Press and robot cells", "Paint shop flammables", "Welding fumes", "Forklifts", "EV high voltage"], ["Safety shoes", "Eye protection", "Gloves", "Hearing protection", "Arc-flash PPE"]),
    ("chemical", "Chemical & petrochemical", {"hi": "रासायनिक और पेट्रोरसायन", "ta": "வேதியியல் மற்றும் பெட்ரோ வேதியியல்", "kn": "ರಾಸಾಯನಿಕ ಮತ್ತು ಪೆಟ್ರೋಕೆಮಿಕಲ್"}, "Process plants, MAH units, bulk storage, speciality chemicals", "flask", ["hazardous_process_factory", "factory"],
     ["PPE", "CHEM", "FIRE", "PRESSURE", "CONFINED", "ELEC", "HOUSE", "PROC", "HEALTH", "ENV"], ["T1", "T5", "T6", "T7", "T8", "T9", "IND_CHEM_LOADING"],
     ["Toxic release", "Fire and explosion", "Confined space", "Pressure systems", "Corrosives"], ["Chemical suit", "Respirator", "Goggles", "Gloves", "Safety shoes"]),
    ("pharma", "Pharmaceuticals & life sciences", {"hi": "फार्मास्यूटिकल्स और जीवन विज्ञान", "ta": "மருந்து மற்றும் உயிர் அறிவியல்", "kn": "ಔಷಧ ಮತ್ತು ಜೀವ ವಿಜ್ಞಾನ"}, "API and formulation plants, clean rooms, solvent recovery, labs", "pill", ["hazardous_process_factory", "factory"],
     ["PPE", "CHEM", "FIRE", "PRESSURE", "BIO", "ELEC", "HOUSE", "PROC", "HEALTH"], ["T1", "T5", "T6", "T7", "T8", "T9"], ["Solvents", "Potent compounds", "Reactors", "Biological agents"], ["Lab coat", "Goggles", "Gloves", "Respirator"]),
    ("food", "Food, beverage & dairy", {"hi": "खाद्य, पेय और डेयरी", "ta": "உணவு, பானம் மற்றும் பால்", "kn": "ಆಹಾರ, ಪಾನೀಯ ಮತ್ತು ಡೈರಿ"}, "Processing lines, ammonia refrigeration, CIP chemicals, silos, bakeries, bottling", "food", ["factory"],
     ["PPE", "GUARD", "CHEM", "CONFINED", "HOUSE", "ELEC", "PROC", "HEALTH", "ERGO", "HEAT"], ["T1", "T5", "T6", "T7", "T8", "IND_FOOD_AMMONIA"], ["Ammonia release", "CIP chemicals", "Silo entry", "Conveyors", "Slips"], ["Safety shoes", "Gloves", "Goggles", "Hairnet"]),
    ("foundry", "Foundry, forging & heat treatment", {"hi": "फाउंड्री, फोर्जिंग और हीट ट्रीटमेंट", "ta": "வார்ப்படம், பட்டறை மற்றும் வெப்ப சிகிச்சை", "kn": "ಫೌಂಡ್ರಿ, ಫೋರ್ಜಿಂಗ್ ಮತ್ತು ಹೀಟ್ ಟ್ರೀಟ್‌ಮೆಂಟ್"}, "Melting, pouring, forging presses, furnaces", "furnace", ["factory", "hazardous_process_factory"],
     ["PPE", "HOTMETAL", "GUARD", "FIRE", "HEAT", "NOISE", "DUST", "LIFT", "ELEC", "PROC"], ["T1", "T4", "T5", "T6", "T7", "T8", "T9"], ["Molten metal", "Furnace explosion", "Heat stress", "Silica dust"], ["Aluminised suit", "Face shield", "Foundry boots", "Respirator"]),
    ("heavy", "Cement, steel & heavy industry", {"hi": "सीमेंट, इस्पात और भारी उद्योग", "ta": "சிமெண்ட், எஃகு மற்றும் கனரக தொழில்", "kn": "ಸಿಮೆಂಟ್, ಉಕ್ಕು ಮತ್ತು ಭಾರೀ ಉದ್ಯಮ"}, "Kilns, mills, rolling, conveyors, stockyards", "plant", ["factory", "hazardous_process_factory"],
     ["PPE", "HOTMETAL", "GUARD", "DUST", "HEIGHT", "LIFT", "VEHICLE", "CONFINED", "ELEC", "PROC", "HEAT"], ["T1", "T4", "T5", "T6", "T7", "T8", "T9"], ["Conveyors", "Hot metal", "Dust", "Heavy vehicles", "Heights"], ["Helmet", "Safety shoes", "Respirator", "Hearing protection"]),
    ("textiles", "Textiles & garments", {"hi": "वस्त्र और परिधान", "ta": "ஜவுளி மற்றும் ஆடைகள்", "kn": "ಜವಳಿ ಮತ್ತು ಸಿದ್ಧ ಉಡುಪು"}, "Spinning, weaving, dyeing, garment lines", "textile", ["factory"],
     ["PPE", "GUARD", "FIRE", "CHEM", "DUST", "NOISE", "ERGO", "HOUSE", "ELEC", "HEALTH"], ["T1", "T5", "T6", "T7", "T8"], ["Fire", "Machine entanglement", "Cotton dust", "Dye chemicals"], ["Masks", "Gloves", "Hearing protection"]),
    ("plastics", "Plastics, rubber & packaging", {"hi": "प्लास्टिक, रबर और पैकेजिंग", "ta": "பிளாஸ்டிக், ரப்பர் மற்றும் பேக்கேஜிங்", "kn": "ಪ್ಲಾಸ್ಟಿಕ್, ರಬ್ಬರ್ ಮತ್ತು ಪ್ಯಾಕೇಜಿಂಗ್"}, "Injection moulding, extrusion, calendering, printing", "mould", ["factory"],
     ["PPE", "GUARD", "FIRE", "CHEM", "HEAT", "ELEC", "HOUSE", "ERGO", "PROC"], ["T1", "T5", "T6", "T7", "T8"], ["Moulding machines", "Hot surfaces", "Solvents", "Fire"], ["Gloves", "Safety shoes", "Eye protection"]),
    ("electronics", "Electronics & semiconductors", {"hi": "इलेक्ट्रॉनिक्स और सेमीकंडक्टर", "ta": "மின்னணுவியல் மற்றும் குறைக்கடத்திகள்", "kn": "ಎಲೆಕ್ಟ್ರಾನಿಕ್ಸ್ ಮತ್ತು ಸೆಮಿಕಂಡಕ್ಟರ್"}, "SMT lines, clean rooms, wafer fabs, battery assembly", "chip", ["factory"],
     ["PPE", "ELEC", "CHEM", "FIRE", "ERGO", "HOUSE", "PROC", "HEALTH"], ["T1", "T5", "T6", "T7", "T8"], ["Chemicals and gases", "Electrical", "Lithium batteries"], ["ESD wear", "Gloves", "Goggles"]),
    ("wind", "Wind farms & turbine O&M", {"hi": "पवन फार्म और टरबाइन रखरखाव", "ta": "காற்றாலை பண்ணைகள் மற்றும் விசையாழி பராமரிப்பு", "kn": "ಗಾಳಿ ವಿದ್ಯುತ್ ಸ್ಥಾವರ ಮತ್ತು ಟರ್ಬೈನ್ ನಿರ್ವಹಣೆ"}, "Turbine climb, nacelle work, blade repair, remote sites", "wind", ["other", "construction_site"],
     ["PPE", "HEIGHT", "ELEC", "LIFT", "VEHICLE", "FIRE", "HEAT", "PROC", "HEALTH"], ["T1", "T4", "T5", "T6", "T8", "IND_WIND_CLIMB"], ["Falls from height", "Rescue from nacelle", "Electrical", "Lightning", "Remote first aid"], ["Harness", "Helmet with chin strap", "Climb-assist", "Gloves"]),
    ("solar", "Solar parks & rooftop PV", {"hi": "सौर पार्क और रूफटॉप पीवी", "ta": "சூரிய மின் பூங்காக்கள் மற்றும் கூரை பிவி", "kn": "ಸೌರ ಪಾರ್ಕ್ ಮತ್ತು ಮೇಲ್ಛಾವಣಿ ಪಿವಿ"}, "Ground-mount and rooftop PV, inverters, HT yards", "solar", ["other", "construction_site"],
     ["PPE", "HEIGHT", "ELEC", "HEAT", "VEHICLE", "LIFT", "PROC", "HEALTH"], ["T1", "T5", "T6", "T8"], ["DC arc flash", "Roof falls", "Heat stress", "Snakes"], ["Helmet", "Insulated gloves", "Harness", "Sun protection"]),
    ("power", "Power plants, substations & T&D", {"hi": "बिजली संयंत्र, सबस्टेशन और पारेषण", "ta": "மின் நிலையங்கள், துணை மின்நிலையங்கள் மற்றும் விநியோகம்", "kn": "ವಿದ್ಯುತ್ ಸ್ಥಾವರ, ಉಪಕೇಂದ್ರ ಮತ್ತು ಪ್ರಸರಣ"}, "Generation, switchyards, HT lines, LOTO", "bolt", ["factory", "other"],
     ["PPE", "ELEC", "HEIGHT", "FIRE", "PRESSURE", "CONFINED", "HOTMETAL", "PROC", "HEALTH"], ["T1", "T5", "T6", "T8", "T9", "IND_POWER_LOTO"], ["Electrocution", "Arc flash", "Boilers", "Heights"], ["Arc-flash suit", "Insulated gloves", "Helmet", "Safety shoes"]),
    ("oilgas", "Petroleum, LPG & fuel storage", {"hi": "पेट्रोलियम, एलपीजी और ईंधन भंडारण", "ta": "பெட்ரோலியம், எல்பிஜி மற்றும் எரிபொருள் சேமிப்பு", "kn": "ಪೆಟ್ರೋಲಿಯಂ, ಎಲ್‌ಪಿಜಿ ಮತ್ತು ಇಂಧನ ಸಂಗ್ರಹ"}, "Depots, LPG bottling, retail outlets, tank farms", "fuel", ["hazardous_process_factory", "other"],
     ["PPE", "FIRE", "CHEM", "PRESSURE", "CONFINED", "ELEC", "VEHICLE", "PROC"], ["T1", "T5", "T6", "T7", "T8", "T9", "IND_CHEM_LOADING"], ["Fire and explosion", "LPG leaks", "Tank entry", "Static"], ["FR coveralls", "Anti-static shoes", "Gloves", "Goggles"]),
    ("warehouse", "Warehousing, logistics & cold storage", {"hi": "भंडारण, लॉजिस्टिक्स और कोल्ड स्टोरेज", "ta": "கிடங்கு, தளவாடம் மற்றும் குளிர் சேமிப்பு", "kn": "ಗೋದಾಮು, ಸರಕು ಸಾಗಣೆ ಮತ್ತು ಶೀತಲ ಸಂಗ್ರಹ"}, "Racking, forklifts, docks, cold rooms", "forklift", ["other", "factory"],
     ["PPE", "VEHICLE", "LIFT", "HOUSE", "FIRE", "ERGO", "HEIGHT", "CHEM", "PROC"], ["T1", "T6", "T7", "T8", "IND_WH_FORKLIFT"], ["Forklift strikes", "Racking collapse", "Dock falls", "Ammonia in cold rooms"], ["Hi-vis vest", "Safety shoes", "Gloves"]),
    ("mining", "Mining, quarrying & aggregates", {"hi": "खनन, उत्खनन और एग्रीगेट", "ta": "சுரங்கம், கல் குவாரி மற்றும் கற்கள்", "kn": "ಗಣಿಗಾರಿಕೆ, ಕಲ್ಲು ಕ್ವಾರಿ ಮತ್ತು ಜಲ್ಲಿ"}, "Open-cast benches, crushers, blasting, haul roads", "mine", ["mine"],
     ["PPE", "VEHICLE", "DUST", "EXCAV", "GUARD", "ELEC", "NOISE", "FIRE", "PROC", "HEALTH"], ["T1", "T4", "T5", "T6", "T7", "T8"], ["Haul trucks", "Bench collapse", "Blasting", "Silica dust"], ["Helmet", "Respirator", "Hi-vis", "Safety shoes"]),
    ("water", "Water & wastewater plants", {"hi": "जल और अपशिष्ट जल संयंत्र", "ta": "நீர் மற்றும் கழிவுநீர் ஆலைகள்", "kn": "ನೀರು ಮತ್ತು ತ್ಯಾಜ್ಯನೀರು ಘಟಕ"}, "Treatment plants, pumping stations, sewers, chlorine", "water", ["factory", "other"],
     ["PPE", "CONFINED", "CHEM", "BIO", "ELEC", "HEIGHT", "HOUSE", "PROC", "HEALTH"], ["T1", "T5", "T6", "T7", "T8"], ["Sewer gases", "Chlorine", "Drowning", "Confined spaces"], ["Gas detector", "Harness", "Gloves", "Boots"]),
    ("ports", "Ports, shipyards & marine terminals", {"hi": "बंदरगाह, शिपयार्ड और समुद्री टर्मिनल", "ta": "துறைமுகங்கள், கப்பல் கட்டும் தளங்கள் மற்றும் கடல் முனையங்கள்", "kn": "ಬಂದರು, ಹಡಗುಕಟ್ಟೆ ಮತ್ತು ಸಮುದ್ರ ಟರ್ಮಿನಲ್"}, "Cargo handling, cranes, vessels, dry docks", "anchor", ["port", "other"],
     ["PPE", "LIFT", "VEHICLE", "HEIGHT", "CONFINED", "FIRE", "CHEM", "HOUSE", "PROC"], ["T1", "T4", "T6", "T7", "T8", "T9"], ["Cranes", "Falls into water", "Vehicle movement", "Hot work on vessels"], ["Life jacket", "Helmet", "Hi-vis", "Safety shoes"]),
    ("agri", "Agri-processing, sugar & rice mills", {"hi": "कृषि प्रसंस्करण, चीनी और चावल मिलें", "ta": "வேளாண் பதப்படுத்துதல், சர்க்கரை மற்றும் அரிசி ஆலைகள்", "kn": "ಕೃಷಿ ಸಂಸ್ಕರಣೆ, ಸಕ್ಕರೆ ಮತ್ತು ಅಕ್ಕಿ ಗಿರಣಿ"}, "Mills, boilers, bagasse, silos, dryers", "grain", ["factory", "plantation"],
     ["PPE", "GUARD", "FIRE", "PRESSURE", "DUST", "CONFINED", "ELEC", "HOUSE", "PROC", "HEAT"], ["T1", "T5", "T6", "T7", "T8"], ["Boilers", "Dust explosion", "Silo entry", "Conveyors"], ["Masks", "Gloves", "Safety shoes"]),
    ("facilities", "Offices, hospitals, malls & facilities", {"hi": "कार्यालय, अस्पताल, मॉल और सुविधाएं", "ta": "அலுவலகங்கள், மருத்துவமனைகள், வணிக வளாகங்கள் மற்றும் வசதிகள்", "kn": "ಕಚೇರಿ, ಆಸ್ಪತ್ರೆ, ಮಾಲ್ ಮತ್ತು ಸೌಲಭ್ಯ"}, "Facility management, DG sets, lifts, fire systems, housekeeping", "building", ["office", "other"],
     ["PPE", "FIRE", "ELEC", "HOUSE", "HEIGHT", "BIO", "SECURITY", "HEALTH", "ERGO"], ["T1", "T5", "T6", "T7", "T8"], ["Fire", "Lifts", "DG sets", "Slips"], ["Safety shoes", "Gloves"]),
    ("corporate", "Corporate ESG, carbon & energy", {"hi": "कॉर्पोरेट ईएसजी, कार्बन और ऊर्जा", "ta": "நிறுவன ESG, கார்பன் மற்றும் எரிசக்தி", "kn": "ಕಾರ್ಪೊರೇಟ್ ESG, ಇಂಗಾಲ ಮತ್ತು ಇಂಧನ"}, "ESG reporting, BRSR, energy audits, supplier programmes", "leaf", ["office"],
     ["PPE", "HOUSE", "ENV", "HEALTH", "SECURITY", "ERGO"], ["T1", "T7", "T8"], ["Office ergonomics", "Fire", "Travel"], ["None mandatory"]),
]

# ---------------------------------------------------------------- inspection templates (§16.3)

P, S, V, C = "verified_primary", "verified_secondary", "voluntary_standard", "reference_to_confirm"

# items: (code, en, hi, ta, kn, reference text, reference status, extra question overrides)
T1 = [
    ("T1-1", "Everyone wears a helmet and safety shoes", "सभी ने हेलमेट और सुरक्षा जूते पहने हैं", "அனைவரும் தலைக்கவசம் மற்றும் பாதுகாப்பு காலணி அணிந்துள்ளனர்", "ಎಲ್ಲರೂ ಹೆಲ್ಮೆಟ್ ಮತ್ತು ಸುರಕ್ಷತಾ ಶೂ ಧರಿಸಿದ್ದಾರೆ", "BOCW r.54 (P); factories TN FR r.61-N/61-O (C)", P, {}),
    ("T1-2", "Open edges guarded; nets where people or materials can fall", "खुले किनारे सुरक्षित; जहां लोग या सामग्री गिर सकते हैं वहां जाल", "திறந்த விளிம்புகள் பாதுகாக்கப்பட்டுள்ளன; மக்கள் அல்லது பொருட்கள் விழக்கூடிய இடத்தில் வலைகள்", "ತೆರೆದ ಅಂಚುಗಳು ರಕ್ಷಿತ; ಜನರು ಅಥವಾ ವಸ್ತುಗಳು ಬೀಳಬಹುದಾದಲ್ಲಿ ಬಲೆಗಳು", "TN BOCW r.41–42 (P)", P, {"actionDefaults": {"band": "high"}}),
    ("T1-3", "Scaffolds in use tagged \"safe\" within 14 days", "उपयोग में मचानों पर 14 दिनों के भीतर \"सुरक्षित\" टैग", "பயன்பாட்டில் உள்ள சாரக்கட்டுகள் 14 நாட்களுக்குள் \"பாதுகாப்பானது\" எனக் குறிக்கப்பட்டுள்ளன", "ಬಳಕೆಯಲ್ಲಿರುವ ಸ್ಕ್ಯಾಫೋಲ್ಡ್‌ಗಳು 14 ದಿನಗಳೊಳಗೆ \"ಸುರಕ್ಷಿತ\" ಟ್ಯಾಗ್", "IS 3696-1 cl. 9.12 (V)", V, {}),
    ("T1-4", "Aisles at least 1 m, clear and lit; stacks stable, cement at most 15 bags high", "गलियारे कम से कम 1 मीटर, साफ और रोशन; ढेर स्थिर, सीमेंट अधिकतम 15 बोरी ऊंचा", "நடைபாதைகள் குறைந்தது 1 மீ, தெளிவாகவும் ஒளியுடனும்; அடுக்குகள் நிலையானவை, சிமெண்ட் அதிகபட்சம் 15 மூட்டை உயரம்", "ಹಾದಿಗಳು ಕನಿಷ್ಠ 1 ಮೀ, ಖಾಲಿ ಮತ್ತು ಬೆಳಕು; ರಾಶಿಗಳು ಸ್ಥಿರ, ಸಿಮೆಂಟ್ ಗರಿಷ್ಠ 15 ಚೀಲ ಎತ್ತರ", "IS 7969 cl. 2.1, 3.3 (V)", V, {}),
    ("T1-5", "Spoil back from trench edges", "खाई के किनारों से मिट्टी दूर", "பள்ள விளிம்புகளிலிருந்து மண் விலக்கி வைக்கப்பட்டுள்ளது", "ಕಂದಕದ ಅಂಚಿನಿಂದ ಮಣ್ಣು ದೂರ", "IS 13416-1 (V)", V, {}),
    ("T1-6", "Portable cables earth-cored and undamaged; RCD in circuit", "पोर्टेबल केबल अर्थ-कोर्ड और बिना क्षति; सर्किट में RCD", "கையடக்க கேபிள்கள் பூமிக் கம்பியுடன், சேதமின்றி; சுற்றில் RCD", "ಪೋರ್ಟಬಲ್ ಕೇಬಲ್‌ಗಳು ಅರ್ಥ್-ಕೋರ್ ಮತ್ತು ಹಾನಿರಹಿತ; ಸರ್ಕ್ಯೂಟ್‌ನಲ್ಲಿ RCD", "CEA 2023 regs 23, 44 (P)", P, {"actionDefaults": {"band": "high"}}),
    ("T1-7", "Extinguishers in place, accessible, inspected this month", "अग्निशामक यथास्थान, सुलभ, इस महीने जांचे गए", "தீயணைப்பான்கள் இடத்தில், அணுகக்கூடிய, இந்த மாதம் ஆய்வு செய்யப்பட்டவை", "ಅಗ್ನಿಶಾಮಕಗಳು ಸ್ಥಳದಲ್ಲಿ, ತಲುಪಬಹುದಾದ, ಈ ತಿಂಗಳು ಪರಿಶೀಲಿತ", "IS 2190:2010 cl. 11.12 (V, superseded edition)", V, {}),
    ("T1-8", "First-aid box stocked, custodian named", "प्राथमिक चिकित्सा बॉक्स भरा, संरक्षक नामित", "முதலுதவிப் பெட்டி நிரப்பப்பட்டு, பொறுப்பாளர் பெயரிடப்பட்டுள்ளார்", "ಪ್ರಥಮ ಚಿಕಿತ್ಸಾ ಪೆಟ್ಟಿಗೆ ತುಂಬಿದೆ, ಪಾಲಕರ ಹೆಸರು", "FA s.45 (P); BOCW contents (C)", P, {}),
    ("T1-9", "Overhead protection where the building is 15 m or higher (TN); floors free of oil and obstructions", "15 मीटर या ऊंची इमारत पर ओवरहेड सुरक्षा (TN); फर्श तेल और रुकावट से मुक्त", "15 மீ அல்லது அதற்கு மேல் கட்டிடத்தில் மேல் பாதுகாப்பு (TN); தளங்கள் எண்ணெய் மற்றும் தடைகள் இல்லாமல்", "15 ಮೀ ಅಥವಾ ಹೆಚ್ಚು ಕಟ್ಟಡಕ್ಕೆ ಮೇಲ್ಛಾವಣಿ ರಕ್ಷಣೆ (TN); ನೆಲ ಎಣ್ಣೆ ಮತ್ತು ಅಡೆತಡೆ ಮುಕ್ತ", "TN BOCW r.41 (P); FA s.11, s.32 (C)", P, {}),
]
T2 = [
    ("T2-1", "Base plates at least 12 mm thick on firm ground", "ठोस ज़मीन पर कम से कम 12 मिमी मोटी बेस प्लेट", "உறுதியான தரையில் குறைந்தது 12 மிமீ தடிமன் அடித்தட்டுகள்", "ಗಟ್ಟಿ ನೆಲದ ಮೇಲೆ ಕನಿಷ್ಠ 12 ಮಿಮೀ ದಪ್ಪ ಬೇಸ್ ಪ್ಲೇಟ್", "IS 3696-1 (V)", V, {}),
    ("T2-2", "Ties at 4 m or less vertically; bracing complete", "ऊर्ध्वाधर 4 मीटर या कम पर टाई; ब्रेसिंग पूरी", "செங்குத்தாக 4 மீ அல்லது குறைவாக கட்டுகள்; பிரேசிங் முழுமை", "ಲಂಬವಾಗಿ 4 ಮೀ ಅಥವಾ ಕಡಿಮೆ ಟೈ; ಬ್ರೇಸಿಂಗ್ ಪೂರ್ಣ", "IS 3696-1 (V)", V, {"actionDefaults": {"band": "high"}}),
    ("T2-3", "Platforms above 2 m at least 900 mm wide (1,200 mm with wheelbarrows)", "2 मीटर से ऊपर प्लेटफ़ॉर्म कम से कम 900 मिमी चौड़े (ठेले के साथ 1,200 मिमी)", "2 மீ மேல் தளங்கள் குறைந்தது 900 மிமீ அகலம் (சக்கர வண்டிகளுடன் 1,200 மிமீ)", "2 ಮೀ ಮೇಲಿನ ವೇದಿಕೆಗಳು ಕನಿಷ್ಠ 900 ಮಿಮೀ ಅಗಲ (ವೀಲ್‌ಬ್ಯಾರೋ ಜೊತೆ 1,200 ಮಿಮೀ)", "IS 3696-1 (V)", V, {}),
    ("T2-4", "Top rail 900–1,050 mm, mid-rail and toe boards above 2 m", "2 मीटर से ऊपर टॉप रेल 900–1,050 मिमी, मिड-रेल और टो बोर्ड", "2 மீ மேல் மேல் தண்டவாளம் 900–1,050 மிமீ, நடுத் தண்டவாளம் மற்றும் கால் பலகைகள்", "2 ಮೀ ಮೇಲೆ ಟಾಪ್ ರೇಲ್ 900–1,050 ಮಿಮೀ, ಮಿಡ್-ರೇಲ್ ಮತ್ತು ಟೋ ಬೋರ್ಡ್", "IS 3696-1 (V)", V, {"actionDefaults": {"band": "high"}}),
    ("T2-5", "Planks overlap at least 300 mm on putlogs; access by stairway above 4 m", "पटरों का पुटलॉग पर कम से कम 300 मिमी ओवरलैप; 4 मीटर से ऊपर सीढ़ी से पहुंच", "பலகைகள் புட்லாக்களில் குறைந்தது 300 மிமீ மேற்பொருந்தல்; 4 மீ மேல் படிக்கட்டு வழி அணுகல்", "ಹಲಗೆಗಳು ಪುಟ್‌ಲಾಗ್ ಮೇಲೆ ಕನಿಷ್ಠ 300 ಮಿಮೀ ಅತಿಕ್ರಮಣ; 4 ಮೀ ಮೇಲೆ ಮೆಟ್ಟಿಲು ಪ್ರವೇಶ", "IS 3696-1 (V)", V, {}),
    ("T2-6", "Light-duty (150 kg/m²) or heavy-duty (300 kg/m²) notice displayed", "लाइट-ड्यूटी (150 kg/m²) या हैवी-ड्यूटी (300 kg/m²) सूचना प्रदर्शित", "லேசான பணி (150 kg/m²) அல்லது கனரக பணி (300 kg/m²) அறிவிப்பு காட்டப்பட்டுள்ளது", "ಲಘು (150 kg/m²) ಅಥವಾ ಭಾರೀ (300 kg/m²) ಸೂಚನೆ ಪ್ರದರ್ಶಿತ", "IS 3696-1 (V)", V, {}),
    ("T2-7", "Fasteners and anchorages checked by a competent person; fibre ropes within 30 days", "फास्टनर और एंकरेज सक्षम व्यक्ति द्वारा जांचे गए; फाइबर रस्सियां 30 दिनों के भीतर", "இணைப்பான்கள் மற்றும் நங்கூரங்கள் திறமையான நபரால் சரிபார்க்கப்பட்டவை; நார் கயிறுகள் 30 நாட்களுக்குள்", "ಫಾಸ್ಟನರ್ ಮತ್ತು ಆಂಕರೇಜ್ ಸಮರ್ಥ ವ್ಯಕ್ತಿಯಿಂದ ಪರಿಶೀಲಿತ; ನಾರಿನ ಹಗ್ಗಗಳು 30 ದಿನಗಳೊಳಗೆ", "IS 3696-1 (V)", V, {}),
    ("T2-8", "Responsible person signs the safe or unsafe tag", "जिम्मेदार व्यक्ति सुरक्षित या असुरक्षित टैग पर हस्ताक्षर करता है", "பொறுப்பான நபர் பாதுகாப்பான அல்லது பாதுகாப்பற்ற குறிச்சீட்டில் கையொப்பமிடுகிறார்", "ಜವಾಬ್ದಾರ ವ್ಯಕ್ತಿ ಸುರಕ್ಷಿತ ಅಥವಾ ಅಸುರಕ್ಷಿತ ಟ್ಯಾಗ್‌ಗೆ ಸಹಿ", "BOCW r.189 (title only: C)", C, {}),
]
T3 = [
    ("T3-1", "Notice of intention given; responsible person named", "इरादे की सूचना दी गई; जिम्मेदार व्यक्ति नामित", "நோக்க அறிவிப்பு வழங்கப்பட்டது; பொறுப்பான நபர் பெயரிடப்பட்டார்", "ಉದ್ದೇಶದ ಸೂಚನೆ ನೀಡಲಾಗಿದೆ; ಜವಾಬ್ದಾರ ವ್ಯಕ್ತಿಯ ಹೆಸರು", "BOCW r.119, r.121 (S); lead time (C)", S, {}),
    ("T3-2", "Underground services cleared and marked before digging", "खुदाई से पहले भूमिगत सेवाएं साफ और चिह्नित", "தோண்டுவதற்கு முன் நிலத்தடி சேவைகள் சரிபார்த்து குறிக்கப்பட்டன", "ಅಗೆಯುವ ಮೊದಲು ಭೂಗತ ಸೇವೆಗಳು ಪರಿಶೀಲಿಸಿ ಗುರುತಿಸಲಾಗಿದೆ", "OISD-GDN-192 6.1 (S)", S, {"actionDefaults": {"band": "high"}}),
    ("T3-3", "Deeper than 1.5 m: sloped (about 45°, 0.5 m benches every 1.5 m) or shored; 1 m barricade; two ways out", "1.5 मीटर से गहरी: ढलान (लगभग 45°, हर 1.5 मीटर पर 0.5 मीटर बेंच) या शोरिंग; 1 मीटर बैरिकेड; दो निकास", "1.5 மீ-க்கு மேல் ஆழம்: சாய்வு (சுமார் 45°, ஒவ்வொரு 1.5 மீ-க்கும் 0.5 மீ படிகள்) அல்லது தாங்கு; 1 மீ தடுப்பு; இரண்டு வெளியேறும் வழிகள்", "1.5 ಮೀ ಗಿಂತ ಆಳ: ಇಳಿಜಾರು (ಸುಮಾರು 45°, ಪ್ರತಿ 1.5 ಮೀ ಗೆ 0.5 ಮೀ ಬೆಂಚ್) ಅಥವಾ ಶೋರಿಂಗ್; 1 ಮೀ ತಡೆ; ಎರಡು ನಿರ್ಗಮನ", "OISD-GDN-192 6.1 (S)", S, {"actionDefaults": {"band": "extreme"}}),
    ("T3-4", "Spoil at least 1 m from the edge (or the depth if greater); vehicles at least 2 m back", "किनारे से कम से कम 1 मीटर मिट्टी (या गहराई, जो अधिक हो); वाहन कम से कम 2 मीटर पीछे", "விளிம்பிலிருந்து குறைந்தது 1 மீ மண் (அல்லது ஆழம் அதிகமெனில்); வாகனங்கள் குறைந்தது 2 மீ பின்னால்", "ಅಂಚಿನಿಂದ ಕನಿಷ್ಠ 1 ಮೀ ಮಣ್ಣು (ಅಥವಾ ಆಳ ಹೆಚ್ಚಿದ್ದರೆ ಅದು); ವಾಹನಗಳು ಕನಿಷ್ಠ 2 ಮೀ ಹಿಂದೆ", "OISD-GDN-192 6.1 (S)", S, {}),
    ("T3-5", "Inspected before each shift and after interruptions over a day", "हर शिफ्ट से पहले और एक दिन से अधिक रुकावट के बाद निरीक्षण", "ஒவ்வொரு ஷிப்டுக்கு முன்பும், ஒரு நாளுக்கு மேல் இடைவெளிக்குப் பின்பும் ஆய்வு", "ಪ್ರತಿ ಶಿಫ್ಟ್ ಮೊದಲು ಮತ್ತು ಒಂದು ದಿನಕ್ಕಿಂತ ಹೆಚ್ಚು ಅಡಚಣೆಯ ನಂತರ ತಪಾಸಣೆ", "OISD-GDN-192 6.1 (S)", S, {}),
    ("T3-6", "No entry until a responsible person certifies; air tested; TN CO limit 50 ppm", "जिम्मेदार व्यक्ति के प्रमाणन तक प्रवेश नहीं; हवा जांची गई; TN CO सीमा 50 ppm", "பொறுப்பான நபர் சான்றளிக்கும் வரை நுழைவு இல்லை; காற்று சோதிக்கப்பட்டது; TN CO வரம்பு 50 ppm", "ಜವಾಬ್ದಾರ ವ್ಯಕ್ತಿ ಪ್ರಮಾಣೀಕರಿಸುವವರೆಗೆ ಪ್ರವೇಶವಿಲ್ಲ; ಗಾಳಿ ಪರೀಕ್ಷೆ; TN CO ಮಿತಿ 50 ppm", "BOCW r.40 (S); TN BOCW r.40 (P)", P, {"actionDefaults": {"band": "extreme"}}),
    ("T3-7", "Materials lowered, never thrown", "सामग्री नीचे उतारी गई, कभी फेंकी नहीं", "பொருட்கள் இறக்கப்படுகின்றன, ஒருபோதும் வீசப்படுவதில்லை", "ವಸ್ತುಗಳನ್ನು ಇಳಿಸಲಾಗುತ್ತದೆ, ಎಂದಿಗೂ ಎಸೆಯುವುದಿಲ್ಲ", "IS 13416-1 (V)", V, {}),
]
T4 = [
    ("T4-1", "Examination in date: hoists and lifts 6 months; lifting machines and tackle 12 months", "परीक्षण वैध: होइस्ट और लिफ्ट 6 माह; उठाने वाली मशीनें और टैकल 12 माह", "ஆய்வு காலத்திற்குள்: தூக்கிகள் மற்றும் லிஃப்ட்கள் 6 மாதம்; தூக்கும் இயந்திரங்கள் மற்றும் டேக்கிள் 12 மாதம்", "ಪರೀಕ್ಷೆ ದಿನಾಂಕದೊಳಗೆ: ಹಾಯ್ಸ್ಟ್ ಮತ್ತು ಲಿಫ್ಟ್ 6 ತಿಂಗಳು; ಎತ್ತುವ ಯಂತ್ರ ಮತ್ತು ಟ್ಯಾಕಲ್ 12 ತಿಂಗಳು", "FA s.28, s.29 (P)", P, {"actionDefaults": {"band": "high"}}),
    ("T4-2", "Construction appliance: thorough examination within 12 months; TN 5-year test", "निर्माण उपकरण: 12 माह के भीतर पूर्ण परीक्षण; TN 5-वर्षीय परीक्षण", "கட்டுமானக் கருவி: 12 மாதங்களுக்குள் முழுமையான ஆய்வு; TN 5 ஆண்டு சோதனை", "ನಿರ್ಮಾಣ ಸಾಧನ: 12 ತಿಂಗಳೊಳಗೆ ಸಂಪೂರ್ಣ ಪರೀಕ್ಷೆ; TN 5-ವರ್ಷ ಪರೀಕ್ಷೆ", "BOCW r.56; TN BOCW r.56 (P)", P, {}),
    ("T4-3", "Safe working load marked and matching the certificate; slings and hooks sound, latch present", "सुरक्षित कार्य भार अंकित और प्रमाणपत्र से मेल; स्लिंग और हुक ठीक, लैच मौजूद", "பாதுகாப்பான வேலை சுமை குறிக்கப்பட்டு சான்றிதழுடன் பொருந்துகிறது; ஸ்லிங்குகள் மற்றும் கொக்கிகள் நன்றாக, தாழ்ப்பாள் உள்ளது", "ಸುರಕ್ಷಿತ ಕೆಲಸದ ಹೊರೆ ಗುರುತಿಸಿ ಪ್ರಮಾಣಪತ್ರಕ್ಕೆ ಹೊಂದಿಕೆ; ಸ್ಲಿಂಗ್ ಮತ್ತು ಹುಕ್ ಸರಿ, ಲ್ಯಾಚ್ ಇದೆ", "Reference to confirm", C, {}),
    ("T4-4", "Wire ropes inspected within 3 months (monthly after a broken wire); chains monthly", "तार रस्सियां 3 माह के भीतर जांची (टूटे तार के बाद मासिक); चेन मासिक", "கம்பி கயிறுகள் 3 மாதங்களுக்குள் ஆய்வு (உடைந்த கம்பிக்குப் பின் மாதந்தோறும்); சங்கிலிகள் மாதந்தோறும்", "ತಂತಿ ಹಗ್ಗ 3 ತಿಂಗಳೊಳಗೆ ಪರಿಶೀಲನೆ (ಮುರಿದ ತಂತಿಯ ನಂತರ ಮಾಸಿಕ); ಸರಪಳಿ ಮಾಸಿಕ", "TN BOCW r.70–71 (P)", P, {}),
    ("T4-5", "Operator, signaller and rigger over 18, authorised, medical current", "ऑपरेटर, सिग्नलर और रिगर 18 से ऊपर, अधिकृत, मेडिकल वैध", "இயக்குபவர், சிக்னல் தருபவர் மற்றும் ரிக்கர் 18 வயதுக்கு மேல், அங்கீகரிக்கப்பட்ட, மருத்துவச் சான்று செல்லுபடி", "ಆಪರೇಟರ್, ಸಿಗ್ನಲರ್ ಮತ್ತು ರಿಗ್ಗರ್ 18 ಕ್ಕಿಂತ ಮೇಲೆ, ಅಧಿಕೃತ, ವೈದ್ಯಕೀಯ ಮಾನ್ಯ", "BOCW r.81 (P)", P, {}),
    ("T4-6", "Hoist gates interlocked; automatic stop works; crane on a firm base", "होइस्ट गेट इंटरलॉक; स्वचालित स्टॉप काम करता है; क्रेन ठोस आधार पर", "தூக்கி கதவுகள் இணைப்பூட்டு; தானியங்கி நிறுத்தம் செயல்படுகிறது; கிரேன் உறுதியான தளத்தில்", "ಹಾಯ್ಸ್ಟ್ ಗೇಟ್ ಇಂಟರ್‌ಲಾಕ್; ಸ್ವಯಂಚಾಲಿತ ನಿಲುಗಡೆ ಕಾರ್ಯ; ಕ್ರೇನ್ ಗಟ್ಟಿ ತಳದ ಮೇಲೆ", "TN BOCW r.78, r.80 (P)", P, {"actionDefaults": {"band": "high"}}),
    ("T4-7", "Asset QR shows \"In service\"", "एसेट QR \"सेवा में\" दिखाता है", "உபகரண QR \"சேவையில்\" எனக் காட்டுகிறது", "ಆಸ್ತಿ QR \"ಸೇವೆಯಲ್ಲಿ\" ತೋರಿಸುತ್ತದೆ", "App rule", C, {}),
]
T5 = [
    ("T5-1", "Insulating mats front and rear, class matching voltage (A ≤3.3 kV, B ≤11 kV, C ≤33 kV), no cuts", "आगे और पीछे इन्सुलेटिंग मैट, वोल्टेज के अनुसार क्लास (A ≤3.3 kV, B ≤11 kV, C ≤33 kV), कोई कट नहीं", "முன்னும் பின்னும் காப்புப் பாய்கள், மின்னழுத்தத்திற்கு ஏற்ற வகை (A ≤3.3 kV, B ≤11 kV, C ≤33 kV), வெட்டுகள் இல்லை", "ಮುಂದೆ ಮತ್ತು ಹಿಂದೆ ಇನ್ಸುಲೇಟಿಂಗ್ ಮ್ಯಾಟ್, ವೋಲ್ಟೇಜ್‌ಗೆ ಹೊಂದುವ ವರ್ಗ (A ≤3.3 kV, B ≤11 kV, C ≤33 kV), ಕತ್ತರಿಸಿಲ್ಲ", "CEA 2023 reg 21(5) (P); IS 15652 (V)", P, {}),
    ("T5-2", "Panel metalwork earthed; arc-flash PPE; danger notice (above 250 V, English or Hindi plus local language); shock-treatment chart", "पैनल की धातु अर्थ की गई; आर्क-फ्लैश पीपीई; खतरे की सूचना (250 V से ऊपर, अंग्रेज़ी या हिंदी और स्थानीय भाषा); शॉक उपचार चार्ट", "பேனல் உலோகம் பூமியிடப்பட்டது; ஆர்க்-ஃபிளாஷ் PPE; ஆபத்து அறிவிப்பு (250 V மேல், ஆங்கிலம் அல்லது இந்தி மற்றும் உள்ளூர் மொழி); மின்சார அதிர்ச்சி சிகிச்சை விளக்கப்படம்", "ಪ್ಯಾನೆಲ್ ಲೋಹ ಅರ್ಥ್; ಆರ್ಕ್-ಫ್ಲಾಶ್ PPE; ಅಪಾಯ ಸೂಚನೆ (250 V ಮೇಲೆ, ಇಂಗ್ಲಿಷ್ ಅಥವಾ ಹಿಂದಿ ಮತ್ತು ಸ್ಥಳೀಯ ಭಾಷೆ); ಶಾಕ್ ಚಿಕಿತ್ಸಾ ಚಾರ್ಟ್", "CEA 2023 regs 20, 21, 30 (P)", P, {}),
    ("T5-3", "RCD present and trip-tested", "RCD मौजूद और ट्रिप-टेस्ट किया गया", "RCD உள்ளது மற்றும் டிரிப் சோதனை செய்யப்பட்டது", "RCD ಇದೆ ಮತ್ತು ಟ್ರಿಪ್ ಪರೀಕ್ಷೆ", "CEA 2023 reg 44 (P); interval a design choice", P, {"actionDefaults": {"band": "high"}}),
    ("T5-4", "Earth-pit test within 12 months; record kept 2 years", "अर्थ-पिट परीक्षण 12 माह के भीतर; रिकॉर्ड 2 वर्ष रखा गया", "எர்த் குழி சோதனை 12 மாதங்களுக்குள்; பதிவு 2 ஆண்டுகள் வைக்கப்பட்டது", "ಅರ್ಥ್-ಪಿಟ್ ಪರೀಕ್ಷೆ 12 ತಿಂಗಳೊಳಗೆ; ದಾಖಲೆ 2 ವರ್ಷ", "CEA 2023 reg 43 (P)", P, {}),
    ("T5-5", "Work only by designated persons in the register", "केवल रजिस्टर में नामित व्यक्तियों द्वारा कार्य", "பதிவேட்டில் நியமிக்கப்பட்டவர்களால் மட்டுமே வேலை", "ರಿಜಿಸ್ಟರ್‌ನಲ್ಲಿ ನಿಯೋಜಿತ ವ್ಯಕ್ತಿಗಳಿಂದ ಮಾತ್ರ ಕೆಲಸ", "CEA 2023 regs 3–4 (P)", P, {}),
    ("T5-6", "LOTO: lock and dated tag; tested dead before work", "LOTO: ताला और दिनांकित टैग; काम से पहले डेड परीक्षण", "LOTO: பூட்டு மற்றும் தேதியிட்ட குறிச்சீட்டு; வேலைக்கு முன் மின்சாரம் இல்லை எனச் சோதனை", "LOTO: ಬೀಗ ಮತ್ತು ದಿನಾಂಕದ ಟ್ಯಾಗ್; ಕೆಲಸದ ಮೊದಲು ಡೆಡ್ ಪರೀಕ್ಷೆ", "OISD 6(g) (S); OSHA 1910.147(d) as a model", S, {"actionDefaults": {"band": "extreme"}}),
    ("T5-7", "Insulation-resistance test before reconnecting lines up to 650 V", "650 V तक की लाइनें फिर जोड़ने से पहले इन्सुलेशन-प्रतिरोध परीक्षण", "650 V வரை கோடுகளை மீண்டும் இணைக்கும் முன் காப்பு-எதிர்ப்பு சோதனை", "650 V ವರೆಗಿನ ಲೈನ್ ಮರುಸಂಪರ್ಕದ ಮೊದಲು ಇನ್ಸುಲೇಷನ್-ರೆಸಿಸ್ಟೆನ್ಸ್ ಪರೀಕ್ಷೆ", "CEA 2023 reg 42 (P)", P, {}),
    ("T5-8", "Panel doors closed and locked", "पैनल के दरवाज़े बंद और लॉक", "பேனல் கதவுகள் மூடி பூட்டப்பட்டுள்ளன", "ಪ್ಯಾನೆಲ್ ಬಾಗಿಲು ಮುಚ್ಚಿ ಬೀಗ", "Reference to confirm", C, {}),
]
T6 = [
    ("T6-1", "In its marked place, visible, unobstructed, within 15 m travel", "अपने चिह्नित स्थान पर, दिखाई देने वाला, बिना रुकावट, 15 मीटर की पहुंच में", "குறிக்கப்பட்ட இடத்தில், தெரியும்படி, தடையின்றி, 15 மீ பயணத்திற்குள்", "ಗುರುತಿಸಿದ ಸ್ಥಳದಲ್ಲಿ, ಕಾಣುವಂತೆ, ಅಡೆತಡೆಯಿಲ್ಲ, 15 ಮೀ ಒಳಗೆ", "IS 2190:2010 cl. 11.12 (V, superseded; 2010 defaults, pending check)", V, {}),
    ("T6-2", "Instructions legible, seal intact", "निर्देश पठनीय, सील अक्षुण्ण", "வழிமுறைகள் படிக்கக்கூடியவை, முத்திரை சேதமின்றி", "ಸೂಚನೆಗಳು ಓದಬಹುದು, ಸೀಲ್ ಹಾಗೇ ಇದೆ", "IS 2190:2010 cl. 11.12 (V)", V, {}),
    ("T6-3", "Full by weight, gauge in range", "वज़न से पूर्ण, गेज सीमा में", "எடையால் நிரம்பியது, அளவி வரம்பில்", "ತೂಕದಿಂದ ಪೂರ್ಣ, ಗೇಜ್ ವ್ಯಾಪ್ತಿಯಲ್ಲಿ", "IS 2190:2010 cl. 11.12 (V)", V, {}),
    ("T6-4", "No damage, corrosion or leaks; nozzle and hose clear", "कोई क्षति, जंग या रिसाव नहीं; नोज़ल और होज़ साफ", "சேதம், துரு அல்லது கசிவு இல்லை; முனை மற்றும் குழாய் தெளிவு", "ಹಾನಿ, ತುಕ್ಕು ಅಥವಾ ಸೋರಿಕೆ ಇಲ್ಲ; ನಾಜಲ್ ಮತ್ತು ಹೋಸ್ ಖಾಲಿ", "IS 2190:2010 cl. 11.12 (V)", V, {}),
    ("T6-5", "Hydro-test date not passed (3 years; CO2 5) and annual service tag current", "हाइड्रो-टेस्ट तिथि बीती नहीं (3 वर्ष; CO2 5) और वार्षिक सर्विस टैग वैध", "ஹைட்ரோ சோதனைத் தேதி கடக்கவில்லை (3 ஆண்டு; CO2 5) மற்றும் ஆண்டு சேவைக் குறிச்சீட்டு செல்லுபடி", "ಹೈಡ್ರೋ ಪರೀಕ್ಷೆ ದಿನಾಂಕ ಮೀರಿಲ್ಲ (3 ವರ್ಷ; CO2 5) ಮತ್ತು ವಾರ್ಷಿಕ ಸೇವಾ ಟ್ಯಾಗ್ ಮಾನ್ಯ", "IS 2190:2010 (V); IS 2190:2024 intervals Unverified", V, {}),
    ("T6-6", "QR tag readable", "QR टैग पठनीय", "QR குறிச்சீட்டு படிக்கக்கூடியது", "QR ಟ್ಯಾಗ್ ಓದಬಹುದು", "App rule", C, {}),
]
T7 = [
    ("T7-1", "Aisles at least 1 m clear; floors free of oil, grease, scrap", "गलियारे कम से कम 1 मीटर खाली; फर्श तेल, ग्रीस, स्क्रैप से मुक्त", "நடைபாதைகள் குறைந்தது 1 மீ தெளிவு; தளங்கள் எண்ணெய், கிரீஸ், கழிவு இல்லாமல்", "ಹಾದಿಗಳು ಕನಿಷ್ಠ 1 ಮೀ ಖಾಲಿ; ನೆಲ ಎಣ್ಣೆ, ಗ್ರೀಸ್, ಸ್ಕ್ರ್ಯಾಪ್ ಮುಕ್ತ", "IS 7969 cl. 2.1 (V); FA s.11, s.32 (C)", V, {}),
    ("T7-2", "Stacks stable, segregated, on firm ground; safe access above 1.5 m", "ढेर स्थिर, अलग, ठोस ज़मीन पर; 1.5 मीटर से ऊपर सुरक्षित पहुंच", "அடுக்குகள் நிலையானவை, பிரிக்கப்பட்டவை, உறுதியான தரையில்; 1.5 மீ மேல் பாதுகாப்பான அணுகல்", "ರಾಶಿಗಳು ಸ್ಥಿರ, ಪ್ರತ್ಯೇಕ, ಗಟ್ಟಿ ನೆಲದ ಮೇಲೆ; 1.5 ಮೀ ಮೇಲೆ ಸುರಕ್ಷಿತ ಪ್ರವೇಶ", "IS 7969 cl. 2.1, 2.2.1 (V)", V, {}),
    ("T7-3", "Waste cleared daily; debris down chutes, never thrown", "कचरा रोज़ साफ; मलबा च्यूट से नीचे, कभी फेंका नहीं", "கழிவு தினமும் அகற்றப்படுகிறது; குப்பை குழாய் வழியாக, ஒருபோதும் வீசப்படுவதில்லை", "ತ್ಯಾಜ್ಯ ಪ್ರತಿದಿನ ತೆರವು; ಅವಶೇಷ ಚ್ಯೂಟ್ ಮೂಲಕ, ಎಂದಿಗೂ ಎಸೆಯುವುದಿಲ್ಲ", "IS 7969 (V); IS 13416-1 (V)", V, {}),
    ("T7-4", "Gas cylinders apart from petroleum products; paints ventilated, away from ignition", "गैस सिलेंडर पेट्रोलियम उत्पादों से अलग; पेंट हवादार, आग के स्रोत से दूर", "எரிவாயு உருளைகள் பெட்ரோலியப் பொருட்களிலிருந்து தனியாக; வண்ணப்பூச்சுகள் காற்றோட்டத்துடன், தீப்பொறியிலிருந்து தொலைவில்", "ಅನಿಲ ಸಿಲಿಂಡರ್ ಪೆಟ್ರೋಲಿಯಂ ಉತ್ಪನ್ನಗಳಿಂದ ಬೇರೆ; ಬಣ್ಣಗಳು ಗಾಳಿಯಾಡುವಂತೆ, ಬೆಂಕಿಯಿಂದ ದೂರ", "IS 7969 cl. 3.11, 3.9 (V)", V, {"actionDefaults": {"band": "high"}}),
    ("T7-5", "Pipes blocked against rolling; sand not piled near excavation edges", "पाइप लुढ़कने से रोके गए; खुदाई किनारों के पास रेत का ढेर नहीं", "குழாய்கள் உருளாமல் தடுக்கப்பட்டுள்ளன; அகழ்வு விளிம்புகள் அருகில் மணல் குவிக்கப்படவில்லை", "ಪೈಪ್‌ಗಳು ಉರುಳದಂತೆ ತಡೆ; ಅಗೆತದ ಅಂಚಿನ ಬಳಿ ಮರಳು ರಾಶಿ ಇಲ್ಲ", "IS 7969 cl. 3.8.3 (V)", V, {}),
    ("T7-6", "Lighting adequate", "पर्याप्त रोशनी", "போதுமான ஒளி", "ಸಾಕಷ್ಟು ಬೆಳಕು", "FA s.17 (C)", C, {}),
]
T8 = [
    ("T8-1", "Helmet and safety shoes on everyone", "सभी पर हेलमेट और सुरक्षा जूते", "அனைவரிடமும் தலைக்கவசம் மற்றும் பாதுகாப்பு காலணி", "ಎಲ್ಲರ ಮೇಲೆ ಹೆಲ್ಮೆಟ್ ಮತ್ತು ಸುರಕ್ಷತಾ ಶೂ", "BOCW r.54 (P)", P, {}),
    ("T8-2", "Eye protection for welding, cutting, chipping, grinding", "वेल्डिंग, कटिंग, चिपिंग, ग्राइंडिंग के लिए आंखों की सुरक्षा", "வெல்டிங், வெட்டுதல், சிப்பிங், அரைத்தலுக்கு கண் பாதுகாப்பு", "ವೆಲ್ಡಿಂಗ್, ಕತ್ತರಿಸುವುದು, ಚಿಪ್ಪಿಂಗ್, ಗ್ರೈಂಡಿಂಗ್‌ಗೆ ಕಣ್ಣಿನ ರಕ್ಷಣೆ", "BOCW r.45 (P)", P, {}),
    ("T8-3", "Gloves and protection against corrosives", "दस्ताने और संक्षारक पदार्थों से सुरक्षा", "கையுறைகள் மற்றும் அரிக்கும் பொருட்களுக்கு எதிரான பாதுகாப்பு", "ಕೈಗವಸು ಮತ್ತು ನಾಶಕಗಳ ವಿರುದ್ಧ ರಕ್ಷಣೆ", "BOCW r.46 (P)", P, {}),
    ("T8-4", "Full body harness at height, IS 3521-1 marked, pre-use checked", "ऊंचाई पर फुल बॉडी हार्नेस, IS 3521-1 अंकित, उपयोग से पहले जांचा", "உயரத்தில் முழு உடல் ஹார்னஸ், IS 3521-1 குறிக்கப்பட்டது, பயன்படுத்தும் முன் சரிபார்க்கப்பட்டது", "ಎತ್ತರದಲ್ಲಿ ಪೂರ್ಣ ದೇಹ ಹಾರ್ನೆಸ್, IS 3521-1 ಗುರುತು, ಬಳಕೆಗೆ ಮುನ್ನ ಪರಿಶೀಲನೆ", "IS 3521 (Part 1):2021 (V, content Unverified); OISD-GDN-192 belt above 3 m (S)", V, {"actionDefaults": {"band": "high"}}),
    ("T8-5", "Hearing and respiratory protection as the task or safety data sheet requires", "कार्य या सुरक्षा डेटा शीट के अनुसार श्रवण और श्वसन सुरक्षा", "பணி அல்லது பாதுகாப்பு தரவுத் தாள் தேவைப்படும் செவி மற்றும் சுவாசப் பாதுகாப்பு", "ಕೆಲಸ ಅಥವಾ ಸುರಕ್ಷತಾ ದತ್ತಾಂಶ ಹಾಳೆ ಅಗತ್ಯವಿರುವಂತೆ ಶ್ರವಣ ಮತ್ತು ಉಸಿರಾಟ ರಕ್ಷಣೆ", "Reference to confirm", C, {}),
    ("T8-6", "PPE issue recorded", "पीपीई जारी करने का रिकॉर्ड", "PPE வழங்கல் பதிவு செய்யப்பட்டது", "PPE ವಿತರಣೆ ದಾಖಲೆ", "Reference to confirm", C, {}),
]
T9 = [
    ("T9-1", "Valid hot-work permit displayed", "वैध हॉट-वर्क परमिट प्रदर्शित", "செல்லுபடியாகும் வெப்ப வேலை அனுமதி காட்டப்பட்டுள்ளது", "ಮಾನ್ಯ ಹಾಟ್-ವರ್ಕ್ ಪರವಾನಗಿ ಪ್ರದರ್ಶಿತ", "IS 3016 cl. 2.2 (P); OISD (S)", P, {"actionDefaults": {"band": "extreme"}}),
    ("T9-2", "Gas test 0% LEL before start", "शुरू करने से पहले गैस परीक्षण 0% LEL", "தொடங்கும் முன் வாயு சோதனை 0% LEL", "ಪ್ರಾರಂಭಕ್ಕೆ ಮುನ್ನ ಅನಿಲ ಪರೀಕ್ಷೆ 0% LEL", "OISD 5(n) (S)", S, {"actionDefaults": {"band": "extreme"}}),
    ("T9-3", "Combustibles cleared to 15 m or shielded", "ज्वलनशील पदार्थ 15 मीटर तक हटाए या ढके गए", "எரியக்கூடியவை 15 மீ வரை அகற்றப்பட்டன அல்லது மறைக்கப்பட்டன", "ದಹ್ಯ ವಸ್ತುಗಳು 15 ಮೀ ವರೆಗೆ ತೆರವು ಅಥವಾ ರಕ್ಷಿತ", "IS 3016 cl. 3.2.2 (P); OSHA 10.7 m", P, {}),
    ("T9-4", "Fire watch with extinguisher, staying at least 60 min after work", "अग्निशामक के साथ फायर वॉच, काम के बाद कम से कम 60 मिनट", "தீயணைப்பானுடன் தீக் காவல், வேலைக்குப் பின் குறைந்தது 60 நிமிடம்", "ಅಗ್ನಿಶಾಮಕದೊಂದಿಗೆ ಫೈರ್ ವಾಚ್, ಕೆಲಸದ ನಂತರ ಕನಿಷ್ಠ 60 ನಿಮಿಷ", "IS 3016 cl. 2.5.1 (P); OSHA 30 min", P, {}),
    ("T9-5", "Flashback arrestors; hoses sound; cylinders outside confined spaces", "फ्लैशबैक अरेस्टर; होज़ ठीक; सिलेंडर सीमित स्थानों के बाहर", "ஃபிளாஷ்பேக் தடுப்பான்கள்; குழாய்கள் நன்றாக; உருளைகள் மூடிய இடங்களுக்கு வெளியே", "ಫ್ಲ್ಯಾಶ್‌ಬ್ಯಾಕ್ ಅರೆಸ್ಟರ್; ಹೋಸ್ ಸರಿ; ಸಿಲಿಂಡರ್ ಸೀಮಿತ ಸ್ಥಳದ ಹೊರಗೆ", "OISD 5(q) (S)", S, {}),
    ("T9-6", "Welding machine earthed, in a ventilated non-hazardous area", "वेल्डिंग मशीन अर्थ की गई, हवादार गैर-खतरनाक क्षेत्र में", "வெல்டிங் இயந்திரம் பூமியிடப்பட்டது, காற்றோட்டமுள்ள ஆபத்தற்ற பகுதியில்", "ವೆಲ್ಡಿಂಗ್ ಯಂತ್ರ ಅರ್ಥ್, ಗಾಳಿಯಾಡುವ ಅಪಾಯರಹಿತ ಪ್ರದೇಶದಲ್ಲಿ", "OISD 5(s) (S)", S, {}),
    ("T9-7", "Containers that held flammables emptied and cleaned first", "ज्वलनशील पदार्थ रखने वाले कंटेनर पहले खाली और साफ किए गए", "எரியக்கூடியவை இருந்த கொள்கலன்கள் முதலில் காலி செய்து சுத்தம் செய்யப்பட்டன", "ದಹ್ಯ ವಸ್ತು ಇದ್ದ ಪಾತ್ರೆಗಳು ಮೊದಲು ಖಾಲಿ ಮತ್ತು ಸ್ವಚ್ಛ", "FA s.37 (P); IS 3016 cl. 3.3.2 (P)", P, {}),
    ("T9-8", "Post-work inspection logged", "काम के बाद निरीक्षण दर्ज", "வேலைக்குப் பின் ஆய்வு பதிவு செய்யப்பட்டது", "ಕೆಲಸದ ನಂತರದ ತಪಾಸಣೆ ದಾಖಲೆ", "IS 3016 cl. 2.5.1 (P)", P, {}),
]

IND_AUTO = [
    ("AP-1", "Press guards and light curtains in place and tested", "प्रेस गार्ड और लाइट कर्टन यथास्थान और परीक्षित", "பிரஸ் பாதுகாப்புகள் மற்றும் ஒளித் திரைகள் இடத்தில், சோதிக்கப்பட்டவை", "ಪ್ರೆಸ್ ಗಾರ್ಡ್ ಮತ್ತು ಲೈಟ್ ಕರ್ಟನ್ ಸ್ಥಳದಲ್ಲಿ, ಪರೀಕ್ಷಿತ", "FA s.21 (C); IS 16819 (V)", V, {"actionDefaults": {"band": "extreme"}}),
    ("AP-2", "Two-hand controls work; no bypass", "टू-हैंड कंट्रोल काम करते हैं; कोई बाईपास नहीं", "இரு கை கட்டுப்பாடுகள் செயல்படுகின்றன; புறவழி இல்லை", "ಎರಡು ಕೈ ನಿಯಂತ್ರಣ ಕಾರ್ಯ; ಬೈಪಾಸ್ ಇಲ್ಲ", "Reference to confirm", C, {}),
    ("AP-3", "Robot cell fence interlocks and E-stops tested this shift", "रोबोट सेल फेंस इंटरलॉक और ई-स्टॉप इस शिफ्ट में परीक्षित", "ரோபோ அறை வேலி இணைப்பூட்டுகள் மற்றும் E-stop இந்த ஷிப்டில் சோதிக்கப்பட்டன", "ರೋಬೋಟ್ ಸೆಲ್ ಬೇಲಿ ಇಂಟರ್‌ಲಾಕ್ ಮತ್ತು E-stop ಈ ಶಿಫ್ಟ್ ಪರೀಕ್ಷೆ", "ISO 10218 (V)", V, {"actionDefaults": {"band": "extreme"}}),
    ("AP-4", "Die change under LOTO; dies secured on racks", "डाई बदलना LOTO के तहत; डाई रैक पर सुरक्षित", "டை மாற்றம் LOTO கீழ்; டைகள் ரேக்குகளில் பாதுகாப்பாக", "ಡೈ ಬದಲಾವಣೆ LOTO ಅಡಿಯಲ್ಲಿ; ಡೈಗಳು ರ್ಯಾಕ್‌ನಲ್ಲಿ ಭದ್ರ", "OSHA 1910.147 model (S)", S, {}),
    ("AP-5", "Scrap chutes and sharp-edge handling with cut-resistant gloves", "स्क्रैप च्यूट और धारदार किनारे कट-प्रतिरोधी दस्तानों से", "கழிவுக் குழாய்கள் மற்றும் கூர்மையான விளிம்புகள் வெட்டு எதிர்ப்பு கையுறைகளுடன்", "ಸ್ಕ್ರ್ಯಾಪ್ ಚ್ಯೂಟ್ ಮತ್ತು ಚೂಪಾದ ಅಂಚು ಕಟ್-ರೆಸಿಸ್ಟೆಂಟ್ ಕೈಗವಸು", "Company standard", "company_standard", {}),
]
IND_FOOD = [
    ("FA-1", "Ammonia detectors calibrated; alarm set points posted", "अमोनिया डिटेक्टर कैलिब्रेटेड; अलार्म सेट पॉइंट प्रदर्शित", "அம்மோனியா கண்டறிகள் அளவீடு; அலாரம் அமைப்பு புள்ளிகள் காட்டப்பட்டன", "ಅಮೋನಿಯಾ ಡಿಟೆಕ್ಟರ್ ಕ್ಯಾಲಿಬ್ರೇಟ್; ಅಲಾರಂ ಸೆಟ್ ಪಾಯಿಂಟ್ ಪ್ರದರ್ಶಿತ", "MSIHC Rules (P) where applicable; IIAR 2 (V)", V, {"actionDefaults": {"band": "extreme"}}),
    ("FA-2", "Emergency ventilation and escape masks at the plant room door", "प्लांट रूम के दरवाज़े पर आपातकालीन वेंटिलेशन और एस्केप मास्क", "ஆலை அறை வாசலில் அவசர காற்றோட்டம் மற்றும் தப்பிக்கும் முகமூடிகள்", "ಪ್ಲಾಂಟ್ ರೂಂ ಬಾಗಿಲಲ್ಲಿ ತುರ್ತು ಗಾಳಿ ಮತ್ತು ಎಸ್ಕೇಪ್ ಮಾಸ್ಕ್", "Company standard", "company_standard", {}),
    ("FA-3", "CIP chemicals labelled; SDS at point of use; eyewash within 10 s", "CIP रसायन लेबल किए; उपयोग स्थल पर SDS; 10 सेकंड में आईवॉश", "CIP வேதிப்பொருட்கள் லேபிள்; பயன்படுத்தும் இடத்தில் SDS; 10 வினாடிக்குள் கண் கழுவி", "CIP ರಾಸಾಯನಿಕ ಲೇಬಲ್; ಬಳಕೆ ಸ್ಥಳದಲ್ಲಿ SDS; 10 ಸೆಕೆಂಡಿನಲ್ಲಿ ಐವಾಶ್", "MSIHC r.17 Schedule 9 (P)", P, {}),
    ("FA-4", "Silo entry under permit; atmosphere tested; attendant and retrieval line", "साइलो प्रवेश परमिट के तहत; वातावरण परीक्षित; अटेंडेंट और रिट्रीवल लाइन", "சைலோ நுழைவு அனுமதியுடன்; காற்று சோதிக்கப்பட்டது; உதவியாளர் மற்றும் மீட்புக் கயிறு", "ಸಿಲೋ ಪ್ರವೇಶ ಪರವಾನಗಿ; ವಾತಾವರಣ ಪರೀಕ್ಷೆ; ಸಹಾಯಕ ಮತ್ತು ರಿಟ್ರೀವಲ್ ಲೈನ್", "FA s.36 (P); OISD-STD-105 (S)", P, {"actionDefaults": {"band": "extreme"}}),
    ("FA-5", "Floors dry, drains clear, anti-slip footwear", "फर्श सूखे, नालियां साफ, एंटी-स्लिप जूते", "தளங்கள் உலர், வடிகால்கள் தெளிவு, வழுக்காத காலணி", "ನೆಲ ಒಣ, ಚರಂಡಿ ಖಾಲಿ, ಜಾರದ ಪಾದರಕ್ಷೆ", "Company standard", "company_standard", {}),
]
IND_WIND = [
    ("WT-1", "Climb assist and fall arrest system certified; harness pre-use check", "क्लाइम्ब असिस्ट और फॉल अरेस्ट सिस्टम प्रमाणित; हार्नेस पूर्व-उपयोग जांच", "ஏறும் உதவி மற்றும் வீழ்ச்சி தடுப்பு அமைப்பு சான்றளிக்கப்பட்டது; ஹார்னஸ் முன் சோதனை", "ಕ್ಲೈಂಬ್ ಅಸಿಸ್ಟ್ ಮತ್ತು ಫಾಲ್ ಅರೆಸ್ಟ್ ಪ್ರಮಾಣೀಕೃತ; ಹಾರ್ನೆಸ್ ಪೂರ್ವ ಪರಿಶೀಲನೆ", "IS 3521 (V); GWO BST (V)", V, {"actionDefaults": {"band": "extreme"}}),
    ("WT-2", "Rescue kit in the nacelle, inspected, two trained rescuers on site", "नसेल में रेस्क्यू किट, जांचा गया, साइट पर दो प्रशिक्षित बचावकर्ता", "நாசலில் மீட்புக் கருவி, ஆய்வு செய்யப்பட்டது, தளத்தில் இரண்டு பயிற்சி பெற்ற மீட்பாளர்கள்", "ನಸೆಲ್‌ನಲ್ಲಿ ರೆಸ್ಕ್ಯೂ ಕಿಟ್, ಪರಿಶೀಲಿತ, ಸೈಟ್‌ನಲ್ಲಿ ಎರಡು ತರಬೇತಿ ಪಡೆದ ರಕ್ಷಕರು", "GWO (V)", V, {"actionDefaults": {"band": "extreme"}}),
    ("WT-3", "Weather and lightning check before climb; wind speed within limit", "चढ़ने से पहले मौसम और बिजली की जांच; हवा की गति सीमा में", "ஏறும் முன் வானிலை மற்றும் மின்னல் சோதனை; காற்றின் வேகம் வரம்பிற்குள்", "ಹತ್ತುವ ಮೊದಲು ಹವಾಮಾನ ಮತ್ತು ಮಿಂಚು ಪರಿಶೀಲನೆ; ಗಾಳಿ ವೇಗ ಮಿತಿಯಲ್ಲಿ", "Company standard", "company_standard", {}),
    ("WT-4", "Turbine locked out (rotor lock, yaw brake) before nacelle work", "नसेल कार्य से पहले टरबाइन लॉक आउट (रोटर लॉक, यॉ ब्रेक)", "நாசல் வேலைக்கு முன் விசையாழி பூட்டப்பட்டது (ரோட்டர் பூட்டு, யா பிரேக்)", "ನಸೆಲ್ ಕೆಲಸಕ್ಕೆ ಮುನ್ನ ಟರ್ಬೈನ್ ಲಾಕ್ ಔಟ್ (ರೋಟರ್ ಲಾಕ್, ಯಾ ಬ್ರೇಕ್)", "OSHA 1910.147 model (S)", S, {"actionDefaults": {"band": "extreme"}}),
    ("WT-5", "Radio check and lone-worker check-in schedule agreed", "रेडियो जांच और अकेले काम करने वाले की चेक-इन अनुसूची तय", "ரேடியோ சோதனை மற்றும் தனி பணியாளர் தொடர்பு அட்டவணை ஒப்புக்கொள்ளப்பட்டது", "ರೇಡಿಯೋ ಪರಿಶೀಲನೆ ಮತ್ತು ಏಕಾಂಗಿ ಕೆಲಸಗಾರ ಚೆಕ್-ಇನ್ ವೇಳಾಪಟ್ಟಿ", "Company standard", "company_standard", {}),
]
IND_CHEM = [
    ("CL-1", "Tanker earthed and bonded before transfer; wheel chocks in place", "स्थानांतरण से पहले टैंकर अर्थ और बॉन्ड; व्हील चॉक यथास्थान", "மாற்றத்திற்கு முன் டேங்கர் பூமியிடப்பட்டு பிணைக்கப்பட்டது; சக்கரத் தடுப்புகள் இடத்தில்", "ವರ್ಗಾವಣೆಗೆ ಮುನ್ನ ಟ್ಯಾಂಕರ್ ಅರ್ಥ್ ಮತ್ತು ಬಾಂಡ್; ವೀಲ್ ಚಾಕ್ ಸ್ಥಳದಲ್ಲಿ", "PESO; OISD-STD-161 (S)", S, {"actionDefaults": {"band": "extreme"}}),
    ("CL-2", "SDS for the product available at the loading bay; hazard labels match", "लोडिंग बे पर उत्पाद का SDS उपलब्ध; खतरे के लेबल मेल खाते हैं", "ஏற்றும் தளத்தில் பொருளின் SDS உள்ளது; ஆபத்து லேபிள்கள் பொருந்துகின்றன", "ಲೋಡಿಂಗ್ ಬೇಯಲ್ಲಿ ಉತ್ಪನ್ನದ SDS ಲಭ್ಯ; ಅಪಾಯ ಲೇಬಲ್ ಹೊಂದಿಕೆ", "MSIHC r.17 Schedule 9 (P)", P, {}),
    ("CL-3", "Hoses and couplings inspected; test date within limit; drip trays placed", "होज़ और कपलिंग जांचे गए; परीक्षण तिथि सीमा में; ड्रिप ट्रे रखी गई", "குழாய்கள் மற்றும் இணைப்புகள் ஆய்வு; சோதனைத் தேதி வரம்பிற்குள்; சொட்டுத் தட்டுகள் வைக்கப்பட்டன", "ಹೋಸ್ ಮತ್ತು ಕಪ್ಲಿಂಗ್ ಪರಿಶೀಲಿತ; ಪರೀಕ್ಷೆ ದಿನಾಂಕ ಮಿತಿಯಲ್ಲಿ; ಡ್ರಿಪ್ ಟ್ರೇ", "Company standard", "company_standard", {}),
    ("CL-4", "Driver and operator in PPE per the SDS; emergency shower and eyewash tested", "SDS के अनुसार चालक और ऑपरेटर पीपीई में; आपातकालीन शॉवर और आईवॉश परीक्षित", "SDS படி ஓட்டுநர் மற்றும் இயக்குபவர் PPE-இல்; அவசர குளியல் மற்றும் கண் கழுவி சோதிக்கப்பட்டது", "SDS ಪ್ರಕಾರ ಚಾಲಕ ಮತ್ತು ಆಪರೇಟರ್ PPE; ತುರ್ತು ಶವರ್ ಮತ್ತು ಐವಾಶ್ ಪರೀಕ್ಷೆ", "MSIHC (P)", P, {}),
    ("CL-5", "Spill kit and fire extinguisher within 15 m; no ignition sources", "15 मीटर के भीतर स्पिल किट और अग्निशामक; कोई आग का स्रोत नहीं", "15 மீ-க்குள் கசிவுக் கருவி மற்றும் தீயணைப்பான்; தீப்பொறி மூலங்கள் இல்லை", "15 ಮೀ ಒಳಗೆ ಸ್ಪಿಲ್ ಕಿಟ್ ಮತ್ತು ಅಗ್ನಿಶಾಮಕ; ಬೆಂಕಿ ಮೂಲ ಇಲ್ಲ", "IS 2190 (V); Petroleum Rules (P)", P, {}),
]
IND_WH = [
    ("WH-1", "Forklift pre-use check done; horn, lights, brakes, forks sound", "फोर्कलिफ्ट पूर्व-उपयोग जांच; हॉर्न, लाइट, ब्रेक, फोर्क ठीक", "ஃபோர்க்லிஃப்ட் முன் சோதனை; ஹார்ன், விளக்குகள், பிரேக், ஃபோர்க் நன்றாக", "ಫೋರ್ಕ್‌ಲಿಫ್ಟ್ ಪೂರ್ವ ಪರಿಶೀಲನೆ; ಹಾರ್ನ್, ಲೈಟ್, ಬ್ರೇಕ್, ಫೋರ್ಕ್ ಸರಿ", "BOCW r.88 model (P); ISO 3691 (V)", V, {"actionDefaults": {"band": "high"}}),
    ("WH-2", "Operator licensed and medically fit; seat belt worn", "ऑपरेटर लाइसेंस प्राप्त और चिकित्सकीय रूप से फिट; सीट बेल्ट लगाई", "இயக்குபவர் உரிமம் பெற்றவர், மருத்துவத் தகுதி; சீட் பெல்ட் அணிந்துள்ளார்", "ಆಪರೇಟರ್ ಪರವಾನಗಿ ಮತ್ತು ವೈದ್ಯಕೀಯ ಯೋಗ್ಯ; ಸೀಟ್ ಬೆಲ್ಟ್", "Company standard", "company_standard", {}),
    ("WH-3", "Racking load notices displayed; no bent uprights or missing safety pins", "रैकिंग भार सूचनाएं प्रदर्शित; कोई मुड़े अपराइट या गायब सेफ्टी पिन नहीं", "ரேக் சுமை அறிவிப்புகள் காட்டப்பட்டன; வளைந்த நெடுக்குகள் அல்லது காணாமல் போன பாதுகாப்பு ஊசிகள் இல்லை", "ರ್ಯಾಕಿಂಗ್ ಲೋಡ್ ಸೂಚನೆ ಪ್ರದರ್ಶಿತ; ಬಾಗಿದ ಅಪ್‌ರೈಟ್ ಅಥವಾ ಕಾಣೆಯಾದ ಸೇಫ್ಟಿ ಪಿನ್ ಇಲ್ಲ", "SEMA / EN 15635 (V)", V, {"actionDefaults": {"band": "high"}}),
    ("WH-4", "Pedestrian walkways marked and kept clear; dock edges guarded", "पैदल रास्ते चिह्नित और साफ; डॉक किनारे सुरक्षित", "நடைபாதைகள் குறிக்கப்பட்டு தெளிவாக; துறை விளிம்புகள் பாதுகாக்கப்பட்டன", "ಪಾದಚಾರಿ ದಾರಿ ಗುರುತಿಸಿ ಖಾಲಿ; ಡಾಕ್ ಅಂಚು ರಕ್ಷಿತ", "IS 7969 (V)", V, {}),
    ("WH-5", "Charging area ventilated; no smoking; eyewash available", "चार्जिंग क्षेत्र हवादार; धूम्रपान निषेध; आईवॉश उपलब्ध", "சார்ஜிங் பகுதி காற்றோட்டம்; புகைபிடித்தல் இல்லை; கண் கழுவி உள்ளது", "ಚಾರ್ಜಿಂಗ್ ಪ್ರದೇಶ ಗಾಳಿಯಾಡುವಂತೆ; ಧೂಮಪಾನ ನಿಷೇಧ; ಐವಾಶ್ ಲಭ್ಯ", "Company standard", "company_standard", {}),
]
IND_POWER = [
    ("PS-1", "Switching under written instruction; permit-to-work issued and received by different persons", "लिखित निर्देश के तहत स्विचिंग; परमिट जारी और प्राप्त करने वाले अलग व्यक्ति", "எழுத்துப்பூர்வ அறிவுறுத்தலின் கீழ் சுவிட்சிங்; அனுமதி வழங்குபவர் மற்றும் பெறுபவர் வெவ்வேறு நபர்கள்", "ಲಿಖಿತ ಸೂಚನೆಯಡಿ ಸ್ವಿಚಿಂಗ್; ಪರವಾನಗಿ ನೀಡುವವರು ಮತ್ತು ಪಡೆಯುವವರು ಬೇರೆ ಬೇರೆ", "CEA 2023 regs (P); OISD-STD-105 (S)", P, {"actionDefaults": {"band": "extreme"}}),
    ("PS-2", "Isolation applied, locked, tagged with date/time; proved dead with a tested voltage detector", "आइसोलेशन लागू, लॉक, दिनांक/समय टैग; परीक्षित वोल्टेज डिटेक्टर से डेड सिद्ध", "தனிமைப்படுத்தல் பூட்டி, தேதி/நேரத்துடன் குறிக்கப்பட்டது; சோதிக்கப்பட்ட மின்னழுத்த கண்டறியால் மின்சாரம் இல்லை என நிரூபிக்கப்பட்டது", "ಐಸೊಲೇಶನ್ ಲಾಕ್, ದಿನಾಂಕ/ಸಮಯ ಟ್ಯಾಗ್; ಪರೀಕ್ಷಿತ ವೋಲ್ಟೇಜ್ ಡಿಟೆಕ್ಟರ್‌ನಿಂದ ಡೆಡ್ ಸಾಬೀತು", "CEA 2023 (P); OSHA 1910.147 model (S)", P, {"actionDefaults": {"band": "extreme"}}),
    ("PS-3", "Earths applied on both sides of the work; discharge of capacitors", "कार्य के दोनों ओर अर्थ लगाए गए; कैपेसिटर डिस्चार्ज", "வேலையின் இருபுறமும் பூமி இணைப்பு; மின்தேக்கிகள் வெளியேற்றம்", "ಕೆಲಸದ ಎರಡೂ ಬದಿ ಅರ್ಥ್; ಕೆಪಾಸಿಟರ್ ಡಿಸ್ಚಾರ್ಜ್", "CEA 2023 (P)", P, {}),
    ("PS-4", "Arc-flash PPE for the incident energy; insulating gloves tested within 6 months", "घटना ऊर्जा के लिए आर्क-फ्लैश पीपीई; इन्सुलेटिंग दस्ताने 6 माह के भीतर परीक्षित", "சம்பவ ஆற்றலுக்கு ஏற்ற ஆர்க்-ஃபிளாஷ் PPE; காப்புக் கையுறைகள் 6 மாதங்களுக்குள் சோதிக்கப்பட்டவை", "ಘಟನಾ ಶಕ್ತಿಗೆ ಆರ್ಕ್-ಫ್ಲಾಶ್ PPE; ಇನ್ಸುಲೇಟಿಂಗ್ ಕೈಗವಸು 6 ತಿಂಗಳೊಳಗೆ ಪರೀಕ್ಷೆ", "NFPA 70E (V); IS 4770 (V)", V, {}),
    ("PS-5", "Insulating mats, danger notices and shock chart at the switchgear", "स्विचगियर पर इन्सुलेटिंग मैट, खतरे की सूचना और शॉक चार्ट", "சுவிட்ச்கியரில் காப்புப் பாய்கள், ஆபத்து அறிவிப்புகள் மற்றும் அதிர்ச்சி விளக்கப்படம்", "ಸ್ವಿಚ್‌ಗೇರ್‌ನಲ್ಲಿ ಇನ್ಸುಲೇಟಿಂಗ್ ಮ್ಯಾಟ್, ಅಪಾಯ ಸೂಚನೆ ಮತ್ತು ಶಾಕ್ ಚಾರ್ಟ್", "CEA 2023 regs 21, 30 (P)", P, {}),
]

TEMPLATES = [
    # code, name (4 langs), type, applies_to, items, frequency hint
    ("T1", {"en": "Daily site walk", "hi": "दैनिक साइट वॉक", "ta": "தினசரி தள நடை", "kn": "ದೈನಂದಿನ ಸೈಟ್ ವಾಕ್"}, "site_walk", {"industries": ["construction", "infrastructure", "manufacturing"]}, T1, "daily"),
    ("T2", {"en": "Scaffold (before use, every 14 days, after heavy rain or storm)", "hi": "मचान (उपयोग से पहले, हर 14 दिन, भारी बारिश या तूफान के बाद)", "ta": "சாரக்கட்டு (பயன்படுத்தும் முன், 14 நாட்களுக்கு ஒருமுறை, கனமழை அல்லது புயலுக்குப் பின்)", "kn": "ಸ್ಕ್ಯಾಫೋಲ್ಡ್ (ಬಳಕೆಗೆ ಮುನ್ನ, ಪ್ರತಿ 14 ದಿನ, ಭಾರೀ ಮಳೆ ಅಥವಾ ಬಿರುಗಾಳಿ ನಂತರ)"}, "scaffold", {"industries": ["construction", "infrastructure"], "areaTypes": ["scaffold_zone"], "assetClasses": ["scaffold"]}, T2, "14 days (company standard)"),
    ("T3", {"en": "Excavation and trench (before each shift)", "hi": "खुदाई और खाई (हर शिफ्ट से पहले)", "ta": "அகழ்வு மற்றும் பள்ளம் (ஒவ்வொரு ஷிப்டுக்கு முன்)", "kn": "ಅಗೆತ ಮತ್ತು ಕಂದಕ (ಪ್ರತಿ ಶಿಫ್ಟ್ ಮೊದಲು)"}, "excavation", {"industries": ["construction", "infrastructure"], "areaTypes": ["excavation_zone"]}, T3, "each shift"),
    ("T4", {"en": "Lifting gear pre-use (each use or shift)", "hi": "लिफ्टिंग गियर पूर्व-उपयोग (हर उपयोग या शिफ्ट)", "ta": "தூக்கும் கருவி முன் சோதனை (ஒவ்வொரு பயன்பாடு அல்லது ஷிப்ட்)", "kn": "ಲಿಫ್ಟಿಂಗ್ ಗೇರ್ ಪೂರ್ವ ಬಳಕೆ (ಪ್ರತಿ ಬಳಕೆ ಅಥವಾ ಶಿಫ್ಟ್)"}, "lifting", {"assetClasses": ["lifting_appliance", "lifting_gear"]}, T4, "each use"),
    ("T5", {"en": "Electrical panel and LOTO (monthly and before maintenance)", "hi": "विद्युत पैनल और LOTO (मासिक और रखरखाव से पहले)", "ta": "மின் பேனல் மற்றும் LOTO (மாதந்தோறும் மற்றும் பராமரிப்புக்கு முன்)", "kn": "ವಿದ್ಯುತ್ ಪ್ಯಾನೆಲ್ ಮತ್ತು LOTO (ಮಾಸಿಕ ಮತ್ತು ನಿರ್ವಹಣೆ ಮೊದಲು)"}, "electrical", {"areaTypes": ["substation", "utilities"], "assetClasses": ["rcd", "earth_pit", "insulating_mat"]}, T5, "monthly"),
    ("T6", {"en": "Fire extinguisher (monthly)", "hi": "अग्निशामक (मासिक)", "ta": "தீயணைப்பான் (மாதந்தோறும்)", "kn": "ಅಗ್ನಿಶಾಮಕ (ಮಾಸಿಕ)"}, "fire_extinguisher", {"assetClasses": ["extinguisher"]}, T6, "monthly (2010 defaults, pending check)"),
    ("T7", {"en": "Housekeeping (weekly)", "hi": "हाउसकीपिंग (साप्ताहिक)", "ta": "சுத்தம் (வாரந்தோறும்)", "kn": "ಮನೆಗೆಲಸ (ಸಾಪ್ತಾಹಿಕ)"}, "housekeeping", {}, T7, "weekly"),
    ("T8", {"en": "PPE (weekly spot check)", "hi": "पीपीई (साप्ताहिक स्पॉट चेक)", "ta": "PPE (வாராந்திர இடச் சோதனை)", "kn": "PPE (ಸಾಪ್ತಾಹಿಕ ಸ್ಪಾಟ್ ಚೆಕ್)"}, "ppe", {}, T8, "weekly"),
    ("T9", {"en": "Hot-work area (before start and at close)", "hi": "हॉट-वर्क क्षेत्र (शुरू से पहले और बंद होने पर)", "ta": "வெப்ப வேலை பகுதி (தொடங்கும் முன் மற்றும் முடிவில்)", "kn": "ಹಾಟ್-ವರ್ಕ್ ಪ್ರದೇಶ (ಪ್ರಾರಂಭಕ್ಕೆ ಮುನ್ನ ಮತ್ತು ಮುಕ್ತಾಯದಲ್ಲಿ)"}, "hot_work", {}, T9, "before start and at close"),
    ("IND_AUTO_PRESS", {"en": "Automotive press shop and robot cell", "hi": "ऑटोमोटिव प्रेस शॉप और रोबोट सेल", "ta": "வாகன பிரஸ் ஷாப் மற்றும் ரோபோ அறை", "kn": "ಆಟೋಮೋಟಿವ್ ಪ್ರೆಸ್ ಶಾಪ್ ಮತ್ತು ರೋಬೋಟ್ ಸೆಲ್"}, "machine", {"industries": ["automotive"]}, IND_AUTO, "each shift"),
    ("IND_FOOD_AMMONIA", {"en": "Food plant: ammonia, CIP and silo entry", "hi": "खाद्य संयंत्र: अमोनिया, CIP और साइलो प्रवेश", "ta": "உணவு ஆலை: அம்மோனியா, CIP மற்றும் சைலோ நுழைவு", "kn": "ಆಹಾರ ಘಟಕ: ಅಮೋನಿಯಾ, CIP ಮತ್ತು ಸಿಲೋ ಪ್ರವೇಶ"}, "process", {"industries": ["food"]}, IND_FOOD, "weekly"),
    ("IND_WIND_CLIMB", {"en": "Wind turbine climb and rescue kit", "hi": "पवन टरबाइन चढ़ाई और बचाव किट", "ta": "காற்றாலை ஏற்றம் மற்றும் மீட்புக் கருவி", "kn": "ಗಾಳಿ ಟರ್ಬೈನ್ ಹತ್ತುವಿಕೆ ಮತ್ತು ರಕ್ಷಣಾ ಕಿಟ್"}, "other", {"industries": ["wind"]}, IND_WIND, "before each climb"),
    ("IND_CHEM_LOADING", {"en": "Chemical loading/unloading and SDS", "hi": "रसायन लोडिंग/अनलोडिंग और SDS", "ta": "வேதிப்பொருள் ஏற்றுதல்/இறக்குதல் மற்றும் SDS", "kn": "ರಾಸಾಯನಿಕ ಲೋಡಿಂಗ್/ಅನ್‌ಲೋಡಿಂಗ್ ಮತ್ತು SDS"}, "chemical", {"industries": ["chemical", "oilgas", "pharma"], "areaTypes": ["loading_bay"]}, IND_CHEM, "each transfer"),
    ("IND_WH_FORKLIFT", {"en": "Warehouse forklift and racking", "hi": "वेयरहाउस फोर्कलिफ्ट और रैकिंग", "ta": "கிடங்கு ஃபோர்க்லிஃப்ட் மற்றும் ரேக்", "kn": "ಗೋದಾಮು ಫೋರ್ಕ್‌ಲಿಫ್ಟ್ ಮತ್ತು ರ್ಯಾಕಿಂಗ್"}, "vehicle", {"industries": ["warehouse"], "assetClasses": ["vehicle"]}, IND_WH, "daily"),
    ("IND_POWER_LOTO", {"en": "Power substation and LOTO", "hi": "पावर सबस्टेशन और LOTO", "ta": "மின் துணை நிலையம் மற்றும் LOTO", "kn": "ವಿದ್ಯುತ್ ಉಪಕೇಂದ್ರ ಮತ್ತು LOTO"}, "electrical", {"industries": ["power"], "areaTypes": ["substation"]}, IND_POWER, "before each job"),
]

# ---------------------------------------------------------------- sample sites (§16.5)

SITES = [
    # code, name, state, district, establishment type, rule set, industry, lat, lng, worker count
    ("TN1", {"en": "Construction site 1", "hi": "निर्माण स्थल 1", "ta": "கட்டுமான தளம் 1", "kn": "ನಿರ್ಮಾಣ ಸ್ಥಳ 1"}, "TN", "Chennai", "construction_site", "BOCW_TN_LEGACY", "construction", 13.0827, 80.2707, 420),
    ("TN2", {"en": "Construction site 2", "hi": "निर्माण स्थल 2", "ta": "கட்டுமான தளம் 2", "kn": "ನಿರ್ಮಾಣ ಸ್ಥಳ 2"}, "TN", "Coimbatore", "construction_site", "BOCW_TN_LEGACY", "construction", 11.0168, 76.9558, 260),
    ("TN3", {"en": "Factory 1", "hi": "फैक्ट्री 1", "ta": "தொழிற்சாலை 1", "kn": "ಕಾರ್ಖಾನೆ 1"}, "TN", "Kancheepuram", "factory", "TN_FACTORY_LEGACY", "manufacturing", 12.8342, 79.7036, 380),
    ("KA1", {"en": "Construction site 3", "hi": "निर्माण स्थल 3", "ta": "கட்டுமான தளம் 3", "kn": "ನಿರ್ಮಾಣ ಸ್ಥಳ 3"}, "KA", "Bengaluru Urban", "construction_site", "BOCW_KA_PROVISIONAL", "construction", 12.9716, 77.5946, 510),
    ("KA2", {"en": "Factory 2", "hi": "फैक्ट्री 2", "ta": "தொழிற்சாலை 2", "kn": "ಕಾರ್ಖಾನೆ 2"}, "KA", "Dakshina Kannada", "hazardous_process_factory", None, "chemical", 12.9141, 74.8560, 190),  # KA_FACTORY_LEGACY: accident clock to be set
]

PRIVACY_NOTICE = {
    "en": "SafeWorks collects your name, employee code, phone and the reports you file to run the safety programme of your employer (DPDP Act 2023). Anonymous reports keep no name. Data is kept for the statutory period and at least one year; you may ask for access, correction or erasure through your HSE manager.",
    "hi": "SafeWorks आपके नियोक्ता के सुरक्षा कार्यक्रम को चलाने के लिए आपका नाम, कर्मचारी कोड, फ़ोन और आपकी रिपोर्टें एकत्र करता है (DPDP अधिनियम 2023)। गुमनाम रिपोर्टों में नाम नहीं रखा जाता। डेटा वैधानिक अवधि तक और कम से कम एक वर्ष रखा जाता है; आप अपने HSE प्रबंधक के माध्यम से पहुंच, सुधार या मिटाने की मांग कर सकते हैं।",
    "ta": "உங்கள் முதலாளியின் பாதுகாப்புத் திட்டத்தை நடத்த SafeWorks உங்கள் பெயர், ஊழியர் குறியீடு, தொலைபேசி மற்றும் நீங்கள் அளிக்கும் அறிக்கைகளைச் சேகரிக்கிறது (DPDP சட்டம் 2023). அநாமதேய அறிக்கைகளில் பெயர் சேமிக்கப்படுவதில்லை. தரவு சட்டக் காலத்திற்கும் குறைந்தது ஒரு ஆண்டிற்கும் வைக்கப்படும்; உங்கள் HSE மேலாளர் மூலம் அணுகல், திருத்தம் அல்லது அழிப்பைக் கோரலாம்.",
    "kn": "ನಿಮ್ಮ ಉದ್ಯೋಗದಾತರ ಸುರಕ್ಷತಾ ಕಾರ್ಯಕ್ರಮ ನಡೆಸಲು SafeWorks ನಿಮ್ಮ ಹೆಸರು, ಉದ್ಯೋಗಿ ಕೋಡ್, ಫೋನ್ ಮತ್ತು ನೀವು ಸಲ್ಲಿಸುವ ವರದಿಗಳನ್ನು ಸಂಗ್ರಹಿಸುತ್ತದೆ (DPDP ಕಾಯ್ದೆ 2023). ಅನಾಮಧೇಯ ವರದಿಗಳಲ್ಲಿ ಹೆಸರು ಇರುವುದಿಲ್ಲ. ದತ್ತಾಂಶವನ್ನು ಶಾಸನಬದ್ಧ ಅವಧಿ ಮತ್ತು ಕನಿಷ್ಠ ಒಂದು ವರ್ಷ ಇಡಲಾಗುತ್ತದೆ; ನಿಮ್ಮ HSE ವ್ಯವಸ್ಥಾಪಕರ ಮೂಲಕ ಪ್ರವೇಶ, ತಿದ್ದುಪಡಿ ಅಥವಾ ಅಳಿಸುವಿಕೆ ಕೇಳಬಹುದು.",
}

TRADES = ["civil", "steel fixing", "shuttering", "scaffolding", "electrical", "welding", "painting", "plumbing", "rigging", "operators", "housekeeping", "security"]

# ---------------------------------------------------------------- demo observations (4 languages)

DEMO_OBSERVATIONS = [
    ("unsafe_condition", ["HEIGHT", "SCAFF"], "en", "Scaffold at Block A level 3 has no mid-rail on the west face; two workers tying rebar at the edge without harness anchorage."),
    ("unsafe_condition", ["ELEC"], "en", "Portable drill cable with exposed copper near the batching plant; no RCD on the distribution board."),
    ("unsafe_act", ["PPE"], "en", "Three workers at the gate without helmets during the afternoon shift change."),
    ("near_miss", ["LIFT"], "en", "Tower crane load swung over the walkway while people were passing; signaller was not in position."),
    ("good_practice", ["HOUSE"], "en", "Stores team cleared the aisle and stacked cement bags to 10 high with walkway tape."),
    ("unsafe_condition", ["EXCAV"], "en", "Trench 2.1 m deep behind the labour camp has vertical sides and spoil on the edge; no ladder for exit."),
    ("unsafe_condition", ["FIRE"], "en", "Extinguisher near the welding bay empty; last inspection tag 4 months old."),
    ("unsafe_condition", ["HOUSE", "CHEM"], "ta", "ஸ்டோர் அருகில் டீசல் டிரம் கசிந்து தரையில் எண்ணெய் பரவியுள்ளது; மணல் போடப்படவில்லை."),
    ("unsafe_act", ["HEIGHT"], "ta", "மூன்றாம் தளத்தில் ஒரு தொழிலாளி ஹார்னஸ் இல்லாமல் விளிம்பில் வேலை செய்கிறார்."),
    ("near_miss", ["VEHICLE"], "ta", "டிப்பர் லாரி பின்னோக்கி வரும்போது பின்பக்க அலாரம் வேலை செய்யவில்லை; ஒருவர் ஓடி தப்பினார்."),
    ("good_practice", ["PPE"], "ta", "வெல்டிங் குழு அனைவரும் முக கவசம் மற்றும் தோல் கையுறையுடன் வேலை செய்தனர்."),
    ("unsafe_condition", ["ELEC"], "kn", "ಬ್ಯಾಚಿಂಗ್ ಪ್ಲಾಂಟ್ ಬಳಿ ವಿದ್ಯುತ್ ಪ್ಯಾನೆಲ್ ಬಾಗಿಲು ತೆರೆದಿದೆ ಮತ್ತು ಮಳೆ ನೀರು ಒಳಗೆ ಹೋಗುತ್ತಿದೆ."),
    ("unsafe_act", ["SCAFF"], "kn", "ಕಾರ್ಮಿಕರು ಟ್ಯಾಗ್ ಇಲ್ಲದ ಸ್ಕ್ಯಾಫೋಲ್ಡ್ ಮೇಲೆ ಕೆಲಸ ಮಾಡುತ್ತಿದ್ದಾರೆ; ಬೇಸ್ ಪ್ಲೇಟ್ ಇಟ್ಟಿಗೆ ಮೇಲೆ ಇದೆ."),
    ("near_miss", ["LIFT"], "kn", "ಕ್ರೇನ್ ಸ್ಲಿಂಗ್‌ನಿಂದ ಪೈಪ್ ಜಾರಿ ಎರಡು ಮೀಟರ್ ದೂರದಲ್ಲಿ ಬಿದ್ದಿತು; ಯಾರಿಗೂ ಗಾಯವಾಗಿಲ್ಲ."),
    ("good_practice", ["HOUSE"], "kn", "ಕ್ಯಾಂಟೀನ್ ಬಳಿ ತ್ಯಾಜ್ಯ ಪ್ರತ್ಯೇಕ ಬಿನ್‌ಗಳಲ್ಲಿ ಹಾಕಲಾಗಿದೆ ಮತ್ತು ನೆಲ ಒಣಗಿದೆ."),
    ("unsafe_condition", ["GUARD"], "hi", "प्रोडक्शन हॉल की लेथ मशीन का चक गार्ड हटा हुआ है और ऑपरेटर बिना चश्मे के काम कर रहा है।"),
    ("unsafe_act", ["PROC"], "hi", "सबस्टेशन में बिना परमिट के पैनल खोला गया; LOTO टैग नहीं लगा।"),
    ("near_miss", ["FIRE"], "hi", "वेल्डिंग की चिंगारी से पास रखे पेंट के डिब्बे पर आग लगते-लगते बची।"),
    ("good_practice", ["HEALTH"], "hi", "कैंटीन में पीने के पानी की टंकी साफ की गई और ओआरएस उपलब्ध कराया गया।"),
    ("unsafe_condition", ["HEAT"], "en", "No shade or water point for the shuttering gang on the roof slab at 2 pm; two workers complained of dizziness."),
    ("unsafe_condition", ["CONFINED"], "en", "Sump pit entry without gas test; attendant absent and no retrieval line."),
    ("unsafe_act", ["VEHICLE"], "en", "Forklift driven with raised forks across the loading bay; pedestrian walkway blocked by pallets."),
    ("unsafe_condition", ["PRESSURE"], "en", "Air receiver safety valve seal broken; gauge reads above the marked limit."),
    ("near_miss", ["CHEM"], "en", "Caustic drum tipped during manual handling at the tank farm; splash missed the operator's face by a hand's width."),
]
