/**
 * Warm dark palette — soft amber / olive / terracotta.
 */
export const theme = {
  accent: "#E8C48A",
  title: "#F2E6D4",
  text: "#E6D8C4",
  dim: "#8A7A68",
  line: "#4A3C30",
  border: "#A88860",

  ok: "#C4D0A4",
  empty: "#9A8C7C",
  missing: "#E0A888",

  /** Cursor row — high contrast warm highlight */
  cursor: "#1A1410",
  cursorBar: "#FFD78A",
  selectBg: "#C9A06A",
  selectFg: "#1A1410",

  /** Multi-select (Space) — dimmer warm fill, not as strong as cursor */
  multiBg: "#4A3828",
  multiFg: "#F0E0C8",
  multiMark: "#FFD78A",

  /** Inline TITLE edit (i) — brighter than cursor so cell feels "typing" */
  editBg: "#F0DCB0",
  editFg: "#1A1008",

  warn: "#E8C48A",
  action: "#F0D090",
  panelBg: "#241E18",

  /** Brand bar — hierarchy: name mark > section tags > keys > hints */
  brandNameBg: "#4A3C2C",
  brandNameFg: "#F5EDE0",
  brandTagBg: "#2E2820",
  brandTagFg: "#A89880",
  brandSep: "#4A4034",
  brandKey: "#E8C48A",
  brandHint: "#6E5E4E",

  source: {
    all: "#F2E6D4",
    grok: "#E8C48A",
    qoder: "#D0B890",
    claude: "#DCC8A0",
    codex: "#BCA888",
    cursor: "#D0BC9C",
  } as Record<string, string>,

  pill: {
    okBg: "#2E3A28",
    okFg: "#C8D8A8",
    emptyBg: "#322C28",
    emptyFg: "#A89888",
    missingBg: "#3E2A22",
    missingFg: "#F0B898",
  },
} as const;
