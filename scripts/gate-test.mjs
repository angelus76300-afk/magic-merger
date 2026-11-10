// Checks for the merge and deploy gate (scripts/gate.mjs): each condition alone holds a pull request back.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REPO_OWNER,
  byOwner,
  carriedReview,
  bringUpToDate,
  ciFrom,
  ran,
  updateInTurn,
  decide,
  deployable,
  headRepoOf,
  inFlight,
  lastDeployedFrom,
  ownerRecords,
  pickUpdate,
  reviewFor,
  sharedChangeFromMain,
  updatable,
  upToDateFrom,
} from "./gate.mjs";
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

    // 2026-11-10, the owner's carry rule: main changed the pull request's own file far from its lines.
    // Clean for git, only main's lines came in, the pull request's own lines are as reviewed: carried.
    g("checkout", "-q", "main");
    const mainA = commit("main edits a.ts far away", { "src/a.ts": lines(40, { 35: "main" }) });
    toFeat(R);
    g("merge", "-q", "--no-ff", "--no-edit", mainA);
    const theirs = carry(g("rev-parse", "HEAD"), reviewed);
    check(
      "carried: a clean merge that brings only main's lines into the pull request's own file",
      theirs.from === R && theirs.review?.tests === "pass",
      JSON.stringify(theirs),
    );
    // Still refused: the same merge with one more line slipped into that file by hand.
    toFeat(R);
    g("merge", "-q", "--no-ff", "--no-commit", mainA);
    write("src/a.ts", lines(40, { 2: "mine", 35: "main", 20: "slipped in" }));
    g("add", "-A");
    g("commit", "-qm", "merge main");
    const slipped = carry(g("rev-parse", "HEAD"), reviewed);
    check(
      "refused: a hand edit in the pull request's own file during a catch-up merge",
      slipped.review === null && /not a clean merge/.test(slipped.why),
      JSON.stringify(slipped),
    );
    // Still refused: main renamed the pull request's file; git follows the rename, but it is no plain text change.
    g("checkout", "-q", "main");
    const before = g("rev-parse", "HEAD");
    g("mv", "src/a.ts", "src/renamed.ts");
    g("commit", "-qm", "main renames a.ts");
    const renamed = g("rev-parse", "HEAD");
    toFeat(R);
    let mergedRename = true;
    try {
      g("merge", "-q", "--no-ff", "--no-edit", renamed);
    } catch {
      mergedRename = false;
      g("merge", "--abort");
    }
    const ren = mergedRename ? carry(g("rev-parse", "HEAD"), reviewed) : { review: null, why: "git did not merge it" };
    check("refused: a merge where main renamed the pull request's own file", mergedRename && ren.review === null, JSON.stringify(ren));
    g("branch", "-qf", "main", before);

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

