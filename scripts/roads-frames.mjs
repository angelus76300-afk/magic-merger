// Dev only (4.9): frames of an island's roads after some simulated minutes,
// at a phone, a fold and a desktop, from the Perf Lab. Run against main and
// the branch (each its own vite) for before and after.
//
//   npx vite --port 5174 &
//   node scripts/roads-frames.mjs out-dir name "seed=11&size=large&mixed=1" minutes tx ty [dist]
//
// The island is stepped headless in the page (Engine.step) for `minutes`,
// then drawn looking at (tx, ty).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const base = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const [out, name, query, minutes = "10", tx = "100", ty = "100", dist = "0.3"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const SIZES = [
  ["390x844", 390, 844],
  ["832x1000", 832, 1000],
  ["1440x900", 1440, 900],
];
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
page.on("pageerror", (err) => console.error(name, "page error:", err.message));
await page.goto(`${base}?${query}&time=200`);
await page.waitForFunction(() => window.perfReady === true, null, { timeout: 180_000 });
const info = await page.evaluate(
  async ({ minutes }) => {
    const e = window.__engine;
    e.stop();
    const ticks = Math.round(minutes * 60 * 30);
    for (let t = 0; t < ticks; t++) {
      e.step();
      if (t % 3000 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    // Daylight for the picture, whatever time it reached.
    e.world.time = Math.floor(e.world.time / 240) * 240 + 250;
    e.start();
    const w = e.world;
    return {
      roads: (w.roads ?? []).map(
        (r) =>
          `${r.a} to ${r.b} (${r.cells.length}): ${r.cells[Math.floor(r.cells.length / 2)] % w.w},${Math.floor(r.cells[Math.floor(r.cells.length / 2)] / w.w)}`,
      ),
      villages: w.villages.map((v) => `${Math.round(v.x)},${Math.round(v.y)}`),
      bridges: [...(w.decks?.keys() ?? [])].map((i) => `${i % w.w},${Math.floor(i / w.w)}`),
    };
  },
  { minutes: Number(minutes) },
);
console.log(JSON.stringify(info));
// "bridge" for tx: look at the first bridge built, or else the middle of the first road.
let [ax, ay] = [Number(tx), Number(ty)];
if (tx === "bridge") [ax, ay] = (info.bridges[0] ?? info.roads[0]?.split(": ")[1] ?? "100,100").split(",").map(Number);
for (const [label, width, height] of SIZES) {
  await page.setViewportSize({ width, height });
  await page.evaluate(
    ({ tx, ty, dist }) => {
      const e = window.__engine;
      e.resize();
      e.view.orbit.tx = tx;
      e.view.orbit.ty = ty;
      e.view.orbit.dist = Math.max(e.world.w, e.world.h) * dist;
    },
    { tx: ax, ty: ay, dist: Number(dist) },
  );
  await page.evaluate(() => document.querySelectorAll("body > div").forEach((h) => (h.style.visibility = "hidden")));
  await page.waitForTimeout(Number(process.env.WAIT ?? 3000));
  await page.screenshot({ path: join(out, `${label}-${name}.png`) });
  console.log(label);
}
await browser.close();
