// The fine land of 5.2.5: a chunk of the island drawn as quarter voxels, the scale of the
// reference models (the owner's cottage island: the land, the house and the trees all one small
// cube). Each cell of the simulation becomes 4 by 4 columns of quarter voxels. Drawing only: the
// cells' heights and grounds are read, never changed, and the 2 by 2 columns in the middle of a
// cell stay at its height, so whatever stands on the cell still stands on it.
//
// What the switches add (land-looks.ts): `steps` softens a rise of one voxel into small irregular
// steps and breaks the lip of a cliff; `blend` mixes grounds that meet over a quarter voxel or two,
// lets sand poke out of the shallows and grass hang over a cliff; `grain` gives each quarter voxel
// a tone of its own and cliffs their strata; `foam` rings the shore; `bits` scatters flowers and
// pebbles. Tops of the same height and colour are merged into one rectangle (greedy meshing).
import { GRAPHICS } from "./graphics";
import { FACE_LIGHT } from "./models";
import { mixColor, scaleColor } from "../colors";
import type { Writer } from "./terrain";

export const SUB = 4; // quarter voxels a cell, each way
const Q = 1 / SUB;

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
  }
}

// Index of cell (x, y) in the arrays (island coordinates, the border included).
export function fineAt(f: FineCells, x: number, y: number): number {
  return (y - f.y0 + 2) * f.bw + (x - f.x0 + 2);
}

// A number in [0, 1) for a quarter voxel and a purpose, the same every time.
function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
// The strata of a cliff: a tone for each band of two voxels, by its height, so bands run level
// across a cliff (grain).
const STRATA_TONE = [1, 0.84, 0.95, 0.78, 1.04, 0.9];
const GRAIN = [0.93, 0.97, 1, 1, 1, 1.03, 1.07];
const FLOWERS = [0xe8505b, 0xf4d35e, 0xf6f2ea, 0xd987e0, 0xf08a3c];
const PEBBLES = [0xbdb6a6, 0x8f8a80, 0xd8d2c4];
const FOAM = [0xf4f9fc, 0xe6f1f7, 0xffffff];
const CREASE = 0.74;

// Reused between builds: heights and colours of the chunk's quarter voxels with a border of one.
let H = new Int32Array(0);
let C = new Uint32Array(0);
let D = new Uint8Array(0); // 1 where a top takes spell drawings
let DONE = new Uint8Array(0);

