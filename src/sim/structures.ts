import { VK, packVoxel } from "./voxels";
import type { World } from "./world";

// Ready-made builds for spells: trees of many kinds, spires, towers, walls,
// arches and floating islands, all made of typed voxels so they burn, melt
// and fall like the rest. A Builder collects voxels first; the runtime then
// places them at once or grows them over a few seconds, from the base
// outward, so a growing tree is always held by what already grew.

export class Builder {
  readonly cells = new Map<number, number>();
  constructor(readonly world: World) {}

  top(x: number, y: number): number {
    const w = this.world;
    const cx = Math.max(0, Math.min(w.w - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(w.h - 1, Math.round(y)));
    return Math.round(w.height[cy * w.w + cx] * 0.5);
  }

  put(x: number, y: number, level: number, color: number, kind: number): void {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rl = Math.round(level);
    if (!this.world.inside(rx, ry) || rl < -60 || rl > 380) return;
    this.cells.set(this.world.decorKey(rx, ry, rl), packVoxel(color, kind));
  }

  // A column from the land up to `level`, so nothing built on a slope hangs.
  column(x: number, y: number, level: number, color: number, kind: number): void {
    for (let l = this.top(x, y); l <= level; l++) this.put(x, y, l, color, kind);
  }

  // A line where each voxel touches the previous one by a face, so it holds.
  line(x0: number, y0: number, l0: number, x1: number, y1: number, l1: number, color: (t: number) => number, kind: number, thick = 1): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    let l = Math.round(l0);
    const tx = Math.round(x1);
    const ty = Math.round(y1);
    const tl = Math.round(l1);
    const total = Math.abs(tx - x) + Math.abs(ty - y) + Math.abs(tl - l) || 1;
    let step = 0;
    const r = Math.max(0, Math.floor((thick - 1) / 2));
    const stamp = () => {
      const c = color(step / total);
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) this.put(x + dx, y + dy, l, c, kind);
    };
    stamp();
    while (x !== tx || y !== ty || l !== tl) {
      // Step along the axis that is furthest behind its share of the way.
      const want = (step + 1) / total;
      const ex = tx === Math.round(x0) ? -1 : Math.abs(x - x0) / Math.abs(tx - x0) - want;
      const ey = ty === Math.round(y0) ? -1 : Math.abs(y - y0) / Math.abs(ty - y0) - want;
      const el = tl === Math.round(l0) ? -1 : Math.abs(l - l0) / Math.abs(tl - l0) - want;
      if (x !== tx && (ex <= ey || y === ty) && (ex <= el || l === tl)) x += Math.sign(tx - x);
      else if (y !== ty && (ey <= el || l === tl)) y += Math.sign(ty - y);
      else if (l !== tl) l += Math.sign(tl - l);
      else if (x !== tx) x += Math.sign(tx - x);
      else y += Math.sign(ty - y);
      step++;
      stamp();
    }
  }

  // An ellipsoid of leaves or rock, ragged at the edge. Big ones are a thick
  // shell with a cross through the middle that ties it to whatever reaches the
  // center: the inside is never seen, and voxels are counted.
  blob(cx: number, cy: number, cl: number, r: number, squash: number, color: () => number, kind: number, ragged = 0.35): void {
    const rv = Math.max(1, r * squash);
    const hollow = r > 3.5 && rv > 2.5;
    // Points with d below this are inside the shell.
    const inner = hollow ? (1 - (r > 7 ? 1.5 : 2.2) / Math.min(r, rv)) ** 2 : -1;
    const rcx = Math.round(cx);
    const rcy = Math.round(cy);
    const rcl = Math.round(cl);
    for (let dl = -Math.ceil(rv); dl <= Math.ceil(rv); dl++) {
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
        for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
          const d = (dx * dx + dy * dy) / (r * r) + (dl * dl) / (rv * rv);
          if (d > 1) continue;
          const axis = (dx === 0 && dy === 0) || (dx === 0 && dl === 0) || (dy === 0 && dl === 0);
          if (d < inner && !axis) continue;
          if (d > 0.7 && Math.random() < ragged) continue;
          this.put(rcx + dx, rcy + dy, rcl + dl, color(), kind);
        }
      }
    }
  }

  // A filled disc one voxel thick.
  disc(cx: number, cy: number, level: number, r: number, color: () => number, kind: number): void {
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) if (dx * dx + dy * dy <= r * r) this.put(cx + dx, cy + dy, level, color(), kind);
  }

  // The order to grow in: outward from what touches the land, through faces.
  growOrder(): [number, number][] {
    const order: [number, number][] = [];
    const seen = new Set<number>();
    const queue: number[] = [];
    for (const key of this.cells.keys()) {
      const level = (key % 512) - 128;
      const cell = Math.floor(key / 512);
      const x = cell % 1024;
      const y = Math.floor(cell / 1024);
      if (level <= this.top(x, y) || this.world.decor.has(key - 1)) {
        seen.add(key);
        queue.push(key);
      }
    }
    // Breadth first, but upward neighbors first so trunks rise before they spread.
    const steps = [1, -1, 512, -512, 1024 * 512, -1024 * 512];
    for (let q = 0; q < queue.length; q++) {
      const key = queue[q];
      order.push([key, this.cells.get(key)!]);
      for (const d of steps) {
        const k = key + d;
        if (!seen.has(k) && this.cells.has(k)) {
          seen.add(k);
          queue.push(k);
        }
      }
    }
    // Anything not connected goes last (it will fall, as it should).
    for (const [key, v] of this.cells) if (!seen.has(key)) order.push([key, v]);
    return order;
  }
}

