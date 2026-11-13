import { BufferAttribute, BufferGeometry } from "three";
import { Rng } from "../noise";
import type { TreeStyle } from "../ecology";
import { meshGrid, type LocalMesh, type VoxelGrid } from "./shapes";

// The village houses and the trees in small cubes (5.2.5, the owner: houses "are still ugly",
// trees "are big blocks"; the cottage island and the camp with fluffy trees of the references).
// Drawing only: what the simulation knows of a house or a tree (its cells, height, door) is
// unchanged. Each model is filled into a grid of CUBE cubes, then meshed by the looks' own
// mesher (shapes.ts meshGrid): faces merged where they match, soft shadow in every corner.
//
// CUBE is an eighth of a cell, the land's own fine step near the camera: a house wall is six
// cubes tall, so a window can sit one cube back in its frame, a tree crown eight to ten across.
// Behind GRAPHICS.cubes (graphics.ts: off on the low preset), and only near the camera
// (view.ts): farther away the old models stay, so the island costs what it did.

export const CUBE = 0.125;

// A model as cubes: x east, y south, z up, in cubes; (0, 0, 0) is the model's corner on the
// ground. The grid reaches `pad` cubes past the model's square on every side (crowns and eaves).
export class Vox {
  readonly color: Int32Array;
  readonly glow: Uint8Array;
  readonly nx: number;
  readonly ny: number;
  constructor(
    side: number,
    readonly nz: number,
    readonly pad: number,
    readonly cube = CUBE,
  ) {
    this.nx = side + pad * 2;
    this.ny = side + pad * 2;
    this.color = new Int32Array(this.nx * this.ny * nz).fill(-1);
    this.glow = new Uint8Array(this.nx * this.ny * nz);
  }

  private at(x: number, y: number, z: number): number {
    const i = x + this.pad;
    const j = y + this.pad;
    if (i < 0 || j < 0 || z < 0 || i >= this.nx || j >= this.ny || z >= this.nz) return -1;
    return (z * this.ny + j) * this.nx + i;
  }

  get(x: number, y: number, z: number): number {
    const k = this.at(x, y, z);
    return k < 0 ? -1 : this.color[k];
  }

  has(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) >= 0;
  }

  set(x: number, y: number, z: number, color: number, glow = false): void {
    const k = this.at(x, y, z);
    if (k < 0) return;
    this.color[k] = color;
    this.glow[k] = glow ? 1 : 0;
  }

  clear(x: number, y: number, z: number): void {
    const k = this.at(x, y, z);
    if (k >= 0) this.color[k] = -1;
  }

  // Fills [x0, x1) by [y0, y1) by [z0, z1); the colour may depend on the cube.
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number | ((x: number, y: number, z: number) => number)): void {
    for (let z = z0; z < z1; z++)
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, z, typeof color === "number" ? color : color(x, y, z));
  }

  // Every cube that is set, for a pass that repaints them.
  each(f: (x: number, y: number, z: number, c: number) => void): void {
    for (let z = 0; z < this.nz; z++)
      for (let j = 0; j < this.ny; j++)
        for (let i = 0; i < this.nx; i++) {
          const c = this.color[(z * this.ny + j) * this.nx + i];
          if (c >= 0) f(i - this.pad, j - this.pad, z, c);
        }
  }

  // The same model in cubes twice the side (mid zoom): a cube where two of the eight under it are
  // set, in their most common colour, so a trunk or a frond one cube thin is kept.
  coarse(): Vox {
    const side = (this.nx - this.pad * 2) / 2;
    const out = new Vox(side, Math.ceil(this.nz / 2), Math.ceil(this.pad / 2), this.cube * 2);
    const count = new Map<number, number>();
    for (let z = 0; z < out.nz; z++)
      for (let y = -out.pad; y < side + out.pad; y++)
        for (let x = -out.pad; x < side + out.pad; x++) {
          count.clear();
          let n = 0;
          let glow = false;
          for (let dz = 0; dz < 2; dz++)
            for (let dy = 0; dy < 2; dy++)
              for (let dx = 0; dx < 2; dx++) {
                const k = this.at(x * 2 + dx, y * 2 + dy, z * 2 + dz);
                if (k < 0 || this.color[k] < 0) continue;
                n++;
                // The upper layer counts double: it is what the sky sees.
                count.set(this.color[k], (count.get(this.color[k]) ?? 0) + 1 + dz);
                if (this.glow[k]) glow = true;
              }
          if (n < 2) continue;
          let best = -1;
          let most = 0;
          for (const [c, m] of count)
            if (m > most) {
              most = m;
              best = c;
            }
          out.set(x, y, z, best, glow);
        }
    return out;
  }

  // The faces, in the view's axes (x, up, south) and cells, as a look's (shapes.ts).
  mesh(): LocalMesh {
    let count = 0;
    for (const c of this.color) if (c >= 0) count++;
    const g: VoxelGrid = {
      s: this.cube,
      o: [-this.pad * this.cube, -this.pad * this.cube, 0],
      n: [this.nx, this.ny, this.nz],
      color: this.color,
      glow: this.glow,
      count,
    };
    const out: LocalMesh = { lit: { pos: [], col: [] }, glow: { pos: [], col: [] }, tris: 0 };
    meshGrid(g, out);
    return out;
  }
}

