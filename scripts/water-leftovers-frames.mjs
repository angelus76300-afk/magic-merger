// Water leftovers (20 November): three frames in the Perf Lab at 832 by 1000 (a foldable open), on
// high, the same before and after a change. Math.random is seeded in the page.
//   ice:  the tundra island of seed 5 after one minute of play, its lake by the houses (lake0 of
//         scripts/ice-frames.mjs): strips of grass rose through thin shore ice.
//   feet: a villager stood at a dry shore, on the column nearest the water drawn over a dry cell
//         (the temperate lake island of seed 7): feet dipped under the water there.
//   edge: the sea at the island's south rim (the same island), where the water is cut down to its
//         bed: its side drew a bright line along the rim.
// SHOTS=ice,feet,edge draws only those. CAM="query|x,y,dist,phi" draws one free frame instead.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/water-leftovers-frames.mjs <out dir> [tag]
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "water-leftovers-frames";
const TAG = process.argv[3] ?? "frame";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const SHOTS = (process.env.SHOTS ?? "ice,feet,edge").split(",");
const SIZE = { width: 832, height: 1000 };
mkdirSync(OUT, { recursive: true });

// [shot, island query, seconds of play, camera x, y, distance, angle from straight down, turn].
const VIEWS = [
  ["ice", "biome=tundra&shape=lakes&seed=5", 60, 62.5, 35.5, 18, 0.75, 0.6],
  ["feet", "biome=temperate&shape=lakes&seed=7", 0, 63.08, 84.5, 9, 0.95, 2.6],
  ["edge", "biome=temperate&shape=lakes&seed=7", 0, 86.5, 147.5, 12, 1.1, 0.6],
];

function seeded() {
  let a = 20261120;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A villager at (x, y): on the temperate island's big lake, the dry cell (63, 84), whose land lies
// half a voxel under the water beside it, at the column nearest that water. Ticked a few times in
// place so it is drawn there, then the sim stopped.
function placeFeet(at) {
  const e = window.__engine;
  const w = e.world;
  e.stop();
  const v = w.creatures.find((c) => !c.dead && c.kind === "villager") ?? w.creatures.find((c) => !c.dead);
  if (!v) return null;
  const put = () => {
    v.x = at.x;
    v.y = at.y;
    v.z = 0;
    v.vx = v.vy = v.vz = 0;
    v.sp = 0;
  };
  for (let k = 0; k < 3; k++) {
    put();
    e.step();
  }
  put();
  return { ...at, kind: v.kind };
}

async function frame(page, x, y, dist, phi, theta) {
  return page.evaluate(
    async ({ x, y, dist, phi, theta }) => {
      const e = window.__engine;
      const o = e.view.orbit;
      o.tx = x;
      o.ty = y;
      o.dist = dist;
      o.phi = phi;
      o.theta = theta;
      // The camera eases to its place by the time drawn: a few seconds of frames, the sim stopped.
      e.stop();
      for (let k = 0; k < 60; k++) {
        if (k % 20 === 0) e.view.terrain.updateFine(0, true);
        e.render(0.1);
      }
      e.view.terrain.updateFine(0, true);
      e.render(0);
      return document.getElementById("world").toDataURL("image/png");
    },
    { x, y, dist, phi, theta },
  );
}

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const rows = [];
try {
  const views = process.env.CAM
    ? [["cam", process.env.CAM.split("|")[0], Number(process.env.PLAY ?? 0), ...process.env.CAM.split("|")[1].split(",").map(Number)]]
    : VIEWS.filter(([shot]) => SHOTS.includes(shot));
  for (const [shot, query, play, x0, y0, dist, phi, theta = 0.6] of views) {
    const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 });
    await ctx.addInitScript(seeded);
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("page error:", err.message));
    await page.goto(`${BASE}?size=medium&${query}&dpr=1&quality=high&time=60`);
    await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
    await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
    // Play, a tick at a time, the land redrawn as the game does between frames.
    await page.evaluate(async (seconds) => {
      const e = window.__engine;
      e.stop();
      for (let t = 0; t < seconds * 30; t++) {
        e.step();
        if (t % 30 === 29) {
          e.render(0);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }, play);
    const x = x0;
    const y = y0;
    const at = shot === "feet" ? await page.evaluate(placeFeet, { x, y }) : null;
    const png = await frame(page, x, y, dist, phi, theta);
    const file = join(OUT, `${shot}-${TAG}.png`);
    const bytes = Buffer.from(png.split(",")[1], "base64");
    writeFileSync(file, bytes);
    rows.push({ shot, query, x, y, at, file, sha: createHash("sha256").update(bytes).digest("hex").slice(0, 16) });
    console.log(JSON.stringify(rows.at(-1)));
    await ctx.close();
  }
} finally {
  await browser.close();
}
