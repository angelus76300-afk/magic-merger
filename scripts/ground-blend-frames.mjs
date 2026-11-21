// Ground tones that blend (21 November): a desert and mesa border (the large mixed island of seed
// 3, warm and dry) and a meadow and swamp border (seed 2, cool and wet), in the Perf Lab at 832 by
// 1000 on high, close (the fine land in eighths) and zoomed out (the land in whole cells and
// quarters), at noon. With BENCH=1, the frame's cost close over each border (perfBench, 40 frames)
// and the median time of a fine tile.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/ground-blend-frames.mjs <out dir> [before|after]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "ground-blend-frames";
const TAG = process.argv[3] ?? "after";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const SIZE = { width: 832, height: 1000 };
// [name, lab query, the point looked at (cells)]
const SPOTS = [
  ["desert-mesa", "warmth=0.9&water=0.2&seed=3", 174, 102],
  ["meadow-swamp", "warmth=0.4&water=0.6&seed=2", 114, 114],
];
const ZOOMS = [
  ["close", 30, 0.95],
  ["out", 110, 0.95],
];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const rows = [];
try {
  for (const [name, query, x, y] of SPOTS) {
    const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("page error:", err.message));
    await page.goto(`${BASE}?size=large&mixed=1&${query}&dpr=1&quality=high&time=720`);
    await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
    await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
    for (const [zoom, dist, phi] of ZOOMS) {
      const png = await page.evaluate(
        async ({ x, y, dist, phi }) => {
          const e = window.__engine;
          e.stop();
          const o = e.view.orbit;
          o.tx = x;
          o.ty = y;
          o.dist = dist;
          o.phi = phi;
          o.theta = 0.6;
          for (let k = 0; k < 3; k++) {
            e.render(0);
            e.view.terrain.updateFine(0, true);
          }
          e.render(0);
          return document.getElementById("world").toDataURL("image/png");
        },
        { x, y, dist, phi },
      );
      const file = join(OUT, `${name}-${zoom}-${TAG}.png`);
      writeFileSync(file, Buffer.from(png.split(",")[1], "base64"));
      rows.push({ name, zoom, file });
      console.log(JSON.stringify(rows.at(-1)));
    }
    if (process.env.BENCH) {
      const cost = await page.evaluate(
        async ({ x, y }) => {
          const e = window.__engine;
          const t = e.view.terrain;
          const o = e.view.orbit;
          o.tx = x;
          o.ty = y;
          o.dist = 18;
          e.start?.();
          await new Promise((r) => setTimeout(r, 1500));
          const bench = await window.perfBench(40);
          return { bench, fine: t.fineStats.tileMs.length ? [...t.fineStats.tileMs].sort((a, b) => a - b)[t.fineStats.tileMs.length >> 1] : null };
        },
        { x, y },
      );
      rows.push({ name, cost });
      console.log("bench", JSON.stringify(rows.at(-1)));
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `ground-blend-${TAG}.json`), JSON.stringify(rows, null, 1));
