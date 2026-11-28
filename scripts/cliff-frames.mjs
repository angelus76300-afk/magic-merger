// Cliffs on their own line (27 November, the owner: "cliffs: rebuild", then "cliffs: flat walls";
// terrain-fine.ts cliffOutline). The Perf Lab on high, held still as made (still=1), each island
// drawn four ways with the same cameras: "off" (cliffs on the cells' sides, CLIFF_CORNER off),
// "main" (cliffCorner, the game before the outline), "prototype" (the outline with neither flat
// walls nor sharp corners, as on 27 November) and "walls" (the outline with the game's settings:
// sharp corners and flat walls). The camera target on each island is found by a scan of its cliffs
// for the longest off-axis run of at least 6 cells (a cliff between cells that do not join, more
// than 15 degrees off the axes, straight within 0.9 cell). Four cameras: "above" (phi 0.5, as the
// owner's screenshots), "play" (the play angle, close), "eye" (the eye view at the cliff's foot,
// looking at it) and "close" (a wall from a few cells away). At the sizes of SIZES (default 390 by
// 844 and 344 by 882). On each island at 390 by 844 it also measures, from the tops the fine land
// drew (Terrain.drawnTop): the lip's RMS distance from the run's line and its teeth (straight runs
// along an axis more than two columns longer than a true line's steps at that angle, at least 0.3
// cell), the land's triangles in view and the fine tiles' build time. Writes
// <out>/<island>-<camera>-<mode>-<size>.png and <out>/cliff-frames.json.
//
// SHOTS=island:camera,... draws only those; MODES=off,main,... and SIZES=390x844 limit the rest.
// BENCH=60 also times that many frames at 344 by 882 (the Z Fold folded) from the eye camera and a
// wide shot of the island (bench below), into cliff-frames.json's "bench" rows.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/cliff-frames.mjs <out dir>
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "cliff-frames";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const SHOTS = process.env.SHOTS ? process.env.SHOTS.split(",") : null;
const SIZES = (process.env.SIZES ?? "390x844,344x882").split(",").map((s) => s.split("x").map(Number));
// Each island: its name, the lab's query and what its run must have (lava at its foot, trees on its
// top).
const ISLANDS = [
  ["plateau-7", "size=medium&seed=7&biome=temperate&shape=plateau", null],
  ["desert-plateau-3", "size=small&seed=3&biome=desert&shape=plateau&relief=0.8", null],
  ["mesa-5", "size=medium&seed=5&biome=mesa&shape=plateau", null],
  ["volcanic-6", "size=medium&seed=6&biome=volcanic&shape=ridges&relief=0.9", "lava"],
  ["forest-plateau-2", "size=medium&seed=2&biome=temperate&shape=plateau&relief=0.7&forest=0.9", "trees"],
];
const MODES = [
  ["off", "cliffs=off"],
  ["main", "cliffs=corner"],
  ["prototype", "cliffs=outline&walls=0&sharp=0"],
  ["walls", "cliffs=outline"],
];
const ONLY_MODES = process.env.MODES ? process.env.MODES.split(",") : null;
mkdirSync(OUT, { recursive: true });

