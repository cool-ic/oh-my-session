/**
 * Local star flags for sessions — CSV in this repo.
 *
 * File: <repo>/data/session-stars.csv
 * Columns: source,id,starred_at
 *
 * Starred sessions pin to top of the TUI list and cannot be dd-deleted
 * until unstarred (* toggles).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionRecord } from "../types.js";
import { sortKeyLastActive } from "./time.js";

const HEADER = "source,id,starred_at\n";

function repoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../..");
}

export function starStorePath(): string {
  return path.join(repoRoot(), "data", "session-stars.csv");
}

export function sessionKeyOf(source: string, id: string): string {
  return `${source}:${id}`;
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
  const p = starStorePath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, HEADER, "utf8");
}

/** Set of `source:id` that are starred. */
export function loadStarSet(): Set<string> {
  ensureStore();
  const text = fs.readFileSync(starStorePath(), "utf8");
  const set = new Set<string>();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i === 0 && /^source\s*,\s*id\s*,/i.test(line)) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 2) continue;
    const source = cols[0]?.trim();
    const id = cols[1]?.trim();
    if (source && id) set.add(sessionKeyOf(source, id));
  }
  return set;
}

export function isStarred(s: SessionRecord): boolean {
  return s.extra?.starred === true;
}

/** Mutate sessions: set extra.starred; sort starred first, then lastActive desc. */
export function applyStarFlags(sessions: SessionRecord[]): SessionRecord[] {
  const stars = loadStarSet();
  for (const s of sessions) {
    const starred = stars.has(sessionKeyOf(s.source, s.id));
    s.extra = { ...s.extra, starred };
  }
  sessions.sort((a, b) => {
    const sa = isStarred(a) ? 0 : 1;
    const sb = isStarred(b) ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return sortKeyLastActive(b.lastActive) - sortKeyLastActive(a.lastActive);
  });
  return sessions;
}

/** Toggle star for one session. Returns new starred state. */
export function toggleStar(
  source: string,
  id: string,
): { ok: boolean; starred: boolean; error?: string } {
  try {
    ensureStore();
    const set = loadStarSet();
    const k = sessionKeyOf(source, id);
    const nowStarred = !set.has(k);
    if (nowStarred) set.add(k);
    else set.delete(k);

    const lines = [HEADER];
    const sorted = [...set].sort();
    const at = new Date().toISOString();
    for (const key of sorted) {
      const i = key.indexOf(":");
      if (i < 0) continue;
      const source_ = key.slice(0, i);
      const id_ = key.slice(i + 1);
      lines.push(
        [escapeField(source_), escapeField(id_), escapeField(at)].join(",") +
          "\n",
      );
    }
    const storePath = starStorePath();
    const tmp = path.join(
      path.dirname(storePath),
      `.session-stars.${process.pid}.tmp`,
    );
    fs.writeFileSync(tmp, lines.join(""), "utf8");
    fs.renameSync(tmp, storePath);
    return { ok: true, starred: nowStarred };
  } catch (e) {
    return {
      ok: false,
      starred: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
