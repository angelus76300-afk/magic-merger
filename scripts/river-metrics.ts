// How rivers wind and whether walkers can cross them (4.4.1), for npm test
// and scripts/river-shape.ts.
import { F } from "../src/sim/materials";
import type { World } from "../src/sim/world";

// Each river followed from its spring at the head down through the cells fed
// along it: the longest straight run (cells in one direction), the share of
// steps in straight runs of 8 or more, and the winding (path length over the
// straight distance, over 16 steps; 1 is a ruler).
export function riverShape(world: World): { longest: number; straight: number; winding: number; steps: number } {
  const { w } = world;
  let longest = 0;
  let inLong = 0;
  let steps = 0;
  let windSum = 0;
  let windN = 0;
  for (const path of riverWalks(world)) {
    let run = 1;
    for (let k = 2; k < path.length; k++) {
      const d1 = path[k - 1] - path[k - 2];
      const d2 = path[k] - path[k - 1];
      if (d1 === d2) run++;
      else {
        if (run >= 8) inLong += run;
        longest = Math.max(longest, run);
        run = 1;
      }
    }
    if (run >= 8) inLong += run;
    longest = Math.max(longest, run);
    steps += path.length - 1;
    for (let k = 0; k + 16 < path.length; k += 4) {
      const a = path[k];
      const b = path[k + 16];
      const dist = Math.hypot((a % w) - (b % w), ((a / w) | 0) - ((b / w) | 0));
      if (dist > 0) {
        windSum += 16 / dist;
        windN++;
      }
    }
  }
  return { longest, straight: steps ? inLong / steps : 0, winding: windN ? windSum / windN : 0, steps };
}

// Each river followed from its spring at the head down through the cells fed
// along it, to the lowest side by side cell not yet walked.
export function riverWalks(world: World): number[][] {
  const { w } = world;
  const river = new Set<number>();
  for (const s of world.springs) if (!s.lava) river.add(s.i);
  const heads = world.springs.filter((s) => !s.lava && (s.rate ?? 1.2) > 1).map((s) => s.i);
  const seen = new Set<number>();
  const walks: number[][] = [];
  for (const head of heads) {
    const path = [head];
    seen.add(head);
    let i = head;
    for (;;) {
      const x = i % w;
      const y = (i / w) | 0;
      let next = -1;
      for (const [dx, dy] of N4) {
        const j = (y + dy) * w + x + dx;
        if (x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= world.h || seen.has(j) || !river.has(j)) continue;
        if (next < 0 || world.height[j] < world.height[next]) next = j;
      }
      if (next < 0) break;
      seen.add(next);
      path.push(next);
      i = next;
    }
    walks.push(path);
  }
  return walks;
}

// The river's water falling unevenly (19 November): along each walk, the
// drops of the water's surface from cell to cell, and the drops that are
// terrace edges, more than an eighth of a unit (a voxel of the view) and
// more than twice the river's mean drop over five cells either side. A river
// that falls evenly has none; one that stands level and then drops has one
// at each drop.
export function riverFalls(world: World): { uneven: number; steps: number } {
  let uneven = 0;
  let steps = 0;
  for (const path of riverWalks(world)) {
    const drops: number[] = [];
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1];
      const b = path[k];
      drops.push(world.height[a] + world.depth[a] - world.height[b] - world.depth[b]);
    }
    for (let k = 0; k < drops.length; k++) {
      let sum = 0;
      let n = 0;
      for (let j = Math.max(0, k - 5); j <= Math.min(drops.length - 1, k + 5); j++) {
        sum += Math.max(0, drops[j]);
        n++;
      }
      steps++;
      if (drops[k] > 0.125 && drops[k] > (2 * sum) / n) uneven++;
    }
  }
  return { uneven, steps };
}

// River cells with a dry bank more than a walker climbs (1.55, paths.ts)
// above the water, and how many river cells there are.
export function riverTrenches(world: World): { trenches: number; cells: number } {
  const { w, h } = world;
  let trenches = 0;
  let cells = 0;
  for (const s of world.springs) {
    if (s.lava) continue;
    const i = s.i;
    const x = i % w;
    const y = (i / w) | 0;
    const level = world.height[i] + world.depth[i];
    cells++;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      if (x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= h) continue;
      const j = (y + dy) * w + x + dx;
      if (world.fluid[j] === F.NONE && world.height[j] - level > 1.55) {
        trenches++;
        break;
      }
    }
  }
  return { trenches, cells };
}

