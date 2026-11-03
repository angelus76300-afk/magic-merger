import { pairKey } from "./elements";
import { TIERS, type Tier } from "./tiers";

// Challenges from nothing (3.7). A hazard island and a start set of
// primitives, or fewer: the player merges on the challenge's own board until
// something saves the village, casts it, and is scored by the number of
// merges. Every challenge is one of the hazard islands of src/sim/scenarios.ts.
//
// In increasing difficulty: one obvious spell first, then fewer primitives
// (a wildfire without Water), a higher tier, and a hazard that starts while
// the player is still merging. A challenge is shown only once a spell that
// solves it is known and verified in the simulation, and its par is the
// fewest merges that reach such a spell from its start set.

export const ALL_PRIMITIVES = ["Fire", "Water", "Earth", "Air", "Light", "Shadow", "Life", "Arcane"] as const;

export interface ChallengeDef {
  id: string;
  // The hazard island (src/sim/scenarios.ts).
  scenario: string;
  title: string;
  brief: string;
  start: string[];
  // The spell cast must be at least this strong.
  minTier?: Tier;
  // The hazard runs while the player merges: one second of it for every
  // LIVE_RATE seconds spent merging is played on the island before the
  // spell lands, up to LIVE_MAX (8). Measured: the lava is held with a wall cast
  // after 10 seconds of eruption, not after 20; a wildfire is lost after 10
  // even to a grand rain, and the drought has no clock, so only lava is live.
  live?: boolean;
  // Where the verification casts a candidate, by scenario (the challenge's natural spots).
  spots: [number, number][];
}

export const LIVE_MAX = 8;
export const LIVE_RATE = 6;

// Seconds of the hazard already played, after this many seconds of merging.
export function liveAhead(def: ChallengeDef, mergingSeconds: number): number {
  return def.live ? Math.min(LIVE_MAX, Math.max(0, mergingSeconds) / LIVE_RATE) : 0;
}

const without = (...names: string[]) => ALL_PRIMITIVES.filter((p) => !names.includes(p));

export const CHALLENGES: ChallengeDef[] = [
  {
    id: "first-fire",
    scenario: "wildfire",
    title: "Put out the fire",
    brief: "A wildfire is crossing the forest toward the village. Make something that puts it out, from the eight forces.",
    start: [...ALL_PRIMITIVES],
    spots: [
      [16, 56],
      [40, 60],
    ],
  },
  {
    id: "high-water",
    scenario: "flood",
    title: "High water",
    brief: "The sea will rise for fifty seconds and flood the low village. Keep half of its people alive.",
    start: [...ALL_PRIMITIVES],
    spots: [[56, 50]],
  },
  {
    id: "lava-road",
    scenario: "lava",
    title: "The lava road",
    brief: "The volcano above the village is erupting. Keep the lava out of the houses until it falls quiet.",
    start: [...ALL_PRIMITIVES],
    spots: [[58, 58]],
  },
  {
    id: "dry-fire",
    scenario: "wildfire",
    title: "Fire without water",
    brief: "The same wildfire, and no Water to start from. Find another way to stop it.",
    start: without("Water"),
    spots: [
      [16, 56],
      [40, 60],
    ],
  },
  {
    id: "far-bank",
    scenario: "river",
    title: "The far bank",
    brief: "Eight travelers are stuck across a deep river. Bring four of them home, with no Water, Light or Life to start from.",
    start: without("Water", "Light", "Life"),
    spots: [[56, 54]],
  },
  {
    id: "dust-bowl",
    scenario: "drought",
    title: "Dust bowl",
    brief: "The fields have turned to dust and there is no Water to start from. Bring the farmland back to life.",
    start: without("Water"),
    spots: [[56, 56]],
  },
  {
    id: "great-eruption",
    scenario: "lava",
    title: "The great eruption",
    brief: "Only grand magic or stronger will hold this mountain. Keep the lava out of the village.",
    start: [...ALL_PRIMITIVES],
    minTier: "grand",
    spots: [[58, 58]],
  },
  {
    id: "racing-lava",
    scenario: "lava",
    title: "Racing the lava",
    brief: "The mountain is already erupting while you merge, and there is no Water to start from. The longer you merge, the closer the lava.",
    start: without("Water"),
    live: true,
    spots: [[58, 58]],
  },
];

export function challengeById(id: string): ChallengeDef | undefined {
  return CHALLENGES.find((c) => c.id === id);
}

export function strongEnough(def: ChallengeDef, tier: Tier | undefined): boolean {
  return !def.minTier || (!!tier && TIERS.indexOf(tier) >= TIERS.indexOf(def.minTier));
}

export interface Recipe {
  a: string;
  b: string;
  result: string;
}

// The fewest merges that make each item from a start set, through the shared
// recipe graph: a merge made once serves every later use of its result, so a
// derivation is the set of distinct merges it needs, not a sum. Found by
// relaxing every recipe until nothing gets shorter (the graph has a few
// hundred recipes). Keys are element keys. Start items need none.
export function fewestMerges(recipes: Recipe[], start: string[]): Map<string, Set<string>> {
  const best = new Map<string, Set<string>>();
  for (const s of start) best.set(s, new Set());
  for (let round = 0; round < 60; round++) {
    let changed = false;
    for (const r of recipes) {
      const a = best.get(r.a);
      const b = best.get(r.b);
      if (!a || !b || start.includes(r.result)) continue;
      const pair = r.a < r.b ? `${r.a}+${r.b}` : `${r.b}+${r.a}`;
      const known = best.get(r.result);
      if (known && known.size <= Math.max(a.size, b.size) + 1) continue;
      const set = new Set(a);
      for (const p of b) set.add(p);
      set.add(pair);
      if (!known || set.size < known.size) {
        best.set(r.result, set);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return best;
}

// Par: the fewest merges to any verified solver, or what a player did better.
export function parOf(recipes: Recipe[], start: string[], solvers: string[], bestWin: number | null): { par: number | null; via: string | null } {
  const best = fewestMerges(recipes, start);
  let par: number | null = null;
  let via: string | null = null;
  for (const s of solvers) {
    const d = best.get(s);
    if (d && (par === null || d.size < par)) {
      par = d.size;
      via = s;
    }
  }
  if (bestWin !== null && (par === null || bestWin < par)) return { par: bestWin, via: null };
  return { par, via };
}

// The merges of an attempt, as par counts them: each distinct pair once,
// whichever way round, however often it was merged again.
export function countMerge(pairs: readonly string[], a: string, b: string): string[] {
  const pair = pairKey(a, b);
  return pairs.includes(pair) ? [...pairs] : [...pairs, pair];
}

// Three stars at par or better, two within two merges of it, one for any win.
export function starsFor(merges: number, par: number | null): number {
  if (par === null || merges <= par) return 3;
  return merges <= par + 2 ? 2 : 1;
}
