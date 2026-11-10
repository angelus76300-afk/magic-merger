// Dev only (4.9 part 2): frames of building sites, at a phone, the owner's
// Z Fold folded and unfolded, a fold and a desktop, from the Perf Lab.
//
//   npx vite --port 5174 &
//   node scripts/sites-frames.mjs out-dir "seed=11&size=large&mixed=1" [maxMinutes]
//
// 1. "real": the island is stepped headless (Engine.step) until one of its
//    villages has a site at the frame stage or later, then drawn close up.
// The engine stays stopped: nothing moves on while the frames are taken.
// 2. "stages": four sites put by this script beside a village of the same
//    island, one at each stage (stakes top left, walls bottom right).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const base = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const [out, query, maxMinutes = "12"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const SIZES = [
  ["390x844", 390, 844],
  ["344x882", 344, 882],
  ["700x830", 700, 830],
  ["832x1000", 832, 1000],
  ["1440x900", 1440, 900],
];
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
page.on("pageerror", (err) => console.error("page error:", err.message));
await page.goto(`${base}?${query}&time=200`);
await page.waitForFunction(() => window.perfReady === true, null, { timeout: 180_000 });
const found = await page.evaluate(
  async ({ maxMinutes }) => {
    const e = window.__engine;
    e.stop();
    const w = e.world;
    let site = null;
    for (let t = 0; t < maxMinutes * 1800 && !site; t++) {
      e.step();
      if (t % 30 === 0) site = w.sites.find((s) => s.work >= 16 && s.kind === 4) ?? null;
      if (t % 3000 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    // Daylight for the picture.
    w.time = Math.ceil(w.time / 360) * 360 + 150;
    return site ? { x: site.i % w.w, y: Math.floor(site.i / w.w), work: site.work, minutes: (w.tick / 1800).toFixed(1) } : null;
  },
  { maxMinutes: Number(maxMinutes) },
);
console.log("real site", JSON.stringify(found));

async function frames(name, tx, ty, dist) {
  for (const [label, width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.evaluate(
      ({ tx, ty, dist }) => {
        const e = window.__engine;
        e.resize();
        e.view.orbit.tx = tx;
        e.view.orbit.ty = ty;
        e.view.orbit.dist = dist;
        // Stopped, so nobody works on the sites: drawn by hand until every
        // chunk is built.
        for (let n = 0; n < 80; n++) e.render();
      },
      { tx, ty, dist },
    );
    await page.evaluate(() => document.querySelectorAll("body > div").forEach((h) => (h.style.visibility = "hidden")));
    await page.waitForTimeout(Number(process.env.WAIT ?? 2500));
    await page.screenshot({ path: join(out, `${label}-${name}.png`) });
  }
  console.log(name);
}
if (found) {
  await frames("real", found.x + 1, found.y + 1, 20);
}

// The lineup: four sites in a row near the first village, stages 0 to 3.
const row = await page.evaluate(() => {
  const e = window.__engine;
  const w = e.world;
  const v = w.villages[0];
  const free = (i) => w.cover[i] === 0 && w.depth[i] === 0 && w.fluid[i] === 0;
  for (let r = 6; r < 30; r++)
    for (let a = 0; a < 24; a++) {
      const x = Math.round(v.x + Math.cos((a / 24) * Math.PI * 2) * r);
      const y = Math.round(v.y + Math.sin((a / 24) * Math.PI * 2) * r);
      const spots = [
        [0, 0],
        [3, 0],
        [0, 3],
        [3, 3],
      ];
      const cells = [];
      for (const [ox, oy] of spots)
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ])
          cells.push((y + oy + dy) * w.w + x + ox + dx);
      if (x < 2 || x + 6 >= w.w || y < 2 || y + 6 >= w.h) continue;
      const h0 = w.height[y * w.w + x];
      if (!cells.every((i) => free(i) && Math.abs(w.height[i] - h0) < 1)) continue;
      const work = [2, 10, 22, 34];
      spots.forEach(([ox, oy], k) => {
        const i = (y + oy) * w.w + x + ox;
        for (const j of [i, i + 1, i + w.w, i + w.w + 1]) {
          w.ground[j] = 1;
          w.setCover(j, 40);
        }
        w.sites.push({ i, kind: 4, work: work[k], logs: 5, since: w.time });
      });
      w.sitesVersion++;
      // Past the view's quarter second between redraws of the covers.
      w.time += 1;
      return { x, y };
    }
  return null;
});
console.log("lineup", JSON.stringify(row));
if (row) await frames("stages", row.x + 2.5, row.y + 2.5, 16);
await browser.close();
