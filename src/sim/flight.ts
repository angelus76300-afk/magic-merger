import { C } from "./materials";
import type { Creature } from "./creatures";
import type { World } from "./world";
import { meter } from "./motion";

// Running away (4.3). Before, fear switched on and off at one distance: a
// deer saw a wolf at 8 cells, ran to 8.1, forgot it, turned back to the bush
// it wanted, saw the wolf again, about every second. Now fear has memory and
// hysteresis: an animal is alarmed at its sense, remembers where the danger
// was, and calms down only once it is past 1.7 times that distance and has
// been out of sight for CALM seconds. It runs for cover (trees, for those
// that hide), toward its herd, and out of sight, along a way it chooses once
// a second or so, not every tick, preferring to keep going the way it goes.
// A herd runs together: the first to see the danger leads, the others take
// the alarm from it and run behind it.

export const CALM = 3;
export const KEEP = 1.7;

export interface Alarm {
  // Where the danger was last seen, and what it was (null: a place).
  x: number;
  y: number;
  who: Creature | null;
  // The distance it was noticed at.
  r: number;
  seen: number;
  since: number;
  // Where it is running to, and when that was chosen.
  wx: number;
  wy: number;
  picked: number;
  // Who leads the flight: itself, or the herd mate it runs behind.
  leader: number;
}

// Kinds that run as one: deer and boars keep with their herd.
const HERDS = new Set(["deer", "boar"]);
// Kinds that run for the trees.
const HIDES = new Set(["deer", "rabbit", "boar"]);

export function alarmOf(c: Creature): Alarm | undefined {
  return c.data.alarm as Alarm | undefined;
}

// Something dangerous seen at (x, y), noticed within r: alarmed, or kept so.
export function alarm(world: World, c: Creature, who: Creature | null, x: number, y: number, r: number): void {
  const a = alarmOf(c);
  if (a) {
    a.seen = world.time;
    a.x = x;
    a.y = y;
    if (who) a.who = who;
    a.r = Math.max(a.r, r);
    return;
  }
  c.data.alarm = fresh(world, who, x, y, r, c.id);
  // Seeing a danger and bolting is a turn with a reason, not a flip-flop.
  if (meter) meter.done(c, "alarm");
  // The herd takes the alarm and runs behind the one who saw it.
  if (!HERDS.has(c.kind) || c.mind?.tame) return;
  for (const o of world.crowd.near(world, c.x, c.y, 10)) {
    if (o === c || o.kind !== c.kind || o.dead || o.data.alarm || o.mind?.tame) continue;
    if (Math.hypot(o.x - c.x, o.y - c.y) > 10) continue;
    o.data.alarm = fresh(world, who, x, y, r, c.id);
    if (meter) meter.done(o, "alarm");
  }
}

function fresh(world: World, who: Creature | null, x: number, y: number, r: number, leader: number): Alarm {
  return { x, y, who, r, seen: world.time, since: world.time, wx: NaN, wy: NaN, picked: -1, leader };
}

export function calmDown(c: Creature): void {
  c.data.alarm = undefined;
}

const OUT = { x: 0, y: 0 };

// Where an alarmed creature runs this tick, or null once it is calm again.
export function fleeing(world: World, c: Creature): { x: number; y: number } | null {
  const a = alarmOf(c);
  if (!a) return null;
  const now = world.time;
  if (a.who) {
    if (a.who.dead) a.who = null;
    else if (Math.hypot(a.who.x - c.x, a.who.y - c.y) < a.r * KEEP) {
      // Still in sight.
      a.seen = now;
      a.x = a.who.x;
      a.y = a.who.y;
    }
  }
  const away = Math.hypot(c.x - a.x, c.y - a.y);
  if (now - a.seen > CALM && away > a.r * KEEP * (a.who ? 1 : 0.7)) {
    calmDown(c);
    // A walk it was on before is forgotten: it was likely toward the danger.
    const m = c.mind;
    if (m && (m.task === "roam" || m.task === "herd")) {
      m.task = "none";
      m.target = null;
      m.think = 0;
    }
    return null;
  }
  // Behind the herd's leader, unless the leader is nearer the danger than it is.
  if (a.leader !== c.id) {
    const lead = leaderOf(world, c, a.leader);
    const la = lead ? alarmOf(lead) : undefined;
    if (lead && la && Math.hypot(lead.x - a.x, lead.y - a.y) > away - 1.5) {
      const back = 1.6 + (c.id % 3) * 0.7;
      const side = (((c.id >> 2) % 3) - 1) * 1.1;
      const ux = Math.cos(lead.hd);
      const uy = Math.sin(lead.hd);
      OUT.x = lead.x - ux * back - uy * side;
      OUT.y = lead.y - uy * back + ux * side;
      // Close behind: run on the leader's way rather than into its back.
      if (Math.hypot(OUT.x - c.x, OUT.y - c.y) < 1.2 && la.wx === la.wx) {
        OUT.x = la.wx;
        OUT.y = la.wy;
      }
      return OUT;
    }
    a.leader = c.id;
  }
  const reached = a.wx === a.wx && Math.hypot(a.wx - c.x, a.wy - c.y) < 1.6;
  // A new way when it got there, every so often, or when the danger now lies ahead.
  const ahead = a.wx === a.wx && (a.wx - c.x) * (a.x - c.x) + (a.wy - c.y) * (a.y - c.y) > 0 && Math.hypot(a.x - c.x, a.y - c.y) < a.r;
  if (reached && meter) meter.done(c, "flight point");
  // Its way turned out blocked (steer.ts could not get through): another one.
  const jammed = ((c.data.stuck as number | undefined) ?? 0) > 0.4 && now - a.picked > 0.4;
  // Every so often it looks again, but only ahead of it: a flight does not
  // turn round unless it must (reached a dead end, blocked, danger ahead).
  if (a.wx !== a.wx || reached || ahead || jammed) pick(world, c, a, jammed, false);
  else if (now - a.picked > 2.5) pick(world, c, a, false, true);
  OUT.x = a.wx;
  OUT.y = a.wy;
  return OUT;
}

