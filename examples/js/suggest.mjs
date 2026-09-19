// gloss suggest — print lemmas starting with a prefix, alphabetical.
// Usage: GLOSS_TIER=tiny node suggest.mjs ser
import { configure, search } from "../../bindings/js/dist/index.js";

configure(); // resolves via GLOSS_DB, GLOSS_TIER, bundled tiny, or cache

const prefix = process.argv[2] ?? "ser";
for (const w of search(prefix, 10)) console.log(w);
