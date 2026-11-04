import { C } from "./materials";
import { VK } from "./voxels";
import type { Creature, CreatureKind } from "./creatures";
import type { World } from "./world";

// What every creature carries in its head (3.6), and what creatures share:
// villages with their stock, the marks goals leave on the land, and who died
// where. goals.ts decides with it, abilities.ts acts on it, creatures.ts
// wires them in. Kept apart so none of them imports another in a loop.

// The vocabulary. A kind has one goal; needs come before it.
export const GOALS = ["hunt", "gather", "hoard", "build", "tend", "guard", "steal", "spread", "convert", "worship", "explore", "migrate"] as const;
export type Goal = (typeof GOALS)[number];

export const ABILITIES = [
  "breathe fire",
  "heal",
  "summon",
  "teleport",
  "freeze",
  "lightning",
  "grow",
  "raise the dead",
  "shield",
  "dig",
  "flood",
  "steal",
] as const;
export type AbilityName = (typeof ABILITIES)[number];
export const TRIGGERS = ["enemy near", "hurt", "night", "friend dies", "every so often"] as const;
export type Trigger = (typeof TRIGGERS)[number];

export interface AbilitySpec {
  // One of ABILITIES, or the name of a spell's own ability (3.6: the
  // vocabulary grows with what merges invent).
  do: AbilityName | string;
  when: Trigger;
  // Seconds between two uses.
  every: number;
  // A spell's own ability: its code, run through the World API. True when it did something.
  run?: (self: Creature, target: Creature | null) => boolean;
  // do "cast" (3.7): a spell from the shared library, by name.
  spell?: string;
}

// A goal a spell invents (3.6), beyond the twelve: where to go, how long to
// work there, what its code then changes, what it carries home. Given to a
// spell's creature (goal: "brew potions") or to villagers as a job
// (w.hire("brew potions", x, y, 2)). Registered when the spell's program is
// compiled, so a reloaded world gets it back with the spell's other rules.
export interface CustomGoal {
  name: string;
  // A material (any layer), a creature kind, or landmark, home, village, anywhere.
  seek: string;
  near: number;
  work: number;
  carry: Load | null;
  // A built-in goal to fall back on when there is nothing to seek.
  like: Goal | null;
  run: ((self: Creature, x: number, y: number, target: Creature | null) => boolean) | null;
}
export const CUSTOM_GOALS = new Map<string, CustomGoal>();

// What it carries: shown over its head and in the inspect card.
export const LOADS = ["wood", "food", "gold", "fish", "loot", "stone", "seeds"] as const;
export type Load = (typeof LOADS)[number];
export const LOAD_COLORS: Record<Load, number> = {
  wood: 0x8a5a2b,
  food: 0xe8c25a,
  gold: 0xffd23d,
  fish: 0x9fc4d8,
  loot: 0xc08a3a,
  stone: 0x9a9aa2,
  seeds: 0x7ab648,
};

export interface Memory {
  // A kind (its base name), or "magic" for the player's spells.
  kind: string;
  // Below 0 harm, above 0 help.
  feel: number;
}

export interface Mind {
  // One of GOALS, or a spell's own (CUSTOM_GOALS).
  goal: Goal | string;
  // A villager hired to a spell's own goal (w.hire), saved by name.
  job: string | null;
  // The spell's own goal the current task serves.
  custom: string;
  // What it is doing right now, in a few words, for the inspect card.
  action: string;
  // 0 fed, 1 starving; 0 rested, 1 exhausted.
  hunger: number;
  tired: number;
  // Seconds before it decides again: a few times a second, not every tick.
  think: number;
  // Where the current task leads, and what at: a cell, or a creature.
  tx: number;
  ty: number;
  cell: number;
  target: Creature | null;
  task: Task;
  // Seconds spent on the task where it is done, and walking to it.
  work: number;
  walk: number;
  // The closest it came on its way, and for how long it has come no closer.
  near: number;
  stall: number;
  pace: number;
  carry: Load | null;
  // Its own place: a hoard, a camp, a den, a nest. -1 none yet.
  lair: number;
  // Things it did that changed the world, and the last one.
  deeds: number;
  did: string;
  memory: Memory[];
  // Village it was tamed by, plus one; 0 wild. Times it was fed by people.
  tame: number;
  fed: number;
  // World time each of its abilities is ready again.
  ready: number[];
  // Where a migration or exploration is heading next.
  away: number;
  // In the middle of a meal (4.3): eats from 0.7 hunger until 0.3.
  meal?: boolean;
}

