"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defineWord, suggest, type Definition } from "@/lib/db";
import styles from "./glasses.module.css";

const POS_NAMES: Record<string, string> = {
  n: "noun",
  v: "verb",
  a: "adjective",
  r: "adverb",
};

// ---------- on-screen keyboard ----------
// Labels double as key ids: "⌫" deletes, "space" inserts a space,
// anything else appends its lowercase form.
const KEY_ROWS: string[][] = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M", "⌫"],
  ["space"],
];

const MAX_SUGGESTIONS = 5;
const MAX_PER_GROUP = 12; // matches the main site's related-word cap

// ---------- focus model (search view) ----------

type SearchFocus =
  | { area: "actions"; index: number } // 0 = Go, 1 = Clear
  | { area: "suggest"; index: number }
  | { area: "keys"; row: number; col: number };

type Dir = "up" | "down" | "left" | "right";

type View =
  | { name: "search" }
  | { name: "loading"; word: string }
  | { name: "define"; def: Definition; focus: { row: number; col: number } }
  // row 0 = Back; rows 1.. = related-word groups, col = chip within the row
  | { name: "missing"; word: string };

function searchFkey(f: SearchFocus): string {
  if (f.area === "actions") return `a${f.index}`;
  if (f.area === "suggest") return `s${f.index}`;
  return `k${f.row}-${f.col}`;
}

