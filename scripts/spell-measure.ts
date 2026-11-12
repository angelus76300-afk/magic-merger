// 4.12 step 1 (docs/ROADMAP.md): how varied the live library is, how often
// two items answer each other, and how many programs read the island before
// acting. Measures only: it reads programs fetched earlier with admin GETs
// (cached JSON, see `--cache`), runs them in the game's own Runtime on the
// test run's practice island (the island and seed of src/sim/check.ts), and
// prints the three numbers. Nothing is sent anywhere.
//
//   npx esbuild scripts/spell-measure.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/spell-measure.mjs --log-level=warning
//   node node_modules/.cache/spell-measure.mjs --cache /tmp/spell-measure/cache --out /tmp/spell-measure/out
//
// The cache holds what these GETs returned (x-access-token, admin):
//   /api/admin/forms                      every element, its kind and casts (no code)
//   /api/admin/programs?limit=100         live programs not judged yet, with code
//   /api/admin/programs?limit=100&creatures=1
//   /api/admin/challenge-candidates?limit=60   live programs reachable for a challenge, with code
//   /api/spell/info?name=<name>           model and version of each program (info/<name>.json)
// Results of each run are kept in --out/runs.json, so a second call only prints.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import type * as TS from "typescript";
import { elementKey } from "../shared/elements";
import { isTier, TIERS, REFERENCE_SIDE, type Tier } from "../shared/tiers";
import { resetArtifactIds } from "../src/sim/artifacts";
import { BUILTIN_KINDS, populate, resetCreatureIds } from "../src/sim/creatures";
import { C } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { CreatureHandle, Runtime, SpellApi, type CastRequest } from "../src/sim/runtime";
import { baseName } from "../src/sim/social";
import { stepHeadless } from "../src/sim/tick";
import { keyLevel, keyX, keyY } from "../src/sim/voxelkey";
import { TICK, generateWorld, type World } from "../src/sim/world";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const CACHE = arg("--cache", "/tmp/spell-measure/cache");
const OUT = arg("--out", "/tmp/spell-measure/out");
const SECONDS = Number(arg("--seconds", "30"));
const B_AT = 3;
const PAIRS = Number(arg("--pairs", "300"));
const LIMIT = Number(arg("--limit", "0"));
const SEED = 11;
const SIZE = REFERENCE_SIDE;
const PER_SECOND = Math.round(1 / TICK);
mkdirSync(OUT, { recursive: true });

// --- The library, from the cache -------------------------------------------

interface Item {
  key: string;
  name: string;
  kind: string; // element kind: spell or artifact
  form: string; // one of the seven kinds
  tier: Tier;
  code: string;
  pid: number;
  source: string;
  model: string | null;
  version: number | null;
  casts: number | null;
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(`${CACHE}/${file}`, "utf8")) as T;

function library(): { items: Item[]; elements: number; formCounts: Record<string, number>; neverCast: number; unknownForm: number } {
  const forms = readJson<{ counts: Record<string, number>; rows: { key: string; name: string; kind: string; form: string; casts: number }[] }>("forms.json");
  const byKey = new Map(forms.rows.map((r) => [r.key, r]));
  const got = new Map<string, Item>();
  const add = (r: { id?: number; pid?: number; name: string; kind?: string; tier: string; code: string }, source: string) => {
    const key = elementKey(r.name);
    if (!r.code || got.has(key)) return;
    const f = byKey.get(key);
    got.set(key, {
      key,
      name: r.name,
      kind: f?.kind ?? r.kind ?? "spell",
      form: f?.form ?? "unsorted",
      tier: isTier(r.tier) ? r.tier : "major",
      code: r.code,
      pid: Number(r.pid ?? r.id),
      source,
      model: null,
      version: null,
      casts: f ? f.casts : null,
    });
  };
  for (const r of readJson<{ id: number; name: string; kind: string; tier: string; code: string }[]>("programs.json")) add(r, "unjudged");
  for (const r of readJson<{ id: number; name: string; kind: string; tier: string; code: string }[]>("programs-creatures.json")) add(r, "creatures");
  for (const r of readJson<{ pid: number; name: string; tier: string; code: string }[]>("challenge-candidates.json")) add(r, "challenge");
  // POST /api/library (read only, spells only), for the names the GETs did not give (the owner's "measure: all").
  const intents = new Map<string, string[]>();
  if (existsSync(`${CACHE}/library.json`))
    for (const r of readJson<{ spells: { key: string; name: string; tier: string; code: string; intents: string[] }[] }>("library.json").spells) {
      add({ name: r.name, tier: r.tier, code: r.code }, "library");
      intents.set(elementKey(r.name), r.intents);
    }
  // Model and version of the program that is live (or the one fetched).
  const info = new Map<string, { id: number; status: string; model: string; version: number }[]>();
  if (existsSync(`${CACHE}/info`))
    for (const f of readdirSync(`${CACHE}/info`))
      info.set(elementKey(decodeURIComponent(f.replace(/\.json$/, ""))), JSON.parse(readFileSync(`${CACHE}/info/${f}`, "utf8")));
  for (const it of got.values()) {
    const rows = info.get(it.key) ?? [];
    const row = rows.find((r) => r.id === it.pid) ?? rows.find((r) => r.status === "live");
    if (row) Object.assign(it, { model: row.model, version: row.version });
  }
  const items = [...got.values()].sort((a, b) => a.key.localeCompare(b.key));
  return {
    items,
    elements: forms.rows.length,
    formCounts: forms.counts,
    neverCast: forms.rows.filter((r) => r.casts === 0).length,
    unknownForm: items.filter((i) => i.form === "unsorted").length,
  };
}

// The whole library's model and version, from /api/spell/info (live rows only).
function liveModels(): { models: Record<string, number>; versions: Record<string, number>; live: number } {
  const models: Record<string, number> = {};
  const versions: Record<string, number> = {};
  let live = 0;
  if (!existsSync(`${CACHE}/info`)) return { models, versions, live };
  for (const f of readdirSync(`${CACHE}/info`)) {
    const rows = JSON.parse(readFileSync(`${CACHE}/info/${f}`, "utf8")) as { status: string; model: string; version: number }[];
    const row = rows.find((r) => r.status === "live");
    if (!row) continue;
    live++;
    models[row.model] = (models[row.model] ?? 0) + 1;
    versions[`v${row.version}`] = (versions[`v${row.version}`] ?? 0) + 1;
  }
  return { models, versions, live };
}

// --- Tracing what a program asks and does -----------------------------------

// Calls that read the island (World API, src/sim/runtime.ts: "Reading the land", creatures, artifacts).
const READS = new Set(["cell", "creatures", "corpses", "artifacts", "inside", "info"]);
// Arithmetic and dice: neither a question to the island nor an act.
const HELPERS = new Set(["rand", "chance", "pick", "dist", "angle", "lerp", "noise", "time", "dt"]);
let trace: Map<string, number> | null = null;
// Only the program's own calls count: the API calling itself (set calls
// inside) is one level down. A callback the program hands to the API (a
// disc's painter, a body's tick) runs at the program's level again.
let depth = 0;
const GUARDED = Symbol("guarded");
type Fn = ((...a: unknown[]) => unknown) & { [GUARDED]?: true };
function guard(f: Fn): Fn {
  if (f[GUARDED]) return f;
  const g: Fn = function (this: unknown, ...a: unknown[]) {
    const was = depth;
    depth = 0;
    try {
      return f.apply(this, a);
    } finally {
      depth = was;
    }
  };
  g[GUARDED] = true;
  return g;
}
function guardArg(v: unknown): unknown {
  if (typeof v === "function") return guard(v as Fn);
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype)
    for (const [k, x] of Object.entries(v)) if (typeof x === "function") (v as Record<string, unknown>)[k] = guard(x as Fn);
  return v;
}
function wrap(proto: object, prefix: string) {
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === "constructor") continue;
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || typeof d.value !== "function" || name.startsWith("_")) continue;
    const fn = d.value as (...a: unknown[]) => unknown;
    Object.defineProperty(proto, name, {
      ...d,
      value: function (this: unknown, ...a: unknown[]) {
        if (!trace) return fn.apply(this, a);
        const self = this as { req?: { key: string }; spellKey?: string };
        if (depth === 0 && /^m\d+:/.test(self.req?.key ?? self.spellKey ?? "")) {
          const first = a.find((v) => typeof v === "string");
          const k = `${prefix}${name}${typeof first === "string" && !READS.has(name) ? `:${first.toLowerCase().slice(0, 24)}` : ""}`;
          trace.set(k, (trace.get(k) ?? 0) + 1);
        }
        depth++;
        try {
          return fn.apply(this, a.map(guardArg));
        } finally {
          depth--;
        }
      },
    });
  }
}
wrap(SpellApi.prototype, "");
wrap(CreatureHandle.prototype, "c.");

// --- The practice island -----------------------------------------------------

interface Island {
  world: World;
  rt: Runtime;
  errors: string[];
  baseId: number;
  life: () => number;
  random: () => number;
  spell: () => number;
}

let villageSpot = { x: 0, y: 0 };
// The test run's island (src/sim/check.ts, island()): seed 11, rivers settled,
// a villager lying dead and another wounded by the edge of a village.
// stream: the programs' own dice. lives: which lives the island's creatures
// draw after the warm up (check.ts gives the same island other lives the same way).
// One creature more, or a deer that flees, sets every later life on another
// path; the island left alone is therefore run with several lives, and a cell
// counts as changed only when none of them shows it that way (`natural`).
function island(stream: number, lives = 0): Island {
  Math.random = seeded(SEED);
  resetCreatureIds();
  resetArtifactIds();
  const world = generateWorld(SIZE, SIZE, SEED);
  populate(world);
  const baseId = Math.max(0, ...world.creatures.map((c) => c.id));
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  const life = seeded(SEED + 2);
  for (let k = 0; k < 60; k++) stepHeadless(world, rt, { life });
  let target = { x: world.w / 2, y: world.h / 2 };
  for (let i = 0; i < world.n; i++)
    if (world.cover[i] === C.HOUSE) {
      target = { x: (i % world.w) + 6, y: Math.floor(i / world.w) + 6 };
      break;
    }
  villageSpot = target;
  const near = world.creatures
    .filter((c) => c.kind === "villager" && !c.dead)
    .sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y));
  if (near[0]) Object.assign(near[0], { x: target.x + 1, y: target.y + 1, hp: 0, dead: true });
  if (near[1]) Object.assign(near[1], { x: target.x - 1, y: target.y, hp: 35 });
  const out = {
    world,
    rt,
    errors,
    baseId,
    life: lives ? seeded(SEED + 2 + lives * 101) : life,
    random: seeded(SEED + 1),
    spell: seeded(SEED + 7 + stream * 101),
  };
  // The programs draw from their own stream, the island from its own: a spell
  // that throws a few particles more does not move the island's dice.
  const step = rt.step.bind(rt);
  rt.step = (dt: number) => {
    const was = Math.random;
    Math.random = out.spell;
    try {
      step(dt);
    } finally {
      Math.random = was;
    }
  };
  return out;
}

