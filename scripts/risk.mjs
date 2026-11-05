// 4.5.2: the risk class of a change, read from its diff (docs/DAILY.md, "Risk classes").
//
//   green  merges itself once CI, the preview smoke test and the independent review pass
//   amber  waits for the owner's OK in the morning brief, never merged by default
//   red    waits for the owner's explicit yes, named for that pull request
//
// The class is the highest of every rule that matches. The reviewer may raise a
// class, never lower it. CI runs main's copy of this file on each pull request,
// so a pull request cannot classify itself (and changing this file is red).
//
//   node scripts/risk.mjs [--base origin/main] [--head HEAD] [--branch <name>] [--json]
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Tables that hold what players made or who they are (migrations/).
const PLAYER_TABLES = [
  "invites",
  "progress",
  "credentials",
  "sessions",
  "auth_challenges",
  "account_links",
  "activity",
  "casts",
  "votes",
  "suggestions",
  "suggestion_votes",
  "challenge_wins",
  "reports",
  "refusals",
  "perf",
  "spend",
  "reservations",
  "daily_challenges",
];
const ORACLE_CALL =
  /\b(?:oracle|trial|this\.oracle|env\.oracle)\.(merge|describe|trim|chronicle|tiers|spell|repair|judge|intents|design|submitBatch|submitWonders|sortItems)\(/g;
const MODEL_ID = /claude-(?:opus|sonnet|haiku|fable)-\d/;
const SECRET =
  /sk-ant-[a-z0-9]{2,}-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:ADMIN_TOKEN|MM_TOKEN|CLOUDFLARE_API_TOKEN)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/;
const ROW_REWRITE =
  /\b(UPDATE|DELETE\s+FROM|DROP\s+TABLE|DROP\s+COLUMN|ALTER\s+TABLE\s+\w+\s+(?:RENAME|DROP)|INSERT\s+(?:OR\s+\w+\s+)?INTO\s+\w+(?:\s*\([^)]*\))?\s+SELECT|REPLACE\s+INTO)\b/i;
const WRITE_PLAYERS = new RegExp(`\\b(?:UPDATE|DELETE\\s+FROM)\\s+(${PLAYER_TABLES.join("|")})\\b`, "i");

const any = (paths) => (f) => paths.some((p) => (p.endsWith("/") ? f.path.startsWith(p) : f.path === p));
const added = (f, re) => f.added.filter((l) => re.test(l));
const count = (lines, re) => lines.reduce((n, l) => n + (l.match(re)?.length ?? 0), 0);
const isCode = (f) => /^(worker|src|shared)\//.test(f.path);

