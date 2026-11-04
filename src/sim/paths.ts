import { F } from "./materials";
import type { World } from "./world";

// Long trips (4.3): a flow field per destination, shared by everyone going
// there. A field is the walking distance from every cell to the destination
// (a block of 4 by 4 cells, so a woodcutter and a farmer bound for the same
// side of the village share one), filled breadth first from the destination
// outward, a bounded number of cells per tick over all fields in the making.
// A creature on a long trip asks for its destination's field and walks
// straight on until it is ready (a fraction of a second), then follows the
// field downhill. Fields are made again after FIELD_LIFE seconds, so new
// houses, felled trees and floods are taken into account, and forgotten when
// nobody asked for them for a while.
//
// Three ways of moving: on foot (deep water, lava, solid covers and steps up
// of more than 1.6 are walls), on foot and swimming (deep water is fine), and
// in water only (fish). Fliers need no path.

export const Mobility = { WALK: 0, SWIM: 1, WATER: 2 } as const;
export type Mobility = (typeof Mobility)[keyof typeof Mobility];

// Cells filled per tick over all fields: a field of a large island (208 by
// 208, 43,000 cells) is ready in about half a second.
const BUDGET = 1500;
const FIELD_LIFE = 30;
const FIELD_IDLE = 8;
const MAX_FIELDS = 40;
// No field reaches further than this many steps from its destination: a trip
// longer than that walks straight until it is within reach.
const MAX_STEPS = 64;
const BLOCK = 4;
const SHORT_STEPS = 28;
const FAR = 0xffff;
// The steepest step up a field takes: a little less than a creature can
// climb (1.6), so a step that is just climbable when the field is made (or
// with a little water on it) does not stop a creature that follows it later.
const CLIMB = 1.55;

interface Field {
  key: number;
  mobility: Mobility;
  dist: Uint16Array;
  done: boolean;
  made: number;
  used: number;
  // The destination block, and its size (1 for an exact cell).
  bx: number;
  by: number;
  size: number;
}

export class Paths {
  private fields = new Map<number, Field>();
  private pending: Field[] = [];
  // Cells filled in the last tick, and fields asked for in all, for the profilers.
  filled = 0;
  asked = 0;
  get size(): number {
    return this.fields.size;
  }
  get waiting(): number {
    return this.pending.length;
  }
  private spare: Field[] = [];
  // Fields are filled one at a time, so they share one queue.
  private queue = new Int32Array(0);
  private head = 0;
  private tail = 0;

  // The field toward (x, y), made if need be; null while it is being filled.
  // exact: to that very cell (a short way round a tree to the bush behind
  // it), reaching SHORT_STEPS from it; otherwise to its block of 4 by 4,
  // shared with everyone bound for the same part of the island.
  toward(world: World, mobility: Mobility, x: number, y: number, exact = false): Field | null {
    const size = exact ? 1 : BLOCK;
    const bx = Math.floor(Math.max(0, Math.min(world.w - 1, Math.round(exact ? x : Math.floor(x)))) / size);
    const by = Math.floor(Math.max(0, Math.min(world.h - 1, Math.round(exact ? y : Math.floor(y)))) / size);
    const key = (((by * 1024 + bx) * 2 + (exact ? 1 : 0)) << 2) | mobility;
    let f = this.fields.get(key);
    if (f && f.done && world.time - f.made > FIELD_LIFE) {
      this.fields.delete(key);
      this.spare.push(f);
      f = undefined;
    }
    if (!f) {
      // Room is made by forgetting the field least used lately; while every
      // one is still being filled, the trip waits and walks straight.
      if (this.fields.size >= MAX_FIELDS && !this.forgetOldest()) return null;
      f = this.start(world, key, mobility, bx, by, size);
      this.asked++;
    }
    f.used = world.time;
    return f.done ? f : null;
  }

