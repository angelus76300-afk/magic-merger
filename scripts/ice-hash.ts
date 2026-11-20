// Ice in eighths (20 November): hashes of the water meshes (fine and whole cells) of islands with
// and without ice, on high, medium and low, to show that what has no ice draws exactly as before.
//   npx esbuild scripts/ice-hash.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/ice-hash.mjs --log-level=warning && node node_modules/.cache/ice-hash.mjs
import { createHash } from "node:crypto";
import { MeshBasicMaterial, type Mesh } from "three";
import { generateWorld } from "../src/sim/world";
import { readLand } from "../src/sim/land";
import { Terrain } from "../src/sim/voxel/terrain";
import { applyLooks } from "../src/sim/voxel/graphics";
import { F } from "../src/sim/materials";

const ISLANDS: [string, number, string, string][] = [
  ["temperate-lakes-7", 7, "temperate", "lakes"],
  ["temperate-coast-7", 7, "temperate", "coast"],
  ["tundra-lakes-5", 5, "tundra", "lakes"],
];
for (const level of ["high", "medium", "low"] as const) {
  applyLooks({ level, flip: [] }, level);
  for (const [name, seed, biome, shape] of ISLANDS) {
    const world = generateWorld(152, 152, seed, readLand({ biome, shape }));
    let ice = 0;
    for (let i = 0; i < world.n; i++) if (world.fluid[i] === F.ICE) ice++;
    const meshes: Mesh[] = [];
    const land = new MeshBasicMaterial();
    const fluid = new MeshBasicMaterial();
    const t = new Terrain(
      world,
      land,
      fluid,
      (m) => meshes.push(m),
      (m) => meshes.splice(meshes.indexOf(m), 1),
    );
    t.scan();
    t.rebuild(true);
    t.focus(world.w * 0.3, 60, world.h * 0.3, 0, 0);
    t.updateFine(0, true);
    const hw = createHash("sha256");
    const hl = createHash("sha256");
    for (const m of meshes) {
      const h = m.material === fluid ? hw : hl;
      for (const a of ["position", "color", "waterFine", "wave"]) {
        const at = m.geometry.getAttribute(a);
        if (at) h.update(Buffer.from((at.array as Float32Array).buffer));
      }
    }
    console.log(level, name, `ice ${ice}`, "water", hw.digest("hex").slice(0, 12), "land", hl.digest("hex").slice(0, 12));
  }
}
