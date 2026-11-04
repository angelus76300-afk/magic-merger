import { C, F, G, type Material } from "./materials";
import { Rng, fbm, valueNoise } from "./noise";
import { SPECIES, type Species } from "./wildlife";
import type { World } from "./world";

// Islands of every kind (4.4): a biome, a shape and three sliders, chosen at
// reset with a seed. The simulation keeps its one set of materials (grass is
// grass in the desert too, so every species' habitat, every spell's rules and
// every lure keep working); a biome changes the climate, the palette, the
// trees drawn and the weather, and where each material goes.
//
// Heights are built in four steps: a shape (where the land and the water are),
// rescaled from its own distribution (so the water slider means a share of
// the island, whatever the noise did), the biome's own relief (a volcano, mesa
// terraces), then water: every depression is filled from the island's edge
// inward (priority flood, Barnes et al. 2014), which gives each cell the way
// its water drains and the lakes; the drained area of each cell (flow
// accumulation) says where rivers run and how big they are. Rivers are carved
// along that drainage, always downhill, filled with water, and fed by springs
// at their heads; water leaves the island over its edge, so they keep
// flowing.

export const BIOMES = ["temperate", "desert", "tundra", "jungle", "swamp", "volcanic", "mesa"] as const;
export type Biome = (typeof BIOMES)[number];
export const SHAPES = ["coast", "archipelago", "plateau", "ridges", "lakes", "delta"] as const;
export type Shape = (typeof SHAPES)[number];

export interface LandOptions {
  biome: Biome;
  shape: Shape;
  // 0 to 1 each: how much of the island is water, how high the mountains
  // rise, how much of the land is forest.
  water: number;
  relief: number;
  forest: number;
}

export const DEFAULT_LAND: LandOptions = { biome: "temperate", shape: "coast", water: 0.5, relief: 0.5, forest: 0.5 };

export const BIOME_LABELS: Record<Biome, string> = {
  temperate: "Temperate forest",
  desert: "Desert",
  tundra: "Tundra",
  jungle: "Jungle",
  swamp: "Swamp",
  volcanic: "Volcanic",
  mesa: "Mesa",
};

export const SHAPE_LABELS: Record<Shape, string> = {
  coast: "Coast",
  archipelago: "Archipelago",
  plateau: "Plateaus",
  ridges: "Ridges",
  lakes: "Inland lakes",
  delta: "Delta",
};

// A save, a message or a stored choice, read back safely.
export function readLand(v: unknown): LandOptions {
  const o = (v ?? {}) as Partial<Record<keyof LandOptions, unknown>>;
  const unit = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d);
  return {
    biome: BIOMES.includes(o.biome as Biome) ? (o.biome as Biome) : DEFAULT_LAND.biome,
    shape: SHAPES.includes(o.shape as Shape) ? (o.shape as Shape) : DEFAULT_LAND.shape,
    water: unit(o.water, DEFAULT_LAND.water),
    relief: unit(o.relief, DEFAULT_LAND.relief),
    forest: unit(o.forest, DEFAULT_LAND.forest),
  };
}

export type Weather = "clear" | "rain" | "snow" | "fog";

export interface BiomeLook {
  // Degrees added to the ambient temperature, and where and how fast it falls
  // with height (height units, degrees per unit). The defaults are the old
  // island's: 15 degrees, falling 2.5 a unit above 24.
  climate: number;
  lapseFrom: number;
  lapse: number;
  // Colors that replace the built-in ones, by material name.
  palette: Record<string, number[]>;
  // The island's cut sides: soil, clay, stone, deep stone.
  strata: { dirt: number; clay: number; stone: number; deep: number };
  // Models drawn for trees: low and high.
  trees: [string, string];
  // How often each kind of weather comes, out of 1 (the rest is clear).
  weather: Partial<Record<Weather, number>>;
  // Water's color in the view: shallow and deep.
  water: [number, number];
}

const TEMPERATE_STRATA = { dirt: 0x7a5a3a, clay: 0x8f6a45, stone: 0x6f6f78, deep: 0x4a4752 };

