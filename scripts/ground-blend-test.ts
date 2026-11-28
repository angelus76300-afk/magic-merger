// Ground tones that blend (21 November, the owner: "still some squares that do not meld together",
// and "I don't like things looking different when zooming out"). Measured on generated mixed
// islands as the fine land and the land in whole cells draw them (terrain.ts, terrain-fine.ts):
//   1. squares: a cell of sand or grass whose columns are all drawn in one tone while its four
//      neighbours, of the same ground, are drawn in another (a pale desert cell in the mesa's
//      orange sand, a swamp's grass in a meadow). None, on a desert and mesa island and on a
//      temperate island with a swamp (on main: 5 of 5 and 6 of 6 in the chunk looked at);
//   2. straight edges: of the cell sides where two tones of one ground meet, those along which the
//      tone changes exactly at the cell's side, all eight columns (on main: 54 of 57, 104 of 129;
//      the others crossed by a flower or a tuft);
//   3. from afar: the land in whole cells (a chunk not drawn finely yet, or far) has the fine
//      land's colour cell by cell, not a checkerboard: two flat neighbours of one tone and height
//      are one colour (on main: 99 of 696, 118 of 449 pairs in two), and a cell's colour is within
//      a few levels of its mean in the fine land in eighths (on main: 21.5 and 12.5 levels on the
//      mean), as the fine land in quarters is;
//   4. an island of one land (no tone to blend) draws the same fine land as before (the hash of
//      the fine chunks round its middle, taken on main).
// Run with the other checks (npm test, scripts/sim-test.ts).
import { MeshBasicMaterial, type BufferAttribute, type Mesh } from "three";
import { generateWorld, type World } from "../src/sim/world";
import { DEFAULT_LAND, resolveLand, type LandOptions } from "../src/sim/land-options";
import { CHUNK, Terrain, columnTop } from "../src/sim/voxel/terrain";
import { GRAPHICS, PRESETS, type LooksFlag } from "../src/sim/voxel/graphics";
import { G, type Material } from "../src/sim/materials";
import * as fine from "../src/sim/voxel/terrain-fine";

type Check = (name: string, ok: boolean, detail?: string) => void;

const SUB = 8;
const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// Code colours, far apart in hue, one for each table of colours a ground is drawn from (a biome's
// palette, the salt's): with them each column says which tone it was drawn from, whatever its light.
const CODES = [0xff2020, 0x20ff20, 0x2020ff, 0xffff20, 0xff20ff, 0x20ffff, 0xff9020, 0x9020ff, 0x20ff90, 0xff2090];

interface Built {
  world: World;
  terrain: Terrain;
  meshes: Mesh[];
  land: MeshBasicMaterial;
  // The raw tone of each cell (its table of colours), when coded.
  code: (i: number) => number;
}

function inner(t: Terrain): {
  colorsAt: (i: number, id: number, m: Material) => number[];
  wantLevel: (c: number) => number;
  fine: (Mesh | null | undefined)[];
  chunks: { land: Mesh | null }[];
  wet: Uint8Array;
} {
  return t as unknown as ReturnType<typeof inner>;
}

