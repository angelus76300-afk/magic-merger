// The island needs you (2026-11-11, src/sim/troubles.ts): a wildfire by a
// village, paced so it can be answered, capped in what it takes, judged by
// what is left of the village, kept in the save, and first for the director.
// High water (2026-11-12, src/sim/highwater.ts), the second trouble, below.
import { kindOf, populate, resetCreatureIds } from "../src/sim/creatures";
import { Director } from "../src/sim/director";
import { storyOn, tell } from "../src/sim/kin";
import { DEFAULT_LAND, resolveLand } from "../src/sim/land";
import { C } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { loadWorld, saveWorld } from "../src/sim/save";
import { WARD } from "../src/sim/wards";
import { stepHeadless } from "../src/sim/tick";
import {
  endTrouble,
  fireOf,
  frontOf,
  noteCast,
  readTroubles,
  startTrouble,
  startWildfire,
  stoneAt,
  stoneLine,
  troubleLine,
  type Trouble,
  type TroubleEnd,
} from "../src/sim/troubles";
import { startHighWater } from "../src/sim/highwater";
import { playerCast } from "../src/sim/playercast";
import { castFromEyes } from "../src/sim/eyes";
import { surfaceY } from "../src/sim/voxel/terrain";
import { SCENARIOS } from "../src/sim/scenarios";
import { doDeed, deedsOf, possess, release } from "../src/sim/possess";
import { jobOf } from "../src/sim/goals";
import { unpackLook } from "../src/sim/villagers";
import { raiseWonders } from "../src/sim/wonderbuild";
import { generateWorld, World } from "../src/sim/world";

type Check = (name: string, ok: boolean, detail?: string) => void;

function island(seed: number) {
  Runtime.slowMs = Infinity;
  const world = generateWorld(152, 152, seed, resolveLand({ ...DEFAULT_LAND }, seed, 152));
  populate(world);
  const rt = new Runtime(world, () => undefined);
  raiseWonders(world, rt);
  storyOn(world);
  for (let k = 0; k < 60 * 30; k++) stepHeadless(world, rt);
  return { world, rt };
}

// Runs a wildfire to its end. `answerAt`: seconds in, every fire is put out and an item is cast at it.
function burn(
  seed: number,
  answerAt: number | null,
  before?: (world: World) => void,
): { end: TroubleEnd | null; world: World; seconds: number; stage: number; lines: string[] } {
  const { world, rt } = island(seed);
  before?.(world);
  const told = world.story.length;
  const t = startWildfire(world, seeded(seed));
  let seconds = 0;
  while (t && world.trouble && seconds < 400) {
    for (let k = 0; k < 30; k++) stepHeadless(world, rt);
    seconds++;
    if (answerAt !== null && seconds === answerAt) {
      // The item is cast, and then does its work: every fire out, and what was hot enough to catch again cooled.
      noteCast(world, "rain", "Rain", "", t.x, t.y);
      world.fire.fill(0);
      for (let i = 0; i < world.n; i++) world.temp[i] = Math.min(world.temp[i], 20);
    }
  }
  storyOn(null);
  return { end: world.troubleEnd, world, seconds, stage: t?.stage ?? 0, lines: world.story.slice(told).map((l) => l.text) };
}

