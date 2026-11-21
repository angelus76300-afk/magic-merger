import { InstancedMesh, Matrix4, MeshBasicMaterial, type Material, type Scene } from "three";
import { G } from "../materials";
import { Rng } from "../noise";
import { CUBE, Vox, geometryOfMesh, h3, mix, tone } from "./cubes";
import { EDGE_DARK, EDGE_LIGHT, PATCH_TONES, type LocalMesh } from "./shapes";

// What stands on the land, in small cubes (16 November, the owner's screenshots of 15 November:
// boulders as grey two-tier boxes, shrubs as one green cube, cacti as stacked boxes, flames as tall
// orange boxes, crystals as plain prisms, clouds as flat slabs). Each is drawn here as a model of
// CUBE cubes, a few shapes of each, so a field of rocks or a forest of shrubs is not one model
// repeated: rounded rocks in four greys, moss on top where the ground is green; leafy clumps in
// three greens, berries where the cover has them; saguaros with arms and ribs; crystals with
// facets, a pointed tip and a light edge; charred stumps scattered and thinned, a few embers among
// them; flames that taper, hot at the core and dark at the tips, in frames swapped as they burn;
// puffy clouds. Drawing only, behind GRAPHICS.cubes (off on the low preset, which draws as before).
// Each shape is one instanced model, made once: a field of them costs one draw call.

// How far a model reaches under the ground, in cubes: the land is drawn finer than its cells, so a
// rock on a slope would float on its low side. Its foot goes on down instead, as a seated rock's.
const SINK = { rock: 3, plant: 1, stump: 2 };

// Shapes of each kind, by the cover's model name.
export const COVER_SHAPES: Record<string, number> = { boulder: 4, scree: 2, bush: 3, berries: 2, cactus: 3, crystals: 3, stump: 3, ember: 2 };
// Of the stumps of a burnt forest, one in STUMP_THIN is drawn: one per cell was a checkerboard.
export const STUMP_THIN = 3;
// One stump on burnt ground in EMBER_EVERY has embers glowing by it.
export const EMBER_EVERY = 6;

const ROCK = [0x6c6e73, 0x83858a, 0x9a9ca0, 0xb2b4b7];
const MOSS = [0x4c7430, 0x5f8a3a];
const LEAF = [0x2f6a2a, 0x3f8a33, 0x5aa43e];
const CACTUS = [0x3a6e30, 0x4f8a3a, 0x67a34a];
const CRYSTAL = [0x8f78e8, 0xb9a4ff, 0xe6deff];
const CHAR = [0x2a2220, 0x3a2f2a, 0x4e3e33];

// The model names drawn here, with their shape: "boulder#2", "ember#0".
export function coverCubeKeys(key: string, hash: number, ground: number): string[] {
  const n = COVER_SHAPES[key];
  if (!n || key === "ember") return [key];
  const shape = (hash >>> 7) % n;
  if (key === "boulder" || key === "scree") return [`${key}#${shape}${ground === G.GRASS || ground === G.DIRT ? "m" : ""}`];
  if (key === "stump") {
    const burnt = ground === G.ASH;
    if (burnt && (hash >>> 3) % STUMP_THIN !== 0) return (hash >>> 11) % (EMBER_EVERY * 2) === 0 ? [`ember#${(hash >>> 5) % 2}`] : [];
    const out = [`stump#${shape}`];
    if (burnt && (hash >>> 11) % EMBER_EVERY === 0) out.push(`ember#${(hash >>> 5) % 2}`);
    return out;
  }
  return [`${key}#${shape}`];
}

export const coverCubeGlows = (key: string): boolean => key.startsWith("ember#") || key.startsWith("crystals#");

const made = new Map<string, LocalMesh>();

// A cover's model in cubes by its name with its shape ("boulder#2m": shape 2, mossy), or null for
// a model this module does not draw.
export function coverInCubes(key: string): LocalMesh | null {
  const [name, rest] = key.split("#");
  if (name.startsWith("sp:")) {
    let m = made.get(key);
    if (!m) made.set(key, (m = spellCoverInCubes(name, parseInt(rest ?? "0", 10) || 0)));
    return m;
  }
  if (rest === undefined || !(name in COVER_SHAPES)) return null;
  let m = made.get(key);
  if (m) return m;
  const shape = parseInt(rest, 10) || 0;
  const moss = rest.endsWith("m");
  let seed = 0x9e37 + shape * 7919;
  for (let k = 0; k < name.length; k++) seed = Math.imul(seed ^ name.charCodeAt(k), 0x01000193) >>> 0;
  const rng = new Rng(seed);
  let v: Vox;
  let sink = SINK.plant;
  if (name === "boulder" || name === "scree") {
    v = name === "boulder" ? boulder(rng, seed, shape, moss) : scree(rng, seed, moss);
    sink = SINK.rock;
  } else if (name === "bush" || name === "berries") v = bush(rng, seed, name === "berries", shape);
  else if (name === "cactus") v = cactus(rng, seed, shape);
  else if (name === "crystals") v = crystals(rng, seed, shape);
  else if (name === "stump") {
    v = stump(rng, seed, shape);
    sink = SINK.stump;
  } else v = embers(seed, shape);
  m = lowered(v.mesh(true), sink * CUBE);
  made.set(key, m);
  return m;
}

