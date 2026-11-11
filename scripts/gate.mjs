// 4.5.2: what may merge and what may deploy (docs/DAILY.md, "Risk classes").
//
//   node scripts/gate.mjs pr <number> [--merge]   is this pull request ready? With --merge, squash it.
//   node scripts/gate.mjs sweep [--merge] [--update]   every open pull request (the merge queue, the Gate's one job;
//                                                      --update starts CI again on one that CI tested with an older main).
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
// tests=pass|fail: the reviewer ran npm test in its session. Read and kept (a fail sticks), but since
// 2026-11-11 CI runs npm test on the merge result, and the Gate asks the reviewer for it no longer.
// Its fields may come in any order: verdict and sha are needed, raise and tests are optional.
const REVIEW = /^<!--\s*mm-review\s+((?:[a-z]+=[0-9a-z]+\s*)+)-->/gm;
const reviewFields = (text) => {
  const pairs = [...text.matchAll(/([a-z]+)=([0-9a-z]+)/g)].map((m) => [m[1], m[2]]);
  // A field written twice is a malformed marker (tests=fail tests=pass must not read as a pass).
  if (new Set(pairs.map(([k]) => k)).size !== pairs.length) return null;
  const f = Object.fromEntries(pairs);
  const ok = /^(pass|block)$/.test(f.verdict ?? "") && /^[0-9a-f]{7,40}$/.test(f.sha ?? "");
  const raise = /^(amber|red)$/.test(f.raise ?? "") ? f.raise : null;
  const tests = /^(pass|fail)$/.test(f.tests ?? "") ? f.tests : null;
  // An unknown value in a known field is a malformed marker, not a missing one: it does not count.
  const bad = (f.raise && !raise) || (f.tests && !tests);
  return ok && !bad ? [null, f.verdict, f.sha, raise, tests] : null;
};
// The record the planner writes next to the owner's label: who said what, when.
const OWNER = /^<!--\s*mm-owner\s+(ok|yes)\s*-->/m;

const REPO = process.env.GITHUB_REPOSITORY ?? "angelus76300-afk/magic-merger";
/** The account that owns the repository: every session, the reviewer and the planner write as it. */
export const REPO_OWNER = REPO.split("/")[0];

/**
 * Whether a comment was written by the repository owner's own account (2026-11-06: the repository
 * is public, so anyone with a GitHub account can comment). Both must agree: the login, and GitHub's
 * own author_association. A marker in anyone else's comment is text, never a verdict or a record.
 */
export function byOwner(c, owner) {
  const login = c?.user?.login;
  return (
    typeof owner === "string" && owner !== "" && typeof login === "string" && login.toLowerCase() === owner.toLowerCase() && c.author_association === "OWNER"
  );
}

/**
 * The review of this exact head commit. A block or a raised class sticks: a later
 * comment on the same commit cannot clear it (a builder cannot lower its own class).
 */
export function reviewFor(comments, sha, owner) {
  let found = null;
  for (const c of comments) {
    if (!byOwner(c, owner)) continue;
    for (const match of (c.body ?? "").matchAll(REVIEW)) {
      const m = reviewFields(match[1]);
      if (!m || !sha.startsWith(m[2])) continue;
      const raise = [found?.raise, m[3]].filter(Boolean).sort((a, b) => ORDER[b] - ORDER[a])[0] ?? null;
      // A failed run sticks like a block: a later comment cannot turn it into a pass.
      const tests = found?.tests === "fail" || m[4] === "fail" ? "fail" : (m[4] ?? found?.tests ?? null);
      found = { verdict: found?.verdict === "block" ? "block" : m[1], raise, tests, at: c.created_at, url: c.html_url };
    }
  }
  return found;
}

// The lines a text diff adds and removes, without positions, sorted: the same lines moved by a hunk
// that git placed differently compare equal. null for anything that is not a plain text change
// (a binary file, a mode change, a rename, a deleted or a new file), which carries nothing.
function changedLines(out) {
  const add = [];
  const del = [];
  let inHunk = false;
  for (const line of out.split("\n")) {
    // Headers come before a file's first hunk; inside a hunk, "--- x" is a removed line "-- x".
    if (line.startsWith("diff --git ")) inHunk = false;
    else if (line.startsWith("@@")) inHunk = true;
    else if (!inHunk) {
      if (/^(Binary files |GIT binary patch|old mode |new mode |deleted file |new file |rename |copy |similarity )/.test(line)) return null;
    } else if (line.startsWith("+")) add.push(line.slice(1).trimEnd());
    else if (line.startsWith("-")) del.push(line.slice(1).trimEnd());
    else if (line && !line.startsWith("\\")) return null;
  }
  return JSON.stringify([add.sort(), del.sort()]);
}

