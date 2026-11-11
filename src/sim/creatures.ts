import { C, F, G, S } from "./materials";
import { explode, forDisc, setBlastSpawn } from "./physics";
import { BUILT_IN, lull, names, social, stepLandmarks, TAGS, type Mood } from "./social";
import { WARD, damageWard, warded } from "./wards";
import { daylight } from "./daylight";
import type { World } from "./world";
import { body, type BodySpec } from "./body";
import { SPECIES, habitatCell, habitatCellSure, targetOf } from "./wildlife";
import { keepBalance, stepMovers } from "./balance";
import { growSettlements, wearPaths } from "./ecology";
import { roadSpeed, stepRoads } from "./roads";
import { DRAGON, stepWonders } from "./wonders";
import { growBuildings, stepBuildings } from "./buildings";
import { packLook, randomLook, shirtOf, sizeOf, unpackLook } from "./villagers";
import { denDown, goalOfCreature, hasNeeds, kindGoal, needsTick, pursue, stepGoals } from "./goals";
import { abilitiesFromName, useAbilities } from "./abilities";
import { stepArtifacts } from "./artifacts";
import { meter } from "./motion";
import { steer } from "./steer";
import { alarm, calmDown, fleeing } from "./flight";
import { pathsOf, solidCovers } from "./paths";
import { LOADS, deed, harmed, life, newMind, noteDeath, reborn, storyOn, tell, villageOf, type AbilitySpec, type Goal, type Mind } from "./kin";

// What a spell-made creature does, declared rather than coded, so even a
// short program gets a creature with a life of its own.
export interface Behavior {
  // wander (default), hunt (chases prey and attacks), guard (stays home and
  // attacks foes who come close), follow (walks with the nearest leader),
  // flee (keeps away from every other kind).
  mode: "wander" | "hunt" | "guard" | "follow" | "flee";
  // Kinds hunted or fought; empty means every other kind.
  prey: string[];
  // Kinds followed; empty means villagers.
  leader: string[];
  // Damage per second on contact.
  attack: number;
  // How far it notices others, in cells.
  sense: number;
  // An effect on everyone near it: heal, fear, calm, sleep, burn, freeze, hurt.
  aura: string | null;
  auraRadius: number;
  auraPower: number;
  // A material (or "fire") it leaves on the cells it walks over.
  leaves: string | null;
  // Elements that hurt it badly, and elements it ignores:
  // water, fire, cold, light (daylight), lightning, acid.
  weak: string[];
  immune: string[];
  // Seconds it lives, 0 for ever.
  lifespan: number;
  // What happens when it dies: explode, fire, seeds, ice, spawn:<kind>, or a material.
  onDeath: string | null;
  // Kinds drawn toward it, and kinds that keep away from it.
  lures: string[];
  scares: string[];
  // Its victims rise as its own kind (vampires, zombies).
  converts: boolean;
  // When it is awake: always, day or night.
  active: "always" | "day" | "night";
}

// What a kind of creature is. Spells can add kinds at run time, with a tick of
// their own that runs after the built-in behavior.
export interface CreatureKind {
  name: string;
  speed: number;
  hp: number;
  // Radius in cells at size 1.
  radius: number;
  color: number;
  flying: boolean;
  fireproof: boolean;
  swims: boolean;
  glow: boolean;
  // Wanders around its home (villagers) or freely (everything else).
  homebody: boolean;
  // What it looks like (3.5): a body plan with features, or a model.
  body: BodySpec;
  // Flying height in voxels.
  altitude: number;
  // Lives in water only: land is a wall and air chokes it (fish).
  aquatic: boolean;
  // One of the island's own animals, born again in its habitat.
  native: boolean;
  // Words that also name it in lures, scares and prey lists ("beast").
  tags: string[];
  tick?: (self: Creature, dt: number) => void;
  fallback?: string;
  ai?: Behavior;
  // What it wants (3.6, goals.ts) and its own magic (abilities.ts). Kinds
  // that declare a goal have needs; older ones get one from their behavior,
  // name or base kind and keep doing what they did.
  goal?: Goal | string;
  abilities?: AbilitySpec[];
  needs?: boolean;
}

export const KINDS = new Map<string, CreatureKind>();
const kind = (k: Partial<CreatureKind> & { name: string }): CreatureKind => ({
  speed: 3,
  hp: 100,
  radius: 0.6,
  color: 0xffffff,
  flying: false,
  fireproof: false,
  swims: false,
  glow: false,
  homebody: false,
  body: body("four legs"),
  altitude: 2,
  aquatic: false,
  native: false,
  tags: [],
  ...k,
});
for (const k of [
  kind({ name: "villager", speed: 3.2, hp: 100, radius: 0.55, color: 0xd64545, homebody: true, body: body("two legs", [], { villager: true }) }),
  kind({ name: "beast", speed: 4.5, hp: 80, radius: 0.75, color: 0xe8e2d0, body: body("four legs", ["tail"]) }),
  kind({ name: "spirit", speed: 2.5, hp: 60, radius: 0.6, color: 0xc9f6ff, flying: true, fireproof: true, glow: true, body: body("spirit") }),
  kind({ name: "golem", speed: 1.8, hp: 300, radius: 1, color: 0x8d8d96, fireproof: true, body: body("golem", [], { color2: 0x9dfcff }) }),
  ...SPECIES.map((s) => kind(s.kind)),
  // The dragon of a hoard (4.4.5 part B, wonders.ts): it sleeps on its gold
  // and wakes for a minute when someone takes some. Tagged "dragon", so
  // spells that scare, lure or hunt dragons see it as one.
  kind({
    name: DRAGON,
    speed: 4.4,
    hp: 900,
    radius: 1.5,
    color: 0x8a2a1c,
    flying: true,
    fireproof: true,
    altitude: 9,
    tags: ["dragon", "monster"],
    body: body("dragon", ["wings", "horns", "tail"], { color2: 0xe0a030 }),
    goal: "guard",
    ai: {
      mode: "guard",
      prey: [],
      leader: [],
      attack: 30,
      sense: 14,
      aura: null,
      auraRadius: 4,
      auraPower: 1,
      leaves: null,
      weak: [],
      immune: ["fire"],
      lifespan: 0,
      onDeath: null,
      lures: [],
      scares: ["villager", "beast"],
      converts: false,
      active: "always",
    },
  }),
  // The dead a necromancer raises (3.6): weak, short lived, burnt by day.
  kind({
    name: "risen",
    speed: 2.2,
    hp: 50,
    radius: 0.55,
    color: 0xd8d4c8,
    body: body("two legs"),
    goal: "spread",
    ai: {
      mode: "hunt",
      prey: ["villager"],
      leader: [],
      attack: 6,
      sense: 10,
      aura: null,
      auraRadius: 4,
      auraPower: 1,
      leaves: null,
      weak: ["light"],
      immune: [],
      lifespan: 90,
      onDeath: null,
      lures: [],
      scares: [],
      converts: false,
      active: "always",
    },
  }),
  // 4.6 part B: the dead a villager necromancer raises (villagers.ts). Bound
  // to it: they follow the village's people and stand guard over them until
  // dawn crumbles them, never hunting the living of their own village.
  kind({
    name: "thrall",
    speed: 2,
    hp: 45,
    radius: 0.55,
    color: 0xb8c4a8,
    tags: ["undead"],
    body: body("two legs", ["glowing eyes"], { color2: 0x9a7aff }),
    goal: "guard",
    ai: {
      mode: "follow",
      prey: ["wolf", "boar", "bear", "risen"],
      leader: ["villager"],
      attack: 8,
      sense: 8,
      aura: null,
      auraRadius: 4,
      auraPower: 1,
      leaves: null,
      weak: ["light"],
      immune: [],
      lifespan: 120,
      onDeath: null,
      lures: [],
      scares: ["rabbit", "deer"],
      converts: false,
      active: "always",
    },
  }),
]) {
  k.goal ??= kindGoal(k, undefined);
  k.abilities ??= abilitiesFromName(k.name);
  KINDS.set(k.name, k);
  if (k.tags.length) TAGS.set(k.name, k.tags);
}

