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
  return row?.runs ?? 1;
}

export async function runsOn(db: D1Database, job: string, day: string): Promise<number> {
  const row = await db.prepare("SELECT runs FROM job_runs WHERE job = ? AND day = ?").bind(job, day).first<{ runs: number }>();
  return row?.runs ?? 0;
}

export async function lastRunAt(db: D1Database, job: string): Promise<number | null> {
  const row = await db.prepare("SELECT MAX(last_at) AS at FROM job_runs WHERE job = ?").bind(job).first<{ at: number | null }>();
  return row?.at ?? null;
}
