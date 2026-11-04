import { body, BUILDS, type BodySpec } from "./body";
import { C, F, G } from "./materials";
import { BIOMES, type Biome } from "./land-options";
import { R as RARE } from "./ecology";
import type { Behavior, CreatureKind } from "./creatures";
import type { World } from "./world";

// The island's own animals (3.5), each with a habitat it is born in. Numbers
// are kept up by slow births in the habitat (creatures.ts, lifeCycle), not by
// a food web: wolves catching deer at night must never empty the island.
// Burn the forest and the deer, wolves and boars stop coming back; drain a
// lake and its fish die. The real food web is 3.6.

export interface Species {
  kind: Partial<CreatureKind> & { name: string };
  // Colors individuals are born with (saved as their color).
  colors: number[];
  // Animals per 10,000 cells of island, at least one where the habitat exists.
  density: number;
  habitat(world: World, i: number): boolean;
  // Animals of their region (4.4.5): only on islands made by land.ts, and
  // their number follows their habitat, not the whole island.
  regional?: boolean;
}

const ai = (b: Partial<Behavior>): Behavior => ({
  mode: "wander",
  prey: [],
  leader: [],
  attack: 0,
  sense: 10,
  aura: null,
  auraRadius: 4,
  auraPower: 1,
  leaves: null,
  weak: [],
  immune: [],
  lifespan: 0,
  onDeath: null,
  lures: [],
  scares: [],
  converts: false,
  active: "always",
  ...b,
});

const four = (build: keyof typeof BUILDS, extra: Partial<BodySpec> = {}): BodySpec => body("four legs", [], { build: BUILDS[build], ...extra });

// Dry, not burning, and not inside a tree, a house or a boulder: an animal
// born in a solid cover could not walk out of it.
function dry(world: World, i: number): boolean {
  return world.depth[i] < 0.05 && world.fire[i] < 0.1 && !world.materials.get("cover", world.cover[i]).solid;
}

// Is there a cover of this kind within r cells (sampled, not scanned)?
function near(world: World, i: number, r: number, covers: number[]): boolean {
  const x = i % world.w;
  const y = Math.floor(i / world.w);
  for (let dy = -r; dy <= r; dy += 2)
    for (let dx = -r; dx <= r; dx += 2) {
      const cx = x + dx;
      const cy = y + dy;
      if (cx < 0 || cy < 0 || cx >= world.w || cy >= world.h) continue;
      if (covers.includes(world.cover[cy * world.w + cx])) return true;
    }
  return false;
}

const houseFree = (world: World, i: number, r: number) => !near(world, i, r, [C.HOUSE, C.RUBBLE]);
const grassy = (world: World, i: number) => world.ground[i] === G.GRASS || world.ground[i] === G.FIELD;

