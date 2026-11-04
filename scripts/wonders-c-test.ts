// 4.4.5 part C checks, run by `npm test` (sim-test.ts): wonders written as
// programs join the pool new islands draw from, are built with the island,
// survive a save, keep their creatures to three, and face the Node test the
// nightly Action gives every new one (src/sim/wondercheck.ts); the stored
// examples pass it and the first draft that placed nothing fails it; the
// artifact trigger "full moon" fires on full moon nights only; the Worker's
// copy of the built-in catalog matches the simulation's.
import { readFileSync } from "node:fs";
import { BUILT_IN_WONDERS } from "../shared/wonders";
import { DAY_LENGTH, MOON_DAYS, fullMoon } from "../src/sim/daylight";
import { populate } from "../src/sim/creatures";
import { isArtifact } from "../src/sim/artifacts";
import { resolveLand } from "../src/sim/land";
import { Runtime } from "../src/sim/runtime";
import { loadWorld, saveWorld } from "../src/sim/save";
import { stepHeadless } from "../src/sim/tick";
import { generateWorld } from "../src/sim/world";
import { raiseWonders, reloadWonders } from "../src/sim/wonderbuild";
import { checkWonderDef } from "../src/sim/wondercheck";
import { WONDERS, WONDER_CREATURES, readDef, readWonder, type Wonder, type WonderDef } from "../src/sim/wonders";

type Check = (name: string, ok: boolean, detail?: string) => void;

const fixture = (name: string): WonderDef => readDef(JSON.parse(readFileSync(`lab/wonders/${name}.json`, "utf8")))!;

