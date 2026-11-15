// The seam where the land changes from eighth to quarter cubes (terrain.ts Terrain.lod), measured
// (15 November, the owner: "we can see the seam ... it was extremely obvious"). The Perf Lab held
// still with the camera set so the switch line crosses the screen; the same frame drawn with every
// chunk in eighths and with the switch at a threshold (an eighth smaller than `px` pixels), a strip
// of the screen around the seam cropped from both, and their difference measured. Writes the two
// crops and an enlarged side by side for each threshold, and one JSON line each.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/looks-seam.mjs <out dir> [px,px,...] [query]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "seam";
const PXS = (process.argv[3] ?? "1,2,3,4").split(",").map(Number);
const QUERY = process.argv[4] ?? "biome=temperate&shape=coast&seed=7";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const [W, H] = (process.env.SIZE ?? "344x882").split("x").map(Number);
const DPR = Number(process.env.DPR ?? 1);
const VIEWS = { low: { dist: 30, phi: 1.25 }, whole: { dist: 0, phi: 0.95 } };
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const [view, z] of Object.entries(VIEWS)) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("page error:", err.message));
    await page.goto(`${BASE}?size=medium&${QUERY}&dpr=${DPR}&quality=high&time=60&off=tilt`);
    await page.waitForFunction(() => window.perfReady === true, null, { timeout: 180_000 });
    await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
    await page.evaluate(
      async ({ z }) => {
        const e = window.__engine;
        const w = e.world;
        const side = Math.max(w.w, w.h);
        const o = e.view.orbit;
        o.tx = side * 0.42;
        o.ty = side * 0.42;
        o.dist = z.dist || side * 0.55;
        o.phi = z.phi;
        o.theta = Math.PI * 0.25;
        await new Promise((res) => setTimeout(res, 1500));
        e.stop();
      },
      { z },
    );
    // One frame with every chunk at the level `px` gives (0: all eighths), and where the chunks of
    // eighths meet those of quarters on the screen.
    const frame = (px) =>
      page.evaluate((px) => {
        const e = window.__engine;
        const t = e.view.terrain;
        t.lod.px = px;
        e.render(0);
        t.updateFine(0, true);
        e.render(0);
        e.render(0);
        const canvas = document.getElementById("world");
        const cam = e.view.orbit.camera;
        const seam = [];
        const n = t.chunks.length;
        const cols = t.cols;
        const v = new cam.position.constructor();
        for (let c = 0; c < n; c++) {
          if (t.fineLevel[c] !== 8) continue;
          for (const [dx, dy] of [
            [1, 0],
            [0, 1],
            [-1, 0],
            [0, -1],
          ]) {
            const cx = (c % cols) + dx;
            const cy = Math.floor(c / cols) + dy;
            if (cx < 0 || cy < 0 || cx >= cols || cy >= Math.ceil(n / cols)) continue;
            if (t.fineLevel[cy * cols + cx] !== 4) continue;
            // Points along the border of the two chunks, at the land's height.
            for (let k = 0; k <= 8; k++) {
              const bx = dx ? (c % cols) * 32 + (dx > 0 ? 32 : 0) : (c % cols) * 32 + k * 4;
              const by = dy ? Math.floor(c / cols) * 32 + (dy > 0 ? 32 : 0) : Math.floor(c / cols) * 32 + k * 4;
              const gx = Math.min(e.world.w - 1, Math.max(0, bx));
              const gy = Math.min(e.world.h - 1, Math.max(0, by));
              v.set(bx - e.world.w / 2, t.groundAt(gx, gy), by - e.world.h / 2).project(cam);
              if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1) seam.push([((v.x + 1) / 2) * canvas.width, ((1 - v.y) / 2) * canvas.height]);
            }
          }
        }
        const quarters = [...t.fineLevel].filter((l) => l === 4).length;
        return { png: canvas.toDataURL("image/png"), seam, quarters, tris: e.view.counts().triangles };
      }, px);
    for (const px of PXS) {
      // Each threshold between two frames of all eighths: the noise of drawing a frame again
      // (villagers and smoke move between frames) is measured right next to the switch.
      const all = await frame(0);
      writeFileSync(join(OUT, `${view}-px${px}-eighths.png`), Buffer.from(all.png.split(",")[1], "base64"));
      const r = await frame(px);
      writeFileSync(join(OUT, `${view}-px${px}.png`), Buffer.from(r.png.split(",")[1], "base64"));
      const again = await frame(0);
      writeFileSync(join(OUT, `${view}-px${px}-eighths-again.png`), Buffer.from(again.png.split(",")[1], "base64"));
      console.log(JSON.stringify({ view, px, quarters: r.quarters, seamPoints: r.seam.length, seam: r.seam, trisEighths: all.tris, tris: r.tris }));
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
