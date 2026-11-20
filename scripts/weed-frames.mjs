// Weed and stones on lake beds (20 November): the Perf Lab at 832 by 1000 (a foldable open), close
// over a lake's shelf where weed grows, on a temperate, a swamp and a tundra island of lakes, the
// tundra lake also frozen. "before" is the land with the weed's switch off (off=weed), drawn byte
// for byte as main (scripts/lake-weed-test.ts); "after" with it on. With BENCH=1, the frame's cost
// on medium over the temperate lake, weed on and off (perfBench, 60 frames).
//   npx vite --port 5174 &
//   node scripts/weed-frames.mjs <out dir>
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "weed-frames";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const QUALITIES = (process.env.QUALITIES ?? "high").split(",");
// [name, the lab's island, the cell looked at (found by weedClumps: the most clumps round it)].
const ISLANDS = [
  ["temperate-lakes-7", "biome=temperate&shape=lakes&seed=7", 75.5, 93.5],
  ["swamp-lakes-9", "biome=swamp&shape=lakes&seed=9", 41.5, 73.5],
  ["tundra-lakes-5", "biome=tundra&shape=lakes&seed=5", 118.5, 37.5],
];
const SIZE = { width: 832, height: 1000 };
mkdirSync(OUT, { recursive: true });

async function frame(page, at, dist, phi, freeze) {
  return page.evaluate(
    async ({ at, dist, phi, freeze }) => {
      const e = window.__engine;
      const w = e.world;
      if (freeze) {
        // Every lake's water (above the sea) frozen, as a cold night does.
        for (let i = 0; i < w.w * w.h; i++) if (w.fluid[i] === 1 && w.height[i] + w.depth[i] > w.seaLevel + 0.5) w.fluid[i] = 2;
      }
      const o = e.view.orbit;
      o.tx = at.x;
      o.ty = at.y;
      o.dist = dist;
      o.phi = phi;
      o.theta = 0.6;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let k = 0; k < 3; k++) {
        await wait(1200);
        e.view.terrain.updateFine(0, true);
      }
      e.stop();
      e.render(0);
      e.render(0);
      e.render(0);
      const png = document.getElementById("world").toDataURL("image/png");
      e.start?.();
      return png;
    },
    { at, dist, phi, freeze },
  );
}

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const rows = [];
try {
  for (const quality of QUALITIES)
    for (const [name, q, x, y] of ISLANDS)
      for (const tag of ["before", "after"])
        for (const freeze of name.startsWith("tundra") ? [false, true] : [false]) {
          const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 });
          const page = await ctx.newPage();
          page.on("pageerror", (err) => console.error("page error:", err.message));
          await page.goto(`${BASE}?size=medium&${q}&dpr=1&quality=${quality}&time=60${tag === "before" ? "&off=weed" : ""}`);
          await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
          await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
          const png = await frame(page, { x, y }, 12, 0.85, freeze);
          const file = join(OUT, `${name}${freeze ? "-frozen" : ""}-${quality}-${tag}.png`);
          writeFileSync(file, Buffer.from(png.split(",")[1], "base64"));
          rows.push({ quality, name, tag, freeze, file });
          console.log(JSON.stringify(rows.at(-1)));
          await ctx.close();
        }
  if (process.env.BENCH) {
    const [name, q, x, y] = ISLANDS[0];
    for (const tag of ["off", "on", "off", "on"]) {
      const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(`${BASE}?size=medium&${q}&dpr=1&quality=medium&time=60${tag === "off" ? "&off=weed" : ""}`);
      await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
      await page.evaluate(
        ([x, y]) => {
          const o = window.__engine.view.orbit;
          o.tx = x;
          o.ty = y;
          o.dist = 16;
          o.phi = 0.9;
          o.theta = 0.6;
          window.__engine.view.terrain.updateFine(0, true);
        },
        [x, y],
      );
      await page.waitForTimeout(3000);
      await page.evaluate(() => window.__engine.view.terrain.updateFine(0, true));
      const bench = await page.evaluate(() => window.perfBench(60));
      rows.push({ name, weed: tag, bench });
      console.log("bench", tag, JSON.stringify(bench));
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, "weed-frames.json"), JSON.stringify(rows, null, 1));
