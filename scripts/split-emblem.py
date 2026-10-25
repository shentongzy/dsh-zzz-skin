"""Split the emblem into THREE layers so the inner rings can grow toward the
white ring while the white ring itself never exceeds the outer dark ring.

Measured on the source (emblem centre 300.9 / 316.4):

    cyan band edge   ~76 px
    lavender band     78 .. 98
    white ring        100 .. 136      <- anchor, must not move
    dark ring        138 .. 204       <- outermost, nothing may cross it
    glow             206 ..

Layers:
    emblem-outer.png   r >= RING_IN            dark ring + triangles + glow -> rotates
    emblem-core.png    r <= CORE_OUT           lavender / cyan / disc / eye -> breathes
    emblem-ring.png    CORE_OUT <= r <= RING_IN   white ring                -> static

The ring is drawn ON TOP of the core, so the core growing outward is clipped by
it: the lavender band closes up and the cyan band visibly approaches the white
ring, while the white ring and everything outside it stay exactly put.

ASCII only.
"""
from PIL import Image, ImageDraw, ImageFilter
import os

base = r"C:\Users\YZY\Documents\deepseek-harness\default-workspace"
src = os.path.join(base, "_ref", "ref2-clean.png")
outdir = os.path.join(base, "dsh-zzz-skin", "assets")

im = Image.open(src).convert("RGB")
W, H = im.size

# same crop as cut-emblem.py
sx = sy = weight = 0.0
px = im.load()
for y in range(H):
    for x in range(W):
        r, g, b = px[x, y]
        lum = (r + g + b) / 3.0
        if lum > 140:
            w = lum - 140
            sx += x * w
            sy += y * w
            weight += w
cx, cy = int(round(sx / weight)), int(round(sy / weight))
side = 520
x0 = max(0, min(W - side, cx - side // 2))
y0 = max(0, min(H - side, cy - side // 2))
crop = im.crop((x0, y0, x0 + side, y0 + side))
ccx, ccy = cx - x0, cy - y0
print("crop", (x0, y0), "centre", (ccx, ccy))

CORE_OUT = 98     # lavender/white boundary
RING_IN = 139     # white/dark boundary
OUTER_IN, OUTER_OUT = 204, 238


def radial_alpha(fn):
    a = Image.new("L", (side, side), 0)
    d = ImageDraw.Draw(a)
    # outside in: a big filled circle drawn later would erase the inner ones
    for r in range(side, -1, -1):
        v = fn(r)
        if v <= 0:
            continue
        d.ellipse([ccx - r, ccy - r, ccx + r, ccy + r], fill=v)
    return a.filter(ImageFilter.GaussianBlur(1.4))


def smooth(v, lo, hi):
    if v <= lo:
        return 0.0
    if v >= hi:
        return 1.0
    t = (v - lo) / (hi - lo)
    return t * t * (3 - 2 * t)


outer_a = radial_alpha(lambda r: int(255 * smooth(r, RING_IN - 5, RING_IN + 7) * (1 - smooth(r, OUTER_IN, OUTER_OUT))))
ring_a = radial_alpha(
    lambda r: int(255 * smooth(r, CORE_OUT - 4, CORE_OUT + 4) * (1 - smooth(r, RING_IN - 4, RING_IN + 4)))
)
core_a = radial_alpha(lambda r: int(255 * (1 - smooth(r, CORE_OUT - 3, CORE_OUT + 5))))

for name, alpha in (("emblem-outer", outer_a), ("emblem-core", core_a), ("emblem-ring", ring_a)):
    layer = crop.convert("RGBA")
    layer.putalpha(alpha)
    p = os.path.join(outdir, name + ".png")
    layer.save(p, optimize=True)
    print("saved", name, os.path.getsize(p), "bytes")

stale = os.path.join(outdir, "emblem-inner.png")
if os.path.exists(stale):
    os.remove(stale)
    print("removed stale emblem-inner.png")
