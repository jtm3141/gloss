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

## Pronunciation data — CMUdict

Pronunciation (IPA) data carried over from the original WordNet Dictionary
artifact is derived from CMUdict (Carnegie Mellon Pronouncing Dictionary),
which is BSD-licensed.

## Our code

All original code in this repository is MIT licensed (see `LICENSE`).
