import { C, F, G, S, isBuilding } from "./materials";
import { addGas } from "./cells";
import { daylight } from "./daylight";
import type { Behavior, Creature, CreatureKind } from "./creatures";
import { life } from "./kin";
import { WARD } from "./wards";
import type { World } from "./world";

// Spells that answer each other (4.12 step 2). A spell cannot know the 485
// others, so the answers live in the land and in what things are made of:
// rules added once here, read from what a stored program already declares
// (a creature's name, its base, its weaknesses and immunities, what it
// leaves, its aura; a cast's name and where its light falls). No stored
// program is rewritten and the World API only gains.
//
// On for the player's island only (world.reactions, set where world.weather
// is): challenges replay their seeded solutions against a par, and the test
// run judges a program the way it was judged when it was stored, so both
// play exactly as before.

// --- What a creature is made of ----------------------------------------------

export const N = {
  FIRE: 1,
  COLD: 2,
  WATER: 4,
  HOLY: 8,
  UNDEAD: 16,
  DARK: 32,
  LIGHT: 64,
  LIFE: 128,
} as const;

// Natures that answer each other: one hurts the other on touch, and a
// creature of one hunts or flees a creature of the other.
export const OPPOSED: readonly [number, number][] = [
  [N.FIRE, N.COLD],
  [N.FIRE, N.WATER],
  [N.HOLY, N.UNDEAD],
  [N.HOLY, N.DARK],
  [N.LIGHT, N.DARK],
  [N.LIFE, N.UNDEAD],
];

export function opposed(a: number, b: number): boolean {
  for (const [p, q] of OPPOSED) if ((a & p && b & q) || (a & q && b & p)) return true;
  return false;
}

// Words in a name, as the island's other rules read names (goals.ts, abilities.ts).
const WORDS: [number, RegExp][] = [
  [
    N.FIRE,
    /fire|flame|blaze|ember|inferno|pyro|phoenix|ifrit|efreet|salamander|magma|lava|molten|burning|cinder|hellhound|scorch|volcan|smoulder|smolder|\bsun ?bird/,
  ],
  [N.COLD, /\bice|frost|snow|yeti|glaci|winter|frozen|cryo|blizzard|wendigo|polar|rime\b/],
  [N.WATER, /water|\bsea\b|kraken|naiad|nereid|undine|\bmer(?:maid|man|folk)|\btide|leviathan|kelpie|selkie|\bwave|ocean|river spirit/],
  [N.HOLY, /holy|angel|seraph|cherub|divine|\bsaint|celestial|paladin|archon|sacred|blessed|templar|valkyr|unicorn|heavenly/],
  [
    N.UNDEAD,
    /undead|zombie|skelet|\blich|ghoul|wraith|vampir|mummy|revenant|\brisen\b|thrall|ghost|spectre|specter|banshee|\bwight|phantom|reaper|draugr|lost soul|bone ?(?:walker|knight|lord)/,
  ],
  [N.DARK, /shadow|\bshade|dark|\bnight|\bvoid|nightmare|boogey|bogey|demon|devil|fiend|\bimp\b|fallen|abyss|gloom|umbra|werewolf|succubus|incubus/],
  [N.LIGHT, /light(?!ning)|\bsun|\bstar|radian|dawn|lumin|wisp|aurora|lantern|solar|bright|glimmer/],
  [N.LIFE, /heal|\blife|druid|dryad|treant|\bent\b|gaia|bloom|blossom|nymph|sprout|verdant|\bgrove/],
];

// A cast whose name is holy sheds holy light (Divine Radiance, Turn Undead, Consecrate).
const HOLY_CAST = /radian|purif|consecr|sanctif|smit|exorc|turn undead|\bhalo|\bgrace|benedict|\bprayer/;
export function holyName(name: string): boolean {
  const s = name.toLowerCase();
  return WORDS[3][1].test(s) || HOLY_CAST.test(s);
}

const natures = new WeakMap<CreatureKind, number>();

