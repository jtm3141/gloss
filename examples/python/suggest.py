#!/usr/bin/env python3
"""gloss.search() — up to N lemmas starting with a prefix, alphabetical.

Usage:
    PYTHONPATH=bindings/python/src python3 examples/python/suggest.py ser

Or after `pip install gloss-dict`, plain `python3 suggest.py ser`.
"""

import sys

import gloss

prefix = sys.argv[1] if len(sys.argv) > 1 else "ser"
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10
for word in gloss.search(prefix, limit):
    print(word)
