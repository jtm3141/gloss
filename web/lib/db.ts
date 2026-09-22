// Data layer.
//
// Two flavors, chosen at build time by NEXT_PUBLIC_GLOSS_TARGET:
//   "desktop" — static export for the Electron shell: the filtered database
//               ships inside the app bundle and is queried in the browser
//               via sql.js (WebAssembly). Fully offline after install.
//   (default) — server flavor (Vercel): thin fetch() calls to /api/*, which
//               query the database through libsql (Turso in production, a
//               local file: URL in dev). No big download.
//
// Both flavors return identical shapes; the UI doesn't know which it has.

import type { Database, QueryResult } from "sql.js";
import {
  MAX_RELATED_SHOWN,
  groupRelated,
  parseExamples,
  type Definition,
  type RelatedGroup,
  type RelationRow,
  type Sense,
} from "./relations";

// Re-export the shared surface so UI imports stay on "@/lib/db".
export type { Definition, RelatedGroup, Sense };
export { MAX_RELATED_SHOWN };

export const IS_REMOTE = process.env.NEXT_PUBLIC_GLOSS_TARGET !== "desktop";

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

// Browser flavor only. In the server flavor there is no client-side database;
// the API is always ready, so this resolves immediately.
export function loadDb(): Promise<Database | null> {
  if (IS_REMOTE) return Promise.resolve(null);
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

async function fetchJson<T>(url: string, notFound: T | null = null): Promise<T | null> {
  const res = await fetch(url);
  if (res.status === 404) return notFound;
  if (!res.ok) throw new Error(`request failed (HTTP ${res.status})`);
  return (await res.json()) as T;
}

export async function defineWord(raw: string): Promise<Definition | null> {
  const word = raw.trim().toLowerCase();
  if (!word) return null;
  if (IS_REMOTE) {
    return fetchJson<Definition>(`/api/define?word=${encodeURIComponent(word)}`);
  }
  const db = (await loadDb())!;
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

  const bySense = new Map<string, Sense & { so: number; srcWp: number }>();
  for (const r of rs) {
    const n = r.n as number;
    const pos = r.pos as string;
    const mapKey = `${pos}:${n}`;
    let s = bySense.get(mapKey);
    if (!s) {
      s = {
        n,
        pos,
        synset: `${pos}:${r.so as number}`,
        so: r.so as number,
        srcWp: (r.src_wp as number) ?? 0,
        definition: (r.definition as string) ?? "",
        examples: parseExamples(r.examples as string | null),
        synonyms: [],
        related: [] as RelatedGroup[],
      };
      bySense.set(mapKey, s);
    }
    const w = r.w as string | null;
    if (w && w.toLowerCase() !== word && !s.synonyms.some((x) => x.toLowerCase() === w.toLowerCase()))
      s.synonyms.push(w);
  }
  const senses = [...bySense.values()];

  if (senses.length > 0) {
    const pairs = senses.map((s) => `(${s.so}, '${s.pos}')`).join(", ");
    const relRs = rows(
      db.exec(
        `SELECT r.ptr AS ptr, r.from_word AS fw, r.to_word AS tw,
                r.from_offset AS fo, r.from_pos AS fp, sw.word AS w
         FROM relation r
         JOIN synset_word sw ON sw.synset_offset = r.to_offset AND sw.pos = r.to_pos
         WHERE (r.from_offset, r.from_pos) IN (${pairs})
         ORDER BY sw.word_pos`
      )[0]
    );
    const grouped = groupRelated(senses, relRs as unknown as RelationRow[]);
    senses.forEach((s, i) => {
      s.related = grouped[i];
    });
  }

  const clean: Sense[] = senses
    .sort((a, b) => POS_RANK[a.pos] - POS_RANK[b.pos] || a.n - b.n)
    .map(({ so: _so, srcWp: _srcWp, ...rest }) => rest);
  return { word, senses: clean };
}

export async function suggest(prefix: string): Promise<string[]> {
  const p = prefix.trim().toLowerCase();
  if (p.length < 2) return [];
  if (IS_REMOTE) {
    const res = await fetchJson<string[]>(`/api/suggest?q=${encodeURIComponent(p)}`, []);
    return res ?? [];
  }
  const db = (await loadDb())!;
  const esc = p.replace(/[%_\\]/g, "\\$&");
  const rs = rows(
    db.exec(
      `SELECT DISTINCT lemma FROM lemma
       WHERE lemma LIKE '${esc}%' ESCAPE '\\'
       ORDER BY LENGTH(lemma), lemma LIMIT 8`
    )[0]
  );
  return rs.map((r) => r.lemma as string);
}

export async function dbMeta(): Promise<Record<string, string>> {
  if (IS_REMOTE) {
    const meta = await fetchJson<Record<string, string>>("/api/meta", {});
    return meta ?? {};
  }
  const db = (await loadDb())!;
  const rs = rows(db.exec("SELECT key, value FROM meta")[0]);
  return Object.fromEntries(rs.map((r) => [r.key as string, r.value as string]));
}
