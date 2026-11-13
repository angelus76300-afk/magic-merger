import { lifeCycle, updateCreature } from "./creatures";
import { stepPhysics } from "./physics";
import type { Runtime } from "./runtime";
import { stepTrouble } from "./troubles";
import { wetFires } from "./weather";
import { stepLight } from "./reactions";
import { TICK, type World } from "./world";

// One tick of the simulation, the same for the engine, the test run
// (check.ts) and the scripts (4.1, review L4: it was written six times).
//
// World events (sounds, shakes, flashes) are not cleared here, on purpose:
// the engine draws at most once for up to three ticks, and its renderer plays
// every event of those ticks then (Engine.render). Callers that never draw
// clear them after each tick: stepHeadless.
//
// life: the randomness of creatures and the life cycle only, so a test can
// replay the same lives under a different spell (check.ts). mark: told after
// each phase, for the profilers.
export function stepWorld(world: World, rt: Runtime, opts: { life?: () => number; mark?: (after: "physics" | "creatures" | "life") => void } = {}): void {
  world.time += TICK;
  world.tick++;
  stepPhysics(world, TICK);
  // Light and shadow in the world, made a few times a second within a budget per tick (4.12, reactions.ts).
  if (world.reactions) stepLight(world);
  opts.mark?.("physics");
  const random = Math.random;
  if (opts.life) Math.random = opts.life;
  try {
    for (const c of world.creatures) updateCreature(world, c, TICK);
    opts.mark?.("creatures");
    lifeCycle(world, TICK);
  } finally {
    Math.random = random;
  }
  opts.mark?.("life");
  // A trouble running on the island (troubles.ts), looked at five times a second.
  if (world.trouble && world.tick % 6 === 0) world.troubleEnd = stepTrouble(world, 6 * TICK) ?? world.troubleEnd;
  // Rain puts out what burns under it, on the player's island (weather.ts).
  if (world.weather && world.tick % 6 === 3) wetFires(world, 6 * TICK);
  rt.step(TICK);
  world.particles.update(TICK);
}

// A tick with nobody to hear or see its events: they are dropped.
export function stepHeadless(world: World, rt: Runtime, opts?: Parameters<typeof stepWorld>[2]): void {
  stepWorld(world, rt, opts);
  world.events.length = 0;
}
