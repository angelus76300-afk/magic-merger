// Dev only (4.4): every biome and shape on one seed, with what the island
// holds: water, rivers, villages, each species' habitat, and the time it took.
//
//   npx esbuild scripts/land-stats.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/land-stats.mjs && node node_modules/.cache/land-stats.mjs [size] [seed]
import { BIOMES, SHAPES, DEFAULT_LAND, habitatCount } from "../src/sim/land";
import { C, F, G } from "../src/sim/materials";
import { SPECIES } from "../src/sim/wildlife";
import { generateWorld } from "../src/sim/world";

const size = Number(process.argv[2] ?? 152);
const seed = Number(process.argv[3] ?? 7);
const only = process.argv[4];
for (const biome of BIOMES) {
  for (const shape of SHAPES) {
    if (only && !`${biome}/${shape}`.includes(only)) continue;
    const t0 = performance.now();
    const w = generateWorld(size, size, seed, { ...DEFAULT_LAND, biome, shape });
    const ms = performance.now() - t0;
    let sea = 0;
    let fresh = 0;
    let lava = 0;
    let trees = 0;
    let houses = 0;
    let grass = 0;
    for (let i = 0; i < w.n; i++) {
      if (w.fluid[i] === F.WATER && w.height[i] < w.seaLevel) sea++;
      else if (w.fluid[i] === F.WATER) fresh++;
      if (w.fluid[i] === F.LAVA) lava++;
      if (w.cover[i] === C.TREE) trees++;
      if (w.cover[i] === C.HOUSE) houses++;
      if (w.ground[i] === G.GRASS) grass++;
    }
    const pct = (v: number) => `${Math.round((v / w.n) * 100)}%`;
    const hab = SPECIES.map((s) => `${s.kind.name} ${habitatCount(w, s)}`).join(", ");
    console.log(
      `${biome.padEnd(9)} ${shape.padEnd(11)} ${Math.round(ms)} ms  sea ${pct(sea)} fresh ${pct(fresh)} lava ${lava} grass ${pct(grass)} trees ${pct(trees)} houses ${houses} springs ${w.springs.length} villages ${w.villages.length}\n    ${hab}`,
    );
  }
}
