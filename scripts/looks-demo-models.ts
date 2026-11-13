// Three looks drawn by hand for the looks revamp, phase 1 (docs/LOOKS.md), after the owner's
// reference pictures: a castle tower with crenellations and a cone roof, a cottage with a well and
// barrels, a glowing rune stone in a dome shell. Each in two versions: "before", boxes only (what
// the writer can draw today), and "after", with the new shapes, turns and grain.
// Units as w.model's: cells across from the item, up from the ground.

type Part = (number | string | Record<string, unknown>)[];

const ring = (n: number, f: (a: number, k: number) => Part[]): Part[] => Array.from({ length: n }, (_, k) => f((k * 2 * Math.PI) / n, k)).flat();
const deg = (a: number) => Math.round(((a * 180) / Math.PI) * 100) / 100;
const r2 = (v: number) => Math.round(v * 1000) / 1000;

// --- Castle tower -------------------------------------------------------------------

const STONE = "#b8ab94";
const STONE_D = "#9c9284";
const STONE_L = "#cfc3ab";
const ROOF = "#c8606a";
const ROOF_D = "#a84a58";

export function towerAfter(): Part[] {
  return [
    // A stepped base, then the round tower in grainy stone with a darker band.
    [-1.3, -1.3, 0, 2.6, 2.6, 0.35, STONE_D, "cyl", "grain"],
    [-1.05, -1.05, 0.35, 2.1, 2.1, 0.3, STONE_D, "cyl", "grain"],
    [-0.9, -0.9, 0.65, 1.8, 1.8, 3.6, STONE, "cyl", { grain: 0.1 }],
    [-0.97, -0.97, 2.3, 1.94, 1.94, 0.16, STONE_D, "cyl"],
    // Corbels under the parapet, then the parapet and its eight merlons.
    ...ring(8, (a) => [[r2(Math.cos(a) * 0.92 - 0.12), r2(Math.sin(a) * 0.92 - 0.12), 3.95, 0.24, 0.24, 0.3, STONE_D, "wedge", { rx: 180, rz: deg(a) }]]),
    [-1.15, -1.15, 4.25, 2.3, 2.3, 0.35, STONE_L, "cyl", "grain"],
    ...ring(8, (a) => [[r2(Math.cos(a) * 0.98 - 0.17), r2(Math.sin(a) * 0.98 - 0.17), 4.6, 0.34, 0.34, 0.42, STONE_L, { rz: deg(a) }]]),
    // The cone roof, a ring of darker tiles at its eaves, a gold finial.
    [-0.85, -0.85, 4.6, 1.7, 1.7, 2.3, ROOF, "cone", { grain: 0.06 }],
    [-0.9, -0.9, 4.6, 1.8, 1.8, 0.14, ROOF_D, "cyl"],
    [-0.04, -0.04, 6.85, 0.08, 0.08, 0.45, "#e2c25a", "cyl"],
    [-0.09, -0.09, 7.2, 0.18, 0.18, 0.18, "#ffd66b", "dome", "glow"],
    // Arched windows, lit from inside; an arched door with steps.
    ...[1.2, 2.8].flatMap((z, i) => {
      const a = i ? 0.7 : -0.6;
      const x = Math.cos(a) * 0.9;
      const y = Math.sin(a) * 0.9;
      return [
        [r2(x - 0.13), r2(y - 0.03), z, 0.26, 0.06, 0.42, "#ffcf70", "glow", { rz: deg(a) + 90 }],
        [r2(x - 0.13), r2(y - 0.13), z + 0.39, 0.26, 0.26, 0.06, "#ffcf70", "cyl", "glow", { rx: 90, rz: deg(a) + 90 }],
        [r2(x - 0.17), r2(y - 0.03), z - 0.06, 0.34, 0.1, 0.06, STONE_L, { rz: deg(a) + 90 }],
      ];
    }),
    [-0.25, 0.86, 0.65, 0.5, 0.08, 0.7, "#5a3b22"],
    [-0.25, 0.65, 1.32, 0.5, 0.5, 0.06, "#5a3b22", "cyl", { rx: 90 }],
    [-0.3, 1.05, 0.35, 0.6, 0.3, 0.3, STONE_D, "grain"],
    [-0.3, 1.3, 0, 0.6, 0.3, 0.35, STONE_D, "grain"],
    // Ivy up one side, and bushes at the foot.
    ...[0.9, 1.3, 1.7, 2.1, 2.6].map((z, k): Part => [-0.98 + (k % 2) * 0.08, -0.35 + k * 0.05, z, 0.16, 0.4, 0.42, k % 2 ? "#4f8a3a" : "#5f9a44", "grain"]),
    [-1.6, -0.6, 0, 0.7, 0.7, 0.5, "#4f8a3a", "dome"],
    [-1.2, 0.9, 0, 0.55, 0.55, 0.4, "#5f9a44", "dome"],
    [1.0, -1.5, 0, 0.6, 0.6, 0.45, "#4a8236", "dome"],
    [1.3, 0.8, 0, 0.4, 0.4, 0.3, "#6aa84f", "dome"],
  ];
}

