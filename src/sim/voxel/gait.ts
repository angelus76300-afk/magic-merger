import { A, type Rig } from "./rigs";

// How a creature walks and stands (4.3), as numbers the view poses figures
// with. Pure math, checked by npm test.

// 0 a walk, 1 a trot, 2 a run, from its speed against its kind's walking
// speed: walking is up to 1.1 times it, trotting up to 1.45 (a chase, a
// creature on its way somewhere urgent), anything faster a run (a flight).
export function gaitOf(speed: number, walking: number): number {
  const r = speed / Math.max(0.1, walking);
  if (r <= 1.1) return 0;
  if (r >= 1.6) return 2;
  return r < 1.3 ? (r - 1.1) / 0.2 : 1 + (r - 1.3) / 0.3;
}

// How far the stride cycle advances per cell walked: a longer stride at a
// run, so legs do not spin.
export function strideRate(gait: number, size: number): number {
  return (3.6 / Math.max(0.3, size)) * (1 - gait * 0.14);
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
