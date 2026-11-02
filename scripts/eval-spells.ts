// Measures spell quality before and after 3.3 on a fixed set of 20 spells,
// and what each costs. Dev only; nothing is stored in the game.
//
//   npx wrangler d1 execute magic-merger --remote --json --command "SELECT s.key, e.name, e.tier, e.kind, e.depth, e.description, s.version, s.model, s.spec FROM spells s JOIN elements e ON e.key = s.key WHERE s.version >= 2" > stored.json
//   npx esbuild scripts/eval-spells.ts --bundle --platform=node --format=esm --external:playwright --outfile=node_modules/.cache/eval.mjs
//   MM_URL=<a Worker version's URL> MM_TOKEN=<ADMIN_TOKEN> node node_modules/.cache/eval.mjs stored.json <out-dir>
//
// Before: the program stored today. After: what 3.3 writes for the same
// spell, through the admin trial endpoints (which store nothing):
//   small spells (up to grand): Haiku with two library examples, then the test
//   run (src/sim/check.ts) and one rewrite by Haiku if it fails. Also without
//   the library, to tell its effect apart.
//   big spells: the Haiku draft the player gets at once (same path), and the
//   Opus program from the Batch API that replaces it, with its test run.
// Every version is cast in the Spell Lab (frames at 1, 3 and 6 s) and scored
// by the Haiku judge; the frames are kept for a blind grader. The library
// has no votes yet, so it is seeded with the stored programs the judge
// scored best, outside the 20.
// Resumable: every answer is kept in <out-dir>/state.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCheck, type CheckResult } from "../src/sim/check";
import { TIERS, type Tier } from "../shared/tiers";
import { pickExamples, type LibraryEntry } from "../worker/programs";
// @ts-expect-error plain JavaScript module
import { factsOf, openLab } from "./lab-browser.mjs";

export const EVAL_SET = [
  "Water",
  "Withering",
  "Gold",
  "Fireball",
  "Darkness",
  "Vampire",
  "Golem",
  "Tornado",
  "Necromancy",
  "Holy Light",
  "Sanctuary",
  "Earthquake",
  "Tidal Wave",
  "Eclipse",
  "Enchanted Forest",
  "Great Flood",
  "Meteor Strike",
  "Excalibur",
  "Black Hole",
  "World Tree",
];
const SHOTS = [1, 3, 6];
const LIBRARY_SIZE = 10;

interface Stored {
  key: string;
  name: string;
  tier: Tier;
  kind: string;
  description: string;
  model: string;
  version: number;
  code: string;
}

interface Version {
  label: string;
  model: string;
  code: string;
  summary?: string;
  usd: number;
  check?: CheckResult;
  rewritten?: boolean;
  examples?: string[];
  judge?: { score: number; reason: string; note: string; usd?: number };
  facts?: string;
  frames?: string[];
  errors?: string[];
}

const [storedPath, out] = process.argv.slice(2);
const url = process.env.MM_URL;
const token = process.env.MM_TOKEN;
if (!storedPath || !out || !url || !token) {
  console.error("usage: MM_URL=... MM_TOKEN=... node eval.mjs stored.json <out-dir>");
  process.exit(1);
}
mkdirSync(join(out, "frames"), { recursive: true });
const statePath = join(out, "state.json");
const state: Record<string, unknown> = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 1));

const raw = JSON.parse(readFileSync(storedPath, "utf8"));
const stored: Stored[] = (raw[0]?.results ?? raw).map((r: Record<string, unknown>) => ({
  ...(r as object),
  tier: TIERS.includes(r.tier as Tier) ? r.tier : "major",
  code: JSON.parse(r.spec as string).code,
}));
const byName = new Map(stored.map((s) => [s.name, s]));

