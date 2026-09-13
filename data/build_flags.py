#!/usr/bin/env python3
"""Populate the taboo/offensive content flags in gloss.db.

Three sources, all fetched as versioned downloads (never scraped):

1. dsojevic/profanity-list (en.json) -- MIT, (c) 2021 David Sojevic.
   434 profanities with match patterns. Pattern semantics, per the repo:
     * `|` separates alternative spellings,
     * `*` means the previous character appears one or more times
       (elongation: "ba*sta*rd" matches "bastard", "baastaard", ...),
     * `exceptions` exempt partial matches ("sp*" -> "sparse" for "arse"),
     * `severity` 1 (mild) .. 4 (severe); `tags` e.g. sexual, racial.
   We match whole dictionary headwords only (anchored), never substrings:
   a headword either IS the profanity or it isn't. That is the correct
   reading of the list's `allow_partial` flag for a dictionary -- and it is
   what keeps "sparse", "manuscript" and "Scunthorpe" safe.

2. LDNOOBW "List of Dirty, Naughty, Obscene, and Otherwise Bad Words" (en)
   -- CC-BY 4.0, (c) 2012-2020 Shutterstock, Inc. Flat list, exact match.

3. OEWN-native usage signals -- CC-BY 4.0, same license as the corpus:
   definition usage labels ("(ethnic slur)", "(vulgar)", ...) and
   `exemplifies` links into the "ethnic slur" usage-domain synset.
   These are sense-aware, so they populate content_flag_synset and NEVER
   content_flag: flagging the lemma "boy" would nuke its clean senses.

License notices for (1) and (2) live in ATTRIBUTION.md. The source URL,
license, version (date + sha256) and reason are recorded on every flag
row, and the source set is recorded in the meta table.

Usage:
    python data/build_flags.py --db data/gloss.db [--cache-dir DIR] [--offline]

Idempotent: clears both flag tables and repopulates them.
"""

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sqlite3
import sys
import urllib.request

SOURCES = [
    {
        "key": "dsojevic",
        "name": "dsojevic/profanity-list",
        "url": "https://raw.githubusercontent.com/dsojevic/profanity-list/main/en.json",
        "license": "MIT, (c) 2021 David Sojevic",
    },
    {
        "key": "ldnoobw",
        "name": "LDNOOBW",
        "url": "https://raw.githubusercontent.com/LDNOOBW/"
               "List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en",
        "license": "CC-BY-4.0, (c) 2012-2020 Shutterstock, Inc.",
    },
]

# OEWN-native: parenthesized usage labels that mark a sense offensive.
# The paren must BE a label -- nothing but the label inside. Descriptive
# parens like "(usually in offensive language)" or "(as a slurry)" (which
# merely contains "slur" as a substring!) are not usage labels.
# Plain (slang)/(colloquial) labels are deliberately NOT offensive --
# flagging them would nuke benign words like "power trip".
_TIGHT_LABEL = re.compile(
    r"\((?:sometimes |often |usually )?"
    r"(?:ethnic slur|racial slur|offensive|vulgar|derogatory|disparaging|taboo)"
    r"(?:[ ,]+(?:slang|colloquial|British slang))?\)", re.I)
# OEWN's other phrasing for "this headword is now a slur".
_NOW_OFFENSIVE = re.compile(r"\([^()]*\bnow considered offensive\b[^()]*\)", re.I)
_OFFTERM = re.compile(r"\boffensive (?:term|name|word)s? for\b", re.I)


def fetch(url, cache_path, offline):
    if os.path.exists(cache_path) and offline:
        with open(cache_path, "rb") as f:
            return f.read()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "gloss-build/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
    except Exception as e:
        if os.path.exists(cache_path):
            print(f"  download failed ({e}); using cache", file=sys.stderr)
            with open(cache_path, "rb") as f:
                return f.read()
        raise SystemExit(f"cannot fetch {url}: {e}")
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    with open(cache_path, "wb") as f:
        f.write(data)
    return data


