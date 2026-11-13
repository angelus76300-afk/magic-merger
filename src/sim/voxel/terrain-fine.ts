// The fine land of 5.2.5: the island near the camera drawn in small voxels, the scale of the
// reference models (the owner's cottage island: the land, the house and the trees all one small
// cube). Each cell of the simulation becomes `sub` by `sub` columns: 8 (eighth voxels) close to
// the camera, 4 (quarter voxels) a little farther. Drawing only: the cells' heights and grounds are
// read, never changed, and the columns in the middle of a cell stay at its height, so whatever
// stands on the cell still stands on it.
//
// The owner, on the first pass: "it must look refined and detailed, not messy and too busy". So
// surfaces are calm (tones in large soft patches, a few shades a ground, merged into big
// rectangles) and the detail is at the edges: steps, the grass lip, cliff strata, the sand to water
// border, the foam line. Every irregularity follows smooth noise of the position, so a border is a
// wavy line, never a sprinkle of loose cubes.
//
// What the switches add (land-looks.ts): `steps` softens a rise of one voxel into small irregular
// steps and breaks the lip of a cliff; `blend` makes the border of two grounds a wavy line, lets
// sand reach into the shallows and grass hang over a cliff; `grain` gives each ground soft patches
// of tone and cliffs their strata; `foam` rings the shore; `bits` grows a few clusters of flowers
// on grass and pebbles on sand. A chunk is built in tiles of TILE cells (terrain.ts spreads them
// over frames); tops of the same height and colour are merged into rectangles, walls into runs.
import { GRAPHICS } from "./graphics";
import { FACE_LIGHT } from "./models";
import { scaleColor } from "../colors";
import type { Writer } from "./terrain";

// Cells a side of the piece of a chunk built at once.
export const TILE = 8;

// The cells of a chunk and a border of two, as the fine mesher reads them.
export interface FineCells {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number; // the island's cells
  h: number;
  bottom: number;
  bw: number; // row length of the arrays below (chunk + 2 + 2)
  inside: Uint8Array;
  top: Int16Array;
  ground: Uint8Array;
  natural: Uint8Array; // 0: a built column (a trunk, a tower), drawn plain
  wet: Uint8Array;
  water: Float32Array; // the water's surface over a wet water cell, or -1e9
  color: Uint32Array; // the top's colour
  edge: Uint32Array; // the first voxel of a wall
  soil: Uint32Array;
  stone: Uint32Array;
  deep: Uint32Array;
  // Grounds that blend with each other, grass that hangs, where flowers and pebbles grow.
  blends: Uint8Array;
  hangs: Uint8Array;
  flowers: Uint8Array;
  pebbles: Uint8Array;
  // A house's cell: kept flat, its floor on its height (no slope into or out of it).
  flat: Uint8Array;
}

export function makeFineCells(): FineCells {
  return {
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
    w: 0,
    h: 0,
    bottom: 0,
    bw: 0,
    inside: new Uint8Array(0),
    top: new Int16Array(0),
    ground: new Uint8Array(0),
    natural: new Uint8Array(0),
    wet: new Uint8Array(0),
    water: new Float32Array(0),
    color: new Uint32Array(0),
    edge: new Uint32Array(0),
    soil: new Uint32Array(0),
    stone: new Uint32Array(0),
    deep: new Uint32Array(0),
    blends: new Uint8Array(0),
    hangs: new Uint8Array(0),
    flowers: new Uint8Array(0),
    pebbles: new Uint8Array(0),
    flat: new Uint8Array(0),
  };
}

// Sizes the arrays for a chunk; the caller fills them for every cell of the chunk and its border.
export function sizeFineCells(f: FineCells, x0: number, y0: number, x1: number, y1: number, w: number, h: number, bottom: number): void {
  f.x0 = x0;
  f.y0 = y0;
  f.x1 = x1;
  f.y1 = y1;
  f.w = w;
  f.h = h;
  f.bottom = bottom;
  f.bw = x1 - x0 + 4;
  const n = f.bw * (y1 - y0 + 4);
  if (f.top.length < n) {
    f.inside = new Uint8Array(n);
    f.top = new Int16Array(n);
    f.ground = new Uint8Array(n);
    f.natural = new Uint8Array(n);
    f.wet = new Uint8Array(n);
    f.water = new Float32Array(n);
    f.color = new Uint32Array(n);
    f.edge = new Uint32Array(n);
    f.soil = new Uint32Array(n);
    f.stone = new Uint32Array(n);
    f.deep = new Uint32Array(n);
    f.blends = new Uint8Array(n);
    f.hangs = new Uint8Array(n);
    f.flowers = new Uint8Array(n);
    f.pebbles = new Uint8Array(n);
    f.flat = new Uint8Array(n);
  }
}

