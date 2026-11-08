// Roads (4.9, src/sim/roads.ts): flow fields that prefer them, bridges that
// carry walkers, worn and laid roads, and saves. Small flat islands built by
// hand, so each check sees one rule.
import { makeCreature, updateCreature } from "../src/sim/creatures";
import type { Village } from "../src/sim/kin";
import { C, F, G } from "../src/sim/materials";
import { Mobility, STEP, pathsOf } from "../src/sim/paths";
import { ROAD, laid, nextPave, noteTrip, pave, roadSpeed, roadsOf, stepRoads, wearMinute } from "../src/sim/roads";
import { loadWorld, saveWorld } from "../src/sim/save";
import { World } from "../src/sim/world";

type Check = (name: string, ok: boolean, detail?: string) => void;

// A flat green island, dry, height 10.
function flat(w: number, h: number): World {
  const world = new World(w, h, 5);
  world.height.fill(10);
  world.time = 10;
  return world;
}

// A river running north to south, `wide` cells wide, two deep, in the middle.
function river(world: World, wide: number): number {
  const x0 = Math.floor(world.w / 2 - wide / 2);
  for (let y = 0; y < world.h; y++)
    for (let x = x0; x < x0 + wide; x++) {
      const i = y * world.w + x;
      world.height[i] = 8.5;
      world.fluid[i] = F.WATER;
      world.depth[i] = 2;
    }
  return x0;
}

// The field toward (x, y), filled to the end.
function field(world: World, x: number, y: number) {
  const paths = pathsOf(world);
  let f = paths.toward(world, Mobility.WALK, x, y, false);
  for (let t = 0; t < 400 && !f; t++) {
    paths.step(world);
    f = paths.toward(world, Mobility.WALK, x, y, false);
  }
  return f!;
}

function village(x: number, y: number, wood = 30): Village {
  return { x, y, food: 10, wood, gold: 3, people: 8, houses: 4 };
}

