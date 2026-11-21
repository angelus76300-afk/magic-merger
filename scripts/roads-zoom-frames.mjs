// Roads that follow the ground, and nothing that changes with zoom but smoke and names (21 November,
// the owner: "Roads look too blocky", "merchants carriage are a bit too big", "I don't like things
// looking different when zooming out"). The same saved island (scripts/map-states.ts) in the Perf
// Lab at 832 by 1000 on high, held still and seeded, before and after: a road over hills close up
// and zoomed out, a village at night zoomed out, a cart on a road close up and zoomed out.
//   npx vite --port 5182 &   (from the checkout to draw)
//   node scripts/roads-zoom-frames.mjs <out dir> <before|after> <states dir> [seed]
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const base = process.env.LAB_URL ?? "http://localhost:5182/lab/perf.html";
const [out = "roads-zoom-frames", tag = "after", states = "states", seed = "3"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const DAY = 70;
const NIGHT = 262;
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const rows = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 832, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  const save = readFileSync(join(states, `${seed}.json`), "utf8");
  await page.addInitScript(
    ({ save, seed }) => {
      window.__mmSave = JSON.parse(save);
      let a = (Number(seed) * 2654435761) >>> 0;
      Math.random = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    { save, seed },
  );
  await page.goto(`${base}?dpr=1&quality=high`);
  await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
  await page.evaluate(() => document.querySelectorAll("body > div").forEach((d) => (d.style.visibility = "hidden")));

  // The camera on (tx, ty) at `dist` cells (or "whole": the tour's opening shot), the sky at `clock`; the fine land built.
  const pose = (cam) =>
    page.evaluate((cam) => {
      const e = window.__engine;
      window.__labSky.time = cam.clock;
      e.resize();
      const o = e.view.orbit;
      const W = Math.max(e.world.w, e.world.h);
      o.tx = cam.tx;
      o.ty = cam.ty;
      o.dist = cam.dist === "whole" ? o.distanceFor(W * 0.55) : cam.dist;
      o.phi = cam.phi ?? 0.95;
      o.theta = cam.theta ?? Math.PI * 0.25;
      for (let f = 0; f < 8; f++) {
        e.render(1 / 30);
        e.view.terrain.updateFine(0, true);
      }
      for (let f = 0; f < 4; f++) e.render(1 / 30);
    }, cam);
  const shot = async (name) => {
    const file = join(out, `${name}-${tag}.png`);
    await page.screenshot({ path: file });
    rows.push(file);
    console.log(file);
  };

  // The road over the most relief: the road cell whose 9 by 9 neighbourhood of road cells climbs most.
  const hill = await page.evaluate(() => {
    const w = window.__engine.world;
    const road = (i) => w.ground[i] === 10;
    let best = { tx: w.w / 2, ty: w.h / 2, climb: -1 };
    for (let y = 6; y < w.h - 6; y++)
      for (let x = 6; x < w.w - 6; x++) {
        const i = y * w.w + x;
        if (!road(i)) continue;
        let climb = 0;
        for (let dy = -4; dy <= 4; dy++)
          for (let dx = -4; dx <= 4; dx++) {
            const j = i + dy * w.w + dx;
            if (road(j) && road(j + 1)) climb += Math.abs(w.height[j + 1] - w.height[j]);
            if (road(j) && road(j + w.w)) climb += Math.abs(w.height[j + w.w] - w.height[j]);
          }
        if (climb > best.climb) best = { tx: x + 0.5, ty: y + 0.5, climb };
      }
    return best;
  });
  console.log("road over hills", JSON.stringify(hill));
  await pose({ ...hill, dist: 22, clock: DAY });
  await shot("road-hills-close");
  await pose({ ...hill, dist: "whole", clock: DAY, phi: 0.72 });
  await shot("road-hills-out");

  // A village at night, zoomed out: the largest.
  const town = await page.evaluate(() => {
    const s = [...window.__engine.world.settlements].sort((a, b) => (b.people ?? 0) - (a.people ?? 0))[0];
    return { tx: s.x, ty: s.y };
  });
  await pose({ ...town, dist: "whole", clock: NIGHT, phi: 0.72 });
  await shot("village-night-out");
  await pose({ ...town, dist: 22, clock: NIGHT });
  await shot("village-night-close");

  // On until a market trip is under way on a road out of the villages (at most four minutes).
  const cart = await page.evaluate(() => {
    const e = window.__engine;
    const w = e.world;
    const going = (c) => !c.dead && c.kind === "villager" && c.data?.trip?.to && !("seed" in c.data.trip.to) && c.mind?.task === "trade";
    const since = new Map();
    let c;
    for (let t = 0; t < 7200 && !c; t++) {
      e.step();
      if (t % 30) continue;
      for (const k of w.creatures) if (going(k) && !since.has(k.id)) since.set(k.id, w.time);
      c = w.creatures.find(
        (k) =>
          going(k) &&
          w.time - since.get(k.id) > 8 &&
          w.ground[Math.round(k.y) * w.w + Math.round(k.x)] === 10 &&
          w.villages.every((v) => Math.hypot(v.x - k.x, v.y - k.y) > 14),
      );
    }
    return c ? { tx: c.x, ty: c.y } : null;
  });
  if (cart) {
    await pose({ ...cart, dist: 9, clock: DAY, phi: 0.8 });
    await shot("cart-close");
    await pose({ ...cart, dist: "whole", clock: DAY, phi: 0.72 });
    await shot("cart-out");
  } else console.log("no market trip on a road within four minutes");
  await ctx.close();
} finally {
  await browser.close();
}
writeFileSync(join(out, `frames-${tag}.json`), JSON.stringify(rows, null, 1));
