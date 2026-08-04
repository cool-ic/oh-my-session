/**
 * Differential TUI — brand header + data table + detail pane.
 *
 * Columns (display width):
 *   mark2 | status8 | source6 | age5 | msgs5 | title flex | resumeDir flex
 *
 * Keys: ↑↓ Enter Space i gg G dd u y / : …
 * Enter = open chat message list (previews); Enter again = full text;
 * Space = toggle multi-select; i = rename title (insert);
 * :empty / :missing / :bad = bulk-select by health (ex cmdline);
 * dd = mark selection (or cursor) for delete; :wq applies deletes & exits;
 * :q quits if no pending deletes; :q! discards marks and quits.
 * Auto-refresh every 8s when reload is provided.
 */
import type { AgentSource, SessionHealth, SessionRecord } from "../types.js";
import { attachKeys, type AppKey } from "../lib/keys.js";
import { formatAge } from "../lib/time.js";
import { resumeHint, resumeInfo, shortId } from "../lib/format.js";
import { copyToClipboard } from "../lib/clipboard.js";
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
import {
  auditRetention,
  fixRetentionFindings,
  retentionWarning,
  type RetentionAgent,
  type RetentionFinding,
} from "../lib/retention.js";
import {
  ackedRetentionRisks,
  ignoreRetentionAgents,
  loadRetentionPrefs,
  pendingRetentionRisks,
  unignoreRetentionAgents,
} from "../lib/retention-prefs.js";
import { sortKeyLastActive } from "../lib/time.js";
import {
  displayWidth,
  padEndWidth,
  padStartWidth,
  truncateWidth,
} from "../lib/width.js";
import {
  loadLocale,
  saveLocale,
  type Locale,
} from "../lib/locale-store.js";
import { helpGroups, setLocale, t } from "../lib/i18n.js";
import { GITHUB_REPO_URL, openUrl } from "../lib/open-url.js";
import {
  scheduleUpdateCheck,
  type UpdateInfo,
} from "../lib/update-check.js";
import { theme } from "./theme.js";

/** Session list auto-refresh interval */
const REFRESH_MS = 8000;

export interface RawTuiOptions {
  /** Re-discover + enrich sessions (used every REFRESH_MS) */
  reload?: () => SessionRecord[];
}

/**
 * List table geometry (display columns).
 *
 * Layout:
 *   mark | star | gap | STATUS | gap | SOURCE | gap | AGE | gap | MSGS
 *        | gap | TITLE (flex) | gap | RESUME DIR (flex)
 *
 * Gaps are hard floors so dense fixed columns never glue together; TITLE/RESUME
 * share remaining width with caps so TITLE does not starve the path.
 */
const LC = {
  mark: 2, // cursor ▌ + multi # (not * — * is pin/star only)
  star: 3, // * / · cell (ASCII-safe; ★/☆ missing in many mono fonts)
  /** Gaps (min floors, display cols) */
  gs: 1, // star → STATUS (icon column, 1 is enough)
  g1: 2, // STATUS → SOURCE
  g2: 2, // SOURCE → AGE
  g3: 2, // AGE → MSGS
  g4: 2, // MSGS → TITLE  (was 1 — too tight)
  g5: 2, // TITLE → RESUME DIR
  /** Fixed data columns */
  status: 8,
  source: 6,
  age: 5,
  msgs: 5,
} as const;