function lowered(m: LocalMesh, by: number): LocalMesh {
  // Model z 0 is the ground: everything from `sink` cubes up was filled from z 0, then the whole
  // model is put down by `by`, its foot under the land.
  for (const a of [m.lit, m.glow]) for (let k = 1; k < a.pos.length; k += 3) a.pos[k] -= by;
  return m;
}

// Shades a model's cubes in `tones` (dark to light) by height, by the sky above or the ground under
// each, and in soft patches two or three cubes across, so its faces are calm, not speckled.
function shadeBy(v: Vox, tones: number[], seed: number, from = 0, keep?: (c: number) => boolean): void {
  let top = 1;
  v.each((_x, _y, z) => (top = Math.max(top, z)));
  const cells: [number, number, number, number][] = [];
  v.each((x, y, z, c) => cells.push([x, y, z, c]));
  for (const [x, y, z, c] of cells) {
    if (keep?.(c)) continue;
    let s = (z - from) / Math.max(1, top - from);
    if (!v.has(x, y, z + 1)) s += 0.3;
    if (z > 0 && !v.has(x, y, z - 1)) s -= 0.35;
    s += (h3(Math.floor(x / 3), Math.floor(y / 3), Math.floor(z / 2), seed ^ 0x2b) - 0.5) * 0.45;
    v.set(x, y, z, tones[Math.max(0, Math.min(tones.length - 1, Math.floor(s * tones.length * 0.85 + 0.4)))]);
  }
}

// A rock: two or three lumps run together, wide and low, its rim ragged.
function lumps(v: Vox, seed: number, parts: [number, number, number, number, number][]): void {
  for (const [cx, cy, rx, ry, rz] of parts) {
    const R = Math.ceil(Math.max(rx, ry) + 1);
    for (let z = 0; z <= Math.ceil(rz) + 3; z++)
      for (let y = Math.floor(cy - R); y <= cy + R; y++)
        for (let x = Math.floor(cx - R); x <= cx + R; x++) {
          const dx = (x + 0.5 - cx) / rx;
          const dy = (y + 0.5 - cy) / ry;
          // The foot (z under SINK.rock) is as wide as the rock's waist: it is under the land.
          const zz = Math.max(0, z + 0.5 - SINK.rock) / rz;
          if (dx * dx + dy * dy + zz * zz <= 1 + (h3(x, y, z, seed) - 0.5) * 0.35) v.set(x, y, z, ROCK[1]);
        }
  }
}

function moss(v: Vox, seed: number): void {
  const top: [number, number, number][] = [];
  v.each((x, y, z) => {
    if (z > SINK.rock + 1 && !v.has(x, y, z + 1)) top.push([x, y, z]);
  });
  for (const [x, y, z] of top) {
    const n = h3(Math.floor(x / 2), Math.floor(y / 2), 0, seed ^ 0x6d);
    if (n < 0.5) v.set(x, y, z, MOSS[n < 0.2 ? 0 : 1]);
  }
}

function boulder(rng: Rng, seed: number, shape: number, mossy: boolean, tones = ROCK): Vox {
  const v = new Vox(8, 14, 3);
  const r = [3.6, 2.8, 4.3, 3.2][shape];
  const h = [2.8, 2.2, 3.4, 2.4][shape];
  const parts: [number, number, number, number, number][] = [[4 + rng.range(-0.5, 0.5), 4 + rng.range(-0.5, 0.5), r, r * rng.range(0.75, 0.95), h]];
  // A second lump leaning on the first, and on the last shape a small rock beside it.
  parts.push([4 + rng.range(-1.6, 1.6), 4 + rng.range(-1.6, 1.6), r * 0.62, r * 0.55, h * rng.range(1.05, 1.3)]);
  if (shape === 3) parts.push([7.5, 6.5, 1.6, 1.4, 1.2]);
  lumps(v, seed, parts);
  shadeBy(v, tones, seed, SINK.rock);
  if (mossy) moss(v, seed);
  return v;
}

