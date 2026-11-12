import { BufferAttribute, BufferGeometry, Mesh, type Material } from "three";
import { BUILTIN, F, G, type Material as LandMaterial } from "../materials";
import type { World } from "../world";
import { FACE_LIGHT } from "./models";
import { mixColor, scaleColor } from "../colors";
import { GRAPHICS } from "./graphics";
import { LOOKS, biomeAt } from "../land";
import { DAMP, R as RARE } from "../ecology";

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

// The fluid's top. The land's top is rounded to whole voxels and the fluid's
// is not, so shallow water came out level with the sand or grass under it:
// two faces in one plane, which flicker through each other (sand speckled
// across the shallows on a phone, 4.2; 18 to 40% of wet cells on generated
// islands). A fluid's top is always at least FLUID_LIFT above its own land.
export const FLUID_LIFT = 0.06;
export function surfaceY(world: World, i: number): number {
  const top = columnTop(world, i);
  if (world.fluid[i] === F.NONE || world.depth[i] <= 0.02) return top;
  return Math.max((world.height[i] + world.depth[i]) * V, top + FLUID_LIFT);
}

const STRATA = { dirt: 0x7a5a3a, clay: 0x8f6a45, stone: 0x6f6f78, deep: 0x4a4752 };
const WATER: [number, number] = [0x5cc0f0, 0x1d5d9e];
// Light at a top's corner by how many of its three neighbors there (two
// sides and the diagonal) stand taller: the usual voxel ambient occlusion
// (both sides taller counts as fully hidden).
const AO_LIGHT = [0.62, 0.75, 0.88, 1];
// The foot of a wall, where it meets the land below, is in its crease.
const CREASE = 0.74;
const FOAM = 0xf2f9ff;

interface ChunkMeshes {
  land: Mesh | null;
  fluid: Mesh | null;
}

// For the measure of a big spell (scripts and the frame's own hook): the switch of the one frame
// redraw, and the longest run of frames with land left to redraw.
export const LAND_REDRAW = { burst: true, maxLag: 0, lastLag: 0 };
// Chunks changed at once from which the land is redrawn whole in one frame (rebuild).
const BURST_CHUNKS = 10;

