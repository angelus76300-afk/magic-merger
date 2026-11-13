// Chimney smoke and other particles that do not glow are soft round puffs lit
// by the day, not the hard white squares that floated over every village (the
// lead's review, 13 November). Draws one smoke puff over a village in the Perf
// Lab, alone over the sky, and reads the pixels: inside its square but outside its circle the frame
// must be as it was without it, its middle must show it, and at night it must
// not be white. Exit code 1 if not.
//
//   npx vite --port 5191 &
//   node scripts/puff-proof.mjs
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const base = process.env.LAB_URL ?? "http://localhost:5191/lab/perf.html";
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(`${base}?size=medium&seed=7&dpr=1&quality=low`);
await page.waitForFunction(() => window.perfReady === true, null, { timeout: 120_000 });
const r = await page.evaluate(() => {
  const e = window.__engine;
  e.stop();
  const w = e.world;
  const s = w.settlements[0] ?? { x: w.w / 2, y: w.h / 2 };
  const o = e.view.orbit;
  o.tx = s.x;
  o.ty = s.y;
  o.dist = 30;
  o.phi = 0.95;
  o.theta = Math.PI * 0.25;
  const gl = e.view.renderer.getContext();
  // No chimney puffs or spray of their own while drawing: only the one placed here.
  const random = Math.random;
  const draw = (clock) => {
    window.__labSky.time = clock;
    Math.random = () => 0.99;
    for (let f = 0; f < 4; f++) e.render(1 / 30);
    Math.random = random;
  };
  const px = (x, y) => {
    const out = new Uint8Array(4);
    gl.readPixels(Math.round(x), Math.round(gl.drawingBufferHeight - y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return [...out.slice(0, 3)];
  };
  const p = w.particles;
  // The puff alone over the sky, so nothing else that moves between two frames (villagers, smoke
  // of the island's own) changes the pixels read: the daylight still tints it.
  const keep = new Set([e.view.dullPoints, e.view.scene]);
  e.view.scene.traverse((ob) => {
    if (!keep.has(ob) && ob.parent === e.view.scene) ob.visible = false;
  });
  // The land is built a few chunks a frame: every chunk first.
  for (let k = 0; k < 15; k++) draw(40);
  const one = (clock) => {
    p.life.fill(0);
    // Twice: the first frames after a change of the hour still move (the sky and the mist settle).
    draw(clock);
    draw(clock);
    const cam = o.camera;
    const at = cam.position.clone().set(s.x - w.w / 2, e.view.groundAt(s.x, s.y) + 3, s.y - w.h / 2);
    const z = -at.clone().applyMatrix4(cam.matrixWorldInverse).z;
    const ndc = at.clone().project(cam);
    const cx = ((ndc.x + 1) / 2) * gl.drawingBufferWidth;
    const cy = ((1 - ndc.y) / 2) * gl.drawingBufferHeight;
    const size = 6;
    const half = (size * 0.45 * e.view.dullPoints.material.uniforms.scale.value) / z / 2;
    const corner = [cx + half * 0.85, cy + half * 0.85];
    const before = { mid: px(cx, cy), corner: px(...corner) };
    draw(clock);
    const again = px(...corner);
    p.life.fill(0);
    p.add({ x: s.x, y: s.y, z: 3, vz: 0, life: 10, color: 0xd8d4cc, size, glow: false, gravity: 0, drag: 1 });
    draw(clock);
    const after = { mid: px(cx, cy), corner: px(...corner) };
    const diff = (a, b) => a.reduce((n, v, k) => n + Math.abs(v - b[k]), 0);
    return {
      noise: diff(before.corner, again),
      half: Math.round(half),
      cornerChange: diff(before.corner, after.corner),
      midChange: diff(before.mid, after.mid),
      mid: after.mid,
    };
  };
  return { day: one(40), night: one(262) };
});

await browser.close();

const light = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const checks = [
  ["the frame holds still without the puff (so the next check means something)", r.day.noise <= 4 && r.night.noise <= 4, `${r.day.noise}, ${r.night.noise}`],
  ["a puff is round: the corner of its square is as it was without it", r.day.cornerChange <= 12, `changed by ${r.day.cornerChange}`],
  ["a puff shows in its middle", r.day.midChange >= 30, `changed by ${r.day.midChange}`],
  ["at night a puff is not white", light(r.night.mid) < 0.6, `light ${light(r.night.mid).toFixed(2)}`],
];
let failed = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail} (puff ${r.day.half * 2} px across)`);
}
process.exit(failed ? 1 : 0);
