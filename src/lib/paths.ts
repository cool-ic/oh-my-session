import os from "node:os";
import path from "node:path";

export function expandHome(p: string, home = os.homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
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
