// Copies the built artifacts the web app needs into public/.
//   - data/gloss-filtered.db.gz  -> public/gloss.db.gz  (the dictionary)
//   - node_modules/sql.js/dist/sql-wasm.wasm -> public/sql-wasm.wasm
// Idempotent: skips copies whose destination is already newer than the source.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(webDir, "..");
const publicDir = join(webDir, "public");
mkdirSync(publicDir, { recursive: true });

const jobs = [
  {
    src: join(repoRoot, "data", "gloss-filtered.db.gz"),
    dest: join(publicDir, "gloss.db.gz"),
    hint: "build it with: python data/make_filtered.py --db data/gloss.db --out data/gloss-filtered.db, then gzip it",
  },
  {
    src: join(webDir, "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    dest: join(publicDir, "sql-wasm.wasm"),
    hint: "run: npm install",
  },
];

let failed = false;
for (const { src, dest, hint } of jobs) {
  if (!existsSync(src)) {
    console.error(`missing ${src}\n  -> ${hint}`);
    failed = true;
    continue;
  }
  const stale = !existsSync(dest) || statSync(src).mtimeMs > statSync(dest).mtimeMs;
  if (stale) {
    copyFileSync(src, dest);
    const mb = (statSync(dest).size / 1e6).toFixed(1);
    console.log(`copied ${src} -> ${dest} (${mb} MB)`);
  } else {
    console.log(`up to date: ${dest}`);
  }
}
if (failed) process.exit(1);
