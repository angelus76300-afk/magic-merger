// Turned parts drawn whole (19 November, the owner's Moraine: thin tilted slabs drawn as stacks of
// strips leaning together). A turned part as thin as one look cube filled a staircase of cubes
// that touched only at their edges, so each row drew as its own strip, with sky between. Since,
// voxelize (src/sim/voxel/shapes.ts) gives a turned part the least thickness that keeps its cubes
// face to face. Called from scripts/props-test.ts.
import { readBox, type PropBox } from "../src/sim/props";
import { LOOK_VOXEL, voxelize, type VoxelGrid } from "../src/sim/voxel/shapes";

type Check = (name: string, ok: boolean, detail?: string) => void;

const STEPS: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

// Pieces of a grid whose cubes touch face to face.
export function pieces(g: VoxelGrid): number {
  const [nx, ny, nz] = g.n;
  const at = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && g.color[(z * ny + y) * nx + x] >= 0;
  const seen = new Uint8Array(nx * ny * nz);
  let n = 0;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const i = (z * ny + y) * nx + x;
        if (!at(x, y, z) || seen[i]) continue;
        n++;
        seen[i] = 1;
        const stack: [number, number, number][] = [[x, y, z]];
        while (stack.length) {
          const [a, b, c] = stack.pop()!;
          for (const [dx, dy, dz] of STEPS) {
            const [X, Y, Z] = [a + dx, b + dy, c + dz];
            const j = (Z * ny + Y) * nx + X;
            if (at(X, Y, Z) && !seen[j]) {
              seen[j] = 1;
              stack.push([X, Y, Z]);
            }
          }
        }
      }
  return n;
}

// The share of lines of sight square through a thin part's face, every half cube, that meet no
// cube: the sky seen through it.
export function seeThrough(b: PropBox, g: VoxelGrid): number {
  const s = g.s;
  const [nx, ny, nz] = g.n;
  const at = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && g.color[(z * ny + y) * nx + x] >= 0;
  const [ax, ay, az] = [b.rx ?? 0, b.ry ?? 0, b.rz ?? 0].map((d) => (d * Math.PI) / 180);
  // By x, then y, then z, as voxelize.
  const turn = ([x, y, z]: number[]) => {
    [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
    [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
    [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
    return [x, y, z];
  };
  const dims = [b.w, b.d, b.h];
  const thin = dims.indexOf(Math.min(...dims));
  const [p, q] = [0, 1, 2].filter((k) => k !== thin);
  const C = [b.x + b.w / 2, b.y + b.d / 2, b.z + b.h / 2];
  let rays = 0;
  let open = 0;
  for (let a = s / 2; a < dims[p]; a += s / 2)
    for (let c = s / 2; c < dims[q]; c += s / 2) {
      rays++;
      let hit = false;
      for (let t = -0.3; t <= 0.3 && !hit; t += 0.005) {
        const local = [0, 0, 0];
        local[p] = a - dims[p] / 2;
        local[q] = c - dims[q] / 2;
        local[thin] = t;
        const w = turn(local).map((v, i) => v + C[i]);
        hit = at(Math.floor((w[0] - g.o[0]) / s), Math.floor((w[1] - g.o[1]) / s), Math.floor((w[2] - g.o[2]) / s));
      }
      if (!hit) open++;
    }
  return rays ? open / rays : 0;
}

export function turnedPartsChecks(check: Check): void {
  const cases: [string, unknown[]][] = [];
  for (const t of [0.05, 0.125])
    for (const rx of [10, 20, 30, 45, 60]) cases.push([`a slab 2 by ${t} by 1.5 tilted ${rx}`, [0, 0, 0.5, 2, t, 1.5, "#777", { rx }]]);
  for (const [rx, ry, rz] of [
    [15, 20, 0],
    [25, 0, 35],
    [30, 15, 40],
    [22, 0, 150],
    [-22, 0, 210],
  ])
    cases.push([`a slab 2 by 0.125 by 1.5 turned ${rx} ${ry} ${rz}`, [0.3, 0.1, 0.5, 2, 0.125, 1.5, "#777", { rx, ry, rz }]]);
  for (const ry of [10, 25, 40]) cases.push([`a lying slab 2 by 1.5 by 0.125 tilted ${ry}`, [0, 0, 0.5, 2, 1.5, 0.125, "#777", { ry }]]);
  const broken: string[] = [];
  for (const [name, part] of cases) {
    const b = readBox(part) as PropBox;
    const g = voxelize([b], LOOK_VOXEL);
    const n = pieces(g);
    const sky = seeThrough(b, g);
    if (n !== 1 || sky > 0) broken.push(`${name}: ${n} pieces, ${(sky * 100).toFixed(1)}% see-through`);
  }
  check(`a thin turned part is one piece with no sky through it (${cases.length} slabs)`, broken.length === 0, broken.join("; "));

  // A part a quarter thick was whole before; a part turned only about its thin axis gains nothing.
  const quarter = readBox([0, 0, 0.5, 2, 0.25, 1.5, "#777", { rx: 30 }]) as PropBox;
  const spun = readBox([0, 0, 0, 2, 1.5, 0.125, "#777", { rz: 30 }]) as PropBox;
  const flat = readBox([0, 0, 0, 2, 1.5, 0.125, "#777"]) as PropBox;
  check("a turned part a quarter thick is one piece", pieces(voxelize([quarter], LOOK_VOXEL)) === 1);
  check(
    "a thin part spun flat on the ground (rz only) stays one cube layer, as before",
    voxelize([spun], LOOK_VOXEL).n[2] === 1 && voxelize([flat], LOOK_VOXEL).n[2] === 1,
    `${voxelize([spun], LOOK_VOXEL).n[2]} layers`,
  );
}
