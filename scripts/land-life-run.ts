// Dev only (4.4): scripts/land-life.ts on every biome, printed in full.
//   npx esbuild scripts/land-life-run.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/land-life.mjs --log-level=warning
//   node node_modules/.cache/land-life.mjs [seconds] [shape] [seed]
import { BIOMES, type Shape } from "../src/sim/land";
import { Runtime } from "../src/sim/runtime";
import { landLife, landProblems } from "./land-life";

Runtime.slowMs = Infinity;
const seconds = Number(process.argv[2] ?? 180);
const shape = (process.argv[3] ?? "coast") as Shape;
const seed = Number(process.argv[4] ?? 7);
for (const biome of BIOMES) {
  const t0 = performance.now();
  const r = landLife(biome, shape, seed, seconds);
  const p = landProblems(r);
  console.log(
    `${biome.padEnd(9)} ${shape} ${((performance.now() - t0) / 1000).toFixed(1)} s  ${p.length ? "PROBLEMS: " + p.join("; ") : "ok"}\n` +
      `   ${Object.entries(r.species)
        .map(([k, s]) => `${k} ${s.start}/${s.min}/${s.end} (hab ${s.habitat})`)
        .join(", ")}\n` +
      `   villagers ${r.villagers.start}->${r.villagers.end} houses ${r.houses.start}->${r.houses.end} river ${r.river.start}->${r.river.end} sea +${r.seaRise} wet houses ${r.wetHouses} burning ${r.burning} lava ${r.lava.start}->${r.lava.end}`,
  );
}
