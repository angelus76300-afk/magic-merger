import { C, F, G } from "./materials";
import { alongRoad, claim, isWay, nextPave, noteTrip, pave, planned, type PaveJob } from "./roads";
import type { Wonder } from "./wonders";
import { hasJob, settlementNear, tavernFor } from "./buildings";
import { VK } from "./voxels";
import { daylight } from "./daylight";
import { names, type Plan } from "./social";
import { unpackLook, type Job } from "./villagers";
import { WARD, warded } from "./wards";
import {
  CUSTOM_GOALS,
  GOALS,
  reborn,
  LOAD_COLORS,
  deed,
  storyOn,
  feeling,
  findVillages,
  harmed,
  life,
  markAt,
  mindOf,
  pile,
  remember,
  villageOf,
  type CustomGoal,
  type Goal,
  type Load,
  type Mind,
  type Task,
  type Village,
} from "./kin";
import type { Behavior, Creature, CreatureKind } from "./creatures";
import type { World } from "./world";
import { artifactVisit, useArtifact, type Visit } from "./artifacts";
import { meter } from "./motion";

// Goals (3.6): nothing on the island just stands there. Every creature has a
// goal from a small vocabulary (kin.ts, GOALS), needs that come before it
// (survive, eat, rest), and goals leave marks: a hoard, a dam, a camp, a
// graveyard, offerings at a shrine. Villagers' jobs are goals: farmers sow and
// harvest, woodcutters fell trees for the builders' houses, fishers fish.
//
// A creature decides a few times a second (`think`), never every tick, and
// asks the crowd grid who is near; every tick it only walks to its task and,
// once there, works at it until it is done. Survival stays where it was:
// fleeing fire, hunters and what scares comes first (creatures.ts, social.ts).

// Where a kind's goal comes from: what it declares, then its behavior, then
// its name (the last word that names one decides, like bodies), then its base.
const NAME_GOALS: [string[], Goal][] = [
  [["dragon", "dragons", "wyrm", "wyvern", "drake", "magpie", "hoarder"], "hoard"],
  [["goblin", "goblins", "kobold", "bandit", "thief", "rogue", "raccoon", "brigand", "pirate", "imp", "burglar"], "steal"],
  [["vampire", "dracula", "zombie", "cultist", "succubus", "siren"], "convert"],
  [["necromancer", "lich", "skeleton", "ghoul", "mummy", "wraith", "banshee", "reaper", "undead", "revenant"], "spread"],
  [["beaver", "ant", "termite", "builder", "mason", "dwarf", "gnome", "architect"], "build"],
  [
    ["bee", "squirrel", "hamster", "forager", "gatherer", "harvester", "deer", "elk", "horse", "pony", "goat", "sheep", "cow", "ox", "rabbit", "boar", "stag"],
    "gather",
  ],
  [["dryad", "treant", "ent", "druid", "sylvan", "fairy", "pixie", "sprite", "gardener", "nymph", "healer", "shepherd", "unicorn"], "tend"],
  [["priest", "priestess", "monk", "acolyte", "pilgrim", "oracle", "shaman", "cleric", "angel", "disciple", "worshipper", "paladin"], "worship"],
  [["knight", "guard", "guardian", "sentinel", "golem", "warrior", "soldier", "templar", "watchman", "protector", "defender", "gargoyle"], "guard"],
  [
    ["wolf", "wolves", "hound", "warg", "fox", "tiger", "lion", "bear", "hunter", "spider", "shark", "hawk", "eagle", "panther", "werewolf", "predator"],
    "hunt",
  ],
  [["bird", "raven", "crow", "dove", "sparrow", "owl", "phoenix", "bat", "butterfly", "moth", "sower", "blight", "plague", "fungus", "spore"], "spread"],
  [["fish", "eel", "salmon", "whale", "turtle", "nomad", "caravan", "goose", "swan"], "migrate"],
  [["merchant", "trader", "traveler", "traveller", "wanderer", "explorer", "scout", "ranger", "ghost", "spirit", "wisp", "bard", "adventurer"], "explore"],
];
const NAME_INDEX = new Map<string, Goal>();
for (const [words, goal] of NAME_GOALS) for (const w of words) NAME_INDEX.set(w, goal);

export function goalFromName(name: string): Goal | null {
  let goal: Goal | null = null;
  for (const raw of name.toLowerCase().split(/[^a-z]+/)) {
    if (!raw) continue;
    const g = NAME_INDEX.get(raw) ?? (raw.endsWith("s") ? NAME_INDEX.get(raw.slice(0, -1)) : undefined);
    if (g) goal = g;
  }
  return goal;
}

export function goalFromBehavior(ai: Behavior | undefined): Goal | null {
  if (!ai) return null;
  if (ai.converts) return "convert";
  if (ai.mode === "hunt") return "hunt";
  if (ai.mode === "guard" || ai.mode === "follow") return "guard";
  if (ai.leaves) return "spread";
  if (ai.aura === "heal" || ai.aura === "calm") return "tend";
  if (ai.mode === "flee") return "gather";
  return null;
}

export function goalFrom(v: unknown): Goal | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return (GOALS as readonly string[]).includes(s) ? (s as Goal) : null;
}

const BASE_GOALS: Record<string, Goal> = { villager: "gather", beast: "explore", spirit: "explore", golem: "guard" };

// A kind's goal: declared, behavior, name, base. Computed once per kind.
export function kindGoal(k: CreatureKind, base: CreatureKind | undefined, written = k.name): Goal | string {
  return k.goal ?? goalFromBehavior(k.ai) ?? goalFromName(written) ?? (base ? (base.goal ?? BASE_GOALS[base.name]) : null) ?? BASE_GOALS[k.name] ?? "explore";
}

const JOB_GOALS: Record<Job, Goal> = {
  none: "gather",
  farmer: "tend",
  woodcutter: "gather",
  fisher: "gather",
  smith: "build",
  builder: "build",
  guard: "guard",
  priest: "worship",
  merchant: "explore",
};

export function jobOf(c: Creature): Job {
  return c.kind === "villager" ? unpackLook(c.look).job : "none";
}

// A villager's goal is its job; children gather, elders tend.
export function goalOfCreature(c: Creature, k: CreatureKind): Goal | string {
  if (c.kind !== "villager") return k.goal ?? "explore";
  const look = unpackLook(c.look);
  if (look.age === "child") return "gather";
  if (look.age === "elder" && look.job !== "priest") return "tend";
  return JOB_GOALS[look.job] ?? "gather";
}

// Who has needs: villagers, the island's walking animals, and spell kinds
// that declare a goal (written for 3.6). Older spell creatures keep their
// declared behavior as it was and take up their goal when it leaves them idle.
export function hasNeeds(c: Creature, k: CreatureKind): boolean {
  return c.kind === "villager" || (k.native && !k.flying && !k.aquatic) || k.needs === true;
}

// Seconds from fed to starving.
const HUNGER_SECONDS: Record<string, number> = {
  villager: 300,
  wolf: 220,
  bear: 260,
  deer: 200,
  rabbit: 160,
  boar: 220,
  // 4.4.5, animals of their region.
  camel: 420,
  lizard: 220,
  hare: 170,
  frog: 220,
  monkey: 220,
  flamingo: 280,
  salamander: 320,
  fox: 230,
  "polar bear": 320,
  heron: 320,
};
// What each eats: plants (covers) or prey. Berries (4.4.5) feed the deer,
// the boar and the bear too.
export const PLANTS: Record<string, number[]> = {
  deer: [C.BUSH, C.FLOWER, C.CROP, C.BERRIES],
  rabbit: [C.CROP, C.FLOWER],
  boar: [C.CROP, C.BUSH, C.BERRIES],
  bear: [C.BUSH, C.BERRIES],
  camel: [C.BUSH, C.CACTUS, C.REEDS, C.CROP],
  lizard: [C.FLOWER, C.BUSH, C.CACTUS],
  hare: [C.BUSH, C.FLOWER, C.BERRIES, C.CROP],
  frog: [C.REEDS, C.FERN],
  monkey: [C.BERRIES, C.BUSH, C.FERN, C.CROP],
  flamingo: [C.REEDS],
  salamander: [C.CRYSTALS, C.FUNGI],
};
export const PREY: Record<string, string[]> = {
  wolf: ["deer", "rabbit"],
  bear: ["deer", "boar", "fish"],
  fox: ["hare", "rabbit", "lizard"],
  "polar bear": ["hare", "fox", "fish"],
  heron: ["frog", "fish"],
};
// Grounds a grazer makes do with when no plant is near: grass for most; the
// salamander licks the minerals of its stone, a flamingo sieves the shallows.
const MAKE_DO: Record<string, number[]> = { salamander: [G.BASALT, G.ASH, G.ROCK], camel: [G.GRASS, G.SAND] };
const TAMABLE = new Set(["deer", "rabbit", "boar", "wolf"]);

// How long a task takes once there, and how close "there" is.
const DURATION: Partial<Record<Task, number>> = {
  use: 2.5,
  forge: 8,
  eat: 2,
  graze: 2.5,
  feast: 3,
  fell: 4,
  plant: 2,
  harvest: 2,
  fish: 9,
  build: 10,
  repair: 5,
  dam: 3,
  take: 1,
  raid: 2,
  pray: 5,
  bury: 4,
  spread: 1.5,
  seed: 1,
  spawn: 2,
  feed: 1.5,
  forage: 3,
  preach: 6,
  heal: 1,
  carry: 0.3,
  trade: 0.5,
  pave: 3,
  roam: 0,
  herd: 0,
  patrol: 1,
  avoid: 0,
  beg: 30,
  rest: Infinity,
};
const REACH: Partial<Record<Task, number>> = {
  use: 2.2,
  trade: 4,
  pave: 1.6,
  forge: 2.4,
  fish: 2.6,
  fell: 1.9,
  build: 2.2,
  repair: 1.9,
  dam: 2,
  rest: 1.5,
  herd: 3,
  roam: 2,
  patrol: 2.5,
  beg: 1.8,
};

export const TASK_WORDS: Record<Task, string> = {
  none: "looking around",
  use: "going to an artifact",
  eat: "going home to eat",
  graze: "grazing",
  rest: "resting",
  hunt: "hunting",
  feast: "eating its catch",
  fell: "felling a tree",
  carry: "carrying it home",
  plant: "sowing a field",
  harvest: "harvesting",
  fish: "fishing",
  build: "building a house",
  pave: "laying a road",
  repair: "rebuilding a ruin",
  dam: "building a dam",
  take: "taking treasure",
  raid: "raiding a village",
  pray: "praying",
  bury: "burying the dead",
  spread: "spreading",
  seed: "dropping seeds",
  roam: "exploring",
  herd: "keeping with its herd",
  spawn: "spawning",
  patrol: "on patrol",
  fight: "fighting",
  beg: "begging for food",
  feed: "feeding an animal",
  trade: "trading between villages",
  forage: "foraging",
  preach: "preaching",
  heal: "tending the wounded",
  avoid: "keeping away",
  forge: "working the forge",
  custom: "at work",
};

const OUT: Plan = { x: 0, y: 0, pace: 0, mood: null };
// Island-wide counts by kind, refreshed every few seconds (births and taming read them).
const census = new WeakMap<World, Map<string, number>>();

