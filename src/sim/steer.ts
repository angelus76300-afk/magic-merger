import type { Creature, CreatureKind } from "./creatures";
import { MAX_STEPS, Mobility, pathsOf } from "./paths";
import type { World } from "./world";

// How every creature moves (4.3): villagers, the island's animals and the
// creatures of spells alike. The mind says where to go and how fast
// (creatures.ts, goals.ts, social.ts); this turns it into a step with a body
// behind it. A creature has a heading and a speed: it speeds up and slows
// down at its kind's rate, turns at its kind's rate (faster when nearly
// still), turns on the spot before walking off the other way, slows down as
// it arrives, keeps a little apart from its own kind, and looks ahead for
// what is in its way instead of bumping into it. Long trips follow a flow
// field shared by everyone going the same way (paths.ts).
//
// Before 4.3 a creature moved by its speed in the direction asked, every
// tick, and stepped sideways for a tick when the way ahead was blocked: any
// change of mind was an instant about turn, and a deer by a tree shook.

export interface Handling {
  // Radians per second at speed, and a little more than twice that when nearly still.
  turn: number;
  // Cells per second per second; braking is twice as quick.
  accel: number;
}

// The island's animals and the base kinds, by feel: a rabbit darts, a bear
// lumbers, a bird banks wide.
const HANDLING: Record<string, Handling> = {
  villager: { turn: 6, accel: 9 },
  deer: { turn: 5, accel: 10 },
  rabbit: { turn: 7, accel: 16 },
  wolf: { turn: 5.5, accel: 11 },
  boar: { turn: 3.6, accel: 7 },
  bear: { turn: 3, accel: 5 },
  bird: { turn: 3.2, accel: 7 },
  fish: { turn: 3.5, accel: 5 },
  beast: { turn: 4.5, accel: 9 },
  spirit: { turn: 3.5, accel: 6 },
  golem: { turn: 2.2, accel: 3.5 },
  risen: { turn: 4, accel: 6 },
};
const handlings = new WeakMap<CreatureKind, Handling>();

