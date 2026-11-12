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
import { makeCreature, populate, resetCreatureIds } from "../src/sim/creatures";
import { seeded } from "../src/sim/noise";
import { forDisc } from "../src/sim/physics";
import { stepHeadless } from "../src/sim/tick";
import { igniteVoxels } from "../src/sim/voxels";
import { Runtime } from "../src/sim/runtime";
import { generateWorld } from "../src/sim/world";

function seed(n: number): void {
  Math.random = seeded(n);
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
// PROF_SIZE=208 profiles the large island; PROF_REACTIONS=1 turns on the reactions of 4.12 (reactions.ts).
const SIZE = Number(process.env.PROF_SIZE ?? 152);
const MID = SIZE / 2;
const stats = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `${q(0.5).toFixed(2)} / ${q(0.95).toFixed(2)} / ${s[s.length - 1].toFixed(1)}`;
};

console.log(`ms per tick, p50 / p95 / max over ${SECONDS} s (30 ticks a second)`);
for (const scene of scenes) {
  seed(11);
  resetCreatureIds();
  const world = generateWorld(SIZE, SIZE, 11);
  populate(world);
  const rt = new Runtime(world, (_k, _n, m) => console.log("  error:", m));
  if (scene.code) rt.cast({ key: "p", name: scene.name, tier: isTier(scene.tier) ? scene.tier : "legendary", code: scene.code }, MID, MID);
  if (scene.crowd) {
    const kinds = ["villager", "villager", "villager", "beast", "beast", "spirit"];
    for (let k = world.creatures.length; k < scene.crowd; k++) {
      const c = makeCreature(kinds[k % kinds.length], 30 + Math.random() * (SIZE - 60), 30 + Math.random() * (SIZE - 60));
      world.creatures.push(c);
    }
    rt.cast(
      {
        key: "wolves",
        name: "Wolves",
        tier: "major",
        code: `const spell = { creatures: [{ name: "wolf", base: "beast", behavior: "hunt", prey: ["villager"], attack: 4, hp: 300 }], *cast(w) { for (let k = 0; k < 12; k++) w.spawn("wolf", w.x + k % 4, w.y + (k >> 2)); } };`,
      },
      MID,
      MID,
    );
  }
  const parts = { physics: [] as number[], creatures: [] as number[], life: [] as number[], runtime: [] as number[], total: [] as number[] };
  let maxVoxels = 0;
  let maxCreatures = 0;
  const total = 30 * (SECONDS + (scene.burnAt ?? 0));
  for (let tick = 0; tick < total; tick++) {
    if (scene.burnAt && tick === scene.burnAt * 30) {
      igniteVoxels(world, MID, MID, 30);
      forDisc(world, MID, MID, 6, (i) => (world.fire[i] = 1));
      console.log(`  set alight: ${world.voxels.burning.size} of ${world.decor.size} voxels burning`);
    }
    const measured = !scene.burnAt || tick >= scene.burnAt * 30;
    const at: Partial<Record<"physics" | "creatures" | "life", number>> = {};
    const a = performance.now();
    stepHeadless(world, rt, { mark: (p) => (at[p] = performance.now()) });
    const e = performance.now();
    const b = at.physics!;
    const c = at.creatures!;
    const d = at.life!;
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
