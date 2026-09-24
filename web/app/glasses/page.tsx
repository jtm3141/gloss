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
const MAX_CHIPS = 24;

// ---------- focus model (search view) ----------

type SearchFocus =
  | { area: "actions"; index: number } // 0 = Go, 1 = Clear
  | { area: "suggest"; index: number }
  | { area: "keys"; row: number; col: number };

type Dir = "up" | "down" | "left" | "right";

type View =
  | { name: "search" }
  | { name: "loading"; word: string }
  | { name: "define"; def: Definition; focus: number } // 0 = Back, 1.. = chips
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
        d ? { name: "define", def: d, focus: 0 } : { name: "missing", word: w }
      );
    } catch {
      setView({ name: "missing", word: w });
    }
  }, []);

  const backToSearch = useCallback(() => {
    setView({ name: "search" });
    setSFocus({ area: "keys", row: 0, col: 0 });
  }, []);

  // Related-word chips for the define view: synonyms + related words,
  // deduped, capped. Linear focus order matches visual order.
  const chips = useMemo(() => {
    if (view.name !== "define") return [] as { word: string; label: string }[];
    const seen = new Set<string>();
    const out: { word: string; label: string }[] = [];
    const self = view.def.word.toLowerCase();
    const push = (word: string, label: string) => {
      const k = word.toLowerCase();
      if (k === self || seen.has(k) || out.length >= MAX_CHIPS) return;
      seen.add(k);
      out.push({ word, label });
    };
    for (const s of view.def.senses) {
      for (const w of s.synonyms) push(w, "synonyms");
      for (const g of s.related)
        for (const w of g.words) push(w, g.label);
    }
    return out;
  }, [view]);

  const focusKey = useMemo(() => {
    if (view.name === "search") return searchFkey(sFocus);
    if (view.name === "define") return `d${view.focus}`;
    return "back";
  }, [view, sFocus]);

  // Reset the definition scroll position whenever a new word loads.
  useEffect(() => {
    if (view.name === "define") defScrollRef.current?.scrollTo({ top: 0 });
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
    el?.scrollIntoView({ block: "nearest" });
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
      const d = k === "ArrowUp" || k === "ArrowLeft" ? -1 : 1;
      setView((v) =>
        v.name !== "define"
          ? v
          : { ...v, focus: Math.min(chips.length, Math.max(0, v.focus + d)) }
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
                data-fkey="d0"
                data-on={focusKey === "d0"}
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
              {chips.length > 0 && (
                <>
                  <div className={styles.grouplabel}>Related words</div>
                  <div className={styles.chips}>
                    {chips.map((c, i) => (
                      <button
                        key={`${c.word}-${i}`}
                        type="button"
                        data-fkey={`d${i + 1}`}
                        data-on={focusKey === `d${i + 1}`}
                        tabIndex={-1}
                        className={styles.chip}
                        onClick={() => doDefine(c.word)}
                      >
                        {c.word}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className={styles.attr}>Open English WordNet · CC-BY 4.0</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
