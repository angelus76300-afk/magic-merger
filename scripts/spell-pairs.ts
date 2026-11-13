// Dev only: pairs of library-like items in a five minute scene, with the reactions of 4.12
// (src/sim/reactions.ts) off (as on main) and on (the player's island), counting the pairs
// that interact and the pairs that make something neither makes alone.
//   npx esbuild scripts/spell-pairs.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/spell-pairs.mjs --log-level=warning
//   for k in 0 1 2 3; do node node_modules/.cache/spell-pairs.mjs --out /tmp/pairs --shard $k/4 & done; wait
//   node node_modules/.cache/spell-pairs.mjs --out /tmp/pairs --fold
// Items: the stored programs kept in lab/ (spells, creatures, monsters, artifacts, legacy) and
// twenty written the way the live programs of the measurement of 12 November behave
// (docs/measurements/spell-library-2026-11-12.md: Phoenix only spawns its creature, Divine
// Radiance heals and lights, Shadow paints rock and smoke). Pairs: two of each group of pairs
// a player expects something from, plus 28 drawn from all items (seeded).
// The island: the test run's practice island (seed 11, the reference size), cast by a village.
// A is cast at 0 s, B at the same spot at 3 s; the scene runs 300 s. A pair interacts in a
// count (cells of each ground, cover, fluid and gas, cells on fire, creatures by kind, the
// dead, health, voxels) at 10, 60 or 300 s when B after A differs from A alone plus B alone
// (less the island alone) by more than: a floor (8 cells, 2 creatures, 20 health, 20 voxels),
// twice the pair's own noise in that count (the same pair on another random stream), and the
// cells both items change alone. It makes something new when 5 cells or more of a material
// are there that neither item alone nor the island alone has (fewer than 2 cells).
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { REFERENCE_SIDE } from "../shared/tiers";
import { populate, resetCreatureIds } from "../src/sim/creatures";
import { C } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { generateWorld, type World } from "../src/sim/world";

Runtime.slowMs = Infinity;

interface Item {
  name: string;
  code: string;
}

