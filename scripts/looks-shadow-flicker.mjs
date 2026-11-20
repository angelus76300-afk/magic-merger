// Shadow flicker, measured (15 November, the owner: "Shadows though are very bad and flicker a
// lot"). The Perf Lab held still and drawn frame by frame while one thing moves slowly: the sun
// (the hour going on, the camera still), a pan, a zoom, an orbit; the pixels that change between
// two consecutive frames counted (off by more than 12 in 0..255 of light). Run with the shadow map
// laid four ways (Looks.sunMode, MODES to choose): as before 15 November (old), one map in the
// sun's steps of 15 to 20 November (steps), one map turning every frame (smooth), and as now, two
// maps of the steps around the sun, mixed (fade). The camera moves the same in all, so what differs
// between the runs is the shadows. Changed pixels alone count a shadow that moves as much as one
// that shimmers; a shimmer goes back and forth, so `flicker` counts the pixels that change one way
// from a frame to the next and back the next (20 November), and saves where, in red. `sun30` is
// the sun at 30 frames a second, `sun` about 8 times faster, as on 15 November. Also the shadow
// pass's time: a still frame with the shadows less one without (medians, the GPU waited for).
// Saves four consecutive frames of the sun run, for each way. MODES=fade,steps ONLY=sun30 narrow it.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/looks-shadow-flicker.mjs <out dir> [frames]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "flicker";
const FRAMES = Number(process.argv[3] ?? 10);
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const QUERY = process.env.QUERY ?? "biome=temperate&shape=coast&seed=7";
const [W, H] = (process.env.SIZE ?? "344x882").split("x").map(Number);
mkdirSync(OUT, { recursive: true });

