// No plain grey cubes on the land (21 November, the owner on a temperate grassland far from the
// villages: "what are those big grey blocks?"). The Perf Lab on the island of seed 7, at 832 by 1000
// (a foldable open), on high. On a stretch of open grass it puts:
//   - field: a spell's covers whose names say no rock, crystal, litter or plant ("warding sigil",
//     solid, light grey, and "hush", not solid), one every three cells, as a spell scatters them;
//   - site: a building site of which one cell was taken (not drawn whole by buildings.ts), a smithy
//     the same, and a lone "chapel" cell, as a spell's w.place("chapel") leaves one.
// Then it reads back the models the view drew on those cells, and for each the levels of the faces
// looking up (in cubes) and the share of its top the highest covers: a plain cube is one or two
// levels, its highest most of its top. It fails when one drawn there is.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/no-grey-blocks-frames.mjs <out dir> [tag]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "no-grey-blocks-frames";
const TAG = process.argv[3] ?? "frame";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const QUALITY = process.env.QUALITY ?? "high";
mkdirSync(OUT, { recursive: true });

// In the page: an open, dry, grassy spot of 14 by 14 cells, cleared, then the leftovers on it.
function place() {
  const e = window.__engine;
  const w = e.world;
  let best = null;
  for (let y = 10; y < w.h - 24; y += 2)
    for (let x = 10; x < w.w - 24; x += 2) {
      let ok = true;
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = 0; j < 14 && ok; j++)
        for (let i = 0; i < 14; i++) {
          const k = (y + j) * w.w + x + i;
          if (w.fluid[k] !== 0 || w.ground[k] !== 0 || w.cover[k] >= 4 || w.onDeck(k)) {
            ok = false;
            break;
          }
          lo = Math.min(lo, w.height[k]);
          hi = Math.max(hi, w.height[k]);
        }
      if (!ok) continue;
      const score = hi - lo;
      if (!best || score < best.score) best = { x, y, score };
    }
  const { x: X, y: Y } = best;
  for (let j = 0; j < 14; j++) for (let i = 0; i < 14; i++) w.setCover((Y + j) * w.w + X + i, 0);
  e.runtime.defineRules(
    { key: "lab-grey", name: "Lab grey", tier: "minor", code: "" },
    {
      materials: [
        { name: "warding sigil", layer: "cover", colors: ["#c8c8cc", "#b9b9be"], solid: true },
        { name: "hush", layer: "cover", colors: ["#d0ccc4"] },
      ],
    },
  );
  const field = [];
  const sigil = w.materials.find("warding sigil").id;
  const hush = w.materials.find("hush").id;
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++) {
      const k = (Y + 1 + j * 3) * w.w + X + 1 + i * 3;
      w.setCover(k, (i + j) % 4 === 3 ? hush : sigil);
      field.push(k);
    }
  // Off the field, to its side: a site and a smithy each missing a cell, and a lone chapel cell.
  const site = [];
  const ids = { site: 40, smithy: 29, chapel: 35 };
  const two = (cx, cy, id, skip) => {
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) {
        if (i * 2 + j === skip) continue;
        const k = (cy + j) * w.w + cx + i;
        w.setCover(k, id);
        site.push(k);
      }
  };
  two(X + 2, Y + 12, ids.site, 3);
  two(X + 6, Y + 12, ids.smithy, 0);
  w.setCover((Y + 12) * w.w + X + 11, ids.chapel);
  site.push((Y + 12) * w.w + X + 11);
  e.view.terrain.coversChanged = true;
  return { X, Y, field, site };
}

