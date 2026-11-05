// Checks for the merge and deploy gate (scripts/gate.mjs): each condition alone holds a pull request back.
import { decide, deployable, reviewFor } from "./gate.mjs";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ": " + detail : ""}`);
  if (!ok) failed++;
};
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const pass = { verdict: "pass", raise: null };
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
check("a blocking review waits", !decide({ ...ready, review: { verdict: "block" } }).ready);
check("amber without OK waits", !decide({ ...ready, cls: "amber" }).ready);
check("amber with owner-ok is ready", decide({ ...ready, cls: "amber", labels: ["owner-ok"] }).ready);
check("red with only owner-ok waits", !decide({ ...ready, cls: "red", labels: ["owner-ok"] }).ready);
check("red with owner-yes is ready", decide({ ...ready, cls: "red", labels: ["owner-yes"] }).ready);
check("the reviewer raising green to red holds it", !decide({ ...ready, review: { verdict: "pass", raise: "red" } }).ready);
check("the reviewer cannot lower red", decide({ ...ready, cls: "red", review: { verdict: "pass", raise: "amber" } }).cls === "red");
check("pause stops everything", !decide({ ...ready, paused: true }).ready);
check("hold stops one", !decide({ ...ready, labels: ["hold"] }).ready);
check("behind main waits", !decide({ ...ready, behind: true }).ready);
check("conflicts wait", !decide({ ...ready, mergeable: false }).ready);

const c = (cls, labels = [], pr = 7) => ({ sha: SHA, pr, cls, labels });
check("deploys green", deployable({ paused: false, commits: [c("green")] }).ok);
check("refuses red merged without yes", !deployable({ paused: false, commits: [c("green"), c("red")] }).ok);
check("deploys red with yes", deployable({ paused: false, commits: [c("red", ["owner-yes"])] }).ok);
check("refuses amber merged without OK", !deployable({ paused: false, commits: [c("amber")] }).ok);
check("refuses a push without a pull request", !deployable({ paused: false, commits: [c("green", [], null)] }).ok);
check("refuses when paused", !deployable({ paused: true, commits: [c("green")] }).ok);

const comments = [
  { body: `<!-- mm-review verdict=block sha=${SHA.slice(0, 12)} -->`, created_at: "1" },
  { body: `<!-- mm-review verdict=pass sha=${SHA} raise=amber -->`, created_at: "2" },
  { body: `<!-- mm-review verdict=pass sha=ffffffffffff -->`, created_at: "3" },
];
const r = reviewFor(comments, SHA);
check("the newest review of this commit counts", r?.verdict === "pass" && r.raise === "amber", JSON.stringify(r));
check("a review of another commit does not", reviewFor([comments[2]], SHA) === null);

console.log(failed ? `${failed} failed` : "all gate checks passed");
process.exit(failed ? 1 : 0);