export function troubleChecks(check: Check): void {
  // 1. Left alone: it reaches the village, takes one house and no more, and ends by itself.
  {
    const r = burn(21, null);
    const text = `${r.seconds} s, ${r.end?.outcome}, ${r.end?.housesLost} houses: ${r.lines.join(" / ")}`;
    check("troubles: a wildfire left alone ends by itself within five minutes", !!r.end && r.seconds >= 40 && r.seconds < 300, text);
    check(
      "troubles: it is told as it starts, as it comes and as it arrives, never what to do",
      r.lines.some((l) => l.startsWith("fire in the woods")) &&
        r.lines.some((l) => l.includes("is burning")) &&
        !/\b(water|rain|use|cast|try)\b/i.test(r.lines.filter((l) => l.includes("fire")).join(" ")),
      text,
    );
    check("troubles: an island's first troubles take one house at most", r.end?.outcome === "scarred" && r.end.housesLost === 1, text);
    check("troubles: no stone for a village nobody saved", r.world.stones.length === 0 && r.world.trouble === null && r.world.troubleNext > r.world.time);
  }
  // 2. Answered in time: unharmed, the item named, a stone by the village that a tap reads.
  {
    const r = burn(2026, 30);
    const s = r.world.stones[0];
    check(
      "troubles: answered in time, the village is saved by the item cast",
      r.end?.outcome === "saved" && r.end.by?.key === "rain" && r.end.housesLost === 0,
      `${r.end?.outcome}: ${r.end?.line}`,
    );
    check(
      "troubles: the village raises one stone to it",
      r.world.stones.length === 1 && !!s && stoneLine(s).startsWith("Rain saved ") && stoneAt(r.world, s.x + 0.5, s.y + 0.5) === s,
      s && stoneLine(s),
    );
    // The save keeps the stone and the count, and reads them back.
    const back = loadWorld(JSON.parse(JSON.stringify(saveWorld(r.world, new Map()))), () => undefined);
    check(
      "troubles: the stone and the count of troubles come back with the save",
      back?.stones.length === 1 && back.stones[0].item === "Rain" && back.troubles === 1 && back.trouble === null,
    );
  }
  // 2b. A cast that does not reduce the fire earns nothing: Fire thrown at the fire is no answer (the playtest saw it thanked).
  {
    const { world, rt } = island(2026);
    const t = startWildfire(world, seeded(2026))!;
    let seconds = 0;
    while (world.trouble && seconds < 400) {
      for (let k = 0; k < 30; k++) stepHeadless(world, rt);
      seconds++;
      // Every ten seconds an item is cast at it that changes nothing.
      if (seconds % 10 === 0 && world.trouble) noteCast(world, "fire", "Fire", "", t.x, t.y);
    }
    const end = world.troubleEnd;
    check(
      "troubles: an item that did not reduce the fire gets no thanks and no stone",
      !!end && end.by === null && end.outcome !== "saved" && world.stones.length === 0 && !/Fire (put out|stopped)/.test(end.line),
      `${end?.outcome}: ${end?.line}`,
    );
    check(
      "troubles: such casts were noted, and the fire went on to the houses",
      t.casts.length > 0 && t.stage === 3,
      `${t.casts.length} casts, stage ${t.stage}`,
    );
    storyOn(null);
  }
  // 2c. A village that sat under a shield while the woods burned was held, not saved: no stone (asked in the review).
  {
    const { world, rt } = island(2026);
    const t = startWildfire(world, seeded(2026))!;
    const center = Math.round(t.vy) * world.w + Math.round(t.vx);
    let seconds = 0;
    while (world.trouble && seconds < 400) {
      for (let k = 0; k < 30; k++) {
        world.wardMask[center] |= WARD.fire;
        stepHeadless(world, rt);
      }
      seconds++;
      if (seconds === 30) {
        noteCast(world, "rain", "Rain", "", t.x, t.y);
        world.fire.fill(0);
        for (let i = 0; i < world.n; i++) world.temp[i] = Math.min(world.temp[i], 20);
      }
    }
    const end = world.troubleEnd;
    check(
      "troubles: under a shield the village is held, not saved, and raises no stone",
      end?.outcome === "held" && end.by === null && world.stones.length === 0 && end.line.includes("behind its shield"),
      `${end?.outcome}: ${end?.line}`,
    );
    storyOn(null);
  }
  // 3. A trouble running is saved and goes on after a reload; what is not a trouble in a save is dropped.
  {
    const { world, rt } = island(21);
    const t = startWildfire(world, seeded(21))!;
    for (let k = 0; k < 20 * 30; k++) stepHeadless(world, rt);
    const back = loadWorld(JSON.parse(JSON.stringify(saveWorld(world, new Map()))), () => undefined);
    check(
      "troubles: a trouble running comes back with the save, where it was",
      !!back?.trouble && back.trouble.name === t.name && back.trouble.stage === world.trouble?.stage && back.trouble.cap === t.cap,
    );
    check(
      "troubles: a save's troubles are read field by field",
      readTroubles({ n: 2, next: 900, now: { kind: "flood" }, stones: [{ x: "1" }] })?.now === null &&
        readTroubles({ n: 2, next: 900, now: null, stones: [{ x: "1" }] })?.stones.length === 0 &&
        readTroubles("x") === null,
    );
    // The director goes to it first, and says only what is seen.
    const d = new Director(() => 0.5);
    const shot = d.update(world).shot;
    check("troubles: the director's camera goes to the trouble first", shot?.sort === "trouble" && shot.caption === troubleLine(world.trouble!), shot?.caption);
    // While it lasts the watch shows nothing else, whatever happens elsewhere, and leaves it when it is over.
    tell(world, "a child was born in the village", { x: 5, y: 5 });
    world.time += 30;
    check("troubles: the watch stays on the trouble while it lasts", d.update(world).shot?.sort === "trouble");
    const was = world.trouble;
    world.trouble = null;
    check("troubles: and goes back to the island's stories when it is over", d.update(world).shot?.sort !== "trouble");
    world.trouble = was;
    storyOn(null);
  }
  // 4. Its size follows the island's history: from the fourth trouble it may take a third of the village.
  {
    const r = burn(99, null, (w) => {
      w.troubles = 3;
    });
    const cap = r.end ? r.end.trouble.cap / 4 : 0;
    check(
      "troubles: later troubles may take up to a third of a village, never more",
      !!r.end && cap >= 1 && cap <= Math.ceil(r.end.trouble.houses0 / 12) && r.end.housesLost <= cap,
      `${r.end?.housesLost} of ${r.end && r.end.trouble.houses0 / 4}, cap ${cap}`,
    );
  }
  // 5. No woods with a way to the houses: no wildfire. A cast far away is not its answer.
  {
    const { world } = island(7);
    check("troubles: an island of sand has no wildfire", startWildfire(world, seeded(7)) === null && world.trouble === null && world.troubles === 0);
    const w2 = island(21).world;
    const t = startWildfire(w2, seeded(21))!;
    noteCast(w2, "far", "Far", "", (t.vx + 76) % 152, (t.vy + 76) % 152);
    const f = fireOf(w2, t);
    check("troubles: a cast far from the fire and the village is not noted", t.casts.length === 0 && f.cells > 0);
    let trees = 0;
    for (let i = 0; i < w2.n; i++) if (w2.cover[i] === C.TREE && w2.fire[i] > 0) trees++;
    check("troubles: it starts in the woods", trees > 0, String(trees));
    let nearest = Infinity;
    for (let i = 0; i < w2.n; i++) if (w2.cover[i] === C.HOUSE) nearest = Math.min(nearest, Math.hypot((i % w2.w) - t.x, Math.floor(i / w2.w) - t.y));
    check("troubles: and at least sixteen cells from every house", nearest >= 16, nearest.toFixed(1));
    storyOn(null);
  }
  highWaterChecks(check);
}

