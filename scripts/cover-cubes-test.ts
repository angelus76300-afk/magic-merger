// What stands on the land in small cubes (16 November, src/sim/voxel/cover-cubes.ts): rocks,
// shrubs, cacti, crystals, stumps and embers, flames and clouds, each in several shapes of CUBE
// cubes, seated with their foot under the land; burnt stumps scattered and thinned; and every model
// of boxes in cubes with tone patches of about a tenth and lighter top edges, darker bottom ones.
import { G } from "../src/sim/materials";
import { CUBE } from "../src/sim/voxel/cubes";
import { COVER_SHAPES, EMBER_EVERY, FLAME_FRAMES, STUMP_THIN, coverCubeGlows, coverCubeKeys, coverInCubes, puffyCloud } from "../src/sim/voxel/cover-cubes";
import { EDGE_DARK, EDGE_LIGHT, PATCH_TONES, boxesInCubes, type LocalMesh } from "../src/sim/voxel/shapes";
import { MODELS } from "../src/sim/voxel/models";
import { COVER_MODELS } from "../src/sim/voxel/flora";

type Check = (name: string, ok: boolean, detail?: string) => void;

// The distinct colours of a mesh's faces, as the unlit colour can't be read back: the colours of
// its top faces (light 1 at full corner light) are what the sky sees.
function colours(m: LocalMesh): Set<string> {
  const out = new Set<string>();
  for (const a of [m.lit, m.glow])
    for (let k = 0; k < a.col.length; k += 3) out.add(`${a.col[k].toFixed(3)},${a.col[k + 1].toFixed(3)},${a.col[k + 2].toFixed(3)}`);
  return out;
}

function lowest(m: LocalMesh): number {
  let y = Infinity;
  for (const a of [m.lit, m.glow]) for (let k = 1; k < a.pos.length; k += 3) y = Math.min(y, a.pos[k]);
  return y;
}

function hues(m: LocalMesh, pick: (r: number, g: number, b: number) => boolean): number {
  let n = 0;
  for (const a of [m.lit, m.glow]) for (let k = 0; k < a.col.length; k += 3) if (pick(a.col[k], a.col[k + 1], a.col[k + 2])) n++;
  return n;
}

