// Looks revamp, phase 0 (docs/measurements/looks-2026-11-13.md): how detailed
// items look today. Read only. It reads the live library through routes that
// write nothing, runs each program in the game's own Runtime on the test run's
// practice island (as scripts/spell-measure.ts does), collects what it draws
// (w.model props, src/sim/props.ts; creature models, src/sim/body.ts) and
// measures it. Nothing is sent anywhere, nothing is written to production.
//
//   MM_URL=... MM_TOKEN=... npx tsx scripts/look-measure.ts --fetch /tmp/look-measure/cache
//   npx tsx scripts/look-measure.ts --cache /tmp/look-measure/cache --out docs/measurements
//
// The fetch step (read only, admin token in MM_TOKEN):
//   GET  /api/admin/forms                       every element, its kind and form (no code)
//   GET  /api/admin/programs?limit=100          live programs not judged yet, with code (SELECT)
//   GET  /api/admin/programs?limit=100&creatures=1
//   GET  /api/admin/challenge-candidates?limit=60
//   GET  /api/wonders                           the daily wonders' pool (public, SELECT)
//   POST /api/library {names}                   20 names at a time, one SELECT (handleLibrary), spells only
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { elementKey } from "../shared/elements";
import { isTier, REFERENCE_SIDE, type Tier } from "../shared/tiers";
import { resetArtifactIds } from "../src/sim/artifacts";
import { populate, resetCreatureIds } from "../src/sim/creatures";
import { C } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { modelOf } from "../src/sim/body";
import { MAX_PROP_BOXES, readBox, type PropBox } from "../src/sim/props";
import { Runtime, SpellApi, type CastRequest } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { TICK, generateWorld } from "../src/sim/world";
import { DEF_TIER, defRequest, readDef } from "../src/sim/wonders";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const FETCH = arg("--fetch", "");
const CACHE = arg("--cache", FETCH || "/tmp/look-measure/cache");
const OUT = arg("--out", "docs/measurements");
const SECONDS = Number(arg("--seconds", "30"));
const LIMIT = Number(arg("--limit", "0"));
const SHARD = arg("--shard", "0/1").split("/").map(Number);
const STAMP = "2026-11-13";
const SEED = 11;
const SIZE = REFERENCE_SIDE;
const PER_SECOND = Math.round(1 / TICK);

// --- Fetch (read only) --------------------------------------------------------

async function fetchAll(dir: string) {
  const base = process.env.MM_URL;
  const token = process.env.MM_TOKEN;
  if (!base || !token) throw new Error("Set MM_URL and MM_TOKEN to fetch.");
  mkdirSync(dir, { recursive: true });
  const get = async (path: string, init?: RequestInit) => {
    for (let a = 0; a < 3; a++) {
      const r = await fetch(new URL(path, base), { ...init, headers: { "content-type": "application/json", "x-access-token": token } });
      if (r.ok) return (await r.json()) as unknown;
      await new Promise((s) => setTimeout(s, 1500));
    }
    throw new Error(`${path} failed`);
  };
  const save = (f: string, v: unknown) => writeFileSync(`${dir}/${f}`, JSON.stringify(v));
  const forms = (await get("/api/admin/forms")) as { rows: { name: string }[] };
  save("forms.json", forms);
  save("programs.json", await get("/api/admin/programs?limit=100"));
  save("programs-creatures.json", await get("/api/admin/programs?limit=100&creatures=1"));
  save("challenge-candidates.json", await get("/api/admin/challenge-candidates?limit=60"));
  save("wonders.json", await get("/api/wonders"));
  const have = new Set<string>();
  for (const f of ["programs", "programs-creatures", "challenge-candidates"])
    for (const r of JSON.parse(readFileSync(`${dir}/${f}.json`, "utf8")) as { name: string }[]) have.add(elementKey(r.name));
  const miss = forms.rows.map((r) => r.name).filter((n) => !have.has(elementKey(n)));
  const spells: unknown[] = [];
  for (let k = 0; k < miss.length; k += 20) {
    const r = (await get("/api/library", { method: "POST", body: JSON.stringify({ names: miss.slice(k, k + 20) }) })) as { spells: unknown[] };
    spells.push(...r.spells);
  }
  save("library.json", { spells });
  console.log(`forms ${forms.rows.length}, asked /api/library for ${miss.length}, got ${spells.length}`);
}

