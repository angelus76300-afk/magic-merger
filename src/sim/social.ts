import { C, F, G } from "./materials";
import type { World } from "./world";
import type { Creature, CreatureKind } from "./creatures";

// How creatures notice each other and the things spells put in the world.
// Anything can declare whom it lures and whom it scares: a material (gold
// lures villagers), a creature (a dragon scares everyone), or a landmark (a
// relic scares the undead). Villagers and beasts react by themselves:
//
//   flee     from what scares them and from whatever hunts them
//   fight    as a mob, when enough villagers face something weak enough
//   go       toward what lures them, and take it home if it can be taken
//   guard    golems attack what hunts villagers
//
// A villager who brings something home makes the village richer; a rich
// village builds new houses. So gold placed by a spell grows a village.

// A place that lures or scares: cells of a spell material, or a landmark.
export interface Presence {
  x: number;
  y: number;
  lures: string[];
  scares: string[];
  // Whoever reaches it takes it away (the cell is cleared).
  taken: boolean;
  color: number;
}

// Something a spell placed that acts on those around it for good: a shrine,
// a totem, a cursed stone. It has no body; the spell builds its look.
export interface Landmark extends Presence {
  name: string;
  radius: number;
  aura: string | null;
  power: number;
}

export type Mood = "fear" | "lured" | "carry" | "angry" | "hunt" | "asleep" | null;

// Kinds a list names, with a few plain words players and Claude use.
export function names(list: string[], kind: string): boolean {
  if (!list.length) return false;
  if (list.includes(kind) || list.includes("all") || list.includes("everyone")) return true;
  if (kind === "villager" && (list.includes("humans") || list.includes("people") || list.includes("villagers"))) return true;
  if (kind === "beast" && (list.includes("animals") || list.includes("beasts"))) return true;
  return false;
}

// Does o hunt creatures of c's kind?
function hunts(o: Creature, ok: CreatureKind, c: Creature): boolean {
  const ai = ok.ai;
  if (!ai || ai.mode !== "hunt") return false;
  return ai.prey.length ? names(ai.prey, c.kind) : o.kind !== c.kind;
}

export interface Plan {
  x: number;
  y: number;
  pace: number;
  mood: Mood;
}

// What a creature wants to do because of others around it, or null. Looks
// around a few times a second and remembers what it saw in between.
export function social(world: World, c: Creature, k: CreatureKind, kindOf: (c: Creature) => CreatureKind, dt: number): Plan | null {
  const look = ((c.data.socialLook as number | undefined) ?? 0) - dt;
  c.data.socialLook = look;
  if (look <= 0) {
    c.data.socialLook = 0.3 + Math.random() * 0.25;
    c.data.social = see(world, c, k, kindOf);
  }
  const seen = c.data.social as Seen | undefined;
  if (!seen) return null;

  // Carrying something home comes before everything but danger.
  if (c.data.carry !== undefined && !seen.threat) {
    const d = Math.hypot(c.homeX - c.x, c.homeY - c.y);
    if (d < 1.5) {
      deposit(world, c);
      return null;
    }
    return { x: c.homeX, y: c.homeY, pace: 1, mood: "carry" };
  }

  if (seen.threat && !seen.threat.dead) {
    const t = seen.threat;
    if (seen.fight) {
      attack(c, t, seen.fight, dt);
      return { x: t.x, y: t.y, pace: 1.3, mood: "angry" };
    }
    // A place that scares the threat is a refuge: run there if one is near.
    let refuge: Landmark | null = null;
    let refugeD = 22;
    for (const l of world.landmarks) {
      if (!names(l.scares, t.kind)) continue;
      const d = Math.hypot(l.x - c.x, l.y - c.y);
      if (d < refugeD) {
        refugeD = d;
        refuge = l;
      }
    }
    if (refuge && refugeD > 1.5) return { x: refuge.x + 0.5, y: refuge.y + 0.5, pace: 1.5, mood: "fear" };
    if (refuge) return { x: c.x, y: c.y, pace: 0, mood: "fear" };
    return { ...fleeFrom(world, c, t.x, t.y), pace: 1.5, mood: "fear" };
  }
  if (seen.scary) return { ...fleeFrom(world, c, seen.scary.x, seen.scary.y), pace: 1.3, mood: "fear" };
  if (seen.lure && world.time >= ((c.data.boredUntil as number | undefined) ?? 0)) {
    const p = seen.lure;
    const d = Math.hypot(p.x + 0.5 - c.x, p.y + 0.5 - c.y);
    if (d < 1.3 + (p.taken ? 0 : 1.5)) {
      if (p.taken) {
        take(world, c, p);
        return null;
      }
      // Linger by what lures it for a while, then lose interest and go back
      // to everyday life, so a shrine draws visits rather than a crowd forever.
      const since = (c.data.lingerFrom as number | undefined) ?? world.time;
      c.data.lingerFrom = since;
      if (world.time - since > LINGER) {
        c.data.boredUntil = world.time + BORED;
        c.data.lingerFrom = undefined;
        return null;
      }
      return { x: c.x, y: c.y, pace: 0, mood: "lured" };
    }
    return { x: p.x + 0.5, y: p.y + 0.5, pace: 1.1, mood: "lured" };
  }
  return null;
}

