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
  const program = async (key: string, status: string, checked: string | null, origin = "new", element = true) => {
    if (element)
      await db
        .prepare("INSERT OR IGNORE INTO elements (key, name, emoji, kind, depth, created_at) VALUES (?, ?, '✨', 'spell', 2, ?)")
        .bind(key, key, NOW)
        .run();
    return Number(
      (
        await db
          .prepare("INSERT INTO programs (key, spec, model, version, origin, status, parent, created_at, checked) VALUES (?, ?, 'm', 6, ?, ?, NULL, ?, ?)")
          .bind(key, JSON.stringify({ code: `/* ${key} */`, summary: key }), origin, status, NOW - 86400_000, checked)
          .run()
      ).meta.last_row_id,
    );
  };
  const casts = async (pid: number, n: number) => {
    for (let i = 0; i < n; i++) await db.prepare("INSERT INTO casts (player, pid, at) VALUES (?, ?, ?)").bind(`player-${pid}-${i}`, pid, NOW).run();
  };
  const rewrite = (key: string, from: number, cause: string, status: string, at = NOW - 10 * 86400_000) =>
    db.prepare("INSERT INTO rewrites (key, from_pid, cause, at, status) VALUES (?, ?, ?, ?, ?)").bind(key, from, cause, at, status).run();
  const pick = async (entries: Evidence[] = []) => {
    try {
      const c = await nextEvidence(db, entries, NOW);
      return c ? `${c.source}:${c.row.key}` : "none";
    } catch (err) {
      return `threw ${String(err)}`;
    }
  };

  // A verdict stored cut at 2000 characters before the review of #45, not
  // JSON: json_extract throws on it, whatever the row's status.
  const cut = JSON.stringify({ ok: false, problem: "crash", stats: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`c${i}`, `c${i}`])) }).slice(
    0,
    2000,
  );
  await program("old lamp", "retired", cut);
  await program("cut lamp", "live", cut);
  // An older trial than the live program is stale: newerTrial never serves it.
  await program("twin", "trial", null);

  const frost = await program("frost nova", "live", PASS);
  const light = await program("light", "live", FAIL, "legacy");
  const volcano = await program("volcano", "live", FAIL);
  const twin = await program("twin", "live", FAIL, "check");
  const wisp = await program("wisp", "live", FAIL);
  await program("ember", "live", PASS);
  await program("moss", "live", null);
  // A program whose element is gone, however much it was cast, has nothing to write from.
  const ghost = await program("ghost", "live", FAIL, "new", false);
  await casts(ghost, 20);
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
  const t1 = await nextEvidence(db, [], NOW).catch((err: unknown) => String(err));
  check(
    "without a finding, the most cast live program whose test failed, never one a rewrite already started from, nor one with no element, and an older trial or a verdict that is not JSON in the table stops nothing",
    typeof t1 === "object" && t1?.source === "test" && t1.row.key === "twin" && t1.reasons.length === 1 && /changed nothing\. \(idle\)$/.test(t1.reasons[0]),
    JSON.stringify(typeof t1 === "object" ? t1 && { key: t1.row.key, reasons: t1.reasons } : t1),
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
  // A rewrite in the cooldown that failed before storing anything holds nothing back.
  await rewrite("volcano", volcano + 2000, "votes", "failed", NOW - 3600_000);
  const cooled = await pick();
  await rewrite("volcano", volcano, "evidence", "done", NOW - REWRITE_COOLDOWN_MS - 3600_000);
  const done = await pick();
  check(
    "after the cooldown (a failed rewrite in it does not count) it is written; once written, nothing that passed or was never tested is taken",
    cooled === "test:volcano" && done === "none",
    `${cooled} then ${done}`,
  );

  await informedRetry(check);
}

