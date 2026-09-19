"""gloss — a dead-simple dictionary.

import gloss
gloss.configure("/path/to/gloss.db")   # or set the GLOSS_DB env var,
                                       # or let the tier system pick one:
gloss.define("dog")                     # full tier (the default)
gloss.define("dog", tier="tiny")        # or set GLOSS_TIER=tiny
db = gloss.Database(tier="small")       # explicit handle
gloss.download("medium")                # pre-fetch a tier into the cache
"""

import os

from . import tiers
from ._db import Database as _Database, Entry, Related, Sense

__all__ = ["Database", "Entry", "Related", "Sense", "tiers",
           "configure", "define", "download", "lookup", "search"]

_db = None


class Database(_Database):
    """A handle on a gloss DB file.

    Pass a path, or let the tier system resolve one: ``Database(tier=...)``
    follows the selection in data/tiers/TIERS.md (explicit path, then
    tier name, then bundled tiny, then the platform cache, then download).
    """

    def __init__(self, path=None, tier=None):
        if path is None:
            path = tiers.resolve(tier=tier)
        super().__init__(path)
        self.path = path


def configure(path):
    """Point the module-level convenience API at a gloss.db file."""
    global _db
    if _db is not None:
        _db.close()
    _db = Database(path)
    return _db


def _default_db(tier=None):
    global _db
    if _db is not None:
        return _db
    env = os.environ.get(tiers.ENV_DB)
    if env:
        return configure(env)
    # Tier resolution: GLOSS_TIER (or `tier`), default "full"; bundled
    # tiny, platform cache, then download from the manifest.
    return configure(tiers.resolve(tier=tier))


def define(word, db=None, tier=None):
    """The single most common definition of `word`, or None."""
    return (db or _default_db(tier)).define(word)


def lookup(word, db=None, tier=None):
    """Full entry for `word`: every sense. None for unknown words."""
    return (db or _default_db(tier)).lookup(word)


def search(prefix, limit=10, db=None, tier=None):
    """Up to `limit` lemmas starting with `prefix`, alphabetical."""
    return (db or _default_db(tier)).search(prefix, limit)


def download(tier=None):
    """Pre-fetch a tier DB into the platform cache (SHA-256 verified).

    Defaults to the currently selected tier.
    """
    return tiers.download(tier)
