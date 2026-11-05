import type { CheckResult } from "./check";
import type { CastRequest } from "./runtime";
import CheckWorker from "./checkworker?worker&inline";
import { unfinishedRun } from "../checkresult";

// Entry point of the check iframe (check.html): runs the test run of a new
// program (check.ts) on a scratch island, out of sight, and says how it went.
// A separate sandboxed frame, so a program under test shares nothing with the
// player's world.
//
// 4.2: the frame no longer runs the simulation itself. It hands each program
// to a Web Worker it makes from a blob (so the worker has the frame's opaque
// origin and CSP: `worker-src blob:` and nothing else is opened), which runs
// it to the end without pauses and off the page's thread: before, the frame
// ran 8 ms slices between the page's frames, and a hidden frame's timers are
// slowed, so a protection spell's 3.7 s of work took 28 s and an artifact's
// five minute test never finished in the minute allowed. Up to two workers
// run at once on a phone with the cores for it. A program that keeps a
// worker busy past WORKER_MS is stopped by terminating the worker; that
// counts as "did not finish": cast here, reported to nobody (4.5.1). Where a
// worker cannot be made, the frame runs the test itself as before.

type Job = { id: number; spell: CastRequest };

const SLICE_MS = 8;
const WORKER_MS = 45_000;
const POOL = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 2));

interface Slot {
  worker: Worker;
  job: Job | null;
  timer: number;
}

const queue: Job[] = [];
const slots: Slot[] = [];
let workers = true;

function reply(id: number, result: CheckResult | Record<string, unknown>): void {
  window.parent.postMessage({ type: "checked", id, result }, "*");
}

function makeSlot(): Slot | null {
  try {
    const worker = new CheckWorker();
    const slot: Slot = { worker, job: null, timer: 0 };
    worker.addEventListener("message", (e: MessageEvent<{ id: number; result: CheckResult }>) => {
      if (!slot.job || e.data?.id !== slot.job.id) return;
      clearTimeout(slot.timer);
      slot.job = null;
      reply(e.data.id, e.data.result);
      pump();
    });
    worker.addEventListener("error", (e: ErrorEvent) => {
      e.preventDefault();
      const job = slot.job;
      drop(slot);
      // A worker that cannot even start (a CSP, an old browser): the frame
      // does the work itself from now on, this job included.
      if (job) queue.unshift(job);
      if (!slots.length) workers = false;
      pump();
    });
    return slot;
  } catch {
    return null;
  }
}

function drop(slot: Slot): void {
  clearTimeout(slot.timer);
  slot.worker.terminate();
  const i = slots.indexOf(slot);
  if (i >= 0) slots.splice(i, 1);
}

function pump(): void {
  if (!workers) {
    if (!running) void runHere();
    return;
  }
  while (queue.length) {
    let slot = slots.find((s) => !s.job);
    if (!slot && slots.length < POOL) {
      const made = makeSlot();
      if (!made) {
        workers = false;
        if (!running) void runHere();
        return;
      }
      slots.push(made);
      slot = made;
    }
    if (!slot) return;
    const job = queue.shift()!;
    slot.job = job;
    const s = slot;
    s.timer = window.setTimeout(() => {
      // Stuck in spell code: the worker goes, the test counts as not finished.
      drop(s);
      reply(job.id, unfinishedRun("The test run did not finish in time"));
      pump();
    }, WORKER_MS);
    slot.worker.postMessage(job);
  }
}

// The way before 4.2, kept for browsers that cannot make the worker.
let running = false;
async function runHere(): Promise<void> {
  running = true;
  const { checkProgram } = await import("./check");
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
    reply(job.id, result);
  }
  running = false;
}

window.addEventListener("message", (e: MessageEvent<{ type?: string; id?: number; spell?: CastRequest }>) => {
  if (e.source !== window.parent || !e.data || e.data.type !== "check" || typeof e.data.id !== "number" || !e.data.spell) return;
  queue.push({ id: e.data.id, spell: e.data.spell });
  pump();
});

window.parent.postMessage({ type: "check-ready", workers: POOL }, "*");