export function countOf(world: World, kind: string): number {
  return census.get(world)?.get(kind) ?? 0;
}

// Once a tick from lifeCycle: villages and counts every three seconds.
export function stepGoals(world: World): void {
  storyOn(world);
  if (world.tick % 90 !== 1 && (world.villages.length || world.tick % 15 !== 1)) return;
  findVillages(world);
  const counts = new Map<string, number>();
  for (const c of world.creatures) if (!c.dead) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  census.set(world, counts);
}

// What a creature wants to do now, or null to leave it to older behavior.
export function pursue(world: World, c: Creature, k: CreatureKind, dt: number): Plan | null {
  const m = mindOf(c);
  const needs = hasNeeds(c, k);
  // Fish live a few minutes and breed (migrate, below); old ones float up.
  if (k.native && k.aquatic) {
    const age = ((c.data.age as number | undefined) ?? c.look % 120) + dt;
    c.data.age = age;
    if (age > 300 + (c.look % 180)) c.hp = 0;
  }
  if (m.task === "rest") {
    m.tired = Math.max(0, m.tired - dt * 0.02);
    c.hp = Math.min(life.maxHp(c), c.hp + dt * 0.6);
  }
  m.think -= dt;
  // A task just ended: the next one is thought of at once, in the same tick,
  // not up to 0.85 s later with the creature drifting toward a random point
  // meanwhile (4.3); idle for longer, it looks again ten times a second.
  if (m.task === "none") m.think = (m.acted ?? -9) >= world.tick - 1 ? 0 : Math.min(m.think, 0.1);
  if (m.think <= 0) {
    // Two or three times a second while it hunts or fights, about once and a half otherwise.
    m.think = m.task === "hunt" || m.task === "fight" ? 0.3 + Math.random() * 0.15 : 0.5 + Math.random() * 0.35;
    decide(world, c, k, m, needs);
  }
  if (m.task === "none") {
    m.action = needs ? "looking around" : m.action;
    return null;
  }
  return act(world, c, k, m, dt);
}

// A creature that sleeps out of its hours makes a den where it first sleeps
// (wolves by day): its lair, and its mark on the land.
export function denDown(world: World, c: Creature): void {
  const m = mindOf(c);
  if (m.lair >= 0) return;
  if (c.z > 1) return;
  // Where it lies, or the nearest open ground beside it (wolves sleep among trees).
  let i = -1;
  for (let r = 0; r <= 2 && i < 0; r++)
    for (let dy = -r; dy <= r && i < 0; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.round(c.x) + dx;
        const y = Math.round(c.y) + dy;
        if (x < 1 || y < 1 || x >= world.w - 1 || y >= world.h - 1) continue;
        const j = y * world.w + x;
        if (world.depth[j] < 0.05 && world.cover[j] === C.NONE && world.fire[j] < 0.1) {
          i = j;
          break;
        }
      }
  if (i < 0) return;
  m.lair = i;
  world.ground[i] = G.DIRT;
  world.height[i] = Math.max(world.seaLevel + 0.3, world.height[i] - 0.3);
  markAt(world, "den", i % world.w, Math.floor(i / world.w), c.kind, 6);
  deed(c, "dug a den to sleep in");
}

// Needs grow every tick, asleep or awake (creatures.ts calls it for every
// living creature with needs, whatever it is doing).
export function needsTick(c: Creature, k: CreatureKind, dt: number): void {
  const m = mindOf(c);
  // Creatures awake only by night or by day eat in a shorter window: they get hungry slower.
  const part = k.ai && k.ai.active !== "always" ? 2 : 1;
  m.hunger = Math.min(1, m.hunger + dt / ((HUNGER_SECONDS[c.kind] ?? 240) * part));
  if (m.hunger >= 1) c.hp -= 0.4 * dt;
  if (c.kind === "villager" && m.task !== "rest") m.tired = Math.min(1, m.tired + dt / 400);
}

// Sends a creature walking somewhere (4.4.5: animals arriving from the
// island's edge, or walking out over it).
export function sendTo(c: Creature, x: number, y: number): void {
  if (c.mind && (c.mind.task !== "roam" || Math.hypot(c.mind.tx - x, c.mind.ty - y) > 3)) setTask(c.mind, "roam", x, y, 1);
}

function setTask(m: Mind, task: Task, x: number, y: number, pace = 1, cell = -1, target: Creature | null = null): void {
  m.task = task;
  m.tx = x;
  m.ty = y;
  m.cell = cell;
  m.target = target;
  m.pace = pace;
  m.work = 0;
  m.walk = 0;
  m.near = Infinity;
  m.stall = 0;
  m.action = TASK_WORDS[task];
}

function drop(m: Mind): void {
  m.task = "none";
  m.target = null;
  m.cell = -1;
  m.work = 0;
  m.walk = 0;
}

function cellTask(world: World, m: Mind, task: Task, i: number, pace = 1): void {
  setTask(m, task, i % world.w, Math.floor(i / world.w), pace, i);
}

function moodOf(m: Mind): Plan["mood"] {
  if (m.carry) return "carry";
  if (m.task === "hunt") return "hunt";
  if (m.task === "fight" || m.task === "raid") return "angry";
  if (m.task === "rest") return "asleep";
  if (m.task === "beg" || m.task === "pray") return "lured";
  return null;
}

function act(world: World, c: Creature, k: CreatureKind, m: Mind, dt: number): Plan | null {
  let tx = m.tx;
  let ty = m.ty;
  const t = m.target;
  if (t) {
    if (t.dead && m.task !== "feast" && m.task !== "bury") {
      drop(m);
      return null;
    }
    tx = t.x;
    ty = t.y;
  }
  const d = Math.hypot(tx - c.x, ty - c.y);
  const strike = m.task === "hunt" || m.task === "fight";
  // Back to its task after a flight or a fight: how close it came before
  // does not count, or the way back reads as no progress (4.3: it was then
  // hopped three cells toward its goal and the task dropped).
  if (m.acted !== world.tick - 1) {
    m.near = Infinity;
    m.stall = 0;
  }
  m.acted = world.tick;
  const reach = strike && t ? life.kindOf(c).radius * c.size + life.kindOf(t).radius * t.size + 0.7 : (REACH[m.task] ?? 1.6);
  OUT.mood = moodOf(m);
  if (d > reach) {
    m.walk += dt;
    // The flow field says there is no way there from here (steer.ts): a step
    // out of the hollow, then think again, rather than pace by the wall.
    if (world.time - ((c.data.noWay as number | undefined) ?? -1) < 0.1 && m.task !== "spawn") {
      c.data.noWay = undefined;
      // A herd across the water is not sought again for a while, and the
      // next thought waits a little: no task taken up and dropped every tick.
      if (m.task === "herd") c.data.herdAway = world.time + 8;
      life.free(c, tx, ty);
      drop(m);
      m.acted = undefined;
      m.think = 0.5;
      return null;
    }
    if (d < m.near - 0.3) {
      m.near = d;
      m.stall = 0;
    } else if ((m.stall += dt) > 5) {
      // Five seconds without getting closer: a step out, then think again.
      life.free(c, tx, ty);
      drop(m);
      return null;
    }
    // Somewhere it cannot reach: give up and think again (a fish spawns where it got to).
    // A trip to another village (4.9) is a long walk, not a lost one.
    // So is the way home from it.
    const far = m.task === "trade" || ((m.task === "eat" || m.task === "carry" || m.task === "rest") && Math.hypot(tx - c.x, ty - c.y) > 30);
    if (m.walk > (strike ? 20 : far ? 150 : 30)) {
      if (m.task === "spawn") finish(world, c, k, m);
      else {
        // A home it cannot reach any more (cut off by water, a fallen wall): it settles where it is.
        if (m.task === "eat" || m.task === "carry" || m.task === "rest") {
          c.homeX = c.x;
          c.homeY = c.y;
        }
        drop(m);
      }
      return null;
    }
    OUT.x = tx;
    OUT.y = ty;
    OUT.pace = m.pace;
    // 4.9: a long walk keeps to a road that goes there.
    const long = world.roads.length > 0 && (m.task === "trade" || ((m.task === "eat" || m.task === "carry" || m.task === "rest") && d > 30));
    if (!long) c.data.via = undefined;
    else if ((world.tick + c.id) % 10 === 0 || c.data.via === undefined) c.data.via = alongRoad(world, c.x, c.y, tx, ty, VIA) ? [VIA.x, VIA.y] : null;
    const via = c.data.via as [number, number] | null | undefined;
    if (via) {
      OUT.x = via[0];
      OUT.y = via[1];
    }
    if (m.task === "roam") roamAim(world, c, m, d);
    else if (m.task === "hunt" && t) surround(world, c, t, d);
    return OUT;
  }
  if (strike && t) {
    hit(world, c, k, m, t, dt);
    OUT.x = t.x;
    OUT.y = t.y;
    OUT.pace = m.pace;
    return OUT;
  }
  m.work += dt;
  const duration = m.task === "custom" ? (CUSTOM_GOALS.get(m.custom)?.work ?? 2) : (DURATION[m.task] ?? 2);
  if (m.work >= duration) finish(world, c, k, m);
  OUT.x = c.x;
  OUT.y = c.y;
  OUT.pace = 0;
  OUT.mood = moodOf(m);
  return OUT;
}

// A blow in a hunt or a fight.
function hit(world: World, c: Creature, k: CreatureKind, m: Mind, t: Creature, dt: number): void {
  // 4.4.5 part B: a village with a smithy has armed its people.
  const dps =
    (k.ai?.attack || 0) > 0 ? k.ai!.attack : c.kind === "villager" ? (world.settlements.length && hasJob(world, c.homeX, c.homeY, C.SMITHY) ? 26 : 16) : 20;
  const i = world.idx(Math.max(0, Math.min(world.w - 1, t.x)), Math.max(0, Math.min(world.h - 1, t.y)));
  const blow = dps * dt * (warded(world, i, WARD.harm) && t.kind === "villager" ? 0.15 : 1);
  if (m.work === 0) deed(c, `${m.task === "fight" ? "fought" : "attacked"} a ${base(t.kind)}`);
  m.work += dt;
  t.hp -= blow;
  harmed(world, t, c, blow);
  if (t.kind === "villager" && t.fear <= 0 && m.task === "hunt") {
    t.fear = 3;
    t.fearX = c.x;
    t.fearY = c.y;
  }
  if (t.hp > 0) return;
  if (k.ai?.converts && world.creatures.length < 600 && t.kind !== c.kind) {
    // The victim rises as one of them.
    t.kind = c.kind;
    t.color = k.color;
    t.dead = false;
    t.hp = life.maxHp(t) * 0.6;
    t.fear = 0;
    t.data = {};
    reborn(t);
    world.particles.add({ x: t.x, y: t.y, z: 1, vz: 2, life: 1, color: k.color, size: 2, glow: true });
    deed(c, "turned a villager");
    m.hunger = Math.max(0, m.hunger - 0.7);
    drop(m);
    return;
  }
  t.dead = true;
  if (meter) meter.done(c, "catch");
  deed(c, `${m.task === "fight" ? "killed" : "caught"} a ${base(t.kind)}`);
  if (m.task === "hunt" && hasNeeds(c, k)) setTask(m, "feast", t.x, t.y, 1, -1, t);
  else drop(m);
}

