import type { Prop, PropBox, Shape } from "../props";
import { FACE_LIGHT, pushBox } from "./models";

// The parts of an item's look (props.ts) as faces, 2026-11-13 (the looks
// revamp, phase 1). A part that is an upright box with none of the new fields
// is drawn by pushBox exactly as before, so a stored look draws byte for byte
// as it did. A look that uses a new field (a shape, a turn, grain) is "soft":
// every part of it is drawn here, with
//   - its shape: box, wedge (a ramp), cyl (8 sides), cone (8 sides), dome
//     (half a sphere, 8 sides, 3 rings), turned by rx, ry, rz about its center;
//   - baked light from the face's direction, the same light as pushBox's for
//     a face that looks along an axis (FACE_LIGHT);
//   - soft shadow in its corners (ambient occlusion): every corner of every
//     face looks at five points just above it, and each one inside another
//     part, or under the ground, darkens it. Once per look, cached;
//   - grain: a large face cut in tiles of about half a cell, each a slightly
//     different tone, so stone and grass are not one flat colour.

export interface MeshArrays {
  pos: number[];
  col: number[];
}

export interface LocalMesh {
  lit: MeshArrays;
  glow: MeshArrays;
  tris: number;
}

type V = [number, number, number];

// How far a corner looks for what shades it, and how dark a corner fully shut in gets.
export const AO_REACH = 0.3;
export const AO_STRENGTH = 0.6;
// A far look keeps its largest parts only (PropModels' triangle budget).
export const FAR_PARTS = 24;
// Grain tiles: about this long, at most this many along a side.
const TILE = 0.5;
const MAX_TILES = 4;

export function isPlain(b: PropBox): boolean {
  return b.shape === undefined && !b.rx && !b.ry && !b.rz && !b.grain;
}

export function isSoft(p: Prop): boolean {
  return p.soft === true || p.boxes.some((b) => !isPlain(b));
}

// The largest parts of a look by volume, in their own order.
export function largestParts(boxes: PropBox[], n: number): PropBox[] {
  if (boxes.length <= n) return boxes;
  const keep = new Set(
    boxes
      .map((b, i) => ({ i, v: b.w * b.d * b.h }))
      .sort((a, b) => b.v - a.v || a.i - b.i)
      .slice(0, n)
      .map((o) => o.i),
  );
  return boxes.filter((_, i) => keep.has(i));
}

// --- Shapes in the unit cube: x east, y south, z up --------------------------------

const OCT = Array.from({ length: 8 }, (_, k) => ((k * 45 + 22.5) * Math.PI) / 180);
// The octagon's flat sides touch the box's sides.
const OCT_R = 0.5 / Math.cos(Math.PI / 8);
const ring = (scale: number, z: number): V[] => OCT.map((a) => [0.5 + OCT_R * scale * Math.cos(a), 0.5 + OCT_R * scale * Math.sin(a), z]);
const DOME_RINGS = [0, 30, 60].map((d) => (d * Math.PI) / 180);

const FACES = new Map<string, V[][]>();

// The faces of a shape, each a convex polygon; `bottom` adds the face it stands on. Shared: not to be changed.
export function unitFaces(shape: Shape, bottom: boolean): V[][] {
  const key = `${shape}${bottom}`;
  let f = FACES.get(key);
  if (!f) FACES.set(key, (f = makeFaces(shape, bottom)));
  return f;
}

