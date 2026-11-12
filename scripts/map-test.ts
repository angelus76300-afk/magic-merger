// The island as a map (roadmap 4.9 part 3, src/sim/map.ts): names over their
// villages and never over each other, hidden while a trouble names the
// village, the far roads drawn from the real road cells, a glow as large as a
// village's people, dust and smoke only over a site or a burnt block, a cart
// exactly while a market trip is under way, the director's whole-island shot
// in its rotation and never over a drama that scores higher, nothing of it in
// the eye view, and the simulation untouched by any of it.
import { makeCreature, populate, resetCreatureIds } from "../src/sim/creatures";
import { Director, MAP_AGAIN } from "../src/sim/director";
import { findVillages, mindOf, type Village } from "../src/sim/kin";
import { DEFAULT_LAND, resolveLand } from "../src/sim/land";
import {
  FAR,
  cartCenter,
  coverOf,
  emptyMap,
  fade,
  nameLabels,
  nameOrder,
  onTrip,
  placeNames,
  plumesOf,
  refreshMap,
  roadCells,
  villagesOf,
  type MapVillage,
} from "../src/sim/map";
import { C, G } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { ROAD, pave, type PaveJob, type Road } from "../src/sim/roads";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import type { Trouble } from "../src/sim/troubles";
import { OrbitCamera } from "../src/sim/voxel/orbit";
import { columnTop } from "../src/sim/voxel/terrain";
import { raiseWonders } from "../src/sim/wonderbuild";
import { World, generateWorld } from "../src/sim/world";
import { watchIsland } from "./director-run";

type Check = (name: string, ok: boolean, detail?: string) => void;

function island(seed: number, size = 208): { world: World; rt: Runtime } {
  Runtime.slowMs = Infinity;
  const world = generateWorld(size, size, seed, resolveLand({ ...DEFAULT_LAND }, seed, size));
  populate(world);
  const rt = new Runtime(world, () => undefined);
  raiseWonders(world, rt);
  findVillages(world);
  return { world, rt };
}

// The island whole on a folded phone, as the tour's opening shot frames it, and each name placed as the view places it.
function namesOnScreen(world: World, villages: MapVillage[], W = 344, H = 882) {
  const o = new OrbitCamera(world.w, world.h);
  o.resize(W, H);
  o.tx = world.w / 2;
  o.ty = world.h / 2;
  o.dist = Math.min(o.farthest(), o.distanceFor(Math.max(world.w, world.h) * 0.55));
  o.phi = 0.72;
  const ground = (x: number, y: number) =>
    columnTop(world, Math.max(0, Math.min(world.h - 1, Math.floor(y))) * world.w + Math.max(0, Math.min(world.w - 1, Math.floor(x))));
  for (let k = 0; k < 60; k++) o.update(1 / 30, k / 30, ground, true);
  const at = (v: MapVillage) => {
    const p = o.camera.position
      .clone()
      .set(v.x + 0.5 - world.w / 2, ground(v.x, v.y) + 2, v.y + 0.5 - world.h / 2)
      .project(o.camera);
    return { x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H, behind: p.z > 1 };
  };
  // About the width of a serif letter, a little wide.
  const labels = nameLabels(villages, at, (v) => v.name.length * 9 + 6);
  return { labels, at, cover: coverOf(o.visibleRadius(), world) };
}

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  Math.abs(a.x - b.x) * 2 < a.w + b.w + 6 && Math.abs(a.y - a.h / 2 - (b.y - b.h / 2)) * 2 < a.h + b.h + 5;

// The world's state, as a number: what a five minute scene leaves on the land and where every creature stands.
function hashOf(world: World): number {
  let h = 2166136261;
  const mix = (v: number) => (h = Math.imul(h ^ (v | 0), 16777619));
  for (let i = 0; i < world.n; i++) mix(world.cover[i] * 257 + world.ground[i] * 7 + Math.round(world.height[i] * 10));
  for (const c of world.creatures) mix(Math.round(c.x * 100) * 31 + Math.round(c.y * 100) + c.id);
  for (const v of world.villages) mix(Math.round(v.food * 10) + v.people * 1000);
  return h >>> 0;
}

