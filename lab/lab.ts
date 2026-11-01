// Spell Lab: casts one spell spec on a fixed world and reports what it did.
// Dev only. scripts/spell-lab.mjs loads this page in a headless browser, calls
// window.runSpell, and saves the frames and numbers, so a spell design can be
// judged by what it does in the world instead of by its JSON.
import { SCALE_RADIUS, sanitizeSpellSpec, type Scale } from "../shared/spell";
import { MATERIALS } from "../src/world/materials";
import { Renderer } from "../src/world/render";
import { TICK, World } from "../src/world/world";

interface LabOptions {
  maxScale?: Scale;
  width?: number;
  height?: number;
  seed?: number;
  // Seconds after the start of the cast at which to capture a frame.
  shots?: number[];
  // Seconds to keep simulating after the cast ends, to see what the world does with it.
  settle?: number;
}

interface CreatureTally {
  alive: number;
  dead: number;
  burning: number;
  frozen: number;
  asleep: number;
  afraid: number;
  levitating: number;
  calm: number;
  byType: Record<string, number>;
}

// Math.random drives creatures, particles and effects; seeding it makes runs comparable.
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

function materials(world: World): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of world.grid.mat) counts[MATERIALS[m].name] = (counts[MATERIALS[m].name] ?? 0) + 1;
  return counts;
}

function tally(world: World): CreatureTally {
  const t: CreatureTally = { alive: 0, dead: 0, burning: 0, frozen: 0, asleep: 0, afraid: 0, levitating: 0, calm: 0, byType: {} };
  for (const c of world.creatures) {
    if (c.dead) {
      t.dead++;
      continue;
    }
    t.alive++;
    t.byType[c.type] = (t.byType[c.type] ?? 0) + 1;
    if (c.burning > 0) t.burning++;
    if (c.frozen > 0) t.frozen++;
    if (c.sleep > 0) t.asleep++;
    if (c.fear > 0) t.afraid++;
    if (c.levitate > 0) t.levitating++;
    if (c.calm > 0) t.calm++;
  }
  return t;
}

function diff(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = (b[k] ?? 0) - (a[k] ?? 0);
    if (d) out[k] = d;
  }
  return out;
}

async function runSpell(raw: unknown, options: LabOptions = {}) {
  const width = options.width ?? 200;
  const height = options.height ?? 120;
  const seed = options.seed ?? 7;
  seedRandom(seed);
  const world = World.create(width, height, seed);
  // A crowd near the target, so effects on creatures are visible.
  const cx = Math.round(width / 2);
  for (let i = 0; i < 6; i++) world.spawn("villager", cx - 12 + i * 5);
  world.spawn("beast", cx + 4);
  for (let i = 0; i < 60; i++) world.step();

  const spec = sanitizeSpellSpec(raw, options.maxScale ?? "cataclysmic");
  const cy = world.grid.groundY(cx) - 1;
  const canvas = document.getElementById("world") as HTMLCanvasElement;
  const renderer = new Renderer(canvas, width, height);

  const before = materials(world);
  const creaturesBefore = tally(world);
  world.cast(spec, cx, cy);
  const cast = world.casts[0];
  const castEnd = (cast as unknown as { end: number }).end;
  const releaseAt = (cast as unknown as { releaseAt: number }).releaseAt;

  const shots = (options.shots ?? [releaseAt * 0.6, releaseAt + 0.15, releaseAt + 1, castEnd]).map((s) => Math.round(s / TICK));
  const settle = options.settle ?? 4;
  const totalTicks = Math.round((castEnd + settle) / TICK);
  const frames: { t: number; png: string }[] = [];
  let peakParticles = 0;
  let atRelease: CreatureTally | null = null;
  for (let tick = 0; tick <= totalTicks; tick++) {
    if (shots.includes(tick) || tick === totalTicks) {
      renderer.draw(world);
      frames.push({ t: +(tick * TICK).toFixed(2), png: canvas.toDataURL("image/png") });
    }
    if (tick === Math.round((releaseAt + 1) / TICK)) atRelease = tally(world);
    world.step();
    if (tick % 5 === 0) {
      let alive = 0;
      for (const life of world.particles.life) if (life > 0) alive++;
      peakParticles = Math.max(peakParticles, alive);
    }
  }
  return {
    spec,
    timing: { releaseAt: +releaseAt.toFixed(2), castEnd: +castEnd.toFixed(2) },
    radius: SCALE_RADIUS[spec.scale],
    peakParticles,
    terrainChange: diff(before, materials(world)),
    creatures: { before: creaturesBefore, oneSecondAfterRelease: atRelease, end: tally(world) },
    frames,
  };
}

(window as unknown as { runSpell: typeof runSpell }).runSpell = runSpell;
(window as unknown as { labReady: boolean }).labReady = true;