// The island on high, the chunk of cell (cx, cy) built finely (in quarters with `quarters`), and
// those `around` it.
// The world is only read: one island serves every build.
// With `coded`, each table of colours drawn in a code colour of its own.
function build(world: World, cx: number, cy: number, coded: boolean, quarters = false, around = 0): Built {
  const was = { ...GRAPHICS };
  try {
    for (const [f, on] of Object.entries(PRESETS.high)) GRAPHICS[f as LooksFlag] = on;
    const meshes: Mesh[] = [];
    const mat = new MeshBasicMaterial();
    const terrain = new Terrain(
      world,
      mat,
      new MeshBasicMaterial(),
      (m) => meshes.push(m),
      (m) => meshes.splice(meshes.indexOf(m), 1),
    );
    terrain.wetClock = () => 0;
    const t = inner(terrain);
    const own = t.colorsAt.bind(terrain);
    const tables = new Map<number[], number[]>();
    const codeOf = (colors: number[]) => {
      let c = tables.get(colors);
      if (!c) tables.set(colors, (c = [CODES[tables.size % CODES.length]]));
      return c;
    };
    if (coded) t.colorsAt = (i, id, m) => codeOf(own(i, id, m));
    // Only the chunks within `around` chunks of (cx, cy) drawn finely, in eighths or quarters.
    const cols = Math.ceil(world.w / CHUNK);
    const kx = Math.floor(cx / CHUNK);
    const ky = Math.floor(cy / CHUNK);
    t.wantLevel = (c) => (Math.abs((c % cols) - kx) <= around && Math.abs(Math.floor(c / cols) - ky) <= around ? (quarters ? 4 : 8) : 0);
    terrain.scan();
    terrain.rebuild(true);
    terrain.focus(cx - world.w / 2 + 8, 22, cy - world.h / 2 + 8, cx - world.w / 2, cy - world.h / 2);
    terrain.updateFine(0, true);
    const code = (i: number) => codeOf(own(i, world.ground[i], world.materials.get("ground", world.ground[i])))[0];
    return { world, terrain, meshes, land: mat, code };
  } finally {
    Object.assign(GRAPHICS, was);
  }
}

// The colour (r, g, b, 0 to 1) of the highest top of `meshes` over points of the island, `res` a
// cell, at each point's middle, for the cells x0 <= x < x1, y0 <= y < y1; NaN where none.
export function topColours(world: World, meshes: Mesh[], res: number, x0: number, y0: number, x1: number, y1: number): { rgb: Float32Array; w: number } {
  const W = (x1 - x0) * res;
  const H = (y1 - y0) * res;
  const top = new Float32Array(W * H).fill(-Infinity);
  const rgb = new Float32Array(W * H * 3).fill(NaN);
  for (const m of meshes) {
    const p = m.geometry.getAttribute("position").array as Float32Array;
    const col = m.geometry.getAttribute("color") as BufferAttribute;
    const idx = m.geometry.index ? (m.geometry.index.array as ArrayLike<number>) : null;
    const nt = idx ? idx.length / 3 : p.length / 9;
    for (let t = 0; t < nt; t++) {
      const v = [idx ? idx[t * 3] : t * 3, idx ? idx[t * 3 + 1] : t * 3 + 1, idx ? idx[t * 3 + 2] : t * 3 + 2];
      const [ax, ay, az] = [p[v[0] * 3], p[v[0] * 3 + 1], p[v[0] * 3 + 2]];
      const [bx, by, bz] = [p[v[1] * 3], p[v[1] * 3 + 1], p[v[1] * 3 + 2]];
      const [qx, qy, qz] = [p[v[2] * 3], p[v[2] * 3 + 1], p[v[2] * 3 + 2]];
      const det = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz);
      if (Math.abs(det) < 1e-9) continue;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, qx) + world.w / 2 - x0) * res));
      const i1 = Math.min(W, Math.ceil((Math.max(ax, bx, qx) + world.w / 2 - x0) * res));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz, qz) + world.h / 2 - y0) * res));
      const j1 = Math.min(H, Math.ceil((Math.max(az, bz, qz) + world.h / 2 - y0) * res));
      for (let j = j0; j < j1; j++)
        for (let i = i0; i < i1; i++) {
          const px = (i + 0.5) / res + x0 - world.w / 2;
          const pz = (j + 0.5) / res + y0 - world.h / 2;
          const l1 = ((bz - qz) * (px - qx) + (qx - bx) * (pz - qz)) / det;
          const l2 = ((qz - az) * (px - qx) + (ax - qx) * (pz - qz)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
          const y = l1 * ay + l2 * by + l3 * qy;
          const s = j * W + i;
          if (y <= top[s]) continue;
          top[s] = y;
          rgb[s * 3] = l1 * col.getX(v[0]) + l2 * col.getX(v[1]) + l3 * col.getX(v[2]);
          rgb[s * 3 + 1] = l1 * col.getY(v[0]) + l2 * col.getY(v[1]) + l3 * col.getY(v[2]);
          rgb[s * 3 + 2] = l1 * col.getZ(v[0]) + l2 * col.getZ(v[1]) + l3 * col.getZ(v[2]);
        }
    }
  }
  return { rgb, w: W };
}

