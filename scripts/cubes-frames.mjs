// The village houses and the trees in small cubes (5.2.5): the same views with the cubes off and on,
// for a before and after, at the medium preset otherwise. The Perf Lab (lab/perf.html) on a large
// island, held still once the view is set. Views: a village and a forest at close and mid zoom.
// With MEASURE=1 it also prints the frame's triangles and the draw time (perfBench) per view,
// and the whole island at far zoom.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/cubes-frames.mjs <out dir> [390x844,344x882] [views]
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "frames";
const SIZES = (process.argv[3] ?? "390x844,344x882").split(",").map((s) => s.split("x").map(Number));
const ONLY = process.argv[4] ? new Set(process.argv[4].split(",")) : null;
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const SEED = Number(process.env.SEED ?? 7);
const SIZE = process.env.SIZE ?? "large";
const MEASURE = process.env.MEASURE === "1";
mkdirSync(OUT, { recursive: true });

// The biggest village and the thickest wood of the island, in the page.
function spots() {
  const w = window.__engine.world;
  const villages = [...w.settlements].sort((a, b) => (b.jobs?.length ?? 0) - (a.jobs?.length ?? 0) || b.level - a.level);
  const v = villages[0];
  // The densest 9 by 9 of trees.
  const treeKind = window.__treeCover;
  let best = -1;
  let wood = { x: w.w / 2, y: w.h / 2 };
  for (let y = 6; y < w.h - 6; y += 3)
    for (let x = 6; x < w.w - 6; x += 3) {
      let n = 0;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (w.cover[(y + dy) * w.w + x + dx] === treeKind) n++;
      if (n > best) {
        best = n;
        wood = { x, y };
      }
    }
  // A house of that village: the house cell nearest its middle.
  let house = v ? { x: v.x, y: v.y } : wood;
  let hd = Infinity;
  for (let i = 0; i < w.n; i++)
    if (w.cover[i] === window.__houseCover && v) {
      const d = Math.hypot((i % w.w) - v.x, Math.floor(i / w.w) - v.y);
      if (d < hd) {
        hd = d;
        house = { x: (i % w.w) + 1, y: Math.floor(i / w.w) + 1 };
      }
    }
  return { village: v ? { x: v.x, y: v.y } : { x: w.w / 2, y: w.h / 2 }, forest: wood, house, side: w.w };
}

const VIEWS = {
  "house-close": (s) => ({ tx: s.house.x, ty: s.house.y, dist: 8, phi: 0.8 }),
  "village-close": (s) => ({ tx: s.village.x, ty: s.village.y, dist: 22, phi: 0.9 }),
  "village-mid": (s) => ({ tx: s.village.x, ty: s.village.y, dist: 40, phi: 0.95 }),
  "forest-close": (s) => ({ tx: s.forest.x, ty: s.forest.y, dist: 16, phi: 0.85 }),
  "forest-mid": (s) => ({ tx: s.forest.x, ty: s.forest.y, dist: 40, phi: 0.95 }),
};
if (MEASURE) VIEWS["island-far"] = (s) => ({ tx: s.side / 2, ty: s.side / 2, dist: s.side * 0.55, phi: 0.95 });

let found = null;
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const [W, H] of SIZES) {
    for (const look of ["before", "after"]) {
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true });
      const page = await ctx.newPage();
      page.on("pageerror", (err) => console.error("page error:", err.message));
      await page.goto(`${BASE}?size=${SIZE}&seed=${SEED}&dpr=1&quality=medium&time=40${look === "before" ? "&off=cubes" : ""}`);
      await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
      await page.evaluate(() => {
        document.querySelectorAll("div").forEach((d) => (d.style.display = "none"));
        window.__treeCover = 1;
      });
      await page.waitForTimeout(3000);
      // The tree cover's id, from the materials.
      await page.evaluate(() => {
        const m = window.__engine.world.materials;
        for (let c = 0; c < 64; c++) {
          if (m.get("cover", c)?.name === "tree") window.__treeCover = c;
          if (m.get("cover", c)?.name === "house") window.__houseCover = c;
        }
      });
      found ??= await page.evaluate(spots);
      const s = found;
      for (const [name, view] of Object.entries(VIEWS)) {
        if (ONLY && !ONLY.has(name)) continue;
        const v = view(s);
        await page.evaluate((v) => {
          const o = window.__engine.view.orbit;
          o.tx = v.tx;
          o.ty = v.ty;
          o.dist = v.dist;
          o.phi = v.phi;
          o.theta = Math.PI * 0.25;
        }, v);
        await page.waitForTimeout(4000);
        const file = join(OUT, `${name}-${W}x${H}-${look}.jpg`);
        await page.screenshot({ path: file, type: "jpeg", quality: 60 });
        let m = "";
        if (MEASURE) {
          const b = await page.evaluate(() => window.perfBench(40));
          // perfBench turns the camera: put it back for the next view.
          m = ` triangles ${b.triangles} calls ${b.calls} draw p50 ${b.draw[0]} p95 ${b.draw[1]} ms raster p50 ${b.raster[0]} ms`;
        }
        console.log(`${name} ${W}x${H} ${look}${m}`);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
