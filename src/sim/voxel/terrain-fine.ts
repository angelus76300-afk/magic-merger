// The fine land of 5.2.5: the island near the camera drawn in small voxels, the scale of the
// reference models (the owner's cottage island: the land, the house and the trees all one small
// cube). Each cell of the simulation becomes `sub` by `sub` columns: 8 (eighth voxels) close to
// the camera, 4 (quarter voxels) a little farther. Drawing only: the cells' heights and grounds are
// read, never changed, and the columns in the middle of a cell stay at its height, so whatever
// stands on the cell still stands on it.
//
// The owner, on the first pass: "it must look refined and detailed, not messy and too busy". So
// surfaces are calm (tones in large soft patches, a few shades a ground, merged into big
// rectangles) and the detail is at the edges: steps, the grass lip, cliff strata, the sand to water
// border, the foam line. Every irregularity follows smooth noise of the position, so a border is a
// wavy line, never a sprinkle of loose cubes.
//
// What the switches add (land-looks.ts): `steps` softens a rise of one voxel into small irregular
// steps and breaks the lip of a cliff; `blend` makes the border of two grounds a wavy line, lets
// sand reach into the shallows and grass hang over a cliff; `grain` gives each ground soft patches
// of tone and cliffs their strata; `foam` rings the shore; `bits` grows a few clusters of flowers
// on grass and pebbles on sand. A chunk is built in tiles of TILE cells (terrain.ts spreads them
// over frames); tops of the same height and colour are merged into rectangles, walls into runs.
import { GRAPHICS } from "./graphics";
import { FACE_LIGHT } from "./models";
import { mixColor, scaleColor } from "../colors";
import { G } from "../materials";
import type { Writer } from "./terrain";
import { ICE_MARK, SIDE_MARK } from "./water-light";
import { BIOMES, type Biome } from "../land-options";

// Cells a side of the piece of a chunk built at once.
export const TILE = 8;

// The cells of a chunk and a border of three, as the fine mesher reads them.
export interface FineCells {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number; // the island's cells
  h: number;
  bottom: number;
  bw: number; // row length of the arrays below (chunk + 3 + 3)
  inside: Uint8Array;
  top: Int16Array;
  ground: Uint8Array;
  natural: Uint8Array; // 0: a built column (a trunk, a tower), drawn plain
  wet: Uint8Array;
  water: Float32Array; // the surface over a wet water or lava cell, or -1e9
  lava: Uint8Array; // 1 where that is lava (no foam)
  ice: Uint8Array; // 1 where that is water frozen to ice, drawn with the water in eighths (iceTone)
  color: Uint32Array; // the top's colour
  // A natural ground's tone in its region (Terrain.toneAt), NO_TONE (0x1000000) for any other: where two
  // cells of one ground have two tones, their border wanders as two grounds' does.
  tone: Uint32Array;
  edge: Uint32Array; // the first voxel of a wall
  soil: Uint32Array;
  stone: Uint32Array;
  deep: Uint32Array;
  // Grounds that blend with each other, grass that hangs, where flowers and pebbles grow.
  blends: Uint8Array;
  hangs: Uint8Array;
  flowers: Uint8Array;
  pebbles: Uint8Array;
  // A house's cell: kept flat, its floor on its height (no slope into or out of it).
  flat: Uint8Array;
  // The cell's continuous height (scene units), and whether something stands on it.
  value: Float32Array;
  // The cell's own height (scene units), not rounded and not eased with its neighbours'.
  raw: Float32Array;
  anchored: Uint8Array;
  // Snow or bare rock: steps of up to STEEP_LINK voxels to such a neighbour curve (16 November).
  steep: Uint8Array;
  // The deep colour of the water over the cell (its region's), for the water in eighths.
  wdeep: Uint32Array;
  // Its shallow colour, for the short sides of the water in eighths (a river's small falls).
  wshallow: Uint32Array;
  // How narrow the cell's water is (riverNarrow), 0 where it is dry.
  wnarrow: Float32Array;
  // How much the cell's water is a lake's, its surface above the sea (lakeShare): 0 for the sea.
  wlake: Float32Array;
  // A spell's ground (Big Bang's stardust and the crystal it becomes) and what lies among it:
  // its colour drawn as soft patches (`soft`, the 5 by 5 mean round the cell) where softOn is 1.
  soft: Uint32Array;
  softOn: Uint8Array;
  // Life under water (20 November, weed): WEED_STONE where stones may lie on the bed, WEED_GROWS
  // where weed may grow too (Terrain.weedCell), the cell's land (WEED_LANDS) and the rank under
  // which its chunk keeps a clump (weedKeep, WEED_CAP_CHUNK).
  weed: Uint8Array;
  weedLand: Uint8Array;
  weedKeep: Float32Array;
}

export function makeFineCells(): FineCells {
  return {
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
    w: 0,
    h: 0,
    bottom: 0,
    bw: 0,
    inside: new Uint8Array(0),
    top: new Int16Array(0),
    ground: new Uint8Array(0),
    natural: new Uint8Array(0),
    wet: new Uint8Array(0),
    water: new Float32Array(0),
    lava: new Uint8Array(0),
    ice: new Uint8Array(0),
    color: new Uint32Array(0),
    tone: new Uint32Array(0),
    edge: new Uint32Array(0),
    soil: new Uint32Array(0),
    stone: new Uint32Array(0),
    deep: new Uint32Array(0),
    blends: new Uint8Array(0),
    hangs: new Uint8Array(0),
    flowers: new Uint8Array(0),
    pebbles: new Uint8Array(0),
    flat: new Uint8Array(0),
    value: new Float32Array(0),
    raw: new Float32Array(0),
    anchored: new Uint8Array(0),
    steep: new Uint8Array(0),
    wdeep: new Uint32Array(0),
    wshallow: new Uint32Array(0),
    wnarrow: new Float32Array(0),
    wlake: new Float32Array(0),
    soft: new Uint32Array(0),
    softOn: new Uint8Array(0),
    weed: new Uint8Array(0),
    weedLand: new Uint8Array(0),
    weedKeep: new Float32Array(0),
  };
}

// Sizes the arrays for a chunk; the caller fills them for every cell of the chunk and its border.
export function sizeFineCells(f: FineCells, x0: number, y0: number, x1: number, y1: number, w: number, h: number, bottom: number): void {
  f.x0 = x0;
  f.y0 = y0;
  f.x1 = x1;
  f.y1 = y1;
  f.w = w;
  f.h = h;
  f.bottom = bottom;
  f.bw = x1 - x0 + 6;
  const n = f.bw * (y1 - y0 + 6);
  if (f.top.length < n) {
    f.inside = new Uint8Array(n);
    f.top = new Int16Array(n);
    f.ground = new Uint8Array(n);
    f.natural = new Uint8Array(n);
    f.wet = new Uint8Array(n);
    f.water = new Float32Array(n);
    f.lava = new Uint8Array(n);
    f.ice = new Uint8Array(n);
    f.color = new Uint32Array(n);
    f.tone = new Uint32Array(n);
    f.edge = new Uint32Array(n);
    f.soil = new Uint32Array(n);
    f.stone = new Uint32Array(n);
    f.deep = new Uint32Array(n);
    f.blends = new Uint8Array(n);
    f.hangs = new Uint8Array(n);
    f.flowers = new Uint8Array(n);
    f.pebbles = new Uint8Array(n);
    f.flat = new Uint8Array(n);
    f.value = new Float32Array(n);
    f.raw = new Float32Array(n);
    f.anchored = new Uint8Array(n);
    f.steep = new Uint8Array(n);
    f.wdeep = new Uint32Array(n);
    f.wshallow = new Uint32Array(n);
    f.wnarrow = new Float32Array(n);
    f.wlake = new Float32Array(n);
    f.soft = new Uint32Array(n);
    f.softOn = new Uint8Array(n);
    f.weed = new Uint8Array(n);
    f.weedLand = new Uint8Array(n);
    f.weedKeep = new Float32Array(n);
  }
}

// Index of cell (x, y) in the arrays (island coordinates, the border included).
export function fineAt(f: FineCells, x: number, y: number): number {
  return (y - f.y0 + 3) * f.bw + (x - f.x0 + 3);
}

// A number in [0, 1) for a whole point and a purpose, the same every time.
function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smooth noise in [0, 1) at (x, y) in cells, changing over about `period` cells: the same at a
// point whatever the level of detail, the tile or the chunk.
function noise(x: number, y: number, period: number, salt: number): number {
  const gx = x / period;
  const gy = y / period;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  let fx = gx - ix;
  let fy = gy - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, salt);
  const b = hash(ix + 1, iy, salt);
  const c = hash(ix, iy + 1, salt);
  const d = hash(ix + 1, iy + 1, salt);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
// The strata of a cliff: a tone for each band of two voxels, by its height, so bands run level
// across a cliff (grain).
const STRATA_TONE = [1, 0.86, 0.95, 0.8, 1.03, 0.9];
// Three shades a ground, in soft patches several cells across (grain).
const SHADES = [0.96, 1, 1.04];
const SHADE_PERIOD = 6.5;
const FLOWERS = [0xe8505b, 0xf4d35e, 0xf6f2ea, 0xd987e0, 0xf08a3c];
const PEBBLES = [0xbdb6a6, 0x9a958a, 0xd8d2c4];
// Life under water (20 November, the first of it): clumps of weed and a few stones on a lake's
// bed, in the fine land in eighths only (GRAPHICS.weed), baked in its mesh like the flowers. Weed
// grows in patches (WEED_PATCH, cells WEED_PERIOD across), one or two clumps a cell of 3 by 3
// stalks, shorter at their edge; never nearer the surface than WEED_UNDER eighths (no foam, no
// stalk through the water) and only where the bed is WEED_MIN to WEED_MAX eighths under it: the
// shelf, not the deep middle, which stays bare and dark. Its colour is the bed's, darkened by its
// depth as the bed is, mixed toward its land's weed, so depth still reads through it.
export const WEED_STONE = 1;
export const WEED_GROWS = 2;
export const WEED_UNDER = 2;
export const WEED_MIN = 4;
export const WEED_MAX = 12;
export const WEED_TALL = 6;
// At most this many clumps a chunk (Terrain.readFine keeps those of the lowest ranks).
export const WEED_CAP_CHUNK = 256;
const WEED_PERIOD = 3.5;
const WEED_PATCH = 0.6;
const WEED_MIX = 0.55;
export const WEED_LIGHT_LO = 0.65;
export const WEED_LIGHT_HI = 1.08;
const WEED_STALK = 0.55;
// A stone in WEED_STONES of the cells; 2 by 1 eighths in WEED_STONE_LONG of them, else 2 by 2.
const WEED_STONES = 0.05;
const WEED_STONE_LONG = 0.4;
const WEED_TINT: Record<Biome, number> = {
  temperate: 0x3d7a3a,
  swamp: 0x4a5a2a,
  jungle: 0x2f7a45,
  tundra: 0x5a6a4a,
  desert: 0x6a7a3a,
  mesa: 0x6a7a3a,
  volcanic: 0x3a4a30,
};
const WEED_DENSITY: Record<Biome, number> = { temperate: 1, swamp: 1.4, jungle: 1.2, tundra: 0.5, desert: 0.5, mesa: 0.5, volcanic: 0.3 };
// The lands by index (FineCells.weedLand).
export const WEED_LANDS: readonly Biome[] = BIOMES;
// The clumps of weed cell (cx, cy) of land `land` has (0, 1 or 2), their ranks pushed to `ranks`.
export function weedClumps(cx: number, cy: number, land: number, ranks: number[] | null = null): number {
  if (noise(cx, cy, WEED_PERIOD, 141) <= WEED_PATCH) return 0;
  const dense = WEED_DENSITY[WEED_LANDS[land] ?? "temperate"];
  let n = 0;
  for (let k = 0; k < 2; k++) {
    if (!weedClump(cx, cy, k, dense)) continue;
    n++;
    if (ranks) ranks.push(hash(cx, cy, 150 + k));
  }
  return n;
}
function weedClump(cx: number, cy: number, k: number, dense: number): boolean {
  return hash(cx, cy, 142 + k) < (k ? 0.25 : 0.7) * dense;
}
// The luminance of a colour, 0 to 255.
function luma(c: number): number {
  return 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
}
const FOAM = 0xf4f9fc;
const FOAM_SOFT = 0xd9eef6;
const CREASE = 0.74;
// Quarter or eighth voxels of border kept around a tile, for its walls and its foam.
const B = 3;
// The highest step, in columns' units, drawn as part of a slope rather than as a wall.
const RISER = 2;
// How much of a wall's darker side a slope's riser takes: enough for each small cube's edge to
// show, not so much that the slope turns to stripes.
const RISER_SIDE = 0.45;
// On bare rock, the share of the per voxel variation kept (tone patches, risers' dark sides,
// hollows): half, so slopes of rock read by their light rather than as a mosaic.
const ROCK_CALM = 0.5;
// On sand and snow, the share of a step's dark side kept.
const BRIGHT_CALM = 0.5;
// The rock's strata (rocks): three tones of a cliff's stone, by the voxel band.
const ROCK_TONE = [1, 0.86, 0.94];

// The ground's tint by its height in voxels (relief): low ground a touch warmer and darker, high
// ground lighter and cooler, in six bands so tops still merge.
export function tint(color: number, height: number): number {
  const t = Math.round(Math.max(0, Math.min(1, (height - 2) / 12)) * 5) / 5;
  const k = 0.93 + 0.12 * t;
  const warm = (0.5 - t) * 0.07;
  const ch = (sh: number, f: number) => Math.max(0, Math.min(255, Math.round(((color >> sh) & 255) * f)));
  return (ch(16, k * (1 + warm)) << 16) | (ch(8, k) << 8) | ch(0, k * (1 - warm));
}

// A ground's tone: soft patches of three shades, several cells across (15 November, the owner:
// "it looks a bit too granulated now"), so a field of grass is calm but not flat.
function shadeAt(px: number, py: number): number {
  const n = noise(px, py, SHADE_PERIOD, 31);
  return SHADES[n < 0.36 ? 0 : n < 0.64 ? 1 : 2];
}

// The tone patches' shade at (px, py) in cells as the fine land draws a natural ground (grain), half
// of it on bare rock: for the land in whole cells, so from afar it reads as the fine land does.
export function grainShade(px: number, py: number, rock: boolean): number {
  const k = shadeAt(px, py);
  return rock ? 1 + (k - 1) * ROCK_CALM : k;
}

