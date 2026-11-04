// Dev only (4.3): one creature filmed by a fixed camera, so going back and
// forth shows. scripts/deer-clip.mjs calls window.clip on this page, on main
// and on a branch, and lays the frames out as a strip. It uses only what the
// engine had before 4.3, so the same page runs on both.
import { seeded } from "../src/sim/noise";
import { Engine, type WorldSize } from "../src/sim/engine";
import { makeCreature } from "../src/sim/creatures";
import { TICK } from "../src/sim/world";

interface ClipOptions {
  seed?: number;
  size?: WorldSize;
  kind?: string;
  // Which one of its kind, by order on the island.
  nth?: number;
  // Something it runs from, placed this many cells away (none: just watch it).
  threat?: string;
  threatAt?: number;
  seconds?: number;
  // Seconds between frames.
  every?: number;
  dist?: number;
  phi?: number;
  theta?: number;
  // Seconds into the day.
  time?: number;
}

async function clip(o: ClipOptions = {}) {
  const seed = o.seed ?? 11;
  Math.random = seeded(seed);
  const canvas = document.getElementById("world") as HTMLCanvasElement;
  const overlay = document.getElementById("overlay") as HTMLCanvasElement;
  const engine = Engine.create(canvas, overlay, o.size ?? "medium", { onError: () => {}, onTap: () => {} }, seed, { preserveDrawingBuffer: true });
  const world = engine.world;
  // No time to settle first: the creatures would move by the code under
  // test, and the two runs would not start from the same place.
  world.time = o.time ?? 60;
  // One with room around it for what scares it (not by the island's edge).
  const all = world.creatures.filter(
    (c) => c.kind === (o.kind ?? "deer") && !c.dead && c.x > 15 && c.y > 15 && c.x < world.w - 15 - (o.threatAt ?? 7) && c.y < world.h - 15,
  );
  const star = all[Math.min(all.length - 1, o.nth ?? 0)];
  if (!star) return { error: "nobody of that kind" };
  let threat: ReturnType<typeof makeCreature> | null = null;
  if (o.threat) {
    threat = makeCreature(o.threat, star.x + (o.threatAt ?? 7), star.y);
    threat.homeX = threat.x;
    threat.homeY = threat.y;
    world.creatures.push(threat);
  }
  // The camera follows it, slowly; the trail shows what it did.
  engine.runtime.camera = null;
  engine.view.orbit.tx = star.x;
  engine.view.orbit.ty = star.y;
  engine.view.orbit.dist = o.dist ?? 34;
  if (o.phi !== undefined) engine.view.orbit.phi = o.phi;
  if (o.theta !== undefined) engine.view.orbit.theta = o.theta;
  const start: [number, number] = [star.x, star.y];
  const frames: { t: number; jpg: string }[] = [];
  const trail: [number, number][] = [];
  const threatTrail: [number, number][] = [];
  // The simulation draws from its own stream and the view from another, so
  // what the creatures do does not depend on how often the view drew (and
  // scripts/deer-trace.ts can replay it in Node).
  const sim = seeded(seed + 1);
  const view = seeded(seed + 2);
  // The camera eases to where it is told: a few frames to get there first.
  Math.random = view;
  for (let k = 0; k < 40; k++) engine.render(TICK);
  const every = Math.round((o.every ?? 0.5) / TICK);
  const ticks = Math.round((o.seconds ?? 10) / TICK);
  for (let tick = 0; tick <= ticks; tick++) {
    Math.random = sim;
    engine.step();
    Math.random = view;
    engine.view.orbit.tx += (star.x - engine.view.orbit.tx) * 0.08;
    engine.view.orbit.ty += (star.y - engine.view.orbit.ty) * 0.08;
    engine.render(TICK);
    trail.push([+star.x.toFixed(2), +star.y.toFixed(2)]);
    if (threat) threatTrail.push([+threat.x.toFixed(2), +threat.y.toFixed(2)]);
    if (tick % every === 0) frames.push({ t: +(tick * TICK).toFixed(1), jpg: canvas.toDataURL("image/jpeg", 0.85) });
  }
  return { frames, trail, threatTrail, start, id: star.id };
}

(window as unknown as { clip: typeof clip; clipReady: boolean }).clip = clip;
(window as unknown as { clipReady: boolean }).clipReady = true;