// In the page: the longest off-axis run of cliff on the island (needs: "lava" at its foot, "trees"
// on its top), as { x0, y0, x1, y1 } (its chord, lattice corners), its levels and its low side.
function scan(needs) {
  const e = window.__engine;
  const w = e.world;
  const t = e.view.terrain;
  const R = t.landRead;
  const W = w.w;
  const H = w.h;
  const LAVA = 3;
  const TREE = 1;
  const lava = (x, y) => w.fluid[y * W + x] === LAVA;
  const ok = (x, y) => x > 3 && y > 3 && x < W - 4 && y < H - 4 && R.natural(x, y) && !R.flat(x, y) && (!R.wet(x, y) || lava(x, y));
  const cliff = (ax, ay, bx, by) => {
    if (!ok(ax, ay) || !ok(bx, by)) return false;
    const dt = Math.abs(R.top(ax, ay) - R.top(bx, by));
    return dt >= 2 && !(R.steep(ax, ay) && R.steep(bx, by) && dt <= 8);
  };
  // The cliff's edges as links between lattice corners.
  const adj = new Map();
  const key = (x, y) => y * (W + 1) + x;
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  };
  for (let y = 1; y < H; y++)
    for (let x = 1; x < W; x++) {
      if (cliff(x - 1, y, x, y)) link(key(x, y), key(x, y + 1));
      if (cliff(x, y - 1, x, y)) link(key(x, y), key(x + 1, y));
    }
  // Chains between corners where the cliff branches or ends.
  const seen = new Set();
  const chains = [];
  for (const [a, ns] of adj) {
    if (ns.length === 2) continue;
    for (const b of ns) {
      const ek = Math.min(a, b) * 1e7 + Math.max(a, b);
      if (seen.has(ek)) continue;
      const chain = [a];
      let prev = a;
      let cur = b;
      seen.add(ek);
      for (;;) {
        chain.push(cur);
        const nn = adj.get(cur);
        if (nn.length !== 2) break;
        const nx = nn[0] === prev ? nn[1] : nn[0];
        const k2 = Math.min(cur, nx) * 1e7 + Math.max(cur, nx);
        if (seen.has(k2)) break;
        seen.add(k2);
        prev = cur;
        cur = nx;
      }
      chains.push(chain);
    }
  }
  // Loops with no branch.
  for (const [a, ns] of adj) {
    if (ns.length !== 2) continue;
    const ek = Math.min(a, ns[0]) * 1e7 + Math.max(a, ns[0]);
    if (seen.has(ek)) continue;
    const chain = [a];
    let prev = a;
    let cur = ns[0];
    seen.add(ek);
    for (;;) {
      chain.push(cur);
      const nn = adj.get(cur);
      const nx = nn[0] === prev ? nn[1] : nn[0];
      const k2 = Math.min(cur, nx) * 1e7 + Math.max(cur, nx);
      if (seen.has(k2)) break;
      seen.add(k2);
      prev = cur;
      cur = nx;
    }
    chains.push(chain);
  }
  const xy = (k) => [k % (W + 1), Math.floor(k / (W + 1))];
  let best = null;
  for (const chain of chains) {
    const P = chain.map(xy);
    for (let i = 0; i < P.length; i++) {
      for (let j = P.length - 1; j >= i + 6; j--) {
        const [ax, ay] = P[i];
        const [bx, by] = P[j];
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 6 || (best && len <= best.len)) continue;
        const ang = (Math.atan2(Math.abs(by - ay), Math.abs(bx - ax)) * 180) / Math.PI;
        if (ang < 15 || ang > 75) continue;
        // Straight within 0.9 cell, and going one way.
        const ux = (bx - ax) / len;
        const uy = (by - ay) / len;
        let straight = true;
        let back = false;
        for (let k = i; k <= j && straight; k++) {
          const [px, py] = P[k];
          if (Math.abs(-(px - ax) * uy + (py - ay) * ux) > 0.9) straight = false;
          if (k > i && (P[k][0] - P[k - 1][0]) * ux + (P[k][1] - P[k - 1][1]) * uy < -0.01) back = true;
        }
        if (!straight || back) continue;
        // The run's two sides: the cells beside its middle edges.
        const mid = P[Math.floor((i + j) / 2)];
        const nx = -uy;
        const ny = ux;
        const sa = [Math.floor(mid[0] + nx * 0.7), Math.floor(mid[1] + ny * 0.7)];
        const sb = [Math.floor(mid[0] - nx * 0.7), Math.floor(mid[1] - ny * 0.7)];
        const ta = R.top(sa[0], sa[1]);
        const tb = R.top(sb[0], sb[1]);
        const lowA = ta < tb;
        // What the run needs, along its length.
        if (needs) {
          let n = 0;
          for (let k = i; k <= j; k++) {
            const [px, py] = P[k];
            const s = lowA ? 1 : -1;
            const lx = Math.floor(px + nx * 0.7 * s);
            const ly = Math.floor(py + ny * 0.7 * s);
            const hx = Math.floor(px - nx * 0.7 * s);
            const hy = Math.floor(py - ny * 0.7 * s);
            if (needs === "lava" && lava(lx, ly)) n++;
            if (needs === "trees" && w.cover[hy * W + hx] === TREE) n++;
          }
          if (n < 2) continue;
        }
        best = {
          len,
          ang,
          x0: ax,
          y0: ay,
          x1: bx,
          y1: by,
          lo: Math.min(ta, tb),
          hi: Math.max(ta, tb),
          // The low side's direction (cells).
          lowX: lowA ? nx : -nx,
          lowY: lowA ? ny : -ny,
        };
        break;
      }
    }
  }
  return best;
}

