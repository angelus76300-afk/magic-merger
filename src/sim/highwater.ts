import { housesOf, tierOf } from "./buildings";
import type { Settlement } from "./ecology";
import { alarm } from "./flight";
import { life, tell } from "./kin";
import { C, F, G, isBuilding } from "./materials";
import type { Trouble } from "./troubles";
import { WARD } from "./wards";
import { seeded } from "./noise";
import { fallingAt } from "./weather";
import type { Creature } from "./creatures";
import type { World } from "./world";

// High water, the island's second trouble (2026-11-12). Chosen over a drought
// because its answers are unlike the wildfire's: water and rain, which saved
// a village from fire, make this one worse, and heat helps.
//
// Where: the village whose houses the water nearest them reaches by the
// lowest way (`wayFor`: for each cell, the level water must climb to cover
// it), from water at least 8 cells from the island's rim, within 4 to 28
// cells and a rise of 7.5 (4 for the sea). A village whose flood would pour
// over a lip into another valley, or whose low ground is too wide to cover in
// time, is skipped. An island with none has no high water.
//
// How (round two, after the playtest of 12 November): for FIRST seconds the
// water only swells in its bed, short of the lowest land beside it: time to
// see it, find the place, go to the board and come back. Then its level
// climbs to the first house by `th` (TO_HOUSE: 90 s for a town, 100 for a
// village, 115 for a hamlet) and a little over it. The bed swells along its
// shore only (full within 2 cells of land, nothing 8 cells out), near the
// source (nothing past 30 cells) and never at the island's rim or the box's
// edge, where the bed is kept at its own level: no plateau of sea, no wall of
// water at the rim, and the sea round the island does not rise. The spate
// fills the low ground next to the water toward the level, the lowest first,
// within a flow (`q`), and keeps up a little (KEEP) what it covers. The
// engine's physics moves the water once placed. Through that: raised earth is
// not crossed, ice does not carry it, a pit fills before the water goes on, a
// channel carries it off, a shield stops it, a source under ice or earth feeds
// nothing and what it no longer reaches drains back; heat boils standing flood
// water off, sand and plants drink it; Water cast on it, and hard rain, make
// it more. Banks raised side by side with a gap of a cell or two have the gap
// closed by the village's people. Grass under it turns to mud, foam is thrown
// from its edge toward the houses. Nothing of this is told.
//
// Only what the water takes is the water's: a house is lost to it only when it
// stood in the spate's own water, where the land lets its level reach, for
// RUIN_AFTER seconds; a house a spell crushes, or water a spell pushed onto
// it, is not the flood's. A villager is lost to it only if the water killed
// them. Walkers in water over 0.7 deep are hurt; animals run from it.
//
// Its cause is the spate (`s`, 1 to 0): it holds 60 seconds past the house,
// then runs out over 130 more, about the span a wildfire burns. Answered,
// capped, or held by a shield over the houses for SHIELD_FOR seconds with
// water against it, it breaks: the bed goes back to its level, what lies
// outside it soaks away, and it ends once the water has been back by its bed
// for three seconds (a minute at most).
//
// Who answered it (the same honesty as the fire's, troubles.ts). The land
// says how far the water would be by now at the level the spate has reached
// (`need`, the lowest way from the source, on the land as it was when it
// began). An item cast at it is the answer only when (1) it touched the
// water's way: four cells or more of the low ground or the source changed in
// a way the water itself never changes them (earth raised or dug, ice or
// another fluid, heat or cold, sand, a grove of twelve plants; never a
// shield), and (2) after that, within a minute of the cast while the spate
// pushed, the water came no nearer the house it makes for and either stayed
// BEHIND (2) cells short of where the land would let it be, or went back (two
// cells from the nearest it came, a quarter less of it out of its bed), for
// `hold` seconds running (4 for a hamlet, 6 a village, 8 a town) while its
// level climbed 0.04 a second held (unless it was at its height already): held
// against a push, not pushed back a cell for a moment by earth raised under
// its edge; never while a house stands in its water. Each time it comes nearer the count starts again:
// a wall it reaches later is held from there. Cases checked
// (scripts/troubles-test.ts): raised earth round the village, five plain
// Earth casts across its way (a hamlet), cold at the source, the source
// dammed, a channel, heat, a hill (each saved), Water cast on it (sooner at the
// houses, never thanked), one plain Earth on a village (not enough), a shield
// over the village or over one house (held), an item cast every ten seconds
// that changes nothing (never thanked), a useful item then a useless one (the
// useful one thanked), a bank raised by nobody's cast (spent), a house
// crushed by the player's own spell (not the water's).

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
  // How long it must be held so, in seconds: longer for a bigger village.
  hold?: number;
  // Seconds from the first line to the water at the first house, if nothing stops it: more for a
  // hamlet. How far over the first house the spate climbs.
  th?: number;
  over?: number;
  // Villagers the water drowned.
  drowned?: number;
  // The water stood against a shield over the houses until the spate gave up: held.
  shield?: boolean;
  // Hard rain fell on it; the people heaped earth at its edge.
  rained?: boolean;
  banked?: boolean;
}

