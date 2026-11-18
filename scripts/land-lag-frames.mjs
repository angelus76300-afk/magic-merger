// The land after a spell, in the browser (17 November, the owner: "the state calculations when a
// spell destroys land or starts fires takes a bit to appear and we have visible chunks"). The Perf
// Lab on high, frames played one at a time (no frame runs by itself, Math.random seeded): a spell
// breaks the land and lights a fire by a seeded island's middle, and for each frame after the cast
// it records when the land changed in the simulation, when each chunk of the fine land showed its
// new mesh, the view's time on the land (its "terrain" lap) and on the whole frame. It saves the
// frames from the cast until the land is drawn, and enlarged crops at the crater's edge (its east
// edge, where it meets the old land), so main and a branch can be compared side by side.
//
//   npx vite --port 5191 &
//   NODE_PATH=$(npm root -g) node scripts/land-lag-frames.mjs <out dir> [tag]
//   SIZE=344x882 LAB_URL=http://localhost:5191/lab/perf.html SPOT=96,64 EDGE=0 SPELL=blast ...
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "land-lag";
const TAG = process.argv[3] ?? "frames";
const BASE = process.env.LAB_URL ?? "http://localhost:5191/lab/perf.html";
const [W, H] = (process.env.SIZE ?? "700x830").split("x").map(Number);
const FRAMES = Number(process.env.FRAMES ?? 140);
const SHOTS = Number(process.env.SHOTS ?? 24);
// A blast of 7 cells and a fire beside it, as a Fireball's landing does (lab/spells/fireball.js);
// SPELL=blast for the blast alone (no flames over the crater's edge in the crops).
const CRATER =
  process.env.SPELL === "blast"
    ? "const spell = { *cast(w) { w.explode(w.x, w.y, 7, 1.6); } };"
    : "const spell = { *cast(w) { w.explode(w.x, w.y, 7, 1); w.ignite(w.x + 4, w.y + 2, 6, 0.7); } };";

