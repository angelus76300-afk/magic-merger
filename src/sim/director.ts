import { settlementNear } from "./buildings";
import type { Creature } from "./creatures";
import { jobOf } from "./goals";
import type { Happening } from "./kin";
import { wordOf } from "./names";
import { Rng } from "./noise";
import { kindName } from "./sites";
import { unpackLook } from "./villagers";
import { floatAt } from "./wonders";
import type { World } from "./world";

// The island tells its stories (2026-11-11). An untouched island makes about
// sixty story lines in ten minutes (a wolf kills a deer, a villager fights a
// bear, a tavern goes up) and none of it was seen: the camera stood still, far
// enough that a villager is a speck. The director chooses what is worth
// watching right now, as a shot: whom or where, how wide, and one line saying
// what it is. The World frame flies the camera to it (frame.ts).
//
// Three sources, by score: what is going on (a hunt, a fight, a raid, a house
// going up), what just happened and left something to see (a birth, a
// building finished, a wonder waking), and, when the island is quiet, its
// everyday life (a fisher at the shore, a herd, a wonder). What is going on
// comes first: a line is told after the kill, and a camera that leaves then
// arrives at a body.
//
// Plain logic over the world, no drawing and no clock of its own: npm test
// runs it for ten simulated minutes (scripts/director-test.ts).

export type ShotKind = "drama" | "news" | "site" | "life" | "wonder" | "wide";

export interface Shot {
  kind: ShotKind;
  // What it is about, for "not the same twice": a creature, a site, a place.
  key: string;
  // A finer sort for everyday life (the task), so two fishers do not follow each other.
  sort: string;
  // The creature followed, and the one it is after; 0 for none.
  who: number;
  other: number;
  x: number;
  y: number;
  // Cells the frame should hold round (x, y).
  r: number;
  caption: string;
  score: number;
  since: number;
  // Not cut before `least`, not held after `until`.
  least: number;
  until: number;
}

const DRAMA: Record<string, number> = { raid: 78, fight: 74, hunt: 68, take: 62, convert: 60, feast: 36 };
// Everyday tasks worth a look, and how much.
const LIFE: Record<string, number> = {
  fish: 20,
  fell: 18,
  harvest: 18,
  plant: 16,
  trade: 20,
  pray: 14,
  bury: 30,
  dam: 24,
  herd: 15,
  graze: 13,
  patrol: 17,
  feed: 22,
  carry: 12,
  beg: 22,
  repair: 26,
};
const AGAIN = 60;
const WIDE_EVERY = 6;
// A wonder stands still: not again for three minutes. The same sort of shot (a house going up) not within forty seconds.
const WONDER_AGAIN = 180;
const SORT_AGAIN = 40;

/** A villager's own name, the same after a reload: from what is saved of it (its look and its home). */
export function nameOf(world: World, c: Creature): string {
  const seed = (Math.imul(c.look | 0, 2654435761) ^ Math.imul(Math.round(c.homeX) + 7, 40503) ^ Math.imul(Math.round(c.homeY) + 3, 69069)) >>> 0;
  return wordOf(new Rng(seed || 1), world.land?.biome ?? "temperate");
}

const kindWord = (c: Creature): string => c.kind.split("#")[0];
const article = (s: string): string => (/^[aeiou]/i.test(s) ? "An" : "A");

/** "Mira the fisher", "A wolf": who a caption is about. */
export function whoIs(world: World, c: Creature): string {
  if (c.kind !== "villager") return `${article(kindWord(c))} ${kindWord(c)}`;
  const look = unpackLook(c.look);
  const title = c.mind?.title;
  if (title) return title;
  const job = jobOf(c);
  const what = look.age === "child" ? "a child" : look.age === "elder" ? "an elder" : job === "none" ? "" : `the ${job}`;
  return what ? `${nameOf(world, c)}, ${what},` : nameOf(world, c);
}

