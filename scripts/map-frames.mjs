// The island as a map (roadmap 4.9 part 3): the same saved islands
// (scripts/map-states.ts) drawn the same way before and after a change to the
// view, from the Perf Lab held still. Seeded, so the minutes stepped after the
// load are the same in both runs. Also times the sky view (CPU side only:
// the browser draws with a software GPU).
//   npx vite --port 5181 &   (from the checkout to draw)
//   node scripts/map-frames.mjs <out dir> <before|after> [states dir] [what]
// what: "read" (island whole, day and night, 344x882, every seed), "gallery"
// (sizes, zooms, a cart, the eye; first seed), "perf", or all (default).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const base = process.env.LAB_URL ?? "http://localhost:5181/lab/perf.html";
const [out = "/tmp/map-frames", tag = "after", states = "/tmp/map-frames/states", what = "all"] = process.argv.slice(2);
const SEEDS = (process.env.SEEDS ?? "3,5,8,13,21").split(",");
mkdirSync(out, { recursive: true });
const DAY = 70;
const NIGHT = 262;
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

async function open(seed, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: w < 1000, isMobile: w < 1000 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error(seed, "page error:", e.message));
  const save = readFileSync(join(states, `${seed}.json`), "utf8");
  await page.addInitScript(
    ({ save, seed }) => {
      window.__mmSave = JSON.parse(save);
      // Seeded, so the ticks stepped here are the same before and after.
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
  await page.goto(`${base}?dpr=2`);
  await page.waitForFunction(() => window.perfReady === true, null, { timeout: 120_000 });
  await page.evaluate(() => document.querySelectorAll("body > div").forEach((d) => (d.style.visibility = "hidden")));
  return { ctx, page };
}

// Steps the island `ticks` ticks (no drawing), the sky at `clock`, the camera at a pose, then draws `frames` frames.
async function pose(page, { ticks = 0, clock = DAY, cam, frames = 12 }) {
  await page.evaluate(
    ({ ticks, clock, cam, frames }) => {
      const e = window.__engine;
      for (let t = 0; t < ticks; t++) e.step();
      window.__labSky.time = clock;
      e.resize();
      const o = e.view.orbit;
      const W = Math.max(e.world.w, e.world.h);
      o.tx = cam.tx ?? e.world.w / 2;
      o.ty = cam.ty ?? e.world.h / 2;
      // "whole": the tour's opening shot (firstlook.ts); a number: that many island widths away.
      o.dist = cam.dist === "whole" ? o.distanceFor(W * 0.55) : W * cam.dist;
      o.phi = cam.phi ?? (cam.dist === "whole" ? 0.72 : 0.95);
      o.theta = cam.theta ?? Math.PI * 0.25;
      for (let f = 0; f < frames; f++) e.render(1 / 30);
    },
    { ticks, clock, cam, frames },
  );
}

const shot = (page, name) => page.screenshot({ path: join(out, `${name}-${tag}.png`) });

if (what === "all" || what === "read") {
  for (const seed of SEEDS) {
    const { ctx, page } = await open(seed, 344, 882);
    await pose(page, { ticks: 90, cam: { dist: "whole" } });
    await shot(page, `read-${seed}-day`);
    await pose(page, { clock: NIGHT, cam: { dist: "whole" } });
    await shot(page, `read-${seed}-night`);
    // Where each village is on the frame (2x pixels), to score a reading against (scripts/map-score.py).
    const at = await page.evaluate(() => {
      const e = window.__engine;
      const w = e.world;
      const cam = e.view.orbit.camera;
      return w.settlements.map((s) => {
        const i = Math.round(s.y) * w.w + Math.round(s.x);
        const v = cam.position.clone();
        v.set(s.x - w.w / 2, w.height[i] * 0.5, s.y - w.h / 2).project(cam);
        const r = e.canvas.getBoundingClientRect();
        return { name: s.name, x: Math.round((v.x + 1) * r.width), y: Math.round((1 - v.y) * r.height) };
      });
    });
    writeFileSync(join(out, `proj-${seed}.json`), JSON.stringify(at));
    await ctx.close();
    console.log("read", seed);
  }
}

if (what === "all" || what === "gallery") {
  const seed = SEEDS[0];
  for (const [w, h] of [
    [344, 882],
    [700, 830],
    [1440, 900],
  ]) {
    const { ctx, page } = await open(seed, w, h);
    await pose(page, { ticks: 90, cam: { dist: "whole" } });
    await shot(page, `whole-${w}-day`);
    await pose(page, { clock: NIGHT, cam: { dist: "whole" } });
    await shot(page, `whole-${w}-night`);
    if (w === 344) {
      const v = await page.evaluate(() => {
        const s = window.__engine.world.settlements[0];
        return { tx: s.x, ty: s.y };
      });
      // Mid zoom (names fading), the default play distance, and close.
      for (const [name, dist] of [
        ["mid", 1.0],
        ["play", 0.42],
        ["close", 0.12],
      ])
        await pose(page, { cam: { ...v, dist } }).then(() => shot(page, `${name}-${w}-day`));
      // On until a market trip to another village has been under way for twenty seconds (at most four minutes).
      const road = await page.evaluate(() => {
        const e = window.__engine;
        const w = e.world;
        const going = (c) => !c.dead && c.kind === "villager" && c.data?.trip?.to && !("seed" in c.data.trip.to) && c.mind?.task === "trade";
        const since = new Map();
        let c;
        for (let t = 0; t < 7200 && !c; t++) {
          e.step();
          if (t % 30) continue;
          for (const k of w.creatures) if (going(k) && !since.has(k.id)) since.set(k.id, w.time);
          // On a road, out of the villages.
          c = w.creatures.find(
            (k) =>
              going(k) &&
              w.time - since.get(k.id) > 8 &&
              w.ground[Math.round(k.y) * w.w + Math.round(k.x)] === 10 &&
              w.villages.every((v) => Math.hypot(v.x - k.x, v.y - k.y) > 14),
          );
        }
        return { trips: w.creatures.filter(going).length, tx: c?.x, ty: c?.y };
      });
      await pose(page, { cam: { dist: "whole" } });
      console.log("trips under way", road.trips);
      await shot(page, `cart-whole-${w}-day`);
      if (road.tx !== undefined) {
        const at = await page.evaluate(({ tx, ty }) => {
          const e = window.__engine;
          const w = e.world;
          const cam = e.view.orbit.camera;
          const v = cam.position
            .clone()
            .set(tx - w.w / 2, w.height[Math.round(ty) * w.w + Math.round(tx)] * 0.5, ty - w.h / 2)
            .project(cam);
          const r = e.canvas.getBoundingClientRect();
          return [Math.round((v.x + 1) * r.width), Math.round((1 - v.y) * r.height)];
        }, road);
        console.log("cart on the whole frame at (2x px)", at);
        await pose(page, { cam: { tx: road.tx, ty: road.ty, dist: 0.8 } });
        await shot(page, `cart-mid-${w}-day`);
        await pose(page, { cam: { tx: road.tx, ty: road.ty, dist: 0.42 } });
        await shot(page, `cart-play-${w}-day`);
        await pose(page, { cam: { tx: road.tx, ty: road.ty, dist: 0.12 } });
        await shot(page, `cart-close-${w}-day`);
      }
      // Through a villager's eyes, in its village.
      await page.evaluate(() => {
        const e = window.__engine;
        const c = e.world.creatures.find((k) => k.kind === "villager" && !k.dead);
        e.view.eyeId = c.id;
        e.view.orbit.eyeOn(0.6, c.x, c.y, 12);
        for (let f = 0; f < 12; f++) e.render(1 / 30);
      });
      await shot(page, `eye-${w}-day`);
    }
    await ctx.close();
    console.log("gallery", w);
  }
}

if (what === "all" || what === "perf") {
  // The sky view at 344, island whole and at play distance: ms per draw (JavaScript), calls, triangles.
  const seed = SEEDS[0];
  const { ctx, page } = await open(seed, 344, 882);
  for (const [name, dist, clock] of [
    ["whole-day", "whole", DAY],
    ["whole-night", "whole", NIGHT],
    ["play-day", 0.42, DAY],
  ]) {
    await pose(page, { ticks: name === "whole-day" ? 90 : 0, clock, cam: { dist } });
    const r = await page.evaluate(() => {
      const e = window.__engine;
      const ms = [];
      for (let f = 0; f < 240; f++) {
        const t = performance.now();
        e.view.orbit.orbit(0.5, 0);
        e.render(1 / 30);
        ms.push(performance.now() - t);
      }
      ms.sort((a, b) => a - b);
      const c = e.view.counts();
      return { p50: Math.round(ms[120] * 100) / 100, p90: Math.round(ms[216] * 100) / 100, calls: c.calls, triangles: c.triangles };
    });
    console.log("perf", tag, name, JSON.stringify(r));
  }
  await ctx.close();
}
await browser.close();
