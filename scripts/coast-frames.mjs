// Coasts and sand (18 November, the owner on the Fold: "Actually coasts are bad too, for some of the
// pictures with rain, the land was also a problem"): the shore stepped in whole-cell teeth on a
// diagonal coast, and flat sand had dark wavy contour lines. The Perf Lab at 832 by 1000 (a
// foldable open), on high and on medium, the same cameras before and after:
//   beach-close, beach-wide  the desert island of seed 7, at its longest diagonal sandy coast
//   coast-close, coast-wide  the temperate island of seed 7, at its longest diagonal sea coast
//   sand-slope               the desert island, where sand rises a voxel a cell the most
//   sand-flat                the desert island, flat sand with a few lone steps of a voxel
//   grass-slope              the temperate island, where grass rises a voxel a cell the most
//   river-bank               the temperate island's narrow river (river-frames.mjs's RIVER)
// With OFF=shadows the sun's shadow is left out, to measure the lines the land itself draws.
// Each frame's numbers: on the sand of the frame (sandy pixels, by hue), the share darker than 85%
// of the sand's median light (the contour lines) and the 5th percentile's light against the median.
// With BENCH=1, the frame's cost over each island's diagonal coast.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/coast-frames.mjs <out dir> [tag]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "coast-frames";
const TAG = process.argv[3] ?? "frame";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const QUALITIES = (process.env.QUALITIES ?? "high,medium").split(",");
const OFF = process.env.OFF ?? "";
const VIEWS = process.env.VIEWS ? process.env.VIEWS.split(",") : null;
const SIZE = { width: 832, height: 1000 };
mkdirSync(OUT, { recursive: true });
const RIVER = { x: 121, y: 47 };

// In the page: the window of 12 by 12 cells with the most diagonal coast (dry cells with water on
// both an x side and a y side: the corners of a staircase) by wide water, of sand when `sand`; and the one with
// the most grass (sand when `sand`) rising one voxel to a neighbour, away from water.
function spots(sand) {
  const e = window.__engine;
  const w = e.world;
  const t = e.view.terrain;
  const water = (x, y) => x >= 0 && y >= 0 && x < w.w && y < w.h && t.wet[y * w.w + x] === 1 && w.fluid[y * w.w + x] === 1;
  const dry = (x, y) => x >= 0 && y >= 0 && x < w.w && y < w.h && t.wet[y * w.w + x] === 0;
  const top = (x, y) => Math.round(w.height[y * w.w + x] * 0.5);
  const run = (x, y, dx, dy) => {
    let n = 1;
    for (const s of [-1, 1]) for (let k = 1; k <= 8 && water(x + s * k * dx, y + s * k * dy); k++) n++;
    return n;
  };
  const corner = new Uint8Array(w.w * w.h);
  const slope = new Uint8Array(w.w * w.h);
  for (let y = 1; y < w.h - 1; y++)
    for (let x = 1; x < w.w - 1; x++) {
      const i = y * w.w + x;
      if (!dry(x, y)) continue;
      // By the sea or a lake (water eight cells across), not a river.
      const wide = (a, b) => water(a, b) && run(a, b, 1, 0) >= 8 && run(a, b, 0, 1) >= 8;
      if (!sand || w.ground[i] === 2) corner[i] = (wide(x - 1, y) || wide(x + 1, y)) && (wide(x, y - 1) || wide(x, y + 1)) ? 1 : 0;
      if (w.ground[i] === (sand ? 2 : 0) && w.cover[i] === 0) {
        let n = 0;
        let near = false;
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
          [-1, 0],
          [0, -1],
        ]) {
          if (!dry(x + dx, y + dy)) near = true;
          else if (Math.abs(top(x + dx, y + dy) - top(x, y)) === 1) n++;
        }
        slope[i] = near ? 0 : Math.min(n, 2);
      }
    }
  const best = (a) => {
    let b = null;
    for (let y = 8; y < w.h - 20; y++)
      for (let x = 8; x < w.w - 20; x++) {
        let n = 0;
        for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) n += a[(y + j) * w.w + x + i];
        if (!b || n > b.n) b = { n, x: x + 6, y: y + 6 };
      }
    return b;
  };
  // Flat ground with a few lone steps of a voxel (contour lines across a flat beach): the window of
  // 16 by 16 cells, nearly all (85%) dry open ground of that kind, with the most cells by a step but no more
  // than a fifth of them.
  let flat = null;
  for (let y = 8; y < w.h - 24; y++)
    for (let x = 8; x < w.w - 24; x++) {
      let n = 0;
      let other = 0;
      for (let j = 0; j < 16; j++)
        for (let i = 0; i < 16; i++) {
          const k = (y + j) * w.w + x + i;
          if (!dry(x + i, y + j) || w.ground[k] !== (sand ? 2 : 0) || w.cover[k] !== 0) other++;
          else if (slope[k]) n++;
        }
      if (other <= 38 && n <= 51 && (!flat || n > flat.n)) flat = { n, x: x + 8, y: y + 8 };
    }
  return { coast: best(corner), slope: best(slope), flat: flat ?? best(slope) };
}