// The code among `codes` nearest a drawn colour by its hue (its channels over the brightest), or -1
// when none is near (a flower, a pebble, a boulder).
function nearestCode(r: number, g: number, b: number, codes: number[]): number {
  const m = Math.max(r, g, b, 1e-6);
  let best = -1;
  let bestD = 0.25;
  for (const c of codes) {
    const d = Math.abs(r / m - ((c >> 16) & 255) / 255) + Math.abs(g / m - ((c >> 8) & 255) / 255) + Math.abs(b / m - (c & 255) / 255);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

// Open dry natural cells of sand or grass inside the chunk, and its four neighbours of the same
// ground, dry, at most a voxel up or down.
function open(b: Built, i: number): boolean {
  const { world } = b;
  const g = world.ground[i];
  if ((g !== G.SAND && g !== G.GRASS) || inner(b.terrain).wet[i] || world.cover[i] !== 0) return false;
  const x = i % world.w;
  const y = (i - x) / world.w;
  for (const [dx, dy] of N4) {
    const n = (y + dy) * world.w + x + dx;
    if (world.ground[n] !== g || inner(b.terrain).wet[n] || Math.abs(columnTop(world, n) - columnTop(world, i)) > 1) return false;
  }
  return true;
}

interface Tones {
  squares: number; // 1
  speckles: number; // cells with all four neighbours of another raw tone (the cells that could be squares)
  edges: number; // 2: cell sides between two raw tones of one ground
  straight: number; // of those, sides where the drawn tone changes exactly at the side, all eight columns
}

// 1 and 2 over the chunk round cell (cx, cy), on a coded build.
function tones(b: Built, cx: number, cy: number): Tones {
  const { world, terrain } = b;
  const c = Math.floor(cy / CHUNK) * Math.ceil(world.w / CHUNK) + Math.floor(cx / CHUNK);
  const fine = inner(terrain).fine[c];
  const x0 = Math.floor(cx / CHUNK) * CHUNK;
  const y0 = Math.floor(cy / CHUNK) * CHUNK;
  const out: Tones = { squares: 0, speckles: 0, edges: 0, straight: 0 };
  if (!fine) return { squares: -1, speckles: -1, edges: -1, straight: -1 };
  const { rgb, w: W } = topColours(world, [fine], SUB, x0, y0, x0 + CHUNK, y0 + CHUNK);
  // The tone each column is drawn in, among the cell's and its neighbours' raw tones.
  const drawn = (x: number, y: number, codes: number[]): number[] => {
    const out: number[] = [];
    for (let j = 0; j < SUB; j++)
      for (let k = 0; k < SUB; k++) {
        const s = ((y - y0) * SUB + j) * W + (x - x0) * SUB + k;
        out.push(Number.isNaN(rgb[s * 3]) ? -1 : nearestCode(rgb[s * 3], rgb[s * 3 + 1], rgb[s * 3 + 2], codes));
      }
    return out;
  };
  const majority = (cols: number[]): number => {
    const n = new Map<number, number>();
    for (const t of cols) if (t >= 0) n.set(t, (n.get(t) ?? 0) + 1);
    let best = -1;
    let bestN = 0;
    for (const [t, k] of n)
      if (k > bestN) {
        best = t;
        bestN = k;
      }
    return best;
  };
  for (let y = y0 + 1; y < y0 + CHUNK - 1; y++)
    for (let x = x0 + 1; x < x0 + CHUNK - 1; x++) {
      const i = y * world.w + x;
      if (!open(b, i)) continue;
      const own = b.code(i);
      const near = N4.map(([dx, dy]) => (y + dy) * world.w + x + dx);
      const codes = [own, ...near.map((n) => b.code(n))];
      const cols = drawn(x, y, codes);
      const known = cols.filter((t) => t >= 0);
      if (near.every((n) => b.code(n) !== own)) out.speckles++;
      // 1: all its columns one tone, each neighbour drawn mostly in another.
      if (known.length > 0 && known.every((t) => t === known[0])) {
        const mine = known[0];
        if (near.every((n) => majority(drawn(n % world.w, Math.floor(n / world.w), [b.code(n), mine, ...codes])) !== mine)) out.squares++;
      }
      // 2: its east and south sides toward a cell of the same ground in another raw tone.
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ]) {
        const n = (y + dy) * world.w + x + dx;
        if (b.code(n) === own || x + dx >= x0 + CHUNK - 1 || y + dy >= y0 + CHUNK - 1) continue;
        out.edges++;
        let exact = true;
        for (let q = 0; q < SUB && exact; q++) {
          // The two columns either side of the side, at row (column) q.
          const a = dx ? ((y - y0) * SUB + q) * W + (x - x0) * SUB + SUB - 1 : ((y - y0) * SUB + SUB - 1) * W + (x - x0) * SUB + q;
          const z = dx ? a + 1 : a + W;
          const ta = nearestCode(rgb[a * 3], rgb[a * 3 + 1], rgb[a * 3 + 2], [own, b.code(n)]);
          const tz = nearestCode(rgb[z * 3], rgb[z * 3 + 1], rgb[z * 3 + 2], [own, b.code(n)]);
          if (!(ta === own && tz === b.code(n))) exact = false;
        }
        if (exact) out.straight++;
      }
    }
  return out;
}

