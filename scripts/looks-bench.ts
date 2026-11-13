// How long the island takes to make its props' mesh (voxel/props.ts buildGround): 60 looks of
// 160 parts, cold (the first time) and warm (the JIT ready, nothing cached), on this machine.
//   npx esbuild scripts/looks-bench.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/looks-bench.mjs && node node_modules/.cache/looks-bench.mjs
import { SHAPES, readProp, type Prop } from "../src/sim/props";
import { generateWorld } from "../src/sim/world";
import { buildGround } from "../src/sim/voxel/props";

export function benchProps(shapes: boolean, grain: boolean): Prop[] {
  const part = (k: number) => ({
    x: (k % 8) * 0.4 - 1.6,
    y: Math.floor(k / 8) * 0.2 - 2,
    z: (k % 5) * 0.3,
    w: 0.35 + (k % 3) * 0.1,
    d: 0.3,
    h: 0.3 + (k % 4) * 0.2,
    color: 0x806040 + k,
    ...(shapes ? { shape: SHAPES[k % SHAPES.length] } : {}),
    ...(grain && k % 7 === 0 ? { grain: 0.1 } : {}),
  });
  return Array.from(
    { length: 60 },
    (_, n) =>
      readProp({
        key: `k${n}`,
        name: "n",
        x: 8 + (n % 10) * 8,
        y: 8 + Math.floor(n / 10) * 14,
        turn: n * 0.3,
        boxes: Array.from({ length: 160 }, (_, k) => part(k + n)),
      }) as Prop,
  );
}

if (process.argv[1]?.includes("looks-bench")) {
  const world = generateWorld(96, 96, 5);
  for (const [name, shapes, grain] of [
    ["boxes only", false, false],
    ["shapes and grain", true, true],
    ["shapes and grain, again", true, true],
  ] as const) {
    world.props = benchProps(shapes, grain);
    const t = performance.now();
    const { stats } = buildGround(world, { x: 8, y: 8 });
    console.log(`${name}: ${Math.round(performance.now() - t)} ms, ${stats.triangles} triangles, ${stats.simpler} simpler`);
  }
}
