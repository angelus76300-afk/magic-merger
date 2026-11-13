import type { Prop, PropBox, Shape } from "../props";
import { FACE_LIGHT, pushBox } from "./models";

// The parts of an item's look (props.ts) as faces, 2026-11-13 (the looks
// revamp, phase 1). A part that is an upright box with none of the new fields
// is drawn by pushBox exactly as before, so a stored look draws byte for byte
// as it did. A look that uses a new field (a shape, a turn, grain) is drawn
// as fine voxels, as in the owner's reference pictures ("they should be small
// cube voxels"): every part is filled into a grid of LOOK_VOXEL cubes (a cone
// becomes a stepped spire, a dome a stepped shell, a turned box a staircased
// block), then the grid is meshed with its faces merged where they match
// (greedy meshing) and soft shadow in every corner (ambient occlusion, as the
// terrain's, terrain.ts). Grain is a tone per voxel. Once per look, cached.

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

// The side of a look's voxels, in cells: a quarter of a land cell, the one small cube
// size the owner's references are made of, land included (13 November).
export const LOOK_VOXEL = 0.25;
// A far look is the same grid at twice the side (PropModels' triangle budget).
export const FAR_COARSEN = 2;
// A look's grid holds this many voxels at most; past it the side grows.
const MAX_CELLS = 2_000_000;
// Light of a corner by how shut in it is, as the terrain's (terrain.ts AO_LIGHT).
const AO_LIGHT = [0.62, 0.75, 0.88, 1];
// Kept for the budget's far looks of stored (box only) looks.
export const FAR_PARTS = 24;

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

// Is (u, v, t), in the part's own unit box (0 to 1 each way, t up), inside its shape?
export function insideShape(shape: Shape, u: number, v: number, t: number): boolean {
  if (u < 0 || u > 1 || v < 0 || v > 1 || t < 0 || t > 1) return false;
  const du = u - 0.5;
  const dv = v - 0.5;
  switch (shape) {
    case "box":
      return true;
    case "wedge":
      // Full height on its west side, down to nothing on its east side.
      return t <= 1 - u;
    case "cyl":
      return du * du + dv * dv <= 0.25;
    case "cone": {
      const r = 0.5 * (1 - t);
      return du * du + dv * dv <= r * r;
    }
    case "dome":
      return du * du + dv * dv + 0.25 * t * t <= 0.25;
  }
}

function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x632be5ab) | 0, 0xc2b2ae35) ^ Math.imul((c + 1) | 0, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

// A look filled into voxels: x east, y south, z up (the model's axes), side s.
export interface VoxelGrid {
  s: number;
  o: V; // the corner of voxel (0, 0, 0)
  n: V;
  // Colour of each voxel, -1 for none; glow 1 for what shines.
  color: Int32Array;
  glow: Uint8Array;
  count: number;
}

const idx = (g: VoxelGrid, x: number, y: number, z: number) => (z * g.n[1] + y) * g.n[0] + x;

// A turned part's rotation (by x, then y, then z, degrees), as props.ts partCorners.
function rotation(b: PropBox): number[] {
  const [ax, ay, az] = [((b.rx ?? 0) * Math.PI) / 180, ((b.ry ?? 0) * Math.PI) / 180, ((b.rz ?? 0) * Math.PI) / 180];
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
  // R = Rz * Ry * Rx, row major.
  return [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx, sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, -sy, cy * sx, cy * cx];
}

// Every part, in the program's order (a later part paints over an earlier one: a window over its
// wall). A part thinner than a voxel is drawn a voxel thick, so a window or a rib is not lost.
export function voxelize(boxes: PropBox[], side: number): VoxelGrid {
  const parts = boxes.map((b) => {
    const R = rotation(b);
    const W = Math.max(b.w, side);
    const D = Math.max(b.d, side);
    const H = Math.max(b.h, side);
    const C: V = [b.x + b.w / 2, b.y + b.d / 2, b.z + b.h / 2];
    const lo: V = [Infinity, Infinity, Infinity];
    const hi: V = [-Infinity, -Infinity, -Infinity];
    for (const a of [-0.5, 0.5])
      for (const c of [-0.5, 0.5])
        for (const e of [-0.5, 0.5]) {
          const p = [a * W, c * D, e * H];
          for (let i = 0; i < 3; i++) {
            const v = C[i] + R[i * 3] * p[0] + R[i * 3 + 1] * p[1] + R[i * 3 + 2] * p[2];
            lo[i] = Math.min(lo[i], v);
            hi[i] = Math.max(hi[i], v);
          }
        }
    return { b, R, W, D, H, C, lo, hi };
  });
  const lo: V = [Infinity, Infinity, Infinity];
  const hi: V = [-Infinity, -Infinity, -Infinity];
  for (const p of parts)
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p.lo[i]);
      hi[i] = Math.max(hi[i], p.hi[i]);
    }
  let s = side;
  const dims = (q: number): V => [0, 1, 2].map((i) => Math.max(1, Math.ceil(hi[i] / q) - Math.floor(lo[i] / q))) as V;
  while (dims(s).reduce((a, b) => a * b, 1) > MAX_CELLS) s *= 1.5;
  // The grid lies on multiples of s from the model's origin, so the ground (z = 0) is a layer's floor.
  const o: V = [Math.floor(lo[0] / s) * s, Math.floor(lo[1] / s) * s, Math.floor(lo[2] / s) * s];
  const n = dims(s);
  const g: VoxelGrid = { s, o, n, color: new Int32Array(n[0] * n[1] * n[2]).fill(-1), glow: new Uint8Array(n[0] * n[1] * n[2]), count: 0 };
  parts.forEach((p, k) => {
    const shape = p.b.shape ?? "box";
    const grain = p.b.grain ?? 0;
    const i0 = [0, 1, 2].map((i) => Math.max(0, Math.floor((p.lo[i] - o[i]) / s)));
    const i1 = [0, 1, 2].map((i) => Math.min(n[i] - 1, Math.ceil((p.hi[i] - o[i]) / s) - 1));
    const R = p.R;
    const seed = (Math.imul(p.b.color, 2654435761) ^ Math.imul(k + 1, 40503)) | 0;
    for (let z = i0[2]; z <= i1[2]; z++)
      for (let y = i0[1]; y <= i1[1]; y++)
        for (let x = i0[0]; x <= i1[0]; x++) {
          const d0 = o[0] + (x + 0.5) * s - p.C[0];
          const d1 = o[1] + (y + 0.5) * s - p.C[1];
          const d2 = o[2] + (z + 0.5) * s - p.C[2];
          // Into the part's own axes: the inverse turn is the transpose.
          const u = (R[0] * d0 + R[3] * d1 + R[6] * d2) / p.W + 0.5;
          const v = (R[1] * d0 + R[4] * d1 + R[7] * d2) / p.D + 0.5;
          const t = (R[2] * d0 + R[5] * d1 + R[8] * d2) / p.H + 0.5;
          if (!insideShape(shape, u, v, t)) continue;
          const i = idx(g, x, y, z);
          if (g.color[i] < 0) g.count++;
          let c = p.b.color;
          if (grain) {
            const kk = 1 + (hash3(seed, x * 73856093 + y, z) - 0.5) * 2 * grain;
            const ch = (sh: number) => Math.max(0, Math.min(255, Math.round(((c >> sh) & 255) * kk)));
            c = (ch(16) << 16) | (ch(8) << 8) | ch(0);
          }
          g.color[i] = c;
          g.glow[i] = p.b.glow ? 1 : 0;
        }
  });
  return g;
}

