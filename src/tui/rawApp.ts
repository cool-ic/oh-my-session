/**
 * Differential TUI — brand header + data table + detail pane.
 *
 * Columns (display width):
 *   mark2 | status8 | source6 | age5 | msgs5 | title flex | resumeDir flex
 *
 * Keys: ↑↓ Space i gg G dd u y / : … ctrl-f/b H M L
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

/** Fixed column widths (display cols) */
const LC = {
  mark: 2,
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
const RESET = `${ESC}[0m`;
const TOOL_NAME = "agent-session-history";

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [200, 200, 200];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function fg(hex: string, text: string): string {
  const [r, g, b] = hexRgb(hex);
  return `${ESC}[38;2;${r};${g};${b}m${text}${RESET}`;
}

function fgBg(fgHex: string, bgHex: string, text: string): string {
  const [fr, fg_, fb] = hexRgb(fgHex);
  const [br, bg_, bb] = hexRgb(bgHex);
  return `${ESC}[38;2;${fr};${fg_};${fb}m${ESC}[48;2;${br};${bg_};${bb}m${text}${RESET}`;
}

function hideCursor(): string {
  return `${ESC}[?25l`;
}
function showCursor(): string {
  return `${ESC}[?25h`;
}
function altEnter(): string {
  return `${ESC}[?1049h${ESC}[H${ESC}[2J`;
}
function altLeave(): string {
  return `${ESC}[?1049l`;
}
function move(row: number, col = 1): string {
  return `${ESC}[${row};${col}H`;
}
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
  if (visWidth(s) <= limit) return s.includes("\x1b[0m") ? s : s + RESET;
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
  return out + "…" + RESET;
}

function padAnsi(s: string, width: number): string {
  const clipped = clipAnsi(s, width);
  const pad = width - visWidth(clipped);
  return clipped + (pad > 0 ? " ".repeat(pad) : "");
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
  listW: number;
  detailW: number;
  detailCol: number;
  titleW: number;
  pathW: number;
  page: number;
  rowBrand: number;
  rowRuleBrand: number; // brand ↔ table
  rowColHead: number;
  rowRuleHead: number; // header ↔ data
  rowList0: number;
  rowDetail0: number;
  rowRuleFoot: number; // table ↔ footer
  rowFooter: number;
  detailBodyRows: number;
}

/**
 * Vertical rhythm (1-based rows):
 *   brand
 *   ════  ruleBrand   brand ↔ table
 *   colHead | detail top
 *   ────  ruleHead    header ↔ data
 *   list… | detail body
 *   ────  ruleFoot    content ↔ footer
 *   footer
 */
