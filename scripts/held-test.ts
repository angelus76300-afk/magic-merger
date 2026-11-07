// Objects that are picked up and used (4.7, item 3; src/sim/held.ts), run by
// npm test (scripts/sim-test.ts). Who may take what, what a hand does with
// it, and how it leaves the hand: dropped at death, stolen, put down, used up.
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { TICK, generateWorld, type World } from "../src/sim/world";
import { makeCreature, maxHp, populate, resetCreatureIds, type Creature } from "../src/sim/creatures";
import { seeded } from "../src/sim/noise";
import { isArtifact, loadedState, stepArtifacts, type Artifact } from "../src/sim/artifacts";
import { PICKUP_DELAY, IDLE_DROP, holding, portable, take, wantsToTake } from "../src/sim/held";
import { mindOf } from "../src/sim/kin";
import { packLook, unpackLook } from "../src/sim/villagers";
import type { Tier } from "../shared/tiers";

type Check = (name: string, ok: boolean, detail?: string) => void;

// Each a program as Claude writes an object item: an artifact and its fine model.
const MODEL = (h: number, color: string) =>
  `w.model(w.x, w.y, [[-0.1, -0.1, 0, 0.2, 0.2, ${h}, "${color}"], [-0.2, -0.2, ${h}, 0.4, 0.4, 0.3, "${color}", "glow"]], { name: "look" });`;
const STAFF = `const spell = { *cast(w) { w.artifact(w.x, w.y, { name: "Fire Staff", effects: [{ when: "enemy", do: "burn", radius: 6, every: 4 }] }); ${MODEL(1.2, "#8a5a2a")} } };`;
const POTION = `const spell = { *cast(w) { w.artifact(w.x, w.y, { name: "Healing Potion", effects: [{ when: "every", do: "heal", radius: 3, every: 3 }] }); ${MODEL(0.4, "#d04060")} } };`;
const LANTERN_POST = `const spell = { *cast(w) { w.artifact(w.x, w.y, { name: "Lantern Post", effects: [{ when: "night", do: "light", radius: 6 }] }); ${MODEL(4, "#333333")} } };`;
const WELL = `const spell = { *cast(w) { w.artifact(w.x, w.y, { name: "Wishing Lamp", grants: ["water"] }); ${MODEL(0.5, "#6688aa")} } };`;
const RAIDER = `{ name: "goblin", base: "beast", color: "#3a6a2a", speed: 3, hp: 80, behavior: "hunt", prey: ["villager"], attack: 4, sense: 30, lifespan: 300 }`;

interface Isl {
  world: World;
  rt: Runtime;
  at: { x: number; y: number };
  errors: string[];
}

function island(): Isl {
  Math.random = seeded(4711);
  resetCreatureIds();
  const world = generateWorld(96, 96, 7);
  populate(world);
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  let at = { x: 48, y: 48 };
  for (let i = 0; i < world.n; i++)
    if (world.cover[i] === 4) {
      at = { x: (i % world.w) + 4, y: Math.floor(i / world.w) + 4 };
      break;
    }
  return { world, rt, at, errors };
}

function place(isl: Isl, code: string, key: string, tier: Tier = "major", dx = 0): Artifact {
  isl.rt.cast({ key, name: key, tier, code, form: "object" }, isl.at.x + dx, isl.at.y);
  for (let k = 0; k < 3; k++) stepHeadless(isl.world, isl.rt);
  const a = isl.world.landmarks.filter(isArtifact).find((l) => l.art.key === key);
  if (!a) throw new Error(`${key} placed nothing: ${isl.errors[0] ?? ""}`);
  return a;
}

function person(world: World, x: number, y: number, job: string, age = "adult"): Creature {
  const c = makeCreature("villager", x, y);
  const look = unpackLook(c.look);
  c.look = packLook({ ...look, job: job as typeof look.job, age: age as typeof look.age, calling: undefined });
  c.homeX = Math.round(x);
  c.homeY = Math.round(y);
  world.creatures.push(c);
  return c;
}

const run = (isl: Isl, seconds: number, each?: () => void) => {
  for (let k = 0; k < seconds / TICK; k++) {
    each?.();
    stepHeadless(isl.world, isl.rt);
  }
};