export const LOOKS: Record<Biome, BiomeLook> = {
  temperate: {
    climate: 0,
    lapseFrom: 24,
    lapse: 2.5,
    palette: {},
    strata: TEMPERATE_STRATA,
    trees: ["tree", "pine"],
    weather: { rain: 0.25, fog: 0.08 },
    water: [0x4aa0dc, 0x1d5a9e],
  },
  desert: {
    climate: 14,
    lapseFrom: 24,
    lapse: 2.5,
    palette: {
      grass: [0xa3a64c, 0xafae56, 0x989a44, 0xb8b35e],
      sand: [0xe8cc8c, 0xf0d69e, 0xdec07e],
      dirt: [0xb48658, 0xa87c50, 0xbf9062],
      rock: [0xb89c78, 0xab8f6e, 0xc4a884, 0xa38866],
      bush: [0x8a9a48, 0x96a452, 0x7f8e40],
    },
    strata: { dirt: 0xc49a62, clay: 0xd2a46c, stone: 0xa98b6a, deep: 0x7d6450 },
    trees: ["palm", "palm"],
    weather: { rain: 0.04 },
    water: [0x4cc0d0, 0x1d6f9e],
  },
  tundra: {
    climate: -10,
    lapseFrom: 9,
    lapse: 1.25,
    palette: {
      grass: [0x8b9b6b, 0x95a374, 0x808f63, 0x9cab7c],
      dirt: [0x6e6252, 0x786a58, 0x64584a],
      rock: [0x7f848c, 0x757a82, 0x8a8f96, 0x6f747c],
      bush: [0x6f8a5a, 0x7a9462, 0x667f52],
    },
    strata: { dirt: 0x6a5c4a, clay: 0x7a6c58, stone: 0x6e7480, deep: 0x474c58 },
    trees: ["snowpine", "snowpine"],
    weather: { snow: 0.4, fog: 0.1 },
    water: [0x5a9cc8, 0x1d4a7e],
  },
  jungle: {
    climate: 10,
    lapseFrom: 26,
    lapse: 2.5,
    palette: {
      grass: [0x3f9a35, 0x47a83b, 0x388f2f, 0x52b246],
      dirt: [0x6b4a2e, 0x744f30, 0x62432a],
      bush: [0x2f7d2a, 0x388a31, 0x2a7026],
    },
    strata: { dirt: 0x6a4428, clay: 0x8a5a36, stone: 0x5f6458, deep: 0x3f443a },
    trees: ["jungle", "jungle"],
    weather: { rain: 0.45, fog: 0.15 },
    water: [0x46b0a0, 0x1d6a6e],
  },
  swamp: {
    climate: 6,
    lapseFrom: 24,
    lapse: 2.5,
    palette: {
      grass: [0x5f7d3a, 0x6a8742, 0x566f34, 0x738f4a],
      dirt: [0x4e3f2c, 0x574632, 0x463826],
      sand: [0x8e8462, 0x998e6a, 0x847a5a],
      bush: [0x4a6a30, 0x527438, 0x42602a],
    },
    strata: { dirt: 0x4e3f2c, clay: 0x5e4c34, stone: 0x5a5c58, deep: 0x3a3c3a },
    trees: ["willow", "willow"],
    weather: { fog: 0.45, rain: 0.2 },
    water: [0x5a8a62, 0x24463a],
  },
  volcanic: {
    climate: 4,
    lapseFrom: 24,
    lapse: 2.5,
    palette: {
      grass: [0x5a8d3c, 0x649a42, 0x528236, 0x6ea54a],
      dirt: [0x4c3e36, 0x56463c, 0x443830],
      rock: [0x5c5856, 0x666260, 0x524e4c, 0x6e6a68],
      sand: [0x6a625a, 0x766e64, 0x5e5650],
    },
    strata: { dirt: 0x4a3c34, clay: 0x5a4a40, stone: 0x4a4648, deep: 0x2e2a2c },
    trees: ["pine", "pine"],
    weather: { fog: 0.2, rain: 0.1 },
    water: [0x4a92c0, 0x1a3f6e],
  },
  mesa: {
    climate: 10,
    lapseFrom: 30,
    lapse: 2.5,
    palette: {
      grass: [0x9e9a52, 0xaaa45a, 0x928e4a, 0xb4ae62],
      dirt: [0xb8653a, 0xc4703f, 0xa95c34],
      sand: [0xdc9c5a, 0xe4a866, 0xd29050],
      rock: [0xa8583a, 0xb86a44, 0x9a4e32, 0xc47a50],
      bush: [0x7f8a44, 0x8a944c, 0x74803c],
    },
    strata: { dirt: 0xc06a3e, clay: 0xd88a52, stone: 0xa04e34, deep: 0x7a3a2a },
    trees: ["juniper", "juniper"],
    weather: { rain: 0.06 },
    water: [0x4ab0c8, 0x1d5f8e],
  },
};

// The biome's climate and colors on a world, from its land: at generation
// and again when a save is loaded (colors are not saved).
export function applyLand(world: World, land: LandOptions): void {
  world.land = land;
  const look = LOOKS[land.biome];
  world.climate = look.climate;
  world.lapseFrom = look.lapseFrom;
  world.lapse = look.lapse;
  for (const [name, colors] of Object.entries(look.palette)) {
    const found = world.materials.find(name);
    if (!found) continue;
    const m: Material = world.materials.get(found.layer, found.id);
    // A copy: the built-in tables are shared by every world.
    world.materials.list[found.layer][found.id] = { ...m, colors };
  }
}

// --- Heights -----------------------------------------------------------

const SEA = 8;