// A kind's natures: from the words of its name and base, then from what it
// declares (fire in what it leaves or its aura, the weaknesses of a creature
// of fire, the hours and fears of a creature of the dark). Kept per kind: a
// spell that redefines a kind makes a new one.
export function natureOf(world: World, k: CreatureKind): number {
  const known = natures.get(k);
  if (known !== undefined) return known;
  let n = 0;
  const words = `${k.name.split("#")[0]} ${k.fallback ?? ""} ${k.tags.join(" ")}`.toLowerCase();
  for (const [bit, re] of WORDS) if (re.test(words)) n |= bit;
  // "Fallen" angels are of the dark, not of the light.
  if (n & N.DARK && /fallen/.test(words)) n &= ~N.HOLY;
  const ai = k.ai;
  if (ai) n |= declared(world, ai);
  // A creature of fire that is also named for ice or water is neither: keep the stronger, declared one.
  if (n & N.FIRE && n & (N.COLD | N.WATER) && ai) {
    if (ai.weak.includes("fire")) n &= ~N.FIRE;
    else if (ai.weak.includes("water") || ai.weak.includes("cold")) n &= ~(N.COLD | N.WATER);
  }
  natures.set(k, n);
  return n;
}

function declared(world: World, ai: Behavior): number {
  let n = 0;
  const leaves = ai.leaves;
  if (leaves === "fire" || leaves === "lava" || leaves === "ember" || leaves === "embers" || ai.aura === "burn") n |= N.FIRE;
  if (leaves === "ice" || leaves === "snow" || leaves === "frost" || ai.aura === "freeze") n |= N.COLD;
  if (leaves === "water") n |= N.WATER;
  if (leaves === "flowers" || leaves === "life" || ai.aura === "heal") n |= N.LIFE;
  // A material of its own it leaves: hot or cold by its declared heat, light by its glow.
  if (leaves && !(n & (N.FIRE | N.COLD))) {
    const found = world.materials.find(leaves);
    const heat = found ? world.materials.get(found.layer, found.id).heat : null;
    if (heat !== null && heat > 150) n |= N.FIRE;
    else if (heat !== null && heat < -2) n |= N.COLD;
  }
  // Immune to fire and hurt by water or cold: a creature of fire.
  if (ai.immune.includes("fire") && (ai.weak.includes("water") || ai.weak.includes("cold"))) n |= N.FIRE;
  if (ai.immune.includes("cold") && ai.weak.includes("fire")) n |= N.COLD;
  // Burnt by daylight, or awake only at night and hurt by light: a creature of the dark.
  if (ai.weak.includes("light")) n |= N.DARK;
  if (ai.converts) n |= N.UNDEAD;
  return n;
}

// Tests only: forget what was read, after kinds were changed in place.
export function forgetNatures(k: CreatureKind): void {
  natures.delete(k);
}

// --- Light and shadow in the world -------------------------------------------

// A light or a darkness a spell put somewhere, for its seconds.
export interface LightSource {
  x: number;
  y: number;
  r: number;
  until: number;
  // 0 to 1: how bright (or how dark, for a darkness).
  power: number;
  holy: boolean;
  dark: boolean;
}

// A light of a spell lights the land at least this long, its glow drawn as long.
export const LIGHT_MIN_SECONDS = 6;
// Coarse cells of the field, in cells, and how often it is made again (ticks).
export const LIGHT_STEP = 2;
export const LIGHT_EVERY = 10;
// The field's own budget per update on the large island (scripts/reactions-test.ts measures it).
export const LIGHT_BUDGET_MS = 1.5;

export interface LightField {
  cw: number;
  ch: number;
  // What stands on each coarse cell, as a height: the land, houses, trees, voxels.
  top: Float32Array;
  topAt: number;
  topSize: number;
  // The light spells and glowing things shed, holy light among it, and darkness.
  lit: Float32Array;
  holy: Float32Array;
  dark: Float32Array;
  at: number;
  // Any source this update: when none, every query is 0 without a look.
  any: boolean;
}

// Spells add a light or a darkness (runtime.ts: w.light, w.darken).
export function addLight(world: World, s: LightSource): void {
  if (!world.reactions) return;
  if (world.lightSources.length >= 64) world.lightSources.shift();
  world.lightSources.push(s);
}

function field(world: World): LightField {
  let f = world.lightField;
  const cw = Math.ceil(world.w / LIGHT_STEP);
  const ch = Math.ceil(world.h / LIGHT_STEP);
  if (!f || f.cw !== cw || f.ch !== ch) {
    f = {
      cw,
      ch,
      top: new Float32Array(cw * ch),
      topAt: -1e9,
      topSize: -1,
      lit: new Float32Array(cw * ch),
      holy: new Float32Array(cw * ch),
      dark: new Float32Array(cw * ch),
      at: -1,
      any: false,
    };
    world.lightField = f;
  }
  return f;
}

