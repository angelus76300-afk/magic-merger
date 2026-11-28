// Far land (23 November, the owner on the Fold: 27 frames a second falling to 13 on a large island,
// 2.8 to 4.9 million triangles in the sky view). A chunk whose eighths are under a pixel is drawn far
// (terrain.ts Terrain.wantFar, terrain-fine.ts FAR): its dry columns in blocks of two by two. These
// checks build the small island in eighths, then far, then half and half like a chessboard:
//   - a far chunk has well under the triangles of the same chunk in eighths;
//   - where a far chunk meets one in eighths, every step between their columns has its wall (no
//     gap), and with the border columns blocked too (FAR.edge 0) the same check finds gaps;
//   - a chunk in eighths is the same mesh, byte for byte, whatever its neighbours' level;
//   - a chunk switched back to eighths shows its kept mesh in the same frame (no wait, no pop);
//   - land dug on a far chunk, then zoomed into: no frame shows the kept mesh of the land before;
//   - a cube tree's coarse run (its shadow from the sky) has well under its triangles.
import { MeshBasicMaterial, type BufferGeometry, type Mesh } from "three";
import { generateWorld, type World } from "../src/sim/world";
import { GRAPHICS, type GraphicsFlag } from "../src/sim/voxel/graphics";
import { CHUNK, Terrain } from "../src/sim/voxel/terrain";
import { FAR } from "../src/sim/voxel/terrain-fine";
import { cubeTreeGeometry } from "../src/sim/voxel/cubes";
import { LOOK_ISLANDS } from "./terrain-looks-test";
import { crater } from "./land-lag-test";

type Check = (name: string, ok: boolean, detail?: string) => void;

interface Inside {
  fine: (Mesh | null | undefined)[];
  fineFar: Uint8Array;
  fineOther: ({ mesh: Mesh | null } | null)[];
  fineStale: Uint8Array;
  group: unknown;
  cols: number;
  rows: number;
}

const LOOKS: GraphicsFlag[] = ["fine", "steps", "blend", "grain", "relief", "rocks", "bits", "water", "foam"];

function withLooks<T>(run: () => T): T {
  const was = LOOKS.map((f) => GRAPHICS[f]);
  for (const f of LOOKS) GRAPHICS[f] = true;
  try {
    return run();
  } finally {
    LOOKS.forEach((f, k) => (GRAPHICS[f] = was[k]));
  }
}

// The small island, its fine land built whole at the level `far` gives each chunk.
function build(far: (c: number) => number, dig = false): { terrain: Terrain; inside: Inside; w: number; h: number; world: World } {
  const { cells, seed, land } = LOOK_ISLANDS[2];
  const world = generateWorld(cells, cells, seed, land);
  if (dig) DIG.apply(world);
  const mat = new MeshBasicMaterial();
  const terrain = new Terrain(
    world,
    mat,
    new MeshBasicMaterial(),
    () => {},
    () => {},
  );
  terrain.wantFar = far;
  terrain.scan();
  terrain.rebuild(true);
  terrain.focus(30, 40, 30, 0, 0);
  terrain.updateFine(0, true);
  return { terrain, inside: terrain as unknown as Inside, w: world.w, h: world.h, world };
}

// A crater inside chunk 10 (third column, third row), as the review of 23 November dug it.
const DUG = 10;
const DIG = crater(80, 80, 4, 3);

const tris = (m: Mesh | null | undefined) => (m ? (m.geometry.index?.count ?? 0) / 3 : 0);

function bytes(g: BufferGeometry): string {
  let h = 0x811c9dc5;
  for (const name of Object.keys(g.attributes).sort()) {
    const a = g.getAttribute(name).array as ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number };
    const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let k = 0; k < b.length; k++) h = Math.imul(h ^ b[k], 0x01000193);
  }
  return (h >>> 0).toString(16);
}

