import { BufferAttribute, BufferGeometry, Mesh, type Material } from "three";
import { F, G } from "../materials";
import type { World } from "../world";
import { FACE_LIGHT } from "./models";

// The island as voxel columns. Each cell is one column whose top sits at its
// height (half a unit per height unit, rounded to whole voxels). Walls are
// only built where a neighbor is lower; at the island's edge they go all the
// way down to the bottom, cut in layers of soil and stone like a diorama.
// The island is split in chunks, and a chunk is rebuilt only when one of its
// columns changes.

export const CHUNK = 32;
export const BOTTOM = -7;
export const V = 0.5; // scene units per height unit

export function columnTop(world: World, i: number): number {
  return Math.max(BOTTOM + 2, Math.round(world.height[i] * V));
}

export function surfaceY(world: World, i: number): number {
  return world.fluid[i] !== F.NONE && world.depth[i] > 0.02 ? (world.height[i] + world.depth[i]) * V : columnTop(world, i);
}

const STRATA = { dirt: 0x7a5a3a, clay: 0x8f6a45, stone: 0x6f6f78, deep: 0x4a4752 };

interface ChunkMeshes {
  land: Mesh | null;
  fluid: Mesh | null;
}

export class Terrain {
  readonly cols: number;
  readonly rows: number;
  private chunks: ChunkMeshes[];
  private landSig: Uint32Array;
  private fluidSig: Uint32Array;
  private dirtyLand = new Set<number>();
  private dirtyFluid = new Set<number>();
  coversChanged = true;

  constructor(
    private world: World,
    private landMaterial: Material,
    private fluidMaterial: Material,
    private add: (m: Mesh) => void,
    private remove: (m: Mesh) => void,
  ) {
    this.cols = Math.ceil(world.w / CHUNK);
    this.rows = Math.ceil(world.h / CHUNK);
    this.chunks = Array.from({ length: this.cols * this.rows }, () => ({ land: null, fluid: null }));
    this.landSig = new Uint32Array(world.n).fill(0xffffffff);
    this.fluidSig = new Uint32Array(world.n).fill(0xffffffff);
  }

  // Compares every column with what was last drawn and marks chunks to rebuild.
  scan(): void {
    const { world } = this;
    const { w, n } = world;
    for (let i = 0; i < n; i++) {
      const land = ((columnTop(world, i) + 64) & 0xff) | (world.ground[i] << 8) | (world.cover[i] << 16);
      const f = world.fluid[i];
      const fluid = f === F.NONE || world.depth[i] <= 0.02 ? 0 : (f << 24) | (Math.round(surfaceY(world, i) * 8) & 0xffffff);
      if (land !== this.landSig[i]) {
        if ((land & 0xffff) !== (this.landSig[i] & 0xffff)) this.markAround(this.dirtyLand, i % w, Math.floor(i / w));
        if (land >>> 16 !== this.landSig[i] >>> 16 || (land & 0xff) !== (this.landSig[i] & 0xff)) this.coversChanged = true;
        this.landSig[i] = land;
        // Water sits on the land: a new floor height moves its walls too.
        this.markAround(this.dirtyFluid, i % w, Math.floor(i / w));
      }
      if (fluid !== this.fluidSig[i]) {
        this.fluidSig[i] = fluid;
        this.markAround(this.dirtyFluid, i % w, Math.floor(i / w));
      }
    }
  }

  // A column's walls depend on its neighbors, so a change near a chunk border dirties both chunks.
  private markAround(set: Set<number>, x: number, y: number): void {
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    set.add(cy * this.cols + cx);
    const lx = x % CHUNK;
    const ly = y % CHUNK;
    if (lx === 0 && cx > 0) set.add(cy * this.cols + cx - 1);
    if (lx === CHUNK - 1 && cx < this.cols - 1) set.add(cy * this.cols + cx + 1);
    if (ly === 0 && cy > 0) set.add((cy - 1) * this.cols + cx);
    if (ly === CHUNK - 1 && cy < this.rows - 1) set.add((cy + 1) * this.cols + cx);
  }

  // Rebuilds a few chunks per frame; everything when `all` (first frame).
  rebuild(all = false): void {
    const budget = all ? Infinity : 3;
    let done = 0;
    for (const c of this.dirtyLand) {
      if (done++ >= budget) break;
      this.dirtyLand.delete(c);
      this.swap(c, "land", this.buildLand(c));
    }
    done = 0;
    for (const c of this.dirtyFluid) {
      if (done++ >= budget * 2) break;
      this.dirtyFluid.delete(c);
      this.swap(c, "fluid", this.buildFluid(c));
    }
  }

