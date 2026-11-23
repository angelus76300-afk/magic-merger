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
//      rebuilt; a ruin saved and loaded at night still waits for the dawn.
// The measurement of the pull request (ten islands, before and after) is scripts/fire-run.ts.
import { populate, resetCreatureIds, type Creature } from "../src/sim/creatures";
import { daylight } from "../src/sim/daylight";
import { homeRuin, houseOf, ruinStands, tileHouses } from "../src/sim/homes";
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
    const caught = (bush: boolean, trials: number) => {
      let n = 0;
      withRandom(bush ? 11 : 12, () => {
        for (let t = 0; t < trials; t++) {
          world.cover.set(keep.cover);
          world.ground.set(keep.ground);
          world.fire.set(keep.fire);
          world.temp.set(keep.temp);
          world.coverHp.set(keep.hp);
          for (const j of ring) {
            world.ground[j] = G.GRASS;
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
    const kept = kin.filter((c) => Math.hypot(c.homeX - homeAt[0], c.homeY - homeAt[1]) < 0.01);
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
    // From dawn, 306 s, rebuilding starts, done within four minutes.
    run(world, rt, 300 - world.time, watch);
    const before = rebuiltAt;
    run(world, rt, 246, watch);
    const done = block.filter((j) => world.cover[j] === C.HOUSE).length;
    check(
      "ruins: from dawn the ruin is rebuilt",
      before < 0 && rebuiltAt >= 306 && done === 4,
      `first cell rebuilt at ${rebuiltAt.toFixed(0)} s, ${done} of 4 house cells back at ${world.time.toFixed(0)} s`,
    );
  }
}
