// What generation made of a cell, worked out again later from the seed (21 November; nature.ts):
// the forest thresholds land.ts covers() uses, the snow line, the dirt patches and the chance of a
// tree. Generation rolled its own dice; these read the same noise, so they give the same land and
// the same shares, not the very same cells. A leaf module: land.ts and nature.ts both read it, and it imports neither.
import { F } from "./materials";
import { fbm } from "./noise";
import { BIOMES, type Biome, type LandOptions } from "./land-options";
import type { World } from "./world";

// The sea level generation builds to (land.ts SEA).
const SEA = 8;

// The forest noise above which a biome grows trees (land.ts covers()).
export const FOREST: Record<Biome, number> = { temperate: 0.56, desert: 0.6, tundra: 0.58, jungle: 0.42, swamp: 0.55, volcanic: 0.56, mesa: 0.62 };

// A cell's biome (as land.ts biomeAt).
export function biomeAt(world: World, i: number): Biome {
  return world.biomeMap ? BIOMES[world.biomeMap[i]] : (world.land?.biome ?? "temperate");
}

// The island's relief above the sea, as buildLand works it out from the land's options.
export function peakOf(land: LandOptions): number {
  const one = land.mixed ? null : land.biome;
  const reliefScale = (one === "swamp" ? 0.45 : one === "mesa" ? 1.15 : 1) * (land.shape === "archipelago" ? 0.65 : 1);
  return (12 + (land.relief ?? 0.5) * 24) * reliefScale;
}

// The height above which generation laid snow (Infinity where it never does: no land, or a
// biome with no snow). land.ts grounds().
export function snowLine(world: World, i: number): number {
  if (!world.land) return Infinity;
  const biome = biomeAt(world, i);
  if (biome === "desert" || biome === "mesa" || biome === "jungle") return Infinity;
  const peak = peakOf(world.land);
  return biome === "tundra" ? SEA + peak * 0.35 : SEA + peak * 0.82;
}

// Dirt that generation laid there itself: a patch of bare ground, not ground burnt or dug.
export function bareByNature(world: World, i: number): boolean {
  const biome = biomeAt(world, i);
  const x = i % world.w;
  const y = (i / world.w) | 0;
  const patch = fbm(x / 20, y / 20, world.seed + 5, 3);
  const at = biome === "mesa" ? 0.5 : biome === "swamp" ? 0.62 : biome === "desert" ? 0.66 : biome === "tundra" ? 0.72 : 0.7;
  if (patch <= at) return false;
  // Dry lands laid grass by the water and where the land is moist, whatever the patch.
  if (biome === "desert" || biome === "mesa") {
    const moist = fbm(x / 34, y / 34, world.seed + 77, 4);
    if (moist > (biome === "desert" ? 0.7 : 0.66)) return false;
    const r = biome === "desert" ? 4 : 3;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const j = (y + dy) * world.w + x + dx;
        if (Math.abs(dx) + Math.abs(dy) <= r && world.inside(x + dx, y + dy) && world.fluid[j] === F.WATER && world.depth[j] > 0) return false;
      }
  }
  return true;
}

// The chance generation gave a grass cell of being a tree (land.ts covers()).
export function treeChance(world: World, i: number): number {
  const biome = biomeAt(world, i);
  const x = i % world.w;
  const y = (i / world.w) | 0;
  let t = FOREST[biome] + (0.5 - (world.land?.forest ?? 0.5)) * 0.24;
  // Dry lands grow trees by the water.
  if (biome === "desert" || biome === "mesa") {
    let wet = false;
    for (let dy = -3; dy <= 3 && !wet; dy++)
      for (let dx = -3; dx <= 3 && !wet; dx++) {
        const j = (y + dy) * world.w + x + dx;
        if (world.inside(x + dx, y + dy) && world.fluid[j] === F.WATER && world.depth[j] > 0) wet = true;
      }
    if (wet) t -= 0.2;
  }
  const forest = fbm(x / 26, y / 26, world.seed + 13, 4);
  return forest > t ? Math.min(1, (forest - t + 0.06) * 2.2) : 0;
}