// The secondary terrain map (steps): the land drawn from the island's own continuous heights
// (world.height, the generator's field, which the simulation keeps as floats and only rounds to
// whole voxels in columnTop), so slopes curve, start at varied distances from a cell's side and
// change steepness along their length. A bicubic (Catmull-Rom) through the cells' heights, read by
// the fine land and by what stands on it (Terrain.groundAt).
// - Where something stands (an anchored cell: a cover such as a tree, crops or a house, a path, a
//   built column, ground next to water), the cell keeps its rounded height around its middle, so
//   what stands on it stands on the drawn ground; a house's cell stays flat all over.
// - A neighbour two or more voxels away is not followed: the cliff stays.
// - Open ground undulates gently, an eighth voxel or so, over a few cells.
// Heights in scene units; (px, py) in cells, cell (x, y) spanning [x, x + 1).
export interface LandRead {
  top(x: number, y: number): number;
  // The cell's continuous height, in scene units.
  value(x: number, y: number): number;
  // Whether something stands on the cell, and whether it is a house's (flat all over).
  anchored(x: number, y: number): boolean;
  flat(x: number, y: number): boolean;
  // Whether the land of two cells joins without a cliff.
  linked(ax: number, ay: number, bx: number, by: number): boolean;
  // Snow or bare rock (a steep step to such a neighbour curves), and a water bed: natural ground
  // under water (the bed curves as the land does, 16 November). Both false off the island.
  steep(x: number, y: number): boolean;
  bed(x: number, y: number): boolean;
  // Wet with any fluid, and natural ground (not built), on the island.
  wet(x: number, y: number): boolean;
  natural(x: number, y: number): boolean;
}
// Catmull-Rom weights for t in [0, 1], for the samples at -1, 0, 1, 2.
function cr(t: number, w: number[]): void {
  const t2 = t * t;
  const t3 = t2 * t;
  w[0] = -0.5 * t3 + t2 - 0.5 * t;
  w[1] = 1.5 * t3 - 2.5 * t2 + 1;
  w[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  w[3] = 0.5 * t3 - 0.5 * t2;
}
const WX = [0, 0, 0, 0];
const WY = [0, 0, 0, 0];
// Around an anchored cell's middle (ANCHOR cells each way) the cell's own height, eased out to
// ANCHOR_OUT.
const ANCHOR = 0.16;
const ANCHOR_OUT = 0.44;
// Snow and bare rock (16 November, the owner's peaks: "big white-topped cubes with dark sides"):
// a step of up to STEEP_LINK voxels between two such cells curves as a slope instead of standing
// as a wall, the field kept within STEEP_SPAN of the cell's height (a step of three meets at its
// middle, a voxel and a half from either side). Taller steps stay cliffs, their lip bevelled.
export const STEEP_LINK = 8;
// How far a dirt road's edge wanders into the grass or out of it, in cells (21 November): a few
// eighths either way, so a road one cell wide keeps most of its width and has no straight kerb.
export const ROAD_WANDER = 0.22;
const STEEP_SPAN = 4;
// A water bed follows the beds round it up to BED_LINK voxels, and rises toward dry land up to
// BED_SHORE above it, so the shallows climb to the shore in small cubes instead of per cell steps.
const BED_LINK = 4;
const BED_SHORE = 2;
const BED_SPAN = 2;
export function fieldHeight(land: LandRead, px: number, py: number): number {
  let cx = Math.floor(px);
  let cy = Math.floor(py);
  // A cliff's corner cut on the diagonal (cliffCorner): the point read as its neighbour's land.
  if (CLIFF_CORNER.on && GRAPHICS.steps) {
    const k = cliffCorner(cornerOfLand(land), cx, cy, px, py);
    if (k === 1) {
      cx += px - cx > 0.5 ? 1 : -1;
      px = intoCell(px, cx);
    } else if (k === 2) {
      cy += py - cy > 0.5 ? 1 : -1;
      py = intoCell(py, cy);
    }
  }
  const t = land.top(cx, cy);
  if (land.flat(cx, cy)) return t;
  const gx = px - 0.5;
  const gy = py - 0.5;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  cr(gx - ix, WX);
  cr(gy - iy, WY);
  if (land.bed(cx, cy)) {
    let h = 0;
    for (let j = 0; j < 4; j++) {
      const ny = iy - 1 + j;
      let row = 0;
      for (let i = 0; i < 4; i++) {
        const nx = ix - 1 + i;
        let v = t;
        if (nx !== cx || ny !== cy) v = bedLink(t, land.top(nx, ny), land.natural(nx, ny), land.bed(nx, ny), land.wet(nx, ny));
        row += WX[i] * v;
      }
      h += WY[j] * row;
    }
    return Math.max(t - BED_SPAN, Math.min(t + BED_SPAN, h));
  }
  const own = land.anchored(cx, cy) ? t : land.value(cx, cy);
  let h = 0;
  for (let j = 0; j < 4; j++) {
    const ny = iy - 1 + j;
    let row = 0;
    for (let i = 0; i < 4; i++) {
      const nx = ix - 1 + i;
      let v = own;
      if ((nx !== cx || ny !== cy) && land.linked(cx, cy, nx, ny)) v = land.anchored(nx, ny) ? land.top(nx, ny) : land.value(nx, ny);
      row += WX[i] * v;
    }
    h += WY[j] * row;
  }
  // Never more than a voxel from the cell's own height (two on snow and rock): the bicubic
  // overshoots a little.
  const span = land.steep(cx, cy) ? STEEP_SPAN : 1;
  h = Math.max(t - span, Math.min(t + span, h));
  const fx = Math.abs(px - cx - 0.5);
  const fy = Math.abs(py - cy - 0.5);
  if (land.anchored(cx, cy)) {
    const a = Math.max(0, Math.min(1, (ANCHOR_OUT - Math.max(fx, fy)) / (ANCHOR_OUT - ANCHOR)));
    return h * (1 - a) + t * a;
  }
  // Open ground: a gentle swell over several cells.
  return h + swell(px, py);
}

// The height a water bed (own height t) takes from a neighbour of height n: another bed's, dry land
// a little above it (the shore), its own otherwise.
function bedLink(t: number, n: number, natural: boolean, bed: boolean, wet: boolean): number {
  if (!natural) return t;
  if (bed) return Math.abs(n - t) <= BED_LINK ? n : t;
  return !wet && n > t && n - t <= BED_SHORE ? n : t;
}

// Whether two dry cells' land joins (the field follows the neighbour): a voxel apart, or up to
// STEEP_LINK between two cells of snow or bare rock.
export function joins(dt: number, steepA: boolean, steepB: boolean): boolean {
  return Math.abs(dt) <= 1 || (steepA && steepB && Math.abs(dt) <= STEEP_LINK);
}

// Cliff corners cut on the diagonal (26 November, the owner: "Look at how bad the borders look
// now!"). A cliff too tall to curve stands on the cells' sides, so where it runs diagonally across
// the cells it was a sawtooth of whole-cell notches, a dark notch of shadow in each. Where a cell
// stands alone against the three others of the 2 by 2 cells round one of its corners (they at one
// level, it a cliff above or below them), the corner's triangle beyond the line through the middles
// of its two sides takes their level. A staircase of cells along a diagonal cliff then meets on one
// straight line (the cut of the low cell at an inner step and of the high cell at the next outer
// step lie on it), a little wavy (CLIFF_CORNER.wave). A lone cell keeps the diamond round its middle.
// Only between dry natural ground, not where something stands on the cell cut (its middle never
// changes anyway), so what stands on the land still stands on it; the slopes of snow and rock that
// curve (joins) are left to the field. `on` is a switch for the checks
// (scripts/cliff-corner-test.ts).
export const CLIFF_CORNER = { on: true, cut: 0.5, wave: 0.08 };
// What cliffCorner reads of a cell (x, y): its height in voxels, whether it is dry natural ground
// that no house keeps flat (the other cells of a corner), whether something stands on it, and
// whether it is snow or bare rock.
export interface CornerRead {
  top(x: number, y: number): number;
  open(x: number, y: number): boolean;
  anchored(x: number, y: number): boolean;
  steep(x: number, y: number): boolean;
}
// The cell whose land the point (px, py) of cell (cx, cy) is drawn with: 0 its own, 1 its
// neighbour along x toward the point, 2 along y.
export function cliffCorner(r: CornerRead, cx: number, cy: number, px: number, py: number): number {
  const fx = px - cx - 0.5;
  const fy = py - cy - 0.5;
  const ax = Math.abs(fx);
  const ay = Math.abs(fy);
  if (ax + ay <= CLIFF_CORNER.cut - CLIFF_CORNER.wave) return 0;
  if (ax + ay <= CLIFF_CORNER.cut + (noise(px, py, 0.9, 71) - 0.5) * 2 * CLIFF_CORNER.wave) return 0;
  if (!r.open(cx, cy) || r.anchored(cx, cy)) return 0;
  const ex = cx + (fx > 0 ? 1 : -1);
  const ey = cy + (fy > 0 ? 1 : -1);
  if (!r.open(ex, cy) || !r.open(cx, ey) || !r.open(ex, ey)) return 0;
  const t = r.top(cx, cy);
  const tb = r.top(ex, cy);
  const tc = r.top(cx, ey);
  const td = r.top(ex, ey);
  // The three others at one level.
  if (Math.abs(tb - tc) > 1 || Math.abs(tb - td) > 1 || Math.abs(tc - td) > 1) return 0;
  // This cell a cliff away from each of them.
  const st = r.steep(cx, cy);
  if (joins(tb - t, st, r.steep(ex, cy)) || joins(tc - t, st, r.steep(cx, ey)) || joins(td - t, st, r.steep(ex, ey))) return 0;
  return ax >= ay ? 1 : 2;
}
// cliffCorner's reading of the island (LandRead, for groundAt) and of a chunk's cells (the mesher).
const LAND_CORNER = new WeakMap<LandRead, CornerRead>();
function cornerOfLand(land: LandRead): CornerRead {
  let r = LAND_CORNER.get(land);
  if (!r) {
    r = {
      top: (x, y) => land.top(x, y),
      open: (x, y) => land.natural(x, y) && !land.wet(x, y) && !land.flat(x, y),
      anchored: (x, y) => land.anchored(x, y),
      steep: (x, y) => land.steep(x, y),
    };
    LAND_CORNER.set(land, r);
  }
  return r;
}
const CELLS_CORNER = new WeakMap<FineCells, CornerRead>();
function cornerOfCells(f: FineCells): CornerRead {
  let r = CELLS_CORNER.get(f);
  if (!r) {
    r = cornerReadOf(f);
    CELLS_CORNER.set(f, r);
  }
  return r;
}
function cornerReadOf(f: FineCells): CornerRead {
  const at = (x: number, y: number) => {
    if (x < f.x0 - 3 || y < f.y0 - 3 || x >= f.x1 + 3 || y >= f.y1 + 3) return -1;
    const c = fineAt(f, x, y);
    return f.inside[c] ? c : -1;
  };
  return {
    top: (x, y) => f.top[at(x, y)],
    open: (x, y) => {
      const c = at(x, y);
      return c >= 0 && f.natural[c] === 1 && f.wet[c] === 0 && f.flat[c] === 0;
    },
    anchored: (x, y) => f.anchored[at(x, y)] === 1,
    steep: (x, y) => f.steep[at(x, y)] === 1,
  };
}
// A point (px, py) moved just inside cell (cx, cy) (a corner's triangle read as its neighbour's land).
const CORNER_IN = 0.01;
export function intoCell(p: number, c: number): number {
  return Math.max(c + CORNER_IN, Math.min(c + 1 - CORNER_IN, p));
}

// The gentle swell of open ground: about a tenth of a voxel either way, over patches several
// cells wide (it was over three cells, and flat ground read as granular).
export function swell(px: number, py: number): number {
  return (noise(px, py, SWELL_PERIOD, 95) - 0.5) * SWELL;
}
const SWELL_PERIOD = 7;
const SWELL = 0.2;

// The field in whole columns of 1 / sub. Rounded with a small wobble of position (a fifth of a
// step either way, over a cell), so a slope running diagonally breaks into wavy steps instead of
// a regular staircase, and flat ground is not cut into a sprinkle of one cube steps. Where the
// field sits on a whole step (a cell's own height, under what stands on it) the wobble never
// changes the step.
export function fieldStep(h: number, px: number, py: number, sub: number): number {
  return Math.round(h * sub + (noise(px, py, 1.1, 99) - 0.5) * 0.45);
}

// fieldHeight on the fine cells' own arrays, for the mesher: the same field, without a call per
// neighbour (16 of them a column).
export function fieldFine(f: FineCells, px: number, py: number): number {
  let cx = Math.floor(px);
  let cy = Math.floor(py);
  // A cliff's corner cut on the diagonal, as fieldHeight reads it (the mesher has already moved its
  // columns into the cell they are drawn as: there this changes nothing).
  if (CLIFF_CORNER.on && GRAPHICS.steps && cx >= f.x0 - 2 && cy >= f.y0 - 2 && cx < f.x1 + 2 && cy < f.y1 + 2) {
    const k = cliffCorner(cornerOfCells(f), cx, cy, px, py);
    if (k === 1) {
      cx += px - cx > 0.5 ? 1 : -1;
      px = intoCell(px, cx);
    } else if (k === 2) {
      cy += py - cy > 0.5 ? 1 : -1;
      py = intoCell(py, cy);
    }
  }
  const c = fineAt(f, cx, cy);
  const t = f.top[c];
  if (f.flat[c]) return t;
  const gx = px - 0.5;
  const gy = py - 0.5;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  cr(gx - ix, WX);
  cr(gy - iy, WY);
  if (isBed(f, c)) {
    let h = 0;
    for (let j = 0; j < 4; j++) {
      let n = fineAt(f, ix - 1, iy - 1 + j);
      let row = 0;
      for (let i = 0; i < 4; i++, n++) {
        const v = n === c || !f.inside[n] ? t : bedLink(t, f.top[n], f.natural[n] === 1, isBed(f, n), f.wet[n] === 1);
        row += WX[i] * v;
      }
      h += WY[j] * row;
    }
    return Math.max(t - BED_SPAN, Math.min(t + BED_SPAN, h));
  }
  const own = f.anchored[c] ? t : f.value[c];
  const mine = f.natural[c] && !f.wet[c];
  const steep = f.steep[c] === 1;
  let h = 0;
  for (let j = 0; j < 4; j++) {
    let n = fineAt(f, ix - 1, iy - 1 + j);
    let row = 0;
    for (let i = 0; i < 4; i++, n++) {
      let v = own;
      if (n !== c && mine && f.inside[n] && f.natural[n] && !f.wet[n] && !f.flat[n] && joins(f.top[n] - t, steep, f.steep[n] === 1))
        v = f.anchored[n] ? f.top[n] : f.value[n];
      row += WX[i] * v;
    }
    h += WY[j] * row;
  }
  const span = steep ? STEEP_SPAN : 1;
  h = Math.max(t - span, Math.min(t + span, h));
  if (f.anchored[c]) {
    const fx = Math.abs(px - cx - 0.5);
    const fy = Math.abs(py - cy - 0.5);
    const a = Math.max(0, Math.min(1, (ANCHOR_OUT - Math.max(fx, fy)) / (ANCHOR_OUT - ANCHOR)));
    return h * (1 - a) + t * a;
  }
  return h + swell(px, py);
}

// A water bed's height in columns, in eighths, without the land's dither: seen through water, its
// lone columns read as scattered blocks, and steps of a whole voxel as fins.
// Never above the water: a cell the simulation counts as wet is shallow ground seen through it,
// at least an eighth under its surface (risen toward the shore, it stood out as a sand islet).
function bedStep(h: number, level: number, sub: number): number {
  return Math.min(Math.round(h * sub), Math.ceil(level * sub) - 1);
}

// A water bed: natural ground under water (not lava, not another fluid).
export function isBed(f: FineCells, c: number): boolean {
  return f.inside[c] === 1 && f.wet[c] === 1 && f.water[c] > -1e8 && f.lava[c] === 0 && f.natural[c] === 1;
}

// A lake's rim (27 November, the owner: "Look at how bad the borders look now!"): where sand meets
// grass at a lake's edge and on its bed, the border between grounds was drawn in whole-cell stairs,
// the blend of two grounds skipping every cell under water. A cell of a lake's bed (not the sea's,
// not ice) now takes part in the blend like dry ground, with its dry neighbours and with other cells
// of the bed. Off (LAKE_RIM.on false), as before.
export const LAKE_RIM = { on: true };
function blendsWet(f: FineCells, c: number): boolean {
  return !f.wet[c] || (LAKE_RIM.on && isBed(f, c) && f.ice[c] === 0 && f.wlake[c] > 0);
}

// The waterline in eighths (18 November). Which side of the line where water meets land a column
// is on, by a smooth map of which cells are water (shoreMask): 1 at a water cell's middle, 0 at a dry
// one's, in between a Catmull-Rom curve over the 4 by 4 cells round the column, plus a little wobble
// (SHORE_WAVE). Its half-way line runs along a straight coast's cell edges, a little wavy, and cuts
// across a diagonal coast's steps instead of following them. Only at a low shore: water (not lava)
// on one side, natural ground (not a house) on the other at most SHORE_LOW above it; a cliff into
// the water keeps its wall at the cell's edge. Every cell's middle keeps its own side, so a cell
// under water still has its water, and the land over a water cell is always beside a dry cell.
// A quarter more since the water in eighths lies lower (23 November, Terrain.fineWaterLevel: a
// quarter lower by the sea than lifted over its rounded tops), so a bank a voxel over the sea still
// curves into it: kept as a cliff, it drew a wall of soil along the shore.
const SHORE_LOW = 1 + 0.25;
// How far under a water cell's surface (scene units) the nearest dry neighbour's own height may lie
// and still be its shore: a beach's sand lies a little under the water drawn over it.
const RAW_UNDER = 0.3;
const SHORE_WAVE = 0.1;
// How far into the dry side (in the map's values) the ground ramps down to the water's edge, and
// where pebbles lie.
const SHORE_RAMP = 0.4;
const SHORE_PEBBLE = 0.3;
export const SHORE_NONE = 0;
export const SHORE_FLOOD = 1; // a column of a dry cell under the neighbouring water (SHORE_N)
export const SHORE_LAND = 2; // a column of a water cell drawn as its shore's land (SHORE_N's)
export const SHORE_RAISE = 3; // a column of a dry shore cell, ramped to the water's edge
// What shoreLine found: the new height (columns), the cell named, the map's value.
let SHORE_H = 0;
let SHORE_N = -1;
let SHORE_W = 0;
const SX = [0, 0, 0, 0];
const SY = [0, 0, 0, 0];
export function shoreMask(f: FineCells, own: number, px: number, py: number): number {
  const gx = px - 0.5;
  const gy = py - 0.5;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  cr(gx - ix, SX);
  cr(gy - iy, SY);
  const mine = isWater(f, own) ? 1 : 0;
  let w = 0;
  for (let j = 0; j < 4; j++) {
    let n = fineAt(f, ix - 1, iy - 1 + j);
    let row = 0;
    for (let i = 0; i < 4; i++, n++) row += SX[i] * (!f.inside[n] ? mine : isWater(f, n) ? 1 : 0);
    w += SY[j] * row;
  }
  return w + (noise(px, py, 0.8, 131) - 0.5) * 2 * SHORE_WAVE;
}
// Distance from (px, py) to cell (x, y)'s square, squared.
function toCell(px: number, py: number, x: number, y: number): number {
  const dx = Math.max(x - px, 0, px - x - 1);
  const dy = Math.max(y - py, 0, py - y - 1);
  return dx * dx + dy * dy;
}
// For the column at (px, py) of cell c (cx, cy), natural ground of height hgt (columns): SHORE_NONE
// away from a low shore, else what it becomes (SHORE_H, SHORE_N, SHORE_W).
export function shoreLine(f: FineCells, c: number, cx: number, cy: number, px: number, py: number, hgt: number, sub: number): number {
  const wet = isBed(f, c);
  if (!wet && (f.wet[c] || f.flat[c] || !f.natural[c])) return SHORE_NONE;
  // The nearest neighbour across the shore (a water cell from dry ground, low dry ground from water).
  let best = -1;
  let far = Infinity;
  let lo = Infinity;
  let hi = -Infinity;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const n = fineAt(f, cx + dx, cy + dy);
      if (!f.inside[n]) continue;
      if (f.wet[n] && f.lava[n]) return SHORE_NONE;
      if (wet) {
        if (f.wet[n] || f.flat[n] || !f.natural[n] || f.top[n] - f.water[c] > SHORE_LOW) continue;
      } else {
        if (!isBed(f, n)) continue;
        lo = Math.min(lo, f.water[n]);
        hi = Math.max(hi, f.water[n]);
      }
      const d = toCell(px, py, cx + dx, cy + dy);
      if (d < far) {
        far = d;
        best = n;
      }
    }
  if (best < 0) return SHORE_NONE;
  // The nearest dry ground lies under this water by its own height (not its rounded top), a hole
  // by a river's mouth: no shore here. Raised toward it, or toward the next nearest farther off, a
  // column stood above the water, joined to nothing (19 November).
  if (wet && f.raw[best] < f.water[c] - RAW_UNDER) return SHORE_NONE;
  // Dry ground by water of one level (not a fall), low enough.
  if (!wet && (hi - lo > LEVEL_JOIN || f.top[c] - hi > SHORE_LOW)) return SHORE_NONE;
  const level = wet ? f.water[c] : f.water[best];
  // The first column at or above the water's surface.
  const edge = Math.ceil(level * sub);
  const w = shoreMask(f, c, px, py);
  SHORE_N = best;
  SHORE_W = w;
  if (wet) {
    if (w > 0.5) return SHORE_NONE;
    SHORE_H = Math.max(hgt, edge);
    return SHORE_LAND;
  }
  if (w > 0.5) {
    SHORE_H = Math.min(hgt, edge - 1);
    return SHORE_FLOOD;
  }
  // The dry side: down to the water's edge near the line, and never under the water there (it drew
  // the water's side as a dark line along the shore), nor under the highest water beside it (by a
  // river's mouth, where two levels meet at a corner, a column of the higher one's shore stood alone).
  const k = Math.min(1, (0.5 - w) / SHORE_RAMP);
  const top = Math.max(edge, Math.ceil(hi * sub));
  if (k >= 1 || hgt < top - sub) return SHORE_NONE;
  SHORE_H = hgt > top ? top + Math.round((hgt - top) * k) : top;
  return SHORE_RAISE;
}