async function api(path: string, body?: unknown): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(new URL(path, url), {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", "x-access-token": token! },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok && data) return data;
    if (attempt >= 2 || res.status < 500) throw new Error(`${path}: ${data?.error ?? res.status}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// Once per step: the answer is kept, so a rerun picks up where it stopped.
async function once<T>(id: string, fn: () => Promise<T>): Promise<T> {
  if (id in state) return state[id] as T;
  const v = await fn();
  state[id] = v;
  save();
  return v;
}

const lab = await openLab();
const spendBefore = await once("spend-before", () => api("/api/spend"));

async function look(id: string, name: string, tier: Tier, v: Version): Promise<Version> {
  if (!v.check) v.check = runCheck({ key: id, name, tier, code: v.code });
  if (!v.judge) {
    const result = await lab.cast(v.code, { tier, shots: SHOTS, jpeg: true });
    v.facts = factsOf(result);
    v.errors = result.errors;
    v.frames = result.frames.map((f: { png: string }, i: number) => {
      const path = join(out, "frames", `${id}.${i}.jpg`);
      writeFileSync(path, Buffer.from(f.png.split(",")[1], "base64"));
      return path;
    });
    const j = await api("/api/admin/judge-trial", { name, frames: result.frames.map((f: { png: string }) => f.png), shots: SHOTS, facts: v.facts });
    v.judge = { score: Number(j.score), reason: String(j.reason), note: String(j.note) };
  }
  return v;
}

// The 3.3 path for one program: written, tested, rewritten once by Haiku if
// the test run fails (with the failing code in front of it).
async function written(id: string, name: string, tier: Tier, ask: () => Promise<Version>): Promise<Version> {
  return once(id, async () => {
    let v = await ask();
    v.check = runCheck({ key: id, name, tier, code: v.code });
    if (!v.check.ok) {
      const r = await api("/api/admin/spell-trial", {
        name,
        model: "claude-haiku-5-5",
        rewrite: { reasons: [`its test run found: ${v.check.detail}`], summary: v.summary, code: v.code },
      });
      const p = r.program as { code: string; summary: string };
      v = { ...v, code: p.code, summary: p.summary, usd: v.usd + Number(r.usd), rewritten: true, check: undefined };
      v.check = runCheck({ key: id, name, tier, code: v.code });
    }
    return v;
  });
}

async function trial(name: string, model: string, examples?: unknown[]): Promise<Version> {
  const r = await api("/api/admin/spell-trial", { name, model, ...(examples ? { examples } : {}) });
  const p = r.program as { code: string; summary: string };
  return { label: "", model: String(r.model), code: p.code, summary: p.summary, usd: Number(r.usd), examples: r.examples as string[] };
}

// 1. The big spells' Opus programs go through one real batch, which runs
// while the library is scored.
const big = EVAL_SET.filter((n) => TIERS.indexOf(byName.get(n)!.tier) > TIERS.indexOf("grand"));
const batch = await once("batch", async () => api("/api/admin/batch-trial", { names: big }));
// 2. The library: stored programs up to grand outside the set, scored by the judge.
const pool = stored.filter((s) => !EVAL_SET.includes(s.name) && TIERS.indexOf(s.tier) <= TIERS.indexOf("grand"));
const poolScores: Record<string, number> = {};
for (const s of pool) {
  const v = await once(`pool:${s.name}`, () =>
    look(`pool-${s.key.replace(/\W+/g, "-")}`, s.name, s.tier, { label: "pool", model: s.model, code: s.code, usd: 0 }),
  );
  poolScores[s.name] = v.judge?.score ?? 0;
  console.log(`pool ${s.name}: ${v.judge?.score} ${v.check?.ok ? "" : v.check?.problem}`);
}
const library: LibraryEntry[] = pool
  .filter((s) => (state[`pool:${s.name}`] as Version).check?.ok)
  .sort((a, b) => poolScores[b.name] - poolScores[a.name])
  .slice(0, LIBRARY_SIZE)
  .map((s) => ({ key: s.key, name: s.name, tier: s.tier, kind: s.kind, description: s.description, code: s.code }));
console.log(`library: ${library.map((l) => `${l.name} ${poolScores[l.name]}`).join(", ")}`);

// Read once: every read of a finished batch is billed again in the spend ledger.
let outcomes: { id: string; answer?: { code: string; summary: string }; error?: string; model: string; usd: number }[] | null =
  (state.batchOutcomes as typeof outcomes) ?? null;
for (let i = 0; !outcomes; i++) {
  const r = await api(`/api/admin/batch-trial?batch=${batch.batch}`);
  if (r.ended) outcomes = r.outcomes as typeof outcomes;
  else {
    if (i % 6 === 0) console.log(`batch ${batch.batch} still running…`);
    await new Promise((res) => setTimeout(res, 20_000));
  }
}
state.batchOutcomes = outcomes;
save();

// 3. The twenty spells.
const results: Record<string, Record<string, Version>> = {};
for (const name of EVAL_SET) {
  const s = byName.get(name)!;
  const id = s.key.replace(/\W+/g, "-");
  const versions: Record<string, Version> = {};
  versions.before = await once(`before:${name}`, () => look(`${id}.before`, name, s.tier, { label: "before", model: s.model, code: s.code, usd: 0 }));
  const examples = pickExamples(library, { key: s.key, name, description: s.description, kind: s.kind, tier: s.tier });
  const haiku = await written(`haiku:${name}`, name, s.tier, async () => trial(name, "claude-haiku-5-5", examples));
  versions[big.includes(name) ? "draft" : "after"] = await once(`haiku-look:${name}`, () => look(`${id}.haiku`, name, s.tier, haiku));
  if (big.includes(name)) {
    const o = outcomes.find((x) => x.id === `trial${big.indexOf(name)}`);
    const opus = await written(`opus:${name}`, name, s.tier, async () => {
      if (!o?.answer) throw new Error(`batch failed for ${name}: ${o?.error}`);
      return { label: "after", model: o.model, code: o.answer.code, summary: o.answer.summary, usd: o.usd };
    });
    versions.after = await once(`opus-look:${name}`, () => look(`${id}.opus`, name, s.tier, opus));
  } else {
    const plain = await written(`plain:${name}`, name, s.tier, async () => trial(name, "claude-haiku-5-5", []));
    versions.nolib = await once(`plain-look:${name}`, () => look(`${id}.nolib`, name, s.tier, plain));
  }
  results[name] = versions;
  const line = Object.entries(versions)
    .map(([k, v]) => `${k} ${v.judge?.score}${v.check?.ok ? "" : ` (${v.check?.problem})`}${v.rewritten ? " rewritten" : ""} $${v.usd.toFixed(4)}`)
    .join(", ");
  console.log(`${name} [${s.tier}]: ${line}`);
}
const spendAfter = await api("/api/spend");
writeFileSync(join(out, "results.json"), JSON.stringify({ library: library.map((l) => l.name), results, spendBefore, spendAfter }, null, 1));
await lab.close();
