import { C, F, G } from "./materials";
import { wearMinute } from "./roads";
import { Rng, fbm, valueNoise } from "./noise";
import { seedRoll, type Biome } from "./land-options";
import type { World } from "./world";
import { tell } from "./kin";

// Nature that is never the same twice (4.4.5). Once an island's land, water
// and villages are made, this decides what grows where by ecology rules
// rather than noise alone: what each cell's tree looks like (willows by
// fresh water, palms on warm beaches, birches at forest edges, old trees in
// a forest's heart), the undergrowth (reeds on banks, ferns in damp shade,
// berries at edges, fungi rings, fallen logs, flowers in drifts in
// clearings), rocks (outcrops, scree under cliffs, pebbles on beaches,
// standing stones, crystals in volcanic ground), and now and then a rare
// variant of a land: a cherry grove, mangroves, salt flats...
//
// Everything is drawn from the island's seed with its own random stream,
// so the land, the water and the villages come out as they did in 4.4.1.
// The simulation keeps its materials: a willow and a palm are both a tree,
// and the look of each cell is a byte (World.flora) the view reads and
// regrowth keeps, so a tree that grows back is the same kind as before.

// What a tree looks like where it grows, by its index in World.flora's low bits.
export const TREE_STYLES = [
  "",
  "oak",
  "pine",
  "birch",
  "willow",
  "palm",
  "dead",
  "mushroom",
  "snowpine",
  "jungle",
  "juniper",
  "cherry",
  "autumn",
  "bamboo",
  "mangrove",
  "glowcap",
  "cypress",
  "acacia",
] as const;
export type TreeStyle = (typeof TREE_STYLES)[number];
const T = Object.fromEntries(TREE_STYLES.map((s, k) => [s, k])) as Record<TreeStyle, number>;

// World.flora: the tree style in the low five bits, then three flags.
export const STYLE_BITS = 31;
// A tree in a forest's old heart: drawn bigger and older.
export const HEART = 32;
// Damp and shaded: moss on north walls; on water, lily pads.
export const DAMP = 64;
// Where a forest grows: shrubs here turn into young trees, then forest.
export const WOODLAND = 128;

// The rare variants of a land, by their id in World.rare (0 is none).
export const RARE = [
  "",
  "cherry grove",
  "red autumn forest",
  "bamboo stand",
  "mangroves",
  "glowing mushroom wood",
  "petrified forest",
  "salt flats",
  "crystal desert",
  "glowing shore",
  "flamingo lagoon",
] as const;
export type RareKind = (typeof RARE)[number];
export const R = {
  NONE: 0,
  CHERRY: 1,
  AUTUMN: 2,
  BAMBOO: 3,
  MANGROVE: 4,
  GLOWWOOD: 5,
  PETRIFIED: 6,
  SALT: 7,
  CRYSTAL: 8,
  SHORE: 9,
  LAGOON: 10,
} as const;

// Which lands each variant can appear in, and what it needs nearby.
const RARE_LANDS: Record<number, { lands: Biome[]; needs: "forest" | "coast" | "dry" | "any" }> = {
  [R.CHERRY]: { lands: ["temperate"], needs: "forest" },
  [R.AUTUMN]: { lands: ["temperate", "tundra", "volcanic"], needs: "forest" },
  [R.BAMBOO]: { lands: ["jungle", "temperate", "swamp"], needs: "forest" },
  [R.MANGROVE]: { lands: ["jungle", "swamp"], needs: "coast" },
  [R.GLOWWOOD]: { lands: ["swamp", "jungle", "temperate"], needs: "forest" },
  [R.PETRIFIED]: { lands: ["desert", "mesa", "volcanic"], needs: "any" },
  [R.SALT]: { lands: ["desert", "mesa"], needs: "dry" },
  [R.CRYSTAL]: { lands: ["desert", "mesa", "volcanic"], needs: "dry" },
  [R.SHORE]: { lands: ["temperate", "jungle", "swamp", "desert", "mesa", "volcanic"], needs: "coast" },
  [R.LAGOON]: { lands: ["desert", "mesa", "swamp", "jungle"], needs: "coast" },
};

// A patch is about this many cells across; one in RARE_SHARE is a variant.
const PATCH = 46;
const RARE_SHARE = 0.1;

export interface Refuge {
  kind: string;
  x: number;
  y: number;
  r: number;
}