// Model axis a (0 x east, 1 y south, 2 z up) and its sign: the face's light, as pushBox's.
const LIGHT = [
  [FACE_LIGHT.west, FACE_LIGHT.east],
  [FACE_LIGHT.north, FACE_LIGHT.south],
  [FACE_LIGHT.bottom, FACE_LIGHT.top],
];

// The grid's faces, merged where colour, glow and corner shade match, in the view (x, up, south),
// scaled by k about (mx, my) on the ground. Below the ground counts as solid: no face is drawn
// against it, and it shades the corners next to it.
export function meshGrid(g: VoxelGrid, out: LocalMesh, k = 1, mx = 0, my = 0): void {
  const { n, s, o } = g;
  const groundZ = Math.round(-o[2] / s); // voxels with z index below this are under the ground
  const solid = (x: number, y: number, z: number) => {
    if (z < groundZ) return true;
    if (x < 0 || y < 0 || z < 0 || x >= n[0] || y >= n[1] || z >= n[2]) return false;
    return g.color[idx(g, x, y, z)] >= 0;
  };
  const cell = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const ua = (a + 1) % 3;
    const va = (a + 2) % 3;
    const nu = n[ua];
    const nv = n[va];
    const keyC = new Int32Array(nu * nv);
    const keyA = new Int32Array(nu * nv);
    for (const sign of [-1, 1]) {
      const light = LIGHT[a][sign > 0 ? 1 : 0];
      for (let sl = 0; sl < n[a]; sl++) {
        keyC.fill(-1);
        for (let v = 0; v < nv; v++)
          for (let u = 0; u < nu; u++) {
            cell[a] = sl;
            cell[ua] = u;
            cell[va] = v;
            const i = idx(g, cell[0], cell[1], cell[2]);
            const c = g.color[i];
            if (c < 0) continue;
            cell[a] = sl + sign;
            if (solid(cell[0], cell[1], cell[2])) continue;
            // The four corners' shade, from the layer the face looks into.
            let ao = 0;
            if (!g.glow[i]) {
              const at = (du: number, dv: number) => {
                cell[ua] = u + du;
                cell[va] = v + dv;
                return solid(cell[0], cell[1], cell[2]) ? 1 : 0;
              };
              const corner = (du: number, dv: number) => {
                const s1 = at(du, 0);
                const s2 = at(0, dv);
                const cc = at(du, dv);
                return s1 && s2 ? 0 : 3 - s1 - s2 - cc;
              };
              ao = corner(-1, -1) | (corner(1, -1) << 2) | (corner(1, 1) << 4) | (corner(-1, 1) << 6);
            } else ao = 0xff;
            keyC[v * nu + u] = c;
            keyA[v * nu + u] = ao | (g.glow[i] << 8);
          }
        // Greedy: the widest run along u, then as many rows along v as match it.
        for (let v = 0; v < nv; v++)
          for (let u = 0; u < nu; ) {
            const j = v * nu + u;
            const c = keyC[j];
            if (c < 0) {
              u++;
              continue;
            }
            const ka = keyA[j];
            let w = 1;
            while (u + w < nu && keyC[j + w] === c && keyA[j + w] === ka) w++;
            let h = 1;
            grow: while (v + h < nv) {
              for (let q = 0; q < w; q++) {
                const jj = (v + h) * nu + u + q;
                if (keyC[jj] !== c || keyA[jj] !== ka) break grow;
              }
              h++;
            }
            for (let r = 0; r < h; r++) keyC.fill(-1, (v + r) * nu + u, (v + r) * nu + u + w);
            emitQuad(out, g, a, ua, va, sign, sl, u, v, w, h, c, ka, light, k, mx, my);
            u += w;
          }
      }
    }
  }
}

