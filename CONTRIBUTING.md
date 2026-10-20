# Contributing

Corrections to legal references, thresholds and state-rule form numbers are the most valuable contributions.

1. Edit the relevant file in `src/data/` — every entry is a plain JavaScript object; keep the existing field names.
2. Add the source (act/rule/section, gazette notification number or standard clause) in the entry's `refs`, `key` or `note` field so the figure can be traced.
3. Run `python3 build.py` and open `index.html` to check the page renders (there is no framework — the page is static HTML with vanilla JavaScript).
4. Open a pull request describing what changed and why, with the source.

Please do not add content that cannot be traced to a regulation, recognised standard or published guidance. First-aid content must follow current ILCOR/AHA/ERC or national resuscitation guidance.
