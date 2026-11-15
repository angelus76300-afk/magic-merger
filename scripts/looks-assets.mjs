// One close frame of each kind of thing on the island (15 November, the owner: "review all assets
// because even wonders and spells haven't adapted"): a wonder, stored spell looks of plain boxes,
// villagers, animals, shrubs and cacti, a lava pool. The Perf Lab on the high preset at 344 by
// 882, held still. Stored looks come from scripts/fixtures/looks-20.json, placed by the village.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/looks-assets.mjs <out dir> [tag]
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "assets";
const TAG = process.argv[3] ?? "frame";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const [W, H] = (process.env.SIZE ?? "344x882").split("x").map(Number);
mkdirSync(OUT, { recursive: true });

const hex = (c) => (typeof c === "string" ? parseInt(c.replace("#", ""), 16) : c);
const LOOKS = JSON.parse(readFileSync(new URL("./fixtures/looks-20.json", import.meta.url), "utf8"))
  .slice(0, 6)
  .map((l) => ({
    name: l.name,
    boxes: l.boxes.map((b) => ({ x: b[0], y: b[1], z: b[2], w: b[3], d: b[4], h: b[5], color: hex(b[6]), glow: b[7] === "glow" || b[7] === true })),
  }));

const SCENES = {
  wonder: { query: "biome=temperate&shape=coast&seed=7", find: "wonder" },
  looks: { query: "biome=temperate&shape=coast&seed=7", find: "looks" },
  villagers: { query: "biome=temperate&shape=coast&seed=7", find: "village" },
  animals: { query: "biome=temperate&shape=coast&seed=7", find: "animal" },
  cacti: { query: "biome=desert&shape=coast&seed=7", find: "cactus" },
  lava: { query: "biome=volcanic&shape=ridges&seed=11&peaks=1", find: "lava" },
};

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const [name, sc] of Object.entries(SCENES)) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("page error:", err.message));
    await page.goto(`${BASE}?size=medium&${sc.query}&dpr=1&quality=high&time=60&off=tilt`);
    await page.waitForFunction(() => window.perfReady === true, null, { timeout: 180_000 });
    await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
    const at = await page.evaluate(
      async ({ find, looks }) => {
        const e = window.__engine;
        const w = e.world;
        const v = [...w.villages][0] ?? { x: w.w / 2, y: w.h / 2 };
        let spot = { x: v.x, y: v.y, dist: 9 };
        if (find === "wonder" && w.wonders.length) spot = { x: w.wonders[0].x, y: w.wonders[0].y, dist: 14 };
        if (find === "looks") {
          w.props = looks.map((l, k) => ({
            key: `look${k}`,
            name: l.name,
            x: v.x - 4 + (k % 3) * 4,
            y: v.y + 3 + Math.floor(k / 3) * 4,
            turn: 0,
            boxes: l.boxes,
          }));
          w.propsVersion++;
          spot = { x: v.x, y: v.y + 5, dist: 13 };
        }
        if (find === "animal") {
          const a = w.creatures.find((c) => !c.dead && c.kind !== "villager" && c.kind !== "fish" && c.kind !== "bird");
          if (a) spot = { x: a.x, y: a.y, dist: 7 };
        }
        if (find === "cactus") {
          for (let i = 0; i < w.n; i++)
            if (w.cover[i] && w.materials.get("cover", w.cover[i]).name.includes("cact")) {
              spot = { x: i % w.w, y: Math.floor(i / w.w), dist: 7 };
              break;
            }
        }
        if (find === "lava") {
          for (let i = 0; i < w.n; i++)
            if (w.fluid[i] === 3) {
              spot = { x: i % w.w, y: Math.floor(i / w.w), dist: 12 };
              break;
            }
        }
        const o = e.view.orbit;
        o.tx = spot.x;
        o.ty = spot.y;
        o.dist = spot.dist;
        o.phi = 1.05;
        o.theta = Math.PI * 0.25;
        await new Promise((res) => setTimeout(res, 2500));
        e.view.terrain.updateFine?.(0, true);
        await new Promise((res) => setTimeout(res, 2500));
        return spot;
      },
      { find: sc.find, looks: LOOKS },
    );
    const file = join(OUT, `${name}-${TAG}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: 62, timeout: 240_000 });
    console.log(file, JSON.stringify(at));
    await ctx.close();
  }
} finally {
  await browser.close();
}
