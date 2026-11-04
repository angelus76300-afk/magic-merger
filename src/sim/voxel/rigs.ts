import { body, BUILDS, isItem, type BodySpec, type Build, type Feature, type ModelBox, type Plan } from "../body";
import { scaleColor } from "../colors";
import { GRAY_HAIR, HAIRS, SKINS, STYLES, unpackLook, type Look } from "../villagers";
import { separate } from "./faces";

// A creature's figure as boxes (3.5), in units of its size, standing on y 0
// and facing +z. Pure math, no three.js: the view (figures.ts) and the
// bestiary draw it, npm test checks it. Each part is one box that turns about
// a pivot with one motion (legs swing, wings flap, tails sway, a head nods),
// so a figure needs no skeleton and every part of every creature is the same
// instanced cube.

export const A = {
  NONE: 0,
  LEG_A: 1,
  LEG_B: 2,
  ARM_A: 3,
  ARM_B: 4,
  WING_L: 5,
  WING_R: 6,
  TAIL: 7,
  HEAD: 8,
  // A serpent's body: each segment shifted sideways a little later than the one before.
  SEG: 9,
  // Legs sticking out sideways (insects, spiders) swing forward and back.
  SIDE_A: 10,
  SIDE_B: 11,
  // A slime squashes and stretches.
  SQUASH: 12,
  // Motes circling a spirit.
  ORBIT: 13,
  // An arm that carries something: held forward, hardly swinging.
  HOLD: 14,
} as const;

// What color a part takes, from the creature (see paletteOf).
export const R = { BODY: 0, BODY2: 1, DARK: 2, SKIN: 3, HAIR: 4, PANTS: 5, EYE: 6, GLOW: 7, HAT: 8, CLOTH: 9, FIXED: 10 } as const;
export const ROLES = 10;

export type V3 = [number, number, number];

export interface Part {
  // The pivot its motion turns about.
  p: V3;
  // Where its fixed tilt turns about, from the pivot, then the tilt (radians, XYZ).
  q: V3;
  rot: V3 | null;
  // The box's corner from q (in the tilted frame) and its size.
  o: V3;
  s: V3;
  role: number;
  color: number;
  anim: number;
  // Which segment, for SEG and ORBIT; a delay for the others.
  seg: number;
  glow: boolean;
  // 1: a detail, left out from far away.
  lod: number;
}

export interface Rig {
  parts: Part[];
  height: number;
  // Half the body's width: how high it lies once fallen on its side.
  halfWidth: number;
  // Leaning forward, for elders.
  lean: number;
  // Wing beats per second when flying.
  flapRate: number;
  // Default second color for the plan: lighter or darker body, or a color.
  body2: number | "light" | "dark";
  glowColor: number;
  // What the view computes once for this rig (figures.ts).
  baked?: unknown;
}

interface Attach {
  p: V3;
  anim: number;
  seg: number;
}

// Where features go on a plan.
interface Anchors {
  // The head box.
  head: Attach & { cx: number; bottom: number; top: number; front: number; back: number; half: number };
  // Where the eyes are (on the head, except for tree folk).
  face: Attach & { cx: number; y: number; z: number; half: number; eyes: number; scale: number };
  torso: { x0: number; y0: number; z0: number; w: number; h: number; d: number };
  back: Attach & { y: number; z: number; half: number };
  rear: Attach & { y: number; z: number };
  hand: Attach & { x: number; y: number; z: number };
  hand2: Attach & { x: number; y: number; z: number };
  // Built in already: the feature is not added again.
  has: Feature[];
}

interface Opt {
  p?: V3;
  anim?: number;
  seg?: number;
  // Fixed tilt about q (absolute).
  rot?: V3;
  q?: V3;
  glow?: boolean;
  lod?: number;
  color?: number;
}

const ZERO: V3 = [0, 0, 0];
const STEEL = 0xb4bcc6;
const WOOD = 0x7a5230;
const BONE = 0xe8dcc0;
const GOLD = 0xf2c94c;

class Builder {
  parts: Part[] = [];
  // A box by its corner and size, in figure units.
  box(role: number, x0: number, y0: number, z0: number, w: number, h: number, d: number, o: Opt = {}): Part {
    const p = o.p ?? ZERO;
    const q = o.rot ? (o.q ?? p) : p;
    const part: Part = {
      p,
      q: [q[0] - p[0], q[1] - p[1], q[2] - p[2]],
      rot: o.rot ?? null,
      o: [x0 - q[0], y0 - q[1], z0 - q[2]],
      s: [Math.max(0.005, w), Math.max(0.005, h), Math.max(0.005, d)],
      role,
      color: o.color ?? 0,
      anim: o.anim ?? A.NONE,
      seg: o.seg ?? 0,
      glow: !!o.glow,
      lod: o.lod ?? 0,
    };
    this.parts.push(part);
    return part;
  }
  // Centered on x and z.
  c(role: number, cx: number, y0: number, cz: number, w: number, h: number, d: number, o: Opt = {}): Part {
    return this.box(role, cx - w / 2, y0, cz - d / 2, w, h, d, o);
  }
}

const at = (a: Attach, extra: Opt = {}): Opt => ({ p: a.p, anim: a.anim, seg: a.seg, ...extra });
const b = (build: Build, key: keyof Build) => build[key] ?? 1;

// Two legs: people, knights, goblins.
function twoLegs(B: Builder, build: Build, villager: Look | null): Anchors {
  const child = villager?.age === "child";
  const legs = b(build, "legs") * (child ? 0.78 : 1);
  const bulk = b(build, "bulk");
  const hs = b(build, "head") * (child ? 1.22 : 1);
  const L = 0.55 * legs;
  const T = 0.55 * (child ? 0.82 : 1) * Math.sqrt(bulk);
  const W = 0.46 * bulk;
  const D = 0.28 * bulk;
  const H = 0.42 * hs;
  const lw = 0.2 * Math.sqrt(bulk);
  for (const side of [1, -1]) {
    const p: V3 = [side * 0.12 * bulk, L, 0];
    const anim = side > 0 ? A.LEG_A : A.LEG_B;
    B.c(R.PANTS, p[0], 0, 0, lw, L + 0.04, 0.2, { p, anim });
    B.c(R.DARK, p[0], 0, 0.02, lw + 0.02, 0.08, 0.25, { p, anim, lod: 1 });
  }
  B.c(R.BODY, 0, L, 0, W, T, D);
  const arm = (side: number): Attach & { x: number; y: number; z: number } => {
    const x = side * (W / 2 + 0.08);
    const p: V3 = [x, L + T - 0.06, 0];
    const anim = side > 0 ? A.ARM_B : A.ARM_A;
    B.c(R.BODY, x, L + T - 0.5, 0, 0.14, 0.48, 0.16, { p, anim });
    B.c(villager ? R.SKIN : R.DARK, x, L + T - 0.57, 0, 0.15, 0.1, 0.17, { p, anim, lod: 1 });
    return { p, anim, seg: 0, x, y: L + T - 0.55, z: 0.02 };
  };
  const hand = arm(1);
  const hand2 = arm(-1);
  const neck: V3 = [0, L + T, 0];
  B.c(R.SKIN, 0, L + T, 0.01, H, H, H, { p: neck, anim: A.HEAD });
  const head = { p: neck, anim: A.HEAD, seg: 0, cx: 0, bottom: L + T, top: L + T + H, front: 0.01 + H / 2, back: 0.01 - H / 2, half: H / 2 };
  if (villager) {
    // Hair over the top and back of the head; long hair down to the shoulders.
    const drop = villager.long ? H * 0.75 : H * 0.3;
    B.box(R.HAIR, -H / 2 - 0.02, head.top - drop, head.back - 0.025, H + 0.04, drop + 0.04, H * 0.45, { p: neck, anim: A.HEAD });
    B.box(R.HAIR, -H / 2 - 0.02, head.top - 0.08, head.back - 0.025, H + 0.04, 0.12, H * 0.85, { p: neck, anim: A.HEAD });
  }
  return {
    head,
    face: { p: neck, anim: A.HEAD, seg: 0, cx: 0, y: L + T + H * 0.55, z: head.front, half: H / 2, eyes: 2, scale: 1 },
    torso: { x0: -W / 2, y0: L, z0: -D / 2, w: W, h: T, d: D },
    back: { p: ZERO, anim: A.NONE, seg: 0, y: L + T - 0.08, z: -D / 2, half: W / 2 },
    rear: { p: [0, L + 0.08, -D / 2], anim: A.TAIL, seg: 0, y: L + 0.08, z: -D / 2 },
    hand,
    hand2,
    has: [],
  };
}

