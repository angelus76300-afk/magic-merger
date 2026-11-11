import { housesOf, tierOf } from "./buildings";
import type { Settlement } from "./ecology";
import { pile, tell } from "./kin";
import { C } from "./materials";
import { WARD } from "./wards";
import type { World } from "./world";

// The island needs you (2026-11-11). Merging never needed the island and the
// island never needed a merge: of 483 live items, 338 were never cast. A
// trouble is something that happens to one of the player's villages and that
// the right item answers: the island shows it, in one line and under the
// director's camera (director.ts), and never says what to do about it. The
// player invents the answer on the board, where the island waits for them.
//
// The first trouble is a wildfire: the engine already has wind, what burns,
// villagers who rebuild and houses to count. A trouble has three stages (it
// starts, it grows, it reaches the village), ends when its cause is gone and
// not on a clock, and is judged by what is left of the village: saved,
// scarred or lost. A village that sat under a shield meanwhile was held, not
// saved. It never takes more than a third of a village, and the first three
// troubles of an island take one house at most.
//
// Plain logic over the world: npm test runs it (scripts/troubles-test.ts).
// The World frame decides when one may start (frame.ts): only while the
// player is playing.

export type TroubleKind = "wildfire";
export type Outcome = "saved" | "scarred" | "lost" | "held" | "spent";

export interface Trouble {
  kind: TroubleKind;
  // The village it threatens: its center and its name when it began.
  vx: number;
  vy: number;
  name: string;
  // Where it started, and the house it is making for: the nearest one.
  x: number;
  y: number;
  hx: number;
  hy: number;
  t0: number;
  stage: 1 | 2 | 3;
  // The village when it began, and house cells lost so far (rebuilt ones still count).
  houses0: number;
  people0: number;
  lost: number;
  seen: number;
  // The most it may take, in house cells.
  cap: number;
  // How far from where it started the fire may have come by now, and how
  // often the wind lit it again after it died down by itself.
  front: number;
  embers: number;
  // Seconds with nothing burning, and checks made with the village under a shield.
  calm: number;
  checks: number;
  warded: number;
  // What the player cast at it, newest last: the item's key and name, its emoji, and when.
  casts: { key: string; name: string; emoji: string; t: number }[];
}

// What a village keeps of the item that saved it: one stone, one line.
export interface Stone {
  x: number;
  y: number;
  village: string;
  key: string;
  item: string;
  emoji: string;
  kind: TroubleKind;
  day: number;
}

export interface TroubleEnd {
  trouble: Trouble;
  outcome: Outcome;
  // The item that answered it, when one did.
  by: { key: string; name: string; emoji: string } | null;
  line: string;
  housesLost: number;
}

const DAY = 360;
// How far round the village and the start a fire belongs to the trouble.
const REACH = 46;
// Between two troubles, in seconds of island time, and before an island's first.
export const TROUBLE_EVERY = 600;
export const TROUBLE_FIRST = 180;
// A cast counts as the answer when the fire is out within this many seconds of it.
const ANSWER_WITHIN = 40;
// The fire's front comes on at a pace a player can read and answer: cells a
// second. Left to the engine a brush fire is over, or in the houses, within
// half a minute (measured on five islands).
const FRONT_PACE = 0.26;
const FEED_FOR = 300;

