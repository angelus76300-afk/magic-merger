// An island left alone (21 November, the owner: an island let run looked "just weird"; nature.ts):
// every few minutes, the share of grass in flower per biome, the bushes, trees and reeds, reeds
// far from water, the dirt and the sand, high grass gone to snow, fences on a road or a path, and
// rails that point into a field. Nothing is cast. Used by npm test in its worker threads (two short
// islands, a check each), and run on its own for the hour-long soak of the pull request:
//   npx esbuild scripts/nature-run.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/nature-run.mjs --log-level=warning
//   node node_modules/.cache/nature-run.mjs <island: meadow|dry|large|small-meadow|small-dry> <minutes> [save dir] [grow]
// It reads only the island's layers, which main has too, so it runs on main to compare.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { populate, resetCreatureIds } from "../src/sim/creatures";
import { biomeAt, DEFAULT_LAND, resolveLand, type LandOptions } from "../src/sim/land";
import { C, F, G } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { saveWorld } from "../src/sim/save";
import { stepHeadless } from "../src/sim/tick";
import { raiseWonders } from "../src/sim/wonderbuild";
import { TICK, generateWorld, type World } from "../src/sim/world";
import { railIntoField } from "../src/sim/fences";
import { holds } from "../src/sim/nature";

export interface Island {
  name: string;
  size: number;
  seed: number;
  land: LandOptions;
}

// The soak's three islands (a meadow, a dry mixed island, a large mixed island), and the two small
// ones npm test runs.
export function island(name: string): Island {
  const at = (size: number, seed: number, choice: Partial<LandOptions>, fixed = false): Island => ({
    name,
    size,
    seed,
    land: fixed ? { ...DEFAULT_LAND, ...choice } : { ...resolveLand({ ...DEFAULT_LAND, ...choice }, seed, size), peaks: true },
  });
  switch (name) {
    case "meadow":
      return at(152, 4, { biome: "temperate", shape: "coast" }, true);
    case "dry":
      return at(208, 1, { warmth: 0.7, water: 0.25, relief: 0.9 });
    case "large":
      return at(208, 11, {});
    case "small-meadow":
      return at(112, 4, { biome: "temperate", shape: "coast" }, true);
    case "small-dry":
      // The dry island's land, mixed on a smaller island: desert, mesa and temperate high ground.
      return { name, size: 128, seed: 1, land: { ...resolveLand({ ...DEFAULT_LAND, warmth: 0.7, water: 0.25, relief: 0.9 }, 1, 208), peaks: true } };
  }
  throw new Error(`no island ${name}`);
}

export interface NatureRow {
  minute: number;
  // Per biome: grass cells and grass in flower, away from the villages (a village's gardens and
  // offerings are the village growing: within 16 cells of its centre, nature.ts GARDEN).
  biomes: Record<string, { grass: number; flower: number }>;
  gardenFlowers: number;
  covers: { flower: number; bush: number; berries: number; fern: number; reeds: number; tree: number };
  // Reeds more than 2 cells from water, and of them those that were not reeds at the start.
  reedsFar: number;
  reedsFarNew: number;
  dirt: number;
  // Dirt away from the villages (a village's houses stand on dirt, its graves are dug: it grows).
  dirtAway: number;
  sand: number;
  // Cells that were grass at the start and are snow now.
  grassToSnow: number;
  fences: number;
  fenceOnWay: number;
  railIntoField: number;
}

export interface NatureRun {
  name: string;
  minutes: number;
  rows: NatureRow[];
  errors: string[];
  seconds: number;
  // Generation's flowers and bushes: how many, how many stand where their land holds them at the
  // start (nature.ts holds), and of those away from the villages (where children pick flowers and
  // houses go up), how many and how many still stand in their own cell at the end.
  generated: { plants: number; held: number; away: number; still: number };
  // Plants a spell grew at the start (GROWN of them, two flowers to a bush, in thick patches on open
  // grass more than 20 cells from any village), and how many still stand at the end; 0 when none.
  grown: { plants: number; still: number };
}

export const GROWN = 200;
// How many of them main kept after half an hour on each small island (grazing and trampling take
// some): this script on main 13a703c, which wilts nothing.
export const GROWN_MAIN_KEPT: Record<string, number> = { "small-meadow": 189, "small-dry": 132 };

// Within 16 cells of a village, now or as generation laid it (nature.ts GARDEN).
function nearVillage(world: World, i: number): boolean {
  const x = i % world.w;
  const y = (i / world.w) | 0;
  return [...world.villages, ...world.settlements].some((v) => Math.abs(v.x - x) <= 16 && Math.abs(v.y - y) <= 16);
}

