// Where the fine land's triangles go: rectangles by kind, on the three test islands at the whole
// island zoom (the looks audit of 15 November). Drawing only.
//
//   npx esbuild scripts/looks-count.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/looks-count.mjs && node node_modules/.cache/looks-count.mjs
import { Writer } from "../src/sim/voxel/terrain";
import { LOOK_ISLANDS, buildIsland } from "./terrain-looks-test";
import { GRAPHICS } from "../src/sim/voxel/graphics";

// OFF=relief,grain turns switches off, to see what each costs.
for (const f of (process.env.OFF ?? "").split(",").filter(Boolean)) (GRAPHICS as Record<string, boolean>)[f] = false;

const counts = new Map<string, number>();
const rect = Writer.prototype.rect;
Writer.prototype.rect = function (dir, x0, x1, y0, y1, z0, z1, color, light, alpha, decal = 0, foot = 1) {
  const h = y1 - y0;
  const kind = dir === 4 ? (decal ? "top" : "top, no drawings") : dir === 5 ? "bottom" : h <= 0.25 + 1e-6 ? "wall, low" : "wall, tall";
  counts.set(kind, (counts.get(kind) ?? 0) + 2);
  rect.call(this, dir, x0, x1, y0, y1, z0, z1, color, light, alpha, decal, foot);
};
for (let k = 0; k < (process.env.ONE ? 1 : LOOK_ISLANDS.length); k++) {
  counts.clear();
  const I = LOOK_ISLANDS[k];
  const b = buildIsland(I.cells, I.seed, I.land, "far");
  console.log(I.name, "land", b.landTriangles, JSON.stringify(Object.fromEntries(counts)));
}
