import { C, F, G } from "./materials";
import { Rng } from "./noise";
import { BIOMES, seedRoll, type Biome } from "./land-options";
import type { World } from "./world";
import type { Creature } from "./creatures";
import { DAMP, HEART, WOODLAND, cellHash, distanceTo, isSea } from "./ecology";
import { daylight, dayOf, fullMoon } from "./daylight";
import { deed, tell, villageOf } from "./kin";
import { sendTo } from "./goals";
import { SPECIES, habitatCells } from "./wildlife";
import { calmDown } from "./flight";
import { islandName, wonderName } from "./names";

// Wonders (4.4.5 part B): a catalog of natural wonders, each with a rarity,
// a place it needs, a shape it gives the land, and something it does (the
// 3.6 rule: nothing on the island is only decoration). Every island made by
// land.ts gets two to four, at least one uncommon or better, and never the
// same set as one of the player's last ten islands (the page keeps their
// signatures and hands them in).
//
// The land part of a wonder is real land: a sinkhole is a hole full of
// water, a crater a bowl with a rim, sea stacks columns of rock in the sea,
// a waterfall a spring over a drop. What stands above the land (an arch, a
// world tree, bones, a temple) is drawn by the view from the wonder's own
// seed (voxel/wonders.ts), so no two arches are alike, and costs nothing of
// the 20,000 voxels spells share. Its foot is a solid cover ("wonder") so
// creatures walk round it.
//
// Placed after the villages and before ecology.ts dresses the island, with
// its own random stream: the land, the rivers and the villages come out as
// in part A, and the plants grow around the wonders by the same rules.

import { RARITIES, SPOTS, type Rarity, type Spot } from "../../shared/wonders";
export { RARITIES, SPOTS, type Rarity, type Spot };

export interface Wonder {
  kind: string;
  x: number;
  y: number;
  // How far it reaches, in cells.
  r: number;
  seed: number;
  name: string;
  // Free per kind: a geyser's next eruption, the dragon's waking, the
  // floating rock's place on its loop, the day bones last rose.
  t: number;
  state: number;
  // A second spot: a waterfall's top, the arch's direction (radians).
  ax: number;
  ay: number;
  // A wonder written as a program (4.4.5 part C): its definition travels
  // with it, code included, so a saved island keeps it even once retired.
  def?: WonderDef;
  // The creature kinds its program brought (not saved: found again when it
  // is compiled), at most WONDER_CREATURES alive.
  own?: string[];
}

// A wonder written as a program: one a day from the API, or a player's
// discovery grown into the world (worker/wonders.ts). The pool of live ones
// comes from the server; each island draws from it beside the built-in kinds.
export interface WonderDef {
  id: number;
  kind: string;
  rarity: Rarity;
  lands: Biome[];
  spot: Spot;
  reach: number;
  does: string;
  code: string;
  source: "daily" | "player";
  // The friend who found it first, for a player's discovery.
  by?: string;
}

// Alive at once, of the creatures a program wonder brought.
export const WONDER_CREATURES = 3;

interface Kind {
  kind: string;
  rarity: Rarity;
  // What the first look and the inspect card call it.
  label: string;
  // What it does, in a few words, for the card and the story.
  does: string;
  lands: readonly Biome[] | "any";
  // Its best spot, or null where the island has none.
  find: (ctx: Ctx, rng: Rng, lands: readonly Biome[] | "any") => { x: number; y: number; ax?: number; ay?: number; r: number } | null;
  shape?: (world: World, w: Wonder, ctx: Ctx, rng: Rng) => void;
  // Stands above the land: a blast takes it away.
  standing?: boolean;
  def?: WonderDef;
}

// What placing needs to know about the island.
interface Ctx {
  world: World;
  biomes: readonly Biome[];
  peak: number;
  homes: Uint8Array;
  sea: Uint8Array;
  taken: { x: number; y: number; r: number }[];
}

function biomeOf(ctx: Ctx, i: number): Biome {
  const w = ctx.world;
  return w.biomeMap ? ctx.biomes[w.biomeMap[i]] : (w.land?.biome ?? "temperate");
}

const dryAt = (w: World, i: number) => w.depth[i] === 0 && w.fluid[i] === F.NONE;
const open = (w: World, i: number) => dryAt(w, i) && (w.cover[i] === C.NONE || w.cover[i] === C.BUSH || w.cover[i] === C.FLOWER || w.cover[i] === C.BOULDER);

// How far a spot is from the island's edge, villages and other wonders.
function free(ctx: Ctx, x: number, y: number, r: number, fromHomes: number): boolean {
  const { world } = ctx;
  const edge = Math.max(8, r + 4);
  if (x < edge || y < edge || x >= world.w - edge || y >= world.h - edge) return false;
  const i = y * world.w + x;
  if (ctx.homes[i] < fromHomes) return false;
  const apart = Math.max(26, world.w / 5.5);
  return ctx.taken.every((t) => Math.hypot(t.x - x, t.y - y) > Math.max(apart, t.r + r + 8));
}

// Sum of height differences over a box: low is flat.
function rough(world: World, x: number, y: number, r: number): number {
  const i0 = y * world.w + x;
  let s = 0;
  for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) s += Math.abs(world.height[(y + dy) * world.w + x + dx] - world.height[i0]);
  return s;
}

function count(world: World, x: number, y: number, r: number, test: (i: number) => boolean, step = 1): number {
  let n = 0;
  for (let dy = -r; dy <= r; dy += step)
    for (let dx = -r; dx <= r; dx += step) {
      const nx = x + dx;
      const ny = y + dy;
      if (world.inside(nx, ny) && test(ny * world.w + nx)) n++;
    }
  return n;
}

// Samples spots, keeps the best by `score` (higher is better, null skips).
function best(
  ctx: Ctx,
  rng: Rng,
  tries: number,
  r: number,
  fromHomes: number,
  lands: readonly Biome[] | "any",
  score: (x: number, y: number, i: number) => number | null,
) {
  const { world } = ctx;
  let out: { x: number; y: number; s: number } | null = null;
  for (let t = 0; t < tries; t++) {
    const x = rng.int(4, world.w - 5);
    const y = rng.int(4, world.h - 5);
    const i = y * world.w + x;
    if (lands !== "any" && !lands.includes(biomeOf(ctx, i))) continue;
    if (!free(ctx, x, y, r, fromHomes)) continue;
    const s = score(x, y, i);
    if (s === null) continue;
    if (!out || s > out.s) out = { x, y, s };
  }
  return out;
}

// The steepest drop next to a cell: where it falls to, two cells out.
function drop(world: World, x: number, y: number): { dx: number; dy: number; d: number } {
  let bestD = { dx: 0, dy: 0, d: 0 };
  for (const [dx, dy] of N8) {
    const nx = x + dx * 3;
    const ny = y + dy * 3;
    if (!world.inside(nx, ny)) continue;
    const d = world.height[y * world.w + x] - world.height[ny * world.w + nx];
    if (d > bestD.d) bestD = { dx, dy, d };
  }
  return bestD;
}

const N8: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

function disc(world: World, cx: number, cy: number, r: number, f: (i: number, d: number) => void): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (!world.inside(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r) f(y * world.w + x, d / r);
    }
}

function clearCover(world: World, i: number): void {
  if (world.cover[i] !== C.HOUSE) world.setCover(i, C.NONE);
}

// A waterfall's or a frozen fall's bed: a basin at the top kept full by a
// spring, a channel down the drop, a plunge pool at the foot.
function carveFall(world: World, w: Wonder, frozen: boolean): void {
  const W = world.w;
  const top = Math.round(w.ay) * W + Math.round(w.ax);
  const foot = Math.round(w.y) * W + Math.round(w.x);
  const hTop = world.height[top];
  const hFoot = world.height[foot] - 1.2;
  disc(world, w.ax, w.ay, 1.6, (i) => {
    world.height[i] = Math.min(world.height[i], hTop - 0.4);
    clearCover(world, i);
  });
  const steps = Math.ceil(Math.hypot(w.x - w.ax, w.y - w.ay) * 2);
  for (let s = 0; s <= steps; s++) {
    const f = s / steps;
    const x = Math.round(w.ax + (w.x - w.ax) * f);
    const y = Math.round(w.ay + (w.y - w.ay) * f);
    const i = y * W + x;
    world.height[i] = Math.min(world.height[i], hTop - 0.4 - (hTop - hFoot) * f);
    world.ground[i] = G.ROCK;
    clearCover(world, i);
  }
  disc(world, w.x, w.y, 2.4, (i, d) => {
    world.height[i] = Math.min(world.height[i], hFoot - 0.6 * (1 - d));
    world.ground[i] = d > 0.7 ? G.ROCK : G.SAND;
    clearCover(world, i);
    if (frozen) world.setFluid(i, F.ICE, Math.max(0.3, world.height[foot] + 1.2 - world.height[i]));
  });
  if (frozen) {
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const i = Math.round(w.ay + (w.y - w.ay) * f) * W + Math.round(w.ax + (w.x - w.ax) * f);
      world.setFluid(i, F.ICE, 0.4);
    }
  } else world.springs.push({ i: top, level: hTop + 0.2, rate: 1.6 });
}

