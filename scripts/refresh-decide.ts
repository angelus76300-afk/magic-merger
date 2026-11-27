// The refresh's verdict on one candidate (scripts/refresh-runner.ts), apart from the browser and
// the network so it can be tested (scripts/refresh-decide-test.ts). The new program replaces the old
// only when it passes its test run and the judge scores it higher. A tie keeps the old one: an equal
// score shows the rewrite is different, not better (the run of 26 November 2026 replaced 13 of 20
// items, 11 of them on ties). The exception: an old program that fails its own test run (it crashes,
// idles, is the wrong kind or size) is replaced by a new one that passes, on a tie too. The looks
// revamp (worker/looks.ts, lookVerdict) already kept the old on a tie.
import type { CheckProblem } from "../src/sim/check";

export interface Judged {
  score: number;
  alive: string;
}

export interface RefreshCase {
  // The candidate's form when it has one (4.6): a wrong kind, size or fit then fails the old one.
  form: string | null | undefined;
  // The new program's test run.
  check: { ok: boolean; problem: CheckProblem | null; detail: string };
  // The old program's test run, null when there is no old code.
  old: { ok: boolean; problem: CheckProblem | null } | null;
  // The judge's answers: null when not judged (the new one failed its run, or there is no old code).
  o: Judged | null;
  n: Judged | null;
}

export function decideRefresh({ form, check, old, o, n }: RefreshCase): { replace: boolean; reason: string } {
  // 4.6: an old program that is not the kind of thing its item is (a Serpent of stone spheres, a
  // Village that is a charm, a Serpent with a shield) fails the same test run; the judge's score of
  // it then decides nothing.
  const wrongKind = !!form && !!old && (old.problem === "kind" || old.problem === "size" || old.problem === "fit");
  if (!check.ok) return { replace: false, reason: `its test run failed (${check.problem}): ${check.detail}` };
  if (!n) return { replace: false, reason: "the judge did not answer" };
  if (wrongKind)
    return {
      replace: true,
      reason: `the old one is not ${form === "object" ? "an object" : `a ${form}`} of its size (${old!.problem}); the new one passed its test run, judged ${n.score}${o ? ` against ${o.score}` : ""}`,
    };
  if (o && n.score < o.score) return { replace: false, reason: `the judge scored it lower (${n.score} against ${o.score})` };
  if (o && o.alive === "yes" && n.alive === "no") return { replace: false, reason: "its creatures looked less alive" };
  if (o && n.score === o.score) {
    if (old && !old.ok)
      return { replace: true, reason: `the old one failed its test run (${old.problem}); the new one passed, judged ${n.score} against ${o.score}` };
    return { replace: false, reason: `the judge scored them equal (${n.score} against ${o.score}): the new one is not shown better` };
  }
  return { replace: true, reason: o ? `passed its test run, judged ${n.score} against ${o.score}` : `passed its test run, judged ${n.score}` };
}