// Reused between builds: heights and colours of a tile's columns with a border of B.
let H = new Int32Array(0);
let C = new Uint32Array(0);
let D = new Uint8Array(0); // 1 where a top takes spell drawings
let DONE = new Uint8Array(0);
// 1 on open dry ground (not a flower, a tuft or a boulder), 2 where that ground is bare rock.
let LAND = new Uint8Array(0);
let SUM = new Float64Array(0);
// Each column's cell (fineAt), its riser (the tallest step drawn as part of a slope), its night glow
// level (0 to GLOW_LEVELS), and the surface of the water over it (NaN where it is not under water).
let CELL = new Int32Array(0);
// The cell whose walls a column is drawn with (wallFaces): its own, the neighbour's whose land it
// is drawn as at a cliff's corner (cliffCorner, then CELL too) or at the shore (shoreLine's land
// raised over a water cell), -1 off the island.
let WALLC = new Int32Array(0);
let RS = new Uint8Array(0);
let GL = new Uint8Array(0);
// 1 where a column is a water bed under the water's surface (its faces are lit as the water lights them).
let WET = new Uint8Array(0);
let WL = new Float32Array(0);
// 1 where a column's top is sand (its colour's ground): its small steps are lit as its slope.
let SANDY = new Uint8Array(0);
// The water cell whose surface covers a column of a dry cell (shoreLine), -1 elsewhere.
let FLOOD = new Int32Array(0);
// The nearest lava (cells away and its surface) and house (cells away and its floor) to a column.
let LAVA_D = new Float32Array(0);
let LAVA_Y = new Float32Array(0);
let HOUSE_D = new Float32Array(0);
let HOUSE_Y = new Float32Array(0);
// Weed and stones on a lake's bed (weed): what stands on each column (WEED_NONE...), how many
// eighths above the bed, the clump's tone, and the bed's colour under it once darkened by depth.
const WEED_NONE = 0;
const WEED_STALKS = 1;
const WEED_TOP = 2; // a clump's middle, its tallest
const WEED_ROCK = 3;
let WEEDS = new Uint8Array(0);
let RAISE = new Uint8Array(0);
let WEED_K = new Float32Array(0);
let BEDC = new Uint32Array(0);

// What stands on column s of bed (lx, ly the column in its cell c, sx, sy in the island, `hgt` the
// bed's height, in eighths): its WEEDS, tone and height above the bed (the return).
function weedAt(f: FineCells, c: number, cx: number, cy: number, lx: number, ly: number, sx: number, sy: number, hgt: number, s: number): number {
  // The lowest surface over the cell and the cells round it (all water, Terrain.weedCell): the
  // water drawn over any part of the cell is at least that high.
  let level = Infinity;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) level = Math.min(level, f.water[fineAt(f, cx + dx, cy + dy)]);
  const avail = Math.floor(level * 8) - hgt;
  if (f.weed[c] & WEED_GROWS && avail >= WEED_MIN && avail <= WEED_MAX) {
    const dense = WEED_DENSITY[WEED_LANDS[f.weedLand[c]] ?? "temperate"];
    if (noise(cx, cy, WEED_PERIOD, 141) > WEED_PATCH) {
      let best = 0;
      let kind = WEED_NONE;
      let tone = 1;
      for (let k = 0; k < 2; k++) {
        if (!weedClump(cx, cy, k, dense) || hash(cx, cy, 150 + k) >= f.weedKeep[c]) continue;
        // The clump's middle, so its 3 by 3 stays in the cell.
        const mx = 1 + Math.floor(hash(cx, cy, 144 + 2 * k) * 6);
        const my = 1 + Math.floor(hash(cx, cy, 145 + 2 * k) * 6);
        if (Math.abs(lx - mx) > 1 || Math.abs(ly - my) > 1) continue;
        const top = Math.max(2, Math.round(Math.min(WEED_TALL, avail - WEED_UNDER, Math.ceil(avail * 0.55)) * (0.6 + 0.4 * hash(cx, cy, 152 + k))));
        const middle = lx === mx && ly === my;
        if (!middle && hash(sx, sy, 156 + k) >= WEED_STALK) continue;
        const h = middle ? top : Math.max(1, top - 1 - (hash(sx, sy, 158 + k) < 0.5 ? 1 : 0));
        if (h <= best) continue;
        best = h;
        kind = middle ? WEED_TOP : WEED_STALKS;
        tone = 0.9 + 0.14 * hash(cx, cy, 154 + k);
      }
      if (best) {
        WEEDS[s] = kind;
        WEED_K[s] = tone;
        RAISE[s] = best;
        return best;
      }
    }
  }
  // A stone now and then, on any bed with room for it, the deep one too.
  if (f.weed[c] & WEED_STONE && avail >= 2 && hash(cx, cy, 160) < WEED_STONES) {
    const mx = Math.floor(hash(cx, cy, 161) * 7);
    const my = Math.floor(hash(cx, cy, 162) * 7);
    const long = hash(cx, cy, 163) < WEED_STONE_LONG;
    if (lx >= mx && lx <= mx + 1 && ly >= my && ly <= my + (long ? 0 : 1)) {
      WEEDS[s] = WEED_ROCK;
      WEED_K[s] = 0.85 + 0.15 * hash(cx, cy, 164);
      RAISE[s] = 1;
      return 1;
    }
  }
  return 0;
}

// Writes one tile of the chunk's fine land, cells [tx0, tx1) by [ty0, ty1) in island
// coordinates, in columns of 1 / sub. ox, oz: the scene's offset of cell (0, 0).
// The top of each column a chunk draws, in columns' units, before a flower or a pebble on it:
// what creatures stand on (Terrain.footAt). `x0`, `y0`: the chunk's first cell; `stride`: columns a row.
export interface FineTops {
  h: Int16Array;
  x0: number;
  y0: number;
  stride: number;
}

