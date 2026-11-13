// The land's looks (5.2.5): the same views with the new looks off and on, for a before and after.
// The Perf Lab (lab/perf.html) on the medium island of seed 7, held still once the view is set.
// Views: a village on a hill, a beach under a cliff, the whole island, and a close shore with grass,
// sand and water. Frames are small JPEGs.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/terrain-frames.mjs <out dir> [390x844,344x882] [views]
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "frames";
const SIZES = (process.argv[3] ?? "390x844,344x882").split(",").map((s) => s.split("x").map(Number));
const ONLY = process.argv[4] ? new Set(process.argv[4].split(",")) : null;
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const OFF = "fine,steps,blend,grain,foam,bits,bands";
const SEED = Number(process.env.SEED ?? 7);
mkdirSync(OUT, { recursive: true });

// Finds the spots on the island, in the page.
function spots() {
  const e = window.__engine;
  const w = e.world;
  const at = (x, y) => y * w.w + x;
  const G = { GRASS: 0, SAND: 2 };
  const inside = (x, y) => x >= 0 && y >= 0 && x < w.w && y < w.h;
  const near = (x, y, r, f) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (inside(x + dx, y + dy) && f(at(x + dx, y + dy))) return true;
    return false;
  };
  const villages = [...w.villages].sort((a, b) => w.height[at(Math.round(b.x), Math.round(b.y))] - w.height[at(Math.round(a.x), Math.round(a.y))]);
  const v = villages[0];
  let beach = null;
  let shore = null;
  let best = -1;
  for (let y = 4; y < w.h - 4; y++)
    for (let x = 4; x < w.w - 4; x++) {
      const i = at(x, y);
      if (w.ground[i] !== G.SAND || w.fluid[i] !== 0) continue;
      if (!near(x, y, 2, (j) => w.fluid[j] === 1 && w.depth[j] > 0.3)) continue;
      let rise = 0;
      for (let dy = -5; dy <= 5; dy++)
        for (let dx = -5; dx <= 5; dx++) if (inside(x + dx, y + dy)) rise = Math.max(rise, w.height[at(x + dx, y + dy)] - w.height[i]);
      if (rise > best) {
        best = rise;
        beach = { x, y };
      }
      if (!shore && near(x, y, 3, (j) => w.ground[j] === G.GRASS && w.fluid[j] === 0) && Math.hypot(x - w.w / 2, y - w.h / 2) < w.w * 0.4) shore = { x, y };
    }
  return { village: v ? { x: v.x, y: v.y } : { x: w.w / 2, y: w.h / 2 }, beach: beach ?? { x: w.w / 2, y: w.h / 2 }, shore: shore ?? beach, side: w.w };
}

const VIEWS = {
  village: (s) => ({ tx: s.village.x, ty: s.village.y, dist: 26, phi: 0.95 }),
  beach: (s) => ({ tx: s.beach.x, ty: s.beach.y, dist: 24, phi: 1.05 }),
  island: (s) => ({ tx: s.side / 2, ty: s.side / 2, dist: s.side * 0.55, phi: 0.95 }),
  shore: (s) => ({ tx: s.shore.x, ty: s.shore.y, dist: 11, phi: 0.9 }),
};

let found = null;
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const [W, H] of SIZES) {
    for (const look of ["off", "on"]) {
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true });
      const page = await ctx.newPage();
      page.on("pageerror", (err) => console.error("page error:", err.message));
      await page.goto(`${BASE}?size=medium&seed=${SEED}&dpr=1${look === "off" ? `&off=${OFF}` : ""}`);
      await page.waitForFunction(() => window.perfReady === true, null, { timeout: 180_000 });
      await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
      // The spots once, on the first island shown (villagers move the village's middle).
      await page.waitForTimeout(3000);
      found ??= await page.evaluate(spots);
      const s = found;
      for (const [name, view] of Object.entries(VIEWS)) {
        if (ONLY && !ONLY.has(name)) continue;
        const v = view(s);
        await page.evaluate((v) => {
          const o = window.__engine.view.orbit;
          o.tx = v.tx;
          o.ty = v.ty;
          o.dist = v.dist;
          o.phi = v.phi;
          o.theta = Math.PI * 0.25;
        }, v);
        // Fine chunks are built one a frame: let them come.
        await page.waitForTimeout(4000);
        const file = join(OUT, `${name}-${W}x${H}-${look}.jpg`);
        await page.screenshot({ path: file, type: "jpeg", quality: 70 });
        console.log(file, JSON.stringify(s[name] ?? v));
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
