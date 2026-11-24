// Figures and props on the water as drawn (24 November, found by the review of "Shores without a
// rim"): the water in eighths lies a little under the land beside it (Terrain.fineWaterLevel), and
// walkers and docks still read the cells' level, at least 0.19 over it. Measured on the medium coast
// and the small desert plateau of the land's checks (terrain-looks-test.ts), on high, every chunk
// built in eighths, then far (terrain-fine.ts FAR), then still in whole cells (not built yet): for
// every cell of water, the gap between what the view puts on it (afloat.ts) and the top of the
// water's mesh under it, past the height it is meant to keep over the water:
//   - a walker's feet (wading villagers and animals, a dead fish afloat), four by four points of
//     the cell where the water is the top drawn (in whole cells the middle two by two: within
//     walk.ts EDGE of a side, feet climb toward the next cell's step, as they always have);
//   - a dock's planks (their underside DOCK_SINK in the water), at the cell's middle;
//   - a lily pad (LILY_OVER), at the cell's middle; a spark of the glowing shore (SPARK_OVER).
// Run with the other checks (npm test, scripts/sim-test.ts).
import { MeshBasicMaterial, type Mesh } from "three";
import { generateWorld } from "../src/sim/world";
import { CHUNK, Terrain } from "../src/sim/voxel/terrain";
import { GRAPHICS, PRESETS, type LooksFlag } from "../src/sim/voxel/graphics";
import { DOCK_DECK, DOCK_SINK, LILY_OVER, SPARK_OVER, dockBase, feetGround, lilyBase, sparkBase } from "../src/sim/voxel/afloat";
import { F } from "../src/sim/materials";
import { LOOK_ISLANDS } from "./terrain-looks-test";
import { surface } from "./shore-rim-test";

type Check = (name: string, ok: boolean, detail?: string) => void;

const SUB = 8;
// The most a figure or a prop may stand over or under the water drawn, scene units, but for one in a
// hundred, and the most for those: where the water falls steeply in a cell, its mesh's flat
// triangles part from the smooth surface (Terrain.fineWaterAt) by up to a column's fall.
export const AFLOAT_GAP = 0.05;
export const AFLOAT_RARE = 0.01;
export const AFLOAT_MAX = 0.15;

export type Mode = "eighths" | "far" | "whole";
export const KINDS = ["walker", "dock", "lily", "spark"] as const;
export type Kind = (typeof KINDS)[number];
export interface Gaps {
  n: number;
  p50: number;
  p90: number;
  max: number; // the largest gap either way
  over: number; // samples more than AFLOAT_GAP away
}

const pick = (s: number[], q: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0);
function stats(g: number[]): Gaps {
  const a = g.map(Math.abs).sort((x, y) => x - y);
  return { n: a.length, p50: pick(a, 0.5), p90: pick(a, 0.9), max: a.length ? a[a.length - 1] : 0, over: a.filter((v) => v > AFLOAT_GAP).length };
}

// The gaps of each kind, and the chunks with water whose count of changes to the water drawn
// (Terrain.waterMarks, what puts lilies and docks on it again) moved as their water was drawn in
// eighths, of those with water.
export function waterFigures(k: number, mode: Mode): Record<Kind, Gaps> & { marked: number; watery: number } {
  const I = LOOK_ISLANDS[k];
  const was = { ...GRAPHICS };
  try {
    for (const [f, on] of Object.entries(PRESETS.high)) GRAPHICS[f as LooksFlag] = on;
    const world = generateWorld(I.cells, I.cells, I.seed, I.land);
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
    terrain.wantFar = () => (mode === "far" ? 1 : 0);
    terrain.scan();
    terrain.rebuild(true);
    const before = terrain.waterMarks.slice();
    if (mode !== "whole") {
      terrain.focus(0, 30, 0, 0, 0);
      terrain.updateFine(0, true);
    }
    const watery = new Set<number>();
    const wet = (terrain as unknown as { wet: Uint8Array }).wet;
    const L = surface(world, meshes, land);
    const W = surface(world, meshes, fluid);
    const stride = world.w * SUB;
    const col = (x: number, y: number) => Math.floor(y * SUB) * stride + Math.floor(x * SUB);
    // The water drawn at (x, y), NaN where none or where land is drawn over it.
    const water = (x: number, y: number) => {
      const s = col(x, y);
      return W[s] > L[s] || (Number.isNaN(L[s]) && !Number.isNaN(W[s])) ? W[s] : NaN;
    };
    const gaps: Record<Kind, number[]> = { walker: [], dock: [], lily: [], spark: [] };
    for (let i = 0; i < world.n; i++) {
      if (world.fluid[i] !== F.WATER || !wet[i]) continue;
      const x = i % world.w;
      const y = (i - x) / world.w;
      watery.add(Math.floor(y / CHUNK) * Math.ceil(world.w / CHUNK) + Math.floor(x / CHUNK));
      const mid = water(x + 0.5, y + 0.5);
      if (!Number.isNaN(mid)) {
        gaps.dock.push(dockBase(terrain, world, i) + DOCK_DECK + DOCK_SINK - mid);
        gaps.lily.push(lilyBase(terrain, world, i) - LILY_OVER - mid);
      }
      // A spark where the view puts one of this cell (view.ts placeSparks).
      const u = 0.2 + ((i * 7) % 6) / 10;
      const v = 0.2 + ((i * 13) % 6) / 10;
      const at = water(x + u, y + v);
      if (!Number.isNaN(at)) gaps.spark.push(sparkBase(terrain, world, i, u, v) - SPARK_OVER - at);
      const edge = mode === "whole" ? 1 : 0;
      for (let a = edge; a < 4 - edge; a++)
        for (let b = edge; b < 4 - edge; b++) {
          const px = x + (a + 0.5) / 4;
          const py = y + (b + 0.5) / 4;
          const w = water(px, py);
          if (!Number.isNaN(w)) gaps.walker.push(feetGround(terrain, world, px, py) - w);
        }
    }
    const marked = [...watery].filter((c) => terrain.waterMarks[c] !== (before[c] ?? 0)).length;
    return { walker: stats(gaps.walker), dock: stats(gaps.dock), lily: stats(gaps.lily), spark: stats(gaps.spark), marked, watery: watery.size };
  } finally {
    Object.assign(GRAPHICS, was);
  }
}

export function waterFiguresChecks(check: Check): void {
  for (const k of [0, 2])
    for (const mode of ["eighths", "far", "whole"] as const) {
      // The medium coast far is drawn as in eighths (the water is not blocked far): the small one says it.
      if (k === 0 && mode === "far") continue;
      const r = waterFigures(k, mode);
      const name = `${LOOK_ISLANDS[k].name}, ${mode === "eighths" ? "in eighths" : mode === "far" ? "far" : "in whole cells"}`;
      check(
        `on the water (${name}): walkers, docks, lilies and sparks stand within ${AFLOAT_GAP} of the water drawn under them`,
        KINDS.every((kind) => r[kind].n > 0 && r[kind].over <= r[kind].n * AFLOAT_RARE && r[kind].max <= AFLOAT_MAX),
        KINDS.map((kind) => `${kind} ${r[kind].over} of ${r[kind].n} over, p90 ${r[kind].p90.toFixed(3)}, max ${r[kind].max.toFixed(3)}`).join("; "),
      );
      if (mode !== "whole")
        check(
          `on the water (${name}): lilies and docks are put on it again when it is drawn in eighths`,
          r.watery > 0 && r.marked === r.watery,
          `${r.marked} of ${r.watery} chunks with water marked`,
        );
    }
}
