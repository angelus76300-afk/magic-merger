// Become anything (2026-11-12, src/sim/possess.ts): the player is one creature. The stick walks it
// through the engine's own steering and walls, its own thinking is paused and comes back on release,
// its abilities fire on demand with their own cooldown, 0 health throws the player out, the save never
// sees it, and nothing it does ends a trouble.
import { KINDS, kindOf, makeCreature, maxHp, populate, resetCreatureIds, whyStopped, type Creature, type CreatureKind } from "../src/sim/creatures";
import { OrbitCamera } from "../src/sim/voxel/orbit";
import { mindOf, storyOn } from "../src/sim/kin";
import { DEFAULT_LAND, resolveLand } from "../src/sim/land";
import { C, F, G } from "../src/sim/materials";
import { solidCovers } from "../src/sim/paths";
import { seeded } from "../src/sim/noise";
import {
  act,
  checkHeld,
  deedsOf,
  doDeed,
  possess,
  possessed,
  powersOf,
  release,
  steerBy,
  stickDir,
  stopNote,
  STRIKE_SECONDS,
  thoughtOf,
} from "../src/sim/possess";
import { driveSpeeds, flightBand } from "../src/sim/drive";
import {
  CAST_RANGE,
  CAST_REACH,
  NOTHING_TO_CAST_ON,
  aimAt,
  aimedEye,
  castFromEyes,
  castRange,
  clearEye,
  lookTheta,
  openLook,
  withinRange,
} from "../src/sim/eyes";
import { AimHold, HOLD_MS } from "../src/sim/aim";
import { FrameStats } from "../src/sim/hud";
import type { Tier } from "../shared/tiers";
import { unpackLook } from "../src/sim/villagers";
import { jobOf } from "../src/sim/goals";
import { playerCast } from "../src/sim/playercast";
import { clickActs, pressDown } from "../src/sim/press";
import { keepOrder, readFromWorld } from "../src/sim/protocol";
import { surfaceY } from "../src/sim/voxel/terrain";
import { Runtime } from "../src/sim/runtime";
import { saveWorld } from "../src/sim/save";
import { stepHeadless } from "../src/sim/tick";
import { startWildfire } from "../src/sim/troubles";
import { raiseWonders } from "../src/sim/wonderbuild";
import { generateWorld, type World } from "../src/sim/world";

type Check = (name: string, ok: boolean, detail?: string) => void;

function island(seed: number, seconds = 40) {
  Runtime.slowMs = Infinity;
  const world = generateWorld(152, 152, seed, resolveLand({ ...DEFAULT_LAND }, seed, 152));
  populate(world);
  const rt = new Runtime(world, () => undefined);
  raiseWonders(world, rt);
  storyOn(world);
  for (let k = 0; k < seconds * 30; k++) stepHeadless(world, rt);
  return { world, rt };
}

const run = (world: World, rt: Runtime, seconds: number, each?: () => void) => {
  for (let k = 0; k < Math.round(seconds * 30); k++) {
    stepHeadless(world, rt);
    each?.();
  }
};

// Theta 0: screen right is +x on the ground and screen down is +y, so the stick is the direction itself.
const push = (world: World, x: number, y: number) => steerBy(world, x, y, 0);

// A straight way of `cells` open to a walker from (x, y) along (dx, dy): wide enough for its body
// (the line and a third of a cell to each side of it), and inside the ridden step's rim, three cells in from
// the world's edge (creatures.ts). A line one cell thin, or one that ran to the rim, failed the walk
// check about one run in twenty: the body brushed a cover beside the line, or the rim stopped it.
function open(world: World, x: number, y: number, dx: number, dy: number, cells: number): boolean {
  for (let s = 1; s <= cells; s += 0.5)
    for (const side of [-0.35, 0, 0.35]) {
      const px = x + dx * s - dy * side;
      const py = y + dy * s + dx * side;
      if (px < 3.5 || py < 3.5 || px > world.w - 4.5 || py > world.h - 4.5) return false;
      const i = world.idx(px, py);
      if (world.depth[i] > 0.2 || world.cover[i] !== C.NONE) return false;
      if (Math.abs(world.walkLevel(i) - world.walkLevel(world.idx(x, y))) > 1.2) return false;
    }
  return true;
}

const DIRS = Array.from({ length: 16 }, (_, n) => ({ x: Math.cos((n * Math.PI) / 8), y: Math.sin((n * Math.PI) / 8) }));

function awake(c: Creature): void {
  c.sleep = 0;
  c.stun = 0;
  c.frozen = 0;
  c.fear = 0;
}

// The island's life draws Math.random (births, wandering, which villager sows where). Unseeded, the
// villager these checks play stood somewhere else every run, and about one run in eight it stood where
// a check could not hold (a way that a field or a house filled while it rested, the world's rim). The
// checks run on one seeded stream, the same every run; the page's own random comes back after.
// Creature ids feed choices too (a new creature's heading, creatures.ts makeCreature): inside the whole
// suite the count stood at whatever the groups before had made, and island 21 grew otherwise. The
// count starts at 1 here and goes back to where it was after, so nothing made before or after collides.
export function becomeChecks(check: Check): void {
  const own = Math.random;
  const ids = resetCreatureIds(1);
  Math.random = seeded(2112);
  try {
    becomeChecksSeeded(check);
  } finally {
    Math.random = own;
    resetCreatureIds(ids);
  }
}

