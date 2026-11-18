// The night's glow, what it costs and what it hides (18 November, the owner's Fold at night on high:
// 4.5 to 6 million triangles, 29 to 33 frames a second). The Perf Lab held still at night on high,
// at fixed cameras: the triangles of a frame with bloom and without, the triangles of the glow mask
// alone, a frame's time over a fixed bench (software WebGL: compare runs with each other, not with
// a phone), and one PNG per camera. Then the occlusion check: a glowing cube behind a hill, one behind
// a wall a sixth of a cell thick and one buried under the land must stay dark in the glow mask, and the same cubes drawn
// through everything (no depth test) must show in it, so the check can fail.
//
//   npx vite --port 5174 &
//   NODE_PATH=$(npm root -g) node scripts/night-glow-proof.mjs <out dir> <tag>
//   SIZES=832x1000,344x882 LAB_URL=http://localhost:5174/lab/perf.html ...
//
// Exits 1 when bloom adds more than MAX_EXTRA of the triangles, or a hidden cube shows.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "night-glow";
const TAG = process.argv[3] ?? "frame";
const BASE = process.env.LAB_URL ?? "http://localhost:5174/lab/perf.html";
const SIZES = (process.env.SIZES ?? "832x1000,344x882").split(",").map((s) => s.split("x").map(Number));
const FRAMES = Number(process.env.FRAMES ?? 7);
const MAX_EXTRA = Number(process.env.MAX_EXTRA ?? 0.2);
const QUERY = "biome=temperate&shape=coast&seed=7";
const NIGHT = 263;
// The village by the shore, close (as water-light-frames.mjs "night"), and the island at a mid zoom.
const CAMERAS = {
  village: { at: { x: 97.5, y: 73.5 }, dist: 18, phi: 1.0, theta: 0.5 },
  mid: { at: { x: 90.5, y: 80.5 }, dist: 40, phi: 0.95, theta: 0.8 },
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const rows = [];
let failed = false;
try {
  for (const [W, H] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("page error:", err.message));
    page.on("console", (m) => m.type() === "error" && console.error("console:", m.text().slice(0, 400)));
    // No frame runs by itself (the simulation would move on with the clock), and Math.random is seeded.
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0;
      let s = 12345;
      Math.random = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    });
    await page.goto(`${BASE}?size=medium&${QUERY}&dpr=1&quality=high&time=${NIGHT}`);
    await page.waitForFunction(() => window.perfReady === true, null, { timeout: 180_000 });
    await page.evaluate(() => document.querySelectorAll("div").forEach((d) => (d.style.display = "none")));
    for (const [name, c] of Object.entries(CAMERAS)) {
      const r = await page.evaluate(
        async ({ c, frames, night, probe }) => {
          const e = window.__engine;
          const w = e.world;
          const g = window.__graphics;
          const wait = (ms) => new Promise((res) => setTimeout(res, ms));
          const o = e.view.orbit;
          o.tx = c.at.x;
          o.ty = c.at.y;
          o.dist = c.dist;
          o.phi = c.phi;
          o.theta = c.theta;
          const settle = async () => {
            e.view.waterLightsAt = -1e9;
            for (let k = 0; k < 40; k++) e.render(0.1);
            await wait(1500);
            e.view.terrain.updateFine(0, true);
            e.view.waterLightsAt = -1e9;
            for (let k = 0; k < 40; k++) e.render(0.1);
            await wait(1500);
            e.view.terrain.updateFine(0, true);
          };
          await settle();
          e.stop();
          w.time = night;
          const looks = e.view.looks;
          const r = e.view.renderer;
          // The glow mask's own triangles, counted round it.
          const inner = looks.drawGlowMask;
          let maskTris = 0;
          looks.drawGlowMask = (...a) => {
            const before = r.info.render.triangles;
            inner(...a);
            maskTris += r.info.render.triangles - before;
          };
          const frame = () => {
            maskTris = 0;
            e.render(0);
            return { tris: e.view.counts().triangles, calls: e.view.counts().calls, mask: maskTris };
          };
          const gl = r.getContext();
          const px = new Uint8Array(4);
          const time = () => {
            const times = [];
            for (let f = 0; f < frames; f++) {
              const t0 = performance.now();
              o.orbit(0.0001, 0);
              e.render(0);
              gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
              times.push(performance.now() - t0);
            }
            times.sort((a, b) => a - b);
            return Math.round(times[times.length >> 1]);
          };
          frame();
          frame();
          const on = frame();
          const bloom = looks.bloomAmount;
          const png = document.getElementById("world").toDataURL("image/png");
          const msOn = time();
          g.bloom = false;
          frame();
          frame();
          const off = frame();
          const msOff = time();
          g.bloom = true;
          frame();
          frame();
          const out = { on, off, bloom, msOn, msOff, png };
          if (!probe) return out;

          // The occlusion check. A glowing cube is one more thing that glows (userData.glow, as a
          // spell's glowing body is marked); the mask is read at the middle of each cube.
          const T = window.__three;
          const cam = o.camera;
          cam.updateMatrixWorld();
          const scene = e.view.scene;
          const toScene = (x, y, h) => new T.Vector3(x - w.w / 2, h, y - w.h / 2);
          const ground = (x, y) => e.view.groundAt(x, y);
          const cube = (p, size) => {
            const m = new T.Mesh(new T.BoxGeometry(size, size, size), new T.MeshBasicMaterial({ color: 0xffffff }));
            m.position.copy(p);
            m.userData.glow = true;
            scene.add(m);
            return m;
          };
          const mask = looks.post.mask;
          const buf = new Uint8Array(4 * 9);
          const read = (m) => {
            if (!m) return -1;
            cam.updateMatrixWorld();
            const n = m.position.clone().project(cam);
            const mx = Math.floor(((n.x + 1) / 2) * mask.width);
            const my = Math.floor(((n.y + 1) / 2) * mask.height);
            if (mx < 1 || my < 1 || mx > mask.width - 2 || my > mask.height - 2 || n.z > 1) return -1;
            buf.fill(0);
            r.readRenderTargetPixels(mask, mx - 1, my - 1, 3, 3, buf);
            let best = 0;
            for (let k = 0; k < 9; k++) best = Math.max(best, buf[4 * k], buf[4 * k + 1], buf[4 * k + 2]);
            return best;
          };
          // The mask where each cube is: before it is laid (other things glow there too), laid, and
          // laid drawn through everything.
          const empty = {};
          const seen = {};
          const through = {};
          const look = (cubes) => {
            const all = () => {
              frame();
              frame();
              return Object.fromEntries(Object.entries(cubes).map(([k, m]) => [k, read(m)]));
            };
            for (const m of Object.values(cubes)) if (m) m.visible = false;
            Object.assign(empty, all());
            for (const m of Object.values(cubes)) if (m) m.visible = true;
            Object.assign(seen, all());
            for (const m of Object.values(cubes)) if (m) m.material.depthTest = false;
            Object.assign(through, all());
            for (const m of Object.values(cubes)) if (m) scene.remove(m);
          };
          // A cube in the open six cells over the target, one to its right (a third of the way to the screen's
          // edge) behind a wall a sixth of a cell thick two cells toward the camera, and one as far
          // to its left buried a cell and a half under the land.
          const eye = cam.position.clone();
          const right = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
          const side = (o.dist * Math.tan(((cam.fov / 2) * Math.PI) / 180) * cam.aspect) / 3;
          const over = (k, h) => {
            const dx = k * side;
            const x = c.at.x + right.x * dx;
            const y = c.at.y + right.z * dx;
            return toScene(x, y, ground(x, y) + h);
          };
          const behind = over(1, 3);
          const wall = new T.Mesh(new T.BoxGeometry(3, 3, 1 / 6), new T.MeshBasicMaterial({ color: 0x404040 }));
          wall.position.copy(behind).addScaledVector(eye.clone().sub(behind).normalize(), 2);
          wall.lookAt(eye);
          scene.add(wall);
          look({ open: cube(over(0, 6), 1), wall: cube(behind, 1), buried: cube(over(-1, -1.5), 1) });
          scene.remove(wall);
          // A cube behind a hill, seen from low over the land: the cell whose middle, a cell above
          // the ground, is the deepest under the land along the camera's line to it.
          o.dist = 30;
          o.phi = 1.38;
          for (let k = 0; k < 40; k++) e.render(0.1);
          e.view.terrain.updateFine(0, true);
          for (let k = 0; k < 10; k++) e.render(0.1);
          cam.updateMatrixWorld();
          const low = cam.position.clone();
          let hill = null;
          let deepest = 0;
          for (let y = Math.floor(c.at.y) - 40; y <= c.at.y + 40; y++)
            for (let x = Math.floor(c.at.x) - 40; x <= c.at.x + 40; x++) {
              if (x < 2 || y < 2 || x >= w.w - 2 || y >= w.h - 2) continue;
              const p = toScene(x + 0.5, y + 0.5, ground(x + 0.5, y + 0.5) + 1);
              const n = p.clone().project(cam);
              if (Math.abs(n.x) > 0.7 || Math.abs(n.y) > 0.7 || n.z > 1) continue;
              const len = low.distanceTo(p);
              let under = 0;
              for (let t = 0; t < len - 3; t += 0.25) {
                const q = low.clone().lerp(p, t / len);
                const qx = q.x + w.w / 2;
                const qy = q.z + w.h / 2;
                if (qx < 0 || qy < 0 || qx >= w.w || qy >= w.h) continue;
                if (q.y < ground(qx, qy) - 0.75) under += 0.25;
              }
              if (under > deepest) {
                deepest = under;
                hill = p;
              }
            }
          look({ hill: hill ? cube(hill, 1) : null });
          frame();
          return { ...out, probe: { deepest, empty, seen, through } };
        },
        { c, frames: FRAMES, night: NIGHT, probe: name === "village" },
      );
      const extra = r.on.tris / r.off.tris - 1;
      writeFileSync(join(OUT, `${name}-${W}x${H}-${TAG}.png`), Buffer.from(r.png.split(",")[1], "base64"));
      const row = {
        camera: name,
        size: `${W}x${H}`,
        tag: TAG,
        bloom: Math.round(r.bloom * 100) / 100,
        trisOn: r.on.tris,
        trisOff: r.off.tris,
        mask: r.on.mask,
        extra: `${Math.round(extra * 1000) / 10}%`,
        calls: [r.on.calls, r.off.calls],
        msOn: r.msOn,
        msOff: r.msOff,
        ...(r.probe ? { probe: r.probe } : {}),
      };
      rows.push(row);
      console.log(JSON.stringify(row));
      if (r.bloom < 0.01) {
        console.error(`FAIL ${name} ${W}x${H}: no bloom at this camera, nothing measured`);
        failed = true;
      }
      if (extra > MAX_EXTRA) {
        console.error(`FAIL ${name} ${W}x${H}: bloom adds ${row.extra} of the triangles (at most ${MAX_EXTRA * 100}%)`);
        failed = true;
      }
      if (r.probe) {
        const p = r.probe;
        for (const k of ["wall", "buried", "hill"]) {
          if (p.through[k] < 0) {
            console.error(`FAIL ${k}: no place on the screen found for the cube`);
            failed = true;
          } else if (p.through[k] < 128) {
            console.error(`FAIL ${k}: the cube drawn through everything does not show in the mask (${p.through[k]}), the check cannot fail`);
            failed = true;
          } else if (p.seen[k] > p.empty[k] + 16) {
            console.error(`FAIL ${k}: the hidden cube shows in the glow mask (${p.empty[k]} without it, ${p.seen[k]} with it)`);
            failed = true;
          }
        }
        if (p.seen.open < 128) {
          console.error(`FAIL open: a cube in the open does not glow (${p.seen.open})`);
          failed = true;
        }
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `numbers-${TAG}.json`), JSON.stringify(rows, null, 2) + "\n");
process.exit(failed ? 1 : 0);