// Written as the live programs behave (the measurement's run-time trace), not as their names promise.
const WRITTEN: Item[] = [
  {
    name: "Phoenix",
    code: `const spell = { creatures: [{ name: "phoenix", base: "beast", body: "bird", color: "#d9461f", glow: true, flying: true, fireproof: true, radius: 0.6, speed: 4.5, hp: 120, goal: "spread", leaves: "flowers", behavior: "wander", weak: ["water", "cold"], active: "day", scares: ["wolf"] }], *cast(w) { w.burst(w.x, w.y, { count: 20, colors: ["#ff8a3a"] }); w.spawn("phoenix", w.x, w.y); } };`,
  },
  {
    name: "Fire",
    code: `const spell = { *cast(w) { w.sound("whoosh", 0.4); for (let k = 0; k < 4; k++) { w.ignite(w.x + w.rand(-4, 4), w.y + w.rand(-4, 4), 5, 0.8); yield 0.3; } } };`,
  },
  {
    name: "Great Flood",
    code: `const spell = { *cast(w) { w.sound("rise", 0.5); for (let k = 0; k < 3; k++) { w.flood(w.x, w.y, 12, "water", 1.2); yield 0.5; } } };`,
  },
  {
    name: "Volcano",
    code: `const spell = { *cast(w) { w.quake(w.x, w.y, 10, 1); yield 0.5; w.flood(w.x, w.y, 5, "lava", 1); w.gas(w.x, w.y, 4, "smoke", 0.8); } };`,
  },
  { name: "Black Ice", code: `const spell = { *cast(w) { w.temperature(w.x, w.y, 12, -60); w.paint(w.x, w.y, 8, "snow", 0.6); } };` },
  {
    name: "Blizzard",
    code: `const spell = { *cast(w) { for (let k = 0; k < 6; k++) { w.temperature(w.x + w.rand(-6, 6), w.y + w.rand(-6, 6), 8, -40); w.paint(w.x, w.y, 10, "snow", 0.3); yield 0.5; } } };`,
  },
  {
    name: "Lich",
    code: `const spell = { creatures: [{ name: "lich", base: "beast", hp: 200, speed: 1.2, behavior: "wander", color: "#5a6a5a", glow: true }], *cast(w) { w.spawn("lich", w.x, w.y); w.darken(0.3, 2); } };`,
  },
  {
    name: "Undead Legion",
    code: `const spell = { creatures: [{ name: "undead legion", base: "villager", hp: 120, speed: 1.4, behavior: "guard", attack: 12, sense: 10 }], *cast(w) { for (let k = 0; k < 4; k++) w.spawn("undead legion", w.x + k, w.y + 2); } };`,
  },
  {
    name: "Divine Radiance",
    code: `const spell = { *cast(w) { w.light(w.x, w.y, 12, "#fff6c8", 3); for (const c of w.creatures(w.x, w.y, 12)) { c.heal(40); c.status("calm", 6); } } };`,
  },
  { name: "Shadow", code: `const spell = { *cast(w) { w.darken(0.6, 8); w.paint(w.x, w.y, 4, "rock", 0.5); w.gas(w.x, w.y, 6, "smoke", 0.6); } };` },
  { name: "Night", code: `const spell = { *cast(w) { w.darken(0.8, 20); w.tint("#1a1640", 0.3, 20); } };` },
  {
    name: "Will-o'-the-Wisp",
    code: `const spell = { *cast(w) { for (let k = 0; k < 4; k++) { w.light(w.x + w.rand(-5, 5), w.y + w.rand(-5, 5), 8, "#bfe8ff", 3); yield 1; } } };`,
  },
  {
    name: "Boogeyman",
    code: `const spell = { creatures: [{ name: "boogeyman", base: "beast", hp: 300, speed: 2.4, behavior: "hunt", prey: ["villager"], attack: 6, active: "night", weak: ["light"] }], *cast(w) { w.spawn("boogeyman", w.x, w.y); } };`,
  },
  {
    name: "Blast Wave",
    code: `const spell = { *cast(w) { w.shockwave(w.x, w.y, 14, "#ffffff", 0.8, 2); for (const c of w.creatures(w.x, w.y, 14)) c.push(c.x - w.x, c.y - w.y, 2); } };`,
  },
  {
    name: "Hurricane",
    code: `const spell = { *cast(w) { for (let k = 0; k < 6; k++) { w.wind(8, 3); w.shockwave(w.x, w.y, 12, "#cfe8ff", 0.6, 1); yield 0.5; } } };`,
  },
  { name: "Meteor Strike", code: `const spell = { *cast(w) { w.sound("boom", 0.8); w.explode(w.x, w.y, 5, 1.2); w.ignite(w.x, w.y, 7, 0.6); } };` },
  { name: "World Seed", code: `const spell = { *cast(w) { w.grow(w.x, w.y, 10, 0.8); w.paint(w.x, w.y, 3, "flower", 0.5); } };` },
  {
    name: "Healing Rain",
    code: `const spell = { *cast(w) { for (let k = 0; k < 4; k++) { w.flood(w.x + w.rand(-6, 6), w.y + w.rand(-6, 6), 3, "water", 0.3); yield 0.5; } for (const c of w.creatures(w.x, w.y, 12)) c.heal(30); } };`,
  },
  {
    name: "Flame Hound",
    code: `const spell = { creatures: [{ name: "flame hound", base: "beast", hp: 150, attack: 10, behavior: "wander", color: "#ff6a1a" }], *cast(w) { w.spawn("flame hound", w.x, w.y); w.spawn("flame hound", w.x + 2, w.y); } };`,
  },
  {
    name: "Frost Wolf",
    code: `const spell = { creatures: [{ name: "frost wolf", base: "beast", hp: 150, attack: 10, behavior: "wander", color: "#cfe8ff" }], *cast(w) { w.spawn("frost wolf", w.x, w.y); w.spawn("frost wolf", w.x + 2, w.y); } };`,
  },
  {
    name: "Archangel",
    code: `const spell = { creatures: [{ name: "archangel", base: "spirit", glow: true, flying: true, hp: 420, attack: 30, behavior: "guard", sense: 16 }], *cast(w) { w.spawn("archangel", w.x, w.y); w.light(w.x, w.y, 8, "#fff6c8", 2); } };`,
  },
  {
    name: "Familiar",
    code: `const spell = { creatures: [{ name: "familiar", base: "beast", radius: 0.4, speed: 3.4, hp: 40, behavior: "follow", leader: ["villager"], weak: ["cold"] }], *cast(w) { w.spawn("familiar", w.x, w.y); } };`,
  },
];

