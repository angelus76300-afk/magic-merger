import { housesOf, tierOf } from "./buildings";
import type { Settlement } from "./ecology";
import { alarm } from "./flight";
import { tell } from "./kin";
import { C, F, G } from "./materials";
import type { Trouble } from "./troubles";
import { WARD } from "./wards";
import { fallingAt } from "./weather";
import type { Creature } from "./creatures";
import type { World } from "./world";

// High water, the island's second trouble (2026-11-12). Chosen over a drought
// because its answers are unlike the wildfire's: water and rain, which saved
// a village from fire, make this one worse, and heat helps.
//
// Where: the village whose houses the water nearest them reaches by the
// lowest way (`wayFor`: for each cell, the level water must climb to cover
// it), within 4 to 28 cells and a rise of 7.5 (4 for the sea). A village
// whose flood would pour over a lip into another valley is skipped: that is
// a torrent, not rising water. An island with none has no high water.
//
// How: from its source (the water at the start of that way) the spate swells
// the bed toward a level that climbs for 50 seconds (full within 14 cells of
// the source, nothing past 30 or by the edge of its box, where the bed is
// kept at its own level so the sea round the island does not rise), and
// fills the low ground next to the water toward the level, the lowest first,
// within a flow (`q`, enough for the low ground in about 40 seconds). Ground
// already under it is kept up a little (KEEP), less than heat boils off or
// sand drinks. The engine's physics moves the water once it is placed.
// Through that: raised earth is not crossed, ice does not carry it, a pit
// fills before the water goes on, a channel carries it off, a shield stops
// it, a source under ice or earth feeds nothing; heat boils standing flood
// water off, sand and plants drink it; Water cast on it, and hard rain, make
// it more. Nothing of this is told: the island shows it.
//
// Its cause is the spate (`s`, 1 to 0): it holds for 140 seconds, then runs
// out by 270, about the span a wildfire burns. When the spate is over
// (answered, capped or run out) the bed goes back to its level, what lies
// outside it soaks away, and the trouble ends once the water has been back
// by its bed for three seconds (a minute at most).
//
// Who answered it (the same honesty as the fire's, troubles.ts). The land
// says how far the water would be by now at the level the spate has reached
// (`need`, the lowest way from the source, on the land as it was when it
// began). An item cast at it is the answer only when (1) it touched the
// water's way: four cells or more of the low ground or the source changed in
// a way the water itself never changes them (earth raised or dug, ice or
// another fluid, heat or cold, sand, a grove), and (2) after that the water
// stayed at least `behind` cells short of where the land would let it be
// (2 for a hamlet, 4 a village, 6 a town) and came no nearer the house it
// makes for, for HELD_FOR seconds running, within a minute of the cast,
// while the spate pushed. Each time the water comes nearer, the count starts
// again: a wall it reaches later is held from there. Then the spate breaks
// and the water goes back. A shield is never a change of the way: a dome is
// "held". Cases checked (scripts/troubles-test.ts): earth raised round the
// village, cold at the source, the source dammed, a channel round the
// village, heat at the front, sand on the low ground (each saved), Water
// cast on it (sooner at the houses, never thanked), one plain Earth on a
// village (not enough), a shield (held), an item cast every ten seconds that
// changes nothing (never thanked), a useful item followed by a useless one
// (the useful one thanked), a bank raised by nobody's cast (spent).

/** What a high water keeps in the save; the rest is worked out again from the land. */
export interface Flood {
  // The water's level at its source when it began, how far above it the spate climbs at most,
  // and the flow it has (volume a second).
  b: number;
  peak: number;
  q: number;
  // How far the house it makes for was from the water, in cells.
  d0: number;
  // The spate, 1 to 0, and the seconds the water has been going back.
  s: number;
  back: number;
  // The water it is.
  body: "river" | "lake" | "sea";
  // The box it may cover (x, y, width, height), and the water there when it began: a bit a cell, base64.
  box: [number, number, number, number];
  bed: string;
  // How far short of where the land would let it be the water must be held, in cells: more for a bigger village.
  behind?: number;
  // Hard rain fell on it; the people heaped earth at its edge.
  rained?: boolean;
  banked?: boolean;
}

// Round the village, how far the trouble looks: its water must start within
// FROM cells of the house it makes for, and its box reaches ZONE cells round the village.
const ZONE = 34;
const FROM = 28;
// Seconds the level climbs, the spate holds and runs out in all.
const RAMP = 50;
const HOLD = 140;
const RUN = 270;
// Most water a cell is given in a look (five a second), and the source's own swell a second.
const PER_STEP = 0.2;
const SWELL = 3;
// What the flood keeps up on ground it already covers, a second: less than heat boils off or sand drinks.
const KEEP = 0.25;
// The swell is full within TAPER_FROM cells of the source and nothing past TAPER_TO, nor within
// SINK cells of the box's edge; there the bed is kept at its own level, so what the swell sends
// down the river or out to sea is taken back there instead of raising the sea round the island.
const TAPER_FROM = 14;
const TAPER_TO = 30;
const SINK = 4;
// Seconds a house stands in water before it is ruined, a field before it is lost.
const RUIN_AFTER = 6;
const FIELD_AFTER = 4;
const MUD_AFTER = 2;
// How far behind where the land would let it be the water must stay, in cells, and for how long,
// within ANSWER_WITHIN seconds of a cast, for that cast to be the answer. BEHIND is a hamlet's: a
// village's and a town's water is wider, and a mound it goes round does not hold it.
export const BEHIND = 2;
export const HELD_FOR = 4;
const ANSWER_WITHIN = 60;
// After the spate is over: at most this long for the water to go back.
const BACK_FOR = 60;

