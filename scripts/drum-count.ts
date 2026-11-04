// Dev only (4.1): the sounds a busy island plays by itself, counted. The large
// island (208 cells, seed 11) as a new player gets it, populated, for
// DRUM_SECONDS (default 120) from morning, with no spell cast: every sound is
// routine life. Prints each sound name with how often it played and at what
// size (a woodcutter's tree was "thump at 0.15", a house built "thump at 0.4").
//   npx esbuild scripts/drum-count.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/drum.mjs --log-level=warning
//   node node_modules/.cache/drum.mjs
import { populate, resetCreatureIds } from "../src/sim/creatures";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepWorld } from "../src/sim/tick";
import { TICK, generateWorld } from "../src/sim/world";

Math.random = seeded(11);

const SECONDS = Number(process.env.DRUM_SECONDS ?? 120);
resetCreatureIds();
const world = generateWorld(208, 208, 11);
populate(world);
world.time = 20;
const rt = new Runtime(world, (_k, _n, m) => console.log("  error:", m));
const heard = new Map<string, { n: number }>();
for (let tick = 0; tick < SECONDS / TICK; tick++) {
  stepWorld(world, rt);
  for (const e of world.events) {
    if (e.kind !== "sound") continue;
    const key = `${e.name} at ${e.size}`;
    const h = heard.get(key) ?? { n: 0 };
    h.n++;
    heard.set(key, h);
  }
  world.events.length = 0;
}
const villagers = world.creatures.filter((c) => c.kind === "villager" && !c.dead).length;
console.log(`large island 208, seed 11, ${SECONDS} s, ${villagers} villagers alive at the end, no spell cast`);
const total = [...heard.values()].reduce((s, h) => s + h.n, 0);
for (const [name, h] of [...heard].sort((x, y) => y[1].n - x[1].n))
  console.log(`  ${name.padEnd(14)} ${String(h.n).padStart(4)} times, one every ${(SECONDS / h.n).toFixed(1)} s`);
console.log(`  ${total} sounds in all${total ? `, one every ${(SECONDS / total).toFixed(1)} s` : ""}`);
