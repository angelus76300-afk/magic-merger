// Out of the water (25 November, found by ai). On seed 4 of the fire and ruins soak a villager stood
// from 880 s in water 0.86 deep at (74,41), the lake round it deeper than 1, and did not move for 360
// s: deep water is a wall to a walker (creatures.ts blocked), its flow fields had no way from there,
// and a hop out (free) reaches three cells. Its hunger reached 1 at 960 s and it starved at 1240 s.
// Another, asleep under the open sky on a shore, lay on as the lake rose over it. The checks, on the
// small temperate island:
//   1. a villager set down hungry in a pool 0.86 deep, the water round it 1.3 deep and dry ground
//      seven cells off, is on dry ground within 30 s (main: after 80 s, once a hop took it to the
//      edge), and has eaten within four minutes;
//   2. one asleep under the open sky where the water rises (0.6 deep) wakes, and lies down again on
//      dry ground (main: it slept on in the water).
// The count over sixteen islands, before and after, is in the pull request (villagers that starve
// standing in water, seeds 1 to 16 to 1250 s).
import { populate, resetCreatureIds, type Creature } from "../src/sim/creatures";
import { daylight } from "../src/sim/daylight";
import { comeOut } from "../src/sim/homes";
import { C, F } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { TICK, generateWorld, type World } from "../src/sim/world";
import { island } from "./nature-run";
import { jobOf } from "../src/sim/goals";

type Check = (name: string, ok: boolean, detail?: string) => void;

function fresh(seed = 11): { world: World; rt: Runtime } {
  const was = Math.random;
  const spec = island("small-meadow");
  Math.random = seeded(seed);
  resetCreatureIds(1);
  try {
    const world = generateWorld(spec.size, spec.size, spec.seed, spec.land);
    populate(world, []);
    world.wonders = [];
    return { world, rt: new Runtime(world, () => {}) };
  } finally {
    Math.random = was;
  }
}

function run(world: World, rt: Runtime, seconds: number, each: () => void = () => {}, seed = 7): void {
  const was = Math.random;
  Math.random = seeded(seed + Math.round(world.time));
  try {
    for (let k = 0; k < Math.round(seconds / TICK); k++) {
      stepHeadless(world, rt);
      each();
    }
  } finally {
    Math.random = was;
  }
}

const villagers = (world: World) => world.creatures.filter((c) => !c.dead && c.kind === "villager");
const cellOf = (world: World, c: Creature) => world.idx(Math.max(0, Math.min(world.w - 1, c.x)), Math.max(0, Math.min(world.h - 1, c.y)));
const depthAt = (world: World, i: number) => (world.fluid[i] === F.WATER ? world.depth[i] : 0);

// What grows or lies on open land: no building, field or fence.
const WILD = new Set<number>([C.NONE, C.TREE, C.BUSH, C.FLOWER, C.REEDS, C.FERN, C.BERRIES, C.LOG, C.FUNGI, C.STUMP, C.PEBBLES, C.STONE]);

// A dry disc of wild land of radius r + 2 within `within` cells of (x, y), at least `away` from it:
// its centre cell, or -1. The land slopes: the pool's surface is set under the lowest of its rim.
function wildSpot(world: World, x: number, y: number, r: number, within: number, away: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let cy = Math.round(y - within); cy <= y + within; cy++)
    for (let cx = Math.round(x - within); cx <= x + within; cx++) {
      const d = Math.hypot(cx - x, cy - y);
      if (d < away || d > within || d >= bestD || cx < r + 4 || cy < r + 4 || cx >= world.w - r - 4 || cy >= world.h - r - 4) continue;
      let ok = true;
      for (let dy = -r - 2; dy <= r + 2 && ok; dy++)
        for (let dx = -r - 2; dx <= r + 2 && ok; dx++) {
          const i = (cy + dy) * world.w + cx + dx;
          if (Math.hypot(dx, dy) <= r + 2) ok = world.fluid[i] === F.NONE && WILD.has(world.cover[i]);
        }
      if (ok) {
        best = cy * world.w + cx;
        bestD = d;
      }
    }
  return best;
}

