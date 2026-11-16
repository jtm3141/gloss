#!/usr/bin/env python3
"""Build a filtered copy of gloss.db with taboo/offensive entries removed.

Reads content_flag (lemma-level: the whole headword is taboo) and
content_flag_synset (sense-level: one synset is taboo) from the canonical
DB, then in the copy:

  1. removes every policy-selected flagged lemma's senses and synset words,
  2. removes every flagged synset -- its words, senses, and relations,
  3. prunes relations left dangling (synset or word endpoint gone),
  4. drops lemmas left with no senses,
  5. scrubs example sentences that mention a policy-filtered lemma (the
     sense stays; only the offending example string goes -- a removed
     headword must not survive inside example text),
  6. drops the flag tables (the shipped DB is clean; the canonical DB
     keeps the flags for audit),
  7. stamps meta: build_profile=filtered, filtered_at, removal counts.

Filtering policy (DEFAULT_POLICY, overridable via CLI):
  - OEWN-native flags (oewn-usage-label, oewn-slur-domain) are ALWAYS
    applied. They are sense-aware and authoritative; no knob disables them,
    so genuine slur senses are removed whatever the third-party settings.
  - dsojevic/profanity-list flags apply at severity >= dsojevic_min_severity
    (default 2: severity-1 "mild" terms such as damn, hell, penis are kept;
    any slur senses among them are still caught by the OEWN tier).
  - LDNOOBW flags carry no severity ratings; applied as a whole unless
    --no-ldnoobw.

Usage:
    python data/make_filtered.py --db data/gloss.db --out data/gloss-filtered.db
    python data/make_filtered.py --dsojevic-min-severity 1  # remove everything flagged

Prints a removal report. Importable: make_filtered(src, out, policy=None) -> dict.
"""

import argparse
import datetime as dt
import json
import os
import re
import shutil
import sqlite3


DEFAULT_POLICY = {
    # OEWN-native tiers are authoritative and always applied (no knob).
    "oewn_usage_label": True,
    "oewn_slur_domain": True,
    # Third-party list knobs:
    "dsojevic_min_severity": 2,  # 1..4; 1 = remove everything list-flagged
    "ldnoobw": True,
}

POLICY_DESCRIPTION = (
    "OEWN usage-label + slur-domain flags always applied (authoritative, "
    "sense-aware); dsojevic/profanity-list flags applied at severity >= "
    "{dsojevic_min_severity}; LDNOOBW flags {ldnoobw_state}."
)


def describe_policy(policy):
    return POLICY_DESCRIPTION.format(
        dsojevic_min_severity=policy["dsojevic_min_severity"],
        ldnoobw_state="applied" if policy["ldnoobw"] else "skipped",
    )


# Latin "cum laude" is exempt from the example scrub: "cum" there is
# Latin for "with", not the profanity -- the same Scunthorpe caution
# build_flags.py applies when flagging headwords.
_CUM_LAUDE = re.compile(r"\bcum laude\b", re.I)


def example_matcher(words):
    """One compiled regex matching any of `words` as whole words.

    Same rule as the flagging: whole words only, never substrings, so
    "sparse" stays safe from "arse" and "cocktail" from "cock".
    Multiword lemmas match across whitespace."""
    def rx_for(w):
        return r"\b" + r"\s+".join(map(re.escape, w.split())) + r"\b"
    return re.compile("|".join(
        rx_for(w) for w in sorted(words, key=len, reverse=True)), re.I)


def scrub_examples(con, flagged_words):
    """Remove example sentences that mention a policy-filtered lemma.

    The sense itself stays; only the offending example string is dropped
    from the sense's JSON example array. Returns (senses_touched,
    examples_removed)."""
    pat = example_matcher(flagged_words)
    touched = removed = 0
    rows = con.execute(
        "SELECT id, examples FROM sense WHERE examples NOT IN ('[]','')").fetchall()
    for sid, examples in rows:
        try:
            exs = json.loads(examples)
        except ValueError:
            continue
        kept = [e for e in exs if not pat.search(_CUM_LAUDE.sub("", e))]
        if len(kept) != len(exs):
            con.execute("UPDATE sense SET examples = ? WHERE id = ?",
                        (json.dumps(kept), sid))
            touched += 1
            removed += len(exs) - len(kept)
    return touched, removed


