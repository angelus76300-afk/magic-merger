import type { Creature, CreatureKind } from "./creatures";
import { C } from "./materials";
import { wrapAngle } from "./steer";
import type { World } from "./world";

// The eye view, second pass (2026-11-12, roadmap 5.1.2): a creature the player
// is goes where the thumb says, now. The owner, after playing it on a Galaxy Z
// Fold: "move: slow and laggy". Through the engine's own steering (steer.ts) a
// ridden creature turned at its kind's rate, sped up at its kind's rate, and
// walked at the pace of a creature being watched. Here its velocity follows
// the stick within about a tenth of a second, it strafes when the stick points
// sideways, and it moves at a pace made for being played (SPEEDS below).
//
// The walls are the engine's own (the creature's blocked(), passed in): the
// same deep water, cliffs, trees and houses stop it, the same one cell ledges
// are stepped, and it stays three cells inside the rim of the world. Only a
// ridden creature comes here, so nobody else's motion or random draws change.
//
// Fliers and swimmers are steered as fliers and swimmers: the stick pushed up
// is the throttle, sideways is a banked turn, and the look climbs and dives
// (a bird within its altitude band, a fish between the surface and the bed).

export interface DriveSpeeds {
  // Cells per second: with the stick pushed (walk), and at its rim (run).
  walk: number;
  run: number;
}

// Measured on islands 21, 7 and 33 over 80 seconds (the median speed of each
// kind while it moves by its own mind, cells per second): villager 2.9, deer
// 3.4 (5.9 in flight), rabbit 3.7, boar 3.0, bear 2.7, bird 4.0 to 4.3, fish
// 1.1. Played: about 2.5 times its own walk, and 4 times at a run; a wolf or
// a deer faster than a villager, a bear heavy, a bird fast, a fish quick.
const SPEEDS: Record<string, DriveSpeeds> = {
  villager: { walk: 7.2, run: 11.5 },
  deer: { walk: 8.5, run: 13.5 },
  wolf: { walk: 8.5, run: 13.5 },
  fox: { walk: 8, run: 12.5 },
  rabbit: { walk: 7.5, run: 12 },
  hare: { walk: 7.5, run: 12 },
  boar: { walk: 6.5, run: 10 },
  bear: { walk: 5.5, run: 8.5 },
  "polar bear": { walk: 5.5, run: 8.5 },
  camel: { walk: 6.5, run: 10 },
  bird: { walk: 9, run: 13 },
  parrot: { walk: 9, run: 13 },
  fish: { walk: 5, run: 7.5 },
};

// Never faster than this: a step of a tick stays under half a cell, so no wall is jumped.
export const MAX_DRIVE = 14;

const speeds = new WeakMap<CreatureKind, DriveSpeeds>();

// A spell's kind by the island kind it is named like, else from its own speed:
// about 2.2 times it walking and 3.5 times at a run, within MAX_DRIVE.
export function driveSpeeds(k: CreatureKind): DriveSpeeds {
  let s = speeds.get(k);
  if (s) return s;
  const base = SPEEDS[k.name.split("#")[0]];
  s = base ?? { walk: Math.max(2.5, Math.min(9, k.speed * 2.2)), run: Math.max(4, Math.min(MAX_DRIVE, k.speed * 3.5)) };
  speeds.set(k, s);
  return s;
}

// The stick's push (0 to 1) as a share of the walk, and a run at its rim.
export const RUN_PUSH = 0.94;
export function pushSpeed(s: DriveSpeeds, push: number, dead: number): number {
  if (push < dead) return 0;
  if (push >= RUN_PUSH) return s.run;
  // A slow creep at a light push, the full walk from three quarters out.
  const f = Math.min(1, (push - dead) / (0.75 - dead));
  return s.walk * (0.25 + 0.75 * f);
}

// How quickly the velocity follows the stick, in seconds (time constant of the
// ease): 95 percent of the way in three of them. A walker answers within a
// tenth of a second; a flier and a swimmer carry a little more of their speed.
export const TAU_WALK = 0.035;
export const TAU_FLY = 0.12;
// How fast the body turns to face where it goes, radians per second.
const BODY_TURN = 14;
// A banked turn at full stick, radians per second.
const BANK_TURN = 2.4;
// How far ahead of its centre a step is felt for a wall, in cells.
const FEEL = 0.3;