// Four legs: deer, wolf, boar, bear, horse.
function fourLegs(B: Builder, build: Build): Anchors {
  const bulk = b(build, "bulk");
  const Lg = 0.42 * b(build, "legs");
  const Bl = 0.95 * b(build, "long");
  const Bh = 0.36 * bulk;
  const Bw = 0.36 * bulk;
  const Hs = 0.3 * b(build, "head") * (0.85 + 0.15 * bulk);
  const lw = 0.12 * Math.sqrt(bulk);
  B.box(R.BODY, -Bw / 2, Lg, -Bl / 2, Bw, Bh, Bl);
  B.c(R.BODY2, 0, Lg + 0.05, Bl / 2, Bw * 0.6, Bh * 0.6, 0.03, { lod: 1 });
  for (const fx of [1, -1])
    for (const fz of [1, -1]) {
      const cx = fx * (Bw / 2 - lw / 2 - 0.01);
      const cz = fz * (Bl / 2 - lw / 2 - 0.04);
      const p: V3 = [cx, Lg + 0.03, cz];
      const anim = fx > 0 === fz > 0 ? A.LEG_A : A.LEG_B;
      B.c(R.BODY, cx, 0, cz, lw, Lg + 0.06, lw, { p, anim });
      B.c(R.DARK, cx, 0, cz, lw + 0.02, 0.06, lw + 0.02, { p, anim, lod: 1 });
    }
  if (build.hump) B.c(R.BODY, 0, Lg + Bh - 0.02, -0.04, Bw * 0.7, 0.16 * build.hump, Bl * 0.36);
  const nl = 0.22 * b(build, "neck");
  const pivot: V3 = [0, Lg + Bh - 0.05, Bl / 2 - 0.1];
  const head: Attach = { p: pivot, anim: A.HEAD, seg: 0 };
  if (nl > 0.08) B.c(R.BODY, 0, Lg + Bh - 0.12, Bl / 2 - 0.06, 0.16 * Math.sqrt(bulk), nl + 0.14, 0.2, head);
  const hy = Lg + Bh - 0.06 + nl * 0.85;
  const hz = Bl / 2 - 0.08;
  B.box(R.BODY, -Hs / 2, hy, hz, Hs, Hs, Hs, head);
  const sd = 0.14 * b(build, "snout");
  const sw = Hs * 0.62;
  const sh = Hs * 0.5;
  if (sd > 0.04) {
    B.box(R.BODY2, -sw / 2, hy, hz + Hs - 0.01, sw, sh, sd, head);
    B.c(R.DARK, 0, hy + sh - 0.04, hz + Hs + sd - 0.01, sw * 0.5, 0.05, 0.03, { ...head, lod: 1 });
  }
  const ears = b(build, "ears");
  const eh = 0.1 * ears;
  for (const side of [1, -1]) B.c(R.BODY, side * (Hs / 2 - 0.05), hy + Hs - 0.01, hz + 0.06, 0.06, eh, 0.05, { ...head, lod: ears > 1.5 ? 0 : 1 });
  const tail = b(build, "tail");
  const tp: V3 = [0, Lg + Bh - 0.06, -Bl / 2];
  if (tail >= 0.4)
    B.box(R.BODY, -0.045, tp[1] - 0.045, -Bl / 2 - 0.32 * tail, 0.09, 0.09, 0.32 * tail + 0.03, { p: tp, anim: A.TAIL, rot: [-0.45, 0, 0], q: tp });
  else B.c(R.BODY2, 0, tp[1] - 0.06, -Bl / 2 - 0.04, 0.11, 0.11, 0.1, { p: tp, anim: A.TAIL, lod: 1 });
  return {
    head: { ...head, cx: 0, bottom: hy, top: hy + Hs, front: hz + Hs, back: hz, half: Hs / 2 },
    face: { ...head, cx: 0, y: hy + Hs * 0.7, z: hz + Hs, half: Hs / 2, eyes: 2, scale: 1 },
    torso: { x0: -Bw / 2, y0: Lg, z0: -Bl / 2, w: Bw, h: Bh, d: Bl },
    back: { p: ZERO, anim: A.NONE, seg: 0, y: Lg + Bh, z: 0.05, half: Bw / 2 },
    rear: { p: tp, anim: A.TAIL, seg: 0, y: tp[1], z: -Bl / 2 },
    hand: { ...head, x: 0, y: hy - 0.03, z: hz + Hs + Math.max(sd, 0.04) * 0.6 },
    hand2: { p: ZERO, anim: A.NONE, seg: 0, x: Bw / 2 + 0.02, y: Lg + Bh * 0.4, z: 0 },
    has: ["tail"],
  };
}

function bird(B: Builder, build: Build): Anchors {
  const beak = 0xe0a030;
  // A wading bird (4.4.5) stands on long legs with its head on a long neck;
  // every other bird sits low, as before (L and N are 0).
  const L = build.legs ? 0.2 * build.legs : 0;
  const N = L && build.neck ? 0.12 * build.neck : 0;
  if (L) {
    for (const side of [1, -1]) {
      const p: V3 = [side * 0.06, L + 0.1, 0];
      B.c(R.DARK, side * 0.06, 0, 0, 0.035, L + 0.16, 0.035, { p, anim: side > 0 ? A.LEG_A : A.LEG_B });
    }
    if (N) B.c(R.BODY, 0, L + 0.32, 0.17, 0.08, N + 0.1, 0.08);
  }
  const H = L + N;
  for (const side of [1, -1]) B.c(R.FIXED, side * 0.06, 0, 0, 0.04, 0.16, 0.04, { color: beak, lod: 1 });
  B.box(R.BODY, -0.15, L + 0.14, -0.24, 0.3, 0.28, 0.46);
  B.c(R.BODY2, 0, L + 0.18, 0.22, 0.2, 0.18, 0.02, { lod: 1 });
  const head: Attach = { p: [0, H + 0.38, 0.15], anim: A.HEAD, seg: 0 };
  B.box(R.BODY, -0.1, H + 0.36, 0.12, 0.2, 0.2, 0.2, head);
  B.box(R.FIXED, -0.035, H + 0.41, 0.31, 0.07, 0.06, 0.11, { ...head, color: beak });
  for (const side of [1, -1]) {
    const p: V3 = [side * 0.15, L + 0.39, 0];
    B.box(R.BODY2, side > 0 ? 0.14 : -0.56, L + 0.37, -0.18, 0.42, 0.04, 0.34, { p, anim: side > 0 ? A.WING_L : A.WING_R });
  }
  const tp: V3 = [0, L + 0.32, -0.22];
  B.box(R.BODY, -0.09, L + 0.3, -0.44, 0.18, 0.035, 0.24, { p: tp, anim: A.TAIL });
  return {
    head: { ...head, cx: 0, bottom: H + 0.36, top: H + 0.56, front: 0.32, back: 0.12, half: 0.1 },
    face: { ...head, cx: 0, y: H + 0.5, z: 0.32, half: 0.1, eyes: 2, scale: 1 },
    torso: { x0: -0.15, y0: L + 0.14, z0: -0.24, w: 0.3, h: 0.28, d: 0.46 },
    back: { p: ZERO, anim: A.NONE, seg: 0, y: L + 0.42, z: 0, half: 0.15 },
    rear: { p: tp, anim: A.TAIL, seg: 0, y: L + 0.32, z: -0.24 },
    hand: { ...head, x: 0, y: H + 0.4, z: 0.42 },
    hand2: { ...head, x: 0, y: H + 0.4, z: 0.42 },
    has: ["wings", "tail"],
  };
}

