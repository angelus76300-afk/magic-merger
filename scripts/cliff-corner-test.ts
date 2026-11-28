// Cliff corners and coast cliffs (26 November, the owner: "Look at how bad the borders look now!").
// Measured on the medium plateau island (seed 7, the terraces and coast cliffs of the owner's
// frames) and the small desert plateau of the land's checks, on high, the fine chunks round five
// places along its cliffs, from the land and water meshes as drawn:
//   1. corners: where a cell stands a cliff above or below the three others round one of its
//      corners (they at one level, dry, nothing standing on any), the column at that corner of the
//      cell is drawn at their level, not its own (terrain-fine.ts cliffCorner): a diagonal cliff runs
//      on one line, not in whole-cell notches. Off (CLIFF_CORNER.on false), every such column is the
//      cell's own: the check fails.
//   2. tan strips: no column of land in a water cell stands more than SHORE_LOW over its water (a
//      column of the shallows raised to a cliff's top, drawn as the beach's sand down the cliff).
// Run with the other checks (npm test, scripts/sim-test.ts).
import { MeshBasicMaterial, type Mesh } from "three";
import { generateWorld, type World } from "../src/sim/world";
import { Terrain, columnTop, surfaceY } from "../src/sim/voxel/terrain";
import { GRAPHICS, PRESETS, type LooksFlag } from "../src/sim/voxel/graphics";
import { CLIFF_CORNER, CLIFF_OUTLINE } from "../src/sim/voxel/terrain-fine";
import { DEFAULT_LAND, type LandOptions } from "../src/sim/land-options";
import { C, F, G } from "../src/sim/materials";
import { surface } from "./shore-rim-test";

type Check = (name: string, ok: boolean, detail?: string) => void;

const SUB = 8;
export const CLIFF_ISLANDS: { name: string; cells: number; seed: number; land: LandOptions }[] = [
  { name: "medium plateau", cells: 152, seed: 7, land: { ...DEFAULT_LAND, shape: "plateau" } },
  { name: "small plateau desert", cells: 112, seed: 3, land: { ...DEFAULT_LAND, biome: "desert", shape: "plateau", relief: 0.8 } },
];

export interface CliffCorners {
  corners: number; // corners of a lone cell a cliff from the three others round it
  cut: number; // of them, drawn at the three's level
  water: number; // columns of land drawn in a water cell
  strips: number; // of them, more than SHORE_LOW (1.25 voxels) over the water
  at: string[]; // where the first few stand
}

// A thin sheet of water at the foot of a few cliffs, beside low dry ground, as a played island has
// it where water has spread (the owner's coast, the lab's medium plateau after a minute): the
// shallows by a cliff, where a column rose to the cliff's top.
function floodCliffFeet(world: World): void {
  const { w, h } = world;
  const taken: [number, number][] = [];
  for (let y = 10; y < h - 10; y++)
    for (let x = 10; x < w - 10; x++) {
      const i = y * w + x;
      if (world.fluid[i] !== F.NONE || world.cover[i] !== C.NONE || taken.some(([a, b]) => Math.abs(a - x) + Math.abs(b - y) < 12)) continue;
      const t = columnTop(world, i);
      const cliff = [i - 1, i + 1, i - w, i + w].some((n) => world.fluid[n] === F.NONE && columnTop(world, n) >= t + 3);
      const low = [i - 1, i + 1, i - w, i + w].some((n) => world.fluid[n] === F.NONE && world.cover[n] === C.NONE && Math.abs(columnTop(world, n) - t) <= 0.5);
      if (!cliff || !low) continue;
      world.fluid[i] = F.WATER;
      world.depth[i] = 0.15;
      world.ground[i] = G.SAND;
      taken.push([x, y]);
    }
}