export function programWonderChecks(check: Check): void {
  const catalog = WONDERS.map((k) => `${k.kind}|${k.rarity}|${k.does}`).join("\n");
  check(
    "part C: the Worker's catalog of built-in wonders matches the simulation's",
    catalog === BUILT_IN_WONDERS.map((k) => `${k.kind}|${k.rarity}|${k.does}`).join("\n"),
  );

  const aurora = fixture("aurora-ice-spires");
  const mire = fixture("moon-mire");
  check(
    "part C: a definition is refused when it takes a built-in kind or has no rarity",
    readDef({ ...aurora, kind: "geysers" }) === null && readDef({ ...aurora, rarity: "mythic" }) === null && readDef(aurora)?.kind === "aurora ice spires",
  );

  // The pool on forty medium islands with tundra and swamp in them: drawn
  // beside the built-in kinds, built with the island, in its land.
  const MID = { warmth: 0.5, water: 0.5, relief: 0.5, forest: 0.5 };
  let drawn = 0;
  let built = 0;
  let wrongLand = 0;
  let found: { world: ReturnType<typeof generateWorld>; w: Wonder; rt: Runtime } | null = null;
  for (let k = 0; k < 40; k++) {
    const seed = 900 + k * 7;
    const choice = { ...MID, warmth: k % 2 ? 0.15 : 0.6, water: k % 2 ? 0.5 : 0.85 };
    const world = generateWorld(152, 152, seed, resolveLand(choice, seed, 152), [], [aurora, mire]);
    const ws = world.wonders.filter((w) => w.def);
    if (!ws.length) continue;
    drawn++;
    populate(world);
    const rt = new Runtime(world, () => {});
    raiseWonders(world, rt);
    for (const w of ws) {
      if (w.state === 1 && world.decor.size > 0) built++;
      if (!w.def!.lands.includes(world.land!.biome)) wrongLand++;
    }
    found ??= { world, w: ws[0], rt };
  }
  check(
    "part C: program wonders from the pool appear on new islands of their lands and are built",
    drawn >= 3 && built >= drawn && wrongLand === 0,
    `${drawn} islands of 40, ${built} built, ${wrongLand} in another land`,
  );
  const plain = generateWorld(152, 152, 905, resolveLand(MID, 905, 152));
  const same = generateWorld(152, 152, 905, resolveLand(MID, 905, 152), [], []);
  check(
    "part C: with no pool an island is made as before",
    plain.wonders.map((w) => w.kind).join() === same.wonders.map((w) => w.kind).join() && !plain.wonders.some((w) => w.def),
  );

  if (found) {
    // A save keeps the definition and its code; the reload compiles it again,
    // so its artifact still acts.
    const { world, w } = found;
    const data = JSON.parse(JSON.stringify(saveWorld(world, found.rt.owners)));
    let rt2: Runtime | null = null;
    const back = loadWorld(data, (lw) => {
      rt2 = new Runtime(lw, () => {});
      reloadWonders(
        (data.wonders ?? []).map(readWonder).filter((x: Wonder | null): x is Wonder => x !== null),
        rt2,
      );
    });
    const again = back?.wonders.find((x) => x.def?.id === w.def!.id);
    const arts = back?.landmarks.filter(isArtifact).length ?? 0;
    let acted = 0;
    if (back && rt2) {
      back.time = (MOON_DAYS - 1) * DAY_LENGTH + DAY_LENGTH * 0.7;
      for (let t = 0; t < 30 * 90; t++) stepHeadless(back, rt2);
      acted = back.landmarks.filter(isArtifact).reduce((s, a) => s + a.art.deeds, 0);
    }
    check(
      "part C: a saved island keeps its program wonder, code and all, and it still acts after a reload",
      !!again && again.def!.code === w.def!.code && arts > 0 && acted > 0,
      `${arts} artifacts, ${acted} deeds`,
    );
  }

  // A wonder's own creatures are kept to three alive.
  {
    const def: WonderDef = {
      ...aurora,
      id: 991,
      kind: "moth hollow",
      code: `const spell = { creatures: [{ name: "hollow moth", base: "spirit", behavior: "wander", flying: true }], artifacts: [{ name: "Moth Hollow", radius: 6, effects: [{ when: "every", do: "summon:hollow moth", every: 5 }] }], *cast(w) { w.spire(w.x, w.y, { height: 6, radius: 1 }); for (let k = 0; k < 6; k++) w.spawn("hollow moth", w.x + k, w.y); w.artifact(w.x, w.y, "Moth Hollow"); } };`,
    };
    const world = generateWorld(152, 152, 17, { biome: "tundra", shape: "coast", ...MID, mixed: false });
    populate(world);
    world.wonders.push({ kind: def.kind, x: 76, y: 76, r: 6, seed: 1, name: def.kind, t: 0, state: 0, ax: 0, ay: 0, def });
    const rt = new Runtime(world, () => {});
    raiseWonders(world, rt);
    let most = 0;
    for (let t = 0; t < 30 * 60; t++) {
      stepHeadless(world, rt);
      if (t % 15 === 6) most = Math.max(most, world.creatures.filter((c) => !c.dead && c.kind === "hollow moth").length);
    }
    check(`part C: a program wonder's own creatures are kept to ${WONDER_CREATURES} alive`, most <= WONDER_CREATURES + 1 && most > 0, `${most} at most`);
  }

  // "full moon": the artifact trigger fires on full moon nights only.
  {
    const world = generateWorld(112, 112, 11);
    const rt = new Runtime(world, () => {});
    rt.cast(
      {
        key: "moon",
        name: "Moon",
        tier: "minor",
        code: `const spell = { artifacts: [{ name: "Moon Bell", radius: 4, effects: [{ when: "full moon", do: "light", every: 60 }] }], *cast(w) { w.artifact(w.x, w.y, "Moon Bell"); } };`,
        kind: "artifact",
      },
      56,
      56,
    );
    let byMoon = 0;
    let otherwise = 0;
    let last = 0;
    for (let t = 0; t < 30 * DAY_LENGTH * MOON_DAYS; t++) {
      stepHeadless(world, rt);
      const deeds = world.landmarks.filter(isArtifact).reduce((s, a) => s + a.art.deeds, 0);
      if (deeds > last) {
        if (fullMoon(world.time)) byMoon++;
        else otherwise++;
      }
      last = deeds;
    }
    check(
      'part C: an artifact effect "when full moon" fires on the full moon night only',
      byMoon >= 1 && otherwise === 0,
      `${byMoon} on the full moon, ${otherwise} on other nights`,
    );
  }

  // The nightly test, on one island each (three in the nightly run).
  for (const [name, pass] of [
    ["aurora-ice-spires", true],
    ["moon-mire", true],
    ["broken-rain-spires", false],
  ] as const) {
    const v = checkWonderDef(fixture(name), { islands: 1 });
    check(`part C: the wonder test ${pass ? "passes" : "fails"} ${name}`, v.ok === pass && (pass || v.problem === "idle"), v.detail.slice(0, 300));
  }
}