const base = (kind: string) => kind.split("#")[0];

// ---- Deciding ---------------------------------------------------------------

function decide(world: World, c: Creature, k: CreatureKind, m: Mind, needs: boolean): void {
  if (m.task !== "none" && !stillValid(world, c, m)) {
    // Someone else sowed that field, ate that bush, felled that tree: a turn
    // with a reason when it heads elsewhere.
    if (meter) meter.done(c, "target gone");
    drop(m);
  }
  if (needs && urgent(world, c, k, m)) return;
  // Keeping with the herd is thought over again, but not before two seconds.
  if (m.task !== "none" && (m.task !== "herd" || m.walk < 2)) return;
  // An artifact nearby that grants it something, or that its kind acts on (3.7).
  const visit = world.landmarks.length && c.sleep <= 0 ? artifactVisit(world, c) : null;
  if (visit) {
    c.data.visit = visit.visit;
    setTask(m, "use", visit.a.x, visit.a.y, 1);
    m.action = visit.visit.kind === "grant" ? `going to the ${visit.a.name}` : `going for the ${visit.a.name}`;
    return;
  }
  if (c.kind === "villager") work(world, c, m);
  else goalTask(world, c, k, m, needs);
}

function stillValid(world: World, c: Creature, m: Mind): boolean {
  const i = m.cell;
  switch (m.task) {
    case "fell":
      return world.cover[i] === C.TREE;
    case "harvest":
      return world.cover[i] === C.CROP;
    case "plant":
      return world.ground[i] === G.FIELD && world.cover[i] === C.NONE;
    case "graze":
      return i < 0 || world.cover[i] !== C.NONE || world.ground[i] === G.GRASS;
    case "repair":
      return world.cover[i] === C.RUBBLE;
    case "rest":
      // Villagers rest the night through; others until they are well.
      return c.kind === "villager" ? daylight(world.time).night > 0.3 || c.hp < life.maxHp(c) * 0.35 : c.hp < life.maxHp(c) * 0.9;
    case "beg":
      return m.hunger > 0.3 && m.fed < 3;
    case "take":
      return world.lures.some((p) => p.taken && Math.abs(p.x - m.tx) < 0.6 && Math.abs(p.y - m.ty) < 0.6);
    case "pave": {
      const job = c.data.pave as PaveJob | undefined;
      return !!job && world.roads.includes(job.road) && job.road.cells[job.k] === job.cell;
    }
  }
  return true;
}

// Needs before goals: rest when hurt, keep away from what hurt it before, eat
// when hungry, sleep at night (villagers), and the small kindnesses between
// people and animals that make taming.
function urgent(world: World, c: Creature, k: CreatureKind, m: Mind): boolean {
  const villager = c.kind === "villager";
  const job = villager ? jobOf(c) : "none";
  if (c.hp < life.maxHp(c) * 0.35 && m.task !== "rest" && m.task !== "fight") {
    setTask(m, "rest", m.lair >= 0 ? m.lair % world.w : c.homeX, m.lair >= 0 ? Math.floor(m.lair / world.w) : c.homeY);
    return true;
  }
  if ((m.task === "rest" && m.hunger < 0.8) || m.task === "fight" || m.task === "feast") return true;
  if (villager) {
    // What it remembers harmed it: guards go for it, the rest keep away.
    if (m.memory.some((e) => e.feel <= -1)) {
      let worst: Creature | null = null;
      let worstD = 8;
      for (const o of world.crowd.near(world, c.x, c.y, 8)) {
        if (o === c || o.kind === "villager" || o.mind?.tame) continue;
        const d = Math.hypot(o.x - c.x, o.y - c.y);
        if (d < worstD && feeling(c, o.kind) <= -1) {
          worstD = d;
          worst = o;
        }
      }
      if (worst) {
        if (job === "guard") setTask(m, "fight", worst.x, worst.y, 1.3, -1, worst);
        else setTask(m, "avoid", c.x + (c.x - worst.x) * 1.5, c.y + (c.y - worst.y) * 1.5, 1.4);
        m.action = `${job === "guard" ? "going for" : "keeping away from"} the ${base(worst.kind)} that hurt them`;
        return true;
      }
    }
    if (m.task === "avoid") return true;
  }
  // A meal starts at 0.7 and goes on until 0.3 (4.3: it used to start at
  // 0.55 and stop after one mouthful, so a deer went back and forth between
  // grazing and roaming). Night hunters have a short night: they hunt as
  // soon as they are a little hungry.
  const night = k.ai?.active === "night";
  if (m.hunger > (night ? 0.3 : 0.7)) m.meal = true;
  else if (m.hunger <= (night ? 0.1 : 0.3)) m.meal = false;
  if (m.meal && !EATING.has(m.task) && m.task !== "carry") {
    if (eat(world, c, k, m)) return true;
  }
  if (EATING.has(m.task)) return true;
  if (villager) {
    const night = daylight(world.time).night;
    // 4.6 part B: a necromancer keeps the night, among the graves.
    if (night > 0.6 && unpackLook(c.look).calling === "necromancer") {
      if (m.task !== "roam") {
        const yard = world.marks.find((mk) => mk.kind === "graveyard" && Math.hypot(mk.x - c.homeX, mk.y - c.homeY) < 20);
        const a = Math.random() * Math.PI * 2;
        setTask(m, "roam", yard ? yard.x + 0.5 : c.homeX + Math.cos(a) * 5, yard ? yard.y + 0.5 : c.homeY + Math.sin(a) * 5, 0.6);
        m.action = "walking among the graves";
      }
      return true;
    }
    if (night > 0.6 && job !== "guard") {
      setTask(m, "rest", c.homeX, c.homeY);
      m.action = "asleep at home";
      return true;
    }
    // 4.4.5 part B: at dusk the grown-ups of a village with a tavern gather there.
    if (night > 0.2 && job !== "guard" && world.settlements.length && unpackLook(c.look).age !== "child") {
      const tavern = tavernFor(world, c);
      if (tavern) {
        if (m.task !== "roam" || Math.hypot(m.tx - tavern.x, m.ty - tavern.y) > 3) setTask(m, "roam", tavern.x, tavern.y, 0.9);
        m.action = "at the tavern";
        return true;
      }
    }
    if (m.task !== "feed" && Math.random() < 0.5) {
      const v = villageOf(world, c.homeX, c.homeY);
      if (v && v.food >= 2) {
        for (const o of world.crowd.near(world, c.x, c.y, 4)) {
          if (o.mind?.task === "beg" && Math.hypot(o.x - c.x, o.y - c.y) < 4) {
            setTask(m, "feed", o.x, o.y, 1, -1, o);
            m.action = `feeding a ${base(o.kind)}`;
            return true;
          }
        }
      }
    }
    return m.task === "feed";
  }
  // A hungry animal near a village with food may come to beg, by day.
  if (TAMABLE.has(c.kind) && !m.tame && m.hunger > 0.6 && m.task !== "beg" && Math.random() < 0.05 && daylight(world.time).night < 0.3) {
    const v = villageOf(world, c.x, c.y);
    if (v && v.food >= 3 && Math.hypot(v.x - c.x, v.y - c.y) < 24) {
      setTask(m, "beg", v.x, v.y, 0.8);
      return true;
    }
  }
  return m.task === "beg";
}

const EATING = new Set<Task>(["eat", "graze", "hunt", "feast", "forage"]);

// Finds something to eat for its diet: the village's food, a plant, or prey.
function eat(world: World, c: Creature, k: CreatureKind, m: Mind): boolean {
  if (c.kind === "villager") {
    const v = villageOf(world, c.homeX, c.homeY);
    if (v && v.food >= 1) {
      setTask(m, "eat", c.homeX, c.homeY);
      return true;
    }
    return forage(world, c, m);
  }
  const prey = PREY[c.kind] ?? (k.needs ? preyOf(k) : null);
  if (prey && prey.length) {
    // Is it awake? Hunters out of their hours do not hunt.
    if (huntPrey(world, c, k, m, prey)) return true;
  }
  const plants = PLANTS[c.kind] ?? (prey ? null : [C.BUSH, C.FLOWER, C.CROP]);
  if (plants) {
    // The next mouthful close by and ahead, then further off.
    const test = (j: number) => plants.includes(world.cover[j]) && world.depth[j] < 0.3;
    let i = findCell(world, c.x + Math.cos(c.hd) * 3, c.y + Math.sin(c.hd) * 3, 5, 12, test);
    if (i < 0) i = findCell(world, c.x, c.y, 16, 24, test);
    if (i >= 0) {
      cellTask(world, m, "graze", i);
      return true;
    }
    // Grass will do (a boar roots it up).
    const here = world.idx(c.x, c.y);
    if ((MAKE_DO[c.kind] ?? [G.GRASS]).includes(world.ground[here]) && world.cover[here] === C.NONE) {
      cellTask(world, m, "graze", here);
      return true;
    }
    if (k.native && k.swims && !k.aquatic && world.fluid[here] === F.WATER && world.depth[here] < 0.9) {
      cellTask(world, m, "graze", here);
      return true;
    }
  }
  return false;
}

function preyOf(k: CreatureKind): string[] {
  return k.ai?.prey.length ? k.ai.prey : ["deer", "rabbit", "boar"];
}