// How tall each cover stands, by id, for what blocks light: trees and buildings.
let tallOf: Float32Array | null = null;
function coverHeights(): Float32Array {
  if (tallOf) return tallOf;
  tallOf = new Float32Array(256);
  for (let c = 0; c < 256; c++) tallOf[c] = c === C.TREE || c === C.WINDMILL ? 5 : isBuilding(c) || c === C.SITE ? 3.5 : c === C.BOULDER ? 1.5 : 0;
  return tallOf;
}

function rebuildTop(world: World, f: LightField): void {
  const { cw, top } = f;
  const tall = coverHeights();
  const { w, h, height, depth, cover } = world;
  top.fill(-1e9);
  for (let y = 0; y < h; y++) {
    const row = ((y / LIGHT_STEP) | 0) * cw;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = height[i] + depth[i] + tall[cover[i]];
      const j = row + ((x / LIGHT_STEP) | 0);
      if (v > top[j]) top[j] = v;
    }
  }
  // Voxels spells raised (walls, towers): two height units a level (voxel/terrain.ts, V).
  for (const [key] of world.decor) {
    const level = (key % 512) - 128;
    const x = Math.floor(key / 512) % 1024;
    const y = Math.floor(key / (512 * 1024));
    if (x >= world.w || y >= world.h) continue;
    const j = ((y / LIGHT_STEP) | 0) * cw + ((x / LIGHT_STEP) | 0);
    const h = (level + 1) * 2;
    if (h > top[j]) top[j] = h;
  }
}

// The light and darkness of the island, a few times a second.
export function stepLight(world: World): void {
  const now = world.time;
  const src = world.lightSources;
  if (src.length) world.lightSources = src.filter((s) => s.until > now);
  const f = field(world);
  f.lit.fill(0);
  f.holy.fill(0);
  f.dark.fill(0);
  f.at = world.tick;
  // Glowing creatures of light, holy or fire shed light around them.
  const shed: LightSource[] = [];
  let readers = false;
  for (const c of world.creatures) {
    if (c.dead) continue;
    const k = life.kindOf(c);
    if (k.native) continue;
    readers = true;
    const n = natureOf(world, k);
    if (k.glow && n & (N.LIGHT | N.HOLY | N.FIRE) && !(n & N.DARK))
      shed.push({ x: c.x, y: c.y, r: 3 + k.radius * c.size * 2, until: now + 1, power: 0.8, holy: !!(n & N.HOLY), dark: false });
  }
  // Only an item's creatures read the light of fires (natureTick): with none, and no light or
  // darkness a spell cast, there is nothing to make (the island as generated pays nothing).
  if (!readers && !world.lightSources.length) {
    f.any = false;
    return;
  }
  // Fire and lava light the cells around them (coarse, unblocked: they are low and many).
  let fires = false;
  const { w, h, fire, fluid } = world;
  for (let y = 0; y < h; y++) {
    const row = ((y / LIGHT_STEP) | 0) * f.cw;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (fire[i] < 0.4 && fluid[i] !== F.LAVA) continue;
      const j = row + ((x / LIGHT_STEP) | 0);
      if (f.lit[j] < 0.7) f.lit[j] = 0.7;
      fires = true;
    }
  }
  const all = shed.length ? [...world.lightSources, ...shed] : world.lightSources;
  f.any = fires || all.length > 0;
  if (!all.length) return;
  // What stands on the land, every two seconds or when voxels came or went.
  if (world.time - f.topAt > 2 || world.decor.size !== f.topSize) {
    rebuildTop(world, f);
    f.topAt = world.time;
    f.topSize = world.decor.size;
  }
  for (const s of all) (s.dark ? shade : shine)(world, f, s);
}

