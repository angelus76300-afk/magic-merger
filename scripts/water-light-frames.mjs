// Water and light (16 November, the owner: "even water would need a light shader"): the Perf Lab
// held still at the spots where things meet, on high, at the owner's unfolded Fold by default.
// Views: a pond close up, the sea at the island's edge seen from the side, a beach, a snowy peak,
// the shore and a village at night, and the land after Big Bang. For each: one PNG, the triangles
// drawn and the time a frame takes over a fixed bench (software WebGL: compare runs with each
// other, not with a phone). scripts/water-light-crops.py cuts the same spots from two runs.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/water-light-frames.mjs <out dir> [tag] [views]
//   SIZE=344x882 LAB_URL=http://localhost:5175/lab/perf.html ...
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "water-light";
const TAG = process.argv[3] ?? "frame";
const ONLY = process.argv[4] ? process.argv[4].split(",") : null;
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const [W, H] = (process.env.SIZE ?? "700x830").split("x").map(Number);
const FRAMES = Number(process.env.FRAMES ?? 5);
const QUALITY = process.env.QUALITY ?? "high";
const EXTRA = process.env.EXTRA ?? "";

// The island, the spot, and the camera. `time` 60 is morning, 263 the middle of the night.
const DAY = 60;
const NIGHT = 263;
const VIEWS = {
  pond: { q: "biome=temperate&shape=lakes&seed=7", spot: "pond", at: { x: 58.5, y: 75.5 }, dist: 12, phi: 0.95, theta: 0.6, time: DAY },
  side: { q: "biome=temperate&shape=coast&seed=7", spot: "edge", at: { x: 88.5, y: 148 }, dist: 14, phi: 1.3, theta: 0, time: DAY },
  beach: { q: "biome=temperate&shape=coast&seed=7", spot: "beach", at: { x: 20.5, y: 14.5 }, dist: 14, phi: 1.05, theta: 0.8, time: DAY },
  peak: { q: "biome=tundra&shape=ridges&seed=7&peaks=1", spot: "peak", at: { x: 3.5, y: 29.5 }, dist: 16, phi: 0.9, theta: 0.7, time: DAY },
  night: { q: "biome=temperate&shape=coast&seed=7", spot: "village-shore", at: { x: 97.5, y: 73.5 }, dist: 18, phi: 1.0, theta: 0.5, time: NIGHT },
  mesa: { q: "biome=mesa&shape=plateau&seed=3", spot: "peak", at: { x: 43.5, y: 74.5 }, dist: 16, phi: 0.95, theta: 0.7, time: DAY },
  desert: { q: "biome=desert&shape=plateau&seed=3", spot: "peak", at: { x: 37.5, y: 101.5 }, dist: 16, phi: 0.95, theta: 0.7, time: DAY },
  // The village at dusk (warm sun, cool shade) and houses by the water at night (windows reflected).
  dusk: { q: "biome=temperate&shape=coast&seed=7", spot: "village", at: { x: 97.5, y: 73.5 }, dist: 18, phi: 0.95, theta: 0.5, time: 209 },
  harbour: { q: "biome=temperate&shape=coast&seed=7", spot: "harbour", at: { x: 56.42, y: 43.17, theta: 2.768 }, dist: 13, phi: 1.12, theta: 0, time: NIGHT },
  // Lava by the pond at night (a small pool laid by the shore, the island held still): its light on
  // the water and on the land round it.
  glowwater: { q: "biome=temperate&shape=lakes&seed=7", spot: "pond", at: { x: 58.5, y: 75.5 }, dist: 16, phi: 1.15, theta: 3.74, time: NIGHT, lava: true },
  lava: { q: "biome=volcanic&shape=coast&seed=7&peaks=1", spot: "lava", at: { x: 74.5, y: 65.5 }, dist: 16, phi: 0.95, theta: 0.4, time: NIGHT },
  // Big Bang's ground by a village, as its wave leaves it (lab/spells/big-bang.js): stardust in most
  // cells, crystal forming in some, the land as it was in the rest. Laid with seeded numbers on an
  // island held still from its first frame, so main and the branch draw the same land (a cast's
  // own run depends on the clock).
  bang: { q: "biome=temperate&shape=coast&seed=7", spot: "village", at: { x: 97.5, y: 73.5 }, dist: 16, phi: 0.95, theta: 0.6, time: DAY, bang: true },
};
const names = ONLY ?? Object.keys(VIEWS);
mkdirSync(OUT, { recursive: true });

