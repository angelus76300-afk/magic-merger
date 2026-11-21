// Cold is a pressure, not a trap (21 November): frames of it in the Perf Lab, at 832 by 1000 (a
// foldable open) on high, saved to docs/visual-checks/cold/ by default:
//   peak-herd     five deer put on the highest peak of the tundra island of seed 7 (its climate is
//                 printed), a few seconds later: frosted over, heading downhill (their chill and
//                 height are printed at the start and at the frame);
//   statue        a deer frozen to death on that peak, standing white with frost;
//   cairn         the stones an explorer leaves (goals.ts cairn: three stones in three greys, two
//                 cells), put on open grass;
//   hood          people of a village on that island, colder than 2 degrees there, hooded.
// It starts the dev server itself and stops it at the end.
//   node scripts/cold-frames.mjs [out dir]
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = resolve(process.argv[2] ?? "docs/visual-checks/cold");
const PORT = 5181;
const BASE = `http://localhost:${PORT}/lab/perf.html`;
mkdirSync(OUT, { recursive: true });

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"], detached: true });
const stop = () => {
  try {
    process.kill(-vite.pid, "SIGTERM");
  } catch {
    /* gone */
  }
};
process.on("exit", stop);
await new Promise((ok, fail) => {
  const t = setTimeout(() => fail(new Error("vite did not start")), 60_000);
  vite.stdout.on("data", (d) => {
    if (String(d).includes("localhost")) {
      clearTimeout(t);
      ok();
    }
  });
});

const aim = ([tx, ty, dist, phi, theta]) => {
  const o = window.__engine.view.orbit;
  o.tx = tx;
  o.ty = ty;
  o.dist = dist;
  o.phi = phi;
  o.theta = theta;
};

// The peak, five deer round it, a statue on its far side, a cairn on open grass.
function setUp() {
  const e = window.__engine;
  const w = e.world;
  let top = 0;
  for (let i = 0; i < w.n; i++) {
    const x = i % w.w;
    const y = Math.floor(i / w.w);
    if (x < 14 || y < 14 || x > w.w - 15 || y > w.h - 15) continue;
    if (w.depth[i] < 0.05 && w.cover[i] === 0 && w.height[i] > w.height[top]) top = i;
  }
  const px = top % w.w;
  const py = Math.floor(top / w.w);
  const model = w.creatures.find((c) => c.kind === "deer");
  const make = (x, y, id) => ({
    ...model,
    id,
    x,
    y,
    homeX: x,
    homeY: y,
    tx: x,
    ty: y,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    hp: 70,
    dead: false,
    deadFor: 0,
    frozen: 0,
    sp: 0,
    data: {},
    mind: undefined,
  });
  const herd = [];
  for (let n = 0; n < 5; n++) {
    const c = make(px + Math.cos(n * 1.26) * 1.6, py + Math.sin(n * 1.26) * 1.6, 990001 + n);
    w.creatures.push(c);
    herd.push(c.id);
  }
  const statue = make(px + 0.5, py + 3.5, 990010);
  Object.assign(statue, { dead: true, hp: 0, deadFor: 0.5, data: { frostDeath: true } });
  w.creatures.push(statue);
  // Open grass for the cairn.
  let spot = -1;
  for (let i = w.w * 20; i < w.n - w.w * 20 && spot < 0; i += 7) {
    let ok = true;
    for (let dy = -2; dy <= 2 && ok; dy++)
      for (let dx = -2; dx <= 3; dx++) {
        const k = i + dy * w.w + dx;
        if ((w.ground[k] !== 0 && w.ground[k] !== 4) || w.cover[k] !== 0 || w.depth[k] > 0.01 || Math.abs(w.height[k] - w.height[i]) > 0.6) ok = false;
      }
    if (ok) spot = i;
  }
  const cx = spot % w.w;
  const cy = Math.floor(spot / w.w);
  const lv = (k) => Math.round(w.height[k] * 0.5);
  w.setVoxel(cx, cy, lv(spot), 0x6f6e6a, 0);
  w.setVoxel(cx, cy, lv(spot) + 1, 0x8a8781, 0);
  w.setVoxel(cx + 1, cy, lv(spot + 1), 0xa5a199, 0);
  return { px, py, ambient: Number(w.ambient(top).toFixed(1)), height: Number(w.height[top].toFixed(1)), herd, cairn: { x: cx, y: cy } };
}

function herdNow(ids) {
  const w = window.__engine.world;
  return ids.map((id) => {
    const c = w.creatures.find((o) => o.id === id);
    if (!c) return null;
    const i = w.idx(c.x, c.y);
    return {
      chill: Number((c.chill ?? 0).toFixed(1)),
      height: Number(w.height[i].toFixed(1)),
      temp: Number(w.temp[i].toFixed(0)),
      frozen: c.frozen > 0,
      retreat: !!c.data.retreat,
      dead: c.dead,
    };
  });
}

function hoodSpot() {
  const w = window.__engine.world;
  const people = w.creatures.filter((c) => c.kind === "villager" && !c.dead);
  const cold = people.filter((c) => w.ambient(w.idx(c.homeX, c.homeY)) < 2);
  const c = cold[0] ?? people[0];
  return { x: c.x, y: c.y, id: c.id, cold: cold.length, people: people.length, homeAir: Number(w.ambient(w.idx(c.homeX, c.homeY)).toFixed(1)) };
}

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const report = {};
try {
  const ctx = await browser.newContext({ viewport: { width: 832, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  const open = async (biome) => {
    await page.goto(`${BASE}?size=medium&biome=${biome}&seed=7&dpr=1&quality=high`);
    await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
    await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
    await page.evaluate(() => (window.__engine.world.time = 100));
  };
  const shot = async (name, view, wait = 2500) => {
    await page.evaluate(aim, view);
    await page.waitForTimeout(wait);
    await page.evaluate(aim, view);
    await page.waitForTimeout(1500);
    writeFileSync(join(OUT, `${name}.png`), await page.screenshot({ type: "png", timeout: 240_000 }));
  };

  await open("tundra");
  const s = await page.evaluate(setUp);
  report.peak = s;
  report.herdStart = await page.evaluate(herdNow, s.herd);
  // The herd a few seconds on, from the side, where they are.
  const mid = await page.evaluate((ids) => {
    const w = window.__engine.world;
    const cs = ids.map((id) => w.creatures.find((o) => o.id === id)).filter(Boolean);
    return [cs.reduce((a, c) => a + c.x, 0) / cs.length, cs.reduce((a, c) => a + c.y, 0) / cs.length];
  }, s.herd);
  await shot("peak-herd", [mid[0], mid[1], 10, 1.0, 0.9], 2500);
  report.herdAtFrame = await page.evaluate(herdNow, s.herd);
  report.gameSeconds = await page.evaluate(() => window.__engine.world.time - 100);
  await shot("statue", [s.px + 0.5, s.py + 3.5, 7, 1.05, 0.4], 1000);
  await shot("cairn", [s.cairn.x + 1, s.cairn.y + 0.5, 6, 1.0, 0.7], 1000);
  const h = await page.evaluate(hoodSpot);
  report.hood = h;
  await shot("hood", [h.x, h.y, 6, 1.0, 0.5], 1500);
  await ctx.close();
} finally {
  await browser.close();
  stop();
}
writeFileSync(join(OUT, "cold-frames.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
process.exit(0);