const N4 = [1, -1, 0, 0];
const M4 = [0, 0, 1, -1];

interface Cache {
  need: Float32Array;
  // The top of the water in its bed when it began (or at the load), for the bed far from the source.
  bedTop: Float32Array;
  // The most cells it covered outside the bed.
  most: number;
  bed: Uint8Array;
  // Seconds each house or field cell has stood in water; earth heaped by the people.
  wet: Map<number, number>;
  heaped: Map<number, number>;
  lastBank: number;
  // The land as it was when each cast was noted, by the cast's time: to see whether it touched the water's way.
  snaps: Map<number, { h: Float32Array; f: Uint8Array; c: Uint8Array; g: Uint8Array; temp: Float32Array; ward: Uint8Array }>;
  // The level the spate has reached, the land's front for it and the water's own, at the last look.
  level: number;
  pd: number;
  ad: number;
}
// Kept beside the trouble, not on it: the save writes the trouble as it is.
const caches = new WeakMap<Trouble, Cache>();

const inBox = (f: Flood, x: number, y: number) => x >= f.box[0] && y >= f.box[1] && x < f.box[0] + f.box[2] && y < f.box[1] + f.box[3];
const boxIdx = (f: Flood, x: number, y: number) => (y - f.box[1]) * f.box[2] + (x - f.box[0]);
const wetCell = (world: World, i: number, d = 0.05) => (world.fluid[i] === F.WATER || world.fluid[i] === F.ICE) && world.depth[i] > d;
const sourceWater = (world: World, i: number) => world.fluid[i] === F.WATER && world.depth[i] > 0.15 && !(world.wardMask[i] & WARD.fluids);
// Where the spate puts no water: under a shield against fluids, in a wonder, under another fluid.
const blocked = (world: World, i: number) =>
  (world.wardMask[i] & WARD.fluids) !== 0 || world.cover[i] === C.WONDER || (world.fluid[i] !== F.NONE && world.fluid[i] !== F.WATER);

export function packBits(bits: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let k = 0; k < bits.length; k++) if (bits[k]) bytes[k >> 3] |= 1 << (k & 7);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unpackBits(text: string, n: number): Uint8Array | null {
  let raw: string;
  try {
    raw = atob(text);
  } catch {
    return null;
  }
  if (raw.length !== Math.ceil(n / 8)) return null;
  const out = new Uint8Array(n);
  for (let k = 0; k < n; k++) out[k] = (raw.charCodeAt(k >> 3) >> (k & 7)) & 1;
  return out;
}

// A binary heap of cells by key, for the lowest way.
class Heap {
  keys: number[] = [];
  cells: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(k: number, c: number): void {
    const { keys, cells } = this;
    let i = keys.length;
    keys.push(k);
    cells.push(c);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      keys[i] = keys[p];
      cells[i] = cells[p];
      i = p;
    }
    keys[i] = k;
    cells[i] = c;
  }
  pop(): number {
    const { keys, cells } = this;
    const top = cells[0];
    const k = keys.pop()!;
    const c = cells.pop()!;
    if (keys.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= keys.length) break;
        const r = l + 1;
        const m = r < keys.length && keys[r] < keys[l] ? r : l;
        if (keys[m] >= k) break;
        keys[i] = keys[m];
        cells[i] = cells[m];
        i = m;
      }
      keys[i] = k;
      cells[i] = c;
    }
    return top;
  }
}

/** For each cell of the box, the level water coming from `seeds` must reach to cover it, and which seed it comes from. */
function levels(world: World, box: Flood["box"], seeds: (i: number) => boolean): { need: Float32Array; from: Int32Array } {
  const [x0, y0, bw, bh] = box;
  const need = new Float32Array(bw * bh).fill(Infinity);
  const from = new Int32Array(bw * bh).fill(-1);
  const heap = new Heap();
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const i = (y + y0) * world.w + x + x0;
      if (!seeds(i)) continue;
      const k = y * bw + x;
      need[k] = world.height[i] + world.depth[i];
      from[k] = i;
      heap.push(need[k], k);
    }
  while (heap.size) {
    const k = heap.pop();
    const x = k % bw;
    const y = (k / bw) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + N4[d];
      const ny = y + M4[d];
      if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
      const nk = ny * bw + nx;
      const i = (ny + y0) * world.w + nx + x0;
      if (world.cover[i] === C.WONDER) continue;
      const l = Math.max(need[k], world.height[i] + (world.fluid[i] === F.WATER ? world.depth[i] : 0));
      if (l >= need[nk]) continue;
      need[nk] = l;
      from[nk] = from[k];
      heap.push(l, nk);
    }
  }
  return { need, from };
}

