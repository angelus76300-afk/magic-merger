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
//   1. that soak: nobody starves with a walk home on foot from where it falls (main after #215: the
//      two above);
//   2. one at home, starving with a third of its health left and food in the stores, has eaten
//      within 20 s (main: it went back and forth between resting and eating, and ate nothing).
//   3. one walks home twice from the same place round the lake, a rest at home between, and both
//      walks arrive (with the first walk's best kept for the second, the second gave up).
import { populate, resetCreatureIds, type Creature } from "../src/sim/creatures";
import { life, villageOf } from "../src/sim/kin";
import { houseOf, tileHouses } from "../src/sim/homes";
import { C, F } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { Mobility, STEP, pathsOf, solidCovers } from "../src/sim/paths";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { TICK, generateWorld, type World } from "../src/sim/world";
import { island } from "./nature-run";
import { jobOf } from "../src/sim/goals";
import type { LongWay } from "../src/sim/steer";

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

function fresh(seed = 4, reactions = false): { world: World; rt: Runtime } {
  return withRandom(seed, () => {
    resetCreatureIds(1);
    const world = generateWorld(112, 112, seed, island("small-meadow").land);
    populate(world);
    world.wonders = [];
    if (reactions) world.reactions = true;
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
      // Not along the island's edge, where nobody walks.
      const nx = n % world.w;
      const ny = Math.floor(n / world.w);
      if (n < 0 || n >= world.n || dist[n] >= 0 || nx < 4 || ny < 4 || nx >= world.w - 4 || ny >= world.h - 4) continue;
      if (solid[world.cover[n]] || wetOf(world, n) > 1 || world.walkLevel(j) - world.walkLevel(n) > 1.55) continue;
      dist[n] = dist[j] + 1;
      queue.push(n);
    }
  }
  return dist;
}

