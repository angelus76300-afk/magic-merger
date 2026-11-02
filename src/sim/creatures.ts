import { C, F, G, S } from "./materials";
import { explode, forDisc } from "./physics";
import { lull, social, stepLandmarks, type Mood } from "./social";
import { daylight } from "./voxel/daylight";
import type { World } from "./world";

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
  tick?: (self: Creature, dt: number) => void;
  fallback?: string;
  ai?: Behavior;
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
  ...k,
});
for (const k of [
  kind({ name: "villager", speed: 3.2, hp: 100, radius: 0.55, color: 0xd64545, homebody: true }),
  kind({ name: "beast", speed: 4.5, hp: 80, radius: 0.75, color: 0xe8e2d0 }),
  kind({ name: "spirit", speed: 2.5, hp: 60, radius: 0.6, color: 0xc9f6ff, flying: true, fireproof: true, glow: true }),
  kind({ name: "golem", speed: 1.8, hp: 300, radius: 1, color: 0x8d8d96, fireproof: true }),
]) {
  KINDS.set(k.name, k);
}

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
  // Free data for spell defined behavior.
  data: Record<string, unknown>;
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

const SHIRTS = [0xd64545, 0x3f7fd9, 0xe0a030, 0x5aa65a, 0x9b59b6, 0xe67e22, 0x16a085, 0xc0c0c0];

export function makeCreature(kindName: string, x: number, y: number): Creature {
  const k = KINDS.get(kindName) ?? KINDS.get("villager")!;
  return {
    id: nextId++,
    kind: k.name,
    x,
    y,
    z: k.flying ? 2 : 0,
    vx: 0,
    vy: 0,
    vz: 0,
    hp: k.hp,
    size: 1,
    color: k.name === "villager" ? SHIRTS[(Math.random() * SHIRTS.length) | 0] : k.color,
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
    data: {},
  };
}

export function restoreCreature(raw: Partial<Creature>): Creature | null {
  if (typeof raw.x !== "number" || typeof raw.y !== "number" || typeof raw.kind !== "string") return null;
  const c = makeCreature(raw.kind, raw.x, raw.y);
  return { ...c, ...raw, id: c.id, data: {} };
}

// Is the cell dangerous to stand on or next to?
function danger(world: World, i: number): boolean {
  return world.fire[i] > 0.15 || world.fluid[i] === F.LAVA || world.fluid[i] === F.ACID || world.gas[i] === S.POISON;
}

function blocked(world: World, x: number, y: number, c: Creature, k: CreatureKind): boolean {
  if (!world.inside(x, y)) return true;
  if (k.flying || c.levitate > 0 || c.z > 1.5) return false;
  const i = world.idx(x, y);
  const cover = world.materials.get("cover", world.cover[i]);
  if (cover.solid) return true;
  // Deep water and any lava are walls for those who would die in them.
  const f = world.fluid[i];
  if (f !== F.NONE && f !== F.ICE && world.depth[i] > 0.05) {
    if (f === F.LAVA && !k.fireproof) return true;
    if (world.depth[i] > 1 && !k.swims) return true;
  }
  // Cliffs: too steep a step up (ice and fluids count as the surface you walk on).
  const here = world.level(world.idx(c.x, c.y));
  return world.level(i) - here > 1.6;
}