export function buildFineTile(
  f: FineCells,
  out: Writer,
  ox: number,
  oz: number,
  sub: number,
  tx0: number,
  ty0: number,
  tx1: number,
  ty1: number,
  tops: FineTops | null = null,
  water: Writer | null = null,
  far = false,
): boolean {
  const steps = GRAPHICS.steps;
  const blend = GRAPHICS.blend;
  const grain = GRAPHICS.grain;
  const bits = GRAPHICS.bits;
  const relief = GRAPHICS.relief;
  const rocks = GRAPHICS.rocks;
  const Q = 1 / sub;
  const sx0 = tx0 * sub - B;
  const sy0 = ty0 * sub - B;
  const SW = (tx1 - tx0) * sub + 2 * B;
  const SH = (ty1 - ty0) * sub + 2 * B;
  if (H.length < SW * SH) {
    H = new Int32Array(SW * SH);
    C = new Uint32Array(SW * SH);
    D = new Uint8Array(SW * SH);
    DONE = new Uint8Array(SW * SH);
    LAND = new Uint8Array(SW * SH);
    SUM = new Float64Array((SW + 1) * (SH + 1));
    CELL = new Int32Array(SW * SH);
    WALLC = new Int32Array(SW * SH);
    RS = new Uint8Array(SW * SH);
    GL = new Uint8Array(SW * SH);
    WET = new Uint8Array(SW * SH);
    WL = new Float32Array(SW * SH);
    SANDY = new Uint8Array(SW * SH);
    FLOOD = new Int32Array(SW * SH);
    LAVA_D = new Float32Array(SW * SH);
    LAVA_Y = new Float32Array(SW * SH);
    HOUSE_D = new Float32Array(SW * SH);
    HOUSE_Y = new Float32Array(SW * SH);
    WEEDS = new Uint8Array(SW * SH);
    RAISE = new Uint8Array(SW * SH);
    WEED_K = new Float32Array(SW * SH);
    BEDC = new Uint32Array(SW * SH);
  }
  LEVEL_CELL = -1;
  // Weed in eighths only, with the water in eighths (its surface caps the stalks).
  const weedOn = GRAPHICS.weed && sub === 8 && water !== null;
  const bottom = f.bottom * sub;
  // The tallest small step of a slope drawn in the ground's own colour: a quarter voxel, two whole
  // ones on snow and rock, whose slopes (STEEP_LINK) climb up to three voxels a cell and meet a
  // neighbour's in steps of a voxel or more where three cells of different heights meet.
  const steepRiser = Math.max(RISER, 2 * sub);
  const corner = steps && CLIFF_CORNER.on ? cornerOfCells(f) : null;

  for (let j = 0; j < SH; j++) {
    for (let k = 0; k < SW; k++) {
      const sx = sx0 + k;
      const sy = sy0 + j;
      let cx = Math.floor(sx / sub);
      let cy = Math.floor(sy / sub);
      const s = j * SW + k;
      // The column's middle, in cells, and where the field is read for it.
      const px = (sx + 0.5) / sub;
      const py = (sy + 0.5) / sub;
      let qx = px;
      let qy = py;
      // A cliff's corner cut on the diagonal (cliffCorner): the column drawn as its neighbour's land.
      if (corner && cx >= f.x0 - 2 && cy >= f.y0 - 2 && cx < f.x1 + 2 && cy < f.y1 + 2) {
        const kc = cliffCorner(corner, cx, cy, px, py);
        if (kc === 1) {
          cx += px - cx > 0.5 ? 1 : -1;
          qx = intoCell(px, cx);
        } else if (kc === 2) {
          cy += py - cy > 0.5 ? 1 : -1;
          qy = intoCell(py, cy);
        }
      }
      const c = fineAt(f, cx, cy);
      if (cx < f.x0 - 3 || cy < f.y0 - 3 || cx >= f.x1 + 3 || cy >= f.y1 + 3 || !f.inside[c]) {
        H[s] = bottom;
        C[s] = 0;
        D[s] = 0;
        CELL[s] = -1;
        WALLC[s] = -1;
        RS[s] = RISER;
        SANDY[s] = 0;
        FLOOD[s] = -1;
        WEEDS[s] = WEED_NONE;
        continue;
      }
      WEEDS[s] = WEED_NONE;
      CELL[s] = c;
      RS[s] = f.steep[c] ? steepRiser : RISER;
      const t = f.top[c];
      let hgt = t * sub;
      let src = c;
      let bit = 0;
      let raise = 0;
      let lifted = false;
      FLOOD[s] = -1;
      // Within the cell (a column of a corner cut stands at its neighbour's edge).
      const lx = Math.max(0, Math.min(sub - 1, sx - cx * sub));
      const ly = Math.max(0, Math.min(sub - 1, sy - cy * sub));
      if (f.natural[c]) {
        // The secondary terrain map: slopes where the land rises one voxel, and water beds.
        if (steps && !f.wet[c]) hgt = fieldStep(fieldFine(f, qx, qy), px, py, sub);
        else if (steps && isBed(f, c)) hgt = bedStep(fieldFine(f, px, py), f.water[c], sub);
        let border = Infinity;
        let shore = false;
        let foot = -1; // the cliff this column stands at the foot of
        for (let d = 0; d < 4; d++) {
          // Columns from this side of the cell, and the distance in cells.
          const away = d === 0 ? sub - 1 - lx : d === 1 ? sub - 1 - ly : d === 2 ? lx : ly;
          const af = (away + 0.5) / sub;
          if (af > 0.5) continue;
          const n = fineAt(f, cx + DX[d], cy + DY[d]);
          if (!f.inside[n] || !f.natural[n]) continue;
          const dt = f.top[n] - t;
          // A cliff's lip, broken in short runs.
          if (steps && dt <= -2 && away === 0 && !f.wet[c] && !f.wet[n] && noise(px, py, 0.7, 2) > 0.62) hgt = Math.min(hgt, t * sub - Math.max(1, sub >> 3));
          // On snow and rock a cliff too tall to curve has its lip bevelled: three eighths down at
          // the edge, one the column after, so a peak's step reads as worn stone, not a block.
          if (steps && f.steep[c] && dt <= -2 && !joins(dt, true, f.steep[n] === 1) && !f.wet[c] && !f.wet[n] && !f.anchored[c] && away < BEVEL.length)
            hgt = Math.min(hgt, t * sub - Math.round((BEVEL[away] * sub) / 8));
          if (f.wet[n] && !f.wet[c] && af < 0.3) shore = true;
          // At the foot of a cliff (not of a slope of snow or rock, which curves).
          if (dt >= 2 && af < 0.2 && !f.wet[n] && !(steps && joins(dt, f.steep[c] === 1, f.steep[n] === 1))) foot = n;
          if (!blend) continue;
          if (f.wet[c] && !f.wet[n] && f.water[c] > -1e8 && f.top[n] >= f.water[c] - 0.5 && f.top[n] - f.water[c] <= SHORE_LOW) {
            // The shore: sand reaches into the shallows in a wavy line, just above the water. Only
            // from a low bank (SHORE_LOW): from a cliff's top, a column of the water cell rose to the
            // cliff's height, and drawn as the shore's land (shoreLine) it stood as a thin tan strip
            // down the cliff (26 November, the owner).
            if (af < 0.45 * Math.min(1, Math.max(0, (noise(px, py, 0.7, 3) - 0.3) * 2.2))) {
              const above = Math.ceil((f.water[c] + 0.04) * sub);
              hgt = Math.max(hgt, above, f.top[n] * sub);
              src = n;
            }
          } else if (
            blendsWet(f, c) &&
            blendsWet(f, n) &&
            f.blends[c] &&
            f.blends[n] &&
            (f.ground[n] !== f.ground[c] || f.tone[n] !== f.tone[c]) &&
            Math.abs(dt) <= 1 &&
            !(f.softOn[c] && f.softOn[n])
          ) {
            // Two grounds that meet: their border wanders up to almost half a cell either way,
            // the same line seen from both sides. One ground in two tones too (21 November, the
            // owner: "still some squares that do not meld together"), the mesa's sand beside the
            // desert's, a swamp's grass beside a meadow's. A lake's bed too (blendsWet), not the sea's.
            const over = f.ground[c] !== f.ground[n] ? f.ground[c] > f.ground[n] : f.tone[c] > f.tone[n];
            // A road's edge wanders less (ROAD_WANDER): softened, never so far it pinches the road.
            const reach = f.ground[c] === G.ROAD || f.ground[n] === G.ROAD ? ROAD_WANDER : 0.45;
            const shift = Math.max(-reach, Math.min(reach, (noise(px, py, 0.6, 13) - 0.5) * 1.6 * (reach / 0.45))) * (over ? 1 : -1);
            if (af < shift && af - shift < border) {
              border = af - shift;
              src = n;
            }
          }
        }
        // The waterline in eighths (18 November, the owner: "coasts are bad too", a diagonal shore
        // stepped in whole-cell teeth): near a low shore the line where water meets land follows a
        // smooth curve through the cells (shoreLine), the ground under it lowered into the water
        // and the ground beside it ramped down to the water's edge.
        if (water && steps && blend) {
          const k = shoreLine(f, c, cx, cy, px, py, hgt, sub);
          if (k !== SHORE_NONE) {
            hgt = SHORE_H;
            if (k === SHORE_FLOOD) FLOOD[s] = SHORE_N;
            else if (k === SHORE_LAND) {
              lifted = true;
              src = SHORE_N;
            } else shore = SHORE_W > SHORE_PEBBLE;
          }
        }
        if (rocks && foot >= 0 && !f.wet[c] && FLOOD[s] < 0 && !f.anchored[c] && noise(px, py, 0.9, 57) > 0.76 && hash(sx, sy, 58) < 0.22) {
          // A few boulders fallen at the foot of a cliff, of its stone.
          bit = scaleColor(f.stone[foot], 0.92 + hash(sx, sy, 59) * 0.16);
          raise = 1 + (hash(sx, sy, 60) < 0.35 ? 1 : 0);
        } else if (bits && !f.wet[c] && src === c && FLOOD[s] < 0) {
          // A few small clusters, not a sprinkle.
          if (f.flowers[c] && noise(px, py, 3.2, 21) > 0.8 && hash(sx, sy, 22) < 0.28) {
            bit = FLOWERS[Math.floor(hash(Math.floor(px / 3), Math.floor(py / 3), 23) * FLOWERS.length)];
            raise = 1;
          } else if (f.flowers[c] && noise(px, py, 2.2, 27) > 0.84 && hash(sx, sy, 28) < 0.22) {
            // A tuft of grass, a shade lighter or darker than the ground.
            bit = scaleColor(f.color[c], hash(sx, sy, 29) < 0.4 ? 1.1 : 0.88);
            raise = 1;
          } else if (f.pebbles[c] && shore && hash(sx, sy, 25) < 0.07) {
            // Pebbles along the shore line only.
            bit = PEBBLES[Math.floor(hash(sx, sy, 26) * PEBBLES.length)];
            raise = 1;
          }
        } else if (weedOn && f.weed[c] && isBed(f, c) && src === c && FLOOD[s] < 0 && !lifted) {
          raise = weedAt(f, c, cx, cy, lx, ly, sx, sy, hgt, s);
        }
      }
      // With the water in eighths, a cell the simulation counts as under water is drawn under it,
      // an eighth at least (the shore's sand reaching into the shallows stood out as islets).
      // A column of the shore's land drawn over a water cell (shoreLine) stays above the water: it is
      // joined to the land beside it.
      // Under the surface as drawn over the column (drawnLevel), not only the cell's own level: where
      // ice or water slopes to lower neighbours, a bed at its own level rose through it as strips of
      // grass across thin shore ice (20 November, water leftovers).
      if (water && f.wet[c] && f.water[c] > -1e8 && !f.lava[c] && !lifted)
        hgt = Math.min(hgt, Math.ceil(f.water[c] * sub) - 1 - raise, Math.ceil((drawnLevel(f, c, cx, cy, lx, ly, sub) - BED_UNDER) * sub) - 1 - raise);
      H[s] = hgt + raise;
      WALLC[s] = lifted ? src : c;
      if (tops && sx >= tx0 * sub && sy >= ty0 * sub && sx < tx1 * sub && sy < ty1 * sub)
        tops.h[(sy - tops.y0 * sub) * tops.stride + (sx - tops.x0 * sub)] = hgt;
      const rock = f.ground[src] === G.ROCK;
      SANDY[s] = f.natural[c] && !bit && FLOOD[s] < 0 && f.ground[src] === G.SAND ? 1 : 0;
      LAND[s] = f.natural[c] && (!f.wet[c] || lifted) && FLOOD[s] < 0 && !bit ? (rock ? 2 : 1) : 0;
      D[s] = f.wet[c] || src !== c || FLOOD[s] >= 0 ? 0 : 1;
      let col = bit || f.color[src];
      if (f.softOn[c] && !bit && src === c && !f.wet[c]) {
        // A spell's ground in soft patches (16 November, the owner: Big Bang's ground "a busy
        // camouflage patchwork"): the colour of the neighbourhood round the column, eased between
        // cells' middles and kept to a few shades.
        col = softColor(f, px, py);
      } else if (grain && f.natural[c] && !bit) {
        // Bare rock takes half the patches' contrast (the owner's hill read as light and dark
        // checks): its slopes' light carries its form.
        col = scaleColor(col, rock ? 1 + (shadeAt(px, py) - 1) * ROCK_CALM : shadeAt(px, py));
      }
      C[s] = col;
    }
  }
  // Light, kept in the colour so tops still merge. A slope of tiny steps is lit as the tilted
  // ground it stands for, by which way it faces, so it reads as a slope and not as stripes (its
  // risers take the same light, wallFaces); a top below a real wall sits in its shadow. The tilt is
  // read over five columns either way (15 November: read from the next column, every terrace of
  // a slope was lit light at one edge and dark at the other, and sand read as a washboard), so a
  // whole terrace takes one light and still merges. With `relief`, elevation reads on smooth
  // slopes too: steeper and facing away from the light is darker, hollows are in shade, and the
  // ground is tinted by its height (low warmer and darker, high lighter and cooler). Every factor
  // is in coarse steps, so flat ground still merges.
  if (relief) {
    // Sums of heights over the tile and its border, for the mean height round each column.
    for (let j = 0; j < SH; j++) {
      let row = 0;
      for (let k = 0; k < SW; k++) {
        row += H[j * SW + k];
        SUM[(j + 1) * (SW + 1) + k + 1] = SUM[j * (SW + 1) + k + 1] + row;
      }
    }
  }
  // With relief, a slope of one voxel a cell is lit almost as a wall facing that way, the light
  // and dark sides that made height easy to read with whole steps (pass 1).
  const slopeK = relief ? 0.45 : 0.15;
  // The columns of a water bed under the water's surface.
  for (let s = 0; s < SW * SH; s++) WET[s] = FLOOD[s] >= 0 || (CELL[s] >= 0 && isBed(f, CELL[s]) && H[s] < f.water[CELL[s]] * sub) ? 1 : 0;
  const gentle = (d: number) => (d > 2 * RISER ? 2 * RISER : d < -2 * RISER ? -2 * RISER : d);
  for (let j = 2; j < SH - 2; j++)
    for (let k = 2; k < SW - 2; k++) {
      const s = j * SW + k;
      const h0 = H[s];
      const e = H[s + 1] - h0;
      const w = h0 - H[s - 1];
      const so = H[s + SW] - h0;
      const no = h0 - H[s - SW];
      // A bed under the water keeps its colour: the water over it shades it by depth, and its tops
      // merge. A lake's bed darkens toward its water's deep colour by its depth (lakeBedDark), in
      // steps, so its tops still merge and the deep floor fades into the dark.
      if (WET[s]) {
        const c = CELL[s];
        const weed = WEEDS[s];
        // Weed and stones take the bed's colour under them (darkened by the bed's depth, not by their
        // own top's), mixed toward their own.
        if (FLOOD[s] < 0 && c >= 0 && f.wlake[c] > 0) {
          // By the depth eased between cells (lakeBedDepth), not the column's own: a bed's steps drew
          // squares a cell wide (26 November).
          const [deep, share] = lakeBedDepth(f, c, (sx0 + k + 0.5) / sub, (sy0 + j + 0.5) / sub);
          const dark = lakeBedDark(deep, share, LAKE_BED_STEPS);
          if (dark > 0) C[s] = mixColor(C[s], scaleColor(f.wdeep[c], LAKE_BED_DEEP), dark);
        }
        if (weed) {
          const bed = C[s];
          BEDC[s] = bed;
          const col =
            weed === WEED_ROCK
              ? scaleColor(mixColor(bed, f.stone[c], 0.5), WEED_K[s])
              : scaleColor(mixColor(bed, WEED_TINT[WEED_LANDS[f.weedLand[c]] ?? "temperate"], WEED_MIX), WEED_K[s] * (weed === WEED_TOP ? 1.06 : 1));
          // Kept within a band of the bed's own light: weed and stones read as lying on the bed, never
          // as a hole or a lamp in it, and the deep bed stays dark (a grey stone there read as a light).
          const lb = Math.max(1, luma(bed));
          const k = luma(col) / lb;
          C[s] =
            k < WEED_LIGHT_LO
              ? scaleColor(col, (WEED_LIGHT_LO * lb) / Math.max(1, luma(col)))
              : k > WEED_LIGHT_HI
                ? scaleColor(col, (WEED_LIGHT_HI * lb) / luma(col))
                : col;
        }
        continue;
      }
      const riser = RS[s];
      // The top below a step steeper than a slope's sits in its shade; not on sand, where the steps
      // of a dune's foot drew dark wavy lines across flat ground (18 November).
      if ((e > riser || -w > riser || so > riser || -no > riser) && !SANDY[s]) {
        C[s] = scaleColor(C[s], 0.88);
        continue;
      }
      // Rise toward +x and +z over two columns each way and three rows, a real wall counted as a
      // steep step only; twice the rise a column, as the next columns' steps measured it.
      let gx = 0;
      let gz = 0;
      for (let q = -1; q <= 1; q++) {
        gx += gentle(H[s + q * SW + 2] - h0) - gentle(H[s + q * SW - 2] - h0);
        gz += gentle(H[s + q + 2 * SW] - h0) - gentle(H[s + q - 2 * SW] - h0);
      }
      gx /= 6;
      gz /= 6;
      let light = 1;
      if (gx || gz) {
        // On sand a tilt under a voxel a cell is lit in proportion to itself (SAND_TILT): a lone step
        // of an eighth on flat sand drew a dark band four columns wide, a contour line (18 November);
        // a dune's slope (a voxel a cell or more) is lit as before.
        const kx = Math.min(0.9, Math.abs(gx) * slopeK * (SANDY[s] ? Math.min(1, Math.abs(gx) / SAND_TILT) : 1));
        const kz = Math.min(0.9, Math.abs(gz) * slopeK * (SANDY[s] ? Math.min(1, Math.abs(gz) / SAND_TILT) : 1));
        // Rising toward +x, the ground faces west; toward +z, north.
        const lx = gx > 0 ? FACE_LIGHT.west : FACE_LIGHT.east;
        const lz = gz > 0 ? FACE_LIGHT.north : FACE_LIGHT.south;
        light = 1 - kx * (1 - lx) - kz * (1 - lz);
      }
      if (relief && LAND[s] && j >= B && k >= B && j < SH - B && k < SW - B) {
        // Hollows: how far the ground round (three columns each way) stands above this column.
        const W1 = SW + 1;
        const mean = (SUM[(j + 4) * W1 + k + 4] - SUM[(j - 3) * W1 + k + 4] - SUM[(j + 4) * W1 + k - 3] + SUM[(j - 3) * W1 + k - 3]) / 49;
        const above = (mean - h0) / sub;
        if (above > 0) light *= 1 - Math.min(0.15, above * 0.25) * (LAND[s] === 2 ? ROCK_CALM : 1);
        C[s] = tint(C[s], h0 / sub);
      }
      if (light !== 1) C[s] = scaleColor(C[s], Math.round(light * 20) / 20);
    }

  const k0 = B;
  const k1 = SW - B;
  const j0 = B;
  const j1 = SH - B;
  // Night glow (warmlight): how near lava and houses each column is, and its glow on its top.
  const glowing = GRAPHICS.warmlight && glowSources(f, tx0, ty0, tx1, ty1);
  for (let j = j0; j < j1; j++)
    for (let k = k0; k < k1; k++) {
      const s = j * SW + k;
      GL[s] = 0;
      LAVA_D[s] = Infinity;
      HOUSE_D[s] = Infinity;
      if (!glowing || CELL[s] < 0) continue;
      nearestGlow(s, (sx0 + k + 0.5) / sub, (sy0 + j + 0.5) / sub);
      GL[s] = glowLevel(s, H[s] / sub);
    }

  // Far land (FAR): dry columns in blocks of two by two take one column's height and colour.
  if (far) blockFar(f, sub, sx0, sy0, SW, j0, j1, k0, k1);

  // Tops, merged into rectangles of one height, colour and glow.
  for (let j = j0; j < j1; j++) DONE.fill(0, j * SW + k0, j * SW + k1);
  const topLight = FACE_LIGHT.top;
  for (let j = j0; j < j1; j++) {
    for (let k = k0; k < k1; k++) {
      const s = j * SW + k;
      if (DONE[s]) continue;
      const h0 = H[s];
      const c0 = C[s];
      const d0 = D[s];
      const g0 = GL[s];
      const w0 = WET[s];
      let ke = k + 1;
      while (
        ke < k1 &&
        !DONE[j * SW + ke] &&
        H[j * SW + ke] === h0 &&
        C[j * SW + ke] === c0 &&
        D[j * SW + ke] === d0 &&
        GL[j * SW + ke] === g0 &&
        WET[j * SW + ke] === w0
      )
        ke++;
      let je = j + 1;
      grow: while (je < j1) {
        for (let q = k; q < ke; q++) {
          const t = je * SW + q;
          if (DONE[t] || H[t] !== h0 || C[t] !== c0 || D[t] !== d0 || GL[t] !== g0 || WET[t] !== w0) break grow;
        }
        je++;
      }
      for (let jj = j; jj < je; jj++) DONE.fill(1, jj * SW + k, jj * SW + ke);
      const x0 = (sx0 + k) * Q + ox;
      const z0 = (sy0 + j) * Q + oz;
      out.e0 = g0 / GLOW_LEVELS;
      out.e1 = w0;
      out.rect(4, x0, x0 + (ke - k) * Q, h0 * Q, h0 * Q, z0, z0 + (je - j) * Q, c0, topLight, 1, d0);
    }
  }
  out.e0 = 0;
  out.e1 = 0;

  // Walls toward lower neighbours, in layers, merged along each line into runs.
  const runs = RUNS;
  for (let d = 0; d < 4; d++) {
    const alongX = d === 1 || d === 3;
    const lines = alongX ? j1 - j0 : k1 - k0;
    const len = alongX ? k1 - k0 : j1 - j0;
    for (let li = 0; li < lines; li++) {
      runs.length = 0;
      for (let p = 0; p <= len; p++) {
        let faces = 0;
        if (p < len) {
          const k = alongX ? k0 + p : k0 + li;
          const j = alongX ? j0 + li : j0 + p;
          faces = wallFaces(f, d, sx0 + k, sy0 + j, j * SW + k, SW, sub, grain, blend, out, ox, oz);
        }
        // Each face carries on the open run it matches, or starts one.
        for (let q = 0; q < faces; q++) {
          const face = FACES[q];
          const open = runs.find(
            (r) =>
              r.until === p &&
              r.lo === face.lo &&
              r.hi === face.hi &&
              r.color === face.color &&
              r.light === face.light &&
              r.foot === face.foot &&
              r.glow === face.glow &&
              r.wet === face.wet,
          );
          if (open) {
            open.until = p + 1;
            open.end = face.at + 1;
          } else
            runs.push({
              lo: face.lo,
              hi: face.hi,
              color: face.color,
              light: face.light,
              foot: face.foot,
              glow: face.glow,
              wet: face.wet,
              start: face.at,
              end: face.at + 1,
              line: face.line,
              until: p + 1,
            });
        }
        // The runs this column did not carry on are finished.
        for (let r = runs.length - 1; r >= 0; r--) {
          if (runs[r].until === p + 1) continue;
          emitRun(out, d, runs[r], sub, ox, oz);
          runs.splice(r, 1);
        }
      }
      for (const run of runs) emitRun(out, d, run, sub, ox, oz);
    }
  }
  out.e0 = 0;
  out.e1 = 0;
  // The water and the foam meet the land as it stands in eighths.
  if (far) unblockFar(SW * SH);

  // The water in eighths (16 November) takes the place of the line of foam on the land.
  if (water) {
    const any = fineWater(f, water, sub, sx0, sy0, SW, SH, ox, oz);
    // A dry cell's column drawn under its neighbour's water (shoreLine's SHORE_FLOOD): what stands
    // there stands on the water's surface, not on the land lowered under it (20 November: feet
    // dipped up to an eighth under water at a dry shore, more by a fall).
    if (tops)
      for (let j = B; j < SH - B; j++)
        for (let k = B; k < SW - B; k++) {
          const s = j * SW + k;
          if (FLOOD[s] < 0 || Number.isNaN(WL[s])) continue;
          const t = (sy0 + j - tops.y0 * sub) * tops.stride + (sx0 + k - tops.x0 * sub);
          tops.h[t] = Math.max(tops.h[t], Math.ceil(WL[s] * sub - 0.001));
        }
    return any;
  }
  if (GRAPHICS.foam) foam(f, out, sub, sx0, sy0, SW, SH, ox, oz);
  return false;
}