function computeLayout(cols: number, rows: number): Layout {
  const split = cols >= 110;
  const rowBrand = 1;
  const rowRuleBrand = 2;
  const rowColHead = 3;
  const rowRuleHead = 4;
  const rowList0 = 5;
  const rowFooter = rows;
  const rowRuleFoot = rows - 1;
  // chrome: brand, ruleB, colHead, ruleH, ruleF, footer = 6
  const chrome = 6;

  if (split) {
    let detailW = Math.min(42, Math.max(34, Math.floor(cols * 0.32)));
    let listW = cols - detailW - 1;
    if (listW < LC_FIXED + 20) {
      listW = LC_FIXED + 20;
      detailW = Math.max(28, cols - listW - 1);
    }
    const rest = Math.max(12, listW - LC_FIXED);
    const titleW = Math.max(10, Math.floor(rest * 0.52));
    const pathW = Math.max(8, rest - titleW);
    const page = Math.max(6, rows - chrome);
    return {
      cols,
      rows,
      split: true,
      listW,
      detailW,
      detailCol: listW + 2,
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
  const detailBox = 2 + detailBodyRows; // top + body + bot, bot shares ruleFoot-ish
  const page = Math.max(5, rows - chrome - detailBox + 1);
  const rest = Math.max(12, cols - LC_FIXED);
  const titleW = Math.max(10, Math.floor(rest * 0.55));
  const pathW = Math.max(8, rest - titleW);
  return {
    cols,
    rows,
    split: false,
    listW: cols,
    detailW: cols,
    detailCol: 1,
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

  function filteredList(): SessionRecord[] {
    const sourceFilter = SOURCES[sourceIdx];
    const healthFilter = HEALTH_FILTERS[healthIdx];
    const q = filter.trim().toLowerCase();
    return allSessions.filter((s) => {
      if (pendingDelete.has(sessionKey(s))) return false;
      if (sourceFilter !== "all" && s.source !== sourceFilter) return false;
      if (healthFilter !== "all" && healthOf(s) !== healthFilter) return false;
      if (!q) return true;
      return [s.title, s.id, s.cwd ?? "", s.source]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
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

  function write(s: string): void {
    stdout.write(s);
  }

  function paintCell(
    row: number,
    col: number,
    width: number,
    content: string,
  ): void {
    write(move(row, col) + padAnsi(content, width));
  }

  function paintFullRow(row: number, content: string): void {
    write(move(row, 1) + clearLine() + padAnsi(content, layout.cols));
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
    const editing = renameMode && isCursor;
    const markPlain = isCursor
      ? isMulti
        ? "▌*"
        : "▌ "
      : isMulti
        ? " *"
        : "  ";
    const statusPlain = padEndWidth(
      h === "ok" ? "OK" : h === "empty" ? "Empty" : "Missing",
      LC.status,
    );
    const srcPlain = sourcePlain(s.source);
    const agePlain = padStartWidth(formatAge(s.lastActive, now), LC.age);
    const msgsPlain = padStartWidth(String(s.messageCount), LC.msgs);
    const titlePlain = editing
      ? titleRenameCell(layout.titleW)
      : padEndWidth(s.title.replace(/\s+/g, " "), layout.titleW);
    const pathPlain = pathCellPlain(s);

    const style =
      editing
        ? { fg: theme.editFg, bg: theme.editBg }
        : isCursor
          ? { fg: theme.selectFg, bg: theme.selectBg }
          : isMulti
            ? { fg: theme.multiFg, bg: theme.multiBg }
            : null;

    if (style) {
      const plain =
        markPlain +
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
      return fgBg(style.fg, style.bg, padEndWidth(plain, layout.listW));
    }

    const pathColored = s.extra?.cwdMissing
      ? fg(theme.missing, pathPlain)
      : fg(theme.dim, pathPlain);

    return padAnsi(
      markPlain +
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
    paintCell(row, 1, layout.listW, buildListRow(abs, abs === cursor));
    if (layout.split) {
      paintCell(row, layout.listW + 1, 1, fg(theme.border, "│"));
    }
  }

  function paintAllList(): void {
    for (let i = 0; i < layout.page; i++) paintListSlot(i);
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
          key("Space") +
          hint(" select") +
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
        tag(" row ") + key("Space") + mid + key("i") + mid + key("dd"),
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
        tag("row") + key("Sp") + mid + key("i") + mid + key("dd"),
        tag("bulk") + key(":e") + mid + key(":m") + mid + key(":bad"),
        tag("y") + key("y") + mid + tag("/") + key("/"),
        tag("q") + key(":q") + mid + key(":wq"),
      ].join(soft),
      // minimal
      [
        name,
        key("↑↓"),
        key("Space") + mid + key("i") + mid + key("dd"),
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
    if (!L.split) {
      const ch = kind === "brand" ? "═" : "─";
      const color = kind === "brand" ? theme.border : theme.line;
      paintFullRow(row, fg(color, ch.repeat(L.cols)));
      return;
    }

    const lw = L.listW;
    const dw = L.detailW;
    if (kind === "brand") {
      // ═══════════════╤════════════
      paintFullRow(
        row,
        fg(theme.border, "═".repeat(lw) + "╤" + "═".repeat(dw)),
      );
      return;
    }
    if (kind === "head") {
      // under column header; join detail pane
      paintCell(row, 1, lw, fg(theme.line, "─".repeat(lw)));
      paintCell(row, lw + 1, 1, fg(theme.border, "┼"));
      paintCell(
        row,
        L.detailCol,
        dw,
        fg(theme.border, "─".repeat(Math.max(0, dw - 1)) + "┤"),
      );
      return;
    }
    // foot rule above status bar
    paintCell(row, 1, lw, fg(theme.line, "─".repeat(lw)));
    paintCell(row, lw + 1, 1, fg(theme.border, "┴"));
    paintCell(
      row,
      L.detailCol,
      dw,
      fg(theme.border, "─".repeat(Math.max(0, dw - 1)) + "┘"),
    );
  }

  /**
   * Detail: only action payload the table lacks.
   * No tutorial Notes (command is enough). No Store/Created clutter.
   */
  function detailBody(innerW: number): string[] {
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
    push(s.id, theme.title);
    lines.push("");

    pushLabel("Resume command  (y copy)");
    let rest = resumeInfo(s).command;
    let guard = 0;
    while (rest && guard++ < 6) {
      if (displayWidth(rest) <= innerW) {
        push(rest, theme.action);
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
      push(chunk, theme.action);
      rest = rest.slice(chunk.length);
    }

    return lines;
  }

  function paintDetail(): void {
    const L = layout;
    const dw = L.detailW;
    const inner = Math.max(8, dw - 2);
    const body = detailBody(inner);
    const col = L.detailCol;

    if (L.split) {
      // gutter already has │; paint body + right border only
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
      paintFullRow(top, fg(theme.border, boxTop("Detail", dw)));
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

  function paintFooter(): void {
    if (renameMode) {
      // Text is edited in the TITLE column; footer is only a short hint
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
    if (filter) msg = `filter "${filter}"`;
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
            " Space select · i rename · dd delete · :q quit · :wq",
          ),
    );
  }

  function fullPaint(): void {
    write(move(1, 1) + `${ESC}[0J`);
    paintBrand();
    paintRule(layout.rowRuleBrand, "brand");

    if (layout.split) {
      paintCell(layout.rowColHead, 1, layout.listW, buildColHeader());
      // vertical join between ╤ and ┼
      paintCell(layout.rowColHead, layout.listW + 1, 1, fg(theme.border, "│"));
      // detail header: label + right border
      paintCell(
        layout.rowColHead,
        layout.detailCol,
        layout.detailW,
        fg(theme.accent, padEndWidth(" Detail", layout.detailW - 1)) +
          fg(theme.border, "│"),
      );
      paintRule(layout.rowRuleHead, "head");
    } else {
      paintFullRow(layout.rowColHead, buildColHeader());
      paintRule(layout.rowRuleHead, "head");
    }

    paintAllList();
    if (layout.split) {
      for (let i = 0; i < layout.page; i++) {
        paintCell(
          layout.rowList0 + i,
          layout.listW + 1,
          1,
          fg(theme.border, "│"),
        );
      }
    }
    paintDetail();
    paintRule(layout.rowRuleFoot, "foot");
    paintFooter();
    write(move(layout.rowFooter, 1));
  }

  function paintSelectionChange(prevCursor: number, prevOffset: number): void {
    if (offset !== prevOffset) {
      paintAllList();
      if (layout.split) {
        for (let i = 0; i < layout.page; i++) {
          paintCell(
            layout.rowList0 + i,
            layout.listW + 1,
            1,
            fg(theme.border, "│"),
          );
        }
      }
    } else {
      const a = prevCursor - offset;
      const b = cursor - offset;
      if (a >= 0 && a < layout.page) paintListSlot(a);
      if (b >= 0 && b < layout.page && b !== a) paintListSlot(b);
    }
    paintBrand();
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
   * If multi-select is non-empty, mark every selected item; else current row.
   */
  function doDeleteMark(): void {
    const targets: SessionRecord[] = [];
    if (multiSelect.size > 0) {
      for (const s of allSessions) {
        const k = sessionKey(s);
        if (multiSelect.has(k) && !pendingDelete.has(k)) targets.push(s);
      }
    } else {
      const s = list[cursor];
      if (s) targets.push(s);
    }
    if (targets.length === 0) {
      statusLine = "nothing to delete";
      paintFooter();
      return;
    }
    for (const s of targets) {
      const k = sessionKey(s);
      pendingDelete.set(k, s);
      undoStack.push(s);
      multiSelect.delete(k);
    }
    statusLine =
      targets.length === 1
        ? `marked delete ${shortId(targets[0].id, 8)}  ·  u undo  ·  :wq apply`
        : `marked delete ${targets.length} sessions  ·  u undo  ·  :wq apply`;
    rebuildList();
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
        statusLine = ":empty :missing :bad · :sel e|m|bad|none · :q · :q! · :wq";
        paintFooter();
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
    fullPaint();
  }

  /**
   * Re-scan sessions from disk. Skips while typing (rename / : / search).
   * Preserves cursor target, multi-select, and pending deletes by key.
   */
  function refreshFromDisk(): void {
    if (!options.reload) return;
    if (renameMode || cmdMode || filterMode) return;

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
        goPage(1);
        return;
      }
      if (key.ctrl && (key.name === "b" || str === "\u0002")) {
        clearPending();
        goPage(-1);
        return;
      }

      // ----- rename mode (i): type into TITLE column -----
      // Esc once = leave insert (vim), keep content — handled first for snappy feel
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
        // Ctrl-U clear buffer (vim-ish)
        if (key.ctrl && key.name === "u") {
          renameBuf = "";
          paintRenameLive();
          return;
        }
        // Block navigation while editing title
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

      // bare q does not quit (use :q / :wq); Esc clears multi-select if any
      if (key.name === "q") {
        statusLine =
          pendingDelete.size > 0
            ? `${pendingDelete.size} pending · :wq apply · :q! discard`
            : "use :q to quit (or :wq)";
        paintFooter();
        return;
      }
      if (key.name === "escape" && !filterMode) {
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
      // Space: toggle multi-select
      if (str === " " || key.name === "space") {
        clearPending();
        doToggleMultiSelect();
        return;
      }
      // i: rename (insert) current session title
      if (str === "i") {
        startRename();
        return;
      }
      if (str === "c") {
        filter = "";
        sourceIdx = 0;
        healthIdx = 0;
        multiSelect.clear();
        statusLine = "";
        rebuildList();
        fullPaint();
        return;
      }
      if (str === "s" || key.name === "tab") {
        sourceIdx = (sourceIdx + 1) % SOURCES.length;
        cursor = 0;
        offset = 0;
        rebuildList();
        fullPaint();
        return;
      }
      if (str === "h") {
        healthIdx = (healthIdx + 1) % HEALTH_FILTERS.length;
        cursor = 0;
        offset = 0;
        rebuildList();
        fullPaint();
        return;
      }
      if (str === "H") {
        goScreen("H");
        return;
      }
      if (str === "M") {
        goScreen("M");
        return;
      }
      if (str === "L") {
        goScreen("L");
        return;
      }
      if (str === "z") {
        centerCursor();
        return;
      }
      if (str === "d") {
        armPending("d");
        return;
      }
      if (str === "g") {
        armPending("g");
        return;
      }
      if (str === "y" || str === "r") {
        if (str === "y") armPending("y");
        else doYank();
        return;
      }
      if (str === "u") {
        doUndo();
        return;
      }
      if (str === "G") {
        const prevC = cursor;
        const prevO = offset;
        cursor = Math.max(0, list.length - 1);
        clampScroll();
        paintSelectionChange(prevC, prevO);
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
