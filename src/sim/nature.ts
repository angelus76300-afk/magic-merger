// Nature holds its shape (21 November, the owner: an island left running looked "just weird").
// A 60-minute soak on main found grass in flower going from 2-3% to 50-83% in every biome,
// desert and tundra too, bushes up five to seven times, trees about double, reeds standing
// far from any water, generated dirt and desert greening within five minutes, and pale
// squares of snow on high grass. Growth had births and no deaths, and its births went
// anywhere. The owner's rule since: nothing looks different just because time passed,
// unless the player or the world did something visible (a spell, a fire, a flood, a village
// growing).
//
// So each open grass cell has a niche: what generation would have grown on it, worked out
// again from the seed, the cell's biome, the trees around it and the water beside it
// (ecology.ts undergrowth and land.ts covers, the same order and the same shares, with a
// cell hash for generation's dice). Undergrowth spreads and sprouts only into its own
// niche, and what stands outside its niche wilts slowly: a plant a spell left, a flower an
// overgrown save holds, a reed whose water went. Trees seed only where the forest around
// is thinner than generation made it there, and thin out slowly where it is far thicker.
// Bare ground greens back only where generation laid grass, in the wet lands, slowly.
// Grass freezes to snow above the snow line generation used, or in a sudden cold (a spell's),
// never just because the air up there is cold.
//
// Every number of it is here.
import { C, F, G } from "./materials";
import { fbm, valueNoise } from "./noise";
import { cellHash, isFresh } from "./cellhash";
import { bareByNature, biomeAt, snowLine, treeChance } from "./genrules";
import type { World } from "./world";

export const NATURE = {
  // Per sample (each cell is sampled about 7 times a minute): undergrowth creeping from a
  // neighbour of its kind, springing up on its own, and wilting outside its niche.
  SPREAD: 0.03,
  SPROUT: 0.003,
  WILT: 0.002,
  // The scattered bushes of the open (generation rolled 2.5% and lost some under what came after).
  BUSHES: 0.018,
  // Of the sprouts in the dry and cold lands (desert, mesa, tundra), the share that happen.
  SPARSE: 0.1,
  // Bare dirt greening beside grass where generation laid grass (it was 0.5, everywhere).
  GREEN: 0.02,
  // Flowers within this many cells of a village (its homes stand up to 8 out, and its people plant
  // within 8 of home) are its gardens and offerings: they stay.
  GARDEN: 16,
  // A home's garden: villagers plant flowers within 8 cells of home while fewer than this stand there.
  GARDEN_BEDS: 12,
  // Dirt within this many cells of a house is a village's square or yard: it stays bare.
  YARD: 6,
  // Trees and stumps in the 5 by 5 around a cell, against generation's share there (nature.ts
  // stand): a tree seeds under it; one stands at least THIN_MIN and THIN_OVER above it, and thins.
  // Seeding stops at this share of it: every 5 by 5 filled to its expected count would end
  // thicker than generation made the forest as a whole (its boxes scatter round that count).
  SEED_BELOW: 0.7,
  THIN_MIN: 16,
  THIN_OVER: 8,
  THIN: 0.0005,
  // Grass freezes to snow in a cold this far under the cell's usual temperature (physics.ts keeps
  // it, a few seconds behind): a spell's sudden cold. The land's own air can sit 20 degrees under
  // its climate in a hollow among peaks, so the climate alone cannot tell (the dry island's
  // pale squares), but it changes slowly.
  SNOW_DROP: 8,
  // How fast the usual temperature follows the cell's own, per temperature step (15 a second).
  USUAL: 0.01,
  // Temperature steps an island settles first, made or loaded (three minutes): its usual
  // temperature is its own, so nothing is sudden.
  SETTLE: 2700,
} as const;

// The plants that wilt outside their niche. Fungi rings, logs and the rest stay as made.
const WILTS = new Set<number>([C.FLOWER, C.BUSH, C.BERRIES, C.FERN, C.REEDS]);

