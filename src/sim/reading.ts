// 4.12 step 4, reading the island: the questions a smart spell asks before it
// acts, answered in one call each (w.here, w.wouldHurt, w.nearest, w.fights in
// runtime.ts). The measure of 12 November (docs/measurements/
// spell-library-2026-11-12.md) found 53.6% of programs act the same wherever
// they are cast and 9% change the island differently on water, in a village
// and on bare rock: w.cell answers one cell, so asking "is this a lake?" took
// a loop the writer seldom wrote. These read only: nothing here changes the
// world or draws a random number, so a stored program that never calls them
// runs exactly as before.
import { hostile, kindOf, maxHp, type Creature } from "./creatures";
import { C, F, G, isBuilding } from "./materials";
import type { World } from "./world";

// What a creature is, for a spell deciding whom to help and whom to hit.
export type Nature = "villager" | "animal" | "undead" | "hostile" | "spirit" | "other";

const UNDEAD = /zombie|skeleton|ghoul|lich|vampire|mummy|undead|wraith|revenant|risen|ghost|spectre|specter|banshee|bone/i;

export function natureOf(c: Creature): Nature {
  const k = kindOf(c);
  const name = c.kind.split("#")[0];
  if (name === "villager") return "villager";
  if (k.tags.includes("undead") || UNDEAD.test(name)) return "undead";
  if (hostile(c)) return "hostile";
  if (k.native) return "animal";
  if (name === "spirit" || k.body.plan === "spirit") return "spirit";
  return "other";
}

export interface Here {
  // The commonest ground, cover and fluid in reach ("none" when there is none).
  ground: string;
  cover: string;
  fluid: string;
  // Mean height of the land, in voxels.
  height: number;
  // Shares of the cells in reach, 0 to 1.
  water: number;
  ice: number;
  lava: number;
  fire: number;
  snow: number;
  trees: number;
  rock: number;
  // Cells that hold a house or another building.
  houses: number;
  // A village stands in reach (its center, or any of its houses).
  village: boolean;
  // The living creatures in reach, by what they are.
  villagers: Creature[];
  animals: Creature[];
  undead: Creature[];
  hostile: Creature[];
  spirits: Creature[];
  // Anyone in reach below full health, and the dead lying there.
  wounded: Creature[];
  dead: number;
}

// Every cell in reach once on small areas; a grid of about 4000 on large ones.
function sample(world: World, x: number, y: number, r: number, fn: (i: number) => void): number {
  const step = Math.max(1, Math.ceil(r / 32));
  const r2 = r * r;
  let n = 0;
  const x0 = Math.max(0, Math.ceil(x - r));
  const x1 = Math.min(world.w - 1, Math.floor(x + r));
  const y0 = Math.max(0, Math.ceil(y - r));
  const y1 = Math.min(world.h - 1, Math.floor(y + r));
  for (let cy = y0; cy <= y1; cy += step)
    for (let cx = x0; cx <= x1; cx += step) {
      if ((cx - x) * (cx - x) + (cy - y) * (cy - y) > r2) continue;
      fn(cy * world.w + cx);
      n++;
    }
  if (!n) {
    fn(Math.max(0, Math.min(world.h - 1, Math.round(y))) * world.w + Math.max(0, Math.min(world.w - 1, Math.round(x))));
    n = 1;
  }
  return n;
}

function commonest(counts: Map<number, number>): number {
  let best = -1;
  let most = 0;
  for (const [id, n] of counts) if (n > most) [best, most] = [id, n];
  return best;
}

