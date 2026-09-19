# gloss Python examples

These scripts use the `gloss` package. From the repo root, either install
it first (`pip install bindings/python`) or point `PYTHONPATH` at the
source tree:

```bash
cd /path/to/gloss
PYTHONPATH=bindings/python/src python3 examples/python/define.py serendipity
PYTHONPATH=bindings/python/src python3 examples/python/suggest.py ser
PYTHONPATH=bindings/python/src python3 examples/python/related.py dog @
```

Tier selection applies to all of them: `full` is the default tier, and
`tiny` is bundled so it works offline immediately. The other tiers
download on first use into the platform cache.

```bash
# use the bundled 1.4 MB tier instead of the default full database
GLOSS_TIER=tiny PYTHONPATH=bindings/python/src python3 examples/python/define.py dog

# point at any database file explicitly (beats the tier system)
GLOSS_DB=/path/to/gloss.db PYTHONPATH=bindings/python/src python3 examples/python/define.py dog
```

## The `gloss` command line

`pip install gloss-dict` also installs a `gloss` command with the same
verbs in every language binding:

```bash
gloss define serendipity      # most common definition
gloss suggest ser             # completions for a prefix
gloss related dog @           # hypernyms of the most common sense
                              # (@ hypernym, ~ hyponym, ! antonym, ...)
gloss download --tier small   # pre-fetch a tier into the cache
```

Global flags: `--db PATH` (explicit database, beats everything),
`--tier NAME` (default `full`).
