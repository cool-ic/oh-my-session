/**
 * Delete session storage on disk. Only called from TUI `:wq`.
 * Does not touch other projects or unrelated files.
 */
import fs from "node:fs";
import path from "node:path";
import type { SessionRecord } from "../types.js";

export interface DeleteResult {
  id: string;
  source: string;
  ok: boolean;
  error?: string;
  removed: string[];
}

function tryUnlink(p: string, removed: string[]): void {
  try {
    if (fs.existsSync(p)) {
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true });
      } else {
        fs.unlinkSync(p);
      }
      removed.push(p);
    }
  } catch {
    /* collect via outer */
    throw new Error(`failed to remove ${p}`);
  }
}

/** Remove one session's on-disk store. */
export function deleteSessionFiles(s: SessionRecord): DeleteResult {
  const removed: string[] = [];
  const base = {
    id: s.id,
    source: s.source,
    ok: false,
    removed,
  };

  try {
    if (s.source === "grok") {
      // path is session directory
      tryUnlink(s.path, removed);
      base.ok = true;
      return base;
    }

    if (s.source === "qoder") {
      // path is usually <id>.jsonl; also remove -session.json and <id>/ dir
      const p = s.path;
      tryUnlink(p, removed);
      if (p.endsWith(".jsonl")) {
        const dir = path.dirname(p);
        const id = path.basename(p, ".jsonl");
        tryUnlink(path.join(dir, `${id}-session.json`), removed);
        tryUnlink(path.join(dir, id), removed);
      } else if (p.endsWith("-session.json")) {
        const dir = path.dirname(p);
        const id = path.basename(p, "-session.json");
        tryUnlink(path.join(dir, `${id}.jsonl`), removed);
        tryUnlink(path.join(dir, id), removed);
      }
      base.ok = true;
      return base;
    }

    if (s.source === "claude") {
      tryUnlink(s.path, removed);
      base.ok = true;
      return base;
    }

    // codex/cursor: best-effort path only
    tryUnlink(s.path, removed);
    base.ok = true;
    return base;
  } catch (e) {
    return {
      ...base,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function deleteSessions(
  sessions: SessionRecord[],
): DeleteResult[] {
  return sessions.map(deleteSessionFiles);
}
