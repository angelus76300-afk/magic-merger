// Lava (18 November, the owner on the Fold: the volcano's lava "looks like a flat bright orange
// sticker", no shading, no texture, no motion). The Perf Lab at 700 by 830 (the Fold open; W, H), on
// high (QUALITY=medium for medium): the volcano's crater of a volcanic island, and a flood of lava
// cast on the grass of seed 7 (the threat spell of check.ts, as the library's lava spells pour it),
// each by day and at night. For each it reads the pixels over the lava's cells (sixteen points a
// cell, on cells three from the shore, projected through the camera) in two frames three seconds apart:
//   - spread: the standard deviation of their brightness (0 to 1). One flat colour is about 0.
//     It fails under SPREAD.
//   - motion: the mean change of their brightness between the two frames. A still pool is 0.
//     It fails under MOTION.
// Both are judged on the volcano only (SCENES, judged). The spell's lava is cast again for each
// shot: it cools to basalt in half a minute.
//   - frame time: perfBench's draw and raster, p50, with the volcano's lava in view.
// Crops round the lava go to <out dir>.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/lava-frames.mjs <out dir> [tag]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "lava-frames";
const TAG = process.argv[3] ?? "frame";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const QUALITY = process.env.QUALITY ?? "high";
const SPREAD = 0.06;
const MOTION = 0.01;
const W = Number(process.env.W ?? 700);
const H = Number(process.env.H ?? 830);
mkdirSync(OUT, { recursive: true });

const TIMES = { day: 60, night: 264 };
// `judged`: the volcano's pool is what the checks hold. A spell's fresh lava spreads, cools to
// basalt and burns the trees round it, so its pixels vary and change on main too: its numbers and
// crops are reported, not judged.
const SCENES = [
  { name: "volcano", q: "biome=volcanic&seed=3", cast: false, dist: 30, judged: true },
  { name: "spell", q: "biome=temperate&shape=coast&seed=7", cast: true, dist: 22, judged: false },
];
const LAVA_CODE = `const spell = { *cast(w) { const R = 8; w.flood(w.x, w.y, R, "lava", 1.4); yield 1.5; w.flood(w.x, w.y, R * 0.7, "lava", 1); } };`;

// In the page: the middle of the largest lump of lava, as cell coordinates.
function lavaSpot() {
  const w = window.__engine.world;
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 1; y < w.h - 1; y++)
    for (let x = 1; x < w.w - 1; x++) {
      if (w.fluid[y * w.w + x] !== 3) continue;
      n++;
      sx += x;
      sy += y;
    }
  return n ? { x: sx / n + 0.5, y: sy / n + 0.5, n } : null;
}

// In the page: an open dry spot of grass near the middle, for the cast.
function grassSpot() {
  const w = window.__engine.world;
  let best = null;
  for (let y = 12; y < w.h - 12; y++)
    for (let x = 12; x < w.w - 12; x++) {
      let ok = true;
      for (let dy = -7; dy <= 7 && ok; dy++)
        for (let dx = -7; dx <= 7 && ok; dx++) {
          const k = (y + dy) * w.w + x + dx;
          if (w.fluid[k] !== 0 || w.ground[k] !== 0 || w.cover[k] >= 4 || w.onDeck(k)) ok = false;
        }
      if (!ok) continue;
      const d = Math.hypot(x - w.w / 2, y - w.h / 2);
      if (!best || d < best.d) best = { x: x + 0.5, y: y + 0.5, d };
    }
  return best;
}

// In the page: the screen points over lava three cells from any shore (sixteen a cell), and the lava's box on screen.
function lavaPoints() {
  const e = window.__engine;
  const w = e.world;
  const v = e.view;
  const cam = v.orbit.camera;
  cam.updateMatrixWorld();
  const level = v.terrain.fluidLevel;
  const pts = [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const lava = (x, y) => w.fluid[y * w.w + x] === 3;
  const GRID = [];
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) GRID.push([0.125 + a * 0.25, 0.125 + b * 0.25]);
  for (let y = 1; y < w.h - 1; y++)
    for (let x = 1; x < w.w - 1; x++) {
      // Three cells in from the shore, so the crater's near wall hides none of them.
      let inside = true;
      for (let dy = -3; dy <= 3 && inside; dy++)
        for (let dx = -3; dx <= 3 && inside; dx++) inside = lava(Math.min(w.w - 1, Math.max(0, x + dx)), Math.min(w.h - 1, Math.max(0, y + dy)));
      if (!inside) continue;
      const top = level[y * w.w + x];
      if (!(top > -1e8)) continue;
      for (const [u, t] of GRID) {
        const p = v
          .toScene(x + u, y + t, top)
          .clone()
          .project(cam);
        if (p.z > 1 || Math.abs(p.x) > 0.98 || Math.abs(p.y) > 0.98) continue;
        const px = Math.round(((p.x + 1) / 2) * innerWidth);
        const py = Math.round(((1 - p.y) / 2) * innerHeight);
        pts.push([px, py]);
        x0 = Math.min(x0, px);
        y0 = Math.min(y0, py);
        x1 = Math.max(x1, px);
        y1 = Math.max(y1, py);
      }
    }
  return { pts, box: [x0, y0, x1, y1] };
}