// Index of cell (x, y) in the arrays (island coordinates, the border included).
export function fineAt(f: FineCells, x: number, y: number): number {
  return (y - f.y0 + 2) * f.bw + (x - f.x0 + 2);
}

// A number in [0, 1) for a whole point and a purpose, the same every time.
function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smooth noise in [0, 1) at (x, y) in cells, changing over about `period` cells: the same at a
// point whatever the level of detail, the tile or the chunk.
function noise(x: number, y: number, period: number, salt: number): number {
  const gx = x / period;
  const gy = y / period;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  let fx = gx - ix;
  let fy = gy - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, salt);
  const b = hash(ix + 1, iy, salt);
  const c = hash(ix, iy + 1, salt);
  const d = hash(ix + 1, iy + 1, salt);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
// The strata of a cliff: a tone for each band of two voxels, by its height, so bands run level
// across a cliff (grain).
const STRATA_TONE = [1, 0.86, 0.95, 0.8, 1.03, 0.9];
// Three shades a ground, in soft patches some cells across (grain).
const SHADES = [0.95, 1, 1.05];
const FLOWERS = [0xe8505b, 0xf4d35e, 0xf6f2ea, 0xd987e0, 0xf08a3c];
const PEBBLES = [0xbdb6a6, 0x9a958a, 0xd8d2c4];
const FOAM = 0xf4f9fc;
const FOAM_SOFT = 0xd9eef6;
const CREASE = 0.74;
// Quarter or eighth voxels of border kept around a tile, for its walls and its foam.
const B = 3;
// The highest step, in columns' units, drawn as part of a slope rather than as a wall.
const RISER = 2;

// A ground's tone: soft patches of three shades, and inside each a second, slightly darker
// shade in smaller patches, so a field of grass is calm but not flat.
function shadeAt(px: number, py: number): number {
  const n = noise(px, py, 2.6, 31);
  return SHADES[n < 0.38 ? 0 : n < 0.64 ? 1 : 2] * (noise(px, py, 0.8, 33) > 0.6 ? 0.965 : 1);
}

// The secondary terrain map (steps): a finer height field made from the cells' heights, read
// by the fine land and by what stands on it (Terrain.groundAt). Around a cell's middle (CORE
// cells each way) it is the cell's own height, so a tree or a house on the cell stands on it;
// toward a neighbour one voxel higher or lower it eases into the neighbour's height, meeting it
// half way at their common side, so a rise of one voxel is a slope of small steps; a neighbour two
// or more away is not followed, and the cliff stays. On slopes a little low noise, so they are not
// all alike. Heights in scene units; (px, py) in cells, cell (x, y) spanning [x, x + 1).
export interface LandRead {
  top(x: number, y: number): number;
  // Whether two neighbouring cells slope into each other.
  linked(ax: number, ay: number, bx: number, by: number): boolean;
}
const CORE = 0.12;
function ease(a: number): number {
  const x = Math.max(0, (a - CORE) / (0.5 - CORE));
  return 0.5 * x * x * (3 - 2 * x);
}
export function fieldHeight(land: LandRead, px: number, py: number): number {
  const cx = Math.floor(px);
  const cy = Math.floor(py);
  const t = land.top(cx, cy);
  const fx = px - cx - 0.5;
  const fy = py - cy - 0.5;
  const u = ease(Math.abs(fx));
  const v = ease(Math.abs(fy));
  if (u === 0 && v === 0) return t;
  const nx = cx + (fx < 0 ? -1 : 1);
  const ny = cy + (fy < 0 ? -1 : 1);
  const h1 = u > 0 && land.linked(cx, cy, nx, cy) ? land.top(nx, cy) : t;
  const h2 = v > 0 && land.linked(cx, cy, cx, ny) ? land.top(cx, ny) : t;
  let h3 = h1 + h2 - t;
  if (u > 0 && v > 0 && land.linked(cx, cy, nx, ny)) h3 = land.top(nx, ny);
  h3 = Math.max(Math.min(t, h1, h2), Math.min(Math.max(t, h1, h2), h3));
  let h = t * (1 - u) * (1 - v) + h1 * u * (1 - v) + h2 * (1 - u) * v + h3 * u * v;
  if (h1 !== t || h2 !== t || h3 !== t) h += (noise(px, py, 1.3, 91) - 0.5) * 0.2 * Math.max(u, v) * 2;
  return h;
}

