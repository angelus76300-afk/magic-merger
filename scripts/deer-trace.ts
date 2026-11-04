// Dev only (4.3): the clip of lab/clip.ts replayed in Node, without drawing,
// tick by tick for the creature it films: what it decided and where it went.
//   npx esbuild scripts/deer-trace.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/deer-trace.mjs --log-level=warning
//   node node_modules/.cache/deer-trace.mjs [seed 11] [nth 0] [seconds 12]
import { makeCreature, populate, resetCreatureIds } from "../src/sim/creatures";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepWorld } from "../src/sim/tick";
import { generateWorld } from "../src/sim/world";

const seed = Number(process.argv[2] ?? 11);
const nth = Number(process.argv[3] ?? 0);
const seconds = Number(process.argv[4] ?? 12);
// As Engine.create on a medium island (engine.ts, WORLD_SIZES).
Math.random = seeded(seed);
resetCreatureIds();
const world = generateWorld(152, 152, seed);
populate(world);
world.time = 60;
const rt = new Runtime(world, () => {});
// As lab/clip.ts: one with room around it, not by the island's edge.
const star = world.creatures.filter((c) => c.kind === "deer" && !c.dead && c.x > 15 && c.y > 15 && c.x < world.w - 22 && c.y < world.h - 15)[nth];
const bear = makeCreature("bear", star.x + 7, star.y);
bear.homeX = bear.x;
bear.homeY = bear.y;
world.creatures.push(bear);
const sim = seeded(seed + 1);
for (let tick = 0; tick <= seconds * 30; tick++) {
  Math.random = sim;
  stepWorld(world, rt);
  world.events.length = 0;
  const a = star.data.alarm as { leader: number; wx: number; wy: number } | undefined;
  if (tick % 3 === 0)
    console.log(
      (tick / 30).toFixed(2),
      `${star.x.toFixed(2)},${star.y.toFixed(2)}`,
      `hd ${((star.hd * 180) / Math.PI).toFixed(0)} sp ${star.sp.toFixed(1)}`,
      star.mind?.task,
      star.mind?.action,
      a ? `alarm lead ${a.leader} way ${a.wx.toFixed(0)},${a.wy.toFixed(0)}` : "",
      `bear ${Math.hypot(bear.x - star.x, bear.y - star.y).toFixed(1)}`,
    );
}