export function mapChecks(check: Check): void {
  const own = Math.random;
  const ids = resetCreatureIds(1);
  Math.random = seeded(4093);
  try {
    mapChecksSeeded(check);
  } finally {
    Math.random = own;
    resetCreatureIds(ids);
  }
}

function mapChecksSeeded(check: Check): void {
  // 1. Five islands seen whole at 344 by 882: every name over its village, none over another, none under the story line.
  {
    const bad: string[] = [];
    let named = 0;
    let shown = 0;
    for (const seed of [3, 5, 8, 13, 21]) {
      const { world } = island(seed);
      const villages = villagesOf(world);
      named += villages.length;
      if (villages.length !== world.settlements.length) bad.push(`${seed}: ${villages.length} names for ${world.settlements.length} villages`);
      const { labels, at, cover } = namesOnScreen(world, villages);
      if (fade(cover, FAR.names) < 0.99) bad.push(`${seed}: names not fully up at the whole island (${cover.toFixed(2)})`);
      const story = { x: 10, y: 10, w: 324, h: 54 };
      const on = placeNames(labels, nameOrder(villages), { w: 344, h: 882 }, [story]);
      labels.forEach((l, k) => {
        if (!on[k]) return;
        shown++;
        const p = at(villages[k]);
        if (Math.abs(l.x - p.x) > 1 || l.y - p.y < 10 || l.y - p.y > 30) bad.push(`${seed} ${villages[k].name}: not at its village`);
        if (l.y - l.h < story.y + story.h) bad.push(`${seed} ${villages[k].name}: under the story line`);
        labels.forEach((o, j) => j < k && on[j] && overlap(l, o) && bad.push(`${seed}: ${villages[k].name} over ${villages[j].name}`));
      });
    }
    check(
      "map: names at their villages on five islands, none over another or the story line",
      bad.length === 0 && shown >= 15,
      `${shown}/${named} shown; ${bad.join("; ")}`,
    );
    // Two names on the same spot: the larger village keeps its name.
    const a: MapVillage = { name: "Ashby", x: 0, y: 0, tier: "town", people: 30, houses: 16, lit: 1, hidden: false };
    const b: MapVillage = { ...a, name: "Brill", tier: "hamlet", people: 6 };
    const labels = nameLabels(
      [b, a],
      () => ({ x: 100, y: 100, behind: false }),
      () => 60,
    );
    const on = placeNames(labels, nameOrder([b, a]), { w: 344, h: 882 }, []);
    check("map: of two names in one place, the larger village's is shown", !on[0] && on[1], JSON.stringify(on));
  }
  // 2. A trouble's line names the village: its name is not on the map meanwhile, the others are.
  {
    const { world } = island(8);
    const shownNow = () => {
      const villages = villagesOf(world);
      const { labels } = namesOnScreen(world, villages);
      const on = placeNames(labels, nameOrder(villages), { w: 344, h: 882 }, []);
      return new Map(villages.map((v, k) => [v.name, on[k]]));
    };
    const calm = shownNow();
    const s = world.settlements.find((t) => calm.get(t.name!))!;
    world.trouble = { name: s.name!, vx: s.x, vy: s.y } as Trouble;
    const during = shownNow();
    world.trouble = null;
    const after = shownNow();
    const others = [...calm.keys()].filter((n) => n !== s.name).every((n) => calm.get(n) === during.get(n));
    check(
      "map: a village's name is hidden while a trouble's line names it, the others stay, and back after",
      calm.get(s.name!) === true && during.get(s.name!) === false && others && after.get(s.name!) === true,
      JSON.stringify([...during]),
    );
  }
  // 3. The far roads are the real road cells: a road laid cell by cell is on the map as it is laid, and only then.
  {
    const world = new World(64, 64, 5);
    world.height.fill(10);
    const cells = Array.from({ length: 30 }, (_, k) => 32 * 64 + 10 + k);
    const road: Road = { ax: 10, ay: 32, bx: 39, by: 32, a: "A", b: "B", cells, decks: cells.map(() => -999), made: 0 };
    world.roads.push(road);
    world.roadsVersion++;
    const before = roadCells(world).length;
    const v: Village = { x: 10, y: 32, food: 9, wood: 9, gold: 0, people: 8, houses: 4 };
    for (let k = 0; k < 12; k++) pave(world, { road, k, cell: cells[k], stand: cells[Math.max(0, k - 1)], bridge: false } as PaveJob, v);
    // And a worn lane by a village (roads.ts wearMinute): the same ground.
    world.ground[20 * 64 + 20] = G.ROAD;
    const after = roadCells(world);
    const want = [...cells.slice(0, 12), 20 * 64 + 20].sort((x, y) => x - y);
    check(
      "map: the far roads are drawn from the same cells as the roads, laid or worn, and none before",
      before === 0 && after.length === want.length && after.every((i, k) => i === want[k]) && ROAD.roadSpeed > 1,
      `${before} before, ${after.length} after`,
    );
  }
  // 4. The glow at night follows people: as many windows lit as two to a house, never more than all.
  {
    const world = new World(96, 64, 5);
    world.height.fill(10);
    world.settlements.push({ x: 20, y: 30, style: 0, level: 1, name: "Ashby" }, { x: 70, y: 30, style: 0, level: 1, name: "Brill" });
    world.villages = [
      { x: 20, y: 30, food: 9, wood: 9, gold: 0, people: 6, houses: 8 },
      { x: 70, y: 30, food: 9, wood: 9, gold: 0, people: 16, houses: 8 },
    ];
    const [few, many] = villagesOf(world);
    world.villages[1].people = 40;
    const full = villagesOf(world)[1];
    world.villages[0].people = 0;
    const gone = villagesOf(world);
    check(
      "map: the glow's size follows people (6 and 16 people in 8 houses light 3/8 and all), an empty village has no name",
      Math.abs(few.lit - 6 / 16) < 1e-9 && many.lit === 1 && full.lit === 1 && gone.length === 1 && gone[0].name === "Brill",
      `${few.lit} ${many.lit} ${full.lit} ${gone.length}`,
    );
  }
  // 5. Dust over a site, smoke over a burnt block, nothing anywhere else.
  {
    const world = new World(96, 64, 5);
    world.height.fill(10);
    world.settlements.push({ x: 40, y: 30, style: 0, level: 1, name: "Ashby" });
    const none = plumesOf(world).length;
    world.sites.push({ i: 28 * 96 + 36, kind: C.HOUSE, work: 0, logs: 2, since: 0 });
    for (const i of [33 * 96 + 44, 33 * 96 + 45, 34 * 96 + 44, 34 * 96 + 45]) world.cover[i] = C.RUBBLE;
    // Rubble far from any village is not a village hurt.
    world.cover[60 * 96 + 90] = C.RUBBLE;
    const p = plumesOf(world);
    const dust = p.filter((q) => q.kind === "dust");
    const smoke = p.filter((q) => q.kind === "smoke");
    check(
      "map: dust over a site, smoke over a burnt block, nothing where there is neither",
      none === 0 &&
        dust.length === 1 &&
        dust[0].x === 37 &&
        dust[0].y === 29 &&
        smoke.length === 1 &&
        Math.abs(smoke[0].x - 44.5) <= 1 &&
        Math.abs(smoke[0].y - 33.5) <= 1,
      JSON.stringify(p),
    );
  }
  // 6. A cart exactly while a market trip is under way, behind its villager.
  {
    const world = new World(64, 64, 5);
    const c = makeCreature("villager", 20, 20);
    world.creatures.push(c);
    const m = mindOf(c);
    const home: Village = { x: 20, y: 20, food: 9, wood: 9, gold: 0, people: 8, houses: 4 };
    const there: Village = { ...home, x: 50 };
    const idle = onTrip(c);
    c.data.trip = { from: home, to: there };
    m.task = "trade";
    const going = onTrip(c);
    m.task = "eat";
    const hungry = onTrip(c);
    m.task = "trade";
    c.data.trip = { from: home, to: { x: 40, y: 40, seed: 3 } };
    const wonder = onTrip(c);
    c.data.trip = undefined;
    const done = onTrip(c);
    const at = cartCenter(20, 20, 0, 1);
    const far = cartCenter(20, 20, Math.PI / 2, 3);
    check(
      "map: a cart exactly while a trip to another village is under way, behind its villager",
      !idle && going && !hungry && !wonder && !done && at.x < 20 && at.x > 18.5 && at.y === 20 && Math.abs(far.x - 20) < 1e-9 && far.y < 20 && far.y > 17.5,
      JSON.stringify({ idle, going, hungry, wonder, done, at, far }),
    );
  }
  // 7. The director: the whole island in its rotation, never over a drama that scores higher.
  {
    const r = watchIsland(7, 360);
    const maps = r.shots.filter((s) => s.sort === "map");
    const apart = maps.every((s, k) => !k || s.since - maps[k - 1].since >= MAP_AGAIN);
    check(
      "map: the director shows the whole island in its rotation, about 6 s, at most once every three minutes",
      maps.length >= 1 && maps.every((s) => s.held >= 2 && s.held <= 7) && apart && r.summary.empty === 0,
      JSON.stringify(maps.map((s) => [Math.round(s.since), Math.round(s.held * 10) / 10])),
    );
    const world = new World(64, 64, 5);
    world.height.fill(10);
    world.time = 10;
    world.settlements.push({ x: 10, y: 10, style: 0, level: 1, name: "Ashby" }, { x: 50, y: 50, style: 0, level: 1, name: "Brill" });
    const d = new Director(() => 0.5);
    (d as unknown as { sinceWide: number }).sinceWide = 6;
    const quiet = d.update(world).shot;
    const wolf = makeCreature("wolf", 20, 20);
    const deer = makeCreature("deer", 26, 20);
    world.creatures.push(wolf, deer);
    mindOf(wolf).task = "hunt";
    mindOf(wolf).target = deer;
    const d2 = new Director(() => 0.5);
    (d2 as unknown as { sinceWide: number }).sinceWide = 6;
    const hunt = d2.update(world).shot;
    // The hunt starts during the map shot: it cuts in once the shot's two seconds are past.
    world.creatures.length = 0;
    const d3 = new Director(() => 0.5);
    (d3 as unknown as { sinceWide: number }).sinceWide = 6;
    const first = d3.update(world).shot;
    world.creatures.push(wolf, deer);
    world.time += 2.5;
    const cut = d3.update(world).shot;
    check(
      "map: the whole island when nothing scores higher; a hunt comes first, and cuts into it",
      quiet?.sort === "map" && quiet.r >= 64 * 0.55 && hunt?.kind === "drama" && first?.sort === "map" && cut?.kind === "drama",
      `${quiet?.sort} ${hunt?.kind} ${first?.sort} ${cut?.kind}`,
    );
  }
  // 8. Nothing of the map in the eye view (the view counts the eye as nothing of the island held), all of it from far.
  {
    const layers = Object.values(FAR);
    check(
      "map: nothing drawn in the eye view, all of it with the island whole",
      layers.every((l) => fade(0, l) === 0 && fade(1, l) === 1),
    );
  }
  // 9. The simulation untouched: the same island, five minutes, with and without the map read every frame: the same draws, the same world.
  {
    const run = (withMap: boolean) => {
      resetCreatureIds(1);
      let draws = 0;
      const random = seeded(77);
      Math.random = () => (draws++, random());
      const { world, rt } = island(13, 152);
      const map = emptyMap();
      let carts = 0;
      for (let t = 0; t < 5 * 60 * 30; t++) {
        stepHeadless(world, rt);
        if (!withMap) continue;
        refreshMap(world, map);
        for (const c of world.creatures) if (onTrip(c)) carts++;
      }
      return { hash: hashOf(world), draws, carts, version: map.version };
    };
    const plain = run(false);
    const mapped = run(true);
    check(
      "map: the island's random draws and a five minute scene are the same with and without the map",
      plain.hash === mapped.hash && plain.draws === mapped.draws && mapped.version >= 90,
      JSON.stringify({ plain, mapped }),
    );
  }
}