// In the page: the lip the fine land drew along the run (Terrain.drawnTop), its RMS distance from
// the run's chord (best offset) and its teeth; the land's triangles in view; the tiles' build time.
function measure(run) {
  const e = window.__engine;
  const t = e.view.terrain;
  const W = e.world.w;
  const cx = Math.floor((run.x0 + run.x1) / 2);
  const cy = Math.floor((run.y0 + run.y1) / 2);
  const sub = t.fineLevel[Math.floor(cy / 32) * t.cols + Math.floor(cx / 32)] || 8;
  const Q = 1 / sub;
  const len = Math.hypot(run.x1 - run.x0, run.y1 - run.y0);
  const ux = (run.x1 - run.x0) / len;
  const uy = (run.y1 - run.y0) / len;
  const level = (run.lo + run.hi) / 2;
  const x0 = Math.floor(Math.min(run.x0, run.x1)) - 2;
  const y0 = Math.floor(Math.min(run.y0, run.y1)) - 2;
  const x1 = Math.ceil(Math.max(run.x0, run.x1)) + 2;
  const y1 = Math.ceil(Math.max(run.y0, run.y1)) + 2;
  const nx = (x1 - x0) * sub;
  const ny = (y1 - y0) * sub;
  // Column (i, j): high (1), low (0), outside the run's band (-1).
  const g = new Int8Array(nx * ny);
  // Terrain.drawnTop, but on a lava cell too: a cliff into lava fills the lava's cells with rock
  // columns (drawnTop is NaN on every wet cell, which counted them as low).
  const top = (x, y) => {
    const i = Math.floor(y) * W + Math.floor(x);
    if (!t.wet[i]) return t.drawnTop(x, y);
    const c = Math.floor(Math.floor(y) / 32) * t.cols + Math.floor(Math.floor(x) / 32);
    const f = t.fineTops[c];
    if (!f || !t.fineShown[c]) return NaN;
    const s = t.fineLevel[c];
    const sx = (Math.floor(x) - f.x0) * s + Math.min(s - 1, Math.floor((x - Math.floor(x)) * s));
    const sy = (Math.floor(y) - f.y0) * s + Math.min(s - 1, Math.floor((y - Math.floor(y)) * s));
    return f.h[sy * f.stride + sx] / s;
  };
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const px = x0 + (i + 0.5) * Q;
      const py = y0 + (j + 0.5) * Q;
      const s = (px - run.x0) * ux + (py - run.y0) * uy;
      const d = -(px - run.x0) * uy + (py - run.y0) * ux;
      if (s < 1 || s > len - 1 || Math.abs(d) > 1.6) {
        g[j * nx + i] = -1;
        continue;
      }
      const h = top(px, py);
      g[j * nx + i] = Number.isNaN(h) ? 0 : h >= level ? 1 : 0;
    }
  const mids = [];
  const runsX = [];
  const runsY = [];
  for (let j = 1; j < ny; j++) {
    let n = 0;
    for (let i = 0; i <= nx; i++) {
      const a = i < nx ? g[(j - 1) * nx + i] : -1;
      const b = i < nx ? g[j * nx + i] : -1;
      if (a >= 0 && b >= 0 && a !== b) {
        mids.push([x0 + (i + 0.5) * Q, y0 + j * Q]);
        n++;
      } else if (n) {
        runsX.push(n * Q);
        n = 0;
      }
    }
  }
  for (let i = 1; i < nx; i++) {
    let n = 0;
    for (let j = 0; j <= ny; j++) {
      const a = j < ny ? g[j * nx + i - 1] : -1;
      const b = j < ny ? g[j * nx + i] : -1;
      if (a >= 0 && b >= 0 && a !== b) {
        mids.push([x0 + i * Q, y0 + (j + 0.5) * Q]);
        n++;
      } else if (n) {
        runsY.push(n * Q);
        n = 0;
      }
    }
  }
  const ds = mids.map(([px, py]) => -(px - run.x0) * uy + (py - run.y0) * ux);
  const mean = ds.reduce((s, v) => s + v, 0) / Math.max(1, ds.length);
  const rms = Math.sqrt(ds.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, ds.length));
  const tan = Math.abs(uy / ux);
  const idealX = tan < 1e-6 ? Infinity : Q / tan;
  const idealY = Q * tan;
  const long = (ideal) => (v) => v >= 0.3 && v > ideal + 2 * Q + 1e-9;
  const teeth = runsX.filter(long(idealX)).length + runsY.filter(long(idealY)).length;
  let tris = 0;
  e.view.scene.traverse((m) => {
    if (m.isMesh && m.material === t.landMaterial && m.geometry) {
      const idx = m.geometry.index;
      tris += (idx ? idx.count : m.geometry.attributes.position.count) / 3;
    }
  });
  const ms = [...t.fineStats.tileMs].sort((a, b) => a - b);
  const at = (p) => (ms.length ? +ms[Math.min(ms.length - 1, Math.floor(p * ms.length))].toFixed(2) : 0);
  return {
    sub,
    rms: +rms.toFixed(3),
    teeth,
    per10: +((teeth / len) * 10).toFixed(2),
    lipPoints: mids.length,
    tris,
    tiles: ms.length,
    tileP50: at(0.5),
    tileP95: at(0.95),
    W,
  };
}

