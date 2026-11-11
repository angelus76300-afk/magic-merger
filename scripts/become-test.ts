// Become anything (2026-11-12, src/sim/possess.ts): the player is one creature. The stick walks it
// through the engine's own steering and walls, its own thinking is paused and comes back on release,
// its abilities fire on demand with their own cooldown, 0 health throws the player out, the save never
// sees it, and nothing it does ends a trouble.
import { KINDS, kindOf, makeCreature, populate, type Creature, type CreatureKind } from "../src/sim/creatures";
import { mindOf, storyOn } from "../src/sim/kin";
import { DEFAULT_LAND, resolveLand } from "../src/sim/land";
import { C, F } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { act, checkHeld, possess, possessed, powersOf, release, steerBy, stickDir, thoughtOf } from "../src/sim/possess";
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

// A straight way of `cells` open to a walker from (x, y) along (dx, dy).
function open(world: World, x: number, y: number, dx: number, dy: number, cells: number): boolean {
  for (let s = 1; s <= cells; s += 0.5) {
    const px = x + dx * s;
    const py = y + dy * s;
    if (!world.inside(px, py)) return false;
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

export function becomeChecks(check: Check): void {
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

  // 2. The stick walks it the way it points, and it stops when the stick is let go.
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
      push(world, (land.x - fish.x) / land.d, (land.y - fish.y) / land.d);
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
    let low = Infinity;
    let high = -Infinity;
    const start = { x: b.x, y: b.y };
    push(world, 1, 0);
    run(world, rt, 3, () => awake(b));
    push(world, 0, 1);
    run(world, rt, 12, () => {
      awake(b);
      low = Math.min(low, b.z);
      high = Math.max(high, b.z);
    });
    check(
      "become: a possessed bird keeps its altitude and goes where it is steered",
      low > alt - 2.2 && high < alt + 2.2 && Math.hypot(b.x - start.x, b.y - start.y) > 10,
      `altitude ${alt}: flew between ${low.toFixed(1)} and ${high.toFixed(1)}, ${Math.hypot(b.x - start.x, b.y - start.y).toFixed(0)} cells`,
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
    run(world, rt, 15.5, () => awake(h));
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
    }
  }
  storyOn(null);
}
