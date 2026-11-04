import { checkProgram, type CheckResult } from "./check";
import type { CastRequest } from "./runtime";

// 4.2: the test run of a new program in a Web Worker. The check frame
// (checkframe.ts) creates it from a blob, so it inherits the frame's opaque
// origin and its CSP (no network, no storage, no page to read); it only does
// the simulation, with nothing drawn, start to end without pauses, off the
// page's thread. The control island and the probe runs without a spell stay
// in this worker between checks.

type Job = { id: number; spell: CastRequest };

function crashed(err: unknown): CheckResult {
  return {
    ok: false,
    problem: "crash",
    detail: `It crashed: ${err instanceof Error ? err.message : String(err)}`,
    stats: { seconds: 0, cells: 0, share: 0, voxels: 0, creatures: 0, bodies: 0, villagersLeft: 1, housesLeft: 1, worstTickMs: 0 },
  };
}

self.addEventListener("message", (e: MessageEvent<Job>) => {
  const job = e.data;
  if (!job || typeof job.id !== "number" || !job.spell) return;
  let result: CheckResult;
  try {
    const it = checkProgram(job.spell);
    for (;;) {
      const r = it.next();
      if (r.done) {
        result = r.value;
        break;
      }
    }
  } catch (err) {
    result = crashed(err);
  }
  (self as unknown as Worker).postMessage({ id: job.id, result });
});
