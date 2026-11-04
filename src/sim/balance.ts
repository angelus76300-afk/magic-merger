import { C, F, G } from "./materials";
import { sprout } from "./ecology";
import { PLANTS, PREY, sendTo } from "./goals";
import { SPECIES, habitatCell, habitatCells, targetOf, type Species } from "./wildlife";
import type { Creature } from "./creatures";
import type { World } from "./world";

// Spawns that keep an island alive (4.4.5, on islands with flora; the old
// island and the challenges keep the slow births of 3.5 to the bit).
//
// 1. Births follow food: a grazer's number is held under what the plants
//    of its habitat feed, a hunter's under what its prey feeds, so after a
//    fire the grazers come back first and the hunters after them.
// 2. Never empty: a species under a quarter of its number while its habitat
//    lasts gets arrivals from the island's edge, a pair walking in (birds fly
//    in); fish come with the water as before.
// 3. Never overrun: past twice its number a species stops being born and one
//    by one walks out over the edge.
// 4. Refuges: births fall back to the patch kept for the species
//    (ecology.ts) when the rest of its habitat is gone, and the refuge's
//    plants grow back first.

// Food cells one animal needs, and prey one hunter needs.
const FOOD_PER_GRAZER = 30;
const PREY_PER_HUNTER = 3;

export interface WildTarget {
  // How many the island holds now, and how many its land alone would hold.
  target: number;
  base: number;
  habitat: number;
}

const memo = new WeakMap<World, { at: number; targets: Map<string, WildTarget> }>();

export function wildTargets(world: World, alive: Map<string, number>): Map<string, WildTarget> {
  const m = memo.get(world);
  if (m && world.time - m.at < 10 && world.time >= m.at) return m.targets;
  const targets = new Map<string, WildTarget>();
  for (const s of SPECIES) {
    if (world.wild && !world.wild.includes(s.kind.name)) continue;
    const habitat = s.regional ? habitatCells(world, s) : 1;
    let base = targetOf(world, s, s.regional ? habitat : -1);
    // A refuge keeps a pair's place even when the rest is gone.
    if (s.regional && base === 0 && world.refuges.some((r) => r.kind === s.kind.name)) base = 2;
    let target = base;
    const prey = PREY[s.kind.name];
    const plants = PLANTS[s.kind.name];
    if (prey) {
      let food = 0;
      for (const p of prey) food += alive.get(p) ?? 0;
      target = Math.min(base, Math.floor(food / PREY_PER_HUNTER));
    } else if (plants && !s.kind.flying && !s.kind.aquatic) {
      target = Math.min(base, Math.floor(foodCells(world, s, plants) / FOOD_PER_GRAZER));
    }
    targets.set(s.kind.name, { target, base, habitat });
  }
  memo.set(world, { at: world.time, targets });
  return targets;
}

// Cells of food for a grazer within its habitat's reach (sampled): its
// plants, and the grass it makes do with.
function foodCells(world: World, s: Species, plants: number[]): number {
  const step = 3;
  let n = 0;
  for (let y = 1; y < world.h; y += step)
    for (let x = 1; x < world.w; x += step) {
      const i = y * world.w + x;
      const c = world.cover[i];
      if (
        plants.includes(c) ||
        (c === C.NONE && world.ground[i] === G.GRASS) ||
        (s.kind.swims && world.fluid[i] === F.WATER && world.depth[i] < 0.9 && s.habitat(world, i))
      )
        n++;
    }
  return n * step * step;
}

// Once every few seconds from lifeCycle, on an island with flora.
export function keepBalance(world: World, make: (kind: string, x: number, y: number) => Creature): void {
  const alive = new Map<string, number>();
  for (const c of world.creatures) if (!c.dead && !c.data.leaving) alive.set(c.kind, (alive.get(c.kind) ?? 0) + 1);
  const targets = wildTargets(world, alive);
  let worst: Species | null = null;
  let worstShare = 1;
  for (const s of SPECIES) {
    const t = targets.get(s.kind.name);
    if (!t) continue;
    const n = alive.get(s.kind.name) ?? 0;
    // Too many: one walks out, and none is born.
    if (n > Math.max(2, t.target * 2)) {
      leave(world, s.kind.name);
      continue;
    }
    if (t.target <= 0) continue;
    // Fish breed on their own (goals.ts, migrate): restocked only once gone.
    if (s.kind.aquatic && n > 0) continue;
    const share = n / t.target;
    if (share < worstShare) {
      worstShare = share;
      worst = s;
    }
  }
  if (worst && world.creatures.length < 500) {
    if (worstShare < 0.25 && !worst.kind.aquatic) arrive(world, worst, make);
    else born(world, worst, make);
  }
  tendRefuges(world);
}

// One born in its habitat, or in its refuge when the habitat is gone.
function born(world: World, s: Species, make: (kind: string, x: number, y: number) => Creature): boolean {
  let i = habitatCell(world, s);
  if (i < 0) i = refugeCell(world, s.kind.name);
  if (i < 0) return false;
  const c = make(s.kind.name, (i % world.w) + (Math.random() - 0.5) * 0.6, Math.floor(i / world.w) + (Math.random() - 0.5) * 0.6);
  c.homeX = c.x;
  c.homeY = c.y;
  world.creatures.push(c);
  return true;
}

