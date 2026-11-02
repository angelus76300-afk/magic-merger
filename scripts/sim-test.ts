// Fast checks of the simulation, without a browser: `npm test`.
// Generation, the reference spells, the loop guard, saving, and every
// challenge both ways (doing nothing must not win, the right magic must win).
// Bundled with esbuild and run by Node; the voxel view is not involved.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { guardLoops } from "../shared/spellcode";
import { KINDS, populate } from "../src/sim/creatures";
import { C, F } from "../src/sim/materials";
import { Runtime } from "../src/sim/runtime";
import { loadWorld, saveWorld } from "../src/sim/save";
import { SCENARIOS } from "../src/sim/scenarios";
import { generateWorld, type World } from "../src/sim/world";
import { VK, floats, voxelKind } from "../src/sim/voxels";
import { keyCell } from "../src/sim/voxelkey";
import { SOLUTIONS, replay, seed, step, type Replay } from "./challenge-replay";
import { runCheck } from "../src/sim/check";
import { downShare, votedDown, votedUp, votedWorse, votesNeeded } from "../shared/votes";
import { pickExamples, words } from "../worker/programs";
import { verdict, type LinkedPull } from "../worker/feedback";
import { helperProblem, withLibrary } from "../worker/evolve";
import { body, bodyFrom, FEATURES, ITEMS, MAX_MODEL_BOXES, modelOf, PLANS } from "../src/sim/body";
import { names } from "../src/sim/social";
import { AGES, JOBS, packLook, unpackLook } from "../src/sim/villagers";
import { buildRig, type Rig } from "../src/sim/voxel/rigs";
import { SPECIES } from "../src/sim/wildlife";

// Challenges with nothing cast, over several seeds: one seed can pass by
// luck (Wildfire did, at 3 wins in 16). These replays run in worker threads
// while the checks below run here; their results are read in section 8.
const SEEDS = 8;
const idle: Replay[] = SCENARIOS.flatMap((s) => Array.from({ length: SEEDS }, (_, n) => ({ id: s.id, seed: (n + 1) * 7919, magic: false })));
const idleResults = new Map<string, { status: string; errors: string[] }[]>();
const nextIdle = new Int32Array(new SharedArrayBuffer(4));
const idleDone = Promise.all(
  Array.from({ length: Math.min(4, Math.max(2, availableParallelism() - 1)) }, () => {
    const worker = new Worker(new URL("./challenge-worker.mjs", import.meta.url), { workerData: { jobs: idle, next: nextIdle } });
    worker.on("message", ({ job, status, errors }: { job: Replay; status: string; errors: string[] }) => {
      idleResults.set(job.id, [...(idleResults.get(job.id) ?? []), { status, errors }]);
    });
    return new Promise<void>((resolve, reject) => {
      worker.on("error", reject);
      worker.on("exit", () => resolve());
    });
  }),
);

// Everything below is seeded, so a run gives the same answers every time.
seed(1);

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
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
    // Over several islands: whether a wounded imp dies within 20 s or limps
    // away depends on the seed (about 3 in 4 die, before and after 3.5, over
    // 52 seeds); what must hold is that the mob always hurts it badly.
    const ends: string[] = [];
    let beaten = 0;
    for (let n = 1; n <= 6; n++) {
      seed(n);
      const world = generateWorld(112, 112, 4);
      populate(world);
      const errors: string[] = [];
      const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
      const v = world.creatures.find((c) => c.kind === "villager")!;
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
      const imp = world.creatures.find((c) => c.kind === "imp");
      if (!errors.length && imp && (imp.dead || imp.hp < 30)) beaten++;
      ends.push(errors[0] ?? (imp?.dead ? "dead" : `${Math.round(imp?.hp ?? 0)} hp`));
    }
    check("villagers mob a weak monster", beaten >= 5, `${beaten} of 6 killed or under half health: ${ends.join(", ")}`);
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