// Three very different places on the same island: the village edge of the
// test run, open water away from houses, bare rock away from houses.
function spots(): Record<"village" | "water" | "rock", { x: number; y: number }> {
  const { world } = island(0);
  const houses: number[] = [];
  for (let i = 0; i < world.n; i++) if (world.cover[i] === C.HOUSE) houses.push(i);
  const farFromHouses = (i: number) => houses.every((h) => Math.hypot((h % world.w) - (i % world.w), Math.floor(h / world.w) - Math.floor(i / world.w)) >= 18);
  const cx = world.w / 2;
  const cy = world.h / 2;
  const toCenter = (i: number) => Math.hypot((i % world.w) - cx, Math.floor(i / world.w) - cy);
  let water = -1;
  let rock = -1;
  for (let i = 0; i < world.n; i++) {
    const x = i % world.w;
    const y = Math.floor(i / world.w);
    if (x < 6 || y < 6 || x > world.w - 7 || y > world.h - 7 || !farFromHouses(i)) continue;
    if (world.depth[i] > 2 && (water < 0 || toCenter(i) < toCenter(water))) water = i;
    const ground = world.layerName("ground", world.ground[i]);
    if (world.depth[i] < 0.2 && world.cover[i] === C.NONE && (ground === "rock" || ground === "basalt") && (rock < 0 || world.height[i] > world.height[rock]))
      rock = i;
  }
  const at = (i: number) => ({ x: i % world.w, y: Math.floor(i / world.w) });
  return { village: villageSpot, water: at(water), rock: at(rock) };
}

// --- What the island looks like at one moment --------------------------------

interface Snap {
  height: Float32Array;
  depth: Float32Array;
  temp: Float32Array;
  // Material names per cell and layer (ids differ between worlds that defined other materials).
  ground: Uint16Array;
  fluid: Uint16Array;
  cover: Uint16Array;
  gas: Uint16Array;
  fire: Uint8Array;
  // Creatures there at the cast: id -> "kind:status:hp/10" or "dead"; those born since, by kind.
  old: Map<number, string>;
  born: Map<string, number>;
  decor: Set<number>;
  wards: number;
  props: number;
  landmarks: number;
}

// Material names, one number each for every world of the run (ids differ
// between worlds that defined other materials).
const NAMES: string[] = [];
const NAME_ID = new Map<string, number>();
const nameId = (n: string) => {
  let id = NAME_ID.get(n);
  if (id === undefined) {
    id = NAMES.push(n) - 1;
    NAME_ID.set(n, id);
  }
  return id;
};
function names(world: World, layer: "ground" | "fluid" | "cover" | "gas", ids: Uint8Array): Uint16Array {
  const table = new Map<number, number>();
  const out = new Uint16Array(ids.length);
  for (let i = 0; i < ids.length; i++) {
    let n = table.get(ids[i]);
    if (n === undefined) table.set(ids[i], (n = nameId(world.layerName(layer, ids[i]))));
    out[i] = n;
  }
  return out;
}

function snap(isl: Island): Snap {
  const { world } = isl;
  const fire = new Uint8Array(world.n);
  for (let i = 0; i < world.n; i++) fire[i] = world.fire[i] > 0.1 ? 1 : 0;
  const old = new Map<number, string>();
  const born = new Map<string, number>();
  for (const c of world.creatures) {
    if (c.id > isl.baseId) {
      if (c.dead) continue;
      const k = BUILTIN_KINDS.has(baseName(c.kind)) ? baseName(c.kind) : `own:${baseName(c.kind)}`;
      born.set(k, (born.get(k) ?? 0) + 1);
      continue;
    }
    const status = [c.burning, c.frozen, c.fear, c.sleep, c.calm, c.levitate, c.stun].map((v) => (v > 0 ? 1 : 0)).join("");
    old.set(c.id, c.dead ? "dead" : `${baseName(c.kind)}:${status}:${Math.round(c.hp / 10)}`);
  }
  return {
    height: world.height.slice(),
    depth: world.depth.slice(),
    temp: world.temp.slice(),
    ground: names(world, "ground", world.ground),
    fluid: names(world, "fluid", world.fluid),
    cover: names(world, "cover", world.cover),
    gas: names(world, "gas", world.gas),
    fire,
    old,
    born,
    decor: new Set(world.decor.keys()),
    wards: world.wards.length,
    props: world.props.length,
    landmarks: world.landmarks.length,
  };
}

// The island left alone, as several lives (`island`): what a cell, a creature
// or a voxel may be at one second without any spell.
type Ens = Snap[];
const LAYERS = ["ground", "cover", "fluid", "gas"] as const;
function natural(e: Ens, layer: (typeof LAYERS)[number], i: number, v: number): boolean {
  for (const s of e) if (s[layer][i] === v) return true;
  return false;
}
function inRange(e: Ens, field: "height" | "depth" | "temp", i: number, v: number, tol: number): boolean {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of e) {
    lo = Math.min(lo, s[field][i]);
    hi = Math.max(hi, s[field][i]);
  }
  return v >= lo - tol && v <= hi + tol;
}
const fireNatural = (e: Ens, i: number, v: number) => e.some((s) => s.fire[i] === v);
const stateNatural = (e: Ens, id: number, v: string | undefined) => e.some((s) => s.old.get(id) === v);
const bornMax = (e: Ens, k: string) => Math.max(...e.map((s) => s.born.get(k) ?? 0));
const bornMin = (e: Ens, k: string) => Math.min(...e.map((s) => s.born.get(k) ?? 0));
const decorNatural = (e: Ens, k: number, has: boolean) => e.some((s) => s.decor.has(k) === has);

function cellChanged(e: Ens, b: Snap, i: number): boolean {
  for (const l of LAYERS) if (!natural(e, l, i, b[l][i])) return true;
  return !fireNatural(e, i, b.fire[i]) || !inRange(e, "height", i, b.height[i], 0.4) || !inRange(e, "depth", i, b.depth[i], 0.4);
}
function cellsDiffer(e: Ens, b: Snap): number {
  let n = 0;
  for (let i = 0; i < b.fire.length; i++) if (cellChanged(e, b, i)) n++;
  return n;
}
function creaturesDiffer(e: Ens, b: Snap): number {
  let n = 0;
  for (const [id, s] of b.old) if (!stateNatural(e, id, s)) n++;
  for (const [k, v] of b.born) n += Math.max(0, v - bornMax(e, k));
  return n;
}
function decorDiffer(e: Ens, b: Snap): number {
  let n = 0;
  for (const k of b.decor) if (!decorNatural(e, k, true)) n++;
  for (const k of e[0].decor) if (!b.decor.has(k) && !decorNatural(e, k, false)) n++;
  return n;
}

// --- Runs ------------------------------------------------------------------

interface Cast {
  item: Item;
  at: number;
  x: number;
  y: number;
}
interface Run {
  final: Snap;
  // Per second: cells, creatures and voxels changed against the island left alone, cells newly on fire, cells hotter or colder.
  timeline: { cells: number; creatures: number; voxels: number; fire: number; temp: number }[];
  bodySeconds: number;
  wardsMax: number;
  errors: string[];
  started: boolean[];
  busyAtEnd: boolean;
  trace: Record<string, number>;
}

const LIVES = Number(arg("--lives", "16"));
// ensemble[second][life]
let ensemble: Ens[] | null = null;
function alone(): Ens[] {
  if (!ensemble) {
    const runs = Array.from({ length: LIVES }, (_, l) => simulate([], 0, null, false, l).snaps);
    ensemble = runs[0].map((_, s) => runs.map((r) => r[s]));
  }
  return ensemble;
}

function simulate(casts: Cast[], stream: number, ref: Ens[] | null, withTrace = false, lives = 0) {
  const outer = Math.random;
  const isl = island(stream, lives);
  const { world, rt } = isl;
  const snaps: Snap[] = [snap(isl)];
  const timeline: Run["timeline"] = [];
  const started: boolean[] = [];
  let bodySeconds = 0;
  let wardsMax = 0;
  const due = casts.map((c, n) => ({ ...c, n, done: false }));
  trace = withTrace ? new Map() : null;
  Math.random = isl.random;
  try {
    for (let s = 1; s <= SECONDS; s++) {
      for (let k = 0; k < PER_SECOND; k++) {
        const t = s - 1 + k * TICK;
        for (const d of due)
          if (!d.done && t >= d.at - 1e-9) {
            d.done = true;
            const req: CastRequest = {
              key: `m${d.n}:${d.item.key}`,
              name: d.item.name,
              tier: d.item.tier,
              code: d.item.code,
              form: d.item.form,
              kind: d.item.kind === "artifact" ? "artifact" : "spell",
            };
            const was = Math.random;
            Math.random = isl.spell;
            try {
              started[d.n] = rt.cast(req, d.x, d.y);
            } finally {
              Math.random = was;
            }
          }
        stepHeadless(world, rt, { life: isl.life });
        if (rt.visuals.bodies.some((b) => b.alive && b.look !== "none")) bodySeconds += TICK;
        wardsMax = Math.max(wardsMax, world.wards.length);
      }
      const now = snap(isl);
      if (ref) {
        const e = ref[s];
        let tempCells = 0;
        let fireCells = 0;
        for (let i = 0; i < world.n; i++) {
          if (!inRange(e, "temp", i, now.temp[i], 5)) tempCells++;
          if (now.fire[i] && !fireNatural(e, i, 1)) fireCells++;
        }
        timeline.push({ cells: cellsDiffer(e, now), creatures: creaturesDiffer(e, now), voxels: decorDiffer(e, now), fire: fireCells, temp: tempCells });
        if (s === SECONDS) snaps.push(now);
      } else snaps.push(now);
    }
  } finally {
    Math.random = outer;
  }
  const out = {
    snaps,
    run: {
      final: snaps[snaps.length - 1],
      timeline,
      bodySeconds: Math.round(bodySeconds * 10) / 10,
      wardsMax,
      errors: isl.errors.slice(0, 3),
      started,
      busyAtEnd: rt.busy() || rt.visuals.bodies.length > 0 || world.wards.length > 0,
      trace: Object.fromEntries(trace ?? []),
    } as Run,
  };
  trace = null;
  return out;
}

