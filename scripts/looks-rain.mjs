// How wide the rain is on screen (18 November, the owner on the unfolded Fold: rain fell as large
// blurry bars). The Perf Lab held still in the rain on a beach, drawn twice in the same frame, with
// the drops and without them; the pixels that differ are the drops. Each streak is a group of
// touching pixels; its width on a row is how much it changes the frame over its brightest pixel
// there, and its width the middle of those, in device pixels. Fails (exit code 1)
// when the streaks taller than 6 pixels are wider than MAX px: the widest, leaving out one in 50
// (two far drops a pixel apart in the same rows read as one streak twice as wide). Writes a crop
// of each frame and the widest streak eight times larger.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/looks-rain.mjs <out dir> [prefix]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "rain";
const PREFIX = process.argv[3] ?? "";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const [W, H] = (process.env.SIZE ?? "832x1000").split("x").map(Number);
const DPR = Number(process.env.DPR ?? 2);
const MAX = Number(process.env.MAX ?? 2);
// "WEATHER=snow MAX=99" takes the same frames in the snow, to look at the flakes.
const WEATHER = process.env.WEATHER ?? "rain";
// Close on the beach, as the diagnosis did; a middle zoom; low, toward the sea and the sky. Each
// with the depth blur on (high) and without it (low).
const VIEWS = [
  { name: "close-high", quality: "high", dist: 12, phi: 1.0 },
  { name: "mid-high", quality: "high", dist: 30, phi: 1.15 },
  { name: "low-angle-high", quality: "high", dist: 20, phi: 1.4 },
  { name: "close-low", quality: "low", dist: 12, phi: 1.0 },
];
mkdirSync(OUT, { recursive: true });

function beach() {
  const w = window.__engine.world;
  const at = (x, y) => y * w.w + x;
  let best = null;
  let score = -1;
  for (let y = 6; y < w.h - 6; y++)
    for (let x = 6; x < w.w - 6; x++) {
      const i = at(x, y);
      if (w.ground[i] !== 2 || w.fluid[i] !== 0) continue;
      let water = false;
      let rise = 0;
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const j = at(x + dx, y + dy);
          if (w.fluid[j] === 1 && w.depth[j] > 0.3) water = true;
          rise = Math.max(rise, w.height[j] - w.height[i]);
        }
      if (water && rise > score && rise < 6) {
        score = rise;
        best = { x: x + 0.5, y: y + 0.5 };
      }
    }
  return best;
}

