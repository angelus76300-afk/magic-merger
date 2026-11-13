// Spells that answer each other (4.12 step 2, src/sim/reactions.ts): the engine's reactions a
// player expects between two items, written as the pairs a player would try. Each pair runs twice,
// with the reactions off (as on main, in challenges and in the test run) and on (the player's
// island): the answer must be there when on and absent when off, so every check here fails without
// the change. Run by npm test (scripts/sim-test.ts).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KINDS, populate, resetCreatureIds, type Creature } from "../src/sim/creatures";
import { DAY_LENGTH } from "../src/sim/daylight";
import { C, F, G, S } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { forDisc } from "../src/sim/physics";
import { LIGHT_BUDGET_MS, LIGHT_WORK, N, lightAt, natureOf, stepLight } from "../src/sim/reactions";
import { Runtime } from "../src/sim/runtime";
import { loadWorld, saveWorld } from "../src/sim/save";
import { SCENARIOS } from "../src/sim/scenarios";
import { stepHeadless } from "../src/sim/tick";
import { generateWorld, plainWorld, type World } from "../src/sim/world";

type Check = (name: string, ok: boolean, detail?: string) => void;

const SIZE = 64;
const MID = 32;
// A time of night (daylight.ts: the darkest stretch is 0.76 to 0.9 of the day, which starts at 0.1).
const NIGHT = DAY_LENGTH * 0.72;

interface Scene {
  world: World;
  rt: Runtime;
  errors: string[];
}

// A flat meadow of grass with nothing on it, reactions on or off.
function meadow(on: boolean, seed = 5): Scene {
  Math.random = seeded(seed);
  resetCreatureIds();
  const world = plainWorld(SIZE, SIZE, seed, 12, 0);
  world.reactions = on;
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  return { world, rt, errors };
}

function run(s: Scene, seconds: number): void {
  for (let k = 0; k < Math.round(seconds * 30); k++) stepHeadless(s.world, s.rt);
}

let casts = 0;
function cast(s: Scene, name: string, code: string, x = MID, y = MID): void {
  s.rt.cast({ key: `t${casts++}`, name, tier: "major", code }, x, y);
}

const kind = (s: Scene, name: string) => s.world.creatures.filter((c) => c.kind === name && !c.dead);
const count = (w: World, test: (i: number) => boolean) => {
  let n = 0;
  for (let i = 0; i < w.n; i++) if (test(i)) n++;
  return n;
};
const at = (w: World, x: number, y: number) => y * w.w + x;
const still = (c: Creature) => Object.assign(c, { tx: c.x, ty: c.y });

// A creature written as a stored program would write it, spawned where cast.
const creature = (def: string, n = 1) =>
  `const spell = { creatures: [${def}], *cast(w) { for (let k = 0; k < ${n}; k++) w.spawn(${JSON.stringify(/name: "([^"]+)"/.exec(def)![1])}, w.x + k * 2, w.y); } };`;

// The live Phoenix's declaration (the measurement of 12 November, docs/measurements): a flier,
// fireproof, hurt by water and cold, that leaves flowers. Nothing in it says fire but its name.
const PHOENIX = `{ name: "phoenix", base: "beast", body: "bird", color: "#d9461f", glow: true, flying: true, fireproof: true, radius: 0.6, speed: 4.5, hp: 120, goal: "spread", leaves: "flowers", behavior: "wander", weak: ["water", "cold"], active: "day", scares: ["wolf"] }`;

