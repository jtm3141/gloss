// Desktop-flavored dev server: bundled-database (sql.js) transport instead of
// the /api/* routes. Cross-platform equivalent of
// `NEXT_PUBLIC_GLOSS_TARGET=desktop npm run prepare-data && next dev`.
import { execSync } from "node:child_process";

process.env.NEXT_PUBLIC_GLOSS_TARGET = "desktop";
execSync("npm run prepare-data", { stdio: "inherit", env: process.env });
execSync("npx next dev", { stdio: "inherit", env: process.env });
