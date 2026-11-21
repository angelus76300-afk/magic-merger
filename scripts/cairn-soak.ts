// Cairns over time (21 November, the owner's screenshots: after an island ran a while, plain grey
// cubes covered the snow peaks, the desert and the mesa, about one every few cells). On main every
// exploring creature piled a light grey stone (0x8d8d96) at one roam in 2.5, with nothing to limit
// them. This counts the cairn stones and the cairns (stones in touching cells) on an island left
// alone, every five minutes. It reads only the island's voxels, so it runs on main too:
//   npx esbuild scripts/cairn-soak.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/cairn-soak.mjs --log-level=warning
//   node node_modules/.cache/cairn-soak.mjs [minutes] [size] [seed]
// npm test reads countCairns at the end of each half hour balance run (balance-run.ts).
import { populate } from "../src/sim/creatures";
import { resolveLand, DEFAULT_LAND } from "../src/sim/land-options";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { keyLevel, keyX, keyY } from "../src/sim/voxelkey";
import { VK, voxelColor, voxelKind } from "../src/sim/voxels";
import { TICK, generateWorld, type World } from "../src/sim/world";

// The grey stone main piled for a cairn, one voxel a visit.
const GREYS = new Set([0x8d8d96]);

// Cairns: the "cairn" covers (none on main), and main's stones lying on the land (at most three
// over it) in its grey, grouped with those in touching cells. stones: main's voxels.
export function countCairns(world: World): { stones: number; cairns: number; decor: number } {
  const cells = new Set<number>();
  let stones = 0;
  for (const [key, v] of world.decor.entries()) {
    if (voxelKind(v) !== VK.STONE || !GREYS.has(voxelColor(v))) continue;
    const x = keyX(key);
    const y = keyY(key);
    if (x >= world.w || y >= world.h) continue;
    const i = y * world.w + x;
    if (keyLevel(key) > Math.round(world.height[i] * 0.5) + 3) continue;
    stones++;
    cells.add(i);
  }
  const id = world.materials.id("cover", "cairn");
  let cairns = 0;
  if (id > 0) for (let i = 0; i < world.n; i++) if (world.cover[i] === id) cairns++;
  const seen = new Set<number>();
  for (const i of cells) {
    if (seen.has(i)) continue;
    cairns++;
    const todo = [i];
    seen.add(i);
    while (todo.length) {
      const j = todo.pop()!;
      for (const d of [1, -1, world.w, -world.w, world.w + 1, world.w - 1, -world.w + 1, -world.w - 1])
        if (cells.has(j + d) && !seen.has(j + d)) {
          seen.add(j + d);
          todo.push(j + d);
        }
    }
  }
  return { stones, cairns, decor: world.decor.size };
}

export function cairnSoak(minutes: number, size: number, seed: number): { minute: number; stones: number; cairns: number; decor: number }[] {
  const shared = Math.random;
  Math.random = seeded(seed * 7 + 1);
  try {
    const world = generateWorld(size, size, seed, resolveLand(DEFAULT_LAND, seed, size));
    populate(world);
    const rt = new Runtime(world, () => {});
    const out = [{ minute: 0, ...countCairns(world) }];
    const per = Math.round(60 / TICK);
    for (let m = 1; m <= minutes; m++) {
      for (let k = 0; k < per; k++) stepHeadless(world, rt);
      if (m % 5 === 0 || m === minutes) out.push({ minute: m, ...countCairns(world) });
    }
    return out;
  } finally {
    Math.random = shared;
  }
}

if (typeof process !== "undefined" && process.argv[1]?.includes("cairn-soak")) {
  const minutes = Number(process.argv[2] ?? 45);
  const size = Number(process.argv[3] ?? 208);
  const seed = Number(process.argv[4] ?? 31);
  console.log(`cap ${Math.max(1, Math.floor((size * size) / 2000))} cairns (1 per 2,000 cells) on ${size} by ${size}`);
  for (const row of cairnSoak(minutes, size, seed)) console.log(JSON.stringify(row));
}
