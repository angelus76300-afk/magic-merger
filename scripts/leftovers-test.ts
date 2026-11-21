// What spells leave on the land in small cubes (18 November, src/sim/voxel/cover-cubes.ts): a
// spell's voxel as a cell of CUBE cubes with tone patches and lit edges, and a cover a spell
// registers as one of the island's looks by its name, in its own colours, instead of a plain block
// or slab tinted with one colour. The before: the plain box's top face is one colour (spread 0), the
// old block in cubes 0.04 (its white patches clipped). scripts/leftovers-frames.mjs reads the same
// spread back from the view, with the voxels' feet on the fine land.
import { BufferGeometry, Color, InstancedMesh, Matrix4, MeshBasicMaterial } from "three";
import { DecorStore } from "../src/sim/decor";
import { VK, packVoxel } from "../src/sim/voxels";
import { keyLevel, voxelKey } from "../src/sim/voxelkey";
import { DecorInstances } from "../src/sim/voxel/decor-instances";
import { CUBE, Vox, h3 } from "../src/sim/voxel/cubes";
import {
  BOX_FALLBACKS,
  SPELL_SHAPES,
  VOXEL_BASE,
  VOXEL_GAIN,
  coverInCubes,
  fallbackBoxKey,
  fallbackCoverKey,
  isFallbackBox,
  spellCoverKey,
  spellLook,
  spellTones,
  voxelCube,
} from "../src/sim/voxel/cover-cubes";
import { boxesInCubes, type LocalMesh } from "../src/sim/voxel/shapes";
import { MODELS, type Box } from "../src/sim/voxel/models";
import { floraModels } from "../src/sim/voxel/flora";
import { BUILTIN, C, isBuilding } from "../src/sim/materials";

type Check = (name: string, ok: boolean, detail?: string) => void;

// (max - min) / max of the brightness of the faces looking up.
export function topSpread(m: LocalMesh): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of [m.lit, m.glow])
    for (let t = 0; t < a.pos.length; t += 9) {
      const p = a.pos;
      const e1 = [p[t + 3] - p[t], p[t + 4] - p[t + 1], p[t + 5] - p[t + 2]];
      const e2 = [p[t + 6] - p[t], p[t + 7] - p[t + 1], p[t + 8] - p[t + 2]];
      const ny = e1[2] * e2[0] - e1[0] * e2[2];
      const len = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], ny, e1[0] * e2[1] - e1[1] * e2[0]);
      if (len === 0 || Math.abs(ny / len) < 0.9) continue;
      for (let k = 0; k < 3; k++) {
        const c = t + k * 3;
        const l = 0.299 * a.col[c] + 0.587 * a.col[c + 1] + 0.114 * a.col[c + 2];
        lo = Math.min(lo, l);
        hi = Math.max(hi, l);
      }
    }
  return hi > 0 ? (hi - lo) / hi : 0;
}

function bounds(m: LocalMesh): { lo: number[]; hi: number[] } {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const a of [m.lit, m.glow])
    for (let k = 0; k < a.pos.length; k++) {
      lo[k % 3] = Math.min(lo[k % 3], a.pos[k]);
      hi[k % 3] = Math.max(hi[k % 3], a.pos[k]);
    }
  return { lo, hi };
}

const SPREAD = 0.1;

// The levels of the faces looking up, in cubes above the land (model y 0), and the share of the
// model's footprint its highest level covers. A plain box: one level, all of it. The old spell
// block in cubes: two (its top and the worn corners), the highest over four fifths of it.
export function topLevels(m: LocalMesh): { levels: number; highest: number; top: number } {
  const at = new Map<number, number>();
  for (const a of [m.lit, m.glow])
    for (let t = 0; t < a.pos.length; t += 9) {
      const p = a.pos;
      if (Math.abs(p[t + 1] - p[t + 4]) > 1e-6 || Math.abs(p[t + 1] - p[t + 7]) > 1e-6) continue;
      const e1 = [p[t + 3] - p[t], p[t + 5] - p[t + 2]];
      const e2 = [p[t + 6] - p[t], p[t + 8] - p[t + 2]];
      const area = (e1[1] * e2[0] - e1[0] * e2[1]) / 2;
      if (area <= 1e-9) continue;
      const y = Math.round(p[t + 1] / CUBE);
      at.set(y, (at.get(y) ?? 0) + area);
    }
  const up = [...at.keys()].filter((y) => y > 0);
  const top = up.length ? Math.max(...up) : 0;
  const total = [...at.entries()].filter(([y]) => y > 0).reduce((s, [, a]) => s + a, 0);
  return { levels: up.length, highest: total > 0 ? (at.get(top) ?? 0) / total : 1, top: top * CUBE };
}