interface Far {
  pairs: number; // flat neighbours of one raw tone and height, in whole cells
  checks: number; // of those, two colours
  eighths: number; // mean, over flat cells, of the largest channel gap (0 to 255) between whole cells and eighths
  quarters: number; // the same between quarters and eighths
  cells: number;
}

// 3 over the chunk round cell (cx, cy): real colours, the chunk in whole cells, in eighths, in quarters.
function far(near: Built, quarter: Built, cx: number, cy: number): Far {
  const { world } = near;
  const cols = Math.ceil(world.w / CHUNK);
  const c = Math.floor(cy / CHUNK) * cols + Math.floor(cx / CHUNK);
  const x0 = Math.floor(cx / CHUNK) * CHUNK;
  const y0 = Math.floor(cy / CHUNK) * CHUNK;
  const coarse = inner(near.terrain).chunks[c].land;
  const fine8 = inner(near.terrain).fine[c];
  const fine4 = inner(quarter.terrain).fine[c];
  const out: Far = { pairs: 0, checks: 0, eighths: 0, quarters: 0, cells: 0 };
  if (!coarse || !fine8 || !fine4) return { pairs: -1, checks: -1, eighths: -1, quarters: -1, cells: 0 };
  const whole = topColours(world, [coarse], 1, x0, y0, x0 + CHUNK, y0 + CHUNK);
  const e = topColours(world, [fine8], SUB, x0, y0, x0 + CHUNK, y0 + CHUNK);
  const q = topColours(world, [fine4], SUB, x0, y0, x0 + CHUNK, y0 + CHUNK);
  const tone = (i: number) => near.code(i);
  // Flat: dry natural ground, its eight neighbours at its height.
  const flat = (x: number, y: number) => {
    const i = y * world.w + x;
    if (inner(near.terrain).wet[i] || world.cover[i] !== 0 || world.ground[i] > G.ASH) return false;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (columnTop(world, i + dy * world.w + dx) !== columnTop(world, i) || inner(near.terrain).wet[i + dy * world.w + dx]) return false;
    return true;
  };
  const mean = (t: { rgb: Float32Array; w: number }, x: number, y: number) => {
    const m = [0, 0, 0];
    let n = 0;
    for (let j = 0; j < SUB; j++)
      for (let k = 0; k < SUB; k++) {
        const s = ((y - y0) * SUB + j) * t.w + (x - x0) * SUB + k;
        if (Number.isNaN(t.rgb[s * 3])) continue;
        for (let ch = 0; ch < 3; ch++) m[ch] += t.rgb[s * 3 + ch];
        n++;
      }
    return m.map((v) => (v / Math.max(1, n)) * 255);
  };
  for (let y = y0 + 2; y < y0 + CHUNK - 2; y++)
    for (let x = x0 + 2; x < x0 + CHUNK - 2; x++) {
      if (!flat(x, y)) continue;
      const i = y * world.w + x;
      const s = (y - y0) * whole.w + (x - x0);
      const w3 = [0, 1, 2].map((ch) => whole.rgb[s * 3 + ch] * 255);
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ]) {
        const n = i + dy * world.w + dx;
        if (!flat(x + dx, y + dy) || world.ground[n] !== world.ground[i] || tone(n) !== tone(i)) continue;
        // Of one tone patch too (grain): the fine land's patches are drawn in whole cells as well.
        const grain = (fine as { grainShade?: (px: number, py: number, rock: boolean) => number }).grainShade;
        if (grain && grain(x + 0.5, y + 0.5, false) !== grain(x + dx + 0.5, y + dy + 0.5, false)) continue;
        out.pairs++;
        const t = s + dy * whole.w + dx;
        if ([0, 1, 2].some((ch) => Math.abs(whole.rgb[t * 3 + ch] - whole.rgb[s * 3 + ch]) * 255 > 1.5)) out.checks++;
      }
      const m8 = mean(e, x, y);
      const m4 = mean(q, x, y);
      out.eighths += Math.max(...[0, 1, 2].map((ch) => Math.abs(w3[ch] - m8[ch])));
      out.quarters += Math.max(...[0, 1, 2].map((ch) => Math.abs(m4[ch] - m8[ch])));
      out.cells++;
    }
  out.eighths /= Math.max(1, out.cells);
  out.quarters /= Math.max(1, out.cells);
  return out;
}