export interface Way {
  src: number;
  hx: number;
  hy: number;
  b: number;
  rise: number;
  d0: number;
  houses: number;
  body: Flood["body"];
  box: Flood["box"];
  // The water it takes to cover the low ground up to a little over the first house.
  plain: number;
}

/** Where water would come to a village: the water whose lowest way reaches its houses soonest. Null when none comes within reach. */
export function wayFor(world: World, s: Settlement): Way | null {
  const x0 = Math.max(0, Math.floor(s.x - ZONE));
  const y0 = Math.max(0, Math.floor(s.y - ZONE));
  const box: Flood["box"] = [x0, y0, Math.min(world.w, Math.ceil(s.x + ZONE)) - x0, Math.min(world.h, Math.ceil(s.y + ZONE)) - y0];
  const { need, from } = levels(world, box, (i) => sourceWater(world, i));
  const houses: { k: number; l: number }[] = [];
  for (let y = 0; y < box[3]; y++)
    for (let x = 0; x < box[2]; x++) {
      const i = (y + y0) * world.w + x + x0;
      if (world.cover[i] !== C.HOUSE || Math.hypot(x + x0 - s.x, y + y0 - s.y) > 18) continue;
      const k = y * box[2] + x;
      if (Number.isFinite(need[k]) && from[k] >= 0) houses.push({ k, l: need[k] });
    }
  if (houses.length < 8) return null;
  houses.sort((a, b) => a.l - b.l);
  const first = houses[0];
  const src = from[first.k];
  const b = world.height[src] + world.depth[src];
  const hx = (first.k % box[2]) + x0;
  const hy = Math.floor(first.k / box[2]) + y0;
  const sx = src % world.w;
  const sy = Math.floor(src / world.w);
  const d0 = Math.hypot(sx - hx, sy - hy);
  // A few houses, two at least, within a little more than the first one's rise.
  const within = houses.filter((h) => h.l <= first.l + 1.5).length;
  const rise = first.l - b;
  if (within < 8 || rise < 0.25 || rise > 7.5 || d0 < 4 || d0 > FROM) return null;
  const lake = world.springs.some((p) => !p.lava && (p.rate ?? 1.2) !== 1.2 && Math.hypot((p.i % world.w) - sx, Math.floor(p.i / world.w) - sy) < 20);
  const body = world.height[src] < world.seaLevel ? "sea" : lake ? "lake" : "river";
  // The sea rises less than a river in spate: a surge, not a wall of water.
  if (body === "sea" && rise > 4) return null;
  // Water that would pour over a lip into another valley, below its own level and away from its
  // swollen bed, runs off for good: such a village is not reached by rising water but by a torrent.
  const top = first.l + 1.4;
  let spill = 0;
  let plain = 0;
  for (let k = 0; k < need.length; k++) {
    if (need[k] >= top) continue;
    const x = (k % box[2]) + x0;
    const y = Math.floor(k / box[2]) + y0;
    const i = y * world.w + x;
    if (world.depth[i] > 0.02) continue;
    if (world.height[i] < b - 0.4) {
      if (Math.hypot(x - sx, y - sy) > TAPER_FROM) spill++;
    } else if (need[k] < first.l + 1) plain += first.l + 1 - world.height[i];
  }
  if (spill > 6) return null;
  return { src, hx, hy, b, rise, d0, houses: within, body, box, plain };
}

function cacheOf(world: World, t: Trouble): Cache | null {
  const f = t.flood;
  if (!f) return null;
  let c = caches.get(t);
  if (c) return c;
  const bed = unpackBits(f.bed, f.box[2] * f.box[3]);
  if (!bed) return null;
  // Worked out again from the land as it is: after a reload, earth raised before the save is the land's.
  const { need } = levels(world, f.box, (i) => {
    const x = i % world.w;
    const y = Math.floor(i / world.w);
    return inBox(f, x, y) && bed[boxIdx(f, x, y)] === 1 && Math.hypot(x - t.x, y - t.y) <= 3;
  });
  const bedTop = new Float32Array(f.box[2] * f.box[3]);
  for (let k = 0; k < bedTop.length; k++) {
    const i = (Math.floor(k / f.box[2]) + f.box[1]) * world.w + (k % f.box[2]) + f.box[0];
    bedTop[k] = world.height[i] < world.seaLevel ? world.seaLevel : world.height[i] + world.depth[i];
  }
  c = { need, bed, bedTop, most: 0, wet: new Map(), heaped: new Map(), snaps: new Map(), lastBank: world.time, level: f.b, pd: f.d0, ad: f.d0 };
  caches.set(t, c);
  return c;
}

const villagersOf = (world: World, t: Trouble) =>
  world.creatures.filter((v) => !v.dead && v.kind === "villager" && Math.hypot(v.homeX - t.vx, v.homeY - t.vy) < 24);