// --- The library, from the cache ------------------------------------------------

interface Item {
  key: string;
  name: string;
  kind: string; // element kind: spell, artifact or wonder
  form: string; // one of the seven kinds, or wonder
  tier: Tier;
  code: string;
  source: string;
  reach?: number;
}
const readJson = <T>(file: string): T => JSON.parse(readFileSync(`${CACHE}/${file}`, "utf8")) as T;

function library() {
  const forms = readJson<{ rows: { key: string; name: string; kind: string; form: string }[] }>("forms.json");
  const byKey = new Map(forms.rows.map((r) => [r.key, r]));
  const got = new Map<string, Item>();
  const add = (r: { name: string; kind?: string; tier: string; code: string }, source: string) => {
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
      source,
    });
  };
  for (const f of ["programs", "programs-creatures", "challenge-candidates"])
    for (const r of readJson<{ name: string; kind?: string; tier: string; code: string }[]>(`${f}.json`)) add(r, f);
  if (existsSync(`${CACHE}/library.json`))
    for (const r of readJson<{ spells: { name: string; tier: string; code: string }[] }>("library.json").spells) add(r, "library");
  const items = [...got.values()].sort((a, b) => a.key.localeCompare(b.key));
  // The daily wonders written as programs (the pool new islands draw from).
  const wonders: Item[] = [];
  if (existsSync(`${CACHE}/wonders.json`))
    for (const raw of readJson<{ wonders: unknown[] }>("wonders.json").wonders) {
      const def = readDef(raw);
      if (!def) continue;
      const req = defRequest(def);
      wonders.push({
        key: req.key,
        name: `${def.kind} (wonder)`,
        kind: "wonder",
        form: "wonder",
        tier: DEF_TIER[def.rarity],
        code: def.code,
        source: "wonders",
        reach: def.reach,
      });
    }
  const missing = forms.rows.filter((r) => !got.has(r.key));
  return { items, wonders, elements: forms.rows, missing };
}

// --- What a program draws --------------------------------------------------------

interface Box {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: number;
  glow: boolean;
}
interface Drawn {
  models: Box[][];
  creatureModels: Box[][];
  creatureKinds: number;
  creaturePlans: number;
  artifactsDeclared: number;
  calls: number;
  errors: string[];
  started: boolean;
}
let current: Drawn | null = null;
const seen = new Set<string>();

// w.model: keep each distinct model as given.
const origModel = SpellApi.prototype.model;
SpellApi.prototype.model = function (this: SpellApi, ...a: Parameters<typeof origModel>) {
  const r = origModel.apply(this, a);
  if (current) {
    current.calls++;
    // The boxes as the program gave them (readBox, before the island shades each part a little: shading would make every box its own colour).
    const given = Array.isArray(a[2]) ? a[2] : [];
    const boxes = given
      .map(readBox)
      .filter((b): b is PropBox => b !== null)
      .slice(0, MAX_PROP_BOXES);
    if (r && boxes.length) {
      const sig = JSON.stringify(boxes.map((b) => [b.x, b.y, b.z, b.w, b.d, b.h, b.color, b.glow]));
      if (!seen.has(sig) && current.models.length < 60) {
        seen.add(sig);
        current.models.push(boxes);
      }
    }
  }
  return r;
} as typeof origModel;

