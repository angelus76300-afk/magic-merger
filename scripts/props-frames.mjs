// Things standing on the land, before and after they were drawn in small cubes (15 November, the
// owner's screenshots of the live game): rocks, shrubs, cacti, fire on burnt ground, crystals,
// clouds, a stored look of plain boxes and a wonder. Each item is set out on the same flat spot of
// the same island, the simulation held still, and framed close and mid from the same camera, on the
// high preset. The triangles of each frame, as the renderer counted them, go to frames.jsonl.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/props-frames.mjs <out dir> <tag> [700x830] [items]
import { createRequire } from "node:module";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "frames";
const TAG = process.argv[3] ?? "after";
const SIZES = (process.argv[4] ?? "700x830").split(",").map((s) => s.split("x").map(Number));
const ONLY = process.argv[5] ? new Set(process.argv[5].split(",")) : null;
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
mkdirSync(OUT, { recursive: true });

const ZOOMS = { close: { dist: 7, phi: 0.95 }, mid: { dist: 18, phi: 0.95 } };
const ITEMS = ["rocks", "shrubs", "cacti", "fire", "crystals", "boxes", "wonder", "clouds", "slope"];

// In the page: a flat dry spot of open grass, and the island's highest dry cell.
function spots() {
  const w = window.__engine.world;
  let best = null;
  let bestScore = Infinity;
  for (let y = 12; y < w.h - 12; y += 2)
    for (let x = 12; x < w.w - 12; x += 2) {
      let spread = 0;
      let bad = 0;
      const h0 = w.height[y * w.w + x];
      for (let dy = -5; dy <= 5; dy++)
        for (let dx = -6; dx <= 6; dx++) {
          const i = (y + dy) * w.w + x + dx;
          if (w.fluid[i] !== 0 || w.ground[i] !== 0 || w.cover[i] === 4) bad++;
          spread += Math.abs(w.height[i] - h0);
        }
      const score = spread + bad * 50;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  return best;
}

// In the page: sets out one item around (x, y) and keeps what it changed, to put back after.
function setOut({ item, x, y }) {
  const e = window.__engine;
  const w = e.world;
  const saved = [];
  const keep = (i) => saved.push([i, w.cover[i], w.ground[i], w.fire[i]]);
  const C = { BUSH: 2, STUMP: 7, BOULDER: 9, BERRIES: 12, CACTUS: 15, SCREE: 16, STONE: 18, CRYSTALS: 19, TREE: 1 };
  const G = { SAND: 2, ASH: 5 };
  const cells = [];
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      const i = (y + dy) * w.w + x + dx;
      cells.push({ i, dx, dy, h: ((dx * 73856093) ^ (dy * 19349663)) >>> 0 });
      keep(i);
      w.setCover(i, 0);
    }
  const put = (pick) => {
    for (const c of cells) {
      const v = pick(c);
      if (v != null) w.setCover(c.i, v);
    }
  };
  if (item === "rocks") put((c) => (c.h % 5 < 2 ? C.BOULDER : c.h % 11 === 3 ? C.SCREE : c.h % 13 === 5 ? C.STONE : null));
  if (item === "shrubs") put((c) => (c.h % 4 === 0 ? C.BUSH : c.h % 5 === 1 ? C.BERRIES : c.h % 7 === 2 ? C.BUSH : null));
  if (item === "cacti") {
    for (const c of cells) w.ground[c.i] = G.SAND;
    put((c) => (c.h % 4 === 1 ? C.CACTUS : null));
  }
  if (item === "crystals") put((c) => (c.h % 3 === 0 ? C.CRYSTALS : null));
  if (item === "fire") {
    for (const c of cells) {
      if (c.dx < 1) {
        w.ground[c.i] = G.ASH;
        if (c.h % 3 !== 2) w.setCover(c.i, C.STUMP);
      } else {
        w.setCover(c.i, c.h % 2 ? C.TREE : 0);
        w.fire[c.i] = c.dx < 3 ? 0.9 : 0.5;
      }
    }
  }
  if (item === "boxes") {
    // A stored look of plain boxes, as the bastion of the owner's screenshot: yellow wings, a red keep.
    const B = (bx, by, bz, bw, bd, bh, color) => ({ x: bx, y: by, z: bz, w: bw, d: bd, h: bh, color, glow: false });
    w.props.push({
      key: "lab-bastion",
      name: "Lab bastion",
      x,
      y,
      turn: 0.4,
      boxes: [
        B(-3, -1.5, 0, 2.2, 3, 0.7, 0xf2c94c),
        B(0.8, -1.5, 0, 2.2, 3, 0.7, 0xf2c94c),
        B(-0.9, -1.2, 0, 1.8, 2.4, 1.6, 0xa8241e),
        B(-0.6, -0.9, 1.6, 1.2, 1.8, 0.5, 0xb52a22),
        B(-2.6, 1.6, 0, 0.8, 0.8, 0.5, 0xe8b830),
        B(1.6, 1.6, 0, 0.8, 0.8, 0.5, 0xe8b830),
        B(-0.3, 1.5, 0, 0.6, 1.2, 0.9, 0x9c2018),
      ],
    });
    w.propsVersion++;
  }
  e.view.terrain.coversChanged = true;
  window.__saved = saved;
}