const pickFrom = (list: number[]) => () => list[(Math.random() * list.length) | 0];

export interface TreeOptions {
  height: number;
  style: string;
  trunk: number[];
  leaves: number[];
  // Extra colors sprinkled in the leaves: blossoms, fruit, autumn.
  accent: number[];
  accentShare: number;
  leafKind: number;
}

const TREE_DEFAULTS: Record<string, { trunk: number[]; leaves: number[] }> = {
  oak: { trunk: [0x5b3a1e, 0x6a4424, 0x4f3219], leaves: [0x3f8a2e, 0x4a9a35, 0x357a27, 0x56a63d] },
  pine: { trunk: [0x4f3219, 0x5b3a1e], leaves: [0x1f5a32, 0x256a3a, 0x1a4d2b] },
  birch: { trunk: [0xe8e4da, 0xd8d2c4, 0x3a3530], leaves: [0x8cc63f, 0x9ed24f, 0x7ab535] },
  willow: { trunk: [0x5a4a32, 0x4e402a], leaves: [0x7fae3c, 0x8fbe48, 0x6e9e32] },
  palm: { trunk: [0x9a7b4f, 0x8a6b42, 0xa88a5c], leaves: [0x3e9a3a, 0x4caa44, 0x338a30] },
  dead: { trunk: [0x5a5048, 0x4a423c, 0x6a5e54], leaves: [] },
  giant: { trunk: [0x5b3a1e, 0x6a4424, 0x4f3219, 0x74502c], leaves: [0x3f8a2e, 0x4a9a35, 0x357a27, 0x56a63d, 0x2f7024] },
  mushroom: { trunk: [0xefe6d2, 0xe2d8c0], leaves: [0xd8352a, 0xc42a20, 0xe04838] },
  crystal: { trunk: [0xb9a4ff, 0xd3c6ff], leaves: [0x9f88f5, 0xc9b8ff, 0xe6deff] },
};

export function treeDefaults(style: string) {
  return TREE_DEFAULTS[style] ?? TREE_DEFAULTS.oak;
}

