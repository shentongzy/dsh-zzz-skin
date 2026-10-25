"""Fit the eyeball as a TRUE circle, then rebuild it with its white light effect.

Why a fit and not a threshold: the dot's lower-right blends into the lavender
band and the white ring, so any colour-based boundary catches those too and the
circle comes out lopsided - that is what made it look elliptical.

So the circle is fitted from only the upper-left arc, where the dot has a real
edge against the dark blue centre disc (least squares / Kasa fit). Then:

  * a clean cream disc of exactly that centre and radius is drawn;
  * the white light effect is restored on purpose: a soft glow up-left of the
    dot plus a faint rim halo, so it still reads as a lit sphere.

ASCII only (Windows locale + Python source encoding).
"""
from PIL import Image, ImageDraw, ImageFilter
import math, os

base = r"C:\Users\YZY\Documents\deepseek-harness\default-workspace"
im = Image.open(os.path.join(base, "_ref", "ref2.png")).convert("RGB")
W, H = im.size
px = im.load()
SEED = (330.0, 365.0)


def lum(p):
    return (p[0] + p[1] + p[2]) / 3.0


def is_cream(p):
    return lum(p) > 200 and p[0] >= p[2]


pts = []
for k in range(360):
    a = math.radians(k)
    for r in range(10, 60):
        x = int(round(SEED[0] + math.cos(a) * r))
        y = int(round(SEED[1] + math.sin(a) * r))
        xo = int(round(SEED[0] + math.cos(a) * (r + 2)))
        yo = int(round(SEED[1] + math.sin(a) * (r + 2)))
        if not (0 <= x < W and 0 <= y < H and 0 <= xo < W and 0 <= yo < H):
            break
        if is_cream(px[x, y]) and (not is_cream(px[xo, yo])) and lum(px[xo, yo]) < 195:
            pts.append((x, y))
            break

print("edge points against the dark disc:", len(pts))
if len(pts) < 12:
    raise SystemExit("not enough edge points to fit")

n = float(len(pts))
sx = sum(p[0] for p in pts)
sy = sum(p[1] for p in pts)
sxx = sum(p[0] * p[0] for p in pts)
syy = sum(p[1] * p[1] for p in pts)
sxy = sum(p[0] * p[1] for p in pts)
sxz = sum(p[0] * (p[0] ** 2 + p[1] ** 2) for p in pts)
syz = sum(p[1] * (p[0] ** 2 + p[1] ** 2) for p in pts)
sz = sum(p[0] ** 2 + p[1] ** 2 for p in pts)

A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]]
b = [sxz, syz, sz]
for i in range(3):
    piv = max(range(i, 3), key=lambda r: abs(A[r][i]))
    A[i], A[piv] = A[piv], A[i]
    b[i], b[piv] = b[piv], b[i]
    for r in range(i + 1, 3):
        f = A[r][i] / A[i][i]
        for c in range(i, 3):
            A[r][c] -= f * A[i][c]
        b[r] -= f * b[i]
sol = [0.0, 0.0, 0.0]
for i in (2, 1, 0):
    s = b[i] - sum(A[i][c] * sol[c] for c in range(i + 1, 3))
    sol[i] = s / A[i][i]

cx = sol[0] / 2.0
cy = sol[1] / 2.0
R = math.sqrt(sol[2] + cx * cx + cy * cy)
print("fitted circle: centre = (%.2f, %.2f)  radius = %.2f" % (cx, cy, R))

acc = [0, 0, 0]
bn = 0
for y in range(int(cy - R), int(cy + R) + 1):
    for x in range(int(cx - R), int(cx + R) + 1):
        if 0 <= x < W and 0 <= y < H and math.hypot(x - cx, y - cy) < R * 0.9:
            p = px[x, y]
            if lum(p) <= 246:
                acc[0] += p[0]
                acc[1] += p[1]
                acc[2] += p[2]
                bn += 1
col = tuple(int(v / bn) for v in acc)
print("base colour = #%02x%02x%02x" % col)

mask = Image.new("L", (W, H), 0)
d = ImageDraw.Draw(mask)
steps = 260
for i in range(steps, -1, -1):
    r = R * 1.06 * i / steps
    if r <= 0.01:
        continue
    f = r / R
    v = 1.0 if f <= 0.985 else max(0.0, 1.0 - (f - 0.985) / (1.06 - 0.985))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=int(round(255 * v)))
mask = mask.filter(ImageFilter.GaussianBlur(1.0))

out = Image.composite(Image.new("RGB", (W, H), col), im, mask)

white = Image.new("RGB", (W, H), (252, 254, 255))

glow = Image.new("L", (W, H), 0)
gd = ImageDraw.Draw(glow)
gx, gy, gr = cx - R * 0.42, cy - R * 0.52, R * 1.55
for i in range(140, 0, -1):
    rr = gr * i / 140.0
    a = int(round(255 * 0.42 * (1.0 - i / 140.0) ** 1.7))
    if a > 0:
        gd.ellipse([gx - rr, gy - rr, gx + rr, gy + rr], fill=a)
glow = glow.filter(ImageFilter.GaussianBlur(R * 0.30))
out = Image.composite(white, out, glow)

rim = Image.new("L", (W, H), 0)
rd = ImageDraw.Draw(rim)
for i in range(100, 0, -1):
    rr = R * (1.02 + 0.30 * i / 100.0)
    a = int(round(255 * 0.20 * (1.0 - i / 100.0)))
    if a > 0:
        rd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=a)
rim = rim.filter(ImageFilter.GaussianBlur(R * 0.18))
out = Image.composite(white, out, rim)

out.save(os.path.join(base, "_ref", "ref2-clean.png"))
print("saved ref2-clean.png")

half = 70
box = (int(cx - half), int(cy - half), int(cx + half), int(cy + half))
im.crop(box).resize((half * 14, half * 14), Image.LANCZOS).save(os.path.join(base, "eye_before_zoom.png"))
out.crop(box).resize((half * 14, half * 14), Image.LANCZOS).save(os.path.join(base, "eye_after_zoom.png"))
print("zooms written")