// A tree is a trunk, not a cell (the owner, 13 November, "trees blocked me too much"): the player's
// creature walks through the crown and the leaves at its foot, and is stopped only by the trunk, a
// post of this radius at the cell's middle. It slides round it along the tangent. Every other
// creature keeps the whole cell (blocked() in creatures.ts is unchanged).
export const TRUNK = 0.3;

// Is this point of a ridden walker in the crown of a tree, clear of its trunk? (creatures.ts keeps it
// out of blocked cells where it stands; a crown is not one.)
export function inCrown(world: World, x: number, y: number): boolean {
  if (!world.inside(x, y) || world.cover[world.idx(x, y)] !== C.TREE) return false;
  return Math.hypot(x - Math.round(x), y - Math.round(y)) >= TRUNK;
}

type Blocked = (world: World, x: number, y: number, c: Creature, k: CreatureKind, fx?: number, fy?: number) => boolean;

export interface Driven {
  // The velocity the player gives it, cells per second along x and y.
  vx: number;
  vy: number;
  // The stick as the thumb holds it (x right, y down, -1 to 1), its direction
  // on the ground (wx, wy, against the view) and its push.
  sx: number;
  sy: number;
  wx: number;
  wy: number;
  push: number;
  // Up or down, -1 to 1: the look's pitch, for a flier or a swimmer.
  climb: number;
  // A flier's altitude and a swimmer's depth (0 at the surface, 1 at the bed) asked for.
  alt: number;
  dive: number;
  // The side it last went round something on (1 or -1; 0 before the first).
  side: number;
}

// The altitude band of a flier: from low over the trees to well above its own height.
export function flightBand(k: CreatureKind): { low: number; high: number } {
  const a = Math.max(2, k.altitude);
  return { low: Math.min(a, 2.5), high: a + 7 };
}

