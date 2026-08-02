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
   * Chat transcript bubbles (right pane).
   * Agent = brand green; You = cool cyan; keep contrast on canvas.
   */
  chat: {
    headerFg: "#C8F0D0",
    headerBg: "#0E1A12",
    agentBadgeFg: "#08120B",
    agentBadgeBg: "#2ADB5C",
    agentRail: "#27BD51",
    agentBodyBg: "#0F1C14",
    agentText: "#E8F8EC",
    userBadgeFg: "#061018",
    userBadgeBg: "#3DCFE8",
    userRail: "#2A9FBE",
    userBodyBg: "#0C161C",
    userText: "#E6F4FA",
    toolBadgeFg: "#1A1408",
    toolBadgeBg: "#E8C060",
    toolRail: "#B8943A",
    toolBodyBg: "#1A1810",
    toolText: "#F0E8D0",
    thinkBadgeFg: "#E0E4E0",
    thinkBadgeBg: "#2A322E",
    thinkRail: "#4A5550",
    thinkBodyBg: "#121614",
    thinkText: "#A8B5AC",
    timeFg: "#6A8A72",
    frame: "#1E3A28",
  },
} as const;
