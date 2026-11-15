// How many trees an island has and what they cost in small cubes (the looks audit of 15 November).
//
//   npx esbuild scripts/looks-trees-count.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/looks-trees-count.mjs && node node_modules/.cache/looks-trees-count.mjs
import { generateWorld } from "../src/sim/world";
import { C } from "../src/sim/materials";
import { cubeTree } from "../src/sim/voxel/cubes";
import { TREE_STYLES, STYLE_BITS } from "../src/sim/ecology";
import { LOOK_ISLANDS } from "./terrain-looks-test";

for (const I of LOOK_ISLANDS) {
  const world = generateWorld(I.cells, I.cells, I.seed, I.land);
  const by = new Map<string, number>();
  let trees = 0;
  for (let i = 0; i < world.n; i++) {
    if (world.cover[i] !== C.TREE) continue;
    trees++;
    const style = world.flora ? TREE_STYLES[world.flora[i] & STYLE_BITS] || "oak" : "oak";
    by.set(style, (by.get(style) ?? 0) + 1);
  }
  let tris = 0;
  for (const [style, n] of by) tris += n * cubeTree(style as never, 0).tris;
  console.log(I.name, "trees", trees, "cube triangles", tris, JSON.stringify([...by].map(([s, n]) => [s, n, cubeTree(s as never, 0).tris])));
}
