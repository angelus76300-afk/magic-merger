import type { Tier } from "../../shared/tiers";
import type { CreatureKind } from "./creatures";

// Through its eyes (2026-11-12, a prototype on top of Become anything): the
// camera at the head of the creature the player is, looking where the player
// looks. Pure, so Node can test it (scripts/become-test.ts).
//
// The look is a yaw (radians, 0 along +x on the ground, as creatures.ts hd)
// and a pitch (radians, up is positive). One cell is one scene unit, across
// and up (voxel/fog.ts), so a ray on the ground and in height is one vector.

// How far a spell cast from the eyes reached before the second pass, in cells
// along the ground: still the reach of the smallest spells' neighbour.
export const CAST_RANGE = 14;
// The eye view, second pass (the owner, 12 November: "cast: aim and reach"):
// the reach grows with the item's tier, so a small spell lands near and a grand
// one at a village across a valley. Cells along the ground.
export const CAST_REACH: Record<Tier, number> = {
  cantrip: 16,
  minor: 22,
  major: 30,
  grand: 46,
  legendary: 60,
  cosmic: 76,
};
export function castRange(tier: Tier | undefined): number {
  return (tier && CAST_REACH[tier]) || CAST_RANGE;
}
// How far the look turns up and down: down to the feet, and up to about 30
// degrees (the island's trees and roofs were made to be seen from above, and
// straight up is not needed: the owner, 12 November).
export const PITCH_MIN = -1.35;
export const PITCH_MAX = 0.55;
// The aim held on the Cast button goes a little further either way: at the
// feet, and well above the horizon (a peak, a flier).
export const AIM_PITCH_MIN = -1.5;
export const AIM_PITCH_MAX = 0.85;
// The look a little down at first: the ground ahead reads, the horizon too.
export const PITCH_START = -0.14;

export interface Eye {
  // Where the eye is: on the ground in cells, and its height in scene units.
  x: number;
  y: number;
  h: number;
  yaw: number;
  pitch: number;
}

// The camera turn (orbit.ts theta) that looks along `yaw`: the camera's offset
// along the ground is (sin theta, cos theta) and it looks the other way. The
// stick (possess.ts stickDir) measured against it pushes forward along the
// look, and right of it to the right.
export function lookTheta(yaw: number): number {
  return Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
}

export function clampPitch(p: number): number {
  return Math.max(PITCH_MIN, Math.min(PITCH_MAX, p));
}

// The direction looked along: x, y on the ground and h up.
export function lookDir(yaw: number, pitch: number): { x: number; y: number; h: number } {
  const flat = Math.cos(pitch);
  return { x: Math.cos(yaw) * flat, y: Math.sin(yaw) * flat, h: Math.sin(pitch) };
}

// A creature the look may meet before the ground: where it stands (x, y on
// the ground, z its feet in scene units), how wide and how tall.
export interface Body {
  x: number;
  y: number;
  z: number;
  r: number;
  h: number;
}

// Where the mark in the middle of the view points on the ground, within
// `range` cells: the first point of the ray that is at or under the ground,
// or a creature it passes through first (`bodies`, then the cast lands where
// that creature stands). Past the range, or at the sky, the cast lands at the
// range's end along the look, on the ground below it (hit false). `w`, `h`:
// the island's size, which nothing leaves.
export function aimAt(
  eye: Eye,
  ground: (x: number, y: number) => number,
  w: number,
  h: number,
  range = CAST_RANGE,
  bodies: readonly Body[] = [],
): { x: number; y: number; hit: boolean; dist: number; body?: number } {
  const d = lookDir(eye.yaw, eye.pitch);
  const flat = Math.hypot(d.x, d.y);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  // A tenth of a cell near the eye, a quarter further out: as fine as the land is drawn at that distance.
  let land: { x: number; y: number; t: number } | null = null;
  for (let t = 0.1; flat * t <= range + 1e-9; t += flat * t < 12 ? 0.1 : 0.25) {
    const x = eye.x + d.x * t;
    const y = eye.y + d.y * t;
    if (!inside(x, y)) break;
    if (eye.h + d.h * t <= ground(x, y)) {
      land = { x, y, t };
      break;
    }
  }
  // A creature on the way: the nearest whose upright cylinder the ray enters before the land.
  let near = land ? land.t : flat > 1e-6 ? range / flat : Infinity;
  let hitBody = -1;
  bodies.forEach((b, n) => {
    if (flat < 1e-6) return;
    // Closest approach of the ray to the body's axis, on the ground.
    const ox = b.x - eye.x;
    const oy = b.y - eye.y;
    const t = (ox * d.x + oy * d.y) / (flat * flat);
    if (t <= 0.3 || t >= near) return;
    const miss = Math.hypot(eye.x + d.x * t - b.x, eye.y + d.y * t - b.y);
    if (miss > b.r) return;
    const at = eye.h + d.h * t;
    if (at < b.z - 0.2 || at > b.z + b.h + 0.2) return;
    near = t;
    hitBody = n;
  });
  if (hitBody >= 0) {
    const b = bodies[hitBody];
    return { x: b.x, y: b.y, hit: true, dist: Math.hypot(b.x - eye.x, b.y - eye.y), body: hitBody };
  }
  if (land) return { x: land.x, y: land.y, hit: true, dist: flat * land.t };
  // Along the look at the range's end, kept on the island.
  const x = Math.max(0.5, Math.min(w - 1.5, eye.x + Math.cos(eye.yaw) * range));
  const y = Math.max(0.5, Math.min(h - 1.5, eye.y + Math.sin(eye.yaw) * range));
  return { x, y, hit: false, dist: Math.hypot(x - eye.x, y - eye.y) };
}