export const BUILTIN_KINDS = new Set(KINDS.keys());
for (const name of BUILTIN_KINDS) BUILT_IN.add(name);

export interface Creature {
  id: number;
  kind: string;
  x: number;
  y: number;
  // Height above the ground: thrown, levitating or flying.
  z: number;
  vx: number;
  vy: number;
  vz: number;
  // Heading (radians, 0 along +x) and speed of its own walking (4.3, steer.ts);
  // vx and vy are what throws and pushes it.
  hd: number;
  sp: number;
  hp: number;
  size: number;
  color: number;
  dead: boolean;
  deadFor: number;
  homeX: number;
  homeY: number;
  // Where it is walking to, and for how much longer it keeps that goal.
  tx: number;
  ty: number;
  goal: number;
  // Seconds left for each status.
  burning: number;
  frozen: number;
  fear: number;
  fearX: number;
  fearY: number;
  sleep: number;
  calm: number;
  levitate: number;
  stun: number;
  drowning: number;
  // Who this one is among its kind (villagers.ts for villagers; a bit for
  // antlers on wild animals). Saved.
  look: number;
  // Free data for spell defined behavior.
  data: Record<string, unknown>;
  // Its goal, needs, task, memory and abilities (3.6, kin.ts), made on first use.
  mind?: Mind;
}

let nextId = 1;

// Tests only: creature ids feed some choices, so a replay that must give the
// same answer whatever ran before it starts from the same id.
export function resetCreatureIds(): void {
  nextId = 1;
}

export function kindOf(c: Creature): CreatureKind {
  return KINDS.get(c.kind) ?? KINDS.get("villager")!;
}

export function maxHp(c: Creature): number {
  return kindOf(c).hp * c.size;
}

// What goals.ts and abilities.ts borrow from here without importing it.
life.kindOf = kindOf;
life.maxHp = maxHp;
life.make = (kind, x, y) => makeCreature(kind, x, y);
life.goalOf = (c) => goalOfCreature(c, kindOf(c));
life.free = (c, x, y) => free(c, x, y);
life.hostile = (c) => hostile(c);

export function makeCreature(kindName: string, x: number, y: number): Creature {
  const k = KINDS.get(kindName) ?? KINDS.get("villager")!;
  const villager = k.name === "villager";
  const look = villager ? randomLook((Math.random() * 6) | 0) : null;
  const species = k.native ? SPECIES.find((s) => s.kind.name === k.name) : undefined;
  return {
    id: nextId++,
    kind: k.name,
    x,
    y,
    z: k.flying ? k.altitude : 0,
    vx: 0,
    vy: 0,
    vz: 0,
    hd: ((nextId * 2.39996) % (Math.PI * 2)) - Math.PI,
    sp: 0,
    hp: k.hp * (look ? sizeOf(look) : 1),
    size: look ? sizeOf(look) : 1,
    color: look ? shirtOf(look) : species ? species.colors[(Math.random() * species.colors.length) | 0] : k.color,
    dead: false,
    deadFor: 0,
    homeX: x,
    homeY: y,
    tx: x,
    ty: y,
    goal: 0,
    burning: 0,
    frozen: 0,
    fear: 0,
    fearX: 0,
    fearY: 0,
    sleep: 0,
    calm: 0,
    levitate: 0,
    stun: 0,
    drowning: 0,
    look: look ? packLook(look) : (Math.random() * 256) | 0,
    data: {},
  };
}

// Puts a villager in its village's clothes, keeping its age and job.
export function dress(c: Creature, style: number): void {
  const look = unpackLook(c.look);
  look.style = style;
  c.look = packLook(look);
  c.color = shirtOf(look);
}

// Which village's clothes a point belongs to: the nearest villager's.
export function styleNear(world: World, x: number, y: number): number {
  let best = -1;
  let bestD = 30;
  for (const o of world.creatures) {
    if (o.kind !== "villager" || o.dead) continue;
    const d = Math.hypot(o.homeX - x, o.homeY - y);
    if (d < bestD) {
      bestD = d;
      best = unpackLook(o.look).style;
    }
  }
  return best >= 0 ? best : (Math.random() * 6) | 0;
}

// Villages by their houses: villagers whose homes are close share clothes,
// each village its own. For a fresh island and for saves from before 3.5.
export function dressVillages(world: World, who: Creature[]): void {
  const centers: { x: number; y: number }[] = [];
  for (const c of who) {
    if (c.kind !== "villager") continue;
    let n = centers.findIndex((p) => Math.hypot(p.x - c.homeX, p.y - c.homeY) < 22);
    if (n < 0) {
      n = centers.length;
      centers.push({ x: c.homeX, y: c.homeY });
    }
    // Islands are seeded, so the first village of one island is not always red.
    dress(c, (n + world.seed) % 6);
  }
}

export function restoreCreature(raw: Partial<Creature> & { m?: SavedMind }): Creature | null {
  if (typeof raw.x !== "number" || typeof raw.y !== "number" || typeof raw.kind !== "string") return null;
  const c = makeCreature(raw.kind, raw.x, raw.y);
  const look = typeof raw.look === "number" && Number.isFinite(raw.look) ? raw.look >>> 0 : c.look;
  const { m, ...rest } = raw;
  const back: Creature = { ...c, ...rest, look, id: c.id, data: {}, mind: undefined };
  if (m && typeof m === "object") restoreMind(back, m);
  return back;
}

// What a mind keeps across a save: needs, its lair, what it carries, whether
// it is tame, its deeds and memories. The task is chosen again.
export interface SavedMind {
  h?: number;
  t?: number;
  lair?: number;
  carry?: string | null;
  tame?: number;
  fed?: number;
  deeds?: number;
  did?: string;
  goal?: string;
  job?: string | null;
  mem?: [string, number][];
  // 4.6 part B: a person's own name and what it last did.
  ti?: string;
}

export function saveMind(c: Creature): SavedMind | undefined {
  const m = c.mind;
  if (!m) return undefined;
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    h: r(m.hunger),
    t: r(m.tired),
    lair: m.lair,
    carry: m.carry,
    tame: m.tame,
    fed: m.fed,
    deeds: m.deeds,
    did: m.did,
    goal: m.goal,
    job: m.job,
    mem: m.memory.map((e) => [e.kind, r(e.feel)]),
    ...(m.title ? { ti: m.title } : {}),
  };
}

function restoreMind(c: Creature, s: SavedMind): void {
  const m: Mind = newMind(life.goalOf(c));
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  m.hunger = num(s.h, 0, 1, m.hunger);
  m.tired = num(s.t, 0, 1, m.tired);
  m.lair = Math.round(num(s.lair, -1, 1e7, -1));
  m.carry = (LOADS as readonly string[]).includes(s.carry as string) ? (s.carry as Mind["carry"]) : null;
  m.tame = Math.round(num(s.tame, 0, 64, 0));
  m.fed = Math.round(num(s.fed, 0, 10, 0));
  m.deeds = Math.round(num(s.deeds, 0, 1e9, 0));
  m.did = typeof s.did === "string" ? s.did.slice(0, 80) : "";
  if (s.goal === "worship") m.goal = "worship";
  // A spell's own job, kept by name: it works again once that spell's rules are loaded.
  if (typeof s.job === "string" && s.job) m.job = s.job.slice(0, 40);
  if (typeof s.ti === "string" && s.ti.trim()) m.title = s.ti.trim().slice(0, 32);
  if (Array.isArray(s.mem))
    m.memory = s.mem
      .filter((e) => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "number" && Number.isFinite(e[1]))
      .slice(0, 4)
      .map(([kind, feel]) => ({ kind: kind.slice(0, 40), feel: Math.max(-5, Math.min(5, feel)) }));
  c.mind = m;
}

