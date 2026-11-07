// 4.6 part B checks, run by `npm test` (sim-test.ts): a person item is one
// of the island's own villagers (the owner, 7 November), with a calling from
// its name; creatures are written as living things, and the test run follows
// each for two minutes (the creature probe); the judge asks whether an item
// looks and acts like its name.
import { personName } from "../shared/forms";
import {
  CREATURE_SECTION,
  FORM_EXAMPLES,
  FOX_SPIRIT_EXAMPLE,
  JUDGE_SCHEMA,
  JUDGE_SYSTEM,
  PERSON_EXAMPLE,
  PERSON_SECTION,
  SPELL_SYSTEM,
  judgeUserMessage,
  spellUserMessage,
} from "../worker/prompts";
import { PLANTED_TREES, creatureProbe, runCheck } from "../src/sim/check";
import { unfitDefence } from "../src/sim/abilities";
import { kindOf, maxHp, populate } from "../src/sim/creatures";
import { daylight } from "../src/sim/daylight";
import { inspect } from "../src/sim/inspect";
import { VILLAGE_REACH } from "../src/sim/kin";
import { C } from "../src/sim/materials";
import { callingFromName, villageCenters } from "../src/sim/makers";
import { Runtime } from "../src/sim/runtime";
import { loadWorld, saveWorld } from "../src/sim/save";
import { stepHeadless } from "../src/sim/tick";
import { unpackLook } from "../src/sim/villagers";
import { buildRig, variantOf } from "../src/sim/voxel/rigs";
import { generateWorld, type World } from "../src/sim/world";
import { resolveLand } from "../src/sim/land";

type Check = (name: string, ok: boolean, detail?: string) => void;

const MID = { warmth: 0.5, water: 0.5, relief: 0.5, forest: 0.5 };

const NECROMANCER = `const spell = { *cast(w) { w.person(w.x, w.y, { calling: "necromancer", title: "Necromancer" }); } };`;
const HUMAN = `const spell = { *cast(w) { w.person(w.x, w.y, { title: "Human" }); } };`;
// What the live Human was (4.6 part A's reading): a creature kind of its own.
const HUMAN_AS_KIND = `const spell = { creatures: [{ name: "human", base: "villager", body: "two legs", features: ["glowing eyes"], speed: 3, goal: "explore" }], *cast(w) { w.spawn("human", w.x, w.y); } };`;
const ASLEEP = `const spell = { creatures: [{ name: "stone serpent", base: "beast", body: "serpent", goal: "guard" }], *cast(w) { const c = w.spawn("stone serpent", w.x, w.y); c.status("sleep", 600); } };`;

function island(): World {
  const world = generateWorld(152, 152, 4242, resolveLand(MID, 4242, 152));
  populate(world);
  return world;
}

function cast(world: World, name: string, code: string, x: number, y: number): Runtime {
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  rt.cast({ key: name, name, tier: "minor", code }, x, y);
  stepHeadless(world, rt);
  if (errors.length) throw new Error(errors[0]);
  return rt;
}

