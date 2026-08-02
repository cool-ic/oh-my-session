/**
 * Rename session display title.
 *
 * Stored in this repo as CSV (data/session-titles.csv) — stable and independent
 * of Grok / Claude / Qoder native formats that agents may overwrite.
 */
import type { SessionRecord } from "../types.js";
import { setTitleOverride, titleStorePath } from "./title-store.js";

export interface RenameResult {
  id: string;
  source: string;
  ok: boolean;
  error?: string;
  title?: string;
  /** Path of the CSV store */
  path?: string;
}

/** Persist new title to local CSV. Does not mutate agent native stores. */
export function renameSession(
  s: SessionRecord,
  newTitle: string,
): RenameResult {
  const base = {
    id: s.id,
    source: s.source,
    ok: false as boolean,
    path: titleStorePath(),
  };

  const result = setTitleOverride(s.source, s.id, newTitle);
  if (!result.ok) {
    return { ...base, error: result.error ?? "write failed" };
  }
  if (!result.title) {
    return { ...base, error: "empty title" };
  }
  return {
    ...base,
    ok: true,
    title: result.title,
    path: result.path,
  };
}
