import { FIRST_PROGRAM_VERSION } from "../shared/spellcode";

// 4.2: every new item is written at the merge, in a background job.
//
// The merge that makes a new item (or reaches a known item that has no
// program yet) records one row in `writes` and sends its key to the WRITES
// queue; the queue's consumer (index.ts, `queue`) writes the program with the
// model its tier calls for (the small one up to grand, the big one above, as
// on first use), billed to the player whose merge started it. A Cloudflare
// Queue, not waitUntil: a big model's program can take a minute, past what
// waitUntil is given after the response.
//
// Idempotent three times over: the row's primary key (one job per item,
// ever), the claim below (a message delivered twice runs once), and the same
// in-flight key as a player's own request for the program (`spell:<key>`), so
// a player who asks while the job writes waits for it instead of paying again.
//
// A daily cap (AHEAD_DAILY_USD, $1.50 by default) bounds what these writes
// spend for everyone together: a job that would pass it is marked capped and
// the item is written on first use, as before 4.2. The claim is one statement
// (D1 runs one at a time), like the budget's hold.

// A job: the item to write, or a poll of the big items' batches (its round).
export interface WriteJob {
  key?: string;
  poll?: number;
}

export type WriteStatus = "queued" | "writing" | "done" | "failed" | "capped" | "unpaid";

export interface WriteRow {
  key: string;
  invite: string;
  cause: "new" | "first";
  status: WriteStatus;
  day: string;
  queued_at: number;
  started_at: number | null;
  done_at: number | null;
  est: number;
  usd: number;
  model: string | null;
  pid: number | null;
  error: string | null;
}

export const AHEAD_DAILY_DEFAULT = 1.5;
// Held against the day's cap while a program is written: above the measured
// cost of a small program ($0.002) and of a big one ($0.04 to $0.06).
export const AHEAD_ESTIMATE = { small: 0.004, big: 0.09 } as const;
// A job that has not finished in this long is taken over by first use: a
// small program takes seconds, a big one goes through the Batch API (minutes).
export const WRITE_STALE_MS = 3 * 60_000;
export const BIG_WRITE_STALE_MS = 45 * 60_000;

export function aheadCap(raw: string | undefined): number {
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : AHEAD_DAILY_DEFAULT;
}

export function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

// Does the item have a program anyone can be served (live, or a trial
// waiting for its test run)? A version 1 row of `spells` is a declarative
// spec from before programs, written again on first use: not a program
// (found on production: Healing Rain had one and was not written ahead).
export async function hasProgram(db: D1Database, key: string): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 AS n FROM spells WHERE key = ?1 AND version >= ?2 UNION ALL SELECT 1 FROM programs WHERE key = ?1 AND status IN ('live', 'trial') LIMIT 1",
    )
    .bind(key, FIRST_PROGRAM_VERSION)
    .first<{ n: number }>();
  return !!row;
}

// At the merge: queues the item's program unless it has one, or a job for it
// exists. True when a job is (now) queued or writing for it.
export async function startWrite(
  db: D1Database,
  queue: Queue<WriteJob> | undefined,
  key: string,
  invite: string,
  cause: "new" | "first",
  now = Date.now(),
): Promise<boolean> {
  if (!queue || (await hasProgram(db, key))) return false;
  const r = await db
    .prepare("INSERT OR IGNORE INTO writes (key, invite, cause, status, day, queued_at) VALUES (?, ?, ?, 'queued', ?, ?)")
    .bind(key, invite, cause, utcDay(now), now)
    .run();
  if (!r.meta.changes) return (await activeWrite(db, key, now)) !== null;
  try {
    await queue.send({ key });
    return true;
  } catch (err) {
    console.error("could not queue a write", key, err);
    await finishWrite(db, key, "failed", { error: "not queued" });
    return false;
  }
}

// A job queued or writing, and not stale.
export async function activeWrite(db: D1Database, key: string, now = Date.now()): Promise<WriteRow | null> {
  const row = await db.prepare("SELECT * FROM writes WHERE key = ?").bind(key).first<WriteRow>();
  if (!row) return null;
  if (row.status === "queued" && now - row.queued_at < WRITE_STALE_MS) return row;
  const stale = row.est >= AHEAD_ESTIMATE.big ? BIG_WRITE_STALE_MS : WRITE_STALE_MS;
  if (row.status === "writing" && now - (row.started_at ?? row.queued_at) < stale) return row;
  return null;
}

export async function getWrite(db: D1Database, key: string): Promise<WriteRow | null> {
  return db.prepare("SELECT * FROM writes WHERE key = ?").bind(key).first<WriteRow>();
}

// Writes ahead never take the last part of the month's budget: past this
// share of it, items are written on first use only, so merges and first
// uses keep what is left (4.2: at November's rate of new items, $1.50 a day
// ahead plus play would reach the $50 before the month ends).
export const AHEAD_MONTH_SHARE = 0.8;

// Takes a queued job if the day's cap can hold its estimate (what jobs being
// written hold, what finished ones cost, and this one) and the month is under
// its share of the budget. One statement, so two consumers at the last cent
// cannot both pass. "capped" marks the row.
export async function claimWrite(
  db: D1Database,
  key: string,
  est: number,
  cap: number,
  month: { start: number; budget: number },
  now = Date.now(),
): Promise<"go" | "capped" | "gone"> {
  const day = utcDay(now);
  const r = await db
    .prepare(
      `UPDATE writes SET status = 'writing', started_at = ?1, est = ?2
       WHERE key = ?3 AND status = 'queued'
         AND (SELECT COALESCE(SUM(CASE status WHEN 'writing' THEN est ELSE usd END), 0) FROM writes
              WHERE day = ?4 AND status IN ('writing', 'done', 'failed', 'unpaid')) + ?2 <= ?5
         AND (SELECT COALESCE(SUM(usd), 0) FROM spend WHERE at >= ?6)
           + (SELECT COALESCE(SUM(usd), 0) FROM reservations WHERE settled = 0) + ?2 <= ?7`,
    )
    .bind(now, est, key, day, cap, month.start, month.budget * AHEAD_MONTH_SHARE)
    .run();
  if (r.meta.changes) return "go";
  const capped = await db.prepare("UPDATE writes SET status = 'capped', done_at = ? WHERE key = ? AND status = 'queued'").bind(now, key).run();
  return capped.meta.changes ? "capped" : "gone";
}

export async function finishWrite(
  db: D1Database,
  key: string,
  status: WriteStatus,
  o: { usd?: number; pid?: number | null; model?: string; error?: string } = {},
): Promise<void> {
  await db
    .prepare("UPDATE writes SET status = ?, done_at = ?, usd = ?, pid = ?, model = COALESCE(?, model), error = ? WHERE key = ?")
    .bind(status, Date.now(), o.usd ?? 0, o.pid ?? null, o.model ?? null, o.error?.slice(0, 300) ?? null, key)
    .run();
}

// What the writes did, for the admin: the day so far and the month by day.
export async function aheadReport(db: D1Database, cap: number, now = Date.now()) {
  const month = utcDay(now).slice(0, 7);
  const rows = await db
    .prepare(
      `SELECT day, status, COUNT(*) AS n, ROUND(SUM(usd), 4) AS usd, ROUND(AVG(CASE WHEN done_at AND started_at THEN done_at - started_at END)) AS ms
       FROM writes WHERE day LIKE ? GROUP BY day, status ORDER BY day`,
    )
    .bind(`${month}%`)
    .all<{ day: string; status: WriteStatus; n: number; usd: number; ms: number | null }>();
  return { cap, today: utcDay(now), rows: rows.results };
}