export function towerBefore(): Part[] {
  return [
    [-1.3, -1.3, 0, 2.6, 2.6, 0.35, STONE_D],
    [-1.05, -1.05, 0.35, 2.1, 2.1, 0.3, STONE_D],
    [-0.9, -0.9, 0.65, 1.8, 1.8, 3.6, STONE],
    [-0.97, -0.97, 2.3, 1.94, 1.94, 0.16, STONE_D],
    [-1.15, -1.15, 4.25, 2.3, 2.3, 0.35, STONE_L],
    ...[-1.15, -0.3, 0.55].flatMap((x) => [
      [x, -1.15, 4.6, 0.6, 0.3, 0.42, STONE_L],
      [x, 0.85, 4.6, 0.6, 0.3, 0.42, STONE_L],
    ]),
    // A roof of stacked boxes, smaller as it rises.
    ...[0, 1, 2, 3, 4].map((k): Part => [-0.85 + k * 0.17, -0.85 + k * 0.17, 4.6 + k * 0.45, 1.7 - k * 0.34, 1.7 - k * 0.34, 0.45, k % 2 ? ROOF_D : ROOF]),
    [-0.04, -0.04, 6.85, 0.08, 0.08, 0.45, "#e2c25a"],
    [-0.13, -0.93, 1.2, 0.26, 0.06, 0.55, "#ffcf70", "glow"],
    [-0.13, 0.87, 2.8, 0.26, 0.06, 0.55, "#ffcf70", "glow"],
    [-0.25, 0.86, 0.65, 0.5, 0.08, 0.9, "#5a3b22"],
    [-0.3, 1.05, 0.35, 0.6, 0.3, 0.3, STONE_D],
    [-0.3, 1.3, 0, 0.6, 0.3, 0.35, STONE_D],
    [-1.6, -0.6, 0, 0.7, 0.7, 0.5, "#4f8a3a"],
    [-1.2, 0.9, 0, 0.55, 0.55, 0.4, "#5f9a44"],
    [1.0, -1.5, 0, 0.6, 0.6, 0.45, "#4a8236"],
  ];
}

// --- Cottage with a well and barrels ----------------------------------------------------

const WALL = "#ecdcbc";
const BEAM = "#8a4a2e";
const TILE = "#b5523b";
const TILE_L = "#c4603f";
const TILE_D = "#8c3a2a";
const WOOD = "#8a5a2a";

