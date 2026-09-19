# gloss C++ example

A tiny program exercising the C++ binding the way a consumer would:
`define`, `lookup`, `search`, and `related` over the RAII `gloss::Database`
wrapper. No tier logic here — the wrapper takes an explicit database path
(tier resolution lives in the CLI/Python/JS layers; see
`data/tiers/TIERS.md`).

## Build

First install the C++ binding to a prefix (from the repo root):

```bash
cmake -S bindings/cpp -B /tmp/gloss-cpp-build -DCMAKE_INSTALL_PREFIX=/tmp/gloss-cpp
cmake --build /tmp/gloss-cpp-build
cmake --install /tmp/gloss-cpp-build
```

Then build this example against that installed package:

```bash
cmake -S examples/cpp -B /tmp/gloss-cpp-example-build -DCMAKE_PREFIX_PATH=/tmp/gloss-cpp
cmake --build /tmp/gloss-cpp-example-build
```

## Run

```bash
# explicit path (wins over everything)
/tmp/gloss-cpp-example-build/gloss-define data/gloss.db

# ...or via the environment
GLOSS_DB=data/gloss.db /tmp/gloss-cpp-example-build/gloss-define
```

With no arguments and no `GLOSS_DB`, it falls back to
`data/tiers/gloss-tiny.db` in the repo checkout, so a fresh clone works
offline for a quick smoke test.

Unknown words print `<unknown word>` — `define()`/`lookup()` return
`std::nullopt` rather than throwing (see the exception contract at the top
of `bindings/cpp/gloss.hpp`).

Definitions come from [Open English WordNet](https://github.com/globalwordnet/english-wordnet)
(CC-BY 4.0). Full attribution: `ATTRIBUTION.md` (repo root).