function huntPrey(world: World, c: Creature, k: CreatureKind, m: Mind, prey: string[]): boolean {
  // A starving hunter follows the scent much further.
  const sense = (k.ai?.sense ?? 12) * (m.hunger > 0.75 ? 3 : 1.4);
  let best: Creature | null = null;
  let bestD = sense;
  for (const o of world.crowd.near(world, c.x, c.y, sense)) {
    if (o === c || o.kind === c.kind || o.mind?.tame || !names(prey, o.kind)) continue;
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  if (!best) return false;
  setTask(m, "hunt", best.x, best.y, 1.3, -1, best);
  m.action = `hunting a ${base(best.kind)}`;
  // The pack joins in.
  for (const o of world.crowd.near(world, c.x, c.y, 10)) {
    if (o === c || o.kind !== c.kind || !o.mind || o.mind.task !== "none" || o.mind.hunger < 0.3) continue;
    setTask(o.mind, "hunt", best.x, best.y, 1.3, -1, best);
    o.mind.action = `hunting a ${base(best.kind)} with the pack`;
  }
  return true;
}

// A random cell within r that passes the test, from a few samples.
function findCell(world: World, x: number, y: number, r: number, tries: number, test: (i: number) => boolean, min = 0): number {
  let best = -1;
  let bestD = Infinity;
  for (let k = 0; k < tries; k++) {
    const a = Math.random() * Math.PI * 2;
    const d = min + Math.random() * (r - min);
    const cx = Math.round(x + Math.cos(a) * d);
    const cy = Math.round(y + Math.sin(a) * d);
    if (cx < 1 || cy < 1 || cx >= world.w - 1 || cy >= world.h - 1) continue;
    const i = cy * world.w + cx;
    if (!test(i)) continue;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// A solid thing one can stand next to: the edge of a wood, not its heart.
function reachable(world: World, i: number): boolean {
  for (const d of [1, -1, world.w, -world.w]) {
    const j = i + d;
    if (j >= 0 && j < world.n && world.depth[j] < 0.3 && !world.materials.get("cover", world.cover[j]).solid) return true;
  }
  return false;
}

// Not inside a tree, a house or a rock, nor hemmed in by them.
function standable(world: World, i: number): boolean {
  if (world.materials.get("cover", world.cover[i]).solid) return false;
  let open = 0;
  for (const d of [1, -1, world.w, -world.w]) {
    const j = i + d;
    if (j >= 0 && j < world.n && !world.materials.get("cover", world.cover[j]).solid) open++;
  }
  return open >= 3;
}

const dryFree = (world: World, i: number) => world.depth[i] < 0.05 && world.cover[i] === C.NONE && world.fire[i] < 0.1;

// ---- Villagers: jobs as goals ----------------------------------------------------

function work(world: World, c: Creature, m: Mind): void {
  const v = villageOf(world, c.homeX, c.homeY);
  const job = jobOf(c);
  const look = unpackLook(c.look);
  if (!v) {
    forage(world, c, m);
    return;
  }
  if (look.age === "child") {
    forage(world, c, m, true);
    return;
  }
  if (look.age === "elder" && job !== "priest") {
    if (!plantFlowers(world, c, m)) forage(world, c, m);
    return;
  }
  // A job a spell invented and hired it for (w.hire), when its spell's rules are loaded.
  const hired = m.job ? CUSTOM_GOALS.get(m.job) : undefined;
  if (hired && customTask(world, c, m, hired)) return;
  if (job !== "guard" && job !== "priest" && goToMarket(world, c, m, v)) return;
  job2(world, c, m, v, job);
  // Nothing for its job right now: lend a hand on a road, or a chore, so
  // nobody just stands there.
  if (m.task === "none" && (job === "none" || job === "woodcutter" || job === "farmer") && Math.random() < 0.5 && layRoad(world, c, m, v)) return;
  if (m.task === "none" && !forage(world, c, m) && Math.random() < 0.25) plantFlowers(world, c, m, true);
}

function job2(world: World, c: Creature, m: Mind, v: Village, job: Job): void {
  switch (job) {
    case "farmer":
      return farm(world, c, m, v);
    case "woodcutter":
      // 4.4.5 part B: a lumber yard keeps twice the wood.
      if (v.wood < (world.settlements.length && hasJob(world, c.homeX, c.homeY, C.LUMBERYARD) ? 24 : 12)) fellTree(world, c, m, v);
      else forage(world, c, m);
      return;
    case "fisher":
      return fishAt(world, c, m);
    case "builder":
      return build(world, c, m, v);
    case "smith":
      // 4.6 part B: a blacksmith works its village's smithy, most of the time.
      if (unpackLook(c.look).calling === "blacksmith" && Math.random() < 0.75) {
        const forge = smithyNear(world, c.homeX, c.homeY);
        if (forge >= 0) return cellTask(world, m, "forge", forge);
      }
      return build(world, c, m, v);
    case "guard":
      return guardVillage(world, c, m, v);
    case "priest":
      return priest(world, c, m, v);
    case "merchant":
      return trade(world, c, m, v);
    default:
      forage(world, c, m);
  }
}

function farm(world: World, c: Creature, m: Mind, v: Village): void {
  // The next furrow close by and ahead first (4.3), then anywhere in the fields.
  const ax = c.x + Math.cos(c.hd) * 2;
  const ay = c.y + Math.sin(c.hd) * 2;
  const isRipe = (i: number) => world.cover[i] === C.CROP && world.fire[i] < 0.1;
  let ripe = Math.hypot(ax - v.x, ay - v.y) < 18 ? findCell(world, ax, ay, 4, 8, isRipe) : -1;
  if (ripe < 0) ripe = findCell(world, v.x, v.y, 18, 24, isRipe);
  if (ripe >= 0 && v.food < 30) return cellTask(world, m, "harvest", ripe);
  const isBare = (i: number) => world.ground[i] === G.FIELD && world.cover[i] === C.NONE && world.depth[i] < 0.1;
  let bare = Math.hypot(ax - v.x, ay - v.y) < 18 ? findCell(world, ax, ay, 4, 8, isBare) : -1;
  if (bare < 0) bare = findCell(world, v.x, v.y, 18, 24, isBare);
  if (bare >= 0) return cellTask(world, m, "plant", bare);
  // No field left (burnt, flooded): till a new one on grass or dirt near the houses.
  const fresh = findCell(
    world,
    v.x,
    v.y,
    14,
    16,
    (i) => (world.ground[i] === G.GRASS || world.ground[i] === G.DIRT || world.ground[i] === G.ASH) && dryFree(world, i),
    7,
  );
  if (fresh >= 0) {
    cellTask(world, m, "plant", fresh);
    m.action = "tilling a new field";
  }
}

function fellTree(world: World, c: Creature, m: Mind, v: Village): boolean {
  // Not the orchards by the houses: the edge of the woods.
  const tree = findCell(world, v.x, v.y, 22, 30, (i) => world.cover[i] === C.TREE && world.fire[i] < 0.1 && reachable(world, i), 7);
  if (tree < 0) return false;
  cellTask(world, m, "fell", tree);
  return true;
}

function fishAt(world: World, c: Creature, m: Mind): void {
  // Deep enough for fish, at the shore so it can stand beside it.
  const water = findCell(world, c.homeX, c.homeY, 30, 40, (i) => world.fluid[i] === F.WATER && world.depth[i] > 0.6 && nextToLand(world, i));
  if (water < 0) {
    forage(world, c, m);
    return;
  }
  cellTask(world, m, "fish", water);
}

// The nearest smithy cell to a home, within 22 cells; -1 when there is none.
export function smithyNear(world: World, x: number, y: number): number {
  return findCell(world, x, y, 22, 30, (i) => world.cover[i] === C.SMITHY);
}

function build(world: World, c: Creature, m: Mind, v: Village): void {
  const ruin = findCell(world, v.x, v.y, 14, 20, (i) => world.cover[i] === C.RUBBLE);
  if (ruin >= 0) return cellTask(world, m, "repair", ruin);
  // 4.9: a road the village marked out is laid, most of the time.
  if (Math.random() < 0.7 && layRoad(world, c, m, v)) return;
  const cap = 12 + Math.floor(v.gold / 4);
  if (v.wood >= 5 && v.houses < cap && v.people >= v.houses * 1.2) {
    const site = houseSite(world, v.x, v.y);
    if (site >= 0) return cellTask(world, m, "build", site);
  }
  if (v.wood < 5 && fellTree(world, c, m, v)) return;
  forage(world, c, m);
}

// A 2 by 2 spot of dry, free, flat land near a village; its top left cell.
// 4.4.5 part B: along the main street first, so houses line the paths.
// The next cell of one of its village's roads, from the village's end.
function layRoad(world: World, c: Creature, m: Mind, v: Village): boolean {
  if (!world.roads.length) return false;
  const job = nextPave(world, v);
  if (!job) return false;
  claim(world, job.cell);
  c.data.pave = job;
  setTask(m, "pave", job.stand % world.w, Math.floor(job.stand / world.w), 1, job.cell);
  m.action = job.bridge ? `building a bridge to ${job.road.a === nameNear(world, v) ? job.road.b : job.road.a}` : "laying a road";
  return true;
}

function nameNear(world: World, v: Village): string {
  return settlementNear(world, v.x, v.y)?.name ?? "the village";
}

// 4.9: every minute and a half or so a village sends someone to market: to
// a village within a long walk, or now and then to see a wonder. Ends that
// keep seeing each other's people lay a road between them (roads.ts).
function goToMarket(world: World, c: Creature, m: Mind, v: Village): boolean {
  if (v.market === undefined) v.market = world.time + 20 + Math.random() * 60;
  if (world.time < v.market) return false;
  v.market = world.time + 70 + Math.random() * 40;
  let dest: { x: number; y: number; name: string; to: Village | Wonder } | null = null;
  const wonders = world.wonders.filter((w) => Math.hypot(w.x - v.x, w.y - v.y) < 70 && Math.hypot(w.x - v.x, w.y - v.y) > 16);
  if (wonders.length && Math.random() < 0.3) {
    const w = wonders[Math.floor(Math.random() * wonders.length)];
    // To its edge, not into it.
    const d = Math.hypot(v.x - w.x, v.y - w.y);
    const r = Math.min(6, Math.max(2, w.r)) + 1;
    dest = { x: w.x + ((v.x - w.x) / d) * r, y: w.y + ((v.y - w.y) / d) * r, name: w.name, to: w };
  } else {
    // Nearer villages more often.
    let total = 0;
    const near = world.villages.filter((o) => o !== v && Math.hypot(o.x - v.x, o.y - v.y) < 110);
    for (const o of near) total += 1 / Math.max(20, Math.hypot(o.x - v.x, o.y - v.y));
    let pick = Math.random() * total;
    for (const o of near) {
      pick -= 1 / Math.max(20, Math.hypot(o.x - v.x, o.y - v.y));
      if (pick <= 0) {
        dest = { x: o.x, y: o.y, name: nameNear(world, o), to: o };
        break;
      }
    }
  }
  if (!dest) return false;
  c.data.trip = { from: v, to: dest.to };
  // Counted as it sets out: a river or a cliff that turns it back is why
  // the two lay a road, with a bridge (roads.ts).
  noteTrip(world, v, dest.to);
  setTask(m, "trade", dest.x, dest.y, 1);
  m.action = dest.to && "seed" in dest.to ? `going to see ${dest.name}` : `going to market in ${dest.name}`;
  return true;
}

function houseSite(world: World, x: number, y: number): number {
  const s = world.settlements.length ? settlementNear(world, x, y) : null;
  if (s) {
    const [dx, dy] = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ][s.street ?? 0];
    for (let tries = 0; tries < 16; tries++) {
      const t = 4 + Math.floor(Math.random() * 12) * (Math.random() < 0.3 ? -0.5 : 1);
      const side = (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.5 ? 2 : 3);
      const hx = Math.round(s.x + dx * t - dy * side - (side < 0 ? 1 : 0) * Math.abs(dy));
      const hy = Math.round(s.y + dy * t + dx * side - (side < 0 ? 1 : 0) * Math.abs(dx));
      if (hx < 1 || hy < 1 || hx + 2 >= world.w || hy + 2 >= world.h) continue;
      const cells = [hy * world.w + hx, hy * world.w + hx + 1, (hy + 1) * world.w + hx, (hy + 1) * world.w + hx + 1];
      const h0 = world.height[cells[0]];
      if (
        cells.some(
          (i) => !dryFree(world, i) || world.ground[i] === G.FIELD || isWay(world.ground[i]) || planned(world, i) || Math.abs(world.height[i] - h0) > 1.2,
        )
      )
        continue;
      return cells[0];
    }
  }
  for (let tries = 0; tries < 24; tries++) {
    const hx = Math.round(x + (Math.random() - 0.5) * 20);
    const hy = Math.round(y + (Math.random() - 0.5) * 20);
    if (hx < 1 || hy < 1 || hx + 2 >= world.w || hy + 2 >= world.h) continue;
    const cells = [hy * world.w + hx, hy * world.w + hx + 1, (hy + 1) * world.w + hx, (hy + 1) * world.w + hx + 1];
    const h0 = world.height[cells[0]];
    if (
      cells.some(
        (i) => !dryFree(world, i) || world.ground[i] === G.FIELD || world.ground[i] === G.ROAD || planned(world, i) || Math.abs(world.height[i] - h0) > 1.2,
      )
    )
      continue;
    return cells[0];
  }
  return -1;
}

function guardVillage(world: World, c: Creature, m: Mind, v: { x: number; y: number }): void {
  // 4.4.5 part B: from a watchtower, guards see twice as far.
  const foe = intruder(world, c, v.x, v.y, world.settlements.length && hasJob(world, v.x, v.y, C.WATCHTOWER) ? 30 : 15);
  if (foe) {
    setTask(m, "fight", foe.x, foe.y, 1.3, -1, foe);
    m.action = `driving off a ${base(foe.kind)}`;
    return;
  }
  // Animals in the fields: chased away.
  for (const o of world.crowd.near(world, v.x, v.y, 16)) {
    if (o.mind?.tame || !life.kindOf(o).native || !PLANTS[o.kind]) continue;
    if (Math.hypot(o.x - v.x, o.y - v.y) > 16) continue;
    o.fear = Math.max(o.fear, 3);
    o.fearX = c.x;
    o.fearY = c.y;
    setTask(m, "patrol", o.x, o.y, 1.2);
    m.action = `chasing a ${o.kind} from the fields`;
    deed(c, `chased a ${o.kind} from the fields`);
    return;
  }
  const a = Math.random() * Math.PI * 2;
  const r = 7 + Math.random() * 6;
  setTask(m, "patrol", v.x + Math.cos(a) * r, v.y + Math.sin(a) * r, 0.8);
}

// Something near a place that threatens what lives there: a hunter of people,
// a thief, a raider, a bear, or a kind remembered for harm.
function intruder(world: World, c: Creature, x: number, y: number, r: number): Creature | null {
  let best: Creature | null = null;
  let bestD = r;
  for (const o of world.crowd.near(world, x, y, r)) {
    if (o === c || o.kind === "villager" || o.mind?.tame || o.kind === c.kind) continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d >= bestD) continue;
    const ok = life.kindOf(o);
    const ai = ok.ai;
    const g = o.mind?.goal;
    const threat =
      (ai && ((ai.mode === "hunt" && (!ai.prey.length || names(ai.prey, "villager"))) || ai.converts || ai.aura === "hurt" || ai.aura === "burn")) ||
      g === "steal" ||
      g === "hoard" ||
      g === "convert" ||
      o.kind === "bear" ||
      feeling(c, o.kind) <= -1;
    if (threat) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function priest(world: World, c: Creature, m: Mind, v: Village): void {
  // The dead of the village are buried first.
  let corpse: Creature | null = null;
  for (const o of world.creatures) {
    if (!o.dead || o.kind !== "villager" || o.deadFor > 30 || o.data.buried) continue;
    if (Math.hypot(o.x - v.x, o.y - v.y) < 24) {
      corpse = o;
      break;
    }
  }
  if (corpse) {
    setTask(m, "bury", corpse.x, corpse.y, 1, -1, corpse);
    return;
  }
  worship(world, c, m);
}

function trade(world: World, c: Creature, m: Mind, v: Village): void {
  let poor: Village | null = null;
  for (const o of world.villages) if (o !== v && o.food + 4 < v.food && (!poor || o.food < poor.food)) poor = o;
  if (poor) {
    v.food -= 2;
    m.carry = "food";
    c.data.trip = { from: v, to: poor };
    noteTrip(world, v, poor);
    setTask(m, "trade", poor.x, poor.y, 1);
    m.action = "taking food to a poorer village";
    return;
  }
  forage(world, c, m);
}

function forage(world: World, c: Creature, m: Mind, child = false): boolean {
  const i = findCell(world, c.homeX, c.homeY, 16, 18, (j) => (world.cover[j] === C.BUSH || (child && world.cover[j] === C.FLOWER)) && world.fire[j] < 0.1);
  if (i < 0) return false;
  cellTask(world, m, "forage", i);
  m.action = child ? "picking berries and flowers" : "picking berries";
  return true;
}

function plantFlowers(world: World, c: Creature, m: Mind, surely = false): boolean {
  const i = findCell(
    world,
    c.homeX,
    c.homeY,
    8,
    12,
    (j) => (world.ground[j] === G.GRASS || world.ground[j] === G.DIRT) && dryFree(world, j) && crowded(world, j) < 2,
  );
  if (i < 0 || (!surely && Math.random() < 0.3)) return false;
  cellTask(world, m, "seed", i, 0.7);
  m.action = "planting flowers by the houses";
  return true;
}

// ---- Everyone else: the goal of its kind ------------------------------------

function goalTask(world: World, c: Creature, k: CreatureKind, m: Mind, needs: boolean): void {
  let g = m.tame && c.kind === "wolf" ? "guard" : m.goal;
  // A spell's own goal: what it seeks, else the built-in goal it is like.
  const custom = CUSTOM_GOALS.get(g);
  if (custom) {
    if (customTask(world, c, m, custom)) return;
    g = custom.like ?? "explore";
  }
  // A fed hunter does not hunt; its goal fills its day.
  switch (g) {
    case "hunt":
      if (!needs && k.ai?.mode === "hunt") return void wander(world, c, k, m);
      if (!needs && huntPrey(world, c, k, m, preyOf(k))) return;
      return void wander(world, c, k, m);
    case "gather":
      return void gather(world, c, k, m);
    case "hoard":
      return void hoard(world, c, k, m);
    case "build":
      return void buildLair(world, c, k, m);
    case "tend":
      return void tend(world, c, k, m);
    case "guard": {
      const home = m.tame ? (world.villages[m.tame - 1] ?? { x: c.homeX, y: c.homeY }) : { x: c.homeX, y: c.homeY };
      return guardVillage(world, c, m, home);
    }
    case "steal":
      return void steal(world, c, k, m);
    case "spread":
      return void spread(world, c, k, m);
    case "convert":
      return void convert(world, c, k, m, needs);
    case "worship":
      return void worship(world, c, m);
    case "explore":
      return void wander(world, c, k, m);
    case "migrate":
      return void migrate(world, c, k, m);
  }
}

// Herds keep together; otherwise it roams, and an explorer leaves a cairn.
function wander(world: World, c: Creature, k: CreatureKind, m: Mind): boolean {
  if (herd(world, c, k, m)) return true;
  if (flock(world, c, m)) return true;
  // A herd drifts together (4.3): its members roam a little ahead of its
  // middle, the way the herd is going, instead of each off on its own and
  // back again when it finds itself alone, a leash pulled back and forth.
  const h = HERD;
  const herded = h.n > 0 && !m.tame;
  const range = herded ? 10 : m.goal === "explore" ? 30 : 14;
  const heading = herded && Math.hypot(h.hx, h.hy) > 0.3 ? Math.atan2(h.hy, h.hx) : c.hd;
  for (let tries = 0; tries < 6; tries++) {
    // Mostly on the way it is already going (4.3): a new point anywhere
    // around it was an about turn one time in three. A herd's point is well
    // ahead of its middle, so it walks on rather than stopping every few steps.
    const a = tries < 4 ? heading + (Math.random() - 0.5) * (herded ? 1.2 : 2.2) : Math.random() * Math.PI * 2;
    const r = range * (0.5 + Math.random() * 0.5);
    const ox = herded ? h.x : m.tame ? (world.villages[m.tame - 1]?.x ?? c.homeX) : c.x;
    const oy = herded ? h.y : m.tame ? (world.villages[m.tame - 1]?.y ?? c.homeY) : c.y;
    const x = ox + Math.cos(a) * r;
    const y = oy + Math.sin(a) * r;
    if (x < 2 || y < 2 || x > world.w - 3 || y > world.h - 3) continue;
    const i = world.idx(x, y);
    // Open ground it can stand on (4.3: a point in the middle of a wood had
    // it pacing along the trees until it gave up).
    if (k.aquatic ? world.fluid[i] !== F.WATER || world.depth[i] < 0.8 : !k.flying && (world.depth[i] > 0.3 || !standable(world, i))) continue;
    setTask(m, "roam", x, y, 0.8);
    return true;
  }
  return false;
}

// The herd herd() last looked at: how many, its middle, where it heads.
const HERD = { n: 0, x: 0, y: 0, hx: 0, hy: 0 };

function herd(world: World, c: Creature, k: CreatureKind, m: Mind): boolean {
  HERD.n = 0;
  if (!k.native || c.kind === "bear" || c.kind === "bird") return false;
  if (world.time < ((c.data.herdAway as number | undefined) ?? 0)) return false;
  let n = 0;
  let sx = 0;
  let sy = 0;
  let hx = 0;
  let hy = 0;
  for (const o of world.crowd.near(world, c.x, c.y, 12)) {
    if (o === c || o.kind !== c.kind) continue;
    n++;
    sx += o.x;
    sy += o.y;
    if (o.sp > 0.3) {
      hx += Math.cos(o.hd);
      hy += Math.sin(o.hd);
    }
  }
  if (!n) return false;
  sx /= n;
  sy /= n;
  HERD.n = n;
  HERD.x = (sx * n + c.x) / (n + 1);
  HERD.y = (sy * n + c.y) / (n + 1);
  HERD.hx = hx / n;
  HERD.hy = hy / n;
  // Joins its herd once more than 7 cells from its middle, and is there at 3
  // (REACH): not in and out of it at one distance (4.3).
  if (Math.hypot(sx - c.x, sy - c.y) < 7) return false;
  setTask(m, "herd", sx, sy, 0.9);
  return true;
}

// Birds fly with a flock (4.3): the lowest id of those around that is on its
// way somewhere leads, and the others take the same way, a little apart.
const FLOCKS = new Set(["bird"]);
function flock(world: World, c: Creature, m: Mind): boolean {
  if (!FLOCKS.has(c.kind)) return false;
  let lead: Creature | null = null;
  for (const o of world.crowd.near(world, c.x, c.y, 16)) {
    if (o.kind !== c.kind || o.id >= c.id || !o.mind || o.data.flockLead !== undefined) continue;
    if (!lead || o.id < lead.id) lead = o;
  }
  if (!lead || !lead.mind) {
    c.data.flockLead = undefined;
    return false;
  }
  c.data.flockLead = lead.id;
  // Where the leader goes, or close round it while it stops to sow.
  const going = lead.mind.task === "roam";
  setTask(m, "roam", (going ? lead.mind.tx : lead.x) + (Math.random() - 0.5) * 4, (going ? lead.mind.ty : lead.y) + (Math.random() - 0.5) * 4, 0.85);
  m.action = "flying with its flock";
  return true;
}

// On its way somewhere: a flock member keeps its place by its leader; anyone
// else bends its way a little, slowly, so a walk is not a ruler line (4.3).
const VIA = { x: 0, y: 0 };

function roamAim(world: World, c: Creature, m: Mind, d: number): void {
  const id = c.data.flockLead as number | undefined;
  if (id !== undefined) {
    for (const o of world.crowd.near(world, c.x, c.y, 16)) {
      if (o.id !== id || o.dead || o.mind?.task !== "roam") continue;
      const back = 1.5 + (c.id % 4) * 0.8;
      const side = (((c.id >> 2) % 3) - 1) * 1.6;
      const ux = Math.cos(o.hd);
      const uy = Math.sin(o.hd);
      OUT.x = o.x - ux * back - uy * side;
      OUT.y = o.y - uy * back + ux * side;
      // Falling behind: a little faster than the leader, to catch up.
      OUT.pace = Math.hypot(OUT.x - c.x, OUT.y - c.y) > 3 ? m.pace * 1.25 : m.pace;
      return;
    }
    c.data.flockLead = undefined;
  }
  if (d < 4) return;
  const bend = Math.sin(world.time * 0.35 + c.id * 1.7) * 0.35 + Math.sin(world.time * 0.13 + c.id) * 0.2;
  const dx = OUT.x - c.x;
  const dy = OUT.y - c.y;
  const cs = Math.cos(bend);
  const sn = Math.sin(bend);
  OUT.x = c.x + dx * cs - dy * sn;
  OUT.y = c.y + dx * sn + dy * cs;
}

// A pack closes in from around its prey (4.3): each wolf hunting the same
// animal takes its own place on a circle around it, starting behind it, and
// goes straight for it once close.
function surround(world: World, c: Creature, t: Creature, d: number): void {
  if (d < 3) return;
  let rank = 0;
  let n = 1;
  for (const o of world.crowd.near(world, t.x, t.y, 16)) {
    if (o === c || o.kind !== c.kind || o.mind?.task !== "hunt" || o.mind.target !== t) continue;
    n++;
    if (o.id < c.id) rank++;
  }
  if (n < 2) return;
  const behind = t.hd + Math.PI;
  const a = behind + (rank - (n - 1) / 2) * ((Math.PI * 1.4) / Math.max(1, n - 1));
  const r = Math.min(3, d * 0.5);
  OUT.x = t.x + Math.cos(t.hd) * t.sp * 0.4 + Math.cos(a) * r;
  OUT.y = t.y + Math.sin(t.hd) * t.sp * 0.4 + Math.sin(a) * r;
}

function lairOf(world: World, c: Creature, m: Mind, farFromVillages: boolean): number {
  if (m.lair >= 0) return m.lair;
  let best = -1;
  let bestScore = -Infinity;
  const spread = farFromVillages ? 60 : 30;
  for (let k = 0; k < 30; k++) {
    const x = Math.round(c.homeX + (Math.random() - 0.5) * spread);
    const y = Math.round(c.homeY + (Math.random() - 0.5) * spread);
    if (x < 3 || y < 3 || x >= world.w - 3 || y >= world.h - 3) continue;
    const i = y * world.w + x;
    if (!dryFree(world, i)) continue;
    const v = villageOf(world, x, y);
    const far = v ? Math.hypot(v.x - x, v.y - y) : 40;
    const score = (farFromVillages ? Math.min(far, 25) : 0) - Math.hypot(x - c.homeX, y - c.homeY) * 0.2;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  m.lair = best >= 0 ? best : world.idx(c.homeX, c.homeY);
  return m.lair;
}

function gather(world: World, c: Creature, k: CreatureKind, m: Mind): void {
  if (hasNeeds(c, k)) {
    // Grazers graze through a meal (urgent: from 0.7 to 0.3) and keep with their herd.
    if (m.meal && eat(world, c, k, m)) return;
    wander(world, c, k, m);
    return;
  }
  // A spell's gatherer brings what it finds to its den.
  if (m.carry) {
    const lair = lairOf(world, c, m, false);
    setTask(m, "carry", lair % world.w, Math.floor(lair / world.w));
    return;
  }
  const i = findCell(
    world,
    c.x,
    c.y,
    14,
    18,
    (j) => (world.cover[j] === C.BUSH || world.cover[j] === C.FLOWER || world.cover[j] === C.CROP) && world.fire[j] < 0.1,
  );
  if (i >= 0) cellTask(world, m, "forage", i);
  else wander(world, c, k, m);
}

function hoard(world: World, c: Creature, k: CreatureKind, m: Mind): void {
  if (m.carry) {
    const lair = lairOf(world, c, m, true);
    setTask(m, "carry", lair % world.w, Math.floor(lair / world.w), 1.1);
    m.action = "taking treasure to its hoard";
    return;
  }
  // Gold on the land first, then a village's gold.
  let best: { x: number; y: number } | null = null;
  let bestD = 40;
  for (const p of world.lures) {
    if (!p.taken) continue;
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best) {
    setTask(m, "take", best.x, best.y, 1.1);
    return;
  }
  let rich: Village | null = null;
  for (const v of world.villages) if (v.gold > 0 && Math.hypot(v.x - c.x, v.y - c.y) < 70 && (!rich || v.gold > rich.gold)) rich = v;
  if (rich && Math.random() < 0.15) {
    setTask(m, "raid", rich.x, rich.y, 1.2);
    return;
  }
  wander(world, c, k, m);
}

function buildLair(world: World, c: Creature, k: CreatureKind, m: Mind): void {
  if (!m.carry) {
    const tree = findCell(world, c.x, c.y, 16, 20, (i) => (world.cover[i] === C.TREE || world.cover[i] === C.BUSH) && reachable(world, i));
    if (tree >= 0) return cellTask(world, m, "fell", tree);
    return void wander(world, c, k, m);
  }
  // Carrying wood: a dam where water runs near, a den otherwise.
  const water = findCell(
    world,
    c.homeX,
    c.homeY,
    14,
    24,
    (i) => world.fluid[i] === F.WATER && world.depth[i] > 0.15 && world.depth[i] < 2.5 && nextToLand(world, i),
  );
  if (water >= 0) return cellTask(world, m, "dam", water);
  const lair = lairOf(world, c, m, false);
  setTask(m, "carry", lair % world.w, Math.floor(lair / world.w));
}

function nextToLand(world: World, i: number): boolean {
  for (const d of [1, -1, world.w, -world.w]) {
    const j = i + d;
    if (j >= 0 && j < world.n && world.depth[j] < 0.05) return true;
  }
  return false;
}

function tend(world: World, c: Creature, k: CreatureKind, m: Mind): void {
  // The wounded among its own first, if it can heal.
  if (k.ai?.aura === "heal" || k.abilities?.some((a) => a.do === "heal")) {
    for (const o of world.crowd.near(world, c.x, c.y, 14)) {
      if (o === c || o.hp >= life.maxHp(o) * 0.7 || life.kindOf(o).ai?.converts) continue;
      setTask(m, "heal", o.x, o.y, 1, -1, o);
      return;
    }
  }
  const i = findCell(
    world,
    c.homeX,
    c.homeY,
    12,
    16,
    (j) =>
      world.depth[j] < 0.05 &&
      world.fire[j] < 0.1 &&
      (world.cover[j] === C.STUMP ||
        (world.cover[j] === C.NONE && (world.ground[j] === G.DIRT || world.ground[j] === G.ASH || world.ground[j] === G.GRASS || world.ground[j] === G.FIELD))),
  );
  if (i >= 0 && Math.random() < 0.6) {
    cellTask(world, m, "seed", i, 0.8);
    m.action = "tending the land";
    return;
  }
  wander(world, c, k, m);
}

function steal(world: World, c: Creature, k: CreatureKind, m: Mind): void {
  if (m.carry) {
    const camp = lairOf(world, c, m, true);
    setTask(m, "carry", camp % world.w, Math.floor(camp / world.w), 1.2);
    m.action = "running to its camp with the loot";
    return;
  }
  // Crops at a village's edge, or the village's own stores.
  const v = villageOf(world, c.x, c.y) ?? world.villages[c.id % Math.max(1, world.villages.length) | 0];
  if (!v) return void wander(world, c, k, m);
  const crop = findCell(world, v.x, v.y, 16, 16, (i) => world.cover[i] === C.CROP, 8);
  if (crop >= 0 && Math.random() < 0.5) {
    cellTask(world, m, "forage", crop, 1.1);
    m.action = "stealing crops";
    return;
  }
  setTask(m, "raid", v.x + (Math.random() - 0.5) * 6, v.y + (Math.random() - 0.5) * 6, 1.2);
  m.action = "sneaking into a village";
}

// A spell kind that leaves something behind spreads it; the undead dig
// graves; birds and the rest sow seeds.
function spread(world: World, c: Creature, k: CreatureKind, m: Mind): void {
  // Birds sow now and then, a flock when its leader does (it lands with it,
  // and flies on with it otherwise); a spell's spreader is busier.
  const lead = c.data.flockLead as number | undefined;
  const landing = lead !== undefined && world.crowd.near(world, c.x, c.y, 16).some((o) => o.id === lead && o.mind?.task === "seed");
  if (lead !== undefined ? !landing : Math.random() < (k.native ? 0.85 : 0.5)) return void wander(world, c, k, m);
  const undead = /skeleton|ghoul|mummy|wraith|banshee|reaper|undead|necromancer|lich|zombie|revenant/.test(c.kind);
  if (undead) {
    const yard = world.marks.find((k2) => k2.kind === "graveyard" && Math.hypot(k2.x - c.x, k2.y - c.y) < 30);
    const recent = world.deaths.length ? world.deaths[world.deaths.length - 1] : null;
    const x = yard?.x ?? recent?.x ?? c.homeX;
    const y = yard?.y ?? recent?.y ?? c.homeY;
    const i = findCell(world, x, y, 4, 10, (j) => dryFree(world, j));
    if (i >= 0) {
      cellTask(world, m, "bury", i);
      m.action = "digging graves";
      return;
    }
  }
  if (k.ai?.leaves) {
    const i = findCell(world, c.x, c.y, 10, 8, (j) => world.depth[j] < 0.3);
    if (i >= 0) return cellTask(world, m, "spread", i);
  }
  // Seeds on bare grass near trees, where little grows yet.
  const i = findCell(world, c.x, c.y, 14, 14, (j) => world.ground[j] === G.GRASS && dryFree(world, j) && crowded(world, j) < 2);
  if (i >= 0) {
    cellTask(world, m, "seed", i, 1);
    return;
  }
  wander(world, c, k, m);
}

function crowded(world: World, i: number): number {
  let n = 0;
  for (const d of [1, -1, world.w, -world.w, world.w + 1, world.w - 1, -world.w + 1, -world.w - 1]) {
    const j = i + d;
    if (j >= 0 && j < world.n && world.cover[j] !== C.NONE) n++;
  }
  return n;
}

function convert(world: World, c: Creature, k: CreatureKind, m: Mind, needs: boolean): void {
  // Hunters that turn their victims do it by hunting, when hungry.
  if (k.ai?.converts && k.ai.mode === "hunt") {
    if (needs && m.hunger > 0.4 && huntPrey(world, c, k, m, k.ai.prey.length ? k.ai.prey : ["villager"])) return;
    if (!needs) return void wander(world, c, k, m);
    return void wander(world, c, k, m);
  }
  // The rest win people over by talking to them.
  let best: Creature | null = null;
  let bestD = 16;
  for (const o of world.crowd.near(world, c.x, c.y, 16)) {
    if (o.kind !== "villager" || (o.mind && feeling(o, c.kind) >= 2)) continue;
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  if (best) setTask(m, "preach", best.x, best.y, 1, -1, best);
  else wander(world, c, k, m);
}

function worship(world: World, c: Creature, m: Mind): void {
  // A shrine that does not scare it, then what it reveres, then the village square.
  let at: { x: number; y: number } | null = null;
  let bestD = 40;
  for (const l of world.landmarks) {
    if (names(l.scares, c.kind)) continue;
    const d = Math.hypot(l.x - c.x, l.y - c.y);
    if (d < bestD) {
      bestD = d;
      at = { x: l.x + 0.5, y: l.y + 0.5 };
    }
  }
  if (!at && m.memory.some((e) => e.feel >= 2)) {
    const revered = m.memory.reduce((a, b) => (b.feel > a.feel ? b : a));
    for (const o of world.crowd.near(world, c.x, c.y, 24)) {
      if (base(o.kind) === revered.kind) {
        at = { x: o.x, y: o.y };
        m.action = `praying to the ${revered.kind}`;
        break;
      }
    }
  }
  if (!at) {
    const v = villageOf(world, c.homeX, c.homeY);
    at = v ? { x: v.x, y: v.y } : { x: c.homeX, y: c.homeY };
  }
  const why = m.action.startsWith("praying to") ? m.action : null;
  setTask(m, "pray", at.x + (Math.random() - 0.5) * 3, at.y + (Math.random() - 0.5) * 3, 0.9);
  if (why) m.action = why;
}

// Fish and birds of passage go back and forth between two places of their
// habitat; fish spawn at the end of the journey while the water holds few.
function migrate(world: World, c: Creature, k: CreatureKind, m: Mind): void {
  if (herd(world, c, k, m) && Math.random() < 0.5) return;
  if (m.away < 0 || Math.random() < 0.02) {
    const i = findCell(world, c.homeX, c.homeY, 34, 30, (j) => (k.aquatic ? world.fluid[j] === F.WATER && world.depth[j] > 0.9 : world.depth[j] < 0.05), 14);
    m.away = i >= 0 ? i : world.idx(c.homeX, c.homeY);
  }
  // Every other trip ends where it started.
  const there = m.away;
  m.away = world.idx(c.homeX, c.homeY);
  c.homeX = there % world.w;
  c.homeY = Math.floor(there / world.w);
  cellTask(world, m, "spawn", there, 0.9);
  m.action = k.aquatic ? "swimming to its spawning ground" : "on its way";
}

// ---- A spell's own goals (3.6) --------------------------------------------------

// Finds what a spell's goal seeks near home and sets off to it; false when
// there is nothing of it around.
function customTask(world: World, c: Creature, m: Mind, g: CustomGoal): boolean {
  const hx = c.homeX;
  const hy = c.homeY;
  const r = g.near;
  let x = NaN;
  let y = NaN;
  let cell = -1;
  let target: Creature | null = null;
  switch (g.seek) {
    case "home":
      x = hx;
      y = hy;
      break;
    case "village": {
      const v = villageOf(world, hx, hy) ?? villageOf(world, c.x, c.y);
      if (v) {
        x = v.x + (Math.random() - 0.5) * 4;
        y = v.y + (Math.random() - 0.5) * 4;
      }
      break;
    }
    case "landmark": {
      let best = r * 2;
      for (const l of world.landmarks) {
        const d = Math.hypot(l.x - hx, l.y - hy);
        if (d < best) {
          best = d;
          x = l.x + 0.5 + (Math.random() - 0.5) * 2;
          y = l.y + 0.5 + (Math.random() - 0.5) * 2;
        }
      }
      break;
    }
    case "anywhere": {
      const i = findCell(world, hx, hy, r, 8, (j) => world.depth[j] < 0.3);
      if (i >= 0) cell = i;
      break;
    }
    default: {
      const found = world.materials.find(g.seek);
      if (found && found.layer !== "gas") {
        const layer = found.layer === "ground" ? world.ground : found.layer === "cover" ? world.cover : world.fluid;
        const i = findCell(world, hx, hy, r, 24, (j) => layer[j] === found.id && world.fire[j] < 0.1);
        if (i >= 0) cell = i;
      } else {
        // A kind of creature.
        let best = r;
        for (const o of world.crowd.near(world, hx, hy, r)) {
          if (o === c || !names([g.seek], o.kind)) continue;
          const d = Math.hypot(o.x - c.x, o.y - c.y);
          if (d < best) {
            best = d;
            target = o;
          }
        }
      }
    }
  }
  if (cell >= 0) {
    x = cell % world.w;
    y = Math.floor(cell / world.w);
  }
  if (target) {
    x = target.x;
    y = target.y;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  setTask(m, "custom", x, y, 1, cell, target);
  m.custom = g.name;
  m.action = g.name;
  return true;
}

// ---- Finishing a task: the change it makes ---------------------------------

function finish(world: World, c: Creature, k: CreatureKind, m: Mind): void {
  const i = m.cell;
  const t = m.target;
  const v = c.kind === "villager" ? villageOf(world, c.homeX, c.homeY) : null;
  const task = m.task;
  if (meter) meter.done(c, task);
  drop(m);
  switch (task) {
    case "use": {
      const visit = c.data.visit as Visit | undefined;
      c.data.visit = undefined;
      if (visit) useArtifact(world, c, visit);
      if (m.carry && c.kind !== "villager" && m.lair >= 0) setTask(m, "carry", m.lair % world.w, Math.floor(m.lair / world.w));
      return;
    }
    case "custom": {
      const g = CUSTOM_GOALS.get(m.custom);
      if (!g) return;
      // Its own code makes the change; a goal with no code just carries what it found.
      if (g.run && !g.run(c, m.tx, m.ty, t && !t.dead ? t : null)) return;
      deed(c, g.name);
      if (g.carry) {
        m.carry = g.carry;
        if (c.kind === "villager") setTask(m, "carry", c.homeX, c.homeY);
      }
      return;
    }
    case "eat":
      if (v && v.food >= 1) {
        v.food -= 1;
        m.hunger = Math.max(0, m.hunger - 0.65);
      }
      return;
    case "graze": {
      const cover = i >= 0 ? world.cover[i] : C.NONE;
      m.hunger = Math.max(0, m.hunger - (cover === C.NONE ? 0.3 : 0.55));
      if (i < 0) return;
      if (cover === C.CROP || cover === C.FLOWER || (cover === C.BUSH && Math.random() < 0.5)) {
        world.setCover(i, C.NONE);
        deed(c, `ate ${cover === C.CROP ? "crops" : cover === C.FLOWER ? "flowers" : "a bush"}`);
        if (cover === C.CROP) for (const o of world.crowd.near(world, c.x, c.y, 10)) if (o.kind === "villager") remember(o, c.kind, -0.4);
      } else if (world.ground[i] === G.GRASS && (c.kind === "boar" || (c.data.grazes = ((c.data.grazes as number | undefined) ?? 0) + 1) % 2 === 1)) {
        // Grazed bare (a boar roots it up) one graze in two, every other one
        // rather than on a coin flip, so no grazer goes five minutes without
        // a mark by bad luck (3.7); grass creeps back from around it.
        world.ground[i] = G.DIRT;
        deed(c, c.kind === "boar" ? "rooted up the grass" : "grazed the grass bare");
      }
      return;
    }
    case "feast":
      m.hunger = Math.max(0, m.hunger - 0.8);
      if (t) {
        t.deadFor = Math.max(t.deadFor, 30);
        t.data.eaten = true;
      }
      deed(c, `ate a ${t ? base(t.kind) : "kill"}`);
      // A pack shares its kill.
      if (t)
        for (const o of world.crowd.near(world, t.x, t.y, 10)) {
          if (o === c || o.kind !== c.kind || !o.mind) continue;
          o.mind.hunger = Math.max(0, o.mind.hunger - 0.5);
          deed(o, `shared the pack's ${base(t.kind)}`);
        }
      return;
    case "forage": {
      const was = world.cover[i];
      if (was !== C.BUSH && was !== C.FLOWER && was !== C.CROP) return;
      if (was !== C.BUSH || Math.random() < 0.4) world.setCover(i, C.NONE);
      if (c.kind === "villager") {
        m.carry = "food";
        setTask(m, "carry", c.homeX, c.homeY);
        deed(c, was === C.FLOWER ? "picked flowers" : "picked berries");
      } else if (hasNeeds(c, k)) {
        m.hunger = Math.max(0, m.hunger - 0.5);
        deed(c, "ate what it found");
      } else {
        m.carry = m.goal === "steal" ? "loot" : "food";
        deed(c, was === C.CROP ? "stole crops" : "gathered food");
      }
      return;
    }
    case "harvest":
      if (world.cover[i] !== C.CROP) return;
      world.setCover(i, C.NONE);
      m.carry = "food";
      setTask(m, "carry", c.homeX, c.homeY);
      deed(c, "harvested crops");
      return;
    case "plant":
      if (world.ground[i] !== G.FIELD) world.ground[i] = G.FIELD;
      else world.setCover(i, C.CROP);
      deed(c, "sowed a field");
      return;
    case "fell":
      if (world.cover[i] !== C.TREE && world.cover[i] !== C.BUSH) return;
      world.setCover(i, world.cover[i] === C.TREE ? C.STUMP : C.NONE);
      m.carry = "wood";
      deed(c, "felled a tree");
      // Routine work is silent until sounds have a place and a distance
      // (4.5): every tree used to play a thump at full volume, one every 2 s.
      if (c.kind === "villager") setTask(m, "carry", c.homeX, c.homeY);
      return;
    case "fish": {
      // A fish nearby is caught; otherwise a small one, half the time.
      let caught = false;
      for (const o of world.crowd.near(world, m.tx, m.ty, 6)) {
        if (o.kind === "fish") {
          o.dead = true;
          caught = true;
          break;
        }
      }
      if (caught || Math.random() < (world.settlements.length && hasJob(world, c.homeX, c.homeY, C.FISHERHUT) ? 0.7 : 0.4)) {
        m.carry = "fish";
        setTask(m, "carry", c.homeX, c.homeY);
        deed(c, "caught a fish");
      }
      return;
    }
    case "carry":
      unload(world, c, m, v);
      return;
    case "trade": {
      const there = villageOf(world, c.x, c.y);
      const trip = c.data.trip as { from: Village; to: Village | Wonder } | undefined;
      c.data.trip = undefined;
      c.data.via = undefined;
      const food = m.carry === "food";
      m.carry = null;
      if (food) {
        if (there) there.food += 2;
        deed(c, "brought food to a poorer village");
      } else deed(c, trip && "seed" in trip.to ? "went to see a wonder" : "went to market");
      return;
    }
    case "pave": {
      const job = c.data.pave as PaveJob | undefined;
      c.data.pave = undefined;
      if (job && pave(world, job, v)) deed(c, job.bridge ? "built a bridge" : "laid a road");
      return;
    }
    case "forge": {
      if (world.cover[i] !== C.SMITHY) return;
      // Sparks off the anvil, and tools the village sells for gold.
      for (let n = 0; n < 8; n++)
        world.particles.add({
          x: c.x,
          y: c.y,
          z: 1,
          vx: (Math.random() - 0.5) * 4,
          vy: (Math.random() - 0.5) * 4,
          vz: 3 + Math.random() * 3,
          life: 0.6,
          color: 0xffb040,
          size: 1,
          glow: true,
          gravity: 12,
        });
      if (v) v.gold += 1;
      deed(c, "forged tools at the smithy");
      return;
    }
    case "repair":
      if (world.cover[i] !== C.RUBBLE) return;
      world.setCover(i, C.HOUSE);
      // 4.4.5 part B: a rebuilt roof shows its patch.
      if (world.settlements.length) world.patched.add(i);
      deed(c, "rebuilt a house");
      return;
    case "build": {
      if (!v || v.wood < 5) return;
      const cells = [i, i + 1, i + world.w, i + world.w + 1];
      if (cells.some((j) => !dryFree(world, j))) return;
      v.wood -= 5;
      v.houses++;
      for (const j of cells) {
        world.ground[j] = G.DIRT;
        world.setCover(j, C.HOUSE);
      }
      // Silent, like felling (4.1).
      deed(c, "built a house");
      return;
    }
    case "dam":
      if (m.carry !== "wood" || world.fluid[i] !== F.WATER) return;
      // An earth bank to the water's surface, with a log on it.
      world.height[i] = world.level(i) + 0.3;
      world.setFluid(i, F.NONE, 0);
      world.ground[i] = G.DIRT;
      world.setVoxel(i % world.w, Math.floor(i / world.w), Math.round(world.height[i] * 0.5), 0x7a5230, VK.WOOD);
      markAt(world, "dam", i % world.w, Math.floor(i / world.w), c.kind, 6);
      m.carry = null;
      deed(c, "added to its dam");
      return;
    case "take": {
      const p = world.lures.find((q) => q.taken && Math.abs(q.x - m.tx) < 0.6 && Math.abs(q.y - m.ty) < 0.6);
      if (!p) return;
      const j = Math.round(p.y) * world.w + Math.round(p.x);
      // The cell is cleared of whatever made it a lure, like a villager taking it (social.ts).
      const lure = (layer: "ground" | "cover" | "fluid", id: number) => world.lureMaterials.has(world.materials.get(layer, id).name);
      if (lure("cover", world.cover[j])) world.setCover(j, C.NONE);
      else if (lure("ground", world.ground[j])) world.ground[j] = G.DIRT;
      else if (lure("fluid", world.fluid[j])) world.setFluid(j, F.NONE, 0);
      else return;
      world.lures = world.lures.filter((q) => q !== p);
      m.carry = "gold";
      deed(c, "took gold");
      return;
    }
    case "raid": {
      const there = villageOf(world, c.x, c.y);
      if (!there) return;
      const what: Load = there.gold > 0 && (m.goal === "hoard" || Math.random() < 0.5) ? "gold" : "food";
      if (what === "gold" && there.gold > 0) there.gold--;
      else if (there.food >= 1) there.food -= 1;
      else return;
      m.carry = m.goal === "hoard" ? "gold" : "loot";
      for (const o of world.crowd.near(world, c.x, c.y, 12)) if (o.kind === "villager") remember(o, c.kind, -1);
      deed(c, `stole ${what} from a village`);
      return;
    }
    case "pray":
      prayed(world, c, m);
      return;
    case "bury": {
      if (t && t.dead && !t.data.buried) {
        t.data.buried = true;
        t.deadFor = Math.max(t.deadFor, 38);
      }
      // A grave by the village, or by the undead's own yard.
      const vx = v ? v.x + 9 : c.x;
      const vy = v ? v.y + 9 : c.y;
      const at = i >= 0 ? i : findCell(world, vx, vy, 4, 12, (j) => dryFree(world, j));
      if (at < 0) return;
      const x = at % world.w;
      const y = Math.floor(at / world.w);
      world.ground[at] = G.DIRT;
      world.setVoxel(x, y, Math.round(world.height[at] * 0.5), 0x8a8a92, VK.STONE);
      markAt(world, "graveyard", x, y, c.kind, 6);
      deed(c, t ? "buried a villager" : "dug a grave");
      return;
    }
    case "spread": {
      const leaves = k.ai?.leaves;
      if (!leaves) return;
      if (leaves === "fire") world.fire[i] = Math.max(world.fire[i], 0.6);
      else if (leaves === "flowers" || leaves === "life") world.setCover(i, C.FLOWER);
      else if (!world.place(i, leaves, 0.4)) return;
      deed(c, `spread ${leaves}`);
      return;
    }
    case "seed": {
      if (world.cover[i] === C.STUMP) world.setCover(i, C.TREE);
      else if (world.ground[i] === G.DIRT || world.ground[i] === G.ASH) world.ground[i] = G.GRASS;
      else if (world.ground[i] === G.FIELD) world.setCover(i, C.CROP);
      else if (world.cover[i] === C.NONE && world.depth[i] < 0.05) {
        const r = Math.random();
        world.setCover(i, c.kind === "villager" ? C.FLOWER : r < 0.5 ? C.FLOWER : r < 0.85 ? C.BUSH : C.TREE);
      } else return;
      deed(c, c.kind === "villager" ? "planted flowers" : m.goal === "tend" ? "made something grow" : "dropped a seed");
      return;
    }
    case "spawn": {
      // Every fish spawns once in its life, which replaces it when it dies of
      // age; again where few of its kind live, while the island has room.
      let close = 0;
      for (const o of world.crowd.near(world, c.x, c.y, 12)) if (o.kind === c.kind && o !== c) close++;
      const first = !c.data.spawned;
      const room = countOf(world, c.kind) < targetFor(world, c.kind) * (first ? 2 : 1.5);
      if (k.native && (first || close < 3) && room && world.creatures.length < 500) {
        c.data.spawned = true;
        const young = life.make(c.kind, c.x + (Math.random() - 0.5), c.y + (Math.random() - 0.5));
        young.homeX = young.x;
        young.homeY = young.y;
        world.creatures.push(young);
        census.get(world)?.set(c.kind, countOf(world, c.kind) + 1);
        deed(c, k.aquatic ? "spawned" : "raised young");
      } else if (!k.native) {
        // A spell's migrant builds a nest where it arrives.
        const mark = markAt(world, "nest", c.x, c.y, c.kind, 3);
        if (mark.size <= 9) pile(world, c.x, c.y, mark.size - 1, 0x7a5a3a, VK.WOOD);
        deed(c, "made a nest");
      }
      return;
    }
    case "roam":
      if (m.goal === "explore" && Math.random() < 0.4) {
        const mark = markAt(world, "cairn", c.x, c.y, c.kind, 8);
        if (mark.size <= 3 && world.depth[world.idx(c.x, c.y)] < 0.05) {
          pile(world, c.x, c.y, mark.size - 1, 0x8d8d96, VK.STONE);
          deed(c, "left a cairn");
        }
      }
      return;
    case "feed": {
      if (!t || t.dead || !t.mind || !v || v.food < 1) return;
      v.food -= 1;
      t.mind.hunger = Math.max(0, t.mind.hunger - 0.5);
      t.mind.fed++;
      remember(t, "villager", 1);
      deed(c, `fed a ${base(t.kind)}`);
      if (t.mind.fed >= 3) {
        t.mind.tame = world.villages.indexOf(v) + 1;
        t.homeX = v.x;
        t.homeY = v.y;
        t.mind.task = "none";
        deed(t, "was tamed");
        deed(c, `tamed a ${base(t.kind)}`);
      }
      return;
    }
    case "preach":
      if (!t || t.dead || t.kind !== "villager") return;
      remember(t, c.kind, 3);
      if (t.mind) {
        t.mind.goal = "worship";
        t.mind.task = "none";
      }
      deed(c, "won over a villager");
      return;
    case "heal":
      if (!t || t.dead) return;
      t.hp = Math.min(life.maxHp(t), t.hp + 40);
      t.burning = 0;
      remember(t, c.kind, 1);
      deed(c, `healed a ${base(t.kind)}`);
      return;
  }
}

function targetFor(world: World, kind: string): number {
  // Wild numbers per 10,000 cells, as in wildlife.ts; a little room above.
  const density: Record<string, number> = { fish: 3.5, deer: 2.6, rabbit: 3, boar: 1.3, wolf: 1.3, bear: 0.45, bird: 3 };
  return Math.max(1, Math.round((world.n / 10000) * (density[kind] ?? 1)));
}

// What it brought home goes into the village's stores, or onto its pile.
function unload(world: World, c: Creature, m: Mind, v: Village | null): void {
  const load = m.carry;
  m.carry = null;
  if (!load) return;
  if (c.kind === "villager") {
    if (!v) return;
    if (load === "wood") v.wood += 1;
    else if (load === "gold") v.gold += 1;
    // 4.4.5 part B: a bakery makes a harvest go further, a fisher hut a catch.
    else if (load === "fish") v.food += world.settlements.length && hasJob(world, c.homeX, c.homeY, C.FISHERHUT) ? 2.5 : 1.5;
    else v.food += load === "food" && world.settlements.length && hasJob(world, c.homeX, c.homeY, C.BAKERY) ? 1.5 : 1;
    deed(c, `brought ${load} home`);
    return;
  }
  const lair = m.lair >= 0 ? m.lair : world.idx(c.x, c.y);
  const x = lair % world.w;
  const y = Math.floor(lair / world.w);
  const kind = m.goal === "hoard" ? "hoard" : m.goal === "steal" ? "camp" : "den";
  const mark = markAt(world, kind, x, y, c.kind, 3);
  if (kind === "camp" && mark.size === 1) {
    // A camp starts with a tent.
    for (let n = 0; n < 3; n++) pile(world, x + 2, y + 2, n, 0x8a6a4a, VK.WOOD);
  }
  if (mark.size <= 40) pile(world, x, y, mark.size - 1, LOAD_COLORS[load], load === "wood" ? VK.WOOD : VK.STONE);
  deed(c, kind === "hoard" ? "added to its hoard" : kind === "camp" ? "brought loot to its camp" : "built up its den");
}

function prayed(world: World, c: Creature, m: Mind): void {
  const mark = markAt(world, "offerings", m.tx, m.ty, c.kind, 4);
  if (mark.size % 3) return;
  // Flowers laid around the place, and at a shrine a few candles that glow at night.
  const shrine = world.landmarks.some((l) => Math.abs(l.x - mark.x) < 4 && Math.abs(l.y - mark.y) < 4);
  const n = mark.size / 3;
  if (shrine && n <= 4) pile(world, mark.x + 1, mark.y + 1, n - 1, 0xffd27a, VK.GLOW);
  else {
    const i = findCell(
      world,
      mark.x,
      mark.y,
      4,
      8,
      (j) => (world.ground[j] === G.GRASS || world.ground[j] === G.DIRT) && dryFree(world, j) && crowded(world, j) < 3,
    );
    if (i < 0) return;
    world.setCover(i, C.FLOWER);
  }
  deed(c, "left an offering");
}
