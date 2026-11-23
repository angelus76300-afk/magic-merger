// Shores without a rim (23 November, the owner: "Boarder with water seem to often create a little
// wall to contain the water that looks weird ... the water should be the one slightly under"). Close
// frames of where land meets water, on high in the Perf Lab, the same cameras before and after:
//   coast-close, coast-low   the medium island of seed 7 (the medium coast of the land's checks), at
//                            its longest straight sea shore, from above and from low over the water
//   river-close              the same island's river (river-frames.mjs's RIVER)
//   desert-close, desert-low the small desert plateau of seed 3, at its longest sea shore
// The numbers of the rim itself are the sim tests' (scripts/shore-rim-test.ts).
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/shore-frames.mjs <out dir> [tag]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "shore-frames";
const TAG = process.argv[3] ?? "frame";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const SIZE = { width: 390, height: 844 };
mkdirSync(OUT, { recursive: true });
const RIVER = { x: 121, y: 47 };

// In the page: the dry cell with the longest straight run of shore (dry cells each with sea on the
// same side) by wide water, away from the island's edge.
function shore() {
  const e = window.__engine;
  const w = e.world;
  const t = e.view.terrain;
  const water = (x, y) => x >= 0 && y >= 0 && x < w.w && y < w.h && t.wet[y * w.w + x] === 1 && w.fluid[y * w.w + x] === 1;
  const dry = (x, y) => x >= 0 && y >= 0 && x < w.w && y < w.h && t.wet[y * w.w + x] === 0;
  let best = null;
  for (let y = 10; y < w.h - 10; y++)
    for (let x = 10; x < w.w - 10; x++)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (!dry(x, y) || !water(x + dx, y + dy) || !water(x + 4 * dx, y + 4 * dy)) continue;
        let n = 0;
        for (let k = -6; k <= 6; k++) {
          const ax = x + k * dy;
          const ay = y + k * dx;
          if (dry(ax, ay) && water(ax + dx, ay + dy) && dry(ax - dx, ay - dy)) n++;
        }
        if (!best || n > best.n) best = { n, x, y, dx, dy };
      }
  return best;
}

async function shoot(browser, query, views) {
  const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(`${BASE}?${query}&dpr=1&quality=high`);
  await page.waitForFunction(() => window.perfReady === true, null, { timeout: 300_000 });
  await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
  const s = await page.evaluate(shore);
  console.error(`${query}: shore at ${s.x},${s.y} water toward ${s.dx},${s.dy} (${s.n} cells straight)`);
  for (const [name, at, dist, phi] of views(s)) {
    // Looking along the shore's normal from the land's side, a little turned.
    const theta = at.dx !== undefined ? Math.atan2(-at.dx, -at.dy) + 0.5 : 0.6;
    const aim = (a) => {
      const e = window.__engine;
      e.world.time = 100;
      const o = e.view.orbit;
      o.tx = a.x + 0.5;
      o.ty = a.y + 0.5;
      o.dist = a.dist;
      o.phi = a.phi;
      o.theta = a.theta;
    };
    const a = { x: at.x, y: at.y, dist, phi, theta };
    await page.evaluate(aim, a);
    await page.waitForTimeout(2500);
    await page.evaluate(aim, a);
    await page.evaluate(() => window.__engine.view.terrain.updateFine(0, true));
    await page.waitForTimeout(2500);
    writeFileSync(join(OUT, `${name}-${TAG}.png`), await page.screenshot({ type: "png", timeout: 240_000 }));
  }
  await ctx.close();
}

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  await shoot(browser, "size=medium&seed=7", (s) => [
    ["coast-close", s, 9, 0.75],
    ["coast-low", s, 8, 1.2],
    ["river-close", RIVER, 9, 0.85],
  ]);
  await shoot(browser, "size=small&seed=3&biome=desert&shape=plateau", (s) => [
    ["desert-close", s, 9, 0.75],
    ["desert-low", s, 8, 1.2],
  ]);
} finally {
  await browser.close();
}