export function cottageAfter(): Part[] {
  // Laid on the quarter-cell voxel grid, as the reference cottage (image 16): a timber frame in a
  // darker colour than the wall, windows set back behind the frame, a roof of tile rows with a
  // darker eave row and ridge, greenery hanging off the edges.
  const roof: Part[] = [];
  for (let i = 0; i < 7; i++) {
    const tone = i === 0 ? TILE_D : i % 2 ? TILE : TILE_L;
    roof.push([-1.75 + i * 0.25, -1.0, 1.75 + i * 0.25, 0.25, 2.0, 0.5, tone, { grain: 0.06 }]);
    roof.push([1.5 - i * 0.25, -1.0, 1.75 + i * 0.25, 0.25, 2.0, 0.5, tone, { grain: 0.06 }]);
  }
  return [
    // A stone footing, then the walls and the gables.
    [-1.5, -1.0, 0, 3.0, 2.0, 0.25, "#9a948a", "grain"],
    [-1.25, -0.75, 0.25, 2.5, 1.5, 1.5, WALL, { grain: 0.05 }],
    [-1.25, -0.75, 1.75, 1.25, 1.5, 1.5, WALL, "wedge", { rz: 180, grain: 0.05 }],
    [0, -0.75, 1.75, 1.25, 1.5, 1.5, WALL, "wedge", { grain: 0.05 }],
    // The roof, a ridge, a chimney.
    ...roof,
    [-0.25, -1.0, 3.5, 0.5, 2.0, 0.25, TILE_D],
    [0.5, -0.5, 2.25, 0.25, 0.25, 1.75, "#8c7c6c", "grain"],
    [0.5, -0.5, 4.0, 0.25, 0.25, 0.25, "#6c5c50"],
    // The timber frame on the front: posts and a top plate.
    ...[-1.25, -0.5, 0.25, 1.0].map((x): Part => [x, 0.75, 0.25, 0.25, 0.25, 1.5, BEAM]),
    [-1.25, 0.75, 1.75, 2.5, 0.25, 0.25, BEAM],
    // And on the east side.
    ...[-0.75, 0.5].map((y): Part => [1.25, y, 0.25, 0.25, 0.25, 1.5, BEAM]),
    [1.25, -0.75, 1.75, 0.25, 1.5, 0.25, BEAM],
    // Windows lit warm, set back behind the frame; the door, set back too, and its step.
    [-1.0, 0.5, 0.75, 0.25, 0.25, 0.5, "#ffd37a", "glow"],
    [0.75, 0.5, 0.75, 0.25, 0.25, 0.5, "#ffd37a", "glow"],
    [1.0, 0.25, 0.75, 0.25, 0.25, 0.5, "#ffd37a", "glow"],
    [1.0, -0.5, 0.75, 0.25, 0.25, 0.5, "#ffd37a", "glow"],
    [-0.25, 0.5, 0.25, 0.5, 0.25, 1.0, "#5a3b22"],
    [-0.25, 1.0, 0, 0.5, 0.25, 0.25, "#9a948a"],
    // Flower boxes under the front windows, greenery hanging off the eaves and climbing a corner.
    [-1.0, 1.0, 0.5, 0.5, 0.25, 0.25, "#4f8a3a"],
    [0.5, 1.0, 0.5, 0.5, 0.25, 0.25, "#4f8a3a"],
    [-1.0, 1.0, 0.75, 0.25, 0.25, 0.25, "#e86a9a"],
    [0.75, 1.0, 0.75, 0.25, 0.25, 0.25, "#f2c94c"],
    [-1.75, 0.75, 1.25, 0.25, 0.25, 0.5, "#5f9a44", "grain"],
    [-1.75, 0.25, 1.5, 0.25, 0.5, 0.25, "#4f8a3a"],
    [1.5, -1.0, 1.25, 0.25, 0.5, 0.5, "#5f9a44", "grain"],
    [-1.5, 0.75, 0, 0.25, 0.5, 1.25, "#4f8a3a", "grain"],
    [-1.75, 0.5, 0, 0.5, 0.75, 0.5, "#5f9a44", "dome"],
    // The well: stone ring, water that shines a little, two posts, a little roof, a bucket.
    [1.8, 1.1, 0, 0.9, 0.9, 0.55, "#9a9aa0", "cyl", "grain"],
    [1.88, 1.18, 0.5, 0.74, 0.74, 0.06, "#4fb3e8", "cyl", "glow"],
    [1.82, 1.5, 0.55, 0.08, 0.08, 0.8, BEAM],
    [2.6, 1.5, 0.55, 0.08, 0.08, 0.8, BEAM],
    [1.7, 1.15, 1.35, 0.55, 0.8, 0.3, TILE, "wedge", { rz: 180 }],
    [2.25, 1.15, 1.35, 0.55, 0.8, 0.3, TILE, "wedge"],
    [1.86, 1.52, 1.05, 0.8, 0.05, 0.05, BEAM],
    [2.12, 1.43, 0.75, 0.2, 0.2, 0.2, WOOD, "cyl"],
    // Barrels with dark bands, one on its side; a crate; a bench.
    ...[
      [-2.1, 0.5],
      [-2.05, 1.05],
    ].flatMap(([x, y]): Part[] => [
      [x, y, 0, 0.48, 0.48, 0.62, WOOD, "cyl", "grain"],
      [x - 0.02, y - 0.02, 0.12, 0.52, 0.52, 0.06, "#3e2a18", "cyl"],
      [x - 0.02, y - 0.02, 0.46, 0.52, 0.52, 0.06, "#3e2a18", "cyl"],
    ]),
    [-2.5, 1.5, -0.07, 0.48, 0.48, 0.62, WOOD, "cyl", { rx: 90, rz: 20, grain: 0.08 }],
    [-1.9, -0.9, 0, 0.55, 0.55, 0.55, "#b08850", "grain"],
    [-1.92, -0.92, 0.25, 0.59, 0.59, 0.06, BEAM],
    [0.4, 1.3, 0.25, 0.7, 0.22, 0.05, WOOD],
    [0.45, 1.33, 0, 0.06, 0.16, 0.25, BEAM],
    [1.0, 1.33, 0, 0.06, 0.16, 0.25, BEAM],
    // A path of flat stones, flowers, bushes.
    ...[0, 1, 2].map((k): Part => [-0.25 + k * 0.12, 1.35 + k * 0.42, 0, 0.42, 0.34, 0.06, "#b9b2a6", "cyl"]),
    [-1.5, -1.6, 0, 0.6, 0.6, 0.45, "#4f8a3a", "dome"],
    [1.3, -1.5, 0, 0.7, 0.6, 0.5, "#5f9a44", "dome"],
    ...[0, 1, 2, 3].map((k): Part => [-1.2 + k * 0.25, 1.0, 0, 0.1, 0.1, 0.18, ["#e86a9a", "#f2c94c", "#a98cf0", "#ffffff"][k], "dome"]),
  ];
}