/** Starts a high water at one of the island's villages, if one has houses within reach of rising water. */
export function startHighWater(world: World, random: () => number = Math.random): Trouble | null {
  if (world.trouble) return null;
  const order = [...world.settlements].sort(() => random() - 0.5);
  for (const s of order) {
    const way = wayFor(world, s);
    if (!way) continue;
    let houses = 0;
    for (let dy = -18; dy <= 18; dy++)
      for (let dx = -18; dx <= 18; dx++) {
        const x = Math.round(s.x) + dx;
        const y = Math.round(s.y) + dy;
        if (dx * dx + dy * dy <= 324 && world.inside(x, y) && world.cover[y * world.w + x] === C.HOUSE) houses++;
      }
    const tier = tierOf(housesOf(world, s));
    const early = world.troubles < 3;
    const [bx, by, bw, bh] = way.box;
    const bed = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (wetCell(world, (y + by) * world.w + x + bx, 0.02)) bed[y * bw + x] = 1;
    // How far over the first house it climbs: a hamlet's water wets the doorsteps, a town's stands deep.
    const over = (tier === "town" ? 1.4 : tier === "village" ? 1 : 0.6) + Math.min(0.6, world.troubles * 0.1);
    const sx = way.src % world.w;
    const sy = Math.floor(way.src / world.w);
    const name = s.name || "the village";
    // How far the water was from the house it makes for: the nearest of it, wherever it lies.
    let nearest = way.d0;
    for (let k = 0; k < bed.length; k++) if (bed[k]) nearest = Math.min(nearest, Math.hypot((k % bw) + bx - way.hx, Math.floor(k / bw) + by - way.hy));
    const t: Trouble = {
      kind: "flood",
      vx: s.x,
      vy: s.y,
      name,
      x: sx,
      y: sy,
      hx: way.hx,
      hy: way.hy,
      t0: world.time,
      stage: 1,
      houses0: houses,
      people0: world.creatures.filter((v) => !v.dead && v.kind === "villager" && Math.hypot(v.homeX - s.x, v.homeY - s.y) < 24).length,
      lost: 0,
      seen: houses,
      // A house is four cells. At most a third of the village; one house in an island's first three troubles.
      cap: early ? 4 : Math.max(4, Math.floor(houses / 12) * 4),
      front: way.d0,
      width: Math.max(3, way.d0 / 3),
      embers: 0,
      calm: 0,
      checks: 0,
      warded: 0,
      casts: [],
      flood: {
        b: way.b,
        peak: way.rise + over,
        // Enough to cover the low ground in about forty seconds, if nothing takes it.
        q: Math.min(40, Math.max(tier === "town" ? 14 : tier === "village" ? 10 : 6, way.plain / 40) * (1 + Math.min(4, world.troubles) * 0.1)),
        d0: nearest,
        behind: (tier === "town" ? 6 : tier === "village" ? 4 : BEHIND) + Math.min(2, Math.floor(world.troubles / 2)),
        s: 1,
        back: 0,
        body: way.body,
        box: way.box,
        bed: packBits(bed),
      },
    };
    world.trouble = t;
    world.troubles++;
    world.troubleLast = "flood";
    tell(world, `the ${way.body} is rising at ${name}`, { x: sx, y: sy, weight: 3 });
    return t;
  }
  return null;
}

/**
 * The flood's front: the wet cell nearest the house it makes for (the bed counts, so at the start it
 * is the river itself), how many wet cells lie outside the bed, and how many house cells stand in it.
 */
export function floodFront(world: World, t: Trouble): { cells: number; x: number; y: number; dist: number; houses: number } {
  const f = t.flood!;
  const c = cacheOf(world, t);
  let cells = 0;
  let best = Infinity;
  let bx = t.x;
  let by = t.y;
  let houses = 0;
  const [x0, y0, bw, bh] = f.box;
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const cx = x + x0;
      const cy = y + y0;
      const i = cy * world.w + cx;
      if (!wetCell(world, i)) continue;
      if (!c || !c.bed[y * bw + x]) {
        cells++;
        if (world.cover[i] === C.HOUSE && world.depth[i] > 0.1) houses++;
      }
      const d = Math.hypot(cx - t.hx, cy - t.hy);
      if (d < best) {
        best = d;
        bx = cx;
        by = cy;
      }
    }
  return { cells, x: bx, y: by, dist: best, houses };
}

/** At the last look: the level the spate had reached, how far the land would let the water be from the house, and how far it was. */
export function floodSeen(t: Trouble): { level: number; pd: number; ad: number } | null {
  const c = caches.get(t);
  return c ? { level: c.level, pd: c.pd, ad: c.ad } : null;
}