// High water (2026-11-12, src/sim/highwater.ts): the second trouble. Its own islands, made with
// Math.random seeded and kept as saves, so each check plays the same flood; the stream the rest of
// the checks draw from is put back after.
const kept = new Map<number, string>();
function waterIsland(seed: number): { world: World; rt: Runtime } {
  const had = kept.get(seed);
  if (had) {
    const world = loadWorld(JSON.parse(had), () => undefined)!;
    storyOn(world);
    Math.random = seeded(seed * 7 + 5);
    // New creatures numbered the same way whatever ran before: a flood plays the same alone and in npm test.
    resetCreatureIds(world.creatures.reduce((m, c) => Math.max(m, c.id), 0) + 1);
    return { world, rt: new Runtime(world, () => undefined) };
  }
  Math.random = seeded(seed * 3 + 1);
  const { world } = island(seed);
  storyOn(null);
  kept.set(seed, JSON.stringify(saveWorld(world, new Map())));
  return waterIsland(seed);
}

const P = (body: string) => `const spell = { *cast(w) { ${body} } };`;
const DIKE = P(
  "w.sound('rumble', 0.8); for (let h = 0; h < 5; h++) { w.ring(w.x, w.y, w.r * 0.9, w.r * 0.9 + 2.5, (x, y) => w.build(x, y, 1, 'basalt')); yield 0.2; }",
);
const FROST = P("for (let k = 0; k < 40; k++) { w.temperature(w.x, w.y, w.r, -120); yield 0.5; }");
const DAM = P("w.disc(w.x, w.y, 4, (x, y) => w.build(x, y, 4, 'rock'));");
const HEAT = P("for (let k = 0; k < 30; k++) { w.temperature(w.x, w.y, w.r * 0.8, 300); yield 0.5; }");
const HILL = P("w.terraform(w.x, w.y, w.r * 0.35, 6);");
const MOAT = P("w.ring(w.x, w.y, w.r * 0.7, w.r * 0.7 + 2, (x, y) => w.terraform(x, y, 1.2, -5));");
const WATER = P("for (let k = 0; k < 6; k++) { w.flood(w.x, w.y, w.r * 0.5, 'water', 1); yield 1; }");
const NOTHING = P("w.flash('#fff', 0.3);");
const DOME = P("w.ward(w.x, w.y, 16, { against: ['fluids'], seconds: 600 });");
// A plain Earth as a spell writer might write it: a mound of rock (hand written; the live one is in the database).
const EARTH = P("w.terraform(w.x, w.y, w.r * 0.35, 4); w.paint(w.x, w.y, w.r * 0.3, 'rock', 0.8);");
const DOME_SMALL = P("w.ward(w.x, w.y, w.r, { seconds: 600 });");