export function cottageBefore(): Part[] {
  return [
    [-1.35, -1.0, 0, 2.7, 2.0, 0.25, "#9a948a"],
    [-1.25, -0.9, 0.25, 2.5, 1.8, 1.25, WALL],
    [-1.3, 0.85, 1.38, 2.6, 0.1, 0.12, BEAM],
    // A roof of boxes, stepped in.
    ...[0, 1, 2, 3].map((k): Part => [-1.55 + k * 0.38, -1.15, 1.42 + k * 0.28, 3.1 - k * 0.76, 2.3, 0.3, k % 2 ? "#a84a35" : TILE]),
    [0.55, -0.5, 1.9, 0.32, 0.32, 1.0, "#8c7c6c"],
    [-0.25, 0.9, 0.25, 0.5, 0.06, 0.95, "#5a3b22"],
    [-1.0, 0.9, 0.7, 0.4, 0.05, 0.4, "#ffd37a", "glow"],
    [0.6, 0.9, 0.7, 0.4, 0.05, 0.4, "#ffd37a", "glow"],
    [1.8, 1.1, 0, 0.9, 0.9, 0.55, "#9a9aa0"],
    [1.88, 1.18, 0.5, 0.74, 0.74, 0.06, "#4fb3e8", "glow"],
    [1.82, 1.5, 0.55, 0.08, 0.08, 0.8, BEAM],
    [2.6, 1.5, 0.55, 0.08, 0.08, 0.8, BEAM],
    [1.7, 1.15, 1.35, 1.1, 0.8, 0.15, TILE],
    [-2.1, 0.5, 0, 0.48, 0.48, 0.62, WOOD],
    [-2.05, 1.05, 0, 0.48, 0.48, 0.62, WOOD],
    [-1.9, -0.9, 0, 0.55, 0.55, 0.55, "#b08850"],
    [-1.5, -1.6, 0, 0.6, 0.6, 0.45, "#4f8a3a"],
  ];
}