// 6. Opposed natures cancel or transform: fire on ice, water on lava, lava on water, cold on lava.
function opposedPairs(check: Check): void {
  const basalt = (w: World) => count(w, (i) => w.ground[i] === G.BASALT);
  const steam = (w: World) => count(w, (i) => w.gas[i] === S.STEAM && w.gasAmt[i] > 0.05);
  // Volcano then Great Flood: a lava pool, then water poured over it.
  const quench = (on: boolean) => {
    const s = meadow(on);
    forDisc(s.world, MID, MID, 6, (i) => s.world.setFluid(i, F.LAVA, 0.6));
    cast(s, "Great Flood", `const spell = { *cast(w) { w.flood(w.x, w.y, 8, "water", 1); } };`);
    run(s, 1 / 30);
    return { stone: basalt(s.world), steam: steam(s.world) };
  };
  const qOn = quench(true);
  const qOff = quench(false);
  check(
    "reactions: water poured on lava turns it to stone, with steam",
    qOn.stone >= 60 && qOn.steam >= 60 && qOff.stone === 0,
    `${qOn.stone} stone cells, ${qOn.steam} steam (off: ${qOff.stone} stone, ${qOff.steam} steam)`,
  );
  // Lava poured into a pond: it hardens to stone in the water.
  const pond = (on: boolean) => {
    const s = meadow(on);
    forDisc(s.world, MID, MID, 6, (i) => s.world.setFluid(i, F.WATER, 0.8));
    cast(s, "Molten Gold", `const spell = { *cast(w) { w.flood(w.x, w.y, 4, "lava", 1); } };`);
    run(s, 1 / 30);
    return { stone: basalt(s.world), lava: count(s.world, (i) => s.world.fluid[i] === F.LAVA) };
  };
  const pOn = pond(true);
  const pOff = pond(false);
  check(
    "reactions: lava poured into water hardens to stone instead of replacing the water",
    pOn.stone >= 30 && pOn.lava === 0 && pOff.lava >= 30,
    `${pOn.stone} stone, ${pOn.lava} lava left (off: ${pOff.stone} stone, ${pOff.lava} lava)`,
  );
  // Black Ice then Fire: fire on frozen water melts it into water and steam.
  const thaw = (on: boolean) => {
    const s = meadow(on);
    // A frozen pond in a hard frost: on main the ice stays ice under the fire.
    forDisc(s.world, MID, MID, 6, (i) => {
      s.world.setFluid(i, F.ICE, 0.5);
      s.world.temp[i] = -40;
    });
    cast(s, "Fire", `const spell = { *cast(w) { w.ignite(w.x, w.y, 6, 1); } };`);
    run(s, 3 / 30);
    return { water: count(s.world, (i) => s.world.fluid[i] === F.WATER), steam: steam(s.world) };
  };
  const tOn = thaw(true);
  const tOff = thaw(false);
  check(
    "reactions: fire on ice melts it into water, with steam",
    tOn.water >= 40 && tOn.steam >= 40 && tOff.water === 0,
    `${tOn.water} water cells, ${tOn.steam} steam (off: ${tOff.water} water, ${tOff.steam} steam)`,
  );
  // Fire then Great Flood: the flood hisses where the fire was.
  const douse = (on: boolean) => {
    const s = meadow(on);
    forDisc(s.world, MID, MID, 6, (i) => (s.world.fire[i] = 1));
    cast(s, "Great Flood", `const spell = { *cast(w) { w.flood(w.x, w.y, 8, "water", 1); } };`);
    run(s, 0.2);
    return steam(s.world);
  };
  const dOn = douse(true);
  const dOff = douse(false);
  check("reactions: a flood over a fire leaves a cloud of steam", dOn >= 60 && dOn > dOff * 3, `${dOn} steam cells (off: ${dOff})`);
  // A creature of ice crossing a lava flow crusts it over.
  const crust = (on: boolean) => {
    const s = meadow(on);
    cast(s, "Frost Giant", creature(`{ name: "frost giant", base: "golem", hp: 3000, speed: 0.01 }`));
    run(s, 0.5);
    const g = kind(s, "frost giant")[0];
    if (g) still(g);
    const i = s.world.idx(g.x, g.y);
    // A deep lava flow under it, that would not harden by itself this soon.
    forDisc(s.world, g.x, g.y, 4, (j) => s.world.setFluid(j, F.LAVA, 1.5));
    run(s, 1);
    return s.world.ground[i] === G.BASALT ? 1 : 0;
  };
  const cOn = crust(true);
  const cOff = crust(false);
  check("reactions: a creature of ice on lava turns it to stone where it stands", cOn === 1 && cOff === 0, `stone under it: ${cOn} (off: ${cOff})`);
}

export function reactionChecks(check: Check): void {
  const outer = Math.random;
  try {
    firePairs(check);
    lightPairs(check);
    gustPairs(check);
    ashPairs(check);
    meetingPairs(check);
    holyPairs(check);
    opposedPairs(check);
    guards(check);
  } finally {
    Math.random = outer;
  }
}

