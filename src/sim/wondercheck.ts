import { DAY_LENGTH, MOON_DAYS } from "./daylight";
import { populate, resetCreatureIds } from "./creatures";
import { isArtifact, resetArtifactIds } from "./artifacts";
import { C, G } from "./materials";
import { seeded } from "./noise";
import { Runtime } from "./runtime";
import { stepHeadless } from "./tick";
import { TICK, generateWorld, type World } from "./world";
import { raiseWonders } from "./wonderbuild";
import { defRequest, placeOne, type WonderDef } from "./wonders";
import type { Biome } from "./land-options";

// The test of a wonder written as a program (4.4.5 part C), before any
// island gets it. In Node, by the nightly Action (scripts/wonder-runner.ts)
// and by `npm test` on the stored examples: never by a player's browser
// (review M11). On three islands of its lands, at the spot it asked for,
// built the way a new island builds it (raiseWonders), then a whole day and
// night beside the same island without it: a day that starts in the morning
// of a full moon, so night, dusk, dawn and the full moon all come, and a
// drought made round it halfway through when its program speaks of one.
//
// It fails on a crash, nothing built, more than MAX_VOXELS voxels, more than
// MAX_EXTRA_MS a tick on average, nothing done in the day (no effect of its
// artifact, no deed of its creatures, no cell of its materials changed after
// it was built), more than WONDER_CREATURES of its own alive, or fewer than
// half the villagers or animals the island has without it.

export const MAX_VOXELS = 1500;
export const MAX_EXTRA_MS = 2;

export interface IslandResult {
  seed: number;
  land: Biome;
  at: { x: number; y: number } | null;
  // 4.7: parts, the fine boxes of its models (w.model), are built too: a
  // wonder drawn as the island's own are need not stand a voxel.
  built: { cells: number; voxels: number; parts: number };
  voxels: number;
  extraMs: number;
  acted: number;
  did: string[];
  villagers: [number, number];
  animals: [number, number];
  own: number;
  errors: string[];
}

export interface WonderVerdict {
  ok: boolean;
  problem: "spot" | "crash" | "nothing" | "voxels" | "slow" | "idle" | "harm" | "creatures" | null;
  detail: string;
  islands: IslandResult[];
}

export interface CheckOptions {
  size?: number;
  // Islands tried, in order, until `islands` of them had a spot.
  seeds?: number[];
  islands?: number;
  seconds?: number;
}

const START = (MOON_DAYS - 1) * DAY_LENGTH - DAY_LENGTH * 0.1;

function makeIsland(seed: number, land: Biome, size: number): World {
  Math.random = seeded(seed * 31 + 7);
  resetCreatureIds();
  resetArtifactIds();
  const world = generateWorld(size, size, seed, { biome: land, shape: "coast", warmth: 0.5, water: 0.5, relief: 0.5, forest: 0.5, mixed: false });
  populate(world);
  world.time = START;
  return world;
}

// A drought round the wonder: wild green dries to bare dirt, as no rain for
// a season would. Fields stay fields (watered by hand), and so do their crops.
function drought(world: World, x: number, y: number, r: number): void {
  for (let yy = Math.floor(y - r); yy <= y + r; yy++)
    for (let xx = Math.floor(x - r); xx <= x + r; xx++) {
      if (!world.inside(xx, yy) || Math.hypot(xx - x, yy - y) > r) continue;
      const i = yy * world.w + xx;
      if (world.depth[i] > 0 || world.cover[i] === C.HOUSE || world.cover[i] === C.WONDER) continue;
      if (world.ground[i] === G.GRASS) world.ground[i] = G.DIRT;
      const c = world.cover[i];
      if (c === C.TREE || c === C.BUSH || c === C.FLOWER) world.setCover(i, C.NONE);
    }
}

const differs = (a: World, b: World) => {
  let n = 0;
  for (let i = 0; i < a.n; i++)
    if (a.ground[i] !== b.ground[i] || a.cover[i] !== b.cover[i] || a.fluid[i] !== b.fluid[i] || Math.abs(a.height[i] - b.height[i]) > 0.2) n++;
  return n;
};

function count(world: World, own: readonly string[]): { villagers: number; animals: number; own: number } {
  let villagers = 0;
  let animals = 0;
  let mine = 0;
  for (const c of world.creatures) {
    if (c.dead) continue;
    if (own.includes(c.kind)) mine++;
    else if (c.kind === "villager") villagers++;
    else animals++;
  }
  return { villagers, animals, own: mine };
}