// Writes the chunk's fine land. ox, oz: the scene's offset of cell (0, 0).
export function buildFine(f: FineCells, out: Writer, ox: number, oz: number): void {
  const steps = GRAPHICS.steps;
  const blend = GRAPHICS.blend;
  const grain = GRAPHICS.grain;
  const bits = GRAPHICS.bits;
  const sx0 = f.x0 * SUB - 1;
  const sy0 = f.y0 * SUB - 1;
  const SW = (f.x1 - f.x0) * SUB + 2;
  const SH = (f.y1 - f.y0) * SUB + 2;
  if (H.length < SW * SH) {
    H = new Int32Array(SW * SH);
    C = new Uint32Array(SW * SH);
    D = new Uint8Array(SW * SH);
    DONE = new Uint8Array(SW * SH);
  }
  const bottom = f.bottom * SUB;

  // Heights, and colours of the chunk's own quarter voxels.
  for (let j = 0; j < SH; j++) {
    for (let k = 0; k < SW; k++) {
      const sx = sx0 + k;
      const sy = sy0 + j;
      const cx = Math.floor(sx / SUB);
      const cy = Math.floor(sy / SUB);
      const s = j * SW + k;
      const c = fineAt(f, cx, cy);
      if (!f.inside[c]) {
        H[s] = bottom;
        C[s] = 0;
        D[s] = 0;
        continue;
      }
      const t = f.top[c];
      let hgt = t * SUB;
      let src = c;
      let bit = 0;
      const lx = sx - cx * SUB;
      const ly = sy - cy * SUB;
      if (f.natural[c]) {
        // Distance of this quarter voxel to each side of its cell, in quarter voxels.
        for (let d = 0; d < 4; d++) {
          const away = d === 0 ? SUB - 1 - lx : d === 1 ? SUB - 1 - ly : d === 2 ? lx : ly;
          if (away > 1) continue;
          const n = fineAt(f, cx + DX[d], cy + DY[d]);
          if (!f.inside[n] || !f.natural[n]) continue;
          const dt = f.top[n] - t;
          if (steps && away === 0 && !f.wet[c] && !f.wet[n]) {
            // A rise of one voxel: the low side's edge a quarter or a half up, the high side's a
            // quarter or a half down, so the step is four small irregular ones.
            const jit = hash(sx, sy, 1) < 0.5 ? 1 : 2;
            if (dt === 1) hgt = Math.max(hgt, t * SUB + jit);
            else if (dt === -1) hgt = Math.min(hgt, t * SUB - jit);
            // A cliff's lip, broken here and there.
            else if (dt <= -2 && hash(sx, sy, 2) < 0.3) hgt = Math.min(hgt, t * SUB - 1);
          }
          if (blend && f.wet[c] && !f.wet[n] && f.water[c] > -1e8 && f.top[n] >= f.water[c] - 0.5 && (away === 0 ? 0.45 : 0) > hash(sx, sy, 3 + d)) {
            // Sand that pokes out of the shallows along the shore, just above the water.
            const above = Math.ceil((f.water[c] + 0.06) * SUB);
            hgt = Math.max(hgt, above, Math.min(f.top[n] * SUB - (hash(sx, sy, 9) < 0.5 ? 0 : 1), above + 1));
            src = n;
          } else if (
            blend &&
            src === c &&
            !f.wet[c] &&
            !f.wet[n] &&
            f.blends[c] &&
            f.blends[n] &&
            f.ground[n] !== f.ground[c] &&
            Math.abs(dt) <= 1 &&
            (away === 0 ? 0.42 : 0.14) > hash(sx, sy, 13 + d)
          ) {
            // Two grounds that meet mix over a quarter voxel or two.
            src = n;
          }
        }
        if (bits && !f.wet[c] && src === c) {
          const r = hash(sx, sy, 21);
          if (f.flowers[c] && r < 0.014) bit = FLOWERS[Math.floor(hash(sx, sy, 22) * FLOWERS.length)];
          else if (f.pebbles[c] && r < 0.012) bit = PEBBLES[Math.floor(hash(sx, sy, 22) * PEBBLES.length)];
          if (bit) hgt += 1;
        }
      }
      H[s] = hgt;
      D[s] = f.wet[c] || src !== c ? 0 : 1;
      let col = bit || f.color[src];
      if (grain && f.natural[c] && !bit) col = scaleColor(col, GRAIN[Math.floor(hash(sx >> 1, sy >> 1, 31) * GRAIN.length)]);
      C[s] = col;
    }
  }
  // Tops lower than a neighbour sit in its shadow (a cheap occlusion, kept in the colour so tops
  // still merge).
  for (let j = 1; j < SH - 1; j++)
    for (let k = 1; k < SW - 1; k++) {
      const s = j * SW + k;
      const h0 = H[s];
      if (H[s + 1] > h0 || H[s - 1] > h0 || H[s + SW] > h0 || H[s - SW] > h0) C[s] = scaleColor(C[s], 0.86);
    }

  // Tops, merged into rectangles of one height and colour.
  DONE.fill(0, 0, SW * SH);
  const top = FACE_LIGHT.top;
  for (let j = 1; j < SH - 1; j++) {
    for (let k = 1; k < SW - 1; k++) {
      const s = j * SW + k;
      if (DONE[s]) continue;
      const h0 = H[s];
      const c0 = C[s];
      const d0 = D[s];
      let k1 = k + 1;
      while (k1 < SW - 1 && !DONE[j * SW + k1] && H[j * SW + k1] === h0 && C[j * SW + k1] === c0 && D[j * SW + k1] === d0) k1++;
      let j1 = j + 1;
      grow: while (j1 < SH - 1) {
        for (let q = k; q < k1; q++) {
          const t = j1 * SW + q;
          if (DONE[t] || H[t] !== h0 || C[t] !== c0 || D[t] !== d0) break grow;
        }
        j1++;
      }
      for (let jj = j; jj < j1; jj++) DONE.fill(1, jj * SW + k, jj * SW + k1);
      const x0 = (sx0 + k) * Q + ox;
      const z0 = (sy0 + j) * Q + oz;
      out.rect(4, x0, x0 + (k1 - k) * Q, h0 * Q, h0 * Q, z0, z0 + (j1 - j) * Q, c0, top, 1, d0);
    }
  }

  // Walls toward lower neighbours, in layers: the top's own colour for a quarter voxel or two
  // (jagged), soil, stone in strata, the deep rock.
  for (let j = 1; j < SH - 1; j++) {
    for (let k = 1; k < SW - 1; k++) {
      const s = j * SW + k;
      const T = H[s];
      const sx = sx0 + k;
      const sy = sy0 + j;
      const cx = Math.floor(sx / SUB);
      const cy = Math.floor(sy / SUB);
      const c = fineAt(f, cx, cy);
      if (!f.inside[c]) continue;
      for (let d = 0; d < 4; d++) {
        const t = s + DX[d] + DY[d] * SW;
        let low = H[t];
        // Past the chunk's edge the neighbour may be drawn as whole cells: the wall goes down to
        // its cell's top too, so no gap opens between the two.
        const nk = k + DX[d];
        const nj = j + DY[d];
        if (nk === 0 || nj === 0 || nk === SW - 1 || nj === SH - 1) {
          const n = fineAt(f, Math.floor((sx + DX[d]) / SUB), Math.floor((sy + DY[d]) / SUB));
          low = f.inside[n] ? Math.min(low, f.top[n] * SUB) : bottom;
        }
        if (low >= T) continue;
        wall(f, out, c, d, sx, sy, T, low, ox, oz, grain, blend);
      }
    }
  }

  if (GRAPHICS.foam) foam(f, out, sx0, sy0, SW, SH, ox, oz);
}

