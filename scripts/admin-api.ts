// The game's admin API, for the runners in scripts/ that talk to a deployed
// Worker with MM_URL and MM_TOKEN (4.1, review L4: the helper was written four
// times, one of them with retries). A 5xx is tried again after 3 s, up to
// `retries` times; anything else, or a body that is not JSON, throws with the
// Worker's error.
//
// 26 November 2026: the runners passed D1's 5,000,000 rows read a day, and the
// whole game failed until midnight UTC. Each admin response says what it read
// (x-rows-read, worker/meter.ts); the total of the run is kept and printed when
// the process ends. The run stops, with exit code 3 and no retry, when the
// Worker refuses a bulk route for the day's reads (429, code "reads"), or when
// its own total passes MM_READS_MAX (optional, rows).
export const READS_EXIT_CODE = 3;

export const runReads = { rows: 0, requests: 0 };
let printing = false;

function stopForReads(why: string): never {
  console.error(`Stopped for D1's reads: ${why}. Nothing is retried; run again after 00:00 UTC or with a higher MM_READS_MAX.`);
  process.exit(READS_EXIT_CODE);
}

export function adminApi(url: string, token: string, { retries = 0 } = {}) {
  const max = Number(process.env.MM_READS_MAX) || 0;
  if (!printing) {
    printing = true;
    process.on("exit", () => {
      if (runReads.requests) console.error(`D1 rows read by this run: ${runReads.rows} in ${runReads.requests} admin requests`);
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON from the Worker, each runner reads it field by field
  return async function api<T = any>(path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      if (max > 0 && runReads.rows >= max) stopForReads(`this run read ${runReads.rows} rows, MM_READS_MAX is ${max}`);
      const res = await fetch(new URL(path, url), {
        method: body ? "POST" : "GET",
        headers: { "content-type": "application/json", "x-access-token": token },
        body: body ? JSON.stringify(body) : undefined,
      });
      runReads.rows += Number(res.headers.get("x-rows-read")) || 0;
      runReads.requests++;
      const data = (await res.json().catch(() => null)) as (T & { error?: string; code?: string; rowsRead?: number; limit?: number }) | null;
      if (res.status === 429 && data?.code === "reads") stopForReads(`${path} was refused, ${data.rowsRead} of ${data.limit} rows read today`);
      if (res.ok && data !== null) return data;
      if (attempt >= retries || res.status < 500) throw new Error(`${path}: ${data?.error ?? res.status}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  };
}