export function updateCreature(world: World, c: Creature, dt: number): void {
  const k = kindOf(c);
  if (c.dead) {
    if (c.deadFor === 0 && k.ai?.onDeath) deathOf(world, c, k.ai.onDeath);
    c.deadFor += dt;
    c.z = Math.max(0, c.z + c.vz * dt);
    c.vz -= 30 * dt;
    return;
  }
  for (const s of ["frozen", "fear", "sleep", "calm", "levitate", "stun"] as const) c[s] = Math.max(0, c[s] - dt);

  const i = world.idx(Math.max(0, Math.min(world.w - 1, c.x)), Math.max(0, Math.min(world.h - 1, c.y)));
  const onGround = c.z < 0.5 && !k.flying && c.levitate <= 0;

  const ai = k.ai;
  const weak = (e: string) => !!ai && ai.weak.includes(e);
  const immune = (e: string) => !!ai && ai.immune.includes(e);
  if (ai) {
    const age = ((c.data.age as number) ?? 0) + dt;
    c.data.age = age;
    if (ai.lifespan > 0 && age > ai.lifespan) c.hp = 0;
    if (weak("water") && world.fluid[i] === F.WATER && world.depth[i] > 0.05) c.hp -= 40 * dt;
    if (weak("water") && world.gas[i] === S.STEAM) c.hp -= 10 * dt;
    if (weak("cold") && world.temp[i] < 2) c.hp -= 25 * dt;
    if (weak("fire") && (c.burning > 0 || world.temp[i] > 80)) c.hp -= 30 * dt;
    if (weak("acid") && world.fluid[i] === F.ACID) c.hp -= 60 * dt;
    if (weak("light") && world.tick % 15 === 0 && daylight(world.time).night < 0.3) {
      c.hp -= 12 * 0.5;
      if (Math.random() < 0.3) world.particles.add({ x: c.x, y: c.y, z: 1, vz: 2, life: 0.6, color: 0xfff0c0, size: 1, glow: true });
    }
    if (immune("cold")) c.frozen = 0;
    if (immune("fire")) c.burning = 0;
  }

  // The land hurts.
  if (onGround) {
    if (world.fire[i] > 0.25 && !k.fireproof && !immune("fire")) c.burning = Math.max(c.burning, 3);
    const fluid = world.materials.get("fluid", world.fluid[i]);
    if (world.depth[i] > 0.05 && fluid.hurts > 0 && !(k.fireproof && world.fluid[i] === F.LAVA) && !(immune("acid") && world.fluid[i] === F.ACID))
      c.hp -= fluid.hurts * dt;
    if (world.fluid[i] === F.WATER && world.depth[i] > 0.25) c.burning = 0;
    if (world.fluid[i] === F.WATER && world.depth[i] > 1.4 && !k.swims && !immune("water")) {
      c.drowning += dt;
      if (c.drowning > 4) c.hp -= 12 * dt;
    } else c.drowning = Math.max(0, c.drowning - dt);
    if (world.temp[i] < -12 && !k.fireproof && !immune("cold")) c.frozen = Math.max(c.frozen, 0.5);
  }
  if (world.gas[i] !== S.NONE) {
    const gas = world.materials.get("gas", world.gas[i]);
    if (gas.hurts > 0) c.hp -= gas.hurts * world.gasAmt[i] * dt;
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

  // Decide where to go.
  const busy = c.frozen > 0 || c.sleep > 0 || c.stun > 0;
  let wantX = 0;
  let wantY = 0;
  let pace = 1;
  let mood: Mood = null;
  let plan2: ReturnType<typeof social> = null;
  if (!busy) {
    const dangerDir = senseDanger(world, c);
    if (c.fear > 0) {
      const dx = c.x - c.fearX;
      const dy = c.y - c.fearY;
      const d = Math.hypot(dx, dy) || 1;
      wantX = dx / d;
      wantY = dy / d;
      pace = 1.6;
    } else if (c.burning > 0) {
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
    } else if (c.calm > 0) {
      pace = 0;
    } else if (ai && ai.active !== "always" && daylight(world.time).night > 0.5 !== (ai.active === "night")) {
      // Out of its hours it rests where it is.
      pace = 0;
      mood = "asleep";
    } else if ((plan2 = social(world, c, k, kindOf, dt))) {
      wantX = plan2.x - c.x;
      wantY = plan2.y - c.y;
      pace = plan2.pace;
      mood = plan2.mood;
    } else if (ai && ai.mode !== "wander" && behave(world, c, k, ai, dt)) {
      wantX = c.tx - c.x;
      wantY = c.ty - c.y;
      pace = ai.mode === "flee" || ai.mode === "hunt" ? 1.3 : 1;
      if (Math.hypot(wantX, wantY) < 0.4) pace = 0;
      if (ai.mode === "hunt" && c.data.target) mood = "hunt";
    } else {
      plan(world, c, k, dt);
      wantX = c.tx - c.x;
      wantY = c.ty - c.y;
      if (Math.hypot(wantX, wantY) < 0.6) pace = 0;
    }
  }

  const len = Math.hypot(wantX, wantY);
  if (len > 0 && pace > 0) {
    let speed = k.speed * pace * Math.sqrt(c.size);
    if (onGround && world.depth[i] > 0.3 && world.fluid[i] !== F.ICE) speed *= 0.5;
    if (onGround && world.fluid[i] === F.MUD) speed *= 0.3;
    const sx = (wantX / len) * speed * dt;
    const sy = (wantY / len) * speed * dt;
    if (!blocked(world, c.x + sx * 3, c.y + sy * 3, c, k)) {
      c.x += sx;
      c.y += sy;
    } else if (!blocked(world, c.x - sy * 3, c.y + sx * 3, c, k)) {
      // Step around the obstacle.
      c.x -= sy;
      c.y += sx;
    } else c.goal = 0;
  }

  // Being thrown, lifted or knocked around.
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  const friction = c.z > 0.2 ? 0.6 : 6;
  c.vx -= c.vx * Math.min(1, friction * dt);
  c.vy -= c.vy * Math.min(1, friction * dt);
  if (k.flying || c.levitate > 0) {
    const target = c.levitate > 0 ? 4 + Math.sin(world.time * 2 + c.id) * 0.8 : 2;
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
  if (c.fear > 0 || c.burning > 0) mood = "fear";
  c.data.mood = busy ? (c.sleep > 0 ? "asleep" : null) : mood;
  if (c.hp <= 0) c.dead = true;

  if (k.tick) k.tick(c, dt);
}

function others(world: World, c: Creature, r: number, kinds: string[]): Creature | null {
  let best: Creature | null = null;
  let bestD = r;
  for (const o of world.creatures) {
    if (o === c || o.dead) continue;
    if (kinds.length ? !kinds.includes(o.kind) : o.kind === c.kind) continue;
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
        target.hp -= ai.attack * dt;
        if (target.hp <= 0 && ai.converts && world.creatures.length < 600) {
          // The victim rises as one of them.
          const ratio = 0.6;
          target.kind = c.kind;
          target.color = kindOf(c).color;
          target.hp = maxHp(target) * ratio;
          target.dead = false;
          target.fear = 0;
          target.data = {};
          world.particles.add({ x: target.x, y: target.y, z: 1, vz: 2, life: 1, color: kindOf(c).color, size: 2, glow: true });
          c.data.target = undefined;
        } else if (target.hp <= 0) target.dead = true;
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
  }
  if (!ai.aura || world.tick % 8 !== c.id % 8) return;
  const r = ai.auraRadius;
  const p = ai.auraPower;
  for (const o of world.creatures) {
    if (o === c || o.dead || Math.abs(o.x - c.x) > r || Math.abs(o.y - c.y) > r || Math.hypot(o.x - c.x, o.y - c.y) > r) continue;
    switch (ai.aura) {
      case "heal":
        o.hp = Math.min(maxHp(o), o.hp + 10 * p * 0.27);
        o.burning = 0;
        break;
      case "hurt":
        if (o.kind !== c.kind) o.hp -= 10 * p * 0.27;
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

function senseDanger(world: World, c: Creature): { x: number; y: number } | null {
  let dx = 0;
  let dy = 0;
  let found = false;
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    for (const r of [1.5, 3]) {
      const x = Math.round(c.x + Math.cos(ang) * r);
      const y = Math.round(c.y + Math.sin(ang) * r);
      if (!world.inside(x, y)) continue;
      if (danger(world, y * world.w + x)) {
        dx -= Math.cos(ang) / r;
        dy -= Math.sin(ang) / r;
        found = true;
      }
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
  const range = k.homebody ? 9 : 25;
  const cx = k.homebody ? c.homeX : c.x;
  const cy = k.homebody ? c.homeY : c.y;
  for (let tries = 0; tries < 6; tries++) {
    const tx = cx + (Math.random() - 0.5) * 2 * range;
    const ty = cy + (Math.random() - 0.5) * 2 * range;
    if (!world.inside(tx, ty)) continue;
    const j = world.idx(tx, ty);
    if (!k.flying && (world.depth[j] > 0.3 || danger(world, j))) continue;
    c.tx = tx;
    c.ty = ty;
    return;
  }
}

// Fills a fresh world with people near their houses and animals in the wild.
export function populate(world: World): void {
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
  const beasts = Math.round(world.n / 3000);
  for (let k = 0; k < beasts * 10 && world.creatures.filter((c) => c.kind === "beast").length < beasts; k++) {
    const x = Math.random() * world.w;
    const y = Math.random() * world.h;
    const i = world.idx(x, y);
    if (world.depth[i] > 0 || world.materials.get("cover", world.cover[i]).solid) continue;
    world.creatures.push(makeCreature("beast", x, y));
  }
}

// Slow life: a new villager now and then while houses stand, the dead fade away.
export function lifeCycle(world: World, dt: number): void {
  stepLandmarks(world, maxHp, (c) => kindOf(c).fireproof);
  for (let k = world.creatures.length - 1; k >= 0; k--) {
    if (world.creatures[k].dead && world.creatures[k].deadFor > 40) world.creatures.splice(k, 1);
  }
  if (Math.random() > dt * 0.15) return;
  let houses = 0;
  for (let i = 0; i < world.n; i++) if (world.cover[i] === C.HOUSE) houses++;
  const villagers = world.creatures.filter((c) => !c.dead && c.kind === "villager").length;
  // Each 2 by 2 house shelters about one and a half people.
  if (villagers >= (houses / 4) * 1.5 || villagers > 200) return;
  for (let tries = 0; tries < 50; tries++) {
    const i = (Math.random() * world.n) | 0;
    if (world.cover[i] !== C.HOUSE) continue;
    const c = makeCreature("villager", (i % world.w) + 0.5, Math.floor(i / world.w) + 2.5);
    world.creatures.push(c);
    return;
  }
}
