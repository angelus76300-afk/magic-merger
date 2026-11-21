// How a fence cell is drawn (21 November, the owner's soak: rails ran crosswise into fields, and
// lone posts stood with a rail to nowhere). A fence stands on a field's side, so its rail runs
// along that side; at a corner, or round a field gone, it follows the fence beside it. A post
// with no fence around it (its run broken by a road) is drawn as a post alone.
import { C, G } from "./materials";
import type { World } from "./world";

export type FenceKey = "fence-x" | "fence-z" | "fence-post";

export function fenceKey(world: World, i: number): FenceKey {
  const { w } = world;
  const x = i % w;
  const y = (i / w) | 0;
  const at = (dx: number, dy: number, test: (j: number) => boolean) => world.inside(x + dx, y + dy) && test((y + dy) * w + x + dx);
  const fence = (j: number) => world.cover[j] === C.FENCE;
  const field = (j: number) => world.ground[j] === G.FIELD;
  const fx = at(1, 0, fence) || at(-1, 0, fence);
  const fz = at(0, 1, fence) || at(0, -1, fence);
  if (!fx && !fz && !at(1, 1, fence) && !at(-1, 1, fence) && !at(1, -1, fence) && !at(-1, -1, fence)) return "fence-post";
  // A field to the north or south: the rail runs along x; to the east or west, along z.
  const ns = at(0, 1, field) || at(0, -1, field);
  const ew = at(1, 0, field) || at(-1, 0, field);
  if (ns && !ew) return "fence-x";
  if (ew && !ns) return "fence-z";
  if (fx !== fz) return fx ? "fence-x" : "fence-z";
  return "fence-x";
}

// A rail that points into a field: along x with a field east or west and none north or south,
// or along z the other way round. The soak's check (scripts/nature-run.ts).
export function railIntoField(world: World, i: number): boolean {
  const key = fenceKey(world, i);
  if (key === "fence-post") return false;
  const { w } = world;
  const x = i % w;
  const y = (i / w) | 0;
  const field = (dx: number, dy: number) => world.inside(x + dx, y + dy) && world.ground[(y + dy) * w + x + dx] === G.FIELD;
  const ns = field(0, 1) || field(0, -1);
  const ew = field(1, 0) || field(-1, 0);
  return key === "fence-x" ? ew && !ns : ns && !ew;
}
