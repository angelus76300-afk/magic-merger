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
  // What players discovered and built: the shared library and its history.
  "recipes",
  "elements",
  "recipe_history",
  "aliases",
  "challenge_solvers",
  "writes",
  "wonders",
  "wonder_sorts",
  "trims",
];
// A call that can reach Claude: an oracle method on any receiver the Worker uses for one, the
// helpers that make or wrap an oracle, or the API itself.
const ORACLE_CALL =
  /\b(?:oracle|trial|o|this\.oracle|env\.oracle|w)\.(merge|describe|trim|chronicle|tiers|spell|repair|judge|intents|design|submitBatch|submitWonders|sortItems)\(|\b(?:oracleFor|makeOracle|writeWith)\(|\)\.(?:merge|describe|spell|repair|judge|intents|design|submitBatch|submitWonders|sortItems|chronicle|tiers|trim)\(|api\.anthropic\.com|new Anthropic\(|messages\.(?:create|stream|batches\.create)\(/g;
// The money knobs that live in code: budgets, holds, caps and the choice of model.
const MONEY_FN =
  /\bfunction (?:oracleFor|makeOracle|budget|ensureBudget|writeWith|smallModel|refreshBudget|rewriteBudget|spellModelFor|wonderBudget|aheadCap|hold|sweep|spentBy)\b|\b(?:oracleFor|makeOracle|budget|ensureBudget|smallModel|refreshBudget|rewriteBudget|spellModelFor|wonderBudget|aheadCap)\s*\(|\b[A-Z_]*(?:_USD|_MODEL|_EFFORT|BUDGET|ESTIMATE|PRICES)\b|burstFree|\bhold\(/;
const MODEL_ID = /claude-(?:opus|sonnet|haiku|fable)-\d/;
const SECRET =
  /sk-ant-[a-z0-9]{2,}-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:ADMIN_TOKEN|MM_TOKEN|CLOUDFLARE_API_TOKEN)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/;
const ROW_REWRITE =
  /\b(UPDATE|DELETE\s+FROM|DROP\s+TABLE|DROP\s+COLUMN|ALTER\s+TABLE\s+\w+\s+(?:RENAME|DROP)|INSERT\s+(?:OR\s+\w+\s+)?INTO\s+\w+(?:\s*\([^)]*\))?\s+SELECT|REPLACE\s+INTO)\b/i;
const WRITE_PLAYERS = new RegExp(
  `\\b(?:UPDATE|DELETE\\s+FROM|REPLACE\\s+INTO|INSERT\\s+OR\\s+REPLACE\\s+INTO)\\s+(${PLAYER_TABLES.join("|")})\\b|\\b(?:UPDATE|DELETE\\s+FROM)\\s+\\$\\{`,
  "gi",
);
// The worker's own limits, in worker/ only (shared/ holds the game's MAX_ constants): a share,
// a cap or a count per day, run or month bounds what a night can spend.
const WORKER_LIMIT = /\b[A-Z][A-Z0-9_]*(?:_SHARE|_CAP|_LIMIT|PER_DAY|PER_RUN|PER_MONTH|PER_NIGHT)\b|\bMAX_(?:REPAIRS|RETRIES|TRIES|CALLS|BATCH\w*)\b/;
// Spells in bulk: an UPDATE or DELETE on the spells or their programs with no WHERE of its own
// (sub-queries and strings set aside) or a WHERE that is always true; a program's code or version
// rewritten by a range rather than by id; the rollback history of rewrites deleted.
const isBulkSpells = (line) => {
  if (/\bDELETE\s+FROM\s+(?:rewrites|refresh_verdicts)\b/i.test(line)) return true;
  const m = /\b(?:UPDATE|DELETE\s+FROM)\s+(?:spells|programs)\b(.*)$/i.exec(line);
  if (!m) return false;
  let rest = m[1].replace(/'[^']*'|"[^"]*"/g, "''");
  for (let i = 0; i < 5; i++) rest = rest.replace(/\([^()]*\)/g, "");
  const where = /\bWHERE\b(.*)$/i.exec(rest);
  if (!where) return true;
  if (/^\s*(?:1\s*=\s*1|1|TRUE)\b/i.test(where[1]) || /\bOR\b/i.test(where[1])) return true;
  if (/^\s*DELETE/i.test(line.slice(m.index))) return !/\b(?:id|pid|key)\s*=\s*\?/i.test(where[1]);
  return /\bSET\b[^]*\b(?:code|version)\s*=/i.test(rest) && !/\b(?:id|pid)\s*=\s*\?/i.test(where[1]);
};

const any = (paths) => (f) => paths.some((p) => (p.endsWith("/") ? f.path.startsWith(p) : f.path === p));
const added = (f, re) => f.added.filter((l) => re.test(l));
const count = (lines, re) => lines.reduce((n, l) => n + (l.match(re)?.length ?? 0), 0);
const isCode = (f) => /^(worker|src|shared)\//.test(f.path);
const touched = (f, re) => [...f.added, ...f.removed].some((l) => re.test(l));
// The function each hunk of a file starts in (git's hunk header), for code that lives in worker/index.ts.
const inFunction = (f, re) => (f.contexts ?? []).some((c) => re.test(c));

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
  {
    id: "R4",
    cls: "red",
    what: "a Claude model named in code (more model ids added than removed in a file)",
    file: (f) => isCode(f) && count(f.added, new RegExp(MODEL_ID.source, "g")) > count(f.removed, new RegExp(MODEL_ID.source, "g")),
  },
  {
    id: "R14",
    cls: "red",
    what: "the money knobs in code: budgets, holds, caps, prices and the choice of model (a touched line that names one, or a change inside oracleFor, makeOracle, budget, ensureBudget, writeWith, smallModel, refreshBudget, rewriteBudget, spellModelFor, wonderBudget), and in worker/ a limit per day, run or month, a share or a cap",
    file: (f) =>
      /^(worker|shared)\//.test(f.path) && (touched(f, MONEY_FN) || inFunction(f, MONEY_FN) || (f.path.startsWith("worker/") && touched(f, WORKER_LIMIT))),
  },
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
    what: "accounts, passkeys, sessions, sign in, export and deletion (and authenticate, handleAccount and sameSecret in worker/index.ts)",
    file: (f) =>
      any(["worker/accounts.ts", "src/account.ts", "src/session.ts", "shared/account.ts"])(f) ||
      (f.path === "worker/index.ts" &&
        (inFunction(f, /\bfunction (?:authenticate|handleAccount|sameSecret)\b/) || touched(f, /\bfunction (?:authenticate|handleAccount|sameSecret)\b/))),
  },
  { id: "R7", cls: "red", what: "what leaves production for staging (scripts/staging-copy.mjs)", file: any(["scripts/staging-copy.mjs"]) },
  {
    id: "R8",
    cls: "red",
    what: "a script line that writes the live database (--remote without SELECT)",
    file: (f) =>
      /^(scripts\/|package\.json$)/.test(f.path) &&
      f.added.some((l) => /--remote/.test(l) && !/\bSELECT\b/i.test(l) && !/--env staging|magic-merger-staging/.test(l) && !/^\s*(\/\/|#|\*)/.test(l)),
  },
  // Red: spells in bulk.
  {
    id: "R9",
    cls: "red",
    what: "spells in bulk: PROGRAM_VERSION or FIRST_PROGRAM_VERSION anywhere, the refresh of the library (shared/version.ts, scripts/refresh-runner.ts, startRefresh), the one spell rewrite tool (scripts/rewrite-one.mjs), an UPDATE or DELETE on spells or programs with no WHERE of its own, a WHERE that is always true or has an OR, code or version rewritten by a range, the rewrites history deleted",
    file: (f) =>
      any(["shared/version.ts", "scripts/refresh-runner.ts", "scripts/rewrite-one.mjs", "scripts/rewrite-one-test.mjs"])(f) ||
      added(f, /\b(?:FIRST_)?PROGRAM_VERSION\s*=/).length > 0 ||
      (/^(worker|scripts)\//.test(f.path) &&
        (touched(f, /\bstartRefresh\b|function refresh\w*\(/) || inFunction(f, /\bfunction (?:startRefresh|refresh\w*)\b/) || f.added.some(isBulkSpells))),
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
    what: "CI, deploys and secrets (.github/, .gitattributes), the agreements (CLAUDE.md, .claude/), the rules (docs/DAILY.md, docs/FEEDBACK.md, docs/REVIEWER.md) and their checks (scripts/risk.mjs, scripts/gate.mjs, scripts/smoke.mjs and the sizes it checks, the deploy error check and the loop metrics, with their tests)",
    file: any([
      ".github/",
      ".claude/",
      ".gitattributes",
      "CLAUDE.md",
      "docs/DAILY.md",
      "docs/FEEDBACK.md",
      "docs/REVIEWER.md",
      "scripts/risk.mjs",
      "scripts/risk-test.mjs",
      "scripts/gate-test.mjs",
      "scripts/gate-prstate-test.mjs",
      "scripts/workflows-test.mjs",
      "scripts/gate.mjs",
      "scripts/smoke.mjs",
      "scripts/sizes.mjs",
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
  {
    id: "A3",
    cls: "amber",
    what: "code that updates, replaces or deletes rows of a players' table, or of a table named at run time (more such statements added than removed in a file)",
    file: (f) => isCode(f) && count(f.added, WRITE_PLAYERS) > count(f.removed, WRITE_PLAYERS),
  },
  {
    id: "A4",
    cls: "amber",
    what: "how progress is saved and merged on the device (saves, sync, the two tab lock)",
    file: any(["src/device-save.ts", "src/sync.ts", "shared/sync.ts", "src/island-store.ts", "src/store.ts"]),
  },
  {
    id: "A5",
    cls: "amber",
    what: "the admin surface and the browser's guards (an /api/admin/ route or handleAdmin changed, worker/http.ts, public/_headers)",
    file: (f) =>
      any(["worker/http.ts", "public/_headers"])(f) || (f.path.startsWith("worker/") && [...f.added, ...f.removed].some((l) => /\/api\/admin\//.test(l))),
  },
  {
    id: "A6",
    cls: "amber",
    what: "checks taken out of the tests (more check( calls removed than added, a process.exit line added or changed, the check helper's line changed, the failure count incremented differently or reset)",
    file: (f) =>
      /^scripts\/.*test.*\.(ts|mjs)$/.test(f.path) &&
      (count(f.removed, /\bcheck\(/g) > count(f.added, /\bcheck\(/g) ||
        touched(f, /process\.exit\(/) ||
        // The helper's own line, or the failure count it keeps (failures++, failed += 1), changed.
        touched(
          f,
          /\b(?:const|let|function)\s+check\b|\bfail(?:ed|ures)\s*(?:\+\+|\+=)|\+\+\s*fail(?:ed|ures)\b|(?<!\b(?:const|let|var)\s+)\bfail(?:ed|ures)\s*=(?!=)/,
        )),
  },
  {
    id: "A7",
    cls: "amber",
    what: "a pull request from the Ideas tab's routine (players' words, docs/FEEDBACK.md): a claude/feedback-* branch or a title that starts with Feedback:",
    pr: (pr) => /^claude\/feedback-/.test(pr.branch ?? "") || /^feedback:/i.test(pr.title ?? ""),
  },
  {
    id: "A8",
    cls: "amber",
    what: "code that runs with production secrets outside the Worker: the scheduled runners (scripts/*runner*, scripts/admin-api.ts, scripts/nightly-play.mjs), the build config (vite.config.*), a script line that calls an /api/admin/ route",
    file: (f) =>
      /^scripts\/[^/]*runner[^/]*$|^scripts\/admin-api\.ts$|^scripts\/nightly-play\.mjs$|^vite\.config\.(ts|js|mjs)$/.test(f.path) ||
      (f.path.startsWith("scripts/") && added(f, /\/api\/admin\//).length > 0),
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
// A path in a ---/+++ header: git adds a tab after a path with a space, and quotes one with
// unusual characters (core.quotePath=false keeps UTF-8 as is).
function headerPath(raw, prefix) {
  let p = raw.replace(/\t$/, "");
  if (p.startsWith('"') && p.endsWith('"')) {
    try {
      p = JSON.parse(p);
    } catch {
      p = p.slice(1, -1);
    }
  }
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

export function parseDiff(text) {
  const files = [];
  let f = null;
  let inHunk = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      // The path is read from the ---/+++ headers below; this is only a fallback (a binary file has none).
      const m = /^diff --git a\/(.+?) b\/\1$/.exec(line) ?? /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      f = { path: m ? (m[2] ?? m[1]) : line.slice(11), status: "M", added: [], removed: [], hunks: [], contexts: [] };
      files.push(f);
      inHunk = false;
    } else if (!f) continue;
    else if (!inHunk && line.startsWith("new file mode")) f.status = "A";
    else if (!inHunk && line.startsWith("deleted file mode")) f.status = "D";
    else if (!inHunk && line.startsWith("+++ ")) {
      if (line !== "+++ /dev/null") f.path = headerPath(line.slice(4), "b/");
    } else if (!inHunk && line.startsWith("--- ")) {
      if (line !== "--- /dev/null") f.path = headerPath(line.slice(4), "a/");
    } else if (line.startsWith("@@")) {
      inHunk = true;
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);
      if (m) {
        f.hunks.push({ oldStart: +m[1], oldLines: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newLines: m[4] === undefined ? 1 : +m[4] });
        if (m[5]) f.contexts.push(m[5]);
      }
    } else if (inHunk && line.startsWith("+")) f.added.push(line.slice(1));
    else if (inHunk && line.startsWith("-")) f.removed.push(line.slice(1));
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
  // -a and --no-textconv: a .gitattributes file cannot hide a file's lines from this check.
  const files = parseDiff(
    git("-c", "core.quotePath=false", "diff", "-U0", "-a", "--no-textconv", "--no-color", "--no-renames", "--no-ext-diff", mergeBase, head),
  );
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
  const result = classify(files, { branch: arg("branch", process.env.GITHUB_HEAD_REF ?? ""), title: arg("title", process.env.PR_TITLE ?? "") });
  if (process.argv.includes("--json")) console.log(JSON.stringify({ cls: result.cls, hits: result.hits }));
  else console.log(report(result));
}