// --- The catalog -----------------------------------------------------------

export const WONDERS: Kind[] = [
  {
    kind: "waterfall",
    rarity: "common",
    label: "a waterfall",
    does: "its mist keeps fire away and the land around it green",
    lands: ["temperate", "jungle", "swamp", "volcanic", "mesa", "desert"],
    find: (ctx, rng, lands) => {
      const { world } = ctx;
      const b = best(ctx, rng, 500, 6, 10, lands, (x, y, i) => {
        if (!dryAt(world, i) || world.height[i] < world.seaLevel + 5) return null;
        const d = drop(world, x, y);
        return d.d >= 3.2 ? d.d : null;
      });
      if (!b) return null;
      const d = drop(world, b.x, b.y);
      return { x: b.x + d.dx * 3, y: b.y + d.dy * 3, ax: b.x, ay: b.y, r: 6 };
    },
    shape: (world, w) => carveFall(world, w, false),
  },
  {
    kind: "hot spring",
    rarity: "common",
    label: "a hot spring",
    does: "it melts the snow around it and heals whoever bathes in it",
    lands: "any",
    find: (ctx, rng) => {
      const { world } = ctx;
      const b = best(ctx, rng, 400, 5, 10, "any", (x, y, i) => {
        if (!open(world, i) || world.height[i] < world.seaLevel + 2) return null;
        const r = rough(world, x, y, 4);
        if (r > 10) return null;
        // Liked best where it is cold or volcanic.
        const k = biomeOf(ctx, i);
        return (k === "tundra" || k === "volcanic" ? 20 : 0) - r;
      });
      return b ? { x: b.x, y: b.y, r: 7 } : null;
    },
    shape: (world, w) => {
      const base = world.height[Math.round(w.y) * world.w + Math.round(w.x)];
      disc(world, w.x, w.y, 3.4, (i, d) => {
        clearCover(world, i);
        if (d < 0.65) {
          world.height[i] = base - 0.7;
          world.ground[i] = G.SAND;
          world.setFluid(i, F.WATER, 0.6);
          world.temp[i] = 45;
        } else {
          world.height[i] = base - 0.1;
          world.ground[i] = G.ROCK;
        }
      });
      world.springs.push({ i: Math.round(w.y) * world.w + Math.round(w.x), level: base - 0.1, rate: 0.8 });
    },
  },
  {
    kind: "cave mouth",
    rarity: "common",
    label: "a cave mouth",
    does: "animals shelter in it from fire and the night, and come out healed",
    lands: "any",
    find: (ctx, rng) => {
      const { world } = ctx;
      // At the foot of a steep rise: the cave opens into the hill.
      const b = best(ctx, rng, 500, 4, 10, "any", (x, y, i) => {
        if (!open(world, i) || world.height[i] < world.seaLevel + 1.5) return null;
        let up = 0;
        let ax = 0;
        let ay = 0;
        for (const [dx, dy] of N8) {
          const j = (y + dy * 2) * world.w + x + dx * 2;
          const d = world.height[j] - world.height[i];
          if (d > up) [up, ax, ay] = [d, dx, dy];
        }
        if (up < 3) return null;
        return up + (ax || ay ? 0 : -99);
      });
      if (!b) return null;
      let ax = 0;
      let ay = 0;
      let up = 0;
      for (const [dx, dy] of N8) {
        const d = world.height[(b.y + dy * 2) * world.w + b.x + dx * 2] - world.height[b.y * world.w + b.x];
        if (d > up) [up, ax, ay] = [d, dx, dy];
      }
      return { x: b.x, y: b.y, ax, ay, r: 4 };
    },
    shape: (world, w) => {
      const i = Math.round(w.y) * world.w + Math.round(w.x);
      disc(world, w.x, w.y, 1.5, (j) => clearCover(world, j));
      world.ground[i] = G.DIRT;
    },
    standing: true,
  },
  {
    kind: "stone arch",
    rarity: "common",
    label: "a stone arch",
    does: "the wind sings through it, and whoever comes near it forgets their fear",
    lands: ["desert", "mesa", "temperate", "volcanic", "tundra", "swamp"],
    find: (ctx, rng, lands) => {
      const { world } = ctx;
      const b = best(ctx, rng, 400, 6, 12, lands, (x, y, i) => {
        if (!open(world, i) || world.height[i] < world.seaLevel + 1) return null;
        const r = rough(world, x, y, 4);
        if (r > 14) return null;
        const rocky = count(world, x, y, 6, (j) => world.ground[j] === G.ROCK || world.ground[j] === G.SAND, 2);
        return rocky - r * 0.5;
      });
      return b ? { x: b.x, y: b.y, ax: Math.cos(seedRoll(world.seed, 7101) * Math.PI), ay: Math.sin(seedRoll(world.seed, 7101) * Math.PI), r: 5 } : null;
    },
    shape: (world, w) => {
      for (const s of [-1, 1]) {
        const lx = Math.round(w.x + w.ax * 3.5 * s);
        const ly = Math.round(w.y + w.ay * 3.5 * s);
        disc(world, lx, ly, 0.8, (i) => world.setCover(i, C.WONDER));
      }
      disc(world, w.x, w.y, 2.2, (i) => {
        if (world.cover[i] !== C.WONDER) clearCover(world, i);
      });
    },
    standing: true,
  },
  {
    kind: "lone tree",
    rarity: "common",
    label: "a lone tree on a hill",
    does: "birds come to it, people rest under it, and it seeds the land around",
    lands: ["temperate", "tundra", "jungle", "mesa", "swamp", "volcanic"],
    find: (ctx, rng, lands) => {
      const { world } = ctx;
      const b = best(ctx, rng, 500, 4, 10, lands, (x, y, i) => {
        if (!open(world, i) || world.ground[i] !== G.GRASS) return null;
        const trees = count(world, x, y, 5, (j) => world.cover[j] === C.TREE, 1);
        if (trees > 4) return null;
        return world.height[i] - trees;
      });
      return b ? { x: b.x, y: b.y, r: 6 } : null;
    },
    shape: (world, w) => {
      disc(world, w.x, w.y, 2.5, (i) => {
        clearCover(world, i);
        if (world.ground[i] !== G.ROCK) world.ground[i] = G.GRASS;
      });
      world.setCover(Math.round(w.y) * world.w + Math.round(w.x), C.WONDER);
    },
    standing: true,
  },
  {
    kind: "ruins",
    rarity: "uncommon",
    label: "the ruins of an old village",
    does: "explorers find old coins in them, and monsters are drawn to them",
    lands: "any",
    find: (ctx, rng) => {
      const { world } = ctx;
      const b = best(ctx, rng, 500, 8, 16, "any", (x, y, i) => {
        if (!open(world, i) || world.height[i] < world.seaLevel + 1.5) return null;
        const r = rough(world, x, y, 6);
        if (r > 22) return null;
        const wet = count(world, x, y, 6, (j) => !dryAt(world, j), 2);
        return wet ? null : -r;
      });
      return b ? { x: b.x, y: b.y, r: 8 } : null;
    },
    shape: (world, w, _ctx, rng) => {
      const W = world.w;
      disc(world, w.x, w.y, 2, (i) => {
        clearCover(world, i);
        world.ground[i] = G.PATH;
      });
      for (const h of ruinHouses(w)) {
        for (let y = h.y; y < h.y + 2; y++)
          for (let x = h.x; x < h.x + 2; x++) {
            const i = y * W + x;
            if (!world.inside(x, y) || !dryAt(world, i)) continue;
            world.ground[i] = G.DIRT;
            world.setCover(i, rng.next() < 0.75 ? C.RUBBLE : C.NONE);
          }
      }
    },
    standing: true,
  },
  {
    kind: "sinkhole lake",
    rarity: "uncommon",
    label: "a sinkhole lake",
    does: "its deep water never freezes or runs dry, and fish live through any winter in it",
    lands: "any",
    find: (ctx, rng) => {
      const { world } = ctx;
      const b = best(ctx, rng, 400, 6, 12, "any", (x, y, i) => {
        if (!open(world, i) || world.height[i] < world.seaLevel + 3) return null;
        const r = rough(world, x, y, 5);
        return r > 16 ? null : -r;
      });
      return b ? { x: b.x, y: b.y, r: 5 } : null;
    },
    shape: (world, w) => {
      const base = world.height[Math.round(w.y) * world.w + Math.round(w.x)];
      disc(world, w.x, w.y, 6.2, (i, d) => {
        clearCover(world, i);
        if (d < 0.72) {
          world.height[i] = base - 5 - (1 - d) * 2;
          world.ground[i] = G.ROCK;
          world.setFluid(i, F.WATER, base - 0.8 - world.height[i]);
        } else {
          world.height[i] = Math.min(world.height[i], base);
          world.ground[i] = G.ROCK;
        }
      });
      world.springs.push({ i: Math.round(w.y) * world.w + Math.round(w.x), level: base - 0.8, rate: 1.2 });
    },
  },
  {
    kind: "geysers",
    rarity: "uncommon",
    label: "geysers",
    does: "every half minute they throw up a column of water and whoever stands on them",
    lands: ["volcanic", "tundra", "temperate", "mesa", "desert"],
    find: (ctx, rng, lands) => {
      const { world } = ctx;
      const b = best(ctx, rng, 400, 5, 12, lands, (x, y, i) => {
        if (!open(world, i)) return null;
        const r = rough(world, x, y, 4);
        if (r > 12) return null;
        const k = biomeOf(ctx, i);
        return (k === "volcanic" || k === "tundra" ? 12 : 0) - r;
      });
      return b ? { x: b.x, y: b.y, r: 5 } : null;
    },
    shape: (world, w) => {
      disc(world, w.x, w.y, 4.5, (i, d) => {
        clearCover(world, i);
        world.ground[i] = d < 0.8 ? G.ROCK : world.ground[i];
      });
      for (const v of vents(w)) {
        const i = Math.round(v.y) * world.w + Math.round(v.x);
        world.ground[i] = G.BASALT;
        world.height[i] += 0.4;
      }
      w.t = 6;
    },
  },
  {
    kind: "sea stacks",
    rarity: "uncommon",
    label: "sea stacks",
    does: "seabirds nest on them, out of every hunter's reach",
    lands: "any",
    find: (ctx, rng) => {
      const { world } = ctx;
      // In the sea, a few cells off a coast.
      let out: { x: number; y: number; s: number } | null = null;
      for (let t = 0; t < 600; t++) {
        const x = rng.int(6, world.w - 7);
        const y = rng.int(6, world.h - 7);
        const i = y * world.w + x;
        if (!isSea(world, i) || world.depth[i] < 1 || ctx.sea[i] !== 0) continue;
        if (!ctx.taken.every((t) => Math.hypot(t.x - x, t.y - y) > 26)) continue;
        // Land nearby, but not too close.
        let land = 99;
        for (let r = 2; r <= 9 && land === 99; r++) if (count(world, x, y, r, (j) => dryAt(world, j), 2) > 0) land = r;
        if (land < 3 || land > 8) continue;
        const s = -Math.abs(land - 5) + rng.next();
        if (!out || s > out.s) out = { x, y, s };
      }
      return out ? { x: out.x, y: out.y, r: 5 } : null;
    },
    shape: (world, w, _ctx, rng) => {
      const n = rng.int(3, 6);
      for (let k = 0; k < n; k++) {
        const a = rng.range(0, Math.PI * 2);
        const d = k === 0 ? 0 : rng.range(1.8, 4.5);
        const cx = w.x + Math.cos(a) * d;
        const cy = w.y + Math.sin(a) * d;
        const top = world.seaLevel + rng.range(5, 11) * (k === 0 ? 1.2 : 1);
        disc(world, cx, cy, k === 0 ? 1.3 : rng.range(0.6, 1.1), (i, f) => {
          world.height[i] = Math.max(world.height[i], top - f * 1.5);
          world.ground[i] = G.ROCK;
          world.setFluid(i, F.NONE, 0);
          world.setCover(i, C.NONE);
        });
      }
    },
  },
  {
    kind: "crater",
    rarity: "uncommon",
    label: "a meteor crater",
    does: "the strange ore in it draws miners, and it glows at night",
    lands: "any",
    find: (ctx, rng) => {
      const { world } = ctx;
      const b = best(ctx, rng, 500, 8, 14, "any", (x, y, i) => {
        if (!open(world, i) || world.height[i] < world.seaLevel + 2.5) return null;
        const r = rough(world, x, y, 6);
        if (r > 26) return null;
        const wet = count(world, x, y, 7, (j) => !dryAt(world, j), 2);
        return wet ? null : -r;
      });
      return b ? { x: b.x, y: b.y, r: 7 } : null;
    },
    shape: (world, w, _ctx, rng) => {
      const base = world.height[Math.round(w.y) * world.w + Math.round(w.x)];
      const R = 6.5;
      disc(world, w.x, w.y, R + 2.5, (i, d) => {
        const dd = d * (R + 2.5);
        clearCover(world, i);
        if (dd < R) {
          world.height[i] = base - 2.4 * (1 - (dd / R) ** 2) + 0.3;
          world.ground[i] = dd < R * 0.7 ? G.BASALT : G.ASH;
        } else {
          world.height[i] = Math.max(world.height[i], base + 1.3 * (1 - (dd - R) / 2.5));
          world.ground[i] = G.ROCK;
        }
      });
      for (let k = 0; k < 18; k++) {
        const a = rng.range(0, Math.PI * 2);
        const d = Math.sqrt(rng.next()) * R * 0.7;
        const i = Math.round(w.y + Math.sin(a) * d) * world.w + Math.round(w.x + Math.cos(a) * d);
        world.setCover(i, C.ORE);
      }
      w.state = 18;
    },
  },
  {
    kind: "floating rock",
    rarity: "rare",
    label: "a floating rock",
    does: "it drifts over the island, and the moss under it rains: fires go out and the land greens where it passes",
    lands: "any",
    find: (ctx, rng) => {
      const { world } = ctx;
      const b = best(ctx, rng, 300, 14, 6, "any", (_x, _y, i) => (dryAt(world, i) ? world.height[i] : null));
      return b ? { x: b.x, y: b.y, r: 14 } : null;
    },
    standing: true,
  },
  {
    kind: "bones",
    rarity: "rare",
    label: "giant bones half buried",
    does: "on a full moon the dead rise from them",
    lands: ["desert", "mesa", "tundra", "temperate", "volcanic"],
    find: (ctx, rng, lands) => {
      const { world } = ctx;
      const b = best(ctx, rng, 400, 7, 18, lands, (x, y, i) => {
        if (!open(world, i)) return null;
        const r = rough(world, x, y, 5);
        return r > 16 ? null : -r;
      });
      return b
        ? { x: b.x, y: b.y, ax: Math.cos(seedRoll(world.seed, 7111) * Math.PI * 2), ay: Math.sin(seedRoll(world.seed, 7111) * Math.PI * 2), r: 7 }
        : null;
    },
    shape: (world, w) => {
      const sandy = (world.land?.biome ?? "desert") !== "tundra";
      disc(world, w.x, w.y, 5, (i) => {
        clearCover(world, i);
        if (world.ground[i] === G.GRASS) world.ground[i] = sandy ? G.SAND : G.DIRT;
      });
      // The skull is solid.
      const sx = Math.round(w.x + w.ax * 4);
      const sy = Math.round(w.y + w.ay * 4);
      disc(world, sx, sy, 1, (i) => world.setCover(i, C.WONDER));
      w.state = -1;
    },
    standing: true,
  },
  {
    kind: "frozen waterfall",
    rarity: "rare",
    label: "a frozen waterfall",
    does: "it keeps the cold around it; heat it and it runs again",
    lands: ["tundra"],
    find: (ctx, rng) => {
      const { world } = ctx;
      const b = best(ctx, rng, 500, 6, 10, ["tundra"], (x, y, i) => {
        if (!dryAt(world, i) || world.height[i] < world.seaLevel + 4) return null;
        const d = drop(world, x, y);
        return d.d >= 3 ? d.d : null;
      });
      if (!b) return null;
      const d = drop(world, b.x, b.y);
      // Its foot frozen too, in the same cold land.
      if (biomeOf(ctx, (b.y + d.dy * 3) * world.w + b.x + d.dx * 3) !== "tundra") return null;
      return { x: b.x + d.dx * 3, y: b.y + d.dy * 3, ax: b.x, ay: b.y, r: 6 };
    },
    shape: (world, w) => carveFall(world, w, true),
  },
  {
    kind: "fairy ring",
    rarity: "rare",
    label: "a fairy ring",
    does: "it hums at night, and creatures near it dance till dawn",
    lands: ["temperate", "jungle", "swamp", "tundra"],
    find: (ctx, rng, lands) => {
      const { world } = ctx;
      const b = best(ctx, rng, 600, 5, 10, lands, (x, y, i) => {
        if (!open(world, i) || world.ground[i] !== G.GRASS) return null;
        const trees = count(world, x, y, 7, (j) => world.cover[j] === C.TREE, 1);
        const near = count(world, x, y, 2, (j) => world.cover[j] === C.TREE, 1);
        return trees > 20 && near < 3 ? trees : null;
      });
      return b ? { x: b.x, y: b.y, r: 9 } : null;
    },
    shape: (world, w) => {
      disc(world, w.x, w.y, 3.4, (i) => {
        clearCover(world, i);
        if (world.ground[i] !== G.ROCK) world.ground[i] = G.GRASS;
      });
    },
  },
  {
    kind: "world tree",
    rarity: "legendary",
    label: "a world tree",
    does: "it heals all around it, keeps monsters away and grows the forest back",
    lands: ["temperate", "jungle", "swamp", "tundra", "volcanic"],
    find: (ctx, rng, lands) => {
      const { world } = ctx;
      const b = best(ctx, rng, 500, 10, 20, lands, (x, y, i) => {
        if (!open(world, i) && world.cover[i] !== C.TREE) return null;
        if (world.height[i] < world.seaLevel + 2) return null;
        const r = rough(world, x, y, 6);
        if (r > 28) return null;
        const wet = count(world, x, y, 5, (j) => !dryAt(world, j), 2);
        return wet ? null : count(world, x, y, 10, (j) => world.cover[j] === C.TREE, 2) - r * 0.5;
      });
      return b ? { x: b.x, y: b.y, r: 12 } : null;
    },
    shape: (world, w) => {
      const base = world.height[Math.round(w.y) * world.w + Math.round(w.x)];
      disc(world, w.x, w.y, 4.5, (i, d) => {
        clearCover(world, i);
        world.height[i] = base + (world.height[i] - base) * 0.3 + (1 - d) * 0.6;
        if (world.ground[i] !== G.ROCK) world.ground[i] = G.GRASS;
      });
      disc(world, w.x, w.y, 1.5, (i) => world.setCover(i, C.WONDER));
    },
    standing: true,
  },
  {
    kind: "hoard",
    rarity: "legendary",
    label: "a sleeping dragon's hoard",
    does: "its gold draws thieves, and the dragon wakes when anyone takes some",
    lands: ["volcanic", "mesa", "desert", "tundra", "temperate"],
    find: (ctx, rng, lands) => {
      const { world } = ctx;
      const b = best(ctx, rng, 500, 6, 32, lands, (x, y, i) => {
        if (!open(world, i)) return null;
        const r = rough(world, x, y, 4);
        if (r > 20) return null;
        return world.height[i] - r * 0.3;
      });
      return b ? { x: b.x, y: b.y, r: 6 } : null;
    },
    shape: (world, w, _ctx, rng) => {
      const base = world.height[Math.round(w.y) * world.w + Math.round(w.x)];
      disc(world, w.x, w.y, 5, (i, d) => {
        clearCover(world, i);
        world.height[i] = base + (world.height[i] - base) * 0.2 - (1 - d) * 0.8;
        world.ground[i] = d < 0.8 ? G.BASALT : G.ROCK;
      });
      for (let k = 0; k < 16; k++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(1.5, 4);
        world.setCover(Math.round(w.y + Math.sin(a) * d) * world.w + Math.round(w.x + Math.cos(a) * d), C.HOARD);
      }
      world.setCover(Math.round(w.y) * world.w + Math.round(w.x), C.WONDER);
      w.state = 0;
    },
    standing: true,
  },
  {
    kind: "sunken temple",
    rarity: "legendary",
    label: "a sunken temple",
    does: "its runes glow under the sea at night, fish gather in it, and fishers bring up relics",
    lands: ["temperate", "jungle", "swamp", "desert", "mesa", "volcanic"],
    find: (ctx, rng, lands) => {
      const { world } = ctx;
      let out: { x: number; y: number; s: number } | null = null;
      for (let t = 0; t < 700; t++) {
        const x = rng.int(8, world.w - 9);
        const y = rng.int(8, world.h - 9);
        const i = y * world.w + x;
        if (!isSea(world, i) || world.depth[i] < 0.7 || world.depth[i] > 3) continue;
        if (lands !== "any" && !lands.includes(biomeOf(ctx, i))) continue;
        if (!ctx.taken.every((t) => Math.hypot(t.x - x, t.y - y) > 26)) continue;
        const wet = count(world, x, y, 4, (j) => isSea(world, j), 2);
        if (wet < 22) continue;
        const land = count(world, x, y, 8, (j) => dryAt(world, j), 2);
        if (!land) continue;
        const s = land + rng.next();
        if (!out || s < out.s) out = { x, y, s };
      }
      return out ? { x: out.x, y: out.y, r: 6 } : null;
    },
    shape: (world, w) => {
      disc(world, w.x, w.y, 4.5, (i) => {
        if (!isSea(world, i)) return;
        world.height[i] = Math.min(world.height[i], world.seaLevel - 1.4);
        world.ground[i] = G.SAND;
        world.setFluid(i, F.WATER, world.seaLevel - world.height[i]);
        world.setCover(i, C.NONE);
      });
    },
    standing: true,
  },
];