// Grows a tree at (x, y) whose trunk starts on the land, `lift` voxels above it.
export function tree(b: Builder, x: number, y: number, lift: number, o: TreeOptions): void {
  const H = Math.max(4, Math.min(120, Math.round(o.height)));
  const base = b.top(x, y) + lift;
  const trunk = pickFrom(o.trunk);
  const leafColor = () =>
    o.accent.length && Math.random() < o.accentShare ? o.accent[(Math.random() * o.accent.length) | 0] : o.leaves[(Math.random() * o.leaves.length) | 0];
  const t = H < 10 ? 1 : H < 22 ? 2 : H < 40 ? 3 : H < 70 ? 4 : 5;
  const half = (t - 1) / 2;
  const style = o.style;

  const trunkUp = (height: number, bend = 0) => {
    for (let l = 0; l <= height; l++) {
      const ox = bend ? Math.round(bend * (l / height) ** 2) : 0;
      for (let dx = -Math.floor(half); dx <= Math.ceil(half); dx++) {
        for (let dy = -Math.floor(half); dy <= Math.ceil(half); dy++) {
          if (t >= 4 && Math.abs(dx) + Math.abs(dy) > t - 1) continue;
          if (l === 0 && lift === 0) b.column(x + dx + ox, y + dy, base, trunk(), VK.WOOD);
          else b.put(x + dx + ox, y + dy, base + l, trunk(), VK.WOOD);
        }
      }
      // A floating tree still needs its foot.
    }
  };

  switch (style) {
    case "pine": {
      trunkUp(H);
      const start = Math.round(H * 0.22);
      const R = Math.max(2, H * 0.24);
      for (let l = start; l <= H + 1; l++) {
        const f = (l - start) / (H + 1 - start);
        // Tiers: the radius widens again at the bottom of each one.
        const tier = (f * 4) % 1;
        const r = Math.max(0.6, R * (1 - f) * (0.65 + 0.35 * tier));
        b.disc(x, y, base + l, r, leafColor, o.leafKind);
      }
      break;
    }
    case "palm": {
      const bend = Math.round(H * 0.25) * (Math.random() < 0.5 ? -1 : 1);
      trunkUp(H, bend);
      const tx = x + bend;
      const tl = base + H;
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + Math.random() * 0.4;
        const len = H * 0.45;
        b.line(tx, y, tl + 1, tx + Math.cos(a) * len * 0.6, y + Math.sin(a) * len * 0.6, tl + 2, leafColor, o.leafKind);
        b.line(tx + Math.cos(a) * len * 0.6, y + Math.sin(a) * len * 0.6, tl + 2, tx + Math.cos(a) * len, y + Math.sin(a) * len, tl - 2, leafColor, o.leafKind);
      }
      b.blob(tx, y, tl + 1, 1.5, 1, leafColor, o.leafKind, 0);
      break;
    }
    case "mushroom": {
      trunkUp(H);
      const R = Math.max(2, H * 0.55);
      for (let dl = 0; dl <= Math.ceil(R * 0.5); dl++) {
        const r = R * Math.sqrt(1 - (dl / (R * 0.5 + 0.01)) ** 2);
        b.disc(x, y, base + H + dl, r, () => (Math.random() < 0.12 ? 0xf6f0e6 : leafColor()), o.leafKind);
      }
      break;
    }
    case "crystal": {
      // A cluster of tilted shards instead of a crown.
      for (let k = 0; k < 5; k++) {
        const a = Math.random() * Math.PI * 2;
        const lean = k === 0 ? 0 : H * 0.3;
        const h = k === 0 ? H : H * (0.4 + Math.random() * 0.35);
        b.line(x, y, base, x + Math.cos(a) * lean, y + Math.sin(a) * lean, base + h, () => leafColor(), VK.GLOW, k === 0 ? Math.max(1, t) : Math.max(1, t - 1));
      }
      break;
    }
    default: {
      // Oak, birch, willow, dead, giant: a trunk, branches, crowns at their ends.
      const giant = style === "giant";
      const crownH = style === "birch" ? H : Math.round(H * 0.82);
      trunkUp(crownH);
      if (giant || H >= 30) {
        // Roots flaring over the land.
        for (let k = 0; k < (giant ? 7 : 4); k++) {
          const a = (k / (giant ? 7 : 4)) * Math.PI * 2 + Math.random() * 0.5;
          const len = t + H * (giant ? 0.18 : 0.1);
          const ex = x + Math.cos(a) * len;
          const ey = y + Math.sin(a) * len;
          b.line(x, y, base + t, ex, ey, b.top(ex, ey), trunk, VK.WOOD, Math.max(1, t - 2));
        }
      }
      const tips: { x: number; y: number; l: number; r: number }[] = [];
      const branches = style === "birch" ? 2 : giant ? 7 : H < 10 ? 2 : 4 + Math.round(Math.random() * 2);
      // Crowns widen with height, then more slowly past 40 voxels: a world tree
      // must still fit in the world's voxel budget.
      const reach = H <= 40 ? H : 40 + (H - 40) * 0.5;
      const crownR = style === "birch" ? Math.max(2, reach * 0.16) : Math.max(2, reach * (giant ? 0.2 : 0.26));
      for (let k = 0; k < branches; k++) {
        const a = (k / branches) * Math.PI * 2 + Math.random() * 0.6;
        const from = base + Math.round(crownH * (0.5 + 0.4 * Math.random()));
        const len = H * (giant ? 0.38 : 0.32) * (0.75 + Math.random() * 0.4);
        const ex = x + Math.cos(a) * len;
        const ey = y + Math.sin(a) * len;
        const el = from + len * (0.45 + Math.random() * 0.35);
        b.line(x, y, from, ex, ey, el, trunk, VK.WOOD, giant ? Math.max(1, t - 2) : 1);
        tips.push({ x: ex, y: ey, l: el, r: crownR * (0.7 + Math.random() * 0.35) });
        // Twigs on dead trees.
        if (style === "dead") {
          const b2 = a + (Math.random() - 0.5) * 1.6;
          b.line(ex, ey, el, ex + Math.cos(b2) * len * 0.4, ey + Math.sin(b2) * len * 0.4, el + len * 0.3, trunk, VK.WOOD);
        }
      }
      tips.push({ x, y, l: base + crownH + 1, r: crownR * 1.1 });
      if (style === "dead" || !o.leaves.length) break;
      for (const tip of tips) b.blob(tip.x, tip.y, tip.l, tip.r, style === "willow" ? 0.6 : 0.72, leafColor, o.leafKind);
      if (style === "willow") {
        // Strands hanging from the crown's rim.
        for (const tip of tips) {
          for (let k = 0; k < 10; k++) {
            const a = Math.random() * Math.PI * 2;
            const sx = tip.x + Math.cos(a) * tip.r * 0.9;
            const sy = tip.y + Math.sin(a) * tip.r * 0.9;
            const bottom = Math.max(b.top(sx, sy) + 2, tip.l - H * 0.6);
            for (let l = Math.round(tip.l); l >= bottom; l--) b.put(sx, sy, l, leafColor(), o.leafKind);
          }
        }
      }
    }
  }
}