function scree(rng: Rng, seed: number, mossy: boolean): Vox {
  const v = new Vox(8, 8, 1);
  const parts: [number, number, number, number, number][] = [];
  for (let k = 0; k < 4; k++) parts.push([rng.range(1.5, 6.5), rng.range(1.5, 6.5), rng.range(0.9, 1.6), rng.range(0.8, 1.4), rng.range(0.5, 1)]);
  lumps(v, seed, parts);
  shadeBy(v, ROCK, seed, SINK.rock);
  if (mossy) moss(v, seed);
  return v;
}

// A leafy clump: two or three round clumps of leaves, lighter on top, a few leaves out of the rim;
// berries red and blue on its sides, or on one shape small white flowers.
function bush(rng: Rng, seed: number, berries: boolean, shape: number, tones = LEAF): Vox {
  const v = new Vox(8, 10, 2);
  const S = SINK.plant;
  const clumps = 2 + (shape % 2);
  for (let k = 0; k < clumps; k++) {
    const a = rng.next() * Math.PI * 2;
    const d = k ? rng.range(1.2, 2) : 0;
    const cx = 4 + Math.cos(a) * d;
    const cy = 4 + Math.sin(a) * d;
    const rx = (k ? 2.2 : 2.9) + rng.range(-0.3, 0.4);
    const rz = (k ? 2 : 2.6) + rng.range(-0.2, 0.3);
    for (let z = 0; z < 10; z++)
      for (let y = -2; y < 10; y++)
        for (let x = -2; x < 10; x++) {
          const dx = (x + 0.5 - cx) / rx;
          const dy = (y + 0.5 - cy) / rx;
          const dz = (Math.max(0, z - S) + 0.5 - rz * 0.75) / rz;
          if (dx * dx + dy * dy + dz * dz <= 1 + (h3(x, y, z, seed) - 0.5) * 0.4) v.set(x, y, z, LEAF[1]);
        }
  }
  shadeBy(v, tones, seed, S);
  const dots: number[] = berries ? [0xc0233a, 0xc0233a, 0x3a3a9a] : shape === 2 ? [0xf4f0ea, 0xf2d65a] : [];
  if (dots.length) {
    let n = 0;
    v.each((x, y, z) => {
      if (z <= S + 1 || n > (berries ? 9 : 5)) return;
      const open = !v.has(x + 1, y, z) || !v.has(x - 1, y, z) || !v.has(x, y + 1, z) || !v.has(x, y - 1, z) || !v.has(x, y, z + 1);
      if (open && h3(x, y, z, seed ^ 0x51) < (berries ? 0.16 : 0.09)) {
        v.set(x, y, z, dots[n % dots.length]);
        n++;
      }
    });
  }
  return v;
}

// A saguaro: a column two or three cubes square, ribbed in light and dark stripes, with one or two
// arms that go out and turn up, a lighter crown, and on one shape a flower on top.
function cactus(rng: Rng, seed: number, shape: number): Vox {
  const w = shape === 2 ? 3 : 2;
  const H = [9, 11, 12][shape] + SINK.plant;
  const v = new Vox(8, H + 2, 2);
  const x0 = 4 - (w >> 1);
  const y0 = 4 - (w >> 1);
  const rib = (x: number, y: number) => ((x + y) % 2 ? CACTUS[0] : CACTUS[1]);
  v.box(x0, y0, 0, x0 + w, y0 + w, H, rib);
  // Rounded crown: the top's corners taken off, a lighter cube in the middle.
  if (w === 3) {
    v.clear(x0, y0, H - 1);
    v.clear(x0 + 2, y0 + 2, H - 1);
  }
  v.set(x0 + (w >> 1), y0 + (w >> 1), H - 1, CACTUS[2]);
  const arms = shape === 0 ? 1 : 2;
  const sides: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const first = Math.floor(rng.next() * 4);
  for (let k = 0; k < arms; k++) {
    const [dx, dy] = sides[(first + k * 2) % 4];
    const at = SINK.plant + 3 + Math.floor(rng.next() * 3) + k;
    const out = 2;
    const sx = dx > 0 ? x0 + w : dx < 0 ? x0 - 1 : x0;
    const sy = dy > 0 ? y0 + w : dy < 0 ? y0 - 1 : y0;
    for (let s = 0; s < out; s++)
      for (let t = 0; t < 2; t++) {
        const x = sx + dx * s + (dx === 0 ? t : 0);
        const y = sy + dy * s + (dy === 0 ? t : 0);
        v.set(x, y, at, rib(x, y));
        v.set(x, y, at + 1, rib(x, y));
      }
    // Up from the arm's end.
    const ex = sx + dx * (out - 1);
    const ey = sy + dy * (out - 1);
    const up = 3 + Math.floor(rng.next() * 2);
    for (let z = at + 2; z < at + 2 + up; z++)
      for (let t = 0; t < 2; t++) {
        const x = ex + (dx === 0 ? t : 0);
        const y = ey + (dy === 0 ? t : 0);
        v.set(x, y, z, z === at + 1 + up ? CACTUS[2] : rib(x, y));
      }
  }
  if (shape === 1) {
    v.set(x0, y0 + 1, H, 0xf0709a);
    v.set(x0 + 1, y0, H, 0xf6d24a);
  }
  return v;
}