function fish(B: Builder): Anchors {
  B.box(R.BODY, -0.1, 0, -0.3, 0.2, 0.32, 0.6);
  B.box(R.BODY, -0.09, 0.03, 0.29, 0.18, 0.26, 0.13);
  B.box(R.BODY2, -0.105, 0.12, -0.25, 0.21, 0.06, 0.5, { lod: 1 });
  const tp: V3 = [0, 0.16, -0.29];
  B.box(R.BODY2, -0.02, 0.01, -0.52, 0.04, 0.3, 0.24, { p: tp, anim: A.TAIL });
  B.box(R.BODY2, -0.02, 0.31, -0.12, 0.04, 0.1, 0.22, { lod: 1 });
  const none = { p: ZERO, anim: A.NONE, seg: 0 };
  return {
    head: { ...none, cx: 0, bottom: 0.03, top: 0.29, front: 0.42, back: 0.29, half: 0.09 },
    face: { ...none, cx: 0, y: 0.2, z: 0.42, half: 0.09, eyes: 2, scale: 1.1 },
    torso: { x0: -0.1, y0: 0, z0: -0.3, w: 0.2, h: 0.32, d: 0.6 },
    back: { ...none, y: 0.32, z: 0, half: 0.1 },
    rear: { p: tp, anim: A.TAIL, seg: 0, y: 0.16, z: -0.3 },
    hand: { ...none, x: 0, y: 0.1, z: 0.46 },
    hand2: { ...none, x: 0.11, y: 0.15, z: 0 },
    has: ["tail"],
  };
}

// Each segment turns about its own middle and is shifted sideways a little
// later than the one in front of it.
function serpent(B: Builder): Anchors {
  const head: Attach = { p: [0, 0.1, 0.64], anim: A.SEG, seg: 0 };
  B.box(R.BODY, -0.14, 0, 0.5, 0.28, 0.24, 0.28, head);
  B.box(R.FIXED, -0.02, 0.05, 0.77, 0.04, 0.02, 0.1, { ...head, color: 0xd03030, lod: 1 });
  const seg = (i: number): Attach => ({ p: [0, 0.1, 0.4 - (i - 1) * 0.22], anim: A.SEG, seg: i });
  for (let i = 1; i <= 6; i++) {
    const k = 1 - (i - 1) * 0.12;
    // Each a little off the ground of the one before, so no two bellies share a plane.
    B.c(i % 2 ? R.BODY : R.BODY2, 0, 0.012 * i, seg(i).p[2], 0.24 * k, 0.2 * k, 0.27, seg(i));
  }
  return {
    head: { ...head, cx: 0, bottom: 0, top: 0.24, front: 0.78, back: 0.5, half: 0.14 },
    face: { ...head, cx: 0, y: 0.17, z: 0.78, half: 0.14, eyes: 2, scale: 1 },
    torso: { x0: -0.12, y0: 0, z0: 0.27, w: 0.24, h: 0.2, d: 0.27 },
    back: { ...seg(2), y: 0.18, z: 0.18, half: 0.11 },
    rear: { ...seg(6), y: 0.08, z: -0.83 },
    hand: { ...head, x: 0, y: 0.05, z: 0.82 },
    hand2: { ...seg(2), x: 0.12, y: 0.1, z: 0.18 },
    has: ["tail"],
  };
}

// Six legs out to the sides, in two alternating sets of three.
function insect(B: Builder): Anchors {
  B.box(R.BODY2, -0.16, 0.1, -0.42, 0.32, 0.24, 0.36);
  B.box(R.BODY, -0.12, 0.12, -0.08, 0.24, 0.18, 0.22);
  const head: Attach = { p: [0, 0.2, 0.14], anim: A.HEAD, seg: 0 };
  B.box(R.BODY, -0.1, 0.14, 0.14, 0.2, 0.18, 0.18, head);
  [0.1, 0.02, -0.06].forEach((z, n) => {
    for (const side of [1, -1]) {
      const p: V3 = [side * 0.12, 0.2, z];
      const anim = (n % 2 === 0) === side > 0 ? A.SIDE_A : A.SIDE_B;
      B.box(R.DARK, side > 0 ? 0.12 : -0.36, 0.185, z - 0.015, 0.24, 0.03, 0.03, { p, anim, rot: [0, 0, -side * 0.6], q: p });
    }
  });
  for (const side of [1, -1]) {
    const q: V3 = [side * 0.05, 0.31, 0.28];
    B.box(R.DARK, q[0] - 0.01, 0.3, 0.28, 0.02, 0.02, 0.22, { ...head, rot: [-0.6, side * 0.3, 0], q, lod: 1 });
  }
  return {
    head: { ...head, cx: 0, bottom: 0.14, top: 0.32, front: 0.32, back: 0.14, half: 0.1 },
    face: { ...head, cx: 0, y: 0.25, z: 0.32, half: 0.1, eyes: 2, scale: 1.5 },
    torso: { x0: -0.12, y0: 0.12, z0: -0.08, w: 0.24, h: 0.18, d: 0.22 },
    back: { p: ZERO, anim: A.NONE, seg: 0, y: 0.3, z: 0.02, half: 0.12 },
    rear: { p: [0, 0.2, -0.42], anim: A.TAIL, seg: 0, y: 0.2, z: -0.42 },
    hand: { ...head, x: 0, y: 0.15, z: 0.36 },
    hand2: { ...head, x: 0, y: 0.15, z: 0.36 },
    has: [],
  };
}

// Eight legs, each up to a knee and down to the ground.
function spider(B: Builder): Anchors {
  B.box(R.BODY, -0.14, 0.14, -0.04, 0.28, 0.18, 0.26);
  B.box(R.BODY, -0.2, 0.16, -0.42, 0.4, 0.3, 0.4);
  B.box(R.BODY2, -0.07, 0.46, -0.32, 0.14, 0.012, 0.2, { lod: 1 });
  const l = 0.26;
  const up = 0.55;
  [0.18, 0.1, 0.02, -0.06].forEach((z, n) => {
    for (const side of [1, -1]) {
      const p: V3 = [side * 0.14, 0.24, z];
      const anim = (n % 2 === 0) === side > 0 ? A.SIDE_A : A.SIDE_B;
      B.box(R.DARK, side > 0 ? p[0] : p[0] - l, 0.225, z - 0.015, l, 0.03, 0.03, { p, anim, rot: [0, 0, side * up], q: p });
      const kx = p[0] + side * l * Math.cos(up);
      const ky = 0.24 + l * Math.sin(up);
      B.box(R.DARK, kx - 0.015, 0, z - 0.015, 0.03, ky, 0.03, { p, anim });
    }
  });
  const none = { p: ZERO, anim: A.NONE, seg: 0 };
  return {
    head: { ...none, cx: 0, bottom: 0.14, top: 0.32, front: 0.22, back: -0.04, half: 0.14 },
    face: { ...none, cx: 0, y: 0.27, z: 0.22, half: 0.14, eyes: 4, scale: 0.8 },
    torso: { x0: -0.2, y0: 0.16, z0: -0.42, w: 0.4, h: 0.3, d: 0.4 },
    back: { ...none, y: 0.46, z: -0.22, half: 0.2 },
    rear: { p: [0, 0.3, -0.42], anim: A.TAIL, seg: 0, y: 0.3, z: -0.42 },
    hand: { ...none, x: 0, y: 0.16, z: 0.26 },
    hand2: { ...none, x: 0.21, y: 0.3, z: -0.2 },
    has: [],
  };
}