// The look of a village (4.4.5): its houses, by region and by what grows
// around it, and how many of its extras it has built so far.
export const HOUSE_STYLES = ["timber", "adobe", "stone", "stilts", "snowroof"] as const;
export type HouseStyle = (typeof HOUSE_STYLES)[number];
export interface Settlement {
  x: number;
  y: number;
  style: number;
  // 0: nothing yet; 1 a well; 2 fenced fields; 3 a shrine; 4 a windmill on a
  // rise; 5 a dock, where there is a shore.
  level: number;
  // Buildings with a job (4.4.5 part B): each its cover and the top left
  // cell of its two by two block.
  jobs?: { kind: number; i: number }[];
  // Food the granary keeps for hard times.
  store?: number;
  // The way its main street runs from the plaza: a quarter turn, 0 to 3.
  street?: number;
  // Its name, from the syllables of its land.
  name?: string;
}

const N4: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function cellHash(i: number, seed: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(seed + 0x165667b1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

function biomeOf(world: World, i: number, biomes: readonly Biome[]): Biome {
  return world.biomeMap ? biomes[world.biomeMap[i]] : (world.land?.biome ?? "temperate");
}

// Steps to the nearest cell passing `seed`, up to r (255 beyond).
export function distanceTo(world: World, r: number, from: (i: number) => boolean, through: (i: number) => boolean = () => true): Uint8Array {
  const { w, h, n } = world;
  const dist = new Uint8Array(n).fill(255);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++)
    if (from(i)) {
      dist[i] = 0;
      frontier.push(i);
    }
  for (let s = 1; s <= r && frontier.length; s++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w;
      const y = (i / w) | 0;
      for (const [dx, dy] of N4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (dist[j] !== 255 || !through(j)) continue;
        dist[j] = s;
        next.push(j);
      }
    }
    frontier = next;
  }
  return dist;
}

// Covers counted within r of each cell (a box, by summed areas).
function boxCount(world: World, r: number, test: (i: number) => boolean): Uint16Array {
  const { w, h } = world;
  const sum = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += test(y * w + x) ? 1 : 0;
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Uint16Array(world.n);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      out[y * w + x] = sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0];
    }
  }
  return out;
}

// What the generator knows about each cell, for the rules below.
interface Site {
  biomes: readonly Biome[];
  peak: number;
  // Steps to fresh water (lakes, rivers) and to the sea.
  fresh: Uint8Array;
  sea: Uint8Array;
  // Trees within two cells (of 25), and steps from outside a forest in.
  canopy: Uint16Array;
  inForest: Uint8Array;
  // Steps to the nearest house: villages keep their own ground.
  homes: Uint8Array;
  moist: (x: number, y: number) => number;
  // Dry now but under a lake once its water settles at its spill point in
  // the first seconds of play: nothing dry-footed grows there.
  soon: Uint8Array;
}

export const isSea = (world: World, i: number) =>
  world.fluid[i] === F.WATER && world.depth[i] > 0.05 && world.height[i] + world.depth[i] < world.seaLevel + 0.35;
export const isFresh = (world: World, i: number) => world.fluid[i] === F.WATER && world.depth[i] > 0.05 && !isSea(world, i);

function survey(world: World, biomes: readonly Biome[], peak: number, filled: Float32Array): Site {
  const seed = world.seed;
  const soon = new Uint8Array(world.n);
  for (let i = 0; i < world.n; i++) if (world.depth[i] === 0 && filled[i] - world.height[i] > 0.2) soon[i] = 1;
  return {
    soon,
    biomes,
    peak,
    fresh: distanceTo(world, 6, (i) => isFresh(world, i)),
    sea: distanceTo(world, 6, (i) => isSea(world, i)),
    canopy: boxCount(world, 2, (i) => world.cover[i] === C.TREE),
    inForest: distanceTo(
      world,
      8,
      (i) => world.cover[i] !== C.TREE,
      (i) => world.cover[i] === C.TREE,
    ),
    homes: distanceTo(world, 12, (i) => world.cover[i] === C.HOUSE || world.ground[i] === G.FIELD),
    moist: (x, y) => fbm(x / 30, y / 30, seed + 4457, 3),
  };
}

// --- Rare patches ------------------------------------------------------------

