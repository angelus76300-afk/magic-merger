import { abilitiesOf } from "./abilities";
import { jobOf, TASK_WORDS } from "./goals";
import { villageOf } from "./kin";
import { unpackLook } from "./villagers";
import type { Creature, CreatureKind } from "./creatures";
import type { World } from "./world";

// What a tap on a creature shows (3.6): who it is, what it wants, what it is
// doing, its needs, what it carries and remembers, its abilities. Plain data,
// so npm test can read it and the World frame only has to draw it.

export interface Inspection {
  id: number;
  title: string;
  subtitle: string;
  // 0 to 1, higher is better (full health, fed, rested).
  bars: { label: string; value: number }[];
  rows: [string, string][];
  dead: boolean;
}

// The creature nearest a tapped point, within reach.
export function creatureAt(world: World, x: number, y: number, reach = 2.5): Creature | null {
  let best: Creature | null = null;
  let bestD = reach;
  for (const c of world.creatures) {
    if (c.dead) continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function inspect(world: World, c: Creature, kindOf: (c: Creature) => CreatureKind, maxHp: (c: Creature) => number): Inspection {
  const k = kindOf(c);
  const m = c.mind;
  const name = c.kind.split("#")[0];
  let title = cap(name);
  let subtitle = k.native ? "one of the island's animals" : c.kind === "villager" ? "" : "brought by a spell";
  if (c.kind === "villager") {
    const look = unpackLook(c.look);
    const job = jobOf(c);
    title = look.age === "child" ? "Child" : job === "none" ? (look.age === "elder" ? "Elder" : "Villager") : cap(job);
    subtitle = look.age === "elder" ? "an elder of the village" : look.age === "child" ? "a child of the village" : "a villager";
  }
  if (m?.tame) subtitle = `tamed by a village`;
  const rows: [string, string][] = [];
  const goal = m?.goal ?? k.goal ?? "explore";
  const job = c.kind === "villager" && goal !== "worship" ? JOB_WORDS[jobOf(c)] : undefined;
  const age = c.kind === "villager" ? unpackLook(c.look).age : "adult";
  rows.push(["Wants to", age === "child" ? "play and pick berries" : age === "elder" && goal === "tend" ? "plant flowers" : (job ?? GOAL_WORDS[goal] ?? goal)]);
  rows.push(["Doing", c.dead ? "nothing any more" : (moodWords(c) ?? m?.action ?? TASK_WORDS.none)]);
  if (m?.did) rows.push(["Last did", m.did]);
  if (m?.carry) rows.push(["Carrying", m.carry]);
  else if (c.data.carry !== undefined) rows.push(["Carrying", "treasure"]);
  if (m?.memory.length) {
    const words = m.memory
      .filter((e) => Math.abs(e.feel) >= 0.5)
      .sort((a, b) => Math.abs(b.feel) - Math.abs(a.feel))
      .map((e) => `${e.kind === "magic" ? "magic" : `the ${e.kind}`} ${e.feel < 0 ? "hurt" : "helped"} ${c.kind === "villager" ? "them" : "it"}`);
    if (words.length) rows.push(["Remembers", words.join("; ")]);
  }
  const abilities = abilitiesOf(c, k);
  if (abilities.length && m) {
    rows.push([
      "Magic",
      abilities
        .map((a, n) => {
          const wait = (m.ready[n] ?? 0) - world.time;
          return `${a.do} (${a.when}${wait > 0.5 ? `, ready in ${Math.ceil(wait)} s` : ""})`;
        })
        .join("; "),
    ]);
  }
  if (c.kind === "villager") {
    const v = villageOf(world, c.homeX, c.homeY);
    if (v) rows.push(["Village stores", `food ${Math.floor(v.food)}, wood ${Math.floor(v.wood)}, gold ${Math.floor(v.gold)}`]);
  }
  if (m && m.lair >= 0 && c.kind !== "villager") {
    const mark = world.marks.find((mk) => Math.abs(mk.x - (m.lair % world.w)) <= 3 && Math.abs(mk.y - Math.floor(m.lair / world.w)) <= 3);
    if (mark) rows.push(["Its place", `a ${mark.kind} of ${mark.size}`]);
  }
  if (m?.deeds) rows.push(["Things done", String(m.deeds)]);
  const bars = [{ label: "Health", value: Math.max(0, Math.min(1, c.hp / maxHp(c))) }];
  if (m && (c.kind === "villager" || k.native || k.needs) && !k.flying && !k.aquatic) bars.push({ label: "Fed", value: 1 - m.hunger });
  if (m && c.kind === "villager") bars.push({ label: "Rested", value: 1 - m.tired });
  return { id: c.id, title, subtitle, bars, rows, dead: c.dead };
}

function moodWords(c: Creature): string | null {
  if (c.burning > 0) return "on fire!";
  if (c.frozen > 0) return "frozen";
  if (c.sleep > 0) return "asleep under a spell";
  if (c.fear > 0) return "terrified";
  return null;
}

const JOB_WORDS: Record<string, string> = {
  none: "gather berries",
  farmer: "sow and harvest the fields",
  woodcutter: "fell trees for the builders",
  fisher: "catch fish",
  smith: "build houses",
  builder: "build houses",
  guard: "guard the village",
  priest: "pray and bury the dead",
  merchant: "carry food between villages",
};

const GOAL_WORDS: Record<string, string> = {
  hunt: "hunt",
  gather: "gather food",
  hoard: "hoard treasure",
  build: "build",
  tend: "tend the land",
  guard: "guard its home",
  steal: "steal",
  spread: "spread",
  convert: "make others its own",
  worship: "worship",
  explore: "explore",
  migrate: "travel and breed",
};
