#!/usr/bin/env python3
"""IPA -> friendly pronunciation respelling (English).

Python port of Attacktive's ``ipa-to-pronunciation-respelling``
(https://github.com/attacktive/ipa-to-pronunciation-respelling),
MIT licensed. The phoneme tables, the IPA tokenizer, and the
sonority/onset syllabifier are ported faithfully; only the language
changed. Original copyright (c) Attacktive.

Scheme: each IPA phoneme maps to a plain-English respelling chunk
(e.g. ``i:`` -> ``ee``, ``eI`` -> ``ay``); syllables are found by
sonority/onset rules and the primary-stressed syllable is UPPERCASED::

    "ˈdɪkʃənɛri" -> "DIHkshuhnehree"
    "ˈziːɹəʊ"   -> "ZEEroh"

gloss uses this at build time (data/build_db.py) to precompute the
``respelling`` column of the ``pronunciation`` table, so shipped
clients (web, apps) need no phonetics dependency: the website shows
the respelling, developers get the IPA too.

Public entry points: :func:`convert` (plain respelling) and
:func:`convert_syllabified` (same, with ``·`` syllable separators).
"""

import unicodedata

# ---------------------------------------------------------------------------
# Mappings (from mappings.ts)
# ---------------------------------------------------------------------------

# category -> sonority (higher = more sonorous)
_CATEGORY_SONORITY = {
    "vowel": 8,
    "glide": 7,
    "liquid": 6,
    "nasal": 5,
    "fricative": 4,
    "affricate": 3,
    "stop": 2,
}

# (ipa, canonical respelling, category)
_CONSONANTS = [
    ("b", "b", "stop"), ("tʃ", "ch", "affricate"), ("d", "d", "stop"),
    ("ð", "dh", "fricative"), ("f", "f", "fricative"), ("ɡ", "g", "stop"),
    ("h", "h", "fricative"), ("ɦ", "h", "fricative"), ("dʒ", "j", "affricate"),
    ("k", "k", "stop"), ("x", "kh", "fricative"), ("l", "l", "liquid"),
    ("ɫ", "l", "liquid"), ("ʎ", "ly", "liquid"), ("m", "m", "nasal"),
    ("ɱ", "m", "nasal"), ("n", "n", "nasal"), ("ɳ", "n", "nasal"),
    ("ŋ", "ng", "nasal"), ("ɴ", "ng", "nasal"), ("ŋk", "nk", "stop"),
    ("p", "p", "stop"), ("r", "r", "liquid"), ("ɹ", "r", "liquid"),
    ("ɾ", "r", "liquid"), ("ɽ", "r", "liquid"), ("s", "s", "fricative"),
    ("ʃ", "sh", "fricative"), ("t", "t", "stop"), ("ʈ", "t", "stop"),
    ("θ", "th", "fricative"), ("v", "v", "fricative"), ("ʍ", "wh", "fricative"),
    ("w", "w", "glide"), ("ɥ", "w", "glide"), ("ɰ", "w", "glide"),
    ("ʷ", "w", "glide"),  # labialization modifier (deviation from upstream)
    ("hw", "wh", "glide"), ("j", "y", "glide"), ("ʝ", "y", "fricative"),
    ("z", "z", "fricative"), ("ʒ", "zh", "fricative"), ("ç", "ch", "fricative"),
    ("ʣ", "dz", "affricate"), ("ʤ", "j", "affricate"), ("ʦ", "ts", "affricate"),
    ("ʧ", "ch", "affricate"), ("ɢ", "g", "stop"), ("ʔ", "", "stop"),
    ("c", "k", "stop"), ("ɟ", "g", "stop"), ("q", "k", "stop"),
    ("χ", "kh", "fricative"), ("ʁ", "r", "fricative"), ("ħ", "h", "fricative"),
    ("ʕ", "", "fricative"),
]