// Each rule: an id the docs cite, its class, what it protects, and a test on one changed file
// (or, with `pr`, on the pull request as a whole). The table in docs/DAILY.md lists the same ids;
// scripts/risk-test.mjs fails when they drift apart.
export const RULES = [
  // Red: money.
  {
    id: "R1",
    cls: "red",
    what: "wrangler.jsonc: budgets, caps, models, crons, bindings, routes and domains, the staging database",
    file: any(["wrangler.jsonc"]),
  },
  {
    id: "R2",
    cls: "red",
    what: "the paid calls, their prompts and the spend ledger (worker/oracle.ts, worker/prompts.ts, worker/ledger.ts)",
    file: any(["worker/oracle.ts", "worker/prompts.ts", "worker/ledger.ts"]),
  },
  {
    id: "R3",
    cls: "red",
    what: "a new call to Claude somewhere in the Worker (more oracle calls added than removed in a file)",
    file: (f) => f.path.startsWith("worker/") && count(f.added, ORACLE_CALL) > count(f.removed, ORACLE_CALL),
  },
  { id: "R4", cls: "red", what: "a Claude model named in code", file: (f) => isCode(f) && added(f, MODEL_ID).length > 0 },
  // Red: players' data.
  {
    id: "R5",
    cls: "red",
    what: "a migration that changes or deletes existing rows or columns, or edits a migration already applied",
    file: (f) => f.path.startsWith("migrations/") && (f.status !== "A" || added(f, ROW_REWRITE).length > 0),
  },
  {
    id: "R6",
    cls: "red",
    what: "accounts, passkeys, sessions, sign in, export and deletion",
    file: any(["worker/accounts.ts", "src/account.ts", "src/session.ts", "shared/account.ts"]),
  },
  { id: "R7", cls: "red", what: "what leaves production for staging (scripts/staging-copy.mjs)", file: any(["scripts/staging-copy.mjs"]) },
  {
    id: "R8",
    cls: "red",
    what: "a script line that writes the live database (--remote without SELECT)",
    file: (f) => /^(scripts\/|package\.json$)/.test(f.path) && f.added.some((l) => /--remote/.test(l) && !/\bSELECT\b/i.test(l) && !/^\s*(\/\/|#|\*)/.test(l)),
  },
  // Red: spells in bulk.
  {
    id: "R9",
    cls: "red",
    what: "PROGRAM_VERSION or the refresh of the library (shared/version.ts, scripts/refresh-runner.ts)",
    file: any(["shared/version.ts", "scripts/refresh-runner.ts"]),
  },
  // Red: going public.
  {
    id: "R10",
    cls: "red",
    what: 'the invite gate taken out (fewer "invite" refusals in the Worker than before: code: "invite")',
    file: (f) => f.path.startsWith("worker/") && count(f.removed, /code: "invite"/g) > count(f.added, /code: "invite"/g),
  },
  // Red: the pipeline and its rules (credentials, what may merge and deploy).
  {
    id: "R11",
    cls: "red",
    what: "CI, deploys and secrets (.github/), the agreements (CLAUDE.md, .claude/), the rules (docs/DAILY.md, docs/FEEDBACK.md, docs/REVIEWER.md) and their checks (scripts/risk.mjs, scripts/gate.mjs, scripts/smoke.mjs, the deploy error check and the loop metrics, with their tests)",
    file: any([
      ".github/",
      ".claude/",
      "CLAUDE.md",
      "docs/DAILY.md",
      "docs/FEEDBACK.md",
      "docs/REVIEWER.md",
      "scripts/risk.mjs",
      "scripts/risk-test.mjs",
      "scripts/gate-test.mjs",
      "scripts/gate.mjs",
      "scripts/smoke.mjs",
      "scripts/live-signals.mjs",
      "scripts/loop-metrics.mjs",
    ]),
  },
  {
    id: "R12",
    cls: "red",
    what: 'the owner\'s decisions: "Decisions taken" in docs/ROADMAP.md, "Declined" in docs/IDEAS.md',
    file: (f) =>
      (f.path === "docs/ROADMAP.md" && f.sections.some((s) => /^decisions taken/i.test(s))) ||
      (f.path === "docs/IDEAS.md" && f.sections.some((s) => /^declined/i.test(s))),
  },
  { id: "R13", cls: "red", what: "a secret written in the diff", file: (f) => added(f, SECRET).length > 0 },
  // Amber: one tap from the owner.
  {
    id: "A1",
    cls: "amber",
    what: "a new migration that only adds (a table, a column, an index): a rollback cannot undo it",
    file: (f) => f.path.startsWith("migrations/") && f.status === "A",
  },
  { id: "A2", cls: "amber", what: "dependencies and npm scripts (package.json, package-lock.json)", file: any(["package.json", "package-lock.json"]) },
  { id: "A3", cls: "amber", what: "code that updates or deletes rows of a players' table", file: (f) => isCode(f) && added(f, WRITE_PLAYERS).length > 0 },
  {
    id: "A4",
    cls: "amber",
    what: "how progress is saved and merged on the device (saves, sync, the two tab lock)",
    file: any(["src/device-save.ts", "src/sync.ts", "shared/sync.ts", "src/island-store.ts", "src/store.ts"]),
  },
  {
    id: "A5",
    cls: "amber",
    what: "the admin surface and the browser's guards (an /api/admin/ route added or changed, worker/http.ts, public/_headers)",
    file: (f) =>
      any(["worker/http.ts", "public/_headers"])(f) || (f.path.startsWith("worker/") && [...f.added, ...f.removed].some((l) => /\/api\/admin\//.test(l))),
  },
  {
    id: "A6",
    cls: "amber",
    what: "checks taken out of the tests (more check( calls removed than added)",
    file: (f) => /^scripts\/.*test.*\.(ts|mjs)$/.test(f.path) && count(f.removed, /\bcheck\(/g) > count(f.added, /\bcheck\(/g),
  },
  {
    id: "A7",
    cls: "amber",
    what: "a pull request from the Ideas tab's routine (players' words, docs/FEEDBACK.md)",
    pr: (pr) => /^claude\/feedback-/.test(pr.branch ?? ""),
  },
];

const ORDER = { green: 0, amber: 1, red: 2 };

/** files: [{ path, status: "A"|"M"|"D"|"R", added: string[], removed: string[], sections: string[] }] */
export function classify(files, pr = {}) {
  const hits = [];
  for (const rule of RULES) {
    if (rule.pr && rule.pr(pr)) hits.push({ rule: rule.id, cls: rule.cls, what: rule.what, file: null });
    if (!rule.file) continue;
    for (const f of files)
      if (rule.file({ sections: [], added: [], removed: [], ...f })) hits.push({ rule: rule.id, cls: rule.cls, what: rule.what, file: f.path });
  }
  const cls = hits.reduce((c, h) => (ORDER[h.cls] > ORDER[c] ? h.cls : c), "green");
  return { cls, hits };
}

// --- reading a git diff ---

/** Parses `git diff -U0 --no-color --no-renames` output into changed files with their lines. */
export function parseDiff(text) {
  const files = [];
  let f = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      f = { path: m ? m[2] : line.slice(11), status: "M", added: [], removed: [], hunks: [] };
      files.push(f);
    } else if (!f) continue;
    else if (line.startsWith("new file mode")) f.status = "A";
    else if (line.startsWith("deleted file mode")) f.status = "D";
    else if (line.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (m) f.hunks.push({ oldStart: +m[1], oldLines: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newLines: m[4] === undefined ? 1 : +m[4] });
    } else if (line.startsWith("+++") || line.startsWith("---")) continue;
    else if (line.startsWith("+")) f.added.push(line.slice(1));
    else if (line.startsWith("-")) f.removed.push(line.slice(1));
  }
  return files;
}

/** The "## " headings each hunk falls under, on either side, for the docs whose sections matter (R12). */
export function sectionsOf(hunks, oldText, newText) {
  const headingAt = (text, line) => {
    if (text == null) return null;
    const lines = text.split("\n");
    for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) if (/^##\s/.test(lines[i])) return lines[i].replace(/^#+\s*/, "");
    return null;
  };
  const out = new Set();
  for (const h of hunks) {
    for (let k = 0; k < Math.max(1, h.oldLines); k++) {
      const s = h.oldLines ? headingAt(oldText, h.oldStart + k) : headingAt(oldText, h.oldStart);
      if (s) out.add(s);
    }
    for (let k = 0; k < Math.max(1, h.newLines); k++) {
      const s = h.newLines ? headingAt(newText, h.newStart + k) : headingAt(newText, h.newStart);
      if (s) out.add(s);
    }
  }
  return [...out];
}

export function readGit(base, head, cwd = process.cwd()) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const show = (rev, path) => {
    try {
      return git("show", `${rev}:${path}`);
    } catch {
      return null;
    }
  };
  const mergeBase = git("merge-base", base, head).trim();
  const files = parseDiff(git("diff", "-U0", "--no-color", "--no-renames", "--no-ext-diff", mergeBase, head));
  for (const f of files) {
    f.sections = ["docs/ROADMAP.md", "docs/IDEAS.md"].includes(f.path) ? sectionsOf(f.hunks, show(mergeBase, f.path), show(head, f.path)) : [];
  }
  return files;
}

export function report({ cls, hits }) {
  const lines = [`Risk class: ${cls.toUpperCase()}`];
  if (!hits.length) lines.push("No rule matched: green once CI, the preview smoke test and the independent review pass.");
  const seen = new Map();
  for (const h of hits) {
    const key = h.rule;
    if (!seen.has(key)) seen.set(key, { ...h, files: [] });
    if (h.file) seen.get(key).files.push(h.file);
  }
  for (const h of [...seen.values()].sort((a, b) => ORDER[b.cls] - ORDER[a.cls]))
    lines.push(
      `- ${h.rule} (${h.cls}) ${h.what}${h.files.length ? `: ${h.files.slice(0, 6).join(", ")}${h.files.length > 6 ? ` and ${h.files.length - 6} more` : ""}` : ""}`,
    );
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : fallback;
  };
  const files = readGit(arg("base", "origin/main"), arg("head", "HEAD"));
  const result = classify(files, { branch: arg("branch", process.env.GITHUB_HEAD_REF ?? "") });
  if (process.argv.includes("--json")) console.log(JSON.stringify({ cls: result.cls, hits: result.hits }));
  else console.log(report(result));
}
