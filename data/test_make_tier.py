#!/usr/bin/env python3
"""Tests for data/make_tier.py: selection, presets, integrity, provenance.

Builds a miniature gloss.db (no wordfreq needed -- uses --freq-csv), runs
tiers, and asserts the guarantees documented in make_tier.py.
Run: python3 data/test_make_tier.py
"""

import os
import sqlite3
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "make_tier.py")

SCHEMA = """
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE lemma(id INTEGER PRIMARY KEY, lemma TEXT, pos TEXT);
CREATE TABLE synset(offset INTEGER, pos TEXT, definition TEXT,
                    PRIMARY KEY (offset, pos));
CREATE TABLE sense(id INTEGER PRIMARY KEY, lemma_id INTEGER, pos TEXT,
                   sense_no INTEGER, synset_offset INTEGER, definition TEXT,
                   examples TEXT);
CREATE TABLE relation(id INTEGER PRIMARY KEY, from_offset INTEGER,
                      from_pos TEXT, ptr TEXT, to_offset INTEGER,
                      to_pos TEXT, from_word INTEGER, to_word INTEGER);
CREATE TABLE synset_word(synset_offset INTEGER, pos TEXT, word_pos INTEGER,
                         lemma_id INTEGER, word TEXT);
CREATE TABLE content_flag(lemma_id INTEGER, reason TEXT, source TEXT,
                          source_url TEXT, source_license TEXT, category TEXT,
                          severity INTEGER, source_version TEXT);
CREATE TABLE content_flag_synset(synset_offset INTEGER, pos TEXT, reason TEXT,
                                 source TEXT, source_url TEXT,
                                 source_license TEXT, source_version TEXT);
CREATE INDEX idx_sense_lemma ON sense(lemma_id);
"""

# (lemma, pos, [(sense_no, definition, examples)])
WORDS = [
    ("dog", "n", [(1, "a domesticated canine", '["the dog barked"]'),
                  (2, "a dull unattractive person", "[]"),
                  (3, "a hot dog", "[]")]),
    ("dog", "v", [(1, "to follow persistently", "[]")]),
    ("cat", "n", [(1, "a domesticated feline", '["the cat slept"]'),
                  (2, "a spiteful woman", "[]")]),
    ("serendipity", "n", [(1, "pleasant chance discovery",
                           '["a moment of serendipity"]')]),
    ("zyzzyva", "n", [(1, "a tropical weevil", "[]")]),
]

# frequency rank: dog > cat > serendipity > zyzzyva
FREQ = "dog\ncat\nserendipity\nzyzzyva\n"


def build_mini(path, with_flags=True):
    if os.path.exists(path):
        os.remove(path)
    con = sqlite3.connect(path)
    stmts = [s for s in SCHEMA.split(";")
             if s.strip() and ("content_flag" not in s or with_flags)]
    con.executescript(";\n".join(stmts))
    con.execute("INSERT INTO meta VALUES('build_profile','test-canonical')")
    off, lid, sid = 1000, 0, 0
    for lemma, pos, senses in WORDS:
        lid += 1
        con.execute("INSERT INTO lemma VALUES(?,?,?)", (lid, lemma, pos))
        for sense_no, definition, examples in senses:
            sid += 1
            off += 1
            con.execute("INSERT INTO synset VALUES(?,?,?)",
                        (off, pos, definition))
            con.execute("INSERT INTO sense VALUES(?,?,?,?,?,?,?)",
                        (sid, lid, pos, sense_no, off, definition, examples))
            con.execute("INSERT INTO synset_word VALUES(?,?,?,?,?)",
                        (off, pos, 0, lid, lemma))
    # relation: dog-n1 -> cat-n1 (kept), dog-n1 -> zyzzyva-n1 (dangling for
    # small tiers), plus one pointing at a nonexistent synset (pruned).
    dog_n1 = 1001
    con.execute("INSERT INTO relation VALUES(1,?,?,?, ?,?,?,?)",
                (dog_n1, "n", "@", 1005, "n", 0, 0))
    con.execute("INSERT INTO relation VALUES(2,?,?,?, ?,?,?,?)",
                (dog_n1, "n", "@", 1008, "n", 0, 0))
    con.execute("INSERT INTO relation VALUES(3,?,?,?, ?,?,?,?)",
                (dog_n1, "n", "@", 99999, "n", 0, 0))
    if with_flags:
        con.execute("INSERT INTO content_flag VALUES(?,?,?,?,?,?,?,?)",
                    (2, "test", "t", "u", "l", "c", 2, "v"))
    con.commit()
    con.close()


def run_tier(tmp, args, inp="mini.db"):
    out = os.path.join(tmp, "out.db")
    freq = os.path.join(tmp, "freq.csv")
    with open(freq, "w") as f:
        f.write(FREQ)
    cmd = [sys.executable, SCRIPT, "--in", os.path.join(tmp, inp),
           "--out", out, "--freq-csv", freq, "--force"] + args
    r = subprocess.run(cmd, capture_output=True, text=True)
    assert r.returncode == 0, f"tier failed: {r.stderr}\n{r.stdout}"
    con = sqlite3.connect(out)
    con.row_factory = sqlite3.Row
    return con


def lemmas(con):
    return {r["lemma"] for r in con.execute("SELECT DISTINCT lemma FROM lemma")}