// Sandy pixels (warm, by hue) and how dark the darkest are against their median.
async function sandLines(page, png) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const lum = [];
    for (let k = 0; k < d.length; k += 4) {
      const [r, gg, b] = [d[k], d[k + 1], d[k + 2]];
      // Sand: red over green over blue, warm and not grey (rock, shade) or green (grass).
      if (r > gg && gg > b && r - b > 45 && gg - b > 25 && r - gg < 70 && r > 90) lum.push(0.299 * r + 0.587 * gg + 0.114 * b);
    }
    lum.sort((a, b) => a - b);
    if (lum.length < 1000) return { sand: lum.length };
    const med = lum[Math.floor(lum.length / 2)];
    let dark = 0;
    for (const v of lum) if (v < med * 0.85) dark++;
    return {
      sand: lum.length,
      median: Math.round(med),
      p5: Number((lum[Math.floor(lum.length * 0.05)] / med).toFixed(3)),
      darkShare: Number((dark / lum.length).toFixed(4)),
    };
  }, png.toString("base64"));
}

async function shoot(browser, quality, biome, views) {
  const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(`${BASE}?size=medium&biome=${biome}&seed=7&dpr=1&quality=${quality}${OFF ? `&off=${OFF}` : ""}`);
  await page.waitForFunction(() => window.perfReady === true, null, { timeout: 300_000 });
  await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
  const found = await page.evaluate(spots, biome === "desert");
  console.error(
    `${biome} ${quality}: diagonal coast at ${found.coast.x},${found.coast.y} (${found.coast.n}), slope at ${found.slope.x},${found.slope.y} (${found.slope.n}), flat at ${found.flat.x},${found.flat.y} (${found.flat.n})`,
  );
  const out = {};
  for (const [name, at, dist, phi, theta] of views(found)) {
    if (VIEWS && !VIEWS.includes(name)) continue;
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
    const png = await page.screenshot({ type: "png", timeout: 240_000 });
    writeFileSync(join(OUT, `${name}-${quality}-${TAG}.png`), png);
    out[name] = { at: { x: at.x, y: at.y }, dist, ...(await sandLines(page, png)) };
  }
  // The frame's cost over the diagonal coast, close: 40 frames of the Perf Lab's bench (one tick,
  // a small turn, a draw, waiting for the frame), ms at the median and the 95th percentile.
  if (process.env.BENCH) {
    await page.evaluate((a) => {
      const o = window.__engine.view.orbit;
      o.tx = a.x + 0.5;
      o.ty = a.y + 0.5;
      o.dist = 14;
      o.phi = 0.8;
      o.theta = 0.6;
      window.__engine.view.terrain.updateFine(0, true);
    }, found.coast);
    await page.waitForTimeout(2000);
    out.bench = await page.evaluate(() => window.perfBench(40));
  }
  await ctx.close();
  return out;
}

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const all = {};
try {
  for (const q of QUALITIES) {
    all[q] = {
      desert: await shoot(browser, q, "desert", (s) => [
        ["beach-close", s.coast, 14, 0.8, 0.6],
        ["beach-wide", s.coast, 40, 0.9, 0.6],
        ["sand-slope", s.slope, 18, 0.85, 0.6],
        ["sand-flat", s.flat, 18, 0.85, 0.6],
      ]),
      temperate: await shoot(browser, q, "temperate", (s) => [
        ["coast-close", s.coast, 14, 0.8, 0.6],
        ["coast-wide", s.coast, 40, 0.9, 0.6],
        ["grass-slope", s.slope, 16, 0.85, 0.6],
        ["river-bank", RIVER, 14, 0.9, 0.6],
      ]),
    };
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `coasts-${TAG}${OFF ? `-off-${OFF}` : ""}.json`), JSON.stringify(all, null, 2) + "\n");
console.log(JSON.stringify(all));
