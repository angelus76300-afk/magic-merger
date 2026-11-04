// The materials of the top-down world, in four layers stacked on each cell:
// the ground surface, a fluid lying on it, a cover standing on it (trees,
// houses...), and a gas floating above. Spells can add their own materials at
// run time (see runtime.ts), so ids past the built-in ones are allocated there.

export type Layer = "ground" | "fluid" | "cover" | "gas";
export const LAYERS: readonly Layer[] = ["ground", "fluid", "cover", "gas"];

export interface Material {
  name: string;
  layer: Layer;
  // A few close colors; each cell picks one by its own noise so surfaces look textured.
  colors: number[];
  // 0 to 1: how readily fire catches.
  flammable: number;
  // Seconds of burning a full cell of it feeds.
  fuel: number;
  // Fluids only: 0 (does not move) to 1 (water).
  flow: number;
  // Damage per second to a creature standing in or on it.
  hurts: number;
  // Temperature the material pulls its cell toward, or null.
  heat: number | null;
  // Emits light in the dark.
  glow: boolean;
  // Cover only: blocks walking.
  solid: boolean;
  // The layer default used when a spell's own material is unknown after a reload.
  fallback: string;
}

const make = (name: string, layer: Layer, colors: number[], extra: Partial<Material> = {}): Material => ({
  name,
  layer,
  colors,
  flammable: 0,
  fuel: 0,
  flow: 0,
  hurts: 0,
  heat: null,
  glow: false,
  solid: false,
  fallback: layer === "ground" ? "dirt" : "none",
  ...extra,
});

// Built-in materials. Order sets their ids; ids 0 of each layer mean "none".
export const BUILTIN: Record<Layer, Material[]> = {
  ground: [
    make("grass", "ground", [0x5d9c3a, 0x67a842, 0x569236, 0x6fae49], { flammable: 0.1, fuel: 2 }),
    make("dirt", "ground", [0x8a6a44, 0x7f6140, 0x93714a]),
    make("sand", "ground", [0xd9c38a, 0xe0ca92, 0xd2bb82]),
    make("rock", "ground", [0x8a8a8e, 0x7e7e84, 0x96969a, 0x85858b]),
    make("snow", "ground", [0xf1f5fa, 0xe8eef6, 0xfafcff], { heat: -4 }),
    make("ash", "ground", [0x5a5652, 0x4f4b48, 0x65605b]),
    make("basalt", "ground", [0x3b3836, 0x34312f, 0x433f3c]),
    make("crystal", "ground", [0xb9a4ff, 0xd3c6ff, 0x9f88f5], { glow: true }),
    make("field", "ground", [0xc9b25a, 0xbfa64f, 0xd2bc66], { flammable: 0.6, fuel: 3 }),
    // 4.4.5: a path villagers wore into the grass. After every older id, so
    // saves from before keep theirs (save.ts reads the counts a save was
    // written with).
    make("path", "ground", [0xa08462, 0x987c5a, 0xa98c68]),
  ],
  fluid: [
    make("none", "fluid", [0]),
    make("water", "fluid", [0x2f7fd0, 0x3588d8, 0x2a76c4], { flow: 1 }),
    make("ice", "fluid", [0xbfe3f5, 0xcdeaf8, 0xb4dcf0], { heat: -6 }),
    make("lava", "fluid", [0xff5a1a, 0xff7a22, 0xe8420f, 0xffa03a], { flow: 0.18, hurts: 300, heat: 1100, glow: true }),
    make("oil", "fluid", [0x1d1a17, 0x26221d, 0x2e2822], { flow: 0.7, flammable: 1, fuel: 6 }),
    make("acid", "fluid", [0x8bea2c, 0x9ff23d, 0x76d81f], { flow: 0.9, hurts: 25, glow: true }),
    make("mud", "fluid", [0x6b4f33, 0x5f462d, 0x765838], { flow: 0.12 }),
  ],
  cover: [
    make("none", "cover", [0]),
    make("tree", "cover", [0x2f6b2a, 0x377a30, 0x2a6125, 0x3f8636], { flammable: 0.55, fuel: 8, solid: true }),
    make("bush", "cover", [0x4a8a35, 0x52953b, 0x447f30], { flammable: 0.6, fuel: 3 }),
    make("crop", "cover", [0xe0c14a, 0xd6b23e, 0xe8cc58], { flammable: 0.7, fuel: 2 }),
    make("house", "cover", [0xb5523b, 0xa84a35, 0xc05d44], { flammable: 0.35, fuel: 14, solid: true }),
    make("rubble", "cover", [0x8c7c6c, 0x7a6b5d, 0x9a8a78]),
    make("powder", "cover", [0x3a3a3a, 0x2c2c2c, 0x474747], { flammable: 1, fuel: 0.2 }),
    make("stump", "cover", [0x5b4128, 0x4e3822]),
    make("flower", "cover", [0xe86a9a, 0xf2c94c, 0xa98cf0, 0xffffff], { flammable: 0.4, fuel: 1 }),
    make("boulder", "cover", [0x9a9aa0, 0x8a8a90, 0xa8a8ae], { solid: true }),
    // 4.4.5, nature that is never the same twice (ecology.ts): undergrowth,
    // rocks and the things villages add as they grow, all after the older ids.
    make("reeds", "cover", [0x8a9a4a, 0x7f9042, 0x96a452], { flammable: 0.5, fuel: 1.5 }),
    make("fern", "cover", [0x3f7f34, 0x47893a, 0x37722e], { flammable: 0.5, fuel: 1 }),
    make("berries", "cover", [0x3f7a33, 0x46843a, 0x38702e], { flammable: 0.6, fuel: 3 }),
    make("log", "cover", [0x6a4a2e, 0x5e4228, 0x765234], { flammable: 0.45, fuel: 6 }),
    make("fungi", "cover", [0xe8dcc8, 0xd8352a, 0xc89a5a], { flammable: 0.2, fuel: 0.5 }),
    make("cactus", "cover", [0x4f8a3a, 0x5a9642, 0x467e34], { flammable: 0.15, fuel: 2 }),
    make("scree", "cover", [0x8a8a8e, 0x7e7e84, 0x96969a]),
    make("pebbles", "cover", [0xb0aaa0, 0x9a948a, 0xc4beb4]),
    make("standing stone", "cover", [0x8e8e94, 0x7f7f86, 0x9a9aa2], { solid: true }),
    make("crystals", "cover", [0xb9a4ff, 0xd3c6ff, 0x9f88f5], { glow: true }),
    make("petrified tree", "cover", [0x9a8a7a, 0x8a7a6c, 0xa89888], { solid: true }),
    make("well", "cover", [0x9a9aa0, 0x8a8a90], { solid: true }),
    make("windmill", "cover", [0xe8dcc0, 0xd8ccb0], { flammable: 0.3, fuel: 10, solid: true }),
    make("shrine", "cover", [0xd8d0c0, 0xc8c0b0], { solid: true }),
    make("dock", "cover", [0x8a6a44, 0x7f6140], { flammable: 0.4, fuel: 4 }),
    make("fence", "cover", [0x8a6a44, 0x7f6140], { flammable: 0.5, fuel: 2 }),
  ],
  gas: [
    make("none", "gas", [0]),
    make("smoke", "gas", [0x4a4a4a, 0x555555]),
    make("steam", "gas", [0xe8eef2, 0xf4f7f9]),
    make("poison", "gas", [0x86c34a, 0x97d158], { hurts: 12 }),
  ],
};

