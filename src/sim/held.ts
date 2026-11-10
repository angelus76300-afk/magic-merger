import { guessForm } from "../../shared/forms";
import { daylight } from "./daylight";
import { F } from "./materials";
import { propBounds } from "./props";
import { unpackLook } from "./villagers";
import { deed, life, mindOf, remember, tell, villageOf } from "./kin";
import type { ArtEffectName, Artifact } from "./artifacts";
import type { Creature } from "./creatures";
import type { World } from "./world";

// Objects that are picked up and used (4.7, item 3). An object item lying on
// the island (a Fire Staff, a Healing Potion, a Storm Lantern) is taken by a
// villager whose work it suits, or by a thief, carried in hand, and its
// effects fire from where its holder stands: a staff burns the wolf that
// comes at its guard, a potion heals its holder once when badly hurt, a
// lantern lights the dark around whoever carries it. It is dropped when its
// holder dies, when it has done nothing for a while, and a thief can steal
// it from a hand. Everything is read from what artifacts already hold, so the
// objects of the live library work as they are, with no program rewritten.

// Something an artifact did (3.7; here since 4.7, so held.ts needs nothing
// from artifacts.ts but types): its count, the world's story, and its last
// three deeds. A deed after its first 15 s counts for the five minute test.
const ARRIVAL = 15;
// What was done to an artifact rather than by it, counted apart for its five
// minute test: being worshipped or guarded. A thing villagers bow to has not
// acted (24 live items passed that test on nothing else). Being taken, robbed
// or battered still counts: an object is made to be carried and used (4.7).
// Not saved: only a test run reads it.
const PASSIVE = new WeakMap<Artifact, number>();
export const passiveDeeds = (a: Artifact): number => PASSIVE.get(a) ?? 0;
export function artDeed(world: World, a: Artifact, what: string): void {
  if (/^was (worshipped|guarded) /.test(what)) PASSIVE.set(a, passiveDeeds(a) + 1);
  a.art.actedAt = world.time;
  a.art.deeds++;
  tell(world, `the ${a.name} ${what}`);
  if (world.time - a.art.placed > ARRIVAL) a.art.later++;
  a.art.did = [what, ...a.art.did.filter((d) => d !== what)].slice(0, 3);
}

// Seconds an object lies where it was placed before anyone may take it: the
// player sees what they cast before it walks off.
export const PICKUP_DELAY = 30;
// A held object that did nothing for this long is put down again.
export const IDLE_DROP = 120;
// A held heal waits until its holder, or a friend in reach, is this hurt.
export const HELD_HEAL_BELOW = 0.5;
// The one who put it down does not take it back for this long.
const RETAKE_AFTER = 20;
// Put down unused, it rests: nobody takes it for this long, unless an enemy
// of the village comes within REST_ALARM cells of it (the review of #70: a
// quiet guard took up and put down the same staff every 140 s).
export const IDLE_REST = 600;
export const REST_ALARM = 16;
// What a hand holds is drawn this tall at most, in cells (a villager is about 1.2).
export const HELD_SIZE = 0.75;

// How much a model is scaled in a hand: only ever smaller, so a potion drawn
// small stays small (the playtest of 7 November: scaled up, it hid a goblin).
export function heldScale(boxes: { x: number; y: number; z: number; w: number; d: number; h: number }[]): number {
  let across = 0;
  let top = 0;
  for (const b of boxes) top = Math.max(top, b.z + b.h);
  const xs = boxes.flatMap((b) => [b.x, b.x + b.w]);
  const ys = boxes.flatMap((b) => [b.y, b.y + b.d]);
  if (boxes.length) across = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return Math.min(1, HELD_SIZE / Math.max(0.05, across, top));
}
// A thief takes from a hand within this distance.
const STEAL_REACH = 1.5;

const LONG = /\b(staff|staves|spear|lance|pike|wand|rod|scepter|sceptre|sword|blade|halberd|trident|scythe|cane|crook)s?\b/i;

// Used up by its first effect that does something: what a name says is drunk, read or thrown.
const CONSUMABLE = /\b(potion|elixir|draught|tonic|vial|flask|brew|scroll|bomb|seed|apple)s?\b/i;
export function consumable(a: Artifact): boolean {
  return CONSUMABLE.test(a.name);
}

// The fine models that are its look: its spell's props standing within two
// cells of it (the placing that made it).
export function propsOf(world: World, a: Artifact) {
  return world.props.filter((p) => p.key === a.art.key && Math.hypot(p.x - a.x, p.y - a.y) <= 2 && (p.heldBy ?? null) === (a.art.heldBy ?? null));
}

