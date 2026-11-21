// A cell's own fixed roll, and what water a cell holds: leaf helpers shared by ecology.ts
// (generation) and nature.ts (growth), kept here so neither imports the other's graph.
import { F } from "./materials";
import type { World } from "./world";

export function cellHash(i: number, seed: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(seed + 0x165667b1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

export const isSea = (world: World, i: number) =>
  world.fluid[i] === F.WATER && world.depth[i] > 0.05 && world.height[i] + world.depth[i] < world.seaLevel + 0.35;
export const isFresh = (world: World, i: number) => world.fluid[i] === F.WATER && world.depth[i] > 0.05 && !isSea(world, i);
