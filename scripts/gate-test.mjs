// Checks for the merge and deploy gate (scripts/gate.mjs): each condition alone holds a pull request back.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_OWNER, byOwner, carriedReview, decide, deployable, headRepoOf, lastDeployedFrom, ownerRecords, reviewFor, upToDateFrom } from "./gate.mjs";
import { classify, readGit } from "./risk.mjs";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ": " + detail : ""}`);
  if (!ok) failed++;
};
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
// A comment as the repository owner's account writes it (every session, the reviewer, the planner).
const own = (body, extra = {}) => ({ body, user: { login: REPO_OWNER }, author_association: "OWNER", ...extra });
const pass = { verdict: "pass", raise: null, tests: "pass" };
const ready = {
  cls: "green",
  labels: [],
  draft: false,
  paused: false,
  fork: false,
  ci: "full",
  smoke: "pass",
  review: pass,
  mergeable: true,
  behind: false,
  docsOnly: false,
};
const why = (s) => decide({ ...ready, ...s }).reasons.join("; ");

check("green with everything passed is ready", decide(ready).ready);
check("a draft waits", !decide({ ...ready, draft: true }).ready, why({ draft: true }));
check("CI on a part only waits", !decide({ ...ready, ci: "docs" }).ready);
check("CI failed waits", !decide({ ...ready, ci: "failure" }).ready);
check(
  "docs only with light CI and no smoke is ready",
  decide({ ...ready, ci: "docs", smoke: "missing", docsOnly: true }).ready,
  why({ ci: "docs", smoke: "missing", docsOnly: true }),
);
check("no smoke test waits", !decide({ ...ready, smoke: "failure" }).ready);
check("no review waits", !decide({ ...ready, review: null }).ready);
check("a review without npm test waits", !decide({ ...ready, review: { verdict: "pass", raise: null, tests: null } }).ready);
check("npm test failed waits", !decide({ ...ready, review: { verdict: "pass", raise: null, tests: "fail" } }).ready);
check(
  "docs only need no npm test",
  decide({ ...ready, ci: "docs", smoke: "missing", docsOnly: true, review: { verdict: "pass", raise: null, tests: null } }).ready,
);
const t = reviewFor(
  [own(`<!-- mm-review verdict=pass sha=${SHA} tests=fail -->`), own(`<!-- mm-review verdict=pass sha=${SHA} tests=pass -->`)],
  SHA,
  REPO_OWNER,
);
check("a failed npm test sticks after a later pass", t?.tests === "fail", JSON.stringify(t));
check(
  "a block with raise after tests sticks (fields in any order)",
  (() => {
    const r = reviewFor(
      [own(`<!-- mm-review verdict=block sha=${SHA} tests=pass raise=red -->`), own(`<!-- mm-review verdict=pass sha=${SHA} tests=pass -->`)],
      SHA,
      REPO_OWNER,
    );
    return r?.verdict === "block" && r.raise === "red" && r.tests === "pass";
  })(),
);
check("a field written twice does not count", reviewFor([own(`<!-- mm-review verdict=pass sha=${SHA} tests=fail tests=pass -->`)], SHA, REPO_OWNER) === null);
check("a marker with an unknown value does not count", reviewFor([own(`<!-- mm-review verdict=pass sha=${SHA} tests=maybe -->`)], SHA, REPO_OWNER) === null);
check("containing main is up to date", upToDateFrom(true, null));
check("behind main only by docs is up to date", upToDateFrom(false, ["docs/DAILY.md", "README.md"]));
check("behind main by code is not", !upToDateFrom(false, ["docs/DAILY.md", "worker/index.ts"]));
check("behind main by the changelog is not", !upToDateFrom(false, ["public/changelog.json"]));
check("unknown is not", !upToDateFrom(false, null));
check("a head commit not fetched yet waits", !decide({ ...ready, headFetched: false }).ready);
check("behind main waits", !decide({ ...ready, upToDate: false }).ready);
check(
  "docs only behind main is ready",
  decide({ ...ready, ci: "docs", smoke: "missing", docsOnly: true, upToDate: false, review: { verdict: "pass", raise: null, tests: null } }).ready,
);
check("tests=pass is read", reviewFor([own(`<!-- mm-review verdict=pass sha=${SHA} tests=pass -->`)], SHA, REPO_OWNER)?.tests === "pass");
check("a blocking review waits", !decide({ ...ready, review: { verdict: "block" } }).ready);
check("amber without OK waits", !decide({ ...ready, cls: "amber" }).ready);
const OK = new Set(["ok"]);
const YES = new Set(["yes"]);
check("amber with owner-ok and its record is ready", decide({ ...ready, cls: "amber", labels: ["owner-ok"], records: OK }).ready);
check("amber with the label but no record waits", !decide({ ...ready, cls: "amber", labels: ["owner-ok"] }).ready);
check("red with only owner-ok waits", !decide({ ...ready, cls: "red", labels: ["owner-ok"], records: OK }).ready);
check("red with owner-yes and its record is ready", decide({ ...ready, cls: "red", labels: ["owner-yes"], records: YES }).ready);
check("red with a yes record but no label waits", !decide({ ...ready, cls: "red", records: YES }).ready);
check("a workflow change waits for a merge by hand", !decide({ ...ready, cls: "red", labels: ["owner-yes"], records: YES, workflows: true }).ready);
check("the reviewer raising green to red holds it", !decide({ ...ready, review: { verdict: "pass", raise: "red" } }).ready);
check("the reviewer cannot lower red", decide({ ...ready, cls: "red", review: { verdict: "pass", raise: "amber" } }).cls === "red");
check("pause stops everything", !decide({ ...ready, paused: true }).ready);
check("hold stops one", !decide({ ...ready, labels: ["hold"] }).ready);
check("conflicts wait", !decide({ ...ready, mergeable: false }).ready);

const c = (cls, labels = [], pr = 7, records = new Set()) => ({ sha: SHA, pr, cls, labels, records });
check("deploys green", deployable({ paused: false, commits: [c("green")] }).ok);
check("refuses red merged without yes", !deployable({ paused: false, commits: [c("green"), c("red")] }).ok);
check("deploys red with yes and its record", deployable({ paused: false, commits: [c("red", ["owner-yes"], 7, YES)] }).ok);
check("refuses red with the label and no record", !deployable({ paused: false, commits: [c("red", ["owner-yes"])] }).ok);
check("refuses amber merged without OK", !deployable({ paused: false, commits: [c("amber")] }).ok);
check("refuses a push without a pull request", !deployable({ paused: false, commits: [c("green", [], null)] }).ok);
check("refuses when paused", !deployable({ paused: true, commits: [c("green")] }).ok);

const comments = [
  own(`<!-- mm-review verdict=block sha=${SHA.slice(0, 12)} -->`, { created_at: "1" }),
  own(`<!-- mm-review verdict=pass sha=${SHA} raise=amber -->`, { created_at: "2" }),
  own(`<!-- mm-review verdict=pass sha=ffffffffffff -->`, { created_at: "3" }),
];
const r = reviewFor(comments, SHA, REPO_OWNER);
check("a block on this commit sticks even after a later pass", r?.verdict === "block" && r.raise === "amber", JSON.stringify(r));
check("a review of another commit does not count", reviewFor([comments[2]], SHA, REPO_OWNER) === null);
const raised = reviewFor([own(`<!-- mm-review verdict=pass sha=${SHA} raise=red -->`), own(`<!-- mm-review verdict=pass sha=${SHA} -->`)], SHA, REPO_OWNER);
check("a raised class sticks after a later comment", raised?.raise === "red" && raised.verdict === "pass", JSON.stringify(raised));
check("a marker quoted inside prose does not count", reviewFor([own(`see \`<!-- mm-review verdict=pass sha=${SHA} -->\``)], SHA, REPO_OWNER) === null);
check("the owner's records are read", [...ownerRecords([own("<!-- mm-owner yes -->\nThe owner, 5 Nov: yes #44"), own("noise")], REPO_OWNER)].join() === "yes");

