#!/usr/bin/env python3
"""
Render tmux ANSI (truecolor FG+BG) to PNG on a **strict terminal cell grid**.

Column math mirrors `src/lib/width.ts` (display columns).
Glyphs are left-aligned on cell origins with a shared baseline.
Prefer **Sarasa Mono SC** (true dual-width CJK mono) when installed under
`scripts/fonts/`; otherwise JetBrains Mono + WenQuanYi Micro Hei Mono.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SGR_RE = re.compile(r"\x1b\[([0-9;]*)m")
OTHER_CSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-ln-z]")
OSC = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")

DEFAULT_BG = (11, 18, 14)
DEFAULT_FG = (232, 238, 233)
PAD = 12

_SCRIPT_DIR = Path(__file__).resolve().parent
_FONTS = _SCRIPT_DIR / "fonts"

# Prefer a real dual-width CJK monospace (not committed — too large).
SARASA_CANDIDATES = [
    _FONTS / "SarasaMonoSC-Regular.ttf",
    Path.home() / ".local/share/fonts/SarasaMonoSC-Regular.ttf",
    Path.home() / ".local/share/fonts/oh-my-sessions/SarasaMonoSC-Regular.ttf",
]

MONO_FALLBACK = [
    _FONTS / "JetBrainsMono-Regular.ttf",
    _FONTS / "DejaVuSansMono.ttf",
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"),
]

CJK_TTC = [
    _FONTS / "wqy-microhei.ttc",
    Path.home() / ".local/share/fonts/oh-my-sessions/wqy-microhei.ttc",
    Path("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"),
]


def is_fullwidth_codepoint(code: int) -> bool:
    """Match src/lib/width.ts isFullWidthCodePoint."""
    if code <= 0x1F or (0x7F <= code <= 0x9F):
        return False
    if 0x300 <= code <= 0x36F:
        return False
    if 0x1AB0 <= code <= 0x1AFF:
        return False
    if 0x20D0 <= code <= 0x20FF:
        return False
    if 0xFE00 <= code <= 0xFE0F:
        return False
    return (
        code == 0x3000
        or (0x1100 <= code <= 0x115F)
        or (0x2329 <= code <= 0x232A)
        or (0x2E80 <= code <= 0x303E)
        or (0x3040 <= code <= 0xA4CF)
        or (0xAC00 <= code <= 0xD7A3)
        or (0xF900 <= code <= 0xFAFF)
        or (0xFE10 <= code <= 0xFE19)
        or (0xFE30 <= code <= 0xFE6F)
        or (0xFF00 <= code <= 0xFF60)
        or (0xFFE0 <= code <= 0xFFE6)
        or (0x1F300 <= code <= 0x1F9FF)
        or (0x20000 <= code <= 0x2FFFD)
        or (0x30000 <= code <= 0x3FFFD)
    )


def display_width(ch: str) -> int:
    code = ord(ch)
    return 2 if is_fullwidth_codepoint(code) else 1


def line_cols(s: str) -> int:
    return sum(display_width(c) for c in s)


def apply_sgr(params: list[int], fg, bg):
    i, n = 0, len(params)
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
                fg = ((c // 36) * 51, ((c % 36) // 6) * 51, (c % 6) * 51)
            i += 3
        elif p == 48 and i + 2 < n and params[i + 1] == 5:
            idx = params[i + 2]
            if 232 <= idx <= 255:
                v = 8 + (idx - 232) * 10
                bg = (v, v, v)
            elif 16 <= idx <= 231:
                c = idx - 16
                bg = ((c // 36) * 51, ((c % 36) // 6) * 51, (c % 6) * 51)
            i += 3
        else:
            i += 1
    return fg, bg


def parse_line(line: str):
    line = OSC.sub("", line)
    line = OTHER_CSI.sub("", line)
    pos = 0
    fg = bg = None
    for m in SGR_RE.finditer(line):
        if m.start() > pos:
            yield line[pos : m.start()], fg, bg
        params = [int(x) for x in m.group(1).split(";") if x != ""]
        fg, bg = apply_sgr(params, fg, bg)
        pos = m.end()
    if pos < len(line):
        yield line[pos:], fg, bg


def _truetype(path: Path, size: int, index: int = 0):
    return ImageFont.truetype(str(path), size, index=index)


def load_fonts():
    """
    Returns (font_for_all_or_latin, font_cjk_or_same, cell_w, cell_h, baseline_off, mode)
    mode: 'sarasa' | 'dual'
    """
    # --- Prefer single dual-width font (best alignment) ---
    for p in SARASA_CANDIDATES:
        if not p.is_file():
            continue
        # size 16 → M=8, 中=16 exactly on Sarasa Mono SC
        for size in (16, 18, 14, 20, 12):
            f = _truetype(p, size)
            m = f.getlength("M")
            z = f.getlength("中")
            if abs(z - 2 * m) < 0.6:
                ascent, descent = f.getmetrics()
                cell_w = max(1, int(round(m)))
                cell_h = ascent + descent + 2
                return f, f, cell_w, cell_h, ascent + 1, "sarasa"
        # any size close enough
        f = _truetype(p, 16)
        m = f.getlength("M")
        ascent, descent = f.getmetrics()
        return f, f, max(1, int(round(m))), ascent + descent + 2, ascent + 1, "sarasa"

    # --- Dual: Latin mono + WQY Mono sized for 2× cell ---
    mono = None
    for p in MONO_FALLBACK:
        if p.is_file():
            mono = _truetype(p, 15)
            break
    if mono is None:
        raise SystemExit("no monospace font found")

    cell_w = max(1, int(round(mono.getlength("M"))))
    target = 2 * cell_w
    cjk = mono
    ttc = next((p for p in CJK_TTC if p.is_file()), None)
    if ttc:
        best = None
        for sz in range(8, 48):
            try:
                f = _truetype(ttc, sz, index=1)  # Micro Hei Mono
            except Exception:
                f = _truetype(ttc, sz, index=0)
            err = abs(f.getlength("中") - target)
            if best is None or err < best[0]:
                best = (err, f)
        cjk = best[1]  # type: ignore

    ascent, descent = mono.getmetrics()
    return mono, cjk, cell_w, ascent + descent + 2, ascent + 1, "dual"


def main() -> None:
    if len(sys.argv) < 3:
        print(f"usage: {sys.argv[0]} <ansi.txt> <out.png>", file=sys.stderr)
        sys.exit(2)
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    raw = src.read_bytes().decode("utf-8", errors="replace")
    lines = raw.splitlines()
    while lines and not lines[-1].strip():
        lines.pop()

    font_latin, font_cjk, CELL_W, CELL_H, baseline_off, mode = load_fonts()

    parsed = []
    max_cols = 1
    for line in lines:
        runs = list(parse_line(line.rstrip("\n")))
        plain = "".join(t for t, _, _ in runs)
        max_cols = max(max_cols, line_cols(plain))
        parsed.append(runs)

    W = PAD * 2 + max_cols * CELL_W
    H = PAD * 2 + len(parsed) * CELL_H
    img = Image.new("RGB", (W, H), DEFAULT_BG)

    y = PAD
    for runs in parsed:
        col = 0
        for text, fg, bg in runs:
            color = fg if fg is not None else DEFAULT_FG
            cell_bg = bg if bg is not None else DEFAULT_BG
            for ch in text:
                cells = display_width(ch)
                x = PAD + col * CELL_W
                cell_px_w = cells * CELL_W

                # Paint cell bg on main canvas
                if cell_bg != DEFAULT_BG:
                    draw = ImageDraw.Draw(img)
                    draw.rectangle(
                        [x, y, x + cell_px_w - 1, y + CELL_H - 1], fill=cell_bg
                    )

                if ch not in (" ", "\t", "\u00a0"):
                    # Pick font: fullwidth → CJK face; else Latin mono
                    code = ord(ch)
                    use_cjk = is_fullwidth_codepoint(code) or mode == "sarasa"
                    font = font_cjk if use_cjk else font_latin

                    # Render into a cell-sized RGBA tile then paste — hard clip
                    # so oversize glyphs (e.g. ★) cannot shift columns.
                    tile = Image.new("RGBA", (cell_px_w, CELL_H), (0, 0, 0, 0))
                    td = ImageDraw.Draw(tile)
                    # Left edge + shared baseline; never horizontal-center
                    td.text(
                        (0, baseline_off),
                        ch,
                        fill=color + (255,),
                        font=font,
                        anchor="ls",
                    )
                    img.paste(tile, (x, y), tile)

                col += cells
        y += CELL_H

    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, W, 3], fill=(42, 219, 92))
    img.save(dst, "PNG")
    print(
        f"wrote {dst} ({W}x{H}) mode={mode} CELL={CELL_W}x{CELL_H} "
        f"M={font_latin.getlength('M'):.1f} 中={font_cjk.getlength('中'):.1f}"
    )


if __name__ == "__main__":
    main()