const WALL_LIGHT = [FACE_LIGHT.east, FACE_LIGHT.south, FACE_LIGHT.west, FACE_LIGHT.north];

function wall(
  f: FineCells,
  out: Writer,
  c: number,
  d: number,
  sx: number,
  sy: number,
  T: number,
  low: number,
  ox: number,
  oz: number,
  grain: boolean,
  blend: boolean,
): void {
  const light = WALL_LIGHT[d];
  const bottom = f.bottom * SUB;
  const foot = low > bottom ? CREASE : 1;
  // The face's place: the side d of quarter voxel (sx, sy).
  const X = sx * Q + ox;
  const Z = sy * Q + oz;
  const x0 = d === 0 ? X + Q : X;
  const x1 = d === 2 ? X : X + Q;
  const z0 = d === 1 ? Z + Q : Z;
  const z1 = d === 3 ? Z : Z + Q;
  const face = (lo: number, hi: number, color: number) => {
    if (hi <= lo) return;
    const shade = light * (1 - Math.min(0.25, (T - hi) * Q * 0.03));
    out.rect(d, x0, x1, lo * Q, hi * Q, z0, z1, color, shade, 1, 0, lo === low ? foot : 1);
  };
  if (!f.natural[c]) {
    face(low, T, f.edge[c]);
    return;
  }
  const top = f.top[c] * SUB;
  // The top's own colour: one quarter voxel, two here and there, three now and then on grass.
  const g = 1 + (hash(sx, sy, 41 + d) < 0.4 ? 1 : 0) + (f.hangs[c] && hash(sx, sy, 45 + d) < 0.15 ? 1 : 0);
  const edgeLo = Math.max(low, T - g);
  face(edgeLo, T, f.edge[c]);
  // Soil to three voxels below the cell's top, with a grain of its own.
  const soilLo = Math.max(low, Math.min(edgeLo, top - 3 * SUB));
  const soil = grain ? scaleColor(f.soil[c], GRAIN[Math.floor(hash(sx, sy, 51 + d) * GRAIN.length)]) : f.soil[c];
  face(soilLo, edgeLo, soil);
  // Stone down to the deep rock; in bands of two voxels by height with grain.
  const deepTop = Math.max(low, bottom + 2 * SUB);
  let hi = soilLo;
  if (grain) {
    let courses = 0;
    while (hi > deepTop) {
      const band = Math.floor((hi - 1) / (2 * SUB));
      const lo = courses >= 5 ? deepTop : Math.max(deepTop, band * 2 * SUB);
      const tone = STRATA_TONE[((band % STRATA_TONE.length) + STRATA_TONE.length) % STRATA_TONE.length] * (0.96 + hash(sx, sy, 61 + courses) * 0.08);
      face(lo, hi, scaleColor(f.stone[c], tone));
      hi = lo;
      courses++;
    }
  } else if (hi > deepTop) {
    face(deepTop, hi, f.stone[c]);
    hi = deepTop;
  }
  face(low, Math.min(hi, bottom + 2 * SUB), f.deep[c]);
  // Grass and snow that hang over the edge of a cliff (blend).
  if (blend && f.hangs[c] && !f.wet[c] && T - low >= 3 && T >= top - 1 && hash(sx, sy, 71 + d) < 0.32) {
    const drop = 1 + (hash(sx, sy, 75 + d) < 0.4 ? 1 : 0);
    const reach = Q * 0.6;
    const ex0 = d === 0 ? x1 : d === 2 ? x0 - reach : x0;
    const ex1 = d === 0 ? x1 + reach : d === 2 ? x0 : x1;
    const ez0 = d === 1 ? z1 : d === 3 ? z0 - reach : z0;
    const ez1 = d === 1 ? z1 + reach : d === 3 ? z0 : z1;
    const yl = (T - drop) * Q;
    const yh = T * Q;
    out.rect(4, ex0, ex1, yh, yh, ez0, ez1, f.color[c], FACE_LIGHT.top, 1, 0);
    out.rect(d, ex0, ex1, yl, yh, ez0, ez1, f.edge[c], light, 1, 0);
    out.rect(5, ex0, ex1, yl, yl, ez0, ez1, scaleColor(f.edge[c], 0.7), light, 1, 0);
    // Its two ends.
    const e1 = (d + 1) % 4;
    const e2 = (d + 3) % 4;
    out.rect(e1, ex0, ex1, yl, yh, ez0, ez1, f.edge[c], WALL_LIGHT[e1], 1, 0);
    out.rect(e2, ex0, ex1, yl, yh, ez0, ez1, f.edge[c], WALL_LIGHT[e2], 1, 0);
  }
}

