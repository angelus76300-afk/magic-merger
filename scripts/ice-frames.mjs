// Ice in eighths (20 November): the tundra island of seed 5 (scripts/lake-frames.mjs's cameras on
// its two lakes) after one minute of play, so the ice has grown from the shores, in the Perf Lab
// at 832 by 1000 (a foldable open), on high and on medium. Math.random is seeded in the page, so
// the same ice forms before and after a change to the drawing. Each frame also drawn without its
// water ("-nowater"). With BENCH=1, the frame's cost on high at lake1 (perfBench, 40 frames).
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/ice-frames.mjs <out dir> [tag]
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "ice-frames";
const TAG = process.argv[3] ?? "frame";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const QUALITIES = (process.env.QUALITIES ?? "high,medium").split(",");
const PLAY = Number(process.env.PLAY ?? 60);
const VIEWS = [
  ["lake0-look", 62.5, 35.5, 18, 0.75],
  ["lake0-low", 74.5, 33.5, 20, 1.2],
  ["lake1-look", 87.5, 100.5, 18, 0.75],
  ["lake1-low", 97.5, 96.5, 20, 1.2],
];
const SIZE = { width: 832, height: 1000 };
mkdirSync(OUT, { recursive: true });

// A seeded Math.random (mulberry32), before the page's scripts run.
function seeded() {
  let a = 20261120;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function frame(page, x, y, dist, phi) {
  return page.evaluate(
    async ({ x, y, dist, phi }) => {
      const e = window.__engine;
      const o = e.view.orbit;
      o.tx = x;
      o.ty = y;
      o.dist = dist;
      o.phi = phi;
      o.theta = 0.6;
      e.view.terrain.updateFine(0, true);
      e.render(0);
      e.view.terrain.updateFine(0, true);
      e.render(0);
      e.render(0);
      const png = document.getElementById("world").toDataURL("image/png");
      const fm = e.view.terrain.fluidMaterial;
      const hid = new Set();
      e.view.scene.traverse((m) => {
        if (m.isMesh && m.visible && m.material && (m.material === fm || m.material.transparent)) hid.add(m.material);
      });
      hid.forEach((m) => (m.visible = false));
      e.render(0);
      const dry = document.getElementById("world").toDataURL("image/png");
      hid.forEach((m) => (m.visible = true));
      return [png, dry];
    },
    { x, y, dist, phi },
  );
}

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const rows = [];
try {
  for (const quality of QUALITIES) {
    const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 });
    await ctx.addInitScript(seeded);
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("page error:", err.message));
    await page.goto(`${BASE}?size=medium&biome=tundra&shape=lakes&seed=5&dpr=1&quality=${quality}&time=60`);
    await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
    await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
    // One minute of play, a tick at a time, the land redrawn as the game does between frames.
    const ice = await page.evaluate(async (seconds) => {
      const e = window.__engine;
      e.stop();
      const w = e.world;
      const count = () => {
        let n = 0;
        for (let i = 0; i < w.n; i++) if (w.fluid[i] === 2 && w.depth[i] > 0.05) n++;
        return n;
      };
      const start = count();
      for (let t = 0; t < seconds * 30; t++) {
        e.step();
        if (t % 30 === 29) {
          e.render(0);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      return { start, after: count() };
    }, PLAY);
    console.log(quality, "ice cells", JSON.stringify(ice));
    for (const [shot, x, y, dist, phi] of VIEWS) {
      const [png, dry] = await frame(page, x, y, dist, phi);
      const file = join(OUT, `tundra-lakes-5-${shot}-${quality}-${TAG}.png`);
      const bytes = Buffer.from(png.split(",")[1], "base64");
      writeFileSync(file, bytes);
      writeFileSync(file.replace(".png", "-nowater.png"), Buffer.from(dry.split(",")[1], "base64"));
      rows.push({ quality, shot, ice, file, sha: createHash("sha256").update(bytes).digest("hex").slice(0, 16) });
      console.log(JSON.stringify(rows.at(-1)));
    }
    if (process.env.BENCH && quality === "high") {
      await page.evaluate(() => {
        const o = window.__engine.view.orbit;
        o.tx = 97.5;
        o.ty = 96.5;
        o.dist = 16;
        o.phi = 0.9;
        o.theta = 0.6;
        window.__engine.view.terrain.updateFine(0, true);
      });
      await page.waitForTimeout(1500);
      const bench = await page.evaluate(() => window.perfBench(40));
      rows.push({ quality, bench });
      console.log("bench", JSON.stringify(bench));
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `ice-${TAG}.json`), JSON.stringify(rows, null, 1));
