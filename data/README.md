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

## Tiers: smaller databases for constrained targets

`make_tier.py` builds a frequency-ranked subset of a full `gloss.db`
(phone bundles, ESP32, …). Lemmas are ranked by an external word-frequency
list and the top N distinct lemmas are kept, with all their POS entries.

```powershell
C:\Users\<user>\miniconda3\python.exe -m pip install wordfreq   # once
C:\Users\<user>\miniconda3\python.exe data\make_tier.py --in data\gloss-filtered.db --out data\gloss-core.db --top-lemmas 5000 --max-senses 2 --drop-examples
```

Knobs: `--top-lemmas N` (default 5000), `--max-senses M` per lemma
(0 = unlimited, default 2), `--drop-examples`. `--freq wordfreq:50000`
is the default ranking source; `--freq-csv words.csv` takes your own list
(one word per line, or `word,rank` with a header).

Integrity guarantees, so tiers stay interchangeable with the full DB:

- `sense_no` values are preserved, never renumbered — a deep link like
  `?define=dog&sense=n1` means the same thing in every tier.
- Relations whose source or target synset was dropped are pruned; the UI
  never renders a chip that leads nowhere.
- `content_flag` rows follow their lemmas / synsets into the tier.
- `meta` gains `tier_*` provenance keys (`tier_name`, `tier_top_lemmas`,
  `tier_max_senses`, `tier_drop_examples`, `tier_frequency_source`,
  `tier_built_at`), and `build_profile` gets a tier suffix
  (e.g. `filtered-top5000-s2-noex`).

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

### Relation pointer directions (for binding authors)

`relation.ptr` stores the raw WNDB pointer symbol; `from_word`/`to_word`
are 1-based word indexes into the source/target synset's word list
(`synset_word.word_pos` is 0-based, so word *n* of a relation maps to
`word_pos = n - 1`; `0` means the whole synset). Directions, verified
2026-09-13 against the native XML (`%p` ≡ native `mero_part`,
`#p` ≡ native `holo_part`):

| ptr | meaning (X = `from_offset` synset) | example |
|---|---|---|
| `%p`, `%m`, `%s` | X **has part/member/substance** Y | car → accelerator; dog → flag (its tail) |
| `#p`, `#m`, `#s` | X **is part/member of** Y | wheel → wheeled vehicle |
| `@`, `@i` | X → hypernym (broader) | dog → canine |
| `~`, `~i` | X → hyponym (narrower) | dog → puppy |
| `!` | X → antonym | good → bad |
| `&` | X → similar | |
| `^` | X → also see | |
| `+` | X → derivationally related form | |
| `=` | X → attribute | |
| `*`, `>` | X → entailment / cause (forward only; invert for the reverse) | |
| `$` | verb group | |
| `\` | derived from adjective | |
| `<` | participle of verb | |
| `;c`/`-c`, `;r`/`-r`, `;u`/`-u` | domain topic/region/usage and their members | |

Note the meronym pair reads backwards from the symbols: `%` points from
the whole to its parts, `#` from the part to the whole.

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
