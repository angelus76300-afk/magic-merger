// Fast checks of the simulation, without a browser: `npm test`.
// Generation, the reference spells, the loop guard, saving, and every
// challenge both ways (doing nothing must not win, the right magic must win).
// Bundled with esbuild and run by Node; the voxel view is not involved.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { guardLoops } from "../shared/spellcode";
import { KINDS, makeCreature, populate } from "../src/sim/creatures";
import { goalOfCreature } from "../src/sim/goals";
import { abilitiesFrom } from "../src/sim/abilities";
import { logDeeds, mindOf } from "../src/sim/kin";
import { C, F } from "../src/sim/materials";
import { Runtime } from "../src/sim/runtime";
import { loadWorld, saveWorld } from "../src/sim/save";
import { SCENARIOS } from "../src/sim/scenarios";
import { generateWorld, type World } from "../src/sim/world";
import { VK, floats, voxelKind } from "../src/sim/voxels";
import { keyCell } from "../src/sim/voxelkey";
import { SOLUTIONS, replay, seed, step } from "./challenge-replay";
import type { Job } from "./challenge-worker";
import { runCheck, type SceneReport } from "../src/sim/check";
import { downShare, votedDown, votedUp, votedWorse, votesNeeded } from "../shared/votes";
import { pickExamples, words } from "../worker/programs";
import { verdict, type LinkedPull } from "../worker/feedback";
import { helperProblem, withLibrary } from "../worker/evolve";
import { body, bodyFrom, FEATURES, ITEMS, MAX_MODEL_BOXES, modelOf, PLANS } from "../src/sim/body";
import { names } from "../src/sim/social";
import { AGES, JOBS, packLook, unpackLook, type Job as Job3 } from "../src/sim/villagers";
import { buildRig, type Rig } from "../src/sim/voxel/rigs";
import { SPECIES } from "../src/sim/wildlife";

