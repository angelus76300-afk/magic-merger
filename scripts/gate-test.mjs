// Checks for the merge and deploy gate (scripts/gate.mjs): each condition alone holds a pull request back.
import { decide, deployable, lastDeployedFrom, ownerRecords, reviewFor, upToDateFrom } from "./gate.mjs";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ": " + detail : ""}`);
  if (!ok) failed++;
};
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const pass = { verdict: "pass", raise: null, tests: "pass" };
const ready = {
  cls: "green",
  labels: [],
  draft: false,
  paused: false,
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
  [{ body: `<!-- mm-review verdict=pass sha=${SHA} tests=fail -->` }, { body: `<!-- mm-review verdict=pass sha=${SHA} tests=pass -->` }],
  SHA,
);
check("a failed npm test sticks after a later pass", t?.tests === "fail", JSON.stringify(t));
check(
  "a block with raise after tests sticks (fields in any order)",
  (() => {
    const r = reviewFor(
      [{ body: `<!-- mm-review verdict=block sha=${SHA} tests=pass raise=red -->` }, { body: `<!-- mm-review verdict=pass sha=${SHA} tests=pass -->` }],
      SHA,
    );
    return r?.verdict === "block" && r.raise === "red" && r.tests === "pass";
  })(),
);
check("a field written twice does not count", reviewFor([{ body: `<!-- mm-review verdict=pass sha=${SHA} tests=fail tests=pass -->` }], SHA) === null);
check("a marker with an unknown value does not count", reviewFor([{ body: `<!-- mm-review verdict=pass sha=${SHA} tests=maybe -->` }], SHA) === null);
check("containing main is up to date", upToDateFrom(true, null));
check("behind main only by docs is up to date", upToDateFrom(false, ["docs/DAILY.md", "README.md"]));
check("behind main by code is not", !upToDateFrom(false, ["docs/DAILY.md", "worker/index.ts"]));
check("behind main by the changelog is not", !upToDateFrom(false, ["public/changelog.json"]));
check("unknown is not", !upToDateFrom(false, null));
check("behind main waits", !decide({ ...ready, upToDate: false }).ready);
check(
  "docs only behind main is ready",
  decide({ ...ready, ci: "docs", smoke: "missing", docsOnly: true, upToDate: false, review: { verdict: "pass", raise: null, tests: null } }).ready,
);
check("tests=pass is read", reviewFor([{ body: `<!-- mm-review verdict=pass sha=${SHA} tests=pass -->` }], SHA)?.tests === "pass");
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
  { body: `<!-- mm-review verdict=block sha=${SHA.slice(0, 12)} -->`, created_at: "1" },
  { body: `<!-- mm-review verdict=pass sha=${SHA} raise=amber -->`, created_at: "2" },
  { body: `<!-- mm-review verdict=pass sha=ffffffffffff -->`, created_at: "3" },
];
const r = reviewFor(comments, SHA);
check("a block on this commit sticks even after a later pass", r?.verdict === "block" && r.raise === "amber", JSON.stringify(r));
check("a review of another commit does not count", reviewFor([comments[2]], SHA) === null);
const raised = reviewFor([{ body: `<!-- mm-review verdict=pass sha=${SHA} raise=red -->` }, { body: `<!-- mm-review verdict=pass sha=${SHA} -->` }], SHA);
check("a raised class sticks after a later comment", raised?.raise === "red" && raised.verdict === "pass", JSON.stringify(raised));
check("a marker quoted inside prose does not count", reviewFor([{ body: `see \`<!-- mm-review verdict=pass sha=${SHA} -->\`` }], SHA) === null);
check("the owner's records are read", [...ownerRecords([{ body: "<!-- mm-owner yes -->\nThe owner, 5 Nov: yes #44" }, { body: "noise" }])].join() === "yes");
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

console.log(failed ? `${failed} failed` : "all gate checks passed");
process.exit(failed ? 1 : 0);