export function roadsChecks(check: Check): void {
  // 1. With no road, a field's cost is STEP times the old count of steps:
  // the walk of 4.3 is unchanged on every island until a road is laid.
  {
    const world = flat(48, 48);
    for (let y = 10; y < 30; y++) world.cover[y * 48 + 20] = C.TREE;
    const f = field(world, 40, 20);
    // Breadth first by hand from the same destination block.
    const steps = new Int32Array(world.n).fill(-1);
    const q: number[] = [];
    for (let y = 20; y < 24; y++)
      for (let x = 40; x < 44; x++) {
        steps[y * 48 + x] = 0;
        q.push(y * 48 + x);
      }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      const x = i % 48;
      const y = (i / 48) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= 48 || ny >= 48) continue;
        const j = ny * 48 + nx;
        if (steps[j] >= 0 || world.cover[j] === C.TREE || steps[i] + 1 > 64) continue;
        steps[j] = steps[i] + 1;
        q.push(j);
      }
    }
    let differ = 0;
    for (let i = 0; i < world.n; i++) if ((steps[i] < 0 ? 0xffff : steps[i] * STEP) !== f.dist[i]) differ++;
    check("with no road, a flow field is the old walk, cost for cost", differ === 0, `${differ} cells differ`);
  }

  // 2. A road a little out of the way is taken: the walk from (4, 14) to
  // (44, 12) goes up to the road along y 9 instead of straight across.
  {
    const world = flat(48, 24);
    for (let x = 2; x < 46; x++) world.ground[9 * 48 + x] = G.ROAD;
    const f = field(world, 44, 12);
    const out = { x: 0, y: 0 };
    pathsOf(world).aim(world, f, 4, 14, out);
    const plain = flat(48, 24);
    const g = field(plain, 44, 12);
    check(
      "a walker keeps to a road that is a little out of its way",
      out.y < 14 && f.dist[14 * 48 + 4] < g.dist[14 * 48 + 4],
      `aims at (${out.x}, ${out.y}), cost ${f.dist[14 * 48 + 4]} with the road, ${g.dist[14 * 48 + 4]} without`,
    );
    check(
      "walking is faster on a path, a dirt road and a bridge",
      roadSpeed(world, 9 * 48 + 5) === ROAD.roadSpeed && roadSpeed(world, 2 * 48 + 5) === 1 && ROAD.roadSpeed > ROAD.trailSpeed && ROAD.trailSpeed > 1,
    );
  }

  // 3. Two villages either side of a river six wide: they trade, mark out a
  // road with a bridge, lay it, and walkers cross on its deck.
  {
    const world = flat(96, 40);
    river(world, 6);
    const a = village(14, 20);
    const b = village(82, 20);
    world.villages = [a, b];
    const before = field(world, 82, 20);
    const cutOff = before.dist[20 * 96 + 14] === 0xffff;
    for (let t = 0; t < ROAD.linkTrips; t++) noteTrip(world, a, b);
    for (let t = 0; t < 2000 && !world.roads.length; t++) {
      world.tick++;
      stepRoads(world);
    }
    const road = world.roads[0];
    const water = road ? road.cells.filter((i) => world.fluid[i] === F.WATER).length : 0;
    check(
      "villages that trade across a river mark out a road over it",
      cutOff && !!road && water === 6 && road.decks.every((d, k) => (world.fluid[road.cells[k]] === F.WATER ? d > 10 : d === -999)),
      road ? `${road.cells.length} cells, ${water} over water, decks ${road.decks.filter((d) => d !== -999).join(" ")}` : "no road",
    );
    if (road) {
      // Builders from both ends, one cell at a time.
      let jobs = 0;
      for (let t = 0; t < 400; t++) {
        const v = t % 2 ? a : b;
        const job = nextPave(world, v);
        if (!job) continue;
        if (pave(world, job, v)) jobs++;
      }
      const all = road.cells.every((_, k) => laid(world, road, k));
      const bridges = road.cells.filter((i) => world.cover[i] === C.BRIDGE).length;
      check(
        "builders lay the road from both ends, planks over the water for wood",
        all && bridges === 6 && a.wood + b.wood === 60 - 12,
        `${jobs} cells laid, ${bridges} planks, wood left ${a.wood + b.wood}`,
      );
      world.time += 60;
      const after = field(world, 82, 20);
      check("a walker can now cross the river on the bridge", after.dist[20 * 96 + 14] !== 0xffff, `cost ${after.dist[20 * 96 + 14]}`);
      check("the villager's card says where its roads go", roadsOf(world, a).join() === "to the village, finished, over a bridge", roadsOf(world, a).join());

      // A villager on the deck stays dry and does not drown.
      const deck = road.cells.find((i) => world.cover[i] === C.BRIDGE)!;
      const c = makeCreature("villager", (deck % 96) + 0.5, Math.floor(deck / 96) + 0.5);
      world.creatures.push(c);
      const hp = c.hp;
      for (let t = 0; t < 150; t++) {
        world.tick++;
        world.time += 1 / 30;
        updateCreature(world, c, 1 / 30);
      }
      const at = Math.round(c.y) * 96 + Math.round(c.x);
      check(
        "a villager on a bridge keeps dry feet",
        c.hp >= hp && c.drowning === 0 && (world.depth[at] === 0 || world.onDeck(at)),
        `hp ${c.hp}/${hp}, drowning ${c.drowning}, at (${c.x.toFixed(1)}, ${c.y.toFixed(1)})`,
      );

      // Saved and loaded: the road, its planks and their decks.
      const loaded = loadWorld(JSON.parse(JSON.stringify(saveWorld(world, new Map()))), () => {});
      const same =
        !!loaded &&
        loaded.roads.length === 1 &&
        loaded.roads[0].cells.join() === road.cells.join() &&
        road.cells.every((i) => world.onDeck(i) === loaded.onDeck(i) && world.walkLevel(i) === loaded.walkLevel(i));
      check("a road and its bridge are saved with the island", same);
      // A save from before roads loads with none, and its bridges' cells are plain.
      const old = JSON.parse(JSON.stringify(saveWorld(world, new Map())));
      delete old.roads;
      const older = loadWorld(old, () => {});
      check("an island saved before roads loads with none", !!older && older.roads.length === 0 && older.decks.size === 0);
    }
  }

  // 4. Worn roads: a path walked hard for minutes running near a village is
  // trodden into a dirt road, never more than a share of the land round
  // it, and fades back to a path once nobody walks it.
  {
    const world = flat(64, 64);
    world.villages = [village(32, 32)];
    world.wear = new Uint8Array(world.n);
    for (let y = 18; y < 46; y++)
      for (let x = 18; x < 46; x++) {
        world.ground[y * 64 + x] = G.PATH;
        world.wear[y * 64 + x] = 60;
      }
    for (let m = 0; m < ROAD.dirtMinutes - 1; m++) wearMinute(world);
    const early = world.ground.filter((g) => g === G.ROAD).length;
    wearMinute(world);
    const worn = world.ground.filter((g) => g === G.ROAD).length;
    // The share is of the land within 14 cells of the center, 29 by 29.
    const cap = Math.ceil(29 * 29 * ROAD.dirtShare);
    check(
      "a path walked hard for minutes running becomes a dirt road, within its share",
      early === 0 && worn > 0 && worn <= cap,
      `${early} early, ${worn} after, cap ${cap}`,
    );
    world.wear.fill(0);
    for (let m = 0; m < ROAD.dirtFade; m++) wearMinute(world);
    const left = world.ground.filter((g) => g === G.ROAD).length;
    check("a worn road nobody walks goes back to a path", left === 0, `${left} left`);
  }

  // 5. No road between two halves of one village, or to itself.
  {
    const world = flat(64, 32);
    const a = village(10, 16);
    const b = village(30, 16);
    world.villages = [a, b];
    for (let t = 0; t < 10; t++) noteTrip(world, a, b);
    for (let t = 0; t < 200; t++) {
      world.tick++;
      stepRoads(world);
    }
    check("no road between villages closer than a village's reach", world.roads.length === 0);
    // A villager who settled alone far off is not a village.
    const lone = { ...village(60, 16), people: 1 };
    world.villages = [a, lone];
    for (let t = 0; t < 10; t++) noteTrip(world, a, lone);
    for (let t = 0; t < 200; t++) {
      world.tick++;
      stepRoads(world);
    }
    check("no road to a villager who settled alone", world.roads.length === 0);
  }
}