// 8. Challenges: nothing does not win on any seed; the solution wins.
for (const scenario of SCENARIOS) {
  const plan = SOLUTIONS[scenario.id];
  const { status, errors } = replay({ id: scenario.id, seed: 17, magic: true });
  check(`challenge ${scenario.id} with ${plan.file}`, status === "won" && errors.length === 0, `${status}${errors[0] ? ", " + errors[0] : ""}`);
}
await idleDone;
for (const scenario of SCENARIOS) {
  const runs = idleResults.get(scenario.id) ?? [];
  const tally = (s: string) => runs.filter((r) => r.status === s).length;
  const error = runs.flatMap((r) => r.errors)[0];
  check(
    `challenge ${scenario.id} with nothing, ${SEEDS} seeds`,
    runs.length === SEEDS && tally("won") === 0 && !error,
    `won ${tally("won")}, lost ${tally("lost")}, playing ${tally("playing")}${error ? ", " + error : ""}`,
  );
}

// 9. The test run before a program is stored (3.3): reference spells pass;
// a program that crashes, does nothing visible or wipes the island fails.
// It keeps its own random stream (check.ts), so it shifts nothing above.
{
  const passing: string[] = [];
  const all = [...readdirSync("lab/spells").map((f) => join("lab/spells", f)), ...readdirSync("lab/legacy").map((f) => join("lab/legacy", f))];
  for (const file of all) {
    const code = readFileSync(file, "utf8");
    const tier = (/\((cantrip|minor|major|grand|legendary|cosmic)\)/.exec(code)?.[1] ?? (file.includes("bang") ? "cosmic" : "legendary")) as "major";
    const r = runCheck({ key: file, name: file, tier, code });
    if (!r.ok) passing.push(`${file}: ${r.detail}`);
  }
  check(`test run passes the reference and old programs (${all.length})`, passing.length === 0, passing[0] ?? "");
  const bad: [string, string, string, string][] = [
    ["crash", "minor", "crash", "const spell = { *cast(w) { yield 1; w.nope(); } };"],
    ["no generator", "minor", "crash", "const spell = { cast(w) { return 1; } };"],
    [
      "nothing",
      "major",
      "nothing",
      "const spell = { *cast(w) { w.circle(w.x, w.y, w.r, '#fff', '#f00', 1); w.burst(w.x, w.y, { count: 200, colors: ['#fff'], speed: 5, up: 5, life: 1 }); w.flash('#fff', 1); yield 2; } };",
    ],
    ["wiped", "major", "wiped", "const spell = { *cast(w) { w.flood(w.width / 2, w.height / 2, w.width, 'lava', 3); yield 2; } };"],
  ];
  for (const [name, tier, problem, code] of bad) {
    const r = runCheck({ key: name, name, tier: tier as "major", code });
    check(`test run catches ${name}`, r.problem === problem, r.detail);
  }
  const cosmic = runCheck({ key: "end", name: "end", tier: "cosmic", code: bad[3][3] });
  check("a cosmic spell may wipe the island", cosmic.ok, cosmic.detail);
}

// 9b. A creature raised from the dead stays alive: its fall speed used to
// keep growing while it lay dead, and it died again on landing.
{
  const world = generateWorld(112, 112, 4);
  populate(world);
  const v = world.creatures.find((c) => c.kind === "villager")!;
  v.hp = 0;
  v.dead = true;
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  for (let k = 0; k < 90; k++) step(world, rt);
  const code = `const spell = { *cast(w) { for (const c of w.corpses(${v.x}, ${v.y}, 2)) c.revive(); yield 2; } };`;
  rt.cast({ key: "raise", name: "Raise", tier: "minor", code }, v.x, v.y);
  for (let k = 0; k < 90; k++) step(world, rt);
  check("a revived creature stays alive", !v.dead && v.hp > 0 && !errors.length, `dead ${v.dead}, hp ${Math.round(v.hp)}`);
}

