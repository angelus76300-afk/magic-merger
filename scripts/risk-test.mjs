// Checks for the risk classes (scripts/risk.mjs, docs/DAILY.md "Risk classes"):
// each rule on a diff that should match it and one that should not, the
// highest class winning, and the table in DAILY.md listing every rule.
//   npm run test:risk
import { readFileSync } from "node:fs";
import { classify, parseDiff, RULES, sectionsOf } from "./risk.mjs";
import { FRAME_SIZES, SIZES } from "./sizes.mjs";

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

check("R3 a call through writeWith", rules([file("worker/index.ts", ["const p = await writeWith(env, oracle, m, e, (w) => w.spell(request));"])]) === "R3");
check("R3 a call on oracleFor(...)", cls([file("worker/daily.ts", ["await oracleFor(env, {}, ledger).submitBatch(items);"])]) === "red");
check("R3 the API called directly", rules([file("worker/x.ts", ['await fetch("https://api.anthropic.com/v1/messages", init);'])]) === "R3");
check("R4 a model id reflowed is not new", rules([file("worker/x.ts", ['  "claude-haiku-5-5",'], ['"claude-haiku-5-5",'])]) === "");
check(
  "R14 a budget default in code",
  rules([file("worker/index.ts", ["  return Number(env.BUDGET_USD ?? 500);"], ["  return Number(env.BUDGET_USD ?? 50);"])]) === "R14",
);
check(
  "R14 a change inside spellModelFor",
  rules([file("worker/index.ts", ["  return env.SPELL_MODEL;"], [], { contexts: ["function spellModelFor(env: Env, tier: Tier): string {"] })]) === "R14",
);
check("R14 the burst guard", rules([file("worker/x.ts", ["ledger.burstFree = true;"])]) === "R14");
check(
  "R6 authenticate in worker/index.ts",
  rules([
    file("worker/index.ts", ["return { admin: false, payer: GUEST };"], [], {
      contexts: ["async function authenticate(request: Request, env: Env): Promise<Who | Response> {"],
    }),
  ]) === "R6",
);
check(
  "R9 a bulk update of spells",
  rules([file("worker/x.ts", ["UPDATE spells SET pid = (SELECT MAX(id) FROM programs p WHERE p.key = spells.key)"])]) === "R9",
);
check("R9 FIRST_PROGRAM_VERSION", rules([file("shared/spellcode.ts", ["export const FIRST_PROGRAM_VERSION = 3;"])]) === "R9");
check("R9 the one spell rewrite tool", rules([file("scripts/rewrite-one.mjs", ["for (const name of names)"])]) === "R9");
check("R9 the refresh started from elsewhere", rules([file("worker/cron.ts", ["await startRefresh(env, oracle, { limit: 5000 });"])]) === "R9");
check("R9 programs rewritten by a range", rules([file("worker/x.ts", ["UPDATE programs SET code = ?, version = ? WHERE version < ?"])]) === "R9");
check("R9 a WHERE that is always true", rules([file("worker/x.ts", ["DELETE FROM spells WHERE 1 = 1"])]) === "R9");
check("R9 the rewrites' history deleted", rules([file("worker/x.ts", ["DELETE FROM rewrites"])]) === "R9");
check("R9 one program by id is not bulk", rules([file("worker/x.ts", ["UPDATE programs SET code = ? WHERE id = ?"])]) === "");
check("R14 a share of the month", rules([file("worker/ahead.ts", ["const AHEAD_MONTH_SHARE = 1;"], ["const AHEAD_MONTH_SHARE = 0.8;"])]) === "R14");
check("R14 a count per day", rules([file("worker/wonders.ts", ["const SORT_PER_DAY = 2500;"], ["const SORT_PER_DAY = 25;"])]) === "R14");
check("R14 a count per run", rules([file("worker/x.ts", ["const INTENTS_PER_RUN = 2500;"])]) === "R14");
check("R14 the repairs' limit", rules([file("worker/x.ts", ["const MAX_REPAIRS = 30;"])]) === "R14");
check("a game constant in shared is not money", rules([file("shared/elements.ts", ["export const MAX_TIER = 6;"])]) === "");
check("R11 .gitattributes", rules([file(".gitattributes", ["worker/** -diff"])]) === "R11");