// Per frame: island seconds, cells of pan, zoom factor, turn (radians).
const MOVES = {
  sun: { dt: 0.25, pan: 0, zoom: 1, turn: 0 },
  sun30: { dt: 1 / 30, pan: 0, zoom: 1, turn: 0 },
  pan: { dt: 0, pan: 0.03, zoom: 1, turn: 0 },
  zoom: { dt: 0, pan: 0, zoom: 1.004, turn: 0 },
  orbit: { dt: 0, pan: 0, zoom: 1, turn: 0.003 },
};

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(`${BASE}?size=medium&${QUERY}&dpr=1&quality=high&time=150&off=tilt`);
  await page.waitForFunction(() => window.perfReady === true, null, { timeout: 180_000 });
  await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
  await page.evaluate(async () => {
    const e = window.__engine;
    const w = e.world;
    const v = [...w.villages][0] ?? { x: w.w / 2, y: w.h / 2 };
    const o = e.view.orbit;
    o.tx = v.x;
    o.ty = v.y;
    o.dist = 16;
    o.phi = 1.0;
    o.theta = Math.PI * 0.25;
    await new Promise((res) => setTimeout(res, 2000));
    e.view.terrain.updateFine?.(0, true);
    e.stop();
    window.__start = { tx: o.tx, ty: o.ty, dist: o.dist, theta: o.theta, time: 150 };
  });
  const MODES = (process.env.MODES ?? "old,steps,smooth,fade").split(",");
  // The shadow pass's cost on a still frame, for each way.
  for (const mode of MODES) {
    const cost = await page.evaluate((mode) => {
      const e = window.__engine;
      e.view.looks.sunMode = mode;
      const gl = e.view.renderer.getContext();
      const time = (on) => {
        window.__graphics.shadows = on;
        e.render(0);
        const ms = [];
        for (let k = 0; k < 9; k++) {
          const t0 = performance.now();
          e.render(0);
          gl.finish();
          ms.push(performance.now() - t0);
        }
        return ms.sort((a, b) => a - b)[4];
      };
      const off = time(false);
      const on = time(true);
      e.view.looks.sunMode = "fade";
      return { on, off };
    }, mode);
    console.log(JSON.stringify({ sun: mode, shadowPassMs: Math.round((cost.on - cost.off) * 100) / 100, frameMs: Math.round(cost.on * 10) / 10 }));
  }
  for (const mode of MODES)
    for (const [move, m] of Object.entries(MOVES)) {
      if (process.env.ONLY && process.env.ONLY !== move) continue;
      const r = await page.evaluate(
        ({ m, mode, frames }) => {
          const e = window.__engine;
          const looks = e.view.looks;
          looks.sunMode = mode;
          const o = e.view.orbit;
          const s = window.__start;
          const canvas = document.getElementById("world");
          const c2 = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
          c2.canvas.width = canvas.width;
          c2.canvas.height = canvas.height;
          const grab = () => {
            c2.drawImage(canvas, 0, 0);
            return c2.getImageData(0, 0, canvas.width, canvas.height).data;
          };
          const at = (k) => {
            e.world.time = s.time + k * m.dt;
            o.tx = s.tx + k * m.pan;
            o.ty = s.ty + k * m.pan;
            o.dist = s.dist * Math.pow(m.zoom, k);
            o.theta = s.theta + k * m.turn;
          };
          at(0);
          e.render(0);
          e.render(0);
          const changed = [];
          const flicker = [];
          const strip = [];
          let prev = grab();
          // Each pixel's last change: +1 lighter, -1 darker, 0 none.
          const way = new Int8Array(prev.length / 4);
          // Where it flickers: the pixels that went back, in red over the last frame.
          const where = new Uint8Array(prev.length / 4);
          for (let k = 1; k <= frames; k++) {
            at(k);
            e.render(0);
            e.render(0);
            const now = grab();
            if (strip.length < 4) strip.push(canvas.toDataURL("image/png"));
            let n = 0;
            let back = 0;
            for (let i = 0; i < now.length; i += 4) {
              const d = Math.abs(now[i] - prev[i]) * 0.3 + Math.abs(now[i + 1] - prev[i + 1]) * 0.59 + Math.abs(now[i + 2] - prev[i + 2]) * 0.11;
              const s = (now[i] - prev[i]) * 0.3 + (now[i + 1] - prev[i + 1]) * 0.59 + (now[i + 2] - prev[i + 2]) * 0.11;
              const w = d > 12 ? Math.sign(s) : 0;
              if (w) n++;
              if (w && way[i / 4] === -w) {
                back++;
                where[i / 4] = 1;
              }
              way[i / 4] = w;
            }
            changed.push(n);
            flicker.push(back);
            prev = now;
          }
          const img = c2.getImageData(0, 0, canvas.width, canvas.height);
          for (let p = 0; p < where.length; p++) if (where[p]) img.data.set([255, 0, 0, 255], p * 4);
          c2.putImageData(img, 0, 0);
          const map = c2.canvas.toDataURL("image/png");
          looks.sunMode = "fade";
          return { changed, flicker, strip, map };
        },
        { m, mode, frames: FRAMES },
      );
      const tag = mode;
      if (move.startsWith("sun")) writeFileSync(join(OUT, `${move}-${tag}-flicker.png`), Buffer.from(r.map.split(",")[1], "base64"));
      if (move === "sun") r.strip.forEach((png, k) => writeFileSync(join(OUT, `sun-${tag}-${k}.png`), Buffer.from(png.split(",")[1], "base64")));
      const mean = r.changed.reduce((a, b) => a + b, 0) / r.changed.length;
      console.log(
        JSON.stringify({
          move,
          sun: tag,
          meanChanged: Math.round(mean),
          meanPct: Math.round((mean / (W * H)) * 10000) / 100,
          maxChanged: Math.max(...r.changed),
          framesWithChange: r.changed.filter((n) => n > 0).length,
          flicker: r.flicker.reduce((a, b) => a + b, 0),
          maxFlicker: Math.max(...r.flicker),
          frames: r.changed.length,
        }),
      );
    }
  await ctx.close();
} finally {
  await browser.close();
}