function stored(): Item[] {
  const out: Item[] = [];
  for (const dir of ["lab/spells", "lab/creatures", "lab/monsters", "lab/artifacts", "lab/legacy"])
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".js"))
      .sort()) {
      const name = file
        .replace(/\.js$/, "")
        .replace(/^v\d-/, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (m) => m.toUpperCase());
      out.push({ name: `${name} (${dir.slice(4)})`, code: readFileSync(join(dir, file), "utf8") });
    }
  return out;
}

const ITEMS = [...WRITTEN, ...stored()];
const byName = (n: string) => ITEMS.find((i) => i.name === n || i.name.startsWith(`${n} (`))!;

// The pairs a player expects something from, two of each group (A then B).
const EXPECTED: [string, string, string][] = [
  ["fire then water", "Fire", "Great Flood"],
  ["fire then water", "Phoenix", "Healing Rain"],
  ["lava then water", "Volcano", "Great Flood"],
  ["lava then water", "Volcano", "Healing Rain"],
  ["water then cold", "Great Flood", "Black Ice"],
  ["water then cold", "Healing Rain", "Blizzard"],
  ["cold then fire", "Black Ice", "Fire"],
  ["cold then fire", "Blizzard", "Meteor Strike"],
  ["light on shadow", "Shadow", "Will-o'-the-Wisp"],
  ["light on shadow", "Boogeyman", "Divine Radiance"],
  ["shadow then a creature of the night", "Night", "Boogeyman"],
  ["growth on ash", "Fire", "World Seed"],
  ["growth on ash", "Meteor Strike", "World Seed"],
  ["fire on growth", "World Seed", "Fire"],
  ["fire on growth", "Grove", "Phoenix"],
  ["wind on fire", "Fire", "Hurricane"],
  ["wind on fire", "Meteor Strike", "Blast Wave"],
  ["a creature then its predator", "Familiar", "Serpent"],
  ["a creature then its foe", "Flame Hound", "Frost Wolf"],
  ["undead then holy", "Lich", "Divine Radiance"],
  ["undead then holy", "Undead Legion", "Archangel"],
  ["undead then holy", "Undead Horde", "Divine Radiance"],
  ["a creature of fire on growth", "World Seed", "Phoenix"],
  ["a creature of fire then water", "Phoenix", "Great Flood"],
];

function sampled(n: number): [string, string, string][] {
  const r = seeded(4012);
  const out: [string, string, string][] = [];
  const seen = new Set(EXPECTED.map(([, a, b]) => `${a}|${b}`));
  while (out.length < n) {
    const a = ITEMS[Math.floor(r() * ITEMS.length)].name;
    const b = ITEMS[Math.floor(r() * ITEMS.length)].name;
    if (a === b || seen.has(`${a}|${b}`)) continue;
    seen.add(`${a}|${b}`);
    out.push(["sample", a, b]);
  }
  return out;
}

const PAIRS = [...EXPECTED, ...sampled(28)];
const SEED = 11;
const SECONDS = 300;
const B_AT = 3;
const SNAP_AT = [10, 60, 300];

type Counts = Record<string, number>;
interface Snap {
  counts: Counts;
  // Per cell, for what both items change: ground, cover, fluid and gas as one number.
  cells: Uint32Array;
}
// The kinds living on the island before any cast: their numbers and health drift with every
// change (a villager walks elsewhere and lives a different life), so they are not judged.
let ISLAND_KINDS = new Set<string>();