function leaderOf(world: World, c: Creature, id: number): Creature | null {
  for (const o of world.crowd.near(world, c.x, c.y, 14)) if (o.id === id && !o.dead) return o;
  return null;
}

// Twelve ways out, each walked a few cells until a wall: the one that ends
// furthest from the danger, with points for keeping its heading, for trees
// at the end (for those that hide) and for the herd lying that way.
function pick(world: World, c: Creature, a: Alarm, jammed = false, onward = false): void {
  a.picked = world.time;
  const here = world.level(world.idx(Math.max(0, Math.min(world.w - 1, c.x)), Math.max(0, Math.min(world.h - 1, c.y))));
  const before = Math.hypot(c.x - a.x, c.y - a.y);
  const hides = HIDES.has(c.kind);
  // The herd's middle, if it has one around.
  let hx = 0;
  let hy = 0;
  let hn = 0;
  if (HERDS.has(c.kind))
    for (const o of world.crowd.near(world, c.x, c.y, 12)) {
      if (o === c || o.kind !== c.kind) continue;
      hx += o.x;
      hy += o.y;
      hn++;
    }
  if (hn) {
    hx = hx / hn - c.x;
    hy = hy / hn - c.y;
    const n = Math.hypot(hx, hy) || 1;
    hx /= n;
    hy /= n;
  }
  const moving = c.sp > 0.5;
  let best = -Infinity;
  let bx = c.x + (c.x - a.x);
  let by = c.y + (c.y - a.y);
  for (let k = 0; k < 12; k++) {
    const ang = (k / 12) * Math.PI * 2;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    if (onward && moving && Math.cos(ang - c.hd) < -0.2) continue;
    let x = c.x;
    let y = c.y;
    let ok = 0;
    let level = here;
    // Short steps, so a single tree in the way is seen, not stepped over.
    for (let s = 1; s <= 9; s++) {
      const nx = c.x + ux * s * 0.8;
      const ny = c.y + uy * s * 0.8;
      if (nx < 1 || ny < 1 || nx > world.w - 2 || ny > world.h - 2) break;
      const i = world.idx(nx, ny);
      if (world.depth[i] > 1 || world.level(i) - level > 1.6 || world.materials.get("cover", world.cover[i]).solid || world.fire[i] > 0.15) break;
      level = world.level(i);
      x = nx;
      y = ny;
      ok = s;
    }
    if (!ok) continue;
    const gain = Math.hypot(x - a.x, y - a.y) - before;
    let score = gain + ok * 0.15;
    if (jammed) score -= Math.max(0, Math.cos(ang - c.hd)) * 4;
    else if (moving) score += Math.cos(ang - c.hd) * 2.2;
    if (hn) score += (ux * hx + uy * hy) * 1.5;
    if (hides && treesBy(world, x, y)) score += 2.5;
    if (score > best) {
      best = score;
      bx = x;
      by = y;
    }
  }
  a.wx = bx;
  a.wy = by;
}

function treesBy(world: World, x: number, y: number): boolean {
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let oy = -2; oy <= 2; oy += 2)
    for (let ox = -2; ox <= 2; ox += 2) {
      const nx = cx + ox;
      const ny = cy + oy;
      if (nx >= 0 && ny >= 0 && nx < world.w && ny < world.h && world.cover[ny * world.w + nx] === C.TREE) return true;
    }
  return false;
}
