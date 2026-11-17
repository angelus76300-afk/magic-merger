// The looks revamp for every item (the owner, 17 November: "looks: all items"): a program that
// draws no w.model may gain one from the look-only writer, inserted and nothing else changed
// (shared/looks/splice.ts PROGRAM_ADD, addSite, insertedText), with the pilot picked from the
// library (shared/looks/pilot.ts). Called from scripts/looks-refs-test.ts.
import { syntaxError } from "../shared/spellcode";
import { pickPilot, modelParts } from "../shared/looks/pilot";
import { PROGRAM_ADD, WONDER_ADD, addSite, changedLines, insertedText, mayGainModel, ownLookCall, spliceLooks } from "../shared/looks/splice";
import { resetArtifactIds } from "../src/sim/artifacts";
import { populate, resetCreatureIds } from "../src/sim/creatures";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { TICK, generateWorld, type World } from "../src/sim/world";

type Check = (name: string, ok: boolean, detail?: string) => void;

const LOOK = '[[-0.25, -0.25, 0, 0.5, 0.5, 0.75, "#8a6f4e", "cyl", "grain"], [-0.125, -0.125, 0.75, 0.25, 0.25, 0.375, "#ffd36a", "glow"]]';

// A lantern artifact that draws no model: it places itself, then acts with random numbers, so a
// model that read one more random number, or moved a line, would change what follows.
const LANTERN = [
  "const spell = {",
  "  artifacts: [{ name: 'Dusk Lantern', radius: 5, effects: [{ when: 'night', do: 'light' }] }],",
  "  *cast(w) {",
  "    w.burst(w.x, w.y, { color: '#ffcc66', count: 20 });",
  "    const a = w.artifact(w.x + 2, w.y - 1, 'Dusk Lantern');",
  "    for (let i = 0; i < 6; i++) w.particle({ x: w.x + w.rand(-2, 2), y: w.y + w.rand(-2, 2), color: '#ffd36a' });",
  "    yield 1;",
  "    w.grow(w.x, w.y, 4, 0.8);",
  "  },",
  "};",
].join("\n");

const SEED = 23;

// What the island holds after the program ran for a while, the item's look apart.
function runIsland(code: string): { digest: string; props: World["props"] } {
  Math.random = seeded(SEED);
  resetCreatureIds();
  resetArtifactIds();
  const world = generateWorld(64, 64, SEED);
  populate(world);
  const rt = new Runtime(world, () => {});
  rt.cast({ key: "gain:lantern", name: "Dusk Lantern", tier: "minor", code, kind: "artifact", form: "object" }, 32, 32);
  const life = seeded(SEED + 2);
  for (let s = 0; s < 4 / TICK; s++) stepHeadless(world, rt, { life });
  let h = 0;
  const mix = (a: ArrayLike<number>) => {
    for (let i = 0; i < a.length; i++) h = (Math.imul((h ^ (a[i] * 1000)) | 0, 16777619) + i) | 0;
  };
  mix(world.height);
  mix(world.ground);
  mix(world.cover);
  const digest = JSON.stringify({
    h,
    decor: [...world.decor.keys()].sort(),
    landmarks: world.landmarks,
    creatures: world.creatures.map((c) => [c.kind, Math.round(c.x * 100), Math.round(c.y * 100), c.hp]),
    next: Math.random(),
  });
  return { digest, props: world.props };
}

