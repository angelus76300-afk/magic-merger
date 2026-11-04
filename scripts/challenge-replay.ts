// One challenge played from start to end, as `npm test` and its worker
// threads replay it. Shared so both run exactly the same loop.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetCreatureIds } from "../src/sim/creatures";
import { seeded } from "../src/sim/noise";
import { stepHeadless } from "../src/sim/tick";
import { Runtime } from "../src/sim/runtime";
import { SCENARIOS } from "../src/sim/scenarios";
import type { World } from "../src/sim/world";
import { LIVE_MAX, type ChallengeDef } from "../shared/challenges";
import type { Tier } from "../shared/tiers";

// Seeded randomness, so a check gives the same answer on every run.
export function seed(n: number): void {
  Math.random = seeded(n);
}

// One simulation tick, as the engine runs it; returns its cost in ms.
// life: the creatures' own random stream (see lives).
export function step(world: World, rt: Runtime, life?: () => number): number {
  const t0 = performance.now();
  stepHeadless(world, rt, life ? { life } : undefined);
  return performance.now() - t0;
}

// Creatures draw from a stream of their own in a replay, apart from the
// hazard's (4.3), as they do in the test run (check.ts): a lava flow or a
// fire is the same whatever the deer and villagers decide, so a change to
// how creatures move no longer reshuffles every eruption. Before, the lava
// challenges' verdicts on their three seeds flipped with any creature change
// (the wall wins 9 lava roads in 12 seeds on main and on 4.3 alike).
function lives(n: number): () => number {
  return seeded(n * 7 + 1);
}

// The plain spell that solves each challenge, and where it is cast.
export const SOLUTIONS: Record<string, { file: string; tier: "major" | "grand" | "legendary"; at: [number, number][] }> = {
  wildfire: { file: "rain.js", tier: "grand", at: [[16, 56]] },
  lava: { file: "wall.js", tier: "grand", at: [[58, 58]] },
  river: { file: "frost.js", tier: "major", at: [[56, 54]] },
  drought: { file: "bloom.js", tier: "legendary", at: [[56, 56]] },
  flood: { file: "dike.js", tier: "grand", at: [[56, 50]] },
};

export interface Replay {
  id: string;
  seed: number;
  magic: boolean;
}

// Up to 85 seconds, the solution cast at tick 150, the outcome checked every
// 15 ticks like the game does.
export function replay(job: Replay): { status: string; errors: string[] } {
  seed(job.seed);
  resetCreatureIds();
  const scenario = SCENARIOS.find((s) => s.id === job.id)!;
  const { world, run } = scenario.build();
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  const plan = SOLUTIONS[job.id];
  const life = lives(job.seed);
  let status = "playing";
  for (let k = 0; k < 30 * 85 && status === "playing"; k++) {
    if (job.magic && k === 150) {
      const code = readFileSync(join("lab/solutions", plan.file), "utf8");
      plan.at.forEach(([x, y], n) => rt.cast({ key: `${plan.file}${n}`, name: plan.file, tier: plan.tier, code }, x, y));
    }
    step(world, rt, life);
    run.tick(world);
    if (k % 15 === 0) status = run.check(world).status;
  }
  return { status, errors };
}

// A challenge of 3.7 (shared/challenges.ts) played with one program cast at
// one spot: what the verification of a solver runs, on several seeds. A live
// challenge is verified at its worst: the hazard has run its LIVE_MAX.
export function playChallenge(def: ChallengeDef, code: string, tier: Tier, spot: [number, number], seedN: number): { status: string; errors: string[] } {
  seed(seedN);
  resetCreatureIds();
  const scenario = SCENARIOS.find((s) => s.id === def.scenario)!;
  const { world, run } = scenario.build();
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  // Two seconds to aim after the island appears, as in play.
  const castAt = def.live ? Math.round((LIVE_MAX + 2) * 30) : 150;
  const life = lives(seedN);
  let status = "playing";
  for (let k = 0; k < 30 * 85 + castAt && status === "playing"; k++) {
    if (k === castAt) rt.cast({ key: "candidate", name: "candidate", tier, code }, spot[0], spot[1]);
    step(world, rt, life);
    run.tick(world);
    if (k % 15 === 0) status = run.check(world).status;
    if (errors.length) break;
  }
  return { status: errors.length ? "crashed" : status, errors };
}

// How often a program wins a challenge at its first spot, over seeds 101,
// 202, ... (4.3): npm test asks the plain solutions for half of 12 at least.
// Their verdict on the three seeds of solves() flips with anything that
// changes what creatures do to the land (birds sowing, villagers felling),
// since the lava challenges are won 9 times in 12 by the wall, so not on
// every three: on main, racing lava wins 6 of these 12 and lost 101.
// Stops as soon as the answer is known.
export function winRate(def: ChallengeDef, code: string, tier: Tier, seeds = 12): { wins: number; runs: number; need: number; results: string } {
  const need = Math.ceil(seeds / 2);
  let wins = 0;
  let runs = 0;
  let results = "";
  for (let n = 1; n <= seeds; n++) {
    const won = playChallenge(def, code, tier, def.spots[0], n * 101).status === "won";
    runs++;
    if (won) wins++;
    results += won ? "w" : "l";
    if (wins >= need || wins + (seeds - n) < need) break;
  }
  return { wins, runs, need, results };
}

// Solved: won on at least two of three seeds at one of its spots.
export function solves(def: ChallengeDef, code: string, tier: Tier): { ok: boolean; wins: number; runs: number } {
  let best = 0;
  let runs = 0;
  for (const spot of def.spots) {
    let wins = 0;
    for (const s of [101, 202, 303]) {
      runs++;
      if (playChallenge(def, code, tier, spot, s).status === "won") wins++;
      if (wins >= 2 || wins + (3 - [101, 202, 303].indexOf(s) - 1) < 2) break;
    }
    best = Math.max(best, wins);
    if (wins >= 2) break;
  }
  return { ok: best >= 2, wins: best, runs };
}
