// Checks for scripts/session-guard.mjs: which create_session calls ask the owner.
import { spawnSync } from "node:child_process";
import { askReason } from "./session-guard.mjs";

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed++;
};
const call = (tool_input) => ({ tool_name: "mcp__claude-code-remote__create_session", tool_input });
const repo = "https://github.com/angelus76300-afk/magic-merger";

check("a child on this repository's main runs without a prompt", askReason(call({ source_url: repo, prompt: "x", title: "Review #1" })) === null);
check("main named, or .git at the end, runs too", askReason(call({ source_url: `${repo}.git`, source_revision: "main" })) === null);
check(
  "a child on another branch asks (it would load that branch's settings)",
  /branch other than main/.test(askReason(call({ source_url: repo, source_revision: "claude/x" }))),
);
check("another repository asks", /another repository/.test(askReason(call({ source_url: "https://github.com/someone/fork" }))));
check("a look-alike repository name asks", askReason(call({ source_url: `${repo}-evil` })) !== null);
check("no repository asks", askReason(call({})) !== null);
check("pushing straight to a branch asks", /pushes straight/.test(askReason(call({ source_url: repo, outcome_branch: "main" }))));
check("another environment asks", /another environment/.test(askReason(call({ source_url: repo, environment_id: "env_x" }))));

const run = (stdin) => spawnSync(process.execPath, ["scripts/session-guard.mjs"], { input: stdin, encoding: "utf8" });
const asked = run(JSON.stringify(call({ source_url: repo, source_revision: "evil" })));
check("the hook prints an ask decision", asked.status === 0 && JSON.parse(asked.stdout).hookSpecificOutput.permissionDecision === "ask");
const quiet = run(JSON.stringify(call({ source_url: repo })));
check("the hook says nothing for a child on main", quiet.status === 0 && quiet.stdout === "");
const broken = run("not json");
check("unreadable input asks", broken.status === 0 && JSON.parse(broken.stdout).hookSpecificOutput.permissionDecision === "ask");

if (failed) {
  console.log(`\n${failed} session guard checks failed`);
  process.exit(1);
}
console.log("all session guard checks passed");