// Challenges with nothing cast, over several seeds: one seed can pass by
// luck (Wildfire did, at 3 wins in 16). These replays run in worker threads
// while the checks below run here; their results are read in section 8.
const SEEDS = 8;
// The five minute scene (3.6): ten simulated minutes, on three streams of
// life for the same island, so one lucky run cannot pass it. First in the
// queue: they are the longest jobs.
const SCENE_STREAMS = 3;
const SCENE_SECONDS = 600;
const idle: Job[] = [
  ...Array.from({ length: SCENE_STREAMS }, (_, n) => ({ scene: n, seconds: SCENE_SECONDS })),
  ...SCENARIOS.flatMap((s) => Array.from({ length: SEEDS }, (_, n) => ({ id: s.id, seed: (n + 1) * 7919, magic: false }))),
];
const idleResults = new Map<string, { status: string; errors: string[] }[]>();
const sceneReports: { stream: number; report: SceneReport }[] = [];
const nextIdle = new Int32Array(new SharedArrayBuffer(4));
const idleDone = Promise.all(
  Array.from({ length: Math.min(4, Math.max(2, availableParallelism() - 1)) }, () => {
    const worker = new Worker(new URL("./challenge-worker.mjs", import.meta.url), { workerData: { jobs: idle, next: nextIdle } });
    worker.on("message", ({ job, status, errors, report }: { job: Job; status: string; errors: string[]; report?: SceneReport }) => {
      if (report && "scene" in job) sceneReports.push({ stream: job.scene, report });
      else if ("id" in job) idleResults.set(job.id, [...(idleResults.get(job.id) ?? []), { status, errors }]);
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

// 8b. The five minute scene (3.6, check.ts sceneRun): a village, a forest,
// wolves, a dragon, a vampire, gold and a shrine, left alone for ten
// simulated minutes on three streams of life. Every creature that lived five
// minutes changed something; no kind of three or more vanished (fell under a
// third of its number) and none exploded (past two and a half times it).
for (const { stream, report: r } of sceneReports.sort((a, b) => a.stream - b.stream)) {
  const kinds = Object.entries(r.kinds);
  const vanished = kinds.filter(([, v]) => v.start >= 3 && v.min < Math.ceil(v.start / 3)).map(([k]) => k);
  const exploded = kinds.filter(([, v]) => v.max > Math.max(v.start * 2.5, v.start + 3)).map(([k]) => `${k} ${v.start} to ${v.max}`);
  const lively = Object.values(r.lively).reduce((a, [d, n]) => [a[0] + d, a[1] + n], [0, 0]);
  check(
    `five minute scene, stream ${stream}: every creature changed something`,
    !r.errors.length && r.idle.length === 0,
    `${lively[0]} of ${lively[1]} creatures changed something; idle after five minutes: ${r.idle.map((c) => `${c.kind} (${c.action})`).join(", ") || "none"}${r.errors[0] ? `; ${r.errors[0]}` : ""}`,
  );
  check(
    `five minute scene, stream ${stream}: populations neither vanish nor explode`,
    !vanished.length && !exploded.length,
    kinds.map(([k, v]) => `${k} ${v.start}>${v.end} (${v.min}-${v.max})`).join(", "),
  );
  check(
    `five minute scene, stream ${stream}: goals leave marks`,
    (r.marks.hoard ?? 0) > 0 && (r.marks.den ?? 0) > 0 && (r.marks.offerings ?? 0) > 0,
    `${JSON.stringify(r.marks)}, tick ${r.meanTickMs} ms mean, ${r.worstTickMs} ms worst`,
  );
}
check(`five minute scene ran on ${SCENE_STREAMS} streams`, sceneReports.length === SCENE_STREAMS);

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
    // Dry land (villagers since 3.6 go fishing, so not where one stands).
    const dry = world.ground.findIndex((g, i) => g === 0 && world.depth[i] === 0 && world.cover[i] === C.NONE && i > world.n / 3);
    fish.x = dry % world.w;
    fish.y = Math.floor(dry / world.w);
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

// 9g. Goals and abilities (3.6): where a kind's goal comes from, jobs as
// goals, an ability on its trigger and cooldown, healing, taming, the work of
// a village, and minds kept by a save.
{
  seed(9);
  const world = generateWorld(112, 112, 4);
  populate(world);
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  rt.compile({
    key: "goals",
    name: "Goals",
    tier: "minor",
    code: `const spell = { creatures: [
      { name: "fire dragon", base: "beast" },
      { name: "goblin thief", base: "beast" },
      { name: "wolf spirit", base: "spirit" },
      { name: "night stalker", base: "beast", behavior: "hunt", prey: ["villager"] },
      { name: "blorp", base: "golem" },
      { name: "ice witch", base: "villager", goal: "tend", abilities: [{ do: "freeze", when: "enemy near", every: 5 }, "heal", { do: "nonsense" }] },
    ], *cast(w) {} };`,
  });
  const k = (n: string) => KINDS.get(n)!;
  check(
    "a goal from what a kind declares, then its behavior, its name, its base",
    k("ice witch").goal === "tend" &&
      k("ice witch").needs === true &&
      k("night stalker").goal === "hunt" &&
      k("fire dragon").goal === "hoard" &&
      k("goblin thief").goal === "steal" &&
      k("wolf spirit").goal === "explore" &&
      k("blorp").goal === "guard" &&
      !k("fire dragon").needs &&
      k("wolf").goal === "hunt" &&
      k("fish").goal === "migrate" &&
      k("bird").goal === "spread",
    ["ice witch", "night stalker", "fire dragon", "goblin thief", "wolf spirit", "blorp"].map((n) => `${n} ${k(n).goal}`).join(", "),
  );
  check(
    "abilities declared or read from the name, bounded",
    k("ice witch")
      .abilities!.map((a) => `${a.do}/${a.when}/${a.every}`)
      .join() === "freeze/enemy near/5,heal/every so often/12" &&
      k("fire dragon").abilities!.some((a) => a.do === "breathe fire") &&
      k("goblin thief").abilities!.some((a) => a.do === "steal") &&
      abilitiesFrom([{ do: "lightning", every: 0.1 }])![0].every === 3,
    JSON.stringify(k("ice witch").abilities),
  );
  const villager = (job: Job3, age: "adult" | "child" | "elder" = "adult") => {
    const c = makeCreature("villager", 10, 10);
    c.look = packLook({ age, job, style: 0, skin: 0, hair: 0, long: false });
    return goalOfCreature(c, KINDS.get("villager")!);
  };
  check(
    "villagers' jobs are goals",
    villager("farmer") === "tend" &&
      villager("woodcutter") === "gather" &&
      villager("builder") === "build" &&
      villager("priest") === "worship" &&
      villager("guard") === "guard" &&
      villager("merchant") === "explore" &&
      villager("none", "child") === "gather" &&
      villager("fisher", "elder") === "tend",
  );

  // A witch freezes what hunts her, no more often than her cooldown.
  const witch = makeCreature("ice witch", 56, 56);
  const stalker = makeCreature("night stalker", 59, 56);
  KINDS.get("night stalker")!.ai!.prey = ["ice witch"];
  world.creatures.push(witch, stalker);
  let frozen = 0;
  for (let t = 0; t < 30 * 12; t++) {
    step(world, rt);
    if (stalker.frozen > 2.9) frozen++;
    stalker.hp = 400;
    witch.hp = 100;
    // Kept close: the test is the trigger and the cooldown, not the chase.
    stalker.x = witch.x + 3;
    stalker.y = witch.y;
  }
  const freezes = witch.mind?.deeds ?? 0;
  check(
    "an ability fires on its trigger, within its cooldown",
    frozen >= 1 && freezes >= 2 && freezes <= 4 && !errors.length,
    `${freezes} freezes in 12 s, every 5 s`,
  );

  // A priest heals the wounded around them.
  const v = world.creatures.find((c) => c.kind === "villager" && !c.dead)!;
  const priest = makeCreature("villager", v.x + 1, v.y);
  priest.look = packLook({ age: "adult", job: "priest", style: 0, skin: 0, hair: 0, long: false });
  priest.homeX = v.homeX;
  priest.homeY = v.homeY;
  world.creatures.push(priest);
  const full = v.hp;
  v.hp = full * 0.5;
  const log = logDeeds(true)!;
  for (let t = 0; t < 30 * 4; t++) {
    step(world, rt);
    priest.x = v.x + 1;
    priest.y = v.y;
  }
  check(
    "a priest heals the wounded",
    v.hp > full * 0.8 && [...log.keys()].some((d) => d.startsWith("healed")),
    `hp ${Math.round(full / 2)} then ${Math.round(v.hp)} of ${Math.round(full)}, ${[...log.entries()].filter(([d]) => d.startsWith("heal")).map(([d, n]) => `${d} ${n}`)}, priest ${priest.dead ? "dead" : "alive"}`,
  );

  // A hungry deer that begs near the village is fed, and the third meal tames it.
  const village = world.villages[0];
  village.food = 20;
  const deer = makeCreature("deer", village.x, village.y);
  world.creatures.push(deer);
  const dm = mindOf(deer);
  dm.fed = 2;
  dm.hunger = 0.9;
  world.time = 30; // a morning
  for (let t = 0; t < 30 * 30 && !dm.tame; t++) {
    if (dm.task !== "beg") {
      dm.task = "beg";
      dm.tx = village.x;
      dm.ty = village.y;
    }
    // Keep a villager by it.
    const near = world.creatures.find((c) => c.kind === "villager" && !c.dead && c !== priest)!;
    near.x = deer.x + 1;
    near.y = deer.y;
    near.fear = 0;
    step(world, rt);
  }
  check("villagers feed a begging animal, and tame it", dm.tame > 0 && dm.fed >= 3, `fed ${dm.fed}, tame ${dm.tame}`);

  // Minds, villages and marks survive a save.
  dm.carry = "food";
  dm.memory = [{ kind: "wolf", feel: -2 }];
  world.marks.push({ kind: "hoard", x: 30, y: 30, size: 5, by: "dragon" });
  const back = loadWorld(JSON.parse(JSON.stringify(saveWorld(world, rt.owners))), (w) => {
    const rt2 = new Runtime(w, () => {});
    rt2.compile({ key: "goals", name: "Goals", tier: "minor", code: "const spell = { creatures: [], *cast(w) {} };" });
  })!;
  const deer2 = back.creatures.find((c) => c.kind === "deer" && c.mind?.tame);
  check(
    "minds, villages and marks are saved",
    !!deer2 &&
      deer2.mind!.carry === "food" &&
      deer2.mind!.memory[0]?.kind === "wolf" &&
      back.villages.length === world.villages.length &&
      back.marks.some((m) => m.kind === "hoard" && m.size === 5),
    `${back.villages.length} villages, ${back.marks.length} marks`,
  );
  logDeeds(false);
}
{
  // A village at work for two minutes: trees felled for wood, fields sown and
  // harvested, food brought home. This island's one fisher lives in the
  // woods, far from water, so fish are counted but not asked for.
  seed(10);
  const world = generateWorld(152, 152, 7);
  populate(world);
  const rt = new Runtime(world, () => {});
  const log = logDeeds(true)!;
  const stumps = () => world.cover.reduce((n, c) => n + (c === C.STUMP ? 1 : 0), 0);
  const before = stumps();
  for (let t = 0; t < 30 * 120; t++) step(world, rt);
  const did = (w: string) => [...log.entries()].filter(([d]) => d.includes(w)).reduce((n, [, v]) => n + v, 0);
  check(
    "villagers work at their jobs",
    did("felled a tree") > 0 && did("harvested") + did("sowed") > 0 && did("brought") > 0 && stumps() > before,
    ["felled a tree", "sowed", "harvested", "caught a fish", "brought", "picked", "planted", "ate", "spread", "dug a den"]
      .map((w) => `${w} ${did(w)}`)
      .join(", "),
  );
  logDeeds(false);
}

// 9h. Goals, jobs and abilities a spell invents (3.6), beyond the twelve: an
// alchemist that turns flowers into crystal, villagers hired as moss
// gatherers who bring food home, an ability written as code, a job kept by a
// save, and an act that throws is switched off, not the world.
{
  seed(12);
  const world = generateWorld(112, 112, 4);
  populate(world);
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  const v = world.creatures.find((c) => c.kind === "villager" && (c.look & 3) === 0)!;
  const code = `const spell = {
    goals: [
      { name: "brew potions", seek: "flower", near: 30, work: 1, act(self, w, x, y) { w.set(x, y, "crystal"); w.clear(x, y, "cover"); } },
      { name: "gather moss", seek: "grass", near: 12, work: 1, carry: "food", act(self, w, x, y) { w.set(x, y, "dirt"); } },
      { name: "break things", seek: "anywhere", work: 0.5, act() { throw new Error("broken on purpose"); } },
    ],
    creatures: [
      { name: "alchemist", base: "villager", goal: "brew potions",
        abilities: [{ name: "moonbeam", when: "every so often", every: 4, act(self, w) { w.set(self.x, self.y, "snow"); } }] },
      { name: "breaker", base: "beast", goal: "break things" },
    ],
    *cast(w) {
      w.spawn("alchemist", w.x, w.y);
      w.spawn("breaker", w.x + 2, w.y);
      w.hire("gather moss", w.x, w.y, 3);
    },
  };`;
  const crystal = () => world.ground.reduce((n, g, i) => n + (world.layerName("ground", g) === "crystal" && world.cover[i] === C.NONE ? 1 : 0), 0);
  const before = crystal();
  for (let i = 0; i < world.n; i += 37) if (world.ground[i] === 0 && world.cover[i] === C.NONE && world.depth[i] === 0) world.setCover(i, C.FLOWER);
  const village = () => world.villages.reduce((n, x) => n + x.food, 0);
  rt.cast({ key: "alchemy", name: "Alchemy", tier: "minor", code }, v.x, v.y);
  step(world, rt);
  const food0 = village();
  const hired = world.creatures.filter((c) => c.mind?.job === "gather moss");
  for (let t = 0; t < 30 * 40; t++) step(world, rt);
  const alchemist = world.creatures.find((c) => c.kind === "alchemist")!;
  const kind = KINDS.get("alchemist")!;
  check(
    "a spell's own goal: sought, worked, and its code changes the land",
    kind.goal === "brew potions" && kind.needs === true && crystal() > before && (alchemist.mind?.deeds ?? 0) > 0,
    `${crystal() - before} flowers turned to crystal, did ${alchemist.mind?.did}`,
  );
  check(
    "its own ability, written as code, fires on its trigger",
    kind.abilities?.[0]?.do === "moonbeam" && world.ground.some((g) => world.layerName("ground", g) === "snow"),
    JSON.stringify(kind.abilities?.map((a) => a.do)),
  );
  check(
    "villagers hired for a spell's job do it and bring food home",
    hired.length === 3 && hired.some((c) => (c.mind?.deeds ?? 0) > 0 && c.mind?.did.length) && village() > food0 - 20,
    `${hired.length} hired, last did ${hired.map((c) => c.mind?.did).join("; ")}`,
  );
  check(
    "a goal whose code throws is switched off, not the world",
    errors.some((e) => e.includes("broken on purpose")) && errors.length === 1,
    errors.join(" | "),
  );
  const back = loadWorld(JSON.parse(JSON.stringify(saveWorld(world, rt.owners))), (w) =>
    new Runtime(w, () => {}).compile({ key: "alchemy", name: "Alchemy", tier: "minor", code }),
  )!;
  check("a hired job is saved by its name", back.creatures.filter((c) => c.mind?.job === "gather moss").length === 3);
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
  const open = { open: true, reason: null, labels: [] };
  const asking = { open: true, reason: null, labels: ["feedback", "needs-info"] };
  check("feedback: no pull request yet, still sent", verdict(100, open, []).status === "sent");
  check("feedback: an open pull request is in review", verdict(100, open, [pr(7, 150, "open")]).pr?.number === 7);
  check("feedback: a merged one wins over a newer open one", verdict(100, open, [pr(7, 150, "merged"), pr(9, 160, "open")]).status === "shipped");
  const dropped = verdict(100, open, [pr(7, 150, "closed")]);
  check("feedback: closed unmerged after the send, declined", dropped.status === "declined" && !!dropped.note);
  check("feedback: closed unmerged before a new send, still sent", verdict(200, open, [pr(7, 150, "closed")]).status === "sent");
  check("feedback: the issue closed as not planned, declined", verdict(100, { open: false, reason: "not_planned", labels: [] }, []).status === "declined");
  check("feedback: Claude asked on the issue (needs-info), a question", verdict(100, asking, []).status === "question");
  check("feedback: a pull request wins over an old question", verdict(100, asking, [pr(7, 150, "open")]).status === "review");
  check("feedback: the issue closed as done, shipped", verdict(100, { open: false, reason: "completed", labels: [] }, []).status === "shipped");
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