// The fine cells as a LandRead, for the mesher.
let READ_F: FineCells | null = null;
const FINE_READ: LandRead = {
  top: (x, y) => READ_F!.top[fineAt(READ_F!, x, y)],
  linked: (ax, ay, bx, by) => {
    const f = READ_F!;
    const a = fineAt(f, ax, ay);
    const b = fineAt(f, bx, by);
    return !!(
      f.inside[a] &&
      f.inside[b] &&
      f.natural[a] &&
      f.natural[b] &&
      !f.wet[a] &&
      !f.wet[b] &&
      !f.flat[a] &&
      !f.flat[b] &&
      Math.abs(f.top[a] - f.top[b]) <= 1
    );
  },
};

// Reused between builds: heights and colours of a tile's columns with a border of B.
let H = new Int32Array(0);
let C = new Uint32Array(0);
let D = new Uint8Array(0); // 1 where a top takes spell drawings
let DONE = new Uint8Array(0);

// Writes one tile of the chunk's fine land, cells [tx0, tx1) by [ty0, ty1) in island
// coordinates, in columns of 1 / sub. ox, oz: the scene's offset of cell (0, 0).
export function buildFineTile(f: FineCells, out: Writer, ox: number, oz: number, sub: number, tx0: number, ty0: number, tx1: number, ty1: number): void {
  const steps = GRAPHICS.steps;
  const blend = GRAPHICS.blend;
  const grain = GRAPHICS.grain;
  const bits = GRAPHICS.bits;
  const Q = 1 / sub;
  const sx0 = tx0 * sub - B;
  const sy0 = ty0 * sub - B;
  const SW = (tx1 - tx0) * sub + 2 * B;
  const SH = (ty1 - ty0) * sub + 2 * B;
  if (H.length < SW * SH) {
    H = new Int32Array(SW * SH);
    C = new Uint32Array(SW * SH);
    D = new Uint8Array(SW * SH);
    DONE = new Uint8Array(SW * SH);
  }
  const bottom = f.bottom * sub;
  READ_F = f;

  for (let j = 0; j < SH; j++) {
    for (let k = 0; k < SW; k++) {
      const sx = sx0 + k;
      const sy = sy0 + j;
      const cx = Math.floor(sx / sub);
      const cy = Math.floor(sy / sub);
      const s = j * SW + k;
      const c = fineAt(f, cx, cy);
      if (cx < f.x0 - 2 || cy < f.y0 - 2 || cx >= f.x1 + 2 || cy >= f.y1 + 2 || !f.inside[c]) {
        H[s] = bottom;
        C[s] = 0;
        D[s] = 0;
        continue;
      }
      // The column's middle, in cells.
      const px = (sx + 0.5) / sub;
      const py = (sy + 0.5) / sub;
      const t = f.top[c];
      let hgt = t * sub;
      let src = c;
      let bit = 0;
      let raise = 0;
      const lx = sx - cx * sub;
      const ly = sy - cy * sub;
      if (f.natural[c]) {
        // The secondary terrain map: slopes where the land rises one voxel.
        if (steps && !f.wet[c]) hgt = Math.round(fieldHeight(FINE_READ, px, py) * sub);
        let border = Infinity;
        let shore = false;
        for (let d = 0; d < 4; d++) {
          // Columns from this side of the cell, and the distance in cells.
          const away = d === 0 ? sub - 1 - lx : d === 1 ? sub - 1 - ly : d === 2 ? lx : ly;
          const af = (away + 0.5) / sub;
          if (af > 0.5) continue;
          const n = fineAt(f, cx + DX[d], cy + DY[d]);
          if (!f.inside[n] || !f.natural[n]) continue;
          const dt = f.top[n] - t;
          // A cliff's lip, broken in short runs.
          if (steps && dt <= -2 && away === 0 && !f.wet[c] && !f.wet[n] && noise(px, py, 0.7, 2) > 0.62) hgt = Math.min(hgt, t * sub - Math.max(1, sub >> 3));
          if (f.wet[n] && !f.wet[c] && af < 0.3) shore = true;
          if (!blend) continue;
          if (f.wet[c] && !f.wet[n] && f.water[c] > -1e8 && f.top[n] >= f.water[c] - 0.5) {
            // The shore: sand reaches into the shallows in a wavy line, just above the water.
            if (af < 0.45 * Math.min(1, Math.max(0, (noise(px, py, 0.7, 3) - 0.3) * 2.2))) {
              const above = Math.ceil((f.water[c] + 0.04) * sub);
              hgt = Math.max(hgt, above, f.top[n] * sub);
              src = n;
            }
          } else if (!f.wet[c] && !f.wet[n] && f.blends[c] && f.blends[n] && f.ground[n] !== f.ground[c] && Math.abs(dt) <= 1) {
            // Two grounds that meet: their border wanders up to almost half a cell either way,
            // the same line seen from both sides.
            const shift = Math.max(-0.45, Math.min(0.45, (noise(px, py, 0.6, 13) - 0.5) * 1.6)) * (f.ground[c] > f.ground[n] ? 1 : -1);
            if (af < shift && af - shift < border) {
              border = af - shift;
              src = n;
            }
          }
        }
        if (bits && !f.wet[c] && src === c) {
          // A few small clusters, not a sprinkle.
          if (f.flowers[c] && noise(px, py, 3.2, 21) > 0.8 && hash(sx, sy, 22) < 0.28) {
            bit = FLOWERS[Math.floor(hash(Math.floor(px / 3), Math.floor(py / 3), 23) * FLOWERS.length)];
            raise = 1;
          } else if (f.flowers[c] && noise(px, py, 2.2, 27) > 0.84 && hash(sx, sy, 28) < 0.22) {
            // A tuft of grass, a shade lighter or darker than the ground.
            bit = scaleColor(f.color[c], hash(sx, sy, 29) < 0.4 ? 1.1 : 0.88);
            raise = 1;
          } else if (f.pebbles[c] && shore && hash(sx, sy, 25) < 0.07) {
            // Pebbles along the shore line only.
            bit = PEBBLES[Math.floor(hash(sx, sy, 26) * PEBBLES.length)];
            raise = 1;
          }
        }
      }
      H[s] = hgt + raise;
      D[s] = f.wet[c] || src !== c ? 0 : 1;
      let col = bit || f.color[src];
      if (grain && f.natural[c] && !bit) col = scaleColor(col, shadeAt(px, py));
      C[s] = col;
    }
  }
  // Light, kept in the colour so tops still merge. A slope of tiny steps is lit as the tilted
  // ground it stands for, by which way it faces, so it reads as a slope and not as stripes (its
  // risers take the same light, wallFaces); a top below a real wall sits in its shadow.
  for (let j = 1; j < SH - 1; j++)
    for (let k = 1; k < SW - 1; k++) {
      const s = j * SW + k;
      const h0 = H[s];
      const e = H[s + 1] - h0;
      const w = h0 - H[s - 1];
      const so = H[s + SW] - h0;
      const no = h0 - H[s - SW];
      if (e > RISER || -w > RISER || so > RISER || -no > RISER) {
        C[s] = scaleColor(C[s], 0.88);
        continue;
      }
      // Rise per column toward +x and +z, over the gentle steps only.
      const gx = (Math.abs(e) <= RISER ? e : 0) + (Math.abs(w) <= RISER ? w : 0);
      const gz = (Math.abs(so) <= RISER ? so : 0) + (Math.abs(no) <= RISER ? no : 0);
      if (!gx && !gz) continue;
      const kx = Math.min(0.6, Math.abs(gx) * 0.15);
      const kz = Math.min(0.6, Math.abs(gz) * 0.15);
      // Rising toward +x, the ground faces west; toward +z, north.
      const lx = gx > 0 ? FACE_LIGHT.west : FACE_LIGHT.east;
      const lz = gz > 0 ? FACE_LIGHT.north : FACE_LIGHT.south;
      const light = 1 - kx * (1 - lx) - kz * (1 - lz);
      C[s] = scaleColor(C[s], Math.round(light * 25) / 25);
    }

  // Tops, merged into rectangles of one height and colour.
  const k0 = B;
  const k1 = SW - B;
  const j0 = B;
  const j1 = SH - B;
  for (let j = j0; j < j1; j++) DONE.fill(0, j * SW + k0, j * SW + k1);
  const topLight = FACE_LIGHT.top;
  for (let j = j0; j < j1; j++) {
    for (let k = k0; k < k1; k++) {
      const s = j * SW + k;
      if (DONE[s]) continue;
      const h0 = H[s];
      const c0 = C[s];
      const d0 = D[s];
      let ke = k + 1;
      while (ke < k1 && !DONE[j * SW + ke] && H[j * SW + ke] === h0 && C[j * SW + ke] === c0 && D[j * SW + ke] === d0) ke++;
      let je = j + 1;
      grow: while (je < j1) {
        for (let q = k; q < ke; q++) {
          const t = je * SW + q;
          if (DONE[t] || H[t] !== h0 || C[t] !== c0 || D[t] !== d0) break grow;
        }
        je++;
      }
      for (let jj = j; jj < je; jj++) DONE.fill(1, jj * SW + k, jj * SW + ke);
      const x0 = (sx0 + k) * Q + ox;
      const z0 = (sy0 + j) * Q + oz;
      out.rect(4, x0, x0 + (ke - k) * Q, h0 * Q, h0 * Q, z0, z0 + (je - j) * Q, c0, topLight, 1, d0);
    }
  }

  // Walls toward lower neighbours, in layers, merged along each line into runs.
  const runs = RUNS;
  for (let d = 0; d < 4; d++) {
    const alongX = d === 1 || d === 3;
    const lines = alongX ? j1 - j0 : k1 - k0;
    const len = alongX ? k1 - k0 : j1 - j0;
    for (let li = 0; li < lines; li++) {
      runs.length = 0;
      for (let p = 0; p <= len; p++) {
        let faces = 0;
        if (p < len) {
          const k = alongX ? k0 + p : k0 + li;
          const j = alongX ? j0 + li : j0 + p;
          faces = wallFaces(f, d, sx0 + k, sy0 + j, j * SW + k, SW, sub, grain, blend, out, ox, oz);
        }
        // Each face carries on the open run it matches, or starts one.
        for (let q = 0; q < faces; q++) {
          const face = FACES[q];
          const open = runs.find(
            (r) => r.until === p && r.lo === face.lo && r.hi === face.hi && r.color === face.color && r.light === face.light && r.foot === face.foot,
          );
          if (open) {
            open.until = p + 1;
            open.end = face.at + 1;
          } else
            runs.push({
              lo: face.lo,
              hi: face.hi,
              color: face.color,
              light: face.light,
              foot: face.foot,
              start: face.at,
              end: face.at + 1,
              line: face.line,
              until: p + 1,
            });
        }
        // The runs this column did not carry on are finished.
        for (let r = runs.length - 1; r >= 0; r--) {
          if (runs[r].until === p + 1) continue;
          emitRun(out, d, runs[r], sub, ox, oz);
          runs.splice(r, 1);
        }
      }
      for (const run of runs) emitRun(out, d, run, sub, ox, oz);
    }
  }

  if (GRAPHICS.foam) foam(f, out, sub, sx0, sy0, SW, SH, ox, oz);
}

