# gloss-dict

The Python binding for **gloss** — a dead-simple dictionary powered by Open
English WordNet.

```python
import gloss
gloss.configure("/path/to/gloss.db")  # or set GLOSS_DB, or keep data/gloss.db nearby
gloss.define("dog")   # 'a member of the genus Canis ...'
entry = gloss.lookup("dog")
entry.senses[0].synonyms          # ['dog', ...] in synset order, minus 'dog'
entry.senses[0].hypernyms()       # [Related(words=[...], definition='...')]
```

Zero dependencies: the v1 backend is pure `sqlite3` from the standard
library. (A compiled-core backend via cffi is planned; the API won't change.)

## Dictionary data licensing

Definitions come from [Open English WordNet](https://github.com/globalwordnet/english-wordnet)
(CC-BY 4.0): free to reuse, even commercially, **with credit** — keep a line like
"via gloss · Open English WordNet (CC-BY 4.0)" on anything you copy or redistribute.
Full attribution, citations, and source links: `ATTRIBUTION.md` (repo root), or the
License page on the gloss website.
