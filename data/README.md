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
  americanise→americanisation). 16,883 of 16,887 have some WNDB `+`
  (derivation) row between the same synset pair; 4 have no WNDB pointer
  between the pair at all. Of the full 16,887, only 7,674 (45.4%) match
  the native word-level endpoints exactly. WNDB’s word numbers are its own
  convention and do not reproduce native sense endpoints — and this
  endpoint-mismatch pattern holds across lexical relation types
  (derivation 39,284 matched / 35,362 mismatched; antonym 5,764 / 2,232;
  pertainym 5,477 / 2,595; "also" 292 / 856; exemplifies and inverse
  156 / 6,441 each; participle 47 / 26; native "similar" 0 / 2).

Net: the *synset-level* relation graph reconciles cleanly, but WNDB does
not faithfully preserve native sense-level relation typing or endpoints.
A dictionary traversing synset-to-synset links loses nothing; faithful
word-level lexical relations require parsing the native WN-LMF XML.
The count gap is mostly typing and direction conventions — but the
endpoint fidelity gap is real and is not hand-waved away.

## Content flags (taboo/offensive filtering)

The canonical DB keeps every entry and flags taboo/offensive ones;
filtered builds (phone apps) remove flagged entries at build time.
Two tables:

- `content_flag(lemma_id, reason, source, category, severity, source_version,
  source_url, source_license)` — lemma-level: the whole headword is taboo
  (curated profanity lists). Every row carries full provenance.
- `content_flag_synset(synset_offset, pos, reason, source, source_url,
  source_license, source_version)` — sense-level: one synset is taboo
  (OEWN's own usage signals), likewise fully provenanced. Sense-aware flagging is
  what keeps "boy" definable: only its slur sense is flagged, its 3 clean
  senses survive.

Pipeline:

    python data/build_db.py --download      # schema + full data
    python data/build_flags.py              # populate flags (downloads versioned lists)
    python data/test_safety.py              # safety suite (must be green)
    python data/make_filtered.py --db data/gloss.db --out data/gloss-filtered.db

Current population (OEWN 2024): 248 lemma flags (213 dsojevic/profanity-list
MIT, 34 LDNOOBW CC-BY-4.0, 1 OEWN slur-domain) + 43 synset flags
(42 OEWN usage-label, 1 OEWN slur-domain).

Filtering policy (`data/make_filtered.py`, `DEFAULT_POLICY`): OEWN's own
flags (usage-label, slur-domain) are always applied — they are sense-aware
and authoritative, so genuine slur senses are removed under any settings.
Third-party list flags are configurable: dsojevic/profanity-list applies at
severity >= 2 by default, so the 32 severity-1 "mild" lemma flags (damn,
hell, penis, jesus, ...) are retained — a dictionary that cannot define
*jesus* or *hell* is broken. Misrated slurs among them (jap, kraut, wog)
are still removed: their only senses are caught by the OEWN synset tier,
so the lemmas orphan out. `--dsojevic-min-severity 1` restores
remove-everything; `--no-ldnoobw` skips LDNOOBW. The effective policy is
stamped into the filtered DB's `meta.content_policy`.

Default-policy filtered build removes 268 lemmas, 411 senses, 144 synsets,
957 relations; foreign-key clean.
Design rules: anchored whole-headword matching only (never substring —
"sparse", "manuscript", "Scunthorpe" stay safe); dsojevic `exceptions`
honored; plain `(slang)` labels are not offensive; source URL/license/
version recorded on every flag row. The ethnic-slur usage domain is
resolved per synset, not blanket-applied: OEWN links synsets (not
senses) to the domain, so a neutrally-defined synset in the domain is
routed by audit — whole-synset only when every member is a slur in
that sense (redneck/cracker), lemma-level otherwise ('blackamoor'
flagged, neutral 'black person' survives). Unlisted cases fail the
build rather than silently dropping neutral content.

## Known limitations

- Severity ratings come from dsojevic/profanity-list, where most entries
  default to severity 3 — recorded, not trusted as ground truth. dsojevic
  rates 'jap', 'kraut', and 'wog' as severity 1 (mild), so severity never
  gates slur removal: the OEWN synset tier catches those senses regardless.

## Reproducibility rule

Every `gloss.db` must be traceable: the `meta` table records exactly which
OEWN edition and URL produced it. Never hand-edit the database — fix the
pipeline and rebuild.
