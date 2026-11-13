import { BufferAttribute, BufferGeometry, Mesh, type Material } from "three";
import { BUILTIN, F, G, type Material as LandMaterial } from "../materials";
import type { World } from "../world";
import { FACE_LIGHT } from "./models";
import { mixColor, scaleColor } from "../colors";
import { GRAPHICS } from "./graphics";
import { LOOKS, biomeAt } from "../land";
import { DAMP, R as RARE } from "../ecology";
import { eyeKeepsChunk } from "./fog";
import { TILE, buildFineTile, fineAt, makeFineCells, sizeFineCells } from "./terrain-fine";

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

  // The eye view, second pass: chunks wholly past `r` cells from (x, y) are not drawn (the mist
  // has them, fog.ts EYE_DRAW); null draws every chunk, as from the sky.
  private shownAround: string | null = null;
  showWithin(at: { x: number; y: number; r: number } | null): void {
    const key = at ? `${Math.round(at.x / 4)},${Math.round(at.y / 4)},${at.r}` : null;
    if (key === this.shownAround && !this.builtSinceShown) return;
    this.shownAround = key;
    this.builtSinceShown = false;
    for (let cy = 0; cy < this.rows; cy++)
      for (let cx = 0; cx < this.cols; cx++) {
        const c = this.chunks[cy * this.cols + cx];
        const on = !at || eyeKeepsChunk(cx * CHUNK, cy * CHUNK, CHUNK, at.x, at.y, at.r);
        this.chunkOn[cy * this.cols + cx] = on ? 1 : 0;
        if (c.land) c.land.visible = on && !this.fineShown[cy * this.cols + cx];
        if (c.fluid) c.fluid.visible = on;
        const fine = this.fine[cy * this.cols + cx];
        if (fine) fine.visible = on && this.fineShown[cy * this.cols + cx] === 1;
      }
  }
  private builtSinceShown = false;

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
      this.staleFine(c);
    }
    first = true;
    for (const c of this.dirtyFluid) {
      if (!first && performance.now() > until) break;
      first = false;
      this.dirtyFluid.delete(c);
      this.slowFluid.delete(c);
      this.swap(c, "fluid", this.buildFluid(c));
    }
    if (GRAPHICS.fine) this.updateFine(until);
    // One chunk of the slow queue every third frame, land and water in turn,
    // if time is left.
    if (performance.now() > until || this.slowTurn++ % 3 !== 0) return;
    const land = this.slowTurn % 2 === 0;
    const queue = land ? this.slowLand : this.slowFluid;
    for (const c of queue) {
      queue.delete(c);
      if (land) {
        if (!this.dirtyLand.has(c)) {
          this.swap(c, "land", this.buildLand(c));
          this.staleFine(c);
        }
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
    if (kind === "land") {
      mesh.onBeforeRender = this.seeCamera;
      // Drawn finely instead while the camera is near (5.2.5).
      if (this.fineShown[c]) mesh.visible = false;
    }
    this.add(mesh);
    // A new chunk is shown; past the eye's mist it is hidden again at the next showWithin.
    this.builtSinceShown = true;
  }

  // The fine land (5.2.5, terrain-fine.ts): chunks near the camera drawn in small voxels, eighths
  // close by and quarters a little farther, the one cell mesh beyond. A chunk is built a tile at a
  // time, a few milliseconds a frame (FINE_BUDGET_MS), nearest first, and kept until the land
  // changes or the camera goes far. Until its new mesh is ready a chunk keeps showing what it had.
  // The camera is read as the land is drawn.
  private fine: (Mesh | null | undefined)[] = [];
  private fineLevel = new Uint8Array(0); // the columns a cell of each chunk's fine mesh: 4 or 8
  private fineShown = new Uint8Array(0);
  private fineStale = new Uint8Array(0);
  private chunkOn = new Uint8Array(0);
  private staleBuiltAt = -1e9;
  private job: { c: number; sub: number; tiles: [number, number, number, number][]; next: number } | null = null;
  // The longest a frame spent on the fine land, ms (for the measures).
  readonly fineStats = { maxFrameMs: 0, maxTileMs: 0, tiles: 0, tileMs: [] as number[] };
  private eye = { x: 0, y: 0, z: 0, known: false };
  private fineCells = makeFineCells();
  private seeCamera = (_r: unknown, _s: unknown, camera: { position: { x: number; y: number; z: number } }): void => {
    this.focus(camera.position.x, camera.position.y, camera.position.z);
  };

  // Where the camera is, in the scene.
  focus(x: number, y: number, z: number): void {
    this.eye.x = x;
    this.eye.y = y;
    this.eye.z = z;
    this.eye.known = true;
  }

  // The camera's distance to a chunk's box, in scene units; its height counts half (from the sky
  // view the land under the camera is as near as it looks).
  private chunkDistance(c: number): number {
    const { x0, y0, x1, y1 } = this.bounds(c);
    const ox = -this.world.w / 2;
    const oz = -this.world.h / 2;
    const dx = Math.max(x0 + ox - this.eye.x, 0, this.eye.x - (x1 + ox));
    const dz = Math.max(y0 + oz - this.eye.z, 0, this.eye.z - (y1 + oz));
    const dy = Math.max(0, this.eye.y - FINE_TOP) * 0.5;
    return Math.hypot(dx, dy, dz);
  }

  // A chunk whose land changed keeps its fine mesh on show until the new one is built: a river
  // that flows changes its chunk every few frames, and the land would flicker between the two.
  private staleFine(c: number): void {
    if (this.fine[c] !== undefined) this.fineStale[c] = 1;
    if (this.job?.c === c) this.job = null;
  }

  private dropFine(c: number): void {
    const m = this.fine[c];
    if (m) {
      this.remove(m);
      m.geometry.dispose();
    }
    this.fine[c] = undefined;
    this.fineLevel[c] = 0;
    this.fineStale[c] = 0;
    if (this.fineShown[c]) {
      this.fineShown[c] = 0;
      const land = this.chunks[c].land;
      if (land) land.visible = this.chunkOn[c] === 1;
    }
  }

  // The level a chunk should have: 8, 4, or 0 for whole cells. With hysteresis, so a chunk at the
  // edge of a ring does not flip as the camera turns.
  private wantLevel(c: number, d: number): number {
    const now = this.fine[c] ? this.fineLevel[c] : 0;
    if (d < (now === 8 ? FINE8_KEEP : FINE8_NEAR)) return 8;
    if (d < (now >= 4 ? FINE_KEEP : FINE_NEAR)) return 4;
    return 0;
  }

  // Picks each chunk's level, shows each chunk one way or the other, and builds tiles of the
  // nearest chunk that needs it for up to FINE_BUDGET_MS (everything when `all`).
  updateFine(until: number, all = false): void {
    const n = this.chunks.length;
    if (this.fine.length !== n) {
      this.fine = new Array(n).fill(undefined);
      this.fineLevel = new Uint8Array(n);
      this.fineShown = new Uint8Array(n);
      this.fineStale = new Uint8Array(n);
      this.chunkOn = new Uint8Array(n).fill(1);
    }
    if (!this.eye.known) return;
    void until;
    const start = performance.now();
    // From high up, the whole island in whole cells.
    const high = this.eye.y > FINE_HIGH;
    for (;;) {
      let best = -1;
      let bestRank = Infinity;
      let bestSub = 0;
      for (let c = 0; c < n; c++) {
        const d = high ? Infinity : this.chunkDistance(c);
        if (d > FINE_DROP && this.fine[c] !== undefined) this.dropFine(c);
        const want = this.wantLevel(c, d);
        // Missing or at the wrong level first, nearest first; then a changed chunk, at most one in
        // STALE_MS.
        const rank =
          want === 0
            ? Infinity
            : this.fine[c] === undefined || this.fineLevel[c] !== want
              ? d
              : this.fineStale[c] && (all || start - this.staleBuiltAt > STALE_MS)
                ? d + 1000
                : Infinity;
        if (!this.dirtyLand.has(c) && rank < bestRank) {
          best = c;
          bestRank = rank;
          bestSub = want;
        }
        const show = want > 0 && !!this.fine[c] ? 1 : 0;
        if (show !== this.fineShown[c]) {
          this.fineShown[c] = show;
          const land = this.chunks[c].land;
          if (land) land.visible = this.chunkOn[c] === 1 && !show;
          const fine = this.fine[c];
          if (fine) fine.visible = this.chunkOn[c] === 1 && show === 1;
        }
      }
      // The job carries on unless the camera moved so that another chunk or level comes first.
      if (best < 0) this.job = null;
      else if (!this.job || this.job.c !== best || this.job.sub !== bestSub) this.startFine(best, bestSub);
      if (!this.job) break;
      const job = this.job;
      while (job.next < job.tiles.length) {
        const t0 = performance.now();
        const [tx0, ty0, tx1, ty1] = job.tiles[job.next++];
        buildFineTile(this.fineCells, FINE_OUT, -this.world.w / 2, -this.world.h / 2, job.sub, tx0, ty0, tx1, ty1);
        const t1 = performance.now();
        this.fineStats.maxTileMs = Math.max(this.fineStats.maxTileMs, t1 - t0);
        this.fineStats.tiles++;
        if (this.fineStats.tileMs.length < 4096) this.fineStats.tileMs.push(t1 - t0);
        if (!all && t1 - start > FINE_BUDGET_MS) break;
      }
      if (job.next >= job.tiles.length) this.finishFine(job.c, job.sub);
      if (!all) break;
    }
    this.fineStats.maxFrameMs = Math.max(this.fineStats.maxFrameMs, performance.now() - start);
  }

  // Reads the chunk's cells and lists its tiles.
  private startFine(c: number, sub: number): void {
    const { world } = this;
    const { w, h } = world;
    const { x0, y0, x1, y1 } = this.bounds(c);
    const f = this.fineCells;
    sizeFineCells(f, x0, y0, x1, y1, w, h, BOTTOM);
    for (let y = y0 - 2; y < y1 + 2; y++) {
      for (let x = x0 - 2; x < x1 + 2; x++) {
        const k = fineAt(f, x, y);
        const inside = x >= 0 && y >= 0 && x < w && y < h;
        f.inside[k] = inside ? 1 : 0;
        if (!inside) continue;
        const i = y * w + x;
        const g = world.ground[i];
        const top = columnTop(world, i);
        f.top[k] = top;
        f.ground[k] = g;
        f.wet[k] = this.wet[i];
        f.water[k] = this.wet[i] && world.fluid[i] === F.WATER ? Math.max(surfaceY(world, i), top + FLUID_LIFT) : -1e9;
        const surface = this.topColor(i);
        f.color[k] = surface;
        const built = this.builtColor(i);
        // A trodden path is ground too: its border with the grass wanders (a road keeps its kerb).
        f.natural[k] = built === null || g === G.PATH ? 1 : 0;
        f.edge[k] = built ?? this.sideTopColor(i, surface);
        const strata = this.strataAt(i);
        f.soil[k] = this.soilColor(i);
        f.stone[k] = strata.stone;
        f.deep[k] = strata.deep;
        f.blends[k] = g === G.GRASS || g === G.SAND || g === G.DIRT || g === G.ROCK || g === G.SNOW || g === G.ASH || g === G.PATH ? 1 : 0;
        f.hangs[k] = g === G.GRASS || g === G.SNOW ? 1 : 0;
        f.flowers[k] = g === G.GRASS && world.cover[i] === 0 ? 1 : 0;
        f.pebbles[k] = g === G.SAND ? 1 : 0;
      }
    }
    const tiles: [number, number, number, number][] = [];
    // Eighth voxels in tiles of half the side: the same work a tile.
    const side = sub === 8 ? TILE / 2 : TILE;
    for (let ty = y0; ty < y1; ty += side) for (let tx = x0; tx < x1; tx += side) tiles.push([tx, ty, Math.min(x1, tx + side), Math.min(y1, ty + side)]);
    FINE_OUT.reset();
    // Room for a fine chunk's vertices from the start: growing in the middle of a tile copies
    // megabytes, a spike of tens of milliseconds.
    FINE_OUT.reserve(FINE_VERTICES);
    this.job = { c, sub, tiles, next: 0 };
  }

  // The chunk's tiles are all written: its new fine mesh takes the place of the old one.
  private finishFine(c: number, sub: number): void {
    this.job = null;
    const geometry = FINE_OUT.geometry(3);
    const old = this.fine[c];
    const shown = this.fineShown[c];
    if (old) {
      this.remove(old);
      old.geometry.dispose();
    }
    if (this.fineStale[c]) this.staleBuiltAt = performance.now();
    this.fineStale[c] = 0;
    this.fineLevel[c] = sub;
    if (!geometry) {
      this.fine[c] = null;
      if (shown) {
        this.fineShown[c] = 0;
        const land = this.chunks[c].land;
        if (land) land.visible = this.chunkOn[c] === 1;
      }
      return;
    }
    const mesh = new Mesh(geometry, this.landMaterial);
    mesh.matrixAutoUpdate = false;
    mesh.onBeforeRender = this.seeCamera;
    mesh.visible = shown === 1 && this.chunkOn[c] === 1;
    this.fine[c] = mesh;
    this.add(mesh);
    this.builtSinceShown = true;
  }

  // For the measures: triangles of the land and water as now shown, and the fine chunks by level.
  shownTriangles(): { land: number; fluid: number; fineChunks: number; eighths: number } {
    let land = 0;
    let fluid = 0;
    let fineChunks = 0;
    let eighths = 0;
    for (let c = 0; c < this.chunks.length; c++) {
      const ch = this.chunks[c];
      const fine = this.fine[c];
      if (this.fineShown[c] && fine) {
        land += fine.geometry.getAttribute("position").count / 3;
        fineChunks++;
        if (this.fineLevel[c] === 8) eighths++;
      } else if (ch.land) land += ch.land.geometry.getAttribute("position").count / 3;
      if (ch.fluid) fluid += ch.fluid.geometry.getAttribute("position").count / 3;
    }
    return { land, fluid, fineChunks, eighths };
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
            // In courses as natural stone is (below), so a basalt cliff is not one flat face.
            for (let hi = top, k = 0; hi > low; k++) {
              const lo = k >= 3 ? low : Math.max(low, hi - 2);
              out.face(d, X, Z, lo, hi, rough(built, i, d, k, 0.07), light, 1, 0, lo === low ? foot : 1);
              hi = lo;
            }
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
          band(out, d, X, Z, Math.max(low, top - 1), top, top, rough(edge, i, d, 9, 0.09), light, low, foot);
          if (top - 1 > low) band(out, d, X, Z, Math.max(low, top - 3), top - 1, top, rough(soil, i, d, 7, 0.1), light, low, foot);
          // Seen from its foot (2026-11-12) a cliff was one flat grey: its stone is laid in
          // courses two voxels high, each column and course a shade of its own, the last course
          // down to the deep rock in one piece (at most three more faces a wall).
          for (let hi = top - 3, k = 0; hi > Math.max(low, BOTTOM + 2); k++) {
            const lo = k >= 2 ? Math.max(low, BOTTOM + 2) : Math.max(low, BOTTOM + 2, hi - 2);
            band(out, d, X, Z, lo, hi, top, rough(strata.stone, i, d, k, 0.12), light, low, foot);
            hi = lo;
          }
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
      // 5.2.5 (bands): each top its own band's colour, so depth steps as voxels do.
      const banded = GRAPHICS.bands && wetCells > 0;
      const mean = banded ? alpha : wetCells ? a / wetCells : alpha;
      colors[k] = banded ? color : wetCells ? (Math.round(r / wetCells) << 16) | (Math.round(g / wetCells) << 8) | Math.round(b / wetCells) : color;
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
      if (GRAPHICS.water && GRAPHICS.bands) {
        // 5.2.5: light turquoise in the shallows, darker in steps further out, clear enough in
        // the shallows for the bed to show.
        const band = d < 0.45 ? 0 : d < 1.3 ? 1 : d < 2.6 ? 2 : d < 4.5 ? 3 : 4;
        const water = this.waterAt(i);
        const shallow = mixColor(water[0], 0x86eadc, 0.45);
        return { color: mixColor(shallow, water[1], BAND_MIX[band]), alpha: BAND_ALPHA[band] };
      }
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
// The fine land (5.2.5): chunks closer to the camera than FINE_NEAR are drawn in quarter voxels
// and kept so until farther than FINE_KEEP; closer than FINE8_NEAR in eighth voxels, kept until
// FINE8_KEEP; forgotten past FINE_DROP (scene units). The camera's height counts above FINE_TOP,
// about the height of the land. A frame spends at most about FINE_BUDGET_MS building them.
const FINE8_NEAR = 12;
const FINE8_KEEP = 16;
const FINE_BUDGET_MS = 5;
const FINE_NEAR = 34;
const FINE_KEEP = 42;
const FINE_DROP = 90;
const FINE_TOP = 6;
// The camera higher than this sees the island in whole cells, and a changed fine chunk is built
// again at most once in STALE_MS.
const FINE_HIGH = 42;
const STALE_MS = 400;
// How far a waterfall hangs in front of the island's cut side, in cells.
const FALL_GAP = 0.06;

// A reusable vertex writer: typed arrays that grow when needed, so building a
// chunk allocates nothing per vertex.
export class Writer {
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

  // Room for at least `vertices` vertices.
  reserve(vertices: number): void {
    while (this.mask.length < vertices) this.grow();
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

  // An axis aligned rectangle (5.2.5, the fine land): the side `dir` of the box from (x0, y0, z0)
  // to (x1, y1, z1), wound as face() winds it; 4 is its top, 5 its bottom.
  rect(
    dir: number,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    color: number,
    light: number,
    alpha: number,
    decal = 0,
    foot = 1,
  ): void {
    if ((this.n + 6) * 4 > this.col.length) this.grow();
    const r = (((color >> 16) & 255) / 255) * light;
    const g = (((color >> 8) & 255) / 255) * light;
    const b = ((color & 255) / 255) * light;
    const v = (x: number, y: number, z: number) =>
      foot !== 1 && y === y0 ? this.vertex(x, y, z, r * foot, g * foot, b * foot, alpha, decal) : this.vertex(x, y, z, r, g, b, alpha, decal);
    switch (dir) {
      case EAST:
        v(x1, y0, z0);
        v(x1, y1, z0);
        v(x1, y1, z1);
        v(x1, y0, z0);
        v(x1, y1, z1);
        v(x1, y0, z1);
        break;
      case SOUTH:
        v(x0, y0, z1);
        v(x1, y0, z1);
        v(x1, y1, z1);
        v(x0, y0, z1);
        v(x1, y1, z1);
        v(x0, y1, z1);
        break;
      case WEST:
        v(x0, y0, z0);
        v(x0, y0, z1);
        v(x0, y1, z1);
        v(x0, y0, z0);
        v(x0, y1, z1);
        v(x0, y1, z0);
        break;
      case NORTH:
        v(x0, y0, z0);
        v(x0, y1, z0);
        v(x1, y1, z0);
        v(x0, y0, z0);
        v(x1, y1, z0);
        v(x1, y0, z0);
        break;
      case TOP:
        v(x0, y1, z0);
        v(x0, y1, z1);
        v(x1, y1, z1);
        v(x0, y1, z0);
        v(x1, y1, z1);
        v(x1, y1, z0);
        break;
      default:
        v(x0, y0, z0);
        v(x1, y0, z1);
        v(x0, y0, z1);
        v(x0, y0, z0);
        v(x1, y0, z0);
        v(x1, y0, z1);
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
// The fine chunk being built, a tile at a time over several frames.
const FINE_OUT = new Writer();
const FINE_VERTICES = 6 * 4096 * 16;
const FLUID = new Writer();

// A wall's color a shade lighter or darker, warmer or cooler, the same for the same cell, side
// and course: up to `amount` either way.
function rough(color: number, i: number, dir: number, course: number, amount: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(dir * 31 + course * 131 + 7, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  const k = 1 + (((h & 255) / 255) * 2 - 1) * amount;
  const warm = ((((h >>> 8) & 255) / 255) * 2 - 1) * amount * 0.35;
  const ch = (s: number, f: number) => Math.max(0, Math.min(255, Math.round(((color >> s) & 255) * f)));
  return (ch(16, k * (1 + warm)) << 16) | (ch(8, k) << 8) | ch(0, k * (1 - warm));
}

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

const BAND_MIX = [0, 0.28, 0.55, 0.78, 1];
const BAND_ALPHA = [0.42, 0.58, 0.74, 0.88, 0.96];
const SALT = [0xf2efe6, 0xebe7dc, 0xf7f5ef, 0xe6e1d4];
const MOSS = 0x4f7a3a;