// Amber, one per rule.
check(
  "A1 an additive migration",
  rules([file("migrations/0017_attempts.sql", ["CREATE TABLE attempts (job TEXT, at INTEGER);"], [], { status: "A" })]) === "A1",
);
check("A2 a dependency", rules([file("package.json", ['"left-pad": "1.0.0",'])]) === "A2");
check("A3 code deleting players' rows", rules([file("worker/community.ts", ["await db.prepare('DELETE FROM votes WHERE id = ?')"])]) === "A3");
check("A3 updating one program is not players' rows", rules([file("worker/programs.ts", ["UPDATE programs SET status = 'live' WHERE id = ?"])]) === "");
check(
  "A3 a players' delete moved is not new",
  rules([file("worker/community.ts", ["  DELETE FROM votes WHERE id = ?"], ["DELETE FROM votes WHERE id = ?"])]) === "",
);
check("A3 a table named at run time", rules([file("worker/x.ts", ["await db.prepare(`DELETE FROM ${t} WHERE at < ?`)"])]) === "A3");
check("A3 INSERT OR REPLACE into progress", rules([file("worker/x.ts", ["INSERT OR REPLACE INTO progress (id) VALUES (?)"])]) === "A3");
check("A3 the shared library", rules([file("worker/x.ts", ["DELETE FROM recipes WHERE a = ?"])]) === "A3");
check("A4 saves", rules([file("src/device-save.ts", ["const KEYS = [];"])]) === "A4");
check("A5 an admin route", rules([file("worker/index.ts", ['if (url.pathname === "/api/admin/new")'])]) === "A5");
check("A5 the headers", rules([file("public/_headers", ["  X-Frame-Options: SAMEORIGIN"])]) === "A5");
check("A6 checks taken out", rules([file("scripts/worker-test.mjs", [], ['check("the cap holds", ok);'])]) === "A6");
check("A6 an exit at the top of a test", rules([file("scripts/worker-test.mjs", ["process.exit(0);"])]) === "A6");
check("A6 an exit that can no longer fail", rules([file("scripts/sim-test.ts", ["process.exit(0);"], ["process.exit(failures ? 1 : 0);"])]) === "A6");
check("A6 the failure count taken out of check", rules([file("scripts/worker-test.mjs", [], ["  if (!ok) failures++;"])]) === "A6");
check("A6 the failure count reset", rules([file("scripts/worker-test.mjs", ["failures = 0;"])]) === "A6");
check(
  "A6 a test variable named failed is not a failure count",
  rules([file("scripts/sim-test.ts", ["  const failed = await cronJobs({});", 'check("cron", failed === 0);'])]) === "",
);
check(
  "A6 a line git labels as inside the helper is not the helper",
  rules([file("scripts/worker-test.mjs", ["async function api(path, init) {"], [], { contexts: ["const check = (name, ok, detail) => {"] })]) === "",
);
check("R9 an OR that widens a WHERE", rules([file("worker/x.ts", ["DELETE FROM spells WHERE id = ? OR 1 = 1"])]) === "R9");
check("R9 an or inside a string is not an OR", rules([file("worker/x.ts", ["UPDATE programs SET status = 'win or lose' WHERE id = ?"])]) === "");
check(
  "A6 the check helper changed",
  rules([file("scripts/sim-test.ts", ["const check = () => undefined;"], ["const check = (name, ok) => { if (!ok) failed++; };"])]) === "A6",
);
check("A7 the Ideas routine", rules([file("src/craft.ts", ["x"])], { branch: "claude/feedback-12" }) === "A7");
check("A7 the routine's title on another branch", rules([file("src/craft.ts", ["x"])], { branch: "claude/brave-x", title: "Feedback: bigger chips" }) === "A7");
check("A8 a scheduled runner", rules([file("scripts/judge-runner.mjs", ["x"])]) === "A8");
check("A8 the build config", rules([file("vite.config.ts", ["x"])]) === "A8");
check("A8 a script calling an admin route", rules([file("scripts/lab.mjs", ['await api("/api/admin/refresh", { limit: 200 });'])]) === "A8");

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
const tricky = parseDiff(
  [
    "diff --git a/worker/a b/c.ts b/worker/a b/c.ts",
    "--- a/worker/a b/c.ts",
    "+++ b/worker/a b/c.ts",
    "@@ -1,0 +2 @@ async function authenticate(request: Request, env: Env) {",
    '+++count; await oracle.merge(a, b); const m = "claude-opus-5-5";',
    "@@ -9 +9,0 @@",
    "--- an old SQL comment",
  ].join("\n"),
);
check("a path with a space and b/ in it", tricky[0].path === "worker/a b/c.ts", tricky[0].path);
const spaced = parseDiff(["diff --git a/worker/x y.ts b/worker/x y.ts", "--- a/worker/x y.ts\t", "+++ b/worker/x y.ts\t", "@@ -1 +1 @@", "+x"].join("\n"));
check("the tab git adds after a spaced path is dropped", spaced[0].path === "worker/x y.ts", JSON.stringify(spaced[0].path));
const quoted = parseDiff(
  ['diff --git "a/worker/a\\"b.ts" "b/worker/a\\"b.ts"', '--- "a/worker/a\\"b.ts"', '+++ "b/worker/a\\"b.ts"', "@@ -1 +1 @@", "+x"].join("\n"),
);
check("a quoted path is unquoted", quoted[0].path === 'worker/a"b.ts', JSON.stringify(quoted[0].path));
check("an added line that starts with ++ is kept", tricky[0].added.length === 1 && tricky[0].added[0].startsWith("++count"));
check("a removed line that starts with -- is kept", tricky[0].removed.length === 1);
check("the hunk's function is kept", tricky[0].contexts[0]?.startsWith("async function authenticate"));
check("so that file is red", cls(tricky) === "red");
const doc = "# Roadmap\n\n## Done\n\n## Decisions taken\n1. old decision\n\n## Next versions\n";
check(
  "a line under Decisions taken is found there",
  sectionsOf([{ oldStart: 6, oldLines: 1, newStart: 6, newLines: 1 }], doc, doc).includes("Decisions taken"),
);
check("a line under Next versions is not", !sectionsOf([{ oldStart: 8, oldLines: 1, newStart: 8, newLines: 1 }], doc, doc).includes("Decisions taken"));

