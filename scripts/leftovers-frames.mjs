// What spells leave on the land (18 November, the owner on the Fold: "big plain untextured grey
// cubes and flat tinted slabs", the only things on the island not drawn in small textured cubes).
// The Perf Lab on the island of seed 7, at 700 by 830 (the Fold open), on high: on a stretch of
// open grass it puts what the library's spells leave: single stone voxels as Landslide drops them
// (#8a8580), a column of three as Final Incantation raises, and four covers a spell registers:
// Withering's "dry leaf", a green "moss carpet", Ragnarok's solid "silverroot" and a "mossy stone".
// Then it reads back what the view drew:
//   - spread: on the top faces of the voxel's model and of each spell cover's model, how far the
//     brightest and darkest colour are apart, over the brightest ((max - min) / max). A plain box
//     is 0. It fails under SPREAD.
//   - seat: for each voxel standing on the land, how far its foot is from the lowest top of the
//     fine land drawn under its cell (terrain.ts drawnTop). It fails over SEAT cells.
//   - frame time: perfBench's draw and raster, p50, with the leftovers in view.
// Crops of the spot go to <out dir>; ?cast=1 also casts Withering, Final Incantation and Landslide
// from lab/programs when they are there (they are not in the repository: pass LEFTOVER_CODE=<dir>).
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/leftovers-frames.mjs <out dir> [tag]
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "leftovers-frames";
const TAG = process.argv[3] ?? "frame";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const QUALITY = process.env.QUALITY ?? "high";
const SPREAD = 0.1;
const SEAT = 0.06;
mkdirSync(OUT, { recursive: true });
const CODE = process.env.LEFTOVER_CODE;
const casts = [];
if (CODE)
  for (const name of (process.env.CASTS ?? "Withering,Final Incantation,Landslide,Last Stand").split(",")) {
    const file = join(CODE, `${name}.js`);
    if (existsSync(file)) casts.push({ name, code: readFileSync(file, "utf8") });
  }

// In the page: an open, dry, grassy spot of 12 by 12 cells with a little slope, then the leftovers on it.
function place() {
  const e = window.__engine;
  const w = e.world;
  let best = null;
  for (let y = 10; y < w.h - 22; y += 2)
    for (let x = 10; x < w.w - 22; x += 2) {
      let ok = true;
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = 0; j < 12 && ok; j++)
        for (let i = 0; i < 12; i++) {
          const k = (y + j) * w.w + x + i;
          if (w.fluid[k] !== 0 || w.ground[k] !== 0 || w.cover[k] >= 4 || w.onDeck(k)) {
            ok = false;
            break;
          }
          lo = Math.min(lo, w.height[k]);
          hi = Math.max(hi, w.height[k]);
        }
      if (!ok) continue;
      // A little slope: the fine land then draws its steps between the cells' own levels.
      const score = Math.abs(hi - lo - 2.5);
      if (!best || score < best.score) best = { x, y, score, lo, hi };
    }
  const { x: X, y: Y } = best;
  // Cleared of its trees and flowers, so only the leftovers stand on it.
  for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) w.setCover((Y + j) * w.w + X + i, 0);
  // The covers, registered as a spell registers them (runtime.ts defineRules).
  e.runtime.defineRules(
    { key: "lab-leftovers", name: "Lab leftovers", tier: "minor", code: "" },
    {
      materials: [
        { name: "dry leaf", layer: "cover", colors: ["#8c8a80", "#7a7669"] },
        { name: "moss carpet", layer: "cover", colors: ["#4f7a3a", "#5e8c44"] },
        { name: "silverroot", layer: "cover", colors: ["#e6eef5", "#c9d6e0", "#f4f8fb"], solid: true },
        { name: "mossy stone", layer: "cover", colors: ["#7d8278", "#6a7064"], solid: true },
      ],
    },
  );
  const covers = [];
  const put = (name, cx, cy) => {
    const id = w.materials.find(name).id;
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) {
        w.setCover((cy + j) * w.w + cx + i, id);
        covers.push((cy + j) * w.w + cx + i);
      }
  };
  put("dry leaf", X + 1, Y + 7);
  put("moss carpet", X + 4, Y + 7);
  put("silverroot", X + 7, Y + 7);
  put("mossy stone", X + 9, Y + 9);
  // Voxels as Landslide and Final Incantation put them (runtime.ts voxel: z above the cell's land).
  const voxels = [];
  const vox = (cx, cy, z, color) => {
    const level = Math.round(w.height[cy * w.w + cx] * 0.5) + z;
    w.setVoxel(cx, cy, level, color, 0);
    voxels.push([cx, cy, level, z]);
  };
  for (const [dx, dy] of [
    [1, 1],
    [4, 1],
    [7, 2],
    [10, 1],
    [2, 4],
    [9, 4],
  ])
    vox(X + dx, Y + dy, 0, 0x8a8580);
  for (let z = 0; z < 3; z++) vox(X + 5, Y + 4, z, [0x8a8f96, 0xa9adb3, 0x6f747b][z]);
  e.view.terrain.coversChanged = true;
  return { X, Y, slope: best.hi - best.lo, voxels, covers };
}