_VOWELS = [
    ("æ", "a"), ("ɑ", "ah"), ("ɑː", "ah"), ("ɛər", "air"), ("ɑːr", "ar"),
    ("ɑr", "ar"), ("ær", "arr"), ("ɔː", "aw"), ("eɪ", "ay"), ("e", "eh"),
    ("ɛ", "eh"), ("iː", "ee"), ("i", "ee"), ("ɪər", "eer"), ("ɛr", "err"),
    ("juː", "ew"), ("ju", "ew"), ("aɪ", "eye"), ("ɪ", "ih"), ("aɪər", "ire"),
    ("ɪr", "irr"), ("ɒ", "o"), ("oʊ", "oh"), ("əʊ", "oh"), ("ɔɪər", "oir"),
    ("uː", "oo"), ("u", "oo"), ("ʊər", "oor"), ("ɔːr", "or"), ("ɔr", "or"),
    ("ɒr", "orr"), ("aʊər", "our"), ("aʊ", "ow"), ("ɔɪ", "oy"), ("ʌ", "uh"),
    ("ɜːr", "ur"), ("ɜr", "ur"), ("jʊər", "ure"), ("ʌr", "urr"), ("ʊ", "uu"),
    ("ʊr", "uurr"), ("ə", "uh"), ("ᵊ", "uh"),  # ᵊ = superscript schwa
    ("ər", "er"), ("y", "ue"), ("ø", "eu"),
    ("œ", "eu"), ("ɶ", "a"), ("ɨ", "i"), ("ʉ", "u"), ("ɯ", "u"),
    ("ɘ", "uh"), ("ɵ", "uh"), ("ɤ", "uh"), ("ɜ", "uh"), ("ɞ", "uh"),
    ("ɐ", "uh"), ("ɚ", "er"), ("ɝ", "ur"), ("ɔ", "aw"), ("o", "aw"),
    ("oː", "aw"), ("a", "ah"), ("ɑ̃", "on"), ("ɛ̃", "an"), ("ɔ̃", "on"),
    ("œ̃", "un"),
]

_STRESS_MARK = "ˈ"
_SECONDARY_STRESS_MARK = "ˌ"
_LENGTH_MARK = "ː"

# ipa (NFD) -> (respelling, category, sonority)
_SYMBOL_BY_IPA = {}
for _ipa, _resp, _cat in _CONSONANTS + [(v[0], v[1], "vowel") for v in _VOWELS]:
    _SYMBOL_BY_IPA[unicodedata.normalize("NFD", _ipa)] = (
        _resp, _cat, _CATEGORY_SONORITY[_cat])
del _ipa, _resp, _cat

# Match chunks, longest first; length marks are skipped during matching
# (the parser retains "long" as token metadata, unused by the converter).
_PHONEME_CHUNKS = sorted(
    {unicodedata.normalize("NFD", ipa).replace(_LENGTH_MARK, "")
     for ipa, *_ in _CONSONANTS + _VOWELS},
    key=len, reverse=True)

# Stripped pre-tokenization: tie bars become adjacent affricates and
# hyphens remain formatting-only.
_IGNORED_SYMBOLS = ("\u0361", "\u035C", "-")
# Deviation from upstream: these combining marks carry no weight in the
# respelling scheme (nasalization, centralization, voicing/dental tweaks,
# rhoticity, extra-short/long), so they are stripped instead of failing
# the whole conversion. Seen in OEWN US/GB data (e.g. "internet"):
#   U+0303 tilde, U+0308 diaeresis, U+032C caron below, U+032A bridge below,
#   U+0306 breve, U+0304 macron, U+0325 ring below, U+02DE rhotic hook.
_STRIPPED_DIACRITICS = ("\u0303", "\u0308", "\u032C", "\u032A", "\u0306", "\u0304", "\u0325", "\u02DE")


def _nfd(s):
    return unicodedata.normalize("NFD", s)


def _clean_vowel(v):
    return _nfd(v).replace(_LENGTH_MARK, "")


_NORMALIZED_VOWELS = sorted({_clean_vowel(v[0]) for v in _VOWELS},
                            key=len, reverse=True)
_VOWEL_CHUNKS = set(_NORMALIZED_VOWELS)
_R_COLORED_VOWELS = {v for v in _NORMALIZED_VOWELS if v.endswith("r")}

# ---------------------------------------------------------------------------
# Parser (from parser.ts): IPA string -> tokens
# ---------------------------------------------------------------------------

_SYLLABICITY_BY_DIACRITIC = {"\u030D": True, "\u0329": True, "\u032F": False}
_STRESS_LEVEL_BY_MARK = {_STRESS_MARK: "primary",
                         _SECONDARY_STRESS_MARK: "secondary"}
_SYLLABLE_SEPARATORS = {" ", "."}
_LITERALS = {"/", "[", "]"}
_OPTIONAL_BOUNDARY = {"(": "start", ")": "end"}
_PAREN_DEPTH_CHANGE = {"(": 1, ")": -1}
# The respelling scheme intentionally does not encode standalone length,
# half-length, or aspiration marks.
_IGNORED_PHONETIC_MARKS = {_LENGTH_MARK, "ʰ", "ˑ"}