// Water a fish can live in (ice above it is fine).
function wet(world: World, i: number, depth: number): boolean {
  return (world.fluid[i] === F.WATER || world.fluid[i] === F.ICE) && world.depth[i] > depth;
}

// Is the cell dangerous to stand on or next to?
function danger(world: World, i: number): boolean {
  return world.fire[i] > 0.15 || world.fluid[i] === F.LAVA || world.fluid[i] === F.ACID || world.gas[i] === S.POISON;
}

// (fx, fy): where the step is taken from, for the cliff (4.3: a creature
// looking a few cells ahead up a gentle slope compares each probe with the
// one before it, not with where it stands, or the hill reads as a wall).
function blocked(world: World, x: number, y: number, c: Creature, k: CreatureKind, fx = c.x, fy = c.y): boolean {
  if (!world.inside(x, y)) return true;
  if (k.flying || c.levitate > 0 || c.z > 1.5) return false;
  const i = world.idx(x, y);
  if (k.aquatic) return !wet(world, i, 0.6);
  // Solid covers by id from a table (4.3: steering asks this many times a tick).
  if (solidCovers(world)[world.cover[i]]) return true;
  // A bridge's deck carries walkers over the water (4.9).
  const deck = world.cover[i] === C.BRIDGE && world.onDeck(i);
  // Deep water and any lava are walls for those who would die in them.
  const f = world.fluid[i];
  if (!deck && f !== F.NONE && f !== F.ICE && world.depth[i] > 0.05) {
    if (f === F.LAVA && !k.fireproof) return true;
    if (world.depth[i] > 1 && !k.swims) return true;
  }
  // Cliffs: too steep a step up (ice and fluids count as the surface you walk on).
  const here = world.walkLevel(world.idx(Math.max(0, Math.min(world.w - 1, fx)), Math.max(0, Math.min(world.h - 1, fy))));
  return world.walkLevel(i) - here > 1.6;
}

const TIMED = ["frozen", "fear", "sleep", "calm", "levitate", "stun"] as const;

