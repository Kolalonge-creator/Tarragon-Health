#!/usr/bin/env python3
"""Produce transparent-background copies of the Guard Leaf brand assets.

    python3 apps/web/scripts/make-transparent-brand-assets.py

docs/BRAND_GUIDE.md §4 approves four backgrounds for the logo: white, Warm
Ivory, Soft Sage and Deep Navy. The shipped PNGs are RGB with no alpha — a solid
white rectangle — so today the logo can only actually be placed on ONE of those
four. On Warm Ivory or Soft Sage it renders as a white box sitting on the tint.
That is a live violation of the guide's own usage rules, not a hypothetical, and
it is what this script fixes.

## What this does and does not do

It does NOT touch the artwork. No pixel of the mark, the sprout crown, the
checkmark vein or the wordmark changes colour. The guide's "never recolour the
shield outside the palette" is not in play here: this only removes an opaque
background that was never part of the design. It is the same output an export
with transparency from the source file would give.

It writes NEW files (`-transparent` suffix) and never overwrites the originals,
so the canonical assets in the repo stay exactly as delivered.

## Why a flood fill rather than a colour key

The obvious approach — "make every near-white pixel transparent" — destroys the
logo. The checkmark vein inside the shield is itself near-white (#F8FAF8), so a
colour key punches a checkmark-shaped hole through the mark. That is precisely
why an earlier pass at this problem was rejected as unsafe.

The background is distinguishable from the checkmark not by colour but by
CONNECTIVITY: it touches the image border, and the checkmark does not. So:

  1. Flood fill inward from all four edges over near-white pixels. Everything
     reached is background; the checkmark is enclosed by green and is never
     reached.
  2. Anti-aliased edge pixels are blends of white and artwork. A binary cutout
     leaves a pale fringe that shows up badly on a dark ground, so pixels in a
     thin band around the filled region get a partial alpha derived from how
     white they are, and their colour is un-premultiplied back out of white.
  3. Everything else keeps full opacity and its exact original colour.
"""

from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

from PIL import Image

# A pixel is "background-ish" if every channel is at least this bright. The
# checkmark sits around 248 and is protected by connectivity, not this number,
# so the threshold only needs to catch the paper.
WHITE_FLOOR = 246
# How far the anti-aliased rim extends past the solid background.
FEATHER_PX = 2

REPO_ASSETS = [
    ("public/brand/guard-leaf-mark.png", "public/brand/guard-leaf-mark-transparent.png"),
    ("public/brand/guard-leaf-lockup.png", "public/brand/guard-leaf-lockup-transparent.png"),
]


def is_whiteish(px: tuple[int, ...]) -> bool:
    return min(px[0], px[1], px[2]) >= WHITE_FLOOR


def make_transparent(src: Path, dst: Path) -> dict[str, int]:
    img = Image.open(src).convert("RGBA")
    w, h = img.size
    px = img.load()
    assert px is not None

    # ---- 1. flood fill the background in from the border --------------------
    background = bytearray(w * h)
    queue: deque[tuple[int, int]] = deque()

    def consider(x: int, y: int) -> None:
        if 0 <= x < w and 0 <= y < h and not background[y * w + x] and is_whiteish(px[x, y]):
            background[y * w + x] = 1
            queue.append((x, y))

    for x in range(w):
        consider(x, 0)
        consider(x, h - 1)
    for y in range(h):
        consider(0, y)
        consider(w - 1, y)

    while queue:
        x, y = queue.popleft()
        consider(x + 1, y)
        consider(x - 1, y)
        consider(x, y + 1)
        consider(x, y - 1)

    # ---- 2. the anti-aliased rim -------------------------------------------
    # Pixels within FEATHER_PX of the filled region that are lighter than the
    # artwork around them are partial blends with the paper.
    rim: set[tuple[int, int]] = set()
    for y in range(h):
        row = y * w
        for x in range(w):
            if not background[row + x]:
                continue
            for dy in range(-FEATHER_PX, FEATHER_PX + 1):
                for dx in range(-FEATHER_PX, FEATHER_PX + 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and not background[ny * w + nx]:
                        rim.add((nx, ny))

    # ---- 3. write alpha -----------------------------------------------------
    cleared = 0
    feathered = 0
    for y in range(h):
        row = y * w
        for x in range(w):
            r, g, b, _ = px[x, y]
            if background[row + x]:
                px[x, y] = (r, g, b, 0)
                cleared += 1
            elif (x, y) in rim:
                # P = a*F + (1-a)*255. Estimate a from the darkest channel,
                # which is the one least contaminated by the white paper, then
                # recover F so the edge does not carry a pale halo.
                darkest = min(r, g, b)
                alpha = 255 - darkest
                if alpha <= 0:
                    px[x, y] = (r, g, b, 0)
                    cleared += 1
                elif alpha >= 255:
                    px[x, y] = (r, g, b, 255)
                else:
                    a = alpha / 255.0
                    unpremultiplied = tuple(
                        max(0, min(255, round((c - (1 - a) * 255) / a))) for c in (r, g, b)
                    )
                    px[x, y] = (*unpremultiplied, alpha)
                    feathered += 1

    img.save(dst, "PNG", optimize=True)
    return {"width": w, "height": h, "cleared": cleared, "feathered": feathered}


def main() -> int:
    base = Path(__file__).resolve().parents[1]
    for src_rel, dst_rel in REPO_ASSETS:
        src, dst = base / src_rel, base / dst_rel
        if not src.exists():
            print(f"missing source asset: {src}", file=sys.stderr)
            return 1
        stats = make_transparent(src, dst)
        print(f"{dst_rel}: {stats['width']}x{stats['height']}, "
              f"{stats['cleared']} px cleared, {stats['feathered']} px feathered")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
