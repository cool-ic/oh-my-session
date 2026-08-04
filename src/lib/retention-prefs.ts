/**
 * User-level retention preferences for oh-my-sessions (not agent config).
 *
 * File: $OMS_DATA_DIR/retention-prefs.csv
 * Columns: agent,status,updated_at,detail
 *
 * status=ignored → user acknowledges the agent may auto-delete sessions and
 * does not want us to change its config; never auto-popup for that agent
 * until they unignore via :retention.
 */
import fs from "node:fs";
import path from "node:path";
import {
  RETENTION_AGENTS,
  type RetentionAgent,
} from "./retention.js";
import { dataDir } from "./paths.js";

const HEADER = "agent,status,updated_at,detail\n";

export type RetentionPrefStatus = "ignored";

export interface RetentionPref {
  agent: RetentionAgent;
  status: RetentionPrefStatus;
  updatedAt: string;
  detail: string;
}

export interface RetentionPrefsWriteResult {
  ok: boolean;
  path: string;
  error?: string;
}

const AGENT_SET = new Set<string>(RETENTION_AGENTS);

export function retentionPrefsPath(): string {
  return path.join(dataDir(), "retention-prefs.csv");
}

function escapeField(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function ensureStore(): void {
  const p = retentionPrefsPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, HEADER, "utf8");
}

function isAgent(s: string): s is RetentionAgent {
  return AGENT_SET.has(s);
}

/** Load prefs keyed by agent. */
export function loadRetentionPrefs(): Map<RetentionAgent, RetentionPref> {
  ensureStore();
  const text = fs.readFileSync(retentionPrefsPath(), "utf8");
  const map = new Map<RetentionAgent, RetentionPref>();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i === 0 && /^agent\s*,\s*status\s*,/i.test(line)) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 2) continue;
    const agentRaw = (cols[0] ?? "").trim().toLowerCase();
    const status = (cols[1] ?? "").trim().toLowerCase();
    if (!isAgent(agentRaw) || status !== "ignored") continue;
    map.set(agentRaw, {
      agent: agentRaw,
      status: "ignored",
      updatedAt: (cols[2] ?? "").trim() || new Date().toISOString(),
      detail: (cols[3] ?? "").trim(),
    });
  }
  return map;
}

function writeAll(
  prefs: Map<RetentionAgent, RetentionPref>,
): RetentionPrefsWriteResult {
  const p = retentionPrefsPath();
  try {
    ensureStore();
    const lines = [HEADER.trimEnd()];
    for (const agent of RETENTION_AGENTS) {
      const row = prefs.get(agent);
      if (!row) continue;
      lines.push(
        [
          escapeField(row.agent),
          escapeField(row.status),
          escapeField(row.updatedAt),
          escapeField(row.detail ?? ""),
        ].join(","),
      );
    }
    for (const [agent, row] of prefs) {
      if ((RETENTION_AGENTS as readonly string[]).includes(agent)) continue;
      lines.push(
        [
          escapeField(row.agent),
          escapeField(row.status),
          escapeField(row.updatedAt),
          escapeField(row.detail ?? ""),
        ].join(","),
      );
    }
    const dir = path.dirname(p);
    const tmp = path.join(dir, `.retention-prefs.${process.pid}.tmp`);
    fs.writeFileSync(tmp, lines.join("\n") + "\n", "utf8");
    fs.renameSync(tmp, p);
    return { ok: true, path: p };
  } catch (e) {
    return {
      ok: false,
      path: p,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Mark agents as ignored (acknowledge risk, never auto-popup). */
export function ignoreRetentionAgents(
  agents: RetentionAgent[],
  detail = "",
): RetentionPrefsWriteResult {
  if (agents.length === 0) {
    return { ok: true, path: retentionPrefsPath() };
  }
  try {
    const prefs = loadRetentionPrefs();
    const now = new Date().toISOString();
    for (const agent of agents) {
      prefs.set(agent, {
        agent,
        status: "ignored",
        updatedAt: now,
        detail,
      });
    }
    return writeAll(prefs);
  } catch (e) {
    return {
      ok: false,
      path: retentionPrefsPath(),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Remove ignore for given agents, or all if empty / omitted. */
export function unignoreRetentionAgents(
  agents?: RetentionAgent[],
): RetentionPrefsWriteResult {
  try {
    const prefs = loadRetentionPrefs();
    if (!agents || agents.length === 0) {
      if (prefs.size === 0) return { ok: true, path: retentionPrefsPath() };
      return writeAll(new Map());
    }
    for (const a of agents) prefs.delete(a);
    return writeAll(prefs);
  } catch (e) {
    return {
      ok: false,
      path: retentionPrefsPath(),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** atRisk findings the user has not ignored — need a decision popup. */
export function pendingRetentionRisks<
  T extends { agent: RetentionAgent; atRisk?: boolean },
>(
  findings: T[],
  prefs: Map<RetentionAgent, RetentionPref> = loadRetentionPrefs(),
): T[] {
  return findings.filter(
    (f) => f.atRisk === true && prefs.get(f.agent)?.status !== "ignored",
  );
}

/** atRisk findings the user already acknowledged. */
export function ackedRetentionRisks<
  T extends { agent: RetentionAgent; atRisk?: boolean },
>(
  findings: T[],
  prefs: Map<RetentionAgent, RetentionPref> = loadRetentionPrefs(),
): T[] {
  return findings.filter(
    (f) => f.atRisk === true && prefs.get(f.agent)?.status === "ignored",
  );
}
