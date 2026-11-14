// 4.12 steps 3 and 4: reading the island (src/sim/reading.ts, w.here,
// w.wouldHurt, w.nearest, w.fights, w.nature), the writer's worked example
// that acts differently on water, in a village and on bare rock, and the
// soft "smart" problem of the test run (src/sim/check.ts). Each check fails
// on main, where none of these exist.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { generateWorld, type World } from "../src/sim/world";
import { populate, resetCreatureIds } from "../src/sim/creatures";
import { findVillages } from "../src/sim/kin";
import { Runtime, SpellApi } from "../src/sim/runtime";
import { F } from "../src/sim/materials";
import { readHere } from "../src/sim/reading";
import { JUDGING_NAME, runCheck, smartProblem } from "../src/sim/check";
import { FORM_EXAMPLES, FOX_SPIRIT_EXAMPLE, PERSON_EXAMPLE, SPELL_SYSTEM, spellUserMessage } from "../worker/prompts";
import { seed, step } from "./challenge-replay";
import { seeded } from "../src/sim/noise";

type Check = (name: string, ok: boolean, detail?: string) => void;

interface Spots {
  water: { x: number; y: number };
  village: { x: number; y: number };
  rock: { x: number; y: number };
}

// Open water, the first village and bare rock, each far from the others' kind.
function spotsOf(world: World): Spots | null {
  const v = world.villages[0];
  if (!v) return null;
  let water: { x: number; y: number } | null = null;
  let rock: { x: number; y: number } | null = null;
  let bestRock = 0;
  for (let y = 8; y < world.h - 8; y += 2)
    for (let x = 8; x < world.w - 8; x += 2) {
      if (Math.hypot(x - v.x, y - v.y) < 30) continue;
      const h = readHere(world, x, y, 5);
      if (!water && h.water > 0.95 && !h.houses) water = { x, y };
      if (h.rock > bestRock && h.water === 0 && !h.houses && h.villagers.length === 0) [rock, bestRock] = [{ x, y }, h.rock];
    }
  return water && rock && bestRock > 0.5 ? { water, village: { x: Math.round(v.x), y: Math.round(v.y) }, rock } : null;
}

function islandWithSpots(): { world: World; rt: Runtime; spots: Spots } {
  for (const s of [9, 11, 3, 21, 42]) {
    const world = generateWorld(112, 112, s);
    populate(world);
    findVillages(world);
    const spots = spotsOf(world);
    if (spots) return { world, rt: new Runtime(world, () => {}), spots };
  }
  throw new Error("no island with water, a village and bare rock");
}

const api = (rt: Runtime, x: number, y: number, tier: "minor" | "major" = "major") =>
  new SpellApi(rt, { key: "reader", name: "Reader", tier, code: "" }, 1, x, y);

// Everything a program could see change: cells, creatures, voxels.
function fingerprint(world: World): string {
  let h = 2166136261;
  const mix = (v: number) => {
    h ^= Math.round(v * 1000) | 0;
    h = Math.imul(h, 16777619);
  };
  for (let i = 0; i < world.n; i++) {
    mix(world.ground[i]);
    mix(world.cover[i]);
    mix(world.fluid[i]);
    mix(world.depth[i]);
    mix(world.height[i]);
    mix(world.fire[i]);
    mix(world.temp[i]);
  }
  for (const c of world.creatures) {
    mix(c.x);
    mix(c.y);
    mix(c.hp);
  }
  mix(world.decor.size);
  return (h >>> 0).toString(16);
}

// The prompt's worked example, as the writer reads it.
export const FROST = (() => {
  const m = /Frost: (const h = w\.here\(\);.*?"ice", 0\.8\);)/.exec(SPELL_SYSTEM);
  return m ? `const spell = { *cast(w) { ${m[1]} } };` : "";
})();

