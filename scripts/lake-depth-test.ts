// A lake's floor fades smoothly with depth (26 November, the owner's screenshot of a lake: big blocky
// squares of dark and light where 33607f6 drew a smooth fade). Since #192 to #197 a lake's bed darkens
// toward its water's deep colour by its depth (terrain-fine.ts lakeBedDark); each column was darkened
// by its own depth under the surface, and a bed steps from cell to cell, so each step of the bed drew
// a square a cell wide a shade apart. The bed is now darkened by the cells' depth eased between their
// middles (lakeBedDepth), in 32nds: the shade changes in thin contours, the deep floor still dark and
// the shelf still light.
//
// Measured on the deepest lake of three generated islands as the fine land draws it, on high, from
// the land's meshes: the colour of the flat top over each eighth column, then
//   1. the largest step in light between neighbouring columns of the bed, two cells or more from the
//      shore and from another ground (with weed and the ground's tone patches off: their own colours
//      and light are by design, not the bed's shade);
//   2. the deep floor (4 units or more under the water) much darker than the shelf (a unit or less).
// Run with the other checks (npm test, scripts/sim-test.ts).
import { MeshBasicMaterial, type Mesh } from "three";
import { generateWorld, type World } from "../src/sim/world";
import { readLand } from "../src/sim/land";
import { Terrain } from "../src/sim/voxel/terrain";
import { GRAPHICS, PRESETS, type LooksFlag } from "../src/sim/voxel/graphics";
import { lakeShare } from "../src/sim/voxel/terrain-fine";
import { F } from "../src/sim/materials";
import type { Biome, Shape } from "../src/sim/land-options";

type Check = (name: string, ok: boolean, detail?: string) => void;

const SUB = 8;

// The colour (0xrrggbb) and height of the highest flat top of `mat`'s meshes over each eighth column
// of the island, at its middle; -1 where none.
export function topColors(world: World, meshes: Mesh[], mat: MeshBasicMaterial): { col: Int32Array; y: Float32Array } {
  const W = world.w * SUB;
  const col = new Int32Array(W * world.h * SUB).fill(-1);
  const y = new Float32Array(W * world.h * SUB).fill(-Infinity);
  for (const m of meshes) {
    if (!m.visible || m.material !== mat) continue;
    const p = m.geometry.getAttribute("position").array as Float32Array;
    const ca = m.geometry.getAttribute("color");
    const c = ca.array as ArrayLike<number>;
    const cs = ca.itemSize;
    const norm = ca.normalized ? 255 : 1;
    const idx = m.geometry.index ? (m.geometry.index.array as ArrayLike<number>) : null;
    const nt = idx ? idx.length / 3 : p.length / 9;
    for (let t = 0; t < nt; t++) {
      const v0 = idx ? idx[t * 3] : t * 3;
      const v1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const v2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const ay = p[v0 * 3 + 1];
      // Flat tops only.
      if (Math.abs(p[v1 * 3 + 1] - ay) > 1e-5 || Math.abs(p[v2 * 3 + 1] - ay) > 1e-5) continue;
      const ax = p[v0 * 3];
      const az = p[v0 * 3 + 2];
      const bx = p[v1 * 3];
      const bz = p[v1 * 3 + 2];
      const qx = p[v2 * 3];
      const qz = p[v2 * 3 + 2];
      const det = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz);
      if (Math.abs(det) < 1e-9) continue;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, qx) + world.w / 2) * SUB));
      const i1 = Math.min(W, Math.ceil((Math.max(ax, bx, qx) + world.w / 2) * SUB));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz, qz) + world.h / 2) * SUB));
      const j1 = Math.min(world.h * SUB, Math.ceil((Math.max(az, bz, qz) + world.h / 2) * SUB));
      for (let j = j0; j < j1; j++)
        for (let i = i0; i < i1; i++) {
          const px = (i + 0.5) / SUB - world.w / 2;
          const pz = (j + 0.5) / SUB - world.h / 2;
          const l1 = ((bz - qz) * (px - qx) + (qx - bx) * (pz - qz)) / det;
          const l2 = ((qz - az) * (px - qx) + (ax - qx) * (pz - qz)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
          const s = j * W + i;
          if (y[s] >= ay) continue;
          y[s] = ay;
          // The three vertices' colours mixed at this point.
          const ch = (k: number) => Math.round(((l1 * c[v0 * cs + k] + l2 * c[v1 * cs + k] + l3 * c[v2 * cs + k]) / norm) * 255);
          col[s] = (ch(0) << 16) | (ch(1) << 8) | ch(2);
        }
    }
  }
  return { col, y };
}

