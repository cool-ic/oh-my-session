/**
 * Session-retention audit for agent config files.
 *
 * Several agents prune local session transcripts on a timer, which silently
 * destroys the very data this tool lists. We check the relevant keys at
 * startup and report; writing only happens when the user runs `:retention`
 * and confirms.
 *
 *   Qoder   general.sessionRetention.enabled = false   → keep forever.
 *           The default is not documented publicly, so an unset key is treated
 *           as "cleanup may be running" rather than a known-on state.
 *   Claude  cleanupPeriodDays                          → integer >= 1, default 30.
 *           0 is rejected by Claude's own schema, so "disable" is not expressible;
 *           we set a very large value instead. Note this key also governs cleanup
 *           of subagent worktrees, tasks, shell snapshots and backups.
 *   Grok    [storage] cleanup_ttl_days in config.toml  → integer > 0, default 30.
 *           Source: xai-org/grok-build persistence.rs cleanup_stale_sessions.
 *           0 / missing falls back to 30; true disable is not expressible — we
 *           set a very large value instead. Scans on agent start (once/process).
 *
 * Constraint: agent session *stores* stay read-only (d/constraints.md §1.1).
 * Config files are only touched on explicit request with a .bak written first
 * and all unrelated keys preserved.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { claudeHome, grokHome, qoderHome } from "./paths.js";
import { readJsonFile } from "./fsutil.js";

/** Years, not days — Claude cannot truly disable cleanup. */
export const CLAUDE_KEEP_DAYS = 99999;
/** Claude Code's documented default. */
export const CLAUDE_DEFAULT_DAYS = 30;
/** Below this we consider the user at risk of losing transcripts. */
const CLAUDE_SAFE_MIN_DAYS = 3650;

/**
 * Grok Build cannot disable TTL cleanup (days must be > 0); large value ≈ forever.
 * Same magnitude as Claude's keep-days for a consistent product default.
 */
export const GROK_KEEP_DAYS = 99999;
/** Grok Build default from DEFAULT_CLEANUP_TTL_DAYS in persistence.rs. */
export const GROK_DEFAULT_DAYS = 30;
/** Same safety bar as Claude: ≥ ~10 years counts as "ok". */
const GROK_SAFE_MIN_DAYS = 3650;

/** Single source of truth for retention-aware agents (prefs + audit). */
export const RETENTION_AGENTS = ["grok", "qoder", "claude"] as const;
export type RetentionAgent = (typeof RETENTION_AGENTS)[number];

export interface RetentionFinding {
  agent: RetentionAgent;
  /** Absolute path to the config file that holds the retention key. */
  settingsPath: string;
  /** false = retention already disabled / effectively unlimited */
  atRisk: boolean;
  /** What the agent does today, in plain words. */
  notice: string;
  /** The config change that turns it off. */
  fixHint: string;
  /** Compact form for the one-line footer warning. */
  short: string;
}

interface QoderSettings {
  general?: { sessionRetention?: { enabled?: unknown } };
}

interface ClaudeSettings {
  cleanupPeriodDays?: unknown;
}

function configPathFor(agent: RetentionAgent, home: string): string {
  if (agent === "grok") return path.join(grokHome(home), "config.toml");
  if (agent === "qoder") return path.join(qoderHome(home), "settings.json");
  return path.join(claudeHome(home), "settings.json");
}

const QODER_FIX = "general.sessionRetention.enabled = false";
const CLAUDE_FIX = `cleanupPeriodDays = ${CLAUDE_KEEP_DAYS}`;
const GROK_FIX = `[storage] cleanup_ttl_days = ${GROK_KEEP_DAYS}`;

// ---------------------------------------------------------------------------
// Grok config.toml helpers (no TOML dependency — surgical text edit only)
// ---------------------------------------------------------------------------

/**
 * Body of a top-level `[name]` table (not `[name.sub]`). Returns offsets into
 * `raw` for the body (after the header line, up to the next table header).
 * Header may sit at EOF without a trailing newline.
 */
