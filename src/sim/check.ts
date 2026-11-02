import { TIERS, type Tier } from "../../shared/tiers";
import { lifeCycle, populate, resetCreatureIds, updateCreature } from "./creatures";
import { C } from "./materials";
import { stepPhysics } from "./physics";
import { Runtime, type CastRequest } from "./runtime";
import { TICK, generateWorld, type World } from "./world";

// The test run a new program goes through before it is stored (3.3). It is
// cast near a village on a small seeded island, and the island is compared,
// second by second, with the same island left alone (the control). A river
// that flows or a villager who walks is in both, so only what the spell did
// shows up. Three outcomes fail: a crash, nothing visible in the world, and
// an island wiped out by a spell that is not cosmic.
//
// Runs where spell code may run: the sandboxed check frame in the browser
// (src/sim/checkframe.ts), and Node for `npm test` and the measurement scripts.
// The Worker cannot run it, since Cloudflare Workers forbid new Function.

export type CheckProblem = "crash" | "nothing" | "wiped";

export interface CheckResult {
  ok: boolean;
  problem: CheckProblem | null;
  // One sentence for the rewrite prompt and the admin card.
  detail: string;
  stats: {
    seconds: number;
    // Most land cells that differed from the control at any second, and that share of the land.
    cells: number;
    share: number;
    voxels: number;
    creatures: number;
    bodies: number;
    villagersLeft: number;
    housesLeft: number;
    worstTickMs: number;
  };
}

const SIZE = 112;
const SEED = 11;
// Below this many cells, voxels or creatures, a difference with the control is
// noise from the random streams drifting apart (measured with a spell that
// only draws random numbers: at most 3 cells and 0 creatures over 14 seconds).
const MIN_CELLS = 8;
const MIN_VOXELS = 4;
const MIN_CREATURES = 1;
// Past this share of the land changed, or with almost every villager and house
// gone, the spell wiped the island. Cosmic spells may (DESIGN.md, decisions).
const WIPED_SHARE: Partial<Record<Tier, number>> = { legendary: 0.9 };
const WIPED_SHARE_DEFAULT = 0.6;

interface Snapshot {
  height: Float32Array;
  ground: Uint8Array;
  fluid: Uint8Array;
  depth: Float32Array;
  cover: Uint8Array;
  fire: Uint8Array;
  decor: number;
  creatures: Map<string, string>;
  villagers: number;
  houses: number;
  landmarks: number;
}

function snapshot(world: World): Snapshot {
  const fire = new Uint8Array(world.n);
  let houses = 0;
  for (let i = 0; i < world.n; i++) {
    fire[i] = world.fire[i] > 0.1 ? 1 : 0;
    if (world.cover[i] === C.HOUSE) houses++;
  }
  // Each creature that was there at the cast, by id: alive or dead, kind,
  // what it is going through. Those born later (ids are not shared between
  // the two runs) are counted by kind.
  const creatures = new Map<string, string>();
  let villagers = 0;
  for (const c of world.creatures) {
    if (!c.dead && c.kind === "villager") villagers++;
    if (c.id > baseId) {
      if (c.dead) continue;
      const k = `new:${c.kind}`;
      creatures.set(k, String(Number(creatures.get(k) ?? 0) + 1));
      continue;
    }
    const status = [c.burning, c.frozen, c.fear, c.sleep, c.calm, c.levitate, c.stun].map((v) => (v > 0 ? 1 : 0)).join("");
    creatures.set(String(c.id), c.dead ? "dead" : `${c.kind}:${status}:${Math.round(c.hp / 10)}`);
  }
  return {
    height: world.height.slice(),
    ground: world.ground.slice(),
    fluid: world.fluid.slice(),
    depth: world.depth.slice(),
    cover: world.cover.slice(),
    fire,
    decor: world.decor.size,
    creatures,
    villagers,
    houses,
    landmarks: world.landmarks.length,
  };
}

