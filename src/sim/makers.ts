import { C, F, G, isBuilding } from "./materials";
import { Rng } from "./noise";
import { BIOMES, type Biome } from "./land-options";
import type { World } from "./world";
import { buildVillage } from "./world";
import { JOBS, block, layOutVillage, settlementNear } from "./buildings";
import { dressSettlement, firstWell, type Settlement } from "./ecology";
import { dress, makeCreature } from "./creatures";
import { tell } from "./kin";
import { placeWonderAt, WONDER_KINDS, type Wonder } from "./wonders";

// The makers of 4.6: an item of each kind is built the engine's own way,
// not drawn from scratch in voxels. A program chooses the parameters and
// adds what is special; these do the rest, the way a new island is made:
//
//   building    a two by two block of a house or a building with a job,
//               drawn by the seeded builder (voxel/buildings.ts) in its
//               village's style, and doing that job for the nearest village
//   settlement  a real village: houses round a plaza, a main street,
//               fields, a well, its first buildings and its villagers,
//               laid out by the generator's own functions (world.ts,
//               buildings.ts, ecology.ts)
//   land        the terrain itself reshaped: hills, mountains, a volcano
//               with its vent, lakes and ponds kept by a spring, canyons,
//               craters, an oasis, a swamp, mesas, a new island in the sea
//   place       one of the island's built-in wonders where the item stands
//               (wonders.ts), with its land, its model and what it does
//
// An object and a creature have no maker here: an object is a small look
// and an artifact (spell.artifacts), a creature a kind (spell.creatures).

// The jobs a building may have, by the names a program uses, and the house.
export const BUILDING_JOBS: Record<string, number> = {
  house: C.HOUSE,
  ...Object.fromEntries(JOBS.map((j) => [j.name, j.id])),
};

// Settlements stand at least this far apart, center to center (a village's
// fields reach 14 cells out).
const APART = 26;

function flatDry(world: World, cx: number, cy: number, r: number): number {
  if (cx < r + 2 || cy < r + 2 || cx >= world.w - r - 2 || cy >= world.h - r - 2) return Infinity;
  const base = world.height[cy * world.w + cx];
  if (base < world.seaLevel + 1) return Infinity;
  let rough = 0;
  let wet = 0;
  for (let y = cy - r; y <= cy + r; y += 2)
    for (let x = cx - r; x <= cx + r; x += 2) {
      const i = y * world.w + x;
      if (world.depth[i] > 0 || world.fluid[i] === F.LAVA) wet++;
      rough += Math.abs(world.height[i] - base);
    }
  return wet > 3 ? Infinity : rough + wet * 20;
}

// A spot for a new village near (x, y): dry, fairly flat, away from the others.
function villageSpot(world: World, x: number, y: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  // Houses of villages the island had before settlements were kept (the old
  // island, the practice island of the test run) count as villages too.
  const homes: { x: number; y: number }[] = [];
  for (let i = 0; i < world.n; i += 2) if (world.cover[i] === C.HOUSE) homes.push({ x: i % world.w, y: Math.floor(i / world.w) });
  for (let d = 0; d <= 40; d += 3)
    for (let k = 0; k < Math.max(1, d * 2); k++) {
      const a = (k / Math.max(1, d * 2)) * Math.PI * 2;
      const cx = Math.round(x + Math.cos(a) * d);
      const cy = Math.round(y + Math.sin(a) * d);
      if (world.settlements.some((s) => Math.hypot(s.x - cx, s.y - cy) < APART)) continue;
      if (homes.some((h) => Math.abs(h.x - cx) + Math.abs(h.y - cy) < APART - 6)) continue;
      const score = flatDry(world, cx, cy, 8) + d * 1.5;
      if (score < bestScore) {
        bestScore = score;
        best = { x: cx, y: cy };
      }
    }
  return bestScore < Infinity ? best : null;
}

export interface VillageMade {
  x: number;
  y: number;
  name: string;
  houses: number;
  villagers: number;
}