// 1. Creatures named for fire carry fire.
function firePairs(check: Check): void {
  const burnt = (on: boolean) => {
    const s = meadow(on);
    // Dry grass with bushes, as a meadow in summer.
    forDisc(s.world, MID, MID, 20, (i) => {
      if (Math.random() < 0.3) s.world.setCover(i, C.BUSH);
    });
    cast(s, "Phoenix", creature(PHOENIX));
    run(s, 40);
    return { ash: count(s.world, (i) => s.world.ground[i] === G.ASH || s.world.fire[i] > 0), errors: s.errors };
  };
  const off = burnt(false);
  const on = burnt(true);
  check(
    "reactions: a Phoenix flying low over dry grass leaves it burning",
    on.ash >= 10 && off.ash === 0 && !on.errors.length,
    `${on.ash} cells burnt or burning (off: ${off.ash}) ${on.errors.join("; ")}`,
  );

  // A creature named for fire that declares nothing else: walked into a shallow pond.
  const wade = (on: boolean) => {
    const s = meadow(on);
    forDisc(s.world, MID, MID, 8, (i) => s.world.setFluid(i, F.WATER, 0.5));
    cast(s, "Ember Hound", creature(`{ name: "ember hound", base: "beast", hp: 100, speed: 0.01 }`));
    run(s, 0.5);
    const hound = kind(s, "ember hound")[0];
    if (hound) still(hound);
    let steam = 0;
    for (let k = 0; k < 60; k++) {
      run(s, 1 / 30);
      if (hound) steam = Math.max(steam, s.world.gas[s.world.idx(hound.x, hound.y)] === S.STEAM ? 1 : 0);
    }
    return { hp: hound?.hp ?? -1, steam };
  };
  const dry = wade(false);
  const wet = wade(true);
  check(
    "reactions: a creature named for fire that walks into water is hurt, with steam where it touches",
    wet.hp < 80 && wet.steam === 1 && dry.hp >= 99,
    `health ${Math.round(wet.hp)} with steam ${wet.steam} (off: ${Math.round(dry.hp)})`,
  );

  // At home in fire: a fire creature in a burning field heals, a plain beast burns.
  const s = meadow(true);
  cast(s, "Ember Hound", creature(`{ name: "ember hound", base: "beast", hp: 100, speed: 0.01 }`));
  run(s, 0.5);
  const hound = kind(s, "ember hound")[0];
  hound.hp = 50;
  still(hound);
  forDisc(s.world, hound.x, hound.y, 3, (i) => (s.world.fire[i] = 1));
  run(s, 1);
  check("reactions: a creature of fire is at home in fire: it heals in the flames", hound.hp > 55 && hound.burning === 0, `${Math.round(hound.hp)} of 100`);

  // Natures come from what a program declares, not from a list of names.
  const fireByDeclaration = meadow(true);
  cast(
    fireByDeclaration,
    "Cinderling",
    `const spell = { materials: [{ name: "hot coals", layer: "ground", colors: ["#ff5a1a"], heat: 400 }], creatures: [{ name: "pebble", base: "beast", leaves: "hot coals" }, { name: "cloudling", base: "beast", immune: ["fire"], weak: ["water"] }, { name: "gloomling", base: "beast", weak: ["light"] }], *cast(w) { w.spawn("pebble", w.x, w.y); } };`,
  );
  const n = (name: string) => natureOf(fireByDeclaration.world, KINDS.get(name)!);
  check(
    "reactions: a creature's nature is read from what it declares (hot material it leaves, immune to fire and hurt by water, hurt by light)",
    !!(n("pebble") & N.FIRE) && !!(n("cloudling") & N.FIRE) && !!(n("gloomling") & N.DARK) && n("villager") === 0,
    `${n("pebble")} ${n("cloudling")} ${n("gloomling")}`,
  );
}