// A9, A10: what stored spells and saved islands depend on (2026-11-10 review, section 2, point 1).
check("A9 an API entry removed", rules([file("scripts/api-surface.json", [], ['      "burnVoxels",'])]) === "A9");
check("A9 an API entry renamed", rules([file("scripts/api-surface.json", ['      "burnVoxel",'], ['      "burnVoxels",'])]) === "A9");
check(
  "A9 an option key removed from a one line list",
  rules([file("scripts/api-surface.json", ['  "SpellApi.burst(o)": ["color", "count"],'], ['  "SpellApi.burst(o)": ["color", "count", "drag"],'])]) === "A9",
);
check("A9 the snapshot deleted", rules([file("scripts/api-surface.json", [], ['{"members": {}}'], { status: "D" })]) === "A9");
check("A9 an entry added stays green", rules([file("scripts/api-surface.json", ['      "bloom",'], [])]) === "");
check(
  "A9 an entry added after the last one of a list stays green",
  rules([file("scripts/api-surface.json", ['      "zap",', '      "zip"'], ['      "zap"'])]) === "",
);
check(
  "A9 a list reflowed or reindented stays green",
  rules([file("scripts/api-surface.json", ['    "BodyHandle": ["age",', '      "alive"],'], ['    "BodyHandle": ["age", "alive"],'])]) === "",
);
check("A10 save.ts", rules([file("src/sim/save.ts", ["const SAVE_VERSION = 9;"], ["const SAVE_VERSION = 8;"])]) === "A10");
check("A10 a golden save edited", rules([file("lab/saves/island-2026-11-11.json", ['{"commit":"x"}'], ['{"commit":"y"}'])]) === "A10");
check("A10 a golden save deleted", rules([file("lab/saves/island-2026-11-11.json", [], ['{"commit":"y"}'], { status: "D" })]) === "A10");
check("A10 a new golden save stays green", rules([file("lab/saves/island-2027-01-01.json", ['{"commit":"z"}'], [], { status: "A" })]) === "");
{
  const mat = (ground, fluid = ['make("none", "fluid", [0]),']) =>
    `export const BUILTIN = {\n  ground: [\n${ground.map((n) => `    make("${n}", "ground", [1]),`).join("\n")}\n  ],\n  fluid: [\n${fluid.map((l) => `    ${l}`).join("\n")}\n  ],\n};\n`;
  const old = mat(["grass", "dirt", "sand"]);
  const edit = (newText, added, removed) => file("src/sim/materials.ts", added, removed, { oldText: old, newText });
  check("A10 a material inserted in the middle", rules([edit(mat(["grass", "dirt", "clay", "sand"]), ['    make("clay", "ground", [1]),'], [])]) === "A10");
  check(
    "A10 a material renamed",
    rules([edit(mat(["grass", "mud", "sand"]), ['    make("mud", "ground", [1]),'], ['    make("dirt", "ground", [1]),'])]) === "A10",
  );
  check(
    "A10 two materials swapped",
    rules([edit(mat(["grass", "sand", "dirt"]), ['    make("sand", "ground", [1]),'], ['    make("dirt", "ground", [1]),'])]) === "A10",
  );
  check("A10 a material removed", rules([edit(mat(["grass", "sand"]), [], ['    make("dirt", "ground", [1]),'])]) === "A10");
  check(
    "A10 a material added at the end of its layer stays green",
    rules([edit(mat(["grass", "dirt", "sand", "clay"]), ['    make("clay", "ground", [1]),'], [])]) === "",
  );
  check(
    "A10 a new material at the end of another layer stays green",
    rules([edit(mat(["grass", "dirt", "sand"], ['make("none", "fluid", [0]),', 'make("brine", "fluid", [2]),']), ['    make("brine", "fluid", [2]),'], [])]) ===
      "",
  );
  check(
    "A10 a colour or a property edited stays green",
    rules([edit(mat(["grass", "dirt", "sand"]), ['    make("dirt", "ground", [2], { flow: 1 }),'], ['    make("dirt", "ground", [1]),'])]) === "",
  );
  check(
    "A10 an edit outside the table stays green",
    rules([file("src/sim/materials.ts", ["export const F = {};"], ["export const F = { NONE: 0 };"], { oldText: old, newText: old })]) === "",
  );
  check("A10 without the file's text, a touched make( line counts", rules([file("src/sim/materials.ts", ['    make("clay", "ground", [1]),'], [])]) === "A10");
}

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