interface Face {
  lo: number;
  hi: number;
  color: number;
  light: number;
  foot: number;
  at: number; // the column's place along the wall's line
  line: number; // the line: the column's other coordinate, the wall's side taken in
}
interface Run {
  lo: number;
  hi: number;
  color: number;
  light: number;
  foot: number;
  start: number;
  end: number;
  line: number;
  until: number;
}
const RUNS: Run[] = [];
const FACES: Face[] = Array.from({ length: 12 }, () => ({ lo: 0, hi: 0, color: 0, light: 0, foot: 1, at: 0, line: 0 }));
const WALL_LIGHT = [FACE_LIGHT.east, FACE_LIGHT.south, FACE_LIGHT.west, FACE_LIGHT.north];

function emitRun(out: Writer, d: number, run: Run, sub: number, ox: number, oz: number): void {
  const Q = 1 / sub;
  const lo = run.lo * Q;
  const hi = run.hi * Q;
  if (d === 1 || d === 3) {
    const z = run.line * Q + oz;
    out.rect(d, run.start * Q + ox, run.end * Q + ox, lo, hi, z, z, run.color, run.light, 1, 0, run.foot);
  } else {
    const x = run.line * Q + ox;
    out.rect(d, x, x, lo, hi, run.start * Q + oz, run.end * Q + oz, run.color, run.light, 1, 0, run.foot);
  }
}