function becomeChecksSeeded(check: Check): void {
  // 0. The stick's direction against the camera's turn.
  {
    const up = stickDir(0, -1, 0);
    const turned = stickDir(1, 0, Math.PI / 2);
    const rest = stickDir(0.05, 0.05, 0);
    check(
      "become: the stick points along the ground as the camera sees it, and rests in its dead zone",
      Math.abs(up.x) < 1e-9 && Math.abs(up.y + 1) < 1e-9 && Math.abs(turned.x) < 1e-9 && Math.abs(turned.y + 1) < 1e-9 && rest.push === 0,
      `up ${up.x.toFixed(2)},${up.y.toFixed(2)}; right at a quarter turn ${turned.x.toFixed(2)},${turned.y.toFixed(2)}`,
    );
  }

  const { world, rt } = island(21);
  // A grown villager on its way somewhere, with open ground ahead of it in some direction.
  let who: Creature | null = null;
  let dir = DIRS[0];
  for (const c of world.creatures) {
    if (c.dead || c.kind !== "villager" || c.z > 0.3) continue;
    const d = DIRS.find((v) => open(world, c.x, c.y, v.x, v.y, 7));
    if (!d || mindOf(c).task === "none") continue;
    who = c;
    dir = d;
    break;
  }
  // None of the island's own on open ground with a goal: one of its people is set on open grass and
  // let think for three seconds, until it has a goal of its own.
  if (!who) {
    outer: for (let y = 10; y < world.h - 10; y += 2)
      for (let x = 10; x < world.w - 10; x += 2) {
        const i = world.idx(x, y);
        if (world.ground[i] !== G.GRASS || world.cover[i] !== C.NONE || world.depth[i] > 0) continue;
        const d = DIRS.find((v) => open(world, x, y, v.x, v.y, 7));
        if (!d) continue;
        const v = makeCreature("villager", x, y);
        world.creatures.push(v);
        run(world, rt, 3);
        if (mindOf(v).task !== "none") {
          who = v;
          dir = DIRS.find((u) => open(world, v.x, v.y, u.x, u.y, 7)) ?? d;
          break outer;
        }
      }
  }
  check("become: island 21 has a villager on open ground to play", !!who);
  if (!who) return;
  const c = who;
  const m = mindOf(c);

  // 1. Possessed, with the stick at rest: its own thinking does not move it.
  // Without the change, its goal walks it on (this is the check that fails without it).
  awake(c);
  possess(world, c);
  const task = m.task;
  const goal = { tx: m.tx, ty: m.ty, target: m.target };
  run(world, rt, 0.6);
  const rest0 = { x: c.x, y: c.y };
  run(world, rt, 4, () => awake(c));
  const drift = Math.hypot(c.x - rest0.x, c.y - rest0.y);
  check("become: its own thinking does not move a possessed villager", drift < 0.3, `${drift.toFixed(2)} cells in 4 s with the stick at rest, task ${task}`);
  check(
    "become: its goal is kept untouched while possessed",
    m.task === task && m.tx === goal.tx && m.ty === goal.ty && m.target === goal.target,
    `task ${m.task}`,
  );

  // 2. The stick walks it the way it points, and it stops when the stick is let go. The way is chosen
  // now, from the island as it is after the rest: in those seconds its village sows, plants and builds,
  // and a way chosen before was sometimes no longer open.
  dir = DIRS.find((v) => open(world, c.x, c.y, v.x, v.y, 8)) ?? dir;
  const start = { x: c.x, y: c.y };
  push(world, dir.x, dir.y);
  run(world, rt, 2, () => awake(c));
  const along = (c.x - start.x) * dir.x + (c.y - start.y) * dir.y;
  const aside = Math.abs(-(c.x - start.x) * dir.y + (c.y - start.y) * dir.x);
  check(
    "become: a possessed villager walks the way the stick points",
    along > 3 && aside < along * 0.35,
    `${along.toFixed(1)} cells along, ${aside.toFixed(1)} aside in 2 s`,
  );
  push(world, 0, 0);
  run(world, rt, 0.8, () => awake(c));
  const stopAt = { x: c.x, y: c.y };
  run(world, rt, 1, () => awake(c));
  const after = Math.hypot(c.x - stopAt.x, c.y - stopAt.y);
  check("become: it stops when the stick is let go", after < 0.15 && c.sp < 0.05, `${after.toFixed(2)} cells in the second after, speed ${c.sp.toFixed(2)}`);

  // 3. Toward the sea for a minute: never into deep water, never off the island.
  {
    let sea = { x: 0, y: 0, d: Infinity };
    for (let y = 0; y < world.h; y += 2)
      for (let x = 0; x < world.w; x += 2) {
        const i = world.idx(x, y);
        const d = Math.hypot(x - c.x, y - c.y);
        if (world.fluid[i] === F.WATER && world.depth[i] > 2 && d < sea.d) sea = { x, y, d };
      }
    const dx = (sea.x - c.x) / sea.d;
    const dy = (sea.y - c.y) / sea.d;
    let wet = 0;
    let edge = 0;
    let outside = 0;
    let drown = 0;
    // Deep water a walker could drown in, under (x, y).
    const deep = (x: number, y: number) => {
      const i = world.idx(Math.max(0, Math.min(world.w - 1, x)), Math.max(0, Math.min(world.h - 1, y)));
      return !(world.cover[i] === C.BRIDGE && world.onDeck(i)) && world.fluid[i] === F.WATER && world.depth[i] > 1.4;
    };
    push(world, dx, dy);
    run(world, rt, 60, () => {
      awake(c);
      c.hp = Math.max(c.hp, 50);
      if (!world.inside(c.x, c.y)) outside++;
      drown = Math.max(drown, c.drowning);
      // Into deep water: every part of its footing is in it. Standing on the line between a beach
      // cell and a deep one, its centre rounds into either from tick to tick (the engine's own
      // walls, the same for every walker on a shore): counted apart, as the edge.
      if (deep(c.x - 0.15, c.y - 0.15) && deep(c.x + 0.15, c.y - 0.15) && deep(c.x - 0.15, c.y + 0.15) && deep(c.x + 0.15, c.y + 0.15)) wet++;
      else if (deep(c.x, c.y)) edge++;
    });
    // Then toward the nearest edge of the world, across whatever shallows lie that way.
    const edges = [
      { d: c.x, x: -1, y: 0 },
      { d: c.y, x: 0, y: -1 },
      { d: world.w - c.x, x: 1, y: 0 },
      { d: world.h - c.y, x: 0, y: 1 },
    ].sort((a, b) => a.d - b.d);
    push(world, edges[0].x, edges[0].y);
    run(world, rt, 40, () => {
      awake(c);
      c.hp = Math.max(c.hp, 50);
      if (Math.min(c.x, c.y, world.w - 1 - c.x, world.h - 1 - c.y) < 2.9) outside++;
      drown = Math.max(drown, c.drowning);
      if (deep(c.x - 0.15, c.y - 0.15) && deep(c.x + 0.15, c.y - 0.15) && deep(c.x - 0.15, c.y + 0.15) && deep(c.x + 0.15, c.y + 0.15)) wet++;
    });
    check(
      "become: pushed toward the sea, a villager never walks into deep water or off the island",
      wet === 0 && outside === 0 && drown < 0.5,
      `sea ${sea.d.toFixed(0)} cells away, ended ${Math.hypot(c.x - sea.x, c.y - sea.y).toFixed(0)} cells from it; ${wet} ticks in deep water, ${edge} on its edge, drowning at most ${drown.toFixed(2)} s; then toward the world's edge ${edges[0].d.toFixed(0)} cells away, ${outside} ticks past the rim, ended ${Math.min(c.x, c.y, world.w - 1 - c.x, world.h - 1 - c.y).toFixed(1)} cells from it`,
    );
  }

  // 4. Released: its own goal is back, and it walks again on its own.
  push(world, 0, 0);
  const back = release(world);
  check("become: release gives the creature back with its goal", back === c && !possessed(world) && m.task === task, `task ${m.task}`);
  {
    const from = { x: c.x, y: c.y };
    let moved = 0;
    run(world, rt, 15, () => (moved = Math.max(moved, Math.hypot(c.x - from.x, c.y - from.y))));
    check("become: after release it moves by its own mind again", moved > 1, `${moved.toFixed(1)} cells in 15 s`);
  }

  // 5. A fish pushed toward the shore stays in the water.
  {
    // One with room to swim before it meets the shore: water all round it for three cells.
    const roomy = (f: Creature) => {
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const x = Math.round(f.x) + dx;
          const y = Math.round(f.y) + dy;
          if (!world.inside(x, y) || world.depth[world.idx(x, y)] < 0.8) return false;
        }
      return true;
    };
    const fish = world.creatures.find((f) => !f.dead && f.kind === "fish" && roomy(f)) ?? world.creatures.find((f) => !f.dead && f.kind === "fish");
    check("become: island 21 has a fish to play", !!fish);
    if (fish) {
      possess(world, fish);
      // Toward the nearest dry land.
      let land = { x: 0, y: 0, d: Infinity };
      for (let y = 0; y < world.h; y++)
        for (let x = 0; x < world.w; x++) {
          const i = world.idx(x, y);
          const d = Math.hypot(x - fish.x, y - fish.y);
          if (world.fluid[i] === F.NONE && d < land.d) land = { x, y, d };
        }
      // A swimmer is steered by throttle and bank (drive.ts): it faces the land, the stick pushed ahead.
      fish.hd = Math.atan2(land.y - fish.y, land.x - fish.x);
      push(world, 0, -1);
      let dry = 0;
      let edge = 0;
      const hp = fish.hp;
      const start = { x: fish.x, y: fish.y };
      const out = (x: number, y: number) => {
        const i = world.idx(Math.max(0, Math.min(world.w - 1, x)), Math.max(0, Math.min(world.h - 1, y)));
        return !((world.fluid[i] === F.WATER || world.fluid[i] === F.ICE) && world.depth[i] > 0.25);
      };
      run(world, rt, 20, () => {
        awake(fish);
        // Out of water: all of it on land. On the line between a water cell and a beach its centre
        // rounds into either (the edge, as for the villager above).
        if (out(fish.x - 0.15, fish.y - 0.15) && out(fish.x + 0.15, fish.y - 0.15) && out(fish.x - 0.15, fish.y + 0.15) && out(fish.x + 0.15, fish.y + 0.15))
          dry++;
        else if (out(fish.x, fish.y)) edge++;
      });
      const moved = Math.hypot(fish.x - start.x, fish.y - start.y);
      check(
        "become: a possessed fish swims and stays in water",
        dry === 0 && edge < 10 && (fish.dead || hp - fish.hp < 3) && moved > 1,
        `${dry} ticks on land, ${edge} on the water's edge, ${(hp - fish.hp).toFixed(1)} hp lost${fish.dead ? ` (caught: ${String(fish.data.eaten ?? "dead")})` : ""}, swam ${moved.toFixed(1)} cells toward land ${land.d.toFixed(0)} cells away`,
      );
      release(world);
    }
  }

  // 6. A bird keeps its own altitude: the stick only steers it.
  {
    let bird = world.creatures.find((b) => !b.dead && b.kind === "bird");
    if (!bird) {
      bird = makeCreature("bird", c.x, c.y);
      bird.z = kindOf(bird).altitude;
      world.creatures.push(bird);
    }
    const b = bird;
    possess(world, b);
    const alt = kindOf(b).altitude;
    const band = flightBand(kindOf(b));
    // Throttle and bank (drive.ts): ahead toward the island's middle, the look level.
    b.hd = Math.atan2(world.h / 2 - b.y, world.w / 2 - b.x);
    const z0 = b.z;
    let low = Infinity;
    let high = -Infinity;
    const start = { x: b.x, y: b.y };
    push(world, 0, -1);
    run(world, rt, 2, () => {
      awake(b);
      low = Math.min(low, b.z);
      high = Math.max(high, b.z);
    });
    const flown = Math.hypot(b.x - start.x, b.y - start.y);
    check(
      "become: a possessed bird flies ahead at its played speed and holds its height with the look level",
      low > z0 - 0.3 && high < z0 + 0.3 && flown > 18,
      `altitude ${alt}, taken at ${z0.toFixed(1)}: flew between ${low.toFixed(1)} and ${high.toFixed(1)}, ${flown.toFixed(0)} cells in 2 s`,
    );
    // A banked turn: the stick right turns it right as it flies, a little more than a radian in a second at 0.6.
    const hd0 = b.hd;
    const at0 = { x: b.x, y: b.y };
    push(world, 0.6, -1);
    run(world, rt, 1, () => awake(b));
    const turned = Math.atan2(Math.sin(b.hd - hd0), Math.cos(b.hd - hd0));
    // Then the look up for two seconds, and down for four: it climbs, then dives, within its band.
    steerBy(world, 0, -1, 0, 1);
    run(world, rt, 2, () => awake(b));
    const climbed = b.z;
    let lowest = Infinity;
    let highest = -Infinity;
    steerBy(world, 0, -1, 0, 1);
    run(world, rt, 6, () => {
      awake(b);
      highest = Math.max(highest, b.z);
    });
    steerBy(world, 0, -1, 0, -1);
    run(world, rt, 8, () => {
      awake(b);
      lowest = Math.min(lowest, b.z);
    });
    check(
      "become: a possessed bird banks with the stick, climbs and dives with the look, within its altitude band",
      turned > 1.1 &&
        turned < 1.8 &&
        Math.hypot(b.x - at0.x, b.y - at0.y) > 3 &&
        climbed > z0 + 3 &&
        highest <= band.high + 0.6 &&
        lowest >= band.low - 0.6 &&
        lowest < z0 - 1.5,
      `turned ${turned.toFixed(2)} rad in 1 s; climbed from ${z0.toFixed(1)} to ${climbed.toFixed(1)} in 2 s, at most ${highest.toFixed(1)} (band ${band.low} to ${band.high}); dived to ${lowest.toFixed(1)}`,
    );
    release(world);
  }

  // 7. An ability on demand: its trigger skipped, its own cooldown, and none fired on its own while possessed.
  {
    const base = KINDS.get("beast") as CreatureKind;
    KINDS.set("become test healer", { ...base, name: "become test healer", abilities: [{ do: "heal", when: "every so often", every: 15 }] });
    const h = makeCreature("become test healer", c.x + 1, c.y);
    world.creatures.push(h);
    possess(world, h);
    h.hp = 30;
    run(world, rt, 2, () => awake(h));
    const own = h.hp;
    const first = act(world, 0);
    const healed = h.hp;
    const again = act(world, 0);
    const twice = h.hp;
    const power = powersOf(world, h)[0];
    run(world, rt, 15.5, () => {
      awake(h);
      // Kept alive through the wait: a wolf passing by is not what this checks.
      h.hp = Math.max(h.hp, 20);
      h.burning = 0;
    });
    h.hp = Math.min(h.hp, 30);
    const later = act(world, 0);
    check("become: an ability does not fire by itself while possessed", own <= 31, `hp ${own.toFixed(0)} after 2 s of "every so often"`);
    check(
      "become: an ability fires on demand, and not again before its cooldown",
      first === "done" && healed >= own + 25 && again === "cooling" && twice === healed && later === "done",
      `${first} (+${(healed - own).toFixed(0)} hp), ${again}, cooldown ${power?.left.toFixed(1)} of ${power?.every} s, then ${later}`,
    );
    release(world);
    const deer = makeCreature("deer", c.x, c.y);
    world.creatures.push(deer);
    possess(world, deer);
    check(
      "become: a creature with no ability shows no button",
      powersOf(world, deer).length === 0 && act(world, 0) === null,
      `${powersOf(world, deer).length} for a deer`,
    );
    release(world);
    h.hp = 0;
    KINDS.delete("become test healer");
  }

  // 8. At 0 health the player is thrown out at once.
  {
    possess(world, c);
    c.hp = 0;
    run(world, rt, 1 / 30);
    const why = checkHeld(world);
    check("become: a creature at 0 health is released at once", !possessed(world) && why === "fell", `${why}`);
    // It lives or dies by the simulation's own rules: dead, as anyone at 0 health.
    check("become: the creature is left to the simulation's own rules", c.dead, `dead ${c.dead}`);
  }

  // 9. Possession never reaches the save.
  {
    const v = world.creatures.find((o) => !o.dead && o.kind === "villager")!;
    const before = JSON.stringify(saveWorld(world, new Map()));
    possess(world, v);
    push(world, 1, 0);
    const during = JSON.stringify(saveWorld(world, new Map()));
    check(
      "become: nothing about possession appears in the save",
      before === during && !/possess|rider|ridden/i.test(during),
      `${during.length} bytes, the same before and during`,
    );
    check("become: its thought reads as words", /^[A-Z][a-z]/.test(thoughtOf(world, v)), thoughtOf(world, v));
    // Its own task is paused while it is steered: the line does not claim it.
    {
      const vm = mindOf(v);
      const was = { action: vm.action, hunger: vm.hunger, tired: vm.tired, hp: v.hp, burning: v.burning };
      Object.assign(vm, { action: "felling a tree", hunger: 0, tired: 0 });
      v.hp = maxHp(v);
      v.burning = 0;
      const ridden = thoughtOf(world, v);
      release(world);
      vm.action = "felling a tree";
      const own = thoughtOf(world, v);
      possess(world, v);
      Object.assign(vm, { action: was.action, hunger: was.hunger, tired: was.tired });
      v.hp = was.hp;
      check(
        "become: while steered, the thought line does not claim its paused task",
        !/felling/.test(ridden) && (/felling/.test(own) || /afraid|wants/i.test(own)),
        `steered: "${ridden}"; its own: "${own}"`,
      );
    }
    release(world);
  }

  // 10. A trouble is not ended by anything possession does: walked through the fire, every button pressed.
  {
    const t = island(21, 60);
    const fire = startWildfire(t.world, seeded(21));
    check("become: a wildfire starts on island 21", !!fire);
    if (fire) {
      const v = t.world.creatures
        .filter((o) => !o.dead && o.kind === "villager")
        .sort((a, b) => Math.hypot(a.x - fire.x, a.y - fire.y) - Math.hypot(b.x - fire.x, b.y - fire.y))[0];
      possess(t.world, v);
      const casts = fire.casts.length;
      let ended = 0;
      run(t.world, t.rt, 30, () => {
        if (!possessed(t.world) && !v.dead) possess(t.world, v);
        const d = Math.hypot(fire.x - v.x, fire.y - v.y) || 1;
        steerBy(t.world, (fire.x - v.x) / d, (fire.y - v.y) / d, 0);
        act(t.world, 0);
        act(t.world, 1);
        if (t.world.troubleEnd) ended++;
      });
      release(t.world);
      check(
        "become: nothing possession does ends a trouble",
        !!t.world.trouble && ended === 0 && fire.casts.length === casts,
        `stage ${fire.stage}, ${fire.casts.length - casts} casts counted, ended ${ended} times`,
      );
      // 15. A cast from the eyes is a cast: near the fire it counts for the trouble, as a tap's would;
      // aimed past the range, it lands at the range's end, out of the fire's reach, and does not.
      {
        const ground = groundOf(t.world);
        const req = { key: "eyes test rain", name: "Eyes Test Rain", tier: "minor" as const, code: "const spell = { *cast(w) { yield 0.1; } };" };
        const cast = (x: number, y: number) => playerCast(t.world, t.rt, req, x, y);
        // Eight cells from the fire's heart, looking down at it.
        const a = Math.atan2(fire.y - v.y, fire.x - v.x);
        const ex = fire.x - Math.cos(a) * 8;
        const ey = fire.y - Math.sin(a) * 8;
        const h = ground(ex, ey) + 1.6;
        const pitch = -Math.atan2(h - ground(fire.x, fire.y), 8);
        const before = fire.casts.length;
        const near = castFromEyes({ x: ex, y: ey, h, yaw: a, pitch }, ground, t.world.w, t.world.h, cast);
        const counted = fire.casts.length - before;
        // Thirty cells away, aimed at the fire's heart: the cast stops at the range, 14 cells out at most.
        const fx = Math.max(4, Math.min(t.world.w - 5, fire.x - Math.cos(a) * 30));
        const fy = Math.max(4, Math.min(t.world.h - 5, fire.y - Math.sin(a) * 30));
        const fh = ground(fx, fy) + 1.6;
        const at = Math.hypot(fire.x - fx, fire.y - fy);
        const far = castFromEyes(
          { x: fx, y: fy, h: fh, yaw: Math.atan2(fire.y - fy, fire.x - fx), pitch: -Math.atan2(fh - ground(fire.x, fire.y), at) },
          ground,
          t.world.w,
          t.world.h,
          cast,
        );
        const farLand = Math.hypot(far.x - fx, far.y - fy);
        check(
          "eyes: a cast from the eyes counts for a wildfire as a tap's would, and lands no further than the range",
          near.ok && counted === 1 && Math.hypot(near.x - fire.x, near.y - fire.y) < 3 && far.ok && farLand <= CAST_RANGE + 0.15 && at > CAST_RANGE + 5,
          `near: landed ${Math.hypot(near.x - fire.x, near.y - fire.y).toFixed(1)} cells from the fire, ${counted} counted; aimed at it from ${at.toFixed(0)} cells: landed ${farLand.toFixed(1)} cells out`,
        );
      }
    }
  }
  eyesChecks(check, world, rt);
  driveChecks(check, world, rt);
  castChecks(check);
  storyOn(null);
}