function island(stream: number): { world: World; rt: Runtime; x: number; y: number } {
  Math.random = seeded(SEED);
  resetCreatureIds();
  const world = generateWorld(REFERENCE_SIDE, REFERENCE_SIDE, SEED);
  populate(world);
  const rt = new Runtime(world, () => {});
  for (let k = 0; k < 60; k++) stepHeadless(world, rt);
  ISLAND_KINDS = new Set(world.creatures.map((c) => c.kind.split("#")[0]));
  let x = world.w / 2;
  let y = world.h / 2;
  for (let i = 0; i < world.n; i++)
    if (world.cover[i] === C.HOUSE) {
      x = (i % world.w) + 6;
      y = Math.floor(i / world.w) + 6;
      break;
    }
  Math.random = seeded(SEED + 1 + stream * 101);
  return { world, rt, x, y };
}

function snap(world: World): Snap {
  const counts: Counts = {};
  const add = (k: string, v = 1) => (counts[k] = (counts[k] ?? 0) + v);
  const cells = new Uint32Array(world.n);
  const m = world.materials;
  for (let i = 0; i < world.n; i++) {
    add(`ground ${m.get("ground", world.ground[i]).name}`);
    if (world.cover[i]) add(`cover ${m.get("cover", world.cover[i]).name}`);
    const fl = world.depth[i] > 0.05 ? world.fluid[i] : 0;
    if (fl) add(`fluid ${m.get("fluid", fl).name}`);
    const g = world.gasAmt[i] > 0.05 ? world.gas[i] : 0;
    if (g) add(`gas ${m.get("gas", g).name}`);
    if (world.fire[i] > 0) add("fire");
    cells[i] = world.ground[i] | (world.cover[i] << 8) | (fl << 16) | (g << 24);
  }
  for (const c of world.creatures) {
    if (c.dead) {
      add("dead");
      continue;
    }
    const kind = c.kind.split("#")[0];
    if (ISLAND_KINDS.has(kind)) continue;
    add(`creature ${kind}`);
    add("health", c.hp / 10);
  }
  add("voxels", world.decor.size / 20);
  return { counts, cells };
}

function scene(reactions: boolean, a: Item | null, b: Item | null, stream = 0): Snap[] {
  const { world, rt, x, y } = island(stream);
  world.reactions = reactions;
  const snaps: Snap[] = [];
  let at = 0;
  for (let tick = 0; tick <= SECONDS * 30; tick++) {
    if (tick === 0 && a) rt.cast({ key: "a", name: a.name, tier: "major", code: a.code }, x, y);
    if (tick === B_AT * 30 && b) rt.cast({ key: "b", name: b.name, tier: "major", code: b.code }, x, y);
    if (tick === SNAP_AT[at] * 30) {
      snaps.push(snap(world));
      at++;
    }
    if (tick < SECONDS * 30) stepHeadless(world, rt);
  }
  return snaps;
}

// The floor of each count, in its own units (cells, creatures, tens of health, twenties of voxels).
const floorOf = (k: string) => (k.startsWith("creature") ? 2 : k === "dead" ? 3 : k === "health" || k === "voxels" ? 2 : 8);
const cellCount = (k: string) => /^(ground|cover|fluid|gas|fire)/.test(k);

interface Verdict {
  interacts: boolean;
  made: string[];
  why: string[];
}

// What a pair's runs leave, per snapshot: the counts of the island alone, A alone, B alone, B
// after A, B after A on another stream, and the cells both items change alone.
interface Runs {
  e: Counts[];
  a: Counts[];
  b: Counts[];
  ab: Counts[];
  noise: Counts[];
  both: number[];
}

function runsOf(e: Snap[], a: Snap[], b: Snap[], ab: Snap[], noise: Snap[]): Runs {
  const both = SNAP_AT.map((_, s) => {
    let n = 0;
    for (let i = 0; i < e[s].cells.length; i++) if (a[s].cells[i] !== e[s].cells[i] && b[s].cells[i] !== e[s].cells[i]) n++;
    return n;
  });
  const c = (l: Snap[]) => l.map((x) => x.counts);
  return { e: c(e), a: c(a), b: c(b), ab: c(ab), noise: c(noise), both };
}