function slime(B: Builder): Anchors {
  const sq = { p: ZERO, anim: A.SQUASH, seg: 0 };
  B.box(R.BODY, -0.38, 0, -0.38, 0.76, 0.55, 0.76, sq);
  B.box(R.BODY, -0.24, 0.55, -0.24, 0.48, 0.11, 0.44, sq);
  B.box(R.BODY2, 0.12, 0.4, 0.375, 0.14, 0.1, 0.02, { ...sq, lod: 1 });
  B.box(R.BODY2, 0.2, 0.555, -0.1, 0.1, 0.02, 0.14, { ...sq, lod: 1 });
  return {
    head: { ...sq, cx: 0, bottom: 0.2, top: 0.55, front: 0.38, back: -0.38, half: 0.3 },
    face: { ...sq, cx: -0.04, y: 0.34, z: 0.38, half: 0.3, eyes: 2, scale: 1 },
    torso: { x0: -0.38, y0: 0, z0: -0.38, w: 0.76, h: 0.55, d: 0.76 },
    back: { ...sq, y: 0.55, z: 0, half: 0.38 },
    rear: { p: [0, 0.2, -0.38], anim: A.TAIL, seg: 0, y: 0.2, z: -0.38 },
    hand: { ...sq, x: 0.3, y: 0.66, z: 0 },
    hand2: { ...sq, x: 0.39, y: 0.25, z: 0 },
    has: [],
  };
}

function spirit(B: Builder): Anchors {
  B.box(R.BODY, -0.24, 0.5, -0.18, 0.48, 0.45, 0.36);
  const sway: V3 = [0, 0.5, 0];
  B.box(R.BODY, -0.18, 0.25, -0.14, 0.36, 0.27, 0.28, { p: sway, anim: A.TAIL });
  B.box(R.BODY2, -0.1, 0.03, -0.1, 0.2, 0.24, 0.2, { p: sway, anim: A.TAIL, seg: 1 });
  const head: Attach = { p: [0, 0.95, 0], anim: A.HEAD, seg: 0 };
  B.box(R.BODY, -0.2, 0.95, -0.2, 0.4, 0.35, 0.4, head);
  for (const side of [1, -1]) {
    const p: V3 = [side * 0.29, 0.88, 0];
    B.c(R.BODY2, p[0], 0.56, 0, 0.1, 0.3, 0.12, { p, anim: side > 0 ? A.ARM_B : A.ARM_A, lod: 1 });
  }
  for (let k = 0; k < 3; k++) B.c(R.BODY2, 0.55, 0.62 + k * 0.12, 0, 0.08, 0.08, 0.08, { p: [0, 0.7, 0], anim: A.ORBIT, seg: k, glow: true, lod: 1 });
  return {
    head: { ...head, cx: 0, bottom: 0.95, top: 1.3, front: 0.2, back: -0.2, half: 0.2 },
    face: { ...head, cx: 0, y: 1.14, z: 0.2, half: 0.2, eyes: 2, scale: 1.1 },
    torso: { x0: -0.24, y0: 0.5, z0: -0.18, w: 0.48, h: 0.45, d: 0.36 },
    back: { p: ZERO, anim: A.NONE, seg: 0, y: 0.9, z: -0.18, half: 0.24 },
    rear: { p: sway, anim: A.TAIL, seg: 0, y: 0.35, z: -0.14 },
    hand: { p: [0.29, 0.88, 0], anim: A.ARM_B, seg: 0, x: 0.29, y: 0.55, z: 0.05 },
    hand2: { p: [-0.29, 0.88, 0], anim: A.ARM_A, seg: 0, x: -0.29, y: 0.55, z: 0.05 },
    has: [],
  };
}

function golem(B: Builder): Anchors {
  for (const side of [1, -1]) {
    const p: V3 = [side * 0.2, 0.42, 0];
    B.c(R.BODY, p[0], 0, 0, 0.28, 0.46, 0.3, { p, anim: side > 0 ? A.LEG_A : A.LEG_B });
  }
  B.box(R.BODY, -0.45, 0.42, -0.26, 0.9, 0.7, 0.52);
  B.box(R.DARK, 0.18, 0.58, 0.255, 0.16, 0.1, 0.02, { lod: 1 });
  B.box(R.DARK, -0.36, 0.9, 0.255, 0.12, 0.08, 0.02, { lod: 1 });
  B.c(R.GLOW, 0, 0.74, 0.27, 0.18, 0.18, 0.03, { glow: true, lod: 1 });
  const hand = (side: number) => {
    const x = side * 0.6;
    const p: V3 = [x, 1.02, 0];
    const anim = side > 0 ? A.ARM_B : A.ARM_A;
    B.c(R.BODY, x, 0.32, 0, 0.26, 0.74, 0.28, { p, anim });
    B.c(R.DARK, x, 0.16, 0, 0.3, 0.2, 0.32, { p, anim });
    return { p, anim, seg: 0, x, y: 0.2, z: 0.1 };
  };
  const h1 = hand(1);
  const h2 = hand(-1);
  const head: Attach = { p: [0, 1.12, 0], anim: A.HEAD, seg: 0 };
  B.box(R.BODY, -0.17, 1.12, -0.12, 0.34, 0.28, 0.34, head);
  return {
    head: { ...head, cx: 0, bottom: 1.12, top: 1.4, front: 0.22, back: -0.12, half: 0.17 },
    face: { ...head, cx: 0, y: 1.27, z: 0.22, half: 0.17, eyes: 2, scale: 1.2 },
    torso: { x0: -0.45, y0: 0.42, z0: -0.26, w: 0.9, h: 0.7, d: 0.52 },
    back: { p: ZERO, anim: A.NONE, seg: 0, y: 1.08, z: -0.26, half: 0.45 },
    rear: { p: [0, 0.55, -0.26], anim: A.TAIL, seg: 0, y: 0.55, z: -0.26 },
    hand: h1,
    hand2: h2,
    has: [],
  };
}

