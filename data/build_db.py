#!/usr/bin/env python3
"""Build gloss.db (SQLite) from Open English WordNet WNDB files.

The WNDB download ("for legacy applications") uses Princeton's classic
dict-file layout, so this parses data.{noun,verb,adj,adv} and
index.{noun,verb,adj,adv} directly. No scraping, ever: the input is a
versioned download recorded in the meta table for provenance.

Usage:
    python build_db.py --download            # fetch OEWN 2024 WNDB zip + build
    python build_db.py --zip path/to.zip     # build from a local zip
    python build_db.py --dir path/to/wndb    # build from an extracted dir

Output: data/gloss.db (next to this script, unless --db is given).
"""

import argparse
import datetime as dt
import json
import os
import re
import sqlite3
import sys
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))

EDITIONS = {
    # Published counts from the OEWN README (words/synsets/relations).
    "2024": {
        "url": "https://en-word.net/downloads/english-wordnet-2024.zip",
        "synsets": 120630,
        "relations": 419168,
        "words": 161705,
    },
}

POS_FILES = ("noun", "verb", "adj", "adv")
# Adjective position markers in data files: galore(ip), ready to hand(p).
# Index files list the bare form; strip for matching and display (NLTK does the same).
ADJ_MARKER = re.compile(r"\((a|p|ip)\)$")

POS_CODES = {"noun": "n", "verb": "v", "adj": "a", "adv": "r"}

SCHEMA = """
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE lemma(
    id INTEGER PRIMARY KEY,
    lemma TEXT NOT NULL,
    pos TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_lemma ON lemma(lemma, pos);
CREATE TABLE synset(
    offset INTEGER NOT NULL,
    pos TEXT NOT NULL,
    definition TEXT NOT NULL,
    PRIMARY KEY(offset, pos)
);
CREATE TABLE sense(
    id INTEGER PRIMARY KEY,
    lemma_id INTEGER NOT NULL REFERENCES lemma(id),
    pos TEXT NOT NULL,
    sense_no INTEGER NOT NULL,
    synset_offset INTEGER NOT NULL,
    definition TEXT NOT NULL,
    examples TEXT NOT NULL,          -- JSON array of strings
    UNIQUE(lemma_id, sense_no)
);
CREATE INDEX idx_sense_lemma ON sense(lemma_id);
CREATE TABLE relation(
    id INTEGER PRIMARY KEY,
    from_offset INTEGER NOT NULL,
    from_pos TEXT NOT NULL,
    ptr TEXT NOT NULL,               -- raw WNDB pointer symbol, e.g. @ ! ~ #p
    to_offset INTEGER NOT NULL,
    to_pos TEXT NOT NULL,
    from_word INTEGER NOT NULL,      -- 0 = synset-level pointer
    to_word INTEGER NOT NULL
);
CREATE INDEX idx_relation_from ON relation(from_offset, from_pos);
-- Content safety: the canonical DB keeps everything; flags live here.
-- Lemma-level flags come from curated profanity lists: the whole headword
-- is taboo. Synset-level flags come from OEWN's own usage signals: one
-- sense is taboo (e.g. 'boy' as an ethnic slur) and flagging the lemma
-- would nuke its clean senses. Filtered builds (phone apps) remove flagged
-- lemmas and synsets at build time; see data/build_flags.py and
-- data/make_filtered.py.
CREATE TABLE content_flag(
    lemma_id INTEGER PRIMARY KEY REFERENCES lemma(id),
    reason TEXT NOT NULL,
    source TEXT NOT NULL,            -- e.g. dsojevic/profanity-list
    category TEXT,                   -- comma-joined source tags, when present
    severity INTEGER,                -- 1 mild .. 4 severe, when the source rates it
    source_version TEXT NOT NULL     -- source date + content hash
);
CREATE TABLE content_flag_synset(
    synset_offset INTEGER NOT NULL,
    pos TEXT NOT NULL,
    reason TEXT NOT NULL,
    source TEXT NOT NULL,            -- oewn-usage-label | oewn-slur-domain
    PRIMARY KEY(synset_offset, pos)
);
-- Word order inside each synset (0 = first/most representative word).
-- `word` is the surface form from the data file (original case: "French leave");
-- lemma_id links to the (lowercased) index entry.
CREATE TABLE synset_word(
    synset_offset INTEGER NOT NULL,
    pos TEXT NOT NULL,
    word_pos INTEGER NOT NULL,
    lemma_id INTEGER NOT NULL REFERENCES lemma(id),
    word TEXT NOT NULL,
    PRIMARY KEY(synset_offset, pos, word_pos)
);
CREATE INDEX idx_synset_word_lemma ON synset_word(lemma_id);
"""

EXAMPLE_RE = re.compile(r'"([^"]*)"')


def split_definition(gloss):
    """Split a WNDB gloss into (definition, [examples])."""
    examples = EXAMPLE_RE.findall(gloss)
    definition = EXAMPLE_RE.sub("", gloss).strip(" ;")
    definition = re.sub(r"\s+", " ", definition)
    return definition, examples