// Can it be carried at all? An object by its kind (the stored one, or its
// name), small enough to hold, and not a place people come to (a well, a
// shrine, an armory).
export function portable(world: World, a: Artifact): boolean {
  const s = a.art;
  const form = s.form ?? guessForm(a.name);
  if (form !== "object") return false;
  // Nothing to use: a look only stays where it was put.
  if (!s.effects.length && !s.pairs.length && !s.grants.length) return false;
  if (s.grants.some((g) => g.what === "water" || g.what === "prayer" || g.what === "arms")) return false;
  if (s.uses.some((u) => u.do === "guard" || u.do === "worship")) return false;
  // Held in one hand: no wider than 1.5 cells, and no taller than 2 voxels
  // (a villager is 1.2) unless it is a long thing held upright, a staff or a
  // spear. A lantern post 2.5 tall stays put (the playtest of 7 November).
  const long = LONG.test(a.name);
  for (const p of propsOf(world, a)) {
    const b = propBounds(p);
    if (b.across > 1.5 || b.tall > (long ? 3 : 2)) return false;
  }
  return true;
}

// May this creature take it now from the ground?
function free(world: World, a: Artifact, c: Creature): boolean {
  const s = a.art;
  if (s.heldBy != null || world.time - s.placed < PICKUP_DELAY) return false;
  if (s.droppedBy === c.id && world.time - (s.droppedAt ?? -1e9) < RETAKE_AFTER) return false;
  if (s.restUntil !== undefined && world.time < s.restUntil && !threatNear(world, a)) return false;
  return portable(world, a);
}

function threatNear(world: World, a: Artifact): boolean {
  for (const o of world.crowd.near(world, a.x, a.y, REST_ALARM)) if (!o.dead && against(o)) return true;
  return false;
}

const HARM: ArtEffectName[] = ["burn", "freeze", "lightning", "shield", "cast"];
const HEAL: ArtEffectName[] = ["heal", "revive"];
const FIELD: ArtEffectName[] = ["grow", "water", "rain", "food"];

// Who takes what: a villager the object suits (a guard a staff that burns, a
// priest a potion, a farmer a seed that grows; anyone a lantern by night), a
// thief anything. One object a hand, and in a village at most a quarter of
// its people hold one, so an island never ends with every object in a hand.
export function wantsToTake(world: World, c: Creature, a: Artifact): boolean {
  if (c.dead || holding(world, c) || !free(world, a, c)) return false;
  if (c.kind !== "villager") return thief(c);
  const look = unpackLook(c.look);
  if (look.age !== "adult") return false;
  const v = villageOf(world, c.homeX, c.homeY);
  const cap = Math.max(1, Math.floor((v?.people ?? 4) / 4));
  let held = 0;
  for (const l of world.landmarks) {
    const h = (l as Artifact).art?.heldBy;
    if (h == null) continue;
    const o = world.creatures.find((k) => k.id === h);
    if (o && o.kind === "villager" && Math.abs(o.homeX - c.homeX) < 20 && Math.abs(o.homeY - c.homeY) < 20) held++;
  }
  if (held >= cap) return false;
  const does = new Set<ArtEffectName>([...a.art.effects.map((e) => e.do), ...a.art.pairs.map((p) => p.do)]);
  const grants = new Set(a.art.grants.map((g) => g.what));
  const any = (list: ArtEffectName[]) => list.some((d) => does.has(d));
  if (look.calling === "mage" || look.calling === "necromancer") return true;
  switch (look.job) {
    case "guard":
      return any(HARM);
    case "priest":
      return any(HEAL) || grants.has("heal");
    case "farmer":
      return any(FIELD) || grants.has("food");
  }
  return does.has("light") && daylight(world.time).night > 0.4;
}

// A creature whose goal is to steal (a goblin, a bandit, a magpie by its
// name, goals.ts), whatever else it does: a plain goblin is no hunter, so
// it is not counted hostile, and it still steals (the playtest of 7 November).
export function thief(c: Creature): boolean {
  return c.kind !== "villager" && mindOf(c).goal === "steal";
}

// Which side a creature is on: the village's, or against it (hostile or a thief).
function against(c: Creature): boolean {
  return life.hostile(c) || thief(c);
}

export function holding(world: World, c: Creature): Artifact | null {
  for (const l of world.landmarks) if ((l as Artifact).art?.heldBy === c.id) return l as Artifact;
  return null;
}

// Into the hand: its look goes with it.
export function take(world: World, c: Creature, a: Artifact, from: Creature | null = null): void {
  for (const p of propsOf(world, a)) p.heldBy = c.id;
  a.art.heldBy = c.id;
  a.art.heldAt = world.time;
  a.art.actedAt = world.time;
  a.art.holderHp = c.hp;
  a.x = Math.round(c.x);
  a.y = Math.round(c.y);
  world.propsVersion++;
  world.particles.add({ x: c.x, y: c.y, z: 1, vx: 0, vy: 0, vz: 1.5, life: 0.6, color: a.color, size: 1.2, glow: true, gravity: 0, drag: 1 });
  world.emit({ kind: "sound", name: "chime", size: 0.2 });
  const who = c.kind.split("#")[0];
  // Taken is used: a deed of the object's own, as a grant drawn is (3.7).
  if (from) {
    deed(c, `stole the ${a.name}`);
    remember(from, who, -1);
    artDeed(world, a, `was stolen by a ${who}`);
  } else {
    deed(c, `took the ${a.name}`);
    artDeed(world, a, `was taken by a ${who}`);
  }
}

