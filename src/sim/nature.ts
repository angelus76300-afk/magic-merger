// Nature holds its shape (21 November, the owner: an island left running looked "just weird").
// A 60-minute soak on main found grass in flower going from 2-3% to 50-83% in every biome,
// desert and tundra too, bushes up five to seven times, trees about double, reeds standing
// far from any water, generated dirt and desert greening within five minutes, and pale
// squares of snow on high grass. Growth had births and no deaths, and its births went
// anywhere. The owner's rule since: nothing looks different just because time passed,
// unless the player or the world did something visible (a spell, a fire, a flood, a village
// growing).
//
// So each open grass cell has a place: what kinds of undergrowth generation could have grown
// on it and how thickly, worked out again from the seed, the cell's biome, the trees around it
// and the water beside it (ecology.ts undergrowth and land.ts covers, the same order and the
// same shares). Undergrowth spreads and sprouts only into the kind its cell's roll gives it,
// and only while the land round it holds fewer of that kind than generation made. A plant
// wilts slowly where its cell cannot hold its kind (a reed whose water went, a fern whose
// shade burnt) or where its kind stands far thicker than generation made it (an overgrown
// save). What the player's spell, item or creature planted never wilts for its place
// (World.planted), and a village's gardens stay. Generation's own plants all stand where
// their land holds them, so they stay where they are. Trees seed only where the forest
// around is thinner than generation made it there, and thin out slowly where it is far
// thicker. Bare ground greens back only where generation laid grass, in the wet lands,
// slowly. Grass freezes to snow only where a spell's cold reached (World.markCold), never
// just because the air up there is cold: generation laid the snow where it belongs, and laid
// grass where it meant grass (a grove it made for the deer on a cold plateau froze within two
// minutes).
//
// Every number of it is here.
import { C, F, G } from "./materials";
import { fbm, valueNoise } from "./noise";
import { cellHash, isFresh } from "./cellhash";
import { bareByNature, biomeAt, treeChance } from "./genrules";
import type { World } from "./world";

export const NATURE = {
  // Per sample (each cell is sampled about 7 times a minute): undergrowth creeping from a
  // neighbour of its kind, springing up on its own, and wilting where its land does not hold it.
  SPREAD: 0.03,
  SPROUT: 0.01,
  // A plant eaten or picked grows back from its roots on its own cell (World.eaten).
  REGROW: 0.08,
  WILT: 0.002,
  // The scattered bushes and flowers of the open (land.ts covers: generation rolled 2.5% bushes and
  // lost some under what came after, and 1% flowers).
  BUSHES: 0.022,
  FLOWERS: 0.01,
  // A plant wilts where its kind stands thicker in the 5 by 5 round it than OVER times
  // generation's share and SLACK plants more.
  OVER: 1.5,
  SLACK: 2,
  // Undergrowth springs up only while the 5 by 5 round it holds under UNDER times generation's
  // share of its kind: every box filled to its share would end thicker than generation made the
  // land as a whole (its boxes scatter round that share), as for the trees (SEED_BELOW).
  UNDER: 0.6,
  // Of the flower sprouts in the dry and cold lands (desert, mesa, tundra), the share that happen
  // (what animals graze, bushes and berries, grows back at the usual pace).
  SPARSE: 0.1,
  // Bare dirt greening beside grass where generation laid grass (it was 0.5, everywhere): ground
  // grazed bare, burnt or dug comes back; generation's own dirt and sand stay.
  GREEN: 0.05,
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
} as const;

// The plants that wilt where their land does not hold them. Fungi rings, logs and the rest stay
// as made.
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

// The chance generation gave an open grass cell of holding each kind of undergrowth (ecology.ts
// undergrowth, in its order, and land.ts covers), from what is round it now: its biome, the water
// beside it, the trees over it, the damp and the drifts. Generation's own dice are not kept, so
// this says what the cell could hold and how thickly, not what it held.
interface Place {
  reeds: number;
  fern: number;
  berries: number;
  flower: number;
  bush: number;
}

const NOTHING: Place = { reeds: 0, fern: 0, berries: 0, flower: 0, bush: 0 };

function place(world: World, i: number): Place {
  if (world.ground[i] !== G.GRASS || world.depth[i] > 0.02) return NOTHING;
  const x = i % world.w;
  const y = (i / world.w) | 0;
  const seed = world.seed;
  const biome = biomeAt(world, i);
  const dry = biome === "desert" || biome === "mesa";
  const out: Place = { reeds: 0, fern: 0, berries: 0, flower: NATURE.FLOWERS, bush: NATURE.BUSHES };
  // Generation grew no undergrowth within 3 cells of a house or a field: a village keeps its ground.
  if (homeNear(world, x, y, 3)) return out;
  if (biome !== "tundra") {
    const swamp = biome === "swamp";
    const fresh = freshNear(world, x, y, swamp ? 2 : 1);
    if (fresh === 1) out.reeds = swamp ? 0.4 : 0.15;
    else if (swamp && fresh > 0) out.reeds = 0.15;
  }
  const shade = canopy(world, x, y);
  if (shade >= 3) {
    const moist = fbm(x / 30, y / 30, seed + 4457, 3);
    if (shade >= 8 && moist > 0.45 && !dry) out.fern = biome === "jungle" ? 0.22 : 0.15;
    if (shade < 10 && !dry && biome !== "volcanic") out.berries = 0.045;
    // A clearing in a big forest: a meadow of flowers.
    if (shade >= 6 && valueNoise(x / 7, y / 7, seed + 4481) > 0.8) out.flower += 0.3;
  } else if (valueNoise(x / 7, y / 7, seed + 4511) > 0.74) out.flower += biome === "tundra" ? 0.06 : 0.15;
  return out;
}

