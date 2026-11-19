// River shapes (19 November, the owner: "Why are rivers so angular compared to sea shores?"). The
// Perf Lab on a few seeds at 832 by 1000 (a foldable open), on high and on medium: the whole island
// from above, and one river close, the camera at the same place before and after. The close spot
// is the 14 by 14 window with the most river water (found on the first run and handed to the next
// with SPOTS, so before and after look at the same ground), and the frame time of a slow turn.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/river-curve-frames.mjs <out dir> <tag> [spots.json]
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "river-curve-frames";
const TAG = process.argv[3] ?? "frame";
const SPOTS = process.argv[4];
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const QUALITIES = (process.env.QUALITIES ?? "high,medium").split(",");
const SEEDS = (process.env.SEEDS ?? "7,12,23").split(",").map(Number);
mkdirSync(OUT, { recursive: true });
const known = SPOTS && existsSync(SPOTS) ? JSON.parse(readFileSync(SPOTS, "utf8")) : {};

// In the page: the 14 by 14 window with the most water above the sea that is not a lake's.
function spot() {
  const w = window.__engine.world;
  const river = new Uint8Array(w.w * w.h);
  for (const s of w.springs) if (!s.lava && (s.rate === undefined || s.rate < 0.5)) river[s.i] = 1;
  let best = null;
  for (let y = 10; y < w.h - 24; y += 2)
    for (let x = 10; x < w.w - 24; x += 2) {
      let n = 0;
      for (let j = 0; j < 14; j++) for (let i = 0; i < 14; i++) n += river[(y + j) * w.w + x + i];
      if (!best || n > best.n) best = { n, x: x + 7, y: y + 7 };
    }
  return best;
}

async function shoot(browser, seed, quality) {
  const ctx = await browser.newContext({ viewport: { width: 832, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(`${BASE}?size=medium&biome=temperate&seed=${seed}&dpr=1&quality=${quality}`);
  await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
  await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
  const at = known[seed] ?? (known[seed] = await page.evaluate(spot));
  const result = { at };
  for (const [name, view] of [
    ["wide", { dist: 150, phi: 0.35, theta: 0.6, center: true }],
    ["close", { dist: 18, phi: 0.95, theta: 0.6, center: false }],
  ]) {
    const aim = ([a, v]) => {
      const e = window.__engine;
      e.world.time = 100;
      const o = e.view.orbit;
      o.tx = v.center ? e.world.w / 2 : a.x + 0.5;
      o.ty = v.center ? e.world.h / 2 : a.y + 0.5;
      o.dist = v.dist;
      o.phi = v.phi;
      o.theta = v.theta;
    };
    await page.evaluate(aim, [at, view]);
    await page.waitForTimeout(2500);
    await page.evaluate(aim, [at, view]);
    await page.evaluate(() => window.__engine.view.terrain.updateFine(0, true));
    await page.waitForTimeout(2500);
    writeFileSync(join(OUT, `s${seed}-${name}-${quality}-${TAG}.png`), await page.screenshot({ type: "png", timeout: 240_000 }));
    if (name === "close") {
      // Frame time while the camera turns slowly round the river (rAF to rAF, ms).
      result.frame = await page.evaluate(
        () =>
          new Promise((done) => {
            const o = window.__engine.view.orbit;
            const times = [];
            let last = performance.now();
            const tick = (now) => {
              times.push(now - last);
              last = now;
              o.theta += 0.01;
              if (times.length < 90) requestAnimationFrame(tick);
              else {
                times.sort((a, b) => a - b);
                done({ median: Number(times[45].toFixed(1)), p90: Number(times[81].toFixed(1)) });
              }
            };
            requestAnimationFrame(tick);
          }),
      );
    }
  }
  await ctx.close();
  return result;
}

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const all = {};
try {
  for (const seed of SEEDS) for (const q of QUALITIES) all[`${seed}-${q}`] = await shoot(browser, seed, q);
} finally {
  await browser.close();
}
if (SPOTS) writeFileSync(SPOTS, JSON.stringify(known, null, 2) + "\n");
writeFileSync(join(OUT, `frames-${TAG}.json`), JSON.stringify(all, null, 2) + "\n");
console.log(JSON.stringify(all));
