// Dev only (4.4.1): how rivers wind, over a few seeds of every shape
// (river-metrics.ts).
//
//   npx esbuild scripts/river-shape.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/river-shape.mjs && node node_modules/.cache/river-shape.mjs [size] [seeds]
import { DEFAULT_LAND, BIOMES, SHAPES } from "../src/sim/land";
import { generateWorld } from "../src/sim/world";
import { riverShape, riverTrenches } from "./river-metrics";

const size = Number(process.argv[2] ?? 152);
const seeds = Number(process.argv[3] ?? 6);
let longest = 0;
let straight = 0;
let winding = 0;
let n = 0;
let trenches = 0;
let cells = 0;
for (let s = 0; s < seeds; s++)
  for (const shape of SHAPES) {
    const world = generateWorld(size, size, 50 + s, { ...DEFAULT_LAND, biome: BIOMES[s % BIOMES.length], shape });
    const r = riverShape(world);
    const t = riverTrenches(world);
    trenches += t.trenches;
    cells += t.cells;
    if (!r.steps) continue;
    longest = Math.max(longest, r.longest);
    straight += r.straight;
    winding += r.winding;
    n++;
  }
console.log(
  `${n} islands: longest straight run ${longest} cells, ${((straight / n) * 100).toFixed(0)}% of river steps in runs of 8+, winding ${(winding / n).toFixed(2)}, ${trenches} of ${cells} river cells in a trench`,
);
