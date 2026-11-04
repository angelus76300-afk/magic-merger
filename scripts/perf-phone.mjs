// Dev only (4.4): the frame HUD's numbers for one island in a phone sized
// browser (Pixel 7: 412 by 915, touch, so drawing is capped at 30 a second
// as on a real phone). Software WebGL: the GPU is not measured, the
// JavaScript side (simulation, building and drawing calls) is.
//
//   npx vite --port 5174 &
//   node scripts/perf-phone.mjs [size] [seconds] [extra query, e.g. "time=200&biome=desert"]
//
// Prints one JSON line per run: the HUD summary (the real frame loop), and a
// bench of fixed work per frame (one tick, one draw, wait for the raster),
// which does not depend on how many ticks fit in a frame. Pin the pixel
// density with "dpr=1" so two runs draw the same pixels.
import { createRequire } from "node:module";

const { chromium, devices } = createRequire(import.meta.url)("playwright");
const base = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const size = process.argv[2] ?? "medium";
const seconds = Number(process.argv[3] ?? 20);
const extra = process.argv[4] ?? "";
const runs = Number(process.env.RUNS ?? 1);

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ ...devices["Pixel 7"] });
const page = await context.newPage();
page.on("pageerror", (err) => console.error("page error:", err.message));
await page.goto(`${base}?size=${size}&${extra}`);
await page.waitForFunction(() => window.perfReady === true, null, { timeout: 120_000 });
// Let the first chunks build and the pixel density settle.
await page.evaluate(() => window.perfRun(4));
for (let r = 0; r < runs; r++) {
  const hud = await page.evaluate((sec) => window.perfRun(sec), seconds);
  const bench = await page.evaluate((n) => window.perfBench(n), Number(process.env.BENCH ?? 150));
  console.log(JSON.stringify({ size, extra, hud, bench }));
}
await browser.close();
