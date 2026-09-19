#!/usr/bin/env python3
"""The `gloss` command line.

    gloss define serendipity      # most common definition
    gloss suggest ser             # completions for a prefix
    gloss related dog @           # hypernyms of the most common sense
                                  # (@ hypernym, ~ hyponym, ! antonym, ...)
    gloss download --tier small   # pre-fetch a tier into the cache

Global flags: --db PATH (explicit database, beats everything),
--tier NAME (default "full").
"""

import argparse
import sys

import gloss

PTR_NAMES = {
    "@": "hypernyms",
    "~": "hyponyms",
    "!": "antonyms",
    "#m": "member meronyms",
    "#p": "part meronyms",
    "#s": "substance meronyms",
    "%m": "member holonyms",
    "%p": "part holonyms",
    "%s": "substance holonyms",
    "=": "attributes",
    "\\": "derivationally related",
    ";c": "domain: topic",
    "-c": "domain member: topic",
    ";r": "domain: region",
    "-r": "domain member: region",
    ";u": "domain: usage",
    "-u": "domain member: usage",
}


def _database(args):
    if args.db:
        return gloss.Database(args.db)
    return gloss.Database(tier=args.tier)


def _print_sense(word, sense):
    print(f"{word} ({sense.pos}.{sense.sense_no})")
    print(f"  {sense.definition}")
    for example in sense.examples:
        print(f"  ex: {example}")
    if sense.synonyms:
        print(f"  synonyms: {', '.join(sense.synonyms)}")


def cmd_define(args):
    entry = _database(args).lookup(args.word)
    if entry is None:
        print(f"{args.word}: no definition found", file=sys.stderr)
        return 1
    _print_sense(entry.word, entry.senses[0])
    return 0


def cmd_suggest(args):
    for word in _database(args).search(args.prefix):
        print(word)
    return 0


def cmd_related(args):
    db = _database(args)
    entry = db.lookup(args.word)
    if entry is None:
        print(f"{args.word}: no definition found", file=sys.stderr)
        return 1
    sense = entry.senses[0]
    label = PTR_NAMES.get(args.ptr, f"related ({args.ptr})")
    print(f"{entry.word} ({sense.pos}.{sense.sense_no}): {label}")
    related = db.related(sense, args.ptr)
    if not related:
        print("  (none)")
    for target in related:
        print(f"  {', '.join(target.words)}")
        print(f"    {target.definition}")
    return 0


def cmd_download(args):
    path = gloss.download(args.tier)
    name = args.tier or gloss.tiers.selected_tier()
    print(f"tier {name!r} cached at {path}")
    return 0


def build_parser():
    parser = argparse.ArgumentParser(
        prog="gloss", description="A dead-simple dictionary.")
    parser.add_argument("--db", metavar="PATH",
                        help="explicit database file (beats everything)")
    parser.add_argument("--tier", metavar="NAME",
                        help="database tier: tiny, small, medium, full "
                             "(default: full, or $GLOSS_TIER)")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("define", help="most common definition of a word")
    p.add_argument("word")
    p.set_defaults(func=cmd_define)

    p = sub.add_parser("suggest", help="completions for a prefix")
    p.add_argument("prefix")
    p.set_defaults(func=cmd_suggest)

    p = sub.add_parser("related",
                       help="related words of the most common sense")
    p.add_argument("word")
    p.add_argument("ptr", nargs="?", default="@",
                   help="pointer type: @ hypernym (default), ~ hyponym, "
                        "! antonym, ...")
    p.set_defaults(func=cmd_related)

    p = sub.add_parser("download", help="pre-fetch a tier into the cache")
    p.add_argument("--tier", dest="tier", metavar="NAME",
                   help="tier to download (default: the selected tier)")
    p.set_defaults(func=cmd_download)

    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except FileNotFoundError as e:
        print(f"gloss: {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"gloss: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
