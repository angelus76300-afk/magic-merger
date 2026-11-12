import { Rng } from "../noise";
import type { TreeStyle } from "../ecology";
import { unplane } from "./flora";
import type { Box } from "./models";

// The island seen from the ground (2026-11-12): trees were modelled for the sky, a few big boxes
// that read as a tree from above and as a stack of flat slabs from a creature's eyes. Near the eye
// (view.ts, within NEAR_CELLS in the eye view only) each tree is drawn with a richer model in its
// place, with the same place, lean and tint: each big crown box notched at its corners and stepped
// under, so it reads round; leaf clusters that break its edges, lighter at the top where the sun
// comes through, darker clumps hanging under it; a branch or two under the crown and roots that
// flare at the foot. From the sky nothing changes and nothing costs more.

export const NEAR_CELLS = 12;

const B = (x: number, y: number, z: number, w: number, h: number, d: number, color: number): Box => ({ x, y, z, w, h, d, color });

// A color times k, then mixed toward `to` by t.
function tone(color: number, k: number, to = 0, t = 0): number {
  const ch = (s: number) => {
    const v = ((color >> s) & 255) * k;
    return Math.max(0, Math.min(255, Math.round(v + (((to >> s) & 255) - v) * t)));
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

// Leaves the sun shines through: lighter and a little yellower.
const SUNLIT = 0xf4f0a0;

interface Parts {
  trunk: Box | null;
  leaves: Box[];
  // The underside of the crown, in model units.
  under: number;
}

function partsOf(boxes: Box[]): Parts {
  const slender = (b: Box) => b.w <= 0.3 && b.d <= 0.3 && b.h >= Math.max(b.w, b.d) * 1.5;
  let trunk: Box | null = null;
  for (const b of boxes) if (slender(b) && b.y < 0.35 && (!trunk || b.h > trunk.h)) trunk = b;
  const leaves = boxes.filter((b) => !slender(b) && Math.max(b.w, b.d) >= 0.3 && b.y >= 0.1 && b !== trunk);
  const under = leaves.length ? Math.min(...leaves.map((b) => b.y)) : trunk ? trunk.y + trunk.h : 1;
  return { trunk, leaves, under };
}

// The eye view, second pass: a tree far from the eye (past FAR_CELLS, inside the mist) as two
// boxes: its trunk, and one box round its whole crown in the crown's own colour (weighed by each
// leaf box's size). About 22 triangles where a jungle tree has 70, and the same shape at that range.
export const FAR_CELLS = 30;
export function farTreeModel(boxes: Box[]): Box[] {
  const { trunk, leaves } = partsOf(boxes);
  if (!leaves.length) return boxes;
  const x0 = Math.min(...leaves.map((b) => b.x));
  const y0 = Math.min(...leaves.map((b) => b.y));
  const z0 = Math.min(...leaves.map((b) => b.z));
  const x1 = Math.max(...leaves.map((b) => b.x + b.w));
  const y1 = Math.max(...leaves.map((b) => b.y + b.h));
  const z1 = Math.max(...leaves.map((b) => b.z + b.d));
  let r = 0;
  let g = 0;
  let bl = 0;
  let total = 0;
  for (const b of leaves) {
    const v = b.w * b.h * b.d;
    r += ((b.color >> 16) & 255) * v;
    g += ((b.color >> 8) & 255) * v;
    bl += (b.color & 255) * v;
    total += v;
  }
  const color = (Math.round(r / total) << 16) | (Math.round(g / total) << 8) | Math.round(bl / total);
  // The crown a little inside its bounds, as the boxes leave its corners open.
  const ix = (x1 - x0) * 0.08;
  const iz = (z1 - z0) * 0.08;
  const crown = B(x0 + ix, y0, z0 + iz, x1 - x0 - ix * 2, y1 - y0, z1 - z0 - iz * 2, color);
  return trunk ? [B(trunk.x, trunk.y, trunk.z, trunk.w, Math.max(0.05, y0 - trunk.y + 0.05), trunk.d, trunk.color), crown] : [crown];
}

// A crown box drawn round: two crossed boxes, each narrower one way, so its corners are notched
// and its underside steps up toward the rim, and a smaller cap on top, lit.
function rounded(L: Box): Box[] {
  const ix = L.w * 0.15;
  const iz = L.d * 0.15;
  const lift = Math.min(0.1, L.h * 0.14);
  const cap = Math.min(0.12, L.h * 0.25);
  return [
    B(L.x + ix, L.y, L.z, L.w - ix * 2, L.h, L.d, L.color),
    B(L.x, L.y + lift, L.z + iz, L.w, L.h - lift * 1.6, L.d - iz * 2, tone(L.color, 0.95)),
    B(L.x + L.w * 0.24, L.y + L.h - 0.02, L.z + L.d * 0.24, L.w * 0.52, cap, L.d * 0.52, tone(L.color, 1.06, SUNLIT, 0.12)),
  ];
}

// Clusters of leaves on a crown box: some out of its sides, a bump or two on top lit by the sun,
// and under the lowest, darker clumps hanging.
function dressCrown(out: Box[], rng: Rng, L: Box, lowest: boolean, rim: number, flat = false): void {
  const s0 = Math.max(0.1, Math.min(0.3, Math.min(L.w, L.d) * 0.3));
  for (let k = 0; k < rim; k++) {
    const side = (k + Math.floor(rng.next() * 4)) % 4;
    const s = s0 * (0.75 + rng.next() * 0.5);
    const hs = flat ? Math.min(L.h * 0.9, s * 0.6) : Math.min(L.h * 0.75, s * (0.8 + rng.next() * 0.5));
    const up = rng.next();
    const y = L.y + (L.h - hs) * (flat ? 0.5 : 0.1 + up * 0.95);
    // Off the notched corners (rounded below), so none hangs in the air.
    const t = 0.22 + rng.next() * 0.56;
    const out1 = s * (0.35 + rng.next() * 0.25);
    let x: number;
    let z: number;
    if (side === 0) [x, z] = [L.x - out1, L.z + (L.d - s) * t];
    else if (side === 1) [x, z] = [L.x + L.w - s + out1, L.z + (L.d - s) * t];
    else if (side === 2) [x, z] = [L.x + (L.w - s) * t, L.z - out1];
    else [x, z] = [L.x + (L.w - s) * t, L.z + L.d - s + out1];
    // High on the crown, lit through; low, in its own shade.
    const color = up > 0.6 ? tone(L.color, 1.08, SUNLIT, 0.22) : up < 0.3 ? tone(L.color, 0.8) : tone(L.color, 0.95 + rng.next() * 0.1);
    out.push(B(x, y, z, s, hs, s * (0.8 + rng.next() * 0.4), color));
  }
  if (!flat && rim > 0) {
    const s = s0 * 1.1;
    const bx = L.x + (L.w - s) * (0.2 + rng.next() * 0.6);
    const bz = L.z + (L.d - s) * (0.2 + rng.next() * 0.6);
    out.push(B(bx, L.y + L.h - 0.04, bz, s, 0.1 + rng.next() * 0.06, s * 0.9, tone(L.color, 1.12, SUNLIT, 0.3)));
  }
  if (lowest)
    for (let k = 0; k < 3; k++) {
      const s = Math.min(L.w, L.d) * (0.28 + rng.next() * 0.12);
      const hx = L.x + (L.w - s) * (k === 0 ? 0.05 + rng.next() * 0.15 : k === 1 ? 0.8 + rng.next() * 0.15 : 0.3 + rng.next() * 0.4);
      const hz = L.z + (L.d - s) * (k === 2 ? 0.85 : rng.next());
      const hang = 0.07 + rng.next() * 0.09;
      // Under a crown's own dark layer (flora.ts crown) a little lighter than it, as leaves catch the light from the ground.
      out.push(B(hx, L.y - hang, hz, s, hang + 0.05, s * (0.8 + rng.next() * 0.3), tone(L.color, L.h < 0.2 ? 1.1 : 0.62)));
    }
}

// Roots flaring at the foot, and branches from high on the trunk out under the crown.
function dressTrunk(out: Box[], rng: Rng, T: Box, under: number, branches: number): void {
  const bark = tone(T.color, 0.82);
  const cx = T.x + T.w / 2;
  const cz = T.z + T.d / 2;
  const r = T.w / 2;
  out.push(B(cx - r * 1.3, T.y, cz - r * 1.3, r * 2.6, 0.07, r * 2.6, bark));
  const a0 = rng.next() * Math.PI * 2;
  for (let k = 0; k < 3; k++) {
    const a = a0 + (k * Math.PI * 2) / 3 + (rng.next() - 0.5) * 0.6;
    const len = r * (1.5 + rng.next() * 0.8);
    const w = r * 0.7;
    const x = cx + Math.cos(a) * len * 0.75;
    const z = cz + Math.sin(a) * len * 0.75;
    out.push(B(x - w / 2, T.y, z - w / 2, w, 0.04 + rng.next() * 0.05, w, tone(T.color, 0.74)));
  }
  const top = Math.min(T.y + T.h, under + 0.02);
  for (let k = 0; k < branches; k++) {
    const a = a0 + Math.PI / 3 + k * Math.PI * (0.8 + rng.next() * 0.4);
    const len = 0.18 + rng.next() * 0.14;
    const th = Math.max(0.045, r * 0.5);
    const y = top - 0.22 - rng.next() * 0.1;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    // Out from the trunk, then up into the leaves: two boxes, as a voxel branch is.
    const ox = cx + dx * (r + len / 2);
    const oz = cz + dz * (r + len / 2);
    const lx = Math.abs(dx) > Math.abs(dz) ? len : th;
    const lz = Math.abs(dx) > Math.abs(dz) ? th : len;
    out.push(B(ox - lx / 2, y, oz - lz / 2, lx, th, lz, bark));
    const ex = cx + dx * (r + len * 0.95);
    const ez = cz + dz * (r + len * 0.95);
    out.push(B(ex - th / 2, y + th * 0.6, ez - th / 2, th, under - y + 0.04, th, bark));
  }
}

type Dresser = (out: Box[], rng: Rng, p: Parts, base?: Box[]) => void;

const leafy =
  (rim: number, branches: number): Dresser =>
  (out, rng, p) => {
    // The biggest crown box gets the most clusters; a crown's thin dark underside only the hanging ones.
    const most = Math.max(...p.leaves.map((b) => b.w));
    p.leaves.forEach((L) => dressCrown(out, rng, L, L.y === p.under, L.h < 0.2 ? 0 : Math.max(2, Math.round((rim * L.w) / most))));
    if (p.trunk) dressTrunk(out, rng, p.trunk, p.under, branches);
  };

// Tiers of a pine: branch tips drooping at the corners of each, a shade under the lowest.
const tiers: Dresser = (out, rng, p) => {
  p.leaves.forEach((L, k) => {
    const s = Math.max(0.08, L.w * 0.2);
    for (const [fx, fz] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      if (rng.next() < 0.25) continue;
      const x = L.x - s * 0.35 + fx * (L.w - s * 0.3);
      const z = L.z - s * 0.35 + fz * (L.d - s * 0.3);
      out.push(B(x, L.y - 0.04 - rng.next() * 0.04, z, s, s * 0.9, s, tone(L.color, 0.88)));
    }
    if (k === 0) {
      const u = L.w * 0.6;
      out.push(B(L.x + (L.w - u) / 2, L.y - 0.07, L.z + (L.d - u) / 2, u, 0.09, u, tone(L.color, 0.55)));
    }
    if (k === p.leaves.length - 1) out.push(B(L.x + L.w * 0.4, L.y + L.h - 0.02, L.z + L.d * 0.4, L.w * 0.2, 0.16, L.d * 0.2, tone(L.color, 1.1, SUNLIT, 0.2)));
  });
  if (p.trunk) dressTrunk(out, rng, p.trunk, p.under, 0);
};

// A mushroom's cap: gills under it, a ring on the stem, spots on top.
const cap =
  (spots: number): Dresser =>
  (out, rng, p) => {
    const C0 = p.leaves.reduce((a, b) => (b.w > a.w ? b : a), p.leaves[0]);
    if (!C0) return;
    const g = C0.w * 0.82;
    out.push(B(C0.x + (C0.w - g) / 2, C0.y - 0.04, C0.z + (C0.d - g) / 2, g, 0.05, g, spots ? 0xe8d8bc : tone(C0.color, 1.15, 0xffffff, 0.4)));
    if (p.trunk) {
      const T = p.trunk;
      const r = T.w * 0.75;
      out.push(B(T.x + T.w / 2 - r, T.y + T.h * 0.62, T.z + T.d / 2 - r, r * 2, 0.05, r * 2, tone(T.color, 0.95)));
      out.push(B(T.x + T.w / 2 - r, T.y, T.z + T.d / 2 - r, r * 2, 0.06, r * 2, tone(T.color, 0.85)));
    }
    for (let k = 0; k < spots; k++) {
      const s = C0.w * (0.1 + rng.next() * 0.06);
      out.push(B(C0.x + (C0.w - s) * rng.next(), C0.y + C0.h - 0.02, C0.z + (C0.d - s) * rng.next(), s, 0.04, s, 0xf6f0e6));
    }
  };

const DRESS: Partial<Record<Exclude<TreeStyle, "">, Dresser>> = {
  oak: leafy(7, 2),
  birch: (out, rng, p) => {
    leafy(6, 1)(out, rng, p);
    // The dark marks on a birch's white bark.
    const T = p.trunk;
    if (T)
      for (let k = 0; k < 3; k++)
        out.push(B(T.x - 0.01, T.y + T.h * (0.25 + k * 0.22 + rng.next() * 0.06), T.z + T.d * 0.2, T.w + 0.02, 0.035, T.d * 0.5, 0x3a3632));
  },
  autumn: leafy(7, 2),
  cherry: leafy(7, 2),
  juniper: leafy(5, 1),
  mangrove: leafy(6, 1),
  jungle: (out, rng, p) => {
    leafy(6, 2)(out, rng, p);
    // Leaves hanging in drapes from the crown's rim (thin poles read as posts, not vines).
    const L = p.leaves.find((b) => b.y === p.under);
    if (L)
      for (let k = 0; k < 4; k++) {
        const len = 0.12 + rng.next() * 0.14;
        const wide = 0.16 + rng.next() * 0.1;
        const t = 0.3 + rng.next() * 0.4;
        const color = tone(L.color, 0.78);
        if (k % 2) out.push(B(L.x + (L.w - wide) * t, L.y - len, L.z + (k > 1 ? L.d - 0.07 : 0.02), wide, len + 0.04, 0.05, color));
        else out.push(B(L.x + (k > 1 ? L.w - 0.07 : 0.02), L.y - len, L.z + (L.d - wide) * t, 0.05, len + 0.04, wide, color));
      }
  },
  cypress: leafy(4, 0),
  acacia: (out, rng, p) => {
    p.leaves.forEach((L, k) => dressCrown(out, rng, L, k === 0, k === 0 ? 7 : 4, true));
    if (p.trunk) dressTrunk(out, rng, p.trunk, p.under, 2);
  },
  willow: (out, rng, p) => {
    const top = p.leaves.reduce((a, b) => (b.y > a.y ? b : a), p.leaves[0]);
    if (!top) return;
    dressCrown(out, rng, top, false, 5);
    // More strands, thin, down the open side and between the others.
    for (let k = 0; k < 6; k++) {
      const len = 0.35 + rng.next() * 0.3;
      const a = (k / 6) * Math.PI * 2 + rng.next() * 0.4;
      const x = top.x + top.w / 2 + Math.cos(a) * top.w * 0.47;
      const z = top.z + top.d / 2 + Math.sin(a) * top.d * 0.47;
      out.push(B(x - 0.035, top.y - len, z - 0.035, 0.07, len + 0.04, 0.07, tone(top.color, 0.85 + rng.next() * 0.25)));
    }
    if (p.trunk) dressTrunk(out, rng, p.trunk, top.y, 1);
  },
  pine: tiers,
  snowpine: tiers,
  palm: (out, rng, p) => {
    // Frond tips bending down past the ends, coconuts under the crown, rings up the trunk.
    const fronds = p.leaves.filter((b) => b.h < 0.11);
    for (const F of fronds) {
      const long = F.w > F.d;
      const len = long ? F.w : F.d;
      for (const end of [0, 1]) {
        const s = 0.16;
        const x = long ? F.x + end * len - (end ? 0.02 : s - 0.02) : F.x + F.w / 2 - s / 2;
        const z = long ? F.z + F.d / 2 - s / 2 : F.z + end * len - (end ? 0.02 : s - 0.02);
        out.push(
          B(
            long ? x + (end ? 0.06 : -0.06) : x,
            F.y - 0.12,
            long ? z : z + (end ? 0.06 : -0.06),
            long ? s : s * 1.2,
            0.1,
            long ? s * 1.2 : s,
            tone(F.color, 0.85),
          ),
        );
      }
    }
    const T = p.trunk;
    if (T) {
      const cx = T.x + T.w / 2;
      const cz = T.z + T.d / 2;
      const top = T.y + T.h;
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.4;
        out.push(B(cx + Math.cos(a) * 0.09 - 0.05, top - 0.12, cz + Math.sin(a) * 0.09 - 0.05, 0.1, 0.1, 0.1, 0x5a4026));
      }
      for (let k = 1; k < 4; k++) out.push(B(T.x - 0.015, T.y + (T.h * k) / 4, T.z - 0.015, T.w + 0.03, 0.04, T.d + 0.03, tone(T.color, 0.78)));
      out.push(B(cx - T.w * 0.85, T.y, cz - T.w * 0.85, T.w * 1.7, 0.08, T.w * 1.7, tone(T.color, 0.82)));
    }
  },
  dead: (out, rng, p) => {
    const T = p.trunk;
    if (!T) return;
    dressTrunk(out, rng, T, T.y + T.h, 2);
    const cx = T.x + T.w / 2;
    const cz = T.z + T.d / 2;
    out.push(B(cx - 0.03, T.y + T.h - 0.02, cz - 0.03, 0.06, 0.16, 0.06, tone(T.color, 0.9)));
  },
  mushroom: cap(5),
  glowcap: cap(0),
  bamboo: (out, rng, p, base) => {
    // Rings at the joints of each cane, and leaves out from the higher ones.
    for (const b of base ?? [])
      if (b.w < 0.1) {
        for (let k = 1; k < 4; k++) out.push(B(b.x - 0.012, b.y + (b.h * k) / 4, b.z - 0.012, b.w + 0.024, 0.03, b.d + 0.024, tone(b.color, 0.75)));
        const y = b.y + b.h * (0.55 + rng.next() * 0.25);
        const a = rng.next() < 0.5;
        out.push(B(b.x + (a ? 0.07 : -0.2), y, b.z - 0.02, 0.2, 0.025, 0.1, tone(b.color, 0.95, 0x4a9a2a, 0.5)));
      }
  },
};

const cache = new Map<string, Box[]>();

// Styles whose crown boxes are drawn round near the eye (pines keep their stepped tiers, palms
// and acacias their flat fronds and layers).
const ROUND = new Set(["oak", "birch", "autumn", "cherry", "juniper", "mangrove", "jungle", "cypress", "willow", "mushroom", "glowcap"]);

// A tree drawn near the eye in place of its own model (flora.ts treeModel): the same boxes, its
// big crown boxes drawn round, and the clusters, branches and roots of its style.
export function nearTreeModel(style: TreeStyle, base: Box[]): Box[] {
  const key = style || "oak";
  let boxes = cache.get(key);
  if (!boxes) {
    const parts = partsOf(base);
    const caps = key === "mushroom" || key === "glowcap";
    const body: Box[] = [];
    for (const b of base)
      if (ROUND.has(key) && parts.leaves.includes(b) && b.h >= (caps ? 0.1 : 0.2) && b.w >= 0.45) body.push(...rounded(b));
      else body.push({ ...b });
    const extra: Box[] = [];
    let seed = 7741;
    for (let k = 0; k < key.length; k++) seed = Math.imul(seed ^ key.charCodeAt(k), 0x01000193) >>> 0;
    const dress = DRESS[key as Exclude<TreeStyle, "">] ?? leafy(6, 1);
    dress(extra, new Rng(seed), parts, base);
    boxes = unplane([...body, ...extra]);
    cache.set(key, boxes);
  }
  return boxes;
}