// A tapering spike: crystal spires, stalagmites, obelisks.
export function spire(b: Builder, x: number, y: number, height: number, radius: number, colors: number[], kind: number, lean = 0, angle = 0): void {
  const base = b.top(x, y) - 1;
  const color = pickFrom(colors);
  const H = Math.max(2, Math.min(150, Math.round(height)));
  for (let l = 0; l <= H; l++) {
    const f = l / H;
    const r = Math.max(0.5, radius * (1 - f) ** 1.2);
    const ox = Math.cos(angle) * lean * f * H;
    const oy = Math.sin(angle) * lean * f * H;
    b.disc(x + ox, y + oy, base + l, r, color, kind);
  }
}

// A round tower: a hollow wall, lit windows, battlements or a pointed roof.
export function tower(b: Builder, x: number, y: number, height: number, radius: number, colors: number[], roof: number | null, windows: number | null): void {
  const base = b.top(x, y);
  const color = pickFrom(colors);
  const H = Math.max(3, Math.min(120, Math.round(height)));
  const R = Math.max(1.5, Math.min(20, radius));
  for (let dy = -Math.ceil(R); dy <= Math.ceil(R); dy++) {
    for (let dx = -Math.ceil(R); dx <= Math.ceil(R); dx++) {
      const d = Math.hypot(dx, dy);
      if (d > R) continue;
      const wall = d > R - 1.2;
      // Footing down to the land and a floor.
      for (let l = b.top(x + dx, y + dy); l < base; l++) b.put(x + dx, y + dy, l, color(), VK.STONE);
      b.put(x + dx, y + dy, base, color(), VK.STONE);
      if (!wall) continue;
      for (let l = 1; l <= H; l++) {
        const win = windows !== null && l % 5 === 3 && (Math.round(Math.atan2(dy, dx) * 4) & 1) === 0 && l < H - 1;
        b.put(x + dx, y + dy, base + l, win ? windows! : color(), win ? VK.GLOW : VK.STONE);
      }
      if (roof === null && (dx + dy) % 2 === 0) b.put(x + dx, y + dy, base + H + 1, color(), VK.STONE);
    }
  }
  if (roof !== null) {
    for (let l = 0; l <= R * 2; l++) b.disc(x, y, base + H + 1 + l, Math.max(0.5, (R + 0.8) * (1 - l / (R * 2 + 1))), () => roof, VK.STONE);
  }
}