// Crystals: a cluster of prisms, each square, leaning a little, its tip drawn to a point, its faces
// in three tones (the shaded side, the lit side, and a light edge up one corner) and a pale tip.
function crystals(rng: Rng, seed: number, shape: number, tones = CRYSTAL): Vox {
  const v = new Vox(8, 16, 2);
  const n = 3 + (shape % 2) + (shape === 2 ? 1 : 0);
  const S = SINK.plant;
  for (let k = 0; k < n; k++) {
    const w = k === 0 ? 3 : 2;
    const a = rng.next() * Math.PI * 2;
    const d = k === 0 ? 0 : rng.range(1.8, 3);
    const bx = Math.round(4 + Math.cos(a) * d) - (w >> 1);
    const by = Math.round(4 + Math.sin(a) * d) - (w >> 1);
    const h = S + (k === 0 ? 9 + shape : 4 + Math.floor(rng.next() * 4));
    // Leaning outward, a cube every few steps.
    const lx = k === 0 ? 0 : Math.sign(Math.round(Math.cos(a) * 2));
    const ly = k === 0 ? 0 : Math.sign(Math.round(Math.sin(a) * 2));
    const every = 3 + Math.floor(rng.next() * 2);
    const base = tones[k % 2];
    for (let z = 0; z < h; z++) {
      const off = Math.floor(Math.max(0, z - S) / every);
      const tip = h - z;
      const ww = tip <= 1 ? 1 : tip <= 2 && w === 3 ? 2 : w;
      const sx = bx + lx * off + ((w - ww) >> 1);
      const sy = by + ly * off + ((w - ww) >> 1);
      for (let j = 0; j < ww; j++)
        for (let i = 0; i < ww; i++) {
          const edge = i === ww - 1 && j === 0;
          const c = tip <= 2 ? tones[2] : edge ? mix(base, 0xffffff, 0.45) : (i + j) % 2 && ww > 1 ? tone(base, 0.84) : base;
          v.set(sx + i, sy + j, z, c);
        }
    }
  }
  return v;
}

// A charred stump: a short trunk of dark wood, a ragged top, a root or two, off the cell's middle.
function stump(rng: Rng, seed: number, shape: number): Vox {
  const v = new Vox(8, 8, 1);
  const x0 = 2 + Math.floor(rng.next() * 4);
  const y0 = 2 + Math.floor(rng.next() * 4);
  const w = shape === 2 ? 1 : 2;
  const h = SINK.stump + 1 + Math.floor(rng.next() * 2) + (shape === 0 ? 1 : 0);
  v.box(x0, y0, 0, x0 + w, y0 + w, h, (x, y, z) => CHAR[(x + y + z) % 2]);
  v.set(x0 + (seed & 1), y0, h, CHAR[2]);
  v.set(x0 - 1, y0, SINK.stump, CHAR[0]);
  if (shape !== 2) v.set(x0 + w, y0 + 1, SINK.stump, CHAR[1]);
  return v;
}

// Embers: a few cubes glowing on the ash, off the cell's middle.
function embers(seed: number, shape: number): Vox {
  const v = new Vox(8, 3, 0);
  const at = [
    [1, 5],
    [5, 2],
  ][shape];
  const hot = [0xff9a2a, 0xffc24a, 0xe8501a];
  v.set(at[0], at[1], SINK.plant, hot[0], true);
  v.set(at[0] + 1, at[1], SINK.plant, hot[2], true);
  v.set(at[0], at[1] + 1, SINK.plant, hot[1], true);
  if (h3(shape, 0, 0, seed) < 0.6) v.set(at[0] + 2, at[1] + 2, SINK.plant, hot[2], true);
  return v;
}

// ---------------------------------------------------------------------------------------------
// What spells leave (18 November, the owner on the Fold: spells' covers drawn as flat tinted slabs
// and blocks, their voxels as big plain grey cubes, the only things on the island not in small
// textured cubes). A cover a spell registers is drawn by its name as one of the island's own looks,
// in its own colours: "mossy stone" as a boulder, "silverroot" as a thicket, "dry leaf" as leaf
// litter; a name that says none of them as a low heap of rubble (solid) or a spill of stones, in
// cubes. Drawing only: the cover's rules, its name and its colours stay what the spell said.
//
// Never a plain cube (21 November, the owner on a temperate grassland: "what are those big grey
// blocks?"): the look for a name that says nothing was a box 0.75 cells wide with a flat top, and a
// cover with no model at all (a job building or a site not drawn whole) a white box. Each is now
// rubble, a spill of stones or a broken footing in its material's tones, lower than half a cell,
// of several heights, in a few shapes by the cell's hash, so a row of them is not a row of blocks.

