/**
 * Session-retention audit for agent settings.json.
 *
 * Both Qoder and Claude Code prune local session transcripts on a timer, which
 * silently destroys the very data this tool lists. We check the relevant keys at
 * startup and report; writing only happens when the user runs `:retention fix`.
 *
 *   Qoder   general.sessionRetention.enabled = false   → keep forever.
 *           The default is not documented publicly, so an unset key is treated
 *           as "cleanup may be running" rather than a known-on state.
 *   Claude  cleanupPeriodDays                          → integer >= 1, default 30.
 *           0 is rejected by Claude's own schema, so "disable" is not expressible;
 *           we set a very large value instead. Note this key also governs cleanup
 *           of subagent worktrees, tasks, shell snapshots and backups.
 *
 * Constraint: agent session *stores* stay read-only (d/constraints.md §1.1).
 * settings.json is config, not a store, and is only touched on explicit request
 * with a .bak written first and all unrelated keys preserved.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { claudeHome, qoderHome } from "./paths.js";
import { readJsonFile } from "./fsutil.js";

/** Years, not days — Claude cannot truly disable cleanup. */
export const CLAUDE_KEEP_DAYS = 99999;
/** Claude Code's documented default. */
export const CLAUDE_DEFAULT_DAYS = 30;
/** Below this we consider the user at risk of losing transcripts. */
const CLAUDE_SAFE_MIN_DAYS = 3650;

export type RetentionAgent = "qoder" | "claude";

export interface RetentionFinding {
  agent: RetentionAgent;
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

function settingsPathFor(agent: RetentionAgent, home: string): string {
  const root = agent === "qoder" ? qoderHome(home) : claudeHome(home);
  return path.join(root, "settings.json");
}

const QODER_FIX = "general.sessionRetention.enabled = false";
const CLAUDE_FIX = `cleanupPeriodDays = ${CLAUDE_KEEP_DAYS}`;

/**
 * A missing settings.json still means the agent default applies, so it counts as
 * at-risk — but only when the agent is actually installed (home dir present).
 */
function inspectQoder(home: string): RetentionFinding | null {
  const settingsPath = settingsPathFor("qoder", home);
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
  const settingsPath = settingsPathFor("claude", home);
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

/** Findings for every installed agent, in display order. */
export function auditRetention(home = os.homedir()): RetentionFinding[] {
  const out: RetentionFinding[] = [];
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

/**
 * Merge the retention key into an existing settings.json, preserving every other
 * key. Unreadable-but-present files are left alone: overwriting could destroy
 * settings we failed to parse.
 */
function writeRetention(finding: RetentionFinding): RetentionFixResult {
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

/** Apply the retention fix to every at-risk agent. */
export function fixRetention(home = os.homedir()): RetentionFixResult[] {
  return retentionRisks(home).map(writeRetention);
}