export const WONDER_KINDS = new Map(WONDERS.map((k) => [k.kind, k]));

// --- Wonders written as programs (4.4.5 part C) ---------------------------

// The best spot of a kind of place, the way the built-in finders do it.
function findSpot(ctx: Ctx, rng: Rng, lands: readonly Biome[] | "any", spot: Spot, r: number) {
  const { world } = ctx;
  const sea = world.seaLevel;
  const dryOpen = (i: number) => open(world, i) && world.height[i] > sea + 1;
  const score = (x: number, y: number, i: number): number | null => {
    switch (spot) {
      case "high":
        return dryOpen(i) && rough(world, x, y, 3) < 30 ? world.height[i] : null;
      case "slope": {
        if (!dryOpen(i)) return null;
        const ro = rough(world, x, y, 4);
        return ro > 8 && ro < 40 ? -Math.abs(ro - 18) : null;
      }
      case "flat":
        return dryOpen(i) ? -rough(world, x, y, Math.min(6, r)) : null;
      case "low":
        return dryOpen(i) && rough(world, x, y, 4) < 24 ? -world.height[i] : null;
      case "drop": {
        if (!dryAt(world, i) || world.height[i] < sea + 4) return null;
        const d = drop(world, x, y);
        return d.d >= 3 ? d.d : null;
      }
      case "forest": {
        if (!dryAt(world, i)) return null;
        const trees = count(world, x, y, Math.min(7, r), (j) => world.cover[j] === C.TREE, 2);
        return trees > 6 ? trees : null;
      }
      case "shore": {
        if (!dryOpen(i)) return null;
        const d = ctx.sea[i];
        return d >= 2 && d <= 5 ? -Math.abs(d - 3) - rough(world, x, y, 2) * 0.1 : null;
      }
      case "sea": {
        if (!isSea(world, i) || world.depth[i] > 4) return null;
        const land = count(world, x, y, r + 3, (j) => dryAt(world, j), 2);
        return land > 2 ? -world.depth[i] - Math.abs(land - 12) * 0.2 : null;
      }
      case "water": {
        const fresh = count(world, x, y, Math.max(3, r - 2), (j) => world.depth[j] > 0.1 && !isSea(world, j), 1);
        return fresh > 4 && !isSea(world, i) ? fresh : null;
      }
    }
  };
  // Water and the sea are near villages more often: closer is allowed there.
  const fromHomes = spot === "sea" || spot === "water" || spot === "shore" ? 6 : 10;
  const b = best(ctx, rng, 700, r, fromHomes, lands, score);
  return b ? { x: b.x, y: b.y, r } : null;
}

