// 2026-11-06, the repository goes public: checks that no workflow runs a fork's code with a
// secret, that the Gate never runs a pull request's code, and that a stranger's comment does
// not wake it. Reads .github/workflows/*.yml as text (no YAML dependency: the files keep the
// two space indent prettier gives them).
//   node scripts/workflows-test.mjs [dir]   (part of npm run test:risk; dir defaults to .github/workflows)
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

const PRODUCTION_SECRET = /\$\{\{[^}]*secrets\.(CLOUDFLARE_API_TOKEN|MM_TOKEN)\b/;

// What the guard reads from the API under a dispatch: the state, this repository, the head the caller named,
// not a draft, and a feedback branch only with owner-ok. Each must stop the job (exit 1).
const DISPATCH_GUARD = [/\.state\b/, /\.head\.repo\.full_name/, /\.head\.sha/, /\.draft\b/, /claude\/feedback-/, /Feedback:/, /owner-ok/, /GITHUB_SHA/];

/** Whether a job's first step that runs anything is the dispatch guard, before any checkout. */
function dispatchGuarded(lines) {
  const at = lines.findIndex((l) => /^\s+-\s+(name|uses|run|id):/.test(l));
  if (at < 0 || /uses:\s*actions\/checkout@/.test(lines[at])) return false;
  const step = block(lines, at);
  const text = step.join("\n");
  // The step stops the job: an if on it would let the job go on without it.
  if (step.some((l, i) => i > 0 && /^\s+if:/.test(l) && indent(l) === indent(lines[at]) + 2)) return false;
  return DISPATCH_GUARD.every((re) => re.test(text)) && (text.match(/exit 1/g) ?? []).length >= 6;
}

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
  // 4. 2026-11-10, the merge queue: a workflow that runs a pull request's code and may also be started by
  // workflow_dispatch reads no pull request from the event then, and a guard on an empty field must not
  // pass. Each job that names a secret refuses on its own, before any checkout, from the API (DISPATCH_GUARD),
  // or needs a job that does; and nothing in it runs after a failed step (always(), failure(), cancelled()).
  if (fromPr && triggers.includes("workflow_dispatch")) {
    const guarded = new Set(jobs.filter((j) => dispatchGuarded(j.lines)).map((j) => j.name));
    for (const job of jobs) {
      if (!/\bsecrets\./.test(job.text)) continue;
      const needs = (/^\s+needs:\s*\[?([^\]\n]*)\]?\s*$/m.exec(job.text)?.[1] ?? "").split(/[,\s]+/).filter(Boolean);
      const afterFail = /\b(always|failure|cancelled)\(\)/;
      if (guarded.has(job.name)) {
        if (afterFail.test(job.text)) out.push(`${name} job ${job.name}: a step may run after the dispatch guard refused`);
      } else if (!needs.some((n) => guarded.has(n)))
        out.push(`${name} job ${job.name}: names a secret under workflow_dispatch without the pull request guard before its checkout`);
      // A job that only needs the guarded one runs when that one refused if its own if says always().
      else if (afterFail.test(job.cond)) out.push(`${name} job ${job.name}: runs even when the job holding the dispatch guard refused`);
    }
  }
  // 5. 2026-11-10: a workflow another one calls (workflow_call) sees the caller's event name. The Deploy
  // workflow calls CI, and the Gate starts the Deploy by workflow_dispatch, so a step that asks whether
  // this run was dispatched by its event name runs inside every deploy. Ask the input instead (inputs.pr).
  if (triggers.includes("workflow_call") && /github\.event_name\s*==\s*'workflow_dispatch'/.test(text))
    out.push(`${name}: asks github.event_name == 'workflow_dispatch', which a calling workflow's dispatch also matches: key it on an input`);
  // 6. 2026-11-10: a schedule that every job's if skips runs nothing, silently (the Gate's 15 minute sweep).
  if (triggers.includes("schedule"))
    for (const job of jobs)
      if (job.cond && !/github\.event_name == 'schedule'/.test(job.cond) && !/needs\./.test(job.cond))
        out.push(`${name} job ${job.name}: its if never lets the schedule through`);
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
  // 2026-11-11, "credentials: yes": production's Cloudflare token and admin token are given only to a job
  // on the environment "production", which only main may use. The preview is the one exception: its
  // upload uses the "preview" environment's own token, and its smoke falls back to MM_TOKEN only while
  // a repository-level copy still exists (docs/SETUP.md, section 7, "The production environment").
  for (const job of jobs) {
    if (!PRODUCTION_SECRET.test(job.text)) continue;
    if (/^ {4}environment:\s*production\s*$/m.test(job.text)) continue;
    // TEMPORARY (issue #118): Deploy's job reads the repository secrets until the environment's MM_TOKEN is fixed.
    if (name === "deploy.yml" && job.name === "deploy") continue;
    if (name === "preview.yml" && (job.name === "smoke" || /^ {4}environment:\s*$\n^ {6}name:\s*preview\s*$/m.test(job.text))) continue;
    out.push(`${name} job ${job.name}: names a production secret outside the environment "production"`);
  }
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
  {
    const prod = `on:\n  workflow_dispatch:\njobs:\n  a:\n    runs-on: ubuntu-latest\n    env:\n      T: \${{ secrets.CLOUDFLARE_API_TOKEN }}\n    steps:\n      - run: echo\n`;
    check("a production secret outside the environment production is caught", findings("x", prod).length === 1, findings("x", prod).join("; "));
    check(
      "the same job on the environment production passes",
      findings("x", prod.replace("    runs-on: ubuntu-latest\n", "    runs-on: ubuntu-latest\n    environment: production\n")).length === 0,
    );
    check("MM_TOKEN counts too", findings("x", prod.replace("CLOUDFLARE_API_TOKEN", "MM_TOKEN")).length === 1);
    check(
      "another environment does not count",
      findings("x", prod.replace("    runs-on: ubuntu-latest\n", "    runs-on: ubuntu-latest\n    environment: staging\n")).length === 1,
    );
  }
  const comment = `on:\n  issue_comment:\njobs:\n  a:\n    if: github.event.issue.pull_request\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n`;
  check("an issue_comment job anyone can wake is caught", findings("x", comment).length === 1);
  check(
    "with the owner's association it passes",
    findings(
      "x",
      comment.replace("if: github.event.issue.pull_request", "if: github.event.issue.pull_request && github.event.comment.author_association == 'OWNER'"),
    ).length === 0,
  );

  // The dispatch guard (rule 4), on the real preview.yml: taking out any part of it is caught.
  const preview = readFileSync(join(dir, "preview.yml"), "utf8");
  check("preview.yml: the preview job is guarded under a dispatch", dispatchGuarded(parse(preview).jobs.find((j) => j.name === "preview").lines));
  for (const [what, from, to] of [
    ["the guard taken out", / {6}# The guard, before any checkout[\s\S]*?(?= {6}- uses: actions\/checkout@v4)/, ""],
    ["the repository check taken out", /head\.repo\.full_name/g, "head.repo.name"],
    ["the owner-ok check taken out", /owner-ok/g, "owner-yes"],
    ["the head check taken out", /\.head\.sha/g, ".head.ref"],
    ["the guard given an if", / {8}id: pr\n/, "        id: pr\n        if: github.event_name == 'workflow_dispatch'\n"],
    ["a step that runs after a refusal", / {6}- id: upload\n/, "      - id: upload\n        if: always()\n"],
    ["the smoke job no longer needing the guarded one", / {4}needs: preview\n/, "    needs: []\n"],
    [
      "the smoke job run even after a refusal",
      / {4}if: github\.event_name == 'workflow_dispatch' \|\| github\.event\.pull_request\.head\.repo/,
      "    if: always() || github.event.pull_request.head.repo",
    ],
  ]) {
    const broken = preview.replace(from, to);
    check(
      `preview.yml with ${what} is caught`,
      broken !== preview && findings("preview.yml", broken).length > 0,
      broken === preview ? "the edit did not apply" : "",
    );
  }

  // The guard scripts themselves, run in bash with a fake gh that answers from a pull request record:
  // each thing that must refuse makes the step fail, and a good dispatch passes with its outputs.
  const guardScript = (file) => {
    const lines = readFileSync(join(dir, file), "utf8").split("\n");
    const at = lines.findIndex((l) => /^\s+id: pr\s*$/.test(l));
    const runAt = lines.findIndex((l, i) => i > at && /^\s+run: \|\s*$/.test(l));
    const body = block(lines, runAt).slice(1);
    const min = Math.min(...body.filter((l) => l.trim()).map(indent));
    return body.map((l) => l.slice(min)).join("\n");
  };
  const tmp = mkdtempSync(join(tmpdir(), "mm-guard-"));
  // gh api <path> [--jq <expr>]: the record, through jq -r when asked, as gh does.
  writeFileSync(join(tmp, "gh"), `#!/bin/bash\nif [ "$3" = "--jq" ]; then jq -r "$4" "$PR_JSON"; else cat "$PR_JSON"; fi\n`);
  chmodSync(join(tmp, "gh"), 0o755);
  const SHA = "a".repeat(40);
  const good = {
    state: "open",
    draft: false,
    title: "Roads",
    labels: [],
    head: { sha: SHA, ref: "claude/roads", repo: { full_name: "o/r" } },
    base: { ref: "main" },
  };
  const runGuard = (file, pr, env = {}) => {
    writeFileSync(join(tmp, "record.json"), JSON.stringify(pr));
    writeFileSync(join(tmp, "out"), "");
    const r = spawnSync("bash", ["-e", "-c", guardScript(file)], {
      encoding: "utf8",
      env: {
        PATH: `${tmp}:${process.env.PATH}`,
        PR_JSON: join(tmp, "record.json"),
        GITHUB_OUTPUT: join(tmp, "out"),
        RUNNER_TEMP: tmp,
        GITHUB_SHA: SHA,
        REPO: "o/r",
        EVENT: "workflow_dispatch",
        PR: "12",
        SHA,
        ...env,
      },
    });
    return { ok: r.status === 0, out: readFileSync(join(tmp, "out"), "utf8"), err: r.stdout + r.stderr };
  };
  const with_ = (patch) => ({ ...good, ...patch, head: { ...good.head, ...(patch.head ?? {}), repo: { ...good.head.repo, ...(patch.head?.repo ?? {}) } } });
  for (const file of ["ci.yml", "preview.yml"]) {
    const r = runGuard(file, good);
    check(`${file} guard: a good dispatch passes`, r.ok && /^base=main$|^number=12$/m.test(r.out), r.err + r.out);
    for (const [what, pr, env] of [
      ["a closed pull request", with_({ state: "closed" })],
      ["a fork", with_({ head: { repo: { full_name: "stranger/r" } } })],
      ["a head that moved on GitHub", with_({ head: { sha: "b".repeat(40) } })],
      ["a branch that moved since the dispatch", good, { GITHUB_SHA: "c".repeat(40) }],
      ["a pull request number that is not a number", good, { PR: "12; rm -rf /" }],
      ...(file === "preview.yml"
        ? [
            ["a draft", with_({ draft: true })],
            ["a feedback branch without owner-ok", with_({ head: { ref: "claude/feedback-sound" } })],
            ["a Feedback: title without owner-ok", with_({ title: "Feedback: the sound" })],
          ]
        : []),
    ])
      check(`${file} guard refuses ${what}`, !runGuard(file, pr, env).ok);
    if (file === "preview.yml") {
      check(
        "preview.yml guard: a feedback branch with owner-ok passes",
        runGuard(file, with_({ head: { ref: "claude/feedback-x" }, labels: [{ name: "owner-ok" }] })).ok,
      );
      const ev = runGuard(file, good, { EVENT: "pull_request", FROM_EVENT: "7", FROM_EVENT_SHA: SHA, PR: "", SHA: "" });
      check("preview.yml guard: under pull_request it passes the event's number on", ev.ok && /^number=7$/m.test(ev.out), ev.err);
    } else {
      const d = runGuard(file, with_({ draft: true }));
      check("ci.yml guard: a draft passes with draft=true (CI then runs the light steps)", d.ok && /^draft=true$/m.test(d.out), d.err);
    }
  }
  const gate = readFileSync(join(dir, "gate.yml"), "utf8");
  check("gate.yml: the Gate sweeps on a schedule", parse(gate).triggers.includes("schedule"));
  const skipped = gate.replace(
    "github.event_name == 'workflow_dispatch' ||\n      github.event_name == 'schedule'",
    "github.event_name == 'workflow_dispatch'",
  );
  check("gate.yml: a schedule its job's if skips is caught", skipped !== gate && findings("gate.yml", skipped).length > 0);
  // Rule 5 and CI's scope step as the Deploy workflow calls it: the caller's dispatch, no input, a full run.
  const ci = readFileSync(join(dir, "ci.yml"), "utf8");
  const oldGuard = ci.replace("if: inputs.pr != ''", "if: github.event_name == 'workflow_dispatch'");
  check("ci.yml: a guard keyed on the event's name is caught (Deploy calls CI)", oldGuard !== ci && findings("ci.yml", oldGuard).length > 0);
  {
    const lines = ci.split("\n");
    const at = lines.findIndex((l) => /^\s+id: scope\s*$/.test(l));
    const runAt = lines.findIndex((l, i) => i > at && /^\s+run: \|\s*$/.test(l));
    const body = block(lines, runAt).slice(1);
    const min = Math.min(...body.filter((l) => l.trim()).map(indent));
    writeFileSync(join(tmp, "out"), "");
    const r = spawnSync("bash", ["-e", "-c", body.map((l) => l.slice(min)).join("\n")], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, EVENT: "workflow_dispatch", DISPATCHED: "", GITHUB_OUTPUT: join(tmp, "out"), GITHUB_STEP_SUMMARY: join(tmp, "summary") },
    });
    check("ci.yml scope, called by a dispatched Deploy: a full run", r.status === 0 && /^full=true$/m.test(readFileSync(join(tmp, "out"), "utf8")), r.stderr);
  }
  rmSync(tmp, { recursive: true, force: true });

  console.log(failed ? `${failed} failed` : "all workflow checks passed");
  process.exit(failed ? 1 : 0);
}
