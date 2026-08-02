#!/usr/bin/env python3
"""Render a tmux/ANSI capture (truecolor FG+BG) to a PNG screenshot."""
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
CELL_W = 9
CELL_H = 18
PAD = 16

# Prefer CJK-capable fonts so Chinese titles don't render as tofu (□).
FONT_CANDIDATES = [
    str(Path(__file__).resolve().parent / "fonts" / "wqy-microhei.ttc"),
    str(Path.home() / ".local/share/fonts/oh-my-sessions/wqy-microhei.ttc"),
    str(Path.home() / ".local/share/fonts/wqy-microhei.ttc"),
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-SC-Regular.otf",
    "/usr/share/fonts/truetype/noto/NotoSansSC-Regular.otf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf",
]


def load_font(size: int = 14):
    for p in FONT_CANDIDATES:
        try:
            if Path(p).is_file():
                return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


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
        ):
            w += 2
        else:
            w += 1
    return w


def apply_sgr(
    params: list[int],
    fg: tuple[int, int, int] | None,
    bg: tuple[int, int, int] | None,
) -> tuple[tuple[int, int, int] | None, tuple[int, int, int] | None]:
    """Apply one CSI … m parameter list (may contain several attrs)."""
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
            # 256-color — approximate gray ramp / ignore fancy mapping
            idx = params[i + 2]
            if 232 <= idx <= 255:
                v = 8 + (idx - 232) * 10
                fg = (v, v, v)
            elif 16 <= idx <= 231:
                c = idx - 16
                r = c // 36
                g = (c % 36) // 6
                b = c % 6
                fg = (r * 51, g * 51, b * 51)
            i += 3
        elif p == 48 and i + 2 < n and params[i + 1] == 5:
            idx = params[i + 2]
            if 232 <= idx <= 255:
                v = 8 + (idx - 232) * 10
                bg = (v, v, v)
            elif 16 <= idx <= 231:
                c = idx - 16
                r = c // 36
                g = (c % 36) // 6
                b = c % 6
                bg = (r * 51, g * 51, b * 51)
            i += 3
        else:
            # bold/dim/underline etc. — ignore for screenshot
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
    font = load_font(14)

    y = PAD
    for runs in parsed:
        x = PAD
        for text, fg, bg in runs:
            color = fg if fg is not None else DEFAULT_FG
            cell_bg = bg if bg is not None else DEFAULT_BG
            for ch in text:
                cw = 2 if display_width(ch) == 2 else 1
                # fill cell background (selection, pills, brand chips, …)
                if cell_bg != DEFAULT_BG:
                    draw.rectangle(
                        [x, y, x + cw * CELL_W - 1, y + CELL_H - 1],
                        fill=cell_bg,
                    )
                # skip pure space after bg fill for speed
                if ch != " " and ch != "\t":
                    # slight vertical centering for CJK in cell
                    draw.text((x, y + 1), ch, fill=color, font=font)
                x += cw * CELL_W
        y += CELL_H

    # brand accent strip
    draw.rectangle([0, 0, w, 3], fill=(42, 219, 92))
    img.save(dst, "PNG")
    print(f"wrote {dst} ({w}x{h})")


if __name__ == "__main__":
    main()