def _has_multiple_segments(ipa):
    return sum(1 for ch in ipa if ch.isalpha()) > 1


def _closes_outer_paren_early(ipa):
    depth = 0
    for i in range(len(ipa) - 1):
        depth += _PAREN_DEPTH_CHANGE.get(ipa[i], 0)
        if depth == 0:
            return True
    return False


def _unwrap_outer_parens(ipa):
    if not ipa.startswith("(") or not ipa.endswith(")") \
            or _closes_outer_paren_early(ipa):
        return ipa
    return ipa[1:-1]


def _match_candidate_at(ipa, index, candidate):
    """Try to match `candidate` at `index`, skipping length marks.

    Returns (matched_ipa, next_index, long) or None.
    """
    src = index
    long = False
    n = len(ipa)
    for ch in candidate:
        while src < n and ipa[src] == _LENGTH_MARK:
            long = True
            src += 1
        if src >= n or ipa[src] != ch:
            return None
        src += 1
    while src < n and ipa[src] == _LENGTH_MARK:
        long = True
        src += 1
    return candidate, src, long


def _starts_with_vowel_at(ipa, index):
    return any(_match_candidate_at(ipa, index, v) is not None
               for v in _NORMALIZED_VOWELS)


def _match_phoneme_at(ipa, index):
    for chunk in _PHONEME_CHUNKS:
        m = _match_candidate_at(ipa, index, chunk)
        if m is None:
            continue
        # An r-colored vowel followed by another vowel is not r-colored.
        if chunk in _R_COLORED_VOWELS and _starts_with_vowel_at(ipa, m[1]):
            continue
        return m
    return None


def _clean_ipa(ipa):
    result = _unwrap_outer_parens(_nfd(ipa))
    for sym in _IGNORED_SYMBOLS + _STRIPPED_DIACRITICS:
        result = result.replace(sym, "")
    return result


class _Ctx:
    __slots__ = ("original", "cleaned", "tokens", "index", "opt_depth")

    def __init__(self, original):
        self.original = original
        self.cleaned = _clean_ipa(original)
        self.tokens = []
        self.index = 0
        self.opt_depth = 0


def _consume_paren(ctx):
    ch = ctx.cleaned[ctx.index]
    boundary = _OPTIONAL_BOUNDARY.get(ch)
    if boundary is None:
        return False
    if boundary == "end" and ctx.opt_depth == 0:
        raise ValueError(
            f"{ctx.original} contains an unmatched closing parenthesis.")
    ctx.tokens.append(("optional", boundary))
    ctx.opt_depth += 1 if boundary == "start" else -1
    ctx.index += 1
    return True


def _consume_stress(ctx):
    level = _STRESS_LEVEL_BY_MARK.get(ctx.cleaned[ctx.index])
    if level is None:
        return False
    ctx.tokens.append(("stress", level))
    ctx.index += 1
    return True


def _consume_boundary(ctx):
    if ctx.cleaned[ctx.index] not in _SYLLABLE_SEPARATORS:
        return False
    ctx.tokens.append(("boundary", ctx.cleaned[ctx.index]))
    ctx.index += 1
    return True


def _consume_literal(ctx):
    if ctx.cleaned[ctx.index] not in _LITERALS:
        return False
    ctx.tokens.append(("literal", ctx.cleaned[ctx.index]))
    ctx.index += 1
    return True


def _consume_syllabicity(ctx):
    syllabic = _SYLLABICITY_BY_DIACRITIC.get(ctx.cleaned[ctx.index])
    if syllabic is None:
        return False
    if ctx.tokens and ctx.tokens[-1][0] == "phoneme":
        kind, ipa, long, syl, non_syl = ctx.tokens[-1]
        if not syllabic and ipa in _VOWEL_CHUNKS \
                and _has_multiple_segments(ipa):
            ctx.tokens[-1] = (kind, ipa, long, syl, True)
        else:
            ctx.tokens[-1] = (kind, ipa, long, syllabic, non_syl)
    ctx.index += 1
    return True


def _consume_phoneme(ctx):
    m = _match_phoneme_at(ctx.cleaned, ctx.index)
    if m is None:
        return False
    ipa, next_index, long = m
    # (kind, ipa, long, syllabic|None, contains_non_syllabic_component)
    ctx.tokens.append(("phoneme", ipa, long, None, False))
    ctx.index = next_index
    return True