function runCasts(casts: Cast[], stream = 0, withTrace = false): Run {
  return simulate(casts, stream, alone(), withTrace).run;
}

// --- The effect of a run, against the island left alone ----------------------

interface Effect {
  mats: Record<string, number>; // "layer:name" placed (cells now that material where no life of the island has it)
  up: number;
  down: number;
  fireMax: number;
  tempMax: number;
  fluid: Record<string, number>;
  gas: number;
  born: Record<string, number>;
  killed: number;
  hurt: number;
  healed: number;
  status: number;
  turned: number;
  voxAdd: number;
  voxDel: number;
  box: [number, number, number];
  props: number;
  landmarks: number;
  wards: number;
  bodySeconds: number;
  lastActive: number;
  activeAtEnd: boolean;
  cellsMax: number;
  errors: string[];
  started: boolean;
}

function effectOf(run: Run, e: Ens): Effect {
  const f = run.final;
  const c = e[0];
  const mats: Record<string, number> = {};
  const fluid: Record<string, number> = {};
  let up = 0;
  let down = 0;
  let gas = 0;
  for (let i = 0; i < f.fire.length; i++) {
    if (!inRange(e, "height", i, f.height[i], 0.4)) {
      if (f.height[i] > c.height[i]) up++;
      else down++;
    }
    const gk = `ground:${NAMES[f.ground[i]]}`;
    const ck = `cover:${NAMES[f.cover[i]]}`;
    const fk = NAMES[f.fluid[i]];
    if (!natural(e, "ground", i, f.ground[i])) mats[gk] = (mats[gk] ?? 0) + 1;
    if (!natural(e, "cover", i, f.cover[i])) mats[ck] = (mats[ck] ?? 0) + 1;
    if (!natural(e, "fluid", i, f.fluid[i]) || !inRange(e, "depth", i, f.depth[i], 0.4)) fluid[fk] = (fluid[fk] ?? 0) + 1;
    if (!natural(e, "gas", i, f.gas[i])) gas++;
  }
  let killed = 0;
  let hurt = 0;
  let healed = 0;
  let status = 0;
  let turned = 0;
  for (const [id, s] of f.old) {
    const was = c.old.get(id);
    if (was === undefined || stateNatural(e, id, s)) continue;
    if (s === "dead") killed++;
    else if (was === "dead") healed++;
    else {
      const [k1, st1, hp1] = was.split(":");
      const [k2, st2, hp2] = s.split(":");
      if (k1 !== k2) turned++;
      if (st1 !== st2) status++;
      if (Number(hp2) < Number(hp1)) hurt++;
      if (Number(hp2) > Number(hp1)) healed++;
    }
  }
  const born: Record<string, number> = {};
  for (const [k, n] of f.born) {
    const d = n - bornMax(e, k);
    if (d > 0) born[k] = d;
  }
  let voxAdd = 0;
  let voxDel = 0;
  const lo = [1e9, 1e9, 1e9];
  const hi = [-1e9, -1e9, -1e9];
  for (const k of f.decor)
    if (!decorNatural(e, k, true)) {
      voxAdd++;
      const p = [keyX(k), keyY(k), keyLevel(k)];
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], p[a]);
        hi[a] = Math.max(hi[a], p[a]);
      }
    }
  for (const k of c.decor) if (!f.decor.has(k) && !decorNatural(e, k, false)) voxDel++;
  const tl = run.timeline;
  const sig = tl.map((t) => [t.cells, t.creatures, t.voxels, t.fire]);
  let lastActive = 0;
  for (let s = 1; s < sig.length; s++) if (sig[s].some((v, j) => Math.abs(v - sig[s - 1][j]) > 2)) lastActive = s + 1;
  return {
    mats,
    up,
    down,
    fireMax: Math.max(0, ...tl.map((t) => t.fire)),
    tempMax: Math.max(0, ...tl.map((t) => t.temp)),
    fluid,
    gas,
    born,
    killed,
    hurt,
    healed,
    status,
    turned,
    voxAdd,
    voxDel,
    box: voxAdd ? [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1] : [0, 0, 0],
    props: Math.max(0, f.props - Math.max(...e.map((s) => s.props))),
    landmarks: Math.max(0, f.landmarks - Math.max(...e.map((s) => s.landmarks))),
    wards: run.wardsMax,
    bodySeconds: run.bodySeconds,
    lastActive,
    activeAtEnd: lastActive >= SECONDS - 2,
    cellsMax: Math.max(0, ...tl.map((t) => t.cells)),
    errors: run.errors,
    started: run.started[0] ?? false,
  };
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);

// --- Shapes, by rule ---------------------------------------------------------

const SHAPES = [
  "paints one material",
  "paints a mix",
  "reshapes land",
  "sets fire",
  "pours a fluid",
  "heats or chills",
  "releases gas",
  "drops creatures",
  "acts on creatures",
  "raises a structure",
  "sets down an object",
  "dome or ward",
  "only lights and particles",
  "nothing lasting",
] as const;
type Shape = (typeof SHAPES)[number];

// What the island's lives do anyway (fields, flowers, houses): a creature
// more moves the villagers and deer, and they farm and build elsewhere. These
// count a fifth in the scores, so that drift does not make a shape.
const LIFE = new Set([
  "cover:flower",
  "cover:bush",
  "cover:tree",
  "cover:stump",
  "cover:crop",
  "cover:house",
  "cover:none",
  "ground:dirt",
  "ground:grass",
  "ground:field",
]);
function paintOf(e: Effect): { life: number; other: number; top: number } {
  let life = 0;
  let other = 0;
  let top = 0;
  for (const [k, n] of Object.entries(e.mats))
    if (LIFE.has(k)) life += n;
    else {
      other += n;
      top = Math.max(top, n);
    }
  return { life, other, top };
}

// Under 80 cells, what the lives moved is drift, not the item's doing.
const lifeScore = (n: number) => (n >= 80 ? n / 5 : 0);

function systemScores(e: Effect): Record<string, number> {
  const p = paintOf(e);
  return {
    paint: p.other + lifeScore(p.life),
    land: e.up + e.down,
    fire: e.fireMax,
    fluid: sum(e.fluid),
    temp: e.tempMax / 3,
    gas: e.gas / 2,
    born: 15 * sum(e.born),
    creatures: 6 * (e.killed + e.hurt + e.healed + e.status + e.turned),
    structure: e.voxAdd / 4 + e.voxDel / 8,
    object: 40 * e.props + 40 * e.landmarks,
    ward: 40 * e.wards,
  };
}

function shapeOf(e: Effect): Shape {
  const s = systemScores(e);
  const total = Object.values(s).reduce((a, b) => a + b, 0);
  if (total < 3) return e.bodySeconds >= 0.5 ? "only lights and particles" : "nothing lasting";
  const top = Object.entries(s).sort((a, b) => b[1] - a[1])[0][0];
  switch (top) {
    case "paint": {
      const p = paintOf(e);
      return p.top / (p.other + lifeScore(p.life)) >= 0.7 ? "paints one material" : "paints a mix";
    }
    case "land":
      return "reshapes land";
    case "fire":
      return "sets fire";
    case "fluid":
      return "pours a fluid";
    case "temp":
      return "heats or chills";
    case "gas":
      return "releases gas";
    case "born":
      return "drops creatures";
    case "creatures":
      return "acts on creatures";
    case "structure":
      return "raises a structure";
    case "object":
      return "sets down an object";
    default:
      return "dome or ward";
  }
}

// Systems an effect touches above a small floor (the test run's: 3 cells, 4 voxels, 1 creature).
function systemsTouched(e: Effect): string[] {
  const s = systemScores(e);
  return Object.entries(s)
    .filter(([k, v]) => (k === "structure" ? e.voxAdd + e.voxDel >= 4 : k === "object" ? v > 0 : k === "ward" ? e.wards > 0 : v >= 3))
    .map(([k]) => k);
}

// The effect as a vector for the duplicate measure: own materials and own creatures by layer, not by name.
function vectorOf(e: Effect): Map<string, number> {
  const v = new Map<string, number>();
  const add = (k: string, n: number) => n > 0 && v.set(k, (v.get(k) ?? 0) + n);
  for (const [k, n] of Object.entries(e.mats)) {
    const [layer, name] = k.split(":");
    if (LIFE.has(k)) continue;
    else add(BUILTIN_MATERIALS.has(name) ? k : `${layer}:own`, n);
  }
  for (const [k, n] of Object.entries(e.fluid)) add(`fluid:${BUILTIN_MATERIALS.has(k) ? k : "own"}`, n);
  for (const [k, n] of Object.entries(e.born)) add(`born:${k.startsWith("own:") ? "own" : k}`, n * 15);
  add("up", e.up);
  add("down", e.down);
  add("fire", e.fireMax);
  add("temp", e.tempMax / 3);
  add("gas", e.gas);
  add("killed", e.killed * 6);
  add("hurt", e.hurt * 6);
  add("healed", e.healed * 6);
  add("status", e.status * 6);
  add("turned", e.turned * 6);
  add("voxels", e.voxAdd / 4);
  add("props", e.props * 40);
  add("landmarks", e.landmarks * 40);
  add("wards", e.wards * 150);
  add("life", lifeScore(paintOf(e).life));
  for (const [k, n] of v) v.set(k, Math.log1p(n));
  return v;
}
const BUILTIN_MATERIALS = new Set<string>();

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, x] of a) {
    na += x * x;
    dot += x * (b.get(k) ?? 0);
  }
  for (const x of b.values()) nb += x * x;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// --- Interaction: does B after A differ from A alone and B alone composed? ----