// The fixtures the repo keeps of today's and older programs, by the name in their first line.
export function fixturePrograms(): { name: string; code: string }[] {
  const out: { name: string; code: string }[] = [];
  for (const dir of ["lab/programs", "lab/creatures", "lab/artifacts", "lab/legacy", "lab/monsters"])
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
      const code = readFileSync(join(dir, f), "utf8");
      const file = f.replace(/\.js$/, "").replace(/^v\d-/, "").replace(/-/g, " ");
      const first = /^\/\/ (?:An? |The )?([^:,(]+)/.exec(code)?.[1]?.trim() ?? file.replace(/\b\w/g, (l) => l.toUpperCase());
      out.push({ name: first, code });
    }
  for (const e of Object.values(FORM_EXAMPLES)) out.push({ name: e.name, code: e.code });
  for (const e of [FOX_SPIRIT_EXAMPLE, PERSON_EXAMPLE]) out.push({ name: e.name, code: e.code });
  // The prompt examples kept in lab/ too are counted once.
  return out.filter((f, i) => out.findIndex((g) => g.name === f.name) === i);
}

// The checks after it in npm test count creature ids from where they were: put back.
export function readingChecks(check: Check): void {
  const ids = resetCreatureIds(1);
  try {
    reading(check);
  } finally {
    resetCreatureIds(ids);
  }
}

