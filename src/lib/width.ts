/**
 * Terminal display-width helpers.
 * CJK / fullwidth glyphs count as 2 columns; ASCII as 1.
 * Without this, tables with Chinese titles drift out of alignment.
 */

function isFullWidthCodePoint(code: number): boolean {
  if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return false;
  // Zero-width / combining (rough)
  if (code >= 0x300 && code <= 0x36f) return false;
  if (code >= 0x1ab0 && code <= 0x1aff) return false;
  if (code >= 0x20d0 && code <= 0x20ff) return false;
  if (code >= 0xfe00 && code <= 0xfe0f) return false;

  return (
    code === 0x3000 ||
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2329 && code <= 0x232a) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3040 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f9ff) || // emoji (most wide)
    (code >= 0x20000 && code <= 0x2fffd) ||
    (code >= 0x30000 && code <= 0x3fffd)
  );
}

export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    w += isFullWidthCodePoint(code) ? 2 : 1;
  }
  return w;
}

/** Truncate to at most `width` display columns, appending "…" if cut. */
export function truncateWidth(text: string, width: number): string {
  if (width <= 0) return "";
  if (displayWidth(text) <= width) return text;
  if (width === 1) return "…";
  const budget = width - 1; // room for ellipsis
  let out = "";
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const cw = isFullWidthCodePoint(code) ? 2 : 1;
    if (w + cw > budget) break;
    out += ch;
    w += cw;
  }
  return out + "…";
}

export function padEndWidth(text: string, width: number): string {
  const t = truncateWidth(text, width);
  const pad = width - displayWidth(t);
  return t + (pad > 0 ? " ".repeat(pad) : "");
}

export function padStartWidth(text: string, width: number): string {
  const t = truncateWidth(text, width);
  const pad = width - displayWidth(t);
  return (pad > 0 ? " ".repeat(pad) : "") + t;
}