// The chunk of a mixed island where `ground` meets itself across regions most: each side between
// two regions counted, a cell whose neighbours of its ground (three or four) are all of another
// region eight times; (cx, cy) its middle.
function busiest(world: World, ground: number): { cx: number; cy: number; n: number } {
  const cols = Math.ceil(world.w / CHUNK);
  const per = new Map<number, number>();
  const map = world.biomeMap!;
  for (let y = CHUNK; y < world.h - CHUNK; y++)
    for (let x = CHUNK; x < world.w - CHUNK; x++) {
      const i = y * world.w + x;
      if (world.ground[i] !== ground || world.fluid[i] !== 0) continue;
      const same = [1, -1, world.w, -world.w].filter((o) => world.ground[i + o] === ground && world.fluid[i + o] === 0);
      // A cell alone in its region counts for more than a side of a border.
      const other = same.filter((o) => map[i + o] !== map[i]).length;
      const score = same.length >= 3 && other === same.length ? 8 : other;
      if (score) {
        const c = Math.floor(y / CHUNK) * cols + Math.floor(x / CHUNK);
        per.set(c, (per.get(c) ?? 0) + score);
      }
    }
  let best = 0;
  let n = -1;
  for (const [c, k] of per)
    if (k > n) {
      best = c;
      n = k;
    }
  return { cx: (best % cols) * CHUNK + CHUNK / 2, cy: Math.floor(best / cols) * CHUNK + CHUNK / 2, n };
}

// The fine land's meshes, each hashed and the hashes sorted (the order they were built in aside).
function fineSet(b: Built): string {
  const hs: number[] = [];
  for (const m of inner(b.terrain).fine) {
    if (!m) continue;
    let one = 0x811c9dc5;
    const g = m.geometry;
    for (const a of [
      ...Object.keys(g.attributes)
        .sort()
        .map((n) => g.getAttribute(n).array),
      ...(g.index ? [g.index.array] : []),
    ]) {
      const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      for (let k = 0; k < bytes.length; k++) one = Math.imul(one ^ bytes[k], 0x01000193);
    }
    hs.push(one >>> 0);
  }
  return (hs.sort((a, b) => a - b).reduce((h, x) => Math.imul(h ^ x, 0x01000193), 0x811c9dc5) >>> 0).toString(16).padStart(8, "0");
}

export const BLEND_ISLANDS: { name: string; seed: number; land: LandOptions; ground: number }[] = [
  { name: "desert and mesa", seed: 3, land: { ...DEFAULT_LAND, biome: "desert", warmth: 0.9, water: 0.2, mixed: true }, ground: G.SAND },
  {
    name: "temperate and swamp",
    seed: 2,
    land: { ...resolveLand({ warmth: 0.4, water: 0.6, relief: 0.5, forest: 0.5 }, 2, 200), mixed: true },
    ground: G.GRASS,
  },
];

