import os from "node:os";
import path from "node:path";

export function expandHome(p: string, home = os.homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

/**
 * User settings directory (titles / stars / tags / locale / prefs / update cache).
 *
 * Default for everyone: `~/.config/oms`.
 * Optional override: `OMS_DATA_DIR` (advanced / tooling only).
 * If `XDG_CONFIG_HOME` is set, uses `$XDG_CONFIG_HOME/oms` instead of `~/.config/oms`.
 */
export function dataDir(): string {
  const override = process.env.OMS_DATA_DIR;
  if (override && override.trim()) return expandHome(override.trim());
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const configHome = xdg
    ? expandHome(xdg)
    : path.join(os.homedir(), ".config");
  return path.join(configHome, "oms");
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
