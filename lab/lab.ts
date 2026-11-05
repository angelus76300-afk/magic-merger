// Spell Lab: casts one spell program on a fixed world and reports what it did.
// Dev only. scripts/spell-lab.mjs loads this page in a headless browser, calls
// window.runSpell, and saves the frames and numbers, so a spell can be judged
// by what it does in the world, not by its code.
import { seeded } from "../src/sim/noise";
import { TIERS, isTier, type Tier } from "../shared/tiers";
import { C } from "../src/sim/materials";
import { Engine, type WorldSize } from "../src/sim/engine";
import { LAYERS } from "../src/sim/materials";
import { TICK, type World } from "../src/sim/world";
import { SCENARIOS } from "../src/sim/scenarios";
import { resolveLand } from "../src/sim/land-options";
import { WORLD_SIZES } from "../src/sim/engine";

interface LabOptions {
  tier?: Tier;
  size?: WorldSize;
  seed?: number;
  // Seconds after the cast at which to capture a frame.
  shots?: number[];
  // Seconds simulated after the last shot.
  settle?: number;
  // Camera distance; large values show the whole island.
  dist?: number;
  // Seconds into the day cycle (see daylight.ts).
  time?: number;
  // Collect CPU time per frame and per render part instead of frames.
  profile?: boolean;
  // Frames as JPEG (smaller, for the judge) instead of PNG.
  jpeg?: boolean;
  // Where to cast: next to a village (default), on a shore between water and
  // higher land, or where a river spills off the island's edge.
  aim?: "village" | "shore" | "edge";
  // Camera angles around the target (orbit.ts), for visual checks.
  theta?: number;
  phi?: number;
  // 4.4.5 part C: a wonder is cast as an artifact with its own reach.
  kind?: "spell" | "artifact";
  reach?: number;
  // 4.6: a player's island (land.ts, with its seeded villages), not the island before 4.4.
  land?: boolean;
  // 4.6: the kind it is written as, for its fine models and makers. The lab ignores it.
  form?: string;
}

// A water cell on the island's border, or one next to land at least two
// voxels higher: where water walls meet cut sides.
function findSpot(world: World, aim: "shore" | "edge"): { x: number; y: number } | null {
  const { w, h } = world;
  for (let i = 0; i < world.n; i++) {
    if (world.fluid[i] === 0 || world.depth[i] < 0.2) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    if (aim === "edge") {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return { x, y };
      continue;
    }
    if (x < 8 || y < 8 || x > w - 8 || y > h - 8) continue;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const j = (y + dy) * w + x + dx;
      if (world.fluid[j] === 0 && world.height[j] - world.height[i] - world.depth[i] > 3) return { x, y };
    }
  }
  return null;
}

function seedRandom(seed: number): void {
  Math.random = seeded(seed);
}

function census(world: World): Record<string, number> {
  const out: Record<string, number> = {};
  const arrays = { ground: world.ground, fluid: world.fluid, cover: world.cover };
  for (const layer of LAYERS) {
    if (layer === "gas") continue;
    const arr = arrays[layer];
    for (let i = 0; i < world.n; i++) {
      if (layer !== "ground" && arr[i] === 0) continue;
      const name = `${layer}:${world.materials.get(layer, arr[i]).name}`;
      out[name] = (out[name] ?? 0) + 1;
    }
  }
  let fire = 0;
  for (let i = 0; i < world.n; i++) if (world.fire[i] > 0.1) fire++;
  out.burning = fire;
  return out;
}

function creatures(world: World) {
  const alive = world.creatures.filter((c) => !c.dead);
  const count = (f: (c: World["creatures"][number]) => boolean) => alive.filter(f).length;
  return {
    alive: alive.length,
    dead: world.creatures.length - alive.length,
    burning: count((c) => c.burning > 0),
    frozen: count((c) => c.frozen > 0),
    afraid: count((c) => c.fear > 0),
    asleep: count((c) => c.sleep > 0),
    flying: count((c) => c.z > 1),
    kinds: [...new Set(alive.map((c) => c.kind))].join(","),
  };
}

function diff(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = (b[k] ?? 0) - (a[k] ?? 0);
    if (d) out[k] = d;
  }
  return out;
}

let current: Engine | null = null;

// The 3D canvas with the 2D overlay (night, flashes) on top.
function composite(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement, jpeg = false): string {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(canvas, 0, 0);
  ctx.drawImage(overlay, 0, 0, out.width, out.height);
  return jpeg ? out.toDataURL("image/jpeg", 0.82) : out.toDataURL("image/png");
}

