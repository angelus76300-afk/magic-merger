// Nature holds its shape (21 November, the owner: an island let run looked "just weird";
// src/sim/nature.ts). On main, growth had births and no deaths: grass in flower went from 2-3%
// to over half in every biome, reeds stood far from water, generated dirt greened within five
// minutes, high grass under the snow line went to snow, fences stood on roads and rails ran into
// fields. The checks, each on a generated island with no wild animals and no wonders:
//   1. a fresh temperate island of high relief, five minutes, away from its two villages (their
//      gardens and square are the village growing): no plant grows where its land does not hold
//      it, the trees stay within 10% of their start, the generated dirt stays dirt, no grass
//      turns to snow, a 7 by 7 patch made high (air under -6, under the snow line) stays grass,
//      and a burnt patch (dirt where generation laid grass) greens back from its edge;
//   2. a frost spell snows over 7 of 9 lowland grass cells or more, 10 s after an island is
//      made and 10 s after it is loaded, and a spell's own cold material snows the grass round it;
//   3. an overgrown saved island (seven open grass cells in ten in flower) thins by itself;
//   4. a fence is drawn by its field's side, a lone post without a rail.
// The two islands left running half an hour with their villages (the soak's bounds, plants a
// spell grew, generation's plants kept in their cells) are jobs of npm test's workers
// (scripts/nature-run.ts).
import { C, G } from "../src/sim/materials";
import { DEFAULT_LAND } from "../src/sim/land-options";
import { snowLine } from "../src/sim/genrules";
import { loadWorld, saveWorld } from "../src/sim/save";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { TICK, World, generateWorld } from "../src/sim/world";
import { holds, waterNear } from "../src/sim/nature";
import { fenceKey, railIntoField } from "../src/sim/fences";

type Check = (name: string, ok: boolean, detail?: string) => void;

const PLANTS = new Set<number>([C.FLOWER, C.BUSH, C.BERRIES, C.FERN, C.REEDS]);

function run(world: World, seconds: number, each: () => void = () => {}, seed = 7, rt = new Runtime(world, () => {})): void {
  const was = Math.random;
  Math.random = seeded(seed);
  try {
    for (let k = 0; k < Math.round(seconds / TICK); k++) {
      stepHeadless(world, rt);
      each();
    }
  } finally {
    Math.random = was;
  }
}

function fresh(size: number, seed: number, relief: number): World {
  const was = Math.random;
  Math.random = seeded(seed);
  try {
    const world = generateWorld(size, size, seed, { ...DEFAULT_LAND, relief });
    world.wild = [];
    world.reactions = true;
    // No wonders: a floating rock greens and flowers the land it drifts over, as it should.
    world.wonders = [];
    return world;
  } finally {
    Math.random = was;
  }
}

// Open grass cells, away from water, with a 3 by 3 of them round: n of them, from the middle out.
function openPatches(world: World, n: number, test: (i: number) => boolean): number[] {
  const out: number[] = [];
  const { w } = world;
  for (let y = 4; y < world.h - 4 && out.length < n; y += 5)
    for (let x = 4; x < w - 4 && out.length < n; x += 5) {
      let ok = true;
      for (let dy = -2; dy <= 2 && ok; dy++)
        for (let dx = -2; dx <= 2 && ok; dx++) {
          const j = (y + dy) * w + x + dx;
          if (world.ground[j] !== G.GRASS || world.cover[j] !== C.NONE || world.depth[j] > 0) ok = false;
        }
      if (ok && test(y * w + x)) out.push(y * w + x);
    }
  return out;
}

// A spell's own material, colder than any of the land's, laid on a 3 by 3.
const PERMAFROST = `const spell = { materials: [{ name: "permafrost", layer: "cover", heat: -40, color: "#d8ecff" }], *cast(w) { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) w.set(w.x + dx, w.y + dy, "permafrost"); } };`;