function waterWithin(world: World, i: number, r: number): boolean {
  const x = i % world.w;
  const y = (i / world.w) | 0;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (!world.inside(x + dx, y + dy)) continue;
      const j = (y + dy) * world.w + x + dx;
      if (world.fluid[j] === F.WATER && world.depth[j] > 0.05) return true;
    }
  return false;
}

export function natureRow(world: World, minute: number, grass0: Uint8Array, cover0: Uint8Array): NatureRow {
  const garden = (i: number) => nearVillage(world, i);
  const row: NatureRow = {
    minute,
    biomes: {},
    gardenFlowers: 0,
    covers: { flower: 0, bush: 0, berries: 0, fern: 0, reeds: 0, tree: 0 },
    reedsFar: 0,
    reedsFarNew: 0,
    dirt: 0,
    dirtAway: 0,
    sand: 0,
    grassToSnow: 0,
    fences: 0,
    fenceOnWay: 0,
    railIntoField: 0,
  };
  for (let i = 0; i < world.n; i++) {
    const g = world.ground[i];
    const c = world.cover[i];
    if (g === G.DIRT) {
      row.dirt++;
      if (!garden(i)) row.dirtAway++;
    } else if (g === G.SAND) row.sand++;
    else if (g === G.SNOW && grass0[i]) row.grassToSnow++;
    if (c === C.FLOWER) row.covers.flower++;
    else if (c === C.BUSH) row.covers.bush++;
    else if (c === C.BERRIES) row.covers.berries++;
    else if (c === C.FERN) row.covers.fern++;
    else if (c === C.TREE) row.covers.tree++;
    else if (c === C.REEDS) {
      row.covers.reeds++;
      if (!waterWithin(world, i, 2)) {
        row.reedsFar++;
        if (cover0[i] !== C.REEDS) row.reedsFarNew++;
      }
    } else if (c === C.FENCE) {
      row.fences++;
      if (g === G.ROAD || g === G.PATH) row.fenceOnWay++;
      if (railIntoField(world, i)) row.railIntoField++;
    }
    if (g === G.GRASS && world.depth[i] === 0) {
      if (garden(i)) {
        if (c === C.FLOWER) row.gardenFlowers++;
        continue;
      }
      const b = biomeAt(world, i);
      const e = (row.biomes[b] ??= { grass: 0, flower: 0 });
      e.grass++;
      if (c === C.FLOWER) e.flower++;
    }
  }
  return row;
}

export function natureRun(name: string, minutes: number, every = 5, out?: string, grow = false): NatureRun {
  const shared = Math.random;
  const t0 = Date.now();
  const spec = island(name);
  Math.random = seeded(spec.seed * 7919 + 1);
  // Creatures numbered from 1 whatever ran before (ids feed their choices): the same alone and in
  // npm test's workers.
  resetCreatureIds(1);
  try {
    Runtime.slowMs = Infinity;
    const world = generateWorld(spec.size, spec.size, spec.seed, spec.land);
    populate(world);
    const errors: string[] = [];
    const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
    raiseWonders(world, rt);
    world.weather = true;
    world.reactions = true;
    const grass0 = new Uint8Array(world.n);
    for (let i = 0; i < world.n; i++) grass0[i] = world.ground[i] === G.GRASS ? 1 : 0;
    const genCells: number[] = [];
    let held = 0;
    for (let i = 0; i < world.n; i++) {
      const c = world.cover[i];
      if (c !== C.FLOWER && c !== C.BUSH) continue;
      genCells.push(i);
      if (holds(world, i, c)) held++;
    }
    // A spell's growth, as the grow ability leaves it: every open grass cell of a 5 by 5 in flower
    // or bush, far thicker than the land would hold, in patches across the island away from the
    // villages; placed as a spell places a plant (World.place).
    const grownCells: number[] = [];
    if (grow) {
      const far = (x: number, y: number) => world.settlements.every((s) => Math.hypot(s.x - x, s.y - y) > 20);
      for (let cy = 6; cy < world.h - 6 && grownCells.length < GROWN; cy += 13)
        for (let cx = 6; cx < world.w - 6 && grownCells.length < GROWN; cx += 13) {
          if (!far(cx, cy)) continue;
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) {
              const i = (cy + dy) * world.w + cx + dx;
              if (grownCells.length >= GROWN || world.ground[i] !== G.GRASS || world.cover[i] !== C.NONE || world.depth[i] > 0) continue;
              world.place(i, grownCells.length % 3 === 2 ? "bush" : "flower");
              grownCells.push(i);
            }
        }
    }
    const grownCover = grownCells.map((i) => world.cover[i]);
    const cover0 = Uint8Array.from(world.cover);
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `${name}-0.json`), JSON.stringify(saveWorld(world, rt.owners)));
    }
    const rows = [natureRow(world, 0, grass0, cover0)];
    const per = Math.round(60 / TICK);
    for (let m = 1; m <= minutes; m++) {
      for (let k = 0; k < per; k++) stepHeadless(world, rt);
      if (m % every === 0 || m === minutes) rows.push(natureRow(world, m, grass0, cover0));
    }
    if (out) writeFileSync(join(out, `${name}-${minutes}.json`), JSON.stringify(saveWorld(world, rt.owners)));
    return {
      name,
      minutes,
      rows,
      errors: errors.slice(0, 3),
      seconds: Math.round((Date.now() - t0) / 1000),
      generated: {
        plants: genCells.length,
        held,
        away: genCells.filter((i) => !nearVillage(world, i)).length,
        still: genCells.filter((i) => !nearVillage(world, i) && world.cover[i] === cover0[i]).length,
      },
      grown: { plants: grownCells.length, still: grownCells.filter((i, k) => world.cover[i] === grownCover[k]).length },
    };
  } finally {
    Math.random = shared;
  }
}

