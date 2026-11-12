// Dev only (4.9 part 3): how often a market trip is under way on an untouched island.
import { populate } from "../src/sim/creatures";
import { DEFAULT_LAND, resolveLand } from "../src/sim/land";
import { onTrip } from "../src/sim/map";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { raiseWonders } from "../src/sim/wonderbuild";
import { generateWorld } from "../src/sim/world";

Runtime.slowMs = Infinity;
for (const size of [112, 152, 208]) {
  for (const seed of [3, 8]) {
    Math.random = seeded(seed * 31 + size);
    const world = generateWorld(size, size, seed, resolveLand({ ...DEFAULT_LAND }, seed, size));
    populate(world);
    const rt = new Runtime(world, () => undefined);
    raiseWonders(world, rt);
    let started = 0;
    let busy = 0;
    let samples = 0;
    let gap = 0;
    let longest = 0;
    let on = new Set<number>();
    const lengths: number[] = [];
    const since = new Map<number, number>();
    for (let t = 0; t < 15 * 60 * 30; t++) {
      stepHeadless(world, rt);
      if (t < 5 * 60 * 30 || t % 30) continue;
      const now = new Set(world.creatures.filter(onTrip).map((c) => c.id));
      for (const id of now)
        if (!on.has(id)) {
          started++;
          since.set(id, world.time);
        }
      for (const id of on) if (!now.has(id) && since.has(id)) lengths.push(world.time - since.get(id)!);
      on = now;
      samples++;
      if (now.size) {
        busy++;
        gap = 0;
      } else longest = Math.max(longest, ++gap);
    }
    const mean = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
    console.log(
      `size ${size} seed ${seed}: villages ${world.villages.length}, trips started ${(started / 10).toFixed(1)}/min, a cart on the island ${Math.round((100 * busy) / samples)}% of seconds, longest gap ${longest} s, trip ${Math.round(mean)} s`,
    );
  }
}
