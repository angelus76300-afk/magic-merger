// The land's looks (5.2.5, src/sim/voxel/land-looks.ts, terrain-fine.ts): the fine land near the
// camera and what it adds, and the water's bands, each behind its own switch of GRAPHICS. Drawing
// only: with every one of them off, the land and water meshes of three islands are byte for byte
// those of main before the change (the hashes below were taken on main, 13 November 2026); each
// switch changes the mesh, and the same island always gives the same mesh.
import { MeshBasicMaterial, type Mesh } from "three";
import { generateWorld } from "../src/sim/world";
import { DEFAULT_LAND, resolveLand, type LandOptions } from "../src/sim/land-options";
import { Terrain, columnTop } from "../src/sim/voxel/terrain";
import { C } from "../src/sim/materials";
import { GRAPHICS } from "../src/sim/voxel/graphics";
import { LAND_LOOKS } from "../src/sim/voxel/land-looks";

type Check = (name: string, ok: boolean, detail?: string) => void;

// The three islands: a medium temperate coast (the usual first island), a large mixed one (several
// lands, sand, snow and rock borders) and a small desert of plateaus (cliffs).
export const LOOK_ISLANDS: { name: string; cells: number; seed: number; land: LandOptions }[] = [
  { name: "medium coast", cells: 152, seed: 7, land: DEFAULT_LAND },
  { name: "large mixed", cells: 208, seed: 11, land: resolveLand({ warmth: 0.5, water: 0.5, relief: 0.7, forest: 0.5 }, 11, 208) },
  { name: "small plateau desert", cells: 112, seed: 3, land: { ...DEFAULT_LAND, biome: "desert", shape: "plateau", relief: 0.8 } },
];

// What main drew, before 5.2.5: land and water hashes of each island, in the order above.
const MAIN = [
  ["d66c8605", "3968f0ae"],
  ["596f90c7", "2b42d41e"],
  ["e354b98e", "5cabd2f9"],
];

export const LOOK_SWITCHES = Object.keys(LAND_LOOKS) as (keyof typeof LAND_LOOKS)[];
// The camera's distance to what it looks at, as the World tab's sky view holds it (orbit.ts, phi
// 0.95): close, mid, and the whole island (0.55 of the island's side).
export const ZOOMS = { close: 16, mid: 45, far: 0 } as const;
export type Zoom = keyof typeof ZOOMS;

export interface IslandMesh {
  landTriangles: number;
  fluidTriangles: number;
  fineChunks: number;
  eighths: number; // of the fine chunks, those in eighth voxels
  maxTileMs: number; // the longest tile of a fine chunk to build
  tileP95: number;
  // The worst gap, scene units, between the drawn ground and the cell's height under what is
  // placed by the cell's height: plants and other covers across their foot (0.12 cells from the
  // middle), houses across their whole floor (0.45). Creatures stand on the drawn ground itself.
  coverGap: number;
  houseGap: number;
  sampled: number;
  landHash: string;
  fluidHash: string;
  ms: number; // the whole island's first build, one cell meshes
  fineMs: number; // the fine chunks for the camera, all of them
}

// Builds the whole island's land and water (as the first frame does), then the fine chunks for a
// camera at `zoom` over the island's middle, and hashes every attribute of every mesh drawn.
export function buildIsland(cells: number, seed: number, land: LandOptions, zoom: Zoom = "close"): IslandMesh {
  const world = generateWorld(cells, cells, seed, land);
  const meshes: { kind: "land" | "fluid"; mesh: Mesh }[] = [];
  const landMat = new MeshBasicMaterial();
  const fluidMat = new MeshBasicMaterial();
  const terrain = new Terrain(
    world,
    landMat,
    fluidMat,
    (m) => meshes.push({ kind: m.material === landMat ? "land" : "fluid", mesh: m }),
    (m) =>
      meshes.splice(
        meshes.findIndex((e) => e.mesh === m),
        1,
      ),
  );
  terrain.scan();
  const t0 = performance.now();
  terrain.rebuild(true);
  const ms = performance.now() - t0;
  const dist = ZOOMS[zoom] || cells * 0.55;
  // The camera looks at the ground, some 8 units up on these islands.
  terrain.focus(dist * 0.81 * Math.SQRT1_2, dist * 0.58 + 8, dist * 0.81 * Math.SQRT1_2, 0, 0);
  const t1 = performance.now();
  if (GRAPHICS.fine) terrain.updateFine(0, true);
  const fineMs = performance.now() - t1;
  const hash = { land: 0x811c9dc5, fluid: 0x811c9dc5 };
  for (const { kind, mesh } of meshes) {
    if (!mesh.visible) continue;
    const g = mesh.geometry;
    for (const name of Object.keys(g.attributes).sort()) {
      const a = g.getAttribute(name).array as Float32Array;
      const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      let h = hash[kind];
      for (let k = 0; k < name.length; k++) h = Math.imul(h ^ name.charCodeAt(k), 0x01000193);
      for (let k = 0; k < bytes.length; k++) h = Math.imul(h ^ bytes[k], 0x01000193);
      hash[kind] = h >>> 0;
    }
  }
  const shown = terrain.shownTriangles();
  let coverGap = 0;
  let houseGap = 0;
  let sampled = 0;
  for (let i = 0; i < world.n; i++) {
    const cover = world.cover[i];
    if (cover === C.NONE) continue;
    const x = i % world.w;
    const y = Math.floor(i / world.w);
    const r = cover === C.HOUSE ? 0.45 : 0.12;
    const top = columnTop(world, i);
    if (terrain.groundAt(x + 0.5, y + 0.5) === top && !GRAPHICS.fine) continue;
    for (const [dx, dy] of [
      [0, 0],
      [-r, -r],
      [r, -r],
      [-r, r],
      [r, r],
    ]) {
      const gap = Math.abs(terrain.groundAt(x + 0.5 + dx, y + 0.5 + dy) - top);
      if (world.fluid[i] !== 0) continue;
      sampled++;
      if (cover === C.HOUSE) houseGap = Math.max(houseGap, gap);
      else coverGap = Math.max(coverGap, gap);
    }
  }
  const hex = (h: number) => h.toString(16).padStart(8, "0");
  return {
    landTriangles: shown.land,
    fluidTriangles: shown.fluid,
    fineChunks: shown.fineChunks,
    eighths: shown.eighths,
    maxTileMs: terrain.fineStats.maxTileMs,
    coverGap,
    houseGap,
    sampled,
    tileP95: [...terrain.fineStats.tileMs].sort((a, b) => a - b)[Math.floor(terrain.fineStats.tileMs.length * 0.95)] ?? 0,
    landHash: hex(hash.land),
    fluidHash: hex(hash.fluid),
    ms,
    fineMs,
  };
}