// Draw the island from a camera, every fine chunk built, and return the frame.
async function shoot(page, cam) {
  return page.evaluate(async (cam) => {
    const e = window.__engine;
    const o = e.view.orbit;
    if (o.eye) o.eyeOff();
    if (cam.eye) o.eyeOn(cam.yaw, cam.x, cam.y, cam.h);
    else {
      o.tx = cam.x;
      o.ty = cam.y;
      o.dist = cam.dist;
      o.phi = cam.phi;
      o.theta = cam.theta;
    }
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let k = 0; k < 4; k++) {
      e.render(0.1);
      e.view.terrain.updateFine(0, true);
      await wait(50);
    }
    if (cam.eye) o.eye.pitch = cam.pitch;
    e.render(0);
    e.render(0);
    return document.getElementById("world").toDataURL("image/png");
  }, cam);
}

// Frame time with the camera held: n frames drawn, each waited for (a one pixel read back), ms
// p50 / p95 of the draw (JavaScript) and of the whole frame, and the triangles drawn.
async function bench(page, cam, n) {
  await shoot(page, cam);
  return page.evaluate((n) => {
    const e = window.__engine;
    const gl = e.view.renderer.getContext();
    const px = new Uint8Array(4);
    const draw = [];
    const frame = [];
    for (let f = 0; f < n; f++) {
      const t0 = performance.now();
      e.render(1 / 30);
      const t1 = performance.now();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      draw.push(t1 - t0);
      frame.push(performance.now() - t0);
    }
    const pick = (a) => {
      const s = [...a].sort((x, y) => x - y);
      const at = (p) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1);
      return [at(0.5), at(0.95)];
    };
    return { frames: n, draw: pick(draw), frame: pick(frame), triangles: e.view.counts().triangles };
  }, n);
}