// 2026-11-08: a merge of main may change docs/IDEAS.md and public/changelog.json with main's lines only.
// A throwaway repository with main's .gitattributes (union for the two files): the pull request R adds
// an idea, a changelog entry and code; main adds its own idea and entry at the same places.
{
  const root = mkdtempSync(join(tmpdir(), "mm-shared-"));
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
  // One line per entry (docs/DAILY.md): union then stacks two new entries as two lines.
  const entry = (text) => `    { "date": "2026-11-08", "text": "${text}" },\n`;
  const changelog = (...texts) => `{\n  "entries": [\n${texts.map(entry).join("")}    { "date": "2026-11-01", "text": "old" }\n  ]\n}\n`;
  const ideas = ({ top = [], backlog = [], built = [], keep = true } = {}) =>
    [
      "# Ideas",
      "",
      ...top,
      "## Backlog",
      "",
      ...(keep ? ["- old idea"] : []),
      ...backlog,
      "-- a line that looks like a header",
      "",
      "## Built",
      "",
      ...built,
      "- 2026-11-01 old",
      "",
    ].join("\n");
  const code = (x, tail = "") => `export const x = ${x};\n${"// filler\n".repeat(20)}${tail}`;
  const classOf = (b, h) => classify(readGit(b, h, root), { branch: "feat", title: "t" }).cls;
  const reviewOf = (sha) => own(`<!-- mm-review verdict=pass tests=pass sha=${sha} -->`);
  const carry = (head, comments) => carriedReview({ head, base: "main", comments, owner: REPO_OWNER, git: g, classOf });
  const toFeat = (from) => g("checkout", "-q", "-B", "feat", from);
  const mergeMain = (from, ref = "main") => {
    toFeat(from);
    g("merge", "-q", "--no-ff", "--no-edit", ref);
    return g("rev-parse", "HEAD");
  };
  const attributes = readFileSync(join(import.meta.dirname, "..", ".gitattributes"), "utf8");
  try {
    g("init", "-q");
    commit("base", { ".gitattributes": attributes, "docs/IDEAS.md": ideas(), "public/changelog.json": changelog(), "src/a.ts": code(1), "src/b.ts": code(1) });
    g("checkout", "-qb", "feat");
    const R = commit("the pull request", {
      "docs/IDEAS.md": ideas({ backlog: ["- mine"], built: ["- 2026-11-08 mine"] }),
      "public/changelog.json": changelog("mine"),
      "src/a.ts": code(2),
    });
    const reviewed = [reviewOf(R)];
    g("checkout", "-q", "main");
    const mainTip = commit("main: another pull request", {
      "docs/IDEAS.md": ideas({ top: ["- theirs"] }),
      "public/changelog.json": changelog("theirs"),
      "src/b.ts": code(3),
    });

    // Both insert at the same places: union merges them, the merge brings only main's lines.
    const M = mergeMain(R);
    const ok = carry(M, reviewed);
    check("carried: a merge of main that only adds main's lines to the two shared files", ok.from === R && ok.review?.tests === "pass", JSON.stringify(ok));
    check("the union merge kept both changelog entries as valid JSON", JSON.parse(g("show", `${M}:public/changelog.json`)).entries.length === 3);
    check("a carried shared-file merge makes a green pull request ready", decide({ ...ready, review: ok.review }).ready);
    check("refused for a fork, even with the review carried", !decide({ ...ready, review: ok.review, fork: true }).ready);

    // Refused: entries of several lines, as before 2026-11-08. union interleaves them into one object.
    {
      const tall = (text) => `    {\n      "date": "2026-11-08",\n      "text": "${text}"\n    },\n`;
      const tallLog = (...t) => `{\n  "entries": [\n${t.map(tall).join("")}    { "date": "2026-11-01", "text": "old" }\n  ]\n}\n`;
      g("checkout", "-q", "-B", "tall-main", "main~1");
      const tallTheirs = commit("main: a tall entry", { "public/changelog.json": tallLog("theirs") });
      toFeat("main~1");
      const T = commit("a tall entry", { "public/changelog.json": tallLog("mine") });
      const TM = mergeMain(T, tallTheirs);
      g("branch", "-qf", "main", tallTheirs);
      const broken = carry(TM, [reviewOf(T)]);
      g("branch", "-qf", "main", mainTip);
      check(
        "refused: union of two entries of several lines (the merged changelog is wrong)",
        broken.review === null && /did not come from main|does not parse/.test(broken.why ?? ""),
        JSON.stringify(broken),
      );
    }

    // Refused: the merge also rewrites one of the pull request's own lines in a shared file.
    toFeat(R);
    g("merge", "-q", "--no-ff", "--no-commit", "main");
    write("public/changelog.json", changelog("mine, and more", "theirs"));
    g("add", "-A");
    g("commit", "-qm", "merge main");
    const rewritten = carry(g("rev-parse", "HEAD"), reviewed);
    check("refused: the pull request's own changelog line changed in the merge", rewritten.review === null, JSON.stringify(rewritten));

    // Refused: union keeps a line the pull request removed (its own lines changed, though git's merge is clean).
    g("checkout", "-q", "-B", "base2", "main~1");
    const withA = commit("an entry a", { "public/changelog.json": changelog("a") });
    toFeat(withA);
    const D = commit("the pull request removes entry a", { "public/changelog.json": changelog(), "src/a.ts": code(4) });
    g("checkout", "-q", "-B", "main2", withA);
    const mainEdit = commit("main adds an entry right above it", { "public/changelog.json": changelog("theirs", "a") });
    g("branch", "-qf", "main", mainEdit);
    const MD = mergeMain(D);
    const resurrected = JSON.parse(g("show", `${MD}:public/changelog.json`)).entries.some((e) => e.text === "a");
    const undone = carry(MD, [reviewOf(D)]);
    check(
      "refused: a union merge that brings back an entry the pull request removed",
      resurrected && undone.review === null && /own lines|did not come from main/.test(undone.why ?? ""),
      `resurrected ${resurrected} ${JSON.stringify(undone)}`,
    );
    g("branch", "-qf", "main", mainTip);

    // Refused: main changes another of the pull request's files (src/a.ts), as before.
    g("checkout", "-q", "main");
    commit("main edits a.ts too", {
      "docs/IDEAS.md": ideas({ top: ["- theirs", "- third"] }),
      "src/a.ts": code(1, "// main\n"),
    });
    const MA = mergeMain(R);
    const other = carry(MA, reviewed);
    check(
      "carried (2026-11-10): a merge that also brings main's lines into another of the pull request's files",
      other.from === R && other.review?.tests === "pass",
      JSON.stringify(other),
    );
    g("branch", "-qf", "main", mainTip);

    // Refused: a hand edit of a shared file in the merge (the tree differs from git's merge).
    toFeat(R);
    g("merge", "-q", "--no-ff", "--no-commit", mainTip);
    write("docs/IDEAS.md", ideas({ top: ["- theirs"], backlog: ["- mine", "- slipped in"], built: ["- 2026-11-08 mine"] }));
    g("add", "-A");
    g("commit", "-qm", "merge main");
    check("refused: a merge that adds a line of its own to a shared file", carry(g("rev-parse", "HEAD"), reviewed).review === null);

    // The line check alone, without the tree check: a line main never wrote is refused.
    const fake = commit("not from main", { "docs/IDEAS.md": ideas({ backlog: ["- mine", "- invented"], built: ["- 2026-11-08 mine"] }) });
    check(
      "the shared line check refuses lines that did not come from main",
      /did not come from main/.test(sharedChangeFromMain(g, R, mainTip, fake, "docs/IDEAS.md") ?? ""),
    );
    check("the shared line check passes main's own lines", sharedChangeFromMain(g, R, mainTip, M, "docs/IDEAS.md") === null);
    check("the shared line check passes main's own changelog entry", sharedChangeFromMain(g, R, mainTip, M, "public/changelog.json") === null);
    // A removed markdown line "-- x" shows as "--- x" inside a hunk: it is a line, not a file header.
    const fakeGit = (...a) => {
      if (a[0] === "merge-base") return "mb";
      if (a[0] === "show") return "{}";
      const [from, to] = a.slice(-4, -2);
      if (from === "mb" && to === "S") return "diff --git a/f b/f\nindex 1..2 100644\n--- a/f\n+++ b/f\n@@ -3 +2,0 @@\n--- x";
      return "";
    };
    check("a removed line that starts with -- is a line, not a header", /did not come from main/.test(sharedChangeFromMain(fakeGit, "F", "S", "M", "f") ?? ""));
    // Fake diffs for the parts no real merge reaches on its own (defence in depth behind the tree check).
    const diffs =
      (table) =>
      (...a) => {
        if (a[0] === "merge-base") return "mb";
        if (a[0] === "show") return "{}";
        const [from, to] = a.slice(-4, -2);
        return table[`${from}>${to}`] ?? "";
      };
    const hunk = (...l) => `diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n${l.join("\n")}`;
    check(
      "refused: the merge brings main's lines but the pull request's own lines differ after it",
      /own lines/.test(
        sharedChangeFromMain(diffs({ "mb>S": hunk("+t"), "F>M": hunk("+t"), "mb>F": hunk("+mine"), "S>M": hunk("+mine, changed") }), "F", "S", "M", "f") ?? "",
      ),
    );
    check(
      "main's lines placed in another order by git still count as main's",
      sharedChangeFromMain(diffs({ "mb>S": hunk("+a", "+b"), "F>M": hunk("+b", "+a") }), "F", "S", "M", "f") === null,
    );
    check(
      "a line's trailing spaces do not count (git output may be trimmed)",
      sharedChangeFromMain(diffs({ "mb>S": hunk("+a  ", "+b"), "F>M": hunk("+a", "+b") }), "F", "S", "M", "f") === null,
    );
    check(
      "a merged changelog that does not parse carries nothing",
      /does not parse/.test(
        sharedChangeFromMain((...a) => (a[0] === "show" ? '{ "entries": [ { "text": "a" "text": "b" } ] }' : ""), "F", "S", "M", "public/changelog.json") ?? "",
      ),
    );
    check(
      "a diff git cannot show as text carries nothing",
      /plain text/.test(sharedChangeFromMain(() => "Binary files a/f and b/f differ", "F", "S", "M", "f") ?? ""),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// prettier leaves public/changelog.json alone (one line per entry, for union): check its shape here.
{
  let log = null;
  try {
    log = JSON.parse(readFileSync(join(import.meta.dirname, "..", "public", "changelog.json"), "utf8"));
  } catch (e) {
    log = String(e);
  }
  check(
    "public/changelog.json parses and every entry has a date and a text",
    Array.isArray(log?.entries) &&
      log.entries.length > 0 &&
      log.entries.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && typeof e.text === "string" && e.text),
    typeof log === "string" ? log : "",
  );
}

// 2026-11-08, the merge queue: which pull request the Gate merges main into (updatable, pickUpdate).
{
  const behind = { ...ready, upToDate: false, mergeable: true, headFetched: true, catchUp: ["src/world.ts", "docs/IDEAS.md"] };
  check("a pull request ready but for being behind main is updatable", updatable(behind));
  check("one already up to date is not", !updatable({ ...behind, upToDate: true }));
  check("one GitHub cannot merge cleanly is not (a conflict stays its builder's)", !updatable({ ...behind, mergeable: false }));
  check("one whose mergeability GitHub has not computed yet is not", !updatable({ ...behind, mergeable: null }));
  check("a fork is never updated", !updatable({ ...behind, fork: true }));
  check("unknown fork state is not updated", !updatable({ ...behind, fork: undefined }));
  check("a draft is not updated", !updatable({ ...behind, draft: true }));
  check("nothing is updated while paused", !updatable({ ...behind, paused: true }));
  check("a pull request on hold is not updated", !updatable({ ...behind, labels: ["hold"] }));
  check("one without a passing review is not updated", !updatable({ ...behind, review: null }));
  check("one with a blocking review is not updated", !updatable({ ...behind, review: { verdict: "block", tests: "pass" } }));
  check("one whose CI failed is not updated", !updatable({ ...behind, ci: "failure" }));
  check("one without its smoke test is not updated", !updatable({ ...behind, smoke: "failure" }));
  check("red without the owner's yes is not updated", !updatable({ ...behind, cls: "red" }));
  check("red with the owner's yes is updated", updatable({ ...behind, cls: "red", labels: ["owner-yes"], records: YES }));
  check("a reviewer's raise to red without a yes is not updated", !updatable({ ...behind, review: { ...pass, raise: "red" } }));
  check("a head not fetched is not updated", !updatable({ ...behind, headFetched: false }));
  check("a workflow change is not updated (the Gate cannot merge it anyway)", !updatable({ ...behind, workflows: true }));

  check("an up to date pull request whose CI runs is in flight", inFlight({ ...ready, upToDate: true, ci: "in_progress" }));
  check("so is one whose preview runs", inFlight({ ...ready, upToDate: true, smoke: "queued" }));
  check("a finished one is not in flight", !inFlight({ ...ready, upToDate: true }));
  check("a behind one is not in flight", !inFlight({ ...ready, upToDate: false, ci: "in_progress" }));
  check("a fork is never in flight (it cannot hold the queue)", !inFlight({ ...ready, upToDate: true, ci: "in_progress", fork: true }));

  const q = (number, state) => ({ number, state });
  check("the oldest updatable pull request goes first", pickUpdate([q(83, behind), q(79, behind), q(85, { ...behind, review: null })]).update === 79);
  check("nothing is updated while another is in flight", pickUpdate([q(79, behind), q(90, { ...ready, upToDate: true, ci: "in_progress" })]).update === null);
  check("nothing to update says why", /only behind/.test(pickUpdate([q(1, { ...ready, upToDate: true })]).why));
  check(
    "a pull request held only by a workflow catch-up is named, with what to do",
    /#79 would be brought up to date.*\.github\/workflows.*merges main once/.test(
      pickUpdate([q(79, { ...behind, catchUp: [".github/workflows/ci.yml"] })]).why,
    ),
  );
  check("an empty queue updates nothing", pickUpdate([]).update === null);
  // Review of #98: a branch whose catch-up brings a workflow change is refused to the Gate's token every
  // time; it must not hold the queue, and an unknown catch-up is not updated (fail closed).
  const bringsWorkflow = { ...behind, catchUp: ["src/world.ts", ".github/workflows/ci.yml"] };
  check("a catch-up that brings a workflow change is not updated", !updatable(bringsWorkflow));
  check("an unknown catch-up is not updated", !updatable({ ...behind, catchUp: null }));
  check("the queue passes over it to the next oldest", pickUpdate([q(79, bringsWorkflow), q(83, behind)]).update === 83);
  {
    const tried = [];
    const lines = await updateInTurn(
      [79, 83, 90],
      [79, 83, 90].map((n) => ({ number: n, sha: `s${n}` })),
      async (n) => {
        tried.push(n);
        if (n === 79) throw new Error("PUT pulls/79/update-branch: 422 refused");
        return `merged main into #${n}`;
      },
    );
    check(
      "a refused update passes the turn to the next in line, and only one is updated",
      tried.join() === "79,83" && /#83/.test(lines.at(-1)),
      lines.join(" | "),
    );
    const all = [];
    await updateInTurn(
      [1, 2, 3, 4],
      [1, 2, 3, 4].map((n) => ({ number: n, sha: "s" })),
      async (n) => {
        all.push(n);
        throw new Error("refused");
      },
    );
    check("at most three tries in one sweep", all.join() === "1,2,3");
  }
  check(
    "the order lists every candidate, oldest first, for the sweep to try after a refusal",
    pickUpdate([q(90, behind), q(79, behind), q(83, behind)]).order.join() === "79,83,90",
  );
}

// 2026-11-08: GitHub listed finished check jobs with no steps (#88, #89, #95): never read as docs or as a pass.
{
  const step = (conclusion) => [
    { name: "lint", conclusion: "success" },
    { name: "test:worker", conclusion },
  ];
  const fake = (pages, run = { name: "CI", run_number: 1, id: 7, status: "completed", conclusion: "success" }) => {
    let n = 0;
    return async (path) =>
      path.startsWith("actions/runs?") ? { workflow_runs: [run] } : { jobs: [{ name: "check", steps: pages[Math.min(n++, pages.length - 1)] }] };
  };
  const noWait = async () => {};
  check("a full run reads full", (await ciFrom("s", fake([step("success")]), noWait)) === "full");
  check("a light run (test:worker skipped) reads docs", (await ciFrom("s", fake([step("skipped")]), noWait)) === "docs");
  check("no steps listed is neither docs nor full: it waits", (await ciFrom("s", fake([[]]), noWait)) === "steps not listed by GitHub yet");
  // The job's log, when GitHub lists no steps (#89's CI): full only when the test:worker step opened in it.
  const withJob = (log, conclusion = "success") => {
    const gh = async (path) =>
      path.startsWith("actions/runs?")
        ? { workflow_runs: [{ name: "CI", run_number: 1, id: 7, status: "completed", conclusion: "success" }] }
        : { jobs: [{ name: "check", id: 9, conclusion, steps: [] }] };
    return ciFrom("s", gh, noWait, 2, async (path) => (path === "actions/jobs/9/logs" ? log : null));
  };
  const fullLog = "2026-11-08T03:59:40.4833576Z ##[group]Run npm run test:worker\n... all worker checks passed";
  check("no steps, but the job log opens test:worker: full", (await withJob(fullLog)) === "full");
  check("no steps and a log without test:worker: waits", (await withJob("2026-11-08T03:59:05Z ##[group]Run npm run lint")) !== "full");
  check("no steps, a failed job, a log with test:worker: waits", (await withJob(fullLog, "failure")) !== "full");
  check("test:worker named inside another line does not count", (await withJob("x echo '##[group]Run npm run test:worker' fake")) !== "full");
  check("no steps and no log: waits", (await withJob(null)) !== "full");
  // 2026-11-10: a light run without steps reads docs from its log; anything less waits.
  const lightLog = [
    "2026-11-10T22:00:01.1Z ##[group]Run npm run lint",
    "2026-11-10T22:00:20.1Z Full run: false",
    "2026-11-10T22:01:30.1Z ##[group]Run npm run test:risk",
    "2026-11-10T22:01:50.1Z all workflow checks passed",
  ].join("\n");
  check("no steps, a light run's log: docs", (await withJob(lightLog)) === "docs");
  check("no steps, a light log cut before test:risk: waits", (await withJob(lightLog.split("\n").slice(0, 2).join("\n"))) === "steps not listed by GitHub yet");
  check("no steps, a log without the scope line: waits", (await withJob(lightLog.split("\n").slice(2).join("\n"))) === "steps not listed by GitHub yet");
  check("no steps, a failed light job: waits", (await withJob(lightLog, "failure")) === "steps not listed by GitHub yet");
  check(
    "the scope's script text in the log is not its output",
    (await withJob(lightLog.replace("Full run: false", '  echo "Full run: $full" | tee'))) !== "docs",
  );
  // The Gate's dispatch counts only when the pull request's own event left no run on the commit.
  const runsOf = (runs, jobsById) => async (path) =>
    path.startsWith("actions/runs?") ? { workflow_runs: runs } : { jobs: [{ name: "check", steps: jobsById[/runs\/(\d+)\/jobs/.exec(path)[1]] }] };
  const run = (id, event, run_number, conclusion = "success") => ({ name: "CI", id, event, run_number, status: "completed", conclusion });
  check(
    "a newer failed dispatch does not hide the pull request's own full run",
    (await ciFrom("s", runsOf([run(1, "pull_request", 5), run(2, "workflow_dispatch", 6, "failure")], { 1: step("success") }), noWait)) === "full",
  );
  // Seen live on #102 (10 November): the Gate's update made GitHub create pull_request runs held for an
  // approval (conclusion action_required) beside the runs the Gate dispatched. They never ran.
  check(
    "a pull_request run held for an approval does not hide the Gate's dispatched full run",
    (await ciFrom("s", runsOf([run(1, "pull_request", 5, "action_required"), run(2, "workflow_dispatch", 6)], { 2: step("success") }), noWait)) === "full",
  );
  check(
    "a run that never ran does not count as one",
    !ran({ status: "completed", conclusion: "action_required" }) && ran({ status: "completed", conclusion: "success" }),
  );
  check(
    "only held runs: CI reads missing, so the Gate waits",
    (await ciFrom("s", runsOf([run(1, "pull_request", 5, "action_required")], {}), noWait)) === "missing",
  );
  check("a dispatched run alone counts", (await ciFrom("s", runsOf([run(2, "workflow_dispatch", 6)], { 2: step("success") }), noWait)) === "full");
  check(
    "a failed run of the pull request's own event is not hidden by a dispatch",
    (await ciFrom("s", runsOf([run(1, "pull_request", 5, "failure"), run(2, "workflow_dispatch", 6)], { 2: step("success") }), noWait)) === "failure",
  );
  check("steps listed on a second fetch are read", (await ciFrom("s", fake([[], step("success")]), noWait)) === "full");
  check("a check job without test:worker is not docs", (await ciFrom("s", fake([[{ name: "lint", conclusion: "success" }]]), noWait)) !== "docs");
  check("a failed test:worker is not full", (await ciFrom("s", fake([step("failure")]), noWait)) !== "full");
  check(
    "a running CI reads as running",
    (await ciFrom("s", fake([[]], { name: "CI", run_number: 1, id: 7, status: "in_progress" }), noWait)) === "in_progress",
  );
  check("no CI run reads missing", (await ciFrom("s", async () => ({ workflow_runs: [] }), noWait)) === "missing");
}

// 2026-11-10, "gate token: dispatch": the update, the wait for the new head, the two dispatches.
{
  const OLD = "1".repeat(40);
  const NEW = "2".repeat(40);
  const fakeGh = ({ moveAfter = 1, runsAfter = 1, refuse = null } = {}) => {
    const calls = [];
    let reads = 0;
    let lists = 0;
    const call = async (path, init = {}) => {
      calls.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null });
      if (refuse && path.includes(refuse)) throw new Error(`PUT ${path}: 422 refused`);
      if (path === "pulls/12") return { head: { sha: ++reads > moveAfter ? NEW : OLD, ref: "claude/roads" } };
      if (path.startsWith("actions/runs?")) return { workflow_runs: ++lists >= runsAfter ? [{ name: "CI" }, { name: "Preview" }] : [] };
      return null;
    };
    return { call, calls };
  };
  const noSleep = async () => {};
  {
    const { call, calls } = fakeGh({ moveAfter: 2, runsAfter: 2 });
    const said = await bringUpToDate({ number: 12, sha: OLD, call, sleep: noSleep });
    const update = calls.find((c) => c.path === "pulls/12/update-branch");
    const dispatches = calls.filter((c) => /dispatches$/.test(c.path));
    check("the update pins the head it judged", update?.method === "PUT" && update.body.expected_head_sha === OLD);
    check(
      "CI and Preview are dispatched on the branch, naming the new head",
      dispatches.map((d) => d.path).join() === "actions/workflows/ci.yml/dispatches,actions/workflows/preview.yml/dispatches" &&
        dispatches.every((d) => d.body.ref === "claude/roads" && d.body.inputs.sha === NEW && d.body.inputs.pr === "12"),
      JSON.stringify(dispatches),
    );
    check("it waits until both runs are listed", calls.filter((c) => c.path.startsWith("actions/runs?")).length === 2);
    check("it says what it did", /merged main into #12/.test(said), said);
  }
  {
    const { call, calls } = fakeGh({ moveAfter: 1000 });
    const said = await bringUpToDate({ number: 12, sha: OLD, call, sleep: noSleep, waitMs: 9000 });
    check("a head that never moves starts nothing", !calls.some((c) => /dispatches$/.test(c.path)) && /had not moved/.test(said), said);
  }
  {
    const { call, calls } = fakeGh({ refuse: "update-branch" });
    let threw = false;
    try {
      await bringUpToDate({ number: 12, sha: OLD, call, sleep: noSleep });
    } catch {
      threw = true;
    }
    check("a refused update (a push meanwhile, a conflict) starts nothing and says so", threw && !calls.some((c) => /dispatches$/.test(c.path)));
  }
}

console.log(failed ? `${failed} failed` : "all gate checks passed");
process.exit(failed ? 1 : 0);
