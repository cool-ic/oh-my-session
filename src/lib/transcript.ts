/**
 * Read human-readable conversation turns from agent session stores.
 * Order returned: **newest first** (近 → 远).
 */
import fs from "node:fs";
import path from "node:path";
import type { SessionRecord } from "../types.js";
import { contentToText, isGeneratedMetaText } from "./jsonl-text.js";

export type TurnRole = "user" | "assistant" | "thought" | "tool";

export interface TranscriptTurn {
  role: TurnRole;
  text: string;
  /** ISO or display time if known */
  at?: string | null;
}

function pushMerged(
  out: TranscriptTurn[],
  role: TurnRole,
  text: string,
  at?: string | null,
): void {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (!t) return;
  if (role === "user" && isGeneratedMetaText(t)) return;
  const last = out[out.length - 1];
  if (last && last.role === role) {
    last.text = (last.text + "\n" + t).trim();
    if (at) last.at = at;
    return;
  }
  out.push({ role, text: t, at: at ?? null });
}

function readGrokUpdates(sessionDir: string): TranscriptTurn[] {
  const p = path.join(sessionDir, "updates.jsonl");
  if (!fs.existsSync(p)) return [];
  const chronological: TranscriptTurn[] = [];
  let text: string;
  try {
    text = fs.readFileSync(p, "utf8");
  } catch {
    return [];
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let obj: {
      timestamp?: number;
      params?: {
        update?: {
          sessionUpdate?: string;
          content?: { type?: string; text?: string } | unknown;
          title?: string;
        };
      };
    };
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const u = obj.params?.update;
    if (!u?.sessionUpdate) continue;
    const kind = u.sessionUpdate;
    const ts =
      typeof obj.timestamp === "number"
        ? new Date(
            Math.abs(obj.timestamp) < 1e12
              ? obj.timestamp * 1000
              : obj.timestamp,
          ).toISOString()
        : null;

    if (kind === "user_message_chunk" || kind === "agent_message_chunk") {
      const c = u.content as { text?: string } | undefined;
      const piece = typeof c?.text === "string" ? c.text : contentToText(u.content);
      const role: TurnRole =
        kind === "user_message_chunk" ? "user" : "assistant";
      pushMerged(chronological, role, piece, ts);
    } else if (kind === "agent_thought_chunk") {
      // view-only chat: skip thoughts
      void u;
    } else if (kind === "tool_call") {
      // view-only chat: skip tool calls (对话 only)
      void u;
    }
  }
  return chronological.reverse();
}

function readJsonlUserAssistant(filePath: string): TranscriptTurn[] {
  if (!fs.existsSync(filePath)) return [];
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const chronological: TranscriptTurn[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let obj: {
      type?: string;
      isMeta?: boolean;
      timestamp?: string;
      message?: { content?: unknown; role?: string };
    };
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.isMeta) continue;
    const t = obj.type;
    if (t !== "user" && t !== "assistant") continue;
    const piece = contentToText(obj.message?.content);
    if (!piece.trim()) continue;
    pushMerged(
      chronological,
      t === "user" ? "user" : "assistant",
      piece,
      typeof obj.timestamp === "string" ? obj.timestamp : null,
    );
  }
  return chronological.reverse();
}

/**
 * Load turns for a session, newest first.
 * @param maxChars soft cap on total text to avoid huge files freezing TUI
 */
export function readTranscript(
  s: SessionRecord,
  opts?: { maxTurns?: number; maxChars?: number },
): TranscriptTurn[] {
  const maxTurns = opts?.maxTurns ?? 200;
  const maxChars = opts?.maxChars ?? 200_000;

  let turns: TranscriptTurn[] = [];
  try {
    if (s.source === "grok") {
      const dir = s.path.endsWith(".jsonl") ? path.dirname(s.path) : s.path;
      turns = readGrokUpdates(dir);
    } else if (s.source === "qoder" || s.source === "claude") {
      let p = s.path;
      if (!p.endsWith(".jsonl")) {
        const cand = path.join(p, `${s.id}.jsonl`);
        if (fs.existsSync(cand)) p = cand;
      }
      turns = readJsonlUserAssistant(p);
    }
  } catch {
    return [];
  }

  // Soft cap: keep newest turns within char budget
  const out: TranscriptTurn[] = [];
  let chars = 0;
  for (const turn of turns) {
    if (out.length >= maxTurns) break;
    chars += turn.text.length;
    if (chars > maxChars && out.length > 0) break;
    out.push(turn);
  }
  return out;
}

export function roleLabel(role: TurnRole): string {
  switch (role) {
    case "user":
      return "You";
    case "assistant":
      return "Agent";
    case "thought":
      return "Think";
    case "tool":
      return "Tool";
  }
}