// Far land (23 November, the owner on the Fold: 27 frames a second falling to 13 on a large
// island, drawing two thirds of each frame, 2.8 to 4.9 million triangles in the sky view). Where an
// eighth is under a pixel on the screen (terrain.ts wantFar), a chunk is drawn with its dry columns
// in blocks of FAR.block by FAR.block: each block takes the height, colour and light of its first
// column. Heights stay in eighths, so a step is as tall as before and its line on the slope as
// thin (quarter voxels doubled it, and the seam showed: scripts/looks-seam.mjs, 15 November); only
// where it runs is coarser, by an eighth. Tops merge four times as far and half the walls go.
// Kept as they are: columns within FAR.edge of the chunk's side, so two chunks at any level meet
// with the same columns along their border and no gap opens; and columns of water, a bed, a
// shore, weed or a spell's drawings. Blocks are aligned on the island, so the tiles of a chunk
// agree. Drawing only: what stands on the land stands on its columns in eighths (FineTops).
// `edge` is a switch only for the checks (scripts/far-land-test.ts: at 0 the borders open).
export const FAR = { block: 2, edge: 2 };
let HT = new Int32Array(0);
let CT = new Uint32Array(0);
let FAR_SAVED = 0;

function blockFar(f: FineCells, sub: number, sx0: number, sy0: number, SW: number, j0: number, j1: number, k0: number, k1: number): void {
  const n = H.length;
  if (HT.length < n) {
    HT = new Int32Array(n);
    CT = new Uint32Array(n);
  }
  FAR_SAVED = 0;
  const B2 = FAR.block;
  const ex0 = f.x0 * sub + FAR.edge;
  const ey0 = f.y0 * sub + FAR.edge;
  const ex1 = f.x1 * sub - FAR.edge;
  const ey1 = f.y1 * sub - FAR.edge;
  const plain = (s: number) => D[s] === 1 && WET[s] === 0 && FLOOD[s] < 0 && WEEDS[s] === WEED_NONE && CELL[s] >= 0;
  // The tile's columns and one more round (the walls read their neighbours).
  for (let j = j0 - 1; j <= j1; j++)
    for (let k = k0 - 1; k <= k1; k++) {
      const sx = sx0 + k;
      const sy = sy0 + j;
      const bx = sx - (((sx % B2) + B2) % B2);
      const by = sy - (((sy % B2) + B2) % B2);
      if (bx === sx && by === sy) continue;
      if (bx < ex0 || by < ey0 || bx + B2 > ex1 || by + B2 > ey1) continue;
      const r = (by - sy0) * SW + (bx - sx0);
      let ok = true;
      for (let q = 0; q < B2 && ok; q++) for (let p = 0; p < B2 && ok; p++) ok = plain(r + q * SW + p);
      if (!ok) continue;
      const s = j * SW + k;
      if (!FAR_SAVED) {
        HT.set(H.subarray(0, n));
        CT.set(C.subarray(0, n));
        FAR_SAVED = 1;
      }
      H[s] = HT[r];
      C[s] = CT[r];
      GL[s] = GL[r];
      RS[s] = RS[r];
      SANDY[s] = SANDY[r];
      LAND[s] = LAND[r];
      LAVA_D[s] = LAVA_D[r];
      HOUSE_D[s] = HOUSE_D[r];
    }
}

function unblockFar(n: number): void {
  if (!FAR_SAVED) return;
  H.set(HT.subarray(0, n));
  C.set(CT.subarray(0, n));
  FAR_SAVED = 0;
}

// The land shader's flag (landWet) for a face lit as its slope is: half way to a bed's (1).
const SLOPE_LIT = 0.5;
// The tilt (twice the rise a column, in columns) from which sand is lit fully by its slope.
const SAND_TILT = 1;

// The bevel of a cliff's lip on snow and rock, eighths of a voxel down by columns from the edge.
const BEVEL = [3, 1];

// Night glow (16 November, warmlight): lava and houses' lit windows warm the land round them at
// night, baked in each face as a level (0 to GLOW_LEVELS) the land's shader lights by the night.
// Lava reaches GLOW_REACH cells and climbs the walls above it; a house reaches HOUSE_REACH at its
// own height.
export const GLOW_LEVELS = 6;
const GLOW_REACH = 3;
const HOUSE_REACH = 2.5;
const SRC_X: number[] = [];
const SRC_Y: number[] = [];
const SRC_LAVA: boolean[] = [];
const SRC_LEVEL: number[] = [];

// The lava and house cells within GLOW_REACH of tile [tx0, tx1) by [ty0, ty1); whether there are any.
function glowSources(f: FineCells, tx0: number, ty0: number, tx1: number, ty1: number): boolean {
  SRC_X.length = SRC_Y.length = SRC_LAVA.length = SRC_LEVEL.length = 0;
  for (let y = ty0 - GLOW_REACH; y < ty1 + GLOW_REACH; y++)
    for (let x = tx0 - GLOW_REACH; x < tx1 + GLOW_REACH; x++) {
      if (x < f.x0 - 3 || y < f.y0 - 3 || x >= f.x1 + 3 || y >= f.y1 + 3) continue;
      const c = fineAt(f, x, y);
      if (!f.inside[c]) continue;
      const lava = f.wet[c] === 1 && f.lava[c] === 1 && f.water[c] > -1e8;
      if (!lava && !f.flat[c]) continue;
      SRC_X.push(x);
      SRC_Y.push(y);
      SRC_LAVA.push(lava);
      SRC_LEVEL.push(lava ? f.water[c] : f.top[c]);
    }
  return SRC_X.length > 0;
}

// The nearest lava and house to the column at (px, py) in cells, into LAVA_D, LAVA_Y, HOUSE_D, HOUSE_Y.
function nearestGlow(s: number, px: number, py: number): void {
  let lava = Infinity;
  let house = Infinity;
  for (let k = 0; k < SRC_X.length; k++) {
    const dx = Math.max(SRC_X[k] - px, 0, px - SRC_X[k] - 1);
    const dy = Math.max(SRC_Y[k] - py, 0, py - SRC_Y[k] - 1);
    const d = Math.hypot(dx, dy);
    if (SRC_LAVA[k]) {
      if (d < lava) {
        lava = d;
        LAVA_Y[s] = SRC_LEVEL[k];
      }
    } else if (d < house) {
      house = d;
      HOUSE_Y[s] = SRC_LEVEL[k];
    }
  }
  LAVA_D[s] = lava;
  HOUSE_D[s] = house;
}

// The glow level of column s at height y (scene units).
function glowLevel(s: number, y: number): number {
  let g = 0;
  if (LAVA_D[s] < GLOW_REACH) {
    const near = 1 - LAVA_D[s] / GLOW_REACH;
    const above = y - LAVA_Y[s];
    // Up the walls over the lava, fading over six voxels; under its surface, gone within one.
    const up = above >= 0 ? Math.max(0, 1 - above / 6) : Math.max(0, 1 + above);
    g += near * near * up;
  }
  if (HOUSE_D[s] < HOUSE_REACH) {
    const near = 1 - HOUSE_D[s] / HOUSE_REACH;
    g += 0.35 * near * near * Math.max(0, 1 - Math.abs(y - HOUSE_Y[s] - 0.5) / 2.5);
  }
  return Math.round(Math.min(1, g) * GLOW_LEVELS);
}

// A spell's ground in soft patches: the cells' soft colours eased between their middles, in steps
// of SOFT_STEP a channel so the columns still merge.
const SOFT_STEP = 9;
function softColor(f: FineCells, px: number, py: number): number {
  const gx = px - 0.5;
  const gy = py - 0.5;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const u = gx - ix;
  const v = gy - iy;
  const own = f.soft[fineAt(f, Math.floor(px), Math.floor(py))];
  let r = 0;
  let g = 0;
  let b = 0;
  for (let k = 0; k < 4; k++) {
    const x = ix + (k & 1);
    const y = iy + (k >> 1);
    const w = (k & 1 ? u : 1 - u) * (k >> 1 ? v : 1 - v);
    const inRange = x >= f.x0 - 3 && y >= f.y0 - 3 && x < f.x1 + 3 && y < f.y1 + 3;
    const n = inRange ? fineAt(f, x, y) : -1;
    const col = n >= 0 && f.softOn[n] ? f.soft[n] : own;
    r += ((col >> 16) & 255) * w;
    g += ((col >> 8) & 255) * w;
    b += (col & 255) * w;
  }
  const q = (x: number) => Math.min(255, Math.round(x / SOFT_STEP) * SOFT_STEP);
  return (q(r) << 16) | (q(g) << 8) | q(b);
}

// The water in eighths (16 November, the owner: water "seen from the side is huge flat walls with
// grid lines", "the sea floor and depth steps ... big pale squares", "a white foam outline like
// thick tape"). Over every column of a water cell whose bed lies below the surface: a top at the
// surface, merged into rectangles where the surface is level (within a cell where it slopes); its
// edge follows the fine land. The surface's corners take the mean level of the water cells round
// them, so a river slopes instead of stepping. Sides only where the water stands above what is
// next to it (the island's edge, lower land), from the bed up, darker with depth by height, never a
// slab down to the island's foot. A soft band of foam a few columns wide, broken, where the water
// meets land. The colour by depth is the shader's (water-light.ts, from Terrain.waterMap); the
// vertices carry the deep colour (for the sides), the foam and how much the waves move.
const FOAM_LEVELS = 3;
// How narrow water is (18 November, the owner on the Fold: rivers one or two cells wide read as
// "pale translucent blocky bands with hard light borders", not as water), by the fewest cells of
// water in a row through a cell, along x or y: 1 for one or two cells, then less, 0 from five.
// A narrow river has no foam (the bands from its two banks met in the middle), and less as it
// widens; Terrain.writeWaterMap draws it bluer and less clear by the same measure, so the change is
// graded, not a hard line where a river opens into a lake.
export const NARROW_SEEN = 4;
export function riverNarrow(across: number): number {
  return across <= 2 ? 1 : across === 3 ? 0.6 : across === 4 ? 0.3 : 0;
}

