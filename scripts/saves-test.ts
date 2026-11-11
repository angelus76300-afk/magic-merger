// Players' saved islands (docs/REVIEW-2026-11-10.md, section 2): a golden
// save made by older code must keep loading whole, the built-in materials
// keep their ids (a save stores ids), and a save from newer code is never
// read in part.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN, LAYERS, type Layer } from "../src/sim/materials";
import { loadWorld, type SavedWorld } from "../src/sim/save";
import { newerSave } from "../src/sim/save-guard";
import { Runtime, type CastRequest } from "../src/sim/runtime";
import { reloadWonders } from "../src/sim/wonderbuild";
import { readWonder, type Wonder } from "../src/sim/wonders";
import type { World } from "../src/sim/world";

type Check = (name: string, ok: boolean, detail?: string) => void;

export interface Counts {
  covers: Record<string, number>;
  creatures: Record<string, number>;
  landmarks: string[];
  materials: Record<string, string[]>;
  villages: number;
  settlements: number;
  wonders: number;
  props: number;
  roads: number;
  voxels: number;
}

const tally = (names: string[]) => {
  const out: Record<string, number> = {};
  for (const n of names.sort()) out[n] = (out[n] ?? 0) + 1;
  return out;
};

export function countsOf(w: World): Counts {
  const covers: string[] = [];
  for (let i = 0; i < w.n; i++) if (w.cover[i]) covers.push(w.layerName("cover", w.cover[i]));
  const materials: Record<string, string[]> = {};
  for (const layer of LAYERS) materials[layer] = w.materials.list[layer].slice(BUILTIN[layer].length).map((m) => m.name);
  return {
    covers: tally(covers),
    creatures: tally(w.creatures.filter((c) => !c.dead).map((c) => c.kind)),
    landmarks: w.landmarks.map((l) => l.name).sort(),
    materials,
    villages: w.villages.length,
    settlements: w.settlements.length,
    wonders: w.wonders.length,
    props: w.props.length,
    roads: w.roads.length,
    voxels: w.decor.size,
  };
}

// As the World frame restores an island (engine.ts, Engine.restore).
export function restore(save: SavedWorld, rules: CastRequest[]): World | null {
  return loadWorld(save, (w) => {
    const rt = new Runtime(w, () => undefined);
    for (const r of rules) rt.compile(r);
    reloadWonders(
      (Array.isArray(save.wonders) ? save.wonders : []).map(readWonder).filter((x): x is Wonder => x !== null),
      rt,
    );
  });
}

// The built-in materials in their order on 11 November 2026. A save stores
// ids, so these never move: a new built-in goes at the end of its layer.
const PINNED: Record<Layer, string[]> = {
  ground: ["grass", "dirt", "sand", "rock", "snow", "ash", "basalt", "crystal", "field", "path", "dirt road"],
  fluid: ["none", "water", "ice", "lava", "oil", "acid", "mud"],
  cover: [
    "none",
    "tree",
    "bush",
    "crop",
    "house",
    "rubble",
    "powder",
    "stump",
    "flower",
    "boulder",
    "reeds",
    "fern",
    "berries",
    "log",
    "fungi",
    "cactus",
    "scree",
    "pebbles",
    "standing stone",
    "crystals",
    "petrified tree",
    "well",
    "windmill",
    "shrine",
    "dock",
    "fence",
    "strange ore",
    "dragon hoard",
    "wonder",
    "smithy",
    "granary",
    "bakery",
    "barn",
    "tavern",
    "market",
    "chapel",
    "watchtower",
    "lumber yard",
    "fisher hut",
    "bridge",
  ],
  gas: ["none", "smoke", "steam", "poison"],
};

export function saveChecks(check: Check): void {
  // 1. Built-in ids do not move.
  const moved: string[] = [];
  for (const layer of LAYERS) {
    const now = BUILTIN[layer].map((m) => m.name);
    PINNED[layer].forEach((name, id) => {
      if (now[id] !== name) moved.push(`${layer} ${id} was ${name}, is ${now[id] ?? "gone"}`);
    });
  }
  check(
    "built-in materials keep their ids, so saved islands keep their land",
    moved.length === 0,
    moved.length ? `${moved.slice(0, 4).join("; ")}. A save stores ids: put new built-ins at the end of their layer, never in between.` : "",
  );

  // 2. Every golden save still loads whole.
  for (const file of readdirSync("lab/saves")
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const golden = JSON.parse(readFileSync(join("lab/saves", file), "utf8")) as { commit: string; rules: CastRequest[]; counts: Counts; save: SavedWorld };
    let world: World | null = null;
    let error = "";
    try {
      world = restore(golden.save, golden.rules);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const now = world ? countsOf(world) : null;
    const lost: string[] = [];
    if (now)
      for (const key of Object.keys(golden.counts) as (keyof Counts)[]) if (JSON.stringify(now[key]) !== JSON.stringify(golden.counts[key])) lost.push(key);
    check(
      `the island saved by ${golden.commit} (${file}) loads whole`,
      !!now && lost.length === 0,
      !now
        ? `did not load${error ? `: ${error}` : ""}`
        : lost.length
          ? `changed: ${lost.join(", ")}. Players have islands like it: read the old form, never drop it.`
          : `${Object.values(golden.counts.covers).reduce((a, b) => a + b, 0)} cover cells, ${Object.values(golden.counts.creatures).reduce((a, b) => a + b, 0)} creatures, ${golden.counts.landmarks.length} landmarks`,
    );
  }

  // 3. A save from newer code is not read in part. The golden island, as code
  // with one more built-in cover would write it (a Deploy rollback, a stale tab).
  const golden = JSON.parse(readFileSync("lab/saves/island-2026-11-11.json", "utf8")) as { rules: CastRequest[]; counts: Counts; save: SavedWorld };
  const covers = (c: Counts) => Object.values(c.covers).reduce((a, b) => a + b, 0);
  const newer = { ...golden.save, builtins: { ...golden.save.builtins!, cover: BUILTIN.cover.length + 1 } };
  const loaded = restore(newer, golden.rules);
  const kept = loaded ? covers(countsOf(loaded)) : null;
  check(
    "a save with more built-ins than the code knows is not loaded with covers missing",
    newerSave(newer) !== null && (loaded === null || kept === covers(golden.counts)),
    loaded ? `loaded with ${kept} of ${covers(golden.counts)} cover cells: ${covers(golden.counts) - (kept ?? 0)} lost` : `set aside: ${newerSave(newer)}`,
  );
  const future = { ...golden.save, version: 3 } as unknown as SavedWorld;
  check(
    "a save of a later version is told apart from a broken one",
    newerSave(future) !== null && restore(future, golden.rules) === null,
    newerSave(future) ?? "not seen as newer",
  );
  check(
    "today's saves and older ones are not taken for newer ones",
    newerSave(golden.save) === null && newerSave({ ...golden.save, builtins: undefined }) === null && newerSave(null) === null,
  );
}
