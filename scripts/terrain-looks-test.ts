// The land's looks (5.2.5, src/sim/voxel/land-looks.ts, terrain-fine.ts): the fine land near the
// camera and what it adds, and the water's bands, each behind its own switch of GRAPHICS. Drawing
// only: with every one of them off, the land and water meshes of three islands are byte for byte
// those of main before the change (the hashes below were taken on main, 13 November 2026); each
// switch changes the mesh, and the same island always gives the same mesh.
import { MeshBasicMaterial, type Mesh } from "three";
import { generateWorld } from "../src/sim/world";
import { DEFAULT_LAND, resolveLand, type LandOptions } from "../src/sim/land-options";
import { CHUNK, FINE_SUB, Terrain, columnTop } from "../src/sim/voxel/terrain";
import { fieldFine } from "../src/sim/voxel/terrain-fine";
import { C, G } from "../src/sim/materials";
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

// What main drew, before 5.2.5: land and water hashes of each island, in the order above. Taken
// again on 19 November: the islands' rivers are curves now (land.ts water()), and a water top beside a
// wall a hundredth high no longer waves at the corner the wall shares (terrain.ts waterTop). And again
// the same day: a lake (water above the sea) is drawn clearer and its bed muted and bluer with depth
// (terrain-fine.ts lakeShare); with lakeShare held at 0 the islands draw the hashes before it
// (9c62c152/f4c767b5, afdc1f22/a6282c07, 86d5accc/f8ce9657), so nothing else changed. And again on
// 20 November: a lake's deep floor is much darker (terrain-fine.ts lakeBedDark), the land only;
// with lakeShare held at 0 the islands still draw those same hashes.
const MAIN = [
  ["e22c8abe", "364efaf7"],
  ["aee65f86", "0140ccb6"],
  ["d1b752eb", "b57f817c"],
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
  chunks: number; // the island's chunks
  // The worst gap, scene units, between the fine mesher's own heights (fieldFine, read from the
  // chunk's arrays) and groundAt's (fieldHeight), over points of every chunk.
  fieldGap: number;
  maxTileMs: number; // the longest tile of a fine chunk to build
  tileP95: number;
  // The worst gap, scene units, between the drawn ground and the cell's height under what is
  // placed by the cell's height: plants and other covers across their foot (0.12 cells from the
  // middle), houses across their whole floor (0.45). Creatures stand on the drawn ground itself.
  coverGap: number;
  houseGap: number;
  sampled: number;
  landHash: string;
  landSet: string; // the land's meshes whatever the order they were built in
  fluidHash: string;
  ms: number; // the whole island's first build, one cell meshes
  fineMs: number; // the fine chunks for the camera, all of them
}

