#!/usr/bin/env python3
"""
make_tier.py -- build a smaller gloss.db from a full-size one.

Ranks lemmas by an external word-frequency list and keeps the top N,
optionally capping senses per lemma and dropping examples. Integrity
guarantees:

  * sense_no values are preserved, never renumbered -- a deep link like
    ?define=dog&sense=n1 means the same thing in every tier.
  * relations whose source or target synset was dropped are pruned, so a
    UI never renders a "Broader" chip that leads nowhere.
  * content_flag rows follow their lemmas / synsets into the tier.
  * meta gains tier_* provenance keys, and build_profile gets a tier suffix.

Frequency sources (exactly one):
  --freq wordfreq:50000   rank by the 50k most frequent English words from
                          the `wordfreq` package (pip install wordfreq).
                          The pool should be comfortably larger than
                          --top-lemmas.
  --freq-csv PATH         CSV of words, one per line (rank = line order),
                          or "word,rank" rows with a header.

Examples:
  # pocket dictionary: 5k most frequent lemmas, top 2 senses, no examples
  python data/make_tier.py --in data/gloss-filtered.db --out data/gloss-core.db \
      --top-lemmas 5000 --max-senses 2 --drop-examples

  # standard tier: 25k lemmas, everything else intact
  python data/make_tier.py --in data/gloss-filtered.db --out data/gloss-standard.db \
      --top-lemmas 25000 --max-senses 0
"""

import argparse
import csv
import os
import sqlite3
import sys
from datetime import datetime, timezone

TABLES = [
    "lemma",
    "synset",
    "sense",
    "relation",
    "synset_word",
    "content_flag",
    "content_flag_synset",
]


def load_rank_wordfreq(spec):
    """spec: 'wordfreq' or 'wordfreq:N'. Returns {word.lower(): rank}."""
    try:
        n = int(spec.split(":", 1)[1]) if ":" in spec else 50000
    except ValueError:
        sys.exit(f"bad --freq spec {spec!r}; want 'wordfreq' or 'wordfreq:N'")
    try:
        from wordfreq import top_n_list
    except ImportError:
        sys.exit("the wordfreq package is not installed (pip install wordfreq), "
                 "or use --freq-csv instead")
    words = top_n_list("en", n)
    if len(words) < n:
        print(f"warning: wordfreq returned only {len(words)} words (asked {n})")
    return {w.lower(): i for i, w in enumerate(words)}, f"wordfreq:{len(words)}"


def load_rank_csv(path):
    rank = {}
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    if not rows:
        sys.exit(f"empty frequency file: {path}")
    header = [c.strip().lower() for c in rows[0]]
    if header[:2] == ["word", "rank"]:
        for word, r, *_ in rows[1:]:
            rank[word.strip().lower()] = int(r)
    else:  # one word per line; rank = line order
        for i, (word, *_) in enumerate(rows):
            if word.strip():
                rank[word.strip().lower()] = i
    return rank, f"csv:{os.path.basename(path)}"