  // Where to aim from (x, y) on a field: the furthest of the next few cells
  // down the slope that it can walk to in a straight line, so the way bends
  // smoothly round corners instead of in steps of one cell, and never cuts
  // through a tree. False where the field does not reach (an island of
  // land, or a creature on a wall).
  aim(world: World, f: Field, x: number, y: number, out: { x: number; y: number }): boolean {
    let cx = Math.max(0, Math.min(world.w - 1, Math.round(x)));
    let cy = Math.max(0, Math.min(world.h - 1, Math.round(y)));
    let d = f.dist[cy * world.w + cx];
    if (d === FAR) return false;
    out.x = cx;
    out.y = cy;
    for (let step = 0; step < 6 && d > 0; step++) {
      let best = d;
      let bx = cx;
      let by = cy;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox;
          const ny = cy + oy;
          if ((!ox && !oy) || nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
          const nd = f.dist[ny * world.w + nx];
          // A diagonal only when both sides are open, so no corner is cut
          // through a tree, and not up a step a walker could not take.
          // A lower cell beyond a cliff was reached from its other side: not a way.
          if (
            nd < best &&
            (f.mobility === Mobility.WATER || world.level(ny * world.w + nx) - world.level(cy * world.w + cx) <= CLIMB) &&
            (!ox || !oy || (f.dist[cy * world.w + nx] !== FAR && f.dist[ny * world.w + cx] !== FAR))
          ) {
            best = nd;
            bx = nx;
            by = ny;
          }
        }
      if (best === d) break;
      cx = bx;
      cy = by;
      d = best;
      if (step > 0 && !this.straight(world, f, x, y, cx, cy)) break;
      out.x = cx;
      out.y = cy;
    }
    return true;
  }

  // Can it walk from (x, y) to (tx, ty) in a straight line on this field,
  // with a little room either side? A line that grazes a corner is refused:
  // a creature on it would brush the tree on the far side of a cell edge.
  private straight(world: World, f: Field, x: number, y: number, tx: number, ty: number): boolean {
    const len = Math.hypot(tx - x, ty - y);
    if (len < 1e-3) return true;
    const nx = (-(ty - y) / len) * 0.3;
    const ny = ((tx - x) / len) * 0.3;
    for (const side of [0, 1, -1]) {
      const ox = x + nx * side;
      const oy = y + ny * side;
      const n = Math.ceil(len / 0.4);
      let last = Math.round(y) * world.w + Math.round(x);
      for (let k = 1; k <= n; k++) {
        const px = Math.round(ox + ((tx - x) * k) / n);
        const py = Math.round(oy + ((ty - y) * k) / n);
        if (px < 0 || py < 0 || px >= world.w || py >= world.h) return false;
        const i = py * world.w + px;
        if (i === last) continue;
        if (f.dist[i] === FAR || (f.mobility !== Mobility.WATER && world.level(i) - world.level(last) > CLIMB)) return false;
        last = i;
      }
    }
    return true;
  }

  // Once a tick: fills the fields being made, BUDGET cells in all.
  step(world: World): void {
    let budget = BUDGET;
    this.filled = 0;
    while (budget > 0 && this.pending.length) {
      const f = this.pending[0];
      if (this.head === 0 && this.tail === 0) this.seed(world, f);
      budget = this.fill(world, f, budget);
      if (f.done) {
        this.pending.shift();
        this.head = this.tail = 0;
      }
    }
    this.filled = BUDGET - budget;
    if (world.tick % 60 === 0)
      for (const [key, f] of this.fields)
        if (world.time - f.used > FIELD_IDLE && f.done) {
          this.fields.delete(key);
          this.spare.push(f);
        }
  }

  private forgetOldest(): boolean {
    let oldest: Field | null = null;
    for (const f of this.fields.values()) if (f.done && (!oldest || f.used < oldest.used)) oldest = f;
    if (!oldest) return false;
    this.fields.delete(oldest.key);
    this.spare.push(oldest);
    return true;
  }

  private start(world: World, key: number, mobility: Mobility, bx: number, by: number, size: number): Field {
    const n = world.w * world.h;
    let f = this.spare.pop();
    if (!f || f.dist.length !== n) f = { key, mobility, dist: new Uint16Array(n), done: false, made: 0, used: 0, bx, by, size };
    f.key = key;
    f.mobility = mobility;
    f.bx = bx;
    f.by = by;
    f.size = size;
    f.done = false;
    f.made = world.time;
    this.fields.set(key, f);
    this.pending.push(f);
    return f;
  }

