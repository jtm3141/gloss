# Attribution

gloss stands on the shoulders of open lexical data. If you redistribute gloss
or anything built from it, keep these credits intact.

## Dictionary data — Open English WordNet

- **Source:** [Open English WordNet](https://github.com/globalwordnet/english-wordnet)
  (Global WordNet Association), yearly edition downloads at
  <https://en-word.net/>
- **License:** [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) —
  free to use, modify, and redistribute, including commercially, with attribution.
- **Provenance:** the exact edition and download URL used to build `gloss.db`
  are recorded in the database itself (`meta` table: `oewn_edition`,
  `oewn_url`, `built_at`). Never ship a database you can't trace.
- **Canonical citation:** John P. McCrae, Alexandre Rademaker, Francis Bond,
  Ewa Rudnicka and Christiane Fellbaum (2019). *English WordNet 2019 – An
  Open-Source WordNet for English.* Proceedings of GWC 2019.

## Ancestry — Princeton WordNet

Open English WordNet incorporates and corrects Princeton University's WordNet.
"WordNet" is a registered trademark of Princeton University. Princeton's
original database and tools were released under a BSD-style license and are
freely available.

## Taboo/offensive-word filter sources

The canonical database keeps all entries and flags taboo/offensive ones
(`content_flag`, `content_flag_synset`); filtered builds remove flagged
entries at build time (`data/build_flags.py`, `data/make_filtered.py`).
Flag sources:

- **dsojevic/profanity-list** — <https://github.com/dsojevic/profanity-list> —
  **MIT**, (c) 2021 David Sojevic. Used: `en.json` profanity match patterns
  (with `exceptions` honored; matching is anchored whole-headword only, per
  the list's `allow_partial` semantics). Severity 1–4 and tags recorded per
  flag; most entries default to severity 3 in the source, so severity is
  recorded, not trusted as ground truth.
- **LDNOOBW** ("List of Dirty, Naughty, Obscene, and Otherwise Bad Words") —
  <https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words> —
  **CC-BY 4.0**, (c) 2012–2020 Shutterstock, Inc. Used: `en` word list,
  exact headword match.
- **OEWN-native usage signals** — same CC-BY 4.0 as the dictionary data
  above. Definition usage labels (`(ethnic slur)`, `(offensive)`, `(vulgar)`,
  …) and `exemplifies` links into the "ethnic slur" usage domain. These are
  sense-aware (`content_flag_synset`), so e.g. "boy" keeps its clean senses
  while its slur sense is flagged.

The exact source versions (fetch date + sha256) are recorded on every flag
row and in the `meta` table (`content_flag_sources`).

## Pronunciation data — CMUdict (planned, not yet imported)

Pronunciation (IPA) support is planned from CMUdict (Carnegie Mellon
Pronouncing Dictionary), which is BSD-licensed. No pronunciation data is
in the database yet; this section is a placeholder until it lands.

## Our code

All original code in this repository is MIT licensed (see `LICENSE`).