// Patches are cells of a jittered grid, their borders warped so they read
// as places, not squares. Each patch rolls once on the seed.
function rarePatches(world: World, site: Site): Uint8Array {
  const { w, h, n, seed } = world;
  const rare = new Uint8Array(n);
  const gx = Math.max(1, Math.round(w / PATCH));
  const gy = Math.max(1, Math.round(h / PATCH));
  const centers: { x: number; y: number; kind: number }[] = [];
  let made = 0;
  const most = Math.max(1, Math.round((gx * gy) / 6));
  for (let py = 0; py < gy; py++)
    for (let px = 0; px < gx; px++) {
      const k = py * gx + px;
      const x = ((px + 0.2 + seedRoll(seed, 4600 + k * 3) * 0.6) / gx) * w;
      const y = ((py + 0.2 + seedRoll(seed, 4601 + k * 3) * 0.6) / gy) * h;
      let kind = 0;
      if (made < most && seedRoll(seed, 4602 + k * 3) < RARE_SHARE) {
        const ci = Math.min(n - 1, Math.round(y) * w + Math.round(x));
        const biome = biomeOf(world, ci, site.biomes);
        const options = Object.entries(RARE_LANDS)
          .filter(([, v]) => v.lands.includes(biome))
          .map(([id, v]) => ({ id: Number(id), needs: v.needs }))
          .filter((o) => patchHas(world, site, x, y, o.needs));
        if (options.length) {
          kind = options[Math.floor(seedRoll(seed, 4690 + k) * options.length)].id;
          made++;
        }
      }
      centers.push({ x, y, kind });
    }
  if (!made) return rare;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const wx = x + (fbm(x / 16, y / 16, seed + 4611, 2) - 0.5) * PATCH * 0.5;
      const wy = y + (fbm(x / 16, y / 16, seed + 4613, 2) - 0.5) * PATCH * 0.5;
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < centers.length; k++) {
        const d = (centers[k].x - wx) ** 2 + (centers[k].y - wy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      // A variant keeps to the middle of its patch: its edge fades into the land around.
      if (centers[best].kind && Math.sqrt(bestD) < PATCH * 0.42) rare[y * w + x] = centers[best].kind;
    }
  return rare;
}

function patchHas(world: World, site: Site, cx: number, cy: number, needs: "forest" | "coast" | "dry" | "any"): boolean {
  if (needs === "any") return true;
  let count = 0;
  const r = PATCH * 0.35;
  for (let y = Math.max(0, Math.round(cy - r)); y < Math.min(world.h, cy + r); y += 2)
    for (let x = Math.max(0, Math.round(cx - r)); x < Math.min(world.w, cx + r); x += 2) {
      const i = y * world.w + x;
      if (needs === "forest" && world.cover[i] === C.TREE) count++;
      else if (needs === "coast" && site.sea[i] === 1) count++;
      else if (needs === "dry" && world.depth[i] === 0 && world.ground[i] !== G.ROCK && site.homes[i] > 6) count++;
    }
  return count > (needs === "dry" ? 60 : needs === "coast" ? 6 : 25);
}

// --- Trees -------------------------------------------------------------------

// The look of a tree that grows in a cell, by its land and place.
function treeStyle(world: World, site: Site, i: number, x: number, y: number, r: number): number {
  const biome = biomeOf(world, i, site.biomes);
  const hgt = world.height[i];
  const high = hgt > world.seaLevel + site.peak * 0.45;
  const edge = site.inForest[i] === 1;
  const fresh = site.fresh[i];
  const beach = site.sea[i] <= 2 && world.ground[i] === G.SAND;
  const damp = site.moist(x, y) > 0.6;
  const heart = site.inForest[i] >= 5;
  // Mixed stands: broad patches of one kind among another.
  const stand = valueNoise(x / 11, y / 11, world.seed + 4473);
  switch (biome) {
    case "temperate":
      if (fresh <= 2 && r < 0.65) return T.willow;
      if (high || (stand > 0.7 && r < 0.7)) return T.pine;
      if (edge && r < 0.55) return T.birch;
      if (heart && damp && r < 0.07) return T.mushroom;
      if (heart && r < 0.025) return T.dead;
      if (stand < 0.25 && r < 0.6) return T.birch;
      return T.oak;
    case "tundra":
      if (edge && !high && r < 0.35) return T.birch;
      if (r < 0.03) return T.dead;
      return T.snowpine;
    case "desert":
      if (fresh <= 3 || beach || site.sea[i] <= 3) return T.palm;
      return r < 0.12 ? T.dead : T.acacia;
    case "mesa":
      if (fresh <= 2) return T.willow;
      if (r < 0.08) return T.dead;
      return stand > 0.62 ? T.acacia : T.juniper;
    case "jungle":
      if (beach || site.sea[i] <= 2) return T.palm;
      if (fresh <= 1 && r < 0.4) return T.cypress;
      if (edge && r < 0.3) return T.palm;
      if (stand > 0.72 && r < 0.6) return T.mangrove;
      return T.jungle;
    case "swamp":
      if (fresh <= 1 || world.depth[i] > 0) return T.cypress;
      if (fresh <= 3 && r < 0.7) return T.willow;
      if (r < 0.12) return T.dead;
      if (damp && heart && r < 0.22) return T.mushroom;
      return stand > 0.55 ? T.cypress : T.willow;
    case "volcanic":
      if (world.ground[i] === G.ASH || world.ground[i] === G.BASALT) return T.dead;
      if (edge && r < 0.2) return T.birch;
      return T.pine;
  }
}

