// gloss-dict — TypeScript binding for the gloss dictionary engine.
//
//   import { define, lookup, configure } from "gloss-dict";
//   configure("/path/to/gloss.db");   // or set GLOSS_DB
//   define("dog");                    // most common definition
//   lookup("dog");                    // every sense + relations
//
// With no explicit path, the database is resolved through the tier system
// (see ./tiers.ts and data/tiers/TIERS.md): GLOSS_DB wins, then GLOSS_TIER
// (default "full"), then the bundled tiny database, then the platform
// cache. Fetch a larger tier ahead of time with `gloss download --tier small`
// or `await downloadTier("small")`.
//
// Node backend is node:sqlite (built into Node 22+ — no native modules).

import { DatabaseSync } from "node:sqlite";
import { resolveDbPath } from "./tiers";

// Tier selection API (see ./tiers.ts): resolveDbPath, downloadTier, etc.
export {
  cacheDir,
  dataDir,
  DEFAULT_TIER,
  downloadTier,
  resolveDbPath,
  selectedTier,
  TIERS,
} from "./tiers";
export type { ResolveOptions, TierName } from "./tiers";

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

export interface DbOptions {
  /** Tier name (tiny|small|medium|full); GLOSS_TIER or "full" when omitted. */
  tier?: string;
}

let db: DatabaseSync | null = null;
let dbKey: string | null = null;

function openAt(p: string): DatabaseSync {
  if (!db || dbKey !== p) {
    if (db) db.close();
    db = new DatabaseSync(p, { readOnly: true });
    dbKey = p;
  }
  return db;
}

/**
 * Point the module at a gloss database. An explicit path is used exactly as
 * given; with no path the tier system resolves one (GLOSS_DB, then
 * GLOSS_TIER, bundled tiny, platform cache).
 */
export function configure(dbPath?: string, opts: DbOptions = {}): void {
  openAt(dbPath ?? resolveDbPath(opts));
}

function conn(opts: DbOptions = {}): DatabaseSync {
  // An already-open database stays open (as before); a per-call tier=
  // forces re-resolution through the tier system.
  if (db && !opts.tier) return db;
  return openAt(resolveDbPath(opts));
}

function synsetWords(c: DatabaseSync, offset: number, pos: string): string[] {
  // Surface forms from the data file, in synset word order.
  return (
    c
      .prepare(
        `SELECT word FROM synset_word
         WHERE synset_offset = ? AND pos = ? ORDER BY word_pos`
      )
      .all(offset, pos) as any[]
  ).map((r) => r.word as string);
}

// Exact form first, then lowercase (data files keep original case).
function wordForms(word: string): string[] {
  const lower = word.toLowerCase();
  return lower === word ? [word] : [word, lower];
}

function relatedFor(
  c: DatabaseSync,
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
      c
        .prepare(`SELECT definition FROM synset WHERE offset = ? AND pos = ?`)
        .get(r.toOffset, r.toPos) as any
    ).definition as string,
  }));
}

/** The single most common definition of `word` (POS tried n, v, a, r), or null. */
export function define(word: string, opts: DbOptions = {}): string | null {
  const c = conn(opts);
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
export function lookup(word: string, opts: DbOptions = {}): Entry | null {
  const c = conn(opts);
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

/**
 * Target synsets of one pointer type (e.g. "@" hypernym, "~" hyponym,
 * "!" antonym) for the most common sense of `word`. Empty for unknown words.
 */
export function related(
  word: string,
  ptr: string,
  opts: DbOptions = {}
): Related[] {
  const c = conn(opts);
  const stmt = c.prepare(
    `SELECT s.synset_offset AS synsetOffset, s.pos AS synsetPos
     FROM sense s JOIN lemma l ON l.id = s.lemma_id
     WHERE l.lemma = ? AND l.pos = ? AND s.sense_no = 1`
  );
  for (const form of wordForms(word)) {
    for (const pos of POS_ORDER) {
      const r = stmt.get(form, pos) as any;
      if (r) return relatedFor(c, r, ptr);
    }
  }
  return [];
}

/** Up to `limit` lemmas starting with `prefix`, alphabetical. */
export function search(prefix: string, limit = 10, opts: DbOptions = {}): string[] {
  const c = conn(opts);
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
