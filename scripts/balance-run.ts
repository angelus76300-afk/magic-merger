// Spawns that keep the island alive (4.4.5): an island left alone for half
// an hour, every wild species' number read against its target every ten
// seconds; and a wipe, every animal killed and half the plants burnt, then
// ten minutes to come back. Used by `npm test` in its worker threads.
// Nothing here depends on the machine's speed.
import { populate } from "../src/sim/creatures";
import { logCatches } from "../src/sim/kin";
import { wildTargets } from "../src/sim/balance";
import { DEFAULT_LAND, resolveLand, type Biome } from "../src/sim/land";
import { C, G } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { NATIVE_NAMES } from "../src/sim/wildlife";
import { generateWorld, type World } from "../src/sim/world";

export interface Balance {
  biome: Biome | "mixed";
  size: number;
  seconds: number;
  // Per species: its target at the start, the share of samples within its
  // band, the fewest and the most alive, and alive at the end.
  // gone: the longest it was at none at all, in seconds (4.4.5 part B: no
  // population goes extinct).
  species: Record<string, { target: number; band: number; min: number; max: number; end: number; gone: number }>;
  // A wipe: per species, its target before, the first second it was back to
  // half of it, and to one at least (-1: never).
  wipe?: Record<string, { target: number; back: number; first: number }>;
  // Who caught whom ("fox caught a hare": 3).
  catches: Record<string, number>;
  errors: string[];
}

const PLANTS = new Set<number>([C.TREE, C.BUSH, C.FLOWER, C.REEDS, C.FERN, C.BERRIES, C.FUNGI, C.CACTUS, C.CROP]);

function counts(world: World): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of world.creatures) if (!c.dead && !c.data.leaving) out.set(c.kind, (out.get(c.kind) ?? 0) + 1);
  return out;
}

// Within its band: at least half its target (one at least), at most twice
// it and one more.
export const inBand = (n: number, target: number) => n >= Math.max(1, Math.floor(target * 0.5)) && n <= target * 2 + 1;

export function balanceRun(biome: Biome | "mixed", seed: number, seconds: number, size: number, wipeAt = -1): Balance {
  const shared = Math.random;
  Math.random = seeded(seed * 13 + 5);
  try {
    const land = biome === "mixed" ? resolveLand(DEFAULT_LAND, seed, size) : { ...DEFAULT_LAND, biome };
    const world = generateWorld(size, size, seed, land);
    populate(world);
    const errors: string[] = [];
    const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
    const species: Balance["species"] = {};
    const targets0 = wildTargets(world, counts(world));
    for (const [name, t] of targets0) if (t.base > 0) species[name] = { target: t.target, band: 0, min: Infinity, max: 0, end: 0, gone: 0 };
    const zeroSince = new Map<string, number>();
    let wipe: Balance["wipe"];
    let samples = 0;
    const caught = logCatches(true)!;
    for (let tick = 0; tick < seconds * 30; tick++) {
      stepHeadless(world, rt);
      if (tick === wipeAt * 30) {
        // Every wild animal gone, half the plants and half the grass burnt.
        const before = wildTargets(world, counts(world));
        wipe = {};
        for (const [name, t] of before) if (t.base > 0) wipe[name] = { target: t.base, back: -1, first: -1 };
        for (let k = world.creatures.length - 1; k >= 0; k--) if (NATIVE_NAMES.has(world.creatures[k].kind)) world.creatures.splice(k, 1);
        for (let i = 0; i < world.n; i++) {
          if (Math.random() >= 0.5) continue;
          if (PLANTS.has(world.cover[i])) world.setCover(i, world.cover[i] === C.TREE ? C.STUMP : C.NONE);
          if (world.ground[i] === G.GRASS) world.ground[i] = G.ASH;
        }
      }
      if (tick % 300 !== 0) continue;
      const now = counts(world);
      if (wipe && tick > wipeAt * 30) {
        for (const [name, w] of Object.entries(wipe)) {
          if (w.back < 0 && (now.get(name) ?? 0) >= Math.max(1, Math.floor(w.target * 0.5))) w.back = tick / 30 - wipeAt;
          if (w.first < 0 && (now.get(name) ?? 0) >= 1) w.first = tick / 30 - wipeAt;
        }
        continue;
      }
      const t = wildTargets(world, now);
      samples++;
      for (const [name, s] of Object.entries(species)) {
        const n = now.get(name) ?? 0;
        const target = t.get(name)?.target ?? s.target;
        if (inBand(n, target)) s.band++;
        if (n > 0) zeroSince.delete(name);
        else {
          if (!zeroSince.has(name)) zeroSince.set(name, tick / 30);
          s.gone = Math.max(s.gone, tick / 30 - zeroSince.get(name)! + 10);
        }
        s.min = Math.min(s.min, n);
        s.max = Math.max(s.max, n);
      }
    }
    const end = counts(world);
    for (const [name, s] of Object.entries(species)) {
      s.band = samples ? Math.round((s.band / samples) * 100) / 100 : 0;
      s.end = end.get(name) ?? 0;
      if (s.min === Infinity) s.min = 0;
    }
    return { biome, size, seconds, species, wipe, catches: Object.fromEntries(caught), errors };
  } finally {
    logCatches(false);
    Math.random = shared;
  }
}