// The eye view, second pass: a cast reaches as far as its tier, lands where the look meets the land
// or a creature, never beyond its reach; a held aim moves the ring and its release casts once; and the
// perf sample says which view its frames were drawn in.
function castChecks(check: Check): void {
  const flat = () => 0;
  const at = (dist: number, tier: Tier, pitch = -Math.atan2(1.6, dist)) => {
    let cast = 0;
    const r = castFromEyes(
      { x: 20, y: 50, h: 1.6, yaw: 0, pitch },
      flat,
      200,
      100,
      () => (cast++, true),
      () => true,
      castRange(tier),
    );
    return { d: Math.hypot(r.x - 20, r.y - 50), casts: cast, ok: r.ok };
  };
  // 25. At 10, 25 and the tier's limit, looking at the ground there: it lands there (before, past 14 cells it landed at 14).
  {
    const ten = at(10, "minor");
    const quarter = at(25, "major");
    const limit = at(CAST_REACH.grand - 0.5, "grand");
    check(
      "cast: from the eyes it lands where the look meets the land, at 10, 25 and the tier's limit",
      Math.abs(ten.d - 10) < 0.3 &&
        Math.abs(quarter.d - 25) < 0.5 &&
        Math.abs(limit.d - (CAST_REACH.grand - 0.5)) < 0.6 &&
        ten.casts + quarter.casts + limit.casts === 3,
      `${ten.d.toFixed(1)}, ${quarter.d.toFixed(1)}, ${limit.d.toFixed(1)} cells (grand reach ${CAST_REACH.grand}); reach by tier ${Object.entries(CAST_REACH)
        .map(([t, r]) => `${t} ${r}`)
        .join(", ")}`,
    );
  }
  // 26. Nothing beyond the reach: the land met past it, or the sky, lands at the reach's end along the look.
  {
    const past = at(70, "grand");
    const small = at(25, "cantrip");
    const sky = at(0, "major", 0.3);
    const ok = Math.abs(past.d - CAST_REACH.grand) < 1e-6 && Math.abs(small.d - CAST_REACH.cantrip) < 1e-6 && Math.abs(sky.d - CAST_REACH.major) < 1e-6;
    check(
      "cast: nothing is cast beyond the tier's reach; at the sky it lands at the reach along the look",
      ok,
      `ground at 70 with a grand spell: ${past.d.toFixed(1)}; at 25 with a cantrip: ${small.d.toFixed(1)}; the sky with a major: ${sky.d.toFixed(1)}`,
    );
    const behind = withinRange(10, 10, 80, 10, castRange("grand"));
    check("cast: from behind, a tap lands within the same reach", Math.abs(behind.x - 10 - CAST_REACH.grand) < 1e-9, `${behind.x - 10} cells`);
  }
  // 27. A creature on the look before the land: the cast lands where it stands.
  {
    const deer = { x: 32, y: 50.2, z: 0, r: 0.5, h: 1.4 };
    const r = aimAt({ x: 20, y: 50, h: 1.6, yaw: 0, pitch: -Math.atan2(1.6, 30) }, flat, 200, 100, castRange("major"), [
      deer,
      { x: 26, y: 54, z: 0, r: 0.5, h: 1.4 },
    ]);
    check("cast: the look meets a creature before the land: it lands on the creature", r.body === 0 && r.x === 32 && r.y === 50.2, JSON.stringify(r));
  }
  // 28. Hold and release on the Cast button (aim.ts): the ring shows at once, a drag moves the aim
  // finely, the release casts once and the click the touch sends after it does nothing (press.ts).
  {
    const eye = { x: 20, y: 50, h: 1.6, yaw: 0, pitch: -Math.atan2(1.6, 20) };
    const range = castRange("major");
    const ring = (h: AimHold) => aimAt(h.armed ? aimedEye(eye, h.dyaw, h.dpitch) : eye, flat, 200, 100, range);
    const hold = new AimHold();
    let casts = 0;
    const release = (id: number, cancel = false, t = 0) => {
      const end = hold.up(id, cancel);
      if (end === "cast") casts++;
      // The click the touch sends after: only a click with no press before it acts.
      if (clickActs(t + 120)) casts++;
      return end;
    };
    pressDown(10_000);
    hold.down(1, 300, 700, 10_000, true);
    const before = ring(hold);
    hold.move(1, 340, 640);
    const after = ring(hold);
    const end = release(1, false, 10_000);
    const turned = Math.atan2(after.y - 50, after.x - 20);
    // A tap: down and up at once, at the mark.
    pressDown(20_000);
    hold.down(2, 300, 700, 20_000, true);
    const tapAt = ring(hold);
    const tap = release(2, false, 20_000);
    // Cancelled: over the Cancel chip, or the browser took the touch.
    pressDown(30_000);
    hold.down(3, 300, 700, 30_000, true);
    hold.move(3, 300, 300);
    const cancel = release(3, true, 30_000);
    check(
      "cast: a held aim moves the ring finely and its release casts once; a tap casts once at the mark; a cancel casts nothing",
      end === "cast" &&
        tap === "cast" &&
        cancel === "cancel" &&
        casts === 2 &&
        turned > 0.05 &&
        turned < 0.15 &&
        after.dist > before.dist + 3 &&
        Math.abs(tapAt.dist - 20) < 0.3,
      `held: ring from ${before.dist.toFixed(1)} cells ahead to ${after.dist.toFixed(1)} cells, ${turned.toFixed(2)} rad to the right, for 40 px right and 60 up; tap at ${tapAt.dist.toFixed(1)}; ${casts} casts for a hold, a tap and a cancel`,
    );
    // On the island: a finger held still begins the aim; one that moves first is a turn of the look.
    const island = new AimHold();
    island.down(4, 200, 400, 40_000, false);
    island.move(4, 203, 402);
    const early = island.tick(40_000 + 100);
    const armed = island.tick(40_000 + HOLD_MS + 10);
    const aimed = island.move(4, 230, 380);
    const islandEnd = island.up(4, false);
    island.down(5, 200, 400, 50_000, false);
    const turnedLook = island.move(5, 240, 400);
    const lookEnd = island.up(5, false);
    check(
      "cast: on the island a finger held still aims and casts on release; one that moves first turns the look and casts nothing itself",
      !early && armed && aimed && islandEnd === "cast" && !turnedLook && lookEnd === null,
      `held: armed ${armed} after ${HOLD_MS} ms, aimed ${aimed}, ${islandEnd}; moved first: aimed ${turnedLook}, ${lookEnd}`,
    );
  }
  // 29. The perf sample says which view its frames were drawn in, and reaches the page in its shape.
  {
    const s = new FrameStats();
    for (let k = 0; k < 30; k++) s.push({ frame: 16, sim: 2, render: 5, view: k < 20 ? "eyes" : k < 25 ? "behind" : undefined });
    const sum = s.summary();
    const msg = readFromWorld({ type: "perf", sample: { ...sum, challenge: 0 } });
    check(
      "perf: the sample names the view most of its frames were drawn in, and counts each",
      sum.view === "eyes" && sum.viewFrames === "sky:5,behind:5,eyes:20" && msg?.type === "perf" && msg.sample.view === "eyes",
      `${sum.view}, ${sum.viewFrames}`,
    );
  }
}

