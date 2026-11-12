import { siteLine } from "./sites";
import { abilitiesOf } from "./abilities";
import { jobOf, TASK_WORDS } from "./goals";
import { villageOf } from "./kin";
import { roadsOf } from "./roads";
import { unpackLook } from "./villagers";
import { isArtifact, type Artifact } from "./artifacts";
import { holding } from "./held";
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
    // 4.6 part B: a person made by a merge carries its item's name, and its
    // calling or job beneath it ("Necromancer, the village's necromancer").
    if (m?.title) {
      const what = look.calling && look.calling !== "none" ? look.calling : job === "none" ? "villager" : job;
      subtitle = what.toLowerCase() === m.title.toLowerCase() ? "a villager" : `a ${what} of the village`;
      title = m.title;
    }
  }
  if (m?.tame) subtitle = `tamed by a village`;
  const rows: [string, string][] = [];
  const goal = m?.goal ?? k.goal ?? "explore";
  // A job a spell hired it for, by its own name; then its usual job.
  const calling = c.kind === "villager" ? unpackLook(c.look).calling : undefined;
  const job =
    c.kind === "villager" && calling && CALLING_WORDS[calling]
      ? CALLING_WORDS[calling]
      : c.kind === "villager" && goal !== "worship"
        ? (m?.job ?? JOB_WORDS[jobOf(c)])
        : undefined;
  const age = c.kind === "villager" ? unpackLook(c.look).age : "adult";
  rows.push(["Wants to", age === "child" ? "play and pick berries" : age === "elder" && goal === "tend" ? "plant flowers" : (job ?? GOAL_WORDS[goal] ?? goal)]);
  rows.push(["Doing", c.dead ? "nothing any more" : (moodWords(c) ?? m?.action ?? TASK_WORDS.none)]);
  if (m?.did) rows.push(["Last did", m.did]);
  // 4.7: an object in hand (held.ts), with its charges when it has some.
  const held = holding(world, c);
  if (held)
    rows.push(["Holds", `the ${held.name}${held.art.charges !== null ? ` (${held.art.charges} ${held.art.charges === 1 ? "charge" : "charges"})` : ""}`]);
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
    // Who shares its home (4.6 part B): the household it lives with.
    const home = world.creatures.filter((o) => o !== c && !o.dead && o.kind === "villager" && Math.hypot(o.homeX - c.homeX, o.homeY - c.homeY) < 1.3);
    if (home.length)
      rows.push([
        "Lives with",
        home
          .slice(0, 3)
          .map((o) => {
            const l = unpackLook(o.look);
            const j = jobOf(o);
            return `a ${l.age === "child" ? "child" : l.age === "elder" ? "elder" : j === "none" ? "villager" : j}`;
          })
          .join(", ") + (home.length > 3 ? ` and ${home.length - 3} more` : ""),
      ]);
    const v = villageOf(world, c.homeX, c.homeY);
    if (v) rows.push(["Village stores", `food ${Math.floor(v.food)}, wood ${Math.floor(v.wood)}, gold ${Math.floor(v.gold)}`]);
    // 4.9: where its village's roads go, and what they wait for.
    const roads = v ? roadsOf(world, v) : [];
    if (roads.length) rows.push(["Roads", roads.slice(0, 3).join("; ")]);
    // 4.9 part 2: what its village is raising, and how far along.
    const going = v ? siteLine(world, v) : null;
    if (going) rows.push(["Building", going]);
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

const CALLING_WORDS: Record<string, string> = {
  necromancer: "keep the graves and raise the dead at night",
  blacksmith: "work the forge",
  knight: "guard the village",
  mage: "study magic and drive off enemies",
};

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

// The artifact nearest a tapped point (3.7), within reach.
export function artifactAt(world: World, x: number, y: number, reach = 2): Artifact | null {
  let best: Artifact | null = null;
  let bestD = reach;
  for (const l of world.landmarks) {
    if (!isArtifact(l)) continue;
    const d = Math.hypot(l.x - x, l.y - y);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best;
}

const WHEN_WORDS: Record<string, string> = {
  dawn: "each morning",
  dusk: "each evening",
  night: "by night",
  day: "by day",
  every: "every so often",
  drought: "in a drought",
  fire: "when fire comes near",
  enemy: "when an enemy comes near",
  death: "when someone dies nearby",
  hurt: "when it is struck",
};
const GRANT_WORDS: Record<string, string> = {
  water: "villagers draw water",
  arms: "villagers arm themselves",
  prayer: "villagers pray",
  food: "villagers take food",
  heal: "the wounded are healed",
  gold: "villagers take gold",
};

// What a tap on an artifact shows (3.7): what it does and when, what it
// grants and to whom, its charges, fuel and health, what it did last.
export function inspectArtifact(world: World, a: Artifact): Inspection {
  const s = a.art;
  const rows: [string, string][] = [];
  const does = s.effects.map(
    (e) => `${e.do === "cast" ? `casts ${e.arg}` : e.do === "summon" ? `calls a ${e.arg}` : e.do === "code" ? "acts" : e.do} ${WHEN_WORDS[e.when] ?? e.when}`,
  );
  for (const p of s.pairs) does.push(`${p.do === "code" ? "acts" : p.do} near ${p.with}${p.once ? ", once" : ""}`);
  if (does.length) rows.push(["Does", does.join("; ")]);
  if (s.grants.length) rows.push(["Gives", s.grants.map((g) => GRANT_WORDS[g.what] ?? g.what).join("; ")]);
  if (s.uses.length) rows.push(["Draws", s.uses.map((u) => `${u.by.join(", ")} who ${u.do === "worship" ? "worship" : u.do} it`).join("; ")]);
  if (s.charges !== null) rows.push(["Charges", `${s.charges} of ${s.maxCharges}`]);
  if (s.did.length) rows.push(["Last did", s.did.join("; ")]);
  rows.push(["Things done", String(s.deeds)]);
  const bars: Inspection["bars"] = [];
  if (s.health !== null) bars.push({ label: "Health", value: s.maxHealth ? s.health / s.maxHealth : 0 });
  if (s.fuel !== null) bars.push({ label: "Fuel", value: s.maxFuel ? s.fuel / s.maxFuel : 0 });
  if (s.charges !== null && s.maxCharges) bars.push({ label: "Charges", value: s.charges / s.maxCharges });
  void world;
  return { id: -s.id, title: cap(a.name), subtitle: "an artifact", bars, rows, dead: s.health === 0 };
}