function dragon(B: Builder): Anchors {
  const Lg = 0.38;
  B.box(R.BODY, -0.26, Lg, -0.5, 0.52, 0.4, 1.0);
  B.c(R.BODY2, 0, Lg + 0.04, 0.5, 0.3, 0.28, 0.03, { lod: 1 });
  for (const fx of [1, -1])
    for (const fz of [1, -1]) {
      const cx = fx * 0.17;
      const cz = fz * 0.36;
      const p: V3 = [cx, Lg + 0.03, cz];
      const anim = fx > 0 === fz > 0 ? A.LEG_A : A.LEG_B;
      B.c(R.BODY, cx, 0, cz, 0.16, Lg + 0.06, 0.16, { p, anim });
      B.c(R.DARK, cx, 0, cz + 0.03, 0.18, 0.06, 0.2, { p, anim, lod: 1 });
    }
  const head: Attach = { p: [0, 0.7, 0.45], anim: A.HEAD, seg: 0 };
  B.box(R.BODY, -0.1, 0.62, 0.4, 0.2, 0.36, 0.22, head);
  B.box(R.BODY, -0.09, 0.9, 0.55, 0.18, 0.26, 0.18, head);
  B.box(R.BODY, -0.14, 1.08, 0.62, 0.28, 0.24, 0.28, head);
  B.box(R.BODY, -0.1, 1.08, 0.89, 0.2, 0.14, 0.19, head);
  for (const side of [1, -1]) {
    const q: V3 = [side * 0.09, 1.31, 0.66];
    B.box(R.FIXED, q[0] - 0.03, 1.31, 0.63, 0.06, 0.2, 0.06, { ...head, color: BONE, rot: [-0.7, 0, -side * 0.25], q });
  }
  for (const side of [1, -1]) {
    const p: V3 = [side * 0.26, 0.76, 0.05];
    const anim = side > 0 ? A.WING_L : A.WING_R;
    B.box(R.BODY2, side > 0 ? 0.25 : -0.97, 0.74, -0.26, 0.72, 0.04, 0.52, { p, anim });
    B.box(R.DARK, side > 0 ? 0.25 : -0.97, 0.76, 0.24, 0.72, 0.05, 0.05, { p, anim, lod: 1 });
  }
  const tail = (i: number): Attach => ({ p: [0, 0.62, -0.5 - (i - 0.5) * 0.3], anim: A.SEG, seg: i * 1.6 });
  for (let i = 1; i <= 3; i++) {
    const k = 1 - (i - 1) * 0.25;
    B.c(R.BODY, 0, 0.62 - i * 0.05, tail(i).p[2], 0.24 * k, 0.18 * k, 0.34, tail(i));
  }
  for (const z of [-0.3, 0, 0.3]) B.c(R.DARK, 0, Lg + 0.4, z, 0.06, 0.08, 0.1, { lod: 1 });
  return {
    head: { ...head, cx: 0, bottom: 1.08, top: 1.32, front: 0.9, back: 0.62, half: 0.14 },
    face: { ...head, cx: 0, y: 1.25, z: 0.9, half: 0.14, eyes: 2, scale: 1 },
    torso: { x0: -0.26, y0: Lg, z0: -0.5, w: 0.52, h: 0.4, d: 1.0 },
    back: { p: ZERO, anim: A.NONE, seg: 0, y: 0.78, z: 0, half: 0.26 },
    rear: { ...tail(3), y: 0.45, z: -1.4 },
    hand: { ...head, x: 0, y: 1.06, z: 1.1 },
    hand2: { p: ZERO, anim: A.NONE, seg: 0, x: 0.27, y: 0.55, z: 0 },
    has: ["wings", "tail", "horns"],
  };
}

function treeFolk(B: Builder): Anchors {
  for (const side of [1, -1]) {
    const p: V3 = [side * 0.14, 0.5, 0];
    B.c(R.BODY, p[0], 0, 0, 0.2, 0.54, 0.22, { p, anim: side > 0 ? A.LEG_A : A.LEG_B });
  }
  B.box(R.BODY, -0.24, 0.5, -0.18, 0.48, 0.85, 0.36);
  B.box(R.DARK, -0.12, 0.6, 0.175, 0.04, 0.4, 0.02, { lod: 1 });
  B.box(R.DARK, 0.1, 0.75, 0.175, 0.04, 0.3, 0.02, { lod: 1 });
  const branch = (side: number) => {
    const p: V3 = [side * 0.24, 1.18, 0];
    const anim = side > 0 ? A.ARM_B : A.ARM_A;
    const up = 0.7;
    B.box(R.BODY, side > 0 ? p[0] : p[0] - 0.5, 1.13, -0.05, 0.5, 0.1, 0.1, { p, anim, rot: [0, 0, side * up], q: p });
    const tx = p[0] + side * 0.5 * Math.cos(up);
    const ty = 1.18 + 0.5 * Math.sin(up);
    B.c(R.BODY2, tx, ty - 0.08, 0, 0.18, 0.16, 0.18, { p, anim, lod: 1 });
    return { p, anim, seg: 0, x: tx, y: ty - 0.12, z: 0.06 };
  };
  const hand = branch(1);
  const hand2 = branch(-1);
  const crown: Attach = { p: [0, 1.35, 0], anim: A.HEAD, seg: 0 };
  B.box(R.BODY2, -0.42, 1.35, -0.36, 0.84, 0.5, 0.72, crown);
  B.box(R.BODY2, -0.26, 1.85, -0.22, 0.52, 0.2, 0.44, crown);
  return {
    head: { ...crown, cx: 0, bottom: 1.85, top: 2.05, front: 0.22, back: -0.22, half: 0.26 },
    face: { p: ZERO, anim: A.NONE, seg: 0, cx: 0, y: 1.12, z: 0.18, half: 0.24, eyes: 2, scale: 0.9 },
    torso: { x0: -0.24, y0: 0.5, z0: -0.18, w: 0.48, h: 0.85, d: 0.36 },
    back: { p: ZERO, anim: A.NONE, seg: 0, y: 1.3, z: -0.18, half: 0.24 },
    rear: { p: [0, 0.7, -0.18], anim: A.TAIL, seg: 0, y: 0.7, z: -0.18 },
    hand,
    hand2,
    has: [],
  };
}

const PLAN_BUILDERS: Record<string, (B: Builder, build: Build, villager: Look | null) => Anchors> = {
  "two legs": twoLegs,
  "four legs": fourLegs,
  bird,
  fish,
  serpent,
  insect,
  spider,
  slime,
  spirit,
  golem,
  dragon,
  "tree folk": treeFolk,
};

function eyes(B: Builder, a: Anchors, glow: boolean): void {
  const f = a.face;
  const e = Math.max(0.035, f.half * 0.28) * f.scale;
  const rows = f.eyes === 4 ? [0, 1] : [0];
  for (const row of rows)
    for (const side of [1, -1]) {
      const x = f.cx + side * f.half * (row ? 0.25 : 0.45);
      const y = f.y - row * e * 1.5;
      B.box(glow ? R.GLOW : R.EYE, x - e / 2, y - e / 2, f.z - 0.005, e, e, 0.03, { ...at(f), glow, lod: glow ? 0 : 1 });
    }
}