export function updateCreature(world: World, c: Creature, dt: number): void {
  const k = kindOf(c);
  freeWorld = world;
  storyOn(world);
  if (c.dead) {
    if (c.deadFor === 0) {
      noteDeath(world, c);
      if (k.ai?.onDeath) deathOf(world, c, k.ai.onDeath);
    }
    c.deadFor += dt;
    c.z = Math.max(0, c.z + c.vz * dt);
    // On the ground a body stops: its speed used to keep growing, and a
    // creature raised from the dead hit the ground at it and died again.
    c.vz = c.z > 0 ? c.vz - 30 * dt : 0;
    return;
  }
  // Frightened just now by a spell, an aura or a guard: a turn with a reason.
  if (meter) {
    if (c.fear > 0 && !c.data.feared) meter.done(c, "scared");
    c.data.feared = c.fear > 0 || undefined;
  }
  for (const s of TIMED) c[s] = Math.max(0, c[s] - dt);

  const i = world.idx(Math.max(0, Math.min(world.w - 1, c.x)), Math.max(0, Math.min(world.h - 1, c.y)));
  const onGround = c.z < 0.5 && !k.flying && c.levitate <= 0;
  // On a bridge's deck: dry feet whatever the water under it (4.9).
  const onDeck = onGround && !k.aquatic && world.cover[i] === C.BRIDGE && world.onDeck(i);

  const ai = k.ai;
  const weak = (e: string) => !!ai && ai.weak.includes(e);
  const immune = (e: string) => !!ai && ai.immune.includes(e);
  if (ai) {
    const age = ((c.data.age as number) ?? 0) + dt;
    c.data.age = age;
    if (ai.lifespan > 0 && age > ai.lifespan) c.hp = 0;
    // Water hurts what is in it, not a flier above it (2026-11-11: a wisp awake on
    // arrival died at two blocks over a lake).
    const above = k.flying && c.z > 0.5;
    if (weak("water") && !above && world.fluid[i] === F.WATER && world.depth[i] > 0.05) c.hp -= 40 * dt;
    if (weak("water") && world.gas[i] === S.STEAM) c.hp -= 10 * dt;
    if (weak("cold") && world.temp[i] < 2) c.hp -= 25 * dt;
    if (weak("fire") && (c.burning > 0 || world.temp[i] > 80)) c.hp -= 30 * dt;
    if (weak("acid") && world.fluid[i] === F.ACID) c.hp -= 60 * dt;
    if (
      weak("light") &&
      world.tick % 15 === 0 &&
      daylight(world.time).night < 0.3 &&
      !((ai.active === "night" || shunsDay(k)) && shaded(world, i)) &&
      !(shunsDay(k) && arriving(world, c))
    ) {
      c.hp -= 12 * 0.5;
      if (Math.random() < 0.3) world.particles.add({ x: c.x, y: c.y, z: 1, vz: 2, life: 0.6, color: 0xfff0c0, size: 1, glow: true });
    }
    if (immune("cold")) c.frozen = 0;
    if (immune("fire")) c.burning = 0;
  }
  // A fish out of water chokes.
  if (k.aquatic && !wet(world, i, 0.25)) c.hp -= 15 * dt;

  // Under a ward: no burning, no frost, no poison from outside.
  const ward = world.wardMask[i];
  if (ward & WARD.fire) c.burning = 0;
  if (ward & WARD.cold) c.frozen = 0;

  // The land hurts.
  if (onGround) {
    if (world.fire[i] > 0.25 && !k.fireproof && !immune("fire")) c.burning = Math.max(c.burning, 3);
    const fluid = world.materials.get("fluid", world.fluid[i]);
    if (!onDeck && world.depth[i] > 0.05 && fluid.hurts > 0 && !(k.fireproof && world.fluid[i] === F.LAVA) && !(immune("acid") && world.fluid[i] === F.ACID))
      c.hp -= fluid.hurts * dt;
    if (world.fluid[i] === F.WATER && world.depth[i] > 0.25) c.burning = 0;
    if (!onDeck && world.fluid[i] === F.WATER && world.depth[i] > 1.4 && !k.swims && !immune("water")) {
      c.drowning += dt;
      if (c.drowning > 4) c.hp -= 12 * dt;
    } else c.drowning = Math.max(0, c.drowning - dt);
    if (world.temp[i] < -12 && !k.fireproof && !immune("cold")) c.frozen = Math.max(c.frozen, 0.5);
  }
  if (world.gas[i] !== S.NONE) {
    const gas = world.materials.get("gas", world.gas[i]);
    if (gas.hurts > 0 && !(ward & WARD.harm)) c.hp -= gas.hurts * world.gasAmt[i] * dt;
  }
  if (c.burning > 0) {
    if (k.fireproof) c.burning = 0;
    else {
      c.burning -= dt;
      c.hp -= 14 * dt;
      // A burning creature sets dry things alight as it runs.
      if (onGround && Math.random() < dt * 2) {
        const m = world.materials.get("cover", world.cover[i]);
        if (m.flammable > 0 || world.materials.get("ground", world.ground[i]).flammable > 0) world.fire[i] = Math.max(world.fire[i], 0.4);
      }
    }
  }
  if (c.hp <= 0) {
    c.dead = true;
    c.burning = 0;
    return;
  }

  // Decide where to go: survival, then needs and goals (goals.ts), then the
  // declared behavior of older spell creatures, then wandering.
  const busy = c.frozen > 0 || c.sleep > 0 || c.stun > 0;
  const needs = hasNeeds(c, k);
  if (needs) needsTick(c, k, dt);
  let wantX = 0;
  let wantY = 0;
  let pace = 1;
  let mood: Mood = null;
  let plan2: ReturnType<typeof social> = null;
  let flight: { x: number; y: number } | null = null;
  let socialMood: Mood = null;
  // Which decision drove this tick's step, for the motion meter (4.3).
  let drive = busy ? "asleep" : "idle";
  if (!busy) {
    // Danger is probed every third tick and remembered in between (3.6: goals
    // keep creatures on the move, and this was the dearest part of a tick).
    let dangerDir = c.data.danger as { x: number; y: number } | null | undefined;
    if (dangerDir === undefined || (world.tick + c.id) % 3 === 0) {
      dangerDir = senseDanger(world, c);
      // Away from a fire for a moment after it is out of reach, not one tick
      // in, one tick out at its edge (4.3).
      if (dangerDir) c.data.dangerUntil = world.time + 0.8;
      else if (world.time < ((c.data.dangerUntil as number | undefined) ?? 0)) dangerDir = c.data.danger as { x: number; y: number } | null;
      c.data.danger = dangerDir;
    }
    if (c.fear > 0) {
      const dx = c.x - c.fearX;
      const dy = c.y - c.fearY;
      const d = Math.hypot(dx, dy) || 1;
      wantX = dx / d;
      wantY = dy / d;
      pace = 1.6;
      drive = "fear";
    } else if (c.burning > 0) {
      drive = "burning";
      // Panic: toward water if any is close, otherwise anywhere fast.
      const water = nearest(world, c.x, c.y, 14, (j) => world.fluid[j] === F.WATER);
      if (water) {
        wantX = water.x - c.x;
        wantY = water.y - c.y;
      } else {
        wantX = Math.cos(c.id + world.time * 3);
        wantY = Math.sin(c.id * 1.7 + world.time * 2.3);
      }
      pace = 1.8;
    } else if (dangerDir) {
      wantX = dangerDir.x;
      wantY = dangerDir.y;
      pace = 1.5;
      drive = "danger";
    } else if (c.calm > 0) {
      pace = 0;
      drive = "calm";
      calmDown(c);
    } else if (
      ai &&
      ((ai.active !== "always" && daylight(world.time).night > 0.5 !== (ai.active === "night")) || (shunsDay(k) && daylight(world.time).night < 0.3)) &&
      !arrivalAwake(world, c, k, i, weak("light") && (ai.active === "night" || shunsDay(k)))
    ) {
      // Out of its hours it rests where it is; a creature of the night that
      // daylight burns first looks for the shade of the woods (3.6).
      pace = 0;
      mood = "asleep";
      drive = "asleep";
      const shy = shunsDay(k) && ai.active !== "night";
      const shade = (ai.active === "night" || shy) && weak("light") && !shaded(world, i) ? shadeNear(world, c) : null;
      if (shade) {
        wantX = shade.x - c.x;
        wantY = shade.y - c.y;
        pace = 1.4;
        mood = null;
        drive = "shade";
      }
      if (c.mind) {
        c.mind.action = shade ? "hiding from the sun" : shy ? "keeping to the shade until dusk" : `asleep until ${ai.active === "night" ? "night" : "day"}`;
        c.mind.task = "none";
        if (!shade && needs && !k.flying) denDown(world, c);
      }
    } else if ((plan2 = social(world, c, k, kindOf, dt))) {
      wantX = plan2.x - c.x;
      wantY = plan2.y - c.y;
      pace = plan2.pace;
      mood = plan2.mood;
      drive = "social";
      socialMood = plan2.mood;
      if (c.mind) c.mind.action = plan2.mood === "fear" ? "running for its life" : plan2.mood === "angry" ? "fighting back" : c.mind.action;
    } else if ((flight = (ai?.mode === "flee" && lookOut(world, c, ai, dt), fleeing(world, c)))) {
      // Survival first: a deer runs from people and wolves before it eats,
      // and keeps running until it is well away and has not seen them for a
      // while (4.3, flight.ts).
      wantX = flight.x - c.x;
      wantY = flight.y - c.y;
      pace = 1.4;
      mood = "fear";
      drive = "flee";
      if (c.mind) c.mind.action = "running away";
    } else if (needs && (plan2 = pursue(world, c, k, dt))) {
      wantX = plan2.x - c.x;
      wantY = plan2.y - c.y;
      pace = plan2.pace;
      mood = plan2.mood;
      drive = "pursue";
    } else if (ai && ai.mode !== "wander" && ai.mode !== "flee" && behave(world, c, k, ai, dt)) {
      wantX = c.tx - c.x;
      wantY = c.ty - c.y;
      pace = ai.mode === "hunt" ? 1.3 : 1;
      if (Math.hypot(wantX, wantY) < 0.4) pace = 0;
      if (ai.mode === "hunt" && c.data.target) mood = "hunt";
      drive = "behave";
      if (c.mind) c.mind.action = ai.mode === "hunt" ? (c.data.target ? "hunting" : "prowling") : ai.mode === "guard" ? "on guard" : "following";
    } else if (!needs && (plan2 = pursue(world, c, k, dt))) {
      // Older spell creatures take up their goal when their behavior leaves them idle.
      wantX = plan2.x - c.x;
      wantY = plan2.y - c.y;
      pace = plan2.pace;
      mood = plan2.mood;
      drive = "pursue";
    } else if (needs && c.mind) {
      // Between two tasks it stands and looks around, and thinks again soon,
      // instead of setting off toward a random point for half a second (4.3).
      pace = 0;
      drive = "idle";
      c.mind.think = Math.min(c.mind.think, 0.25);
    } else {
      plan(world, c, k, dt);
      wantX = c.tx - c.x;
      wantY = c.ty - c.y;
      drive = "plan";
      if (Math.hypot(wantX, wantY) < 0.6) {
        if (pace > 0 && meter && c.data.arrived !== c.goal) meter.done(c, "wander target");
        c.data.arrived = c.goal;
        pace = 0;
      }
    }
    // Frightened people run for the nearest ward instead of away into the open.
    const scared = c.fear > 0 || c.burning > 0 || !!dangerDir || mood === "fear";
    if (scared && world.wards.length && !hostile(c)) {
      const shelter = shelterFor(world, c);
      if (shelter) {
        wantX = shelter.x - c.x;
        wantY = shelter.y - c.y;
        pace = Math.hypot(wantX, wantY) < shelter.r * 0.5 ? 0 : 1.6;
        mood = "fear";
        drive = "shelter";
      }
    }
  }

  // The step itself (4.3, steer.ts): a heading and a speed with a body behind
  // them. A flight or a chase runs through its point; anything else slows
  // down to arrive.
  const chase = mood === "fear" || mood === "angry" || mood === "hunt" || drive === "fear" || drive === "burning" || drive === "danger" || drive === "flee";
  const arrive = !chase || drive === "shelter";
  const len = Math.hypot(wantX, wantY);
  let wanted = 0;
  {
    let speed = 0;
    if (len > 0 && pace > 0) {
      speed = k.speed * pace * Math.sqrt(c.size);
      if (onGround && !onDeck && world.depth[i] > 0.3 && world.fluid[i] !== F.ICE) speed *= 0.5;
      if (onGround && !onDeck && world.fluid[i] === F.MUD) speed *= 0.3;
      // Faster on a path, a road or a bridge (4.9, roads.ts).
      if (onGround && !k.aquatic) speed *= roadSpeed(world, i);
    }
    // The end of the trip, for its flow field: the task's place, when the
    // point asked for is only a bend on the way (goals.ts roamAim).
    const m = c.mind;
    // A traveller following a road (4.9) goes to the next bend of it.
    const trip = drive === "pursue" && m && m.task !== "none" && !c.data.via;
    const gx = trip ? (m.target ? m.target.x : m.tx) : c.x + wantX;
    const gy = trip ? (m.target ? m.target.y : m.ty) : c.y + wantY;
    const hunting = mood === "hunt" || mood === "angry";
    const stepped = steer(world, c, k, c.x + wantX, c.y + wantY, busy ? 0 : speed, arrive, hunting, dt, blocked, gx, gy);
    wanted = stepped.wanted;
    if (stepped.jammed && speed > 0) {
      // Boxed in (born between trees and houses): after a while, out to the
      // nearest open cell, so it is not stuck for good (3.6).
      const stuck = ((c.data.stuck as number | undefined) ?? 0) + dt;
      c.data.stuck = stuck;
      if (stuck > 1) c.goal = 0;
      if (stuck > 3 && !k.aquatic) {
        c.data.stuck = 0;
        unstick(world, c, k);
      }
    } else if (c.data.stuck) c.data.stuck = Math.max(0, (c.data.stuck as number) - dt);
  }

  // Being thrown, lifted or knocked around.
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  const friction = c.z > 0.2 ? 0.6 : 6;
  c.vx -= c.vx * Math.min(1, friction * dt);
  c.vy -= c.vy * Math.min(1, friction * dt);
  if (k.flying || c.levitate > 0) {
    const target = c.levitate > 0 ? 4 + Math.sin(world.time * 2 + c.id) * 0.8 : k.altitude + (k.altitude > 3 ? Math.sin(world.time * 0.7 + c.id) * 1.5 : 0);
    c.vz += (target - c.z) * 4 * dt - c.vz * 2 * dt;
    c.z += c.vz * dt;
  } else {
    c.vz -= 30 * dt;
    c.z += c.vz * dt;
    if (c.z <= 0) {
      if (c.vz < -16) c.hp -= (-c.vz - 16) * 4;
      c.z = 0;
      c.vz = 0;
    }
  }
  c.x = Math.max(0.5, Math.min(world.w - 1.5, c.x));
  c.y = Math.max(0.5, Math.min(world.h - 1.5, c.y));
  if (ai && !busy) sideEffects(world, c, ai, i, onGround, dt);
  if (!busy && (k.abilities?.length || c.kind === "villager")) useAbilities(world, c, k);
  if (c.fear > 0 || c.burning > 0) mood = "fear";
  c.data.mood = busy ? (c.sleep > 0 ? "asleep" : null) : mood;
  const idle = idleOf(c, busy);
  if (c.data.idle !== idle) c.data.idle = idle;
  if (c.hp <= 0) c.dead = true;

  if (k.tick) k.tick(c, dt);
  if (meter) {
    // The drive in full for the report: which task, which mood, which behavior.
    const full =
      drive === "pursue" ? `pursue:${c.mind?.task ?? "none"}` : drive === "social" ? `social:${socialMood}` : drive === "behave" ? `behave:${ai?.mode}` : drive;
    meter.after(c, world.time, dt, full, pace > 0 ? wantX : 0, pace > 0 ? wantY : 0, wanted);
  }
}

