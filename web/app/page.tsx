"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { defineWord, suggest, loadDb, dbMeta, type Definition, type Sense, type DbStatus } from "@/lib/db";

const POS_NAMES: Record<string, string> = {
  n: "noun",
  v: "verb",
  a: "adjective",
  r: "adverb",
};

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

// Shareable URLs: ?define=<word> opens the word page, &sense=<n> jumps to
// one sense (n is the WordNet sense number, 1 = most common). Built from the
// current location so the links work over https and file:// alike.
function pageBase(): string {
  return window.location.href.split("?")[0].split("#")[0];
}

function wordUrl(word: string): string {
  return `${pageBase()}?define=${encodeURIComponent(word)}`;
}

function senseUrl(word: string, n: number): string {
  return `${wordUrl(word)}&sense=${n}`;
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

export default function Home() {
  const [status, setStatus] = useState<DbStatus>({ state: "loading", detail: "Loading dictionary…" });
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeSug, setActiveSug] = useState(-1);
  const [result, setResult] = useState<Definition | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [deepLink, setDeepLink] = useState<{ word: string; sense: number | null } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSense = useRef<number | null>(null);

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

  // Parse a shared link (?define=<word>&sense=<n>) once on load.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const w = params.get("define")?.trim();
    if (!w) return;
    const sn = Number.parseInt(params.get("sense") ?? "", 10);
    setDeepLink({ word: w, sense: Number.isInteger(sn) && sn > 0 ? sn : null });
    setQuery(w);
  }, []);

  // Run the shared-link search once the dictionary is ready.
  useEffect(() => {
    if (status.state === "ready" && deepLink) {
      pendingSense.current = deepLink.sense;
      const w = deepLink.word;
      setDeepLink(null);
      void runSearch(w);
    }
  }, [status.state, deepLink, runSearch]);

  // After results render, jump to the linked sense and flash it.
  useEffect(() => {
    if (!result || pendingSense.current == null) return;
    const n = pendingSense.current;
    pendingSense.current = null;
    const el = document.getElementById(`sense-${n}`);
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    if (reduceMotion) return;
    el.classList.add("sense-flash");
    const t = setTimeout(() => el.classList.remove("sense-flash"), 1600);
    return () => clearTimeout(t);
  }, [result]);

  const onChange = (v: string) => {
    setQuery(v);
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (status.state !== "ready" || v.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    suggestTimer.current = setTimeout(async () => {
      try {
        setSuggestions(await suggest(v));
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

  return (
    <div className="page">
      <div className={`hero${searched ? " compact" : ""}`}>
        <h1 className="wordmark" onClick={goHome}>
          gloss
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
            <button className="define" onClick={() => runSearch(query)}>
              Define
            </button>
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
            {status.detail} (one-time download, then it works offline)
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
            {groups.map(({ pos, senses }) => (
              <div className="posgroup" key={pos}>
                <div className="poslabel">{POS_NAMES[pos] ?? pos}</div>
                {senses.map((s) => (
                  <div className="sense" id={`sense-${s.n}`} key={`${pos}-${s.n}`}>
                    <div className="definition">
                      <span className="sensenum">{s.n}.</span>
                      {s.definition}
                      <CopySenseButton word={result.word} sense={s} />
                      <CopyLinkButton
                        url={senseUrl(result.word, s.n)}
                        title="Copy link to this sense"
                        ariaLabel={`Copy link to sense ${s.n} of ${result.word}`}
                      />
                    </div>
                    {s.examples.map((ex, i) => (
                      <div className="example" key={i}>“{ex}”</div>
                    ))}
                    {s.synonyms.length > 0 && (
                      <div className="synonyms">
                        <strong>Synonyms:</strong> {s.synonyms.join(", ")}
                      </div>
                    )}
                    {s.related.map((g) => (
                      <div className="related" key={g.label}>
                        <span className="rellabel">{g.label}:</span>{" "}
                        {g.words.map((w, i) => (
                          <span key={w}>
                            {i > 0 && <span className="chipsep"> · </span>}
                            <button className="chip" onClick={() => pick(w)} title={`Define ${w}`}>
                              {w}
                            </button>
                          </span>
                        ))}
                        {g.more > 0 && <span className="chipmore"> +{g.more} more</span>}
                      </div>
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