// Steps to fresh water (1 or 2, 0 beyond), across the four sides as ecology.ts counts them.
function freshNear(world: World, x: number, y: number, reach: number): number {
  let best = 0;
  for (let dy = -reach; dy <= reach; dy++)
    for (let dx = -reach; dx <= reach; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d === 0 || d > reach || (best && d >= best) || !world.inside(x + dx, y + dy)) continue;
      if (isFresh(world, (y + dy) * world.w + x + dx)) best = d;
    }
  return best;
}

// Trees (and stumps, trees to be) in the 5 by 5 around a cell.
function canopy(world: World, x: number, y: number): number {
  let n = 0;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      if (!world.inside(x + dx, y + dy)) continue;
      const c = world.cover[(y + dy) * world.w + x + dx];
      if (c === C.TREE || c === C.STUMP) n++;
    }
  return n;
}

// What grows on this cell when it is left to itself: generation's undergrowth, in its order.
export function niche(world: World, i: number): number {
  if (world.ground[i] !== G.GRASS || world.depth[i] > 0.02) return C.NONE;
  const x = i % world.w;
  const y = (i / world.w) | 0;
  const biome = biomeAt(world, i);
  const dry = biome === "desert" || biome === "mesa";
  const h = cellHash(i, world.seed + 4561);
  // Generation grew no undergrowth within 3 cells of a house or a field: a village keeps its ground.
  if (!homeNear(world, x, y, 3)) {
    const u = undergrowth(world, x, y, biome, dry, h);
    if (u !== C.NONE) return u;
  }
  // The scattered bushes and flowers of land.ts covers().
  const k = cellHash(i, world.seed + 4563);
  return k < NATURE.BUSHES ? C.BUSH : k < NATURE.BUSHES + 0.01 ? C.FLOWER : C.NONE;
}

// A house or a field within r cells.
function homeNear(world: World, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (!world.inside(x + dx, y + dy)) continue;
      const j = (y + dy) * world.w + x + dx;
      if (world.cover[j] === C.HOUSE || world.ground[j] === G.FIELD) return true;
    }
  return false;
}

// ecology.ts undergrowth(), in its order, h the cell's roll.
function undergrowth(world: World, x: number, y: number, biome: string, dry: boolean, h: number): number {
  const seed = world.seed;
  if (biome !== "tundra") {
    const swamp = biome === "swamp";
    const fresh = freshNear(world, x, y, swamp ? 2 : 1);
    if (fresh === 1 && h < (swamp ? 0.4 : 0.15)) return C.REEDS;
    if (swamp && fresh > 0 && h < 0.15) return C.REEDS;
  }
  const shade = canopy(world, x, y);
  if (shade >= 3) {
    const moist = fbm(x / 30, y / 30, seed + 4457, 3);
    if (shade >= 8 && moist > 0.45 && !dry && h < (biome === "jungle" ? 0.22 : 0.15)) return C.FERN;
    if (shade < 10 && !dry && biome !== "volcanic" && h < 0.045) return C.BERRIES;
    if (shade >= 6 && moist > 0.58 && h < 0.05) return C.FUNGI;
    // A clearing in a big forest: a meadow of flowers.
    if (shade >= 6 && valueNoise(x / 7, y / 7, seed + 4481) > 0.8 && h < 0.3) return C.FLOWER;
  } else if (valueNoise(x / 7, y / 7, seed + 4511) > 0.74 && h < (biome === "tundra" ? 0.06 : 0.15)) return C.FLOWER;
  return C.NONE;
}

// Desert, mesa and tundra: little springs up on its own.
export function sparse(world: World, i: number): boolean {
  const b = biomeAt(world, i);
  return b === "desert" || b === "mesa" || b === "tundra";
}

// The trees (and stumps) in the 5 by 5 around a cell, and how many generation would have put
// there: its share of trees at this cell (the forest noise; none in a forest clearing; a rare
// grove keeps its own) over the cells of that 5 by 5 that are dry grass.
function stand(world: World, i: number): { trees: number; target: number } {
  const x = i % world.w;
  const y = (i / world.w) | 0;
  let trees = 0;
  let room = 0;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      if (!world.inside(x + dx, y + dy)) continue;
      const j = (y + dy) * world.w + x + dx;
      const c = world.cover[j];
      if (c === C.TREE || c === C.STUMP) trees++;
      if (world.ground[j] === G.GRASS && world.depth[j] <= 0.02) room++;
    }
  let p = treeChance(world, i);
  if (p > 0 && valueNoise(x / 7, y / 7, world.seed + 4481) > 0.8) p = 0;
  if (world.rare && world.rare[i]) p = Math.max(p, 0.45);
  return { trees, target: p * room };
}

