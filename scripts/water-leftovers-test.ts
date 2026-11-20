// Water leftovers (20 November). Measured on generated islands as the fine land and the water in
// eighths draw them (terrain-fine.ts):
//   1. a bed never rises through the ice or water drawn over its cell: on the tundra lake island of
//      seed 5 after a minute of play (thin ice grown from the shores, the grass strips across it by
//      the houses) and on the temperate lake island of seed 7 (shallow water);
//   2. feet at a dry shore stand on the water drawn over their column, not under it;
//   3. the water's tall sides (the island's rim, where the water is cut down to its bed) are its
//      own blue and nearly opaque, not a pale cyan a third opaque (a bright line along the rim).
// Run with the other checks (npm test, scripts/sim-test.ts).
import { MeshBasicMaterial, type Mesh } from "three";
import { generateWorld, TICK, type World } from "../src/sim/world";
import { readLand } from "../src/sim/land";
import { stepPhysics } from "../src/sim/physics";
import { Terrain } from "../src/sim/voxel/terrain";
import { GRAPHICS, PRESETS, type LooksFlag } from "../src/sim/voxel/graphics";
import { F } from "../src/sim/materials";

type Check = (name: string, ok: boolean, detail?: string) => void;

const SUB = 8;

interface Built {
  world: World;
  terrain: Terrain;
  meshes: Mesh[];
  land: MeshBasicMaterial;
  fluid: MeshBasicMaterial;
}

// The island after `seconds` of its physics (Math.random seeded, so the same ice forms each run),
// on high, every chunk round (cx, cy) built in eighths.
function build(seed: number, biome: "tundra" | "temperate", seconds: number, cx: number, cy: number): Built {
  const was = { ...GRAPHICS };
  const random = Math.random;
  let a = 20261120;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    for (const [f, on] of Object.entries(PRESETS.high)) GRAPHICS[f as LooksFlag] = on;
    const world = generateWorld(152, 152, seed, readLand({ biome, shape: "lakes" }));
    for (let t = 0; t < seconds * 30; t++) {
      world.time += TICK;
      world.tick++;
      stepPhysics(world, TICK);
    }
    const meshes: Mesh[] = [];
    const land = new MeshBasicMaterial();
    const fluid = new MeshBasicMaterial();
    const terrain = new Terrain(
      world,
      land,
      fluid,
      (m) => meshes.push(m),
      (m) => meshes.splice(meshes.indexOf(m), 1),
    );
    terrain.wetClock = () => 0;
    terrain.scan();
    terrain.rebuild(true);
    terrain.focus(cx - world.w / 2, 20, cy - world.h / 2, cx - world.w / 2, cy - world.h / 2);
    terrain.updateFine(0, true);
    return { world, terrain, meshes, land, fluid };
  } finally {
    Object.assign(GRAPHICS, was);
    Math.random = random;
  }
}

