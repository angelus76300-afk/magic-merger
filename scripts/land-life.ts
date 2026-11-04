// A living island on every biome (4.4): generated, populated and left alone
// for a few simulated minutes. Used by `npm test` (in its worker threads) and
// by scripts/land-life-run.ts. Nothing here depends on the machine's speed.
import { populate } from "../src/sim/creatures";
import { DEFAULT_LAND, habitatCount, resolveLand, type Biome, type Shape } from "../src/sim/land";
import { C, F } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { SPECIES } from "../src/sim/wildlife";
import { generateWorld } from "../src/sim/world";

export interface LandLife {
  // "mixed" (4.4.1): an island of `size` as the game makes it from the seed.
  biome: Biome | "mixed";
  // How many lands a mixed island holds (over 5% of it each).
  lands?: number;
  shape: Shape;
  // Each native species: habitat cells at the start, animals at the start,
  // the fewest at any time, at the end, and the share of seconds with at
  // least one alive (a lone bear killed by a mob is born again a little
  // later: one dead animal is an event, a species that stays gone a problem).
  species: Record<string, { habitat: number; start: number; min: number; end: number; present: number }>;
  villagers: { start: number; end: number };
  houses: { start: number; end: number };
  // Cells of running water above the sea: at the start, at the end.
  river: { start: number; end: number };
  // The open sea's mean level above 8 at the end (at the island's edge):
  // springs must not raise it.
  seaRise: number;
  // Houses standing in water at the end, cells burning at the worst moment.
  wetHouses: number;
  burning: number;
  lava: { start: number; end: number };
  errors: string[];
}

export function landLife(biome: Biome | "mixed", shape: Shape, seed: number, seconds: number, size = 152): LandLife {
  const shared = Math.random;
  Math.random = seeded(seed * 7 + 1);
  try {
    const land = biome === "mixed" ? resolveLand(DEFAULT_LAND, seed, size) : { ...DEFAULT_LAND, biome, shape };
    const world = generateWorld(size, size, seed, land);
    let lands = 0;
    if (world.biomeMap) {
      const count = new Map<number, number>();
      for (const b of world.biomeMap) count.set(b, (count.get(b) ?? 0) + 1);
      lands = [...count.values()].filter((v) => v > world.n * 0.05).length;
    }
    populate(world);
    const errors: string[] = [];
    const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
    const counts = () => {
      const out: Record<string, number> = {};
      for (const c of world.creatures) if (!c.dead) out[c.kind] = (out[c.kind] ?? 0) + 1;
      return out;
    };
    const tally = () => {
      let river = 0;
      let houses = 0;
      let wet = 0;
      let lava = 0;
      let burning = 0;
      let sea = 0;
      let seaCells = 0;
      for (let i = 0; i < world.n; i++) {
        // Rivers and lakes; frozen ones too (the tundra's freeze up high).
        if ((world.fluid[i] === F.WATER || world.fluid[i] === F.ICE) && world.depth[i] > 0.1 && world.height[i] >= world.seaLevel) river++;
        if (world.cover[i] === C.HOUSE) {
          houses++;
          if (world.depth[i] > 0.3) wet++;
        }
        if (world.fluid[i] === F.LAVA) lava++;
        if (world.fire[i] > 0) burning++;
        const x = i % world.w;
        const y = (i / world.w) | 0;
        const border = x < 3 || y < 3 || x >= world.w - 3 || y >= world.h - 3;
        if (border && world.fluid[i] === F.WATER && world.height[i] < world.seaLevel - 1) {
          sea += world.height[i] + world.depth[i] - world.seaLevel;
          seaCells++;
        }
      }
      return { river, houses, wet, lava, burning, seaRise: seaCells ? sea / seaCells : 0 };
    };
    const start = counts();
    const t0 = tally();
    const species: LandLife["species"] = {};
    for (const s of SPECIES) {
      const n = start[s.kind.name] ?? 0;
      species[s.kind.name] = { habitat: habitatCount(world, s), start: n, min: n, end: n, present: 0 };
    }
    let burning = 0;
    for (let tick = 0; tick < seconds * 30; tick++) {
      stepHeadless(world, rt);
      if (tick % 30 === 0) {
        const now = counts();
        for (const s of SPECIES) {
          const sp = species[s.kind.name];
          sp.min = Math.min(sp.min, now[s.kind.name] ?? 0);
          if (now[s.kind.name]) sp.present += 1 / seconds;
        }
        if (tick % 300 === 0) burning = Math.max(burning, tally().burning);
      }
    }
    const end = counts();
    for (const s of SPECIES) species[s.kind.name].end = end[s.kind.name] ?? 0;
    const t1 = tally();
    return {
      biome,
      shape: land.shape,
      lands,
      species,
      villagers: { start: start.villager ?? 0, end: end.villager ?? 0 },
      houses: { start: t0.houses, end: t1.houses },
      river: { start: t0.river, end: t1.river },
      seaRise: Math.round(t1.seaRise * 100) / 100,
      wetHouses: t1.wet,
      burning,
      lava: { start: t0.lava, end: t1.lava },
      errors,
    };
  } finally {
    Math.random = shared;
  }
}

// What must hold on every biome; empty when all is well.
export function landProblems(r: LandLife): string[] {
  const out: string[] = [];
  for (const [name, s] of Object.entries(r.species)) {
    if (s.habitat <= 0) out.push(`no habitat for ${name}`);
    else if (s.present < 0.6) out.push(`${name} alive only ${Math.round(s.present * 100)}% of the time (${s.start} at the start, ${s.end} at the end)`);
  }
  if (r.villagers.start <= 0) out.push("no villagers");
  else if (r.villagers.end < r.villagers.start * 0.5) out.push(`villagers ${r.villagers.start} -> ${r.villagers.end}`);
  if (r.houses.end < r.houses.start * 0.7) out.push(`houses ${r.houses.start} -> ${r.houses.end}`);
  if (r.river.end < r.river.start * 0.4) out.push(`rivers dried up: ${r.river.start} -> ${r.river.end} wet cells`);
  if (r.seaRise > 0.3) out.push(`the sea rose ${r.seaRise}`);
  if (r.wetHouses > 4) out.push(`${r.wetHouses} house cells flooded`);
  if (r.burning > 40) out.push(`${r.burning} cells burning at once`);
  if (r.biome === "volcanic" && r.lava.end <= 0) out.push("the crater's lava is gone");
  if (r.biome === "mixed" && (r.lands ?? 0) < 2) out.push(`a mixed island of ${r.lands} land`);
  if (r.errors.length) out.push(`errors: ${r.errors[0]}`);
  return out;
}
