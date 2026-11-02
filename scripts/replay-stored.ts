// Dev only: casts every stored program on the current runtime, in Node, to
// check that programs written for older versions of the World API still run.
//   npx wrangler d1 execute magic-merger --remote --json --command "SELECT s.key, e.name, e.tier, s.version, s.model, s.spec FROM spells s LEFT JOIN elements e ON e.key = s.key" > spells.json
//   npx esbuild scripts/replay-stored.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/replay.mjs && node node_modules/.cache/replay.mjs spells.json
import { readFileSync } from "node:fs";
import { isTier } from "../shared/tiers";
import { lifeCycle, populate, updateCreature } from "../src/sim/creatures";
import { stepPhysics } from "../src/sim/physics";
import { Runtime } from "../src/sim/runtime";
import { TICK, generateWorld } from "../src/sim/world";

interface Row {
  key: string;
  name: string | null;
  tier: string | null;
  version: number;
  model: string;
  spec: string;
}

const raw = JSON.parse(readFileSync(process.argv[2], "utf8"));
const rows: Row[] = Array.isArray(raw) && raw[0]?.results ? raw[0].results : raw;
const seconds = Number(process.env.REPLAY_SECONDS ?? 12);
const byVersion = new Map<number, { total: number; ok: number; failed: string[] }>();
for (const row of rows) {
  let code: unknown;
  try {
    code = JSON.parse(row.spec).code;
  } catch {
    code = undefined;
  }
  const stats = byVersion.get(row.version) ?? { total: 0, ok: 0, failed: [] };
  byVersion.set(row.version, stats);
  stats.total++;
  if (typeof code !== "string") {
    stats.failed.push(`${row.name ?? row.key}: not a program`);
    continue;
  }
  const world = generateWorld(152, 152, 11);
  populate(world);
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  const tier = isTier(row.tier) ? row.tier : "major";
  const cast = rt.cast({ key: row.key, name: row.name ?? row.key, tier, code }, 76, 76);
  let worst = 0;
  for (let k = 0; k < 30 * seconds && !errors.length; k++) {
    const t0 = performance.now();
    world.time += TICK;
    world.tick++;
    stepPhysics(world, TICK);
    for (const c of world.creatures) updateCreature(world, c, TICK);
    lifeCycle(world, TICK);
    rt.step(TICK);
    world.particles.update(TICK);
    world.events.length = 0;
    worst = Math.max(worst, performance.now() - t0);
  }
  if (cast && !errors.length) stats.ok++;
  else stats.failed.push(`${row.name ?? row.key} (${row.model}, ${tier}): ${errors[0] ?? "did not start"}`);
}
for (const [version, s] of [...byVersion].sort((a, b) => a[0] - b[0])) {
  console.log(`version ${version}: ${s.ok} of ${s.total} run for ${seconds} s without an error`);
  for (const f of s.failed) console.log(`  ${f.slice(0, 160)}`);
}