// A ring of white foam voxels on the water where it meets land, and a broken second ring.
function foam(f: FineCells, out: Writer, sx0: number, sy0: number, SW: number, SH: number, ox: number, oz: number): void {
  const dry = (s: number, sx: number, sy: number, surface: number) => {
    const n = fineAt(f, Math.floor(sx / SUB), Math.floor(sy / SUB));
    if (!f.inside[n]) return false;
    return !f.wet[n] || H[s] * Q > surface;
  };
  for (let j = 1; j < SH - 1; j++) {
    for (let k = 1; k < SW - 1; k++) {
      const s = j * SW + k;
      const sx = sx0 + k;
      const sy = sy0 + j;
      const c = fineAt(f, Math.floor(sx / SUB), Math.floor(sy / SUB));
      const surface = f.water[c];
      if (surface < -1e8 || H[s] * Q > surface) continue;
      let ring = 0;
      for (let d = 0; d < 4 && !ring; d++) if (dry(s + DX[d] + DY[d] * SW, sx + DX[d], sy + DY[d], surface)) ring = 1;
      if (!ring) {
        for (const [dx, dy] of DIAG) if (dry(s + dx + dy * SW, sx + dx, sy + dy, surface)) ring = 2;
        if (ring && hash(sx, sy, 81) > 0.55) ring = 0;
      }
      if (!ring) continue;
      const y = surface + 0.035;
      const X = sx * Q + ox;
      const Z = sy * Q + oz;
      const color = ring === 1 ? FOAM[Math.floor(hash(sx, sy, 83) * FOAM.length)] : mixColor(FOAM[0], 0x9fd8ee, 0.35);
      out.rect(4, X, X + Q, y, y, Z, Z + Q, color, 1, 1, 0);
    }
  }
}
const DIAG: [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
