"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { defineWord, suggest, loadDb, dbMeta, type Definition, type Sense, type DbStatus } from "@/lib/db";

const POS_NAMES: Record<string, string> = {
  n: "noun",
  v: "verb",
  a: "adjective",
  r: "adverb",
};

// Plain-text rendering of one sense, for the clipboard. Ends with an
// attribution line: OEWN is CC-BY 4.0, so copied text carries its source.
function senseText(word: string, posLabel: string, s: Sense): string {
  const lines = [`${word} — ${posLabel}, sense ${s.n}`, s.definition];
  if (s.synonyms.length > 0) lines.push(`Synonyms: ${s.synonyms.join(", ")}`);
  for (const ex of s.examples) lines.push(`“${ex}”`);
  lines.push("via gloss · Open English WordNet (CC-BY 4.0)");
  return lines.join("\n");
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

function CopySenseButton({ word, posLabel, sense }: { word: string; posLabel: string; sense: Sense }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const onClick = async () => {
    if (await copyText(senseText(word, posLabel, sense))) {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <button
      className="copybtn"
      onClick={onClick}
      title="Copy this sense to the clipboard"
      aria-label={`Copy sense ${sense.n} of ${word}`}
    >
      {copied ? "Copied ✓" : "Copy"}
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
                    <CopySenseButton word={result.word} posLabel={POS_NAMES[pos] ?? pos} sense={s} />
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
        Data: <a href="https://github.com/mcrae-anlp/oewn">Open English WordNet</a> (CC-BY 4.0) ·
        full source, license &amp; citation details in <a href="https://github.com/jtm3141/gloss/blob/main/ATTRIBUTION.md">ATTRIBUTION.md</a>
      </div>
    </div>
  );
}