// The share of a kind a cell could hold (0: it cannot).
export function share(world: World, i: number, c: number): number {
  const p = place(world, i);
  return c === C.REEDS ? p.reeds : c === C.FERN ? p.fern : c === C.BERRIES ? p.berries : c === C.FLOWER ? p.flower : c === C.BUSH ? p.bush : 0;
}

// Plants of a kind in the 5 by 5 around a cell, and its cells of dry grass.
function crowd(world: World, i: number, c: number): { n: number; room: number } {
  const x = i % world.w;
  const y = (i / world.w) | 0;
  let n = 0;
  let room = 0;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      if (!world.inside(x + dx, y + dy)) continue;
      const j = (y + dy) * world.w + x + dx;
      // What the player planted is not the land's: it crowds out nothing. A plant eaten to its
      // roots still counts: it grows back there.
      if (world.cover[j] === c ? !(world.planted && world.planted[j]) : world.eaten !== null && world.eaten[j] === c) n++;
      if (world.ground[j] === G.GRASS && world.depth[j] <= 0.02) room++;
    }
  return { n, room };
}

// Does this plant stand where the land would hold it? A kind the cell can hold, no thicker round
// it than OVER times generation's share and SLACK plants more (an overgrown save is far thicker).
export function holds(world: World, i: number, c: number): boolean {
  const e = share(world, i, c);
  if (e <= 0) return false;
  // The thickness allowed is the land's round it, two cells out each way: a flower at a drift's
  // edge stands with the drift.
  const x = i % world.w;
  const y = (i / world.w) | 0;
  let most = e;
  for (const [dx, dy] of [
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
  ])
    if (world.inside(x + dx, y + dy)) most = Math.max(most, share(world, (y + dy) * world.w + x + dx, c));
  const k = crowd(world, i, c);
  return k.n <= most * k.room * NATURE.OVER + NATURE.SLACK;
}

// What springs up on this open grass cell, if anything: the kind the cell's own roll gives it
// (generation's shares, with a cell hash for its dice), while the 5 by 5 round it holds fewer of
// that kind than generation's share.
export function niche(world: World, i: number): number {
  const p = place(world, i);
  if (p === NOTHING) return C.NONE;
  const h = cellHash(i, world.seed + 4561);
  let s: number = C.NONE;
  if (h < p.reeds) s = C.REEDS;
  else if (h < p.fern) s = C.FERN;
  else if (h < p.berries) s = C.BERRIES;
  else if (h < p.flower - NATURE.FLOWERS) s = C.FLOWER;
  else {
    const k = cellHash(i, world.seed + 4563);
    s = k < p.bush ? C.BUSH : k < p.bush + NATURE.FLOWERS ? C.FLOWER : C.NONE;
  }
  if (s === C.NONE) return s;
  const e = share(world, i, s);
  const k = crowd(world, i, s);
  return k.n < e * k.room * NATURE.UNDER ? s : C.NONE;
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
  for (const v of world.settlements) if (Math.abs(v.x - x) <= r && Math.abs(v.y - y) <= r) return true;
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

// One sampled cell's plant, with r its roll: wilts where its land does not hold it, or thins out
// of a forest far thicker than generation made it. What the player planted stays. True when it
// went.
export function wither(world: World, i: number, r: number): boolean {
  const c = world.cover[i];
  if (c === C.TREE) {
    if (r >= NATURE.THIN || (world.planted && world.planted[i]) || !overgrown(world, i)) return false;
  } else if (r >= NATURE.WILT || !wilts(world, i)) return false;
  world.setCover(i, C.NONE);
  return true;
}

// Would this cell's plant wilt (given the roll)? Undergrowth its land does not hold, unless the
// player planted it or it is a village's garden flower.
export function wilts(world: World, i: number): boolean {
  const c = world.cover[i];
  if (!WILTS.has(c) || (world.planted && world.planted[i])) return false;
  if (c === C.FLOWER && garden(world, i)) return false;
  return !holds(world, i, c);
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

// Bare dirt beside grass greens back only where generation laid grass (grazed bare, burnt, dug),
// in every land: the dry lands' grass by the water too, never their own dirt.
export function greensBack(world: World, i: number): boolean {
  return !bareByMaking(world, i);
}

// Does grass (or dirt, or a field) under -6 freeze to snow? Only where a spell's cold reached in
// the last seconds (World.markCold). An island with no land of its own (a challenge, a lab)
// keeps the old rule: under -6 is enough.
export function freezes(world: World, i: number): boolean {
  return !world.land || (world.chill !== null && world.chill[i] > 0);
}