export type SpellLook = "rock" | "crystal" | "litter" | "plant" | "rubble" | "gravel" | "footing";
// The first that matches wins: "crystal moss" is a crystal, "dry leaf" litter, not a bush.
const LOOK_WORDS: [SpellLook, RegExp][] = [
  ["crystal", /crystal|gem|shard|quartz|amethyst|prism|diamond|glass|ice|frost|pearl|geode/],
  ["rock", /stone|rock|boulder|pebble|rubble|ore|basalt|granite|marble|obsidian|slate|cobble|flint|bone|salt|cairn/],
  ["litter", /leaf|leaves|petal|moss|lichen|dust|ash|litter|carpet|needle|straw|seed|spore/],
  [
    "plant",
    /root|bush|shrub|thorn|bramble|briar|vine|ivy|reed|grass|fern|weed|herb|bloom|blossom|flower|wheat|crop|mushroom|fung|sprout|lotus|lily|thicket|hedge/,
  ],
];
export const SPELL_SHAPES: Record<SpellLook, number> = { rock: 4, crystal: 3, litter: 3, plant: 2, rubble: 4, gravel: 3, footing: 3 };

export function spellLook(name: string, solid: boolean): SpellLook {
  const n = name.toLowerCase();
  for (const [look, words] of LOOK_WORDS) if (words.test(n)) return look;
  return solid ? "rubble" : "gravel";
}

const hexOf = (colors: readonly number[]) =>
  colors
    .slice(0, 6)
    .map((c) => c.toString(16).padStart(6, "0"))
    .join(".");

// The model's key for a spell's cover in a cell: "sp:rock:8c8a80.7a7669#2", its look, its colours
// and a shape picked by the cell's hash.
export function spellCoverKey(name: string, solid: boolean, colors: readonly number[], hash: number): string {
  const look = spellLook(name, solid);
  return `sp:${look}:${hexOf(colors)}#${(hash >>> 7) % SPELL_SHAPES[look]}`;
}

// The model's key for a cover of the island with no model of its own (view.ts coverKey): a
// building or a site not drawn whole as a broken footing, anything else as rubble, in its colours.
export function fallbackCoverKey(building: boolean, colors: readonly number[], hash: number): string {
  const look: SpellLook = building ? "footing" : "rubble";
  return `sp:${look}:${hexOf(colors)}#${(hash >>> 7) % SPELL_SHAPES[look]}`;
}

// Without the small cubes (the low preset): the box models of models.ts for the same looks, tinted
// per instance: "heap2", "spill0", "footing1".
export const BOX_FALLBACKS = { rubble: ["heap", 4], gravel: ["spill", 2], footing: ["footing", 2] } as const;
export function fallbackBoxKey(look: keyof typeof BOX_FALLBACKS, hash: number): string {
  const [name, n] = BOX_FALLBACKS[look];
  return `${name}${(hash >>> 7) % n}`;
}
export const isFallbackBox = (key: string): boolean => /^(heap|spill|footing)\d$/.test(key);

const lum = (c: number) => 0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255);

// A material's colours as tones, dark to light, for shadeBy: one colour gets a darker and a lighter
// of its own; several get a darker of the darkest under them, so a side is not as light as a top.
export function spellTones(colors: readonly number[]): number[] {
  const own = [...new Set(colors.length ? colors : [0xff00ff])].sort((a, b) => lum(a) - lum(b));
  if (own.length === 1) return [tone(own[0], 0.78), tone(own[0], 0.9), own[0], tone(own[0], 1.1)];
  return [tone(own[0], 0.84), ...own];
}