function shine(world: World, f: LightField, s: LightSource): void {
  const { cw, ch, top } = f;
  const S = LIGHT_STEP;
  const r = Math.min(60, s.r);
  const sx = s.x / S;
  const sy = s.y / S;
  const si = world.idx(Math.max(0, Math.min(world.w - 1, s.x)), Math.max(0, Math.min(world.h - 1, s.y)));
  const sz = world.walkLevel(si) + 2.5;
  const rc = r / S;
  const x0 = Math.max(0, Math.floor(sx - rc));
  const x1 = Math.min(cw - 1, Math.ceil(sx + rc));
  const y0 = Math.max(0, Math.floor(sy - rc));
  const y1 = Math.min(ch - 1, Math.ceil(sy + rc));
  const own = (sy | 0) * cw + (sx | 0);
  for (let cy = y0; cy <= y1; cy++)
    for (let cx = x0; cx <= x1; cx++) {
      const tx = cx + 0.5;
      const ty = cy + 0.5;
      const d = Math.hypot(tx - sx, ty - sy);
      if (d > rc) continue;
      const j = cy * cw + cx;
      const v = s.power * (1 - (d / (rc || 1)) ** 2);
      if (v <= f.lit[j] && (!s.holy || v <= f.holy[j])) continue;
      // Walls, houses, trees and hills between the light and this place keep it dark.
      const tz = world.walkLevel(Math.min(world.n - 1, Math.min(world.h - 1, cy * S) * world.w + Math.min(world.w - 1, cx * S))) + 1;
      const steps = Math.ceil(d);
      let open = true;
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        const px = (sx + (tx - sx) * t) | 0;
        const py = (sy + (ty - sy) * t) | 0;
        const p = py * cw + px;
        if (p === own || p === j) continue;
        if (top[p] > sz + (tz - sz) * t) {
          open = false;
          break;
        }
      }
      if (!open) continue;
      if (v > f.lit[j]) f.lit[j] = v;
      if (s.holy && v > f.holy[j]) f.holy[j] = v;
    }
}

function shade(_world: World, f: LightField, s: LightSource): void {
  const { cw, ch } = f;
  const S = LIGHT_STEP;
  const rc = Math.min(80, s.r) / S;
  const sx = s.x / S;
  const sy = s.y / S;
  for (let cy = Math.max(0, Math.floor(sy - rc)); cy <= Math.min(ch - 1, Math.ceil(sy + rc)); cy++)
    for (let cx = Math.max(0, Math.floor(sx - rc)); cx <= Math.min(cw - 1, Math.ceil(sx + rc)); cx++) {
      const d = Math.hypot(cx + 0.5 - sx, cy + 0.5 - sy);
      if (d > rc) continue;
      const j = cy * cw + cx;
      const v = s.power * Math.min(1, 1.6 * (1 - d / (rc || 1)));
      if (v > f.dark[j]) f.dark[j] = v;
    }
}

export interface LightHere {
  // Light spells and glowing things shed here, 0 to 1, holy light among it, and darkness.
  lit: number;
  holy: number;
  dark: number;
}

const NONE: LightHere = { lit: 0, holy: 0, dark: 0 };
const here: LightHere = { lit: 0, holy: 0, dark: 0 };

// The light at a point. The returned object is reused: read it at once.
export function lightAt(world: World, x: number, y: number): LightHere {
  const f = world.lightField;
  if (!f || !f.any) return NONE;
  const cx = Math.max(0, Math.min(f.cw - 1, (x / LIGHT_STEP) | 0));
  const cy = Math.max(0, Math.min(f.ch - 1, (y / LIGHT_STEP) | 0));
  const j = cy * f.cw + cx;
  here.lit = f.lit[j];
  here.holy = f.holy[j];
  here.dark = f.dark[j];
  return here;
}

// Is it dark here: night, or a darkness a spell or a creature of the dark brought, with no light against it.
export function darkHere(world: World, x: number, y: number): boolean {
  const l = lightAt(world, x, y);
  if (l.lit >= 0.35 && l.lit > l.dark) return false;
  return l.dark >= 0.5 || daylight(world.time).night > 0.6;
}

// The nearest light a spell made, for a creature of the dark to run from.
function nearestLight(world: World, x: number, y: number): LightSource | null {
  let best: LightSource | null = null;
  let bestD = Infinity;
  for (const s of world.lightSources) {
    if (s.dark) continue;
    const d = Math.hypot(s.x - x, s.y - y) - s.r;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

// --- A creature and the land, by what it is made of --------------------------

const embers = (world: World, i: number) => {
  for (let k = 0; k < 3; k++)
    world.particles.add({
      x: (i % world.w) + Math.random(),
      y: Math.floor(i / world.w) + Math.random(),
      z: 0.5,
      vz: 2 + Math.random() * 2,
      life: 0.7,
      color: k % 2 ? 0xffb03a : 0xff6a1a,
      size: 0.5,
      glow: true,
      gravity: -1,
    });
};

const puff = (world: World, x: number, y: number, color: number) => {
  for (let k = 0; k < 4; k++)
    world.particles.add({ x: x + Math.random() - 0.5, y: y + Math.random() - 0.5, z: 1, vz: 2 + Math.random() * 2, life: 0.8, color, size: 0.9, gravity: -1 });
};

// A building within a few cells: a creature's own sparks spare a village (fire may still reach it).
function nearHouses(world: World, i: number, r: number): boolean {
  const x = i % world.w;
  const y = (i / world.w) | 0;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
      const c = world.cover[ny * world.w + nx];
      if (isBuilding(c) || c === C.SITE || c === C.CROP) return true;
    }
  return false;
}

function fireNear(world: World, i: number, r: number): boolean {
  const x = i % world.w;
  const y = (i / world.w) | 0;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < world.w && ny < world.h && world.fire[ny * world.w + nx] > 0) return true;
    }
  return false;
}

