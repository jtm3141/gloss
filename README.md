# gloss

A free, open-source dictionary for everyone — powered by Open English WordNet.

```python
import gloss
gloss.define("dog")   # the most common definition, no fuss
gloss.lookup("dog")   # everything: senses, examples, synonyms, antonyms,
                      # hypernyms, hyponyms — the full nym zoo
```

One dataset, one engine, many surfaces: a Python build pipeline compiles Open
English WordNet into a canonical SQLite database (`gloss.db`); a small C99 core
owns all query logic; every app and language binding is a thin layer over those
two. Offline-first, everywhere.

## Layout

```
gloss/
├── ATTRIBUTION.md  LICENSE  README.md
├── data/           # pipeline: OEWN WNDB -> gloss.db, tiers (+ tests)
├── core/           # C99 engine: gloss.h, gloss.c, sqlite3 amalgam, tests, CMake
├── bindings/
│   ├── python/     # PyPI package gloss-dict (cffi + pure-python fallback)
│   ├── js/         # npm package gloss-dict (TS; node + browser targets)
│   └── cpp/        # gloss.hpp header-only wrapper
├── web/            # Next.js app + /api/v1 (live on Vercel)
└── desktop/        # Electron app (Win/Mac/Linux) — same files as the website
```

## Status

Done: the C99 core and all three bindings, the website (live), and the
desktop app (0.1.0 installers for Windows, Mac, and Linux). Not started:
a mobile app. Shelved: the ESP32 build (display hardware fault —
restarts only with a working unit).

## Data

Built from [Open English WordNet](https://github.com/globalwordnet/english-wordnet)
(CC-BY 4.0) — direct downloads, no scraping. See `ATTRIBUTION.md` and `data/`.

Phone apps ship a taboo-filtered build (content flags are applied at build time;
the canonical DB keeps everything, flagged).

## Database tiers

One dictionary, four sizes — `tiny` (1.4 MB), `small` (5.5 MB), `medium`
(27 MB), `full` (74 MB, the default). Every tier is a real `gloss.db`;
sense numbers are never renumbered, so deep links work in every tier.
Select with `GLOSS_TIER`, `--tier`, or `GLOSS_DB`; larger tiers download
on first use. See [`data/tiers/TIERS.md`](data/tiers/TIERS.md).

## Rebuilding the database

```powershell
C:\Users\<user>\miniconda3\python.exe data\build_db.py --download
```

## License

Our code: MIT (see `LICENSE`). Dictionary data: CC-BY 4.0 Open English WordNet
(see `ATTRIBUTION.md`, or the License page on the gloss website).

The definitions are free to reuse — including commercially — with credit: keep
a line like "via gloss · Open English WordNet (CC-BY 4.0)" on anything you copy
or redistribute.