const lower = (c: Creature): string => (c.kind === "villager" ? "a villager" : `${article(kindWord(c)).toLowerCase()} ${kindWord(c)}`);

function dramaLine(world: World, c: Creature, task: string): string {
  const t = c.mind?.target;
  const who = whoIs(world, c);
  switch (task) {
    case "hunt":
      return t ? `${who} is hunting ${lower(t)}` : `${who} is on the hunt`;
    case "fight":
      return t ? `${who} is fighting ${lower(t)}` : `${who} is fighting`;
    case "raid":
      return `${who} is raiding ${settlementNear(world, c.mind?.tx ?? c.x, c.mind?.ty ?? c.y)?.name || "the village"}`;
    case "take":
      return `${who} is after treasure`;
    case "convert":
      return t ? `${who} is closing in on ${lower(t)}` : `${who} is looking for someone`;
    default:
      return `${who} is eating its catch`;
  }
}

export function lifeLine(world: World, c: Creature): string {
  let action = c.mind?.action ?? "";
  const who = whoIs(world, c);
  if (action === "carrying it home") action = `carrying ${typeof c.mind?.carry === "string" ? c.mind.carry : "a load"} home`;
  return /^[a-z]+ing\b/.test(action) || action.startsWith("on ") ? `${who} is ${action}` : `${who}: ${action || "looking around"}`;
}

const capital = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

export class Director {
  shot: Shot | null = null;
  cuts = 0;
  // Every shot taken, for the test and the frame's own numbers.
  readonly log: Shot[] = [];
  private seen = new Map<string, number>();
  private sorts = new Map<string, number>();
  private used = new Set<Happening>();
  private nextLook = 0;
  private sinceWide = 0;
  private cast: { x: number; y: number; t: number } | null = null;
  private byId = new Map<number, Creature>();

  constructor(private random: () => number = Math.random) {}

  /** The player cast here: for thirty seconds, what happens round it comes first. */
  castAt(x: number, y: number, now: number): void {
    this.cast = { x, y, t: now };
  }

  /** Starts over: the next update takes a shot at once. */
  reset(): void {
    this.shot = null;
    this.nextLook = 0;
  }

  /** The player asked to follow this one (the card's Follow): held until they let go. */
  pin(world: World, c: Creature): Shot {
    const now = world.time;
    this.shot = {
      kind: "life",
      key: `c${c.id}`,
      sort: "pin",
      who: c.id,
      other: 0,
      x: c.x,
      y: c.y,
      r: 5,
      caption: "",
      score: 1e6,
      since: now,
      least: Infinity,
      until: Infinity,
    };
    this.byId.set(c.id, c);
    this.track(world);
    return this.shot;
  }

  /** Call a few times a second. Returns the shot to show; `cut` says it is a new one. */
  update(world: World): { shot: Shot | null; cut: boolean } {
    const now = world.time;
    this.byId.clear();
    for (const c of world.creatures) this.byId.set(c.id, c);
    const cur = this.shot;
    if (cur) this.track(world);
    if (cur && cur.least === Infinity) return { shot: cur, cut: false };
    if (cur && now < cur.least) return { shot: cur, cut: false };
    if (cur && now < cur.until && now < this.nextLook) return { shot: cur, cut: false };
    this.nextLook = now + 1;
    const best = this.choose(world);
    if (cur && now < cur.until && (!best || best.score < cur.score + 25)) return { shot: cur, cut: false };
    if (!best) return { shot: cur, cut: false };
    this.take(best, now);
    return { shot: best, cut: true };
  }

  private take(shot: Shot, now: number): void {
    this.shot = shot;
    this.cuts++;
    this.seen.set(shot.key, now);
    this.sorts.set(`${shot.kind}:${shot.sort}`, now);
    this.sinceWide = shot.kind === "wide" ? 0 : this.sinceWide + 1;
    this.log.push(shot);
    if (this.log.length > 400) this.log.shift();
    for (const [k, t] of this.seen) if (now - t > AGAIN * 2) this.seen.delete(k);
  }