// A straight wall between two points.
export function wall(b: Builder, x0: number, y0: number, x1: number, y1: number, height: number, thick: number, colors: number[], kind: number): void {
  const color = pickFrom(colors);
  const len = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  const H = Math.max(1, Math.min(80, Math.round(height)));
  for (let s = 0; s <= len; s++) {
    const px = x0 + ((x1 - x0) * s) / len;
    const py = y0 + ((y1 - y0) * s) / len;
    for (let k = 0; k < Math.max(1, Math.round(thick)); k++) {
      const nx = px + (k - (thick - 1) / 2) * (-(y1 - y0) / len);
      const ny = py + (k - (thick - 1) / 2) * ((x1 - x0) / len);
      b.column(nx, ny, b.top(nx, ny) + H, color(), kind);
    }
  }
}

// A half circle standing between two points: gates, bridges, rainbows.
export function arch(b: Builder, x0: number, y0: number, x1: number, y1: number, height: number, thick: number, colors: number[], kind: number): void {
  const color = pickFrom(colors);
  const base = Math.min(b.top(x0, y0), b.top(x1, y1));
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(8, Math.ceil(len * 2 + height * 2));
  let prev: [number, number, number] | null = null;
  for (let s = 0; s <= steps; s++) {
    const a = (s / steps) * Math.PI;
    const px = x0 + (x1 - x0) * (1 - Math.cos(a)) * 0.5;
    const py = y0 + (y1 - y0) * (1 - Math.cos(a)) * 0.5;
    const pl = base + Math.sin(a) * height;
    if (prev) b.line(prev[0], prev[1], prev[2], px, py, pl, color, kind, thick);
    prev = [px, py, pl];
  }
  b.column(x0, y0, base, color(), kind);
  b.column(x1, y1, base, color(), kind);
}

// A floating island: a grassy top over a rocky cone, held up by magic.
export function island(b: Builder, x: number, y: number, z: number, r: number, top: number[], rock: number[]): void {
  const R = Math.max(2, Math.min(30, r));
  const base = b.top(x, y) + Math.max(4, z);
  const depth = Math.round(R * 1.1);
  for (let dl = 0; dl <= depth; dl++) {
    const rr = R * (1 - dl / (depth + 1)) ** 0.8;
    b.disc(x, y, base - dl, rr, dl === 0 ? pickFrom(top) : pickFrom(rock), VK.FLOAT);
  }
}
