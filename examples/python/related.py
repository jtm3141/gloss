#!/usr/bin/env python3
"""Related words of the most common sense, via gloss.lookup().

Usage:
    PYTHONPATH=bindings/python/src python3 examples/python/related.py dog @

Or after `pip install gloss-dict`, plain `python3 related.py dog @`.
Pointer types: @ hypernym, ~ hyponym, ! antonym (see the `related` method
on Sense, or gloss.cli.PTR_NAMES for the full list).
"""

import sys

import gloss

word = sys.argv[1] if len(sys.argv) > 1 else "dog"
ptr = sys.argv[2] if len(sys.argv) > 2 else "@"

db = gloss.Database()
entry = db.lookup(word)
if entry is None:
    print(f"{word}: no definition found")
    sys.exit(1)
sense = entry.senses[0]
print(f"{entry.word} ({sense.pos}.{sense.sense_no}): {sense.definition}")
for target in db.related(sense, ptr):
    print(f"  {ptr} {', '.join(target.words)}")
    print(f"     {target.definition}")
