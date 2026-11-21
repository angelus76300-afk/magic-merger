// Shadows that move with the sun (20 November, the owner: "Shadows are super slow like 1fps updates
// compared to the rest of the game"). The Perf Lab at 832 by 1000 on high, the camera on a villager
// among trees, the simulation held still; ten frames 0.1 s of the island's day apart, the sun's
// shadows laid as from 15 to 20 November (one map in the sun's steps) and as now (two maps mixed).
// The ten frames straddle one of the sun's steps. Saves a strip of the middle of the screen, the
// steps above and now below, and prints the pixels whose shade (the frame with shadows less the
// frame without) changes from each frame to the next.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/smooth-shadows-frames.mjs <out dir>
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "docs/visual-checks/smooth-shadows";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const [W, H] = [832, 1000];
const [CW, CH] = [520, 400];
mkdirSync(OUT, { recursive: true });

// The island's second (sky.ts skyBodies) when the sun, in steps of 0.75 degrees, takes its next step
// after `from`; the frames start 0.45 s before it.
const STEP = (0.75 * Math.PI) / 180;
const DAY = 360;
const azAt = (t) => Math.PI * Math.min(1, ((((t + DAY * 0.1) % DAY) / DAY - 0.95 + 1) % 1) / 0.77);
let jump = 150;
while (Math.round(azAt(jump) / STEP) === Math.round(azAt(150) / STEP)) jump += 0.01;
const start = jump - 0.45;

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
try {
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(`${BASE}?size=medium&biome=temperate&shape=coast&seed=7&dpr=1&quality=high&time=150&off=tilt`);
  await page.waitForFunction(() => window.perfReady === true, null, { timeout: 180_000 });
  await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
  await page.evaluate(async () => {
    const e = window.__engine;
    const w = e.world;
    const v = [...w.villages][0] ?? { x: w.w / 2, y: w.h / 2 };
    // The villager nearest the first village.
    const c = [...w.creatures].sort((a, b) => Math.hypot(a.x - v.x, a.y - v.y) - Math.hypot(b.x - v.x, b.y - v.y))[0] ?? v;
    const o = e.view.orbit;
    o.tx = c.x;
    o.ty = c.y;
    o.dist = 18;
    o.phi = 0.9;
    o.theta = Math.PI * 0.25;
    await new Promise((res) => setTimeout(res, 2000));
    e.view.terrain.updateFine?.(0, true);
    e.stop();
  });
  const rows = {};
  for (const mode of ["steps", "fade"]) {
    const r = await page.evaluate(
      ({ mode, start, cw, ch }) => {
        const e = window.__engine;
        e.view.looks.sunMode = mode;
        const canvas = document.getElementById("world");
        const c2 = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
        c2.canvas.width = cw;
        c2.canvas.height = ch;
        const sx = (canvas.width - cw) / 2;
        const sy = (canvas.height - ch) / 2;
        const frames = [];
        const changed = [];
        let prev = null;
        const grab = (shadows) => {
          window.__graphics.shadows = shadows;
          e.render(0);
          e.render(0);
          c2.drawImage(canvas, sx, sy, cw, ch, 0, 0, cw, ch);
          return c2.getImageData(0, 0, cw, ch).data;
        };
        const lum = (d, i) => d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
        for (let k = 0; k < 10; k++) {
          e.world.time = start + k * 0.1;
          // The shadows alone: the frame with them less the frame without, so the water, smoke
          // and a villager's pose, which move with the hour too, are not counted.
          const bare = grab(false);
          const lit = grab(true);
          const shade = new Float32Array(lit.length / 4);
          for (let i = 0; i < lit.length; i += 4) shade[i / 4] = lum(lit, i) - lum(bare, i);
          if (prev) {
            let n = 0;
            for (let p = 0; p < shade.length; p++) if (Math.abs(shade[p] - prev[p]) > 12) n++;
            changed.push(n);
          }
          prev = shade;
          frames.push(c2.canvas.toDataURL("image/png"));
        }
        e.view.looks.sunMode = "fade";
        return { frames, changed };
      },
      { mode, start, cw: CW, ch: CH },
    );
    rows[mode] = r;
    console.log(JSON.stringify({ mode, changedPerFrame: r.changed, framesThatMove: r.changed.filter((n) => n > 0).length, largest: Math.max(...r.changed) }));
  }
  // The strip: two rows of ten, labelled.
  const label = { steps: "Before: the sun in steps (one jump a second)", fade: "Now: two maps mixed (every frame)" };
  const html = `<body style="margin:0;background:#14121c;font:600 18px system-ui;color:#f1ead8">${["steps", "fade"]
    .map(
      (m) =>
        `<div style="padding:8px 10px">${label[m]}</div><div style="display:grid;grid-template-columns:repeat(5,${CW}px);gap:4px">${rows[m].frames
          .map(
            (png, k) =>
              `<div style="position:relative"><img src="${png}" width="${CW}" height="${CH}" style="display:block"><div style="position:absolute;top:4px;left:6px;background:#14121ccc;padding:2px 6px">${(k * 0.1).toFixed(1)} s</div></div>`,
          )
          .join("")}</div>`,
    )
    .join("")}</body>`;
  const sheet = await browser.newPage({ viewport: { width: CW * 5 + 16, height: 400 }, deviceScaleFactor: 0.8 });
  await sheet.setContent(html);
  await sheet.waitForTimeout(300);
  await sheet.screenshot({ path: join(OUT, "before-after-strip.jpg"), fullPage: true, type: "jpeg", quality: 82 });
} finally {
  await browser.close();
}