// 9c. Spell blocks never sit inside the land, and a block where a house
// stands knocks it down (3.4: they used to show through each other).
{
  const world = generateWorld(112, 112, 4);
  const house = world.cover.indexOf(C.HOUSE);
  const x = house % world.w;
  const y = Math.floor(house / world.w);
  const top = Math.round(world.height[house] * 0.5);
  const before = world.decor.size;
  world.setVoxel(x, y, top - 1, 0xff0000);
  const buried = world.decor.size - before;
  world.setVoxel(x, y, top, 0xff0000);
  check("no block inside the land; a block on a house replaces it", buried === 0 && world.decor.size === before + 1 && world.cover[house] === C.NONE);
}

// 9d. Wards and promises (3.4.2): a protection spell has to protect. Aegis
// raises a ward and passes the protection probe; Glass Shell builds the
// opaque shell of magic blocks protection spells used to be, and fails it.
// A ward keeps lava out and lightning off what it covers.
{
  const promise = (file: string, tier: "major" | "minor" | "grand") =>
    runCheck({ key: file, name: file, tier, code: readFileSync(join("lab/promises", file), "utf8"), intents: ["protect"] });
  for (const tier of ["minor", "major", "grand"] as const) {
    const aegis = promise("aegis.js", tier);
    check(`a ward keeps its promise (${tier})`, aegis.ok && (aegis.stats.saved ?? 0) >= 0.5, aegis.detail);
  }
  const shell = promise("glass-shell.js", "major");
  check("a shell of blocks breaks the promise", !shell.ok && shell.problem === "promise", `saved ${shell.stats.saved}`);
  const plain = runCheck({ key: "aegis", name: "Aegis", tier: "minor", code: readFileSync("lab/promises/aegis.js", "utf8") });
  check("a ward alone counts as something visible", plain.ok, plain.detail);

  const world = generateWorld(112, 112, 5);
  populate(world);
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  const [x, y] = [56, 56];
  rt.cast({ key: "ward", name: "Ward", tier: "major", code: "const spell = { *cast(w) { w.ward(w.x, w.y, 8, { seconds: 20 }); } };" }, x, y);
  step(world, rt);
  const code = `const spell = { *cast(w) { w.ring(${x}, ${y}, 9, 13, (cx, cy) => w.set(cx, cy, "lava", 2)); w.flood(${x}, ${y}, 6, "lava", 2); w.lightning(${x}, ${y}, { power: 3 }); yield 1; } };`;
  rt.cast({ key: "attack", name: "Attack", tier: "major", code }, x, y);
  for (let k = 0; k < 30 * 5; k++) step(world, rt);
  let inside = 0;
  let burning = 0;
  for (let dy = -6; dy <= 6; dy++)
    for (let dx = -6; dx <= 6; dx++) {
      if (dx * dx + dy * dy > 36) continue;
      const i = (y + dy) * world.w + x + dx;
      if (world.fluid[i] === world.materials.find("lava")!.id && world.depth[i] > 0.05) inside++;
      if (world.fire[i] > 0) burning++;
    }
  check("a ward keeps lava out and lightning off", inside === 0 && burning === 0 && !errors.length, `${inside} lava cells, ${burning} burning inside`);
}

// 9e. The API that grows (3.4.2): a helper is appended to the programs that
// call it, runs inside them like any spell code, and is refused when it
// yields, reaches outside the sandbox or is never called by its example.
{
  const helper = {
    name: "haven",
    code: "function (w, x, y, r, o = {}) { w.ward(x, y, r, { seconds: o.seconds || 20 }); w.circle(x, y, r, '#9fd8ff', '#fff', 1); }",
  };
  const code = "const spell = { *cast(w) { yield 0.5; lib.haven(w, w.x, w.y, w.r); } };";
  const full = withLibrary(code, [helper, { name: "unused", code: "function (w) {}" }]);
  check("a program carries the helpers it calls, only those", full.includes("haven: function") && !full.includes("unused"));
  check("a program that declares lib is left alone", withLibrary("const lib = {}; " + code, [helper]) === "const lib = {}; " + code);
  const r = runCheck({ key: "haven", name: "Haven", tier: "major", code: full, intents: ["protect"] });
  check("a spell built on a helper passes its test run", r.ok, r.detail);
  check("a helper that yields is refused", helperProblem("x", "function (w) { yield 1; }", "lib.x(w)") !== null);
  check("a helper that reaches outside is refused", helperProblem("x", "function (w) { fetch('/'); }", "lib.x(w)") !== null);
  check("a helper its example never calls is refused", helperProblem("x", "function (w) {}", "const spell = { *cast(w) {} };") !== null);
  check("a sound helper is accepted", helperProblem("haven", helper.code, code) === null);
}

