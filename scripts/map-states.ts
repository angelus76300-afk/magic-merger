// The island as a map (roadmap 4.9 part 3): islands played headless for some
// minutes, saved, for the reading test's frames (scripts/map-frames.mjs) and
// the truth they are scored against. The same seed gives the same island and
// the same minutes: Math.random is seeded while it runs.
//   esbuild scripts/map-states.ts ... && node map-states.mjs <out dir> [minutes] [size] [seeds]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { housesOf, tierOf } from "../src/sim/buildings";
import { populate } from "../src/sim/creatures";
import { DEFAULT_LAND, resolveLand } from "../src/sim/land";
import { C } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { laid } from "../src/sim/roads";
import { Runtime } from "../src/sim/runtime";
import { saveWorld } from "../src/sim/save";
import { stepHeadless } from "../src/sim/tick";
import { startWildfire } from "../src/sim/troubles";
import { raiseWonders } from "../src/sim/wonderbuild";
import { generateWorld } from "../src/sim/world";

const [out = "/tmp/map-frames/states", minutesArg = "12", sizeArg = "208", seedsArg = "3,5,8,13,21"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const minutes = Number(minutesArg);
const size = Number(sizeArg);
const seeds = seedsArg.split(",").map(Number);
const truth: Record<string, unknown> = {};
Runtime.slowMs = Infinity;
for (const [k, seed] of seeds.entries()) {
  const random = Math.random;
  Math.random = seeded(seed * 7919 + 1);
  const world = generateWorld(size, size, seed, resolveLand({ ...DEFAULT_LAND }, seed, size));
  populate(world);
  const rt = new Runtime(world, () => undefined);
  raiseWonders(world, rt);
  const ticks = Math.round(minutes * 60 * 30);
  // Every other island has a fire by a village two minutes before the end: some are hurt.
  const fireAt = k % 2 === 1 ? ticks - 2 * 60 * 30 : -1;
  for (let t = 0; t < ticks; t++) {
    if (t === fireAt) startWildfire(world, seeded(seed));
    stepHeadless(world, rt);
  }
  Math.random = random;
  writeFileSync(join(out, `${seed}.json`), JSON.stringify(saveWorld(world, rt.owners)));
  const near = (x: number, y: number, r: number, test: (i: number) => boolean) => {
    let n = 0;
    for (let yy = Math.max(0, Math.round(y - r)); yy <= Math.min(world.h - 1, Math.round(y + r)); yy++)
      for (let xx = Math.max(0, Math.round(x - r)); xx <= Math.min(world.w - 1, Math.round(x + r)); xx++)
        if (Math.hypot(xx - x, yy - y) <= r && test(yy * world.w + xx)) n++;
    return n;
  };
  truth[seed] = {
    time: world.time,
    trouble: world.trouble ? { name: world.trouble.name, stage: world.trouble.stage } : null,
    villages: world.settlements.map((s) => {
      const v = world.villages.reduce((b, o) => (Math.hypot(o.x - s.x, o.y - s.y) < Math.hypot(b.x - s.x, b.y - s.y) ? o : b), world.villages[0]);
      return {
        name: s.name,
        x: Math.round(s.x),
        y: Math.round(s.y),
        houses: housesOf(world, s),
        tier: tierOf(housesOf(world, s)),
        people: v && Math.hypot(v.x - s.x, v.y - s.y) < 22 ? v.people : 0,
        rubble: near(s.x, s.y, 18, (i) => world.cover[i] === C.RUBBLE) / 4,
        burning: near(s.x, s.y, 18, (i) => world.fire[i] > 0.05),
        sites: world.sites.filter((t) => Math.hypot((t.i % world.w) - s.x, Math.floor(t.i / world.w) - s.y) < 22).length,
      };
    }),
    roads: world.roads.map((r) => ({
      a: r.a,
      b: r.b,
      cells: r.cells.length,
      laid: Math.round((r.cells.filter((_, j) => laid(world, r, j)).length / r.cells.length) * 100),
    })),
  };
  console.log(`seed ${seed}: saved`);
}
writeFileSync(join(out, "truth.json"), JSON.stringify(truth, null, 1));