export function defKind(def: WonderDef): Kind {
  return {
    kind: def.kind,
    rarity: def.rarity,
    label: def.kind,
    does: def.does,
    lands: def.lands.length ? def.lands : "any",
    find: (ctx, rng, lands) => findSpot(ctx, rng, lands, def.spot, def.reach),
    def,
  };
}

// The kind of an island's wonder: built in, or the program it carries.
function kindOf(w: Wonder): Kind | undefined {
  return w.def ? defKind(w.def) : WONDER_KINDS.get(w.kind);
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

// A wonder definition from the server or a save, checked.
export function readDef(v: unknown): WonderDef | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const kind = clip(o.kind, 40).toLowerCase();
  const code = typeof o.code === "string" ? o.code.slice(0, 40000) : "";
  const rarity = RARITIES.includes(o.rarity as Rarity) ? (o.rarity as Rarity) : null;
  const spot = SPOTS.includes(o.spot as Spot) ? (o.spot as Spot) : null;
  const id = typeof o.id === "number" && Number.isInteger(o.id) ? o.id : null;
  if (!kind || !code || !rarity || !spot || id === null || WONDER_KINDS.has(kind)) return null;
  const lands = (Array.isArray(o.lands) ? o.lands : []).filter((b): b is Biome => (BIOMES as readonly string[]).includes(b as string)).slice(0, 7);
  const reach = typeof o.reach === "number" && Number.isFinite(o.reach) ? Math.max(3, Math.min(14, Math.round(o.reach))) : 6;
  const by = clip(o.by, 40);
  return { id, kind, rarity, lands, spot, reach, does: clip(o.does, 120), code, source: o.source === "player" ? "player" : "daily", ...(by ? { by } : {}) };
}

