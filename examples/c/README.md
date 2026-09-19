# examples/c/

A tiny example CLI over the C99 core (`../core/`), implementing the
tier-aware command line from `../data/tiers/TIERS.md`:

```text
gloss-cli define serendipity     # most common definition
gloss-cli suggest ser            # completions for a prefix
gloss-cli related dog @          # hypernyms of the most common sense
                                 # (@ hypernym, ~ hyponym, ! antonym, …)
```

## Build (drop-in sources)

From the repo root:

```bash
cc -O2 -Icore -o gloss-cli examples/c/gloss-cli.c core/gloss.c core/sqlite3.c -lm -lpthread -ldl
```

From inside `examples/c/`:

```bash
cc -O2 -I../../core -o gloss-cli gloss-cli.c ../../core/gloss.c ../../core/sqlite3.c -lm -lpthread -ldl
```

Flags per platform:

- **Linux** (shown above): needs `-lm -lpthread -ldl` for SQLite.
- **macOS**: same command; `-lpthread -ldl` are accepted (or can be
  dropped, pthreads and dl are in the system libraries).
- **Windows (MinGW)**: drop the link flags —
  `gcc -O2 -I..\..\core -o gloss-cli.exe gloss-cli.c ..\..\core\gloss.c ..\..\core\sqlite3.c`.

Or link against the installed library instead of the sources (see
`core/README.md` for the CMake install + pkg-config route):

```bash
cc -O2 -o gloss-cli gloss-cli.c $(pkg-config --cflags --libs gloss)
```

## Data

The CLI picks a database exactly like the other bindings
(`TIERS.md`, "Tier selection"):

1. `GLOSS_DB=/path/to/db` — explicit path, used as given (wins over
   everything, including `--db`);
2. `--db PATH` flag;
3. `--tier NAME` flag, else `GLOSS_TIER` env var, else the default
   `full` — looks for `gloss-<tier>.db` in `./data/tiers/` then in the
   platform cache dir (`~/.cache/gloss`, `~/Library/Caches/gloss`, or
   `%LOCALAPPDATA%\gloss\Cache`).

It never downloads: if the tier file is missing it prints a helpful
error pointing at `gloss download` in the Python/JS packages, or at
`GLOSS_DB`. Embedded targets bundle whichever tier fits and pass its
path directly.

```bash
# full DB explicitly (default tier is full anyway):
GLOSS_DB=data/gloss.db ./gloss-cli define serendipity

# tiny tier via env, resolved from ./data/tiers/:
GLOSS_TIER=tiny ./gloss-cli suggest ser

# explicit tier flag + verb flag order:
./gloss-cli --tier tiny related dog @
```