// The highest surface of `mat`'s meshes over each eighth column of the island, sampled at a point
// (ox, oz) of the column (in columns), NaN where none: each triangle that is not upright, at the
// column's point inside it.
function surfaceAt(b: Built, mat: MeshBasicMaterial, ox: number, oz: number): Float32Array {
  const { world } = b;
  const W = world.w * SUB;
  const y = new Float32Array(W * world.h * SUB).fill(NaN);
  for (const m of b.meshes) {
    if (!m.visible || m.material !== mat) continue;
    const p = m.geometry.getAttribute("position").array as Float32Array;
    const idx = m.geometry.index ? (m.geometry.index.array as ArrayLike<number>) : null;
    const nt = idx ? idx.length / 3 : p.length / 9;
    for (let t = 0; t < nt; t++) {
      const v0 = idx ? idx[t * 3] : t * 3;
      const v1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const v2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const ax = p[v0 * 3];
      const ay = p[v0 * 3 + 1];
      const az = p[v0 * 3 + 2];
      const bx = p[v1 * 3];
      const by = p[v1 * 3 + 1];
      const bz = p[v1 * 3 + 2];
      const qx = p[v2 * 3];
      const qy = p[v2 * 3 + 1];
      const qz = p[v2 * 3 + 2];
      const det = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz);
      if (Math.abs(det) < 1e-9) continue;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, qx) + world.w / 2) * SUB));
      const i1 = Math.min(W, Math.ceil((Math.max(ax, bx, qx) + world.w / 2) * SUB));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz, qz) + world.h / 2) * SUB));
      const j1 = Math.min(world.h * SUB, Math.ceil((Math.max(az, bz, qz) + world.h / 2) * SUB));
      for (let j = j0; j < j1; j++)
        for (let i = i0; i < i1; i++) {
          const px = (i + ox) / SUB - world.w / 2;
          const pz = (j + oz) / SUB - world.h / 2;
          const l1 = ((bz - qz) * (px - qx) + (qx - bx) * (pz - qz)) / det;
          const l2 = ((qz - az) * (px - qx) + (ax - qx) * (pz - qz)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
          const at = l1 * ay + l2 * by + l3 * qy;
          const s = j * W + i;
          if (!(y[s] >= at)) y[s] = at;
        }
    }
  }
  return y;
}

// The lowest of the water's surface over each column, at its middle and near its four corners.
function waterLow(b: Built): Float32Array {
  const low = surfaceAt(b, b.fluid, 0.5, 0.5);
  for (const [ox, oz] of [
    [0.05, 0.05],
    [0.95, 0.05],
    [0.05, 0.95],
    [0.95, 0.95],
  ]) {
    const t = surfaceAt(b, b.fluid, ox, oz);
    for (let s = 0; s < low.length; s++) if (!(t[s] >= low[s])) low[s] = t[s];
  }
  return low;
}

function wetOf(b: Built): Uint8Array {
  return (b.terrain as unknown as { wet: Uint8Array }).wet;
}

// 1: columns of a cell under water or ice whose eight neighbours are too (away from the shore,
// where the waterline draws the shore's land over a water cell on purpose), with land drawn above
// the lowest of the water's surface over them.
function bedsThrough(b: Built, land: Float32Array, water: Float32Array): { columns: number; ice: number; cells: number } {
  const { world } = b;
  const wet = wetOf(b);
  const W = world.w * SUB;
  const isWet = (i: number) => wet[i] === 1 && (world.fluid[i] === F.WATER || world.fluid[i] === F.ICE);
  let columns = 0;
  let ice = 0;
  const cells = new Set<number>();
  for (let s = 0; s < land.length; s++) {
    if (Number.isNaN(land[s])) continue;
    const x = Math.floor((s % W) / SUB);
    const y = Math.floor(Math.floor(s / W) / SUB);
    if (x < 1 || y < 1 || x >= world.w - 1 || y >= world.h - 1) continue;
    const i = y * world.w + x;
    if (!isWet(i)) continue;
    let inner = true;
    for (let dy = -1; dy <= 1 && inner; dy++) for (let dx = -1; dx <= 1; dx++) if (!isWet(i + dy * world.w + dx)) inner = false;
    if (!inner) continue;
    if (land[s] > (Number.isNaN(water[s]) ? -Infinity : water[s]) + 1e-4) {
      columns++;
      if (world.fluid[i] === F.ICE) ice++;
      cells.add(i);
    }
  }
  return { columns, ice, cells: cells.size };
}

