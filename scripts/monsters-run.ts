// Monsters that live through their first day: how long a creature placed
// by a village stays alive by day, and how many villagers it kills.
//
// The island is the test run's (src/sim/check.ts): seed 11, rivers settled,
// the item placed six cells from the first house, in the morning. Each of
// the ten programs below is placed there and followed for five minutes;
// the life of each of its creatures is counted over the day (the first
// three minutes, before dusk), and the villagers dead at the end are
// compared with the same island left alone.
//
//   npx esbuild scripts/monsters-run.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/monsters-run.mjs && node node_modules/.cache/monsters-run.mjs
//
// npm test runs the same measure (scripts/sim-test.ts) and holds the median.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REFERENCE_SIDE } from "../shared/tiers";
import { FORM_EXAMPLES } from "../worker/prompts";
import { kindOf, populate, resetCreatureIds, type Creature } from "../src/sim/creatures";
import { daylight } from "../src/sim/daylight";
import { resetArtifactIds } from "../src/sim/artifacts";
import { C } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { TICK, generateWorld, type World } from "../src/sim/world";

const SEED = 11;
// Dusk begins near 0.62 of the day (daylight.ts), 187 s after a world starts.
export const DAY_SECONDS = 180;
export const RUN_SECONDS = 300;

export interface MonsterProgram {
  name: string;
  // Where its shape comes from.
  from: string;
  code: string;
  // A monster: it scares, hunts or turns people (the others of the ten are peaceful).
  hostile?: boolean;
}

const lab = (file: string) => readFileSync(join("lab", file), "utf8");
const spawnAll = (kind: string, n: number) =>
  `*cast(w) { w.sound("growl", 0.3); yield 0.3; for (let k = 0; k < ${n}; k++) w.spawn("${kind}", w.x + k * 0.8 - ${(n - 1) * 0.4}, w.y); }`;

// The ten. The two shapes the review of 10 November quoted (a Werewolf of 80
// health awake at night that scares villagers; three Undead of 140 health,
// speed 1.2, on guard), written as those numbers say; four monsters of the
// live library as the staging copy held them on 11 November (lab/monsters);
// and the creature examples the writer is shown (worker/prompts.ts) or was
// tried with (lab/creatures).
export const MONSTERS: MonsterProgram[] = [
  {
    name: "Werewolf (review)",
    from: "the review's shape",
    hostile: true,
    code: `const spell = { creatures: [
      { name: "werewolf", base: "beast", body: "four legs", color: "#5a4a3a", features: ["tail", "glowing eyes"],
        speed: 2.6, hp: 80, radius: 0.6, behavior: "hunt", goal: "hunt", prey: ["deer", "sheep"], attack: 18, sense: 14,
        active: "night", scares: ["villager"] } ],
      ${spawnAll("werewolf", 1)} };`,
  },
  {
    name: "Undead (review)",
    from: "the review's shape",
    hostile: true,
    code: `const spell = { creatures: [
      { name: "undead", base: "spirit", body: "two legs", color: "#7a8a6a", features: ["glowing eyes"],
        speed: 1.2, hp: 140, radius: 0.45, behavior: "guard", goal: "guard", attack: 10, sense: 10, scares: ["villager"] } ],
      ${spawnAll("undead", 3)} };`,
  },
  { name: "Werewolf", from: "live", hostile: true, code: lab("monsters/werewolf.js") },
  { name: "Undead Horde", from: "live", hostile: true, code: lab("monsters/undead-horde.js") },
  { name: "Vampire", from: "live", hostile: true, code: lab("monsters/vampire.js") },
  { name: "Succubus", from: "live", hostile: true, code: lab("monsters/succubus.js") },
  { name: "Serpent", from: "worker/prompts.ts", code: FORM_EXAMPLES.creature.code },
  {
    name: "Grove wisps",
    from: "worker/prompts.ts",
    code: `const spell = { creatures: [
      { name: "wisp", base: "spirit", color: "#b8a0ff", color2: "#fff2b0", features: ["glowing eyes"],
        behavior: "follow", leader: ["villager"], aura: "sleep", auraRadius: 3, weak: ["fire"], onDeath: "seeds" } ],
      *cast(w) { for (let k = 0; k < 3; k++) w.spawn("wisp", w.x + w.rand(-3, 3), w.y + w.rand(-3, 3)); } };`,
  },
  { name: "Fox Spirit", from: "lab/creatures", code: lab("creatures/fox-spirit.js") },
  { name: "Serpent (lab)", from: "lab/creatures", code: lab("creatures/serpent-a.js") },
];

