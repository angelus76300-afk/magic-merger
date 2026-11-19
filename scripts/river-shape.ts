// Dev only (4.4.1): how rivers wind, over a few seeds of every shape
// (river-metrics.ts); and (19 November) how square their banks turn and how
// often their water drops in a small fall.
//
//   npx esbuild scripts/river-shape.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/river-shape.mjs && node node_modules/.cache/river-shape.mjs [size] [seeds]
import { DEFAULT_LAND, BIOMES, SHAPES } from "../src/sim/land";
import { generateWorld } from "../src/sim/world";
import { riverCorners, riverFalls, riverMask, riverShape, riverSteps, riverTrenches } from "./river-metrics";

const size = Number(process.argv[2] ?? 152);
const seeds = Number(process.argv[3] ?? 6);
let longest = 0;
let straight = 0;
let winding = 0;
let n = 0;
let trenches = 0;
let cells = 0;
let square = 0;
let corners = 0;
let steps = 0;
let small = 0;
let big = 0;
let uneven = 0;
let walked = 0;
let water = 0;
for (let s = 0; s < seeds; s++)
  for (const shape of SHAPES) {
    const world = generateWorld(size, size, 50 + s, { ...DEFAULT_LAND, biome: BIOMES[s % BIOMES.length], shape });
    const r = riverShape(world);
    const t = riverTrenches(world);
    const mask = riverMask(world);
    const c = riverCorners(world, mask);
    const st = riverSteps(world, mask);
    const sm = riverSteps(world, mask, 0.125);
    big += riverSteps(world, mask, 0.5).steps;
    const f = riverFalls(world);
    uneven += f.uneven;
    walked += f.steps;
    square += c.square;
    corners += c.corners;
    steps += st.steps;
    small += sm.steps;
    water += st.cells;
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
console.log(
  `banks: ${square} of ${corners} outline corners square (${((square / Math.max(1, corners)) * 100).toFixed(1)}%); falls over 0.25: ${steps} in ${water} river cells (${((steps / Math.max(1, water)) * 100).toFixed(1)} per 100), over 0.125: ${small} (${((small / Math.max(1, water)) * 100).toFixed(1)} per 100), over 0.5: ${big} (${((big / Math.max(1, water)) * 100).toFixed(1)} per 100); uneven falls along the walks: ${uneven} in ${walked} steps (${((uneven / Math.max(1, walked)) * 100).toFixed(1)} per 100)`,
);
