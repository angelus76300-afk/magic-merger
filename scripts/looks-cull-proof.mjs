// What the camera cannot see is not drawn, and the frame does not change (15 November): the Perf
// Lab held still, the same frame drawn with the culling off, off again (the noise of drawing the
// same frame twice) and on. Pixel differences in 0..255 per channel; triangles as drawn.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/looks-cull-proof.mjs <out dir> [query]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "cull";
const QUERY = process.argv[3] ?? "biome=temperate&shape=coast&seed=7";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const [W, H] = (process.env.SIZE ?? "344x882").split("x").map(Number);
const ZOOMS = { close: { dist: 12, phi: 1.0 }, mid: { dist: 28, phi: 0.95 }, whole: { dist: 0, phi: 0.95 } };
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const [zoom, z] of Object.entries(ZOOMS)) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("page error:", err.message));
    await page.goto(`${BASE}?size=medium&${QUERY}&dpr=1&quality=high&time=60`);
    await page.waitForFunction(() => window.perfReady === true, null, { timeout: 180_000 });
    await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
    const r = await page.evaluate(
      async ({ z }) => {
        const e = window.__engine;
        const w = e.world;
        const v = [...w.villages][0] ?? { x: w.w / 2, y: w.h / 2 };
        const o = e.view.orbit;
        const side = Math.max(w.w, w.h);
        o.tx = z.dist ? v.x : side / 2;
        o.ty = z.dist ? v.y : side / 2;
        o.dist = z.dist || side * 0.55;
        o.phi = z.phi;
        o.theta = Math.PI * 0.25;
        await new Promise((res) => setTimeout(res, 1500));
        e.view.terrain.updateFine(0, true);
        await new Promise((res) => setTimeout(res, 1500));
        e.stop();
        const canvas = document.getElementById("world");
        const shot = (cull) => {
          e.view.cullCovers = cull;
          e.view.terrain.cullFaces = cull;
          e.render(0);
          e.render(0);
          const tris = e.view.counts().triangles;
          return { png: canvas.toDataURL("image/png"), tris };
        };
        // A first frame after the engine stops differs once (both ways): drawn and dropped.
        shot(false);
        const off = shot(false);
        const on = shot(true);
        return { off, on, again: shot(false) };
      },
      { z },
    );
    for (const k of ["off", "again", "on"]) writeFileSync(join(OUT, `${zoom}-${k}.png`), Buffer.from(r[k].png.split(",")[1], "base64"));
    console.log(JSON.stringify({ zoom, trisOff: r.off.tris, trisOn: r.on.tris }));
    await ctx.close();
  }
} finally {
  await browser.close();
}