// What a program wonder is cast as: its tier only says how strong its
// effects may be (a library spell it casts, a summon); w.r is its reach.
export const DEF_TIER = { common: "minor", uncommon: "major", rare: "grand", legendary: "grand" } as const;

export function defRequest(def: WonderDef) {
  return { key: `wonder:${def.id}`, name: def.kind, tier: DEF_TIER[def.rarity], code: def.code, kind: "artifact" as const, reach: def.reach };
}

// The old houses of a ruin, from its seed: the simulation lays their rubble,
// the view raises their broken walls on the same spots.
export function ruinHouses(w: Wonder): { x: number; y: number }[] {
  const rng = new Rng(w.seed + 3);
  const n = rng.int(4, 6);
  return Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const d = rng.range(4, 6.5);
    return { x: Math.round(w.x + Math.cos(a) * d), y: Math.round(w.y + Math.sin(a) * d) };
  });
}

// The vents of a geyser field, from its seed.
export function vents(w: Wonder): { x: number; y: number }[] {
  const rng = new Rng(w.seed + 11);
  const n = 3 + (w.seed % 2);
  return Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const d = k === 0 ? 0 : rng.range(2, 3.5);
    return { x: Math.round(w.x + Math.cos(a) * d), y: Math.round(w.y + Math.sin(a) * d) };
  });
}

// Where the floating rock is now: a slow loop over the island, a turn in
// about four minutes, and a gentle bob.
export function floatAt(world: World, w: Wonder, time: number): { x: number; y: number; z: number } {
  const loop = Math.min(w.r * 1.6, world.w * 0.22);
  const a = time * ((Math.PI * 2) / 240) + (w.seed % 628) / 100;
  const x = Math.max(8, Math.min(world.w - 9, w.x + Math.cos(a) * loop));
  const y = Math.max(8, Math.min(world.h - 9, w.y + Math.sin(a) * loop * 0.7));
  return { x, y, z: 10 + Math.sin(time * 0.5) * 0.6 };
}

// The set's signature: its kinds in order, for the page's last ten islands.
export function signatureOf(kinds: readonly string[]): string {
  return [...kinds].sort().join("+");
}

const WEIGHTS: Record<Rarity, number> = { common: 55, uncommon: 30, rare: 12, legendary: 3 };
const FIRST_WEIGHTS: Record<Rarity, number> = { common: 0, uncommon: 70, rare: 24, legendary: 6 };