// Seconds between two sparks a creature of fire lets fall where it goes.
export const SPARK_EVERY = 4;

// What a creature's nature does with the land under it and the light on it,
// each tick, before it decides where to go. i: its cell. low: on the ground or
// flying low enough to touch what grows.
export function natureTick(world: World, c: Creature, k: CreatureKind, i: number, low: boolean, dt: number): void {
  const n = natureOf(world, k);
  const ai = k.ai;
  const weak = (e: string) => !!ai && ai.weak.includes(e);
  const immune = (e: string) => !!ai && ai.immune.includes(e);
  const max = k.hp * c.size;
  const wet = world.fluid[i] === F.WATER && world.depth[i] > 0.05;
  if (n & N.FIRE) {
    // Warm: it melts snow and thaws ice where it goes, and is at home in fire.
    if (world.temp[i] < 45) world.temp[i] += (45 - world.temp[i]) * Math.min(1, dt * 3);
    c.burning = 0;
    if (world.fire[i] > 0.25 || (world.fluid[i] === F.LAVA && world.depth[i] > 0.05)) c.hp = Math.min(max, c.hp + 12 * dt);
    // Water and cold put it out: steam where it touches water, and it is hurt (once: a declared weakness already hurts it).
    if (wet && low && !immune("water")) {
      if (!weak("water")) c.hp -= 30 * dt;
      if (Math.random() < dt * 6) {
        addGas(world, i, S.STEAM, 0.3);
        puff(world, c.x, c.y, 0xe8eef2);
      }
    }
    if ((world.temp[i] < 2 || world.ground[i] === G.SNOW) && !immune("cold") && !weak("cold")) c.hp -= 10 * dt;
    // It lights what burns where it walks or lands, a spark every few seconds, more for a bigger one.
    const every = SPARK_EVERY / Math.max(0.5, Math.min(3, Math.sqrt(c.size * k.radius) / 0.77));
    const last = (c.data.spark as number | undefined) ?? -1e9;
    if (low && world.time - last > every && !wet) {
      c.data.spark = world.time;
      const flam = Math.max(world.materials.get("cover", world.cover[i]).flammable, world.materials.get("ground", world.ground[i]).flammable);
      if (
        flam > 0 &&
        world.fire[i] === 0 &&
        !isBuilding(world.cover[i]) &&
        !nearHouses(world, i, 5) &&
        !fireNear(world, i, 3) &&
        !(world.wardMask[i] & WARD.fire)
      ) {
        world.fire[i] = 0.4;
        embers(world, i);
      }
    }
  }
  if (n & N.COLD) {
    // Cold: it chills where it goes (water under it freezes), is at home in snow, and fire hurts it.
    if (world.temp[i] > -8) world.temp[i] += (-8 - world.temp[i]) * Math.min(1, dt * 3);
    c.frozen = 0;
    if (world.ground[i] === G.SNOW || world.fluid[i] === F.ICE) c.hp = Math.min(max, c.hp + 6 * dt);
    if (!weak("fire") && !immune("fire") && (c.burning > 0 || world.fire[i] > 0.25 || world.temp[i] > 80)) c.hp -= 25 * dt;
    if (low && world.fire[i] > 0) {
      world.fire[i] = 0;
      addGas(world, i, S.STEAM, 0.3);
    }
    // Lava it walks on crusts over into stone where it steps.
    if (low && world.fluid[i] === F.LAVA && world.depth[i] > 0.05 && Math.random() < dt * 4) {
      world.height[i] += world.depth[i] * 0.9;
      world.ground[i] = G.BASALT;
      world.setFluid(i, F.NONE, 0);
      addGas(world, i, S.STEAM, 0.4);
    }
  }
  if (n & N.WATER && low) {
    // Water puts out the fire it walks through.
    if (world.fire[i] > 0) {
      world.fire[i] = 0;
      addGas(world, i, S.STEAM, 0.3);
      puff(world, c.x, c.y, 0xe8eef2);
    }
    c.burning = 0;
    if (world.fluid[i] === F.LAVA && world.depth[i] > 0.05 && !immune("fire")) c.hp -= 30 * dt;
  }
  // Light: the field says what light falls here. Every half second, as daylight hurts (creatures.ts).
  if (world.tick % 15 !== c.id % 15) return;
  const l = lightAt(world, c.x, c.y);
  if (!l.lit && !l.dark) return;
  const lit = l.lit >= 0.35 && l.lit > l.dark;
  // What light hurts is hurt in a spell's light, day or night, unless a wall stands between them.
  if (lit && weak("light")) {
    c.hp -= 6 * l.lit * 2;
    sizzle(world, c);
  }
  // Holy light burns the undead and the creatures of the dark that are not already hurt by light.
  if (l.holy >= 0.3 && n & (N.UNDEAD | N.DARK) && !immune("light")) {
    c.hp -= 10 * l.holy;
    sizzle(world, c);
  }
  // A creature of the dark runs from a fresh light.
  if (lit && n & N.DARK && !(n & (N.LIGHT | N.HOLY)) && c.fear <= 0) {
    const s = nearestLight(world, c.x, c.y);
    if (s) {
      c.fear = 2;
      c.fearX = s.x;
      c.fearY = s.y;
    }
  }
}

