// Cliffs on their own line (27 November, the owner: "cliffs: rebuild"; terrain-fine.ts
// cliffOutline, on in the game since 28 November). On cells laid out by hand (a cliff of four voxels along
// a line at 0, 18.4, 26.6, 45 and 63.4 degrees, a terrace of three levels, a cliff over lava, cells
// that must keep their land, a canyon a cell wide), the fine mesher's tops (FineTops) at eighths and
// quarters, with the outline off (main: cliffCorner) and on:
//   1. the lip's RMS distance from the true line (cells, the best offset taken), at most 0.1 on;
//   2. teeth: straight runs of the lip along an axis at least 0.3 cell and more than two columns
//      longer than a true line's steps at that angle, on lines more than 15 degrees off the axes:
//      none on;
//   3. columns moved to a neighbour's land: none along the 0 degree cliff;
//   4. the mesher's tops are the field creatures read (fieldStep of fieldHeight on a LandRead of
//      the same cells), but for the lip's broken columns, as on main;
//   5. houses, paths and roads keep every column; a tree's cell keeps its middle (0.3 cell);
//   6. a straight canyon a cell wide keeps its width; lava never takes a column of the cliff;
//   7. no tan strip down a coast's cliff (scripts/cliff-corner-test.ts's islands, the outline on).
// The triangles a cell of cliff costs are measured, not checked yet. Run with the other checks (npm
// test, scripts/sim-test.ts); `node node_modules/.cache/cliff-outline.mjs` prints the table alone.
import { MeshBasicMaterial } from "three";
import { CHUNK, Terrain, WALK_STEP, Writer, columnTop } from "../src/sim/voxel/terrain";
import { STEP } from "../src/sim/voxel/walk";
import { generateWorld } from "../src/sim/world";
import { readLand } from "../src/sim/land-options";
import { WORLD_SIZES } from "../src/sim/sizes";
import { KINDS, makeCreature, resetCreatureIds } from "../src/sim/creatures";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import {
  CLIFF_CORNER,
  CLIFF_OUTLINE,
  TILE,
  buildFineTile,
  fieldHeight,
  fieldStep,
  fineAt,
  joins,
  makeFineCells,
  outlineTradeCells,
  sizeFineCells,
  type FineCells,
  type FineTops,
  type LandRead,
} from "../src/sim/voxel/terrain-fine";
import { GRAPHICS, PRESETS, type LooksFlag } from "../src/sim/voxel/graphics";
import { G } from "../src/sim/materials";
import { CLIFF_ISLANDS, cliffCorners } from "./cliff-corner-test";

type Check = (name: string, ok: boolean, detail?: string) => void;

// The island, the chunk built and the cells measured (away from the chunk's border).
const W = 40;
const X0 = 8;
const X1 = 32;
const M0 = 11;
const M1 = 29;
const LOW = 6;
const HIGH = 10;
const BOTTOM = -4;

interface Cell {
  top: number;
  ground?: number;
  wet?: "water" | "lava";
  anchored?: boolean;
  flat?: boolean;
  built?: boolean;
  square?: boolean;
}
type Layout = (x: number, y: number) => Cell;

function fill(layout: Layout): FineCells {
  const f = makeFineCells();
  sizeFineCells(f, X0, X0, X1, X1, W, W, BOTTOM);
  for (let y = X0 - 3; y < X1 + 3; y++)
    for (let x = X0 - 3; x < X1 + 3; x++) {
      const k = fineAt(f, x, y);
      const c = layout(x, y);
      const g = c.ground ?? G.GRASS;
      f.inside[k] = 1;
      f.top[k] = c.top;
      f.ground[k] = g;
      f.natural[k] = c.built ? 0 : 1;
      f.wet[k] = c.wet ? 1 : 0;
      f.water[k] = c.wet ? c.top + 0.6 : -1e9;
      f.lava[k] = c.wet === "lava" ? 1 : 0;
      f.ice[k] = 0;
      f.color[k] = g === G.ROCK ? 0x8a8378 : g === G.PATH ? 0xb59a6a : 0x5f9e45;
      f.tone[k] = 0x1000000;
      f.edge[k] = 0x7a6a50;
      f.soil[k] = 0x6b5236;
      f.stone[k] = 0x8a8378;
      f.deep[k] = 0x6d675f;
      f.blends[k] = 0;
      f.hangs[k] = 0;
      f.flowers[k] = 0;
      f.pebbles[k] = 0;
      f.flat[k] = c.flat ? 1 : 0;
      f.value[k] = c.top;
      f.raw[k] = c.top;
      f.anchored[k] = c.anchored || c.wet || c.flat || g === G.PATH ? 1 : 0;
      f.steep[k] = 0;
      f.square[k] = c.square ? 1 : 0;
      f.wdeep[k] = 0x204060;
      f.wshallow[k] = 0x3070a0;
      f.wnarrow[k] = 0;
      f.wlake[k] = 0;
      f.soft[k] = 0;
      f.softOn[k] = 0;
      f.weed[k] = 0;
      f.weedLand[k] = 0;
      f.weedKeep[k] = 0;
    }
  // Ground next to wet cells is anchored, as Terrain.anchoredAt has it.
  for (let y = X0 - 3; y < X1 + 3; y++)
    for (let x = X0 - 3; x < X1 + 3; x++) {
      const k = fineAt(f, x, y);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const n = layout(x + dx, y + dy);
        if (n.wet) f.anchored[k] = 1;
      }
    }
  return f;
}

// The same cells as the island reads them for groundAt (Terrain.landRead).
function landOf(f: FineCells): LandRead {
  const at = (x: number, y: number) => fineAt(f, Math.max(X0 - 3, Math.min(X1 + 2, x)), Math.max(X0 - 3, Math.min(X1 + 2, y)));
  return {
    top: (x, y) => f.top[at(x, y)],
    value: (x, y) => f.value[at(x, y)],
    anchored: (x, y) => f.anchored[at(x, y)] === 1,
    flat: (x, y) => f.flat[at(x, y)] === 1,
    linked: (ax, ay, bx, by) => {
      const a = at(ax, ay);
      const b = at(bx, by);
      if (f.wet[a] || f.wet[b] || f.flat[a] || f.flat[b] || !f.natural[a] || !f.natural[b]) return false;
      return joins(f.top[b] - f.top[a], f.steep[a] === 1, f.steep[b] === 1);
    },
    steep: (x, y) => f.steep[at(x, y)] === 1,
    bed: (x, y) => {
      const c = at(x, y);
      return f.wet[c] === 1 && f.lava[c] === 0 && f.natural[c] === 1;
    },
    wet: (x, y) => f.wet[at(x, y)] === 1,
    natural: (x, y) => f.natural[at(x, y)] === 1,
    way: (x, y) => f.ground[at(x, y)] === G.PATH || f.ground[at(x, y)] === G.ROAD,
  };
}

