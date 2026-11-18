// The far land on high (18 November, the owner on the Fold: the far land looked smeared into big
// blurry blocks). The Perf Lab held still at a close zoom, on high, drawn with the depth of field
// and without it ("off=tilt", everything else the same). The sharpness of the far land is the mean
// gradient of the light over the top third of the frame (what lies behind the focus); the check is
// its share kept with the blur on, against the frame without it. Fails (exit code 1) when a size
// keeps less than MIN of it. Also the time a frame takes with the blur on, over a fixed bench
// (software WebGL: compare runs with each other, not with a phone). Writes a small jpg of each frame.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/far-blur-frames.mjs <out dir> [tag]
//   SIZES=832x1000,344x882 MIN=0.75 DIST=14 PHI=1.1
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const sharp = require("sharp");
const OUT = process.argv[2] ?? "far-blur";
const TAG = process.argv[3] ?? "frame";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const SIZES = (process.env.SIZES ?? "832x1000,344x882").split(",").map((s) => s.split("x").map(Number));
const MIN = Number(process.env.MIN ?? 0.75);
const DIST = Number(process.env.DIST ?? 14);
const PHI = Number(process.env.PHI ?? 1.1);
const FRAMES = Number(process.env.FRAMES ?? 7);
const QUERY = process.env.QUERY ?? "biome=temperate&shape=coast&seed=7";
mkdirSync(OUT, { recursive: true });

// The mean of |dx| + |dy| of the light, 0 to 255, over the top third of the frame.
async function farSharpness(png) {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  let sum = 0;
  let n = 0;
  for (let y = 1; y < Math.floor(h / 3); y++)
    for (let x = 1; x < w; x++) {
      const v = data[(y * w + x) * c];
      sum += Math.abs(v - data[(y * w + x - 1) * c]) + Math.abs(v - data[((y - 1) * w + x) * c]);
      n++;
    }
  return sum / n;
}

async function shot(browser, W, H, extra) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(`${BASE}?size=medium&${QUERY}&dpr=2&quality=high&time=60${extra}`);
  await page.waitForFunction(() => window.perfReady === true, null, { timeout: 180_000 });
  await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
  const r = await page.evaluate(
    async ({ dist, phi, frames }) => {
      const e = window.__engine;
      const w = e.world;
      const v = [...w.villages][0] ?? { x: w.w / 2, y: w.h / 2 };
      const o = e.view.orbit;
      o.tx = v.x;
      o.ty = v.y;
      o.dist = dist;
      o.phi = phi;
      o.theta = Math.PI * 0.25;
      await new Promise((res) => setTimeout(res, 1500));
      e.view.terrain.updateFine(0, true);
      await new Promise((res) => setTimeout(res, 2500));
      e.stop();
      const canvas = document.getElementById("world");
      const gl = e.view.renderer.getContext();
      const px = new Uint8Array(4);
      e.render(0);
      e.render(0);
      e.render(0);
      const png = canvas.toDataURL("image/png");
      const times = [];
      for (let f = 0; f < frames; f++) {
        const t0 = performance.now();
        e.view.orbit.orbit(0.0001, 0);
        e.render(0);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      return { png, ms: Math.round(times[times.length >> 1]) };
    },
    { dist: DIST, phi: PHI, frames: FRAMES },
  );
  await ctx.close();
  return { png: Buffer.from(r.png.split(",")[1], "base64"), ms: r.ms };
}

let failed = false;
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const [W, H] of SIZES) {
    const on = await shot(browser, W, H, "");
    const off = await shot(browser, W, H, "&off=tilt");
    const sOn = await farSharpness(on.png);
    const sOff = await farSharpness(off.png);
    const kept = sOn / sOff;
    await sharp(on.png)
      .resize({ width: W })
      .jpeg({ quality: 72 })
      .toFile(join(OUT, `${W}x${H}-${TAG}.jpg`));
    const ok = kept >= MIN;
    if (!ok) failed = true;
    console.log(
      JSON.stringify({
        size: `${W}x${H}`,
        tag: TAG,
        sharpOn: +sOn.toFixed(2),
        sharpOff: +sOff.toFixed(2),
        kept: +kept.toFixed(3),
        min: MIN,
        ok,
        msOn: on.ms,
        msOff: off.ms,
      }),
    );
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