// Items stand in the hand, tilted forward; sizes are a person's.
function item(B: Builder, a: Anchors, name: Feature, k: number): void {
  const h = name === "shield" ? a.hand2 : a.hand;
  // Held in front of the hand and a little outside it, so the arm does not hide it.
  const out = name === "shield" || h.x === 0 ? 0 : Math.sign(h.x) * 0.05 * k;
  const q: V3 = [h.x + out, h.y, h.z + (name === "shield" ? 0 : 0.1 * k)];
  const tilt: Record<string, number> = { sword: 1.0, axe: 0.45, spear: 0.2, staff: 0.1, torch: 0.5, hammer: 0.45, hoe: 0.3, rod: 1.15 };
  const o = (extra: Opt = {}): Opt => ({ ...at(h), q, rot: [tilt[name] ?? 0, 0, 0], ...extra });
  const bx = (role: number, x: number, y: number, z: number, w: number, hh: number, d: number, extra: Opt = {}) =>
    B.box(role, q[0] + (x - w / 2) * k, q[1] + y * k, q[2] + (z - d / 2) * k, w * k, hh * k, d * k, o(extra));
  const wood = { color: WOOD };
  const steel = { color: STEEL };
  switch (name) {
    case "sword":
      bx(R.FIXED, 0, -0.08, 0, 0.06, 0.12, 0.06, wood);
      bx(R.FIXED, 0, 0.04, 0, 0.22, 0.05, 0.08, steel);
      bx(R.FIXED, 0, 0.09, 0, 0.09, 0.5, 0.05, steel);
      break;
    case "axe":
      bx(R.FIXED, 0, -0.12, 0, 0.06, 0.62, 0.06, wood);
      bx(R.FIXED, 0, 0.32, 0.1, 0.05, 0.2, 0.2, steel);
      break;
    case "spear":
      bx(R.FIXED, 0, -0.35, 0, 0.055, 1.05, 0.055, wood);
      bx(R.FIXED, 0, 0.7, 0, 0.09, 0.2, 0.09, steel);
      break;
    case "staff":
      bx(R.FIXED, 0, -0.5, 0, 0.07, 1.05, 0.07, wood);
      bx(R.GLOW, 0, 0.55, 0, 0.15, 0.15, 0.15, { glow: true });
      break;
    case "torch":
      bx(R.FIXED, 0, -0.08, 0, 0.06, 0.36, 0.06, wood);
      bx(R.FIXED, 0, 0.27, 0, 0.13, 0.14, 0.13, { color: 0xffa43a, glow: true });
      bx(R.FIXED, 0, 0.4, 0, 0.08, 0.08, 0.08, { color: 0xffe08a, glow: true, lod: 1 });
      break;
    case "hammer":
      bx(R.FIXED, 0, -0.08, 0, 0.06, 0.5, 0.06, wood);
      bx(R.FIXED, 0, 0.38, 0, 0.14, 0.14, 0.26, { color: 0x6a6a72 });
      break;
    case "hoe":
      bx(R.FIXED, 0, -0.35, 0, 0.055, 0.95, 0.055, wood);
      bx(R.FIXED, 0, 0.56, 0.08, 0.14, 0.05, 0.2, steel);
      break;
    case "rod":
      bx(R.FIXED, 0, -0.1, 0, 0.045, 0.9, 0.045, wood);
      bx(R.FIXED, 0, 0.78, 0, 0.03, 0.03, 0.03, { color: 0xeeeeee, lod: 1 });
      break;
    case "shield":
      B.box(R.HAT, q[0] + (h.x >= 0 ? 0.01 : -0.08) * k, q[1] + 0.02 * k, q[2] - 0.2 * k, 0.07 * k, 0.42 * k, 0.4 * k, at(h));
      B.box(R.FIXED, q[0] + (h.x >= 0 ? 0.075 : -0.11) * k, q[1] + 0.17 * k, q[2] - 0.06 * k, 0.035 * k, 0.12 * k, 0.12 * k, { ...at(h), color: GOLD, lod: 1 });
      break;
    case "lantern":
      bx(R.FIXED, 0, -0.2, 0.04, 0.16, 0.18, 0.16, { color: 0x3a3a3a });
      bx(R.FIXED, 0, -0.18, 0.04, 0.17, 0.11, 0.11, { color: 0xffd36a, glow: true });
      break;
    case "book":
      bx(R.FIXED, 0, -0.04, 0.1, 0.22, 0.26, 0.08, { color: 0x7a2f2f });
      bx(R.FIXED, 0, -0.03, 0.1, 0.2, 0.24, 0.085, { color: 0xf0e6d0, lod: 1 });
      break;
    case "basket":
      bx(R.FIXED, 0, -0.14, 0.08, 0.26, 0.18, 0.24, { color: 0xc8a060 });
      bx(R.FIXED, 0, 0.04, 0.08, 0.16, 0.04, 0.14, { color: 0xd64545, lod: 1 });
      break;
  }
}

function feature(B: Builder, a: Anchors, f: Feature, k: number): void {
  if (a.has.includes(f)) return;
  if (isItem(f)) return item(B, a, f, k);
  const h = a.head;
  const hw = h.half;
  const cz = (h.front + h.back) / 2;
  const hk = hw / 0.21;
  switch (f) {
    case "horns":
      for (const side of [1, -1]) {
        const q: V3 = [h.cx + side * hw * 0.6, h.top - 0.02, cz];
        B.box(R.FIXED, q[0] - 0.045 * hk, q[1], q[2] - 0.045 * hk, 0.09 * hk, 0.28 * hk, 0.09 * hk, { ...at(h), color: BONE, rot: [-0.2, 0, -side * 0.45], q });
      }
      break;
    case "horn": {
      const q: V3 = [h.cx, h.top - 0.02, h.front - hw * 0.5];
      B.box(R.FIXED, q[0] - 0.04 * hk, q[1], q[2] - 0.04 * hk, 0.08 * hk, 0.4 * hk, 0.08 * hk, { ...at(h), color: 0xf3ead2, rot: [0.6, 0, 0], q });
      break;
    }
    case "antlers":
      for (const side of [1, -1]) {
        const q: V3 = [h.cx + side * hw * 0.55, h.top - 0.02, cz];
        const len = 0.42 * hk;
        const ang = side * 0.45;
        const o = (lod = 0) => ({ ...at(h), color: 0x8a6a45, rot: [-0.15, 0, -ang] as V3, q, lod });
        B.box(R.FIXED, q[0] - 0.025 * hk, q[1], q[2] - 0.025 * hk, 0.05 * hk, len, 0.05 * hk, o());
        for (const t of [0.45, 0.8]) {
          const tq: V3 = [q[0] + Math.sin(ang) * len * t, q[1] + Math.cos(ang) * len * t, q[2]];
          B.box(R.FIXED, tq[0] - 0.02 * hk, tq[1], tq[2] - 0.02 * hk, 0.04 * hk, 0.2 * hk, 0.04 * hk, {
            ...at(h),
            color: 0x8a6a45,
            rot: [0.5, 0, side * 0.5],
            q: tq,
            lod: 1,
          });
        }
      }
      break;
    case "wings": {
      const bk = a.back;
      const span = Math.max(0.35, bk.half * 2.4);
      const depth = Math.max(0.22, span * 0.55);
      for (const side of [1, -1]) {
        const p: V3 = [side * bk.half, bk.y, bk.z];
        const anim = side > 0 ? A.WING_L : A.WING_R;
        B.box(R.BODY2, side > 0 ? bk.half - 0.01 : -bk.half - span + 0.01, bk.y - 0.02, bk.z - depth * 0.6, span, 0.04, depth, { p, anim, seg: bk.seg });
        B.box(R.DARK, side > 0 ? bk.half - 0.01 : -bk.half - span + 0.01, bk.y, bk.z + depth * 0.4 - 0.04, span, 0.045, 0.045, { p, anim, lod: 1 });
      }
      break;
    }
    case "tail": {
      const r = a.rear;
      const q: V3 = [0, r.y, r.z];
      B.box(R.BODY, -0.04, r.y - 0.04, r.z - 0.42, 0.08, 0.08, 0.44, { p: r.p, anim: r.anim, seg: r.seg, rot: [-0.5, 0, 0], q });
      break;
    }
    case "mane":
      B.box(
        R.BODY2,
        h.cx - hw - 0.04,
        h.bottom - 0.16 * hk,
        h.back - 0.08,
        hw * 2 + 0.08,
        h.top - h.bottom + 0.2 * hk,
        (h.front - h.back) * 0.55 + 0.08,
        at(h),
      );
      break;
    case "hat":
      B.box(R.HAT, h.cx - hw * 1.55, h.top, cz - hw * 1.55, hw * 3.1, 0.04, hw * 3.1, at(h));
      B.box(R.HAT, h.cx - hw * 0.9, h.top + 0.04, cz - hw * 0.9, hw * 1.8, 0.2 * hk, hw * 1.8, at(h));
      B.box(R.HAT, h.cx - hw * 0.5, h.top + 0.04 + 0.18 * hk, cz - hw * 0.5, hw, 0.2 * hk, hw, {
        ...at(h),
        rot: [-0.35, 0, 0],
        q: [h.cx, h.top + 0.04 + 0.18 * hk, cz],
      });
      break;
    case "straw hat":
      B.box(R.FIXED, h.cx - hw * 1.7, h.top - 0.01, cz - hw * 1.7, hw * 3.4, 0.035, hw * 3.4, { ...at(h), color: 0xe0c060 });
      B.box(R.FIXED, h.cx - hw * 0.8, h.top + 0.02, cz - hw * 0.8, hw * 1.6, 0.09, hw * 1.6, { ...at(h), color: 0xd4b050 });
      break;
    case "cap":
      B.box(R.HAT, h.cx - hw - 0.02, h.top - 0.06, h.back - 0.02, hw * 2 + 0.04, 0.12, h.front - h.back + 0.04, at(h));
      B.box(R.HAT, h.cx - hw * 0.8, h.top - 0.05, h.front, hw * 1.6, 0.03, 0.12, at(h));
      break;
    case "hood": {
      B.box(R.CLOTH, h.cx - hw - 0.04, h.bottom - 0.02, h.back - 0.05, hw * 2 + 0.08, h.top - h.bottom + 0.08, h.front - h.back - 0.01, at(h));
      const t = a.torso;
      B.box(R.CLOTH, t.x0 - 0.03, Math.max(0.02, t.y0 - t.h * 0.6), t.z0 - 0.05, t.w + 0.06, t.h + t.h * 0.6, 0.04);
      break;
    }
    case "crown":
      B.box(R.FIXED, h.cx - hw - 0.03, h.top - 0.04, h.back - 0.03, hw * 2 + 0.06, 0.1, h.front - h.back + 0.06, { ...at(h), color: GOLD });
      for (const [sx, sz] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ])
        B.c(R.FIXED, h.cx + sx * hw, h.top + 0.06, cz + sz * (h.front - h.back) * 0.5, 0.06, 0.07, 0.06, { ...at(h), color: GOLD, lod: 1 });
      B.c(R.FIXED, h.cx, h.top, h.front + 0.03, 0.05, 0.05, 0.02, { ...at(h), color: 0xd0302a, lod: 1 });
      break;
    case "glowing eyes":
      break;
    case "armor": {
      const t = a.torso;
      B.box(R.FIXED, t.x0 - 0.035, t.y0 + t.h * 0.3, t.z0 - 0.035, t.w + 0.07, t.h * 0.7 + 0.02, t.d + 0.07, { color: STEEL });
      B.box(
        R.FIXED,
        h.cx - hw - 0.03,
        h.bottom + (h.top - h.bottom) * 0.62,
        h.back - 0.03,
        hw * 2 + 0.06,
        (h.top - h.bottom) * 0.38 + 0.04,
        h.front - h.back + 0.05,
        {
          ...at(h),
          color: 0x9aa4ae,
        },
      );
      break;
    }
    case "apron": {
      const t = a.torso;
      B.box(R.FIXED, t.x0 + t.w * 0.12, t.y0 - 0.12, t.z0 + t.d + 0.005, t.w * 0.76, t.h * 0.85, 0.025, { color: 0x4a3a2a });
      break;
    }
    case "beard":
      B.box(R.HAIR, h.cx - hw * 0.65, h.bottom - 0.1, h.front - 0.06, hw * 1.3, (h.top - h.bottom) * 0.42 + 0.1, 0.1, at(h));
      break;
    case "tusks": {
      const m = a.hand;
      for (const side of [1, -1])
        B.box(R.FIXED, m.x + side * 0.06 - 0.015, m.y, m.z - 0.04, 0.03, 0.09, 0.03, { ...at(m), color: 0xf0e8d0, rot: [0.3, 0, 0], q: [m.x, m.y, m.z] });
      break;
    }
  }
}

