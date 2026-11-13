import type { World } from "./world";

// Fine box models for what an item looks like (4.6, the owner: "you can add
// smaller details, it does not need to be one block size resolution"). A
// program draws an object, the touches of a building or a place, with boxes
// down to a twentieth of a cell, as the island's own wonders are drawn (the
// hot spring's stones, the arch's blocks): one mesh per prop and one more
// for what shines (voxel/props.ts), none of the 20,000 voxels spells share.
// A prop is a look only: what the item does is its artifact, landmark or
// creature. A blast over it takes it away, as it does a standing wonder.
//
// Units: cells across, and up in voxels (a voxel is a cell tall), from the
// ground under the prop's center.

export interface PropBox {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: number;
  glow: boolean;
  // The looks revamp, phase 1 (2026-11-13). All optional: a stored look that
  // gives none of them draws exactly as it did. A turn in degrees about the
  // part's center (rx about the east-west line, ry about the north-south line,
  // rz about the up line), a shape other than a box, and grain (0 to 0.3): its
  // faces cut in small tiles of slightly different tones.
  rx?: number;
  ry?: number;
  rz?: number;
  shape?: Exclude<Shape, "box">;
  grain?: number;
}

// The shapes a part can take: a box; a wedge (a ramp, full height on its west
// side, down to nothing on its east side: roofs, steps, buttresses); a cyl (8
// sides: towers, barrels, trunks, columns); a cone (8 sides: roofs, spires,
// tree tops); a dome (half a sphere: cupolas, shells, bushes). Each fills the
// box x, y, z, w, d, h; cyl, cone and dome are round in it.
export const SHAPES = ["box", "wedge", "cyl", "cone", "dome"] as const;
export type Shape = (typeof SHAPES)[number];
export const MAX_GRAIN = 0.3;
// grain: true, or "grain" in a part's list.
export const GRAIN = 0.08;

export interface Prop {
  key: string;
  // The placing it belongs to (one cast of one item): an item has
  // MODELS_PER_ITEM at most, so it cannot crowd out the others' looks.
  owner?: string;
  name: string;
  x: number;
  y: number;
  // Turned about its center, radians.
  turn: number;
  boxes: PropBox[];
  // Soft shadow in its corners (voxel/shapes.ts): on for a look that uses a new
  // field of its parts, or asks for it; off for the looks stored before.
  soft?: boolean;
  // 4.7: the creature whose hand holds it (held.ts): drawn there, small, not on the ground.
  heldBy?: number | null;
}

// As many as the landmarks a save keeps (60): every placed item can have its look.
export const MAX_PROPS = 60;
// 160 parts since the looks revamp (phase 1); the island draws far looks with
// fewer when it has too many triangles (voxel/props.ts).
export const MAX_PROP_BOXES = 160;
// A prop reaches 12 cells from its center and 60 voxels up at most.
const REACH = 12;
const UP = 60;
// A thin side (a page, a blade, a label) is drawn at FINE_BOX, not dropped. A side of zero or less, or
// one that is not a number, still has no box.
export const FINE_BOX = 0.05;
const FINE = FINE_BOX;

const clamp = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.max(lo, Math.min(hi, n));
};

function colorOf(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v & 0xffffff;
  if (typeof v === "string") {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(v.trim());
    if (m) {
      const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
      return parseInt(h, 16);
    }
  }
  return fallback;
}

// A turn in degrees, from -180 to 180; 0 for what is not a number.
function degrees(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  const d = (((v % 360) + 540) % 360) - 180;
  return Math.round((d === -180 ? 180 : d) * 100) / 100;
}

