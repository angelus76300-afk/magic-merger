// Dev only: what each part of a tick costs while a spell runs, in Node.
//   npx esbuild scripts/prof-spell.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/prof.mjs --log-level=warning
//   node node_modules/.cache/prof.mjs [spell.js | spell.json]...
// Without a file it profiles three scenes: an idle island, a world tree (many
// voxels) and a crowd (300 creatures, hunters among villagers). Prints p50,
// p95 and max per part over 20 simulated seconds, seeded, so two runs of the
// same code agree to within timer noise. Add --cpu-prof to node for a
// function by function profile.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { isTier } from "../shared/tiers";
import { lifeCycle, makeCreature, populate, resetCreatureIds, updateCreature } from "../src/sim/creatures";
import { forDisc, stepPhysics } from "../src/sim/physics";
import { igniteVoxels } from "../src/sim/voxels";
import { Runtime } from "../src/sim/runtime";
import { TICK, generateWorld } from "../src/sim/world";

function seed(n: number): void {
  let a = n >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Scene {
  name: string;
  code?: string;
  tier?: string;
  crowd?: number;
  // Seconds after which the tree at the center is set alight.
  burnAt?: number;
}

const scenes: Scene[] = process.argv.slice(2).length
  ? process.argv.slice(2).map((file) => {
      const text = readFileSync(file, "utf8");
      if (file.endsWith(".json")) {
        const json = JSON.parse(text);
        return { name: json.name ?? basename(file), code: json.program?.code ?? json.code, tier: json.tier };
      }
      return { name: basename(file), code: text, tier: process.env.PROF_TIER ?? "legendary" };
    })
  : [
      { name: "idle island" },
      { name: "world tree", code: readFileSync("lab/spells/world-tree.js", "utf8"), tier: "legendary" },
      {
        name: "burning forest",
        // A giant tree and a ring of oaks, set alight once they stand.
        code: `const spell = { *cast(w) { w.tree(w.x, w.y, { style: "giant", height: 60 }); for (let k = 0; k < 16; k++) w.tree(w.x + Math.cos(k) * 14, w.y + Math.sin(k) * 14, { style: k % 2 ? "oak" : "pine", height: 18 }); } };`,
        tier: "legendary",
        burnAt: 12,
      },
      { name: "crowd of 300", crowd: 300 },
    ];

// PROF_ONLY=forest keeps the scenes whose name contains the word.
if (process.env.PROF_ONLY) scenes.splice(0, scenes.length, ...scenes.filter((s) => s.name.includes(process.env.PROF_ONLY!)));
const SECONDS = Number(process.env.PROF_SECONDS ?? 20);
const stats = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `${q(0.5).toFixed(2)} / ${q(0.95).toFixed(2)} / ${s[s.length - 1].toFixed(1)}`;
};

console.log(`ms per tick, p50 / p95 / max over ${SECONDS} s (30 ticks a second)`);
for (const scene of scenes) {
  seed(11);
  resetCreatureIds();
  const world = generateWorld(152, 152, 11);
  populate(world);
  const rt = new Runtime(world, (_k, _n, m) => console.log("  error:", m));
  if (scene.code) rt.cast({ key: "p", name: scene.name, tier: isTier(scene.tier) ? scene.tier : "legendary", code: scene.code }, 76, 76);
  if (scene.crowd) {
    const kinds = ["villager", "villager", "villager", "beast", "beast", "spirit"];
    for (let k = world.creatures.length; k < scene.crowd; k++) {
      const c = makeCreature(kinds[k % kinds.length], 30 + Math.random() * 92, 30 + Math.random() * 92);
      world.creatures.push(c);
    }
    rt.cast(
      {
        key: "wolves",
        name: "Wolves",
        tier: "major",
        code: `const spell = { creatures: [{ name: "wolf", base: "beast", behavior: "hunt", prey: ["villager"], attack: 4, hp: 300 }], *cast(w) { for (let k = 0; k < 12; k++) w.spawn("wolf", w.x + k % 4, w.y + (k >> 2)); } };`,
      },
      76,
      76,
    );
  }
  const parts = { physics: [] as number[], creatures: [] as number[], life: [] as number[], runtime: [] as number[], total: [] as number[] };
  let maxVoxels = 0;
  let maxCreatures = 0;
  const total = 30 * (SECONDS + (scene.burnAt ?? 0));
  for (let tick = 0; tick < total; tick++) {
    if (scene.burnAt && tick === scene.burnAt * 30) {
      igniteVoxels(world, 76, 76, 30);
      forDisc(world, 76, 76, 6, (i) => (world.fire[i] = 1));
      console.log(`  set alight: ${world.voxels.burning.size} of ${world.decor.size} voxels burning`);
    }
    const measured = !scene.burnAt || tick >= scene.burnAt * 30;
    world.time += TICK;
    world.tick++;
    const a = performance.now();
    stepPhysics(world, TICK);
    const b = performance.now();
    for (const c of world.creatures) updateCreature(world, c, TICK);
    const c = performance.now();
    lifeCycle(world, TICK);
    const d = performance.now();
    rt.step(TICK);
    world.particles.update(TICK);
    world.events.length = 0;
    const e = performance.now();
    if (!measured) continue;
    parts.physics.push(b - a);
    parts.creatures.push(c - b);
    parts.life.push(d - c);
    parts.runtime.push(e - d);
    parts.total.push(e - a);
    maxVoxels = Math.max(maxVoxels, world.decor.size);
    maxCreatures = Math.max(maxCreatures, world.creatures.length);
  }
  console.log(`${scene.name}: up to ${maxVoxels} voxels (${world.decor.size} at the end), ${maxCreatures} creatures`);
  for (const [part, list] of Object.entries(parts)) console.log(`  ${part.padEnd(10)} ${stats(list)}`);
}
