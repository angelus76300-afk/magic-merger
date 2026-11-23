// Shores without a rim (23 November, the owner: "Boarder with water seem to often create a little
// wall to contain the water that looks weird ... the water should be the one slightly under"). Close
// frames of where land meets water, on high in the Perf Lab, the same cameras before and after:
//   coast-close, coast-low   the medium island of seed 7 (the medium coast of the land's checks), at
//                            its longest straight sea shore, from the land and from low over the water
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

// The shores looked at: a dry cell at a long straight shore, the water toward (dx, dy). Found once by
// the longest straight run of shore by wide water (the cells the page counts as wet change while it
// loads, so the search is not repeated).
const COAST = { x: 20, y: 27, dx: 1, dy: 0 };
const DESERT = { x: 82, y: 26, dx: 0, dy: -1 };

async function shoot(browser, query, views, s) {
  const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(`${BASE}?${query}&dpr=1&quality=high`);
  await page.waitForFunction(() => window.perfReady === true, null, { timeout: 300_000 });
  await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
  for (const [name, at, dist, phi, sea] of views(s)) {
    // Looking along the shore's normal from the land's side (from the water's with `sea`), a little turned.
    const side = sea ? 1 : -1;
    const theta = at.dx !== undefined ? Math.atan2(side * at.dx, side * at.dy) + 0.5 : 0.6;
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
  await shoot(
    browser,
    "size=medium&seed=7",
    (s) => [
      ["coast-close", s, 9, 0.75],
      ["coast-low", s, 12, 1.1, true],
      ["river-close", RIVER, 9, 0.85],
    ],
    COAST,
  );
  await shoot(
    browser,
    "size=small&seed=3&biome=desert&shape=plateau",
    (s) => [
      ["desert-close", s, 9, 0.75],
      ["desert-low", s, 12, 1.1, true],
    ],
    DESERT,
  );
} finally {
  await browser.close();
}