// The look turned by a held aim (frame.ts, aim.ts): its own yaw and pitch
// moved by the drag, the pitch within the aim's wider range.
export function aimedEye(eye: Eye, dyaw: number, dpitch: number): Eye {
  return { ...eye, yaw: eye.yaw + dyaw, pitch: Math.max(AIM_PITCH_MIN, Math.min(AIM_PITCH_MAX, eye.pitch + dpitch)) };
}

// A cast from the eyes: where the mark points, then the same cast as a tap on
// the island (the frame's castAt, Engine.cast: troubles, cooldowns, the story).
// `seen`: whether the landing point is in view, where the ring shows it. No
// ring, no cast (the playtest of 12 November: aimed at the sky, Cast fired
// with nothing shown): the line says why instead. `range`: the item's reach
// (castRange of its tier).
export const NOTHING_TO_CAST_ON = "Nothing in reach to cast on";
export function castFromEyes(
  eye: Eye,
  ground: (x: number, y: number) => number,
  w: number,
  h: number,
  cast: (x: number, y: number) => boolean,
  seen: (x: number, y: number) => boolean = () => true,
  range = CAST_RANGE,
  bodies: readonly Body[] = [],
): { x: number; y: number; ok: boolean; why?: string } {
  const at = aimAt(eye, ground, w, h, range, bodies);
  if (!seen(at.x, at.y)) return { x: at.x, y: at.y, ok: false, why: NOTHING_TO_CAST_ON };
  return { x: at.x, y: at.y, ok: cast(at.x, at.y) };
}

// A flier's or a swimmer's climb from the look (drive.ts): level within about
// seven degrees, full climb at 0.5 up, full dive at 0.9 down.
export function climbOf(pitch: number): number {
  const level = 0.12;
  if (Math.abs(pitch) < level) return 0;
  return pitch > 0 ? Math.min(1, (pitch - level) / (0.5 - level)) : Math.max(-1, (pitch + level) / (0.9 - level));
}

// The way with the longest open line from (x, y) at eye height h, in sixteen
// directions up to `far` cells: open while the ground stays under the eye and
// no wall or trunk stands there (`solid`). The current look is kept when it
// is open for at least half of `far` (the playtest of 12 November: the first
// frame in the eyes was often all green, a bush or a cliff in its face).
export function openLook(
  x: number,
  y: number,
  h: number,
  yaw: number,
  ground: (x: number, y: number) => number,
  solid: (x: number, y: number) => boolean,
  far = 12,
): number {
  const free = (a: number) => {
    let d = 0;
    for (let t = 0.5; t <= far; t += 0.5) {
      const px = x + Math.cos(a) * t;
      const py = y + Math.sin(a) * t;
      if (ground(px, py) > h - 0.4 || solid(px, py)) break;
      d = t;
    }
    return d;
  };
  if (free(yaw) >= far / 2) return yaw;
  let best = yaw;
  let bestD = free(yaw);
  for (let k = 1; k < 16; k++) {
    const a = yaw + (k * Math.PI) / 8;
    const d = free(a);
    if (d > bestD + 1e-9) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

// The eye kept clear of what stands around it: at least `gap` from a wall or
// a trunk (`solid` cells, cell (cx, cy) drawn from cx to cx + 1 as the view
// draws the land) and from a step of ground higher than the eye.
// Pushed straight away from each, as a body is from a wall; then lifted above
// the ground under it. Returns where the eye goes.
export function clearEye(
  x: number,
  y: number,
  h: number,
  ground: (x: number, y: number) => number,
  solid: (cx: number, cy: number) => boolean,
  gap = 0.45,
): { x: number; y: number; h: number } {
  let ex = x;
  let ey = y;
  const cx0 = Math.floor(x);
  const cy0 = Math.floor(y);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const cx = cx0 + dx;
      const cy = cy0 + dy;
      if (!solid(cx, cy) && ground(cx + 0.5, cy + 0.5) <= h - 0.2) continue;
      // The nearest point of that cell to the eye, and the eye pushed back to `gap` from it.
      const nx = Math.max(cx, Math.min(cx + 1, ex));
      const ny = Math.max(cy, Math.min(cy + 1, ey));
      const d = Math.hypot(ex - nx, ey - ny);
      if (d >= gap) continue;
      if (d < 1e-6) continue;
      ex = nx + ((ex - nx) / d) * gap;
      ey = ny + ((ey - ny) / d) * gap;
    }
  return { x: ex, y: ey, h: Math.max(h, ground(ex, ey) + 0.3) };
}

// The view a creature starts in: its eyes for walkers; behind for flyers and
// swimmers, whose eye view is open air or under water.
export function eyesFirst(k: CreatureKind): boolean {
  return !k.flying && !k.aquatic;
}

// A tap on the island from behind the creature (the playtest of 12 November:
// the page said "Tap the island to cast" and the tap did nothing): the cast
// lands where the finger is, within the item's reach of the creature; further
// off, at the reach's end on the way there.
export function withinRange(fromX: number, fromY: number, x: number, y: number, range = CAST_RANGE): { x: number; y: number } {
  const d = Math.hypot(x - fromX, y - fromY);
  if (d <= range) return { x, y };
  return { x: fromX + ((x - fromX) / d) * range, y: fromY + ((y - fromY) / d) * range };
}
