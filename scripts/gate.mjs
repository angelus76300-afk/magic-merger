// 4.5.2: what may merge and what may deploy (docs/DAILY.md, "Risk classes").
//
//   node scripts/gate.mjs pr <number> [--merge]   is this pull request ready? With --merge, squash it.
//   node scripts/gate.mjs deploy <sha> <deployments.json>   may main at <sha> go to production?
//
// Runs in GitHub Actions with GITHUB_TOKEN and GITHUB_REPOSITORY, from main's
// copy of the repository (the Gate and Deploy workflows), so a pull request
// cannot loosen its own gate. Without branch protection (GitHub Pro, a money
// question for the owner) a session could still merge by hand; the deploy
// check is the lock that holds anyway: production never runs a red or amber
// change that has no recorded OK from the owner.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { classify, readGit } from "./risk.mjs";

const ORDER = { green: 0, amber: 1, red: 2 };
export const LABELS = { amber: "owner-ok", red: "owner-yes", hold: "hold", pause: "pause" };
// A marker counts only at the start of a line, never quoted inside prose.
const REVIEW = /^<!--\s*mm-review\s+verdict=(pass|block)\s+sha=([0-9a-f]{7,40})(?:\s+raise=(amber|red))?\s*-->/gm;
// The record the planner writes next to the owner's label: who said what, when.
const OWNER = /^<!--\s*mm-owner\s+(ok|yes)\s*-->/m;

/**
 * The review of this exact head commit. A block or a raised class sticks: a later
 * comment on the same commit cannot clear it (a builder cannot lower its own class).
 */
export function reviewFor(comments, sha) {
  let found = null;
  for (const c of comments) {
    for (const m of (c.body ?? "").matchAll(REVIEW)) {
      if (!sha.startsWith(m[2])) continue;
      const raise = [found?.raise, m[3]].filter(Boolean).sort((a, b) => ORDER[b] - ORDER[a])[0] ?? null;
      found = { verdict: found?.verdict === "block" ? "block" : m[1], raise, at: c.created_at, url: c.html_url };
    }
  }
  return found;
}

/** The owner's recorded words for a label: "ok" or "yes" comments written by the planner. */
export function ownerRecords(comments) {
  const out = new Set();
  for (const c of comments) {
    const m = OWNER.exec(c.body ?? "");
    if (m) out.add(m[1]);
  }
  return out;
}

/**
 * Pure decision for one pull request.
 * s: { cls, labels, records, draft, paused, ci, smoke, review, mergeable, workflows, docsOnly }
 *   ci: "full" (lint to test:worker passed), "docs" (docs only, light checks passed), or anything else
 *   smoke: "pass" | other; review: reviewFor(...) result
 */
export function decide(s) {
  const reasons = [];
  let cls = s.cls;
  if (s.review?.raise && ORDER[s.review.raise] > ORDER[cls]) cls = s.review.raise;
  if (s.paused) reasons.push("paused by the owner (an open issue labelled pause)");
  if (s.labels.includes(LABELS.hold)) reasons.push("labelled hold");
  if (s.draft) reasons.push("still a draft");
  if (!(s.ci === "full" || (s.ci === "docs" && s.docsOnly))) reasons.push(`CI not passed in full on the head commit (${s.ci})`);
  if (s.smoke !== "pass" && !s.docsOnly) reasons.push(`preview smoke test not passed (${s.smoke})`);
  if (!s.review) reasons.push("no independent review of the head commit");
  else if (s.review.verdict !== "pass") reasons.push("the review blocks it");
  const records = s.records ?? new Set();
  const yes = s.labels.includes(LABELS.red) && records.has("yes");
  const ok = yes || (s.labels.includes(LABELS.amber) && records.has("ok"));
  if (cls === "amber" && !ok) reasons.push("amber: waits for the owner's OK in the morning brief (label owner-ok and the planner's mm-owner record)");
  if (cls === "red" && !yes) reasons.push("red: waits for the owner's explicit yes (label owner-yes and the planner's mm-owner record)");
  if (s.mergeable === false) reasons.push("conflicts with main");
  if (s.workflows) reasons.push("changes .github/workflows: the Gate's token cannot merge it; the planner merges it by hand after the owner's yes");
  return { cls, ready: reasons.length === 0, reasons };
}

