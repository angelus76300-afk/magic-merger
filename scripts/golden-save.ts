// Writes a golden island save (lab/saves): an island made by today's code,
// with a spell's own material, creature and artifact on it, saved, and the
// counts a later load must find. scripts/saves-test.ts loads it on every
// `npm test`; a change that can no longer read it fails there.
//   npx esbuild scripts/golden-save.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/golden-save.mjs && node node_modules/.cache/golden-save.mjs <name>
// Write a new one when the save format gains something worth pinning; never
// edit or delete an old one.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { generateWorld } from "../src/sim/world";
import { populate } from "../src/sim/creatures";
import { Runtime, type CastRequest } from "../src/sim/runtime";
import { saveWorld } from "../src/sim/save";
import { raiseWonders } from "../src/sim/wonderbuild";
import { DEFAULT_LAND } from "../src/sim/land";
import { seed, step } from "./challenge-replay";
import { countsOf } from "./saves-test";

const name = process.argv[2];
if (!name) throw new Error("usage: golden-save <name>, for example island-2026-11-11");
seed(5);
const world = generateWorld(112, 112, 21, { ...DEFAULT_LAND, biome: "temperate", shape: "coast" });
populate(world);
const rt = new Runtime(world, (_k, n, m) => {
  throw new Error(`${n}: ${m}`);
});
raiseWonders(world, rt);
const rules: CastRequest[] = [
  { key: "golden-honey", name: "Honey Shrine", tier: "minor", code: readFileSync("lab/programs/v4-honey-shrine.js", "utf8") },
  { key: "golden-heron", name: "Glass Heron", tier: "minor", code: readFileSync("lab/programs/v5-glass-heron.js", "utf8") },
  { key: "golden-lamp", name: "Lamplighter", tier: "minor", code: readFileSync("lab/programs/v6-lamplighter.js", "utf8") },
];
for (const [k, r] of rules.entries()) rt.cast(r, 40 + k * 14, 56);
for (let t = 0; t < 30 * 20; t++) step(world, rt);
const save = saveWorld(world, rt.owners);
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const file = `lab/saves/${name}.json`;
writeFileSync(
  file,
  JSON.stringify({
    note: `An island saved by the code of commit ${commit} (main, 2026-11-11), with three spells' rules. Never edit it: write a new one.`,
    commit,
    rules,
    counts: countsOf(world),
    save,
  }) + "\n",
);
console.log(`wrote ${file}`, JSON.stringify(countsOf(world)).slice(0, 400));
