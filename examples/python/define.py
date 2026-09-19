#!/usr/bin/env python3
"""gloss.define() — the single most common definition of a word.

Usage:
    PYTHONPATH=bindings/python/src python3 examples/python/define.py serendipity

Or after `pip install gloss-dict`, plain `python3 define.py serendipity`.
"""

import sys

import gloss

word = sys.argv[1] if len(sys.argv) > 1 else "serendipity"
definition = gloss.define(word)
if definition is None:
    print(f"{word}: no definition found")
    sys.exit(1)
print(f"{word}: {definition}")