/**
 * One merge (first + second = merged) and one shared file the pull request changed. Null when the merge
 * changed the file only with main's own lines: what it added and removed there is exactly what main
 * added and removed since the merge base, and the pull request's own lines there are unchanged. Else
 * what is wrong, in words.
 */
export function sharedChangeFromMain(git, first, second, merged, file) {
  const diff = (a, b) => changedLines(git("diff", "-U0", "--no-renames", "--no-ext-diff", "--no-textconv", a, b, "--", file));
  const mb = git("merge-base", first, second);
  const fromMain = diff(mb, second);
  const byMerge = diff(first, merged);
  const ownBefore = diff(mb, first);
  const ownAfter = diff(second, merged);
  if ([fromMain, byMerge, ownBefore, ownAfter].includes(null)) return "is not a plain text change";
  if (byMerge !== fromMain) return "brings lines that did not come from main";
  if (ownAfter !== ownBefore) return "changes the pull request's own lines";
  // union stacks lines: two entries of several lines can interleave into JSON that no longer parses.
  // The line checks above refuse every such case seen so far; this is a second lock behind them.
  if (file.endsWith(".json")) {
    try {
      JSON.parse(git("show", `${merged}:${file}`));
    } catch {
      return "leaves JSON that does not parse";
    }
  }
  return null;
}

/**
 * 2026-11-07, the lighter process: a review carried across merges of main. When the head has no
 * review of its own, walk its first-parent line back to the newest reviewed commit R. Every commit
 * on the way must be a clean merge of main: exactly two parents, the second already on main, its
 * tree exactly what git merges without help (no conflict, no hand edit), and changing none of the
 * pull request's own files (the files R changed from its base). The class of the new head must not
 * be above R's. Then R's review stands for the head, its tests=pass included; the night's npm test
 * on main is the backstop. Anything the Gate cannot prove (a missing commit, a git error) carries
 * nothing: it waits as before.
 * 2026-11-08: almost every pull request adds lines to docs/IDEAS.md and public/changelog.json, so a
 * merge of main nearly always touched them and sent the pull request back for a review. A merge may
 * now change those two files (SHARED) when the lines it adds and removes there are exactly the lines
 * main added and removed since the merge base, and the pull request's own lines there are the same
 * before and after the merge (sharedChangeFromMain). Every other file of the pull request still may
 * not change. .gitattributes merges the changelog with union, so two entries added at its top merge
 * without a conflict; git's own merge in the tree check reads main's .gitattributes too. Lines are
 * compared without their place: where a line sits may move, which the class check covers for the
 * one place that matters (IDEAS.md "Declined", R12).
 * 2026-11-10, the owner's review-carry rule with the merge queue: the same holds for every file of the
 * pull request. A catch-up merge may change one of its files when git merged it on its own (the tree
 * check), the lines it brought there are exactly main's own lines since the merge base, and the pull
 * request's own lines there are unchanged (sharedChangeFromMain). Where a line sits comes from git's
 * merge, never from a hand. CI runs on the new head (lint, types, build, the Worker's tests) before the
 * Gate merges it, and the night's npm test on main stays the backstop.
 *   git: (...args) => stdout, throwing on a non-zero exit; classOf: (base, sha) => "green" | "amber" | "red"
 * Returns { review, from, why }: review null with why when nothing is carried.
 */
