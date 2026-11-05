import { memoryD1 } from "./d1-memory";
import { nextEvidence, type Evidence } from "../worker/evidence";
import { REWRITE_COOLDOWN_MS } from "../shared/votes";

// Rewrites by evidence (daily 2026-11-05, worker/evidence.ts), run by npm test
// (scripts/sim-test.ts, section 14): which live program the daily job writes
// again, in which order, and that it never starts twice from the same one.
// The cron's side (one a day, the budget, the trial) is in
// scripts/worker-test.mjs, section 32.
type Check = (name: string, ok: boolean, detail?: string) => void;

const NOW = Date.UTC(2026, 10, 6, 12);
const FAIL = JSON.stringify({ ok: false, problem: "idle", detail: "Placed by a village and left alone for five minutes, it changed nothing." });
const PASS = JSON.stringify({ ok: true, problem: null, detail: "" });

export async function evidenceChecks(check: Check): Promise<void> {
  const db = memoryD1();
  const program = async (key: string, status: string, checked: string | null, origin = "new") =>
    Number(
      (
        await db
          .prepare("INSERT INTO programs (key, spec, model, version, origin, status, parent, created_at, checked) VALUES (?, ?, 'm', 6, ?, ?, NULL, ?, ?)")
          .bind(key, JSON.stringify({ code: `/* ${key} */`, summary: key }), origin, status, NOW - 86400_000, checked)
          .run()
      ).meta.last_row_id,
    );
  const casts = async (pid: number, n: number) => {
    for (let i = 0; i < n; i++) await db.prepare("INSERT INTO casts (player, pid, at) VALUES (?, ?, ?)").bind(`player-${pid}-${i}`, pid, NOW).run();
  };
  const rewrite = (key: string, from: number, cause: string, status: string, at = NOW - 10 * 86400_000) =>
    db.prepare("INSERT INTO rewrites (key, from_pid, cause, at, status) VALUES (?, ?, ?, ?, ?)").bind(key, from, cause, at, status).run();
  const pick = async (entries: Evidence[] = []) => {
    const c = await nextEvidence(db, entries, NOW);
    return c ? `${c.source}:${c.row.key}` : "none";
  };

  const frost = await program("frost nova", "live", PASS);
  const light = await program("light", "live", FAIL, "legacy");
  const volcano = await program("volcano", "live", FAIL);
  const twin = await program("twin", "live", FAIL, "check");
  const wisp = await program("wisp", "live", FAIL);
  await program("ember", "live", PASS);
  await program("moss", "live", null);
  await casts(twin, 5);
  await casts(volcano, 2);
  // The 2 November refresh tried Light already: a rewrite started from it.
  await rewrite("light", light, "refresh", "done");
  const entries: Evidence[] = [
    { key: "frost nova", pid: frost, found: "test", reasons: ["its thaw burns the village"] },
    { key: "light", pid: light, found: "test", reasons: ["it protects nothing"] },
  ];

  const first = await pick(entries);
  const entry = await nextEvidence(db, entries, NOW);
  check(
    "a reviewed finding comes first, with its own words, even on a program whose test passed",
    first === "reviewed:frost nova" && entry?.reasons[0] === "its thaw burns the village",
    first,
  );

  // Spent once a rewrite started from it, and when its program is no longer the live one.
  await rewrite("frost nova", frost, "evidence", "done", NOW - 4 * 86400_000);
  const afterFrost = await pick(entries);
  check("a reviewed finding is spent once a rewrite by evidence started from its program", afterFrost === "reviewed:light", afterFrost);
  const stale: Evidence[] = [{ key: "light", pid: light + 1000, found: "test", reasons: ["x"] }];
  const wrongKey: Evidence[] = [{ key: "volcano", pid: light, found: "test", reasons: ["x"] }];
  const s1 = await pick(stale);
  const s2 = await pick(wrongKey);
  check("a finding about a program that is no longer live, or another element's, is skipped", s1 === "test:twin" && s2 === "test:twin", `${s1} ${s2}`);

  // A failed test run: the most cast first; a program some rewrite already
  // started from is left to a reviewed finding (Light here).
  const t1 = await nextEvidence(db, [], NOW);
  check(
    "without a finding, the most cast live program whose test failed, never one a rewrite already started from",
    t1?.source === "test" && t1.row.key === "twin" && /changed nothing\. \(idle\)$/.test(t1.reasons[0]),
    JSON.stringify(t1 && { key: t1.row.key, reasons: t1.reasons }),
  );

  // A version that is no longer live is never chosen, however much it was cast.
  await db.prepare("UPDATE programs SET status = 'retired' WHERE id = ?").bind(wisp).run();
  await casts(wisp, 10);
  const r1 = await pick();
  const r2 = await pick([{ key: "wisp", pid: wisp, found: "test", reasons: ["x"] }]);
  check("a version no longer live is never chosen, by its test or by a finding", r1 === "test:twin" && r2 === "test:twin", `${r1} ${r2}`);

  // Never twice from the same program; three failed attempts and it is given up.
  await rewrite("twin", twin, "evidence", "failed", NOW - 4 * 86400_000);
  await rewrite("twin", twin, "evidence", "failed", NOW - 4 * 86400_000);
  const twoFailed = await pick();
  await rewrite("twin", twin, "evidence", "failed", NOW - 4 * 86400_000);
  const threeFailed = await pick();
  check(
    "an attempt that failed before storing anything is tried again, at most three times",
    twoFailed === "test:twin" && threeFailed === "test:volcano",
    `${twoFailed} then ${threeFailed}`,
  );

  // A trial of the element waiting for its test, or a rewrite in the cooldown: not now.
  const trial = await program("volcano", "trial", null);
  const withTrial = await pick();
  await db.prepare("UPDATE programs SET status = 'rejected' WHERE id = ?").bind(trial).run();
  await rewrite("volcano", volcano + 1000, "votes", "done", NOW - REWRITE_COOLDOWN_MS + 3600_000);
  const cooling = await pick();
  check(
    "an element with a trial waiting, or rewritten by votes within the cooldown, waits",
    withTrial === "none" && cooling === "none",
    `${withTrial} ${cooling}`,
  );
  await db
    .prepare("UPDATE rewrites SET at = ? WHERE key = 'volcano'")
    .bind(NOW - REWRITE_COOLDOWN_MS - 3600_000)
    .run();
  const cooled = await pick();
  await rewrite("volcano", volcano, "evidence", "done", NOW - REWRITE_COOLDOWN_MS - 3600_000);
  const done = await pick();
  check(
    "after the cooldown it is written; once written, nothing that passed or was never tested is taken",
    cooled === "test:volcano" && done === "none",
    `${cooled} then ${done}`,
  );
}
