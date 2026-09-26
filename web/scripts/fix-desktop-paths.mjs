// Post-process the desktop static export (web/out) so it runs from
// Electron's file:// shell.
//
// Next.js emits absolute asset URLs (/_next/...). Under file:// those resolve
// to the filesystem root and 404, leaving the app unstyled with dead JS.
// Rewrite them to relative URLs (./_next/...):
//   - *.html: <script src>, <link href>, preloads, etc.
//   - webpack runtime chunk: the chunk publicPath (r.p="/_next/"), used by
//     dynamic import() for on-demand chunks (e.g. the sql.js bundle).
//   - main app chunk: the runtime publicPath setter call
//     self.__next_set_public_path__(""+assetPrefix+"/_next/"), which would
//     otherwise reset the publicPath to absolute at startup.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "out");

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

let htmlFixed = 0;
let webpackFixed = 0;
let setterFixed = 0;

for (const f of walk(out)) {
  if (f.endsWith(".html")) {
    const before = readFileSync(f, "utf8");
    const after = before.replaceAll('"/_next/', '"./_next/').replaceAll("'/_next/", "'./_next/");
    if (after !== before) {
      writeFileSync(f, after);
      htmlFixed++;
    }
  } else if (/[/\\]webpack-[^/\\]+\.js$/.test(f)) {
    const before = readFileSync(f, "utf8");
    const after = before.replaceAll('.p="/_next/"', '.p="./_next/"');
    if (after !== before) {
      writeFileSync(f, after);
      webpackFixed++;
    } else {
      console.warn(`fix-desktop-paths: WARNING: no publicPath pattern in ${f}`);
    }
  } else if (/[/\\]main-[^/\\]+\.js$/.test(f)) {
    const before = readFileSync(f, "utf8");
    // Minified: self.__next_set_public_path__(""+t+"/_next/") — the local
    // variable name varies, so match the shape, not the name.
    const re = /__next_set_public_path__\(\s*""\s*\+\s*[A-Za-z_$][\w$]*\s*\+\s*"\/_next\/"\s*\)/g;
    const after = before.replace(re, '__next_set_public_path__("./_next/")');
    if (after !== before) {
      writeFileSync(f, after);
      setterFixed++;
    } else {
      console.warn(`fix-desktop-paths: WARNING: no publicPath setter call in ${f}`);
    }
  }
}

console.log(
  `fix-desktop-paths: ${htmlFixed} HTML files, ${webpackFixed} webpack runtimes, ${setterFixed} publicPath setters rewritten (out=${out})`
);
if (htmlFixed === 0 || webpackFixed === 0 || setterFixed === 0) {
  throw new Error("fix-desktop-paths: expected rewrites did not all apply");
}