// --- The whole of it -------------------------------------------------------

export interface EcologyCounts {
  rare: number[];
}

// Dresses a fresh island. `peak` is the land's highest above the sea.
export function ecology(world: World, biomes: readonly Biome[], peak: number, filled: Float32Array): void {
  const rng = new Rng((world.seed ^ 0x4c5a) + 4451);
  const { w, h, n } = world;
  let site = survey(world, biomes, peak, filled);
  const rare = rarePatches(world, site);
  world.rare = rare.some((v) => v > 0) ? rare : null;
  shapeRare(world, site, rare, rng);
  // Clearings in the middle of big forests: meadows of flowers.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (world.cover[i] !== C.TREE || site.inForest[i] < 3) continue;
      if (valueNoise(x / 7, y / 7, world.seed + 4481) > 0.8) world.setCover(i, rng.next() < 0.3 ? C.FLOWER : C.NONE);
    }
  site = survey(world, biomes, peak, filled);
  const flora = new Uint8Array(n);
  world.flora = flora;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = cellHash(i, world.seed + 4491);
      let style = treeStyle(world, site, i, x, y, r);
      const k = rare[i];
      if (k === R.CHERRY && r < 0.85) style = T.cherry;
      else if (k === R.AUTUMN) style = r < 0.15 ? T.birch : T.autumn;
      else if (k === R.BAMBOO) style = T.bamboo;
      else if (k === R.MANGROVE && site.sea[i] <= 3) style = T.mangrove;
      else if (k === R.GLOWWOOD) style = r < 0.7 ? T.glowcap : style;
      let bits = style;
      if (site.inForest[i] >= 5 && world.cover[i] === C.TREE && cellHash(i, world.seed + 4493) < 0.45) bits |= HEART;
      if (site.moist(x, y) > 0.55 || site.fresh[i] <= 2) bits |= DAMP;
      if (site.canopy[i] >= 6 || world.cover[i] === C.TREE) bits |= WOODLAND;
      flora[i] = bits;
    }
  undergrowth(world, site, rare, rng);
  rocks(world, site, rng);
  standingStones(world, site, rng);
  // Lily pads on still, shallow fresh water near a shore (rivers run: none there).
  const running = new Set(world.springs.map((s) => s.i));
  for (let i = 0; i < n; i++) {
    if (world.fluid[i] !== F.NONE) flora[i] &= ~DAMP;
    if (!isFresh(world, i)) continue;
    if (world.depth[i] > 1.4 || running.has(i)) continue;
    const biome = biomeOf(world, i, biomes);
    if (biome === "desert" || biome === "mesa" || biome === "tundra" || biome === "volcanic") continue;
    const x = i % w;
    const y = (i / w) | 0;
    if (valueNoise(x / 4, y / 4, world.seed + 4499) > (biome === "swamp" ? 0.58 : 0.76)) flora[i] |= DAMP;
  }
}

