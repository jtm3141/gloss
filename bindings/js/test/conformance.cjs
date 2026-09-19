#!/usr/bin/env node
// Conformance test for the gloss-dict JS binding (node:sqlite backend).
// Checks every case in data/conformance.json. Stdlib only:
//
//   cd bindings/js && npm run build && npm test [path/to/gloss.db]
//
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { configure, define, lookup, search } = require("../dist/index.js");

const DATA = path.resolve(__dirname, "..", "..", "..", "data");
const failures = [];

function check(cond, msg) {
  if (!cond) {
    failures.push(msg);
    console.error("  FAIL:", msg);
  }
}

function main() {
  const dbPath = process.argv[2] || path.join(DATA, "gloss.db");
  if (!fs.existsSync(dbPath)) {
    console.error(`conformance: database not found: ${dbPath}`);
    process.exit(2);
  }
  const fixture = JSON.parse(
    fs.readFileSync(path.join(DATA, "conformance.json"), "utf8")
  ).cases;
  configure(dbPath);

  for (const c of fixture) {
    const word = c.word;
    check(define(word) === c.define, `${word}: define() mismatch`);
    const entry = lookup(word);
    if (!c.senses.length) {
      check(entry === null, `${word}: lookup() should be null`);
      continue;
    }
    check(entry !== null, `${word}: lookup() returned null`);
    if (!entry) continue;
    check(
      entry.senses.length === c.senses.length,
      `${word}: ${entry.senses.length} senses != ${c.senses.length}`
    );
    c.senses.forEach((fsense, i) => {
      const s = entry.senses[i];
      if (!s) return;
      const tag = `${word} sense ${i + 1}`;
      check(s.pos === fsense.pos, `${tag}: pos`);
      check(s.senseNo === fsense.sense_no, `${tag}: sense_no`);
      check(s.definition === fsense.definition, `${tag}: definition`);
      check(
        JSON.stringify(s.examples) === JSON.stringify(fsense.examples),
        `${tag}: examples`
      );
      check(
        JSON.stringify(s.synonyms) === JSON.stringify(fsense.synonyms),
        `${tag}: synonyms`
      );
      for (const name of ["antonyms", "hypernyms", "hyponyms"]) {
        const got = s[name]().map((r) => ({
          words: r.words,
          definition: r.definition,
        }));
        check(
          JSON.stringify(got) === JSON.stringify(fsense[name]),
          `${tag}: ${name}`
        );
      }
    });
  }

  check(search("dog", 5).includes("dog"), "search('dog') should contain 'dog'");

  console.log(`\n${fixture.length} words checked, ${failures.length} failures`);
  process.exit(failures.length ? 1 : 0);
}

main();
