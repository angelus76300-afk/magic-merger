import { C, F } from "./materials";
import type { Creature } from "./creatures";
import type { World } from "./world";
import { DAY_LENGTH, dayOf } from "./daylight";

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

// How voxel/buildings.ts draws the houses: two by two blocks, a job's own block first, then the
// rest in reading order, each block the first four house cells not yet taken. For each cell, the
// first cell of its block (its windows carry that number), or -1 for a cell drawn alone. Pure, so
// the builder and the homes below agree on which block holds a sleeper's window (review of
// 2cecc47: in a row of three, the old guess here lit a block the builder had not drawn).
export function tileHouses(world: World): Int32Array {
  const W = world.w;
  const top = new Int32Array(world.n).fill(-1);
  const isHouse = (i: number) => world.cover[i] === C.HOUSE;
  for (const s of world.settlements)
    for (const j of s.jobs ?? []) {
      if (j.kind !== C.HOUSE) continue;
      const cells = [j.i, j.i + 1, j.i + W, j.i + W + 1];
      if (cells.every((c) => c >= 0 && c < world.n && isHouse(c) && top[c] < 0)) for (const c of cells) top[c] = j.i;
    }
  for (let i = 0; i < world.n - W - 1; i++) {
    if (!isHouse(i) || top[i] >= 0 || (i % W) + 1 >= W) continue;
    const cells = [i, i + 1, i + W, i + W + 1];
    if (!cells.every((c) => isHouse(c) && top[c] < 0)) continue;
    for (const c of cells) top[c] = i;
  }
  return top;
}

// tileHouses once a tick: asked for each sleeper each tick (its house burning, flooded).
const tiled = new WeakMap<World, { at: number; top: Int32Array }>();
function tilesOf(world: World): Int32Array {
  const known = tiled.get(world);
  if (known && known.at === world.time && known.top.length === world.n) return known.top;
  const top = tileHouses(world);
  tiled.set(world, { at: world.time, top });
  return top;
}

// The block a house cell is drawn in (tileHouses), or the cell alone.
export function houseBlock(world: World, i: number): number[] {
  const t = i >= 0 && i < world.n ? tilesOf(world)[i] : -1;
  if (t < 0 || world.cover[i] !== C.HOUSE) return [i];
  const W = world.w;
  return [t, t + 1, t + W, t + W + 1];
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
// `ridden`: the player is this creature (possess.ts), so it comes out and walks.
export function stayIndoors(world: World, c: Creature, ridden = false): void {
  // Up from the ground when it wakes; the bed it chose is forgotten with the rest.
  if (c.mind?.task !== "rest") {
    if (c.data.rough) c.data.rough = undefined;
    if (c.data.bed) c.data.bed = undefined;
  } else if (c.data.rough && c.fear > 0) c.data.rough = undefined;
  // Why it ran, for the card while the fright lasts (inspect.ts).
  if (c.data.fright && c.fear <= 0) c.data.fright = undefined;
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
  if (!c.dead && !ridden && !moved && !gone && !burning && !wet && c.mind?.task === "rest" && c.fear <= 0 && c.burning <= 0) return;
  comeOut(c);
  if (c.dead) return;
  if (burning || wet || gone) {
    c.fear = Math.max(c.fear, 2);
    c.fearX = (house % world.w) + 0.5;
    c.fearY = Math.floor(house / world.w) + 0.5;
    const why = burning ? "running from their burning house" : wet ? "out of their flooded house" : "out of their fallen house";
    c.data.fright = why;
    if (c.mind) {
      c.mind.task = "none";
      c.mind.action = why;
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

// Ruins (23 November, the owner: a burned village is rebuilt "after a night"). Rubble stands until
// the dawn after it fell: builders rebuild it from then (goals.ts, creatures.ts), and the family
// whose house it was sleeps that night lying down beside it. Dawn is when the night lifts under
// 0.3 (daylight.ts), when sleepers get up; rubble that falls at dawn or later waits for the next.
const dawnOf = (t: number) => dayOf(t + DAY_LENGTH * 0.05);

// Rubble that may not be rebuilt yet. Rubble with no time (a loaded island: ruinedAt is not saved)
// is counted from now, so it waits for the next dawn as well.
export function ruinStands(world: World, i: number): boolean {
  if (world.cover[i] !== C.RUBBLE) return false;
  let at = world.ruinedAt.get(i);
  if (at === undefined) {
    at = world.time;
    world.ruinedAt.set(i, at);
  }
  return dawnOf(world.time) === dawnOf(at);
}

// Rubble the builders may rebuild now.
export function rebuildable(world: World, i: number): boolean {
  return world.cover[i] === C.RUBBLE && !ruinStands(world, i);
}

// The rubble of a villager's house: rubble within HOME.reach of its home point, nearer than any
// house cell; -1 when its house stands (or it had none).
export function homeRuin(world: World, c: Creature): number {
  let best = -1;
  let bestD: number = HOME.reach;
  let house: number = HOME.reach;
  const r = Math.ceil(HOME.reach);
  const cx = Math.floor(c.homeX);
  const cy = Math.floor(c.homeY);
  for (let yy = cy - r; yy <= cy + r; yy++)
    for (let xx = cx - r; xx <= cx + r; xx++) {
      if (!world.inside(xx, yy)) continue;
      const i = yy * world.w + xx;
      const d = dist(world, i, c.homeX, c.homeY);
      if (world.cover[i] === C.HOUSE) house = Math.min(house, d);
      else if (world.cover[i] === C.RUBBLE && d < bestD) {
        bestD = d;
        best = i;
      }
    }
  return best >= 0 && bestD < house ? best : -1;
}

// A ruin rebuilt: the cell and the rest of its two by two block still in rubble, as one house (23
// November: rebuilt a cell at a time, the last cell of a burned house could wait the whole day).
// The block is the square holding the cell with the most rubble that may be rebuilt. A rebuilt roof
// shows its patch (4.4.5 part B).
export function rebuildRuin(world: World, i: number): void {
  const W = world.w;
  const x = i % W;
  const y = Math.floor(i / W);
  let best: number[] = [i];
  for (const [ox, oy] of [
    [0, 0],
    [-1, 0],
    [0, -1],
    [-1, -1],
  ]) {
    if (!world.inside(x + ox, y + oy) || !world.inside(x + ox + 1, y + oy + 1)) continue;
    const t = (y + oy) * W + x + ox;
    const cells = [t, t + 1, t + W, t + W + 1].filter((j) => rebuildable(world, j));
    if (cells.length > best.length) best = cells;
  }
  for (const j of best) {
    world.setCover(j, C.HOUSE);
    if (world.settlements.length) world.patched.add(j);
  }
}
