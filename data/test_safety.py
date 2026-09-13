#!/usr/bin/env python3
"""Safety tests for the taboo/offensive filtering pipeline.

Run against a flagged canonical DB:

    python data/test_safety.py --db data/gloss.db

Checks:
  1. Flags are populated from every expected source.
  2. Known profanities are lemma-flagged.
  3. Known-benign words (the Scunthorpe cases) are NOT flagged.
  4. Sense-aware: 'boy' keeps its clean senses; only its slur synset is
     synset-flagged.
  5. make_filtered.py output: no flagged content survives, the graph stays
     referentially sound, and ordinary words are untouched.

Exit nonzero on the first failure.
"""

import argparse
import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import make_filtered

# Must exist as lemmas AND be flagged. Kept tight and unambiguous.
KNOWN_FLAGGED = [
    "fuck", "shit", "bitch", "bastard", "asshole", "dick", "pussy",
    "cunt", "whore", "slut", "nigger", "faggot", "kike", "chink",
    "spic", "twat",
]

# Must exist as lemmas and must NOT be flagged (substring/exception traps).
SCUNTHORPE_SAFE = [
    "sparse",      # 'arse' exception sp*
    "assassin",    # contains 'ass'
    "arsenal",     # 'arse' exception *n
    "manuscript",  # 'anus' exception m*cript
    "cocktail",    # contains 'cock'
    "therapist",   # contains 'the rapist' split
]

EXPECTED_SOURCES = {
    "dsojevic/profanity-list", "LDNOOBW", "oewn-usage-label", "oewn-slur-domain",
}


def check(cond, msg):
    print(("  ok  " if cond else "  FAIL") + f" {msg}")
    if not cond:
        raise SystemExit(f"SAFETY TEST FAILED: {msg}")