// The kinds' own pace, measured on islands 21, 7 and 33 over 80 seconds: the median speed of each
// while it moves by its own mind, in cells per second (drive.ts SPEEDS). Before this pass a ridden
// creature walked at most at its kind's speed (k.speed, the stick fully pushed), reached through the
// engine's acceleration.
const OWN_WALK: Record<string, number> = { villager: 2.9, deer: 3.4, wolf: 5.4, bear: 2.7, bird: 4.2, fish: 1.1 };

// A test ground on island 21: flat open grass 40 by 16 cells, with four lanes running along +x. Lane
// A is flat; lane B steps up one cell at x0 + 10; lane C rises three cells there (a cliff); lane D has
// a house wall there. Returns where each lane starts.
function arena(world: World): { x0: number; a: number; b: number; cl: number; wall: number } | null {
  for (let y0 = 12; y0 < world.h - 30; y0 += 3)
    for (let x0 = 12; x0 < world.w - 52; x0 += 3) {
      let ok = true;
      for (let y = y0; y < y0 + 16 && ok; y++)
        for (let x = x0; x < x0 + 40 && ok; x++) ok = world.depth[world.idx(x, y)] === 0 && world.fluid[world.idx(x, y)] === F.NONE;
      if (!ok) continue;
      const level = Math.round(world.height[world.idx(x0, y0)]);
      for (let y = y0; y < y0 + 16; y++)
        for (let x = x0; x < x0 + 40; x++) {
          const i = world.idx(x, y);
          world.setCover(i, C.NONE);
          world.ground[i] = G.GRASS;
          const lane = y - y0;
          const past = x >= x0 + 10;
          world.height[i] = level + (past && lane >= 5 && lane <= 7 ? 1 : past && lane >= 9 && lane <= 11 ? 3 : 0);
          if (x === x0 + 10 && lane >= 13 && lane <= 15) world.setCover(i, C.HOUSE);
        }
      // Nobody else in it: a villager walking across a lane is not what these check.
      for (const o of world.creatures) if (o.x > x0 - 1 && o.x < x0 + 41 && o.y > y0 - 1 && o.y < y0 + 17) o.x = o.y = 6;
      return { x0, a: y0 + 2, b: y0 + 6, cl: y0 + 10, wall: y0 + 14 };
    }
  return null;
}