// Raw heights for a shape, in no particular unit: only their order matters,
// since they are rescaled from their own distribution afterwards.
function shapeHeights(w: number, h: number, seed: number, shape: Shape, rng: Rng): { raw: Float32Array; side: number } {
  const out = new Float32Array(w * h);
  const scale = 1 / 48;
  const coastX = rng.next() < 0.5 ? 0 : w;
  const coastY = rng.next() < 0.5 ? 0 : h;
  // Island centers for an archipelago, basins for lakes.
  const spots: { x: number; y: number; r: number }[] = [];
  if (shape === "archipelago") {
    const count = rng.int(5, 8);
    for (let k = 0; k < count * 6 && spots.length < count; k++) {
      const x = rng.range(0.15, 0.85) * w;
      const y = rng.range(0.15, 0.85) * h;
      const r = rng.range(0.13, 0.24) * Math.min(w, h);
      if (spots.some((s) => Math.hypot(s.x - x, s.y - y) < (s.r + r) * 0.75)) continue;
      spots.push({ x, y, r });
    }
  } else if (shape === "lakes") {
    const count = rng.int(3, 5);
    for (let k = 0; k < count * 8 && spots.length < count; k++) {
      const x = rng.range(0.2, 0.8) * w;
      const y = rng.range(0.2, 0.8) * h;
      const r = rng.range(0.08, 0.15) * Math.min(w, h);
      if (spots.some((s) => Math.hypot(s.x - x, s.y - y) < s.r + r + 6)) continue;
      spots.push({ x, y, r });
    }
  }
  // The delta's land falls toward one side.
  const side = rng.int(0, 3);
  const angle = rng.range(0, Math.PI);
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const n = fbm(x * scale, y * scale, seed);
      const ridge = 1 - Math.abs(fbm(x * scale * 0.7, y * scale * 0.7, seed + 31) * 2 - 1);
      // A warped position, so masks and ranges never come out as circles
      // and straight lines.
      const wx = x + (fbm(x / 40, y / 40, seed + 61, 3) - 0.5) * Math.min(w, h) * 0.25;
      const wy = y + (fbm(x / 40, y / 40, seed + 67, 3) - 0.5) * Math.min(w, h) * 0.25;
      const u = x / w;
      const v = y / h;
      // Distance to the nearest edge, 0 at the edge and 0.5 in the middle.
      const edge = Math.min(u, v, 1 - u, 1 - v);
      let e: number;
      switch (shape) {
        case "coast":
        case "plateau": {
          const coast = Math.hypot((x - coastX) / w, (y - coastY) / h);
          e = n * 26 + ridge * ridge * 6 + Math.min(1, coast * 1.4) * 9;
          break;
        }
        case "archipelago": {
          let mask = 0;
          for (const s of spots) mask = Math.max(mask, 1 - Math.hypot(wx - s.x, wy - s.y) / s.r);
          // Low and broad islands: the mask lifts the land, noise shapes it.
          const m = Math.min(1, Math.max(0, mask * 1.7));
          e = m * 14 + n * 18 * Math.sqrt(m) + ridge * 3 - (edge < 0.08 ? (0.08 - edge) * 60 : 0);
          break;
        }
        case "ridges": {
          // Long ranges along one direction, valleys between.
          const along = (wx * ca + wy * sa) * scale * 0.7;
          const across = (-wx * sa + wy * ca) * scale * 1.25;
          const r = 1 - Math.abs(fbm(along, across, seed + 57, 4) * 2 - 1);
          e = n * 12 + r ** 2.4 * 26 + Math.min(1, edge * 6) * 4;
          break;
        }
        case "lakes": {
          let dip = 0;
          for (const s of spots) {
            const d = Math.hypot(wx - s.x, wy - s.y) / s.r;
            if (d < 1.8) dip = Math.max(dip, Math.exp(-d * d * 1.4));
          }
          // Higher toward the edges, so the water stays inland.
          e = n * 20 + ridge * 6 + Math.min(1, edge * 7) * 7 - dip * 16;
          break;
        }
        case "delta": {
          const t = [u, v, 1 - u, 1 - v][side];
          e = t * 13 + n * 13 + ridge * 3 - (t < 0.2 ? (0.2 - t) * 30 : 0);
          break;
        }
      }
      out[i] = e;
    }
  }
  return { raw: out, side };
}

// Rescales raw heights so that `seaShare` of the cells lie under the sea
// (at 8) and the highest reach 8 + peak.
function rescale(height: Float32Array, seaShare: number, peak: number): void {
  const sorted = Float32Array.from(height).sort();
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
  const low = at(0.01);
  const sea = at(seaShare);
  const high = at(0.997);
  for (let i = 0; i < height.length; i++) {
    const v = height[i];
    height[i] = v < sea ? SEA - ((sea - v) / Math.max(0.01, sea - low)) * 6 : SEA + Math.min(1.08, (v - sea) / Math.max(0.01, high - sea)) * peak;
  }
}

// Flat tops and steep risers, a few units a step (mesa and plateau).
function terrace(height: Float32Array, step: number, steepness: number): void {
  for (let i = 0; i < height.length; i++) {
    const v = height[i];
    if (v <= SEA + 0.6) continue;
    const t = (v - SEA) / step;
    const f = t - Math.floor(t);
    const k = Math.min(1, Math.max(0, (f - (1 - steepness)) / steepness));
    height[i] = SEA + (Math.floor(t) + k * k * (3 - 2 * k)) * step;
  }
}

// --- Water ---------------------------------------------------------------