// The cells a cast must change to have touched the water's way: the low ground the spate could
// cover, and its bed by the source.
function wayCells(world: World, t: Trouble, c: Cache, fn: (k: number, i: number) => void): void {
  const f = t.flood!;
  const top = f.b + f.peak + 0.5;
  for (let y = 0; y < f.box[3]; y++)
    for (let x = 0; x < f.box[2]; x++) {
      const k = y * f.box[2] + x;
      if (c.need[k] < top || (c.bed[k] && Math.hypot(x + f.box[0] - t.x, y + f.box[1] - t.y) <= 6)) fn(k, (y + f.box[1]) * world.w + x + f.box[0]);
    }
}

/** A cast was noted at the high water: what its way looked like then, to see later whether the cast changed it. */
export function snapFlood(world: World, t: Trouble, at: number): void {
  const c = cacheOf(world, t);
  if (!c) return;
  const n = c.need.length;
  const snap = { h: new Float32Array(n), f: new Uint8Array(n), c: new Uint8Array(n), g: new Uint8Array(n), temp: new Float32Array(n), ward: new Uint8Array(n) };
  wayCells(world, t, c, (k, i) => {
    snap.h[k] = world.height[i];
    snap.f[k] = world.fluid[i];
    snap.c[k] = world.cover[i];
    snap.g[k] = world.ground[i];
    snap.temp[k] = world.temp[i];
    snap.ward[k] = world.wardMask[i] & WARD.fluids;
  });
  c.snaps.set(at, snap);
  // Only the casts that may still be the answer keep theirs.
  for (const when of c.snaps.keys()) if (at - when > ANSWER_WITHIN) c.snaps.delete(when);
}

const PLANTS: readonly number[] = [C.TREE, C.BUSH, C.REEDS, C.FERN];

// Whether the land on the water's way has changed since the cast in a way the water itself never
// changes it: earth raised or dug, ice or another fluid, heat or cold, sand, plants. Water cast on it
// changes none of these: it is never the answer. Nor is a shield: a dome is not an answer, the
// village sat it out ("held").
function touched(world: World, t: Trouble, c: Cache, at: number): boolean {
  const snap = c.snaps.get(at);
  if (!snap) return false;
  let n = 0;
  // Plants come up by themselves here and there: a grove is many at once.
  let grown = 0;
  let shield = 0;
  wayCells(world, t, c, (k, i) => {
    if ((world.wardMask[i] & WARD.fluids) !== 0 && !snap.ward[k]) shield++;
    if (n >= 4 || grown >= 12) return;
    const fl = world.fluid[i];
    const was = snap.f[k];
    if (
      (Math.abs(world.height[i] - snap.h[k]) > 0.4 && !c.heaped.has(i)) ||
      (fl !== was && (fl > F.WATER || was > F.WATER)) ||
      Math.abs(world.temp[i] - snap.temp[k]) > 40 ||
      (world.ground[i] === G.SAND && snap.g[k] !== G.SAND)
    )
      n++;
    else if (PLANTS.includes(world.cover[i]) && !PLANTS.includes(snap.c[k])) grown++;
  });
  // A shield raised on its way is a dome, wherever it stands: not an answer.
  return shield < 4 && (n >= 4 || grown >= 12);
}

/** The water's distance to the house it makes for, for a cast noted now (troubles.ts, noteCast). */
export function floodDistance(world: World, t: Trouble): number {
  return caches.get(t)?.ad ?? floodFront(world, t).dist;
}

/**
 * A builder through the player's eyes, facing the water: the dry cells in front that touch it, where
 * Build heaps a bank of earth instead of a house. Null when there is no high water there.
 */
export function bankFor(world: World, c: Creature, facing: number): number[] | null {
  const t = world.trouble;
  if (!t || t.kind !== "flood" || !cacheOf(world, t)) return null;
  const out: number[] = [];
  for (const s of [1, 2]) {
    const x = Math.round(c.x + Math.cos(facing) * s);
    const y = Math.round(c.y + Math.sin(facing) * s);
    if (!world.inside(x, y) || !inBox(t.flood!, x, y)) continue;
    const i = y * world.w + x;
    if (wetCell(world, i, 0.03) || (world.cover[i] !== C.NONE && world.cover[i] !== C.CROP && world.cover[i] !== C.FLOWER)) continue;
    let touches = false;
    for (let d = 0; d < 4; d++) if (world.inside(x + N4[d], y + M4[d]) && wetCell(world, (y + M4[d]) * world.w + x + N4[d], 0.03)) touches = true;
    if (touches && !out.includes(i)) out.push(i);
  }
  return out.length ? out : null;
}

// What a builder's bank may add to a cell, in all: enough to turn a shallow edge, never the spate.
const BANK_MOST = 1;

/** Build at the water: earth heaped on those cells, half a unit a press, a unit at most a cell. */
export function heapBank(world: World, cells: number[]): boolean {
  const t = world.trouble;
  const c = t ? cacheOf(world, t) : null;
  if (!c) return false;
  let done = false;
  for (const i of cells) {
    const had = c.heaped.get(i) ?? 0;
    const add = Math.min(0.5, BANK_MOST - had);
    if (add <= 0) continue;
    world.height[i] += add;
    c.heaped.set(i, had + add);
    done = true;
  }
  return done;
}

