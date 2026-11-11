// Dev only (4.9 part 2): an island left alone, its building sites watched
// minute by minute.
//   npx esbuild scripts/builds-run.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/builds-run.mjs --log-level=warning
//   node node_modules/.cache/builds-run.mjs [minutes] [size] [seed...]
// Prints, each minute: villages, house blocks, job buildings, sites going
// up (and of what), villagers, and the p95 of the tick in ms.
import { populate, resetCreatureIds } from "../src/sim/creatures";
import { DEFAULT_LAND, resolveLand } from "../src/sim/land";
import { C } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { handsOn, stageOf } from "../src/sim/sites";
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
  const all: number[] = [];
  // Sites that went without becoming what they were meant to be, and why.
  let prev: typeof world.sites = [];
  const lost = new Map<string, number>();
  for (let m = 1; m <= minutes; m++) {
    const ticks: number[] = [];
    for (let t = 0; t < 1800; t++) {
      const a = performance.now();
      stepHeadless(world, rt);
      ticks.push(performance.now() - a);
      if (t % 15 === 0) {
        for (const o of prev)
          if (!world.sites.includes(o)) {
            const cov = [o.i, o.i + 1, o.i + world.w, o.i + world.w + 1].map((j) => world.materials.get("cover", world.cover[j]).name);
            if (cov.every((n) => n === world.materials.get("cover", o.kind).name)) continue;
            const why = [...new Set(cov)].join("+") + ` at stage ${stageOf(o)} (${o.kind === C.HOUSE ? "house" : o.kind})`;
            lost.set(why, (lost.get(why) ?? 0) + 1);
          }
        prev = [...world.sites];
      }
    }
    all.push(...ticks);
    ticks.sort((a, b) => a - b);
    let house = 0;
    for (let i = 0; i < world.n; i++) if (world.cover[i] === C.HOUSE) house++;
    const jobs = world.settlements.reduce((n, s) => n + (s.jobs?.length ?? 0), 0);
    const sites = world.sites ?? [];
    console.log(
      `seed ${seed} min ${String(m).padStart(2)}: villages ${world.villages.length} houses ${house / 4} jobs ${jobs} sites ${sites.length}${sites.length ? ` [${sites.map((s) => `${s.kind === C.HOUSE ? "h" : s.kind}:${stageOf(s)}:${Math.round(world.time - s.since)}s:${handsOn(world, s)}`).join(" ")}]` : ""} villagers ${world.creatures.filter((c) => !c.dead && c.kind === "villager").length} wood ${world.villages.reduce((n, v) => n + Math.floor(v.wood), 0)} p95 ${ticks[Math.floor(ticks.length * 0.95)].toFixed(2)} ms`,
    );
  }
  all.sort((a, b) => a - b);
  console.log(`seed ${seed}: sites lost: ${[...lost].map(([k, n]) => `${n} ${k}`).join("; ") || "none"}`);
  console.log(`seed ${seed}: p95 over the run ${all[Math.floor(all.length * 0.95)].toFixed(2)} ms`);
  console.log(
    world.story
      .slice(-10)
      .map((l) => "  " + l.text)
      .join("\n"),
  );
}
