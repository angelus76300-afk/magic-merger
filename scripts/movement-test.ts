// Movement and the fine land (15 November, the owner: "Movement is still very poor, goes too fast,
// seems to be vibrating when moving. Terrain behaves weirdly with earth cubes everywhere after the
// Big Bang spell"). Each check holds one fix and says the number before and after:
// 1. Feet stand on the land as drawn (terrain.ts footAt, walk.ts easeFoot), with no hop.
// 2. A late frame draws walkers on as they were going (pacing.ts drawBetween), no stop and catch-up.
// 3. The watch follows its subject where it is drawn, every frame (orbit.ts follow).
// 4. A spell's own ground takes the fine land's curves; its walls and floors stay square
//    (terrain.ts builtGround).
// 5. A chunk whose land keeps changing still gets its fine mesh built again (terrain.ts staleFine).
import { MeshBasicMaterial, type Mesh } from "three";
import { generateWorld, TICK, type World } from "../src/sim/world";
import { DEFAULT_LAND } from "../src/sim/land-options";
import { C, F } from "../src/sim/materials";
import { CHUNK, Terrain, builtGround, columnTop } from "../src/sim/voxel/terrain";
import { GRAPHICS } from "../src/sim/voxel/graphics";
import { STEP, easeFoot, easeGround, walkGround, type Footing } from "../src/sim/voxel/walk";
import { carried, carry, drawBetween, ticksDue } from "../src/sim/voxel/pacing";
import { RUN_BH, duty, footSlide, gaitOf, hipHeight, legSwing, limbs, strideRate } from "../src/sim/voxel/gait";
import { buildRig, drawScale } from "../src/sim/voxel/rigs";
import { KINDS } from "../src/sim/creatures";
import { OrbitCamera } from "../src/sim/voxel/orbit";
import { solidCovers } from "../src/sim/paths";

type Check = (name: string, ok: boolean, detail?: string) => void;

// A seeded random, so every run measures the same frames.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function withFine<T>(run: () => T): T {
  const was = { ...GRAPHICS };
  Object.assign(GRAPHICS, { fine: true, steps: true, blend: true, grain: true, bits: true, relief: true, rocks: true });
  try {
    return run();
  } finally {
    Object.assign(GRAPHICS, was);
  }
}

// The island's land and its fine chunks, all built, as the view has them on high.
export function landOf(world: World): { terrain: Terrain; meshes: Mesh[] } {
  const meshes: Mesh[] = [];
  const terrain = new Terrain(
    world,
    new MeshBasicMaterial(),
    new MeshBasicMaterial(),
    (m) => meshes.push(m),
    (m) => meshes.splice(meshes.indexOf(m), 1),
  );
  terrain.scan();
  terrain.rebuild(true);
  terrain.focus(world.w * 0.3, 60, world.h * 0.3, 0, 0);
  terrain.updateFine(0, true);
  return { terrain, meshes };
}

// Direction changes of a height along a walk, ignoring wobbles smaller than `h`.
function reversals(series: number[], h: number): number {
  let n = 0;
  let dir = 0;
  let ext = series[0];
  for (const v of series) {
    if (dir >= 0 && v > ext) ext = v;
    else if (dir <= 0 && v < ext) ext = v;
    if (dir >= 0 && v < ext - h) {
      if (dir > 0) n++;
      dir = -1;
      ext = v;
    } else if (dir <= 0 && v > ext + h) {
      if (dir < 0) n++;
      dir = 1;
      ext = v;
    }
  }
  return n;
}

// Runs of open dry ground, `len` cells along x, that climb and fall the most without a cliff:
// where a walker's feet show whether they follow the land.
export function slopes(world: World, terrain: Terrain, len: number, count: number): { x: number; y: number }[] {
  const solid = solidCovers(world);
  const runs: { x: number; y: number; climb: number }[] = [];
  for (let y = 8; y < world.h - 8; y += 3) {
    for (let x = 8; x + len < world.w - 8; x += 4) {
      let ok = true;
      let climb = 0;
      for (let k = 0; k <= len && ok; k++) {
        const i = y * world.w + x + k;
        if (world.fluid[i] !== F.NONE || world.depth[i] > 0.005 || solid[world.cover[i]] || world.cover[i] === C.HOUSE || world.onDeck(i)) ok = false;
        else if (k > 0) {
          const d = Math.abs(columnTop(world, i) - columnTop(world, i - 1));
          if (d > 1) ok = false;
          climb += Math.abs(terrain.groundAt(x + k + 0.5, y + 0.5) - terrain.groundAt(x + k - 0.5, y + 0.5));
        }
      }
      if (ok) runs.push({ x, y, climb });
    }
  }
  runs.sort((a, b) => b.climb - a.climb);
  const out: { x: number; y: number }[] = [];
  for (const r of runs) {
    if (out.some((o) => Math.abs(o.y - r.y) < 6 && Math.abs(o.x - r.x) < len)) continue;
    out.push(r);
    if (out.length >= count) break;
  }
  return out;
}

