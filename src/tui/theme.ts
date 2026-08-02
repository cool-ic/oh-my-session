/**
 * Palette inspired by professional agent session TUIs (reference screenshot):
 *   - deep blue-black canvas (not neon-green field)
 *   - soft off-white body text
 *   - **gold/amber selection row** (readable, calm)
 *   - gold ★ / dim ☆ stars
 *   - muted secondary for paths / age
 *   - green kept only as a quiet accent (status ok, brand tick)
 */
export const theme = {
  /**
   * Full-screen canvas (we paint this ourselves).
   * Cool near-black — matches the reference “terminal table” look.
   */
  canvas: "#0B0D12",

  /** Quiet accent (ok ticks, small chrome) — not the selection color */
  accent: "#6BCB8A",
  /** Near-white titles */
  title: "#E8EAEF",
  /** Body / IDs / commands */
  text: "#D2D6DE",
  /** Secondary (age, path, hints) */
  dim: "#7A8494",
  line: "#2A303C",
  border: "#3A4250",

  ok: "#6BCB8A",
  empty: "#8A9099",
  missing: "#E0A080",

  /** Selection — gold bar like the reference UI */
  cursor: "#1A1608",
  cursorBar: "#D4B44A",
  selectBg: "#C9A84A",
  selectFg: "#1A1608",

  /** Multi-select — cooler muted amber */
  multiBg: "#2A2618",
  multiFg: "#E8E0C8",
  multiMark: "#D4B44A",

  /** Stars: filled gold / empty outline */
  star: "#E0C060",
  starEmpty: "#4A5060",

  /** Inline rename */
  editBg: "#D4B44A",
  editFg: "#1A1608",

  warn: "#E0A84A",
  action: "#D4B44A",
  panelBg: "#0E1016",

  /** Brand bar — subdued, not neon */
  brandNameBg: "#1A2030",
  brandNameFg: "#E8EAEF",
  brandTagBg: "#141820",
  brandTagFg: "#9AA3B0",
  brandSep: "#3A4250",
  brandKey: "#D4B44A",
  brandHint: "#8A9099",

  source: {
    all: "#E8EAEF",
    grok: "#8FCB9B",
    qoder: "#7EB8E0",
    claude: "#D4A574",
    codex: "#A0A8B4",
    cursor: "#B0B8C4",
  } as Record<string, string>,

  pill: {
    okBg: "#15241C",
    okFg: "#B8E0C4",
    emptyBg: "#1C2028",
    emptyFg: "#C0C4CC",
    missingBg: "#2A1C18",
    missingFg: "#F0C8B0",
  },

  /**
   * Chat message list — calm cards on cool canvas.
   * Agent: soft green; You: soft blue (not neon).
   */
  chat: {
    headerFg: "#8A9099",
    headerBg: "#10141C",
    headerAccent: "#D4B44A",
    agentName: "#8FCB9B",
    agentBar: "#4A9A68",
    agentBg: "#10161A",
    agentText: "#D8DEE4",
    userName: "#7EB8E0",
    userBar: "#4A88B0",
    userBg: "#0E141C",
    userText: "#D8E4EC",
    toolName: "#D4B56A",
    toolBar: "#A88840",
    toolBg: "#16140E",
    toolText: "#E8E0C8",
    thinkName: "#8A9099",
    thinkBar: "#4A5060",
    thinkBg: "#12141A",
    thinkText: "#A0A8B4",
    timeFg: "#5A6470",
    sep: "#1C222C",
  },
} as const;