// What a rare variant does to the land itself.
function shapeRare(world: World, site: Site, rare: Uint8Array, rng: Rng): void {
  const { w, h } = world;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const k = rare[i];
      if (!k || site.homes[i] < 5) continue;
      const dry = world.depth[i] === 0 && world.fluid[i] === F.NONE && !site.soon[i];
      const open = dry && (world.cover[i] === C.NONE || world.cover[i] === C.BUSH || world.cover[i] === C.FLOWER);
      switch (k) {
        case R.CHERRY:
        case R.AUTUMN:
        case R.BAMBOO:
        case R.GLOWWOOD:
          // A grove worth the name: the patch is thick with its trees.
          if (open && world.ground[i] === G.GRASS && valueNoise(x / 6, y / 6, world.seed + 4503) > 0.35 && rng.next() < (k === R.BAMBOO ? 0.6 : 0.4))
            world.setCover(i, C.TREE);
          break;
        case R.MANGROVE:
          // Mangroves stand in the shallows along the shore and on the beach.
          if ((site.sea[i] <= 2 && dry) || (world.fluid[i] === F.WATER && world.depth[i] < 0.7 && site.sea[i] === 0 && nearLand(world, x, y)))
            if (rng.next() < 0.55) world.setCover(i, C.TREE);
          break;
        case R.PETRIFIED:
          if (dry && (world.cover[i] === C.TREE || (open && world.ground[i] !== G.ROCK && rng.next() < 0.12))) world.setCover(i, C.PETRIFIED);
          if (dry && world.cover[i] === C.NONE && rng.next() < 0.04) world.setCover(i, C.LOG);
          break;
        case R.SALT:
          // Flat white ground in a low basin.
          if (dry && world.ground[i] !== G.ROCK && world.height[i] < world.seaLevel + site.peak * 0.5) {
            world.ground[i] = G.SAND;
            if (world.cover[i] !== C.HOUSE) world.setCover(i, C.NONE);
            world.height[i] = world.height[i] * 0.7 + (world.seaLevel + 1.5) * 0.3;
          } else rare[i] = 0;
          break;
        case R.CRYSTAL:
          if (dry && valueNoise(x / 5, y / 5, world.seed + 4507) > 0.62) {
            world.ground[i] = G.CRYSTAL;
            if (world.cover[i] !== C.HOUSE) world.setCover(i, rng.next() < 0.14 ? C.CRYSTALS : C.NONE);
          }
          break;
        case R.LAGOON:
          // Low land by the sea becomes a shallow lagoon.
          if (dry && site.sea[i] <= 4 && world.height[i] < world.seaLevel + 1.4 && world.cover[i] !== C.HOUSE) {
            world.height[i] = world.seaLevel - 0.45;
            world.ground[i] = G.SAND;
            world.setCover(i, C.NONE);
            world.setFluid(i, F.WATER, 0.45);
          }
          break;
      }
    }
}

function nearLand(world: World, x: number, y: number): boolean {
  for (const [dx, dy] of N4) {
    const j = (y + dy) * world.w + x + dx;
    if (world.inside(x + dx, y + dy) && world.depth[j] === 0) return true;
  }
  return false;
}

// Undergrowth by ecology: reeds on banks, ferns in damp shade, berries at
// forest edges, fungi and fallen logs in old forest, flowers in drifts and
// meadows, cacti in the desert.
function undergrowth(world: World, site: Site, rare: Uint8Array, rng: Rng): void {
  const { w, h } = world;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (world.depth[i] > 0 || world.fluid[i] !== F.NONE || site.soon[i] || site.homes[i] < 4) continue;
      const g = world.ground[i];
      const c = world.cover[i];
      const biome = biomeOf(world, i, site.biomes);
      const r = rng.next();
      const moist = site.moist(x, y);
      const glow = rare[i] === R.GLOWWOOD;
      if (c === C.TREE) {
        // In the old heart, a tree now and then lies fallen.
        if (site.inForest[i] >= 4 && r < 0.03 && biome !== "desert" && biome !== "mesa") world.setCover(i, C.LOG);
        continue;
      }
      if (c !== C.NONE && c !== C.BUSH && c !== C.FLOWER) continue;
      if (g !== G.GRASS && g !== G.SAND && g !== G.DIRT) continue;
      const dry = biome === "desert" || biome === "mesa";
      const shade = site.canopy[i];
      if (site.fresh[i] === 1 && g !== G.SAND && biome !== "tundra" && r < (biome === "swamp" ? 0.4 : 0.15)) world.setCover(i, C.REEDS);
      else if (biome === "swamp" && site.fresh[i] <= 2 && r < 0.15) world.setCover(i, C.REEDS);
      else if (g !== G.GRASS) {
        if (dry && g === G.SAND && site.fresh[i] > 3 && r < 0.022) world.setCover(i, C.CACTUS);
      } else if (shade >= 8 && (moist > 0.45 || glow) && !dry && r < (biome === "jungle" ? 0.22 : 0.15)) world.setCover(i, glow && r < 0.08 ? C.FUNGI : C.FERN);
      else if (shade >= 3 && shade < 10 && !dry && biome !== "volcanic" && r < 0.045) world.setCover(i, C.BERRIES);
      else if (shade >= 6 && moist > 0.58 && r < 0.05) world.setCover(i, C.FUNGI);
      else if (dry && r < 0.012) world.setCover(i, C.CACTUS);
      else if (shade < 3 && valueNoise(x / 7, y / 7, world.seed + 4511) > 0.74 && r < (biome === "tundra" ? 0.06 : 0.15)) world.setCover(i, C.FLOWER);
    }
  // Fungi rings in the old heart.
  for (let k = 0; k < Math.round(world.n / 4000); k++) {
    const x = rng.int(4, w - 5);
    const y = rng.int(4, h - 5);
    if (site.inForest[y * w + x] < 2 && site.canopy[y * w + x] < 10) continue;
    const r = rng.range(1.6, 2.6);
    for (let a = 0; a < 12; a++) {
      const j = Math.round(y + Math.sin((a / 12) * Math.PI * 2) * r) * w + Math.round(x + Math.cos((a / 12) * Math.PI * 2) * r);
      if (world.ground[j] === G.GRASS && world.depth[j] === 0 && (world.cover[j] === C.NONE || world.cover[j] === C.FERN)) world.setCover(j, C.FUNGI);
    }
  }
}