export type Task =
  | "none"
  | "eat"
  | "graze"
  | "rest"
  | "hunt"
  | "feast"
  | "fell"
  | "carry"
  | "plant"
  | "harvest"
  | "fish"
  | "build"
  | "repair"
  | "dam"
  | "take"
  | "raid"
  | "pray"
  | "bury"
  | "spread"
  | "seed"
  | "roam"
  | "herd"
  | "spawn"
  | "patrol"
  | "fight"
  | "beg"
  | "feed"
  | "trade"
  | "forage"
  | "preach"
  | "heal"
  | "avoid"
  | "use"
  | "custom";

export function newMind(goal: Goal | string): Mind {
  return {
    goal,
    action: "looking around",
    hunger: Math.random() * 0.3,
    tired: Math.random() * 0.3,
    think: Math.random() * 0.5,
    tx: 0,
    ty: 0,
    cell: -1,
    target: null,
    task: "none",
    work: 0,
    walk: 0,
    near: Infinity,
    stall: 0,
    pace: 1,
    carry: null,
    lair: -1,
    deeds: 0,
    did: "",
    memory: [],
    tame: 0,
    fed: 0,
    ready: [],
    away: -1,
    job: null,
    custom: "",
  };
}

// What creatures.ts lends: the kinds live there, and importing it back would
// make a loop.
export interface LifeHooks {
  kindOf(c: Creature): CreatureKind;
  maxHp(c: Creature): number;
  make(kind: string, x: number, y: number): Creature;
  goalOf(c: Creature): Goal | string;
  // Out of a place it cannot walk out of (a hollow among cliffs), a step toward (x, y).
  free(c: Creature, x: number, y: number): void;
  // Hunts people, converts them or carries a harmful aura (creatures.ts).
  hostile(c: Creature): boolean;
}
export const life = {} as LifeHooks;

export function mindOf(c: Creature): Mind {
  return (c.mind ??= newMind(life.goalOf(c)));
}

// A creature that became another kind (turned by a vampire, raised from the
// dead) thinks anew, but what it did before still counts.
export function reborn(c: Creature): void {
  const old = c.mind;
  c.mind = undefined;
  if (!old) return;
  const m = mindOf(c);
  m.deeds = old.deeds;
  m.did = old.did;
}

// It changed something: counted for the five minute test and named for the card.
export function deed(c: Creature, what: string): void {
  const m = mindOf(c);
  m.deeds++;
  m.did = what;
  if (deedLog) deedLog.set(what, (deedLog.get(what) ?? 0) + 1);
  if (catches && what.startsWith("caught a ")) {
    const key = `${c.kind.split("#")[0]} caught a ${what.slice(9)}`;
    catches.set(key, (catches.get(key) ?? 0) + 1);
  }
  if (storyWorld) storyDeed(storyWorld, c, what);
}

// The island's story (3.7): what happened worth telling, for the chronicle
// Haiku writes once a session. Notable deeds are lines (the dragon hoarded
// gold, a villager was tamed), the same line within two minutes counted
// again rather than repeated; everyday work is only counted (grazing,
// harvesting, carrying food home). Saved with the world, sixty lines at most.
export interface StoryLine {
  t: number;
  text: string;
  n: number;
}
export const MAX_STORY = 60;
const ROUTINE =
  /^(grazed|picked|brought|ate |sowed|harvested|felled|planted|caught|gathered|spread|dug|rooted|drew water|prayed|cut a path|kept|carried|herded|fed )/;
