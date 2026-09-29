"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { defineWord, suggest, loadDb, dbMeta, MAX_RELATED_SHOWN, IS_REMOTE, IS_DESKTOP, type Definition, type Pronunciation, type Sense, type DbStatus } from "@/lib/db";

const POS_NAMES: Record<string, string> = {
  n: "noun",
  v: "verb",
  a: "adjective",
  r: "adverb",
};

// Group pronunciations by part of speech for display. POS groups whose
// pronunciation sets are identical are merged ("adjective, adverb"),
// since e.g. "live" is /laɪv/ for both. Groups come out in POS order.
function groupPronunciations(prons: Pronunciation[]): {
  labels: string[];
  items: Pronunciation[];
}[] {
  const byPos = new Map<string, Pronunciation[]>();
  for (const p of prons) {
    const list = byPos.get(p.pos);
    if (list) list.push(p);
    else byPos.set(p.pos, [p]);
  }
  const merged = new Map<
    string,
    { labels: string[]; items: Pronunciation[] }
  >();
  for (const [pos, items] of byPos) {
    const sig = items.map((p) => `${p.variety}|${p.syllabified}`).join(";");
    const m = merged.get(sig);
    if (m) m.labels.push(pos);
    else merged.set(sig, { labels: [pos], items });
  }
  return [...merged.values()];
}

// Render a syllabified respelling with breathing room around the dots:
// "ab·uh·RAY·shn" -> ab · uh · RAY · shn (spacing via CSS, data untouched).
function renderSyllabified(syllabified: string) {
  const parts = syllabified.split("\u00b7");
  return parts.map((part, i) => (
    <span key={i}>
      {part}
      {i < parts.length - 1 && (
        <span className="pron-dot" aria-hidden="true">
          {"\u00b7"}
        </span>
      )}
    </span>
  ));
}

// Plain-text rendering of one sense, for the clipboard: just the
// definition, followed on the same line by an em-dash attribution.
// OEWN is CC-BY 4.0, so copied text carries its source.
function senseText(s: Sense): string {
  return `${s.definition} — via gloss · Open English WordNet (CC-BY 4.0)`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const COPY_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CHECK_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const LINK_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

// Shareable URLs: ?define=<word> opens the word page, &sense=<pos><n> jumps
// to one sense, e.g. &sense=v1 for verb sense 1 (sense numbers restart at 1
// within each part of speech, so the pos prefix is required). Built from the
// current location so the links work over https and file:// alike.
function pageBase(): string {
  return window.location.href.split("?")[0].split("#")[0];
}

function wordUrl(word: string): string {
  return `${pageBase()}?define=${encodeURIComponent(word)}`;
}

function senseUrl(word: string, pos: string, n: number): string {
  return `${wordUrl(word)}&sense=${pos}${n}`;
}

// Parses a &sense=<pos><n> value like "v1"; null when malformed.
function parseSenseParam(value: string | null): { pos: string; n: number } | null {
  const m = /^([nvar])(\d+)$/.exec(value ?? "");
  if (!m) return null;
  const n = Number.parseInt(m[2], 10);
  return Number.isSafeInteger(n) && n > 0 ? { pos: m[1], n } : null;
}

// A &synset=<pos><offset> value like "n12345" identifies a synset across
// words; parsed back into the "<pos>:<offset>" identity carried on senses.
function parseSynsetParam(value: string | null): string | null {
  const p = parseSenseParam(value);
  return p ? `${p.pos}:${p.n}` : null;
}

function synsetUrl(word: string, synset: string): string {
  return `${wordUrl(word)}&synset=${synset.replace(":", "")}`;
}

// Brief checkmark feedback after a successful copy.
function useCopiedFlag(): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  const flag = useCallback(() => {
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }, []);
  return [copied, flag];
}

function CopySenseButton({ word, sense }: { word: string; sense: Sense }) {
  const [copied, flagCopied] = useCopiedFlag();
  const onClick = async () => {
    if (await copyText(senseText(sense))) flagCopied();
  };
  return (
    <button
      className="copybtn"
      onClick={onClick}
      title="Copy definition to the clipboard"
      aria-label={`Copy definition of ${word}`}
    >
      {copied ? CHECK_ICON : COPY_ICON}
    </button>
  );
}

