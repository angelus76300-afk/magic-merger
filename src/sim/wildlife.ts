import { body, BUILDS, type BodySpec } from "./body";
import { C, F, G } from "./materials";
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

// Behaviors are set after the list so the food chain reads in one place.
const AI: Record<string, Behavior> = {
  // Deer and rabbits run from people and hunters.
  deer: ai({ mode: "flee", prey: ["villager", "wolf", "bear"], sense: 8 }),
  rabbit: ai({ mode: "flee", prey: ["villager", "wolf", "bear", "boar"], sense: 6 }),
  // Wolves hunt deer and rabbits by night and sleep by day.
  wolf: ai({ mode: "hunt", prey: ["deer", "rabbit"], attack: 25, sense: 14, active: "night" }),
  // Bears hunt by day and scare people, who mob them when they are many.
  bear: ai({ mode: "hunt", prey: ["deer", "boar"], attack: 30, sense: 10, active: "day", scares: ["villager"] }),
};
for (const s of SPECIES) {
  if (AI[s.kind.name]) s.kind.ai = AI[s.kind.name];
  s.kind.native = true;
  s.kind.tags = s.kind.name === "fish" ? ["animal"] : ["beast", "animal"];
}

export const NATIVE_NAMES = new Set(SPECIES.map((s) => s.kind.name));

// How many of each the island holds.
export function targetOf(world: World, s: Species): number {
  return Math.max(1, Math.round((world.n / 10000) * s.density));
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
