/**
 * Local title overrides for sessions — CSV in this repo (stable, agent-agnostic).
 *
 * File: <repo>/data/session-titles.csv
 * Columns: source,id,title,updated_at
 *
 * This is the authority for renames done in this TUI (i). We do not patch
 * Grok/Claude/Qoder native stores — those can be overwritten by the agents.
 */
import fs from "node:fs";
import path from "node:path";
import type { SessionRecord } from "../types.js";
import { dataDir } from "./paths.js";

const HEADER = "source,id,title,updated_at\n";

export interface TitleRow {
  source: string;
  id: string;
  title: string;
  updatedAt: string;
}

/** Absolute path to the titles CSV. */
export function titleStorePath(): string {
  return path.join(dataDir(), "session-titles.csv");
}

export function titleKey(source: string, id: string): string {
  return `${source}:${id}`;
}

function escapeField(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Minimal RFC4180 line split (handles quoted commas). */
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
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function ensureStore(): void {
  const p = titleStorePath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, HEADER, "utf8");
}

/** Load all title rows (order preserved as file). */
export function loadTitleRows(): TitleRow[] {
  ensureStore();
  const text = fs.readFileSync(titleStorePath(), "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: TitleRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i === 0 && /^source\s*,\s*id\s*,/i.test(line)) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 3) continue;
    const [source, id, title, updatedAt] = cols;
    if (!source?.trim() || !id?.trim() || title == null) continue;
    rows.push({
      source: source.trim(),
      id: id.trim(),
      title: title,
      updatedAt: (updatedAt ?? "").trim() || new Date().toISOString(),
    });
  }
  return rows;
}

export function loadTitleMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of loadTitleRows()) {
    map.set(titleKey(r.source, r.id), r.title);
  }
  return map;
}

/** Apply CSV overrides onto discovered sessions (mutates title in place). */
export function applyTitleOverrides(
  sessions: SessionRecord[],
): SessionRecord[] {
  const map = loadTitleMap();
  if (map.size === 0) return sessions;
  for (const s of sessions) {
    const t = map.get(titleKey(s.source, s.id));
    if (t != null && t.trim()) {
      s.title = t;
      s.extra = { ...s.extra, titleSource: "csv", titleOverride: true };
    }
  }
  return sessions;
}

/**
 * Upsert one title into the CSV (rewrite whole file atomically).
 * Empty title removes the override (reverts to agent-native title on next load).
 */
export function setTitleOverride(
  source: string,
  id: string,
  title: string,
): { ok: boolean; error?: string; title?: string; path: string } {
  const storePath = titleStorePath();
  const cleaned = title.replace(/\s+/g, " ").trim();
  if (!source || !id) {
    return { ok: false, error: "missing source/id", path: storePath };
  }
  if (cleaned.length > 200) {
    return { ok: false, error: "title too long (max 200)", path: storePath };
  }

  try {
    ensureStore();
    const rows = loadTitleRows().filter(
      (r) => !(r.source === source && r.id === id),
    );
    if (cleaned) {
      rows.push({
        source,
        id,
        title: cleaned,
        updatedAt: new Date().toISOString(),
      });
    }
    rows.sort((a, b) => {
      const c = a.source.localeCompare(b.source);
      return c !== 0 ? c : a.id.localeCompare(b.id);
    });

    const body =
      HEADER +
      rows
        .map(
          (r) =>
            [
              escapeField(r.source),
              escapeField(r.id),
              escapeField(r.title),
              escapeField(r.updatedAt),
            ].join(",") + "\n",
        )
        .join("");

    const dir = path.dirname(storePath);
    const tmp = path.join(dir, `.session-titles.${process.pid}.tmp`);
    fs.writeFileSync(tmp, body, "utf8");
    fs.renameSync(tmp, storePath);

    return cleaned
      ? { ok: true, title: cleaned, path: storePath }
      : { ok: true, path: storePath };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      path: storePath,
    };
  }
}
