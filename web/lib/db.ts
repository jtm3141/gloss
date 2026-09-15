// Data layer: loads the filtered gloss SQLite database in the browser via
// sql.js (WebAssembly). The DB ships gzipped in public/ and is fetched once,
// decompressed, and cached by the browser; after that the app works offline.

import type { Database, QueryResult } from "sql.js";

export interface RelatedGroup {
  label: string;
  words: string[]; // ALL related words, most relevant first (UI truncates)
  more: number; // additional words not shown
}

export interface Sense {
  n: number; // WordNet sense number (1 = most common)
  pos: string; // n | v | a | r
  definition: string;
  examples: string[];
  synonyms: string[];
  related: RelatedGroup[];
}

// Relation groups shown in the UI, in display order. Pointer codes are the
// WordNet WNDB symbols stored in the relation table.
//
// Meronym direction, verified 2026-09-13 against OEWN's native WN-LMF XML
// (english-wordnet-2024.xml.gz): the car synset carries native `mero_part`
// relations to its 30 part synsets, and the WNDB export encodes exactly those
// as `%p`. So in this database `%m/%s/%p` point from the whole to its parts
// ("X has part Y") and `#m/#s/#p` point from the part to the whole
// ("X is part of Y") — the reverse of the naive reading of the symbols.
const REL_GROUPS: { ptrs: string[]; label: string }[] = [
  { ptrs: ["@", "@i"], label: "Broader" },
  { ptrs: ["~", "~i"], label: "Narrower" },
  { ptrs: ["!"], label: "Opposites" },
  { ptrs: ["&"], label: "Similar" },
  { ptrs: ["%m", "%s", "%p"], label: "Parts" },
  { ptrs: ["#m", "#s", "#p"], label: "Part of" },
  { ptrs: ["^"], label: "See also" },
  { ptrs: ["+"], label: "Related forms" },
];

export const MAX_RELATED_SHOWN = 12;

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
      const SQL = await initSqlJs({ locateFile: (f) => f });
      // Relative URLs: the same bundle runs from https:// (website) and
      // from file:// (desktop app shell).
      const res = await fetch("gloss.db.gz");
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
  // left-joined to the synset's member words for synonyms, plus the word's
  // own 0-based position in each synset (to resolve word-level relations).
  const rs = rows(
    db.exec(
      `SELECT s.sense_no AS n, s.pos AS pos, s.definition AS definition,
              s.examples AS examples, s.synset_offset AS so, sw.word AS w, sw.word_pos AS wp,
              (SELECT w2.word_pos FROM synset_word w2
               WHERE w2.synset_offset = s.synset_offset AND w2.pos = s.pos
                 AND w2.lemma_id = s.lemma_id) AS src_wp
       FROM sense s
       JOIN lemma l ON l.id = s.lemma_id
       LEFT JOIN synset_word sw
              ON sw.synset_offset = s.synset_offset AND sw.pos = s.pos
       WHERE l.lemma = '${word.replace(/'/g, "''")}' COLLATE NOCASE
       ORDER BY s.sense_no, sw.word_pos`
    )[0]
  );
  if (rs.length === 0) return null;

  const bySense = new Map<string, Sense & { key: string; so: number; srcWp: number }>();
  for (const r of rs) {
    const key = `${r.pos}:${r.n}`;
    let s = bySense.get(key);
    if (!s) {
      s = {
        key,
        n: r.n as number,
        pos: r.pos as string,
        so: r.so as number,
        srcWp: (r.src_wp as number) ?? 0,
        definition: (r.definition as string) ?? "",
        examples: parseExamples(r.examples as string | null),
        synonyms: [],
        related: [],
      };
      bySense.set(key, s);
    }
    const w = r.w as string | null;
    if (w && w.toLowerCase() !== word && !s.synonyms.some((x) => x.toLowerCase() === w.toLowerCase()))
      s.synonyms.push(w);
  }

  attachRelated(db, [...bySense.values()]);

  const senses = [...bySense.values()].sort(
    (a, b) => POS_RANK[a.pos] - POS_RANK[b.pos] || a.n - b.n
  );
  return { word, senses };
}

// Fills in sense.related from the relation table. relation.from_word/to_word
// are 1-based word indexes (0 = the whole synset); synset_word.word_pos is
// 0-based, so a word-level relation applies when from_word == srcWp + 1.
function attachRelated(
  db: Database,
  senses: (Sense & { key: string; so: number; srcWp: number })[]
): void {
  if (senses.length === 0) return;
  const pairs = senses.map((s) => `(${s.so}, '${s.pos}')`).join(", ");
  const rs = rows(
    db.exec(
      `SELECT r.ptr AS ptr, r.from_word AS fw, r.to_word AS tw,
              r.from_offset AS fo, r.from_pos AS fp, sw.word AS w
       FROM relation r
       JOIN synset_word sw ON sw.synset_offset = r.to_offset AND sw.pos = r.to_pos
       WHERE (r.from_offset, r.from_pos) IN (${pairs})
       ORDER BY sw.word_pos`
    )[0]
  );
  const bySynset = new Map<string, typeof rs>();
  for (const r of rs) {
    const k = `${r.fp}:${r.fo}`;
    if (!bySynset.has(k)) bySynset.set(k, []);
    bySynset.get(k)!.push(r);
  }
  const groupOf = new Map<string, string>();
  for (const g of REL_GROUPS) for (const p of g.ptrs) groupOf.set(p, g.label);

  for (const s of senses) {
    const rels = bySynset.get(`${s.pos}:${s.so}`) ?? [];
    const buckets = new Map<string, string[]>();
    for (const r of rels) {
      const label = groupOf.get(r.ptr as string);
      if (!label) continue;
      if ((r.fw as number) !== 0 && (r.fw as number) !== s.srcWp + 1) continue;
      const w = r.w as string;
      if (!w) continue;
      // A word-level target names the exact word (to_word is 1-based);
      // surface it ahead of its synset-mates.
      const bucket = buckets.get(label) ?? [];
      const tw = r.tw as number;
      const isTarget = tw !== 0;
      if (!bucket.some((x) => x.toLowerCase() === w.toLowerCase())) {
        if (isTarget) bucket.unshift(w);
        else bucket.push(w);
      }
      buckets.set(label, bucket);
    }
    s.related = REL_GROUPS.filter((g) => buckets.has(g.label)).map((g) => {
      const words = buckets.get(g.label)!;
      return {
        label: g.label,
        words,
        more: Math.max(0, words.length - MAX_RELATED_SHOWN),
      };
    });
  }
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