/** Min TITLE / RESUME DIR content widths after fixed columns + gaps. */
const FLEX_MIN = {
  title: 12,
  path: 12,
  /** title share of flex remainder (before cap) */
  titleRatio: 0.38,
  titleCap: 36,
  titleCapNarrow: 40,
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
const TOOL_NAME = "oh-my-session";

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [200, 200, 200];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Default cell style: body text on our painted canvas (light theme). */
function sgrDefault(): string {
  const [fr, fg_, fb] = hexRgb(theme.text);
  const [br, bg_, bb] = hexRgb(theme.canvas);
  return `${ESC}[0m${ESC}[38;2;${fr};${fg_};${fb}m${ESC}[48;2;${br};${bg_};${bb}m`;
}

/**
 * Foreground on canvas. Always pairs with canvas BG so host terminal defaults
 * never leak through after RESET.
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

/** Pad to width; trailing spaces use padBg so selection/zebra never seams. */
function padAnsi(s: string, width: number, padBg: string = theme.canvas): string {
  const clipped = clipAnsi(s, width);
  const pad = width - visWidth(clipped);
  if (pad <= 0) return clipped;
  return clipped + fgOn(padBg, theme.text, " ".repeat(pad));
}

function healthLabel(h: SessionHealth): string {
  if (h === "ok") return t("health.ok");
  if (h === "empty") return t("health.empty");
  return t("health.missing");
}

function statusChip(h: SessionHealth, rowBg?: string): string {
  const plain = padEndWidth(healthLabel(h), LC.status);
  // Pills keep their own fill; rowBg unused (kept for call-site symmetry).
  void rowBg;
  if (h === "ok") return fgBg(theme.pill.okFg, theme.pill.okBg, plain);
  if (h === "empty") return fgBg(theme.pill.emptyFg, theme.pill.emptyBg, plain);
  return fgBg(theme.pill.missingFg, theme.pill.missingBg, plain);
}

/** Foreground on an explicit row background (zebra / surface). */
function fgOn(bgHex: string, fgHex: string, text: string): string {
  return fgBg(fgHex, bgHex, text);
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
    const listMin = LC_FIXED + FLEX_MIN.title + FLEX_MIN.path;
    if (listW < listMin) {
      listW = listMin;
      detailW = Math.max(26, afterTag - listW - gutter);
    }
    const rest = Math.max(
      FLEX_MIN.title + FLEX_MIN.path,
      listW - LC_FIXED,
    );
    // Prefer RESUME DIR over a huge empty TITLE pad on wide terminals.
    let titleW = Math.max(
      FLEX_MIN.title,
      Math.min(FLEX_MIN.titleCap, Math.floor(rest * FLEX_MIN.titleRatio)),
    );
    let pathW = Math.max(FLEX_MIN.path, rest - titleW);
    // If path stole min and overshoot, shrink title but keep its floor.
    if (titleW + pathW > rest) {
      titleW = Math.max(FLEX_MIN.title, rest - pathW);
      pathW = rest - titleW;
    }
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
  const rest = Math.max(FLEX_MIN.title + FLEX_MIN.path, listW - LC_FIXED);
  let titleW = Math.max(
    FLEX_MIN.title,
    Math.min(FLEX_MIN.titleCapNarrow, Math.floor(rest * FLEX_MIN.titleRatio)),
  );
  let pathW = Math.max(FLEX_MIN.path, rest - titleW);
  if (titleW + pathW > rest) {
    titleW = Math.max(FLEX_MIN.title, rest - pathW);
    pathW = rest - titleW;
  }
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
  /** Cursor index into [...renameBuf] (grapheme units via string spread). */
  let renamePos = 0;
  /** Title when edit started — used only if empty commit */
  let renameOrig = "";
  let cursor = 0;
  let offset = 0;
  let statusLine = "";
  /** npm update result waiting for a free main UI (not lang/retention overlays). */
  let pendingUpdate: UpdateInfo | null = null;
  let updateNoticeShown = false;
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
   * Language popup (first run blocking, or :lang).
   * First run must pick before retention / main UI.
   */
  let langMode = false;
  let langBlocking = false;
  /**
   * Retention TUI popup:
   *  - decision: at-risk agents not yet ignored → y fix / i ignore (startup blocks)
   *  - done: after fix — show results
   *  - review: status panel from :retention (safe / ignored / unignore)
   */
  let retentionFindings: RetentionFinding[] = [];
  /** atRisk ∩ ¬ignored — needs a decision */
  let retentionPending: RetentionFinding[] = [];
  /** atRisk ∩ ignored — weak footer only */
  let retentionAcked: RetentionFinding[] = [];
  let retentionMode: null | "decision" | "done" | "review" = null;
  /** Startup auto-open: must choose y or i (Esc disabled). */
  let retentionBlocking = false;
  let retentionResultLines: string[] = [];
  /** Session-local success strip after fix. */
  let retentionJustFixed: RetentionAgent[] = [];

  function syncRetentionState(): void {
    retentionFindings = auditRetention();
    const prefs = loadRetentionPrefs();
    retentionPending = pendingRetentionRisks(retentionFindings, prefs);
    retentionAcked = ackedRetentionRisks(retentionFindings, prefs);
  }

  /** After language is known: open retention if needed. */
  function maybeOpenStartupRetention(): void {
    syncRetentionState();
    if (retentionPending.length > 0) {
      retentionMode = "decision";
      retentionBlocking = true;
    }
  }

  const savedLocale = loadLocale();
  if (savedLocale) {
    setLocale(savedLocale);
    maybeOpenStartupRetention();
  } else {
    // Bilingual chrome until user picks; blocking first-run.
    langMode = true;
    langBlocking = true;
  }
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
  /**
   * Vim-like visual select: list index where `v` started.
   * While set, cursor motion rewrites multiSelect to [anchor, cursor].
   */
  let visualAnchor: number | null = null;
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
    const q = filter.trim().toLowerCase();
    const out = allSessions.filter((s) => {
      if (pendingDelete.has(sessionKey(s))) return false;
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
   * TITLE cell while renaming: buffer with in-cell caret at renamePos.
   * Scrolls so the caret stays visible when text is wider than the column.
   */
  function titleRenameCell(width: number): string {
    const caret = "▌";
    const chars = [...renameBuf];
    const pos = Math.max(0, Math.min(renamePos, chars.length));
    const full =
      chars.slice(0, pos).join("") + caret + chars.slice(pos).join("");
    if (displayWidth(full) <= width) return padEndWidth(full, width);

    // Overflow: grow a window around the caret (prefer keeping caret visible)
    let left: string[] = [];
    let right: string[] = [];
    let used = displayWidth(caret);
    let li = pos - 1;
    let ri = pos;
    // Prefer chars left of caret first (typing at end keeps caret at right edge)
    while (li >= 0) {
      const d = displayWidth(chars[li]!);
      if (used + d > width) break;
      left.unshift(chars[li]!);
      used += d;
      li--;
    }
    while (ri < chars.length) {
      const d = displayWidth(chars[ri]!);
      if (used + d > width) break;
      right.push(chars[ri]!);
      used += d;
      ri++;
    }
    // If nothing fit on the left but we skipped left chars, mark with …
    let s = left.join("") + caret + right.join("");
    if (li >= 0) {
      // free 1 col for leading …
      while (left.length && displayWidth("…" + left.join("") + caret + right.join("")) > width) {
        left.shift();
      }
      const body = left.join("") + caret + right.join("");
      s = displayWidth("…" + body) <= width ? "…" + body : body;
    } else if (ri < chars.length) {
      while (
        right.length &&
        displayWidth(left.join("") + caret + right.join("") + "…") > width
      ) {
        right.pop();
      }
      const body = left.join("") + caret + right.join("");
      s = displayWidth(body + "…") <= width ? body + "…" : body;
    }
    return padEndWidth(s, width);
  }

  function buildListRow(abs: number, isCursor: boolean): string {
    if (abs < 0 || abs >= list.length) {
      // Empty slots continue canvas — avoid a hard grey plate under the table
      return fgOn(theme.canvas, theme.canvas, " ".repeat(layout.listW));
    }
    const s = list[abs];
    const h = healthOf(s);
    const isMulti = multiSelect.has(sessionKey(s));
    const starred = isStarred(s);
    const editing = renameMode && isCursor;
    // mark: cursor ▌ + multi # only (* reserved for pin/star column)
    const markPlain = isCursor
      ? isMulti
        ? "▌#"
        : "▌ "
      : isMulti
        ? " #"
        : "  ";
    // pin/star: * filled / · empty — avoid ★/☆ (missing glyph → tofu in many mono faces)
    const starPlain = padEndWidth(starred ? "*" : "·", LC.star);
    const gapStar = " ".repeat(LC.gs);
    const statusPlain = padEndWidth(healthLabel(h), LC.status);
    const srcPlain = sourcePlain(s.source);
    const agePlain = padStartWidth(formatAge(s.lastActive, now), LC.age);
    const msgsPlain = padStartWidth(String(s.messageCount), LC.msgs);
    // Tag only on left rail — not appended after title
    const titleRaw = s.title.replace(/\s+/g, " ");
    const titlePlain = editing
      ? titleRenameCell(layout.titleW)
      : padEndWidth(titleRaw, layout.titleW);
    const pathPlain = pathCellPlain(s);

    // Rename: flat edit wash so the in-cell caret is obvious
    if (editing) {
      const plain =
        markPlain +
        starPlain +
        gapStar +
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
      return fgBg(
        theme.editFg,
        theme.editBg,
        padEndWidth(plain, layout.listW),
      );
    }

    // Cursor / multi / zebra: keep column roles (pill, source, meta) on shared row bg
    const rowBg = isCursor
      ? theme.selectBg
      : isMulti
        ? theme.multiBg
        : abs % 2 === 1
          ? theme.zebra
          : theme.canvas;
    const on = (c: string, t: string) => fgOn(rowBg, c, t);
    const titleFg = isCursor
      ? theme.selectFg
      : isMulti
        ? theme.multiFg
        : theme.text;
    const markFg = isCursor
      ? theme.cursorBar
      : isMulti
        ? theme.multiMark
        : theme.text;
    const pathColored = s.extra?.cwdMissing
      ? on(theme.missing, pathPlain)
      : on(theme.meta, pathPlain);
    const starColored = starred
      ? on(theme.star, starPlain)
      : on(theme.starEmpty, starPlain);

    return padAnsi(
      on(markFg, markPlain) +
        starColored +
        on(theme.text, gapStar) +
        statusChip(h, rowBg) +
        on(theme.text, " ".repeat(LC.g1)) +
        on(theme.source[s.source] ?? theme.meta, srcPlain) +
        on(theme.text, " ".repeat(LC.g2)) +
        on(theme.meta, agePlain) +
        on(theme.text, " ".repeat(LC.g3)) +
        on(theme.meta, msgsPlain) +
        on(theme.text, " ".repeat(LC.g4)) +
        on(titleFg, titlePlain) +
        on(theme.text, " ".repeat(LC.g5)) +
        pathColored,
      layout.listW,
      rowBg,
    );
  }

  function buildColHeader(): string {
    const h = theme.headerBg;
    const c = theme.headerFg;
    const on = (s: string) => fgOn(h, c, s);
    // Quiet labels; age/msgs right-aligned with their number columns
    return padAnsi(
      on("  ") +
        on(padEndWidth("·", LC.star)) +
        on(" ".repeat(LC.gs)) +
        on(padEndWidth(t("col.status"), LC.status)) +
        on(" ".repeat(LC.g1)) +
        on(padEndWidth(t("col.source"), LC.source)) +
        on(" ".repeat(LC.g2)) +
        on(padStartWidth(t("col.age"), LC.age)) +
        on(" ".repeat(LC.g3)) +
        on(padStartWidth(t("col.msgs"), LC.msgs)) +
        on(" ".repeat(LC.g4)) +
        on(padEndWidth(t("col.title"), layout.titleW)) +
        on(" ".repeat(LC.g5)) +
        on(padEndWidth(t("col.resume"), layout.pathW)),
      layout.listW,
      h,
    );
  }

  /** List↔detail gutter: stronger when either pane is focused. */
  function gutterListDetail(): string {
    const c =
      focusPane === "sessions" || focusPane === "detail"
        ? theme.border
        : theme.line;
    return fg(c, "│");
  }

  /** Tags↔list gutter: stronger when tags (or assign) focused. */
  function gutterTagsList(): string {
    const c =
      focusPane === "tags" || tagAssignMode ? theme.border : theme.line;
    return fg(c, "│");
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
        gutterListDetail(),
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

    // header cell on col head row — match list header surface
    const headLabel = tagAssignMode ? t("col.assign") : t("col.tags");
    paintCell(
      L.rowColHead,
      1,
      tw,
      fgBg(
        focused ? theme.brandNameFg : theme.headerFg,
        focused ? theme.brandNameBg : theme.headerBg,
        padEndWidth(headLabel, tw),
      ),
    );
    paintCell(L.rowColHead, tw + 1, 1, gutterTagsList());

    if (tagAssignMode) {
      const tags = listTags();
      // items: 0=new, 1..tags, last=clear
      const items: Array<{ kind: "new" | "tag" | "clear"; label: string }> = [
        {
          kind: "new",
          label: tagAssignBuf ? `+${tagAssignBuf}` : t("tag.new"),
        },
        ...tags.map((name) => ({ kind: "tag" as const, label: name })),
        { kind: "clear", label: t("tag.clear") },
      ];
      const n = items.length;
      if (tagAssignCursor >= n) tagAssignCursor = Math.max(0, n - 1);
      for (let i = 0; i < L.page; i++) {
        const abs = i; // no scroll for assign for simplicity if short; scroll if needed
        const row = L.rowList0 + i;
        const item = items[abs];
        if (!item) {
          paintCell(
            row,
            1,
            tw,
            fgOn(theme.surface, theme.surface, " ".repeat(tw)),
          );
          paintCell(row, tw + 1, 1, gutterTagsList());
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
        paintCell(row, tw + 1, 1, gutterTagsList());
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
        paintCell(
          row,
          1,
          tw,
          fgOn(theme.surface, theme.surface, " ".repeat(tw)),
        );
        paintCell(row, tw + 1, 1, gutterTagsList());
        continue;
      }
      const isAll = label === "all";
      const active =
        (isAll && tagFilter == null) || (!isAll && tagFilter === label);
      const sel = focusPane === "tags" && abs === tagCursor;
      const mark = active ? "●" : " ";
      const shown = isAll ? t("tag.all") : label;
      const text = padEndWidth(` ${mark} ${shown}`, tw);
      let cell: string;
      if (sel) cell = fgBg(theme.selectFg, theme.selectBg, text);
      else if (active)
        cell = fgOn(theme.surface, theme.accent, text);
      else cell = fgOn(theme.surface, theme.dim, text);
      paintCell(row, 1, tw, cell);
      paintCell(row, tw + 1, 1, gutterTagsList());
    }
  }

  /**
   * Brand bar — visual hierarchy:
   *   1. Name mark (strong filled pill + left accent bar)
   *   2. Soft · between sections (not heavy │ walls)
   *   3. Quiet section tags (dim chips)
   *   4. Bright keys, softer word hints
   *   5. Right status cluster (pos / sel / del)
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
    const right = " " + rightBits.join(" ") + " ";
    const rightW = visWidth(right);
    const budget = Math.max(20, layout.cols - rightW);

    const variants: string[] = [
      // full — room to breathe
      [
        name,
        tag(t("brand.move")) + key("↑↓"),
        tag(t("brand.row")) +
          key("Tab") +
          hint(t("hint.tags")) +
          mid +
          key("t") +
          hint(t("hint.setTag")) +
          mid +
          key("Space") +
          hint(t("hint.select")) +
          mid +
          key("v") +
          hint(t("hint.visual")) +
          mid +
          key("*") +
          hint(t("hint.star")) +
          mid +
          key("i") +
          hint(t("hint.rename")) +
          mid +
          key("dd") +
          hint(t("hint.delete")),
        tag(t("brand.bulk")) +
          key(":empty") +
          mid +
          key(":missing") +
          mid +
          key(":bad"),
        tag(t("brand.copy")) +
          key("yy") +
          hint(t("hint.resumeCmd")) +
          soft +
          tag(t("brand.search")) +
          key("/") +
          hint(t("hint.filter")),
        tag(t("brand.quit")) + key(":q") + mid + key(":wq"),
      ].join(soft),
      // medium
      [
        name,
        tag(t("brand.move")) + key("↑↓"),
        tag(t("brand.row")) +
          key("Space") +
          mid +
          key("v") +
          mid +
          key("*") +
          mid +
          key("i") +
          mid +
          key("dd"),
        tag(t("brand.bulk")) +
          key(":empty") +
          mid +
          key(":missing") +
          mid +
          key(":bad"),
        tag(t("brand.copy")) +
          key("yy") +
          soft +
          tag(t("brand.search")) +
          key("/"),
        tag(t("brand.quit")) + key(":q") + mid + key(":wq"),
      ].join(soft),
      // compact
      [
        name,
        tag(t("brand.mv")) + key("↑↓"),
        tag(t("brand.row.short")) +
          key("Sp") +
          mid +
          key("v") +
          mid +
          key("*") +
          mid +
          key("i") +
          mid +
          key("dd"),
        tag(t("brand.bulk.short")) +
          key(":e") +
          mid +
          key(":m") +
          mid +
          key(":bad"),
        tag("yy") + key("yy") + mid + tag("/") + key("/"),
        tag("q") + key(":q") + mid + key(":wq"),
      ].join(soft),
      // minimal
      [
        name,
        key("↑↓"),
        key("Space") +
          mid +
          key("v") +
          mid +
          key("*") +
          mid +
          key("i") +
          mid +
          key("dd"),
        key(":e") + mid + key(":m") + mid + key(":bad"),
        key("yy") + mid + key("/"),
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
        return { name: t("chat.you"), nameFg: c.userName, bar: c.userBar };
      case "tool":
        return { name: "Tool", nameFg: c.toolName, bar: c.toolBar };
      case "thought":
        return { name: "Think", nameFg: c.thinkName, bar: c.thinkBar };
      default:
        return { name: t("chat.agent"), nameFg: c.agentName, bar: c.agentBar };
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
        fgBg(c.headerFg, c.headerBg, padEndWidth(t("chat.empty"), w)),
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
      const left = ` ${t("chat.messages")}`;
      const right = `${chatTurns.length} · ${t("chat.enterFull")}`;
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

    const roleCol = 6; // "Agent"/"You" or CJK roles
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
    paintEnterChat();
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

  /**
   * Close chat → sessions.
   * Minimal paint only (see paintLeaveChat) — full paintSoft still rewrote
   * every list row + brand and felt ~1s lag on WSL/Windows Terminal.
   */
  function closeChat(): void {
    resetChatState();
    focusPane = "sessions";
    statusLine = "";
    paintLeaveChat();
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

    pushLabel(t("detail.id"));
    push(s.id, theme.text);
    lines.push("");

    const tg = sessionTag(s);
    if (tg) {
      pushLabel(t("detail.tag"));
      push(tg, theme.accent);
      lines.push("");
    }

    pushLabel(t("detail.resume"));
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
    push(t("detail.enterChat"), theme.dim);

    return lines;
  }

  function detailHeaderLabel(): string {
    return detailView === "chat" ? t("col.chat") : t("col.detail");
  }

  function paintDetail(): void {
    const L = layout;
    const dw = L.detailW;
    const inner = Math.max(8, dw - 2);
    const body = detailBody(inner);
    const col = L.detailCol;

    if (L.split) {
      for (let i = 0; i < L.page; i++) {
        const raw = body[i];
        const innerCell =
          raw != null && raw !== ""
            ? padAnsi(raw, Math.max(0, dw - 1))
            : fgOn(
                theme.surface,
                theme.surface,
                " ".repeat(Math.max(0, dw - 1)),
              );
        paintCell(
          L.rowDetail0 + i,
          col,
          dw,
          innerCell + fg(theme.border, "│"),
        );
      }
    } else {
      const top = L.rowDetail0;
      paintFullRow(
        top,
        fg(
          theme.border,
          boxTop(
            detailView === "chat"
              ? t("col.chat").trim()
              : t("col.detail").trim(),
            dw,
          ),
        ),
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
    const title = t("help.title");
    lines.push(title);
    lines.push("");
    for (const g of helpGroups()) {
      lines.push(g.title);
      for (const [k, desc] of g.keys) {
        lines.push(`  ${k.padEnd(18)} ${desc}`);
      }
      lines.push("");
    }
    lines.push(t("help.esc"));
    return lines;
  }

  function paintHelpOverlay(): void {
    const lines = buildHelpLines();
    const title = t("help.title");
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
        raw !== title &&
        !raw.startsWith("Esc");
      const isTitle = raw === title;
      let cell: string;
      if (isTitle) cell = fg(theme.accent, padEndWidth(raw, layout.cols));
      else if (isHead)
        cell = fgBg(
          theme.brandNameFg,
          theme.brandNameBg,
          padEndWidth(` ${raw} `, layout.cols),
        );
      else cell = fg(theme.text, padEndWidth(raw, layout.cols));
      paintFullRow(row, cell);
    }
  }

  function buildLangLines(): string[] {
    return [
      t("lang.title"),
      "",
      t("lang.intro"),
      "",
      `  1   ${t("lang.en")}`,
      `  2   ${t("lang.zh")}`,
      "",
      t("lang.hint"),
    ];
  }

  function paintLangOverlay(): void {
    const lines = buildLangLines();
    const top = layout.rowColHead;
    const bot = layout.rowRuleFoot;
    const height = Math.max(1, bot - top);
    for (let i = 0; i < height; i++) {
      const row = top + i;
      const raw = lines[i] ?? "";
      let cell: string;
      if (i === 0) {
        cell = fgBg(
          theme.brandNameFg,
          theme.brandNameBg,
          padEndWidth(` ${raw} `, layout.cols),
        );
      } else if (raw.startsWith("  1") || raw.startsWith("  2")) {
        cell = fg(theme.accent, padEndWidth(raw, layout.cols));
      } else {
        cell = fg(theme.text, padEndWidth(raw, layout.cols));
      }
      paintFullRow(row, cell);
    }
  }

  /**
   * Full-screen retention popup (modal over the main table).
   * decision = choose fix vs ignore; done = fix results; review = status / unignore.
   */
  function buildRetentionLines(): string[] {
    const lines: string[] = [];
    if (retentionMode === "done") {
      lines.push("✓  Retention updated");
      lines.push("");
      lines.push(...retentionResultLines);
      lines.push("");
      lines.push("Restart the agent app(s) for the new setting to apply.");
      lines.push("Sessions already deleted cannot be recovered.");
      lines.push("");
      lines.push(
        retentionPending.length > 0
          ? "Enter / Esc  ·  continue (remaining risks will ask again)"
          : "Enter / Esc  ·  continue to session list",
      );
      return lines;
    }

    if (retentionMode === "review") {
      lines.push("Session retention — status");
      lines.push("");
      if (retentionFindings.length === 0) {
        lines.push("  No Grok / Qoder / Claude install detected.");
      } else {
        for (const f of retentionFindings) {
          let badge: string;
          if (!f.atRisk) badge = "OK";
          else if (retentionAcked.some((a) => a.agent === f.agent))
            badge = "IGNORED";
          else badge = "AT RISK";
          lines.push(`  ${f.agent.padEnd(8)} ${badge}`);
          lines.push(`    ${f.notice}`);
          if (f.atRisk) {
            lines.push(`    Suggested: ${f.fixHint}`);
            lines.push(`    File: ${f.settingsPath}`);
          }
          lines.push("");
        }
      }
      if (retentionPending.length > 0) {
        lines.push("Open risks still need a choice (see decision popup).");
        lines.push("");
      }
      if (retentionAcked.length > 0) {
        lines.push(
          "Ignored = you keep the agent's cleanup; we won't popup again.",
        );
        lines.push(
          "u = unignore all (takes effect immediately; next start may popup)",
        );
        lines.push("");
      }
      lines.push(
        "y fix open risks  ·  i ignore open risks  ·  u unignore  ·  Esc close",
      );
      return lines;
    }

    // decision
    lines.push(t("ret.title.decision"));
    lines.push("");
    lines.push(t("ret.intro"));
    lines.push("");
    for (const f of retentionPending) {
      lines.push(`${f.agent}`);
      lines.push(`  ${f.notice}`);
      lines.push(`  ${t("ret.suggested")}  ${f.fixHint}`);
      lines.push(`  ${t("ret.file")}  ${f.settingsPath}`);
      lines.push("");
    }
    lines.push(t("ret.choose"));
    lines.push("");
    lines.push(t("ret.y"));
    lines.push(t("ret.y.hint"));
    lines.push("");
    lines.push(t("ret.i"));
    lines.push(t("ret.i.hint1"));
    lines.push(t("ret.i.hint2"));
    lines.push("");
    if (retentionBlocking) {
      lines.push(t("ret.block"));
    } else {
      lines.push(t("ret.noblock"));
    }
    return lines;
  }

  function paintRetentionOverlay(): void {
    const lines = buildRetentionLines();
    const top = layout.rowColHead;
    const bot = layout.rowRuleFoot;
    const height = Math.max(1, bot - top);

    for (let i = 0; i < height; i++) {
      const row = top + i;
      const raw = lines[i] ?? "";
      let cell: string;
      if (i === 0) {
        // done title: light ink on solid ok green; otherwise brand chip
        cell = fgBg(
          retentionMode === "done" ? theme.onOk : theme.brandNameFg,
          retentionMode === "done" ? theme.ok : theme.brandNameBg,
          padEndWidth(` ${raw} `, layout.cols),
        );
      } else if (
        raw.startsWith("  y ") ||
        raw.startsWith("  i ") ||
        raw.startsWith("y ") ||
        raw.startsWith(t("ret.choose")) ||
        raw.startsWith("Choose")
      ) {
        cell = fg(theme.accent, padEndWidth(raw, layout.cols));
      } else if (
        raw &&
        !raw.startsWith(" ") &&
        !raw.startsWith("✓") &&
        retentionMode === "decision"
      ) {
        cell = fg(theme.warn, padEndWidth(raw, layout.cols));
      } else if (raw.includes("AT RISK")) {
        cell = fg(theme.warn, padEndWidth(raw, layout.cols));
      } else if (raw.includes("IGNORED")) {
        cell = fg(theme.dim, padEndWidth(raw, layout.cols));
      } else if (raw.includes(" OK") || raw.startsWith("✓")) {
        cell = fg(theme.ok, padEndWidth(raw, layout.cols));
      } else {
        cell = fg(theme.text, padEndWidth(raw, layout.cols));
      }
      paintFullRow(row, cell);
    }
  }

  function paintFooter(): void {
    if (langMode) {
      paintFullRow(
        layout.rowFooter,
        fg(theme.dim, " ") +
          fgBg(theme.editFg, theme.editBg, t("lang.badge")) +
          fg(
            theme.dim,
            langBlocking ? t("lang.footer") : t("lang.footer.change"),
          ),
      );
      return;
    }
    if (retentionMode) {
      let hint: string;
      if (retentionMode === "decision") {
        hint = retentionBlocking
          ? t("footer.retention.block")
          : t("footer.retention.decide");
      } else if (retentionMode === "done") {
        hint = t("footer.retention.done");
      } else {
        hint = t("footer.retention.review");
      }
      paintFullRow(
        layout.rowFooter,
        fg(theme.dim, " ") +
          fgBg(theme.editFg, theme.editBg, t("ret.badge")) +
          fg(theme.dim, hint),
      );
      return;
    }
    if (helpMode) {
      paintFullRow(
        layout.rowFooter,
        fg(theme.dim, " ") +
          fgBg(theme.brandNameFg, theme.brandNameBg, t("help.badge")) +
          fg(theme.dim, t("footer.help")),
      );
      return;
    }
    if (tagAssignMode) {
      paintFullRow(
        layout.rowFooter,
        fg(theme.dim, " ") +
          fgBg(theme.editFg, theme.editBg, t("tag.badge")) +
          fg(theme.dim, t("footer.tag")),
      );
      return;
    }
    if (renameMode) {
      paintFullRow(
        layout.rowFooter,
        fg(theme.dim, " ") +
          fgBg(theme.editFg, theme.editBg, t("title.badge")) +
          fg(theme.dim, t("footer.title")),
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
          fg(theme.dim, t("footer.search")),
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
    if (statusLine) msg += (msg ? " · " : "") + statusLine;
    if (pending) msg += (msg ? " · " : "") + pending + "…";
    if (visualAnchor !== null)
      msg += (msg ? " · " : "") + t("status.visualOn");
    else if (multiSelect.size)
      msg +=
        (msg ? " · " : "") +
        t("status.multiHint", { n: multiSelect.size });
    if (pendingDelete.size)
      msg += (msg ? " · " : "") + `${pendingDelete.size} to delete → :wq`;
    if (msg) {
      paintFullRow(
        layout.rowFooter,
        fg(theme.accent, " " + truncateWidth(msg, layout.cols - 2)),
      );
      return;
    }
    // Just-fixed success strip (this session).
    if (retentionJustFixed.length > 0) {
      paintFullRow(
        layout.rowFooter,
        fg(
          theme.ok,
          " ✓ " +
            truncateWidth(
              `retention updated for ${retentionJustFixed.join(", ")}  ·  restart those agents to apply`,
              layout.cols - 4,
            ),
        ),
      );
      return;
    }
    // Open risks (should be rare outside popup — e.g. failed fix).
    if (retentionPending.length > 0) {
      paintFullRow(
        layout.rowFooter,
        fg(
          theme.warn,
          " ⚠ " +
            truncateWidth(
              `${retentionWarning(retentionPending)}  ·  run :retention`,
              layout.cols - 4,
            ),
        ),
      );
      return;
    }
    // Acknowledged risks: never popup, but remind user they can reverse.
    if (retentionAcked.length > 0) {
      const names = retentionAcked.map((f) => f.agent).join(",");
      paintFullRow(
        layout.rowFooter,
        fg(
          theme.dim,
          " ℹ " +
            truncateWidth(
              t("ret.acked", { names }),
              layout.cols - 4,
            ),
        ),
      );
      return;
    }
    paintFullRow(
      layout.rowFooter,
      fg(theme.dim, t("footer.default")),
    );
  }

  /** Detail column title (Chat / Detail) — split layout only. */
  function paintDetailHeader(): void {
    if (!layout.split) return;
    const label = detailHeaderLabel();
    const focused = focusPane === "detail";
    const headFg = focused ? theme.title : theme.headerFg;
    const headBg = focused ? theme.brandNameBg : theme.headerBg;
    paintCell(
      layout.rowColHead,
      layout.detailCol,
      layout.detailW,
      fgBg(headFg, headBg, padEndWidth(label, layout.detailW - 1)) +
        fg(theme.border, "│"),
    );
  }

  /**
   * Fast UI refresh without full-screen erase (still repaints list+brand).
   * Prefer paintLeaveChat / paintEnterChat for Esc paths.
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
          gutterListDetail(),
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

  /**
   * Esc leave chat → sessions: paint ONLY what changes.
   *
   * Root cause of lag: rewriting brand + all list rows forces the terminal
   * emulator to re-layout/re-rasterize most of the screen (slow on WSL /
   * Windows Terminal), even when JS rebuild is only a few ms.
   *
   * Must update:
   *  - cursor list row (regain select highlight; focus was on detail)
   *  - detail header Chat→Detail + detail body → meta
   *  - footer
   */
  function paintLeaveChat(): void {
    beginBatch();
    try {
      const slot = cursor - offset;
      if (slot >= 0 && slot < layout.page) paintListSlot(slot);
      paintDetailHeader();
      paintDetail();
      paintFooter();
      write(move(layout.rowFooter, 1));
    } finally {
      endBatch();
    }
  }

  /** Enter chat: drop list select look + fill detail with message list. */
  function paintEnterChat(): void {
    beginBatch();
    try {
      const slot = cursor - offset;
      if (slot >= 0 && slot < layout.page) paintListSlot(slot);
      paintDetailHeader();
      paintDetail();
      paintFooter();
      write(move(layout.rowFooter, 1));
    } finally {
      endBatch();
    }
  }

  function fullPaint(): void {
    // Flood our theme canvas first (host terminal default must not show through)
    write(move(1, 1) + sgrDefault() + `${ESC}[2J` + move(1, 1));
    paintBrand();
    paintRule(layout.rowRuleBrand, "brand");

    if (langMode) {
      paintLangOverlay();
      paintRule(layout.rowRuleFoot, "foot");
      paintFooter();
      write(move(layout.rowFooter, 1));
      return;
    }

    if (helpMode) {
      paintHelpOverlay();
      paintRule(layout.rowRuleFoot, "foot");
      paintFooter();
      write(move(layout.rowFooter, 1));
      return;
    }

    if (retentionMode) {
      paintRetentionOverlay();
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
        gutterListDetail(),
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
    // After first-run lang / retention overlays close, surface pending update.
    maybeShowUpdateNotice(false);
    paintFooter();
    write(move(layout.rowFooter, 1));
  }

  /** Show footer notice once npm reports a newer version (when UI is free). */
  function maybeShowUpdateNotice(repaint = true): void {
    if (updateNoticeShown || !pendingUpdate?.updateAvailable) return;
    if (
      renameMode ||
      cmdMode ||
      filterMode ||
      helpMode ||
      langMode ||
      retentionMode ||
      tagAssignMode
    ) {
      return;
    }
    updateNoticeShown = true;
    statusLine = t("status.updateAvailable", {
      current: pendingUpdate.current,
      latest: pendingUpdate.latest,
      cmd: pendingUpdate.upgradeCmd,
    });
    if (repaint) {
      try {
        paintFooter();
      } catch {
        /* TUI may already be tearing down */
      }
    }
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
    visualAnchor = null;
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
      ? `starred *  ·  pinned · cannot dd until * again`
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
    // Leave visual range mode; Space only toggles the current line
    visualAnchor = null;
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

  /** Fill multiSelect with list rows between visualAnchor and cursor (inclusive). */
  function applyVisualRange(): void {
    if (visualAnchor === null || list.length === 0) return;
    const a = Math.max(0, Math.min(visualAnchor, cursor, list.length - 1));
    const b = Math.max(0, Math.min(Math.max(visualAnchor, cursor), list.length - 1));
    multiSelect.clear();
    for (let i = a; i <= b; i++) {
      const s = list[i];
      if (s) multiSelect.add(sessionKey(s));
    }
  }

  /** vim `v` — start / end visual range select on the session list. */
  function doToggleVisual(): void {
    if (focusPane !== "sessions") return;
    if (visualAnchor !== null) {
      visualAnchor = null;
      statusLine = t("status.visualOff", { n: multiSelect.size });
      fullPaint();
      return;
    }
    if (list.length === 0) {
      statusLine = t("status.nothingSelected");
      paintFooter();
      return;
    }
    visualAnchor = cursor;
    applyVisualRange();
    // Footer shows visual hint via visualAnchor; avoid duplicating in statusLine
    statusLine = "";
    fullPaint();
  }

  /** After cursor motion: keep visual range in sync (may need full list repaint). */
  function afterListCursorMove(prevCursor: number, prevOffset: number): void {
    if (visualAnchor !== null) {
      // Anchor may be stale if list was rebuilt; clamp
      if (visualAnchor >= list.length) visualAnchor = Math.max(0, list.length - 1);
      applyVisualRange();
      dropChatIfCursorMoved();
      // Range can span many rows — repaint list
      paintAllList();
      paintBrand();
      paintDetail();
      paintFooter();
      write(move(layout.rowFooter, 1));
      return;
    }
    paintSelectionChange(prevCursor, prevOffset);
  }

  /**
   * Pool for bulk health select: respect search, skip already pending-delete.
   */
  function bulkSelectPool(): SessionRecord[] {
    const q = filter.trim().toLowerCase();
    return allSessions.filter((s) => {
      if (pendingDelete.has(sessionKey(s))) return false;
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
    visualAnchor = null;
    if (multiSelect.size === 0) return;
    multiSelect.clear();
    statusLine = t("status.selectionCleared");
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
      retention: "retention",
      ret: "retention",
      lang: "lang",
      language: "lang",
      locale: "lang",
      feedback: "feedback",
      fb: "feedback",
      github: "feedback",
      issue: "feedback",
      issues: "feedback",
    };
    return map[head] ?? null;
  }

  function applyLocaleChoice(locale: Locale): void {
    const r = saveLocale(locale);
    setLocale(locale);
    langMode = false;
    const wasBlocking = langBlocking;
    langBlocking = false;
    statusLine =
      locale === "zh" ? t("lang.saved.zh") : t("lang.saved.en");
    if (!r.ok) {
      statusLine = `language set (save failed: ${r.error ?? "unknown"})`;
    }
    // First-run: continue to retention if needed
    if (wasBlocking) {
      maybeOpenStartupRetention();
    }
    fullPaint();
  }

  function openLangPicker(blocking = false): void {
    helpMode = false;
    langMode = true;
    langBlocking = blocking;
    statusLine = t("status.langOpened");
    fullPaint();
  }

  function openFeedback(): void {
    const r = openUrl(GITHUB_REPO_URL);
    statusLine = r.ok
      ? t("status.feedbackOk", { url: GITHUB_REPO_URL })
      : t("status.feedbackFail", { url: GITHUB_REPO_URL });
    paintFooter();
  }

  function openRetention(): void {
    syncRetentionState();
    retentionBlocking = false;
    retentionJustFixed = [];
    statusLine = "";
    if (retentionPending.length > 0) {
      retentionMode = "decision";
    } else {
      retentionMode = "review";
    }
    fullPaint();
  }

  function applyRetentionFix(): void {
    const targets = [...retentionPending];
    if (targets.length === 0) {
      statusLine = "no open retention risks to fix";
      paintFooter();
      return;
    }
    const results = fixRetentionFindings(targets);
    retentionResultLines = results.map((r) =>
      r.ok
        ? `  ok     ${r.agent} → ${r.settingsPath}${r.backupPath ? "  (backup written)" : "  (created)"}`
        : `  FAIL   ${r.agent} → ${r.error ?? "unknown error"}`,
    );
    const okAgents = results.filter((r) => r.ok).map((r) => r.agent);
    const failed = results.filter((r) => !r.ok);
    retentionJustFixed = okAgents;
    syncRetentionState();
    retentionMode = "done";
    // Stay non-blocking on the result screen; if anything still pending after
    // close, we reopen decision (see closeRetentionPopup).
    retentionBlocking = false;
    if (failed.length > 0) {
      retentionResultLines.push("");
      retentionResultLines.push(
        `${failed.length} failed — after continue you can retry (y/i) for remaining agents.`,
      );
    }
    statusLine = failed.length
      ? `retention: ${failed.length} failed  ·  ${okAgents.length} ok`
      : `retention updated for ${okAgents.join(", ") || "—"}`;
    fullPaint();
  }

  function applyRetentionIgnore(): void {
    const agents = retentionPending.map((f) => f.agent);
    if (agents.length === 0) {
      statusLine = "no open risks to ignore";
      paintFooter();
      return;
    }
    const wrote = ignoreRetentionAgents(agents, "user acknowledged via TUI");
    if (!wrote.ok) {
      statusLine = `could not save preference: ${wrote.error ?? "write failed"}`;
      paintFooter();
      return;
    }
    syncRetentionState();
    retentionMode = null;
    retentionBlocking = false;
    statusLine = t("ret.acked", { names: agents.join(", ") });
    fullPaint();
  }

  function applyRetentionUnignore(): void {
    const wrote = unignoreRetentionAgents();
    if (!wrote.ok) {
      statusLine = `could not clear ignores: ${wrote.error ?? "write failed"}`;
      paintFooter();
      return;
    }
    syncRetentionState();
    if (retentionPending.length > 0) {
      retentionMode = "decision";
      retentionBlocking = false;
      statusLine = "ignores cleared  ·  choose y or i for open risks";
    } else {
      retentionMode = "review";
      statusLine = "ignores cleared";
    }
    fullPaint();
  }

  function closeRetentionPopup(): void {
    if (retentionBlocking && retentionMode === "decision") return;
    // After a partial fix, reopen decision for remaining open risks.
    if (retentionMode === "done") {
      syncRetentionState();
      if (retentionPending.length > 0) {
        retentionMode = "decision";
        retentionBlocking = false;
        statusLine = `${retentionPending.map((f) => f.agent).join(", ")} still at risk  ·  y fix  ·  i ignore`;
        fullPaint();
        return;
      }
    }
    retentionMode = null;
    retentionBlocking = false;
    fullPaint();
  }

  function runExCommand(cmdRaw: string, exit: () => void): void {
    const raw = cmdRaw.trim().toLowerCase();
    if (!raw) {
      statusLine = t("status.emptyCmd");
      paintFooter();
      return;
    }
    const parts = raw.split(/\s+/).filter(Boolean);
    const verb = normalizeEx(parts[0] ?? "", parts.slice(1).join(" "));
    const arg = parts.slice(1).join(" ");

    switch (verb) {
      case "wq":
        doWriteQuit(exit);
        return;
      case "q!":
        pendingDelete.clear();
        undoStack.length = 0;
        multiSelect.clear();
        statusLine = t("status.quitDiscard");
        paintFooter();
        exit();
        return;
      case "q":
        if (pendingDelete.size > 0) {
          statusLine = t("status.pendingDel", { n: pendingDelete.size });
          paintFooter();
          return;
        }
        statusLine = t("status.quitting");
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
          statusLine = t("status.nothingSelected");
          paintFooter();
          return;
        }
        clearMultiSelect();
        return;
      case "sel-help":
        statusLine = t("status.selHelp");
        paintFooter();
        return;
      case "help":
        helpMode = true;
        helpOffset = 0;
        statusLine = "";
        fullPaint();
        return;
      case "retention":
        openRetention();
        return;
      case "lang": {
        // :lang en | :lang zh | bare :lang opens picker
        if (arg === "en" || arg === "english") {
          applyLocaleChoice("en");
          return;
        }
        if (arg === "zh" || arg === "cn" || arg === "chinese" || arg === "中文") {
          applyLocaleChoice("zh");
          return;
        }
        openLangPicker(false);
        return;
      }
      case "feedback":
        openFeedback();
        return;
      default:
        statusLine = t("status.unknownCmd", { cmd: cmdRaw.trim() });
        paintFooter();
    }
  }

  /** yy = copy resume command to system clipboard (macOS: pbcopy). */
  function doYank(): void {
    const s = list[cursor];
    if (!s) return;
    const command = resumeHint(s);
    const copied = copyToClipboard(command);
    statusLine = copied.ok
      ? t("status.copied", { tool: copied.tool ?? "?" })
      : t("status.clipboardFail", { cmd: command });
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
    renamePos = [...renameBuf].length; // caret at end
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
    renamePos = 0;
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
    if (
      renameMode ||
      cmdMode ||
      filterMode ||
      tagAssignMode ||
      helpMode ||
      langMode
    )
      return;
    if (retentionMode) return;
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
  // Custom key reader: bare Esc in ~25ms (Node readline waits ~500ms — feels laggy)
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  write(altEnter() + hideCursor());
  fullPaint();
  stdout.on("resize", onResize);

  const refreshTimer = options.reload
    ? setInterval(() => {
        refreshFromDisk();
      }, REFRESH_MS)
    : null;

  // Non-blocking npm version check → footer status when outdated.
  // May arrive while language/retention popup is open; kept in pendingUpdate
  // until fullPaint / maybeShowUpdateNotice runs with a free main UI.
  scheduleUpdateCheck((info) => {
    if (!info.updateAvailable) return;
    pendingUpdate = info;
    maybeShowUpdateNotice(true);
  });

  await new Promise<void>((resolve) => {
    let detachKeys: (() => void) | null = null;

    const cleanup = (): void => {
      if (refreshTimer) clearInterval(refreshTimer);
      clearPending();
      stdout.off("resize", onResize);
      detachKeys?.();
      detachKeys = null;
      if (stdin.isTTY) stdin.setRawMode(false);
      write(showCursor() + altLeave());
      stdin.pause();
    };

    const onKey = (_str: string | undefined, key: AppKey): void => {
      const str = _str ?? "";

      // ----- language picker (first run or :lang) -----
      if (langMode) {
        if (
          str === "1" ||
          key.name === "1" ||
          str === "e" ||
          str === "E" ||
          key.name === "e"
        ) {
          applyLocaleChoice("en");
          return;
        }
        if (
          str === "2" ||
          key.name === "2" ||
          str === "c" ||
          str === "C" ||
          str === "z" ||
          str === "Z" ||
          key.name === "c" ||
          key.name === "z"
        ) {
          applyLocaleChoice("zh");
          return;
        }
        if (
          !langBlocking &&
          (key.name === "escape" || key.name === "q" || str === "q")
        ) {
          langMode = false;
          statusLine = t("lang.cancelled");
          fullPaint();
          return;
        }
        // Blocking first-run: swallow other keys
        return;
      }

      // ----- retention TUI popup -----
      if (retentionMode) {
        if (retentionMode === "decision") {
          if (key.name === "y" || str === "y" || str === "Y") {
            applyRetentionFix();
            return;
          }
          if (key.name === "i" || str === "i" || str === "I") {
            applyRetentionIgnore();
            return;
          }
          if (
            !retentionBlocking &&
            (key.name === "escape" ||
              key.name === "n" ||
              str === "n" ||
              str === "N")
          ) {
            statusLine = "retention unchanged";
            closeRetentionPopup();
            return;
          }
          // Blocking: swallow Esc / other keys until y or i.
          return;
        }
        if (retentionMode === "done") {
          if (
            key.name === "escape" ||
            key.name === "return" ||
            str === "q" ||
            key.name === "q"
          ) {
            closeRetentionPopup();
          }
          return;
        }
        // review
        if (key.name === "y" || str === "y" || str === "Y") {
          if (retentionPending.length > 0) applyRetentionFix();
          else {
            statusLine = "no open risks to fix";
            paintFooter();
          }
          return;
        }
        if (key.name === "i" || str === "i" || str === "I") {
          if (retentionPending.length > 0) applyRetentionIgnore();
          else {
            statusLine = "no open risks to ignore";
            paintFooter();
          }
          return;
        }
        if (key.name === "u" || str === "u" || str === "U") {
          applyRetentionUnignore();
          return;
        }
        if (key.name === "escape" || key.name === "return") {
          closeRetentionPopup();
        }
        return;
      }

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
        // ← / → move caret (and Home / End)
        if (key.name === "left") {
          renamePos = Math.max(0, renamePos - 1);
          paintRenameLive();
          return;
        }
        if (key.name === "right") {
          renamePos = Math.min([...renameBuf].length, renamePos + 1);
          paintRenameLive();
          return;
        }
        if (key.name === "home") {
          renamePos = 0;
          paintRenameLive();
          return;
        }
        if (key.name === "end") {
          renamePos = [...renameBuf].length;
          paintRenameLive();
          return;
        }
        if (key.name === "backspace") {
          if (renamePos > 0) {
            const chars = [...renameBuf];
            chars.splice(renamePos - 1, 1);
            renameBuf = chars.join("");
            renamePos--;
          }
          paintRenameLive();
          return;
        }
        // Forward delete (fn-backspace / Del)
        if (key.name === "delete") {
          const chars = [...renameBuf];
          if (renamePos < chars.length) {
            chars.splice(renamePos, 1);
            renameBuf = chars.join("");
          }
          paintRenameLive();
          return;
        }
        if (key.ctrl && key.name === "u") {
          renameBuf = "";
          renamePos = 0;
          paintRenameLive();
          return;
        }
        // Ctrl-A / Ctrl-E — line start / end (readline habit)
        if (key.ctrl && (key.name === "a" || str === "\x01")) {
          renamePos = 0;
          paintRenameLive();
          return;
        }
        if (key.ctrl && (key.name === "e" || str === "\x05")) {
          renamePos = [...renameBuf].length;
          paintRenameLive();
          return;
        }
        if (key.name === "up" || key.name === "down") {
          return;
        }
        if (str && !key.ctrl && !key.meta && str >= " ") {
          const chars = [...renameBuf];
          const insert = [...str];
          chars.splice(renamePos, 0, ...insert);
          renameBuf = chars.join("");
          renamePos += insert.length;
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
          afterListCursorMove(prevC, prevO);
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
        // Visual: first Esc ends range mode (keeps selection); second clears
        if (visualAnchor !== null) {
          visualAnchor = null;
          statusLine = t("status.visualOff", { n: multiSelect.size });
          fullPaint();
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
      // v — vim visual range select
      if (str === "v" || str === "V") {
        if (focusPane !== "sessions") return;
        clearPending();
        doToggleVisual();
        return;
      }
      // * — pin / unpin
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
      if (str === "y") {
        if (focusPane === "detail") return;
        armPending("y");
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
        afterListCursorMove(prevC, prevO);
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
      if (key.name === "up" || key.name === "k") {
        cursor = Math.max(0, cursor - 1);
        clampScroll();
        afterListCursorMove(prevCursor, prevOffset);
        return;
      }
      if (key.name === "down" || key.name === "j") {
        cursor = Math.min(list.length - 1, cursor + 1);
        clampScroll();
        afterListCursorMove(prevCursor, prevOffset);
        return;
      }
    };

    detachKeys = attachKeys(stdin, onKey);
  });
}