// The eye view, second pass (drive.ts): the creature answers the stick within a tenth of a second,
// strafes, moves at a played pace per kind, and the island's walls still hold at that pace.
function driveChecks(check: Check, world: World, rt: Runtime): void {
  const at = arena(world);
  check("drive: island 21 has room for a test ground", !!at);
  if (!at) return;
  const put = (kind: string, x: number, y: number) => {
    const c = makeCreature(kind, x + 0.5, y + 0.5);
    c.hd = 0;
    world.creatures.push(c);
    possess(world, c);
    return c;
  };
  const gone = (c: Creature) => {
    release(world);
    c.hp = 0;
    c.dead = true;
  };
  const tick = 1 / 30;

  // 21. How fast it answers: from rest, the stick at its rim, the time to 90 percent of its run; let
  // go, the time to a stop. Through the engine's steering a villager took about 0.35 s to its full pace.
  {
    const v = put("villager", at.x0 + 1, at.a);
    v.size = 1;
    awake(v);
    const run0 = driveSpeeds(kindOf(v)).run;
    push(world, 1, 0);
    let up = Infinity;
    for (let k = 1; k <= 30 && up === Infinity; k++) {
      run(world, rt, tick, () => awake(v));
      if (v.sp >= run0 * 0.9) up = k * tick;
    }
    run(world, rt, 0.3, () => awake(v));
    const top = v.sp;
    push(world, 0, 0);
    const from = { x: v.x, y: v.y };
    let down = Infinity;
    for (let k = 1; k <= 30 && down === Infinity; k++) {
      run(world, rt, tick, () => awake(v));
      if (v.sp < 0.05) down = k * tick;
    }
    const coast = Math.hypot(v.x - from.x, v.y - from.y);
    check(
      "drive: a villager reaches its pace within 150 ms of the stick and stops within 200 ms of its release",
      up <= 0.15 + 1e-9 && down <= 0.2 + 1e-9 && Math.abs(top - run0) < 0.3,
      `90 percent of ${run0} cells/s in ${(up * 1000).toFixed(0)} ms (top ${top.toFixed(2)}); stopped in ${(down * 1000).toFixed(0)} ms, ${coast.toFixed(2)} cells after the release`,
    );
    gone(v);
  }

  // 22. Strafing: in its eyes, looking along +x, the stick to the right walks it to the right of the
  // look at once (+y), its body turned to face where it goes; the look is the player's and does not move.
  {
    const v = put("villager", at.x0 + 3, at.a);
    awake(v);
    const yaw = 0;
    const from = { x: v.x, y: v.y };
    steerBy(world, 0.7, 0, lookTheta(yaw));
    run(world, rt, 0.3, () => awake(v));
    const dx = v.x - from.x;
    const dy = v.y - from.y;
    const off = Math.abs(Math.atan2(dx, dy));
    check(
      "drive: the stick to the side strafes, at once, and the body faces where it goes",
      dy > 1 && off < 0.17 && Math.abs(Math.atan2(Math.sin(v.hd - Math.PI / 2), Math.cos(v.hd - Math.PI / 2))) < 0.3,
      `${dy.toFixed(2)} cells to the right of the look and ${dx.toFixed(2)} along it in 0.3 s; body at ${v.hd.toFixed(2)} rad`,
    );
    push(world, 0, 0);
    gone(v);
  }

  // 23. The pace of each kind, before and after, on the flat lane: the stick three quarters out
  // (its walk) and at its rim (its run), measured over the last half second of one and a half.
  {
    const rows: string[] = [];
    let ok = true;
    const pace = (kind: string, push1: number) => {
      const v = put(kind, at.x0 + 1, at.a);
      awake(v);
      // A grown one: the pace goes with the square root of its size, as its own steps do.
      v.size = 1;
      push(world, push1, 0);
      run(world, rt, 0.7, () => awake(v));
      const x = v.x;
      run(world, rt, 0.5, () => awake(v));
      const sp = (v.x - x) / 0.5;
      push(world, 0, 0);
      gone(v);
      return sp;
    };
    const got: Record<string, { walk: number; run: number }> = {};
    for (const kind of ["villager", "deer", "wolf", "bear"]) {
      const k = KINDS.get(kind) as CreatureKind;
      const s = driveSpeeds(k);
      const walk = pace(kind, 0.75);
      const runS = pace(kind, 1);
      got[kind] = { walk, run: runS };
      ok &&= Math.abs(walk - s.walk) < 0.4 && Math.abs(runS - s.run) < 0.5;
      rows.push(`${kind} own ${OWN_WALK[kind]}, ridden before ${k.speed}, now ${walk.toFixed(1)} walking, ${runS.toFixed(1)} running`);
    }
    const v = got.villager;
    check(
      "drive: each kind walks and runs at its played pace: a villager about 2.5 and 4 times its own walk, a wolf and a deer faster, a bear slower",
      ok &&
        v.walk / OWN_WALK.villager > 2.2 &&
        v.walk / OWN_WALK.villager < 2.8 &&
        v.run / OWN_WALK.villager > 3.6 &&
        v.run / OWN_WALK.villager < 4.4 &&
        got.wolf.run > v.run &&
        got.deer.run > v.run &&
        got.bear.run < v.run,
      rows.join("; "),
    );
  }

  // 24. The island's walls at a run: a one cell ledge is stepped without stopping; a cliff of three and
  // a house wall stop it, and the line says why.
  {
    const v = put("villager", at.x0 + 2, at.b);
    awake(v);
    push(world, 1, 0);
    let slowest = Infinity;
    let px = v.x;
    let crossed = -1;
    run(world, rt, 1.6, () => {
      awake(v);
      if (v.x > at.x0 + 7 && v.x < at.x0 + 13) slowest = Math.min(slowest, (v.x - px) * 30);
      if (crossed < 0 && v.x > at.x0 + 10.5) crossed = world.time;
      px = v.x;
    });
    const up = world.walkLevel(world.idx(v.x, v.y)) - world.walkLevel(world.idx(at.x0 + 2, at.b));
    check(
      "drive: a one cell ledge is stepped up at a run without stopping",
      crossed > 0 && up === 1 && slowest > driveSpeeds(kindOf(v)).run * 0.7,
      `up ${up} cell, at least ${slowest.toFixed(1)} cells/s across it, ended at x0 + ${(v.x - at.x0).toFixed(1)}`,
    );
    push(world, 0, 0);
    gone(v);
    for (const [lane, word, says] of [
      [at.cl, "a cliff of three cells", "Too steep"],
      [at.wall, "a house wall", "A wall is in the way"],
    ] as const) {
      const w = put("villager", at.x0 + 2, lane);
      awake(w);
      push(world, 1, 0);
      let furthest = 0;
      let note: string | null = null;
      run(world, rt, 2, () => {
        awake(w);
        furthest = Math.max(furthest, w.x);
        note = stopNote(world, whyStopped) ?? note;
      });
      check(
        `drive: ${word} stops a running villager, and the line says why`,
        furthest < at.x0 + 9.5 && note === says,
        `furthest x0 + ${(furthest - at.x0).toFixed(2)} (the wall begins at x0 + 9.5); the line: ${note}`,
      );
      push(world, 0, 0);
      gone(w);
    }
  }
}

