import fs from "node:fs";
import path from "node:path";
import type { SessionRecord } from "../types.js";
import { qoderHome } from "../lib/paths.js";
import {
  countJsonlTypes,
  existsDir,
  listDirs,
  listFiles,
  readJsonFile,
  safeMtimeMs,
} from "../lib/fsutil.js";
import { mtimeIso, toIso } from "../lib/time.js";
import { contentToText } from "../lib/jsonl-text.js";

interface QoderSessionMeta {
  id?: string;
  title?: string;
  message_count?: number;
  created_at?: number | string;
  updated_at?: number | string;
  working_dir?: string;
  parent_session_id?: string;
}

const MSG_TYPES = new Set(["user", "assistant"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resume project path from transcript.
 * Qoder records `cwd` on message lines — this is where you must be (or pass -w)
 * to successfully resume.
 */
export function extractCwdFromJsonl(jsonlPath: string): string | null {
  try {
    const text = fs.readFileSync(jsonlPath, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as { cwd?: unknown };
        if (typeof obj.cwd === "string" && obj.cwd.startsWith("/")) {
          return obj.cwd;
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* skip */
  }
  return null;
}

function firstUserPreview(jsonlPath: string, limit = 80): string | null {
  let lastPrompt: string | null = null;
  try {
    const text = fs.readFileSync(jsonlPath, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as {
          type?: string;
          isMeta?: boolean;
          lastPrompt?: string;
          message?: { content?: unknown };
        };
        if (obj.type === "last-prompt" && typeof obj.lastPrompt === "string") {
          const t = obj.lastPrompt.replace(/\s+/g, " ").trim();
          if (t) lastPrompt = t;
        }
        if (obj.type !== "user" || obj.isMeta) continue;
        const textContent = contentToText(obj.message?.content)
          .replace(/\s+/g, " ")
          .trim();
        if (!textContent || textContent.startsWith("<")) continue;
        return textContent.length > limit
          ? textContent.slice(0, limit) + "…"
          : textContent;
      } catch {
        /* skip */
      }
    }
  } catch {
    /* skip */
  }
  if (lastPrompt) {
    return lastPrompt.length > limit
      ? lastPrompt.slice(0, limit) + "…"
      : lastPrompt;
  }
  return null;
}

function qoderResumeHint(id: string, resumeDir: string | null): string {
  // Path binding is required — always bake cd into the command when known
  if (resumeDir) {
    const q = /^[A-Za-z0-9_./:-]+$/.test(resumeDir)
      ? resumeDir
      : `'${resumeDir.replace(/'/g, `'\\''`)}'`;
    return `cd ${q} && qodercli -r ${id}`;
  }
  return `qodercli -r ${id}`;
}

/**
 * Resolve resume directory for a Qoder session.
 * Priority: session.json working_dir → jsonl cwd field.
 * Always keep the recorded path even if the folder is gone.
 */
function resolveResumeDir(
  metaDir: string | null | undefined,
  jsonlPath: string | null,
): { dir: string | null; source: string | null } {
  if (metaDir && metaDir.trim()) {
    return { dir: metaDir.trim(), source: "session.json:working_dir" };
  }
  if (jsonlPath) {
    const fromJsonl = extractCwdFromJsonl(jsonlPath);
    if (fromJsonl) return { dir: fromJsonl, source: "jsonl:cwd" };
  }
  return { dir: null, source: null };
}

export function discoverQoder(home?: string): SessionRecord[] {
  const projects = path.join(qoderHome(home), "projects");
  if (!existsDir(projects)) return [];

  /** id → best record (prefer higher lastActive + has meta) */
  const byId = new Map<string, SessionRecord>();

  for (const projectDir of listDirs(projects)) {
    const files = listFiles(projectDir);
    const slug = path.basename(projectDir);

    // 1) *-session.json metas
    for (const f of files) {
      const base = path.basename(f);
      if (!base.endsWith("-session.json")) continue;
      const id = base.slice(0, -"-session.json".length);
      if (!UUID_RE.test(id)) continue;

      const meta = readJsonFile<QoderSessionMeta>(f);
      if (!meta) continue;

      const sid = meta.id || id;
      const jsonlPath = path.join(projectDir, `${sid}.jsonl`);
      const hasJsonl = fs.existsSync(jsonlPath);

      let messageCount =
        typeof meta.message_count === "number" ? meta.message_count : -1;
      if (messageCount < 0 && hasJsonl) {
        messageCount = countJsonlTypes(jsonlPath, MSG_TYPES);
      }
      if (messageCount < 0) messageCount = 0;

      const lastActive =
        toIso(meta.updated_at) ||
        (hasJsonl ? mtimeIso(safeMtimeMs(jsonlPath)) : null) ||
        mtimeIso(safeMtimeMs(f));
      const createdAt = toIso(meta.created_at);
      let title = (meta.title || "").trim();
      if (!title || title === "New Session") {
        title =
          (hasJsonl ? firstUserPreview(jsonlPath) : null) || sid.slice(0, 8);
      }

      const { dir: resumeDir, source: cwdSource } = resolveResumeDir(
        meta.working_dir,
        hasJsonl ? jsonlPath : null,
      );

      const rec: SessionRecord = {
        source: "qoder",
        id: sid,
        title,
        cwd: resumeDir,
        createdAt,
        lastActive,
        messageCount,
        path: hasJsonl ? jsonlPath : f,
        extra: {
          projectSlug: slug,
          parentSessionId: meta.parent_session_id || null,
          cwdSource,
          resume: qoderResumeHint(sid, resumeDir),
        },
      };
      upsert(byId, rec, true);
    }

    // 2) bare *.jsonl without meta (or fill cwd if meta lacked it)
    for (const f of files) {
      const base = path.basename(f);
      if (!base.endsWith(".jsonl")) continue;
      const id = base.slice(0, -".jsonl".length);
      if (!UUID_RE.test(id)) continue;

      const existing = byId.get(id);
      if (existing) {
        // meta-only path without working_dir → still try jsonl cwd
        if (!existing.cwd) {
          const { dir, source } = resolveResumeDir(null, f);
          if (dir) {
            existing.cwd = dir;
            existing.extra = {
              ...existing.extra,
              cwdSource: source,
              resume: qoderResumeHint(id, dir),
            };
          }
        }
        continue;
      }

      const messageCount = countJsonlTypes(f, MSG_TYPES);
      const lastActive = mtimeIso(safeMtimeMs(f));
      const title = firstUserPreview(f) || id.slice(0, 8);
      const { dir: resumeDir, source: cwdSource } = resolveResumeDir(null, f);

      const rec: SessionRecord = {
        source: "qoder",
        id,
        title,
        cwd: resumeDir,
        createdAt: null,
        lastActive,
        messageCount,
        path: f,
        extra: {
          projectSlug: slug,
          cwdSource,
          resume: qoderResumeHint(id, resumeDir),
        },
      };
      upsert(byId, rec, false);
    }
  }

  return [...byId.values()];
}

function upsert(
  map: Map<string, SessionRecord>,
  rec: SessionRecord,
  fromMeta: boolean,
): void {
  const prev = map.get(rec.id);
  if (!prev) {
    map.set(rec.id, rec);
    return;
  }
  const prevT = prev.lastActive ? new Date(prev.lastActive).getTime() : 0;
  const nextT = rec.lastActive ? new Date(rec.lastActive).getTime() : 0;
  // Prefer newer; on tie prefer meta-backed; prefer record that has cwd
  if (nextT > prevT || (nextT === prevT && fromMeta)) {
    if (!rec.cwd && prev.cwd) {
      rec.cwd = prev.cwd;
      rec.extra = {
        ...rec.extra,
        cwdSource: prev.extra?.cwdSource ?? rec.extra?.cwdSource,
        resume: qoderResumeHint(rec.id, prev.cwd),
      };
    }
    map.set(rec.id, rec);
  } else if (!prev.cwd && rec.cwd) {
    prev.cwd = rec.cwd;
    prev.extra = {
      ...prev.extra,
      cwdSource: rec.extra?.cwdSource,
      resume: qoderResumeHint(prev.id, rec.cwd),
    };
  }
}