let storyWorld: World | null = null;
export function storyOn(world: World | null): void {
  storyWorld = world;
}

export function tell(world: World, text: string): void {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!clean) return;
  const last = world.story.find((l) => l.text === clean && world.time - l.t < 120);
  if (last) {
    last.n++;
    last.t = world.time;
    return;
  }
  world.story.push({ t: world.time, text: clean, n: 1 });
  if (world.story.length > MAX_STORY) world.story.shift();
}

function storyDeed(world: World, c: Creature, what: string): void {
  const kind = c.kind.split("#")[0];
  if (ROUTINE.test(what)) {
    world.storyCounts[what] = (world.storyCounts[what] ?? 0) + 1;
    return;
  }
  tell(world, `${kind === "villager" ? "a villager" : `the ${kind}`} ${what}`);
}

// Tests count what was done, by words; off (null) in the game.
let deedLog: Map<string, number> | null = null;
// The five minute scene counts who caught whom (4.3: wolves must still catch deer).
let catches: Map<string, number> | null = null;
export function logCatches(on: boolean): Map<string, number> | null {
  catches = on ? new Map() : null;
  return catches;
}
export function logDeeds(on: boolean): Map<string, number> | null {
  deedLog = on ? new Map() : null;
  return deedLog;
}

// Villagers and beasts remember who hurt them and who helped, by kind.
export function remember(c: Creature, kind: string, feel: number): void {
  if (c.dead) return;
  const m = mindOf(c);
  const k = kind.split("#")[0];
  if (k === c.kind.split("#")[0] && kind !== "magic") return;
  let e = m.memory.find((x) => x.kind === k);
  if (!e) {
    if (m.memory.length >= 4) {
      // Forget the faintest.
      m.memory.sort((a, b) => Math.abs(b.feel) - Math.abs(a.feel));
      m.memory.pop();
    }
    e = { kind: k, feel: 0 };
    m.memory.push(e);
  }
  e.feel = Math.max(-5, Math.min(5, e.feel + feel));
}

export function feeling(c: Creature, kind: string): number {
  const k = kind.split("#")[0];
  return c.mind?.memory.find((x) => x.kind === k)?.feel ?? 0;
}

// Harm done by one creature to another: the victim remembers, and so do the
// villagers who saw it, a little.
export function harmed(world: World, victim: Creature, by: Creature, amount: number): void {
  if (amount <= 0 || victim.kind !== "villager") {
    if (victim.mind) remember(victim, by.kind, -0.3);
    return;
  }
  remember(victim, by.kind, -1);
  if (world.tick % 10 !== victim.id % 10) return;
  for (const o of world.crowd.near(world, victim.x, victim.y, 8)) if (o !== victim && o.kind === "villager") remember(o, by.kind, -0.3);
}

// A village: the people whose homes are close, and what they have put by.
export interface Village {
  x: number;
  y: number;
  food: number;
  wood: number;
  gold: number;
  // Counted when the villages are found again.
  people: number;
  houses: number;
}

export const VILLAGE_REACH = 22;

// Groups villagers by home, keeping each village's stock when its center
// moves a little. Every few seconds, never every tick.
export function findVillages(world: World): void {
  const found: { x: number; y: number; n: number }[] = [];
  for (const c of world.creatures) {
    if (c.dead || c.kind !== "villager") continue;
    let v = found.find((p) => Math.abs(p.x / p.n - c.homeX) + Math.abs(p.y / p.n - c.homeY) < VILLAGE_REACH);
    if (!v) found.push((v = { x: 0, y: 0, n: 0 }));
    v.x += c.homeX;
    v.y += c.homeY;
    v.n++;
  }
  const old = world.villages;
  const next: Village[] = [];
  for (const f of found) {
    const x = f.x / f.n;
    const y = f.y / f.n;
    let best: Village | null = null;
    let bestD = VILLAGE_REACH;
    for (const v of old) {
      const d = Math.hypot(v.x - x, v.y - y);
      if (d < bestD && !next.includes(v)) {
        bestD = d;
        best = v;
      }
    }
    const v = best ?? { x, y, food: 6, wood: 2, gold: 3, people: 0, houses: 0 };
    v.x = x;
    v.y = y;
    v.people = f.n;
    v.houses = 0;
    next.push(v);
  }
  // Houses by village, sampled around each center.
  for (const v of next) {
    let h = 0;
    const r = 14;
    for (let y = Math.max(0, Math.round(v.y - r)); y <= Math.min(world.h - 1, Math.round(v.y + r)); y++)
      for (let x = Math.max(0, Math.round(v.x - r)); x <= Math.min(world.w - 1, Math.round(v.x + r)); x++) if (world.cover[y * world.w + x] === C.HOUSE) h++;
    v.houses = h / 4;
  }
  world.villages = next;
}