// The ground the camera sees (view.ts groundAt): the surface, land or fluid, in scene units.
function groundOf(world: World): (x: number, y: number) => number {
  return (x, y) => surfaceY(world, Math.max(0, Math.min(world.h - 1, Math.floor(y))) * world.w + Math.max(0, Math.min(world.w - 1, Math.floor(x))));
}

// Through its eyes (2026-11-12, src/sim/eyes.ts): the stick walks along the look, the mark's cast
// is held to its range, the creature's own acts do what their words say, and the page's messages are checked.
function eyesChecks(check: Check, world: World, rt: Runtime): void {
  // A villager of its own on open grass, with open ground ahead along d.
  let c: Creature | null = null;
  let d: { x: number; y: number } | undefined;
  let home = { x: 0, y: 0 };
  for (let y = 20; y < world.h - 20 && !c; y += 3)
    for (let x = 20; x < world.w - 20 && !c; x += 3) {
      const i = world.idx(x, y);
      if (world.ground[i] !== G.GRASS || world.cover[i] !== C.NONE || world.depth[i] > 0) continue;
      d = DIRS.find((v) => open(world, x + 0.5, y + 0.5, v.x, v.y, 10));
      if (!d) continue;
      c = makeCreature("villager", x + 0.5, y + 0.5);
      // The cell it stands in, as world.idx rounds: its open grass.
      home = { x, y };
      world.creatures.push(c);
    }
  check("eyes: island 21 has a villager on open ground to play", !!c);
  if (!c) return;
  // 11. The stick against the look: up walks where it looks, right walks to the right of it.
  {
    {
      const v = c;
      possess(world, v);
      const along = Math.atan2(d!.y, d!.x);
      const walk = (sx: number, sy: number, yaw: number) => {
        const from = { x: v.x, y: v.y };
        // Half pushed, for 0.6 s: about three cells at the played walk (drive.ts), within the ten open.
        steerBy(world, sx * 0.5, sy * 0.5, lookTheta(yaw));
        run(world, rt, 0.6, () => awake(v));
        steerBy(world, 0, 0, lookTheta(yaw));
        run(world, rt, 0.6, () => awake(v));
        return { x: v.x - from.x, y: v.y - from.y };
      };
      // Looking along the open way, stick up; then looking a quarter turn to its left, stick right.
      const up = walk(0, -1, along);
      const e = d!;
      const upAlong = up.x * e.x + up.y * e.y;
      const right = walk(1, 0, along - Math.PI / 2);
      const rightAlong = right.x * e.x + right.y * e.y;
      check(
        "eyes: the stick walks along the look, up ahead and right to its right",
        upAlong > 2 && Math.abs(-up.x * e.y + up.y * e.x) < upAlong * 0.35 && rightAlong > 2 && Math.abs(-right.x * e.y + right.y * e.x) < rightAlong * 0.35,
        `up: ${upAlong.toFixed(1)} cells ahead; right: ${rightAlong.toFixed(1)} cells to the right`,
      );
      release(world);
    }
  }

  // 12. The mark's cast is held to its range: on flat ground at 1.6 high, looking down 0.5 lands
  // 2.9 cells out; nearly flat (16 cells) or at the sky, at the range's end, 14 cells straight ahead.
  {
    const flat = () => 0;
    const eye = { x: 50, y: 50, h: 1.6, yaw: 0.3, pitch: -0.5 };
    const down = aimAt(eye, flat, 100, 100);
    const low = aimAt({ ...eye, pitch: -0.1 }, flat, 100, 100);
    const sky = aimAt({ ...eye, pitch: 0.4 }, flat, 100, 100);
    const edge = aimAt({ ...eye, x: 95, yaw: 0, pitch: 0.2 }, flat, 100, 100);
    const ok =
      down.hit &&
      Math.abs(down.dist - 1.6 / Math.tan(0.5)) < 0.15 &&
      !low.hit &&
      Math.abs(low.dist - CAST_RANGE) < 1e-6 &&
      Math.abs(Math.atan2(low.y - 50, low.x - 50) - 0.3) < 1e-6 &&
      !sky.hit &&
      Math.abs(sky.dist - CAST_RANGE) < 1e-6 &&
      edge.x <= 98.5;
    check(
      "eyes: a cast lands where the mark meets the ground, and no further than the range",
      ok,
      `down ${down.dist.toFixed(2)} (hit ${down.hit}), low ${low.dist.toFixed(2)} (hit ${low.hit}), sky ${sky.dist.toFixed(2)}, at the rim x ${edge.x.toFixed(1)}`,
    );
    // From a villager's own eyes on the island: the ground a few cells ahead is under the mark.
    const ground = groundOf(world);
    const own = aimAt({ x: c.x, y: c.y, h: ground(c.x, c.y) + 1.6, yaw: Math.atan2(d!.y, d!.x), pitch: -0.35 }, ground, world.w, world.h);
    check(
      "eyes: from a villager's eyes, looking down, the mark meets the island within reach",
      own.hit && own.dist > 1 && own.dist < CAST_RANGE,
      `${own.dist.toFixed(1)} cells`,
    );
  }

  // 13. Its own acts: only those its kind does by itself, each doing what it says. A villager's is its
  // trade on what is in front (the owner, 12 November: "Why Eat as an option?"); Strike for those who
  // fight; Eat only for an animal at its food.
  {
    // Its spawning cell, open grass: where the walk above left it depends on the walk.
    const at = { ...home };
    // The villager of the walk is done: out of the way of the strike below.
    c.hp = 0;
    c.dead = true;
    const face = Math.atan2(d!.y, d!.x);
    const ids = (o: Creature) => deedsOf(world, o, face).map((x) => x.verb);
    const deer = makeCreature("deer", at.x, at.y);
    const wolf = makeCreature("wolf", at.x + 3, at.y);
    const bear = makeCreature("bear", at.x + 30, at.y);
    const fish = world.creatures.find((o) => !o.dead && o.kind === "fish");
    world.creatures.push(deer, wolf);
    const villagers = world.creatures.filter((o) => !o.dead && o.kind === "villager" && unpackLook(o.look).age === "adult");
    const byJob = (job: string) => villagers.find((o) => jobOf(o) === job);
    const guard = byJob("guard");
    const cutter = byJob("woodcutter");
    const farmer = byJob("farmer");
    const ahead = world.idx(at.x + Math.cos(face), at.y + Math.sin(face));
    const was = world.cover[ahead];
    // And the cell after it: a trade looks two cells ahead (goals.ts frontCells).
    const beyond = world.idx(at.x + Math.cos(face) * 2, at.y + Math.sin(face) * 2);
    const wasBeyond = world.cover[beyond];
    // Open grass ahead: no tree for a woodcutter, grass for a grazer.
    world.setCover(ahead, C.NONE);
    world.setCover(beyond, C.NONE);
    const put = (o: Creature) => {
      o.x = at.x;
      o.y = at.y;
    };
    const lists: string[] = [];
    const listOf = (name: string, o: Creature | undefined) => {
      if (!o) return null;
      const keep = { x: o.x, y: o.y };
      put(o);
      const l = ids(o);
      o.x = keep.x;
      o.y = keep.y;
      lists.push(`${name} ${l.join("+") || "none"}`);
      return l.join();
    };
    const deerL = listOf("deer", deer);
    const wolfL = listOf("wolf", wolf);
    const bearL = listOf("bear", bear);
    const fishL = listOf("fish", fish);
    const guardL = listOf("guard", guard);
    const cutterL = listOf("woodcutter", cutter);
    const farmerL = listOf("farmer", farmer);
    check(
      "eyes: each kind gets only the acts it does by itself: Strike for fighters, a trade for villagers, no Eat for them",
      wolfL === "Strike" &&
        // On grass a grazer is at its food (it makes do with grass, goals.ts MAKE_DO); a wolf never is.
        bearL === "Strike,Eat" &&
        deerL === "Eat" &&
        (!fish || fishL === "") &&
        (!guard || guardL === "Strike") &&
        (!cutter || cutterL === "Fell") &&
        (!farmer || farmerL === "Till" || farmerL === "Sow"),
      lists.join(", "),
    );

    // Eat: a hungry deer facing flowers gets Eat and eats them, as it grazes by itself; at once again, it is still eating.
    put(deer);
    possess(world, deer);
    const dm = mindOf(deer);
    dm.hunger = 0.8;
    world.setCover(ahead, C.FLOWER);
    const offered = ids(deer).join();
    const ate = doDeed(world, "eat", face);
    const after = dm.hunger;
    const again = doDeed(world, "eat", face);
    const struck = doDeed(world, "strike", face);
    check(
      "eyes: Eat shows for a deer at its food and eats the plant in front, as its own grazing does",
      offered === "Eat" &&
        typeof ate === "object" &&
        !!ate &&
        "done" in ate &&
        ate.done === "Ate flowers" &&
        Math.abs(after - 0.25) < 1e-9 &&
        world.cover[ahead] === C.NONE &&
        again === "busy" &&
        struck === null,
      `offered ${offered}; ${JSON.stringify(ate)}, hunger 0.80 to ${after.toFixed(2)}, the flowers ${world.cover[ahead] === C.NONE ? "gone" : "still there"}; again: ${again}; strike for a deer: ${struck}`,
    );
    release(world);

    // A woodcutter's trade: Fell on the tree in front makes it a stump, as its own felling does; on open grass it says what is missing.
    if (cutter) {
      const keep = { x: cutter.x, y: cutter.y };
      put(cutter);
      possess(world, cutter);
      world.setCover(ahead, C.NONE);
      world.setCover(beyond, C.NONE);
      const none = doDeed(world, "trade", face);
      world.setCover(ahead, C.TREE);
      const verb = ids(cutter).join();
      const felled = doDeed(world, "trade", face);
      const stump = world.cover[ahead] === C.STUMP;
      check(
        "eyes: a woodcutter's Fell fells the tree in front, and says so when there is none",
        !!none &&
          typeof none === "object" &&
          "missing" in none &&
          none.missing === "No tree in front" &&
          verb.includes("Fell") &&
          !!felled &&
          typeof felled === "object" &&
          "done" in felled &&
          stump,
        `open grass: ${JSON.stringify(none)}; a tree: ${verb}, ${JSON.stringify(felled)}, ${stump ? "a stump now" : `cover ${world.cover[ahead]}`}`,
      );
      release(world);
      cutter.x = keep.x;
      cutter.y = keep.y;
    }
    // A farmer's: Harvest on the crop in front takes it in, as its own harvest does.
    if (farmer) {
      const keep = { x: farmer.x, y: farmer.y };
      put(farmer);
      possess(world, farmer);
      world.setCover(ahead, C.CROP);
      const verb = ids(farmer).join();
      const r = doDeed(world, "trade", face);
      check(
        "eyes: a farmer's Harvest takes in the crop in front",
        verb.includes("Harvest") && !!r && typeof r === "object" && "done" in r && world.cover[ahead] !== C.CROP && mindOf(farmer).carry === "food",
        `${verb}: ${JSON.stringify(r)}, cover ${world.cover[ahead]}, carrying ${mindOf(farmer).carry}`,
      );
      release(world);
      farmer.x = keep.x;
      farmer.y = keep.y;
    }
    world.setCover(ahead, was);
    world.setCover(beyond, wasBeyond);

    // Strike: a wolf facing a deer in reach takes half a second of its own blows off it; facing away, nothing.
    possess(world, wolf);
    wolf.x = deer.x - 1;
    wolf.y = deer.y;
    deer.hp = 100;
    const away = doDeed(world, "strike", Math.PI);
    const hp0 = deer.hp;
    const hitIt = doDeed(world, "strike", 0);
    const blow = hp0 - deer.hp;
    const want = (kindOf(wolf).ai?.attack || 20) * STRIKE_SECONDS;
    check(
      "eyes: Strike lands the wolf's own blow on what is in front, and nothing when it faces away",
      JSON.stringify(away) === '{"missing":"Strike: nothing in reach"}' &&
        JSON.stringify(hitIt) === '{"done":"Struck the deer"}' &&
        Math.abs(blow - want) < 1e-6,
      `facing away: ${JSON.stringify(away)}; facing it: ${JSON.stringify(hitIt)}, ${blow.toFixed(1)} hp of ${want.toFixed(1)} expected`,
    );
    release(world);
    deer.hp = 0;
    wolf.hp = 0;
  }

  // 18. The hot bar keeps the order it had when the creature was taken; new items go at its end.
  {
    const fixed = ["fire", "water", "earth", "air"];
    const now = ["water", "lava", "fire", "air", "earth"];
    const kept = keepOrder(now, fixed);
    check("eyes: the bar does not reorder while possessed; what is new goes at its end", kept.join() === "fire,water,earth,air,lava", kept.join());
  }

  // 18b. One tap, one action: the click that follows a press is ignored even when it lands on another
  // button than the one pressed (picking a spell redraws the bar under the finger), and a click with
  // no press before it (a key, a screen reader) still acts.
  {
    let picks = 0;
    const tap = (t: number): void => {
      pressDown(t);
      picks++;
      // the bar is redrawn here: the click arrives on a new button, which never saw the press
      if (clickActs(t + 90)) picks++;
    };
    tap(5000);
    check("eyes: one tap on a slot picks once, though the bar is redrawn under the finger", picks === 1, `${picks}`);
    check("eyes: a click with no press before it still acts", clickActs(5000 + 5000));
  }

  // 19. No ring, no cast: aimed where the landing point is out of view, the cast does not go and the line says why.
  {
    let cast = 0;
    const r = castFromEyes(
      { x: 50, y: 50, h: 1.6, yaw: 0, pitch: 0.4 },
      () => 0,
      100,
      100,
      () => (cast++, true),
      () => false,
    );
    check(
      "eyes: with no ring in view nothing is cast, and the line says why",
      !r.ok && cast === 0 && r.why === NOTHING_TO_CAST_ON,
      `${JSON.stringify(r)}, ${cast} casts`,
    );
  }

  // 20. The eye looks the open way when it faces a wall, keeps its look when it is open, and is kept clear of a wall beside it.
  {
    const flat = () => 0;
    const wallEast = (x: number) => x >= 52;
    const turned = openLook(50.5, 50.5, 1.6, 0, flat, wallEast);
    const kept = openLook(50.5, 50.5, 1.6, Math.PI, flat, wallEast);
    const cleared = clearEye(51.9, 50.5, 1.6, flat, (cx) => cx === 52);
    const cliff = clearEye(
      50.5,
      50.95,
      1.6,
      (x, y) => (y >= 51 ? 4 : 0),
      () => false,
    );
    check(
      "eyes: facing a wall the eye turns to the open way, keeps an open look, and stays clear of walls and cliffs",
      Math.cos(turned) < 0.5 && Math.abs(kept - Math.PI) < 1e-9 && cleared.x <= 52 - 0.45 + 1e-9 && cliff.y <= 51 - 0.45 + 1e-9,
      `turned to ${turned.toFixed(2)} rad; kept ${kept.toFixed(2)}; beside a wall x ${cleared.x.toFixed(2)}; under a cliff y ${cliff.y.toFixed(2)}`,
    );
  }

  // 16. From behind, the camera's turn is the player's: it turns behind the creature once when it is
  // taken, never again by itself, and a drag turns it. Holding the stick one way keeps the creature
  // going that way on screen (the playtest of 12 November: it ran up the screen while the thumb held
  // right, and a pull down walked it back and forth).
  {
    const ground = groundOf(world);
    const o = new OrbitCamera(world.w, world.h);
    o.resize(344, 551);
    const v = makeCreature("villager", 0, 0);
    // Open grass with room to walk to the right of the view.
    let found = false;
    for (let y = 20; y < world.h - 20 && !found; y += 2)
      for (let x = 20; x < world.w - 20 && !found; x += 2) {
        const i = world.idx(x, y);
        if (world.ground[i] !== G.GRASS || world.cover[i] !== C.NONE || world.depth[i] > 0 || !open(world, x + 0.5, y + 0.5, 1, 0, 12)) continue;
        v.x = x + 0.5;
        v.y = y + 0.5;
        found = true;
      }
    // Facing up the map: the camera settles behind it with screen right along +x, the open way.
    v.hd = -Math.PI / 2;
    world.creatures.push(v);
    possess(world, v);
    const dt = 1 / 30;
    const frame = () => {
      o.chase(v.x, v.y, v.z, v.hd, 0.6);
      o.update(dt, 0, ground, false);
    };
    for (let k = 0; k < 90; k++) frame();
    const settled = o.theta;
    // Screen right is (cos theta, -sin theta) on the ground (possess.ts stickDir).
    const rightX = Math.cos(settled);
    const rightY = -Math.sin(settled);
    const from = { x: v.x, y: v.y };
    let mid = { x: 0, y: 0 };
    let k = 0;
    run(world, rt, 2.5, () => {
      awake(v);
      steerBy(world, 1, 0, o.theta);
      frame();
      if (++k === 20) mid = { x: v.x, y: v.y };
    });
    const late = { x: v.x - mid.x, y: v.y - mid.y };
    const lateRight = (late.x * rightX + late.y * rightY) / (Math.hypot(late.x, late.y) || 1);
    const turned = Math.abs(Math.atan2(Math.sin(o.theta - settled), Math.cos(o.theta - settled)));
    const before = o.theta;
    o.orbit(100, 0);
    const dragged = Math.atan2(Math.sin(o.theta - before), Math.cos(o.theta - before));
    check(
      "become: from behind, the camera keeps the player's turn, and the stick held right keeps going right on screen",
      found && turned < 0.01 && lateRight > 0.95 && Math.hypot(v.x - from.x, v.y - from.y) > 4 && Math.abs(dragged + 0.6) < 1e-6,
      `the camera turned ${turned.toFixed(3)} rad by itself in 2.5 s of walking; the last 1.8 s went ${(Math.acos(Math.max(-1, Math.min(1, lateRight))) * 57.3).toFixed(0)} degrees off screen right; a drag of 100 px turned it ${dragged.toFixed(2)}`,
    );
    release(world);
    v.hp = 0;
    v.dead = true;
    // A tap from behind casts where the finger is, within the same 14 cells.
    const near = withinRange(10, 10, 15, 13);
    const far = withinRange(10, 10, 40, 50);
    check(
      "eyes: a tap from behind casts where it is, and past 14 cells at the range's end toward it",
      near.x === 15 &&
        near.y === 13 &&
        Math.abs(Math.hypot(far.x - 10, far.y - 10) - CAST_RANGE) < 1e-9 &&
        Math.abs(Math.atan2(far.y - 10, far.x - 10) - Math.atan2(40, 30)) < 1e-9,
      `near (${near.x}, ${near.y}); far (${far.x.toFixed(1)}, ${far.y.toFixed(1)})`,
    );
  }

  // 17. Stopped dead, the line says why (the playtest of 12 November: a stop at the rim, a shore or a
  // cliff gave no sign): at a real shore with deep water all along it, and at the rim of the world;
  // walking or at rest, nothing.
  {
    const v = makeCreature("villager", 0, 0);
    world.creatures.push(v);
    const deepAt = (x: number, y: number) => world.inside(x, y) && world.fluid[world.idx(x, y)] === F.WATER && world.depth[world.idx(x, y)] > 1.05;
    const dry = (x: number, y: number) => world.inside(x, y) && world.depth[world.idx(x, y)] === 0 && world.cover[world.idx(x, y)] === C.NONE;
    // Dry ground with deep water one and two cells off, all along five cells of a straight shore, in any of four ways.
    let shore: { x: number; y: number; dx: number; dy: number } | null = null;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      for (let y = 10; y < world.h - 10 && !shore; y++)
        for (let x = 10; x < world.w - 10 && !shore; x++) {
          if (!dry(x, y) || !dry(x - dx, y - dy)) continue;
          let ok = true;
          for (let k = -2; k <= 2 && ok; k++) ok = deepAt(x + dx - dy * k, y + dy + dx * k) && deepAt(x + 2 * dx - dy * k, y + 2 * dy + dx * k);
          if (ok) shore = { x, y, dx, dy };
        }
    possess(world, v);
    const pushFor = (dx: number, dy: number, seconds: number) => {
      let why: string | null = null;
      steerBy(world, dx, dy, 0);
      run(world, rt, seconds, () => {
        awake(v);
        v.hp = Math.max(v.hp, 50);
        why = stopNote(world, whyStopped) ?? why;
      });
      return why as string | null;
    };
    let atWater: string | null = "no shore";
    if (shore) {
      v.x = shore.x;
      v.y = shore.y;
      atWater = pushFor(shore.dx, shore.dy, 2);
    }
    // Walking off: back the way it came, onto the dry ground behind it.
    const walking = (() => {
      steerBy(world, -(shore?.dx ?? 1), -(shore?.dy ?? 0), 0);
      run(world, rt, 0.4, () => awake(v));
      return stopNote(world, whyStopped);
    })();
    v.x = 3.6;
    v.y = Math.round(world.h / 2);
    const atRim = pushFor(-1, 0, 2);
    // Stopped at the rim with a solid cover in the cell before it (driven, it slides only along a wall
    // it meets aslant, and no longer dodges round one as the engine's steering did), the line says so.
    const coverAhead = solidCovers(world)[world.cover[world.idx(v.x - 0.6, v.y)]] === 1;
    steerBy(world, 0, 0, 0);
    const atRest = stopNote(world, whyStopped);
    check(
      "become: stopped dead at the sea, the line says why; walking or at rest, nothing",
      atWater === "Deep water stops you" &&
        (atRim === null || atRim === "The edge of the world" || (atRim === "Something is in the way" && coverAhead)) &&
        walking === null &&
        atRest === null,
      `at the shore: ${atWater}; at the rim (said only if it stalled there rather than sliding along): ${atRim}; walking off: ${walking}; at rest: ${atRest}`,
    );
    release(world);
    v.hp = 0;
    v.dead = true;
  }

  // 14. The page's messages from the island are checked like the rest: anything else is dropped.
  {
    const good = [
      readFromWorld({ type: "eyes", on: true }),
      readFromWorld({ type: "riding", on: false }),
      readFromWorld({ type: "pick", key: null }),
      readFromWorld({ type: "pick", key: "fireball" }),
    ];
    const bad = [
      readFromWorld({ type: "eyes", on: "yes" }),
      readFromWorld({ type: "eyes" }),
      readFromWorld({ type: "riding", on: 1 }),
      readFromWorld({ type: "pick", key: "" }),
      readFromWorld({ type: "pick", key: "x".repeat(121) }),
      readFromWorld({ type: "pick", key: 7 }),
      readFromWorld({ type: "pick" }),
    ];
    check(
      "eyes: the eye view's messages from the island are read only in their shape",
      good.every((m) => m !== null) && bad.every((m) => m === null) && JSON.stringify(good[2]) === '{"type":"pick","key":null}',
      `${good.filter(Boolean).length} of 4 good read, ${bad.filter((m) => m === null).length} of 7 bad dropped`,
    );
  }
}
