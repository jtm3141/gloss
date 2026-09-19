"""Tier selection for gloss databases.

Implements the "Tier selection" contract in data/tiers/TIERS.md,
identically across languages:

1. An explicit path wins: the ``db_path`` argument or ``GLOSS_DB``.
2. Otherwise a tier name: the ``tier`` argument or ``GLOSS_TIER``
   (default ``"full"``).
3. Find the file: the package's bundled data (only ``tiny`` ships
   bundled), then the platform cache dir.
4. Download it if missing: ``<base_url>/gloss-<tier>.db`` from the
   bundled manifest, SHA-256 verified into the cache. ``GLOSS_MIRROR``
   overrides ``base_url``; ``GLOSS_OFFLINE=1`` disables downloading.

An unknown tier name is a ``ValueError``, never a guess.
"""

import hashlib
import json
import os
import sys
import urllib.request

TIERS = ("tiny", "small", "medium", "full")
DEFAULT_TIER = "full"
ENV_TIER = "GLOSS_TIER"
ENV_DB = "GLOSS_DB"
ENV_MIRROR = "GLOSS_MIRROR"
ENV_OFFLINE = "GLOSS_OFFLINE"

# gloss-tiny.db and manifest.json are shipped as package data. They are
# copies of data/tiers/ — re-sync them when the tiers are rebuilt (the
# release checklist in data/tiers/TIERS.md covers this).
_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def _manifest():
    with open(os.path.join(_DATA_DIR, "manifest.json"), encoding="utf-8") as f:
        return json.load(f)


def selected_tier(tier=None):
    """The effective tier name: ``tier`` arg, then ``GLOSS_TIER``, then "full"."""
    name = tier if tier is not None else os.environ.get(ENV_TIER, DEFAULT_TIER)
    if name not in TIERS:
        raise ValueError(
            f"unknown gloss tier {name!r}: expected one of {', '.join(TIERS)}")
    return name


def cache_dir():
    """Platform cache dir for downloaded tiers (stdlib only)."""
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return os.path.join(base, "gloss", "Cache")
    if sys.platform == "darwin":
        return os.path.join(os.path.expanduser("~"), "Library", "Caches", "gloss")
    base = os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")
    return os.path.join(base, "gloss")


def bundled_path(tier):
    """Path to a tier DB shipped inside the package, or None.

    Only the ``tiny`` tier is bundled (it's 1.4 MB); the larger tiers
    download on first use.
    """
    if tier != "tiny":
        return None
    path = os.path.join(_DATA_DIR, "gloss-tiny.db")
    return path if os.path.exists(path) else None


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(tier=None):
    """Fetch a tier DB into the platform cache, verifying its SHA-256.

    Defaults to the currently selected tier. A cache hit (file already
    present) is returned without touching the network.
    """
    name = selected_tier(tier)
    dest = os.path.join(cache_dir(), f"gloss-{name}.db")
    if os.path.exists(dest):
        return dest
    manifest = _manifest()
    entry = manifest["tiers"][name]
    base_url = os.environ.get(ENV_MIRROR) or manifest["base_url"]
    url = f"{base_url}/{entry['file']}"
    os.makedirs(cache_dir(), exist_ok=True)
    tmp = dest + ".part"
    try:
        with urllib.request.urlopen(url) as resp, open(tmp, "wb") as f:
            while True:
                chunk = resp.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    if _sha256(tmp) != entry["sha256"]:
        os.remove(tmp)
        raise ValueError(
            f"checksum mismatch downloading gloss tier {name!r} from {url!r}; "
            f"try again, or set {ENV_MIRROR} to a mirror")
    os.replace(tmp, dest)
    return dest


def resolve(tier=None, db_path=None):
    """Return a usable gloss DB path, following the tier-selection order.

    Explicit ``db_path`` (or ``GLOSS_DB``) wins and is used exactly as
    given. Otherwise the tier is ``tier`` (or ``GLOSS_TIER``, default
    ``"full"``), found in the bundled data or the platform cache, and
    downloaded if missing — unless ``GLOSS_OFFLINE=1``, which raises a
    helpful error instead.
    """
    explicit = db_path if db_path is not None else os.environ.get(ENV_DB)
    if explicit:
        return explicit
    name = selected_tier(tier)
    bundled = bundled_path(name)
    if bundled:
        return bundled
    cached = os.path.join(cache_dir(), f"gloss-{name}.db")
    if os.path.exists(cached):
        return cached
    if os.environ.get(ENV_OFFLINE) == "1":
        raise FileNotFoundError(
            f"gloss tier {name!r} is not available locally and downloading is "
            f"disabled ({ENV_OFFLINE}=1). Pre-fetch it on a connected machine "
            f"with `gloss download --tier {name}`, or point {ENV_DB} at a "
            f"local database file.")
    return download(name)
