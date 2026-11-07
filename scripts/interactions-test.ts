// The interaction table (4.7, item 5): every effect against every protection
// and every material, with what should happen, so a fix in one place cannot
// break another. Run by npm test (scripts/sim-test.ts). Each effect is a small
// spell going through the World API, as a player's would; each protection a
// ward raised by another spell of the same tier; each material a patch of
// the island set under the target.
//
// The table itself is data (`PROTECTED`, `MATERIALS`): a row that changes on
// purpose is changed here, in plain sight of the review.
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { TICK, generateWorld, type World } from "../src/sim/world";
import { C, F, G } from "../src/sim/materials";
import { makeCreature, populate, resetCreatureIds, type Creature } from "../src/sim/creatures";
import { seeded } from "../src/sim/noise";
import { SLOW_FACTOR, SLOW_SECONDS, passShare, wardDamage, type Ward } from "../src/sim/wards";
import type { Tier } from "../shared/tiers";

type Check = (name: string, ok: boolean, detail?: string) => void;

const SIZE = 96;
const [TX, TY] = [48, 48];
const WARD_R = 6;

// A hostile creature for summon and teleport: hunts villagers, as raiders do.
const RAIDER = `{ name: "table raider", base: "beast", color: "#5a1020", speed: 4, hp: 300, behavior: "hunt", prey: ["villager"], attack: 30, sense: 40, lifespan: 30 }`;

interface Effect {
  name: string;
  // Spell code cast at the target.
  code: string;
  // Seconds to watch after the cast.
  seconds: number;
  // Did it reach what is at the target? Read after `seconds`.
  reached: (s: Scene) => boolean;
}

interface Scene {
  world: World;
  rt: Runtime;
  // A villager standing at the target, and its health at the cast.
  person: Creature;
  hp0: number;
  errors: string[];
  // Things the run recorded each tick: the most fire seen, the most lava, frost on the person.
  maxFire: number;
  maxLava: number;
  frozen: boolean;
  raiderIn: number;
}

const disc = (world: World, r: number, fn: (i: number) => void) => {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) fn((TY + dy) * world.w + TX + dx);
};

const hurt = (s: Scene) => s.person.dead || s.person.hp < s.hp0 - 5;
const houses = (s: Scene) => {
  let n = 0;
  disc(s.world, 2, (i) => {
    if (s.world.cover[i] === C.HOUSE) n++;
  });
  return n;
};

// The effects of 4.7's list. Projectiles come from outside the ward, as a
// meteor from the sky and a fireball thrown from the side.
// The live Meteor Strike's shape (the owner's report of 7 November): its
// body only marks the landing; the cast blasts, digs, clears and strikes.
const STRIKE: Effect = {
  name: "strike",
  code: `const spell = { *cast(w) { const x = w.x, y = w.y, R = 10; let hit = false;
  w.body({ x: x - 30, y: y - 15, z: 160, vx: 30 / 1.8, vy: 15 / 1.8, vz: -160 / 1.8, gravity: 0, r: 2.6, look: "meteor", land(b, w) { hit = true; b.kill(); } });
  let t = 0; while (!hit && t < 3.3) { yield 0; t += 1 / 30; }
  w.explode(x, y, R, 4); w.terraform(x, y, R, -R * 0.45);
  w.ring(x, y, R * 0.9, R * 1.2, (cx, cy) => w.raise(cx, cy, w.cell(cx, cy).height + 1));
  for (const c of w.creatures(x, y, 20)) { if (w.dist(x, y, c.x, c.y) < R * 0.6) c.hurt(80); }
  w.paint(x, y, R * 1.4, "ash", 0.85);
  w.disc(x, y, R * 1.5, (cx, cy) => { if (w.cell(cx, cy).cover) { w.clear(cx, cy, "cover"); w.set(cx, cy, "ash"); } });
  w.temperature(x, y, R * 0.6, 300);
  w.sphere(x, y, 1, 2.2, ["#3a3f4a"], 0.9, "stone");
  yield 2; } };`,
  seconds: 6,
  reached: () => false,
};

