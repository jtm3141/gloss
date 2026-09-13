// Smoke test for the gloss-dict JS binding. Run: npm run build && npm run smoke
// (expects data/gloss.db nearby — run from the repo root or set GLOSS_DB).
import { configure, define, lookup, search } from "./index";
import * as assert from "assert";

if (process.env.GLOSS_DB) configure(process.env.GLOSS_DB);

const def = define("dog");
assert.ok(def && def.includes("genus Canis"), "define('dog')");
assert.strictEqual(define("xyzzy"), null, "define('xyzzy') is null");

const entry = lookup("dog");
assert.ok(entry && entry.senses.length > 0, "lookup('dog') has senses");
assert.strictEqual(entry.senses[0].pos, "n");
assert.strictEqual(entry.senses[0].definition, def);
assert.ok(entry.senses[0].synonyms.length > 0, "synonyms");
assert.ok(entry.senses[0].hypernyms().length > 0, "hypernyms");
assert.strictEqual(lookup("xyzzy"), null, "lookup('xyzzy') is null");

assert.ok(search("dog", 5).includes("dog"), "search('dog')");

console.log(`JS binding smoke test: OK (${entry.senses.length} senses for 'dog')`);
