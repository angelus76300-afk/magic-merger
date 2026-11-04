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
  const river = new Set<number>();
  for (const s of world.springs) if (!s.lava) river.add(s.i);
  const heads = world.springs.filter((s) => !s.lava && (s.rate ?? 1.2) > 1).map((s) => s.i);
  let longest = 0;
  let inLong = 0;
  let steps = 0;
  let windSum = 0;
  let windN = 0;
  const seen = new Set<number>();
  for (const head of heads) {
    const path = [head];
    seen.add(head);
    let i = head;
    for (;;) {
      const x = i % w;
      const y = (i / w) | 0;
      let next = -1;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const j = (y + dy) * w + x + dx;
        if (x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= world.h || seen.has(j) || !river.has(j)) continue;
        if (next < 0 || world.height[j] < world.height[next]) next = j;
      }
      if (next < 0) break;
      seen.add(next);
      path.push(next);
      i = next;
    }
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