// A house is two by two cells: the one in water and the house cells joined to it go together.
function houseAt(world: World, i: number): number[] {
  const out = [i];
  for (let q = 0; q < out.length && out.length < 4; q++) {
    const j = out[q];
    const x = j % world.w;
    for (const n of [x > 0 ? j - 1 : -1, x < world.w - 1 ? j + 1 : -1, j - world.w, j + world.w])
      if (n >= 0 && n < world.n && world.cover[n] === C.HOUSE && !out.includes(n) && out.length < 4) out.push(n);
  }
  return out;
}

// How much of the rise the bed takes at a cell of the box (x, y within it): 1 near the source, 0 far
// from it and by the box's edge.
function swellAt(world: World, f: Flood, t: Trouble, x: number, y: number): number {
  const bySource = (TAPER_TO - Math.hypot(x + f.box[0] - t.x, y + f.box[1] - t.y)) / (TAPER_TO - TAPER_FROM);
  const byEdge = (edgeIn(world, f, x, y) - SINK) / 8;
  return Math.max(0, Math.min(1, bySource, byEdge));
}
// How far a cell of the box is from its edge, where the edge is not the island's own: past the island's
// edge water spills off it (physics.ts), past the box's it would run on round the island.
function edgeIn(world: World, f: Flood, x: number, y: number): number {
  const [x0, y0, bw, bh] = f.box;
  return Math.min(x0 > 0 ? x : Infinity, y0 > 0 ? y : Infinity, x0 + bw < world.w ? bw - 1 - x : Infinity, y0 + bh < world.h ? bh - 1 - y : Infinity);
}

