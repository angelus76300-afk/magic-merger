// Villagers at home (22 November). The owner, after letting an island run: "sleeping is them not
// moving. Its just weird", then "Inside their house, window lit". A soak of main found three more
// village bugs. The checks, each on the small temperate island of the nature soak, with no wild
// animals:
//   1. at night the villagers sleep inside their houses (c.data.indoors, homes.ts): none asleep
//      standing outside, and the homeless lie down (c.data.rough); at day nobody is left inside;
//      a fire on a house wakes those inside and they come out; the card says "asleep in";
//   2. a villager whose home stands in water eats all the same (main: it took "going home to eat"
//      up again every five seconds and starved by its door), and its family moves to a dry home;
//   3. a village whose fields were lost tills new ones (main: "tilling a new field" was dropped at
//      the next thought, its ground not a field yet), and no more than its people need;
//   4. a village is never laid out below a spring's water: no house of the meadow island (main:
//      its village by a river's head stood in water within three minutes, 28 house cells) or the
//      small dry island stands in water after three minutes.
// The hour-long soak of the pull request is scripts/villagers-run.ts.
import { kindOf, populate, resetCreatureIds, type Creature } from "../src/sim/creatures";
import { daylight } from "../src/sim/daylight";
import { inspect } from "../src/sim/inspect";
import { life, villageOf } from "../src/sim/kin";
import { C, F, G } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { TICK, generateWorld, type World } from "../src/sim/world";
import { island } from "./nature-run";

type Check = (name: string, ok: boolean, detail?: string) => void;

function fresh(name = "small-meadow", seed = 11): { world: World; rt: Runtime } {
  const was = Math.random;
  const spec = island(name);
  Math.random = seeded(seed);
  resetCreatureIds(1);
  try {
    const world = generateWorld(spec.size, spec.size, spec.seed, spec.land);
    populate(world, []);
    world.wonders = [];
    return { world, rt: new Runtime(world, () => {}) };
  } finally {
    Math.random = was;
  }
}

function run(world: World, rt: Runtime, seconds: number, each: () => void = () => {}, seed = 7): void {
  const was = Math.random;
  Math.random = seeded(seed + Math.round(world.time));
  try {
    for (let k = 0; k < Math.round(seconds / TICK); k++) {
      stepHeadless(world, rt);
      each();
    }
  } finally {
    Math.random = was;
  }
}

const villagers = (world: World) => world.creatures.filter((c) => !c.dead && c.kind === "villager");
const cellOf = (world: World, x: number, y: number) => world.idx(Math.max(0, Math.min(world.w - 1, x)), Math.max(0, Math.min(world.h - 1, y)));

