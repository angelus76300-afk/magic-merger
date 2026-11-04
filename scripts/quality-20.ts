// Quality and cost of a newly written program on the fixed set of 20 spells
// (scripts/eval-set.ts), the way a player's write goes (4.2): written through
// /api/admin/spell-trial with the production request (intents, the API's
// library, library examples for the small model), the test run and its probes
// (src/sim/check.ts), one rewrite by the small model when the test fails, then
// three Spell Lab frames scored by the judge (/api/admin/judge-trial). Nothing
// is stored in the game; every call is in the spend ledger as the admin's.
//
//   npx wrangler d1 execute magic-merger --remote --json --command "SELECT name, kind, tier FROM elements" > elements.json
//   npx esbuild scripts/quality-20.ts --bundle --platform=node --format=esm --external:playwright --outfile=node_modules/.cache/quality-20.mjs
//   MM_URL=<worker url> MM_TOKEN=<ADMIN_TOKEN> node node_modules/.cache/quality-20.mjs elements.json <out-dir> [drafts] [only=Gold,Water]
//
// Big spells are written by the big model directly; production writes them
// through the Batch API at half price, so their cost is counted at half. With
// "drafts", the small model's draft of each big spell is measured too.
// Resumable: every answer is kept in <out-dir>/state.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCheck, type CheckResult } from "../src/sim/check";
import { TIERS, type Tier } from "../shared/tiers";
import type { Intent } from "../shared/promises";
// @ts-expect-error plain JavaScript module
import { factsOf, openLab } from "./lab-browser.mjs";
import { adminApi } from "./admin-api";
import { EVAL_SET } from "./eval-set";

const [elementsPath, out, ...flags] = process.argv.slice(2);
const url = process.env.MM_URL;
const token = process.env.MM_TOKEN;
if (!elementsPath || !out || !url || !token) {
  console.error("usage: MM_URL=... MM_TOKEN=... node quality-20.mjs elements.json <out-dir> [drafts]");
  process.exit(1);
}
const drafts = flags.includes("drafts");
// only=Gold,Water: a subset of the 20, to repeat one spell on two builds.
const only = flags
  .find((f) => f.startsWith("only="))
  ?.slice(5)
  .split(",");
const SET = only ? EVAL_SET.filter((n) => only.includes(n)) : EVAL_SET;
const raw = JSON.parse(readFileSync(elementsPath, "utf8"));
const tierOf = new Map<string, Tier>((raw[0]?.results ?? raw).map((e: { name: string; tier: Tier }) => [e.name, e.tier]));
mkdirSync(join(out, "frames"), { recursive: true });
const statePath = join(out, "state.json");
const state: Record<string, unknown> = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 1));
async function once<T>(id: string, fn: () => Promise<T>): Promise<T> {
  if (id in state) return state[id] as T;
  const v = await fn();
  state[id] = v;
  save();
  return v;
}
const api = adminApi(url, token, { retries: 2 });

interface Written {
  name: string;
  tier: Tier;
  kind: "spell" | "artifact";
  model: string;
  code: string;
  summary: string;
  intents: Intent[];
  usd: number;
  ms: number;
  calls: { call: string; usd: number }[];
  check: CheckResult;
  rewritten: boolean;
  judge?: { score: number; reason: string };
  facts?: string;
}

const isBig = (t: Tier) => TIERS.indexOf(t) > TIERS.indexOf("grand");

