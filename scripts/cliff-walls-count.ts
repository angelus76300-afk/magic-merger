// Flat walls (27 November, the owner: "cliffs: flat walls"): the land's triangles on the five islands
// of scripts/cliff-frames.mjs, every chunk built in eighths as the fine mesher builds it, and the
// tiles' build time, in four ways: main (cliffCorner), the outline prototype (no flat walls, no sharp
// corners), the outline with sharp corners, and the outline with flat walls (the game's settings
// with the flag on). Node, no browser: the counts differ a little from the lab's (no minute of play
// on the island) but the modes are compared on the same cells.
//
//   npx esbuild scripts/cliff-walls-count.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/cliff-walls-count.mjs && node node_modules/.cache/cliff-walls-count.mjs
import { MeshBasicMaterial } from "three";
import { generateWorld } from "../src/sim/world";
import { Terrain, Writer, CHUNK } from "../src/sim/voxel/terrain";
import { GRAPHICS, PRESETS, type LooksFlag } from "../src/sim/voxel/graphics";
import { CLIFF_CORNER, CLIFF_OUTLINE, TILE, buildFineTile, makeFineCells } from "../src/sim/voxel/terrain-fine";
import { readLand } from "../src/sim/land-options";
import { WORLD_SIZES, type WorldSize } from "../src/sim/sizes";

export const WALL_ISLANDS: [string, string][] = [
  ["plateau-7", "size=medium&seed=7&biome=temperate&shape=plateau"],
  ["desert-plateau-3", "size=small&seed=3&biome=desert&shape=plateau&relief=0.8"],
  ["mesa-5", "size=medium&seed=5&biome=mesa&shape=plateau"],
  ["volcanic-6", "size=medium&seed=6&biome=volcanic&shape=ridges&relief=0.9"],
  ["forest-plateau-2", "size=medium&seed=2&biome=temperate&shape=plateau&relief=0.7&forest=0.9"],
];
export const WALL_MODES: { name: string; corner: boolean; outline: boolean; sharp: number; walls: boolean }[] = [
  { name: "main", corner: true, outline: false, sharp: 0, walls: false },
  { name: "prototype", corner: true, outline: true, sharp: 0, walls: false },
  { name: "sharp 2", corner: true, outline: true, sharp: 2, walls: false },
  { name: "flat walls", corner: true, outline: true, sharp: 2, walls: true },
];

export function islandTriangles(q: string, mode: (typeof WALL_MODES)[number]): { tris: number; p50: number; p95: number; tops: number; slant: number } {
  const p = new URLSearchParams(q);
  const num = (k: string) => (p.has(k) ? Number(p.get(k)) : undefined);
  const cells = WORLD_SIZES[(p.get("size") ?? "medium") as WorldSize];
  const was = { ...GRAPHICS };
  const wasCorner = CLIFF_CORNER.on;
  const wasOutline = { ...CLIFF_OUTLINE };
  try {
    for (const [k, v] of Object.entries(PRESETS.high)) GRAPHICS[k as LooksFlag] = v;
    CLIFF_CORNER.on = mode.corner;
    CLIFF_OUTLINE.on = mode.outline;
    CLIFF_OUTLINE.sharpRun = mode.sharp;
    CLIFF_OUTLINE.walls = mode.walls;
    const land = readLand({ biome: p.get("biome"), shape: p.get("shape"), relief: num("relief"), forest: num("forest") });
    const world = generateWorld(cells, cells, Number(p.get("seed")), land);
    const terrain = new Terrain(
      world,
      new MeshBasicMaterial(),
      new MeshBasicMaterial(),
      () => {},
      () => {},
    );
    terrain.wetClock = () => 0;
    terrain.scan();
    const f = makeFineCells();
    const out = new Writer();
    const water = new Writer();
    const ms: number[] = [];
    let tris = 0;
    let tops = 0;
    let slant = 0;
    const cols = Math.ceil(world.w / CHUNK);
    const rows = Math.ceil(world.h / CHUNK);
    for (let c = 0; c < cols * rows; c++) {
      terrain.readFine(c, f);
      out.reset();
      water.reset();
      for (let ty = f.y0; ty < f.y1; ty += TILE)
        for (let tx = f.x0; tx < f.x1; tx += TILE) {
          const t0 = performance.now();
          buildFineTile(f, out, -world.w / 2, -world.h / 2, 8, tx, ty, Math.min(f.x1, tx + TILE), Math.min(f.y1, ty + TILE), null, water, false);
          ms.push(performance.now() - t0);
        }
      const { pos } = out.vertexArrays();
      // Triangles as the index holds them (terrain.ts quadsGeometry): a quad's empty half is left out.
      const cross = (o: number, i: number, j: number) => {
        const ux = pos[o + i] - pos[o];
        const uy = pos[o + i + 1] - pos[o + 1];
        const uz = pos[o + i + 2] - pos[o + 2];
        const vx = pos[o + j] - pos[o];
        const vy = pos[o + j + 1] - pos[o + 1];
        const vz = pos[o + j + 2] - pos[o + 2];
        return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      };
      for (let k = 0; k < out.quads; k++) {
        const o = k * 18;
        const n1 = cross(o, 3, 6);
        const n2 = cross(o, 6, 15);
        const [nx, ny, nz] = [n1[0] + n2[0], n1[1] + n2[1], n1[2] + n2[2]];
        const a1 = Math.hypot(...n1);
        const a2 = Math.hypot(...n2);
        const drawn = (a1 > 1e-6 * Math.max(a1, a2) ? 1 : 0) + (a2 > 1e-6 * Math.max(a1, a2) ? 1 : 0);
        tris += drawn;
        if (Math.abs(ny) > Math.abs(nx) && Math.abs(ny) > Math.abs(nz)) tops += drawn;
        else if (Math.abs(nx) > 1e-7 && Math.abs(nz) > 1e-7) slant += drawn;
      }
    }
    ms.sort((a, b) => a - b);
    return { tris, p50: ms[Math.floor(ms.length * 0.5)], p95: ms[Math.floor(ms.length * 0.95)], tops, slant };
  } finally {
    Object.assign(GRAPHICS, was);
    CLIFF_CORNER.on = wasCorner;
    Object.assign(CLIFF_OUTLINE, wasOutline);
  }
}

if (process.argv[1]?.endsWith("cliff-walls-count.mjs")) {
  const only = process.argv[2];
  for (const [name, q] of WALL_ISLANDS) {
    if (only && name !== only) continue;
    let base = 0;
    for (const m of WALL_MODES) {
      const r = islandTriangles(q, m);
      if (m.name === "main") base = r.tris;
      const rise = base ? ` (${(((r.tris - base) / base) * 100).toFixed(2)}%)` : "";
      console.log(
        `${name.padEnd(18)} ${m.name.padEnd(10)} ${r.tris.toLocaleString("en")}${rise}  tops ${r.tops.toLocaleString("en")} slanted ${r.slant.toLocaleString("en")}  tile ms p50 ${r.p50.toFixed(2)} p95 ${r.p95.toFixed(2)}`,
      );
    }
  }
}