// The best open way out: of eight directions, the one that ends furthest from
// the danger on walkable land (not deep water, a cliff, a tree or a house).
function fleeFrom(world: World, c: Creature, fx: number, fy: number): { x: number; y: number } {
  let best = { x: c.x + (c.x - fx), y: c.y + (c.y - fy) };
  let bestScore = -Infinity;
  const here = world.level(world.idx(Math.max(0, Math.min(world.w - 1, c.x)), Math.max(0, Math.min(world.h - 1, c.y))));
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    let x = c.x;
    let y = c.y;
    let ok = 0;
    let level = here;
    // Walk a few steps; stop at the first wall.
    for (let s = 1; s <= 4; s++) {
      const nx = c.x + Math.cos(ang) * s * 1.2;
      const ny = c.y + Math.sin(ang) * s * 1.2;
      if (!world.inside(Math.round(nx), Math.round(ny))) break;
      const i = world.idx(nx, ny);
      if (world.depth[i] > 1 || world.level(i) - level > 1.6 || world.materials.get("cover", world.cover[i]).solid) break;
      level = world.level(i);
      x = nx;
      y = ny;
      ok = s;
    }
    if (!ok) continue;
    const score = Math.hypot(x - fx, y - fy) + ok * 0.2;
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }
  return best;
}

// Seconds a creature stays by something that lures it, then how long it
// ignores lures before it may come back.
const LINGER = 6;
const BORED = 30;

interface Seen {
  threat: Creature | null;
  // Damage per second this creature deals when it fights the threat.
  fight: number;
  scary: { x: number; y: number } | null;
  lure: Presence | null;
}

function see(world: World, c: Creature, k: CreatureKind, kindOf: (c: Creature) => CreatureKind): Seen {
  const seen: Seen = { threat: null, fight: 0, scary: null, lure: null };
  const sense = k.ai?.sense ?? 14;
  let threatD = 9;
  let lureD = sense;
  let allies = 0;
  // Creatures: hunters, scary ones, lures, and how many friends stand close.
  for (const o of world.creatures) {
    if (o === c || o.dead) continue;
    const dx = o.x - c.x;
    const dy = o.y - c.y;
    if (Math.abs(dx) > sense || Math.abs(dy) > sense) continue;
    const d = Math.hypot(dx, dy);
    if (o.kind === c.kind && d < 6 && o.burning <= 0) allies++;
    const ok = kindOf(o);
    const guarding = c.kind === "golem" && !k.ai && o.kind !== "villager" && hunts(o, ok, { ...c, kind: "villager" });
    const scary = !!ok.ai && names(ok.ai.scares, c.kind) && !names(k.ai?.immune ?? [], "fear");
    if ((hunts(o, ok, c) || scary || guarding) && d < (guarding ? 12 : threatD)) {
      threatD = d;
      seen.threat = o;
      seen.fight = guarding ? 25 : 0;
    }
    if (ok.ai && names(ok.ai.lures, c.kind) && d < lureD) {
      lureD = d;
      seen.lure = { x: o.x - 0.5, y: o.y - 0.5, lures: ok.ai.lures, scares: [], taken: false, color: ok.color };
    }
  }
  // A mob of villagers stands up to a threat they can handle.
  if (seen.threat && !seen.fight && c.kind === "villager" && allies >= 2) {
    const t = seen.threat;
    if (t.hp < 90 * (allies + 1)) seen.fight = 8;
  }
  if (seen.threat) return seen;
  // Places: material cells and landmarks.
  let scaryD = 8;
  for (const p of [...world.lures, ...world.landmarks]) {
    const dx = p.x + 0.5 - c.x;
    const dy = p.y + 0.5 - c.y;
    if (Math.abs(dx) > sense || Math.abs(dy) > sense) continue;
    const d = Math.hypot(dx, dy);
    const reach = "radius" in p ? Math.max(scaryD, (p as Landmark).radius) : scaryD;
    if (names(p.scares, c.kind) && d < reach) {
      scaryD = d;
      seen.scary = { x: p.x + 0.5, y: p.y + 0.5 };
    }
    if (names(p.lures, c.kind) && d < lureD) {
      lureD = d;
      seen.lure = p;
    }
  }
  if (seen.scary) seen.lure = null;
  return seen;
}