interface Quad {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  // An upright quad: its foot from (ax, az) to (bx, bz); NaN for any other quad. A flat wall
  // (terrain-fine.ts cutWalls) runs off the axes, or along one a hair inside the border.
  ax: number;
  az: number;
  bx: number;
  bz: number;
  // Its corners in x and z, for a top's outline (a flat wall's column has a top of three to five
  // corners, under its box).
  xs: number[];
  zs: number[];
}

function quads(m: Mesh): Quad[] {
  const p = m.geometry.getAttribute("position").array as Float32Array;
  const out: Quad[] = [];
  for (let o = 0; o + 12 <= p.length; o += 12) {
    const xs = [p[o], p[o + 3], p[o + 6], p[o + 9]];
    const ys = [p[o + 1], p[o + 4], p[o + 7], p[o + 10]];
    const zs = [p[o + 2], p[o + 5], p[o + 8], p[o + 11]];
    const r = {
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys),
      z0: Math.min(...zs),
      z1: Math.max(...zs),
      ax: NaN,
      az: NaN,
      bx: NaN,
      bz: NaN,
      xs,
      zs,
    };
    if (r.y1 - r.y0 > E && Math.hypot(r.x1 - r.x0, r.z1 - r.z0) > E) {
      // Upright when every corner lies on the line of the two farthest apart in x and z.
      let i = 0;
      let jj = 0;
      let d = -1;
      for (let a = 0; a < 4; a++)
        for (let b = a + 1; b < 4; b++) {
          const v = Math.hypot(xs[a] - xs[b], zs[a] - zs[b]);
          if (v > d) [d, i, jj] = [v, a, b];
        }
      const off = (q: number) => Math.abs((xs[jj] - xs[i]) * (zs[q] - zs[i]) - (zs[jj] - zs[i]) * (xs[q] - xs[i])) / d;
      if (d > E && [0, 1, 2, 3].every((q) => off(q) < E)) [r.ax, r.az, r.bx, r.bz] = [xs[i], zs[i], xs[jj], zs[jj]];
    }
    out.push(r);
  }
  return out;
}

const E = 1e-4;