// 2: columns of dry cells with water drawn over them, and how many have feet (Terrain.footAt at the
// column's middle) under that water, the most by how much (eighths).
function feetUnder(b: Built, water: Float32Array): { columns: number; under: number; worst: number } {
  const { world, terrain } = b;
  const wet = wetOf(b);
  const W = world.w * SUB;
  let columns = 0;
  let under = 0;
  let worst = 0;
  for (let s = 0; s < water.length; s++) {
    if (Number.isNaN(water[s])) continue;
    const x = Math.floor((s % W) / SUB);
    const y = Math.floor(Math.floor(s / W) / SUB);
    if (wet[y * world.w + x]) continue;
    const foot = terrain.footAt(((s % W) + 0.5) / SUB, (Math.floor(s / W) + 0.5) / SUB);
    if (foot === null) continue;
    columns++;
    const dip = water[s] - foot;
    if (dip > 1e-3) {
      under++;
      worst = Math.max(worst, dip * SUB);
    }
  }
  return { columns, under, worst };
}

// 3: the water's upright triangles a cell or more tall: how many, their least opacity and their
// lightest colour (luma, 0 to 1, of the colour drawn).
function tallSides(b: Built): { n: number; alpha: number; luma: number } {
  let n = 0;
  let alpha = Infinity;
  let luma = 0;
  for (const m of b.meshes) {
    if (!m.visible || m.material !== b.fluid) continue;
    const p = m.geometry.getAttribute("position");
    const c = m.geometry.getAttribute("color");
    const idx = m.geometry.index ? (m.geometry.index.array as ArrayLike<number>) : null;
    const nt = idx ? idx.length / 3 : p.count / 3;
    for (let t = 0; t < nt; t++) {
      const vs = [0, 1, 2].map((k) => (idx ? idx[t * 3 + k] : t * 3 + k));
      const xs = vs.map((v) => p.getX(v));
      const ys = vs.map((v) => p.getY(v));
      const zs = vs.map((v) => p.getZ(v));
      const flat = Math.max(...xs) - Math.min(...xs) > 1e-6 && Math.max(...zs) - Math.min(...zs) > 1e-6;
      if (flat || Math.max(...ys) - Math.min(...ys) < 1) continue;
      n++;
      for (const v of vs) {
        alpha = Math.min(alpha, c.itemSize > 3 ? c.getW(v) : 1);
        luma = Math.max(luma, 0.2126 * c.getX(v) + 0.7152 * c.getY(v) + 0.0722 * c.getZ(v));
      }
    }
  }
  return { n, alpha, luma };
}
export function waterLeftoversChecks(check: Check): void {
  // The tundra lake by the houses (lake0), after a minute of play; the temperate lake island at its
  // big lake and its south rim, where the sea is cut down to its bed.
  const islands: [string, Built][] = [
    ["tundra-lakes-5, a minute of play", build(5, "tundra", 60, 62, 35)],
    ["temperate-lakes-7", build(7, "temperate", 0, 70, 90)],
  ];
  let sides: ReturnType<typeof tallSides> | null = null;
  for (const [name, b] of islands) {
    const land = surfaceAt(b, b.land, 0.5, 0.5);
    const water = waterLow(b);
    const through = bedsThrough(b, land, water);
    check(
      `water leftovers (${name}): no bed rises through the ice or water drawn over its cell`,
      through.columns === 0,
      `${through.columns} columns (${through.ice} under ice) in ${through.cells} cells drawn above the surface`,
    );
    const feet = feetUnder(b, water);
    check(
      `water leftovers (${name}): feet at a dry shore stand on the water drawn over them, never under it`,
      feet.columns > 200 && feet.under === 0,
      `${feet.under} of ${feet.columns} dry columns under water have feet under it, the most by ${feet.worst.toFixed(2)} eighths`,
    );
    if (name.startsWith("temperate")) sides = tallSides(b);
  }
  if (sides)
    check(
      "water leftovers: the water's tall sides (the island's rim) are nearly opaque and no lighter than the water's own blue",
      sides.n > 50 && sides.alpha >= 0.8 && sides.luma < 0.45,
      `${sides.n} sides a cell or more tall, least opacity ${sides.alpha.toFixed(2)}, lightest luma ${sides.luma.toFixed(3)}`,
    );
}
