// Fast checks of the simulation, without a browser: `npm test`.
// Generation, the reference spells, the loop guard, saving, and every
// challenge both ways (doing nothing must not win, the right magic must win).
// Bundled with esbuild and run by Node; the voxel view is not involved.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { guardLoops } from "../shared/spellcode";
import { lifeCycle, populate, resetCreatureIds, updateCreature } from "../src/sim/creatures";
import { C } from "../src/sim/materials";
import { stepPhysics } from "../src/sim/physics";
import { Runtime } from "../src/sim/runtime";
import { loadWorld, saveWorld } from "../src/sim/save";
import { SCENARIOS } from "../src/sim/scenarios";
import { TICK, generateWorld, type World } from "../src/sim/world";
import { VK, floats, voxelKind } from "../src/sim/voxels";
import { keyCell } from "../src/sim/voxelkey";

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

// Everything below is seeded, so a run gives the same answers every time.
seed(1);

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
  check(
    `world ${size}`,
    share > 0.08 && share < 0.4 && houses > 0 && people > 0,
    `water ${(share * 100).toFixed(0)}%, ${houses / 4} houses, ${people} villagers`,
  );
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

// 2b. Programs written for older World API versions still run: they are
// never rewritten in bulk, so the API must stay backward compatible.
// Its own random stream, so adding a file never shifts the checks below.
{
  const shared = Math.random;
  seed(2);
  const legacyDir = "lab/legacy";
  const files = readdirSync(legacyDir).filter((f) => f.endsWith(".js"));
  const broken: string[] = [];
  for (const file of files) {
    const code = readFileSync(join(legacyDir, file), "utf8");
    const tier = (/\((cantrip|minor|major|grand|legendary|cosmic)\)/.exec(code)?.[1] ?? "major") as "major";
    const world = generateWorld(112, 112, 9);
    populate(world);
    const errors: string[] = [];
    const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
    const ok = rt.cast({ key: file, name: file, tier, code }, 56, 56);
    for (let k = 0; k < 30 * 6 && !errors.length; k++) step(world, rt);
    if (!ok || errors.length) broken.push(`${file}: ${errors[0] ?? "did not start"}`);
  }
  check(`old programs still run (${files.length})`, files.length > 0 && broken.length === 0, broken[0] ?? "");
  Math.random = shared;
}