def parse_data_file(path):
    """Yield (offset, words[(word, lex_id)], pointers, definition, examples).

    pointers: list of (ptr_symbol, to_offset, to_pos, from_word, to_word).
    """
    synsets = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip() or line.startswith(" "):
                continue  # copyright header lines start with two spaces
            left, _, gloss = line.rstrip("\n").partition(" | ")
            tok = left.split()
            offset = int(tok[0])
            ss_type = tok[2]
            w_cnt = int(tok[3], 16)
            words = []
            i = 4
            for _ in range(w_cnt):
                words.append((tok[i].replace("_", " "), int(tok[i + 1], 16)))
                i += 2
            p_cnt = int(tok[i])  # 3-digit decimal (not hex!)
            i += 1
            pointers = []
            for _ in range(p_cnt):
                ptr, to_off, to_pos, src_tgt = tok[i], int(tok[i + 1]), tok[i + 2], tok[i + 3]
                pointers.append((ptr, to_off, to_pos,
                                 int(src_tgt[:2], 16), int(src_tgt[2:], 16)))
                i += 4
            # Optional verb frames: f_cnt, then per frame either ('+', f_num, w_num)
            # or ('+NN', w_num). Skip them.
            if i < len(tok):
                f_cnt = int(tok[i])  # decimal
                i += 1
                for _ in range(f_cnt):
                    if tok[i] == "+":
                        i += 3
                    else:
                        assert tok[i].startswith("+"), f"bad frame token: {tok[i]}"
                        i += 2
            assert i == len(tok), f"unparsed tokens in data line: {line[:120]}"
            definition, examples = split_definition(gloss)
            synsets.append((offset, ss_type, words, pointers, definition, examples))
    return synsets


def parse_index_file(path):
    """Yield (lemma, [(synset_offset, ...)] in sense-number order)."""
    entries = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip() or line.startswith(" "):
                continue
            tok = line.split()
            lemma = tok[0].replace("_", " ")
            synset_cnt = int(tok[2])
            p_cnt = int(tok[3])
            base = 4 + p_cnt
            # sense_cnt = int(tok[base]); tagsense_cnt = int(tok[base+1])
            offsets = [int(x) for x in tok[base + 2: base + 2 + synset_cnt]]
            entries.append((lemma, offsets))
    return entries


def find_wndb_dir(root):
    """Locate the directory holding data.noun (zip may nest one level)."""
    for dirpath, _dirnames, filenames in os.walk(root):
        if "data.noun" in filenames:
            return dirpath
    raise FileNotFoundError("data.noun not found under " + root)


def download(url, dest):
    print(f"downloading {url} ...")
    urllib.request.urlretrieve(url, dest)
    print(f"saved {dest} ({os.path.getsize(dest) / 1e6:.1f} MB)")