// Lakes with a floor (19 November, the owner: "not having a bottom for some lakes looks weird").
// The water's look is at its most opaque from 4.5 height units, set for the sea so the seabed's
// steps do not show through it as a grid (4.4.5 part C); lakes are 14 to 20 deep, so their middles
// drew as an opaque sheet with no floor. Water whose surface stands above the sea is drawn as
// clearer: its first LAKE_SHALLOW units as they are, then as if never deeper than LAKE_LOOK, so a
// lake 14 deep is 0.64 opaque (the sea's 0.96) and its floor's slope and its sand and rock show.
// Its colour stays its depth's (lakeTint), and its bed is muted toward a blue with depth
// (lakeBedDark), so the floor reads as deeper and bluer instead of vanishing. Variants tried on
// the same cameras (docs/visual-checks/lake-floors/variants): 0.70 opaque with the bed mixed 0.55
// toward the deep colour at 55% light, 0.62 with 0.45 (the deep middle turned grey), this one.
// The sea (lakeShare 0) is drawn exactly as before.
export const HEIGHT_V = 0.5; // scene units per height unit (terrain.ts V)
const LAKE_SHALLOW = 0.4;
const LAKE_LOOK = 0.8;
// How much water whose surface is at `surface` (height units) is a lake's: 0 at the sea's level
// and up to LAKE_FROM above it (a river's mouth, a lagoon), 1 a unit higher, graded between.
const LAKE_FROM = 0.35;
export function lakeShare(surface: number, sea: number): number {
  return Math.min(1, Math.max(0, surface - sea - LAKE_FROM));
}
// The depth whose clearness water `d` deep (height units) takes, by its lakeShare.
export function lakeDepth(d: number, share: number): number {
  if (share <= 0 || d <= LAKE_SHALLOW) return d;
  const k = LAKE_LOOK - LAKE_SHALLOW;
  const look = LAKE_SHALLOW + k * (1 - Math.exp(-(d - LAKE_SHALLOW) / k));
  return d + (look - d) * share;
}
// How far the shallow colour the water's map holds is mixed toward the deep colour, for water
// `real` deep drawn as `look` deep, so the water's shader (which mixes by sqrt(depth / 5)) still
// colours it as `real` deep: a lake's middle keeps its deep blue while it grows clearer.
export function lakeTint(real: number, look: number): number {
  const want = Math.sqrt(Math.min(1, real / 5));
  const got = Math.sqrt(Math.min(1, look / 5));
  return got >= want || got >= 1 ? 0 : (want - got) / (1 - got);
}
// How far a lake's bed `d` under its surface (height units) is mixed toward its water's deep
// colour at LAKE_BED_DEEP of its light: none on the shelf to LAKE_BED_CLEAR, then more, eased
// toward LAKE_BED_DARK over LAKE_BED_EASE units (0.34 at 2 deep, 0.6 at 4, 0.86 at 14), in
// sixteenths so the bed's tops still merge. A lake's floor is mostly grass and sand, green and
// yellow through clear water without it. 20 November, the owner: "The lake floors should be much
// darker". Before, 0.13 at 2 deep, 0.3 at 4 and 0.6 at 14 toward 70% light; the deep colour at
// 20% light was also tried (docs/visual-checks/lake-floors-darker).
const LAKE_BED_CLEAR = 0.5;
const LAKE_BED_EASE = 3;
const LAKE_BED_DARK = 0.87;
export const LAKE_BED_DEEP = 0.32;
export function lakeBedDark(d: number, share: number, steps = 16): number {
  if (share <= 0 || d <= LAKE_BED_CLEAR) return 0;
  return Math.round((1 - Math.exp(-(d - LAKE_BED_CLEAR) / LAKE_BED_EASE)) * LAKE_BED_DARK * share * steps) / steps;
}
// The fine land's bed in LAKE_BED_STEPS shades: its depth is eased (lakeBedDepth), so a shade's step
// is a thin contour, not a cell's edge, and a 32nd keeps it under a few 255ths of light.
export const LAKE_BED_STEPS = 32;
// A lake's depth and lakeShare at the point (px, py) of the island (in cells), for its bed's shade
// (26 November, the owner's screenshot: a lake's floor in "big blocky squares" of dark and light).
// Each column was darkened by its own depth under the surface, and a bed steps a voxel or more from
// cell to cell, so each step drew a square a cell wide a shade apart, and a pit a cell wide a dark
// hole. The depth here is the cells' (their surface over their own height), each the mean of the 3 by
// 3 cells round it, eased between the middles of the four cells round the point: the shade follows
// how deep the lake is there, not each step of its bed. A cell that is not a lake's bed (the shore)
// counts as under the point's own cell's surface by as much as its ground is, none if it stands
// above it, so the shade fades toward the shore and is the same on both sides of a cell's edge.
// `c` is the point's own cell, a lake's bed.
export function lakeBedDepth(f: FineCells, c: number, px: number, py: number): [number, number] {
  const u = px - 0.5;
  const v = py - 0.5;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const level = f.water[c];
  let d = 0;
  let share = 0;
  for (let q = 0; q < 4; q++) {
    const a = q & 1;
    const b = q >> 1;
    const wgt = (a ? fx : 1 - fx) * (b ? fy : 1 - fy);
    if (wgt === 0) continue;
    let sd = 0;
    let ss = 0;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const x = x0 + a + i;
        const y = y0 + b + j;
        const k = x >= f.x0 - 3 && y >= f.y0 - 3 && x < f.x1 + 3 && y < f.y1 + 3 ? fineAt(f, x, y) : -1;
        if (k >= 0 && isBed(f, k) && f.wlake[k] > 0) {
          sd += (f.water[k] - f.raw[k]) / HEIGHT_V;
          ss += f.wlake[k];
        } else {
          sd += k >= 0 && f.inside[k] ? Math.max(0, (level - f.raw[k]) / HEIGHT_V) : (level - f.raw[c]) / HEIGHT_V;
          ss += f.wlake[c];
        }
      }
    d += (wgt * sd) / 9;
    share += (wgt * ss) / 9;
  }
  return [d, share];
}
// Water cells whose levels are at most LEVEL_JOIN apart (scene units) share their corners' level.
const LEVEL_JOIN = 1.2;
// Where ice is among them, whatever their levels: water that froze before it settled (a lake still
// levelling, a flood) slopes as one sheet of ice. A fall's corners apart drew it torn, in wedges of
// side tapering from a corner apart to the next one joined, thin slivers once opaque.
const ICE_JOIN = Infinity;
let WK = new Float64Array(0);
let FO = new Uint8Array(0);
// The water cell each column's water is (its own cell, or the one a shore's column takes).
let WC = new Int32Array(0);
// The rectangles of water top (i, ie, j, je, first column) and an outline's points.
const RECTS: number[] = [];
const PTS: number[] = [];
// The four corner levels of each water cell of a tile and its border: (x0, y0), (x1, y0),
// (x0, y1), (x1, y1); NaN for a cell not under water.
let CORNER = new Float32Array(0);
// The same for a dry cell by water (NaN elsewhere): the surface of the water over its shore's columns.
let DRY = new Float32Array(0);
// The water in eighths by low land (Terrain.fineWaterLevel, 23 November): how far under the top of
// the land beside it the water is drawn, and how far under the water's level that land may lie and
// still lower it (more, a river falling off a plateau past its banks, keeps its own level).
export const SHORE_UNDER = 3 / 16;
export const SHORE_DIP = 0.8;
function cornerLevel(f: FineCells, gx: number, gy: number, own: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  let sum = 0;
  let n = 0;
  let iced = false;
  for (let k = 0; k < 4; k++) {
    const x = gx - 1 + (k & 1);
    const y = gy - 1 + (k >> 1);
    if (x < f.x0 - 3 || y < f.y0 - 3 || x >= f.x1 + 3 || y >= f.y1 + 3) continue;
    const c = fineAt(f, x, y);
    if (!isWater(f, c)) continue;
    const l = f.water[c];
    if (f.ice[c]) iced = true;
    lo = Math.min(lo, l);
    hi = Math.max(hi, l);
    sum += l;
    n++;
  }
  // Cells far apart (a fall) keep their own levels at the corner; nearer, the water slopes.
  let level = n && hi - lo <= (iced ? ICE_JOIN : LEVEL_JOIN) ? sum / n : own;
  // Never over the low natural land at the corner (Terrain.fineWaterLevel holds each cell's level
  // under the land round it; a corner shared with water of a higher level, not so held, rose over it).
  const at = level;
  for (let k = 0; k < 4; k++) {
    const x = gx - 1 + (k & 1);
    const y = gy - 1 + (k >> 1);
    if (x < f.x0 - 3 || y < f.y0 - 3 || x >= f.x1 + 3 || y >= f.y1 + 3) continue;
    const c = fineAt(f, x, y);
    if (!f.inside[c] || f.wet[c] || f.flat[c] || !f.natural[c]) continue;
    const t = f.top[c] - SHORE_UNDER;
    if (t < level && f.top[c] >= at - SHORE_DIP) level = t;
  }
  return level;
}
// The surface fineWater draws over column (lx, ly) of water cell c (cx, cy): its corners' levels
// (cornerLevel, kept as fineWater keeps them, in 32 bits) eased across the cell. Lower than the
// cell's own level where it slopes toward lower water or ice round it. BED_UNDER: how far under it
// a bed stays at least, past fineWater's own margin (a column within 0.001 of the surface has none).
// 0.01 since the water slopes more by the shore (23 November, Terrain.fineWaterLevel): a column's
// surface is two flat triangles, which dip a few thousandths under its corners' blend.
const BED_UNDER = 0.01;
// The cell whose corners LEVEL_C holds, -1 at each tile's start (the cells are read again between).
let LEVEL_CELL = -1;
const LEVEL_C = [0, 0, 0, 0];
function drawnLevel(f: FineCells, c: number, cx: number, cy: number, lx: number, ly: number, sub: number): number {
  if (c !== LEVEL_CELL) {
    const own = f.water[c];
    for (let q = 0; q < 4; q++) LEVEL_C[q] = Math.fround(cornerLevel(f, cx + (q & 1), cy + (q >> 1), own));
    LEVEL_CELL = c;
  }
  const [a, b, d, e] = LEVEL_C;
  if (a === b && a === d && a === e) return a;
  // The lowest over the column's square: the surface is drawn in flat triangles between points on
  // it, so at the column's middle only, its corner could still rise through a sloping sheet.
  let lo = Infinity;
  for (let q = 0; q < 4; q++) {
    const u = (lx + (q & 1)) / sub;
    const v = (ly + (q >> 1)) / sub;
    lo = Math.min(lo, a * (1 - u) * (1 - v) + b * u * (1 - v) + d * (1 - u) * v + e * u * v);
  }
  return lo;
}
function isWater(f: FineCells, c: number): boolean {
  return f.inside[c] === 1 && f.wet[c] === 1 && f.water[c] > -1e8 && f.lava[c] === 0;
}

function fineWater(f: FineCells, out: Writer, sub: number, sx0: number, sy0: number, SW: number, SH: number, ox: number, oz: number): boolean {
  const Q = 1 / sub;
  const n = SW * SH;
  if (WK.length < n) {
    WK = new Float64Array(n);
    FO = new Uint8Array(n);
    WC = new Int32Array(n);
  }
  // The cells the columns of the tile and its border fall in and one more round (the water a shore's
  // columns take, shoreLine), and their corners.
  const cx0 = Math.floor(sx0 / sub) - 1;
  const cy0 = Math.floor(sy0 / sub) - 1;
  const cw = Math.floor((sx0 + SW - 1) / sub) - cx0 + 2;
  const ch = Math.floor((sy0 + SH - 1) / sub) - cy0 + 2;
  if (CORNER.length < cw * ch * 4) {
    CORNER = new Float32Array(cw * ch * 4);
    DRY = new Float32Array(cw * ch * 4);
  }
  let any = false;
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const k = (y * cw + x) * 4;
      const gx = cx0 + x;
      const gy = cy0 + y;
      const inRange = gx >= f.x0 - 3 && gy >= f.y0 - 3 && gx < f.x1 + 3 && gy < f.y1 + 3;
      const c = inRange ? fineAt(f, gx, gy) : -1;
      DRY[k] = DRY[k + 1] = DRY[k + 2] = DRY[k + 3] = NaN;
      if (c < 0 || !isWater(f, c)) {
        CORNER[k] = CORNER[k + 1] = CORNER[k + 2] = CORNER[k + 3] = NaN;
        // A dry cell by water: the levels its water's corners take where they touch it, the others
        // their mean, for the columns of it under that water (shoreLine). Its surface meets its
        // neighbours' along every edge they share.
        if (c >= 0 && f.inside[c] && !f.wet[c]) {
          let sum = 0;
          let m = 0;
          for (let q = 0; q < 4; q++) {
            const l = cornerLevel(f, gx + (q & 1), gy + (q >> 1), NaN);
            DRY[k + q] = l;
            if (!Number.isNaN(l)) {
              sum += l;
              m++;
            }
          }
          if (m) for (let q = 0; q < 4; q++) if (Number.isNaN(DRY[k + q])) DRY[k + q] = sum / m;
        }
        continue;
      }
      any = true;
      const own = f.water[c];
      CORNER[k] = cornerLevel(f, gx, gy, own);
      CORNER[k + 1] = cornerLevel(f, gx + 1, gy, own);
      CORNER[k + 2] = cornerLevel(f, gx, gy + 1, own);
      CORNER[k + 3] = cornerLevel(f, gx + 1, gy + 1, own);
    }
  if (!any) return false;
  // The surface at (u, v) of the cell whose corners start at k: a water cell's, or a dry cell's by
  // water (DRY).
  const levelAt = (k: number, u: number, v: number) => {
    const a = Number.isNaN(CORNER[k]) ? DRY : CORNER;
    return a[k] * (1 - u) * (1 - v) + a[k + 1] * u * (1 - v) + a[k + 2] * (1 - u) * v + a[k + 3] * u * v;
  };
  // The level over each column, NaN where no water covers it.
  for (let j = 0; j < SH; j++)
    for (let i = 0; i < SW; i++) {
      const s = j * SW + i;
      WL[s] = NaN;
      if (CELL[s] < 0) continue;
      const sx = sx0 + i;
      const sy = sy0 + j;
      const x = Math.floor(sx / sub);
      const y = Math.floor(sy / sub);
      const k = ((y - cy0) * cw + (x - cx0)) * 4;
      const u = (sx - x * sub + 0.5) / sub;
      const v = (sy - y * sub + 0.5) / sub;
      WC[s] = CELL[s];
      if (Number.isNaN(CORNER[k])) {
        // A dry cell's column under its neighbour's water (shoreLine): the surface over the dry
        // cell (DRY), which meets its neighbours' along their edges.
        if (FLOOD[s] < 0 || Number.isNaN(DRY[k])) continue;
        const even = DRY[k] === DRY[k + 1] && DRY[k] === DRY[k + 2] && DRY[k] === DRY[k + 3];
        const level = even ? DRY[k] : levelAt(k, u, v);
        if (H[s] * Q >= level - 0.001) continue;
        WL[s] = level;
        WK[s] = even ? level : -1 - CELL[s];
        WC[s] = FLOOD[s];
        continue;
      }
      const flat = CORNER[k] === CORNER[k + 1] && CORNER[k] === CORNER[k + 2] && CORNER[k] === CORNER[k + 3];
      const level = flat ? CORNER[k] : levelAt(k, u, v);
      if (H[s] * Q >= level - 0.001) continue;
      WL[s] = level;
      WK[s] = flat ? level : -1 - CELL[s];
    }
  // Foam and waves.
  const wide = Math.min(B, Math.max(1, Math.round((sub * 3) / 8)));
  const foamOn = GRAPHICS.foam;
  for (let j = B; j < SH - B; j++)
    for (let i = B; i < SW - B; i++) {
      const s = j * SW + i;
      FO[s] = 0;
      if (Number.isNaN(WL[s])) continue;
      // Ice: no foam, its own tops (ICE_FOAM keeps them apart from the water's).
      if (f.ice[WC[s]]) {
        FO[s] = ICE_FOAM;
        continue;
      }
      const px = (sx0 + i + 0.5) / sub;
      const py = (sy0 + j + 0.5) / sub;
      // A river one or two cells wide has no foam; wider, a band that grows with it.
      const narrow = f.wnarrow[WC[s]];
      if (narrow >= 1) continue;
      const reach = narrow > 0 ? Math.max(1, Math.round(wide * (1 - narrow))) : wide;
      let near = Infinity;
      if (foamOn)
        for (let dy = -reach; dy <= reach && near > 1; dy++)
          for (let dx = -reach; dx <= reach; dx++) {
            const r = Math.max(Math.abs(dx), Math.abs(dy));
            if (r === 0 || r >= near) continue;
            const t = s + dx + dy * SW;
            // Land at or above the water: dry ground, or a bed that rises out of it.
            if (CELL[t] >= 0 && Number.isNaN(WL[t])) near = r;
          }
      if (near <= reach) {
        // A band one to `reach` columns wide by the shore, wavy, thinning away from the land and
        // broken in places, never a solid line.
        const width = 1 + noise(px, py, 0.9, 81) * reach;
        if (near <= width) {
          let level = near <= 1 ? 3 : near <= 2 ? 2 : 1;
          if (noise(px, py, 0.45, 83) < 0.32) level--;
          FO[s] = Math.max(0, level);
        }
      }
    }
  // The tops are drawn for the whole chunk at once when its last tile is built (fineWaterTops): each
  // column's level, key, foam and colour into the chunk's own arrays, and its cells' corners.
  let own = false;
  for (let j = B; j < SH - B; j++)
    for (let i = B; i < SW - B; i++) {
      const s = j * SW + i;
      const at = (sy0 + j - CW.y0) * CW.w + (sx0 + i - CW.x0);
      if (at < 0 || at >= CW.n || sx0 + i < CW.x0 || sx0 + i >= CW.x0 + CW.w) continue;
      CW.side[at] = 0;
      if (Number.isNaN(WL[s])) continue;
      own = true;
      CW.level[at] = WL[s];
      CW.key[at] = WK[s];
      CW.foam[at] = FO[s];
      CW.color[at] = f.ice[WC[s]] ? iceTone((sx0 + i + 0.5) / sub, (sy0 + j + 0.5) / sub) : f.wdeep[WC[s]];
    }
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const gx = cx0 + x - f.x0;
      const gy = cy0 + y - f.y0;
      if (gx < 0 || gy < 0 || gx >= CW.cells || gy >= CW.cellRows) continue;
      const k = (y * cw + x) * 4;
      const dry = Number.isNaN(CORNER[k]);
      for (let q = 0; q < 4; q++) CW.corner[(gy * CW.cells + gx) * 4 + q] = dry ? DRY[k + q] : CORNER[k + q];
    }
  // The level of column s's top at the middle of its edge toward d (east, south, west, north).
  const edgeLevel = (s: number, i: number, j: number, d: number): number => {
    if (WK[s] >= 0) return WK[s];
    const sx = sx0 + i;
    const sy = sy0 + j;
    const x = Math.floor(sx / sub);
    const y = Math.floor(sy / sub);
    const k = ((y - cy0) * cw + (x - cx0)) * 4;
    const u = (sx - x * sub + (d === 0 ? 1 : d === 2 ? 0 : 0.5)) / sub;
    const v = (sy - y * sub + (d === 1 ? 1 : d === 3 ? 0 : 0.5)) / sub;
    return levelAt(k, u, v);
  };
  // Sides where the water stands above what is next to it.
  out.e0 = SIDE_MARK;
  out.e1 = 0;
  for (let j = B; j < SH - B; j++)
    for (let i = B; i < SW - B; i++) {
      const s = j * SW + i;
      const level = WL[s];
      if (Number.isNaN(level)) continue;
      const floor = H[s] * Q;
      const deep = f.wdeep[WC[s]];
      const shallow = f.wshallow[WC[s]];
      for (let d = 0; d < 4; d++) {
        const t = s + DX[d] + DY[d] * SW;
        // Between two columns of water, by the levels of their tops at the edge they share: equal
        // wherever the surface is whole (a slope, level water), apart only at a fall.
        const top = edgeLevel(s, i, j, d);
        const next = !Number.isNaN(WL[t]) ? edgeLevel(t, i + DX[d], j + DY[d], (d + 2) & 3) : CELL[t] < 0 ? -Infinity : H[t] * Q;
        const lo = Math.max(floor, next);
        if (top - lo < 0.02) continue;
        const at = (sy0 + j - CW.y0) * CW.w + (sx0 + i - CW.x0);
        if (at >= 0 && at < CW.n) CW.side[at] |= 1 << d;
        const X = (sx0 + i) * Q + ox;
        const Z = (sy0 + j) * Q + oz;
        // Ice: its own matte side, a little darker than its top, as opaque.
        if (f.ice[WC[s]]) {
          sideQuad(out, d, X, Z, Q, lo, top, ICE_SIDE_LOW, ICE_ALPHA, ICE_SIDE, ICE_ALPHA);
          continue;
        }
        // Darker and less clear with depth, by height, so the sides of two columns meet in one tone.
        const split = level - WALL_DEEP;
        if (top - lo < 1) waterStep(out, d, X, Z, Q, lo, top, shallow, deep);
        else if (lo < split) {
          waterSide(out, d, X, Z, Q, lo, split, shallow, deep, level);
          waterSide(out, d, X, Z, Q, split, top, shallow, deep, level);
        } else waterSide(out, d, X, Z, Q, lo, top, shallow, deep, level);
      }
    }
  out.e0 = 0;
  return own;
}

