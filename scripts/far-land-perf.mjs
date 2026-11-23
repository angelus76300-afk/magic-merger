// The frame's numbers at the sky view (the whole island in frame, as the owner plays), for the far
// land's before and after (terrain.ts Terrain.wantFar): the Perf Lab on a touch screen (drawing
// capped at 30 a second, as on a phone), quality high, the land built first, then the CPU slowed
// FOUR times (the phone's speed against this machine's) while the camera turns slowly. Prints one
// JSON line a run: triangles and draw calls of a frame, the HUD's draw time p50 and p95 (the
// JavaScript of a frame's drawing) and frames a second, and the bench's raster time (software
// WebGL: the GPU's work, done by the CPU, so triangles count).
//
//   npx vite --port 5174 &
//   node scripts/far-land-perf.mjs [islands, e.g. "medium,large"] [screens, e.g. "390x844,832x1000"]
// LAB_URL picks the checkout; DPR=1.5 the pixel density (the owner's Fold draws at 1.5).
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const ISLANDS = (process.argv[2] ?? "medium,large").split(",");
const SCREENS = (process.argv[3] ?? "390x844,832x1000").split(",");
const DPR = Number(process.env.DPR ?? 1.5);
const SECONDS = Number(process.env.SECONDS ?? 20);
const SLOW = Number(process.env.SLOW ?? 4);
const QUERY = process.env.QUERY ?? "mixed=1&seed=7";

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const island of ISLANDS)
    for (const screen of SCREENS) {
      const [w, h] = screen.split("x").map(Number);
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: DPR, hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      page.on("pageerror", (err) => console.error("page error:", err.message));
      await page.goto(`${BASE}?size=${island}&${QUERY}&dpr=${DPR}&quality=high&time=60`);
      await page.waitForFunction(() => window.perfReady === true, null, { timeout: 300_000 });
      await page.evaluate(async () => {
        const e = window.__engine;
        const o = e.view.orbit;
        const side = Math.max(e.world.w, e.world.h);
        o.tx = e.world.w / 2;
        o.ty = e.world.h / 2;
        o.dist = o.distanceFor(side * 0.55);
        await new Promise((res) => setTimeout(res, 1500));
        // Built whole, at the level each chunk takes from here (and its other mesh), before the clock.
        e.view.terrain.updateFine(0, true);
        await new Promise((res) => setTimeout(res, 1500));
        e.view.terrain.updateFine(0, true);
      });
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: SLOW });
      // A few seconds for the frame loop to settle, then the measure.
      await page.evaluate(() => window.perfRun(3));
      const hud = await page.evaluate((s) => window.perfRun(s), SECONDS);
      const bench = await page.evaluate((n) => window.perfBench(n), Number(process.env.BENCH ?? 60));
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      const far = await page.evaluate(() => {
        const t = window.__engine.view.terrain;
        return t.fineFar ? [...t.fineFar].filter(Boolean).length : 0;
      });
      console.log(
        JSON.stringify({
          island,
          screen,
          dpr: DPR,
          slow: SLOW,
          farChunks: far,
          chunks: hud.chunks,
          triangles: hud.triangles,
          calls: hud.calls,
          drawP50: hud.renderP50,
          drawP95: hud.renderP95,
          frameP50: hud.frameP50,
          frameP95: hud.frameP95,
          fps: hud.fps,
          bench: { triangles: bench.triangles, calls: bench.calls, draw: bench.draw, raster: bench.raster },
        }),
      );
      await ctx.close();
    }
} finally {
  await browser.close();
}
