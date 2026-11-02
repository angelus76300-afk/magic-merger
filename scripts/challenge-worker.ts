// A worker thread of `npm test`: replays challenges, and plays the five
// minute scene (3.6), beside the other checks. The workers share one counter
// and take the next job themselves, because the main thread is busy and
// cannot hand out work until it is done.
import { parentPort, workerData } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SOLUTIONS, replay, solves, type Replay } from "./challenge-replay";
import { runScene } from "../src/sim/check";
import { challengeById } from "../shared/challenges";

// A challenge of 3.7, verified with the plain solution of its hazard.
export type Job = Replay | { scene: number; seconds: number } | { challenge: string };

const { jobs, next } = workerData as { jobs: Job[]; next: Int32Array };
for (let k = Atomics.add(next, 0, 1); k < jobs.length; k = Atomics.add(next, 0, 1)) {
  const job = jobs[k];
  if ("scene" in job) parentPort!.postMessage({ job, report: runScene(job.seconds, null, 300, undefined, job.scene) });
  else if ("challenge" in job) {
    const def = challengeById(job.challenge)!;
    const plan = SOLUTIONS[def.scenario];
    parentPort!.postMessage({ job, verified: solves(def, readFileSync(join("lab/solutions", plan.file), "utf8"), plan.tier) });
  } else parentPort!.postMessage({ job, ...replay(job) });
}