// A model Claude designed: scaled to about the footprint of the other plans
// (1.3 across, 1.7 tall at most), centered, standing on the ground. Pivots
// follow from what each box is.
function model(B: Builder, boxes: ModelBox[]): number {
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  for (const m of boxes) {
    x0 = Math.min(x0, m.x);
    y0 = Math.min(y0, m.y);
    z0 = Math.min(z0, m.z);
    x1 = Math.max(x1, m.x + m.w);
    y1 = Math.max(y1, m.y + m.h);
    z1 = Math.max(z1, m.z + m.d);
  }
  const k = Math.min(1.3 / Math.max(x1 - x0, z1 - z0, 1e-3), 1.7 / Math.max(y1 - y0, 1e-3));
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const T = (x: number, y: number, z: number): V3 => [(x - cx) * k, (y - y0) * k, (z - cz) * k];
  for (const m of boxes) {
    const [bx, by, bz] = T(m.x, m.y, m.z);
    const w = m.w * k;
    const h = m.h * k;
    const d = m.d * k;
    const mid: V3 = [bx + w / 2, by + h / 2, bz + d / 2];
    let p: V3 = ZERO;
    let anim: number = A.NONE;
    switch (m.part) {
      case "leg":
      case "leg2":
        p = [mid[0], by + h, mid[2]];
        anim = m.part === "leg" ? A.LEG_A : A.LEG_B;
        break;
      case "arm":
      case "arm2":
        p = [mid[0], by + h, mid[2]];
        anim = m.part === "arm" ? A.ARM_B : A.ARM_A;
        break;
      case "wing":
        // The edge nearest the middle is the shoulder; the side decides the beat.
        p = [Math.abs(bx) < Math.abs(bx + w) ? bx : bx + w, mid[1], mid[2]];
        anim = mid[0] >= 0 ? A.WING_L : A.WING_R;
        break;
      case "tail":
        p = [mid[0], mid[1], Math.abs(bz) < Math.abs(bz + d) ? bz : bz + d];
        anim = A.TAIL;
        break;
      case "head":
        p = [mid[0], by, mid[2]];
        anim = A.HEAD;
        break;
    }
    const glow = m.part === "glow";
    B.box(R.FIXED, bx, by, bz, w, h, d, { p, anim, glow, color: m.color });
  }
  return (y1 - y0) * k;
}

// Which variant of a kind a creature is, for the rig cache.
// Read every frame, so straight from the bits (villagers.ts): age, job, long hair.
export function variantOf(spec: BodySpec, look: number): number {
  if (spec.villager) return (look & 63) | (((look >> 15) & 1) << 6);
  return spec.vary?.length ? look & ((1 << spec.vary.length) - 1) : 0;
}

const JOB_FEATURES: Record<string, Feature[]> = {
  farmer: ["straw hat", "hoe"],
  woodcutter: ["axe"],
  fisher: ["cap", "rod"],
  smith: ["apron", "hammer"],
  guard: ["armor", "spear"],
  priest: ["hood", "book"],
  merchant: ["cap", "basket"],
  builder: ["cap", "hammer"],
};

export function buildRig(spec: BodySpec, look = 0): Rig {
  const B = new Builder();
  let height: number;
  let lean = 0;
  let halfWidth: number;
  if (spec.model?.length) {
    height = model(B, spec.model);
    halfWidth = Math.max(...B.parts.map((p) => Math.max(Math.abs(p.p[0] + p.q[0] + p.o[0]), Math.abs(p.p[0] + p.q[0] + p.o[0] + p.s[0]))));
  } else {
    const villager = spec.villager ? unpackLook(look) : null;
    const a = (PLAN_BUILDERS[spec.plan] ?? twoLegs)(B, spec.build, villager);
    const features = [...spec.features];
    (spec.vary ?? []).forEach((f, n) => {
      if (look & (1 << n) && !features.includes(f)) features.push(f);
    });
    if (villager) {
      features.push(...(JOB_FEATURES[villager.job] ?? []));
      if (villager.age === "elder") {
        lean = 0.16;
        if (!villager.long) features.push("beard");
        if (!features.some(isItem)) features.push("staff");
      }
    }
    const glowEyes = features.includes("glowing eyes") || spec.plan === "spirit" || spec.plan === "golem";
    eyes(B, a, glowEyes);
    const size = Math.max(0.4, Math.min(1.25, (a.head.top + 0.1) / 1.55));
    for (const f of features) feature(B, a, f, size);
    // The arm with an item (and the one with a shield) holds it steady.
    for (const [h, has] of [
      [a.hand, features.some((f) => isItem(f) && f !== "shield")],
      [a.hand2, features.includes("shield")],
    ] as const)
      if (has && (h.anim === A.ARM_A || h.anim === A.ARM_B)) for (const part of B.parts) if (part.p === h.p && part.anim === h.anim) part.anim = A.HOLD;
    height = a.head.top;
    halfWidth = a.torso.w / 2;
    for (const f of features) if (f === "hat" || f === "antlers" || f === "horn" || f === "horns" || f === "crown") height = a.head.top + 0.25;
  }
  const body2: Rig["body2"] =
    spec.plan === "tree folk"
      ? 0x4f9136
      : spec.plan === "bird" || spec.plan === "insect" || spec.plan === "serpent" || spec.plan === "dragon"
        ? "dark"
        : "light";
  const flapRate = spec.plan === "insect" ? 4.5 : spec.plan === "dragon" ? 0.9 : spec.plan === "bird" ? 2.6 : 1.6;
  const glowColor = spec.plan === "spirit" ? 0xffffff : 0xffe066;
  const rig: Rig = { parts: B.parts, height, halfWidth, lean, flapRate, body2, glowColor };
  // No two parts share a face (3.7): they would flicker.
  separate(rig);
  return rig;
}