function spellCover(look: SpellLook, tones: number[], shape: number, seed: number): { v: Vox; sink: number } {
  const rng = new Rng(seed);
  if (look === "rock") return { v: boulder(rng, seed, shape, false, tones), sink: SINK.rock };
  if (look === "plant") return { v: bush(rng, seed, false, shape, tones), sink: SINK.plant };
  if (look === "crystal") {
    const n = tones.length;
    return { v: crystals(rng, seed, shape, [tones[Math.max(0, n - 3)], tones[n - 2], mix(tones[n - 1], 0xffffff, 0.45)]), sink: SINK.plant };
  }
  if (look === "litter") {
    // Leaves, petals or moss strewn in soft patches, a cube thick, two where they pile up.
    const v = new Vox(8, 4, 0);
    const S = SINK.plant;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const n = h3(Math.floor((x + shape * 3) / 2), Math.floor((y + shape) / 2), shape, seed) * 0.7 + h3(x, y, 1, seed) * 0.3;
        if (n > 0.62) continue;
        for (let z = 0; z <= S; z++) v.set(x, y, z, tones[1]);
        if (n < 0.2) v.set(x, y, S + 1, tones[1]);
      }
    shadeBy(v, tones, seed, S);
    return { v, sink: S };
  }
  if (look === "footing") return { v: footing(seed, shape, tones), sink: FOOT };
  return { v: look === "rubble" ? rubble(rng, seed, shape, tones) : gravel(rng, seed, shape, tones), sink: SINK.rock };
}

// A heap of rubble: a low broken mound off the cell's middle, a taller chunk leaning in it and a few
// loose stones round it. Its top is three to five cubes up, never flat: the lumps' rims are ragged.
function rubble(rng: Rng, seed: number, shape: number, tones: number[]): Vox {
  const v = new Vox(8, 10, 2);
  const cx = 4 + rng.range(-1.2, 1.2);
  const cy = 4 + rng.range(-1.2, 1.2);
  const parts: [number, number, number, number, number][] = [
    [cx, cy, rng.range(2.2, 3), rng.range(1.8, 2.6), [2.2, 2.6, 1.8, 2.4][shape]],
    [cx + rng.range(-1.6, 1.6), cy + rng.range(-1.6, 1.6), rng.range(1.1, 1.6), rng.range(1, 1.4), rng.range(3.2, 4.2)],
  ];
  const loose = 2 + (shape % 3);
  for (let k = 0; k < loose; k++) {
    const a = rng.next() * Math.PI * 2;
    const d = rng.range(2.6, 3.6);
    parts.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d, rng.range(0.8, 1.3), rng.range(0.7, 1.1), rng.range(0.6, 1.4)]);
  }
  lumps(v, seed, parts);
  shadeBy(v, tones, seed, SINK.rock);
  return v;
}

// A spill of stones: one of two or three cubes high and four to seven small ones over the cell.
function gravel(rng: Rng, seed: number, shape: number, tones: number[]): Vox {
  const v = new Vox(8, 8, 1);
  const parts: [number, number, number, number, number][] = [
    [rng.range(2.5, 5.5), rng.range(2.5, 5.5), rng.range(1.6, 2), rng.range(1.3, 1.7), rng.range(3, 3.6)],
  ];
  const n = 4 + shape + Math.floor(rng.next() * 2);
  for (let k = 0; k < n; k++) parts.push([rng.range(0.8, 7.2), rng.range(0.8, 7.2), rng.range(0.7, 1.3), rng.range(0.6, 1.1), rng.range(0.5, 1.8)]);
  lumps(v, seed, parts);
  shadeBy(v, tones, seed, SINK.rock);
  return v;
}

// A broken footing: a flagged floor at the land, a low wall round the cell's edge in runs of two
// cubes, each run its own height (one to four cubes) or gone, and a fallen stone inside.
const FOOT = 2;
function footing(seed: number, shape: number, tones: number[]): Vox {
  const v = new Vox(8, 8, 0);
  for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) if (h3(x, y, shape, seed ^ 0x19) > 0.25) for (let z = 0; z <= FOOT; z++) v.set(x, y, z, tones[1]);
  const ring: [number, number][] = [];
  for (let x = 0; x < 8; x++) ring.push([x, 0]);
  for (let y = 1; y < 8; y++) ring.push([7, y]);
  for (let x = 6; x >= 0; x--) ring.push([x, 7]);
  for (let y = 6; y > 0; y--) ring.push([0, y]);
  ring.forEach(([x, y], k) => {
    const n = h3(k >> 1, shape, 3, seed);
    if (n < 0.22) return;
    const h = 1 + Math.min(3, Math.floor(((n - 0.22) / 0.78) * 4));
    for (let z = 0; z < FOOT + h; z++) v.set(x, y, z, tones[2]);
  });
  const fx = 2 + Math.floor(h3(shape, 1, 1, seed) * 3);
  const fy = 2 + Math.floor(h3(shape, 2, 1, seed) * 3);
  v.set(fx, fy, FOOT + 1, tones[2]);
  v.set(fx + 1, fy, FOOT + 1, tones[1]);
  shadeBy(v, tones, seed, FOOT);
  return v;
}

