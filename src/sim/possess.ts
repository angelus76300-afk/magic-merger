import { abilitiesOf, enemyOf, fireAbility } from "./abilities";
import { doChore, eats, mealFor, strikeNow, strikes, tradeFor } from "./goals";
import { life, mindOf, type AbilitySpec, type Mind } from "./kin";
import { names } from "./social";
import type { Creature } from "./creatures";
import type { Driven } from "./drive";
import type { World } from "./world";

// Become anything (2026-11-12, the most voted player idea): the player takes
// one creature and plays it. Pure, so Node can test it (scripts/become-test.ts).
//
// What possession is: the creature's own thinking is paused (its decisions in
// creatures.ts updateCreature and goals.ts pursue are skipped while it is
// ridden), and a stick says where it walks instead. The step is drive.ts (the
// eye view, second pass: the velocity follows the stick within a tenth of a
// second) with the creature's own blocked(): nothing walks through a wall,
// into deep water or off the island that could not before.
// Everything else is unchanged: others see it, fear it and hunt it as any
// creature. Its abilities fire on demand, with their trigger skipped and the
// same cooldown (m.ready) and cast cap as the engine's (abilities.ts).
//
// Possession is of the moment: it lives in this module only, never on the
// creature or the world, so a save never sees it (save.ts is unchanged).

// The stick, the velocity it gives and the climb of the look (drive.ts Driven).
export interface Possession extends Driven {
  world: World;
  c: Creature;
  // World time it began.
  since: number;
  // Its own goal when it was taken: the island may send it somewhere meanwhile
  // (a wonder calling villagers, balance.ts sending animals out), and release
  // gives it back what it was doing.
  own: Pick<Mind, "task" | "tx" | "ty" | "cell" | "target" | "pace" | "work" | "action">;
  // World time before which its own acts (Strike, Eat) wait: a blow, a meal.
  busy: number;
  // Where it stood when the push last moved it, and when (stopNote).
  stall: { x: number; y: number; t: number } | null;
}

export type Ended = "let go" | "fell" | "gone";

let current: Possession | null = null;
let ended: { c: Creature; why: Ended } | null = null;

// Why the push goes nowhere, once it has gone nowhere for half a second of
// world time ("Deep water stops you", "Too steep", "The edge of the world"):
// a stop with no sign read as a broken stick (the playtest of 12 November).
// Null while it moves, or the stick rests. The frame says it at most every few seconds.
export function stopNote(world: World, whyStopped: (world: World, c: Creature, dx: number, dy: number) => string | null): string | null {
  const p = possessed(world);
  if (!p) return null;
  const c = p.c;
  if (p.push < DEAD_ZONE || c.dead) {
    p.stall = null;
    return null;
  }
  if (!p.stall || Math.hypot(c.x - p.stall.x, c.y - p.stall.y) > 0.25) {
    p.stall = { x: c.x, y: c.y, t: world.time };
    return null;
  }
  if (world.time - p.stall.t < 0.5) return null;
  return whyStopped(world, c, p.wx, p.wy);
}

// Below this push the stick is at rest: a thumb resting on it does not walk.
export const DEAD_ZONE = 0.12;

export function possess(world: World, c: Creature): Possession | null {
  if (c.dead || c.hp <= 0 || !world.creatures.includes(c)) return null;
  if (current) release(current.world);
  ended = null;
  const { task, tx, ty, cell, target, pace, work, action } = mindOf(c);
  current = {
    world,
    c,
    wx: Math.cos(c.hd),
    wy: Math.sin(c.hd),
    push: 0,
    sx: 0,
    sy: 0,
    vx: 0,
    vy: 0,
    climb: 0,
    alt: c.z,
    dive: 0.3,
    side: 0,
    since: world.time,
    own: { task, tx, ty, cell, target, pace, work, action },
    busy: 0,
    stall: null,
  };
  return current;
}

export function possessed(world: World): Possession | null {
  return current && current.world === world ? current : null;
}

