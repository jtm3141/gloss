# Deploying gloss to Vercel (server flavor)

The public site runs the **server flavor**: thin `/api/*` routes query the
dictionary through libsql. No 30 MB download — each lookup is a few KB of JSON.
The desktop app keeps the **desktop flavor** (static export, database bundled,
fully offline); see "Desktop" below.

## 1. Turso — one time

Sign up at turso.com, then from PowerShell:

```powershell
# install the CLI (or: winget install Turso.turso)
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login          # opens a browser

# create the database straight from the filtered SQLite file (~74 MB upload)
turso db create gloss --from-file data/gloss-filtered.db --wait

# connection details for Vercel
turso db show gloss --url            # -> TURSO_DATABASE_URL
turso db tokens create gloss        # -> TURSO_AUTH_TOKEN
```

When the dictionary is rebuilt from a newer OEWN edition, repeat the
`db create` (destroy the old one first: `turso db destroy gloss`) and the
site picks it up with no code changes — API responses are edge-cached, so
allow up to a day for the CDN to roll over, or purge from the Vercel dashboard.

### Surgical update: importing one table

For a small addition (e.g. the `pronunciation` table, 2026-09-26), a full
re-upload is wasteful — import just the table instead. Generate the dump
from the new filtered build and load it through the Turso shell:

```powershell
cd data
python makedump.py        # writes pronunciation-update.sql

# back up the live database first
turso db shell gloss .dump > turso-backup-YYYY-MM-DD.sql

# load the new table (drops and recreates `pronunciation`, stamps meta)
turso db shell gloss < pronunciation-update.sql
```

Verify on the live database before touching the site:

```powershell
turso db shell gloss "SELECT COUNT(*) FROM pronunciation;"
turso db shell gloss "SELECT value FROM meta WHERE key='pronunciation_counts';"
turso db shell gloss "SELECT ipa, respelling, source FROM pronunciation p JOIN lemma l ON l.id=p.lemma_id WHERE l.lemma='water' LIMIT 3;"
```

Rollback is `DROP TABLE pronunciation;` on the live DB (or restore the
backup dump). No token or URL changes: the database name stays `gloss`.

## 2. Vercel — one time

```powershell
npm i -g vercel
vercel login
```

Then either:

- **Dashboard (simplest):** vercel.com → Add New → Project → Import
  `jtm3141/gloss` → set **Root Directory** to `web` → add env vars below →
  Deploy. Vercel auto-detects Next.js; `npm run build` just works.
- **CLI:** from the repo root, `vercel` (link the project, set root
  directory to `web` when asked), then `vercel --prod`.

Environment variables (Production **and** Preview):

| Name                | Value                                    |
| ------------------- | ---------------------------------------- |
| `TURSO_DATABASE_URL`| `libsql://gloss-<your-org>.turso.io`     |
| `TURSO_AUTH_TOKEN`  | output of `turso db tokens create gloss` |

Do **not** set `NEXT_PUBLIC_GLOSS_TARGET` on Vercel — its absence selects the
server flavor. The token stays server-side; it is never exposed to the browser.

## 3. Local dev

```powershell
cd web
copy .env.example .env.local   # file: URL at the real database — no account needed
npm run dev
```

`http://localhost:3000/api/define?word=dog` should return JSON.

## Desktop (unchanged behavior)

```powershell
cd web
npm run build:desktop   # static export + bundled DB, for the Electron shell
```

`npm run dev:desktop` runs the dev server in the desktop (bundled-DB) flavor.

## What's free

- Turso free tier: 500 databases, 9 GB storage — the 74 MB dictionary fits
  many times over.
- Vercel hobby: the API routes are tiny proxies; usage is negligible for a
  side project.
