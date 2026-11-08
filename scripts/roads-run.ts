// Dev only (4.9): an island left alone, its roads watched minute by minute.
//   npx esbuild scripts/roads-run.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/roads-run.mjs --log-level=warning
//   node node_modules/.cache/roads-run.mjs [minutes] [size] [seed...]
// Prints, each minute: villages, roads marked out, cells laid of them,
// bridges, worn dirt road cells, the share of land that is road, and the
// p95 of the tick in ms.
import { populate, resetCreatureIds } from "../src/sim/creatures";
import { DEFAULT_LAND, resolveLand } from "../src/sim/land";
import { C, G } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { laid } from "../src/sim/roads";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { generateWorld } from "../src/sim/world";

Runtime.slowMs = Infinity;
const minutes = Number(process.argv[2] ?? 12);
const size = Number(process.argv[3] ?? 208);
const seeds = process.argv.slice(4).map(Number);
for (const seed of seeds.length ? seeds : [7, 11, 23]) {
  Math.random = seeded(seed * 7 + 1);
  resetCreatureIds();
  const land = resolveLand(DEFAULT_LAND, seed, size);
  const world = generateWorld(size, size, seed, land);
  populate(world);
  world.time = 20;
  const rt = new Runtime(world, () => {});
  let first = -1;
  for (let m = 1; m <= minutes; m++) {
    const ticks: number[] = [];
    for (let t = 0; t < 1800; t++) {
      const a = performance.now();
      stepHeadless(world, rt);
      ticks.push(performance.now() - a);
    }
    ticks.sort((a, b) => a - b);
    let roadCells = 0;
    let landCells = 0;
    for (let i = 0; i < world.n; i++) {
      if (world.depth[i] > 0.05) continue;
      landCells++;
      if (world.ground[i] === G.ROAD) roadCells++;
    }
    let laidCells = 0;
    let total = 0;
    let bridges = 0;
    for (const r of world.roads) {
      total += r.cells.length;
      r.cells.forEach((i, k) => {
        if (laid(world, r, k)) laidCells++;
        if (world.cover[i] === C.BRIDGE) bridges++;
      });
    }
    if (first < 0 && world.roads.length) first = m;
    console.log(
      `seed ${seed} min ${String(m).padStart(2)}: villages ${world.villages.length} roads ${world.roads.length} laid ${laidCells}/${total} bridges ${bridges} road cells ${roadCells} (${((roadCells / landCells) * 100).toFixed(2)}% of land) villagers ${world.creatures.filter((c) => !c.dead && c.kind === "villager").length} p95 ${ticks[Math.floor(ticks.length * 0.95)].toFixed(2)} ms`,
    );
  }
  console.log(
    `seed ${seed}: first road marked out at minute ${first < 0 ? "never" : first}; ${world.roads.map((r) => `${r.a} to ${r.b} (${r.cells.length})`).join(", ")}`,
  );
  console.log(
    world.story
      .slice(-8)
      .map((l) => "  " + l.text)
      .join("\n"),
  );
}
