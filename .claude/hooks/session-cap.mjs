// PreToolUse hook for mcp__claude-code-remote__create_session (.claude/settings.json), next to
// session-guard.mjs. The cap on work in progress, in code (review of 10 November, section 4, "Stop" 2):
// a session may have at most 3 builders running that it started itself. A fourth create_session is
// denied with the list, so the caller first archives or waits for one that finished.
//
// What it counts, from the calling session's own transcript (the hook's transcript_path): every
// create_session it made that is not a reviewer (a title starting with "Review", or a "reviewer" tag),
// read from the call's result, less the ones it later archived (archive_session) and the ones whose
// newest status it read (get_session, list_sessions) is finished: completed, failed or review_ready.
// A session older than 24 hours with no status read since counts as finished.
//
// Limits, plainly: a hook cannot list sessions itself, so builders started by another session (a
// builder's own child, the director) are counted only by the session that started them. The planner
// starts the builders, so its cap is the project's cap. Without a readable transcript the cap cannot
// count and lets the call through; session-guard.mjs still decides what may start where.
//
//   reads the hook's JSON on stdin, prints {"hookSpecificOutput": ...} to deny
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CAP = 3;
const CREATE = "mcp__claude-code-remote__create_session";
const ARCHIVE = "mcp__claude-code-remote__archive_session";
const READS = new Set(["mcp__claude-code-remote__get_session", "mcp__claude-code-remote__list_sessions"]);
const DONE = /COMPLETED|FAILED|REVIEW_READY|^completed$|^failed$|^review_ready$/;
const DAY = 24 * 3600 * 1000;

/** Whether a create_session input starts a reviewer, which the cap does not count. */
export const isReviewer = (input) => /^\s*review/i.test(String(input?.title ?? "")) || (Array.isArray(input?.tags) && input.tags.includes("reviewer"));

const textOf = (content) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (typeof c?.text === "string" ? c.text : "")).join("\n") : "";

/** Every object with a session id and a status bucket, anywhere in a parsed JSON value. */
function statuses(value, out = []) {
  if (Array.isArray(value)) for (const v of value) statuses(v, out);
  else if (value && typeof value === "object") {
    const id = typeof value.id === "string" && value.id.startsWith("session_") ? value.id : null;
    const bucket = value.status_bucket ?? value.session_status ?? value.status;
    if (id && typeof bucket === "string") out.push({ id, bucket });
    for (const v of Object.values(value)) statuses(v, out);
  }
  return out;
}

/**
 * The builders this transcript's session started and that still run, oldest first.
 * lines: the transcript's JSONL lines; now: ms. Returns [{ id, title, at }].
 */
export function runningBuilders(lines, now = Date.now()) {
  const calls = new Map(); // tool_use id -> { name, input, at }
  const started = new Map(); // session id -> { id, title, at, done }
  for (const line of lines) {
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const at = Date.parse(d?.timestamp ?? "") || now;
    for (const c of Array.isArray(d?.message?.content) ? d.message.content : []) {
      if (c?.type === "tool_use") calls.set(c.id, { name: c.name, input: c.input ?? {}, at });
      if (c?.type !== "tool_result") continue;
      const call = calls.get(c.tool_use_id);
      if (!call || c.is_error) continue;
      const text = textOf(c.content);
      if (call.name === CREATE && !isReviewer(call.input)) {
        const id = /"id"\s*:\s*"(session_[A-Za-z0-9]+)"/.exec(text)?.[1] ?? /\b(session_[A-Za-z0-9]+)\b/.exec(text)?.[1];
        if (id) started.set(id, { id, title: String(call.input.title ?? ""), at: call.at, seen: call.at, done: false });
      } else if (call.name === ARCHIVE && started.has(call.input.session_id)) {
        started.get(call.input.session_id).done = true;
      } else if (READS.has(call.name)) {
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
        for (const s of statuses(parsed)) {
          const b = started.get(s.id);
          if (b) Object.assign(b, { done: DONE.test(s.bucket), seen: at });
        }
      }
    }
  }
  return [...started.values()].filter((b) => !b.done && now - b.seen < DAY).sort((a, b) => a.at - b.at);
}

/** The hook's answer for one create_session call, or null when it may run. */
export function decide(input, readLines = (p) => readFileSync(p, "utf8").split("\n"), now = Date.now()) {
  if (isReviewer(input?.tool_input)) return null;
  let lines;
  try {
    lines = readLines(input?.transcript_path);
  } catch {
    return null; // nothing to count; session-guard.mjs still applies
  }
  const running = runningBuilders(lines, now);
  if (running.length < CAP) return null;
  const list = running.map((b) => `${b.id}${b.title ? ` (${b.title})` : ""}`).join(", ");
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `At most ${CAP} builders at once (docs/DAILY.md, "Usage guard"), and this session's ${running.length} still run: ${list}. Check them with get_session, archive_session one that finished, then start this one.`,
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let input = null;
  try {
    input = JSON.parse(raw);
  } catch {
    input = null;
  }
  const out = input ? decide(input) : null;
  if (out) process.stdout.write(JSON.stringify(out));
}
