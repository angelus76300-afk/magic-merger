// Monsters that live through their first day (2026-11-11): the three engine
// rules, each on its own, small and seeded. npm test (sim-test.ts) runs them;
// monsters-run.ts measures what they do together by a village.
import { ARRIVAL_AWAKE, KINDS, kindOf, makeCreature, resetCreatureIds, type Creature } from "../src/sim/creatures";
import { daylight } from "../src/sim/daylight";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { facing, standsUpTo, strikeBack } from "../src/sim/social";
import { C } from "../src/sim/materials";
import { stepHeadless } from "../src/sim/tick";
import { TICK, generateWorld, type World } from "../src/sim/world";

type Check = (name: string, ok: boolean, detail?: string) => void;

const NIGHT_WOLF = `const spell = { creatures: [
  { name: "moon wolf", base: "beast", body: "four legs", color: "#5a4a3a", speed: 2.6, hp: 80, behavior: "hunt", goal: "hunt",
    prey: ["deer"], attack: 18, active: "night", scares: ["villager"] } ],
  *cast(w) { w.spawn("moon wolf", w.x, w.y); } };`;

function open(): { world: World; rt: Runtime; at: { x: number; y: number } } {
  Math.random = seeded(5);
  resetCreatureIds();
  const world = generateWorld(64, 64, 5);
  const rt = new Runtime(world, () => {});
  // Open dry ground, away from trees and houses (shade would end the arrival).
  let at = { x: 32, y: 32 };
  for (let i = 0; i < world.n; i++) {
    const x = i % world.w;
    const y = Math.floor(i / world.w);
    if (x < 8 || y < 8 || x > 56 || y > 56 || world.depth[i] > 0.05 || world.cover[i]) continue;
    let open = true;
    for (let dy = -3; dy <= 3 && open; dy++)
      for (let dx = -3; dx <= 3; dx++) if (world.cover[i + dy * world.w + dx] || world.depth[i + dy * world.w + dx] > 0.05) open = false;
    if (open) {
      at = { x: x + 0.5, y: y + 0.5 };
      break;
    }
  }
  return { world, rt, at };
}

const asleep = (c: Creature): boolean => c.data.mood === "asleep" || !!c.mind?.action?.startsWith("asleep");

