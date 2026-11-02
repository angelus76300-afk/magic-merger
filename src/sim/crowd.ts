import type { Creature } from "./creatures";
import type { World } from "./world";

// Who stands near a point, without looking at every creature. Creatures are
// put in squares of CELL cells once per tick, the first time anyone asks;
// a question then looks only at the squares its circle touches. With 300
// creatures, a villager looking around used to check all 300 three times a
// second; now it checks the few in its neighborhood.

const CELL = 8;
// Creatures move during a tick after the grid was made: a little slack.
const SLACK = 1;

export class CreatureGrid {
  private tick = -1;
  // The list and its length when the grid was made: a creature removed or
  // added since shifts the indices, so the grid is made again.
  private builtFrom: Creature[] | null = null;
  private builtLength = 0;
  private cols = 0;
  private rows = 0;
  private head = new Int32Array(0);
  private next = new Int32Array(0);
  private found: Creature[] = [];

  // The living creatures within r of (x, y), give or take SLACK: callers
  // check the exact distance. The array is reused by the next call, so read
  // it before asking again.
  near(world: World, x: number, y: number, r: number): readonly Creature[] {
    if (this.tick !== world.tick || this.builtFrom !== world.creatures || this.builtLength !== world.creatures.length) this.build(world);
    const out = this.found;
    out.length = 0;
    const list = world.creatures;
    const reach = r + SLACK;
    // Clamped like the creatures were, so the border squares are searched too.
    const x0 = clamp(Math.floor((x - reach) / CELL), this.cols);
    const x1 = clamp(Math.floor((x + reach) / CELL), this.cols);
    const y0 = clamp(Math.floor((y - reach) / CELL), this.rows);
    const y1 = clamp(Math.floor((y + reach) / CELL), this.rows);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        for (let k = this.head[gy * this.cols + gx]; k >= 0; k = this.next[k]) {
          const c = list[k];
          if (c && !c.dead) out.push(c);
        }
      }
    }
    return out;
  }

  private build(world: World): void {
    this.tick = world.tick;
    this.builtFrom = world.creatures;
    this.builtLength = world.creatures.length;
    // Creatures off the island's edge go in the border squares.
    this.cols = Math.ceil(world.w / CELL);
    this.rows = Math.ceil(world.h / CELL);
    if (this.head.length < this.cols * this.rows) this.head = new Int32Array(this.cols * this.rows);
    this.head.fill(-1);
    const list = world.creatures;
    if (this.next.length < list.length) this.next = new Int32Array(Math.max(64, list.length * 2));
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (c.dead) continue;
      const gx = clamp(Math.floor(c.x / CELL), this.cols);
      const gy = clamp(Math.floor(c.y / CELL), this.rows);
      const cell = gy * this.cols + gx;
      this.next[k] = this.head[cell];
      this.head[cell] = k;
    }
  }
}

function clamp(v: number, n: number): number {
  return v < 0 ? 0 : v >= n ? n - 1 : v;
}