// May a tree seed here? Only where the forest around is clearly thinner than generation made it.
export function treeRoom(world: World, i: number): boolean {
  const s = stand(world, i);
  return s.trees < s.target * NATURE.SEED_BELOW;
}

// A tree in a forest far thicker than generation made it (an overgrown save).
function overgrown(world: World, i: number): boolean {
  if (world.rare && world.rare[i]) return false;
  const s = stand(world, i);
  return s.trees >= NATURE.THIN_MIN && s.trees > s.target + NATURE.THIN_OVER;
}

// A village's gardens: villagers plant flowers by their houses and leave them as offerings.
function garden(world: World, i: number): boolean {
  const x = i % world.w;
  const y = (i / world.w) | 0;
  const r = NATURE.GARDEN;
  for (const v of world.villages) if (Math.abs(v.x - x) <= r && Math.abs(v.y - y) <= r) return true;
  return false;
}

// A home's garden is full: GARDEN_BEDS flowers or more within 8 cells of it (where its people
// plant). Villagers plant no more there; what they planted stays (garden above).
export function gardenFull(world: World, hx: number, hy: number): boolean {
  const x = Math.round(hx);
  const y = Math.round(hy);
  let n = 0;
  for (let dy = -8; dy <= 8; dy++)
    for (let dx = -8; dx <= 8; dx++)
      if (world.inside(x + dx, y + dy) && world.cover[(y + dy) * world.w + x + dx] === C.FLOWER && ++n >= NATURE.GARDEN_BEDS) return true;
  return false;
}

// One sampled cell's plant, with r its roll: wilts outside its niche, or thins out of a forest
// far thicker than generation made it. True when it went.
export function wither(world: World, i: number, r: number): boolean {
  const c = world.cover[i];
  if (c === C.TREE) {
    if (r >= NATURE.THIN || !overgrown(world, i)) return false;
  } else {
    if (r >= NATURE.WILT || !WILTS.has(c)) return false;
    if (c === C.FLOWER && garden(world, i)) return false;
    if (niche(world, i) === c) return false;
  }
  world.setCover(i, C.NONE);
  return true;
}

// Any water within `reach` cells.
export function waterNear(world: World, i: number, reach: number): boolean {
  const x = i % world.w;
  const y = (i / world.w) | 0;
  for (let dy = -reach; dy <= reach; dy++)
    for (let dx = -reach; dx <= reach; dx++) {
      if (!world.inside(x + dx, y + dy)) continue;
      const j = (y + dy) * world.w + x + dx;
      if (world.fluid[j] === F.WATER && world.depth[j] > 0.05) return true;
    }
  return false;
}

// Ground generation or a village left bare: a dirt patch of the land, or a village's square and
// yards (within YARD cells of a house).
export function bareByMaking(world: World, i: number): boolean {
  if (bareByNature(world, i)) return true;
  const x = i % world.w;
  const y = (i / world.w) | 0;
  const r = NATURE.YARD;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) if (world.inside(x + dx, y + dy) && world.cover[(y + dy) * world.w + x + dx] === C.HOUSE) return true;
  return false;
}

// Bare dirt beside grass greens back only where generation laid grass, in the wet lands.
export function greensBack(world: World, i: number): boolean {
  const b = biomeAt(world, i);
  return (b === "temperate" || b === "swamp" || b === "jungle") && !bareByMaking(world, i);
}

// Does grass (or dirt, or a field) at temperature t (under -6) freeze to snow? Above generation's
// snow line, or in a sudden cold, well under its usual temperature. An island with no land of its
// own (a challenge, a lab) keeps the old rule: under -6 is enough.
export function freezes(world: World, i: number, t: number, usual: number): boolean {
  if (!world.land) return true;
  return t < usual - NATURE.SNOW_DROP || world.height[i] > snowLine(world, i);
}