export const SPECIES: Species[] = [
  {
    kind: { name: "deer", speed: 4.2, hp: 70, radius: 0.7, color: 0xa0703c, body: four("deer", { color2: 0xe8d8b8, vary: ["antlers"] }) },
    colors: [0xa0703c, 0x8a5a30, 0xb88450],
    density: 2.6,
    habitat: (w, i) => dry(w, i) && grassy(w, i) && near(w, i, 4, [C.TREE]) && houseFree(w, i, 8),
  },
  {
    kind: { name: "rabbit", speed: 4.6, hp: 25, radius: 0.36, color: 0xb8a48c, body: four("rabbit", { color2: 0xf2ece0 }) },
    colors: [0xb8a48c, 0x9a8a78, 0xe8e2d8, 0x7a6a5a],
    density: 3,
    habitat: (w, i) => dry(w, i) && grassy(w, i) && (w.cover[i] === C.NONE || w.cover[i] === C.FLOWER || w.cover[i] === C.BUSH),
  },
  {
    kind: { name: "wolf", speed: 5.4, hp: 90, radius: 0.62, color: 0x7a7a80, body: four("wolf", { color2: 0xc8c8cc }) },
    colors: [0x7a7a80, 0x5a5a60, 0x9a9590, 0x3a3a40],
    density: 1.3,
    habitat: (w, i) => dry(w, i) && near(w, i, 2, [C.TREE]) && houseFree(w, i, 14),
  },
  {
    kind: { name: "boar", speed: 3.8, hp: 140, radius: 0.62, color: 0x5a4636, homebody: true, body: four("boar", { features: ["tusks"] }) },
    colors: [0x5a4636, 0x4a3a2e, 0x6b5442],
    density: 1.3,
    habitat: (w, i) => dry(w, i) && near(w, i, 2, [C.TREE, C.BUSH]) && houseFree(w, i, 10),
  },
  {
    kind: { name: "bear", speed: 3.4, hp: 320, radius: 0.95, color: 0x5b3a24, body: four("bear") },
    colors: [0x5b3a24, 0x3a2a1e, 0x2a2222],
    density: 0.45,
    habitat: (w, i) => dry(w, i) && near(w, i, 4, [C.TREE]) && houseFree(w, i, 18),
  },
  {
    kind: { name: "bird", speed: 5, hp: 15, radius: 0.34, color: 0x3b3b3b, flying: true, altitude: 7, body: body("bird") },
    colors: [0x3b3b3b, 0xc0392b, 0x2e86c1, 0xe6b422, 0x8a6a4a, 0xf2f2f2],
    density: 3,
    habitat: (w, i) => w.cover[i] === C.TREE,
  },
  {
    kind: { name: "fish", speed: 2.4, hp: 20, radius: 0.34, color: 0x8fa3ad, swims: true, aquatic: true, body: body("fish") },
    colors: [0x8fa3ad, 0xe67e22, 0x6c8f3a, 0xc0c8d0],
    density: 3.5,
    habitat: (w, i) => w.fluid[i] === F.WATER && w.depth[i] > 1.2,
  },
];

// The land a cell belongs to, on an island made by land.ts only: the old
// island and the challenges have no regional animals.
function land(w: World, i: number): Biome | null {
  if (!w.land) return null;
  return w.biomeMap ? BIOMES[w.biomeMap[i]] : w.land.biome;
}
const nearFluid = (w: World, i: number, r: number, f: number) => {
  const x = i % w.w;
  const y = Math.floor(i / w.w);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const cx = x + dx;
      const cy = y + dy;
      if (cx >= 0 && cy >= 0 && cx < w.w && cy < w.h && w.fluid[cy * w.w + cx] === f && w.depth[cy * w.w + cx] > 0.05) return true;
    }
  return false;
};
const shallow = (w: World, i: number, max: number) => w.fluid[i] === F.WATER && w.depth[i] > 0.05 && w.depth[i] < max;
const ground = (w: World, i: number, list: number[]) => list.includes(w.ground[i]);

