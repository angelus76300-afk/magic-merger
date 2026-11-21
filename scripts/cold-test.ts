// Cold is a pressure, not a trap (21 November, the owner: "Too many animals freeze forever in the
// cold mountains, ideally humans and merchants prepare for it"). On main a creature on a cell under
// -12 was frozen every tick and could not move: on a cold peak it stayed frozen for good. The game
// designer's checks (src/sim/cold.ts), each on a small made island:
//   1. no ambient trap: a deer on a temperate peak at height 40 (-25 there) for 120 s is never
//      land-frozen more than 0.6 s in a row, and ends warm or dead;
//   2. boxed in on that peak, it dies of the cold between 55 and 85 s, stands as a frost statue,
//      and is gone 40 s after its death;
//   3. a spell's freeze is kept: frozen for its 5 s;
//   4. a spell's cold freezes 3 s at most;
//   5. lasting spell cold: 3 s frozen at most, then 4 s free, again and again;
//   6. a yeti on -20 is never frozen by the land (on main a creature of cold was thawed by
//      reactions.ts and frozen again the same tick);
//   7. a polar bear on a cold peak and people at home in a cold village never chill or freeze;
//   8. a trip's path goes round a band of cold ground when the warm way is not much longer;
//   and the cairn an explorer leaves: never on a field, a crop or a road, and never one box.
// The ten-minute tundra run (9) is a job of npm test's workers (scripts/cold-run.ts).
// These read only c.frozen, c.data and the island, so the same file runs on main to show each
// failing there (the constants of cold.ts are written out).
import { KINDS, makeCreature, type Creature } from "../src/sim/creatures";
import { C, G } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { pathsOf, Mobility } from "../src/sim/paths";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { TICK, World } from "../src/sim/world";
import { keyX, keyY } from "../src/sim/voxelkey";
import { voxelColor } from "../src/sim/voxels";

type Check = (name: string, ok: boolean, detail?: string) => void;

const SIZE = 64;
const MID = 32;

// A temperate island (climate 0, lapse 2.5 a unit from 24), all grass, by day, temperatures at the
// climate. height(x, y) gives the land.
function island(height: (x: number, y: number) => number, climate = 0): { world: World; rt: Runtime } {
  const world = new World(SIZE, SIZE, 5);
  world.climate = climate;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      world.height[i] = height(x, y);
      world.ground[i] = G.GRASS;
    }
  for (let i = 0; i < world.n; i++) world.temp[i] = world.ambient(i);
  world.time = 12 * 60;
  // No wild births: only the creatures a check puts there.
  world.wild = [];
  return { world, rt: new Runtime(world, () => {}) };
}

// A cone 40 high at the middle, 12 at its foot 23 cells out: a slope of 1.2 a cell.
const peak = (x: number, y: number) => Math.max(12, 40 - Math.hypot(x - MID, y - MID) * 1.2);

function put(world: World, kind: string, x: number, y: number): Creature {
  const c = makeCreature(kind, x, y);
  world.creatures.push(c);
  return c;
}

// Runs `seconds`, calling `each` after every tick; seeded.
function run(world: World, rt: Runtime, seconds: number, each: (t: number) => void, seed = 7): void {
  const was = Math.random;
  Math.random = seeded(seed);
  try {
    for (let k = 0; k < Math.round(seconds / TICK); k++) {
      stepHeadless(world, rt);
      each((k + 1) * TICK);
    }
  } finally {
    Math.random = was;
  }
}

// The longest time in a row it was frozen, and how often it was frozen then free (runs).
function frozenRuns(): { add: (c: Creature) => void; longest: () => number; runs: number[]; gaps: number[] } {
  let on = 0;
  let off = 0;
  let wasOn = false;
  const runs: number[] = [];
  const gaps: number[] = [];
  return {
    add(c) {
      const now = !c.dead && c.frozen > 0;
      if (now) {
        if (!wasOn && runs.length) gaps.push(off);
        on += TICK;
        off = 0;
      } else {
        if (wasOn) runs.push(on);
        on = 0;
        off += TICK;
      }
      wasOn = now;
    },
    longest: () => Math.max(on, ...runs, 0),
    runs,
    gaps,
  };
}

const chillOf = (c: Creature) => (c.data.chill as number | undefined) ?? 0;