function reading(check: Check): void {
  const { world, rt, spots } = islandWithSpots();
  const at = (s: { x: number; y: number }) => api(rt, s.x, s.y);
  const random = Math.random;
  try {
    seed(7);
    const before = fingerprint(world);
    const water = at(spots.water).here();
    const village = at(spots.village).here();
    const rock = at(spots.rock).here();
    check(
      "reading: w.here tells water, a village and bare rock apart",
      water.water > 0.5 &&
        !water.village &&
        village.village &&
        village.houses > 0 &&
        village.villagers.length > 0 &&
        rock.rock > 0.3 &&
        rock.water === 0 &&
        !rock.village,
      `water ${water.water.toFixed(2)}, village ${village.houses} house cells ${village.villagers.length} villagers, rock ${rock.rock.toFixed(2)}`,
    );
    check(
      "reading: w.here hands back creatures a spell can act on",
      typeof village.villagers[0]?.heal === "function" && village.villagers.every((c) => at(spots.village).nature(c) === "villager"),
    );
    const hurtVillage = at(spots.village).wouldHurt();
    const hurtRock = at(spots.rock).wouldHurt(spots.rock.x, spots.rock.y, 5);
    check(
      "reading: w.wouldHurt counts the houses and people a cast would hit, and calls bare rock safe",
      !hurtVillage.safe && hurtVillage.houses > 0 && hurtVillage.villagers > 0 && hurtRock.safe,
      JSON.stringify({ village: hurtVillage, rock: hurtRock }),
    );
    const fromVillage = at(spots.village);
    const lake = fromVillage.nearest("water");
    const home = at(spots.rock).nearest("village", spots.rock.x, spots.rock.y, 400);
    const v0 = world.villages[0];
    check(
      "reading: w.nearest finds the nearest water from a village and the village from the rock",
      !!lake &&
        world.fluid[world.idx(lake.x, lake.y)] === F.WATER &&
        !!home &&
        world.villages.every((v) => Math.hypot(v.x - spots.rock.x, v.y - spots.rock.y) >= home.d - 1e-6) &&
        Math.hypot(v0.x - spots.rock.x, v0.y - spots.rock.y) >= home.d - 1e-6,
      `water at ${lake?.d.toFixed(1)}, village at ${home?.d.toFixed(1)}`,
    );
    check("reading: no fire on a fresh island, so w.nearest('fire') is null", fromVillage.nearest("fire") === null);
    check("reading: asking changes nothing on the island and draws no random number", fingerprint(world) === before && Math.random() === seeded(7)());
    // Something now burning by the rock is found where it is.
    at(spots.rock).fire(spots.rock.x + 3, spots.rock.y, 1);
    const fire = at(spots.rock).nearest("fire");
    check("reading: w.nearest('fire') finds a fire that was lit", !!fire && fire.x === spots.rock.x + 3 && fire.y === spots.rock.y, JSON.stringify(fire));
  } finally {
    Math.random = random;
  }

  // Who is fighting whom: a raider let loose on the village goes for a villager.
  {
    const isle = generateWorld(112, 112, 11);
    populate(isle);
    findVillages(isle);
    seed(3);
    const r2 = new Runtime(isle, () => {});
    const v = isle.villages[0];
    r2.cast(
      {
        key: "raiders",
        name: "Raiders",
        tier: "minor",
        code: `const spell = { creatures: [{ name: "raider", base: "beast", behavior: "hunt", prey: ["villager"], attack: 4, sense: 30, speed: 3 }], *cast(w) { for (let k = 0; k < 3; k++) w.spawn("raider", w.x + k, w.y); } };`,
      },
      Math.round(v.x),
      Math.round(v.y),
    );
    for (let k = 0; k < 60; k++) step(isle, r2);
    const w = api(r2, Math.round(v.x), Math.round(v.y));
    const fights = w.fights(v.x, v.y, 40);
    const here = w.here(v.x, v.y, 40);
    check(
      "reading: w.fights names the raider and the villager it attacks; w.here counts it hostile",
      fights.some((f) => f.attacker.kind === "raider" && f.target.kind === "villager") &&
        here.hostile.some((c) => c.kind === "raider") &&
        w.nature(here.hostile[0]) === "hostile",
      `${fights.length} fights, ${here.hostile.length} hostile`,
    );
    Math.random = random;
  }

  // The worked example of the prompt does three different things in three places.
  {
    check("reading: the prompt's worked example is there and is a program", FROST.length > 60);
    const results: Record<string, { ice: number; frozen: number; cold: number }> = {};
    for (const where of ["water", "village", "rock"] as const) {
      // populate() draws from Math.random: seed it first, or the creatures
      // (and the rock the spot lands on) differ from run to run.
      seed(5);
      const isle = islandWithSpots();
      const s = isle.spots[where];
      seed(5);
      const errors: string[] = [];
      const r3 = new Runtime(isle.world, (_k, _n, m) => errors.push(m));
      // A raider in reach, so the village has an enemy to freeze.
      r3.cast(
        {
          key: "raider",
          name: "Raider",
          tier: "minor",
          code: `const spell = { creatures: [{ name: "raider", base: "beast", behavior: "hunt", prey: ["villager"], attack: 1, sense: 3 }], *cast(w) { w.spawn("raider", w.x + 2, w.y + 2); } };`,
        },
        s.x,
        s.y,
      );
      const temp = Float32Array.from(isle.world.temp);
      r3.cast({ key: "frost", name: "Frost", tier: "major", code: FROST }, s.x, s.y);
      for (let k = 0; k < 30; k++) step(isle.world, r3);
      let ice = 0;
      let cold = 0;
      for (let i = 0; i < isle.world.n; i++) {
        if (isle.world.fluid[i] === F.ICE && isle.world.depth[i] > 0.05 && Math.hypot((i % isle.world.w) - s.x, Math.floor(i / isle.world.w) - s.y) < 12) ice++;
        if (isle.world.temp[i] < temp[i] - 20) cold++;
      }
      const frozen = isle.world.creatures.filter((c) => c.kind.startsWith("raider") && c.frozen > 0).length;
      results[where] = { ice, frozen, cold };
      if (errors.length) check(`reading: the worked example runs at the ${where}`, false, errors[0]);
      Math.random = random;
    }
    const { water, village, rock } = results;
    check(
      "reading: the worked example cools the lake, freezes only the enemy in the village, lays ice on bare rock",
      water.cold > 50 && village.frozen > 0 && village.cold === 0 && rock.ice > 20 && rock.cold < water.cold,
      JSON.stringify(results),
    );
    console.log(`  worked example: ${JSON.stringify(results)}`);
  }

  // 4.12 step 3: the writer is asked for a signature against its neighbours.
  check(
    "signature: the prompt asks for one behaviour no other item of its kind has, and names the five shapes",
    /one behaviour no other item of its kind has/.test(SPELL_SYSTEM) &&
      /a ball that bursts, a ring of something, a creature dropped, a patch painted, a dome/.test(SPELL_SYSTEM),
  );
  const told = spellUserMessage("Tide Bell", "spell", "a bell that rings the tide in", null, "minor", [], undefined, [], undefined, [
    { name: "Rain", summary: "Rain falls on the fields." },
  ]);
  check(
    "signature: the writer is shown its neighbours of the same kind, by name and summary",
    told.includes("Give it one behaviour none of these has") && told.includes("- Rain: Rain falls on the fields."),
  );
  check(
    "signature: with no neighbours the message is as before",
    !spellUserMessage("Tide Bell", "spell", "a bell", null, "minor", [], undefined, [], undefined).includes("none of these has"),
  );

  // 4.12 step 4: the smart check.
  check(
    "smart: a name that promises judgement and reads nothing is a smart problem",
    !!smartProblem("Forest Guardian", "const spell = { *cast(w) { w.ward(w.x, w.y, 8); } };"),
  );
  check(
    "smart: a guardian that asks w.here passes",
    smartProblem("Forest Guardian", "const spell = { *cast(w) { const h = w.here(); h.hostile.forEach((c) => c.hurt(9)); } };") === null,
  );
  check(
    "smart: a guardian that leaves the choice to the engine (behavior guard) passes",
    smartProblem(
      "Stone Guardian",
      `const spell = { creatures: [{ name: "stone guardian", base: "golem", behavior: "guard", prey: ["wolf"] }], *cast(w) { w.spawn("stone guardian", w.x, w.y); } };`,
    ) === null,
  );
  check(
    "smart: names that promise no judgement are not asked",
    smartProblem("Fireball", "const spell = { *cast(w) { w.explode(w.x, w.y, 4, 2); } };") === null,
  );
  check(
    "smart: guardian, healer, hunter, seer and warden are names of judgement; fire, gold and dragon are not",
    ["Guardian Angel", "Healer", "Monster Hunter", "Seer", "Warden of the Wood", "Healing Rain"].every((n) => JUDGING_NAME.test(n)) &&
      !["Fire", "Gold", "Dragon", "Lighthouse", "Guardrail"].some((n) => JUDGING_NAME.test(n)),
  );
  {
    const dumb = runCheck({
      key: "grove-warden",
      name: "Grove Warden",
      tier: "minor",
      code: `const spell = { *cast(w) { w.paint(w.x, w.y, 4, "flower", 1); } };`,
    });
    const smart = runCheck({
      key: "grove-warden",
      name: "Grove Warden",
      tier: "minor",
      code: `const spell = { *cast(w) { const h = w.here(); w.paint(w.x, w.y, 4, h.water > 0.3 ? "sand" : "flower", 1); } };`,
    });
    const plain = runCheck({ key: "bloom", name: "Bloom", tier: "minor", code: `const spell = { *cast(w) { w.paint(w.x, w.y, 4, "flower", 1); } };` });
    check(
      "smart: the test run passes a warden that reads nothing but marks it (stats.smart 0, a sentence in the detail)",
      dumb.ok && dumb.problem === null && dumb.stats.smart === 0 && !!dumb.smart && /asks the island nothing/.test(dumb.detail),
      `${dumb.ok} ${dumb.problem} ${dumb.stats.smart} ${dumb.detail}`,
    );
    check(
      "smart: a warden that reads the island is marked 1, a name of no judgement is not marked",
      smart.ok && smart.stats.smart === 1 && !smart.smart && plain.stats.smart === undefined,
    );
  }
  const fixtures = fixturePrograms();
  const flagged = fixtures.filter((f) => smartProblem(f.name, f.code));
  const judging = fixtures.filter((f) => JUDGING_NAME.test(f.name));
  console.log(
    `  smart check on ${fixtures.length} fixtures: ${judging.length} promise judgement, ${flagged.length} flagged${flagged.length ? ` (${flagged.map((f) => f.name).join(", ")})` : ""}`,
  );
}
