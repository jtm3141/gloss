# gloss JavaScript examples

These use the built `gloss-dict` package (`bindings/js/dist`). Build it first:

```bash
cd bindings/js
npm install
npm run build
cd ../..
```

The examples resolve their database through the tier system
(`GLOSS_DB`, then `GLOSS_TIER`, then the bundled tiny database, then the
platform cache). `GLOSS_TIER=tiny` works offline out of the box; larger
tiers download on first use (or pre-fetch with `gloss download`).

```bash
GLOSS_TIER=tiny node examples/js/define.mjs time
GLOSS_TIER=tiny node examples/js/define.mjs serendipity  # needs a bigger tier
GLOSS_TIER=tiny node examples/js/suggest.mjs ser
GLOSS_TIER=tiny node examples/js/related.mjs dog
GLOSS_TIER=tiny node examples/js/related.mjs dog "~"   # hyponyms
GLOSS_TIER=tiny node examples/js/related.mjs good "!"  # antonyms

# Use the full database from the repo instead:
GLOSS_DB=data/gloss.db node examples/js/define.mjs dog
```

## The `gloss` command line

The package also ships a `gloss` CLI (same verbs in every language):

```bash
cd bindings/js
npx gloss --tier tiny define time
npx gloss --tier tiny suggest ser
npx gloss --tier tiny related dog @
npx gloss --tier tiny related dog "~"
npx gloss download --tier small   # pre-fetch into the platform cache
npx gloss --help
```

`--db PATH` beats everything; `--tier NAME` defaults to `full`
(or `GLOSS_TIER`); `GLOSS_OFFLINE=1` disables downloading.