// Animals of their region (4.4.5), each a body from the 3.5 plans, a goal
// (from its behavior, goals.ts) and a place in the food web: what it eats
// (goals.ts, PLANTS and PREY) and what hunts it.
SPECIES.push(
  {
    kind: { name: "camel", speed: 3.6, hp: 160, radius: 0.75, color: 0xc49a62, body: four("camel", { color2: 0xd8b888 }) },
    colors: [0xc49a62, 0xb48a54, 0xd2aa70],
    density: 7,
    regional: true,
    habitat: (w, i) => (land(w, i) === "desert" || land(w, i) === "mesa") && dry(w, i) && ground(w, i, [G.SAND, G.DIRT, G.GRASS]) && houseFree(w, i, 8),
  },
  {
    kind: { name: "lizard", speed: 4.4, hp: 18, radius: 0.34, color: 0x8a9a4a, body: four("lizard", { color2: 0xc8c070 }) },
    colors: [0x8a9a4a, 0xa88a4a, 0x6a8a5a, 0xb86a3a],
    density: 9,
    regional: true,
    habitat: (w, i) => (land(w, i) === "desert" || land(w, i) === "mesa") && dry(w, i) && ground(w, i, [G.SAND, G.ROCK, G.DIRT]),
  },
  {
    kind: { name: "polar bear", speed: 3.6, hp: 340, radius: 1.0, color: 0xeef2f4, body: four("bear", { color2: 0xd8dde0 }) },
    colors: [0xeef2f4, 0xe2e6e0, 0xf6f4ec],
    density: 1.2,
    regional: true,
    habitat: (w, i) => land(w, i) === "tundra" && dry(w, i) && ground(w, i, [G.SNOW, G.ROCK, G.SAND]) && houseFree(w, i, 18),
  },
  {
    kind: { name: "fox", speed: 5.2, hp: 45, radius: 0.45, color: 0xd8742a, body: four("fox", { color2: 0xf4ece0 }) },
    colors: [0xd8742a, 0xe8e4dc, 0xc0622a],
    density: 3.5,
    regional: true,
    habitat: (w, i) => land(w, i) === "tundra" && dry(w, i) && ground(w, i, [G.GRASS, G.SNOW, G.DIRT]) && houseFree(w, i, 10),
  },
  {
    kind: { name: "hare", speed: 5, hp: 28, radius: 0.4, color: 0xe8e8e4, body: four("hare", { color2: 0xffffff }) },
    colors: [0xe8e8e4, 0xb8a890, 0xf4f4f0],
    density: 8,
    regional: true,
    habitat: (w, i) => land(w, i) === "tundra" && dry(w, i) && ground(w, i, [G.GRASS, G.SNOW]),
  },
  {
    kind: { name: "frog", speed: 3, hp: 12, radius: 0.3, color: 0x4f9a3a, swims: true, body: four("frog", { color2: 0xc8d870 }) },
    colors: [0x4f9a3a, 0x3f8a5a, 0x6aaa3a, 0x8a7a3a],
    density: 14,
    regional: true,
    habitat: (w, i) => land(w, i) === "swamp" && w.fire[i] < 0.1 && w.depth[i] < 0.3 && nearFluid(w, i, 2, F.WATER),
  },
  {
    kind: { name: "heron", speed: 3.2, hp: 30, radius: 0.4, color: 0xb8c0c8, swims: true, body: body("bird", [], { build: BUILDS.wader, color2: 0x6a7480 }) },
    colors: [0xb8c0c8, 0xd8dce0, 0x8a94a0],
    density: 4,
    regional: true,
    habitat: (w, i) => land(w, i) === "swamp" && w.fire[i] < 0.1 && (shallow(w, i, 0.5) || w.cover[i] === C.REEDS),
  },
  {
    kind: { name: "monkey", speed: 4.6, hp: 40, radius: 0.4, color: 0x7a5232, body: body("two legs", ["tail"], { build: BUILDS.monkey, color2: 0xc8a07a }) },
    colors: [0x7a5232, 0x5a3a22, 0x9a6a42],
    density: 6,
    regional: true,
    habitat: (w, i) => land(w, i) === "jungle" && dry(w, i) && near(w, i, 2, [C.TREE]) && houseFree(w, i, 8),
  },
  {
    kind: { name: "parrot", speed: 5.2, hp: 15, radius: 0.34, color: 0xd83a2a, flying: true, altitude: 6, body: body("bird", [], { color2: 0x2a6ad8 }) },
    colors: [0xd83a2a, 0x2aa84a, 0x2a6ad8, 0xf2c41a],
    density: 7,
    regional: true,
    habitat: (w, i) => land(w, i) === "jungle" && w.cover[i] === C.TREE,
  },
  {
    kind: { name: "salamander", speed: 3.4, hp: 40, radius: 0.36, color: 0xe8541a, fireproof: true, body: four("lizard", { color2: 0x2a2220 }) },
    colors: [0xe8541a, 0xf07a22, 0xd8401a],
    density: 8,
    regional: true,
    habitat: (w, i) => land(w, i) === "volcanic" && w.depth[i] < 0.05 && ground(w, i, [G.BASALT, G.ASH, G.ROCK]) && !w.materials.get("cover", w.cover[i]).solid,
  },
  {
    kind: { name: "flamingo", speed: 3, hp: 30, radius: 0.4, color: 0xf08aa8, swims: true, body: body("bird", [], { build: BUILDS.wader, color2: 0xe86a90 }) },
    colors: [0xf08aa8, 0xf49ab4, 0xe87a9a],
    density: 30,
    regional: true,
    habitat: (w, i) => !!w.rare && w.rare[i] === RARE.LAGOON && shallow(w, i, 0.9),
  },
);

