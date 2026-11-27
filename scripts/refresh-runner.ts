// The refresh of the legacy library (3.7 part E): decides each candidate the
// Batch API wrote. For each one:
//   1. its test run in Node (src/sim/check.ts), with its element's promise
//      probe and, for an artifact, the five minute test: a failure keeps the old;
//   2. frames of the old and the new program on the same Spell Lab island,
//      at the same moments, saved to OUT (default refresh-frames/);
//   3. the judge on both (/api/admin/judge-trial, nothing stored): the new one
//      replaces the old only if it scores higher (a tie keeps the old, unless
//      the old one fails its own test run), and its creatures look no less
//      alive (scripts/refresh-decide.ts). Votes then roll it back if players like it less.
//
//   MM_URL=... MM_TOKEN=<ADMIN_TOKEN> npx esbuild scripts/refresh-runner.ts --bundle --platform=node --format=esm \
//     --outfile=node_modules/.cache/refresh-runner.mjs --external:playwright && node node_modules/.cache/refresh-runner.mjs [limit]
//
// DRY=1: decides nothing, only prints what it would do and saves the frames
// (the dry run of 20 the owner looks at before the rest).
//
// `start <candidates.json> [from] [count]`: asks the Worker to write the keys of a measurement's
// candidates list (docs/measurements/spell-rewrite-candidates-2026-11-12.json), `count` (20) from
// `from` (0), in one /api/admin/refresh call. Twenty at a time keeps one request's queries small.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCheck } from "../src/sim/check";
import type { Tier } from "../shared/tiers";
// @ts-expect-error plain JavaScript, shared with the other lab scripts
import { factsOf, openLab } from "./lab-browser.mjs";
import { adminApi } from "./admin-api";
import { decideRefresh } from "./refresh-decide";

const url = process.env.MM_URL;
const token = process.env.MM_TOKEN;
if (!url || !token) {
  console.error("Set MM_URL (the game's address) and MM_TOKEN (its ADMIN_TOKEN).");
  process.exit(1);
}
const api = adminApi(url, token!);

if (process.argv[2] === "start") {
  const file = process.argv[3];
  if (!file) {
    console.error("start <candidates.json> [from] [count]");
    process.exit(1);
  }
  const from = Number(process.argv[4]) || 0;
  const count = Math.min(200, Number(process.argv[5]) || 20);
  const all = (JSON.parse(readFileSync(file, "utf8")) as { candidates?: { key: string }[] }).candidates ?? [];
  const keys = all.map((c) => c.key).slice(from, from + count);
  const r = await api("/api/admin/refresh", { keys, limit: keys.length });
  console.log(
    `asked ${keys.length} (${from} to ${from + keys.length - 1} of ${all.length}); queued ${r.queued.length}; held $${r.estimate}; $${r.room} left in the refresh's month`,
  );
  console.log(`not queued (refreshed before, no live program, or past the budget): ${keys.length - r.queued.length}`);
  process.exit(0);
}

// `start-promise <report.json> [from] [count]`: asks the Worker to write again the items the
// promise check flagged (docs/measurements/promise-check-2026-11-25.json, `rows`): verdict
// "no" or "partly", the most cast first, item programs only ("p<id>"; a wonder, "w<id>", is
// not the refresh's to write). Each key carries its why, the check's missing and fix, which
// lets a key refreshed before be written once more and reaches the writer's prompt.
if (process.argv[2] === "start-promise") {
  const file = process.argv[3];
  if (!file) {
    console.error("start-promise <report.json> [from] [count]");
    process.exit(1);
  }
  const from = Number(process.argv[4]) || 0;
  const count = Math.min(200, Number(process.argv[5]) || 20);
  type Row = { id: string; key: string; verdict: string | null; casts: number; missing?: string; fix?: string };
  const rows = (JSON.parse(readFileSync(file, "utf8")) as { rows?: Row[] }).rows ?? [];
  const flagged = rows.filter((r) => r.verdict === "no" || r.verdict === "partly");
  const all = flagged.filter((r) => r.id.startsWith("p") && !!r.key).sort((a, b) => b.casts - a.casts || a.key.localeCompare(b.key));
  const part = all.slice(from, from + count);
  const keys = part.map((r) => r.key);
  const why = Object.fromEntries(part.map((r) => [r.key, `The promise check (Opus) found: ${(r.missing ?? "").trim()} Fix: ${(r.fix ?? "").trim()}`]));
  const r = await api("/api/admin/refresh", { keys, why, limit: keys.length });
  console.log(
    `flagged ${flagged.length}, ${all.length} programs (skipped ${flagged.length - all.length}: wonders or no key); asked ${keys.length} (${from} to ${from + keys.length - 1}); queued ${r.queued.length}; held $${r.estimate}; $${r.room} left in the refresh's month`,
  );
  console.log(`not queued (rewritten in the last day, no live program, or past the budget): ${keys.length - r.queued.length}`);
  process.exit(0);
}