// A binary heap of cell indices keyed by a Float32Array.
class Heap {
  private items: number[] = [];
  constructor(private key: Float32Array) {}
  get size(): number {
    return this.items.length;
  }
  push(i: number): void {
    const a = this.items;
    a.push(i);
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.key[a[p]] <= this.key[a[c]]) break;
      [a[p], a[c]] = [a[c], a[p]];
      c = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1;
        const r = l + 1;
        let m = p;
        if (l < a.length && this.key[a[l]] < this.key[a[m]]) m = l;
        if (r < a.length && this.key[a[r]] < this.key[a[m]]) m = r;
        if (m === p) break;
        [a[p], a[m]] = [a[m], a[p]];
        p = m;
      }
    }
    return top;
  }
}

const N4: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export interface Drainage {
  // The surface with every depression filled up to its spill point, rising a
  // little toward the source so every cell drains somewhere.
  filled: Float32Array;
  // Where each cell's water goes next (-1 at the edge, where it leaves).
  to: Int32Array;
  // Cells whose water passes through each cell, itself included.
  area: Float32Array;
  // Cells from the edge inward: a cell comes after the one it drains to.
  order: Int32Array;
}

// Priority flood from the island's edge, then flow accumulation.
export function drainage(world: World): Drainage {
  const { w, h, n, height } = world;
  const filled = new Float32Array(n);
  const to = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const order = new Int32Array(n);
  const heap = new Heap(filled);
  for (let i = 0; i < n; i++) {
    const x = i % w;
    const y = (i / w) | 0;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
      filled[i] = height[i];
      done[i] = 1;
      heap.push(i);
    }
  }
  let k = 0;
  while (heap.size) {
    const i = heap.pop();
    order[k++] = i;
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (done[j]) continue;
      done[j] = 1;
      // A cell lower than the one it was reached from is in a depression:
      // raised to just above it, so its water flows out the way it came.
      filled[j] = Math.max(height[j], filled[i] + 0.0005);
      to[j] = i;
      heap.push(j);
    }
  }
  // Upstream cells were reached last: accumulate in reverse order.
  const area = new Float32Array(n).fill(1);
  for (let q = n - 1; q >= 0; q--) {
    const i = order[q];
    if (to[i] >= 0) area[to[i]] += area[i];
  }
  return { filled, to, area, order };
}

export interface Spring {
  i: number;
  // The level (land plus fluid) the spring keeps its cell at, its fluid, and
  // how fast it fills (depth per second): a big lake loses more to the sun.
  level: number;
  lava?: boolean;
  rate?: number;
}

// One spring per body of still water above the sea (lakes, pools), at its
// deepest cell, so evaporation never empties them; the biggest first.
function lakeSprings(world: World, max: number): Spring[] {
  const { w, h, n } = world;
  const seen = new Uint8Array(n);
  const lakes: { i: number; size: number; level: number }[] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s] || world.fluid[s] !== F.WATER || world.depth[s] < 0.25 || world.height[s] + world.depth[s] < world.seaLevel + 0.3) continue;
    let deepest = s;
    let size = 0;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      if (world.depth[i] > world.depth[deepest]) deepest = i;
      const x = i % w;
      const y = (i / w) | 0;
      for (const [dx, dy] of N4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (seen[j] || world.fluid[j] !== F.WATER || world.depth[j] < 0.25 || world.height[j] + world.depth[j] < world.seaLevel + 0.3) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (size >= 4) lakes.push({ i: deepest, size, level: world.height[deepest] + world.depth[deepest] });
  }
  lakes.sort((a, b) => b.size - a.size || a.i - b.i);
  // Evaporation is 0.004 a second over the whole lake, refilled through one cell.
  return lakes.slice(0, max).map((l) => ({ i: l.i, level: l.level, rate: Math.min(12, Math.max(1.2, l.size * 0.008)) }));
}

