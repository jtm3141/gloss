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
  pronunciations?: Pronunciation[];
}

// One pronunciation row for the public API. `syllabified` is the friendly
// respelling with syllable boundaries marked (U+00B7 middle dot), e.g.
// "DIHK·shuh·neh·ree"; the website shows it, developers also get `ipa`.
// `variety` is the display variety: CMUdict rows are General American, so
// they report "US"; "" means the source gave no variety. `pos` is the
// OEWN part of speech the pronunciation belongs to (n/v/a/r) —
// pronunciations attach to (lemma, pos), so "live" can carry /lɪv/ for
// the verb and /laɪv/ for the adjective.
export interface Pronunciation {
  pos: string;
  variety: string;
  ipa: string;
  respelling: string;
  syllabified: string;
  source: string; // "oewn" | "cmudict"
}

// Part-of-speech order, then the variety pick order documented in
// data/build_db.py: US, GB, other regional varieties, unmarked, cmudict.
// Rows are per (lemma, pos), so identical (pos, display variety,
// syllabified) triples are collapsed; the UI groups by part of speech
// when a word's pronunciations differ across them.
const PRON_POS_RANK: Record<string, number> = { n: 0, v: 1, a: 2, r: 3 };

export function shapePronunciations(
  rows: Array<Record<string, unknown>>
): Pronunciation[] {
  const seen = new Set<string>();
  const ranked: (Pronunciation & { posRank: number; rank: number })[] = [];
  for (const r of rows) {
    const source = String(r.source ?? "");
    const rawVariety = String(r.variety ?? "");
    const variety = rawVariety || (source === "cmudict" ? "US" : "");
    const pos = String(r.pos ?? "");
    const syllabified = String(r.syllabified ?? r.respelling ?? "");
    const key = `${pos}|${variety}|${syllabified}`;
    if (!syllabified || seen.has(key)) continue;
    seen.add(key);
    const rank =
      source === "cmudict" ? 4
      : variety === "US" ? 0
      : variety === "GB" ? 1
      : variety === "" ? 3
      : 2;
    ranked.push({
      pos,
      variety,
      ipa: String(r.ipa ?? ""),
      respelling: String(r.respelling ?? ""),
      syllabified,
      source,
      posRank: PRON_POS_RANK[pos] ?? 99,
      rank,
    });
  }
  ranked.sort(
    (a, b) =>
      a.posRank - b.posRank ||
      a.rank - b.rank ||
      (a.variety < b.variety ? -1 : a.variety > b.variety ? 1 : 0) ||
      (a.ipa < b.ipa ? -1 : a.ipa > b.ipa ? 1 : 0)
  );
  return ranked.map(({ posRank: _posRank, rank: _rank, ...rest }) => rest);
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