// One tick of a ridden creature: its velocity eased toward the stick, then the
// step, cut short by the creature's own walls. `factor`: what the ground does
// to its pace (water, mud, a road) and its size, as for its own steps.
// Returns the step it wanted (cells) and whether a wall stopped it.
export function drive(
  world: World,
  c: Creature,
  k: CreatureKind,
  d: Driven,
  dead: number,
  factor: number,
  dt: number,
  blocked: Blocked,
): { wanted: number; jammed: boolean } {
  const s = driveSpeeds(k);
  const banks = k.flying || k.aquatic;
  let tx = 0;
  let ty = 0;
  if (banks) {
    // Throttle and bank: up is ahead along its heading, sideways turns it.
    if (d.push >= dead) {
      c.hd = wrapAngle(c.hd + Math.max(-1, Math.min(1, d.sx)) * BANK_TURN * dt);
      const ahead = Math.max(0, -d.sy);
      // A dive gathers speed, a climb costs some.
      const pitch = k.flying ? 1 - 0.35 * d.climb : 1;
      const v = (ahead >= RUN_PUSH ? s.run : s.walk * Math.min(1, ahead / 0.75)) * pitch * factor;
      tx = Math.cos(c.hd) * v;
      ty = Math.sin(c.hd) * v;
    }
  } else {
    const v = pushSpeed(s, d.push, dead) * factor;
    tx = d.wx * v;
    ty = d.wy * v;
  }
  const ease = 1 - Math.exp(-dt / (banks ? TAU_FLY : TAU_WALK));
  d.vx += (tx - d.vx) * ease;
  d.vy += (ty - d.vy) * ease;
  let speed = Math.hypot(d.vx, d.vy);
  if (speed > MAX_DRIVE) {
    d.vx *= MAX_DRIVE / speed;
    d.vy *= MAX_DRIVE / speed;
    speed = MAX_DRIVE;
  }
  if (!tx && !ty && speed < 0.3) {
    d.vx = d.vy = 0;
    speed = 0;
  }
  // The body faces where it goes; the view never waits for it (the look is the player's).
  if (!banks && speed > 0.3) {
    const turn = wrapAngle(Math.atan2(d.vy, d.vx) - c.hd);
    const most = BODY_TURN * dt;
    c.hd = wrapAngle(c.hd + Math.max(-most, Math.min(most, turn)));
  }
  c.sp = speed;
  // Up and down for a flier and a swimmer: the look's pitch, as far as its speed carries it.
  if (k.flying) {
    const band = flightBand(k);
    d.alt = Math.max(band.low, Math.min(band.high, d.alt + d.climb * Math.max(speed, s.walk * 0.3) * 0.9 * dt));
  } else if (k.aquatic) d.dive = Math.max(0, Math.min(1, d.dive - d.climb * 1.2 * dt));
  const wanted = speed * dt;
  if (!wanted) return { wanted: 0, jammed: false };
  // The step in pieces of at most a quarter cell, each felt ahead for a wall.
  // Against one it slides along it, as a player expects, instead of stopping dead.
  const rim = (x: number, y: number) => x < 3 || y < 3 || x > world.w - 4 || y > world.h - 4;
  // The trunk a point is in, as the direction from its middle (null: clear of it).
  const trunkOf = (x: number, y: number): { dx: number; dy: number } | null => {
    if (!world.inside(x, y) || world.cover[world.idx(x, y)] !== C.TREE) return null;
    const dx = x - Math.round(x);
    const dy = y - Math.round(y);
    const d = Math.hypot(dx, dy);
    return d < TRUNK ? { dx: dx / (d || 1), dy: d ? dy / d : 1 } : null;
  };
  const free = (x: number, y: number, ux: number, uy: number) => {
    const px = x + ux * FEEL;
    const py = y + uy * FEEL;
    if (rim(px, py) && !rim(c.x, c.y)) return false;
    // Its own cell never stops it (a tree grown where it stands is walked out of), as in steer.ts.
    if (Math.round(px) === Math.round(c.x) && Math.round(py) === Math.round(c.y)) return true;
    // A tree: only the trunk stops it.
    if (!banks && world.inside(px, py) && world.cover[world.idx(px, py)] === C.TREE) return trunkOf(px, py) === null;
    return !blocked(world, px, py, c, k, c.x, c.y);
  };
  const n = Math.ceil(wanted / 0.25);
  let jammed = false;
  for (let i = 0; i < n; i++) {
    const sx = (d.vx * dt) / n;
    const sy = (d.vy * dt) / n;
    const len = Math.hypot(sx, sy);
    if (!len) break;
    if (free(c.x + sx, c.y + sy, sx / len, sy / len)) {
      c.x += sx;
      c.y += sy;
      continue;
    }
    // A trunk: round it along its tangent, at the speed it was walked.
    const tr = banks ? null : trunkOf(c.x + sx + (sx / len) * FEEL, c.y + sy + (sy / len) * FEEL);
    if (tr) {
      let tx2 = -tr.dy;
      let ty2 = tr.dx;
      if (tx2 * sx + ty2 * sy < 0) {
        tx2 = -tx2;
        ty2 = -ty2;
      }
      const nx = c.x + tx2 * len;
      const ny = c.y + ty2 * len;
      if (free(nx, ny, tx2, ty2)) {
        c.x = nx;
        c.y = ny;
        continue;
      }
    }
    // Slide: the part of the step along one axis, the velocity across the wall taken away.
    if (sx && free(c.x + sx, c.y, Math.sign(sx), 0)) {
      c.x += sx;
      d.vy = 0;
      continue;
    }
    if (sy && free(c.x, c.y + sy, 0, Math.sign(sy))) {
      c.y += sy;
      d.vx = 0;
      continue;
    }
    // Head on into a trunk or a corner: round it, a little to one side, as a body glances off
    // (the frames of 12 November: a villager pushed into a bush in the woods stood still).
    // The side it went last, then the other; the speed kept, its direction not.
    let round = false;
    const side = d.side || 1;
    for (const turn of [0.45 * side, -0.45 * side, 0.9 * side, -0.9 * side]) {
      const a = Math.atan2(sy, sx) + turn;
      const rx = Math.cos(a) * len;
      const ry = Math.sin(a) * len;
      if (!free(c.x + rx, c.y + ry, Math.cos(a), Math.sin(a))) continue;
      c.x += rx;
      c.y += ry;
      d.side = Math.sign(turn);
      round = true;
      break;
    }
    if (round) continue;
    d.vx = d.vy = 0;
    jammed = true;
    break;
  }
  if (jammed) c.sp = 0;
  return { wanted, jammed };
}