// "none" sits at id 0 for fluid, cover and gas. Ground always has something,
// so its id 0 is grass.
export const G = { GRASS: 0, DIRT: 1, SAND: 2, ROCK: 3, SNOW: 4, ASH: 5, BASALT: 6, CRYSTAL: 7, FIELD: 8, PATH: 9 } as const;
export const F = { NONE: 0, WATER: 1, ICE: 2, LAVA: 3, OIL: 4, ACID: 5, MUD: 6 } as const;
export const C = {
  NONE: 0,
  TREE: 1,
  BUSH: 2,
  CROP: 3,
  HOUSE: 4,
  RUBBLE: 5,
  POWDER: 6,
  STUMP: 7,
  FLOWER: 8,
  BOULDER: 9,
  REEDS: 10,
  FERN: 11,
  BERRIES: 12,
  LOG: 13,
  FUNGI: 14,
  CACTUS: 15,
  SCREE: 16,
  PEBBLES: 17,
  STONE: 18,
  CRYSTALS: 19,
  PETRIFIED: 20,
  WELL: 21,
  WINDMILL: 22,
  SHRINE: 23,
  DOCK: 24,
  FENCE: 25,
} as const;
export const S = { NONE: 0, SMOKE: 1, STEAM: 2, POISON: 3 } as const;

// How many built-in materials each layer had before 4.4.5 added its own:
// a save without counts was written with these, and its spell materials
// start right after them.
export const BUILTIN_BEFORE_4_4_5: Record<Layer, number> = { ground: 9, fluid: 7, cover: 10, gas: 4 };

// The full table, built-in first, then whatever spells define.
export class MaterialTable {
  readonly list: Record<Layer, Material[]> = {
    ground: [...BUILTIN.ground],
    fluid: [...BUILTIN.fluid],
    cover: [...BUILTIN.cover],
    gas: [...BUILTIN.gas],
  };

  id(layer: Layer, name: string): number {
    return this.list[layer].findIndex((m) => m.name === name);
  }

  get(layer: Layer, id: number): Material {
    return this.list[layer][id] ?? this.list[layer][0];
  }

  // Adds or replaces a material, keeping its id stable if it already exists.
  define(material: Material): number {
    const existing = this.id(material.layer, material.name);
    if (existing >= 0) {
      this.list[material.layer][existing] = material;
      return existing;
    }
    if (this.list[material.layer].length >= 250) throw new Error("Too many materials in this world");
    this.list[material.layer].push(material);
    return this.list[material.layer].length - 1;
  }

  isBuiltin(layer: Layer, id: number): boolean {
    return id < BUILTIN[layer].length;
  }

  // Any layer: used by spells that just say "lava" or "snow".
  find(name: string): { layer: Layer; id: number } | null {
    for (const layer of LAYERS) {
      const id = this.id(layer, name);
      if (id >= 0 && !(id === 0 && layer !== "ground" && name !== "none")) return { layer, id };
    }
    return null;
  }

  makeMaterial = make;
}
