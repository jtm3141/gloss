# gloss web app

A dead-simple dictionary site. Fully static — no server, no tracking. The
dictionary (a gzipped SQLite database built from Open English WordNet) is
downloaded once, decompressed in the browser with sql.js (WebAssembly), and
cached; after that the app works offline.

## Develop

```sh
npm install
npm run dev        # prepare-data runs first, then next dev
```

`npm run prepare-data` copies two build artifacts into `public/` (both are
gitignored, never committed):

- `data/gloss-filtered.db.gz` → `public/gloss.db.gz` — the family-safe
  filtered dictionary. Build it with:
  `python data/make_filtered.py --db data/gloss.db --out data/gloss-filtered.db`
  then gzip it.
- `node_modules/sql.js/dist/sql-wasm.wasm` → `public/sql-wasm.wasm`

## Build & deploy

```sh
npm run build      # static export into out/
```

The export is plain static files, deployable anywhere (Vercel, GitHub Pages,
a USB stick). The repo stays private until release is authorized; no
deployment has been configured yet.

## What's in v1

- Search box with autocomplete suggestions
- `define(word)`: most common sense first, grouped by part of speech, with
  examples and synonyms
- Family-safe data: the filtered build (see `data/README.md` for the content
  policy). The public site never serves the unfiltered database.

Planned next: related-word browsing (synonyms/hypernyms/etc. from the
`relation` table, already shipped in the DB).

## Smoke test

`npm run smoke` loads the real gzipped DB through sql.js (the same path the
browser takes) and runs the app's define/suggest queries against it —
`define('dog')` must return 8 senses, severity-1 survivors (jesus, damn,
nipple) must be present, and slurs (jap) must be absent.
