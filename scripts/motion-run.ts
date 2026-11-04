// How creatures move, measured (4.3, src/sim/motion.ts): an island of 112
// cells as a new player gets it, two simulated minutes, one seed. `npm test`
// runs seeds 3, 6 and 9 in its worker threads and prints the sum.
//
//   npx esbuild scripts/motion-run.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/motion-run.mjs --log-level=warning
//   node node_modules/.cache/motion-run.mjs [seeds, default 3,6,9] [seconds, default 120]
import { populate, resetCreatureIds } from "../src/sim/creatures";
import { MotionMeter, mergeMotion, motionLines, setMeter, type KindMotion } from "../src/sim/motion";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { generateWorld } from "../src/sim/world";

export const MOTION_SEEDS = [3, 6, 9];
export const MOTION_SECONDS = 120;

export interface MotionReport {
  kinds: Record<string, KindMotion>;
  errors: string[];
  // Creature ticks per kind alive at the end, to see nobody vanished.
  alive: Record<string, number>;
}

export function measureMotion(seed: number, seconds = MOTION_SECONDS, size = 112): MotionReport {
  Math.random = seeded(seed);
  resetCreatureIds();
  const world = generateWorld(size, size, seed);
  populate(world);
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  const m = new MotionMeter();
  const trace = process.env.TRACE;
  if (trace)
    m.log = (c, key, time) => {
      if (c.kind !== trace) return;
      const thr = (c.data.social as { threat?: { kind: string; x: number; y: number } } | undefined)?.threat;
      const dodge = time < ((c.data.sideUntil as number | undefined) ?? 0) ? " dodging" : "";
      const detour = time < ((c.data.detour as number | undefined) ?? 0) ? " detour" : "";
      const where = `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
      console.log(`${time.toFixed(2)} #${c.id} ${key} task ${c.mind?.task} at ${where}${dodge}${detour}${thr ? ` threat ${thr.kind}` : ""}`);
    };
  setMeter(m);
  try {
    for (let k = 0; k < 30 * seconds; k++) stepHeadless(world, rt);
  } finally {
    setMeter(null);
  }
  const alive: Record<string, number> = {};
  for (const c of world.creatures) if (!c.dead) alive[c.kind] = (alive[c.kind] ?? 0) + 1;
  return { kinds: m.kinds, errors, alive };
}

if (process.argv[1]?.includes("motion-run")) {
  const seeds = (process.argv[2] ?? MOTION_SEEDS.join(",")).split(",").map(Number);
  const seconds = Number(process.argv[3] ?? MOTION_SECONDS);
  const all: Record<string, KindMotion> = {};
  for (const s of seeds) {
    const r = measureMotion(s, seconds);
    if (r.errors.length) console.log(`seed ${s} errors: ${r.errors[0]}`);
    mergeMotion(all, r.kinds);
    if (process.env.EACH) for (const line of motionLines(r.kinds)) console.log(`seed ${s} ${line}`);
  }
  console.log(`motion, island 112, seeds ${seeds.join(", ")}, ${seconds} s each`);
  for (const line of motionLines(all)) console.log(line);
  if (process.env.JSON) console.log(JSON.stringify(all));
}
