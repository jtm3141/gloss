# gloss-dict

The Python binding for **gloss** — a dead-simple dictionary powered by Open
English WordNet.

```python
import gloss
gloss.define("dog")   # 'a member of the genus Canis ...'  (full tier, the default)
gloss.define("dog", tier="tiny")   # the 1.4 MB bundled tier — works offline
gloss.configure("/path/to/gloss.db")  # or set GLOSS_DB to an explicit file
entry = gloss.lookup("dog")
entry.senses[0].synonyms          # ['dog', ...] in synset order, minus 'dog'
entry.senses[0].hypernyms()       # [Related(words=[...], definition='...')]
```

Database tiers: `tiny` (bundled, 1.4 MB), `small` (5.5 MB), `medium`
(27 MB), `full` (74 MB, the default). Pick one with the `tier=` argument,
`--tier` on the `gloss` CLI, or `GLOSS_TIER`; anything not bundled
downloads on first use into the platform cache (see
`data/tiers/TIERS.md`), or pre-fetch it with `gloss download --tier small`.
`GLOSS_DB` (or `--db`) points at an explicit file and beats the tier
system. `GLOSS_OFFLINE=1` disables downloading.

Zero dependencies: the v1 backend is pure `sqlite3` from the standard
library. (A compiled-core backend via cffi is planned; the API won't change.)

## Dictionary data licensing

Definitions come from [Open English WordNet](https://github.com/globalwordnet/english-wordnet)
(CC-BY 4.0): free to reuse, even commercially, **with credit** — keep a line like
"via gloss · Open English WordNet (CC-BY 4.0)" on anything you copy or redistribute.
Full attribution, citations, and source links: `ATTRIBUTION.md` (repo root), or the
License page on the gloss website.