// Lakes in every depression deep enough, rivers along the drainage, springs
// at the river heads. Returns the river cells, for banks and villages.
function water(world: World, land: LandOptions): { river: Uint8Array; area: Float32Array } {
  const { w, n, height } = world;
  const { filled, to, area, order } = drainage(world);
  const river = new Uint8Array(n);
  // Lakes: water up to the spill point where it is deep enough to see. A
  // lake's bottom may lie below the sea's level: it is a lake when its spill
  // point is above the sea (the sea itself spills at the island's edge).
  const lake = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = filled[i] - height[i];
    if (filled[i] < world.seaLevel + 0.3 || d < 0.6) continue;
    world.setFluid(i, F.WATER, d);
    lake[i] = 1;
  }
  // Rivers: cells draining more than a share of the island. Wetter biomes
  // have more, smaller rivers; the desert one or two.
  const wet = { temperate: 1, desert: 2.4, tundra: 1.2, jungle: 0.55, swamp: 0.7, volcanic: 1.3, mesa: 1.8 }[land.biome];
  const threshold = Math.max(40, (n / 160) * wet * (1.4 - land.water * 0.8));
  // Upstream first, so a bed is always lower than the one above it.
  // Only streams that grow into a river are drawn: a cell is kept when the
  // water through it later drains at least four times the threshold.
  const big = new Uint8Array(n);
  for (let q = 0; q < n; q++) {
    const i = order[q];
    big[i] = area[i] >= threshold * 4 || (to[i] >= 0 && big[to[i]]) ? 1 : 0;
  }
  const cells: number[] = [];
  for (let i = 0; i < n; i++) if (area[i] >= threshold && big[i] && height[i] >= world.seaLevel - 0.5) cells.push(i);
  cells.sort((a, b) => filled[b] - filled[a]);
  const bed = new Float32Array(n).fill(Infinity);
  // The surface of the lake a river last left, for the cells below it.
  const lakeAbove = new Float32Array(n).fill(-Infinity);
  const inLake = (i: number) => lake[i] === 1;
  const heads: number[] = [];
  for (const i of cells) {
    const size = Math.log2(area[i] / threshold);
    // At most 1.4 deep and 0.9 of water: walkers ford every river (paths.ts).
    const cut = Math.min(1.4, 0.45 + size * 0.28);
    // A head: no river cell flows into it.
    if (bed[i] === Infinity) heads.push(i);
    let b: number;
    if (inLake(i)) {
      // Through a lake the river is the lake: it leaves at the surface.
      b = filled[i] - 0.05;
      const next = to[i];
      if (next >= 0) lakeAbove[next] = Math.max(lakeAbove[next], filled[i]);
    } else {
      b = Math.min(height[i] - cut, bed[i]);
      // An outlet is cut at most half a unit below its lake, so carving the
      // river does not drain the lake it comes from.
      if (lakeAbove[i] > -Infinity) {
        b = Math.max(b, lakeAbove[i] - 0.5);
        const next = to[i];
        if (next >= 0 && b > lakeAbove[i] - 0.5 - 0.001) lakeAbove[next] = Math.max(lakeAbove[next], lakeAbove[i] - 0.03);
      }
      if (world.depth[i] > 0) b = Math.min(b, height[i]);
    }
    bed[i] = b;
    river[i] = 1;
    const next = to[i];
    if (next >= 0) bed[next] = Math.min(bed[next], b - 0.03);
  }
  for (const i of cells) {
    if (inLake(i)) continue;
    const size = Math.log2(area[i] / threshold);
    const deep = Math.min(0.9, 0.35 + size * 0.16);
    if (height[i] >= world.seaLevel) {
      height[i] = Math.max(world.seaLevel - 0.6, Math.min(height[i], bed[i]));
      world.setFluid(i, F.WATER, deep);
    }
    // Bigger rivers are wider: the banks either side are lowered a little.
    if (size > 1.6) {
      const x = i % w;
      const y = (i / w) | 0;
      for (const [dx, dy] of N4) {
        if (!world.inside(x + dx, y + dy)) continue;
        const j = (y + dy) * w + x + dx;
        if (river[j] || height[j] < world.seaLevel || world.depth[j] > 0 || byLake(world, j)) continue;
        height[j] = Math.max(height[i] + 0.25, height[j] - 0.6);
      }
    }
  }
  // Springs keep the heads flowing, and every river cell is fed a little
  // along its length (as ground water does), so rivers stay full however
  // long the island lives.
  heads.sort((a, b) => area[b] - area[a] || a - b);
  world.springs = heads.slice(0, 12).map((i) => ({ i, level: height[i] + 0.55 }));
  const headSet = new Set(world.springs.map((s) => s.i));
  for (const i of cells)
    if (!inLake(i) && !headSet.has(i) && height[i] >= world.seaLevel) world.springs.push({ i, level: height[i] + world.depth[i] * 0.8, rate: 0.08 });
  return { river, area };
}

// Next to still water above the sea: lowering it would let a lake out.
function byLake(world: World, j: number): boolean {
  const x = j % world.w;
  const y = (j / world.w) | 0;
  for (const [dx, dy] of N4) {
    if (!world.inside(x + dx, y + dy)) continue;
    const k = (y + dy) * world.w + x + dx;
    if (world.depth[k] > 0 && world.height[k] >= world.seaLevel) return true;
  }
  return false;
}