// Places an island's wonders. `recent` are the signatures of the player's
// last islands; a set that matches one is drawn again (a few dozen tries,
// then the least seen wins). Returns the wonders in the order the first
// look shows them.
export function placeWonders(world: World, biomes: readonly Biome[], peak: number, recent: readonly string[] = [], defs: readonly WonderDef[] = []): void {
  const homes = distanceTo(world, 40, (i) => world.cover[i] === C.HOUSE || world.ground[i] === G.FIELD);
  const sea = distanceTo(world, 10, (i) => isSea(world, i));
  const present = new Set<Biome>();
  for (let i = 0; i < world.n; i += 7) present.add(world.biomeMap ? biomes[world.biomeMap[i]] : (world.land?.biome ?? "temperate"));
  // 4.4.5 part C: the pool of wonders written as programs joins the built-in ones.
  const kinds = defs.length ? [...WONDERS, ...defs.map(defKind)] : WONDERS;
  const allowed = kinds.filter((k) => k.lands === "any" || k.lands.some((b) => present.has(b)));
  const seen = new Set(recent);
  let chosen: { k: Kind; at: NonNullable<ReturnType<Kind["find"]>> }[] = [];
  let fallback: typeof chosen = [];
  for (let attempt = 0; attempt < 24; attempt++) {
    const rng = new Rng((world.seed ^ 0x5717) + 7001 + attempt * 104729);
    const ctx: Ctx = { world, biomes, peak, homes, sea, taken: [] };
    const want = 2 + Math.floor(rng.next() * (world.w >= 200 ? 2.6 : 2.99));
    const out: typeof chosen = [];
    const pool = [...allowed];
    let fails = 0;
    while (out.length < want && pool.length && fails < 12) {
      const weights = out.length === 0 ? FIRST_WEIGHTS : WEIGHTS;
      const total = pool.reduce((s, k) => s + weights[k.rarity], 0);
      if (total <= 0) break;
      let r = rng.next() * total;
      let k = pool[0];
      for (const p of pool) {
        r -= weights[p.rarity];
        if (r <= 0) {
          k = p;
          break;
        }
      }
      pool.splice(pool.indexOf(k), 1);
      const at = k.find(ctx, rng, k.lands);
      if (!at) {
        fails++;
        continue;
      }
      ctx.taken.push(at);
      out.push({ k, at });
    }
    // At least one uncommon or better, and two at the least.
    if (out.length > fallback.length) fallback = out;
    if (out.length < 2 || !out.some((o) => o.k.rarity !== "common")) continue;
    chosen = out;
    if (!seen.has(signatureOf(out.map((o) => o.k.kind)))) break;
  }
  if (!chosen.length) chosen = fallback;
  const biomeAtCell = (x: number, y: number) => {
    const i = Math.round(y) * world.w + Math.round(x);
    return world.biomeMap ? biomes[world.biomeMap[i]] : (world.land?.biome ?? "temperate");
  };
  world.wonders = chosen.map(({ k, at }, n) => ({
    kind: k.kind,
    x: at.x,
    y: at.y,
    r: at.r,
    seed: (Math.imul(world.seed, 31) + n * 7919 + k.kind.length * 131) >>> 0,
    name: k.def?.source === "player" ? k.def.kind.replace(/\b\w/g, (c) => c.toUpperCase()) : wonderName(k.kind, world.seed + n * 101, biomeAtCell(at.x, at.y)),
    t: 0,
    state: 0,
    ax: at.ax ?? 0,
    ay: at.ay ?? 0,
    ...(k.def ? { def: k.def } : {}),
  }));
  for (const w of world.wonders) {
    const k = kindOf(w)!;
    k.shape?.(world, w, { world, biomes, peak, homes, sea, taken: [] }, new Rng(w.seed));
  }
  // The island's own name, from the land most of it is.
  const counts = new Map<Biome, number>();
  for (let i = 0; i < world.n; i += 5) {
    const b = world.biomeMap ? biomes[world.biomeMap[i]] : (world.land?.biome ?? "temperate");
    if (world.depth[i] === 0) counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const main = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "temperate";
  world.islandName = islandName(world.seed, main);
}

// One program wonder on an island already made, away from its wonders (the
// nightly test of a new wonder, wondercheck.ts). Null when the island has no
// spot for it.
export function placeOne(world: World, def: WonderDef, seed: number): Wonder | null {
  const homes = distanceTo(world, 40, (i) => world.cover[i] === C.HOUSE || world.ground[i] === G.FIELD);
  const sea = distanceTo(world, 10, (i) => isSea(world, i));
  const ctx: Ctx = { world, biomes: BIOMES, peak: 0, homes, sea, taken: world.wonders.map((w) => ({ x: w.x, y: w.y, r: w.r })) };
  const k = defKind(def);
  const at = k.find(ctx, new Rng(seed * 7 + 13), k.lands);
  if (!at) return null;
  const w: Wonder = { kind: def.kind, x: at.x, y: at.y, r: at.r, seed: seed >>> 0, name: def.kind, t: 0, state: 0, ax: 0, ay: 0, def };
  world.wonders.push(w);
  return w;
}

// 4.6: a built-in wonder raised where an item asks (a place, makers.ts), not
// where the generator would look: its land shaped, its model drawn, its life
// stepped as any other, saved with the island. Its usual reach; a fall's top
// is the highest cell three cells round, an arch's way from the seed. Null
// for an unknown kind, a spot off the island or an island already holding
// MAX_WONDERS.
export function placeWonderAt(world: World, kind: string, x: number, y: number, seed: number, biomes: readonly Biome[] = BIOMES): Wonder | null {
  const k = WONDER_KINDS.get(kind);
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (!k || world.wonders.length >= MAX_WONDERS || cx < 4 || cy < 4 || cx >= world.w - 4 || cy >= world.h - 4) return null;
  const r = REACH_OF[kind] ?? 6;
  let ax = 0;
  let ay = 0;
  if (kind === "waterfall" || kind === "frozen waterfall") {
    // The top: the highest cell three cells away, raised into a ledge if the land is flat.
    let top = { x: cx + 3, y: cy, h: -Infinity };
    for (const [dx, dy] of N8) {
      const tx = cx + dx * 3;
      const ty = cy + dy * 3;
      if (world.inside(tx, ty) && world.height[ty * world.w + tx] > top.h) top = { x: tx, y: ty, h: world.height[ty * world.w + tx] };
    }
    const foot = world.height[cy * world.w + cx];
    if (top.h - foot < 5) disc(world, top.x, top.y, 2.2, (i, d) => (world.height[i] = Math.max(world.height[i], foot + 6 * (1 - d * 0.5))));
    ax = top.x;
    ay = top.y;
  } else if (kind === "stone arch" || kind === "bones") {
    const a = seedRoll(seed, 7101) * Math.PI * 2;
    ax = Math.cos(a);
    ay = Math.sin(a);
  }
  const i = cy * world.w + cx;
  const biome = world.biomeMap ? biomes[world.biomeMap[i]] : (world.land?.biome ?? "temperate");
  const w: Wonder = { kind, x: cx, y: cy, r, seed: seed >>> 0, name: wonderName(kind, seed, biome), t: 0, state: 0, ax, ay };
  const homes = distanceTo(world, 40, (j) => world.cover[j] === C.HOUSE || world.ground[j] === G.FIELD);
  const sea = distanceTo(world, 10, (j) => isSea(world, j));
  k.shape?.(world, w, { world, biomes, peak: 0, homes, sea, taken: [] }, new Rng(w.seed));
  world.wonders.push(w);
  return w;
}

// The reach each built-in kind's own finder gives it.
const REACH_OF: Record<string, number> = {
  waterfall: 6,
  "hot spring": 7,
  "cave mouth": 4,
  "stone arch": 5,
  "lone tree": 6,
  ruins: 8,
  "sinkhole lake": 5,
  geysers: 5,
  "sea stacks": 5,
  crater: 7,
  "floating rock": 14,
  bones: 7,
  "frozen waterfall": 6,
  "fairy ring": 9,
  "world tree": 12,
  hoard: 6,
  "sunken temple": 6,
};

// After ecology.ts: what grows under and around a wonder.
export function settleWonders(world: World): void {
  for (const w of world.wonders) {
    const cx = Math.round(w.x);
    const cy = Math.round(w.y);
    switch (w.kind) {
      case "fairy ring":
      case "lone tree":
      case "world tree":
        // Its ground stays open, and around a world tree the forest grows.
        disc(world, cx, cy, w.kind === "world tree" ? 4.5 : 3.2, (i) => {
          if (world.cover[i] !== C.WONDER) clearCover(world, i);
        });
        if (w.kind === "world tree" && world.flora) disc(world, cx, cy, 18, (i) => (world.flora![i] |= WOODLAND | DAMP | HEART));
        break;
      case "stone arch":
      case "hoard":
      case "bones":
      case "ruins":
      case "crater":
        disc(world, cx, cy, w.kind === "crater" ? 6 : 2, (i) => {
          const c = world.cover[i];
          if (c === C.TREE || c === C.BUSH || c === C.FERN || c === C.BERRIES || c === C.REEDS || c === C.FLOWER) world.setCover(i, C.NONE);
        });
        break;
    }
  }
}

export interface WonderInfo {
  kind: string;
  name: string;
  label: string;
  does: string;
  rarity: Rarity;
  x: number;
  y: number;
  r: number;
  // Who found it first, for a player's discovery grown into the world (part C).
  by?: string;
}

// Who found each program wonder, from the pool the Worker serves now
// (4.5.1, audit B4): an island saves its wonders' defs, names included, and a
// finder who later deleted their account or hid from the Community tab was
// still named on every island made before. The live pool leaves them out
// (worker/wonders.ts, livePool), so the name is read from it, never from the save.
let finders = new Map<number, string>();

export function setFinders(pool: WonderDef[]): void {
  finders = new Map(pool.filter((d) => d.by).map((d) => [d.id, d.by!]));
}

export function wonderInfo(w: Wonder): WonderInfo {
  const k = kindOf(w);
  const by = w.def ? finders.get(w.def.id) : undefined;
  return {
    kind: w.kind,
    name: w.name,
    label: k?.label ?? w.kind,
    does: k?.does ?? "",
    rarity: k?.rarity ?? "common",
    x: w.x,
    y: w.y,
    r: w.r,
    ...(by ? { by } : {}),
  };
}

// --- What wonders do ---------------------------------------------------------

type Spawn = (kind: string, x: number, y: number) => Creature;

const STEP = 15;
const DT = STEP / 30;

// Twice a second, from lifeCycle (creatures.ts), with its random stream.
export interface WonderLife {
  kindOf: (c: Creature) => { native: boolean; ai?: { mode: string } };
  maxHp: (c: Creature) => number;
}

export function stepWonders(world: World, spawn: Spawn, life: WonderLife): void {
  if (!world.wonders.length || world.tick % STEP !== 5) return;
  const { kindOf } = life;
  const heal = (c: Creature, hp: number) => (c.hp = Math.min(life.maxHp(c), c.hp + hp));
  const day = daylight(world.time);
  for (const w of world.wonders) {
    w.t -= DT;
    if (w.def) {
      // Its program acts through what it placed; here only its creatures are kept to a few.
      if (w.own?.length) capOwn(world, w.own);
      continue;
    }
    switch (w.kind) {
      case "waterfall":
        mist(world, w.x, w.y, 6);
        break;
      case "hot spring":
        hotSpring(world, w, heal);
        break;
      case "cave mouth":
        shelter(world, w, kindOf, heal);
        break;
      case "stone arch":
        aura(world, w.x, w.y, 6, (c) => (c.fear = 0));
        visit(world, w, 50, "rested under the stone arch", 0);
        break;
      case "lone tree":
        seedTrees(world, w.x, w.y, 3, 9, 0.12);
        aura(world, w.x, w.y, 4, (c) => (c.fear = 0));
        if (Math.random() < 0.05) lure(world, w.x, w.y, 40, (c) => c.kind === "bird" || c.kind === "parrot");
        break;
      case "ruins":
        visit(world, w, 45, "found an old coin in the ruins", 3);
        if (Math.random() < 0.1) lure(world, w.x, w.y, 50, (c) => !kindOf(c).native && c.kind !== "villager" && kindOf(c).ai?.mode === "hunt");
        break;
      case "sinkhole lake":
        // Deep water does not freeze: in the cold it is where fish winter.
        disc(world, w.x, w.y, 4.4, (i) => {
          world.temp[i] = Math.max(world.temp[i], 4);
          if (world.fluid[i] === F.ICE) world.setFluid(i, F.WATER, world.depth[i]);
        });
        if (w.t <= 0) {
          w.t = 60;
          let fish = 0;
          for (const c of world.crowd.near(world, w.x, w.y, 5)) if (!c.dead && c.kind === "fish") fish++;
          if (fish < 3 && world.fluid[Math.round(w.y) * world.w + Math.round(w.x)] === F.WATER) spawn("fish", w.x + 0.5, w.y + 0.5);
        }
        break;
      case "geysers":
        geysers(world, w);
        break;
      case "sea stacks":
        if (w.t <= 0) {
          w.t = 40;
          let birds = 0;
          for (const c of world.crowd.near(world, w.x, w.y, 14)) if (!c.dead && kindOf(c).native && c.kind === "bird") birds++;
          // Seabirds nest here while the island still has birds' land to feed on.
          const bird = SPECIES.find((s) => s.kind.name === "bird");
          if (birds < 4 && world.creatures.length < 480 && bird && habitatCells(world, bird) >= 30) spawn("bird", w.x + 0.5, w.y + 0.5);
        }
        break;
      case "crater":
        mine(world, w);
        break;
      case "floating rock": {
        const p = floatAt(world, w, world.time);
        disc(world, p.x, p.y, 2.5, (i) => {
          world.fire[i] = 0;
          if (world.ground[i] === G.ASH || (world.ground[i] === G.DIRT && world.cover[i] === C.NONE && Math.random() < 0.3)) world.ground[i] = G.GRASS;
          else if (world.ground[i] === G.GRASS && world.cover[i] === C.NONE && dryAt(world, i) && Math.random() < 0.01) world.setCover(i, C.FLOWER);
        });
        break;
      }
      case "bones":
        if (fullMoon(world.time) && w.state !== dayOf(world.time) && world.creatures.length < 480) {
          w.state = dayOf(world.time);
          let risen = 0;
          for (const c of world.crowd.near(world, w.x, w.y, 20)) if (!c.dead && c.kind === "risen") risen++;
          for (let k = risen; k < 3; k++) spawn("risen", w.x + Math.cos(k * 2.1) * 2.5, w.y + Math.sin(k * 2.1) * 2.5);
          tell(world, `the dead rose from ${w.name} under the full moon`, { x: w.x, y: w.y });
        }
        break;
      case "frozen waterfall":
        frozenFall(world, w);
        break;
      case "fairy ring":
        if (day.night > 0.5) dance(world, w, kindOf);
        break;
      case "world tree":
        aura(world, w.x, w.y, 10, (c) => {
          if (kindOf(c).native || c.kind === "villager") {
            heal(c, 2);
            c.burning = 0;
          } else if (kindOf(c).ai?.mode === "hunt") {
            c.fear = Math.max(c.fear, 2);
            c.fearX = w.x;
            c.fearY = w.y;
          }
        });
        seedTrees(world, w.x, w.y, 5, 16, 0.3);
        break;
      case "hoard":
        hoard(world, w, spawn);
        break;
      case "sunken temple":
        if (w.t <= 0) {
          w.t = 50;
          let fish = 0;
          for (const c of world.crowd.near(world, w.x, w.y, 6)) if (!c.dead && c.kind === "fish") fish++;
          if (fish < 4) spawn("fish", w.x + 0.5, w.y + 0.5);
          // A fisher of the village nearest brings up a relic.
          for (const c of world.crowd.near(world, w.x, w.y, 16)) {
            if (c.dead || c.kind !== "villager" || c.mind?.task !== "fish") continue;
            const v = villageOf(world, c.homeX, c.homeY);
            if (v) v.gold += 3;
            deed(c, `brought up a relic from ${w.name}`);
            break;
          }
        }
        break;
    }
  }
}

// A program wonder's creatures past WONDER_CREATURES alive die, the newest first.
function capOwn(world: World, own: readonly string[]): void {
  let alive = 0;
  for (const c of world.creatures) {
    if (c.dead || !own.includes(c.kind)) continue;
    if (++alive > WONDER_CREATURES) c.hp = 0;
  }
}

function aura(world: World, x: number, y: number, r: number, f: (c: Creature) => void): void {
  for (const c of world.crowd.near(world, x, y, r)) if (!c.dead && Math.hypot(c.x - x, c.y - y) <= r) f(c);
}

function lure(world: World, x: number, y: number, r: number, who: (c: Creature) => boolean): void {
  for (const c of world.crowd.near(world, x, y, r)) {
    if (c.dead || !who(c) || Math.hypot(c.x - x, c.y - y) < 4) continue;
    sendTo(c, x + (Math.random() - 0.5) * 4, y + (Math.random() - 0.5) * 4);
    return;
  }
}

// Mist: no fire takes, ash greens.
function mist(world: World, x: number, y: number, r: number): void {
  disc(world, x, y, r, (i) => {
    world.fire[i] = 0;
    if (world.ground[i] === G.ASH && Math.random() < 0.2) world.ground[i] = G.GRASS;
  });
}

function hotSpring(world: World, w: Wonder, heal: (c: Creature, hp: number) => void): void {
  disc(world, w.x, w.y, 7, (i, d) => {
    if (d < 0.35) {
      world.temp[i] = Math.max(world.temp[i], 40);
      if (world.fluid[i] === F.ICE) world.setFluid(i, F.WATER, world.depth[i]);
    } else {
      world.temp[i] = Math.max(world.temp[i], 12);
      if (world.ground[i] === G.SNOW && Math.random() < 0.15) world.ground[i] = G.GRASS;
      if (world.fluid[i] === F.ICE && Math.random() < 0.15) world.setFluid(i, F.WATER, world.depth[i]);
    }
  });
  aura(world, w.x, w.y, 3, (c) => {
    heal(c, 3);
    c.burning = 0;
    c.frozen = 0;
  });
}

function shelter(world: World, w: Wonder, kindOf: (c: Creature) => { native: boolean }, heal: (c: Creature, hp: number) => void): void {
  const night = daylight(world.time).night;
  for (const c of world.crowd.near(world, w.x, w.y, 22)) {
    if (c.dead || !kindOf(c).native || c.kind === "fish" || c.kind === "bird" || c.kind === "parrot") continue;
    const d = Math.hypot(c.x - w.x, c.y - w.y);
    if (d < 2.5) {
      heal(c, 2);
      c.burning = 0;
    } else if ((c.burning > 0 || c.fear > 0 || night > 0.7) && Math.random() < 0.3) sendTo(c, w.x, w.y);
  }
}

// Young trees springing up around: a shrub on open grass in the woodland.
function seedTrees(world: World, x: number, y: number, r0: number, r1: number, chance: number): void {
  if (Math.random() > chance) return;
  const a = Math.random() * Math.PI * 2;
  const d = r0 + Math.random() * (r1 - r0);
  const tx = Math.round(x + Math.cos(a) * d);
  const ty = Math.round(y + Math.sin(a) * d);
  if (!world.inside(tx, ty)) return;
  const i = ty * world.w + tx;
  if (world.ground[i] !== G.GRASS || world.cover[i] !== C.NONE || !dryAt(world, i)) return;
  world.setCover(i, C.BUSH);
  if (world.flora) world.flora[i] |= WOODLAND;
}

// A villager of the nearest village walks there now and then; one who
// arrives brings home what the place gives.
function visit(world: World, w: Wonder, every: number, did: string, gold: number): void {
  for (const c of world.crowd.near(world, w.x, w.y, 3)) {
    if (c.dead || c.kind !== "villager" || c.data.visited === w.seed) continue;
    c.data.visited = w.seed;
    deed(c, did);
    const v = villageOf(world, c.homeX, c.homeY);
    if (v && gold) v.gold += gold;
  }
  if (w.t > 0 || daylight(world.time).night > 0.3) return;
  w.t = every;
  let pick: Creature | null = null;
  let bestD = 90;
  for (const c of world.creatures) {
    if (c.dead || c.kind !== "villager" || !c.mind || c.mind.task === "rest" || c.mind.task === "fight") continue;
    const d = Math.hypot(c.x - w.x, c.y - w.y);
    if (d < bestD && cellHash(c.id, Math.floor(world.time / every)) < 0.5) {
      bestD = d;
      pick = c;
    }
  }
  if (pick) {
    delete pick.data.visited;
    sendTo(pick, w.x + (Math.random() - 0.5) * 2, w.y + (Math.random() - 0.5) * 2);
    pick.mind!.action = `walking to ${w.name}`;
  }
}

function geysers(world: World, w: Wonder): void {
  if (w.t > 0) {
    if (w.state > 0) erupt(world, w, false);
    return;
  }
  if (w.state <= 0) {
    // An eruption: three seconds of water and steam.
    w.state = 3;
    w.t = 3;
    world.emit({ kind: "sound", name: "whoosh", size: 0.4, x: w.x + 0.5, y: w.y + 0.5 });
    erupt(world, w, true);
  } else {
    w.state = 0;
    w.t = 22 + Math.random() * 18;
  }
}

function erupt(world: World, w: Wonder, first: boolean): void {
  for (const v of vents(w)) {
    for (let k = 0; k < (first ? 10 : 6); k++)
      world.particles.add({
        x: v.x + 0.5 + (Math.random() - 0.5) * 0.4,
        y: v.y + 0.5 + (Math.random() - 0.5) * 0.4,
        z: 0.5,
        vx: (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.5,
        vz: 14 + Math.random() * 8,
        life: 1.6,
        color: k % 3 ? 0xdff2ff : 0x9fd4f5,
        size: 1.1,
        gravity: 14,
        drag: 0.2,
      });
    disc(world, v.x, v.y, 1.5, (i) => {
      world.fire[i] = 0;
      if (world.ground[i] === G.SNOW) world.ground[i] = G.ROCK;
    });
    for (const c of world.crowd.near(world, v.x + 0.5, v.y + 0.5, 1.8)) {
      if (c.dead || c.z > 1 || Math.hypot(c.x - v.x - 0.5, c.y - v.y - 0.5) > 1.8) continue;
      const a = Math.atan2(c.y - v.y - 0.5, c.x - v.x - 0.5) || Math.random() * 6;
      c.vz = Math.max(c.vz, 11);
      c.vx += Math.cos(a) * 3;
      c.vy += Math.sin(a) * 3;
      c.burning = 0;
      c.fear = Math.max(c.fear, 2);
      c.fearX = v.x;
      c.fearY = v.y;
    }
  }
}

// A cell of this cover under a creature or a step from it, or -1: a walker
// is looked at twice a second and would pass over it unseen.
function beside(world: World, c: Creature, cover: number): number {
  const x = Math.round(c.x - 0.5);
  const y = Math.round(c.y - 0.5);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!world.inside(x + dx, y + dy)) continue;
      const i = (y + dy) * world.w + x + dx;
      if (world.cover[i] === cover) return i;
    }
  return -1;
}