// In the page: the cover meshes with an instance on the given cells, and the shape of each.
function measure(cells) {
  const e = window.__engine;
  const v = e.view;
  const w = e.world;
  const want = new Set(cells);
  const m = new v.m.constructor();
  const levels = (geometry) => {
    const pos = geometry.getAttribute("position");
    const idx = geometry.getIndex();
    const tri = idx ? idx.count / 3 : pos.count / 3;
    const at = (k) => (idx ? idx.getX(k) : k);
    const area = new Map();
    let lo = Infinity;
    for (let k = 0; k < pos.count; k++) lo = Math.min(lo, pos.getY(k));
    for (let t = 0; t < tri; t++) {
      const [a, b, c] = [at(t * 3), at(t * 3 + 1), at(t * 3 + 2)];
      if (Math.abs(pos.getY(a) - pos.getY(b)) > 1e-5 || Math.abs(pos.getY(a) - pos.getY(c)) > 1e-5) continue;
      // The y of the face's normal (e1 x e2): up when over 0.
      const ny = ((pos.getZ(b) - pos.getZ(a)) * (pos.getX(c) - pos.getX(a)) - (pos.getX(b) - pos.getX(a)) * (pos.getZ(c) - pos.getZ(a))) / 2;
      if (ny <= 1e-9) continue;
      const y = Math.round(pos.getY(a) * 8) / 8;
      if (y <= 0) continue;
      area.set(y, (area.get(y) ?? 0) + ny);
    }
    const ys = [...area.keys()];
    const top = Math.max(...ys);
    const total = [...area.values()].reduce((x, y) => x + y, 0);
    return { levels: ys.length, highest: Number((area.get(top) / total).toFixed(2)), top, foot: Number(lo.toFixed(2)) };
  };
  const out = [];
  for (const [key, mesh] of v.covers) {
    let n = 0;
    for (let k = 0; k < mesh.count; k++) {
      mesh.getMatrixAt(k, m);
      // The model's middle (0.5, 0, 0.5 in its own frame), wherever its turn put its corner.
      const el = m.elements;
      const cx = Math.floor(el[0] * 0.5 + el[8] * 0.5 + el[12] + w.w / 2);
      const cy = Math.floor(el[2] * 0.5 + el[10] * 0.5 + el[14] + w.h / 2);
      if (want.has(cy * w.w + cx)) n++;
    }
    if (n) out.push({ key, cells: n, ...levels(mesh.geometry) });
  }
  return out;
}

const aim = (a) => {
  const e = window.__engine;
  e.world.time = 100;
  const o = e.view.orbit;
  o.tx = a.tx;
  o.ty = a.ty;
  o.dist = a.dist;
  o.phi = a.phi ?? 0.95;
  o.theta = a.theta ?? 0.6;
};

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
let result;
try {
  const [vw, vh] = (process.env.VIEW ?? "832x1000").split("x").map(Number);
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(`${BASE}?size=medium&biome=temperate&seed=7&dpr=1&quality=${QUALITY}`);
  await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
  await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
  const spot = await page.evaluate(place);
  console.error(`spot ${spot.X},${spot.Y}`);
  const views = {
    field: { tx: spot.X + 6, ty: spot.Y + 6, dist: 13 },
    site: { tx: spot.X + 7, ty: spot.Y + 12, dist: 8, phi: 1.0, theta: 0.5 + Math.PI },
  };
  for (const [name, view] of Object.entries(views)) {
    await page.evaluate(aim, view);
    await page.waitForTimeout(2500);
    await page.evaluate(aim, view);
    await page.evaluate(() => window.__engine.view.terrain.updateFine(0, true));
    await page.waitForTimeout(3000);
    writeFileSync(join(OUT, `${name}-${TAG}.png`), await page.screenshot({ type: "png", timeout: 240_000 }));
  }
  result = { quality: QUALITY, spot: { X: spot.X, Y: spot.Y }, field: await page.evaluate(measure, spot.field), site: await page.evaluate(measure, spot.site) };
  await ctx.close();
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `no-grey-blocks-${TAG}.json`), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
const bad = [...result.field, ...result.site].filter((d) => d.levels < 3 || d.highest > 1 / 3);
for (const d of bad) console.error(`plain cube drawn: ${d.key} on ${d.cells} cells, ${d.levels} levels, highest ${d.highest} of its top`);
if (!result.field.length || !result.site.length) console.error("nothing drawn on the spot");
if (bad.length || !result.field.length || !result.site.length) process.exit(1);