// Round the village, how far the trouble looks: its water must start within
// FROM cells of the house it makes for, and its box reaches ZONE cells round the village.
const ZONE = 34;
const FROM = 28;
// The pace (the playtest of 12 November: "too fast to answer"). For FIRST seconds the water only
// swells in its bed, short of the lowest ground beside it: time to see it, find the place, go to the
// board and come back. Then it climbs to the first house by `th` seconds (TO_HOUSE, a hamlet's the
// longest), and a little over it in OVER_FOR more. The spate holds HOLD_AFTER seconds past the
// house, then runs out over RUN_OUT: about the span a wildfire burns.
const FIRST = 45;
export const TO_HOUSE = { town: 90, village: 100, hamlet: 115 } as const;
const OVER_FOR = 20;
const HOLD_AFTER = 60;
const RUN_OUT = 130;
// Water standing against a shield over the houses this long: the spate gives up, the village held.
const SHIELD_FOR = 20;
// Most water a cell is given in a look (five a second), and the source's own swell a second.
const PER_STEP = 0.2;
const SWELL = 3;
// What the flood keeps up on ground it already covers, a second: less than heat boils off or sand drinks.
const KEEP = 0.25;
// The most water the spate spills a second.
const MOST_FLOW = 40;
// The swell is full within TAPER_FROM cells of the source and nothing past TAPER_TO, nor within
// SINK cells of the box's edge; there the bed is kept at its own level, so what the swell sends
// down the river or out to sea is taken back there instead of raising the sea round the island.
const TAPER_FROM = 14;
const TAPER_TO = 30;
const SINK = 4;
const SHORE = 8;
// Seconds a house stands in water before it is ruined, a field before it is lost.
const RUIN_AFTER = 6;
const FIELD_AFTER = 4;
const MUD_AFTER = 2;
// How far behind where the land would let it be the water must stay, in cells, and for how long,
// within ANSWER_WITHIN seconds of a cast, for that cast to be the answer (HELD_FOR is a hamlet's: a
// village's and a town's must hold longer, so a mound the water goes round does not count).
export const BEHIND = 2;
export const HELD_FOR = 4;
const ANSWER_WITHIN = 60;
// After the spate is over: at most this long for the water to go back.
const BACK_FOR = 60;

