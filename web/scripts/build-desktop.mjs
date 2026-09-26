// Desktop build: static export with the dictionary bundled (sql.js + WASM),
// for the Electron file:// shell. Cross-platform equivalent of
// `NEXT_PUBLIC_GLOSS_TARGET=desktop npm run prepare-data && next build`.
//
// API routes can't be statically exported, so app/api is stashed aside for
// the duration of the build and restored afterwards (in a finally, so an
// interrupted build never loses it).
import { execSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(root, "app", "api");
const stashDir = join(root, ".api.stash");

// Recover from a previously interrupted build.
if (existsSync(stashDir) && !existsSync(apiDir)) renameSync(stashDir, apiDir);

process.env.NEXT_PUBLIC_GLOSS_TARGET = "desktop";
try {
  execSync("npm run prepare-data", { stdio: "inherit", env: process.env });
  if (existsSync(apiDir)) renameSync(apiDir, stashDir);
  execSync("npx next build", { stdio: "inherit", env: process.env });
  execSync("node scripts/fix-desktop-paths.mjs", { stdio: "inherit", env: process.env });
} finally {
  if (existsSync(stashDir)) renameSync(stashDir, apiDir);
}
