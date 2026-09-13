// Smoke test: loads the real gzipped DB through sql.js (the same path the
// browser takes) and runs the app's define/suggest queries against it.
const { readFileSync } = require("node:fs");
const { join, dirname } = require("node:path");
const { gunzipSync } = require("node:zlib");
const { fileURLToPath } = require("node:url");

const here = __dirname;

(async () => {
  const initSqlJs = require(join(here, "node_modules", "sql.js", "dist", "sql-wasm.js"));
  const SQL = await initSqlJs({
    locateFile: (f) => join(here, "node_modules", "sql.js", "dist", f),
  });
  const gz = readFileSync(join(here, "public", "gloss.db.gz"));
  const db = new SQL.Database(gunzipSync(gz));
  console.log("db loaded OK");

  const q = (sql) => {
    const r = db.exec(sql)[0];
    if (!r) return [];
    return r.values.map((row) => Object.fromEntries(row.map((v, i) => [r.columns[i], v])));
  };

  // define('dog') — the app's query, verbatim logic
  const word = "dog";
  const rows = q(
    `SELECT s.sense_no AS n, s.pos AS pos, s.definition AS definition,
            s.examples AS examples, sw.word AS w, sw.word_pos AS wp
     FROM sense s
     JOIN lemma l ON l.id = s.lemma_id
     LEFT JOIN synset_word sw
            ON sw.synset_offset = s.synset_offset AND sw.pos = s.pos
     WHERE l.lemma = '${word}' COLLATE NOCASE
     ORDER BY s.sense_no, sw.word_pos`
  );
  const senses = new Map();
  for (const r of rows) {
    const key = `${r.pos}:${r.n}`;
    if (!senses.has(key)) senses.set(key, { ...r, syns: [] });
    const w = (r.w || "").toLowerCase();
    if (w && w !== word && !senses.get(key).syns.includes(w)) senses.get(key).syns.push(w);
  }
  console.log(`define('dog'): ${senses.size} senses`);
  const first = [...senses.values()][0];
  console.log("  sense 1:", JSON.stringify({ pos: first.pos, definition: first.definition, syns: first.syns.slice(0, 4) }));
  console.log("  examples sample:", JSON.stringify(first.examples && first.examples.slice(0, 80)));
  if (senses.size !== 8) throw new Error(`expected 8 senses for dog, got ${senses.size}`);

  // severity-1 survivors still present in the filtered build
  for (const w of ["jesus", "damn", "nipple"]) {
    const n = q(`SELECT COUNT(*) c FROM sense s JOIN lemma l ON l.id=s.lemma_id WHERE l.lemma='${w}'`)[0].c;
    console.log(`define('${w}'): ${n} senses`);
    if (n === 0) throw new Error(`${w} missing from filtered build`);
  }
  // slur still gone
  const slur = q(`SELECT COUNT(*) c FROM lemma WHERE lemma='jap'`)[0].c;
  console.log(`lemma 'jap' rows: ${slur}`);
  if (slur !== 0) throw new Error("slur 'jap' present in filtered build");

  // suggest()
  const sug = q(`SELECT DISTINCT lemma FROM lemma WHERE lemma LIKE 'dogg%' ESCAPE '\\' ORDER BY LENGTH(lemma), lemma LIMIT 8`).map((r) => r.lemma);
  console.log("suggest('dogg'):", JSON.stringify(sug));

  // meta
  const meta = Object.fromEntries(q("SELECT key, value FROM meta").map((r) => [r.key, r.value]));
  console.log("meta keys:", Object.keys(meta).join(", "));

  console.log("SMOKE OK");
})().catch((e) => {
  console.error("SMOKE FAILED:", e.message);
  process.exit(1);
});
