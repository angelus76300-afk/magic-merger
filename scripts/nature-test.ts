// Nature holds its shape (21 November, the owner: an island let run looked "just weird";
// src/sim/nature.ts). On main, growth had births and no deaths: grass in flower went from 2-3%
// to over half in every biome, reeds stood far from water, generated dirt greened within five
// minutes, high grass under the snow line went to snow, fences stood on roads and rails ran into
// fields. The checks, each on a generated island with no wild animals and no wonders:
//   1. a fresh temperate island of high relief, five minutes, away from its two villages (their
//      gardens and square are the village growing): no plant grows outside its niche,
//      the trees stay within 10% of their start, the generated dirt stays dirt, no grass turns to
//      snow, and a patch made high (cold air, under the snow line) stays grass;
//   2. on it, a burnt patch (dirt where generation laid grass) greens back from its edge, and a
//      spell's cold (-15 held three seconds) still makes snow on warm lowland grass;
//   3. an overgrown saved island (seven open grass cells in ten in flower) thins by itself;
//   4. a fence is drawn by its field's side, a lone post without a rail.
// The two islands left running a few minutes with their villages (the soak's bounds) are jobs of
// npm test's workers (scripts/nature-run.ts).
import { C, G } from "../src/sim/materials";
import { DEFAULT_LAND } from "../src/sim/land-options";
import { snowLine } from "../src/sim/genrules";
import { loadWorld, saveWorld } from "../src/sim/save";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { TICK, World, generateWorld } from "../src/sim/world";
import { niche, waterNear } from "../src/sim/nature";
import { fenceKey, railIntoField } from "../src/sim/fences";

type Check = (name: string, ok: boolean, detail?: string) => void;

const PLANTS = new Set<number>([C.FLOWER, C.BUSH, C.BERRIES, C.FERN, C.REEDS]);

function run(world: World, seconds: number, each: () => void = () => {}, seed = 7): void {
  const was = Math.random;
  Math.random = seeded(seed);
  const rt = new Runtime(world, () => {});
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

export function natureChecks(check: Check): void {
  // 1 and 2: a fresh temperate island of high relief (its snow line high, the air under it cold).
  {
    const world = fresh(96, 5, 0.9);
    const { w } = world;
    const ground0 = Uint8Array.from(world.ground);
    let trees0 = 0;
    for (let i = 0; i < world.n; i++) if (world.cover[i] === C.TREE) trees0++;
    // A patch made high: cold air (ambient under -6) and still under the snow line.
    const [high, burnt] = openPatches(world, 2, () => true);
    // A lowland patch far from water (a pond that rises would wet it).
    const [cold] = openPatches(world, 1, (i) => i !== high && i !== burnt && !waterNear(world, i, 8) && world.ambient(i) > 10);
    const hx = high % w;
    const hy = (high / w) | 0;
    const line = snowLine(world, high);
    const highCells: number[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const j = (hy + dy) * w + hx + dx;
        world.height[j] = line - 1.2;
        world.temp[j] = world.ambient(j);
        highCells.push(j);
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
    const coldCells: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) coldCells.push(cold + dy * w + dx);
    let t = 0;
    let coldSnow = 0;
    // Each plant that appears, checked against its niche the tick it appears (a niche moves later
    // as trees grow round it or water comes and goes).
    const village = (i: number) => world.settlements.some((s) => Math.abs(s.x - (i % w)) <= 16 && Math.abs(s.y - ((i / w) | 0)) <= 16);
    const prev = Uint8Array.from(world.cover);
    let offNiche = 0;
    const offKinds: Record<string, number> = {};
    run(world, 300, () => {
      for (let i = 0; i < world.n; i++) {
        const c = world.cover[i];
        if (c === prev[i]) continue;
        prev[i] = c;
        if (PLANTS.has(c) && !village(i) && niche(world, i) !== c) {
          offNiche++;
          const name = world.materials.get("cover", c).name;
          offKinds[name] = (offKinds[name] ?? 0) + 1;
        }
      }
      t += TICK;
      // Once the island has settled (nature.ts SETTLE, three minutes).
      if (t < 200) return;
      if (t < 203) for (const j of coldCells) world.temp[j] = -15;
      else if (!coldSnow) coldSnow = coldCells.filter((j) => world.ground[j] === G.SNOW).length;
    });
    let dirtGreened = 0;
    let dirt0 = 0;
    let snowed = 0;
    let trees = 0;
    const burntSet = new Set(burntCells);
    const coldSet = new Set(coldCells);
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
      if (ground0[i] === G.GRASS && world.ground[i] === G.SNOW && !coldSet.has(i)) snowed++;
    }
    check("nature: five minutes, no plant grows outside its niche (away from villages)", offNiche === 0, `${offNiche} (${JSON.stringify(offKinds)})`);
    check("nature: five minutes, the trees within 10% of their start", Math.abs(trees - trees0) <= trees0 * 0.1, `${trees0} to ${trees}`);
    check("nature: five minutes, generated dirt stays dirt (away from villages)", dirt0 > 20 && dirtGreened === 0, `${dirtGreened} of ${dirt0} greened`);
    check("nature: five minutes, no grass turns to snow by itself", snowed === 0, `${snowed}`);
    check(
      "nature: high grass under the snow line, in air under -6, stays grass",
      highCells.every((j) => world.ground[j] === G.GRASS),
      highCells.map((j) => world.materials.get("ground", world.ground[j]).name).join(),
    );
    const regrown = burntCells.filter((j) => world.ground[j] === G.GRASS).length;
    check("nature: a burnt patch greens back from its edge", regrown >= 1 && regrown < burntCells.length, `${regrown} of ${burntCells.length}`);
    check("nature: a spell's cold (-15, three seconds) makes snow on lowland grass", coldSnow >= 5, `${coldSnow} of 9`);
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
        if (niche(loaded, i) !== C.FLOWER) offBefore++;
      }
    run(loaded, 300);
    let after = 0;
    for (let i = 0; i < loaded.n; i++) if (loaded.cover[i] === C.FLOWER) after++;
    check(
      "nature: an overgrown saved island thins by itself (over 4% of its flowers in five minutes)",
      after < before * 0.96,
      `${before} flowers (${offBefore} outside their niche) to ${after}`,
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
