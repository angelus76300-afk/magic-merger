// Hungry, it goes home (25 November, found by ai). On seed 4 of the fire and ruins soak (small
// meadow, the three lived-in houses nearest the first village's centre burned at 120 s, run to
// 1250 s, with PR #215's way out of the water) two villagers came out of the lake onto dry ground at
// (69,45) and (66,44), 45 and 41 cells from home with a walk of 110 and 115 steps round the lake,
// and starved there, "looking around" with hunger at 1. Two causes:
//   - a flow field reaches 64 steps (paths.ts MAX_STEPS); further, its cells say "no way", and a
//     creature within 45 cells of where it goes is told so (steer.ts noWay). Each walk home was
//     given up within a tick (goals.ts unreached), home and the square beside it were marked out of
//     reach again every few seconds, and with no berries near, it found nothing to eat;
//   - once starving had taken its health under a third, the rest it then went to take
//     (goals.ts urgent) replaced every meal before it was eaten, a thought or two later.
// The checks, on the small meadow island of seed 4:
//   1. a hungry villager set down on dry ground 25 to 40 cells from home, with a walk of more than
//      75 steps round water or a wall, is home and has eaten within two minutes (main: never home);
//   2. one at home, starving with a third of its health left and food in the stores, has eaten
//      within 20 s (main: it went back and forth between resting and eating, and ate nothing).
import { populate, resetCreatureIds, type Creature } from "../src/sim/creatures";
import { life, villageOf } from "../src/sim/kin";
import { F } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { solidCovers } from "../src/sim/paths";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { TICK, generateWorld, type World } from "../src/sim/world";
import { island } from "./nature-run";
import { jobOf } from "../src/sim/goals";

type Check = (name: string, ok: boolean, detail?: string) => void;

function withRandom<T>(seed: number, f: () => T): T {
  const was = Math.random;
  Math.random = seeded(seed);
  try {
    return f();
  } finally {
    Math.random = was;
  }
}

function fresh(seed = 4): { world: World; rt: Runtime } {
  return withRandom(seed, () => {
    resetCreatureIds(1);
    const world = generateWorld(112, 112, seed, island("small-meadow").land);
    populate(world);
    world.wonders = [];
    return { world, rt: new Runtime(world, () => {}) };
  });
}

function run(world: World, rt: Runtime, seconds: number, each: () => void = () => {}, seed = 7): void {
  withRandom(seed + Math.round(world.time), () => {
    for (let k = 0; k < Math.round(seconds / TICK); k++) {
      stepHeadless(world, rt);
      each();
    }
  });
}

const villagers = (world: World) => world.creatures.filter((c) => !c.dead && c.kind === "villager");
const cellOf = (world: World, x: number, y: number) => world.idx(Math.max(0, Math.min(world.w - 1, x)), Math.max(0, Math.min(world.h - 1, y)));
const wetOf = (world: World, i: number) => (world.fluid[i] !== F.NONE && world.fluid[i] !== F.ICE ? world.depth[i] : 0);

// Steps on foot from every cell to cell `to`, four ways, as a walker goes (no solid cover, water no
// deeper than 1, no step up of more than 1.55); -1 where there is no way.
function walkFrom(world: World, to: number): Int32Array {
  const solid = solidCovers(world);
  const dist = new Int32Array(world.n).fill(-1);
  const queue = [to];
  dist[to] = 0;
  for (let h = 0; h < queue.length; h++) {
    const j = queue[h];
    for (const d of [1, -1, world.w, -world.w]) {
      const n = j + d;
      if (n < 0 || n >= world.n || dist[n] >= 0 || Math.abs((n % world.w) - (j % world.w)) > 1) continue;
      if (solid[world.cover[n]] || wetOf(world, n) > 1 || world.walkLevel(j) - world.walkLevel(n) > 1.55) continue;
      dist[n] = dist[j] + 1;
      queue.push(n);
    }
  }
  return dist;
}