interface Built {
  tops: FineTops;
  tris: number;
  ms: number;
  out: Writer;
}
function build(f: FineCells, sub: number): Built {
  const stride = (X1 - X0) * sub;
  const tops: FineTops = { h: new Int16Array(stride * stride), x0: X0, y0: X0, stride };
  const out = new Writer();
  const t0 = performance.now();
  for (let ty = X0; ty < X1; ty += TILE)
    for (let tx = X0; tx < X1; tx += TILE) buildFineTile(f, out, 0, 0, sub, tx, ty, tx + TILE, ty + TILE, tops, null, false);
  return { tops, tris: out.quads * 2, ms: performance.now() - t0, out };
}
// Ribs: of the wall faces at mid-height (scene height y, in voxels) in the measured cells,
// the share of their area turned more than 10 degrees from the line at angle a. A wall of columns
// along the axes is all ribs on a slanted line; a flat wall none.
function ribsOf(out: Writer, a: number, y: number): number {
  const { pos } = out.vertexArrays();
  const r = (a * Math.PI) / 180;
  const lx = Math.cos(r);
  const lz = Math.sin(r);
  let all = 0;
  let ribs = 0;
  for (let q = 0; q < out.quads; q++) {
    const o = q * 18;
    let y0 = Infinity;
    let y1 = -Infinity;
    let mx = 0;
    let mz = 0;
    for (let v = 0; v < 6; v++) {
      y0 = Math.min(y0, pos[o + 3 * v + 1]);
      y1 = Math.max(y1, pos[o + 3 * v + 1]);
      mx += pos[o + 3 * v] / 6;
      mz += pos[o + 3 * v + 2] / 6;
    }
    if (!(y0 < y && y1 > y) || mx < M0 || mx >= M1 || mz < M0 || mz >= M1) continue;
    const ux = pos[o + 3] - pos[o];
    const uy = pos[o + 4] - pos[o + 1];
    const uz = pos[o + 5] - pos[o + 2];
    const vx = pos[o + 6] - pos[o];
    const vy = pos[o + 7] - pos[o + 1];
    const vz = pos[o + 8] - pos[o + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const h = Math.hypot(nx, nz);
    if (h < 1e-9 || Math.abs(ny) > h) continue;
    // Two triangles of the same area: the face's area is the cross product's length. Its horizontal
    // normal against the line's: sin of the turn is the normal's part along the line.
    const area = Math.hypot(nx, ny, nz);
    all += area;
    if (Math.abs(nx * lx + nz * lz) / h > Math.sin((10 * Math.PI) / 180)) ribs += area;
  }
  return all ? ribs / all : 0;
}

// Cracks: upright edges of the flat walls' triangles (turned off the axes) in the measured cells
// that no triangle shares end for end (the same two points, the other way round), though another
// wall's upright edge lies on the same line. Two walls that meet there with edges of different ends
// (one from 7 to 9.75, the next from 7 to 9.625) leave such a pair, and the screen shows it as a row
// of pale pinholes (forest-plateau-2's eye frame, 28 November). Returns the count and the first
// one's middle.
export function cracksOf(out: Writer): { cracks: number; at: string } {
  const { pos } = out.vertexArrays();
  const key = (i: number) => `${pos[3 * i]},${pos[3 * i + 1]},${pos[3 * i + 2]}`;
  const edges = new Map<string, number>();
  // Upright edges by their line (x, z): their spans, going down (-) or up (+).
  const lines = new Map<string, number[]>();
  const slanted: string[] = [];
  const n = out.quads * 6;
  for (let t = 0; t < n; t += 3) {
    const ux = pos[3 * (t + 1)] - pos[3 * t];
    const uy = pos[3 * (t + 1) + 1] - pos[3 * t + 1];
    const uz = pos[3 * (t + 1) + 2] - pos[3 * t + 2];
    const vx = pos[3 * (t + 2)] - pos[3 * t];
    const vy = pos[3 * (t + 2) + 1] - pos[3 * t + 1];
    const vz = pos[3 * (t + 2) + 2] - pos[3 * t + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const slant = Math.abs(ny) < 1e-6 * Math.hypot(nx, nz) && Math.min(Math.abs(nx), Math.abs(nz)) > 1e-4 * Math.max(Math.abs(nx), Math.abs(nz));
    for (let e = 0; e < 3; e++) {
      const i = t + e;
      const j = t + ((e + 1) % 3);
      const a = key(i);
      const b = key(j);
      if (a === b) continue;
      const k = `${a}|${b}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
      if (pos[3 * i] !== pos[3 * j] || pos[3 * i + 2] !== pos[3 * j + 2]) continue;
      const line = `${pos[3 * i]},${pos[3 * i + 2]}`;
      const l = lines.get(line) ?? [];
      l.push(pos[3 * i + 1], pos[3 * j + 1]);
      lines.set(line, l);
      if (slant) slanted.push(k);
    }
  }
  let cracks = 0;
  let at = "";
  for (const k of slanted) {
    const [a, b] = k.split("|");
    if ((edges.get(`${b}|${a}`) ?? 0) > 0) continue;
    const pa = a.split(",").map(Number);
    const pb = b.split(",").map(Number);
    const mx = (pa[0] + pb[0]) / 2;
    const my = (pa[1] + pb[1]) / 2;
    const mz = (pa[2] + pb[2]) / 2;
    if (mx < M0 || mx >= M1 || mz < M0 || mz >= M1) continue;
    // Another wall's edge the other way round beside it, over some of its height: two walls meet
    // there. Else it is the wall's own end (its outline, a foot over lower land), not a meeting.
    const l = lines.get(`${pa[0]},${pa[2]}`) ?? [];
    const lo = Math.min(pa[1], pb[1]);
    const hi = Math.max(pa[1], pb[1]);
    let met = false;
    for (let q = 0; q < l.length && !met; q += 2)
      met = Math.sign(l[q + 1] - l[q]) === Math.sign(pa[1] - pb[1]) && Math.min(l[q], l[q + 1]) < hi - 1e-6 && Math.max(l[q], l[q + 1]) > lo + 1e-6;
    if (!met) continue;
    cracks++;
    if (!at) at = `(${mx.toFixed(3)}, ${my.toFixed(3)}, ${mz.toFixed(3)})`;
  }
  return { cracks, at };
}

// The side of the line through (CX, CY) at angle a (degrees) a point lies on, cells.
const CX = 20.31;
const CY = 20.17;
function lineSide(a: number, x: number, y: number): number {
  const r = (a * Math.PI) / 180;
  return -(x - CX) * Math.sin(r) + (y - CY) * Math.cos(r);
}
const along =
  (a: number): Layout =>
  (x, y) => ({ top: lineSide(a, x + 0.5, y + 0.5) > 0 ? HIGH : LOW });

// The lip between columns drawn at `level` or above and below it, in the measured cells: the
// middles of the column edges between them (x, y pairs), and the straight runs along each axis.
interface Lip {
  mids: number[];
  runsX: number[]; // lengths in cells of runs along x
  runsY: number[];
}
function lipOf(t: FineTops, sub: number, level: number): Lip {
  const Q = 1 / sub;
  const n = t.stride;
  const hi = (i: number, j: number) => t.h[j * n + i] >= level * sub;
  const i0 = (M0 - X0) * sub;
  const i1 = (M1 - X0) * sub;
  const lip: Lip = { mids: [], runsX: [], runsY: [] };
  // Edges between rows j - 1 and j (along x), and between columns i - 1 and i (along y).
  for (let j = i0 + 1; j < i1; j++) {
    let run = 0;
    for (let i = i0; i <= i1; i++) {
      const edge = i < i1 && hi(i, j - 1) !== hi(i, j);
      if (edge) {
        lip.mids.push(X0 + (i + 0.5) * Q, X0 + j * Q);
        run++;
      } else if (run) {
        lip.runsX.push(run * Q);
        run = 0;
      }
    }
  }
  for (let i = i0 + 1; i < i1; i++) {
    let run = 0;
    for (let j = i0; j <= i1; j++) {
      const edge = j < i1 && hi(i - 1, j) !== hi(i, j);
      if (edge) {
        lip.mids.push(X0 + i * Q, X0 + (j + 0.5) * Q);
        run++;
      } else if (run) {
        lip.runsY.push(run * Q);
        run = 0;
      }
    }
  }
  return lip;
}
// RMS distance of the lip's middles from a line at angle a, with the best offset.
function rmsOf(lip: Lip, a: number): number {
  const d: number[] = [];
  for (let k = 0; k < lip.mids.length; k += 2) d.push(lineSide(a, lip.mids[k], lip.mids[k + 1]));
  const mean = d.reduce((s, v) => s + v, 0) / Math.max(1, d.length);
  return Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, d.length));
}
// Teeth: runs along an axis at least 0.3 cell and more than two columns longer than a true line's
// steps at angle a (the wave alone makes runs two columns longer).
function teethOf(lip: Lip, a: number, sub: number): number {
  const Q = 1 / sub;
  const r = (a * Math.PI) / 180;
  const t = Math.abs(Math.tan(r));
  const idealX = t < 1e-6 ? Infinity : Q / t;
  const idealY = Q * t;
  const long = (ideal: number) => (v: number) => v >= 0.3 && v > ideal + 2 * Q + 1e-9;
  return lip.runsX.filter(long(idealX)).length + lip.runsY.filter(long(idealY)).length;
}
// Length of the line inside the measured square, cells.
function lengthIn(a: number): number {
  let n = 0;
  const steps = 4000;
  for (let k = 0; k < steps; k++) {
    const s = (k / steps - 0.5) * 60;
    const r = (a * Math.PI) / 180;
    const x = CX + s * Math.cos(r);
    const y = CY + s * Math.sin(r);
    if (x >= M0 && x < M1 && y >= M0 && y < M1) n++;
  }
  return (n / steps) * 60;
}

// Columns of the chunk drawn as a neighbour's land, and where.
function traded(f: FineCells, sub: number, keep?: (cx: number, cy: number, px: number, py: number, k: number) => void): number {
  let n = 0;
  for (let sy = X0 * sub; sy < X1 * sub; sy++)
    for (let sx = X0 * sub; sx < X1 * sub; sx++) {
      const px = (sx + 0.5) / sub;
      const py = (sy + 0.5) / sub;
      const k = outlineTradeCells(f, px, py);
      if (k < 0) continue;
      n++;
      keep?.(Math.floor(px), Math.floor(py), px, py, k);
    }
  return n;
}

// The mesher's tops against fieldStep(fieldHeight(...)) on the dry columns it reads the field for:
// columns that differ, and of them those that are not a cliff lip's broken column (cut to a column
// under its cell's height, beside a column a voxel or more lower).
function feetGap(f: FineCells, t: FineTops, sub: number): { differ: number; wrong: number; at: string } {
  const land = landOf(f);
  const out = { differ: 0, wrong: 0, at: "" };
  const n = t.stride;
  for (let j = 1; j < n - 1; j++)
    for (let i = 1; i < n - 1; i++) {
      const px = X0 + (i + 0.5) / sub;
      const py = X0 + (j + 0.5) / sub;
      const k = outlineTradeCells(f, px, py);
      const cx = Math.floor(px) + (CLIFF_OUTLINE.on && k >= 0 ? (k % 3) - 1 : 0);
      const cy = Math.floor(py) + (CLIFF_OUTLINE.on && k >= 0 ? Math.floor(k / 3) - 1 : 0);
      const c = fineAt(f, cx, cy);
      if (f.wet[c] || !f.natural[c]) continue;
      const want = fieldStep(fieldHeight(land, px, py), px, py, sub);
      const got = t.h[j * n + i];
      if (got === want) continue;
      out.differ++;
      const lower = Math.min(t.h[j * n + i - 1], t.h[j * n + i + 1], t.h[(j - 1) * n + i], t.h[(j + 1) * n + i]);
      if (got < want && got === f.top[c] * sub - Math.max(1, sub >> 3) && got - lower >= sub - 1) continue;
      out.wrong++;
      if (!out.at) out.at = `(${px.toFixed(3)}, ${py.toFixed(3)}) drawn ${got}, field ${want}`;
    }
  return out;
}

interface Mode {
  name: string;
  corner: boolean;
  outline: boolean;
  sharp?: number;
  walls?: boolean;
}
const MAIN: Mode = { name: "main", corner: true, outline: false };
const OUTLINE: Mode = { name: "outline", corner: true, outline: true };
// The prototype of 27 November (no flat walls, no sharp corners), for the ribs.
const PROTOTYPE: Mode = { name: "prototype", corner: true, outline: true, sharp: 0, walls: false };
function withMode<T>(m: Mode, fn: () => T): T {
  const was = { ...GRAPHICS };
  const wasCorner = CLIFF_CORNER.on;
  const wasOutline = { ...CLIFF_OUTLINE };
  try {
    for (const [k, v] of Object.entries(PRESETS.high)) GRAPHICS[k as LooksFlag] = v;
    CLIFF_CORNER.on = m.corner;
    CLIFF_OUTLINE.on = m.outline;
    if (m.sharp !== undefined) CLIFF_OUTLINE.sharpRun = m.sharp;
    if (m.walls !== undefined) CLIFF_OUTLINE.walls = m.walls;
    return fn();
  } finally {
    Object.assign(GRAPHICS, was);
    CLIFF_CORNER.on = wasCorner;
    Object.assign(CLIFF_OUTLINE, wasOutline);
  }
}

export interface AngleRow {
  angle: number;
  sub: number;
  mode: string;
  rms: number;
  teeth: number;
  per10: number;
  trisPerCell: number;
  traded: number;
  differ: number;
  wrong: number;
  wrongAt: string;
  ms: number;
  ribs: number;
}
// 0, 3:1, 2:1, 45 degrees and 1:2.
const DEG = 180 / Math.PI;
export const ANGLES = [0, Math.atan(1 / 3) * DEG, Math.atan(1 / 2) * DEG, 45, Math.atan(2) * DEG];
export function angleRows(): AngleRow[] {
  const rows: AngleRow[] = [];
  const flat = fill(() => ({ top: LOW }));
  for (const sub of [8, 4])
    for (const m of [MAIN, PROTOTYPE, OUTLINE])
      withMode(m, () => {
        const base = build(flat, sub).tris;
        for (const a of ANGLES) {
          const f = fill(along(a));
          const b = build(f, sub);
          const lip = lipOf(b.tops, sub, (LOW + HIGH) / 2);
          const teeth = teethOf(lip, a, sub);
          const len = lengthIn(a);
          const g = feetGap(f, b.tops, sub);
          rows.push({
            angle: a,
            sub,
            mode: m.name,
            rms: rmsOf(lip, a),
            teeth,
            per10: (teeth / len) * 10,
            trisPerCell: (b.tris - base) / lengthChunk(a),
            traded: m.outline ? traded(f, sub) : 0,
            differ: g.differ,
            wrong: g.wrong,
            wrongAt: g.at,
            ms: b.ms,
            ribs: ribsOf(b.out, a, (LOW + HIGH) / 2),
          });
        }
      });
  return rows;
}
// Length of the line inside the chunk, cells.
function lengthChunk(a: number): number {
  let n = 0;
  const steps = 4000;
  const r = (a * Math.PI) / 180;
  for (let k = 0; k < steps; k++) {
    const s = (k / steps - 0.5) * 80;
    const x = CX + s * Math.cos(r);
    const y = CY + s * Math.sin(r);
    if (x >= X0 && x < X1 && y >= X0 && y < X1) n++;
  }
  return (n / steps) * 80;
}

// A terrace: a band of middle land about a cell and a half wide between a high plateau and the low
// land, along a line at 33.7 degrees (three levels meet round many corners).
const TERRACE_A = Math.atan(2 / 3) * DEG;
const terrace: Layout = (x, y) => {
  const s = lineSide(TERRACE_A, x + 0.5, y + 0.5);
  return { top: s > 0.8 ? 14 : s > -0.7 ? 10 : LOW };
};
// A cliff over lava at 26.6 degrees: the low side lava.
const LAVA_A = Math.atan(1 / 2) * DEG;
const lavaFoot: Layout = (x, y) => (lineSide(LAVA_A, x + 0.5, y + 0.5) > 0 ? { top: HIGH, ground: G.ROCK } : { top: LOW, wet: "lava", ground: G.ROCK });
// Cells that keep their land, along a 45 degree cliff: a house, a path, a road, a built column and
// trees on both sides.
const KEEP_A = 45;
function keepKind(x: number, y: number): "house" | "path" | "road" | "built" | "tree" | null {
  const h = (x * 7 + y * 13) % 11;
  return h === 0 ? "house" : h === 3 ? "path" : h === 5 ? "road" : h === 7 ? "built" : h === 9 || h === 2 ? "tree" : null;
}
const keeping: Layout = (x, y) => {
  const top = lineSide(KEEP_A, x + 0.5, y + 0.5) > 0 ? HIGH : LOW;
  const k = keepKind(x, y);
  return {
    top,
    flat: k === "house",
    ground: k === "path" ? G.PATH : k === "road" ? G.ROAD : G.GRASS,
    built: k === "built",
    anchored: k === "tree",
  };
};
// A canyon a cell wide, straight along y at x = 20, and one along a 45 degree line.
const canyon: Layout = (x) => ({ top: x === 20 ? LOW : HIGH });
const canyon45: Layout = (x, y) => ({ top: x - y === 1 ? LOW : HIGH });

export interface Extra {
  terrace: { mode: string; sub: number; rmsLow: number; rmsHigh: number; teeth: number; odd: number }[];
  lava: { mode: string; sub: number; rms: number; teeth: number; cut: number; fill: number }[];
  keep: { moved: number; tree: number; treeNear: number };
  canyon: { mode: string; sub: number; minWidth: number; maxWidth: number; diagMean: number }[];
}
// Cracks on the flat walls of straight cliffs, the terrace and the lava foot (cracksOf).
export function crackRows(): { mode: string; sub: number; what: string; cracks: number; at: string }[] {
  const rows: { mode: string; sub: number; what: string; cracks: number; at: string }[] = [];
  for (const sub of [8, 4])
    for (const m of [OUTLINE])
      withMode(m, () => {
        for (const a of ANGLES) rows.push({ mode: m.name, sub, what: `${a} deg`, ...cracksOf(build(fill(along(a)), sub).out) });
        rows.push({ mode: m.name, sub, what: "terrace", ...cracksOf(build(fill(terrace), sub).out) });
        rows.push({ mode: m.name, sub, what: "lava", ...cracksOf(build(fill(lavaFoot), sub).out) });
      });
  return rows;
}

export function extraRows(): Extra {
  const out: Extra = { terrace: [], lava: [], keep: { moved: 0, tree: 0, treeNear: 0 }, canyon: [] };
  for (const sub of [8, 4])
    for (const m of [MAIN, OUTLINE])
      withMode(m, () => {
        // Terrace: both lips, and columns at a level none of the four cells round its corner has.
        const f = fill(terrace);
        const b = build(f, sub);
        const lo = lipOf(b.tops, sub, 8);
        const hi = lipOf(b.tops, sub, 12);
        let odd = 0;
        const n = b.tops.stride;
        for (let j = 0; j < n; j++)
          for (let i = 0; i < n; i++) {
            const v = b.tops.h[j * n + i] / sub;
            if (Math.abs(v - LOW) > 1.2 && Math.abs(v - 10) > 1.2 && Math.abs(v - 14) > 1.2) odd++;
          }
        out.terrace.push({
          mode: m.name,
          sub,
          rmsLow: rmsOf(lo, TERRACE_A),
          rmsHigh: rmsOf(hi, TERRACE_A),
          teeth: teethOf(lo, TERRACE_A, sub) + teethOf(hi, TERRACE_A, sub),
          odd,
        });
        // Lava: dry columns drawn as lava (a cut), lava columns drawn as rock (a fill).
        const l = fill(lavaFoot);
        const lb = build(l, sub);
        let cut = 0;
        let fillN = 0;
        if (m.outline)
          traded(l, sub, (cx, cy, _px, _py, k) => {
            const t = fineAt(l, cx + (k % 3) - 1, cy + Math.floor(k / 3) - 1);
            if (l.wet[t]) cut++;
            else if (l.wet[fineAt(l, cx, cy)]) fillN++;
          });
        const ll = lipOf(lb.tops, sub, (LOW + HIGH) / 2);
        out.lava.push({ mode: m.name, sub, rms: rmsOf(ll, LAVA_A), teeth: teethOf(ll, LAVA_A, sub), cut, fill: fillN });
        // A canyon a cell wide: low columns a row, and across the 45 degree one.
        const cf = fill(canyon);
        const cb = build(cf, sub);
        let minW = Infinity;
        let maxW = 0;
        for (let j = (M0 - X0) * sub; j < (M1 - X0) * sub; j++) {
          let w = 0;
          for (let i = 0; i < cb.tops.stride; i++) if (cb.tops.h[j * cb.tops.stride + i] < 8 * sub) w++;
          minW = Math.min(minW, w);
          maxW = Math.max(maxW, w);
        }
        const df = fill(canyon45);
        const db = build(df, sub);
        let low = 0;
        for (let j = (M0 - X0) * sub; j < (M1 - X0) * sub; j++)
          for (let i = (M0 - X0) * sub; i < (M1 - X0) * sub; i++) if (db.tops.h[j * db.tops.stride + i] < 8 * sub) low++;
        out.canyon.push({ mode: m.name, sub, minWidth: minW / sub, maxWidth: maxW / sub, diagMean: low / sub / sub / ((M1 - M0) * Math.SQRT2) });
      });
  // Cells that keep their land (outline on, eighths): no column of a house, a path, a road or a
  // built column moved or taken; a tree's moved only beyond 0.3 cell of its middle.
  withMode(OUTLINE, () => {
    const f = fill(keeping);
    traded(f, 8, (cx, cy, px, py, k) => {
      const tx = cx + (k % 3) - 1;
      const ty = cy + Math.floor(k / 3) - 1;
      const a = keepKind(cx, cy);
      const b = keepKind(tx, ty);
      if ((a && a !== "tree") || (b && b !== "tree")) out.keep.moved++;
      if (a === "tree") {
        out.keep.tree++;
        if (Math.max(Math.abs(px - cx - 0.5), Math.abs(py - cy - 0.5)) <= 0.3) out.keep.treeNear++;
      }
    });
  });
  return out;
}

// Corners: a block of high land 8 by 7 cells with a notch 2 cells square out of one corner, and a
// staircase of 1-cell steps along 45 degrees, on ordinary land and on a mesa (Cell.square). Columns
// moved to a neighbour's land within a cell of the block's six corners (its outer corners and the
// notch's), with sharpRun 0, 2 and 3: 2 keeps every corner of runs of 2 cells or more, 3 only those
// of 3 or more (the notch's corners round). On a mesa no column moves at all.
const BLOCK_CORNERS = [
  [14, 13],
  [20, 13],
  [20, 15],
  [22, 15],
  [22, 20],
  [14, 20],
];
const block =
  (square: boolean): Layout =>
  (x, y) => ({ top: x >= 14 && x < 22 && y >= 13 && y < 20 && !(x >= 20 && y < 15) ? HIGH : LOW, square });
const stairs =
  (square: boolean): Layout =>
  (x, y) => ({ top: x - y >= 1 ? HIGH : LOW, square });
export interface SharpRow {
  sharp: number;
  outer: number;
  notch: number;
  stairs: number;
  mesaBlock: number;
  mesaStairs: number;
}
export function sharpRows(): SharpRow[] {
  const rows: SharpRow[] = [];
  for (const sharp of [0, 2, 3])
    withMode({ name: `sharp ${sharp}`, corner: true, outline: true, sharp }, () => {
      const row: SharpRow = { sharp, outer: 0, notch: 0, stairs: 0, mesaBlock: 0, mesaStairs: 0 };
      traded(fill(block(false)), 8, (_cx, _cy, px, py) => {
        BLOCK_CORNERS.forEach(([x, y], i) => {
          if (Math.max(Math.abs(px - x), Math.abs(py - y)) > 1) return;
          if (i === 1 || i === 2 || i === 3) row.notch++;
          else row.outer++;
        });
      });
      row.stairs = traded(fill(stairs(false)), 8);
      row.mesaBlock = traded(fill(block(true)), 8);
      row.mesaStairs = traded(fill(stairs(true)), 8);
      rows.push(row);
    });
  return rows;
}

// Walkers at the foot of cliffs (World.walkGuard): beasts set beside every cliff of the small desert
// plateau, twenty seconds of the simulation with the outline on, with the guard Terrain gives the
// world and without it. Counted: steps onto a point drawn as a neighbour's land more than a step
// (walk.ts STEP) from the cell's walk level, from one that was not.
// Walkers at cliffs' feet on desert-plateau-3 (small, seed 3), the fine land built over the whole
// island: each second for 20 s, the ground walkers whose point is drawn (Terrain.drawnTop) more
// than OFF_DRAWN from their cell's middle, the playtest of 28 November's count (a walker in the air
// or in the rock). `mode` the cliffs, `guard` false takes the walk guard away.
const OFF_DRAWN = 1.5;
export function walkGuardRun(mode: "main" | "outline", guard: boolean, seed = 3): { walkers: number; off: number; samples: number; at: string } {
  return withMode(mode === "main" ? MAIN : OUTLINE, () => {
    resetCreatureIds();
    const cells = WORLD_SIZES.small;
    const world = generateWorld(cells, cells, seed, readLand({ biome: "desert", shape: "plateau", relief: 0.8 }));
    const terrain = new Terrain(
      world,
      new MeshBasicMaterial(),
      new MeshBasicMaterial(),
      () => {},
      () => {},
    );
    terrain.wetClock = () => 0;
    terrain.wantFar = () => 0;
    terrain.scan();
    terrain.rebuild(true);
    terrain.focus(0, 30, 0);
    terrain.updateFine(0, true);
    if (!world.walkGuard) throw new Error("Terrain gave the world no walk guard");
    if (!guard) world.walkGuard = null;
    const beast = KINDS.get("beast");
    if (!beast) throw new Error("no beast");
    let walkers = 0;
    for (let y = 2; y < world.h - 2 && walkers < 160; y += 2)
      for (let x = 2; x < world.w - 2 && walkers < 160; x += 3) {
        const i = world.idx(x, y);
        if (world.fluid[i] || world.cover[i]) continue;
        let foot = false;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ])
          if (columnTop(world, world.idx(x + dx, y + dy)) - columnTop(world, i) >= 2) foot = true;
        if (!foot) continue;
        world.creatures.push(makeCreature("beast", x + 0.45, y + 0.45));
        walkers++;
      }
    const rt = new Runtime(world, () => {});
    let off = 0;
    let samples = 0;
    let where = "";
    for (let t = 0; t < 30 * 20; t++) {
      stepHeadless(world, rt);
      if (t % 30 !== 29) continue;
      for (const c of world.creatures) {
        if (c.dead || KINDS.get(c.kind)?.flying || c.z > 0.2) continue;
        const a = terrain.drawnTop(c.x, c.y);
        const b = terrain.drawnTop(Math.floor(c.x) + 0.5, Math.floor(c.y) + 0.5);
        if (Number.isNaN(a) || Number.isNaN(b)) continue;
        samples++;
        if (Math.abs(a - b) <= OFF_DRAWN) continue;
        off++;
        if (!where) where = `(${c.x.toFixed(2)}, ${c.y.toFixed(2)}) ${a.toFixed(2)} against ${b.toFixed(2)}`;
      }
    }
    return { walkers, off, samples, at: where };
  });
}

// Faults along the lip on an island (desert-plateau-3, every chunk built in eighths): `overlaps`,
// wall triangles whose middle lies within 0.004 of another wall triangle facing the same way (the
// two drew through each other in triangles, a sawtooth along the wall's grass, 28 November
// playtest); `corners`, a triangle's corner inside another's edge that runs off the axes (a
// T-junction: single sky-blue pixels where a wall meets the lip).
export function lipFaults(mode: "main" | "outline"): { overlaps: number; corners: number; at: string } {
  return withMode(mode === "main" ? MAIN : OUTLINE, () => {
    const cells = WORLD_SIZES.small;
    const world = generateWorld(cells, cells, 3, readLand({ biome: "desert", shape: "plateau", relief: 0.8 }));
    const terrain = new Terrain(
      world,
      new MeshBasicMaterial(),
      new MeshBasicMaterial(),
      () => {},
      () => {},
    );
    terrain.wetClock = () => 0;
    terrain.scan();
    const f = makeFineCells();
    const out = new Writer();
    const water = new Writer();
    const tris: number[] = []; // nine numbers a triangle
    const cols = Math.ceil(world.w / CHUNK);
    for (let c = 0; c < cols * Math.ceil(world.h / CHUNK); c++) {
      terrain.readFine(c, f);
      out.reset();
      water.reset();
      for (let ty = f.y0; ty < f.y1; ty += TILE)
        for (let tx = f.x0; tx < f.x1; tx += TILE)
          buildFineTile(f, out, 0, 0, 8, tx, ty, Math.min(f.x1, tx + TILE), Math.min(f.y1, ty + TILE), null, water, false);
      const { pos } = out.vertexArrays();
      for (let v = 0; v + 9 <= out.quads * 18; v += 9) {
        const ux = pos[v + 3] - pos[v];
        const uy = pos[v + 4] - pos[v + 1];
        const uz = pos[v + 5] - pos[v + 2];
        const wx = pos[v + 6] - pos[v];
        const wy = pos[v + 7] - pos[v + 1];
        const wz = pos[v + 8] - pos[v + 2];
        if (Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) > 1e-7) for (let k = 0; k < 9; k++) tris.push(pos[v + k]);
      }
    }
    const P = (t: number, k: number, a: number) => tris[9 * t + 3 * k + a];
    const normal = (t: number) => {
      const ux = P(t, 1, 0) - P(t, 0, 0);
      const uy = P(t, 1, 1) - P(t, 0, 1);
      const uz = P(t, 1, 2) - P(t, 0, 2);
      const wx = P(t, 2, 0) - P(t, 0, 0);
      const wy = P(t, 2, 1) - P(t, 0, 1);
      const wz = P(t, 2, 2) - P(t, 0, 2);
      const n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
      const l = Math.hypot(n[0], n[1], n[2]);
      return [n[0] / l, n[1] / l, n[2] / l];
    };
    const n = tris.length / 9;
    const key = (x: number, z: number) => `${Math.floor(x * 4)},${Math.floor(z * 4)}`;
    const grid = new Map<string, number[]>();
    const add = (k: string, t: number) => {
      const g = grid.get(k);
      if (g) g.push(t);
      else grid.set(k, [t]);
    };
    const walls: number[] = [];
    const N: number[][] = [];
    for (let t = 0; t < n; t++) {
      N.push(normal(t));
      if (Math.abs(N[t][1]) > 0.05) continue;
      walls.push(t);
      const xs = [0, 1, 2].map((k) => P(t, k, 0));
      const zs = [0, 1, 2].map((k) => P(t, k, 2));
      for (let gx = Math.floor(Math.min(...xs) * 4); gx <= Math.floor(Math.max(...xs) * 4); gx++)
        for (let gz = Math.floor(Math.min(...zs) * 4); gz <= Math.floor(Math.max(...zs) * 4); gz++) add(`${gx},${gz}`, t);
    }
    // Whether point q lies in triangle t's plane (within 0.004) and well inside it.
    const inside = (t: number, q: number[]) => {
      const o = [P(t, 0, 0), P(t, 0, 1), P(t, 0, 2)];
      const u = [P(t, 1, 0) - o[0], P(t, 1, 1) - o[1], P(t, 1, 2) - o[2]];
      const w = [P(t, 2, 0) - o[0], P(t, 2, 1) - o[1], P(t, 2, 2) - o[2]];
      const v = [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
      if (Math.abs(v[0] * N[t][0] + v[1] * N[t][1] + v[2] * N[t][2]) > 0.004) return false;
      const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const d00 = dot(u, u);
      const d01 = dot(u, w);
      const d11 = dot(w, w);
      const d20 = dot(v, u);
      const d21 = dot(v, w);
      const den = d00 * d11 - d01 * d01;
      const b1 = (d11 * d20 - d01 * d21) / den;
      const b2 = (d00 * d21 - d01 * d20) / den;
      return b1 > 0.01 && b2 > 0.01 && b1 + b2 < 0.99;
    };
    let overlaps = 0;
    let at = "";
    for (const t of walls) {
      const q = [0, 1, 2].map((a) => (P(t, 0, a) + P(t, 1, a) + P(t, 2, a)) / 3);
      for (const o of grid.get(key(q[0], q[2])) ?? [])
        if (o !== t && N[o][0] * N[t][0] + N[o][2] * N[t][2] > 0.5 && inside(o, q)) {
          overlaps++;
          if (!at) at = `overlap at (${q[0].toFixed(2)}, ${q[2].toFixed(2)}, ${q[1].toFixed(2)} high)`;
          break;
        }
    }
    // Corners inside edges off the axes.
    const verts = new Map<string, number[]>();
    for (let t = 0; t < n; t++)
      for (let k = 0; k < 3; k++) {
        const g = key(P(t, k, 0), P(t, k, 2));
        const list = verts.get(g);
        if (list) list.push(t, k);
        else verts.set(g, [t, k]);
      }
    const hit = new Set<string>();
    for (let t = 0; t < n; t++)
      for (let e = 0; e < 3; e++) {
        const a = [P(t, e, 0), P(t, e, 1), P(t, e, 2)];
        const b = [P(t, (e + 1) % 3, 0), P(t, (e + 1) % 3, 1), P(t, (e + 1) % 3, 2)];
        if (Math.abs(a[0] - b[0]) < 1e-4 || Math.abs(a[2] - b[2]) < 1e-4) continue;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const seen = new Set<string>();
        for (let s = 0; s <= 8; s++) seen.add(key(a[0] + ((b[0] - a[0]) * s) / 8, a[2] + ((b[2] - a[2]) * s) / 8));
        for (const g of seen) {
          const list = verts.get(g) ?? [];
          for (let i = 0; i < list.length; i += 2) {
            const p = [P(list[i], list[i + 1], 0), P(list[i], list[i + 1], 1), P(list[i], list[i + 1], 2)];
            const u = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]) + (p[2] - a[2]) * (b[2] - a[2])) / (L * L);
            if (u * L < 1e-3 || (1 - u) * L < 1e-3) continue;
            if (Math.hypot(a[0] + (b[0] - a[0]) * u - p[0], a[1] + (b[1] - a[1]) * u - p[1], a[2] + (b[2] - a[2]) * u - p[2]) < 2e-4)
              hit.add(p.map((v) => v.toFixed(4)).join(","));
          }
        }
      }
    return { overlaps, corners: hit.size, at };
  });
}

export function cliffOutlineChecks(check: Check): void {
  const rows = angleRows();
  const on = rows.filter((r) => r.mode === "outline");
  const show = (r: AngleRow) => `${r.angle.toFixed(1)} deg sub ${r.sub}: RMS ${r.rms.toFixed(3)}, ${r.teeth} teeth`;
  check(
    "cliff outline: a cliff along a line at 0, 18.4, 26.6, 45 or 63.4 degrees draws its lip within 0.1 cell RMS of the line, at eighths and quarters",
    on.every((r) => r.rms <= 0.1),
    on.map(show).join("; ") +
      " | main: " +
      rows
        .filter((r) => r.mode === "main")
        .map(show)
        .join("; "),
  );
  check(
    "cliff outline: no straight teeth along an axis on a cliff more than 15 degrees off it",
    on.every((r) => r.angle <= 15 || r.teeth === 0),
    on.map(show).join("; "),
  );
  const proto = rows.filter((r) => r.mode === "prototype");
  const ribsOf2 = (list: AngleRow[]) => list.map((r) => `${r.angle.toFixed(1)} deg sub ${r.sub}: ${(r.ribs * 100).toFixed(1)}%`).join("; ");
  check(
    "cliff outline: a cliff's wall is flat, at most 10% of its area at mid-height turned more than 10 degrees from its line (ribs)",
    on.every((r) => r.ribs <= 0.1) && proto.filter((r) => r.angle > 15).every((r) => r.ribs > 0.9),
    `flat walls: ${ribsOf2(on)} | prototype: ${ribsOf2(proto)}`,
  );
  const sh = sharpRows();
  const at = (n: number) => sh.find((r) => r.sharp === n) as SharpRow;
  check(
    "cliff outline: sharpRun keeps a corner between walls of that many cells crisp (2: a block's and its notch's; 3: the block's only), and a mesa keeps every corner and step",
    at(0).outer > 0 &&
      at(0).notch > 0 &&
      at(2).outer === 0 &&
      at(2).notch === 0 &&
      at(3).outer === 0 &&
      at(3).notch > 0 &&
      sh.every((r) => r.stairs > 0 && r.mesaBlock === 0 && r.mesaStairs === 0),
    sh
      .map(
        (r) =>
          `sharp ${r.sharp}: ${r.outer} moved by the outer corners, ${r.notch} by the notch's, ${r.stairs} on the stairs; mesa ${r.mesaBlock} / ${r.mesaStairs}`,
      )
      .join("; "),
  );
  check(
    "cliff outline: a cliff along an axis stays on the cells' side (no column moved)",
    on.filter((r) => r.angle === 0).every((r) => r.traded === 0),
    on.map((r) => `${r.angle.toFixed(1)} deg sub ${r.sub}: ${r.traded} moved`).join("; "),
  );
  check(
    "cliff outline: the mesher's tops are the heights creatures read (fieldHeight), but a lip's broken column",
    on.every((r) => r.wrong === 0),
    on.map((r) => `${r.angle.toFixed(1)} deg sub ${r.sub}: ${r.differ} differ, ${r.wrong} not a lip ${r.wrongAt}`).join("; "),
  );
  const x = extraRows();
  check(
    "cliff outline: houses, paths, roads and built columns keep their land; a tree's cell keeps its middle",
    x.keep.moved === 0 && x.keep.treeNear === 0,
    `${x.keep.moved} columns of kept cells moved, ${x.keep.treeNear} of ${x.keep.tree} tree columns within 0.3 cell of the middle`,
  );
  const cOn = x.canyon.filter((r) => r.mode === "outline");
  check(
    "cliff outline: a straight canyon a cell wide keeps its width",
    cOn.every((r) => Math.abs(r.minWidth - 1) < 1e-9 && Math.abs(r.maxWidth - 1) < 1e-9),
    x.canyon.map((r) => `${r.mode} sub ${r.sub}: ${r.minWidth}..${r.maxWidth} (45 deg: ${r.diagMean.toFixed(2)} cells across)`).join("; "),
  );
  const lOn = x.lava.filter((r) => r.mode === "outline");
  check(
    "cliff outline: at a cliff's foot in lava, the rock fills the lava's corners to the steps' outer line (half main's teeth or fewer) and no column of the cliff becomes lava",
    lOn.every((r) => {
      const m = x.lava.find((v) => v.mode === "main" && v.sub === r.sub);
      return r.cut === 0 && r.fill > 0 && m !== undefined && r.teeth * 2 <= m.teeth && r.rms < m.rms;
    }),
    x.lava.map((r) => `${r.mode} sub ${r.sub}: RMS ${r.rms.toFixed(3)}, ${r.teeth} teeth, ${r.cut} cut, ${r.fill} filled`).join("; "),
  );
  // The tan strips of 26 November (scripts/cliff-corner-test.ts), with the outline on.
  for (const k of [0, 1]) {
    const r = cliffCorners(k, true, true);
    check(
      `cliff outline (${CLIFF_ISLANDS[k].name}): no column of land in a water cell stands up a cliff, a tan strip down its face`,
      r.strips === 0,
      `${r.strips} of ${r.water} columns of land in water cells more than SHORE_LOW over the water ${r.at.join(", ")}`,
    );
  }
  const cr = crackRows();
  check(
    "cliff outline: flat walls that meet share their upright edges' corners (no cracks, the rows of pale pinholes)",
    cr.every((r) => r.cracks === 0),
    cr.map((r) => `${r.what.replace(/(\.\d)\d+/, "$1")} sub ${r.sub}: ${r.cracks}${r.at ? ` ${r.at}` : ""}`).join("; "),
  );
  const gm = walkGuardRun("main", true);
  const g0 = walkGuardRun("outline", false);
  const g1 = walkGuardRun("outline", true);
  check(
    "cliff outline: walkers at cliffs' feet stand where the land is drawn at their cell's height, no more often off it than on main (the guard Terrain gives the world reads the drawn tops; without it they stand off it more)",
    g1.off <= gm.off && g0.off > g1.off && g1.walkers === g0.walkers && g1.samples > 0.9 * gm.samples && WALK_STEP === STEP,
    `${g1.walkers} beasts, 20 s, a sample a second, points drawn more than ${OFF_DRAWN} from their cell's middle: main ${gm.off} of ${gm.samples} ${gm.at}; flat walls ${g1.off} of ${g1.samples} ${g1.at}; without the guard ${g0.off} of ${g0.samples} ${g0.at}`,
  );
  const fm = lipFaults("main");
  const fo = lipFaults("outline");
  check(
    "cliff outline: no two walls drawn in one plane, and no corner inside a slanted edge, on desert-plateau-3 (the sawtooth and the sky-blue pixels of the 28 November playtest)",
    fo.overlaps <= fm.overlaps && fo.corners <= 10,
    `walls drawn over each other: main ${fm.overlaps}, flat walls ${fo.overlaps} ${fo.at}; corners inside slanted edges: main ${fm.corners}, flat walls ${fo.corners}`,
  );
  const tOn = x.terrace.filter((r) => r.mode === "outline");
  check(
    "cliff outline: a terrace of three levels draws both lips on their line, no column at a level of its own",
    tOn.every((r) => r.rmsLow <= 0.15 && r.rmsHigh <= 0.15 && r.odd === 0),
    x.terrace.map((r) => `${r.mode} sub ${r.sub}: RMS ${r.rmsLow.toFixed(3)} / ${r.rmsHigh.toFixed(3)}, ${r.teeth} teeth, ${r.odd} odd`).join("; "),
  );
}

// The table alone.
if (process.argv[1]?.endsWith("cliff-outline.mjs")) {
  for (const r of angleRows())
    console.log(
      `${r.mode.padEnd(9)} sub ${r.sub} ${r.angle.toFixed(1).padStart(5)} deg  RMS ${r.rms.toFixed(3)}  ribs ${(r.ribs * 100).toFixed(1)}%  teeth ${r.teeth} (${r.per10.toFixed(1)}/10 cells)  tris/cell ${r.trisPerCell.toFixed(0)}  moved ${r.traded}  feet ${r.differ}/${r.wrong} ${r.wrongAt}  ${r.ms.toFixed(1)} ms`,
    );
  console.log(JSON.stringify(extraRows()));
  cliffOutlineChecks((name, ok, detail) => console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `\n     ${detail}` : ""}`));
}
// The straight cliff at angle a, for the scripts that look at it closer (scripts/cliff-dbg.ts).
export const fillFor = (a: number): FineCells => fill(along(a));
