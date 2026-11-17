# Before and after crops of the same spots, enlarged (scripts/water-light-frames.mjs takes the
# frames): for each view, the boxes below cut from <dir>/<view>-before.png and <dir>/<view>-after.png,
# set side by side (before on the left) and enlarged three times with nearest neighbour, so every
# eighth of a voxel shows.
#
#   python3 scripts/water-light-crops.py <dir> [views]
import sys
from pathlib import Path

from PIL import Image, ImageDraw

# x0, y0, x1, y1 at 700 by 830: where water meets land, the water's side, snow edges.
BOXES = {
    "pond": [(300, 240, 520, 420), (0, 330, 220, 510)],
    "side": [(0, 450, 220, 650), (420, 180, 700, 320)],
    "beach": [(0, 320, 240, 520), (380, 420, 620, 620)],
    "peak": [(180, 380, 420, 620), (380, 60, 620, 300)],
    "night": [(160, 300, 420, 520), (420, 0, 700, 140)],
    "lava": [(0, 120, 280, 360), (280, 330, 560, 520)],
    "bang": [(240, 300, 480, 500), (380, 80, 620, 280)],
}
SCALE = 3


def main() -> None:
    out = Path(sys.argv[1])
    views = sys.argv[2].split(",") if len(sys.argv) > 2 else list(BOXES)
    for view in views:
        before = out / f"{view}-before.png"
        after = out / f"{view}-after.png"
        if not before.exists() or not after.exists():
            continue
        a = Image.open(before).convert("RGB")
        b = Image.open(after).convert("RGB")
        for k, box in enumerate(BOXES[view]):
            w = (box[2] - box[0]) * SCALE
            h = (box[3] - box[1]) * SCALE
            sheet = Image.new("RGB", (w * 2 + 8, h + 24), (24, 24, 28))
            for col, im, label in ((0, a, "before (main)"), (1, b, "after")):
                crop = im.crop(box).resize((w, h), Image.NEAREST)
                sheet.paste(crop, (col * (w + 8), 24))
                ImageDraw.Draw(sheet).text((col * (w + 8) + 6, 6), f"{label}  {view} {box}", fill=(235, 235, 235))
            path = out / f"crop-{view}-{k + 1}.png"
            sheet.save(path)
            print(path)


main()
