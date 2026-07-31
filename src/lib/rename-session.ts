/**
 * Persist a new display title for a session. Called immediately on TUI `i` + Enter
 * (not deferred to :wq — rename is metadata, not destructive delete).
 *
 * | source | how |
 * |--------|-----|
 * | grok   | summary.json → generated_title + session_summary |
 * | claude | append custom-title record to .jsonl |
 * | qoder  | upsert <id>-session.json title field |
 */
import fs from "node:fs";
import path from "node:path";
import type { SessionRecord } from "../types.js";

export interface RenameResult {
  id: string;
  source: string;
  ok: boolean;
  error?: string;
  title?: string;
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.tmp`,
  );
  const body = JSON.stringify(data, null, 2) + "\n";
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, filePath);
}

function renameGrok(s: SessionRecord, title: string): void {
  // path is session directory
  const summaryPath = path.join(s.path, "summary.json");
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`missing summary.json under ${s.path}`);
  }
  const raw = fs.readFileSync(summaryPath, "utf8");
  const summary = JSON.parse(raw) as Record<string, unknown>;
  summary.generated_title = title;
  summary.session_summary = title;
  // touch updated_at so external tools see the change
  summary.updated_at = new Date().toISOString();
  atomicWriteJson(summaryPath, summary);
}

function renameClaude(s: SessionRecord, title: string): void {
  // path is the .jsonl transcript
  if (!s.path.endsWith(".jsonl") || !fs.existsSync(s.path)) {
    throw new Error(`claude transcript missing: ${s.path}`);
  }
  const entry = {
    type: "custom-title",
    customTitle: title,
    sessionId: s.id,
    timestamp: new Date().toISOString(),
  };
  fs.appendFileSync(s.path, JSON.stringify(entry) + "\n", "utf8");
}

function qoderMetaPath(s: SessionRecord): string {
  const p = s.path;
  if (p.endsWith("-session.json")) return p;
  if (p.endsWith(".jsonl")) {
    const dir = path.dirname(p);
    const id = path.basename(p, ".jsonl");
    return path.join(dir, `${id}-session.json`);
  }
  // directory or other — put meta next to store
  return path.join(path.dirname(p), `${s.id}-session.json`);
}

function renameQoder(s: SessionRecord, title: string): void {
  const metaPath = qoderMetaPath(s);
  let meta: Record<string, unknown> = {};
  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      meta = {};
    }
  }
  if (!meta.id) meta.id = s.id;
  meta.title = title;
  meta.updated_at = Date.now();
  if (s.cwd && !meta.working_dir) meta.working_dir = s.cwd;
  atomicWriteJson(metaPath, meta);
}

/** Write new title to the source-specific store. Does not mutate `s`. */
export function renameSession(
  s: SessionRecord,
  newTitle: string,
): RenameResult {
  const title = newTitle.replace(/\s+/g, " ").trim();
  const base = { id: s.id, source: s.source, ok: false as boolean };

  if (!title) {
    return { ...base, error: "empty title" };
  }
  if (title.length > 200) {
    return { ...base, error: "title too long (max 200)" };
  }

  try {
    switch (s.source) {
      case "grok":
        renameGrok(s, title);
        break;
      case "claude":
        renameClaude(s, title);
        break;
      case "qoder":
        renameQoder(s, title);
        break;
      default:
        return {
          ...base,
          error: `rename not supported for ${s.source}`,
        };
    }
    return { ...base, ok: true, title };
  } catch (e) {
    return {
      ...base,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