// 9f. Many kinds of life (3.5): every plan and feature makes a sound figure,
// names give old spells a body, models stay within 16 boxes, wild animals
// live in their habitat and come back, a spell's wolves stay its own.
{
  const finite = (r: Rig) => r.parts.every((p) => [...p.p, ...p.q, ...p.o, ...p.s].every(Number.isFinite) && p.s.every((v) => v > 0));
  const bad: string[] = [];
  let most = 0;
  for (const plan of PLANS) {
    const plain = buildRig(body(plan));
    if (!finite(plain) || plain.height <= 0) bad.push(plan);
    // Every feature on every plan, and all of them at once (one item).
    for (const f of [...FEATURES, ...ITEMS]) if (!finite(buildRig(body(plan, [f])))) bad.push(`${plan}+${f}`);
    const all = buildRig(body(plan, [...FEATURES, "sword"]));
    most = Math.max(most, all.parts.length);
    if (!finite(all)) bad.push(`${plan}+all`);
  }
  check(`every plan with every feature (${PLANS.length} plans, ${FEATURES.length + ITEMS.length} features)`, !bad.length, bad.slice(0, 5).join(", "));
  check("a figure stays a few dozen boxes", most <= 60, `${most} at most, with every feature`);
  // Villagers: every age and job.
  const looks = AGES.flatMap((age) =>
    JOBS.map((job) => buildRig(body("two legs", [], { villager: true }), packLook({ age, job, style: 0, skin: 0, hair: 0, long: false }))),
  );
  check("every villager age and job", looks.every(finite), `${looks.length} looks`);
  const l = { age: "elder" as const, job: "smith" as const, style: 4, skin: 3, hair: 5, long: true };
  check("a villager's look packs into one number", JSON.stringify(unpackLook(packLook(l))) === JSON.stringify(l));

  const guess = (name: string) => bodyFrom({}, name, KINDS.get("beast")!.body);
  const g = {
    wolf: guess("fire wolf"),
    fly: guess("dragonfly"),
    lich: guess("lich king"),
    spirit: guess("wolf spirit"),
    plain: guess("blorp"),
    declared: bodyFrom({ body: "slime", features: ["crown", "sword", "axe"], color2: "#ff0000" }, "dragon", KINDS.get("beast")!.body),
  };
  check(
    "a body from the name, whole words only",
    g.wolf.plan === "four legs" &&
      g.fly.plan === "insect" &&
      g.fly.features.includes("wings") &&
      g.lich.plan === "two legs" &&
      g.lich.features.includes("crown") &&
      g.spirit.plan === "spirit" &&
      g.plain.plan === "four legs",
    `${g.wolf.plan}, ${g.fly.plan}, ${g.lich.plan} ${g.lich.features}, ${g.spirit.plan}, ${g.plain.plan}`,
  );
  check(
    "what a spell declares wins, one item at most",
    g.declared.plan === "slime" && g.declared.features.join() === "crown,sword" && g.declared.color2 === 0xff0000,
    `${g.declared.plan} ${g.declared.features}`,
  );
  const big = modelOf(Array.from({ length: 40 }, (_, k) => [k, 0, 0, 1, 1, 1, "#fff", k % 2 ? "leg" : "nonsense"]));
  const odd = modelOf([
    [0, 0, 0, 0, 2, 2, "#fff"],
    [1e9, -1e9, 0, 99, 1, 1, "red"],
    "junk",
    { x: 0, y: 0, z: 0, w: 2, h: 2, d: 2, color: "#123456", part: "wing" },
  ]);
  check(
    "a model keeps 16 boxes, bounded",
    big?.length === MAX_MODEL_BOXES && odd?.length === 2 && odd[0].x === 32 && odd[0].w === 32 && odd[0].color === 0xcccccc && odd[1].part === "wing",
    JSON.stringify(odd),
  );
  const modelRig = buildRig(body("two legs", [], { model: big }));
  check("a model is scaled to a creature's size", finite(modelRig) && modelRig.parts.length === 16 && modelRig.height <= 1.71);

  // Habitats: on every island size, each species where it belongs.
  for (const size of [112, 208]) {
    seed(5);
    const world = generateWorld(size, size, 9);
    populate(world);
    const wrong = world.creatures.filter((c) => {
      const i = world.idx(c.x, c.y);
      const k = KINDS.get(c.kind)!;
      if (c.kind === "fish") return world.fluid[i] !== F.WATER;
      // Birds are born in trees and fly.
      if (!k.native || k.flying) return false;
      return world.depth[i] > 0.05 || world.materials.get("cover", world.cover[i]).solid;
    });
    const kinds = new Set(world.creatures.map((c) => c.kind));
    const missing = SPECIES.map((s) => s.kind.name).filter((n) => !kinds.has(n));
    check(
      `wild animals in their habitat (${size})`,
      !wrong.length && !missing.length,
      `${wrong.length} misplaced${wrong.length ? ` (${wrong.map((c) => c.kind).join(",")})` : ""}, missing ${missing.join(",") || "none"}`,
    );
  }
  {
    // Kill every deer: they come back while there is a forest edge.
    seed(6);
    const world = generateWorld(112, 112, 4);
    populate(world);
    const rt = new Runtime(world, () => {});
    for (const c of world.creatures) if (c.kind === "deer") c.dead = true;
    for (let k = 0; k < 30 * 60; k++) step(world, rt);
    const deer = world.creatures.filter((c) => c.kind === "deer" && !c.dead).length;
    check("wild animals come back in their habitat", deer >= 1, `${deer} deer after a minute`);
    // A fish on dry land chokes.
    const fish = world.creatures.find((c) => c.kind === "fish" && !c.dead)!;
    const land = world.creatures.find((c) => c.kind === "villager")!;
    fish.x = land.x;
    fish.y = land.y;
    for (let k = 0; k < 30 * 3; k++) step(world, rt);
    check("a fish out of water dies", fish.dead);
  }
  {
    // A spell's own wolves hunt villagers; the island's wolves still do not.
    seed(7);
    const world = generateWorld(112, 112, 4);
    populate(world);
    const errors: string[] = [];
    const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
    const code = `const spell = { creatures: [{ name: "wolf", base: "beast", body: "four legs", features: ["glowing eyes"], behavior: "hunt", prey: ["villager"], attack: 30 }], *cast(w) { const c = w.spawn("wolf", w.x, w.y); c.data.mine = c.kind; } };`;
    rt.cast({ key: "summon wolf", name: "Summon Wolf", tier: "minor", code }, 56, 56);
    step(world, rt);
    const mine = world.creatures.filter((c) => c.kind.startsWith("wolf#"));
    const wild = world.creatures.filter((c) => c.kind === "wolf");
    const wildKind = KINDS.get("wolf")!;
    check(
      "a spell's wolf is its own, the island's wolves unchanged",
      !errors.length &&
        mine.length === 1 &&
        mine[0].data.mine === "wolf" &&
        wild.length > 0 &&
        wildKind.native &&
        !wildKind.ai!.prey.includes("villager") &&
        KINDS.get(mine[0].kind)!.body.features.includes("glowing eyes"),
      `${errors[0] ?? ""} ${mine.length} own, ${wild.length} wild`,
    );
    // A scarecrow written before 3.5 ("beast") scares the island's animals too.
    check(
      "beast names the wild animals",
      names(["beast"], "deer") && names(["animals"], "bear") && !names(["beast"], "villager") && names(["wolves"], "wolf#abc"),
    );
  }
  {
    // Looks survive a save; a save from before 3.5 gets dressed by village.
    seed(8);
    const world = generateWorld(112, 112, 4);
    populate(world);
    const back = loadWorld(JSON.parse(JSON.stringify(saveWorld(world, new Map()))), () => {})!;
    const same = world.creatures.filter((c) => !c.dead).every((c, n) => back.creatures[n].look === c.look && back.creatures[n].kind === c.kind);
    const old = saveWorld(world, new Map());
    for (const c of old.creatures) delete c.look;
    const dressed = loadWorld(JSON.parse(JSON.stringify(old)), () => {})!.creatures.filter((c) => c.kind === "villager");
    const styles = new Set(dressed.map((c) => unpackLook(c.look).style));
    check(
      "villagers' looks are saved; old saves get village clothes",
      same && dressed.every((c) => unpackLook(c.look).age === "adult") && styles.size >= 2,
      `${styles.size} village styles`,
    );
  }
}

