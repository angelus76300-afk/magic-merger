import { checkProgram, type CheckResult } from "./check";
import type { CastRequest } from "./runtime";

// Entry point of the check iframe (check.html): runs the test run of a new
// program (check.ts) on a scratch island, out of sight, and says how it went.
// A separate sandboxed frame, so a program under test shares nothing with the
// player's world. It runs a little at a time, so the page stays smooth.

type Job = { id: number; spell: CastRequest };
const queue: Job[] = [];
let running = false;

// About 8 ms of work, then a pause for the page to draw.
const SLICE_MS = 8;

async function run(): Promise<void> {
  running = true;
  while (queue.length) {
    const job = queue.shift()!;
    let result: CheckResult;
    try {
      const it = checkProgram(job.spell);
      for (;;) {
        const t0 = performance.now();
        let r = it.next();
        while (!r.done && performance.now() - t0 < SLICE_MS) r = it.next();
        if (r.done) {
          result = r.value;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (err) {
      result = {
        ok: false,
        problem: "crash",
        detail: `It crashed: ${err instanceof Error ? err.message : String(err)}`,
        stats: { seconds: 0, cells: 0, share: 0, voxels: 0, creatures: 0, bodies: 0, villagersLeft: 1, housesLeft: 1, worstTickMs: 0 },
      };
    }
    window.parent.postMessage({ type: "checked", id: job.id, result }, "*");
  }
  running = false;
}

window.addEventListener("message", (e: MessageEvent<{ type?: string; id?: number; spell?: CastRequest }>) => {
  if (e.source !== window.parent || !e.data || e.data.type !== "check" || typeof e.data.id !== "number" || !e.data.spell) return;
  queue.push({ id: e.data.id, spell: e.data.spell });
  if (!running) void run();
});

window.parent.postMessage({ type: "check-ready" }, "*");
