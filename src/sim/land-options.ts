// What a new island is made of (4.4): a biome, a shape and three sliders.
// Its own module, with no imports, so the game page can offer the choice
// without loading the simulation (land.ts builds the island).

export const BIOMES = ["temperate", "desert", "tundra", "jungle", "swamp", "volcanic", "mesa"] as const;
export type Biome = (typeof BIOMES)[number];
export const SHAPES = ["coast", "archipelago", "plateau", "ridges", "lakes", "delta"] as const;
export type Shape = (typeof SHAPES)[number];

export interface LandOptions {
  biome: Biome;
  shape: Shape;
  // 0 to 1 each: how much of the island is water, how high the mountains
  // rise, how much of the land is forest.
  water: number;
  relief: number;
  forest: number;
}

export const DEFAULT_LAND: LandOptions = { biome: "temperate", shape: "coast", water: 0.5, relief: 0.5, forest: 0.5 };

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
    water: unit(o.water, DEFAULT_LAND.water),
    relief: unit(o.relief, DEFAULT_LAND.relief),
    forest: unit(o.forest, DEFAULT_LAND.forest),
  };
}