// 2026-11-10, "folds: yes": the sizes every check uses are one list, red like the checks, and the rule says them.
check("the sizes the checks use are red", cls([file("scripts/sizes.mjs", ["export const SIZES = [];"])]) === "red");
{
  const rule = readFileSync("CLAUDE.md", "utf8");
  const said = SIZES.filter((z) => rule.includes(`${z.width} by ${z.height}`));
  check(
    "CLAUDE.md names the five sizes of scripts/sizes.mjs, the Z Fold's two among them",
    SIZES.length === 5 && said.length === 5 && /five sizes/.test(rule) && SIZES.some((z) => z.width === 344) && SIZES.some((z) => z.width === 700),
    SIZES.filter((z) => !said.includes(z))
      .map((z) => `${z.width} by ${z.height}`)
      .join(", "),
  );
  check(
    "ui-frames takes every one of them by default",
    SIZES.every((z) => FRAME_SIZES.includes(`${z.width}x${z.height}${z.touch ? "t" : ""}`)),
  );
  for (const script of ["scripts/smoke.mjs", "scripts/ui-frames.mjs", "scripts/nightly-play.mjs"])
    check(`${script} reads its sizes from scripts/sizes.mjs`, /from "\.\/sizes\.mjs"/.test(readFileSync(script, "utf8")));
}

console.log(failed ? `${failed} failed` : "all risk checks passed");
process.exit(failed ? 1 : 0);
