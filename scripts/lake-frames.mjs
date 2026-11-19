// Lakes with a floor (19 November, the owner: "not having a bottom for some lakes looks weird"). The
// Perf Lab at 832 by 1000 (a foldable open), on high and on medium, the same cameras before and
// after. For each lake, two frames: "look" aimed at a cell about 2.5 deep, "low" at its deepest
// cell from a lower angle (the cells fixed in ISLANDS, so the same before and after), each also
// drawn without its water ("-nowater"), to see the bed. On the temperate coast island of seed 7,
// "sea" frames the deepest open sea, to show it is unchanged.
// With BENCH=1, the frame's cost on high at the temperate lake's deepest cell (perfBench, 40 frames);
// with BENCH_ONLY=1 too, that alone.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/lake-frames.mjs <out dir> [tag]
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "lake-frames";
const TAG = process.argv[3] ?? "frame";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const QUALITIES = (process.env.QUALITIES ?? "high,medium").split(",");
// Each island and its cameras: [name, centre cell x, y, distance, angle from straight down]. The
// lakes' cells were found by bodies() (below) on main: on the temperate island the big lake's cell
// about 2.5 deep and its deepest (14.6), on the tundra island two lakes' (15.1 and 19.6 deep).
const ISLANDS = [
  [
    "temperate-lakes-7",
    "biome=temperate&shape=lakes&seed=7",
    [
      ["lake-look", 66.5, 95.5, 18, 0.75],
      ["lake-low", 46.5, 65.5, 20, 1.2],
    ],
  ],
  [
    "tundra-lakes-5",
    "biome=tundra&shape=lakes&seed=5",
    [
      ["lake0-look", 62.5, 35.5, 18, 0.75],
      ["lake0-low", 74.5, 33.5, 20, 1.2],
      ["lake1-look", 87.5, 100.5, 18, 0.75],
      ["lake1-low", 97.5, 96.5, 20, 1.2],
    ],
  ],
  ["temperate-coast-7", "biome=temperate&shape=coast&seed=7", [["sea"]]],
];
const SIZE = { width: 832, height: 1000 };
mkdirSync(OUT, { recursive: true });

// In the page: bodies of still water away from the island's edge, biggest first, and an open sea
// cell (wet, at the sea's level, the deepest at least 20 cells in from the island's edge).
function bodies() {
  const w = window.__engine.world;
  const n = w.w * w.h;
  const wet = (i) => w.fluid[i] === 1 && w.depth[i] > 0.06;
  const seen = new Int32Array(n).fill(-1);
  const out = [];
  for (let s = 0; s < n; s++) {
    if (!wet(s) || seen[s] >= 0) continue;
    const st = [s];
    seen[s] = out.length;
    let mid = s;
    let midE = 1e9;
    let size = 0;
    let edge = false;
    let maxD = 0;
    let deep = s;
    const cells = [];
    while (st.length) {
      const i = st.pop();
      const x = i % w.w;
      const y = (i - x) / w.w;
      size++;
      cells.push(y * 1000 + x);
      if (Math.abs(w.depth[i] - 2.5) < midE) {
        midE = Math.abs(w.depth[i] - 2.5);
        mid = i;
      }
      if (w.depth[i] > maxD) {
        maxD = w.depth[i];
        deep = i;
      }
      if (x === 0 || y === 0 || x === w.w - 1 || y === w.h - 1) edge = true;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const a = x + dx;
        const b = y + dy;
        if (a < 0 || b < 0 || a >= w.w || b >= w.h) continue;
        const j = b * w.w + a;
        if (wet(j) && seen[j] < 0) {
          seen[j] = out.length;
          st.push(j);
        }
      }
    }
    if (!edge && size >= 6)
      out.push({
        cells,
        size,
        maxD: +maxD.toFixed(2),
        deepX: (deep % w.w) + 0.5,
        deepY: Math.floor(deep / w.w) + 0.5,
        midX: (mid % w.w) + 0.5,
        midY: Math.floor(mid / w.w) + 0.5,
      });
  }
  out.sort((a, b) => b.size - a.size);
  let sea = null;
  for (let i = 0; i < n; i++) {
    if (w.fluid[i] !== 1 || w.height[i] + w.depth[i] > w.seaLevel + 0.05 || w.depth[i] < 3) continue;
    const x = i % w.w;
    const y = (i - x) / w.w;
    if (x < 20 || y < 20 || x >= w.w - 20 || y >= w.h - 20) continue;
    if (!sea || w.depth[i] > sea.d) sea = { x: x + 0.5, y: y + 0.5, d: w.depth[i] };
  }
  return { lakes: out, sea };
}