// The faces of column (sx, sy)'s wall on side d, into FACES; returns how many. Overhanging grass
// is written straight to `out`.
function wallFaces(
  f: FineCells,
  d: number,
  sx: number,
  sy: number,
  s: number,
  SW: number,
  sub: number,
  grain: boolean,
  blend: boolean,
  out: Writer,
  ox: number,
  oz: number,
): number {
  const T = H[s];
  let low = H[s + DX[d] + DY[d] * SW];
  if (low >= T) return 0;
  const cx = Math.floor(sx / sub);
  const cy = Math.floor(sy / sub);
  const c = fineAt(f, cx, cy);
  if (!f.inside[c]) return 0;
  // Past the chunk's edge the neighbour may be drawn as whole cells: the wall goes down to its
  // cell's top too, so no gap opens between the two.
  const nx = Math.floor((sx + DX[d]) / sub);
  const ny = Math.floor((sy + DY[d]) / sub);
  if (nx < f.x0 || ny < f.y0 || nx >= f.x1 || ny >= f.y1) {
    const n = fineAt(f, nx, ny);
    low = f.inside[n] ? Math.min(low, f.top[n] * sub) : f.bottom * sub;
  }
  const bottom = f.bottom * sub;
  const light = WALL_LIGHT[d];
  const foot = low > bottom ? CREASE : 1;
  const alongX = d === 1 || d === 3;
  const at = alongX ? sx : sy;
  // The wall's plane: the far side of the column for east and south.
  const line = alongX ? sy + (d === 1 ? 1 : 0) : sx + (d === 0 ? 1 : 0);
  let n = 0;
  const face = (lo: number, hi: number, color: number) => {
    if (hi <= lo) return;
    const F = FACES[n++];
    F.lo = lo;
    F.hi = hi;
    F.color = color;
    // A bit darker the deeper below the column's top, in steps of a voxel so runs still merge.
    F.light = light * (1 - Math.min(0.25, Math.floor((T - hi) / sub) * 0.03));
    F.foot = lo === low ? foot : 1;
    F.at = at;
    F.line = line;
  };
  if (!f.natural[c]) {
    face(low, T, f.edge[c]);
    return n;
  }
  // The riser of a slope's tiny step: the colour and light of the ground above it.
  if (T - low <= RISER && !f.wet[c] && low > bottom) {
    face(low, T, C[s]);
    FACES[n - 1].light = 1;
    FACES[n - 1].foot = 1;
    return n;
  }
  const px = (sx + 0.5) / sub;
  const py = (sy + 0.5) / sub;
  const top = f.top[c] * sub;
  // The top's own colour, about a quarter voxel, its lower edge wavy; deeper on grass now and then.
  const g =
    Math.max(1, Math.round(sub / 4)) + (noise(px, py, 0.5, 41 + d) > 0.55 ? Math.max(1, sub >> 3) : 0) + (f.hangs[c] && noise(px, py, 0.9, 45) > 0.75 ? 1 : 0);
  const edgeLo = Math.max(low, T - g);
  face(edgeLo, T, f.edge[c]);
  // Soil to three voxels below the cell's top, in soft patches of tone.
  const soilLo = Math.max(low, Math.min(edgeLo, top - 3 * sub));
  const soil = grain ? scaleColor(f.soil[c], SHADES[Math.floor(noise(px, py, 1.4, 51) * 2.999)]) : f.soil[c];
  face(soilLo, edgeLo, soil);
  // Stone down to the deep rock, in bands of two voxels by height (grain).
  const deepTop = Math.max(low, bottom + 2 * sub);
  let hi = soilLo;
  if (grain) {
    let courses = 0;
    while (hi > deepTop) {
      const band = Math.floor((hi - 1) / (2 * sub));
      const lo = courses >= 5 ? deepTop : Math.max(deepTop, band * 2 * sub);
      face(lo, hi, scaleColor(f.stone[c], STRATA_TONE[((band % STRATA_TONE.length) + STRATA_TONE.length) % STRATA_TONE.length]));
      hi = lo;
      courses++;
    }
  } else if (hi > deepTop) {
    face(deepTop, hi, f.stone[c]);
    hi = deepTop;
  }
  face(low, Math.min(hi, bottom + 2 * sub), f.deep[c]);
  // Grass and snow that hang over the edge of a cliff, in short runs (blend).
  if (blend && f.hangs[c] && !f.wet[c] && T - low >= sub && T >= top - 1 && noise(px, py, 0.6, 71 + d) > 0.6) {
    const Q = 1 / sub;
    const drop = Math.max(1, sub >> 2) + (noise(px, py, 0.35, 75) > 0.5 ? 1 : 0);
    const reach = Q * 0.8;
    const X = sx * Q + ox;
    const Z = sy * Q + oz;
    const x0 = d === 0 ? X + Q : d === 2 ? X - reach : X;
    const x1 = d === 0 ? X + Q + reach : d === 2 ? X : X + Q;
    const z0 = d === 1 ? Z + Q : d === 3 ? Z - reach : Z;
    const z1 = d === 1 ? Z + Q + reach : d === 3 ? Z : Z + Q;
    const yl = (T - drop) * Q;
    const yh = T * Q;
    out.rect(4, x0, x1, yh, yh, z0, z1, f.color[c], FACE_LIGHT.top, 1, 0);
    out.rect(d, x0, x1, yl, yh, z0, z1, f.edge[c], light, 1, 0);
    out.rect(5, x0, x1, yl, yl, z0, z1, scaleColor(f.edge[c], 0.7), light, 1, 0);
    const e1 = (d + 1) % 4;
    const e2 = (d + 3) % 4;
    out.rect(e1, x0, x1, yl, yh, z0, z1, f.edge[c], WALL_LIGHT[e1], 1, 0);
    out.rect(e2, x0, x1, yl, yh, z0, z1, f.edge[c], WALL_LIGHT[e2], 1, 0);
  }
  return n;
}

