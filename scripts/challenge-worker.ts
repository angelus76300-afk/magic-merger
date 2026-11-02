// A worker thread of `npm test`: replays challenges beside the other checks.
// The workers share one counter and take the next replay themselves, because
// the main thread is busy and cannot hand out work until it is done.
import { parentPort, workerData } from "node:worker_threads";
import { replay, type Replay } from "./challenge-replay";

const { jobs, next } = workerData as { jobs: Replay[]; next: Int32Array };
for (let k = Atomics.add(next, 0, 1); k < jobs.length; k = Atomics.add(next, 0, 1)) {
  parentPort!.postMessage({ job: jobs[k], ...replay(jobs[k]) });
}
