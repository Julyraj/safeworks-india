"""Default areas per industry family (brief §16.5) used by the site setup wizard and the seed."""
from __future__ import annotations

CONSTRUCTION_AREAS = [
    ("GATE", {"en": "Gate", "hi": "गेट", "ta": "நுழைவாயில்", "kn": "ಗೇಟ್"}, "gate"),
    ("STORE", {"en": "Stores and laydown", "hi": "स्टोर और लेडाउन", "ta": "கிடங்கு மற்றும் பொருள் வைப்பு", "kn": "ಸ್ಟೋರ್ ಮತ್ತು ಲೇಡೌನ್"}, "store"),
    ("BLKA", {"en": "Block A levels", "hi": "ब्लॉक A स्तर", "ta": "பிளாக் A தளங்கள்", "kn": "ಬ್ಲಾಕ್ A ಮಹಡಿಗಳು"}, "production"),
    ("SCAF", {"en": "Scaffold zone", "hi": "मचान क्षेत्र", "ta": "சாரக்கட்டு பகுதி", "kn": "ಸ್ಕ್ಯಾಫೋಲ್ಡ್ ವಲಯ"}, "scaffold_zone"),
    ("EXCV", {"en": "Excavation zone", "hi": "खुदाई क्षेत्र", "ta": "அகழ்வுப் பகுதி", "kn": "ಅಗೆತ ವಲಯ"}, "excavation_zone"),
    ("BATCH", {"en": "Batching plant", "hi": "बैचिंग प्लांट", "ta": "கலவை ஆலை", "kn": "ಬ್ಯಾಚಿಂಗ್ ಪ್ಲಾಂಟ್"}, "utilities"),
    ("OFF", {"en": "Office", "hi": "कार्यालय", "ta": "அலுவலகம்", "kn": "ಕಚೇರಿ"}, "office"),
    ("CANT", {"en": "Canteen", "hi": "कैंटीन", "ta": "உணவகம்", "kn": "ಕ್ಯಾಂಟೀನ್"}, "canteen"),
    ("CAMP", {"en": "Labour camp", "hi": "श्रमिक शिविर", "ta": "தொழிலாளர் முகாம்", "kn": "ಕಾರ್ಮಿಕ ಶಿಬಿರ"}, "labour_camp"),
]

FACTORY_AREAS = [
    ("GATE", {"en": "Gate", "hi": "गेट", "ta": "நுழைவாயில்", "kn": "ಗೇಟ್"}, "gate"),
    ("PROD", {"en": "Production hall", "hi": "उत्पादन हॉल", "ta": "உற்பத்தி மண்டபம்", "kn": "ಉತ್ಪಾದನಾ ಹಾಲ್"}, "production"),
    ("UTIL", {"en": "Utilities", "hi": "यूटिलिटीज़", "ta": "பயன்பாட்டு சேவைகள்", "kn": "ಯುಟಿಲಿಟಿಗಳು"}, "utilities"),
    ("SUB", {"en": "Substation", "hi": "सबस्टेशन", "ta": "துணை மின்நிலையம்", "kn": "ಉಪಕೇಂದ್ರ"}, "substation"),
    ("STORE", {"en": "Stores", "hi": "स्टोर", "ta": "கிடங்கு", "kn": "ಸ್ಟೋರ್"}, "store"),
    ("LOAD", {"en": "Loading bay", "hi": "लोडिंग बे", "ta": "ஏற்றும் தளம்", "kn": "ಲೋಡಿಂಗ್ ಬೇ"}, "loading_bay"),
    ("CANT", {"en": "Canteen", "hi": "कैंटीन", "ta": "உணவகம்", "kn": "ಕ್ಯಾಂಟೀನ್"}, "canteen"),
    ("OFF", {"en": "Office", "hi": "कार्यालय", "ta": "அலுவலகம்", "kn": "ಕಚೇರಿ"}, "office"),
]

EXTRA_AREAS = {
    "warehouse": [("RACK", {"en": "Racking aisles", "hi": "रैकिंग गलियारे", "ta": "ரேக் நடைபாதைகள்", "kn": "ರ್ಯಾಕಿಂಗ್ ಹಾದಿಗಳು"}, "store"),
                  ("YARD", {"en": "Yard", "hi": "यार्ड", "ta": "முற்றம்", "kn": "ಯಾರ್ಡ್"}, "yard")],
    "chemical": [("TANK", {"en": "Tank farm", "hi": "टैंक फार्म", "ta": "தொட்டி வளாகம்", "kn": "ಟ್ಯಾಂಕ್ ಫಾರ್ಮ್"}, "yard")],
    "food": [("COLD", {"en": "Cold store and ammonia plant", "hi": "कोल्ड स्टोर और अमोनिया प्लांट", "ta": "குளிர் கிடங்கு மற்றும் அம்மோனியா ஆலை", "kn": "ಶೀತಲ ಸಂಗ್ರಹ ಮತ್ತು ಅಮೋನಿಯಾ ಘಟಕ"}, "utilities")],
    "power": [("SWYD", {"en": "Switchyard", "hi": "स्विचयार्ड", "ta": "சுவிட்ச்யார்டு", "kn": "ಸ್ವಿಚ್‌ಯಾರ್ಡ್"}, "substation")],
    "wind": [("TURB", {"en": "Turbine platform", "hi": "टरबाइन प्लेटफ़ॉर्म", "ta": "விசையாழி தளம்", "kn": "ಟರ್ಬೈನ್ ವೇದಿಕೆ"}, "other")],
    "automotive": [("PRESS", {"en": "Press shop", "hi": "प्रेस शॉप", "ta": "பிரஸ் ஷாப்", "kn": "ಪ್ರೆಸ್ ಶಾಪ್"}, "production"),
                   ("ROBOT", {"en": "Robot cell", "hi": "रोबोट सेल", "ta": "ரோபோ அறை", "kn": "ರೋಬೋಟ್ ಸೆಲ್"}, "production")],
}

CONSTRUCTION_INDUSTRIES = {"construction", "infrastructure", "solar", "wind"}


def default_areas(industry_code: str | None) -> list[tuple[str, dict, str]]:
    base = CONSTRUCTION_AREAS if (industry_code in CONSTRUCTION_INDUSTRIES) else FACTORY_AREAS
    return list(base) + EXTRA_AREAS.get(industry_code or "", [])