// A real village, as the generator makes them (4.6, the owner: "the village
// spell should actually create a village as the generation does").
export function makeVillage(
  world: World,
  x: number,
  y: number,
  o: { houses?: number; name?: string; villagers?: number },
  seed: number,
  biomes: readonly Biome[] = BIOMES,
): VillageMade | null {
  if (world.settlements.length >= 12) return null;
  const at = villageSpot(world, x, y);
  if (!at) return null;
  const rng = new Rng(seed);
  const houses = Math.max(3, Math.min(14, Math.round(o.houses ?? 7)));
  // Clear the wood and boulders where it will stand; other villages' fields stay.
  const W = world.w;
  for (let yy = at.y - 10; yy <= at.y + 10; yy++)
    for (let xx = at.x - 10; xx <= at.x + 10; xx++) {
      if (!world.inside(xx, yy) || Math.hypot(xx - at.x, yy - at.y) > 10) continue;
      const i = yy * W + xx;
      const c = world.cover[i];
      if (c !== C.NONE && !isBuilding(c) && c !== C.CROP && c !== C.WELL) world.setCover(i, C.NONE);
    }
  const before = new Set<number>();
  for (let i = 0; i < world.n; i++) if (world.cover[i] === C.HOUSE) before.add(i);
  buildVillage(world, at.x, at.y, rng, houses);
  const s: Settlement = { x: at.x, y: at.y, style: 0, level: 1, jobs: [], store: 0, street: 0, name: "" };
  world.settlements.push(s);
  dressSettlement(world, s, biomes);
  firstWell(world, s);
  layOutVillage(world, s, rng, biomes);
  if (typeof o.name === "string" && o.name.trim()) s.name = o.name.trim().slice(0, 24);
  // Its people: two to a house, dressed in its own clothes.
  const homes: number[] = [];
  for (let i = 0; i < world.n; i++) if (world.cover[i] === C.HOUSE && !before.has(i)) homes.push(i);
  const style = (world.settlements.length - 1 + world.seed) % 6;
  const most = Math.max(2, Math.min(30, Math.round(o.villagers ?? homes.length / 2)));
  let made = 0;
  for (let k = 0; k < homes.length && made < most && world.creatures.length < 600; k += 4)
    for (let n = 0; n < 2 && made < most; n++) {
      const i = homes[k];
      const c = makeCreature("villager", (i % W) + 0.5 + rng.range(-1, 1), Math.floor(i / W) + 2.5);
      c.homeX = c.x;
      c.homeY = c.y;
      dress(c, style);
      world.creatures.push(c);
      made++;
    }
  tell(world, `a new village was founded${s.name ? `: ${s.name}` : ""}`);
  return { x: at.x, y: at.y, name: s.name ?? "", houses: Math.round(homes.length / 4), villagers: made };
}

export interface BuildingMade {
  x: number;
  y: number;
  job: string;
  village: string | null;
  // A free cell next to it, toward open ground: where what makes it this
  // building goes (a chimney, a spire, a sign). Its own four cells are drawn
  // by the island's builder and stay clear.
  beside: { x: number; y: number };
}

// A house or a building with a job, two by two cells, near (x, y). Its look
// is the seeded builder's, in the style of the village it joins; its job
// works for that village (buildings.ts). On no free block within six cells
// it clears one at (x, y), never over water, another building or a field.
export function makeBuilding(world: World, x: number, y: number, job: string): BuildingMade | null {
  const id = BUILDING_JOBS[job] ?? C.HOUSE;
  const name = BUILDING_JOBS[job] !== undefined ? job : "house";
  let at = -1;
  for (let d = 0; d <= 6 && at < 0; d++)
    for (let dy = -d; dy <= d && at < 0; dy++)
      for (let dx = -d; dx <= d && at < 0; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        at = block(world, Math.round(x) + dx, Math.round(y) + dy);
      }
  if (at < 0) {
    const bx = Math.round(x);
    const by = Math.round(y);
    if (bx < 1 || by < 1 || bx + 2 >= world.w || by + 2 >= world.h) return null;
    const i = by * world.w + bx;
    const cells = [i, i + 1, i + world.w, i + world.w + 1];
    if (cells.some((j) => world.depth[j] > 0 || world.fluid[j] !== F.NONE || isBuilding(world.cover[j]) || world.ground[j] === G.FIELD)) return null;
    const h = world.height[i];
    for (const j of cells) world.height[j] = h + (world.height[j] - h) * 0.2;
    at = i;
  }
  for (const j of [at, at + 1, at + world.w, at + world.w + 1]) {
    world.ground[j] = G.DIRT;
    world.setCover(j, id);
  }
  const bx = at % world.w;
  const by = Math.floor(at / world.w);
  const s = settlementNear(world, bx, by);
  if (s && id !== C.HOUSE) (s.jobs ??= []).push({ kind: id, i: at });
  if (id !== C.HOUSE) tell(world, s?.name ? `${s.name} raised a ${name}` : `a ${name} was raised`);
  // Beside it: the first open cell of the ring round its block.
  let beside = { x: bx + 2, y: by };
  for (const [dx, dy] of [
    [2, 0],
    [2, 1],
    [-1, 0],
    [-1, 1],
    [0, 2],
    [1, 2],
    [0, -1],
    [1, -1],
  ]) {
    const x = bx + dx;
    const y = by + dy;
    if (!world.inside(x, y)) continue;
    const j = y * world.w + x;
    if (world.depth[j] === 0 && !isBuilding(world.cover[j])) {
      beside = { x, y };
      break;
    }
  }
  return { x: bx + 1, y: by + 1, job: name, village: s?.name || null, beside };
}