// Rocks: outcrops on stony ground, scree at the foot of cliffs, pebbles on
// beaches, crystals in volcanic ground.
function rocks(world: World, site: Site, rng: Rng): void {
  const { w, h, height } = world;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (world.depth[i] > 0 || world.cover[i] !== C.NONE || site.soon[i] || site.homes[i] < 3) continue;
      const g = world.ground[i];
      const biome = biomeOf(world, i, site.biomes);
      let cliff = 0;
      for (const [dx, dy] of N4) cliff = Math.max(cliff, height[(y + dy) * w + x + dx] - height[i]);
      const r = rng.next();
      if (cliff > 2.2 && g !== G.SNOW && r < 0.09) world.setCover(i, C.SCREE);
      else if (g === G.ROCK && valueNoise(x / 5, y / 5, world.seed + 4521) > 0.72 && r < 0.3) world.setCover(i, C.BOULDER);
      else if (g === G.SAND && site.sea[i] <= 2 && site.sea[i] > 0 && r < (biome === "temperate" || biome === "tundra" || biome === "volcanic" ? 0.16 : 0.05))
        world.setCover(i, C.PEBBLES);
      else if ((g === G.BASALT || g === G.ASH) && valueNoise(x / 6, y / 6, world.seed + 4527) > 0.74 && r < 0.18) world.setCover(i, C.CRYSTALS);
    }
}

// A ring of standing stones on open high ground, on about half the islands.
function standingStones(world: World, site: Site, rng: Rng): void {
  const rings = Math.max(1, Math.round(world.n / 30000));
  for (let k = 0; k < rings; k++) {
    if (rng.next() > 0.6) continue;
    let best = -1;
    let bestScore = -Infinity;
    for (let t = 0; t < 200; t++) {
      const x = rng.int(8, world.w - 9);
      const y = rng.int(8, world.h - 9);
      const i = y * world.w + x;
      if (world.ground[i] !== G.GRASS || world.depth[i] > 0 || site.homes[i] < 12 || site.canopy[i] > 2) continue;
      let rough = 0;
      for (let dy = -4; dy <= 4; dy += 2) for (let dx = -4; dx <= 4; dx += 2) rough += Math.abs(world.height[i + dy * world.w + dx] - world.height[i]);
      const score = world.height[i] - rough * 2;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) continue;
    const cx = best % world.w;
    const cy = (best / world.w) | 0;
    const stones = rng.int(6, 9);
    for (let s = 0; s < stones; s++) {
      const a = (s / stones) * Math.PI * 2;
      const j = Math.round(cy + Math.sin(a) * 3.2) * world.w + Math.round(cx + Math.cos(a) * 3.2);
      if (world.depth[j] === 0) world.setCover(j, C.STONE);
    }
  }
}

// --- Refuges ----------------------------------------------------------------

// A small patch kept for each wild species in each region it lives in, so a
// wildfire or a flood cannot end it for good: births and arrivals fall back
// to it, and its plants grow back first.
export const REFUGE_R = 4;

export function markRefuges(world: World, kinds: { name: string; habitat: (world: World, i: number) => boolean }[]): void {
  const out: Refuge[] = [];
  const step = 48;
  for (const s of kinds) {
    for (let by = 0; by < world.h; by += step)
      for (let bx = 0; bx < world.w; bx += step) {
        // The block's best spot: the most habitat around a habitat cell.
        let best = -1;
        let bestScore = 0;
        for (let t = 0; t < 40; t++) {
          const x = Math.min(world.w - 1, bx + ((cellHash(t * 7919 + bx * 31 + by, world.seed + 4531) * step) | 0));
          const y = Math.min(world.h - 1, by + ((cellHash(t * 104729 + bx + by * 17, world.seed + 4533) * step) | 0));
          const i = y * world.w + x;
          if (!s.habitat(world, i)) continue;
          let score = 0;
          for (let dy = -REFUGE_R; dy <= REFUGE_R; dy += 2)
            for (let dx = -REFUGE_R; dx <= REFUGE_R; dx += 2) if (world.inside(x + dx, y + dy) && s.habitat(world, (y + dy) * world.w + x + dx)) score++;
          if (score > bestScore) {
            bestScore = score;
            best = i;
          }
        }
        if (best >= 0 && bestScore >= 4) out.push({ kind: s.name, x: best % world.w, y: (best / world.w) | 0, r: REFUGE_R });
      }
  }
  world.refuges = out.slice(0, 200);
}