// The old spell block in cubes, as it was drawn to 21 November (cover-cubes.ts before): a box six
// cubes wide and tall on a foot of two under the land, its top corners worn, its top a little ragged.
function spellCoverInCubesOld(): LocalMesh {
  const v = new Vox(8, 10, 0);
  const H = 8;
  v.box(1, 1, 0, 7, 7, H, 0xb4b4ba);
  for (const [x, y] of [
    [1, 1],
    [6, 1],
    [1, 6],
    [6, 6],
  ])
    v.clear(x, y, H - 1);
  for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) if (h3(x, y, 0, 0x77) < 0.12) v.clear(x, y, H - 1);
  const m = v.mesh(true);
  for (const a of [m.lit, m.glow]) for (let k = 1; k < a.pos.length; k += 3) a.pos[k] -= 2 * CUBE;
  return m;
}

// The same of a box model (the low preset): its boxes' top heights.
const boxTops = (boxes: Box[]) => new Set(boxes.map((b) => Math.round((b.y + b.h) * 100))).size;

// The old look of a cover with no model and of a spell's cover that names nothing: one box.
const PLAIN: Box[] = [{ x: 0.1, y: 0, z: 0.1, w: 0.8, h: 0.8, d: 0.8, color: 0xffffff }];

export function leftoversChecks(check: Check): void {
  // The old block in cubes: patches on a white model, clipped above white.
  const before = topSpread(boxesInCubes(PLAIN));
  const cube = voxelCube();
  const spread = topSpread(cube);
  check(`a spell's voxel: tone patches and lit edges on its top (spread ${spread.toFixed(3)}, at least ${SPREAD})`, spread >= SPREAD);
  check("a spell's voxel: under 600 triangles", cube.tris <= 600, `${cube.tris}`);
  const b = bounds(cube);
  check(
    "a spell's voxel: one cell, centred as the box it replaces",
    b.lo.every((v) => Math.abs(v + 0.5) < 1e-6) && b.hi.every((v) => Math.abs(v - 0.5) < 1e-6),
    JSON.stringify(b),
  );
  // Its middle tone is the voxel's own colour, its lightest under white.
  let max = 0;
  for (let k = 0; k < cube.lit.col.length; k++) max = Math.max(max, cube.lit.col[k]);
  check("a spell's voxel: its lightest cube under white", max <= 1 && max > VOXEL_BASE / 255, `${max.toFixed(3)}`);
  check("a spell's voxel: its colour given back by the gain", Math.abs((VOXEL_BASE / 255) * VOXEL_GAIN - 1) < 1e-9);

  // Covers by name: the library's spell covers and a few more.
  const named: [string, boolean, string][] = [
    ["dry leaf", false, "litter"],
    ["moss carpet", false, "litter"],
    ["silverroot", true, "plant"],
    ["mossy stone", true, "rock"],
    ["pearl", false, "crystal"],
    ["amber blossom", false, "plant"],
    ["dawnbloom", false, "plant"],
    ["golden wheat", false, "plant"],
    ["deepstone", true, "rock"],
    ["glimmer", true, "rubble"],
    ["glimmer", false, "gravel"],
    ["warding obelisk", true, "rubble"],
  ];
  for (const [name, solid, look] of named) check(`spell cover "${name}" drawn as ${look}`, spellLook(name, solid) === look, spellLook(name, solid));
  check(`the old block in cubes has a flat top (spread ${before.toFixed(3)}, under ${SPREAD})`, before < SPREAD);
  const palettes: [string, boolean, number[]][] = [
    ["dry leaf", false, [0x8c8a80, 0x7a7669]],
    ["moss carpet", false, [0x4f7a3a, 0x5e8c44]],
    ["silverroot", true, [0xe6eef5, 0xc9d6e0, 0xf4f8fb]],
    ["mossy stone", true, [0x7d8278, 0x6a7064]],
    ["pearl", false, [0xf4f0ff, 0xffe4f0, 0xe0f4ff]],
    ["glimmer", true, [0x9a40c0]],
    ["glimmer", false, [0x9a40c0]],
  ];
  const lines: string[] = [];
  for (const [name, solid, colors] of palettes) {
    const look = spellLook(name, solid);
    const meshes: LocalMesh[] = [];
    for (let s = 0; s < SPELL_SHAPES[look]; s++) {
      const key = spellCoverKey(name, solid, colors, s << 7);
      const m = coverInCubes(key);
      if (m) meshes.push(m);
    }
    const spreads = meshes.map(topSpread);
    lines.push(`${name} (${look}) ${meshes.map((m) => m.tris).join("/")} tris, spread ${spreads.map((x) => x.toFixed(2)).join("/")}`);
    check(`spell cover "${name}": ${SPELL_SHAPES[look]} shapes in cubes`, meshes.length === SPELL_SHAPES[look] && meshes.every((m) => m.tris > 0));
    check(
      `spell cover "${name}": tones on its top (at least ${SPREAD})`,
      spreads.every((x) => x >= SPREAD),
      spreads.join(),
    );
    check(
      `spell cover "${name}": under 1500 triangles`,
      meshes.every((m) => m.tris <= 1500),
    );
    check(
      `spell cover "${name}": its foot under the land`,
      meshes.every((m) => bounds(m).lo[1] <= -CUBE + 1e-6),
    );
    // Its own colours: the middle of its top faces near the material's (within a quarter).
    const tones = spellTones(colors);
    check(`spell cover "${name}": tones of its own colours`, tones.length >= 3 && tones.includes(colors[0]));
  }
  console.log("  spell covers in cubes:", lines.join("; "), `; voxel ${cube.tris} tris, spread ${spread.toFixed(2)}`);

  // No plain cubes (21 November, the owner: "what are those big grey blocks?"). A spell's cover
  // whose name says nothing, and a cover of the island with no model (a job building or a site not
  // drawn whole), are rubble, stones or a broken footing: in cubes, every shape on at least three
  // levels, its highest level at most a third of its top, under 0.6 cells tall; as boxes (the low
  // preset), at least three heights. The old block: two levels, the highest 0.9 of its top.
  const old = topLevels(spellCoverInCubesOld());
  check(`the old spell block in cubes is a plain cube (levels ${old.levels}, highest ${old.highest.toFixed(2)})`, old.levels < 3 || old.highest > 1 / 3);
  const flora = floraModels();
  const fallbacks: [string, string][] = [];
  for (const [solid, colors] of [
    [true, [0xc8c8cc, 0xb4b4ba]],
    [false, [0xc8c8cc]],
    [true, [0x9a40c0]],
  ] as [boolean, number[]][])
    for (let s = 0; s < 4; s++) fallbacks.push([`spell cover "glimmer" (${solid ? "solid" : "not solid"})`, spellCoverKey("glimmer", solid, colors, s << 7)]);
  const unmodelled: string[] = [];
  // The view draws none (skipped), a wonder (its own model), fences and bridges (by their way).
  for (const [id, mat] of BUILTIN.cover.entries()) {
    if (id === C.NONE || id === C.WONDER || id === C.FENCE || id === C.BRIDGE) continue;
    if (MODELS[mat.name] || flora[mat.name]) continue;
    unmodelled.push(mat.name);
    const building = isBuilding(id) || id === C.SITE;
    for (let s = 0; s < 4; s++) fallbacks.push([`"${mat.name}" not drawn whole`, fallbackCoverKey(building, mat.colors, s << 7)]);
  }
  check("covers with no model: the job buildings and the building site", unmodelled.length === 11, unmodelled.join());
  const flat: string[] = [];
  const shown: string[] = [];
  for (const [what, key] of fallbacks) {
    const m = coverInCubes(key);
    const t = m ? topLevels(m) : null;
    if (!t || t.levels < 3 || t.highest > 1 / 3 || t.top > 0.6) flat.push(`${what} ${key}: ${JSON.stringify(t)}`);
    else if (shown.length < 6) shown.push(`${key.split(":")[1]}#${key.split("#")[1]} ${t.levels} levels, ${t.highest.toFixed(2)}, ${t.top.toFixed(2)} tall`);
  }
  console.log("  no plain cubes:", shown.join("; "));
  check(`no cover with no look drawn as a plain cube in cubes (${fallbacks.length} shapes)`, flat.length === 0, flat.join(" | "));
  // A row of cells: more than one shape, so a row of them is not regular.
  const row = new Set(Array.from({ length: 8 }, (_, k) => fallbackCoverKey(false, [0xc8c8cc], Math.imul(k + 1, 0x9e3779b1) >>> 0)));
  check("a row of eight rubble cells: more than two shapes", row.size > 2, `${row.size}`);
  const boxes: string[] = [];
  for (const [look, [name, n]] of Object.entries(BOX_FALLBACKS))
    for (let s = 0; s < n; s++) {
      const key = fallbackBoxKey(look as keyof typeof BOX_FALLBACKS, s << 7);
      const model = MODELS[key];
      if (key !== `${name}${s}` || !isFallbackBox(key) || !model || boxTops(model) < 3 || Math.max(...model.map((b) => b.y + b.h)) > 0.6) boxes.push(key);
    }
  check("without the small cubes: every fallback box model on at least three heights, under 0.6 cells", boxes.length === 0, boxes.join());
  check("no plain block or slab model left", !MODELS.block && !MODELS.slab);

  // The instances: a block of 3 by 3 by 3 voxels draws 25 (the middle column's two lower ones are
  // shut in), each lifted by its seat and times the gain; one taken from the top shows the one under it.
  const meshes: [InstancedMesh, InstancedMesh] = [
    new InstancedMesh(new BufferGeometry(), new MeshBasicMaterial(), 64),
    new InstancedMesh(new BufferGeometry(), new MeshBasicMaterial(), 64),
  ];
  const decor = new DecorStore();
  for (let z = 0; z < 3; z++) for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) decor.set(voxelKey(10 + x, 10 + y, 5 + z), packVoxel(0x8a8580, VK.STONE));
  const inst = new DecorInstances(meshes, 64, 32, 32);
  inst.restyle(true, VOXEL_GAIN, (key) => (keyLevel(key) === 5 ? -0.25 : 0));
  inst.update(decor, new Map(), 0);
  check("spell voxels: the shut in ones not drawn (25 of 27)", meshes[0].count === 25, `${meshes[0].count}`);
  const m = new Matrix4();
  const c = new Color();
  let lifted = 0;
  for (let k = 0; k < meshes[0].count; k++) {
    meshes[0].getMatrixAt(k, m);
    if (Math.abs(m.elements[13] - 5.25) < 1e-6) lifted++;
  }
  check("spell voxels: seated by their lift (8 at the foot drawn)", lifted === 8, `${lifted}`);
  meshes[0].getColorAt(0, c);
  const want = new Color(0x8a8580).multiplyScalar(VOXEL_GAIN);
  check("spell voxels: their colour times the gain", Math.abs(c.r - want.r) < 1e-6 && Math.abs(c.g - want.g) < 1e-6);
  decor.delete(voxelKey(11, 11, 7));
  inst.update(decor, new Map(), 0);
  check("spell voxels: one taken away shows the one under it (25 drawn)", meshes[0].count === 25, `${meshes[0].count}`);
}
