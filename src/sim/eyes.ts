import type { CreatureKind } from "./creatures";

// Through its eyes (2026-11-12, a prototype on top of Become anything): the
// camera at the head of the creature the player is, looking where the player
// looks. Pure, so Node can test it (scripts/become-test.ts).
//
// The look is a yaw (radians, 0 along +x on the ground, as creatures.ts hd)
// and a pitch (radians, up is positive). One cell is one scene unit, across
// and up (voxel/fog.ts), so a ray on the ground and in height is one vector.

// How far a spell cast from the eyes reaches, in cells along the ground.
export const CAST_RANGE = 14;
// How far the look turns up and down.
export const PITCH_MIN = -1.1;
// Up to about 25 degrees: the island's trees and roofs were made to be seen
// from above, and straight up is not needed (the owner, 12 November).
export const PITCH_MAX = 0.45;
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

// Where the mark in the middle of the view points on the ground, within
// `range` cells: the first point of the ray that is at or under the ground.
// Past the range, or at the sky, the cast lands at the range's end straight
// ahead (hit false). `w`, `h`: the island's size, which nothing leaves.
export function aimAt(
  eye: Eye,
  ground: (x: number, y: number) => number,
  w: number,
  h: number,
  range = CAST_RANGE,
): { x: number; y: number; hit: boolean; dist: number } {
  const d = lookDir(eye.yaw, eye.pitch);
  const flat = Math.hypot(d.x, d.y);
  const step = 0.1;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  for (let t = step; flat * t <= range + 1e-9; t += step) {
    const x = eye.x + d.x * t;
    const y = eye.y + d.y * t;
    if (!inside(x, y)) break;
    if (eye.h + d.h * t <= ground(x, y)) return { x, y, hit: true, dist: flat * t };
  }
  // Straight ahead at the range's end, kept on the island.
  const x = Math.max(0.5, Math.min(w - 1.5, eye.x + Math.cos(eye.yaw) * range));
  const y = Math.max(0.5, Math.min(h - 1.5, eye.y + Math.sin(eye.yaw) * range));
  return { x, y, hit: false, dist: Math.hypot(x - eye.x, y - eye.y) };
}

// A cast from the eyes: where the mark points, then the same cast as a tap on
// the island (the frame's castAt, Engine.cast: troubles, cooldowns, the story).
// `seen`: whether the landing point is in view, where the ring shows it. No
// ring, no cast (the playtest of 12 November: aimed at the sky, Cast fired
// with nothing shown): the line says why instead.
export const NOTHING_TO_CAST_ON = "Nothing in reach to cast on";
export function castFromEyes(
  eye: Eye,
  ground: (x: number, y: number) => number,
  w: number,
  h: number,
  cast: (x: number, y: number) => boolean,
  seen: (x: number, y: number) => boolean = () => true,
): { x: number; y: number; ok: boolean; why?: string } {
  const at = aimAt(eye, ground, w, h);
  if (!seen(at.x, at.y)) return { x: at.x, y: at.y, ok: false, why: NOTHING_TO_CAST_ON };
  return { x: at.x, y: at.y, ok: cast(at.x, at.y) };
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
// lands where the finger is, within the same range of the creature; further
// off, at the range's end on the way there.
export function withinRange(fromX: number, fromY: number, x: number, y: number, range = CAST_RANGE): { x: number; y: number } {
  const d = Math.hypot(x - fromX, y - fromY);
  if (d <= range) return { x, y };
  return { x: fromX + ((x - fromX) / d) * range, y: fromY + ((y - fromY) / d) * range };
}