// The river's own water (river-shape of 19 November): water cells above the
// sea that carry a river spring (a head, or a cell fed along its length) or
// touch one. Lakes' springs (a rate of 1.2 or more) and lava are left out.
export function riverMask(world: World): Uint8Array {
  const { w, h } = world;
  const mask = new Uint8Array(world.n);
  const wetAbove = (i: number) => world.fluid[i] === F.WATER && world.depth[i] > 0 && world.height[i] + world.depth[i] >= world.seaLevel + 0.05;
  for (const s of world.springs) {
    if (s.lava || (s.rate !== undefined && s.rate >= 0.5)) continue;
    if (!wetAbove(s.i)) continue;
    mask[s.i] = 1;
  }
  const grown = mask.slice();
  for (let i = 0; i < world.n; i++) {
    if (!mask[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (wetAbove(j)) grown[j] = 1;
    }
  }
  return grown;
}

const N4: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// How angular the river's banks are: the outline of the river's water traced
// along the cells' edges, its direction read over two edges (a chord), and the
// share of the outline's corners where that direction turns by a right angle
// or more. A smooth curve laid on the grid turns a little at a time (a
// diagonal is a regular staircase whose chords keep one direction); a river
// stepped from straight runs turns square at every bend.
export function riverCorners(world: World, mask = riverMask(world)): { square: number; corners: number; cells: number } {
  const { w, h } = world;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  // Directed edges with the river on their left, keyed by their start corner.
  const W1 = w + 1;
  const out = new Map<number, number[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = y0 * W1 + x0;
    const list = out.get(k);
    const e = y1 * W1 + x1;
    if (list) list.push(e);
    else out.set(k, [e]);
  };
  let cells = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      cells++;
      if (!at(x, y - 1)) add(x + 1, y, x, y);
      if (!at(x + 1, y)) add(x + 1, y + 1, x + 1, y);
      if (!at(x, y + 1)) add(x, y + 1, x + 1, y + 1);
      if (!at(x - 1, y)) add(x, y, x, y + 1);
    }
  let square = 0;
  let corners = 0;
  const used = new Set<string>();
  for (const [start, ends] of out)
    for (const first of ends) {
      if (used.has(`${start}>${first}`)) continue;
      // One loop of the outline, as its corners.
      const loop: number[] = [start];
      let a = start;
      let b = first;
      for (let guard = 0; guard < 4 * world.n; guard++) {
        used.add(`${a}>${b}`);
        if (b === start) break;
        loop.push(b);
        const next = out.get(b)!.filter((e) => !used.has(`${b}>${e}`));
        if (!next.length) break;
        // Two ways on at a corner the river touches diagonally: keep the left one.
        const dx = (b % W1) - (a % W1);
        const dy = ((b / W1) | 0) - ((a / W1) | 0);
        next.sort((p, q) => {
          const turn = (e: number) => dx * (((e / W1) | 0) - ((b / W1) | 0)) - dy * ((e % W1) - (b % W1));
          return turn(p) - turn(q);
        });
        a = b;
        b = next[0];
      }
      const n = loop.length;
      if (n < 8) continue;
      const px = (k: number) => loop[((k % n) + n) % n] % W1;
      const py = (k: number) => (loop[((k % n) + n) % n] / W1) | 0;
      for (let k = 0; k < n; k++) {
        const ax = px(k) - px(k - 2);
        const ay = py(k) - py(k - 2);
        const bx = px(k + 2) - px(k);
        const by = py(k + 2) - py(k);
        const la = Math.hypot(ax, ay);
        const lb = Math.hypot(bx, by);
        if (!la || !lb) continue;
        corners++;
        // A turn of 80 degrees or more.
        if ((ax * bx + ay * by) / (la * lb) <= Math.cos((80 * Math.PI) / 180)) square++;
      }
    }
  return { square, corners, cells };
}

// The river's small falls: pairs of side by side river cells whose water
// surfaces differ by more than a quarter of a unit (two eighths of the view's
// voxels), and the river's cells.
export function riverSteps(world: World, mask = riverMask(world), rise = 0.25): { steps: number; cells: number } {
  const { w, h } = world;
  let steps = 0;
  let cells = 0;
  for (let i = 0; i < world.n; i++) {
    if (!mask[i]) continue;
    cells++;
    const x = i % w;
    const y = (i / w) | 0;
    const level = world.height[i] + world.depth[i];
    for (const [nx, ny] of [
      [x + 1, y],
      [x, y + 1],
    ]) {
      if (nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (mask[j] && Math.abs(world.height[j] + world.depth[j] - level) > rise) steps++;
    }
  }
  return { steps, cells };
}
