// Villagers asleep at home (22 November, homes.ts): the Perf Lab's island run from morning into
// deep night tick by tick, then a frame of its busiest village at night on high, with the count of
// villagers asleep indoors, lying outside and standing outside (none should stand). Software WebGL.
//
//   npx vite --port 5174 &
//   node scripts/villagers-night-frames.mjs <out dir> [tag]
//   SIZES=832x1000 LAB_URL=http://localhost:5174/lab/perf.html NIGHT=268 FOCUS=rough ...
//   FOCUS=ruin BURN=120: at 120 s the house nearest the busiest village's centre burns down (23
//   November, homes.ts ruinStands); the frame closes on its ruin and its family lying beside it.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "villagers-night";
const TAG = process.argv[3] ?? "night";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const SIZES = (process.env.SIZES ?? "832x1000").split(",").map((s) => s.split("x").map(Number));
const QUERY = process.env.QUERY ?? "biome=temperate&shape=coast&seed=7";
// Deep night: from 0.78 to 0.9 of the day, which starts at 0.1 (daylight.ts).
const NIGHT = Number(process.env.NIGHT ?? 268);

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const rows = [];
try {
  for (const [W, H] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("page error:", err.message));
    await page.addInitScript(() => {
      let s = 12345;
      Math.random = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    });
    await page.goto(`${BASE}?size=medium&${QUERY}&dpr=1&quality=high`);
    await page.waitForFunction(() => window.perfReady === true, null, { timeout: 180_000 });
    await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
    const r = await page.evaluate(
      async ({ night, focus, burn }) => {
        const e = window.__engine;
        const w = e.world;
        const wait = (ms) => new Promise((res) => setTimeout(res, ms));
        e.stop();
        let ruin = null;
        if (burn > 0) {
          while (w.time < burn) e.step();
          const v = w.villages[0];
          let best = -1;
          let bestD = Infinity;
          for (let i = 0; i < w.n; i++) {
            if (w.cover[i] !== 4) continue;
            const d = Math.hypot((i % w.w) - v.x, Math.floor(i / w.w) - v.y);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
          // Set alight: the house burns out to rubble as any fire leaves it.
          for (const j of [best, best + 1, best + w.w, best + w.w + 1]) if (w.cover[j] === 4) w.fire[j] = 1;
          ruin = { x: (best % w.w) + 1, y: Math.floor(best / w.w) + 1 };
        }
        while (w.time < night) e.step();
        const people = w.creatures.filter((c) => !c.dead && c.kind === "villager");
        const asleep = people.filter((c) => c.mind?.task === "rest");
        const indoors = asleep.filter((c) => c.data.indoors !== undefined);
        const rough = asleep.filter((c) => c.data.indoors === undefined && c.data.rough);
        const standing = asleep.filter((c) => c.data.indoors === undefined && !c.data.rough);
        // The village with the most asleep indoors.
        let best = null;
        for (const v of w.villages) {
          const n = indoors.filter((c) => Math.hypot(c.homeX - v.x, c.homeY - v.y) < 16).length;
          if (!best || n > best.n) best = { v, n };
        }
        // FOCUS=rough: close on one asleep outside, lying down (a homeless family).
        const lying = focus === "rough" ? rough[0] : undefined;
        const at = (focus === "ruin" && ruin) || lying || (best ? best.v : (people[0] ?? { x: w.w / 2, y: w.h / 2 }));
        const o = e.view.orbit;
        o.tx = at.x;
        o.ty = at.y;
        o.dist = lying ? 7 : focus === "ruin" ? 11 : 22;
        o.phi = 0.95;
        o.theta = 0.6;
        for (let k = 0; k < 30; k++) e.render(0.1);
        await wait(1500);
        e.view.terrain.updateFine(0, true);
        for (let k = 0; k < 30; k++) e.render(0.1);
        await wait(800);
        return {
          time: Math.round(w.time),
          people: people.length,
          asleep: asleep.length,
          indoors: indoors.length,
          rough: rough.length,
          standing: standing.length,
          lit: e.view.windows.count,
          village: best ? { x: Math.round(at.x), y: Math.round(at.y), indoors: best.n } : null,
          ruin: ruin
            ? {
                rubble: [0, 1, w.w, w.w + 1].filter((d) => w.cover[ruin.x - 1 + (ruin.y - 1) * w.w + d] === 5).length,
                lyingBy: rough.filter((c) => Math.hypot(c.x - ruin.x, c.y - ruin.y) < 5).map((c) => c.mind?.action),
              }
            : null,
        };
      },
      { night: NIGHT, focus: process.env.FOCUS ?? "", burn: Number(process.env.BURN ?? 0) },
    );
    await page.screenshot({ path: join(OUT, `${TAG}-${W}x${H}.png`) });
    rows.push({ size: `${W}x${H}`, ...r });
    console.log(JSON.stringify({ size: `${W}x${H}`, ...r }));
    await ctx.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `${TAG}.json`), JSON.stringify(rows, null, 2) + "\n");