// A colour times k (each channel), clamped.
export function tone(color: number, k: number): number {
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((color >> s) & 255) * k)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

// From a toward b by t.
export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

// A number in [0, 1) for a cube and a seed.
export function h3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x + 0x3c6ef372, 0x85ebca6b) ^ Math.imul(y + 0x2545f491, 0xc2b2ae35) ^ Math.imul(z + 0x27d4eb2f, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// One mesh's arrays as a geometry, lit and glowing faces together.
export function geometryOfMesh(m: LocalMesh): BufferGeometry {
  const pos = [...m.lit.pos, ...m.glow.pos];
  const col = [...m.lit.col, ...m.glow.col];
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Trees. One cell is 8 by 8 cubes; a crown may reach PAD cubes past it. Each kind recognisable at
// a glance: an oak's round cauliflower crown, a pine's stacked tiers, a palm's drooping fronds, a
// willow's hanging strands, a birch's white trunk with dark marks. Leaves in three shades of their
// kind: lighter on top where the sun falls, darker underneath, in clumps of two or three cubes so
// a crown reads soft and calm rather than speckled.

const PAD = 4;
const TALL = 26;

// Three shades of leaves: under, middle, top.
type Leaves = [number, number, number];

const OAK: Leaves = [0x2c6a26, 0x3f8a2e, 0x5ea53c];
const BIRCH: Leaves = [0x5f9a2c, 0x7fb63a, 0xa2cf52];
const PINE: Leaves = [0x173f26, 0x215a34, 0x2f7444];
const SNOWPINE: Leaves = [0x1f4a36, 0x2a5e44, 0x3a7452];
const WILLOW: Leaves = [0x4c7430, 0x5f8a3a, 0x80aa48];
const PALM: Leaves = [0x2e6e2a, 0x3f8a36, 0x5ea544];
const JUNGLE: Leaves = [0x1f5c1e, 0x2f7d2a, 0x47983a];
const JUNIPER: Leaves = [0x3a5530, 0x4f6a3a, 0x6a8650];
const CHERRY: Leaves = [0xd2809e, 0xf2a7c3, 0xfad4e2];
const MANGROVE: Leaves = [0x245a22, 0x2f6a2a, 0x47873a];
const CYPRESS: Leaves = [0x3a5a30, 0x4a6a3a, 0x62844a];
const ACACIA: Leaves = [0x5e6e2a, 0x7a8a3a, 0x9aa850];
const AUTUMN: Leaves[] = [
  [0x8e2a1e, 0xc0392b, 0xdc5a3a],
  [0xa8460e, 0xe67e22, 0xf3a046],
  [0xa8800e, 0xe8b41e, 0xf6d453],
];
const BARK = 0x5b3a1e;

interface Tree {
  v: Vox;
  rng: Rng;
  seed: number;
  // Cubes marked as leaves before they are shaded: by kind of leaf.
  leaves: Map<number, Leaves>;
}

const leafKey = (x: number, y: number, z: number) => ((z * 64 + (y + 32)) * 64 + (x + 32)) | 0;

function mark(t: Tree, x: number, y: number, z: number, set: Leaves): void {
  if (x < -PAD || y < -PAD || x >= 8 + PAD || y >= 8 + PAD || z < 0 || z >= TALL) return;
  t.v.set(x, y, z, set[1]);
  t.leaves.set(leafKey(x, y, z), set);
}

// A round clump of leaves, its edge a little ragged.
function blob(t: Tree, cx: number, cy: number, cz: number, rx: number, rz: number, set: Leaves, rough = 0.35): void {
  const R = Math.ceil(rx + 1);
  const Z = Math.ceil(rz + 1);
  for (let z = Math.floor(cz - Z); z <= cz + Z; z++)
    for (let y = Math.floor(cy - R); y <= cy + R; y++)
      for (let x = Math.floor(cx - R); x <= cx + R; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / rx;
        const dz = (z + 0.5 - cz) / rz;
        const d = dx * dx + dy * dy + dz * dz;
        if (d <= 1 + (h3(x, y, z, t.seed) - 0.5) * rough) mark(t, x, y, z, set);
      }
}

// A trunk w cubes square from z0 to z1, its bark in two tones up and down its faces; `flare` adds
// roots on its four sides at the foot.
function trunk(t: Tree, x: number, y: number, w: number, z0: number, z1: number, bark: number, flare = 1): void {
  for (let z = z0; z < z1; z++)
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) t.v.set(x + i, y + j, z, (x + i + y + j + (z >> 2)) % 2 ? bark : tone(bark, 0.88));
  if (z0 > 0 || flare <= 0) return;
  // Roots: a cube out of the middle of each side at the foot, two for the old and big.
  const root = tone(bark, 0.82);
  const m = x + (w > 1 ? t.seed & 1 : 0);
  const n = y + (w > 1 ? (t.seed >> 1) & 1 : 0);
  for (let r = 1; r <= Math.min(flare, 2); r++)
    for (let z = 0; z <= Math.min(flare, 2) - r; z++) {
      t.v.set(x - r, n, z, root);
      t.v.set(x + w - 1 + r, n, z, root);
      t.v.set(m, y - r, z, root);
      t.v.set(m, y + w - 1 + r, z, root);
    }
}

// A branch from (x, y, z) stepping out by (dx, dy) and up one cube every `rise` steps.
function branch(t: Tree, x: number, y: number, z: number, dx: number, dy: number, len: number, bark: number, rise = 1): { x: number; y: number; z: number } {
  for (let k = 0; k < len; k++) {
    x += dx;
    y += dy;
    t.v.set(x, y, z, bark);
    if ((k + 1) % rise === 0) {
      z++;
      t.v.set(x, y, z, bark);
    }
  }
  return { x, y, z };
}

// Shades every leaf cube: its height in the crown, whether the sky or the ground is above or
// under it, and a clump of two cubes it belongs to (so tones come in patches, not speckles).
function shade(t: Tree): void {
  const { v } = t;
  let z0 = TALL;
  let z1 = 0;
  for (const key of t.leaves.keys()) {
    const z = Math.floor(key / 4096);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  const span = Math.max(1, z1 - z0);
  for (const [key, set] of t.leaves) {
    const z = Math.floor(key / 4096);
    const y = (Math.floor(key / 64) % 64) - 32;
    const x = (key % 64) - 32;
    if (v.get(x, y, z) !== set[1]) continue;
    let s = (z - z0) / span;
    if (!v.has(x, y, z + 1)) s += 0.28;
    if (!v.has(x, y, z - 1)) s -= 0.4;
    s += (h3(Math.floor(x / 3), Math.floor(y / 3), Math.floor(z / 2), t.seed ^ 0x5151) - 0.5) * 0.3;
    v.set(x, y, z, s < 0.3 ? set[0] : s < 0.78 ? set[1] : set[2]);
  }
}

// A few cubes of the crown's rim taken away and a few leaf tufts out of it: a soft edge, not a
// box. Few, so the crown stays calm.
function fluff(t: Tree): void {
  const { v } = t;
  const out: [number, number, number, Leaves][] = [];
  const cut: [number, number, number][] = [];
  for (const [key, set] of t.leaves) {
    const z = Math.floor(key / 4096);
    const y = (Math.floor(key / 64) % 64) - 32;
    const x = (key % 64) - 32;
    const open = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].filter(([dx, dy]) => !v.has(x + dx, y + dy, z));
    if (!open.length) continue;
    const r = h3(x, y, z, t.seed ^ 0x77);
    if (r < 0.06 && v.has(x, y, z - 1)) cut.push([x, y, z]);
    else if (r > 0.97 && v.has(x, y, z - 1)) {
      const [dx, dy] = open[Math.floor(h3(x, z, y, t.seed) * open.length)];
      out.push([x + dx, y + dy, z, set]);
    }
  }
  for (const [x, y, z] of cut) {
    v.clear(x, y, z);
    t.leaves.delete(leafKey(x, y, z));
  }
  for (const [x, y, z, set] of out) mark(t, x, y, z, set);
}

// A broadleaf crown: a wide middle and lobes round it at different heights.
function broadCrown(t: Tree, cx: number, cy: number, cz: number, r: number, h: number, sets: Leaves[], lobes = 5): void {
  const pick = () => sets[Math.floor(t.rng.next() * sets.length)];
  blob(t, cx, cy, cz, r, h, pick());
  const a0 = t.rng.next() * Math.PI * 2;
  for (let k = 0; k < lobes; k++) {
    const a = a0 + (k / lobes) * Math.PI * 2 + (t.rng.next() - 0.5) * 0.6;
    const d = r * (0.62 + t.rng.next() * 0.2);
    blob(t, cx + Math.cos(a) * d, cy + Math.sin(a) * d, cz + (t.rng.next() - 0.35) * h * 0.9, r * (0.48 + t.rng.next() * 0.14), h * 0.62, pick());
  }
  // A crown on top, smaller, where the light is.
  blob(t, cx + (t.rng.next() - 0.5) * 1.5, cy + (t.rng.next() - 0.5) * 1.5, cz + h * 0.75, r * 0.55, h * 0.55, pick());
}

type Maker = (t: Tree) => void;

const FINE: Record<Exclude<TreeStyle, "">, Maker> = {
  oak: (t) => {
    const h = 5 + Math.floor(t.rng.next() * 2);
    trunk(t, 3, 3, 2, 0, h + 2, BARK, 2);
    branch(t, 3, 4, h - 1, -1, 0, 2, BARK);
    branch(t, 4, 4, h, 1, 1, 2, BARK);
    broadCrown(t, 4, 4, h + 4.2, 4.1 + t.rng.next() * 0.5, 2.7, [OAK]);
    shade(t);
    fluff(t);
  },
  autumn: (t) => {
    const h = 5 + Math.floor(t.rng.next() * 2);
    trunk(t, 3, 3, 2, 0, h + 2, BARK, 2);
    branch(t, 4, 3, h, 1, -1, 2, BARK);
    broadCrown(t, 4, 4, h + 4, 4 + t.rng.next() * 0.5, 2.6, AUTUMN, 6);
    shade(t);
    fluff(t);
  },
  cherry: (t) => {
    const h = 4 + Math.floor(t.rng.next() * 2);
    const bark = 0x4a2e22;
    trunk(t, 3, 3, 2, 0, h + 1, bark, 1);
    branch(t, 3, 3, h, -1, -1, 2, bark);
    branch(t, 4, 4, h, 1, 1, 2, bark);
    broadCrown(t, 4, 4, h + 3.6, 4.4, 2.3, [CHERRY], 6);
    shade(t);
    // A few petals of white on the top.
    t.v.each((x, y, z, c) => {
      if (c === CHERRY[2] && !t.v.has(x, y, z + 1) && h3(x, y, z, t.seed ^ 3) < 0.12) t.v.set(x, y, z, 0xfff4f8);
    });
    fluff(t);
  },
  birch: (t) => {
    const h = 9 + Math.floor(t.rng.next() * 3);
    // A white trunk with dark marks across it.
    for (let z = 0; z < h; z++) t.v.set(4, 4, z, h3(0, 0, z, t.seed) < 0.22 ? 0x3a3530 : z % 3 ? 0xe8e4da : 0xd6d0c4);
    t.v.set(4, 4, h, 0xe8e4da);
    branch(t, 4, 4, h - 3, 1, 0, 2, 0xd6d0c4);
    blob(t, 4.5, 4.5, h + 0.5, 2.9, 3.6, BIRCH);
    blob(t, 4.5 + (t.rng.next() - 0.5) * 2, 4.5 + (t.rng.next() - 0.5) * 2, h + 3.2, 2, 2.2, BIRCH);
    shade(t);
    fluff(t);
  },
  willow: (t) => {
    const bark = 0x4e3a26;
    trunk(t, 3, 3, 2, 0, 7, bark, 2);
    branch(t, 3, 3, 6, -1, 0, 2, bark);
    branch(t, 4, 4, 6, 1, 0, 2, bark);
    blob(t, 4, 4, 9, 5.2, 2.4, WILLOW);
    blob(t, 4, 4, 10.5, 3.4, 1.8, WILLOW);
    shade(t);
    // Strands hanging from the rim, in the lighter two shades.
    const rim: [number, number, number][] = [];
    for (const key of t.leaves.keys()) {
      const z = Math.floor(key / 4096);
      const y = (Math.floor(key / 64) % 64) - 32;
      const x = (key % 64) - 32;
      if (t.v.has(x, y, z - 1)) continue;
      if (Math.hypot(x + 0.5 - 4, y + 0.5 - 4) < 3.2) continue;
      rim.push([x, y, z]);
    }
    for (const [x, y, z] of rim) {
      if (h3(x, y, z, t.seed ^ 9) < 0.35) continue;
      const len = 2 + Math.floor(h3(y, x, z, t.seed) * 5);
      for (let k = 1; k <= len && z - k > 0; k++) t.v.set(x, y, z - k, k === len ? WILLOW[2] : (x + y) % 2 ? WILLOW[1] : tone(WILLOW[1], 0.9));
    }
  },
  pine: (t) => pineTiers(t, PINE, false),
  snowpine: (t) => pineTiers(t, SNOWPINE, true),
  palm: (t) => {
    const H = 11 + Math.floor(t.rng.next() * 4);
    const a = t.rng.next() * Math.PI * 2;
    const lx = Math.cos(a);
    const ly = Math.sin(a);
    // A curved trunk in rings, leaning more toward the top.
    let tx = 4;
    let ty = 4;
    for (let z = 0; z < H; z++) {
      const f = (z / H) ** 2 * 3;
      tx = 4 + Math.round(lx * f);
      ty = 4 + Math.round(ly * f);
      t.v.set(tx, ty, z, (z >> 1) % 2 ? 0x8a6a44 : 0x9e7c52);
      if (z < 2) t.v.set(tx + (z ? 0 : 1), ty, z, 0x7a5a38);
    }
    // Coconuts under the fronds.
    t.v.set(tx + 1, ty, H - 2, 0x5a3e22);
    t.v.set(tx, ty + 1, H - 2, 0x4e3420);
    t.v.set(tx, ty, H, PALM[1]);
    // Fronds: out and a little up, then drooping, two cubes wide near the middle.
    const n = 6 + Math.floor(t.rng.next() * 2);
    const b0 = t.rng.next() * Math.PI;
    for (let k = 0; k < n; k++) {
      const b = b0 + (k / n) * Math.PI * 2 + (t.rng.next() - 0.5) * 0.4;
      const dx = Math.cos(b);
      const dy = Math.sin(b);
      const len = 5 + Math.floor(t.rng.next() * 2);
      for (let s = 1; s <= len; s++) {
        const x = tx + Math.round(dx * s);
        const y = ty + Math.round(dy * s);
        const z = H + (s <= 2 ? 1 : 1 - Math.round(((s - 2) * (s - 1)) / 4));
        const c = s === len ? PALM[0] : s % 2 ? PALM[1] : PALM[2];
        t.v.set(x, y, z, c);
        if (s >= 2 && s < len - 1) t.v.set(x + Math.round(-dy), y + Math.round(dx), z, s % 2 ? PALM[2] : PALM[1]);
      }
    }
  },
  dead: (t) => {
    const grey = [0x5a5048, 0x4a423c, 0x6a5e54][Math.floor(t.rng.next() * 3)];
    const h = 8 + Math.floor(t.rng.next() * 3);
    trunk(t, 3, 3, 2, 0, h - 3, grey, 2);
    for (let z = h - 3; z < h + 1; z++) t.v.set(3 + (z > h - 1 ? 1 : 0), 3, z, tone(grey, 0.92));
    const dirs: [number, number][] = [
      [-1, 0],
      [1, 1],
      [0, -1],
      [1, -1],
    ];
    for (let k = 0; k < 3 + Math.floor(t.rng.next() * 2); k++) {
      const [dx, dy] = dirs[k % 4];
      const end = branch(t, 3 + (dx > 0 ? 1 : 0), 3 + (dy > 0 ? 1 : 0), h - 5 + k * 2, dx, dy, 2 + Math.floor(t.rng.next() * 2), grey, 1);
      // A twig up from its end.
      t.v.set(end.x, end.y, end.z + 1, tone(grey, 1.08));
      t.v.set(end.x + dx, end.y, end.z + 2, tone(grey, 1.08));
    }
  },
  mushroom: (t) => mushroomCap(t, [0xd8352a, 0xc42a20, 0xb8642a, 0x8a5a3a][Math.floor(t.rng.next() * 4)], false),
  glowcap: (t) => mushroomCap(t, [0x3fe0d0, 0x5fb8ff, 0x9a7aff, 0x46f0a8][Math.floor(t.rng.next() * 4)], true),
  jungle: (t) => {
    const bark = 0x5e4026;
    const h = 10 + Math.floor(t.rng.next() * 3);
    trunk(t, 3, 3, 2, 0, h, bark, 3);
    branch(t, 3, 3, h - 2, -1, 0, 3, bark, 2);
    branch(t, 4, 4, h - 1, 1, 1, 2, bark, 2);
    blob(t, 4, 4, h + 1.5, 5.4, 2, JUNGLE);
    blob(t, 4 + (t.rng.next() - 0.5) * 2, 4 + (t.rng.next() - 0.5) * 2, h + 4, 3.6, 1.8, JUNGLE);
    shade(t);
    fluff(t);
    // A few vines hanging under the crown.
    for (let k = 0; k < 4; k++) {
      const x = Math.round(4 + Math.cos(k * 1.7 + t.seed) * 3.5);
      const y = Math.round(4 + Math.sin(k * 1.7 + t.seed) * 3.5);
      let z = h + 3;
      while (z > 0 && !t.v.has(x, y, z)) z--;
      const len = 2 + (k % 3);
      for (let s = 1; s <= len; s++) if (!t.v.has(x, y, z - s)) t.v.set(x, y, z - s, JUNGLE[0]);
    }
  },
  juniper: (t) => {
    const bark = 0x6b4a2b;
    trunk(t, 3, 3, 2, 0, 2, bark, 1);
    t.v.set(4, 3, 2, bark);
    t.v.set(4, 4, 2, bark);
    t.v.set(4, 4, 3, bark);
    blob(t, 4.6, 4.2, 5, 3.2, 2.2, JUNIPER, 0.5);
    blob(t, 2.8, 4.8, 4.2, 2.2, 1.6, JUNIPER, 0.5);
    blob(t, 5.2, 3, 6.5, 2, 1.5, JUNIPER, 0.5);
    shade(t);
    fluff(t);
  },
  bamboo: (t) => {
    const greens = [0x7aa83a, 0x8ab842, 0x6a9a32];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + t.rng.next() * 0.5;
      const r = 1 + t.rng.next() * 2.4;
      const x = Math.round(4 + Math.cos(a) * r);
      const y = Math.round(4 + Math.sin(a) * r);
      const h = 11 + Math.floor(t.rng.next() * 7);
      const g = greens[k % 3];
      for (let z = 0; z < h; z++) t.v.set(x, y, z, z % 4 === 3 ? tone(g, 1.25) : g);
      // Leaves off the top: short sprays to the sides.
      const set: Leaves = [0x4f8a26, 0x5f9a2e, 0x7ab03c];
      for (const [dx, dy, dz] of [
        [1, 0, -1],
        [-1, 0, -3],
        [0, 1, -2],
        [0, -1, -4],
      ]) {
        mark(t, x + dx, y + dy, h + dz, set);
        mark(t, x + dx * 2, y + dy * 2, h + dz - 1, set);
      }
      mark(t, x, y, h, set);
    }
    shade(t);
  },
  mangrove: (t) => {
    const bark = 0x5a4632;
    trunk(t, 3, 3, 2, 2, 7, bark, 0);
    // Stilt roots arching down to the ground.
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
      [0, 1],
    ]) {
      const x0 = dx > 0 ? 4 : 3;
      const y0 = dy > 0 ? 4 : 3;
      for (let s = 0; s < 4; s++) {
        t.v.set(x0 + dx * s, y0 + dy * Math.min(s, 2), 3 - s, bark);
        if (s < 3) t.v.set(x0 + dx * (s + 1), y0 + dy * Math.min(s, 2), 3 - s, tone(bark, 0.9));
      }
    }
    blob(t, 4, 4, 9, 5, 2.2, MANGROVE);
    blob(t, 4.5, 3.5, 10.5, 3, 1.5, MANGROVE);
    shade(t);
    fluff(t);
  },
  cypress: (t) => {
    const bark = 0x5a4a36;
    trunk(t, 3, 3, 2, 0, 5, bark, 2);
    t.v.box(2, 2, 0, 6, 6, 1, tone(bark, 0.85));
    const h = 7 + t.rng.next() * 2;
    blob(t, 4, 4, 5 + h, 2.8, h, CYPRESS, 0.4);
    shade(t);
    fluff(t);
  },
  acacia: (t) => {
    const bark = 0x6a4a2e;
    const a = t.rng.next() < 0.5 ? 1 : -1;
    trunk(t, 3, 3, 2, 0, 4, bark, 1);
    // The trunk forks into two arms that reach out under a flat crown.
    const left = branch(t, 3, 3, 4, -1, 0, 3, bark, 1);
    const right = branch(t, 4, 4, 4, a, 1, 3, bark, 1);
    const top = Math.max(left.z, right.z) + 1;
    const set: Leaves = ACACIA;
    for (const p of [left, right]) blob(t, p.x + 0.5, p.y + 0.5, top + 0.5, 3.6, 1.1, set, 0.5);
    blob(t, 4, 4, top + 1, 5.6, 1.2, set, 0.5);
    shade(t);
    fluff(t);
  },
};