function tomlTableBody(
  raw: string,
  name: string,
): { headerStart: number; bodyStart: number; bodyEnd: number } | null {
  // Allow EOF after the header (no trailing newline).
  const header = new RegExp(`^\\[${name}\\][ \\t]*(?:#.*)?(?:\\r?\\n|$)`, "m");
  const m = header.exec(raw);
  if (!m || m.index == null) return null;
  const headerStart = m.index;
  let bodyStart = m.index + m[0].length;
  // If match ended at EOF without consuming a newline, body is empty at EOF.
  if (bodyStart > raw.length) bodyStart = raw.length;
  const rest = raw.slice(bodyStart);
  const next = rest.search(/^\[[^\]]+\]/m);
  const bodyEnd = next === -1 ? raw.length : bodyStart + next;
  return { headerStart, bodyStart, bodyEnd };
}

/** Read `cleanup_ttl_days` from `[storage]`. Undefined if unset / unreadable. */
export function readGrokCleanupTtlDays(raw: string): number | undefined {
  const range = tomlTableBody(raw, "storage");
  if (!range) return undefined;
  const body = raw.slice(range.bodyStart, range.bodyEnd);
  // Accept bare ints or simple quoted ints (unusual but seen in hand-edits).
  const m = body.match(
    /^[ \t]*cleanup_ttl_days[ \t]*=[ \t]*["']?(-?\d+)["']?\b/m,
  );
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Set `[storage].cleanup_ttl_days`, preserving the rest of the file byte-for-byte
 * outside that one key. Creates the `[storage]` table if missing.
 */
export function setGrokCleanupTtlDays(raw: string, days: number): string {
  const value = String(days);
  const range = tomlTableBody(raw, "storage");
  if (!range) {
    const pad =
      raw.length === 0 ? "" : raw.endsWith("\n") ? "\n" : "\n\n";
    return `${raw}${pad}[storage]\ncleanup_ttl_days = ${value}\n`;
  }

  // Ensure header is followed by a newline so the key is on its own line when
  // the original file was exactly `[storage]` at EOF.
  let prefix = raw.slice(0, range.bodyStart);
  let body = raw.slice(range.bodyStart, range.bodyEnd);
  const suffix = raw.slice(range.bodyEnd);
  if (
    range.bodyStart === range.bodyEnd &&
    !prefix.endsWith("\n") &&
    !prefix.endsWith("\r")
  ) {
    prefix += "\n";
  }

  const keyRe = /^([ \t]*cleanup_ttl_days[ \t]*=[ \t]*)[^\r\n#]*/m;
  if (keyRe.test(body)) {
    body = body.replace(keyRe, `$1${value}`);
  } else {
    const nl = body.startsWith("\r\n") ? "\r\n" : "\n";
    // body may be empty; still emit key + newline
    body = body.length === 0 ? `cleanup_ttl_days = ${value}\n` : `cleanup_ttl_days = ${value}${nl}${body}`;
  }
  return prefix + body + suffix;
}

/**
 * A missing config still means the agent default applies, so it counts as
 * at-risk — but only when the agent is actually installed (home dir present).
 */
function inspectGrok(home: string): RetentionFinding | null {
  const settingsPath = configPathFor("grok", home);
  if (!fs.existsSync(grokHome(home))) return null;

  if (!fs.existsSync(settingsPath)) {
    return {
      agent: "grok",
      settingsPath,
      atRisk: true,
      notice: `Grok Build automatically deletes local session files older than ${GROK_DEFAULT_DAYS} days (mtime).`,
      fixHint: GROK_FIX,
      short: `grok auto-deletes session files older than ${GROK_DEFAULT_DAYS} days`,
    };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(settingsPath, "utf8");
  } catch {
    return {
      agent: "grok",
      settingsPath,
      atRisk: true,
      notice: "config.toml could not be read, so the 30-day session cleanup may be running.",
      fixHint: GROK_FIX,
      short: "grok config.toml unreadable",
    };
  }

  const days = readGrokCleanupTtlDays(raw);
  // Grok only accepts days > 0; 0 / negative / unset → default 30.
  if (typeof days === "number" && days > 0) {
    if (days >= GROK_SAFE_MIN_DAYS) {
      return {
        agent: "grok",
        settingsPath,
        atRisk: false,
        notice: `Session files are kept for ${days} days — effectively forever.`,
        fixHint: GROK_FIX,
        short: "grok ok",
      };
    }
    return {
      agent: "grok",
      settingsPath,
      atRisk: true,
      notice: `Grok Build automatically deletes local session files older than ${days} days (mtime).`,
      fixHint: GROK_FIX,
      short: `grok auto-deletes session files older than ${days} days`,
    };
  }

  return {
    agent: "grok",
    settingsPath,
    atRisk: true,
    notice: `Grok Build automatically deletes local session files older than ${GROK_DEFAULT_DAYS} days (mtime).`,
    fixHint: GROK_FIX,
    short: `grok auto-deletes session files older than ${GROK_DEFAULT_DAYS} days`,
  };
}

/**
 * A missing settings.json still means the agent default applies, so it counts as
 * at-risk — but only when the agent is actually installed (home dir present).
 */
function inspectQoder(home: string): RetentionFinding | null {
  const settingsPath = configPathFor("qoder", home);
  if (!fs.existsSync(qoderHome(home))) return null;

  const cfg = readJsonFile<QoderSettings>(settingsPath);
  if (cfg == null) {
    const unreadable = fs.existsSync(settingsPath);
    return {
      agent: "qoder",
      settingsPath,
      atRisk: true,
      notice: unreadable
        ? "settings.json could not be read, so session cleanup may be running."
        : "Qoder may automatically delete sessions that have not been used for a while.",
      fixHint: QODER_FIX,
      short: unreadable
        ? "qoder settings.json unreadable"
        : "qoder may auto-delete unused sessions",
    };
  }

  const enabled = cfg.general?.sessionRetention?.enabled;
  if (enabled === false) {
    return {
      agent: "qoder",
      settingsPath,
      atRisk: false,
      notice: "Session cleanup is turned off.",
      fixHint: QODER_FIX,
      short: "qoder ok",
    };
  }
  return {
    agent: "qoder",
    settingsPath,
    atRisk: true,
    notice:
      "Qoder may automatically delete sessions that have not been used for a while.",
    fixHint: QODER_FIX,
    short: "qoder may auto-delete unused sessions",
  };
}

function inspectClaude(home: string): RetentionFinding | null {
  const settingsPath = configPathFor("claude", home);
  if (!fs.existsSync(claudeHome(home))) return null;

  const cfg = readJsonFile<ClaudeSettings>(settingsPath);
  if (cfg == null) {
    const unreadable = fs.existsSync(settingsPath);
    return {
      agent: "claude",
      settingsPath,
      atRisk: true,
      notice: unreadable
        ? "settings.json could not be read, so the 30-day cleanup may be running."
        : `Claude Code automatically deletes sessions unused for ${CLAUDE_DEFAULT_DAYS} days.`,
      fixHint: CLAUDE_FIX,
      short: unreadable
        ? "claude settings.json unreadable"
        : `claude auto-deletes sessions unused for ${CLAUDE_DEFAULT_DAYS} days`,
    };
  }

  const days = cfg.cleanupPeriodDays;
  if (typeof days === "number" && Number.isFinite(days)) {
    if (days >= CLAUDE_SAFE_MIN_DAYS) {
      return {
        agent: "claude",
        settingsPath,
        atRisk: false,
        notice: `Sessions are kept for ${days} days — effectively forever.`,
        fixHint: CLAUDE_FIX,
        short: "claude ok",
      };
    }
    return {
      agent: "claude",
      settingsPath,
      atRisk: true,
      notice: `Claude Code automatically deletes sessions unused for ${days} days.`,
      fixHint: CLAUDE_FIX,
      short: `claude auto-deletes sessions unused for ${days} days`,
    };
  }
  return {
    agent: "claude",
    settingsPath,
    atRisk: true,
    notice: `Claude Code automatically deletes sessions unused for ${CLAUDE_DEFAULT_DAYS} days.`,
    fixHint: CLAUDE_FIX,
    short: `claude auto-deletes sessions unused for ${CLAUDE_DEFAULT_DAYS} days`,
  };
}

/** Findings for every installed agent, in display order (grok → qoder → claude). */
export function auditRetention(home = os.homedir()): RetentionFinding[] {
  const out: RetentionFinding[] = [];
  const grok = inspectGrok(home);
  if (grok) out.push(grok);
  const qoder = inspectQoder(home);
  if (qoder) out.push(qoder);
  const claude = inspectClaude(home);
  if (claude) out.push(claude);
  return out;
}

export function retentionRisks(home = os.homedir()): RetentionFinding[] {
  return auditRetention(home).filter((f) => f.atRisk);
}

/** One-line summary for the TUI banner / stderr warning. */
export function retentionWarning(risks: RetentionFinding[]): string {
  if (risks.length === 0) return "";
  return risks.map((r) => r.short).join("  ·  ");
}

export interface RetentionFixResult {
  agent: RetentionAgent;
  ok: boolean;
  settingsPath: string;
  backupPath?: string;
  error?: string;
}

function writeJsonRetention(finding: RetentionFinding): RetentionFixResult {
  const { agent, settingsPath } = finding;
  const base: RetentionFixResult = { agent, ok: false, settingsPath };

  try {
    const exists = fs.existsSync(settingsPath);
    let cfg: Record<string, unknown> = {};

    if (exists) {
      const raw = fs.readFileSync(settingsPath, "utf8");
      if (raw.trim()) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return { ...base, error: "settings.json is not valid JSON — fix by hand" };
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return { ...base, error: "settings.json is not a JSON object" };
        }
        cfg = parsed as Record<string, unknown>;
      }
    }

    if (agent === "qoder") {
      const general = cfg.general;
      const generalObj: Record<string, unknown> =
        typeof general === "object" && general !== null && !Array.isArray(general)
          ? { ...(general as Record<string, unknown>) }
          : {};
      const retention = generalObj.sessionRetention;
      const retentionObj: Record<string, unknown> =
        typeof retention === "object" &&
        retention !== null &&
        !Array.isArray(retention)
          ? { ...(retention as Record<string, unknown>) }
          : {};
      retentionObj.enabled = false;
      generalObj.sessionRetention = retentionObj;
      cfg.general = generalObj;
    } else {
      cfg.cleanupPeriodDays = CLAUDE_KEEP_DAYS;
    }

    let backupPath: string | undefined;
    if (exists) {
      backupPath = `${settingsPath}.bak`;
      fs.copyFileSync(settingsPath, backupPath);
    } else {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    }

    const dir = path.dirname(settingsPath);
    const tmp = path.join(dir, `.settings.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, settingsPath);

    return { agent, ok: true, settingsPath, backupPath };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Merge cleanup_ttl_days into config.toml via surgical text edit (preserve all
 * other tables/keys/comments). Unreadable files are left alone.
 */
function writeGrokRetention(finding: RetentionFinding): RetentionFixResult {
  const { settingsPath } = finding;
  const base: RetentionFixResult = { agent: "grok", ok: false, settingsPath };

  try {
    const exists = fs.existsSync(settingsPath);
    let raw = "";
    if (exists) {
      try {
        raw = fs.readFileSync(settingsPath, "utf8");
      } catch (e) {
        return {
          ...base,
          error: e instanceof Error ? e.message : "config.toml unreadable",
        };
      }
    }

    const next = setGrokCleanupTtlDays(raw, GROK_KEEP_DAYS);
    // Sanity: we must be able to read back a safe value after the edit.
    const verify = readGrokCleanupTtlDays(next);
    if (verify !== GROK_KEEP_DAYS) {
      return {
        ...base,
        error: "could not set [storage] cleanup_ttl_days safely — fix by hand",
      };
    }

    let backupPath: string | undefined;
    if (exists) {
      backupPath = `${settingsPath}.bak`;
      fs.copyFileSync(settingsPath, backupPath);
    } else {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    }

    const dir = path.dirname(settingsPath);
    const tmp = path.join(dir, `.config.${process.pid}.tmp`);
    fs.writeFileSync(tmp, next, "utf8");
    fs.renameSync(tmp, settingsPath);

    return { agent: "grok", ok: true, settingsPath, backupPath };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Apply the retention fix for one finding. Unreadable-but-present JSON files
 * are left alone: overwriting could destroy settings we failed to parse.
 */
function writeRetention(finding: RetentionFinding): RetentionFixResult {
  if (finding.agent === "grok") return writeGrokRetention(finding);
  return writeJsonRetention(finding);
}

/**
 * Apply the retention fix to at-risk agents.
 * @param agents if set, only those agents (still must be at-risk on disk).
 */
export function fixRetention(
  home = os.homedir(),
  agents?: RetentionAgent[],
): RetentionFixResult[] {
  let risks = retentionRisks(home);
  if (agents != null && agents.length > 0) {
    const want = new Set(agents);
    risks = risks.filter((r) => want.has(r.agent));
  }
  return risks.map(writeRetention);
}

/** Fix exactly these findings (caller decides the set, e.g. pending popup). */
export function fixRetentionFindings(
  findings: RetentionFinding[],
): RetentionFixResult[] {
  return findings.filter((f) => f.atRisk).map(writeRetention);
}