// A delta: where the biggest river reaches the low land, it splits into a
// fan of meandering branches down to the sea. `side` is the island's low side
// (0: x = 0, 1: y = 0, 2: x = w, 3: y = h).
function distributaries(world: World, side: number, rng: Rng, river: Uint8Array, area: Float32Array): void {
  const { w, h, height } = world;
  const t = (x: number, y: number) => [x / w, y / h, 1 - x / w, 1 - y / h][side];
  let apex = -1;
  for (let i = 0; i < world.n; i++) {
    const x = i % w;
    const y = (i / w) | 0;
    const at = t(x, y);
    if (!river[i] || at < 0.4 || at > 0.62 || x < 10 || y < 10 || x > w - 11 || y > h - 11) continue;
    if (apex < 0 || area[i] > area[apex]) apex = i;
  }
  if (apex < 0) return;
  // The plain below the apex: low and flat, a little above the sea, so the
  // branches spread over it instead of cutting gorges.
  const tApex = t(apex % w, (apex / w) | 0);
  for (let i = 0; i < world.n; i++) {
    const at = t(i % w, (i / w) | 0);
    if (at >= tApex || height[i] <= world.seaLevel || world.depth[i] > 0) continue;
    const k = Math.min(1, (tApex - at) / 0.1);
    height[i] = height[i] + (world.seaLevel + 0.6 + (height[i] - world.seaLevel) * 0.1 - height[i]) * k;
  }
  const seaDir = [
    [-1, 0],
    [0, -1],
    [1, 0],
    [0, 1],
  ][side];
  const base = Math.atan2(seaDir[1], seaDir[0]);
  const branches = rng.int(4, 6);
  for (let b = 0; b < branches; b++) {
    let a = base + (b / (branches - 1) - 0.5) * 1.6 + rng.range(-0.1, 0.1);
    let x = apex % w;
    let y = (apex / w) | 0;
    let bed = height[apex] - 0.3;
    for (let step = 0; step < w * 2; step++) {
      // Meanders: the heading drifts with noise, pulled back toward the sea.
      a += (valueNoise(x / 9, y / 9, world.seed + 300 + b * 17) - 0.5) * 0.45 + Math.sin(base - a) * 0.05;
      x += Math.cos(a);
      y += Math.sin(a);
      const cx = Math.round(x);
      const cy = Math.round(y);
      if (!world.inside(cx, cy)) break;
      const i = cy * w + cx;
      if (height[i] < world.seaLevel - 0.5 && world.depth[i] > 0.5) break;
      bed = Math.max(world.seaLevel - 0.6, Math.min(bed - 0.04, height[i] - 0.6));
      for (const [dx, dy] of [[0, 0], ...N4.slice(0, step > 6 ? 2 : 0)] as [number, number][]) {
        if (!world.inside(cx + dx, cy + dy)) continue;
        const j = (cy + dy) * w + cx + dx;
        if (height[j] <= bed && world.depth[j] > 0) continue;
        height[j] = Math.min(height[j], bed);
        world.setFluid(j, F.WATER, Math.max(world.depth[j], 0.55));
        world.setCover(j, C.NONE);
        river[j] = 1;
      }
    }
  }
}

// --- Ground and covers ---------------------------------------------------------

function slopeAt(world: World, i: number): number {
  const { w, height } = world;
  const r = Math.min(world.n - 1, i + 1);
  const d = Math.min(world.n - 1, i + w);
  return Math.abs(height[i] - height[r]) + Math.abs(height[i] - height[d]);
}

// Cells within `r` steps of water (0 for water itself), 255 beyond.
function waterDistance(world: World, r: number): Uint8Array {
  const { w, h, n } = world;
  const dist = new Uint8Array(n).fill(255);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++)
    if (world.depth[i] > 0.05) {
      dist[i] = 0;
      frontier.push(i);
    }
  for (let s = 1; s <= r && frontier.length; s++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w;
      const y = (i / w) | 0;
      for (const [dx, dy] of N4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (dist[j] !== 255) continue;
        dist[j] = s;
        next.push(j);
      }
    }
    frontier = next;
  }
  return dist;
}

function grounds(world: World, land: LandOptions, seed: number, peak: number): void {
  const { w, h, ground, height } = world;
  const near = waterDistance(world, 8);
  const biome = land.biome;
  const snowAt = biome === "tundra" ? SEA + peak * 0.35 : SEA + peak * 0.82;
  const rockAt = biome === "mesa" ? Infinity : SEA + peak * 0.7;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const hgt = height[i];
      const slope = slopeAt(world, i);
      const moist = fbm(x / 34, y / 34, seed + 77, 4);
      const patch = fbm(x / 20, y / 20, seed + 5, 3);
      let g: number = G.GRASS;
      if (hgt < world.seaLevel + 0.7 && biome !== "swamp") g = G.SAND;
      else if (hgt > snowAt && biome !== "desert" && biome !== "mesa" && biome !== "jungle") g = G.SNOW;
      else if (hgt > rockAt || slope > (biome === "mesa" ? 1.4 : 2.2)) g = G.ROCK;
      else if (biome === "desert") g = near[i] <= 4 || moist > 0.7 ? G.GRASS : patch > 0.66 ? G.DIRT : G.SAND;
      else if (biome === "mesa") g = near[i] <= 3 || moist > 0.66 ? G.GRASS : patch > 0.5 ? G.DIRT : G.SAND;
      else if (biome === "tundra") g = moist > 0.64 && hgt > SEA + 2 ? G.SNOW : patch > 0.72 ? G.DIRT : G.GRASS;
      else if (biome === "volcanic") g = hgt > SEA + peak * 0.45 ? (patch > 0.55 ? G.ASH : G.BASALT) : patch > 0.7 ? G.DIRT : G.GRASS;
      else if (biome === "swamp") g = patch > 0.62 ? G.DIRT : G.GRASS;
      else g = patch > 0.7 ? G.DIRT : G.GRASS;
      ground[i] = g;
      world.temp[i] = world.ambient(i);
    }
  }
}