const GAP_DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const;
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
  // How far each cell of the bed is from the land (0 for land), up to 15: the swell is the shore's.
  shore: Uint8Array;
  // The land when it began (or at the load), for earth raised since; the lowest land by the water.
  h0: Float32Array;
  lip: number;
  // The level water must reach to wet the village's lowest house; the village's houses when it began
  // (or at the load): one built in the water's way meanwhile is not the village it came to.
  houseNeed: number;
  houses: Set<number>;
  // Seconds the water has stood against a shield over the houses.
  shielded: number;
  // The village's people at the last look, to tell who the water drowned.
  people: Creature[];
  // Who the flood hurt, and when: a villager who dies of it drowned.
  soaked: Map<Creature, number>;
  lastGap: number;
  // A stream of its own for the foam, so the island's draws are not touched.
  foam: () => number;
  world: { w: number; h: number };
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
  // Its source away from the island's rim, where the swell slopes back to the sea's level.
  const rimmed = (i: number) => Math.min(i % world.w, Math.floor(i / world.w), world.w - 1 - (i % world.w), world.h - 1 - Math.floor(i / world.w)) >= 8;
  const { need, from } = levels(world, box, (i) => sourceWater(world, i) && rimmed(i));
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
  const [x0, y0, bw, bh] = f.box;
  const h0 = new Float32Array(bw * bh);
  const shore = new Uint8Array(bw * bh).fill(15);
  const queue: number[] = [];
  let lip = Infinity;
  for (let k = 0; k < h0.length; k++) {
    const i = (Math.floor(k / bw) + y0) * world.w + (k % bw) + x0;
    h0[k] = world.height[i];
    if (!bed[k]) {
      shore[k] = 0;
      queue.push(k);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q];
    const x = k % bw;
    const y = (k / bw) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + N4[d];
      const ny = y + M4[d];
      if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
      const nk = ny * bw + nx;
      if (shore[nk] <= shore[k] + 1) continue;
      shore[nk] = shore[k] + 1;
      queue.push(nk);
      // Land by the water within reach of the source: the lowest of it is where the water first spills.
      if (shore[k] === 0 && Number.isFinite(need[k]) && Math.hypot(x + x0 - t.x, y + y0 - t.y) < TAPER_FROM) lip = Math.min(lip, h0[k]);
    }
  }
  c = {
    need,
    bed,
    bedTop,
    most: 0,
    wet: new Map(),
    heaped: new Map(),
    snaps: new Map(),
    lastBank: world.time,
    level: f.b,
    pd: f.d0,
    ad: f.d0,
    shore,
    h0,
    lip: Number.isFinite(lip) ? lip : f.b,
    houses: (() => {
      const out = new Set<number>();
      for (let k = 0; k < need.length; k++) {
        const i = (Math.floor(k / bw) + y0) * world.w + (k % bw) + x0;
        if (world.cover[i] === C.HOUSE) out.add(i);
      }
      return out;
    })(),
    houseNeed: (() => {
      let m = Infinity;
      for (let k = 0; k < need.length; k++) {
        const x = (k % bw) + x0;
        const y = Math.floor(k / bw) + y0;
        if (world.cover[y * world.w + x] === C.HOUSE && ours(t, x, y)) m = Math.min(m, need[k]);
      }
      return m;
    })(),
    shielded: 0,
    people: villagersOf(world, t),
    soaked: new Map(),
    lastGap: world.time,
    foam: seeded(Math.floor(t.t0 * 1000) + 7),
    world: { w: world.w, h: world.h },
  };
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
    // Low ground too wide to cover by the time it should reach the houses: the water spreads there, not here.
    if (way.plain / (TO_HOUSE[tier] - FIRST - 10) > MOST_FLOW) continue;
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
        over,
        th: TO_HOUSE[tier],
        // Enough to cover the low ground between the first spill and the first house, if nothing takes it.
        q: Math.min(
          MOST_FLOW,
          Math.max(tier === "town" ? 14 : tier === "village" ? 10 : 6, way.plain / (TO_HOUSE[tier] - FIRST - 10)) * (1 + Math.min(4, world.troubles) * 0.1),
        ),
        d0: nearest,
        behind: BEHIND,
        // A bigger village's water must be held longer: a mound it goes round holds it a moment only.
        hold: (tier === "town" ? 8 : tier === "village" ? 6 : HELD_FOR) + Math.min(2, Math.floor(world.troubles / 2)),
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
        // A house in the spate's water: where the land lets its level reach (water a spell pushed
        // onto a house is the spell's, not the flood's).
        if (world.cover[i] === C.HOUSE && world.depth[i] > 0.1 && ours(t, cx, cy) && (!c || (c.houses.has(i) && c.need[y * bw + x] < c.level + 0.3))) houses++;
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

