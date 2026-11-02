import type { World } from "./world";

// Small operations on one cell of the grid, shared by the land's rules
// (physics.ts) and the voxels' (voxels.ts). Kept apart so those two modules
// do not import each other.

// Adds gas to a cell; a thicker gas of another type keeps its place.
export function addGas(world: World, i: number, type: number, amount: number): void {
  if (world.gas[i] !== type && world.gasAmt[i] > amount) return;
  world.gas[i] = type;
  world.gasAmt[i] = Math.min(1, world.gasAmt[i] + amount);
}