type Spot = "front" | "mid" | "source" | "village" | "house" | "line";
interface Cast {
  key: string;
  code: string;
  at: Spot;
  tier?: "minor" | "major";
  // Seconds in; at the second stage when absent.
  when?: number;
  // For "line": the k-th of `of` casts across the water's way, six cells apart.
  k?: number;
  of?: number;
}
interface Flow {
  end: TroubleEnd | null;
  world: World;
  t: Trouble | null;
  seconds: number;
  stages: number[];
  lines: string[];
  most: number;
  // When ground outside its bed was first wet; the most the open sea and the island's rim stood over their level.
  firstWet: number;
  offshore: number;
  rim: number;
}

// One high water from start to end, with what is cast at it.
function flow(seed: number, casts: Cast[] = [], opts: { troubles?: number; every?: (world: World, t: Trouble, s: number, rt: Runtime) => void } = {}): Flow {
  const { world, rt } = waterIsland(seed);
  world.troubles = opts.troubles ?? 0;
  const told = world.story.length;
  storyOn(world);
  const t = startTrouble(world, seeded(seed), "flood");
  const stages: number[] = [0];
  let seconds = 0;
  let most = 0;
  let firstWet = Infinity;
  let offshore = 0;
  let rim = 0;
  const done = new Set<Cast>();
  while (t && world.trouble && seconds < 400) {
    for (let k = 0; k < 30; k++) stepHeadless(world, rt);
    seconds++;
    while (stages.length < t.stage) stages.push(seconds);
    const cells = frontOf(world, t).cells;
    most = Math.max(most, cells);
    if (cells > 0 && firstWet === Infinity) firstWet = seconds;
    if (seconds % 5 === 0) {
      const [x0, y0, bw, bh] = t.flood!.box;
      for (let y = y0; y < y0 + bh; y++)
        for (let x = x0; x < x0 + bw; x++) {
          const i = y * world.w + x;
          if (world.height[i] >= world.seaLevel - 0.5 || world.fluid[i] !== 1) continue;
          const over = world.height[i] + world.depth[i] - world.seaLevel;
          if (x === 0 || y === 0 || x === world.w - 1 || y === world.h - 1) rim = Math.max(rim, over);
          let land = false;
          for (let dy = -9; dy <= 9 && !land; dy++)
            for (let dx = -9; dx <= 9 && !land; dx++)
              if (world.inside(x + dx, y + dy) && world.height[(y + dy) * world.w + x + dx] >= world.seaLevel) land = true;
          if (!land) offshore = Math.max(offshore, over);
        }
    }
    for (const c of casts) {
      if (done.has(c) || (c.when !== undefined ? seconds < c.when : t.stage < 2)) continue;
      done.add(c);
      const f = frontOf(world, t);
      const d = Math.hypot(t.hx - f.x, t.hy - f.y) || 1;
      const o = ((c.k ?? 0) - ((c.of ?? 1) - 1) / 2) * 6;
      const at =
        c.at === "front"
          ? [f.x, f.y]
          : c.at === "source"
            ? [t.x, t.y]
            : c.at === "village"
              ? [t.vx, t.vy]
              : c.at === "house"
                ? [t.hx, t.hy]
                : c.at === "line"
                  ? [f.x + (t.hx - f.x) * 0.4 - ((t.hy - f.y) / d) * o, f.y + (t.hy - f.y) * 0.4 + ((t.hx - f.x) / d) * o]
                  : [f.x + (t.hx - f.x) * 0.35, f.y + (t.hy - f.y) * 0.35];
      playerCast(world, rt, { key: c.key, name: c.key, tier: c.tier ?? "major", code: c.code }, at[0], at[1]);
    }
    opts.every?.(world, t, seconds, rt);
  }
  storyOn(null);
  return { end: world.troubleEnd, world, t, seconds, stages, lines: world.story.slice(told).map((l) => l.text), most, firstWet, offshore, rim };
}

const said = (r: Flow) => `${r.end?.outcome ?? "running"} by ${r.end?.by?.name ?? "nothing"} at ${r.seconds} s, stages ${r.stages.join("/")}: ${r.end?.line}`;

export function highWaterChecks(check: Check): void {
  const stream = Math.random;
  const ids = resetCreatureIds();
  resetCreatureIds(ids);
  try {
    highWater(check);
  } finally {
    Math.random = stream;
    resetCreatureIds(ids);
    storyOn(null);
  }
}

