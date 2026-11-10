import { REWRITE_COOLDOWN_MS } from "../shared/votes";
import type { ProgramRow } from "./programs";

// Rewrites by evidence (ROADMAP 4.7.5 item 3, started on 5 November 2026): a live
// program shown not to do what it promises is written again, one a day, by
// the cron, through the same path as a rewrite asked by votes (the daily
// rewrite budget, the three day cooldown, the old version kept for rollback,
// a trial tested by the next browser before anyone else gets it).
//
// Two kinds of evidence, in this order:
//   1. A reviewed finding (EVIDENCE below): someone cast the item and saw it
//      break its name or description. Each one names the program it was seen
//      on, so it is spent once that program is no longer the live one.
//   2. The program's own stored test run failed (`checked.ok` false), and no
//      rewrite has started from it yet, or only a refresh one that missed
//      (the owner's idea, 5 November: a second attempt, told why the first
//      was rejected). A refresh rewrite misses when its candidate failed its
//      own test, or was superseded unjudged; the rewrite by evidence is then
//      told what that candidate's test found. A refresh candidate that passed
//      its test and lost on the judge still keeps the program out: the judge
//      is the doubt there, not the writer (docs/IDEAS.md, "When the test and
//      the judge disagree"). Any other rewrite from it (votes, the judge, a
//      broken promise, evidence) was already told why, and its failed trial
//      written once more by the "rewrite once" rule: it needs a reviewed
//      finding.
//
// Never twice from the same program: for a reviewed finding, a rewrite by
// evidence that started from it; for a failed test, any rewrite but a refresh
// that missed. At most three attempts that failed before storing anything.

export interface Evidence {
  key: string;
  // The live program the finding was seen on.
  pid: number;
  // Where it was seen, for the record.
  found: string;
  // Worded for the model, as the reasons of a vote rewrite are.
  reasons: string[];
}

export const EVIDENCE: Evidence[] = [
  {
    key: "frost nova",
    pid: 409,
    found: "audit 2026-11-05, sample 16",
    reasons: [
      "it is a frost spell, but when its ice melts at ten seconds it heats the ground to 160 degrees (w.temperature with 160): the place catches fire, 40 cells burning, 5 creatures burning and 12 house cells lost in the audit's cast. Its thaw must only bring the ground back to normal, never above it, and nothing it does may burn",
    ],
  },
  {
    key: "light",
    pid: 27,
    found: "audit 2026-11-05, sample 4",
    reasons: [
      "it promises protection, but its test found the village it covers no safer with it than without it (a flood of lava 13%, a blast 0%, raiders 0% of the harm prevented). A lasting light that scares spirits must keep a village safe while it lasts",
    ],
  },
];

export interface EvidenceCandidate {
  row: ProgramRow;
  reasons: string[];
  source: "reviewed" | "test";
}

// A program the job may start from: still the live one, of an element that
// exists, no rewrite started from it, no trial of its element waiting for its
// test, and no rewrite of that element in the cooldown.
// A refresh rewrite that missed: its candidate failed its own test, or was superseded unjudged.
const MISSED = `r.cause = 'refresh' AND (r.status = 'superseded'
  OR EXISTS (SELECT 1 FROM programs x WHERE x.id = r.to_pid AND CASE WHEN json_valid(x.checked) THEN json_extract(x.checked, '$.ok') END = 0))`;

const FREE = `p.status = 'live'
  AND EXISTS (SELECT 1 FROM elements e WHERE e.key = p.key)
  AND NOT EXISTS (SELECT 1 FROM rewrites r WHERE r.from_pid = p.id AND r.status != 'failed' AND (r.cause = 'evidence' OR (? AND NOT (${MISSED}))))
  AND (SELECT COUNT(*) FROM rewrites r WHERE r.from_pid = p.id AND r.cause = 'evidence') < 3
  AND NOT EXISTS (SELECT 1 FROM programs t WHERE t.key = p.key AND t.status IN ('trial', 'candidate') AND t.id > p.id)
  AND NOT EXISTS (SELECT 1 FROM rewrites c WHERE c.key = p.key AND c.at > ? AND c.cause IN ('votes', 'judge', 'evidence') AND c.status != 'failed')`;

export async function nextEvidence(db: D1Database, entries: Evidence[] = EVIDENCE, now = Date.now()): Promise<EvidenceCandidate | null> {
  const cooled = now - REWRITE_COOLDOWN_MS;
  for (const e of entries) {
    const row = await db.prepare(`SELECT p.* FROM programs p WHERE p.id = ? AND p.key = ? AND ${FREE}`).bind(e.pid, e.key, 0, cooled).first<ProgramRow>();
    if (row) return { row, reasons: e.reasons, source: "reviewed" };
  }
  // The most cast first: the one players meet most. A stored verdict that is
  // not JSON (one cut at 2000 characters before the review of #45) is read
  // as no verdict: json_extract would throw on it, for every row it scans.
  // How often each program was cast is counted once, in one pass over `casts`,
  // and only if a program failed. It was a subquery in the ORDER BY: one scan
  // of `casts` (no index on pid) for each program that failed, 3.3 million rows
  // read for 450 of them over 30,000 casts, and the same again at every run of
  // the cron that found nothing to do.
  const row = await db
    .prepare(
      `SELECT p.* FROM programs p
       LEFT JOIN (SELECT pid, COUNT(*) AS n FROM casts GROUP BY pid) c ON c.pid = p.id
       WHERE CASE WHEN json_valid(p.checked) THEN json_extract(p.checked, '$.ok') END = 0 AND ${FREE}
       ORDER BY COALESCE(c.n, 0) DESC, p.id
       LIMIT 1`,
    )
    .bind(1, cooled)
    .first<ProgramRow>();
  if (!row) return null;
  const reasons = [`its own test run found: ${detailOf(row.checked)}`];
  // The refresh's candidate that failed its test, if there was one: what not to do again.
  const missed = await db
    .prepare(
      `SELECT x.id, x.checked FROM rewrites r JOIN programs x ON x.id = r.to_pid
       WHERE r.from_pid = ? AND r.cause = 'refresh' AND CASE WHEN json_valid(x.checked) THEN json_extract(x.checked, '$.ok') END = 0
       ORDER BY r.at DESC LIMIT 1`,
    )
    .bind(row.id)
    .first<{ id: number; checked: string | null }>();
  if (missed)
    reasons.push(
      `an earlier rewrite of it (program ${missed.id}) was rejected, because its own test run found: ${detailOf(missed.checked)}; do not repeat that mistake`,
    );
  return { row, reasons, source: "test" };
}

function detailOf(checked: string | null): string {
  try {
    const v = JSON.parse(checked ?? "{}") as { detail?: unknown; problem?: unknown };
    const detail = typeof v.detail === "string" && v.detail.trim() ? v.detail.trim().slice(0, 400) : "it failed";
    return typeof v.problem === "string" ? `${detail} (${v.problem.slice(0, 40)})` : detail;
  } catch {
    return "it failed";
  }
}