const SYSTEMS = ["materials", "fire", "fluids", "temperature", "gas", "land", "creatures", "structures", "wards"] as const;
type System = (typeof SYSTEMS)[number];

// Per system, how far `got` is from the composition of A's and B's own runs:
// each cell takes B's state where B changed it, else A's, else the island's.
// A difference counts only when one side of it is something no life of the
// island left alone shows there (`natural`): the lives' own drift is not an
// interaction.
function mismatch(got: Snap, a: Snap, b: Snap, e: Ens, wards: { got: number; a: number; b: number }) {
  const c = e[0];
  const m: Record<System, number> = { materials: 0, fire: 0, fluids: 0, temperature: 0, gas: 0, land: 0, creatures: 0, structures: 0, wards: 0 };
  const delta: Record<string, number> = {};
  const note = (k: string, n: number) => (delta[k] = (delta[k] ?? 0) + n);
  const pick = <T>(av: T, bv: T, cv: T) => (bv !== cv ? bv : av);
  for (let i = 0; i < c.fire.length; i++) {
    for (const layer of ["ground", "cover", "gas"] as const) {
      const p = pick(a[layer][i], b[layer][i], c[layer][i]);
      const g = got[layer][i];
      if (g !== p && !(natural(e, layer, i, g) && natural(e, layer, i, p))) {
        if (layer === "gas") m.gas++;
        else m.materials++;
        note(`+${NAMES[g]}`, 1);
        note(`-${NAMES[p]}`, 1);
      }
    }
    const pf = pick(a.fluid[i], b.fluid[i], c.fluid[i]);
    const pd = Math.abs(b.depth[i] - c.depth[i]) > 0.4 ? b.depth[i] : a.depth[i];
    const fluidOff = got.fluid[i] !== pf && !(natural(e, "fluid", i, got.fluid[i]) && natural(e, "fluid", i, pf));
    const depthOff = Math.abs(got.depth[i] - pd) > 0.4 && !(inRange(e, "depth", i, got.depth[i], 0.4) && inRange(e, "depth", i, pd, 0.4));
    if (fluidOff || depthOff) {
      m.fluids++;
      if (fluidOff) {
        note(`+${NAMES[got.fluid[i]]}`, 1);
        note(`-${NAMES[pf]}`, 1);
      } else note(got.depth[i] > pd ? "+depth" : "-depth", 1);
    }
    const pfire = pick(a.fire[i], b.fire[i], c.fire[i]);
    if (got.fire[i] !== pfire && !(fireNatural(e, i, got.fire[i]) && fireNatural(e, i, pfire))) {
      m.fire++;
      note(got.fire[i] ? "+fire" : "-fire", 1);
    }
    const pt = c.temp[i] + (a.temp[i] - c.temp[i]) + (b.temp[i] - c.temp[i]);
    if (Math.abs(got.temp[i] - pt) > 8 && !(inRange(e, "temp", i, got.temp[i], 5) && inRange(e, "temp", i, pt, 5))) {
      m.temperature++;
      note(got.temp[i] > pt ? "+warmer" : "+colder", 1);
    }
    const ph = Math.abs(b.height[i] - c.height[i]) > 0.4 ? b.height[i] : a.height[i];
    if (Math.abs(got.height[i] - ph) > 0.4 && !(inRange(e, "height", i, got.height[i], 0.4) && inRange(e, "height", i, ph, 0.4))) {
      m.land++;
      note(got.height[i] > ph ? "+higher" : "+lower", 1);
    }
  }
  for (const [id, s] of got.old) {
    const p = pick(a.old.get(id), b.old.get(id), c.old.get(id));
    if (s !== p && !(stateNatural(e, id, s) && stateNatural(e, id, p))) {
      m.creatures++;
      note(s === "dead" ? "creature killed" : p === "dead" ? "creature raised" : "creature changed", 1);
    }
  }
  for (const k of new Set([...got.born.keys(), ...a.born.keys(), ...b.born.keys()])) {
    const p = (a.born.get(k) ?? 0) + (b.born.get(k) ?? 0) - (c.born.get(k) ?? 0);
    const d = (got.born.get(k) ?? 0) - p;
    const spread = bornMax(e, k) - bornMin(e, k);
    if (Math.abs(d) > spread) {
      m.creatures += Math.abs(d) - spread;
      note(`${d > 0 ? "+" : "-"}${k.replace(/^own:/, "")}`, Math.abs(d) - spread);
    }
  }
  const expected = (k: number) => (c.decor.has(k) && a.decor.has(k) && b.decor.has(k)) || (!c.decor.has(k) && (a.decor.has(k) || b.decor.has(k)));
  for (const k of got.decor) if (!expected(k) && !decorNatural(e, k, true)) m.structures++;
  for (const k of new Set([...a.decor, ...b.decor])) if (expected(k) && !got.decor.has(k) && !decorNatural(e, k, false)) m.structures++;
  if (m.structures) note("voxels", m.structures);
  m.wards = Math.abs(wards.got - (wards.a + wards.b));
  return { m, delta };
}

// --- Interaction, by what the island holds ----------------------------------
//
// Placing is random (a meteor lands somewhere in its reach), so two runs of
// the same item rarely match cell by cell. What they hold does: how many
// cells of ash, of water, on fire, colder, how many creatures of each kind.
// Each run is a vector of such counts against the island left alone (the mean
// of its lives); a pair interacts in a feature when B after A holds more or
// less than A alone plus B alone, beyond the noise of each item (the same item
// on another random stream) and beyond what B covering A's cells explains.
// A product neither A nor B makes alone (basalt from lava and water) is the
// clearest answer of all and is counted on its own.

type Features = Record<string, number>;
const FEATURE_SYSTEM = (f: string): System =>
  f.startsWith("mat:") || f === "life"
    ? "materials"
    : f.startsWith("fluid:") || f === "volume"
      ? "fluids"
      : f.startsWith("gas:")
        ? "gas"
        : f === "fire" || f === "fireMax"
          ? "fire"
          : f === "hot" || f === "cold"
            ? "temperature"
            : f === "up" || f === "down"
              ? "land"
              : f === "voxels" || f === "unvoxels"
                ? "structures"
                : f === "wards"
                  ? "wards"
                  : "creatures";
const FEATURE_FLOOR = (f: string) =>
  ({ materials: 8, fluids: 8, gas: 10, fire: 8, temperature: 10, land: 8, structures: 20, wards: 1, creatures: 2 })[FEATURE_SYSTEM(f)] +
  (f === "life" ? 40 : f === "hp" ? 8 : 0);
const STATUS_NAMES = ["burning", "frozen", "afraid", "asleep", "calm", "floating", "stunned"];

function counts(s: Snap, baseId: number): Features {
  const F: Features = {};
  const add = (k: string, n = 1) => (F[k] = (F[k] ?? 0) + n);
  for (let i = 0; i < s.fire.length; i++) {
    const g = `ground:${NAMES[s.ground[i]]}`;
    const c = `cover:${NAMES[s.cover[i]]}`;
    add(LIFE.has(g) ? "life" : `mat:${g}`);
    add(LIFE.has(c) ? "life" : `mat:${c}`);
    if (s.depth[i] > 0.05) add(`fluid:${NAMES[s.fluid[i]]}`);
    add("volume", s.depth[i]);
    if (NAMES[s.gas[i]] !== "none") add(`gas:${NAMES[s.gas[i]]}`);
    if (s.fire[i]) add("fire");
    add("height", s.height[i]);
  }
  for (const [, st] of s.old) {
    if (st === "dead") {
      add("dead");
      continue;
    }
    const [, bits, hp] = st.split(":");
    add("hp", Number(hp));
    for (let b = 0; b < bits.length; b++) if (bits[b] === "1") add(STATUS_NAMES[b]);
  }
  for (const [k, n] of s.born) add(`born:${k}`, n);
  add("voxelsAll", s.decor.size);
  void baseId;
  return F;
}

let meanAlone: Features | null = null;
function features(run: Run, e: Ens): { F: Features; produced: string[] } {
  if (!meanAlone) {
    meanAlone = {};
    for (const s of e) for (const [k, v] of Object.entries(counts(s, 0))) meanAlone[k] = (meanAlone[k] ?? 0) + v / e.length;
  }
  const f = run.final;
  const raw = counts(f, 0);
  const F: Features = {};
  for (const k of new Set([...Object.keys(raw), ...Object.keys(meanAlone)])) {
    if (k === "height" || k === "voxelsAll") continue;
    const d = (raw[k] ?? 0) - (meanAlone[k] ?? 0);
    if (Math.abs(d) >= 0.5) F[k] = Math.round(d * 10) / 10;
  }
  const produced = new Set<string>();
  let hot = 0;
  let cold = 0;
  let up = 0;
  let down = 0;
  for (let i = 0; i < f.fire.length; i++) {
    for (const l of LAYERS) if (!natural(e, l, i, f[l][i])) produced.add(`${l}:${NAMES[f[l][i]]}`);
    if (!inRange(e, "temp", i, f.temp[i], 5)) {
      if (f.temp[i] > e[0].temp[i]) hot++;
      else cold++;
    }
    if (!inRange(e, "height", i, f.height[i], 0.4)) {
      if (f.height[i] > e[0].height[i]) up++;
      else down++;
    }
  }
  let voxels = 0;
  let unvoxels = 0;
  for (const k of f.decor) if (!decorNatural(e, k, true)) voxels++;
  for (const k of e[0].decor) if (!f.decor.has(k) && !decorNatural(e, k, false)) unvoxels++;
  Object.assign(F, { hot, cold, up, down, voxels, unvoxels, wards: run.wardsMax, fireMax: Math.max(0, ...run.timeline.map((t) => t.fire)) });
  return { F, produced: [...produced] };
}