// Tiers stacked and narrowing, each drooping at its rim and dark underneath; with snow, white on
// every tier's top.
function pineTiers(t: Tree, set: Leaves, snow: boolean): void {
  const bark = 0x4f3219;
  trunk(t, 3, 3, 2, 0, 4, bark, 1);
  const tiers = 4;
  let z = 3;
  let r = 4.4 + t.rng.next() * 0.4;
  for (let k = 0; k < tiers; k++) {
    // Each tier a stepped cone: wide at its foot, three cubes tall, its rim one cube lower.
    for (let j = 0; j < 3; j++) {
      const rr = r * (1 - j * 0.33);
      for (let y = -PAD; y < 8 + PAD; y++)
        for (let x = -PAD; x < 8 + PAD; x++) {
          const d = Math.hypot(x + 0.5 - 4, y + 0.5 - 4);
          if (d > rr + (h3(x, y, z + j, t.seed) - 0.5) * 0.8) continue;
          const droop = j === 0 && d > rr - 1.1 ? -1 : 0;
          mark(t, x, y, z + j + droop, set);
        }
    }
    z += 3;
    r *= 0.74;
  }
  // The spire.
  mark(t, 3, 3, z, set);
  mark(t, 4, 4, z, set);
  mark(t, 4, 3, z + 1, set);
  shade(t);
  if (snow)
    t.v.each((x, y, zz, c) => {
      if (!t.leaves.has(leafKey(x, y, zz)) || t.v.has(x, y, zz + 1)) return;
      if (h3(x, y, zz, t.seed ^ 0x51) < 0.85) t.v.set(x, y, zz, c === set[0] ? 0xdfe8f0 : 0xf4f8fb);
    });
}