function attack(c: Creature, t: Creature, dps: number, dt: number): void {
  if (Math.hypot(t.x - c.x, t.y - c.y) > 1.6 + t.size * 0.5) return;
  t.hp -= dps * dt;
  if (t.hp <= 0) t.dead = true;
}

// Picks up the thing at a lure: the cell is cleared and carried home.
function take(world: World, c: Creature, p: Presence): void {
  const i = Math.round(p.y) * world.w + Math.round(p.x);
  if (i < 0 || i >= world.n) return;
  const custom = world.materials;
  const name = (layer: "ground" | "cover" | "fluid") =>
    custom.get(layer, layer === "ground" ? world.ground[i] : layer === "cover" ? world.cover[i] : world.fluid[i]).name;
  const lureNames = new Set(world.lureMaterials.keys());
  if (lureNames.has(name("cover"))) world.setCover(i, C.NONE);
  else if (lureNames.has(name("ground"))) world.ground[i] = G.DIRT;
  else if (lureNames.has(name("fluid"))) world.setFluid(i, F.NONE, 0);
  else return;
  // Beasts eat what they take and are done with it.
  if (c.kind !== "villager") {
    c.hp += 20;
    return;
  }
  c.data.carry = p.color;
  world.lures = world.lures.filter((q) => q !== p);
}

// A villager brings home what it carried; every few gifts the village builds a house.
function deposit(world: World, c: Creature): void {
  c.data.carry = undefined;
  world.wealth++;
  world.particles.add({ x: c.x, y: c.y, z: 1.5, vz: 2, life: 1, color: 0xffd36a, size: 1.4, glow: true });
  if (world.wealth % 4 !== 0) return;
  // A 2 by 2 house on dry free land near home.
  for (let tries = 0; tries < 30; tries++) {
    const hx = Math.round(c.homeX + (Math.random() - 0.5) * 16);
    const hy = Math.round(c.homeY + (Math.random() - 0.5) * 16);
    if (!world.inside(hx, hy) || !world.inside(hx + 1, hy + 1)) continue;
    const cells = [hy * world.w + hx, hy * world.w + hx + 1, (hy + 1) * world.w + hx, (hy + 1) * world.w + hx + 1];
    const base = world.height[cells[0]];
    if (cells.some((i) => world.depth[i] > 0.05 || world.cover[i] !== C.NONE || Math.abs(world.height[i] - base) > 1.2)) continue;
    for (const i of cells) {
      world.ground[i] = G.DIRT;
      world.setCover(i, C.HOUSE);
    }
    world.emit({ kind: "sound", name: "thump", size: 0.4 });
    return;
  }
}

// Puts a creature to sleep for a moment, unless it just woke from such a
// sleep: an aura is a lullaby, not a trap nobody can ever walk out of.
export function lull(world: World, o: Creature): void {
  if (world.time < ((o.data.wideAwake as number | undefined) ?? 0)) return;
  o.sleep = Math.max(o.sleep, 3);
  o.data.wideAwake = world.time + 3 + 15;
}

// Landmark auras, a few times a second.
export function stepLandmarks(world: World, maxHp: (c: Creature) => number, fireproof: (c: Creature) => boolean): void {
  if (!world.landmarks.length || world.tick % 8 !== 0) return;
  for (const l of world.landmarks) {
    if (!l.aura) continue;
    for (const o of world.creatures) {
      if (o.dead || Math.abs(o.x - l.x) > l.radius || Math.abs(o.y - l.y) > l.radius) continue;
      if (Math.hypot(o.x - l.x, o.y - l.y) > l.radius) continue;
      // A landmark that names whom it scares aims its aura: harmful ones touch
      // only those kinds, kind ones (heal, calm) spare them.
      if (l.scares.length) {
        const harmful = l.aura !== "heal" && l.aura !== "calm";
        if (harmful !== names(l.scares, o.kind)) continue;
      }
      const p = l.power * 0.27;
      switch (l.aura) {
        case "heal":
          o.hp = Math.min(maxHp(o), o.hp + 10 * p);
          o.burning = 0;
          break;
        case "hurt":
          o.hp -= 10 * p;
          break;
        case "calm":
          o.calm = Math.max(o.calm, 1.5);
          o.fear = 0;
          break;
        case "sleep":
          lull(world, o);
          break;
        case "burn":
          if (!fireproof(o)) o.burning = Math.max(o.burning, 1);
          break;
        case "freeze":
          o.frozen = Math.max(o.frozen, 1);
          break;
        case "fear":
          o.fear = Math.max(o.fear, 2);
          o.fearX = l.x;
          o.fearY = l.y;
          break;
      }
      if (o.hp <= 0) o.dead = true;
    }
  }
}