function changedCells(a: Snapshot, b: Snapshot, land: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.cover.length; i++) {
    if (!land[i]) continue;
    if (
      Math.abs(a.height[i] - b.height[i]) > 0.4 ||
      a.ground[i] !== b.ground[i] ||
      a.fluid[i] !== b.fluid[i] ||
      Math.abs(a.depth[i] - b.depth[i]) > 0.4 ||
      a.cover[i] !== b.cover[i] ||
      a.fire[i] !== b.fire[i]
    )
      n++;
  }
  return n;
}

function changedCreatures(a: Snapshot, b: Snapshot): number {
  let n = 0;
  for (const [id, state] of b.creatures) {
    if (id.startsWith("new:")) n += Math.abs(Number(state) - Number(a.creatures.get(id) ?? 0));
    else if (a.creatures.get(id) !== state) n++;
  }
  for (const [id, state] of a.creatures) {
    if (b.creatures.has(id)) continue;
    n += id.startsWith("new:") ? Number(state) : 1;
  }
  return n;
}

// Seeded randomness, the same for the control and the spell run.
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Island {
  world: World;
  rt: Runtime;
  target: { x: number; y: number };
  land: Uint8Array;
  // Each run draws from its own random stream, set before each of its ticks.
  random: () => number;
}

// Creatures with a higher id were born after the cast.
let baseId = 0;

// The island both runs start from: rivers settled, aim at the edge of a village.
function island(errors: string[]): Island {
  Math.random = seeded(SEED);
  resetCreatureIds();
  const world = generateWorld(SIZE, SIZE, SEED);
  populate(world);
  baseId = Math.max(0, ...world.creatures.map((c) => c.id));
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  for (let k = 0; k < 60; k++) step(world, rt);
  let target = { x: world.w / 2, y: world.h / 2 };
  for (let i = 0; i < world.n; i++) {
    if (world.cover[i] === C.HOUSE) {
      target = { x: (i % world.w) + 6, y: Math.floor(i / world.w) + 6 };
      break;
    }
  }
  const land = new Uint8Array(world.n);
  for (let i = 0; i < world.n; i++) land[i] = world.depth[i] > 0.5 ? 0 : 1;
  return { world, rt, target, land, random: seeded(SEED + 1) };
}

function step(world: World, rt: Runtime): void {
  world.time += TICK;
  world.tick++;
  stepPhysics(world, TICK);
  for (const c of world.creatures) updateCreature(world, c, TICK);
  lifeCycle(world, TICK);
  rt.step(TICK);
  world.particles.update(TICK);
  world.events.length = 0;
}

// The control: the same island left alone, one snapshot per second. Kept
// between checks, since it never changes.
let control: { snaps: Snapshot[]; island: Island } | null = null;

function* controlUpTo(seconds: number): Generator<void, Snapshot[]> {
  const outer = Math.random;
  if (!control) {
    const isl = island([]);
    control = { snaps: [snapshot(isl.world)], island: isl };
  }
  const c = control;
  while (c.snaps.length <= seconds) {
    for (let k = 0; k < 1 / TICK; k++) {
      Math.random = c.island.random;
      step(c.island.world, c.island.rt);
      Math.random = outer;
      // A pause every few ticks, so the browser can draw in between.
      if (k % 5 === 4) yield;
    }
    c.snaps.push(snapshot(c.island.world));
  }
  Math.random = outer;
  return c.snaps;
}

// A generator, so the browser can run it a second of game time at a time
// between frames; `runCheck` runs it to the end. Math.random is replaced
// while it runs (seeded, so a check gives the same answer every time).
export function* checkProgram(req: CastRequest): Generator<void, CheckResult> {
  const random = Math.random;
  try {
    return yield* check(req);
  } finally {
    Math.random = random;
  }
}