function spellCoverInCubes(name: string, shape: number): LocalMesh {
  const [, look, hex] = name.split(":");
  const colors = (hex ?? "")
    .split(".")
    .map((h) => parseInt(h, 16))
    .filter((c) => Number.isFinite(c));
  const kind = (look in SPELL_SHAPES ? look : "gravel") as SpellLook;
  let seed = 0x5bd1 + shape * 7919;
  for (let k = 0; k < name.length; k++) seed = Math.imul(seed ^ name.charCodeAt(k), 0x01000193) >>> 0;
  const { v, sink } = spellCover(kind, spellTones(colors), shape % SPELL_SHAPES[kind], seed);
  return lowered(v.mesh(true), sink * CUBE);
}

// A spell's voxel (w.voxel, w.box, w.sphere: world.decor) as one cell of CUBE cubes, as the land's:
// soft patches of tone a few cubes across, lighter top edges and darker bottom ones. Its colour is
// the voxel's, given per instance: the model is VOXEL_BASE grey so its lightest cube stays under
// white, and the instance's colour is times VOXEL_GAIN to make the middle tone the voxel's own. Made
// once; centred on (0, 0, 0) as the plain box it replaces, its foot at -0.5.
export const VOXEL_BASE = 0xc8;
export const VOXEL_GAIN = 255 / VOXEL_BASE;
let voxelModel: LocalMesh | null = null;
export function voxelCube(): LocalMesh {
  if (voxelModel) return voxelModel;
  const v = new Vox(8, 8, 0);
  const c = VOXEL_BASE * 0x010101;
  v.box(0, 0, 0, 8, 8, 8, c);
  const seed = 0x3a71;
  const k: number[] = [];
  v.each((x, y, z) => {
    const n = h3(Math.floor((x + 1) / 3), Math.floor((y + 2) / 3), Math.floor((z + 1) / 3), seed);
    let t = PATCH_TONES[Math.min(PATCH_TONES.length - 1, Math.floor(n * PATCH_TONES.length))];
    const side = x === 0 || x === 7 || y === 0 || y === 7;
    if (side && z === 7) t *= EDGE_LIGHT;
    else if (side && z === 0) t *= EDGE_DARK;
    k.push(x, y, z, t);
  });
  for (let n = 0; n < k.length; n += 4) v.set(k[n], k[n + 1], k[n + 2], tone(c, k[n + 3]));
  const m = v.mesh(true);
  for (const a of [m.lit, m.glow])
    for (let n = 0; n < a.pos.length; n += 3) {
      a.pos[n] -= 0.5;
      a.pos[n + 1] -= 0.5;
      a.pos[n + 2] -= 0.5;
    }
  voxelModel = m;
  return m;
}

// ---------------------------------------------------------------------------------------------
// Flames: a tongue of fire in cubes, wide at its foot and tapering, white-yellow at its core, orange
// round it and dark red at its tips, a loose cube or two above. FLAME_FRAMES shapes of each of two
// sizes; a fire swaps its frame several times a second, each cell at its own beat.

export const FLAME_FRAMES = 3;
// A flame in cubes is 186 to 348 triangles, the old box 12: a wildfire of a thousand cells in cubes
// was 300,000 and more (the review of 16 November). Only the FLAME_CUBES nearest the camera are
// drawn in cubes, the others as the old box: at most FLAME_CUBES times the biggest frame.
export const FLAME_CUBES = 160;
export const FLAME_BOX_TRIANGLES = 12;

// The burning cells drawn in cubes: all when there are FLAME_CUBES or fewer, else the nearest by `far`.
export function nearestFlames(cells: readonly number[], far: (i: number) => number, n = FLAME_CUBES): Set<number> {
  if (cells.length <= n) return new Set(cells);
  const d = cells.map((i) => ({ i, d: far(i) }));
  d.sort((a, b) => a.d - b.d || a.i - b.i);
  return new Set(d.slice(0, n).map((o) => o.i));
}

const flames = new Map<number, LocalMesh>();
// A frame of a flame (0 to FLAME_FRAMES - 1), small or big, made once.
export function flameMesh(frame: number, big: boolean): LocalMesh {
  const key = frame * 2 + (big ? 1 : 0);
  let m = flames.get(key);
  if (!m) flames.set(key, (m = flame(frame, big)));
  return m;
}
const FLAME_HOT = [0xfff0a8, 0xffc23a, 0xff7a1a, 0xd8401a];

