#!/usr/bin/env python3
"""Build a filtered copy of gloss.db with taboo/offensive entries removed.

Reads content_flag (lemma-level: the whole headword is taboo) and
content_flag_synset (sense-level: one synset is taboo) from the canonical
DB, then in the copy:

  1. removes every flagged lemma's senses and synset words,
  2. removes every flagged synset -- its words, senses, and relations,
  3. prunes relations left dangling (synset or word endpoint gone),
  4. drops lemmas left with no senses,
  5. drops the flag tables (the shipped DB is clean; the canonical DB
     keeps the flags for audit),
  6. stamps meta: build_profile=filtered, filtered_at, removal counts.

Usage:
    python data/make_filtered.py --db data/gloss.db --out data/gloss-filtered.db

Prints a removal report. Importable: make_filtered(src, out) -> dict.
"""

import argparse
import datetime as dt
import json
import os
import shutil
import sqlite3


def make_filtered(src, out):
    if os.path.abspath(src) == os.path.abspath(out):
        raise SystemExit("refusing to filter the db in place; use --out")
    shutil.copy(src, out)
    con = sqlite3.connect(out)
    con.execute("PRAGMA foreign_keys = OFF")
    report = {}

    def n(q, p=()):
        return con.execute(q, p).fetchone()[0]

    report["flagged_lemmas"] = n("SELECT COUNT(*) FROM content_flag")
    report["flagged_synsets"] = n("SELECT COUNT(*) FROM content_flag_synset")
    before = {t: n(f"SELECT COUNT(*) FROM {t}")
              for t in ("lemma", "sense", "synset", "synset_word", "relation")}

    # 1. flagged lemmas lose their senses and synset words
    con.execute("DELETE FROM sense WHERE lemma_id IN "
                "(SELECT lemma_id FROM content_flag)")
    con.execute("DELETE FROM synset_word WHERE lemma_id IN "
                "(SELECT lemma_id FROM content_flag)")
    # 2. flagged synsets lose words, senses, and the synset itself
    con.execute("DELETE FROM sense WHERE (synset_offset, pos) IN "
                "(SELECT synset_offset, pos FROM content_flag_synset)")
    con.execute("DELETE FROM synset_word WHERE (synset_offset, pos) IN "
                "(SELECT synset_offset, pos FROM content_flag_synset)")
    con.execute("DELETE FROM synset WHERE (offset, pos) IN "
                "(SELECT synset_offset, pos FROM content_flag_synset)")
    # 3. prune what the removals orphaned
    con.execute("DELETE FROM synset WHERE NOT EXISTS "
                "(SELECT 1 FROM synset_word w WHERE w.synset_offset = synset.offset "
                "AND w.pos = synset.pos)")
    con.execute("DELETE FROM sense WHERE NOT EXISTS "
                "(SELECT 1 FROM synset s WHERE s.offset = sense.synset_offset "
                "AND s.pos = sense.pos)")
    #    (satellite adjectives are already merged to 'a' in the build)
    con.execute("DELETE FROM relation WHERE NOT EXISTS "
                "(SELECT 1 FROM synset s WHERE s.offset = relation.from_offset "
                "AND s.pos = relation.from_pos)")
    con.execute("DELETE FROM relation WHERE NOT EXISTS "
                "(SELECT 1 FROM synset s WHERE s.offset = relation.to_offset "
                "AND s.pos = relation.to_pos)")
    con.execute("DELETE FROM relation WHERE from_word > 0 AND NOT EXISTS "
                "(SELECT 1 FROM synset_word w WHERE w.synset_offset = relation.from_offset "
                "AND w.pos = relation.from_pos AND w.word_pos = relation.from_word - 1)")
    con.execute("DELETE FROM relation WHERE to_word > 0 AND NOT EXISTS "
                "(SELECT 1 FROM synset_word w WHERE w.synset_offset = relation.to_offset "
                "AND w.pos = relation.to_pos AND w.word_pos = relation.to_word - 1)")
    con.execute("DELETE FROM lemma WHERE NOT EXISTS "
                "(SELECT 1 FROM sense s WHERE s.lemma_id = lemma.id)")

    # 4. the shipped db is clean; flags stay in the canonical db
    con.execute("DROP TABLE content_flag")
    con.execute("DROP TABLE content_flag_synset")

    after = {t: n(f"SELECT COUNT(*) FROM {t}")
             for t in ("lemma", "sense", "synset", "synset_word", "relation")}
    report["removed"] = {t: before[t] - after[t] for t in before}
    report.update({f"{t}_kept": after[t] for t in after})

    con.execute("DELETE FROM meta WHERE key IN "
                "('content_policy', 'build_profile', 'filtered_at', "
                "'filtered_counts', 'content_flag_built_at', 'content_flag_sources')")
    con.executemany("INSERT INTO meta(key, value) VALUES(?,?)", [
        ("build_profile", "filtered"),
        ("filtered_at", dt.datetime.now(dt.timezone.utc).isoformat()),
        ("content_policy",
         "filtered build: entries flagged taboo/offensive in the canonical "
         "DB (content_flag / content_flag_synset) were removed at build time "
         "by data/make_filtered.py; see ATTRIBUTION.md for the flag sources"),
    ])
    con.execute("INSERT INTO meta(key, value) VALUES(?,?)",
                ("filtered_counts", json.dumps(report["removed"])))
    con.commit()

    bad = con.execute("PRAGMA foreign_key_check").fetchall()
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("VACUUM")
    con.close()
    if bad:
        raise SystemExit(f"foreign_key_check failed: {bad[:5]}")
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/gloss.db")
    ap.add_argument("--out", default="data/gloss-filtered.db")
    args = ap.parse_args()
    report = make_filtered(args.db, args.out)
    print(f"filtered db: {args.out}")
    for k in ("flagged_lemmas", "flagged_synsets"):
        print(f"  {k}: {report[k]}")
    print("  removed:")
    for t, c in report["removed"].items():
        print(f"    {t}: {c}")
    print("  kept:")
    for t in ("lemma", "sense", "synset", "synset_word", "relation"):
        print(f"    {t}: {report[f'{t}_kept']}")


if __name__ == "__main__":
    main()
