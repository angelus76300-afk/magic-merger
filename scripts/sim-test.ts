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
import { VK, floats, keyCell, voxelKind } from "../src/sim/voxels";

// Seeded randomness, so a check gives the same answer on every run.
function seed(n: number): void {
  let a = n >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

// 5. Voxel physics: nothing floats unless it is magic; a burnt trunk drops
// its crown; a grown tree stands; ice melts by fire.
{
  const lowest = (world: World) => {
    // For each voxel, is anything below it to stand on? Count those that hang.
    let hanging = 0;
    for (const [key, v] of world.decor) {
      const { x, y, level } = keyCell(key);
      if (floats(voxelKind(v)) || level <= Math.round(world.height[y * world.w + x] * 0.5)) continue;
      const near = [1, -1, 512, -512, 512 * 1024, -512 * 1024].some((d) => world.decor.has(key + d));
      if (!near) hanging++;
    }
    return hanging;
  };
  const world = generateWorld(112, 112, 9);
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  let x = 56;
  let y = 56;
  for (let k = 0; k < 400 && world.depth[y * 112 + x] > 0; k++) {
    x = 20 + ((k * 37) % 72);
    y = 20 + ((k * 53) % 72);
  }
  rt.cast({ key: "kit", name: "Kit", tier: "grand", code: `const spell = { *cast(w) { w.tree(w.x, w.y, { style: "oak", height: 24, grow: 1 }); w.voxel(w.x + 2, w.y, 60, "#ffffff"); w.voxel(w.x - 2, w.y, 60, "#b48cff", "magic"); } };` }, x, y);
  for (let k = 0; k < 30 * 6; k++) step(world, rt);
  const top = (w: World) => Math.max(...[...w.decor.entries()].filter(([, v]) => !floats(voxelKind(v))).map(([key]) => keyCell(key).level));
  const grown = world.decor.size;
  const height = top(world) - Math.round(world.height[y * 112 + x] * 0.5);
  check("grown tree stands", errors.length === 0 && grown > 300 && height > 20 && lowest(world) === 0, `${grown} voxels, ${height} high, ${lowest(world)} hanging, ${errors[0] ?? "no errors"}`);
  const magic = [...world.decor.values()].filter((v) => voxelKind(v) === VK.MAGIC).length;
  check("stray voxel falls, magic floats", magic === 1 && lowest(world) === 0, `${magic} magic`);
  // Burn the trunk at its base.
  const crownBefore = [...world.decor.entries()].filter(([, v]) => voxelKind(v) === VK.LEAF).length;
  world.fire[y * 112 + x] = 1;
  for (let k = 0; k < 30 * 25; k++) {
    world.fire[y * 112 + x] = Math.max(world.fire[y * 112 + x], 0.6);
    step(world, rt);
  }
  const crownAfter = [...world.decor.entries()].filter(([, v]) => voxelKind(v) === VK.LEAF).length;
  check("burnt tree loses its crown and nothing hangs", crownAfter < crownBefore * 0.3 && lowest(world) === 0 && top(world) - Math.round(world.height[y * 112 + x] * 0.5) < height * 0.6, `${crownBefore} leaves before, ${crownAfter} after, top now ${top(world) - Math.round(world.height[y * 112 + x] * 0.5)}`);
}

// 6. Declared rules: a blight spreads and burns away, wolves hunt, the
// undead burn by day.
{
  seed(3);
  const world = generateWorld(112, 112, 4);
  populate(world);
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  const code = `const spell = {
    materials: [{ name: "blight", layer: "ground", colors: ["#4a2a4a"], spreads: { into: ["grass", "dirt"], rate: 0.8 }, reacts: { fire: "ash" } }],
    creatures: [
      { name: "wolf", base: "beast", color: "#555555", behavior: "hunt", prey: ["villager"], attack: 60, sense: 60, speed: 7 },
      { name: "ghoul", base: "beast", color: "#88aa88", weak: ["light"] },
    ],
    *cast(w) {
      w.paint(w.x, w.y, 3, "blight", 1);
      const v = w.creatures().filter((c) => c.kind === "villager")[0];
      for (let k = 0; k < 3; k++) w.spawn("wolf", v.x + 4, v.y + 4);
      for (let k = 0; k < 3; k++) w.spawn("ghoul", w.x, w.y);
    },
  };`;
  const count = () => {
    let n = 0;
    for (let i = 0; i < world.n; i++) if (world.layerName("ground", world.ground[i]) === "blight") n++;
    return n;
  };
  rt.cast({ key: "rules", name: "Rules", tier: "major", code }, 56, 56);
  step(world, rt);
  const start = count();
  const villagers = () => world.creatures.filter((c) => !c.dead && c.kind === "villager").length;
  const before = villagers();
  world.time = 10; // morning
  for (let k = 0; k < 30 * 8; k++) step(world, rt);
  const spread = count();
  check("blight spreads", errors.length === 0 && spread > start * 2, `${start} then ${spread} cells${errors[0] ? ", " + errors[0] : ""}`);
  check("wolves hunt villagers", villagers() < before, `${before} then ${villagers()} villagers`);
  check("ghouls burn by day", world.creatures.filter((c) => c.kind === "ghoul" && !c.dead).length === 0);
  for (let i = 0; i < world.n; i++) if (world.layerName("ground", world.ground[i]) === "blight") world.fire[i] = 1;
  for (let k = 0; k < 30 * 2; k++) step(world, rt);
  check("blight burns away", count() < spread * 0.3, `${count()} left`);
}

// 7. Challenges: nothing does not win; the solution wins.
const solutions: Record<string, { file: string; tier: "major" | "grand" | "legendary"; at: [number, number][] }> = {
  wildfire: { file: "rain.js", tier: "grand", at: [[16, 56]] },
  lava: { file: "wall.js", tier: "grand", at: [[58, 58]] },
  river: { file: "frost.js", tier: "major", at: [[56, 54]] },
  drought: { file: "bloom.js", tier: "legendary", at: [[56, 56]] },
  flood: { file: "dike.js", tier: "grand", at: [[56, 50]] },
};
for (const scenario of SCENARIOS) {
  for (const withMagic of [false, true]) {
    seed(17);
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