function makeFaces(shape: Shape, bottom: boolean): V[][] {
  const f: V[][] = [];
  switch (shape) {
    case "box":
      f.push(
        [
          [0, 0, 1],
          [1, 0, 1],
          [1, 1, 1],
          [0, 1, 1],
        ],
        [
          [1, 0, 0],
          [1, 1, 0],
          [1, 1, 1],
          [1, 0, 1],
        ],
        [
          [0, 1, 0],
          [0, 1, 1],
          [1, 1, 1],
          [1, 1, 0],
        ],
        [
          [0, 0, 0],
          [0, 0, 1],
          [0, 1, 1],
          [0, 1, 0],
        ],
        [
          [0, 0, 0],
          [1, 0, 0],
          [1, 0, 1],
          [0, 0, 1],
        ],
      );
      if (bottom)
        f.push([
          [0, 0, 0],
          [0, 1, 0],
          [1, 1, 0],
          [1, 0, 0],
        ]);
      break;
    case "wedge":
      // Full height on its west side (x), sloping down to nothing at its east side.
      f.push(
        [
          [0, 0, 0],
          [0, 0, 1],
          [0, 1, 1],
          [0, 1, 0],
        ],
        [
          [0, 0, 1],
          [1, 0, 0],
          [1, 1, 0],
          [0, 1, 1],
        ],
        [
          [0, 0, 0],
          [1, 0, 0],
          [0, 0, 1],
        ],
        [
          [0, 1, 0],
          [0, 1, 1],
          [1, 1, 0],
        ],
      );
      if (bottom)
        f.push([
          [0, 0, 0],
          [0, 1, 0],
          [1, 1, 0],
          [1, 0, 0],
        ]);
      break;
    case "cyl": {
      const lo = ring(1, 0);
      const hi = ring(1, 1);
      for (let k = 0; k < 8; k++) f.push([lo[k], lo[(k + 1) % 8], hi[(k + 1) % 8], hi[k]]);
      f.push(hi);
      if (bottom) f.push(lo);
      break;
    }
    case "cone": {
      const lo = ring(1, 0);
      for (let k = 0; k < 8; k++) f.push([lo[k], lo[(k + 1) % 8], [0.5, 0.5, 1]]);
      if (bottom) f.push(lo);
      break;
    }
    case "dome": {
      const rings = DOME_RINGS.map((e) => ring(Math.cos(e), Math.sin(e)));
      for (let r = 0; r + 1 < rings.length; r++)
        for (let k = 0; k < 8; k++) f.push([rings[r][k], rings[r][(k + 1) % 8], rings[r + 1][(k + 1) % 8], rings[r + 1][k]]);
      const top = rings[rings.length - 1];
      for (let k = 0; k < 8; k++) f.push([top[k], top[(k + 1) % 8], [0.5, 0.5, 1]]);
      if (bottom) f.push(rings[0]);
      break;
    }
  }
  return f;
}

// Triangles a part draws (two per quad, n - 2 per polygon), before grain cuts its faces.
const TRIS = new Map<string, number>();
export function trianglesOf(shape: Shape, bottom: boolean): number {
  const key = `${shape}${bottom}`;
  let n = TRIS.get(key);
  if (n === undefined) TRIS.set(key, (n = unitFaces(shape, bottom).reduce((t, f) => t + f.length - 2, 0)));
  return n;
}

// How much of the occluders' box a shape fills, to shade with: a cone fills little of its box.
const FILL: Record<Shape, number> = { box: 1, wedge: 0.7, cyl: 0.85, cone: 0.5, dome: 0.75 };

// --- Small vector helpers -----------------------------------------------------------

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// The light of a face by where it looks, in the view (x east, y up, z south):
// FACE_LIGHT's six, blended by the square of each part of the direction.
export function lightOf(n: V): number {
  return (
    n[0] * n[0] * (n[0] > 0 ? FACE_LIGHT.east : FACE_LIGHT.west) +
    n[1] * n[1] * (n[1] > 0 ? FACE_LIGHT.top : FACE_LIGHT.bottom) +
    n[2] * n[2] * (n[2] > 0 ? FACE_LIGHT.south : FACE_LIGHT.north)
  );
}

