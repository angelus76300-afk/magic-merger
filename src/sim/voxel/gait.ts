import { A, type Rig } from "./rigs";

// How a creature walks and stands (4.3), as numbers the view poses figures
// with. Pure math, checked by npm test.

// 0 a walk, 1 a trot, 2 a run, from its speed against its kind's walking
// speed: walking is up to 1.1 times it, trotting up to 1.45 (a chase, a
// creature on its way somewhere urgent), anything faster a run (a flight).
// And from its speed in its own body heights a second (`body`, scene units
// tall; 16 November, the owner: "speed: similar to minecraft running"): up to
// WALK_BH a walk, a run from RUN_BH, so a villager going about its day at 3
// cells a second (about 1.9 of its heights) runs, rather than walking fast.
// `most`: the most that rule gives; 1 for four legs, so a deer about its day
// trots, and runs only when it flees (its own speed says so).
export const WALK_BH = 1.1;
export const RUN_BH = 2;
export function gaitOf(speed: number, walking: number, body = 0, most = 2): number {
  const r = speed / Math.max(0.1, walking);
  const own = r <= 1.1 ? 0 : r >= 1.6 ? 2 : r < 1.3 ? (r - 1.1) / 0.2 : 1 + (r - 1.3) / 0.3;
  if (body <= 0.05) return own;
  const bh = speed / body;
  return Math.max(own, Math.max(0, Math.min(most, ((bh - WALK_BH) / (RUN_BH - WALK_BH)) * 2)));
}

// How far a leg swings either way at a gait, radians (figures.ts: 0.6 of the
// swing, which grows by 0.3 a gait from 0.8).
export function legSwing(gait: number): number {
  return 0.6 * (0.8 + gait * 0.3);
}

// The share of a stride a foot is on the ground: most of it at a walk, under half at a run (both
// feet off the ground for a moment).
export function duty(gait: number): number {
  return 0.62 - 0.1 * gait;
}

// Where a leg is in its stride, from 1 (forward) to -1 (back), at `phase` radians of the cycle: on
// the ground (the first `d` of the cycle) it moves back at an even pace, then swings forward in an
// ease. A sine (the walk before 16 November) moves back fast in the middle and slowly at the ends,
// and no pace of the cycle keeps such a foot planted.
export function stride(phase: number, d: number): number {
  const u = (((phase / (2 * Math.PI)) % 1) + 1) % 1;
  if (u < d) return 1 - (2 * u) / d;
  return -Math.cos((Math.PI * (u - d)) / (1 - d));
}

// The leg's angle (radians) at `phase` for a swing of `swing` either way: the foot's offset under
// the hip, leg sin(angle), follows stride exactly, so the foot on the ground moves back evenly.
export function legAngle(phase: number, swing: number, d: number): number {
  return Math.asin(Math.max(-1, Math.min(1, stride(phase, d) * Math.sin(swing))));
}

// How far the stride cycle advances per cell walked (radians). With `leg`, the leg's length in
// scene units (hip to sole), the steps match the ground (16 November): a foot on the ground for
// duty of the cycle moves back 2 leg sin(swing), as fast as the body goes forward, so it does not
// slide. Without, as before: a rate by size, a little longer at a run.
// Short legs would blur: at most MAX_STRIDES strides a second (`speed`, cells a second); past it a
// little legged creature (a rabbit, a lizard) slides a little, too small to see.
export const MAX_STRIDES = 7;
export function strideRate(gait: number, size: number, leg = 0, moving = 1, speed = 0): number {
  if (leg <= 0.05) return (3.6 / Math.max(0.3, size)) * (1 - gait * 0.14);
  const swing = Math.max(0.15, legSwing(gait) * moving);
  const rate = (Math.PI * duty(gait)) / (leg * Math.sin(swing));
  return speed > 0 ? Math.min(rate, (2 * Math.PI * MAX_STRIDES) / speed) : rate;
}

// The share of the ground speed a planted foot slides by, averaged over its time on the ground
// (while it moves back under the body), for a creature at `speed` cells a second whose cycle
// advances `rate` radians a cell, a leg `leg` long swinging `swing` radians either way: by stride
// with duty `d`, or with no `d` by a sine, as the figures moved before 16 November. 0: planted.
export function footSlide(speed: number, rate: number, leg: number, swing: number, d?: number): number {
  const steps = 4000;
  const period = (2 * Math.PI) / (rate * speed);
  const dt = period / steps;
  const at = (phase: number) => leg * Math.sin(d === undefined ? swing * Math.sin(phase) : legAngle(phase, swing, d));
  let slid = 0;
  let time = 0;
  let prev = at(0);
  for (let k = 1; k <= steps; k++) {
    const off = at(rate * speed * k * dt);
    const back = off - prev;
    if (back < 0) {
      slid += Math.abs(speed * dt + back);
      time += dt;
    }
    prev = off;
  }
  return time > 0 ? slid / time / speed : 0;
}

// How high the hips stand, in units of the creature's size: what a body
// lying down sinks by (its legs folded to a quarter).
const hips = new WeakMap<Rig, number>();
export function hipHeight(rig: Rig): number {
  let h = hips.get(rig);
  if (h !== undefined) return h;
  h = 0;
  for (const p of rig.parts) if (p.anim === A.LEG_A || p.anim === A.LEG_B) h = Math.max(h, p.p[1]);
  hips.set(rig, h);
  return h;
}

// Looking around while it stands: a slow turn of the head to one side and
// the other, with pauses, never the same for two creatures.
export function lookAround(time: number, id: number): number {
  const t = time * 0.55 + id * 1.7;
  const s = Math.sin(t) + 0.5 * Math.sin(t * 2.3 + 1);
  return Math.max(-0.7, Math.min(0.7, s * 0.55));
}