// Cells a run changed against every life of the island.
function changedMask(s: Snap, e: Ens): Uint8Array {
  const m = new Uint8Array(s.fire.length);
  for (let i = 0; i < m.length; i++) m[i] = cellChanged(e, s, i) ? 1 : 0;
  return m;
}

// --- Static reading of the code ---------------------------------------------

const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof TS;
const READ_PROPS = new Set(["fluid", "ground", "cover", "fire", "temp", "depth", "gas", "kind", "hp", "alive", "status"]);

function statics(code: string) {
  const src = ts.createSourceFile("p.js", code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const reads: Record<string, number> = {};
  const fromReads = new Set<string>();
  let branches = 0;
  const callName = (n: TS.Node) => (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : null);
  const isRead = (n: TS.Node) => {
    const c = callName(n);
    return c !== null && READS.has(c) && c !== "inside";
  };
  // Variables holding what was read, found first.
  const visitVars = (n: TS.Node) => {
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name)) {
      let has = false;
      const look = (k: TS.Node) => {
        if (isRead(k)) has = true;
        k.forEachChild(look);
      };
      look(n.initializer);
      if (has) fromReads.add(n.name.text);
    }
    n.forEachChild(visitVars);
  };
  visitVars(src);
  const mentionsRead = (n: TS.Node): boolean => {
    let has = false;
    const look = (k: TS.Node) => {
      if (has) return;
      if (
        isRead(k) ||
        (ts.isIdentifier(k) && fromReads.has(k.text)) ||
        (ts.isPropertyAccessExpression(k) && READ_PROPS.has(k.name.text) && !ts.isCallExpression(k.parent))
      )
        has = true;
      k.forEachChild(look);
    };
    look(n);
    return has;
  };
  const visit = (n: TS.Node) => {
    const c = callName(n);
    if (c && READS.has(c) && c !== "inside") reads[c] = (reads[c] ?? 0) + 1;
    let cond: TS.Node | null = null;
    if (ts.isIfStatement(n) || ts.isConditionalExpression(n) || ts.isWhileStatement(n))
      cond = (n as TS.IfStatement).expression ?? (n as unknown as TS.ConditionalExpression).condition;
    if (ts.isConditionalExpression(n)) cond = n.condition;
    if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || n.operatorToken.kind === ts.SyntaxKind.BarBarToken))
      cond = n.left;
    if (c && ["filter", "find", "some", "every", "sort"].includes(c)) cond = n;
    if (cond && mentionsRead(cond)) branches++;
    n.forEachChild(visit);
  };
  visit(src);
  return { reads, branches };
}

// --- The run of the whole measurement ------------------------------------------

interface Single {
  key: string;
  effect: Effect;
  shape: Shape;
  systems: string[];
  trace: Record<string, number>;
}
interface Store {
  singles: Record<string, Single>;
  spots: Record<string, Record<string, Record<string, number>>>;
  spotShapes: Record<string, Record<string, Shape>>;
  noise: Record<string, Record<System, number>>;
  determinism: { items: string[]; mismatch: number };
  pairs: Record<string, { a: string; b: string; why: string; F: Features; fresh: Record<string, number>; overlap: number }>;
  // Per item in a pair: its counts cast at 0 s, on another stream, and cast at 3 s; what it makes.
  itemRuns: Record<string, { F0: Features; F1: Features; FB: Features; produced: string[] }>;
}
// --shard k/n runs every n-th item or pair from k in its own process, into
// runs-k.json; a run without --shard folds those files into runs.json.
// --phase items|pairs stops after that phase (all: everything, then the report).
const [SHARD, SHARDS] = arg("--shard", "0/1").split("/").map(Number);
const PHASE = arg("--phase", "all");
const storeFile = SHARDS > 1 ? `${OUT}/runs-${SHARD}.json` : `${OUT}/runs.json`;
const store: Store = { singles: {}, spots: {}, spotShapes: {}, noise: {}, determinism: { items: [], mismatch: -1 }, pairs: {}, itemRuns: {} };
for (const f of [
  `${OUT}/runs.json`,
  ...(existsSync(OUT)
    ? readdirSync(OUT)
        .filter((x) => /^runs-\d+\.json$/.test(x))
        .map((x) => `${OUT}/${x}`)
    : []),
]) {
  if (!existsSync(f) || (SHARDS > 1 && f !== `${OUT}/runs.json` && f !== storeFile)) continue;
  const got = JSON.parse(readFileSync(f, "utf8")) as Store;
  for (const k of ["singles", "spots", "spotShapes", "noise", "pairs", "itemRuns"] as const) Object.assign(store[k], got[k] ?? {});
  if (got.determinism.mismatch >= 0) store.determinism = got.determinism;
}
const save = () => writeFileSync(storeFile, JSON.stringify(store));
const mine = (n: number) => n % SHARDS === SHARD;

// Final snapshots are not stored; the ones a pair needs are recomputed and kept in memory.
const finals = new Map<string, { snap: Snap; wards: number; run: Run }>();
function finalOf(item: Item, at: number, place: { x: number; y: number }, stream = 0) {
  const k = `${item.key}@${at}@${place.x},${place.y}#${stream}`;
  let f = finals.get(k);
  if (!f) {
    const r = runCasts([{ item, at, ...place }], stream);
    f = { snap: r.final, wards: r.final.wards, run: r };
    finals.set(k, f);
    if (finals.size > 400) finals.delete(finals.keys().next().value!);
  }
  return f;
}

