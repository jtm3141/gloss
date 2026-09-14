// Smoke test: loads the real gzipped DB through sql.js (the same path the
// browser takes) and runs the app's define/suggest queries against it.
const { readFileSync } = require("node:fs");
const { join, dirname } = require("node:path");
const { gunzipSync } = require("node:zlib");
const { fileURLToPath } = require("node:url");

const here = __dirname;

// The browser bundle (per sql.js's "browser" export condition) requests a
// different wasm filename than the Node build; public/ must contain exactly
// the file the browser will ask for, or the page fails with "both async and
// sync fetching of the wasm failed" while this Node test still passes.
{
  const pkg = JSON.parse(
    readFileSync(join(here, "node_modules", "sql.js", "package.json"), "utf8")
  );
  const browserJs = pkg.exports["."].browser; // e.g. ./dist/sql-wasm-browser.js
  const browserWasm = browserJs.replace(/\.js$/, ".wasm").split("/").pop();
  const publicWasm = join(here, "public", browserWasm);
  readFileSync(publicWasm); // throws if prepare-data didn't stage it
  console.log(`browser wasm staged OK: public/${browserWasm}`);
}

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

  // related words: replicate the app's attachRelated() grouping
  const REL_GROUPS = [
    { ptrs: ["@", "@i"], label: "Broader" },
    { ptrs: ["~", "~i"], label: "Narrower" },
    { ptrs: ["!"], label: "Opposites" },
    { ptrs: ["&"], label: "Similar" },
    { ptrs: ["%m", "%s", "%p"], label: "Parts" }, // whole -> part (verified vs native XML)
    { ptrs: ["#m", "#s", "#p"], label: "Part of" }, // part -> whole
    { ptrs: ["^"], label: "See also" },
    { ptrs: ["+"], label: "Related forms" },
  ];
  const groupOf = new Map();
  for (const g of REL_GROUPS) for (const p of g.ptrs) groupOf.set(p, g.label);

  function related(so, pos, srcWp) {
    const rws = q(
      `SELECT r.ptr AS ptr, r.from_word AS fw, r.to_word AS tw, sw.word AS w
       FROM relation r JOIN synset_word sw
         ON sw.synset_offset = r.to_offset AND sw.pos = r.to_pos
       WHERE r.from_offset = ${so} AND r.from_pos = '${pos}'
       ORDER BY sw.word_pos`
    );
    const buckets = new Map();
    for (const r of rws) {
      const label = groupOf.get(r.ptr);
      if (!label) continue;
      if (r.fw !== 0 && r.fw !== srcWp + 1) continue;
      const b = buckets.get(label) || [];
      if (!b.some((x) => x.toLowerCase() === r.w.toLowerCase())) {
        if (r.tw !== 0) b.unshift(r.w);
        else b.push(r.w);
      }
      buckets.set(label, b);
    }
    return [...buckets.entries()].map(([label, words]) => ({ label, words }));
  }

  const dogSo = q(
    `SELECT s.synset_offset AS so,
            (SELECT w2.word_pos FROM synset_word w2
             WHERE w2.synset_offset = s.synset_offset AND w2.pos = s.pos
               AND w2.lemma_id = s.lemma_id) AS srcWp
     FROM sense s JOIN lemma l ON l.id = s.lemma_id
     WHERE l.lemma = 'dog' AND s.pos = 'n' AND s.sense_no = 1`
  )[0];
  const dogRel = related(dogSo.so, "n", dogSo.srcWp);
  console.log("dog sense 1 related:", JSON.stringify(dogRel.map((g) => [g.label, g.words.slice(0, 4)])));
  const broader = (dogRel.find((g) => g.label === "Broader") || { words: [] }).words;
  if (!broader.some((w) => w.toLowerCase() === "canine"))
    throw new Error("dog hypernym 'canine' missing");

  const goodSo = q(
    `SELECT s.synset_offset AS so,
            (SELECT w2.word_pos FROM synset_word w2
             WHERE w2.synset_offset = s.synset_offset AND w2.pos = s.pos
               AND w2.lemma_id = s.lemma_id) AS srcWp
     FROM sense s JOIN lemma l ON l.id = s.lemma_id
     WHERE l.lemma = 'good' AND s.pos = 'a' AND s.sense_no = 1`
  )[0];
  const goodRel = related(goodSo.so, "a", goodSo.srcWp);
  const opposites = (goodRel.find((g) => g.label === "Opposites") || { words: [] }).words;
  console.log("good sense 1 opposites:", JSON.stringify(opposites.slice(0, 4)));
  if (!opposites.some((w) => w.toLowerCase() === "bad"))
    throw new Error("word-level antonym good->bad missing");
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