// Along every border of two chunks with land: for each row of eighths across it, the tops of the
// two columns that meet there (the last of one chunk, the first of the other), and whether every
// height between them is closed by a wall on the border's plane, in either chunk. The rows where
// either column has no land top (water, a gap in the land) are left out. Returns the rows checked
// and the samples found open.
function borderGaps(inside: Inside, w: number, h: number): { rows: number; open: number } {
  const { cols, rows } = inside;
  const q = inside.fine.map((m) => (m ? quads(m) : []));
  let checked = 0;
  let open = 0;
  // Inside a top's corners (convex, either winding; a corner twice is a triangle).
  const within = (r: Quad, x: number, z: number) => {
    let pos = false;
    let neg = false;
    for (let a = 0; a < 4; a++) {
      const b = (a + 1) % 4;
      const l = Math.hypot(r.xs[b] - r.xs[a], r.zs[b] - r.zs[a]);
      if (l < E) continue;
      const c = ((r.xs[b] - r.xs[a]) * (z - r.zs[a]) - (r.zs[b] - r.zs[a]) * (x - r.xs[a])) / l;
      if (c > E) pos = true;
      if (c < -E) neg = true;
    }
    return !(pos && neg);
  };
  const top = (list: Quad[], x: number, z: number) => {
    let best = -Infinity;
    for (const r of list)
      if (r.y1 - r.y0 < E && r.x0 - E <= x && x <= r.x1 + E && r.z0 - E <= z && z <= r.z1 + E && within(r, x, z)) best = Math.max(best, r.y0);
    return best;
  };
  // Or any wall whose foot crosses the row between the two columns' points (a flat wall).
  const across = (r: Quad, px: number, pz: number, qx: number, qz: number) => {
    if (Number.isNaN(r.ax)) return false;
    const side = (x: number, z: number) => (r.bx - r.ax) * (z - r.az) - (r.bz - r.az) * (x - r.ax);
    const ends = (x: number, z: number) => (qx - px) * (z - pz) - (qz - pz) * (x - px);
    return side(px, pz) * side(qx, qz) <= E * E && ends(r.ax, r.az) * ends(r.bx, r.bz) <= E * E;
  };
  const closed = (lists: Quad[][], alongX: boolean, at: number, s: number, y: number) =>
    lists.some((list) =>
      list.some((r) =>
        r.y0 - E <= y && y <= r.y1 + E
          ? alongX
            ? (r.z1 - r.z0 < E && Math.abs(r.z0 - at) < E && r.x0 - E <= s && s <= r.x1 + E) || across(r, s, at - 1 / 16, s, at + 1 / 16)
            : (r.x1 - r.x0 < E && Math.abs(r.x0 - at) < E && r.z0 - E <= s && s <= r.z1 + E) || across(r, at - 1 / 16, s, at + 1 / 16, s)
          : false,
      ),
    );
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      const a = cy * cols + cx;
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ]) {
        if (cx + dx >= cols || cy + dy >= rows) continue;
        const b = (cy + dy) * cols + cx + dx;
        if (!q[a].length || !q[b].length) continue;
        // The border's plane and the rows of eighths along it, in scene units.
        const alongX = dy === 1;
        const at = alongX ? (cy + 1) * CHUNK - h / 2 : (cx + 1) * CHUNK - w / 2;
        const from = alongX ? cx * CHUNK - w / 2 : cy * CHUNK - h / 2;
        for (let k = 0; k < CHUNK * 8; k++) {
          const s = from + (k + 0.5) / 8;
          const ta = alongX ? top(q[a], s, at - 1 / 16) : top(q[a], at - 1 / 16, s);
          const tb = alongX ? top(q[b], s, at + 1 / 16) : top(q[b], at + 1 / 16, s);
          if (!Number.isFinite(ta) || !Number.isFinite(tb)) continue;
          checked++;
          const lo = Math.min(ta, tb);
          const hi = Math.max(ta, tb);
          for (let y = lo + 0.01; y < hi - 0.005; y += 0.02) if (!closed([q[a], q[b]], alongX, at, s, y)) open++;
        }
      }
    }
  return { rows: checked, open };
}

