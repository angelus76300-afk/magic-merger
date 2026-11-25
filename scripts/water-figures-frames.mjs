// Figures on the water as drawn (24 November): close frames of a villager wading in the shallows
// and of a dock, on the medium temperate island of seed 7 in the Perf Lab, on high, every chunk
// built in eighths. A shallow cell of water by the shore is found, a villager put in it and a dock
// of two planks laid beside it; the simulation is stopped so neither moves. For each, a frame from
// the side and the gap between what the view drew and the water there (the villager's feet, the
// dock's planks' underside), against Terrain.groundAt.
//
//   npx vite --port 5174 &
//   [SPOT=x,y] NODE_PATH=$(npm root -g) node scripts/water-figures-frames.mjs <out dir> [tag]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "water-figures-frames";
const TAG = process.argv[3] ?? "frame";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
mkdirSync(OUT, { recursive: true });

// In the page: a cell of shallow water (0.3 to 0.8 deep) with dry land on one side and water on the
// other three, far from the island's edge; a villager in it, a dock on the water beside it.
function place(at) {
  const e = window.__engine;
  const w = e.world;
  e.stop();
  const water = (k) => w.fluid[k] === 1 && w.depth[k] > 0.3 && w.depth[k] < 0.8 && w.cover[k] === 0;
  let best = null;
  for (let y = 20; y < w.h - 20; y++)
    for (let x = 20; x < w.w - 20; x++) {
      const k = y * w.w + x;
      if (!water(k) || !water(k + 1) || !water(k + 2) || !water(k + w.w) || !water(k - w.w)) continue;
      if (w.fluid[k - 1] !== 0 || w.depth[k - 1] > 0 || w.cover[k - 1] >= 4) continue;
      const score = Math.abs(w.depth[k] - 0.5);
      if (!best || score < best.score) best = { x, y, score };
    }
  // SPOT=x,y: that cell instead (the same spot before and after a change).
  const { x: X, y: Y } = at ? { x: at[0], y: at[1] } : best;
  // The dock: two planks out from the shore, two cells north of the villager.
  const dock = [(Y - 2) * w.w + X, (Y - 2) * w.w + X + 1];
  for (const k of dock) if (w.fluid[k] === 1) w.setCover(k, 24);
  w.time = 100;
  const v = w.creatures.find((c) => c.kind === "villager" && !c.dead);
  v.x = X + 1.5;
  v.y = Y + 0.5;
  v.z = 0;
  e.view.gaits.delete(v.id);
  e.view.terrain.coversChanged = true;
  return { X, Y, id: v.id, depth: w.depth[Y * w.w + X + 1], dock: dock.filter((k) => w.cover[k] === 24) };
}

const aim = (a) => {
  const e = window.__engine;
  const o = e.view.orbit;
  o.tx = a.tx;
  o.ty = a.ty;
  o.dist = a.dist ?? 5;
  o.phi = a.phi ?? 1.25;
  o.theta = a.theta ?? 0;
};

// In the page: the gaps, scene units. The villager's feet as the view eased them (its gait), the
// dock's model's lowest plank: the cover mesh's instance less its model's offset.
function measure(spot) {
  const e = window.__engine;
  const v = e.view;
  const w = e.world;
  const c = w.creatures.find((o) => o.id === spot.id);
  const g = v.gaits.get(spot.id);
  const feet = g?.gy;
  const water = v.terrain.groundAt(c.x, c.y);
  const mesh = v.covers.get("dock");
  const m = new v.m.constructor();
  const docks = [];
  // Each dock cell's instance: the one nearest its middle. Its planks from 0.22 over its base (flora.ts dock).
  for (const k of spot.dock) {
    const cx = k % w.w;
    const cy = Math.floor(k / w.w);
    let best = null;
    for (let n = 0; mesh && n < mesh.count; n++) {
      mesh.getMatrixAt(n, m);
      const d = Math.hypot(m.elements[12] + w.w / 2 - (cx + 0.5), m.elements[14] + w.h / 2 - (cy + 0.5));
      if (!best || d < best.d) best = { d, base: m.elements[13] };
    }
    if (!best || best.d > 1) continue;
    const planks = best.base + 0.22;
    const water = v.terrain.groundAt(cx + 0.5, cy + 0.5);
    docks.push({ x: cx, y: cy, planks: Number(planks.toFixed(3)), water: Number(water.toFixed(3)), gap: Number((planks - water).toFixed(3)) });
  }
  return {
    villager: { x: c.x, y: c.y, feet: Number(feet?.toFixed(3)), water: Number(water.toFixed(3)), gap: Number((feet - water).toFixed(3)) },
    docks,
  };
}

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
let result;
try {
  const ctx = await browser.newContext({ viewport: { width: 700, height: 830 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(`${BASE}?size=medium&biome=temperate&seed=7&dpr=1&quality=high`);
  await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
  await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
  const spot = await page.evaluate(place, process.env.SPOT ? process.env.SPOT.split(",").map(Number) : null);
  console.error(`spot ${spot.X},${spot.Y}, depth ${spot.depth.toFixed(2)}`);
  const frame = async (view, name) => {
    await page.evaluate(aim, view);
    // Twice: the chunks in view are built in eighths, then shown.
    for (let pass = 0; pass < 2; pass++) {
      await page.evaluate(() => window.__engine.view.terrain.updateFine(0, true));
      // The view's clock moves on (the world's time; the simulation stays stopped), so feet are eased
      // and the covers put again as in play.
      for (let k = 0; k < 6; k++)
        await page.evaluate(() => {
          window.__engine.world.time += 0.3;
          window.__engine.render(1 / 30);
        });
      await page.waitForTimeout(1000);
    }
    writeFileSync(join(OUT, `${name}-${TAG}.png`), await page.screenshot({ type: "png", timeout: 240_000 }));
  };
  await frame({ tx: spot.X + 1.5, ty: spot.Y + 0.5, dist: 5, phi: 1.2, theta: 0 }, "wading");
  await frame({ tx: spot.X + 1, ty: spot.Y - 1.5, dist: 6, phi: 1.2, theta: 0 }, "dock");
  result = { tag: TAG, spot, ...(await page.evaluate(measure, spot)) };
  await ctx.close();
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `water-figures-${TAG}.json`), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
