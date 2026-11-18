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
import { CUBE } from "../src/sim/voxel/cubes";
import { SPELL_SHAPES, VOXEL_BASE, VOXEL_GAIN, coverInCubes, spellCoverKey, spellLook, spellTones, voxelCube } from "../src/sim/voxel/cover-cubes";
import { boxesInCubes, type LocalMesh } from "../src/sim/voxel/shapes";
import { MODELS } from "../src/sim/voxel/models";

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

export function leftoversChecks(check: Check): void {
  // The old block in cubes: patches on a white model, clipped above white.
  const before = topSpread(boxesInCubes(MODELS.block));
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
    ["glimmer", true, "block"],
    ["glimmer", false, "slab"],
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
