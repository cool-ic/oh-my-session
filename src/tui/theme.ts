/**
 * Qoder-aligned dark palette.
 *
 * Brand green (#27BD51 / #2ADB5C) is for accents only.
 * Body / IDs / paths use near-white or light gray — pale mint on dark
 * is illegible at a distance (e.g. long UUIDs).
 */
export const theme = {
  /**
   * Full-screen canvas (we paint this ourselves).
   * Do not rely on the terminal default — many users run light terminals.
   */
  canvas: "#0B120E",

  /** Brand green — labels, keys, chips only */
  accent: "#2ADB5C",
  /** Near-white titles (on canvas) */
  title: "#F5F7F6",
  /** Body / IDs / commands */
  text: "#E8EEE9",
  /** Secondary (age, path) */
  dim: "#A8B5AC",
  line: "#2A6A3C",
  border: "#27BD51",

  ok: "#3DDC6A",
  empty: "#B0B8B2",
  missing: "#E8A888",

  cursor: "#08120B",
  cursorBar: "#2ADB5C",
  selectBg: "#27BD51",
  selectFg: "#08120B",

  multiBg: "#14321C",
  multiFg: "#F0F2F0",
  multiMark: "#2ADB5C",

  star: "#C8F040",

  editBg: "#9AE8A8",
  editFg: "#08120B",

  warn: "#FAAD14",
  /** Commands / hotkeys — solid brand green (not pale) */
  action: "#2ADB5C",
  panelBg: "#0C0E0D",

  brandNameBg: "#134220",
  brandNameFg: "#F5F7F6",
  brandTagBg: "#152A1C",
  brandTagFg: "#D0D4D0",
  brandSep: "#2A6A3C",
  brandKey: "#2ADB5C",
  brandHint: "#C4C9C5",

  source: {
    all: "#F5F7F6",
    grok: "#5CCC7B",
    qoder: "#2ADB5C",
    claude: "#8BD09E",
    codex: "#A0B8A8",
    cursor: "#B0C4B4",
  } as Record<string, string>,

  pill: {
    okBg: "#134220",
    okFg: "#E8F8EC",
    emptyBg: "#2A322E",
    emptyFg: "#E0E4E0",
    missingBg: "#3E2A22",
    missingFg: "#FFD0B0",
  },

  /**
   * Chat pane — modern “message list” (no emoji chrome).
   * Soft cards + thin accent bar; Agent brand green, You cool slate.
   */
  chat: {
    /** Sticky strip at top of pane */
    headerFg: "#8FA896",
    headerBg: "#0C1410",
    headerAccent: "#2ADB5C",
    /** Agent card */
    agentName: "#3DDC6A",
    agentBar: "#2ADB5C",
    agentBg: "#101A14",
    agentText: "#E6EEE8",
    /** You card */
    userName: "#7EC8E3",
    userBar: "#4AA8C9",
    userBg: "#0E161C",
    userText: "#E4EEF2",
    /** Tool / think (rare) */
    toolName: "#D4B56A",
    toolBar: "#C4A04A",
    toolBg: "#16140E",
    toolText: "#EDE6D4",
    thinkName: "#8A968C",
    thinkBar: "#4A5550",
    thinkBg: "#121614",
    thinkText: "#A8B5AC",
    timeFg: "#5A6E60",
    sep: "#152018",
  },
} as const;