def _consume_ignored_mark(ctx):
    if ctx.cleaned[ctx.index] not in _IGNORED_PHONETIC_MARKS:
        return False
    ctx.index += 1
    return True


_TOKEN_CONSUMERS = (_consume_paren, _consume_stress, _consume_boundary,
                    _consume_literal, _consume_syllabicity, _consume_phoneme,
                    _consume_ignored_mark)


def _parse_ipa(ipa):
    ctx = _Ctx(ipa)
    n = len(ctx.cleaned)
    while ctx.index < n:
        if not any(c(ctx) for c in _TOKEN_CONSUMERS):
            raise ValueError(
                f"{ipa} contains unsupported symbol(s) around: "
                f"\"{ctx.cleaned[ctx.index]}\".")
    if ctx.opt_depth != 0:
        raise ValueError(f"{ipa} contains an unclosed optional group.")
    return ctx.tokens


# ---------------------------------------------------------------------------
# Syllabifier (from syllabifier.ts): token indexes where syllables break
# ---------------------------------------------------------------------------

_LEGAL_ONSET_CLUSTERS = {
    "pl", "bl", "kl", "gl", "fl", "sl",
    "pr", "br", "tr", "dr", "kr", "gr", "fr", "θr", "ʃr",
    "tw", "dw", "kw", "gw", "sw", "θw", "hw",
    "pj", "bj", "tj", "dj", "kj", "gj", "fj", "vj", "θj", "sj", "zj",
    "hj", "mj", "nj", "lj",
    "sp", "st", "sk", "sm", "sn",
    "spl", "spr", "str", "skr", "skw",
}
_NON_ONSET_PHONEMES = {"ŋ", "ɴ", "ŋk"}
_ONSET_EQUIVALENTS = {"ɡ": "g", "ɹ": "r", "ɾ": "r", "ɽ": "r", "ʁ": "r",
                      "ɫ": "l"}


def _is_vowel(tok):
    sym = _SYMBOL_BY_IPA.get(_nfd(tok[1]))
    return sym is not None and sym[1] == "vowel"


def _is_nucleus(tok):
    if tok[3] is not None:  # explicit syllabicity diacritic
        return tok[3]
    return _is_vowel(tok)


def _normalize_onset(toks):
    return "".join(_ONSET_EQUIVALENTS.get(t[1], t[1]) for t in toks)


def _can_be_onset(toks):
    if len(toks) == 1:
        return toks[0][1] not in _NON_ONSET_PHONEMES \
            and not _is_nucleus(toks[0])
    return _normalize_onset(toks) in _LEGAL_ONSET_CLUSTERS


def _find_boundary_before(tokens, consonant_indexes, next_nucleus_index):
    for onset_start in range(len(consonant_indexes)):
        onset = [tokens[i] for i in consonant_indexes[onset_start:]
                 if tokens[i][0] == "phoneme"]
        if _can_be_onset(onset):
            return consonant_indexes[onset_start]
    return next_nucleus_index


def _find_nuclei(tokens, start, end):
    nuclei = []
    current = []
    for i in range(start, end):
        tok = tokens[i]
        if tok[0] != "phoneme":
            continue
        if _is_nucleus(tok):
            if current:
                nuclei.append(current)
            current = [i]
            continue
        if _is_vowel(tok) and tok[3] is False and current:
            current.append(i)
            continue
        if current:
            nuclei.append(current)
        current = []
    if current:
        nuclei.append(current)
    return nuclei


def _find_boundary_between_nuclei(tokens, prev_nucleus, next_nucleus):
    first, last = prev_nucleus[-1] + 1, next_nucleus[0]
    consonant_indexes = [i for i in range(first, last)
                         if tokens[i][0] == "phoneme"]
    if not consonant_indexes:
        return next_nucleus[0]
    return _find_boundary_before(tokens, consonant_indexes,
                                 next_nucleus[0])


def _find_region_boundaries(tokens, start, end):
    nuclei = _find_nuclei(tokens, start, end)
    return [_find_boundary_between_nuclei(tokens, nuclei[i - 1], nuclei[i])
            for i in range(1, len(nuclei))]


def _is_region_break(tok):
    return tok[0] in ("stress", "boundary", "literal")


def _find_syllable_boundaries(tokens):
    boundaries = set()
    region_start = 0
    for i, tok in enumerate(tokens):
        if not _is_region_break(tok):
            continue
        boundaries.update(_find_region_boundaries(tokens, region_start, i))
        region_start = i + 1
    boundaries.update(
        _find_region_boundaries(tokens, region_start, len(tokens)))
    return boundaries


