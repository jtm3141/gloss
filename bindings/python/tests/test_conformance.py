#!/usr/bin/env python3
"""Conformance test for the gloss Python binding.

Checks every case in data/conformance.json against the pure-sqlite3
backend. Stdlib only — no pytest needed:

    cd bindings/python && python tests/test_conformance.py [path/to/gloss.db]
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))

import gloss  # noqa: E402

DATA = os.path.normpath(os.path.join(HERE, "..", "..", "..", "data"))
failures = []


def check(cond, msg):
    if not cond:
        failures.append(msg)
        print("  FAIL:", msg)


def main():
    db_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(DATA, "gloss.db")
    with open(os.path.join(DATA, "conformance.json"), encoding="utf-8") as f:
        fixture = json.load(f)["cases"]
    gloss.configure(db_path)

    for case in fixture:
        word = case["word"]
        check(gloss.define(word) == case["define"], f"{word}: define() mismatch")
        entry = gloss.lookup(word)
        if not case["senses"]:
            check(entry is None, f"{word}: lookup() should be None")
            continue
        check(entry is not None, f"{word}: lookup() returned None")
        if entry is None:
            continue
        check(len(entry.senses) == len(case["senses"]),
              f"{word}: {len(entry.senses)} senses != {len(case['senses'])}")
        for i, fs in enumerate(case["senses"]):
            if i >= len(entry.senses):
                break
            s, tag = entry.senses[i], f"{word} sense {i + 1}"
            check(s.pos == fs["pos"], f"{tag}: pos")
            check(s.sense_no == fs["sense_no"], f"{tag}: sense_no")
            check(s.definition == fs["definition"], f"{tag}: definition")
            check(s.examples == fs["examples"], f"{tag}: examples")
            check(s.synonyms == fs["synonyms"], f"{tag}: synonyms")
            for rel_name, method in (("antonyms", s.antonyms),
                                     ("hypernyms", s.hypernyms),
                                     ("hyponyms", s.hyponyms)):
                got = [{"words": r.words, "definition": r.definition}
                       for r in method()]
                check(got == fs[rel_name], f"{tag}: {rel_name}")

    check("dog" in gloss.search("dog", 5), "search('dog') should contain 'dog'")

    print(f"\n{len(fixture)} words checked, {len(failures)} failures")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
