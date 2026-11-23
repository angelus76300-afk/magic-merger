// Dev only: what one Fire tap on a house does to its village (23 November, a playtest: one
// tap of the base Fire on a house burned about 8 houses in 10 seconds, twice).
//   npx esbuild scripts/fire-run.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/fire-run.mjs --log-level=warning
//   node node_modules/.cache/fire-run.mjs [seconds=30] [seeds=10]
// On a fresh medium island of each seed (the player's default island, taller peaks, wild
// animals and no wonders, no weather), 20 seconds in, Fire (minor) is cast on the house block
// nearest the centre of the first village. Counted: house blocks (two by two, as drawn) of that
// village that burned (a cell turned to rubble) within the time, and cells on fire at its end.
// Three programs: two stored Fire programs (lab/legacy/v3-fire.js and the one the library
// measurement traced, scripts/spell-pairs.ts), and the engine alone (one cell set alight).
import { readFileSync } from "node:fs";
import { populate, resetCreatureIds } from "../src/sim/creatures";
import { tileHouses } from "../src/sim/homes";
import { DEFAULT_LAND, resolveLand } from "../src/sim/land-options";
import { C } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { TICK, generateWorld } from "../src/sim/world";

Runtime.slowMs = Infinity;

const SECONDS = Number(process.argv[2] ?? 30);
const SEEDS = Number(process.argv[3] ?? 10);
const PROGRAMS: Record<string, string> = {
  "v3 Fire": readFileSync("lab/legacy/v3-fire.js", "utf8"),
  "traced Fire": `const spell = { *cast(w) { w.sound("whoosh", 0.4); for (let k = 0; k < 4; k++) { w.ignite(w.x + w.rand(-4, 4), w.y + w.rand(-4, 4), 5, 0.8); yield 0.3; } } };`,
  "one cell": "",
};

function scene(seed: number, which: string): { blocks: number; burned: number; lit: number; fire: number } {
  Math.random = seeded(seed);
  resetCreatureIds(1);
  const size = 152;
  const world = generateWorld(size, size, seed, { ...resolveLand({ ...DEFAULT_LAND }, seed, size), peaks: true });
  populate(world);
  world.wonders = [];
  world.reactions = true;
  const rt = new Runtime(world, () => {});
  for (let k = 0; k < Math.round(20 / TICK); k++) stepHeadless(world, rt);
  const s = world.settlements[0];
  const top = tileHouses(world);
  const blocks = new Map<number, number[]>();
  for (let i = 0; i < world.n; i++) {
    if (top[i] < 0) continue;
    const x = i % world.w;
    const y = Math.floor(i / world.w);
    if (Math.hypot(x - s.x, y - s.y) > 24) continue;
    const b = blocks.get(top[i]) ?? [];
    b.push(i);
    blocks.set(top[i], b);
  }
  let aim = -1;
  let best = Infinity;
  for (const b of blocks.keys()) {
    const d = Math.hypot((b % world.w) + 1 - s.x, Math.floor(b / world.w) + 1 - s.y);
    if (d < best) {
      best = d;
      aim = b;
    }
  }
  const x = (aim % world.w) + 1;
  const y = Math.floor(aim / world.w) + 1;
  Math.random = seeded(seed * 31 + 7);
  if (which === "one cell") world.fire[aim] = 0.8;
  else rt.cast({ key: "fire", name: "Fire", tier: "minor", code: PROGRAMS[which] }, x, y);
  const burned = new Set<number>();
  let lit = 0;
  for (let k = 0; k < Math.round(SECONDS / TICK); k++) {
    stepHeadless(world, rt);
    for (const [b, cells] of blocks) if (!burned.has(b) && cells.some((i) => world.cover[i] === C.RUBBLE)) burned.add(b);
    // Blocks alight one second in: what the spell itself reached.
    if (k === Math.round(1 / TICK)) for (const cells of blocks.values()) if (cells.some((i) => world.fire[i] > 0.05)) lit++;
  }
  let fire = 0;
  for (let i = 0; i < world.n; i++) if (world.fire[i] > 0.05) fire++;
  return { blocks: blocks.size, burned: burned.size, lit, fire };
}

for (const which of Object.keys(PROGRAMS)) {
  const rows: string[] = [];
  let sum = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = scene(seed, which);
    sum += r.burned;
    rows.push(`${seed}:${r.burned}/${r.blocks} (lit at 1 s ${r.lit}, fire ${r.fire})`);
  }
  console.log(`${which}: mean ${(sum / SEEDS).toFixed(1)} houses burned in ${SECONDS} s | ${rows.join(" ")}`);
}
