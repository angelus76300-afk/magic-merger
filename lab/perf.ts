// Perf Lab (4.4): one island as the World tab shows it, full screen, with the
// frame HUD's own numbers read back. scripts/perf-phone.mjs opens it in a
// phone sized browser, turns the camera slowly as a player would, and prints
// the HUD summary, so every change to the land or the view is measured the
// same way before and after.
import { Engine, type WorldSize } from "../src/sim/engine";
import { Hud, type PerfSummary } from "../src/sim/hud";
import { readChoice, readLand, resolveLand } from "../src/sim/land";
import { WORLD_SIZES } from "../src/sim/sizes";
import { GRAPHICS, type GraphicsFlag } from "../src/sim/voxel/graphics";
import { LAB_WEATHER } from "../src/sim/voxel/sky";

const q = new URLSearchParams(location.search);
const canvas = document.getElementById("world") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLCanvasElement;
const size = (q.get("size") ?? "medium") as WorldSize;
const seed = Number(q.get("seed") ?? 7);
// 4.4: "off=ao,water" turns improvements off; "biome=desert&shape=lakes" picks
// the land ("land=old" for the island before 4.4); "weather=rain" holds one.
for (const f of (q.get("off") ?? "").split(",")) if (f in GRAPHICS) GRAPHICS[f as GraphicsFlag] = false;
const weather = q.get("weather");
if (weather === "rain" || weather === "snow" || weather === "fog") LAB_WEATHER.now = { kind: weather, amount: 1 };
// 4.4.1: "mixed=1" makes the island the game would, from the seed and the
// sliders ("warmth=0.8&water=0.3").
const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
const land =
  q.get("land") === "old"
    ? undefined
    : q.has("mixed")
      ? resolveLand(readChoice({ warmth: num("warmth"), water: num("water"), relief: num("relief"), forest: num("forest") }), seed, WORLD_SIZES[size])
      : readLand({ biome: q.get("biome"), shape: q.get("shape") });
const engine = Engine.create(canvas, overlay, size, { onError: () => {}, onTap: () => {} }, seed, {}, land);
if (q.has("time")) engine.world.time = Number(q.get("time"));
engine.view.orbit.dist = Math.max(engine.world.w, engine.world.h) * Number(q.get("dist") ?? 0.42);
if (q.has("phi")) engine.view.orbit.phi = Number(q.get("phi"));
if (q.has("theta")) engine.view.orbit.theta = Number(q.get("theta"));
if (q.has("dpr")) engine.view.fixedPixelRatio = Number(q.get("dpr"));
const hud = new Hud(engine.stats);
hud.show(true);
engine.start();
(window as unknown as { __engine: Engine }).__engine = engine;

declare global {
  interface Window {
    perfReady: boolean;
    perfRun: (seconds: number) => Promise<PerfSummary & { chunks: number }>;
    perfBench: (frames: number) => Bench;
  }
}

// Turns the camera a little every frame (a slow drag), so the view draws
// every frame instead of only on simulation ticks.
window.perfRun = async (seconds: number) => {
  engine.stats.reset();
  const until = performance.now() + seconds * 1000;
  await new Promise<void>((resolve) => {
    const turn = () => {
      engine.view.orbit.orbit(1.5, 0);
      if (performance.now() < until) requestAnimationFrame(turn);
      else resolve();
    };
    requestAnimationFrame(turn);
  });
  return { ...engine.stats.summary(), chunks: engine.view.stats().chunks };
};
interface Bench {
  frames: number;
  // Per simulation tick, per draw (JavaScript), and waiting for the software
  // GPU to finish the frame, ms p50 / p95.
  tick: [number, number];
  draw: [number, number];
  raster: [number, number];
  calls: number;
  triangles: number;
  pixelRatio: number;
}

// The same work every time, whatever the frame rate: one tick, a small turn
// of the camera, one draw, then a one pixel read back that waits for the
// frame to be rasterized. The HUD's numbers depend on how many ticks fit in
// a frame; these do not.
window.perfBench = (frames: number) => {
  engine.stop();
  const gl = engine.view.renderer.getContext();
  const px = new Uint8Array(4);
  const tick: number[] = [];
  const draw: number[] = [];
  const raster: number[] = [];
  for (let f = 0; f < frames; f++) {
    const t0 = performance.now();
    engine.step();
    const t1 = performance.now();
    engine.view.orbit.orbit(1.5, 0);
    engine.render(1 / 30);
    const t2 = performance.now();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t3 = performance.now();
    tick.push(t1 - t0);
    draw.push(t2 - t1);
    raster.push(t3 - t2);
  }
  engine.start();
  const pick = (a: number[]): [number, number] => {
    const s = [...a].sort((x, y) => x - y);
    const at = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10;
    return [at(0.5), at(0.95)];
  };
  const c = engine.view.counts();
  return { frames, tick: pick(tick), draw: pick(draw), raster: pick(raster), calls: c.calls, triangles: c.triangles, pixelRatio: c.pixelRatio };
};
window.perfReady = true;