function sizzle(world: World, c: Creature): void {
  for (let k = 0; k < 3; k++)
    world.particles.add({ x: c.x + Math.random() - 0.5, y: c.y + Math.random() - 0.5, z: 1, vz: 2.5, life: 0.6, color: 0xfff0c0, size: 1, glow: true });
}

// A creature of the dark is bolder where it is dark: it strikes harder.
export function boldness(world: World, k: CreatureKind, c: Creature): number {
  if (!world.reactions) return 1;
  const n = natureOf(world, k);
  if (!(n & N.DARK)) return 1;
  return darkHere(world, c.x, c.y) ? 1.5 : 1;
}

// A creature of the night is awake where a darkness lies, by day as well.
export function darkWakes(world: World, k: CreatureKind, c: Creature): boolean {
  if (!world.reactions) return false;
  const n = natureOf(world, k);
  if (!(n & N.DARK) && k.ai?.active !== "night") return false;
  const l = lightAt(world, c.x, c.y);
  return l.dark >= 0.5 && l.lit < l.dark;
}

// --- Creatures meeting creatures, by what they are -----------------------------

// A creature an item made (not the island's own, not a villager).
export function spellMade(k: CreatureKind, builtin: ReadonlySet<string>): boolean {
  return !k.native && !builtin.has(k.name);
}

// How strong a creature is, against another: its health at full.
const strength = (k: CreatureKind, c: Creature) => k.hp * c.size;
const attackOf = (k: CreatureKind, c: Creature) => (k.ai?.attack ? k.ai.attack : 0) * Math.sqrt(c.size);
const hunter = (k: CreatureKind) => k.ai?.mode === "hunt" || (k.goal === "hunt" && !!k.ai?.attack);

export interface Meeting {
  // Who it goes for, or runs from.
  who: Creature;
  fight: boolean;
}

// What a creature an item made does about another one near it: hunt it (a
// hunter goes for what is no bigger than it), fight it (natures opposed, and it
// has the strength), or run (from what hunts it, or an opposed nature far
// stronger). Allies (a shared nature, the same kind) leave each other be.
// The island's own animals and villagers keep their own rules.
export function relation(world: World, c: Creature, k: CreatureKind, o: Creature, ok: CreatureKind): "hunt" | "fight" | "flee" | null {
  if (o.kind === c.kind || o.kind === "villager" || ok.native) return null;
  const a = natureOf(world, k);
  const b = natureOf(world, ok);
  const foes = opposed(a, b);
  if (!foes && a & b) return null;
  const sa = strength(k, c);
  const sb = strength(ok, o);
  if (foes) {
    if (attackOf(k, c) > 0 && sa >= sb * 0.5) return "fight";
    if (sb > sa * 2 && (attackOf(ok, o) > 0 || hunter(ok))) return "flee";
    return null;
  }
  if (hunter(k) && attackOf(k, c) > 0 && sb <= sa * 1.5 && !hunter(ok)) return "hunt";
  if (hunter(ok) && attackOf(ok, o) > 0 && sa <= sb * 1.5 && attackOf(k, c) * 2 < attackOf(ok, o)) return "flee";
  return null;
}