export function villagersChecks(check: Check): void {
  // 1. A night and a morning.
  {
    const { world, rt } = fresh();
    // Deep night is from 0.78 to 0.9 of the day (daylight.ts, which starts at 0.1): 245 s to 288 s.
    run(world, rt, 280);
    const night = daylight(world.time).night;
    const asleep = villagers(world).filter((c) => c.mind?.task === "rest");
    const inside = asleep.filter((c) => c.data.indoors !== undefined);
    const rough = asleep.filter((c) => c.data.indoors === undefined && c.data.rough);
    const standing = asleep.filter((c) => c.data.indoors === undefined && !c.data.rough);
    const inHouses = inside.every((c) => world.cover[c.data.indoors as number] === C.HOUSE);
    check(
      "villagers: at night they sleep inside their houses, none asleep standing outside",
      night > 0.9 && asleep.length >= 10 && inside.length >= asleep.length * 0.8 && standing.length === 0 && inHouses,
      `night ${night.toFixed(2)}: ${asleep.length} asleep, ${inside.length} indoors, ${rough.length} lying outside, ${standing.length} standing outside`,
    );
    const one = inside[0];
    const card = one ? inspect(world, one, kindOf, life.maxHp).rows.find((r) => r[0] === "Doing")?.[1] : undefined;
    check("villagers: the card of one asleep indoors says where", !!card && card.startsWith("asleep in their house"), `${card}`);
    // A fire on an occupied house: those inside wake and come out, and do not go back in.
    let woke: Creature[];
    if (one) {
      const house = one.data.indoors as number;
      const block = [
        house - world.w - 1,
        house - world.w,
        house - world.w + 1,
        house - 1,
        house,
        house + 1,
        house + world.w - 1,
        house + world.w,
        house + world.w + 1,
      ];
      const within = inside.filter((c) => block.includes(c.data.indoors as number));
      for (const j of block) if (world.cover[j] === C.HOUSE) world.fire[j] = 0.9;
      run(world, rt, 3, () => {
        for (const j of block) if (world.cover[j] === C.HOUSE) world.fire[j] = Math.max(world.fire[j], 0.6);
      });
      woke = within.filter((c) => c.data.indoors === undefined);
      // Back into the burning house, that is (a neighbour's house within reach of their door will do).
      const back = () => within.filter((c) => c.data.indoors !== undefined && world.fire[c.data.indoors as number] > 0.1).length;
      run(world, rt, 5, () => {
        for (const j of block) if (world.cover[j] === C.HOUSE) world.fire[j] = Math.max(world.fire[j], 0.6);
      });
      check(
        "villagers: a fire on a house wakes those inside, they come out and do not go back into it",
        within.length > 0 && woke.length === within.length && back() === 0,
        `${woke.length} of ${within.length} out (${within.filter((c) => c.dead).length} died in the fire), ${back()} back in the burning house 5 s later, ${within.filter((c) => c.data.indoors !== undefined).length} asleep in another`,
      );
    }
    // Morning: nobody is left inside.
    run(world, rt, 345 - world.time);
    const day = daylight(world.time).night;
    const still = villagers(world).filter((c) => c.data.indoors !== undefined).length;
    check("villagers: in the morning nobody is left inside", day < 0.1 && still === 0, `night ${day.toFixed(2)}, ${still} inside`);
  }
  // 2. A home in water: a family whose house and door are flooded, hungry, the stores full.
  {
    const { world, rt } = fresh();
    run(world, rt, 5);
    const c = villagers(world).find((o) => {
      const v = villageOf(world, o.homeX, o.homeY);
      return !!v && Math.hypot(o.homeX - v.x, o.homeY - v.y) > 5 && Math.hypot(o.x - o.homeX, o.y - o.homeY) < 6;
    })!;
    const v = villageOf(world, c.homeX, c.homeY)!;
    v.food = 40;
    const hx = c.homeX;
    const hy = c.homeY;
    // Water 1.5 deep over 3 cells round the door (the house is within reach of it), held there.
    const pond: number[] = [];
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (Math.hypot(dx, dy) <= 3.2) pond.push(cellOf(world, hx + dx, hy + dy));
    const flood = () => {
      for (const j of pond) world.setFluid(j, F.WATER, Math.max(world.depth[j], 1.5));
    };
    flood();
    c.mind!.hunger = 0.72;
    let least = 1;
    run(world, rt, 90, () => {
      flood();
      least = Math.min(least, c.mind!.hunger);
    });
    const dry = !(world.fluid[cellOf(world, c.homeX, c.homeY)] === F.WATER && world.depth[cellOf(world, c.homeX, c.homeY)] > 0.3);
    check(
      "villagers: a villager whose home stands in water eats all the same",
      !c.dead && least < 0.5,
      `${c.dead ? "dead" : "alive"}, hunger from 0.72 down to ${least.toFixed(2)}, doing: ${c.mind?.action}`,
    );
    check(
      "villagers: a family whose home stood in water moved to a dry home",
      dry && Math.hypot(c.homeX - hx, c.homeY - hy) > 3,
      `home from ${hx.toFixed(1)},${hy.toFixed(1)} to ${c.homeX.toFixed(1)},${c.homeY.toFixed(1)}, ${dry ? "dry" : "in water"}`,
    );
  }
  // 3. Fields lost: a village's fields turned to dirt (as a flood leaves them).
  {
    const { world, rt } = fresh();
    run(world, rt, 5);
    const v = world.villages.slice().sort((a, b) => b.people - a.people)[0];
    const near = (i: number) => Math.abs((i % world.w) - v.x) <= 18 && Math.abs(Math.floor(i / world.w) - v.y) <= 18;
    let before = 0;
    for (let i = 0; i < world.n; i++)
      if (near(i) && world.ground[i] === G.FIELD) {
        before++;
        world.ground[i] = G.DIRT;
        if (world.cover[i] === C.CROP) world.setCover(i, C.NONE);
      }
    v.food = 40;
    // By day: two minutes from the morning.
    run(world, rt, 150);
    let after = 0;
    for (let i = 0; i < world.n; i++) if (near(i) && world.ground[i] === G.FIELD) after++;
    const cap = Math.max(24, Math.round(v.people * 6));
    check(
      "villagers: a village that lost its fields tills new ones, no more than its people need",
      after >= 4 && after <= cap,
      `${before} fields turned to dirt, ${after} tilled in 150 s (bound ${cap} for ${v.people} people)`,
    );
  }
  // 4. No village laid out under a spring: three minutes on each soak island, no house in water.
  for (const name of ["meadow", "small-dry"]) {
    const { world, rt } = fresh(name);
    world.weather = true;
    run(world, rt, 180);
    let wet = 0;
    let houses = 0;
    for (let i = 0; i < world.n; i++)
      if (world.cover[i] === C.HOUSE) {
        houses++;
        if (world.fluid[i] === F.WATER && world.depth[i] > 0.2) wet++;
      }
    check(`villagers: ${name}, three minutes, no house stands in water`, houses > 20 && wet === 0, `${wet} of ${houses} house cells in water`);
  }
}
