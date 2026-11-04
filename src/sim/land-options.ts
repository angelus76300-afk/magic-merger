// What a new island is made of (4.4): a biome, a shape and sliders.
// Its own module, with no imports, so the game page can offer the choice
// without loading the simulation (land.ts builds the island).
//
// 4.4.1: the player does not pick a biome or a shape. They choose a seed
// and four sliders (warmth, water, mountains, forest); the seed picks the
// shape, warmth and water pick the land the way climate does (resolveLand).
// Islands of 200 cells and more always mix several lands, in regions.

export const BIOMES = ["temperate", "desert", "tundra", "jungle", "swamp", "volcanic", "mesa"] as const;
export type Biome = (typeof BIOMES)[number];
export const SHAPES = ["coast", "archipelago", "plateau", "ridges", "lakes", "delta"] as const;
export type Shape = (typeof SHAPES)[number];

// What the player chooses: 0 to 1 each, how warm the island is, how much of
// it is water, how high the mountains rise, how much of the land is forest.
export interface LandChoice {
  warmth: number;
  water: number;
  relief: number;
  forest: number;
}

// What an island is made of, once its seed is known. `biome` is the island's
// land, or the main one of a mixed island (its sea, its rivers, the colors a
// spell's material falls back to).
export interface LandOptions extends LandChoice {
  biome: Biome;
  shape: Shape;
  mixed: boolean;
}

export const DEFAULT_LAND: LandOptions = { biome: "temperate", shape: "coast", warmth: 0.5, water: 0.5, relief: 0.5, forest: 0.5, mixed: false };

// Islands this many cells across and more mix several lands (large, huge,
// giant): on a smaller one a region would be too small for a forest, its
// animals and a village.
export const MIXED_FROM = 200;

export const BIOME_LABELS: Record<Biome, string> = {
  temperate: "Temperate forest",
  desert: "Desert",
  tundra: "Tundra",
  jungle: "Jungle",
  swamp: "Swamp",
  volcanic: "Volcanic",
  mesa: "Mesa",
};

export const SHAPE_LABELS: Record<Shape, string> = {
  coast: "Coast",
  archipelago: "Archipelago",
  plateau: "Plateaus",
  ridges: "Ridges",
  lakes: "Inland lakes",
  delta: "Delta",
};

// A save, a message or a stored choice, read back safely.
export function readLand(v: unknown): LandOptions {
  const o = (v ?? {}) as Partial<Record<keyof LandOptions, unknown>>;
  const unit = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d);
  return {
    biome: BIOMES.includes(o.biome as Biome) ? (o.biome as Biome) : DEFAULT_LAND.biome,
    shape: SHAPES.includes(o.shape as Shape) ? (o.shape as Shape) : DEFAULT_LAND.shape,
    warmth: unit(o.warmth, DEFAULT_LAND.warmth),
    water: unit(o.water, DEFAULT_LAND.water),
    relief: unit(o.relief, DEFAULT_LAND.relief),
    forest: unit(o.forest, DEFAULT_LAND.forest),
    mixed: o.mixed === true,
  };
}

export function readChoice(v: unknown): LandChoice {
  const { warmth, water, relief, forest } = readLand(v);
  return { warmth, water, relief, forest };
}

// The land a climate gives (a Whittaker diagram, much simplified): cold is
// tundra; hot is desert when dry, mesa a little wetter, jungle when wet; the
// middle is temperate forest, swamp when very wet. Volcanoes come from the
// seed, not the climate.
export function classify(warm: number, wet: number): Biome {
  if (warm < 0.3) return "tundra";
  if (warm > 0.7) return wet < 0.38 ? "desert" : wet < 0.55 ? "mesa" : "jungle";
  return wet > 0.7 ? "swamp" : "temperate";
}

// A number from 0 to 1 for a seed and a salt (mulberry32's mixing).
export function seedRoll(seed: number, salt: number): number {
  let t = (seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// How wet the climate is for a water slider: never bone dry, never a sea.
export function wetness(water: number): number {
  return 0.15 + water * 0.7;
}

// The island a choice and a seed make: the shape from the seed (a coast
// more often than the others), the land from warmth and water with a little
// of the seed in it, one volcanic island in ten, mixed from MIXED_FROM.
export function resolveLand(choice: LandChoice, seed: number, cells: number): LandOptions {
  const c = readChoice(choice);
  const r = seedRoll(seed, 1);
  const shape: Shape = r < 0.3 ? "coast" : SHAPES[1 + Math.min(SHAPES.length - 2, Math.floor(((r - 0.3) / 0.7) * (SHAPES.length - 1)))];
  // Mid sliders leave the seed a real say: about one island in six is cold,
  // one in six hot.
  const warm = c.warmth + (seedRoll(seed, 2) - 0.5) * 0.6;
  const wet = wetness(c.water) + (seedRoll(seed, 3) - 0.5) * 0.5;
  const mixed = cells >= MIXED_FROM;
  const biome: Biome = !mixed && seedRoll(seed, 4) < 0.1 ? "volcanic" : classify(warm, wet);
  return { ...c, biome, shape, mixed };
}