export function looksGainChecks(check: Check): void {
  // --- A program with no model gains one, where its artifact stands -----------------------------
  const grown = spliceLooks(LANTERN, [{ call: 0, parts: LOOK }], PROGRAM_ADD);
  const inserted = insertedText(LANTERN, grown?.code ?? "");
  check(
    "an artifact with no model gains one, one line inserted and every other character kept",
    grown?.added === 1 && inserted !== null && inserted.split("\n").filter(Boolean).length === 1 && changedLines(LANTERN, grown.code).removed.length === 0,
    JSON.stringify({ added: grown?.added, inserted }),
  );
  check(
    "the new model stands where the artifact is placed, right after it, named as the item",
    !!inserted &&
      inserted.includes(`w.model(w.x + 2, w.y - 1, ${LOOK});`) &&
      !inserted.includes("name:") &&
      grown!.code.indexOf(inserted.trim()) > grown!.code.indexOf("w.artifact("),
    inserted ?? "",
  );
  check("the grown program still parses", syntaxError(grown?.code ?? "") === null);

  // On the island: everything the program does is the same, plus exactly one look at the lantern.
  const before = runIsland(LANTERN);
  const after = runIsland(grown?.code ?? LANTERN);
  check("the grown program does the same on the island, random numbers included", before.digest === after.digest);
  const mine = after.props.filter((p) => p.key === "gain:lantern");
  check(
    "it draws one model, at the lantern, and none before",
    before.props.filter((p) => p.key === "gain:lantern").length === 0 &&
      mine.length === 1 &&
      mine[0].x === 34 &&
      mine[0].y === 31 &&
      mine[0].name === "Dusk Lantern",
    JSON.stringify(mine.map((p) => [p.x, p.y, p.name])),
  );

  // --- Where it goes when the place is not plain --------------------------------------------------
  // Placed in a loop, or at a place written with a call: at the cast's point, so nothing is read twice.
  const looped = LANTERN.replace(
    "    const a = w.artifact(w.x + 2, w.y - 1, 'Dusk Lantern');",
    "    for (const d of [1, 2]) w.artifact(w.x + d, w.y, 'Dusk Lantern');",
  );
  const random = LANTERN.replace("w.artifact(w.x + 2, w.y - 1,", "w.artifact(w.x + w.rand(-3, 3), w.y,");
  const atCenter = (code: string) => {
    const r = spliceLooks(code, [{ call: 0, parts: LOOK }], PROGRAM_ADD);
    const t = insertedText(code, r?.code ?? "") ?? "";
    return r?.added === 1 && t.includes("w.model(w.x, w.y, ") && r.code.indexOf(t.trim()) < r.code.indexOf("w.burst(") && !syntaxError(r.code);
  };
  check("an artifact placed in a loop: the model stands at the cast's point, at the start of cast", atCenter(looped));
  check("an artifact placed at a random point: the model does not read the random number again", atCenter(random));
  const site = addSite(random, "w", "artifact", random.indexOf("{", random.indexOf("*cast")) + 1);
  check("addSite: a place with a call falls back to the cast's point", !site.artifact && site.x === "w.x");
  // A program written on one line, with code after the cast: the model goes inside the cast.
  const oneLine = "const spell = { *cast(w) { w.artifact(w.x, w.y, 'Orb'); w.burst(w.x, w.y, { count: 5 }); } };\n;const lib = { n: 1 };";
  const one = spliceLooks(oneLine, [{ call: 0, parts: LOOK }], PROGRAM_ADD);
  check(
    "a one-line program gains its model inside the cast, on the same line",
    one?.added === 1 &&
      one.code.split("\n")[0].includes("'Orb'); w.model(w.x, w.y, ") &&
      one.code.split("\n")[1] === ";const lib = { n: 1 };" &&
      !syntaxError(one.code),
    one?.code,
  );
  // A "*cast(w) {" in a string or a comment is not the cast.
  const decoy = "// *cast(w) { is where it starts\n" + LANTERN;
  const d = spliceLooks(decoy, [{ call: 0, parts: LOOK }], PROGRAM_ADD);
  check("a cast(w) in a comment is not where the model goes", !!d && d.code.startsWith("// *cast(w) { is where it starts\nconst spell"), d?.code.slice(0, 80));

  // --- Only one, and only data ------------------------------------------------------------------
  const two = spliceLooks(
    LANTERN,
    [
      { call: 0, parts: LOOK },
      { call: 0, parts: LOOK },
    ],
    PROGRAM_ADD,
  );
  check("a program gains one model at most", two?.added === 1 && two.refused.some((r) => /at most 1 model is added/.test(r.why)), JSON.stringify(two?.refused));
  const bad = ["[[0,0,0,1,1,1, Math.random() > 0.5 ? '#fff' : '#000']]", "w.x", "[[0,0,0,0,0,0]]", "[[0,0,0,1,1,1]]; w.kill()", "[]"];
  check(
    "a new model that is not plain drawable data is refused, the program kept",
    bad.every((p) => {
      const r = spliceLooks(LANTERN, [{ call: 0, parts: p }], PROGRAM_ADD);
      return r?.added === 0 && r.code === LANTERN && r.refused.length === 1;
    }),
  );
  check("a program that draws a model already gains none", spliceLooks(grown?.code ?? "", [{ call: 0, parts: LOOK }], PROGRAM_ADD)?.added === 0);
  check("not allowed (mayAdd false), a program gains none", spliceLooks(LANTERN, [{ call: 0, parts: LOOK }], false)?.added === 0);

  // --- A wonder still gains one or two, at its center, named -------------------------------------
  const wonder = ["const spell = {", "  *cast(w) {", "    w.terraform(w.x, w.y, 4, 2);", "  },", "};"].join("\n");
  const w2 = spliceLooks(
    wonder,
    [
      { call: 0, parts: LOOK },
      { call: 0, parts: LOOK },
    ],
    WONDER_ADD,
  );
  const w2Diff = changedLines(wonder, w2?.code ?? "");
  check(
    "a wonder still gains two models at its center, named, every old line kept",
    w2?.added === 2 &&
      w2Diff.removed.length === 0 &&
      w2Diff.added.length === 2 &&
      w2Diff.added.every((l, k) => l === `    w.model(w.x, w.y, ${LOOK}, { name: "look ${k + 1}" });`),
    JSON.stringify(w2Diff),
  );
  check(
    "spliceLooks(…, true) is still a wonder's",
    spliceLooks(wonder, [{ call: 0, parts: LOOK }], true)?.code === spliceLooks(wonder, [{ call: 0, parts: LOOK }], WONDER_ADD)?.code,
  );

  // --- No look drawn twice ----------------------------------------------------------------------
  // A creature is drawn by its body; a building, a village or a built-in wonder by the island.
  check("a creature gains no model: its body is its look", mayGainModel("creature") !== null && mayGainModel("creature", true) !== null);
  check("a spell gains one only when asked", mayGainModel("spell") !== null && mayGainModel("spell", true) === null && mayGainModel("object") === null);
  const building = "const spell = { *cast(w) { w.building(w.x, w.y, { job: 'smith' }); } };";
  const village = "const spell = { *cast(w) { w.village(w.x, w.y, { houses: 4 }); } };";
  const builtIn = "const spell = { *cast(w) { w.wonder(w.x, w.y, 'arch'); } };";
  check(
    "an item the island draws already (a building, a village, a built-in wonder) gains none",
    !!ownLookCall(building) &&
      !!ownLookCall(village) &&
      !!ownLookCall(builtIn) &&
      ownLookCall(LANTERN) === null &&
      ownLookCall("// w.building(1, 2)\n" + LANTERN) === null,
  );

  // --- The pilot, picked from the library --------------------------------------------------------
  const pool = [
    { key: "plain", name: "Plain", form: "object", tier: "minor", casts: 1, code: `const spell = { *cast(w) { w.model(w.x, w.y, [[0,0,0,1,1,1]]); } };` },
    {
      key: "rich",
      name: "Rich",
      form: "object",
      tier: "minor",
      casts: 9,
      code: `const spell = { *cast(w) { w.model(w.x, w.y, ${LOOK.replace("]]", "], [0,0,0,1,1,1], [0,0,1,1,1,1]]")}); } };`,
    },
    { key: "looped", name: "Looped", form: "object", tier: "minor", casts: 2, code: "const spell = { *cast(w) { w.model(w.x, w.y, parts); } };" },
    { key: "lantern", name: "Lantern", form: "object", tier: "minor", casts: 5, code: LANTERN },
    { key: "pool", name: "Pool", form: "place", tier: "minor", casts: 50, code: wonder },
    { key: "wolf", name: "Wolf", form: "creature", tier: "minor", casts: 99, code: wonder },
    { key: "fire", name: "Fire", form: "spell", tier: "minor", casts: 80, code: wonder },
    { key: "forge", name: "Forge", form: "building", tier: "minor", casts: 70, code: building },
  ];
  const p = pickPilot(pool, { redraw: 2, gain: 3 });
  check(
    "the pilot: the plainest with a model, then the most cast that may gain one (no creature, spell or building)",
    JSON.stringify(p.redraw.map((r) => r.key)) === '["plain","rich"]' && JSON.stringify(p.gain.map((r) => r.key)) === '["pool","lantern"]',
    JSON.stringify(p),
  );
  check(
    "the pilot takes spells only when asked",
    pickPilot(pool, { gain: 3, spells: true })
      .gain.map((r) => r.key)
      .join() === "fire,pool,lantern",
  );
  check(
    "a model's parts are counted as written, a list made by code as 24",
    modelParts(pool[0].code) === 1 && modelParts(pool[2].code) === 24 && modelParts(LANTERN) === null,
  );
}
