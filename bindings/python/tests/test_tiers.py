#!/usr/bin/env python3
"""Unit tests for gloss tier selection (src/gloss/tiers.py).

Stdlib only — no pytest needed:

    cd bindings/python && python3 tests/test_tiers.py

Every test runs in an isolated HOME/XDG_CACHE_HOME so the real platform
cache is never touched.
"""

import contextlib
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))

import gloss  # noqa: E402
from gloss import tiers  # noqa: E402

ENV_KEYS = (tiers.ENV_DB, tiers.ENV_TIER, tiers.ENV_OFFLINE,
            tiers.ENV_MIRROR, "XDG_CACHE_HOME", "LOCALAPPDATA")


@contextlib.contextmanager
def isolated_env(**overrides):
    """os.environ with the tier/cache keys cleared, plus `overrides`."""
    saved = {k: os.environ.get(k) for k in ENV_KEYS}
    saved_home = os.environ.get("HOME")
    for k in ENV_KEYS:
        os.environ.pop(k, None)
    os.environ.update({k: v for k, v in overrides.items() if v is not None})
    try:
        yield
    finally:
        for k in ENV_KEYS:
            os.environ.pop(k, None)
            if saved[k] is not None:
                os.environ[k] = saved[k]
        if saved_home is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = saved_home


class TierTests(unittest.TestCase):
    def test_gloss_db_precedence(self):
        """GLOSS_DB is used exactly as given, no tier logic involved."""
        with tempfile.TemporaryDirectory() as home, isolated_env(
                HOME=home, GLOSS_DB="/tmp/does-not-exist.db",
                GLOSS_TIER="tiny"):
            self.assertEqual(tiers.resolve(), "/tmp/does-not-exist.db")

    def test_explicit_db_path_beats_gloss_db(self):
        with tempfile.TemporaryDirectory() as home, isolated_env(
                HOME=home, GLOSS_DB="/tmp/from-env.db"):
            self.assertEqual(tiers.resolve(db_path="/tmp/from-arg.db"),
                             "/tmp/from-arg.db")

    def test_gloss_tier_selection(self):
        """GLOSS_TIER=tiny resolves to the bundled package data."""
        with tempfile.TemporaryDirectory() as home, isolated_env(
                HOME=home, GLOSS_TIER="tiny"):
            path = tiers.resolve()
            self.assertTrue(path.endswith("gloss-tiny.db"), path)
            self.assertTrue(os.path.exists(path), path)

    def test_default_tier_is_full(self):
        self.assertEqual(tiers.selected_tier(), "full")
        with isolated_env(GLOSS_TIER="small"):
            self.assertEqual(tiers.selected_tier(), "small")

    def test_unknown_tier_is_value_error(self):
        with isolated_env(GLOSS_TIER="gigantic"):
            with self.assertRaises(ValueError):
                tiers.selected_tier()
        with isolated_env():
            with self.assertRaises(ValueError):
                tiers.resolve(tier="gigantic")

    def test_offline_error_names_download_and_gloss_db(self):
        """GLOSS_OFFLINE=1: resolution fails with a helpful error."""
        with tempfile.TemporaryDirectory() as home, isolated_env(
                HOME=home, GLOSS_TIER="small", GLOSS_OFFLINE="1"):
            with self.assertRaises(FileNotFoundError) as ctx:
                tiers.resolve()
            msg = str(ctx.exception)
            self.assertIn("gloss download --tier small", msg)
            self.assertIn("GLOSS_DB", msg)

    def test_cache_hit_no_download(self):
        """A tier already in the cache resolves even when offline."""
        with tempfile.TemporaryDirectory() as home:
            cache = os.path.join(home, ".cache", "gloss")
            os.makedirs(cache)
            # Any file will do: cache hits are returned without checksum
            # verification (verification happens at download time).
            with open(os.path.join(cache, "gloss-small.db"), "w") as f:
                f.write("placeholder")
            with isolated_env(HOME=home, GLOSS_TIER="small",
                              GLOSS_OFFLINE="1"):
                path = tiers.resolve()
            self.assertEqual(path, os.path.join(cache, "gloss-small.db"))

    def test_download_verifies_checksum(self):
        """download() refuses a file whose SHA-256 doesn't match."""
        import urllib.request

        class FakeResponse:
            def __init__(self, data):
                self._data = data

            def read(self, n=-1):
                chunk, self._data = self._data[:n], self._data[n:]
                return chunk

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        with tempfile.TemporaryDirectory() as home, isolated_env(HOME=home):
            real_urlopen = urllib.request.urlopen
            urllib.request.urlopen = lambda url: FakeResponse(b"corrupt")
            try:
                with self.assertRaises(ValueError) as ctx:
                    tiers.download("tiny")
            finally:
                urllib.request.urlopen = real_urlopen
            self.assertIn("checksum mismatch", str(ctx.exception))

    def test_database_accepts_tier(self):
        with tempfile.TemporaryDirectory() as home, isolated_env(
                HOME=home, GLOSS_TIER="tiny"):
            db = gloss.Database(tier="tiny")
            try:
                self.assertIsNotNone(db.define("dog"))
            finally:
                db.close()

    def test_cache_dir_platforms(self):
        orig_platform = sys.platform
        try:
            sys.platform = "win32"
            with isolated_env(LOCALAPPDATA="C:\\Users\\t\\AppData\\Local"):
                self.assertEqual(
                    tiers.cache_dir().replace("\\", "/"),
                    "C:/Users/t/AppData/Local/gloss/Cache")
            sys.platform = "darwin"
            with isolated_env(HOME="/Users/t"):
                self.assertEqual(tiers.cache_dir(),
                                 "/Users/t/Library/Caches/gloss")
            sys.platform = "linux"
            with isolated_env(HOME="/home/t"):
                self.assertEqual(tiers.cache_dir(), "/home/t/.cache/gloss")
        finally:
            sys.platform = orig_platform


if __name__ == "__main__":
    unittest.main(verbosity=2)