// The live Meteor Storm's shape: each body's land hook blasts, digs and strikes.
const STORM: Effect = {
  name: "storm",
  code: `const spell = { *cast(w) { for (let k = 0; k < 6; k++) { const tx = w.x + w.rand(-2, 2), ty = w.y + w.rand(-2, 2);
w.body({ x: tx - 20, y: ty, z: 95, vx: 20 / 1.3, vy: 0, vz: -95 / 1.3, r: 1.6, look: "meteor", gravity: 0.3, land(b, w) {
  w.explode(b.x, b.y, 2, 2.2); w.terraform(b.x, b.y, 2.2, -3); w.paint(b.x, b.y, 2.8, "basalt", 0.6);
  w.sphere(b.x, b.y, 1, 1.4, ["#3a2a24"], 0.8, "stone"); for (const c of w.creatures(b.x, b.y, 5)) c.hurt(40); b.kill(); } });
yield 0.3; } yield 3; } };`,
  seconds: 6,
  reached: () => false,
};

export const EFFECTS: Effect[] = [
  {
    name: "fire",
    code: `const spell = { *cast(w) { for (let k = 0; k < 4; k++) { w.ignite(w.x, w.y, 3, 1); yield 0.3; } } };`,
    seconds: 2,
    reached: (s) => s.maxFire > 0,
  },
  {
    name: "flood of lava",
    code: `const spell = { *cast(w) { w.flood(w.x, w.y, 3, "lava", 1.5); } };`,
    seconds: 2,
    reached: (s) => s.maxLava > 0.05,
  },
  {
    name: "lightning",
    code: `const spell = { *cast(w) { w.lightning(w.x, w.y, { power: 2 }); } };`,
    seconds: 1,
    reached: hurt,
  },
  {
    name: "meteor",
    code: `const spell = { *cast(w) { w.body({ x: w.x, y: w.y, z: 40, vz: -30, gravity: 20, r: 1.5, look: "meteor", land(b, w) { w.explode(b.x, b.y, 3, 1.2); w.ignite(b.x, b.y, 2); for (const c of w.creatures(b.x, b.y, 2.5)) c.hurt(60); } }); yield 3; } };`,
    seconds: 3,
    reached: hurt,
  },
  {
    name: "fireball",
    code: `const spell = { *cast(w) { w.body({ x: w.x - 16, y: w.y, z: 1.5, vx: 18, r: 0.8, look: "flame", life: 3, tick(b, w) { if (Math.hypot(b.x - w.x, b.y - w.y) < 1) { for (const c of w.creatures(b.x, b.y, 2)) c.hurt(60); w.ignite(b.x, b.y, 1.5); b.kill(); } } }); yield 2; } };`,
    seconds: 2.5,
    reached: hurt,
  },
  {
    name: "blast",
    code: `const spell = { *cast(w) { w.explode(w.x, w.y, 3, 1.4); } };`,
    seconds: 1,
    reached: (s) => {
      let houses = 0;
      disc(s.world, 2, (i) => (houses += s.world.cover[i] === C.HOUSE ? 1 : 0));
      return houses < 13;
    },
  },
  {
    name: "summon",
    code: `const spell = { creatures: [${RAIDER}], *cast(w) { w.spawn("table raider", w.x + 1, w.y); } };`,
    seconds: 1,
    reached: (s) => s.raiderIn > 0,
  },
  {
    name: "teleport",
    code: `const spell = { creatures: [${RAIDER}], *cast(w) { const c = w.spawn("table raider", w.x + 20, w.y); yield 0.2; if (c) c.teleport(w.x + 1, w.y); } };`,
    seconds: 1.2,
    reached: (s) => s.raiderIn > 0,
  },
  {
    name: "heal",
    code: `const spell = { *cast(w) { for (const c of w.creatures(w.x, w.y, 3)) c.heal(40); } };`,
    seconds: 0.5,
    reached: (s) => s.person.hp > s.hp0 + 20,
  },
  {
    name: "freeze",
    code: `const spell = { *cast(w) { w.temperature(w.x, w.y, 3, -200); } };`,
    seconds: 0.5,
    reached: (s) => s.frozen,
  },
];