// The water's tops of the chunk being built, column by column (NaN level: no water), with each
// column's sides (a bit for each way) and each cell's four corner levels.
const CW = {
  x0: 0,
  y0: 0,
  w: 0,
  n: 0,
  cells: 0,
  cellRows: 0,
  level: new Float32Array(0),
  key: new Float64Array(0),
  foam: new Uint8Array(0),
  color: new Uint32Array(0),
  side: new Uint8Array(0),
  corner: new Float32Array(0),
  rid: new Int32Array(0),
  done: new Uint8Array(0),
};

// Before a chunk's first tile: its arrays sized and emptied.
export function beginFineWater(f: FineCells, sub: number): void {
  CW.x0 = f.x0 * sub;
  CW.y0 = f.y0 * sub;
  CW.w = (f.x1 - f.x0) * sub;
  CW.n = CW.w * (f.y1 - f.y0) * sub;
  CW.cells = f.x1 - f.x0;
  CW.cellRows = f.y1 - f.y0;
  if (CW.level.length < CW.n) {
    CW.level = new Float32Array(CW.n);
    CW.key = new Float64Array(CW.n);
    CW.foam = new Uint8Array(CW.n);
    CW.color = new Uint32Array(CW.n);
    CW.side = new Uint8Array(CW.n);
    CW.rid = new Int32Array(CW.n);
    CW.done = new Uint8Array(CW.n);
  }
  if (CW.corner.length < CW.cells * CW.cellRows * 4) CW.corner = new Float32Array(CW.cells * CW.cellRows * 4);
  CW.level.fill(NaN, 0, CW.n);
  CW.side.fill(0, 0, CW.n);
  CW.corner.fill(NaN);
}

// The water's tops a tile wrote for its own columns (level, key, foam, colour, sides), kept with its
// chunk (17 November): a chunk built again in part draws its water's tops whole without building
// the tiles it keeps. Taken after the tile is built, put back after beginFineWater.
export interface WaterTile {
  i0: number;
  j0: number;
  w: number;
  h: number;
  level: Float32Array;
  key: Float64Array;
  foam: Uint8Array;
  color: Uint32Array;
  side: Uint8Array;
}

export function takeWaterTile(tx0: number, ty0: number, tx1: number, ty1: number, sub: number): WaterTile {
  const i0 = tx0 * sub - CW.x0;
  const j0 = ty0 * sub - CW.y0;
  const w = (tx1 - tx0) * sub;
  const h = (ty1 - ty0) * sub;
  const t: WaterTile = {
    i0,
    j0,
    w,
    h,
    level: new Float32Array(w * h),
    key: new Float64Array(w * h),
    foam: new Uint8Array(w * h),
    color: new Uint32Array(w * h),
    side: new Uint8Array(w * h),
  };
  for (let j = 0; j < h; j++) {
    const a = (j0 + j) * CW.w + i0;
    t.level.set(CW.level.subarray(a, a + w), j * w);
    t.key.set(CW.key.subarray(a, a + w), j * w);
    t.foam.set(CW.foam.subarray(a, a + w), j * w);
    t.color.set(CW.color.subarray(a, a + w), j * w);
    t.side.set(CW.side.subarray(a, a + w), j * w);
  }
  return t;
}

export function putWaterTile(t: WaterTile): void {
  for (let j = 0; j < t.h; j++) {
    const a = (t.j0 + j) * CW.w + t.i0;
    CW.level.set(t.level.subarray(j * t.w, (j + 1) * t.w), a);
    CW.key.set(t.key.subarray(j * t.w, (j + 1) * t.w), a);
    CW.foam.set(t.foam.subarray(j * t.w, (j + 1) * t.w), a);
    CW.color.set(t.color.subarray(j * t.w, (j + 1) * t.w), a);
    CW.side.set(t.side.subarray(j * t.w, (j + 1) * t.w), a);
  }
}

// The cells' corner levels of the chunk being built, to keep, and to put back.
export function takeWaterCorners(): Float32Array {
  return CW.corner.slice(0, CW.cells * CW.cellRows * 4);
}

export function putWaterCorners(a: Float32Array): void {
  CW.corner.set(a);
}

// The water's tops of the whole chunk, after its last tile: merged into rectangles where the surface
// is level (or within a cell where it slopes), each drawn with a corner wherever a neighbour's
// corner, a side of the water or the chunk's edge meets its own edges, so no corner of one lies
// partway along another's edge. Such T-junctions opened hairline cracks, and a hair of overlap drew
// lines of doubled water (the review of 17 November). Drawn per chunk, not per tile, so only the
// chunk's edges need a corner at every column.
export function fineWaterTops(out: Writer, sub: number, ox: number, oz: number): void {
  const { w, n, x0: X0, y0: Y0 } = CW;
  if (n === 0) return;
  const rows = n / w;
  const Q = 1 / sub;
  const level = CW.level;
  const key = CW.key;
  const foam = CW.foam;
  const color = CW.color;
  const rid = CW.rid;
  const done = CW.done;
  rid.fill(-1, 0, n);
  done.fill(0, 0, n);
  RECTS.length = 0;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < w; i++) {
      const s = j * w + i;
      if (done[s] || Number.isNaN(level[s])) continue;
      const k0 = key[s];
      const fo = foam[s];
      const col = color[s];
      // A sloping surface merges within its one cell (its key): the surface is bilinear there.
      const same = (t: number) => !done[t] && !Number.isNaN(level[t]) && key[t] === k0 && foam[t] === fo && color[t] === col;
      let ie = i + 1;
      while (ie < w && same(j * w + ie)) ie++;
      let je = j + 1;
      grow: while (je < rows) {
        for (let q = i; q < ie; q++) if (!same(je * w + q)) break grow;
        je++;
      }
      const r = RECTS.length / 5;
      for (let jj = j; jj < je; jj++) {
        done.fill(1, jj * w + i, jj * w + ie);
        rid.fill(r, jj * w + i, jj * w + ie);
      }
      RECTS.push(i, ie, j, je, s);
    }
  // -2 past the chunk's edge, -1 no water.
  const nb = (ii: number, jj: number) => (ii < 0 || jj < 0 || ii >= w || jj >= rows ? -2 : rid[jj * w + ii]);
  // Whether an edge needs a corner between two columns a and b of the rectangle, whose neighbours
  // that way (d) are na and nb.
  const need = (na: number, nb2: number, a: number, b: number, d: number) =>
    na !== nb2 || na === -2 || nb2 === -2 || ((na === -1 || nb2 === -1) && ((CW.side[a] | CW.side[b]) & (1 << d)) !== 0);
  for (let r = 0; r < RECTS.length; r += 5) {
    const i = RECTS[r];
    const ie = RECTS[r + 1];
    const j = RECTS[r + 2];
    const je = RECTS[r + 3];
    const s = RECTS[r + 4];
    const k0 = key[s];
    const col = color[s];
    const cx = Math.floor((X0 + i) / sub);
    const cy = Math.floor((Y0 + j) / sub);
    const kc = ((cy - Y0 / sub) * CW.cells + (cx - X0 / sub)) * 4;
    const C4 = CW.corner;
    const yAt = (x: number, z: number) => {
      if (k0 >= 0) return k0;
      const u = (X0 + x) * Q - cx;
      const v = (Y0 + z) * Q - cy;
      return C4[kc] * (1 - u) * (1 - v) + C4[kc + 1] * u * (1 - v) + C4[kc + 2] * (1 - u) * v + C4[kc + 3] * u * v;
    };
    // The outline, wound as the tops are: down the west side, east along the south, up the east
    // side, west along the north.
    PTS.length = 0;
    PTS.push(i, j);
    for (let q = j + 1; q < je; q++) if (need(nb(i - 1, q - 1), nb(i - 1, q), (q - 1) * w + i, q * w + i, 2)) PTS.push(i, q);
    PTS.push(i, je);
    for (let q = i + 1; q < ie; q++) if (need(nb(q - 1, je), nb(q, je), (je - 1) * w + q - 1, (je - 1) * w + q, 1)) PTS.push(q, je);
    PTS.push(ie, je);
    for (let q = je - 1; q > j; q--) if (need(nb(ie, q - 1), nb(ie, q), (q - 1) * w + ie - 1, q * w + ie - 1, 0)) PTS.push(ie, q);
    PTS.push(ie, j);
    for (let q = ie - 1; q > i; q--) if (need(nb(q - 1, j - 1), nb(q, j - 1), j * w + q - 1, j * w + q, 3)) PTS.push(q, j);
    const frozen = foam[s] === ICE_FOAM;
    out.e0 = frozen ? ICE_MARK : 1;
    out.e1 = frozen ? 0 : foam[s] / FOAM_LEVELS;
    const alpha = frozen ? ICE_ALPHA : 1;
    const X = (x: number) => (X0 + x) * Q + ox;
    const Z = (z: number) => (Y0 + z) * Q + oz;
    const m = PTS.length / 2;
    if (m === 4) {
      out.quad(X(i), yAt(i, j), Z(j), X(i), yAt(i, je), Z(je), X(ie), yAt(ie, je), Z(je), X(ie), yAt(ie, j), Z(j), col, alpha, col, alpha, 1, 0, false);
      continue;
    }
    // A fan round the middle, two triangles a quad (the second empty when the count is odd).
    const mx = (i + ie) / 2;
    const mz = (j + je) / 2;
    const my = yAt(mx, mz);
    for (let a = 0; a < m; a += 2) {
      const b = (a + 1) % m;
      const c = a + 2 < m ? a + 2 : (a + 2) % m === 0 ? 0 : b;
      const ax = PTS[a * 2];
      const az = PTS[a * 2 + 1];
      const bx = PTS[b * 2];
      const bz = PTS[b * 2 + 1];
      const cx2 = PTS[c * 2];
      const cz2 = PTS[c * 2 + 1];
      out.quad(X(mx), my, Z(mz), X(ax), yAt(ax, az), Z(az), X(bx), yAt(bx, bz), Z(bz), X(cx2), yAt(cx2, cz2), Z(cz2), col, alpha, col, alpha, 1, 0, false);
    }
  }
  out.e0 = 0;
  out.e1 = 0;
}

// Ice (20 November: on tundra lakes it was drawn in whole cells, flat pale slabs with grid lines
// beside the water in eighths). Frozen water is drawn with the water in eighths, its surface the
// same (the same corners, the same waterline at the shore), so it meets the shore and the open
// water with no step; its tops apart (their foam ICE_FOAM, marked ICE_MARK for the shader: matte,
// no waves, no glints) in a whitish blue with drifts of snow, bluer patches and thin cracks, baked
// per column in a few tones so the tops still merge, and nearly opaque (ICE_ALPHA), so the water
// under it does not show.
const ICE_FOAM = 255;
const ICE_ALPHA = 0.97;
const ICE_BASE = 0xc8e4f2;
const ICE_DRIFT = 0xd8ecf5;
const ICE_BLUE = 0xb9daeb;
const ICE_CRACK = 0xa3c8de;
const ICE_SIDE = 0xa9cde2;
const ICE_SIDE_LOW = 0x8fb6cf;
export function iceTone(px: number, py: number): number {
  if (Math.abs(noise(px, py, 1.6, 203) - 0.5) < 0.012) return ICE_CRACK;
  const drift = noise(px, py, 3.2, 201);
  return drift > 0.66 ? ICE_DRIFT : drift < 0.3 ? ICE_BLUE : ICE_BASE;
}

// The depth over which a water side darkens, scene units.
const WALL_DEEP = 3;
// A side a cell or more tall (in the water in eighths, the island's rim, where the water is cut down
// to its bed): from its top in the water's own blue, as a small step's (waterStep), to the deep
// colour, and from nearly to wholly opaque. Its top was a pale cyan (0x8fd8e6) a third opaque until
// 20 November: with the light sand of the bed seen through it, it drew a bright line along the rim.
const SIDE_ALPHA = 0.82;
const SIDE_ALPHA_DEEP = 0.96;
function waterSide(out: Writer, d: number, X: number, Z: number, Q: number, lo: number, hi: number, shallow: number, deep: number, level: number): void {
  const k = (y: number) => Math.min(1, Math.max(0, (level - y) / WALL_DEEP));
  const top = stepColor(shallow, deep);
  const cl = mixColor(top, deep, 0.6 * k(lo));
  const ch = mixColor(top, deep, 0.6 * k(hi));
  sideQuad(out, d, X, Z, Q, lo, hi, cl, SIDE_ALPHA + (SIDE_ALPHA_DEEP - SIDE_ALPHA) * k(lo), ch, SIDE_ALPHA + (SIDE_ALPHA_DEEP - SIDE_ALPHA) * k(hi));
}
// A side less than a cell tall (a river stepping down, a shallow edge): the water's own blue, a
// little darker than its top, nearly as clear, so a small fall does not draw a pale outline (it was
// SIDE_TOP, 0x8fd8e6, before 18 November).
const STEP_SHADE = 0.86;
function stepColor(shallow: number, deep: number): number {
  return scaleColor(mixColor(shallow, deep, 0.45), STEP_SHADE);
}
function waterStep(out: Writer, d: number, X: number, Z: number, Q: number, lo: number, hi: number, shallow: number, deep: number): void {
  const c = stepColor(shallow, deep);
  sideQuad(out, d, X, Z, Q, lo, hi, c, SIDE_ALPHA, c, SIDE_ALPHA);
}
function sideQuad(out: Writer, d: number, X: number, Z: number, Q: number, lo: number, hi: number, cl: number, al: number, ch: number, ah: number): void {
  const x0 = X;
  const x1 = X + Q;
  const z0 = Z;
  const z1 = Z + Q;
  // Wound as Writer.rect winds each side.
  if (d === 0) out.quad(x1, lo, z0, x1, hi, z0, x1, hi, z1, x1, lo, z1, cl, al, ch, ah, 0, 0, true);
  else if (d === 1) out.quad(x0, lo, z1, x1, lo, z1, x1, hi, z1, x0, hi, z1, cl, al, ch, ah, 0, 0, true);
  else if (d === 2) out.quad(x0, lo, z0, x0, lo, z1, x0, hi, z1, x0, hi, z0, cl, al, ch, ah, 0, 0, true);
  else out.quad(x0, lo, z0, x0, hi, z0, x1, hi, z0, x1, lo, z0, cl, al, ch, ah, 0, 0, true);
}

