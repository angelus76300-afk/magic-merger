// Lava's glow at night on high (19 November, the owner: the pool glowed as one flat orange sheet).
// Since 18 November (lava.ts) the frame draws a lava top as dark crust with bright cracks, but the
// bloom's glow mask still took the lava's flat colour. The Perf Lab at 832 by 1000 on high, the
// volcano's crater of a volcanic island at night, held still. Over the lava's cells (sixteen points
// a cell, three cells from the shore) it reads the frame and the glow mask (a quarter of the width):
//   - mask spread: the standard deviation of the mask's brightness (0 to 1). A flat sheet is about 0.
//     It fails under SPREAD.
//   - follows: the correlation of the mask's brightness with the frame's at the same points. A
//     mask that glows where the frame's cracks are is near 1; a flat one is about 0. It fails
//     under FOLLOWS.
//   - lit: the share of the points where the mask glows at all (over 0.1).
//   - frame ms: the median of ROUNDS medians of FRAMES frames each (software WebGL: compare runs
//     with each other, not with a phone), and the glow mask's own draw, timed round it with a pixel read.
//     With AB=1, each round is followed by one with the flat mask of before (frameVsFlat: the
//     frame's time over the flat mask's, minus 1), in the same page.
// Writes <out>/pool-night-<tag>.png (the frame round the lava), <out>/mask-night-<tag>.png (the
// mask there, scaled up) and <out>/numbers-<tag>.json.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/lava-night-proof.mjs <out dir> <tag>
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "lava-night";
const TAG = process.argv[3] ?? "frame";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const W = Number(process.env.W ?? 832);
const H = Number(process.env.H ?? 1000);
const FRAMES = Number(process.env.FRAMES ?? 9);
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const SPREAD = 0.1;
const FOLLOWS = 0.5;
const NIGHT = 264;
const AB = process.env.AB === "1";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
let r;
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  page.on("console", (m) => m.type() === "error" && console.error("console:", m.text().slice(0, 400)));
  await page.addInitScript(() => {
    let s = 12345;
    Math.random = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  });
  await page.goto(`${BASE}?size=medium&biome=volcanic&seed=3&dpr=1&quality=high&time=${NIGHT}`);
  await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
  await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
  r = await page.evaluate(
    async ({ night, frames, rounds, ab }) => {
      const e = window.__engine;
      const w = e.world;
      const v = e.view;
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      // The middle of the lava, and the camera on it as scripts/lava-frames.mjs has it.
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (let y = 1; y < w.h - 1; y++)
        for (let x = 1; x < w.w - 1; x++)
          if (w.fluid[y * w.w + x] === 3) {
            n++;
            sx += x;
            sy += y;
          }
      if (!n) return { error: "no lava" };
      const o = v.orbit;
      const aim = () => {
        w.time = night;
        o.tx = sx / n + 0.5;
        o.ty = sy / n + 0.5;
        o.dist = 30;
        o.phi = 0.9;
        o.theta = Math.PI * 0.25;
      };
      aim();
      for (let k = 0; k < 40; k++) e.render(0.1);
      await wait(1500);
      v.terrain.updateFine(0, true);
      for (let k = 0; k < 40; k++) e.render(0.1);
      await wait(1500);
      v.terrain.updateFine(0, true);
      e.stop();
      aim();
      for (let k = 0; k < 3; k++) e.render(0);

      // The points over lava three cells from the shore.
      const cam = o.camera;
      cam.updateMatrixWorld();
      const level = v.terrain.fluidLevel;
      const lava = (x, y) => w.fluid[y * w.w + x] === 3;
      const pts = [];
      let box = [Infinity, Infinity, -Infinity, -Infinity];
      for (let y = 4; y < w.h - 4; y++)
        for (let x = 4; x < w.w - 4; x++) {
          let inside = true;
          for (let dy = -3; dy <= 3 && inside; dy++) for (let dx = -3; dx <= 3 && inside; dx++) inside = lava(x + dx, y + dy);
          if (!inside || !(level[y * w.w + x] > -1e8)) continue;
          for (let a = 0; a < 4; a++)
            for (let b = 0; b < 4; b++) {
              const p = v
                .toScene(x + 0.125 + a * 0.25, y + 0.125 + b * 0.25, level[y * w.w + x])
                .clone()
                .project(cam);
              if (p.z > 1 || Math.abs(p.x) > 0.98 || Math.abs(p.y) > 0.98) continue;
              const px = Math.round(((p.x + 1) / 2) * innerWidth);
              const py = Math.round(((1 - p.y) / 2) * innerHeight);
              pts.push([px, py]);
              box = [Math.min(box[0], px), Math.min(box[1], py), Math.max(box[2], px), Math.max(box[3], py)];
            }
        }

      // One frame, then the frame's pixels and the mask's, read before anything else draws.
      const looks = v.looks;
      const rd = v.renderer;
      e.render(0);
      const canvas = document.getElementById("world");
      const c2 = document.createElement("canvas");
      c2.width = canvas.width;
      c2.height = canvas.height;
      const g2 = c2.getContext("2d");
      g2.drawImage(canvas, 0, 0);
      const frame = g2.getImageData(0, 0, c2.width, c2.height).data;
      const mask = looks.post.mask;
      const mw = mask.width;
      const mh = mask.height;
      const mpx = new Uint8Array(mw * mh * 4);
      rd.readRenderTargetPixels(mask, 0, 0, mw, mh, mpx);
      const luma = (d, i) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      const sx2 = canvas.width / innerWidth;
      const fs = [];
      const ms = [];
      for (const [px, py] of pts) {
        fs.push(luma(frame, (Math.round(py * sx2) * c2.width + Math.round(px * sx2)) * 4));
        const mx = Math.min(mw - 1, Math.floor((px / innerWidth) * mw));
        const my = Math.min(mh - 1, mh - 1 - Math.floor((py / innerHeight) * mh));
        ms.push(luma(mpx, (my * mw + mx) * 4));
      }
      const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
      const fm = mean(fs);
      const mm = mean(ms);
      let cov = 0;
      let vf = 0;
      let vm = 0;
      for (let i = 0; i < fs.length; i++) {
        cov += (fs[i] - fm) * (ms[i] - mm);
        vf += (fs[i] - fm) ** 2;
        vm += (ms[i] - mm) ** 2;
      }
      const follows = vf > 0 && vm > 0 ? cov / Math.sqrt(vf * vm) : 0;
      const spread = Math.sqrt(vm / Math.max(1, ms.length));
      const lit = ms.filter((x) => x > 0.1).length / Math.max(1, ms.length);

      // Pictures: the frame round the lava, and the mask over the same box, scaled up.
      const cw = 420;
      const ch = 320;
      const cx = Math.max(0, Math.min(innerWidth - cw, Math.round((box[0] + box[2]) / 2 - cw / 2)));
      const cy = Math.max(0, Math.min(innerHeight - ch, Math.round((box[1] + box[3]) / 2 - ch / 2)));
      const crop = document.createElement("canvas");
      crop.width = cw;
      crop.height = ch;
      crop.getContext("2d").drawImage(c2, cx * sx2, cy * sx2, cw * sx2, ch * sx2, 0, 0, cw, ch);
      const pool = crop.toDataURL("image/png");
      const mc = document.createElement("canvas");
      mc.width = mw;
      mc.height = mh;
      const mi = mc.getContext("2d").createImageData(mw, mh);
      for (let y = 0; y < mh; y++)
        for (let x = 0; x < mw; x++) {
          const s = ((mh - 1 - y) * mw + x) * 4;
          const d = (y * mw + x) * 4;
          mi.data[d] = mpx[s];
          mi.data[d + 1] = mpx[s + 1];
          mi.data[d + 2] = mpx[s + 2];
          mi.data[d + 3] = 255;
        }
      mc.getContext("2d").putImageData(mi, 0, 0);
      const mcrop = document.createElement("canvas");
      mcrop.width = cw;
      mcrop.height = ch;
      const mg = mcrop.getContext("2d");
      mg.imageSmoothingEnabled = false;
      mg.drawImage(mc, (cx / innerWidth) * mw, (cy / innerHeight) * mh, (cw / innerWidth) * mw, (ch / innerHeight) * mh, 0, 0, cw, ch);
      const maskPng = mcrop.toDataURL("image/png");

      // Frame time, and the mask's own draw round it.
      const gl = rd.getContext();
      const one = new Uint8Array(4);
      const inner = looks.drawGlowMask;
      let maskMs = 0;
      // A pixel read waits for what was drawn before it (gl.finish does not, in Chrome).
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
      looks.drawGlowMask = (...a) => {
        sync();
        const t0 = performance.now();
        inner(...a);
        sync();
        maskMs += performance.now() - t0;
      };
      const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
      const timed = () => {
        const t = [];
        const m = [];
        for (let f = 0; f < frames; f++) {
          maskMs = 0;
          const t0 = performance.now();
          e.render(0);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
          t.push(performance.now() - t0);
          m.push(maskMs);
        }
        return [med(t), med(m)];
      };
      // With ab, the same page draws its rounds in turn with the mask it has and with the flat mask
      // of before 19 November (built here as looks.ts had it), so both see the same machine's noise.
      const T = window.__three;
      const flat = new T.MeshBasicMaterial({ vertexColors: true, fog: false });
      flat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <opaque_fragment>",
          "outgoingLight *= smoothstep(0.12, 0.3, outgoingLight.r - outgoingLight.b) * step(0.55, outgoingLight.r);\n#include <opaque_fragment>",
        );
      };
      flat.customProgramCacheKey = () => "lava-glow-mask";
      const own = looks.lavaMask;
      const roundsMs = [];
      const roundsMask = [];
      const flatMs = [];
      const flatMask = [];
      for (let k = 0; k < rounds; k++) {
        const [a, b] = timed();
        roundsMs.push(a);
        roundsMask.push(b);
        if (!ab) continue;
        looks.lavaMask = flat;
        e.render(0);
        const [c, d] = timed();
        looks.lavaMask = own;
        e.render(0);
        flatMs.push(c);
        flatMask.push(d);
      }
      looks.drawGlowMask = inner;
      const r3 = (x) => Math.round(x * 1000) / 1000;
      return {
        bloom: r3(looks.bloomAmount),
        points: pts.length,
        frameMean: r3(fm),
        maskMean: r3(mm),
        maskSpread: r3(spread),
        follows: r3(follows),
        lit: r3(lit),
        frameMs: Math.round(med(roundsMs) * 10) / 10,
        frameMsRounds: roundsMs.map((x) => Math.round(x * 10) / 10),
        maskMs: Math.round(med(roundsMask) * 10) / 10,
        ...(ab
          ? {
              flatFrameMs: Math.round(med(flatMs) * 10) / 10,
              flatFrameMsRounds: flatMs.map((x) => Math.round(x * 10) / 10),
              flatMaskMs: Math.round(med(flatMask) * 10) / 10,
              frameVsFlat: Math.round((med(roundsMs) / med(flatMs) - 1) * 1000) / 1000,
            }
          : {}),
        pool,
        maskPng,
      };
    },
    { night: NIGHT, frames: FRAMES, rounds: ROUNDS, ab: AB },
  );
  await ctx.close();
} finally {
  await browser.close();
}
if (r.error) throw new Error(r.error);
writeFileSync(join(OUT, `pool-night-${TAG}.png`), Buffer.from(r.pool.split(",")[1], "base64"));
writeFileSync(join(OUT, `mask-night-${TAG}.png`), Buffer.from(r.maskPng.split(",")[1], "base64"));
delete r.pool;
delete r.maskPng;
const numbers = { size: `${W}x${H}`, quality: "high", time: NIGHT, spreadLimit: SPREAD, followsLimit: FOLLOWS, ...r };
writeFileSync(join(OUT, `numbers-${TAG}.json`), JSON.stringify(numbers, null, 2) + "\n");
console.log(JSON.stringify(numbers));
let bad = 0;
if (r.points < 100) {
  console.error(`only ${r.points} lava points: the camera missed the lava`);
  bad++;
}
if (r.maskSpread < SPREAD) {
  console.error(`the glow mask's spread over the lava is ${r.maskSpread}, under ${SPREAD}: a flat sheet`);
  bad++;
}
if (r.follows < FOLLOWS) {
  console.error(`the glow mask follows the frame's lava at ${r.follows}, under ${FOLLOWS}: it does not glow where the cracks are`);
  bad++;
}
if (bad) process.exit(1);