# ---------------------------------------------------------------------------
# Converter (from converter.ts): tokens -> respelling string
# ---------------------------------------------------------------------------

def _convert_token(tok):
    sym = _SYMBOL_BY_IPA.get(_nfd(tok[1]))
    if sym is None:
        raise ValueError(f'Token "{tok[1]}" has no mapping!')
    return sym[0]


def _syllable_events(ipa):
    """Yield ("syl", text) / ("sep", text) events for an IPA string.

    A "syl" event is one syllable's respelled text (uppercased when it
    carries primary stress); a "sep" event is a separator (word space or
    literal text) that syllable dots must not cross; a "dot" event is a
    "." syllable break from the source IPA, which renders as the syllable
    separator in syllabified output. Raises ValueError on unsupported
    symbols, same as convert().
    """
    tokens = _parse_ipa(ipa)
    boundaries = _find_syllable_boundaries(tokens)
    current = []
    pending_stress = False

    def flush():
        nonlocal pending_stress
        if not current:
            return None
        text = "".join(current)
        stressed = pending_stress
        pending_stress = False
        current.clear()
        return ("syl", text.upper() if stressed else text)

    for i, tok in enumerate(tokens):
        if i in boundaries:
            ev = flush()
            if ev is not None:
                yield ev
        kind = tok[0]
        if kind == "phoneme":
            current.append(_convert_token(tok))
            continue
        if kind == "optional":
            current.append("(" if tok[1] == "start" else ")")
            continue
        if kind == "stress":
            ev = flush()
            if ev is not None:
                yield ev
            pending_stress = tok[1] == "primary"
            continue
        if kind == "boundary":
            ev = flush()
            if ev is not None:
                yield ev
            # A "." in the source IPA is an explicit syllable break (OEWN
            # ships these, e.g. "aberration" US). It gets the syllable
            # separator in syllabified output, not a space. Real word
            # spaces stay spaces.
            yield ("dot", "") if tok[1] == "." else ("sep", " ")
            continue
        # literal
        ev = flush()
        if ev is not None:
            yield ev
        yield ("sep", tok[1])
    ev = flush()
    if ev is not None:
        yield ev


def convert(ipa):
    """Respell an IPA string in plain English. Raises ValueError on
    unsupported symbols."""
    return "".join(
        " " if kind == "dot" else text for kind, text in _syllable_events(ipa)
    ).replace("()", "")


def convert_syllabified(ipa, sep="·"):
    """Respell an IPA string with syllable boundaries marked.

    Same plain-English chunks as convert(), but syllables are joined with
    ``sep`` (default U+00B7 middle dot) and the primary-stressed syllable
    is UPPERCASED::

        "ˈdɪkʃənɛri" -> "DIHK·shuh·neh·ree"

    Raises ValueError on unsupported symbols, same as convert().
    """
    parts = []
    prev_syl = False
    for kind, text in _syllable_events(ipa):
        if kind == "syl":
            if prev_syl:
                parts.append(sep)
            parts.append(text)
            prev_syl = True
        elif kind == "dot":
            # Explicit source-IPA syllable break: same separator, and it
            # breaks syl-adjacency so no doubled separator follows.
            parts.append(sep)
            prev_syl = False
        else:
            parts.append(text)
            prev_syl = False
    # An optional mark contributing no sound (e.g. "(\u02cc)" in "\u02c8z\u026a\u0279(\u02cc)o\u028a")
    # can trap a dot inside empty parens: "ZIHR(\u00b7)oh" -> "ZIHR\u00b7oh".
    s = "".join(parts).replace("()", "")
    # Dots trapped inside/against optional "(...)" groups: "bayt(\u00b7h)oh"
    # -> "bayt\u00b7(h)oh"; a leading "(\u00b7)" ("\u00b7see\u00b7pee\u00b7EW")
    # collapses to a leading dot, which is stripped.
    s = s.replace("(\u00b7)", "\u00b7")
    s = s.replace("(\u00b7", "\u00b7(")
    while "\u00b7\u00b7" in s:
        s = s.replace("\u00b7\u00b7", "\u00b7")
    return s.strip("\u00b7")


if __name__ == "__main__":
    for sample in ["ˈdɪkʃənɛri", "ˈziːɹəʊ", "ˈzɪəɹəʊ", "ˌɪntərˈnɛt",
                   "kæt", "bʊk", "ˈwɔːtər"]:
        print(f"{sample} -> {convert(sample)}")
