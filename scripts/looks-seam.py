# The seam's numbers from scripts/looks-seam.mjs: for each view and threshold, a strip of the screen
# 80 pixels tall round the seam (the median height of its points on the screen), cropped from the
# all-eighths frame and the switched one; their difference (mean and max per channel, 0..255, and
# the share of pixels off by more than 8), the two crops, and the two enlarged side by side.
#
#   python3 scripts/looks-seam.py <out dir> < seam.jsonl
import json
import sys

from PIL import Image, ImageChops

out = sys.argv[1]
for line in sys.stdin:
    if not line.startswith("{"):
        continue
    r = json.loads(line)
    view, px, seam = r["view"], r["px"], r["seam"]
    a = Image.open(f"{out}/{view}-px{px}-eighths.png").convert("RGB")
    a2 = Image.open(f"{out}/{view}-px{px}-eighths-again.png").convert("RGB")
    b = Image.open(f"{out}/{view}-px{px}.png").convert("RGB")
    whole = ImageChops.difference(a, b)
    if not seam:
        print(json.dumps({"view": view, "px": px, "quarters": r["quarters"], "seam": "not on screen", "tris": r["tris"], "trisEighths": r["trisEighths"]}))
        continue
    ys = sorted(p[1] for p in seam)
    mid = ys[len(ys) // 2]
    box = (0, max(0, int(mid) - 40), a.width, min(a.height, int(mid) + 40))
    ca, cb = a.crop(box), b.crop(box)
    ca.save(f"{out}/{view}-px{px}-crop-eighths.png")
    cb.save(f"{out}/{view}-px{px}-crop-switched.png")
    side = Image.new("RGB", (ca.width * 2 + 6, ca.height), (255, 0, 255))
    side.paste(ca, (0, 0))
    side.paste(cb, (ca.width + 6, 0))
    side.resize((side.width * 3, side.height * 3), Image.NEAREST).save(f"{out}/{view}-px{px}-side-by-side.png")
    n = ca.width * ca.height

    def measure(x, y):
        d = ImageChops.difference(x, y)
        hist = d.histogram()
        mean = sum(i * hist[c * 256 + i] for c in range(3) for i in range(256)) / (3 * n)
        mx = max([i for c in range(3) for i in range(256) if hist[c * 256 + i]] or [0])
        lum = d.convert("L").histogram()
        return mean, mx, sum(lum[9:])

    mean, mx, over = measure(cb, a2.crop(box))
    noise, noise_max, noise_over = measure(ca, a2.crop(box))
    wh = whole.histogram()
    wmean = sum(i * wh[c * 256 + i] for c in range(3) for i in range(256)) / (3 * a.width * a.height)
    print(
        json.dumps(
            {
                "view": view,
                "px": px,
                "quarters": r["quarters"],
                "strip": box,
                "mean": round(mean, 3),
                "meanPct": round(mean / 2.55, 3),
                "max": mx,
                "over8Pct": round(100 * over / n, 3),
                "noiseMeanPct": round(noise / 2.55, 3),
                "noiseMax": noise_max,
                "noiseOver8Pct": round(100 * noise_over / n, 3),
                "wholeFrameMeanPct": round(wmean / 2.55, 3),
                "tris": r["tris"],
                "trisEighths": r["trisEighths"],
            }
        )
    )
