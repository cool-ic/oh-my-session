import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function expandHome(p: string, home = os.homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

/**
 * Where the local CSV stores (titles / stars / tags) live.
 * Defaults to `<repo>/data`; `OMS_DATA_DIR` redirects it so demo fixtures and
 * tests cannot clobber the user's own overrides.
 */
export function dataDir(): string {
  const override = process.env.OMS_DATA_DIR;
  if (override && override.trim()) return expandHome(override.trim());
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(path.resolve(here, "../.."), "data");
}

export function grokHome(home = os.homedir()): string {
  return expandHome(process.env.GROK_HOME || path.join(home, ".grok"), home);
}

export function qoderHome(home = os.homedir()): string {
  // QODER_CONFIG_DIR is the documented override; QODER_HOME kept for compat.
  return expandHome(
    process.env.QODER_CONFIG_DIR ||
      process.env.QODER_HOME ||
      path.join(home, ".qoder"),
    home,
  );
}

export function claudeHome(home = os.homedir()): string {
  return expandHome(
    process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"),
    home,
  );
}

export function codexHome(home = os.homedir()): string {
  return expandHome(process.env.CODEX_HOME || path.join(home, ".codex"), home);
}

export function cursorHome(home = os.homedir()): string {
  return expandHome(
    process.env.CURSOR_HOME || path.join(home, ".cursor"),
    home,
  );
}
