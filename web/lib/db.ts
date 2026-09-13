// Data layer: loads the filtered gloss SQLite database in the browser via
// sql.js (WebAssembly). The DB ships gzipped in public/ and is fetched once,
// decompressed, and cached by the browser; after that the app works offline.

import type { Database, QueryResult } from "sql.js";

export interface Sense {
  n: number; // WordNet sense number (1 = most common)
  pos: string; // n | v | a | r
  definition: string;
  examples: string[];
  synonyms: string[];
}

export interface Definition {
  word: string;
  senses: Sense[];
}

export type DbStatus =
  | { state: "loading"; detail: string }
  | { state: "ready" }
  | { state: "error"; message: string };

let dbPromise: Promise<Database> | null = null;

async function gunzip(data: ArrayBuffer): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "This browser can't decompress the dictionary file. Try a recent Chrome, Edge, Firefox, or Safari."
    );
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function loadDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const initSqlJs = (await import("sql.js")).default;
      const SQL = await initSqlJs({ locateFile: (f) => `/${f}` });
      const res = await fetch("/gloss.db.gz");
      if (!res.ok) throw new Error(`dictionary download failed (HTTP ${res.status})`);
      const bytes = await gunzip(await res.arrayBuffer());
      return new SQL.Database(bytes);
    })();
  }
  return dbPromise;
}

function rows(q: QueryResult | undefined): Record<string, unknown>[] {
  if (!q || q.values.length === 0) return [];
  const { columns, values } = q;
  return values.map((row) => Object.fromEntries(row.map((v, i) => [columns[i], v])));
}

const POS_RANK: Record<string, number> = { n: 0, v: 1, a: 2, r: 3 };

export async function defineWord(raw: string): Promise<Definition | null> {
  const word = raw.trim().toLowerCase();
  if (!word) return null;
  const db = await loadDb();
  // One query: senses for every (lemma, pos) row matching the word,
  // left-joined to the synset's member words for synonyms.
  const rs = rows(
    db.exec(
      `SELECT s.sense_no AS n, s.pos AS pos, s.definition AS definition,
              s.examples AS examples, sw.word AS w, sw.word_pos AS wp
       FROM sense s
       JOIN lemma l ON l.id = s.lemma_id
       LEFT JOIN synset_word sw
              ON sw.synset_offset = s.synset_offset AND sw.pos = s.pos
       WHERE l.lemma = '${word.replace(/'/g, "''")}' COLLATE NOCASE
       ORDER BY s.sense_no, sw.word_pos`
    )[0]
  );
  if (rs.length === 0) return null;

  const bySense = new Map<string, Sense>();
  for (const r of rs) {
    const key = `${r.pos}:${r.n}`;
    let s = bySense.get(key);
    if (!s) {
      s = {
        n: r.n as number,
        pos: r.pos as string,
        definition: (r.definition as string) ?? "",
        examples: parseExamples(r.examples as string | null),
        synonyms: [],
      };
      bySense.set(key, s);
    }
    const w = (r.w as string | null)?.toLowerCase();
    if (w && w !== word && !s.synonyms.includes(w)) s.synonyms.push(w);
  }
  const senses = [...bySense.values()].sort(
    (a, b) => POS_RANK[a.pos] - POS_RANK[b.pos] || a.n - b.n
  );
  return { word, senses };
}

function parseExamples(raw: string | null): string[] {
  if (!raw) return [];
  const t = raw.trim();
  // The build pipeline stores examples as a JSON array of strings.
  if (t.startsWith("[")) {
    try {
      const arr: unknown = JSON.parse(t);
      if (Array.isArray(arr)) {
        return arr.map((p) => String(p).trim()).filter(Boolean);
      }
    } catch {
      /* fall through to the lenient path */
    }
  }
  const parts = t.includes("|") ? t.split("|") : [t];
  return parts.map((p) => p.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

export async function suggest(prefix: string): Promise<string[]> {
  const p = prefix.trim().toLowerCase().replace(/[%_\\]/g, "\\$&");
  if (p.length < 2) return [];
  const db = await loadDb();
  const rs = rows(
    db.exec(
      `SELECT DISTINCT lemma FROM lemma
       WHERE lemma LIKE '${p}%' ESCAPE '\\'
       ORDER BY LENGTH(lemma), lemma LIMIT 8`
    )[0]
  );
  return rs.map((r) => r.lemma as string);
}

export async function dbMeta(): Promise<Record<string, string>> {
  const db = await loadDb();
  const rs = rows(db.exec("SELECT key, value FROM meta")[0]);
  return Object.fromEntries(rs.map((r) => [r.key as string, r.value as string]));
}
