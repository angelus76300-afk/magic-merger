// Dev only (2026-11-07): the World's frame loop on its own, in a phone sized
// browser (Pixel 7, touch). The view's drawing and the simulation's tick are
// replaced by busy waits of known length, so the frame rate measured is the
// loop's pacing, not SwiftShader's (which takes 130 ms or more for a large
// island at any pixel density). The default costs are the owner's phone at
// p50 (docs/measurements/pacing-2026-11-07.md).
//
//   npx vite --port 5174 &
//   node scripts/perf-pacing.mjs [lab url]
//
// Prints one JSON line: fps and frame p50 / p95 for each case, and the
// pacer's target (missing on code before the pacer).
import { createRequire } from "node:module";

const { chromium, devices } = createRequire(import.meta.url)("playwright");
const url = process.argv[2] ?? process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ ...devices["Pixel 7"] });
const page = await context.newPage();
await page.goto(`${url}?size=small&seed=7&dpr=1`);
await page.waitForFunction(() => window.perfReady === true, null, { timeout: 120_000 });
// [name, draw ms, tick ms, draw ms of a frame without a tick (0: the same)]
const cases = [
  ["no work", 0, 0, 0],
  ["draw 7.5, tick 8.7 (the owner's p50)", 7.5, 8.7, 0],
  ["draw 4.5 between ticks, 7.5 + 8.7 with one", 7.5, 8.7, 4.5],
  ["draw 20", 20, 0, 0],
];
const out = { url };
for (const [name, draw, tick, between] of cases) {
  out[name] = await page.evaluate(
    async ([draw, tick, between]) => {
      const e = window.__engine;
      const busy = (ms) => {
        const t = performance.now();
        while (performance.now() - t < ms);
      };
      let ticked = false;
      e.step = () => {
        busy(tick);
        e.world.time += 1 / 30;
        ticked = true;
      };
      e.view.render = () => {
        busy(between && !ticked ? between : draw);
        ticked = false;
      };
      await new Promise((r) => setTimeout(r, 3000));
      e.stats.reset();
      await new Promise((r) => setTimeout(r, 8000));
      const s = e.stats.summary();
      return { fps: s.fps, frameP50: s.frameP50, frameP95: s.frameP95, target: e.pacer?.target };
    },
    [draw, tick, between],
  );
}
console.log(JSON.stringify(out));
await browser.close();
