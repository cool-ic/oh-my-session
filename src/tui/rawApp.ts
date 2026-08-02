/**
 * Differential TUI — brand header + data table + detail pane.
 *
 * Columns (display width):
 *   mark2 | status8 | source6 | age5 | msgs5 | title flex | resumeDir flex
 *
 * Keys: ↑↓ Enter Space i gg G dd u y / : … ctrl-f/b H M L
 * Enter = open chat message list (previews); Enter again = full text;
 * Space = toggle multi-select; i = rename title (insert);
 * :empty / :missing / :bad = bulk-select by health (ex cmdline);
 * dd = mark selection (or cursor) for delete; :wq applies deletes & exits;
 * :q quits if no pending deletes; :q! discards marks and quits.
 * Auto-refresh every 8s when reload is provided.
 */
import readline from "node:readline";
import type { AgentSource, SessionHealth, SessionRecord } from "../types.js";
import { formatAge } from "../lib/time.js";
import { resumeHint, resumeInfo, shortId } from "../lib/format.js";
import { deleteSessions } from "../lib/delete-session.js";
import { renameSession } from "../lib/rename-session.js";
import {
  matchesBulkHealth,
  type BulkHealthMode,
} from "../lib/health.js";
import { isStarred, toggleStar } from "../lib/star-store.js";
import {
  listTags,
  normalizeTagName,
  sessionTag,
  setSessionTag,
} from "../lib/tag-store.js";
import {
  readTranscript,
  type TranscriptTurn,
} from "../lib/transcript.js";
import { sortKeyLastActive } from "../lib/time.js";
import {
  displayWidth,
  padEndWidth,
  padStartWidth,
  truncateWidth,
} from "../lib/width.js";
import { theme } from "./theme.js";

/** Session list auto-refresh interval */
const REFRESH_MS = 8000;

export interface RawTuiOptions {
  /** Re-discover + enrich sessions (used every REFRESH_MS) */
  reload?: () => SessionRecord[];
}

/** Grouped key help for :help overlay */
const HELP_GROUPS: ReadonlyArray<{ title: string; keys: [string, string][] }> =
  [
    {
      title: "Move",
      keys: [
        ["↑ / ↓", "Move cursor in focused pane"],
        ["gg / G", "Top / bottom of session list"],
        ["H / M / L", "Screen top / middle / bottom"],
        ["PgUp / PgDn", "Page up / down"],
        ["Ctrl-f / Ctrl-b", "Page down / up"],
        ["z", "Center cursor in viewport"],
        ["Tab", "Focus tags rail ↔ session list"],
      ],
    },
    {
      title: "Tags (left rail)",
      keys: [
        ["Tab", "Enter / leave tags rail"],
        ["↑↓ (in tags)", "Select tag · filter sessions (all = everything)"],
        ["Enter (in tags)", "Keep filter · return to sessions"],
        ["t", "Assign tag for current session"],
        ["  · ↑↓", "Pick existing tag or (clear)"],
        ["  · type in +new", "Create tag and assign (a-z 0-9 _ -)"],
        ["  · Enter / Esc", "Confirm / cancel assign"],
      ],
    },
    {
      title: "Session row",
      keys: [
        ["Enter", "Open chat in right pane (near→far, newest first)"],
        ["Space", "Toggle multi-select (* mark)"],
        ["*", "Star / unstar — pin top; blocks dd"],
        ["i", "Rename title (inline; Esc/Enter save to CSV)"],
        ["dd", "Mark delete (skipped if starred; apply on :wq)"],
        ["u", "Undo last delete mark"],
        ["y / yy / r", "Copy resume command (show in footer)"],
      ],
    },
    {
      title: "Chat (right pane)",
      keys: [
        ["Enter (session)", "Open message list (preview, near→far)"],
        ["↑ / ↓", "Move in message list · scroll when expanded"],
        ["Enter (list row)", "Expand full text of that message"],
        ["Esc", "Collapse full → list · or list → sessions"],
      ],
    },
    {
      title: "Search & filters",
      keys: [
        ["/", "Search title / id / path (vim-style)"],
        ["  · Enter", "Apply search"],
        ["  · Esc", "Abort · restore previous"],
        ["  · BS empty", "Exit search"],
        ["s", "Cycle source filter"],
        ["h", "Cycle health filter (ok/empty/missing)"],
        ["c", "Clear all filters + multi-select + tag filter"],
      ],
    },
    {
      title: "Bulk select (:)",
      keys: [
        [":empty / :emp", "Select all empty sessions"],
        [":missing / :mis", "Select all missing-path sessions"],
        [":bad", "Select empty + missing"],
        [":sel e|m|bad|none", "Same via :sel family"],
      ],
    },
    {
      title: "Quit (:)",
      keys: [
        [":q", "Quit if no pending deletes"],
        [":q!", "Quit · discard pending deletes"],
        [":wq / :x", "Apply deletes and quit"],
        [":help / :h / :?", "This help"],
      ],
    },
    {
      title: "Notes",
      keys: [
        ["Titles", "data/session-titles.csv (local)"],
        ["Stars", "data/session-stars.csv — pin + no dd"],
        ["Tags", "data/session-tags.csv — one tag per session"],
        ["Refresh", "Auto re-scan every 8s (skipped while typing)"],
      ],
    },
  ];

const SOURCES: Array<AgentSource | "all"> = [
  "all",
  "grok",
  "qoder",
  "claude",
  "codex",
  "cursor",
];
const HEALTH_FILTERS: Array<SessionHealth | "all"> = [
  "all",
  "ok",
  "empty",
  "missing",
];

/**
 * Fixed column widths (display cols).
 * mark | star (padded) | gap | status | … — star not glued to STATUS.
 */
const LC = {
  mark: 2, // cursor ▌ + multi *
  star: 3, // " ★ " or "   "
  gs: 1, // gap after star before STATUS
  status: 8,
  g1: 1,
  source: 6,
  g2: 1,
  age: 5,
  g3: 1,
  msgs: 5,
  g4: 1,
  g5: 1,
} as const;
const LC_FIXED =
  LC.mark +
  LC.star +
  LC.gs +
  LC.status +
  LC.g1 +
  LC.source +
  LC.g2 +
  LC.age +
  LC.g3 +
  LC.msgs +
  LC.g4 +
  LC.g5;

const ESC = "\x1b";
const TOOL_NAME = "oh-my-sessions";

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [200, 200, 200];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Default cell style: body text on our dark canvas (not terminal white). */
function sgrDefault(): string {
  const [fr, fg_, fb] = hexRgb(theme.text);
  const [br, bg_, bb] = hexRgb(theme.canvas);
  return `${ESC}[0m${ESC}[38;2;${fr};${fg_};${fb}m${ESC}[48;2;${br};${bg_};${bb}m`;
}

/**
 * Foreground on canvas. Always pairs with canvas BG so light terminals
 * do not show pale-on-white garbage after RESET.
 */
function fg(hex: string, text: string): string {
  const [r, g, b] = hexRgb(hex);
  const [br, bg_, bb] = hexRgb(theme.canvas);
  return `${ESC}[38;2;${r};${g};${b}m${ESC}[48;2;${br};${bg_};${bb}m${text}${sgrDefault()}`;
}

function fgBg(fgHex: string, bgHex: string, text: string): string {
  const [fr, fg_, fb] = hexRgb(fgHex);
  const [br, bg_, bb] = hexRgb(bgHex);
  return `${ESC}[38;2;${fr};${fg_};${fb}m${ESC}[48;2;${br};${bg_};${bb}m${text}${sgrDefault()}`;
}

function hideCursor(): string {
  return `${ESC}[?25l`;
}
function showCursor(): string {
  return `${ESC}[?25h`;
}
function altEnter(): string {
  // Enter alt screen already in our default FG/BG
  return `${ESC}[?1049h${sgrDefault()}${ESC}[H${ESC}[2J`;
}
function altLeave(): string {
  return `${ESC}[0m${ESC}[?1049l`;
}
function move(row: number, col = 1): string {
  return `${ESC}[${row};${col}H`;
}
/** Erase line using current (canvas) background */
function clearLine(): string {
  return `${ESC}[2K`;
}

function healthOf(s: SessionRecord): SessionHealth {
  return s.health ?? "ok";
}

