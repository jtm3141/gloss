// Server data layer: queries the gloss SQLite database through libsql.
//   - Production (Vercel): Turso, via TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN).
//   - Local dev:          a plain file, via TURSO_DATABASE_URL=file:...db
// Imported only by API routes — never by client components. The grouping and
// shaping logic is shared with the browser transport (lib/relations.ts) so
// both flavors return identical results.

import { createClient, type Client } from "@libsql/client";
import {
  groupRelated,
  parseExamples,
  type Definition,
  type RelatedGroup,
  type RelationRow,
  type Sense,
} from "./relations";

let client: Client | null = null;

function getClient(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error("TURSO_DATABASE_URL is not set");
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return client;
}

const POS_RANK: Record<string, number> = { n: 0, v: 1, a: 2, r: 3 };

type WorkSense = Sense & { so: number; srcWp: number };

export async function defineWord(raw: string): Promise<Definition | null> {
  const word = raw.trim().toLowerCase();
  if (!word) return null;
  const db = getClient();
  // One query: senses for every (lemma, pos) row matching the word,
  // left-joined to the synset's member words for synonyms, plus the word's
  // own 0-based position in each synset (to resolve word-level relations).
  const rs = await db.execute({
    sql: `SELECT s.sense_no AS n, s.pos AS pos, s.definition AS definition,
                 s.examples AS examples, s.synset_offset AS so, sw.word AS w, sw.word_pos AS wp,
                 (SELECT w2.word_pos FROM synset_word w2
                  WHERE w2.synset_offset = s.synset_offset AND w2.pos = s.pos
                    AND w2.lemma_id = s.lemma_id) AS src_wp
          FROM sense s
          JOIN lemma l ON l.id = s.lemma_id
          LEFT JOIN synset_word sw
                 ON sw.synset_offset = s.synset_offset AND sw.pos = s.pos
          WHERE l.lemma = ? COLLATE NOCASE
          ORDER BY s.sense_no, sw.word_pos`,
    args: [word],
  });
  if (rs.rows.length === 0) return null;

  const bySense = new Map<string, WorkSense>();
  for (const r of rs.rows) {
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
    const pairs = senses.map(() => "(?, ?)").join(", ");
    const args: (string | number)[] = senses.flatMap((s) => [s.so, s.pos]);
    const relRs = await db.execute({
      sql: `SELECT r.ptr AS ptr, r.from_word AS fw, r.to_word AS tw,
                   r.from_offset AS fo, r.from_pos AS fp, sw.word AS w
            FROM relation r
            JOIN synset_word sw ON sw.synset_offset = r.to_offset AND sw.pos = r.to_pos
            WHERE (r.from_offset, r.from_pos) IN (${pairs})
            ORDER BY sw.word_pos`,
      args,
    });
    const grouped = groupRelated(
      senses,
      relRs.rows as unknown as RelationRow[]
    );
    senses.forEach((s, i) => {
      s.related = grouped[i];
    });
  }

  const clean: Sense[] = senses
    .sort((a, b) => POS_RANK[a.pos] - POS_RANK[b.pos] || a.n - b.n)
    // Drop the internal-only fields before serializing. `synset` stays:
    // it is the public cross-word identity used for synonym deep links.
    .map(({ so: _so, srcWp: _srcWp, ...rest }) => rest);
  return { word, senses: clean };
}

export async function suggest(prefix: string): Promise<string[]> {
  const p = prefix.trim().toLowerCase().replace(/[%_\\]/g, "\\$&");
  if (p.length < 2) return [];
  const db = getClient();
  const rs = await db.execute({
    sql: `SELECT DISTINCT lemma FROM lemma
          WHERE lemma LIKE ? ESCAPE '\\'
          ORDER BY LENGTH(lemma), lemma LIMIT 8`,
    args: [p + "%"],
  });
  return rs.rows.map((r) => r.lemma as string);
}

export async function dbMeta(): Promise<Record<string, string>> {
  const db = getClient();
  const rs = await db.execute("SELECT key, value FROM meta");
  return Object.fromEntries(rs.rows.map((r) => [r.key as string, r.value as string]));
}