// The creatures a program declares: their raw model boxes (body.ts modelOf), before bodyFrom turns a still model into a plan.
const origRules = Runtime.prototype.defineRules;
Runtime.prototype.defineRules = function (this: Runtime, req: CastRequest, spell: Parameters<typeof origRules>[1]) {
  if (current) {
    const s = spell as unknown as { creatures?: unknown[]; artifacts?: unknown[] };
    current.artifactsDeclared += Array.isArray(s.artifacts) ? s.artifacts.length : 0;
    for (const raw of Array.isArray(s.creatures) ? s.creatures : []) {
      const k = raw as Record<string, unknown>;
      if (!k || typeof k.name !== "string") continue;
      current.creatureKinds++;
      const m = modelOf(k.model);
      if (m) current.creatureModels.push(m.map((b) => ({ x: b.x, y: b.y, z: b.z, w: b.w, d: b.d, h: b.h, color: b.color, glow: b.part === "glow" })));
      else if (typeof k.body === "string" || Array.isArray(k.features)) current.creaturePlans++;
    }
  }
  return origRules.call(this, req, spell);
};

// --- The practice island (src/sim/check.ts island, as spell-measure.ts) -----------

function island() {
  Math.random = seeded(SEED);
  resetCreatureIds();
  resetArtifactIds();
  const world = generateWorld(SIZE, SIZE, SEED);
  populate(world);
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
  return { world, rt, errors, life, target, random: seeded(SEED + 1), spell: seeded(SEED + 7) };
}

function run(item: Item): Drawn {
  const outer = Math.random;
  const isl = island();
  const d: Drawn = { models: [], creatureModels: [], creatureKinds: 0, creaturePlans: 0, artifactsDeclared: 0, calls: 0, errors: isl.errors, started: false };
  current = d;
  seen.clear();
  Math.random = isl.random;
  const step = isl.rt.step.bind(isl.rt);
  isl.rt.step = (dt: number) => {
    const was = Math.random;
    Math.random = isl.spell;
    try {
      step(dt);
    } finally {
      Math.random = was;
    }
  };
  try {
    const req: CastRequest = {
      key: `m0:${item.key}`,
      name: item.name,
      tier: item.tier,
      code: item.code,
      form: item.form,
      kind: item.kind === "spell" ? "spell" : "artifact",
      ...(item.reach ? { reach: item.reach } : {}),
    };
    const was = Math.random;
    Math.random = isl.spell;
    try {
      d.started = isl.rt.cast(req, isl.target.x, isl.target.y);
    } finally {
      Math.random = was;
    }
    for (let s = 0; s < SECONDS * PER_SECOND; s++) stepHeadless(isl.world, isl.rt, { life: isl.life });
  } finally {
    Math.random = outer;
    current = null;
  }
  d.errors = isl.errors.slice(0, 3);
  return d;
}

// --- Measures ---------------------------------------------------------------------

const FINE_SIDE = 0.3;
const GRID = 24;

