// Triangles and draw time at four zooms (the looks audit of 15 November): the Perf Lab on the
// high preset at the owner's folded Fold size, the land finished building first, then a fixed
// bench (perfBench: one tick, a small turn, one draw, wait for the raster). Software WebGL, so
// "raster" is the CPU drawing the pixels; "draw" is the JavaScript side.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/looks-zoom-bench.mjs [frames] [query]
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const FRAMES = Number(process.argv[2] ?? 30);
const QUERY = process.argv[3] ?? "biome=temperate&shape=coast&seed=7";
const [W, H] = (process.env.SIZE ?? "344x882").split("x").map(Number);
const ZOOMS = { eye: { dist: 8, phi: 1.36 }, close: { dist: 12, phi: 1.0 }, mid: { dist: 28, phi: 0.95 }, whole: { dist: 0, phi: 0.95 } };

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const [zoom, z] of Object.entries(ZOOMS)) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("page error:", err.message));
    await page.goto(`${BASE}?size=medium&${QUERY}&dpr=1&quality=high&time=60`);
    await page.waitForFunction(() => window.perfReady === true, null, { timeout: 180_000 });
    const r = await page.evaluate(
      async ({ z, frames }) => {
        const e = window.__engine;
        const w = e.world;
        const v = [...w.villages][0] ?? { x: w.w / 2, y: w.h / 2 };
        const o = e.view.orbit;
        const side = Math.max(w.w, w.h);
        o.tx = z.dist ? v.x : side / 2;
        o.ty = z.dist ? v.y : side / 2;
        o.dist = z.dist || side * 0.55;
        o.phi = z.phi;
        o.theta = Math.PI * 0.25;
        // A few frames so the camera is read, then the land finished.
        await new Promise((res) => setTimeout(res, 1500));
        const t0 = performance.now();
        e.view.terrain.updateFine?.(0, true);
        const built = performance.now() - t0;
        await new Promise((res) => setTimeout(res, 1500));
        const b = window.perfBench(frames);
        return { built, ...b, land: e.view.terrain.shownTriangles?.() };
      },
      { z, frames: FRAMES },
    );
    console.log(JSON.stringify({ zoom, W, H, ...r }));
    await ctx.close();
  }
} finally {
  await browser.close();
}
