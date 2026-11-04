// How long the test run of a new program takes (4.2), in Node, on the live
// programs exported from D1: the simulation alone, with no browser around it.
// What the browser adds on top (the hidden frame, slicing, throttling) is
// measured by scripts/creation-timing.mjs.
//
//   npx wrangler d1 execute magic-merger --remote --json --command "SELECT e.key, e.name, e.tier, e.kind, e.intents, p.spec FROM elements e JOIN spells s ON s.key = e.key JOIN programs p ON p.id = s.pid" > live.json
//   npx esbuild scripts/test-run-timing.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/test-run-timing.mjs
//   node node_modules/.cache/test-run-timing.mjs live.json [out.json]
//
// Each program is timed twice: cold (a fresh control island and fresh probe
// runs, as in a page that just loaded) and warm (what every later check pays).
import { readFileSync, writeFileSync } from "node:fs";
import { checkProgram, resetCheckCaches } from "../src/sim/check";
import { TIERS, type Tier } from "../shared/tiers";
import { parseIntents } from "../shared/promises";

interface Row {
  key: string;
  name: string;
  tier: Tier;
  kind: "spell" | "artifact";
  intents: string | null;
  spec: string;
}

const [path, out] = process.argv.slice(2);
if (!path) {
  console.error("usage: node test-run-timing.mjs live.json [out.json]");
  process.exit(1);
}
const raw = JSON.parse(readFileSync(path, "utf8"));
const rows: Row[] = raw[0]?.results ?? raw;

function run(row: Row, code: string) {
  const intents = parseIntents(row.intents);
  const t0 = performance.now();
  const it = checkProgram({ key: row.key, name: row.name, tier: TIERS.includes(row.tier) ? row.tier : "major", code, intents, kind: row.kind });
  let yields = 0;
  for (;;) {
    const r = it.next();
    if (r.done) return { ms: performance.now() - t0, yields, result: r.value };
    yields++;
  }
}

const results = [];
for (const row of rows) {
  let code: string;
  try {
    code = (JSON.parse(row.spec) as { code: string }).code;
  } catch {
    continue;
  }
  resetCheckCaches();
  const cold = run(row, code);
  const warm = run(row, code);
  const big = TIERS.indexOf(row.tier) >= TIERS.indexOf("legendary");
  const protect = parseIntents(row.intents).includes("protect");
  const group = `${row.kind}${big ? " big" : " small"}${protect ? " protect" : ""}`;
  results.push({
    name: row.name,
    group,
    coldMs: Math.round(cold.ms),
    warmMs: Math.round(warm.ms),
    yields: warm.yields,
    ok: warm.result.ok,
    problem: warm.result.problem,
    seconds: warm.result.stats.seconds,
    phases: warm.result.phases,
  });
  console.log(`${row.name} [${group}]: cold ${Math.round(cold.ms)} ms, warm ${Math.round(warm.ms)} ms, ${warm.result.ok ? "pass" : warm.result.problem}`);
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
const groups = [...new Set(results.map((r) => r.group))].sort();
console.log("\ngroup | n | warm p50 | warm p90 | warm max | cold p50");
for (const g of groups) {
  const rs = results.filter((r) => r.group === g);
  const w = rs.map((r) => r.warmMs);
  console.log(
    `${g} | ${rs.length} | ${pct(w, 0.5)} | ${pct(w, 0.9)} | ${Math.max(...w)} | ${pct(
      rs.map((r) => r.coldMs),
      0.5,
    )}`,
  );
}
if (out) writeFileSync(out, JSON.stringify(results, null, 1));