// A spell's kind: by the island kind it is named like, else by its size and
// speed (a big creature turns slowly, a fast one gets going quickly).
export function handlingOf(k: CreatureKind): Handling {
  let h = handlings.get(k);
  if (h) return h;
  const base = HANDLING[k.name.split("#")[0]];
  if (base) h = base;
  else {
    const big = Math.sqrt(Math.max(0.3, k.radius) / 0.6);
    h = { turn: Math.max(1.6, Math.min(7, 5.5 / big)) * (k.flying ? 0.7 : 1), accel: Math.max(2.5, Math.min(16, (k.speed * 2.4) / big)) };
  }
  handlings.set(k, h);
  return h;
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

type Blocked = (world: World, x: number, y: number, c: Creature, k: CreatureKind, fx?: number, fy?: number) => boolean;

const AIM = { x: 0, y: 0 };
// Where the way ahead is clear: turns to the side it took last (+1) or the
// other (-1), in this order, so it keeps going round an obstacle the way it
// started instead of trying left and right in turn.
const DODGE: [number, number][] = [
  [1, 0.45],
  [1, 0.9],
  [1, 1.35],
  [-1, 0.45],
  [-1, 0.9],
  [-1, 1.35],
  [1, 1.9],
  [-1, 1.9],
];
// Trips longer than this many cells follow a flow field.
const LONG_TRIP = 12;

export interface Stepped {
  // The step it meant to take, in cells, and whether it found no way at all.
  wanted: number;
  jammed: boolean;
}
const OUT: Stepped = { wanted: 0, jammed: false };

// One tick of moving toward (tx, ty) at vmax cells per second (0: stop).
// arrive: slow down at the point (a destination), rather than run through it
// (a chase, a flight). chase: running after something, which takes the
// flow field once the straight way to it is blocked (a flight never does:
// it goes where it can, now). (gx, gy): where the trip ends, when the point is only
// the way there (a bend in a walk, a place in a flock); the flow field is
// the destination's.
export function steer(
  world: World,
  c: Creature,
  k: CreatureKind,
  tx: number,
  ty: number,
  vmax: number,
  arrive: boolean,
  chase: boolean,
  dt: number,
  blocked: Blocked,
  gx = tx,
  gy = ty,
): Stepped {
  const h = handlingOf(k);
  let dx = tx - c.x;
  let dy = ty - c.y;
  const dist = Math.hypot(dx, dy);
  let ds = 0;
  let want = c.hd;
  let jammed = false;
  const air = k.flying || c.levitate > 0 || c.z > 1.5;
  let onField = false;
  if (vmax > 0 && dist > 0.05) {
    // A long trip follows its destination's flow field once it is ready.
    // So does a short one once the straight way turned out to be blocked.
    const trip = Math.hypot(gx - c.x, gy - c.y);
    // A short trip whose straight line is blocked (a tree, a pond, a step
    // too high) takes the field from the start, instead of walking into the
    // dead end and turning back: looked at twice a second.
    const routed = arrive || chase;
    if (routed && !air && trip > 2.5 && (trip <= LONG_TRIP || chase) && (world.tick + c.id) % 15 === 0 && !lineOpen(world, c, k, gx, gy, blocked))
      c.data.detour = world.time + (chase ? 2 : 4);
    const detour = world.time < ((c.data.detour as number | undefined) ?? 0);
    if (routed && !air && trip > 2.5 && ((arrive && trip > LONG_TRIP) || detour)) {
      const paths = pathsOf(world);
      const f = paths.toward(world, k.aquatic ? Mobility.WATER : k.swims ? Mobility.SWIM : Mobility.WALK, gx, gy, !chase && trip <= LONG_TRIP * 1.5);
      if (f && !paths.aim(world, f, c.x, c.y, AIM)) {
        // No way there from here: the mind is told (goals.ts drops the task
        // and steps out of the hollow, instead of pacing along the wall).
        // Further than a field reaches, it only walks on toward it.
        if (trip < MAX_STEPS * 0.7) c.data.noWay = world.time;
      } else if (f && (AIM.x !== Math.round(c.x) || AIM.y !== Math.round(c.y))) {
        dx = AIM.x - c.x;
        dy = AIM.y - c.y;
        onField = true;
      }
    }
    want = Math.atan2(dy, dx);
    ds = vmax;
    // Arriving: slow enough to stop at the point.
    if (arrive) {
      const slow = 1 + (c.sp * c.sp) / (2 * h.accel);
      if (dist < slow) ds = vmax * Math.max(0.2, Math.min(1, (dist - 0.15) / slow));
    }
    // A little apart from its own kind (herds, flocks, a crowd of villagers).
    // Only ever sideways: a push straight back would turn it round toward
    // whoever stands in its way (a villager meeting another in a lane).
    const sep = separation(world, c, k);
    if (sep) {
      const ux = Math.cos(want);
      const uy = Math.sin(want);
      const back = Math.min(0, sep.x * ux + sep.y * uy);
      const px = (sep.x - back * ux) * 0.6;
      const py = (sep.y - back * uy) * 0.6;
      want = Math.atan2(uy + py, ux + px);
    }
    // What is in the way, seen ahead: a turn to the side that is open, the
    // same side as last time while it lasts, so it does not dither.
    // On a flow field the way to the aim is known to be open in a straight
    // line (paths.ts): no feelers, which near a corner see the tree on the
    // far side of a cell boundary and make it dither.
    if (!air && !onField) {
      const reach = 0.8 + c.sp * 0.35;
      if (!clear(world, c, k, want, reach, blocked)) {
        let side = (c.data.side as number | undefined) ?? (c.id & 1 ? 1 : -1);
        if (world.time > ((c.data.sideUntil as number | undefined) ?? 0)) side = c.id & 1 ? 1 : -1;
        let found = false;
        for (const [way, off] of DODGE) {
          const s = way * side;
          if (clear(world, c, k, want + s * off, reach, blocked)) {
            want += s * off;
            c.data.side = s;
            c.data.sideUntil = world.time + 1.5;
            found = true;
            break;
          }
        }
        // Going somewhere: the way round is the flow field's from now on.
        if (arrive) c.data.detour = world.time + 4;
        else if (chase) c.data.detour = world.time + 2;
        if (!found) {
          jammed = true;
          ds = 0;
        }
      }
    }
  }
  // Turning: a creature turns on the spot before walking off the other way,
  // and slows down in a sharp bend.
  const delta = wrapAngle(want - c.hd);
  const turning = Math.abs(delta);
  if (turning > 1.75) ds = Math.min(ds, vmax * 0.08);
  else if (ds > 0 && turning > 0.3) {
    // Close to where it is going and facing away: slow right down, or it
    // circles its goal like a moth round a lamp.
    ds *= arrive && dist < 3 ? Math.max(0.15, Math.cos(turning)) : 0.45 + 0.55 * Math.cos(turning);
  }
  const omega = h.turn * (c.sp < vmax * 0.3 || c.sp < 0.6 ? 2.2 : 1) * dt;
  c.hd = wrapAngle(c.hd + Math.max(-omega, Math.min(omega, delta)));
  const dv = ds - c.sp;
  c.sp += dv > 0 ? Math.min(dv, h.accel * dt) : Math.max(dv, -h.accel * 2 * dt);
  if (c.sp < 0.02 && ds === 0) c.sp = 0;
  const step = c.sp * dt;
  OUT.wanted = jammed ? vmax * dt : step;
  OUT.jammed = jammed;
  if (step <= 0) return OUT;
  // The step, or failing that the same step a little to the side it wants
  // to turn to, then the other: past a corner it brushed (a creature on the
  // line between two cells, a tree on the far side of it).
  const side = delta >= 0 ? 1 : -1;
  const cx = Math.round(c.x);
  const cy = Math.round(c.y);
  for (const turn of GRAZE) {
    const a = c.hd + turn * side;
    const sx = Math.cos(a) * step;
    const sy = Math.sin(a) * step;
    const nx = c.x + sx * 2.5;
    const ny = c.y + sy * 2.5;
    if ((Math.round(nx) !== cx || Math.round(ny) !== cy) && blocked(world, nx, ny, c, k)) continue;
    c.x += sx;
    c.y += sy;
    if (turn) c.sp *= 0.85;
    return OUT;
  }
  c.sp *= 0.3;
  OUT.jammed = true;
  return OUT;
}

const GRAZE = [0, 0.5, 1, -0.5];

// Can it walk straight to (x, y)? Sampled every half cell, a little either
// side of the line, as the creature's own feelers would see it.
function lineOpen(world: World, c: Creature, k: CreatureKind, x: number, y: number, blocked: Blocked): boolean {
  const len = Math.hypot(x - c.x, y - c.y);
  const n = Math.ceil(len / 0.5);
  const sx = (-(y - c.y) / len) * 0.3;
  const sy = ((x - c.x) / len) * 0.3;
  let fx = c.x;
  let fy = c.y;
  for (let i = 1; i < n; i++) {
    const px = c.x + ((x - c.x) * i) / n;
    const py = c.y + ((y - c.y) * i) / n;
    if (blocked(world, px, py, c, k, fx, fy) || blocked(world, px + sx, py + sy, c, k, fx, fy) || blocked(world, px - sx, py - sy, c, k, fx, fy)) return false;
    fx = px;
    fy = py;
  }
  return true;
}

// A feeler: the way along a, up to reach, in steps of half a cell, each step
// climbed from the one before (a slope is walkable, a cliff is not).
function clear(world: World, c: Creature, k: CreatureKind, a: number, reach: number, blocked: Blocked): boolean {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  let fx = c.x;
  let fy = c.y;
  const cx = Math.round(c.x);
  const cy = Math.round(c.y);
  for (let d = 0.55; ; d = Math.min(reach, d + 0.5)) {
    const x = c.x + ux * d;
    const y = c.y + uy * d;
    // Its own cell never stops it: a tree grown where it stands is walked out of.
    if ((Math.round(x) !== cx || Math.round(y) !== cy) && blocked(world, x, y, c, k, fx, fy)) return false;
    if (d >= reach) return true;
    fx = x;
    fy = y;
  }
}

// A push away from others of its kind that stand too close, made every third
// tick and kept in between.
const SEP = { x: 0, y: 0 };
function separation(world: World, c: Creature, k: CreatureKind): { x: number; y: number } | null {
  if ((world.tick + c.id) % 3 !== 0) {
    const s = c.data.sep as [number, number] | undefined;
    if (!s) return null;
    SEP.x = s[0];
    SEP.y = s[1];
    return SEP;
  }
  const r = k.radius * c.size * 2.6 + 0.4;
  let px = 0;
  let py = 0;
  for (const o of world.crowd.near(world, c.x, c.y, r)) {
    if (o === c || o.kind !== c.kind) continue;
    const dx = c.x - o.x;
    const dy = c.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d >= r || d < 1e-4) continue;
    const push = (r - d) / r;
    px += (dx / d) * push;
    py += (dy / d) * push;
  }
  if (!px && !py) {
    c.data.sep = undefined;
    return null;
  }
  const n = Math.hypot(px, py);
  const s = Math.min(1.2, n) / n;
  c.data.sep = [px * s, py * s];
  SEP.x = px * s;
  SEP.y = py * s;
  return SEP;
}