// A pool dug at cell `at`: within radius r, water `deep` deep (`centre` at the very cell), its
// surface a little under the lowest land of its rim, so it stays.
function pool(world: World, at: number, r: number, deep: number, centre = deep): void {
  const ax = at % world.w;
  const ay = Math.floor(at / world.w);
  let surface = Infinity;
  for (let dy = -r - 2; dy <= r + 2; dy++)
    for (let dx = -r - 2; dx <= r + 2; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > r && d <= r + 2) surface = Math.min(surface, world.height[(ay + dy) * world.w + ax + dx]);
    }
  surface -= 0.05;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (Math.hypot(dx, dy) > r) continue;
      const i = (ay + dy) * world.w + ax + dx;
      const want = dx === 0 && dy === 0 ? centre : deep;
      world.setCover(i, C.NONE);
      world.height[i] = surface - want;
      world.setFluid(i, F.WATER, want);
    }
}

export function waterEscapeChecks(check: Check): void {
  const { world, rt } = fresh();
  run(world, rt, 20);
  const s = world.settlements[0];
  // 1. Set down hungry in a pool 0.86 deep, the water round it 1.3 deep, dry ground seven cells off.
  {
    const at = wildSpot(world, s.x, s.y, 7, 160, 10);
    const v = villagers(world).find((c) => c.mind && jobOf(c) !== "guard" && c.data.indoors === undefined);
    if (at < 0 || !v) check("water: a villager in a pool too deep to walk out of reaches dry ground", false, at < 0 ? "no spot of wild land" : "no villager");
    else {
      pool(world, at, 7, 1.3, 0.86);
      v.x = at % world.w;
      v.y = Math.floor(at / world.w);
      v.mind!.hunger = 0.9;
      v.mind!.task = "none";
      const start = depthAt(world, cellOf(world, v));
      let dryAt = -1;
      let ate = -1;
      let wet = 0;
      const t0 = world.time;
      run(world, rt, 240, () => {
        const d = depthAt(world, cellOf(world, v));
        if (dryAt < 0 && d <= 0.05) dryAt = world.time - t0;
        if (d > 0.3) wet += TICK;
        if (ate < 0 && (v.mind?.hunger ?? 1) < 0.5) ate = world.time - t0;
      });
      check(
        "water: a villager in a pool too deep to walk out of is on dry ground within 30 s",
        start > 0.8 && start <= 1 && dryAt >= 0 && dryAt <= 30,
        `set down in water ${start.toFixed(2)} deep, ${dryAt < 0 ? "never on dry ground" : `on dry ground after ${dryAt.toFixed(1)} s`}, ${wet.toFixed(0)} s in water over 240 s`,
      );
      check(
        "water: that villager, hungry, has eaten within four minutes and is alive",
        !v.dead && ate >= 0,
        `${v.dead ? "dead" : "alive"}, ${ate < 0 ? `not eaten, hunger ${(v.mind?.hunger ?? 0).toFixed(2)}` : `ate after ${ate.toFixed(0)} s`}; doing: ${v.mind?.action}`,
      );
    }
  }
  // 2. Asleep under the open sky where the water rises.
  {
    run(world, rt, Math.max(0, 262 - world.time));
    const at = wildSpot(world, s.x, s.y, 2, 30, 6);
    const v = villagers(world).find((c) => c.mind && jobOf(c) !== "guard" && c.mind.task === "rest" && !c.dead);
    if (at < 0 || !v || daylight(world.time).night < 0.5)
      check("water: one asleep outside where the water rises wakes", false, at < 0 ? "no spot of wild land" : !v ? "no sleeper" : "not night");
    else {
      if (v.data.indoors !== undefined) comeOut(v);
      v.x = at % world.w;
      v.y = Math.floor(at / world.w);
      v.data.rough = true;
      v.data.bed = "rough";
      v.mind!.tx = v.x;
      v.mind!.ty = v.y;
      pool(world, at, 2, 0.6);
      run(world, rt, 1);
      const woke = !(v.data.rough && v.mind?.task === "rest");
      const said = v.mind?.action;
      run(world, rt, 30);
      const d = depthAt(world, cellOf(world, v));
      const lying = !!v.data.rough || v.data.indoors !== undefined;
      check(
        "water: one asleep outside where the water rises wakes, and sleeps again on dry ground",
        woke && d <= 0.05 && lying && v.mind?.task === "rest",
        `${woke ? `woke ("${said}")` : "slept on"}; 30 s later in water ${d.toFixed(2)} deep, ${lying ? "asleep" : "awake"}, "${v.mind?.action}"`,
      );
    }
  }
}
