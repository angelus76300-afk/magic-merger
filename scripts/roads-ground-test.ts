// Roads that follow the ground (21 November, the owner: "Roads look too blocky, we can do better").
// A dirt road was drawn as built ground in the fine land: each cell a whole column at its rounded
// height, a step of a whole voxel wherever the road climbed, in smooth curved ground. Now it is drawn
// as ground (terrain.ts naturalAt, wayGround), as a path is. Measured on a made island, a slope that
// climbs a voxel a cell with a road straight up it and grass either side, on high:
//   1. along the road the drawn top climbs in eighths as the grass beside it does: no step between
//      two neighbouring columns of road taller than the grass's (an eighth, two where the land's own
//      small noise rounds so), never a whole voxel (on main: 8 eighths at every cell's side);
//   2. feet at the road's edges stand on the ground drawn there (footAt within an eighth of it);
//   3. the road's edge with the grass wanders: not every cell side along it straight;
//   4. a change of ground one cell from a chunk's seam marks the chunk across the seam for
//      rebuilding (Terrain.markAround), as a change on the seam does (review of #200: a cell's tone
//      reads its neighbours, so the seam's cell changes with it).
// Run with the other checks (npm test, scripts/sim-test.ts).
import { MeshBasicMaterial, type Mesh } from "three";
import { World } from "../src/sim/world";
import { CHUNK, Terrain } from "../src/sim/voxel/terrain";
import { GRAPHICS, PRESETS, type LooksFlag } from "../src/sim/voxel/graphics";
import { G } from "../src/sim/materials";
import { topColours } from "./ground-blend-test";

type Check = (name: string, ok: boolean, detail?: string) => void;

const SUB = 8;
const SIZE = 64;
// The road: the row y = ROW, from x = X0 to X1, up a slope of a voxel a cell.
const ROW = 40;
const X0 = 36;
const X1 = 58;

interface Inner {
  wantLevel: (c: number) => number;
  dirtyLand: Set<number>;
  drawnTop: (x: number, y: number) => number;
  fine: (Mesh | null | undefined)[];
}

function made(): World {
  const world = new World(SIZE, SIZE, 5);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      // A voxel (two height units) a cell up toward +x, from a flat shelf.
      world.height[i] = 10 + 2 * Math.max(0, Math.min(X1 - 30, x - 30));
      world.ground[i] = G.GRASS;
    }
  for (let x = X0; x <= X1; x++) world.ground[ROW * SIZE + x] = G.ROAD;
  world.time = 12 * 60;
  return world;
}

function build(world: World): { terrain: Terrain; t: Inner } {
  const was = { ...GRAPHICS };
  try {
    for (const [f, on] of Object.entries(PRESETS.high)) GRAPHICS[f as LooksFlag] = on;
    const terrain = new Terrain(
      world,
      new MeshBasicMaterial(),
      new MeshBasicMaterial(),
      () => undefined,
      () => undefined,
    );
    terrain.wetClock = () => 0;
    const t = terrain as unknown as Inner;
    t.wantLevel = () => SUB;
    terrain.scan();
    terrain.rebuild(true);
    terrain.focus((X0 + X1) / 2 - SIZE / 2 + 8, 22, ROW - SIZE / 2 + 8, (X0 + X1) / 2 - SIZE / 2, ROW - SIZE / 2);
    terrain.updateFine(0, true);
    return { terrain, t };
  } finally {
    Object.assign(GRAPHICS, was);
  }
}

export interface RoadGround {
  // 1: the tallest step, in eighths, between two neighbouring columns along the road's middle rows.
  step: number;
  grass: number; // the same along the grass beside it, three cells off
  climb: number; // eighths climbed along it, end to end
  // 2: the largest gap between feet and the drawn ground at the road's edges, in eighths.
  feet: number;
  // 3: cell sides along the road's edges where road meets grass exactly at the side, of all.
  straight: number;
  sides: number;
  // 4: chunks marked when a cell one from a seam changes, and when one on the seam does.
  oneIn: boolean;
  onSeam: boolean;
}