// A mushroom: a pale stem with a skirt, a domed cap with spots on top and gills under it.
function mushroomCap(t: Tree, cap: number, glow: boolean): void {
  const h = 5 + Math.floor(t.rng.next() * 3);
  const stem = glow ? 0xcfe8f0 : 0xefe6d2;
  t.v.box(3, 3, 0, 5, 5, h, stem);
  t.v.box(2, 3, h - 2, 6, 5, h - 1, tone(stem, 0.9));
  t.v.box(3, 2, h - 2, 5, 6, h - 1, tone(stem, 0.9));
  const r = 4.3 + t.rng.next() * 0.6;
  for (let z = h; z < h + 4; z++)
    for (let y = -PAD; y < 8 + PAD; y++)
      for (let x = -PAD; x < 8 + PAD; x++) {
        const d = Math.hypot(x + 0.5 - 4, y + 0.5 - 4);
        const k = z - h;
        const rr = r * Math.sqrt(Math.max(0, 1 - (k / 4) ** 2)) + (k === 0 ? 0.3 : 0);
        if (d > rr) continue;
        const under = k === 0 && d < rr - 1;
        t.v.set(x, y, z, under ? (glow ? tone(cap, 0.7) : 0xe8d8b8) : (x + y + z) % 5 === 0 ? tone(cap, 0.92) : cap, glow && !under);
      }
  // Spots on the cap's top.
  if (!glow)
    t.v.each((x, y, z, c) => {
      if (z < h + 1 || t.v.has(x, y, z + 1) || (c !== cap && c !== tone(cap, 0.92))) return;
      if (h3(x >> 1, y >> 1, 0, t.seed) < 0.22) t.v.set(x, y, z, 0xf6f0e6);
    });
}