// Asked for every creature every tick (creatures.ts): one comparison.
export function ridden(c: Creature): Possession | null {
  return current !== null && current.c === c ? current : null;
}

// The stick in screen terms (x right, y down, each -1 to 1) and the camera's
// turn (orbit.ts theta): screen up is away from the camera along the ground.
export function stickDir(sx: number, sy: number, theta: number): { x: number; y: number; push: number } {
  const push = Math.min(1, Math.hypot(sx, sy));
  if (push < DEAD_ZONE) return { x: 0, y: 0, push: 0 };
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // Screen right on the ground is (cos, -sin), screen up (-sin, -cos): orbit.ts pan().
  const x = sx * cos + sy * sin;
  const y = -sx * sin + sy * cos;
  const n = Math.hypot(x, y) || 1;
  return { x: x / n, y: y / n, push };
}

// `climb`: the look's pitch as -1 (down) to 1 (up), which a flier and a swimmer follow (drive.ts).
export function steerBy(world: World, sx: number, sy: number, theta: number, climb = 0): void {
  const p = possessed(world);
  if (!p) return;
  const d = stickDir(sx, sy, theta);
  p.push = d.push;
  p.sx = sx;
  p.sy = sy;
  p.climb = Math.max(-1, Math.min(1, climb));
  if (d.push > 0) {
    p.wx = d.x;
    p.wy = d.y;
  }
}

// What updateCreature walks toward this tick, in place of its own decision:
// a point four cells along the stick, at the stick's push of its own speed.
export function riderAim(p: Possession): { x: number; y: number; pace: number } {
  return p.push < DEAD_ZONE ? { x: 0, y: 0, pace: 0 } : { x: p.wx * 4, y: p.wy * 4, pace: p.push };
}

export interface Power {
  spec: AbilitySpec;
  // Seconds before it can fire again, and the cooldown it counts down from.
  left: number;
  every: number;
}

// Its own abilities, two at most (what fits beside the stick at 344 px).
export function powersOf(world: World, c: Creature): Power[] {
  const list = abilitiesOf(c, life.kindOf(c)).slice(0, 2);
  const m = mindOf(c);
  return list.map((spec, n) => ({ spec, left: Math.max(0, (m.ready[n] ?? 0) - world.time), every: spec.every }));
}

// Fires ability n now, its trigger skipped: "done", "nothing" (nobody to do
// it on: it may try again in three seconds, as the engine's own), "cooling".
export function act(world: World, n: number): "done" | "nothing" | "cooling" | null {
  const p = possessed(world);
  if (!p || p.c.dead || n < 0 || n > 1) return null;
  const c = p.c;
  const k = life.kindOf(c);
  const list = abilitiesOf(c, k);
  const a = list[n];
  if (!a) return null;
  const m = mindOf(c);
  if (world.time < (m.ready[n] ?? 0)) return "cooling";
  return fireAbility(world, c, k, m, n, a, enemyOf(world, c, k)) ? "done" : "nothing";
}

// Its own acts on demand (Through its eyes, 2026-11-12): only what the engine
// already does for this kind by itself (goals.ts): Strike for those who fight,
// a villager's trade on what is in front (Fell, Fish, Harvest, Build...), and
// Eat for an animal at its food. A strike is half a second of its own blows,
// at most twice a second; a trade or a meal takes as long as the engine's own
// task (goals.ts DURATION).
export type Deed = "strike" | "trade" | "eat";
export const STRIKE_SECONDS = 0.5;

export interface DeedButton {
  id: Deed;
  verb: string;
}

// The buttons it has now, facing `facing` (the look in the eye view, its
// heading else). The trade's verb follows what is in front ("Harvest" a crop,
// "Sow" a bare field); Eat shows only while food is in front.
export function deedsOf(world: World, c: Creature, facing = c.hd): DeedButton[] {
  const k = life.kindOf(c);
  const out: DeedButton[] = [];
  if (strikes(c, k)) out.push({ id: "strike", verb: "Strike" });
  const t = tradeFor(world, c, facing);
  if (t) out.push({ id: "trade", verb: t.verb });
  if (mealFor(world, c, facing)) out.push({ id: "eat", verb: "Eat" });
  return out;
}

