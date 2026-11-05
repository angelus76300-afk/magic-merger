// Checks for the risk classes (scripts/risk.mjs, docs/DAILY.md "Risk classes"):
// each rule on a diff that should match it and one that should not, the
// highest class winning, and the table in DAILY.md listing every rule.
//   npm run test:risk
import { readFileSync } from "node:fs";
import { classify, parseDiff, RULES, sectionsOf } from "./risk.mjs";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ": " + detail : ""}`);
  if (!ok) failed++;
};
const file = (path, added = [], removed = [], extra = {}) => ({ path, status: "M", added, removed, sections: [], ...extra });
const cls = (files, pr) => classify(files, pr).cls;
const rules = (files, pr) => [...new Set(classify(files, pr).hits.map((h) => h.rule))].sort().join(",");

// Green: game code, docs, tests that grow.
check("a change to the simulation is green", cls([file("src/sim/creatures.ts", ["const speed = 2;"], ["const speed = 1;"])]) === "green");
check("docs outside the protected sections are green", cls([file("docs/IDEAS.md", ["- a new idea"], [], { sections: ["Ideas"] })]) === "green");
check("a test that gains checks is green", cls([file("scripts/sim-test.ts", ['check("x", true);'])]) === "green");
check("the changelog is green", cls([file("public/changelog.json", ['{"v":"4.5.2"}'])]) === "green");
check("reading PROGRAM_VERSION elsewhere is green", cls([file("worker/programs.ts", ["if (v < PROGRAM_VERSION) return;"])]) === "green");

// Red, one per rule.
check("R1 wrangler.jsonc", rules([file("wrangler.jsonc", ['"BUDGET_USD": "60",'], ['"BUDGET_USD": "48",'])]) === "R1");
check("R2 the prompts", rules([file("worker/prompts.ts", ["more words"])]) === "R2");
check("R2 the ledger", rules([file("worker/ledger.ts", ["const HOLD = 0.01;"])]) === "R2");
check("R3 a new oracle call", rules([file("worker/daily.ts", ["const d = await oracle.describe(name, kind, null);"])]) === "R3");
check(
  "R3 a call moved within a file is not new",
  rules([file("worker/daily.ts", ["  const d = await oracle.describe(n, k, null);"], ["const d = await oracle.describe(n, k, null);"])]) === "",
);
check("R4 a model named in code", rules([file("worker/index.ts", ['const model = "claude-opus-5-5";'])]) === "R4");
check("R5 a migration that updates rows", rules([file("migrations/0017_x.sql", ["UPDATE invites SET name = 'x';"], [], { status: "A" })]) === "A1,R5");
check("R5 an edited migration", rules([file("migrations/0003_tiers_programs_spend.sql", ["-- note"])]) === "R5");
check(
  "R5 a backfill INSERT ... SELECT",
  cls([file("migrations/0017_x.sql", ["INSERT INTO wins2 (id) SELECT id FROM challenge_wins;"], [], { status: "A" })]) === "red",
);
check("R6 accounts", rules([file("worker/accounts.ts", ["// x"])]) === "R6");
check("R7 the staging copy", rules([file("scripts/staging-copy.mjs", ["// keep emails"])]) === "R7");
check(
  "R8 a script writing the live database",
  rules([file("scripts/fix.mjs", ['run("npx wrangler d1 execute magic-merger --remote --command \\"DELETE FROM votes\\"")'])]) === "R8",
);
check(
  "R8 a script reading the live database is not red",
  rules([file("scripts/read.mjs", ['run("npx wrangler d1 execute magic-merger --remote --command \\"SELECT 1\\"")'])]) === "",
);
check("R9 PROGRAM_VERSION", rules([file("shared/version.ts", ["export const PROGRAM_VERSION = 7;"], ["export const PROGRAM_VERSION = 6;"])]) === "R9");
check(
  "R10 the invite gate removed",
  rules([file("worker/index.ts", [], ['    if (!payer) return json({ error: "Magic Merger is invite only.", code: "invite" }, 401);'])]) === "R10",
);
check(
  "R10 the gate's wording changed is not red",
  rules([
    file(
      "worker/index.ts",
      ['return json({ error: "Invite only, sorry.", code: "invite" }, 401);'],
      ['return json({ error: "Magic Merger is invite only.", code: "invite" }, 401);'],
    ),
  ]) === "",
);
check("R11 a workflow", rules([file(".github/workflows/ci.yml", ["- run: true"])]) === "R11");
check("R11 the classifier itself", rules([file("scripts/risk.mjs", ["// weaker"])]) === "R11");
check("R11 CLAUDE.md", rules([file("CLAUDE.md", ["merge anything"])]) === "R11");
check("R12 Decisions taken", rules([file("docs/ROADMAP.md", ["4. something"], [], { sections: ["Decisions taken"] })]) === "R12");
check("R12 Declined ideas", rules([file("docs/IDEAS.md", ["- hints, reopened"], [], { sections: ["Declined by the owner"] })]) === "R12");
check("R13 a secret", rules([file("src/x.ts", ['const k = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123";'])]) === "R13");

// Amber, one per rule.
check(
  "A1 an additive migration",
  rules([file("migrations/0017_attempts.sql", ["CREATE TABLE attempts (job TEXT, at INTEGER);"], [], { status: "A" })]) === "A1",
);
check("A2 a dependency", rules([file("package.json", ['"left-pad": "1.0.0",'])]) === "A2");
check("A3 code deleting players' rows", rules([file("worker/community.ts", ["await db.prepare('DELETE FROM votes WHERE id = ?')"])]) === "A3");
check("A3 updating programs is not players' rows", rules([file("worker/programs.ts", ["UPDATE programs SET status = 'live'"])]) === "");
check("A4 saves", rules([file("src/device-save.ts", ["const KEYS = [];"])]) === "A4");
check("A5 an admin route", rules([file("worker/index.ts", ['if (url.pathname === "/api/admin/new")'])]) === "A5");
check("A5 the headers", rules([file("public/_headers", ["  X-Frame-Options: SAMEORIGIN"])]) === "A5");
check("A6 checks taken out", rules([file("scripts/worker-test.mjs", [], ['check("the cap holds", ok);'])]) === "A6");
check("A7 the Ideas routine", rules([file("src/craft.ts", ["x"])], { branch: "claude/feedback-12" }) === "A7");

// The highest class wins.
check("red beats amber beats green", cls([file("src/craft.ts", ["x"]), file("package.json", ["y"]), file("wrangler.jsonc", ["z"])]) === "red");
check("amber beats green", cls([file("src/craft.ts", ["x"]), file("package-lock.json", ["y"])]) === "amber");

// The diff parser and the section finder.
const diff = [
  "diff --git a/migrations/0017_a.sql b/migrations/0017_a.sql",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/migrations/0017_a.sql",
  "@@ -0,0 +1,2 @@",
  "+CREATE TABLE a (x TEXT);",
  "+CREATE INDEX a_x ON a (x);",
  "diff --git a/docs/ROADMAP.md b/docs/ROADMAP.md",
  "--- a/docs/ROADMAP.md",
  "+++ b/docs/ROADMAP.md",
  "@@ -5 +5 @@",
  "-old decision",
  "+new decision",
].join("\n");
const parsed = parseDiff(diff);
check("the parser reads a new file", parsed[0].status === "A" && parsed[0].added.length === 2 && parsed[0].removed.length === 0);
check("the parser reads a hunk", parsed[1].hunks[0].oldStart === 5 && parsed[1].added[0] === "new decision");
const doc = "# Roadmap\n\n## Done\n\n## Decisions taken\n1. old decision\n\n## Next versions\n";
check(
  "a line under Decisions taken is found there",
  sectionsOf([{ oldStart: 6, oldLines: 1, newStart: 6, newLines: 1 }], doc, doc).includes("Decisions taken"),
);
check("a line under Next versions is not", !sectionsOf([{ oldStart: 8, oldLines: 1, newStart: 8, newLines: 1 }], doc, doc).includes("Decisions taken"));

// The rules the owner reads are the rules the script runs.
const daily = readFileSync("docs/DAILY.md", "utf8");
const table = daily.slice(daily.indexOf("## Risk classes"), daily.indexOf("\n## ", daily.indexOf("## Risk classes") + 5));
for (const rule of RULES) check(`docs/DAILY.md lists ${rule.id} as ${rule.cls}`, new RegExp(`\\|\\s*${rule.id}\\s*\\|\\s*${rule.cls}\\s*\\|`).test(table));
const listed = [...table.matchAll(/^\|\s*([RA]\d+)\s*\|/gm)].map((m) => m[1]);
check(
  "docs/DAILY.md lists no rule the script lacks",
  listed.every((id) => RULES.some((r) => r.id === id)),
  listed.join(","),
);

console.log(failed ? `${failed} failed` : "all risk checks passed");
process.exit(failed ? 1 : 0);