// A line of white foam on the water where it meets land, about a fifth of a cell wide, wavy.
function foam(f: FineCells, out: Writer, sub: number, sx0: number, sy0: number, SW: number, SH: number, ox: number, oz: number): void {
  const Q = 1 / sub;
  const reach = Math.min(B, Math.max(1, Math.round(sub * 0.25)));
  const dry = (s: number, sx: number, sy: number, surface: number) => {
    const n = fineAt(f, Math.floor(sx / sub), Math.floor(sy / sub));
    if (!f.inside[n]) return false;
    return !f.wet[n] || H[s] * Q > surface;
  };
  for (let j = B; j < SH - B; j++) {
    let run = -1;
    let runColor = 0;
    let runY = 0;
    const flush = (k: number) => {
      if (run < 0) return;
      const X0 = (sx0 + run) * Q + ox;
      const X1 = (sx0 + k) * Q + ox;
      const Z = (sy0 + j) * Q + oz;
      out.rect(4, X0, X1, runY, runY, Z, Z + Q, runColor, 1, 1, 0);
      run = -1;
    };
    for (let k = B; k < SW - B; k++) {
      const s = j * SW + k;
      const sx = sx0 + k;
      const sy = sy0 + j;
      const c = fineAt(f, Math.floor(sx / sub), Math.floor(sy / sub));
      const surface = f.water[c];
      let color = 0;
      if (surface > -1e8 && H[s] * Q <= surface) {
        // How far the nearest land is, in columns (up to `reach`).
        let near = Infinity;
        for (let dy = -reach; dy <= reach && near > 1; dy++)
          for (let dx = -reach; dx <= reach; dx++) {
            const r = Math.max(Math.abs(dx), Math.abs(dy));
            if (r === 0 || r >= near) continue;
            if (dry(s + dx + dy * SW, sx + dx, sy + dy, surface)) near = r;
          }
        const width = (1 + noise((sx + 0.5) / sub, (sy + 0.5) / sub, 0.9, 81) * reach) | 0;
        if (near <= width) color = near <= Math.max(1, width - 1) ? FOAM : FOAM_SOFT;
      }
      const y = surface + 0.035;
      if (color && run >= 0 && color === runColor && y === runY) continue;
      flush(k);
      if (color) {
        run = k;
        runColor = color;
        runY = y;
      }
    }
    flush(SW - B);
  }
}
