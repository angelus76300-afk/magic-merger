// Fire and ruins (23 November). A playtest found one tap of the base Fire, a minor spell, on a
// house burning about 8 houses of its village in 10 seconds, twice; and the owner, on how soon a
// burned village is rebuilt: "Burned village: rebuilt in minutes, or after a night? My
// recommendation: one night. agreed". The checks:
//   1. a minor spell's own fire lights one building, the one nearest where it was cast, and the
//      ground touching any other (runtime.ts BUILDINGS_LIT); a major one lights what it reaches;
//   2. a fire of only grass beside a house sets it alight far less often than a burning bush
//      does (physics.ts LOW_TO_WALL, LOW_CREEP);
//   3. one Fire on a house of a fresh island, three islands: at most two houses burned in 30 s on
//      average (main: 4 to 5);
//   4. a house burned by day stays rubble until dawn, its family sleeps lying down beside it and
//      keeps its home, the others sleep in their houses, nobody asleep standing; from dawn it is
//      rebuilt; a ruin saved and loaded at night still waits for the dawn;
//   5. its family keeps its own ruin with a neighbour's house nearer its home point;
//   6. once its house is rebuilt, each family is back in it (main: 4 of 20 on two islands);
//   7. a ruin nobody rebuilds is given up a day after its dawn, so no family is homeless for good;
//   8. a village with no builder near: its families rebuild their houses themselves from midmorning
//      (homes.ts ownRebuild), slowly (25 November, the owner: "slow rebuild: yes"): each takes half
//      a day at the least and every ruin is gone by the evening of the day after, a household of
//      only children and elders helped by a neighbour (homes.ts SLOW_REBUILD).
// The measurement of the pull request (ten islands, before and after) is scripts/fire-run.ts.
import { populate, resetCreatureIds, type Creature } from "../src/sim/creatures";
import { daylight } from "../src/sim/daylight";
import { SLOW_REBUILD, homeRuin, houseBlock, houseOf, ruinStands, tileHouses } from "../src/sim/homes";
import { unpackLook } from "../src/sim/villagers";
import { DEFAULT_LAND, resolveLand, type LandOptions } from "../src/sim/land-options";
import { C, G } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { loadWorld, saveWorld } from "../src/sim/save";
import { stepHeadless } from "../src/sim/tick";
import { TICK, generateWorld, type World } from "../src/sim/world";
import { island } from "./nature-run";
import { jobOf } from "../src/sim/goals";

type Check = (name: string, ok: boolean, detail?: string) => void;

// The base Fire as the library's live programs behave (scripts/spell-pairs.ts): four discs of
// fire of radius five, scattered up to four cells round the tap.
const FIRE = `const spell = { *cast(w) { w.sound("whoosh", 0.4); for (let k = 0; k < 4; k++) { w.ignite(w.x + w.rand(-4, 4), w.y + w.rand(-4, 4), 5, 0.8); yield 0.3; } } };`;

function withRandom<T>(seed: number, f: () => T): T {
  const was = Math.random;
  Math.random = seeded(seed);
  try {
    return f();
  } finally {
    Math.random = was;
  }
}

function fresh(
  seed: number,
  size: number,
  land: LandOptions = { ...resolveLand({ ...DEFAULT_LAND }, seed, size), peaks: true },
): { world: World; rt: Runtime } {
  return withRandom(seed, () => {
    resetCreatureIds(1);
    const world = generateWorld(size, size, seed, land);
    populate(world);
    world.wonders = [];
    world.reactions = true;
    return { world, rt: new Runtime(world, () => {}) };
  });
}

function run(world: World, rt: Runtime, seconds: number, each: () => void = () => {}, seed = 7): void {
  withRandom(seed + Math.round(world.time), () => {
    for (let k = 0; k < Math.round(seconds / TICK); k++) {
      stepHeadless(world, rt);
      each();
    }
  });
}

// House blocks (two by two, as drawn) within r of a village's centre, by their first cell.
function blocksNear(world: World, x: number, y: number, r: number): Map<number, number[]> {
  const top = tileHouses(world);
  const out = new Map<number, number[]>();
  for (let i = 0; i < world.n; i++) {
    if (top[i] < 0 || Math.hypot((i % world.w) - x, Math.floor(i / world.w) - y) > r) continue;
    const b = out.get(top[i]) ?? [];
    b.push(i);
    out.set(top[i], b);
  }
  return out;
}

