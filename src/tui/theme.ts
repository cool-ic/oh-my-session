/**
 * Light professional palette for the session table TUI:
 *   - cool paper canvas (not pure white glare)
 *   - near-black body text, slate secondary
 *   - amber/gold selection row (same product identity as before, readable on light)
 *   - soft status pills and chat cards
 *   - green only as a quiet “ok / accent” note
 */
export const theme = {
  /**
   * Full-screen canvas (we paint this ourselves).
   * Soft cool gray — easier on the eyes than #FFF.
   */
  canvas: "#F0F2F5",

  /** Quiet accent (ok ticks, small chrome) — not the selection color */
  accent: "#1B7A45",
  /** Primary headings */
  title: "#11141A",
  /** Body / IDs / commands */
  text: "#1C212B",
  /** Secondary (age, path, hints) */
  dim: "#5C6570",
  line: "#D8DCE3",
  border: "#B8BFC9",

  ok: "#1B7A45",
  /** Light ink when painting on solid `ok` (e.g. success title bar) */
  onOk: "#F4F7F5",
  empty: "#6B7280",
  missing: "#C45C2A",

  /** Selection — warm amber bar, dark ink (readable on light canvas) */
  cursor: "#1A1608",
  cursorBar: "#C9A227",
  selectBg: "#E8C04A",
  selectFg: "#1A1608",

  /** Multi-select — pale amber wash */
  multiBg: "#F3E4B8",
  multiFg: "#2A2410",
  multiMark: "#B8921E",

  /** Stars: filled * / empty · */
  star: "#B8921E",
  starEmpty: "#9AA3B0",

  /** Inline rename — same family as selection */
  editBg: "#E8C04A",
  editFg: "#1A1608",

  warn: "#B45309",
  action: "#B8921E",
  panelBg: "#E8EAEE",

  /** Brand bar — soft slate chip, dark label */
  brandNameBg: "#DDE3EE",
  brandNameFg: "#12161E",
  brandTagBg: "#E6E9EF",
  brandTagFg: "#4B5563",
  brandSep: "#C5CAD3",
  brandKey: "#9A7410",
  brandHint: "#6B7280",

  source: {
    all: "#1C212B",
    grok: "#1B7A45",
    qoder: "#1D6FA5",
    claude: "#A65D1F",
    codex: "#4B5563",
    cursor: "#374151",
  } as Record<string, string>,

  pill: {
    okBg: "#D8F0E0",
    okFg: "#14532D",
    emptyBg: "#E5E7EB",
    emptyFg: "#374151",
    missingBg: "#FDE8DC",
    missingFg: "#9A3412",
  },

  /**
   * Chat message list — light cards with subtle role tint.
   * Agent: mint; You: sky; tool/think: warm / slate.
   */
  chat: {
    headerFg: "#5C6570",
    headerBg: "#E8EAEE",
    headerAccent: "#9A7410",
    agentName: "#14532D",
    agentBar: "#2F9E5B",
    agentBg: "#E8F5EC",
    agentText: "#1C212B",
    userName: "#1E4A6E",
    userBar: "#3B82A8",
    userBg: "#E7F1F8",
    userText: "#1C212B",
    toolName: "#7A5A10",
    toolBar: "#B8921E",
    toolBg: "#F7F0DC",
    toolText: "#2A2410",
    thinkName: "#5C6570",
    thinkBar: "#9AA3B0",
    thinkBg: "#EBEDF0",
    thinkText: "#4B5563",
    timeFg: "#7A8494",
    sep: "#D8DCE3",
  },
} as const;