// Does it now: what it did ("Felled a tree", "Struck the wolf"), what is
// missing ("No tree in front"), "busy" while the last one lasts, null when it
// is not one of its acts.
export function doDeed(world: World, what: Deed, facing: number): { done: string } | { missing: string } | "busy" | null {
  const p = possessed(world);
  if (!p || p.c.dead) return null;
  const c = p.c;
  const k = life.kindOf(c);
  if (what === "strike") {
    if (!strikes(c, k)) return null;
    if (world.time < p.busy) return "busy";
    const t = strikeNow(world, c, facing, STRIKE_SECONDS);
    if (!t) return { missing: "Strike: nothing in reach" };
    p.busy = world.time + STRIKE_SECONDS;
    return { done: `Struck the ${t.kind.split("#")[0]}` };
  }
  const found =
    what === "trade" ? tradeFor(world, c, facing) : eats(c, k) ? (mealFor(world, c, facing) ?? { verb: "Eat", missing: "Nothing to eat here" }) : null;
  if (!found) return null;
  if (world.time < p.busy) return "busy";
  if ("missing" in found) return { missing: found.missing };
  p.busy = world.time + found.seconds;
  return { done: doChore(world, c, found) };
}

// Let go: the creature's own mind takes over where it left off.
export function release(world: World, why: Ended = "let go"): Creature | null {
  const p = possessed(world);
  if (!p) return null;
  current = null;
  ended = { c: p.c, why };
  if (!p.c.dead) {
    const m = mindOf(p.c);
    Object.assign(m, p.own);
    if (m.target?.dead) m.target = null;
    // Measured afresh from where the player left it, so the task is not dropped as stalled.
    m.walk = 0;
    m.near = Infinity;
    m.stall = 0;
  }
  return p.c;
}

// At 0 health the player is thrown out at once (creatures.ts calls this as it
// dies); the creature lives or dies by the simulation's own rules.
export function throwOut(c: Creature): void {
  if (current && current.c === c) release(current.world, "fell");
}

// Looked at by the frame: still held, or why not. A creature taken off the
// island (eaten, lifeCycle's cleanup) ends it too.
export function checkHeld(world: World): Ended | null {
  const p = possessed(world);
  if (p) {
    if (p.c.dead || p.c.hp <= 0) release(world, "fell");
    else if (!world.creatures.includes(p.c)) release(world, "gone");
    else return null;
  }
  const e = ended;
  ended = null;
  return e?.why ?? null;
}

const kindWord = (c: Creature): string => c.kind.split("#")[0];

// Its own thought while you are it: what scares it, what it wants, how it feels.
export function thoughtOf(world: World, c: Creature): string {
  const k = life.kindOf(c);
  const m = mindOf(c);
  const parts: string[] = [];
  if (c.burning > 0) parts.push("burning");
  const enemy = enemyOf(world, c, k, 10);
  if (enemy) {
    const prey = k.ai?.prey ?? [];
    const hunts = k.ai?.mode === "hunt" && (prey.length ? names(prey, enemy.kind) : true);
    parts.push(hunts ? `wants the ${kindWord(enemy)}` : `afraid of the ${kindWord(enemy)}`);
  }
  if (c.hp < life.maxHp(c) * 0.4) parts.push("hurt");
  if (m.hunger > 0.6) parts.push("hungry");
  if (m.tired > 0.7) parts.push("tired");
  // Its own task is paused while the player steers it: "thinks of felling a
  // tree" was not true then (the playtest of 12 November).
  const own = !ridden(c) && /^[a-z]+ing\b/.test(m.action) && m.action !== "looking around";
  if (!parts.length) parts.push(own ? `thinks of ${m.action}` : "calm");
  const s = parts.slice(0, 3).join(", ");
  return s[0].toUpperCase() + s.slice(1);
}
