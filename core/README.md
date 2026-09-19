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

Two flavors — the drop-in source build (no install, no CMake), and an
installed static library with pkg-config metadata.

### Drop-in sources

Just compile the two C files and `#include "gloss.h"`:

```bash
cc -c core/gloss.c core/sqlite3.c -Icore    # or: core/gloss.c core/sqlite3.c
```

Link your program with the resulting objects (on Linux add
`-lm -lpthread -ldl`).

### Installed library (CMake)

```bash
cmake -S core -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
cmake --install build --prefix /usr/local   # installs libgloss.a, gloss.h, gloss.pc
```

Also works as `add_subdirectory(core)` from a parent project, which
exposes the `gloss::gloss` target. Library version is 0.2.0
(`GLOSS_VERSION_STRING` in `gloss.h`); `sqlite3.c` is compiled in
privately — only `gloss.h` is installed.

Using the installed library:

```bash
cc -O2 -o myapp myapp.c $(pkg-config --cflags --libs gloss)
```

### Shared-library variant (for the conformance test)

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