// The owner's idea (5 November): a program the 2 November refresh tried
// without a reason gets one more attempt when that attempt missed (its
// candidate failed its own test, or was superseded unjudged), told what the
// candidate's test found. One that lost only on the judge stays out.
async function informedRetry(check: Check): Promise<void> {
  const db = memoryD1();
  const live = async (key: string, checked: string | null, casts = 0) => {
    await db.prepare("INSERT INTO elements (key, name, emoji, kind, depth, created_at) VALUES (?, ?, '✨', 'spell', 2, ?)").bind(key, key, NOW).run();
    const pid = Number(
      (
        await db
          .prepare(
            "INSERT INTO programs (key, spec, model, version, origin, status, created_at, checked) VALUES (?, '{\"code\":\"\"}', 'm', 4, 'legacy', 'live', ?, ?)",
          )
          .bind(key, NOW - 9 * 86400_000, checked)
          .run()
      ).meta.last_row_id,
    );
    for (let i = 0; i < casts; i++) await db.prepare("INSERT INTO casts (player, pid, at) VALUES (?, ?, ?)").bind(`p-${key}-${i}`, pid, NOW).run();
    return pid;
  };
  // A refresh candidate of `from`, rejected, with its own test verdict; its rewrites row says how it ended.
  const refresh = async (key: string, from: number, checked: string | null, status = "done") => {
    const to = Number(
      (
        await db
          .prepare(
            "INSERT INTO programs (key, spec, model, version, origin, status, parent, created_at, checked) VALUES (?, '{\"code\":\"\"}', 'm', 6, 'refresh', 'rejected', ?, ?, ?)",
          )
          .bind(key, from, NOW - 3 * 86400_000, checked)
          .run()
      ).meta.last_row_id,
    );
    await db
      .prepare("INSERT INTO rewrites (key, from_pid, to_pid, cause, at, status) VALUES (?, ?, ?, 'refresh', ?, ?)")
      .bind(key, from, to, NOW - 3 * 86400_000, status)
      .run();
    return to;
  };
  const crashed = JSON.stringify({ ok: false, problem: "crash", detail: "It crashed: TypeError: Cannot set property data of #<CreatureHandle>" });
  const pick = async () => {
    const c = await nextEvidence(db, [], NOW);
    return c ? { key: c.row.key, reasons: c.reasons } : null;
  };

  // Wormhole: its refresh candidate crashed (and an older one was superseded) — one informed retry.
  // Cavern: its candidate passed its test and lost on the judge — out, and cast more.
  const wormhole = await live("wormhole", FAIL, 3);
  await refresh("wormhole", wormhole, null, "superseded");
  const missed = await refresh("wormhole", wormhole, crashed);
  const cavern = await live("cavern", FAIL, 9);
  await refresh("cavern", cavern, PASS);
  // Shrine: a broken promise was already written again with its finding, and that trial failed: out.
  const shrine = await live("shrine", FAIL, 20);
  const shrineTrial = Number(
    (
      await db
        .prepare(
          "INSERT INTO programs (key, spec, model, version, origin, status, parent, created_at, checked) VALUES ('shrine', '{\"code\":\"\"}', 'm', 6, 'promise', 'rejected', ?, ?, ?)",
        )
        .bind(shrine, NOW - 3 * 86400_000, crashed)
        .run()
    ).meta.last_row_id,
  );
  await db
    .prepare("INSERT INTO rewrites (key, from_pid, to_pid, cause, at, status) VALUES ('shrine', ?, ?, 'promise', ?, 'done')")
    .bind(shrine, shrineTrial, NOW - 3 * 86400_000)
    .run();
  const first = await pick();
  check(
    "a program whose refresh rewrite failed its own test gets one more, told what that test found; one that lost only on the judge, or whose informed rewrite already failed, does not",
    first?.key === "wormhole" &&
      first.reasons.length === 2 &&
      first.reasons[1].includes(`program ${missed}`) &&
      first.reasons[1].includes("Cannot set property data of #<CreatureHandle>"),
    JSON.stringify(first),
  );

  // Never more: once a rewrite by evidence started from it, it is spent, and nothing else is taken.
  await db
    .prepare("INSERT INTO rewrites (key, from_pid, cause, at, status) VALUES ('wormhole', ?, 'evidence', ?, 'done')")
    .bind(wormhole, NOW - 4 * 86400_000)
    .run();
  const after = await pick();
  check("the informed retry is the last: once written by evidence, the program is not taken again", after === null, JSON.stringify(after));
}