// What a creature standing still is doing, for the view (4.3): lying down
// (asleep, resting), head down at its food or its work, or looking around.
const HEAD_DOWN = new Set(["graze", "forage", "eat", "feast", "harvest", "plant", "seed"]);
function idleOf(c: Creature, busy: boolean): "lie" | "graze" | "look" | undefined {
  if (c.sp > 0.15 || c.frozen > 0 || c.stun > 0) return undefined;
  if (c.sleep > 0 || c.data.mood === "asleep") return "lie";
  if (busy) return undefined;
  const m = c.mind;
  if (m && m.work > 0 && HEAD_DOWN.has(m.task)) return "graze";
  return "look";
}

// A step of up to three cells toward (x, y) onto land it could stand on,
// over a cliff edge if need be: out of a hollow it cannot walk out of.
let freeWorld: World | null = null;
function free(c: Creature, x: number, y: number): void {
  const world = freeWorld;
  const k = kindOf(c);
  if (!world || k.aquatic || k.flying) return;
  const d = Math.hypot(x - c.x, y - c.y) || 1;
  for (let s = 3; s >= 1; s--) {
    const nx = c.x + ((x - c.x) / d) * s;
    const ny = c.y + ((y - c.y) / d) * s;
    if (!world.inside(nx, ny)) continue;
    const i = world.idx(nx, ny);
    if (world.depth[i] > 0.5 || world.materials.get("cover", world.cover[i]).solid || danger(world, i)) continue;
    c.x = nx;
    c.y = ny;
    return;
  }
  // Hemmed in by trees: a villager cuts a way through (the stump can be walked over).
  if (c.kind !== "villager") return;
  const i = world.idx(Math.max(0, Math.min(world.w - 1, c.x + (x - c.x) / d)), Math.max(0, Math.min(world.h - 1, c.y + (y - c.y) / d)));
  if (world.cover[i] === C.TREE) {
    world.setCover(i, C.STUMP);
    deed(c, "cut a path through the trees");
  }
}

function unstick(world: World, c: Creature, k: CreatureKind): void {
  for (let r = 1; r <= 4; r++)
    for (let a = 0; a < 8; a++) {
      const x = c.x + Math.cos((a / 8) * Math.PI * 2) * r;
      const y = c.y + Math.sin((a / 8) * Math.PI * 2) * r;
      if (!blocked(world, x, y, c, k) && !blocked(world, x + 1, y, c, k) && !blocked(world, x, y + 1, c, k)) {
        c.x = x;
        c.y = y;
        return;
      }
    }
}

// Out of the sun: under or beside a tree, or by a house.
// A creature an item placed arrives awake (2026-11-11): whatever its hours,
// it is awake for its first minute or until it has reached shade or its den,
// then keeps its hours. Before, a creature of the night placed by day lay
// asleep where it landed and the village killed it in seconds. One burnt by
// daylight still walks to the shade first (the branch this returns false for).
export const ARRIVAL_AWAKE = 60;

// A creature an item made that daylight burns keeps to the shade by day, as a
// creature of the night does, and is not burnt in its first minute while it
// walks there (2026-11-11: the most common death of a placed creature by day
// was a 30 health undead burnt in two and a half seconds where it landed).
function shunsDay(k: CreatureKind): boolean {
  return !!k.ai?.weak.includes("light") && !k.native && !BUILTIN_KINDS.has(k.name);
}

function arriving(world: World, c: Creature): boolean {
  const at = c.data.arrived as number | undefined;
  return at === undefined || (at >= 0 && world.time - at < ARRIVAL_AWAKE);
}

