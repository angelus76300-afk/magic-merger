import { restoreCreature, KINDS, type Creature } from "./creatures";
import { BUILTIN, LAYERS, type Layer } from "./materials";
import { World } from "./world";

// A saved world, compact enough for localStorage: each layer is quantized
// into bytes and base64 encoded. Materials and creatures that spells defined
// are saved by name, with the spell that owns them, so the game can reload
// that spell's rules before the world comes back.
export interface SavedWorld {
  version: 2;
  w: number;
  h: number;
  seed: number;
  time: number;
  layers: Record<string, string>;
  custom: Record<Layer, string[]>;
  owners: Record<string, string>;
  creatures: Partial<Creature>[];
}

export function saveWorld(world: World, owners: Map<string, string>): SavedWorld {
  const n = world.n;
  const u8 = (f: (i: number) => number) => {
    const a = new Uint8Array(n);
    for (let i = 0; i < n; i++) a[i] = f(i);
    return toBase64(a);
  };
  const u16 = (f: (i: number) => number) => {
    const a = new Uint16Array(n);
    for (let i = 0; i < n; i++) a[i] = f(i);
    return toBase64(new Uint8Array(a.buffer));
  };
  const custom = {} as Record<Layer, string[]>;
  for (const layer of LAYERS) custom[layer] = world.materials.list[layer].slice(BUILTIN[layer].length).map((m) => m.name);
  return {
    version: 2,
    w: world.w,
    h: world.h,
    seed: world.seed,
    time: world.time,
    layers: {
      height: u16((i) => clamp16((world.height[i] + 100) * 100)),
      ground: u8((i) => world.ground[i]),
      fluid: u8((i) => world.fluid[i]),
      depth: u16((i) => clamp16(world.depth[i] * 1000)),
      cover: u8((i) => world.cover[i]),
      coverHp: u8((i) => Math.min(255, world.coverHp[i] * 4)),
      temp: u16((i) => clamp16((world.temp[i] + 200) * 20)),
      gas: u8((i) => world.gas[i]),
      gasAmt: u8((i) => Math.min(255, world.gasAmt[i] * 255)),
    },
    custom,
    owners: Object.fromEntries(owners),
    creatures: world.creatures
      .filter((c) => !c.dead)
      .slice(0, 400)
      .map(({ kind, x, y, hp, size, color, homeX, homeY }) => ({ kind, x, y, hp, size, color, homeX, homeY })),
  };
}

// Rebuilds a world. Custom materials missing from the table (their spell is
// gone) fall back to plain ground or nothing.
export function loadWorld(data: SavedWorld, prepare: (world: World) => void): World | null {
  if (data?.version !== 2) return null;
  const world = new World(data.w, data.h, data.seed);
  prepare(world);
  world.time = data.time ?? 0;
  const n = world.n;
  const bytes = (key: string) => {
    const b = fromBase64(data.layers[key] ?? "");
    return b.length >= n ? b : null;
  };
  const words = (key: string) => {
    const b = fromBase64(data.layers[key] ?? "");
    return b.length >= n * 2 ? new Uint16Array(b.buffer, b.byteOffset, n) : null;
  };
  const height = words("height");
  const depth = words("depth");
  const temp = words("temp");
  if (!height) return null;
  // Saved custom ids map onto the current table by name.
  const remap = {} as Record<Layer, (id: number) => number>;
  for (const layer of LAYERS) {
    const names = data.custom?.[layer] ?? [];
    const base = BUILTIN[layer].length;
    remap[layer] = (id) => {
      if (id < base) return id;
      const name = names[id - base];
      const now = name ? world.materials.id(layer, name) : -1;
      if (now >= 0) return now;
      return layer === "ground" ? 1 : 0;
    };
  }
  const ground = bytes("ground");
  const fluid = bytes("fluid");
  const cover = bytes("cover");
  const coverHp = bytes("coverHp");
  const gas = bytes("gas");
  const gasAmt = bytes("gasAmt");
  for (let i = 0; i < n; i++) {
    world.height[i] = height[i] / 100 - 100;
    if (ground) world.ground[i] = remap.ground(ground[i]);
    if (fluid) world.fluid[i] = remap.fluid(fluid[i]);
    if (depth) world.depth[i] = depth[i] / 1000;
    if (cover) world.cover[i] = remap.cover(cover[i]);
    if (coverHp) world.coverHp[i] = coverHp[i] / 4;
    if (temp) world.temp[i] = temp[i] / 20 - 200;
    if (gas) world.gas[i] = remap.gas(gas[i]);
    if (gasAmt) world.gasAmt[i] = gasAmt[i] / 255;
    if (world.fluid[i] === 0) world.depth[i] = 0;
  }
  for (const raw of data.creatures ?? []) {
    if (raw.kind && !KINDS.has(raw.kind)) raw.kind = "beast";
    const c = restoreCreature(raw);
    if (c) world.creatures.push(c);
  }
  return world;
}

function clamp16(v: number): number {
  return Math.max(0, Math.min(65535, Math.round(v)));
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}