function cameras(run, groundAt) {
  // Every point a camera stands on or looks at is a cell's middle, which no mode moves: the same
  // ground under it in each mode, so the frames line up (the orbit eases to groundAt of its target).
  const mid = (v) => Math.floor(v) + 0.5;
  const mx = mid((run.x0 + run.x1) / 2 - run.lowX);
  const my = mid((run.y0 + run.y1) / 2 - run.lowY);
  // The camera's offset along the ground is (sin theta, cos theta): on the low side, a little turned.
  const theta = Math.atan2(run.lowX, run.lowY) + 0.35;
  const fx = mid((run.x0 + run.x1) / 2 + run.lowX * 2.6);
  const fy = mid((run.y0 + run.y1) / 2 + run.lowY * 2.6);
  return [
    ["above", { x: mx, y: my, dist: 26, phi: 0.5, theta }],
    ["play", { x: mx, y: my, dist: 13, phi: 0.95, theta }],
    ["eye", { eye: true, x: fx, y: fy, h: groundAt + 1.1, yaw: Math.atan2(-run.lowY, -run.lowX) + 0.25, pitch: 0.12 }],
    // Up close: a few cells from the wall's middle, looking along it a little (the ribs, 27 November).
    ["close", { x: mid((run.x0 + run.x1) / 2), y: mid((run.y0 + run.y1) / 2), dist: 6, phi: 1.2, theta: theta + 0.5 }],
  ];
}

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const rows = [];
try {
  for (const [name, q, needs] of ISLANDS) {
    if (SHOTS && !SHOTS.some((x) => x.startsWith(`${name}:`))) continue;
    for (const [mode, mq] of MODES) {
      if (ONLY_MODES && !ONLY_MODES.includes(mode)) continue;
      for (const [width, height] of SIZES) {
        const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        page.on("pageerror", (err) => console.error("page error:", err.message));
        await page.goto(`${BASE}?${q}&${mq}&dpr=1&quality=high&time=60&still=1`);
        await page.waitForFunction(() => window.perfReady === true, null, { timeout: 240_000 });
        await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
        const run = await page.evaluate(scan, needs);
        if (!run) {
          console.error(`${name}: no off-axis cliff run of 6 cells`);
          await ctx.close();
          continue;
        }
        const foot = await page.evaluate(({ x, y }) => window.__engine.view.terrain.groundAt(x, y), {
          x: Math.floor((run.x0 + run.x1) / 2 + run.lowX * 2.6) + 0.5,
          y: Math.floor((run.y0 + run.y1) / 2 + run.lowY * 2.6) + 0.5,
        });
        for (const [cam, c] of cameras(run, foot)) {
          if (SHOTS && !SHOTS.includes(`${name}:${cam}`)) continue;
          const png = await shoot(page, c);
          const file = join(OUT, `${name}-${cam}-${mode}-${width}.png`);
          writeFileSync(file, Buffer.from(png.split(",")[1], "base64"));
          console.log(file);
        }
        if (process.env.BENCH && width === 344) {
          const all = cameras(run, foot);
          const eye = all.find(([c]) => c === "eye")[1];
          const wide = { ...all.find(([c]) => c === "play")[1], dist: 60 };
          for (const [cam, c] of [
            ["eye", eye],
            ["wide", wide],
          ]) {
            rows.push({ bench: true, name, mode, cam, size: `${width}x${height}`, ...(await bench(page, c, Number(process.env.BENCH))) });
            console.log(JSON.stringify(rows.at(-1)));
          }
        }
        // Measured once, at the phone's size, after the play camera's chunks (close, in eighths).
        if (width === SIZES[0][0]) {
          await shoot(page, cameras(run, foot)[1][1]);
          const m = await page.evaluate(measure, run);
          rows.push({ name, mode, run: { ...run, len: +run.len.toFixed(1), ang: +run.ang.toFixed(1) }, ...m });
          console.log(JSON.stringify(rows.at(-1)));
        }
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
  writeFileSync(join(OUT, "cliff-frames.json"), JSON.stringify(rows, null, 1) + "\n");
}