const dry = process.env.DRY === "1";
const out = process.env.OUT ?? "refresh-frames";
const limit = Number(process.argv[2]) || 20;
mkdirSync(out, { recursive: true });

interface Candidate {
  id: number;
  key: string;
  name: string;
  kind: "spell" | "artifact";
  // 4.6: written as this kind (shared/forms.ts), and said to be giant.
  form?: string;
  giant?: boolean;
  tier: Tier;
  intents: string[];
  model: string;
  code: string;
  oldId: number | null;
  oldCode: string;
  dry: boolean;
}

const shotsFor = (tier: Tier) => (tier === "legendary" || tier === "cosmic" ? [2, 6, 12] : [1, 3, 6]);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const list = ((await api(`/api/admin/refresh-candidates?limit=${limit}`)) as Candidate[]).filter((c) => !dry || c.dry);
console.log(`${list.length} candidates${dry ? " (dry run: nothing is decided)" : ""}`);
let lab = await openLab();
const summary: Record<string, unknown>[] = [];
try {
  for (const c of list) {
    // A cast that kills the browser (a page crash after many casts) leaves
    // this one undecided, and the next starts in a fresh browser.
    try {
      const req = { key: c.key, name: c.name, tier: c.tier, code: c.code, intents: c.intents, kind: c.kind, form: c.form, giant: c.giant };
      const check = runCheck(req);
      const old = c.oldCode ? runCheck({ ...req, code: c.oldCode }) : null;
      const shots = shotsFor(c.tier);
      const frames: Record<string, { png: string }[]> = {};
      const judged: Record<string, { score: number; alive: string; note: string } | null> = { old: null, new: null };
      for (const [which, code] of [
        ["old", c.oldCode],
        ["new", c.code],
      ] as const) {
        if (!code) continue;
        const r = await lab.cast(code, { tier: c.tier, shots, jpeg: true });
        frames[which] = r.frames;
        r.frames.forEach((f: { png: string }, i: number) =>
          writeFileSync(join(out, `${slug(c.name)}.${which}.${i}.jpg`), Buffer.from(f.png.split(",")[1], "base64")),
        );
        if (which === "new" && !check.ok) continue;
        judged[which] = await api("/api/admin/judge-trial", { name: c.name, frames: r.frames.map((f: { png: string }) => f.png), shots, facts: factsOf(r) });
      }
      const o = judged.old;
      const n = judged.new;
      const { replace, reason } = decideRefresh({ form: c.form, check, old, o, n });
      const row = {
        name: c.name,
        tier: c.tier,
        model: c.model,
        replace,
        reason,
        oldScore: o?.score ?? null,
        newScore: n?.score ?? null,
        oldAlive: o?.alive,
        newAlive: n?.alive,
        oldTest: old ? (old.ok ? "pass" : old.problem) : "none",
        newTest: check.ok ? "pass" : check.problem,
        newNote: n?.note ?? "",
      };
      summary.push(row);
      console.log(`${c.name} (${c.tier}, ${c.model}): ${replace ? (dry ? "would replace" : "replaced") : "keeps the old"}: ${reason}`);
      if (!dry)
        await api("/api/admin/refresh-verdict", { id: c.id, replace, reason, oldScore: o?.score, newScore: n?.score, checked: { ...check, at: Date.now() } });
    } catch (err) {
      console.log(`${c.name}: skipped, undecided (${err instanceof Error ? err.message.split("\n")[0] : String(err)})`);
      await lab.close().catch(() => {});
      lab = await openLab();
    }
  }
} finally {
  await lab.close();
  writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 1));
}
