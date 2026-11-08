import type { World } from "../world";
import { V, surfaceY } from "./terrain";

// Creatures walk up and down the island's steps instead of jumping from one
// level to the next (3.7). The land is columns of whole voxels, so the
// ground under a point jumps a voxel at a cell's edge. Two things smooth it,
// in the view only (the simulation's cells and its rule on what can be
// climbed are unchanged, creatures.ts):
//
// 1. Near an edge, within EDGE of a cell, the ground is blended toward the
//    next cell's, reaching the mean of the two right on the edge: a step of a
//    voxel is walked up over a little more than half a cell. A step taller
//    than STEP is a cliff and is not blended: a creature beside a cliff does
//    not climb its wall.
// 2. The height drawn follows that ground at a walking pace, and falls with
//    gravity when the ground drops away (off a cliff, a house that burned),
//    so nothing pops. A creature thrown or teleported far snaps to it.

const EDGE = 0.32;
// Scene units: one voxel and a little, what a creature walks up.
export const STEP = 1.05;
const RISE = 7;
const GRAVITY = 40;
const SNAP = 4;

const smooth = (t: number) => t * t * (3 - 2 * t);

function surface(world: World, x: number, y: number): number {
  const cx = Math.max(0, Math.min(world.w - 1, x));
  const cy = Math.max(0, Math.min(world.h - 1, y));
  const i = cy * world.w + cx;
  // On a bridge, its deck (4.9).
  return world.onDeck(i) ? Math.max(surfaceY(world, i), world.walkLevel(i) * V) : surfaceY(world, i);
}

// The ground under a point, in scene units, blended across walkable edges.
export function walkGround(world: World, x: number, y: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const fx = x - cx;
  const fy = y - cy;
  const h0 = surface(world, cx, cy);
  let h = h0;
  const blend = (nx: number, ny: number, t: number) => {
    if (t <= 0) return;
    const hn = surface(world, nx, ny);
    if (Math.abs(hn - h0) <= STEP) h += (hn - h0) * 0.5 * smooth(Math.min(1, t));
  };
  if (fx > 1 - EDGE) blend(cx + 1, cy, (fx - (1 - EDGE)) / EDGE);
  else if (fx < EDGE) blend(cx - 1, cy, (EDGE - fx) / EDGE);
  if (fy > 1 - EDGE) blend(cx, cy + 1, (fy - (1 - EDGE)) / EDGE);
  else if (fy < EDGE) blend(cx, cy - 1, (EDGE - fy) / EDGE);
  return h;
}

export interface Footing {
  // The ground drawn, its falling speed, and when it was last eased.
  gy: number;
  vy: number;
  gt: number;
}

// Eases the drawn ground toward the target: up at a walking pace, down with
// gravity, at once from far away. Returns the height to draw.
export function easeGround(f: Footing, target: number, time: number): number {
  const dt = Math.min(0.1, Math.max(0, time - f.gt));
  f.gt = time;
  if (!Number.isFinite(f.gy) || Math.abs(target - f.gy) > SNAP) {
    f.gy = target;
    f.vy = 0;
  } else if (target > f.gy) {
    f.gy = Math.min(target, f.gy + RISE * dt);
    f.vy = 0;
  } else if (target < f.gy) {
    f.vy += GRAVITY * dt;
    f.gy = Math.max(target, f.gy - f.vy * dt);
    if (f.gy === target) f.vy = 0;
  }
  return f.gy;
}