// Out of the hand, where its holder stands. In deep water or lava it is lost.
export function dropHeld(world: World, a: Artifact, at: { x: number; y: number }, by: number | null): void {
  const x = Math.max(0, Math.min(world.w - 1, Math.round(at.x)));
  const y = Math.max(0, Math.min(world.h - 1, Math.round(at.y)));
  const props = world.props.filter((p) => p.heldBy === a.art.heldBy && p.key === a.art.key);
  a.art.heldBy = null;
  a.art.droppedBy = by;
  a.art.droppedAt = world.time;
  const i = y * world.w + x;
  const lost = world.depth[i] > 1 || world.fluid[i] === F.LAVA;
  if (lost) {
    world.landmarks = world.landmarks.filter((l) => l !== a);
    world.props = world.props.filter((p) => !props.includes(p));
  } else {
    a.x = x;
    a.y = y;
    for (const p of props) {
      p.heldBy = null;
      p.x = x;
      p.y = y;
    }
  }
  world.propsVersion++;
}

// Gone for good: a potion drunk, a scroll read.
export function useUp(world: World, a: Artifact): void {
  const props = world.props.filter(
    (p) => p.key === a.art.key && (p.heldBy ?? null) === (a.art.heldBy ?? null) && (a.art.heldBy != null || Math.hypot(p.x - a.x, p.y - a.y) <= 2),
  );
  world.landmarks = world.landmarks.filter((l) => l !== a);
  world.props = world.props.filter((p) => !props.includes(p));
  world.propsVersion++;
}

// Once a second for a held object, before its effects: it follows its
// holder; a thief at hand takes it; it falls when the holder dies or when
// it has done nothing for IDLE_DROP. Returns the holder, or null when it is
// no longer held.
export function stepHeld(world: World, a: Artifact): Creature | null {
  const s = a.art;
  if (s.heldBy == null) return null;
  const c = world.creatures.find((o) => o.id === s.heldBy);
  if (!c || c.dead) {
    dropHeld(world, a, c ?? a, null);
    if (c) deed(c, `dropped the ${a.name}`);
    return null;
  }
  a.x = Math.round(c.x);
  a.y = Math.round(c.y);
  // Its look's place too, so a save keeps it where its holder stood.
  for (const p of world.props)
    if (p.heldBy === c.id && p.key === s.key) {
      p.x = c.x;
      p.y = c.y;
    }
  // The holder was hurt: what fires "when hurt" fires for it.
  if (c.hp < (s.holderHp ?? c.hp) - 1) s.hurtAt = world.time;
  s.holderHp = c.hp;
  // A thief within reach takes it from the hand (not from another thief).
  if (!thief(c))
    for (const o of world.crowd.near(world, c.x, c.y, STEAL_REACH)) {
      if (o === c || o.dead || !thief(o) || holding(world, o)) continue;
      dropHeld(world, a, c, c.id);
      take(world, o, a, c);
      deed(c, `was robbed of the ${a.name}`);
      return o;
    }
  if (world.time - (s.actedAt ?? world.time) > IDLE_DROP) {
    dropHeld(world, a, c, c.id);
    s.restUntil = world.time + IDLE_REST;
    deed(c, `put down the ${a.name}`);
    return null;
  }
  return c;
}

// A held potion's heal waits until someone of the holder's side in reach is
// badly hurt (drunk at 89% health it would be wasted). What is not used up
// heals in a hand as it does on the ground.
export function heldHealNeeded(world: World, holder: Creature, r: number): boolean {
  const side = against(holder);
  for (const o of world.crowd.near(world, holder.x, holder.y, Math.max(1, r)))
    if (!o.dead && against(o) === side && (o.hp < life.maxHp(o) * HELD_HEAL_BELOW || o.burning > 0)) return true;
  return false;
}

// The enemy of a held object's holder: a hostile holder's are the villagers
// (or its prey), anyone else's are the hostile.
export function heldEnemy(world: World, holder: Creature, r: number): Creature | null {
  const side = against(holder);
  let best: Creature | null = null;
  let bestD = r;
  for (const o of world.crowd.near(world, holder.x, holder.y, r)) {
    if (o === holder || o.dead) continue;
    if (side ? o.kind !== "villager" : !against(o)) continue;
    const d = Math.hypot(o.x - holder.x, o.y - holder.y);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

// Grants turned on its holder: a heal grant heals it when badly hurt, a
// food grant feeds it when hungry. Returns what it did, or "".
export function heldGrant(world: World, holder: Creature, a: Artifact): string {
  for (const g of a.art.grants) {
    if (a.art.charges !== null && a.art.charges < g.cost) continue;
    if (g.what === "heal" && holder.hp < life.maxHp(holder) * HELD_HEAL_BELOW) {
      holder.hp = life.maxHp(holder);
      holder.burning = 0;
    } else if (g.what === "food" && mindOf(holder).hunger > 0.6) mindOf(holder).hunger = 0;
    else continue;
    if (a.art.charges !== null) a.art.charges = Math.max(0, a.art.charges - g.cost);
    return g.what === "heal" ? "healed its holder" : "fed its holder";
  }
  return "";
}
