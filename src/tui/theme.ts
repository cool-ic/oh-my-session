/**
 * Light “studio paper” palette — calm, high clarity, low chrome noise.
 *
 * Hierarchy:
 *   canvas < surface/zebra < header chips < selection amber
 *   text > dim > meta > line/border
 *   accent green only for OK / active marks
 *   selection keeps column roles (pill / source / meta) on gold wash
 */
export const theme = {
  /** App background */
  canvas: "#F6F7F9",
  /** Slightly lifted panels (tags empty, detail empty) */
  surface: "#EEF0F4",
  /** Alternating list rows (very soft) */
  zebra: "#EBEDF2",
  /** Column / pane headers — quiet labels, not competing with data */
  headerBg: "#E4E7EE",
  headerFg: "#7A8494",

  /** Quiet accent (ok, active tag) */
  accent: "#1A7F4B",
  /** Primary headings */
  title: "#0E1116",
  /** Body */
  text: "#1A1F28",
  /** Secondary (paths when emphasized, brand hints) */
  dim: "#6A7380",
  /** Tertiary meta (age, msgs, empty star) — quieter scan texture */
  meta: "#9AA3B0",
  line: "#E0E3E9",
  border: "#C9CED6",

  ok: "#1A7F4B",
  onOk: "#F3FBF6",
  empty: "#6B7280",
  missing: "#C24B1F",

  /** Selection — soft gold, not neon */
  cursor: "#1A1608",
  cursorBar: "#C4A035",
  selectBg: "#F0D36A",
  selectFg: "#1A1608",

  /** Multi-select wash */
  multiBg: "#F6E8B8",
  multiFg: "#2A2410",
  multiMark: "#B08A18",

  /** Stars */
  star: "#B08A18",
  /** Empty mark — near-zebra so it doesn't steal STATUS */
  starEmpty: "#B8BEC8",

  editBg: "#F0D36A",
  editFg: "#1A1608",

  warn: "#B45309",
  action: "#B08A18",
  panelBg: "#EEF0F4",

  /** Brand chrome */
  brandNameBg: "#D8DEEA",
  brandNameFg: "#10141C",
  brandTagBg: "#E8EBEF",
  brandTagFg: "#4A5563",
  brandSep: "#C5CAD3",
  brandKey: "#8F6B0F",
  brandHint: "#6A7380",

  source: {
    all: "#1A1F28",
    grok: "#1A7F4B",
    qoder: "#1A6FA3",
    claude: "#A35A1C",
    codex: "#4B5563",
    cursor: "#374151",
  } as Record<string, string>,

  pill: {
    okBg: "#D5F0E0",
    okFg: "#14532D",
    emptyBg: "#E6E8EC",
    emptyFg: "#3D4450",
    missingBg: "#FCE4D6",
    missingFg: "#9A3412",
  },

  chat: {
    headerFg: "#5C6570",
    headerBg: "#E4E7EE",
    headerAccent: "#8F6B0F",
    agentName: "#14532D",
    agentBar: "#2D9A58",
    agentBg: "#E6F5EC",
    agentText: "#1A1F28",
    userName: "#1A4A6E",
    userBar: "#3B82A8",
    userBg: "#E6F1F8",
    userText: "#1A1F28",
    toolName: "#7A5A10",
    toolBar: "#B08A18",
    toolBg: "#F6F0DC",
    toolText: "#2A2410",
    thinkName: "#5C6570",
    thinkBar: "#9AA3B0",
    thinkBg: "#EBEDF0",
    thinkText: "#4B5563",
    timeFg: "#7A8494",
    sep: "#E0E3E9",
  },
} as const;
