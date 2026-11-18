// Lava (18 November, the owner on the Fold: the volcano's lava "looks like a flat bright orange
// sticker"). With the fine land (medium and high) a lava top carries the wave weight -1, which the
// fluid's shader draws as dark crust plates and glowing cracks (src/sim/voxel/lava.ts); on low no
// vertex does, so low draws lava as before. Before the change no lava top was marked (0 of them).
// scripts/lava-frames.mjs reads the pixels back from the view: their spread and their motion.
import { ShaderLib, type Mesh } from "three";
import { generateWorld } from "../src/sim/world";
import { DEFAULT_LAND } from "../src/sim/land-options";
import { GRAPHICS } from "../src/sim/voxel/graphics";
import { LAVA_CRUST, LAVA_TOP_FRAGMENT } from "../src/sim/voxel/lava";
import { F } from "../src/sim/materials";
import { landOf, withFine } from "./movement-test";

type Check = (name: string, ok: boolean, detail?: string) => void;

// For each vertex of the fluid's meshes: its wave weight and the fluid of the cell it lies over
// (tops only: a vertex whose quad is flat).
function fluidVertices(meshes: Mesh[], fluidMaterial: unknown, world: { w: number; h: number; fluid: Uint8Array }): { lava: number[]; other: number[] } {
  const lava: number[] = [];
  const other: number[] = [];
  for (const m of meshes) {
    if (m.material !== fluidMaterial || m.geometry.getAttribute("waterFine")) continue;
    const p = m.geometry.getAttribute("position").array as Float32Array;
    const wave = m.geometry.getAttribute("wave")?.array as Float32Array | undefined;
    for (let t = 0; t < p.length / 9; t++) {
      const y = p[t * 9 + 1];
      if (p[t * 9 + 4] !== y || p[t * 9 + 7] !== y) continue;
      // The triangle's middle names its cell.
      const cx = Math.floor((p[t * 9] + p[t * 9 + 3] + p[t * 9 + 6]) / 3 + world.w / 2);
      const cy = Math.floor((p[t * 9 + 2] + p[t * 9 + 5] + p[t * 9 + 8]) / 3 + world.h / 2);
      if (cx < 0 || cy < 0 || cx >= world.w || cy >= world.h) continue;
      const into = world.fluid[cy * world.w + cx] === F.LAVA ? lava : other;
      for (let k = 0; k < 3; k++) into.push(wave ? wave[t * 3 + k] : 0);
    }
  }
  return { lava, other };
}

export function lavaChecks(check: Check): void {
  const build = () => {
    const world = generateWorld(152, 152, 7, { ...DEFAULT_LAND, biome: "volcanic", peaks: true });
    const { terrain, meshes } = landOf(world);
    const fluid = (terrain as unknown as { fluidMaterial: unknown }).fluidMaterial;
    return fluidVertices(meshes, fluid, world);
  };
  // 1. With the fine land: every lava top marked, nothing else.
  const fine = withFine(build);
  const marked = fine.lava.filter((w) => w === -1).length;
  const strays = fine.other.filter((w) => w < 0).length;
  check(
    "lava: with the fine land every lava top carries the crust's mark (wave -1), no other fluid does",
    fine.lava.length > 300 && marked === fine.lava.length && strays === 0,
    `${marked} of ${fine.lava.length} lava top vertices marked, ${strays} of ${fine.other.length} others`,
  );
  // 2. On low (no fine land): none marked, lava as before.
  const was = GRAPHICS.fine;
  GRAPHICS.fine = false;
  let low: { lava: number[]; other: number[] };
  try {
    low = build();
  } finally {
    GRAPHICS.fine = was;
  }
  check(
    "lava: on low no lava top is marked (drawn as before)",
    low.lava.length > 300 && low.lava.every((w) => w === 0),
    `${low.lava.filter((w) => w !== 0).length} of ${low.lava.length} marked`,
  );
  // 3. The shader's pieces land where three has them: the fluid's opaque output and its common part.
  const frag = ShaderLib.basic.fragmentShader;
  const into = frag.replace("#include <opaque_fragment>", LAVA_TOP_FRAGMENT);
  check(
    "lava: the crust's shader goes before the basic material's opaque output",
    frag.includes("#include <opaque_fragment>") &&
      into.includes("mmLava(vSea") &&
      into.indexOf("mmLava(") < into.indexOf("#include <opaque_fragment>") &&
      LAVA_CRUST.includes("vec3 mmLava("),
  );
}
