#!/usr/bin/env python3
"""Generate data/conformance.json — the shared oracle for every gloss binding.

For each word: define() (single most common definition) and lookup() (all
senses with examples, synonyms, and key relations). Every binding (C, C++,
Python, JS, ...) must reproduce this file byte-for-byte in meaning.

Rules (bindings must implement exactly these):
- define(word): the word is tried as given, then lowercased (data files keep
  original case: "French leave"); senses are frequency-ordered; try POS in
  order n, v, a, r and return the definition of sense #1 of the first POS
  that has the word. Unknown word -> null. Don't merge exact/lowercase hits.
- Sense order in lookup: n, then v, then a, then r; sense_no ascending.
- synonyms: the other words in the same synset (data-file surface forms, in
  synset word order), excluding the query word itself (case-insensitive).
- Relations (antonyms/hypernyms/hyponyms): target synsets ordered by
  (to_offset); each gives its words in synset word order + its definition.
  Capped at 40 entries per relation per sense (deterministic truncation).
"""

import datetime as dt
import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
POS_ORDER = ["n", "v", "a", "r"]
REL_CAP = 40

WORDS = [
    # nouns
    "dog", "cat", "love", "time", "water", "computer", "tree", "book",
    "house", "car", "music", "science", "philosophy", "serendipity",
    "hot dog", "sun", "fish",
    # verbs
    "run", "eat", "think", "know", "go", "make", "breathe", "set",
    # adjectives
    "happy", "beautiful", "big", "small", "good", "bad",
    # adverbs
    "quickly", "very",
    # edge cases
    "a",                      # single letter
    "take a breath",          # multiword verb
    "antidisestablishmentarianism",
    "French leave",           # data files keep original case; index is lowercase
    "xyzzy",                  # unknown word -> null / []
]

REL_PTR = {"antonyms": "!", "hypernyms": "@", "hyponyms": "~"}


def words_of(con, offset, pos):
    """Surface forms from the data file, in synset word order."""
    return [r[0] for r in con.execute(
        "SELECT word FROM synset_word WHERE synset_offset = ? AND pos = ?"
        " ORDER BY word_pos", (offset, pos))]


def _word_forms(word):
    """Exact form first, then lowercase (data files keep original case)."""
    forms = [word]
    if word.lower() != word:
        forms.append(word.lower())
    return forms


def definition_of(con, offset, pos):
    row = con.execute("SELECT definition FROM synset WHERE offset = ? AND pos = ?",
                      (offset, pos)).fetchone()
    return row[0] if row else ""


def define(con, word):
    for form in _word_forms(word):
        for pos in POS_ORDER:
            row = con.execute(
                """SELECT s.definition FROM sense s JOIN lemma l ON l.id = s.lemma_id
                   WHERE l.lemma = ? AND l.pos = ? AND s.sense_no = 1""",
                (form, pos)).fetchone()
            if row:
                return row[0]
    return None


def lookup(con, word):
    senses = []
    for form in _word_forms(word):
        found = False
        for pos in POS_ORDER:
            rows = con.execute(
                """SELECT s.sense_no, s.synset_offset, s.pos, s.definition, s.examples
                   FROM sense s JOIN lemma l ON l.id = s.lemma_id
                   WHERE l.lemma = ? AND l.pos = ? ORDER BY s.sense_no""",
                (form, pos)).fetchall()
            if rows:
                found = True
            for sense_no, offset, spos, definition, examples in rows:
                all_words = words_of(con, offset, spos)
                entry = {
                    "pos": pos,
                    "sense_no": sense_no,
                    "definition": definition,
                    "examples": json.loads(examples),
                    "synonyms": [w for w in all_words if w.lower() != word.lower()],
                }
                for rel_name, ptr in REL_PTR.items():
                    targets = con.execute(
                        """SELECT to_offset, to_pos FROM relation
                           WHERE from_offset = ? AND from_pos = ? AND ptr = ?
                           ORDER BY to_offset LIMIT ?""",
                        (offset, spos, ptr, REL_CAP)).fetchall()
                    entry[rel_name] = [
                        {"words": words_of(con, to_off, to_pos),
                         "definition": definition_of(con, to_off, to_pos)}
                        for to_off, to_pos in targets
                    ]
                senses.append(entry)
        if found:
            break  # don't merge exact-form and lowercase hits
    return senses


def main():
    db_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "gloss.db")
    out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "conformance.json")
    con = sqlite3.connect(db_path)
    edition = con.execute("SELECT value FROM meta WHERE key='oewn_edition'").fetchone()[0]
    cases = [{"word": w, "define": define(con, w), "senses": lookup(con, w)} for w in WORDS]
    doc = {
        "meta": {
            "oewn_edition": edition,
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "db": os.path.basename(db_path),
        },
        "rules": {
            "define_pos_order": POS_ORDER,
            "sense_order": "n, v, a, r; sense_no ascending",
            "synonyms": "other words in the same synset, synset word order, excluding the query word",
            "relations": "target synsets by ascending offset; words in synset order; capped at %d" % REL_CAP,
        },
        "cases": cases,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    n_senses = sum(len(c["senses"]) for c in cases)
    print(f"wrote {out_path}: {len(cases)} words, {n_senses} senses "
          f"({os.path.getsize(out_path) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
