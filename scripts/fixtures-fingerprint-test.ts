// 4.12, before the rewrite of the items found wrong (docs/HANDOVER.md): "a test that 43 lab
// fixtures give identical fingerprints". #147 added the island's reading helpers (w.here,
// w.wouldHurt, w.nearest, w.fights, w.nature) and said stored programs do the same as before;
// its reviewer found that claim in no test. Here every stored-program fixture of lab/ (programs,
// creatures, artifacts, legacy, monsters: 43 files) is cast twice on the same seeded island for
// ten seconds, once alone and once with every reading helper asked before the cast and at every
// tick, and the two islands must match cell for cell, creature for creature and voxel for voxel.
// A control run that writes one fire cell instead of reading must differ, so the check can fail.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { generateWorld, type World } from "../src/sim/world";
import { populate, resetCreatureIds } from "../src/sim/creatures";
import { Runtime, SpellApi } from "../src/sim/runtime";
import { resetArtifactIds } from "../src/sim/artifacts";
import { seed, step } from "./challenge-replay";

type Check = (name: string, ok: boolean, detail?: string) => void;

export const FIXTURE_DIRS = ["lab/programs", "lab/creatures", "lab/artifacts", "lab/legacy", "lab/monsters"];

// Everything a program could change: cells, creatures, voxels (the same as scripts/reading-test.ts).
function fingerprint(world: World): string {
  let h = 2166136261;
  const mix = (v: number) => {
    h ^= Math.round(v * 1000) | 0;
    h = Math.imul(h, 16777619);
  };
  for (let i = 0; i < world.n; i++) {
    mix(world.ground[i]);
    mix(world.cover[i]);
    mix(world.fluid[i]);
    mix(world.depth[i]);
    mix(world.height[i]);
    mix(world.fire[i]);
    mix(world.temp[i]);
  }
  for (const c of world.creatures) {
    mix(c.x);
    mix(c.y);
    mix(c.hp);
  }
  mix(world.creatures.length);
  mix(world.decor.size);
  return (h >>> 0).toString(16);
}

type Between = "none" | "read" | "write";

function castFor(code: string, file: string, between: Between, seconds = 10): { print: string; errors: number } {
  seed(31);
  resetCreatureIds(1);
  resetArtifactIds();
  const world = generateWorld(112, 112, 9);
  populate(world);
  let errors = 0;
  const rt = new Runtime(world, () => errors++);
  const tier = (/\((cantrip|minor|major|grand|legendary|cosmic)\)/.exec(code)?.[1] ?? "major") as "major";
  const x = 56;
  const y = 56;
  const reader = new SpellApi(rt, { key: "reader", name: "Reader", tier: "major", code: "" }, 1, x, y);
  const ask = () => {
    if (between === "read") {
      const near = reader.here();
      reader.here(x + 9, y - 7, 6);
      reader.wouldHurt();
      for (const what of ["village", "house", "water", "fire", "tree", "field", "rock", "villager", "hostile"] as const) reader.nearest(what);
      reader.fights();
      for (const c of near.villagers.slice(0, 5)) reader.nature(c);
    } else if (between === "write") reader.fire(x + 2, y + 2, 1);
  };
  ask();
  rt.cast({ key: file, name: file, tier, code }, x, y);
  for (let k = 0; k < 30 * seconds; k++) {
    ask();
    step(world, rt);
  }
  return { print: fingerprint(world), errors };
}

export function fixtureFingerprintChecks(check: Check): void {
  const random = Math.random;
  const ids = resetCreatureIds(1);
  try {
    const files = FIXTURE_DIRS.flatMap((d) =>
      readdirSync(d)
        .filter((f) => f.endsWith(".js"))
        .map((f) => join(d, f)),
    );
    const differ: string[] = [];
    const notRepeatable: string[] = [];
    let controlDiffers = 0;
    for (const file of files) {
      const code = readFileSync(file, "utf8");
      const alone = castFor(code, file, "none");
      const again = castFor(code, file, "none");
      const read = castFor(code, file, "read");
      if (alone.print !== again.print) notRepeatable.push(file);
      if (alone.print !== read.print || alone.errors !== read.errors) differ.push(`${file}: ${alone.print} against ${read.print}`);
      if (castFor(code, file, "write", 2).print !== castFor(code, file, "none", 2).print) controlDiffers++;
    }
    check(`fixtures: the 43 stored-program fixtures of lab/ are all counted (${files.length})`, files.length === 43, files.length.toString());
    check("fixtures: each cast twice on the same seed gives the same island", notRepeatable.length === 0, notRepeatable.join(", "));
    check(
      `fixtures: reading the island before and during the cast changes nothing, ${files.length - differ.length} of ${files.length} identical fingerprints`,
      differ.length === 0,
      differ.slice(0, 3).join("; "),
    );
    check(
      "fixtures: the control (one cell set on fire instead of read) changes every island",
      controlDiffers === files.length,
      `${controlDiffers} of ${files.length}`,
    );
  } finally {
    Math.random = random;
    resetCreatureIds(ids);
  }
}