const dir = join(OUT, `${W}x${H}`, TAG);
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => 0;
    let s = 12345;
    Math.random = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  });
  await page.goto(`${BASE}?size=medium&biome=temperate&shape=coast&seed=7&dpr=1&quality=high&time=40`);
  await page.waitForFunction(() => window.perfReady === true, null, { timeout: 180_000 });
  if (process.env.READY_FILE) writeFileSync(process.env.READY_FILE, "ready");
  await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
  // The spot: dry land nearest the island's middle (or SPOT=x,y, such as a corner of four chunks,
  // 32 cells a side), the camera at a mid zoom over it.
  const at = process.env.SPOT ? process.env.SPOT.split(",").map(Number) : null;
  const spot = await page.evaluate((at) => {
    const e = window.__engine;
    const w = e.world;
    let best = null;
    for (let y = 10; y < w.h - 10; y++)
      for (let x = 10; x < w.w - 10; x++) {
        let dry = 0;
        for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) if (w.fluid[(y + dy) * w.w + x + dx] === 0) dry++;
        const d = Math.hypot(x - w.w / 2, y - w.h / 2);
        if (dry === 289 && (!best || d < best.d)) best = { x: x + 0.5, y: y + 0.5, d };
      }
    if (at) best = { x: at[0] + 0.5, y: at[1] + 0.5, d: 0 };
    const o = e.view.orbit;
    o.tx = best.x;
    o.ty = best.y;
    o.dist = 34;
    o.phi = 0.95;
    o.theta = 0.6;
    for (let k = 0; k < 3; k++) e.render(1 / 60);
    e.view.terrain.updateFine(0, true);
    for (let k = 0; k < 20; k++) e.render(1 / 60);
    return best;
  }, at);
  // Where the crater's east edge is on the screen, for the crops.
  const edge = await page.evaluate(
    ({ spot, off }) => {
      const e = window.__engine;
      const w = e.world;
      const cam = e.view.orbit.camera;
      // EDGE=0: the crater's middle.
      const x = spot.x + off;
      const i = Math.floor(spot.y) * w.w + Math.floor(x);
      const p = new cam.position.constructor(x - w.w / 2, Math.round(w.height[i] * 0.5), spot.y - w.h / 2).project(cam);
      return { x: Math.round(((p.x + 1) / 2) * innerWidth), y: Math.round(((1 - p.y) / 2) * innerHeight) };
    },
    { spot, off: Number(process.env.EDGE ?? 7) },
  );
  const shot = async (name) => {
    writeFileSync(join(dir, `${name}.png`), await page.screenshot());
    const cw = 120;
    const ch = 90;
    const clip = { x: Math.max(0, Math.min(W - cw, edge.x - cw / 2)), y: Math.max(0, Math.min(H - ch, edge.y - ch / 2)), width: cw, height: ch };
    writeFileSync(join(dir, `${name}-edge.png`), await page.screenshot({ clip }));
  };
  await shot("before");
  const rows = await page.evaluate(
    ({ code, spot, frames }) => {
      const e = window.__engine;
      const w = e.world;
      const t = e.view.terrain;
      e.view.profile = {};
      const sum = () => {
        let s = 0;
        for (let i = 0; i < w.n; i++) s = (s * 31 + Math.round(w.height[i] * 8) + w.ground[i] * 7) | 0;
        return s;
      };
      e.cast({ key: "land-lag", name: "Crater", tier: "major", code }, spot.x, spot.y);
      const o = e.view.orbit;
      const hold = { tx: o.tx, ty: o.ty, dist: o.dist, phi: o.phi, theta: o.theta };
      window.__lag = { frame: 0, landSum: sum(), fine: t.fine.slice(), out: [], hold };
      return frames;
    },
    { code: CRATER, spot, frames: FRAMES },
  );
  void rows;
  const out = [];
  let shots = 0;
  let changedAt = -1;
  let lastShown = -1;
  for (let f = 0; f < FRAMES; f++) {
    const row = await page.evaluate((f) => {
      const e = window.__engine;
      const w = e.world;
      const t = e.view.terrain;
      const lag = window.__lag;
      // The simulation at 30 ticks a second, frames at 60.
      if (f % 2 === 0) e.step();
      let s = 0;
      for (let i = 0; i < w.n; i++) s = (s * 31 + Math.round(w.height[i] * 8) + w.ground[i] * 7) | 0;
      const landChanged = s !== lag.landSum;
      lag.landSum = s;
      e.view.profile = {};
      // The camera held where it was (a cast may move it), so the crops stay on the crater's edge.
      Object.assign(e.view.orbit, lag.hold);
      const t0 = performance.now();
      e.render(1 / 60);
      const ms = performance.now() - t0;
      const shown = [];
      for (let c = 0; c < t.fine.length; c++) if (t.fine[c] !== lag.fine[c]) shown.push(c);
      lag.fine = t.fine.slice();
      const p = e.view.profile;
      return { f, landChanged, shown, ms: Math.round(ms * 10) / 10, terrain: Math.round((p.terrain?.[0] ?? 0) * 10) / 10 };
    }, f);
    out.push(row);
    if (row.landChanged && changedAt < 0) changedAt = f;
    if (row.shown.length) lastShown = f;
    if (changedAt >= 0 && shots < SHOTS) {
      await shot(`f${String(f).padStart(3, "0")}`);
      shots++;
    }
  }
  await shot("after");
  const stats = await page.evaluate(() => {
    const t = window.__engine.view.terrain;
    return { fineStats: { maxTileMs: t.fineStats.maxTileMs, maxFrameMs: t.fineStats.maxFrameMs, tiles: t.fineStats.tiles }, redraw: t.redraw ?? null };
  });
  const changes = out.filter((r) => r.landChanged).map((r) => r.f);
  const shows = out.filter((r) => r.shown.length).map((r) => `${r.f}:[${r.shown.join(",")}]`);
  const after = out.filter((r) => r.f >= changedAt && r.f <= lastShown + 1);
  const summary = {
    size: `${W}x${H}`,
    tag: TAG,
    spot,
    landChangedAtFrames: changes,
    chunksShownAtFrames: shows,
    terrainMsMax: Math.max(...after.map((r) => r.terrain)),
    terrainMsMean: Math.round((after.reduce((a, r) => a + r.terrain, 0) / Math.max(1, after.length)) * 10) / 10,
    frameMsMax: Math.max(...after.map((r) => r.ms)),
    ...stats,
  };
  writeFileSync(join(dir, "frames.json"), JSON.stringify({ summary, frames: out }, null, 1));
  console.log(JSON.stringify(summary));
} finally {
  await browser.close();
}
