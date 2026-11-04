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
import { firstLook } from "../src/sim/firstlook";
import { readDef, type WonderDef } from "../src/sim/wonders";

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
// 4.4.5 part C: "pool=1" hands new islands the live wonders of lab/wonders
// (those the nightly test passed), as the World tab does with the server's pool.
const LIVE = ["aurora-ice-spires", "moon-mire"];
const files = import.meta.glob("./wonders/*.json", { eager: true, import: "default" }) as Record<string, unknown>;
const pool = q.has("pool")
  ? Object.entries(files)
      .filter(([path]) => LIVE.some((n) => path.endsWith(`/${n}.json`)))
      .map(([, v]) => readDef(v))
      .filter((d): d is WonderDef => d !== null)
  : [];
const engine = Engine.create(canvas, overlay, size, { onError: () => {}, onTap: () => {} }, seed, {}, land, [], pool);
if (q.has("time")) engine.world.time = Number(q.get("time"));
engine.view.orbit.dist = Math.max(engine.world.w, engine.world.h) * Number(q.get("dist") ?? 0.42);
if (q.has("phi")) engine.view.orbit.phi = Number(q.get("phi"));
if (q.has("theta")) engine.view.orbit.theta = Number(q.get("theta"));
// 4.4.5: "tx=40&ty=60" looks at that cell (a rare variant, a village).
if (q.has("tx")) engine.view.orbit.tx = Number(q.get("tx"));
if (q.has("ty")) engine.view.orbit.ty = Number(q.get("ty"));
if (q.has("dpr")) engine.view.fixedPixelRatio = Number(q.get("dpr"));
// 4.4.5 part B: "look=1" plays the first look at the island, as a new one opens.
if (q.has("look")) {
  const card = document.createElement("div");
  card.id = "first-look";
  card.hidden = true;
  card.style.cssText =
    "position:absolute;left:50%;bottom:18px;transform:translateX(-50%);width:min(360px,calc(100% - 32px));box-sizing:border-box;padding:12px 14px 10px;border-radius:14px;background:rgba(18,14,34,.86);color:#f2eefc;font:13px/1.4 system-ui,sans-serif;text-align:center";
  const css = document.createElement("style");
  css.textContent =
    "#first-look[hidden]{display:none}#first-look .title{margin:0;font-size:19px;font-weight:600}#first-look .what{margin:2px 0 0;color:#f4d58d;font-size:12px}#first-look .does{margin:4px 0 0;color:#b9b0d6}#first-look .skip{margin-top:8px;border:1px solid rgba(255,255,255,.25);border-radius:999px;background:none;color:#f2eefc;padding:3px 14px}";
  document.head.append(css);
  document.body.append(card);
  firstLook(engine, card, false);
}
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