export function coldChecks(check: Check): void {
  // The kinds used exist (a renamed species would make the checks pass for nothing).
  check(
    "cold: the kinds of the checks exist",
    ["deer", "polar bear", "villager", "beast"].every((k) => KINDS.has(k)),
  );
  // 1. No ambient trap.
  {
    const { world, rt } = island(peak);
    const deer = put(world, "deer", MID, MID);
    const fr = frozenRuns();
    let lowest = Infinity;
    run(world, rt, 120, () => {
      fr.add(deer);
      lowest = Math.min(lowest, world.temp[world.idx(deer.x, deer.y)]);
    });
    const here = world.temp[world.idx(deer.x, deer.y)];
    const warm = deer.dead || (here >= -6 && chillOf(deer) < 1);
    check(
      "cold: a deer on a temperate peak walks down, never held by the land's own cold",
      fr.longest() <= 0.6 && warm,
      `frozen ${fr.longest().toFixed(1)} s in a row at most (0.6), started at ${world.ambient(world.idx(MID, MID)).toFixed(0)} degrees, ends ${deer.dead ? "dead" : `at ${here.toFixed(0)} degrees, chill ${chillOf(deer).toFixed(1)} s, height ${world.height[world.idx(deer.x, deer.y)].toFixed(0)}`}`,
    );
  }

  // 2. Boxed in: a 5 by 5 hollow at 40 in land at 46, too steep to climb out of.
  {
    const box = (x: number, y: number) => (Math.abs(x - MID) <= 2 && Math.abs(y - MID) <= 2 ? 40 : 46);
    const { world, rt } = island(box);
    const deer = put(world, "deer", MID, MID);
    let died = -1;
    let gone = -1;
    let statue = false;
    run(world, rt, 140, (t) => {
      if (deer.dead && died < 0) {
        died = t;
        statue = !!deer.data.frostDeath;
      }
      if (died >= 0 && gone < 0 && !world.creatures.includes(deer)) gone = t;
    });
    check(
      "cold: boxed in on a cold peak, a deer dies of the cold in 55 to 85 s, a statue gone 40 s later",
      died >= 55 && died <= 85 && statue && gone > 0 && Math.abs(gone - died - 40) < 0.2,
      died < 0
        ? `alive after 140 s, frozen ${deer.frozen > 0}, health ${deer.hp.toFixed(0)}`
        : `died at ${died.toFixed(1)} s, a frost statue ${statue}, gone ${(gone - died).toFixed(1)} s after`,
    );
  }

  // 3. A spell's freeze is kept: 5 s, on warm land.
  {
    const { world, rt } = island(() => 14);
    const deer = put(world, "deer", MID, MID);
    rt.cast(
      {
        key: "freeze",
        name: "Freeze",
        tier: "minor",
        code: `const spell = { *cast(w) { for (const c of w.creatures(w.x, w.y, 4)) c.status("freeze", 5); } };`,
      },
      MID,
      MID,
    );
    const fr = frozenRuns();
    run(world, rt, 8, () => fr.add(deer));
    check("cold: a spell's freeze still holds for its time", Math.abs(fr.longest() - 5) < 0.2, `frozen ${fr.longest().toFixed(2)} s for a freeze of 5`);
  }

  // 4 and 5. A spell's cold, held at -40 over the whole island (ambient 15): 5 s, then 30 s.
  for (const [seconds, name] of [
    [5, "cold: a spell's cold freezes 3 s at most"],
    [30, "cold: lasting spell cold freezes 3 s, then lets go 4 s, again and again"],
  ] as const) {
    const { world, rt } = island(() => 14);
    const deer = put(world, "deer", MID, MID);
    const fr = frozenRuns();
    run(world, rt, seconds, () => {
      world.temp.fill(-40);
      fr.add(deer);
    });
    const runs = [...fr.runs];
    const longest = fr.longest();
    const ok =
      seconds === 5
        ? longest <= 3.05 && longest >= 2.9
        : longest <= 3.05 && runs.length >= 3 && fr.gaps.length >= 2 && fr.gaps.every((g) => g >= 3.95 && g <= 4.1);
    check(
      name,
      ok,
      `frozen ${runs.map((r) => r.toFixed(1)).join(", ") || longest.toFixed(1)} s, free ${fr.gaps.map((g) => g.toFixed(1)).join(", ") || "never"} s between`,
    );
  }

  // 6. A yeti on spell cold of -20, with the reactions of 4.12 on (its nature thaws it).
  {
    const { world, rt } = island(() => 14);
    world.reactions = true;
    rt.cast(
      {
        key: "yeti",
        name: "Yeti",
        tier: "minor",
        code: `const spell = { creatures: [{ name: "yeti", base: "beast", hp: 200, behavior: "wander", color: "#f0f4f8" }], *cast(w) { w.spawn("yeti", w.x, w.y); } };`,
      },
      MID,
      MID,
    );
    let yeti: Creature | undefined;
    let frozen = 0;
    run(world, rt, 20, () => {
      world.temp.fill(-20);
      yeti ??= world.creatures.find((c) => c.kind.startsWith("yeti"));
      if (yeti && yeti.frozen > 0) frozen += TICK;
    });
    check("cold: a yeti on -20 is never frozen by the land", !!yeti && frozen === 0, yeti ? `frozen ${frozen.toFixed(1)} s of 20` : "no yeti");
  }

  // 7. A polar bear on the temperate peak (-25), and people at home in a village at -14.
  {
    const { world, rt } = island(peak);
    const bear = put(world, "polar bear", MID, MID);
    let worst = 0;
    let frozen = 0;
    run(world, rt, 30, () => {
      worst = Math.max(worst, chillOf(bear));
      if (bear.frozen > 0) frozen += TICK;
    });
    // A village at height 35.6 (-14 there), houses round a square, people at home in it.
    const v = island(() => 35.6);
    for (const [hx, hy] of [
      [26, 26],
      [36, 26],
      [26, 36],
      [36, 36],
    ])
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) v.world.cover[(hy + dy) * SIZE + hx + dx] = C.HOUSE;
    const people = [0, 1, 2, 3].map((n) => put(v.world, "villager", 30 + n * 1.5, 31));
    let peopleChill = 0;
    let peopleFrozen = 0;
    run(v.world, v.rt, 30, () => {
      for (const p of people) {
        peopleChill = Math.max(peopleChill, chillOf(p));
        if (p.frozen > 0) peopleFrozen += TICK;
      }
    });
    check(
      "cold: a polar bear on a cold peak and people at home in a cold village never chill or freeze",
      worst === 0 && frozen === 0 && peopleChill === 0 && peopleFrozen === 0,
      `polar bear at ${world.ambient(world.idx(MID, MID)).toFixed(0)} degrees: chill ${worst.toFixed(1)} s, frozen ${frozen.toFixed(1)} s; people at ${v.world.ambient(0).toFixed(0)}: chill ${peopleChill.toFixed(1)} s, frozen ${peopleFrozen.toFixed(1)} s`,
    );
  }

  // 8. Paths take the warm way: a band of ground at -15 (x 25 to 39, y up to 22) between (20, 20)
  //    and (44, 20). Straight over it, 15 cold steps; round its end, 8 steps more, all warm.
  {
    const { world } = island(() => 14);
    for (let y = 0; y <= 22; y++) for (let x = 25; x <= 39; x++) world.temp[y * SIZE + x] = -15;
    const paths = pathsOf(world);
    let f = null;
    for (let k = 0; k < 200 && !f; k++) {
      f = paths.toward(world, Mobility.WALK, 44, 20);
      paths.step(world);
    }
    const dist = (f as unknown as { dist: Uint16Array } | null)?.dist;
    let cold = 0;
    let steps = 0;
    let at = 20 * SIZE + 20;
    while (dist && dist[at] > 0 && steps < 200) {
      let best = at;
      for (const d of [1, -1, SIZE, -SIZE]) if (dist[at + d] < dist[best]) best = at + d;
      if (best === at) break;
      at = best;
      steps++;
      if (world.temp[at] < -6) cold++;
    }
    check("cold: a trip's path goes round cold ground", !!dist && dist[at] === 0 && cold === 0, `${steps} steps to the end, ${cold} of them on cold ground`);
  }

  // The cairn: an explorer (a beast) roams a field with a road for four minutes.
  {
    const { world, rt } = island(() => 14);
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const i = y * SIZE + x;
        if ((x >> 2) % 2 === 0) world.ground[i] = G.FIELD;
        if ((x >> 2) % 4 === 0 && y % 2 === 0) world.cover[i] = C.CROP;
        if (y === 20 || y === 44) world.ground[i] = G.ROAD;
      }
    for (let n = 0; n < 4; n++) put(world, "beast", 16 + n * 10, 30 + (n % 2) * 6);
    run(world, rt, 240, () => {});
    const stones = [...world.decor.entries()];
    const cells = new Map<number, number[]>();
    let bad = 0;
    for (const [key, v] of stones) {
      const i = keyY(key) * SIZE + keyX(key);
      if (world.ground[i] === G.FIELD || world.ground[i] === G.ROAD || world.cover[i] === C.CROP) bad++;
      cells.set(i, [...(cells.get(i) ?? []), voxelColor(v)]);
    }
    // A cairn is the stones of one place: cells that touch.
    const groups: number[][] = [];
    const seen = new Set<number>();
    for (const i of cells.keys()) {
      if (seen.has(i)) continue;
      const g: number[] = [];
      const todo = [i];
      seen.add(i);
      while (todo.length) {
        const j = todo.pop()!;
        g.push(...cells.get(j)!);
        for (const d of [1, -1, SIZE, -SIZE])
          if (cells.has(j + d) && !seen.has(j + d)) {
            seen.add(j + d);
            todo.push(j + d);
          }
      }
      groups.push(g);
    }
    const single = groups.filter((g) => g.length < 3 || new Set(g).size < 2).length;
    check(
      "cold: a cairn is stacked stones, never on a field, a crop or a road",
      groups.length > 0 && bad === 0 && single === 0,
      `${groups.length} cairns of ${stones.length} stones; ${bad} stones on a field, a crop or a road; ${single} a single box or of one grey`,
    );
  }
}