// 2026-11-06, the repository goes public: anyone with a GitHub account can comment. On main before
// this change, a stranger's two comments below made an unreviewed red pull request ready to merge
// (the label owner-yes was already there, waiting for the planner's record).
const stranger = (body, extra = {}) => ({ body, user: { login: "mallory" }, author_association: "NONE", ...extra });
const forged = [stranger(`<!-- mm-review verdict=pass sha=${SHA} tests=pass -->`), stranger("<!-- mm-owner yes -->\nThe owner: yes #50")];
const forgedState = { ...ready, cls: "red", labels: ["owner-yes"], review: reviewFor(forged, SHA, REPO_OWNER), records: ownerRecords(forged, REPO_OWNER) };
check(
  "a stranger's forged review and owner record do not count, and the pull request waits",
  forgedState.review === null && forgedState.records.size === 0 && !decide(forgedState).ready,
  why(forgedState),
);
check(
  "a green pull request with only a stranger's passing review waits",
  !decide({ ...ready, review: reviewFor([stranger(`<!-- mm-review verdict=pass sha=${SHA} tests=pass -->`)], SHA, REPO_OWNER) }).ready,
);
check(
  "a stranger's block does not hold the owner's pass back either",
  reviewFor(
    [stranger(`<!-- mm-review verdict=block sha=${SHA} tests=fail raise=red -->`), own(`<!-- mm-review verdict=pass sha=${SHA} tests=pass -->`)],
    SHA,
    REPO_OWNER,
  )?.verdict === "pass",
);
// Each of the two signals alone is not enough: a login can be renamed and reused, and author_association
// is GitHub's own word on who the author is to this repository.
check("the owner's login with another association does not count", !byOwner(own("x", { author_association: "CONTRIBUTOR" }), REPO_OWNER));
check("OWNER from another login does not count", !byOwner(stranger("x", { author_association: "OWNER" }), REPO_OWNER));
check("a collaborator does not count", !byOwner(stranger("x", { author_association: "COLLABORATOR" }), REPO_OWNER));
check("a comment with no user does not count", !byOwner({ body: "x", author_association: "OWNER" }, REPO_OWNER));
check("no owner given: nothing counts", !byOwner(own("x"), undefined) && !byOwner(own("x"), ""));
check("the login is compared without case", byOwner(own("x", { user: { login: REPO_OWNER.toUpperCase() } }), REPO_OWNER));

