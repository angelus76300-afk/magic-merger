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
        // Water sits on the land: only a new floor height moves its walls.
        if ((land & 0xff) !== (this.landSig[i] & 0xff)) this.markAround(this.dirtyFluid, i % w, Math.floor(i / w));
        this.landSig[i] = land;
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

  // Rebuilds dirty chunks for up to a few milliseconds per frame (at least
  // one of each kind), so a big fire never stalls a frame; everything when
  // `all` (first frame).
  rebuild(all = false): void {
    const until = all ? Infinity : performance.now() + 3;
    let first = true;
    for (const c of this.dirtyLand) {
      if (!first && performance.now() > until) break;
      first = false;
      this.dirtyLand.delete(c);
      this.swap(c, "land", this.buildLand(c));
    }
    first = true;
    for (const c of this.dirtyFluid) {
      if (!first && performance.now() > until) break;
      first = false;
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

  // Column tops of a chunk and a one cell border, read once per build.
  private tops(x0: number, y0: number, x1: number, y1: number): { top: (x: number, y: number) => number } {
    const { world } = this;
    const bw = x1 - x0 + 2;
    const arr = (this.topsBuf = this.topsBuf.length >= bw * (y1 - y0 + 2) ? this.topsBuf : new Int16Array(bw * (y1 - y0 + 2)));
    for (let y = y0 - 1; y <= y1; y++) {
      for (let x = x0 - 1; x <= x1; x++) {
        const inside = x >= 0 && y >= 0 && x < world.w && y < world.h;
        arr[(y - y0 + 1) * bw + (x - x0 + 1)] = inside ? columnTop(world, y * world.w + x) : BOTTOM;
      }
    }
    return { top: (x, y) => arr[(y - y0 + 1) * bw + (x - x0 + 1)] };
  }
  private topsBuf = new Int16Array(0);

  private buildLand(c: number): BufferGeometry | null {
    const { world } = this;
    const { w, h } = world;
    const { x0, y0, x1, y1 } = this.bounds(c);
    const { top: topAt } = this.tops(x0, y0, x1, y1);
    const out = LAND;
    out.reset();
    const ox = -w / 2;
    const oz = -h / 2;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        const top = topAt(x, y);
        const X = x + ox;
        const Z = y + oz;
        const surface = this.topColor(i);
        // A little ambient occlusion: a top next to a taller column is darker.
        let ao = 1;
        if (topAt(x - 1, y) > top && x > 0) ao -= 0.07;
        if (topAt(x + 1, y) > top && x < w - 1) ao -= 0.07;
        if (topAt(x, y - 1) > top && y > 0) ao -= 0.07;
        if (topAt(x, y + 1) > top && y < h - 1) ao -= 0.07;
        out.face(TOP, X, Z, top, top, surface, FACE_LIGHT.top * ao, 1);
        // Walls toward lower neighbors; outside the island counts as the bottom.
        for (let d = 0; d < 4; d++) {
          const low = topAt(x + DX[d], y + DY[d]);
          if (low >= top) continue;
          const light = WALL_LIGHT[d];
          const built = this.builtColor(i);
          if (built !== null) {
            // A built column (a trunk, a tower, a crystal spire) is its material all the way down.
            out.face(d, X, Z, low, top, built, light * (1 - Math.min(0.25, 0)), 1);
            continue;
          }
          // Layers from the top: the surface color for one voxel, then soil, then stone.
          const soil = this.soilColor(i);
          band(out, d, X, Z, Math.max(low, top - 1), top, top, this.sideTopColor(i, surface), light);
          if (top - 1 > low) band(out, d, X, Z, Math.max(low, top - 3), top - 1, top, soil, light);
          if (top - 3 > low) band(out, d, X, Z, Math.max(low, BOTTOM + 2), top - 3, top, STRATA.stone, light);
          if (BOTTOM + 2 > low) band(out, d, X, Z, low, Math.min(top - 3, BOTTOM + 2), top, STRATA.deep, light);
        }
      }
    }
    return out.geometry(3);
  }

  private buildFluid(c: number): BufferGeometry | null {
    const { world } = this;
    const { w, h } = world;
    const { x0, y0, x1, y1 } = this.bounds(c);
    const out = FLUID;
    out.reset();
    const ox = -w / 2;
    const oz = -h / 2;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        const f = world.fluid[i];
        if (f === F.NONE || world.depth[i] <= 0.02) continue;
        const top = surfaceY(world, i);
        const { color, alpha } = this.fluidColor(i);
        const X = x + ox;
        const Z = y + oz;
        out.face(TOP, X, Z, top, top, color, 1, alpha);
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d];
          const ny = y + DY[d];
          const edge = nx < 0 || ny < 0 || nx >= w || ny >= h;
          // At the island's edge the water spills over: a waterfall to the bottom.
          const j = ny * w + nx;
          const low = edge ? BOTTOM - 4 : Math.max(columnTop(world, j), surfaceY(world, j));
          if (low >= top - 0.01) continue;
          out.face(d, X, Z, low, top, color, WALL_LIGHT[d], edge ? alpha * 0.8 : alpha);
        }
      }
    }
    return out.geometry(4);
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