// How big a creature is drawn (3.7), checked against a villager and a house.
// A villager is the measure: figures are drawn a little larger than the
// cells they stand on so one reads at a glance on a phone, and everything
// else is sized against it as in life, not from its radius in the
// simulation alone (a bear's radius is its reach: drawn from it, the bear
// stood half again as tall as a villager, and a spell's Vampire of radius 1.2
// twice as tall). A house is 0.8 of a villager: the island's houses are the
// stylized thing, a cell wide.
//
// Natural heights in villager heights, standing, to the top of the head, at a
// natural radius; a creature of another radius grows with its square root,
// people with its fourth root (a radius of 1.2 makes an imposing knight, not
// a giant: giants have the stout build), so a Giant Bear of radius 1.9 is
// half again a bear.
export const HOUSE_HEIGHT = 1.26;
interface Natural {
  height: number;
  radius: number;
  grow?: number;
  max?: number;
}
const SIZE_BY_BUILD = new Map<Build, Natural>([
  [BUILDS.deer, { height: 0.9, radius: 0.7 }],
  [BUILDS.rabbit, { height: 0.2, radius: 0.36 }],
  [BUILDS.wolf, { height: 0.5, radius: 0.62 }],
  [BUILDS.boar, { height: 0.45, radius: 0.62 }],
  [BUILDS.bear, { height: 0.72, radius: 0.95 }],
  [BUILDS.horse, { height: 1.05, radius: 0.75 }],
  [BUILDS.cat, { height: 0.38, radius: 0.55 }],
  [BUILDS.ox, { height: 0.85, radius: 0.8 }],
  [BUILDS.rat, { height: 0.15, radius: 0.4 }],
  [BUILDS.small, { height: 0.7, radius: 0.55, grow: 0.25, max: 1 }],
  [BUILDS.stout, { height: 1.3, radius: 0.7 }],
  [BUILDS.thin, { height: 1, radius: 0.55, grow: 0.25, max: 1.3 }],
  // 4.4.5.
  [BUILDS.camel, { height: 0.93, radius: 0.75 }],
  [BUILDS.fox, { height: 0.34, radius: 0.45 }],
  [BUILDS.hare, { height: 0.26, radius: 0.4 }],
  [BUILDS.frog, { height: 0.12, radius: 0.3 }],
  [BUILDS.lizard, { height: 0.1, radius: 0.34 }],
  [BUILDS.monkey, { height: 0.42, radius: 0.4 }],
  [BUILDS.wader, { height: 0.62, radius: 0.4 }],
]);
const SIZE_BY_PLAN: Record<Plan, Natural> = {
  "two legs": { height: 1, radius: 0.55, grow: 0.25, max: 1.3 },
  "four legs": { height: 0.7, radius: 0.75 },
  bird: { height: 0.22, radius: 0.34 },
  fish: { height: 0.15, radius: 0.34 },
  serpent: { height: 0.25, radius: 0.7 },
  insect: { height: 0.25, radius: 0.45 },
  spider: { height: 0.3, radius: 0.6 },
  slime: { height: 0.45, radius: 0.6 },
  spirit: { height: 0.9, radius: 0.6 },
  golem: { height: 1.45, radius: 1 },
  dragon: { height: 1.6, radius: 1.1 },
  "tree folk": { height: 1.4, radius: 0.8 },
};
// Nothing is drawn taller than this many villagers, whatever its radius (a
// spell may give one a radius of 6), nor smaller than the last.
export const MAX_HEIGHT = 3.2;
export const MIN_HEIGHT = 0.1;

let villagerHeight = 0;
// A grown villager's drawn height, in scene units.
export function villagerUnits(): number {
  if (!villagerHeight) villagerHeight = buildRig(body("two legs", [], { villager: true }), 0).height * 0.55 * 1.85;
  return villagerHeight;
}

// The natural size of a body, in villager heights, at a radius.
// A model Claude designs is a strange creature of no particular size: about
// a villager at the usual radius.
const MODEL_SIZE: Natural = { height: 0.9, radius: 0.6 };

export function naturalHeight(spec: BodySpec, radius: number): number | null {
  if (spec.villager) return null;
  const n = spec.model ? MODEL_SIZE : (SIZE_BY_BUILD.get(spec.build) ?? SIZE_BY_PLAN[spec.plan]);
  if (!n) return null;
  const h = n.height * Math.pow(Math.max(0.05, radius) / n.radius, n.grow ?? 0.5);
  return n.max && radius >= n.radius ? Math.min(n.max, h) : h;
}

// The scale a figure is drawn at, in scene units per figure unit. size is the
// creature's own (children 0.68). Villagers keep the size their radius gives:
// they are the measure.
export function drawScale(spec: BodySpec, radius: number, rig: Rig, size = 1): number {
  const V = villagerUnits();
  const natural = naturalHeight(spec, radius);
  let units = natural !== null ? (natural * V) / Math.max(0.05, rig.height) : radius * 1.85;
  const h = units * rig.height;
  if (h > MAX_HEIGHT * V) units *= (MAX_HEIGHT * V) / h;
  else if (h < MIN_HEIGHT * V) units *= (MIN_HEIGHT * V) / h;
  return units * size;
}

// Colors per role for one creature, written into out (length ROLES).
export function paletteOf(out: number[], rig: Rig, spec: BodySpec, color: number, look: number): number[] {
  const c2 = spec.color2 ?? (typeof rig.body2 === "number" ? rig.body2 : scaleColor(color, rig.body2 === "light" ? 1.3 : 0.72));
  out[R.BODY] = color;
  out[R.BODY2] = c2 === color ? scaleColor(color, 0.8) : c2;
  out[R.DARK] = scaleColor(color, 0.6);
  out[R.EYE] = 0x1a1414;
  out[R.GLOW] = spec.color2 ?? rig.glowColor;
  out[R.CLOTH] = spec.color2 ?? scaleColor(color, 0.55);
  if (spec.villager) {
    // The bits of villagers.ts packLook, without making an object per frame.
    const style = STYLES[((look >> 6) & 7) % STYLES.length];
    out[R.SKIN] = SKINS[((look >> 9) & 7) % SKINS.length];
    out[R.HAIR] = (look & 3) === 2 ? GRAY_HAIR : HAIRS[((look >> 12) & 7) % HAIRS.length];
    out[R.PANTS] = style.pants;
    out[R.HAT] = style.hat;
    out[R.CLOTH] = style.cloth;
  } else {
    out[R.SKIN] = scaleColor(color, 1.15);
    out[R.HAIR] = scaleColor(color, 0.5);
    out[R.PANTS] = scaleColor(color, 0.72);
    out[R.HAT] = spec.color2 ?? 0x2b2340;
  }
  return out;
}