export interface FeetReport {
  pointMax: number; // the largest |feet - drawn land| under the point, scene units
  pointP95: number;
  footMax: number; // the largest distance from the feet to the drawn tops under the sole
  above: number; // the most the feet float above the drawn land, and sink under it
  under: number;
  hop: number; // the largest rise and fall back within half a second, of the feet over the land under the sole
  reversals: number; // of the feet, and of the drawn land along the same walks
  landReversals: number;
  cells: number;
}

// A walker at `speed` cells a second, drawn at 60 frames a second, there and back along each run.
export function feetAlong(world: World, terrain: Terrain, runs: { x: number; y: number }[], len: number, speed: number, fine: boolean): FeetReport {
  const r: FeetReport = { pointMax: 0, pointP95: 0, footMax: 0, above: 0, under: 0, hop: 0, reversals: 0, landReversals: 0, cells: 0 };
  const gaps: number[] = [];
  const dt = 1 / 60;
  for (const run of runs) {
    for (const back of [false, true]) {
      const foot: Footing = { gy: NaN, vy: 0, gt: 0 };
      const feet: number[] = [];
      const land: number[] = [];
      const over: number[] = [];
      const y = run.y + 0.5;
      let t = 0;
      for (let d = 0; d <= len; d += speed * dt) {
        const x = back ? run.x + len + 0.5 - d : run.x + 0.5 + d;
        t += dt;
        const g = fine ? easeFoot(foot, terrain.footAt(x, y) ?? walkGround(world, x, y), t) : easeGround(foot, walkGround(world, x, y), t);
        const drawn = terrain.drawnTop(x, y);
        // The tops under the sole: the columns within half a column's width of the point.
        let lo = Infinity;
        let hi = -Infinity;
        let sole = 0;
        for (const ox of [-1 / 16, 0, 1 / 16])
          for (const oy of [-1 / 16, 0, 1 / 16]) {
            const v = terrain.drawnTop(x + ox, y + oy);
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
            sole += v / 9;
          }
        // The first half cell eases in from wherever the walker came from.
        if (d < 0.5) continue;
        feet.push(g);
        land.push(drawn);
        over.push(g - sole);
        gaps.push(Math.abs(g - drawn));
        r.pointMax = Math.max(r.pointMax, Math.abs(g - drawn));
        r.footMax = Math.max(r.footMax, g > hi ? g - hi : g < lo ? lo - g : 0);
        r.above = Math.max(r.above, g - drawn);
        r.under = Math.max(r.under, drawn - g);
      }
      // A hop: the feet rise over the land under the sole and come back down within half a second.
      const w = Math.round(0.5 / dt);
      for (let k = 0; k + w < over.length; k++) for (let j = k + 1; j < k + w; j++) r.hop = Math.max(r.hop, Math.min(over[j] - over[k], over[j] - over[k + w]));
      r.reversals += reversals(feet, 0.03);
      r.landReversals += reversals(land, 0.03);
      r.cells += len;
    }
  }
  gaps.sort((a, b) => a - b);
  r.pointP95 = gaps[Math.floor(gaps.length * 0.95)] ?? 0;
  return r;
}

const show = (r: FeetReport) =>
  `under the point max ${r.pointMax.toFixed(3)} (p95 ${r.pointP95.toFixed(3)}), to the tops under the sole ${r.footMax.toFixed(3)}, ` +
  `float ${r.above.toFixed(2)} sink ${r.under.toFixed(2)}, hop ${r.hop.toFixed(2)}, reversals ${r.reversals} (land ${r.landReversals}), ${r.cells} cells`;

