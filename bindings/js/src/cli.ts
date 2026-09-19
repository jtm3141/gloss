#!/usr/bin/env node
// `gloss` — command-line interface for the gloss dictionary.
//
//   gloss [--db PATH] [--tier NAME] define WORD
//   gloss [--db PATH] [--tier NAME] suggest PREFIX
//   gloss [--db PATH] [--tier NAME] related WORD [PTR]
//   gloss download [--tier NAME]
//
// PTR is a WordNet pointer: @ hypernym, ~ hyponym, ! antonym, ... `related`
// defaults to @ on the most common sense. `download` pre-fetches a tier
// into the platform cache (default: the currently selected tier).

import { configure, define, lookup, related, search } from "./index";
import { downloadTier, selectedTier } from "./tiers";

function usage(): string {
  return `usage: gloss [--db PATH] [--tier NAME] <verb> [args]

verbs:
  define WORD          most common definition of WORD
  suggest PREFIX       lemmas starting with PREFIX, alphabetical
  related WORD [PTR]   relations of the most common sense (default PTR: @)
  download [--tier N]  pre-fetch a tier into the platform cache

global flags:
  --db PATH    explicit database (beats everything, incl. GLOSS_DB)
  --tier NAME  tiny|small|medium|full (default: full, or GLOSS_TIER)

pointer types: @ hypernym, ~ hyponym, ! antonym, ^ also-see, \\ derived-form, ...`;
}

function fail(msg: string): never {
  console.error(`gloss: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let dbPath: string | undefined;
  let tier: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") {
      dbPath = argv[++i];
      if (!dbPath) fail("usage: gloss --db PATH <verb> ...");
    } else if (a === "--tier") {
      tier = argv[++i];
      if (!tier) fail("usage: gloss --tier NAME <verb> ...");
    } else if (a === "-h" || a === "--help") {
      console.log(usage());
      return;
    } else if (a.startsWith("--")) {
      fail(`unknown option ${a}\n${usage()}`);
    } else {
      rest.push(a);
    }
  }

  const [verb, ...args] = rest;
  if (!verb) {
    console.log(usage());
    return;
  }

  if (verb === "download") {
    const p = await downloadTier(tier);
    console.log(`cached ${selectedTier(tier)} tier at ${p}`);
    return;
  }

  if (verb !== "define" && verb !== "suggest" && verb !== "related")
    fail(`unknown verb "${verb}"\n${usage()}`);

  // Resolve the database: explicit --db (or GLOSS_DB) wins; otherwise make
  // sure the selected tier is available locally, downloading if needed.
  configure(dbPath ?? process.env.GLOSS_DB ?? (await downloadTier(tier)));

  switch (verb) {
    case "define": {
      const [word] = args;
      if (!word) fail("usage: gloss define WORD");
      const d = define(word);
      if (d == null) fail(`no definition found for "${word}"`);
      console.log(d);
      break;
    }
    case "suggest": {
      const [prefix] = args;
      if (prefix == null) fail("usage: gloss suggest PREFIX");
      for (const w of search(prefix)) console.log(w);
      break;
    }
    case "related": {
      const [word, ptr = "@"] = args;
      if (!word) fail("usage: gloss related WORD [PTR]");
      const rels = related(word, ptr);
      if (!rels.length) {
        if (lookup(word) == null) fail(`no entry found for "${word}"`);
        console.log(`(no "${ptr}" relations for "${word}")`);
        break;
      }
      for (const r of rels) console.log(`${r.words.join(", ")} — ${r.definition}`);
      break;
    }
  }
}

main().catch((e) => fail((e as Error).message));