// Looks around a few times a second for another item's creature to answer.
export function meet(world: World, c: Creature, k: CreatureKind, builtin: ReadonlySet<string>, dt: number): Meeting | null {
  const look = ((c.data.meetLook as number | undefined) ?? Math.random() * 0.5) - dt;
  c.data.meetLook = look;
  let m = c.data.meet as Meeting | undefined;
  if (look <= 0) {
    c.data.meetLook = 0.4 + Math.random() * 0.2;
    m = undefined;
    let bestD = Infinity;
    const sense = Math.min(20, k.ai?.sense ?? 10);
    for (const o of world.crowd.near(world, c.x, c.y, sense)) {
      if (o === c || o.dead) continue;
      const ok = life.kindOf(o);
      if (ok.native || (builtin.has(ok.name) && !(natureOf(world, ok) & N.UNDEAD))) continue;
      const r = relation(world, c, k, o, ok);
      if (!r) continue;
      const d = Math.hypot(o.x - c.x, o.y - c.y);
      if (d < bestD) {
        bestD = d;
        m = { who: o, fight: r !== "flee" };
      }
    }
    c.data.meet = m;
  }
  if (!m || m.who.dead || Math.hypot(m.who.x - c.x, m.who.y - c.y) > 24) {
    c.data.meet = undefined;
    return null;
  }
  return m;
}

// A blow struck when close enough, for a creature that goes for another.
export function strike(world: World, c: Creature, k: CreatureKind, o: Creature, ok: CreatureKind, dt: number): boolean {
  const reach = k.radius * c.size + ok.radius * o.size + 0.6;
  if (Math.hypot(o.x - c.x, o.y - c.y) > reach) return false;
  o.hp -= attackOf(k, c) * boldness(world, k, c) * dt;
  if (o.hp <= 0) o.dead = true;
  return true;
}

// Natures that oppose hurt each other on touch: fire and ice meet in steam,
// holy and undead in a flash. Run by each of the two, so each takes its share.
export function touch(world: World, c: Creature, k: CreatureKind, dt: number): void {
  const a = natureOf(world, k);
  if (!a) return;
  if ((world.tick + c.id) % 3 !== 0) return;
  for (const o of world.crowd.near(world, c.x, c.y, k.radius * c.size + 3)) {
    if (o === c || o.dead) continue;
    const ok = life.kindOf(o);
    const b = natureOf(world, ok);
    if (!b || !opposed(a, b)) continue;
    if (Math.hypot(o.x - c.x, o.y - c.y) > k.radius * c.size + ok.radius * o.size + 0.4) continue;
    // Each burns the other by the other's size: three ticks' worth.
    c.hp -= 8 * Math.sqrt((o.size * ok.radius) / 0.6) * dt * 3;
    if (Math.random() < 0.3) puff(world, (c.x + o.x) / 2, (c.y + o.y) / 2, a & (N.FIRE | N.COLD | N.WATER) ? 0xe8eef2 : 0xfff0c0);
  }
}

// --- Blasts and gusts ----------------------------------------------------------