// Builds the whole island's land and water (as the first frame does), then the fine chunks for a
// camera at `zoom` over the island's middle, and hashes every attribute of every mesh drawn.
export function buildIsland(cells: number, seed: number, land: LandOptions, zoom: Zoom = "close", after?: (terrain: Terrain) => void): IslandMesh {
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
  after?.(terrain);
  const hash = { land: 0x811c9dc5, fluid: 0x811c9dc5 };
  // The land's meshes also hashed one by one and sorted, so the same meshes built in another order
  // (nearest the camera first) hash the same.
  const lands: string[] = [];
  for (const { kind, mesh } of meshes) {
    if (!mesh.visible) continue;
    if (kind === "land") {
      let one = 0x811c9dc5;
      const g = mesh.geometry;
      const arrays = [
        ...Object.keys(g.attributes)
          .sort()
          .map((n) => g.getAttribute(n).array),
        ...(g.index ? [g.index.array] : []),
      ];
      for (const a of arrays) {
        const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
        for (let k = 0; k < bytes.length; k++) one = Math.imul(one ^ bytes[k], 0x01000193);
      }
      lands.push((one >>> 0).toString(16).padStart(8, "0"));
    }
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
  // The mesher's heights are those creatures and plants stand on: fieldFine on the chunk's arrays
  // against fieldHeight through the land, at points spread over each chunk, edges included.
  let fieldGap = 0;
  const side = Math.ceil(cells / CHUNK);
  if (GRAPHICS.fine && GRAPHICS.steps)
    for (let c = 0; c < side * side; c++) {
      const f = terrain.readFine(c);
      for (let k = 0; k < 64; k++) {
        const px = f.x0 + ((k * 0.618034 + 0.07) % 1) * (f.x1 - f.x0);
        const py = f.y0 + ((k * 0.381966 + 0.11) % 1) * (f.y1 - f.y0);
        fieldGap = Math.max(fieldGap, Math.abs(fieldFine(f, px, py) - terrain.field(px, py)));
      }
    }
  let coverGap = 0;
  let houseGap = 0;
  let sampled = 0;
  for (let i = 0; i < world.n; i++) {
    const cover = world.cover[i];
    // Covers, paths, and dry ground at the water's edge.
    // Its four neighbours on the island (not the next row's first cell past the east edge).
    const x0 = i % world.w;
    const edge =
      world.fluid[i] === 0 &&
      [x0 < world.w - 1 ? 1 : 0, x0 > 0 ? -1 : 0, world.w, -world.w].some(
        (o) => o !== 0 && world.fluid[i + o] !== undefined && world.fluid[i + o] !== 0 && world.depth[i + o] > 0.06,
      );
    if (cover === C.NONE && world.ground[i] !== G.PATH && !edge) continue;
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
    chunks: side * side,
    fieldGap,
    maxTileMs: terrain.fineStats.maxTileMs,
    coverGap,
    houseGap,
    sampled,
    tileP95: [...terrain.fineStats.tileMs].sort((a, b) => a - b)[Math.floor(terrain.fineStats.tileMs.length * 0.95)] ?? 0,
    landHash: hex(hash.land),
    landSet: hex([...lands].sort().reduce((h, x) => Math.imul(h ^ parseInt(x, 16), 0x01000193), 0x811c9dc5) >>> 0),
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
  // The fine land turned off while playing (the quality preset steps down to
  // low, or the owner's switch): every fine chunk goes, and the land is the
  // cell mesh again.
  const dropped = LOOK_ISLANDS.map((_, k) => {
    const { cells, seed, land } = LOOK_ISLANDS[k];
    return withSwitches(LOOK_SWITCHES, () =>
      buildIsland(cells, seed, land, "close", (terrain) => {
        GRAPHICS.fine = false;
        for (let i = 0; i < 3; i++) terrain.rebuild(true);
      }),
    );
  });
  check(
    "turning the fine land off while playing drops every fine chunk and shows the cell land again",
    dropped.every((m, k) => m.fineChunks === 0 && m.landTriangles === off[k].landTriangles),
    dropped.map((m, k) => `${LOOK_ISLANDS[k].name} ${m.fineChunks} fine, ${m.landTriangles}/${off[k].landTriangles} land triangles`).join(", "),
  );
  // One size of cube at every distance (15 November, the owner: "let's just keep 1/8 all the
  // time, the transitions look super weird"): every chunk in eighth voxels, close, mid and over
  // the whole island, and the same mesh whatever the camera, so nothing changes shape or pops.
  const close = LOOK_ISLANDS.map((_, k) => islandWith(LOOK_SWITCHES, k, "close"));
  const mid = LOOK_ISLANDS.map((_, k) => islandWith(LOOK_SWITCHES, k, "mid"));
  const far = LOOK_ISLANDS.map((_, k) => islandWith(LOOK_SWITCHES, k, "far"));
  check(
    "one size of cube: at every zoom every chunk of the land is drawn in eighth voxels, the same mesh close, mid and over the whole island",
    FINE_SUB === 8 &&
      [close, mid, far].every((zoom) => zoom.every((m) => m.fineChunks === m.chunks && m.eighths === m.chunks)) &&
      close.every((m, k) => m.landSet === mid[k].landSet && m.landSet === far[k].landSet),
    close
      .map(
        (m, k) =>
          `${LOOK_ISLANDS[k].name}: ${m.eighths}/${mid[k].eighths}/${far[k].eighths} of ${m.chunks} chunks in eighths, ${m.landSet} ${mid[k].landSet} ${far[k].landSet}`,
      )
      .join(", "),
  );
  // The fine mesher's heights (fieldFine) are groundAt's (fieldHeight): a creature stands on the
  // ground as drawn, not on a copy of it that could drift.
  check(
    "the fine land's mesher reads the same heights as groundAt (fieldFine equals fieldHeight)",
    // Within float32 rounding (the arrays keep heights as 32-bit floats).
    close.every((m) => m.fieldGap < 1e-4),
    close.map((m, k) => `${LOOK_ISLANDS[k].name} worst gap ${m.fieldGap.toExponential(1)}`).join(", "),
  );
  // What stands on a cell stands on the drawn ground, within an eighth voxel.
  check(
    "plants, paths, the water's edge and houses stand on the drawn ground within an eighth of a voxel",
    close.every((m) => m.coverGap <= 0.125 && m.houseGap <= 0.125 && m.sampled > 0),
    close
      .map((m, k) => `${LOOK_ISLANDS[k].name}: plants, paths, shore ${m.coverGap.toFixed(3)}, houses ${m.houseGap.toFixed(3)} (${m.sampled} points)`)
      .join(", "),
  );
}
