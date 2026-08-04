/**
 * Optional npm version check with local cache.
 *
 * Cache: $OMS_DATA_DIR/update-check.json
 * Disable: OMS_NO_UPDATE=1 or NO_UPDATE_NOTIFIER=1
 * Interval: 24h between network checks (cache still serves last result).
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.js";
import { packageName, packageVersion, upgradeCommand } from "./pkg-meta.js";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2500;
const REGISTRY_LATEST = (name: string) =>
  `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`;

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
  upgradeCmd: string;
  /** true when we hit the network this call */
  fetched: boolean;
}

interface CacheFile {
  checkedAt: number;
  latest: string;
  name?: string;
}

export function updateCheckDisabled(): boolean {
  const a = process.env.OMS_NO_UPDATE?.trim();
  const b = process.env.NO_UPDATE_NOTIFIER?.trim();
  if (a === "1" || a?.toLowerCase() === "true") return true;
  if (b === "1" || b?.toLowerCase() === "true") return true;
  return false;
}

export function updateCachePath(): string {
  return path.join(dataDir(), "update-check.json");
}

/** Compare core semver (major.minor.patch); ignores pre-release suffix. */
export function cmpSemver(a: string, b: string): number {
  const norm = (s: string) =>
    s
      .replace(/^v/i, "")
      .split("-")[0]!
      .split(".")
      .map((p) => {
        const n = parseInt(p.replace(/[^\d].*$/, ""), 10);
        return Number.isFinite(n) ? n : 0;
      });
  const pa = norm(a);
  const pb = norm(b);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

function loadCache(): CacheFile | null {
  try {
    const p = updateCachePath();
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as CacheFile;
    if (
      typeof raw.checkedAt !== "number" ||
      typeof raw.latest !== "string" ||
      !raw.latest.trim()
    ) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

function saveCache(latest: string): void {
  try {
    const p = updateCachePath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const body: CacheFile = {
      checkedAt: Date.now(),
      latest,
      name: packageName(),
    };
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(body)}\n`, "utf8");
    fs.renameSync(tmp, p);
  } catch {
    // best-effort; never throw from update check
  }
}

async function fetchLatestFromNpm(): Promise<string | null> {
  const name = packageName();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(REGISTRY_LATEST(name), {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": `${name}/${packageVersion()}`,
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    const v = data.version?.trim();
    return v || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function toInfo(current: string, latest: string, fetched: boolean): UpdateInfo {
  return {
    current,
    latest,
    updateAvailable: cmpSemver(latest, current) > 0,
    upgradeCmd: upgradeCommand(),
    fetched,
  };
}

/**
 * Sync: use cache only (no network). Good for instant CLI stderr hints.
 */
export function readCachedUpdate(): UpdateInfo | null {
  if (updateCheckDisabled()) return null;
  const current = packageVersion();
  const cache = loadCache();
  if (!cache) return null;
  return toInfo(current, cache.latest, false);
}

/**
 * Async check. Uses cache if fresh (&lt; 24h); otherwise fetches npm.
 * Never throws. Returns null when disabled or no version known.
 */
export async function checkForUpdate(opts?: {
  /** Force network even if cache is fresh */
  force?: boolean;
}): Promise<UpdateInfo | null> {
  if (updateCheckDisabled()) return null;
  const current = packageVersion();
  const cache = loadCache();
  const force = opts?.force === true;
  const fresh =
    cache != null && Date.now() - cache.checkedAt < CHECK_INTERVAL_MS;

  if (cache && fresh && !force) {
    return toInfo(current, cache.latest, false);
  }

  const latest = await fetchLatestFromNpm();
  if (latest) {
    saveCache(latest);
    return toInfo(current, latest, true);
  }
  // Network failed — fall back to stale cache if any
  if (cache) return toInfo(current, cache.latest, false);
  return null;
}

/** Fire-and-forget: refresh cache for next launch / TUI callback. */
export function scheduleUpdateCheck(
  onResult?: (info: UpdateInfo) => void,
): void {
  if (updateCheckDisabled()) return;
  void checkForUpdate()
    .then((info) => {
      if (info && onResult) onResult(info);
    })
    .catch(() => {
      /* ignore */
    });
}

/** Human-readable one/two-line notice (English; caller may translate). */
export function formatUpdateNotice(info: UpdateInfo): string {
  if (!info.updateAvailable) return "";
  return `Update available: ${info.current} → ${info.latest}  ·  ${info.upgradeCmd}`;
}
