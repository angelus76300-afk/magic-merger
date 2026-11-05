// 4.5.2: how much the owner still drives (docs/LOOP.md has the definitions and the baseline).
//
//   GITHUB_TOKEN=... node scripts/loop-metrics.mjs [--days 7] [--owner-messages n]
//
// From GitHub alone: pull requests merged in the window, the share that needed
// no action from the owner (no owner-ok, owner-yes or owner-action label), red
// merged without a yes (a failure of 4.5.2), rollbacks (issues labelled
// rollback), and who found each bug fixed (a "Found by: owner" or "Found by:
// ai" line in the pull request's body). The owner's minutes are estimated:
// 1 per OK, 3 per yes, 2 per other action, plus 1 per message the planner
// counted in the sessions (--owner-messages), which only it can read.
const REPO = process.env.GITHUB_REPOSITORY ?? "angelus76300-afk/magic-merger";
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const DAYS = Number(arg("days", 7));
// Labels and "Found by" lines exist from 4.5.2 on: earlier pull requests would read as needing nothing.
const START = new Date("2026-11-05T12:00:00Z");
const since = new Date(Math.max(Date.now() - DAYS * 86400_000, START.getTime()));
async function gh(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

const merged = [];
for (let page = 1; page < 10; page++) {
  const batch = await gh(`pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`);
  merged.push(...batch.filter((p) => p.merged_at && new Date(p.merged_at) >= since));
  if (batch.length < 100 || new Date(batch[batch.length - 1].updated_at) < since) break;
}
const labels = (p) => p.labels.map((l) => l.name);
const has = (p, l) => labels(p).includes(l);
const ok = merged.filter((p) => has(p, "owner-ok")).length;
const yes = merged.filter((p) => has(p, "owner-yes")).length;
const other = merged.filter((p) => has(p, "owner-action")).length;
const untouched = merged.filter((p) => !["owner-ok", "owner-yes", "owner-action"].some((l) => has(p, l))).length;
const foundBy = (who) => merged.filter((p) => new RegExp(`^\\s*Found by:\\s*${who}\\b`, "im").test(p.body ?? "")).length;
const issues = await gh(`issues?state=all&labels=rollback&since=${since.toISOString()}&per_page=100`);
const rollbacks = issues.filter((i) => !i.pull_request && new Date(i.created_at) >= since);
// GitHub Actions minutes this calendar month (2,000 free for a private repository): every
// completed run's wall time, rounded up per run, an estimate of the billed minutes.
const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
let actionsMinutes = 0;
for (let page = 1; page < 20; page++) {
  const batch = (await gh(`actions/runs?created=>=${monthStart.toISOString().slice(0, 10)}&per_page=100&page=${page}`)).workflow_runs ?? [];
  for (const r of batch)
    if (r.status === "completed" && r.conclusion !== "skipped") actionsMinutes += Math.ceil((new Date(r.updated_at) - new Date(r.run_started_at)) / 60_000);
  if (batch.length < 100) break;
}
const messages = Number(arg("owner-messages", 0));
const minutes = ok * 1 + yes * 3 + other * 2 + messages;

const lines = [
  `| ${since.toISOString().slice(0, 10)} to ${new Date().toISOString().slice(0, 10)} | value |`,
  "|---|---|",
  `| pull requests merged | ${merged.length} |`,
  `| needed no action from the owner | ${untouched} (${merged.length ? Math.round((100 * untouched) / merged.length) : 0}%) |`,
  `| owner OKs (amber) / yeses (red) / other actions | ${ok} / ${yes} / ${other} |`,
  `| owner's minutes, estimated | ${minutes} |`,
  `| deploys refused or rolled back | ${rollbacks.length}${rollbacks.length ? ": " + rollbacks.map((i) => `#${i.number}`).join(", ") : ""} |`,
  `| bugs found first by the owner / by the AI | ${foundBy("owner")} / ${foundBy("ai")} |`,
  `| GitHub Actions minutes this month, estimated | ${actionsMinutes} of 2,000 |`,
];
console.log(lines.join("\n"));
