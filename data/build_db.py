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

Pronunciations: the OEWN LMF XML (downloaded automatically) contributes
IPA for ~21% of entries; CMUdict backfills the rest. Both land in the
`pronunciation` table with a precomputed friendly `respelling` column.
Use --no-pronunciation to skip.

Output: data/gloss.db (next to this script, unless --db is given).
"""

import argparse
import datetime as dt
import gzip
import json
import os
import re
import sqlite3
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

import respell

HERE = os.path.dirname(os.path.abspath(__file__))

EDITIONS = {
    # Published counts from the OEWN README (words/synsets/relations).
    "2024": {
        "url": "https://en-word.net/downloads/english-wordnet-2024.zip",
        "xml_url": "https://en-word.net/static/english-wordnet-2024.xml.gz",
        "cmudict_url": "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict",
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
    source_url TEXT NOT NULL,        -- where the source was fetched
    source_license TEXT NOT NULL,    -- redistribution license, verified
    category TEXT,                   -- comma-joined source tags, when present
    severity INTEGER,                -- 1 mild .. 4 severe, when the source rates it
    source_version TEXT NOT NULL     -- source date + content hash
);
CREATE TABLE content_flag_synset(
    synset_offset INTEGER NOT NULL,
    pos TEXT NOT NULL,
    reason TEXT NOT NULL,
    source TEXT NOT NULL,            -- oewn-usage-label | oewn-slur-domain
    source_url TEXT NOT NULL,
    source_license TEXT NOT NULL,
    source_version TEXT NOT NULL,
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
-- Pronunciations. OEWN ships IPA for ~21% of English entries (US/GB
-- varieties, same CC-BY 4.0 as the rest); CMUdict backfills the rest.
-- respelling is the friendly phonetic rendering, precomputed at build
-- time so clients need no phonetics dependency: websites/apps show the
-- respelling, developers also get the IPA. respelling_syll is the same
-- respelling with syllable boundaries marked (U+00B7 middle dot),
-- e.g. "DIHK·shuh·neh·ree"; for verbatim source text (plain-text OEWN
-- values like "wan", failed conversions) it equals respelling.
-- Pronunciations attach to (lemma, pos) rows, so a word like "live"
-- can carry /lɪv/ for the verb and /laɪv/ for the adjective.
-- Display pick order: US, then GB, then other varieties (AU/NZ/CA/IE/
-- ZA/SG), then unmarked, then cmudict (see web/lib/dict.ts).
CREATE TABLE pronunciation(
    lemma_id INTEGER NOT NULL REFERENCES lemma(id),
    variety TEXT NOT NULL,          -- US | GB | AU | ... | '' (unmarked)
    ipa TEXT NOT NULL,
    respelling TEXT NOT NULL,
    respelling_syll TEXT NOT NULL,
    source TEXT NOT NULL,           -- oewn | cmudict
    PRIMARY KEY(lemma_id, variety, source, ipa)  -- one row per distinct pronunciation
);
CREATE INDEX idx_pronunciation_lemma ON pronunciation(lemma_id);
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


def _localname(tag):
    return tag.rsplit("}", 1)[-1]


def parse_oewn_pronunciations(xml_path):
    """Yield (written_form, pos, variety, ipa) from OEWN's LMF XML.

    Streaming iterparse; the 2024 file is ~100 MB uncompressed.
    <Pronunciation> elements live under <Lemma> inside <LexicalEntry>:
        <LexicalEntry id="oewn-0-n">
          <Lemma writtenForm="0" partOfSpeech="n">
            <Pronunciation variety="US">ˈziːɹəʊ</Pronunciation>
    Most US/GB values are IPA with stress marks; unmarked ones are
    usually plain respellings (e.g. "wan" for "1") but occasionally
    genuine IPA (e.g. "lɪv" for the verb "live"); see _looks_like_ipa.
    """
    n_lex = n_pron = 0
    with gzip.open(xml_path, "rb") as f:
        ctx = ET.iterparse(f, events=("start", "end"))
        lemma = None  # (written_form, pos) of the enclosing <Lemma>
        for event, elem in ctx:
            tag = _localname(elem.tag)
            if event == "start" and tag == "Lemma":
                lemma = (elem.get("writtenForm", ""),
                         elem.get("partOfSpeech", ""))
            elif event == "end" and tag == "Pronunciation":
                n_pron += 1
                if lemma is not None:
                    ipa = (elem.text or "").strip()
                    if ipa:
                        yield (lemma[0], lemma[1],
                               elem.get("variety") or "", ipa)
                elem.clear()
            elif event == "end" and tag == "LexicalEntry":
                n_lex += 1
                lemma = None
                elem.clear()
    print(f"oewn xml: {n_lex} lexical entries, {n_pron} pronunciation elements")


# --- CMUdict backfill -------------------------------------------------------
# CMU Pronouncing Dictionary: ~134k North American English words in
# ARPAbet. Permissive BSD-style terms (attribution in ATTRIBUTION.md).
# Used ONLY for lemmas with no OEWN pronunciation; provenance is kept
# per row (source='cmudict').

_ARPA_VOWELS = {
    "AA": "ɑ", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ",
    "EH": "ɛ", "ER": "ɝ", "EY": "eɪ", "IH": "ɪ", "IY": "i", "OW": "oʊ",
    "OY": "ɔɪ", "UH": "ʊ", "UW": "u",
}
_ARPA_CONS = {
    "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f", "G": "ɡ",
    "HH": "h", "JH": "dʒ", "K": "k", "L": "l", "M": "m", "N": "n",
    "NG": "ŋ", "P": "p", "R": "ɹ", "S": "s", "SH": "ʃ", "T": "t",
    "TH": "θ", "V": "v", "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ",
}
_ARPA_WORD = re.compile(r"^([A-Za-z’-]+)(?:\(\d+\))?$")  # cmusphinx master ships lowercase words
_ARPA_PHONE = re.compile(r"^([A-Z]+)([012])?$")


def load_cmudict(path):
    """{WORD: 'phonemes...'} — first pronunciation variant wins."""
    d = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip() or line.startswith(";;;"):
                continue
            parts = line.split()
            m = _ARPA_WORD.match(parts[0])
            if not m:
                continue
            word = m.group(1).upper()  # lookups use lemma.upper()
            if word not in d:
                d[word] = " ".join(parts[1:])
    print(f"cmudict: {len(d)} entries from {os.path.basename(path)}")
    return d


def arpa_to_ipa(arpa):
    """ARPAbet string -> IPA with ˈ/ˌ stress marks.

    Stress digits ride on vowels: 1 -> ˈ, 2 -> ˌ, placed before the
    stressed syllable's onset (scan left past consonants), matching the
    convention the respeller expects (ˈdɪkʃənɛri, not dˈɪkʃənɛri).
    Unstressed AH/ER reduce to schwa/r-colored schwa (AH0 -> ə, ER0 -> ɚ).
    """
    phones = []  # (ipa, is_vowel, stress_digit|None)
    for ph in arpa.split():
        m = _ARPA_PHONE.match(ph)
        if not m:
            raise ValueError(f"bad ARPAbet phone: {ph!r}")
        base, stress = m.group(1), m.group(2)
        if base in _ARPA_VOWELS:
            v = _ARPA_VOWELS[base]
            if stress == "0":
                v = {"AH": "ə", "ER": "ɚ"}.get(base, v)
            phones.append((v, True, stress))
        elif base in _ARPA_CONS:
            phones.append((_ARPA_CONS[base], False, None))
        else:
            raise ValueError(f"unknown ARPAbet phone: {ph!r}")
    marks = {}
    for i, (_v, is_vow, stress) in enumerate(phones):
        if is_vow and stress in ("1", "2"):
            j = i
            while j > 0 and not phones[j - 1][1]:
                j -= 1
            marks[j] = "ˈ" if stress == "1" else "ˌ"
    out = []
    for i, (v, _is_vow, _s) in enumerate(phones):
        if i in marks:
            out.append(marks[i])
        out.append(v)
    return "".join(out)


def _looks_like_ipa(s):
    """True if the string contains any non-ASCII character.

    OEWN <Pronunciation> values are either IPA (symbols like
    \u02c8\u02cc\u02d0\u026a\u0259\u028a) or plain-English respellings
    ("wan"). The plain ones are pure ASCII, so anything with a
    non-ASCII codepoint is treated as IPA and run through the
    converter instead of being kept verbatim.
    """
    return any(ord(c) > 127 for c in s)


def friendly_respelling(ipa):
    """IPA -> plain-English respelling; falls back to the IPA itself."""
    try:
        return respell.convert(ipa)
    except ValueError:
        return ipa


def syllabified_respelling(ipa, rs):
    """IPA -> respelling with syllable dots (U+00B7).

    rs is the friendly_respelling() result for the same ipa. When rs == ipa
    the value is verbatim source text (or a failed conversion) with no
    syllable information, so it is returned unchanged.
    """
    if rs == ipa:
        return rs
    try:
        return respell.convert_syllabified(ipa)
    except ValueError:
        return rs


def download(url, dest):
    print(f"downloading {url} ...")
    urllib.request.urlretrieve(url, dest)
    print(f"saved {dest} ({os.path.getsize(dest) / 1e6:.1f} MB)")


def build(wndb_dir, db_path, edition, url, xml_path=None, cmudict_path=None):
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

    # --- pronunciations --------------------------------------------------
    # OEWN's XML first (authoritative IPA, US/GB varieties); CMUdict
    # backfills lemmas the XML doesn't cover. The friendly respelling is
    # precomputed per row so shipped clients need no phonetics code.
    pron_stats = {"oewn": 0, "cmudict": 0, "unmatched": 0,
                  "respell_fallback": 0}
    pron_rows, seen = [], set()
    if xml_path:
        for wf, pos, variety, ipa in parse_oewn_pronunciations(xml_path):
            wf = ADJ_MARKER.sub("", wf)
            lid = lemma_ids.get((wf, pos))
            if lid is None:
                lid = lemma_ids.get((wf.lower(), pos))
            if lid is None:
                pron_stats["unmatched"] += 1
                continue
            key = (lid, variety, "oewn", ipa)
            if key in seen:
                continue
            seen.add(key)
            if _looks_like_ipa(ipa):
                rs = friendly_respelling(ipa)
                rs_syll = syllabified_respelling(ipa, rs)
                if rs == ipa:
                    pron_stats["respell_fallback"] += 1
            else:
                # Plain-English respelling already (e.g. unmarked "wan").
                rs = ipa
                rs_syll = ipa
            pron_rows.append((lid, variety, ipa, rs, rs_syll, "oewn"))
            pron_stats["oewn"] += 1
    if cmudict_path:
        cmu = load_cmudict(cmudict_path)
        covered = {r[0] for r in pron_rows}
        for lid, lemma, _pos in con.execute("SELECT id, lemma, pos FROM lemma"):
            if lid in covered:
                continue
            arpa = cmu.get(lemma.upper())
            if not arpa:
                continue
            try:
                ipa = arpa_to_ipa(arpa)
            except ValueError:
                continue
            rs = friendly_respelling(ipa)
            rs_syll = syllabified_respelling(ipa, rs)
            if rs == ipa:
                pron_stats["respell_fallback"] += 1
            pron_rows.append((lid, "", ipa, rs, rs_syll, "cmudict"))
            pron_stats["cmudict"] += 1
    con.executemany(
        "INSERT INTO pronunciation(lemma_id, variety, ipa, respelling,"
        " respelling_syll, source) VALUES(?,?,?,?,?,?)", pron_rows)
    n_pron_lemmas = con.execute(
        "SELECT COUNT(DISTINCT lemma_id) FROM pronunciation").fetchone()[0]
    print(f"pronunciation rows: {len(pron_rows)} "
          f"(oewn {pron_stats['oewn']}, cmudict {pron_stats['cmudict']}, "
          f"unmatched xml {pron_stats['unmatched']}, "
          f"respell fallbacks {pron_stats['respell_fallback']})")

    con.executemany("INSERT INTO meta(key, value) VALUES(?,?)", [
        ("source", "Open English WordNet"),
        ("oewn_edition", edition),
        ("oewn_url", url),
        ("built_at", dt.datetime.now(dt.timezone.utc).isoformat()),
        ("content_policy",
         "canonical DB keeps all entries; content_flag marks taboo/offensive"
         " material for build-time filtering (phone-app builds ship filtered)"),
        ("pronunciation_sources", json.dumps({
            "oewn_xml": os.path.basename(xml_path) if xml_path else None,
            "cmudict": EDITIONS[edition]["cmudict_url"] if cmudict_path else None,
            "respelling": "attacktive/ipa-to-pronunciation-respelling"
                          " (MIT), ported to data/respell.py",
        })),
        ("pronunciation_counts", json.dumps({
            "rows": len(pron_rows),
            "oewn_rows": pron_stats["oewn"],
            "cmudict_rows": pron_stats["cmudict"],
            "lemmas_covered": n_pron_lemmas,
        })),
    ])
    con.commit()

    # --- validation -----------------------------------------------------
    exp = EDITIONS[edition]
    n_lemmas = con.execute("SELECT COUNT(*) FROM lemma").fetchone()[0]
    print("\n== validation ==")
    print(f"synsets:   {total_synsets:>8}  (published {exp['synsets']})")
    print(f"relations: {total_relations:>8}  (published {exp['relations']})")
    print(f"lemmas:    {n_lemmas:>8}  senses: {total_senses}")
    n_pron = con.execute("SELECT COUNT(*) FROM pronunciation").fetchone()[0]
    n_pron_lemmas = con.execute(
        "SELECT COUNT(DISTINCT lemma_id) FROM pronunciation").fetchone()[0]
    print(f"pronunciations: {n_pron:>8} rows covering {n_pron_lemmas} lemmas "
          f"({100.0 * n_pron_lemmas / n_lemmas:.1f}%)")
    print(f"content_flag rows: {con.execute('SELECT COUNT(*) FROM content_flag').fetchone()[0]}"
          f" (+ {con.execute('SELECT COUNT(*) FROM content_flag_synset').fetchone()[0]} synset flags;"
          " run data/build_flags.py to populate)")
    ok = True
    # Synsets must match: they prove the parse is structurally complete.
    if abs(total_synsets - exp["synsets"]) / exp["synsets"] > 0.01:
        print("ERROR: synset count off by more than 1%")
        ok = False
    # Relations: the WNDB "legacy" export carries fewer rows than the
    # published native-format count. The gap is reconciled (see
    # data/README.md) at the synset level: 628 rows are inverse
    # entailment/causation pairs stored forward-only, and 16,887 are native
    # "other" verb->noun links mostly present here as + (derivation).
    # Caveat: WNDB does NOT faithfully reproduce native sense-level
    # endpoints (only ~45% exact matches; 4 native links have no WNDB
    # pointer at all). Synset-level traversal is complete; word-level
    # lexical fidelity needs the native XML.
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
    ap.add_argument("--xml", default=None,
                    help="OEWN LMF XML for pronunciations "
                         "(default: data/english-wordnet-<edition>.xml.gz, "
                         "downloaded if missing)")
    ap.add_argument("--cmudict", default=None,
                    help="CMUdict file for pronunciation backfill "
                         "(default: data/cmudict.dict, downloaded if missing)")
    ap.add_argument("--no-pronunciation", action="store_true",
                    help="skip the pronunciation table entirely")
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

    xml_path, cmudict_path = None, None
    if not args.no_pronunciation:
        xml_path = args.xml or os.path.join(
            HERE, f"english-wordnet-{args.edition}.xml.gz")
        if not os.path.exists(xml_path):
            download(EDITIONS[args.edition]["xml_url"], xml_path)
        cmudict_path = args.cmudict or os.path.join(HERE, "cmudict.dict")
        if not os.path.exists(cmudict_path):
            download(EDITIONS[args.edition]["cmudict_url"], cmudict_path)
    ok = build(wndb_dir, args.db, args.edition, url, xml_path, cmudict_path)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