// Which protection stops which effect. A ward is cast first by another
// spell of the same tier, all of the probe's protections at once or one at a
// time. `true`: what the effect does never reaches the target. Heal is never
// stopped: a ward keeps out harm, not help.
const PROTECTIONS = ["none", "all", "fire", "fluids", "lightning", "harm", "cold", "creatures"] as const;
type Protection = (typeof PROTECTIONS)[number];
export const PROTECTED: Record<string, Protection[]> = {
  fire: ["all", "fire"],
  "flood of lava": ["all", "fluids"],
  lightning: ["all", "lightning"],
  // A body is stopped at the edge by a ward against harm or fire (wards.ts, stopsBodies).
  meteor: ["all", "harm", "fire"],
  fireball: ["all", "harm", "fire"],
  blast: ["all", "harm"],
  summon: ["all", "creatures"],
  teleport: ["all", "creatures"],
  heal: [],
  freeze: ["all", "cold"],
};

// What each effect does to each material at the target, with no ward.
// `true`: the material changes as the name of the effect says.
interface MaterialCase {
  material: string;
  effect: string;
  expect: boolean;
  what: string;
  changed: (s: Scene, before: Snapshot) => boolean;
}
interface Snapshot {
  cover: number;
  ground: number;
  fluid: number;
}

const at = (s: Scene) => TY * s.world.w + TX;
type Material = "grass" | "forest" | "house" | "sand" | "water" | "rock";

const burnt = (s: Scene, b: Snapshot) => s.maxFire > 0 || s.world.cover[at(s)] !== b.cover;
export const MATERIALS: MaterialCase[] = [
  { material: "grass", effect: "fire", expect: true, what: "grass catches", changed: burnt },
  { material: "forest", effect: "fire", expect: true, what: "trees burn", changed: burnt },
  { material: "house", effect: "fire", expect: true, what: "a house burns", changed: burnt },
  { material: "sand", effect: "fire", expect: false, what: "sand does not burn", changed: (s) => s.maxFire > 0.5 && s.world.ground[at(s)] !== G.SAND },
  { material: "water", effect: "fire", expect: false, what: "water does not burn", changed: (s) => s.world.fluid[at(s)] !== F.WATER },
  { material: "rock", effect: "fire", expect: false, what: "rock does not burn", changed: (s) => s.world.ground[at(s)] !== G.ROCK },
  { material: "forest", effect: "lightning", expect: true, what: "a struck tree catches", changed: burnt },
  { material: "sand", effect: "lightning", expect: true, what: "struck sand turns to glass", changed: (s, b) => s.world.ground[at(s)] !== b.ground },
  { material: "water", effect: "freeze", expect: true, what: "water freezes", changed: (s) => s.world.fluid[at(s)] === F.ICE },
  { material: "grass", effect: "freeze", expect: false, what: "grass stays grass", changed: (s, b) => s.world.ground[at(s)] !== b.ground },
  { material: "house", effect: "blast", expect: true, what: "a blast breaks a house", changed: (s) => s.world.cover[at(s)] !== C.HOUSE },
  { material: "forest", effect: "blast", expect: true, what: "a blast fells trees", changed: (s) => s.world.cover[at(s)] !== C.TREE },
  {
    material: "rock",
    effect: "blast",
    expect: false,
    what: "rock stays rock",
    changed: (s) => s.world.ground[at(s)] !== G.ROCK && s.world.ground[at(s)] !== G.ASH,
  },
  {
    material: "water",
    effect: "flood of lava",
    expect: true,
    what: "lava on water cools or boils it",
    changed: (s) => s.world.fluid[at(s)] !== F.WATER || s.world.ground[at(s)] === G.BASALT,
  },
  { material: "house", effect: "meteor", expect: true, what: "a meteor breaks a house", changed: (s) => s.world.cover[at(s)] !== C.HOUSE },
];

