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

## Relation counts: WNDB export vs native format (reconciled 2026-09-12)

OEWN publishes 419,168 relations for the 2024 edition (native WN-LMF XML);
the WNDB "legacy applications" export we parse yields 401,653 rows. We
parsed the native XML (`english-wordnet-2024.xml.gz`, a download artifact —
gitignored) and matched every native relation against the built DB, using
`index.sense` sensekeys as the bridge (native synset ids are OEWN-internal,
not WNDB offsets; sense ids embed the Princeton sensekey with `'` escaped
as `-ap-` and `/` as `-sl-`). The gap is fully explained — the export is
not lossy in any way a dictionary app can observe:

- **Synset-level graph: 100% identical.** All 297,150 native synset
  relations have exact WNDB counterparts, including verb "similar" (which
  WNDB spells `$`, verb group) and the meronym/holonym pairs (whose native
  `mero_*`/`holo_*` names point the opposite way from the naive reading —
  verified empirically).
- **628 = inverse rows.** The native format lists both directions of
  entailment (407) and causation (221); WNDB stores the forward pointer
  (`*`, `>`) once. Recoverable by inversion.
- **16,887 = native "other" sense relations** (all verb→noun, e.g.
  americanise→americanisation). Their synset pairs are linked in WNDB as
  `+` (derivation) rows (16,883 of 16,887); WNDB types them `+` and resolves
  word-level endpoints with its own heuristic, so only ~45% share exact
  word numbers. Same links, different typing.

Net: the relation graph a dictionary traverses is complete — synsets match
exactly and every native relation is accounted for. The count gap is typing
and direction conventions, not missing data.

## Known limitations

- `content_flag` is empty in v1: the schema and the build-time filtering
  contract are live, but the taboo-word list still needs to be sourced
  (OEWN incorporates Taboo WordNet material — inspect how it's marked).

## Reproducibility rule

Every `gloss.db` must be traceable: the `meta` table records exactly which
OEWN edition and URL produced it. Never hand-edit the database — fix the
pipeline and rebuild.
