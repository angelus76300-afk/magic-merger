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
//      rewrite of any kind has started from it yet. A program the refresh or
//      a failed trial already tried to replace needs a reviewed finding: the
//      2 November refresh showed that writing those again without a reason
//      gave worse programs as often as better ones.
//
// Never twice from the same program: a rewrite that started from it counts,
// and at most three attempts that failed before storing anything.

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

// A program the job may start from: still the live one, no rewrite started
// from it, no trial of its element waiting for its test, and no rewrite of
// that element in the cooldown.
const FREE = `p.status = 'live'
  AND NOT EXISTS (SELECT 1 FROM rewrites r WHERE r.from_pid = p.id AND r.status != 'failed' AND (r.cause = 'evidence' OR ?))
  AND (SELECT COUNT(*) FROM rewrites r WHERE r.from_pid = p.id AND r.cause = 'evidence') < 3
  AND NOT EXISTS (SELECT 1 FROM programs t WHERE t.key = p.key AND t.status IN ('trial', 'candidate') AND t.id > p.id)
  AND NOT EXISTS (SELECT 1 FROM rewrites c WHERE c.key = p.key AND c.at > ? AND c.cause IN ('votes', 'judge', 'evidence') AND c.status != 'failed')`;

export async function nextEvidence(db: D1Database, entries: Evidence[] = EVIDENCE, now = Date.now()): Promise<EvidenceCandidate | null> {
  const cooled = now - REWRITE_COOLDOWN_MS;
  for (const e of entries) {
    const row = await db.prepare(`SELECT p.* FROM programs p WHERE p.id = ? AND p.key = ? AND ${FREE}`).bind(e.pid, e.key, 0, cooled).first<ProgramRow>();
    if (row) return { row, reasons: e.reasons, source: "reviewed" };
  }
  // The most cast first: the one players meet most.
  const row = await db
    .prepare(
      `SELECT p.* FROM programs p
       WHERE json_extract(p.checked, '$.ok') = 0 AND ${FREE}
       ORDER BY (SELECT COUNT(*) FROM casts c WHERE c.pid = p.id) DESC, p.id
       LIMIT 1`,
    )
    .bind(1, cooled)
    .first<ProgramRow>();
  if (!row) return null;
  return { row, reasons: [`its own test run found: ${detailOf(row.checked)}`], source: "test" };
}

function detailOf(checked: string | null): string {
  try {
    const v = JSON.parse(checked ?? "{}") as { detail?: unknown; problem?: unknown };
    const detail = typeof v.detail === "string" && v.detail.trim() ? v.detail.trim().slice(0, 400) : "it failed";
    return typeof v.problem === "string" ? `${detail} (${v.problem})` : detail;
  } catch {
    return "it failed";
  }
}