export function villageOf(world: World, x: number, y: number): Village | null {
  let best: Village | null = null;
  let bestD = VILLAGE_REACH * 1.5;
  for (const v of world.villages) {
    const d = Math.abs(v.x - x) + Math.abs(v.y - y);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

// Marks goals leave: a dragon's hoard, a dam, a camp, a graveyard, a den,
// offerings at a shrine, a cairn. Each is a place with a count; its look is
// voxels and covers, saved with the land.
export const MARKS = ["hoard", "dam", "camp", "graveyard", "den", "nest", "offerings", "cairn", "burrow"] as const;
export type MarkKind = (typeof MARKS)[number];

export interface Mark {
  kind: MarkKind;
  x: number;
  y: number;
  size: number;
  // Who made it, a kind's base name.
  by: string;
}

export const MAX_MARKS = 80;

export function markAt(world: World, kind: MarkKind, x: number, y: number, by: string, reach = 4): Mark {
  let m = world.marks.find((k) => k.kind === kind && Math.abs(k.x - x) <= reach && Math.abs(k.y - y) <= reach);
  if (!m) {
    if (world.marks.length >= MAX_MARKS) world.marks.shift();
    m = { kind, x: Math.round(x), y: Math.round(y), size: 0, by: by.split("#")[0] };
    world.marks.push(m);
  }
  m.size++;
  return m;
}

// A small pile at a place: voxels stacked around (x, y), each new one next to
// or on the last. For hoards, camps, dens, offerings and cairns.
export function pile(world: World, x: number, y: number, n: number, color: number, kind: number = VK.STONE): void {
  const spots = [
    [0, 0],
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ];
  const [dx, dy] = spots[n % spots.length];
  const cx = Math.round(x) + dx;
  const cy = Math.round(y) + dy;
  if (!world.inside(cx, cy)) return;
  const i = cy * world.w + cx;
  // Never on a house, a tree or a field's crop: a voxel there would knock it down (world.voxelFits).
  if (world.depth[i] > 0.3 || world.cover[i] !== C.NONE) return;
  const top = Math.round(world.height[i] * 0.5);
  const layer = Math.floor(n / spots.length);
  // Higher in the middle, like a heap.
  const level = top + Math.max(0, layer - (dx || dy ? 1 : 0));
  world.setVoxel(cx, cy, level, color, kind);
}

// Who died where, for "a friend dies" and for graveyards.
export interface Death {
  kind: string;
  x: number;
  y: number;
  t: number;
}

export function noteDeath(world: World, c: Creature): void {
  world.deaths.push({ kind: c.kind, x: c.x, y: c.y, t: world.time });
  // Who killed it, as far as it remembers.
  const by = c.mind?.memory.filter((e) => e.feel < 0).sort((a, b) => a.feel - b.feel)[0]?.kind;
  const kind = c.kind.split("#")[0];
  if (kind !== "fish" && kind !== "bird") tell(world, `${kind === "villager" ? "a villager" : `a ${kind}`} died${by ? `, killed by the ${by}` : ""}`);
  if (world.deaths.length > 48) world.deaths.splice(0, world.deaths.length - 48);
}