  private swap(c: number, kind: "land" | "fluid", geometry: BufferGeometry | null): void {
    const chunk = this.chunks[c];
    const old = chunk[kind];
    if (old) {
      this.remove(old);
      old.geometry.dispose();
    }
    chunk[kind] = null;
    if (!geometry) return;
    const mesh = new Mesh(geometry, kind === "land" ? this.landMaterial : this.fluidMaterial);
    mesh.matrixAutoUpdate = false;
    if (kind === "fluid") mesh.renderOrder = 2;
    chunk[kind] = mesh;
    this.add(mesh);
  }

  private bounds(c: number) {
    const cx = c % this.cols;
    const cy = Math.floor(c / this.cols);
    return { x0: cx * CHUNK, y0: cy * CHUNK, x1: Math.min(this.world.w, (cx + 1) * CHUNK), y1: Math.min(this.world.h, (cy + 1) * CHUNK) };
  }

  private buildLand(c: number): BufferGeometry | null {
    const { world } = this;
    const { w, h } = world;
    const { x0, y0, x1, y1 } = this.bounds(c);
    const pos: number[] = [];
    const col: number[] = [];
    const ox = -w / 2;
    const oz = -h / 2;
    const quad = (p: number[][], color: number, light: number) => {
      const r = ((color >> 16) & 255) / 255;
      const g = ((color >> 8) & 255) / 255;
      const b = (color & 255) / 255;
      for (const k of [0, 1, 2, 0, 2, 3]) {
        pos.push(p[k][0], p[k][1], p[k][2]);
        col.push(r * light, g * light, b * light);
      }
    };
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        const top = columnTop(world, i);
        const X = x + ox;
        const Z = y + oz;
        const surface = this.topColor(i);
        // A little ambient occlusion: a top next to a taller column is darker.
        let ao = 1;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
          if (j >= 0 && columnTop(world, j) > top) ao -= 0.07;
        }
        quad([[X, top, Z], [X, top, Z + 1], [X + 1, top, Z + 1], [X + 1, top, Z]], surface, FACE_LIGHT.top * ao);
        // Walls toward lower neighbors; outside the island counts as the bottom.
        const walls: [number, number, number, number[][]][] = [
          [x + 1, y, FACE_LIGHT.east, [[X + 1, 0, Z], [X + 1, 1, Z], [X + 1, 1, Z + 1], [X + 1, 0, Z + 1]]],
          [x, y + 1, FACE_LIGHT.south, [[X, 0, Z + 1], [X + 1, 0, Z + 1], [X + 1, 1, Z + 1], [X, 1, Z + 1]]],
          [x - 1, y, FACE_LIGHT.west, [[X, 0, Z], [X, 0, Z + 1], [X, 1, Z + 1], [X, 1, Z]]],
          [x, y - 1, FACE_LIGHT.north, [[X, 0, Z], [X, 1, Z], [X + 1, 1, Z], [X + 1, 0, Z]]],
        ];
        for (const [nx, ny, light, shape] of walls) {
          const edge = nx < 0 || ny < 0 || nx >= w || ny >= h;
          const low = edge ? BOTTOM : columnTop(world, ny * w + nx);
          if (low >= top) continue;
          // Layers from the top: the surface color for one voxel, then soil, then stone.
          const bands: [number, number, number][] = [];
          const built = this.builtColor(i);
          if (built !== null) {
            // A built column (a trunk, a tower, a crystal spire) is its material all the way down.
            bands.push([low, top, built]);
          } else {
            const soil = this.soilColor(i);
            bands.push([Math.max(low, top - 1), top, this.sideTopColor(i, surface)]);
            if (top - 1 > low) bands.push([Math.max(low, top - 3), top - 1, soil]);
            if (top - 3 > low) bands.push([Math.max(low, BOTTOM + 2), top - 3, STRATA.stone]);
            if (BOTTOM + 2 > low) bands.push([low, Math.min(top - 3, BOTTOM + 2), STRATA.deep]);
          }
          for (const [a, b, color] of bands) {
            if (b <= a) continue;
            // Deeper walls are a bit darker.
            const depthShade = 1 - Math.min(0.25, (top - b) * 0.03);
            quad(shape.map(([px, py, pz]) => [px, py === 0 ? a : b, pz]), color, light * depthShade);
          }
        }
      }
    }
    if (!pos.length) return null;
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
    g.computeBoundingSphere();
    return g;
  }

  private buildFluid(c: number): BufferGeometry | null {
    const { world } = this;
    const { w, h } = world;
    const { x0, y0, x1, y1 } = this.bounds(c);
    const pos: number[] = [];
    const col: number[] = [];
    const ox = -w / 2;
    const oz = -h / 2;
    const quad = (p: number[][], color: number, alpha: number, light: number) => {
      const r = ((color >> 16) & 255) / 255;
      const g = ((color >> 8) & 255) / 255;
      const b = (color & 255) / 255;
      for (const k of [0, 1, 2, 0, 2, 3]) {
        pos.push(p[k][0], p[k][1], p[k][2]);
        col.push(r * light, g * light, b * light, alpha);
      }
    };
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        const f = world.fluid[i];
        if (f === F.NONE || world.depth[i] <= 0.02) continue;
        const top = surfaceY(world, i);
        const { color, alpha } = this.fluidColor(i);
        const X = x + ox;
        const Z = y + oz;
        quad([[X, top, Z], [X, top, Z + 1], [X + 1, top, Z + 1], [X + 1, top, Z]], color, alpha, 1);
        const walls: [number, number, number, number[][]][] = [
          [x + 1, y, FACE_LIGHT.east, [[X + 1, 0, Z], [X + 1, 1, Z], [X + 1, 1, Z + 1], [X + 1, 0, Z + 1]]],
          [x, y + 1, FACE_LIGHT.south, [[X, 0, Z + 1], [X + 1, 0, Z + 1], [X + 1, 1, Z + 1], [X, 1, Z + 1]]],
          [x - 1, y, FACE_LIGHT.west, [[X, 0, Z], [X, 0, Z + 1], [X, 1, Z + 1], [X, 1, Z]]],
          [x, y - 1, FACE_LIGHT.north, [[X, 0, Z], [X, 1, Z], [X + 1, 1, Z], [X + 1, 0, Z]]],
        ];
        for (const [nx, ny, light, shape] of walls) {
          const edge = nx < 0 || ny < 0 || nx >= w || ny >= h;
          // At the island's edge the water spills over: a waterfall to the bottom.
          const low = edge ? BOTTOM - 4 : Math.max(columnTop(world, ny * w + nx), surfaceY(world, ny * w + nx));
          if (low >= top - 0.01) continue;
          quad(shape.map(([px, py, pz]) => [px, py === 0 ? low : top, pz]), color, edge ? alpha * 0.8 : alpha, light);
        }
      }
    }
    if (!pos.length) return null;
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(col), 4));
    g.computeBoundingSphere();
    return g;
  }

  private topColor(i: number): number {
    const { world } = this;
    const m = world.materials.get("ground", world.ground[i]);
    const base = m.colors[((world.shade[i] * m.colors.length) >> 8) % m.colors.length];
    // Higher land is a touch lighter, so hills read even from above.
    return scale(base, 0.92 + Math.min(0.16, Math.max(0, world.height[i] - 8) * 0.006));
  }

  // The first voxel of a wall: green grass edge, white snow edge, or the surface itself.
  private sideTopColor(i: number, surface: number): number {
    const g = this.world.ground[i];
    if (g === G.GRASS || g === G.FIELD) return scale(surface, 0.9);
    return surface;
  }

  // Natural ground shows soil and stone in its walls; built materials do not.
  private builtColor(i: number): number | null {
    const g = this.world.ground[i];
    if (g === G.GRASS || g === G.DIRT || g === G.SAND || g === G.SNOW || g === G.ASH || g === G.FIELD || g === G.ROCK) return null;
    const m = this.world.materials.get("ground", g);
    return scale(m.colors[(this.world.shade[i] >> 4) % m.colors.length], 0.92);
  }

  private soilColor(i: number): number {
    const g = this.world.ground[i];
    if (g === G.SAND) return 0xc9b07a;
    if (g === G.ROCK || g === G.BASALT || g === G.SNOW) return STRATA.stone;
    return (this.world.shade[i] & 1) === 0 ? STRATA.dirt : STRATA.clay;
  }

  private fluidColor(i: number): { color: number; alpha: number } {
    const { world } = this;
    const f = world.fluid[i];
    const d = world.depth[i];
    if (f === F.WATER) {
      const k = Math.min(1, d / 5);
      return { color: mixColor(0x5cc0f0, 0x1d5d9e, k), alpha: 0.72 + k * 0.2 };
    }
    const m = world.materials.get("fluid", f);
    const color = m.colors[world.shade[i] % m.colors.length];
    if (f === F.LAVA) return { color, alpha: 1 };
    if (f === F.ICE) return { color, alpha: 0.95 };
    if (f === F.ACID) return { color, alpha: 0.85 };
    return { color, alpha: 0.95 };
  }
}

export function scale(c: number, k: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
  const b = Math.min(255, Math.round((c & 255) * k));
  return (r << 16) | (g << 8) | b;
}

export function mixColor(a: number, b: number, k: number): number {
  const r = ((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k;
  const g = ((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k;
  const bl = (a & 255) * (1 - k) + (b & 255) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