def main():
    ap = argparse.ArgumentParser(description="Build a frequency-ranked gloss.db tier.")
    ap.add_argument("--in", dest="inp", required=True, help="input gloss.db (full size)")
    ap.add_argument("--out", required=True, help="output gloss.db (tier)")
    ap.add_argument("--top-lemmas", type=int, default=5000,
                    help="keep this many most-frequent distinct lemmas; every"
                    " POS entry of a kept lemma is included (default 5000)")
    ap.add_argument("--max-senses", type=int, default=2,
                    help="max senses kept per lemma (most frequent first); "
                         "0 = unlimited (default 2)")
    ap.add_argument("--drop-examples", action="store_true",
                    help="store [] instead of usage examples")
    ap.add_argument("--freq", default="wordfreq:50000",
                    help="'wordfreq[:N]' or ... (default 'wordfreq:50000')")
    ap.add_argument("--freq-csv", default=None,
                    help="CSV frequency list; alternative to --freq")
    ap.add_argument("--tier-name", default=None,
                    help="tier name for meta (default derived from parameters)")
    ap.add_argument("--force", action="store_true",
                    help="overwrite --out if it exists")
    args = ap.parse_args()

    if args.top_lemmas <= 0:
        sys.exit("--top-lemmas must be positive")
    if os.path.exists(args.out) and not args.force:
        sys.exit(f"{args.out} exists; pass --force to overwrite")
    if args.freq_csv:
        rank, freq_source = load_rank_csv(args.freq_csv)
    else:
        rank, freq_source = load_rank_wordfreq(args.freq)

    tier_name = args.tier_name or (
        f"top{args.top_lemmas}"
        + (f"-s{args.max_senses}" if args.max_senses else "")
        + ("-noex" if args.drop_examples else "")
    )

    src = sqlite3.connect(f"file:{os.path.abspath(args.inp)}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row
    have = {r[0] for r in src.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    missing = [t for t in TABLES if t not in have]
    if missing or "meta" not in have:
        sys.exit(f"input is not a gloss.db; missing tables: {missing}")

    # 1. Rank distinct lemma strings (case-insensitive). Every POS entry of
    #    a kept word is kept: "dog" the noun and "dog" the verb travel
    #    together, since frequency is a property of the word, not the
    #    (word, pos) row.
    str_rank = {}
    ids_by_str = {}
    for r in src.execute("SELECT id, lemma FROM lemma"):
        key = r["lemma"].lower()
        ids_by_str.setdefault(key, []).append(r["id"])
        if key not in str_rank:
            str_rank[key] = (rank.get(key), r["lemma"])
    scored = sorted(str_rank.items(),
                    key=lambda kv: (kv[1][0] is None, kv[1][0] or 0, kv[1][1]))
    matched = sum(1 for _, (rk, _) in scored if rk is not None)
    if matched < args.top_lemmas:
        print(f"warning: only {matched} lemmas matched the frequency list "
              f"(asked top {args.top_lemmas}); tier will be smaller")
    kept_strings = {key for key, (rk, _) in scored[:args.top_lemmas]
                    if rk is not None}
    kept_lemma_ids = {i for key in kept_strings for i in ids_by_str[key]}

    # 2. Senses, streaming in (lemma_id, sense_no) order so the cap keeps the
    #    most frequent senses. sense_no is copied verbatim -- never renumbered.
    kept_synsets = set()
    sense_rows = []
    cur_lid, kept_n = None, 0
    for r in src.execute(
            "SELECT id, lemma_id, pos, sense_no, synset_offset, definition,"
            " examples FROM sense ORDER BY lemma_id, sense_no"):
        if r["lemma_id"] != cur_lid:
            cur_lid, kept_n = r["lemma_id"], 0
        if r["lemma_id"] not in kept_lemma_ids:
            continue
        if args.max_senses and kept_n >= args.max_senses:
            continue
        kept_n += 1
        examples = "[]" if args.drop_examples else r["examples"]
        sense_rows.append((r["id"], r["lemma_id"], r["pos"], r["sense_no"],
                           r["synset_offset"], r["definition"], examples))
        kept_synsets.add((r["synset_offset"], r["pos"]))
    # A sense whose synset row is absent from the input (shouldn't happen,
    # but the builder tolerates it) must not survive into the tier.
    real_synsets = {(r["offset"], r["pos"]) for r in
                    src.execute("SELECT offset, pos FROM synset")}
    kept_synsets &= real_synsets

    if os.path.exists(args.out):
        os.remove(args.out)
    dst = sqlite3.connect(args.out)
    dst.row_factory = sqlite3.Row
    # Replicate schema (tables + indexes) from the input.
    for r in src.execute(
            "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL"
            " AND name NOT LIKE 'sqlite_%'"):
        dst.execute(r["sql"])

    dst.executemany("INSERT INTO lemma(id, lemma, pos) VALUES(?,?,?)",
                    [tuple(r) for r in src.execute("SELECT id, lemma, pos FROM lemma")
                     if r["id"] in kept_lemma_ids])

    dst.executemany(
        "INSERT INTO synset(offset, pos, definition) VALUES(?,?,?)",
        (r for r in src.execute("SELECT offset, pos, definition FROM synset")
         if (r["offset"], r["pos"]) in kept_synsets))

    dst.executemany(
        "INSERT INTO sense(id, lemma_id, pos, sense_no, synset_offset,"
        " definition, examples) VALUES(?,?,?,?,?,?,?)", sense_rows)

    dst.executemany(
        "INSERT INTO synset_word(synset_offset, pos, word_pos, lemma_id, word)"
        " VALUES(?,?,?,?,?)",
        (r for r in src.execute(
            "SELECT synset_offset, pos, word_pos, lemma_id, word FROM synset_word")
         if (r["synset_offset"], r["pos"]) in kept_synsets))

    # Prune relations with a dropped endpoint -- no dangling chips.
    n_rel_in, n_rel_kept = 0, 0
    rel_rows = []
    for r in src.execute(
            "SELECT id, from_offset, from_pos, ptr, to_offset, to_pos,"
            " from_word, to_word FROM relation"):
        n_rel_in += 1
        if ((r["from_offset"], r["from_pos"]) in kept_synsets
                and (r["to_offset"], r["to_pos"]) in kept_synsets):
            n_rel_kept += 1
            rel_rows.append(tuple(r))
    dst.executemany(
        "INSERT INTO relation(id, from_offset, from_pos, ptr, to_offset, to_pos,"
        " from_word, to_word) VALUES(?,?,?,?,?,?,?,?)", rel_rows)

    dst.executemany(
        "INSERT INTO content_flag(lemma_id, reason, source, source_url,"
        " source_license, category, severity, source_version)"
        " VALUES(?,?,?,?,?,?,?,?)",
        (tuple(r) for r in src.execute("SELECT * FROM content_flag")
         if r["lemma_id"] in kept_lemma_ids))
    dst.executemany(
        "INSERT INTO content_flag_synset(synset_offset, pos, reason, source,"
        " source_url, source_license, source_version) VALUES(?,?,?,?,?,?,?)",
        (tuple(r) for r in src.execute("SELECT * FROM content_flag_synset")
         if (r["synset_offset"], r["pos"]) in kept_synsets))

    for r in src.execute("SELECT key, value FROM meta"):
        dst.execute("INSERT INTO meta(key, value) VALUES(?,?)",
                    (r["key"], r["value"]))
    profile = dst.execute(
        "SELECT value FROM meta WHERE key='build_profile'").fetchone()
    profile = profile["value"] if profile else "unknown"
    tier_meta = {
        "build_profile": f"{profile}-{tier_name}",
        "tier_name": tier_name,
        "tier_top_lemmas": str(args.top_lemmas),
        "tier_max_senses": str(args.max_senses),
        "tier_drop_examples": str(bool(args.drop_examples)).lower(),
        "tier_frequency_source": freq_source,
        "tier_built_at": datetime.now(timezone.utc).isoformat(),
    }
    dst.executemany("INSERT OR REPLACE INTO meta(key, value) VALUES(?,?)",
                    tier_meta.items())
    dst.commit()

    # 3. Validate the tier.
    dangling_rel = dst.execute(
        "SELECT COUNT(*) FROM relation r WHERE NOT EXISTS"
        " (SELECT 1 FROM synset s WHERE s.offset=r.from_offset"
        " AND s.pos=r.from_pos) OR NOT EXISTS"
        " (SELECT 1 FROM synset s WHERE s.offset=r.to_offset"
        " AND s.pos=r.to_pos)").fetchone()[0]
    dangling_sense = dst.execute(
        "SELECT COUNT(*) FROM sense e WHERE NOT EXISTS"
        " (SELECT 1 FROM synset s WHERE s.offset=e.synset_offset"
        " AND s.pos=e.pos)").fetchone()[0]
    assert dangling_rel == 0, f"{dangling_rel} dangling relations"
    assert dangling_sense == 0, f"{dangling_sense} dangling senses"
    # sense_no preserved: every kept sense must still be unique per lemma.
    dupes = dst.execute(
        "SELECT COUNT(*) FROM (SELECT lemma_id, sense_no FROM sense"
        " GROUP BY lemma_id, sense_no HAVING COUNT(*) > 1)").fetchone()[0]
    assert dupes == 0, "sense_no collision -- renumbering bug"

    counts = {t: dst.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
              for t in TABLES}
    in_bytes = os.path.getsize(args.inp)
    out_bytes = os.path.getsize(args.out)
    dst.close()
    src.close()

    print(f"tier {tier_name}:")
    print(f"  lemmas:   {counts['lemma']}")
    print(f"  senses:   {counts['sense']} (kept with original sense_no)")
    print(f"  synsets:  {counts['synset']}")
    print(f"  relations: {counts['relation']} (pruned {n_rel_in - n_rel_kept}"
          f" dangling of {n_rel_in})")
    print(f"  size: {in_bytes/1e6:.1f} MB -> {out_bytes/1e6:.1f} MB"
          f" ({100*out_bytes/in_bytes:.1f}%)")
    print(f"  profile: {tier_meta['build_profile']}")
    print("validation: no dangling relations/senses, sense_no intact")


if __name__ == "__main__":
    main()