function arrivalAwake(world: World, c: Creature, k: CreatureKind, i: number, burnsByDay: boolean): boolean {
  if (k.native || BUILTIN_KINDS.has(k.name)) return false;
  const at = c.data.arrived as number | undefined;
  if (at === undefined) {
    c.data.arrived = world.time;
    return !(burnsByDay && !shaded(world, i));
  }
  if (at < 0) return false;
  // Only one that daylight burns ends its minute early, in the shade. A den
  // does not end it: a den is dug where the creature lies, so it was "reached"
  // the moment it landed (the playtest of 2026-11-11: a Werewolf asleep at 1 s).
  if (world.time - at >= ARRIVAL_AWAKE || world.time < at || (burnsByDay && shaded(world, i))) {
    c.data.arrived = -1;
    return false;
  }
  return !burnsByDay;
}

function shaded(world: World, i: number): boolean {
  for (const d of [0, 1, -1, world.w, -world.w]) {
    const j = i + d;
    if (j >= 0 && j < world.n && (world.cover[j] === C.TREE || world.cover[j] === C.HOUSE)) return true;
  }
  return false;
}

function shadeNear(world: World, c: Creature): { x: number; y: number } | null {
  const known = c.data.shade as { x: number; y: number } | undefined;
  if (known && world.cover[world.idx(known.x, known.y)] === C.TREE) return known;
  const found = nearest(world, c.x, c.y, 24, (j) => world.cover[j] === C.TREE);
  c.data.shade = found ?? undefined;
  return found;
}

function others(world: World, c: Creature, r: number, kinds: string[]): Creature | null {
  let best: Creature | null = null;
  let bestD = r;
  for (const o of world.crowd.near(world, c.x, c.y, r)) {
    if (o === c || o.dead) continue;
    if (kinds.length ? !names(kinds, o.kind) : o.kind === c.kind) continue;
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

// Sets c.tx, c.ty for the behavior; false when it has nothing to do and
// should just wander.
function behave(world: World, c: Creature, k: CreatureKind, ai: Behavior, dt: number): boolean {
  // Looking around costs a scan of everyone: do it a few times a second.
  const look = (c.data.look as number | undefined) ?? 0;
  c.data.look = look - dt;
  let target = c.data.target as Creature | undefined;
  if (look <= 0) {
    c.data.look = 0.3 + Math.random() * 0.2;
    if (ai.mode === "follow") target = others(world, c, ai.sense, ai.leader.length ? ai.leader : ["villager"]) ?? undefined;
    else if (ai.mode === "guard") target = others(world, c, ai.sense, ai.prey) ?? undefined;
    else target = others(world, c, ai.sense, ai.prey) ?? undefined;
    c.data.target = target;
  }
  if (target && (target.dead || Math.hypot(target.x - c.x, target.y - c.y) > ai.sense * 1.5)) target = undefined;
  switch (ai.mode) {
    case "hunt":
    case "guard": {
      if (ai.mode === "guard" && (!target || Math.hypot(target.x - c.homeX, target.y - c.homeY) > ai.sense)) {
        if (Math.hypot(c.homeX - c.x, c.homeY - c.y) > 3) {
          c.tx = c.homeX;
          c.ty = c.homeY;
          return true;
        }
        return false;
      }
      if (!target) return false;
      c.tx = target.x;
      c.ty = target.y;
      if (Math.hypot(target.x - c.x, target.y - c.y) < kindOf(c).radius * c.size + kindOf(target).radius * target.size + 0.6) {
        const blow = ai.attack * dt * (shieldedCreature(world, target) ? 0.15 : 1);
        target.hp -= blow;
        harmed(world, target, c, blow);
        if (c.data.struck !== target.id) {
          c.data.struck = target.id;
          deed(c, `attacked a ${target.kind.split("#")[0]}`);
        }
        if (target.hp <= 0 && ai.converts && world.creatures.length < 600) {
          // The victim rises as one of them.
          const ratio = 0.6;
          target.kind = c.kind;
          target.color = kindOf(c).color;
          target.hp = maxHp(target) * ratio;
          target.dead = false;
          target.fear = 0;
          target.data = {};
          reborn(target);
          world.particles.add({ x: target.x, y: target.y, z: 1, vz: 2, life: 1, color: kindOf(c).color, size: 2, glow: true });
          c.data.target = undefined;
          deed(c, "turned its victim into one of its own");
        } else if (target.hp <= 0) {
          target.dead = true;
          if (meter) meter.done(c, "catch");
          deed(c, `killed a ${target.kind.split("#")[0]}`);
        }
        if (target.kind === "villager" && target.fear <= 0) {
          target.fear = 3;
          target.fearX = c.x;
          target.fearY = c.y;
        }
      }
      return true;
    }
    case "follow": {
      if (!target) return false;
      const d = Math.hypot(target.x - c.x, target.y - c.y);
      if (d < 2.5) return false;
      c.tx = target.x;
      c.ty = target.y;
      return true;
    }
    case "flee": {
      if (!target) return false;
      c.tx = c.x + (c.x - target.x) * 2;
      c.ty = c.y + (c.y - target.y) * 2;
      return true;
    }
  }
  void k;
  return false;
}

// A creature that flees by nature (deer, rabbits, a spell's timid kinds)
// looks around a few times a second for what it runs from, and is alarmed
// by it at its sense (flight.ts keeps the alarm until it is well away). Not
// when tame, begging or starving: it has to eat.
function lookOut(world: World, c: Creature, ai: Behavior, dt: number): void {
  if (c.mind?.tame || c.mind?.task === "beg" || (c.mind?.hunger ?? 0) >= 0.85) return;
  const look = ((c.data.look as number | undefined) ?? 0) - dt;
  c.data.look = look;
  if (look > 0) return;
  c.data.look = 0.3 + Math.random() * 0.2;
  const o = others(world, c, ai.sense, ai.prey);
  if (o) alarm(world, c, o, o.x, o.y, ai.sense);
}

// Auras and trails, a few times a second.
function sideEffects(world: World, c: Creature, ai: Behavior, i: number, onGround: boolean, dt: number): void {
  if (ai.leaves && onGround && Math.random() < dt * 3) {
    if (ai.leaves === "fire") world.fire[i] = Math.max(world.fire[i], 0.6);
    else if (ai.leaves === "ice" && world.fluid[i] === F.WATER) world.fluid[i] = F.ICE;
    else if (ai.leaves === "flowers" || ai.leaves === "life") {
      if (world.ground[i] === G.DIRT || world.ground[i] === G.ASH) world.ground[i] = G.GRASS;
      if (world.cover[i] === C.NONE && Math.random() < 0.5) world.setCover(i, Math.random() < 0.7 ? C.FLOWER : C.BUSH);
    } else world.place(i, ai.leaves, 0.3);
    if (ai.leaves === "ice") world.temp[i] = Math.min(world.temp[i], -8);
    deed(c, `left ${ai.leaves} where it walked`);
  }
  if (!ai.aura || world.tick % 8 !== c.id % 8) return;
  // Asleep, a creature an item made touches no one with a harmful aura (a vampire
  // asleep by the houses froze 11 villagers in two minutes, none of them thawed).
  if (c.data.mood === "asleep" && ai.aura !== "heal" && ai.aura !== "calm" && !kindOf(c).native && !BUILTIN_KINDS.has(c.kind)) return;
  const r = ai.auraRadius;
  const p = ai.auraPower;
  let touched = 0;
  for (const o of world.crowd.near(world, c.x, c.y, r)) {
    if (o === c || o.dead || Math.abs(o.x - c.x) > r || Math.abs(o.y - c.y) > r || Math.hypot(o.x - c.x, o.y - c.y) > r) continue;
    if (o.kind !== c.kind) touched++;
    switch (ai.aura) {
      case "heal":
        if (o.hp < maxHp(o) && o.kind === "villager") harmed(world, o, c, -1);
        o.hp = Math.min(maxHp(o), o.hp + 10 * p * 0.27);
        o.burning = 0;
        break;
      case "hurt":
        if (o.kind !== c.kind && !shieldedCreature(world, o)) {
          o.hp -= 10 * p * 0.27;
          harmed(world, o, c, 10 * p * 0.27);
        }
        break;
      case "fear":
        if (o.kind !== c.kind) {
          o.fear = Math.max(o.fear, 2);
          o.fearX = c.x;
          o.fearY = c.y;
        }
        break;
      case "calm":
        o.calm = Math.max(o.calm, 1.5);
        o.fear = 0;
        break;
      case "sleep":
        if (o.kind !== c.kind) lull(world, o);
        break;
      case "burn":
        if (o.kind !== c.kind && !kindOf(o).fireproof) o.burning = Math.max(o.burning, 1);
        break;
      case "freeze":
        if (o.kind !== c.kind) o.frozen = Math.max(o.frozen, 1);
        break;
    }
    if (o.hp <= 0) o.dead = true;
  }
  if (touched && world.tick % 120 === c.id % 120) deed(c, `its ${ai.aura} aura touched ${touched} around it`);
  if (ai.aura === "freeze")
    forDisc(world, c.x, c.y, r, (j) => {
      world.temp[j] = Math.min(world.temp[j], -5);
      world.fire[j] = 0;
    });
  if (ai.aura === "burn" || ai.aura === "heal")
    world.particles.add({
      x: c.x + (Math.random() - 0.5) * r,
      y: c.y + (Math.random() - 0.5) * r,
      z: 0.5,
      vz: 1.5,
      life: 0.8,
      color: ai.aura === "heal" ? 0x9dffb0 : 0xff8a2a,
      size: 1,
      glow: true,
    });
}

function deathOf(world: World, c: Creature, what: string): void {
  if (what === "explode") explode(world, c.x, c.y, 3 + c.size * 2, 1);
  else if (what === "fire") forDisc(world, c.x, c.y, 2.5, (j) => (world.fire[j] = Math.max(world.fire[j], 0.8)));
  else if (what === "seeds")
    forDisc(world, c.x, c.y, 3, (j) => {
      if (world.depth[j] < 0.1 && Math.random() < 0.4) {
        world.ground[j] = G.GRASS;
        world.setCover(j, Math.random() < 0.5 ? C.TREE : C.FLOWER);
      }
    });
  else if (what === "ice")
    forDisc(world, c.x, c.y, 3, (j) => {
      world.temp[j] = -20;
      if (world.fluid[j] === F.WATER) world.fluid[j] = F.ICE;
    });
  else if (what.startsWith("spawn:")) {
    const kind = what.slice(6);
    if (KINDS.has(kind) && world.creatures.length < 600)
      for (let n = 0; n < 2; n++) world.creatures.push(makeCreature(kind, c.x + Math.random() - 0.5, c.y + Math.random() - 0.5));
  } else forDisc(world, c.x, c.y, 2, (j) => world.place(j, what, 0.6));
}

// Where a creature looks for danger: eight directions, at 1.5 and 3 cells.
// Each entry is the offset, then the push away from it (closer pushes harder).
const DANGER_PROBES: readonly (readonly [number, number, number, number])[] = [1.5, 3].flatMap((r) =>
  Array.from({ length: 8 }, (_, a) => {
    const ang = (a / 8) * Math.PI * 2;
    return [Math.cos(ang) * r, Math.sin(ang) * r, -Math.cos(ang) / r, -Math.sin(ang) / r] as const;
  }),
);

function senseDanger(world: World, c: Creature): { x: number; y: number } | null {
  let dx = 0;
  let dy = 0;
  let found = false;
  for (const [ox, oy, px, py] of DANGER_PROBES) {
    const x = Math.round(c.x + ox);
    const y = Math.round(c.y + oy);
    if (!world.inside(x, y)) continue;
    if (danger(world, y * world.w + x)) {
      dx += px;
      dy += py;
      found = true;
    }
  }
  return found ? { x: dx, y: dy } : null;
}

function nearest(world: World, x: number, y: number, r: number, test: (i: number) => boolean): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let k = 0; k < 40; k++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * r;
    const cx = Math.round(x + Math.cos(a) * d);
    const cy = Math.round(y + Math.sin(a) * d);
    if (!world.inside(cx, cy) || !test(cy * world.w + cx)) continue;
    if (d < bestD) {
      bestD = d;
      best = { x: cx, y: cy };
    }
  }
  return best;
}

