/**
 * Claude Code session discovery.
 *
 * Layout (official / session_reader.py):
 *   $CLAUDE_CONFIG_DIR/projects/<slugified-cwd>/<uuid>.jsonl
 *   CLAUDE_CONFIG_DIR defaults to ~/.claude
 *
 * Each .jsonl line is a typed record (user, assistant, custom-title, …).
 * Resume: `claude --resume <uuid>` must be run from the original project cwd
 *   (or a related worktree); `-c` continues the most recent session in cwd.
 */
import fs from "node:fs";
import path from "node:path";
import type { SessionRecord } from "../types.js";
import { claudeHome } from "../lib/paths.js";
import { existsDir, listDirs, listFiles, safeMtimeMs } from "../lib/fsutil.js";
import { mtimeIso, toIso } from "../lib/time.js";
import {
  contentToText,
  isGeneratedMetaText,
  oneLine,
} from "../lib/jsonl-text.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MSG_TYPES = new Set(["user", "assistant"]);

/** Title sources preferred over raw first-user text (last wins per type). */
const TITLE_TYPES: Array<{ type: string; field: string }> = [
  { type: "custom-title", field: "customTitle" },
  { type: "ai-title", field: "aiTitle" },
  { type: "summary", field: "summary" },
];

interface ClaudeLine {
  type?: string;
  isMeta?: boolean;
  cwd?: string;
  gitBranch?: string;
  timestamp?: string;
  customTitle?: string;
  aiTitle?: string;
  summary?: string;
  lastPrompt?: string;
  message?: { content?: unknown; role?: string };
}

function shellQuote(p: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(p)) return p;
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/**
 * Single pass over the transcript: title, cwd, branch, counts, timestamps.
 * Avoids re-reading large files three times.
 */
function inspectClaudeJsonl(jsonlPath: string): {
  title: string | null;
  cwd: string | null;
  branch: string | null;
  messageCount: number;
  createdAt: string | null;
  lastActive: string | null;
} {
  let titleFromMeta: string | null = null;
  let firstUser: string | null = null;
  let lastPrompt: string | null = null;
  let cwd: string | null = null;
  let branch: string | null = null;
  let messageCount = 0;
  let firstTs: string | null = null;
  let lastTs: string | null = null;

  // Track last value per title type (custom-title > ai-title > summary)
  const titleByType: Record<string, string> = {};

  try {
    const text = fs.readFileSync(jsonlPath, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let obj: ClaudeLine;
      try {
        obj = JSON.parse(line) as ClaudeLine;
      } catch {
        continue;
      }
      const t = obj.type;

      if (typeof obj.cwd === "string" && obj.cwd && !cwd) {
        cwd = obj.cwd;
      }
      if (typeof obj.gitBranch === "string" && obj.gitBranch) {
        branch = obj.gitBranch;
      }
      if (typeof obj.timestamp === "string" && obj.timestamp) {
        if (!firstTs) firstTs = obj.timestamp;
        lastTs = obj.timestamp;
      }

      if (t && MSG_TYPES.has(t) && !obj.isMeta) {
        messageCount++;
      }

      if (t === "last-prompt" && typeof obj.lastPrompt === "string") {
        const p = oneLine(obj.lastPrompt, 120);
        if (p) lastPrompt = p;
      }

      for (const { type, field } of TITLE_TYPES) {
        if (t === type) {
          const v = (obj as Record<string, unknown>)[field];
          if (typeof v === "string" && v.trim()) {
            titleByType[type] = oneLine(v, 120);
          }
        }
      }

      if (t === "user" && !obj.isMeta && !firstUser) {
        const raw = contentToText(obj.message?.content);
        const preview = oneLine(raw, 120);
        if (preview && !isGeneratedMetaText(preview)) {
          firstUser = preview;
        }
      }
    }
  } catch {
    /* unreadable */
  }

  for (const { type } of TITLE_TYPES) {
    if (titleByType[type]) {
      titleFromMeta = titleByType[type];
      break;
    }
  }

  const title = titleFromMeta || firstUser || lastPrompt;

  return {
    title,
    cwd,
    branch,
    messageCount,
    createdAt: firstTs ? toIso(firstTs) : null,
    lastActive: lastTs ? toIso(lastTs) : null,
  };
}

/**
 * Claude Code stores projects under ~/.claude/projects/<slug>/*.jsonl
 * (or $CLAUDE_CONFIG_DIR). Scans all project slugs (not only current cwd).
 */
export function discoverClaude(home?: string): SessionRecord[] {
  const projects = path.join(claudeHome(home), "projects");
  if (!existsDir(projects)) return [];

  const out: SessionRecord[] = [];
  const seen = new Set<string>();

  for (const projectDir of listDirs(projects)) {
    const projectSlug = path.basename(projectDir);

    // Session transcripts are UUID-named .jsonl at project root (not nested agent dirs).
    for (const f of listFiles(projectDir)) {
      const base = path.basename(f);
      if (!base.endsWith(".jsonl")) continue;
      const id = base.slice(0, -".jsonl".length);
      if (!UUID_RE.test(id)) continue;
      if (seen.has(id.toLowerCase())) continue;
      seen.add(id.toLowerCase());

      const meta = inspectClaudeJsonl(f);
      const mtime = safeMtimeMs(f);
      const lastActive = meta.lastActive || mtimeIso(mtime);
      const title = meta.title || id.slice(0, 8);

      out.push({
        source: "claude",
        id,
        title,
        cwd: meta.cwd,
        createdAt: meta.createdAt,
        lastActive,
        messageCount: meta.messageCount,
        path: f,
        extra: {
          projectSlug,
          branch: meta.branch,
          cwdSource: meta.cwd ? "jsonl:cwd" : null,
          resume: meta.cwd
            ? `cd ${shellQuote(meta.cwd)} && claude --resume ${id}`
            : `claude --resume ${id}`,
        },
      });
    }
  }

  return out;
}