export default function GlassesPage() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [view, setView] = useState<View>({ name: "search" });
  const [sFocus, setSFocus] = useState<SearchFocus>({
    area: "keys",
    row: 0,
    col: 0,
  });
  const stageRef = useRef<HTMLDivElement>(null);
  const defScrollRef = useRef<HTMLDivElement>(null);
  const lastAction = useRef(0);
  const lastKeyCol = useRef(0);
  const prefCol = useRef(0); // preferred chip column for up/down in define view

  // Autocomplete suggestions, debounced.
  useEffect(() => {
    if (!query) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      suggest(query)
        .then((ss) => {
          const top = ss.slice(0, MAX_SUGGESTIONS);
          setSuggestions(top);
          // Keep focus on something that still exists.
          setSFocus((f) =>
            f.area === "suggest" && f.index >= top.length
              ? { area: "keys", row: 0, col: 0 }
              : f
          );
        })
        .catch(() => setSuggestions([]));
    }, 150);
    return () => clearTimeout(t);
  }, [query]);

  const doDefine = useCallback(async (word: string) => {
    const w = word.trim();
    if (!w) return;
    setView({ name: "loading", word: w });
    try {
      const d = await defineWord(w);
      setView(
        d
          ? { name: "define", def: d, focus: { row: 0, col: 0 } }
          : { name: "missing", word: w }
      );
    } catch {
      setView({ name: "missing", word: w });
    }
  }, []);

  const backToSearch = useCallback(() => {
    setView({ name: "search" });
    setSFocus({ area: "keys", row: 0, col: 0 });
  }, []);

  // Related-word groups for the define view, mirroring the main site:
  // Synonyms first, then Broader/Narrower/Opposites/..., merged across
  // senses and deduped within each group. First-seen label order matches
  // REL_GROUPS order because groupRelated emits groups in that order.
  const groups = useMemo(() => {
    if (view.name !== "define")
      return [] as { label: string; words: string[] }[];
    const buckets = new Map<string, string[]>();
    const order: string[] = [];
    const add = (label: string, words: string[]) => {
      if (!buckets.has(label)) {
        buckets.set(label, []);
        order.push(label);
      }
      buckets.get(label)!.push(...words);
    };
    for (const s of view.def.senses) {
      add("Synonyms", s.synonyms);
      for (const g of s.related) add(g.label, g.words);
    }
    const self = view.def.word.toLowerCase();
    const out: { label: string; words: string[] }[] = [];
    for (const label of order) {
      const seen = new Set<string>();
      const uniq: string[] = [];
      for (const w of buckets.get(label)!) {
        const k = w.toLowerCase();
        if (k === self || seen.has(k)) continue;
        seen.add(k);
        uniq.push(w);
        if (uniq.length >= MAX_PER_GROUP) break;
      }
      if (uniq.length > 0) out.push({ label, words: uniq });
    }
    return out;
  }, [view]);

  const focusKey = useMemo(() => {
    if (view.name === "search") return searchFkey(sFocus);
    if (view.name === "define") return `d${view.focus.row}-${view.focus.col}`;
    return "back";
  }, [view, sFocus]);

  // Reset the definition scroll position whenever a new word loads.
  useEffect(() => {
    if (view.name === "define") {
      defScrollRef.current?.scrollTo({ top: 0 });
      prefCol.current = 0;
    }
  }, [view]);

  // The stage owns focus; move real DOM focus along with the focus model
  // and keep the focused element visible.
  useEffect(() => {
    stageRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const el = stageRef.current?.querySelector<HTMLElement>(
      `[data-fkey="${focusKey}"]`
    );
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusKey, view]);

  const moveSearch = useCallback(
    (dir: Dir) => {
      setSFocus((f) => {
        const n = suggestions.length;
        switch (f.area) {
          case "actions": {
            if (dir === "left" || dir === "right") {
              const index = Math.min(
                1,
                Math.max(0, f.index + (dir === "left" ? -1 : 1))
              );
              lastAction.current = index;
              return { area: "actions", index };
            }
            if (dir === "down")
              return n > 0
                ? { area: "suggest", index: 0 }
                : { area: "keys", row: 0, col: 0 };
            return f;
          }
          case "suggest": {
            if (dir === "up")
              return f.index > 0
                ? { area: "suggest", index: f.index - 1 }
                : { area: "actions", index: lastAction.current };
            if (dir === "down")
              return f.index < n - 1
                ? { area: "suggest", index: f.index + 1 }
                : {
                    area: "keys",
                    row: 0,
                    col: Math.min(lastKeyCol.current, KEY_ROWS[0].length - 1),
                  };
            return f;
          }
          case "keys": {
            let { row, col } = f;
            if (dir === "left") col = Math.max(0, col - 1);
            else if (dir === "right")
              col = Math.min(KEY_ROWS[row].length - 1, col + 1);
            else if (dir === "up") {
              if (row === 0)
                return n > 0
                  ? { area: "suggest", index: n - 1 }
                  : { area: "actions", index: lastAction.current };
              row -= 1;
              col = Math.min(col, KEY_ROWS[row].length - 1);
            } else {
              if (row === KEY_ROWS.length - 1) return f;
              row += 1;
              col = Math.min(col, KEY_ROWS[row].length - 1);
            }
            lastKeyCol.current = col;
            return { area: "keys", row, col };
          }
        }
        return f;
      });
    },
    [suggestions.length]
  );

  // 2-D focus for the define view: up/down moves between the Back button
  // and the related-word group rows, left/right moves within a row.
  // Vertical moves keep a preferred column, clamped to the row length.
  const moveDefine = useCallback(
    (dir: Dir) => {
      setView((v) => {
        if (v.name !== "define") return v;
        const rowLen = (r: number) => (r === 0 ? 1 : groups[r - 1].words.length);
        let { row, col } = v.focus;
        if (dir === "left" || dir === "right") {
          col =
            dir === "left"
              ? Math.max(0, col - 1)
              : Math.min(rowLen(row) - 1, col + 1);
          prefCol.current = col;
        } else {
          row =
            dir === "up"
              ? Math.max(0, row - 1)
              : Math.min(groups.length, row + 1);
          col = Math.min(prefCol.current, rowLen(row) - 1);
        }
        return { ...v, focus: { row, col } };
      });
    },
    [groups]
  );

  const pressKey = useCallback((key: string) => {
    if (key === "⌫") setQuery((q) => q.slice(0, -1));
    else if (key === "space") setQuery((q) => (q.endsWith(" ") ? q : `${q} `));
    else setQuery((q) => `${q}${key.toLowerCase()}`.slice(0, 40));
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key;
    // Physical keyboard passthrough: handy for desktop testing and the
    // simulator. The glasses themselves have no keyboard; the D-pad path
    // below is the real input model.
    if (view.name === "search" && k.length === 1 && /^[a-zA-Z ]$/.test(k)) {
      e.preventDefault();
      pressKey(k === " " ? "space" : k.toUpperCase());
      return;
    }
    const handled = [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Enter",
      "Escape",
      "Backspace",
    ].includes(k);
    if (!handled) return;
    e.preventDefault();
    if (k === "Enter") {
      // Every action is a real button; Enter just clicks the focused one.
      stageRef.current
        ?.querySelector<HTMLElement>(`[data-fkey="${focusKey}"]`)
        ?.click();
      return;
    }
    if (view.name === "search") {
      if (k === "Backspace") {
        setQuery((q) => q.slice(0, -1));
        return;
      }
      if (k === "Escape") {
        setQuery("");
        return;
      }
      moveSearch(
        k === "ArrowUp"
          ? "up"
          : k === "ArrowDown"
            ? "down"
            : k === "ArrowLeft"
              ? "left"
              : "right"
      );
      return;
    }
    if (view.name === "define") {
      if (k === "Escape" || k === "Backspace") {
        backToSearch();
        return;
      }
      // Enter is handled globally: it clicks the focused button.
      moveDefine(
        k === "ArrowUp"
          ? "up"
          : k === "ArrowDown"
            ? "down"
            : k === "ArrowLeft"
              ? "left"
              : "right"
      );
      return;
    }
    if (view.name === "missing") {
      if (k === "Escape" || k === "Backspace" || k === "ArrowUp") backToSearch();
    }
    // loading: ignore input until the lookup resolves
  };

  return (
    <div className={styles.page}>
      <div
        ref={stageRef}
        className={styles.stage}
        tabIndex={0}
        onKeyDown={onKeyDown}
        role="application"
        aria-label="gloss dictionary"
      >
        {view.name === "search" && (
          <>
            <div className={styles.querybar}>
              <div
                className={styles.query}
                aria-label={`search text: ${query || "empty"}`}
              >
                <span className={styles.querytext}>{query}</span>
                <span className={styles.cursor} aria-hidden="true" />
              </div>
              <button
                type="button"
                data-fkey="a0"
                data-on={focusKey === "a0"}
                tabIndex={-1}
                className={`${styles.abtn} ${styles.go}`}
                onClick={() => {
                  lastAction.current = 0;
                  doDefine(query);
                }}
              >
                Go
              </button>
              <button
                type="button"
                data-fkey="a1"
                data-on={focusKey === "a1"}
                tabIndex={-1}
                className={styles.abtn}
                onClick={() => {
                  lastAction.current = 1;
                  setQuery("");
                }}
              >
                Clr
              </button>
            </div>
            <div className={styles.suggest}>
              {suggestions.length === 0 ? (
                <div className={styles.hint}>
                  {query ? "No matches — keep typing" : "Type below, then pick a word"}
                </div>
              ) : (
                suggestions.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    data-fkey={`s${i}`}
                    data-on={focusKey === `s${i}`}
                    tabIndex={-1}
                    className={styles.sugrow}
                    onClick={() => doDefine(s)}
                  >
                    {s}
                  </button>
                ))
              )}
            </div>
            <div className={styles.kb}>
              {KEY_ROWS.map((row, r) => (
                <div key={r} className={styles.krow}>
                  {row.map((key, c) => {
                    const fk = `k${r}-${c}`;
                    return (
                      <button
                        key={fk}
                        type="button"
                        data-fkey={fk}
                        data-on={focusKey === fk}
                        tabIndex={-1}
                        className={`${styles.key}${
                          key === "space" ? ` ${styles.keywide}` : ""
                        }`}
                        onClick={() => pressKey(key)}
                      >
                        {key}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}
        {view.name === "loading" && (
          <div className={styles.center}>Looking up &ldquo;{view.word}&rdquo;&hellip;</div>
        )}
        {view.name === "missing" && (
          <div className={styles.center}>
            <div className={styles.missingmsg}>
              No definition found for &ldquo;{view.word}&rdquo;.
            </div>
            <button
              type="button"
              data-fkey="back"
              data-on={focusKey === "back"}
              tabIndex={-1}
              className={styles.backbtn}
              onClick={backToSearch}
            >
              &#8249; Back
            </button>
          </div>
        )}
        {view.name === "define" && (
          <>
            <div className={styles.defhead}>
              <button
                type="button"
                data-fkey="d0-0"
                data-on={focusKey === "d0-0"}
                tabIndex={-1}
                className={styles.backbtn}
                onClick={backToSearch}
              >
                &#8249; Back
              </button>
              <div className={styles.wordtitle}>{view.def.word}</div>
            </div>
            <div ref={defScrollRef} className={styles.defscroll}>
              {view.def.senses.map((s) => (
                <div key={`${s.pos}${s.n}`} className={styles.sense}>
                  <div className={styles.senseHead}>
                    {POS_NAMES[s.pos] ?? s.pos} · {s.n}
                  </div>
                  <div className={styles.senseDef}>{s.definition}</div>
                  {s.examples[0] ? (
                    <div className={styles.senseEx}>&ldquo;{s.examples[0]}&rdquo;</div>
                  ) : null}
                </div>
              ))}
              {groups.map((g, gi) => (
                <div key={g.label} className={styles.group}>
                  <div className={styles.grouplabel}>{g.label}</div>
                  <div className={styles.chiprow}>
                    {g.words.map((w, wi) => {
                      const fk = `d${gi + 1}-${wi}`;
                      return (
                        <button
                          key={`${w}-${wi}`}
                          type="button"
                          data-fkey={fk}
                          data-on={focusKey === fk}
                          tabIndex={-1}
                          className={styles.chip}
                          onClick={() => doDefine(w)}
                        >
                          {w}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className={styles.attr}>Open English WordNet · CC-BY 4.0</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
