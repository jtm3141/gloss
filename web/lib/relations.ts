// Shared dictionary shaping logic: relation grouping, example parsing, and
// the public types. Used by BOTH data transports so they behave identically:
//   - lib/db.ts    (browser: sql.js over the bundled database file)
//   - lib/dict.ts  (server: libsql over Turso / a local file: URL)
// This module touches no I/O and is safe to import anywhere.

export interface RelatedGroup {
  label: string;
  words: string[]; // ALL related words, most relevant first (UI truncates)
  more: number; // additional words not shown
}

export interface Sense {
  n: number; // WordNet sense number (1 = most common)
  pos: string; // n | v | a | r
  synset: string; // synset identity "<pos>:<synset_offset>", stable across words
  definition: string;
  examples: string[];
  synonyms: string[];
  related: RelatedGroup[];
}

export interface Definition {
  word: string;
  senses: Sense[];
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

// Identifies one sense's synset for relation lookup. relation.from_word /
// to_word are 1-based word indexes (0 = the whole synset); synset_word.word_pos
// is 0-based, so a word-level relation applies when from_word == srcWp + 1.
export interface SenseKey {
  so: number; // synset_offset
  pos: string;
  srcWp: number; // 0-based position of the word within its synset
}

export interface RelationRow {
  ptr: string;
  fw: number;
  tw: number;
  fo: number; // from_offset
  fp: string; // from_pos
  w: string; // target word
}

// Groups relation rows into RelatedGroup[] per sense, in REL_GROUPS order.
// The returned i-th entry belongs to senses[i].
export function groupRelated(senses: SenseKey[], relRows: RelationRow[]): RelatedGroup[][] {
  const bySynset = new Map<string, RelationRow[]>();
  for (const r of relRows) {
    const k = `${r.fp}:${r.fo}`;
    const arr = bySynset.get(k) ?? [];
    arr.push(r);
    bySynset.set(k, arr);
  }
  const groupOf = new Map<string, string>();
  for (const g of REL_GROUPS) for (const p of g.ptrs) groupOf.set(p, g.label);

  return senses.map((s) => {
    const rels = bySynset.get(`${s.pos}:${s.so}`) ?? [];
    const buckets = new Map<string, string[]>();
    for (const r of rels) {
      const label = groupOf.get(r.ptr);
      if (!label) continue;
      if (r.fw !== 0 && r.fw !== s.srcWp + 1) continue;
      const w = r.w;
      if (!w) continue;
      // A word-level target names the exact word (to_word is 1-based);
      // surface it ahead of its synset-mates.
      const bucket = buckets.get(label) ?? [];
      const isTarget = r.tw !== 0;
      if (!bucket.some((x) => x.toLowerCase() === w.toLowerCase())) {
        if (isTarget) bucket.unshift(w);
        else bucket.push(w);
      }
      buckets.set(label, bucket);
    }
    return REL_GROUPS.filter((g) => buckets.has(g.label)).map((g) => {
      const words = buckets.get(g.label)!;
      return {
        label: g.label,
        words,
        more: Math.max(0, words.length - MAX_RELATED_SHOWN),
      };
    });
  });
}

export function parseExamples(raw: string | null): string[] {
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
