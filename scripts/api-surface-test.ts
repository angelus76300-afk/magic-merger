// The World API's surface, pinned (docs/REVIEW-2026-11-10.md, section 2):
// stored spells call these members, pass these options and use these words,
// and are never rewritten in bulk. Removing or renaming one fails here.
// Adding one only asks for the snapshot to be written again:
//   UPDATE_API_SURFACE=1 npm test
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { compareSurface, readSurface, type Surface } from "./api-surface";
import { BUILTIN, LAYERS } from "../src/sim/materials";
import { BUILTIN_KINDS } from "../src/sim/creatures";
import { EXTRA, FEATURES, ITEMS, MODEL_PARTS, PLANS } from "../src/sim/body";
import { ABILITIES, GOALS, LOADS, MARKS, TRIGGERS } from "../src/sim/kin";
import { ART_EFFECTS, ART_GRANTS, ART_USES, ART_WHENS } from "../src/sim/artifacts";
import { BODY_LOOKS } from "../src/sim/visuals";
import { VOXEL_KINDS } from "../src/sim/voxels";
import { BUILDING_JOBS, LAND_SHAPES, WONDER_LIST } from "../src/sim/makers";
import { CALLINGS, JOBS } from "../src/sim/villagers";
import { WARD } from "../src/sim/wards";
import { VOICE_NAMES } from "../src/sim/sound";
import { BIOMES, SHAPES } from "../src/sim/land-options";
import { TIERS } from "../shared/tiers";

export const API_SNAPSHOT = "scripts/api-surface.json";

// The words the engine exports. Each is a name a stored program may write.
export function engineWords(): Record<string, readonly string[]> {
  const words: Record<string, readonly string[]> = {
    sounds: VOICE_NAMES,
    "creature kinds": [...BUILTIN_KINDS],
    "body plans": PLANS,
    features: FEATURES,
    "held items": ITEMS,
    "extra features": EXTRA,
    "model parts": MODEL_PARTS,
    goals: GOALS,
    abilities: ABILITIES,
    "ability triggers": TRIGGERS,
    loads: LOADS,
    marks: MARKS,
    "artifact effects": ART_EFFECTS,
    "artifact whens": ART_WHENS,
    "artifact grants": ART_GRANTS,
    "artifact uses": ART_USES,
    "body looks": BODY_LOOKS,
    "voxel kinds": VOXEL_KINDS,
    "land shapes": LAND_SHAPES,
    wonders: WONDER_LIST,
    buildings: Object.keys(BUILDING_JOBS),
    jobs: JOBS,
    callings: CALLINGS,
    "ward kinds": Object.keys(WARD),
    biomes: BIOMES,
    "island shapes": SHAPES,
    tiers: TIERS,
  };
  for (const layer of LAYERS) words[`${layer} names`] = BUILTIN[layer].map((m) => m.name);
  return words;
}

export function apiSurfaceChecks(check: (name: string, ok: boolean, detail?: string) => void): void {
  const started = Date.now();
  const now = readSurface(engineWords());
  if (process.env.UPDATE_API_SURFACE) {
    writeFileSync(API_SNAPSHOT, JSON.stringify(now, null, 2) + "\n");
    execFileSync("npx", ["prettier", "--write", API_SNAPSHOT], { stdio: "ignore" });
    console.log(`wrote ${API_SNAPSHOT}`);
  }
  const snapshot = JSON.parse(readFileSync(API_SNAPSHOT, "utf8")) as Surface;
  const { removed, added } = compareSurface(snapshot, now);
  check(
    "the World API keeps every member, option and word stored spells may use",
    removed.length === 0,
    removed.length
      ? `gone: ${removed.slice(0, 8).join("; ")}${removed.length > 8 ? ` and ${removed.length - 8} more` : ""}. ` +
          "Stored spells may still use these and are never rewritten in bulk. Add, never remove: put the name back, or keep it as an alias of the new one."
      : "",
  );
  check(
    "the API snapshot lists everything the World API offers",
    added.length === 0,
    added.length
      ? `new: ${added.slice(0, 8).join("; ")}${added.length > 8 ? ` and ${added.length - 8} more` : ""}. ` +
          `Adding is fine: write the snapshot again with UPDATE_API_SURFACE=1 npm test and commit ${API_SNAPSHOT}.`
      : "",
  );
  const count = (o: Record<string, string[]>) => Object.values(o).reduce((n, l) => n + l.length, 0);
  check(
    "the API snapshot reads the whole surface",
    now.members.SpellApi.length > 60 && Object.keys(now.options).length >= 15 && count(now.fields) > 60 && Object.keys(now.vocab).length >= 25,
    `${now.members.SpellApi.length} members on w, ${count(now.members) - now.members.SpellApi.length} on handles, ` +
      `${Object.keys(now.options).length} option bags, ${count(now.fields)} declared fields, ${Object.keys(now.vocab).length} word lists, ${Date.now() - started} ms`,
  );
}
