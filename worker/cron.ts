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