export const FINE_VARIANTS = 1;

const trees = new Map<string, LocalMesh>();

// A tree kind's model in small cubes, one of FINE_VARIANTS, in the cell's own frame (x and z
// from 0 to 1), as the old models are, so the view places it the same way.
export function cubeTree(style: Exclude<TreeStyle, "">, variant: number, mid = false): LocalMesh {
  const key = `${style}:${variant}:${mid ? 1 : 0}`;
  let m = trees.get(key);
  if (!m) {
    let seed = 7919 + variant * 104729;
    for (let k = 0; k < style.length; k++) seed = Math.imul(seed ^ style.charCodeAt(k), 0x01000193) >>> 0;
    const t: Tree = { v: new Vox(8, TALL, PAD), rng: new Rng(seed), seed, leaves: new Map() };
    (FINE[style] ?? FINE.oak)(t);
    m = skyOnly((mid ? t.v.coarse() : t.v).mesh());
    trees.set(key, m);
  }
  return m;
}

// A tree's faces without those that look down (under a crown, a branch): the sky view never sees
// them, and the eye view draws trees by their old models (near.ts). About a sixth of its triangles.
function skyOnly(m: LocalMesh): LocalMesh {
  const keep = (a: { pos: number[]; col: number[] }) => {
    const pos: number[] = [];
    const col: number[] = [];
    for (let k = 0; k < a.pos.length; k += 9) {
      const p = a.pos;
      const ux = p[k + 3] - p[k];
      const uz = p[k + 5] - p[k + 2];
      const vx = p[k + 6] - p[k];
      const vz = p[k + 8] - p[k + 2];
      const ny = uz * vx - ux * vz;
      const flat = Math.abs(p[k + 1] - p[k + 4]) < 1e-6 && Math.abs(p[k + 1] - p[k + 7]) < 1e-6;
      if (flat && ny < 0) continue;
      for (let j = 0; j < 9; j++) {
        pos.push(p[k + j]);
        col.push(a.col[k + j]);
      }
    }
    return { pos, col };
  };
  const lit = keep(m.lit);
  const glow = keep(m.glow);
  return { lit, glow, tris: (lit.pos.length + glow.pos.length) / 9 };
}