  // Follows the subject, widens to hold the one it is after, and ends the
  // shot soon once what it showed is over.
  private track(world: World): void {
    const s = this.shot!;
    const now = world.time;
    const c = s.who ? this.byId.get(s.who) : undefined;
    if (!s.who) return;
    if (!c || c.dead) {
      // Stay a moment on what is left, then move on.
      s.until = Math.min(s.until, now + 2);
      s.least = Math.min(s.least, now + 2);
      return;
    }
    const o = s.other ? this.byId.get(s.other) : undefined;
    if (o && !o.dead && Math.hypot(o.x - c.x, o.y - c.y) < 40) {
      s.x = (c.x + o.x) / 2;
      s.y = (c.y + o.y) / 2;
      s.r = Math.max(5, Math.hypot(o.x - c.x, o.y - c.y) / 2 + 4);
    } else {
      s.x = c.x;
      s.y = c.y;
      s.r = Math.max(5, s.r * 0.98);
    }
    if (s.kind === "drama") {
      const task = c.mind?.task ?? "none";
      if (DRAMA[task] !== undefined) {
        const target = c.mind?.target;
        if (target && !target.dead) s.other = target.id;
        if (task !== s.sort) {
          // The hunt became a meal, the fight a rout: say so.
          s.sort = task;
          s.caption = dramaLine(world, c, task);
        }
      } else s.until = Math.min(s.until, now + 2.5);
    }
  }

  private fresh(key: string, now: number): boolean {
    const t = this.seen.get(key);
    return t === undefined || now - t > (key[0] === "w" ? WONDER_AGAIN : AGAIN);
  }

