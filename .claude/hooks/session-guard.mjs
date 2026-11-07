// PreToolUse hook for mcp__claude-code-remote__create_session (.claude/settings.json).
// create_session runs without a prompt (#57), but a child session loads the
// .claude/settings.json of the branch it starts on. A session could push a branch
// that allows itself anything and start a child there, or point a child at another
// repository, environment or branch to push to. Those calls ask the owner; a child
// on this repository's main branch, whose settings only the owner's yes changes,
// does not.
//
//   reads the hook's JSON on stdin, prints {"hookSpecificOutput": ...} to ask
import { pathToFileURL } from "node:url";

const REPO = "https://github.com/angelus76300-afk/magic-merger";

/** Why this create_session call must ask the owner, or null when it may run. */
export function askReason(input) {
  const t = input?.tool_input ?? {};
  if (t.source_url === undefined) return "a session with no repository";
  if (
    String(t.source_url)
      .replace(/\.git$/, "")
      .replace(/\/$/, "") !== REPO
  )
    return `another repository: ${t.source_url}`;
  if (t.source_revision !== undefined && t.source_revision !== "main")
    return `a branch other than main, whose .claude/settings.json the owner has not approved: ${t.source_revision}`;
  if (t.outcome_branch !== undefined) return `a session that pushes straight to a branch: ${t.outcome_branch}`;
  if (t.environment_id !== undefined) return `another environment: ${t.environment_id}`;
  return null;
}

export function decide(input) {
  const why = askReason(input);
  if (!why) return null;
  return {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: `create_session asks the owner here: ${why}` },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    // Unreadable input: ask, never let it through.
    input = { tool_input: {} };
  }
  const out = decide(input);
  if (out) process.stdout.write(JSON.stringify(out));
}
