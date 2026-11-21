// Cold is a pressure, not a trap (21 November, the owner: "Too many animals
// freeze forever in the cold mountains, ideally humans and merchants prepare
// for it"). On main a creature on a cell under -12 was frozen every tick, and
// a frozen creature cannot move: on a cold peak it never left, never thawed
// and never died. Now:
//
//   - A spell's freeze (abilities, artifacts, runtime, social, auras) is the
//     hard stop it always was: c.frozen.
//   - Land freezes only where the cold is a spell's (well under the cell's own
//     climate), for LAND_FREEZE_MAX seconds at most, then not for
//     LAND_FREEZE_GRACE seconds, so the creature can walk out.
//   - The land's own cold chills (c.chill, seconds; not saved): a chilled
//     creature walks slower, turns back toward warmth, and past
//     EXPOSURE_HARM it is hurt and can die. Hardy kinds and people at home
//     never chill; a fire, a house or a smithy warms quickly.
//   - Paths, wandering and merchants keep off cells colder than they can bear.
//
// Every number of it is here.
import { C } from "./materials";
import { N, natureOf } from "./reactions";
import { WARD } from "./wards";
import type { Creature, CreatureKind } from "./creatures";
import type { World } from "./world";

export const COLD = {
  // Land freezes only under -12 and SPELL_COLD_DELTA under the cell's own climate.
  FREEZE_AT: -12,
  SPELL_COLD_DELTA: 15,
  // Seconds of land freeze in a row at most, then seconds with none.
  LAND_FREEZE_MAX: 3,
  LAND_FREEZE_GRACE: 4,
  // Below its tolerance a creature chills; tolerances by kind.
  CHILL_AT: -6,
  CHILL_AT_HARDY: -30,
  // People: a cloak in a cold village, and used to their own home's air.
  CLOAK_WARMTH: 12,
  CLOAK_AT: 2,
  ACCLIMATE: 6,
  // Chill back per second, and near a fire, a house or a smithy (within HEARTH_REACH cells).
  CHILL_RECOVER: 2,
  HEARTH_RECOVER: 6,
  HEARTH_REACH: 2,
  // Chill gained per second at most (1 at its tolerance, a tenth more per degree under).
  CHILL_RATE_MAX: 3,
  // Seconds of chill: it walks up to CHILL_SLOW slower as it nears EXPOSURE_HARM, then is hurt
  // CHILL_HURT of its health a second. Chill stops growing at CHILL_MAX.
  CHILL_SLOW: 0.4,
  EXPOSURE_HARM: 30,
  CHILL_HURT: 0.02,
  CHILL_MAX: 60,
  // It turns back past RETREAT_AT seconds of chill: 8 ways probed PROBE_CELLS away, a house
  // near the cell worth HEARTH_BONUS degrees, height a tenth of a degree a step.
  RETREAT_AT: 8,
  PROBE_CELLS: 6,
  HEARTH_BONUS: 15,
  RETREAT_PACE: 1.2,
  // A merchant turned back by the cold this often gives up the trip and goes home.
  TRIP_GIVE_UP: 2,
  // A path's step onto a cell colder than CHILL_AT costs this (paths.ts STEP is 4).
  COLD_STEP: 8,
  // A body frozen to death stands as a statue for this many seconds, then falls.
  FROST_STATUE: 30,
  // A breath puff every BREATH seconds while chilled.
  BREATH: 1.5,
  // Villagers can die of cold (the lead's decision of 21 November). In practice only when a
  // spell traps them or a long trip goes wrong: they turn back and never chill at home.
  // false: people only slow down, never hurt.
  PEOPLE_DIE: true,
} as const;

// Hardy: a coat for the cold, by its kind, its name or its tags. Not reactions.ts's N.COLD
// words (that one is what a creature is made of); this one is what it wears.
const FURRED = /\b(fur|furred|woolly|mammoth|yak|snow|polar|arctic|ice|frost|winter|yeti|penguin|seal|walrus|musk)/;
const HARDY_KINDS = new Set(["polar bear", "fox", "hare"]);
const hardyMemo = new WeakMap<CreatureKind, boolean>();

export function hardy(world: World, k: CreatureKind): boolean {
  let h = hardyMemo.get(k);
  if (h === undefined) {
    const base = k.name.split("#")[0].toLowerCase();
    h = HARDY_KINDS.has(base) || !!k.ai?.immune.includes("cold") || !!(natureOf(world, k) & N.COLD) || FURRED.test(`${base} ${k.tags.join(" ")}`.toLowerCase());
    hardyMemo.set(k, h);
  }
  return h;
}

// Is it one of the people (a villager, or a spell's person on a villager's body)?
export function person(c: Creature, k: CreatureKind): boolean {
  return c.kind === "villager" || !!k.body.villager;
}

// The coldest a cell can be before it chills this creature.
export function tolerance(world: World, c: Creature, k: CreatureKind): number {
  if (hardy(world, k)) return COLD.CHILL_AT_HARDY;
  if (person(c, k)) {
    const home = homeAir(world, c);
    return Math.min(COLD.CHILL_AT - (home < COLD.CLOAK_AT ? COLD.CLOAK_WARMTH : 0), home - COLD.ACCLIMATE);
  }
  return COLD.CHILL_AT;
}