// In the page, with STRESS=1: six towers of 5 by 5 by 12 voxels (1800, as a few Last Stands) next
// to the spot, for the frame time with many voxels in view.
function stress(spot) {
  const w = window.__engine.world;
  const steel = [0x8a8f99, 0xa7adb8, 0x6f747e];
  let n = 0;
  for (let t = 0; t < 6; t++) {
    const x0 = spot.X - 4 + (t % 3) * 7;
    const y0 = spot.Y - 8 + Math.floor(t / 3) * 7;
    const base = Math.round(w.height[y0 * w.w + x0] * 0.5);
    for (let z = 0; z < 12; z++)
      for (let j = 0; j < 5; j++)
        for (let i = 0; i < 5; i++) {
          w.setVoxel(x0 + i, y0 + j, base + z, steel[(i + j + z) % 3], 0);
          n++;
        }
  }
  return n;
}

// In the page: the spread of the top faces' colours of a geometry, and the voxels' feet.
function measure(spot) {
  const e = window.__engine;
  const v = e.view;
  const w = e.world;
  const spread = (geometry) => {
    const pos = geometry.getAttribute("position");
    const col = geometry.getAttribute("color");
    if (!pos || !col) return 0;
    let lo = Infinity;
    let hi = -Infinity;
    const idx = geometry.getIndex();
    const tri = idx ? idx.count / 3 : pos.count / 3;
    const at = (k) => (idx ? idx.getX(k) : k);
    for (let t = 0; t < tri; t++) {
      const [a, b, c] = [at(t * 3), at(t * 3 + 1), at(t * 3 + 2)];
      const e1 = [pos.getX(b) - pos.getX(a), pos.getY(b) - pos.getY(a), pos.getZ(b) - pos.getZ(a)];
      const e2 = [pos.getX(c) - pos.getX(a), pos.getY(c) - pos.getY(a), pos.getZ(c) - pos.getZ(a)];
      const ny = e1[2] * e2[0] - e1[0] * e2[2];
      const len = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], ny, e1[0] * e2[1] - e1[1] * e2[0]);
      if (len === 0 || Math.abs(ny / len) < 0.9) continue;
      for (const k of [a, b, c]) {
        const l = 0.299 * col.getX(k) + 0.587 * col.getY(k) + 0.114 * col.getZ(k);
        lo = Math.min(lo, l);
        hi = Math.max(hi, l);
      }
    }
    return hi > 0 ? Number(((hi - lo) / hi).toFixed(3)) : 0;
  };
  // The cover models drawn on the spot's spell covers: those not of the island's own.
  const builtin = w.materials.builtinCount ? w.materials.builtinCount("cover") : null;
  const coverKeys = [];
  for (const [key, mesh] of v.covers)
    if (mesh.count > 0 && (key === "block" || key === "slab" || key.startsWith("sp:"))) coverKeys.push([key, spread(mesh.geometry)]);
  // Each voxel's drawn foot: its instance's place, less half the model's height when it is centred.
  const decor = v.decorMesh;
  decor.geometry.computeBoundingBox();
  const box = decor.geometry.boundingBox;
  const m = new v.m.constructor();
  const feet = [];
  const want = new Set(spot.voxels.filter((p) => p[3] === 0).map((p) => `${p[0]},${p[1]}`));
  // The lowest instance in each of those cells: the voxel on the land.
  const lowest = new Map();
  for (let k = 0; k < decor.count; k++) {
    decor.getMatrixAt(k, m);
    const cx = Math.floor(m.elements[12] + w.w / 2);
    const cy = Math.floor(m.elements[14] + w.h / 2);
    const foot = m.elements[13] + box.min.y;
    const at = `${cx},${cy}`;
    if (want.has(at) && (lowest.get(at)?.foot ?? Infinity) > foot) lowest.set(at, { cx, cy, foot });
  }
  for (const { cx, cy, foot } of lowest.values()) {
    const level = Math.round(foot);
    // The lowest top of the fine land drawn under the cell, on its eighths.
    let low = Infinity;
    for (let j = 0; j < 8; j++)
      for (let i = 0; i < 8; i++) {
        const t = v.terrain.drawnTop(cx + (i + 0.5) / 8, cy + (j + 0.5) / 8);
        if (Number.isFinite(t)) low = Math.min(low, t);
      }
    if (!Number.isFinite(low)) low = Math.max(-20, Math.round(w.height[cy * w.w + cx] * 0.5));
    feet.push({ x: cx, y: cy, level, foot: Number(foot.toFixed(3)), land: Number(low.toFixed(3)), off: Number(Math.abs(foot - low).toFixed(3)) });
  }
  return { voxel: spread(decor.geometry), covers: coverKeys, feet, builtin, triangles: v.counts().triangles };
}

