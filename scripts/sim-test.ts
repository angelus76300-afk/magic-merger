// Fast checks of the simulation, without a browser: `npm test`.
// Generation, the reference spells, the loop guard, saving, and every
// challenge both ways (doing nothing must not win, the right magic must win).
// Bundled with esbuild and run by Node; the voxel view is not involved.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { guardLoops } from "../shared/spellcode";
import { lifeCycle, populate, updateCreature } from "../src/sim/creatures";
import { C } from "../src/sim/materials";
import { stepPhysics } from "../src/sim/physics";
import { Runtime } from "../src/sim/runtime";
import { loadWorld, saveWorld } from "../src/sim/save";
import { SCENARIOS } from "../src/sim/scenarios";
import { TICK, generateWorld, type World } from "../src/sim/world";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
}

function step(world: World, rt: Runtime): number {
  const t0 = performance.now();
  world.time += TICK;
  world.tick++;
  stepPhysics(world, TICK);
  for (const c of world.creatures) updateCreature(world, c, TICK);
  lifeCycle(world, TICK);
  rt.step(TICK);
  world.particles.update(TICK);
  world.events.length = 0;
  return performance.now() - t0;
}

// 1. Generation: water, peaks and villages on every size.
for (const size of [112, 152, 208]) {
  const world = generateWorld(size, size, 7);
  populate(world);
  let water = 0;
  let houses = 0;
  for (let i = 0; i < world.n; i++) {
    if (world.depth[i] > 0) water++;
    if (world.cover[i] === C.HOUSE) houses++;
  }
  const share = water / world.n;
  const people = world.creatures.filter((c) => c.kind === "villager").length;
  check(`world ${size}`, share > 0.08 && share < 0.4 && houses > 0 && people > 0, `water ${(share * 100).toFixed(0)}%, ${houses / 4} houses, ${people} villagers`);
}

// 2. Reference spells run without errors and in time.
const spellDir = "lab/spells";
for (const file of readdirSync(spellDir).filter((f) => f.endsWith(".js"))) {
  const world = generateWorld(152, 152, 11);
  populate(world);
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  const ok = rt.cast({ key: file, name: file, tier: file.includes("bang") ? "cosmic" : "legendary", code: readFileSync(join(spellDir, file), "utf8") }, 76, 76);
  let worst = 0;
  for (let k = 0; k < 30 * 12; k++) worst = Math.max(worst, step(world, rt));
  check(`spell ${file}`, ok && errors.length === 0 && worst < 120, `${errors[0] ?? "no errors"}, worst tick ${worst.toFixed(1)}ms`);
}

// 3. A spell that loops forever is stopped, not frozen.
{
  const world = generateWorld(112, 112, 3);
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  rt.cast({ key: "loop", name: "Loop", tier: "minor", code: "const spell = { *cast(w) { while (true) {} } };" }, 50, 50);
  step(world, rt);
  check("endless loop is stopped", errors.some((e) => e.includes("too long")), errors[0] ?? "no error");
  check("loop guard covers bodiless loops", guardLoops("for(;;) x++;").includes("__g()"));
}

// 4. Saving and loading keeps the land.
{
  const world = generateWorld(112, 112, 5);
  populate(world);
  const data = JSON.parse(JSON.stringify(saveWorld(world, new Map())));
  const back = loadWorld(data, () => {});
  let drift = 0;
  if (back) for (let i = 0; i < world.n; i++) drift = Math.max(drift, Math.abs(back.height[i] - world.height[i]));
  check("save and load", !!back && drift < 0.02 && back.creatures.length === world.creatures.filter((c) => !c.dead).length, `height drift ${drift.toFixed(3)}`);
}

// 5. Challenges: nothing does not win; the solution wins.
const solutions: Record<string, { file: string; tier: "major" | "grand" | "legendary"; at: [number, number][] }> = {
  wildfire: { file: "rain.js", tier: "grand", at: [[16, 56]] },
  lava: { file: "wall.js", tier: "grand", at: [[58, 58]] },
  river: { file: "frost.js", tier: "major", at: [[56, 54]] },
  drought: { file: "bloom.js", tier: "legendary", at: [[56, 56]] },
  flood: { file: "dike.js", tier: "grand", at: [[56, 50]] },
};
for (const scenario of SCENARIOS) {
  for (const withMagic of [false, true]) {
    const { world, run } = scenario.build();
    const errors: string[] = [];
    const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
    const plan = solutions[scenario.id];
    let status = "playing";
    for (let k = 0; k < 30 * 85 && status === "playing"; k++) {
      if (withMagic && k === 150) {
        const code = readFileSync(join("lab/solutions", plan.file), "utf8");
        plan.at.forEach(([x, y], n) => rt.cast({ key: `${plan.file}${n}`, name: plan.file, tier: plan.tier, code }, x, y));
      }
      step(world, rt);
      run.tick(world);
      if (k % 15 === 0) status = run.check(world).status;
    }
    const want = withMagic ? status === "won" : status !== "won";
    check(`challenge ${scenario.id} ${withMagic ? "with " + plan.file : "with nothing"}`, want && errors.length === 0, `${status}${errors[0] ? ", " + errors[0] : ""}`);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