function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x632be5ab) | 0, 0xc2b2ae35) ^ Math.imul((c + 1) | 0, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

interface Part {
  b: PropBox;
  polys: V[][];
  // Its bounds in the view, and the smaller box that shades others.
  lo: V;
  hi: V;
  olo: V;
  ohi: V;
  seed: number;
}

// A part's faces in the view, before the look is turned and set on the ground:
// scaled by k about (mx, my) on the ground, as a held object is.
function partOf(b: PropBox, index: number, k: number, mx: number, my: number): Part {
  const shape = b.shape ?? "box";
  const turned = !!(b.rx || b.ry);
  const polys0 = unitFaces(shape, turned || b.z > 0.02);
  const [ax, ay, az] = [((b.rx ?? 0) * Math.PI) / 180, ((b.ry ?? 0) * Math.PI) / 180, ((b.rz ?? 0) * Math.PI) / 180];
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
  const C: V = [b.x + b.w / 2, b.y + b.d / 2, b.z + b.h / 2];
  const toView = (u: V): V => {
    // In the model: x east, y south on the ground, z up; turned about the center by x, then y, then z.
    let x = (u[0] - 0.5) * b.w;
    let y = (u[1] - 0.5) * b.d;
    let z = (u[2] - 0.5) * b.h;
    [y, z] = [y * cx - z * sx, y * sx + z * cx];
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    [x, y] = [x * cz - y * sz, x * sz + y * cz];
    return [(C[0] + x - mx) * k, (C[2] + z) * k, (C[1] + y - my) * k];
  };
  const polys = polys0.map((p) => p.map(toView));
  // Wound so the front is outside: the shapes are convex, so the middle of their corners is inside.
  const all = polys.flat();
  const mid: V = [0, 0, 0];
  for (const v of all) for (let i = 0; i < 3; i++) mid[i] += v[i] / all.length;
  for (const p of polys) {
    const n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
    const c: V = [0, 0, 0];
    for (const v of p) for (let i = 0; i < 3; i++) c[i] += v[i] / p.length;
    if (dot(n, sub(c, mid)) < 0) p.reverse();
  }
  const lo: V = [Infinity, Infinity, Infinity];
  const hi: V = [-Infinity, -Infinity, -Infinity];
  for (const v of all)
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], v[i]);
      hi[i] = Math.max(hi[i], v[i]);
    }
  const f = FILL[shape];
  const olo = lo.map((l, i) => l + ((hi[i] - l) * (1 - f)) / 2) as V;
  const ohi = hi.map((h, i) => h - ((h - lo[i]) * (1 - f)) / 2) as V;
  // A dome or a cone is solid low down: its shading box sits on its base.
  if (shape === "cone" || shape === "dome") {
    olo[1] = lo[1];
    ohi[1] = lo[1] + (hi[1] - lo[1]) * f;
  }
  const seed =
    (Math.imul(b.color, 2654435761) ^ Math.imul(index + 1, 40503) ^ Math.imul(Math.round(b.x * 20), 73856093) ^ Math.imul(Math.round(b.z * 20), 19349663)) | 0;
  return { b, polys, lo, hi, olo, ohi, seed };
}

// How shut in a corner is, from 0 (open sky) to 1: five points just off the face, each under the
// ground or inside another part.
function occlusion(P: V, n: V, t1: V, t2: V, grid: Grid, self: number, r: number): number {
  let hit = 0;
  const a = r * 0.5;
  const s = r * 0.7;
  for (let k = 0; k < 5; k++) {
    const up = k === 0 ? r : a;
    const s1 = k === 0 ? 0 : k & 1 ? s : -s;
    const s2 = k === 0 ? 0 : k < 3 ? s : -s;
    const y = P[1] + n[1] * up + t1[1] * s1 + t2[1] * s2;
    if (y < -1e-4 || grid.hit(P[0] + n[0] * up + t1[0] * s1 + t2[0] * s2, y, P[2] + n[2] * up + t1[2] * s1 + t2[2] * s2, self)) hit++;
  }
  return hit / 5;
}

