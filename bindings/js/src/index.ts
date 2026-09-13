// gloss-dict — TypeScript binding for the gloss dictionary engine.
//
//   import { define, lookup, configure } from "gloss-dict";
//   configure("/path/to/gloss.db");   // or set GLOSS_DB, or keep data/gloss.db nearby
//   define("dog");                    // most common definition
//   lookup("dog");                    // every sense + relations
//
// Node backend is better-sqlite3 (bundled). A WASM core for browsers is planned.

import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

const POS_ORDER = ["n", "v", "a", "r"] as const;
const REL_CAP = 40;

export interface Related {
  words: string[];
  definition: string;
}

export interface Sense {
  pos: string;
  senseNo: number;
  definition: string;
  examples: string[];
  synonyms: string[];
  antonyms(): Related[];
  hypernyms(): Related[];
  hyponyms(): Related[];
}

export interface Entry {
  word: string;
  senses: Sense[];
}

let db: Database.Database | null = null;

function findDb(): string {
  const env = process.env.GLOSS_DB;
  if (env) return env;
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, "data", "gloss.db");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "no gloss.db found: call configure(path), set GLOSS_DB, or run where data/gloss.db is nearby"
  );
}

/** Point the module at a gloss.db file. */
export function configure(dbPath?: string): void {
  if (db) db.close();
  const p = dbPath ?? findDb();
  db = new Database(p, { readonly: true });
}

function conn(): Database.Database {
  if (!db) configure();
  return db!;
}

function synsetWords(c: Database.Database, offset: number, pos: string): string[] {
  // Surface forms from the data file, in synset word order.
  return c
    .prepare(
      `SELECT word FROM synset_word
       WHERE synset_offset = ? AND pos = ? ORDER BY word_pos`
    )
    .all(offset, pos)
    .map((r: any) => r.word as string);
}

// Exact form first, then lowercase (data files keep original case).
function wordForms(word: string): string[] {
  const lower = word.toLowerCase();
  return lower === word ? [word] : [word, lower];
}

function relatedFor(
  c: Database.Database,
  sense: { synsetOffset: number; synsetPos: string },
  ptr: string
): Related[] {
  const rows = c
    .prepare(
      `SELECT to_offset AS toOffset, to_pos AS toPos FROM relation
       WHERE from_offset = ? AND from_pos = ? AND ptr = ?
       ORDER BY to_offset LIMIT ?`
    )
    .all(sense.synsetOffset, sense.synsetPos, ptr, REL_CAP) as any[];
  return rows.map((r) => ({
    words: synsetWords(c, r.toOffset, r.toPos),
    definition: (
      c.prepare(`SELECT definition FROM synset WHERE offset = ? AND pos = ?`).get(
        r.toOffset,
        r.toPos
      ) as any
    ).definition as string,
  }));
}

/** The single most common definition of `word` (POS tried n, v, a, r), or null. */
export function define(word: string): string | null {
  const c = conn();
  const stmt = c.prepare(
    `SELECT s.definition FROM sense s JOIN lemma l ON l.id = s.lemma_id
     WHERE l.lemma = ? AND l.pos = ? AND s.sense_no = 1`
  );
  for (const form of wordForms(word)) {
    for (const pos of POS_ORDER) {
      const row = stmt.get(form, pos) as any;
      if (row) return row.definition as string;
    }
  }
  return null;
}

/** Full entry for `word`: every sense. Null for unknown words. */
export function lookup(word: string): Entry | null {
  const c = conn();
  for (const form of wordForms(word)) {
    const senses: Sense[] = [];
    for (const pos of POS_ORDER) {
      const rows = c
        .prepare(
          `SELECT s.sense_no AS senseNo, s.synset_offset AS synsetOffset, s.pos AS synsetPos,
                  s.definition, s.examples
           FROM sense s JOIN lemma l ON l.id = s.lemma_id
           WHERE l.lemma = ? AND l.pos = ? ORDER BY s.sense_no`
        )
        .all(form, pos) as any[];
      for (const r of rows) {
        const words = synsetWords(c, r.synsetOffset, r.synsetPos);
        const lower = word.toLowerCase();
        const sense: Sense = {
          pos,
          senseNo: r.senseNo,
          definition: r.definition,
          examples: JSON.parse(r.examples),
          synonyms: words.filter((w) => w.toLowerCase() !== lower),
          antonyms: () => relatedFor(c, r, "!"),
          hypernyms: () => relatedFor(c, r, "@"),
          hyponyms: () => relatedFor(c, r, "~"),
        };
        senses.push(sense);
      }
    }
    if (senses.length) return { word, senses }; // don't merge exact/lowercase hits
  }
  return null;
}

/** Up to `limit` lemmas starting with `prefix`, alphabetical. */
export function search(prefix: string, limit = 10): string[] {
  const c = conn();
  const pat = prefix.replace(/[\\%_]/g, (m) => "\\" + m) + "%";
  return (
    c
      .prepare(
        `SELECT DISTINCT lemma FROM lemma WHERE lemma LIKE ? ESCAPE '\\'
         ORDER BY lemma LIMIT ?`
      )
      .all(pat, limit) as any[]
  ).map((r) => r.lemma as string);
}