// --- Rune stone in a dome shell -----------------------------------------------------------

const RUNE = "#5ff0ff";
const DARK = "#3d3a48";

// A shell of glowing ribs: meridians and two rings, each a thin box turned along the dome.
function shell(R: number, H: number): Part[] {
  const out: Part[] = [];
  const els = [0, 22.5, 45, 67.5, 90].map((d) => (d * Math.PI) / 180);
  const at = (a: number, e: number) => [Math.cos(e) * Math.cos(a) * R, Math.cos(e) * Math.sin(a) * R, Math.sin(e) * H];
  for (let m = 0; m < 6; m++) {
    const a = (m * Math.PI) / 3;
    for (let i = 0; i + 1 < els.length; i++) {
      const p = at(a, els[i]);
      const q = at(a, els[i + 1]);
      const c = p.map((v, k) => (v + q[k]) / 2);
      const L = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      const tilt = Math.atan2(Math.hypot(q[0] - p[0], q[1] - p[1]), q[2] - p[2]);
      out.push([r2(c[0] - 0.04), r2(c[1] - 0.04), r2(c[2] - L / 2), 0.08, 0.08, r2(L + 0.04), RUNE, "glow", { ry: -deg(tilt), rz: deg(a) }]);
    }
  }
  for (const e of [0]) {
    const r = Math.cos(e) * R;
    const z = Math.sin(e) * H;
    const L = 2 * r * Math.sin(Math.PI / 16) + 0.04;
    for (let k = 0; k < 16; k++) {
      const a = ((k + 0.5) * Math.PI) / 8;
      const cx = Math.cos(a) * r * Math.cos(Math.PI / 16);
      const cy = Math.sin(a) * r * Math.cos(Math.PI / 16);
      out.push([r2(cx - L / 2), r2(cy - 0.04), r2(z - 0.04), r2(L), 0.08, 0.08, RUNE, "glow", { rz: deg(a) + 90 }]);
    }
  }
  return out;
}

export function runeAfter(): Part[] {
  return [
    // A round dais of two steps, and a ring of stones turned every way.
    [-1.9, -1.9, 0, 3.8, 3.8, 0.2, "#6c6878", "cyl", "grain"],
    [-1.3, -1.3, 0.2, 2.6, 2.6, 0.18, "#7c7888", "cyl", "grain"],
    ...ring(10, (a, k) => [
      [
        r2(Math.cos(a) * 2.3 - 0.2),
        r2(Math.sin(a) * 2.3 - 0.15),
        0,
        0.4,
        0.3,
        0.25 + (k % 3) * 0.08,
        "#8a8698",
        "grain",
        { rz: deg(a) + 17 * k, rx: (k % 4) * 6 },
      ],
    ]),
    // The stone: dark, grainy, a little tilted, with a pointed top.
    [-0.42, -0.26, 0.38, 0.84, 0.52, 2.2, DARK, { grain: 0.12 }],
    [-0.42, -0.26, 2.58, 0.42, 0.52, 0.5, DARK, "wedge", { rz: 180, grain: 0.12 }],
    [0, -0.26, 2.58, 0.42, 0.52, 0.5, DARK, "wedge", { grain: 0.12 }],
    // Runes: glowing seams cut into its two broad faces.
    ...[-0.29, 0.24].flatMap((y) =>
      [0.7, 1.15, 1.6, 2.05].flatMap((z, k): Part[] => [
        [-0.3 + (k % 2) * 0.2, y, z, 0.32, 0.05, 0.05, RUNE, "glow"],
        [-0.12 + (k % 2) * 0.1, y, z - 0.14, 0.05, 0.05, 0.3, RUNE, "glow"],
        [0.1 - (k % 2) * 0.2, y, z + 0.08, 0.16, 0.05, 0.05, RUNE, "glow", { ry: k % 2 ? 40 : -40 }],
      ]),
    ),
    [-0.05, -0.3, 2.35, 0.1, 0.06, 0.1, RUNE, "glow", { ry: 45 }],
    // A cyan core below it, and blocks drifting up off the dais.
    [-0.3, -0.3, 0.38, 0.6, 0.6, 0.3, RUNE, "dome", "glow"],
    ...[
      [1.0, 0.4, 1.0, 20],
      [-1.0, 0.7, 1.6, 50],
      [0.6, -1.0, 2.2, 75],
      [-0.7, -0.6, 2.7, 15],
    ].map(([x, y, z, t]): Part => [x, y, z, 0.22, 0.22, 0.22, "#8a8698", "grain", { rx: t, ry: t / 2, rz: t * 2 }]),
    // The shell.
    ...shell(2.0, 3.6),
  ];
}