// The parts that shade, by cells of a coarse grid over the look, so a corner asks a few parts, not all.
class Grid {
  private lo: V = [Infinity, Infinity, Infinity];
  private hi: V = [-Infinity, -Infinity, -Infinity];
  private n: V = [1, 1, 1];
  private size: V = [1, 1, 1];
  private cells: number[][] = [];
  constructor(
    private parts: Part[],
    size: number,
  ) {
    const hi = this.hi;
    for (const p of parts)
      for (let i = 0; i < 3; i++) {
        this.lo[i] = Math.min(this.lo[i], p.olo[i]);
        hi[i] = Math.max(hi[i], p.ohi[i]);
      }
    for (let i = 0; i < 3; i++) {
      this.size[i] = Math.max(size, (hi[i] - this.lo[i]) / 48);
      this.n[i] = Math.max(1, Math.ceil((hi[i] - this.lo[i]) / this.size[i]));
    }
    this.cells = Array.from({ length: this.n[0] * this.n[1] * this.n[2] }, () => []);
    parts.forEach((p, k) => {
      if (p.b.glow) return;
      const a = [0, 1, 2].map((i) => this.cell(p.olo[i], i));
      const b = [0, 1, 2].map((i) => this.cell(p.ohi[i], i));
      for (let x = a[0]; x <= b[0]; x++)
        for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) this.cells[(x * this.n[1] + y) * this.n[2] + z].push(k);
    });
  }
  private cell(v: number, i: number): number {
    return Math.max(0, Math.min(this.n[i] - 1, Math.floor((v - this.lo[i]) / this.size[i])));
  }
  hit(x: number, y: number, z: number, self: number): boolean {
    const lo = this.lo;
    const hi = this.hi;
    if (!(x > lo[0] && x < hi[0] && y > lo[1] && y < hi[1] && z > lo[2] && z < hi[2])) return false;
    const list = this.cells[(this.cell(x, 0) * this.n[1] + this.cell(y, 1)) * this.n[2] + this.cell(z, 2)];
    for (let i = 0; i < list.length; i++) {
      const k = list[i];
      if (k === self) continue;
      const a = this.parts[k].olo;
      const b = this.parts[k].ohi;
      if (x > a[0] + 1e-4 && x < b[0] - 1e-4 && y > a[1] + 1e-4 && y < b[1] - 1e-4 && z > a[2] + 1e-4 && z < b[2] - 1e-4) return true;
    }
    return false;
  }
}

// Grain tiles along a face's two sides.
function tilesOf(poly: V[], k: number): [number, number] {
  const side = (a: V, b: V) => Math.max(1, Math.min(MAX_TILES, Math.ceil(Math.hypot(...sub(b, a)) / (TILE * k) - 1e-6)));
  return [side(poly[0], poly[1]), side(poly[0], poly[3])];
}

// The triangles a look draws, without shading it: what the island's budget counts.
export function propTriangles(p: Prop, simple = false): number {
  const boxes = simple ? largestParts(p.boxes, FAR_PARTS) : p.boxes;
  if (!isSoft(p)) return boxes.length * 10;
  let n = 0;
  for (const b of boxes) {
    const shape = b.shape ?? "box";
    const bottom = !!(b.rx || b.ry) || b.z > 0.02;
    if (simple || !b.grain) {
      n += trianglesOf(shape, bottom);
      continue;
    }
    // A turn keeps the sides' lengths: the tiles are counted on the unturned shape.
    for (const poly of unitFaces(shape, bottom)) {
      if (poly.length !== 4) n += poly.length - 2;
      else {
        const [nu, nv] = tilesOf(
          poly.map((u) => [u[0] * b.w, u[1] * b.d, u[2] * b.h] as V),
          1,
        );
        n += nu * nv * 2;
      }
    }
  }
  return n;
}