/** Pure decision for a deploy: every change since the last deploy has the OK its class needs. */
export function deployable({ paused, commits }) {
  const okFor = (c) => (c.labels.includes(LABELS.amber) && c.records?.has("ok")) || (c.labels.includes(LABELS.red) && c.records?.has("yes"));
  const yesFor = (c) => c.labels.includes(LABELS.red) && c.records?.has("yes");
  const reasons = [];
  if (paused) reasons.push("paused by the owner (an open issue labelled pause)");
  for (const c of commits) {
    if (!c.pr) reasons.push(`${c.sha.slice(0, 7)} reached main without a pull request`);
    else if (c.cls === "red" && !yesFor(c)) reasons.push(`#${c.pr} is red and was merged without the owner's recorded yes`);
    else if (c.cls === "amber" && !okFor(c)) reasons.push(`#${c.pr} is amber and was merged without the owner's recorded OK`);
  }
  return { ok: reasons.length === 0, reasons };
}

// --- GitHub ---

const REPO = process.env.GITHUB_REPOSITORY ?? "angelus76300-afk/magic-merger";
async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com${path.startsWith("/") ? path : `/repos/${REPO}/${path}`}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok && res.status !== 404) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 || res.status === 404 ? null : res.json();
}
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim();

async function paused() {
  const open = await gh(`issues?state=open&labels=${LABELS.pause}&per_page=1`);
  return (open ?? []).length > 0;
}

const DOCS_ONLY = (path) => /^(docs\/|\.claude\/skills\/)|\.md$|^public\/changelog\.json$/.test(path);

/** CI on a commit: "full" when the check job ran every step, "docs" when it ran the light ones on a docs only change. */
async function ciOn(sha) {
  const runs = (await gh(`actions/runs?head_sha=${sha}&per_page=50`))?.workflow_runs ?? [];
  const ci = runs.filter((r) => r.name === "CI").sort((a, b) => b.run_number - a.run_number)[0];
  if (!ci) return "missing";
  if (ci.status !== "completed") return ci.status;
  if (ci.conclusion !== "success") return ci.conclusion;
  const jobs = (await gh(`actions/runs/${ci.id}/jobs`))?.jobs ?? [];
  const check = jobs.find((j) => j.name === "check");
  const test = check?.steps?.find((st) => st.name === "npm test");
  return test?.conclusion === "success" ? "full" : "docs";
}

/** The preview smoke test of a commit: the newest Preview run whose smoke job ran (a run for a label skips it). */
async function smokeOn(sha) {
  const runs = ((await gh(`actions/runs?head_sha=${sha}&per_page=50`))?.workflow_runs ?? [])
    .filter((r) => r.name === "Preview")
    .sort((a, b) => b.run_number - a.run_number);
  for (const run of runs) {
    if (run.status !== "completed") return run.status;
    const jobs = (await gh(`actions/runs/${run.id}/jobs`))?.jobs ?? [];
    const smoke = jobs.find((j) => j.name === "smoke");
    if (smoke && smoke.conclusion !== "skipped") return smoke.conclusion === "success" ? "pass" : smoke.conclusion;
  }
  return "missing";
}

async function allComments(n) {
  const comments = [];
  for (let page = 1; page < 10; page++) {
    const batch = await gh(`issues/${n}/comments?per_page=100&page=${page}`);
    comments.push(...(batch ?? []));
    if (!batch || batch.length < 100) break;
  }
  return comments;
}

export async function prState(n) {
  const pr = await gh(`pulls/${n}`);
  const sha = pr.head.sha;
  git("fetch", "--quiet", "origin", `+refs/pull/${n}/head:refs/remotes/pr/${n}`, `+refs/heads/${pr.base.ref}:refs/remotes/origin/${pr.base.ref}`);
  const files = readGit(`origin/${pr.base.ref}`, `pr/${n}`);
  const { cls, hits } = classify(files, { branch: pr.head.ref, title: pr.title });
  const comments = await allComments(n);
  return {
    pr,
    hits,
    state: {
      open: pr.state === "open" && !pr.merged,
      cls,
      labels: pr.labels.map((l) => l.name),
      records: ownerRecords(comments),
      draft: pr.draft,
      paused: await paused(),
      ci: await ciOn(sha),
      smoke: await smokeOn(sha),
      review: reviewFor(comments, sha),
      mergeable: pr.mergeable,
      workflows: files.some((f) => f.path.startsWith(".github/workflows/")),
      docsOnly: files.every((f) => DOCS_ONLY(f.path)),
    },
  };
}