// Cells filled in the outline of the boxes seen from one side, over the bounding box.
function silhouette(boxes: Box[]): { score: number; fill: number } {
  if (!boxes.length) return { score: 0, fill: 0 };
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    const a = [b.x, b.y, b.z];
    const s = [b.w, b.d, b.h];
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], a[k]);
      hi[k] = Math.max(hi[k], a[k] + s[k]);
    }
  }
  const views: [number, number][] = [
    [0, 2], // front: x across, z up
    [1, 2], // side: y across, z up
    [0, 1], // top: x across, y down
  ];
  let score = 0;
  let fill = 0;
  const perimeter = 4 * GRID - 4;
  for (const [u, v] of views) {
    const grid = new Uint8Array(GRID * GRID);
    const du = hi[u] - lo[u] || 1;
    const dv = hi[v] - lo[v] || 1;
    for (const b of boxes) {
      const a = [b.x, b.y, b.z];
      const s = [b.w, b.d, b.h];
      const u0 = Math.floor(((a[u] - lo[u]) / du) * GRID);
      const u1 = Math.ceil(((a[u] + s[u] - lo[u]) / du) * GRID);
      const v0 = Math.floor(((a[v] - lo[v]) / dv) * GRID);
      const v1 = Math.ceil(((a[v] + s[v] - lo[v]) / dv) * GRID);
      for (let j = Math.max(0, v0); j < Math.min(GRID, v1); j++) for (let i = Math.max(0, u0); i < Math.min(GRID, u1); i++) grid[j * GRID + i] = 1;
    }
    let filled = 0;
    let edge = 0;
    for (let j = 0; j < GRID; j++)
      for (let i = 0; i < GRID; i++) {
        if (!grid[j * GRID + i]) continue;
        filled++;
        const open = (a: number, b: number) => a < 0 || b < 0 || a >= GRID || b >= GRID || !grid[b * GRID + a];
        if (open(i - 1, j) || open(i + 1, j) || open(i, j - 1) || open(i, j + 1)) edge++;
      }
    // A full rectangle has the outline of the grid's edge (92 cells): no detail, score 0. Three times that is 1.
    score += Math.max(0, Math.min(1, (edge - perimeter) / (2 * perimeter)));
    fill += filled / (GRID * GRID);
  }
  return { score: score / 3, fill: fill / 3 };
}

interface Measure {
  key: string;
  name: string;
  kind: string;
  form: string;
  tier: string;
  source: string;
  started: boolean;
  models: number;
  creatureModels: number;
  creatureKinds: number;
  creaturePlans: number;
  artifactsDeclared: number;
  boxes: number;
  boxesPerModel: number;
  mainBoxes: number;
  fine: number;
  thin: number;
  colours: number;
  glowShare: number;
  silhouette: number;
  fill: number;
  noModel: boolean;
  noLook: boolean;
  errors: string[];
}

function measure(item: Item, d: Drawn): Measure {
  const all = [...d.models, ...d.creatureModels];
  const flat = all.flat();
  const main = all.reduce<Box[]>((best, m) => (m.length > best.length ? m : best), []);
  const sil = silhouette(main);
  const colours = new Set(flat.map((b) => b.color)).size;
  const noModel = all.length === 0;
  return {
    key: item.key,
    name: item.name,
    kind: item.kind,
    form: item.form,
    tier: item.tier,
    source: item.source,
    started: d.started,
    models: d.models.length,
    creatureModels: d.creatureModels.length,
    creatureKinds: d.creatureKinds,
    creaturePlans: d.creaturePlans,
    artifactsDeclared: d.artifactsDeclared,
    boxes: flat.length,
    boxesPerModel: all.length ? Math.round((flat.length / all.length) * 10) / 10 : 0,
    mainBoxes: main.length,
    fine: flat.filter((b) => Math.max(b.w, b.d, b.h) < FINE_SIDE).length,
    thin: flat.filter((b) => Math.min(b.w, b.d, b.h) < FINE_SIDE).length,
    colours,
    glowShare: flat.length ? Math.round((flat.filter((b) => b.glow).length / flat.length) * 1000) / 1000 : 0,
    silhouette: Math.round(sil.score * 1000) / 1000,
    fill: Math.round(sil.fill * 1000) / 1000,
    noModel,
    // No look at all: no model, no creature of its own, no object it declares.
    noLook: noModel && d.creatureKinds === 0 && d.artifactsDeclared === 0,
    errors: d.errors,
  };
}

// --- Report -------------------------------------------------------------------------

const pct = (a: number[], p: number) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};
const r1 = (n: number) => (Number.isNaN(n) ? "-" : String(Math.round(n * 10) / 10));
const r2 = (n: number) => (Number.isNaN(n) ? "-" : String(Math.round(n * 100) / 100));
const share = (n: number, of: number) => (of ? `${Math.round((n / of) * 1000) / 10}%` : "-");
const group = <T>(list: T[], f: (t: T) => string) => {
  const m = new Map<string, T[]>();
  for (const t of list) m.set(f(t), [...(m.get(f(t)) ?? []), t]);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
};
const TIER_ORDER = ["trivial", "minor", "major", "grand", "legendary", "cosmic"];