// What the soak asks of a run: each line a bound and whether it held, at the last row.
export function natureVerdict(run: NatureRun): { bound: string; ok: boolean; detail: string }[] {
  const first = run.rows[0];
  const last = run.rows[run.rows.length - 1];
  const out: { bound: string; ok: boolean; detail: string }[] = [];
  const flowers: string[] = [];
  let flowersOk = true;
  for (const [b, e0] of Object.entries(first.biomes)) {
    const e1 = last.biomes[b];
    if (!e1 || e0.grass < 150) continue;
    const s0 = e0.flower / e0.grass;
    const s1 = e1.flower / Math.max(1, e1.grass);
    // Within 1.5 times its start, a point of share and 8 flowers more (a biome of a few hundred
    // grass cells, as the dry island's mesa, can start with none: its niche holds a handful).
    const ok = e1.flower <= (s0 * 1.5 + 0.01) * e1.grass + 8;
    if (!ok) flowersOk = false;
    flowers.push(`${b} ${(s0 * 100).toFixed(1)}% to ${(s1 * 100).toFixed(1)}%`);
  }
  out.push({
    bound: "flower share per biome within 1.5 times its start (away from villages)",
    ok: flowersOk,
    detail: `${flowers.join(", ")}; ${last.gardenFlowers} in village gardens`,
  });
  // A reed the water left (a pool settling) may stand a while before it wilts; none grows far.
  out.push({
    bound: "no reed grows more than 2 cells from water",
    ok: last.reedsFarNew === 0,
    detail: `${last.reedsFarNew} new, ${last.reedsFar} in all (of ${last.covers.reeds} reeds)`,
  });
  const within = (a: number, b: number) => Math.abs(b - a) <= Math.max(10, a * 0.1);
  out.push({
    bound: "dirt cells within 10% (away from villages)",
    ok: within(first.dirtAway, last.dirtAway),
    detail: `${first.dirtAway} to ${last.dirtAway} (${first.dirt} to ${last.dirt} in all)`,
  });
  out.push({ bound: "sand cells within 10%", ok: within(first.sand, last.sand), detail: `${first.sand} to ${last.sand}` });
  out.push({ bound: "no grass turned to snow", ok: last.grassToSnow === 0, detail: `${last.grassToSnow}` });
  out.push({ bound: "no fence on a road or a path", ok: last.fenceOnWay === 0, detail: `${last.fenceOnWay} of ${last.fences}` });
  out.push({ bound: "no rail into a field", ok: last.railIntoField === 0, detail: `${last.railIntoField} of ${last.fences}` });
  const g = run.generated;
  out.push({
    bound: "generation's flowers and bushes: 95% stand where their land holds them",
    ok: g.held >= g.plants * 0.95,
    detail: `${g.held} of ${g.plants}`,
  });
  if (run.minutes >= 30)
    out.push({
      bound: "generation's flowers and bushes away from villages: 80% still in their own cell after half an hour",
      ok: g.still >= g.away * 0.8,
      detail: `${g.still} of ${g.away}`,
    });
  if (run.grown.plants)
    out.push({
      bound: `plants a spell grew: as many still stand as on main (${GROWN_MAIN_KEPT[run.name] ?? 0})`,
      ok: run.grown.still >= (GROWN_MAIN_KEPT[run.name] ?? 0),
      detail: `${run.grown.still} of ${run.grown.plants}`,
    });
  return out;
}

if (typeof process !== "undefined" && process.argv[1]?.includes("nature-run")) {
  const name = process.argv[2] ?? "small-meadow";
  const minutes = Number(process.argv[3] ?? 6);
  const run = natureRun(name, minutes, 5, process.argv[4] || undefined, process.argv[5] === "grow");
  console.log(JSON.stringify(run));
  for (const v of natureVerdict(run)) console.error(`${v.ok ? "ok  " : "FAIL"} ${v.bound}: ${v.detail}`);
  console.error(`${name}: ${minutes} min in ${run.seconds} s`);
}
