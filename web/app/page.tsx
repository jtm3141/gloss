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

function CopySenseButton({ word, sense }: { word: string; sense: Sense }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const onClick = async () => {
    if (await copyText(senseText(sense))) {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    }
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

export default function Home() {
  const [status, setStatus] = useState<DbStatus>({ state: "loading", detail: "Loading dictionary…" });
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeSug, setActiveSug] = useState(-1);
  const [result, setResult] = useState<Definition | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [meta, setMeta] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    try {
      const def = await defineWord(w);
      setResult(def);
      setNotFound(def ? null : w);
    } catch (e) {
      setStatus({ state: "error", message: (e as Error).message });
    }
  }, [status.state]);

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

  const groups = result
    ? [...new Set(result.senses.map((s) => s.pos))].map((pos) => ({
        pos,
        senses: result.senses.filter((s) => s.pos === pos),
      }))
    : [];

  return (
    <div className="page">
      <div className={`hero${searched ? " compact" : ""}`}>
        <h1 className="wordmark" onClick={() => { setSearched(false); setResult(null); setNotFound(null); setQuery(""); }}>
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
            <div className="wordhead">{result.word}</div>
            {groups.map(({ pos, senses }) => (
              <div className="posgroup" key={pos}>
                <div className="poslabel">{POS_NAMES[pos] ?? pos}</div>
                {senses.map((s) => (
                  <div className="sense" key={`${pos}-${s.n}`}>
                    <div className="definition">
                      <span className="sensenum">{s.n}.</span>
                      {s.definition}
                      <CopySenseButton word={result.word} sense={s} />
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
        gloss {meta.oewn_edition ? `${meta.oewn_edition} · ` : ""}family-safe build · free to use, no account needed
        <br />
        Definitions are free to reuse with credit — data: Open English WordNet (CC-BY 4.0).{" "}
        <a href="license.html">License details</a>
      </div>
    </div>
  );
}
