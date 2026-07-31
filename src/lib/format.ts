import type { SessionHealth, SessionRecord } from "../types.js";
import { formatAge } from "./time.js";
import { healthBadge } from "./health.js";
import { padEndWidth, padStartWidth } from "./width.js";

export function shortId(id: string, n = 8): string {
  return id.length <= n ? id : id.slice(0, n);
}

export { padEndWidth, padStartWidth };

/** Fixed column widths (display columns). */
export const COL = {
  st: 8, // OK / Empty / Missing
  source: 7,
  age: 5,
  msgs: 5,
  title: 36,
  cwd: 26,
  id: 10,
} as const;

function sessionHealth(s: SessionRecord): SessionHealth {
  return s.health ?? "ok";
}

function adaptiveTitleCwd(): { title: number; cwd: number } {
  const cols =
    process.stdout.columns || Number(process.env.COLUMNS) || 120;
  const fixed =
    COL.st + COL.source + COL.age + COL.msgs + COL.id + 7;
  const rest = Math.max(28, cols - fixed - 4);
  const title = Math.max(16, Math.min(48, Math.floor(rest * 0.58)));
  const cwd = Math.max(12, Math.min(36, rest - title));
  return { title, cwd };
}

/** Aligned row for TUI (no box borders). Pass `now` to freeze relative ages. */
export function formatRowLine(
  s: SessionRecord,
  titleW: number,
  cwdW: number,
  now?: number,
): string {
  const h = sessionHealth(s);
  return [
    padEndWidth(healthBadge(h), COL.st),
    padEndWidth(s.source, COL.source),
    padStartWidth(formatAge(s.lastActive, now), COL.age),
    padStartWidth(String(s.messageCount), COL.msgs),
    padEndWidth(s.title.replace(/\s+/g, " "), titleW),
    padEndWidth(formatResumeDirCell(s), cwdW),
    padEndWidth(shortId(s.id, COL.id), COL.id),
  ].join(" ");
}

export function formatHeaderLine(titleW: number, cwdW: number): string {
  return [
    padEndWidth("STATUS", COL.st),
    padEndWidth("SOURCE", COL.source),
    padStartWidth("AGE", COL.age),
    padStartWidth("MSGS", COL.msgs),
    padEndWidth("TITLE", titleW),
    padEndWidth("RESUME DIR", cwdW),
    padEndWidth("ID", COL.id),
  ].join(" ");
}

/** Resume-dir column: always show original path; mark missing with ✗ */
export function formatResumeDirCell(s: SessionRecord): string {
  if (!s.cwd) return "(none)";
  if (s.extra?.cwdMissing) return `✗ ${s.cwd}`;
  return s.cwd;
}

/** Plain table (non-TTY fallback). */
export function formatTable(sessions: SessionRecord[]): string {
  const { title: titleW, cwd: cwdW } = adaptiveTitleCwd();
  const mkBorder = (l: string, m: string, r: string) =>
    l +
    [
      "─".repeat(COL.st),
      "─".repeat(COL.source),
      "─".repeat(COL.age),
      "─".repeat(COL.msgs),
      "─".repeat(titleW),
      "─".repeat(cwdW),
      "─".repeat(COL.id),
    ].join(m) +
    r;

  const mkRow = (
    st: string,
    source: string,
    age: string,
    msgs: string,
    title: string,
    cwd: string,
    id: string,
  ) =>
    "│" +
    padEndWidth(st, COL.st) +
    "│" +
    padEndWidth(source, COL.source) +
    "│" +
    padStartWidth(age, COL.age) +
    "│" +
    padStartWidth(msgs, COL.msgs) +
    "│" +
    padEndWidth(title, titleW) +
    "│" +
    padEndWidth(cwd, cwdW) +
    "│" +
    padEndWidth(id, COL.id) +
    "│";

  const out: string[] = [];
  out.push(mkBorder("┌", "┬", "┐"));
  out.push(mkRow("STATUS", "SOURCE", "AGE", "MSGS", "TITLE", "RESUME DIR", "ID"));
  out.push(mkBorder("├", "┼", "┤"));
  for (const s of sessions) {
    const h = sessionHealth(s);
    out.push(
      mkRow(
        healthBadge(h),
        s.source,
        formatAge(s.lastActive),
        String(s.messageCount),
        s.title.replace(/\s+/g, " "),
        formatResumeDirCell(s),
        shortId(s.id, COL.id),
      ),
    );
  }
  out.push(mkBorder("└", "┴", "┘"));
  const nOk = sessions.filter((s) => sessionHealth(s) === "ok").length;
  const nEmpty = sessions.filter((s) => sessionHealth(s) === "empty").length;
  const nMiss = sessions.filter((s) => sessionHealth(s) === "missing").length;
  out.push(
    `${sessions.length} session(s)  ·  OK ${nOk}  ·  Empty ${nEmpty}  ·  Missing ${nMiss}`,
  );
  out.push(
    "Note: RESUME DIR = project path at start; Qoder requires that dir; Grok/Claude ID work anywhere; Missing keeps path text",
  );
  return out.join("\n");
}

function shellQuote(p: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(p)) return p;
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

export interface ResumeInfo {
  /** Shell command to copy-run (the only user-facing resume affordance) */
  command: string;
  /**
   * Path binding (internal / future use — not shown as a preachy Note in UI):
   * - required: must be in resume dir (Qoder; baked into command via `cd`)
   * - recommended: UUID works anywhere (Grok / Claude)
   * - unknown: no path recorded
   */
  pathMode: "required" | "recommended" | "unknown";
}

/**
 * Source-specific resume command.
 * Qoder: embed `cd` in the command. Grok/Claude: ID resume is global.
 * Do not surface tutorial notes in the UI — the command is enough.
 */
export function resumeInfo(s: SessionRecord): ResumeInfo {
  const dir = s.cwd;

  if (s.source === "qoder") {
    if (dir) {
      return {
        command: `cd ${shellQuote(dir)} && qodercli -r ${s.id}`,
        pathMode: "required",
      };
    }
    return { command: `qodercli -r ${s.id}`, pathMode: "unknown" };
  }

  if (s.source === "grok") {
    return {
      command: `grok --resume ${s.id}`,
      pathMode: dir ? "recommended" : "unknown",
    };
  }

  if (s.source === "claude") {
    return {
      command: `claude --resume ${s.id}`,
      pathMode: dir ? "recommended" : "unknown",
    };
  }

  return {
    command: `(no resume command for ${s.source})`,
    pathMode: "unknown",
  };
}

/** Command line only (status bar / compact). */
export function resumeHint(s: SessionRecord): string {
  // Prefer freshly computed source-specific logic over stale extra.resume
  return resumeInfo(s).command;
}