export function carriedReview({ head, base, comments, owner, git, classOf, limit = 20 }) {
  const no = (why) => ({ review: null, from: null, why });
  try {
    const own = reviewFor(comments, head, owner);
    if (own) return { review: own, from: null, why: null };
    const merges = [];
    let c = head;
    let found = null;
    for (let i = 0; i <= limit; i++) {
      if (c !== head) {
        const r = reviewFor(comments, c, owner);
        if (r) {
          found = { sha: c, review: r };
          break;
        }
      }
      const parents = git("rev-list", "--parents", "-n", "1", c).split(/\s+/).slice(1);
      if (parents.length !== 2) return no(`${c.slice(0, 7)} is not a merge of main: a new review is needed`);
      merges.push({ sha: c, parents });
      c = parents[0];
    }
    if (!found) return no("no reviewed commit within reach of the head");
    if (found.review.verdict !== "pass") return no(`the review of ${found.sha.slice(0, 7)} did not pass`);
    const ownFiles = new Set(
      git("diff", "--name-only", "--no-renames", git("merge-base", base, found.sha), found.sha)
        .split("\n")
        .filter(Boolean),
    );
    for (const m of merges) {
      const [first, second] = m.parents;
      const short = m.sha.slice(0, 7);
      try {
        git("merge-base", "--is-ancestor", second, base);
      } catch {
        return no(`${short} merges a commit that is not on main`);
      }
      let tree;
      try {
        tree = git("merge-tree", "--write-tree", "--no-messages", first, second).split("\n")[0].trim();
      } catch {
        return no(`${short} needed a conflict resolved: a new review is needed`);
      }
      if (tree !== git("rev-parse", `${m.sha}^{tree}`))
        return no(`${short} is not a clean merge (its tree differs from git's own merge): a new review is needed`);
      const touched = git("diff", "--name-only", "--no-renames", first, m.sha).split("\n").filter(Boolean);
      // 2026-11-10: any of the pull request's own files, not only the two shared ones, when the merge
      // brought there nothing but main's own lines and left the pull request's lines as reviewed.
      for (const f of touched.filter((t) => ownFiles.has(t))) {
        const bad = sharedChangeFromMain(git, first, second, m.sha, f);
        if (bad) return no(`${short} ${bad} in ${f}, one of the pull request's own files: a new review is needed`);
      }
    }
    const before = classOf(base, found.sha);
    const after = classOf(base, head);
    if (!(after in ORDER) || !(before in ORDER)) return no("the class could not be computed");
    if (ORDER[after] > ORDER[before]) return no(`the merged code raised the class from ${before} to ${after}: a new review is needed`);
    return { review: { ...found.review, carried: found.sha }, from: found.sha, why: null };
  } catch (e) {
    return no(
      `could not check the merges (${String(e?.message ?? e)
        .split("\n")[0]
        .slice(0, 120)})`,
    );
  }
}

/** The owner's recorded words for a label: "ok" or "yes" comments written by the planner, as the owner's account. */
export function ownerRecords(comments, owner) {
  const out = new Set();
  for (const c of comments) {
    if (!byOwner(c, owner)) continue;
    const m = OWNER.exec(c.body ?? "");
    if (m) out.add(m[1]);
  }
  return out;
}

/**
 * Pure decision for one pull request.
 * s: { cls, labels, records, draft, paused, fork, headFetched, ci, smoke, review, mergeable, upToDate, workflows, docsOnly }
 *   fork: false only when the head branch lives in this repository; anything else is refused
 *   ci: "full" (lint to test:worker passed), "docs" (docs only, light checks passed), or anything else
 *   smoke: "pass" | other; review: reviewFor(...) result
 */