function table(rows: Measure[], by: (m: Measure) => string, order?: string[]) {
  const g = group(rows, by);
  if (order) g.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  const out = [
    "| group | items | with a model | no look | boxes/model p50 (p10, p90) | total parts p50 (p10, p90) | fine parts p50 | colours p50 (p10, p90) | glow share p50 | silhouette p50 (p10, p90) |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const [name, list] of g) {
    const drawn = list.filter((m) => !m.noModel);
    const bpm = drawn.map((m) => m.boxesPerModel);
    const tot = list.map((m) => m.boxes);
    const col = drawn.map((m) => m.colours);
    const sil = drawn.map((m) => m.silhouette);
    out.push(
      `| ${name} | ${list.length} | ${share(drawn.length, list.length)} | ${share(list.filter((m) => m.noLook).length, list.length)} | ${r1(pct(bpm, 0.5))} (${r1(pct(bpm, 0.1))}, ${r1(pct(bpm, 0.9))}) | ${r1(pct(tot, 0.5))} (${r1(pct(tot, 0.1))}, ${r1(pct(tot, 0.9))}) | ${r1(
        pct(
          drawn.map((m) => m.fine),
          0.5,
        ),
      )} | ${r1(pct(col, 0.5))} (${r1(pct(col, 0.1))}, ${r1(pct(col, 0.9))}) | ${r2(
        pct(
          drawn.map((m) => m.glowShare),
          0.5,
        ),
      )} | ${r2(pct(sil, 0.5))} (${r2(pct(sil, 0.1))}, ${r2(pct(sil, 0.9))}) |`,
    );
  }
  return out.join("\n");
}

function plainest(rows: Measure[], n: number) {
  // Plainest first: fewest parts, then fewest colours, then the flattest outline.
  return [...rows].sort((a, b) => a.boxes - b.boxes || a.colours - b.colours || a.silhouette - b.silhouette || a.key.localeCompare(b.key)).slice(0, n);
}

function summary(rows: Measure[]) {
  const drawn = rows.filter((m) => !m.noModel);
  const stat = (name: string, a: number[]) => ({ name, p10: pct(a, 0.1), p50: pct(a, 0.5), p90: pct(a, 0.9) });
  return {
    items: rows.length,
    withModel: drawn.length,
    noModel: rows.length - drawn.length,
    noLook: rows.filter((m) => m.noLook).length,
    under10Parts: rows.filter((m) => m.boxes < 10).length,
    under10PartsOfDrawn: drawn.filter((m) => m.boxes < 10).length,
    singleColour: drawn.filter((m) => m.colours <= 1).length,
    threeColoursOrFewer: drawn.filter((m) => m.colours <= 3).length,
    singleBox: drawn.filter((m) => m.boxes === 1).length,
    noFineParts: drawn.filter((m) => m.fine === 0).length,
    noGlow: drawn.filter((m) => m.glowShare === 0).length,
    boxesPerModel: stat(
      "boxesPerModel",
      drawn.map((m) => m.boxesPerModel),
    ),
    parts: stat(
      "parts",
      rows.map((m) => m.boxes),
    ),
    colours: stat(
      "colours",
      drawn.map((m) => m.colours),
    ),
    silhouette: stat(
      "silhouette",
      drawn.map((m) => m.silhouette),
    ),
  };
}

