import path from "node:path";
import type { SessionRecord } from "../types.js";
import { grokHome } from "../lib/paths.js";
import {
  existsDir,
  listDirs,
  readJsonFile,
  safeMtimeMs,
} from "../lib/fsutil.js";
import { mtimeIso, toIso } from "../lib/time.js";

interface GrokSummary {
  info?: { id?: string; cwd?: string };
  session_summary?: string;
  generated_title?: string;
  created_at?: string;
  updated_at?: string;
  last_active_at?: string;
  num_messages?: number;
  num_chat_messages?: number;
  current_model_id?: string;
  agent_name?: string;
  parent_session_id?: string;
}

function isSessionIdDir(name: string): boolean {
  // UUID-ish (v4 or v7)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    name,
  );
}

export function discoverGrok(home?: string): SessionRecord[] {
  const root = path.join(grokHome(home), "sessions");
  if (!existsDir(root)) return [];

  const out: SessionRecord[] = [];

  for (const cwdGroup of listDirs(root)) {
    // skip non-group dirs; each group is encoded cwd or slug
    for (const sessionDir of listDirs(cwdGroup)) {
      const id = path.basename(sessionDir);
      if (!isSessionIdDir(id)) continue;

      const summaryPath = path.join(sessionDir, "summary.json");
      const summary = readJsonFile<GrokSummary>(summaryPath);
      if (!summary) continue;

      const sid = summary.info?.id || id;
      const title =
        summary.generated_title ||
        summary.session_summary ||
        sid.slice(0, 8);
      const lastActive =
        toIso(summary.last_active_at) ||
        toIso(summary.updated_at) ||
        mtimeIso(safeMtimeMs(summaryPath) || safeMtimeMs(sessionDir));
      const createdAt = toIso(summary.created_at);
      const messageCount =
        typeof summary.num_messages === "number"
          ? summary.num_messages
          : typeof summary.num_chat_messages === "number"
            ? summary.num_chat_messages
            : 0;

      out.push({
        source: "grok",
        id: sid,
        title,
        cwd: summary.info?.cwd ?? null,
        createdAt,
        lastActive,
        messageCount,
        path: sessionDir,
        extra: {
          numChatMessages: summary.num_chat_messages ?? null,
          model: summary.current_model_id ?? null,
          agentName: summary.agent_name ?? null,
          parentSessionId: summary.parent_session_id ?? null,
          cwdSource: summary.info?.cwd ? "summary.json:info.cwd" : null,
          // Grok: UUID resume is global — command without forced cd (see resumeInfo)
          resume: `grok --resume ${sid}`,
          resumePathMode: "recommended",
        },
      });
    }
  }

  return out;
}