// --- Growth ---------------------------------------------------------------

// What springs up on a bare cell of an island with flora: the niche's own
// undergrowth. Called by physics.ts's growth step, with the world's stream.
export function sprout(world: World, i: number, r: number): number {
  const f = world.flora![i];
  const g = world.ground[i];
  if (g !== G.GRASS) return C.NONE;
  if (f & DAMP && f & WOODLAND) return r < 0.6 ? C.FERN : C.FUNGI;
  if (f & WOODLAND) return r < 0.5 ? C.BUSH : C.BERRIES;
  return r < 0.6 ? C.FLOWER : C.BUSH;
}

// Undergrowth that spreads from a neighbor of its own kind: ferns, reeds,
// berries and flowers creep; trees seed.
export const SPREADS = new Set<number>([C.FERN, C.REEDS, C.BERRIES, C.FLOWER]);

// Does an island with flora let a tree grow here? A shrub inside a woodland
// grows up into a young tree (succession after a fire or a cosmic spell).
export function woodland(world: World, i: number): boolean {
  return !!world.flora && (world.flora[i] & WOODLAND) !== 0;
}

// --- Settlements ------------------------------------------------------------

// Each village's look, from its region and what grows around it: adobe in
// dry lands, snow roofs in the cold, stilts by the water of a swamp or a
// jungle, stone where there is little wood or on volcanic ground, timber
// where the forest is close.
export function dressSettlements(world: World, biomes: readonly Biome[]): void {
  for (const s of world.settlements) dressSettlement(world, s, biomes);
}

// The house style of one village, from its land and what grows round it.
export function dressSettlement(world: World, s: Settlement, biomes: readonly Biome[]): void {
  {
    const cx = Math.round(s.x);
    const cy = Math.round(s.y);
    let trees = 0;
    let water = 0;
    for (let y = Math.max(0, cy - 16); y < Math.min(world.h, cy + 16); y++)
      for (let x = Math.max(0, cx - 16); x < Math.min(world.w, cx + 16); x++) {
        const i = y * world.w + x;
        if (world.cover[i] === C.TREE) trees++;
        if (world.fluid[i] === F.WATER && world.depth[i] > 0.1) water++;
      }
    const biome = biomeOf(world, cy * world.w + cx, biomes);
    let style: HouseStyle = "timber";
    if (biome === "desert" || biome === "mesa") style = "adobe";
    else if (biome === "tundra") style = "snowroof";
    else if ((biome === "swamp" || biome === "jungle") && water > 20) style = "stilts";
    else if (biome === "volcanic" || trees < 25) style = "stone";
    s.style = HOUSE_STYLES.indexOf(style);
  }
}

// A new village's well, as a fresh island's villages get theirs.
export function firstWell(world: World, s: Settlement): void {
  s.level = Math.max(1, s.level);
  build(world, s, 1);
}