function log(msg: string) {
  process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${msg}\n`);
}

function main() {
  const lib = library();
  const items = LIMIT ? lib.items.slice(0, LIMIT) : lib.items;
  const byKey = new Map(items.map((i) => [i.key, i]));
  {
    // Built-in materials: those of a fresh world.
    const w = generateWorld(16, 16, 1);
    for (const layer of ["ground", "fluid", "cover", "gas"] as const)
      for (let id = 0; id < 250; id++) {
        try {
          const m = w.materials.get(layer, id);
          if (!m) break;
          BUILTIN_MATERIALS.add(m.name);
        } catch {
          break;
        }
      }
  }
  const place = spots();
  log(`${items.length} programs, spots ${JSON.stringify(place)}`);

  // 1. Every program once at the village, with its call trace.
  const ctrl = alone()[SECONDS];
  const c0 = ctrl[0];
  let n = 0;
  for (const [idx, it] of items.entries()) {
    if (store.singles[it.key] || !mine(idx)) continue;
    const r = runCasts([{ item: it, at: 0, ...place.village }], 0, true);
    const effect = effectOf(r, ctrl);
    store.singles[it.key] = { key: it.key, effect, shape: shapeOf(effect), systems: systemsTouched(effect), trace: r.trace };
    if (++n % 20 === 0) {
      log(`singles ${Object.keys(store.singles).length}/${items.length}`);
      save();
    }
  }
  save();

  // 3. The same program on water and on rock (the village run is above).
  n = 0;
  for (const [idx, it] of items.entries()) {
    if (store.spots[it.key] || !mine(idx)) continue;
    const traces: Record<string, Record<string, number>> = { village: store.singles[it.key].trace };
    const shapes: Record<string, Shape> = { village: store.singles[it.key].shape };
    for (const where of ["water", "rock"] as const) {
      const r = runCasts([{ item: it, at: 0, ...place[where] }], 0, true);
      traces[where] = r.trace;
      shapes[where] = shapeOf(effectOf(r, ctrl));
    }
    store.spots[it.key] = traces;
    store.spotShapes[it.key] = shapes;
    if (++n % 20 === 0) {
      log(`spots ${Object.keys(store.spots).length}/${items.length}`);
      save();
    }
  }
  save();

  if (PHASE === "items" || (SHARDS > 1 && items.some((i) => !store.singles[i.key]))) return;
  // Noise: the same program with another random stream, and twice the same run.
  if (store.determinism.mismatch < 0 && SHARD === 0) {
    const some = items.filter((i) => store.singles[i.key].shape !== "nothing lasting").slice(0, 10);
    let total = 0;
    for (const it of some) {
      const a = runCasts([{ item: it, at: 0, ...place.village }]).final;
      const b = runCasts([{ item: it, at: 0, ...place.village }]).final;
      const mm = mismatch(b, a, c0, ctrl, { got: b.wards, a: a.wards, b: 0 });
      if (process.argv.includes("--debug")) log(`${it.name} ${JSON.stringify(mm)}`);
      total += Object.values(mm.m).reduce((s, v) => s + v, 0);
    }
    store.determinism = { items: some.map((i) => i.name), mismatch: total };
    save();
  }

  // 2. Pairs.
  const pairs = choosePairs(items, place);
  log(`${pairs.length} pairs`);
  n = 0;
  for (const [idx, p] of pairs.entries()) {
    const id = `${p.a.key}>${p.b.key}`;
    if (store.pairs[id] || !mine(idx)) continue;
    for (const it of [p.a, p.b])
      if (!store.itemRuns[it.key]) {
        const r0 = finalOf(it, 0, place.village, 0);
        const r1 = finalOf(it, 0, place.village, 1);
        const rb = finalOf(it, B_AT, place.village, 0);
        const f0 = features(r0.run, ctrl);
        const f1 = features(r1.run, ctrl);
        const fb = features(rb.run, ctrl);
        store.itemRuns[it.key] = { F0: f0.F, F1: f1.F, FB: fb.F, produced: [...new Set([...f0.produced, ...f1.produced, ...fb.produced])] };
      }
    const A = finalOf(p.a, 0, place.village);
    const B = finalOf(p.b, B_AT, place.village);
    const both = runCasts([
      { item: p.a, at: 0, ...place.village },
      { item: p.b, at: B_AT, ...place.village },
    ]);
    const known = new Set([...store.itemRuns[p.a.key].produced, ...store.itemRuns[p.b.key].produced]);
    const fresh: Record<string, number> = {};
    const g = both.final;
    for (let i = 0; i < g.fire.length; i++)
      for (const l of LAYERS) {
        const name = `${l}:${NAMES[g[l][i]]}`;
        if (!known.has(name) && !LIFE.has(name) && !natural(ctrl, l, i, g[l][i])) fresh[name] = (fresh[name] ?? 0) + 1;
      }
    const ma = changedMask(A.snap, ctrl);
    const mb = changedMask(B.snap, ctrl);
    let overlap = 0;
    for (let i = 0; i < ma.length; i++) if (ma[i] && mb[i]) overlap++;
    store.pairs[id] = { a: p.a.key, b: p.b.key, why: p.why, F: features(both, ctrl).F, fresh, overlap };
    if (++n % 10 === 0) {
      log(`pairs ${Object.keys(store.pairs).length}`);
      save();
    }
  }
  save();
  if (PHASE === "pairs" || SHARDS > 1) return;
  report(lib, items, byKey, pairs, place);
}

// --- Which pairs ---------------------------------------------------------------

interface Pair {
  a: Item;
  b: Item;
  why: string;
}

// Pairs a player would expect something from, by their names: A then B.
const FIRE = /fire|flame|pyro|blaze|inferno|explosion|meteor|phoenix/i;
const WATER = /rain|deluge|tsunami|maelstrom|flood|part the sea|dead sea|moonlit lake|cursed water|fountain/i;
const COLD = /blizzard|glacier|black ice|frost|frozen|ymir/i;
const LIGHTNING = /thunder|storm|tempest|hurricane|hypercane/i;
const EXPECTED: { label: string; a: RegExp; b: RegExp }[] = [
  { label: "fire then water", a: FIRE, b: WATER },
  { label: "lava then water", a: /volcano|molten|obsidian/i, b: WATER },
  { label: "water then cold", a: WATER, b: COLD },
  { label: "water then lightning", a: WATER, b: LIGHTNING },
  { label: "a wall or ward then a flood", a: /barrier|bastion|ward|last stand|holy ground|golem/i, b: /deluge|tsunami|maelstrom|flood/i },
  { label: "a ward then fire", a: /barrier|bastion|fire ward|guardian|holy ground/i, b: FIRE },
  {
    label: "light on shadow",
    a: /night|shade|shadow|nightmare|oblivion|boogeyman|smoke|fog/i,
    b: /radiance|aurora|celestial lights|spirit lights|divine|wisp/i,
  },
  {
    label: "growth on ash",
    a: /^ash|wasteland|explosion|crater|extinction/i,
    b: /world seed|garden|breath of life|world tree|yggdrasil|^ent$|paradise|golden age/i,
  },
  { label: "fire on growth", a: /world tree|garden|^ent$|yggdrasil|world seed|paradise/i, b: FIRE },
  { label: "cold then fire", a: COLD, b: FIRE },
  { label: "wind on fire", a: FIRE, b: /hurricane|hypercane|breeze|superstorm|blast wave|sonic boom/i },
  { label: "a creature then its predator", a: /bird|dinosaur|human|unicorn|dwarf|familiar/i, b: /dragon|hunter|wild hunt|kraken|werewolf|serpent/i },
  {
    label: "undead then holy",
    a: /undead|lich|army of the dead|necromancer|barrow|dracolich|legion/i,
    b: /turn undead|consecrate|holy|hallowed|divine|purifying|saint|archangel/i,
  },
  {
    label: "healing on harm",
    a: /curse|blight|plague|death|extinction|doombringer|meteor/i,
    b: /heal|elixir|breath of life|remove curse|fountain of youth|salvation|reincarnation/i,
  },
  { label: "rain on desert", a: /desert|wasteland|dead sea|crater/i, b: /rain|deluge|garden|world seed/i },
  { label: "fire on a swamp", a: /swamp|marsh|bog/i, b: FIRE },
];

function choosePairs(items: Item[], place: ReturnType<typeof spots>): Pair[] {
  void place;
  const rnd = seeded(4120);
  const visible = items.filter((i) => !["nothing visible", "nothing lasting"].includes(store.singles[i.key].shape));
  const pool = visible.length > 20 ? visible : items;
  const groups = (f: (i: Item) => string) => {
    const g = new Map<string, Item[]>();
    for (const i of pool) g.set(f(i), [...(g.get(f(i)) ?? []), i]);
    return [...g.values()];
  };
  const byForm = groups((i) => i.form);
  const byTier = groups((i) => i.tier);
  const byShape = groups((i) => store.singles[i.key].shape);
  const pick = <T>(l: T[]) => l[Math.floor(rnd() * l.length)];
  const out: Pair[] = [];
  const seen = new Set<string>();
  for (let k = 0; out.length < PAIRS && k < PAIRS * 20; k++) {
    // A by kind, B by tier and shape in turn, so each stratum is drawn.
    const a = pick(byForm[k % byForm.length]);
    const b = pick(k % 2 ? byShape[Math.floor(k / 2) % byShape.length] : byTier[Math.floor(k / 2) % byTier.length]);
    const id = `${a.key}>${b.key}`;
    if (a === b || seen.has(id)) continue;
    seen.add(id);
    out.push({ a, b, why: "sample" });
  }
  // Expected: a few of each, the most cast items first among those with a visible effect.
  const sorted = [...pool].sort((x, y) => (y.casts ?? 0) - (x.casts ?? 0) || x.key.localeCompare(y.key));
  const want = 40;
  const per = Math.ceil(want / EXPECTED.length) + 1;
  const expected: Pair[] = [];
  for (let round = 0; round < per && expected.length < want; round++)
    for (const e of EXPECTED) {
      if (expected.length >= want) break;
      const as = sorted.filter((i) => e.a.test(i.name));
      const bs = sorted.filter((i) => e.b.test(i.name) && !e.a.test(i.name));
      const a = as[round];
      const b = bs[round];
      if (!a || !b || a === b) continue;
      const id = `${a.key}>${b.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      expected.push({ a, b, why: e.label });
    }
  return [...out, ...expected];
}

// --- The report ------------------------------------------------------------------

// Features in which B after A holds more or less than A alone plus B alone,
// beyond twice the two items' noise, a floor, and (for cells) the cells both
// changed alone, where B covering A explains any count. Then products neither
// makes alone, 5 cells at least.
function interaction(id: string): { features: { f: string; d: number }[]; fresh: Record<string, number>; systems: System[] } {
  const p = store.pairs[id];
  const A = store.itemRuns[p.a];
  const B = store.itemRuns[p.b];
  const out: { f: string; d: number }[] = [];
  const keys = new Set([...Object.keys(p.F), ...Object.keys(A.F0), ...Object.keys(B.FB), ...Object.keys(A.F1), ...Object.keys(B.F1)]);
  for (const f of keys) {
    const v = (x: Features) => x[f] ?? 0;
    const d = v(p.F) - v(A.F0) - v(B.FB);
    const noise = Math.abs(v(A.F1) - v(A.F0)) + Math.abs(v(B.F1) - v(B.F0));
    const sys = FEATURE_SYSTEM(f);
    const cover = sys === "materials" || sys === "fluids" || sys === "land" || sys === "temperature" ? p.overlap : 0;
    if (Math.abs(d) > 2 * noise + FEATURE_FLOOR(f) + cover) out.push({ f, d: Math.round(d) });
  }
  const fresh = Object.fromEntries(Object.entries(p.fresh).filter(([k, n]) => n >= 5 && !k.endsWith(":none")));
  const systems = new Set<System>(out.map((x) => FEATURE_SYSTEM(x.f)));
  for (const k of Object.keys(fresh)) systems.add(k.startsWith("fluid:") ? "fluids" : k.startsWith("gas:") ? "gas" : "materials");
  return { features: out.sort((x, y) => Math.abs(y.d) - Math.abs(x.d)), fresh, systems: SYSTEMS.filter((sy) => systems.has(sy)) };
}
function interacts(id: string): System[] {
  return interaction(id).systems;
}

const shapeNow = (key: string) => shapeOf(store.singles[key].effect);

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "-");