function putBack() {
  const e = window.__engine;
  const w = e.world;
  for (const [i, c, g, f] of window.__saved ?? []) {
    w.setCover(i, c);
    w.ground[i] = g;
    w.fire[i] = f;
  }
  const at = w.props.findIndex((p) => p.key === "lab-bastion");
  if (at >= 0) {
    w.props.splice(at, 1);
    w.propsVersion++;
  }
  e.view.terrain.coversChanged = true;
}

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const [W, H] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("page error:", err.message));
    await page.goto(`${BASE}?size=medium&biome=temperate&shape=coast&seed=7&dpr=1&quality=high&time=60`);
    await page.waitForFunction(() => window.perfReady === true, null, { timeout: 180_000 });
    await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
    await page.evaluate(() => window.__engine.stop());
    const spot = await page.evaluate(spots);
    // The renderer's own frames, the world held still; time moves a little for the flames.
    const draw = (n) =>
      page.evaluate((n) => {
        const e = window.__engine;
        for (let k = 0; k < n; k++) {
          e.world.time += 0.3;
          e.view.terrain.updateFine?.(0, true);
          e.render(1 / 30);
        }
      }, n);
    for (const item of ITEMS) {
      if (ONLY && !ONLY.has(item)) continue;
      let at = spot;
      if (item === "wonder") {
        const wd = await page.evaluate(() => {
          const w = window.__engine.world.wonders[0];
          return w ? { x: w.x, y: w.y } : null;
        });
        if (!wd) continue;
        at = wd;
      } else if (item === "slope") {
        // Boulders as the island has them, on its rocky ground, on a slope.
        at = await page.evaluate(() => {
          const w = window.__engine.world;
          let best = { x: w.w / 2, y: w.h / 2 };
          let most = -1;
          for (let y = 8; y < w.h - 8; y++)
            for (let x = 8; x < w.w - 8; x++) {
              let n = 0;
              for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (w.cover[(y + dy) * w.w + x + dx] === 9) n++;
              if (n > most) {
                most = n;
                best = { x, y };
              }
            }
          return best;
        });
      } else if (item !== "clouds") await page.evaluate(setOut, { item, x: spot.x, y: spot.y });
      for (const [zoom, z] of Object.entries(ZOOMS)) {
        if (item === "clouds" && zoom === "close") continue;
        await page.evaluate(
          ({ at, z, item }) => {
            const e = window.__engine;
            const o = e.view.orbit;
            const side = Math.max(e.world.w, e.world.h);
            o.tx = item === "clouds" ? side * 0.5 : at.x + 0.5;
            o.ty = item === "clouds" ? side * 0.5 : at.y + 0.5;
            o.dist = item === "clouds" ? side * 0.75 : z.dist;
            o.phi = item === "clouds" ? 1.25 : z.phi;
            o.theta = Math.PI * 0.25;
          },
          { at, z, item },
        );
        await draw(12);
        await page.waitForTimeout(300);
        await draw(2);
        const file = join(OUT, `${item}-${zoom}-${W}x${H}-${TAG}.jpg`);
        await page.screenshot({ path: file, type: "jpeg", quality: 70, timeout: 240_000 });
        const counts = await page.evaluate(() => window.__engine.view.counts());
        const props = await page.evaluate(() => {
          const v = window.__engine.view;
          const out = {};
          for (const [k, m] of v.covers ?? []) if (m.count) out[k] = { n: m.count, tris: (m.geometry.getAttribute("position").count / 3) * m.count };
          return out;
        });
        appendFileSync(join(OUT, `frames-${TAG}.jsonl`), JSON.stringify({ file, item, zoom, W, H, at, ...counts, covers: props }) + "\n");
        console.log(file, counts.triangles);
      }
      if (item !== "clouds" && item !== "wonder" && item !== "slope") await page.evaluate(putBack);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
