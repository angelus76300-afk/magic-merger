// Ten minutes on a tundra island, left alone (21 November, cold.ts): who is held frozen and for how
// long, who is alive at the end, and how many market trips that set out arrived. Nothing is cast,
// so every freeze is the land's. Used by npm test in its worker threads (a check per seed), and
// run on its own to compare a branch with main:
//   npx esbuild scripts/cold-run.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/cold-run.mjs --log-level=warning
//   node node_modules/.cache/cold-run.mjs 3 600
// It reads only c.frozen, c.dead and c.data.trip, which main has too.
import { populate } from "../src/sim/creatures";
import { DEFAULT_LAND } from "../src/sim/land-options";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { TICK, generateWorld } from "../src/sim/world";

export interface ColdRun {
  seed: number;
  seconds: number;
  // Creatures frozen more than 10 s in a row at any time, and at the end.
  heldEver: number;
  heldAtEnd: number;
  // The longest anyone was frozen in a row, seconds.
  longest: number;
  // Of the creatures there at the start: how many, and alive at the end.
  start: number;
  alive: number;
  // Deaths from the cold (c.data.frostDeath; none on main).
  frostDeaths: number;
  // Who died of it, by kind.
  frostKinds: Record<string, number>;
  // Market trips that set out, and arrived (cleared within 8 cells of where they went).
  trips: number;
  arrived: number;
  // The creatures' share of a tick, ms: median over the run.
  creatureP50: number;
  errors: string[];
}

export function coldRun(seed: number, seconds = 600, size = 152): ColdRun {
  const shared = Math.random;
  Math.random = seeded(seed * 17 + 3);
  try {
    const world = generateWorld(size, size, seed, { ...DEFAULT_LAND, biome: "tundra" });
    populate(world);
    const errors: string[] = [];
    const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
    const first = new Set(world.creatures.map((c) => c.id));
    const run = new Map<number, number>();
    const held = new Set<number>();
    let longest = 0;
    const trips = new Map<number, { x: number; y: number }>();
    let started = 0;
    let arrived = 0;
    const frost = new Map<number, string>();
    const times: number[] = [];
    let t0 = 0;
    let tc = 0;
    for (let k = 0; k < Math.round(seconds / TICK); k++) {
      stepHeadless(world, rt, {
        mark: (after) => {
          const now = performance.now();
          if (after === "physics") t0 = now;
          else if (after === "creatures") tc = now - t0;
        },
      });
      times.push(tc);
      for (const c of world.creatures) {
        if (c.dead) {
          run.delete(c.id);
          if (c.data.frostDeath) frost.set(c.id, c.kind.split("#")[0]);
          continue;
        }
        const r = c.frozen > 0 ? (run.get(c.id) ?? 0) + TICK : 0;
        run.set(c.id, r);
        longest = Math.max(longest, r);
        if (r > 10) held.add(c.id);
        const trip = c.data.trip as { to: { x: number; y: number } } | undefined;
        const was = trips.get(c.id);
        if (trip && !was) {
          started++;
          trips.set(c.id, { x: trip.to.x, y: trip.to.y });
        } else if (!trip && was) {
          if (Math.hypot(c.x - was.x, c.y - was.y) < 8) arrived++;
          trips.delete(c.id);
        }
      }
    }
    let heldAtEnd = 0;
    for (const r of run.values()) if (r > 10) heldAtEnd++;
    const alive = world.creatures.filter((c) => !c.dead && first.has(c.id)).length;
    times.sort((a, b) => a - b);
    return {
      seed,
      seconds,
      heldEver: held.size,
      heldAtEnd,
      longest: Math.round(longest * 10) / 10,
      start: first.size,
      alive,
      frostDeaths: frost.size,
      frostKinds: [...frost.values()].reduce<Record<string, number>>((o, k) => ((o[k] = (o[k] ?? 0) + 1), o), {}),
      trips: started,
      arrived,
      creatureP50: Math.round(times[times.length >> 1] * 1000) / 1000,
      errors: errors.slice(0, 3),
    };
  } finally {
    Math.random = shared;
  }
}

// On its own: seeds 1 to n, seconds.
if (typeof process !== "undefined" && process.argv[1]?.includes("cold-run")) {
  const n = Number(process.argv[2] ?? 3);
  const seconds = Number(process.argv[3] ?? 600);
  for (let s = 1; s <= n; s++) console.log(JSON.stringify(coldRun(s, seconds)));
}
