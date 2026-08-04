/**
 * Package name / version / upgrade one-liner.
 * Reads package.json next to the installed package root (works from src/ and dist/).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PKG_NAME = "oh-my-session";
/** Primary CLI first. */
export const CLI_PRIMARY = "oms";
export const CLI_NAMES = ["oms", "oh-my-session"] as const;

let cached: { name: string; version: string } | null = null;

function readPackageJson(): { name: string; version: string } {
  if (cached) return cached;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/lib or dist/lib → package root
  const pkgPath = path.resolve(here, "../../package.json");
  try {
    const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      name?: string;
      version?: string;
    };
    cached = {
      name: raw.name?.trim() || PKG_NAME,
      version: raw.version?.trim() || "0.0.0",
    };
  } catch {
    cached = { name: PKG_NAME, version: "0.0.0" };
  }
  return cached;
}

export function packageName(): string {
  return readPackageJson().name;
}

export function packageVersion(): string {
  return readPackageJson().version;
}

/** One-liner users can copy to upgrade. */
export function upgradeCommand(): string {
  return `npm install -g ${packageName()}@latest`;
}