function softMesh(boxes: PropBox[], k: number, mx: number, my: number, grainOn: boolean, out: LocalMesh): void {
  const parts = boxes.map((b, i) => partOf(b, i, k, mx, my));
  const r = AO_REACH * k;
  const grid = new Grid(parts, r);
  for (let i = 0; i < parts.length; i++) {
    const me = parts[i];
    const b = me.b;
    const dst = b.glow ? out.glow : out.lit;
    const rgb = [((b.color >> 16) & 255) / 255, ((b.color >> 8) & 255) / 255, (b.color & 255) / 255];
    const grain = grainOn ? (b.grain ?? 0) : 0;
    me.polys.forEach((poly, fi) => {
      const n = unit(cross(sub(poly[1], poly[0]), sub(poly[2], poly[0])));
      const t1 = unit(sub(poly[1], poly[0]));
      const t2 = cross(n, t1);
      const light = lightOf(n);
      // What shines is not shaded: it gives light.
      const ao = (P: V) => (b.glow ? 1 : 1 - AO_STRENGTH * occlusion(P, n, t1, t2, grid, i, r));
      const emit = (tri: V[], tone: number, shade: number[]) => {
        for (let v = 0; v < 3; v++) {
          dst.pos.push(tri[v][0], tri[v][1], tri[v][2]);
          const l = light * tone * shade[v];
          dst.col.push(rgb[0] * l, rgb[1] * l, rgb[2] * l);
        }
        out.tris++;
      };
      const faceTone = grain ? 1 + (hash3(me.seed, fi, 0) - 0.5) * grain : 1;
      if (grain && poly.length === 4) {
        // Tiles of about TILE, each its own tone.
        const [p0, p1, p2, p3] = poly;
        const [nu, nv] = tilesOf(poly, k);
        const at = (u: number, v: number): V => {
          const a = p0.map((c, i) => c + (p1[i] - c) * u);
          const d = p3.map((c, i) => c + (p2[i] - c) * u);
          return a.map((c, i) => c + (d[i] - c) * v) as V;
        };
        const shade = new Map<string, number>();
        const aoAt = (u: number, v: number) => {
          const key = `${u},${v}`;
          let s = shade.get(key);
          if (s === undefined) shade.set(key, (s = ao(at(u / nu, v / nv))));
          return s;
        };
        for (let u = 0; u < nu; u++)
          for (let v = 0; v < nv; v++) {
            const tone = faceTone * (1 + (hash3(me.seed, fi * 64 + u * 8 + v, 1) - 0.5) * 2 * grain);
            const q = [at(u / nu, v / nv), at((u + 1) / nu, v / nv), at((u + 1) / nu, (v + 1) / nv), at(u / nu, (v + 1) / nv)];
            const s = [aoAt(u, v), aoAt(u + 1, v), aoAt(u + 1, v + 1), aoAt(u, v + 1)];
            emit([q[0], q[1], q[2]], tone, [s[0], s[1], s[2]]);
            emit([q[0], q[2], q[3]], tone, [s[0], s[2], s[3]]);
          }
        return;
      }
      const s = poly.map(ao);
      for (let t = 1; t + 1 < poly.length; t++) emit([poly[0], poly[t], poly[t + 1]], faceTone, [s[0], s[t], s[t + 1]]);
    });
  }
}

// A look's faces in the view before it is turned and set on the ground. `simple`: its
// largest FAR_PARTS parts, without grain (a far look). k, mx, my: scaled about (mx, my).
export function propLocal(p: Prop, simple = false, k = 1, mx = 0, my = 0): LocalMesh {
  const out: LocalMesh = { lit: { pos: [], col: [] }, glow: { pos: [], col: [] }, tris: 0 };
  const boxes = simple ? largestParts(p.boxes, FAR_PARTS) : p.boxes;
  if (isSoft(p)) {
    softMesh(boxes, k, mx, my, !simple, out);
    return out;
  }
  for (const b of boxes) {
    const dst = b.glow ? out.glow : out.lit;
    // The model's x and y lie on the ground, z goes up: the view's x, z and y.
    if (k === 1 && mx === 0 && my === 0) pushBox(dst.pos, dst.col, { x: b.x, y: b.z, z: b.y, w: b.w, h: b.h, d: b.d, color: b.color });
    else pushBox(dst.pos, dst.col, { x: (b.x - mx) * k, y: b.z * k, z: (b.y - my) * k, w: b.w * k, h: b.h * k, d: b.d * k, color: b.color });
    out.tris += 10;
  }
  return out;
}