async function pixelsOf(page, png) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(0, 0, c.width, c.height).data);
  }, png.toString("base64"));
}

async function crop(page, png, box, file) {
  const data = await page.evaluate(
    async ([b64, box]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const cx = (box[0] + box[2]) / 2;
      const cy = (box[1] + box[3]) / 2;
      const cw = 360;
      const ch = 280;
      const x = Math.max(0, Math.min(img.width - cw, Math.round(cx - cw / 2)));
      const y = Math.max(0, Math.min(img.height - ch, Math.round(cy - ch / 2)));
      const c = document.createElement("canvas");
      c.width = cw;
      c.height = ch;
      c.getContext("2d").drawImage(img, x, y, cw, ch, 0, 0, cw, ch);
      return c.toDataURL("image/jpeg", 0.8).split(",")[1];
    },
    [png.toString("base64"), box],
  );
  writeFileSync(file, Buffer.from(data, "base64"));
}

const luma = (px, x, y) => {
  const i = (y * W + x) * 4;
  return (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
};

const results = [];
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const s of SCENES) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("page error:", err.message));
    await page.goto(`${BASE}?size=medium&${s.q}&dpr=1&quality=${QUALITY}&time=60`);
    await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
    await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
    const g = s.cast ? await page.evaluate(grassSpot) : null;
    if (s.cast && !g) throw new Error("no open grass for the cast");
    for (const [when, time] of Object.entries(TIMES)) {
      // Spell lava cools to basalt within half a minute: cast it again for each shot.
      if (g) {
        await page.evaluate(
          ([g, code]) => window.__engine.cast({ key: "lava flood", name: "Lava Flood", tier: "major", code }, g.x + 0.01 * Math.random(), g.y),
          [g, LAVA_CODE],
        );
        await page.waitForTimeout(2500);
      }
      const spot = await page.evaluate(lavaSpot);
      if (!spot) throw new Error(`${s.name}: no lava on the island`);
      const aim = ([spot, time, dist]) => {
        const e = window.__engine;
        e.world.time = time;
        const o = e.view.orbit;
        o.tx = spot.x;
        o.ty = spot.y;
        o.dist = dist;
        o.phi = 0.9;
        o.theta = Math.PI * 0.25;
      };
      await page.evaluate(aim, [spot, time, s.dist]);
      await page.waitForTimeout(s.cast ? 1500 : 3000);
      await page.evaluate(aim, [spot, time, s.dist]);
      await page.evaluate(() => window.__engine.view.terrain.updateFine(0, true));
      await page.waitForTimeout(s.cast ? 1000 : 2000);
      const { pts, box } = await page.evaluate(lavaPoints);
      const a = await page.screenshot({ type: "png", timeout: 240_000 });
      await page.waitForTimeout(3000);
      const b = await page.screenshot({ type: "png", timeout: 240_000 });
      const pa = await pixelsOf(page, a);
      const pb = await pixelsOf(page, b);
      let sum = 0;
      let sq = 0;
      let moved = 0;
      for (const [x, y] of pts) {
        const l = luma(pa, x, y);
        sum += l;
        sq += l * l;
        moved += Math.abs(l - luma(pb, x, y));
      }
      const n = Math.max(1, pts.length);
      const mean = sum / n;
      const spread = Math.sqrt(Math.max(0, sq / n - mean * mean));
      const motion = moved / n;
      await crop(page, a, box, join(OUT, `${s.name}-${when}-${TAG}.jpg`));
      if (process.env.DEBUG) {
        writeFileSync(join(OUT, `${s.name}-${when}-${TAG}.png`), a);
        writeFileSync(join(OUT, `${s.name}-${when}-${TAG}-points.json`), JSON.stringify(pts));
      }
      const r = { scene: s.name, when, judged: s.judged, points: pts.length, mean: +mean.toFixed(3), spread: +spread.toFixed(3), motion: +motion.toFixed(4) };
      console.log(JSON.stringify(r));
      results.push(r);
    }
    if (s.name === "volcano") {
      const bench = await page.evaluate(() => window.perfBench(40));
      results.push({ scene: s.name, bench });
      console.log(JSON.stringify({ bench }));
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `numbers-${TAG}.json`), JSON.stringify({ quality: QUALITY, spreadLimit: SPREAD, motionLimit: MOTION, results }, null, 2) + "\n");
let bad = 0;
for (const r of results) {
  if (!r.judged) continue;
  if (r.points < 100) {
    console.error(`${r.scene} ${r.when}: only ${r.points} lava points, the camera missed the lava`);
    bad++;
  } else if (r.spread < SPREAD) {
    console.error(`${r.scene} ${r.when}: lava brightness spread ${r.spread} under ${SPREAD}: a flat sticker`);
    bad++;
  } else if (r.motion < MOTION) {
    console.error(`${r.scene} ${r.when}: lava changed ${r.motion} in three seconds, under ${MOTION}: still`);
    bad++;
  }
}
if (bad) process.exit(1);
