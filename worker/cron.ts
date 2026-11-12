// The jobs of the ten minute cron (index.ts, scheduled), run side by side.
// A job that throws is a log line named after it, never the cron's failure,
// and never stops the others (4.0 review L7: pollBatches had no catch).
// Returns the names of the jobs that failed.
export async function cronJobs(jobs: Record<string, (() => Promise<unknown>) | null>): Promise<string[]> {
  const failed: string[] = [];
  await Promise.all(
    Object.entries(jobs).map(([name, run]) =>
      run
        ? run().catch((err: unknown) => {
            console.error(name, err);
            failed.push(name);
          })
        : null,
    ),
  );
  return failed;
}

// 4.5.1 (audit, risk 2): attempts of a paid job, per job and day. A job whose
// answer stores nothing (a design answered "none", a night of tries that all
// land on existing items) used to be due again at the next run, every ten
// minutes, each run a paid call. `noteRun` is written before the call, so a
// run that throws counts too.
export async function noteRun(db: D1Database, job: string, day: string, now = Date.now()): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO job_runs (job, day, runs, last_at) VALUES (?, ?, 1, ?)
       ON CONFLICT (job, day) DO UPDATE SET runs = runs + 1, last_at = excluded.last_at
       RETURNING runs`,
    )
    .bind(job, day, now)
    .first<{ runs: number }>();
  // Fails closed (4.5.1, N4): no count back means no turn, never an open gate.
  if (!row) throw new Error(`job_runs: no count for ${job} on ${day}`);
  return row.runs;
}

export async function runsOn(db: D1Database, job: string, day: string): Promise<number> {
  const row = await db.prepare("SELECT runs FROM job_runs WHERE job = ? AND day = ?").bind(job, day).first<{ runs: number }>();
  return row?.runs ?? 0;
}

export async function lastRunAt(db: D1Database, job: string): Promise<number | null> {
  const row = await db.prepare("SELECT MAX(last_at) AS at FROM job_runs WHERE job = ?").bind(job).first<{ at: number | null }>();
  return row?.at ?? null;
}

// A paid job's turn (4.5.1): counted first, then allowed only while the
// count, as the increment itself answers it, is within `max` a day. Two runs
// that overlap cannot both take the last turn.
export async function takeRun(db: D1Database, job: string, day: string, max: number, now = Date.now()): Promise<boolean> {
  return (await noteRun(db, job, day, now)) <= max;
}

// D1 counts every row a statement scans as a row read, and the free plan allows
// 5,000,000 a day for the whole account. A job that looks for work in a table
// it must scan (the programs that failed their test run, the artifacts nobody
// has sorted) paid the table's size at each of the 144 runs a day, though the
// work it looks for turns up a few times a day at most. `scanDue` lets such a
// job scan once in `everyMs`: it answers from one row of `job_runs` (the last
// scan, by the job's own name) and notes this scan before it is made, so a
// scan that finds nothing, or throws, is not repeated at the next run.
export async function scanDue(db: D1Database, job: string, everyMs: number, now = Date.now()): Promise<boolean> {
  const row = await db.prepare("SELECT last_at FROM job_runs WHERE job = ? ORDER BY day DESC LIMIT 1").bind(job).first<{ last_at: number }>();
  if (row && now - row.last_at < everyMs) return false;
  await noteRun(db, job, new Date(now).toISOString().slice(0, 10), now);
  return true;
}
