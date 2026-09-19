// gloss related — hypernyms of the most common sense of a word.
// Usage: GLOSS_TIER=tiny node related.mjs dog [@|~|!]
import { configure, lookup } from "../../bindings/js/dist/index.js";

configure(); // resolves via GLOSS_DB, GLOSS_TIER, bundled tiny, or cache

const word = process.argv[2] ?? "dog";
const ptr = process.argv[3] ?? "@"; // @ hypernym, ~ hyponym, ! antonym
const entry = lookup(word);
if (entry == null) {
  console.error(`no entry found for "${word}"`);
  process.exit(1);
}
const sense = entry.senses[0];
const rels =
  ptr === "~" ? sense.hyponyms() : ptr === "!" ? sense.antonyms() : sense.hypernyms();
console.log(`${word} (${sense.pos}${sense.senseNo}): ${sense.definition}`);
for (const r of rels) console.log(`  ${ptr} ${r.words.join(", ")} — ${r.definition}`);