  // The destination's open cells, where the filling starts.
  private seed(world: World, f: Field): void {
    if (this.queue.length < world.w * world.h) this.queue = new Int32Array(world.w * world.h);
    f.dist.fill(FAR);
    f.made = world.time;
    const q = this.queue;
    const B = f.size;
    for (let y = f.by * B; y < Math.min(world.h, f.by * B + B); y++)
      for (let x = f.bx * B; x < Math.min(world.w, f.bx * B + B); x++) {
        const i = y * world.w + x;
        if (!open(world, i, f.mobility)) continue;
        f.dist[i] = 0;
        q[this.tail++] = i;
      }
    // A destination inside a wood or a lake: its nearest open cells around it.
    const cx = Math.min(world.w - 1, f.bx * B + (B >> 1));
    const cy = Math.min(world.h - 1, f.by * B + (B >> 1));
    for (let r = 1; r <= 6 && !this.tail; r++)
      for (let y = cy - r; y <= cy + r; y++)
        for (let x = cx - r; x <= cx + r; x++) {
          if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
          const i = y * world.w + x;
          if (f.dist[i] === FAR && open(world, i, f.mobility)) {
            f.dist[i] = 0;
            q[this.tail++] = i;
          }
        }
    // Nothing open at all: a field that leads nowhere, and is done.
    if (!this.tail) f.done = true;
  }

  // Breadth first, four ways. Going from a cell to the one it was reached
  // from is the creature's step: a step up of more than 1.6 is a cliff.
  private fill(world: World, f: Field, budget: number): number {
    const w = world.w;
    const h = world.h;
    const dist = f.dist;
    const q = this.queue;
    const walk = f.mobility !== Mobility.WATER;
    const limit = f.size === 1 ? SHORT_STEPS : MAX_STEPS;
    const height = world.height;
    const depth = world.depth;
    const solid = solidCovers(world);
    while (this.head < this.tail && budget > 0) {
      const i = q[this.head++];
      budget--;
      const d = dist[i] + 1;
      if (d > limit) continue;
      const x = i % w;
      const y = (i - x) / w;
      const here = height[i] + depth[i];
      for (let k = 0; k < 4; k++) {
        const nx = k === 0 ? x + 1 : k === 1 ? x - 1 : x;
        const ny = k === 2 ? y + 1 : k === 3 ? y - 1 : y;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (dist[j] !== FAR || !openFast(world, j, f.mobility, solid)) continue;
        // From j the creature steps onto i.
        if (walk && here - height[j] - depth[j] > CLIMB) continue;
        dist[j] = d;
        q[this.tail++] = j;
      }
    }
    if (this.head >= this.tail) f.done = true;
    return budget;
  }
}

// Which covers are solid, by id, made again when spells add covers.
const solids = new WeakMap<World, { n: number; flags: Uint8Array }>();
export function solidCovers(world: World): Uint8Array {
  const list = world.materials.list.cover;
  let s = solids.get(world);
  if (!s || s.n !== list.length) {
    s = { n: list.length, flags: new Uint8Array(256) };
    list.forEach((m, id) => (s!.flags[id] = m.solid ? 1 : 0));
    solids.set(world, s);
  }
  return s.flags;
}

function openFast(world: World, i: number, mobility: Mobility, solid: Uint8Array): boolean {
  const fluid = world.fluid[i];
  if (mobility === Mobility.WATER) return (fluid === F.WATER || fluid === F.ICE) && world.depth[i] > 0.6;
  if (solid[world.cover[i]]) return false;
  if (fluid === F.NONE || fluid === F.ICE) return true;
  const depth = world.depth[i];
  if (fluid === F.LAVA) return depth <= 0.05;
  return mobility === Mobility.SWIM || depth <= 1;
}

function open(world: World, i: number, mobility: Mobility): boolean {
  const fluid = world.fluid[i];
  const deep = fluid !== F.NONE && fluid !== F.ICE && world.depth[i];
  if (mobility === Mobility.WATER) return (fluid === F.WATER || fluid === F.ICE) && world.depth[i] > 0.6;
  if (world.materials.get("cover", world.cover[i]).solid) return false;
  if (fluid === F.LAVA && world.depth[i] > 0.05) return false;
  return mobility === Mobility.SWIM || !deep || deep <= 1;
}

const all = new WeakMap<World, Paths>();
export function pathsOf(world: World): Paths {
  let p = all.get(world);
  if (!p) all.set(world, (p = new Paths()));
  return p;
}