// A frost spell on a 3 by 3 of grass round a cell: three seconds of cold, then the cells under snow
// five seconds later.
const FROST = `const spell = { *cast(w) { for (let k = 0; k < 90; k++) { w.temperature(w.x, w.y, 1.5, -25); yield; } } };`;
function frost(world: World, rt: Runtime, at: number): number {
  const cells: number[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cells.push(at + dy * world.w + dx);
  rt.cast({ key: `frost${at}`, name: "Frost", tier: "minor", code: FROST }, at % world.w, (at / world.w) | 0);
  run(world, 8, () => {}, 7, rt);
  return cells.filter((j) => world.ground[j] === G.SNOW).length;
}

export function natureChecks(check: Check): void {
  // 1 and 2: a fresh temperate island of high relief (its snow line high, the air under it cold).
  {
    const world = fresh(96, 5, 0.9);
    const { w } = world;
    const ground0 = Uint8Array.from(world.ground);
    let trees0 = 0;
    for (let i = 0; i < world.n; i++) if (world.cover[i] === C.TREE) trees0++;
    // A patch made high: cold air (ambient under -6) and still under the snow line, 7 by 7 so its
    // middle keeps its cold (main's rule froze it: under -6 was enough).
    const [high, burnt] = openPatches(world, 2, () => true);
    const hx = high % w;
    const hy = (high / w) | 0;
    const line = snowLine(world, high);
    const highCells: number[] = [];
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const j = (hy + dy) * w + hx + dx;
        world.height[j] = line - 1.2;
        world.ground[j] = G.GRASS;
        if (world.depth[j] === 0) world.temp[j] = world.ambient(j);
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) highCells.push(j);
      }
    check(
      "nature: the high patch has cold air under the snow line",
      world.ambient(high) < -6 && world.height[high] < line,
      `ambient ${world.ambient(high).toFixed(1)}, height ${world.height[high].toFixed(1)}, snow line ${line.toFixed(1)}`,
    );
    // A burnt patch: dirt where generation laid grass.
    const burntCells: number[] = [];
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const j = burnt + dy * w + dx;
        world.ground[j] = G.DIRT;
        burntCells.push(j);
      }
    // Each plant that appears, checked the tick it appears: it stands where its land holds it (the
    // land changes later, as trees grow round it or water comes and goes).
    const village = (i: number) => world.settlements.some((s) => Math.abs(s.x - (i % w)) <= 16 && Math.abs(s.y - ((i / w) | 0)) <= 16);
    const prev = Uint8Array.from(world.cover);
    let offNiche = 0;
    const offKinds: Record<string, number> = {};
    let coldest = Infinity;
    run(world, 300, () => {
      for (let i = 0; i < world.n; i++) {
        const c = world.cover[i];
        if (c === prev[i]) continue;
        prev[i] = c;
        if (PLANTS.has(c) && !village(i) && !holds(world, i, c)) {
          offNiche++;
          const name = world.materials.get("cover", c).name;
          offKinds[name] = (offKinds[name] ?? 0) + 1;
        }
      }
      coldest = Math.min(coldest, ...highCells.map((j) => world.temp[j]));
    });
    let dirtGreened = 0;
    let dirt0 = 0;
    let snowed = 0;
    let trees = 0;
    const burntSet = new Set(burntCells);
    // Away from a village's own ground (16 cells round it): its people plant flowers by their
    // houses and its elders green the square, as they should.
    for (let i = 0; i < world.n; i++) {
      const c = world.cover[i];
      if (c === C.TREE) trees++;
      if (village(i)) continue;
      if (ground0[i] === G.DIRT && !burntSet.has(i)) {
        dirt0++;
        if (world.ground[i] === G.GRASS) dirtGreened++;
      }
      if (ground0[i] === G.GRASS && world.ground[i] === G.SNOW) snowed++;
    }
    check(
      "nature: five minutes, no plant grows where its land does not hold it (away from villages)",
      offNiche === 0,
      `${offNiche} (${JSON.stringify(offKinds)})`,
    );
    check("nature: five minutes, the trees within 10% of their start", Math.abs(trees - trees0) <= trees0 * 0.1, `${trees0} to ${trees}`);
    check("nature: five minutes, generated dirt stays dirt (away from villages)", dirt0 > 20 && dirtGreened === 0, `${dirtGreened} of ${dirt0} greened`);
    check("nature: five minutes, no grass turns to snow by itself", snowed === 0, `${snowed}`);
    check(
      "nature: high grass under the snow line, in air under -6 for five minutes, stays grass",
      coldest < -6 && highCells.every((j) => world.ground[j] === G.GRASS),
      `coldest ${coldest.toFixed(1)}; ${highCells.map((j) => world.materials.get("ground", world.ground[j]).name).join()}`,
    );
    const regrown = burntCells.filter((j) => world.ground[j] === G.GRASS).length;
    check("nature: a burnt patch greens back from its edge", regrown >= 1 && regrown < burntCells.length, `${regrown} of ${burntCells.length}`);
  }
  // 2. A frost spell snows over warm lowland grass at once: ten seconds after an island is made,
  // and ten seconds after it is saved and loaded again (main: 9 of 9 both times).
  {
    const world = fresh(96, 5, 0.9);
    // Three spots of warm lowland grass, away from water and more than 10 cells from each other,
    // so no spell's snow counts for another's.
    const away = (a: number, b: number) => Math.hypot((a % world.w) - (b % world.w), ((a / world.w) | 0) - ((b / world.w) | 0)) > 10;
    const spots: number[] = [];
    for (const i of openPatches(world, 60, (i) => !waterNear(world, i, 4) && world.ambient(i) > 5))
      if (spots.length < 3 && spots.every((j) => away(i, j))) spots.push(i);
    check("nature: three spots for the cold spells", spots.length === 3, `${spots.length}`);
    const rt = new Runtime(world, () => {});
    run(world, 10, () => {}, 7, rt);
    const made = frost(world, rt, spots[0]);
    run(world, 50, () => {}, 7, rt);
    const loaded = loadWorld(saveWorld(world, rt.owners), () => {})!;
    loaded.wild = [];
    loaded.wonders = [];
    const rt2 = new Runtime(loaded, () => {});
    run(loaded, 10, () => {}, 7, rt2);
    const after = frost(loaded, rt2, spots[1]);
    check("nature: a frost spell 10 s after an island is made snows over 7 of 9 cells or more", made >= 7, `${made} of 9`);
    check("nature: a frost spell 10 s after an island is loaded snows over 7 of 9 cells or more", after >= 7, `${after} of 9`);
    // A spell's own cold material (heat -40) on a 3 by 3: the grass round it snows, as the cold
    // spreads (main: 11 of the 25 cells round it here; 6d47f43, which marked only written cold: 0).
    const at = spots[2];
    const ax = at % loaded.w;
    const ay = (at / loaded.w) | 0;
    rt2.cast({ key: "permafrost", name: "Permafrost", tier: "minor", code: PERMAFROST }, ax, ay);
    let most = 0;
    let coldest = Infinity;
    run(
      loaded,
      60,
      () => {
        let n = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (loaded.ground[(ay + dy) * loaded.w + ax + dx] === G.SNOW) n++;
        most = Math.max(most, n);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) coldest = Math.min(coldest, loaded.temp[(ay + dy) * loaded.w + ax + dx]);
      },
      7,
      rt2,
    );
    check(
      "nature: a spell's own cold material snows over 8 of the 25 cells round it or more",
      most >= 8,
      `${most} of 25, the 3 by 3 down to ${coldest.toFixed(1)}`,
    );
  }
  // 3. An overgrown saved island thins by itself.
  {
    const world = fresh(96, 6, 0.5);
    const was = Math.random;
    Math.random = seeded(11);
    for (let i = 0; i < world.n; i++)
      if (world.ground[i] === G.GRASS && world.cover[i] === C.NONE && world.depth[i] === 0 && Math.random() < 0.7) world.setCover(i, C.FLOWER);
    Math.random = was;
    const loaded = loadWorld(saveWorld(world, new Map()), () => {})!;
    loaded.wild = [];
    let before = 0;
    let offBefore = 0;
    for (let i = 0; i < loaded.n; i++)
      if (loaded.cover[i] === C.FLOWER) {
        before++;
        if (!holds(loaded, i, C.FLOWER)) offBefore++;
      }
    run(loaded, 300);
    let after = 0;
    for (let i = 0; i < loaded.n; i++) if (loaded.cover[i] === C.FLOWER) after++;
    check(
      "nature: an overgrown saved island thins by itself (over 4% of its flowers in five minutes)",
      after < before * 0.96,
      `${before} flowers (${offBefore} where the land does not hold them) to ${after}`,
    );
  }
  // 4. Fences: by the field's side, a lone post without a rail.
  {
    const world = new World(12, 12, 1);
    for (let i = 0; i < world.n; i++) world.ground[i] = G.GRASS;
    // A field of 4 by 2 at x 4..7, y 4..5, fenced on its north side (y 3) and its east side (x 8).
    for (let y = 4; y <= 5; y++) for (let x = 4; x <= 7; x++) world.ground[y * 12 + x] = G.FIELD;
    for (let x = 4; x <= 7; x++) world.setCover(3 * 12 + x, C.FENCE);
    for (let y = 4; y <= 5; y++) world.setCover(y * 12 + 8, C.FENCE);
    // A post on its own, its run gone (a road through it).
    world.setCover(10 * 12 + 1, C.FENCE);
    // A one-cell stub on the field's west side, touching the north run only at a corner.
    world.setCover(4 * 12 + 3, C.FENCE);
    check("nature: a fence north of its field runs along x", fenceKey(world, 3 * 12 + 5) === "fence-x", fenceKey(world, 3 * 12 + 5));
    check("nature: a fence east of its field runs along z", fenceKey(world, 4 * 12 + 8) === "fence-z", fenceKey(world, 4 * 12 + 8));
    check("nature: a fence west of its field, alone in x, runs along z", fenceKey(world, 4 * 12 + 3) === "fence-z", fenceKey(world, 4 * 12 + 3));
    check("nature: a lone post has no rail", fenceKey(world, 10 * 12 + 1) === "fence-post", fenceKey(world, 10 * 12 + 1));
    let into = 0;
    for (let i = 0; i < world.n; i++) if (world.cover[i] === C.FENCE && railIntoField(world, i)) into++;
    check("nature: no rail points into its field", into === 0, `${into}`);
  }
}