export function creatureChecks(check: Check): void {
  // Who is a person.
  const people = [
    "Human",
    "Blacksmith",
    "Necromancer",
    "Pyromancer",
    "Dragon Rider",
    "Old Hermit",
    "King Arthur",
    "Sorceress",
    "Ghost Hunter",
    "Spirit Guard",
    "Castle Lord",
  ];
  const beasts = ["Serpent", "Fox Spirit", "Lich", "Ghost", "Witch Cat", "Vampire", "Vampire Lord", "Goblin King", "Golem", "Dragon"];
  const wrong = [...people.filter((n) => !personName(n)), ...beasts.filter((n) => personName(n))];
  check("people are told from beasts by the name", !wrong.length, wrong.join(", "));
  const callings: [string, string][] = [
    ["Blacksmith", "blacksmith"],
    ["Necromancer", "necromancer"],
    ["Paladin", "knight"],
    ["Sorceress", "mage"],
    ["Human", "none"],
  ];
  const off = callings.filter(([n, c]) => callingFromName(n) !== c);
  check("a calling from the name", !off.length, off.map(([n]) => `${n}: ${callingFromName(n)}`).join(", "));

  // The writer's message: a person gets the person rules, a beast the living-thing rules with both examples.
  const human = spellUserMessage("Human", "artifact", "a person", ["Life", "Earth"], "minor", [], undefined, [], "creature");
  const serpent = spellUserMessage("Serpent", "artifact", "a snake", ["Earth", "Life"], "minor", [], undefined, [], "creature");
  check(
    "a person is written with w.person, a beast as a living thing with the serpent and the fox spirit",
    human.includes(PERSON_SECTION) &&
      !human.includes(FOX_SPIRIT_EXAMPLE.code) &&
      serpent.includes(CREATURE_SECTION) &&
      serpent.includes(FORM_EXAMPLES.creature.code) &&
      serpent.includes(FOX_SPIRIT_EXAMPLE.code) &&
      !serpent.includes("w.person("),
  );

  // The system prompt's API names w.person (production, 7 November: with only
  // the user section saying so, 9 of 14 people were written as beasts).
  const peopleLine = SPELL_SYSTEM.split("\n").find((l) => l.startsWith("People: w.person(")) ?? "";
  check(
    "the writer's API names w.person, and a person is never spawned",
    /never with w\.spawn or spell\.creatures/.test(peopleLine) && SPELL_SYSTEM.indexOf("People: w.person(") < SPELL_SYSTEM.indexOf("Creatures: w.creatures("),
    peopleLine,
  );

  // w.person on a made island: a villager of the nearest village.
  {
    const world = island();
    const center = villageCenters(world)[0];
    const before = world.creatures.filter((c) => c.kind === "villager").length;
    const rt = cast(world, "Blacksmith", PERSON_EXAMPLE.code, center.x + 5, center.y + 5);
    const p = rt.people.get("Blacksmith")?.[0];
    const look = p ? unpackLook(p.look) : null;
    const host = p && world.creatures.find((o) => o !== p && o.kind === "villager" && Math.hypot(o.homeX - p.homeX, o.homeY - p.homeY) < 1.3);
    check(
      "w.person: a villager, of the village's own look, with a job, a calling and a home in the village",
      !!p &&
        p.kind === "villager" &&
        world.creatures.filter((c) => c.kind === "villager").length === before + 1 &&
        look?.job === "smith" &&
        look?.calling === "blacksmith" &&
        !!host &&
        unpackLook(host.look).style === look?.style &&
        Math.hypot(p.homeX - center.x, p.homeY - center.y) < VILLAGE_REACH,
      JSON.stringify({ look, home: p && [p.homeX, p.homeY], center }),
    );
    const card = p ? inspect(world, p, kindOf, maxHp) : null;
    check(
      "its card: the item's name, the calling, who it lives with, what it remembers doing",
      !!card &&
        card.title === "Blacksmith" &&
        card.rows.some(([k, v]) => k === "Wants to" && v === "work the forge") &&
        card.rows.some(([k]) => k === "Lives with") &&
        card.rows.some(([k, v]) => k === "Last did" && v.startsWith("came to live in")),
      JSON.stringify(card),
    );
    const smithy = world.cover.some((c) => c === C.SMITHY);
    for (let k = 0; k < 30 * 120; k++) stepHeadless(world, rt);
    check(
      "a blacksmith works the smithy (raised by its home when the village had none)",
      smithy && (p?.mind?.deeds ?? 0) > 0 && world.story.some((l) => l.text.includes("forged tools at the smithy")),
      JSON.stringify({ smithy, did: p?.mind?.did, deeds: p?.mind?.deeds }),
    );
    const saved = JSON.parse(JSON.stringify(saveWorld(world, rt.owners)));
    const back = loadWorld(saved, () => {});
    const again = back?.creatures.find((c) => c.kind === "villager" && c.mind?.title === "Blacksmith");
    check(
      "a save keeps the person's calling, job and name",
      !!again && unpackLook(again.look).calling === "blacksmith" && unpackLook(again.look).job === "smith",
      JSON.stringify(again && unpackLook(again.look)),
    );
  }

  // A necromancer keeps the night and raises thralls bound to the village; they crumble at dawn.
  {
    const world = island();
    const center = villageCenters(world)[0];
    const rt = cast(world, "Necromancer", NECROMANCER, center.x + 4, center.y + 4);
    const villagers = () => world.creatures.filter((c) => !c.dead && c.kind === "villager").length;
    const at = villagers();
    let t = world.time;
    while (daylight(t).night < 0.7) t += 1;
    world.time = t - 5;
    let most = 0;
    let awake = false;
    for (let k = 0; k < 30 * 60; k++) {
      stepHeadless(world, rt);
      most = Math.max(most, world.creatures.filter((c) => !c.dead && c.kind === "thrall").length);
      const p = rt.people.get("Necromancer")?.[0];
      if (p?.mind?.action === "walking among the graves") awake = true;
    }
    const p = rt.people.get("Necromancer")?.[0];
    const look = p ? unpackLook(p.look) : null;
    check(
      "a necromancer walks the graves at night and raises thralls, three at most",
      look?.calling === "necromancer" && awake && most >= 1 && most <= 3,
      JSON.stringify({ awake, most, action: p?.mind?.action }),
    );
    check("its thralls leave the village's people alone", villagers() >= at - 1, `${at} villagers, then ${villagers()}`);
    while (daylight(world.time).night > 0.05) stepHeadless(world, rt);
    for (let k = 0; k < 30 * 40; k++) stepHeadless(world, rt);
    const left = world.creatures.filter((c) => !c.dead && c.kind === "thrall").length;
    check("dawn crumbles them", left === 0, `${left} thralls in the day`);
    // Drawn with its hood and staff, as its own variant of the villager figure.
    const spec = kindOf(p!).body;
    const plain = p!.look & 0xffff;
    check(
      "a calling is its own figure (the necromancer's staff, not the priest's book)",
      variantOf(spec, p!.look) !== variantOf(spec, plain) && JSON.stringify(buildRig(spec, p!.look).parts) !== JSON.stringify(buildRig(spec, plain).parts),
    );
  }

  const SKY_MAGE = `const spell = { *cast(w) { w.flash("#bfe3ff", 0.2); const p = w.person(w.x, w.y, { calling: "mage", title: "Sky Mage" }); if (p) w.burst(p.x, p.y, { count: 10, colors: ["#bfe3ff"], speed: 1.5, up: 2 }); } };`;
  // The test run's creature probe: the examples live; a Human drawn as a kind, and a creature that stands still, do not.
  const run = (name: string, code: string) => runCheck({ key: `b:${name}:${code.length}`, name, tier: "minor", kind: "artifact", form: "creature", code });
  for (const [name, code] of [
    ["Serpent", FORM_EXAMPLES.creature.code],
    ["Fox Spirit", FOX_SPIRIT_EXAMPLE.code],
    ["Blacksmith", PERSON_EXAMPLE.code],
    ["Necromancer", NECROMANCER],
    ["Human", HUMAN],
    // A mage's freeze and blink are the engine's, for a fight the probe never
    // starts (on the preview, 4 of 5 people written with w.person failed idle).
    ["Sky Mage", SKY_MAGE],
  ] as const) {
    const r = run(name, code);
    check(`the creature probe: ${name} lives for two minutes`, r.ok, r.detail);
  }
  const it = creatureProbe({ key: "b:hunt", name: "Serpent", tier: "minor", kind: "artifact", form: "creature", code: FORM_EXAMPLES.creature.code });
  let life;
  for (;;) {
    const r = it.next();
    if (r.done) {
      life = r.value;
      break;
    }
  }
  check(
    "the probe sets a prey near a hunter, and the serpent goes for it; magic used, the island holds",
    life.ok && life.hunted === true && life.abilities > 0 && life.villagersLeft >= 0.7,
    JSON.stringify(life),
  );
  const kind = run("Human", HUMAN_AS_KIND);
  check("a Human made as a creature kind fails its kind: a person is a villager", !kind.ok && kind.problem === "kind", kind.detail);
  const still = run("Stone Serpent", ASLEEP);
  check("a creature that stands still for two minutes fails, to be written once more", !still.ok && still.problem === "idle", still.detail);

  // Defensive magic its name or promise calls for (the owner, 7 November: "a
  // serpent raising a shield does not fit its name"). The live Serpent had
  // {do: "shield", when: "enemy near"}: the example serpent given that ability.
  const SHIELDED = FORM_EXAMPLES.creature.code.replace('{ do: "freeze", when: "hurt", every: 20 }', '{ do: "shield", when: "enemy near", every: 15 }');
  const WARDED = FORM_EXAMPLES.creature.code.replace('w.spawn("serpent", w.x, w.y);', 'w.spawn("serpent", w.x, w.y); w.ward(w.x, w.y, 6, { seconds: 20 });');
  const fit = (name: string, code: string, intents: string[] = []) =>
    runCheck({ key: `b:fit:${name}:${code.length}`, name, tier: "minor", kind: "artifact", form: "creature", code, intents });
  const shielded = fit("Serpent", SHIELDED);
  const warded = fit("Serpent", WARDED);
  const guardian = fit("Stone Guardian", SHIELDED);
  const promised = fit("Serpent", SHIELDED, ["protect"]);
  check(
    "a serpent that shields, or raises a ward, fails its fit; a guardian, or one that promises to protect, may shield",
    SHIELDED !== FORM_EXAMPLES.creature.code &&
      WARDED !== FORM_EXAMPLES.creature.code &&
      shielded.problem === "fit" &&
      warded.problem === "fit" &&
      guardian.problem !== "fit" &&
      promised.problem !== "fit",
    JSON.stringify([shielded.problem, warded.problem, guardian.problem, promised.problem, shielded.detail]),
  );
  const mends = [
    unfitDefence("Fox Spirit", [], [{ do: "heal", when: "hurt", every: 10 }], 0),
    unfitDefence("Fox Spirit", ["heal"], [{ do: "heal", when: "hurt", every: 10 }], 0),
    unfitDefence("Fox Spirit", [], [{ do: "heal", when: "every so often", every: 20 }], 0),
    unfitDefence("Troll", [], [{ do: "heal", when: "hurt", every: 10 }], 0),
  ].map((d) => d !== null);
  check(
    "healing itself when hurt is defensive unless its promise or name heals; tending others is not",
    JSON.stringify(mends) === JSON.stringify([true, false, false, false]),
    JSON.stringify(mends),
  );

  // A druid plants a few trees: its deeds, not its body (production, 7
  // November: Druid as a villager with an oak and a birch failed at 10 cells
  // across). A forest still counts.
  const grove = (trees: number) =>
    `const spell = { *cast(w) { const p = w.person(w.x, w.y, { job: "farmer", title: "Druid" }); if (!p) return; ${Array.from(
      { length: trees },
      (_, k) => `w.tree(p.x + ${k % 2 ? -3 : 3} + ${Math.floor(k / 2) * 4}, p.y + ${k % 2 ? -2 : 2}, { style: "oak", height: 9 });`,
    ).join(" ")} } };`;
  const two = runCheck({ key: "b:druid:2", name: "Druid", tier: "minor", kind: "artifact", form: "creature", code: grove(2) });
  const forest = runCheck({ key: "b:druid:6", name: "Druid", tier: "minor", kind: "artifact", form: "creature", code: grove(PLANTED_TREES + 3) });
  check(
    "a druid's two trees are its deeds, not its size; a forest of them still counts",
    two.problem !== "size" && forest.problem === "size",
    JSON.stringify([two.problem, two.detail.slice(0, 160), forest.problem, forest.detail.slice(0, 160)]),
  );

  // The judge asks it of each item.
  check(
    "the judge asks: does this look and act like a <name>?",
    JUDGE_SYSTEM.includes("does this look and act like a <name>?") &&
      judgeUserMessage("Serpent", "artifact", "minor", "a snake", "", [], [1, 4, 8]).includes("does this look and act like a Serpent?") &&
      JUDGE_SCHEMA.required.includes("like"),
  );
}
