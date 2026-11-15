// Where a frame's triangles go, by kind of mesh (view.triangleBreakdown), at four zooms on the
// high preset, the land finished first (the looks of 15 November).
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/looks-breakdown.mjs [query]
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const QUERY = process.argv[2] ?? "biome=temperate&shape=coast&seed=7";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const [W, H] = (process.env.SIZE ?? "344x882").split("x").map(Number);
const ZOOMS = { eye: { dist: 8, phi: 1.36 }, close: { dist: 12, phi: 1.0 }, mid: { dist: 28, phi: 0.95 }, whole: { dist: 0, phi: 0.95 } };
const ONLY = process.env.ZOOMS ? new Set(process.env.ZOOMS.split(",")) : null;

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const [zoom, z] of Object.entries(ZOOMS)) {
    if (ONLY && !ONLY.has(zoom)) continue;
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("page error:", err.message));
    await page.goto(`${BASE}?size=medium&${QUERY}&dpr=1&quality=high&time=60`);
    await page.waitForFunction(() => window.perfReady === true, null, { timeout: 180_000 });
    const r = await page.evaluate(
      async ({ z }) => {
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
        await new Promise((res) => setTimeout(res, 1500));
        e.view.terrain.updateFine?.(0, true);
        await new Promise((res) => setTimeout(res, 1500));
        e.stop();
        e.render(0);
        const t0 = performance.now();
        e.render(0);
        const ms = performance.now() - t0;
        const parts = e.view.triangleBreakdown();
        const big = {};
        let trees = 0;
        for (const [k, n] of Object.entries(parts)) {
          if (k.startsWith("cover:cube:") || k.startsWith("cover:tree:")) trees += n;
          else if (n > 5000) big[k] = n;
        }
        return { drawn: e.view.counts().triangles, trees, ms, ...big };
      },
      { z },
    );
    console.log(JSON.stringify({ zoom, ...r }));
    await ctx.close();
  }
} finally {
  await browser.close();
}
