// Smoke test for the gloss-dict JS binding.
// Run: npm run build && GLOSS_DB=/path/to/gloss.db npm run smoke
import { configure, define, lookup, search } from "./index";
import { resolveDbPath, selectedTier } from "./tiers";
import * as assert from "assert";

const dbPath = process.env.GLOSS_DB;
if (!dbPath) throw new Error("set GLOSS_DB to a gloss.db for the smoke test");
configure(dbPath);

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

// Tier selection: bundled tiny resolves offline; unknown tiers throw;
// the tiny tier agrees with the full database on the most common sense.
// (GLOSS_DB always wins, so clear it before exercising tier resolution.)
delete process.env.GLOSS_DB;
assert.strictEqual(selectedTier("tiny"), "tiny");
assert.throws(() => selectedTier("bogus"), /unknown gloss tier/);
const tinyPath = resolveDbPath({ tier: "tiny" });
assert.ok(tinyPath.endsWith("gloss-tiny.db"), "bundled tiny resolves");
configure(tinyPath);
assert.strictEqual(define("dog"), def, "tiny tier agrees on define('dog')");
const tinyEntry = lookup("dog");
assert.ok(
  tinyEntry &&
    tinyEntry.senses.length === 2 &&
    tinyEntry.senses[0].pos === "n" &&
    tinyEntry.senses[0].senseNo === 1 &&
    tinyEntry.senses[1].pos === "v" &&
    tinyEntry.senses[1].senseNo === 1,
  "tiny tier keeps the 1st sense per part of speech"
);

console.log(`JS binding smoke test: OK (${entry.senses.length} senses for 'dog')`);