// Everyday life: villagers potter around home and rebuild ruins; the rest roam.
function plan(world: World, c: Creature, k: CreatureKind, dt: number): void {
  c.goal -= dt;
  if (c.kind === "villager") {
    const ruin = c.data.ruin as { x: number; y: number } | undefined;
    if (ruin) {
      const i = world.idx(ruin.x, ruin.y);
      if (world.cover[i] !== C.RUBBLE) {
        c.data.ruin = undefined;
      } else if (Math.hypot(ruin.x - c.x, ruin.y - c.y) < 1.6) {
        const progress = ((c.data.work as number) ?? 0) + dt;
        c.data.work = progress;
        if (progress > 5) {
          world.setCover(i, C.HOUSE);
          if (world.settlements.length) world.patched.add(i);
          c.data.work = 0;
          c.data.ruin = undefined;
        }
        return;
      } else {
        c.tx = ruin.x;
        c.ty = ruin.y;
        return;
      }
    }
    if (c.goal <= 0 && Math.random() < 0.3) {
      const found = nearest(world, c.homeX, c.homeY, 10, (j) => world.cover[j] === C.RUBBLE);
      if (found) {
        c.data.ruin = found;
        return;
      }
    }
  }
  if (c.goal > 0) return;
  c.goal = 2 + Math.random() * 5;
  const range = k.homebody ? 9 : k.aquatic ? 10 : 25;
  const cx = k.homebody ? c.homeX : c.x;
  const cy = k.homebody ? c.homeY : c.y;
  for (let tries = 0; tries < 6; tries++) {
    const tx = cx + (Math.random() - 0.5) * 2 * range;
    const ty = cy + (Math.random() - 0.5) * 2 * range;
    if (!world.inside(tx, ty)) continue;
    const j = world.idx(tx, ty);
    if (k.aquatic ? !wet(world, j, 0.8) : !k.flying && (world.depth[j] > 0.3 || danger(world, j))) continue;
    c.tx = tx;
    c.ty = ty;
    return;
  }
}

// Fills a fresh world with people near their houses and animals in the wild:
// every species, or only those named (challenges keep to birds and fish: a
// rabbit set alight by a volcano ran into the village and burned it, which
// no spell could have prevented).
export function populate(world: World, wild: readonly string[] | null = null): void {
  const houses: number[] = [];
  for (let i = 0; i < world.n; i++) if (world.cover[i] === C.HOUSE) houses.push(i);
  for (let k = 0; k < houses.length; k += 3) {
    const i = houses[k];
    for (let n = 0; n < 2; n++) {
      const c = makeCreature("villager", (i % world.w) + 0.5 + Math.random() * 3 - 1.5, Math.floor(i / world.w) + 2.5);
      c.homeX = c.x;
      c.homeY = c.y;
      world.creatures.push(c);
    }
  }
  dressVillages(world, world.creatures);
  // The island's animals, each in its habitat. The generic beast of 2.x is
  // left to spells.
  // On islands made by land.ts, every animal with a target is there from the
  // start (4.4.5 part B); the old island and the challenges keep their streams.
  for (const s of SPECIES) if (!wild || wild.includes(s.kind.name)) for (let n = targetOf(world, s); n > 0; n--) birth(world, s.kind.name, !!world.flora);
  world.wild = wild;
}

