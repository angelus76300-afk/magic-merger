// Looks revamp, render side (roadmap 5.2.5): the same three island views with
// every look off and with a quality preset, at phone sizes, from the Perf Lab
// held still. Also times one frame's CPU side per look (the browser draws with
// a software GPU: the GPU cost is the phone's to tell).
//
//   npx vite --port 5191 &
//   node scripts/looks-render-frames.mjs <out dir> [qualities, e.g. "low,high"] [sizes, e.g. "390x844,344x882"]
//   TIME=1 node scripts/looks-render-frames.mjs <out dir> "low,on=shadows,on=grade,on=bloom,on=tilt,medium,high" 700x830
//
// Views: a village by day, the same village at night (lit windows, glowing
// plants), and the whole island from above by day.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const base = process.env.LAB_URL ?? "http://localhost:5191/lab/perf.html";
const [out = "/tmp/looks-render", qualities = "low,high", sizes = "390x844,344x882"] = process.argv.slice(2);
const seed = process.env.SEED ?? "7";
const timing = !!process.env.TIME;
mkdirSync(out, { recursive: true });
const DAY = 40;
const NIGHT = 262;
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

async function open(w, h, look) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  // Seeded, so the island and its people are the same in every run.
  await page.addInitScript((seed) => {
    let a = (Number(seed) * 2654435761) >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, seed);
  const q = look.startsWith("on=") ? `quality=low&${look}` : `quality=${look}`;
  await page.goto(`${base}?size=medium&seed=${seed}&dpr=1&${q}`);
  await page.waitForFunction(() => window.perfReady === true, null, { timeout: 120_000 });
  await page.evaluate(() => {
    document.querySelectorAll("body > div").forEach((d) => (d.style.visibility = "hidden"));
    const e = window.__engine;
    e.stop();
    // The same minutes of the island in every run.
    for (let t = 0; t < 60; t++) e.step();
  });
  return { ctx, page };
}

// The camera at a pose, the sky at `clock`, then `frames` frames drawn.
async function pose(page, { clock, cam, frames = 10 }) {
  return page.evaluate(
    ({ clock, cam, frames }) => {
      const e = window.__engine;
      window.__labSky.time = clock;
      e.resize();
      const o = e.view.orbit;
      const W = Math.max(e.world.w, e.world.h);
      const s = e.world.settlements[0] ?? { x: e.world.w / 2, y: e.world.h / 2 };
      o.tx = cam.village ? s.x : e.world.w / 2;
      o.ty = cam.village ? s.y : e.world.h / 2;
      o.dist = cam.dist === "whole" ? o.distanceFor(W * 0.55) : W * cam.dist;
      o.phi = cam.phi;
      o.theta = Math.PI * 0.25;
      for (let f = 0; f < frames; f++) e.render(1 / 30);
      return { calls: e.view.counts().calls, passes: e.view.looks.passes };
    },
    { clock, cam, frames },
  );
}

// CPU side of one frame (the view's own work, then waiting for the software raster), p50 of `n`.
async function time(page, n = 40) {
  return page.evaluate((n) => {
    const e = window.__engine;
    const gl = e.view.renderer.getContext();
    const px = new Uint8Array(4);
    const draw = [];
    const raster = [];
    for (let f = 0; f < n; f++) {
      e.view.orbit.orbit(0.5, 0);
      const t0 = performance.now();
      e.render(1 / 30);
      const t1 = performance.now();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      draw.push(t1 - t0);
      raster.push(performance.now() - t1);
    }
    const mid = (a) => Math.round([...a].sort((x, y) => x - y)[a.length >> 1] * 10) / 10;
    return { draw: mid(draw), raster: mid(raster), calls: e.view.counts().calls, passes: e.view.looks.passes };
  }, n);
}

const VIEWS = [
  ["village-day", { clock: DAY, cam: { village: true, dist: 0.2, phi: 0.95 } }],
  ["village-night", { clock: NIGHT, cam: { village: true, dist: 0.2, phi: 0.95 } }],
  ["island-day", { clock: DAY, cam: { dist: "whole", phi: 0.72 } }],
  // A mid zoom on the village, for the depth of field (the owner, 13 November).
  ["village-mid", { clock: DAY, cam: { village: true, dist: 0.36, phi: 0.88 } }],
];

for (const size of sizes.split(",")) {
  const [w, h] = size.split("x").map(Number);
  for (const look of qualities.split(",")) {
    const { ctx, page } = await open(w, h, look);
    const tag = look.replace("=", "-");
    for (const [name, p] of VIEWS) {
      const c = await pose(page, p);
      if (timing) console.log(JSON.stringify({ size, look, view: name, ...(await time(page)) }));
      else {
        await pose(page, p);
        await page.screenshot({ path: join(out, `${name}-${size}-${tag}.png`) });
        console.log(`${name} ${size} ${look}: ${c.calls} calls, ${c.passes} passes after the scene`);
      }
    }
    await ctx.close();
  }
}
await browser.close();
