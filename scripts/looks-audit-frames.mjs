// The looks audit (15 November): the same views on three islands, four zooms, day and low sun, at
// the owner's two Fold sizes, on the high preset. Frames are small JPEGs; triangles of each frame
// go to frames.jsonl next to them.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/looks-audit-frames.mjs <out dir> [344x882,700x830] [islands] [zooms] [times]
import { createRequire } from "node:module";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "frames";
const SIZES = (process.argv[3] ?? "344x882,700x830").split(",").map((s) => s.split("x").map(Number));
const pick = (i) => (process.argv[i] ? new Set(process.argv[i].split(",")) : null);
const ONLY_ISLANDS = pick(4);
const ONLY_ZOOMS = pick(5);
const ONLY_TIMES = pick(6);
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const QUALITY = process.env.QUALITY ?? "high";
const TAG = process.env.TAG ? `-${process.env.TAG}` : "";
mkdirSync(OUT, { recursive: true });

const ISLANDS = {
  village: { query: "biome=temperate&shape=coast&seed=7", spot: "village" },
  sand: { query: "biome=desert&shape=coast&seed=7", spot: "beach" },
  peaks: { query: "biome=volcanic&shape=ridges&seed=11&peaks=1", spot: "mountain" },
};
const ZOOMS = {
  eye: { dist: 8, phi: 1.36 },
  close: { dist: 12, phi: 1.0 },
  mid: { dist: 28, phi: 0.95 },
  whole: { dist: 0, phi: 0.95 },
};
const TIMES = { day: 60, low: 194 };

function spots() {
  const w = window.__engine.world;
  const at = (x, y) => y * w.w + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w.w && y < w.h;
  const v = [...w.villages][0];
  // A sand cell by deep water with the most rise behind it.
  let beach = null;
  let best = -1;
  for (let y = 6; y < w.h - 6; y++)
    for (let x = 6; x < w.w - 6; x++) {
      const i = at(x, y);
      if (w.ground[i] !== 2 || w.fluid[i] !== 0) continue;
      let water = false;
      let rise = 0;
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          if (!inside(x + dx, y + dy)) continue;
          const j = at(x + dx, y + dy);
          if (w.fluid[j] === 1 && w.depth[j] > 0.3) water = true;
          rise = Math.max(rise, w.height[j] - w.height[i]);
        }
      if (water && rise > best && rise < 6) {
        best = rise;
        beach = { x, y };
      }
    }
  let mountain = { x: w.w / 2, y: w.h / 2 };
  for (let i = 0, top = -1e9; i < w.n; i++) {
    const x = i % w.w;
    const y = Math.floor(i / w.w);
    if (w.fluid[i] === 0 && w.height[i] > top && x > 8 && x < w.w - 8 && y > 8 && y < w.h - 8) {
      top = w.height[i];
      mountain = { x, y };
    }
  }
  return { village: v ? { x: v.x, y: v.y } : { x: w.w / 2, y: w.h / 2 }, beach: beach ?? { x: w.w / 2, y: w.h / 2 }, mountain, side: Math.max(w.w, w.h) };
}

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const [name, island] of Object.entries(ISLANDS)) {
    if (ONLY_ISLANDS && !ONLY_ISLANDS.has(name)) continue;
    let found = null;
    for (const [W, H] of SIZES) {
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true });
      const page = await ctx.newPage();
      page.on("pageerror", (err) => console.error("page error:", err.message));
      await page.goto(`${BASE}?size=medium&${island.query}&dpr=1&quality=${QUALITY}${process.env.EXTRA ?? ""}`);
      await page.waitForFunction(() => window.perfReady === true, null, { timeout: 180_000 });
      await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
      await page.waitForTimeout(2000);
      found ??= await page.evaluate(spots);
      const s = found;
      for (const [zoom, z] of Object.entries(ZOOMS)) {
        if (ONLY_ZOOMS && !ONLY_ZOOMS.has(zoom)) continue;
        for (const [when, time] of Object.entries(TIMES)) {
          if (ONLY_TIMES && !ONLY_TIMES.has(when)) continue;
          const spot = zoom === "whole" ? { x: s.side / 2, y: s.side / 2 } : s[island.spot];
          await page.evaluate(
            ({ spot, z, time, side }) => {
              const e = window.__engine;
              e.world.time = time;
              const o = e.view.orbit;
              o.tx = spot.x;
              o.ty = spot.y;
              o.dist = z.dist || side * 0.55;
              o.phi = z.phi;
              o.theta = Math.PI * 0.25;
            },
            { spot, z, time, side: s.side },
          );
          // Fine chunks are built a few milliseconds a frame: let them come.
          await page.waitForTimeout(zoom === "whole" ? 9000 : 5000);
          // The fine land finished at once (in the game it is built a few milliseconds a frame,
          // and this browser draws a frame in a tenth of a second).
          const builtMs = await page.evaluate((time) => {
            const e = window.__engine;
            e.world.time = time;
            const t0 = performance.now();
            e.view.terrain.updateFine(0, true);
            return performance.now() - t0;
          }, time);
          await page.waitForTimeout(1500);
          const file = join(OUT, `${name}-${zoom}-${when}-${W}x${H}${TAG}.jpg`);
          await page.screenshot({ path: file, type: "jpeg", quality: 62, timeout: 240_000 });
          const counts = await page.evaluate(() => {
            const v = window.__engine.view;
            return { ...v.counts(), land: v.terrain?.shownTriangles?.() };
          });
          appendFileSync(join(OUT, `frames${TAG}.jsonl`), JSON.stringify({ file, island: name, zoom, when, W, H, spot, builtMs, ...counts }) + "\n");
          console.log(file, counts.triangles);
        }
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
