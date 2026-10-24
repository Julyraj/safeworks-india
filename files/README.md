# Our own copies of documents

The library links every regulation and standard to its **official publisher** (see `src/data/data-docs.js`).
This folder is only for documents we are **allowed to share** ourselves, so they also work offline:

| `share` label in data-docs.js | May we put a copy here? |
| --- | --- |
| `gazette` – Indian rules, notifications and forms published in an Official Gazette | Yes (Copyright Act s.52(1)(q)(i)) |
| `public-domain` – US federal works (OSHA, eCFR) | Yes |
| `open-licence` – e.g. UK Open Government Licence, EUR-Lex | Yes, keep the source and licence note |
| `act` – Indian Acts of a legislature | No (only with our own commentary) |
| `no` – BIS, ISO, NFPA, ASME, API, BS/EN, ANSI standards | No, never |

To add a copy:
1. Download the PDF from the official link and save it here as `<regulation-id>-<short-name>.pdf` (keep each file under 15 MB).
2. In `src/data/data-docs.js`, add `"c": "files/<file name>.pdf"` to that document.
3. Run `python3 build.py` and push. The file is then served with the website, the Android app and the portal's `/library/`.
