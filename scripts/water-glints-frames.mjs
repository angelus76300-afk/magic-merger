// Water glints (18 November, the owner on the Fold: lakes and the sea on high "show big bright white
// blotches"). The Perf Lab on high, the camera looking towards the sun over the lake of seed 7, at
// 832 by 1000: one frame with the water's light and one without. The water is where the frame
// without it is blue; the check is the share of those pixels brighter than 0.92 in the frame with
// it. It fails above 1% (it was about 9% before the fix).
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/water-glints-frames.mjs <out dir> [tag]
//   LAB_URL=http://localhost:5175/lab/perf.html ...
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "water-glints";
const TAG = process.argv[3] ?? "frame";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const LIMIT = 0.01;
const BRIGHT = 0.92;
mkdirSync(OUT, { recursive: true });

const AT = { x: 58.5, y: 75.5, dist: Number(process.env.DIST ?? 40) };
const SHOTS = [
  { name: "sun", q: "biome=temperate&shape=lakes&seed=7" },
  { name: "sun-off", q: "biome=temperate&shape=lakes&seed=7&off=waterlight" },
];

async function shoot(browser, s) {
  const ctx = await browser.newContext({ viewport: { width: 832, height: 1000 }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(`${BASE}?size=medium&${s.q}&dpr=1&quality=high`);
  await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
  await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
  // The camera with its back to the sun's opposite: looking at the sun, where the glints are.
  const aim = (at) => {
    const e = window.__engine;
    e.world.time = 100;
    const o = e.view.orbit;
    o.tx = at.x;
    o.ty = at.y;
    o.dist = at.dist;
    o.phi = 0.95;
    const v = e.view.looks.sunVector;
    o.theta = Math.atan2(-v.x, -v.z);
  };
  await page.evaluate(aim, AT);
  await page.waitForTimeout(3000);
  await page.evaluate(aim, AT);
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const e = window.__engine;
    e.world.time = 100;
    e.view.terrain.updateFine(0, true);
  });
  await page.waitForTimeout(2500);
  const png = await page.screenshot({ type: "png", timeout: 240_000 });
  writeFileSync(join(OUT, `${s.name}-${TAG}.png`), png);
  // The pixels, read back through a canvas.
  const pixels = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(0, 0, c.width, c.height).data);
  }, png.toString("base64"));
  await ctx.close();
  return pixels;
}

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
let on;
let off;
try {
  on = await shoot(browser, SHOTS[0]);
  off = await shoot(browser, SHOTS[1]);
} finally {
  await browser.close();
}

let water = 0;
let bright = 0;
for (let i = 0; i < off.length; i += 4) {
  const [r, g, b] = [off[i], off[i + 1], off[i + 2]];
  if (!(b > 110 && b > r + 40 && b > g + 5)) continue;
  water++;
  const l = (0.2126 * on[i] + 0.7152 * on[i + 1] + 0.0722 * on[i + 2]) / 255;
  if (l > BRIGHT) bright++;
}
const share = bright / Math.max(1, water);
const result = { tag: TAG, water, bright, share: Number(share.toFixed(4)), limit: LIMIT };
writeFileSync(join(OUT, `glints-${TAG}.json`), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
if (water < 20000) {
  console.error(`only ${water} water pixels: the camera missed the lake`);
  process.exit(1);
}
if (share >= LIMIT) {
  console.error(`${(share * 100).toFixed(2)}% of the water is brighter than ${BRIGHT}: glints too big (limit ${LIMIT * 100}%)`);
  process.exit(1);
}
