import type { MaterialName } from "../../shared/spell";

// Material ids, stored one byte per cell. The order is free, but the names must
// match the material list Claude is given in shared/spell.ts.
export const M = {
  EMPTY: 0,
  STONE: 1,
  DIRT: 2,
  GRASS: 3,
  SAND: 4,
  GRAVEL: 5,
  WATER: 6,
  ICE: 7,
  LAVA: 8,
  STEAM: 9,
  SMOKE: 10,
  FIRE: 11,
  WOOD: 12,
  LEAVES: 13,
  ASH: 14,
  CRYSTAL: 15,
} as const;

// How a material moves.
export const STATIC = 0;
export const POWDER = 1;
export const LIQUID = 2;
export const GAS = 3;
export const FLAME = 4;
export const NOTHING = 5;

export interface MaterialInfo {
  name: MaterialName | "empty";
  behavior: number;
  // Packed 0xRRGGBB variations, picked per cell for texture.
  colors: number[];
  // Chance per tick to catch fire next to a flame.
  flammable: number;
  // Ticks a fire lasts once this material burns.
  burnTicks: number;
  // Creatures can stand on it and cannot walk through it.
  solid: boolean;
  glows: boolean;
}

const info = (
  name: MaterialInfo["name"],
  behavior: number,
  colors: number[],
  extra: Partial<MaterialInfo> = {},
): MaterialInfo => ({ name, behavior, colors, flammable: 0, burnTicks: 0, solid: false, glows: false, ...extra });

export const MATERIALS: MaterialInfo[] = [];
MATERIALS[M.EMPTY] = info("empty", NOTHING, [0]);
MATERIALS[M.STONE] = info("stone", STATIC, [0x6b6b75, 0x75757f, 0x62626b, 0x70707a], { solid: true });
MATERIALS[M.DIRT] = info("dirt", STATIC, [0x7a5232, 0x6e4a2c, 0x845a37], { solid: true });
MATERIALS[M.GRASS] = info("grass", STATIC, [0x4caf50, 0x43a047, 0x5cbf60], { solid: true, flammable: 0.25, burnTicks: 25 });
MATERIALS[M.SAND] = info("sand", POWDER, [0xe0c27a, 0xd8b86e, 0xe8cc88], { solid: true });
MATERIALS[M.GRAVEL] = info("gravel", POWDER, [0x8a7f72, 0x7a7065, 0x968b7d], { solid: true });
MATERIALS[M.WATER] = info("water", LIQUID, [0x2f7fd6, 0x3a8be0, 0x2a76c9]);
MATERIALS[M.ICE] = info("ice", STATIC, [0xbfe6ff, 0xa8dcf7, 0xd2eeff], { solid: true });
MATERIALS[M.LAVA] = info("lava", LIQUID, [0xff5a1f, 0xff7a1a, 0xe04010], { glows: true });
MATERIALS[M.STEAM] = info("steam", GAS, [0xd8e2ea, 0xc8d4de, 0xe6edf2]);
MATERIALS[M.SMOKE] = info("smoke", GAS, [0x555560, 0x4a4a52, 0x606068]);
MATERIALS[M.FIRE] = info("fire", FLAME, [0xffb000, 0xff6a00, 0xffd34d, 0xff8c1a], { glows: true });
MATERIALS[M.WOOD] = info("wood", STATIC, [0x6d4527, 0x5e3b20, 0x75492a], { solid: true, flammable: 0.04, burnTicks: 120 });
MATERIALS[M.LEAVES] = info("leaves", STATIC, [0x2e7d32, 0x388e3c, 0x1b5e20], { flammable: 0.3, burnTicks: 20 });
MATERIALS[M.ASH] = info("ash", POWDER, [0x9e9e9e, 0x8a8a8a, 0xa8a8a8], { solid: true });
MATERIALS[M.CRYSTAL] = info("crystal", STATIC, [0xb48cff, 0x9d6bff, 0xd4b8ff], { solid: true, glows: true });

export function materialByName(name: MaterialName): number {
  if (name === "none") return M.EMPTY;
  const id = MATERIALS.findIndex((m) => m.name === name);
  return id < 0 ? M.EMPTY : id;
}