  private choose(world: World): Shot | null {
    const now = world.time;
    const cur = this.shot;
    const out: Shot[] = [];
    const add = (
      kind: ShotKind,
      key: string,
      sort: string,
      score: number,
      x: number,
      y: number,
      r: number,
      caption: string,
      hold: [number, number],
      who = 0,
      other = 0,
    ) => {
      if (!this.fresh(key, now) || !(x >= 0 && y >= 0 && x < world.w && y < world.h)) return;
      let s = score;
      // Round the player's last cast, what happens comes first.
      if (this.cast && now - this.cast.t < 30 && Math.hypot(x - this.cast.x, y - this.cast.y) < 16) s += 30;
      if (cur) {
        // Fewer flights across the island; not two alike in a row.
        s -= Math.min(18, Math.hypot(x - cur.x, y - cur.y) / 7);
        if (cur.kind === kind && kind !== "drama") s -= 14;
        if (cur.sort === sort && kind === "life") s -= 40;
      }
      const alike = this.sorts.get(`${kind}:${sort}`);
      if (kind !== "drama" && kind !== "news" && alike !== undefined && now - alike < SORT_AGAIN) s -= 22;
      out.push({ kind, key, sort, who, other, x, y, r, caption, score: s + this.random() * 6, since: now, least: now + hold[0], until: now + hold[1] });
    };

    // 1. What is going on.
    const workers = new Map<number, Creature>();
    for (const c of world.creatures) {
      if (c.dead) continue;
      const task = c.mind?.task ?? "none";
      const kind = kindWord(c);
      if (kind === "fish" || kind === "bird") continue;
      const drama = DRAMA[task];
      if (drama !== undefined) {
        const t = c.mind?.target;
        // A villager shooing a rabbit off the fields is everyday; a bear is not.
        const small = task === "fight" && t && t.size < 0.8 ? 30 : 0;
        add("drama", `c${c.id}`, task, drama - small, c.x, c.y, 5, dramaLine(world, c, task), [6, 20], c.id, t && !t.dead ? t.id : 0);
      } else if (c.burning > 0.5) add("drama", `c${c.id}`, "fire", 66, c.x, c.y, 7, `${whoIs(world, c)} is on fire`, [4, 10], c.id);
      else if (task === "raise" || task === "build" || task === "pave") {
        const cell = c.mind!.cell;
        if (cell >= 0 && !workers.has(cell) && Math.hypot(c.x - (cell % world.w), c.y - Math.floor(cell / world.w)) < 4) workers.set(cell, c);
      } else if (LIFE[task] !== undefined && this.random() < 0.25) add("life", `c${c.id}`, task, LIFE[task], c.x, c.y, 5, lifeLine(world, c), [6, 10], c.id);
    }
    // A building going up, while someone works on it.
    for (const s of world.sites) {
      const x = (s.i % world.w) + 1;
      const y = Math.floor(s.i / world.w) + 1;
      let at: Creature | undefined;
      for (const [cell, c] of workers) if (Math.hypot((cell % world.w) - x, Math.floor(cell / world.w) - y) < 4) at = c;
      if (!at) continue;
      const name = settlementNear(world, x, y)?.name || "The village";
      add("site", `s${s.i}`, "site", 44, x, y, 7, `${name} is raising a ${kindName(s.kind)}`, [8, 14]);
    }
    for (const [cell, c] of workers) {
      if (c.mind?.task !== "pave") continue;
      add(
        "site",
        `p${Math.round(c.x / 12)}:${Math.round(c.y / 12)}`,
        "pave",
        34,
        cell % world.w,
        Math.floor(cell / world.w),
        7,
        `${whoIs(world, c)} is laying a road`,
        [5, 9],
        c.id,
      );
    }

    // 2. What just happened and left something to see.
    for (const h of world.happenings) {
      if (this.used.has(h) || now - h.t > 8 || h.weight < 2) continue;
      const c = h.who ? this.byId.get(h.who) : undefined;
      // A death is told where the body lies: two seconds of it, no more.
      const died = / died\b|was slain|was destroyed/.test(h.text);
      const score = died ? 40 : h.weight === 3 ? 58 : 40;
      const before = out.length;
      // A villager is told by name: "Mira, the guard, fought a bear".
      const line = c && c.kind === "villager" && h.text.startsWith("a villager ") ? `${whoIs(world, c)} ${h.text.slice(11)}` : capital(h.text);
      add(
        "news",
        c && !died ? `c${c.id}` : `h${Math.round(h.x / 6)}:${Math.round(h.y / 6)}:${h.text.slice(0, 24)}`,
        "news",
        score,
        c && !c.dead ? c.x : h.x,
        c && !c.dead ? c.y : h.y,
        7,
        line,
        died ? [3, 5] : [5, 8],
        c && !c.dead ? c.id : 0,
      );
      if (out.length > before) (out[out.length - 1] as Shot & { from?: Happening }).from = h;
    }

    // 3. A wonder now and then, and the wide view every few cuts.
    for (const w of world.wonders) {
      // A rock that floats is looked at where it floats now.
      const at = w.kind === "floating rock" ? floatAt(world, w, now) : w;
      add("wonder", `w${w.seed}`, "wonder", 11, at.x, at.y, Math.max(8, w.r * 1.4), capital(w.name), [6, 8]);
    }
    if (this.sinceWide >= WIDE_EVERY) {
      const v = world.settlements.length ? world.settlements[Math.floor(this.random() * world.settlements.length)] : null;
      if (v) add("wide", `v${Math.round(v.x)}:${Math.round(v.y)}`, "wide", 33, v.x, v.y, 20, v.name || "The village", [5, 7]);
      else add("wide", "island", "wide", 33, world.w / 2, world.h / 2, world.w * 0.4, world.islandName ?? "The island", [5, 7]);
    }

    let best: Shot | null = null;
    for (const s of out) if (!best || s.score > best.score) best = s;
    const from = (best as (Shot & { from?: Happening }) | null)?.from;
    if (from) this.used.add(from);
    if (this.used.size > 80) for (const h of this.used) if (!world.happenings.includes(h)) this.used.delete(h);
    return best;
  }
}