export function checkIsland(def: WonderDef, seed: number, land: Biome, size: number, seconds: number): IslandResult {
  const outer = Math.random;
  const errors: string[] = [];
  const world = makeIsland(seed, land, size);
  const randomA = seeded(seed * 97 + 1);
  const control = makeIsland(seed, land, size);
  const randomB = seeded(seed * 97 + 1);
  const lifeA = seeded(seed * 13 + 5);
  const lifeB = seeded(seed * 13 + 5);
  const out: IslandResult = {
    seed,
    land,
    at: null,
    built: { cells: 0, voxels: 0, parts: 0 },
    voxels: 0,
    extraMs: 0,
    acted: 0,
    did: [],
    villagers: [0, 0],
    animals: [0, 0],
    own: 0,
    errors,
  };
  try {
    const w = placeOne(world, def, seed);
    if (!w) return out;
    out.at = { x: w.x, y: w.y };
    const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
    const rc = new Runtime(control, () => {});
    Math.random = randomA;
    raiseWonders(world, rt);
    if (w.state !== 1) errors.push("its program did not compile");
    const parts = (wd: World) => wd.props.reduce((n, p) => n + p.boxes.length, 0);
    out.built = { cells: differs(world, control), voxels: world.decor.size - control.decor.size, parts: parts(world) - parts(control) };
    const key = defRequest(def).key;
    const own = w.own ?? [];
    const owned = (what: string) => rt.owners.get(what) === key;
    const materialCells = () => {
      let n = 0;
      for (const layer of ["ground", "cover", "fluid"] as const) {
        const ids = world.materials.list[layer].map((m) => owned(`${layer}:${m.name}`));
        if (!ids.some(Boolean)) continue;
        for (let i = 0; i < world.n; i++) if (ids[world[layer][i]]) n++;
      }
      return n;
    };
    const creatureDeeds = () => world.creatures.reduce((sum, c) => sum + (own.includes(c.kind) ? (c.mind?.deeds ?? 0) : 0), 0);
    const cells0 = materialCells();
    const dry = /drought/.test(def.code);
    let ta = 0;
    let tb = 0;
    const ticks = Math.round(seconds / TICK);
    for (let k = 0; k < ticks && !errors.length; k++) {
      if (dry && k === Math.round(ticks / 2)) {
        drought(world, w.x, w.y, def.reach + 6);
        drought(control, w.x, w.y, def.reach + 6);
      }
      Math.random = randomA;
      let t = performance.now();
      stepHeadless(world, rt, { life: lifeA });
      ta += performance.now() - t;
      Math.random = randomB;
      t = performance.now();
      stepHeadless(control, rc, { life: lifeB });
      tb += performance.now() - t;
      if (k % 30 === 0) out.voxels = Math.max(out.voxels, world.decor.size - control.decor.size);
    }
    out.extraMs = (ta - tb) / ticks;
    const arts = world.landmarks.filter(isArtifact).filter((l) => l.art.key === key);
    const artDeeds = arts.reduce((s, a) => s + a.art.deeds, 0);
    const kin = creatureDeeds();
    const spread = Math.abs(materialCells() - cells0);
    out.acted = artDeeds + kin + (spread >= 3 ? 1 : 0);
    out.did = [...new Set(arts.flatMap((a) => a.art.did))];
    if (kin) out.did.push(`${kin} deeds of its creatures`);
    if (spread >= 3) out.did.push(`its material changed by ${spread} cells`);
    const a = count(world, own);
    const b = count(control, []);
    out.villagers = [a.villagers, b.villagers];
    out.animals = [a.animals, b.animals];
    out.own = a.own;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    Math.random = outer;
  }
  return out;
}

export function checkWonderDef(def: WonderDef, opts: CheckOptions = {}): WonderVerdict {
  const size = opts.size ?? 152;
  const seeds = opts.seeds ?? [3, 17, 41, 59, 83, 97, 113];
  const want = opts.islands ?? 3;
  const seconds = opts.seconds ?? DAY_LENGTH;
  const lands: Biome[] = def.lands.length ? def.lands : ["temperate"];
  const islands: IslandResult[] = [];
  for (const seed of seeds) {
    if (islands.length >= want) break;
    const r = checkIsland(def, seed, lands[islands.length % lands.length], size, seconds);
    if (!r.at) continue;
    islands.push(r);
    const v = verdictOf(def, islands, false);
    if (!v.ok) return v;
  }
  if (islands.length < want)
    return {
      ok: false,
      problem: "spot",
      detail: `Only ${islands.length} of ${seeds.length} islands of its lands had a spot of the kind it asked for (${def.spot}).`,
      islands,
    };
  return verdictOf(def, islands, true);
}

function verdictOf(def: WonderDef, islands: IslandResult[], last: boolean): WonderVerdict {
  const fail = (problem: WonderVerdict["problem"], detail: string): WonderVerdict => ({ ok: false, problem, detail, islands });
  for (const r of islands) {
    const where = `on island ${r.seed} (${r.land})`;
    if (r.errors.length) return fail("crash", `It crashed ${where}: ${r.errors[0]}`);
    if (r.built.cells < 3 && r.built.voxels < 4 && r.built.parts < 4) return fail("nothing", `It built nothing visible ${where}.`);
    if (r.voxels > MAX_VOXELS) return fail("voxels", `It used ${r.voxels} voxels ${where}, past ${MAX_VOXELS}.`);
    if (r.extraMs > MAX_EXTRA_MS) return fail("slow", `It cost ${r.extraMs.toFixed(2)} ms a tick ${where}, past ${MAX_EXTRA_MS}.`);
    if (r.acted <= 0)
      return fail(
        "idle",
        `It did nothing in a whole day and night ${where}: no effect of its artifact, no deed of its creatures, no cell of its materials changed.`,
      );
    if (r.own > 3) return fail("creatures", `${r.own} of its own creatures were alive ${where}, past 3.`);
    if (r.villagers[0] < r.villagers[1] * 0.5 || r.animals[0] < r.animals[1] * 0.5)
      return fail("harm", `It left ${r.villagers[0]} villagers of ${r.villagers[1]} and ${r.animals[0]} animals of ${r.animals[1]} ${where}.`);
  }
  if (!last) return { ok: true, problem: null, detail: "", islands };
  const s = islands
    .map(
      (r) =>
        `${r.land} ${r.seed}: ${r.voxels} voxels, +${r.extraMs.toFixed(2)} ms, ${r.acted} deeds (${r.did.join(", ") || "acted"}), villagers ${r.villagers[0]}/${r.villagers[1]}, animals ${r.animals[0]}/${r.animals[1]}`,
    )
    .join("; ");
  return { ok: true, problem: null, detail: `${def.kind} passed on ${islands.length} islands. ${s}.`, islands };
}