function CopyLinkButton({ url, title, ariaLabel }: { url: string; title: string; ariaLabel: string }) {
  const [copied, flagCopied] = useCopiedFlag();
  const onClick = async () => {
    if (await copyText(url)) flagCopied();
  };
  return (
    <button className="copybtn" onClick={onClick} title={title} aria-label={ariaLabel}>
      {copied ? CHECK_ICON : LINK_ICON}
    </button>
  );
}

// One related-word row (Broader, Narrower, …). "+N more" expands in place
// to reveal every word; expansion resets when the word changes (see key).
function RelatedRow({
  label,
  words,
  more,
  onPick,
}: {
  label: string;
  words: string[];
  more: number;
  onPick: (w: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? words : words.slice(0, MAX_RELATED_SHOWN);
  return (
    <div className="related">
      <span className="rellabel">{label}:</span>{" "}
      {shown.map((w, i) => (
        <span key={w}>
          {i > 0 && ", "}
          <button className="relword" onClick={() => onPick(w)} title={`Define ${w}`}>
            {w}
          </button>
        </span>
      ))}
      {more > 0 && (
        <button
          className="chipmore"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          title={expanded ? "Show fewer" : `Show all ${words.length}`}
        >
          {expanded ? "show less" : `+${more} more`}
        </button>
      )}
    </div>
  );
}

export default function Home() {
  const [status, setStatus] = useState<DbStatus>({ state: "loading", detail: "Loading dictionary…" });
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeSug, setActiveSug] = useState(-1);
  const [result, setResult] = useState<Definition | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [deepLink, setDeepLink] = useState<{
    word: string;
    sense: { pos: string; n: number } | null;
    synset: string | null;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic generation for suggestion requests: each keystroke schedules a
  // new generation and each search invalidates all of them, so a stale
  // suggest() response can never repopulate the dropdown afterwards.
  const suggestGen = useRef(0);
  const pendingSense = useRef<{ pos: string; n: number } | null>(null);
  // A synset identity ("<pos>:<offset>") waiting to be resolved against the
  // loaded definition. Set when a synonym link is followed, so the shared
  // sense is shown instead of the target word's most-common sense.
  const pendingSynset = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The dev server can still be compiling when the page first loads and
      // the one-shot fetch then fails; retry a few times before giving up.
      for (let attempt = 0; ; attempt++) {
        try {
          await loadDb();
          await dbMeta().then(setMeta).catch(() => {});
          if (!cancelled) setStatus({ state: "ready" });
          return;
        } catch {
          if (attempt >= 4) break;
          if (!cancelled)
            setStatus({ state: "loading", detail: "Loading dictionary… (retrying)" });
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      if (!cancelled)
        setStatus({
          state: "error",
          message: "Couldn't load the dictionary. Check your connection and refresh the page to try again.",
        });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runSearch = useCallback(async (word: string) => {
    const w = word.trim();
    if (!w || status.state !== "ready") return;
    // A search supersedes suggestions: cancel the debounce timer and
    // invalidate its generation so a late suggest() response can't
    // repopulate the dropdown over the definition.
    suggestGen.current += 1;
    if (suggestTimer.current) {
      clearTimeout(suggestTimer.current);
      suggestTimer.current = null;
    }
    setSuggestions([]);
    setActiveSug(-1);
    setSearched(true);
    // Keep the address bar shareable: it always reflects the current word.
    window.history.replaceState(null, "", wordUrl(w));
    try {
      const def = await defineWord(w);
      setResult(def);
      setNotFound(def ? null : w);
    } catch (e) {
      setStatus({ state: "error", message: (e as Error).message });
    }
  }, [status.state]);

  // Parse a shared link (?define=<word>&sense=<pos><n>) once on load.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const w = params.get("define")?.trim();
    if (!w) return;
    setDeepLink({
      word: w,
      sense: parseSenseParam(params.get("sense")),
      synset: parseSynsetParam(params.get("synset")),
    });
    setQuery(w);
  }, []);

  // Run the shared-link search once the dictionary is ready.
  useEffect(() => {
    if (status.state === "ready" && deepLink) {
      pendingSense.current = deepLink.sense;
      pendingSynset.current = deepLink.synset;
      const w = deepLink.word;
      setDeepLink(null);
      void runSearch(w);
    }
  }, [status.state, deepLink, runSearch]);

  // After results render, jump to the linked sense and flash it. A pending
  // synset (from a synonym click) is resolved to the target word's own sense
  // number first, so the shared meaning is shown.
  useEffect(() => {
    if (!result) return;
    let target: { pos: string; n: number } | null = null;
    if (pendingSynset.current != null) {
      const id = pendingSynset.current;
      pendingSynset.current = null;
      const s = result.senses.find((x) => x.synset === id);
      if (s) target = { pos: s.pos, n: s.n };
    } else if (pendingSense.current != null) {
      target = pendingSense.current;
      pendingSense.current = null;
    }
    if (!target) return;
    const el = document.getElementById(`sense-${target.pos}${target.n}`);
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    if (reduceMotion) return;
    el.classList.add("sense-flash");
    // Reduced motion: the CSS disables the animation, leaving a calm static
    // tint (no timer removes it); otherwise the flash fades on its own.
    if (reduceMotion) return;
    const t = setTimeout(() => el.classList.remove("sense-flash"), 2400);
    return () => clearTimeout(t);
  }, [result]);

  const onChange = (v: string) => {
    setQuery(v);
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (status.state !== "ready" || v.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    suggestGen.current += 1;
    const gen = suggestGen.current;
    suggestTimer.current = setTimeout(async () => {
      suggestTimer.current = null;
      try {
        const res = await suggest(v);
        // Drop responses superseded by a newer keystroke or a search.
        if (gen !== suggestGen.current) return;
        setSuggestions(res);
        setActiveSug(-1);
      } catch {
        /* db not ready; ignore */
      }
    }, 150);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" && suggestions.length) {
      e.preventDefault();
      setActiveSug((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && suggestions.length) {
      e.preventDefault();
      setActiveSug((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      if (activeSug >= 0 && suggestions[activeSug]) runSearch(suggestions[activeSug]);
      else runSearch(query);
    } else if (e.key === "Escape") {
      setSuggestions([]);
    }
  };

  const pick = (w: string) => {
    setQuery(w);
    inputRef.current?.focus();
    window.scrollTo({ top: 0 });
    runSearch(w);
  };

  // Synonym click: open the word, then land on the shared synset rather than
  // the word's own most-common sense (usually a different meaning).
  const pickSynonym = (w: string, synset: string) => {
    setQuery(w);
    inputRef.current?.focus();
    window.scrollTo({ top: 0 });
    pendingSynset.current = synset;
    runSearch(w);
    // runSearch resets the address bar to ?define=<word>; re-apply the synset
    // afterwards so the link stays shareable.
    window.history.replaceState(null, "", synsetUrl(w, synset));
  };

  const goHome = () => {
    setSearched(false);
    setResult(null);
    setNotFound(null);
    setQuery("");
    window.history.replaceState(null, "", pageBase());
  };

  const groups = result
    ? [...new Set(result.senses.map((s) => s.pos))].map((pos) => ({
        pos,
        senses: result.senses.filter((s) => s.pos === pos),
      }))
    : [];

  const pronGroups = result?.pronunciations?.length
    ? groupPronunciations(result.pronunciations)
    : [];
  // POS labels only when the word is pronounced differently by part of
  // speech (e.g. "live": verb /lɪv/, adjective /laɪv/).
  const showPronPos = pronGroups.length > 1;

  return (
    <div className="page">
      <div className={`hero${searched ? " compact" : ""}`}>
        <h1 className="wordmark" onClick={goHome} title="gloss — home">
          <span className="wordmark-name">gloss</span>
          <span className="wordmark-sep" aria-hidden="true">
            |
          </span>
          <span className="wordmark-tag">an open dictionary</span>
        </h1>
        <div className="searchbox">
          <div className="searchrow">
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder="Look up a word"
              aria-label="Word to define"
              aria-expanded={suggestions.length > 0}
              aria-controls="search-suggestions"
              role="combobox"
              aria-autocomplete="list"
              autoFocus
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              onBlur={() => setTimeout(() => setSuggestions([]), 120)}
            />

          </div>
          {suggestions.length > 0 && (
            <ul className="suggestions" id="search-suggestions" role="listbox">
              {suggestions.map((s, i) => (
                <li
                  key={s}
                  role="option"
                  aria-selected={i === activeSug}
                  className={i === activeSug ? "active" : ""}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(s)}
                  onMouseEnter={() => setActiveSug(i)}
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
        {status.state === "loading" && (
          <div className="status" aria-live="polite">
            {status.detail}{IS_DESKTOP || IS_REMOTE ? "" : " (one-time download, then it works offline)"}
          </div>
        )}
        {status.state === "error" && (
          <div className="status error" role="alert">
            {status.message}
          </div>
        )}
      </div>

      <div className="results">
        {result && (
          <>
            <div className="wordhead">
              {result.word}
              <CopyLinkButton
                url={wordUrl(result.word)}
                title="Copy link to this word"
                ariaLabel={`Copy link to ${result.word}`}
              />
            </div>
            {pronGroups.length > 0 && (
              <div className="pronunciation" aria-label="Pronunciation">
                <span className="pron-label">Pronunciation</span>
                {pronGroups.map((g) => (
                  <span
                    key={g.labels.join(",")}
                    className={showPronPos ? "pron-line" : undefined}
                  >
                    {showPronPos && (
                      <span className="pron-pos">
                        {g.labels.map((l) => POS_NAMES[l] ?? l).join(", ")}
                      </span>
                    )}
                    {g.items.map((p, i) => (
                      <span key={`${p.variety}-${i}`} title={p.ipa || undefined}>
                        {(g.items.length > 1 || showPronPos) &&
                          p.variety !== "" && (
                            <span className="pron-variety">{p.variety}</span>
                          )}
                        <span className="pron-text">{renderSyllabified(p.syllabified)}</span>
                        {i < g.items.length - 1 && (
                          <span className="pron-sep" aria-hidden="true">; </span>
                        )}
                      </span>
                    ))}
                  </span>
                ))}
              </div>
            )}
            {groups.map(({ pos, senses }) => (
              <div className="posgroup" key={pos}>
                <div className="poslabel">{POS_NAMES[pos] ?? pos}</div>
                {senses.map((s) => (
                  <div className="sense" id={`sense-${s.pos}${s.n}`} key={`${pos}-${s.n}`}>
                    <div className="definition">
                      <span className="definition-text">
                        <span className="sensenum">{s.n}.</span>
                        {s.definition}
                      </span>
                      <span className="sense-actions">
                        <CopySenseButton word={result.word} sense={s} />
                        <CopyLinkButton
                          url={senseUrl(result.word, s.pos, s.n)}
                          title="Copy link to this sense"
                          ariaLabel={`Copy link to ${s.pos} sense ${s.n} of ${result.word}`}
                        />
                      </span>
                    </div>
                    {s.examples.map((ex, i) => (
                      <div className="example" key={i}>“{ex}”</div>
                    ))}
                    {s.synonyms.length > 0 && (
                      <div className="synonyms">
                        <strong>Synonyms:</strong>{" "}
                        {s.synonyms.map((w, i) => (
                          <span key={w}>
                            {i > 0 && ", "}
                            <button
                              className="relword"
                              onClick={() => pickSynonym(w, s.synset)}
                              title={`Define ${w}`}
                            >
                              {w}
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {s.related.map((g) => (
                      <RelatedRow
                        key={`${result.word}-${pos}-${s.n}-${g.label}`}
                        label={g.label}
                        words={g.words}
                        more={g.more}
                        onPick={pick}
                      />
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
        {notFound && (
          <div className="notfound" aria-live="polite">
            No results for “{notFound}”. Check the spelling, or try a simpler word.
          </div>
        )}
      </div>

      <div className="footer">
        Definitions: Open English WordNet (CC-BY 4.0).{" "}
        <a href="license.html">License details</a>
      </div>
    </div>
  );
}