export function runeBefore(): Part[] {
  return [
    [-1.9, -1.9, 0, 3.8, 3.8, 0.2, "#6c6878"],
    [-1.3, -1.3, 0.2, 2.6, 2.6, 0.18, "#7c7888"],
    [-0.42, -0.26, 0.38, 0.84, 0.52, 2.2, DARK],
    [-0.3, -0.18, 2.58, 0.6, 0.36, 0.3, DARK],
    ...[-0.29, 0.24].flatMap((y) => [0.7, 1.15, 1.6, 2.05].map((z, k): Part => [-0.3 + (k % 2) * 0.2, y, z, 0.32, 0.05, 0.05, RUNE, "glow"])),
    [-0.3, -0.3, 0.38, 0.6, 0.6, 0.2, RUNE, "glow"],
    // A shell as a box writer draws it: four posts and two square rings.
    ...[
      [-1.7, -1.7],
      [1.62, -1.7],
      [-1.7, 1.62],
      [1.62, 1.62],
    ].map(([x, y]): Part => [x, y, 0, 0.08, 0.08, 2.4, RUNE, "glow"]),
    [-1.7, -1.7, 2.4, 3.4, 0.08, 0.08, RUNE, "glow"],
    [-1.7, 1.62, 2.4, 3.4, 0.08, 0.08, RUNE, "glow"],
    [-1.7, -1.7, 2.4, 0.08, 3.4, 0.08, RUNE, "glow"],
    [1.62, -1.7, 2.4, 0.08, 3.4, 0.08, RUNE, "glow"],
    [-1.0, -1.0, 3.2, 2.0, 0.08, 0.08, RUNE, "glow"],
    [-1.0, 0.92, 3.2, 2.0, 0.08, 0.08, RUNE, "glow"],
  ];
}

export const DEMOS = {
  tower: { before: towerBefore, after: towerAfter },
  cottage: { before: cottageBefore, after: cottageAfter },
  rune: { before: runeBefore, after: runeAfter },
};

// A program that draws the three side by side, as a player's item would (one cast, three models).
export function demoProgram(version: "before" | "after", gap = 6): string {
  const at = [
    ["tower", -gap, 0],
    ["cottage", 0, 0],
    ["rune", gap, 0],
  ] as const;
  const calls = at.map(([k, dx, dy]) => `w.model(w.x + ${dx}, w.y + ${dy}, ${JSON.stringify(DEMOS[k][version]())}, { name: "${k}", vary: 0.03 });`).join("\n");
  return `const spell = { *cast(w) {\n${calls}\n} };`;
}

// One of them alone, for a closer frame.
export function demoOne(k: keyof typeof DEMOS, version: "before" | "after"): string {
  return `const spell = { *cast(w) { w.model(w.x, w.y, ${JSON.stringify(DEMOS[k][version]())}, { name: "${k}", vary: 0.03 }); } };`;
}