// The shapes land can take, each from the generator's own rules: water kept
// by a spring at the deepest cell (land.ts), slopes eased so walkers climb,
// a volcano's vent a lava spring that never sets.
export const LAND_SHAPES = [
  "hill",
  "mountain",
  "volcano",
  "lake",
  "pond",
  "canyon",
  "valley",
  "crater",
  "oasis",
  "swamp",
  "mesa",
  "island",
  "glacier",
  "dunes",
] as const;
export type LandShape = (typeof LAND_SHAPES)[number];

const smooth = (k: number) => k * k * (3 - 2 * k);

function disc(world: World, x: number, y: number, r: number, f: (i: number, k: number, cx: number, cy: number) => void): void {
  const r2 = r * r;
  for (let cy = Math.max(0, Math.floor(y - r)); cy <= Math.min(world.h - 1, Math.ceil(y + r)); cy++)
    for (let cx = Math.max(0, Math.floor(x - r)); cx <= Math.min(world.w - 1, Math.ceil(x + r)); cx++) {
      const d2 = (cx - x) ** 2 + (cy - y) ** 2;
      if (d2 > r2) continue;
      f(cy * world.w + cx, 1 - Math.sqrt(d2) / r, cx, cy);
    }
}

// Covers a reshaping takes away: plants and stones. Buildings on raised or
// sunk land fall to rubble, as a quake leaves them.
function strip(world: World, i: number, ruin: boolean): void {
  const c = world.cover[i];
  if (isBuilding(c)) {
    if (ruin) world.setCover(i, C.RUBBLE);
  } else if (c !== C.NONE && c !== C.WONDER) world.setCover(i, C.NONE);
}

// A basin filled with water to a level, kept there by a spring at its deepest cell.
function fillTo(world: World, x: number, y: number, r: number, level: number): number {
  let deepest = -1;
  disc(world, x, y, r, (i) => {
    if (world.height[i] < level - 0.05) {
      world.setFluid(i, F.WATER, level - world.height[i]);
      if (deepest < 0 || world.height[i] < world.height[deepest]) deepest = i;
    }
  });
  if (deepest >= 0) world.springs.push({ i: deepest, level, rate: 1.2 });
  return deepest;
}

export interface LandMade {
  shape: LandShape;
  cells: number;
}