// 10. Votes: how many are needed, when they rewrite, roll back or reach the library.
{
  check("one player: one vote is enough", votesNeeded(1) === 1 && votesNeeded(0) === 1 && votesNeeded(0.3) === 1);
  check("a tenth of daily players, capped at 25", votesNeeded(40) === 4 && votesNeeded(150) === 15 && votesNeeded(1000) === 25);
  check("60% down rewrites", votedDown({ up: 2, down: 3 }, 5) && !votedDown({ up: 3, down: 2 }, 5) && !votedDown({ up: 0, down: 3 }, 4));
  check("60% up joins the library", votedUp({ up: 3, down: 2 }, 5) && !votedUp({ up: 1, down: 0 }, 2));
  check("rolled back when voted worse", votedWorse({ up: 0, down: 2 }, { up: 1, down: 2 }, 2) && !votedWorse({ up: 1, down: 1 }, { up: 0, down: 1 }, 1));
  check("down share", downShare({ up: 1, down: 3 }) === 0.75 && downShare({ up: 0, down: 0 }) === 0);
  const library = [
    { key: "inferno", name: "Inferno", tier: "grand", kind: "spell", description: "A roaring fire that burns the forest", code: "a" },
    { key: "golem", name: "Golem", tier: "minor", kind: "artifact", description: "A stone giant who guards villagers", code: "b" },
    { key: "blizzard", name: "Blizzard", tier: "grand", kind: "spell", description: "Snow and ice freeze the lakes", code: "c" },
  ];
  const picked = pickExamples(
    library,
    { key: "wildfire", name: "Wildfire", description: "Fire races through the forest and burns villages", kind: "spell", tier: "major" },
    1,
  );
  check("the library finds the closest program", picked[0]?.name === "Inferno", picked.map((p) => p.name).join(","));
  check("words are stemmed", words("Burning forests").has("burn") && words("Burning forests").has("forest"));
}