// 2. Light and shadow are in the world.
function lightPairs(check: Check): void {
  const WRAITH = creature(`{ name: "gloom wraith", base: "beast", hp: 100, speed: 0.01, weak: ["light"], active: "night" }`);
  const lit = (on: boolean, wall: boolean) => {
    const s = meadow(on);
    s.world.time = NIGHT;
    cast(s, "Gloom Wraith", WRAITH, MID, MID);
    run(s, 0.5);
    const wraith = kind(s, "gloom wraith")[0];
    still(wraith);
    // A wall of stone between the wraith and where the lantern goes.
    if (wall) cast(s, "Wall", `const spell = { *cast(w) { w.wall(w.x - 4, w.y - 6, w.x - 4, w.y + 6, { height: 10, thick: 2 }); } };`);
    run(s, 0.5);
    const hp0 = wraith.hp;
    cast(s, "Lantern", `const spell = { *cast(w) { w.light(w.x, w.y, 12, "#fff3b0", 6); } };`, MID - 8, MID);
    // Held where it stands: a creature that cannot walk is stepped free toward where it looks
    // (creatures.ts, free), which would take it round the wall's end.
    const x0 = wraith.x;
    const y0 = wraith.y;
    for (let q = 0; q < 150; q++) {
      stepHeadless(s.world, s.rt);
      Object.assign(wraith, { x: x0, y: y0, tx: x0, ty: y0 });
    }
    return Math.round(hp0 - wraith.hp);
  };
  const open = lit(true, false);
  const walled = lit(true, true);
  const offOpen = lit(false, false);
  check(
    "reactions: a lantern at night hurts a creature light burns, unless a wall stands between them",
    open >= 30 && walled === 0 && offOpen === 0,
    `lost ${open} in the open, ${walled} behind the wall (off: ${offOpen})`,
  );

  // A creature of the dark runs from a fresh light.
  {
    const s = meadow(true);
    s.world.time = NIGHT;
    cast(s, "Boogeyman", creature(`{ name: "boogeyman", base: "beast", hp: 400, speed: 2, behavior: "wander" }`));
    run(s, 0.5);
    const b = kind(s, "boogeyman")[0];
    const x0 = b.x;
    cast(s, "Will-o'-the-Wisp", `const spell = { *cast(w) { w.light(w.x, w.y, 10, "#bfe8ff", 6); } };`, x0 - 3, b.y);
    run(s, 2);
    check("reactions: a creature of the dark runs from a light cast beside it", b.x - x0 > 2, `moved ${Math.round((b.x - x0) * 10) / 10} cells away`);
  }

  // A darkness cast by day shades what daylight burns.
  const shaded = (on: boolean, dark: boolean) => {
    const s = meadow(on);
    s.world.time = 0;
    cast(s, "Gloom Wraith", creature(`{ name: "day wraith", base: "beast", hp: 100, speed: 0.01, weak: ["light"] }`));
    run(s, 0.5);
    const wraith = kind(s, "day wraith")[0];
    still(wraith);
    // Past its first minute: placed creatures are spared the sun while they walk to shade.
    wraith.data.arrived = -1;
    if (dark) cast(s, "Night", `const spell = { *cast(w) { w.darken(0.7, 10); } };`);
    run(s, 0.4);
    const hp0 = wraith.hp;
    run(s, 4);
    return Math.round(hp0 - wraith.hp);
  };
  const sunOn = shaded(true, false);
  const nightOn = shaded(true, true);
  const nightOff = shaded(false, true);
  check(
    "reactions: a darkness cast by day shades a creature the sun burns (the same daylight rule otherwise)",
    sunOn >= 20 && nightOn === 0 && nightOff >= 20,
    `in the sun lost ${sunOn}, under the darkness ${nightOn} (off: ${nightOff})`,
  );

  // A creature of the night is awake under a darkness by day.
  {
    const awake = (on: boolean) => {
      const s = meadow(on);
      s.world.time = 0;
      cast(s, "Night Owl", creature(`{ name: "night stalker", base: "beast", hp: 100, speed: 0.01, active: "night", behavior: "wander" }`));
      run(s, 0.5);
      const c = kind(s, "night stalker")[0];
      c.data.arrived = -1;
      cast(s, "Night", `const spell = { *cast(w) { w.darken(0.8, 20); } };`);
      run(s, 3);
      return c.data.mood !== "asleep";
    };
    check("reactions: a creature of the night wakes under a darkness cast by day", awake(true) && !awake(false));
  }
}

