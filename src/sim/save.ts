import { loadedState } from "./artifacts";
import { dressVillages, restoreCreature, saveMind, KINDS, type Creature, type SavedMind } from "./creatures";
import { MARKS, MAX_MARKS, MAX_STORY, type Mark, type StoryLine, type Village } from "./kin";
import { BUILTIN, LAYERS, type Layer } from "./materials";
import { World } from "./world";
import type { Landmark } from "./social";
import { packLook, unpackLook } from "./villagers";

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
  creatures: (Partial<Creature> & { m?: SavedMind })[];
  // Villages' stores and the marks goals left (3.6).
  villages?: { x: number; y: number; food: number; wood: number; gold: number }[];
  marks?: Mark[];
  // Free standing voxels as [key, color] pairs.
  decor?: [number, number][];
  landmarks?: Landmark[];
  wealth?: number;
  // The island's story (3.7).
  story?: StoryLine[];
  storyCounts?: Record<string, number>;
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
    decor: [...world.decor.entries()],
    landmarks: world.landmarks,
    wealth: world.wealth,
    creatures: world.creatures
      .filter((c) => !c.dead)
      .slice(0, 400)
      .map((c) => {
        const { kind, x, y, hp, size, color, homeX, homeY, look } = c;
        return { kind, x, y, hp, size, color, homeX, homeY, look, m: saveMind(c) };
      }),
    villages: world.villages.map(({ x, y, food, wood, gold }) => ({ x, y, food: Math.round(food * 10) / 10, wood, gold })),
    marks: world.marks,
    story: world.story,
    storyCounts: world.storyCounts,
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
  for (const [key, color] of data.decor ?? []) {
    if (world.decor.size >= World.MAX_DECOR) break;
    world.decor.set(key >>> 0, color % 0x8000000);
  }
  world.decorVersion++;
  world.landmarks = Array.isArray(data.landmarks)
    ? data.landmarks
        .filter((l) => l && typeof l.x === "number" && typeof l.y === "number" && Array.isArray(l.lures) && Array.isArray(l.scares))
        .slice(0, 60)
        .map((l) => {
          // An artifact's state (3.7), checked; one that does not read is a plain landmark.
          const raw = (l as { art?: unknown }).art;
          if (raw === undefined) return l;
          const art = loadedState(raw);
          return art ? { ...l, art } : { ...l, art: undefined };
        })
    : [];
  world.wealth = typeof data.wealth === "number" && Number.isFinite(data.wealth) ? data.wealth : 0;
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  world.villages = (Array.isArray(data.villages) ? data.villages : [])
    .filter((v) => v && [v.x, v.y, v.food, v.wood, v.gold].every(finite))
    .slice(0, 16)
    .map((v): Village => ({ x: v.x, y: v.y, food: Math.max(0, v.food), wood: Math.max(0, v.wood), gold: Math.max(0, v.gold), people: 0, houses: 0 }));
  world.story = (Array.isArray(data.story) ? data.story : [])
    .filter((l) => l && typeof l.text === "string" && finite(l.t) && finite(l.n))
    .slice(-MAX_STORY)
    .map((l) => ({ t: l.t, text: l.text.slice(0, 120), n: l.n }));
  world.storyCounts = {};
  for (const [k, v] of Object.entries(data.storyCounts && typeof data.storyCounts === "object" ? data.storyCounts : {}).slice(0, 60))
    if (typeof v === "number" && Number.isFinite(v)) world.storyCounts[k.slice(0, 60)] = v;
  world.marks = (Array.isArray(data.marks) ? data.marks : [])
    .filter((m) => m && (MARKS as readonly string[]).includes(m.kind) && finite(m.x) && finite(m.y) && finite(m.size))
    .slice(0, MAX_MARKS)
    .map((m) => ({ kind: m.kind, x: m.x, y: m.y, size: m.size, by: String(m.by ?? "").slice(0, 40) }));
  // Villagers saved before 3.5 have no look: they get one, in their village's clothes.
  const undressed: Creature[] = [];
  for (const raw of data.creatures ?? []) {
    if (raw.kind && !KINDS.has(raw.kind)) raw.kind = "beast";
    const c = restoreCreature(raw);
    if (!c) continue;
    world.creatures.push(c);
    if (c.kind === "villager" && typeof raw.look !== "number") {
      // Grown up already: their saved size is an adult's.
      c.look = packLook({ ...unpackLook(c.look), age: "adult" });
      undressed.push(c);
    }
  }
  dressVillages(world, undressed);
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