export function hungryHomeChecks(check: Check): void {
  // 1. The soak of the report: seed 4, the three lived-in houses nearest the first village's centre
  // burned at 120 s, to 1250 s. Counted: villagers who starve with a walk home on foot from where
  // they fall (walkFrom). A cup of boulders set round one villager did not do: a hop over a thin
  // wall (creatures.ts free) took it home without the long field, and a thick one left it held by
  // the land at the mouth of the cup, as no lake of the island does.
  {
    const { world, rt } = fresh(4, true);
    run(world, rt, 120);
    const top = tileHouses(world);
    const lived = [
      ...new Set(
        villagers(world)
          .map((c) => houseOf(world, c))
          .filter((h) => h >= 0 && top[h] >= 0)
          .map((h) => top[h]),
      ),
    ];
    const s = world.settlements[0];
    const far = (b: number) => Math.hypot((b % world.w) - s.x, Math.floor(b / world.w) - s.y);
    for (const b of lived.sort((p, q) => far(p) - far(q)).slice(0, 3)) for (const j of [b, b + 1, b + world.w, b + world.w + 1]) world.setCover(j, C.RUBBLE);
    const alive = new Set<Creature>(villagers(world));
    const starved: string[] = [];
    let walkable = 0;
    run(world, rt, 1250 - world.time, () => {
      for (const c of alive) {
        if (!c.dead) continue;
        alive.delete(c);
        if (!c.mind || c.mind.hunger < 1) continue;
        const steps = walkFrom(world, cellOf(world, c.homeX, c.homeY))[cellOf(world, c.x, c.y)];
        if (steps >= 0) walkable++;
        starved.push(
          `at (${Math.round(c.x)},${Math.round(c.y)}) ${Math.round(Math.hypot(c.x - c.homeX, c.y - c.homeY))} cells from home, ${steps < 0 ? "no walk home" : `${steps} steps home`}, at ${Math.round(world.time)} s`,
        );
      }
    });
    check(
      "hungry: on the fire and ruins soak of seed 4, nobody starves with a walk home (to 1250 s)",
      walkable === 0,
      `${starved.length} starved${starved.length ? ": " + starved.join("; ") : ""}`,
    );
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
  // 3. Two long walks home from the same place, the second after a rest at home. The place: dry,
  // 30 to 42 cells from home, out of the reach of home's field but in its long field's, where the
  // long way round first leads furthest away from home. Both walks arrive, and neither gives home
  // up while getting closer along the long way (with the first walk's best kept for the second,
  // steer.ts longWay, the second gave up after five seconds without getting closer in a line).
  {
    const { world, rt } = fresh();
    run(world, rt, 20);
    const solid = solidCovers(world);
    const paths = pathsOf(world);
    const fieldOf = (x: number, y: number, far: boolean) => {
      let f = paths.toward(world, Mobility.WALK, x, y, false, far);
      for (let k = 0; k < 400 && !f; k++) {
        paths.step(world);
        f = paths.toward(world, Mobility.WALK, x, y, false, far);
      }
      return f;
    };
    let c: Creature | undefined;
    let from = -1;
    let most = 0;
    let gap = 0;
    let steps = 0;
    for (const o of villagers(world)) {
      if (!o.mind || jobOf(o) === "guard" || o.data.indoors !== undefined || wetOf(world, cellOf(world, o.homeX, o.homeY)) > 0) continue;
      const short = fieldOf(o.homeX, o.homeY, false);
      const long = fieldOf(o.homeX, o.homeY, true);
      if (!short || !long) continue;
      const nearOf = (i: number) => Math.hypot((i % world.w) - o.homeX, Math.floor(i / world.w) - o.homeY);
      for (let i = 0; i < world.n; i++) {
        const near = nearOf(i);
        const way = long.dist[i] / STEP;
        // Beyond the short field, a long way round, and near enough to be told "no way" by it.
        if (short.dist[i] !== 0xffff || way < 80 || way > 150 || near < 30 || near > 42 || wetOf(world, i) > 0 || solid[world.cover[i]]) continue;
        // Down the long field for 30 steps: how much further from home it first leads.
        let j = i;
        let away = 0;
        for (let k = 0; k < 30; k++) {
          let next = j;
          for (const d of [1, -1, world.w, -world.w]) if (long.dist[j + d] < long.dist[next]) next = j + d;
          if (next === j || short.dist[next] !== 0xffff) break;
          j = next;
          away = Math.max(away, nearOf(j) - near);
        }
        if (away > most) {
          most = away;
          from = i;
          c = o;
          gap = near;
          steps = way;
        }
      }
    }
    const walks: string[] = [];
    let arrived = 0;
    if (c && from >= 0) {
      for (let k = 0; k < 2 && !c.dead; k++) {
        const v = villageOf(world, c.homeX, c.homeY);
        if (v) v.food = Math.max(v.food, 20);
        c.x = from % world.w;
        c.y = Math.floor(from / world.w);
        c.hp = life.maxHp(c);
        c.data.unreached = undefined;
        c.mind!.hunger = 0.9;
        c.mind!.task = "none";
        const t0 = world.time;
        let took = -1;
        // Home given up while the long field said it was getting closer (by 2 steps in the last
        // 4 s). Given up where it was held still (a jam) does not count here.
        let lost = false;
        const along: [number, number][] = [];
        const seen = new Set<number>();
        run(world, rt, 150, () => {
          if (took >= 0 || lost) return;
          if (Math.hypot(c.x - c.homeX, c.y - c.homeY) < 3) took = world.time - t0;
          const lw = c.data.longWay as LongWay | undefined;
          if (lw && world.time - lw.t < 0.1) along.push([world.time, lw.left]);
          const until = ((c.data.unreached as [number, number, number][] | undefined) ?? [])
            .filter((u) => Math.hypot(u[0] - c.homeX, u[1] - c.homeY) < 3)
            .map((u) => u[2]);
          const gaveUp = until.some((u) => !seen.has(u));
          for (const u of until) seen.add(u);
          if (gaveUp && lw && world.time - lw.t < 0.5) {
            const was = along.find((a) => a[0] >= world.time - 4);
            lost = !!was && was[1] - lw.left >= 2 * STEP;
          }
        });
        if (took >= 0 && !lost) arrived++;
        walks.push(
          `walk ${k + 1}: ${lost ? "home given up while getting closer on the long way" : took < 0 ? `not home after 150 s, ${Math.round(Math.hypot(c.x - c.homeX, c.y - c.homeY))} cells away` : `home in ${Math.round(took)} s`}`,
        );
      }
    }
    check(
      "hungry: a villager walks home twice from the same place round the lake, and both walks arrive",
      arrived === 2,
      c && from >= 0
        ? `villager ${c.id} from (${from % world.w},${Math.floor(from / world.w)}), ${Math.round(gap)} cells from home, ${Math.round(steps)} steps on the long field: ${walks.join("; ")}`
        : "no villager or no place with a long way home",
    );
  }
}
