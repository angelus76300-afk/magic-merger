// A lake's rim and bed blend their grounds (27 November, the owner's screenshots: "Look at how bad
// the borders look now!"). Where sand meets grass at a lake's edge and on its bed, the border
// between the grounds was drawn in square stairs, a whole cell at a time, while on dry land it
// wanders in eighths: the blend of two grounds (terrain-fine.ts buildFineTile) skipped every cell
// under water. A cell of a lake's bed now blends like dry ground (LAKE_RIM).
//
// Measured on the temperate lakes island of seed 7 and the tundra lakes island of seed 5, on high,
// every chunk drawn finely, each ground's table of colours drawn in a code colour of its own (as in
// scripts/ground-blend-test.ts), from the land's meshes:
//   1. stairs: of the cell sides between sand and grass where at least one of the two cells is a
//      lake's bed, those along which the drawn ground changes exactly at the cell's side, all eight
//      columns (LAKE_RIM off, as main drew it: all or almost all of them);
//   2. the same on dry land, the blend as it was (a control: still few);
//   3. nothing else moves: drawn with LAKE_RIM on and off, every column whose colour differs is in a
//      lake's bed or a cell beside one (the open sea, cliffs and the dry land away from a lake drawn
//      as before).
// Run with the other checks (npm test, scripts/sim-test.ts).
import { MeshBasicMaterial, type Mesh } from "three";
import { generateWorld, type World } from "../src/sim/world";
import { readLand } from "../src/sim/land-options";
import { Terrain, columnTop } from "../src/sim/voxel/terrain";
import { GRAPHICS, PRESETS, type LooksFlag } from "../src/sim/voxel/graphics";
import { LAKE_RIM, lakeShare } from "../src/sim/voxel/terrain-fine";
import { F, G, type Material } from "../src/sim/materials";
import type { Biome, Shape } from "../src/sim/land-options";
import { topColors } from "./lake-depth-test";

type Check = (name: string, ok: boolean, detail?: string) => void;

const SUB = 8;
const CODES = [0xff2020, 0x20ff20, 0x2020ff, 0xffff20, 0xff20ff, 0x20ffff, 0xff9020, 0x9020ff, 0x20ff90, 0xff2090];

export const RIM_ISLANDS: { seed: number; biome: Biome; shape: Shape }[] = [
  { seed: 7, biome: "temperate", shape: "lakes" },
  { seed: 5, biome: "tundra", shape: "lakes" },
];

interface Drawn {
  world: World;
  col: Int32Array; // the colour of the top over each eighth column, -1 where none
  code: (i: number) => number; // the code colour of a cell's table of colours
  wet: Uint8Array;
}

function inner(t: Terrain): { colorsAt: (i: number, id: number, m: Material) => number[]; wantLevel: (c: number) => number; wet: Uint8Array } {
  return t as unknown as ReturnType<typeof inner>;
}

// The island drawn finely everywhere, coded, with LAKE_RIM `on`.
function draw(seed: number, biome: Biome, shape: Shape, on: boolean, cells = 152): Drawn {
  const was = { ...GRAPHICS };
  const wasOn = LAKE_RIM.on;
  try {
    for (const [f, v] of Object.entries(PRESETS.high)) GRAPHICS[f as LooksFlag] = v;
    // Flowers, tufts, weed and tone patches have colours of their own: off, each column is its ground's.
    GRAPHICS.weed = false;
    GRAPHICS.grain = false;
    GRAPHICS.bits = false;
    LAKE_RIM.on = on;
    const world = generateWorld(cells, cells, seed, readLand({ biome, shape }));
    world.time = 12 * 60;
    const meshes: Mesh[] = [];
    const land = new MeshBasicMaterial();
    const terrain = new Terrain(
      world,
      land,
      new MeshBasicMaterial(),
      (m) => meshes.push(m),
      (m) => meshes.splice(meshes.indexOf(m), 1),
    );
    terrain.wetClock = () => 0;
    const t = inner(terrain);
    const own = t.colorsAt.bind(terrain);
    const tables = new Map<number[], number>();
    const codeOf = (colors: number[]) => {
      let c = tables.get(colors);
      if (c === undefined) tables.set(colors, (c = CODES[tables.size % CODES.length]));
      return c;
    };
    t.colorsAt = (i, id, m) => [codeOf(own(i, id, m))];
    t.wantLevel = () => SUB;
    terrain.scan();
    terrain.rebuild(true);
    terrain.focus(0, 40, 0, 0, 0);
    terrain.updateFine(0, true);
    const { col } = topColors(world, meshes, land);
    const code = (i: number) => codeOf(own(i, world.ground[i], world.materials.get("ground", world.ground[i])));
    return { world, col, code, wet: t.wet };
  } finally {
    Object.assign(GRAPHICS, was);
    LAKE_RIM.on = wasOn;
  }
}

// Which of codes a and b a drawn colour is nearer, by its hue (its channels over the brightest):
// a lake's bed is darkened toward its water's colour, so no threshold.
function nearer(c: number, a: number, b: number): number {
  const ch = (x: number) => [(x >> 16) & 255, (x >> 8) & 255, x & 255];
  const hue = (x: number) => {
    const v = ch(x);
    const m = Math.max(...v, 1);
    return v.map((k) => k / m);
  };
  const h = hue(c);
  const d = (x: number) => hue(x).reduce((s, k, j) => s + Math.abs(k - h[j]), 0);
  return d(a) <= d(b) ? a : b;
}