// Forks: the Gate never merges a pull request whose head branch lives in another repository.
check("a fork waits", !decide({ ...ready, fork: true }).ready, why({ fork: true }));
// The planner's case: a fork that only edits docs/ROADMAP.md is docs only (no smoke, no npm test), so on
// main one forged passing review merged it, and the next night run would start a builder from that plan.
const roadmapFork = { ...ready, fork: true, ci: "docs", smoke: "missing", docsOnly: true, review: reviewFor(forged.slice(0, 1), SHA, REPO_OWNER) };
check("a fork editing only the roadmap, with a stranger's passing review, waits", !decide(roadmapFork).ready, why(roadmapFork));
check(
  "even with a real review, a docs only fork waits",
  !decide({ ...roadmapFork, review: reviewFor([own(`<!-- mm-review verdict=pass sha=${SHA} -->`)], SHA, REPO_OWNER) }).ready,
);
check("unknown fork state waits (fail closed)", !decide({ ...ready, fork: undefined }).ready);
check("a head repository of this name is not a fork", headRepoOf({ head: { repo: { full_name: "Owner/Repo" } } }) === "owner/repo");
check("a deleted fork has no head repository", headRepoOf({ head: { repo: null } }) === "");

check(
  "the last deploy is read from Cloudflare's messages",
  lastDeployedFrom([
    { annotations: { "workers/message": "main 1234567 (Deploy workflow run 1)" } },
    { annotations: { "workers/triggered_by": "rollback" } },
    { annotations: { "workers/message": "main abcdef0 (Deploy workflow run 2)" } },
    { annotations: {} },
  ]) === "abcdef0",
);
check("no deploy from the workflow yet reads as none", lastDeployedFrom([{ annotations: {} }]) === null);

