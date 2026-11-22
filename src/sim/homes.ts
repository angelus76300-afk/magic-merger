import { C, F } from "./materials";
import type { Creature } from "./creatures";
import type { World } from "./world";

// Homes (22 November, the owner after letting an island run: "sleeping is them not moving. Its
// just weird"; then "Inside their house, window lit"). A villager's home is a point by its door
// (populate puts it below the house); its house is the nearest house cell to that point. At night
// it walks to the door and goes in: it is not drawn (c.data.indoors holds the house cell) and the
// house's window glows while anyone sleeps inside. At day, or when its house burns, floods or
// falls, it comes out of the door. One with no house sleeps lying down by a building of its
// village (c.data.rough). Neither is saved: a loaded island sends its sleepers home again.

export const HOME = {
  // How far from its home point a villager's house may stand, in cells.
  reach: 3.2,
  // Water this deep on a house or at its door: wet, no one sleeps in it.
  wet: 0.3,
  // Seconds a home stands in water before its family gives it up and moves to a dry one.
  wetFor: 40,
  // Seconds a villager remembers a place it could not reach (a meal at a flooded home).
  unreached: 45,
} as const;

const dist = (world: World, i: number, x: number, y: number) => Math.hypot((i % world.w) + 0.5 - x, Math.floor(i / world.w) + 0.5 - y);

// The house cell nearest (x, y) within HOME.reach; -1 when there is none.
export function houseNear(world: World, x: number, y: number): number {
  let best = -1;
  let bestD: number = HOME.reach;
  const r = Math.ceil(HOME.reach);
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  for (let yy = cy - r; yy <= cy + r; yy++)
    for (let xx = cx - r; xx <= cx + r; xx++) {
      if (!world.inside(xx, yy)) continue;
      const i = yy * world.w + xx;
      if (world.cover[i] !== C.HOUSE) continue;
      const d = dist(world, i, x, y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  return best;
}

// A villager's house cell, or -1: remembered while it stands and its home has not moved.
export function houseOf(world: World, c: Creature): number {
  const known = c.data.house as number | undefined;
  // None found: looked for again every ten seconds, or as soon as its home moves (a house may go up).
  const none =
    known !== undefined && known < 0 && c.data.houseFor === c.homeX + c.homeY * 1e4 && world.time < ((c.data.houseAt as number | undefined) ?? 0) + 10;
  if (none || (known !== undefined && known >= 0 && world.cover[known] === C.HOUSE && dist(world, known, c.homeX, c.homeY) <= HOME.reach)) return known!;
  const i = houseNear(world, c.homeX, c.homeY);
  c.data.house = i;
  c.data.houseFor = c.homeX + c.homeY * 1e4;
  c.data.houseAt = world.time;
  return i;
}

// The two by two block a house cell belongs to (as voxel/buildings.ts draws it: the first block
// in reading order that holds it), or the cell alone.
export function houseBlock(world: World, i: number): number[] {
  const W = world.w;
  for (const [dx, dy] of [
    [-1, -1],
    [0, -1],
    [-1, 0],
    [0, 0],
  ]) {
    const t = i + dx + dy * W;
    const x = (i % W) + dx;
    if (t < 0 || x < 0 || x + 1 >= W || t + W + 1 >= world.n) continue;
    const cells = [t, t + 1, t + W, t + W + 1];
    if (cells.every((j) => world.cover[j] === C.HOUSE)) return cells;
  }
  return [i];
}

// Water on the house or at the point by its door.
export function wetAt(world: World, i: number): boolean {
  return world.fluid[i] === F.WATER && world.depth[i] > HOME.wet;
}

export function houseWet(world: World, house: number): boolean {
  return houseBlock(world, house).some((j) => wetAt(world, j));
}

export function houseBurning(world: World, house: number): boolean {
  return houseBlock(world, house).some((j) => world.fire[j] > 0.1);
}

// Its home stands in water: the house, or the point by its door when it has none.
export function homeWet(world: World, c: Creature): boolean {
  const house = houseOf(world, c);
  const door = world.idx(Math.max(0, Math.min(world.w - 1, c.homeX)), Math.max(0, Math.min(world.h - 1, c.homeY)));
  return wetAt(world, door) || (house >= 0 && houseWet(world, house));
}

// A house fit to sleep in: standing, dry and not on fire.
export function sleepable(world: World, house: number): boolean {
  return house >= 0 && world.cover[house] === C.HOUSE && !houseWet(world, house) && !houseBurning(world, house);
}

export function goIn(c: Creature, house: number): void {
  c.data.indoors = house;
  c.data.indoorsAt = [c.x, c.y];
  c.data.rough = undefined;
}

// Out of the door: drawn again where it went in.
export function comeOut(c: Creature): void {
  c.data.indoors = undefined;
  c.data.indoorsAt = undefined;
}

// Once a tick for a villager indoors (creatures.ts): it comes out when it wakes, is hurt or
// frightened, is moved (a blast, a push), or when its house burns, floods or falls. Fire and water
// wake it with a fright, so it runs out rather than back in.
export function stayIndoors(world: World, c: Creature): void {
  // Up from the ground when it wakes; the bed it chose is forgotten with the rest.
  if (c.mind?.task !== "rest") {
    if (c.data.rough) c.data.rough = undefined;
    if (c.data.bed) c.data.bed = undefined;
  } else if (c.data.rough && c.fear > 0) c.data.rough = undefined;
  const house = c.data.indoors as number | undefined;
  if (house === undefined) return;
  const at = c.data.indoorsAt as [number, number] | undefined;
  // Inside, it stays put: a nudge (a crowd at the door, a slope) is undone; a real throw (a blast,
  // a quake) brings it out where it landed.
  const moved = !at || Math.hypot(c.x - at[0], c.y - at[1]) > 1.5;
  if (at && !moved) {
    c.x = at[0];
    c.y = at[1];
  }
  const gone = world.cover[house] !== C.HOUSE;
  const burning = !gone && houseBurning(world, house);
  const wet = !gone && houseWet(world, house);
  if (!c.dead && !moved && !gone && !burning && !wet && c.mind?.task === "rest" && c.fear <= 0 && c.burning <= 0) return;
  comeOut(c);
  if (c.dead) return;
  if (burning || wet || gone) {
    c.fear = Math.max(c.fear, 2);
    c.fearX = (house % world.w) + 0.5;
    c.fearY = Math.floor(house / world.w) + 0.5;
    if (c.mind) {
      c.mind.task = "none";
      c.mind.action = burning ? "running from their burning house" : wet ? "out of their flooded house" : "out of their fallen house";
    }
  }
}

// The house cells with someone asleep inside, and the rest of each one's block: their windows glow.
export function litHouses(world: World): Set<number> {
  const out = new Set<number>();
  for (const c of world.creatures) {
    const house = c.data.indoors as number | undefined;
    if (house === undefined || c.dead || out.has(house)) continue;
    for (const j of houseBlock(world, house)) out.add(j);
  }
  return out;
}