def lemma_id(con, word):
    r = con.execute("SELECT id FROM lemma WHERE lemma = ?", (word,)).fetchone()
    return r[0] if r else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/gloss.db")
    args = ap.parse_args()
    con = sqlite3.connect(args.db)

    print("== 1. flag sources ==")
    n_flag = con.execute("SELECT COUNT(*) FROM content_flag").fetchone()[0]
    n_syn = con.execute("SELECT COUNT(*) FROM content_flag_synset").fetchone()[0]
    check(n_flag > 200, f"{n_flag} lemma flags populated (>200)")
    check(n_syn > 10, f"{n_syn} synset flags populated (>10)")
    srcs = {r[0] for r in con.execute("SELECT DISTINCT source FROM content_flag")}
    srcs |= {r[0] for r in con.execute("SELECT DISTINCT source FROM content_flag_synset")}
    check(EXPECTED_SOURCES <= srcs, f"sources present: {sorted(srcs)}")
    check(con.execute("SELECT COUNT(*) FROM content_flag WHERE source_url IS NULL OR source_license IS NULL OR source_version IS NULL OR reason IS NULL").fetchone()[0] == 0,
          "every lemma flag has reason + source + url + license + version")
    check(con.execute("SELECT COUNT(*) FROM content_flag_synset WHERE source_url IS NULL OR source_license IS NULL OR source_version IS NULL OR reason IS NULL").fetchone()[0] == 0,
          "every synset flag has reason + source + url + license + version")

    print("== 2. known profanities flagged ==")
    for w in KNOWN_FLAGGED:
        lid = lemma_id(con, w)
        check(lid is not None, f"lemma {w!r} exists")
        check(con.execute("SELECT 1 FROM content_flag WHERE lemma_id = ?", (lid,)).fetchone(),
              f"lemma {w!r} is flagged")

    print("== 3. scunthorpe cases NOT flagged ==")
    for w in SCUNTHORPE_SAFE:
        lid = lemma_id(con, w)
        check(lid is not None, f"lemma {w!r} exists")
        check(not con.execute("SELECT 1 FROM content_flag WHERE lemma_id = ?", (lid,)).fetchone(),
              f"lemma {w!r} is NOT flagged")

    print("== 4. sense-aware: 'boy' ==")
    lid = lemma_id(con, "boy")
    check(lid is not None, "lemma 'boy' exists")
    check(not con.execute("SELECT 1 FROM content_flag WHERE lemma_id = ?", (lid,)).fetchone(),
          "lemma 'boy' is NOT lemma-flagged (clean senses survive)")
    slur = con.execute(
        "SELECT synset_offset, pos FROM content_flag_synset "
        "WHERE (synset_offset, pos) IN (SELECT offset, pos FROM synset "
        "WHERE definition LIKE '%offensive and disparaging term for Black man%')").fetchall()
    check(len(slur) == 1, f"'boy' slur synset is synset-flagged ({slur})")

    print("== 4b. 'black person' vs 'blackamoor' ==")
    lid_bp = lemma_id(con, "black person")
    check(lid_bp is not None, "lemma 'black person' exists")
    check(not con.execute("SELECT 1 FROM content_flag WHERE lemma_id = ?", (lid_bp,)).fetchone(),
          "lemma 'black person' is NOT lemma-flagged (neutral term)")
    check(not con.execute(
        "SELECT 1 FROM content_flag_synset WHERE (synset_offset, pos) IN "
        "(SELECT synset_offset, pos FROM sense WHERE lemma_id = ?)",
        (lid_bp,)).fetchone(),
          "'black person' synset is NOT synset-flagged")
    lid_bm = lemma_id(con, "blackamoor")
    check(lid_bm is not None, "lemma 'blackamoor' exists")
    r = con.execute("SELECT source FROM content_flag WHERE lemma_id = ?",
                    (lid_bm,)).fetchone()
    check(r is not None and r[0] == "oewn-slur-domain",
          f"'blackamoor' is lemma-flagged via oewn-slur-domain ({r})")

    print("== 5. filtered build ==")
    check(lemma_id(con, "dog") is not None, "lemma 'dog' exists")
    dog_senses = con.execute(
        "SELECT COUNT(*) FROM sense WHERE lemma_id = ?", (lemma_id(con, "dog"),)).fetchone()[0]
    check(dog_senses > 0, f"'dog' has {dog_senses} senses in canonical db")
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "gloss-filtered.db")
        report = make_filtered.make_filtered(args.db, out)
        f = sqlite3.connect(out)
        check(f.execute("SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'content_flag%'").fetchone()[0] == 0,
              "flag tables dropped from the shipped db")
        for (lid,) in con.execute("SELECT lemma_id FROM content_flag"):
            check(f.execute("SELECT COUNT(*) FROM sense WHERE lemma_id = ?", (lid,)).fetchone()[0] == 0,
                  f"flagged lemma_id {lid} has no senses in filtered db")
        for off, pos in con.execute("SELECT synset_offset, pos FROM content_flag_synset"):
            check(f.execute("SELECT COUNT(*) FROM synset WHERE offset = ? AND pos = ?", (off, pos)).fetchone()[0] == 0,
                  f"flagged synset ({off},{pos}) gone from filtered db")
        check(f.execute("PRAGMA foreign_key_check").fetchall() == [],
              "foreign_key_check clean")
        check(f.execute("SELECT COUNT(*) FROM lemma WHERE NOT EXISTS "
                        "(SELECT 1 FROM sense s WHERE s.lemma_id = lemma.id)").fetchone()[0] == 0,
              "no dangling lemmas")
        check(f.execute("SELECT COUNT(*) FROM sense WHERE NOT EXISTS "
                        "(SELECT 1 FROM synset s WHERE s.offset = sense.synset_offset)").fetchone()[0] == 0,
              "no dangling senses")
        dog_f = f.execute("SELECT COUNT(*) FROM sense WHERE lemma_id = ?",
                          (f.execute("SELECT id FROM lemma WHERE lemma='dog'").fetchone()[0],)).fetchone()[0]
        check(dog_f == dog_senses, f"'dog' untouched ({dog_f} senses)")
        boy_f = f.execute("SELECT id FROM lemma WHERE lemma='boy'").fetchone()
        check(boy_f is not None, "'boy' lemma survives filtering")
        boy_senses = f.execute("SELECT COUNT(*) FROM sense WHERE lemma_id = ?", (boy_f[0],)).fetchone()[0]
        check(boy_senses > 0, f"'boy' keeps {boy_senses} clean senses")
        bp_f = f.execute("SELECT id FROM lemma WHERE lemma='black person'").fetchone()
        check(bp_f is not None, "'black person' lemma survives filtering")
        check(f.execute("SELECT COUNT(*) FROM sense WHERE lemma_id = ?",
                        (bp_f[0],)).fetchone()[0] == 1,
              "'black person' keeps its sense")
        check(f.execute("SELECT COUNT(*) FROM lemma WHERE lemma='blackamoor'").fetchone()[0] == 0,
              "'blackamoor' removed by filtering")
        cr_id = lemma_id(con, "cracker")
        cr_before = con.execute("SELECT COUNT(*) FROM sense WHERE lemma_id = ?",
                                (cr_id,)).fetchone()[0]
        cr_f = f.execute("SELECT id FROM lemma WHERE lemma='cracker'").fetchone()
        check(cr_f is not None, "'cracker' lemma survives filtering")
        cr_after = f.execute("SELECT COUNT(*) FROM sense WHERE lemma_id = ?",
                             (cr_f[0],)).fetchone()[0]
        check(cr_after == cr_before - 1,
              f"'cracker' lost only its slur sense ({cr_before} -> {cr_after})")
        check(f.execute("SELECT COUNT(*) FROM sense WHERE NOT EXISTS "
                        "(SELECT 1 FROM synset s WHERE s.offset = sense.synset_offset "
                        "AND s.pos = sense.pos)").fetchone()[0] == 0,
              "no sense orphaned across (offset, pos)")
        check(report["removed"]["synset"] > 0 and report["removed"]["lemma"] > 0,
              f"removals happened: {report['removed']}")
        f.close()
    con.close()
    print("\nALL SAFETY TESTS PASSED")


if __name__ == "__main__":
    main()
