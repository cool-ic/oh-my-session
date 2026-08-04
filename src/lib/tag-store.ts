/**
 * Single tag per session (= group). CSV in this repo.
 *
 * ~/.config/oms/session-tags.csv: source,id,tag,updated_at
 */
import fs from "node:fs";
import path from "node:path";
import type { SessionRecord } from "../types.js";
import { dataDir } from "./paths.js";

const HEADER = "source,id,tag,updated_at\n";
export const TAG_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function tagStorePath(): string {
  return path.join(dataDir(), "session-tags.csv");
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
  const p = tagStorePath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, HEADER, "utf8");
}

export function normalizeTagName(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!t || !TAG_NAME_RE.test(t)) return null;
  return t;
}

/** Map source:id → tag */
export function loadTagMap(): Map<string, string> {
  ensureStore();
  const map = new Map<string, string>();
  const text = fs.readFileSync(tagStorePath(), "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i === 0 && /^source\s*,\s*id\s*,/i.test(line)) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 3) continue;
    const source = cols[0]?.trim();
    const id = cols[1]?.trim();
    const tag = cols[2]?.trim().toLowerCase();
    if (!source || !id || !tag) continue;
    map.set(`${source}:${id}`, tag);
  }
  return map;
}

/** All distinct tags (sorted), GC-ing rows whose ids are optional. */
export function listTags(): string[] {
  const set = new Set<string>();
  for (const t of loadTagMap().values()) set.add(t);
  return [...set].sort();
}

export function sessionTag(s: SessionRecord): string | null {
  const t = s.extra?.tag;
  return typeof t === "string" && t ? t : null;
}

/** Apply map onto sessions; drop orphan CSV rows when knownIds provided. */
export function applyTags(
  sessions: SessionRecord[],
  gcOrphans = true,
): SessionRecord[] {
  const map = loadTagMap();
  const live = new Set(sessions.map((s) => `${s.source}:${s.id}`));
  for (const s of sessions) {
    const t = map.get(`${s.source}:${s.id}`);
    if (t) s.extra = { ...s.extra, tag: t };
    else if (s.extra?.tag) {
      const { tag: _drop, ...rest } = s.extra;
      s.extra = rest;
    }
  }
  if (gcOrphans) {
    let dirty = false;
    for (const k of map.keys()) {
      if (!live.has(k)) {
        map.delete(k);
        dirty = true;
      }
    }
    if (dirty) writeTagMap(map);
  }
  return sessions;
}

function writeTagMap(map: Map<string, string>): void {
  ensureStore();
  const rows = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const at = new Date().toISOString();
  let body = HEADER;
  for (const [key, tag] of rows) {
    const i = key.indexOf(":");
    if (i < 0) continue;
    const source = key.slice(0, i);
    const id = key.slice(i + 1);
    body +=
      [
        escapeField(source),
        escapeField(id),
        escapeField(tag),
        escapeField(at),
      ].join(",") + "\n";
  }
  const p = tagStorePath();
  const tmp = path.join(path.dirname(p), `.session-tags.${process.pid}.tmp`);
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, p);
}

/** Set or clear tag for one session. tag=null clears. */
export function setSessionTag(
  source: string,
  id: string,
  tag: string | null,
): { ok: boolean; tag: string | null; error?: string } {
  try {
    const map = loadTagMap();
    const k = `${source}:${id}`;
    if (tag == null || tag === "") {
      map.delete(k);
      writeTagMap(map);
      return { ok: true, tag: null };
    }
    const n = normalizeTagName(tag);
    if (!n) return { ok: false, tag: null, error: "invalid tag name" };
    map.set(k, n);
    writeTagMap(map);
    return { ok: true, tag: n };
  } catch (e) {
    return {
      ok: false,
      tag: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