// The trees of the old islands by their model's name (models.ts), as a kind of the flora kit.
export const OLD_TREES: Record<string, Exclude<TreeStyle, "">> = {
  tree: "oak",
  pine: "pine",
  palm: "palm",
  snowpine: "snowpine",
  jungle: "jungle",
  willow: "willow",
  juniper: "juniper",
};

// ---------------------------------------------------------------------------------------------
// Where the cubes are drawn: near what the camera looks at. Within `r` of it in eighth-cell cubes,
// within `r2` in quarter-cell cubes (mid zoom), farther the old models, as the land does. The trees
// nearest that point first, within a budget of triangles for each size (a forest seen from mid
// zoom is hundreds of trees); the houses all within reach (a village is a few dozen). Placed
// again once the camera has looked REFOCUS cells away or zoomed by about a third.

export const FINE_DIST = 75;
export const NEAR_TREE_TRIS = 80_000;
export const MID_TREE_TRIS = 70_000;
export const REFOCUS = 8;

export interface FineFocus {
  x: number;
  y: number;
  r: number;
  r2: number;
  // The ground under the camera: the trees nearest it get the finest cubes.
  cx: number;
  cy: number;
  // In the eye view: the houses only (the trees near the eye have their own models, near.ts).
  eye: boolean;
}