function withSwitches<T>(on: readonly string[], run: () => T): T {
  const was = { ...GRAPHICS };
  const flags = GRAPHICS as unknown as Record<string, boolean>;
  for (const s of LOOK_SWITCHES) flags[s] = on.includes(s);
  try {
    return run();
  } finally {
    Object.assign(GRAPHICS, was);
  }
}

export function islandWith(on: readonly string[], k: number, zoom: Zoom = "close"): IslandMesh {
  const { cells, seed, land } = LOOK_ISLANDS[k];
  return withSwitches(on, () => buildIsland(cells, seed, land, zoom));
}

export function terrainLooksChecks(check: Check): void {
  const off = LOOK_ISLANDS.map((_, k) => islandWith([], k));
  check(
    "with the land's new looks off, the land and water are drawn exactly as on main",
    off.every((m, k) => m.landHash === MAIN[k][0] && m.fluidHash === MAIN[k][1]),
    off.map((m, k) => `${LOOK_ISLANDS[k].name} ${m.landHash}/${m.fluidHash}`).join(", "),
  );
  // The fine land and the water's bands alone; the fine land's parts each on top of the fine land.
  const fine = LOOK_ISLANDS.map((_, k) => islandWith(["fine"], k));
  for (const s of LOOK_SWITCHES) {
    const base = s === "fine" || s === "bands" ? off : fine;
    const on = s === "fine" || s === "bands" ? [s] : ["fine", s];
    const a = LOOK_ISLANDS.map((_, k) => islandWith(on, k));
    const changed = a.some((m, k) => m.landHash !== base[k].landHash || m.fluidHash !== base[k].fluidHash);
    const again = islandWith(on, 0);
    check(
      `the land's look "${s}" changes the mesh, the same way each time`,
      changed && again.landHash === a[0].landHash && again.fluidHash === a[0].fluidHash,
      a.map((m, k) => `${LOOK_ISLANDS[k].name} ${m.landTriangles + m.fluidTriangles} triangles`).join(", "),
    );
  }
  // Close up the nearest chunks are in eighth voxels, the next ones in quarters.
  const close = LOOK_ISLANDS.map((_, k) => islandWith(LOOK_SWITCHES, k, "close"));
  const mid = LOOK_ISLANDS.map((_, k) => islandWith(LOOK_SWITCHES, k, "mid"));
  check(
    "close up the land is in eighth voxels near the camera and quarters around them; at mid zoom in quarters",
    close.every((m) => m.eighths > 0 && m.fineChunks > m.eighths) && mid.every((m) => m.eighths === 0 && m.fineChunks > 0),
    close.map((m, k) => `${LOOK_ISLANDS[k].name} close ${m.eighths} eighths of ${m.fineChunks}, mid ${mid[k].fineChunks}`).join(", "),
  );
  // What stands on a cell stands on the drawn ground, within an eighth voxel.
  check(
    "plants and houses stand on the slopes of the fine land within an eighth of a voxel",
    close.every((m) => m.coverGap <= 0.125 && m.houseGap <= 0.125 && m.sampled > 0),
    close.map((m, k) => `${LOOK_ISLANDS[k].name}: plants ${m.coverGap.toFixed(3)}, houses ${m.houseGap.toFixed(3)} (${m.sampled} points)`).join(", "),
  );
  // From high up (the whole island) nothing is drawn finely.
  const far = LOOK_ISLANDS.map((_, k) => islandWith(LOOK_SWITCHES, k, "far"));
  check(
    "the whole island from the sky is drawn in whole cells, as before",
    far.every((m) => m.fineChunks === 0),
    far.map((m, k) => `${LOOK_ISLANDS[k].name} ${m.fineChunks} fine chunks`).join(", "),
  );
}
