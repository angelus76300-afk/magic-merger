// 2026-11-06, the repository goes public: checks that no workflow runs a fork's code with a
// secret, that the Gate never runs a pull request's code, and that a stranger's comment does
// not wake it. Reads .github/workflows/*.yml as text (no YAML dependency: the files keep the
// two space indent prettier gives them).
//   node scripts/workflows-test.mjs [dir]   (part of npm run test:risk; dir defaults to .github/workflows)
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ": " + detail : ""}`);
  if (!ok) failed++;
};

const SAME_REPO = "github.event.pull_request.head.repo.full_name == github.repository";
const dir = process.argv[2] ?? ".github/workflows";
const indent = (line) => line.length - line.trimStart().length;

/** The lines of a block that starts at `start` and holds every following line indented deeper (blank lines included). */
function block(lines, start) {
  const base = indent(lines[start]);
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === "" || indent(lines[end]) > base)) end++;
  return lines.slice(start, end);
}

/** Top level `on:` triggers and the jobs, each with its own text and its `if:` expression. */
export function parse(text) {
  const lines = text.split("\n").filter((l) => !/^\s*#/.test(l));
  const onAt = lines.findIndex((l) => /^on:\s*$/.test(l));
  const triggers =
    onAt < 0
      ? []
      : block(lines, onAt)
          .slice(1)
          .filter((l) => indent(l) === 2 && /^\s+[a-z_]+:/.test(l))
          .map((l) => l.trim().replace(/:.*$/, ""));
  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const jobs = [];
  if (jobsAt >= 0) {
    for (let i = jobsAt + 1; i < lines.length; i++) {
      const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
      if (!m) continue;
      const body = block(lines, i);
      const ifAt = body.findIndex((l) => indent(l) === 4 && /^\s+if:/.test(l));
      const cond =
        ifAt < 0
          ? ""
          : block(body, ifAt)
              .join(" ")
              .replace(/^\s*if:\s*(>-|\|)?/, "")
              .replace(/\s+/g, " ")
              .trim();
      jobs.push({ name: m[1], text: body.join("\n"), lines: body, cond });
    }
  }
  return { triggers, jobs, lines };
}

/** Lines of shell that `run:` steps execute (inline or as a block). */
function runLines(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (m[3] && !/^[|>]-?$/.test(m[3])) out.push(m[3]);
    else out.push(...block(lines, i).slice(1));
  }
  return out;
}

// Fields of an event a stranger writes: never interpolated into a shell line, only passed through env.
const TAINTED =
  /\$\{\{[^}]*(github\.head_ref|pull_request\.(title|body|head\.ref|head\.label)|comment\.body|issue\.(title|body)|label\.name|head_commit\.message|review\.body|workflow_run\.head_branch|inputs\.)[^}]*\}\}/;

/** Every finding for one workflow file, as text; empty when it is safe. */
export function findings(name, text) {
  const out = [];
  const { triggers, jobs } = parse(text);
  const fromPr = triggers.includes("pull_request");
  const privileged = triggers.some((t) => ["pull_request_target", "issue_comment", "workflow_run"].includes(t));
  for (const job of jobs) {
    // 1. A job that runs on a pull request and names a secret runs only for this repository's branches.
    if (fromPr && /\bsecrets\./.test(job.text) && !job.cond.includes(SAME_REPO))
      out.push(`${name} job ${job.name}: names a secret on pull_request without "${SAME_REPO}" in its if`);
    // 2. No stranger's text in a shell line (script injection).
    for (const l of runLines(job.lines)) if (TAINTED.test(l)) out.push(`${name} job ${job.name}: a run line interpolates an event field: ${l.trim()}`);
  }
  if (privileged) {
    // 3. A workflow that holds a write token or secrets on a pull request's event checks out main only, and runs nothing from the pull request.
    const all = text.split("\n");
    all.forEach((l, i) => {
      if (!/uses:\s*actions\/checkout@/.test(l)) return;
      const step = block(all, i).join("\n");
      if (!/\bref:\s*main\s*$/m.test(step)) out.push(`${name}: a checkout that is not of main (line ${i + 1})`);
      if (/\$\{\{[^}]*(head|pull_request|workflow_run)[^}]*\}\}/.test(step)) out.push(`${name}: a checkout of the pull request's head (line ${i + 1})`);
    });
    for (const job of jobs)
      for (const l of runLines(job.lines))
        if (/\b(npm|npx|yarn|pnpm)\b|\bmake\b|\.\/node_modules/.test(l))
          out.push(`${name} job ${job.name}: runs a package script or tool from the tree: ${l.trim()}`);
  }
  if (triggers.includes("issue_comment"))
    for (const job of jobs)
      if (!/github\.event\.comment\.author_association == 'OWNER'/.test(job.cond))
        out.push(`${name} job ${job.name}: a comment from anyone wakes it (no author_association == 'OWNER' in its if)`);
  if (triggers.includes("workflow_run"))
    for (const job of jobs)
      if (!/github\.event\.workflow_run\.head_repository\.full_name == github\.repository/.test(job.cond))
        out.push(`${name} job ${job.name}: a fork's finished run wakes it (no head_repository guard in its if)`);
  if (triggers.includes("pull_request_target"))
    for (const job of jobs) if (!job.cond.includes(SAME_REPO)) out.push(`${name} job ${job.name}: a fork's pull_request_target wakes it`);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  check("the workflows are found", files.length >= 8, files.join(", "));
  for (const f of files) {
    const found = findings(f, readFileSync(join(dir, f), "utf8"));
    check(`${f}: no fork runs with a secret, no injection, no pull request code under a write token`, found.length === 0, found.join("; "));
  }

  // The checker itself: each kind of mistake, written as a workflow, is caught.
  const prWithSecret = `on:\n  pull_request:\njobs:\n  a:\n    runs-on: ubuntu-latest\n    env:\n      T: \${{ secrets.T }}\n    steps:\n      - run: echo\n`;
  check("a pull_request job with a secret and no guard is caught", findings("x", prWithSecret).length === 1);
  check(
    "the same job with the guard passes",
    findings("x", prWithSecret.replace("    runs-on", `    if: ${SAME_REPO}\n    runs-on`)).length === 0,
    findings("x", prWithSecret.replace("    runs-on", `    if: ${SAME_REPO}\n    runs-on`)).join("; "),
  );
  check(
    "a multi line if with the guard passes",
    findings("x", prWithSecret.replace("    runs-on", `    if: >-\n      !github.event.pull_request.draft &&\n      ${SAME_REPO}\n    runs-on`)).length === 0,
  );
  check("the guard in a comment does not count", findings("x", prWithSecret.replace("    runs-on", `    # if: ${SAME_REPO}\n    runs-on`)).length === 1);
  const injected = `on:\n  pull_request:\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          echo "\${{ github.event.pull_request.title }}"\n`;
  check("a title in a run line is caught", findings("x", injected).length === 1);
  check("a title through env passes", findings("x", injected.replace(`echo "\${{ github.event.pull_request.title }}"`, 'echo "$TITLE"')).length === 0);
  const target = `on:\n  pull_request_target:\njobs:\n  a:\n    if: ${SAME_REPO}\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: \${{ github.event.pull_request.head.sha }}\n      - run: npm ci\n`;
  check("pull_request_target checking out the head and running npm is caught twice over", findings("x", target).length === 3, findings("x", target).join("; "));
  const comment = `on:\n  issue_comment:\njobs:\n  a:\n    if: github.event.issue.pull_request\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n`;
  check("an issue_comment job anyone can wake is caught", findings("x", comment).length === 1);
  check(
    "with the owner's association it passes",
    findings(
      "x",
      comment.replace("if: github.event.issue.pull_request", "if: github.event.issue.pull_request && github.event.comment.author_association == 'OWNER'"),
    ).length === 0,
  );

  console.log(failed ? `${failed} failed` : "all workflow checks passed");
  process.exit(failed ? 1 : 0);
}