// The walker's drawn position, frame by frame, at random frame times of 16 to 83 ms, as the view
// draws it (view.ts placeCreatures): the per frame speed's coefficient of variation (0 is
// perfectly even), frames it stood still, and, when it stops dead at `stopAt` (a frame), the most
// it was then drawn going back, cells a second. `between` is the engine's part way; `carryOn`, the
// overshoot of a late frame carried and faded (pacing.ts carry), as the view does since 16 November.
export function frameJudder(
  between: (acc: number) => number,
  carryOn: boolean,
  stopAt = Infinity,
  frames = 3000,
  seed = 11,
): { cov: number; stops: number; back: number } {
  const random = rng(seed);
  let speed = 3; // cells a second
  let acc = 0;
  let x = 0; // the simulation's position, a tick at a time
  let gx = 0; // the view's: the tick it last saw, the one before, its offset
  let gpx = 0;
  let off = 0;
  let offAt = 0;
  let lastA = 1;
  let lastDrawn = NaN;
  let lastTc = 0;
  let time = 0; // world time
  let last = NaN;
  const speeds: number[] = [];
  let stops = 0;
  let back = 0;
  for (let f = 0; f < frames; f++) {
    if (f === stopAt) speed = 0;
    const dt = Math.min(0.1, (16 + random() * 67) / 1000);
    acc += dt;
    const steps = ticksDue(acc, TICK, true);
    for (let k = 0; k < steps; k++) {
      x += speed * TICK;
      time += TICK;
      acc -= TICK;
    }
    if (acc > TICK * 3) acc = 0;
    const a = between(acc);
    if (steps) {
      // As the view: two ticks in one frame drawn as the last of them, the overshoot carried.
      const px = carryOn ? gx + (x - gx) * (1 - 1 / steps) : gx;
      if (carryOn && Number.isFinite(lastDrawn)) {
        off = carry(lastDrawn, px, x, lastA - steps + 1);
        offAt = lastTc;
      }
      gpx = px;
      gx = x;
    }
    const tc = time - (1 - a) * TICK;
    const drawn = gpx + (gx - gpx) * a + (carryOn ? carried(off, tc - offAt) : 0);
    lastA = a;
    lastTc = tc;
    lastDrawn = drawn;
    if (Number.isFinite(last) && f > 30) {
      const v = (drawn - last) / dt;
      if (f < stopAt) {
        speeds.push(v);
        if (v < 3 * 0.1) stops++;
      } else back = Math.max(back, -v);
    }
    last = drawn;
  }
  const mean = speeds.reduce((s, v) => s + v, 0) / speeds.length;
  const sd = Math.sqrt(speeds.reduce((s, v) => s + (v - mean) ** 2, 0) / speeds.length);
  return { cov: sd / mean, stops, back };
}

// The watch on a villager walking 3 cells a second, 60 frames a second, ticks 30 a second, the
// watch's shot moved four times a second (frame.ts stepWatch): the camera's speed over the island,
// frame by frame, and how far it trails the villager as drawn. `follow`: the view tells the camera
// where the villager is drawn (orbit.ts follow); without, the camera as main had it: eased toward
// the shot's point, the villager where the simulation had it at the last shot (k = dt * 2.2).
export function watchSteadiness(follow: boolean): { cov: number; min: number; max: number; lag: number } {
  const o = new OrbitCamera(128, 128);
  o.resize(700, 830);
  const speed = 3;
  let x = 30;
  let px = 30;
  const y = 64;
  let acc = 0;
  let a = 1;
  const drawn = () => px + (x - px) * a;
  if (follow) o.follow = () => ({ x: drawn(), y, vx: (x - px) / TICK, vy: 0 });
  o.tx = x;
  o.ty = y;
  o.dist = 30;
  const dt = 1 / 60;
  let next = 0;
  let shot = x;
  let last = o.tx;
  const speeds: number[] = [];
  let lag = 0;
  for (let t = 0; t < 10; t += dt) {
    acc += dt;
    const steps = ticksDue(acc, TICK, true);
    for (let k = 0; k < steps; k++) {
      px = x;
      x += speed * TICK;
      acc -= TICK;
    }
    a = drawBetween(acc, TICK);
    if (t >= next) {
      // The director's shot: where the simulation has the villager.
      o.watch(x, y, 30, 0.98, 1.6, 1, 0);
      shot = x;
      next += 0.25;
    }
    if (follow) o.update(dt, t * 1000, () => 4, false);
    else o.tx += (shot - o.tx) * Math.min(1, dt * 2.2);
    if (t > 4) {
      speeds.push((o.tx - last) / dt);
      lag = Math.max(lag, Math.abs(drawn() - o.tx));
    }
    last = o.tx;
  }
  const mean = speeds.reduce((s, v) => s + v, 0) / speeds.length;
  const sd = Math.sqrt(speeds.reduce((s, v) => s + (v - mean) ** 2, 0) / speeds.length);
  return { cov: sd / mean, min: Math.min(...speeds), max: Math.max(...speeds), lag };
}

