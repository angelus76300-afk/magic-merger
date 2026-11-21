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
// With SLOPE=<n> (the review of 21 November: footings hung over the land on a slope) it takes a
// spot whose cells' heights span about n instead of the flattest, and puts 48 on it, one every
// other cell: lone chapel cells (footings), "warding sigil" (rubble) and "hush" (stones) in turn.
// For each model drawn there it reads how far it hangs over the fine land drawn under it: its feet
// (the corners on its lowest level and those of any face looking down) less the lowest drawn top of
// the land's columns round each corner, and as the review read it, its lowest point less the lowest
// drawn top under its cell. It fails when one hangs more than HANG.
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
const SLOPE = Number(process.env.SLOPE ?? 0);
const HANG = 0.01;
mkdirSync(OUT, { recursive: true });

// In the page: an open, dry, grassy spot of 14 by 14 cells, cleared, then the leftovers on it.
function place(slope) {
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
          // On a slope, grass or dirt with what grows or lies on it (cleared below), not a house or a building.
          const busy = slope ? w.ground[k] > 1 || w.cover[k] === 4 || w.cover[k] >= 21 : w.ground[k] !== 0 || w.cover[k] >= 4;
          if (w.fluid[k] !== 0 || busy || w.onDeck(k)) {
            ok = false;
            break;
          }
          lo = Math.min(lo, w.height[k]);
          hi = Math.max(hi, w.height[k]);
        }
      if (!ok) continue;
      const score = slope ? Math.abs(hi - lo - slope) : hi - lo;
      if (!best || score < best.score) best = { x, y, score, span: hi - lo };
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
  const sigil = w.materials.find("warding sigil").id;
  const hush = w.materials.find("hush").id;
  if (slope) {
    const field = [];
    const site = [];
    for (let j = 0; j < 7; j++)
      for (let i = 0; i < 7; i++) {
        const n = j * 7 + i;
        if (n >= 48) continue;
        const k = (Y + j * 2) * w.w + X + i * 2;
        const kind = n % 3;
        w.setCover(k, kind === 0 ? 35 : kind === 1 ? sigil : hush);
        (kind === 0 ? site : field).push(k);
      }
    e.view.terrain.coversChanged = true;
    return { X, Y, field, site, span: best.span };
  }
  const field = [];
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

