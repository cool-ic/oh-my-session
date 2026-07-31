#!/usr/bin/env python3
"""Render a tmux/ANSI capture (truecolor) to a dark warm PNG screenshot."""
from __future__ import annotations

import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# CSI sequences we care about
SGR_RE = re.compile(r"\x1b\[([0-9;]*)m")
# strip other CSI (cursor etc.) — capture should be mostly SGR + text
OTHER_CSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
OSC = re.compile(r"\x1b\][^\x07]*\x07")

BG = (28, 24, 20)  # warm near-black parchment dark
FG = (232, 220, 200)
CELL_W = 9
CELL_H = 18
PAD = 16


def parse_line(line: str):
    """Yield (text, fg_rgb|None) runs."""
    line = OSC.sub("", line)
    line = OTHER_CSI.sub("", line)
    pos = 0
    fg = None
    for m in SGR_RE.finditer(line):
        if m.start() > pos:
            yield line[pos : m.start()], fg
        params = [int(x) for x in m.group(1).split(";") if x != ""]
        if not params or params == [0]:
            fg = None
        elif len(params) >= 5 and params[0] == 38 and params[1] == 2:
            fg = (params[2], params[3], params[4])
        elif params[0] == 39:
            fg = None
        pos = m.end()
    if pos < len(line):
        yield line[pos:], fg


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


def main() -> None:
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    raw = src.read_bytes().decode("utf-8", errors="replace")
    lines = raw.splitlines()
    # trim trailing empties
    while lines and not lines[-1].strip():
        lines.pop()

    max_cols = 1
    parsed = []
    for line in lines:
        runs = list(parse_line(line.rstrip("\n")))
        plain = "".join(t for t, _ in runs)
        max_cols = max(max_cols, display_width(plain))
        parsed.append(runs)

    w = PAD * 2 + max_cols * CELL_W
    h = PAD * 2 + len(parsed) * CELL_H
    img = Image.new("RGB", (w, h), BG)
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 14
        )
    except Exception:
        try:
            font = ImageFont.truetype(
                "/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf", 13
            )
        except Exception:
            font = ImageFont.load_default()

    y = PAD
    for runs in parsed:
        x = PAD
        for text, fg in runs:
            color = fg or FG
            # draw char by char for CJK width
            for ch in text:
                cw = 2 if display_width(ch) == 2 else 1
                draw.text((x, y), ch, fill=color, font=font)
                x += cw * CELL_W
        y += CELL_H

    # soft top accent line
    draw.rectangle([0, 0, w, 3], fill=(180, 140, 90))
    img.save(dst, "PNG")
    print(f"wrote {dst} ({w}x{h})")


if __name__ == "__main__":
    main()
