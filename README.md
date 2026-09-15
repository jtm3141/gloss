# gloss

A dead-simple dictionary for everyone, everywhere — powered by Open English WordNet.

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
├── data/           # pipeline: OEWN WNDB -> gloss.db, gloss_lite.bin (+ tests)
├── core/           # C99 engine: gloss.h, gloss.c, sqlite3 amalgam, tests, CMake
├── bindings/
│   ├── python/     # PyPI package gloss-dict (cffi + pure-python fallback)
│   ├── js/         # npm package gloss-dict (TS; node + browser targets)
│   └── cpp/        # gloss.hpp header-only wrapper
├── web/            # Next.js app + /api/v1            (Phase 2)
├── mobile/         # Expo app (iOS + Android)          (Phase 3)
├── desktop/        # Tauri app (Win/Mac/Linux)        (Phase 3)
├── embedded/
│   └── esp32/      # ESP-IDF lite build                (Phase 4)
└── docs/
```

## Data

Built from [Open English WordNet](https://github.com/globalwordnet/english-wordnet)
(CC-BY 4.0) — direct downloads, no scraping. See `ATTRIBUTION.md` and `data/`.

Phone apps ship a taboo-filtered build (content flags are applied at build time;
the canonical DB keeps everything, flagged).

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
