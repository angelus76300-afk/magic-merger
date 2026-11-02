// A worker thread of `npm test`: replays challenges, and plays the five
// minute scene (3.6), beside the other checks. The workers share one counter
// and take the next job themselves, because the main thread is busy and
// cannot hand out work until it is done.
import { parentPort, workerData } from "node:worker_threads";
import { replay, type Replay } from "./challenge-replay";
import { runScene } from "../src/sim/check";

export type Job = Replay | { scene: number; seconds: number };

const { jobs, next } = workerData as { jobs: Job[]; next: Int32Array };
for (let k = Atomics.add(next, 0, 1); k < jobs.length; k = Atomics.add(next, 0, 1)) {
  const job = jobs[k];
  if ("scene" in job) parentPort!.postMessage({ job, report: runScene(job.seconds, null, 300, undefined, job.scene) });
  else parentPort!.postMessage({ job, ...replay(job) });
}
