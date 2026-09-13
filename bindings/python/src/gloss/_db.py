"""gloss Python binding — pure-sqlite3 backend (stdlib only).

The database is gloss.db, built by ../../data/build_db.py from Open English
WordNet. Query semantics mirror the C core exactly (see ../../data/
conformance.json "rules"): define() tries POS in n, v, a, r order and takes
sense #1; lookup() returns senses n/v/a/r, sense_no ascending.
"""

import json
import os
import sqlite3

POS_ORDER = ("n", "v", "a", "r")
REL_CAP = 40


class Related:
    """One related synset: its words (synset order) and its definition."""
    def __init__(self, words, definition):
        self.words = words
        self.definition = definition

    def __repr__(self):
        return f"Related(words={self.words!r})"

    def __eq__(self, other):
        return (isinstance(other, Related) and self.words == other.words
                and self.definition == other.definition)


class Sense:
    def __init__(self, db, pos, sense_no, synset_offset, synset_pos,
                 definition, examples, synonyms):
        self._db = db
        self.pos = pos
        self.sense_no = sense_no
        self.synset_offset = synset_offset
        self.synset_pos = synset_pos
        self.definition = definition
        self.examples = examples
        self.synonyms = synonyms

    def _related(self, ptr):
        return self._db.related(self, ptr)

    def antonyms(self):
        """Synsets pointed to by `!`."""
        return self._related("!")

    def hypernyms(self):
        """Synsets pointed to by `@`."""
        return self._related("@")

    def hyponyms(self):
        """Synsets pointed to by `~`."""
        return self._related("~")

    def __repr__(self):
        return f"Sense({self.pos!r}, #{self.sense_no}, {self.definition[:40]!r}...)"


class Entry:
    def __init__(self, word, senses):
        self.word = word
        self.senses = senses

    def __repr__(self):
        return f"Entry({self.word!r}, {len(self.senses)} senses)"


class Database:
    """A handle on a gloss.db file. One per thread."""

    def __init__(self, path):
        if not os.path.exists(path):
            raise FileNotFoundError(f"gloss.db not found: {path}")
        self._con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        self._con.row_factory = sqlite3.Row

    def close(self):
        self._con.close()

    def _synset_words(self, offset, pos):
        """Surface forms from the data file, in synset word order."""
        return [r[0] for r in self._con.execute(
            "SELECT word FROM synset_word WHERE synset_offset = ? AND pos = ?"
            " ORDER BY word_pos", (offset, pos))]

    @staticmethod
    def _forms(word):
        """Exact form first, then lowercase (data files keep original case)."""
        return (word,) if word.lower() == word else (word, word.lower())

    def define(self, word):
        """The single most common definition, or None for unknown words."""
        for form in self._forms(word):
            for pos in POS_ORDER:
                row = self._con.execute(
                    """SELECT s.definition FROM sense s JOIN lemma l ON l.id = s.lemma_id
                       WHERE l.lemma = ? AND l.pos = ? AND s.sense_no = 1""",
                    (form, pos)).fetchone()
                if row:
                    return row[0]
        return None

    def lookup(self, word):
        """Full entry: every sense. None for unknown words."""
        for form in self._forms(word):
            senses = []
            for pos in POS_ORDER:
                rows = self._con.execute(
                    """SELECT s.sense_no, s.synset_offset, s.pos, s.definition, s.examples
                       FROM sense s JOIN lemma l ON l.id = s.lemma_id
                       WHERE l.lemma = ? AND l.pos = ? ORDER BY s.sense_no""",
                    (form, pos)).fetchall()
                for sense_no, offset, spos, definition, examples in rows:
                    words = self._synset_words(offset, spos)
                    senses.append(Sense(
                        self, pos, sense_no, offset, spos, definition,
                        json.loads(examples),
                        [w for w in words if w.lower() != word.lower()]))
            if senses:
                return Entry(word, senses)  # don't merge exact/lowercase hits
        return None

    def related(self, sense, ptr):
        """Target synsets of one pointer type, by ascending offset."""
        out = []
        rows = self._con.execute(
            """SELECT to_offset, to_pos FROM relation
               WHERE from_offset = ? AND from_pos = ? AND ptr = ?
               ORDER BY to_offset LIMIT ?""",
            (sense.synset_offset, sense.synset_pos, ptr, REL_CAP)).fetchall()
        for to_offset, to_pos in rows:
            definition = self._con.execute(
                "SELECT definition FROM synset WHERE offset = ? AND pos = ?",
                (to_offset, to_pos)).fetchone()[0]
            out.append(Related(self._synset_words(to_offset, to_pos), definition))
        return out

    def search(self, prefix, limit=10):
        """Up to `limit` lemmas starting with prefix, alphabetical."""
        pat = prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        return [r[0] for r in self._con.execute(
            "SELECT DISTINCT lemma FROM lemma WHERE lemma LIKE ? ESCAPE '\\' "
            "ORDER BY lemma LIMIT ?", (pat, limit))]
