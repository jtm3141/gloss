import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "License — gloss",
  description: "Licensing and attribution for the gloss dictionary data.",
};

// Static page: ships as license.html in the export, so the relative
// footer link works from https:// and from file:// (desktop app).
export default function LicensePage() {
  return (
    <div className="page">
      <div className="license">
        <h1>Licensing</h1>

        <h2>In short</h2>
        <p>
          The definitions in gloss are <strong>free to reuse</strong> — including
          commercially — <strong>with credit</strong>. If you copy definitions
          from this site or from the gloss libraries, keep a credit line such as:
        </p>
        <p className="credit">via gloss · Open English WordNet (CC-BY 4.0)</p>
        <p>
          That credit is what the underlying data license asks for. Everything
          below is the full attribution behind that one line.
        </p>

        <h2>Dictionary data — Open English WordNet</h2>
        <ul>
          <li>
            Source:{" "}
            <a href="https://github.com/globalwordnet/english-wordnet">
              Open English WordNet
            </a>{" "}
            (Global WordNet Association); yearly editions at{" "}
            <a href="https://en-word.net/">en-word.net</a>.
          </li>
          <li>
            License:{" "}
            <a href="https://creativecommons.org/licenses/by/4.0/">CC-BY 4.0</a>{" "}
            — free to use, modify, and redistribute, including commercially,
            with attribution.
          </li>
          <li>
            Adaptation: gloss rebuilds OEWN&rsquo;s WNDB distribution as SQLite.
            The word data is unmodified; the format is.
          </li>
          <li>
            Provenance: the exact edition and download URL behind this build are
            recorded in the database itself (<code>meta</code> table:
            <code>oewn_edition</code>, <code>oewn_url</code>).
          </li>
          <li>
            Canonical citation: John P. McCrae, Alexandre Rademaker, Francis
            Bond, Ewa Rudnicka and Christiane Fellbaum (2019).{" "}
            <em>English WordNet 2019 – An Open-Source WordNet for English.</em>{" "}
            Proceedings of the 10th Global WordNet Conference (GWC 2019),
            Wroclaw.
          </li>
          <li>
            &ldquo;WordNet&rdquo; is a registered trademark of Princeton
            University. OEWN incorporates and corrects Princeton WordNet, plus{" "}
            <em>Taboo WordNet</em> (Merrick Choo Yeu Herng and Francis Bond,
            2021, Proceedings of GWC2021) — which is why the family-safe build
            filters taboo/offensive entries instead of shipping them unmarked.
          </li>
        </ul>

        <h2>Pronunciations</h2>
        <p>
          Pronunciations come from two sources, recorded per row in the
          database (<code>meta.pronunciation_sources</code>):
        </p>
        <ul>
          <li>
            The OEWN distribution itself (IPA with US/GB and other regional
            varieties) — same{" "}
            <a href="https://creativecommons.org/licenses/by/4.0/">
              CC-BY 4.0
            </a>{" "}
            as the dictionary data above.
          </li>
          <li>
            The{" "}
            <a href="https://github.com/cmusphinx/cmudict">
              CMU Pronouncing Dictionary
            </a>{" "}
            (© 1993–2015 Carnegie Mellon University, BSD-2-Clause-style
            terms), used to fill in words OEWN doesn&rsquo;t cover.
          </li>
        </ul>
        <p>
          The friendly phonetic respellings shown on this site are computed at
          build time from the IPA by a Python port of{" "}
          <a href="https://github.com/attacktive/ipa-to-pronunciation-respelling">
            attacktive/ipa-to-pronunciation-respelling
          </a>{" "}
          (MIT). Developers using the gloss libraries also get the raw IPA.
        </p>

        <h2>Content filtering</h2>
        <p>
          The public site and apps ship a family-safe build: taboo/offensive
          entries are removed at build time, while the canonical database keeps
          everything, flagged. Flag sources: dsojevic/profanity-list (MIT),
          LDNOOBW (CC-BY 4.0), and OEWN&rsquo;s own usage labels. Full policy
          and per-source provenance in{" "}
          <a href="https://github.com/jtm3141/gloss/blob/main/ATTRIBUTION.md">
            ATTRIBUTION.md
          </a>
          .
        </p>

        <h2>Our code</h2>
        <p>
          All original gloss code is MIT licensed — see{" "}
          <a href="https://github.com/jtm3141/gloss/blob/main/LICENSE">
            LICENSE
          </a>{" "}
          in the repository.
        </p>

        <p className="back">
          <a href="index.html">← Back to gloss</a>
        </p>
      </div>
    </div>
  );
}