/**
 * The commit of the newest production deploy this workflow made, read from Cloudflare's own
 * record (wrangler deployments list --json, saved to a file): each one carries the message
 * "main <sha7> ...". GitHub's deployment records are not relied on (environments in a private
 * repository on the free plan may not keep them).
 */
export function lastDeployedFrom(deployments) {
  for (const d of [...deployments].reverse()) {
    const m = /^main ([0-9a-f]{7,40})\b/.exec(d?.annotations?.["workers/message"] ?? "");
    if (m) return m[1];
  }
  return null;
}

export async function deployState(sha, deploymentsFile) {
  git("fetch", "--quiet", "origin", "main");
  let last = null;
  if (deploymentsFile) {
    const short = lastDeployedFrom(JSON.parse(readFileSync(deploymentsFile, "utf8")));
    try {
      last = short ? git("rev-parse", "--verify", `${short}^{commit}`) : null;
    } catch {
      last = null;
    }
  }
  let shas = [sha];
  if (last) {
    try {
      git("merge-base", "--is-ancestor", last, sha);
      shas = git("rev-list", "--first-parent", `${last}..${sha}`).split("\n").filter(Boolean);
    } catch {
      shas = [sha]; // the last deploy is not under this commit (a rollback, a history rewrite): judge this commit alone
    }
  }
  const commits = [];
  for (const c of shas) {
    const prs = ((await gh(`commits/${c}/pulls`)) ?? []).filter((p) => p.merged_at && p.base.ref === "main");
    const pr = prs[0];
    let cls = "green";
    let records = new Set();
    if (pr) {
      const parent = git("rev-parse", `${c}^`);
      cls = classify(readGit(parent, c), { branch: pr.head.ref, title: pr.title }).cls;
      records = ownerRecords(await allComments(pr.number));
    }
    commits.push({ sha: c, pr: pr?.number ?? null, cls, labels: pr ? pr.labels.map((l) => l.name) : [], records });
  }
  return { last, commits, paused: await paused() };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [cmd, arg] = process.argv.slice(2);
  const summary = (text) => {
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY) execFileSync("sh", ["-c", `cat >> "$GITHUB_STEP_SUMMARY"`], { input: text + "\n" });
  };
  if (cmd === "pr") {
    const { pr, state, hits } = await prState(Number(arg));
    if (!state.open) {
      summary(`#${arg} is not open: nothing to do.`);
      process.exit(0);
    }
    const d = decide(state);
    summary(
      [
        `### Gate for #${arg}: ${d.ready ? "ready" : "waiting"} (${d.cls})`,
        ...hits.map((h) => `- ${h.rule} ${h.cls}${h.file ? ` ${h.file}` : ""}`),
        ...d.reasons.map((r) => `- waiting: ${r}`),
        `CI ${state.ci}, smoke ${state.smoke}, review ${state.review?.verdict ?? "none"}, labels ${state.labels.join(", ") || "none"}`,
      ].join("\n"),
    );
    if (d.ready && process.argv.includes("--merge")) {
      await gh(`pulls/${arg}/merge`, {
        method: "PUT",
        body: JSON.stringify({ merge_method: "squash", sha: pr.head.sha, commit_title: `${pr.title} (#${arg})` }),
      });
      summary(`Merged #${arg} (${d.cls}).`);
      console.log("merged=true");
      if (process.env.GITHUB_OUTPUT) execFileSync("sh", ["-c", `echo merged=true >> "$GITHUB_OUTPUT"`]);
    }
  } else if (cmd === "deploy") {
    const s = await deployState(arg, process.argv[4]);
    const d = deployable(s);
    summary(
      [
        `### May ${arg.slice(0, 7)} deploy? ${d.ok ? "yes" : "no"}`,
        `Last production deploy from this workflow: ${s.last ? s.last.slice(0, 7) : "none yet"}`,
        ...s.commits.map(
          (c) => `- ${c.sha.slice(0, 7)} ${c.pr ? `#${c.pr}` : "no pull request"} ${c.cls}${c.labels.length ? ` (${c.labels.join(", ")})` : ""}`,
        ),
        ...d.reasons.map((r) => `- refused: ${r}`),
      ].join("\n"),
    );
    process.exit(d.ok ? 0 : 1);
  } else {
    console.error("usage: node scripts/gate.mjs pr <n> [--merge] | deploy <sha> [deployments.json]");
    process.exit(2);
  }
}