export function fineFocus(
  on: boolean,
  dist: number,
  tx: number,
  ty: number,
  eye: { x: number; y: number } | null,
  cam: { x: number; y: number } = { x: tx, y: ty },
): FineFocus | null {
  if (!on) return null;
  if (eye) return { x: eye.x, y: eye.y, r: 16, r2: 32, cx: eye.x, cy: eye.y, eye: true };
  if (dist > FINE_DIST) return null;
  const r = dist > 45 ? 0 : Math.max(10, Math.min(22, dist * 0.55));
  return { x: tx, y: ty, r, r2: Math.max(r + 6, Math.min(50, dist * 0.9)), cx: cam.x, cy: cam.y, eye: false };
}

// Which size of cube at a distance d from the focus: 1 eighths, 2 quarters, 0 the old model.
export function lodAt(f: FineFocus | null, dx: number, dy: number): 0 | 1 | 2 {
  if (!f) return 0;
  const d2 = dx * dx + dy * dy;
  return d2 < f.r * f.r ? 1 : d2 < f.r2 * f.r2 ? 2 : 0;
}

// Whether the cubes must be placed again for the camera's new focus.
export function refocus(was: FineFocus | null, now: FineFocus | null): boolean {
  if (!was || !now) return was !== now;
  if (was.eye !== now.eye || (was.r === 0) !== (now.r === 0)) return true;
  return (
    Math.hypot(now.x - was.x, now.y - was.y) > (now.eye ? 4 : REFOCUS) ||
    Math.hypot(now.cx - was.cx, now.cy - was.cy) > REFOCUS * 1.5 ||
    Math.abs(Math.log(now.r2 / was.r2)) > 0.28
  );
}
