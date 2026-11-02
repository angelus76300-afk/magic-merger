// Dev only: what a living island costs per tick, in Node (3.6).
//   npx esbuild scripts/prof-life.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/prof-life.mjs --log-level=warning
//   node node_modules/.cache/prof-life.mjs
// The large island (208 cells) as a new player gets it, plus the same island
// with the five minute scene's guests (a dragon, vampires, gold, a shrine), run
// for PROF_SECONDS (default 120) from morning so a night falls in it. Prints
// p50, p95 and max of the whole tick and of the creatures' share, seeded, so
// two runs of the same code agree to within timer noise. Run on main and on a
// branch to compare: the scene only uses what both have.
import { lifeCycle, populate, resetCreatureIds, updateCreature } from "../src/sim/creatures";
import { stepPhysics } from "../src/sim/physics";
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

const SECONDS = Number(process.env.PROF_SECONDS ?? 120);
const GUESTS = `const spell = {
  materials: [{ name: "gold", layer: "ground", colors: ["#ffd23d"], lures: ["villager"], taken: true }],
  creatures: [
    { name: "dragon", base: "beast", color: "#8a1c1c", body: "dragon", flying: true, fireproof: true, hp: 900, speed: 4, behavior: "hunt", prey: ["deer", "boar", "villager"], attack: 30, sense: 16, scares: ["villager", "beast"] },
    { name: "vampire", base: "villager", color: "#3a0d1e", behavior: "hunt", prey: ["villager"], attack: 40, converts: true, active: "night", weak: ["light"], hp: 260, speed: 4 },
  ],
  *cast(w) {
    w.paint(w.x + 8, w.y, 2, "gold", 1);
    w.landmark(w.x - 8, w.y, { name: "shrine", lures: ["villager"], scares: ["vampire"], aura: "heal", radius: 6 });
    w.spawn("dragon", w.x + 30, w.y + 30);
    w.spawn("vampire", w.x - 20, w.y + 10);
    w.spawn("vampire", w.x - 21, w.y + 11);
  },
};`;

const stats = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `${q(0.5).toFixed(2)} / ${q(0.95).toFixed(2)} / ${s[s.length - 1].toFixed(1)}`;
};

console.log(`ms per tick, p50 / p95 / max over ${SECONDS} s (30 ticks a second), large island 208`);
for (const guests of [false, true]) {
  seed(11);
  resetCreatureIds();
  const world = generateWorld(208, 208, 11);
  populate(world);
  world.time = 20;
  const rt = new Runtime(world, (_k, _n, m) => console.log("  error:", m));
  if (guests) {
    const v = world.creatures.find((c) => c.kind === "villager")!;
    rt.cast({ key: "guests", name: "Guests", tier: "major", code: GUESTS }, v.homeX, v.homeY);
  }
  const parts = { physics: [] as number[], creatures: [] as number[], life: [] as number[], total: [] as number[] };
  let most = 0;
  for (let tick = 0; tick < 30 * SECONDS; tick++) {
    world.time += TICK;
    world.tick++;
    const a = performance.now();
    stepPhysics(world, TICK);
    const b = performance.now();
    for (const c of world.creatures) updateCreature(world, c, TICK);
    const c = performance.now();
    lifeCycle(world, TICK);
    rt.step(TICK);
    world.particles.update(TICK);
    world.events.length = 0;
    const d = performance.now();
    parts.physics.push(b - a);
    parts.creatures.push(c - b);
    parts.life.push(d - c);
    parts.total.push(d - a);
    most = Math.max(most, world.creatures.filter((x) => !x.dead).length);
  }
  const alive = world.creatures.filter((x) => !x.dead);
  const byKind = new Map<string, number>();
  for (const x of alive) byKind.set(x.kind.split("#")[0], (byKind.get(x.kind.split("#")[0]) ?? 0) + 1);
  console.log(
    `${guests ? "with guests" : "as generated"}: up to ${most} creatures alive, ${alive.length} at the end (${[...byKind].map(([k, n]) => `${k} ${n}`).join(", ")})`,
  );
  for (const [part, list] of Object.entries(parts)) console.log(`  ${part.padEnd(10)} ${stats(list)}`);
}