function main() {
  const lib = library();
  const all = [...lib.items, ...lib.wonders];
  const list = LIMIT ? all.slice(0, LIMIT) : all;
  if (arg("--merge", "")) return report(lib, list, Number(arg("--merge", "1")));
  const mine = list.filter((_, i) => i % SHARD[1] === SHARD[0]);
  mkdirSync("/tmp/look-measure", { recursive: true });
  const partFile = `/tmp/look-measure/part-${SHARD[0]}-of-${SHARD[1]}.json`;
  const done: Record<string, Measure> = existsSync(partFile) ? JSON.parse(readFileSync(partFile, "utf8")) : {};
  let n = 0;
  for (const it of mine) {
    if (done[it.key]) continue;
    try {
      done[it.key] = measure(it, run(it));
    } catch (e) {
      done[it.key] = {
        ...measure(it, {
          models: [],
          creatureModels: [],
          creatureKinds: 0,
          creaturePlans: 0,
          artifactsDeclared: 0,
          calls: 0,
          errors: [String(e).slice(0, 200)],
          started: false,
        }),
        source: it.source,
      };
    }
    if (++n % 20 === 0) {
      writeFileSync(partFile, JSON.stringify(done));
      process.stderr.write(`${Object.keys(done).length}/${mine.length}\n`);
    }
  }
  writeFileSync(partFile, JSON.stringify(done));
  if (SHARD[1] > 1) return;
  report(lib, list, 1);
}

// Shards write /tmp/look-measure/part-<i>-of-<n>.json; --merge <n> reads them all.
function report(lib: ReturnType<typeof library>, list: Item[], parts: number) {
  const have = new Map<string, Measure>();
  for (let i = 0; i < parts; i++) {
    const f = `/tmp/look-measure/part-${i}-of-${parts}.json`;
    if (existsSync(f)) for (const [k, v] of Object.entries(JSON.parse(readFileSync(f, "utf8")) as Record<string, Measure>)) have.set(k, v);
  }
  finish(
    lib,
    list.map((it) => have.get(it.key)).filter((m): m is Measure => !!m),
  );
}