export class Terrain {
  readonly cols: number;
  readonly rows: number;
  private chunks: ChunkMeshes[];
  private landSig: Uint32Array;
  private fluidSig: Uint32Array;
  // Each wet cell's surface as last drawn, and which cells are drawn wet (4.4).
  private fluidLevel: Float32Array;
  private wet: Uint8Array;
  private burstAt = -1e9;
  private lag = 0;
  private dirtyLand = new Set<number>();
  private dirtyFluid = new Set<number>();
  // Chunks to redraw only because water flowed (4.4): one every third frame
  // at most, so flowing rivers cost a steady fraction of a millisecond.
  private slowLand = new Set<number>();
  private slowFluid = new Set<number>();
  private slowTurn = 0;
  coversChanged = true;
  // The biome's cut sides and water (4.4); the old island's otherwise.
  private strata = STRATA;
  private water = WATER;

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
    this.fluidLevel = new Float32Array(world.n).fill(-1e9);
    this.wet = new Uint8Array(world.n);
    if (world.land) {
      this.strata = LOOKS[world.land.biome].strata;
      this.water = LOOKS[world.land.biome].water;
    }
  }

  // Compares every column with what was last drawn and marks chunks to rebuild.
  scan(): void {
    const { world } = this;
    const { w, n } = world;
    for (let i = 0; i < n; i++) {
      const f = world.fluid[i];
      // Wet with a margin (4.4): a thin film at a river's edge used to flip
      // wet and dry every tick, and rebuild its chunks each time.
      const wet = f !== F.NONE && world.depth[i] > (this.wet[i] ? WET_OFF : WET_ON);
      this.wet[i] = wet ? 1 : 0;
      // Bit 24: under fluid, where the land top takes no spell drawing (the fluid's top does).
      const land = (((columnTop(world, i) + 64) & 0xff) | (world.ground[i] << 8) | (world.cover[i] << 16) | (wet ? 1 << 24 : 0)) >>> 0;
      // A fluid's type and wetness; its level is compared with what was last
      // drawn, with a margin (4.4): a river's surface wobbles by hundredths
      // as it flows, and rounding it rebuilt its chunks every frame.
      const fluid = !wet ? 0 : (f << 24) | 1;
      const moved = wet && Math.abs(surfaceY(world, i) - this.fluidLevel[i]) > LEVEL_STEP;
      const was = this.landSig[i];
      if (land !== was) {
        // Only the wet bit changed: water flowing at a river's edge, redrawn
        // in the slow queue; anything else at once.
        const flowOnly = (land ^ was) === 1 << 24 && was !== 0xffffffff;
        if ((land & LAND_LOOK) !== (was & LAND_LOOK)) this.markAround(flowOnly ? this.slowLand : this.dirtyLand, i % w, Math.floor(i / w));
        if (((land >>> 16) & 0xff) !== ((this.landSig[i] >>> 16) & 0xff) || (land & 0xff) !== (this.landSig[i] & 0xff)) this.coversChanged = true;
        // Water sits on the land: only a new floor height moves its walls.
        if ((land & 0xff) !== (this.landSig[i] & 0xff)) this.markAround(this.dirtyFluid, i % w, Math.floor(i / w));
        this.landSig[i] = land;
      }
      if (fluid !== this.fluidSig[i] || moved) {
        // A new fluid (a spell's lava, a flood) is drawn at once; the same
        // fluid moving, or a film coming and going, in the slow queue.
        const same = fluid === this.fluidSig[i] || fluid === 0 || this.fluidSig[i] === 0;
        const flowOnly = same && this.fluidSig[i] !== 0xffffffff && (f === F.WATER || f === F.NONE);
        this.fluidSig[i] = fluid;
        this.fluidLevel[i] = wet ? surfaceY(world, i) : -1e9;
        this.markAround(flowOnly ? this.slowFluid : this.dirtyFluid, i % w, Math.floor(i / w));
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
    // A big spell changes the whole island at once (the owner's report, 11 November: "the
    // rendering is bad, like by sections, and doesn't update all at once"). Three milliseconds a
    // frame redraws it a few chunks at a time, for seconds. When many chunks changed in one go,
    // they are all redrawn in this frame: one long frame under the spell's flash instead of a
    // land that changes piece by piece. Not twice within a second, and with a larger share of
    // each frame while a backlog lasts, so a fire that spreads everywhere never stalls every frame.
    const now = performance.now();
    const backlog = this.dirtyLand.size + this.dirtyFluid.size;
    const burst = !all && LAND_REDRAW.burst && backlog >= BURST_CHUNKS && now - this.burstAt > 1000;
    if (burst) this.burstAt = now;
    const until = all || burst ? Infinity : now + (LAND_REDRAW.burst && backlog >= BURST_CHUNKS ? 8 : 3);
    // How many frames in a row the land had chunks left to redraw: what "by sections" is, counted.
    if (backlog > 0) this.lag++;
    else {
      if (this.lag > 0) LAND_REDRAW.lastLag = this.lag;
      this.lag = 0;
    }
    LAND_REDRAW.maxLag = Math.max(LAND_REDRAW.maxLag, this.lag);
    let first = true;
    for (const c of this.dirtyLand) {
      if (!first && performance.now() > until) break;
      first = false;
      this.dirtyLand.delete(c);
      this.slowLand.delete(c);
      this.swap(c, "land", this.buildLand(c));
    }
    first = true;
    for (const c of this.dirtyFluid) {
      if (!first && performance.now() > until) break;
      first = false;
      this.dirtyFluid.delete(c);
      this.slowFluid.delete(c);
      this.swap(c, "fluid", this.buildFluid(c));
    }
    // One chunk of the slow queue every third frame, land and water in turn,
    // if time is left.
    if (performance.now() > until || this.slowTurn++ % 3 !== 0) return;
    const land = this.slowTurn % 2 === 0;
    const queue = land ? this.slowLand : this.slowFluid;
    for (const c of queue) {
      queue.delete(c);
      if (land) {
        if (!this.dirtyLand.has(c)) this.swap(c, "land", this.buildLand(c));
      } else if (!this.dirtyFluid.has(c)) this.swap(c, "fluid", this.buildFluid(c));
      break;
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
        const decal = this.wet[i] ? 0 : 1;
        if (GRAPHICS.ao) {
          // Ambient occlusion per corner (4.4): (x, y) is the corner shared
          // with the cells up and left of it, and so on round the top.
          const t = (dx: number, dy: number) => (topAt(x + dx, y + dy) > top ? 1 : 0);
          const corner = (s1: number, s2: number, c: number) => AO_LIGHT[s1 && s2 ? 0 : 3 - s1 - s2 - c] * FACE_LIGHT.top;
          const l = CORNERS;
          l[0] = corner(t(-1, 0), t(0, -1), t(-1, -1));
          l[1] = corner(t(-1, 0), t(0, 1), t(-1, 1));
          l[2] = corner(t(1, 0), t(0, 1), t(1, 1));
          l[3] = corner(t(1, 0), t(0, -1), t(1, -1));
          out.top(X, Z, top, surface, l, ONES, decal, null);
        } else {
          // A little ambient occlusion: a top next to a taller column is darker.
          let ao = 1;
          if (topAt(x - 1, y) > top && x > 0) ao -= 0.07;
          if (topAt(x + 1, y) > top && x < w - 1) ao -= 0.07;
          if (topAt(x, y - 1) > top && y > 0) ao -= 0.07;
          if (topAt(x, y + 1) > top && y < h - 1) ao -= 0.07;
          out.face(TOP, X, Z, top, top, surface, FACE_LIGHT.top * ao, 1, decal);
        }
        // Walls toward lower neighbors; outside the island counts as the bottom.
        for (let d = 0; d < 4; d++) {
          const low = topAt(x + DX[d], y + DY[d]);
          if (low >= top) continue;
          const light = WALL_LIGHT[d];
          // The foot of a wall inside the island sits in a crease.
          const foot = GRAPHICS.ao && low > BOTTOM ? CREASE : 1;
          const built = this.builtColor(i);
          if (built !== null) {
            // A built column (a trunk, a tower, a crystal spire) is its material all the way down.
            out.face(d, X, Z, low, top, built, light, 1, 0, foot);
            continue;
          }
          // Layers from the top: the surface color for one voxel, then soil, then stone.
          let soil = this.soilColor(i);
          let edge = this.sideTopColor(i, surface);
          // Moss on the north faces of damp ground (4.4.5).
          if (d === 3 && world.flora && world.flora[i] & DAMP && (world.ground[i] === G.GRASS || world.ground[i] === G.ROCK || world.ground[i] === G.DIRT)) {
            edge = mixColor(edge, MOSS, 0.5);
            soil = mixColor(soil, MOSS, 0.4);
          }
          const strata = this.strataAt(i);
          band(out, d, X, Z, Math.max(low, top - 1), top, top, edge, light, low, foot);
          if (top - 1 > low) band(out, d, X, Z, Math.max(low, top - 3), top - 1, top, soil, light, low, foot);
          if (top - 3 > low) band(out, d, X, Z, Math.max(low, BOTTOM + 2), top - 3, top, strata.stone, light, low, foot);
          if (BOTTOM + 2 > low) band(out, d, X, Z, low, Math.min(top - 3, BOTTOM + 2), top, strata.deep, light, low, foot);
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
        if (f === F.NONE || !this.wet[i]) continue;
        const top = Math.max(surfaceY(world, i), columnTop(world, i) + FLUID_LIFT);
        this.fluidLevel[i] = top;
        const { color, alpha } = this.fluidColor(i);
        const X = x + ox;
        const Z = y + oz;
        if (GRAPHICS.water && f === F.WATER) this.waterTop(out, x, y, X, Z, top, color, alpha);
        else out.face(TOP, X, Z, top, top, color, 1, alpha, 1);
        const floor = columnTop(world, i);
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d];
          const ny = y + DY[d];
          const edge = nx < 0 || ny < 0 || nx >= w || ny >= h;
          if (edge) {
            // At the island's edge the water spills over: a waterfall to the
            // bottom, a little in front of the cut side so the two faces do
            // not lie in the same plane and flicker through each other.
            out.face(d, X + DX[d] * FALL_GAP, Z + DY[d] * FALL_GAP, BOTTOM - 4, top, color, WALL_LIGHT[d], alpha * 0.8, 0);
            continue;
          }
          // Inside the island the water's wall starts on its own floor: below
          // that, the land's wall is there already, in the same plane.
          const j = ny * w + nx;
          const low = Math.max(floor, columnTop(world, j), surfaceY(world, j));
          if (low >= top - 0.01) continue;
          out.face(d, X, Z, low, top, color, WALL_LIGHT[d], alpha, 0);
        }
      }
    }
    return out.geometry(4, GRAPHICS.water);
  }

  // A water top (4.4): foam at the corners that touch the shore, waves away
  // from it. A corner's wave is the smallest of the four cells around it, so
  // two tops that share a corner move it the same way and never open a gap,
  // and water against a wall or the shore stays still.
  private waterTop(out: Writer, x: number, y: number, X: number, Z: number, top: number, color: number, alpha: number): void {
    const { world } = this;
    const foam = FOAMS;
    const wave = WAVES;
    const alphas = ALPHAS;
    const colors = COLORS;
    for (let k = 0; k < 4; k++) {
      const [cx, cy] = CORNER_CELLS[k];
      let shore = 0;
      let calm = 1;
      // 4.4.5 part C (the owner: "the sea looks weird"): each corner takes the
      // mean color and clearness of the water cells round it, the same for
      // every top that shares it, so depth shades smoothly and not in tiles.
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let wetCells = 0;
      // 4.4.5 part C: judged from the four cells round the corner only, never
      // against this top's own level: on a river sloping 0.03 a cell, two tops
      // sharing a corner disagreed and opened a hairline gap.
      let lo = Infinity;
      let hi = -Infinity;
      for (const [dx, dy] of CORNER_AROUND[k]) {
        const nx = x + cx + dx;
        const ny = y + cy + dy;
        if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) {
          calm = 0;
          continue;
        }
        const j = ny * world.w + nx;
        const wet = world.fluid[j] === F.WATER && this.wet[j] === 1;
        if (!wet) {
          if (!this.wet[j]) shore = 1;
          calm = 0;
          continue;
        }
        const s = surfaceY(world, j);
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
        const fc = j === y * world.w + x ? { color, alpha } : this.fluidColor(j);
        r += (fc.color >> 16) & 255;
        g += (fc.color >> 8) & 255;
        b += fc.color & 255;
        a += fc.alpha;
        wetCells++;
        calm = Math.min(calm, Math.min(1, Math.max(0, (world.depth[j] - 0.3) / 1.2)));
      }
      if (hi - lo > 0.02) calm = 0;
      foam[k] = shore;
      wave[k] = calm;
      const mean = wetCells ? a / wetCells : alpha;
      colors[k] = wetCells ? (Math.round(r / wetCells) << 16) | (Math.round(g / wetCells) << 8) | Math.round(b / wetCells) : color;
      alphas[k] = shore ? Math.min(0.95, mean + 0.2) : mean;
    }
    out.topFoam(X, Z, top, colors, foam, alphas, wave);
  }

  private topColor(i: number): number {
    const { world } = this;
    const m = world.materials.get("ground", world.ground[i]);
    const colors = this.colorsAt(i, world.ground[i], m);
    const base = colors[((world.shade[i] * colors.length) >> 8) % colors.length];
    // Higher land is a touch lighter, so hills read even from above.
    return scaleColor(base, 0.92 + Math.min(0.16, Math.max(0, world.height[i] - 8) * 0.006));
  }

  // A built-in ground's colors in this cell's region on a mixed island
  // (4.4.1): the world's table holds the main biome's.
  private colorsAt(i: number, id: number, m: LandMaterial): number[] {
    const { world } = this;
    // 4.4.5: salt flats are white.
    if (id === G.SAND && world.rare?.[i] === RARE.SALT) return SALT;
    if (!world.biomeMap || id >= BUILTIN.ground.length) return m.colors;
    return LOOKS[biomeAt(world, i)].palette[m.name] ?? BUILTIN.ground[id].colors;
  }

  // The cut sides and water of this cell's region on a mixed island.
  private strataAt(i: number): typeof STRATA {
    return this.world.biomeMap ? LOOKS[biomeAt(this.world, i)].strata : this.strata;
  }

  private waterAt(i: number): [number, number] {
    return this.world.biomeMap ? LOOKS[biomeAt(this.world, i)].water : this.water;
  }

  // The first voxel of a wall: green grass edge, white snow edge, or the surface itself.
  private sideTopColor(i: number, surface: number): number {
    const g = this.world.ground[i];
    if (g === G.GRASS || g === G.FIELD) return scaleColor(surface, 0.9);
    return surface;
  }

  // Natural ground shows soil and stone in its walls; built materials do not.
  private builtColor(i: number): number | null {
    const g = this.world.ground[i];
    if (g === G.GRASS || g === G.DIRT || g === G.SAND || g === G.SNOW || g === G.ASH || g === G.FIELD || g === G.ROCK) return null;
    const m = this.world.materials.get("ground", g);
    return scaleColor(m.colors[(this.world.shade[i] >> 4) % m.colors.length], 0.92);
  }

  private soilColor(i: number): number {
    const g = this.world.ground[i];
    if (g === G.SAND) return this.world.land ? scaleColor(this.colorsAt(i, G.SAND, this.world.materials.get("ground", G.SAND))[0], 0.9) : 0xc9b07a;
    const strata = this.strataAt(i);
    if (g === G.ROCK || g === G.BASALT || g === G.SNOW) return strata.stone;
    return (this.world.shade[i] & 1) === 0 ? strata.dirt : strata.clay;
  }

  private fluidColor(i: number): { color: number; alpha: number } {
    const { world } = this;
    const f = world.fluid[i];
    const d = world.depth[i];
    if (f === F.WATER) {
      if (GRAPHICS.water) {
        // Clear and light in the shallows, darker quickly with depth (4.4).
        // 4.4.5 part C: nearly opaque past four voxels, so the seabed's steps
        // no longer show through the open sea as a grid.
        const k = Math.sqrt(Math.min(1, d / 6));
        const water = this.waterAt(i);
        return { color: mixColor(water[0], water[1], k), alpha: Math.min(0.97, 0.58 + Math.sqrt(Math.min(1, d / 4)) * 0.4) };
      }
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

// A top's corners in the order Writer.top takes them: (X, Z), (X, Z + 1),
// (X + 1, Z + 1), (X + 1, Z); for each, the cell offset of the corner point
// and the four cells around it relative to that.
const CORNER_CELLS: [number, number][] = [
  [0, 0],
  [0, 1],
  [1, 1],
  [1, 0],
];
const CORNER_AROUND: [number, number][][] = Array.from({ length: 4 }, () => [
  [-1, -1],
  [0, -1],
  [-1, 0],
  [0, 0],
]);
const CORNERS = [1, 1, 1, 1];
// A top's two triangles, by corner: split along (X, Z) to (X + 1, Z + 1), or
// along the other diagonal.
const SQUARE = [0, 1, 2, 0, 2, 3];
const FLIPPED = [1, 2, 3, 1, 3, 0];
const ONES = [1, 1, 1, 1];
const FOAMS = [0, 0, 0, 0];
const WAVES = [0, 0, 0, 0];
const ALPHAS = [1, 1, 1, 1];
const COLORS = [0, 0, 0, 0];

// Face directions: the four walls, then the top.
const EAST = 0;
const SOUTH = 1;
const WEST = 2;
const NORTH = 3;
const TOP = 4;
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const WALL_LIGHT = [FACE_LIGHT.east, FACE_LIGHT.south, FACE_LIGHT.west, FACE_LIGHT.north];
// Height, ground and the wet bit of a column's land signature: what its faces look like.
const LAND_LOOK = 0x100ffff;
// How far a fluid's surface moves before it is drawn again (scene units: an
// eighth of a voxel was the old rounding step).
const LEVEL_STEP = 0.15;
// Depths at which a cell starts and stops being drawn wet.
const WET_ON = 0.06;
const WET_OFF = 0.005;
// How far a waterfall hangs in front of the island's cut side, in cells.
const FALL_GAP = 0.06;

// A reusable vertex writer: typed arrays that grow when needed, so building a
// chunk allocates nothing per vertex.
class Writer {
  private pos = new Float32Array(3 * 6 * 4096);
  private col = new Float32Array(4 * 6 * 4096);
  // 1 where spell drawings may show (dry land tops, fluid tops), 0 on walls.
  private mask = new Float32Array(6 * 4096);
  // How much a vertex rides the waves (water tops, 4.4).
  private wave = new Float32Array(6 * 4096);
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
    const mask = new Float32Array(this.mask.length * 2);
    mask.set(this.mask);
    this.mask = mask;
    const wave = new Float32Array(this.wave.length * 2);
    wave.set(this.wave);
    this.wave = wave;
  }

  private vertex(x: number, y: number, z: number, r: number, g: number, b: number, a: number, m: number, wave = 0): void {
    const n = this.n++;
    this.mask[n] = m;
    this.wave[n] = wave;
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
  // `foot` scales the light of the wall's lower edge (its crease, 4.4).
  face(dir: number, X: number, Z: number, lo: number, hi: number, color: number, light: number, alpha: number, decal = 0, foot = 1): void {
    if ((this.n + 6) * 4 > this.col.length) this.grow();
    const r = (((color >> 16) & 255) / 255) * light;
    const g = (((color >> 8) & 255) / 255) * light;
    const b = ((color & 255) / 255) * light;
    const v = (x: number, y: number, z: number) =>
      foot !== 1 && y === lo ? this.vertex(x, y, z, r * foot, g * foot, b * foot, alpha, decal) : this.vertex(x, y, z, r, g, b, alpha, decal);
    // Corners a, b, c, d; triangles a b c and a c d.
    switch (dir) {
      case EAST:
        v(X + 1, lo, Z);
        v(X + 1, hi, Z);
        v(X + 1, hi, Z + 1);
        v(X + 1, lo, Z);
        v(X + 1, hi, Z + 1);
        v(X + 1, lo, Z + 1);
        break;
      case SOUTH:
        v(X, lo, Z + 1);
        v(X + 1, lo, Z + 1);
        v(X + 1, hi, Z + 1);
        v(X, lo, Z + 1);
        v(X + 1, hi, Z + 1);
        v(X, hi, Z + 1);
        break;
      case WEST:
        v(X, lo, Z);
        v(X, lo, Z + 1);
        v(X, hi, Z + 1);
        v(X, lo, Z);
        v(X, hi, Z + 1);
        v(X, hi, Z);
        break;
      case NORTH:
        v(X, lo, Z);
        v(X, hi, Z);
        v(X + 1, hi, Z);
        v(X, lo, Z);
        v(X + 1, hi, Z);
        v(X + 1, lo, Z);
        break;
      default:
        v(X, hi, Z);
        v(X, hi, Z + 1);
        v(X + 1, hi, Z + 1);
        v(X, hi, Z);
        v(X + 1, hi, Z + 1);
        v(X + 1, hi, Z);
    }
  }

  // A top with its own light, alpha and wave at each corner, in the order
  // (X, Z), (X, Z + 1), (X + 1, Z + 1), (X + 1, Z). The square is split along
  // the diagonal joining its two darker corners, so shading runs smoothly
  // whichever way the occlusion lies (Mikola Lysenko's voxel AO).
  top(X: number, Z: number, y: number, color: number, light: number[], alpha: number[], decal: number, wave: number[] | null): void {
    if ((this.n + 6) * 4 > this.col.length) this.grow();
    const r = ((color >> 16) & 255) / 255;
    const g = ((color >> 8) & 255) / 255;
    const b = (color & 255) / 255;
    const px = [X, X, X + 1, X + 1];
    const pz = [Z, Z + 1, Z + 1, Z];
    const v = (k: number) => this.vertex(px[k], y, pz[k], r * light[k], g * light[k], b * light[k], alpha[k], decal, wave ? wave[k] : 0);
    for (const k of light[0] + light[2] > light[1] + light[3] ? FLIPPED : SQUARE) v(k);
  }

  // A water top: its color mixed toward foam at shore corners.
  topFoam(X: number, Z: number, y: number, colors: number[], foam: number[], alpha: number[], wave: number[]): void {
    if ((this.n + 6) * 4 > this.col.length) this.grow();
    const px = [X, X, X + 1, X + 1];
    const pz = [Z, Z + 1, Z + 1, Z];
    const v = (k: number) => {
      const c = foam[k] ? mixColor(colors[k], FOAM, 0.55) : colors[k];
      this.vertex(px[k], y, pz[k], ((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255, alpha[k], 1, wave[k]);
    };
    for (const k of SQUARE) v(k);
  }

  // A geometry with copies of what was written (the writer is reused).
  geometry(colorSize: 3 | 4, waves = false): BufferGeometry | null {
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
    g.setAttribute("decalMask", new BufferAttribute(this.mask.slice(0, this.n), 1));
    if (waves) g.setAttribute("wave", new BufferAttribute(this.wave.slice(0, this.n), 1));
    g.computeBoundingSphere();
    return g;
  }
}

const LAND = new Writer();
const FLUID = new Writer();

// One layer of a wall, a bit darker the deeper it is below the top.
// The band that reaches the wall's foot (`low`) takes its crease.
function band(
  out: Writer,
  dir: number,
  X: number,
  Z: number,
  lo: number,
  hi: number,
  top: number,
  color: number,
  light: number,
  low = -Infinity,
  foot = 1,
): void {
  if (hi <= lo) return;
  out.face(dir, X, Z, lo, hi, color, light * (1 - Math.min(0.25, (top - hi) * 0.03)), 1, 0, lo === low ? foot : 1);
}

const SALT = [0xf2efe6, 0xebe7dc, 0xf7f5ef, 0xe6e1d4];
const MOSS = 0x4f7a3a;
