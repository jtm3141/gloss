"""gloss — a dead-simple dictionary.

import gloss
gloss.configure("/path/to/gloss.db")   # or set the GLOSS_DB env var,
                                       # or keep data/gloss.db near your cwd
gloss.define("dog")
gloss.lookup("dog")
"""

import os

from ._db import Database, Entry, Related, Sense

__all__ = ["Database", "Entry", "Related", "Sense",
           "configure", "define", "lookup", "search"]

_db = None


def configure(path):
    """Point the module-level convenience API at a gloss.db file."""
    global _db
    if _db is not None:
        _db.close()
    _db = Database(path)
    return _db


def _default_db():
    global _db
    if _db is not None:
        return _db
    env = os.environ.get("GLOSS_DB")
    if env:
        return configure(env)
    # Walk up from the cwd looking for data/gloss.db (the repo layout).
    d = os.path.abspath(os.getcwd())
    while True:
        candidate = os.path.join(d, "data", "gloss.db")
        if os.path.exists(candidate):
            return configure(candidate)
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    raise FileNotFoundError(
        "no gloss.db found: call gloss.configure(path), set GLOSS_DB, "
        "or run from the gloss repo so data/gloss.db is nearby")


def define(word, db=None):
    """The single most common definition of `word`, or None."""
    return (db or _default_db()).define(word)


def lookup(word, db=None):
    """Full entry for `word`: every sense. None for unknown words."""
    return (db or _default_db()).lookup(word)


def search(prefix, limit=10, db=None):
    """Up to `limit` lemmas starting with `prefix`, alphabetical."""
    return (db or _default_db()).search(prefix, limit)