def check_tiny(tmp):
    # preset alone: all 4 mini words fit in top-2000; 1st sense only, no examples
    con = run_tier(tmp, ["--tier", "tiny"])
    assert lemmas(con) == {"dog", "cat", "serendipity", "zyzzyva"}
    assert con.execute("SELECT COUNT(*) FROM sense").fetchone()[0] == 5
    assert all(r[0] == 1 for r in con.execute("SELECT sense_no FROM sense"))
    assert all(r[0] == "[]" for r in con.execute("SELECT examples FROM sense"))
    assert con.execute("SELECT value FROM meta WHERE key='tier_name'").fetchone()[0] == "tiny"
    assert con.execute("SELECT value FROM meta WHERE key='build_profile'").fetchone()[0] == "test-canonical-tiny"
    assert con.execute("SELECT value FROM meta WHERE key='tier_max_senses'").fetchone()[0] == "1"
    con.close()
    # preset + explicit override: top-2 words, still 1 sense, no examples
    con = run_tier(tmp, ["--tier", "tiny", "--top-lemmas", "2"])
    assert lemmas(con) == {"dog", "cat"}, lemmas(con)
    assert con.execute("SELECT COUNT(*) FROM sense").fetchone()[0] == 3
    # dangling relation to zyzzyva pruned; bogus offset pruned
    rels = con.execute("SELECT to_offset FROM relation").fetchall()
    assert {r[0] for r in rels} == {1005}, [r[0] for r in rels]
    # content flag for dog-v (lemma id 2) kept
    assert con.execute("SELECT COUNT(*) FROM content_flag").fetchone()[0] == 1
    con.close()


def check_small(tmp):
    con = run_tier(tmp, ["--tier", "small"])
    # top 5k -> all 4 freq words here; 2 senses max; examples kept
    assert lemmas(con) == {"dog", "cat", "serendipity", "zyzzyva"}
    n = con.execute("SELECT COUNT(*) FROM sense").fetchone()[0]
    assert n == 7, n  # dog-n:2, dog-v:1, cat-n:2, serendipity:1, zyzzyva:1
    ex = con.execute("SELECT examples FROM sense WHERE definition LIKE '%canine%'").fetchone()[0]
    assert ex == '["the dog barked"]', ex
    # sense_no 3 (hot dog) dropped by the cap, but 1 and 2 keep numbers
    assert {r[0] for r in con.execute("SELECT sense_no FROM sense WHERE lemma_id=1")} == {1, 2}
    con.close()


def check_medium(tmp):
    con = run_tier(tmp, ["--tier", "medium"])
    # top 25k -> all 4 freq words; unlimited senses; examples kept
    assert lemmas(con) == {"dog", "cat", "serendipity", "zyzzyva"}
    assert con.execute("SELECT COUNT(*) FROM sense").fetchone()[0] == 8
    assert {r[0] for r in con.execute(
        "SELECT sense_no FROM sense WHERE lemma_id=1")} == {1, 2, 3}
    ex = con.execute(
        "SELECT examples FROM sense WHERE definition LIKE '%canine%'").fetchone()[0]
    assert ex == '["the dog barked"]', ex
    assert con.execute("SELECT value FROM meta WHERE key='tier_name'").fetchone()[0] == "medium"
    assert con.execute("SELECT value FROM meta WHERE key='build_profile'").fetchone()[0] == "test-canonical-medium"
    con.close()


def check_full(tmp):
    con = run_tier(tmp, ["--tier", "full"])
    assert con.execute("SELECT COUNT(*) FROM sense").fetchone()[0] == 8
    assert con.execute("SELECT value FROM meta WHERE key='tier_name'").fetchone()[0] == "full"
    con.close()


def check_no_flag_tables(tmp):
    build_mini(os.path.join(tmp, "mini.db"), with_flags=False)
    con = run_tier(tmp, ["--tier", "tiny", "--top-lemmas", "2"])
    assert lemmas(con) == {"dog", "cat"}
    assert "content_flag" not in {r[0] for r in
           con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    con.close()


def check_explicit_override(tmp):
    build_mini(os.path.join(tmp, "mini.db"))
    # explicit flags override the preset
    con = run_tier(tmp, ["--tier", "tiny", "--max-senses", "2"])
    n = con.execute("SELECT COUNT(*) FROM sense").fetchone()[0]
    assert n == 7, n  # dog-n:2, dog-v:1, cat-n:2, serendipity:1, zyzzyva:1
    con.close()


def main():
    with tempfile.TemporaryDirectory() as tmp:
        build_mini(os.path.join(tmp, "mini.db"))
        check_tiny(tmp)
        print("tiny preset ok")
    with tempfile.TemporaryDirectory() as tmp:
        build_mini(os.path.join(tmp, "mini.db"))
        check_small(tmp)
        print("small preset ok")
    with tempfile.TemporaryDirectory() as tmp:
        build_mini(os.path.join(tmp, "mini.db"))
        check_medium(tmp)
        print("medium preset ok")
    with tempfile.TemporaryDirectory() as tmp:
        build_mini(os.path.join(tmp, "mini.db"))
        check_full(tmp)
        print("full preset ok")
    with tempfile.TemporaryDirectory() as tmp:
        check_no_flag_tables(tmp)
        print("no-flag-tables ok")
    with tempfile.TemporaryDirectory() as tmp:
        build_mini(os.path.join(tmp, "mini.db"))
        check_explicit_override(tmp)
        print("explicit-override ok")
    print("ALL TIER TESTS PASSED")


if __name__ == "__main__":
    main()