// A house of the village it came to (the houses its way was measured on): another village's house
// the water wets on the way is not counted, nor lost, to this one.
const ours = (t: Trouble, x: number, y: number) => Math.hypot(x - t.vx, y - t.vy) <= 18;

/** Where to look at a high water: on the edge between the water and the house it makes for, more on the village's side. */
export function floodFocus(world: World, t: Trouble): { x: number; y: number } {
  const f = floodFront(world, t);
  return { x: f.x + (t.hx - f.x) * 0.6, y: f.y + (t.hy - f.y) * 0.6 };
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
const built = (cover: number) => isBuilding(cover) || cover === C.SITE || cover === C.RUBBLE;

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
      // Earth moved where nobody's hands moved it: not the people's banks, not where they build.
      (Math.abs(world.height[i] - snap.h[k]) > 0.4 && !c.heaped.has(i) && !built(world.cover[i]) && !built(snap.c[k])) ||
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

// How much of the rise the bed takes at a cell of the box (x, y within it): 1 by the shore near the
// source, sloping to nothing out at sea (SHORE cells), far from the source and by the box's edge or
// the island's rim. A river is all shore: it rises along its reach. The sea rises along its shore.
// (The playtest saw the whole sea within the box raised as a plateau, with a wall at the rim.)
function swellAt(f: Flood, t: Trouble, c: Cache, x: number, y: number): number {
  const bySource = (TAPER_TO - Math.hypot(x + f.box[0] - t.x, y + f.box[1] - t.y)) / (TAPER_TO - TAPER_FROM);
  // By the box's own edge it slopes over 8 cells to a sink; by the island's rim over 6, to the sea's
  // level at the rim itself, where water spills off the island and would stand as a wall.
  const [x0, y0, bw, bh] = f.box;
  const W = c.world.w;
  const H = c.world.h;
  const inner = Math.min(x0 > 0 ? x : Infinity, y0 > 0 ? y : Infinity, x0 + bw < W ? bw - 1 - x : Infinity, y0 + bh < H ? bh - 1 - y : Infinity);
  const rim = Math.min(x + x0, y + y0, W - 1 - x - x0, H - 1 - y - y0);
  const byEdge = Math.min((inner - SINK) / 8, (rim - 1) / 6);
  const byShore = (SHORE - c.shore[y * f.box[2] + x]) / (SHORE - 2);
  return Math.max(0, Math.min(1, bySource, byEdge, byShore));
}
const onRim = (c: Cache, x: number, y: number) => x === 0 || y === 0 || x === c.world.w - 1 || y === c.world.h - 1;

// How far a cell of the box is from its edge.
function edgeIn(f: Flood, x: number, y: number): number {
  return Math.min(x, y, f.box[2] - 1 - x, f.box[3] - 1 - y);
}

// Where the spate has brought the water `age` seconds in: short of the lowest land by it for FIRST
// seconds, at the first house by `th`, a little over it OVER_FOR later; down as the spate runs out.
function levelAt(f: Flood, c: Cache, age: number): number {
  const th = f.th ?? TO_HOUSE.village;
  const first = Math.max(f.b, Math.min(f.b + 0.35, c.lip - 0.05));
  const house = f.b + Math.max(0, f.peak - (f.over ?? 0));
  let level: number;
  if (age < FIRST) level = f.b + (first - f.b) * (age / FIRST);
  else if (age < th) {
    const k = (age - FIRST) / (th - FIRST);
    level = first + (house - first) * k * k * (3 - 2 * k);
  } else level = house + (f.b + f.peak - house) * Math.min(1, (age - th) / OVER_FOR);
  // Never at a house of the village well before its time, whichever way the land lets it in.
  if (age < th - 15) level = Math.min(level, c.houseNeed - 0.15);
  return f.b + (level - f.b) * Math.min(1, 0.35 + f.s);
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
  // Only what the water takes is the water's: a house the player's own spell crushes is not lost to
  // it (the playtest: an Earth cast on the village was told as the flood). `lost` grows below, as the
  // water ruins houses.
  t.seen = houses;
  t.checks++;
  // Under a shield: the village's middle, or the house the water makes for.
  if ((world.wardMask[Math.round(t.vy) * w + Math.round(t.vx)] | world.wardMask[t.hy * w + t.hx]) & WARD.fluids) t.warded++;
  if (t.lost >= t.cap) t.capped = true;
  const rain = world.weather ? fallingAt(world, t.x, t.y, world.time) : null;
  const raining = !!rain && rain.kind === "rain" && rain.amount > 0.5;
  if (raining) f.rained = true;
  // The spate holds, then runs its course; hard rain keeps it up. Answered, capped or shielded, it breaks.
  const th = f.th ?? TO_HOUSE.village;
  if (t.answer || t.capped || f.shield) f.s = 0;
  else if (age > th + HOLD_AFTER && !raining) f.s = Math.max(0, f.s - dt / RUN_OUT);
  const level = levelAt(f, c, age);
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
      const want = Math.max(c.bedTop[k], f.b + rise * swellAt(f, t, c, x, y));
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
        // The bed the swell does not reach is kept at its own level, so the swell slopes into it.
        const going = f.s <= 0;
        if (!going && swellAt(f, t, c, x, y) > 0) continue;
        const over = world.height[i] + world.depth[i] - c.bedTop[k];
        if (over > 0) world.depth[i] = Math.max(0.0005, world.depth[i] - (going ? Math.min(over, 1.5 * dt) : over));
        // At the box's inner edge what spilled that far is taken back; at the island's rim the water
        // spills off by itself (physics.ts).
      } else if (edgeIn(f, x, y) === 0 && !onRim(c, x + x0, y + y0)) world.setFluid(i, F.NONE, 0);
    }
  // 2. What spills over: from the swollen bed through the water outside it, the lowest cells next to
  // that water are filled toward the level, within the flow the spate has.
  if (reach.length && age >= FIRST) {
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
      // Once the spate is over it soaks away; water the spate no longer reaches (cut off by ice, earth
      // or a dam at its source) drains back slowly.
      if (f.s <= 0) world.depth[i] -= 0.5 * dt;
      else if (!seen[k]) world.depth[i] -= 0.2 * dt;
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
        if (s < RUIN_AFTER || c.need[k] >= c.level + 0.3 || !ours(t, x + x0, y + y0) || !c.houses.has(i)) continue;
        const block = houseAt(world, i);
        if (t.lost + ruined + block.length > t.cap) continue;
        for (const j of block) world.setCover(j, C.RUBBLE);
        ruined += block.length;
      } else if (s >= FIELD_AFTER) {
        if (world.cover[i] === C.CROP) world.setCover(i, C.NONE);
        if (world.ground[i] === G.FIELD) world.ground[i] = G.DIRT;
      }
    }

  t.lost += ruined;
  if (t.lost >= t.cap) t.capped = true;

  // 4. The people run from it, and some heap earth at its edge, which the rising water tops.
  // People caught in deep water drown (creatures.ts), never more than the cap allows; only those
  // count against the village (not who died of age or wolves meanwhile).
  const people = villagersOf(world, t);
  for (const v of c.people)
    if ((v.dead || !people.includes(v)) && (v.drowning > 0 || world.time - (c.soaked.get(v) ?? -1e9) < 3)) f.drowned = (f.drowned ?? 0) + 1;
  c.people = people;
  const most = t.cap <= 4 ? 1 : Math.max(1, Math.floor(t.people0 / 3));
  const drowned = (f.drowned ?? 0) >= most;
  if (wetN || drowned) {
    const ax = wetN ? mx / wetN : t.x;
    const ay = wetN ? my / wetN : t.y;
    for (const v of people) {
      if (drowned) v.drowning = 0;
      const i = Math.round(Math.max(0, Math.min(world.h - 1, v.y))) * w + Math.round(Math.max(0, Math.min(w - 1, v.x)));
      if (wetN && f.s > 0 && (wetCell(world, i, 0.1) || Math.hypot(v.x - ax, v.y - ay) < 6)) alarm(world, v, null, ax, ay, 8);
    }
  }
  // Nobody that walks stands in the flood unharmed (the playtest saw one wading): land animals run
  // from it, and whoever is caught where it is deep is hurt, as in deep water (the engine's own
  // drowning starts deeper than a flood over the fields stands). The village's dead stay in the cap.
  if (wetN)
    for (const v of world.creatures) {
      if (v.dead || Math.abs(v.x - t.vx) > ZONE || Math.abs(v.y - t.vy) > ZONE) continue;
      const k = life.kindOf(v);
      if (k.swims || k.flying || k.aquatic) continue;
      const vx = Math.floor(Math.max(0, Math.min(w - 1, v.x)));
      const vy = Math.floor(Math.max(0, Math.min(world.h - 1, v.y)));
      if (!inBox(f, vx, vy) || c.bed[boxIdx(f, vx, vy)]) continue;
      const i = vy * w + vx;
      if (world.fluid[i] !== F.WATER || world.depth[i] < 0.3) continue;
      if (v.kind !== "villager") alarm(world, v, null, vx - (t.hx - vx) * 0.1, vy - (t.hy - vy) * 0.1, 8);
      if (world.depth[i] > 0.7 && !(v.kind === "villager" && drowned)) {
        v.hp -= 4 * dt;
        c.soaked.set(v, world.time);
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

  // A shield over the houses with the water standing against it: the spate gives up within
  // SHIELD_FOR seconds, and the village was held (the playtest: a dome on a house ran 338 seconds).
  if (f.s > 0) {
    const warded = ((world.wardMask[t.hy * w + t.hx] | world.wardMask[Math.round(t.vy) * w + Math.round(t.vx)]) & WARD.fluids) !== 0;
    let against = 0;
    if (warded)
      for (let y = 1; y < bh - 1 && against < 3; y++)
        for (let x = 1; x < bw - 1 && against < 3; x++) {
          const i = (y + y0) * w + x + x0;
          // Water, in its bed or out of it, beside shielded dry ground under the level: but for the
          // shield it would be there.
          if (!wetCell(world, i) || world.wardMask[i] & WARD.fluids) continue;
          for (const j of [i + 1, i - 1, i + w, i - w])
            if (world.wardMask[j] & WARD.fluids && world.height[j] < c.level - 0.05 && !wetCell(world, j)) {
              against++;
              break;
            }
        }
    c.shielded = warded && against >= 3 ? c.shielded + dt : Math.max(0, c.shielded - dt);
    if (c.shielded >= SHIELD_FOR) {
      f.shield = true;
      f.s = 0;
    }
  }

  // Banks raised side by side with a gap between them: the people close the gap with earth, up to the
  // banks' own height (the playtest: nine mounds along the shore, and the water came through the
  // gaps). Only between earth raised since it began, never across the land's own lie.
  if (f.s > 0 && age >= FIRST && world.time - c.lastGap >= 1 && people.length) {
    c.lastGap = world.time;
    let closed = 0;
    const raised = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= bw || y >= bh) return Infinity;
      const i = (y + y0) * w + x + x0;
      return world.height[i] >= c.level + 0.05 && world.height[i] - c.h0[y * bw + x] >= 0.8 ? world.height[i] : Infinity;
    };
    for (let y = 1; y < bh - 1 && closed < 8; y++)
      for (let x = 1; x < bw - 1 && closed < 8; x++) {
        const k = y * bw + x;
        const i = (y + y0) * w + x + x0;
        if (c.bed[k] || world.height[i] >= c.level || (wetCell(world, i) && world.depth[i] > 0.3) || blocked(world, i)) continue;
        if (!wetCell(world, i) && !wetCell(world, i + 1) && !wetCell(world, i - 1) && !wetCell(world, i + w) && !wetCell(world, i - w)) continue;
        let top = Infinity;
        for (const [dx, dy] of GAP_DIRS)
          for (let a = 1; a <= 2 && top === Infinity; a++)
            for (let b = 1; b <= 2 && top === Infinity; b++) {
              const hp = raised(x + a * dx, y + a * dy);
              const hq = raised(x - b * dx, y - b * dy);
              if (hp < Infinity && hq < Infinity) top = Math.min(hp, hq);
            }
        if (top === Infinity) continue;
        const add = Math.min(1, top - world.height[i]);
        world.height[i] += add;
        c.heaped.set(i, (c.heaped.get(i) ?? 0) + add);
        closed++;
      }
  }

  // The edge where it advances: foam thrown toward the houses, so a glance shows which way it goes.
  if (f.s > 0 && age >= FIRST) {
    const edge: number[] = [];
    for (let y = 1; y < bh - 1; y++)
      for (let x = 1; x < bw - 1; x++) {
        const i = (y + y0) * w + x + x0;
        if (c.bed[y * bw + x] || world.fluid[i] !== F.WATER || world.depth[i] < 0.05) continue;
        for (const j of [i + 1, i - 1, i + w, i - w])
          if (world.fluid[j] === F.NONE && world.height[j] < c.level) {
            edge.push(i);
            break;
          }
      }
    const d = Math.hypot(t.hx - fr.x, t.hy - fr.y) || 1;
    for (let n = 0; n < Math.min(8, edge.length); n++) {
      const i = edge[Math.floor(c.foam() * edge.length)];
      world.particles.add({
        x: (i % w) + c.foam(),
        y: Math.floor(i / w) + c.foam(),
        z: 0.4,
        vx: ((t.hx - fr.x) / d) * 1.4,
        vy: ((t.hy - fr.y) / d) * 1.4,
        vz: 1.6,
        gravity: 6,
        life: 0.7,
        color: 0xf2fbff,
        size: 0.9,
      });
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
      // Held at least BEHIND cells short of where the land would let it be; or going back: two cells
      // from the nearest it came and a quarter less of it out of its bed (cut from its source, it
      // drains; earth raised under its edge only pushes the edge back).
      k.top = Math.max(k.top ?? 0, fr.cells);
      const back = ad >= k.n + 2 && fr.cells <= k.top * 0.75;
      // Never while a house stands in its water: water in the village is not held out of it.
      const held = k.hit && fr.houses === 0 && (ad - pd >= (f.behind ?? BEHIND) || back);
      // Held against a push: while it holds, the spate's level climbs (0.04 for each second held, so more for
      // a bigger village), unless it is already at its height. A mound on the doorstep that pushes the
      // edge back a cell for a few seconds is not held against anything.
      if (held && k.low === 0) k.lvl = c.level;
      k.low = held ? k.low + dt : 0;
      const hold = f.hold ?? HELD_FOR;
      const pushed = back || age > (f.th ?? TO_HOUSE.village) + OVER_FOR || c.level - (k.lvl ?? c.level) >= hold * 0.04;
      if (k.low >= hold && pushed) {
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