const aim = (a) => {
  const e = window.__engine;
  e.world.time = 100;
  const o = e.view.orbit;
  o.tx = a.X + 6;
  o.ty = a.Y + 6;
  o.dist = a.dist ?? 15;
  o.phi = a.phi ?? 0.9;
  o.theta = a.theta ?? 0.7;
};

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
let result;
try {
  const [vw, vh] = (process.env.VIEW ?? "700x830").split("x").map(Number);
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(`${BASE}?size=medium&biome=temperate&seed=7&dpr=1&quality=${QUALITY}`);
  await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
  await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
  const spot = await page.evaluate(place);
  console.error(`spot ${spot.X},${spot.Y}, slope ${spot.slope.toFixed(2)}`);
  for (const view of [{}, { dist: 7, phi: 1.05, theta: 0.5 }]) {
    await page.evaluate(aim, { ...spot, ...view });
    await page.waitForTimeout(2500);
    await page.evaluate(aim, { ...spot, ...view });
    await page.evaluate(() => window.__engine.view.terrain.updateFine(0, true));
    await page.waitForTimeout(2500);
  }
  await page.evaluate(aim, spot);
  await page.waitForTimeout(2500);
  const shot = async (name) => writeFileSync(join(OUT, `${name}-${TAG}.png`), await page.screenshot({ type: "png", timeout: 240_000 }));
  await shot("spot");
  await page.evaluate(aim, { ...spot, dist: 7, phi: 1.05, theta: 0.5 });
  await page.waitForTimeout(2500);
  await shot("close");
  const numbers = await page.evaluate(measure, spot);
  const many = process.env.STRESS ? await page.evaluate(stress, spot) : 0;
  await page.evaluate(aim, many ? { ...spot, dist: 26 } : spot);
  await page.waitForTimeout(2500);
  if (many) await shot("stress");
  const bench = { voxels: many, ...(await page.evaluate(() => window.perfBench(40))) };
  // The real spells, when their code was handed in: cast next to the spot.
  for (const [k, c] of casts.entries()) {
    await page.evaluate(
      ([s, k, c]) => window.__engine.cast({ key: c.name.toLowerCase(), name: c.name, tier: "major", code: c.code }, s.X + 3 + k * 4, s.Y + 13),
      [spot, k, c],
    );
    await page.waitForTimeout(Number(process.env.CAST_WAIT ?? 4000));
  }
  if (casts.length) {
    await page.evaluate(aim, { ...spot, Y: spot.Y + 6, dist: 16 });
    await page.waitForTimeout(3000);
    await shot("cast");
  }
  result = { quality: QUALITY, spot: { X: spot.X, Y: spot.Y, slope: spot.slope }, ...numbers, bench };
  await ctx.close();
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `leftovers-${TAG}.json`), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
const bad = [];
if (result.voxel < SPREAD) bad.push(`voxel top faces spread ${result.voxel} (at least ${SPREAD})`);
if (!result.covers.length) bad.push("no spell cover drawn");
for (const [key, s] of result.covers) if (s < SPREAD) bad.push(`cover ${key} top faces spread ${s} (at least ${SPREAD})`);
const worst = Math.max(0, ...result.feet.map((f) => f.off));
if (!result.feet.length) bad.push("no voxel on the land found");
if (worst > SEAT) bad.push(`a voxel's foot is ${worst} from the land drawn under it (at most ${SEAT})`);
if (bad.length) {
  for (const b of bad) console.error(b);
  process.exit(1);
}