export function hungryHomeChecks(check: Check): void {
  // 1. Set down hungry on dry ground with a long way round to its home.
  {
    const { world, rt } = fresh();
    run(world, rt, 20);
    const solid = solidCovers(world);
    let found: { c: Creature; at: number; steps: number; d: number } | undefined;
    for (const c of villagers(world)) {
      if (found) break;
      if (!c.mind || jobOf(c) === "guard" || c.data.indoors !== undefined) continue;
      const home = cellOf(world, c.homeX, c.homeY);
      if (wetOf(world, home) > 0.05) continue;
      const dist = walkFrom(world, home);
      let bestD = Infinity;
      for (let i = 0; i < world.n; i++) {
        const x = (i % world.w) + 0.5;
        const y = Math.floor(i / world.w) + 0.5;
        const d = Math.hypot(x - c.homeX, y - c.homeY);
        if (d < 25 || d > 40 || d >= bestD || dist[i] < 75 || wetOf(world, i) > 0 || solid[world.cover[i]]) continue;
        // On open ground, not in a nook: its four neighbours walkable too.
        if (![1, -1, world.w, -world.w].every((o) => dist[i + o] >= 0 && wetOf(world, i + o) === 0)) continue;
        bestD = d;
        found = { c, at: i, steps: dist[i], d };
      }
    }
    if (!found) check("hungry: a villager with a long way round to its home goes home and eats", false, "no such spot on the island");
    else {
      const { c, at, steps, d } = found;
      c.x = (at % world.w) + 0.5;
      c.y = Math.floor(at / world.w) + 0.5;
      c.hd = Math.atan2(c.homeY - c.y, c.homeX - c.x);
      c.mind!.hunger = 0.9;
      c.mind!.task = "none";
      c.data.unreached = undefined;
      const v = villageOf(world, c.homeX, c.homeY);
      if (v) v.food = Math.max(v.food, 20);
      let homeAt = -1;
      let ateAt = -1;
      const t0 = world.time;
      run(world, rt, 120, () => {
        if (homeAt < 0 && Math.hypot(c.x - c.homeX, c.y - c.homeY) < 3) homeAt = world.time - t0;
        if (ateAt < 0 && (c.mind?.hunger ?? 1) < 0.5) ateAt = world.time - t0;
      });
      check(
        "hungry: a villager with a long way round to its home goes home and eats within two minutes",
        homeAt >= 0 && ateAt >= 0,
        `set down ${d.toFixed(0)} cells from home, ${steps} steps on foot; ${homeAt < 0 ? `never home, ${Math.hypot(c.x - c.homeX, c.y - c.homeY).toFixed(0)} cells off at the end` : `home after ${homeAt.toFixed(0)} s`}, ${ateAt < 0 ? `not eaten, hunger ${(c.mind?.hunger ?? 0).toFixed(2)}` : `ate after ${ateAt.toFixed(0)} s`}; "${c.mind?.action}"`,
      );
    }
  }
  // 2. At home, starving, a third of its health left.
  {
    const { world, rt } = fresh();
    run(world, rt, 20);
    const c = villagers(world).find(
      (o) => o.mind && jobOf(o) !== "guard" && o.data.indoors === undefined && wetOf(world, cellOf(world, o.homeX, o.homeY)) === 0,
    );
    const v = c ? villageOf(world, c.homeX, c.homeY) : null;
    if (!c || !v) check("hungry: a starving villager at home with little health left eats", false, "no villager");
    else {
      v.food = Math.max(v.food, 20);
      c.x = c.homeX;
      c.y = c.homeY;
      c.hp = life.maxHp(c) * 0.3;
      c.mind!.hunger = 1;
      c.mind!.task = "none";
      let ateAt = -1;
      const tasks = new Set<string>();
      const t0 = world.time;
      run(world, rt, 20, () => {
        tasks.add(c.mind?.task ?? "none");
        if (ateAt < 0 && (c.mind?.hunger ?? 1) < 0.5) ateAt = world.time - t0;
      });
      check(
        "hungry: a starving villager at home with a third of its health left has eaten within 20 s",
        !c.dead && ateAt >= 0,
        `${c.dead ? "dead" : "alive"}, ${ateAt < 0 ? `not eaten, hunger ${(c.mind?.hunger ?? 0).toFixed(2)}` : `ate after ${ateAt.toFixed(1)} s`}; tasks: ${[...tasks].join(", ")}`,
      );
    }
  }
}
