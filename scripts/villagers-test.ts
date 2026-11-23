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
//   4. on an island made now (taller peaks), a village is never laid out below a spring's water:
//      no house of a desert delta (seed 6; main: its village by a river's head stood in water
//      within three minutes, 8 house cells) or of the small dry island stands in water after three
//      minutes. Islands made the old way keep their exact land (scripts/peaks-test.ts).
// The hour-long soak of the pull request is scripts/villagers-run.ts.
import { kindOf, populate, resetCreatureIds, type Creature } from "../src/sim/creatures";
import { daylight } from "../src/sim/daylight";
import { creatureAt, inspect } from "../src/sim/inspect";
import { possess, possessed, release, steerBy } from "../src/sim/possess";
import { litHouses } from "../src/sim/homes";
import { life, villageOf } from "../src/sim/kin";
import { C, F, G } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { TICK, generateWorld, type World } from "../src/sim/world";
import { island } from "./nature-run";
import { DEFAULT_LAND, type LandOptions } from "../src/sim/land-options";

type Check = (name: string, ok: boolean, detail?: string) => void;

function fresh(name = "small-meadow", seed = 11): { world: World; rt: Runtime } {
  const was = Math.random;
  // "biome/shape/seed": an island made now (taller peaks), 112 cells.
  const [biome, shape, s] = name.split("/");
  const spec = shape
    ? { size: 112, seed: Number(s), land: { ...DEFAULT_LAND, biome: biome as LandOptions["biome"], shape: shape as LandOptions["shape"], peaks: true } }
    : island(name);
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

// The first cell of the two by two block each house cell is drawn in (voxel/buildings.ts update),
// -1 for a cell drawn alone. Written out here, not taken from the game, so the check stands apart.
function drawnBlocks(world: World): Int32Array {
  const W = world.w;
  const top = new Int32Array(world.n).fill(-1);
  const taken = new Set<number>();
  for (const s of world.settlements)
    for (const j of s.jobs ?? []) {
      const cells = [j.i, j.i + 1, j.i + W, j.i + W + 1];
      if (cells.every((c) => world.cover[c] === j.kind))
        for (const c of cells) {
          taken.add(c);
          if (j.kind === C.HOUSE) top[c] = j.i;
        }
    }
  for (let i = 0; i < world.n - W - 1; i++) {
    if (world.cover[i] !== C.HOUSE || taken.has(i) || (i % W) + 1 >= W) continue;
    const cells = [i, i + 1, i + W, i + W + 1];
    if (!cells.every((c) => world.cover[c] === C.HOUSE && !taken.has(c))) continue;
    for (const c of cells) {
      taken.add(c);
      top[c] = i;
    }
  }
  return top;
}

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
      `night ${night.toFixed(2)}: ${asleep.length} asleep, ${inside.length} indoors, ${rough.length} lying outside, ${standing.length} standing outside` +
        standing
          .map(
            (c) =>
              ` (#${c.id} "${c.mind?.action}" ${Math.hypot(c.x - c.mind!.tx, c.y - c.mind!.ty).toFixed(1)} from its bed, ${c.mind!.work > 0 ? "arrived" : "walking"}, sp ${c.sp.toFixed(2)}, fear ${c.fear.toFixed(1)})`,
          )
          .join(""),
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
    // Water over another occupied house: those inside wake and come out.
    const dryOne = villagers(world).find((c) => c.data.indoors !== undefined && Math.hypot(c.x - (one?.x ?? -99), c.y - (one?.y ?? -99)) > 8);
    if (dryOne) {
      const house = dryOne.data.indoors as number;
      const pond: number[] = [];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) pond.push(house + dy * world.w + dx);
      // The card the moment it is out of the door says why.
      let card: string | undefined;
      run(world, rt, 2, () => {
        for (const j of pond) world.setFluid(j, F.WATER, Math.max(world.depth[j], 1));
        if (card === undefined && dryOne.data.indoors === undefined)
          card = inspect(world, dryOne, kindOf, life.maxHp).rows.find((r) => r[0] === "Doing")?.[1] ?? "";
      });
      check(
        "villagers: water over a house wakes those inside, and they come out",
        dryOne.data.indoors === undefined,
        `${dryOne.data.indoors === undefined ? "out" : "still inside"}, doing: ${dryOne.mind?.action}`,
      );
      check("villagers: the card of one woken by water says so", !!card && card.includes("out of their flooded house"), `card: ${card}`);
    } else check("villagers: water over a house wakes those inside, and they come out", false, "no second house with a sleeper");
    // Morning: nobody is left inside.
    run(world, rt, 345 - world.time);
    const day = daylight(world.time).night;
    const still = villagers(world).filter((c) => c.data.indoors !== undefined).length;
    check("villagers: in the morning nobody is left inside", day < 0.1 && still === 0, `night ${day.toFixed(2)}, ${still} inside`);
  }
  // 1c. A whole night on two islands: the window of every sleeper's house is lit. The house is
  // drawn as voxel/buildings.ts tiles it (below, as it did at 2cecc47: job blocks, then the first
  // four house cells in reading order), its windows numbered by the block's first cell; a cell left
  // over is drawn alone and lit by its own number. Review of 2cecc47: where house blocks touch, a
  // sleeper could light a block that was not drawn, and its house looked dark. On these two islands
  // no sleeper fell on such a cell at 2cecc47; the houses laid out by hand below are one.
  {
    const { world } = fresh();
    // An empty square of land six by six, away from the edge.
    let at = -1;
    for (let y = 8; y < world.h - 8 && at < 0; y++)
      for (let x = 8; x < world.w - 8 && at < 0; x++) {
        let free = true;
        for (let dy = 0; dy < 6 && free; dy++)
          for (let dx = 0; dx < 6 && free; dx++) free = world.cover[(y + dy) * world.w + x + dx] === C.NONE && world.depth[(y + dy) * world.w + x + dx] <= 0;
        if (free) at = (y + 1) * world.w + x + 1;
      }
    // Rows from the top: two cells (a block with the row below), three, three, two. The builder
    // takes the top block first, so the cell under its left foot joins the block below-left.
    const W = world.w;
    const cells = [2, 3, W + 1, W + 2, W + 3, 2 * W, 2 * W + 1, 2 * W + 2, 3 * W, 3 * W + 1].map((d) => at + d);
    for (const j of cells) world.cover[j] = C.HOUSE;
    const c = villagers(world)[0];
    const was = c.data.indoors;
    c.data.indoors = at + 2 * W + 1;
    const top = drawnBlocks(world);
    const lit = litHouses(world);
    const window = top[c.data.indoors as number];
    c.data.indoors = was;
    check(
      "villagers: a sleeper in a house where blocks touch lights the block it is drawn in",
      at >= 0 && window >= 0 && lit.has(window),
      `${at < 0 ? "no empty square" : `drawn in the block at ${window}, lit: ${[...lit].join(", ")}`}`,
    );
  }
  for (const name of ["small-meadow", "small-dry"]) {
    const { world, rt } = fresh(name);
    let asleep = 0;
    let dark = 0;
    let example = "";
    run(world, rt, 230);
    let next = world.time;
    run(world, rt, 345 - world.time, () => {
      if (world.time < next) return;
      next = world.time + 2;
      const top = drawnBlocks(world);
      const lit = litHouses(world);
      for (const c of villagers(world)) {
        const house = c.data.indoors as number | undefined;
        if (house === undefined) continue;
        asleep++;
        const window = top[house] >= 0 ? top[house] : house;
        if (!lit.has(window)) {
          dark++;
          example ||= `#${c.id} in cell ${house}, drawn in the block at ${top[house]}`;
        }
      }
    });
    check(
      `villagers: ${name}, a whole night, every sleeper's house window is lit`,
      asleep > 0 && dark === 0,
      `${asleep} sleepers counted every 2 s, ${dark} in a dark house${example ? ` (${example})` : ""}`,
    );
  }
  // 1b. Become one asleep indoors (review of 2cecc47: it stayed inside, not drawn, and did not move
  // under the stick). A tap at its door does not open its card; taken all the same, it comes out
  // of its door, is drawn, and walks where the stick says.
  {
    const { world, rt } = fresh();
    run(world, rt, 280);
    const c = villagers(world).find((o) => o.data.indoors !== undefined);
    const tapped = c ? creatureAt(world, c.x, c.y, 0.5) : null;
    check(
      "villagers: a tap at the door of one asleep indoors does not pick it",
      !!c && tapped !== c,
      `${c ? `#${c.id}` : "nobody indoors"}, tap found ${tapped ? `#${tapped.id}` : "nobody"}`,
    );
    if (c) {
      const x0 = c.x;
      const y0 = c.y;
      possess(world, c);
      // Five seconds of the stick, one way and then another if the first is walled.
      run(world, rt, 2.5, () => steerBy(world, 0, -1, 0));
      run(world, rt, 2.5, () => steerBy(world, 1, 0, 0));
      const moved = Math.hypot(c.x - x0, c.y - y0);
      const out = c.data.indoors === undefined;
      const task = c.mind?.task;
      const still = possessed(world)?.c === c;
      release(world);
      check(
        "villagers: become one asleep indoors and it comes out, is drawn and walks",
        still && out && moved > 1 && task !== "rest",
        `moved ${moved.toFixed(2)}, ${out ? "out" : "still indoors"}, task ${task}, ${still ? "still the player" : "let go"}`,
      );
    }
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
  for (const name of ["desert/delta/6", "small-dry"]) {
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
