// Copies the built static website (web/out) into desktop/web so the
// Electron shell packages the exact same files the website serves.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "web", "out");
const dst = join(here, "..", "web");

if (!existsSync(join(src, "index.html"))) {
  console.error("web/out/index.html not found — run `npm run build` in web/ first.");
  process.exit(1);
}
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log(`Copied static site: ${src} -> ${dst}`);