export function decide(s) {
  const reasons = [];
  let cls = s.cls;
  if (s.review?.raise && ORDER[s.review.raise] > ORDER[cls]) cls = s.review.raise;
  if (s.paused) reasons.push("paused by the owner (an open issue labelled pause)");
  // Fail closed: a fork, or a head repository GitHub no longer names (a deleted fork), never merges here.
  if (s.fork !== false) reasons.push("its head branch is not in this repository (a fork): the Gate never merges it");
  if (s.headFetched === false) reasons.push("the head commit could not be fetched yet: nothing is judged on an older diff");
  if (s.labels.includes(LABELS.hold)) reasons.push("labelled hold");
  if (s.draft) reasons.push("still a draft");
  if (!(s.ci === "full" || (s.ci === "docs" && s.docsOnly))) reasons.push(`CI not passed in full on the head commit (${s.ci})`);
  if (s.smoke !== "pass" && !s.docsOnly) reasons.push(`preview smoke test not passed (${s.smoke})`);
  if (!s.review) reasons.push(`no independent review of the head commit${s.carry ? ` (an earlier review was not carried: ${s.carry})` : ""}`);
  else if (s.review.verdict !== "pass") reasons.push("the review blocks it");
  // A reviewer's tests=fail still holds it: the reviewer saw npm test fail on this commit.
  if (s.review?.tests === "fail") reasons.push("the reviewer reported npm test failing on the head commit");
  const records = s.records ?? new Set();
  const yes = s.labels.includes(LABELS.red) && records.has("yes");
  const ok = yes || (s.labels.includes(LABELS.amber) && records.has("ok"));
  if (cls === "amber" && !ok) reasons.push("amber: waits for the owner's OK in the morning brief (label owner-ok and the planner's mm-owner record)");
  if (cls === "red" && !yes) reasons.push("red: waits for the owner's explicit yes (label owner-yes and the planner's mm-owner record)");
  if (s.mergeable === false) reasons.push("conflicts with main");
  // 2026-11-11: CI runs npm test on the head merged with main. upToDate: that main is the main of now
  // (or main moved since only by docs), so two pull requests tested apart never deploy together untested.
  // The branch itself need not contain main: the Gate starts CI again (retest), it pushes nothing.
  if (s.upToDate === false && !s.docsOnly) reasons.push("CI tested it with an older main: the Gate starts CI again on the main of now (no push to the branch)");
  if (s.workflows) reasons.push("changes .github/workflows: the Gate's token cannot merge it; the planner merges it by hand after the owner's yes");
  return { cls, ready: reasons.length === 0, reasons };
}

// --- The merge queue (2026-11-08; 2026-11-11 without pushes) ---
// A ready pull request whose CI tested an older main waits for a new test. The Gate starts it, one
// pull request at a time, oldest first: CI by workflow_dispatch on main, which merges main into the
// head in the runner and pushes nothing (2026-11-11). The head does not move, so the review and the
// preview of the head stand, and a workflow change on main stops nothing (the Gate's token may not
// push one, and no longer needs to).

const RUNNING = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);

/**
 * Whether the Gate may start CI again on this pull request: everything it waits for is there except a
 * test with the main of now, and GitHub says main merges into it without a conflict.
 */
export function updatable(s) {
  if (s.upToDate !== false || s.mergeable !== true || s.fork !== false || s.draft || s.paused || s.headFetched === false) return false;
  return decide({ ...s, upToDate: true }).ready;
}

/** A pull request that would be ready once its running CI or preview finishes: it may merge soon. */
export function inFlight(s) {
  if (s.draft || s.fork !== false || !(RUNNING.has(s.ci) || RUNNING.has(s.smoke))) return false;
  return decide({ ...s, ci: "full", smoke: "pass", upToDate: true }).ready;
}

/**
 * Which pull request the sweep tests again: the oldest one that is updatable, and none while another is
 * in flight (a second test would only be made stale by the first one's merge).
 * prs: [{ number, state }]. Returns { update: number | null, order, why }.
 */
export function pickUpdate(prs) {
  const flying = prs.filter((p) => inFlight(p.state)).map((p) => p.number);
  const candidates = prs.filter((p) => updatable(p.state)).sort((a, b) => a.number - b.number);
  if (!candidates.length) return { update: null, order: [], why: "no ready pull request waits only for a test with the main of now" };
  if (flying.length) return { update: null, order: [], why: `waiting for #${flying.join(", #")} to finish its checks first` };
  // order: the sweep tries the next one when a dispatch is refused, so one refusal never stops the queue.
  return { update: candidates[0].number, order: candidates.map((p) => p.number), why: null };
}

/** The name a CI run the Gate starts carries (run-name in ci.yml): how the Gate finds it again. */
export const retestName = (number, sha) => `CI for #${number} at ${sha}`;

/**
 * 2026-11-11: start CI on main's copy of ci.yml for this pull request's head (inputs pr and sha), which
 * merges main in, runs everything, npm test included, and pushes nothing. Waits until the run is listed,
 * so the next sweep sees it in flight and starts no second one meanwhile. Returns what happened, in words.
 *   call: (path, init?) => json (throws on an error); sleep: (ms) => promise
 */