export interface MonsterLife {
  name: string;
  // Creatures it placed, and the median seconds each stayed alive by day (capped at DAY_SECONDS).
  placed: number;
  medianLife: number;
  // Of its creatures, how many were alive at the end of the day and at the end of the run.
  aliveAtDusk: number;
  aliveAtEnd: number;
  // Villagers at the start, and dead after five minutes beyond those dead on the island left alone.
  villagers: number;
  killed: number;
  // Share of villagers left (the creature probe's "the island did not hold" asks 0.7).
  villagersLeft: number;
  // What its creatures that died by day died of: villagers striking them,
  // daylight burning one weak to light, or anything else.
  causes: { villagers: number; daylight: number; other: number };
  errors: string[];
}

interface Isle {
  world: World;
  rt: Runtime;
  target: { x: number; y: number };
  random: () => number;
  life: () => number;
}

// The test run's island (check.ts `island`), built the same way.
function isle(errors: string[]): Isle {
  Math.random = seeded(SEED);
  resetCreatureIds();
  resetArtifactIds();
  const world = generateWorld(REFERENCE_SIDE, REFERENCE_SIDE, SEED);
  populate(world);
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  const life = seeded(SEED + 2);
  for (let k = 0; k < 60; k++) stepHeadless(world, rt, { life });
  let target = { x: world.w / 2, y: world.h / 2 };
  for (let i = 0; i < world.n; i++) {
    if (world.cover[i] === C.HOUSE) {
      target = { x: (i % world.w) + 6, y: Math.floor(i / world.w) + 6 };
      break;
    }
  }
  return { world, rt, target, random: seeded(SEED + 1), life };
}

const villagersAlive = (w: World) => w.creatures.filter((c) => !c.dead && c.kind === "villager").length;

let control: number | null = null;
function controlVillagers(): number {
  if (control !== null) return control;
  const outer = Math.random;
  const s = isle([]);
  Math.random = s.random;
  for (let k = 0; k < RUN_SECONDS / TICK; k++) stepHeadless(s.world, s.rt, { life: s.life });
  control = villagersAlive(s.world);
  Math.random = outer;
  return control;
}