/** Five times a second from stepTrouble: the spate, the water, the village. True when it is over. */
export function stepFlood(world: World, t: Trouble, dt: number): boolean {
  const f = t.flood!;
  const c = cacheOf(world, t);
  if (!c) return true;
  const age = world.time - t.t0;
  const w = world.w;
  const [x0, y0, bw, bh] = f.box;
  let houses = 0;
  for (let dy = -18; dy <= 18; dy++)
    for (let dx = -18; dx <= 18; dx++) {
      const x = Math.round(t.vx) + dx;
      const y = Math.round(t.vy) + dy;
      if (dx * dx + dy * dy <= 324 && world.inside(x, y) && world.cover[y * w + x] === C.HOUSE) houses++;
    }
  t.lost += Math.max(0, t.seen - houses);
  t.seen = houses;
  t.checks++;
  if (world.wardMask[Math.round(t.vy) * w + Math.round(t.vx)] & WARD.fluids) t.warded++;
  if (t.lost >= t.cap) t.capped = true;
  const rain = world.weather ? fallingAt(world, t.x, t.y, world.time) : null;
  const raining = !!rain && rain.kind === "rain" && rain.amount > 0.5;
  if (raining) f.rained = true;
  // The spate holds, then runs its course; hard rain keeps it up. Answered or capped, it breaks.
  if (t.answer || t.capped) f.s = 0;
  else if (age > HOLD && !raining) f.s = Math.max(0, f.s - dt / (RUN - HOLD));
  const level = f.b + f.peak * Math.min(1, age / RAMP) ** 0.8 * Math.min(1, 0.35 + f.s);
  if (f.s > 0) c.level = level;

  // 1. The water swells: from its source through its own bed, each cell of the bed it reaches is
  // raised toward the level, less toward the edge of the box so that the swell slopes down to the
  // water beyond. Ice, earth raised over the level, another fluid or a shield hold it where they are:
  // what lies past them is not fed, and a source under them feeds nothing.
  const reach: number[] = [];
  const seen = new Uint8Array(bw * bh);
  const free = (i: number) => !blocked(world, i) && world.fluid[i] !== F.ICE && world.height[i] < level;
  if (f.s > 0) {
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const x = Math.round(t.x) + dx;
        const y = Math.round(t.y) + dy;
        if (dx * dx + dy * dy > 9 || !inBox(f, x, y)) continue;
        const k = boxIdx(f, x, y);
        if (!c.bed[k] || !free(y * w + x)) continue;
        seen[k] = 1;
        reach.push(k);
      }
    for (let q = 0; q < reach.length; q++) {
      const k = reach[q];
      const x = k % bw;
      const y = (k / bw) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + N4[d];
        const ny = y + M4[d];
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const nk = ny * bw + nx;
        if (seen[nk] || !c.bed[nk] || !free((ny + y0) * w + nx + x0)) continue;
        seen[nk] = 1;
        reach.push(nk);
      }
    }
    const rise = level - f.b;
    for (const k of reach) {
      const x = k % bw;
      const y = (k / bw) | 0;
      const i = (y + y0) * w + x + x0;
      const want = Math.max(c.bedTop[k], f.b + rise * swellAt(world, f, t, x, y));
      const top = world.height[i] + world.depth[i];
      if (top < want) world.setFluid(i, F.WATER, world.depth[i] + Math.min(want - top, SWELL * dt));
      // As the spate falls the bed falls with it.
      else if (top > want + 0.05 && world.fluid[i] === F.WATER) world.depth[i] = Math.max(0.0005, world.depth[i] - Math.min(top - want, SWELL * dt));
    }
  }
  // The bed past the swell, and by the box's own edge, gives back what the swell sent it; once the
  // spate is over, the whole bed goes back to its own level.
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const k = y * bw + x;
      const i = (y + y0) * w + x + x0;
      if (world.fluid[i] !== F.WATER) continue;
      if (c.bed[k]) {
        const going = f.s <= 0;
        if (!going && (swellAt(world, f, t, x, y) > 0 || (Math.hypot(x + x0 - t.x, y + y0 - t.y) > TAPER_TO + SINK && edgeIn(world, f, x, y) >= SINK)))
          continue;
        const over = world.height[i] + world.depth[i] - c.bedTop[k];
        if (over > 0) world.depth[i] = Math.max(0.0005, world.depth[i] - (going ? Math.min(over, 1.5 * dt) : over));
      } else if (edgeIn(world, f, x, y) === 0) world.setFluid(i, F.NONE, 0);
    }
  // 2. What spills over: from the swollen bed through the water outside it, the lowest cells next to
  // that water are filled toward the level, within the flow the spate has.
  if (reach.length) {
    const edge: number[] = [];
    for (let q = 0; q < reach.length; q++) {
      const k = reach[q];
      const x = k % bw;
      const y = (k / bw) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + N4[d];
        const ny = y + M4[d];
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const nk = ny * bw + nx;
        if (seen[nk] || c.bed[nk]) continue;
        const i = (ny + y0) * w + nx + x0;
        if (blocked(world, i) || world.fluid[i] === F.ICE) continue;
        seen[nk] = 1;
        const low = world.height[i] + world.depth[i] < level - 0.02 && world.height[i] > f.b - 0.4;
        if (world.fluid[i] === F.WATER && world.depth[i] > 0.02) {
          reach.push(nk);
          // Ground the flood already covers is kept up a little, for nothing: what it loses at its
          // edges to the river and the sun. What drains it faster wins.
          if (low) world.depth[i] += Math.min(level - world.height[i] - world.depth[i], KEEP * dt);
        }
        // Ground well below the water's own level is another valley: what pours down there is the
        // island's run-off, not the spate's to fill.
        else if (low) edge.push(nk);
      }
    }
    const top = (k: number) => {
      const i = (((k / bw) | 0) + y0) * w + (k % bw) + x0;
      return world.height[i] + world.depth[i];
    };
    edge.sort((a, b) => top(a) - top(b));
    let budget = f.q * dt * (raining ? 1.6 : 1) * Math.min(1, 0.4 + f.s);
    for (const k of edge) {
      if (budget <= 0) break;
      const i = (((k / bw) | 0) + y0) * w + (k % bw) + x0;
      const add = Math.min(level - top(k), PER_STEP, budget);
      if (add <= 0) continue;
      world.setFluid(i, F.WATER, world.depth[i] + add);
      budget -= add;
    }
  }

  // 3. Where the water stands outside its bed: houses are ruined, fields lost; hot ground boils it
  // off, sand and plants drink it; once the spate is over it soaks away.
  let ruined = 0;
  let wetN = 0;
  let mx = 0;
  let my = 0;
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const k = y * bw + x;
      const i = (y + y0) * w + x + x0;
      if (c.bed[k] || !wetCell(world, i, 0.0005)) {
        if (c.wet.size && c.wet.has(i)) c.wet.delete(i);
        continue;
      }
      const water = world.fluid[i] === F.WATER;
      if (water && world.temp[i] > 90) world.depth[i] -= 0.4 * dt;
      if (water && world.ground[i] === G.SAND) world.depth[i] -= 0.3 * dt;
      else if (
        water &&
        (world.cover[i] === C.TREE || world.cover[i] === C.BUSH || world.cover[i] === C.REEDS || world.cover[i] === C.FERN || world.cover[i] === C.FLOWER)
      )
        world.depth[i] -= 0.12 * dt;
      if (f.s <= 0) world.depth[i] -= 0.5 * dt;
      if (world.depth[i] <= 0.0005) {
        world.setFluid(i, F.NONE, 0);
        continue;
      }
      if (world.depth[i] < 0.12 || !water) continue;
      wetN++;
      mx += x + x0;
      my += y + y0;
      if (world.cover[i] !== C.HOUSE && world.cover[i] !== C.CROP && world.ground[i] !== G.FIELD && world.ground[i] !== G.GRASS) continue;
      const s = (c.wet.get(i) ?? 0) + dt;
      c.wet.set(i, s);
      // Grass under the flood turns to mud: dark under the water, so its edge reads from the sky, and
      // a line of it is left where the water stood.
      if (world.ground[i] === G.GRASS && world.cover[i] !== C.HOUSE) {
        if (s >= MUD_AFTER) world.ground[i] = G.DIRT;
        continue;
      }
      if (world.cover[i] === C.HOUSE) {
        if (s < RUIN_AFTER) continue;
        const block = houseAt(world, i);
        if (t.lost + ruined + block.length > t.cap) continue;
        for (const j of block) world.setCover(j, C.RUBBLE);
        ruined += block.length;
      } else if (s >= FIELD_AFTER) {
        if (world.cover[i] === C.CROP) world.setCover(i, C.NONE);
        if (world.ground[i] === G.FIELD) world.ground[i] = G.DIRT;
      }
    }

  // 4. The people run from it, and some heap earth at its edge, which the rising water tops.
  // People caught in deep water drown (creatures.ts), never more than the cap allows.
  const people = villagersOf(world, t);
  const most = t.cap <= 4 ? 1 : Math.max(1, Math.floor(t.people0 / 3));
  const drowned = t.people0 - people.length >= most;
  if (wetN || drowned) {
    const ax = wetN ? mx / wetN : t.x;
    const ay = wetN ? my / wetN : t.y;
    for (const v of people) {
      if (drowned) v.drowning = 0;
      const i = Math.round(Math.max(0, Math.min(world.h - 1, v.y))) * w + Math.round(Math.max(0, Math.min(w - 1, v.x)));
      if (wetN && f.s > 0 && (wetCell(world, i, 0.1) || Math.hypot(v.x - ax, v.y - ay) < 6)) alarm(world, v, null, ax, ay, 8);
    }
  }

  // 5. How far the water is from the house it makes for, and how far the land would let it be.
  const fr = floodFront(world, t);
  const ad = fr.dist;
  let pd = Infinity;
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++)
      if (c.need[y * bw + x] < c.level - 0.05) {
        const d = Math.hypot(x + x0 - t.hx, y + y0 - t.hy);
        if (d < pd) pd = d;
      }
  c.pd = pd;
  c.ad = ad;
  c.most = Math.max(c.most, fr.cells);
  if (t.stage === 1 && fr.cells > 6 && ad <= f.d0 * 0.6) {
    t.stage = 2;
    tell(world, `the water is spreading toward ${t.name}`, { x: fr.x, y: fr.y, weight: 3 });
  }
  if (t.stage < 3 && (fr.houses > 0 || t.lost > 0)) {
    t.stage = 3;
    tell(world, `${t.name} is flooding`, { x: t.vx, y: t.vy, weight: 3 });
  }
  if (t.stage >= 2 && f.s > 0 && world.time - c.lastBank > 3) {
    c.lastBank = world.time;
    // A spade's worth of earth on the dry cell by the front, on its way to the house.
    const d = Math.hypot(t.hx - fr.x, t.hy - fr.y) || 1;
    const bx = Math.round(fr.x + (t.hx - fr.x) / d);
    const by = Math.round(fr.y + (t.hy - fr.y) / d);
    if (world.inside(bx, by) && people.some((v) => Math.hypot(v.x - bx, v.y - by) < 12)) {
      const i = by * w + bx;
      const done = c.heaped.get(i) ?? 0;
      if (done < 0.25 && !wetCell(world, i) && world.cover[i] === C.NONE) {
        world.height[i] += 0.1;
        c.heaped.set(i, done + 0.1);
        if (!f.banked) {
          f.banked = true;
          tell(world, `the people of ${t.name} fight the water`, { x: bx, y: by, weight: 2 });
        }
      }
    }
  }

  // 6. The answer: after a cast, the water stayed well short of where the land would let it be, and
  // came no nearer, for HELD_FOR seconds while the spate pushed (see the top of this file).
  if (f.s > 0 && !t.answer)
    for (const k of t.casts) {
      if (world.time - k.t > ANSWER_WITHIN) continue;
      // `n`: how near the water has come since the cast. Each time it comes nearer the count starts
      // again: an item that stops it further on, where its wall or pit is, is held from there.
      if (!k.hit && touched(world, t, c, k.t)) k.hit = true;
      if (ad < k.n - 0.3) {
        k.n = ad;
        k.low = 0;
        continue;
      }
      k.low = k.hit && ad - pd >= (f.behind ?? BEHIND) ? k.low + dt : 0;
      if (k.low >= HELD_FOR) {
        t.answer = { key: k.key, name: k.name, emoji: k.emoji, t: k.t };
        f.s = 0;
        break;
      }
    }

  // 7. The spate is over: the water goes back, and it ends once it has been back by its bed for three seconds.
  if (f.s > 0) return false;
  f.back += dt;
  const back = fr.houses === 0 && ad >= Math.min(f.d0 - 1.5, f.d0 * 0.8) && fr.cells <= Math.max(6, c.most * 0.15);
  t.calm = back ? t.calm + dt : 0;
  if (t.calm < 3 && f.back < BACK_FOR) return false;
  return true;
}

/** What is seen of a high water right now, in one line. */
export function floodLine(t: Trouble): string {
  const body = t.flood?.body ?? "river";
  return t.stage === 3
    ? `${t.name[0].toUpperCase()}${t.name.slice(1)} is flooding`
    : t.stage === 2
      ? `The water is spreading toward ${t.name}`
      : `The ${body} is rising at ${t.name}`;
}