// 3. Blasts and gusts move more than creatures.
function gustPairs(check: Check): void {
  const BLAST = `const spell = { *cast(w) { w.shockwave(w.x, w.y, 10, "#ffffff", 0.8, 1); } };`;
  const fire = (on: boolean) => {
    const s = meadow(on);
    forDisc(s.world, MID, MID, 2, (i) => (s.world.fire[i] = 0.2));
    cast(s, "Blast Wave", BLAST);
    run(s, 2 / 30);
    return count(s.world, (i) => s.world.fire[i] > 0);
  };
  check("reactions: a blast wave blows out a small fire", fire(true) === 0 && fire(false) > 5, `${fire(true)} cells still burning (off: ${fire(false)})`);

  const fanned = (on: boolean) => {
    const s = meadow(on);
    forDisc(s.world, MID, MID, 3, (i) => {
      s.world.fire[i] = 1;
      s.world.setCover(i, C.BUSH);
    });
    const before = count(s.world, (i) => s.world.fire[i] > 0);
    cast(s, "Blast Wave", BLAST, MID - 3, MID);
    run(s, 1 / 30);
    return count(s.world, (i) => s.world.fire[i] > 0) - before;
  };
  check("reactions: a blast wave fans a big fire outward", fanned(true) >= 4 && fanned(false) === 0, `${fanned(true)} cells caught (off: ${fanned(false)})`);

  const smoke = (on: boolean) => {
    const s = meadow(on);
    forDisc(s.world, MID, MID, 5, (i) => {
      s.world.gas[i] = S.SMOKE;
      s.world.gasAmt[i] = 0.8;
    });
    cast(s, "Blast Wave", BLAST);
    run(s, 1 / 30);
    const centre = s.world.gasAmt[at(s.world, MID, MID)];
    let rim = 0;
    forDisc(s.world, MID, MID, 14, (i, k) => {
      if (k < 0.25) rim += s.world.gasAmt[i];
    });
    return { centre, rim };
  };
  const sOn = smoke(true);
  const sOff = smoke(false);
  check(
    "reactions: a blast wave pushes smoke out to its rim",
    sOn.centre === 0 && sOn.rim > 5 && sOff.centre > 0.5,
    `centre ${sOn.centre.toFixed(2)}, rim ${sOn.rim.toFixed(1)} (off: centre ${sOff.centre.toFixed(2)})`,
  );

  const pond = (on: boolean) => {
    const s = meadow(on);
    forDisc(s.world, MID, MID, 6, (i) => s.world.setFluid(i, F.WATER, 1));
    cast(s, "Blast Wave", BLAST);
    run(s, 1 / 30);
    let outside = 0;
    let inside = 0;
    forDisc(s.world, MID, MID, 14, (i, k, cx, cy) => {
      if (s.world.fluid[i] !== F.WATER) return;
      if (Math.hypot(cx - MID, cy - MID) > 7) outside += s.world.depth[i];
      else if (Math.hypot(cx - MID, cy - MID) < 3) inside += s.world.depth[i];
    });
    return { inside, outside };
  };
  const pOn = pond(true);
  const pOff = pond(false);
  check(
    "reactions: a blast wave on a pond throws water out over its banks",
    pOn.inside < pOff.inside * 0.85 && pOn.outside > 2 && pOff.outside === 0,
    `${pOn.inside.toFixed(1)} left in the middle, ${pOn.outside.toFixed(1)} thrown out (off: ${pOff.inside.toFixed(1)}, ${pOff.outside.toFixed(1)})`,
  );

  // A strong wind (w.wind) blows small fires out: a dozen sparks in a field of grass.
  const windy = (on: boolean) => {
    const s = meadow(on);
    cast(s, "Hurricane", `const spell = { *cast(w) { w.wind(4, 1); } };`);
    run(s, 1 / 30);
    for (let k = 0; k < 12; k++) s.world.fire[at(s.world, MID - 15 + (k % 4) * 8, MID - 8 + Math.floor(k / 4) * 8)] = 0.3;
    run(s, 6);
    return count(s.world, (i) => s.world.fire[i] > 0 || s.world.ground[i] === G.ASH);
  };
  check(
    "reactions: a gale blows out sparks in a dry field before they spread",
    windy(true) < windy(false) / 2,
    `${windy(true)} cells burnt (off: ${windy(false)})`,
  );
}

