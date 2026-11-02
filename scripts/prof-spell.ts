// Dev only: times each part of every tick while a saved spell runs.
//   npx esbuild scripts/prof-spell.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/prof.mjs && node node_modules/.cache/prof.mjs spell.json
import { readFileSync } from "node:fs";
import { lifeCycle, populate, updateCreature } from "../src/sim/creatures";
import { stepPhysics } from "../src/sim/physics";
import { Runtime } from "../src/sim/runtime";
import { TICK, generateWorld } from "../src/sim/world";

const json = JSON.parse(readFileSync(process.argv[2], "utf8"));
const world = generateWorld(152, 152, 11);
populate(world);
const rt = new Runtime(world, (_k, _n, m) => console.log("error:", m));
const t0 = performance.now();
rt.cast({ key: "p", name: json.name, tier: json.tier, code: json.program.code }, 76, 76);
console.log(`cast call ${(performance.now() - t0).toFixed(1)}ms`);
const rows: { tick: number; phys: number; rt: number; decor: number }[] = [];
for (let tick = 0; tick < 30 * 20; tick++) {
  world.time += TICK;
  world.tick++;
  const a = performance.now();
  stepPhysics(world, TICK);
  for (const c of world.creatures) updateCreature(world, c, TICK);
  lifeCycle(world, TICK);
  const b = performance.now();
  rt.step(TICK);
  world.particles.update(TICK);
  const c = performance.now();
  rows.push({ tick, phys: b - a, rt: c - b, decor: world.decor.size });
}
rows.sort((x, y) => y.phys + y.rt - (x.phys + x.rt));
for (const r of rows.slice(0, 8)) console.log(`t=${(r.tick * TICK).toFixed(2)}s physics ${r.phys.toFixed(1)}ms runtime ${r.rt.toFixed(1)}ms decor ${r.decor}`);