interface Face {
  lo: number;
  hi: number;
  color: number;
  light: number;
  foot: number;
  glow: number;
  wet: number;
  at: number; // the column's place along the wall's line
  line: number; // the line: the column's other coordinate, the wall's side taken in
}
interface Run {
  lo: number;
  hi: number;
  color: number;
  light: number;
  foot: number;
  glow: number;
  wet: number;
  start: number;
  end: number;
  line: number;
  until: number;
}
const RUNS: Run[] = [];
const FACES: Face[] = Array.from({ length: 32 }, () => ({ lo: 0, hi: 0, color: 0, light: 0, foot: 1, glow: 0, wet: 0, at: 0, line: 0 }));
const WALL_LIGHT = [FACE_LIGHT.east, FACE_LIGHT.south, FACE_LIGHT.west, FACE_LIGHT.north];

function emitRun(out: Writer, d: number, run: Run, sub: number, ox: number, oz: number): void {
  const Q = 1 / sub;
  const lo = run.lo * Q;
  const hi = run.hi * Q;
  out.e0 = run.glow / GLOW_LEVELS;
  out.e1 = run.wet;
  if (d === 1 || d === 3) {
    const z = run.line * Q + oz;
    out.rect(d, run.start * Q + ox, run.end * Q + ox, lo, hi, z, z, run.color, run.light, 1, 0, run.foot);
  } else {
    const x = run.line * Q + ox;
    out.rect(d, x, x, lo, hi, run.start * Q + oz, run.end * Q + oz, run.color, run.light, 1, 0, run.foot);
  }
  // Whatever is written straight to `out` next (overhanging grass, a ledge) is dry and unlit.
  out.e0 = 0;
  out.e1 = 0;
}

// The faces of column (sx, sy)'s wall on side d, into FACES; returns how many. Overhanging grass
// is written straight to `out`.
function wallFaces(
  f: FineCells,
  d: number,
  sx: number,
  sy: number,
  s: number,
  SW: number,
  sub: number,
  grain: boolean,
  blend: boolean,
  out: Writer,
  ox: number,
  oz: number,
): number {
  const T = H[s];
  let low = H[s + DX[d] + DY[d] * SW];
  if (low >= T) return 0;
  // The column's cell as drawn (WALLC): a cliff corner's or the shore's raised land has the walls of
  // the land it is drawn as, not the sand of the water cell it stands in (26 November, the owner:
  // thin tan strips down the coast's cliffs).
  const c = WALLC[s];
  if (c < 0 || !f.inside[c]) return 0;
  // Past the chunk's edge the neighbour may be drawn as whole cells: the wall goes down to its
  // cell's top too, so no gap opens between the two.
  const nx = Math.floor((sx + DX[d]) / sub);
  const ny = Math.floor((sy + DY[d]) / sub);
  if (nx < f.x0 || ny < f.y0 || nx >= f.x1 || ny >= f.y1) {
    const n = fineAt(f, nx, ny);
    low = f.inside[n] ? Math.min(low, f.top[n] * sub) : f.bottom * sub;
  }
  const bottom = f.bottom * sub;
  const light = WALL_LIGHT[d];
  const rocks = GRAPHICS.rocks;
  const foot = low > bottom ? CREASE : 1;
  const alongX = d === 1 || d === 3;
  const at = alongX ? sx : sy;
  const glow = GL[s] > 0 || LAVA_D[s] < GLOW_REACH || HOUSE_D[s] < GLOW_REACH;
  // The wall's plane: the far side of the column for east and south.
  const line = alongX ? sy + (d === 1 ? 1 : 0) : sx + (d === 0 ? 1 : 0);
  let n = 0;
  const face = (lo: number, hi: number, color: number) => {
    if (hi <= lo) return;
    const F = FACES[n++];
    F.lo = lo;
    F.hi = hi;
    F.color = color;
    // A bit darker the deeper below the column's top, in steps of a voxel so runs still merge.
    F.light = light * (1 - Math.min(0.25, Math.floor((T - hi) / sub) * 0.03));
    F.foot = lo === low ? foot : 1;
    F.glow = glow ? glowLevel(s, (lo + hi) / (2 * sub)) : 0;
    // Under the water only between two columns of the bed: the island's side below the sea is earth.
    F.wet = WET[s] & WET[s + DX[d] + DY[d] * SW];
    F.at = at;
    F.line = line;
  };
  if (!f.natural[c]) {
    face(low, T, f.edge[c]);
    return n;
  }
  // The riser of a slope's tiny step: the ground's own colour (its slope light, hollows and tint
  // included), a little darker on its side, so every small cube's edge still shows.
  if (T - low <= RS[s] && !f.wet[c] && low > bottom) {
    face(low, T, C[s]);
    // On snow and rock the steps of a slope are lit as the slope is, not as walls: one turned from
    // the sun read as a lone blue face, in checkers across a snowy peak (17 November).
    // On sand too (18 November, the owner: dark wavy contour lines across flat sand, a step's riser
    // lit as a wall's dark side): its slopes' risers take the slope's light, as its tops do.
    if (f.steep[c] || SANDY[s]) FACES[n - 1].wet = SLOPE_LIT;
    // Bright ground (sand, snow) takes half the dark side: on sand every small step's shadow read
    // as a washboard (15 November).
    const bright = f.ground[c] === G.SAND || f.ground[c] === G.SNOW;
    FACES[n - 1].light = 1 - RISER_SIDE * (LAND[s] === 2 ? ROCK_CALM : 1) * (bright ? BRIGHT_CALM : 1) * (1 - light);
    FACES[n - 1].foot = 1;
    return n;
  }
  // Weed and stones on a lake's bed (weed): one face in their own colour, lit as a dry riser so each
  // stalk's cube shows; below the bed's top (a step of the bed beside it), one face of the bed's.
  if (WEEDS[s] && low > bottom) {
    const base = T - RAISE[s];
    face(Math.max(low, base), T, C[s]);
    FACES[n - 1].light = 1 - RISER_SIDE * (1 - light);
    FACES[n - 1].foot = 1;
    if (low < base) {
      face(low, base, BEDC[s]);
      FACES[n - 1].light = 1 - 0.25 * (1 - light);
      FACES[n - 1].foot = 1;
    }
    return n;
  }
  // The small steps of a water bed: its own colour and nearly its top's light, so the bed under the
  // water reads as one smooth floor and not as lines of darker steps. A lake's bed so at any height
  // between two of its columns (26 November): a taller step drew its soil and stone, not darkened with
  // the floor, as light blocks across the dark deep floor.
  const lakeStep = WET[s] & WET[s + DX[d] + DY[d] * SW] && isBed(f, c) && f.wlake[c] > 0 && FLOOD[s] < 0;
  if ((T - low <= 2 * sub || lakeStep) && (isBed(f, c) || FLOOD[s] >= 0) && low > bottom) {
    face(low, T, C[s]);
    FACES[n - 1].light = 1 - 0.25 * (1 - light);
    FACES[n - 1].foot = 1;
    return n;
  }
  const px = (sx + 0.5) / sub;
  const py = (sy + 0.5) / sub;
  const top = f.top[c] * sub;
  // The top's own colour, about a quarter voxel, its lower edge wavy; deeper on grass now and then.
  const g =
    Math.max(1, Math.round(sub / 4)) + (noise(px, py, 0.5, 41 + d) > 0.55 ? Math.max(1, sub >> 3) : 0) + (f.hangs[c] && noise(px, py, 0.9, 45) > 0.75 ? 1 : 0);
  // Snow lies on its slope's steps down to a voxel below the cell's top, so a snowy slope is white
  // and not a maze of white tops over black rock (15 November).
  const edgeLo = Math.max(low, f.ground[c] === G.SNOW ? Math.min(T - g, top - sub) : T - g);
  face(edgeLo, T, f.edge[c]);
  // Soil to three voxels below the cell's top, in soft patches of tone.
  const soilLo = Math.max(low, Math.min(edgeLo, top - 3 * sub));
  const soil = grain ? scaleColor(f.soil[c], SHADES[Math.floor(noise(px, py, 1.4, 51) * 2.999)]) : f.soil[c];
  face(soilLo, edgeLo, soil);
  // Stone down to the deep rock, in bands of two voxels by height (grain).
  const deepTop = Math.max(low, bottom + 2 * sub);
  let hi = soilLo;
  if (grain && rocks) {
    // Rock in strata of one voxel, three tones, each with a darker seam at its foot; now and then
    // a crack, a column darker all the way down.
    const crack = hash(sx, sy, 63 + d) < 0.05 ? 0.72 : 1;
    let courses = 0;
    while (hi > deepTop) {
      const band = Math.floor((hi - 1) / sub);
      const lo = courses >= 8 ? deepTop : Math.max(deepTop, band * sub);
      const stone = scaleColor(f.stone[c], ROCK_TONE[((band % 3) + 3) % 3] * crack);
      const seam = Math.min(hi, lo + 1);
      if (courses < 8 && hi - lo > 1) {
        face(seam, hi, stone);
        face(lo, seam, scaleColor(stone, 0.8));
      } else face(lo, hi, stone);
      hi = lo;
      courses++;
    }
  } else if (grain) {
    let courses = 0;
    while (hi > deepTop) {
      const band = Math.floor((hi - 1) / (2 * sub));
      const lo = courses >= 5 ? deepTop : Math.max(deepTop, band * 2 * sub);
      face(lo, hi, scaleColor(f.stone[c], STRATA_TONE[((band % STRATA_TONE.length) + STRATA_TONE.length) % STRATA_TONE.length]));
      hi = lo;
      courses++;
    }
  } else if (hi > deepTop) {
    face(deepTop, hi, f.stone[c]);
    hi = deepTop;
  }
  face(low, Math.min(hi, bottom + 2 * sub), f.deep[c]);
  // A small ledge on a cliff, at a band's foot, in short runs (rocks).
  if (rocks && grain && T - low >= 2 * sub && !f.wet[c]) {
    const y = Math.floor((soilLo - 1) / sub) * sub;
    if (y - 1 > low + sub && y < soilLo && noise(px, py, 0.5, 77 + d) > 0.7) {
      const Q = 1 / sub;
      const reach = Q * 0.7;
      const X = sx * Q + ox;
      const Z = sy * Q + oz;
      const x0 = d === 0 ? X + Q : d === 2 ? X - reach : X;
      const x1 = d === 0 ? X + Q + reach : d === 2 ? X : X + Q;
      const z0 = d === 1 ? Z + Q : d === 3 ? Z - reach : Z;
      const z1 = d === 1 ? Z + Q + reach : d === 3 ? Z : Z + Q;
      const yl = (y - 1) * Q;
      const yh = y * Q;
      const rock = scaleColor(f.stone[c], 1.06);
      // On a snowy cliff, snow on the ledge (15 November).
      out.rect(4, x0, x1, yh, yh, z0, z1, f.ground[c] === G.SNOW ? f.color[c] : rock, FACE_LIGHT.top, 1, 0);
      out.rect(d, x0, x1, yl, yh, z0, z1, rock, light, 1, 0);
      const e1 = (d + 1) % 4;
      const e2 = (d + 3) % 4;
      out.rect(e1, x0, x1, yl, yh, z0, z1, rock, WALL_LIGHT[e1], 1, 0);
      out.rect(e2, x0, x1, yl, yh, z0, z1, rock, WALL_LIGHT[e2], 1, 0);
    }
  }
  // Grass and snow that hang over the edge of a cliff, in short runs (blend).
  if (blend && f.hangs[c] && !f.wet[c] && T - low >= sub && T >= top - 1 && noise(px, py, 0.6, 71 + d) > 0.6) {
    const Q = 1 / sub;
    const drop = Math.max(1, sub >> 2) + (noise(px, py, 0.35, 75) > 0.5 ? 1 : 0);
    const reach = Q * 0.8;
    const X = sx * Q + ox;
    const Z = sy * Q + oz;
    const x0 = d === 0 ? X + Q : d === 2 ? X - reach : X;
    const x1 = d === 0 ? X + Q + reach : d === 2 ? X : X + Q;
    const z0 = d === 1 ? Z + Q : d === 3 ? Z - reach : Z;
    const z1 = d === 1 ? Z + Q + reach : d === 3 ? Z : Z + Q;
    const yl = (T - drop) * Q;
    const yh = T * Q;
    out.rect(4, x0, x1, yh, yh, z0, z1, f.color[c], FACE_LIGHT.top, 1, 0);
    out.rect(d, x0, x1, yl, yh, z0, z1, f.edge[c], light, 1, 0);
    out.rect(5, x0, x1, yl, yl, z0, z1, scaleColor(f.edge[c], 0.7), light, 1, 0);
    const e1 = (d + 1) % 4;
    const e2 = (d + 3) % 4;
    out.rect(e1, x0, x1, yl, yh, z0, z1, f.edge[c], WALL_LIGHT[e1], 1, 0);
    out.rect(e2, x0, x1, yl, yh, z0, z1, f.edge[c], WALL_LIGHT[e2], 1, 0);
  }
  return n;
}

// A line of white foam on the water where it meets land, about a fifth of a cell wide, wavy.
function foam(f: FineCells, out: Writer, sub: number, sx0: number, sy0: number, SW: number, SH: number, ox: number, oz: number): void {
  const Q = 1 / sub;
  const reach = Math.min(B, Math.max(1, Math.round(sub * 0.25)));
  const dry = (s: number, sx: number, sy: number, surface: number) => {
    const n = fineAt(f, Math.floor(sx / sub), Math.floor(sy / sub));
    if (!f.inside[n]) return false;
    return !f.wet[n] || H[s] * Q > surface;
  };
  for (let j = B; j < SH - B; j++) {
    let run = -1;
    let runColor = 0;
    let runY = 0;
    const flush = (k: number) => {
      if (run < 0) return;
      const X0 = (sx0 + run) * Q + ox;
      const X1 = (sx0 + k) * Q + ox;
      const Z = (sy0 + j) * Q + oz;
      out.rect(4, X0, X1, runY, runY, Z, Z + Q, runColor, 1, 1, 0);
      run = -1;
    };
    for (let k = B; k < SW - B; k++) {
      const s = j * SW + k;
      const sx = sx0 + k;
      const sy = sy0 + j;
      const c = fineAt(f, Math.floor(sx / sub), Math.floor(sy / sub));
      const surface = f.water[c];
      let color = 0;
      if (surface > -1e8 && !f.lava[c] && H[s] * Q <= surface) {
        // How far the nearest land is, in columns (up to `reach`).
        let near = Infinity;
        for (let dy = -reach; dy <= reach && near > 1; dy++)
          for (let dx = -reach; dx <= reach; dx++) {
            const r = Math.max(Math.abs(dx), Math.abs(dy));
            if (r === 0 || r >= near) continue;
            if (dry(s + dx + dy * SW, sx + dx, sy + dy, surface)) near = r;
          }
        const width = (1 + noise((sx + 0.5) / sub, (sy + 0.5) / sub, 0.9, 81) * reach) | 0;
        if (near <= width) color = near <= Math.max(1, width - 1) ? FOAM : FOAM_SOFT;
      }
      const y = surface + 0.035;
      if (color && run >= 0 && color === runColor && y === runY) continue;
      flush(k);
      if (color) {
        run = k;
        runColor = color;
        runY = y;
      }
    }
    flush(SW - B);
  }
}