// 4. Growth loves ash.
function ashPairs(check: Check): void {
  const green = (on: boolean) => {
    const s = meadow(on);
    // Two patches walled off by rock: ash on the left, bare dirt on the right.
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const i = at(s.world, x, y);
        const inA = x >= 8 && x < 24 && y >= 24 && y < 40;
        const inB = x >= 40 && x < 56 && y >= 24 && y < 40;
        s.world.ground[i] = inA ? G.ASH : inB ? G.DIRT : G.ROCK;
      }
    cast(s, "World Seed", `const spell = { *cast(w) { w.grow(16, 32, 6, 0.5); w.grow(48, 32, 6, 0.5); } };`);
    run(s, 1 / 30);
    const grown = (x0: number) => {
      let n = 0;
      for (let y = 24; y < 40; y++) for (let x = x0; x < x0 + 16; x++) if (s.world.cover[at(s.world, x, y)] !== C.NONE) n++;
      return n;
    };
    const castA = grown(8);
    const castB = grown(40);
    run(s, 90);
    let grass = 0;
    for (let y = 24; y < 40; y++) for (let x = 8; x < 24; x++) if (s.world.ground[at(s.world, x, y)] === G.GRASS) grass++;
    return { castA, castB, grass };
  };
  const on = green(true);
  const off = green(false);
  check(
    "reactions: World Seed grows thicker on ash than on bare ground",
    on.castA > on.castB * 1.3 && Math.abs(off.castA - off.castB) <= Math.max(6, off.castB * 0.3),
    `on ash ${on.castA}, on dirt ${on.castB} (off: ${off.castA} and ${off.castB})`,
  );
  check("reactions: ash left alone greens over by itself", on.grass > off.grass + 40, `${on.grass} grass cells on the ash (off: ${off.grass})`);

  // A burnt forest comes back: stumps on ash sprout again.
  const forest = (on: boolean) => {
    const s = meadow(on, 9);
    forDisc(s.world, MID, MID, 10, (i) => {
      s.world.ground[i] = G.ASH;
      s.world.setCover(i, Math.random() < 0.6 ? C.STUMP : C.NONE);
    });
    run(s, 240);
    let trees = 0;
    forDisc(s.world, MID, MID, 10, (i) => {
      if (s.world.cover[i] === C.TREE) trees++;
    });
    return trees;
  };
  const fOn = forest(true);
  const fOff = forest(false);
  check("reactions: a forest returns where one burnt, faster than on main", fOn > fOff * 2 && fOn >= 30, `${fOn} trees after four minutes (off: ${fOff})`);
}

// 5. Spell creatures hunt and flee each other, by what they are.
function meetingPairs(check: Check): void {
  const FAMILIAR = `{ name: "familiar", base: "beast", radius: 0.4, speed: 3.4, hp: 40, behavior: "follow", leader: ["villager"], weak: ["cold"] }`;
  const SERPENT = `{ name: "serpent", base: "beast", radius: 0.55, speed: 1.6, hp: 45, goal: "hunt", behavior: "hunt", prey: ["rabbit", "bird"], attack: 14, sense: 12 }`;
  const pair = (on: boolean) => {
    const s = meadow(on);
    cast(s, "Familiar", creature(FAMILIAR));
    cast(s, "Serpent", creature(SERPENT), MID + 4, MID);
    run(s, 8);
    const f = s.world.creatures.find((c) => c.kind === "familiar")!;
    return { hurt: f.dead || f.hp < 40, ran: !!f.data.alarm || f.dead };
  };
  const pOn = pair(true);
  const pOff = pair(false);
  check(
    "reactions: a Serpent goes for a Familiar, and the Familiar runs",
    (pOn.hurt || pOn.ran) && !pOff.hurt && !pOff.ran,
    `on: hurt ${pOn.hurt}, ran ${pOn.ran}; off: hurt ${pOff.hurt}, ran ${pOff.ran}`,
  );

  // Fire and ice meet: neither hunts by its program, both have teeth.
  const duel = (on: boolean) => {
    const s = meadow(on);
    cast(s, "Flame Hound", creature(`{ name: "flame hound", base: "beast", hp: 150, attack: 10, behavior: "wander" }`));
    cast(s, "Frost Wolf", creature(`{ name: "frost wolf", base: "beast", hp: 150, attack: 10, behavior: "wander" }`), MID + 5, MID);
    run(s, 12);
    const a = s.world.creatures.find((c) => c.kind === "flame hound")!;
    const b = s.world.creatures.find((c) => c.kind === "frost wolf")!;
    return Math.round(300 - Math.max(0, a.hp) - Math.max(0, b.hp));
  };
  check(
    "reactions: a creature of fire and a creature of ice fight when they meet",
    duel(true) >= 60 && duel(false) === 0,
    `${duel(true)} health lost (off: ${duel(false)})`,
  );
}

