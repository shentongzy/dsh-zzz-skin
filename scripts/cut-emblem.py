"""Cut the emblem out of the reference image with a radial alpha fade.

ASCII only: this file is read by Python whose source encoding depends on the
Windows locale, and non-ASCII comments break it.

Two fixes over the first version:
  1. centre on the *visual* mass (bright-pixel centroid), not on the geometric
     centre - the source has a brighter wash on the right, so a geometric crop
     looks shifted right;
  2. tighter crop + earlier alpha fade, so that asymmetric outer wash is cut
     away instead of being carried into the skin.

Output: assets/emblem.png (RGBA, 520x520)
"""
from PIL import Image, ImageDraw, ImageFilter
import os

src = r"C:\Users\YZY\Documents\deepseek-harness\default-workspace\_ref\ref2-clean.png"
dst = r"C:\Users\YZY\Documents\deepseek-harness\default-workspace\dsh-zzz-skin\assets\emblem.png"

im = Image.open(src).convert("RGB")
W, H = im.size
print("source", im.size)

# --- visual centre: centroid of the bright rings, weighted by brightness ---
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
cx, cy = sx / weight, sy / weight
print("bright-mass centroid = (%.1f, %.1f)" % (cx, cy))

side = 520
cx, cy = int(round(cx)), int(round(cy))
x0 = max(0, min(W - side, cx - side // 2))
y0 = max(0, min(H - side, cy - side // 2))
crop = im.crop((x0, y0, x0 + side, y0 + side))
print("crop", (x0, y0, side), "centre lands at", (cx - x0, cy - y0))

# --- radial alpha: solid through the dark ring (r<=212), gone by 258 ---
alpha = Image.new("L", (side, side), 0)
d = ImageDraw.Draw(alpha)
ccx, ccy = cx - x0, cy - y0
inner, outer = 204, 238
for r in range(outer, inner - 1, -1):
    t = (outer - r) / (outer - inner)
    d.ellipse([ccx - r, ccy - r, ccx + r, ccy + r], fill=int(255 * (t ** 0.7)))
alpha = alpha.filter(ImageFilter.GaussianBlur(2.5))

out = crop.convert("RGBA")
out.putalpha(alpha)

os.makedirs(os.path.dirname(dst), exist_ok=True)
out.save(dst, optimize=True)
print("saved", dst, os.path.getsize(dst), "bytes", out.size, "centre", (ccx, ccy))