function refugeCell(world: World, kind: string): number {
  const list = world.refuges.filter((r) => r.kind === kind);
  if (!list.length) return -1;
  const r = list[(Math.random() * list.length) | 0];
  for (let t = 0; t < 12; t++) {
    const x = Math.round(r.x + (Math.random() - 0.5) * 2 * r.r);
    const y = Math.round(r.y + (Math.random() - 0.5) * 2 * r.r);
    if (!world.inside(x, y)) continue;
    const i = y * world.w + x;
    if (
      world.fire[i] < 0.1 &&
      world.fluid[i] !== F.LAVA &&
      !world.materials.get("cover", world.cover[i]).solid &&
      world.depth[i] < 0.05 !== (SPECIES.find((s) => s.kind.name === kind)?.kind.aquatic === true)
    )
      return i;
  }
  return -1;
}

// A pair arrives from the island's edge nearest to its habitat and makes
// for it: walking in over dry land, or flying in.
function arrive(world: World, s: Species, make: (kind: string, x: number, y: number) => Creature): void {
  let goal = habitatCell(world, s);
  if (goal < 0) goal = refugeCell(world, s.kind.name);
  if (goal < 0) return;
  const gx = goal % world.w;
  const gy = Math.floor(goal / world.w);
  const from = s.kind.flying ? edgeNear(world, gx, gy) : landNearEdge(world, gx, gy);
  if (!from) {
    born(world, s, make);
    return;
  }
  for (let n = 0; n < 2; n++) {
    const c = make(s.kind.name, from.x + (Math.random() - 0.5), from.y + (Math.random() - 0.5));
    c.homeX = gx;
    c.homeY = gy;
    c.data.arriving = true;
    world.creatures.push(c);
    sendTo(c, gx + (Math.random() - 0.5) * 2, gy + (Math.random() - 0.5) * 2);
  }
}

// The point of the island's edge nearest to (x, y).
function edgeNear(world: World, x: number, y: number): { x: number; y: number } {
  const d = [x, world.w - 1 - x, y, world.h - 1 - y];
  const k = d.indexOf(Math.min(...d));
  if (k === 0) return { x: 1, y };
  if (k === 1) return { x: world.w - 2, y };
  if (k === 2) return { x, y: 1 };
  return { x, y: world.h - 2 };
}

// Dry land as near the edge as there is, on the side nearest to (x, y):
// walking from the edge inward until the water ends.
function landNearEdge(world: World, x: number, y: number): { x: number; y: number } | null {
  const e = edgeNear(world, x, y);
  const steps = Math.max(Math.abs(x - e.x), Math.abs(y - e.y));
  for (let t = 0; t <= steps; t++) {
    const px = Math.round(e.x + ((x - e.x) * t) / Math.max(1, steps));
    const py = Math.round(e.y + ((y - e.y) * t) / Math.max(1, steps));
    const i = py * world.w + px;
    if (world.depth[i] < 0.05 && world.fire[i] < 0.1 && !world.materials.get("cover", world.cover[i]).solid) return { x: px, y: py };
  }
  return null;
}

// One of an overrun species turns for the edge; it leaves the island there.
function leave(world: World, kind: string): void {
  for (const c of world.creatures) {
    if (c.kind !== kind || c.dead || c.data.leaving || c.mind?.tame) continue;
    c.data.leaving = true;
    const e = edgeNear(world, c.x, c.y);
    c.homeX = e.x;
    c.homeY = e.y;
    sendTo(c, e.x, e.y);
    return;
  }
}

// Every couple of seconds: those walking out keep walking, and go once at
// the edge; those arriving settle once there.
export function stepMovers(world: World): void {
  for (let k = world.creatures.length - 1; k >= 0; k--) {
    const c = world.creatures[k];
    if (c.dead) continue;
    if (c.data.leaving) {
      if (c.x < 2.5 || c.y < 2.5 || c.x > world.w - 3.5 || c.y > world.h - 3.5) world.creatures.splice(k, 1);
      else sendTo(c, c.homeX, c.homeY);
    } else if (c.data.arriving) {
      if (Math.hypot(c.x - c.homeX, c.y - c.homeY) < 4) c.data.arriving = false;
      else sendTo(c, c.homeX, c.homeY);
    }
  }
}

// A refuge's plants grow back first: a few of its cells each time.
function tendRefuges(world: World): void {
  if (!world.flora) return;
  for (const r of world.refuges) {
    for (let t = 0; t < 2; t++) {
      const x = Math.round(r.x + (Math.random() - 0.5) * 2 * r.r);
      const y = Math.round(r.y + (Math.random() - 0.5) * 2 * r.r);
      if (!world.inside(x, y)) continue;
      const i = y * world.w + x;
      if (world.depth[i] > 0.02 || world.fire[i] > 0) continue;
      const g = world.ground[i];
      if (g === G.ASH) world.ground[i] = G.DIRT;
      else if (g === G.DIRT && world.cover[i] === C.NONE) world.ground[i] = G.GRASS;
      else if (g === G.GRASS && world.cover[i] === C.NONE && Math.random() < 0.3)
        world.setCover(i, world.flora[i] & 128 ? C.TREE : sprout(world, i, Math.random()));
      else if (world.cover[i] === C.STUMP) world.setCover(i, C.TREE);
    }
  }
}
