// Narrow rivers (18 November, the owner on the Fold: rivers one or two cells wide read as "pale
// translucent blocky bands with hard light borders", not as water). The Perf Lab on the island of
// seed 7, at 700 by 830 (the Fold open), on high and on medium: one frame over a stretch of narrow
// river and one over a lake's shore, the same camera before and after (RIVER and SHORE, where
// spots() found them). The check samples the frame at the middle of every narrow river cell in
// view (3 by 3 pixels each) and counts the clearly blue ones (blue over green by 10 and over red
// by 40, not the pale turquoise or grey of the shallows). It fails under 40%.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/river-frames.mjs <out dir> [tag]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "river-frames";
const TAG = process.argv[3] ?? "frame";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const LIMIT = 0.4;
const QUALITIES = (process.env.QUALITIES ?? "high,medium").split(",");
mkdirSync(OUT, { recursive: true });
const RIVER = { x: 121, y: 47 };
const SHORE = { x: 33, y: 21 };

// In the page: the water cells by how far across they are (1 narrow, 2 wide), and the two spots.
function spots() {
  const e = window.__engine;
  const w = e.world;
  // Water as the terrain draws it: wet, and water (F.WATER); past the island counts as water.
  const t = e.view.terrain;
  const wet = (x, y) => x < 0 || y < 0 || x >= w.w || y >= w.h || (t.wet[y * w.w + x] === 1 && w.fluid[y * w.w + x] === 1);
  const run = (x, y, dx, dy) => {
    let n = 1;
    for (const s of [-1, 1]) for (let k = 1; k <= 8 && wet(x + s * k * dx, y + s * k * dy); k++) n++;
    return n;
  };
  const kind = new Int8Array(w.w * w.h);
  for (let y = 0; y < w.h; y++)
    for (let x = 0; x < w.w; x++) {
      if (!wet(x, y)) continue;
      const a = Math.min(run(x, y, 1, 0), run(x, y, 0, 1));
      kind[y * w.w + x] = a <= 2 ? 1 : a >= 8 ? 2 : 0;
    }
  // The window of 14 by 14 cells with the most narrow river, and the one with the most wide water
  // by land (half and half).
  let river = null;
  let shore = null;
  for (let y = 8; y < w.h - 22; y += 2)
    for (let x = 8; x < w.w - 22; x += 2) {
      let n = 0;
      let wide = 0;
      let dry = 0;
      for (let j = 0; j < 14; j++)
        for (let i = 0; i < 14; i++) {
          const k = kind[(y + j) * w.w + x + i];
          if (k === 1) n++;
          if (k === 2) wide++;
          if (!wet(x + i, y + j)) dry++;
        }
      if (!river || n > river.n) river = { n, x: x + 7, y: y + 7 };
      const s = Math.min(wide, dry);
      if (!shore || s > shore.n) shore = { n: s, x: x + 7, y: y + 7 };
    }
  return { river, shore, kind: Array.from(kind) };
}

async function shoot(browser, quality) {
  const ctx = await browser.newContext({ viewport: { width: 700, height: 830 }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(`${BASE}?size=medium&biome=temperate&seed=7&dpr=1&quality=${quality}`);
  await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
  await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
  const found = await page.evaluate(spots);
  console.error(`${quality}: most narrow river at ${found.river.x},${found.river.y}, lake shore at ${found.shore.x},${found.shore.y}`);
  const results = {};
  // The same spots at every level and before and after (found once with spots(), on high).
  for (const [name, at] of [
    ["river", RIVER],
    ["shore", SHORE],
  ]) {
    const aim = (a) => {
      const e = window.__engine;
      e.world.time = 100;
      const o = e.view.orbit;
      o.tx = a.x + 0.5;
      o.ty = a.y + 0.5;
      o.dist = 16;
      o.phi = 0.95;
      o.theta = 0.6;
    };
    await page.evaluate(aim, at);
    await page.waitForTimeout(2500);
    await page.evaluate(aim, at);
    await page.evaluate(() => window.__engine.view.terrain.updateFine(0, true));
    await page.waitForTimeout(2500);
    const png = await page.screenshot({ type: "png", timeout: 240_000 });
    writeFileSync(join(OUT, `${name}-${quality}-${TAG}.png`), png);
    // The middle of each narrow river cell in view, on the screen.
    const points = await page.evaluate((kind) => {
      const e = window.__engine;
      const w = e.world;
      const levels = e.view.terrain.fluidLevel;
      const cam = e.view.orbit.camera;
      cam.updateMatrixWorld();
      const V = cam.position.constructor;
      const pts = [];
      for (let y = 0; y < w.h; y++)
        for (let x = 0; x < w.w; x++) {
          if (kind[y * w.w + x] !== 1) continue;
          const p = new V(x + 0.5 - w.w / 2, levels[y * w.w + x], y + 0.5 - w.h / 2).project(cam);
          if (p.z > 1 || Math.abs(p.x) > 0.95 || Math.abs(p.y) > 0.95) continue;
          pts.push([Math.round((p.x * 0.5 + 0.5) * innerWidth), Math.round((0.5 - p.y * 0.5) * innerHeight)]);
        }
      return pts;
    }, found.kind);
    const pixels = await page.evaluate(
      async ([b64, pts]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        let pale = 0;
        let blue = 0;
        let sat = 0;
        const sum = [0, 0, 0];
        for (const [px, py] of pts)
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const k = ((py + dy) * c.width + px + dx) * 4;
              const [r, gg, b] = [d[k], d[k + 1], d[k + 2]];
              const hi = Math.max(r, gg, b);
              const lo = Math.min(r, gg, b);
              n++;
              sum[0] += r;
              sum[1] += gg;
              sum[2] += b;
              sat += (hi - lo) / Math.max(1, hi);
              if ((r + gg + b) / 3 > 190 || (hi - lo) / Math.max(1, hi) < 0.3) pale++;
              // Clearly blue: not the pale turquoise or grey-green of the shallows before.
              if (b > gg + 10 && b > r + 40) blue++;
            }
        return { n, pale, blue, mean: sum.map((v) => Math.round(v / Math.max(1, n))), saturation: Number((sat / Math.max(1, n)).toFixed(3)) };
      },
      [png.toString("base64"), points],
    );
    if (process.env.POINTS) writeFileSync(join(OUT, `${name}-${quality}-${TAG}-points.json`), JSON.stringify(points));
    results[name] = {
      at,
      cells: points.length,
      ...pixels,
      paleShare: Number((pixels.pale / Math.max(1, pixels.n)).toFixed(3)),
      blueShare: Number((pixels.blue / Math.max(1, pixels.n)).toFixed(3)),
    };
  }
  await ctx.close();
  return results;
}

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const all = {};
try {
  for (const q of QUALITIES) all[q] = await shoot(browser, q);
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `rivers-${TAG}.json`), JSON.stringify(all, null, 2) + "\n");
console.log(JSON.stringify(all));
let bad = false;
for (const [q, r] of Object.entries(all)) {
  if (r.river.cells < 30) {
    console.error(`${q}: only ${r.river.cells} narrow river cells in view`);
    bad = true;
  } else if (r.river.blueShare < LIMIT) {
    console.error(`${q}: ${(r.river.blueShare * 100).toFixed(1)}% of narrow river pixels blue (at least ${LIMIT * 100}%)`);
    bad = true;
  }
}
if (bad) process.exit(1);
