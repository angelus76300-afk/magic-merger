// Checks that the Gate judges a pull request's head commit itself, not GitHub's
// refs/pull/<n>/head, which can lag behind it (#48: the ref was the previous head).
// A throwaway remote holds a stale pull ref; the GitHub API is stubbed; prState must
// classify the sha the API names, and wait when that sha cannot be fetched.
//   node scripts/gate-prstate-test.mjs   (part of npm run test:risk)
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ": " + detail : ""}`);
  if (!ok) failed++;
};
const root = mkdtempSync(join(tmpdir(), "mm-gate-"));
const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "init.defaultBranch=main", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const write = (dir, path, text) => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), text);
};
const gateUrl = pathToFileURL(join(process.cwd(), "scripts/gate.mjs")).href;
const home = process.cwd();

try {
  // History: main; feat: A (docs only), B (a workflow), C (package.json); other: D (not containing B).
  const work = join(root, "work");
  mkdirSync(work);
  git(work, "init", "-q");
  write(work, "README.md", "a\n");
  git(work, "add", ".");
  git(work, "commit", "-qm", "base");
  git(work, "checkout", "-qb", "feat");
  write(work, "docs/A.md", "x\n");
  git(work, "add", ".");
  git(work, "commit", "-qm", "A");
  const A = git(work, "rev-parse", "HEAD");
  write(work, ".github/workflows/x.yml", "y\n");
  git(work, "add", ".");
  git(work, "commit", "-qm", "B");
  const B = git(work, "rev-parse", "HEAD");
  write(work, "package.json", "{}\n");
  git(work, "add", ".");
  git(work, "commit", "-qm", "C");
  const C = git(work, "rev-parse", "HEAD");
  git(work, "checkout", "-q", "main");
  git(work, "checkout", "-qb", "other");
  write(work, "docs/D.md", "q\n");
  git(work, "add", ".");
  git(work, "commit", "-qm", "D");
  const D = git(work, "rev-parse", "HEAD");

  // The API says the head is B; each case sets what the remote serves.
  // 2026-11-06: the head repository and the comments come from the API too (the repository is public).
  const REPO = process.env.GITHUB_REPOSITORY ?? "angelus76300-afk/magic-merger";
  const OWNER = REPO.split("/")[0];
  let headRepo = { full_name: REPO };
  let comments = [];
  globalThis.fetch = async (url) => {
    const p = new URL(url).pathname;
    let body = [];
    if (/\/pulls\/1$/.test(p))
      body = {
        head: { sha: B, ref: "feat", repo: headRepo },
        base: { ref: "main", repo: { full_name: REPO } },
        state: "open",
        merged: false,
        labels: [{ name: "owner-yes" }],
        draft: false,
        mergeable: true,
        title: "t",
      };
    else if (p.endsWith("/actions/runs")) body = { workflow_runs: [] };
    else if (/\/issues\/1\/comments$/.test(p) && new URL(url).searchParams.get("page") === "1") body = comments;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const { prState, decide } = await import(gateUrl);

  const scenario = async (name, featTip) => {
    const bare = join(root, `${name}.git`);
    git(root, "clone", "-q", "--bare", work, bare);
    git(bare, "update-ref", "refs/heads/feat", featTip);
    git(bare, "update-ref", "refs/pull/1/head", A); // stale: the previous head
    // Refuse fetching a commit by its sha unless a ref points at it, as a strict server may.
    for (const k of ["allowReachableSHA1InWant", "allowAnySHA1InWant", "allowTipSHA1InWant"]) git(bare, "config", `uploadpack.${k}`, "false");
    const clone = join(root, `${name}-clone`);
    // --no-local: a local clone would hard-link every object, the unreachable head included.
    git(root, "clone", "-q", "--no-local", bare, clone);
    git(clone, "config", "protocol.version", "0");
    process.chdir(clone);
    try {
      return await prState(1);
    } finally {
      process.chdir(home);
    }
  };

  const fresh = await scenario("fresh", B);
  check(
    "a stale pull ref: the head itself is judged",
    fresh.state.headFetched === true && fresh.state.workflows === true && fresh.state.docsOnly === false,
    JSON.stringify(fresh.state),
  );
  check("a stale pull ref: its workflow makes it red", fresh.state.cls === "red", fresh.state.cls);

  const moved = await scenario("moved", C);
  const movedRules = moved.hits.map((h) => h.rule);
  check("a push after the API read: judged on the sha, not the new tip", moved.state.headFetched === true && !movedRules.includes("A2"), movedRules.join(","));

  // A stranger's comments: a passing review of the head and an owner record. Neither is read.
  comments = [
    { body: `<!-- mm-review verdict=pass sha=${B} tests=pass -->`, user: { login: "mallory" }, author_association: "NONE" },
    { body: "<!-- mm-owner yes -->\nyes", user: { login: "mallory" }, author_association: "NONE" },
  ];
  const forged = await scenario("forged", B);
  check(
    "a stranger's review and owner record on the pull request are not read",
    forged.state.review === null && forged.state.records.size === 0 && forged.state.fork === false,
    JSON.stringify({ review: forged.state.review, records: [...forged.state.records], fork: forged.state.fork }),
  );
  // The same comments from the owner's account are read.
  comments = comments.map((c) => ({ ...c, user: { login: OWNER }, author_association: "OWNER" }));
  const owned = await scenario("owned", B);
  check(
    "the owner's review and record are read",
    owned.state.review?.verdict === "pass" && owned.state.records.has("yes"),
    JSON.stringify({ review: owned.state.review, records: [...owned.state.records] }),
  );
  // A fork: its head lives in another repository. Refused, whatever its comments say.
  headRepo = { full_name: "mallory/magic-merger" };
  const fork = await scenario("fork", B);
  const forkWhy = decide(fork.state).reasons.join("; ");
  check("a fork's pull request is refused", fork.state.fork === true && /a fork/.test(forkWhy), forkWhy);
  headRepo = null;
  const gone = await scenario("gone", B);
  check("a pull request whose fork was deleted is refused", gone.state.fork === true, String(gone.state.fork));
  headRepo = { full_name: REPO };
  comments = [];

  const forced = await scenario("forced", D);
  check(
    "a head that cannot be fetched: it waits",
    forced.state.headFetched === false && forced.state.docsOnly === false && !decide(forced.state).ready,
    JSON.stringify({ headFetched: forced.state.headFetched, docsOnly: forced.state.docsOnly }),
  );
} finally {
  process.chdir(home);
  rmSync(root, { recursive: true, force: true });
}

console.log(failed ? `${failed} failed` : "all prState checks passed");
process.exit(failed ? 1 : 0);