const DIRS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
function direction(dx: number, dy: number): string {
  return DIRS[((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];
}

function near(world: World, x: number, y: number, r: number, fn: (i: number, cx: number, cy: number) => void): void {
  const x0 = Math.max(0, Math.floor(x - r));
  const x1 = Math.min(world.w - 1, Math.ceil(x + r));
  const y0 = Math.max(0, Math.floor(y - r));
  const y1 = Math.min(world.h - 1, Math.ceil(y + r));
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if ((cx - x) ** 2 + (cy - y) ** 2 <= r * r) fn(cy * world.w + cx, cx, cy);
}

const houseCells = (world: World, x: number, y: number): number => {
  let n = 0;
  near(world, x, y, 18, (i) => {
    if (world.cover[i] === C.HOUSE) n++;
  });
  return n;
};

const peopleOf = (world: World, x: number, y: number): number =>
  world.creatures.filter((c) => !c.dead && c.kind === "villager" && Math.hypot(c.homeX - x, c.homeY - y) < 24).length;

/** Fire cells that belong to the trouble, and the one nearest the village. */
export function fireOf(world: World, t: Trouble): { cells: number; x: number; y: number; dist: number } {
  let cells = 0;
  let best = Infinity;
  let bx = t.x;
  let by = t.y;
  const mx = (t.x + t.vx) / 2;
  const my = (t.y + t.vy) / 2;
  near(world, mx, my, REACH, (i, cx, cy) => {
    if (world.fire[i] <= 0.05) return;
    cells++;
    const d = Math.hypot(cx - t.vx, cy - t.vy);
    if (d < best) {
      best = d;
      bx = cx;
      by = cy;
    }
  });
  return { cells, x: bx, y: by, dist: best };
}

// Where a wildfire would start for this village: woods 14 to 28 cells away,
// the thicker and the more upwind the better, never by a wonder.
function woodsFor(world: World, s: Settlement, random: () => number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestScore = 0;
  const wind = Math.hypot(world.wind.x, world.wind.y) || 1;
  for (let k = 0; k < 40; k++) {
    const a = random() * Math.PI * 2;
    const d = 20 + random() * 14;
    const x = Math.round(s.x + Math.cos(a) * d);
    const y = Math.round(s.y + Math.sin(a) * d);
    if (!world.inside(x, y)) continue;
    let trees = 0;
    let bad = false;
    near(world, x, y, 4, (i) => {
      if (world.cover[i] === C.TREE) trees++;
      if (world.cover[i] === C.WONDER || world.cover[i] === C.HOUSE) bad = true;
    });
    if (bad || trees < 8 || world.wonders.some((w) => Math.hypot(w.x - x, w.y - y) < w.r + 8)) continue;
    // The fire needs a way to the village: on sand and rock it dies where it started.
    let fuel = 0;
    const steps = Math.floor(d);
    for (let k = 0; k < steps; k++) {
      const i = Math.round(y + ((s.y - y) * k) / steps) * world.w + Math.round(x + ((s.x - x) * k) / steps);
      if (world.depth[i] < 0.1 && (world.cover[i] === C.TREE || world.materials.get("ground", world.ground[i]).flammable > 0)) fuel++;
    }
    if (fuel < steps * 0.7) continue;
    // Wind blowing from the woods to the village carries it there.
    const toward = ((s.x - x) * world.wind.x + (s.y - y) * world.wind.y) / (d * wind);
    const score = trees * (1.3 + toward);
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }
  return best;
}

/** Starts a wildfire by one of the island's villages, if one has woods near it. Null when none does. */
export function startWildfire(world: World, random: () => number = Math.random): Trouble | null {
  if (world.trouble) return null;
  const order = [...world.settlements].sort(() => random() - 0.5);
  for (const s of order) {
    const houses = houseCells(world, s.x, s.y);
    if (houses < 8) continue;
    const at = woodsFor(world, s, random);
    if (!at) continue;
    const tier = tierOf(housesOf(world, s));
    // Its size follows the village: a hamlet a brush fire, a town a real one.
    const r = tier === "town" ? 3.6 : tier === "village" ? 2.8 : 2;
    near(world, at.x, at.y, r, (i) => {
      if (world.cover[i] === C.TREE || world.ground[i] !== 0) world.fire[i] = 1;
    });
    let hx = s.x;
    let hy = s.y;
    let nearest = Infinity;
    near(world, s.x, s.y, 18, (i, cx, cy) => {
      const dh = Math.hypot(cx - at.x, cy - at.y);
      if (world.cover[i] === C.HOUSE && dh < nearest) {
        nearest = dh;
        hx = cx;
        hy = cy;
      }
    });
    const name = s.name || "the village";
    const early = world.troubles < 3;
    const t: Trouble = {
      kind: "wildfire",
      vx: s.x,
      vy: s.y,
      name,
      x: at.x,
      y: at.y,
      hx,
      hy,
      t0: world.time,
      stage: 1,
      houses0: houses,
      people0: peopleOf(world, s.x, s.y),
      lost: 0,
      seen: houses,
      // A house is four cells. At most a third of the village; one house in an island's first three troubles.
      cap: early ? 4 : Math.max(4, Math.floor(houses / 12) * 4),
      front: r + 2,
      embers: 0,
      calm: 0,
      checks: 0,
      warded: 0,
      casts: [],
    };
    world.trouble = t;
    world.troubles++;
    tell(world, `fire in the woods ${direction(at.x - s.x, at.y - s.y)} of ${name}`, { x: at.x, y: at.y, weight: 3 });
    return t;
  }
  return null;
}

/** The player cast this near the trouble: it may be the answer. */
export function noteCast(world: World, key: string, name: string, emoji: string, x: number, y: number): void {
  const t = world.trouble;
  if (!t) return;
  const f = fireOf(world, t);
  if (Math.hypot(x - t.vx, y - t.vy) > REACH && Math.hypot(x - f.x, y - f.y) > REACH / 2) return;
  t.casts.push({ key, name, emoji, t: world.time });
  if (t.casts.length > 12) t.casts.shift();
}

/** Twice a second from the tick. Returns the end when the trouble is over. */
export function stepTrouble(world: World, dt: number): TroubleEnd | null {
  const t = world.trouble;
  if (!t) return null;
  const f = fireOf(world, t);
  const houses = houseCells(world, t.vx, t.vy);
  t.lost += Math.max(0, t.seen - houses);
  t.seen = houses;
  t.checks++;
  if (world.wardMask[Math.round(t.vy) * world.w + Math.round(t.vx)] & WARD.fire) t.warded++;
  const cast = t.casts.length ? world.time - t.casts[t.casts.length - 1].t : Infinity;
  // Its front advances from where it began; what ran ahead of it dies down.
  // Not while the player's own magic is at work: what a cast sets alight is the cast's doing.
  t.front += dt * FRONT_PACE;
  let burning = 0;
  if (cast > 30) {
    const mx = (t.x + t.vx) / 2;
    const my = (t.y + t.vy) / 2;
    near(world, mx, my, REACH, (i, cx, cy) => {
      if (world.fire[i] > 0.05 && Math.hypot(cx - t.x, cy - t.y) > t.front) world.fire[i] = 0;
    });
  }
  near(world, t.vx, t.vy, 20, (i) => {
    if (world.fire[i] > 0.05 && world.cover[i] === C.HOUSE) burning++;
  });
  if (t.stage === 1 && f.dist < 14) {
    t.stage = 2;
    tell(world, `the fire is coming toward ${t.name}`, { x: f.x, y: f.y, weight: 3 });
  }
  if (t.stage < 3 && (t.lost > 0 || burning > 0)) {
    t.stage = 3;
    tell(world, `${t.name} is burning`, { x: t.vx, y: t.vy, weight: 3 });
  }
  // It has taken what it may: round the houses it dies down by itself.
  if (t.lost + burning > t.cap || t.lost >= t.cap)
    near(world, t.vx, t.vy, 22, (i) => {
      world.fire[i] = 0;
    });
  // The wind carries it on: at its front the fire is kept alight on whatever
  // burns there, until it reaches the houses or the player's magic meets it.
  // Left to the engine it starves behind its own front on thin ground.
  // Five minutes at most: a fire that cannot reach the house burns out.
  if (cast > 15 && t.stage < 3 && t.lost < t.cap && world.time - t.t0 < FEED_FOR) {
    const d = Math.hypot(t.hx - t.x, t.hy - t.y) || 1;
    const reach = Math.min(t.front, d);
    let ex = t.x + ((t.hx - t.x) / d) * reach;
    let ey = t.y + ((t.hy - t.y) / d) * reach;
    let alight = 0;
    near(world, ex, ey, 3, (i) => {
      if (world.fire[i] > 0.05) alight++;
    });
    if (alight < 2) {
      let lit = 0;
      // Over a stream or bare rock the wind carries sparks on: the next ground that burns, up to eight cells ahead.
      for (let ahead = 0; ahead <= 8 && !lit && reach + ahead <= d; ahead += 2) {
        ex = t.x + ((t.hx - t.x) / d) * (reach + ahead);
        ey = t.y + ((t.hy - t.y) / d) * (reach + ahead);
        near(world, ex, ey, 2.5, (i) => {
          if (lit >= 3 || world.depth[i] > 0.1 || world.cover[i] === C.WONDER) return;
          if (world.cover[i] === C.TREE || world.cover[i] === C.HOUSE || world.materials.get("ground", world.ground[i]).flammable > 0) {
            world.fire[i] = 1;
            lit++;
          }
        });
        if (lit && ahead) t.front = reach + ahead;
      }
      if (lit) {
        t.embers++;
        t.calm = 0;
        return null;
      }
    }
  }
  t.calm = f.cells === 0 ? t.calm + dt : 0;
  if (t.calm < 3) return null;
  return endTrouble(world, t);
}

function endTrouble(world: World, t: Trouble): TroubleEnd {
  world.trouble = null;
  world.troubleNext = world.time + TROUBLE_EVERY;
  const housesLost = Math.ceil(t.lost / 4);
  const people = peopleOf(world, t.vx, t.vy);
  const last = t.casts[t.casts.length - 1];
  const answered = !!last && world.time - last.t <= ANSWER_WITHIN;
  const held = t.warded > t.checks / 2;
  let outcome: Outcome;
  if (t.lost >= t.cap && t.cap > 4) outcome = "lost";
  else if (t.lost > 0 || people < t.people0 * 0.85) outcome = "scarred";
  else if (held) outcome = "held";
  else outcome = answered ? "saved" : "spent";
  const by = answered && (outcome === "saved" || outcome === "scarred") ? { key: last.key, name: last.name, emoji: last.emoji } : null;
  const loss = housesLost === 1 ? "one house" : `${housesLost} houses`;
  const line =
    outcome === "saved"
      ? `${by!.name} put out the fire: ${t.name} is unharmed`
      : outcome === "held"
        ? `the fire burned out round ${t.name}, held behind its shield`
        : outcome === "spent"
          ? `the fire by ${t.name} burned itself out`
          : outcome === "lost"
            ? `the fire took ${loss} of ${t.name}`
            : by
              ? `${by.name} stopped the fire, but ${t.name} lost ${housesLost ? loss : "some of its people"}`
              : `the fire is out: ${t.name} lost ${housesLost ? loss : "some of its people"}`;
  tell(world, line, { x: t.vx, y: t.vy, weight: 3 });
  if (by && outcome === "saved") raiseStone(world, t, by);
  return { trouble: t, outcome, by, line, housesLost };
}

// One stone per village, by its plaza: a grey pillar with a gold cap. It
// does nothing; a tap reads it (frame.ts).
function raiseStone(world: World, t: Trouble, by: { key: string; name: string; emoji: string }): void {
  const old = world.stones.find((s) => s.village === t.name);
  let x = old?.x ?? -1;
  let y = old?.y ?? -1;
  if (!old) {
    for (let r = 2; r < 9 && x < 0; r++)
      for (let k = 0; k < 12 && x < 0; k++) {
        const cx = Math.round(t.vx + Math.cos(k * 0.52) * r);
        const cy = Math.round(t.vy + Math.sin(k * 0.52) * r);
        if (!world.inside(cx, cy)) continue;
        const i = cy * world.w + cx;
        if (world.cover[i] !== C.NONE || world.depth[i] > 0.3) continue;
        x = cx;
        y = cy;
      }
    if (x < 0) return;
    // Three voxels on one cell (kin.ts, pile: every ninth is the next layer of the same spot).
    pile(world, x, y, 0, 0x9a9aa6);
    pile(world, x, y, 9, 0x9a9aa6);
    pile(world, x, y, 18, 0xffc23d);
  }
  const stone: Stone = { x, y, village: t.name, key: by.key, item: by.name, emoji: by.emoji, kind: t.kind, day: Math.floor(world.time / DAY) + 1 };
  world.stones = [...world.stones.filter((s) => s.village !== t.name), stone];
  tell(world, `${t.name} raised a stone to ${by.name}`, { x, y, weight: 2 });
}

/** The stone at a tapped spot, if any. */
export function stoneAt(world: World, x: number, y: number): Stone | null {
  return world.stones.find((s) => Math.hypot(s.x + 0.5 - x, s.y + 0.5 - y) < 1.8) ?? null;
}

/** What a stone says. */
export function stoneLine(s: Stone): string {
  return `${s.item} saved ${s.village} from fire, day ${s.day}`;
}

export const MAX_STONES = 24;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

/** What a save holds of troubles, checked field by field: a save is data from outside. */
export function readTroubles(v: unknown): { n: number; next: number; now: Trouble | null; stones: Stone[] } | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Record<string, unknown>;
  if (!num(d.n) || !num(d.next)) return null;
  const stones: Stone[] = [];
  for (const raw of Array.isArray(d.stones) ? d.stones.slice(0, MAX_STONES) : []) {
    const s = raw as Record<string, unknown>;
    if (s && num(s.x) && num(s.y) && num(s.day) && text(s.village, 60) && text(s.key, 120) && text(s.item, 120) && text(s.emoji, 16) && s.kind === "wildfire")
      stones.push({ x: s.x, y: s.y, village: s.village, key: s.key, item: s.item, emoji: s.emoji, kind: "wildfire", day: s.day });
  }
  let now: Trouble | null = null;
  const t = d.now as Record<string, unknown> | null;
  if (
    t &&
    t.kind === "wildfire" &&
    text(t.name, 60) &&
    [t.vx, t.vy, t.x, t.y, t.t0, t.houses0, t.people0, t.lost, t.seen, t.cap].every(num) &&
    (t.stage === 1 || t.stage === 2 || t.stage === 3)
  ) {
    const casts = (Array.isArray(t.casts) ? t.casts.slice(-12) : []).filter(
      (c): c is Trouble["casts"][number] =>
        !!c &&
        text((c as Record<string, unknown>).key, 120) &&
        text((c as Record<string, unknown>).name, 120) &&
        text((c as Record<string, unknown>).emoji, 16) &&
        num((c as Record<string, unknown>).t),
    );
    now = {
      kind: "wildfire",
      vx: t.vx as number,
      vy: t.vy as number,
      name: t.name,
      x: t.x as number,
      y: t.y as number,
      hx: num(t.hx) ? t.hx : (t.vx as number),
      hy: num(t.hy) ? t.hy : (t.vy as number),
      t0: t.t0 as number,
      stage: t.stage,
      houses0: t.houses0 as number,
      people0: t.people0 as number,
      lost: t.lost as number,
      seen: t.seen as number,
      cap: t.cap as number,
      front: num(t.front) ? t.front : 6,
      embers: num(t.embers) ? t.embers : 0,
      calm: 0,
      checks: num(t.checks) ? t.checks : 0,
      warded: num(t.warded) ? t.warded : 0,
      casts,
    };
  }
  return { n: Math.max(0, Math.floor(d.n)), next: d.next, now, stones };
}

/** What is seen of a trouble right now, in one line: never what to do about it. */
export function troubleLine(t: Trouble): string {
  return t.stage === 3 ? `${cap(t.name)} is burning` : t.stage === 2 ? `The fire is coming toward ${t.name}` : `Fire in the woods by ${t.name}`;
}
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