// The fine land of the medium temperate coast (one land: no tone to blend) round its middle, as
// main drew it before this change (taken on main, 21 November). Taken again when its 38 cells of
// dirt road were drawn as ground, following the slopes (scripts/roads-ground-test.ts; eedf16d8 before).
// And again on 23 November, when the water in eighths was drawn under the low land beside it and the
// shore's rim went (scripts/shore-rim-test.ts; ab52e4ef before).
// And again on 26 November, when the shore's raised land got the walls of the cell it was raised
// from and the shallows stopped rising up cliffs (scripts/cliff-corner-test.ts; d5501afb before,
// e361f8ef after), then when a lake's bed was darkened by its depth eased between cells
// (scripts/lake-depth-test.ts; e361f8ef before).
// And again on 27 November, when a lake's bed and rim joined the blend of two grounds, its sand and
// grass no longer meeting in whole-cell stairs (scripts/lake-rim-test.ts; 3c5b3a15 before, the same
// with LAKE_RIM off).
// And again on 28 November, when cliffs stood on their own line with flat walls (the cliff outline
// on in the game: scripts/cliff-outline-test.ts; 370d4587 before, the same with CLIFF_OUTLINE off).
const ONE_LAND = { cells: 152, seed: 7, hash: "e550a1c6" };

// An island at noon (the fine land bakes a glow round lava and lit houses at night).
function island(cells: number, seed: number, land: LandOptions): World {
  const world = generateWorld(cells, cells, seed, land);
  world.time = 12 * 60;
  return world;
}

export interface BlendReport {
  name: string;
  at: { cx: number; cy: number; n: number };
  tones: Tones;
  far: Far;
}

export function blendReport(): { islands: BlendReport[]; oneLand: string } {
  const islands: BlendReport[] = [];
  for (const isl of BLEND_ISLANDS) {
    const world = island(200, isl.seed, isl.land);
    const at = busiest(world, isl.ground);
    const coded = build(world, at.cx, at.cy, true);
    const near = build(world, at.cx, at.cy, false);
    const quarter = build(world, at.cx, at.cy, false, true);
    near.code = coded.code;
    islands.push({ name: isl.name, at, tones: tones(coded, at.cx, at.cy), far: far(near, quarter, at.cx, at.cy) });
  }
  const one = build(island(ONE_LAND.cells, ONE_LAND.seed, DEFAULT_LAND), ONE_LAND.cells / 2, ONE_LAND.cells / 2, false, false, 1);
  return { islands, oneLand: fineSet(one) };
}

export function groundBlendChecks(check: Check): void {
  const r = blendReport();
  for (const isl of r.islands) {
    const t = isl.tones;
    check(
      `ground blend, ${isl.name}: no cell of sand or grass a square of another tone (${t.squares} of ${t.speckles} cells whose four neighbours are of another region)`,
      t.speckles > 3 && t.squares === 0,
      JSON.stringify(isl),
    );
    check(
      `ground blend, ${isl.name}: a border between two tones of one ground wanders in eighths (${t.straight} of ${t.edges} cell sides straight)`,
      t.edges > 10 && t.straight <= t.edges * 0.25,
      JSON.stringify(isl),
    );
    const f = isl.far;
    check(
      `ground blend, ${isl.name}: the land in whole cells is no checkerboard (${f.checks} of ${f.pairs} flat neighbours of one tone in two colours)`,
      f.pairs > 20 && f.checks === 0,
      JSON.stringify(f),
    );
    check(
      `ground blend, ${isl.name}: from afar a cell keeps its colour (whole cells ${f.eighths.toFixed(1)}, quarters ${f.quarters.toFixed(1)} levels from eighths, mean over ${f.cells} flat cells)`,
      f.cells > 20 && f.eighths <= 8 && f.quarters <= 5,
      JSON.stringify(f),
    );
  }
  check(`ground blend: an island of one land draws the same fine land as before (${r.oneLand})`, !ONE_LAND.hash || r.oneLand === ONE_LAND.hash, r.oneLand);
}

// Run alone: node on the bundle prints the report.
if (/ground-blend[^/]*\.mjs$/.test(process.argv[1] ?? "")) console.log(JSON.stringify(blendReport(), null, 1));
