import type { AgentSource, DiscoverOptions, SessionRecord } from "../types.js";
import { ALL_SOURCES } from "../types.js";
import { sortKeyLastActive } from "../lib/time.js";
import { discoverGrok } from "./grok.js";
import { discoverQoder } from "./qoder.js";
import { discoverClaude } from "./claude.js";

function parseSourcesEnv(): AgentSource[] | null {
  const raw = process.env.AGENT_SESSION_SOURCES;
  if (!raw?.trim()) return null;
  const allowed = new Set(ALL_SOURCES);
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is AgentSource => allowed.has(s as AgentSource));
  return list.length ? list : null;
}

export function discoverAll(options: DiscoverOptions = {}): SessionRecord[] {
  const sources =
    options.sources ?? parseSourcesEnv() ?? (["grok", "qoder", "claude"] as AgentSource[]);
  const home = options.home;
  const records: SessionRecord[] = [];

  for (const source of sources) {
    switch (source) {
      case "grok":
        records.push(...discoverGrok(home));
        break;
      case "qoder":
        records.push(...discoverQoder(home));
        break;
      case "claude":
        records.push(...discoverClaude(home));
        break;
      case "codex":
      case "cursor":
        // Reserved: empty until stores present / implemented
        break;
    }
  }

  let filtered = records;
  if (options.cwdFilter) {
    const needle = options.cwdFilter;
    filtered = records.filter(
      (r) => r.cwd === needle || (r.cwd != null && r.cwd.startsWith(needle)),
    );
  }

  filtered.sort(
    (a, b) => sortKeyLastActive(b.lastActive) - sortKeyLastActive(a.lastActive),
  );
  return filtered;
}

export { discoverGrok, discoverQoder, discoverClaude };
