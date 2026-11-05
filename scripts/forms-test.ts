// 4.6 checks, run by `npm test` (sim-test.ts): the seven kinds, the engine's
// makers (a real village, a building with a job, land, a wonder where an item
// stands), each kind's prompt example through the real test run, and the
// sizes it holds each kind to: a giant book fails unless it says it is giant,
// a Serpent of stone spheres is no creature, a lantern charm is no village.
import { FORMS, formOf, guessForm, kindOfForm, saysGiant } from "../shared/forms";
import { FORM_EXAMPLES, FORM_SECTIONS, MERGE_SCHEMA, spellUserMessage } from "../worker/prompts";
import { runCheck } from "../src/sim/check";
import { populate } from "../src/sim/creatures";
import { C, F } from "../src/sim/materials";
import { Runtime } from "../src/sim/runtime";
import { loadWorld, saveWorld } from "../src/sim/save";
import { stepHeadless } from "../src/sim/tick";
import { generateWorld, type World } from "../src/sim/world";
import { resolveLand } from "../src/sim/land";
import { LAND_SHAPES, WONDER_LIST, villageCenters } from "../src/sim/makers";
import { findVillages } from "../src/sim/kin";

type Check = (name: string, ok: boolean, detail?: string) => void;

const MID = { warmth: 0.5, water: 0.5, relief: 0.5, forest: 0.5 };

function cast(world: World, code: string, x: number, y: number, seconds = 3): Runtime {
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  rt.cast({ key: "t", name: "T", tier: "major", code }, x, y);
  for (let k = 0; k < seconds * 30; k++) stepHeadless(world, rt);
  if (errors.length) throw new Error(errors[0]);
  return rt;
}

const count = (world: World, test: (i: number) => boolean) => {
  let n = 0;
  for (let i = 0; i < world.n; i++) if (test(i)) n++;
  return n;
};