// One box from a program: [x, y, z, w, d, h, color, "glow"] or an object
// {x, y, z, w, d, h, color, glow}. Null when it has no size. Since phase 1 of
// the looks revamp, also {rx, ry, rz, shape, grain} on the object, or after the
// colour in the list: words ("cone", "grain") and one object of those fields
// ([0, 0, 2, 1, 1, 1, "#c55", "cone", { rz: 45 }]).
export function readBox(v: unknown): PropBox | null {
  let a: Record<string, unknown> | null = null;
  if (Array.isArray(v)) {
    a = { x: v[0], y: v[1], z: v[2], w: v[3], d: v[4], h: v[5], color: v[6], glow: v[7] === "glow" || v[7] === true };
    for (const e of v.slice(7)) {
      if (typeof e === "string") {
        const word = e.trim().toLowerCase();
        if ((SHAPES as readonly string[]).includes(word)) a.shape = word;
        else if (word === "grain") a.grain = true;
      } else if (e && typeof e === "object" && !Array.isArray(e)) {
        const o = e as Record<string, unknown>;
        for (const k of ["rx", "ry", "rz", "shape", "grain"]) if (o[k] !== undefined) a[k] = o[k];
        if (o.glow === true || o.glow === "glow") a.glow = true;
      }
    }
  } else if (v && typeof v === "object") a = v as Record<string, unknown>;
  if (!a) return null;
  const w0 = clamp(a.w, 0, 2 * REACH, 0);
  const d0 = clamp(a.d, 0, 2 * REACH, 0);
  const h0 = clamp(a.h, 0, UP, 0);
  if (!(w0 > 0 && d0 > 0 && h0 > 0)) return null;
  const w = Math.max(w0, FINE);
  const d = Math.max(d0, FINE);
  const h = Math.max(h0, FINE);
  return {
    x: clamp(a.x, -REACH, REACH, 0),
    y: clamp(a.y, -REACH, REACH, 0),
    z: clamp(a.z, -2, UP, 0),
    w,
    d,
    h,
    color: colorOf(a.color, 0xb0a890),
    glow: a.glow === true || a.glow === "glow",
    ...newFields(a),
  };
}

// The phase 1 fields, only those that change the look: none for a stored look.
function newFields(a: Record<string, unknown>): Partial<PropBox> {
  const out: Partial<PropBox> = {};
  for (const k of ["rx", "ry", "rz"] as const) {
    const d = degrees(a[k]);
    if (d) out[k] = d;
  }
  const shape = typeof a.shape === "string" ? a.shape.trim().toLowerCase() : "";
  if (shape !== "box" && (SHAPES as readonly string[]).includes(shape)) out.shape = shape as Exclude<Shape, "box">;
  const g = a.grain === true || a.grain === "grain" ? GRAIN : clamp(a.grain, 0, MAX_GRAIN, 0);
  if (g > 0) out.grain = Math.round(g * 1000) / 1000;
  return out;
}

// A part with a phase 1 field: its look is soft-shadowed (Prop.soft).
export function isNewPart(b: PropBox): boolean {
  return b.shape !== undefined || !!b.rx || !!b.ry || !!b.rz || !!b.grain;
}