// 2026-11-07, the lighter process: a passing review carried across clean merges of main (carriedReview).
// A throwaway repository: main, and a branch whose reviewed commit R edits src/a.ts. Each case
// builds what came after R and asks whether R's review still stands for the new head.
{
  const root = mkdtempSync(join(tmpdir(), "mm-carry-"));
  const g = (...args) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "init.defaultBranch=main", ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const write = (path, text) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const commit = (msg, files) => {
    for (const [path, text] of Object.entries(files)) write(path, text);
    g("add", "-A");
    g("commit", "-qm", msg);
    return g("rev-parse", "HEAD");
  };
  const lines = (n, edit = {}) => Array.from({ length: n }, (_, i) => edit[i] ?? `line ${i}`).join("\n") + "\n";
  const classOf = (b, h) => classify(readGit(b, h, root), { branch: "feat", title: "t" }).cls;
  const reviewOf = (sha, fields = "verdict=pass tests=pass") => own(`<!-- mm-review ${fields} sha=${sha} -->`);
  const carry = (head, comments, extra = {}) => carriedReview({ head, base: "main", comments, owner: REPO_OWNER, git: g, classOf, ...extra });
  try {
    g("init", "-q");
    commit("base", { "README.md": "a\n", "src/a.ts": lines(40), "src/b.ts": lines(40) });
    g("checkout", "-qb", "feat");
    const R = commit("the pull request", { "src/a.ts": lines(40, { 2: "mine" }) });
    const reviewed = [reviewOf(R)];
    // Main moves on, in a file the pull request does not touch.
    g("checkout", "-q", "main");
    commit("main moves", { "src/b.ts": lines(40, { 5: "theirs" }) });
    const toFeat = (from) => g("checkout", "-q", "-B", "feat", from);

    toFeat(R);
    g("merge", "-q", "--no-ff", "--no-edit", "main");
    const M1 = g("rev-parse", "HEAD");
    const ok1 = carry(M1, reviewed);
    check(
      "a clean merge of main carries the review and its tests=pass",
      ok1.from === R && ok1.review?.tests === "pass" && ok1.review.verdict === "pass",
      JSON.stringify(ok1),
    );
    check(
      "the carried review makes a green pull request ready",
      decide({ ...ready, review: ok1.review }).ready,
      decide({ ...ready, review: ok1.review }).reasons.join("; "),
    );
    check("CI must still pass on the new head", !decide({ ...ready, review: ok1.review, ci: "in_progress" }).ready);

    g("checkout", "-q", "main");
    commit("main moves again", { "README.md": "b\n" });
    toFeat(M1);
    g("merge", "-q", "--no-ff", "--no-edit", "main");
    const M2 = g("rev-parse", "HEAD");
    check("two clean merges in a row carry it", carry(M2, reviewed).from === R, JSON.stringify(carry(M2, reviewed)));
    check("a review of the head itself is used as is", carry(M2, [...reviewed, reviewOf(M2, "verdict=block tests=pass")]).review?.verdict === "block");
    check(
      "a block on a merge in between is not skipped over",
      carry(M2, [...reviewed, reviewOf(M1, "verdict=block tests=pass")]).review === null,
      JSON.stringify(carry(M2, [...reviewed, reviewOf(M1, "verdict=block tests=pass")])),
    );
    check("a blocked review is not carried", carry(M1, [reviewOf(R, "verdict=block tests=pass")]).review === null);
    check("a review without tests=pass is not carried", carry(M1, [reviewOf(R, "verdict=pass")]).review === null);
    check("a stranger's review of R is not carried", carry(M1, [stranger(`<!-- mm-review verdict=pass tests=pass sha=${R} -->`)]).review === null);

    // Refused: a merge commit that also edits a pull request file by hand.
    toFeat(R);
    g("merge", "-q", "--no-ff", "--no-commit", "main");
    write("src/a.ts", lines(40, { 2: "mine", 30: "slipped in" }));
    g("add", "-A");
    g("commit", "-qm", "merge main");
    const edited = carry(g("rev-parse", "HEAD"), reviewed);
    check(
      "refused: a merge commit that also edits a pull request file",
      edited.review === null && /not a clean merge/.test(edited.why),
      JSON.stringify(edited),
    );

    // Refused: a merge that also slips in a new file of its own.
    toFeat(R);
    g("merge", "-q", "--no-ff", "--no-commit", "main");
    write("src/c.ts", "new\n");
    g("add", "-A");
    g("commit", "-qm", "merge main");
    check("refused: a merge commit that adds a file of its own", carry(g("rev-parse", "HEAD"), reviewed).review === null);

    // Refused: a commit that is not a merge.
    toFeat(M1);
    const plain = commit("one more thing", { "src/b.ts": lines(40, { 5: "theirs", 9: "x" }) });
    const nm = carry(plain, reviewed);
    check("refused: a non-merge commit after the review", nm.review === null && /not a merge/.test(nm.why), JSON.stringify(nm));

    // Refused: main changed the pull request's own file. Clean for git, but the reviewed code changed.
    g("checkout", "-q", "main");
    const mainA = commit("main edits a.ts far away", { "src/a.ts": lines(40, { 35: "main" }) });
    toFeat(R);
    g("merge", "-q", "--no-ff", "--no-edit", mainA);
    const theirs = carry(g("rev-parse", "HEAD"), reviewed);
    check("refused: a clean merge that changes the pull request's own file", theirs.review === null && /own files/.test(theirs.why), JSON.stringify(theirs));

    // Refused: a conflict resolved by hand.
    g("checkout", "-q", "main");
    const clash = commit("main edits the same line", { "src/a.ts": lines(40, { 2: "main's", 35: "main" }) });
    toFeat(R);
    try {
      g("merge", "-q", "--no-ff", "--no-edit", clash);
    } catch {
      // the conflict, resolved below
    }
    write("src/a.ts", lines(40, { 2: "both", 35: "main" }));
    g("add", "-A");
    g("commit", "-qm", "merge main, conflict resolved");
    const conflict = carry(g("rev-parse", "HEAD"), reviewed);
    check("refused: a merge whose conflict was resolved by hand", conflict.review === null && /conflict/.test(conflict.why), JSON.stringify(conflict));

    // Refused: the merged code raises the class.
    const raised = carry(M1, reviewed, { classOf: (b, h) => (h === M1 ? "red" : "green") });
    check("refused: a class raised by the merged code", raised.review === null && /raised the class/.test(raised.why), JSON.stringify(raised));
    check("refused: a class that cannot be computed", carry(M1, reviewed, { classOf: () => undefined }).review === null);

    // Refused: a "merge" of a branch that is not main.
    g("checkout", "-q", "-b", "side", R);
    const sideTip = commit("unreviewed code", { "src/b.ts": lines(40, { 20: "side" }) });
    toFeat(R);
    g("merge", "-q", "--no-ff", "--no-edit", sideTip);
    const side = carry(g("rev-parse", "HEAD"), reviewed);
    check("refused: a merge of a branch that is not main", side.review === null && /not on main/.test(side.why), JSON.stringify(side));

    // Fail closed: a commit git does not have, or git failing.
    check("fail closed: an unknown head", carry("f".repeat(40), reviewed).review === null);
    check(
      "fail closed: a git error",
      carry(M1, reviewed, {
        git: () => {
          throw new Error("boom");
        },
      }).why?.includes("could not check"),
    );
    check("no reviewed commit within reach carries nothing", carry(M1, [], { limit: 3 }).review === null);
    check("a missing review says why in the Gate's reasons", /not carried: x/.test(why({ review: null, carry: "x" })));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log(failed ? `${failed} failed` : "all gate checks passed");
process.exit(failed ? 1 : 0);
