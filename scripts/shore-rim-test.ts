// Shores without a rim (23 November, the owner: "Boarder with water seem to often create a little
// wall to contain the water that looks weird, I think this little going further down of the the land
// shouldn't happen and actually the water should be the one slightly under"). Measured on the
// medium coast and the small desert plateau of the land's checks (terrain-looks-test.ts), on high,
// the fine chunks round five places along their shores, from the land and water meshes as drawn:
//   1. a rim: a column of land at the water's edge, with land behind it (up to four columns inland)
//      drawn under the water beside it, by at most half a unit (low ground, not a cliff's foot);
//   2. the water level with the land: the water beside a column of land at or above its top, by at
//      most half a unit (not at a cliff's foot).
// Run with the other checks (npm test, scripts/sim-test.ts).
import { MeshBasicMaterial, type Mesh } from "three";
import { generateWorld, type World } from "../src/sim/world";
import { Terrain } from "../src/sim/voxel/terrain";
import { GRAPHICS, PRESETS, type LooksFlag } from "../src/sim/voxel/graphics";
import { LOOK_ISLANDS } from "./terrain-looks-test";

type Check = (name: string, ok: boolean, detail?: string) => void;

const SUB = 8;
const BEHIND = 4;
const LOW = 0.5;

// The highest surface of `mat`'s meshes over each eighth column of the island, at its middle, NaN
// where none (each triangle that is not upright).
export function surface(world: World, meshes: Mesh[], mat: MeshBasicMaterial): Float32Array {
  const W = world.w * SUB;
  const y = new Float32Array(W * world.h * SUB).fill(NaN);
  for (const m of meshes) {
    if (!m.visible || m.material !== mat) continue;
    const p = m.geometry.getAttribute("position").array as Float32Array;
    const idx = m.geometry.index ? (m.geometry.index.array as ArrayLike<number>) : null;
    const nt = idx ? idx.length / 3 : p.length / 9;
    for (let t = 0; t < nt; t++) {
      const v0 = idx ? idx[t * 3] : t * 3;
      const v1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const v2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const ax = p[v0 * 3];
      const ay = p[v0 * 3 + 1];
      const az = p[v0 * 3 + 2];
      const bx = p[v1 * 3];
      const by = p[v1 * 3 + 1];
      const bz = p[v1 * 3 + 2];
      const qx = p[v2 * 3];
      const qy = p[v2 * 3 + 1];
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
          const at = l1 * ay + l2 * by + l3 * qy;
          const s = j * W + i;
          if (!(y[s] >= at)) y[s] = at;
        }
    }
  }
  return y;
}

export interface ShoreRims {
  pairs: number; // columns of land beside a column of water (each side counted)
  rims: number;
  rimEighths: number; // the tallest rim over the lowest land behind it
  level: number; // the water beside at or above the land's top
}

export function shoreRims(k: number): ShoreRims {
  const I = LOOK_ISLANDS[k];
  const was = { ...GRAPHICS };
  try {
    for (const [f, on] of Object.entries(PRESETS.high)) GRAPHICS[f as LooksFlag] = on;
    const world = generateWorld(I.cells, I.cells, I.seed, I.land);
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
    // Five places along the shore: dry cells by water, in reading order, at a sixth of the way each.
    const shore: [number, number][] = [];
    for (let y = 12; y < world.h - 12; y++)
      for (let x = 12; x < world.w - 12; x++) {
        const i = y * world.w + x;
        if (!wet[i] && (wet[i + 1] || wet[i - 1] || wet[i + world.w] || wet[i - world.w])) shore.push([x, y]);
      }
    const out: ShoreRims = { pairs: 0, rims: 0, rimEighths: 0, level: 0 };
    const W = world.w * SUB;
    for (const q of [0.15, 0.35, 0.5, 0.65, 0.85]) {
      const [cx, cy] = shore[Math.floor(shore.length * q)];
      terrain.focus(cx - world.w / 2, 20, cy - world.h / 2, cx - world.w / 2, cy - world.h / 2);
      terrain.updateFine(0, true);
      const L = surface(world, meshes, land);
      const F = surface(world, meshes, fluid);
      const water = (s: number) => !Number.isNaN(F[s]) && (Number.isNaN(L[s]) || F[s] > L[s] + 1e-4);
      const dry = (s: number) => !Number.isNaN(L[s]) && !water(s);
      for (let j = (cy - 8) * SUB; j < (cy + 8) * SUB; j++)
        for (let i = (cx - 8) * SUB; i < (cx + 8) * SUB; i++) {
          const s = j * W + i;
          if (!dry(s)) continue;
          for (const step of [1, -1, W, -W]) {
            const n = s + step;
            if (!water(n)) continue;
            out.pairs++;
            // Not at a cliff's foot (a river falling off a plateau, its side seen over the land).
            if (F[n] >= L[s] - 1e-3 && F[n] <= L[s] + LOW) out.level++;
            let low = Infinity;
            for (let b = 1; b <= BEHIND && dry(s - b * step); b++) low = Math.min(low, L[s - b * step]);
            if (low < F[n] && low >= F[n] - LOW && low < L[s] - 1e-3) {
              out.rims++;
              out.rimEighths = Math.max(out.rimEighths, Math.round((L[s] - low) * SUB));
            }
          }
        }
    }
    return out;
  } finally {
    Object.assign(GRAPHICS, was);
  }
}

export function shoreRimChecks(check: Check): void {
  for (const k of [0, 2]) {
    const name = LOOK_ISLANDS[k].name;
    const r = shoreRims(k);
    check(
      `shores (${name}): no rim of land at the water's edge with low ground behind it under the water`,
      r.pairs > 1000 && r.rims <= r.pairs * 0.01,
      `${r.rims} of ${r.pairs} shore columns, the tallest ${r.rimEighths} eighths over the ground behind`,
    );
    check(
      `shores (${name}): the water lies under the land beside it, not level with it or over it`,
      r.level <= r.pairs * 0.05,
      `${r.level} of ${r.pairs} shore columns with the water beside at or over the land's top`,
    );
  }
}