function* check(req: CastRequest): Generator<void, CheckResult> {
  const big = TIERS.indexOf(req.tier) >= TIERS.indexOf("legendary");
  const cap = big ? 26 : 14;
  // The control first: it may already be there from an earlier check.
  yield* controlUpTo(1);
  const errors: string[] = [];
  const isl = island(errors);
  const { world, rt, target, land } = isl;
  Math.random = isl.random;
  const landCells = land.reduce((s, v) => s + v, 0);
  const started = rt.cast({ ...req, key: `check:${req.key}` }, target.x, target.y);
  let cells = 0;
  let voxels = 0;
  let creatures = 0;
  let bodies = 0;
  let bodySeconds = 0;
  let worst = 0;
  let seconds = 0;
  let quietFor = 0;
  let last = snapshot(world);
  while (started && !errors.length && seconds < cap) {
    for (let k = 0; k < 1 / TICK && !errors.length; k++) {
      const t0 = performance.now();
      step(world, rt);
      worst = Math.max(worst, performance.now() - t0);
      const visible = rt.visuals.bodies.filter((b) => b.alive && b.look !== "none").length;
      bodies = Math.max(bodies, visible);
      if (visible) bodySeconds += TICK;
      if (k % 5 === 4) {
        yield;
        Math.random = isl.random;
      }
    }
    seconds++;
    last = snapshot(world);
    const snaps = yield* controlUpTo(seconds);
    Math.random = isl.random;
    const ref = snaps[seconds];
    cells = Math.max(cells, changedCells(ref, last, land));
    voxels = Math.max(voxels, Math.abs(ref.decor - last.decor));
    creatures = Math.max(creatures, changedCreatures(ref, last) + Math.abs(ref.landmarks - last.landmarks));
    // Done two seconds after the cast and its bodies are over, after four at least.
    quietFor = rt.busy() || rt.visuals.bodies.length ? 0 : quietFor + 1;
    if (seconds >= 4 && quietFor >= 2) break;
  }
  const ref = (yield* controlUpTo(seconds))[seconds];
  const endCells = changedCells(ref, last, land);
  const share = landCells ? endCells / landCells : 0;
  const stats = {
    seconds,
    cells,
    share: Math.round(share * 1000) / 1000,
    voxels,
    creatures,
    bodies,
    villagersLeft: ref.villagers ? Math.round((last.villagers / ref.villagers) * 100) / 100 : 1,
    housesLeft: ref.houses ? Math.round((last.houses / ref.houses) * 100) / 100 : 1,
    worstTickMs: Math.round(worst),
  };
  if (!started || errors.length) {
    return { ok: false, problem: "crash", detail: `It crashed: ${errors[0] ?? "the cast did not start"}`, stats };
  }
  const moved = cells >= MIN_CELLS || voxels >= MIN_VOXELS || creatures >= MIN_CREATURES || bodySeconds >= 0.5;
  if (!moved) {
    return {
      ok: false,
      problem: "nothing",
      detail: `Nothing visible happened in the world: no land, water, plant, house, block or creature changed and nothing flew (${cells} cells, ${voxels} blocks, ${creatures} creatures). Particles, flashes and circles alone do not count.`,
      stats,
    };
  }
  if (req.tier !== "cosmic") {
    const limit = WIPED_SHARE[req.tier] ?? WIPED_SHARE_DEFAULT;
    const ruined = TIERS.indexOf(req.tier) <= TIERS.indexOf("grand") && stats.villagersLeft < 0.2 && stats.housesLeft < 0.2;
    if (share > limit || ruined) {
      return {
        ok: false,
        problem: "wiped",
        detail: `It wiped out the island, far beyond a ${req.tier} spell's reach: ${Math.round(share * 100)}% of the land changed, ${Math.round(stats.villagersLeft * 100)}% of villagers and ${Math.round(stats.housesLeft * 100)}% of houses left.`,
        stats,
      };
    }
  }
  return {
    ok: true,
    problem: null,
    detail: `${cells} cells, ${voxels} blocks and ${creatures} creatures changed${bodies ? `, ${bodies} bodies flew` : ""}.`,
    stats,
  };
}

export function runCheck(req: CastRequest): CheckResult {
  const it = checkProgram(req);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}
