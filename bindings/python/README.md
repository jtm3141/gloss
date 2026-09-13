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