// What a village has to spend, by the stores of the village nearest to it.
function wealthOf(world: World, s: Settlement): number {
  let best = -1;
  let bestD = 30;
  for (let k = 0; k < world.villages.length; k++) {
    const v = world.villages[k];
    const d = Math.abs(v.x - s.x) + Math.abs(v.y - s.y);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  if (best < 0) return 0;
  const v = world.villages[best];
  return v.food + v.wood + v.gold * 2;
}

// What a village builds as it gets richer, and the stores it takes: a well
// from the start, then fences round its fields, a shrine, a windmill on a
// rise, a dock where there is a shore.
// Stores grow fast once fields are worked (160 food in five minutes on a
// medium island), so each level also waits its turn: the second after two
// and a half minutes of play, the last after ten.
const LEVELS = [0, 0, 50, 90, 140, 200];
const LEVEL_SECONDS = 150;
const BUILT = ["", "dug a well", "fenced its fields", "raised a shrine", "built a windmill on the rise", "built a dock"];

// Every twenty seconds from lifeCycle (and once when the island is made,
// with `fresh`, for the well).
export function growSettlements(world: World, fresh = false): void {
  for (const s of world.settlements) {
    if (s.level >= 5) continue;
    const next = fresh ? 1 : s.level + 1;
    if (!fresh && (wealthOf(world, s) < LEVELS[next] || world.time < s.level * LEVEL_SECONDS)) continue;
    if (fresh && s.level >= 1) {
      build(world, s, 1);
      continue;
    }
    s.level = next;
    if (build(world, s, next) && !fresh) tell(world, `a village ${BUILT[next]}`);
  }
}

function openCell(world: World, i: number): boolean {
  const g = world.ground[i];
  return world.depth[i] === 0 && world.fluid[i] === F.NONE && world.cover[i] === C.NONE && (g === G.GRASS || g === G.DIRT || g === G.PATH);
}

// Places what a level brings; false when there is nowhere for it.
function build(world: World, s: Settlement, level: number): boolean {
  const { w } = world;
  const cx = Math.round(s.x);
  const cy = Math.round(s.y);
  const ring = (r0: number, r1: number, test: (i: number) => boolean): number[] => {
    const out: number[] = [];
    for (let y = cy - r1; y <= cy + r1; y++)
      for (let x = cx - r1; x <= cx + r1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < r0 || d > r1 || !world.inside(x, y)) continue;
        if (test(y * w + x)) out.push(y * w + x);
      }
    return out;
  };
  const nearest = (list: number[]) => list.sort((a, b) => Math.hypot((a % w) - cx, ((a / w) | 0) - cy) - Math.hypot((b % w) - cx, ((b / w) | 0) - cy))[0];
  switch (level) {
    case 1: {
      // Already dug (a save, a reload): nothing more.
      if (ring(0, 6, (i) => world.cover[i] === C.WELL).length) return true;
      const at = nearest(ring(0, 5, (i) => openCell(world, i)));
      if (at === undefined) return false;
      world.setCover(at, C.WELL);
      return true;
    }
    case 2: {
      let n = 0;
      for (const i of ring(0, 20, (j) => world.ground[j] === G.FIELD)) {
        const x = i % w;
        const y = (i / w) | 0;
        for (const [dx, dy] of N4) {
          if (n >= 70 || !world.inside(x + dx, y + dy)) continue;
          const j = (y + dy) * w + x + dx;
          if (world.ground[j] !== G.FIELD && openCell(world, j)) {
            world.setCover(j, C.FENCE);
            n++;
          }
        }
      }
      return n > 0;
    }
    case 3: {
      const at = nearest(ring(3, 8, (i) => openCell(world, i)));
      if (at === undefined) return false;
      world.setCover(at, C.SHRINE);
      return true;
    }
    case 4: {
      let best = -1;
      for (const i of ring(6, 16, (j) => openCell(world, j) && world.ground[j] !== G.PATH)) if (best < 0 || world.height[i] > world.height[best]) best = i;
      if (best < 0) return false;
      world.setCover(best, C.WINDMILL);
      return true;
    }
    case 5: {
      // The nearest shore with water deep enough to moor.
      const shore = ring(4, 22, (i) => {
        if (world.fluid[i] !== F.WATER || world.depth[i] < 0.3 || world.cover[i] !== C.NONE) return false;
        const x = i % w;
        const y = (i / w) | 0;
        return N4.some(([dx, dy]) => world.inside(x + dx, y + dy) && world.depth[(y + dy) * w + x + dx] === 0);
      });
      const at = nearest(shore);
      if (at === undefined) return false;
      world.setCover(at, C.DOCK);
      // One more plank out over the water.
      const x = at % w;
      const y = (at / w) | 0;
      for (const [dx, dy] of N4) {
        const j = (y + dy) * w + x + dx;
        if (world.inside(x + dx, y + dy) && world.fluid[j] === F.WATER && world.depth[j] > 0.3 && world.cover[j] === C.NONE) {
          world.setCover(j, C.DOCK);
          break;
        }
      }
      return true;
    }
  }
  return false;
}

// Paths wear in where villagers walk (once a second from lifeCycle): grass
// walked over often enough turns to a path, and a path no one walks greens
// over again (physics.ts). Every minute the count halves, and a path walked
// hard enough for long enough becomes a dirt road (4.9, roads.ts).
export function wearPaths(world: World): void {
  if (!world.wear) world.wear = new Uint8Array(world.n);
  const wear = world.wear;
  if (world.tick % 1800 < 30) {
    // 4.9: paths walked hard for minutes running tread into dirt roads.
    wearMinute(world);
    for (let i = 0; i < world.n; i++) wear[i] >>= 1;
  }
  for (const c of world.creatures) {
    if (c.dead || c.kind !== "villager") continue;
    const x = Math.round(c.x);
    const y = Math.round(c.y);
    if (!world.inside(x, y)) continue;
    const i = y * world.w + x;
    if (wear[i] < 255) wear[i]++;
    if (wear[i] >= 10 && world.ground[i] === G.GRASS && world.cover[i] === C.NONE && world.depth[i] === 0) world.ground[i] = G.PATH;
  }
}
