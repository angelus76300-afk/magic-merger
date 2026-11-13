import type { World } from "./world";
import { F, G, S } from "./materials";

// Small operations on one cell of the grid, shared by the land's rules
// (physics.ts) and the voxels' (voxels.ts). Kept apart so those two modules
// do not import each other.

// Adds gas to a cell; a thicker gas of another type keeps its place.
export function addGas(world: World, i: number, type: number, amount: number): void {
  if (world.gas[i] !== type && world.gasAmt[i] > amount) return;
  world.gas[i] = type;
  world.gasAmt[i] = Math.min(1, world.gasAmt[i] + amount);
}

// A fluid poured onto a cell that holds its opposite (4.12, world.reactions; physics.ts react
// is the same meeting where two fluids flow together): water on lava turns the lava to stone
// with a hiss of steam, lava on water does the same, lava on ice melts it. True when it handled
// the pour; otherwise the new fluid takes the cell as before.
export function fluidsMeet(world: World, i: number, was: number, poured: number, amount: number): boolean {
  if (!world.reactions || world.depth[i] <= 0.05) return false;
  const wet = (f: number) => f === F.WATER || f === F.MUD;
  if (was === F.LAVA && wet(poured)) {
    world.height[i] += world.depth[i] * 0.9;
    world.ground[i] = G.BASALT;
    world.setFluid(i, F.NONE, 0);
    world.temp[i] = Math.min(world.temp[i], 200);
    addGas(world, i, S.STEAM, 0.6);
    return true;
  }
  if (poured === F.LAVA && wet(was)) {
    world.height[i] += Math.min(amount, 1) * 0.6;
    world.ground[i] = G.BASALT;
    world.depth[i] = Math.max(0, world.depth[i] - amount * 0.5);
    if (world.depth[i] < 0.05) world.setFluid(i, F.NONE, 0);
    addGas(world, i, S.STEAM, 0.6);
    return true;
  }
  if (poured === F.LAVA && was === F.ICE) {
    world.fluid[i] = F.WATER;
    addGas(world, i, S.STEAM, 0.4);
    return true;
  }
  return false;
}