function healthFilterName(h: SessionHealth | "all"): string {
  switch (h) {
    case "all":
      return "All";
    case "ok":
      return "OK";
    case "empty":
      return "Empty";
    case "missing":
      return "Missing";
  }
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function visWidth(s: string): number {
  return displayWidth(stripAnsi(s));
}

function clipAnsi(s: string, maxCols: number): string {
  const limit = Math.max(0, maxCols);
  if (visWidth(s) <= limit) return s + sgrDefault();
  let out = "";
  let w = 0;
  let i = 0;
  const budget = Math.max(0, limit - 1);
  while (i < s.length) {
    if (s[i] === "\x1b" && s[i + 1] === "[") {
      const end = s.indexOf("m", i);
      if (end === -1) break;
      out += s.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    const cp = s.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const cw = displayWidth(ch);
    if (w + cw > budget) break;
    out += ch;
    w += cw;
    i += ch.length;
  }
  return out + "…" + sgrDefault();
}

function padAnsi(s: string, width: number): string {
  const clipped = clipAnsi(s, width);
  const pad = width - visWidth(clipped);
  // Trailing spaces must keep canvas BG (not terminal white)
  if (pad <= 0) return clipped;
  return clipped + fg(theme.text, " ".repeat(pad));
}

function statusChip(h: SessionHealth): string {
  const label = h === "ok" ? "OK" : h === "empty" ? "Empty" : "Missing";
  const plain = padEndWidth(label, LC.status);
  if (h === "ok") return fgBg(theme.pill.okFg, theme.pill.okBg, plain);
  if (h === "empty") return fgBg(theme.pill.emptyFg, theme.pill.emptyBg, plain);
  return fgBg(theme.pill.missingFg, theme.pill.missingBg, plain);
}

function sourcePlain(src: AgentSource): string {
  const label =
    src === "grok"
      ? "Grok"
      : src === "qoder"
        ? "Qoder"
        : src === "claude"
          ? "Claude"
          : src.slice(0, LC.source);
  return padEndWidth(label, LC.source);
}

function sourceCell(src: AgentSource): string {
  return fg(theme.source[src] ?? theme.dim, sourcePlain(src));
}

function boxTop(title: string, width: number): string {
  const inner = Math.max(2, width - 2);
  const t = ` ${title} `;
  const tw = displayWidth(t);
  if (tw >= inner) return "┌" + truncateWidth(t, inner) + "┐";
  const rest = inner - tw;
  const left = 1;
  const right = rest - left;
  return "┌" + "─".repeat(left) + t + "─".repeat(Math.max(0, right)) + "┐";
}

function boxBot(width: number): string {
  return "└" + "─".repeat(Math.max(2, width - 2)) + "┘";
}

interface Layout {
  cols: number;
  rows: number;
  split: boolean;
  /** Left tag rail width */
  tagW: number;
  /** 1-based column where session table starts */
  listCol: number;
  listW: number;
  detailW: number;
  detailCol: number;
  titleW: number;
  pathW: number;
  page: number;
  rowBrand: number;
  rowRuleBrand: number;
  rowColHead: number;
  rowRuleHead: number;
  rowList0: number;
  rowDetail0: number;
  rowRuleFoot: number;
  rowFooter: number;
  detailBodyRows: number;
}

/**
 * Geometry:  [ tags | list | detail? ]
 * Vertical: brand / rules / colHead / list / footer
 */
function computeLayout(cols: number, rows: number): Layout {
  const split = cols >= 120;
  const rowBrand = 1;
  const rowRuleBrand = 2;
  const rowColHead = 3;
  const rowRuleHead = 4;
  const rowList0 = 5;
  const rowFooter = rows;
  const rowRuleFoot = rows - 1;
  const chrome = 6;
  const tagW = Math.min(14, Math.max(11, Math.floor(cols * 0.12)));
  const gutter = 1;
  const afterTag = Math.max(40, cols - tagW - gutter);
  const listCol = tagW + gutter + 1;

  if (split) {
    let detailW = Math.min(40, Math.max(32, Math.floor(afterTag * 0.34)));
    let listW = afterTag - detailW - gutter;
    if (listW < LC_FIXED + 16) {
      listW = LC_FIXED + 16;
      detailW = Math.max(26, afterTag - listW - gutter);
    }
    const rest = Math.max(12, listW - LC_FIXED);
    const titleW = Math.max(10, Math.floor(rest * 0.52));
    const pathW = Math.max(8, rest - titleW);
    const page = Math.max(6, rows - chrome);
    return {
      cols,
      rows,
      split: true,
      tagW,
      listCol,
      listW,
      detailW,
      detailCol: listCol + listW + 1,
      titleW,
      pathW,
      page,
      rowBrand,
      rowRuleBrand,
      rowColHead,
      rowRuleHead,
      rowList0,
      rowDetail0: rowList0,
      rowRuleFoot,
      rowFooter,
      detailBodyRows: page,
    };
  }

  const detailBodyRows = 7;
  const detailBox = 2 + detailBodyRows;
  const page = Math.max(5, rows - chrome - detailBox + 1);
  const listW = afterTag;
  const rest = Math.max(12, listW - LC_FIXED);
  const titleW = Math.max(10, Math.floor(rest * 0.55));
  const pathW = Math.max(8, rest - titleW);
  return {
    cols,
    rows,
    split: false,
    tagW,
    listCol,
    listW,
    detailW: listW,
    detailCol: listCol,
    titleW,
    pathW,
    page,
    rowBrand,
    rowRuleBrand,
    rowColHead,
    rowRuleHead,
    rowList0,
    rowDetail0: rowList0 + page,
    rowRuleFoot,
    rowFooter,
    detailBodyRows,
  };
}

export async function runRawTui(
  initialSessions: SessionRecord[],
  options: RawTuiOptions = {},
): Promise<void> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("need TTY");

  let allSessions = initialSessions;
  let now = Date.now();
  let cols = stdout.columns || 80;
  let rows = stdout.rows || 24;
  let layout = computeLayout(cols, rows);

  let filter = "";
  /** vim `/` search — typing filters live; not part of the buffer itself */
  let filterMode = false;
  /** Snapshot when `/` was opened; Esc restores (vim abort search) */
  let filterBeforeSearch = "";
  /** vim cmdline: after `:` until Enter */
  let cmdMode = false;
  let cmdBuf = "";
  /** i — rename current session title (insert mode) */
  let renameMode = false;
  let renameBuf = "";
  /** Title when edit started — used only if empty commit */
  let renameOrig = "";
  let sourceIdx = 0;
  let healthIdx = 0;
  let cursor = 0;
  let offset = 0;
  let statusLine = "";
  /** Focus: session table | left tag rail | right detail (chat scroll) */
  let focusPane: "sessions" | "tags" | "detail" = "sessions";
  /** null = all */
  let tagFilter: string | null = null;
  let tagCursor = 0;
  let tagOffset = 0;
  /** t — assign tag to current session via left rail */
  let tagAssignMode = false;
  let tagAssignCursor = 0;
  let tagAssignBuf = "";
  let tagAssignKey: string | null = null;
  /** :help overlay */
  let helpMode = false;
  let helpOffset = 0;
  /**
   * Detail panel: meta | chat list (1-line previews) | expanded full message.
   * Session Enter → list; list Enter → full; Esc full→list→sessions.
   */
  let detailView: "meta" | "chat" = "meta";
  let chatTurns: TranscriptTurn[] = [];
  let chatLines: string[] = []; // painted rows for current chat mode
  let chatOffset = 0;
  let chatCursor = 0; // index into chatTurns (list mode)
  /** null = list previews; number = full text of that turn index */
  let chatExpandIdx: number | null = null;
  let chatSessionKey: string | null = null;
  /** dd marks for real delete on :wq */
  const pendingDelete = new Map<string, SessionRecord>();
  const undoStack: SessionRecord[] = [];
  /** Space multi-select (source:id keys). dd acts on all when non-empty. */
  const multiSelect = new Set<string>();
  /** vim multi-key: d / g / y */
  let pending: null | "d" | "g" | "y" = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  function sessionKey(s: SessionRecord): string {
    return `${s.source}:${s.id}`;
  }

  /** Sidebar labels: index 0 = all, then sorted tags */
  function tagRailLabels(): string[] {
    return ["all", ...listTags()];
  }

  function clampTagScroll(): void {
    const n = tagRailLabels().length;
    if (tagCursor >= n) tagCursor = Math.max(0, n - 1);
    if (tagCursor < tagOffset) tagOffset = tagCursor;
    if (tagCursor >= tagOffset + layout.page)
      tagOffset = tagCursor - layout.page + 1;
    tagOffset = Math.max(0, Math.min(Math.max(0, n - layout.page), tagOffset));
  }

  function filteredList(): SessionRecord[] {
    const sourceFilter = SOURCES[sourceIdx];
    const healthFilter = HEALTH_FILTERS[healthIdx];
    const q = filter.trim().toLowerCase();
    const out = allSessions.filter((s) => {
      if (pendingDelete.has(sessionKey(s))) return false;
      if (sourceFilter !== "all" && s.source !== sourceFilter) return false;
      if (healthFilter !== "all" && healthOf(s) !== healthFilter) return false;
      if (tagFilter != null && sessionTag(s) !== tagFilter) return false;
      if (!q) return true;
      return [s.title, s.id, s.cwd ?? "", s.source, sessionTag(s) ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    out.sort((a, b) => {
      const sa = isStarred(a) ? 0 : 1;
      const sb = isStarred(b) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return sortKeyLastActive(b.lastActive) - sortKeyLastActive(a.lastActive);
    });
    return out;
  }

  let list = filteredList();

  function rebuildList(): void {
    list = filteredList();
    if (cursor >= list.length) cursor = Math.max(0, list.length - 1);
    clampScroll();
  }

  function clampScroll(): void {
    if (list.length <= 0) {
      cursor = 0;
      offset = 0;
      return;
    }
    cursor = Math.max(0, Math.min(list.length - 1, cursor));
    if (cursor < offset) offset = cursor;
    if (cursor >= offset + layout.page) offset = cursor - layout.page + 1;
    offset = Math.max(
      0,
      Math.min(Math.max(0, list.length - layout.page), offset),
    );
  }

  /** When set, coalesce writes into one stdout.write (faster Esc / soft paint). */
  let writeBuf: string | null = null;

  function write(s: string): void {
    if (writeBuf !== null) writeBuf += s;
    else stdout.write(s);
  }

  function beginBatch(): void {
    writeBuf = "";
  }

  function endBatch(): void {
    if (writeBuf !== null) {
      if (writeBuf.length > 0) stdout.write(writeBuf);
      writeBuf = null;
    }
  }

  function paintCell(
    row: number,
    col: number,
    width: number,
    content: string,
  ): void {
    write(move(row, col) + sgrDefault() + padAnsi(content, width));
  }

  function paintFullRow(row: number, content: string): void {
    // Set canvas BG before erase so 2K fills dark, not white
    write(
      move(row, 1) +
        sgrDefault() +
        clearLine() +
        move(row, 1) +
        padAnsi(content, layout.cols),
    );
  }

  function pathCellPlain(s: SessionRecord): string {
    if (!s.cwd) return padEndWidth("—", layout.pathW);
    const raw = s.extra?.cwdMissing ? `✗${s.cwd}` : s.cwd;
    return padEndWidth(raw, layout.pathW);
  }

  /**
   * TITLE cell while renaming: show buffer + caret in-cell (not footer).
   * Keeps the caret end visible when text is wider than the column.
   */
  function titleRenameCell(width: number): string {
    const caret = "▌";
    const text = renameBuf.replace(/\s+/g, " ");
    const full = text + caret;
    if (displayWidth(full) <= width) return padEndWidth(full, width);

    // Keep right side (where caret is); optional leading …
    let acc = caret;
    let w = displayWidth(caret);
    const chars = [...text];
    for (let i = chars.length - 1; i >= 0; i--) {
      const ch = chars[i]!;
      const cw = displayWidth(ch);
      if (w + cw > width - 1) break;
      acc = ch + acc;
      w += cw;
    }
    if (displayWidth(acc) < width) {
      // room for ellipsis prefix when truncated from left
      const room = width - displayWidth(acc);
      if (room >= 1) acc = "…" + acc;
    }
    return padEndWidth(acc, width);
  }

  function buildListRow(abs: number, isCursor: boolean): string {
    if (abs < 0 || abs >= list.length) return " ".repeat(layout.listW);
    const s = list[abs];
    const h = healthOf(s);
    const isMulti = multiSelect.has(sessionKey(s));
    const starred = isStarred(s);
    const editing = renameMode && isCursor;
    // mark: cursor + multi only (star has its own column)
    const markPlain = isCursor
      ? isMulti
        ? "▌*"
        : "▌ "
      : isMulti
        ? " *"
        : "  ";
    // star: padded " ★ " so it breathes away from STATUS
    const starPlain = padEndWidth(starred ? "★" : "", LC.star);
    const gapStar = " ".repeat(LC.gs);
    const statusPlain = padEndWidth(
      h === "ok" ? "OK" : h === "empty" ? "Empty" : "Missing",
      LC.status,
    );
    const srcPlain = sourcePlain(s.source);
    const agePlain = padStartWidth(formatAge(s.lastActive, now), LC.age);
    const msgsPlain = padStartWidth(String(s.messageCount), LC.msgs);
    // Tag only on left rail — not appended after title
    const titleRaw = s.title.replace(/\s+/g, " ");
    const titlePlain = editing
      ? titleRenameCell(layout.titleW)
      : padEndWidth(titleRaw, layout.titleW);
    const pathPlain = pathCellPlain(s);

    const style =
      editing
        ? { fg: theme.editFg, bg: theme.editBg }
        : isCursor
          ? { fg: theme.selectFg, bg: theme.selectBg }
          : isMulti
            ? { fg: theme.multiFg, bg: theme.multiBg }
            : null;

    const tailPlain =
      statusPlain +
      " ".repeat(LC.g1) +
      srcPlain +
      " ".repeat(LC.g2) +
      agePlain +
      " ".repeat(LC.g3) +
      msgsPlain +
      " ".repeat(LC.g4) +
      titlePlain +
      " ".repeat(LC.g5) +
      pathPlain;

    if (style) {
      const plain = markPlain + starPlain + gapStar + tailPlain;
      return fgBg(style.fg, style.bg, padEndWidth(plain, layout.listW));
    }

    const pathColored = s.extra?.cwdMissing
      ? fg(theme.missing, pathPlain)
      : fg(theme.dim, pathPlain);

    const starColored = starred
      ? fg(theme.star, padEndWidth("★", LC.star))
      : " ".repeat(LC.star);

    return padAnsi(
      markPlain +
        starColored +
        gapStar +
        statusChip(h) +
        " ".repeat(LC.g1) +
        sourceCell(s.source) +
        " ".repeat(LC.g2) +
        fg(theme.dim, agePlain) +
        " ".repeat(LC.g3) +
        fg(theme.dim, msgsPlain) +
        " ".repeat(LC.g4) +
        fg(theme.text, titlePlain) +
        " ".repeat(LC.g5) +
        pathColored,
      layout.listW,
    );
  }

  function buildColHeader(): string {
    return padAnsi(
      "  " +
        fg(theme.dim, padEndWidth("★", LC.star)) +
        " ".repeat(LC.gs) +
        fg(theme.dim, padEndWidth("STATUS", LC.status)) +
        " ".repeat(LC.g1) +
        fg(theme.dim, padEndWidth("SOURCE", LC.source)) +
        " ".repeat(LC.g2) +
        fg(theme.dim, padStartWidth("AGE", LC.age)) +
        " ".repeat(LC.g3) +
        fg(theme.dim, padStartWidth("MSGS", LC.msgs)) +
        " ".repeat(LC.g4) +
        fg(theme.dim, padEndWidth("TITLE", layout.titleW)) +
        " ".repeat(LC.g5) +
        fg(theme.dim, padEndWidth("RESUME DIR", layout.pathW)),
      layout.listW,
    );
  }

  function paintListSlot(slot: number): void {
    const abs = offset + slot;
    const row = layout.rowList0 + slot;
    const focused = focusPane === "sessions" && !tagAssignMode;
    paintCell(
      row,
      layout.listCol,
      layout.listW,
      buildListRow(abs, focused && abs === cursor),
    );
    if (layout.split) {
      paintCell(
        row,
        layout.listCol + layout.listW,
        1,
        fg(theme.border, "│"),
      );
    }
  }

  function paintAllList(): void {
    for (let i = 0; i < layout.page; i++) paintListSlot(i);
  }

  /**
   * Left tag rail.
   * Browse: all + tags; highlight filter.
   * Assign (t): [new] input slot + tags + (clear).
   */
  function paintTagRail(): void {
    const L = layout;
    const tw = L.tagW;
    const focused = focusPane === "tags" || tagAssignMode;

    // header cell on col head row
    const headLabel = tagAssignMode ? " assign " : " tags ";
    paintCell(
      L.rowColHead,
      1,
      tw,
      fgBg(
        focused ? theme.brandNameFg : theme.brandTagFg,
        focused ? theme.brandNameBg : theme.brandTagBg,
        padEndWidth(headLabel, tw),
      ),
    );
    paintCell(L.rowColHead, tw + 1, 1, fg(theme.border, "│"));

    if (tagAssignMode) {
      const tags = listTags();
      // items: 0=new, 1..tags, last=clear
      const items: Array<{ kind: "new" | "tag" | "clear"; label: string }> = [
        { kind: "new", label: tagAssignBuf ? `+${tagAssignBuf}` : "+ new…" },
        ...tags.map((t) => ({ kind: "tag" as const, label: t })),
        { kind: "clear", label: "(clear)" },
      ];
      const n = items.length;
      if (tagAssignCursor >= n) tagAssignCursor = Math.max(0, n - 1);
      for (let i = 0; i < L.page; i++) {
        const abs = i; // no scroll for assign for simplicity if short; scroll if needed
        const row = L.rowList0 + i;
        const item = items[abs];
        if (!item) {
          paintCell(row, 1, tw, " ".repeat(tw));
          paintCell(row, tw + 1, 1, fg(theme.border, "│"));
          continue;
        }
        const sel = abs === tagAssignCursor;
        let text = padEndWidth(" " + item.label, tw);
        if (item.kind === "new" && sel) {
          text = padEndWidth(" +" + tagAssignBuf + "█", tw);
        }
        const cell = sel
          ? fgBg(theme.selectFg, theme.selectBg, text)
          : item.kind === "clear"
            ? fg(theme.dim, text)
            : fg(theme.text, text);
        paintCell(row, 1, tw, cell);
        paintCell(row, tw + 1, 1, fg(theme.border, "│"));
      }
      return;
    }

    // browse mode
    const labels = tagRailLabels();
    clampTagScroll();
    for (let i = 0; i < L.page; i++) {
      const abs = tagOffset + i;
      const row = L.rowList0 + i;
      const label = labels[abs];
      if (label == null) {
        paintCell(row, 1, tw, " ".repeat(tw));
        paintCell(row, tw + 1, 1, fg(theme.border, "│"));
        continue;
      }
      const isAll = label === "all";
      const active =
        (isAll && tagFilter == null) || (!isAll && tagFilter === label);
      const sel = focusPane === "tags" && abs === tagCursor;
      const mark = active ? "●" : " ";
      const text = padEndWidth(` ${mark} ${label}`, tw);
      let cell: string;
      if (sel) cell = fgBg(theme.selectFg, theme.selectBg, text);
      else if (active) cell = fg(theme.accent, text);
      else cell = fg(theme.dim, text);
      paintCell(row, 1, tw, cell);
      paintCell(row, tw + 1, 1, fg(theme.border, "│"));
    }
  }

  /**
   * Brand bar — visual hierarchy:
   *   1. Name mark (strong filled pill + left accent bar)
   *   2. Soft · between sections (not heavy │ walls)
   *   3. Quiet section tags (dim chips)
   *   4. Bright keys, softer word hints
   *   5. Right status cluster (pos / sel / del / refresh)
   */
  function paintBrand(): void {
    const soft = fg(theme.brandSep, "  ·  ");
    const mid = fg(theme.brandSep, " · ");
    const key = (k: string) => fg(theme.brandKey, k);
    const hint = (s: string) => fg(theme.brandHint, s);
    /** Quiet section label — subordinate to keys */
    const tag = (t: string) =>
      fgBg(theme.brandTagFg, theme.brandTagBg, t) + " ";
    /** Product mark — top of hierarchy */
    const name =
      fg(theme.accent, "▌") +
      fgBg(theme.brandNameFg, theme.brandNameBg, ` ${TOOL_NAME} `);

    const n = list.length;
    const rightBits: string[] = [
      fgBg(theme.brandTagFg, theme.brandTagBg, ` ${cursor + 1}/${n || 0} `),
    ];
    if (multiSelect.size)
      rightBits.push(
        fgBg(theme.selectFg, theme.selectBg, ` sel ${multiSelect.size} `),
      );
    if (pendingDelete.size)
      rightBits.push(
        fgBg(theme.pill.missingFg, theme.pill.missingBg, ` del ${pendingDelete.size} `),
      );
    if (options.reload) {
      rightBits.push(hint("↻8s"));
    }
    const right = " " + rightBits.join(" ") + " ";
    const rightW = visWidth(right);
    const budget = Math.max(20, layout.cols - rightW);

    const variants: string[] = [
      // full — room to breathe
      [
        name,
        tag(" move ") + key("↑↓"),
        tag(" row ") +
          key("Tab") +
          hint(" tags") +
          mid +
          key("t") +
          hint(" set-tag") +
          mid +
          key("Space") +
          hint(" select") +
          mid +
          key("*") +
          hint(" star") +
          mid +
          key("i") +
          hint(" rename") +
          mid +
          key("dd") +
          hint(" delete"),
        tag(" bulk ") +
          key(":empty") +
          mid +
          key(":missing") +
          mid +
          key(":bad"),
        tag(" copy ") +
          key("y") +
          hint(" resume command") +
          soft +
          tag(" search ") +
          key("/") +
          hint(" filter"),
        tag(" quit ") + key(":q") + mid + key(":wq"),
      ].join(soft),
      // medium
      [
        name,
        tag(" move ") + key("↑↓"),
        tag(" row ") +
          key("Space") +
          mid +
          key("*") +
          mid +
          key("i") +
          mid +
          key("dd"),
        tag(" bulk ") +
          key(":empty") +
          mid +
          key(":missing") +
          mid +
          key(":bad"),
        tag(" copy ") + key("y") + soft + tag(" search ") + key("/"),
        tag(" quit ") + key(":q") + mid + key(":wq"),
      ].join(soft),
      // compact
      [
        name,
        tag("mv") + key("↑↓"),
        tag("row") +
          key("Sp") +
          mid +
          key("*") +
          mid +
          key("i") +
          mid +
          key("dd"),
        tag("bulk") + key(":e") + mid + key(":m") + mid + key(":bad"),
        tag("y") + key("y") + mid + tag("/") + key("/"),
        tag("q") + key(":q") + mid + key(":wq"),
      ].join(soft),
      // minimal
      [
        name,
        key("↑↓"),
        key("Space") + mid + key("*") + mid + key("i") + mid + key("dd"),
        key(":e") + mid + key(":m") + mid + key(":bad"),
        key("y") + mid + key("/"),
        key(":q") + mid + key(":wq"),
      ].join(soft),
      name,
    ];

    let body = variants[variants.length - 1]!;
    for (const v of variants) {
      if (visWidth(v) + 1 <= budget) {
        body = v;
        break;
      }
    }

    const gap = Math.max(1, budget - visWidth(body));
    const line = body + " ".repeat(gap) + right;
    paintFullRow(layout.rowBrand, padAnsi(line, layout.cols));
  }

  /**
   * Horizontal rules — primary visual structure.
   * brand: double line under brand bar
   * head:  single line under column titles (┼ at gutter)
   * foot:  single line above status bar
   */
  function paintRule(
    row: number,
    kind: "brand" | "head" | "foot",
  ): void {
    const L = layout;
    const tw = L.tagW;
    const lw = L.listW;
    const dw = L.detailW;
    const ch = kind === "brand" ? "═" : "─";
    const color = kind === "brand" ? theme.border : theme.line;

    if (kind === "brand") {
      if (L.split) {
        paintFullRow(
          row,
          fg(
            theme.border,
            "═".repeat(tw) + "╤" + "═".repeat(lw) + "╤" + "═".repeat(dw),
          ),
        );
      } else {
        paintFullRow(
          row,
          fg(theme.border, "═".repeat(tw) + "╤" + "═".repeat(lw)),
        );
      }
      return;
    }

    // head / foot across tags | list | detail
    const join =
      kind === "head" ? "┼" : "┴";
    const endCap = kind === "head" ? "┤" : "┘";
    paintCell(row, 1, tw, fg(color, ch.repeat(tw)));
    paintCell(row, tw + 1, 1, fg(theme.border, join));
    paintCell(row, L.listCol, lw, fg(color, ch.repeat(lw)));
    if (L.split) {
      paintCell(row, L.listCol + lw, 1, fg(theme.border, join));
      paintCell(
        row,
        L.detailCol,
        dw,
        fg(theme.border, ch.repeat(Math.max(0, dw - 1)) + endCap),
      );
    }
  }

  function wrapPlain(text: string, width: number): string[] {
    const out: string[] = [];
    for (const para of text.split("\n")) {
      if (!para) {
        out.push("");
        continue;
      }
      let rest = para;
      while (rest.length > 0) {
        if (displayWidth(rest) <= width) {
          out.push(rest);
          break;
        }
        let chunk = "";
        let w = 0;
        for (const ch of rest) {
          const cw = displayWidth(ch);
          if (w + cw > width && chunk) break;
          chunk += ch;
          w += cw;
        }
        if (!chunk) {
          chunk = rest[0] ?? "";
        }
        out.push(chunk);
        rest = rest.slice(chunk.length);
      }
    }
    return out;
  }

  /** Local HH:MM for list / full headers. */
  function chatTimeLabel(at?: string | null): string {
    if (!at) return "";
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return "";
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  function chatRoleMeta(role: string): {
    name: string;
    nameFg: string;
    bar: string;
  } {
    const c = theme.chat;
    switch (role) {
      case "user":
        return { name: "You", nameFg: c.userName, bar: c.userBar };
      case "tool":
        return { name: "Tool", nameFg: c.toolName, bar: c.toolBar };
      case "thought":
        return { name: "Think", nameFg: c.thinkName, bar: c.thinkBar };
      default:
        return { name: "Agent", nameFg: c.agentName, bar: c.agentBar };
    }
  }

  /** Collapse whitespace → single-line preview. */
  function chatPreviewPlain(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }

  const CHAT_LIST_HEADER = 2; // title row + rule

  /**
   * List mode: one truncated preview row per turn (width-adaptive).
   * Expand mode: full wrapped body of chatExpandIdx.
   */
  function rebuildChatLines(innerW: number): void {
    const lines: string[] = [];
    const w = Math.max(12, innerW);
    const c = theme.chat;

    if (chatTurns.length === 0) {
      lines.push(
        fgBg(c.headerFg, c.headerBg, padEndWidth("  No messages", w)),
      );
      chatLines = lines;
      return;
    }

    // ── expanded full message ──
    if (chatExpandIdx !== null) {
      const turn = chatTurns[chatExpandIdx];
      if (!turn) {
        chatExpandIdx = null;
        rebuildChatLines(innerW);
        return;
      }
      const meta = chatRoleMeta(turn.role);
      const time = chatTimeLabel(turn.at);
      const left = ` ${meta.name}`;
      const right = time
        ? `${time} · Esc list`
        : "Esc list";
      const gap = Math.max(1, w - 1 - displayWidth(left) - displayWidth(right));
      lines.push(
        fgBg(meta.bar, c.headerBg, " ") +
          fgBg(meta.nameFg, c.headerBg, left) +
          fgBg(c.headerFg, c.headerBg, " ".repeat(gap)) +
          fgBg(c.headerFg, c.headerBg, right) +
          sgrDefault(),
      );
      lines.push(fg(c.sep, "─".repeat(w)));
      const bodyW = Math.max(4, w - 1);
      const bodyBg =
        turn.role === "user"
          ? c.userBg
          : turn.role === "tool"
            ? c.toolBg
            : c.agentBg;
      const bodyFg =
        turn.role === "user"
          ? c.userText
          : turn.role === "tool"
            ? c.toolText
            : c.agentText;
      const wrapped = wrapPlain(turn.text, bodyW);
      for (const wl of wrapped.length ? wrapped : [""]) {
        lines.push(
          fgBg(meta.bar, bodyBg, " ") +
            fgBg(bodyFg, bodyBg, padEndWidth(" " + wl, bodyW)) +
            sgrDefault(),
        );
      }
      chatLines = lines;
      return;
    }

    // ── list: one preview line per turn ──
    {
      const left = " Messages";
      const right = `${chatTurns.length} · Enter full`;
      const gap = Math.max(1, w - 1 - displayWidth(left) - displayWidth(right));
      lines.push(
        fgBg(c.headerAccent, c.headerBg, " ") +
          fgBg(c.headerFg, c.headerBg, left) +
          fgBg(c.headerFg, c.headerBg, " ".repeat(gap)) +
          fgBg(c.headerFg, c.headerBg, right) +
          sgrDefault(),
      );
    }
    lines.push(fg(c.sep, "─".repeat(w)));

    const roleCol = 6; // "Agent" / "You  "
    for (let i = 0; i < chatTurns.length; i++) {
      const turn = chatTurns[i]!;
      const meta = chatRoleMeta(turn.role);
      const selected = i === chatCursor;
      const rolePlain = padEndWidth(meta.name, roleCol);
      const preview = chatPreviewPlain(turn.text);
      // "▌" + role + " " + preview  → adaptive truncate
      const restW = Math.max(4, w - 1 - roleCol - 1);
      const prevPlain = truncateWidth(preview || "…", restW);
      const rowPlain =
        rolePlain + " " + padEndWidth(prevPlain, restW);

      if (selected) {
        lines.push(
          fgBg(theme.selectFg, theme.selectBg, "▌") +
            fgBg(
              theme.selectFg,
              theme.selectBg,
              padEndWidth(rowPlain, w - 1),
            ) +
            sgrDefault(),
        );
      } else {
        lines.push(
          fgBg(meta.bar, c.agentBg, "▌") +
            fgBg(meta.nameFg, c.agentBg, rolePlain) +
            fgBg(
              c.agentText,
              c.agentBg,
              " " + padEndWidth(prevPlain, restW),
            ) +
            sgrDefault(),
        );
      }
    }

    chatLines = lines;
  }

  function openChatForCursor(): void {
    const s = list[cursor];
    if (!s) return;
    if (focusPane === "tags") return;
    // Paint chrome first so open feels snappy; load after is ok for large logs
    statusLine = "loading…";
    paintFooter();
    chatTurns = readTranscript(s);
    chatSessionKey = sessionKey(s);
    chatOffset = 0;
    chatCursor = 0;
    chatExpandIdx = null;
    detailView = "chat";
    focusPane = "detail";
    const inner = Math.max(8, layout.detailW - 2);
    rebuildChatLines(inner);
    statusLine =
      chatTurns.length === 0
        ? "no messages · Esc → sessions"
        : `messages ${chatTurns.length} · ↑↓ · Enter full · Esc sessions`;
    // Differential only — avoid full-screen erase (slow on WSL / large terms)
    paintSoft();
  }

  function expandChatAtCursor(): void {
    if (detailView !== "chat" || chatTurns.length === 0) return;
    if (chatExpandIdx !== null) {
      chatExpandIdx = null;
      chatOffset = 0;
      clampChatListScroll();
      rebuildChatLines(Math.max(8, layout.detailW - 2));
      statusLine = `messages ${chatTurns.length} · ↑↓ · Enter full · Esc sessions`;
      paintChatPaneOnly();
      return;
    }
    chatExpandIdx = chatCursor;
    chatOffset = 0;
    rebuildChatLines(Math.max(8, layout.detailW - 2));
    statusLine = "full message · ↑↓ scroll · Esc → list";
    paintChatPaneOnly();
  }

  function collapseChatExpand(): boolean {
    if (detailView !== "chat" || chatExpandIdx === null) return false;
    chatExpandIdx = null;
    chatOffset = 0;
    clampChatListScroll();
    rebuildChatLines(Math.max(8, layout.detailW - 2));
    statusLine = `messages ${chatTurns.length} · ↑↓ · Enter full · Esc sessions`;
    paintChatPaneOnly();
    return true;
  }

  /** Reset chat state without painting (caller paints). Always leave focus on sessions. */
  function resetChatState(): void {
    detailView = "meta";
    chatTurns = [];
    chatLines = [];
    chatOffset = 0;
    chatCursor = 0;
    chatExpandIdx = null;
    chatSessionKey = null;
    if (focusPane === "detail") focusPane = "sessions";
  }

  /** Close chat → sessions. Differential paint for instant Esc. */
  function closeChat(): void {
    resetChatState();
    focusPane = "sessions";
    statusLine = "";
    paintSoft();
  }

  /** If list cursor left the open chat session, drop chat → meta. */
  function dropChatIfCursorMoved(): void {
    if (detailView !== "chat") return;
    const s = list[cursor];
    if (!s || sessionKey(s) !== chatSessionKey) {
      resetChatState();
    }
  }

  function chatMaxOffset(): number {
    return Math.max(0, chatLines.length - layout.page);
  }

  /** Keep chatCursor row visible in list mode. */
  function clampChatListScroll(): void {
    if (chatExpandIdx !== null) return;
    const row = CHAT_LIST_HEADER + chatCursor;
    if (row < chatOffset) chatOffset = row;
    if (row >= chatOffset + layout.page) {
      chatOffset = row - layout.page + 1;
    }
    chatOffset = Math.max(0, Math.min(chatMaxOffset(), chatOffset));
  }

  function moveChatList(delta: number): void {
    if (chatTurns.length === 0) return;
    const prev = chatCursor;
    chatCursor = Math.max(
      0,
      Math.min(chatTurns.length - 1, chatCursor + delta),
    );
    if (chatCursor === prev && delta !== 0) {
      // still scroll viewport if already at edge with page jump content
    }
    const prevOff = chatOffset;
    clampChatListScroll();
    // Rebuild list rows only when selection or scroll window changed
    if (chatCursor !== prev || chatOffset !== prevOff) {
      rebuildChatLines(Math.max(8, layout.detailW - 2));
    }
    paintChatPaneOnly();
  }

  function scrollChat(delta: number): void {
    if (detailView !== "chat") return;
    if (chatExpandIdx === null) {
      // list: move selection (page jumps by page size)
      moveChatList(delta);
      return;
    }
    const maxOff = chatMaxOffset();
    chatOffset = Math.max(0, Math.min(maxOff, chatOffset + delta));
    paintDetail();
    paintFooter();
    write(move(layout.rowFooter, 1));
  }

  /**
   * Detail meta: id / tag / command.
   * Detail chat: transcript near→far (newest first), scrollable.
   */
  function detailBody(innerW: number): string[] {
    if (detailView === "chat") {
      if (chatLines.length === 0) rebuildChatLines(innerW);
      const maxOff = Math.max(0, chatLines.length - layout.page);
      if (chatOffset > maxOff) chatOffset = maxOff;
      return chatLines.slice(chatOffset, chatOffset + layout.page);
    }

    const s = list[cursor] ?? null;
    const lines: string[] = [];
    if (!s) {
      lines.push(fg(theme.dim, padEndWidth("(no selection)", innerW)));
      return lines;
    }

    const push = (text: string, color: string = theme.text): void => {
      lines.push(fg(color, padEndWidth(truncateWidth(text, innerW), innerW)));
    };
    const pushLabel = (label: string): void => {
      lines.push(fg(theme.accent, padEndWidth(label, innerW)));
    };

    pushLabel("ID");
    push(s.id, theme.text);
    lines.push("");

    const tg = sessionTag(s);
    if (tg) {
      pushLabel("Tag");
      push(tg, theme.accent);
      lines.push("");
    }

    pushLabel("Resume command  (y copy)");
    let rest = resumeInfo(s).command;
    let guard = 0;
    while (rest && guard++ < 6) {
      if (displayWidth(rest) <= innerW) {
        push(rest, theme.text);
        break;
      }
      let chunk = "";
      let w = 0;
      for (const ch of rest) {
        const cw = displayWidth(ch);
        if (w + cw > innerW) break;
        chunk += ch;
        w += cw;
      }
      if (!chunk) break;
      push(chunk, theme.text);
      rest = rest.slice(chunk.length);
    }
    lines.push("");
    push("Enter · message list (preview)", theme.dim);

    return lines;
  }

  function detailHeaderLabel(): string {
    return detailView === "chat" ? " Chat" : " Detail";
  }

  function paintDetail(): void {
    const L = layout;
    const dw = L.detailW;
    const inner = Math.max(8, dw - 2);
    const body = detailBody(inner);
    const col = L.detailCol;

    if (L.split) {
      for (let i = 0; i < L.page; i++) {
        paintCell(
          L.rowDetail0 + i,
          col,
          dw,
          padAnsi(body[i] ?? "", Math.max(0, dw - 1)) +
            fg(theme.border, "│"),
        );
      }
    } else {
      const top = L.rowDetail0;
      paintFullRow(
        top,
        fg(theme.border, boxTop(detailView === "chat" ? "Chat" : "Detail", dw)),
      );
      for (let i = 0; i < L.detailBodyRows; i++) {
        paintFullRow(
          top + 1 + i,
          fg(theme.border, "│") +
            padAnsi(body[i] ?? "", inner) +
            fg(theme.border, "│"),
        );
      }
      paintFullRow(
        top + 1 + L.detailBodyRows,
        fg(theme.border, boxBot(dw)),
      );
    }
  }

  function buildHelpLines(): string[] {
    const lines: string[] = [];
    lines.push("Keyboard shortcuts");
    lines.push("");
    for (const g of HELP_GROUPS) {
      lines.push(g.title);
      for (const [k, desc] of g.keys) {
        lines.push(`  ${k.padEnd(18)} ${desc}`);
      }
      lines.push("");
    }
    lines.push("Esc / q / Enter  ·  close help");
    return lines;
  }

  function paintHelpOverlay(): void {
    const lines = buildHelpLines();
    const top = layout.rowColHead;
    const bot = layout.rowRuleFoot;
    const height = Math.max(1, bot - top);
    const maxOff = Math.max(0, lines.length - height);
    if (helpOffset > maxOff) helpOffset = maxOff;
    if (helpOffset < 0) helpOffset = 0;

    for (let i = 0; i < height; i++) {
      const row = top + i;
      const raw = lines[helpOffset + i] ?? "";
      const isHead =
        raw.length > 0 &&
        !raw.startsWith("  ") &&
        raw !== "Keyboard shortcuts" &&
        !raw.startsWith("Esc");
      const isTitle = raw === "Keyboard shortcuts";
      let cell: string;
      if (isTitle) cell = fg(theme.accent, padEndWidth(raw, layout.cols));
      else if (isHead) cell = fgBg(theme.brandNameFg, theme.brandNameBg, padEndWidth(` ${raw} `, layout.cols));
      else cell = fg(theme.text, padEndWidth(raw, layout.cols));
      paintFullRow(row, cell);
    }
  }

  function paintFooter(): void {
    if (helpMode) {
      paintFullRow(
        layout.rowFooter,
        fg(theme.dim, " ") +
          fgBg(theme.brandNameFg, theme.brandNameBg, " HELP ") +
          fg(theme.dim, " ↑↓ scroll  ·  Esc / q / Enter close"),
      );
      return;
    }
    if (tagAssignMode) {
      paintFullRow(
        layout.rowFooter,
        fg(theme.dim, " ") +
          fgBg(theme.editFg, theme.editBg, " TAG ") +
          fg(
            theme.dim,
            " ↑↓ pick  ·  type in +new  ·  Enter assign  ·  Esc cancel",
          ),
      );
      return;
    }
    if (renameMode) {
      paintFullRow(
        layout.rowFooter,
        fg(theme.dim, " ") +
          fgBg(theme.editFg, theme.editBg, " TITLE ") +
          fg(theme.dim, " Esc leave (keep)  ·  Enter save  ·  Ctrl-U clear"),
      );
      return;
    }
    if (filterMode) {
      // vim-style search prompt: / is fixed prompt, not a typed character
      paintFullRow(
        layout.rowFooter,
        fg(theme.warn, " /") +
          fg(theme.title, filter) +
          fg(theme.accent, "█") +
          fg(
            theme.dim,
            "  Enter apply · Esc abort · BS empty→exit · Ctrl-U clear",
          ),
      );
      return;
    }
    if (cmdMode) {
      paintFullRow(
        layout.rowFooter,
        fg(theme.warn, " :") +
          fg(theme.title, cmdBuf) +
          fg(
            theme.dim,
            "  (:empty :missing :bad · :q · :wq · Esc cancel)",
          ),
      );
      return;
    }
    let msg = "";
    if (focusPane === "tags") msg = "tags focus · Tab→sessions · ↑↓ filter";
    if (focusPane === "detail" && detailView === "chat")
      msg =
        chatExpandIdx !== null
          ? "full msg · ↑↓ scroll · Esc → list"
          : "msg list · ↑↓ · Enter full · Esc sessions";
    if (tagFilter) msg += (msg ? " · " : "") + `tag:${tagFilter}`;
    if (filter) msg += (msg ? " · " : "") + `filter "${filter}"`;
    if (sourceIdx !== 0) msg += (msg ? " · " : "") + SOURCES[sourceIdx];
    if (healthIdx !== 0)
      msg +=
        (msg ? " · " : "") + healthFilterName(HEALTH_FILTERS[healthIdx]);
    if (statusLine) msg += (msg ? " · " : "") + statusLine;
    if (pending) msg += (msg ? " · " : "") + pending + "…";
    if (multiSelect.size)
      msg +=
        (msg ? " · " : "") +
        `${multiSelect.size} selected · Space toggle · dd mark all`;
    if (pendingDelete.size)
      msg += (msg ? " · " : "") + `${pendingDelete.size} to delete → :wq`;
    paintFullRow(
      layout.rowFooter,
      msg
        ? fg(theme.accent, " " + truncateWidth(msg, layout.cols - 2))
        : fg(
            theme.dim,
            " Enter chat  ·  Tab focus  ·  t tag  ·  * star  ·  i rename  ·  :wq",
          ),
    );
  }

  /** Detail column title (Chat / Detail) — split layout only. */
  function paintDetailHeader(): void {
    if (!layout.split) return;
    const label = detailHeaderLabel();
    const headColor =
      focusPane === "detail" ? theme.title : theme.accent;
    paintCell(
      layout.rowColHead,
      layout.detailCol,
      layout.detailW,
      fg(headColor, padEndWidth(label, layout.detailW - 1)) +
        fg(theme.border, "│"),
    );
  }

  /**
   * Fast UI refresh without full-screen erase.
   * Use for Esc leave-chat / open-chat / focus changes — avoids ~1s lag on WSL.
   */
  function paintSoft(): void {
    beginBatch();
    try {
      paintBrand();
      paintTagRail();
      if (layout.split) {
        paintCell(
          layout.rowColHead,
          layout.listCol,
          layout.listW,
          buildColHeader(),
        );
        paintCell(
          layout.rowColHead,
          layout.listCol + layout.listW,
          1,
          fg(theme.border, "│"),
        );
        paintDetailHeader();
      }
      paintAllList();
      paintDetail();
      paintFooter();
      write(move(layout.rowFooter, 1));
    } finally {
      endBatch();
    }
  }

  /** Only right pane + footer (expand / collapse message). */
  function paintChatPaneOnly(): void {
    beginBatch();
    try {
      paintDetailHeader();
      paintDetail();
      paintFooter();
      write(move(layout.rowFooter, 1));
    } finally {
      endBatch();
    }
  }

  function fullPaint(): void {
    // Flood canvas dark first (light terminals would otherwise stay white)
    write(move(1, 1) + sgrDefault() + `${ESC}[2J` + move(1, 1));
    paintBrand();
    paintRule(layout.rowRuleBrand, "brand");

    if (helpMode) {
      paintHelpOverlay();
      paintRule(layout.rowRuleFoot, "foot");
      paintFooter();
      write(move(layout.rowFooter, 1));
      return;
    }

    paintTagRail();

    if (layout.split) {
      paintCell(
        layout.rowColHead,
        layout.listCol,
        layout.listW,
        buildColHeader(),
      );
      paintCell(
        layout.rowColHead,
        layout.listCol + layout.listW,
        1,
        fg(theme.border, "│"),
      );
      paintDetailHeader();
      paintRule(layout.rowRuleHead, "head");
    } else {
      paintCell(
        layout.rowColHead,
        layout.listCol,
        layout.listW,
        buildColHeader(),
      );
      paintRule(layout.rowRuleHead, "head");
    }

    paintAllList();
    paintDetail();
    paintRule(layout.rowRuleFoot, "foot");
    paintFooter();
    write(move(layout.rowFooter, 1));
  }

  function paintSelectionChange(prevCursor: number, prevOffset: number): void {
    // List cursor may have left the open chat session
    dropChatIfCursorMoved();
    if (offset !== prevOffset) {
      paintAllList();
    } else {
      const a = prevCursor - offset;
      const b = cursor - offset;
      if (a >= 0 && a < layout.page) paintListSlot(a);
      if (b >= 0 && b < layout.page && b !== a) paintListSlot(b);
    }
    paintBrand();
    paintTagRail();
    // re-paint detail header label if chat closed
    if (layout.split) {
      const label = detailHeaderLabel();
      const headColor =
        focusPane === "detail" ? theme.title : theme.accent;
      paintCell(
        layout.rowColHead,
        layout.detailCol,
        layout.detailW,
        fg(headColor, padEndWidth(label, layout.detailW - 1)) +
          fg(theme.border, "│"),
      );
    }
    paintDetail();
    paintFooter();
    write(move(layout.rowFooter, 1));
  }

  function clearPending(): void {
    pending = null;
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  function armPending(p: "d" | "g" | "y"): void {
    clearPending();
    pending = p;
    paintFooter();
    pendingTimer = setTimeout(() => {
      pending = null;
      pendingTimer = null;
      paintFooter();
    }, 800);
  }

  /**
   * dd: mark for delete (no confirm). Real unlink on :wq only.
   * Starred sessions cannot be marked — unstar (*) first.
   */
  function doDeleteMark(): void {
    const candidates: SessionRecord[] = [];
    if (multiSelect.size > 0) {
      for (const s of allSessions) {
        const k = sessionKey(s);
        if (multiSelect.has(k) && !pendingDelete.has(k)) candidates.push(s);
      }
    } else {
      const s = list[cursor];
      if (s) candidates.push(s);
    }
    if (candidates.length === 0) {
      statusLine = "nothing to delete";
      paintFooter();
      return;
    }
    const starred = candidates.filter((s) => isStarred(s));
    const targets = candidates.filter((s) => !isStarred(s));
    if (targets.length === 0) {
      statusLine =
        starred.length === 1
          ? "starred — press * to unstar before dd"
          : `${starred.length} starred — unstar (*) before dd`;
      paintFooter();
      return;
    }
    for (const s of targets) {
      const k = sessionKey(s);
      pendingDelete.set(k, s);
      undoStack.push(s);
      multiSelect.delete(k);
    }
    const skip =
      starred.length > 0 ? ` · skipped ${starred.length} starred` : "";
    statusLine =
      targets.length === 1
        ? `marked delete ${shortId(targets[0].id, 8)}  ·  u undo  ·  :wq apply${skip}`
        : `marked delete ${targets.length} sessions  ·  u undo  ·  :wq apply${skip}`;
    rebuildList();
    fullPaint();
  }

  function startTagAssign(): void {
    if (focusPane !== "sessions") {
      focusPane = "sessions";
    }
    const s = list[cursor];
    if (!s) return;
    clearPending();
    tagAssignMode = true;
    tagAssignKey = sessionKey(s);
    tagAssignCursor = 0;
    tagAssignBuf = "";
    statusLine = "";
    fullPaint();
  }

  function cancelTagAssign(): void {
    tagAssignMode = false;
    tagAssignBuf = "";
    tagAssignKey = null;
    statusLine = "tag assign cancelled";
    fullPaint();
  }

  function commitTagAssign(): void {
    if (!tagAssignKey) {
      cancelTagAssign();
      return;
    }
    const [source, ...idParts] = tagAssignKey.split(":");
    const id = idParts.join(":");
    const tags = listTags();
    // 0 = new, 1..n = tags, n+1 = clear
    let result: { ok: boolean; tag: string | null; error?: string };
    if (tagAssignCursor === 0) {
      if (!tagAssignBuf.trim()) {
        statusLine = "type a tag name in +new";
        paintFooter();
        return;
      }
      result = setSessionTag(source!, id, tagAssignBuf);
    } else if (tagAssignCursor === tags.length + 1) {
      result = setSessionTag(source!, id, null);
    } else {
      const t = tags[tagAssignCursor - 1];
      result = setSessionTag(source!, id, t ?? null);
    }
    tagAssignMode = false;
    tagAssignBuf = "";
    tagAssignKey = null;
    if (!result.ok) {
      statusLine = `tag failed: ${result.error ?? "unknown"}`;
      fullPaint();
      return;
    }
    // update memory
    for (const a of allSessions) {
      if (sessionKey(a) === `${source}:${id}`) {
        if (result.tag) a.extra = { ...a.extra, tag: result.tag };
        else if (a.extra) {
          const { tag: _d, ...rest } = a.extra;
          a.extra = rest;
        }
      }
    }
    statusLine = result.tag ? `tag → ${result.tag}` : "tag cleared";
    rebuildList();
    fullPaint();
  }

  /** * — toggle star (pin top; blocks dd until unstarred) */
  function doToggleStar(): void {
    const s = list[cursor];
    if (!s) return;
    const r = toggleStar(s.source, s.id);
    if (!r.ok) {
      statusLine = `star failed: ${r.error ?? "unknown"}`;
      paintFooter();
      return;
    }
    s.extra = { ...s.extra, starred: r.starred };
    // keep allSessions in sync
    const k = sessionKey(s);
    for (const a of allSessions) {
      if (sessionKey(a) === k) a.extra = { ...a.extra, starred: r.starred };
    }
    statusLine = r.starred
      ? `starred ★  ·  pinned · cannot dd until * again`
      : `unstarred  ·  dd allowed`;
    rebuildList();
    // keep focus on same session after re-sort
    const idx = list.findIndex((x) => sessionKey(x) === k);
    if (idx >= 0) cursor = idx;
    clampScroll();
    fullPaint();
  }

  /** Space: toggle multi-select on the cursor row */
  function doToggleMultiSelect(): void {
    const s = list[cursor];
    if (!s) return;
    const k = sessionKey(s);
    if (multiSelect.has(k)) {
      multiSelect.delete(k);
      statusLine = `deselected ${shortId(s.id, 8)}`;
    } else {
      multiSelect.add(k);
      statusLine = `selected ${shortId(s.id, 8)}  ·  ${multiSelect.size} total`;
    }
    const slot = cursor - offset;
    if (slot >= 0 && slot < layout.page) paintListSlot(slot);
    paintBrand();
    paintFooter();
    write(move(layout.rowFooter, 1));
  }

  /**
   * Pool for bulk health select: respect source + search, ignore health filter
   * (so :empty still works while viewing OK-only), skip already pending-delete.
   */
  function bulkSelectPool(): SessionRecord[] {
    const sourceFilter = SOURCES[sourceIdx];
    const q = filter.trim().toLowerCase();
    return allSessions.filter((s) => {
      if (pendingDelete.has(sessionKey(s))) return false;
      if (sourceFilter !== "all" && s.source !== sourceFilter) return false;
      if (!q) return true;
      return [s.title, s.id, s.cwd ?? "", s.source]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }

  /** Bulk multi-select by attributes (additive). See lib/health matchesBulkHealth. */
  function doSelectByHealth(mode: BulkHealthMode): void {
    const pool = bulkSelectPool();
    let added = 0;
    for (const s of pool) {
      if (!matchesBulkHealth(s, mode)) continue;
      const k = sessionKey(s);
      if (!multiSelect.has(k)) {
        multiSelect.add(k);
        added++;
      }
    }
    const label =
      mode === "empty"
        ? "empty"
        : mode === "missing"
          ? "missing"
          : "empty/missing";
    if (added === 0 && multiSelect.size === 0) {
      statusLine = `no ${label} sessions`;
    } else if (added === 0) {
      statusLine = `no new ${label} · ${multiSelect.size} already selected`;
    } else {
      statusLine = `selected ${added} ${label} · ${multiSelect.size} total · dd mark · Esc clear`;
    }
    fullPaint();
  }

  function clearMultiSelect(): void {
    if (multiSelect.size === 0) return;
    multiSelect.clear();
    statusLine = "selection cleared";
    fullPaint();
  }

  function doUndo(): void {
    const s = undoStack.pop();
    if (!s) {
      statusLine = "nothing to undo";
      paintFooter();
      return;
    }
    pendingDelete.delete(sessionKey(s));
    statusLine = `undeleted mark ${shortId(s.id, 8)}`;
    rebuildList();
    fullPaint();
  }

  /** :wq — apply pending deletes then exit */
  function doWriteQuit(exit: () => void): void {
    const toDel = [...pendingDelete.values()];
    if (toDel.length === 0) {
      statusLine = "no deletes; quitting…";
      paintFooter();
      exit();
      return;
    }
    const results = deleteSessions(toDel);
    const ok = results.filter((r) => r.ok).length;
    const fail = results.filter((r) => !r.ok);
    // Leave alt screen then print summary to main terminal
    exit();
    if (fail.length) {
      console.error(
        `Deleted ${ok}/${toDel.length} session(s); failed ${fail.length}:`,
      );
      for (const f of fail) {
        console.error(`  ${f.source} ${f.id}: ${f.error ?? "unknown"}`);
      }
    } else {
      console.log(`Deleted ${ok} session(s).`);
    }
  }

  /**
   * Run a vim-style ex command (text after `:`).
   * Bulk select + quit live here so multi-key chords stay navigation-only.
   */
  /** Normalize ex aliases → canonical verb (or null if unknown). */
  function normalizeEx(head: string, arg: string): string | null {
    if (head === "sel" || head === "select") {
      if (!arg) return "sel-help";
      if (arg === "empty" || arg === "e") return "empty";
      if (arg === "missing" || arg === "m") return "missing";
      if (arg === "bad" || arg === "!" || arg === "unhealthy" || arg === "broken")
        return "bad";
      if (arg === "none" || arg === "clear" || arg === "c") return "selc";
      return null;
    }
    const map: Record<string, string> = {
      wq: "wq",
      x: "wq",
      q: "q",
      quit: "q",
      "q!": "q!",
      empty: "empty",
      emp: "empty",
      missing: "missing",
      mis: "missing",
      bad: "bad",
      broken: "bad",
      unhealthy: "bad",
      selc: "selc",
      selnone: "selc",
      help: "help",
      h: "help",
      "?": "help",
    };
    return map[head] ?? null;
  }

  function runExCommand(cmdRaw: string, exit: () => void): void {
    const raw = cmdRaw.trim().toLowerCase();
    if (!raw) {
      statusLine = "empty command · :help";
      paintFooter();
      return;
    }
    const parts = raw.split(/\s+/).filter(Boolean);
    const verb = normalizeEx(parts[0] ?? "", parts.slice(1).join(" "));

    switch (verb) {
      case "wq":
        doWriteQuit(exit);
        return;
      case "q!":
        pendingDelete.clear();
        undoStack.length = 0;
        multiSelect.clear();
        statusLine = "quit (discarded pending deletes)";
        paintFooter();
        exit();
        return;
      case "q":
        if (pendingDelete.size > 0) {
          statusLine = `${pendingDelete.size} pending delete(s) · :wq apply · :q! discard`;
          paintFooter();
          return;
        }
        statusLine = "quitting…";
        paintFooter();
        exit();
        return;
      case "empty":
        doSelectByHealth("empty");
        return;
      case "missing":
        doSelectByHealth("missing");
        return;
      case "bad":
        doSelectByHealth("unhealthy");
        return;
      case "selc":
        if (multiSelect.size === 0) {
          statusLine = "nothing selected";
          paintFooter();
          return;
        }
        clearMultiSelect();
        return;
      case "sel-help":
        statusLine = ":sel empty|missing|bad|none";
        paintFooter();
        return;
      case "help":
        helpMode = true;
        helpOffset = 0;
        statusLine = "";
        fullPaint();
        return;
      default:
        statusLine = `unknown :${cmdRaw.trim()}  ·  :help`;
        paintFooter();
    }
  }

  /** y = copy resume command — show in footer for selection (does not run it) */
  function doYank(): void {
    const s = list[cursor];
    if (!s) return;
    statusLine = `copy resume command: ${resumeHint(s)}`;
    paintFooter();
  }

  /** Repaint cursor row TITLE cell + detail + footer while typing */
  function paintRenameLive(): void {
    const slot = cursor - offset;
    if (slot >= 0 && slot < layout.page) paintListSlot(slot);
    paintDetail();
    paintFooter();
    write(move(layout.rowFooter, 1));
  }

  /** i — open rename buffer prefilled with current title (edit in TITLE col) */
  function startRename(): void {
    const s = list[cursor];
    if (!s) return;
    if (s.source !== "grok" && s.source !== "claude" && s.source !== "qoder") {
      statusLine = `rename not supported for ${s.source}`;
      paintFooter();
      return;
    }
    clearPending();
    renameMode = true;
    renameOrig = s.title;
    renameBuf = s.title;
    statusLine = "";
    paintRenameLive();
  }

  /**
   * Leave insert/rename mode (vim Esc): keep buffer content.
   * UI exits immediately; disk write follows so Esc feels instant.
   */
  function exitRenameKeep(): void {
    const s = list[cursor];
    const prev = renameOrig;
    const title = renameBuf.replace(/\s+/g, " ").trim();
    renameMode = false;
    renameBuf = "";
    renameOrig = "";

    if (!s) {
      paintFooter();
      return;
    }

    // Empty → leave insert, keep previous title on screen
    if (!title) {
      statusLine = "empty title · left unchanged";
      fullPaint();
      return;
    }

    // Unchanged: just drop insert chrome
    if (title === s.title) {
      statusLine = "";
      fullPaint();
      return;
    }

    // Optimistic UI first (snappy Esc), then persist
    s.title = title;
    const k = sessionKey(s);
    for (const a of allSessions) {
      if (sessionKey(a) === k) a.title = title;
    }
    statusLine = `renamed → ${title.length > 48 ? title.slice(0, 48) + "…" : title}`;
    fullPaint();

    const result = renameSession(s, title);
    if (!result.ok) {
      s.title = prev;
      for (const a of allSessions) {
        if (sessionKey(a) === k) a.title = prev;
      }
      statusLine = `rename failed: ${result.error ?? "unknown"}`;
      fullPaint();
    }
  }

  function goPage(dir: 1 | -1): void {
    const prevC = cursor;
    const prevO = offset;
    cursor = Math.max(0, Math.min(list.length - 1, cursor + dir * layout.page));
    clampScroll();
    paintSelectionChange(prevC, prevO);
  }

  function goScreen(pos: "H" | "M" | "L"): void {
    const prevC = cursor;
    const prevO = offset;
    if (list.length === 0) return;
    if (pos === "H") cursor = offset;
    else if (pos === "L")
      cursor = Math.min(list.length - 1, offset + layout.page - 1);
    else cursor = Math.min(list.length - 1, offset + Math.floor(layout.page / 2));
    paintSelectionChange(prevC, prevO);
  }

  function centerCursor(): void {
    const prevO = offset;
    const prevC = cursor;
    offset = Math.max(
      0,
      Math.min(
        Math.max(0, list.length - layout.page),
        cursor - Math.floor(layout.page / 2),
      ),
    );
    paintSelectionChange(prevC, prevO);
  }

  function onResize(): void {
    cols = stdout.columns || 80;
    rows = stdout.rows || 24;
    layout = computeLayout(cols, rows);
    clampScroll();
    if (detailView === "chat") {
      const inner = Math.max(8, layout.detailW - 2);
      rebuildChatLines(inner);
      chatOffset = Math.min(chatOffset, chatMaxOffset());
    }
    fullPaint();
  }

  /**
   * Re-scan sessions from disk. Skips while typing (rename / : / search).
   * Preserves cursor target, multi-select, and pending deletes by key.
   */
  function refreshFromDisk(): void {
    if (!options.reload) return;
    if (renameMode || cmdMode || filterMode || tagAssignMode || helpMode)
      return;
    // Avoid clobbering chat scroll mid-read
    if (focusPane === "detail" && detailView === "chat") return;

    const focusKey = list[cursor] ? sessionKey(list[cursor]!) : null;
    let fresh: SessionRecord[];
    try {
      fresh = options.reload();
    } catch {
      return;
    }

    allSessions = fresh;
    now = Date.now();

    // Drop multi-select keys that no longer exist
    const live = new Set(allSessions.map(sessionKey));
    for (const k of [...multiSelect]) {
      if (!live.has(k)) multiSelect.delete(k);
    }

    rebuildList();
    if (focusKey) {
      const idx = list.findIndex((s) => sessionKey(s) === focusKey);
      if (idx >= 0) cursor = idx;
    }
    clampScroll();
    dropChatIfCursorMoved();
    fullPaint();
  }

  rebuildList();
  readline.emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  write(altEnter() + hideCursor());
  fullPaint();
  stdout.on("resize", onResize);

  const refreshTimer = options.reload
    ? setInterval(() => {
        refreshFromDisk();
      }, REFRESH_MS)
    : null;

  await new Promise<void>((resolve) => {
    const cleanup = (): void => {
      if (refreshTimer) clearInterval(refreshTimer);
      clearPending();
      stdout.off("resize", onResize);
      stdin.off("keypress", onKey);
      if (stdin.isTTY) stdin.setRawMode(false);
      write(showCursor() + altLeave());
      stdin.pause();
    };

    const onKey = (_str: string | undefined, key: readline.Key): void => {
      const str = _str ?? "";

      // ----- :help overlay (first) -----
      if (helpMode) {
        if (
          key.name === "escape" ||
          key.name === "return" ||
          key.name === "q" ||
          str === "q"
        ) {
          helpMode = false;
          helpOffset = 0;
          fullPaint();
          return;
        }
        if (key.name === "up" || key.name === "k") {
          helpOffset = Math.max(0, helpOffset - 1);
          fullPaint();
          return;
        }
        if (key.name === "down" || key.name === "j") {
          helpOffset += 1;
          fullPaint();
          return;
        }
        if (key.name === "pageup" || (key.ctrl && key.name === "b")) {
          helpOffset = Math.max(0, helpOffset - layout.page);
          fullPaint();
          return;
        }
        if (key.name === "pagedown" || (key.ctrl && key.name === "f")) {
          helpOffset += layout.page;
          fullPaint();
          return;
        }
        return;
      }

      // Ctrl-C does not quit (avoid losing pending deletes silently).
      if (key.ctrl && key.name === "c") {
        statusLine =
          pendingDelete.size > 0
            ? `${pendingDelete.size} pending · :wq apply · :q! discard`
            : "use :q to quit (or :wq)";
        paintFooter();
        return;
      }

      // full page only (no ctrl-d/u half-page)
      if (key.ctrl && (key.name === "f" || str === "\u0006")) {
        clearPending();
        if (focusPane === "detail" && detailView === "chat") {
          scrollChat(layout.page);
          return;
        }
        goPage(1);
        return;
      }
      if (key.ctrl && (key.name === "b" || str === "\u0002")) {
        clearPending();
        if (focusPane === "detail" && detailView === "chat") {
          scrollChat(-layout.page);
          return;
        }
        goPage(-1);
        return;
      }

      // ----- tag assign (t): left rail picker + new name -----
      if (tagAssignMode) {
        if (key.name === "escape" || str === "\x1b") {
          cancelTagAssign();
          return;
        }
        if (key.name === "return") {
          commitTagAssign();
          return;
        }
        const tags = listTags();
        const nItems = tags.length + 2; // new + tags + clear
        if (key.name === "up") {
          tagAssignCursor = Math.max(0, tagAssignCursor - 1);
          paintTagRail();
          paintFooter();
          return;
        }
        if (key.name === "down") {
          tagAssignCursor = Math.min(nItems - 1, tagAssignCursor + 1);
          paintTagRail();
          paintFooter();
          return;
        }
        if (tagAssignCursor === 0) {
          if (key.name === "backspace") {
            tagAssignBuf = tagAssignBuf.slice(0, -1);
            paintTagRail();
            paintFooter();
            return;
          }
          if (key.ctrl && key.name === "u") {
            tagAssignBuf = "";
            paintTagRail();
            paintFooter();
            return;
          }
          if (str && !key.ctrl && !key.meta && str >= " ") {
            // only allow slug chars
            if (/[A-Za-z0-9_-]/.test(str)) {
              tagAssignBuf += str.toLowerCase();
              paintTagRail();
              paintFooter();
            }
            return;
          }
        }
        return;
      }

      // ----- rename mode (i): type into TITLE column -----
      if (renameMode) {
        if (key.name === "escape" || str === "\x1b") {
          exitRenameKeep();
          return;
        }
        if (key.name === "return") {
          exitRenameKeep();
          return;
        }
        if (key.name === "backspace") {
          renameBuf = renameBuf.slice(0, -1);
          paintRenameLive();
          return;
        }
        if (key.ctrl && key.name === "u") {
          renameBuf = "";
          paintRenameLive();
          return;
        }
        if (
          key.name === "up" ||
          key.name === "down" ||
          key.name === "pageup" ||
          key.name === "pagedown"
        ) {
          return;
        }
        if (str && !key.ctrl && !key.meta && str >= " ") {
          renameBuf += str;
          paintRenameLive();
          return;
        }
        return;
      }

      // ----- command-line mode (:empty :missing :bad :wq …) -----
      if (cmdMode) {
        if (key.name === "escape") {
          cmdMode = false;
          cmdBuf = "";
          paintFooter();
          return;
        }
        if (key.name === "return") {
          const cmd = cmdBuf;
          cmdMode = false;
          cmdBuf = "";
          runExCommand(cmd, () => {
            cleanup();
            resolve();
          });
          return;
        }
        if (key.name === "backspace") {
          cmdBuf = cmdBuf.slice(0, -1);
          paintFooter();
          return;
        }
        if (str && !key.ctrl && !key.meta && str >= " ") {
          cmdBuf += str;
          paintFooter();
          return;
        }
        return;
      }

      // ----- vim `/` search -----
      // Prompt shows `/` as chrome (not in buffer). Backspace on empty exits.
      if (filterMode) {
        if (key.name === "escape") {
          // abort: restore filter as before `/`
          filter = filterBeforeSearch;
          filterMode = false;
          rebuildList();
          fullPaint();
          return;
        }
        if (key.name === "return") {
          // apply: keep current filter, leave search mode
          filterMode = false;
          rebuildList();
          fullPaint();
          return;
        }
        if (key.name === "backspace" || key.name === "delete") {
          if (filter.length === 0) {
            // empty pattern + BS → leave `/` (vim cancels empty search)
            filterMode = false;
            filter = filterBeforeSearch;
            rebuildList();
            fullPaint();
            return;
          }
          filter = filter.slice(0, -1);
          rebuildList();
          fullPaint();
          return;
        }
        if (key.ctrl && key.name === "u") {
          filter = "";
          rebuildList();
          fullPaint();
          return;
        }
        if (str && !key.ctrl && !key.meta && str >= " ") {
          filter += str;
          rebuildList();
          fullPaint();
          return;
        }
        return;
      }

      // pending multi-key
      if (pending === "d") {
        clearPending();
        if (str === "d") {
          doDeleteMark();
          return;
        }
      }
      if (pending === "g") {
        clearPending();
        if (str === "g") {
          const prevC = cursor;
          const prevO = offset;
          cursor = 0;
          clampScroll();
          paintSelectionChange(prevC, prevO);
          return;
        }
      }
      if (pending === "y") {
        clearPending();
        if (str === "y") {
          doYank();
          return;
        }
      }

      // bare q does not quit (use :q / :wq); Esc closes chat / clears multi-select
      if (key.name === "q") {
        statusLine =
          pendingDelete.size > 0
            ? `${pendingDelete.size} pending · :wq apply · :q! discard`
            : "use :q to quit (or :wq)";
        paintFooter();
        return;
      }
      if (key.name === "escape" && !filterMode) {
        // full message → list → sessions
        if (detailView === "chat" && collapseChatExpand()) return;
        if (detailView === "chat" || focusPane === "detail") {
          closeChat();
          return;
        }
        if (multiSelect.size > 0) {
          clearMultiSelect();
          return;
        }
        statusLine =
          pendingDelete.size > 0
            ? `${pendingDelete.size} pending · :wq apply · :q! discard`
            : "use :q to quit (or :wq)";
        paintFooter();
        return;
      }
      if (str === ":") {
        clearPending();
        cmdMode = true;
        cmdBuf = "";
        paintFooter();
        return;
      }
      // vim `/` — open search (prompt only; `/` is not typed into the buffer)
      if (str === "/") {
        clearPending();
        filterBeforeSearch = filter;
        filter = ""; // fresh pattern each `/` (vim starts empty)
        filterMode = true;
        rebuildList();
        fullPaint();
        return;
      }
      // Tab: sessions ↔ tags (chat is view-only; Esc leaves chat → sessions)
      if (key.name === "tab") {
        clearPending();
        if (focusPane === "detail" || detailView === "chat") {
          // Leave chat and land on middle session column
          closeChat();
          return;
        }
        if (focusPane === "sessions") {
          focusPane = "tags";
          clampTagScroll();
        } else {
          focusPane = "sessions";
        }
        fullPaint();
        return;
      }

      // Space: toggle multi-select (sessions only)
      if (str === " " || key.name === "space") {
        if (focusPane !== "sessions") return;
        clearPending();
        doToggleMultiSelect();
        return;
      }
      // * — star / unstar
      if (str === "*") {
        if (focusPane !== "sessions") return;
        clearPending();
        doToggleStar();
        return;
      }
      // t — assign tag for current session (left rail)
      if (str === "t") {
        if (focusPane !== "sessions") return;
        startTagAssign();
        return;
      }
      // i: rename
      if (str === "i") {
        if (focusPane !== "sessions") return;
        startRename();
        return;
      }
      if (str === "c") {
        if (focusPane === "detail") return;
        filter = "";
        sourceIdx = 0;
        healthIdx = 0;
        tagFilter = null;
        tagCursor = 0;
        tagOffset = 0;
        multiSelect.clear();
        statusLine = "";
        rebuildList();
        dropChatIfCursorMoved();
        fullPaint();
        return;
      }
      if (str === "s") {
        if (focusPane === "detail") return;
        sourceIdx = (sourceIdx + 1) % SOURCES.length;
        cursor = 0;
        offset = 0;
        rebuildList();
        dropChatIfCursorMoved();
        fullPaint();
        return;
      }
      if (str === "h") {
        if (focusPane === "detail") return;
        healthIdx = (healthIdx + 1) % HEALTH_FILTERS.length;
        cursor = 0;
        offset = 0;
        rebuildList();
        dropChatIfCursorMoved();
        fullPaint();
        return;
      }
      if (str === "H") {
        if (focusPane === "detail") return;
        goScreen("H");
        return;
      }
      if (str === "M") {
        if (focusPane === "detail") return;
        goScreen("M");
        return;
      }
      if (str === "L") {
        if (focusPane === "detail") return;
        goScreen("L");
        return;
      }
      if (str === "z") {
        if (focusPane === "detail") return;
        centerCursor();
        return;
      }
      if (str === "d") {
        if (focusPane === "detail") return;
        armPending("d");
        return;
      }
      if (str === "g") {
        if (focusPane === "detail") return;
        armPending("g");
        return;
      }
      if (str === "y" || str === "r") {
        if (focusPane === "detail") return;
        if (str === "y") armPending("y");
        else doYank();
        return;
      }
      if (str === "u") {
        if (focusPane === "detail") return;
        doUndo();
        return;
      }
      if (str === "G") {
        if (focusPane === "detail") return;
        const prevC = cursor;
        const prevO = offset;
        cursor = Math.max(0, list.length - 1);
        clampScroll();
        paintSelectionChange(prevC, prevO);
        return;
      }

      // navigation depends on focus pane
      if (focusPane === "tags") {
        const labels = tagRailLabels();
        if (key.name === "up") {
          tagCursor = Math.max(0, tagCursor - 1);
          const lab = labels[tagCursor];
          tagFilter = !lab || lab === "all" ? null : lab;
          cursor = 0;
          offset = 0;
          rebuildList();
          dropChatIfCursorMoved();
          fullPaint();
          return;
        }
        if (key.name === "down") {
          tagCursor = Math.min(labels.length - 1, tagCursor + 1);
          const lab = labels[tagCursor];
          tagFilter = !lab || lab === "all" ? null : lab;
          cursor = 0;
          offset = 0;
          rebuildList();
          dropChatIfCursorMoved();
          fullPaint();
          return;
        }
        if (key.name === "return") {
          // confirm filter (already live) → back to sessions
          focusPane = "sessions";
          fullPaint();
          return;
        }
        return;
      }

      // Chat: list previews / expanded full text
      if (focusPane === "detail") {
        if (key.name === "return") {
          if (detailView === "chat") expandChatAtCursor();
          return;
        }
        if (key.name === "up") {
          scrollChat(-1);
          return;
        }
        if (key.name === "down") {
          scrollChat(1);
          return;
        }
        if (key.name === "pageup") {
          scrollChat(-layout.page);
          return;
        }
        if (key.name === "pagedown") {
          scrollChat(layout.page);
          return;
        }
        return;
      }

      // sessions focus
      if (key.name === "return") {
        clearPending();
        openChatForCursor();
        return;
      }

      const prevCursor = cursor;
      const prevOffset = offset;
      if (key.name === "up") {
        cursor = Math.max(0, cursor - 1);
        clampScroll();
        paintSelectionChange(prevCursor, prevOffset);
        return;
      }
      if (key.name === "down") {
        cursor = Math.min(list.length - 1, cursor + 1);
        clampScroll();
        paintSelectionChange(prevCursor, prevOffset);
        return;
      }
      if (key.name === "pageup") {
        goPage(-1);
        return;
      }
      if (key.name === "pagedown") {
        goPage(1);
        return;
      }
    };

    stdin.on("keypress", onKey);
  });
}