// `outline`: with the cliff outline (terrain-fine.ts cliffOutline, the game's since 28 November),
// which draws cliffs on their own line in cliffCorner's place; off, cliffCorner as on 26 November.
// Each island and mode measured once a run (both checks read the outline's).
const MEASURED = new Map<string, CliffCorners>();
export function cliffCorners(k: number, on = true, outline = false): CliffCorners {
  const key = `${k} ${on} ${outline}`;
  const had = MEASURED.get(key);
  if (had) return had;
  const r = measureCorners(k, on, outline);
  MEASURED.set(key, r);
  return r;
}
function measureCorners(k: number, on: boolean, outline: boolean): CliffCorners {
  const I = CLIFF_ISLANDS[k];
  const was = { ...GRAPHICS };
  const wasOn = CLIFF_CORNER.on;
  const wasOutline = CLIFF_OUTLINE.on;
  try {
    for (const [f, v] of Object.entries(PRESETS.high)) GRAPHICS[f as LooksFlag] = v;
    CLIFF_CORNER.on = on;
    CLIFF_OUTLINE.on = outline;
    const world = generateWorld(I.cells, I.cells, I.seed, I.land);
    floodCliffFeet(world);
    const meshes: Mesh[] = [];
    const land = new MeshBasicMaterial();
    const fluid = new MeshBasicMaterial();
    const terrain = new Terrain(
      world,
      land,
      fluid,
      (m) => meshes.push(m),
      (m) => meshes.splice(meshes.indexOf(m), 1),
    );
    terrain.wetClock = () => 0;
    terrain.scan();
    terrain.rebuild(true);
    const wet = (terrain as unknown as { wet: Uint8Array }).wet;
    const { w, h } = world;
    const top = (i: number) => columnTop(world, i);
    // Dry open ground with nothing on it and no water beside it (the cells cliffCorner may cut).
    const open = (x: number, y: number) => {
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return false;
      const i = y * w + x;
      if (wet[i] || wet[i - 1] || wet[i + 1] || wet[i - w] || wet[i + w] || world.cover[i] !== C.NONE) return false;
      return world.fluid[i] === 0;
    };
    // Blocks of 2 by 2 cells with a lone cell a cliff (two voxels) from the three others.
    const blocks: { x: number; y: number; ex: number; ey: number; level: number }[] = [];
    for (let y = 8; y < h - 8; y++)
      for (let x = 8; x < w - 8; x++)
        for (const ex of [-1, 1])
          for (const ey of [-1, 1]) {
            if (!open(x, y) || !open(x + ex, y) || !open(x, y + ey) || !open(x + ex, y + ey)) continue;
            const t = top(y * w + x);
            const o = [top(y * w + x + ex), top((y + ey) * w + x), top((y + ey) * w + x + ex)];
            if (Math.max(...o) - Math.min(...o) > 1) continue;
            if (o.some((v) => Math.abs(v - t) < 2)) continue;
            blocks.push({ x, y, ex, ey, level: (o[0] + o[1] + o[2]) / 3 });
          }
    // Cliffs into water: a water cell beside dry land three voxels over its surface.
    const coast: [number, number][] = [];
    for (let y = 8; y < h - 8; y++)
      for (let x = 8; x < w - 8; x++) {
        const i = y * w + x;
        if (!wet[i]) continue;
        const sea = surfaceY(world, i);
        // A cliff beside it, and low dry ground round it (the shore its shallows are drawn as).
        const cliff = [i - 1, i + 1, i - w, i + w].some((n) => !wet[n] && columnTop(world, n) > sea + 3);
        let low = false;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const n = i + dy * w + dx;
            if (!wet[n] && columnTop(world, n) - sea <= 1.25) low = true;
          }
        if (cliff && low) coast.push([x, y]);
      }
    const out: CliffCorners = { corners: 0, cut: 0, water: 0, strips: 0, at: [] };
    const W = w * SUB;
    const places: [number, number][] = [];
    for (const q of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      if (blocks.length) places.push([blocks[Math.floor(blocks.length * q)].x, blocks[Math.floor(blocks.length * q)].y]);
      if (coast.length) places.push(coast[Math.floor(coast.length * q)]);
    }
    for (const [cx, cy] of places) {
      terrain.focus(cx - w / 2, 20, cy - h / 2, cx - w / 2, cy - h / 2);
      terrain.updateFine(0, true);
      const L = surface(world, meshes, land);
      // The ground under a lip of grass hanging over a cliff, not the lip.
      const low = surface(world, meshes, land, true);
      const near = (x: number, y: number) => Math.abs(x - cx) < 6 && Math.abs(y - cy) < 6;
      for (const b of blocks) {
        if (!near(b.x, b.y)) continue;
        // The column at the corner the four cells share.
        const i = b.x * SUB + (b.ex > 0 ? SUB - 1 : 0);
        const j = b.y * SUB + (b.ey > 0 ? SUB - 1 : 0);
        const y = L[j * W + i];
        if (Number.isNaN(y)) continue;
        out.corners++;
        if (Math.abs(y - b.level) < 1) out.cut++;
      }
      for (let y = cy - 6; y < cy + 6; y++)
        for (let x = cx - 6; x < cx + 6; x++) {
          const c = y * w + x;
          if (!wet[c]) continue;
          const sea = surfaceY(world, c);
          for (let j = y * SUB; j < (y + 1) * SUB; j++)
            for (let i = x * SUB; i < (x + 1) * SUB; i++) {
              const l = low[j * W + i];
              if (Number.isNaN(l) || l < sea) continue;
              out.water++;
              if (l > sea + 1.25 + 0.5) {
                out.strips++;
                if (out.at.length < 4) out.at.push(`(${(i / SUB).toFixed(3)}, ${(j / SUB).toFixed(3)}) ${(l - sea).toFixed(2)} over`);
              }
            }
        }
      // Each place counted once.
      blocks.splice(0, blocks.length, ...blocks.filter((b) => !near(b.x, b.y)));
    }
    return out;
  } finally {
    Object.assign(GRAPHICS, was);
    CLIFF_CORNER.on = wasOn;
    CLIFF_OUTLINE.on = wasOutline;
  }
}

export function cliffCornerChecks(check: Check): void {
  for (const k of [0, 1]) {
    const name = CLIFF_ISLANDS[k].name;
    const r = cliffCorners(k);
    const off = cliffCorners(k, false);
    const line = cliffCorners(k, true, true);
    check(
      `cliffs (${name}): a lone cell's corner against three cells a cliff away is drawn at their level, so a diagonal cliff runs on a line, not in notches (cliffCorner, and the outline the game draws)`,
      r.corners >= 10 && r.cut >= r.corners * 0.85 && off.cut <= off.corners * 0.15 && line.corners >= 10 && line.cut >= line.corners * 0.85,
      `${r.cut} of ${r.corners} corners cut (with cliffCorner off: ${off.cut} of ${off.corners}; the outline: ${line.cut} of ${line.corners})`,
    );
    check(
      `cliffs (${name}): no column of land in a water cell stands up a cliff, a tan strip down its face`,
      r.strips === 0,
      `${r.strips} of ${r.water} columns of land in water cells more than SHORE_LOW over the water ${r.at.join(", ")}`,
    );
  }
}
