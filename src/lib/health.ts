import fs from "node:fs";
import type { SessionRecord } from "../types.js";

/** Visual / operational health of a session for the list UI. */
export type SessionHealth = "ok" | "empty" | "missing";

export interface SessionFlags {
  health: SessionHealth;
  /** Working directory is set but not present on disk */
  cwdMissing: boolean;
  /** Session store path (jsonl / dir) missing — rare after discover */
  storeMissing: boolean;
  /** No real conversation content */
  isEmpty: boolean;
}

function pathExists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Classify session:
 * - `missing` — resume dir recorded but gone on disk (or store missing)
 * - `empty`   — zero messages
 * - `ok`      — has content and paths look fine
 *
 * When both empty and missing: prefer `missing`.
 */
export function inspectSession(s: SessionRecord): SessionFlags {
  const cwdMissing =
    typeof s.cwd === "string" && s.cwd.length > 0 && !pathExists(s.cwd);
  const storeMissing = !pathExists(s.path);
  const isEmpty = s.messageCount <= 0;

  let health: SessionHealth = "ok";
  if (cwdMissing || storeMissing) health = "missing";
  else if (isEmpty) health = "empty";

  return { health, cwdMissing, storeMissing, isEmpty };
}

export function enrichSessions(sessions: SessionRecord[]): SessionRecord[] {
  return sessions.map((s) => {
    const flags = inspectSession(s);
    return {
      ...s,
      health: flags.health,
      extra: {
        ...s.extra,
        cwdMissing: flags.cwdMissing,
        storeMissing: flags.storeMissing,
        isEmpty: flags.isEmpty,
      },
    };
  });
}

/** Short filter label */
export function healthLabel(h: SessionHealth): string {
  switch (h) {
    case "ok":
      return "OK";
    case "empty":
      return "Empty";
    case "missing":
      return "Missing";
  }
}

/** Status badge text (pad to COL.st in UI) */
export function healthBadge(h: SessionHealth): string {
  switch (h) {
    case "ok":
      return "OK";
    case "empty":
      return "Empty";
    case "missing":
      return "Missing";
  }
}

/** One-line explanation */
export function healthExplain(h: SessionHealth): string {
  switch (h) {
    case "ok":
      return "Has messages; resume dir still exists";
    case "empty":
      return "0 messages; nothing to continue";
    case "missing":
      return "Resume dir gone on disk (path text kept)";
  }
}

/**
 * Attribute matchers for bulk select (:empty / :missing / :bad).
 * Independent of exclusive `health` (missing wins over empty in the badge).
 */
export function sessionIsEmpty(s: SessionRecord): boolean {
  if (s.extra?.isEmpty === true) return true;
  if (s.extra?.isEmpty === false) return false;
  return s.messageCount <= 0;
}

export function sessionIsMissing(s: SessionRecord): boolean {
  if (s.extra?.cwdMissing === true || s.extra?.storeMissing === true)
    return true;
  return (s.health ?? "ok") === "missing";
}

export type BulkHealthMode = "empty" | "missing" | "unhealthy";

export function matchesBulkHealth(
  s: SessionRecord,
  mode: BulkHealthMode,
): boolean {
  const empty = sessionIsEmpty(s);
  const missing = sessionIsMissing(s);
  if (mode === "empty") return empty;
  if (mode === "missing") return missing;
  return empty || missing;
}