// One wild animal born in its habitat, if there is any left.
function birth(world: World, name: string, sure = false): boolean {
  const s = SPECIES.find((sp) => sp.kind.name === name);
  if (!s) return false;
  const i = sure ? habitatCellSure(world, s) : habitatCell(world, s);
  if (i < 0) return false;
  // world.idx rounds: a creature at x stands in cell round(x).
  const c = makeCreature(name, (i % world.w) + (Math.random() - 0.5) * 0.6, Math.floor(i / world.w) + (Math.random() - 0.5) * 0.6);
  c.homeX = c.x;
  c.homeY = c.y;
  world.creatures.push(c);
  return true;
}

// Wild animals come back, slowly, while their habitat lasts: one at a time,
// for the species furthest below its number. Only the island's own kinds
// (a spell's wolves are its own business).
function keepWild(world: World): void {
  const alive = new Map<string, number>();
  for (const c of world.creatures) if (!c.dead) alive.set(c.kind, (alive.get(c.kind) ?? 0) + 1);
  let worst: string | null = null;
  let worstShare = 1;
  for (const s of SPECIES) {
    if (!KINDS.get(s.kind.name)?.native || (world.wild && !world.wild.includes(s.kind.name))) continue;
    // Fish breed on their own (goals.ts, migrate): restocked only once gone.
    if (s.kind.aquatic && (alive.get(s.kind.name) ?? 0) > 0) continue;
    const share = (alive.get(s.kind.name) ?? 0) / targetOf(world, s);
    if (share < worstShare) {
      worstShare = share;
      worst = s.kind.name;
    }
  }
  if (worst && world.creatures.length < 500) birth(world, worst);
}

// Slow life: a new villager now and then while houses stand, the dead fade away.
// A creature standing under a ward against harm.
export function shieldedCreature(world: World, c: Creature): boolean {
  if (!world.wards.length) return false;
  const x = Math.max(0, Math.min(world.w - 1, Math.round(c.x)));
  const y = Math.max(0, Math.min(world.h - 1, Math.round(c.y)));
  return warded(world, y * world.w + x, WARD.harm);
}

// Does this creature threaten what a ward protects? Hunters and guards that
// attack people (or anyone), creatures with a harmful aura, and those whose
// victims rise as their own kind. A guard a spell set to fight only the
// undead is no threat to the village it stands in.
export function hostile(c: Creature): boolean {
  const ai = kindOf(c).ai;
  if (!ai) return false;
  if ((ai.mode === "hunt" || ai.mode === "guard") && ai.attack > 0 && (!ai.prey.length || names(ai.prey, "villager"))) return true;
  return ai.converts || ai.aura === "hurt" || ai.aura === "burn" || ai.aura === "freeze";
}

// The ward a frightened creature runs to: one that keeps out what hunts or
// burns, close enough to reach.
function shelterFor(world: World, c: Creature): { x: number; y: number; r: number } | null {
  let best: { x: number; y: number; r: number } | null = null;
  let bestD = Infinity;
  for (const w of world.wards) {
    if (!(w.against & (WARD.creatures | WARD.fire | WARD.harm))) continue;
    const d = Math.hypot(w.x - c.x, w.y - c.y) - w.r;
    if (d < 14 && d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

// Wards against creatures push the hostile ones out to their edge.
function keepOut(world: World): void {
  for (const ward of world.wards) {
    if (!(ward.against & WARD.creatures)) continue;
    for (const c of world.creatures) {
      if (c.dead) continue;
      const dx = c.x - ward.x;
      const dy = c.y - ward.y;
      const d = Math.hypot(dx, dy);
      if (d > ward.r + 0.8) continue;
      const out = ward.keepOut.length ? names(ward.keepOut, c.kind) : false;
      if (!out && (!hostile(c) || names(ward.allow, c.kind))) continue;
      const ux = d > 0.01 ? dx / d : 1;
      const uy = d > 0.01 ? dy / d : 0;
      c.x = Math.max(0.5, Math.min(world.w - 1.5, ward.x + ux * (ward.r + 1.2)));
      c.y = Math.max(0.5, Math.min(world.h - 1.5, ward.y + uy * (ward.r + 1.2)));
      // Whatever speed carried it inward is gone.
      const inward = c.vx * ux + c.vy * uy;
      if (inward < 0) {
        c.vx -= inward * ux;
        c.vy -= inward * uy;
      }
      // Each push wears the ward a little (4.7): a hostile pressing on it is
      // pushed about every tick, so about 3 a second each; raiders crack a
      // ward, never break it (wards.ts, PRESSURE).
      damageWard(world, ward, 0.1, "creatures");
    }
  }
}

// A creature put into the world where a wonder makes one (fish in a
// sinkhole, birds on sea stacks, the risen from bones, a dragon).
function spawner(world: World): (kind: string, x: number, y: number) => Creature {
  return (kind, x, y) => {
    const c = makeCreature(kind, x, y);
    c.homeX = x;
    c.homeY = y;
    world.creatures.push(c);
    return c;
  };
}

setBlastSpawn(spawner);

export function lifeCycle(world: World, dt: number): void {
  stepGoals(world);
  pathsOf(world).step(world);
  if (world.wards.length) keepOut(world);
  stepLandmarks(world, maxHp, (c) => kindOf(c).fireproof);
  stepArtifacts(world);
  for (let k = world.creatures.length - 1; k >= 0; k--) {
    if (world.creatures[k].dead && world.creatures[k].deadFor > 40) world.creatures.splice(k, 1);
  }
  if (world.flora) {
    // 4.4.5: numbers that follow food, arrivals, refuges; paths worn in,
    // villages that grow.
    if (Math.random() < dt * 0.2) keepBalance(world, makeCreature);
    if (world.tick % 60 === 7) stepMovers(world);
    if (world.tick % 30 === 11) wearPaths(world);
    // 4.9: villages that trade lay roads between them.
    stepRoads(world);
    if (world.tick % 600 === 13) growSettlements(world);
    // 4.4.5 part B: what wonders and buildings with a job do.
    if (world.tick % 600 === 13) growBuildings(world);
    if (world.wonders.length) stepWonders(world, spawner(world), { kindOf, maxHp });
    if (world.settlements.length) stepBuildings(world, { kindOf, maxHp });
  } else if (Math.random() < dt * 0.2) keepWild(world);
  if (Math.random() > dt * 0.15) return;
  let houses = 0;
  for (let i = 0; i < world.n; i++) if (world.cover[i] === C.HOUSE) houses++;
  const villagers = world.creatures.filter((c) => !c.dead && c.kind === "villager").length;
  // Each 2 by 2 house shelters about one and a half people.
  if (villagers >= (houses / 4) * 1.5 || villagers > 200) return;
  for (let tries = 0; tries < 50; tries++) {
    const i = (Math.random() * world.n) | 0;
    if (world.cover[i] !== C.HOUSE) continue;
    // A child is born where there is food to spare (3.6).
    const village = villageOf(world, i % world.w, Math.floor(i / world.w));
    if (village) {
      if (village.food < 4) return;
      village.food -= 3;
    }
    const c = makeCreature("villager", (i % world.w) + 0.5, Math.floor(i / world.w) + 2.5);
    // Born here: a child, in this village's clothes.
    const look = randomLook(styleNear(world, c.x, c.y), Math.random, Math.random() < 0.6 ? "child" : undefined);
    c.look = packLook(look);
    c.size = sizeOf(look);
    c.hp = maxHp(c);
    c.color = shirtOf(look);
    world.creatures.push(c);
    tell(world, "a child was born in the village");
    return;
  }
}