// The climate of where it lives (not the moment's weather or a spell's cold).
export function homeAir(world: World, c: Creature): number {
  const x = Math.max(0, Math.min(world.w - 1, c.homeX));
  const y = Math.max(0, Math.min(world.h - 1, c.homeY));
  return world.ambient(world.idx(x, y));
}

// Is cell i too cold for it to go to?
export function tooCold(world: World, c: Creature, k: CreatureKind, i: number): boolean {
  return world.temp[i] < COLD.CHILL_AT && world.temp[i] < tolerance(world, c, k);
}

// The cold of a spell: under FREEZE_AT and well under the cell's own climate.
export function spellCold(world: World, i: number): boolean {
  const t = world.temp[i];
  return t < COLD.FREEZE_AT && t < world.ambient(i) - COLD.SPELL_COLD_DELTA;
}

// A fire, a house or a smithy within HEARTH_REACH cells.
export function hearthNear(world: World, x: number, y: number): boolean {
  const r = COLD.HEARTH_REACH;
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
      const j = ny * world.w + nx;
      if (world.fire[j] > 0.1 || world.cover[j] === C.HOUSE || world.cover[j] === C.SMITHY) return true;
    }
  return false;
}

// Chill for one tick (seconds of it, c.chill). Fliers in the air and
// fish do not chill; a ward against cold takes it all away. Returns the chill.
export function chillTick(world: World, c: Creature, k: CreatureKind, i: number, dt: number): number {
  let chill = c.chill || 0;
  // Every tolerance is CHILL_AT or colder: on warmer ground with no chill there is nothing to do.
  if (chill === 0 && world.temp[i] >= COLD.CHILL_AT) return 0;
  if ((k.flying && c.z > 0.5) || k.aquatic || world.wardMask[i] & WARD.cold) chill = 0;
  else {
    const tol = tolerance(world, c, k);
    const t = world.temp[i];
    if (t < tol) chill = Math.min(COLD.CHILL_MAX, chill + dt * Math.min(COLD.CHILL_RATE_MAX, 1 + (tol - t) / 10));
    else if (chill > 0) chill = Math.max(0, chill - dt * (hearthNear(world, c.x, c.y) ? COLD.HEARTH_RECOVER : COLD.CHILL_RECOVER));
  }
  c.chill = chill;
  return chill;
}

// How much of its speed the cold leaves it.
export function chillPace(chill: number): number {
  return 1 - COLD.CHILL_SLOW * Math.min(1, chill / COLD.EXPOSURE_HARM);
}

// Land freeze for one tick, on the ground: only a spell's cold, LAND_FREEZE_MAX seconds in a row
// at most, then LAND_FREEZE_GRACE seconds with none. Not for the hardy or the fireproof (who never
// froze), nor a creature of cold (reactions.ts natureTick thaws it: on main this froze it again).
export function landFreeze(world: World, c: Creature, k: CreatureKind, i: number, dt: number): void {
  const grace = c.thaw || 0;
  if (grace > 0) {
    c.thaw = Math.max(0, grace - dt);
    c.iced = 0;
    return;
  }
  if (!spellCold(world, i) || k.fireproof || hardy(world, k)) {
    if (c.iced) c.iced = 0;
    return;
  }
  const on = (c.iced || 0) + dt;
  if (on > COLD.LAND_FREEZE_MAX + 1e-6) {
    c.iced = 0;
    c.thaw = COLD.LAND_FREEZE_GRACE;
    return;
  }
  c.iced = on;
  c.frozen = Math.max(c.frozen, Math.min(0.5, COLD.LAND_FREEZE_MAX - on + dt));
}

// Out of the cold: the warmest of 8 ways PROBE_CELLS away it can stand on, a house near it worth
// HEARTH_BONUS degrees, the lower the better. Null when none is open.
export function warmerWay(
  world: World,
  c: Creature,
  k: CreatureKind,
  blocked: (world: World, x: number, y: number, c: Creature, k: CreatureKind) => boolean,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestScore = -Infinity;
  const r = COLD.PROBE_CELLS;
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    const x = c.x + Math.cos(ang) * r;
    const y = c.y + Math.sin(ang) * r;
    if (x < 3 || y < 3 || x > world.w - 4 || y > world.h - 4) continue;
    // Half way and there: open ground, not a wall or deep water.
    if (blocked(world, c.x + Math.cos(ang) * r * 0.5, c.y + Math.sin(ang) * r * 0.5, c, k) || blocked(world, x, y, c, k)) continue;
    const j = world.idx(x, y);
    const score = world.temp[j] + (houseNear(world, x, y) ? COLD.HEARTH_BONUS : 0) - world.height[j] * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }
  return best;
}

function houseNear(world: World, x: number, y: number): boolean {
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
      const cv = world.cover[ny * world.w + nx];
      if (cv === C.HOUSE || cv === C.SMITHY) return true;
    }
  return false;
}

// Is this person wearing a hood against the cold (view only, never saved)?
export function hooded(world: World, c: Creature): boolean {
  return homeAir(world, c) < COLD.CLOAK_AT;
}