function emitQuad(
  out: LocalMesh,
  g: VoxelGrid,
  a: number,
  ua: number,
  va: number,
  sign: number,
  sl: number,
  u: number,
  v: number,
  w: number,
  h: number,
  c: number,
  ka: number,
  light: number,
  k: number,
  mx: number,
  my: number,
): void {
  const glow = (ka >> 8) & 1;
  const dst = glow ? out.glow : out.lit;
  const plane = g.o[a] + (sl + (sign > 0 ? 1 : 0)) * g.s;
  const corner = (cu: number, cv: number): V => {
    const m = [0, 0, 0];
    m[a] = plane;
    m[ua] = g.o[ua] + cu * g.s;
    m[va] = g.o[va] + cv * g.s;
    // Model x, y, z to the view's x, up, south.
    return [(m[0] - mx) * k, m[2] * k, (m[1] - my) * k];
  };
  const p = [corner(u, v), corner(u + w, v), corner(u + w, v + h), corner(u, v + h)];
  const shade = [ka & 3, (ka >> 2) & 3, (ka >> 4) & 3, (ka >> 6) & 3].map((x) => (glow ? 1 : AO_LIGHT[x]));
  const rgb = [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
  // Outward, as the view sees it: the model's axis a in the view.
  const want: V = [0, 0, 0];
  want[[0, 2, 1][a]] = sign;
  const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  const nx = e1[1] * e2[2] - e1[2] * e2[1];
  const ny = e1[2] * e2[0] - e1[0] * e2[2];
  const nz = e1[0] * e2[1] - e1[1] * e2[0];
  let order = [0, 1, 2, 3];
  if (nx * want[0] + ny * want[1] + nz * want[2] < 0) order = [0, 3, 2, 1];
  // Split along the brighter diagonal, so the shade does not crease (as terrain.ts).
  const [q0, q1, q2, q3] = order;
  const tris = shade[q0] + shade[q2] < shade[q1] + shade[q3] ? [q1, q2, q3, q1, q3, q0] : [q0, q1, q2, q0, q2, q3];
  for (const q of tris) {
    dst.pos.push(p[q][0], p[q][1], p[q][2]);
    const l = light * shade[q];
    dst.col.push(rgb[0] * l, rgb[1] * l, rgb[2] * l);
  }
  out.tris += 2;
}

// A look's faces in the view before it is turned and set on the ground. `simple`: a far look,
// its grid at FAR_COARSEN times the side (a stored look of boxes keeps its largest FAR_PARTS
// parts). k, mx, my: scaled about (mx, my), as a held object is.
export function propLocal(p: Prop, simple = false, k = 1, mx = 0, my = 0): LocalMesh {
  const out: LocalMesh = { lit: { pos: [], col: [] }, glow: { pos: [], col: [] }, tris: 0 };
  if (isSoft(p)) {
    meshGrid(voxelize(p.boxes, LOOK_VOXEL * (simple ? FAR_COARSEN : 1)), out, k, mx, my);
    return out;
  }
  const boxes = simple ? largestParts(p.boxes, FAR_PARTS) : p.boxes;
  for (const b of boxes) {
    const dst = b.glow ? out.glow : out.lit;
    // The model's x and y lie on the ground, z goes up: the view's x, z and y.
    if (k === 1 && mx === 0 && my === 0) pushBox(dst.pos, dst.col, { x: b.x, y: b.z, z: b.y, w: b.w, h: b.h, d: b.d, color: b.color });
    else pushBox(dst.pos, dst.col, { x: (b.x - mx) * k, y: b.z * k, z: (b.y - my) * k, w: b.w * k, h: b.h * k, d: b.d * k, color: b.color });
    out.tris += 10;
  }
  return out;
}

// The triangles a look draws: what the island's budget counts.
export function propTriangles(p: Prop, simple = false): number {
  if (!isSoft(p)) return (simple ? largestParts(p.boxes, FAR_PARTS) : p.boxes).length * 10;
  return propLocal(p, simple).tris;
}
