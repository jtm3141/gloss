# data/

The build pipeline. One command turns the Open English WordNet download into
the canonical `gloss.db`:

```powershell
C:\Users\<user>\miniconda3\python.exe data\build_db.py --download
```

## What it does

1. Downloads the OEWN WNDB zip for the requested `--edition` (default 2024)
   from en-word.net. No scraping — a versioned release artifact.
2. Parses `data.{noun,verb,adj,adv}` (synsets, definitions, examples, raw
   relation pointers) and `index.{noun,verb,adj,adv}` (lemmas, sense ordering).
3. Writes `gloss.db` (SQLite) with tables:
   - `meta` — provenance: source, edition, download URL, build timestamp.
   - `lemma` / `sense` / `synset` — words, their frequency-ordered senses,
     definitions, examples.
   - `relation` — raw WNDB pointers (`@` hypernym, `!` antonym, `~` hyponym,
     `#p` part meronym, …), synset- or word-level.
   - `content_flag` — taboo/offensive markings for build-time filtering.
     Empty in v1 (population is a follow-up); the schema and the filtering
     contract are live from day one.
4. Validates synset counts against the edition's published numbers
   (must match within 1%) and prints a report.

## Known limitations

- The WNDB files are OEWN's "legacy applications" export: they carry
  slightly fewer relations (~401k) than the published native-format count
  (~419k). Synsets match exactly, so the parse is complete — the gap is in
  the export, not the parser. A follow-up is to parse OEWN's native format
  directly and reconcile the two.
- `content_flag` is empty in v1: the schema and the build-time filtering
  contract are live, but the taboo-word list still needs to be sourced
  (OEWN incorporates Taboo WordNet material — inspect how it's marked).

## Reproducibility rule

Every `gloss.db` must be traceable: the `meta` table records exactly which
OEWN edition and URL produced it. Never hand-edit the database — fix the
pipeline and rebuild.