function finish(lib: ReturnType<typeof library>, rows: Measure[]) {
  const crashed = rows.filter((m) => !m.started || m.errors.length);
  const sum = summary(rows);
  const byKind = Object.fromEntries(group(rows, (m) => m.form).map(([k, l]) => [k, summary(l)]));
  const byTier = Object.fromEntries(group(rows, (m) => m.tier).map(([k, l]) => [k, summary(l)]));
  const worst = plainest(
    rows.filter((m) => !m.noModel),
    100,
  );
  const bare = rows.filter((m) => m.noModel);
  const missingByForm = group(lib.missing, (r) => `${r.form} (${r.kind})`).map(([k, l]) => `${k} ${l.length}`);
  const json = {
    date: STAMP,
    seconds: SECONDS,
    island: { seed: SEED, side: SIZE },
    elements: lib.elements.length,
    measured: rows.length,
    notMeasured: lib.missing.length,
    notMeasuredByForm: Object.fromEntries(group(lib.missing, (r) => `${r.form} (${r.kind})`).map(([k, l]) => [k, l.length])),
    summary: sum,
    byForm: byKind,
    byTier,
    plainest100: worst,
    noModelItems: bare.map((m) => ({
      key: m.key,
      name: m.name,
      form: m.form,
      tier: m.tier,
      kind: m.kind,
      noLook: m.noLook,
      creatureKinds: m.creatureKinds,
      artifactsDeclared: m.artifactsDeclared,
    })),
    crashed: crashed.map((m) => ({ key: m.key, started: m.started, errors: m.errors })),
    items: rows,
  };
  writeFileSync(`${OUT}/looks-${STAMP}.json`, JSON.stringify(json, null, 1));
  const md = `# How detailed items look: measured ${STAMP}

Phase 0 of the looks revamp. Read only: nothing was written to production and no model was called. Made by \`scripts/look-measure.ts\`.

## Headline

- ${rows.length - rows.filter((m) => m.kind === "wonder").length} library programs and ${rows.filter((m) => m.kind === "wonder").length} daily wonders (programs in the live pool) measured. The forms list has ${lib.elements.length} elements; ${rows.filter((m) => m.form === "unsorted").length} of the programs read are not in it (form "unsorted" below).
- ${sum.withModel} (${share(sum.withModel, sum.items)}) draw at least one model (w.model, or a creature with a drawn model). ${sum.noModel} draw none.
- **${sum.noLook} (${share(sum.noLook, sum.items)}) have no look at all**: no model, no creature of their own, no object they declare. They show effects only (particles, terrain).
- Under 10 parts in total: ${sum.under10Parts} items (${share(sum.under10Parts, sum.items)} of all, ${share(sum.under10PartsOfDrawn, sum.withModel)} of those that draw anything).
- Single colour (of items that draw a model): ${sum.singleColour} (${share(sum.singleColour, sum.withModel)}). Three colours or fewer: ${sum.threeColoursOrFewer} (${share(sum.threeColoursOrFewer, sum.withModel)}). Exactly one box: ${sum.singleBox}.
- No fine part (nothing under ${FINE_SIDE} on every side): ${share(sum.noFineParts, sum.withModel)} of those that draw a model.
- Boxes per model, items that draw one: median ${r1(sum.boxesPerModel.p50)} (10th ${r1(sum.boxesPerModel.p10)}, 90th ${r1(sum.boxesPerModel.p90)}).

## Method

- **Library.** Read through routes that write nothing (confirmed in \`worker/index.ts\`: \`handleAdmin\` "programs" / "challenge-candidates" / "forms" are one SELECT each; \`POST /api/library\` is \`handleLibrary\`, one SELECT over \`spells\` joined to \`elements\`; \`GET /api/wonders\` is \`livePool\`, one SELECT; the admin payer never triggers \`seen()\`). The owner's word "measure: all" covers reading the whole live library read only.
- **Run.** Each program is cast once at the village edge of the practice island (seed ${SEED}, side ${SIZE}, \`src/sim/check.ts\` island as \`scripts/spell-measure.ts\` uses it) in the repository's own \`Runtime\`, for ${SECONDS} seconds of game time. Artifacts and wonders are cast as artifacts (a wonder with its own reach).
- **What counts as drawn.** Every distinct model a program passed to \`w.model\` (readBox, \`src/sim/props.ts\`, as the island reads them but before it shades each part a little; the island's own limit of four models per placing is not applied, so a program that places many is counted whole, at most 60 distinct models). Plus the raw model of every creature the program declares (\`modelOf\`, \`src/sim/body.ts\`, 16 boxes at most), taken before \`bodyFrom\` turns a still model into a plan.
- **Per item.** models (distinct); parts (boxes over all its models); boxes per model (parts divided by models); fine parts (largest side under ${FINE_SIDE}); thin parts (smallest side under ${FINE_SIDE}, a page or a blade); distinct colours; glow share (glow boxes over boxes); silhouette score.
- **Silhouette score.** For the item's largest model: the boxes are drawn onto a ${GRID} by ${GRID} grid over the bounding box, seen from the front, the side and the top. For each view the outline is the filled cells with an empty neighbour. A solid rectangle has the outline of the grid's edge (${4 * GRID - 4} cells) and scores 0; three times that scores 1; the three views are averaged. A single brick scores 0; the richest outline in the library scores ${r2(Math.max(0, ...rows.map((m) => m.silhouette)))}. "fill" in the JSON is the share of grid cells filled, for the reader who wants the plain version.
- **No look at all.** No model, no creature of its own, no object it declares (\`spell.artifacts\`).
- Percentiles are the 10th, the median and the 90th, linear between ranks. Tables by kind use the library's seven kinds (spell, creature, object, building, settlement, place, land) and wonders; tiers are the element's own.
- "with a model" is the share of the group that draws any model; "boxes per model" and "colours" are over those that draw one; "total parts" and "no look" are over the whole group, "silhouette" over those that draw a model.

## By kind

${table(rows, (m) => m.form)}

## By tier

${table(rows, (m) => m.tier, TIER_ORDER)}

## The 100 plainest items

Among the ${sum.withModel} items that draw at least one model: fewest parts first, then fewest colours, then the flattest outline. The ${bare.length} items that draw no model are plainer still and are not in this list; they are named below (${sum.noLook} of them have nothing at all, the rest have a creature of their own drawn from a body word, or an object they declare, so they have a look the boxes do not describe).

| key | name | kind | tier | models | parts | colours | fine | glow | silhouette | no look |
|---|---|---|---|---|---|---|---|---|---|---|
${worst.map((m) => `| ${m.key} | ${m.name} | ${m.form} | ${m.tier} | ${m.models + m.creatureModels} | ${m.boxes} | ${m.colours} | ${m.fine} | ${m.glowShare} | ${m.silhouette} | ${m.noLook ? "yes" : ""} |`).join("\n")}

## Items that draw no model

${bare.map((m) => `${m.name}${m.noLook ? "" : "*"}`).join(", ")}

(* has a creature or a declared object, so a look that is not a box model.)

## What could not be measured, and why

- **${lib.missing.length} of ${lib.elements.length} elements have no readable program.** The read only routes give code for a limited set: \`/api/admin/programs\` (100 live programs not judged yet, and 100 with creatures), \`/api/admin/challenge-candidates\` (60), and \`POST /api/library\`, which returns spells only (\`e.kind = 'spell'\`), 20 names at a time. An artifact (object, building, settlement, place, land) outside the first three lists has no read only route to its program. By form: ${missingByForm.join(", ") || "none"}. These are a count here, not in any distribution: the distributions describe the ${rows.length} programs that could be read, which is not a random sample of the artifacts.
- **Built-in wonders** (the island's own hot spring, arch and the rest) are drawn by the view (\`voxel/wonders.ts\`), not by a program, and are left out. Only wonders written as programs and live in the pool are in.
- **What a program draws late or by chance.** Each program ran once, ${SECONDS} seconds, one island, one spot. A model drawn only on water, at night, after a minute, or from a random branch is missed, so the numbers are a floor.
- **Looks that are not models.** Particles, the voxels a program sets, wards, terrain, creature plans (a body word like "four legs") and the artifacts a program declares are not boxes. They are counted as "no look" only when the program has none of them; they are not scored.
- **Programs that did not run clean:** ${crashed.length} (listed in the JSON under \`crashed\`). Their numbers are what they drew before stopping.
- **Frames:** a view from the Spell Lab's island (\`docs/measurements/looks-${STAMP}/\`) is the game's medium island, not the practice island, so frames show the look, not the numbers.
`;
  // Frames (scripts/look-frames.mjs) of items chosen across kinds, plain, middle and best by parts.
  const dir = `${OUT}/looks-${STAMP}`;
  const frames = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".png")) : [];
  const byKey = new Map(rows.map((m) => [m.key, m]));
  const framed = frames.map((f) => byKey.get(f.replace(/\.png$/, "").replace(/-/g, " "))).filter((m): m is Measure => !!m);
  const framesMd = frames.length
    ? `\n## Frames\n\nTwelve items across kinds, plain to rich by parts, cast in the Spell Lab (medium island, seed 11, near a village, four seconds after the cast; \`scripts/look-frames.mjs\`). The lab's island is not the practice island, so the frame shows the look, the table the numbers. Files in \`docs/measurements/looks-${STAMP}/\`.\n\n| frame | kind | tier | parts | colours | silhouette |\n|---|---|---|---|---|---|\n${[
        ...framed,
      ]
        .sort((a, b) => a.boxes - b.boxes)
        .map((m) => `| ${m.key.replace(/ /g, "-")}.png | ${m.form} | ${m.tier} | ${m.boxes} | ${m.colours} | ${m.silhouette} |`)
        .join("\n")}\n`
    : "";
  writeFileSync(`${OUT}/looks-${STAMP}.md`, md + framesMd);
  console.log(`wrote ${OUT}/looks-${STAMP}.md and .json`);
}

if (FETCH) await fetchAll(FETCH);
else main();