function luma(c: number): number {
  return 0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255);
}

export interface LakeFloor {
  columns: number; // columns of the bed measured for steps
  pairs: number;
  maxStep: number; // the largest step in light between neighbouring columns, in 255ths
  bigSteps: number; // neighbouring columns more than BIG apart
  shelf: number; // mean light of the bed under a unit of water or less
  deep: number; // mean light of the bed under 4 units or more
}
const BIG = 6;

// One lake: the island's deepest lake cell (water above the sea), the fine chunks round it.
export function lakeFloor(seed: number, biome: Biome, shape: Shape, cells = 152): LakeFloor {
  const was = { ...GRAPHICS };
  try {
    for (const [f, on] of Object.entries(PRESETS.high)) GRAPHICS[f as LooksFlag] = on;
    GRAPHICS.weed = false;
    GRAPHICS.grain = false;
    const world = generateWorld(cells, cells, seed, readLand({ biome, shape }));
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
    const lake = (i: number) => world.fluid[i] === F.WATER && world.depth[i] > 0.06 && lakeShare(world.height[i] + world.depth[i], world.seaLevel) >= 1;
    let deep = -1;
    for (let i = 0; i < world.w * world.h; i++) if (lake(i) && (deep < 0 || world.depth[i] > world.depth[deep])) deep = i;
    const out: LakeFloor = { columns: 0, pairs: 0, maxStep: 0, bigSteps: 0, shelf: NaN, deep: NaN };
    if (deep < 0) return out;
    const cx = deep % world.w;
    const cy = Math.floor(deep / world.w);
    terrain.focus(cx - world.w / 2, 20, cy - world.h / 2, cx - world.w / 2, cy - world.h / 2);
    terrain.updateFine(0, true);
    const { col } = topColors(world, meshes, land);
    const W = world.w * SUB;
    const R = 14;
    const cellOf = (s: number) => Math.floor(s / W / SUB) * world.w + Math.floor((s % W) / SUB);
    // A column of the lake's bed two cells or more from a cell not of the lake or not of its ground.
    const inner = (s: number): boolean => {
      const i = cellOf(s);
      if (col[s] < 0 || !lake(i)) return false;
      const x = i % world.w;
      const y = Math.floor(i / world.w);
      for (let b = -2; b <= 2; b++)
        for (let a = -2; a <= 2; a++) {
          const n = (y + b) * world.w + x + a;
          if (!lake(n) || world.ground[n] !== world.ground[i]) return false;
        }
      return true;
    };
    let shelf = 0;
    let shelfN = 0;
    let deepL = 0;
    let deepN = 0;
    for (let j = (cy - R) * SUB; j < (cy + R) * SUB; j++)
      for (let i = (cx - R) * SUB; i < (cx + R) * SUB; i++) {
        const s = j * W + i;
        const c = cellOf(s);
        if (col[s] >= 0 && lake(c) && world.depth[c] <= 1) {
          shelf += luma(col[s]);
          shelfN++;
        } else if (col[s] >= 0 && lake(c) && world.depth[c] >= 4) {
          deepL += luma(col[s]);
          deepN++;
        }
        if (!inner(s)) continue;
        out.columns++;
        for (const n of [s + 1, s + W]) {
          if (!inner(n)) continue;
          out.pairs++;
          const d = Math.abs(luma(col[s]) - luma(col[n]));
          out.maxStep = Math.max(out.maxStep, d);
          if (d > BIG) out.bigSteps++;
        }
      }
    out.shelf = Math.round(shelf / shelfN);
    out.deep = Math.round(deepL / deepN);
    out.maxStep = Math.round(out.maxStep * 10) / 10;
    return out;
  } finally {
    Object.assign(GRAPHICS, was);
  }
}

export function lakeDepthChecks(check: Check): void {
  for (const [seed, biome, shape] of [
    [7, "temperate", "lakes"],
    [5, "tundra", "lakes"],
    [9, "swamp", "lakes"],
  ] as const) {
    const r = lakeFloor(seed, biome, shape);
    check(
      `a lake's floor on the ${biome} ${shape} island fades smoothly: no step over ${BIG}/255 of light between neighbouring columns of one ground`,
      r.columns > 2000 && r.bigSteps === 0,
      JSON.stringify(r),
    );
    check(`a lake's deep floor on the ${biome} ${shape} island is still much darker than its shelf`, r.deep < r.shelf * 0.6, JSON.stringify(r));
  }
}