// In the page: how far each model drawn on the given cells hangs over the fine land drawn under it,
// by its look ("sp:footing", "sp:rubble", "heap" ...): the count drawn, the count hanging more than
// `hang`, the worst by its feet's corners and the worst as the review read it (its lowest point
// over the lowest drawn top under its cell).
function hangs([cells, hang]) {
  const e = window.__engine;
  const v = e.view;
  const w = e.world;
  const t = v.terrain;
  const want = new Set(cells);
  const m = new v.m.constructor();
  const top = (x, y) => {
    const h = t.drawnTop(x, y);
    return Number.isFinite(h) ? h : Infinity;
  };
  const out = {};
  for (const [key, mesh] of v.covers) {
    if (!mesh.count) continue;
    const pos = mesh.geometry.getAttribute("position");
    const idx = mesh.geometry.getIndex();
    const at = (k) => (idx ? idx.getX(k) : k);
    const tri = idx ? idx.count / 3 : pos.count / 3;
    let foot = Infinity;
    for (let k = 0; k < pos.count; k++) foot = Math.min(foot, pos.getY(k));
    // The model's feet, in its own frame.
    const feet = [];
    for (let n = 0; n < tri; n++) {
      const [a, b, c] = [at(n * 3), at(n * 3 + 1), at(n * 3 + 2)];
      const flat = Math.abs(pos.getY(a) - pos.getY(b)) < 1e-6 && Math.abs(pos.getY(a) - pos.getY(c)) < 1e-6;
      const ny = (pos.getZ(b) - pos.getZ(a)) * (pos.getX(c) - pos.getX(a)) - (pos.getX(b) - pos.getX(a)) * (pos.getZ(c) - pos.getZ(a));
      for (const k of [a, b, c]) if (Math.abs(pos.getY(k) - foot) < 1e-6 || (flat && ny < 0)) feet.push([pos.getX(k), pos.getY(k), pos.getZ(k)]);
    }
    const look = key.startsWith("sp:") ? key.split(":").slice(0, 2).join(":") : key.replace(/\d+$/, "");
    for (let k = 0; k < mesh.count; k++) {
      mesh.getMatrixAt(k, m);
      const el = m.elements;
      const ccx = el[0] * 0.5 + el[8] * 0.5 + el[12] + w.w / 2;
      const ccy = el[2] * 0.5 + el[10] * 0.5 + el[14] + w.h / 2;
      if (!want.has(Math.floor(ccy) * w.w + Math.floor(ccx))) continue;
      const r = (out[look] ??= { drawn: 0, hanging: 0, worst: -Infinity, cellWorst: -Infinity });
      r.drawn++;
      // As the review read it: its lowest point over the lowest drawn top under its cell.
      let low = Infinity;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) low = Math.min(low, top(Math.floor(ccx) + (i + 0.5) / 8, Math.floor(ccy) + (j + 0.5) / 8));
      const byCell = el[13] + foot * el[5] - low;
      // By its feet: each corner over the lowest drawn top of the land's columns round it.
      let worst = -Infinity;
      for (const [x, y, z] of feet) {
        const wx = el[0] * x + el[4] * y + el[8] * z + el[12] + w.w / 2;
        const wy = el[1] * x + el[5] * y + el[9] * z + el[13];
        const wz = el[2] * x + el[6] * y + el[10] * z + el[14] + w.h / 2;
        // On its cell's own edge, only the land inside the cell: a step down to the next cell is
        // the side of the land it stands on, not land it hangs over.
        const d = 1 / 16;
        const gx = Math.floor(ccx);
        const gz = Math.floor(ccy);
        const edge = (p, g) => Math.abs(p - g) < 1e-4 || Math.abs(p - g - 1) < 1e-4;
        const inside = (p, q, g) => !edge(p, g) || (q > g && q < g + 1);
        let land = Infinity;
        for (const sx of [-d, d])
          for (const sz of [-d, d]) if (inside(wx, wx + sx, gx) && inside(wz, wz + sz, gz)) land = Math.min(land, top(wx + sx, wz + sz));
        if (Number.isFinite(land)) worst = Math.max(worst, wy - land);
      }
      if (Math.max(worst, byCell) > hang) r.hanging++;
      r.worst = Math.max(r.worst, worst);
      r.cellWorst = Math.max(r.cellWorst, byCell);
    }
  }
  for (const r of Object.values(out)) {
    r.worst = Number(r.worst.toFixed(3));
    r.cellWorst = Number(r.cellWorst.toFixed(3));
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
  const spot = await page.evaluate(place, SLOPE);
  console.error(`spot ${spot.X},${spot.Y}${SLOPE ? `, heights spanning ${spot.span}` : ""}`);
  const views = SLOPE
    ? { slope: { tx: spot.X + 6, ty: spot.Y + 6, dist: 12, phi: 1.15, theta: 0.6 } }
    : {
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
  result = {
    quality: QUALITY,
    slope: SLOPE ? spot.span : 0,
    spot: { X: spot.X, Y: spot.Y },
    field: await page.evaluate(measure, spot.field),
    site: await page.evaluate(measure, spot.site),
    hangs: await page.evaluate(hangs, [[...spot.field, ...spot.site], HANG]),
  };
  await ctx.close();
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `no-grey-blocks-${TAG}.json`), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
const bad = [...result.field, ...result.site].filter((d) => d.levels < 3 || d.highest > 1 / 3);
for (const d of bad) console.error(`plain cube drawn: ${d.key} on ${d.cells} cells, ${d.levels} levels, highest ${d.highest} of its top`);
if (!result.field.length || !result.site.length) console.error("nothing drawn on the spot");
const hanging = Object.entries(result.hangs).filter(([, r]) => r.hanging);
for (const [look, r] of hanging) console.error(`hanging over the land: ${look}, ${r.hanging} of ${r.drawn}, up to ${Math.max(r.worst, r.cellWorst)}`);
if (bad.length || hanging.length || !result.field.length || !result.site.length) process.exit(1);