function report(lib: ReturnType<typeof library>, items: Item[], byKey: Map<string, Item>, pairs: Pair[], place: ReturnType<typeof spots>) {
  const out: Record<string, unknown> = {};
  const lines: string[] = [];
  const p = (s = "") => lines.push(s);
  const failed = items.filter((i) => store.singles[i.key].effect.errors.length || !store.singles[i.key].effect.started);
  p(`Library: ${lib.elements} elements in /api/admin/forms; ${items.length} live programs fetched by GET; ${failed.length} failed to run.`);
  out.library = {
    elements: lib.elements,
    fetched: items.length,
    failed: failed.map((i) => ({ name: i.name, error: store.singles[i.key].effect.errors[0] ?? "did not start" })),
  };
  out.spots = place;
  const ok = items.filter((i) => !failed.includes(i));

  // VARIED
  const count = (list: Item[], f: (i: Item) => string) => {
    const m = new Map<string, number>();
    for (const i of list) m.set(f(i), (m.get(f(i)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const shapes = count(ok, (i) => shapeNow(i.key));
  const top5 = shapes.slice(0, 5).reduce((s, [, v]) => s + v, 0);
  p(`\n1. VARIED: ${ok.length} programs that ran, ${shapes.length} of the ${SHAPES.length} shapes defined; the five commonest hold ${pct(top5, ok.length)}.`);
  for (const [s, v] of shapes) p(`  ${s.padEnd(26)} ${String(v).padStart(4)}  ${pct(v, ok.length)}`);
  const split = (f: (i: Item) => string, order?: string[]) => {
    const keys = order ?? [...new Set(ok.map(f))].sort();
    const table: Record<string, Record<string, number>> = {};
    for (const k of keys) {
      const sub = ok.filter((i) => f(i) === k);
      if (!sub.length) continue;
      table[k] = Object.fromEntries(count(sub, (i) => shapeNow(i.key)));
      const t5 = count(sub, (i) => shapeNow(i.key))
        .slice(0, 5)
        .reduce((s, [, v]) => s + v, 0);
      p(
        `  ${k.padEnd(12)} n=${String(sub.length).padStart(3)} top shape ${count(sub, (i) => shapeNow(i.key))[0][0]} ${pct(count(sub, (i) => shapeNow(i.key))[0][1], sub.length)}, five commonest ${pct(t5, sub.length)}`,
      );
    }
    return table;
  };
  p("  by kind:");
  const byForm = split((i) => i.form, ["spell", "creature", "object", "building", "settlement", "place", "land", "unsorted"]);
  p("  by tier:");
  const byTier = split((i) => i.tier, [...TIERS]);
  const lasting = ok.filter((i) => store.singles[i.key].effect.activeAtEnd).length;
  const oneSystem = ok.filter((i) => systemsTouched(store.singles[i.key].effect).length <= 1).length;
  const durations = ok.map((i) => store.singles[i.key].effect.lastActive).sort((a, b) => a - b);
  p(
    `  still changing at ${SECONDS} s: ${lasting} (${pct(lasting, ok.length)}); touch one engine system or none: ${oneSystem} (${pct(oneSystem, ok.length)}); median last change at ${durations[Math.floor(durations.length / 2)]} s`,
  );
  const sysCount = new Map<string, number>();
  for (const i of ok) for (const s of systemsTouched(store.singles[i.key].effect)) sysCount.set(s, (sysCount.get(s) ?? 0) + 1);
  p(
    `  systems touched: ${[...sysCount]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
  );
  const own = ok.filter((i) => Object.keys(store.singles[i.key].effect.mats).some((k) => !BUILTIN_MATERIALS.has(k.split(":")[1]))).length;
  p(`  place a material of their own: ${own} (${pct(own, ok.length)})`);

  const warders = ok.filter((i) => store.singles[i.key].trace.ward);
  const guards = warders.filter((i) => /ward|shield|barrier|bastion|guard|protect|sanctuar|holy|aegis|last stand|consecrat|hallowed|bless/i.test(i.name));
  p(
    `  raise a ward (w.ward at run time): ${warders.length} (${pct(warders.length, ok.length)}), of which ${guards.length} have a name about protection; the others: ${warders
      .filter((i) => !guards.includes(i))
      .slice(0, 16)
      .map((i) => i.name)
      .join(", ")}`,
  );
  out.wards = { warders: warders.map((i) => i.name), guards: guards.map((i) => i.name) };
  // Duplicates
  const vecs = ok.map((i) => ({ i, v: vectorOf(store.singles[i.key].effect) })).filter((x) => x.v.size);
  const parent = new Map<string, string>();
  const find = (k: string): string => (parent.get(k) === k || !parent.has(k) ? k : find(parent.get(k)!));
  let dupPairs = 0;
  const close: [string, string, number][] = [];
  for (let x = 0; x < vecs.length; x++)
    for (let y = x + 1; y < vecs.length; y++) {
      const c = cosine(vecs[x].v, vecs[y].v);
      if (c > 0.98) {
        dupPairs++;
        close.push([vecs[x].i.name, vecs[y].i.name, c]);
        parent.set(find(vecs[x].i.key), find(vecs[y].i.key));
      }
    }
  const clusters = new Map<string, string[]>();
  for (const { i } of vecs) clusters.set(find(i.key), [...(clusters.get(find(i.key)) ?? []), i.name]);
  const big = [...clusters.values()].filter((c) => c.length > 1).sort((a, b) => b.length - a.length);
  const inDup = big.reduce((s, c) => s + c.length, 0);
  p(
    `  near duplicates (cosine > 0.98 on the effect vector): ${dupPairs} pairs, ${big.length} clusters holding ${inDup} items (${pct(inDup, ok.length)}); largest ${big[0]?.length ?? 0}`,
  );
  for (const c of big.slice(0, 6)) p(`    ${c.length}: ${c.slice(0, 14).join(", ")}${c.length > 14 ? ", ..." : ""}`);
  out.varied = {
    shapes: Object.fromEntries(shapes),
    top5,
    n: ok.length,
    byForm,
    byTier,
    lasting,
    oneSystem,
    systems: Object.fromEntries(sysCount),
    own,
    dupPairs,
    clusters: big.slice(0, 10),
    nothingVisible: ok.filter((i) => ["nothing lasting", "only lights and particles"].includes(shapeNow(i.key))).map((i) => i.name),
  };

  // INTERACT
  const ids = pairs.map((x) => `${x.a.key}>${x.b.key}`).filter((id) => store.pairs[id]);
  const usable = ids.filter((id) => !failed.some((f) => f.key === store.pairs[id].a || f.key === store.pairs[id].b));
  const sample = usable.filter((id) => store.pairs[id].why === "sample");
  const expected = usable.filter((id) => store.pairs[id].why !== "sample");
  const inter = (list: string[]) => list.filter((id) => interacts(id).length);
  p(
    `\n2. INTERACT: ${sample.length} sampled pairs, ${inter(sample).length} interact (${pct(inter(sample).length, sample.length)}); expected by name: ${inter(expected).length} of ${expected.length}.`,
  );
  p(`  determinism: the same run twice on ${store.determinism.items.length} items differs by ${store.determinism.mismatch} cells or creatures in all.`);
  const noiseRows = Object.values(store.itemRuns).map((r) => {
    const t: Record<string, number> = Object.fromEntries(SYSTEMS.map((sy) => [sy, 0]));
    for (const k of new Set([...Object.keys(r.F0), ...Object.keys(r.F1)])) t[FEATURE_SYSTEM(k)] += Math.abs((r.F1[k] ?? 0) - (r.F0[k] ?? 0));
    return t;
  });
  const q = (list: number[], f: number) => [...list].sort((x, y) => x - y)[Math.min(list.length - 1, Math.floor(f * list.length))] ?? 0;
  const noise = Object.fromEntries(
    SYSTEMS.map((sy) => [
      sy,
      {
        median: Math.round(
          q(
            noiseRows.map((r) => r[sy]),
            0.5,
          ),
        ),
        p95: Math.round(
          q(
            noiseRows.map((r) => r[sy]),
            0.95,
          ),
        ),
      },
    ]),
  );
  p(
    `  noise (the same item on another random stream, ${noiseRows.length} items; summed count differences), median / 95th percentile: ${SYSTEMS.map((sy) => `${sy} ${noise[sy].median}/${noise[sy].p95}`).join(", ")}`,
  );
  p(
    "  a pair interacts in a count (cells of a material, of a fluid, on fire, hotter, colder, raised, lowered, creatures by kind and state, voxels, wards) when B after A differs from A alone plus B alone by more than twice the two items' noise in that count, a floor, and the cells both change alone; or when it makes 5 cells or more of something neither makes alone.",
  );
  const overlaps = sample.map((id) => store.pairs[id].overlap);
  p(`  cells both items change alone, median ${q(overlaps, 0.5)}, 95th percentile ${q(overlaps, 0.95)}`);
  const bySys = new Map<string, number>();
  for (const id of inter(sample)) for (const s of interacts(id)) bySys.set(s, (bySys.get(s) ?? 0) + 1);
  p(
    `  by system (a pair may count in several): ${[...bySys]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v} (${pct(v, sample.length)})`)
      .join(", ")}`,
  );
  const withFresh = sample.filter((id) => Object.keys(interaction(id).fresh).length);
  const creatureOnly = inter(sample).filter((id) => interacts(id).every((sy) => sy === "creatures"));
  const smallCreatureOnly = creatureOnly.filter((id) => interaction(id).features.every((x) => Math.abs(x.d) < 5));
  p(
    `  of these: ${withFresh.length} make something neither makes alone (${pct(withFresh.length, sample.length)}); ${creatureOnly.length} differ only in creatures (${pct(creatureOnly.length, sample.length)}), ${smallCreatureOnly.length} of them by fewer than 5 creatures each. Without those ${smallCreatureOnly.length}: ${inter(sample).length - smallCreatureOnly.length} (${pct(inter(sample).length - smallCreatureOnly.length, sample.length)}).`,
  );
  const freshNames = new Map<string, number>();
  for (const id of [...sample, ...expected]) for (const k of Object.keys(interaction(id).fresh)) freshNames.set(k, (freshNames.get(k) ?? 0) + 1);
  p(
    `  what pairs make that neither makes alone (pairs): ${[...freshNames]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 12)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
  );
  const interBy = (f: (i: Item) => string) => {
    const m = new Map<string, [number, number]>();
    for (const id of sample) {
      const k = f(byKey.get(store.pairs[id].a)!);
      const v = m.get(k) ?? [0, 0];
      v[0]++;
      if (interacts(id).length) v[1]++;
      m.set(k, v);
    }
    return Object.fromEntries([...m].map(([k, [n, i]]) => [k, { n, interact: i }]));
  };
  const interByForm = interBy((i) => i.form);
  const interByTier = interBy((i) => i.tier);
  const interByShapeB = (() => {
    const m = new Map<string, [number, number]>();
    for (const id of sample) {
      const k = shapeNow(store.pairs[id].b);
      const v = m.get(k) ?? [0, 0];
      v[0]++;
      if (interacts(id).length) v[1]++;
      m.set(k, v);
    }
    return Object.fromEntries([...m].map(([k, [n, i]]) => [k, { n, interact: i }]));
  })();
  p(
    `  by A's kind: ${Object.entries(interByForm)
      .map(([k, v]) => `${k} ${v.interact}/${v.n}`)
      .join(", ")}`,
  );
  p(
    `  by A's tier: ${Object.entries(interByTier)
      .map(([k, v]) => `${k} ${v.interact}/${v.n}`)
      .join(", ")}`,
  );
  p(
    `  by B's shape: ${Object.entries(interByShapeB)
      .map(([k, v]) => `${k} ${v.interact}/${v.n}`)
      .join(", ")}`,
  );
  const label = (f: string) =>
    f
      .replace(/^mat:(ground|cover):/, "")
      .replace(/^(fluid|gas|born):/, "")
      .replace(/^own:/, "");
  const describe = (id: string) => {
    const x = interaction(id);
    const parts = [
      ...Object.entries(x.fresh).map(([k, n]) => `new ${label(k.replace(/^(ground|cover|fluid|gas):/, ""))} ${n} cells`),
      ...x.features.slice(0, 4).map((y) => `${label(y.f)} ${y.d > 0 ? "+" : ""}${y.d}`),
    ];
    if (x.systems.length) return `interacts through ${x.systems.join(", ")}: ${parts.join(", ")}`;
    const pr = store.pairs[id];
    const top = Object.entries(store.itemRuns[pr.b].FB)
      .filter(([k]) => !["life", "hp", "volume"].includes(k))
      .sort((u, v) => Math.abs(v[1]) - Math.abs(u[1]))
      .slice(0, 3)
      .map(([k, v]) => `${label(k)} ${v > 0 ? "+" : ""}${Math.round(v)}`)
      .join(", ");
    return `no interaction beyond noise (B alone: ${top || "nothing measured"}; cells both change: ${pr.overlap})`;
  };
  p("  expected pairs:");
  for (const id of expected)
    p(`    [${store.pairs[id].why}] ${byKey.get(store.pairs[id].a)!.name} then ${byKey.get(store.pairs[id].b)!.name}: ${describe(id)}`);
  out.interact = {
    noise,
    withFresh: withFresh.length,
    creatureOnly: creatureOnly.length,
    smallCreatureOnly: smallCreatureOnly.length,
    freshNames: Object.fromEntries(freshNames),
    sample: sample.length,
    sampleInteract: inter(sample).length,
    expected: expected.length,
    expectedInteract: inter(expected).length,
    bySystem: Object.fromEntries(bySys),
    interByForm,
    interByTier,
    interByShapeB,
    expectedList: expected.map((id) => ({
      why: store.pairs[id].why,
      a: byKey.get(store.pairs[id].a)!.name,
      b: byKey.get(store.pairs[id].b)!.name,
      systems: interacts(id),
      line: describe(id),
    })),
    sampleList: sample.map((id) => ({
      a: byKey.get(store.pairs[id].a)!.name,
      b: byKey.get(store.pairs[id].b)!.name,
      systems: interacts(id),
      line: describe(id),
    })),
  };

  // SMART
  const st = ok.map((i) => ({ i, s: statics(i.code) }));
  const readsAny = st.filter((x) => Object.keys(x.s.reads).length).length;
  const branchesAny = st.filter((x) => x.s.branches > 0).length;
  const readCalls: Record<string, number> = {};
  for (const x of st) for (const k of Object.keys(x.s.reads)) readCalls[k] = (readCalls[k] ?? 0) + 1;
  const actions = (t: Record<string, number>) => Object.keys(t).filter((k) => !READS.has(k.replace(/^c\./, "")) && !HELPERS.has(k.split(":")[0]));
  // What changes the island, apart from sounds, lights and drawings.
  const VISUAL = new Set([
    "sound",
    "particle",
    "burst",
    "flash",
    "light",
    "body",
    "beam",
    "shockwave",
    "shake",
    "camera",
    "cameraBack",
    "darken",
    "tint",
    "circle",
    "ring",
    "draw",
    "line",
    "explode-visual",
  ]);
  const deeds = (t: Record<string, number>) => actions(t).filter((k) => !VISUAL.has(k.split(":")[0]) && !k.startsWith("c."));
  const onCreatures = (t: Record<string, number>) =>
    Object.keys(t).filter((k) => k.startsWith("c.") && !READS.has(k.slice(2)) && !["c.x", "c.y", "c.kind"].includes(k));
  const sameSet = (sets: Set<string>[]) => sets.every((s) => s.size === sets[0].size && [...s].every((k) => sets[0].has(k)));
  const kindAdapt: string[] = [];
  const whoAdapt: string[] = [];
  const amountAdapt: string[] = [];
  const same: string[] = [];
  const readsAtRun: string[] = [];
  for (const i of ok) {
    const t = store.spots[i.key];
    const where = ["village", "water", "rock"].map((w) => t[w] ?? {});
    if (Object.keys(t.village).some((k) => READS.has(k))) readsAtRun.push(i.name);
    if (!sameSet(where.map((x) => new Set(deeds(x))))) {
      kindAdapt.push(i.name);
      continue;
    }
    if (!sameSet(where.map((x) => new Set(onCreatures(x))))) {
      whoAdapt.push(i.name);
      continue;
    }
    const counts = where.map((x) => [...deeds(x), ...onCreatures(x)].reduce((s, k) => s + x[k], 0));
    const lo = Math.min(...counts);
    const hi = Math.max(...counts);
    if (hi > lo * 1.2 + 2) amountAdapt.push(i.name);
    else same.push(i.name);
  }
  const shapeMoves = ok.filter((i) => new Set(Object.values(store.spotShapes[i.key])).size > 1).length;
  p(
    `\n3. SMART: ${ok.length} programs. Static: ${readsAny} call a reading function (${pct(readsAny, ok.length)}), ${branchesAny} branch on what they read (${pct(branchesAny, ok.length)}).`,
  );
  p(
    `  reading calls by program: ${Object.entries(readCalls)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
  );
  p(`  at run time at the village: ${readsAtRun.length} asked the island something (${pct(readsAtRun.length, ok.length)}).`);
  p(
    `  on water, village and rock: ${kindAdapt.length} change the island in different ways (${pct(kindAdapt.length, ok.length)}), ${whoAdapt.length} differ only in what they do to the creatures they find (${pct(whoAdapt.length, ok.length)}), ${amountAdapt.length} the same things in other amounts (${pct(amountAdapt.length, ok.length)}), ${same.length} act the same (${pct(same.length, ok.length)}).`,
  );
  p(`  shape changes with the spot (engine and program together): ${shapeMoves} (${pct(shapeMoves, ok.length)})`);
  p(`  adapt in kind, e.g.: ${kindAdapt.slice(0, 10).join(", ")}`);
  p(`  only what they do to the creatures they find, e.g.: ${whoAdapt.slice(0, 10).join(", ")}`);
  p(`  act the same, e.g.: ${same.slice(0, 10).join(", ")}`);
  out.smart = { n: ok.length, readsAny, branchesAny, readCalls, readsAtRun: readsAtRun.length, kindAdapt, whoAdapt, amountAdapt, same, shapeMoves };

  // Cost
  const lm = liveModels();
  p(
    `\nModels of live programs (from /api/spell/info, ${lm.live} elements with a live program): ${Object.entries(lm.models)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
  );
  p(
    `Versions: ${Object.entries(lm.versions)
      .sort()
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
  );
  p(`Never cast (casts = 0 in /api/admin/forms): ${lib.neverCast} of ${lib.elements}`);
  const fetchedModels = count(items, (i) => i.model ?? "unknown");
  p(
    `Fetched programs by model: ${fetchedModels.map(([k, v]) => `${k} ${v}`).join(", ")}; by source: ${count(items, (i) => i.source)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
  );
  out.cost = {
    ...lm,
    neverCast: lib.neverCast,
    elements: lib.elements,
    fetchedModels: Object.fromEntries(fetchedModels),
    sources: Object.fromEntries(count(items, (i) => i.source)),
    formsAll: lib.formCounts,
    fetchedForms: Object.fromEntries(count(items, (i) => i.form)),
    fetchedTiers: Object.fromEntries(count(items, (i) => i.tier)),
  };
  out.items = items.map((i) => ({
    name: i.name,
    form: i.form,
    tier: i.tier,
    shape: shapeNow(i.key),
    systems: systemsTouched(store.singles[i.key].effect),
    effect: store.singles[i.key].effect,
    spotShapes: store.spotShapes[i.key],
    static: statics(i.code),
  }));
  // Films: 6 pairs that interact the most, 8 expected pairs that do not, 6 near duplicates.
  const beyond = (id: string) => {
    const x = interaction(id);
    return x.systems.length * 10 + Object.values(x.fresh).reduce((t, n) => t + Math.log1p(n), 0) + x.features.length;
  };
  const used = new Set<string>();
  const fresh = (a: string, b: string) => !used.has(a) && !used.has(b);
  const films: { n: number; mode: "pair" | "dup"; label: string; line: string; a: Item; b: Item }[] = [];
  const addFilm = (mode: "pair" | "dup", label: string, a: Item, b: Item, line: string) => {
    used.add(a.key);
    used.add(b.key);
    films.push({ n: films.length + 1, mode, label, line, a, b });
  };
  for (const id of [...usable].filter((x) => interacts(x).length).sort((x, y) => beyond(y) - beyond(x))) {
    if (films.length >= 6) break;
    const x = store.pairs[id];
    if (fresh(x.a, x.b)) addFilm("pair", `interacts (${x.why})`, byKey.get(x.a)!, byKey.get(x.b)!, describe(id));
  }
  for (const id of expected.filter((x) => !interacts(x).length)) {
    if (films.length >= 14) break;
    const x = store.pairs[id];
    if (fresh(x.a, x.b) && !films.some((f) => f.label === `expected, no interaction (${x.why})`))
      addFilm("pair", `expected, no interaction (${x.why})`, byKey.get(x.a)!, byKey.get(x.b)!, describe(id));
  }
  for (const id of expected.filter((x) => !interacts(x).length)) {
    if (films.length >= 14) break;
    const x = store.pairs[id];
    if (fresh(x.a, x.b)) addFilm("pair", `expected, no interaction (${x.why})`, byKey.get(x.a)!, byKey.get(x.b)!, describe(id));
  }
  const byName = new Map(items.map((i) => [i.name, i]));
  for (const [a, b, c] of close.sort((x, y) => y[2] - x[2])) {
    if (films.length >= 20) break;
    const A = byName.get(a)!;
    const B = byName.get(b)!;
    if (fresh(A.key, B.key)) addFilm("dup", `near duplicates, cosine ${c.toFixed(3)}`, A, B, `${shapeNow(A.key)} / ${shapeNow(B.key)}`);
  }
  writeFileSync(
    `${OUT}/films.json`,
    JSON.stringify(
      films.map((f) => ({
        ...f,
        a: { name: f.a.name, tier: f.a.tier, form: f.a.form, kind: f.a.kind, code: f.a.code },
        b: { name: f.b.name, tier: f.b.tier, form: f.b.form, kind: f.b.kind, code: f.b.code },
      })),
    ),
  );
  out.films = films.map((f) => ({ n: f.n, label: f.label, a: f.a.name, b: f.b.name, line: f.line }));
  p("\nFilms:");
  for (const f of films) p(`  ${f.n}. ${f.label}: ${f.a.name} / ${f.b.name}: ${f.line}`);
  writeFileSync(`${OUT}/report.json`, JSON.stringify(out, null, 1));
  console.log(lines.join("\n"));
}

main();