// A gust out from (x, y), r: a shockwave or a blast's breath. Small fires go
// out, big ones are fanned outward; smoke and gas are pushed to the rim;
// water is shoved out of the middle and splashes over the rim.
export function gust(world: World, x: number, y: number, r: number, power = 1): void {
  if (!world.reactions) return;
  r = Math.min(40, r);
  const { w, h } = world;
  const x0 = Math.max(1, Math.floor(x - r));
  const x1 = Math.min(w - 2, Math.ceil(x + r));
  const y0 = Math.max(1, Math.floor(y - r));
  const y1 = Math.min(h - 2, Math.ceil(y + r));
  const out = (cx: number, cy: number, by: number) => {
    const dx = cx - x;
    const dy = cy - y;
    const d = Math.hypot(dx, dy) || 1;
    const tx = Math.round(cx + (dx / d) * by);
    const ty = Math.round(cy + (dy / d) * by);
    return tx < 0 || ty < 0 || tx >= w || ty >= h ? -1 : ty * w + tx;
  };
  let splashes = 0;
  for (let cy = y0; cy <= y1; cy++)
    for (let cx = x0; cx <= x1; cx++) {
      const d = Math.hypot(cx - x, cy - y);
      if (d > r) continue;
      const i = cy * w + cx;
      if (world.wardMask[i]) continue;
      const k = 1 - d / (r || 1);
      // Fire: blown out when small, fanned outward when big.
      const f = world.fire[i];
      if (f > 0) {
        if (f < 0.45 * power + 0.1) {
          world.fire[i] = 0;
          addGas(world, i, S.SMOKE, 0.3);
        } else {
          const j = out(cx, cy, 1 + 2 * k * power);
          if (j >= 0 && world.fire[j] === 0 && !(world.fluid[j] === F.WATER && world.depth[j] > 0.05)) {
            const flam = Math.max(world.materials.get("cover", world.cover[j]).flammable, world.materials.get("ground", world.ground[j]).flammable);
            if (flam > 0) world.fire[j] = Math.max(world.fire[j], 0.5);
          }
        }
      }
      // Gas: carried outward, beyond the rim.
      if (world.gas[i] !== S.NONE && world.gasAmt[i] > 0.01) {
        const j = out(cx, cy, r - d + 2);
        if (j >= 0) addGas(world, j, world.gas[i], world.gasAmt[i] * 0.8);
        world.gasAmt[i] = 0;
        world.gas[i] = S.NONE;
      }
      // Water and other fluids that flow: shoved out of the middle, over the rim.
      const fl = world.fluid[i];
      if (fl !== F.NONE && fl !== F.ICE && world.depth[i] > 0.05) {
        const flow = world.materials.get("fluid", fl).flow;
        if (flow > 0) {
          const take = Math.min(world.depth[i] * 0.5 * k * power, 0.8);
          const j = out(cx, cy, r - d + 1 + Math.random() * 2);
          if (take > 0.02 && j >= 0 && (world.fluid[j] === fl || world.fluid[j] === F.NONE)) {
            world.depth[i] -= take;
            world.setFluid(j, fl, world.depth[j] + take);
            if (world.depth[i] < 0.02) world.setFluid(i, F.NONE, 0);
            if (splashes++ < 60)
              world.particles.add({
                x: cx + 0.5,
                y: cy + 0.5,
                z: 0.5,
                vx: ((cx - x) / (d || 1)) * 6,
                vy: ((cy - y) / (d || 1)) * 6,
                vz: 4 + Math.random() * 4,
                life: 0.9,
                color: world.materials.get("fluid", fl).colors[0],
                size: 0.7,
                gravity: 18,
              });
          }
        }
      }
    }
}

// --- Growth loves ash ----------------------------------------------------------

// Burnt ground is fertile for a while: grass, flowers and young trees come
// back faster and thicker where ash lay. Kept as the time, in four second
// steps, until which a cell stays fertile (not saved: a reload forgets it).
export const FERTILE_SECONDS = 600;

export function fertilize(world: World, i: number): void {
  if (!world.fertile) world.fertile = new Uint16Array(world.n);
  world.fertile[i] = Math.min(65535, Math.ceil((world.time + FERTILE_SECONDS) / 4));
}

export function fertile(world: World, i: number): boolean {
  return !!world.fertile && world.fertile[i] * 4 > world.time;
}

// Natural regrowth of one sampled cell on fertile ground (physics.ts, stepGrowth): true when it handled it.
// A burnt forest comes back: ash greens, stumps sprout, young trees fill in, flowers first.
export function ashGrowth(world: World, i: number, j: number, r: number): boolean {
  const g = world.ground[i];
  const c = world.cover[i];
  if (g === G.ASH) {
    if (r < 0.35) {
      world.ground[i] = G.GRASS;
      fertilize(world, i);
      if (c === C.NONE && r < 0.12) world.setCover(i, r < 0.07 ? C.FLOWER : C.BUSH);
    }
    return true;
  }
  if (!fertile(world, i)) return false;
  if (c === C.STUMP) {
    if (r < 0.08) world.setCover(i, C.TREE);
    return true;
  }
  if (g === G.GRASS && c === C.NONE) {
    const cj = world.cover[j];
    if ((cj === C.TREE || cj === C.STUMP) && r < 0.12) world.setCover(i, C.TREE);
    else if (r < 0.03) world.setCover(i, r < 0.015 ? C.FLOWER : C.BUSH);
    return true;
  }
  if ((c === C.BUSH || c === C.FLOWER) && (world.cover[j] === C.TREE || world.cover[j] === C.STUMP) && r < 0.03) {
    world.setCover(i, C.TREE);
    return true;
  }
  return false;
}