def compile_entry(entry):
    """Compile one dsojevic entry -> list of (regex_or_None, literals, exceptions).

    `*` = previous character, one or more (per the repo spec). Exceptions
    use `*` as a placeholder for the matched word ("sp*" -> "sparse").
    """
    out = []
    for alt in entry["match"].split("|"):
        alt = alt.strip().lower()
        if not alt:
            continue
        if "*" in alt:
            body = []
            for ch in alt:
                if ch == "*":
                    if body and not body[-1].endswith("+"):
                        body[-1] += "+"
                    # a '*' with nothing before it has no meaning; drop it
                else:
                    body.append(re.escape(ch))
            rx = re.compile("".join(body))
            lits = [alt.replace("*", "")]
        else:
            rx = None
            lits = [alt]
        excs = [e.replace("*", lit).lower()
                for e in entry.get("exceptions", []) for lit in lits]
        out.append((rx, lits, excs))
    return out


def usage_label(defn):
    """Return the offensive usage label in a definition, or None.

    Only tight labels count: the whole paren must be the label. Plain
    (slang)/(colloquial) labels are deliberately NOT offensive -- flagging
    them would nuke benign words like "power trip".
    """
    m = _TIGHT_LABEL.search(defn)
    if m:
        return m.group(0)
    m = _NOW_OFFENSIVE.search(defn)
    if m:
        return m.group(0)
    if _OFFTERM.search(defn):
        return "offensive term/name for"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/gloss.db")
    ap.add_argument("--cache-dir", default="data/.cache/taboo")
    ap.add_argument("--offline", action="store_true",
                    help="use cached downloads only")
    args = ap.parse_args()

    con = sqlite3.connect(args.db)
    tables = {r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    if not {"content_flag", "content_flag_synset"} <= tables:
        raise SystemExit("db lacks the flag tables; rebuild with data/build_db.py")

    today = dt.date.today().isoformat()
    lemmas = [(r[0], r[1].lower())
              for r in con.execute("SELECT id, lemma FROM lemma")]

    flags = {}          # lemma_id -> (reason, source, category, severity, version)
    src_versions = []   # for the meta table

    # --- 1. dsojevic/profanity-list -------------------------------------
    src = SOURCES[0]
    raw = fetch(src["url"], os.path.join(args.cache_dir, "dsojevic-en.json"),
                args.offline)
    version = f"{today} sha256:{hashlib.sha256(raw).hexdigest()[:12]}"
    src_versions.append({"source": src["name"], "url": src["url"],
                         "license": src["license"], "version": version})
    entries = json.loads(raw.decode("utf-8"))
    # Split alternatives into O(1) exact lookups and anchored regexes.
    # (Entries may mix both kinds; split per alternative, not per entry.)
    exact_index = {}   # literal -> [(entry, exceptions)]
    star_alts = []     # [(entry, regex, exceptions)]
    for e in entries:
        for rx, lits, excs in compile_entry(e):
            if rx is None:
                for lit in lits:
                    exact_index.setdefault(lit, []).append((e, excs))
            else:
                star_alts.append((e, rx, excs))
    n_ds = 0
    for lid, text in lemmas:
        hit = None
        if text in exact_index:
            for e, excs in exact_index[text]:
                if not any(x in text for x in excs):
                    hit = e
                    break
        if hit is None:
            for e, rx, excs in star_alts:
                if rx.fullmatch(text) and not any(x in text for x in excs):
                    hit = e
                    break
        if hit is not None:
            tags = ",".join(hit.get("tags", []))
            flags[lid] = (
                f"dsojevic/profanity-list id={hit['id']} "
                f"tags=[{tags}] severity={hit['severity']}",
                src["name"], tags or None, hit["severity"], version)
            n_ds += 1
    print(f"dsojevic/profanity-list: {len(entries)} entries -> {n_ds} lemma flags")

    # --- 2. LDNOOBW ------------------------------------------------------
    src = SOURCES[1]
    raw = fetch(src["url"], os.path.join(args.cache_dir, "ldnoobw-en.txt"),
                args.offline)
    version = f"{today} sha256:{hashlib.sha256(raw).hexdigest()[:12]}"
    src_versions.append({"source": src["name"], "url": src["url"],
                         "license": src["license"], "version": version})
    words = {ln.strip().lower() for ln in raw.decode("utf-8").splitlines()
             if ln.strip()}
    lemma_by_text = {}
    for lid, text in lemmas:
        lemma_by_text.setdefault(text, lid)
    n_ld = 0
    for w in sorted(words):
        lid = lemma_by_text.get(w)
        if lid is not None and lid not in flags:
            flags[lid] = (f"LDNOOBW list entry {w!r}", src["name"],
                          None, None, version)
            n_ld += 1
    print(f"LDNOOBW: {len(words)} entries -> {n_ld} new lemma flags")

    # --- 3. OEWN-native usage signals (synset-level) ----------------------
    syn_flags = {}  # (offset, pos) -> (reason, source)
    n_label = 0
    for off, pos, definition in con.execute(
            "SELECT offset, pos, definition FROM synset"):
        lab = usage_label(definition)
        if lab:
            syn_flags[(off, pos)] = (
                f"oewn usage label {lab}", "oewn-usage-label")
            n_label += 1
    dom = con.execute(
        """SELECT s.offset, s.pos FROM synset s
           JOIN synset_word w ON w.synset_offset = s.offset AND w.pos = s.pos
           WHERE w.word = 'ethnic slur'
             AND s.definition LIKE 'a slur on someone%'""").fetchone()
    n_dom = 0
    if dom:
        for off, pos in con.execute(
                "SELECT DISTINCT from_offset, from_pos FROM relation "
                "WHERE ptr = ';u' AND to_offset = ? AND to_pos = ?",
                dom):
            if (off, pos) not in syn_flags:
                syn_flags[(off, pos)] = (
                    "oewn exemplifies link to the 'ethnic slur' usage domain",
                    "oewn-slur-domain")
                n_dom += 1
    else:
        print("  WARNING: ethnic-slur domain synset not found", file=sys.stderr)
    print(f"oewn-native: {n_label} usage-label synsets + {n_dom} slur-domain synsets")

    # --- write ------------------------------------------------------------
    con.execute("DELETE FROM content_flag")
    con.execute("DELETE FROM content_flag_synset")
    con.executemany(
        "INSERT INTO content_flag(lemma_id, reason, source, category, "
        "severity, source_version) VALUES(?,?,?,?,?,?)",
        [(lid,) + v for lid, v in flags.items()])
    con.executemany(
        "INSERT INTO content_flag_synset(synset_offset, pos, reason, source) "
        "VALUES(?,?,?,?)",
        [(off, pos) + v for (off, pos), v in syn_flags.items()])
    con.execute("DELETE FROM meta WHERE key LIKE 'content_flag%'")
    con.executemany("INSERT INTO meta(key, value) VALUES(?,?)", [
        ("content_flag_built_at",
         dt.datetime.now(dt.timezone.utc).isoformat()),
        ("content_flag_sources", json.dumps(src_versions, indent=1)),
    ])
    con.commit()

    print(f"\ncontent_flag rows:         {len(flags)}")
    print(f"content_flag_synset rows:  {len(syn_flags)}")
    print("\nOEWN-native synset flags (full audit list):")
    for (off, pos), (reason, source) in sorted(syn_flags.items()):
        words = [r[0] for r in con.execute(
            "SELECT word FROM synset_word WHERE synset_offset = ? AND pos = ? "
            "ORDER BY word_pos LIMIT 6", (off, pos))]
        definition = con.execute(
            "SELECT definition FROM synset WHERE offset = ? AND pos = ?",
            (off, pos)).fetchone()[0]
        print(f"  ({off},{pos}) [{source}] {words}: {definition[:80]}")
    con.close()


if __name__ == "__main__":
    main()