function mine(world: World, w: Wonder): void {
  // A miner standing on ore takes it home.
  for (const c of world.crowd.near(world, w.x, w.y, 8)) {
    if (c.dead || c.kind !== "villager") continue;
    const i = beside(world, c, C.ORE);
    if (i < 0) continue;
    world.setCover(i, C.NONE);
    const v = villageOf(world, c.homeX, c.homeY);
    if (v) v.gold += 2;
    deed(c, `mined strange ore in ${w.name}`);
  }
  if (w.t > 0) return;
  w.t = 30;
  // The ore grows back slowly, up to what fell.
  let ore: number[] = [];
  disc(world, w.x, w.y, 7, (i) => {
    if (world.cover[i] === C.ORE) ore.push(i);
  });
  if (ore.length < w.state && Math.random() < 0.5) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * 4.5;
    const i = Math.round(w.y + Math.sin(a) * d) * world.w + Math.round(w.x + Math.cos(a) * d);
    if (world.cover[i] === C.NONE && dryAt(world, i)) {
      world.setCover(i, C.ORE);
      ore = [...ore, i];
    }
  }
  if (!ore.length || daylight(world.time).night > 0.3) return;
  let pick: Creature | null = null;
  let bestD = 80;
  for (const c of world.creatures) {
    if (c.dead || c.kind !== "villager" || !c.mind || c.mind.task === "rest" || c.mind.task === "fight") continue;
    const d = Math.hypot(c.x - w.x, c.y - w.y);
    if (d < bestD && cellHash(c.id, Math.floor(world.time / 30)) < 0.4) {
      bestD = d;
      pick = c;
    }
  }
  if (pick) {
    const i = ore[Math.floor(Math.random() * ore.length)];
    sendTo(pick, (i % world.w) + 0.5, Math.floor(i / world.w) + 0.5);
    pick.mind!.action = `going to mine ${w.name}`;
  }
}