export function heldChecks(check: Check): void {
  // Who may carry what.
  {
    const isl = island();
    const staff = place(isl, STAFF, "staff");
    const post = place(isl, LANTERN_POST, "post", "major", 6);
    const lamp = place(isl, WELL, "lamp", "major", -6);
    check(
      "a staff can be carried; a lantern post four voxels tall and a lamp people draw water at cannot",
      portable(isl.world, staff) && !portable(isl.world, post) && !portable(isl.world, lamp),
      `${portable(isl.world, staff)} ${portable(isl.world, post)} ${portable(isl.world, lamp)}`,
    );
    const guard = person(isl.world, staff.x + 1, staff.y, "guard");
    const farmer = person(isl.world, staff.x - 1, staff.y, "farmer");
    const child = person(isl.world, staff.x, staff.y + 1, "guard", "child");
    const early = wantsToTake(isl.world, guard, staff);
    isl.world.time += PICKUP_DELAY;
    check(
      `a guard takes a staff that burns, once it has lain ${PICKUP_DELAY} s; a farmer and a child do not`,
      !early && wantsToTake(isl.world, guard, staff) && !wantsToTake(isl.world, farmer, staff) && !wantsToTake(isl.world, child, staff),
      `early ${early}, guard ${wantsToTake(isl.world, guard, staff)}, farmer ${wantsToTake(isl.world, farmer, staff)}, child ${wantsToTake(isl.world, child, staff)}`,
    );
  }

  // A villager walks to it and takes it on its own, and its look goes into the hand.
  {
    const isl = island();
    const staff = place(isl, STAFF, "staff");
    const guard = person(isl.world, staff.x + 4, staff.y + 2, "guard");
    let took = -1;
    run(isl, PICKUP_DELAY + 60, () => {
      if (took < 0 && staff.art.heldBy != null) took = isl.world.time;
    });
    const holder = isl.world.creatures.find((c) => c.id === staff.art.heldBy);
    const look = isl.world.props.filter((p) => p.key === "staff");
    check(
      "a guard nearby walks to the staff and takes it; its model goes to the hand",
      !!holder && took >= PICKUP_DELAY && look.length > 0 && look.every((p) => p.heldBy === holder.id) && !isl.errors.length,
      `held by ${holder?.id ?? "nobody"} (guard ${guard.id}) at ${took.toFixed(0)} s, props ${look.map((p) => p.heldBy).join(",")}`,
    );
  }

  // A staff in hand burns what comes at its holder; a potion is drunk once, when badly hurt.
  {
    const isl = island();
    const staff = place(isl, STAFF, "staff");
    const guard = person(isl.world, staff.x, staff.y, "guard");
    isl.world.time += PICKUP_DELAY;
    take(isl.world, guard, staff);
    // Twelve cells from where the staff lay, beyond its reach of six: only a staff that goes with its holder burns it.
    const [gx, gy] = [staff.x + 12, staff.y];
    isl.rt.cast(
      { key: "goblins", name: "Goblins", tier: "minor", code: `const spell = { creatures: [${RAIDER}], *cast(w) { w.spawn("goblin", w.x + 3, w.y); } };` },
      gx,
      gy,
    );
    let burnt = false;
    run(isl, 6, () => {
      guard.x = gx;
      guard.y = gy;
      burnt ||= isl.world.creatures.some((c) => c.kind.startsWith("goblin") && c.burning > 0);
    });
    check(
      "a staff in a guard's hand burns a goblin that comes at the guard, wherever it walked",
      burnt && staff.art.did.some((d) => d.includes("burn")),
      staff.art.did.join("; "),
    );
  }
  {
    const isl = island();
    const potion = place(isl, POTION, "potion");
    // Nobody else near: the village's priests heal their neighbors every 15 s.
    const far = isl.world.creatures.filter((c) => Math.hypot(c.x - potion.x, c.y - potion.y) > 30);
    isl.world.creatures.length = 0;
    isl.world.creatures.push(...far);
    const priest = person(isl.world, potion.x, potion.y, "priest");
    isl.world.time += PICKUP_DELAY;
    const wants = wantsToTake(isl.world, priest, potion);
    priest.dead = true;
    // A farmer holds it here: a priest heals itself every 15 s, which would hide what the potion does.
    const holder = person(isl.world, potion.x, potion.y, "farmer");
    take(isl.world, holder, potion);
    // Under the 90% a potion on the ground heals at, above the 50% a hand waits for.
    holder.hp = maxHp(holder) * 0.8;
    run(isl, 5);
    const kept = isl.world.landmarks.includes(potion);
    holder.hp = maxHp(holder) * 0.3;
    run(isl, 5);
    check(
      "a priest would take a healing potion; in a hand it is kept at 80% health, drunk at 30%, and gone",
      wants && kept && !isl.world.landmarks.includes(potion) && holder.hp > maxHp(holder) * 0.5 && !isl.world.props.some((p) => p.key === "potion"),
      `wants ${wants}, kept at 80%: ${kept}, hp now ${holder.hp.toFixed(0)}, still there ${isl.world.landmarks.includes(potion)}`,
    );
  }

  // It leaves the hand: at death, to a thief, after doing nothing, and when a world loads.
  {
    const isl = island();
    const staff = place(isl, STAFF, "staff");
    const guard = person(isl.world, staff.x, staff.y, "guard");
    isl.world.time += PICKUP_DELAY;
    take(isl.world, guard, staff);
    guard.x += 3;
    run(isl, 1.2);
    guard.dead = true;
    guard.hp = 0;
    const where = { x: Math.round(guard.x), y: Math.round(guard.y) };
    run(isl, 1.2);
    check(
      "a staff falls where its holder died, with its look",
      staff.art.heldBy == null && staff.x === where.x && staff.y === where.y && isl.world.props.filter((p) => p.key === "staff").every((p) => p.heldBy == null),
      `held ${staff.art.heldBy}, at ${staff.x},${staff.y} for ${where.x},${where.y}`,
    );
  }
  {
    const isl = island();
    const staff = place(isl, STAFF, "staff");
    const guard = person(isl.world, staff.x, staff.y, "guard");
    isl.world.time += PICKUP_DELAY;
    take(isl.world, guard, staff);
    isl.rt.cast(
      { key: "thief", name: "Thief", tier: "minor", code: `const spell = { creatures: [${RAIDER}], *cast(w) { w.spawn("goblin", w.x + 0.8, w.y); } };` },
      guard.x,
      guard.y,
    );
    stepHeadless(isl.world, isl.rt);
    const thief = isl.world.creatures.find((c) => c.kind.startsWith("goblin"))!;
    mindOf(thief).goal = "steal";
    let stolen = false;
    run(isl, 2, () => {
      guard.x = staff.x;
      guard.y = staff.y;
      thief.x = guard.x + 0.8;
      thief.y = guard.y;
      stolen ||= staff.art.heldBy === thief.id;
    });
    check(
      "a goblin at a guard's side steals the staff from its hand",
      stolen && holding(isl.world, thief) === staff,
      `held by ${staff.art.heldBy}, thief ${thief.id}`,
    );
  }
  {
    const isl = island();
    const staff = place(isl, STAFF, "staff");
    const guard = person(isl.world, staff.x, staff.y, "guard");
    isl.world.time += PICKUP_DELAY;
    take(isl.world, guard, staff);
    isl.world.time += IDLE_DROP + 1;
    for (let k = 0; k < 30; k++) {
      isl.world.tick++;
      stepArtifacts(isl.world);
    }
    check(
      `a staff that did nothing for ${IDLE_DROP} s is put down, and its holder does not take it back at once`,
      staff.art.heldBy == null && !wantsToTake(isl.world, guard, staff),
      `held ${staff.art.heldBy}`,
    );
    take(isl.world, guard, staff);
    const loaded = loadedState(JSON.parse(JSON.stringify(staff.art)));
    check("a loaded world holds nothing in a hand (creatures get new ids)", loaded?.heldBy === null, String(loaded?.heldBy));
  }

  // A cast from a hand is a creature's: never above minor.
  {
    const isl = island();
    const code = `const spell = { *cast(w) { w.artifact(w.x, w.y, { name: "Storm Wand", effects: [{ when: "every", do: "cast", spell: "Meteor Storm", every: 30 }] }); ${MODEL(0.8, "#aaaaff")} } };`;
    const wand = place(isl, code, "wand", "legendary");
    const caps: string[] = [];
    isl.world.magic = { cast: (_s, _x, _y, cap) => (caps.push(cap), true), run: () => false };
    const guard = person(isl.world, wand.x, wand.y, "guard");
    isl.world.time += PICKUP_DELAY;
    take(isl.world, guard, wand);
    for (const e of wand.art.effects) e.next = 0;
    for (let k = 0; k < 30; k++) {
      isl.world.tick++;
      stepArtifacts(isl.world);
    }
    check("a legendary wand in a hand casts at minor at most", caps.length > 0 && caps.every((c) => c === "minor"), caps.join(","));
  }
}