function nearestBlock(world: World, blocks: Map<number, number[]>, x: number, y: number): number {
  let best = -1;
  let bestD = Infinity;
  for (const b of blocks.keys()) {
    const d = Math.hypot((b % world.w) + 1 - x, Math.floor(b / world.w) + 1 - y);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

const villagers = (world: World) => world.creatures.filter((c) => !c.dead && c.kind === "villager");

export function fireRuinsChecks(check: Check): void {
  // 1. A minor ignite over four houses lights one; a major one lights them all.
  {
    for (const tier of ["minor", "major"] as const) {
      const { world, rt } = fresh(3, 112, island("small-meadow").land);
      const s = world.settlements[0];
      const blocks = blocksNear(world, s.x, s.y, 20);
      const aim = nearestBlock(world, blocks, s.x, s.y);
      const x = (aim % world.w) + 1;
      const y = Math.floor(aim / world.w) + 1;
      const within = [...blocks.values()].filter((cells) => cells.some((i) => Math.hypot((i % world.w) + 0.5 - x, Math.floor(i / world.w) + 0.5 - y) < 9));
      withRandom(5, () => rt.cast({ key: `ignite-${tier}`, name: "Ignite", tier, code: `const spell = { *cast(w) { w.ignite(w.x, w.y, 9, 1); } };` }, x, y));
      run(world, rt, TICK);
      const lit = within.filter((cells) => cells.some((i) => world.fire[i] > 0.05)).length;
      const aimLit = blocks.get(aim)!.some((i) => world.fire[i] > 0.05);
      if (tier === "minor")
        check(
          "fire: a minor spell's own fire lights the one house nearest where it was cast, of all it covers",
          within.length >= 3 && lit === 1 && aimLit,
          `${lit} of the ${within.length} houses its disc covers alight, the tapped one ${aimLit ? "among them" : "not"}`,
        );
      else check("fire: a major spell's fire lights every house it covers", within.length >= 3 && lit === within.length, `${lit} of ${within.length} alight`);
    }
  }
  // 2. Grass burning along a house's wall, against bushes: how often it catches in a second.
  {
    const { world, rt } = fresh(3, 112, island("small-meadow").land);
    const s = world.settlements[0];
    const aim = nearestBlock(world, blocksNear(world, s.x, s.y, 20), s.x, s.y);
    const block = [aim, aim + 1, aim + world.w, aim + world.w + 1];
    // Along one wall: the two cells west of the block.
    const ring = [aim - 1, aim + world.w - 1];
    const keep = { cover: world.cover.slice(), ground: world.ground.slice(), fire: world.fire.slice(), temp: world.temp.slice(), hp: world.coverHp.slice() };
    const caught = (bush: boolean, trials: number, ground: number = G.GRASS) => {
      let n = 0;
      withRandom(bush ? 11 : ground === G.GRASS ? 12 : 13, () => {
        for (let t = 0; t < trials; t++) {
          world.cover.set(keep.cover);
          world.ground.set(keep.ground);
          world.fire.set(keep.fire);
          world.temp.set(keep.temp);
          world.coverHp.set(keep.hp);
          for (const j of ring) {
            world.ground[j] = ground;
            world.setCover(j, bush ? C.BUSH : C.NONE);
            world.fire[j] = 1;
          }
          for (let k = 0; k < Math.round(1 / TICK); k++) stepHeadless(world, rt);
          if (block.some((j) => world.fire[j] > 0.05)) n++;
        }
      });
      return n / trials;
    };
    const grass = caught(false, 24);
    const bush = caught(true, 24);
    check(
      "fire: a house catches from burning grass along its wall far less often than from burning bushes",
      bush >= 0.3 && grass <= bush * 0.5,
      `grass ${(grass * 100).toFixed(0)}%, bushes ${(bush * 100).toFixed(0)}% of 24 tries`,
    );
    // A field's stubble burns as fiercely as a bush (it creeps at full strength, LOW_CREEP), so
    // only the wall (LOW_TO_WALL) keeps it from setting the house alight as often (review of
    // 367ebc1: no check failed with LOW_TO_WALL at 1).
    const field = caught(false, 24, G.FIELD);
    check(
      "fire: a house catches from a burning field along its wall far less often than from burning bushes",
      bush >= 0.3 && field <= bush * 0.5,
      `field ${(field * 100).toFixed(0)}%, bushes ${(bush * 100).toFixed(0)}% of 24 tries`,
    );
  }
  // 3. One Fire on a house of a fresh medium island, 30 s.
  {
    const rows: string[] = [];
    let burned = 0;
    for (const seed of [2, 6, 9]) {
      const { world, rt } = fresh(seed, 152);
      run(world, rt, 20);
      const s = world.settlements[0];
      const blocks = blocksNear(world, s.x, s.y, 24);
      const aim = nearestBlock(world, blocks, s.x, s.y);
      withRandom(seed * 31 + 7, () => rt.cast({ key: "fire", name: "Fire", tier: "minor", code: FIRE }, (aim % world.w) + 1, Math.floor(aim / world.w) + 1));
      const down = new Set<number>();
      run(world, rt, 30, () => {
        for (const [b, cells] of blocks) if (cells.some((i) => world.cover[i] === C.RUBBLE)) down.add(b);
      });
      burned += down.size;
      rows.push(`seed ${seed}: ${down.size} of ${blocks.size}`);
    }
    check("fire: one Fire on a house burns at most two houses in 30 s on average (3 islands)", burned <= 6, rows.join(", "));
  }
  // 4. A house burned by day, the night, the dawn.
  {
    const { world, rt } = fresh(4, 112, island("small-meadow").land);
    run(world, rt, 120);
    // The house of a family, burned out at once.
    const home = villagers(world).find((c) => c.mind && homeRuin(world, c) < 0 && houseOf(world, c) >= 0);
    const family = (c: Creature) => villagers(world).filter((o) => Math.hypot(o.homeX - c.homeX, o.homeY - c.homeY) < 1.3);
    const house = home ? houseOf(world, home) : -1;
    const top = tileHouses(world);
    const block = house >= 0 && top[house] >= 0 ? [top[house], top[house] + 1, top[house] + world.w, top[house] + world.w + 1] : [];
    for (const j of block) world.setCover(j, C.RUBBLE);
    const homeAt = home ? [home.homeX, home.homeY] : [0, 0];
    let rebuiltAt = -1;
    const watch = () => {
      if (rebuiltAt < 0 && block.some((j) => world.cover[j] !== C.RUBBLE)) rebuiltAt = world.time;
    };
    // Deep night, 280 s (daylight.ts: from 0.78 of the day, 245 s, to 0.9, 288 s).
    run(world, rt, 280 - world.time, watch);
    const night = daylight(world.time).night;
    // Guards keep the night on patrol.
    const kin = home ? family(home).filter((c) => jobOf(c) !== "guard") : [];
    const lying = kin.filter(
      (c) => c.mind?.task === "rest" && c.data.rough && c.data.indoors === undefined && Math.hypot(c.x - homeAt[0], c.y - homeAt[1]) < 5,
    );
    // Its home stays by the ruin (one held up on its way to bed settles where it stands, a step or two off).
    const kept = kin.filter((c) => Math.hypot(c.homeX - homeAt[0], c.homeY - homeAt[1]) < 2.5);
    check(
      "ruins: a house burned by day still stands in ruins that night",
      block.length === 4 && night > 0.9 && rebuiltAt < 0 && block.every((j) => ruinStands(world, j)),
      `night ${night.toFixed(2)}, ${rebuiltAt < 0 ? "still rubble" : `rebuilt at ${rebuiltAt.toFixed(0)} s`}`,
    );
    check(
      "ruins: its family sleeps lying down beside the ruin and keeps its home there",
      kin.length > 0 && lying.length === kin.length && kept.length === kin.length,
      `${kin.length} in the family: ${lying.length} lying by the ruin, ${kept.length} kept their home; ${kin.map((c) => `"${c.mind?.action}"`).join(", ")}`,
    );
    const asleep = villagers(world).filter((c) => c.mind?.task === "rest");
    const standing = asleep.filter((c) => c.data.indoors === undefined && !c.data.rough);
    const inside = asleep.filter((c) => c.data.indoors !== undefined);
    check(
      "ruins: the others sleep in their houses, nobody asleep standing up",
      asleep.length >= 8 && standing.length === 0 && inside.length >= (asleep.length - kin.length) * 0.8,
      `${asleep.length} asleep, ${inside.length} indoors, ${standing.length} standing`,
    );
    // Saved and loaded in the night: the ruin still waits for the dawn.
    const loaded = loadWorld(saveWorld(world, rt.owners), () => {})!;
    const loadedRt = new Runtime(loaded, () => {});
    let loadedRebuilt = -1;
    // Dawn is at 306 s (homes.ts: the night lifts under 0.3 at 0.95 of the day, which starts at 0.1).
    run(loaded, loadedRt, 300 - loaded.time, () => {
      if (loadedRebuilt < 0 && block.some((j) => loaded.cover[j] !== C.RUBBLE)) loadedRebuilt = loaded.time;
    });
    check(
      "ruins: a ruin saved and loaded at night still stands until dawn",
      loadedRebuilt < 0 && block.every((j) => loaded.cover[j] === C.RUBBLE),
      loadedRebuilt < 0 ? "still rubble at dawn" : `rebuilt at ${loadedRebuilt.toFixed(0)} s, before dawn`,
    );
    // From dawn, 306 s, rebuilding starts: begun within two and a half minutes, done within seven.
    run(world, rt, 300 - world.time, watch);
    const before = rebuiltAt;
    run(world, rt, 426, watch);
    const done = block.filter((j) => world.cover[j] === C.HOUSE).length;
    check(
      "ruins: from dawn the ruin is rebuilt",
      before < 0 && rebuiltAt >= 306 && rebuiltAt < 456 && done === 4,
      `first cell rebuilt at ${rebuiltAt.toFixed(0)} s, ${done} of 4 house cells back at ${world.time.toFixed(0)} s`,
    );
  }
  // 5. A neighbour's house nearer its home point than the ruin of its own (review of 367ebc1: seed
  // 15, rubble 3.15 cells off, a neighbour's house 2.26; she slept under the open sky).
  {
    const { world, rt } = fresh(4, 112, island("small-meadow").land);
    run(world, rt, 120);
    const top = tileHouses(world);
    let case5: { c: Creature; block: number[]; near: number } | undefined;
    for (const c of villagers(world)) {
      if (!c.mind || jobOf(c) === "guard") continue;
      const house = houseOf(world, c);
      if (house < 0 || top[house] < 0) continue;
      const b = top[house];
      const block = [b, b + 1, b + world.w, b + world.w + 1];
      const at = (i: number) => Math.hypot((i % world.w) + 0.5 - c.homeX, Math.floor(i / world.w) + 0.5 - c.homeY);
      const ruinD = Math.min(...block.map(at));
      // An open cell nearer its home point than any cell of its house, not touching it.
      let near = -1;
      for (let i = 0; i < world.n && near < 0; i++)
        if (
          world.cover[i] === C.NONE &&
          at(i) < ruinD &&
          at(i) > 0.8 &&
          block.every((j) => Math.abs((j % world.w) - (i % world.w)) > 1 || Math.abs(Math.floor(j / world.w) - Math.floor(i / world.w)) > 1)
        )
          near = i;
      if (near >= 0) {
        case5 = { c, block, near };
        break;
      }
    }
    if (!case5) check("ruins: a family keeps its own ruin with a neighbour's house nearer its home point", false, "no case found");
    else {
      const { c, block, near } = case5;
      for (const j of block) world.setCover(j, C.RUBBLE);
      world.setCover(near, C.HOUSE);
      const found = homeRuin(world, c);
      const took = houseOf(world, c);
      run(world, rt, 280 - world.time);
      const action = c.mind?.action ?? "";
      check(
        "ruins: a family keeps its own ruin with a neighbour's house nearer its home point",
        block.includes(found) && took === -1 && c.data.rough === true && /by the ruins/.test(action),
        `ruin ${block.includes(found) ? "found" : "missed"}, ${took === -1 ? "no house taken" : "took the neighbour's house"}; "${action}"`,
      );
    }
  }
  // 6. Back in its own house once it is rebuilt (review of b1133dc: from dawn until the builders
  // finished, a family took a neighbour's house for its own and kept it; 17 of 42 were back home).
  {
    const r = ownHouseAfterRebuild([8, 11], 3);
    check(
      "ruins: once its burned house is rebuilt, each family is back in its own house",
      r.total >= 16 && r.own >= r.total * 0.9,
      `${r.own} of ${r.total} in their own house; ${r.rows.join(", ")}`,
    );
  }
  // 7. A ruin nobody rebuilds (no wood, no builders) is kept through the day after the dawn it may
  // be rebuilt from, and given up at the next dawn: the family is not left homeless for good.
  {
    const { world, rt } = fresh(4, 112, island("small-meadow").land);
    run(world, rt, 120);
    const home = villagers(world).find((c) => c.mind && homeRuin(world, c) < 0 && houseOf(world, c) >= 0)!;
    const house = houseOf(world, home);
    const block = houseBlock(world, house);
    for (const j of block) world.setCover(j, C.RUBBLE);
    const keptFor = (fell: number) => {
      for (const j of block) world.ruinedAt.set(j, fell);
      home.data.house = house;
      home.data.houseFor = home.homeX + home.homeY * 1e4;
      return houseOf(world, home) === -1 && homeRuin(world, home) === house;
    };
    // Fell the night before (dawn 306 s): the next evening, 600 s, it is still kept.
    const at = world.time;
    world.time = 600;
    const lastNight = keptFor(250);
    // Fell two nights before: at 700 s, past the second dawn (666 s), given up.
    world.time = 700;
    const twoNights = keptFor(250);
    world.time = at;
    check(
      "ruins: a ruin nobody rebuilds is kept a whole day after its dawn, then given up",
      lastNight && !twoNights,
      `${lastNight ? "kept" : "given up"} the evening after, ${twoNights ? "still kept" : "given up"} after the second dawn`,
    );
  }
  // 8. A village with no builder of its own (review of 4e4e18e: seed 4, the village at (99,12);
  // the island's builders lived 40 cells off and look for ruins within 14 cells of their own
  // village, so its three ruins stood for good). Each family rebuilds its own house, slowly: half a
  // day at the least from its first spell of work (main: 6 s), and by the evening of the day after
  // the one they may be rebuilt (940 s) every ruin is gone. Three islands whose first village has
  // no builder at hand; on seed 2 ten houses burn, among them the house of a lone child (review of
  // 8545a7f: it stood for good, main: 1 of 10 left at 940 s).
  {
    const r = burnedVillagesRebuilt([4, [2, 10], 7], 940);
    const short = r.spans.filter((t) => t < SLOW_REBUILD.least);
    check(
      "ruins: a family rebuilds its own burned house over half a day at the least",
      r.spans.length >= 6 && short.length === 0,
      `${r.spans.length} rebuilt by their family, ${short.length} in under ${SLOW_REBUILD.least} s; took ${r.spans.map(Math.round).join(", ")} s`,
    );
    check(
      "ruins: every burned house is rebuilt by the evening of the day after, builder or not, children and elders too",
      r.burned >= 16 && r.left === 0 && r.young >= 1 && r.youngLeft === 0,
      `${r.left} of ${r.burned} ruins left at 940 s, ${r.youngLeft} of ${r.young} of households with no adult; ${r.rows.join(", ")}`,
    );
  }
}

// The `burn` lived-in houses (3, or a seed's own) nearest the centre of each of the first `villages`
// villages burned by day (120 s) on islands of these seeds; how many still have rubble at `end` (the
// evening of the day after the one they may be rebuilt). Spans: from the first spell of a family's
// work on its ruin (or a neighbour's: anyone but a builder) to the house, for ruins no builder
// worked on. Young: ruins of households with no adult at the fire.
// A cell paved by a road crew (pave clears what stands on a road's cell) counts as cleared.
export function burnedVillagesRebuilt(
  seeds: (number | [number, number])[],
  end: number,
  villages = 1,
): { burned: number; left: number; spans: number[]; young: number; youngLeft: number; rows: string[] } {
  let burned = 0;
  let left = 0;
  let young = 0;
  let youngLeft = 0;
  const spans: number[] = [];
  const rows: string[] = [];
  for (const entry of seeds) {
    const [seed, burn] = typeof entry === "number" ? [entry, 3] : entry;
    const { world, rt } = fresh(seed, 112, island("small-meadow").land);
    run(world, rt, 120);
    const top = tileHouses(world);
    const lived = [
      ...new Set(
        villagers(world)
          .map((c) => houseOf(world, c))
          .filter((h) => h >= 0 && top[h] >= 0)
          .map((h) => top[h]),
      ),
    ];
    const blocks: number[] = [];
    for (const s of world.settlements.slice(0, villages)) {
      const far = (b: number) => Math.hypot((b % world.w) - s.x, Math.floor(b / world.w) - s.y);
      blocks.push(
        ...lived
          .filter((b) => !blocks.includes(b))
          .sort((a, b) => far(a) - far(b))
          .slice(0, burn),
      );
    }
    const cellsOf = (b: number) => [b, b + 1, b + world.w, b + world.w + 1];
    for (const b of blocks) for (const j of cellsOf(b)) world.setCover(j, C.RUBBLE);
    const noAdult = blocks.filter((b) => {
      const kin = villagers(world).filter((c) => cellsOf(b).includes(homeRuin(world, c)));
      return kin.length > 0 && kin.every((c) => unpackLook(c.look).age !== "adult");
    });
    const began = new Map<number, number>();
    const done = new Map<number, number>();
    const built = new Set<number>();
    run(world, rt, end - world.time, () => {
      for (const c of villagers(world)) {
        if (c.mind?.task !== "repair" || c.mind.work <= 0) continue;
        const b = blocks.find((q) => cellsOf(q).includes(c.mind!.cell));
        if (b === undefined) continue;
        // A builder rebuilds at its own speed: not a family's slow rebuild.
        if (jobOf(c) === "builder" || jobOf(c) === "smith") built.add(b);
        else if (!began.has(b)) began.set(b, world.time);
      }
      for (const b of blocks) if (!done.has(b) && cellsOf(b).every((j) => world.cover[j] !== C.RUBBLE)) done.set(b, world.time);
    });
    for (const [b, t] of began) if (done.has(b) && !built.has(b)) spans.push(done.get(b)! - t);
    const standing = blocks.filter((b) => cellsOf(b).some((j) => world.cover[j] === C.RUBBLE));
    burned += blocks.length;
    left += standing.length;
    young += noAdult.length;
    youngLeft += noAdult.filter((b) => standing.includes(b)).length;
    rows.push(`seed ${seed}: ${blocks.length - standing.length} of ${blocks.length}`);
  }
  return { burned, left, spans, young, youngLeft, rows };
}

// Houses burned by day on islands of these seeds, the nearest `burn` to the village's centre that
// someone lives in: of the villagers whose house was rebuilt by the next evening (home not moved),
// how many have it for their house again.
export function ownHouseAfterRebuild(seeds: number[], burn: number): { own: number; total: number; rows: string[] } {
  let own = 0;
  let total = 0;
  const rows: string[] = [];
  for (const seed of seeds) {
    const { world, rt } = fresh(seed, 112, island("small-meadow").land);
    run(world, rt, 120);
    const top = tileHouses(world);
    const before = new Map<Creature, number>();
    for (const c of villagers(world)) {
      const h = houseOf(world, c);
      if (h >= 0 && top[h] >= 0) before.set(c, top[h]);
    }
    const s = world.settlements[0];
    const far = (b: number) => Math.hypot((b % world.w) - s.x, Math.floor(b / world.w) - s.y);
    const burned = [...new Set(before.values())].sort((a, b) => far(a) - far(b)).slice(0, burn);
    const cellsOf = (b: number) => [b, b + 1, b + world.w, b + world.w + 1];
    for (const b of burned) for (const j of cellsOf(b)) world.setCover(j, C.RUBBLE);
    const homes = new Map([...before.keys()].map((c) => [c, c.homeX + c.homeY * 1e4]));
    // Past the dawn (306 s) and the rebuild, before the next night (605 s).
    run(world, rt, 580 - world.time);
    let n = 0;
    let ok = 0;
    for (const [c, b] of before) {
      if (!burned.includes(b) || c.dead || homes.get(c) !== c.homeX + c.homeY * 1e4) continue;
      if (!cellsOf(b).every((j) => world.cover[j] === C.HOUSE)) continue;
      n++;
      if (cellsOf(b).includes(houseOf(world, c))) ok++;
    }
    own += ok;
    total += n;
    const fam = [...before.values()].filter((b) => burned.includes(b)).length;
    const up = burned.filter((b) => cellsOf(b).every((j) => world.cover[j] === C.HOUSE)).length;
    const moved = [...before.keys()].filter((c) => burned.includes(before.get(c)!) && homes.get(c) !== c.homeX + c.homeY * 1e4).length;
    rows.push(`seed ${seed}: ${ok} of ${n} (${fam} burned out, ${up} of ${burned.length} rebuilt, ${moved} moved)`);
  }
  return { own, total, rows };
}
