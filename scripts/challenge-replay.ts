// One challenge played from start to end, as `npm test` and its worker
// threads replay it. Shared so both run exactly the same loop.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lifeCycle, resetCreatureIds, updateCreature } from "../src/sim/creatures";
import { stepPhysics } from "../src/sim/physics";
import { Runtime } from "../src/sim/runtime";
import { SCENARIOS } from "../src/sim/scenarios";
import { TICK, type World } from "../src/sim/world";

// Seeded randomness, so a check gives the same answer on every run.
export function seed(n: number): void {
  let a = n >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One simulation tick, as the engine runs it; returns its cost in ms.
export function step(world: World, rt: Runtime): number {
  const t0 = performance.now();
  world.time += TICK;
  world.tick++;
  stepPhysics(world, TICK);
  for (const c of world.creatures) updateCreature(world, c, TICK);
  lifeCycle(world, TICK);
  rt.step(TICK);
  world.particles.update(TICK);
  world.events.length = 0;
  return performance.now() - t0;
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
  let status = "playing";
  for (let k = 0; k < 30 * 85 && status === "playing"; k++) {
    if (job.magic && k === 150) {
      const code = readFileSync(join("lab/solutions", plan.file), "utf8");
      plan.at.forEach(([x, y], n) => rt.cast({ key: `${plan.file}${n}`, name: plan.file, tier: plan.tier, code }, x, y));
    }
    step(world, rt);
    run.tick(world);
    if (k % 15 === 0) status = run.check(world).status;
  }
  return { status, errors };
}