// The Feedback tab (3.4.1): what an idea sent to Claude has become, from its
// GitHub issue and the pull requests that mention it.
{
  const pr = (number: number, at: number, state: "open" | "merged" | "closed"): LinkedPull => ({
    number,
    url: `https://github.com/o/r/pull/${number}`,
    open: state === "open",
    merged: state === "merged",
    at,
  });
  const open = { open: true, reason: null };
  check("feedback: no pull request yet, still sent", verdict(100, open, []).status === "sent");
  check("feedback: an open pull request is in review", verdict(100, open, [pr(7, 150, "open")]).pr?.number === 7);
  check("feedback: a merged one wins over a newer open one", verdict(100, open, [pr(7, 150, "merged"), pr(9, 160, "open")]).status === "shipped");
  const dropped = verdict(100, open, [pr(7, 150, "closed")]);
  check("feedback: closed unmerged after the send, declined", dropped.status === "declined" && !!dropped.note);
  check("feedback: closed unmerged before a new send, still sent", verdict(200, open, [pr(7, 150, "closed")]).status === "sent");
  check("feedback: the issue closed as not planned, declined", verdict(100, { open: false, reason: "not_planned" }, []).status === "declined");
  check("feedback: the issue closed as done, shipped", verdict(100, { open: false, reason: "completed" }, []).status === "shipped");
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
