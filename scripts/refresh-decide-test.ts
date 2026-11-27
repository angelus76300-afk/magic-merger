// The refresh's verdict (scripts/refresh-decide.ts): a tie keeps the old program unless the old one
// fails its own test run. Before 27 November 2026 a tie replaced it: the run of 26 November replaced
// 13 of 20 items, 11 of them on ties ("judged 2 against 2").
import { decideRefresh, type RefreshCase } from "./refresh-decide";

type Check = (name: string, ok: boolean, detail?: string) => void;

const pass = { ok: true, problem: null, detail: "it ran" } as const;
const yes = (score: number) => ({ score, alive: "yes" });

export function refreshDecideChecks(check: Check, decide: (c: RefreshCase) => { replace: boolean; reason: string } = decideRefresh): void {
  const tie = decide({ form: null, check: pass, old: { ok: true, problem: null }, o: yes(2), n: yes(2) });
  check("refresh: a tie with both passing keeps the old", !tie.replace && /equal \(2 against 2\)/.test(tie.reason), tie.reason);
  const tieForm = decide({ form: "creature", check: pass, old: { ok: true, problem: null }, o: yes(4), n: yes(4) });
  check("refresh: a tie keeps the old for an item with a form too", !tieForm.replace, tieForm.reason);
  const higher = decide({ form: null, check: pass, old: { ok: true, problem: null }, o: yes(2), n: yes(3) });
  check("refresh: a strictly higher new score replaces", higher.replace && /judged 3 against 2/.test(higher.reason), higher.reason);
  const lower = decide({ form: null, check: pass, old: { ok: true, problem: null }, o: yes(3), n: yes(2) });
  check("refresh: a lower new score keeps the old", !lower.replace, lower.reason);
  for (const problem of ["crash", "idle"] as const) {
    const r = decide({ form: null, check: pass, old: { ok: false, problem }, o: yes(2), n: yes(2) });
    check(`refresh: an old that fails its test (${problem}) is replaced by a passing new one on a tie`, r.replace && r.reason.includes(problem), r.reason);
  }
  const kind = decide({ form: "creature", check: pass, old: { ok: false, problem: "kind" }, o: yes(4), n: yes(2) });
  check("refresh: an old of the wrong kind is replaced whatever the score", kind.replace, kind.reason);
  const failed = decide({ form: null, check: { ok: false, problem: "crash", detail: "boom" }, old: { ok: false, problem: "crash" }, o: yes(1), n: null });
  check("refresh: a new one that fails its test never replaces", !failed.replace, failed.reason);
  const dull = decide({ form: null, check: pass, old: { ok: true, problem: null }, o: yes(2), n: { score: 3, alive: "no" } });
  check("refresh: a higher score with creatures less alive keeps the old", !dull.replace, dull.reason);
  const first = decide({ form: null, check: pass, old: null, o: null, n: yes(2) });
  check("refresh: with no old program a passing new one is taken", first.replace, first.reason);
}