export function monsterChecks(check: Check): void {
  const outer = Math.random;
  // 1. A night creature placed by day is awake on arrival, and keeps its hours after its first minute.
  {
    const { world, rt, at } = open();
    rt.cast({ key: "t:moon", name: "Moon Wolf", tier: "minor", code: NIGHT_WOLF, kind: "artifact", form: "creature" }, at.x, at.y);
    const wolf = () => world.creatures.find((c) => c.kind.startsWith("moon wolf"));
    for (let k = 0; k < 3 / TICK; k++) stepHeadless(world, rt);
    const w = wolf();
    const day = daylight(world.time).night < 0.5;
    const early = !!w && !asleep(w);
    // Held where it is (no shade, no den), so only the minute can end the arrival.
    let wasAwake = 0;
    for (let k = 0; k < (ARRIVAL_AWAKE + 5) / TICK; k++) {
      if (w) Object.assign(w, { x: at.x, y: at.y });
      stepHeadless(world, rt);
      if (w && k < (ARRIVAL_AWAKE - 5) / TICK && !asleep(w)) wasAwake++;
    }
    check(
      "monsters: a night creature placed by day arrives awake, for its first minute",
      day && early && wasAwake > (ARRIVAL_AWAKE - 10) / TICK,
      `day ${day}, awake at 3 s ${early}, awake ${Math.round(wasAwake * TICK)} s of the first ${ARRIVAL_AWAKE - 5}`,
    );
    check("monsters: after its first minute it keeps its hours (asleep by day)", !!w && asleep(w), `mood ${w?.data.mood}, ${w?.mind?.action}`);
  }

  // 1b. One that daylight burns is not burnt in its first minute, and keeps to the shade by day.
  {
    const { world, rt, at } = open();
    const code = `const spell = { creatures: [{ name: "pale ghoul", base: "spirit", body: "two legs", flying: false, hp: 30, behavior: "wander", weak: ["light"] }], *cast(w) { w.spawn("pale ghoul", w.x, w.y); } };`;
    rt.cast({ key: "t:ghoul", name: "Pale Ghoul", tier: "minor", code, kind: "artifact", form: "creature" }, at.x, at.y);
    stepHeadless(world, rt);
    const ghoul = world.creatures.find((c) => c.kind.startsWith("pale ghoul"))!;
    for (let k = 0; k < (ARRIVAL_AWAKE - 10) / TICK; k++) {
      Object.assign(ghoul, { x: at.x, y: at.y });
      stepHeadless(world, rt);
    }
    check("monsters: a made creature daylight burns is not burnt in its first minute", !ghoul.dead && ghoul.hp >= 30, `health ${Math.round(ghoul.hp)}`);
    let walked = 0;
    const from = { x: ghoul.x, y: ghoul.y };
    for (let k = 0; k < 60 / TICK && !ghoul.dead; k++) {
      stepHeadless(world, rt);
      walked = Math.max(walked, Math.hypot(ghoul.x - from.x, ghoul.y - from.y));
    }
    check(
      "monsters: let go, it walks off to the shade and lives through the day",
      walked > 2 && !ghoul.dead && daylight(world.time).night < 0.3,
      `walked ${walked.toFixed(1)} cells, health ${Math.round(ghoul.hp)}`,
    );
    // A spell that tears its shade away (a fire, a flood) exposes it: it burns again.
    const before = ghoul.hp;
    const gx = Math.round(ghoul.x);
    const gy = Math.round(ghoul.y);
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = gx + dx;
        const y = gy + dy;
        if (world.inside(x, y) && (world.cover[y * world.w + x] === C.TREE || world.cover[y * world.w + x] === C.HOUSE))
          world.setCover(y * world.w + x, C.NONE);
      }
    for (let k = 0; k < 2 / TICK && !ghoul.dead; k++) stepHeadless(world, rt);
    check("monsters: its shade torn away, it burns again", ghoul.dead || ghoul.hp < before, `health ${Math.round(before)} then ${Math.round(ghoul.hp)}`);
  }
  // And caught in the open by day after its first minute, it still burns.
  {
    const { world, rt, at } = open();
    const code = `const spell = { creatures: [{ name: "pale ghoul", base: "spirit", body: "two legs", flying: false, hp: 30, behavior: "wander", weak: ["light"] }], *cast(w) { w.spawn("pale ghoul", w.x, w.y); } };`;
    rt.cast({ key: "t:ghoul2", name: "Pale Ghoul", tier: "minor", code, kind: "artifact", form: "creature" }, at.x, at.y);
    stepHeadless(world, rt);
    const ghoul = world.creatures.find((c) => c.kind.startsWith("pale ghoul"))!;
    let at60 = 0;
    for (let k = 0; k < (ARRIVAL_AWAKE + 5) / TICK && !ghoul.dead; k++) {
      Object.assign(ghoul, { x: at.x, y: at.y });
      stepHeadless(world, rt);
      if (k === Math.round((ARRIVAL_AWAKE - 2) / TICK)) at60 = ghoul.hp;
    }
    check(
      "monsters: caught in the open by day after its first minute, it still burns",
      at60 >= 30 && (ghoul.dead || ghoul.hp < at60),
      `health ${Math.round(at60)} at ${ARRIVAL_AWAKE - 2} s, ${Math.round(ghoul.hp)} at ${ARRIVAL_AWAKE + 5} s`,
    );
  }

  // 2. Villagers respect strength, against a creature an item made.
  {
    const { world, rt, at } = open();
    const kind = (name: string, spec: string) => {
      rt.cast(
        {
          key: `t:${name}`,
          name,
          tier: "minor",
          code: `const spell = { creatures: [{ name: "${name}", ${spec} }], *cast(w) { w.spawn("${name}", w.x, w.y); } };`,
          kind: "artifact",
          form: "creature",
        },
        at.x,
        at.y,
      );
      for (let k = 0; k < 2; k++) stepHeadless(world, rt);
      const c = world.creatures.find((o) => o.kind.startsWith(name))!;
      return c;
    };
    const villager = makeCreature("villager", at.x + 1, at.y);
    const scarer = kind("gloomer", `base: "beast", hp: 80, scares: ["villager"]`);
    const hunter = kind("manhunter", `base: "beast", hp: 150, behavior: "hunt", prey: ["villager"], attack: 10`);
    const giant = kind("ogre", `base: "beast", hp: 300, behavior: "hunt", prey: ["villager"], attack: 20`);
    const bear = makeCreature("bear", at.x, at.y + 1);
    const says = (t: Creature, allies: number) => standsUpTo(villager, t, kindOf(t), allies);
    check("monsters: villagers do not stand up to a made creature that only scares them", !says(scarer, 5));
    check("monsters: they stand up to one that hunts people, with under twice their health", says(hunter, 0) && says(hunter, 4));
    check("monsters: never alone against one with more than twice their health, in threes they do", !says(giant, 0) && !says(giant, 1) && says(giant, 2));
    check("monsters: the island's own animals keep the old rules (a mob still faces a bear)", KINDS.get("bear")?.native === true && says(bear, 3));
    hunter.data.mood = "asleep";
    check("monsters: never against one asleep that has struck no one", !says(hunter, 4));
    hunter.data.mood = undefined;
    villager.hp = 30;
    check("monsters: hurt to a third of its health, a villager breaks off", !says(hunter, 4));
    // A mob is those who face it: villagers near the creature, not near each other.
    villager.hp = 100;
    const crowd = [0, 1, 2, 3].map((n) => makeCreature("villager", at.x + 12 + n * 0.5, at.y + 12));
    const near = [0, 1].map((n) => makeCreature("villager", hunter.x + 1 + n, hunter.y));
    world.creatures.push(...crowd, ...near);
    check(
      "monsters: a mob is counted near the creature, not near the villager",
      facing(world, crowd[0], hunter) === 2,
      `${facing(world, crowd[0], hunter)} face it`,
    );
  }

  // 3. The exchange of blows: an awake made creature strikes back at the villager striking it.
  {
    const { world, rt, at } = open();
    rt.cast(
      {
        key: "t:brute",
        name: "Brute",
        tier: "minor",
        code: `const spell = { creatures: [{ name: "brute", base: "beast", hp: 200, behavior: "hunt", prey: ["villager"], attack: 20 }], *cast(w) { w.spawn("brute", w.x, w.y); } };`,
        kind: "artifact",
        form: "creature",
      },
      at.x,
      at.y,
    );
    for (let k = 0; k < 2; k++) stepHeadless(world, rt);
    const brute = world.creatures.find((o) => o.kind.startsWith("brute"))!;
    const a = makeCreature("villager", at.x + 1, at.y);
    const b = makeCreature("villager", at.x - 1, at.y);
    world.creatures.push(a, b);
    for (let k = 0; k < 30; k++) {
      strikeBack(world, brute, kindOf(brute), a, TICK);
      strikeBack(world, brute, kindOf(brute), b, TICK);
      world.tick++;
    }
    check(
      "monsters: an awake made creature strikes back at one villager at a time, with its attack",
      Math.abs(100 - a.hp - 20) < 1 && b.hp === 100,
      `the first lost ${Math.round(100 - a.hp)}, the second ${Math.round(100 - b.hp)}`,
    );
    brute.data.mood = "asleep";
    const before = a.hp;
    strikeBack(world, brute, kindOf(brute), a, 1);
    check("monsters: asleep, it gives no blow back", a.hp === before);
    const wolf = makeCreature("wolf", at.x, at.y);
    const c = makeCreature("villager", at.x + 1, at.y);
    strikeBack(world, wolf, kindOf(wolf), c, 1);
    check("monsters: the island's own animals do not strike back this way", c.hp === 100);
  }
  Math.random = outer;
}
