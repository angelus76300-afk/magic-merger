// Spell Lab: casts one spell program on a fixed world and reports what it did.
// Dev only. scripts/spell-lab.mjs loads this page in a headless browser, calls
// window.runSpell, and saves the frames and numbers, so a spell can be judged
// by what it does in the world, not by its code.
import { TIERS, isTier, type Tier } from "../shared/tiers";
import { C } from "../src/sim/materials";
import { Engine, type WorldSize } from "../src/sim/engine";
import { LAYERS } from "../src/sim/materials";
import { TICK, type World } from "../src/sim/world";

interface LabOptions {
  tier?: Tier;
  size?: WorldSize;
  seed?: number;
  // Seconds after the cast at which to capture a frame.
  shots?: number[];
  // Seconds simulated after the last shot.
  settle?: number;
}

function seedRandom(seed: number): void {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

async function runSpell(code: string, options: LabOptions = {}) {
  const seed = options.seed ?? 11;
  seedRandom(seed);
  const canvas = document.getElementById("world") as HTMLCanvasElement;
  const errors: string[] = [];
  let engine!: Engine;
  engine = Engine.create(canvas, options.size ?? "medium", { onError: (_k, _n, m) => errors.push(m), onTap: () => {} }, seed);
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
  engine.camera.x = target.x;
  engine.camera.y = target.y;
  const tier = isTier(options.tier) ? options.tier : TIERS[2];
  const before = census(world);
  const creaturesBefore = creatures(world);
  const started = performance.now();
  const ok = engine.cast({ key: "lab", name: "Lab", tier, code }, target.x, target.y);
  const shots = (options.shots ?? [0.5, 1.5, 3, 6]).map((s) => Math.round(s / TICK));
  const last = Math.max(...shots) + Math.round((options.settle ?? 2) / TICK);
  const frames: { t: number; png: string }[] = [];
  let worst = 0;
  for (let tick = 0; tick <= last; tick++) {
    const t0 = performance.now();
    engine.step();
    worst = Math.max(worst, performance.now() - t0);
    engine.render(TICK);
    if (shots.includes(tick)) frames.push({ t: +(tick * TICK).toFixed(2), png: canvas.toDataURL("image/png") });
  }
  return {
    ok,
    errors: [...new Set(errors)],
    tier,
    target,
    msTotal: Math.round(performance.now() - started),
    worstTickMs: +worst.toFixed(1),
    terrain: diff(before, census(world)),
    creatures: { before: creaturesBefore, after: creatures(world) },
    frames,
  };
}

(window as unknown as { runSpell: typeof runSpell }).runSpell = runSpell;
(window as unknown as { labReady: boolean }).labReady = true;