async function frame(page, at, dist, phi) {
  return page.evaluate(
    async ({ at, dist, phi }) => {
      const e = window.__engine;
      const o = e.view.orbit;
      o.tx = at.x;
      o.ty = at.y;
      o.dist = dist;
      o.phi = phi;
      o.theta = 0.6;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let k = 0; k < 3; k++) {
        await wait(1200);
        e.view.terrain.updateFine(0, true);
      }
      e.stop();
      e.render(0);
      e.render(0);
      e.render(0);
      const png = document.getElementById("world").toDataURL("image/png");
      const fm = e.view.terrain.fluidMaterial;
      // The water's materials hidden (the view sets its meshes' own visibility at each draw).
      const hid = new Set();
      e.view.scene.traverse((m) => {
        if (m.isMesh && m.visible && m.material && (m.material === fm || m.material.transparent)) hid.add(m.material);
      });
      hid.forEach((m) => (m.visible = false));
      e.render(0);
      const dry = document.getElementById("world").toDataURL("image/png");
      hid.forEach((m) => (m.visible = true));
      e.start?.();
      return [png, dry];
    },
    { at, dist, phi },
  );
}

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const rows = [];
try {
  for (const quality of QUALITIES) {
    for (const [name, q, views] of ISLANDS) {
      const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.on("pageerror", (err) => console.error("page error:", err.message));
      await page.goto(`${BASE}?size=medium&${q}&dpr=1&quality=${quality}&time=60`);
      await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
      await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
      const { lakes, sea } = await page.evaluate(bodies);
      const shots = [];
      for (const [shot, x, y, dist, phi] of views) {
        if (shot === "sea") {
          if (sea) shots.push(["sea", { x: sea.x, y: sea.y }, 22, 0.8, sea]);
        } else shots.push([shot, { x, y }, dist, phi, lakes.find((b) => b.cells.includes(Math.floor(y) * 1000 + Math.floor(x))) ?? null]);
      }
      for (const [shot, at, dist, phi, body] of process.env.BENCH_ONLY ? [] : shots) {
        const [png, dry] = await frame(page, at, dist, phi);
        const file = join(OUT, `${name}-${shot}-${quality}-${TAG}.png`);
        const bytes = Buffer.from(png.split(",")[1], "base64");
        writeFileSync(file, bytes);
        writeFileSync(file.replace(".png", "-nowater.png"), Buffer.from(dry.split(",")[1], "base64"));
        rows.push({
          quality,
          name,
          shot,
          at,
          body: body && { ...body, cells: undefined },
          file,
          sha: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
        });
        console.log(JSON.stringify(rows.at(-1)));
      }
      if (process.env.BENCH && quality === "high" && name === ISLANDS[0][0]) {
        const [, x, y] = views[1];
        await page.evaluate(
          ([x, y]) => {
            const o = window.__engine.view.orbit;
            o.tx = x;
            o.ty = y;
            o.dist = 16;
            o.phi = 0.9;
            o.theta = 0.6;
            window.__engine.view.terrain.updateFine(0, true);
          },
          [x, y],
        );
        await page.waitForTimeout(2000);
        const bench = await page.evaluate(() => window.perfBench(40));
        rows.push({ quality, name, bench });
        console.log("bench", JSON.stringify(bench));
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `lakes-${TAG}.json`), JSON.stringify(rows, null, 1));