function covers(world: World, land: LandOptions, seed: number, rng: Rng): void {
  const { w, h, ground } = world;
  // The forest slider moves the noise threshold: 0.5 is the old island.
  const base = { temperate: 0.56, desert: 0.6, tundra: 0.58, jungle: 0.42, swamp: 0.55, volcanic: 0.56, mesa: 0.62 }[land.biome];
  const threshold = base + (0.5 - land.forest) * 0.24;
  const near = land.biome === "desert" || land.biome === "mesa" ? waterDistance(world, 5) : null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (ground[i] !== G.GRASS || world.depth[i] > 0) continue;
      const forest = fbm(x / 26, y / 26, seed + 13, 4);
      const r = rng.next();
      // Dry lands grow trees by the water.
      const t = near && near[i] <= 3 ? threshold - 0.2 : threshold;
      if (forest > t && r < (forest - t + 0.06) * 2.2) world.setCover(i, C.TREE);
      else if (r < 0.025) world.setCover(i, C.BUSH);
      else if (r < 0.035) world.setCover(i, C.FLOWER);
    }
  }
  for (let i = 0; i < world.n; i++) if (ground[i] === G.ROCK && rng.next() < 0.02) world.setCover(i, C.BOULDER);
}

// A volcano: a cone near the middle; its crater is filled with lava once the
// water is in (crater() below), its rim bare stone.
function volcano(world: World, rng: Rng, peak: number): { x: number; y: number; r: number; rim: number } {
  const { w, h, height } = world;
  const cx = w * rng.range(0.35, 0.65);
  const cy = h * rng.range(0.35, 0.65);
  const r = Math.min(w, h) * 0.22;
  const top = SEA + peak * 1.15;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d >= 1) continue;
      const i = y * w + x;
      const cone = top * (1 - d) ** 1.4 + height[i] * (1 - (1 - d) ** 0.6);
      height[i] = Math.max(height[i], cone);
    }
  }
  const cr = Math.max(3, r * 0.18);
  return { x: cx, y: cy, r: cr, rim: top * (1 - cr / r) ** 1.4 };
}

function crater(world: World, at: { x: number; y: number; r: number; rim: number }): void {
  const { w, height } = world;
  const { x: cx, y: cy, r: cr, rim } = at;
  for (let y = Math.floor(cy - cr - 4); y <= cy + cr + 4; y++) {
    for (let x = Math.floor(cx - cr - 4); x <= cx + cr + 4; x++) {
      if (!world.inside(x, y)) continue;
      const i = y * w + x;
      const d = Math.hypot(x - cx, y - cy);
      if (d < cr) {
        height[i] = rim - 2.2;
        world.setFluid(i, F.LAVA, 1.2);
        world.ground[i] = G.BASALT;
      } else if (d < cr + 4) {
        height[i] = Math.max(height[i], rim);
        world.setFluid(i, F.NONE, 0);
        world.ground[i] = G.BASALT;
        world.setCover(i, C.NONE);
      }
      world.temp[i] = world.ambient(i);
    }
  }
}

// Swamps: pools of shallow water and mud in the low land. Pits are dug,
// then filled only where they hold water (a pit on a slope stays a hollow).
function bog(world: World, seed: number): void {
  const { w, h, height } = world;
  const dug = new Uint8Array(world.n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (world.depth[i] > 0 || height[i] > SEA + 3 || byLake(world, i)) continue;
      const v = valueNoise(x / 6, y / 6, seed + 91);
      if (v > 0.72) {
        height[i] -= 0.5 + (v - 0.72) * 3;
        dug[i] = 1;
      } else if (v < 0.12) {
        height[i] -= 0.3;
        dug[i] = 2;
      }
    }
  }
  const { filled } = drainage(world);
  for (let i = 0; i < world.n; i++) {
    const d = filled[i] - height[i];
    if (!dug[i] || d < 0.2) continue;
    world.setFluid(i, dug[i] === 1 ? F.WATER : F.MUD, d);
    world.setCover(i, C.NONE);
  }
}

// Still water at rest: carving rivers lowered some lakes' outlets, so every
// lake is brought down to its spill point now rather than in the first
// seconds of play. Rivers (fed by springs) keep their water.
function settle(world: World): void {
  const { filled } = drainage(world);
  const fed = new Set(world.springs.map((s) => s.i));
  for (let i = 0; i < world.n; i++) {
    if (world.fluid[i] !== F.WATER || world.height[i] + world.depth[i] < world.seaLevel + 0.3 || fed.has(i)) continue;
    const d = Math.min(world.depth[i], filled[i] - world.height[i]);
    if (d < 0.1) world.setFluid(i, F.NONE, 0);
    else world.depth[i] = d;
  }
}

// --- Habitats ------------------------------------------------------------

// How many cells of a species' habitat the island holds, sampled on a grid.
export function habitatCount(world: World, s: Species, step = 2): number {
  let count = 0;
  for (let y = 0; y < world.h; y += step) for (let x = 0; x < world.w; x += step) if (s.habitat(world, y * world.w + x)) count++;
  return count * step * step;
}

// Whatever the biome, every native species has somewhere to live: a grove
// by water (an oasis in the desert, a stand of pines in the tundra) where
// the forest animals' habitat is missing, and a deep pool for the fish.
function ensureHabitats(world: World, rng: Rng): void {
  const need = (s: Species) => habitatCount(world, s) < Math.max(40, world.n / 400);
  const forestKinds = SPECIES.filter((s) => s.kind.name !== "fish");
  for (let attempt = 0; attempt < 4 && forestKinds.some(need); attempt++) grove(world, rng, attempt);
  const fish = SPECIES.find((s) => s.kind.name === "fish")!;
  if (need(fish)) pond(world, rng, 5);
}