export async function bringUpToDate({ number, sha, call, sleep, waitMs = 30000 }) {
  await call(`actions/workflows/ci.yml/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main", inputs: { pr: String(number), sha } }) });
  for (let waited = 0; waited <= waitMs; waited += 3000) {
    if (waited) await sleep(3000);
    const runs = (await call(`actions/workflows/ci.yml/runs?event=workflow_dispatch&per_page=30`))?.workflow_runs ?? [];
    if (runs.some((r) => r.display_title === retestName(number, sha))) break;
  }
  return `started CI on #${number} (${sha.slice(0, 7)}) merged with the main of now; it merges once that passes`;
}

/**
 * Squash one ready pull request, pinned to the head it judged, and start the deploy at once unless it
 * changes only docs (a merge made with the Gate's token starts no push workflow). 2026-11-11, review of
 * #117: a merge in an early round of --follow must not wait for the job's end to deploy.
 *   call: (path, init?) => json (throws on an error). Throws only when the merge is refused; a deploy that
 *   cannot be started is said in the result (the next Deploy run deploys every merge since the last one).
 */
export async function mergeOne({ number, sha, title, docsOnly, call }) {
  await call(`pulls/${number}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "squash", sha, commit_title: `${title} (#${number})` }) });
  if (docsOnly) return "merged (docs only, no deploy)";
  try {
    await call(`actions/workflows/deploy.yml/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main" }) });
  } catch (e) {
    return `merged, but the deploy could not be started (${String(e?.message ?? e).slice(0, 120)})`;
  }
  return "merged, deploy started";
}

/**
 * 2026-11-11, the Gate follows its own retest: wait until the CI run named `name` (retestName) has
 * finished, reading the dispatched runs of ci.yml every 30 s, at most timeoutMs (notFoundMs if it never shows). Returns its conclusion,
 * or "still running" / "not found" when the wait ends without one; the sweep runs again either way.
 *   call: (path) => json; sleep: (ms) => promise
 */
export async function waitForRun({ name, call, sleep, timeoutMs = 30 * 60000, notFoundMs = 3 * 60000, everyMs = 30000 }) {
  let seen = false;
  for (let waited = 0; waited <= timeoutMs; waited += everyMs) {
    if (waited) await sleep(everyMs);
    // A run that never appears is not waited for long (review of #117: keep the rounds under the job timeout).
    if (!seen && waited > notFoundMs) return "not found";
    let runs = [];
    try {
      runs = (await call(`actions/workflows/ci.yml/runs?event=workflow_dispatch&per_page=30`))?.workflow_runs ?? [];
    } catch {
      continue; // a failed read: try again at the next tick
    }
    const run = runs.filter((r) => r.display_title === name).sort((a, b) => b.run_number - a.run_number)[0];
    if (!run) continue;
    seen = true;
    if (run.status === "completed") return run.conclusion ?? "completed";
  }
  return seen ? "still running" : "not found";
}

/**
 * The sweep's test, in turn: the first of `order` (at most three) that GitHub lets the Gate start.
 * A refusal gives the next one its turn now, so one refused pull request never holds the queue.
 * Returns the lines to print.
 *   bring: (number, sha) => promise of what happened, in words; throws when refused
 */
export async function updateInTurn(order, queue, bring) {
  const lines = [];
  for (const n of order.slice(0, 3)) {
    const sha = queue.find((p) => p.number === n)?.sha;
    if (!sha) continue;
    try {
      lines.push(`${await bring(n, sha)}.`);
      break;
    } catch (e) {
      lines.push(`Could not start CI on #${n} (${String(e?.message ?? e).slice(0, 160)}); the next one in line gets its turn.`);
    }
  }
  return lines;
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
// stderr is kept with the error, not printed: a refused fetch is expected and handled.
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();

async function paused() {
  const open = await gh(`issues?state=open&labels=${LABELS.pause}&per_page=1`);
  return (open ?? []).length > 0;
}

// Nothing here runs in the game: docs, the skills, the changelog, the sessions' permission rules.
// (Not the changelog: players read public/changelog.json in the live game.)
/**
 * Whether CI's test still holds for the main of now: it tested with it, or main moved since only by docs
 * (nothing npm test sees changed). moved: the paths main changed since the tested main, null if unknown.
 */
export function upToDateFrom(ancestor, moved) {
  if (ancestor) return true;
  return Array.isArray(moved) && moved.every((p) => DOCS_ONLY(p));
}

const DOCS_ONLY = (path) => /^(docs\/|\.claude\/skills\/)|\.md$|^\.claude\/settings\.json$/.test(path);

/** Whether a workflow run ran at all: not one held for an approval that never came. */
export const ran = (r) => r?.conclusion !== "action_required" && r?.status !== "action_required";

/**
 * CI on a commit: "full" when the check job ran every step, "docs" when it ran the light ones on a docs
 * only change. 2026-11-08: GitHub sometimes lists a finished check job with no steps (#88, #89, #95,
 * all full runs). Missing data is never read as a pass nor as docs: the jobs are fetched again a few
 * times, and if the steps still cannot prove which run it was, the Gate waits (and the sweep retries).
 *   ghGet: (path) => json; sleep: (ms) => promise
 */

export async function ciFrom(sha, ghGet, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), tries = 3, ghText = async () => null, out = {}) {
  const runs = (await ghGet(`actions/runs?head_sha=${sha}&per_page=50`))?.workflow_runs ?? [];
  // 2026-11-11: the Gate's own runs are dispatched on main (head_sha is main's), named after the head.
  const dispatched = ((await ghGet(`actions/workflows/ci.yml/runs?event=workflow_dispatch&per_page=50`))?.workflow_runs ?? []).filter(
    (r) => typeof r.display_title === "string" && /^CI for #\d+ at [0-9a-f]{40}$/.test(r.display_title) && r.display_title.endsWith(` at ${sha}`),
  );
  const newest = (rs) => rs.sort((a, b) => b.run_number - a.run_number)[0];
  // A run waiting for an approval never ran (conclusion action_required): it proves nothing and must
  // not hide another run (seen live on #102, 10 November).
  const seen = new Set();
  const all = [...runs, ...dispatched].filter((r) => r.name === "CI" && ran(r) && !seen.has(r.id) && seen.add(r.id));
  // The newest run decides: a test with a newer main that fails must hold the pull request.
  const ci = newest(all);
  if (!ci) return "missing";
  if (ci.status !== "completed") return ci.status;
  if (ci.conclusion !== "success") return ci.conclusion;
  let job = null;
  const mainOf = async (j) => {
    // The main the run merged with: its notice, else its log line (scripts in ci.yml, "merge with main").
    try {
      const notes = (await ghGet(`check-runs/${j.id}/annotations`)) ?? [];
      const n = notes.find((a) => a?.title === "Tested with main" && /^[0-9a-f]{40}$/.test(String(a.message ?? "").trim()));
      if (n) return String(n.message).trim();
    } catch {
      // read from the log below
    }
    try {
      const log = await ghText(`actions/jobs/${j.id}/logs`);
      const m = typeof log === "string" ? /^\S*\s?Tested with main: ([0-9a-f]{40})\s*$/m.exec(log) : null;
      if (m) return m[1];
    } catch {
      // unknown: the Gate tests again
    }
    return null;
  };
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(5000 * i);
    const jobs = (await ghGet(`actions/runs/${ci.id}/jobs`))?.jobs ?? [];
    job = jobs.find((j) => j.name === "check") ?? job;
    const steps = job?.steps ?? [];
    if (!steps.length) continue;
    const worker = steps.find((st) => st.name === "test:worker");
    const test = steps.find((st) => st.name === "test");
    if (worker?.conclusion === "success" && test?.conclusion === "success") {
      out.main = await mainOf(job);
      return "full";
    }
    // The light run skips test:worker; any other state of it is not a full pass.
    if (worker?.conclusion === "skipped") return "docs";
    if (worker?.conclusion === "success") return `test ${test?.conclusion ?? "not found"}`;
    return `test:worker ${worker?.conclusion ?? "not found"}`;
  }
  // Still no steps (#89's run kept none after a re-run): the job's own log shows which steps ran. Only
  // a successful check job whose log opens the test and test:worker steps counts as full; anything else waits.
  if (job?.id && job.conclusion === "success") {
    let log = null;
    try {
      log = await ghText(`actions/jobs/${job.id}/logs`);
    } catch {
      log = null;
    }
    if (typeof log === "string" && /^\S*\s?##\[group\]Run npm run test:worker\s*$/m.test(log) && /^\S*\s?##\[group\]Run npm test\s*$/m.test(log)) {
      out.main = await mainOf(job);
      return "full";
    }
    // A light run: the scope step said so in the log, and the last step that always runs began (the job
    // succeeded, so every step that began passed); test:worker never began.
    if (
      typeof log === "string" &&
      /^\S*\s?Full run: false\s*$/m.test(log) &&
      /^\S*\s?##\[group\]Run npm run test:risk\s*$/m.test(log) &&
      !/##\[group\]Run npm run test:worker/.test(log)
    )
      return "docs";
  }
  return "steps not listed by GitHub yet";
}
async function ghText(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "x-github-api-version": "2022-11-28" },
  });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.text();
}
const ciOn = (sha, out) => ciFrom(sha, gh, undefined, 3, ghText, out);