export function farLandChecks(check: Check): void {
  withLooks(() => {
    const near = build(() => 0);
    const far = build(() => 1);
    const n = near.inside.fine.length;
    let nearTris = 0;
    let farTris = 0;
    let worst = 0;
    for (let c = 0; c < n; c++) {
      const a = tris(near.inside.fine[c]);
      const b = tris(far.inside.fine[c]);
      nearTris += a;
      farTris += b;
      if (a > 20000) worst = Math.max(worst, b / a);
    }
    check(
      "far land: a far chunk has well under the triangles of the same chunk in eighths (all under 0.65, none above 0.9)",
      farTris > 0 && farTris < nearTris * 0.65 && worst < 0.9,
      `eighths ${nearTris}, far ${farTris} (${(farTris / nearTris).toFixed(2)}), worst chunk ${worst.toFixed(2)}`,
    );
    check(
      "far land: every chunk with land is drawn far, its mesh in eighths kept for the switch back",
      far.inside.fine.every((m, c) => !m || (far.inside.fineFar[c] === 1 && !!far.inside.fineOther[c]?.mesh)),
    );

    // Half and half, like a chessboard: every border is between the two levels.
    const board = (c: number) => ((c % near.inside.cols) + Math.floor(c / near.inside.cols)) % 2;
    const mixed = build(board);
    const gaps = borderGaps(mixed.inside, mixed.w, mixed.h);
    check("far land: where a far chunk meets one in eighths, every step has its wall (no gap)", gaps.rows > 500 && gaps.open === 0, JSON.stringify(gaps));
    const allNear = borderGaps(near.inside, near.w, near.h);
    check("far land: the gap check finds none in eighths everywhere either", allNear.open === 0, JSON.stringify(allNear));
    const was = FAR.edge;
    FAR.edge = 0;
    let opened: { rows: number; open: number };
    try {
      const edge = build(board);
      opened = borderGaps(edge.inside, edge.w, edge.h);
    } finally {
      FAR.edge = was;
    }
    check("far land: with the border columns blocked too, the same check finds gaps (it can see one)", opened.open > 0, JSON.stringify(opened));

    let same = 0;
    let eighths = 0;
    for (let c = 0; c < n; c++) {
      const m = mixed.inside.fine[c];
      const o = near.inside.fine[c];
      if (board(c) || !m || !o) continue;
      eighths++;
      if (bytes(m.geometry) === bytes(o.geometry)) same++;
    }
    check("far land: a chunk in eighths is the same mesh, byte for byte, beside far chunks", eighths > 3 && same === eighths, `${same} of ${eighths}`);

    // Back to eighths: the kept meshes shown in the next frame, none built again.
    const kept = far.inside.fine.map((_, c) => far.inside.fineOther[c]?.mesh ?? null);
    far.terrain.wantFar = () => 0;
    far.terrain.updateFine(0);
    const back = far.inside.fine.every((m, c) => !kept[c] || (m === kept[c] && far.inside.fineFar[c] === 0));
    check("far land: back to eighths, each chunk shows its kept mesh in the same frame", back);

    // Dug from the sky, then zoomed into: the far chunk is built again with the crater, the kept
    // mesh in eighths (the land before it) is never shown again, a new one is built in the
    // background, and the switch back shows it at once, with the crater, as a fresh build of the
    // dug island has it.
    const sky = build(() => 1);
    const before = sky.inside.fineOther[DUG]?.mesh ?? null;
    const beforeBytes = before ? bytes(before.geometry) : "";
    DIG.apply(sky.world);
    sky.terrain.scan();
    let frames = 0;
    const shownOld: number[] = [];
    const frame = () => {
      sky.terrain.rebuild(false);
      frames++;
      const m = sky.inside.fine[DUG];
      if (m && (m === before || (sky.inside.fineFar[DUG] === 0 && bytes(m.geometry) === beforeBytes))) shownOld.push(frames);
    };
    while (frames < 400 && (sky.inside.fineStale[DUG] !== 0 || sky.inside.group)) frame();
    const farAgain = sky.inside.fineFar[DUG] === 1 && sky.inside.fineStale[DUG] === 0;
    // Its mesh in eighths built again in the background, with the crater, for the switch back.
    while (frames < 600 && !sky.inside.fineOther[DUG]?.mesh) frame();
    const rebuilt = sky.inside.fineOther[DUG]?.mesh ?? null;
    sky.terrain.wantFar = () => 0;
    while (frames < 800 && (sky.inside.fineFar[DUG] !== 0 || sky.inside.fineStale[DUG] !== 0 || sky.inside.group)) frame();
    const fresh = build(() => 0, true).inside.fine[DUG];
    const now = sky.inside.fine[DUG];
    const asFresh = !!now && !!fresh && bytes(now.geometry) === bytes(fresh.geometry);
    const instant = !!rebuilt && rebuilt !== before && now === rebuilt;
    check(
      "far land: dug from the sky, then zoomed into, no frame shows the land before the crater, and it comes back at once in eighths with it",
      !!before && farAgain && shownOld.length === 0 && sky.inside.fineFar[DUG] === 0 && asFresh && instant,
      JSON.stringify({ kept: !!before, farAgain, shownOld: shownOld.slice(0, 5), frames, eighths: sky.inside.fineFar[DUG] === 0, asFresh, instant }),
    );
  });

  const g = cubeTreeGeometry("oak", 0, 9);
  const runs = g.userData.runs as { fine: number; coarse: number };
  check("far trees: a cube tree's coarse run has under half its triangles", runs.coarse > 0 && runs.coarse < runs.fine * 0.5, JSON.stringify(runs));
}