// One clean patch under the target: flat, the material asked, no other life near.
function scene(material: Material, ward: Protection, wardTier: Tier = "major"): Scene {
  Math.random = seeded(4747);
  resetCreatureIds();
  const world = generateWorld(SIZE, SIZE, 7);
  populate(world);
  const h = world.height[TY * world.w + TX];
  for (let dy = -12; dy <= 12; dy++)
    for (let dx = -12; dx <= 12; dx++) {
      const i = (TY + dy) * world.w + TX + dx;
      world.height[i] = Math.max(h, 8);
      world.ground[i] = G.GRASS;
      world.setCover(i, C.NONE);
      world.setFluid(i, F.NONE, 0);
      world.fire[i] = 0;
    }
  const far = world.creatures.filter((c) => Math.hypot(c.x - TX, c.y - TY) > 26);
  world.creatures.length = 0;
  world.creatures.push(...far);
  disc(world, 2, (i) => {
    if (material === "forest") world.setCover(i, C.TREE);
    else if (material === "house") world.setCover(i, C.HOUSE);
    else if (material === "sand") world.ground[i] = G.SAND;
    else if (material === "rock") world.ground[i] = G.ROCK;
    else if (material === "water") world.setFluid(i, F.WATER, 1.2);
  });
  // The blast row counts the houses of the patch, whatever the material.
  if (material === "grass") disc(world, 2, (i) => world.setCover(i, C.HOUSE));
  const person = makeCreature("villager", TX + 0.5, TY + 0.3);
  person.hp = 50;
  person.stun = 60;
  world.creatures.push(person);
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  if (ward !== "none") {
    const against = ward === "all" ? "" : `, against: ["${ward}"]`;
    rt.cast(
      {
        key: "table-ward",
        name: "Table Ward",
        tier: wardTier,
        code: `const spell = { *cast(w) { w.ward(w.x, w.y, ${WARD_R}, { seconds: 60${against} }); } };`,
      },
      TX,
      TY,
    );
    stepHeadless(world, rt);
  }
  return { world, rt, person, hp0: person.hp, errors, maxFire: 0, maxLava: 0, frozen: false, raiderIn: 0 };
}

function run(s: Scene, effect: Effect, tier: Tier = "major", key = "table-effect"): void {
  s.rt.cast({ key, name: effect.name, tier, code: effect.code }, TX, TY);
  const lava = s.world.materials.find("lava")!.id;
  for (let k = 0; k < effect.seconds / TICK; k++) {
    // The person stays put, so its health reads what reached the target.
    s.person.x = TX + 0.5;
    s.person.y = TY + 0.3;
    stepHeadless(s.world, s.rt);
    let fire = 0;
    let deep = 0;
    disc(s.world, 2, (i) => {
      fire = Math.max(fire, s.world.fire[i]);
      if (s.world.fluid[i] === lava) deep = Math.max(deep, s.world.depth[i]);
    });
    s.maxFire = Math.max(s.maxFire, fire);
    s.maxLava = Math.max(s.maxLava, deep);
    if (s.person.frozen > 0) s.frozen = true;
    s.raiderIn = s.world.creatures.filter((c) => c.kind.includes("raider") && !c.dead && Math.hypot(c.x - TX, c.y - TY) < WARD_R - 0.5).length;
  }
}

