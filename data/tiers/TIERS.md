# gloss database tiers

One dictionary, four sizes. Every tier is a real `gloss.db` built from the
same family-safe filtered database by `data/make_tier.py` — never fabricated
data, just fewer words. Sense numbers are never renumbered, so a deep link
like `?define=dog&sense=n1` means the same thing in every tier.

| tier     | what's in it                                              | size   |
|----------|-----------------------------------------------------------|--------|
| `tiny`   | 2,000 most frequent words, 1st sense only, no examples     | 1.4 MB |
| `small`  | 5,000 most frequent words, top 2 senses, with examples     | 5.5 MB |
| `medium` | 25,000 most frequent words, all senses                    | 27 MB  |
| `full`   | the complete database, unchanged                          | 74 MB  |

`full` is the **default** tier everywhere. `tiny` is small enough to bundle
inside every language package, so a fresh install works offline immediately;
the larger tiers download on first use.

## Building tiers

```bash
python data/make_tier.py --in data/gloss-filtered.db --out data/tiers/gloss-tiny.db --tier tiny
```

`--tier tiny|small|medium|full` is a preset for `--top-lemmas`,
`--max-senses`, `--drop-examples`; explicit flags override the preset.
`--tier full` copies the input unchanged (it just stamps tier provenance
into `meta`). Every tier records `tier_name` and `tier_*` keys in `meta`
and gets a `build_profile` suffix (`filtered-tiny`, …).

The release checklist for a data update:

1. Rebuild the filtered DB (`data/README.md`), then all four tiers.
2. Upload the four `gloss-<tier>.db` files to a GitHub release
   (see `base_url` in `data/tiers/manifest.json`).
3. Update `manifest.json` with the new sizes and SHA-256 hashes.

## Tier selection (all languages)

Every binding implements the same resolution, in this order:

1. **Explicit path wins.** `GLOSS_DB=/path/to/db`, or `configure(path)` /
   `--db` / the constructor argument. Used exactly as given; no tier logic.
2. **Tier name.** `GLOSS_TIER=tiny|small|medium|full`, or `--tier` on the
   CLI, or the `tier=` API parameter. Default: `full`.
3. **Find the file.** Look for `gloss-<tier>.db` in:
   - the package's bundled data (only `tiny` ships bundled),
   - the platform cache dir (`~/.cache/gloss`, `~/Library/Caches/gloss`,
     or `%LOCALAPPDATA%\gloss\Cache`).
4. **Download if missing.** Fetch `<base_url>/gloss-<tier>.db` from
   `data/tiers/manifest.json`, verify the SHA-256, store it in the cache.
   `GLOSS_MIRROR` overrides `base_url`; `GLOSS_OFFLINE=1` disables
   downloading (resolution then fails with a helpful error instead of
   hanging on a network call).

`GLOSS_DB` beats `GLOSS_TIER` when both are set. An unknown tier name is
an error, not a guess.

## The `gloss` command line

Every language package ships a `gloss` CLI with the same verbs:

```text
gloss define serendipity      # most common definition
gloss suggest ser             # completions for a prefix
gloss related dog @           # hypernyms of the most common sense
                              # (@ hypernym, ~ hyponym, ! antonym, …)
gloss download --tier small   # pre-fetch a tier into the cache
```

Global flags: `--db PATH` (explicit database, beats everything),
`--tier NAME` (default `full`). `gloss download` defaults to the
currently selected tier.

## API sketch

```python
import gloss
gloss.define("dog")                       # full tier (default)
gloss.define("dog", tier="tiny")          # or GLOSS_TIER=tiny
db = gloss.Database(tier="small")         # explicit handle
gloss.download("medium")                  # pre-fetch into the cache
```

The C core stays path-based (`gloss_open(path)`) — tier resolution lives
in the CLI example and the higher-level bindings, not in the C library.
Embedded targets bundle whichever tier fits and pass its path directly.