// Face directions: the four walls, then the top.
const EAST = 0;
const SOUTH = 1;
const WEST = 2;
const NORTH = 3;
const TOP = 4;
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const WALL_LIGHT = [FACE_LIGHT.east, FACE_LIGHT.south, FACE_LIGHT.west, FACE_LIGHT.north];

// A reusable vertex writer: typed arrays that grow when needed, so building a
// chunk allocates nothing per vertex.
class Writer {
  private pos = new Float32Array(3 * 6 * 4096);
  private col = new Float32Array(4 * 6 * 4096);
  private n = 0;

  reset(): void {
    this.n = 0;
  }

  private grow(): void {
    const pos = new Float32Array(this.pos.length * 2);
    pos.set(this.pos);
    this.pos = pos;
    const col = new Float32Array(this.col.length * 2);
    col.set(this.col);
    this.col = col;
  }

  private vertex(x: number, y: number, z: number, r: number, g: number, b: number, a: number): void {
    const n = this.n++;
    this.pos[n * 3] = x;
    this.pos[n * 3 + 1] = y;
    this.pos[n * 3 + 2] = z;
    this.col[n * 4] = r;
    this.col[n * 4 + 1] = g;
    this.col[n * 4 + 2] = b;
    this.col[n * 4 + 3] = a;
  }

  // One square face of the cell at (X, Z): a wall from height lo to hi, or the
  // top at height hi. Two triangles, wound to face outward.
  face(dir: number, X: number, Z: number, lo: number, hi: number, color: number, light: number, alpha: number): void {
    if ((this.n + 6) * 4 > this.col.length) this.grow();
    const r = (((color >> 16) & 255) / 255) * light;
    const g = (((color >> 8) & 255) / 255) * light;
    const b = ((color & 255) / 255) * light;
    const v = (x: number, y: number, z: number) => this.vertex(x, y, z, r, g, b, alpha);
    // Corners a, b, c, d; triangles a b c and a c d.
    switch (dir) {
      case EAST:
        v(X + 1, lo, Z), v(X + 1, hi, Z), v(X + 1, hi, Z + 1), v(X + 1, lo, Z), v(X + 1, hi, Z + 1), v(X + 1, lo, Z + 1);
        break;
      case SOUTH:
        v(X, lo, Z + 1), v(X + 1, lo, Z + 1), v(X + 1, hi, Z + 1), v(X, lo, Z + 1), v(X + 1, hi, Z + 1), v(X, hi, Z + 1);
        break;
      case WEST:
        v(X, lo, Z), v(X, lo, Z + 1), v(X, hi, Z + 1), v(X, lo, Z), v(X, hi, Z + 1), v(X, hi, Z);
        break;
      case NORTH:
        v(X, lo, Z), v(X, hi, Z), v(X + 1, hi, Z), v(X, lo, Z), v(X + 1, hi, Z), v(X + 1, lo, Z);
        break;
      default:
        v(X, hi, Z), v(X, hi, Z + 1), v(X + 1, hi, Z + 1), v(X, hi, Z), v(X + 1, hi, Z + 1), v(X + 1, hi, Z);
    }
  }

  // A geometry with copies of what was written (the writer is reused).
  geometry(colorSize: 3 | 4): BufferGeometry | null {
    if (this.n === 0) return null;
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(this.pos.slice(0, this.n * 3), 3));
    let col: Float32Array;
    if (colorSize === 4) col = this.col.slice(0, this.n * 4);
    else {
      col = new Float32Array(this.n * 3);
      for (let k = 0; k < this.n; k++) {
        col[k * 3] = this.col[k * 4];
        col[k * 3 + 1] = this.col[k * 4 + 1];
        col[k * 3 + 2] = this.col[k * 4 + 2];
      }
    }
    g.setAttribute("color", new BufferAttribute(col, colorSize));
    g.computeBoundingSphere();
    return g;
  }
}

const LAND = new Writer();
const FLUID = new Writer();

// One layer of a wall, a bit darker the deeper it is below the top.
function band(out: Writer, dir: number, X: number, Z: number, lo: number, hi: number, top: number, color: number, light: number): void {
  if (hi <= lo) return;
  out.face(dir, X, Z, lo, hi, color, light * (1 - Math.min(0.25, (top - hi) * 0.03)), 1);
}