let failed = false;
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const v of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("page error:", err.message));
    await page.goto(`${BASE}?size=medium&biome=desert&shape=coast&seed=7&weather=${WEATHER}&dpr=${DPR}&quality=${v.quality}&time=60`);
    await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
    await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
    const at = await page.evaluate(beach);
    await page.evaluate(
      async ({ v, at }) => {
        const e = window.__engine;
        const o = e.view.orbit;
        o.tx = at.x;
        o.ty = at.y;
        o.dist = v.dist;
        o.phi = v.phi;
        o.theta = 0.8;
        await new Promise((res) => setTimeout(res, 4000));
        e.view.terrain.updateFine(0, true);
        await new Promise((res) => setTimeout(res, 1500));
        e.stop();
      },
      { v, at },
    );
    const r = await page.evaluate(async (MAX) => {
      const e = window.__engine;
      const canvas = document.getElementById("world");
      const grab = async (drops) => {
        e.view.sky.dropMaterial.visible = drops;
        e.render(0);
        e.render(0);
        const img = new Image();
        img.src = canvas.toDataURL("image/png");
        await img.decode();
        const c = document.createElement("canvas");
        c.width = canvas.width;
        c.height = canvas.height;
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        return { c, data: g.getImageData(0, 0, c.width, c.height).data };
      };
      const on = await grab(true);
      const off = await grab(false);
      e.view.sky.dropMaterial.visible = true;
      const w = canvas.width;
      const h = canvas.height;
      const mask = new Uint8Array(w * h);
      const diff = new Float32Array(w * h);
      let lit = 0;
      for (let i = 0; i < w * h; i++) {
        const d = Math.max(
          Math.abs(on.data[i * 4] - off.data[i * 4]),
          Math.abs(on.data[i * 4 + 1] - off.data[i * 4 + 1]),
          Math.abs(on.data[i * 4 + 2] - off.data[i * 4 + 2]),
        );
        diff[i] = d;
        if (d > 10) {
          mask[i] = 1;
          lit++;
        }
      }
      // Groups of touching pixels (4 neighbours), and the row widths of each.
      const seen = new Int32Array(w * h).fill(-1);
      const streaks = [];
      const stack = [];
      for (let s = 0; s < w * h; s++) {
        if (!mask[s] || seen[s] >= 0) continue;
        const id = streaks.length;
        const rows = new Set();
        seen[s] = id;
        stack.push(s);
        let x0 = w;
        let y0 = h;
        while (stack.length) {
          const p = stack.pop();
          const x = p % w;
          const y = (p - x) / w;
          rows.add(y);
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1])
            if (q >= 0 && mask[q] && seen[q] < 0) {
              seen[q] = id;
              stack.push(q);
            }
        }
        streaks.push({ x: x0, y: y0, tall: rows.size, runs: [] });
      }
      // The width of a streak on a row: along its widest run of pixels there (two streaks that
      // touch are not one wide one), how much it changes the frame in all, over the most it
      // changes one pixel. A line one pixel and a quarter wide is 1.25, whatever its edges do.
      // The streak's width is the middle of those, row by row.
      for (let y = 0; y < h; y++) {
        const best = new Map();
        for (let x = 0; x < w; ) {
          const id = seen[y * w + x];
          if (id < 0) {
            x++;
            continue;
          }
          let e = x;
          let sum = 0;
          let top = 0;
          while (e < w && seen[y * w + e] === id) {
            sum += diff[y * w + e];
            top = Math.max(top, diff[y * w + e]);
            e++;
          }
          best.set(id, Math.max(best.get(id) ?? 0, sum / top));
          x = e;
        }
        for (const [id, run] of best) streaks[id].runs.push(run);
      }
      for (const s of streaks) {
        s.runs.sort((a, b) => a - b);
        s.wide = Math.round(s.runs[Math.floor(s.runs.length / 2)] * 100) / 100;
        s.runs = undefined;
      }
      const real = streaks.filter((s) => s.tall > 6);
      real.sort((a, b) => b.wide - a.wide);
      // The crop: a square around the widest streak, a third of the frame's width.
      const side = Math.round(w / 3);
      const pick = real[0] ?? { x: w / 2, y: h / 2 };
      const cx = Math.max(0, Math.min(w - side, pick.x - side / 2));
      const cy = Math.max(0, Math.min(h - side, pick.y - side / 3));
      const crop = document.createElement("canvas");
      crop.width = side / 2;
      crop.height = side / 2;
      crop.getContext("2d").drawImage(on.c, cx, cy, side, side, 0, 0, side / 2, side / 2);
      // The widest streak itself, eight times larger, pixel for pixel.
      const zoom = document.createElement("canvas");
      zoom.width = 320;
      zoom.height = 640;
      const zg = zoom.getContext("2d");
      zg.imageSmoothingEnabled = false;
      zg.drawImage(on.c, Math.max(0, pick.x - 20), Math.max(0, pick.y), 40, 80, 0, 0, 320, 640);
      return {
        zoom: zoom.toDataURL("image/png"),
        width: w,
        height: h,
        lit,
        streaks: real.length,
        widest: real[0]?.wide ?? 0,
        p98: real[Math.floor(real.length / 50)]?.wide ?? 0,
        over: real.filter((s) => s.wide > MAX).length,
        widest5: real.slice(0, 5).map((s) => s.wide),
        where: real.slice(0, 3).map((s) => [s.x, s.y, s.tall]),
        tallest: Math.max(0, ...real.map((s) => s.tall)),
        jpg: crop.toDataURL("image/jpeg", 0.8),
        full: on.c.toDataURL("image/jpeg", 0.7),
      };
    }, MAX);
    writeFileSync(join(OUT, `${PREFIX}${v.name}.jpg`), Buffer.from(r.jpg.split(",")[1], "base64"));
    writeFileSync(join(OUT, `${PREFIX}${v.name}-widest.png`), Buffer.from(r.zoom.split(",")[1], "base64"));
    writeFileSync(join(OUT, `${PREFIX}${v.name}-full.jpg`), Buffer.from(r.full.split(",")[1], "base64"));
    const ok = r.p98 <= MAX;
    if (!ok) failed = true;
    console.log(
      JSON.stringify({
        view: v.name,
        ok,
        p98: r.p98,
        widest: r.widest,
        over: r.over,
        widest5: r.widest5,
        where: r.where,
        streaks: r.streaks,
        tallest: r.tallest,
        lit: r.lit,
        frame: `${r.width}x${r.height}`,
      }),
    );
    await ctx.close();
  }
} finally {
  await browser.close();
}
if (failed) {
  console.error(`rain: streaks wider than ${MAX} device px`);
  process.exit(1);
}
