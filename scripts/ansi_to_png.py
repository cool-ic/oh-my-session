#!/usr/bin/env python3
"""Render a tmux/ANSI capture (truecolor FG+BG) to a PNG screenshot.

Uses a **monospace** Latin font for 1-cell chars and a CJK font for
full-width chars so the TUI grid stays aligned (no "G r o k" spacing).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# CSI SGR (colors) — must NOT be stripped by OTHER_CSI
SGR_RE = re.compile(r"\x1b\[([0-9;]*)m")
# Strip non-SGR CSI only (cursor / erase / modes). Do not match final `m`.
OTHER_CSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-ln-z]")
OSC = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")

# Match TUI canvas (green dark) — see src/tui/theme.ts
DEFAULT_BG = (11, 18, 14)
DEFAULT_FG = (232, 238, 233)
# Cell size tuned so DejaVu/JetBrains Mono 14 ≈ 1 cell wide
CELL_W = 9
CELL_H = 18
PAD = 14
FONT_SIZE = 14

_SCRIPT_DIR = Path(__file__).resolve().parent

# Monospace first (Latin / digits / box-drawing fallbacks)
MONO_CANDIDATES = [
    str(_SCRIPT_DIR / "fonts" / "JetBrainsMono-Regular.ttf"),
    str(_SCRIPT_DIR / "fonts" / "DejaVuSansMono.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
    "/usr/share/fonts/truetype/ubuntu/UbuntuMono-R.ttf",
]

# CJK (full-width) — proportional is fine; we only use it for wide cells
CJK_CANDIDATES = [
    str(_SCRIPT_DIR / "fonts" / "wqy-microhei.ttc"),
    str(Path.home() / ".local/share/fonts/oh-my-sessions/wqy-microhei.ttc"),
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansSC-Regular.otf",
]


def _first_font(paths: list[str], size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for p in paths:
        try:
            if Path(p).is_file():
                return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def load_fonts(size: int = FONT_SIZE):
    mono = _first_font(MONO_CANDIDATES, size)
    cjk = _first_font(CJK_CANDIDATES, size)
    return mono, cjk


def display_width(s: str) -> int:
    w = 0
    for ch in s:
        o = ord(ch)
        if (
            0x1100 <= o <= 0x115F
            or 0x2E80 <= o <= 0xA4CF
            or 0xAC00 <= o <= 0xD7A3
            or 0xF900 <= o <= 0xFAFF
            or 0xFE10 <= o <= 0xFE6F
            or 0xFF00 <= o <= 0xFF60
            or 0xFFE0 <= o <= 0xFFE6
            or o >= 0x1F300
            # box drawing / block elements often double in some fonts — keep 1
        ):
            w += 2
        else:
            w += 1
    return w


def is_wide(ch: str) -> bool:
    return display_width(ch) == 2


def prefers_cjk_font(ch: str) -> bool:
    """Wide CJK, or symbols often missing from Latin mono fonts (★ etc.)."""
    if is_wide(ch):
        return True
    o = ord(ch)
    if ch in "★☆✦✧•●○◆◇■□▲△▶▷◀◁▌▐█░▒▓✓✗✔✖":
        return True
    # Misc symbols / dingbats / geometric shapes
    if 0x2190 <= o <= 0x21FF:  # arrows
        return True
    if 0x2600 <= o <= 0x27BF:
        return True
    if 0x2B00 <= o <= 0x2BFF:
        return True
    return False


def apply_sgr(
    params: list[int],
    fg: tuple[int, int, int] | None,
    bg: tuple[int, int, int] | None,
) -> tuple[tuple[int, int, int] | None, tuple[int, int, int] | None]:
    i = 0
    n = len(params)
    if n == 0:
        return None, None
    while i < n:
        p = params[i]
        if p == 0:
            fg, bg = None, None
            i += 1
        elif p == 39:
            fg = None
            i += 1
        elif p == 49:
            bg = None
            i += 1
        elif p == 38 and i + 4 < n and params[i + 1] == 2:
            fg = (params[i + 2], params[i + 3], params[i + 4])
            i += 5
        elif p == 48 and i + 4 < n and params[i + 1] == 2:
            bg = (params[i + 2], params[i + 3], params[i + 4])
            i += 5
        elif p == 38 and i + 2 < n and params[i + 1] == 5:
            idx = params[i + 2]
            if 232 <= idx <= 255:
                v = 8 + (idx - 232) * 10
                fg = (v, v, v)
            elif 16 <= idx <= 231:
                c = idx - 16
                r, g, b = c // 36, (c % 36) // 6, c % 6
                fg = (r * 51, g * 51, b * 51)
            i += 3
        elif p == 48 and i + 2 < n and params[i + 1] == 5:
            idx = params[i + 2]
            if 232 <= idx <= 255:
                v = 8 + (idx - 232) * 10
                bg = (v, v, v)
            elif 16 <= idx <= 231:
                c = idx - 16
                r, g, b = c // 36, (c % 36) // 6, c % 6
                bg = (r * 51, g * 51, b * 51)
            i += 3
        else:
            i += 1
    return fg, bg


def parse_line(line: str):
    """Yield (text, fg_rgb|None, bg_rgb|None) runs with truecolor state."""
    line = OSC.sub("", line)
    line = OTHER_CSI.sub("", line)
    pos = 0
    fg: tuple[int, int, int] | None = None
    bg: tuple[int, int, int] | None = None
    for m in SGR_RE.finditer(line):
        if m.start() > pos:
            yield line[pos : m.start()], fg, bg
        params = [int(x) for x in m.group(1).split(";") if x != ""]
        fg, bg = apply_sgr(params, fg, bg)
        pos = m.end()
    if pos < len(line):
        yield line[pos:], fg, bg


def glyph_bbox(draw: ImageDraw.ImageDraw, ch: str, font) -> tuple[int, int, int, int]:
    try:
        return draw.textbbox((0, 0), ch, font=font)
    except Exception:
        return (0, 0, CELL_W, CELL_H)


def draw_char_in_cell(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    ch: str,
    cells: int,
    fg: tuple[int, int, int],
    bg: tuple[int, int, int],
    font_mono,
    font_cjk,
) -> None:
    """Paint one character centered in `cells` grid cells."""
    cell_px = cells * CELL_W
    if bg != DEFAULT_BG:
        draw.rectangle([x, y, x + cell_px - 1, y + CELL_H - 1], fill=bg)

    if ch in (" ", "\t") or ch == "\u00a0":
        return

    font = font_cjk if prefers_cjk_font(ch) else font_mono
    l, t, r, b = glyph_bbox(draw, ch, font)
    gw, gh = max(1, r - l), max(1, b - t)
    # If mono produced an empty/tiny box, fall back to CJK
    if font is font_mono and gw < 2:
        font = font_cjk
        l, t, r, b = glyph_bbox(draw, ch, font)
        gw, gh = max(1, r - l), max(1, b - t)
    # Center in cell
    ox = x + max(0, (cell_px - gw) // 2) - l
    oy = y + max(0, (CELL_H - gh) // 2) - t
    draw.text((ox, oy), ch, fill=fg, font=font)


def main() -> None:
    if len(sys.argv) < 3:
        print(f"usage: {sys.argv[0]} <ansi.txt> <out.png>", file=sys.stderr)
        sys.exit(2)
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    raw = src.read_bytes().decode("utf-8", errors="replace")
    lines = raw.splitlines()
    while lines and not lines[-1].strip():
        lines.pop()

    max_cols = 1
    parsed = []
    for line in lines:
        runs = list(parse_line(line.rstrip("\n")))
        plain = "".join(t for t, _, _ in runs)
        max_cols = max(max_cols, display_width(plain))
        parsed.append(runs)

    w = PAD * 2 + max_cols * CELL_W
    h = PAD * 2 + len(parsed) * CELL_H
    img = Image.new("RGB", (w, h), DEFAULT_BG)
    draw = ImageDraw.Draw(img)
    font_mono, font_cjk = load_fonts(FONT_SIZE)

    y = PAD
    for runs in parsed:
        x = PAD
        for text, fg, bg in runs:
            color = fg if fg is not None else DEFAULT_FG
            cell_bg = bg if bg is not None else DEFAULT_BG
            for ch in text:
                cells = 2 if is_wide(ch) else 1
                draw_char_in_cell(
                    draw, x, y, ch, cells, color, cell_bg, font_mono, font_cjk
                )
                x += cells * CELL_W
        y += CELL_H

    draw.rectangle([0, 0, w, 3], fill=(42, 219, 92))
    img.save(dst, "PNG")
    print(f"wrote {dst} ({w}x{h})")


if __name__ == "__main__":
    main()