def policy_flagged_lemma_ids(con, policy):
    """Lemma ids this policy actually filters: a subset of content_flag."""
    ids = set()
    # OEWN slur-domain lemma flags are always applied.
    ids.update(r[0] for r in con.execute(
        "SELECT lemma_id FROM content_flag WHERE source = 'oewn-slur-domain'"))
    # dsojevic at or above the severity threshold.
    ids.update(r[0] for r in con.execute(
        "SELECT lemma_id FROM content_flag "
        "WHERE source = 'dsojevic/profanity-list' AND severity >= ?",
        (policy["dsojevic_min_severity"],)))
    # LDNOOBW carries no severity ratings; applied as a whole unless disabled.
    if policy["ldnoobw"]:
        ids.update(r[0] for r in con.execute(
            "SELECT lemma_id FROM content_flag WHERE source = 'LDNOOBW'"))
    return ids


def policy_flagged_synsets(con):
    """(offset, pos) pairs this policy filters.

    content_flag_synset is entirely OEWN-native and always applied.
    """
    return [tuple(r) for r in con.execute(
        "SELECT synset_offset, pos FROM content_flag_synset")]


def make_filtered(src, out, policy=None):
    policy = dict(DEFAULT_POLICY, **(policy or {}))
    if os.path.abspath(src) == os.path.abspath(out):
        raise SystemExit("refusing to filter the db in place; use --out")
    shutil.copy(src, out)
    con = sqlite3.connect(out)
    con.execute("PRAGMA foreign_keys = OFF")
    report = {"policy": policy, "policy_description": describe_policy(policy)}

    def n(q, p=()):
        return con.execute(q, p).fetchone()[0]

    def has_table(name):
        return con.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
            (name,)).fetchone()[0] > 0

    # Tables for the removal report. pronunciation exists in DBs built
    # with pronunciation support; older DBs filter fine without it.
    report_tables = ["lemma", "sense", "synset", "synset_word", "relation"]
    if has_table("pronunciation"):
        report_tables.append("pronunciation")

    total_flagged_lemmas = n("SELECT COUNT(*) FROM content_flag")
    total_flagged_synsets = n("SELECT COUNT(*) FROM content_flag_synset")
    report["flagged_lemmas_total"] = total_flagged_lemmas
    report["flagged_synsets_total"] = total_flagged_synsets

    # The exact flag rows this policy applies (temp tables keep the
    # DELETEs and the safety tests on the same set).
    con.execute("CREATE TEMP TABLE policy_lemma(lemma_id INTEGER PRIMARY KEY)")
    con.executemany("INSERT OR IGNORE INTO policy_lemma VALUES(?)",
                    [(i,) for i in policy_flagged_lemma_ids(con, policy)])
    con.execute("CREATE TEMP TABLE policy_synset(synset_offset INTEGER, pos TEXT, "
                "PRIMARY KEY (synset_offset, pos))")
    con.executemany("INSERT OR IGNORE INTO policy_synset VALUES(?,?)",
                    policy_flagged_synsets(con))
    # The flagged headwords themselves, for the example scrub below.
    # Captured now: the lemma rows are deleted by the prune step.
    flagged_words = [r[0] for r in con.execute(
        "SELECT lemma FROM lemma WHERE id IN (SELECT lemma_id FROM policy_lemma)")]
    report["flagged_lemmas_applied"] = n("SELECT COUNT(*) FROM policy_lemma")
    report["flagged_synsets_applied"] = n("SELECT COUNT(*) FROM policy_synset")
    report["flagged_lemmas_retained"] = (
        total_flagged_lemmas - report["flagged_lemmas_applied"])

    before = {t: n(f"SELECT COUNT(*) FROM {t}") for t in report_tables}

    # 1. policy-flagged lemmas lose their senses and synset words
    con.execute("DELETE FROM sense WHERE lemma_id IN "
                "(SELECT lemma_id FROM policy_lemma)")
    con.execute("DELETE FROM synset_word WHERE lemma_id IN "
                "(SELECT lemma_id FROM policy_lemma)")
    # 2. flagged synsets lose words, senses, and the synset itself
    con.execute("DELETE FROM sense WHERE (synset_offset, pos) IN "
                "(SELECT synset_offset, pos FROM policy_synset)")
    con.execute("DELETE FROM synset_word WHERE (synset_offset, pos) IN "
                "(SELECT synset_offset, pos FROM policy_synset)")
    con.execute("DELETE FROM synset WHERE (offset, pos) IN "
                "(SELECT synset_offset, pos FROM policy_synset)")
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
    # Pronunciations belong to lemmas; drop rows whose lemma is gone.
    if has_table("pronunciation"):
        con.execute("DELETE FROM pronunciation WHERE lemma_id NOT IN "
                    "(SELECT id FROM lemma)")

    # 5. scrub examples that mention a policy-filtered lemma
    touched, removed = scrub_examples(con, flagged_words)
    report["senses_with_examples_scrubbed"] = touched
    report["examples_removed"] = removed

    # 6. the shipped db is clean; flags stay in the canonical db
    con.execute("DROP TABLE content_flag")
    con.execute("DROP TABLE content_flag_synset")

    after = {t: n(f"SELECT COUNT(*) FROM {t}") for t in report_tables}
    report["removed"] = {t: before[t] - after[t] for t in before}
    report.update({f"{t}_kept": after[t] for t in after})

    con.execute("DELETE FROM meta WHERE key IN "
                "('content_policy', 'build_profile', 'filtered_at', "
                "'filtered_counts', 'content_flag_built_at', 'content_flag_sources')")
    con.executemany("INSERT INTO meta(key, value) VALUES(?,?)", [
        ("build_profile", "filtered"),
        ("filtered_at", dt.datetime.now(dt.timezone.utc).isoformat()),
        ("content_policy",
         "filtered build: " + describe_policy(policy) + " "
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
    ap.add_argument("--dsojevic-min-severity", type=int, choices=[1, 2, 3, 4],
                    default=DEFAULT_POLICY["dsojevic_min_severity"],
                    help="apply dsojevic/profanity-list flags at severity >= N "
                         "(default 2; 1 removes everything list-flagged)")
    ap.add_argument("--no-ldnoobw", action="store_true",
                    help="skip LDNOOBW lemma flags")
    args = ap.parse_args()
    policy = dict(DEFAULT_POLICY,
                  dsojevic_min_severity=args.dsojevic_min_severity,
                  ldnoobw=not args.no_ldnoobw)
    report = make_filtered(args.db, args.out, policy)
    print(f"filtered db: {args.out}")
    print(f"  policy: {report['policy_description']}")
    print(f"  flagged lemmas: {report['flagged_lemmas_applied']} applied, "
          f"{report['flagged_lemmas_retained']} retained "
          f"(of {report['flagged_lemmas_total']} total)")
    print(f"  flagged synsets: {report['flagged_synsets_applied']} applied "
          f"(of {report['flagged_synsets_total']} total)")
    print("  removed:")
    for t, c in report["removed"].items():
        print(f"    {t}: {c}")
    print(f"  examples scrubbed: {report['examples_removed']} removed from "
          f"{report['senses_with_examples_scrubbed']} senses")
    print("  kept:")
    for t in report["removed"]:
        print(f"    {t}: {report[f'{t}_kept']}")


if __name__ == "__main__":
    main()