/** The preview smoke test of a commit: the newest Preview run that ran and whose smoke job ran (a run for a label skips it). ghGet: (path) => json */
export async function smokeFrom(sha, ghGet) {
  const runs = ((await ghGet(`actions/runs?head_sha=${sha}&per_page=50`))?.workflow_runs ?? [])
    .filter((r) => r.name === "Preview" && ran(r))
    .sort((a, b) => b.run_number - a.run_number);
  for (const run of runs) {
    if (run.status !== "completed") return run.status;
    const jobs = (await ghGet(`actions/runs/${run.id}/jobs`))?.jobs ?? [];
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

/** The repository a pull request's head branch lives in, lower case; "" when GitHub names none (a deleted fork). */
export function headRepoOf(pr) {
  const name = pr?.head?.repo?.full_name;
  return typeof name === "string" ? name.toLowerCase() : "";
}

export async function prState(n) {
  const pr = await gh(`pulls/${n}`);
  const sha = pr.head.sha;
  // The head commit itself, by its sha: refs/pull/<n>/head can lag behind it for minutes, and the
  // class must be the class of the commit the merge call pins (sha: pr.head.sha below).
  git("fetch", "--quiet", "origin", `+refs/heads/${pr.base.ref}:refs/remotes/origin/${pr.base.ref}`);
  for (const ref of [sha, `+refs/heads/${pr.head.ref}:refs/remotes/pr/${n}`, `+refs/pull/${n}/head:refs/remotes/pull/${n}`]) {
    try {
      git("fetch", "--quiet", "origin", ref);
    } catch {
      // a ref GitHub does not serve yet: try the next
    }
  }
  const headFetched = (() => {
    try {
      return git("rev-parse", "--verify", `${sha}^{commit}`) === sha;
    } catch {
      return false;
    }
  })();
  const files = headFetched ? readGit(`origin/${pr.base.ref}`, sha) : [];
  const { cls, hits } = classify(files, { branch: pr.head.ref, title: pr.title });
  const comments = await allComments(n);
  const tested = {};
  const ci = await ciOn(sha, tested);
  return {
    pr,
    hits,
    state: {
      open: pr.state === "open" && !pr.merged,
      headFetched,
      cls,
      labels: pr.labels.map((l) => l.name),
      records: ownerRecords(comments, REPO_OWNER),
      draft: pr.draft,
      fork: headRepoOf(pr) !== REPO.toLowerCase(),
      paused: await paused(),
      ci,
      testedMain: tested.main ?? null,
      smoke: await smokeFrom(sha, gh),
      ...(() => {
        // A review of the head itself, or one carried across clean merges of main (carriedReview).
        if (!headFetched) return { review: reviewFor(comments, sha, REPO_OWNER), carry: null };
        const base = `origin/${pr.base.ref}`;
        const opts = { branch: pr.head.ref, title: pr.title };
        const { review, why } = carriedReview({ head: sha, base, comments, owner: REPO_OWNER, git, classOf: (b, h) => classify(readGit(b, h), opts).cls });
        return { review, carry: why };
      })(),
      mergeable: pr.mergeable,
      // 2026-11-11: up to date means CI tested the head merged with the main of now (or main moved since
      // only by docs). The branch itself need not contain main.
      upToDate: (() => {
        const now = git("rev-parse", `origin/${pr.base.ref}`);
        if (!tested.main) return false;
        let moved = null;
        try {
          git("merge-base", "--is-ancestor", tested.main, now);
          moved = git("diff", "--name-only", tested.main, now).split("\n").filter(Boolean);
        } catch {
          moved = null; // not on main any more, or not fetched: test again
        }
        return upToDateFrom(tested.main === now, moved);
      })(),
      workflows: files.some((f) => f.path.startsWith(".github/workflows/")),
      docsOnly: headFetched && files.every((f) => DOCS_ONLY(f.path)),
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
      records = ownerRecords(await allComments(pr.number), REPO_OWNER);
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
      // A docs only merge changes nothing live: the Gate starts no deploy for it.
      if (process.env.GITHUB_OUTPUT) execFileSync("sh", ["-c", `echo merged=true >> "$GITHUB_OUTPUT"; echo docs=${state.docsOnly} >> "$GITHUB_OUTPUT"`]);
    }
  } else if (cmd === "sweep") {
    // After a merge, and after any Gate run: every open pull request again, oldest first. Merges at most
    // one per round (each merge leaves the others behind main), then starts CI again on at most one.
    // 2026-11-11, --follow: a CI run the Gate starts itself never wakes it (a run started with its token
    // starts no workflow_run), and GitHub ran the 15 minute schedule once in four hours that day. So the
    // Gate waits here for the run it started and sweeps again, up to ROUNDS rounds in one job.
    const follow = process.argv.includes("--follow");
    const ROUNDS = 4;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const all = [];
    for (let round = 1; round <= (follow ? ROUNDS : 1); round++) {
      const open = (await gh(`pulls?state=open&per_page=100&sort=created&direction=asc`)) ?? [];
      const lines = [`### Sweep${follow ? ` ${round}` : ""} of ${open.length} open pull requests`];
      let merged = false;
      const states = [];
      for (const p of open) {
        if (p.draft || headRepoOf(p) !== REPO.toLowerCase()) continue;
        let pr, state;
        try {
          ({ pr, state } = await prState(p.number));
        } catch (e) {
          lines.push(`- #${p.number}: could not be read (${String(e?.message ?? e).slice(0, 120)})`);
          continue;
        }
        if (!state.open) continue;
        const d = decide(state);
        if (d.ready && !merged && process.argv.includes("--merge")) {
          let said;
          try {
            // sha: GitHub refuses if the head moved since it was judged.
            said = await mergeOne({ number: p.number, sha: pr.head.sha, title: pr.title, docsOnly: state.docsOnly, call: gh });
          } catch (e) {
            lines.push(`- #${p.number}: ready, but GitHub refused the merge (${String(e?.message ?? e).slice(0, 160)})`);
            continue;
          }
          merged = true;
          lines.push(`- #${p.number} (${d.cls}): ${said}`);
          continue;
        }
        states.push({ number: p.number, state, sha: pr.head.sha });
        lines.push(`- #${p.number} (${d.cls}): ${d.ready ? "ready" : d.reasons.join("; ")}`);
      }
      let started = null;
      if (process.argv.includes("--update")) {
        // A merge just now left every other branch behind main, and a merge made with the Gate's token
        // starts no new Gate run: read them again before choosing, or the queue would stop here.
        let queue = states;
        if (merged) {
          queue = [];
          for (const p of states) {
            try {
              const { pr, state } = await prState(p.number);
              if (state.open) queue.push({ number: p.number, state, sha: pr.head.sha });
            } catch {
              // left for the next sweep
            }
          }
        }
        const { order, why } = pickUpdate(queue);
        if (!order.length) lines.push(`No CI started: ${why}.`);
        lines.push(
          ...(await updateInTurn(order, queue, async (n, sha) => {
            const said = await bringUpToDate({ number: n, sha, call: gh, sleep });
            started = retestName(n, sha);
            return said;
          })),
        );
      } else {
        const { update, why } = pickUpdate(states);
        lines.push(update === null ? `No CI to start: ${why}.` : `Would start CI again on #${update} (with --update).`);
      }
      all.push(lines.join("\n"));
      if (!follow || !started || round === ROUNDS) break;
      const end = await waitForRun({ name: started, call: gh, sleep });
      all.push(`Waited for "${started}": ${end}. Sweeping again.`);
    }
    summary(all.join("\n\n"));
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
    console.error("usage: node scripts/gate.mjs pr <n> [--merge] | sweep [--merge] [--update] | deploy <sha> [deployments.json]");
    process.exit(2);
  }
}