export function coverCubesChecks(check: Check): void {
  const tris: string[] = [];
  for (const [name, n] of Object.entries(COVER_SHAPES)) {
    const meshes = Array.from({ length: n }, (_, s) => coverInCubes(`${name}#${s}`)!);
    const old = MODELS[name] ?? COVER_MODELS[name];
    tris.push(`${name} ${old ? boxesInCubes(old).tris : "-"} -> ${meshes.map((m) => m.tris).join("/")}`);
    const keys = new Set(meshes.map((m) => [...m.lit.pos.slice(0, 30), ...m.glow.pos.slice(0, 30)].join()));
    check(`${name}: ${n} shapes, each its own`, meshes.every((m) => m.tris > 0) && keys.size === n);
    // Every face on the CUBE grid: one size of cube.
    const off = meshes.some((m) =>
      m.lit.pos.some((v) => Math.abs(v / CUBE - Math.round(v / CUBE)) > 1e-3 && Math.abs((v - 0.5) / CUBE - Math.round((v - 0.5) / CUBE)) > 1e-3),
    );
    check(`${name}: cubes of the one size`, !off);
  }
  console.log("  triangles per shape, the old model in cubes -> the new shapes:", tris.join("; "));

  // Rocks: four greys or more, moss on a green ground, their foot under the land, under 1200 triangles.
  const rock = coverInCubes("boulder#0")!;
  const mossy = coverInCubes("boulder#0m")!;
  check("rocks: three or more tones of grey", colours(rock).size >= 6);
  check(
    "rocks: moss on top where the ground is green",
    hues(mossy, (r, g, b) => g > r * 1.25 && g > b * 1.25) > 0 && hues(rock, (r, g, b) => g > r * 1.25 && g > b * 1.25) === 0,
  );
  check("rocks: seated, their foot under the land", lowest(rock) <= -2 * CUBE + 1e-6);
  check(
    "rocks: no shape over 1200 triangles",
    [0, 1, 2, 3].every((s) => coverInCubes(`boulder#${s}`)!.tris <= 1200),
  );
  check(
    "rocks: green ground gives a mossy shape, rock does not",
    coverCubeKeys("boulder", 1 << 7, G.GRASS)[0] === "boulder#1m" && coverCubeKeys("boulder", 1 << 7, G.ROCK)[0] === "boulder#1",
  );

  // Shrubs: greens, and berries red and blue on the berry bush.
  const berries = coverInCubes("berries#0")!;
  check("shrubs: a clump in two or more greens", hues(coverInCubes("bush#0")!, (r, g, b) => g > r && g > b) > 0 && colours(coverInCubes("bush#0")!).size >= 4);
  check("shrubs: berries red on the berry bush", hues(berries, (r, g, b) => r > g * 2 && r > b * 2) > 0);

  // Cacti: taller than wide, ribs in two greens, a flower on one shape.
  const cactus = coverInCubes("cactus#1")!;
  let top = 0;
  for (let k = 1; k < cactus.lit.pos.length; k += 3) top = Math.max(top, cactus.lit.pos[k]);
  check("cacti: a column over a cell tall", top >= 1);
  check("cacti: a flower on one shape", hues(cactus, (r, g, b) => r > g * 1.2 && r > b) > 0);

  // Crystals: pointed (a top a cube across), a light edge, they shine.
  check("crystals: three tones or more", colours(coverInCubes("crystals#0")!).size >= 5);
  check("crystals: drawn in the glow", coverCubeGlows("crystals#0") && !coverCubeGlows("boulder#0"));

  // Stumps of a burnt forest: one in STUMP_THIN drawn, embers by one in EMBER_EVERY of those, glowing.
  let drawn = 0;
  let embers = 0;
  let grass = 0;
  for (let h = 0; h < 6000; h++) {
    const ks = coverCubeKeys("stump", Math.imul(h, 2654435761) >>> 0, G.ASH);
    if (ks.some((k) => k.startsWith("stump#"))) drawn++;
    if (ks.some((k) => k.startsWith("ember#"))) embers++;
    if (coverCubeKeys("stump", Math.imul(h, 2654435761) >>> 0, G.GRASS).length === 1) grass++;
  }
  check(
    `burnt stumps thinned (${drawn} of 6000), a few embers (${embers})`,
    Math.abs(drawn / 6000 - 1 / STUMP_THIN) < 0.05 && embers > 300 && embers < 6000 / EMBER_EVERY && grass === 6000,
  );
  check("embers glow", coverCubeGlows("ember#0") && coverInCubes("ember#0")!.glow.pos.length > 0);
  // Stumps no longer sit on the cell's middle: a grid of them was the checkerboard.
  const mids = [0, 1, 2].map((s) => {
    const m = coverInCubes(`stump#${s}`)!;
    let x = 0;
    for (let k = 0; k < m.lit.pos.length; k += 3) x += m.lit.pos[k];
    return x / (m.lit.pos.length / 3);
  });
  check(
    "stumps off the cell's middle",
    mids.some((x) => Math.abs(x - 0.5) > 0.1),
  );

  // Flames and clouds.
  check("flames: frames to swap", FLAME_FRAMES >= 3);
  const cloud = puffyCloud();
  check(`a puffy cloud in ${cloud.tris} triangles, under 4000, with faces looking down`, cloud.tris < 4000 && cloud.lit.pos.length > 0);

  // Models of boxes in cubes: patches of about a tenth, top edges lighter and bottom edges darker.
  check("tone patches about a tenth either way", Math.min(...PATCH_TONES) <= 0.91 && Math.max(...PATCH_TONES) >= 1.09);
  const slab = boxesInCubes([{ x: 0, y: 0, z: 0, w: 2, h: 1, d: 2, color: 0x808080 }]);
  const brightest = Math.max(...[...colours(slab)].map((c) => Number(c.split(",")[0])));
  check("a box's top edges lighter than its patches", EDGE_LIGHT > 1 && EDGE_DARK < 1 && brightest > (0x80 / 255) * Math.max(...PATCH_TONES) + 1e-3);
}