// A spot of dry land in the middle heights, away from villages (there are
// none yet at this point) and from the edge.
function openSpot(world: World, rng: Rng, r: number): { x: number; y: number } | null {
  let best: { x: number; y: number; score: number } | null = null;
  for (let k = 0; k < 300; k++) {
    const x = rng.int(r + 4, world.w - r - 5);
    const y = rng.int(r + 4, world.h - r - 5);
    const i = y * world.w + x;
    if (world.depth[i] > 0 || world.height[i] < world.seaLevel + 1) continue;
    let rough = 0;
    for (let dy = -r; dy <= r; dy += 2)
      for (let dx = -r; dx <= r; dx += 2) {
        const j = (y + dy) * world.w + x + dx;
        rough += Math.abs(world.height[j] - world.height[i]) + (world.fluid[j] === F.LAVA ? 100 : 0);
      }
    if (!best || rough < best.score) best = { x, y, score: rough };
  }
  return best;
}

function pond(world: World, rng: Rng, r: number): { x: number; y: number } | null {
  const at = openSpot(world, rng, r + 2);
  if (!at) return null;
  const base = world.height[at.y * world.w + at.x];
  for (let y = at.y - r; y <= at.y + r; y++)
    for (let x = at.x - r; x <= at.x + r; x++) {
      const d = Math.hypot(x - at.x, y - at.y) / r;
      if (d > 1) continue;
      const i = y * world.w + x;
      const deep = 2.4 * (1 - d * d) + 0.2;
      world.height[i] = base - deep;
      world.setFluid(i, F.WATER, deep);
      world.setCover(i, C.NONE);
      world.ground[i] = G.SAND;
    }
  return at;
}

function grove(world: World, rng: Rng, k: number): void {
  const r = 11 + k * 2;
  const at = pond(world, rng, 3);
  if (!at) return;
  for (let y = at.y - r; y <= at.y + r; y++)
    for (let x = at.x - r; x <= at.x + r; x++) {
      if (!world.inside(x, y)) continue;
      const d = Math.hypot(x - at.x, y - at.y);
      const i = y * world.w + x;
      if (d > r || world.depth[i] > 0 || world.fluid[i] !== F.NONE) continue;
      if (world.ground[i] !== G.ROCK) world.ground[i] = G.GRASS;
      world.temp[i] = world.ambient(i);
      if (d > 4.5 && rng.next() < 0.42) world.setCover(i, C.TREE);
      else if (rng.next() < 0.05) world.setCover(i, C.BUSH);
      else if (world.cover[i] === C.BOULDER) world.setCover(i, C.NONE);
    }
}

// --- The whole land -------------------------------------------------------

export interface Built {
  // The highest land above the sea, for villages.
  peak: number;
}

// Shapes, rescales and dresses a fresh world. Villages are built by the
// caller (world.ts), on the flattest dry land.
export function buildLand(world: World, land: LandOptions): Built {
  const rng = world.rng;
  const seed = world.seed;
  applyLand(world, land);
  const { raw, side } = shapeHeights(world.w, world.h, seed, land.shape, rng);
  const bias = { coast: 0, archipelago: 0.18, plateau: -0.04, ridges: 0, lakes: 0.02, delta: 0.06 }[land.shape];
  const biomeBias = { temperate: 0, desert: -0.04, tundra: 0, jungle: 0.03, swamp: 0.12, volcanic: 0, mesa: -0.05 }[land.biome];
  const seaShare = Math.min(0.62, Math.max(0.04, 0.05 + land.water * 0.3 + bias + biomeBias));
  const reliefScale = (land.biome === "swamp" ? 0.45 : land.biome === "mesa" ? 1.15 : 1) * (land.shape === "archipelago" ? 0.65 : 1);
  const peak = (12 + land.relief * 24) * reliefScale;
  rescale(raw, seaShare, peak);
  world.height.set(raw);
  if (land.shape === "plateau") terrace(world.height, 4 + land.relief * 3, 0.22);
  if (land.biome === "mesa") terrace(world.height, 3 + land.relief * 2, 0.16);
  const cone = land.biome === "volcanic" ? volcano(world, rng, peak) : null;
  // The sea fills what lies below its level.
  for (let i = 0; i < world.n; i++) if (world.height[i] < world.seaLevel) world.setFluid(i, F.WATER, world.seaLevel - world.height[i]);
  const { river, area } = water(world, land);
  if (land.shape === "delta") distributaries(world, side, rng, river, area);
  if (land.biome === "swamp") bog(world, seed);
  grounds(world, land, seed, peak);
  covers(world, land, seed, rng);
  if (cone) crater(world, cone);
  settle(world);
  // Lakes and pools keep their level; a volcano keeps its crater full.
  world.springs.push(...lakeSprings(world, 40));
  if (cone) {
    const i = Math.round(cone.y) * world.w + Math.round(cone.x);
    world.springs.push({ i, level: world.height[i] + 1.2, lava: true });
  }
  ensureHabitats(world, rng);
  return { peak };
}