export function movementChecks(check: Check): void {
  // 1. Feet on the drawn land, over long walks on the slopes of the usual first island.
  withFine(() => {
    const world = generateWorld(152, 152, 7, DEFAULT_LAND);
    const { terrain } = landOf(world);
    const len = 16;
    const runs = slopes(world, terrain, len, 8);
    const after = feetAlong(world, terrain, runs, len, 3, true);
    const before = feetAlong(world, terrain, runs, len, 3, false);
    // A ground that glides cannot be nearer the drawn land's small steps than half of one right at
    // the step (under the point): it is held to touch a drawn top under the sole, and to rise over
    // the land under the sole by less than one drawn step (an eighth voxel) before it comes down.
    check(
      "feet stand on the land as drawn, without hopping",
      runs.length >= 6 && after.footMax <= 0.05 && after.hop < 0.1 && after.reversals <= after.landReversals && before.footMax > 0.5,
      `${runs.length} runs of ${len} cells, there and back at 3 cells a second. After: ${show(after)}. Before: ${show(before)}`,
    );
    // Rabbits run twice as fast: still on the land.
    const fast = feetAlong(world, terrain, runs, len, 6.4, true);
    check("a running rabbit's feet stay on the drawn land", fast.footMax <= 0.05 && fast.hop < 0.1, show(fast));
    // A drop of more than a step falls with gravity; a walk down a slope follows it.
    const f: Footing = { gy: NaN, vy: 0, gt: 0 };
    easeFoot(f, 6, 0);
    let t = 0;
    while (easeFoot(f, 6 - STEP - 1, t) > 6 - STEP - 1 + 1e-6 && t < 2) t += 1 / 60;
    check("feet fall off a drop taller than a step", t > 0.2 && t < 0.6, `a fall of ${(STEP + 1).toFixed(2)} in ${t.toFixed(2)} s`);
  });
  // With the fine land off (low), feet stand where they did.
  {
    const was = GRAPHICS.fine;
    GRAPHICS.fine = false;
    const world = generateWorld(64, 64, 3);
    const { terrain } = landOf(world);
    let none = true;
    for (let k = 0; k < 200; k++) if (terrain.footAt(4 + (k % 56), 4 + ((k * 7) % 56)) !== null) none = false;
    GRAPHICS.fine = was;
    check("with the fine land off, feet stand on the cells' steps as before", none);
  }

  // 2. Late frames: drawn on as they were going.
  {
    const before = frameJudder((acc) => Math.min(1, acc / TICK), false);
    const after = frameJudder((acc) => drawBetween(acc, TICK), true);
    check(
      "at random frame times of 16 to 83 ms a walker's drawn speed stays even",
      after.cov < 0.02 && after.stops === 0 && before.cov > 0.2,
      `per frame speed's coefficient of variation ${before.cov.toFixed(3)} before (${before.stops} frames standing still), ${after.cov.toFixed(3)} after (${after.stops})`,
    );
    // A walker that stops dead after a late frame drew it on: never drawn a step back at once.
    let jump = 0;
    let eased = 0;
    for (let seed = 1; seed <= 40; seed++) {
      jump = Math.max(jump, frameJudder((acc) => drawBetween(acc, TICK), false, 700, 900, seed).back);
      eased = Math.max(eased, frameJudder((acc) => drawBetween(acc, TICK), true, 700, 900, seed).back);
    }
    check(
      "a walker that stops after a late frame is not drawn a step back",
      eased < 1.2 && jump > 2,
      `the most it was drawn going back, 40 stops: ${jump.toFixed(2)} cells a second without the carried offset, ${eased.toFixed(2)} with it`,
    );
  }

  // 3. The watch, on a steady walker.
  {
    const before = watchSteadiness(false);
    const after = watchSteadiness(true);
    check(
      "the watch follows a walker at an even pace, close behind",
      after.cov < 0.02 && after.lag < 0.2 && before.cov > 0.1 && before.lag > 1,
      `camera speed ${before.min.toFixed(2)} to ${before.max.toFixed(2)} cells a second (variation ${before.cov.toFixed(3)}), ` +
        `trailing ${before.lag.toFixed(2)} cells before; ${after.min.toFixed(2)} to ${after.max.toFixed(2)} (${after.cov.toFixed(3)}), ${after.lag.toFixed(2)} after`,
    );
  }

  // 4. A spell's ground: natural unless its name says it is built.
  {
    const natural = [
      "stardust",
      "crystal",
      "glassed earth",
      "worldwood",
      "gloom moss",
      "starmoss",
      "smoldering ground",
      "root vein",
      "steppe grass",
      "plankton",
      "wallow mud",
      "swallow nest",
      "fertile soil",
      "seaboard",
      "mossboard",
      "clipboard",
    ];
    const built = [
      "stone wall",
      "rootwall",
      "marble floor",
      "cobblestone",
      "brick",
      "paving",
      "temple steps",
      "stone tiles",
      "dirt road",
      "castle keep",
      "mudbrick",
      "redbrick",
      "stonebrick",
      "stone-brick",
      "brickwork",
      "floorboards",
      "plankwood",
      "clay tile",
      "stone paving",
      "boardwalk",
      "plank-board",
    ];
    const wrong = [...natural.filter((n) => builtGround(n)), ...built.filter((n) => !builtGround(n))];
    check("a spell's ground is built only when its name says so", wrong.length === 0, wrong.join(", "));
  }
  withFine(() => {
    // Stardust on a slope curves as the grass did; a spell's floor stays flat.
    const world = generateWorld(96, 96, 5, DEFAULT_LAND);
    const dust = world.materials.define(world.materials.makeMaterial("stardust", "ground", [0x2e2152], { glow: true, fallback: "crystal" }));
    const floor = world.materials.define(world.materials.makeMaterial("marble floor", "ground", [0xdddddd], { fallback: "rock" }));
    const curved = (g: number): number => {
      for (let i = 0; i < world.n; i++) if (world.fluid[i] === F.NONE && world.cover[i] === C.NONE) world.ground[i] = g;
      const { terrain } = landOf(world);
      // The share of dry open cells whose drawn ground is not the cell's own flat top somewhere.
      let n = 0;
      let bent = 0;
      for (let y = 4; y < world.h - 4; y += 2)
        for (let x = 4; x < world.w - 4; x += 2) {
          const i = y * world.w + x;
          if (world.fluid[i] !== F.NONE || world.cover[i] !== C.NONE) continue;
          n++;
          const top = columnTop(world, i);
          if ([0.1, 0.5, 0.9].some((fx) => [0.1, 0.9].some((fy) => Math.abs(terrain.groundAt(x + fx, y + fy) - top) > 0.06))) bent++;
        }
      return bent / Math.max(1, n);
    };
    const dustShare = curved(dust);
    const floorShare = curved(floor);
    check(
      "a spell's stardust takes the fine land's curves, its floor stays flat",
      dustShare > 0.3 && floorShare === 0,
      `cells drawn curved: stardust ${(dustShare * 100).toFixed(0)}%, marble floor ${(floorShare * 100).toFixed(0)}%`,
    );
  });

  // 5. A chunk whose land changes at every frame still gets its fine mesh built again, within
  // about the two seconds one waits between builds.
  withFine(() => {
    const world = generateWorld(64, 64, 9, DEFAULT_LAND);
    const { terrain, meshes } = landOf(world);
    const before = new Set(meshes);
    const start = performance.now();
    let rebuilt = -1;
    let frame = 0;
    while (performance.now() - start < 4000) {
      // A cell's ground changes every frame (stardust turning to crystal, a tick at a time).
      const i = (CHUNK + 4) * world.w + 4 + (frame % 8);
      world.ground[i] = world.ground[i] === 1 ? 2 : 1;
      terrain.scan();
      terrain.rebuild();
      frame++;
      // A fine mesh (it carries its twin, terrain.ts finishFine) not there at the start: the
      // changed chunk built again.
      if (meshes.some((m) => !before.has(m) && m.children.length > 0)) {
        rebuilt = performance.now() - start;
        break;
      }
    }
    check(
      "a chunk whose land changes every frame still has its fine mesh built again",
      rebuilt > 0 && rebuilt < 3200,
      rebuilt > 0 ? `built again ${(rebuilt / 1000).toFixed(2)} s after it began changing, ${frame} frames` : `not in 4 s (${frame} frames)`,
    );
  });

  // 6. Strides that match the ground (16 November, the owner: "speed: similar to minecraft
  // running"): a villager at its everyday 3 cells a second runs, and the foot on the ground stays
  // where it is set down. The share of the ground speed a planted foot slides by, on the real
  // figures' legs (rigs.ts hips, figures.ts swing), before and after.
  {
    const kinds: [string, number][] = [
      ["villager", 3],
      ["deer", 3.15],
      ["wolf", 4],
      ["boar", 3],
    ];
    const rows: string[] = [];
    let worst = 0;
    let worstBefore = 0;
    for (const [name, speed] of kinds) {
      const k = KINDS.get(name);
      if (!k) continue;
      const rig = buildRig(k.body);
      const size = drawScale(k.body, k.radius, rig, 1);
      const leg = hipHeight(rig) * size;
      const tall = rig.height * size;
      const moving = Math.min(1, speed / 1.4);
      const old = gaitOf(speed, k.speed) * moving;
      const now = gaitOf(speed, k.speed, tall, k.body.plan === "four legs" ? 1 : 2) * moving;
      const before = footSlide(speed, strideRate(old, size), leg, legSwing(old) * moving);
      const after = footSlide(speed, strideRate(now, size, leg, moving, speed), leg, legSwing(now) * moving, duty(now));
      worst = Math.max(worst, after);
      worstBefore = Math.max(worstBefore, before);
      rows.push(
        `${name} at ${speed} (${(speed / tall).toFixed(2)} heights a second): gait ${old.toFixed(2)} to ${now.toFixed(2)}, slide ${(before * 100).toFixed(0)}% to ${(after * 100).toFixed(0)}%`,
      );
    }
    const v = KINDS.get("villager")!;
    const vr = buildRig(v.body);
    const vt = vr.height * drawScale(v.body, v.radius, vr, 1);
    check(
      "a planted foot does not slide, and a villager at its everyday pace runs",
      rows.length === 4 && worst < 0.15 && worstBefore > 0.3 && gaitOf(3, v.speed, vt) > 1.5 && gaitOf(1, v.speed, vt) === 0 && RUN_BH === 2,
      rows.join("; "),
    );
  }

  // Each arm swings against the leg on its own side (the review of 16 November: the arms kept a
  // sine, a quarter cycle off the stride, corr 0.35 at a walk, -0.21 at a run). In the rigs a leg
  // on the right is LEG_A and an arm on the right ARM_B (rigs.ts), so ARM_B against LEG_A.
  {
    const corr = (a: number[], b: number[]) => {
      const ma = a.reduce((s, v) => s + v, 0) / a.length;
      const mb = b.reduce((s, v) => s + v, 0) / b.length;
      let ab = 0;
      let aa = 0;
      let bb = 0;
      for (let k = 0; k < a.length; k++) {
        ab += (a[k] - ma) * (b[k] - mb);
        aa += (a[k] - ma) ** 2;
        bb += (b[k] - mb) ** 2;
      }
      return ab / Math.sqrt(aa * bb);
    };
    const rows: string[] = [];
    let ok = true;
    for (const gait of [0, 1, 1.87]) {
      const leg: number[] = [];
      const own: number[] = [];
      const other: number[] = [];
      for (let k = 0; k < 360; k++) {
        const l = limbs((k / 360) * 2 * Math.PI, gait, 1, 0);
        leg.push(l.legA);
        own.push(l.armB);
        other.push(l.armA);
      }
      const same = corr(own, leg);
      const opposite = corr(other, leg);
      if (!(same < -0.8 && opposite > 0.8)) ok = false;
      rows.push(`gait ${gait}: arm on the leg's side ${same.toFixed(3)}, other arm ${opposite.toFixed(3)}`);
    }
    check("each arm swings against the leg on its own side", ok, rows.join("; "));
  }
}
