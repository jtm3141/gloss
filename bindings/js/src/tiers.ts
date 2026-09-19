// Tier selection for gloss-dict — implements data/tiers/TIERS.md.
//
// Resolution order:
//   1. Explicit path: GLOSS_DB, or configure(path) / --db. Used exactly as
//      given; no tier logic applies.
//   2. Tier name: GLOSS_TIER, --tier, or the tier= API parameter.
//      Default: "full". Unknown names are an error, not a guess.
//   3. The package's bundled data (only the tiny tier ships bundled),
//      then the platform cache dir
//      (~/.cache/gloss, ~/Library/Caches/gloss, %LOCALAPPDATA%\gloss\Cache).
//   4. Download <base_url>/gloss-<tier>.db (SHA-256 verified) into the cache.
//      GLOSS_MIRROR overrides base_url; GLOSS_OFFLINE=1 disables downloading.
//
// NOTE: data/gloss-tiny.db and data/manifest.json are copies of
// data/tiers/gloss-tiny.db and data/tiers/manifest.json — re-sync them
// whenever the tiers are rebuilt (see data/tiers/TIERS.md release checklist).

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type TierName = "tiny" | "small" | "medium" | "full";
export const TIERS: readonly TierName[] = ["tiny", "small", "medium", "full"];
export const DEFAULT_TIER: TierName = "full";

interface ManifestTier {
  file: string;
  sha256: string;
  bytes: number;
  blurb: string;
  bundled?: boolean;
}

interface Manifest {
  base_url: string;
  version: number;
  tiers: Record<TierName, ManifestTier>;
}

export interface ResolveOptions {
  tier?: string;
  dbPath?: string;
}

/** Directory holding the package's bundled data (dist/../data or src/../data). */
export function dataDir(): string {
  return path.join(__dirname, "..", "data");
}

/** Platform cache directory for downloaded tiers. */
export function cacheDir(): string {
  const home = os.homedir();
  if (process.platform === "darwin")
    return path.join(home, "Library", "Caches", "gloss");
  if (process.platform === "win32")
    return path.join(
      process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"),
      "gloss",
      "Cache"
    );
  return path.join(
    process.env.XDG_CACHE_HOME || path.join(home, ".cache"),
    "gloss"
  );
}

/** The selected tier: explicit argument > GLOSS_TIER > "full". */
export function selectedTier(explicit?: string): TierName {
  const name = explicit ?? process.env.GLOSS_TIER ?? DEFAULT_TIER;
  if (!(TIERS as readonly string[]).includes(name))
    throw new Error(
      `unknown gloss tier "${name}" (expected one of: ${TIERS.join(", ")})`
    );
  return name as TierName;
}

function missingHelp(tier: TierName, offline: boolean): string {
  const where = [
    path.join(dataDir(), `gloss-${tier}.db`),
    path.join(cacheDir(), `gloss-${tier}.db`),
  ];
  return (
    `gloss database not found for tier "${tier}" (looked in:\n` +
    `  ${where.join("\n  ")})\n` +
    (offline
      ? "downloads are disabled (GLOSS_OFFLINE=1)."
      : "it is not cached yet, and this call cannot download it.") +
    `\nFetch it with: gloss download --tier ${tier}\n` +
    "or point GLOSS_DB at a gloss database file."
  );
}

/**
 * Resolve a database path synchronously: an explicit dbPath (or GLOSS_DB)
 * wins and is used as given; otherwise the tier's file from the bundled
 * data or the platform cache. Throws a helpful error — never downloads —
 * when the file is missing.
 */
export function resolveDbPath(opts: ResolveOptions = {}): string {
  const explicit = opts.dbPath ?? process.env.GLOSS_DB;
  if (explicit) return explicit;
  const tier = selectedTier(opts.tier);
  const file = `gloss-${tier}.db`;
  for (const dir of [dataDir(), cacheDir()]) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(missingHelp(tier, process.env.GLOSS_OFFLINE === "1"));
}

let manifestCache: Manifest | null = null;

function readManifest(): Manifest {
  if (!manifestCache) {
    const raw = fs.readFileSync(path.join(dataDir(), "manifest.json"), "utf8");
    manifestCache = JSON.parse(raw) as Manifest;
  }
  return manifestCache;
}

async function sha256File(p: string): Promise<string> {
  const h = crypto.createHash("sha256");
  const s = fs.createReadStream(p);
  for await (const chunk of s) h.update(chunk as Buffer);
  return h.digest("hex");
}

/**
 * Ensure `tier`'s database is available locally: returns the bundled or
 * cached file when present, otherwise downloads <base_url>/gloss-<tier>.db
 * into the platform cache with SHA-256 verification. Honors GLOSS_MIRROR
 * and GLOSS_OFFLINE=1.
 */
export async function downloadTier(tierName?: string): Promise<string> {
  const tier = selectedTier(tierName);
  const file = `gloss-${tier}.db`;
  for (const dir of [dataDir(), cacheDir()]) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) return p;
  }
  if (process.env.GLOSS_OFFLINE === "1")
    throw new Error(missingHelp(tier, true));
  const manifest = readManifest();
  const entry = manifest.tiers[tier];
  if (!entry)
    throw new Error(`tier "${tier}" is missing from the bundled manifest.json`);
  const base = (process.env.GLOSS_MIRROR || manifest.base_url).replace(/\/+$/, "");
  const url = `${base}/${entry.file}`;
  const dir = cacheDir();
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, file);
  const tmp = dest + ".part";
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`download failed: ${url}: ${(e as Error).message}`);
  }
  if (!res.ok || !res.body)
    throw new Error(`download failed: ${url} (HTTP ${res.status})`);
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(tmp));
  const digest = await sha256File(tmp);
  if (digest !== entry.sha256) {
    fs.rmSync(tmp, { force: true });
    throw new Error(
      `SHA-256 mismatch downloading ${entry.file}: ` +
        `expected ${entry.sha256}, got ${digest}`
    );
  }
  fs.renameSync(tmp, dest);
  return dest;
}