async function write(name: string, model: string, small: boolean): Promise<Written> {
  const r = await api("/api/admin/spell-trial", { name, model, ...(small ? { examples: "library" } : {}) });
  const tier = r.tier as Tier;
  const kind = r.kind as "spell" | "artifact";
  let code = String(r.program.code);
  let summary = String(r.program.summary);
  let usd = Number(r.usd) * (small ? 1 : 0.5);
  let ms = Number(r.ms);
  const calls = [...(r.calls ?? [])];
  const intents = (r.intents ?? []) as Intent[];
  let check = runCheck({ key: name, name, tier, code, intents, kind });
  let rewritten = false;
  // As in production: a failed test run is written once more by the small model.
  if (!check.ok) {
    const again = await api("/api/admin/spell-trial", {
      name,
      model: "claude-haiku-5-5",
      rewrite: { reasons: [`its test run found: ${check.detail}`], summary, code },
    });
    code = String(again.program.code);
    summary = String(again.program.summary);
    usd += Number(again.usd);
    ms += Number(again.ms);
    calls.push(...(again.calls ?? []));
    check = runCheck({ key: name, name, tier, code, intents, kind });
    rewritten = true;
  }
  return { name, tier, kind, model, code, summary, intents, usd, ms, calls, check, rewritten };
}

const lab = await openLab();
async function judge(id: string, w: Written): Promise<Written> {
  if (w.judge) return w;
  const shots = isBig(w.tier) ? [2, 6, 12] : [1, 3, 6];
  const result = await lab.cast(w.code, { tier: w.tier, shots, jpeg: true });
  w.facts = factsOf(result);
  result.frames.forEach((f: { png: string }, i: number) => writeFileSync(join(out, "frames", `${id}.${i}.jpg`), Buffer.from(f.png.split(",")[1], "base64")));
  const j = await api("/api/admin/judge-trial", { name: w.name, frames: result.frames.map((f: { png: string }) => f.png), shots, facts: w.facts });
  w.judge = { score: Number(j.score), reason: String(j.reason) };
  return w;
}

const rows: Record<string, Written> = {};
for (const name of SET) {
  const id = name.replace(/\W+/g, "-").toLowerCase();
  const big = isBig(tierOf.get(name) ?? "major");
  const first = await once(`main:${name}`, () => write(name, big ? "claude-opus-5-5" : "claude-haiku-5-5", !big));
  rows[name] = await once(`judged:${name}`, () => judge(id, first));
  if (drafts && big) {
    const d = await once(`draft:${name}`, () => write(name, "claude-haiku-5-5", true));
    rows[`${name} (draft)`] = await once(`draft-judged:${name}`, () => judge(`${id}.draft`, d));
  }
  const w = rows[name];
  const stats = w.check.stats;
  console.log(
    `${name} [${w.kind} ${w.tier}] ${w.model}: judge ${w.judge?.score}, test ${w.check.ok ? "pass" : w.check.problem}${w.rewritten ? " after a rewrite" : ""}${stats.saved !== undefined ? `, saved ${stats.saved}` : ""}${stats.acted !== undefined ? `, acted ${stats.acted}` : ""}, $${w.usd.toFixed(4)}, ${w.ms} ms`,
  );
}
await lab.close();

const main = SET.map((n) => rows[n]);
const mean = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)) * 10000) / 10000;
const small = main.filter((w) => !isBig(w.tier));
const bigs = main.filter((w) => isBig(w.tier));
const summary = {
  judge: mean(main.map((w) => w.judge?.score ?? 0)),
  judgeSmall: mean(small.map((w) => w.judge?.score ?? 0)),
  judgeBig: mean(bigs.map((w) => w.judge?.score ?? 0)),
  judgePass: main.filter((w) => (w.judge?.score ?? 0) >= 3).length,
  testPassFirstTime: main.filter((w) => !w.rewritten).length,
  testPassInTheEnd: main.filter((w) => w.check.ok).length,
  probes: main
    .filter((w) => w.check.stats.saved !== undefined || w.check.stats.acted !== undefined)
    .map((w) => ({ name: w.name, ok: w.check.ok, saved: w.check.stats.saved, acted: w.check.stats.acted })),
  usdSmall: mean(small.map((w) => w.usd)),
  usdBig: mean(bigs.map((w) => w.usd)),
  msSmall: mean(small.map((w) => w.ms)),
  msBig: mean(bigs.map((w) => w.ms)),
};
console.log(JSON.stringify(summary, null, 1));
writeFileSync(join(out, "results.json"), JSON.stringify({ summary, rows }, null, 1));
