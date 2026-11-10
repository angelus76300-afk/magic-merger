// The cron's D1 reads (scripts/cron-reads.mjs): each job's rows read per run
// stays small once its day's work is done, and a look for work costs what it
// found, not the size of the table. Cloudflare's free plan stops every D1
// request at 5,000,000 rows read a day; on 8 November the live database read
// 3.42 million, almost all of it by the cron's 144 runs.
//
//   npm run test:worker
import { measure, openDb, bundle, RUNS_A_DAY } from "./cron-reads.mjs";
import { pathToFileURL } from "node:url";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};
const log = console.error;

const N = 1500;
for (const [label, quiet] of [
  ["a program failed its test run", false],
  ["no program failed", true],
]) {
  const jobs = await measure({ elements: N, quiet });
  const day = Object.values(jobs).reduce((sum, r) => sum + (r ? r.first + r.later * (RUNS_A_DAY - 1) : 0), 0);
  console.log(`# ${N} items, ${label}: ${day} rows read a day`);
  for (const [name, r] of Object.entries(jobs)) {
    if (!r) continue;
    // After the first run, nothing a job does at each run may scan a table.
    check(`${label}: ${name} reads under 60 rows per run after the first`, r.later < 60, `${r.later}`);
  }
  check(`${label}: the whole cron reads under 150,000 rows a day`, day < 150_000, `${day}`);
  check(
    `${label}: the evidence job's one look costs under ${quiet ? "6,000" : "100,000"} rows`,
    jobs["rewrite by evidence"].first < (quiet ? 6_000 : 100_000),
    `${jobs["rewrite by evidence"].first}`,
  );
}

// Staging runs the same cron against a copy of the library.
const staging = await measure({ elements: N, environment: "staging" });
for (const [name, r] of Object.entries(staging)) if (r) check(`staging: ${name} reads under 60 rows per run`, r.later < 60, `${r.later}`);

// A scan that is not due is not made, and one that is due is: not starved.
{
  const db = await openDb();
  try {
    const { scanDue } = await import(pathToFileURL(await bundle("worker/cron.ts")).href);
    {
      const t = Date.UTC(2026, 10, 10, 12);
      const six = 6 * 3600_000;
      check("scanDue: the first scan is due", (await scanDue(db.env.DB, "t", six, t)) === true);
      check("scanDue: a second scan an hour later is not", (await scanDue(db.env.DB, "t", six, t + 3600_000)) === false);
      check("scanDue: one six hours later is, even across midnight", (await scanDue(db.env.DB, "t", six, t + six + 1)) === true);
      check("scanDue: and a day later", (await scanDue(db.env.DB, "t", six, t + 86400_000 * 2)) === true);
    }
  } finally {
    await db.dispose();
  }
}
console.error = log;
if (failed) {
  console.log(`${failed} checks failed`);
  process.exit(1);
}
console.log("all checks passed");
process.exit(0);