// 3. A spell that loops forever is stopped, not frozen.
{
  const world = generateWorld(112, 112, 3);
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  rt.cast({ key: "loop", name: "Loop", tier: "minor", code: "const spell = { *cast(w) { while (true) {} } };" }, 50, 50);
  step(world, rt);
  check(
    "endless loop is stopped",
    errors.some((e) => e.includes("too long")),
    errors[0] ?? "no error",
  );
  check("loop guard covers bodiless loops", guardLoops("for(;;) x++;").includes("__g()"));
  const lines: string[] = [];
  const rt2 = new Runtime(world, (_k, _n, m) => lines.push(m));
  rt2.cast({ key: "line", name: "Line", tier: "minor", code: "const spell = {\n  *cast(w) {\n    w.nothing();\n  },\n};" }, 50, 50);
  step(world, rt2);
  check(
    "errors name the right line",
    lines.some((m) => m.includes("(line 3)")),
    lines[0] ?? "no error",
  );
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
      // A voxel on its way down is falling, not hanging.
      if (floats(voxelKind(v)) || world.voxels.falling.has(key) || level <= Math.round(world.height[y * world.w + x] * 0.5)) continue;
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
  rt.cast(
    {
      key: "kit",
      name: "Kit",
      tier: "grand",
      code: `const spell = { *cast(w) { w.tree(w.x, w.y, { style: "oak", height: 24, grow: 1 }); w.voxel(w.x + 2, w.y, 60, "#ffffff"); w.voxel(w.x - 2, w.y, 60, "#b48cff", "magic"); } };`,
    },
    x,
    y,
  );
  for (let k = 0; k < 30 * 6; k++) step(world, rt);
  const top = (w: World) => Math.max(...[...w.decor.entries()].filter(([, v]) => !floats(voxelKind(v))).map(([key]) => keyCell(key).level));
  const grown = world.decor.size;
  const height = top(world) - Math.round(world.height[y * 112 + x] * 0.5);
  check(
    "grown tree stands",
    errors.length === 0 && grown > 300 && height > 20 && lowest(world) === 0,
    `${grown} voxels, ${height} high, ${lowest(world)} hanging, ${errors[0] ?? "no errors"}`,
  );
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
  check(
    "burnt tree loses its crown and nothing hangs",
    crownAfter < crownBefore * 0.3 && lowest(world) === 0 && top(world) - Math.round(world.height[y * 112 + x] * 0.5) < height * 0.6,
    `${crownBefore} leaves before, ${crownAfter} after, top now ${top(world) - Math.round(world.height[y * 112 + x] * 0.5)}`,
  );
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

// 7. Interactions: gold draws villagers who carry it home and the village
// grows; vampires spread at night; a mob kills a weak monster; a landmark
// keeps beasts away.
{
  const villageWorld = () => {
    seed(8);
    const world = generateWorld(112, 112, 4);
    populate(world);
    const errors: string[] = [];
    const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
    const v = world.creatures.find((c) => c.kind === "villager")!;
    return { world, rt, errors, v };
  };
  const houses = (world: World) => {
    let n = 0;
    for (let i = 0; i < world.n; i++) if (world.cover[i] === C.HOUSE) n++;
    return n;
  };
  {
    const { world, rt, errors, v } = villageWorld();
    const before = houses(world);
    rt.cast(
      {
        key: "gold",
        name: "Gold",
        tier: "minor",
        code: `const spell = { materials: [{ name: "gold", layer: "ground", colors: ["#ffd23d"], lures: ["villager"], taken: true }], *cast(w) { w.paint(w.x, w.y, 3, "gold", 1); } };`,
      },
      v.x + 6,
      v.y + 6,
    );
    for (let k = 0; k < 30 * 60; k++) step(world, rt);
    check(
      "gold draws villagers and grows the village",
      errors.length === 0 && world.wealth >= 4 && houses(world) > before,
      `wealth ${world.wealth}, houses ${before / 4} then ${houses(world) / 4}${errors[0] ? ", " + errors[0] : ""}`,
    );
  }
  {
    const { world, rt, errors, v } = villageWorld();
    world.time = 262; // the middle of the night
    rt.cast(
      {
        key: "vamp",
        name: "Vampire",
        tier: "minor",
        code: `const spell = { creatures: [{ name: "vampire", base: "beast", color: "#3a0d1e", behavior: "hunt", prey: ["villager"], attack: 60, converts: true, active: "night", speed: 6, hp: 400 }], *cast(w) { w.spawn("vampire", w.x, w.y); w.spawn("vampire", w.x + 1, w.y); } };`,
      },
      v.x + 3,
      v.y + 3,
    );
    for (let k = 0; k < 30 * 15; k++) step(world, rt);
    const vampires = world.creatures.filter((c) => !c.dead && c.kind === "vampire").length;
    check("vampires turn villagers at night", errors.length === 0 && vampires > 2, `${vampires} vampires`);
  }
  {
    const { world, rt, errors, v } = villageWorld();
    rt.cast(
      {
        key: "imp",
        name: "Imp",
        tier: "minor",
        code: `const spell = { creatures: [{ name: "imp", base: "beast", color: "#aa3333", behavior: "hunt", prey: ["villager"], attack: 5, hp: 60, speed: 2 }], *cast(w) { w.spawn("imp", w.x, w.y); } };`,
      },
      v.x,
      v.y,
    );
    for (let k = 0; k < 30 * 20; k++) step(world, rt);
    const imps = world.creatures.filter((c) => !c.dead && c.kind === "imp").length;
    check("villagers mob a weak monster", errors.length === 0 && imps === 0, `${imps} imps left`);
  }
  {
    const { world, rt, errors } = villageWorld();
    // An inland spot with room to run: no water within 14 cells.
    let at = { x: 56, y: 56 };
    search: for (let y = 20; y < 92; y += 4) {
      for (let x = 20; x < 92; x += 4) {
        let dry = true;
        for (let dy = -14; dy <= 14 && dry; dy += 2)
          for (let dx = -14; dx <= 14 && dry; dx += 2) if (world.depth[(y + dy) * world.w + x + dx] > 0.05) dry = false;
        if (dry) {
          at = { x, y };
          break search;
        }
      }
    }
    rt.cast(
      {
        key: "scare",
        name: "Scarecrow",
        tier: "minor",
        code: `const spell = { *cast(w) { w.landmark(w.x, w.y, { scares: ["beast"], radius: 10 }); for (let k = 0; k < 4; k++) w.spawn("beast", w.x + k % 2, w.y + 1); } };`,
      },
      at.x,
      at.y,
    );
    for (let k = 0; k < 30 * 12; k++) step(world, rt);
    const near = world.creatures.filter((c) => !c.dead && c.kind === "beast" && Math.hypot(c.x - at.x, c.y - at.y) < 8);
    check(
      "a landmark keeps beasts away",
      errors.length === 0 && near.length === 0,
      `${near.length} beasts still near: ${near.map((c) => `at ${c.x.toFixed(1)},${c.y.toFixed(1)} from ${at.x.toFixed(1)},${at.y.toFixed(1)}, ${Math.hypot(c.x - at.x, c.y - at.y).toFixed(1)} cells, mood ${c.data.mood}, frozen ${c.frozen.toFixed(1)}, depth ${world.depth[Math.floor(c.y) * world.w + Math.floor(c.x)].toFixed(2)}`).join("; ")}`,
    );
  }
}

// 8. Challenges: nothing does not win; the solution wins.
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
    resetCreatureIds();
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
    check(
      `challenge ${scenario.id} ${withMagic ? "with " + plan.file : "with nothing"}`,
      want && errors.length === 0,
      `${status}${errors[0] ? ", " + errors[0] : ""}`,
    );
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
