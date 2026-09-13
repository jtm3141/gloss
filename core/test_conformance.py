#!/usr/bin/env python3
"""Conformance test for the gloss C core.

Builds gloss.dll from gloss.c + sqlite3.c with gcc, loads it via ctypes,
and checks every case in data/conformance.json: define(), lookup() senses,
examples, synonyms, and antonym/hypernym/hyponym relations.

Usage: python test_conformance.py [path/to/gloss.db]
(the conformance.json sits next to this script's ../data/)
"""

import ctypes
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")


class GlossSense(ctypes.Structure):
    _fields_ = [("pos", ctypes.c_char_p),
                ("sense_no", ctypes.c_int),
                ("synset_offset", ctypes.c_long),
                ("synset_pos", ctypes.c_char_p),
                ("definition", ctypes.c_char_p),
                ("examples", ctypes.POINTER(ctypes.c_char_p)),
                ("synonyms", ctypes.POINTER(ctypes.c_char_p))]


class GlossEntry(ctypes.Structure):
    _fields_ = [("word", ctypes.c_char_p),
                ("nsenses", ctypes.c_int),
                ("senses", ctypes.POINTER(GlossSense))]


class GlossRelated(ctypes.Structure):
    _fields_ = [("words", ctypes.POINTER(ctypes.c_char_p)),
                ("definition", ctypes.c_char_p)]


def strarr(ptr):
    out, i = [], 0
    while ptr[i]:
        out.append(ptr[i].decode("utf-8"))
        i += 1
    return out


def build_lib():
    dll = os.path.join(HERE, "gloss.dll" if os.name == "nt" else "libgloss.so")
    if not os.path.exists(dll):
        print("compiling C core ...")
        cmd = ["gcc", "-O2", "-shared"]
        if os.name != "nt":
            cmd.append("-fPIC")
        cmd += ["-o", dll, "gloss.c", "sqlite3.c", "-I."]
        subprocess.run(cmd, cwd=HERE, check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return dll


def load_lib(dll):
    lib = ctypes.CDLL(dll)
    lib.gloss_open.argtypes = [ctypes.c_char_p]
    lib.gloss_open.restype = ctypes.c_void_p
    lib.gloss_close.argtypes = [ctypes.c_void_p]
    lib.gloss_define.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    lib.gloss_define.restype = ctypes.c_char_p
    lib.gloss_free_str.argtypes = [ctypes.c_char_p]
    lib.gloss_lookup.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    lib.gloss_lookup.restype = ctypes.POINTER(GlossEntry)
    lib.gloss_free_entry.argtypes = [ctypes.POINTER(GlossEntry)]
    lib.gloss_related.argtypes = [ctypes.c_void_p,
                                  ctypes.POINTER(GlossSense),
                                  ctypes.c_char_p,
                                  ctypes.POINTER(ctypes.POINTER(GlossRelated))]
    lib.gloss_related.restype = ctypes.c_int
    lib.gloss_free_related.argtypes = [ctypes.POINTER(GlossRelated), ctypes.c_int]
    lib.gloss_search.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
    lib.gloss_search.restype = ctypes.POINTER(ctypes.c_char_p)
    lib.gloss_free_strarr.argtypes = [ctypes.POINTER(ctypes.c_char_p)]
    return lib


REL_PTR = {"antonyms": b"!", "hypernyms": b"@", "hyponyms": b"~"}
failures = []


def check(cond, msg):
    if not cond:
        failures.append(msg)
        print("  FAIL:", msg)


def main():
    db_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(DATA, "gloss.db")
    with open(os.path.join(DATA, "conformance.json"), encoding="utf-8") as f:
        fixture = json.load(f)["cases"]
    lib = load_lib(build_lib())
    db = lib.gloss_open(db_path.encode())
    assert db, "gloss_open failed"

    for case in fixture:
        word = case["word"].encode()
        # define()
        got = lib.gloss_define(db, word)
        got = got.decode("utf-8") if got else None
        check(got == case["define"], f"{case['word']}: define() mismatch")
        # lookup()
        e = lib.gloss_lookup(db, word)
        if not case["senses"]:
            check(not e, f"{case['word']}: lookup() should be NULL")
            continue
        check(bool(e), f"{case['word']}: lookup() returned NULL")
        if not e:
            continue
        check(e.contents.nsenses == len(case["senses"]),
              f"{case['word']}: nsenses {e.contents.nsenses} != {len(case['senses'])}")
        for i, fs in enumerate(case["senses"]):
            if i >= e.contents.nsenses:
                break
            s = e.contents.senses[i]
            tag = f"{case['word']} sense {i + 1}"
            check(s.pos.decode() == fs["pos"], f"{tag}: pos")
            check(s.sense_no == fs["sense_no"], f"{tag}: sense_no")
            check(s.definition.decode("utf-8") == fs["definition"], f"{tag}: definition")
            check(strarr(s.examples) == fs["examples"], f"{tag}: examples")
            check(strarr(s.synonyms) == fs["synonyms"], f"{tag}: synonyms")
            for rel_name, ptr in REL_PTR.items():
                out = ctypes.POINTER(GlossRelated)()
                n = lib.gloss_related(db, ctypes.byref(s), ptr, ctypes.byref(out))
                got_rels = [{"words": strarr(out[j].words),
                             "definition": out[j].definition.decode("utf-8")}
                            for j in range(n)]
                check(got_rels == fs[rel_name], f"{tag}: {rel_name}")
                lib.gloss_free_related(out, n)
        lib.gloss_free_entry(e)

    # search() sanity (not in fixtures: just structural)
    res = lib.gloss_search(db, b"dog", 5)
    got = strarr(res)
    lib.gloss_free_strarr(res)
    check("dog" in got, "search('dog') should contain 'dog'")

    lib.gloss_close(db)
    print(f"\n{len(fixture)} words checked, {len(failures)} failures")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