export function roadGround(): RoadGround {
  const world = made();
  const { terrain, t } = build(world);
  const was = { ...GRAPHICS };
  for (const [f, on] of Object.entries(PRESETS.high)) GRAPHICS[f as LooksFlag] = on;
  try {
    // The tallest step between two neighbouring columns along rows `cy` (the cell row) 3 and 4 in
    // eighths, from the road's first cell to its last; and the eighths climbed end to end.
    const along = (cy: number) => {
      let tallest = 0;
      let first = NaN;
      let last = NaN;
      for (const sy of [3, 4]) {
        let prev = NaN;
        for (let sx = X0 * SUB; sx < (X1 + 1) * SUB; sx++) {
          const h = t.drawnTop((sx + 0.5) / SUB, cy + (sy + 0.5) / SUB) * SUB;
          if (!Number.isNaN(prev)) tallest = Math.max(tallest, Math.abs(h - prev));
          if (Number.isNaN(first)) first = h;
          last = h;
          prev = h;
        }
      }
      return { tallest, climb: last - first };
    };
    const road = along(ROW);
    const grass = along(ROW + 3);
    let feet = 0;
    for (let x = X0 + 1; x < X1; x += 0.37)
      for (const y of [ROW + 0.01, ROW + 0.99, ROW - 0.2, ROW + 1.2]) {
        const f = terrain.footAt(x, y);
        const d = t.drawnTop(x, y);
        if (f !== null && !Number.isNaN(d)) feet = Math.max(feet, Math.abs(f - d) * SUB);
      }
    const { straight, sides } = edges(terrain);
    // 4.
    const cols = Math.ceil(SIZE / CHUNK);
    t.dirtyLand.clear();
    const y = 10;
    world.ground[y * SIZE + CHUNK - 2] = G.SAND;
    terrain.scan();
    const oneIn = t.dirtyLand.has(Math.floor(y / CHUNK) * cols + 1);
    t.dirtyLand.clear();
    world.ground[(y + 4) * SIZE + CHUNK - 1] = G.SAND;
    terrain.scan();
    const onSeam = t.dirtyLand.has(Math.floor(y / CHUNK) * cols + 1);
    return { step: road.tallest, grass: grass.tallest, climb: road.climb, feet, straight, sides, oneIn, onSeam };
  } finally {
    Object.assign(GRAPHICS, was);
  }
}

// The road's two edges, cell by cell: a side is straight when every one of its eight columns just
// inside the road is drawn in the road's colours (redder than green) and every one just outside in
// the grass's.
function edges(terrain: Terrain): { straight: number; sides: number } {
  const t = terrain as unknown as Inner;
  const meshes = t.fine.filter((m): m is Mesh => !!m);
  if (!meshes.length) return { straight: -1, sides: 0 };
  const x0 = X0;
  const y0 = ROW - 1;
  const { rgb, w } = topColours(made(), meshes, SUB, x0, y0, X1 + 1, ROW + 2);
  const road = (sx: number, sy: number) => {
    const s = (sy - y0 * SUB) * w + (sx - x0 * SUB);
    return rgb[s * 3] > rgb[s * 3 + 1];
  };
  let straight = 0;
  let sides = 0;
  for (let x = X0 + 1; x < X1; x++)
    for (const [inside, outside] of [
      [ROW * SUB, ROW * SUB - 1],
      [(ROW + 1) * SUB - 1, (ROW + 1) * SUB],
    ]) {
      sides++;
      let exact = true;
      for (let k = 0; k < SUB && exact; k++) {
        const sx = x * SUB + k;
        if (!(road(sx, inside) && !road(sx, outside))) exact = false;
      }
      if (exact) straight++;
    }
  return { straight, sides };
}

export function roadsGroundChecks(check: Check): void {
  const r = roadGround();
  check(
    `roads: a road up a slope climbs in eighths as the grass beside it does, no whole voxel step (tallest ${r.step} eighths, the grass ${r.grass}; ${r.climb} eighths climbed)`,
    r.step <= Math.max(1, r.grass) && r.step <= 2 && r.climb >= (X1 - X0) * SUB * 0.8,
    JSON.stringify(r),
  );
  check(`roads: feet at a road's edges stand on the ground drawn there (within ${r.feet.toFixed(2)} eighths)`, r.feet <= 1, JSON.stringify(r));
  check(
    `roads: a road's edge with the grass wanders (${r.straight} of ${r.sides} cell sides straight)`,
    r.sides > 20 && r.straight <= r.sides * 0.6,
    JSON.stringify(r),
  );
  check("roads: a change of ground one cell from a chunk's seam rebuilds the chunk across it, as one on the seam does", r.oneIn && r.onSeam, JSON.stringify(r));
}

if (/roads-ground[^/]*\.mjs$/.test(process.argv[1] ?? "")) console.log(JSON.stringify(roadGround(), null, 1));
