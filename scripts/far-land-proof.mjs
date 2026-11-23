// Far land (terrain.ts Terrain.wantFar, terrain-fine.ts FAR), measured: the Perf Lab held
// still at a view, the same frame drawn with every chunk in eighths (lod.far 0), with the far land
// on, then in eighths again (the noise of drawing a frame again). Prints one JSON line a view: the
// chunks drawn far, the triangles of each frame, and the difference of the far frame from the
// eighths (mean per channel 0..255, and the share of pixels whose light is off by more than 8),
// next to the same for the two frames in eighths. Writes the three frames as PNG.
//
//   npx vite --port 5174 &
//   node scripts/far-land-proof.mjs <out dir> [sizes, e.g. "medium,large"] [query]
// SIZE=806x968 DPR=1.5 is the owner's Fold unfolded; VIEWS=sky,close picks the views.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "far-land";
const ISLANDS = (process.argv[3] ?? "medium,large").split(",");
const QUERY = process.argv[4] ?? "mixed=1&seed=7";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const [W, H] = (process.env.SIZE ?? "806x968").split("x").map(Number);
const DPR = Number(process.env.DPR ?? 1.5);
// sky: the whole island in frame, as the game opens it; close: a village a few cells away.
const ALL_VIEWS = { sky: { dist: 0, phi: null }, close: { dist: 14, phi: 1.0 } };
const VIEWS = (process.env.VIEWS ?? "sky,close").split(",");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const size of ISLANDS)
    for (const view of VIEWS) {
      const z = ALL_VIEWS[view];
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
      const page = await ctx.newPage();
      page.on("pageerror", (err) => console.error("page error:", err.message));
      await page.goto(`${BASE}?size=${size}&${QUERY}&dpr=${DPR}&quality=high&time=60&off=tilt`);
      await page.waitForFunction(() => window.perfReady === true, null, { timeout: 300_000 });
      await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
      await page.evaluate(
        async ({ z }) => {
          const e = window.__engine;
          const w = e.world;
          const o = e.view.orbit;
          const side = Math.max(w.w, w.h);
          const v = [...w.villages][0] ?? { x: w.w / 2, y: w.h / 2 };
          o.tx = z.dist ? v.x : w.w / 2;
          o.ty = z.dist ? v.y : w.h / 2;
          o.dist = z.dist || o.distanceFor(side * 0.55);
          if (z.phi !== null) o.phi = z.phi;
          o.theta = Math.PI * 0.25;
          await new Promise((res) => setTimeout(res, 1500));
          e.stop();
        },
        { z },
      );
      // One frame, every chunk built at the level `far` gives (0: eighths everywhere).
      const frame = (far) =>
        page.evaluate((far) => {
          const e = window.__engine;
          const t = e.view.terrain;
          t.lod.far = far;
          e.render(0);
          t.updateFine(0, true);
          e.render(0);
          e.render(0);
          const tris = e.view.counts().triangles;
          const calls = e.view.counts().calls;
          const canvas = document.getElementById("world");
          const png = canvas.toDataURL("image/png");
          const c2 = document.createElement("canvas");
          c2.width = canvas.width;
          c2.height = canvas.height;
          const g = c2.getContext("2d");
          g.drawImage(canvas, 0, 0);
          window.__px = window.__px ?? [];
          window.__px.push(g.getImageData(0, 0, c2.width, c2.height).data);
          return { png, tris, calls, far: [...t.fineFar].filter(Boolean).length, chunks: t.chunks.length };
        }, far);
      // A first frame for the sun's two shadow maps and the fine land to settle (its numbers unused).
      await frame(0);
      await page.evaluate(() => (window.__px = []));
      const all = await frame(0);
      const far = await frame(Number(process.env.FAR_PX ?? 1));
      const again = await frame(0);
      const diff = await page.evaluate(() => {
        const [a, b, c] = window.__px;
        const measure = (x, y) => {
          let sum = 0;
          let over = 0;
          for (let k = 0; k < x.length; k += 4) {
            const dr = Math.abs(x[k] - y[k]);
            const dg = Math.abs(x[k + 1] - y[k + 1]);
            const db = Math.abs(x[k + 2] - y[k + 2]);
            sum += dr + dg + db;
            if (Math.abs(0.299 * (x[k] - y[k]) + 0.587 * (x[k + 1] - y[k + 1]) + 0.114 * (x[k + 2] - y[k + 2])) > 8) over++;
          }
          const n = x.length / 4;
          return { mean: Math.round((sum / (3 * n)) * 100) / 100, over: Math.round((over / n) * 10000) / 100 };
        };
        window.__px = [];
        return { far: measure(b, a), farAgain: measure(b, c), noise: measure(a, c) };
      });
      const tag = `${size}-${view}-${W}x${H}`;
      writeFileSync(join(OUT, `${tag}-eighths.png`), Buffer.from(all.png.split(",")[1], "base64"));
      writeFileSync(join(OUT, `${tag}-far.png`), Buffer.from(far.png.split(",")[1], "base64"));
      writeFileSync(join(OUT, `${tag}-eighths-again.png`), Buffer.from(again.png.split(",")[1], "base64"));
      console.log(
        JSON.stringify({
          size,
          view,
          screen: `${W}x${H}@${DPR}`,
          chunks: all.chunks,
          farChunks: far.far,
          tris: [all.tris, far.tris],
          calls: [all.calls, far.calls],
          ...diff,
        }),
      );
      await ctx.close();
    }
} finally {
  await browser.close();
}