// The islands the checks play on: a village (Vaelis, from the sea) and a hamlet (Vaelwywick, from the sea).
const M = 5;
const H = 4;
const CRUSH = P("w.terraform(w.x, w.y, 2, 8);");
const CRUSH_WIDE = P("w.terraform(w.x, w.y, 4, 10);");
// What answers it, each on an island where it does (the families' run, docs/DESIGN.md "High water").
const FAMILIES: [string, number, Cast][] = [
  ["earth raised round the village", 9, { key: "dike", code: DIKE, at: "village" }],
  ["a hill raised on its way", M, { key: "hill", code: HILL, at: "mid" }],
  ["cold at its source", M, { key: "frost", code: FROST, at: "source" }],
  ["its source dammed", M, { key: "dam", code: DAM, at: "source" }],
  ["a channel dug round the village", 10, { key: "moat", code: MOAT, at: "village" }],
  ["heat that boils it off", 9, { key: "heat", code: HEAT, at: "front" }],
];
const LINE_EARTH = (k: number): Cast => ({ key: `earth${k}`, code: EARTH, at: "line", tier: "minor", when: 20, k, of: 5 });

function highWater(check: Check): void {
  // 1. Where it comes, and where it does not.
  {
    const { world } = waterIsland(M);
    const t = startTrouble(world, seeded(M), "flood");
    check(
      "high water: it comes to a village whose houses rising water can reach, from the water nearest them",
      !!t && t.kind === "flood" && !!t.flood && Math.hypot(t.hx - t.x, t.hy - t.y) <= 28 && world.cover[t.hy * world.w + t.hx] === C.HOUSE,
      t ? `${t.name} from the ${t.flood?.body}, ${Math.hypot(t.hx - t.x, t.hy - t.y).toFixed(1)} cells` : "none",
    );
    check(
      "high water: it is told as it begins",
      !!t && world.story.some((l) => l.text === `the ${t.flood!.body} is rising at ${t.name}`),
      t ? troubleLine(t) : "none",
    );
    const dry = waterIsland(2026).world;
    check("high water: an island with no village in reach of rising water has none", startHighWater(dry, seeded(2026)) === null && dry.trouble === null);
    dry.troubleLast = "wildfire";
    const fallback = startTrouble(dry, seeded(2026));
    check("high water: there, its turn falls back to a wildfire", fallback?.kind === "wildfire", fallback?.kind ?? "none");
  }
  // 2. Left alone: it swells in its bed first, then spreads and reaches the village; one house in the first troubles.
  const alone = flow(M);
  {
    const r = alone;
    check(
      "high water: left alone it starts, spreads and reaches the village, in that order",
      r.stages.length === 3 &&
        r.stages[1] < r.stages[2] &&
        r.lines.some((l) => l.startsWith("the water is spreading toward")) &&
        r.lines.some((l) => l.endsWith("is flooding")),
      said(r),
    );
    // The playtest: 42 to 104 seconds from the first line to a house lost was too fast to answer.
    check(
      "high water: it gives time to answer: no ground beyond its bed wet for 45 s, no house reached for 85 s",
      r.firstWet >= 45 && r.stages[2] >= 85,
      `first wet ground at ${r.firstWet} s, first house at ${r.stages[2]} s`,
    );
    const h = flow(H);
    check(
      "high water: a hamlet gets longer, not shorter",
      h.firstWet >= 45 && h.stages[2] >= 90 && h.t!.flood!.th! > r.t!.flood!.th! && h.end?.outcome !== "lost",
      `hamlet: first house at ${h.stages[2]} s (planned ${h.t?.flood?.th}), village at ${r.stages[2]} s (planned ${r.t?.flood?.th}); ${said(h)}`,
    );
    check(
      "high water: an island's first troubles take one house at most, and it ends by itself",
      r.end?.outcome === "scarred" && r.end.housesLost === 1,
      said(r),
    );
    check(
      "high water: its lines say what is seen, never what to do",
      !/\b(earth|wall|dig|freeze|cold|heat|cast|use|try|dam|shield)\b/i.test(r.lines.filter((l) => /water|river|sea|lake|flood/.test(l)).join(" ")),
      r.lines.join(" / "),
    );
    check("high water: no stone for a village nobody saved", r.world.stones.length === 0 && r.end?.by === null);
    // The swell is the shore's: the sea out from it, and at the island's rim, stays at its own level.
    check(
      "high water: the sea swells along its shore, not as a plateau, and never at the island's rim",
      r.offshore < 0.15 && r.rim < 0.15,
      `open sea at most ${r.offshore.toFixed(2)} above its level, the rim ${r.rim.toFixed(2)}`,
    );
  }
  // 3. Only what the water takes is the water's: a house crushed by the player's own spell is not.
  {
    let at = { stage: 0, lost: 0, crushed: 0 };
    flow(M, [{ key: "crush", code: CRUSH, at: "house", when: 5 }], {
      every: (world, t, s) => {
        if (s === 5) at.crushed = t.seen;
        if (s === 12) at = { stage: t.stage, lost: t.lost, crushed: at.crushed - t.seen };
      },
    });
    check(
      "high water: a house the player's spell crushes is not lost to the water, nor brings it on",
      at.crushed > 0 && at.stage === 1 && at.lost === 0,
      JSON.stringify(at),
    );
    const { world, rt } = waterIsland(2026);
    const fire = startWildfire(world, seeded(2026))!;
    const around = () => {
      let n = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (world.cover[(fire.hy + dy) * world.w + fire.hx + dx] === C.HOUSE) n++;
      return n;
    };
    let crushed = 0;
    for (let s = 0; s < 8; s++) {
      for (let k = 0; k < 30; k++) stepHeadless(world, rt);
      if (s === 2) {
        crushed = around();
        playerCast(world, rt, { key: "crush", name: "Crush", tier: "minor", code: CRUSH_WIDE }, fire.hx, fire.hy);
      }
      if (s === 4) crushed -= around();
    }
    check(
      "high water: nor is one crushed during a wildfire lost to the fire",
      crushed > 0 && fire.lost === 0 && fire.stage < 3,
      `${crushed} house cells crushed, lost ${fire.lost}, stage ${fire.stage}`,
    );
    storyOn(null);
  }
  // 4. Later troubles may take a third of the village, never more; the first three never take it all.
  {
    const r = flow(M, [], { troubles: 3 });
    const cap = r.end ? r.end.trouble.cap / 4 : 0;
    check(
      "high water: from the fourth trouble it may take up to a third of a village, never more",
      !!r.end && cap > 1 && cap <= Math.ceil(r.end.trouble.houses0 / 12) && r.end.housesLost <= cap,
      `${said(r)}; cap ${cap} of ${r.end && r.end.trouble.houses0 / 4}`,
    );
    check("high water: the first three troubles never end lost", alone.end?.outcome !== "lost");
  }
  // 5. Water cast on it makes it worse: it reaches the houses sooner.
  {
    const r = flow(M, [{ key: "water", code: WATER, at: "front" }]);
    check(
      "high water: water cast on it brings it to the houses sooner, and earns no thanks",
      r.stages[2] < alone.stages[2] && r.end?.by === null && r.end?.outcome !== "saved",
      `${said(r)} against ${alone.stages[2]} s alone`,
    );
  }
  // 6. What answers it.
  const families = FAMILIES;
  let stone: Flow | null = null;
  for (const [what, seed, c] of families) {
    const r = flow(seed, [c]);
    if (c.key === "dike") stone = r;
    check(`high water: ${what} saves the village (${c.key})`, r.end?.outcome === "saved" && r.end.by?.key === c.key && r.end.housesLost === 0, said(r));
  }
  {
    const s = stone?.world.stones[0];
    check(
      "high water: the village raises a stone that names the item and the water",
      stone?.world.stones.length === 1 && !!s && s.kind === "flood" && /^dike saved .+ from the (sea|river|lake), day \d+$/.test(stoneLine(s)),
      s && stoneLine(s),
    );
  }
  // 7. Raised earth done plainly: five Earth casts across its way hold a hamlet, the gaps between them
  // closed by its people (the playtest: nine mounds, and the water came through the gaps). One is not
  // enough for a village.
  {
    const r = flow(H, [0, 1, 2, 3, 4].map(LINE_EARTH));
    check("high water: five plain Earth casts across its way hold a hamlet", r.end?.outcome === "saved" && /^earth/.test(r.end.by?.key ?? ""), said(r));
    const one = flow(27, [{ key: "earth", code: EARTH, at: "mid", tier: "minor" }]);
    check("high water: one plain Earth does not save a village", one.end?.outcome !== "saved" && one.end?.by === null, said(one));
  }
  // 8. A shield is held, not saved, and soon: over the village, or only over the house it makes for.
  {
    const d = flow(M, [{ key: "dome", code: DOME, at: "village" }]);
    check(
      "high water: under a shield the village is held, not saved, and raises no stone",
      d.end?.outcome === "held" && d.end.by === null && d.world.stones.length === 0,
      said(d),
    );
    const h = flow(H, [{ key: "dome", code: DOME_SMALL, at: "house", when: 10 }]);
    check(
      "high water: a shield on the house it makes for is held within moments of the water meeting it",
      h.end?.outcome === "held" && h.seconds < 170 && /held behind its shield/.test(h.end.line),
      said(h),
    );
  }
  // 9. Credit goes to what stopped it, not to what came after; what changes nothing earns nothing.
  {
    const r = flow(9, [
      { key: "dike", code: DIKE, at: "village" },
      { key: "flash", code: NOTHING, at: "front", when: 88 },
    ]);
    check("high water: the item that held it is thanked, not one cast after it", r.end?.outcome === "saved" && r.end.by?.key === "dike", said(r));
    const u = flow(M, [], {
      every: (world, t, s) => {
        if (s % 10 === 0) noteCast(world, "flash", "Flash", "", t.x, t.y);
      },
    });
    check(
      "high water: an item cast every ten seconds that changes nothing is never thanked",
      u.end?.by === null && u.end?.outcome !== "saved" && u.t!.casts.length > 0,
      said(u),
    );
  }
  // 10. Spent: held back by the land itself, nobody's cast, until the spate runs its course.
  {
    const r = flow(M, [], {
      every: (world, t, s) => {
        if (s !== 3) return;
        // The island raises its own land over the source: no cast, no answer.
        for (let dy = -5; dy <= 5; dy++)
          for (let dx = -5; dx <= 5; dx++) {
            const x = Math.round(t.x) + dx;
            const y = Math.round(t.y) + dy;
            if (dx * dx + dy * dy <= 25 && world.inside(x, y)) world.height[y * world.w + x] += 10;
          }
      },
    });
    check(
      "high water: held by nothing anyone cast, it is spent when the spate runs its course",
      r.end?.outcome === "spent" && r.end.by === null && r.seconds > 200,
      said(r),
    );
  }
  // 11. Nothing that walks stands in it unharmed (the playtest saw one wading).
  {
    let hurt = "";
    flow(M, [], {
      every: (world, t, s, rt) => {
        if (hurt || t.stage < 3) return;
        const f = t.flood!;
        let deepest = -1;
        for (let y = f.box[1]; y < f.box[1] + f.box[3]; y++)
          for (let x = f.box[0]; x < f.box[0] + f.box[2]; x++) {
            const i = y * world.w + x;
            if (
              Math.hypot(x - t.hx, y - t.hy) < 8 &&
              world.height[i] > world.seaLevel + 0.3 &&
              world.fluid[i] === 1 &&
              (deepest < 0 || world.depth[i] > world.depth[deepest])
            )
              deepest = i;
          }
        // A land animal: villagers are kept alive once the water has taken the one it may (the cap).
        const v = world.creatures.find((c) => !c.dead && c.kind !== "villager" && !kindOf(c).swims && !kindOf(c).flying && !kindOf(c).aquatic);
        if (!v || deepest < 0 || world.depth[deepest] < 0.75) return;
        v.x = (deepest % world.w) + 0.5;
        v.y = Math.floor(deepest / world.w) + 0.5;
        const hp = v.hp;
        for (let k = 0; k < 30; k++) stepHeadless(world, rt);
        hurt = `${hp.toFixed(1)} to ${v.hp.toFixed(1)} in ${world.depth[deepest].toFixed(2)} deep at ${s} s`;
        if (v.hp >= hp) hurt = `unharmed: ${hurt}`;
      },
    });
    check("high water: a land animal standing where it is deep is hurt", !!hurt && !hurt.startsWith("unharmed"), hurt || "never deep enough");
  }
  // 12. A wildfire and a high water take turns, a wildfire first.
  {
    const { world, rt } = waterIsland(M);
    const kinds: string[] = [];
    for (let n = 0; n < 3; n++) {
      const t = startTrouble(world, seeded(n + 1));
      kinds.push(t?.kind ?? "none");
      // Over at once: the next one's turn.
      if (t) endTrouble(world, t);
      for (let k = 0; k < 30; k++) stepHeadless(world, rt);
    }
    check("high water: a wildfire and a high water take turns, a wildfire first", kinds.join(",") === "wildfire,flood,wildfire", kinds.join(","));
  }
  // 13. The save: a high water running comes back where it was and plays on; an old save loads.
  {
    const { world, rt } = waterIsland(M);
    const t = startTrouble(world, seeded(M), "flood")!;
    for (let k = 0; k < 20 * 30; k++) stepHeadless(world, rt);
    const back = loadWorld(JSON.parse(JSON.stringify(saveWorld(world, new Map()))), () => undefined)!;
    const b = back.trouble;
    check(
      "high water: a high water running comes back with the save, where it was",
      !!b && b.kind === "flood" && b.stage === t.stage && b.flood?.b === t.flood!.b && b.flood?.bed === t.flood!.bed && back.troubleLast === "flood",
      b ? `${b.kind} stage ${b.stage}` : "none",
    );
    const rt2 = new Runtime(back, () => undefined);
    let s = 0;
    while (back.trouble && s < 400) {
      for (let k = 0; k < 30; k++) stepHeadless(back, rt2);
      s++;
    }
    check("high water: and plays on to its end", !back.trouble && !!back.troubleEnd, back.troubleEnd?.line ?? "still running");
    const old = readTroubles({
      n: 2,
      next: 900,
      now: null,
      stones: [{ x: 1, y: 2, village: "Kapan", key: "rain", item: "Rain", emoji: "", kind: "wildfire", day: 3 }],
    });
    check(
      "high water: a save from before high water loads, its troubles counted as wildfires",
      old?.last === "wildfire" && old.stones.length === 1 && old.stones[0].kind === "wildfire",
    );
    check(
      "high water: a high water in a save is read field by field",
      readTroubles({ n: 1, next: 9, now: { ...JSON.parse(JSON.stringify(t)), flood: { ...t.flood, box: [1, 2, "x", 4] } }, stones: [] })?.now === null &&
        readTroubles({ n: 1, next: 9, now: JSON.parse(JSON.stringify(t)), stones: [] })?.now?.kind === "flood",
    );
    // The director goes to it, with its own line.
    const d = new Director(() => 0.5);
    const shot = d.update(world).shot;
    check(
      "high water: the director's camera goes to it, with its line",
      shot?.sort === "trouble" && shot.caption === troubleLine(world.trouble!) && /rising|spreading|flooding/.test(shot.caption),
      shot?.caption,
    );
  }
  // 14. Becoming a builder: Build at the water heaps a bank; it slows the water and cannot end it alone.
  {
    let presses = 0;
    let built = "";
    const r = flow(M, [], {
      every: (world, t) => {
        if (t.stage < 2) return;
        const f = frontOf(world, t);
        const v = world.creatures.find((c) => !c.dead && c.kind === "villager" && jobOf(c) === "builder" && unpackLook(c.look).age === "adult");
        if (!v) return;
        // Stood by the water, facing it.
        const d = Math.hypot(t.hx - f.x, t.hy - f.y) || 1;
        v.x = f.x + ((t.hx - f.x) / d) * 2.2;
        v.y = f.y + ((t.hy - f.y) / d) * 2.2;
        possess(world, v);
        const facing = Math.atan2(f.y - v.y, f.x - v.x);
        if (deedsOf(world, v, facing).some((b) => b.verb === "Build")) {
          const out = doDeed(world, "trade", facing);
          if (out && out !== "busy" && "done" in out) {
            presses++;
            built = out.done;
          }
        }
        release(world);
      },
    });
    check("high water: a builder's Build at the water heaps a bank", presses > 0 && built === "Banked the water with earth", `${presses} presses: ${built}`);
    check("high water: and does not end it alone", r.end?.by === null && r.end?.outcome !== "saved", said(r));
  }
  // 15. A cast through a creature's eyes counts as a cast; no trouble in a challenge or by itself.
  {
    const { world, rt } = waterIsland(M);
    const t = startTrouble(world, seeded(M), "flood")!;
    const ground = (x: number, y: number) =>
      surfaceY(world, Math.max(0, Math.min(world.h - 1, Math.floor(y))) * world.w + Math.max(0, Math.min(world.w - 1, Math.floor(x))));
    // Six cells from the house it makes for, looking down at it.
    const a = Math.atan2(t.hy - t.vy, t.hx - t.vx);
    const ex = t.hx - Math.cos(a) * 6;
    const ey = t.hy - Math.sin(a) * 6;
    const h = ground(ex, ey) + 1.6;
    const out = castFromEyes({ x: ex, y: ey, h, yaw: a, pitch: -Math.atan2(h - ground(t.hx, t.hy), 6) }, ground, world.w, world.h, (x, y) =>
      playerCast(world, rt, { key: "eyes", name: "Eyes", tier: "minor", code: NOTHING }, x, y),
    );
    check("high water: a cast from a creature's eyes counts as a cast at it", out.ok && t.casts.some((c) => c.key === "eyes"), JSON.stringify(out));
    const scenario = SCENARIOS.find((s) => s.id === "flood")!.build();
    const srt = new Runtime(scenario.world, () => undefined);
    for (let k = 0; k < 60 * 30; k++) {
      stepHeadless(scenario.world, srt);
      scenario.run.tick(scenario.world);
    }
    check("high water: a challenge's own flood is no trouble, and none starts there", scenario.world.trouble === null && scenario.world.troubles === 0);
  }
}
