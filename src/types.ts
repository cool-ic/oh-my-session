export type AgentSource = "grok" | "qoder" | "claude" | "codex" | "cursor";

/** ok = usable; empty = no messages; missing = cwd/store path gone */
export type SessionHealth = "ok" | "empty" | "missing";

export interface SessionRecord {
  source: AgentSource;
  id: string;
  title: string;
  /**
   * Resume project path: directory where the session was started.
   * Qoder requires resuming under this path. Keep the string even if deleted;
   * mark health=missing when gone. Not this tool's process cwd.
   */
  cwd: string | null;
  createdAt: string | null;
  lastActive: string | null;
  /** Primary message/update count for display */
  messageCount: number;
  /** Absolute path to session store (jsonl / dir) — not the resume project dir */
  path: string;
  /** Classified after discover (see lib/health.ts) */
  health?: SessionHealth;
  extra?: Record<string, unknown>;
}

export interface DiscoverOptions {
  sources?: AgentSource[];
  /** If set, only sessions whose cwd matches (exact or prefix) */
  cwdFilter?: string | null;
  home?: string;
}

export const ALL_SOURCES: AgentSource[] = [
  "grok",
  "qoder",
  "claude",
  "codex",
  "cursor",
];
