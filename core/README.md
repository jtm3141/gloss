# core/

The gloss C99 reference engine. One implementation of all query logic;
every binding and app is a thin layer over `gloss.h`.

## Files

- `gloss.h` / `gloss.c` — the engine (only dependency: the SQLite
  amalgamation, `sqlite3.c`/`sqlite3.h`, committed here for reproducible
  builds).
- `test_conformance.py` — builds `gloss.dll`/`libgloss.so` with gcc, loads
  it via ctypes, and checks every case in `../data/conformance.json`.

## Build

Windows (MinGW):

```powershell
gcc -O2 -shared -o gloss.dll gloss.c sqlite3.c -I.
```

Linux / macOS:

```bash
gcc -O2 -shared -fPIC -o libgloss.so gloss.c sqlite3.c -I.   # Linux
gcc -O2 -dynamiclib -o libgloss.dylib gloss.c sqlite3.c -I.  # macOS
```

## Test

```powershell
C:\Users\<user>\miniconda3\python.exe test_conformance.py ..\data\gloss.db
```

## API notes

- `gloss_open()` opens the database read-only; one handle per thread.
- `gloss_define()` tries the word as given, then lowercased; POS in order
  n, v, a, r, sense #1 wins — the single most common definition.
- `gloss_lookup()` returns every sense (n, then v, a, r; sense_no ascending)
  with examples and synonyms (data-file surface forms in synset word order,
  query word excluded case-insensitively).
- `gloss_related()` resolves pointer relations (`!` antonym, `@` hypernym,
  `~` hyponym, `#p` part meronym, …) to target synsets, capped at 40,
  ordered by offset. These exact semantics are pinned by
  `../data/conformance.json`.