// Finds a spot on the island, in the page (cells).
function find(kind) {
  const e = window.__engine;
  const w = e.world;
  const at = (x, y) => y * w.w + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w.w && y < w.h;
  const wet = (i) => w.fluid[i] === 1 && w.depth[i] > 0.06;
  const count = (x, y, r, f) => {
    let n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (inside(x + dx, y + dy) && f(at(x + dx, y + dy))) n++;
    return n;
  };
  let best = null;
  let score = -Infinity;
  const consider = (x, y, s) => {
    if (s > score) {
      score = s;
      best = { x: x + 0.5, y: y + 0.5 };
    }
  };
  const mid = Math.hypot(w.w, w.h) / 2;
  for (let y = 3; y < w.h - 3; y++)
    for (let x = 3; x < w.w - 3; x++) {
      const i = at(x, y);
      const fromMid = Math.hypot(x - w.w / 2, y - w.h / 2);
      if (kind === "pond" && wet(i)) {
        // Water with land all round: a pond or a lake's corner, toward the middle.
        const water = count(x, y, 5, wet);
        if (water > 20 && water < 70) consider(x, y, -Math.abs(water - 45) - fromMid * 0.3 + count(x, y, 2, wet) * 2);
      } else if (kind === "beach" && w.ground[i] === 2 && !wet(i)) {
        consider(x, y, count(x, y, 3, (j) => wet(j) && w.depth[j] > 0.4) * 2 + count(x, y, 3, (j) => w.ground[j] === 0 && !wet(j)) - fromMid * 0.05);
      } else if (kind === "peak" && (w.ground[i] === 4 || w.ground[i] === 3)) {
        // Snow and rock where neighbouring cells differ by two voxels or more: terraces.
        const top = (j) => Math.round(w.height[j] * 0.5);
        const steps = count(x, y, 3, (j) => {
          const jx = j % w.w;
          return (w.ground[j] === 4 || w.ground[j] === 3) && jx + 1 < w.w && Math.abs(top(j) - top(j + 1)) >= 2 && Math.abs(top(j) - top(j + 1)) <= 3;
        });
        consider(x, y, steps + count(x, y, 3, (j) => w.ground[j] === 4) * 0.3);
      } else if (kind === "lava" && w.fluid[i] === 3) {
        consider(x, y, count(x, y, 3, (j) => w.fluid[j] === 3) - Math.abs(count(x, y, 3, (j) => w.fluid[j] === 3) - 20));
      } else if (kind === "lava-water" && w.fluid[i] === 3) {
        const water = count(x, y, 12, (j) => wet(j) && w.fluid[j] === 1 && w.depth[j] > 0.3);
        if (water > 3) consider(x, y, Math.min(water, 40) + count(x, y, 2, (j) => w.fluid[j] === 3));
      } else if (kind === "harbour" && w.cover[i] === 4) {
        // A house with deep water a few cells off.
        const sea = count(x, y, 6, (j) => wet(j) && w.depth[j] > 0.3);
        if (sea > 4) consider(x, y, Math.min(sea, 30) + count(x, y, 4, (j) => w.cover[j] === 4) * 3);
      } else if ((kind === "village-shore" || kind === "village") && w.cover[i] === 4) {
        const sea = count(x, y, 8, (j) => wet(j) && w.depth[j] > 0.5);
        consider(
          x,
          y,
          kind === "village" ? count(x, y, 4, (j) => w.cover[j] === 4) - fromMid / mid : Math.min(sea, 60) + count(x, y, 3, (j) => w.cover[j] === 4) * 2,
        );
      }
    }
  if (kind === "harbour" && best) {
    // Between the houses and the water, the camera behind the houses, looking out over the water.
    let wx = 0;
    let wy = 0;
    let n = 0;
    const bx = Math.floor(best.x);
    const by = Math.floor(best.y);
    for (let dy = -6; dy <= 6; dy++)
      for (let dx = -6; dx <= 6; dx++)
        if (inside(bx + dx, by + dy) && wet(at(bx + dx, by + dy)) && w.depth[at(bx + dx, by + dy)] > 0.3) {
          wx += bx + dx + 0.5;
          wy += by + dy + 0.5;
          n++;
        }
    wx /= n;
    wy /= n;
    return { x: (best.x + wx) / 2, y: (best.y + wy) / 2, theta: Math.atan2(wx - best.x, wy - best.y) };
  }
  if (kind === "edge") {
    // The south edge of the island where the sea meets it, the camera south of it.
    let run = 0;
    for (let x = 0; x < w.w; x++) {
      run = wet(at(x, w.h - 1)) ? run + 1 : 0;
      if (run > 8 && !best) best = { x: x - 4 + 0.5, y: w.h - 4 };
    }
  }
  return best ?? { x: w.w / 2, y: w.h / 2 };
}

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const rows = [];
try {
  for (const name of names) {
    const v = VIEWS[name];
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("page error:", err.message));
    page.on("console", (m) => m.type() === "error" && console.error("console:", m.text().slice(0, 400)));
    if (v.bang || v.lava)
      // No frame runs by itself (the simulation would move on with the clock), and Math.random is seeded.
      await page.addInitScript(() => {
        window.requestAnimationFrame = () => 0;
        let s = 12345;
        Math.random = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
      });
    await page.goto(`${BASE}?size=medium&${v.q}&dpr=1&quality=${QUALITY}&time=${v.time}${EXTRA ? `&${EXTRA}` : ""}`);
    await page.waitForFunction(() => window.perfReady === true, null, { timeout: 180_000 });
    await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
    // The spot: fixed for the views measured before and after, found on the island otherwise.
    const spot = v.at ?? (await page.evaluate(find, v.spot));
    const r = await page.evaluate(
      async ({ v, spot, frames }) => {
        const e = window.__engine;
        const w = e.world;
        const wait = (ms) => new Promise((res) => setTimeout(res, ms));
        if (v.lava) {
          // The dry cells nearest the spot, three across, under lava.
          let best = null;
          for (let y = Math.floor(spot.y) - 10; y <= spot.y + 10; y++)
            for (let x = Math.floor(spot.x) - 10; x <= spot.x + 10; x++) {
              let dry = 0;
              for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (w.fluid[(y + dy) * w.w + x + dx] === 0) dry++;
              const d = Math.hypot(x - spot.x, y - spot.y);
              if (dry === 9 && (!best || d < best.d)) best = { x, y, d };
            }
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const i = (best.y + dy) * w.w + best.x + dx;
              w.fluid[i] = 3;
              w.depth[i] = 0.4;
            }
          w.time = v.time;
          e.view.landChanged = true;
          for (let k = 0; k < 30; k++) e.render(0);
        }
        if (v.bang) {
          const m = w.materials;
          const dust = m.define(m.makeMaterial("stardust", "ground", [0x241a40, 0x2e2152, 0x3a2a63, 0x4a3578], { glow: true, fallback: "crystal" }));
          let s = 777;
          const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
          for (let y = 0; y < w.h; y++)
            for (let x = 0; x < w.w; x++) {
              const i = y * w.w + x;
              const r = rand();
              if (w.fluid[i] !== 0 || Math.hypot(x - spot.x, y - spot.y) > 40) continue;
              if (r < 0.75) w.ground[i] = dust;
              else if (r < 0.85) w.ground[i] = 7;
            }
          w.time = v.time;
          e.view.landChanged = true;
          for (let k = 0; k < 30; k++) e.render(0);
        }
        const o = e.view.orbit;
        o.tx = spot.x;
        o.ty = spot.y;
        o.dist = v.dist;
        o.phi = v.phi;
        o.theta = spot.theta ?? v.theta;
        // An island held still moves its camera only as frames are drawn.
        if (v.bang || v.lava) {
          // The water's lights are looked for again as the clock moves; it is held still here.
          e.view.waterLightsAt = -1e9;
          for (let k = 0; k < 40; k++) e.render(0.1);
        }
        await wait(1500);
        e.view.terrain.updateFine(0, true);
        // An island held still moves its camera only as frames are drawn.
        if (v.bang || v.lava) {
          // The water's lights are looked for again as the clock moves; it is held still here.
          e.view.waterLightsAt = -1e9;
          for (let k = 0; k < 40; k++) e.render(0.1);
        }
        await wait(1500);
        e.view.terrain.updateFine(0, true);
        e.stop();
        w.time = v.time;
        const r = e.view.renderer;
        const sm = r.shadowMap;
        const inner = sm.render.bind(sm);
        let shadowTris = 0;
        sm.render = (...a) => {
          const before = r.info.render.triangles;
          inner(...a);
          shadowTris += r.info.render.triangles - before;
        };
        const canvas = document.getElementById("world");
        const gl = r.getContext();
        const px = new Uint8Array(4);
        e.render(0);
        e.render(0);
        shadowTris = 0;
        e.render(0);
        const tris = e.view.counts().triangles;
        const shadow = shadowTris;
        const png = canvas.toDataURL("image/png");
        const times = [];
        for (let f = 0; f < frames; f++) {
          const t0 = performance.now();
          o.orbit(0.0001, 0);
          e.render(0);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        return { tris, shadow, png, ms: Math.round(times[times.length >> 1]) };
      },
      { v, spot, frames: FRAMES },
    );
    writeFileSync(join(OUT, `${name}-${TAG}.png`), Buffer.from(r.png.split(",")[1], "base64"));
    const row = { view: name, tag: TAG, W, H, spot, tris: r.tris, main: r.tris - r.shadow, ms: r.ms };
    rows.push(row);
    console.log(JSON.stringify(row));
    await ctx.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `numbers-${TAG}.json`), JSON.stringify(rows, null, 1));