export function formChecks(check: Check): void {
  // The kinds and their words.
  check("seven kinds, and only spell is cast", FORMS.length === 7 && FORMS.filter((f) => kindOfForm(f) === "spell").length === 1);
  check(
    "the merge answers one of the seven",
    JSON.stringify(MERGE_SCHEMA.properties.kind.enum) === JSON.stringify(FORMS),
    JSON.stringify(MERGE_SCHEMA.properties.kind.enum),
  );
  const guesses: [string, string | null][] = [
    ["Serpent", "creature"],
    ["Human", "creature"],
    ["Village", "settlement"],
    ["Wizard Tower", "building"],
    ["Floating Island", "land"],
    ["Fairy Grove", "place"],
    ["Dragon Egg", "object"],
    ["Giant Book", "object"],
    ["Fireball", null],
  ];
  const wrong = guesses.filter(([n, f]) => guessForm(n) !== f);
  check("an unsorted name is guessed by its last word that names a kind", !wrong.length, wrong.map(([n]) => `${n}: ${guessForm(n)}`).join(", "));
  check(
    "a stored form wins over the guess; a spell is a spell",
    formOf({ name: "Serpent", kind: "artifact", form: "object" }) === "object" && formOf({ name: "Serpent Strike", kind: "spell" }) === "spell",
  );
  check(
    "giant only when it says so, of itself",
    saysGiant("Giant's Book") &&
      saysGiant("Tome", "a colossal tome") &&
      !saysGiant("Grimoire", "an old book bound in leather") &&
      !saysGiant("Harvest Charm", "a huge help to farmers") &&
      !saysGiant("Sunstone", "it lights a vast plain") &&
      !saysGiant("Hammer", "forged by a giant long ago"),
  );
  check(
    "each kind's section and example reach the writer, and a spell gets none",
    (["creature", "object", "building", "settlement", "place", "land"] as const).every((f) =>
      spellUserMessage("X", "artifact", "d", null, "minor", [], undefined, [], f).includes(FORM_SECTIONS[f]),
    ) && !spellUserMessage("X", "spell", "d", null, "minor", [], undefined, [], "spell").includes("Example,"),
  );

  // w.village: a real village on the practice island and on a made island.
  for (const [label, make] of [
    ["the practice island", () => generateWorld(112, 112, 11)],
    ["a made island", () => generateWorld(152, 152, 4242, resolveLand(MID, 4242, 152))],
  ] as const) {
    const world = make();
    populate(world);
    const settlements = world.settlements.length;
    const houses = count(world, (i) => world.cover[i] === C.HOUSE);
    const people = world.creatures.filter((c) => c.kind === "villager").length;
    const first = world.cover.findIndex((c) => c === C.HOUSE);
    const centersBefore = villageCenters(world);
    cast(
      world,
      `const spell = { *cast(w) { w.village(w.x, w.y, { houses: 8, name: "Ashby" }); } };`,
      (first % world.w) + 6,
      Math.floor(first / world.w) + 6,
      1,
    );
    const s = world.settlements[world.settlements.length - 1];
    const made = { x: s?.x, y: s?.y, name: s?.name };
    const newHouses = count(world, (i) => world.cover[i] === C.HOUSE) - houses;
    const newPeople = world.creatures.filter((c) => c.kind === "villager").length - people;
    // From every other village's center, the old island's included (found from its houses, as before the cast).
    const apart = centersBefore.every((o) => Math.hypot(o.x - s.x, o.y - s.y) >= 26) && centersBefore.length > 0 && houses > 0;
    const fields = count(world, (i) => world.ground[i] === 8 && Math.hypot((i % world.w) - s.x, Math.floor(i / world.w) - s.y) < 16);
    check(
      `w.village on ${label}: a settlement with a name, houses, fields, a street, buildings with a job and villagers, apart from the others`,
      world.settlements.length === settlements + 1 &&
        s?.name === "Ashby" &&
        newHouses >= 6 * 4 &&
        newPeople >= 6 &&
        fields > 10 &&
        (s.jobs?.length ?? 0) >= 1 &&
        apart,
      JSON.stringify({ made, newHouses: newHouses / 4, newPeople, fields, jobs: s.jobs?.length, apart }),
    );
    // A minute later its villagers form a village of their own and work.
    const rt2 = new Runtime(world, () => {});
    for (let k = 0; k < 60 * 30; k++) stepHeadless(world, rt2);
    findVillages(world);
    const own = world.villages.find((v) => Math.hypot(v.x - s.x, v.y - s.y) < 14);
    check(`w.village on ${label}: a minute later its villagers live there as a village`, !!own && own.people >= 4, JSON.stringify(own));
    // Kept by a save.
    const back = loadWorld(JSON.parse(JSON.stringify(saveWorld(world, new Map()))), () => {})!;
    check(`w.village on ${label}: kept by a save`, back.settlements.length === world.settlements.length && back.settlements.some((o) => o.name === "Ashby"));
  }

  // The review of #50: 3 cells from the first house on practice islands of four seeds, it landed 21 to 22 cells away.
  {
    const far: string[] = [];
    for (const seed of [11, 12, 13, 15]) {
      const world = generateWorld(112, 112, seed);
      populate(world);
      const before = villageCenters(world);
      const first = world.cover.findIndex((c) => c === C.HOUSE);
      cast(world, `const spell = { *cast(w) { w.village(w.x, w.y, { houses: 7 }); } };`, (first % world.w) + 3, Math.floor(first / world.w) + 3, 1);
      const s = world.settlements[world.settlements.length - 1];
      const near = s ? Math.min(...before.map((o) => Math.hypot(o.x - s.x, o.y - s.y))) : -1;
      if (!s || near < 26) far.push(`seed ${seed}: ${s ? near.toFixed(1) : "no village"}`);
    }
    check("w.village stands 26 cells or more from every old village's center, on four practice islands", !far.length, far.join(", "));
  }

  // w.building: each job, near a village, joins it and is drawn by the builder.
  {
    const world = generateWorld(152, 152, 4242, resolveLand(MID, 4242, 152));
    populate(world);
    const s = world.settlements[0];
    const jobs = ["smithy", "chapel", "watchtower", "tavern", "house"];
    const code = `const spell = { *cast(w) { ${jobs.map((j, k) => `w.building(w.x + ${k * 4}, w.y, { job: "${j}" });`).join(" ")} } };`;
    const before = s.jobs?.length ?? 0;
    cast(world, code, s.x - 8, s.y + 9, 1);
    const ids = [C.SMITHY, C.CHAPEL, C.WATCHTOWER, C.TAVERN];
    const placed = ids.map((id) => count(world, (i) => world.cover[i] === id) >= 4);
    check(
      "w.building: a smithy, a chapel, a watchtower and a tavern stand, two by two, and join the nearest village",
      placed.every(Boolean) && (s.jobs?.length ?? 0) >= before + 4,
      JSON.stringify({ placed, jobs: s.jobs?.length, before }),
    );
  }

  // w.land: every shape changes the land; water and lava stay.
  {
    const bad: string[] = [];
    for (const shape of [...LAND_SHAPES, "floating island"]) {
      const world = generateWorld(152, 152, 77, resolveLand(MID, 77, 152));
      populate(world);
      const h0 = world.height.slice();
      const f0 = world.fluid.slice();
      const d0 = world.decor.size;
      const x = world.settlements[0].x + 20;
      const y = world.settlements[0].y;
      try {
        cast(world, `const spell = { *cast(w) { w.land(w.x, w.y, { shape: "${shape}", r: 10 }); } };`, x, y, 20);
      } catch (err) {
        bad.push(`${shape}: ${err}`);
        continue;
      }
      let changed = 0;
      for (let i = 0; i < world.n; i++) if (Math.abs(world.height[i] - h0[i]) > 0.4 || world.fluid[i] !== f0[i]) changed++;
      // A floating island is the island's own floating rock, in fine parts.
      const ok = shape === "floating island" ? world.wonders.some((o) => o.kind === "floating rock") || world.decor.size - d0 > 60 : changed >= 25;
      if (!ok) bad.push(`${shape}: ${changed} cells`);
      if (
        (shape === "lake" || shape === "pond" || shape === "oasis") &&
        count(world, (i) => world.fluid[i] === F.WATER && world.depth[i] > 0.2 && Math.hypot((i % world.w) - x, Math.floor(i / world.w) - y) < 10) < 4
      )
        bad.push(`${shape}: no water after 20 s`);
      if (shape === "volcano" && count(world, (i) => world.fluid[i] === F.LAVA && Math.hypot((i % world.w) - x, Math.floor(i / world.w) - y) < 10) < 1)
        bad.push("volcano: no lava after 20 s");
    }
    check("w.land: every shape reshapes the land; lakes, ponds and an oasis keep water, a volcano its lava", !bad.length, bad.join("; "));
  }

  // w.wonder: every built-in kind, raised where asked, kept by a save.
  {
    const bad: string[] = [];
    for (const kind of WONDER_LIST) {
      const world = generateWorld(152, 152, 91, resolveLand(MID, 91, 152));
      populate(world);
      world.wonders = [];
      const x = world.settlements[0].x + 18;
      const y = world.settlements[0].y + 4;
      try {
        cast(world, `const spell = { *cast(w) { w.wonder(w.x, w.y, "${kind}"); } };`, x, y, 10);
      } catch (err) {
        bad.push(`${kind}: ${err}`);
        continue;
      }
      // A frozen fall on warm land thaws into a waterfall, as it should.
      const w = world.wonders.find((o) => o.kind === kind || (kind === "frozen waterfall" && o.kind === "waterfall"));
      if (!w || Math.hypot(w.x - x, w.y - y) > 2) bad.push(`${kind}: not where asked`);
      const back = loadWorld(JSON.parse(JSON.stringify(saveWorld(world, new Map()))), () => {})!;
      if (!back.wonders.some((o) => o.kind === w?.kind)) bad.push(`${kind}: lost by a save`);
    }
    check(`w.wonder: each of the ${WONDER_LIST.length} built-in wonders stands where the item asks, and is kept by a save`, !bad.length, bad.join("; "));
  }

  // w.model: fine boxes, kept by a save, blown away by a blast, measured by the size check.
  {
    const world = generateWorld(152, 152, 4242, resolveLand(MID, 4242, 152));
    populate(world);
    const x = world.settlements[0].x + 10;
    const y = world.settlements[0].y;
    cast(
      world,
      `const spell = { *cast(w) { w.model(w.x, w.y, [[-0.1, -0.1, 0, 0.2, 0.2, 1.5, "#4a3324"], [0.05, -0.05, 1.2, 0.3, 0.1, 0.08, "#2b2b30"], [0.2, -0.1, 0.8, 0.2, 0.2, 0.3, "#ffd36a", "glow"], [0, 0, 0, 0.01, 0.5, 0.5, "#fff"]], { name: "Lamp" }); } };`,
      x,
      y,
      1,
    );
    const p = world.props[0];
    check(
      "w.model keeps boxes as fine as a twentieth of a cell, drops a box with no size, marks what glows",
      world.props.length === 1 && p.boxes.length === 3 && p.boxes[1].h === 0.08 && p.boxes[2].glow && !p.boxes[0].glow,
      JSON.stringify(p?.boxes),
    );
    const back = loadWorld(JSON.parse(JSON.stringify(saveWorld(world, new Map()))), () => {})!;
    check("a fine model is kept by a save", back.props.length === 1 && back.props[0].boxes.length === 3 && back.props[0].name === "Lamp");
    cast(world, `const spell = { *cast(w) { w.explode(w.x, w.y, 4, 1); } };`, x, y, 1);
    check("a blast over it takes it away", world.props.length === 0);
    // The review of #50: the 41st item placed on an island was drawn with nothing.
    const lantern = FORM_EXAMPLES.object.code;
    const rt = new Runtime(world, () => {});
    for (let k = 0; k < 65; k++) rt.cast({ key: `l${k}`, name: "Storm Lantern", tier: "minor", code: lantern }, 20 + (k % 13) * 8, 20 + Math.floor(k / 13) * 8);
    for (let k = 0; k < 30; k++) stepHeadless(world, rt);
    check(
      "the 65th item placed still has its look: the oldest model gives way on a full island",
      world.props.length === 60 && world.props.some((p) => p.key === "l64") && !world.props.some((p) => p.key === "l0"),
      `${world.props.length} props, newest ${world.props.at(-1)?.key}`,
    );
  }
  // The review of #50: one item calling w.model 64 times took every other item's look away.
  {
    const world = generateWorld(152, 152, 11, resolveLand(MID, 11, 152));
    populate(world);
    const rt = new Runtime(world, () => {});
    for (let k = 0; k < 5; k++) rt.cast({ key: "storm lantern", name: "Storm Lantern", tier: "minor", code: FORM_EXAMPLES.object.code }, 30 + k * 6, 40);
    for (let k = 0; k < 30; k++) stepHeadless(world, rt);
    const garden = `const spell = { artifacts: [{ name: "Fairy Garden", effects: [{ when: "every", every: 20, do: "heal" }] }], *cast(w) {
      for (let k = 0; k < 64; k++) w.model(w.x + (k % 8) * 0.6, w.y + Math.floor(k / 8) * 0.6, [[-0.05, -0.05, 0, 0.1, 0.1, 0.3, "#3a7a3a"], [-0.1, -0.1, 0.3, 0.2, 0.2, 0.1, "#f2a6d6"]]);
      w.artifact(w.x, w.y, "Fairy Garden"); } };`;
    rt.cast({ key: "fairy garden", name: "Fairy Garden", tier: "minor", code: garden }, 90, 90);
    for (let k = 0; k < 30; k++) stepHeadless(world, rt);
    const lanterns = world.props.filter((p) => p.key === "storm lantern").length;
    const flowers = world.props.filter((p) => p.key === "fairy garden").length;
    check(
      "one item cannot take the others' looks: five lanterns keep theirs after a garden of 64 models",
      lanterns === 5 && flowers === 4,
      `${lanterns} lanterns, ${flowers} garden models`,
    );
    const judged = runCheck({ key: "garden", name: "Fairy Garden", tier: "minor", code: garden, kind: "artifact", form: "place" });
    check(
      "an item calling w.model more than 4 times fails its look",
      judged.problem === "look" && judged.detail.includes("64 times"),
      `${judged.problem}: ${judged.detail}`,
    );
  }
  const fineBook = `const spell = { artifacts: [{ name: "Book", effects: [{ when: "every", every: 20, do: "heal" }] }], *cast(w) {
    w.model(w.x, w.y, [[-0.3, -0.25, 0, 0.6, 0.5, 0.1, "#5a4030"], [-0.08, -0.08, 0.1, 0.16, 0.16, 0.8, "#6a5040"], [-0.35, -0.28, 0.9, 0.7, 0.56, 0.08, "#6a5040"],
      [-0.2, -0.15, 0.98, 0.4, 0.3, 0.05, "#6b3a2a"], [-0.19, -0.14, 1.03, 0.38, 0.28, 0.06, "#efe6cf"], [-0.2, -0.15, 1.09, 0.4, 0.3, 0.05, "#6b3a2a"],
      [-0.03, -0.15, 1.14, 0.06, 0.3, 0.05, "#c9a24a"], [0.14, -0.03, 1.14, 0.05, 0.12, 0.05, "#c9a24a"]]); w.artifact(w.x, w.y, "Book"); } };`;
  const onLectern = runCheck({ key: "fine-book", name: "Book of Ages", tier: "minor", code: fineBook, kind: "artifact", form: "object" });
  check(
    "a book in fine boxes on a lectern passes as an object, a model alone counting as something visible",
    onLectern.ok,
    `${onLectern.problem}: ${onLectern.detail}`,
  );
  const hugeFine = `const spell = { artifacts: [{ name: "Book", effects: [{ when: "every", every: 20, do: "heal" }] }], *cast(w) {
    const parts = []; for (let k = 0; k < 7; k++) parts.push([-2, -1.5, k, 4, 3, 1, k % 2 ? "#6b3a2a" : "#e8dcc0"]);
    w.model(w.x, w.y, parts); w.artifact(w.x, w.y, "Book"); } };`;
  const tooBig = runCheck({ key: "fine-giant", name: "Book of Ages", tier: "minor", code: hugeFine, kind: "artifact", form: "object" });
  check("a fine model seven voxels tall is still too big for an object", tooBig.problem === "size", `${tooBig.problem}: ${tooBig.detail}`);

  // Each kind's example, through the real test run with its kind: it passes.
  for (const [form, ex] of Object.entries(FORM_EXAMPLES)) {
    const r = runCheck({ key: `ex:${form}`, name: ex.name, tier: ex.tier as "minor", code: ex.code, kind: "artifact", form });
    check(`the ${form} example (${ex.name}) passes its test run as a ${form}`, r.ok, `${r.problem}: ${r.detail}`);
  }

  // A settlement that also promises protection is judged by the village it makes, not by the probe's village.
  const guarded = runCheck({
    key: "ex:guarded",
    name: "Walled Town",
    tier: "major",
    code: FORM_EXAMPLES.settlement.code,
    kind: "artifact",
    form: "settlement",
    intents: ["protect"],
  });
  check("a settlement that promises protection passes by the village it makes", guarded.ok, `${guarded.problem}: ${guarded.detail}`);

  // Sizes: a giant book fails unless it says so; a statue of a serpent is no
  // creature; a charm is no village (the live Serpent and Village, 5 November).
  const book = `const spell = { artifacts: [{ name: "Book", effects: [{ when: "every", every: 20, do: "heal" }] }], *cast(w) {
    const parts = []; for (let k = 0; k < 8; k++) parts.push([-1.5, -1, k, 3, 2, 1, k % 2 ? "#6b3a2a" : "#e8dcc0"]);
    w.model(w.x, w.y, parts); w.artifact(w.x, w.y, "Book"); } };`;
  const blocky = `const spell = { artifacts: [{ name: "Book", effects: [{ when: "every", every: 20, do: "heal" }] }], *cast(w) {
    w.box(w.x, w.y, 0, 1, 1, 1, ["#6b3a2a"]); w.artifact(w.x, w.y, "Book"); } };`;
  const cube = runCheck({ key: "cube-book", name: "Book of Ages", tier: "minor", code: blocky, kind: "artifact", form: "object" });
  check("a book drawn as one whole voxel fails its look", cube.problem === "look", `${cube.problem}: ${cube.detail}`);
  const plain = runCheck({ key: "book", name: "Book of Ages", tier: "minor", code: book, kind: "artifact", form: "object" });
  const giant = runCheck({ key: "book2", name: "Giant's Book", tier: "minor", code: book, kind: "artifact", form: "object", giant: true });
  const legacy = runCheck({ key: "book3", name: "Book of Ages", tier: "minor", code: book, kind: "artifact" });
  check("a book eight voxels tall fails as an object (size)", plain.problem === "size", `${plain.problem}: ${plain.detail}`);
  check("the same book passes when the item says it is giant", giant.ok, `${giant.problem}: ${giant.detail}`);
  check("a program written before 4.6 (no kind in it) is not held to a size", legacy.ok, `${legacy.problem}: ${legacy.detail}`);
  // One block that strays far (knocked away after the cast) does not make an object big.
  const stray = `const spell = { artifacts: [{ name: "Charm", effects: [{ when: "every", every: 20, do: "heal" }] }], *cast(w) {
    w.model(w.x, w.y, [[-0.1, -0.1, 0, 0.2, 0.2, 1.4, "#5a4030"], [-0.2, -0.2, 0, 0.4, 0.4, 0.1, "#4a3020"], [-0.15, -0.15, 1.4, 0.3, 0.3, 0.05, "#2b2b30"],
      [-0.12, -0.12, 1.45, 0.24, 0.24, 0.25, "#ffd36a", "glow"], [-0.15, -0.15, 1.7, 0.3, 0.3, 0.05, "#2b2b30"], [-0.05, -0.05, 1.75, 0.1, 0.1, 0.1, "#2b2b30"]]);
    w.voxel(w.x + 11, w.y + 3, 1, "#ffd36a", "magic");
    w.artifact(w.x, w.y, "Charm"); } };`;
  const strayed = runCheck({ key: "stray", name: "Charm", tier: "minor", code: stray, kind: "artifact", form: "object" });
  check("one stray block eleven cells away does not fail a small object", strayed.ok, `${strayed.problem}: ${strayed.detail}`);
  // The review of #50: land was never held to its kind's reach.
  const digger = `const spell = { creatures: [{ name: "serpent", base: "beast", body: "serpent", goal: "hunt", prey: ["rabbit"], abilities: [{ do: "dig", when: "every so often", every: 30 }] }],
    *cast(w) { w.terraform(w.x, w.y, 40, -8); w.spawn("serpent", w.x, w.y); } };`;
  const dug = runCheck({ key: "digger", name: "Serpent", tier: "minor", code: digger, kind: "artifact", form: "creature" });
  check(
    "a creature that sinks the land 40 cells round fails (size)",
    dug.problem === "size" && dug.detail.includes("reshaped too much land"),
    `${dug.problem}: ${dug.detail}`,
  );
  const sea = `const spell = { *cast(w) { w.land(w.x, w.y, { shape: "lake", r: 60 }); } };`;
  const vast = runCheck({ key: "vast", name: "Pond", tier: "minor", code: sea, kind: "artifact", form: "land" });
  check("land 121 cells across fails against its 80 (size)", vast.problem === "size", `${vast.problem}: ${vast.detail}`);

  // A tower stacked on the building's own cells hides what the builder draws (the preview's first Lighthouse).
  const stacked = `const spell = { artifacts: [{ name: "Lighthouse", effects: [{ when: "night", do: "light" }] }], *cast(w) {
    const b = w.building(w.x, w.y, { job: "watchtower" }); if (!b) return;
    w.box(b.x - 1, b.y - 1, 0, 2, 2, 12, ["#8f8a7a"], "stone"); w.artifact(b.x, b.y, "Lighthouse"); } };`;
  const hidden = runCheck({ key: "stacked", name: "Lighthouse", tier: "minor", code: stacked, kind: "artifact", form: "building" });
  check(
    "a tower stacked on its own building's cells fails (size)",
    hidden.problem === "size" && hidden.detail.includes("beside"),
    `${hidden.problem}: ${hidden.detail}`,
  );
  const spheres = `const spell = { artifacts: [{ name: "Serpent", effects: [{ when: "every", every: 10, do: "heal" }] }], *cast(w) {
    for (let k = 0; k < 12; k++) w.sphere(w.x - 3 + k * 0.5, w.y + Math.sin(k * 0.7) * 1.2, 1, 1, ["#1c2a1a"], 0.8, "stone");
    w.artifact(w.x, w.y, "Serpent"); } };`;
  const serpent = runCheck({ key: "serpent", name: "Serpent", tier: "minor", code: spheres, kind: "artifact", form: "creature" });
  check("twelve stone spheres in a line are no creature (kind)", serpent.problem === "kind", `${serpent.problem}: ${serpent.detail}`);
  const charm = `const spell = { artifacts: [{ name: "Village", effects: [{ when: "every", every: 30, do: "food" }] }], *cast(w) {
    w.box(w.x, w.y, 0, 1, 1, 4, ["#6b4a2a"], "wood");
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; w.box(w.x + Math.cos(a) * 3, w.y + Math.sin(a) * 3, 0, 2, 2, 2, ["#8a5a2b"], "wood"); }
    w.artifact(w.x, w.y, "Village"); } };`;
  const village = runCheck({ key: "village", name: "Village", tier: "major", code: charm, kind: "artifact", form: "settlement" });
  check("a lantern charm ringed by boxes is no village (kind)", village.problem === "kind", `${village.problem}: ${village.detail}`);
}