function flame(frame: number, big: boolean): LocalMesh {
  const H = big ? 13 : 8;
  const R = big ? 2.8 : 2.1;
  const v = new Vox(6, H + 3, 1);
  const seed = 0x5f1a + frame * 131 + (big ? 7 : 0);
  const phase = frame * 2.1;
  for (let z = 0; z < H; z++) {
    const t = z / H;
    const r = R * (1 - t ** 1.25) + 0.35;
    const cx = 3 + Math.sin(t * 4 + phase) * 0.7 * t;
    const cy = 3 + Math.cos(t * 3 + phase * 1.3) * 0.5 * t;
    for (let y = -1; y < 7; y++)
      for (let x = -1; x < 7; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > r + (h3(x, y, z, seed) - 0.5) * 0.7) continue;
        const k = t > 0.72 ? 3 : d < r * 0.45 && t < 0.55 ? 0 : d < r * 0.8 ? 1 : 2;
        v.set(x, y, z, FLAME_HOT[k], true);
      }
  }
  // A loose tongue above the tip.
  v.set(3 + (frame % 2), 3, H + 1, FLAME_HOT[3], true);
  if (big) v.set(2, 3 + (frame % 2), H + 2, FLAME_HOT[2], true);
  return v.mesh(true);
}

// The flames of the land's fires in cubes: one instanced mesh per frame and size, in the material
// of the old flames (it glows and blooms with them). begin, add each burning cell, finish.
export class CubeFlames {
  readonly meshes: InstancedMesh[] = [];
  private counts: number[] = [];
  private m = new Matrix4();
  private turn = new Matrix4();

  constructor(
    private scene: Scene,
    material: Material,
    capacity: number,
  ) {
    for (const big of [false, true])
      for (let f = 0; f < FLAME_FRAMES; f++) {
        const mesh = new InstancedMesh(geometryOfMesh(flameMesh(f, big)), material, capacity);
        mesh.count = 0;
        mesh.frustumCulled = false;
        scene.add(mesh);
        this.meshes.push(mesh);
        this.counts.push(0);
      }
  }

  begin(): void {
    this.counts.fill(0);
  }

  // A fire of strength `fire` (0 to 1) on cell i, its foot at (x, y, z) in the scene.
  add(x: number, y: number, z: number, fire: number, i: number, time: number): void {
    const frame = (Math.floor(time * 7 + (i % 13) * 0.37) + i) % FLAME_FRAMES;
    const k = (fire > 0.45 ? FLAME_FRAMES : 0) + frame;
    const mesh = this.meshes[k];
    const n = this.counts[k];
    if (n >= mesh.instanceMatrix.count) return;
    // Its model is a cell across, its middle at (0.5, 0.5): moved to the cell's middle, a quarter
    // turn by the cell so neighbouring fires differ.
    this.m.makeTranslation(-0.5, 0, -0.5);
    this.turn.makeRotationY((i % 4) * (Math.PI / 2));
    this.m.premultiply(this.turn);
    this.m.elements[12] += x;
    this.m.elements[13] += y;
    this.m.elements[14] += z;
    mesh.setMatrixAt(n, this.m);
    this.counts[k] = n + 1;
  }

  finish(): void {
    this.meshes.forEach((mesh, k) => {
      mesh.count = this.counts[k];
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  // Takes the flames out of the scene and frees their geometry (the material is the old flames').
  dispose(): void {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.meshes.length = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Clouds: soft puffy heaps of round billows on a flat base, white on top and a cool grey under,
// in cubes a little under a cell (they are far off: CLOUD_CUBE scene units each).

export const CLOUD_CUBE = 0.9;
const CLOUD = [0xd9e1ea, 0xeaf0f6, 0xfafcff];

export function puffyCloud(): LocalMesh {
  const v = new Vox(26, 12, 4, CLOUD_CUBE);
  const rng = new Rng(0xc10d);
  // Billows along the cloud's length, biggest in the middle; the base is cut flat at z 1 (z 0 is
  // left empty so the base's faces that look down are drawn: seen from under it in the eye view).
  const billows = 6;
  for (let k = 0; k < billows; k++) {
    const t = k / (billows - 1);
    const cx = 2 + t * 22 + rng.range(-1, 1);
    const cy = 8 + rng.range(-2.5, 2.5);
    const r = 3 + Math.sin(t * Math.PI) * 3.2 + rng.range(-0.6, 0.6);
    for (let z = 1; z < 12; z++)
      for (let y = -4; y < 30; y++)
        for (let x = -4; x < 30; x++) {
          const dx = (x + 0.5 - cx) / (r * 1.15);
          const dy = (y + 0.5 - cy) / r;
          const dz = (z + 0.5 - 1.5) / (r * 0.95);
          if (dx * dx + dy * dy + dz * dz <= 1) v.set(x, y, z, CLOUD[1]);
        }
  }
  v.each((x, y, z) => {
    const c = !v.has(x, y, z - 1) || z <= 1 ? CLOUD[0] : !v.has(x, y, z + 1) ? CLOUD[2] : z > 3 ? CLOUD[2] : CLOUD[1];
    v.set(x, y, z, c);
  });
  const m = v.mesh(true);
  return lowered(m, CLOUD_CUBE);
}

export function cloudMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92 });
}
