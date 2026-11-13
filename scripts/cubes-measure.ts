// Triangles of the houses and trees in small cubes (5.2.5), each model against the old one.
//   npx esbuild scripts/cubes-measure.ts --bundle --platform=node --format=esm --outfile=/tmp/cm.mjs && node /tmp/cm.mjs
import { TREE_STYLES, type TreeStyle } from "../src/sim/ecology";
import { floraModels } from "../src/sim/voxel/flora";
import { FINE_VARIANTS, cubeTree } from "../src/sim/voxel/cubes";

const old = floraModels();
for (const s of TREE_STYLES) {
  if (!s) continue;
  const t0 = performance.now();
  const fine = Array.from({ length: FINE_VARIANTS }, (_, v) => cubeTree(s as Exclude<TreeStyle, "">, v).tris);
  console.log(`tree ${s}: ${fine.join(" / ")} triangles (old ${(old[`tree:${s}:0`]?.length ?? 0) * 10}), ${(performance.now() - t0).toFixed(1)} ms`);
}