// 6. Holy light hurts the undead, and natures oppose.
function holyPairs(check: Check): void {
  const radiance = (on: boolean) => {
    const s = meadow(on);
    cast(s, "Undead Legion", creature(`{ name: "undead legion", base: "golem", hp: 600, speed: 0.01, behavior: "guard", attack: 25, sense: 12 }`));
    run(s, 0.5);
    const u = kind(s, "undead legion")[0];
    still(u);
    u.hp = 500;
    cast(s, "Divine Radiance", `const spell = { *cast(w) { w.light(w.x, w.y, 20, "#ffe9a0", 2); for (const c of w.creatures(w.x, w.y, 20)) c.heal(40); } };`);
    run(s, 4);
    return Math.round(u.hp);
  };
  const on = radiance(true);
  const off = radiance(false);
  check("reactions: Divine Radiance burns the Undead Legion it would heal", on < 420 && off === 540, `health ${on} of 500 (off: ${off})`);

  // An archangel and the undead fight.
  const host = (on: boolean) => {
    const s = meadow(on);
    cast(
      s,
      "Archangel",
      creature(`{ name: "archangel", base: "spirit", glow: true, flying: true, hp: 420, attack: 30, behavior: "guard", sense: 16, prey: ["wolf"] }`),
    );
    cast(s, "Lich", creature(`{ name: "lich", base: "beast", hp: 200, speed: 1.2, behavior: "wander" }`), MID + 6, MID);
    run(s, 10);
    const lich = s.world.creatures.find((c) => c.kind === "lich")!;
    return lich.dead ? 0 : Math.round(lich.hp);
  };
  check("reactions: an Archangel smites a Lich that comes near", host(true) < 150 && host(false) === 200, `lich at ${host(true)} (off: ${host(false)})`);
}

