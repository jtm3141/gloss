// gloss define — print the most common definition of a word.
// Usage: GLOSS_TIER=tiny node define.mjs time
import { configure, define } from "../../bindings/js/dist/index.js";

configure(); // resolves via GLOSS_DB, GLOSS_TIER, bundled tiny, or cache

const word = process.argv[2] ?? "time";
const d = define(word);
if (d == null) {
  console.error(`no definition found for "${word}"`);
  process.exit(1);
}
console.log(`${word}: ${d}`);
