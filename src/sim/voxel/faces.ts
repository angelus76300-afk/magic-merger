import type { Rig } from "./rigs";

// Two parts of a figure whose faces lie in the same plane, facing the same
// way and overlapping, flicker: the depth buffer cannot tell which one is in
// front, so the picture swaps between them from one frame to the next (3.7).
// Found at rest, the pose a creature stands in when it does not move. Parts
// tilted by different amounts never share a plane for more than an instant.

export interface SharedFace {
  a: number;
  b: number;
  // 0 x, 1 y, 2 z; side -1 the lower face, 1 the upper.
  axis: number;
  side: number;
  // Overlapping area, in figure units squared.
  area: number;
}

const EPS = 0.0025;
const MIN_AREA = 1e-5;

interface Frame {
  key: string;
  min: [number, number, number];
  max: [number, number, number];
}

// Each part's box in the frame it is axis aligned in: the figure's own frame
// for untilted parts, or a tilt shared with others about the same point.
function frameOf(rig: Rig, n: number): Frame {
  const part = rig.parts[n];
  if (!part.rot) {
    const min: [number, number, number] = [0, 0, 0];
    const max: [number, number, number] = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      min[k] = part.p[k] + part.q[k] + part.o[k];
      max[k] = min[k] + part.s[k];
    }
    return { key: "", min, max };
  }
  const q = [0, 1, 2].map((k) => +(part.p[k] + part.q[k]).toFixed(4));
  const key = `${part.rot.map((r) => r.toFixed(4)).join(",")}@${q.join(",")}`;
  return { key, min: [part.o[0], part.o[1], part.o[2]], max: [part.o[0] + part.s[0], part.o[1] + part.s[1], part.o[2] + part.s[2]] };
}

export function sharedFaces(rig: Rig, detail = true): SharedFace[] {
  const out: SharedFace[] = [];
  const parts = rig.parts.map((p, n) => ({ n, f: frameOf(rig, n), lod: p.lod })).filter((p) => detail || p.lod === 0);
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const A = parts[i].f;
      const B = parts[j].f;
      if (A.key !== B.key) continue;
      for (let axis = 0; axis < 3; axis++) {
        const u = (axis + 1) % 3;
        const v = (axis + 2) % 3;
        const ou = Math.min(A.max[u], B.max[u]) - Math.max(A.min[u], B.min[u]);
        const ov = Math.min(A.max[v], B.max[v]) - Math.max(A.min[v], B.min[v]);
        if (ou <= 1e-4 || ov <= 1e-4 || ou * ov < MIN_AREA) continue;
        for (const side of [-1, 1]) {
          const a = side < 0 ? A.min[axis] : A.max[axis];
          const b = side < 0 ? B.min[axis] : B.max[axis];
          if (Math.abs(a - b) < EPS) out.push({ a: parts[i].n, b: parts[j].n, axis, side, area: ou * ov });
        }
      }
    }
  return out;
}

// Pulls one face of each shared pair back a little, so no two parts of a
// figure share a face: the smaller part gives way, by about a hundredth of
// the creature's size (a step nobody sees, wide enough for the depth
// buffer), to the first depth where it meets no other face. A face too thin
// to pull back pushes out instead. Run once per rig.
const GAP = 0.01;

function meets(rig: Rig, n: number, axis: number, side: number): boolean {
  const A = frameOf(rig, n);
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  const a = side < 0 ? A.min[axis] : A.max[axis];
  for (let m = 0; m < rig.parts.length; m++) {
    if (m === n) continue;
    const B = frameOf(rig, m);
    if (B.key !== A.key) continue;
    const ou = Math.min(A.max[u], B.max[u]) - Math.max(A.min[u], B.min[u]);
    const ov = Math.min(A.max[v], B.max[v]) - Math.max(A.min[v], B.min[v]);
    if (ou <= 1e-4 || ov <= 1e-4 || ou * ov < MIN_AREA) continue;
    if (Math.abs(a - (side < 0 ? B.min[axis] : B.max[axis])) < EPS) return true;
  }
  return false;
}

export function separate(rig: Rig): number {
  let moved = 0;
  for (let pass = 0; pass < 6; pass++) {
    const shared = sharedFaces(rig);
    if (!shared.length) break;
    for (const f of shared) {
      const pa = rig.parts[f.a];
      const pb = rig.parts[f.b];
      const va = pa.s[0] * pa.s[1] * pa.s[2];
      const vb = pb.s[0] * pb.s[1] * pb.s[2];
      const n = va <= vb ? f.a : f.b;
      const ax = f.axis;
      if (!meets(rig, n, ax, f.side)) continue;
      const part = rig.parts[n];
      const o0 = part.o[ax];
      const s0 = part.s[ax];
      for (const k of [1, 1.6, 2.2, 2.8, 3.4, 4]) {
        const d = GAP * k;
        const inward = s0 > d * 2.5;
        if (f.side < 0) {
          part.o[ax] = o0 + (inward ? d : -d);
          part.s[ax] = s0 + (inward ? -d : d);
        } else part.s[ax] = s0 + (inward ? -d : d);
        if (!meets(rig, n, ax, f.side)) break;
      }
      moved++;
    }
  }
  return moved;
}
