import type { CheckRequest } from "../shared/types";

// What the check frame says about a test run, read for shape: it runs spell
// code, so its answer is not trusted as it comes. No DOM here, so Node tests
// read it the same way (scripts/sim-test.ts).

// What a test run found, and how long its parts took (4.2, measured only).
// `unfinished` (4.5.1, audit): the run timed out or never started. This
// browser may cast the program, but no verdict goes to the Worker, so an
// untested program is never made live for everyone.
export type CheckOutcome = Omit<CheckRequest, "name" | "id"> & { phases?: Record<string, number>; unfinished?: boolean };

// Every problem the test run knows (src/sim/check.ts). Until 4.2 only the
// first three were read here, so a program that broke its promise (3.4.2) or
// stood idle for five minutes (3.7) reached the Worker as "not ok, no
// problem" and was promoted like a pass.
const PROBLEMS = ["crash", "nothing", "wiped", "promise", "idle", "size", "kind", "look"] as const;

function numbers(raw: unknown, max: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, max)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export function readResult(raw: Record<string, unknown> | undefined): CheckOutcome {
  const problem = (PROBLEMS as readonly unknown[]).includes(raw?.problem) ? (raw!.problem as CheckOutcome["problem"]) : null;
  const ok = raw?.ok === true && !problem;
  // A failure the frame could not name is a crash, never a pass.
  return {
    ok,
    problem: ok ? null : (problem ?? "crash"),
    detail: typeof raw?.detail === "string" ? raw.detail.slice(0, 400) : "",
    stats: numbers(raw?.stats, 20),
    phases: numbers(raw?.phases, 8),
    ...(ok && raw?.unfinished === true ? { unfinished: true } : {}),
  };
}

// A test run that did not finish (it timed out, or the frame never opened):
// the one shape every caller answers with (src/checker.ts, src/sim/checkframe.ts).
export function unfinishedRun(detail: string): CheckOutcome {
  return { ok: true, problem: null, detail, stats: {}, unfinished: true };
}

// What the Worker is told about a run, or null when it must be told nothing:
// an unfinished run is no verdict (4.5.1), so it never makes a program live
// for everyone. Timings stay on the page.
export function reportable(result: CheckOutcome): Omit<CheckOutcome, "phases" | "unfinished"> | null {
  if (result.unfinished) return null;
  const { phases: _phases, unfinished: _unfinished, ...verdict } = result;
  return verdict;
}
