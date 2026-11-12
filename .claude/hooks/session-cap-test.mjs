// Checks for .claude/hooks/session-cap.mjs: at most 3 builders running that one session started.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAP, decide, runningBuilders } from "./session-cap.mjs";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ": " + detail : ""}`);
  if (!ok) failed++;
};
const NOW = Date.parse("2026-11-11T12:00:00Z");
const at = (h) => new Date(NOW - h * 3600 * 1000).toISOString();
let n = 0;
// One tool call and its result, as two transcript lines.
const call = (name, input, result, hoursAgo = 1) => {
  const id = `toolu_${++n}`;
  return [
    JSON.stringify({ type: "assistant", timestamp: at(hoursAgo), message: { content: [{ type: "tool_use", id, name, input }] } }),
    JSON.stringify({
      type: "user",
      timestamp: at(hoursAgo),
      message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: result }] }] },
    }),
  ];
};
const create = (sid, title = "Builder", hoursAgo = 1, extra = {}) =>
  call("mcp__claude-code-remote__create_session", { title, ...extra }, JSON.stringify({ id: sid, status: "running" }), hoursAgo);
const status = (sid, bucket, hoursAgo = 0.5) =>
  call("mcp__claude-code-remote__get_session", { session_id: sid }, JSON.stringify({ ccr: { id: sid, status_bucket: bucket } }), hoursAgo);
const archive = (sid) => call("mcp__claude-code-remote__archive_session", { session_id: sid }, "archived");
const hook = (lines, tool_input = { title: "Builder 4" }) => decide({ tool_input, transcript_path: "t" }, () => lines, NOW);
const three = [...create("session_A"), ...create("session_B"), ...create("session_C")];

check("the cap is 3", CAP === 3);
check("two running builders: a third starts", hook([...create("session_A"), ...create("session_B")]) === null);
const denied = hook(three);
check(
  "three running builders: a fourth is denied, naming them",
  denied?.hookSpecificOutput?.permissionDecision === "deny" && /session_A.*session_B.*session_C/.test(denied.hookSpecificOutput.permissionDecisionReason),
  JSON.stringify(denied),
);
check("a reviewer is never capped", hook(three, { title: "Review #120" }) === null);
check("a reviewer tagged as one is never capped", hook(three, { title: "Check", tags: ["reviewer"] }) === null);
check("reviewers it started are not counted", hook([...create("session_A"), ...create("session_B"), ...create("session_R", "Review #12")]) === null);
check("an archived builder is not counted", hook([...three, ...archive("session_B")]) === null);
check("a builder read as completed is not counted", hook([...three, ...status("session_C", "SESSION_STATUS_BUCKET_COMPLETED")]) === null);
check("one waiting for review (review_ready) is not counted", hook([...three, ...status("session_C", "review_ready")]) === null);
check("one read as working still counts", hook([...three, ...status("session_C", "SESSION_STATUS_BUCKET_WORKING")]) !== null);
check(
  "the newest status wins: done, then working again, counts",
  hook([...three, ...status("session_C", "review_ready", 0.8), ...status("session_C", "SESSION_STATUS_BUCKET_WORKING", 0.2)]) !== null,
);
check(
  "a status in a list_sessions result is read too",
  hook([
    ...three,
    ...call("mcp__claude-code-remote__list_sessions", {}, JSON.stringify({ sessions: [{ id: "session_A", status_bucket: "SESSION_STATUS_BUCKET_FAILED" }] })),
  ]) === null,
);
check(
  "a builder started over 24 h ago with nothing read since is not counted",
  hook([...create("session_A", "x", 30), ...create("session_B"), ...create("session_C")]) === null,
);
check(
  "a create_session that failed starts nothing",
  runningBuilders(
    [
      JSON.stringify({
        type: "assistant",
        timestamp: at(1),
        message: { content: [{ type: "tool_use", id: "x", name: "mcp__claude-code-remote__create_session", input: {} }] },
      }),
      JSON.stringify({
        type: "user",
        timestamp: at(1),
        message: { content: [{ type: "tool_result", tool_use_id: "x", is_error: true, content: "session_Z refused" }] },
      }),
    ],
    NOW,
  ).length === 0,
);
check("garbage lines are skipped", hook(["not json", ...three]) !== null);
check("no transcript to read: the call goes through", decide({ tool_input: {}, transcript_path: "/nonexistent" }, undefined, NOW) === null);

// The hook as Claude Code runs it.
const dir = mkdtempSync(join(tmpdir(), "mm-cap-"));
try {
  const path = join(dir, "t.jsonl");
  // Fresh timestamps: the script uses the real clock.
  const fresh = (sid) => [
    JSON.stringify({
      type: "assistant",
      timestamp: new Date().toISOString(),
      message: { content: [{ type: "tool_use", id: sid, name: "mcp__claude-code-remote__create_session", input: { title: sid } }] },
    }),
    JSON.stringify({
      type: "user",
      timestamp: new Date().toISOString(),
      message: { content: [{ type: "tool_result", tool_use_id: sid, content: [{ type: "text", text: `{"id":"${sid}"}` }] }] },
    }),
  ];
  writeFileSync(path, [...fresh("session_1"), ...fresh("session_2"), ...fresh("session_3")].join("\n"));
  const run = (stdin) => spawnSync(process.execPath, [".claude/hooks/session-cap.mjs"], { input: stdin, encoding: "utf8" });
  const r = run(JSON.stringify({ tool_name: "mcp__claude-code-remote__create_session", tool_input: { title: "Builder" }, transcript_path: path }));
  check("the hook prints a deny decision", r.status === 0 && JSON.parse(r.stdout).hookSpecificOutput.permissionDecision === "deny", r.stdout + r.stderr);
  const q = run(JSON.stringify({ tool_name: "mcp__claude-code-remote__create_session", tool_input: { title: "Review #1" }, transcript_path: path }));
  check("the hook says nothing for a reviewer", q.status === 0 && q.stdout === "");
  const bad = run("not json");
  check("unreadable input: nothing to count, the hook says nothing", bad.status === 0 && bad.stdout === "");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failed) {
  console.log(`\n${failed} session cap checks failed`);
  process.exit(1);
}
console.log("all session cap checks passed");
