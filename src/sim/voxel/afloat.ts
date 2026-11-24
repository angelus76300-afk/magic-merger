import type { World } from "../world";
import { GRAPHICS } from "./graphics";
import { columnTop, surfaceY, type Terrain } from "./terrain";
import { walkGround } from "./walk";

// What stands on the water, wades in it or floats on it, on the water as drawn (24 November). The
// water in eighths lies a little under the land beside it (Terrain.fineWaterLevel, 23 November), at
// least 0.19 under the cells' level (surfaceY) and up to 1.25 by a fall: walkers in the shallows,
// a dead fish and a dock's planks stood that far over it. Lilies and the shore's sparks took the
// level in eighths where the water was still drawn in whole cells, about 0.19 under it. Each reads
// the surface drawn under it now (Terrain.waterTopAt), in eighths or in whole cells. The view places
// them with these, and scripts/water-figures-test.ts measures them against the water's mesh.

// The ground a walker's feet are eased toward at (x, y) in cells, scene units: the fine land as
// drawn (Terrain.footAt), the water in eighths where it wades (Terrain.fineWaterAt), else the cells'
// own steps (walk.ts walkGround), as before. Not on a bridge's deck: its planks.
export function feetGround(terrain: Terrain, world: World, x: number, y: number): number {
  const fine = GRAPHICS.fine && GRAPHICS.steps;
  const land = fine ? terrain.footAt(x, y) : null;
  if (land !== null) return land;
  const cx = Math.max(0, Math.min(world.w - 1, Math.floor(x)));
  const cy = Math.max(0, Math.min(world.h - 1, Math.floor(y)));
  if (!world.onDeck(cy * world.w + cx)) {
    const water = terrain.fineWaterAt(x, y);
    if (!Number.isNaN(water)) return water;
  }
  return walkGround(world, x, y);
}

// Where a lily pad of cell i is put: just over the water drawn at the cell's middle.
export const LILY_OVER = 0.01;
export function lilyBase(terrain: Terrain, world: World, i: number): number {
  return waterOr(terrain, world, i, 0.5, 0.5) + LILY_OVER;
}

// Where a dock's model stands on cell i (flora.ts dock: its planks from DOCK_DECK over it, its posts
// down into the water): the planks' underside DOCK_SINK in the water drawn at the cell's middle. The
// water in eighths may lie under the cell's own top (its bed is drawn lower); a dock on a cell with
// no water stands on its top.
export const DOCK_DECK = 0.22;
export const DOCK_SINK = 0.02;
export function dockBase(terrain: Terrain, world: World, i: number): number {
  const x = i % world.w;
  const y = (i - x) / world.w;
  const water = terrain.waterTopAt(x + 0.5, y + 0.5);
  return (Number.isNaN(water) ? Math.max(columnTop(world, i), surfaceY(world, i)) : water) - DOCK_DECK - DOCK_SINK;
}

// Where a spark of the glowing shore is put, at (u, v) in cell i: just over the water there.
export const SPARK_OVER = 0.02;
export function sparkBase(terrain: Terrain, world: World, i: number, u: number, v: number): number {
  return waterOr(terrain, world, i, u, v) + SPARK_OVER;
}

// The water drawn at (u, v) in cell i, or the cell's level where it has none.
function waterOr(terrain: Terrain, world: World, i: number, u: number, v: number): number {
  const x = i % world.w;
  const y = (i - x) / world.w;
  const water = terrain.waterTopAt(x + u, y + v);
  return Number.isNaN(water) ? surfaceY(world, i) : water;
}