// The creature a villager's social sense has it fighting (social.ts keeps it in data.social).
const struckBy = (o: Creature): Creature | null => {
  const seen = o.data.social as { threat?: Creature | null; fight?: number } | undefined;
  return seen && (seen.fight ?? 0) > 0 ? (seen.threat ?? null) : null;
};

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function monsterLife(p: MonsterProgram): MonsterLife {
  const outer = Math.random;
  const left = controlVillagers();
  const errors: string[] = [];
  const s = isle(errors);
  const { world, rt, target } = s;
  Math.random = s.random;
  const key = `monster:${p.name}`;
  const villagers = villagersAlive(world);
  rt.cast({ key, name: p.name, tier: "major", code: p.code, kind: "artifact", form: "creature" }, target.x, target.y);
  const born = new Map<Creature, number>();
  const died = new Map<Creature, number>();
  const causes = { villagers: 0, daylight: 0, other: 0 };
  // What last took health from each, by the tick it was seen losing it.
  const lastHp = new Map<Creature, number>();
  const lastCause = new Map<Creature, keyof typeof causes>();
  const causeOf = (c: Creature): keyof typeof causes => {
    for (const o of world.crowd.near(world, c.x, c.y, 3))
      if (o.kind === "villager" && !o.dead && (struckBy(o) === c || (o.mind?.task === "fight" && o.mind.target === c))) return "villagers";
    const ai = kindOf(c).ai;
    if (ai?.weak.includes("light") && daylight(world.time).night < 0.3) return "daylight";
    return "other";
  };
  let aliveAtDusk = 0;
  for (let k = 0; k < RUN_SECONDS / TICK; k++) {
    stepHeadless(world, rt, { life: s.life });
    const t = (k + 1) * TICK;
    for (const c of world.creatures) {
      if (rt.owners.get(`creature:${c.kind}`) !== key) continue;
      if (!born.has(c)) born.set(c, t);
      if (!died.has(c) && c.hp < (lastHp.get(c) ?? c.hp)) lastCause.set(c, causeOf(c));
      lastHp.set(c, c.hp);
      if (c.dead && !died.has(c)) {
        died.set(c, t);
        if (t - born.get(c)! < DAY_SECONDS && t < DAY_SECONDS + 1) causes[lastCause.get(c) ?? "other"]++;
      }
    }
    // A creature taken out of the world without being marked dead counts as dead.
    for (const c of born.keys()) if (!died.has(c) && !world.creatures.includes(c)) died.set(c, t);
    if (k === Math.round(DAY_SECONDS / TICK) - 1) aliveAtDusk = [...born.keys()].filter((c) => !died.has(c)).length;
  }
  Math.random = outer;
  const lives = [...born].map(([c, b]) => Math.min(DAY_SECONDS, (died.get(c) ?? Infinity) - b));
  const end = villagersAlive(world);
  return {
    name: p.name,
    placed: born.size,
    medianLife: Math.round(median(lives) * 10) / 10,
    aliveAtDusk,
    aliveAtEnd: [...born.keys()].filter((c) => !died.has(c)).length,
    villagers,
    killed: Math.max(0, left - end),
    villagersLeft: villagers ? Math.round((end / villagers) * 100) / 100 : 1,
    causes,
    errors,
  };
}

export function monsterLives(programs = MONSTERS): MonsterLife[] {
  return programs.map(monsterLife);
}

const diedOf = (r: MonsterLife) =>
  [
    r.causes.villagers ? `villagers ${r.causes.villagers}` : "",
    r.causes.daylight ? `daylight ${r.causes.daylight}` : "",
    r.causes.other ? `other ${r.causes.other}` : "",
  ]
    .filter(Boolean)
    .join(", ") || "none";

export function monsterTable(rows: MonsterLife[]): string {
  const lines = [
    "| Monster | Placed | Median life by day (s) | Alive at dusk | Died by day of | Alive at 5 min | Villagers killed in 5 min | Villagers left |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of rows)
    lines.push(
      `| ${r.name} | ${r.placed} | ${r.medianLife} | ${r.aliveAtDusk} | ${diedOf(r)} | ${r.aliveAtEnd} | ${r.killed} of ${r.villagers} | ${Math.round(r.villagersLeft * 100)}% |`,
    );
  lines.push(`| **Median of the ${rows.length}** | | **${median(rows.map((r) => r.medianLife))}** | | | | | |`);
  const hostile = rows.filter((r) => MONSTERS.find((m) => m.name === r.name)?.hostile);
  if (hostile.length && hostile.length < rows.length)
    lines.push(
      `| **Median of the ${hostile.length} monsters** | | **${median(hostile.map((r) => r.medianLife))}** | | | | ${hostile.reduce((n, r) => n + r.killed, 0)} in all | |`,
    );
  return lines.join("\n");
}

// --library <file>: every program of a library dump with creatures
// ([{name, code}], or wrangler's JSON of name and spec), instead of the ten.
function libraryPrograms(file: string): MonsterProgram[] {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const rows: { name: string; code?: string; spec?: string }[] = Array.isArray(raw) && raw[0]?.results ? raw[0].results : raw;
  return rows
    .map((r) => ({ name: r.name, from: "library", code: r.code ?? (JSON.parse(r.spec ?? "{}").code as string) }))
    .filter((p) => typeof p.code === "string" && /creatures\s*:\s*\[\s*\{/.test(p.code));
}

if (process.argv[1]?.endsWith("monsters-run.mjs")) {
  const at = process.argv.indexOf("--library");
  const rows = monsterLives(at > 0 ? libraryPrograms(process.argv[at + 1]) : MONSTERS);
  console.log(monsterTable(rows));
  for (const r of rows) if (r.errors.length) console.log(`${r.name}: ${r.errors[0]}`);
}