async function runSpell(code: string, options: LabOptions = {}) {
  const seed = options.seed ?? 11;
  seedRandom(seed);
  const canvas = document.getElementById("world") as HTMLCanvasElement;
  const overlay = document.getElementById("overlay") as HTMLCanvasElement;
  const errors: string[] = [];
  current?.dispose();
  const size = options.size ?? "medium";
  const cells = WORLD_SIZES[size] ?? WORLD_SIZES.medium;
  const land = options.land ? resolveLand({ warmth: 0.5, water: 0.5, relief: 0.5, forest: 0.5 }, seed, cells) : undefined;
  const engine = Engine.create(canvas, overlay, size, { onError: (_k, _n, m) => errors.push(m), onTap: () => {} }, seed, { preserveDrawingBuffer: true }, land);
  current = engine;
  (window as unknown as { labEngine: Engine }).labEngine = engine;
  const world = engine.world;
  // Let rivers settle before casting.
  for (let k = 0; k < 90; k++) engine.step();

  // Aim at the edge of a village, where there are people, houses and trees.
  let target = { x: world.w / 2, y: world.h / 2 };
  for (let i = 0; i < world.n; i++) {
    if (world.cover[i] === C.HOUSE) {
      target = { x: (i % world.w) + 6, y: Math.floor(i / world.w) + 6 };
      break;
    }
  }
  if (options.aim === "shore" || options.aim === "edge") target = findSpot(world, options.aim) ?? target;
  engine.view.orbit.tx = target.x;
  engine.view.orbit.ty = target.y;
  if (options.theta !== undefined) engine.view.orbit.theta = options.theta;
  if (options.phi !== undefined) engine.view.orbit.phi = options.phi;
  if (options.dist) {
    // A fixed camera: spells do not move it, so big builds can be seen whole.
    engine.view.orbit.dist = options.dist;
    engine.runtime.camera = null;
  }
  if (options.time !== undefined) world.time = options.time;
  const tier = isTier(options.tier) ? options.tier : TIERS[2];
  const before = census(world);
  const creaturesBefore = creatures(world);
  const started = performance.now();
  const ok = engine.cast(
    { key: "lab", name: "Lab", tier, code, ...(options.kind ? { kind: options.kind } : {}), ...(options.reach ? { reach: options.reach } : {}) },
    target.x,
    target.y,
  );
  const shots = (options.shots ?? [0.5, 1.5, 3, 6]).map((s) => Math.round(s / TICK));
  const last = Math.max(...shots) + Math.round((options.settle ?? 2) / TICK);
  const frames: { t: number; png: string }[] = [];
  let worst = 0;
  const profile: Record<string, number[]> = {};
  if (options.profile) engine.view.profile = profile;
  const stepMs: number[] = [];
  const renderMs: number[] = [];
  for (let tick = 0; tick <= last; tick++) {
    const t0 = performance.now();
    engine.step();
    const t1 = performance.now();
    worst = Math.max(worst, t1 - t0);
    engine.render(TICK);
    stepMs.push(t1 - t0);
    renderMs.push(performance.now() - t1);
    if (shots.includes(tick) && !options.profile) frames.push({ t: +(tick * TICK).toFixed(2), png: composite(canvas, overlay, options.jpeg) });
  }
  engine.view.profile = null;
  return {
    ok,
    errors: [...new Set(errors)],
    tier,
    target,
    msTotal: Math.round(performance.now() - started),
    worstTickMs: +worst.toFixed(1),
    // What a GPU has to draw in the last frame.
    draw: { calls: engine.view.renderer.info.render.calls, triangles: engine.view.renderer.info.render.triangles },
    terrain: diff(before, census(world)),
    creatures: { before: creaturesBefore, after: creatures(world) },
    frames,
    // CPU time per frame, ms: p50, p95, max. Only with options.profile, for the
    // render parts (the GPU's own time is not in it).
    timing: options.profile
      ? Object.fromEntries([["step", stepMs], ["render", renderMs], ...Object.entries(profile)].map(([k, v]) => [k, quantiles(v as number[])]))
      : undefined,
  };
}

function quantiles(list: number[]): [number, number, number] {
  const s = [...list].sort((a, b) => a - b);
  const q = (p: number) => +(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0).toFixed(2);
  return [q(0.5), q(0.95), +(s[s.length - 1] ?? 0).toFixed(1)];
}

// Plays a challenge for some seconds, optionally casting spells at given
// times and places, and reports how the objective evolved.
async function runScenario(
  id: string,
  options: { seconds?: number; casts?: { t: number; x: number; y: number; code: string; tier: string }[]; shots?: number[] } = {},
) {
  seedRandom(5);
  const def = SCENARIOS.find((s) => s.id === id)!;
  const canvas = document.getElementById("world") as HTMLCanvasElement;
  const overlay = document.getElementById("overlay") as HTMLCanvasElement;
  current?.dispose();
  const errors: string[] = [];
  const { world, run, focus } = def.build();
  const engine = new Engine(canvas, overlay, world, { onError: (_k, _n, m) => errors.push(m), onTap: () => {} }, undefined, { preserveDrawingBuffer: true });
  current = engine;
  (window as unknown as { labEngine: Engine }).labEngine = engine;
  engine.view.orbit.tx = focus.x;
  engine.view.orbit.ty = focus.y;
  engine.view.orbit.dist = focus.dist;
  const timeline: { t: number; text: string; status: string }[] = [];
  const frames: { t: number; png: string }[] = [];
  const shots = (options.shots ?? []).map((s) => Math.round(s / TICK));
  const ticks = Math.round((options.seconds ?? 60) / TICK);
  let status = "playing";
  for (let tick = 0; tick <= ticks; tick++) {
    for (const c of options.casts ?? [])
      if (Math.round(c.t / TICK) === tick) engine.cast({ key: `lab${c.t}`, name: "Lab", tier: isTier(c.tier) ? c.tier : "major", code: c.code }, c.x, c.y);
    engine.step();
    run.tick(world);
    if (tick % 30 === 0 || shots.includes(tick)) {
      const r = run.check(world);
      if (tick % 150 === 0 || r.status !== status) timeline.push({ t: +(tick * TICK).toFixed(1), text: r.text, status: r.status });
      status = r.status;
    }
    if (shots.includes(tick)) {
      engine.render(TICK);
      frames.push({ t: +(tick * TICK).toFixed(2), png: composite(canvas, overlay) });
    }
    if (status !== "playing" && !shots.some((s) => s > tick)) break;
  }
  return { id, status, errors: [...new Set(errors)], timeline, frames };
}

(window as unknown as { runScenario: typeof runScenario }).runScenario = runScenario;
(window as unknown as { runSpell: typeof runSpell }).runSpell = runSpell;
(window as unknown as { labReady: boolean }).labReady = true;
