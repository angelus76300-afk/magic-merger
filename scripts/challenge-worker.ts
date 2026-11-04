// A worker thread of `npm test`: replays challenges, and plays the five
// minute scene (3.6), beside the other checks. The workers share one counter
// and take the next job themselves, because the main thread is busy and
// cannot hand out work until it is done.
import { parentPort, workerData } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SOLUTIONS, replay, solves, winRate, type Replay } from "./challenge-replay";
import { runScene } from "../src/sim/check";
import { challengeById } from "../shared/challenges";
import { Runtime } from "../src/sim/runtime";
import { measureMotion } from "./motion-run";
import { landLife } from "./land-life";
import type { Biome, Shape } from "../src/sim/land";

// As in sim-test.ts (review M8): no verdict depends on the machine's speed.
Runtime.slowMs = Number(process.env.SLOW_MS) || Infinity;

// A challenge of 3.7, verified with the plain solution of its hazard.
// 4.3: how creatures move, on one seed (motion-run.ts).
// 4.4: a generated island of each biome, left alone (land-life.ts).
export type Job =
  | Replay
  | { scene: number; seconds: number }
  | { challenge: string }
  | { motion: number }
  | { rate: string }
  | { biome: Biome | "mixed"; shape: Shape; seed: number; seconds: number; size?: number };

const { jobs, next } = workerData as { jobs: Job[]; next: Int32Array };
for (let k = Atomics.add(next, 0, 1); k < jobs.length; k = Atomics.add(next, 0, 1)) {
  const job = jobs[k];
  if ("motion" in job) parentPort!.postMessage({ job, motion: measureMotion(job.motion) });
  else if ("biome" in job) parentPort!.postMessage({ job, land: landLife(job.biome, job.shape, job.seed, job.seconds, job.size) });
  else if ("rate" in job) {
    const def = challengeById(job.rate)!;
    const plan = SOLUTIONS[def.scenario];
    parentPort!.postMessage({ job, rate: winRate(def, readFileSync(join("lab/solutions", plan.file), "utf8"), plan.tier) });
  } else if ("scene" in job) parentPort!.postMessage({ job, report: runScene(job.seconds, null, 300, undefined, job.scene) });
  else if ("challenge" in job) {
    const def = challengeById(job.challenge)!;
    const plan = SOLUTIONS[def.scenario];
    parentPort!.postMessage({ job, verified: solves(def, readFileSync(join("lab/solutions", plan.file), "utf8"), plan.tier) });
  } else parentPort!.postMessage({ job, ...replay(job) });
}