def build(wndb_dir, db_path, edition, url):
    if os.path.exists(db_path):
        os.remove(db_path)
    con = sqlite3.connect(db_path)
    con.execute("PRAGMA journal_mode=OFF")
    con.execute("PRAGMA synchronous=OFF")
    con.executescript(SCHEMA)

    total_synsets = 0
    total_relations = 0
    synset_defs = {}  # (offset, pos) -> (definition, examples_json)
    synset_words = []  # (offset, pos, word_pos, word)
    for pos_file in POS_FILES:
        synsets = parse_data_file(os.path.join(wndb_dir, f"data.{pos_file}"))
        print(f"data.{pos_file}: {len(synsets)} synsets")
        rows, rel_rows = [], []
        for offset, ss_type, words, pointers, definition, examples in synsets:
            p = "a" if ss_type == "s" else ss_type  # satellite adjectives -> a
            rows.append((offset, p, definition))
            synset_defs[(offset, p)] = (definition, json.dumps(examples))
            for wp, (word, _lex_id) in enumerate(words):
                if p == "a":
                    word = ADJ_MARKER.sub("", word)
                synset_words.append((offset, p, wp, word))
            for ptr, to_off, to_pos, fw, tw in pointers:
                rel_rows.append((offset, p, ptr, to_off, to_pos, fw, tw))
        con.executemany("INSERT INTO synset(offset, pos, definition) VALUES(?,?,?)", rows)
        con.executemany(
            "INSERT INTO relation(from_offset, from_pos, ptr, to_offset, to_pos,"
            " from_word, to_word) VALUES(?,?,?,?,?,?,?)", rel_rows)
        total_synsets += len(rows)
        total_relations += len(rel_rows)

    lemma_id = 0
    sense_rows = []
    total_senses = 0
    for pos_file in POS_FILES:
        pos = POS_CODES[pos_file]
        entries = parse_index_file(os.path.join(wndb_dir, f"index.{pos_file}"))
        print(f"index.{pos_file}: {len(entries)} lemmas")
        lemma_rows = []
        for lemma, offsets in entries:
            lemma_id += 1
            lemma_rows.append((lemma_id, lemma, pos))
            for n, off in enumerate(offsets, start=1):
                key = (off, pos)
                if key not in synset_defs:
                    # Satellite adjectives live in data.adj under pos 'a'.
                    key = (off, "a")
                definition, examples_json = synset_defs.get(key, ("", "[]"))
                sense_rows.append((lemma_id, pos, n, off, definition, examples_json))
                total_senses += 1
        con.executemany("INSERT INTO lemma(id, lemma, pos) VALUES(?,?,?)", lemma_rows)
    con.executemany(
        "INSERT INTO sense(lemma_id, pos, sense_no, synset_offset, definition, examples)"
        " VALUES(?,?,?,?,?,?)", sense_rows)

    # Word order within synsets (needs lemma ids, so it goes last).
    # Data files keep original case ("French leave"); index entries are
    # lowercase — match exact first, then case-insensitively.
    lemma_ids = {}
    for lid, lemma, pos in con.execute("SELECT id, lemma, pos FROM lemma"):
        lemma_ids.setdefault((lemma, pos), lid)
        lemma_ids.setdefault((lemma.lower(), pos), lid)
    sw_rows, sw_miss = [], 0
    for offset, pos, wp, word in synset_words:
        lid = lemma_ids.get((word, pos))
        if lid is None:
            lid = lemma_ids.get((word.lower(), pos))
        if lid is None:
            sw_miss += 1
        else:
            sw_rows.append((offset, pos, wp, lid, word))
    con.executemany(
        "INSERT INTO synset_word(synset_offset, pos, word_pos, lemma_id, word)"
        " VALUES(?,?,?,?,?)", sw_rows)
    print(f"synset_word rows: {len(sw_rows)} (unmatched: {sw_miss})")

    con.executemany("INSERT INTO meta(key, value) VALUES(?,?)", [
        ("source", "Open English WordNet"),
        ("oewn_edition", edition),
        ("oewn_url", url),
        ("built_at", dt.datetime.now(dt.timezone.utc).isoformat()),
        ("content_policy",
         "canonical DB keeps all entries; content_flag marks taboo/offensive"
         " material for build-time filtering (phone-app builds ship filtered)"),
    ])
    con.commit()

    # --- validation -----------------------------------------------------
    exp = EDITIONS[edition]
    n_lemmas = con.execute("SELECT COUNT(*) FROM lemma").fetchone()[0]
    print("\n== validation ==")
    print(f"synsets:   {total_synsets:>8}  (published {exp['synsets']})")
    print(f"relations: {total_relations:>8}  (published {exp['relations']})")
    print(f"lemmas:    {n_lemmas:>8}  senses: {total_senses}")
    print(f"content_flag rows: {con.execute('SELECT COUNT(*) FROM content_flag').fetchone()[0]}"
          f" (+ {con.execute('SELECT COUNT(*) FROM content_flag_synset').fetchone()[0]} synset flags;"
          " run data/build_flags.py to populate)")
    ok = True
    # Synsets must match: they prove the parse is structurally complete.
    if abs(total_synsets - exp["synsets"]) / exp["synsets"] > 0.01:
        print("ERROR: synset count off by more than 1%")
        ok = False
    # Relations: the WNDB "legacy" export carries fewer rows than the
    # published native-format count, but the gap is fully reconciled (see
    # data/README.md): the synset-level graph is 100% identical, 628 rows
    # are inverse entailment/causation pairs stored forward-only, and 16,887
    # are native "other" verb->noun links whose synset pairs are linked here
    # as + (derivation). Nothing a dictionary app traverses is missing.
    print(f"note: WNDB relations {total_relations} vs published native "
          f"count {exp['relations']} (gap reconciled; see data/README.md)")
    con.close()
    size_mb = os.path.getsize(db_path) / 1e6
    print(f"\nwrote {db_path} ({size_mb:.1f} MB)" + (" [OK]" if ok else " [CHECK]"))
    return ok


def main():
    ap = argparse.ArgumentParser(description="Build gloss.db from OEWN WNDB files.")
    ap.add_argument("--edition", default="2024", choices=sorted(EDITIONS))
    ap.add_argument("--download", action="store_true")
    ap.add_argument("--zip", default=None)
    ap.add_argument("--dir", default=None)
    ap.add_argument("--db", default=os.path.join(HERE, "gloss.db"))
    args = ap.parse_args()

    url = EDITIONS[args.edition]["url"]
    if args.download:
        zpath = os.path.join(HERE, f"english-wordnet-{args.edition}.zip")
        if not os.path.exists(zpath):
            download(url, zpath)
        args.zip = zpath
    if args.zip:
        d = os.path.join(HERE, "wndb")
        print(f"extracting {args.zip} ...")
        with zipfile.ZipFile(args.zip) as z:
            z.extractall(d)
        wndb_dir = find_wndb_dir(d)
    elif args.dir:
        wndb_dir = find_wndb_dir(args.dir)
    else:
        ap.error("give one of --download, --zip, or --dir")
    print(f"WNDB dir: {wndb_dir}")
    ok = build(wndb_dir, args.db, args.edition, url)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