interface Sides {
  wetSides: number; // cell sides between sand and grass, a lake's bed on one side at least
  wetStraight: number; // of them, the ground changing exactly at the side
  drySides: number; // the same on dry land
  dryStraight: number;
}
export interface RimReport {
  on: Sides;
  off: Sides; // LAKE_RIM off, as main drew it
  moved: number; // columns drawn differently with LAKE_RIM on and off
  movedAway: number; // of them, in a cell neither a lake's bed nor beside one
}

export function lakeRim(k: number): RimReport {
  const I = RIM_ISLANDS[k];
  const on = draw(I.seed, I.biome, I.shape, true);
  const off = draw(I.seed, I.biome, I.shape, false);
  const { world } = on;
  const W = world.w * SUB;
  const lakeBed = (i: number) => on.wet[i] === 1 && world.fluid[i] === F.WATER && lakeShare(world.height[i] + world.depth[i], world.seaLevel) > 0;
  const measure = (d: Drawn): Sides => {
    const r: Sides = { wetSides: 0, wetStraight: 0, drySides: 0, dryStraight: 0 };
    for (let y = 2; y < world.h - 2; y++)
      for (let x = 2; x < world.w - 2; x++) {
        const i = y * world.w + x;
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
        ]) {
          const n = i + dy * world.w + dx;
          const gs = [world.ground[i], world.ground[n]];
          if (!(gs.includes(G.SAND) && gs.includes(G.GRASS)) || world.cover[i] !== 0 || world.cover[n] !== 0) continue;
          if (Math.abs(columnTop(world, i) - columnTop(world, n)) > 1) continue;
          const wet = lakeBed(i) || lakeBed(n);
          const dry = !d.wet[i] && !d.wet[n];
          if (!wet && !dry) continue;
          const a = d.code(i);
          const b = d.code(n);
          if (a === b) continue;
          let exact = true;
          let seen = 0;
          for (let q = 0; q < SUB; q++) {
            const sa = dx ? (y * SUB + q) * W + x * SUB + SUB - 1 : (y * SUB + SUB - 1) * W + x * SUB + q;
            const sz = dx ? sa + 1 : sa + W;
            if (d.col[sa] < 0 || d.col[sz] < 0) continue;
            seen++;
            if (!(nearer(d.col[sa], a, b) === a && nearer(d.col[sz], a, b) === b)) exact = false;
          }
          if (seen < SUB / 2) continue;
          if (wet) {
            r.wetSides++;
            if (exact) r.wetStraight++;
          } else {
            r.drySides++;
            if (exact) r.dryStraight++;
          }
        }
      }
    return r;
  };
  // A lake's bed or a cell beside one.
  const nearLake = (i: number) => {
    const x = i % world.w;
    const y = (i - x) / world.w;
    for (let b = -1; b <= 1; b++)
      for (let a = -1; a <= 1; a++) {
        const xx = x + a;
        const yy = y + b;
        if (xx >= 0 && yy >= 0 && xx < world.w && yy < world.h && lakeBed(yy * world.w + xx)) return true;
      }
    return false;
  };
  let moved = 0;
  let movedAway = 0;
  for (let s = 0; s < on.col.length; s++) {
    if (on.col[s] === off.col[s]) continue;
    moved++;
    const cell = Math.floor(s / W / SUB) * world.w + Math.floor((s % W) / SUB);
    if (!nearLake(cell)) movedAway++;
  }
  return { on: measure(on), off: measure(off), moved, movedAway };
}

export function lakeRimChecks(check: Check): void {
  for (let k = 0; k < RIM_ISLANDS.length; k++) {
    const I = RIM_ISLANDS[k];
    const r = lakeRim(k);
    const { on } = r;
    const name = `the ${I.biome} ${I.shape} island of seed ${I.seed}`;
    check(
      `a lake's rim on ${name}: the border between sand and grass on a lake's bed wanders in eighths, no stairs (${on.wetStraight} of ${on.wetSides} cell sides straight; ${r.off.wetStraight} of ${r.off.wetSides} before)`,
      on.wetSides > 20 && on.wetStraight <= on.wetSides * 0.25,
      JSON.stringify(r),
    );
    check(
      `a lake's rim on ${name}: on dry land the border still wanders (${on.dryStraight} of ${on.drySides} cell sides straight)`,
      on.drySides > 20 && on.dryStraight <= on.drySides * 0.25,
      JSON.stringify(r),
    );
    check(
      `a lake's rim on ${name}: only a lake and the cells beside it are drawn differently (${r.movedAway} of ${r.moved} changed columns elsewhere)`,
      r.moved > 0 && r.movedAway === 0,
      JSON.stringify(r),
    );
  }
}

// Run alone: node on the bundle prints the reports.
if (/lake-rim[^/]*\.mjs$/.test(process.argv[1] ?? ""))
  for (let k = 0; k < RIM_ISLANDS.length; k++) console.log(JSON.stringify({ ...RIM_ISLANDS[k], ...lakeRim(k) }));