export function interactionChecks(check: Check): void {
  // 1. Effects against protections: one check per effect, naming every cell of its row that is wrong.
  for (const effect of EFFECTS) {
    const wrong: string[] = [];
    for (const p of PROTECTIONS) {
      const s = scene("grass", p);
      run(s, effect);
      const stopped = !effect.reached(s);
      const want = p === "none" ? false : PROTECTED[effect.name].includes(p);
      // Heal must reach in every case; with no ward every harmful effect must reach.
      if (stopped !== want || s.errors.length) wrong.push(`${p}: ${stopped ? "stopped" : "reached"}${s.errors.length ? ` (${s.errors[0]})` : ""}`);
    }
    check(`interactions: ${effect.name} against every ward`, !wrong.length, wrong.join("; "));
  }

  // 2. Effects on materials, with no ward.
  for (const m of MATERIALS) {
    const effect = EFFECTS.find((e) => e.name === m.effect)!;
    const s = scene(m.material as Material, "none");
    const i = at(s);
    const before = { cover: s.world.cover[i], ground: s.world.ground[i], fluid: s.world.fluid[i] };
    run(s, effect);
    const changed = m.changed(s, before);
    check(
      `interactions: ${m.effect} on ${m.material}: ${m.what}`,
      changed === m.expect && !s.errors.length,
      `changed ${changed}${s.errors[0] ? `, ${s.errors[0]}` : ""}`,
    );
  }

  // 3. A breaking point (4.7 item 1): a spell of the same tier cracks a ward
  // and never breaks it alone; a second cast breaks it; a spell two tiers
  // stronger breaks a weak ward at once and goes through; a weak one barely
  // scratches a strong ward.
  const meteor = EFFECTS.find((e) => e.name === "meteor")!;
  const rain = {
    ...meteor,
    code: meteor.code.replace("w.body(", "for (let k = 0; k < 8; k++) { w.body(").replace("yield 3;", "yield 0.15; } yield 3;"),
    seconds: 4,
  };
  {
    const s = scene("grass", "all", "major");
    run(s, rain, "major", "rain-1");
    const ward = s.world.wards[0];
    const cracked = ward ? wardDamage(ward) : 1;
    check(
      "a rain of eight meteors of the ward's tier cracks it and does not break it",
      !!ward && cracked > 0.3 && cracked <= 0.801 && !hurt(s),
      `damage ${cracked.toFixed(2)}, hurt ${hurt(s)}`,
    );
    // The owner, 7 November: a ward does not break against its own tier,
    // however many casts; a stronger tier breaks it.
    run(s, rain, "major", "rain-2");
    run(s, rain, "major", "rain-3");
    check(
      "a second and a third rain of the same tier crack it and never break it",
      s.world.wards.length === 1 && !hurt(s),
      `${s.world.wards.length} wards, damage ${s.world.wards[0] ? wardDamage(s.world.wards[0]).toFixed(2) : "-"}`,
    );
    run(s, rain, "grand", "rain-4");
    check("a rain a tier stronger breaks it", s.world.wards.length === 0, `${s.world.wards.length} wards`);
  }
  {
    // The owner's report of 7 November, "all of them let a meteor through",
    // in the shapes of the live library's programs: Meteor Strike throws a
    // body that only marks its landing, then the cast blasts, digs a
    // crater, clears the covers, drops a stone ball and strikes the people
    // at the target; Meteor Storm's bodies do the same in their land hook.
    // A ward of the spell's own tier keeps every house, the land and the
    // person under it.
    for (const [effect, tier] of [
      [STRIKE, "legendary"],
      [STORM, "legendary"],
      [STRIKE, "major"],
    ] as const) {
      const s = scene("grass", "all", tier);
      const before = { houses: houses(s), height: Float32Array.from(s.world.height) };
      run(s, effect, tier);
      let dug = 0;
      disc(s.world, 3, (i) => {
        if (Math.abs(s.world.height[i] - before.height[i]) > 0.5) dug++;
      });
      check(
        `a ward of its tier keeps everything under it from the live ${effect === STRIKE ? "Meteor Strike" : "Meteor Storm"}'s shape (${tier})`,
        s.world.wards.length === 1 && houses(s) === before.houses && dug === 0 && !hurt(s) && !s.errors.length,
        `${s.world.wards.length} wards, houses ${houses(s)} of ${before.houses}, ${dug} cells dug, hp ${s.person.hp.toFixed(0)} of ${s.hp0}${s.errors[0] ? `, ${s.errors[0]}` : ""}`,
      );
    }
  }
  {
    const s = scene("grass", "all", "minor");
    run(s, meteor, "grand");
    check(
      "a grand meteor breaks a minor ward and lands",
      s.world.wards.length === 0 && hurt(s),
      `${s.world.wards.length} wards, hp ${s.person.hp.toFixed(0)} of ${s.hp0}`,
    );
  }
  {
    const s = scene("grass", "all", "cosmic");
    run(s, meteor, "minor");
    const ward = s.world.wards[0];
    check("a minor meteor barely scratches a cosmic ward", !!ward && wardDamage(ward) < 0.05 && !hurt(s), ward ? wardDamage(ward).toFixed(3) : "broken");
  }
  {
    // The ward's own spell throws through its own dome.
    const s = scene("grass", "none");
    s.rt.cast({ key: "own", name: "Own", tier: "major", code: `const spell = { *cast(w) { w.ward(w.x, w.y, ${WARD_R}, { seconds: 60 }); } };` }, TX, TY);
    stepHeadless(s.world, s.rt);
    run(s, meteor, "major", "own");
    check("a ward lets its own spell's bodies through", hurt(s), `hp ${s.person.hp.toFixed(0)} of ${s.hp0}`);
  }
  {
    // Found by the playtest of 7 November: bodies that only heal wore wards
    // down and broke them. A healing rain reaches the people under a ward
    // and leaves it whole.
    const s = scene("grass", "all", "minor");
    const healRain = {
      name: "healing rain",
      code: `const spell = { *cast(w) { for (let k = 0; k < 8; k++) { w.body({ x: w.x + w.rand(-1, 1), y: w.y + w.rand(-1, 1), z: 30, vz: -20, gravity: 10, r: 1, look: "orb", color: "#7fe08a", land(b, w) { for (const c of w.creatures(b.x, b.y, 4)) c.heal(10); } }); yield 0.2; } yield 2; } };`,
      seconds: 3.5,
      reached: () => false,
    };
    run(s, healRain, "grand");
    const ward = s.world.wards[0];
    check(
      "a healing rain of a stronger tier heals under a ward and leaves it whole",
      !!ward && wardDamage(ward) === 0 && s.person.hp > s.hp0 + 20,
      `${ward ? wardDamage(ward).toFixed(2) : "broken"}, hp ${s.person.hp.toFixed(0)} of ${s.hp0}`,
    );
  }
  {
    // Found by the same playtest: one minor flood of lava broke a minor
    // ward, its flowing lava counted apart from the spell that poured it.
    const s = scene("grass", "all", "minor");
    const floods = {
      name: "floods",
      code: `const spell = { *cast(w) { for (let k = 0; k < 10; k++) { w.flood(w.x, w.y, 13, "lava", 2); yield 2; } } };`,
      seconds: 22,
      reached: () => false,
    };
    run(s, floods, "minor");
    const ward = s.world.wards[0];
    check(
      "ten floods of lava from one spell of the ward's tier crack it and do not break it",
      // Its own cast's share is at most 80%, the lava's pressure takes none: at least 20% is left.
      !!ward && wardDamage(ward) > 0.3 && (ward.hp ?? 0) >= 20 - 1e-9 && !hurt(s),
      `${ward ? `${wardDamage(ward).toFixed(2)} cracked, ${(ward.hp ?? 0).toFixed(0)} hp` : "broken"}, person ${s.person.hp.toFixed(0)}`,
    );
  }
  {
    // The game designer's rule for a stronger spell (4.7): a broken ward
    // spends what it had on the blow. One tier up at full health nothing
    // passes; a minor ward lets half a grand blow through and three
    // quarters of a legendary one, so a better ward keeps more. Measured
    // on the live Meteor Strike's shape, whose crater comes from the cast.
    // The owner's scale (7 November), by the gap between the threat's tier
    // and the ward's: 1, the blow is spent on the ward; 2, about half goes
    // through; 3, most of it. Each gap against a minor ward, for both live
    // shapes, measured as land dug and houses lost against no ward at all.
    const at = (effect: Effect, wardTier: Tier | null, tier: Tier) => {
      const s = scene("grass", wardTier ? "all" : "none", wardTier ?? "minor");
      const before = { houses: houses(s), height: Float32Array.from(s.world.height) };
      run(s, effect, tier);
      let dug = 0;
      disc(s.world, 3, (i) => (dug += Math.max(0, before.height[i] - s.world.height[i])));
      return { broken: !!wardTier && s.world.wards.length === 0, lost: before.houses - houses(s), dug, hp: s.person.dead ? 0 : s.person.hp };
    };
    for (const effect of [STRIKE, STORM]) {
      const name = effect === STRIKE ? "Meteor Strike" : "Meteor Storm";
      const gaps = (["major", "grand", "legendary"] as const).map((tier) => ({ tier, open: at(effect, null, tier), warded: at(effect, "minor", tier) }));
      const share = (g: (typeof gaps)[number]) => (g.open.dug > 0 ? g.warded.dug / g.open.dug : 0);
      const [one, two, three] = gaps;
      check(
        `gap 1: a minor ward under a major ${name} shatters and spends the blow, nothing behind it harmed`,
        one.warded.broken && one.warded.lost === 0 && one.warded.dug < 0.5 && one.warded.hp >= 45,
        JSON.stringify(one.warded),
      );
      check(
        `gap 2 and 3: a minor ward under a grand ${name} lets through about half, under a legendary one most`,
        two.warded.broken && three.warded.broken && share(two) > 0.2 && share(two) < 0.75 && share(three) > share(two) && share(three) > 0.5,
        `dug ${two.warded.dug.toFixed(0)} of ${two.open.dug.toFixed(0)} (grand), ${three.warded.dug.toFixed(0)} of ${three.open.dug.toFixed(0)} (legendary)`,
      );
    }
    const oneUp = at(STRIKE, "major", "grand");
    const minorLegendary = at(STRIKE, "minor", "legendary");
    const majorLegendary = at(STRIKE, "major", "legendary");
    const open = at(STRIKE, null, "legendary");
    check(
      "a ward one tier weaker shatters and spends the whole blow: every house, the land and the person kept",
      oneUp.broken && oneUp.lost === 0 && oneUp.dug < 0.5 && oneUp.hp >= 45,
      JSON.stringify(oneUp),
    );
    check(
      "a weaker ward softens a legendary blow by its tier: a major ward keeps more than a minor one, and both less than nothing",
      minorLegendary.broken && majorLegendary.broken && majorLegendary.dug < minorLegendary.dug && minorLegendary.dug < open.dug && majorLegendary.dug > 0,
      `dug: none ${open.dug.toFixed(0)}, minor ${minorLegendary.dug.toFixed(0)}, major ${majorLegendary.dug.toFixed(0)}`,
    );
    check(
      "pass share: none one tier up, half two tiers up, 94% from a cantrip ward under a cosmic blow",
      (() => {
        const ward = { maxHp: 100 } as Ward;
        const minor = passShare(ward, 2, 100);
        const two = passShare(ward, 4, 100);
        const cantrip = passShare({ maxHp: 50 } as Ward, 16, 50);
        return minor === 0 && Math.abs(two - 0.5) < 1e-9 && Math.abs(cantrip - 0.9375) < 1e-9;
      })(),
    );
  }
  {
    // Cast again over its own ward, the same spell mends it and renews its time.
    const s = scene("grass", "all", "minor");
    run(s, EFFECTS.find((e) => e.name === "meteor")!, "minor", "crack");
    const cracked = s.world.wards[0] ? wardDamage(s.world.wards[0]) : -1;
    const until = s.world.wards[0]?.until ?? 0;
    s.rt.cast(
      { key: "table-ward", name: "Table Ward", tier: "minor", code: `const spell = { *cast(w) { w.ward(w.x, w.y, ${WARD_R}, { seconds: 60 }); } };` },
      TX,
      TY,
    );
    stepHeadless(s.world, s.rt);
    const ward = s.world.wards[0];
    check(
      "a ward cast again by its own spell is mended and renewed, not doubled",
      cracked > 0.1 && s.world.wards.length === 1 && !!ward && wardDamage(ward) === 0 && ward.until > until,
      `${cracked.toFixed(2)} cracked, then ${s.world.wards.length} wards at ${ward ? wardDamage(ward).toFixed(2) : "-"}`,
    );
  }
  {
    // Cracks heal slowly: five seconds after the last hit, 2% a second.
    const s = scene("grass", "all", "minor");
    run(s, EFFECTS.find((e) => e.name === "meteor")!, "minor", "crack");
    const ward = s.world.wards[0];
    const cracked = ward ? wardDamage(ward) : -1;
    for (let k = 0; k < 20 / TICK; k++) stepHeadless(s.world, s.rt);
    const healed = ward ? wardDamage(ward) : -1;
    check(
      "a cracked ward heals slowly when nothing strikes it",
      cracked > 0.1 && healed >= 0 && healed < cracked - 0.1,
      `${cracked.toFixed(2)} then ${healed.toFixed(2)} after 20 s`,
    );
  }
  {
    // The slow motion of a shatter: once per ward, and not again within a
    // second (several breaking at once would drag the island).
    const s = scene("grass", "all", "minor");
    const before = s.world.slowUntil;
    run(s, STRIKE, "grand");
    const first = s.world.slowUntil;
    const t = s.world.time;
    s.rt.cast({ key: "w2", name: "Second Ward", tier: "minor", code: `const spell = { *cast(w) { w.ward(w.x, w.y, ${WARD_R}, { seconds: 60 }); } };` }, TX, TY);
    stepHeadless(s.world, s.rt);
    run(s, STRIKE, "grand", "again");
    check(
      "a shattered ward slows the island once, for a moment, and again only a second later",
      before < 0 && first > t - 7 && s.world.slowUntil > first && s.world.slowUntil - SLOW_SECONDS * SLOW_FACTOR <= s.world.time,
      `slow until ${first.toFixed(2)}, then ${s.world.slowUntil.toFixed(2)} at ${s.world.time.toFixed(2)}`,
    );
  }
  {
    // The review of #64: a body stopped on a ward skipped its end hook, so a
    // spell that cleans up or leaves something behind in end did not. It now
    // runs on the glass, after land, once.
    const ending = {
      name: "ending meteor",
      code: `const spell = { creatures: [{ name: "end marker", base: "beast", color: "#ffffff", speed: 0, hp: 10, lifespan: 60 }], *cast(w) { w.body({ x: w.x, y: w.y, z: 40, vz: -30, gravity: 20, r: 1.5, look: "meteor", life: 2.5, land(b, w) { w.explode(b.x, b.y, 3, 1.2); }, end(b, w) { w.spawn("end marker", w.x + 15, w.y); } }); yield 3; } };`,
      seconds: 4,
      reached: () => false,
    };
    const markers = (s: Scene) => s.world.creatures.filter((c) => c.kind.includes("end marker") && !c.dead).length;
    const open = scene("grass", "none");
    run(open, ending, "minor");
    const s = scene("grass", "all", "major");
    run(s, ending, "minor");
    check(
      "a meteor stopped on a ward runs its end hook once, as one that lands does",
      markers(open) === 1 && markers(s) === 1 && s.world.wards.length === 1 && !hurt(s) && !s.errors.length,
      `${markers(open)} without a ward, ${markers(s)} under one, ${s.world.wards.length} wards, hurt ${hurt(s)}${s.errors[0] ? `, ${s.errors[0]}` : ""}`,
    );
  }
  {
    // The playtest of the end hook: a thrown body (no land hook) whose end
    // harms struck the ward twice, broke a minor ward a plain body leaves
    // standing, and reached the people under it. One blow per body; a body
    // with no life never runs end, on the ground or on the glass.
    const thrown = (end: string, life: string) => ({
      name: "thrown",
      code: `const spell = { creatures: [{ name: "end marker", base: "beast", color: "#ffffff", speed: 0, hp: 10, lifespan: 60 }], *cast(w) { w.body({ x: w.x + 2, y: w.y, z: 50, vz: -45, r: 2, look: "meteor"${life}${end} }); yield 3; } };`,
      seconds: 4,
      reached: () => false,
    });
    const plain = scene("grass", "all", "minor");
    run(plain, thrown("", ", life: 6"), "minor");
    const harmful = scene("grass", "all", "minor");
    run(harmful, thrown(", end(b, w) { w.explode(b.x, b.y, 4, 1); for (const c of w.creatures(b.x, b.y, 6)) c.hurt(40); }", ", life: 6"), "minor");
    const [a, b] = [plain.world.wards[0], harmful.world.wards[0]];
    check(
      "a thrown body whose end harms strikes a ward once, like a plain one, and nobody under it is hurt",
      !!a && !!b && Math.abs(wardDamage(a) - wardDamage(b)) < 1e-9 && !hurt(harmful),
      `${a ? wardDamage(a).toFixed(2) : "broken"} plain, ${b ? wardDamage(b).toFixed(2) : "broken"} with end, hurt ${hurt(harmful)}`,
    );
    const lifeless = scene("grass", "all", "major");
    run(lifeless, thrown(', end(b, w) { w.spawn("end marker", w.x + 15, w.y); }', ""), "minor");
    const marks = lifeless.world.creatures.filter((c) => c.kind.includes("end marker")).length;
    check("a body with no life does not run its end on the glass, as it does not on the ground", marks === 0, `${marks} markers`);
  }
  {
    // Raiders pushed out again and again crack a minor ward, never break it.
    const s = scene("grass", "creatures", "minor");
    const siege = {
      name: "siege",
      code: `const spell = { creatures: [${RAIDER}], *cast(w) { for (let k = 0; k < 6; k++) { const a = k * 1.047; w.spawn("table raider", w.x + Math.cos(a) * 8, w.y + Math.sin(a) * 8); } } };`,
      seconds: 20,
      reached: () => false,
    };
    run(s, siege, "minor");
    const ward = s.world.wards[0];
    check(
      "six raiders for twenty seconds crack a minor ward and do not break it",
      !!ward && wardDamage(ward) > 0 && wardDamage(ward) <= 0.801,
      ward ? wardDamage(ward).toFixed(2) : "broken",
    );
  }
}