// The terrain reshaped round (x, y) within r cells. `height` scales the
// shape (positive up, negative down); every shape has its own default.
export function shapeLand(world: World, x: number, y: number, shape: string, r: number, height: number | null, seed: number): LandMade | null {
  const s = (LAND_SHAPES as readonly string[]).includes(shape) ? (shape as LandShape) : null;
  if (!s || !world.inside(Math.round(x), Math.round(y))) return null;
  const rng = new Rng(seed);
  const R = Math.max(3, Math.min(60, r));
  const base = world.height[world.idx(Math.round(x), Math.round(y))];
  const sea = world.seaLevel;
  let cells = 0;
  const lift = (i: number, dh: number, ruin = Math.abs(dh) > 1.5) => {
    if (Math.abs(dh) < 0.05) return;
    // Raised land sheds the water that stood on it; a hollow keeps its own.
    const level = world.height[i] + world.depth[i];
    world.height[i] += dh;
    if (dh > 0 && world.fluid[i] !== F.NONE) {
      if (world.height[i] >= level) world.setFluid(i, F.NONE, 0);
      else world.setFluid(i, world.fluid[i], level - world.height[i]);
    }
    strip(world, i, ruin);
    cells++;
  };
  switch (s) {
    case "hill":
    case "mountain": {
      const h = height ?? (s === "hill" ? Math.min(10, R * 0.8) : Math.min(40, R * 1.6));
      const snow = s === "mountain" ? base + h * 0.7 : Infinity;
      disc(world, x, y, R, (i, k) => {
        const n = 0.85 + 0.3 * rng.next() * k;
        lift(i, h * smooth(k) * (s === "mountain" ? n : 1), false);
        if (s === "mountain") world.ground[i] = world.height[i] > snow ? G.SNOW : k > 0.35 ? G.ROCK : world.ground[i];
      });
      break;
    }
    case "volcano": {
      const h = height ?? Math.min(30, R * 1.3);
      let vent = -1;
      disc(world, x, y, R, (i, k) => {
        // A cone with a crater in its top fifth.
        const cone = k > 0.8 ? h * (0.8 - (k - 0.8) * 2) : h * smooth(k / 0.8) * 0.8 + h * 0.2 * (k / 0.8);
        lift(i, cone);
        world.ground[i] = k > 0.5 ? G.BASALT : k > 0.2 ? G.ROCK : world.ground[i];
        if (k > 0.85 && (vent < 0 || k > 0.97)) vent = i;
      });
      if (vent >= 0) {
        disc(world, x, y, Math.max(1.2, R * 0.12), (i) => world.setFluid(i, F.LAVA, 0.8));
        world.springs.push({ i: vent, level: world.height[vent] + 0.8, lava: true, rate: 0.6 });
      }
      break;
    }
    case "lake":
    case "pond": {
      const d = height !== null ? -Math.abs(height) : s === "lake" ? -Math.min(4, 1.2 + R * 0.25) : -1.4;
      disc(world, x, y, R, (i, k) => {
        lift(i, d * smooth(Math.min(1, k * 1.6)));
        if (k > 0.2) world.ground[i] = G.SAND;
      });
      fillTo(world, x, y, R, base - 0.2);
      break;
    }
    case "canyon":
    case "valley": {
      const a = rng.next() * Math.PI;
      const len = R * 2;
      const deep = height !== null ? -Math.abs(height) : s === "canyon" ? -Math.min(16, R * 0.9) : -Math.min(8, R * 0.4);
      const width = s === "canyon" ? Math.max(1.5, R * 0.18) : Math.max(3, R * 0.45);
      const done = new Set<number>();
      for (let t = -len / 2; t <= len / 2; t += 0.5) {
        const wob = Math.sin(t * 0.35 + rng.next() * 0.2) * width * 0.6;
        const px = x + Math.cos(a) * t - Math.sin(a) * wob;
        const py = y + Math.sin(a) * t + Math.cos(a) * wob;
        disc(world, px, py, width * 1.6, (i, k) => {
          if (done.has(i)) return;
          done.add(i);
          const f = s === "canyon" ? (k > 0.35 ? 1 : k / 0.35) : smooth(k);
          lift(i, deep * f * (1 - Math.abs(t) / (len * 0.7)));
          if (s === "canyon") world.ground[i] = G.ROCK;
        });
      }
      break;
    }
    case "crater": {
      const d = height !== null ? -Math.abs(height) : -Math.min(8, R * 0.5);
      disc(world, x, y, R * 1.25, (i, k) => {
        const inner = k > 0.2 ? d * smooth((k - 0.2) / 0.8) : 0;
        const rim = k > 0.1 && k < 0.35 ? -d * 0.35 * Math.sin(((k - 0.1) / 0.25) * Math.PI) : 0;
        lift(i, inner + rim);
        if (k > 0.2) world.ground[i] = k > 0.8 ? G.ASH : G.ROCK;
      });
      break;
    }
    case "oasis": {
      const pool = Math.max(2, R * 0.35);
      disc(world, x, y, R, (i, k) => {
        world.ground[i] = k > 0.35 ? G.GRASS : G.SAND;
        strip(world, i, false);
        cells++;
      });
      disc(world, x, y, pool, (i, k) => lift(i, -1.6 * smooth(Math.min(1, k * 1.4))));
      fillTo(world, x, y, pool, base - 0.2);
      // Palms and reeds round the pool.
      disc(world, x, y, R * 0.75, (i, k) => {
        if (world.depth[i] > 0 || k > 0.75) return;
        const r = rng.next();
        if (r < 0.16) world.setCover(i, C.TREE);
        else if (r < 0.26) world.setCover(i, C.REEDS);
        else if (r < 0.32) world.setCover(i, C.FLOWER);
      });
      break;
    }
    case "swamp": {
      disc(world, x, y, R, (i, k) => {
        const n = rng.next();
        const h = sea + 0.4 + n * 0.7;
        if (world.height[i] > h) lift(i, (h - world.height[i]) * smooth(Math.min(1, k * 2)), false);
        world.ground[i] = G.DIRT;
        strip(world, i, false);
        if (n < 0.3 && k > 0.15) world.setFluid(i, F.WATER, 0.5);
        else if (n < 0.42) world.setFluid(i, F.MUD, 0.4);
        else if (n < 0.62) world.setCover(i, C.REEDS);
        else if (n < 0.7) world.setCover(i, C.TREE);
      });
      break;
    }
    case "mesa": {
      const h = height ?? Math.min(18, R * 1.1);
      disc(world, x, y, R, (i, k) => {
        lift(i, h * Math.min(1, k * 3.2), false);
        world.ground[i] = k < 0.3 ? G.ROCK : world.ground[i];
      });
      break;
    }
    case "island": {
      // Land out of the sea, or raised from the shore, to a beach and a green top.
      const top = Math.max(sea + 2, sea + (height ?? 5));
      disc(world, x, y, R, (i, k) => {
        const want = sea - 1 + (top - sea + 1) * smooth(Math.min(1, k * 1.5));
        if (want > world.height[i]) {
          lift(i, want - world.height[i], false);
          world.setFluid(i, F.NONE, 0);
        }
        world.ground[i] = world.height[i] < sea + 1.2 ? G.SAND : G.GRASS;
        if (world.height[i] > sea + 1.5 && rng.next() < 0.12) world.setCover(i, C.TREE);
      });
      break;
    }
    case "glacier": {
      disc(world, x, y, R, (i, k) => {
        world.ground[i] = G.SNOW;
        strip(world, i, false);
        if (k > 0.25) world.setFluid(i, F.ICE, 0.6 + k * 1.2);
        world.temp[i] = Math.min(world.temp[i], -15);
        cells++;
      });
      break;
    }
    case "dunes": {
      const a = rng.next() * Math.PI;
      disc(world, x, y, R, (i, k, cx, cy) => {
        const along = (cx - x) * Math.cos(a) + (cy - y) * Math.sin(a);
        lift(i, (height ?? 3) * smooth(k) * (0.5 + 0.5 * Math.sin(along * 0.7)), false);
        world.ground[i] = G.SAND;
        if (world.cover[i] !== C.CACTUS && rng.next() < 0.02) world.setCover(i, C.CACTUS);
      });
      break;
    }
  }
  const sank = s === "lake" || s === "pond" || s === "canyon" || s === "valley" || s === "crater";
  tell(world, `the land changed: ${/^[aeiou]/.test(s) ? "an" : "a"} ${s} ${sank ? "opened" : "rose"}`);
  return { shape: s, cells };
}

// One of the island's built-in wonders at (x, y). Null when the island
// already holds as many as it may, or the kind is not one of them.
export function makeWonder(world: World, kind: string, x: number, y: number, seed: number): Wonder | null {
  const k = kind.toLowerCase().trim();
  if (!WONDER_KINDS.has(k)) return null;
  const w = placeWonderAt(world, k, x, y, seed);
  if (w) tell(world, `${w.name} appeared`);
  return w;
}

export const WONDER_LIST = [...WONDER_KINDS.keys()];
