// Sharp on the Fold (15 November, the owner: "Why is the quality decreasing with time giving this
// blurry look unzoomed???"): the Perf Lab held still at close, mid and whole, on high, at the
// owner's unfolded Fold by default. For each zoom: one frame as a PNG, the triangles drawn (the
// shadow pass apart), and the time a frame takes over a fixed bench. Software WebGL, so compare
// runs with each other, not with a phone.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/sharp-frames.mjs <out dir> [tag] [extra query]
//   SIZE=344x882 LAB_URL=http://localhost:5175/lab/perf.html ...
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "sharp";
const TAG = process.argv[3] ?? "frame";
const EXTRA = process.argv[4] ?? "";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const [W, H] = (process.env.SIZE ?? "700x830").split("x").map(Number);
const FRAMES = Number(process.env.FRAMES ?? 5);
const QUERY = process.env.QUERY ?? "biome=temperate&shape=coast&seed=7";
const ZOOMS = { close: { dist: 12, phi: 1.0 }, mid: { dist: 28, phi: 0.95 }, whole: { dist: 0, phi: 0.95 } };
const ONLY = process.env.ZOOMS ? process.env.ZOOMS.split(",") : Object.keys(ZOOMS);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const zoom of ONLY) {
    const z = ZOOMS[zoom];
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("page error:", err.message));
    await page.goto(`${BASE}?size=medium&${QUERY}&dpr=1&quality=high&time=60${EXTRA ? `&${EXTRA}` : ""}`);
    await page.waitForFunction(() => window.perfReady === true, null, { timeout: 180_000 });
    await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
    const r = await page.evaluate(
      async ({ z, frames }) => {
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
        // The shadow pass's own triangles: counted around three's shadow map render.
        const r = e.view.renderer;
        const sm = r.shadowMap;
        const inner = sm.render.bind(sm);
        let shadowTris = 0;
        sm.render = (...a) => {
          const before = r.info.render.triangles;
          inner(...a);
          shadowTris += r.info.render.triangles - before;
        };
        const canvas = document.getElementById("world");
        const gl = r.getContext();
        const px = new Uint8Array(4);
        e.render(0);
        e.render(0);
        shadowTris = 0;
        e.render(0);
        const tris = e.view.counts().triangles;
        const shadow = shadowTris;
        const png = canvas.toDataURL("image/png");
        // The bench: the same frame drawn again, the time to draw it and wait for the raster.
        const times = [];
        for (let f = 0; f < frames; f++) {
          const t0 = performance.now();
          e.view.orbit.orbit(0.0001, 0);
          e.render(0);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        return { tris, shadow, png, ms: Math.round(times[times.length >> 1]), parts: e.view.triangleBreakdown() };
      },
      { z, frames: FRAMES },
    );
    writeFileSync(join(OUT, `${zoom}-${TAG}.png`), Buffer.from(r.png.split(",")[1], "base64"));
    console.log(
      JSON.stringify({
        zoom,
        tag: TAG,
        W,
        H,
        tris: r.tris,
        shadow: r.shadow,
        main: r.tris - r.shadow,
        ms: r.ms,
        ...(process.env.PARTS ? { parts: r.parts } : {}),
      }),
    );
    await ctx.close();
  }
} finally {
  await browser.close();
}