// The eight corners of a part on the ground's axes (x, y across, z up), turned as it is.
export function partCorners(b: PropBox): [number, number, number][] {
  const [ax, ay, az] = [((b.rx ?? 0) * Math.PI) / 180, ((b.ry ?? 0) * Math.PI) / 180, ((b.rz ?? 0) * Math.PI) / 180];
  const cx = b.x + b.w / 2;
  const cy = b.y + b.d / 2;
  const cz = b.z + b.h / 2;
  const out: [number, number, number][] = [];
  for (const u of [-0.5, 0.5])
    for (const v of [-0.5, 0.5])
      for (const t of [-0.5, 0.5]) {
        let x = u * b.w;
        let y = v * b.d;
        let z = t * b.h;
        [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
        [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
        [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
        out.push([cx + x, cy + y, cz + z]);
      }
  return out;
}

export function readProp(v: unknown): Prop | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.x !== "number" || typeof o.y !== "number" || !Number.isFinite(o.x) || !Number.isFinite(o.y)) return null;
  const boxes = (Array.isArray(o.boxes) ? o.boxes : [])
    .map(readBox)
    .filter((b): b is PropBox => b !== null)
    .slice(0, MAX_PROP_BOXES);
  if (!boxes.length) return null;
  const soft = o.soft === true || boxes.some(isNewPart);
  return {
    key: typeof o.key === "string" ? o.key.slice(0, 80) : "",
    ...(typeof o.owner === "string" ? { owner: o.owner.slice(0, 120) } : {}),
    name: typeof o.name === "string" ? o.name.slice(0, 40) : "",
    x: o.x,
    y: o.y,
    turn: clamp(o.turn, -10, 10, 0),
    boxes,
    ...(soft ? { soft: true } : {}),
  };
}

// How far a prop reaches: cells across (its widest side on the ground) and
// voxels tall above the ground.
export function propBounds(p: Prop): { across: number; tall: number; x0: number; x1: number; y0: number; y1: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let tall = 0;
  const c = Math.cos(p.turn);
  const s = Math.sin(p.turn);
  for (const b of p.boxes) {
    const turned = !!(b.rx || b.ry || b.rz);
    const corners = turned
      ? partCorners(b).map(([x, y]) => [x, y])
      : [
          [b.x, b.y],
          [b.x + b.w, b.y],
          [b.x, b.y + b.d],
          [b.x + b.w, b.y + b.d],
        ];
    for (const [dx, dy] of corners) {
      const x = p.x + dx * c - dy * s;
      const y = p.y + dx * s + dy * c;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    tall = Math.max(tall, turned ? Math.max(...partCorners(b).map((c) => c[2])) : b.z + b.h);
  }
  return { across: Math.max(x1 - x0, y1 - y0), tall, x0, x1, y0, y1 };
}

// Every part its own shade, as the wonders' parts are (voxel/wonders.ts
// `vary`: the hot spring's 13 stones are 13 colors). Seeded by the prop's
// place and the part's index, so the same program draws the same model.
export function shadeParts(p: Prop, amount: number): void {
  if (amount <= 0) return;
  let h = (Math.imul(Math.round(p.x * 20), 73856093) ^ Math.imul(Math.round(p.y * 20), 19349663)) >>> 0;
  for (const b of p.boxes) {
    h = (Math.imul(h ^ (h >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    const k = 1 + (h / 4294967296 - 0.5) * 2 * (b.glow ? amount * 0.4 : amount);
    const ch = (sh: number) => Math.max(0, Math.min(255, Math.round(((b.color >> sh) & 255) * k)));
    b.color = (ch(16) << 16) | (ch(8) << 8) | ch(0);
  }
}

// The newest is always drawn: on a full island the oldest model gives way
// (the review of #50: the 41st item placed was drawn with nothing).
// At most this many models for one placed item (the review of #50: a
// garden of 64 one-flower models took every other item's look away); past
// it, that item's own oldest gives way.
export const MODELS_PER_ITEM = 4;

// A model a wonder drew (its cast's key is wonder:<id>, src/sim/wonders.ts).
export function isWonderProp(p: Prop): boolean {
  return !!p.owner?.startsWith("wonder:");
}

export function addProp(world: World, p: Prop): boolean {
  if (p.owner) {
    const own = world.props.filter((q) => q.owner === p.owner);
    if (own.length >= MODELS_PER_ITEM) world.props.splice(world.props.indexOf(own[0]), 1);
  }
  // Full: the oldest goes, but not a wonder's look (4.7: wonders are drawn in
  // models since #79, and as the island's oldest they went first), while
  // wonders hold half the models or fewer.
  while (world.props.length >= MAX_PROPS) {
    const wonders = world.props.filter(isWonderProp).length;
    const k = wonders <= MAX_PROPS / 2 ? world.props.findIndex((q) => !isWonderProp(q)) : 0;
    world.props.splice(k < 0 ? 0 : k, 1);
  }
  world.props.push(p);
  world.propsVersion++;
  return true;
}

// A blast of radius 3 or more takes away the props whose center it covers.
export function blastProps(world: World, x: number, y: number, r: number): void {
  if (!world.props.length || r < 3) return;
  const left = world.props.filter((p) => Math.hypot(p.x - x, p.y - y) > r);
  if (left.length === world.props.length) return;
  world.props = left;
  world.propsVersion++;
}