export function readHere(world: World, x: number, y: number, r: number): Here {
  const ground = new Map<number, number>();
  const cover = new Map<number, number>();
  const fluid = new Map<number, number>();
  let height = 0;
  let water = 0;
  let ice = 0;
  let lava = 0;
  let fire = 0;
  let snow = 0;
  let trees = 0;
  let rock = 0;
  let houses = 0;
  const n = sample(world, x, y, r, (i) => {
    const g = world.ground[i];
    const c = world.cover[i];
    const f = world.depth[i] > 0.05 ? world.fluid[i] : F.NONE;
    ground.set(g, (ground.get(g) ?? 0) + 1);
    if (c !== C.NONE) cover.set(c, (cover.get(c) ?? 0) + 1);
    if (f !== F.NONE) fluid.set(f, (fluid.get(f) ?? 0) + 1);
    height += world.height[i];
    if (f === F.WATER) water++;
    else if (f === F.ICE) ice++;
    else if (f === F.LAVA) lava++;
    if (world.fire[i] > 0) fire++;
    if (g === G.SNOW) snow++;
    if (g === G.ROCK || g === G.BASALT) rock++;
    if (c === C.TREE) trees++;
    if (isBuilding(c)) houses++;
  });
  const step = Math.max(1, Math.ceil(r / 32));
  const out: Here = {
    ground: world.layerName("ground", Math.max(0, commonest(ground))),
    cover: cover.size ? world.layerName("cover", commonest(cover)) : "none",
    fluid: fluid.size ? world.layerName("fluid", commonest(fluid)) : "none",
    height: height / n,
    water: water / n,
    ice: ice / n,
    lava: lava / n,
    fire: fire / n,
    snow: snow / n,
    trees: trees / n,
    rock: rock / n,
    houses: houses * step * step,
    village: houses > 0 || world.villages.some((v) => Math.hypot(v.x - x, v.y - y) <= r),
    villagers: [],
    animals: [],
    undead: [],
    hostile: [],
    spirits: [],
    wounded: [],
    dead: 0,
  };
  for (const c of world.creatures) {
    if (Math.hypot(c.x - x, c.y - y) > r) continue;
    if (c.dead) {
      out.dead++;
      continue;
    }
    const nature = natureOf(c);
    if (nature === "villager") out.villagers.push(c);
    else if (nature === "animal") out.animals.push(c);
    else if (nature === "undead") out.undead.push(c);
    else if (nature === "hostile") out.hostile.push(c);
    else if (nature === "spirit") out.spirits.push(c);
    if (c.hp < maxHp(c) - 0.5) out.wounded.push(c);
  }
  return out;
}

export interface Hurt {
  houses: number;
  villagers: number;
  crops: number;
  trees: number;
  animals: number;
  // Nothing of the island's people would be hurt: no house, field or villager.
  safe: boolean;
}

// What a blow over (x, y, r) would hurt of the island's own life.
export function readHurt(world: World, x: number, y: number, r: number): Hurt {
  let houses = 0;
  let crops = 0;
  let trees = 0;
  const step = Math.max(1, Math.ceil(r / 32));
  sample(world, x, y, r, (i) => {
    const c = world.cover[i];
    if (isBuilding(c) || c === C.WELL || c === C.WINDMILL || c === C.SHRINE || c === C.DOCK) houses++;
    else if (c === C.CROP || world.ground[i] === G.FIELD) crops++;
    else if (c === C.TREE) trees++;
  });
  let villagers = 0;
  let animals = 0;
  for (const c of world.creatures) {
    if (c.dead || Math.hypot(c.x - x, c.y - y) > r) continue;
    const nature = natureOf(c);
    if (nature === "villager") villagers++;
    else if (nature === "animal") animals++;
  }
  const s = step * step;
  return { houses: houses * s, villagers, crops: crops * s, trees: trees * s, animals, safe: houses === 0 && crops === 0 && villagers === 0 };
}