function judge(r: Runs): Verdict {
  const why: string[] = [];
  const made = new Set<string>();
  const keys = new Set<string>();
  for (const l of [r.e, r.a, r.b, r.ab]) for (const c of l) for (const k of Object.keys(c)) keys.add(k);
  for (const k of keys) {
    const v = (c: Counts) => c[k] ?? 0;
    const most = (l: Counts[]) => Math.max(...l.map(v));
    for (let s = 0; s < SNAP_AT.length; s++) {
      const diff = v(r.ab[s]) - (v(r.a[s]) + v(r.b[s]) - v(r.e[s]));
      const limit = Math.max(floorOf(k), 2 * Math.abs(v(r.noise[s]) - v(r.ab[s])), cellCount(k) ? r.both[s] : 0);
      if (Math.abs(diff) > limit) why.push(`${k} ${diff > 0 ? "+" : ""}${Math.round(diff)} at ${SNAP_AT[s]} s`);
      if (cellCount(k) && k !== "fire" && v(r.ab[s]) >= 5 && v(r.noise[s]) >= 5 && most(r.a) < 2 && most(r.b) < 2 && most(r.e) < 2) made.add(k);
    }
  }
  return { interacts: why.length > 0, made: [...made], why: why.slice(0, 4) };
}

const args = process.argv.slice(2);
const out = args[args.indexOf("--out") + 1] ?? "/tmp/spell-pairs";
mkdirSync(out, { recursive: true });

if (args.includes("--fold")) {
  const rows: { group: string; a: string; b: string; off: Verdict; on: Verdict }[] = [];
  for (const f of readdirSync(out).filter((f) => /^shard-\d+\.json$/.test(f)))
    for (const raw of JSON.parse(readFileSync(join(out, f), "utf8")) as { group: string; a: string; b: string; off: Runs; on: Runs }[])
      rows.push({ group: raw.group, a: raw.a, b: raw.b, off: judge(raw.off), on: judge(raw.on) });
  const sum = (list: typeof rows, mode: "off" | "on") => ({
    interact: list.filter((r) => r[mode].interacts).length,
    made: list.filter((r) => r[mode].made.length).length,
  });
  for (const [label, list] of [
    ["expected", rows.filter((r) => r.group !== "sample")],
    ["sampled", rows.filter((r) => r.group === "sample")],
    ["all", rows],
  ] as const) {
    const off = sum(list, "off");
    const on = sum(list, "on");
    console.log(`${label}: ${list.length} pairs; interact off ${off.interact}, on ${on.interact}; make something new off ${off.made}, on ${on.made}`);
  }
  for (const r of rows.sort((p, q) => (p.group === "sample" ? 1 : 0) - (q.group === "sample" ? 1 : 0)))
    console.log(
      `| ${r.group} | ${r.a} then ${r.b} | ${r.off.interacts ? "yes" : "no"}${r.off.made.length ? `, new ${r.off.made.join(", ")}` : ""} | ${r.on.interacts ? "yes" : "no"}${r.on.made.length ? `, new ${r.on.made.join(", ")}` : ""} | ${r.on.why.join("; ")} |`,
    );
} else {
  const [k, n] = (args[args.indexOf("--shard") + 1] ?? "0/1").split("/").map(Number);
  const mine = PAIRS.filter((_, i) => i % n === k);
  const alone = new Map<string, Snap[]>();
  const results = [];
  const file = join(out, `shard-${k}.json`);
  for (const mode of [false, true]) alone.set(`${mode}|`, scene(mode, null, null));
  const aloneOf = (mode: boolean, item: Item, second: boolean) => {
    const key = `${mode}|${item.name}|${second}`;
    if (!alone.has(key)) alone.set(key, second ? scene(mode, null, item) : scene(mode, item, null));
    return alone.get(key)!;
  };
  for (const [group, an, bn] of mine) {
    const a = byName(an);
    const b = byName(bn);
    const runs = (mode: boolean) => runsOf(alone.get(`${mode}|`)!, aloneOf(mode, a, false), aloneOf(mode, b, true), scene(mode, a, b), scene(mode, a, b, 1));
    const row = { group, a: a.name, b: b.name, off: runs(false), on: runs(true) };
    results.push(row);
    const off = judge(row.off);
    const on = judge(row.on);
    console.log(`${group}: ${a.name} then ${b.name}: off ${off.interacts}/${off.made.join(",")} on ${on.interacts}/${on.made.join(",")}`);
    writeFileSync(file, JSON.stringify(results));
  }
  if (!existsSync(file)) writeFileSync(file, "[]");
}