// The guards: nothing new where reactions are off, old programs and saves keep working, balance.
function guards(check: Check): void {
  // Challenges are built with the reactions off, and a creature of fire in one lights nothing.
  let off = true;
  let sparks = 0;
  for (const sc of SCENARIOS) {
    Math.random = seeded(3);
    const { world } = sc.build();
    if (world.reactions) off = false;
    const rt = new Runtime(world, () => undefined);
    rt.cast({ key: "p", name: "Phoenix", tier: "major", code: creature(PHOENIX) }, world.w / 2, world.h / 2);
    for (let k = 0; k < 60; k++) stepHeadless(world, rt);
    sparks += world.creatures.filter((c) => c.data.spark !== undefined).length;
  }
  check("reactions: every challenge is built with the reactions off, and a Phoenix in one lights nothing", off && sparks === 0, `${sparks} sparks`);

  // Stored programs of every old version in lab/legacy and lab/creatures run with the reactions on.
  const errors: string[] = [];
  let ran = 0;
  for (const dir of ["lab/legacy", "lab/creatures", "lab/monsters", "lab/spells"])
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
      const s = meadow(true, 11);
      populate(s.world);
      s.rt.cast({ key: file, name: file, tier: "legendary", code: readFileSync(join(dir, file), "utf8") }, MID, MID);
      run(s, 8);
      for (const e of s.errors) errors.push(`${file}: ${e}`);
      ran++;
    }
  check(
    "reactions: stored programs of every old version still run with the reactions on",
    ran >= 30 && !errors.length,
    `${ran} programs, ${errors.slice(0, 3).join("; ")}`,
  );

  // A save taken with the reactions running round trips, and comes back with them as the page sets them.
  {
    const s = meadow(true);
    cast(s, "Phoenix", creature(PHOENIX));
    cast(s, "Lantern", `const spell = { *cast(w) { w.light(w.x, w.y, 12, "#fff3b0", 6); } };`);
    run(s, 10);
    const data = JSON.parse(JSON.stringify(saveWorld(s.world, s.rt.owners)));
    const back = loadWorld(data, () => undefined);
    const same = !!back && back.creatures.length === s.world.creatures.length && back.ground.every((g, i) => g === s.world.ground[i]);
    check("reactions: an island saved with the reactions running loads back the same", same && back!.reactions === false);
  }

  // The light field keeps to its budget: 64 large lights on the large island are shone over
  // several ticks, never more than the budget's work in one (one light may finish past it), and
  // the field still comes. Times are printed, not asserted: no verdict depends on the machine.
  for (const [n, r] of [
    [20, 16],
    [64, 60],
  ]) {
    Math.random = seeded(7);
    const world = generateWorld(208, 208, 7);
    world.reactions = true;
    populate(world);
    for (let k = 0; k < n; k++)
      world.lightSources.push({ x: 10 + (k % 16) * 12, y: 30 + Math.floor(k / 16) * 40, r, until: 1e9, power: 1, holy: k % 3 === 0, dark: k % 7 === 0 });
    const times: number[] = [];
    let most = 0;
    let firstField = -1;
    for (let k = 0; k < 300; k++) {
      world.time += 1 / 30;
      world.tick++;
      const t0 = performance.now();
      stepLight(world);
      const dt = performance.now() - t0;
      const f = world.lightField!;
      if (k >= 60 && f.work > 0) times.push(dt);
      most = Math.max(most, f.work);
      if (firstField < 0 && f.at > 0) firstField = k;
    }
    times.sort((a, b) => a - b);
    const lit = lightAt(world, 10 + 12 * 1, 30).lit;
    check(
      `reactions: the light field keeps to its budget with ${n} lights of radius ${r} on the large island`,
      LIGHT_WORK <= 60000 && most <= 120000 && firstField >= 0 && firstField < 120 && lit > 0.5,
      `most work in a tick ${most} (budget ${LIGHT_WORK}), first field after ${firstField} ticks, light ${lit.toFixed(2)}; p95 ${times[Math.floor(times.length * 0.95)]?.toFixed(2)} ms a busy tick, budget ${LIGHT_BUDGET_MS} ms`,
    );
  }

  // Balance: a Phoenix by a village for five minutes burns a corner of the island, not the island or the village.
  {
    Math.random = seeded(11);
    resetCreatureIds();
    const world = generateWorld(152, 152, 11);
    world.reactions = true;
    populate(world);
    const rt = new Runtime(world, () => undefined);
    let target = { x: 76, y: 76 };
    for (let i = 0; i < world.n; i++)
      if (world.cover[i] === C.HOUSE) {
        target = { x: (i % world.w) + 6, y: Math.floor(i / world.w) + 6 };
        break;
      }
    const houses0 = count(world, (i) => world.cover[i] === C.HOUSE);
    const land = count(world, (i) => world.depth[i] < 0.5);
    rt.cast({ key: "p", name: "Phoenix", tier: "major", code: creature(PHOENIX, 2) }, target.x, target.y);
    let most = 0;
    for (let k = 0; k < 300 * 30; k++) {
      stepHeadless(world, rt);
      if (k % 30 === 0)
        most = Math.max(
          most,
          count(world, (i) => world.fire[i] > 0),
        );
    }
    const ash = count(world, (i) => world.ground[i] === G.ASH);
    const lost = houses0 - count(world, (i) => world.cover[i] === C.HOUSE);
    check(
      "reactions: two Phoenixes by a village for five minutes burn patches, not the island or the village",
      ash < land * 0.08 && lost <= houses0 * 0.1 && most < 400,
      `${ash} ash of ${land} land cells, ${lost} of ${houses0} house cells lost, at most ${most} cells burning at once`,
    );
  }
}