// Behaviors are set after the list so the food chain reads in one place.
const AI: Record<string, Behavior> = {
  // Deer and rabbits run from people and hunters.
  deer: ai({ mode: "flee", prey: ["villager", "wolf", "bear"], sense: 8 }),
  rabbit: ai({ mode: "flee", prey: ["villager", "wolf", "bear", "boar"], sense: 6 }),
  // Wolves hunt deer and rabbits by night and sleep by day.
  wolf: ai({ mode: "hunt", prey: ["deer", "rabbit"], attack: 25, sense: 14, active: "night" }),
  // Bears hunt by day and scare people, who mob them when they are many.
  bear: ai({ mode: "hunt", prey: ["deer", "boar"], attack: 30, sense: 10, active: "day", scares: ["villager"] }),
  // 4.4.5: grazers keep away from people and hunters; foxes hunt hares by
  // night, polar bears hunt foxes and hares by day, herons take frogs.
  camel: ai({ mode: "flee", prey: ["wolf", "bear"], sense: 5 }),
  lizard: ai({ mode: "flee", prey: ["villager", "fox", "heron", "bird", "wolf"], sense: 4 }),
  hare: ai({ mode: "flee", prey: ["villager", "fox", "polar bear", "wolf"], sense: 7 }),
  frog: ai({ mode: "flee", prey: ["heron", "villager"], sense: 4 }),
  monkey: ai({ mode: "flee", prey: ["villager", "wolf", "bear"], sense: 6 }),
  flamingo: ai({ mode: "flee", prey: ["villager", "wolf", "fox"], sense: 7 }),
  salamander: ai({ mode: "flee", prey: ["villager"], sense: 4, immune: ["fire"] }),
  fox: ai({ mode: "hunt", prey: ["hare", "rabbit", "lizard"], attack: 14, sense: 12, active: "night" }),
  "polar bear": ai({ mode: "hunt", prey: ["hare", "fox", "fish"], attack: 30, sense: 10, active: "day", scares: ["villager"] }),
  heron: ai({ mode: "hunt", prey: ["frog", "fish"], attack: 10, sense: 6 }),
};
for (const s of SPECIES) {
  if (AI[s.kind.name]) s.kind.ai = AI[s.kind.name];
  s.kind.native = true;
  s.kind.tags = s.kind.name === "fish" ? ["animal"] : ["beast", "animal"];
}

export const NATIVE_NAMES = new Set(SPECIES.map((s) => s.kind.name));

// How many of each the island holds. An animal of its region (4.4.5) is
// counted on its habitat: so many per 10,000 cells of it, none without one.
export function targetOf(world: World, s: Species, habitat = -1): number {
  if (!s.regional) return Math.max(1, Math.round((world.n / 10000) * s.density));
  const cells = habitat >= 0 ? habitat : habitatCells(world, s);
  if (cells < 30) return 0;
  return Math.max(2, Math.round((cells / 10000) * s.density));
}

// A regional species' habitat, counted on a coarse grid once a while (a
// fire or a flood changes it: lifeCycle counts again).
const habitatMemo = new WeakMap<World, Map<string, { at: number; cells: number }>>();
export function habitatCells(world: World, s: Species): number {
  let memo = habitatMemo.get(world);
  if (!memo) habitatMemo.set(world, (memo = new Map()));
  const m = memo.get(s.kind.name);
  if (m && world.time - m.at < 20 && world.time >= m.at) return m.cells;
  let count = 0;
  const step = 3;
  for (let y = 1; y < world.h; y += step) for (let x = 1; x < world.w; x += step) if (s.habitat(world, y * world.w + x)) count++;
  const cells = count * step * step;
  memo.set(s.kind.name, { at: world.time, cells });
  return cells;
}

// A random cell of the species' habitat, or -1. Math.random, like every
// other creature choice, so the test run's seeded streams cover it.
export function habitatCell(world: World, s: Species, tries = 60): number {
  for (let k = 0; k < tries; k++) {
    const i = (Math.random() * world.n) | 0;
    if (s.habitat(world, i)) return i;
  }
  return -1;
}