// The nearest cell or creature that is `what`, within max cells: a village,
// house, water, ice, lava, fire, tree, field, snow, rock, any material by
// name, a creature kind, or a nature (villager, animal, undead, hostile, spirit).
export function findNearest(world: World, what: string, x: number, y: number, max: number): { x: number; y: number; d: number; creature?: Creature } | null {
  const name = String(what).toLowerCase().trim();
  if (name === "village") {
    let best: { x: number; y: number; d: number } | null = null;
    for (const v of world.villages) {
      const d = Math.hypot(v.x - x, v.y - y);
      if (d <= max && (!best || d < best.d)) best = { x: v.x, y: v.y, d };
    }
    if (best) return best;
    return findNearest(world, "house", x, y, max);
  }
  const natures: string[] = ["villager", "animal", "undead", "hostile", "spirit", "creature"];
  const asCreature = natures.includes(name) || world.creatures.some((c) => c.kind.split("#")[0] === name);
  const test = cellTest(world, name);
  if (asCreature && !test) {
    let best: { x: number; y: number; d: number; creature?: Creature } | null = null;
    for (const c of world.creatures) {
      if (c.dead) continue;
      const ok = name === "creature" || c.kind.split("#")[0] === name || natureOf(c) === name;
      if (!ok) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d <= max && (!best || d < best.d)) best = { x: c.x, y: c.y, d, creature: c };
    }
    return best;
  }
  if (!test) return null;
  // Rings outward from the spot: the first ring that holds one has the nearest.
  const cx = Math.round(x);
  const cy = Math.round(y);
  const lim = Math.min(Math.ceil(max), Math.max(world.w, world.h));
  for (let r = 0; r <= lim; r++) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let dy = -r; dy <= r; dy++) {
      const span = Math.abs(dy) === r ? 1 : r * 2;
      for (let dx = -r; dx <= r; dx += span) {
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || py < 0 || px >= world.w || py >= world.h) continue;
        if (!test(py * world.w + px)) continue;
        const d = Math.hypot(px - x, py - y);
        if (d <= max && (!best || d < best.d)) best = { x: px, y: py, d };
      }
    }
    if (best) return best;
  }
  return null;
}

function cellTest(world: World, name: string): ((i: number) => boolean) | null {
  const wet = (i: number) => world.depth[i] > 0.05;
  switch (name) {
    case "water":
      return (i) => world.fluid[i] === F.WATER && wet(i);
    case "ice":
      return (i) => world.fluid[i] === F.ICE && wet(i);
    case "lava":
      return (i) => world.fluid[i] === F.LAVA && wet(i);
    case "fire":
      return (i) => world.fire[i] > 0;
    case "tree":
    case "forest":
      return (i) => world.cover[i] === C.TREE;
    case "house":
    case "building":
      return (i) => isBuilding(world.cover[i]);
    case "field":
    case "crop":
      return (i) => world.cover[i] === C.CROP || world.ground[i] === G.FIELD;
    case "snow":
      return (i) => world.ground[i] === G.SNOW;
    case "rock":
      return (i) => world.ground[i] === G.ROCK || world.ground[i] === G.BASALT;
    case "land":
      return (i) => !wet(i) || world.fluid[i] === F.NONE;
  }
  const m = world.materials.find(name);
  if (!m) return null;
  if (m.layer === "ground") return (i) => world.ground[i] === m.id;
  if (m.layer === "cover") return (i) => world.cover[i] === m.id;
  if (m.layer === "fluid") return (i) => world.fluid[i] === m.id && wet(i);
  return (i) => world.gas[i] === m.id;
}

// Who is fighting whom in reach: each hunter or guard with a live target close
// enough to strike or chasing it, and that target.
export function readFights(world: World, x: number, y: number, r: number): { attacker: Creature; target: Creature }[] {
  const out: { attacker: Creature; target: Creature }[] = [];
  for (const c of world.creatures) {
    if (c.dead || Math.hypot(c.x - x, c.y - y) > r) continue;
    const ai = kindOf(c).ai;
    const t = c.data.target as Creature | undefined;
    if (!ai || (ai.mode !== "hunt" && ai.mode !== "guard") || !(ai.attack > 0) || !t || t.dead) continue;
    if (Math.hypot(t.x - c.x, t.y - c.y) > ai.sense * 1.5) continue;
    out.push({ attacker: c, target: t });
  }
  return out;
}