function frozenFall(world: World, w: Wonder): void {
  // Keeps the cold: the air around it and its ice.
  let warm = 0;
  let n = 0;
  disc(world, w.x, w.y, 5, (i) => {
    n++;
    if (world.fire[i] > 0.2 || world.fluid[i] === F.LAVA) warm += 3;
    if (world.temp[i] > 8) warm++;
    world.temp[i] = Math.min(world.temp[i], world.temp[i] * 0.9 - 1.2);
  });
  if (warm / Math.max(1, n) < 0.5) {
    w.state = 0;
    return;
  }
  // Heat that lasts five seconds thaws it: it runs as a waterfall from now on.
  w.state += DT;
  if (w.state < 5) return;
  w.kind = "waterfall";
  const top = Math.round(w.ay) * world.w + Math.round(w.ax);
  world.springs.push({ i: top, level: world.height[top] + 0.6, rate: 1.6 });
  disc(world, w.x, w.y, 7, (i) => {
    if (world.fluid[i] === F.ICE) world.setFluid(i, F.WATER, world.depth[i]);
  });
  tell(world, `${w.name} thawed and runs again`, { x: w.x, y: w.y });
}

function dance(world: World, w: Wonder, kindOf: (c: Creature) => { native: boolean }): void {
  let n = 0;
  for (const c of world.crowd.near(world, w.x, w.y, w.r)) {
    if (c.dead || !c.mind || c.kind === "fish" || c.kind === "bird") continue;
    if (!kindOf(c).native && c.kind !== "villager") continue;
    // Round the ring: always a little ahead of where it is, so it never
    // arrives and wanders off between two looks.
    const a = Math.atan2(c.y - w.y - 0.5, c.x - w.x - 0.5) + 1.1;
    c.mind.task = "roam";
    c.mind.tx = w.x + 0.5 + Math.cos(a) * 3;
    c.mind.ty = w.y + 0.5 + Math.sin(a) * 3;
    c.mind.action = `dancing round ${w.name}`;
    c.tx = c.mind.tx;
    c.ty = c.mind.ty;
    // The ring's spell: no fear, no alarm, no sleep, no hunger till dawn.
    c.fear = 0;
    calmDown(c);
    c.sleep = 0;
    c.mind.meal = false;
    c.mind.hunger = Math.min(c.mind.hunger, 0.5);
    n++;
  }
  if (n && w.state !== dayOf(world.time)) {
    w.state = dayOf(world.time);
    tell(world, `creatures danced round ${w.name} under the stars`, { x: w.x, y: w.y });
  }
}

// The dragon sleeps on its hoard (the view draws it so). A villager who
// takes gold, or a blast near it, wakes it: it guards its hoard for a
// minute, then sleeps again where it lies.
export const DRAGON = "old dragon";

function hoard(world: World, w: Wonder, spawn: Spawn): void {
  const dragon = world.creatures.find((c) => c.kind === DRAGON && !c.dead && c.data.hoard === w.seed);
  if (w.state === 2) return; // slain: its gold is anyone's.
  if (dragon) {
    // Back on its gold, or half a minute after its time is up wherever it is
    // (it flies home out of sight): asleep again.
    if (w.t <= 0 && (Math.hypot(dragon.x - w.x, dragon.y - w.y) < 6 || w.t < -30)) {
      // Back to sleep: the creature leaves, the model lies down again.
      dragon.dead = true;
      dragon.deadFor = 999;
      w.state = 0;
    } else if (w.t <= 0) sendTo(dragon, w.x, w.y);
  } else if (w.state === 1) {
    // Awake but gone: killed.
    w.state = 2;
    tell(world, `the dragon of ${w.name} was slain`, { x: w.x, y: w.y });
    return;
  }
  // Thieves.
  for (const c of world.crowd.near(world, w.x, w.y, 6)) {
    if (c.dead || c.kind !== "villager") continue;
    const i = beside(world, c, C.HOARD);
    if (i < 0) continue;
    world.setCover(i, C.NONE);
    const v = villageOf(world, c.homeX, c.homeY);
    if (v) v.gold += 5;
    deed(c, `stole gold from ${w.name}`);
    if (w.state !== 1) wake(world, w, spawn);
  }
  if (w.state === 0 && w.t <= 0 && daylight(world.time).night < 0.3) {
    w.t = 80;
    let gold = -1;
    disc(world, w.x, w.y, 5, (i) => {
      if (world.cover[i] === C.HOARD && gold < 0) gold = i;
    });
    if (gold < 0) return;
    for (const c of world.creatures) {
      if (c.dead || c.kind !== "villager" || !c.mind || c.mind.task === "rest") continue;
      if (Math.hypot(c.x - w.x, c.y - w.y) > 110 || cellHash(c.id, Math.floor(world.time / 80)) > 0.15) continue;
      sendTo(c, (gold % world.w) + 0.5, Math.floor(gold / world.w) + 0.5);
      c.mind.action = `sneaking up on ${w.name}`;
      break;
    }
  }
}

export function wake(world: World, w: Wonder, spawn: Spawn): void {
  if (w.state !== 0) return;
  const d = spawn(DRAGON, w.x + 0.5, w.y + 0.5);
  d.data.hoard = w.seed;
  d.homeX = w.x;
  d.homeY = w.y;
  w.state = 1;
  w.t = 60;
  world.emit({ kind: "sound", name: "rumble", size: 0.8, x: w.x + 0.5, y: w.y + 0.5 });
  tell(world, `the dragon of ${w.name} woke up`, { x: w.x, y: w.y });
}

// A blast near a wonder that stands above the land takes it away; near a
// hoard it wakes the dragon. From physics.ts's explosions.
export function blastWonders(world: World, x: number, y: number, r: number, spawn: Spawn | null): void {
  if (!world.wonders.length || r < 5) return;
  world.wonders = world.wonders.filter((w) => {
    const d = Math.hypot(w.x - x, w.y - y);
    if (w.kind === "hoard" && d < r + 6) {
      if (spawn) wake(world, w, spawn);
      return true;
    }
    if (!WONDER_KINDS.get(w.kind)?.standing || d > r * 0.6 || w.kind === "floating rock") return true;
    tell(world, `${w.name} was destroyed`, { x: w.x, y: w.y });
    disc(world, w.x, w.y, 4, (i) => {
      if (world.cover[i] === C.WONDER) world.setCover(i, C.RUBBLE);
    });
    return false;
  });
}

export const MAX_WONDERS = 12;

// A saved wonder, checked.
export function readWonder(v: unknown): Wonder | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const num = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : 0);
  const def = o.def ? readDef(o.def) : null;
  if (typeof o.kind !== "string" || (o.def ? !def || def.kind !== o.kind : !WONDER_KINDS.has(o.kind))) return null;
  return {
    kind: o.kind,
    x: num("x"),
    y: num("y"),
    r: Math.max(1, Math.min(30, num("r"))),
    seed: num("seed") >>> 0,
    name: typeof o.name === "string" ? o.name.slice(0, 40) : o.kind,
    t: num("t"),
    state: num("state"),
    ax: num("ax"),
    ay: num("ay"),
    ...(def ? { def } : {}),
  };
}
