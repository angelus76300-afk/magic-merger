// The village houses and the trees in small cubes (5.2.5, src/sim/voxel/cubes.ts, cube-houses.ts):
// with the switch off every house, building, site and tree is drawn exactly as main drew it
// (scripts/fixtures/cubes-off-mesh.json, made on main by scripts/cubes-golden.ts); with it on,
// at every distance (15 November, one size of cube), the houses keep their footprint, doors and
// lights, and each kind of tree its own model in cubes of the one size, more of them when bigger.
import { readFileSync } from "node:fs";
import { Mesh, MeshBasicMaterial, Scene } from "three";
import { shapeHashes, villageHashes } from "./cubes-golden";
import { GRAPHICS, PRESETS } from "../src/sim/voxel/graphics";
import { Buildings, houseShape } from "../src/sim/voxel/buildings";
import { fineHouse } from "../src/sim/voxel/cube-houses";
import { CUBE, FINE_VARIANTS, SIZE_MAX, SIZE_MIN, cubeTree, fineFocus, lodAt, refocus, treeSize } from "../src/sim/voxel/cubes";
import { FAR_COARSEN, LOOK_VOXEL } from "../src/sim/voxel/shapes";
import { HOUSE_STYLES, TREE_STYLES, type TreeStyle } from "../src/sim/ecology";
import { generateWorld } from "../src/sim/world";
import { DEFAULT_LAND, resolveLand } from "../src/sim/land";

type Check = (name: string, ok: boolean, detail?: string) => void;

export function cubesChecks(check: Check): void {
  const was = GRAPHICS.cubes;
  GRAPHICS.cubes = false;
  const want = JSON.parse(readFileSync("scripts/fixtures/cubes-off-mesh.json", "utf8")) as Record<string, string>;
  const got = { ...shapeHashes(), ...villageHashes() };
  const differ = Object.keys(want).filter((k) => want[k] !== got[k]);
  check(
    "with the cubes off, every house, building, site, tree and village mesh is main's",
    differ.length === 0 && Object.keys(got).length === Object.keys(want).length,
    differ.slice(0, 5).join(", "),
  );

  check("the cubes are off on low, on at medium and high", !PRESETS.low.cubes && PRESETS.medium.cubes && PRESETS.high.cubes);

  // One size of cube everywhere (15 November, the owner: "let's just keep 1/8 all the time"): the
  // small cubes wherever the camera looks and however far, the eye view included; the looks of
  // spells in the same cubes, near and far.
  const near = fineFocus(true, 50, 50, null);
  check(
    "one size: houses and trees in eighth cubes at every distance and in the eye view, spells' looks too",
    !!near &&
      [0, 10, 30, 60, 200].every((d) => lodAt(near) === 1 && lodAt(fineFocus(true, 50 + d, 50, null)) === 1) &&
      lodAt(fineFocus(true, 0, 0, { x: 3, y: 4 })) === 1 &&
      LOOK_VOXEL === CUBE &&
      FAR_COARSEN === 1,
  );
  check("switched off: no cubes", fineFocus(false, 0, 0, null) === null);
  check(
    "placed again only when switched, or on entering the eye view",
    !refocus(near, fineFocus(true, 90, 50, null)) && refocus(near, fineFocus(true, 0, 0, { x: 1, y: 1 })),
  );

  // Trees: every kind has a model in cubes and reads as a tree (taller than wide's half). Bigger
  // trees have more cubes of the same size: every face of every size lies on the CUBE grid.
  const bad: string[] = [];
  for (const s of TREE_STYLES) {
    if (!s) continue;
    for (let v = 0; v < FINE_VARIANTS; v++) {
      const fine = cubeTree(s as Exclude<TreeStyle, "">, v);
      let top = 0;
      for (let k = 1; k < fine.lit.pos.length; k += 3) top = Math.max(top, fine.lit.pos[k]);
      if (!fine.tris || top < 0.6 || fine.tris > 1600) bad.push(`${s}:${v} ${fine.tris} top ${top.toFixed(2)}`);
      let last = 0;
      for (let size = SIZE_MIN; size <= SIZE_MAX; size++) {
        const m = cubeTree(s as Exclude<TreeStyle, "">, v, size);
        const shift = 0.5 - (size * CUBE) / 2;
        let off = 0;
        let high = 0;
        for (let k = 0; k < m.lit.pos.length; k += 3) {
          const x = (m.lit.pos[k] - shift) / CUBE;
          const y = m.lit.pos[k + 1] / CUBE;
          const z = (m.lit.pos[k + 2] - shift) / CUBE;
          off = Math.max(off, Math.abs(x - Math.round(x)), Math.abs(y - Math.round(y)), Math.abs(z - Math.round(z)));
          high = Math.max(high, m.lit.pos[k + 1]);
        }
        if (off > 1e-4) bad.push(`${s}:${v} size ${size} off the cube grid by ${off.toFixed(3)} cube`);
        if (high + 1e-6 < last) bad.push(`${s}:${v} size ${size} lower than size ${size - 1}`);
        last = high;
      }
    }
  }
  check(
    "each kind of tree in cubes: drawn, under 1600 triangles; bigger trees taller, in more cubes of the same size",
    bad.length === 0 && treeSize(1) === 8 && treeSize(1.3) === 10,
    bad.slice(0, 6).join("; "),
  );

  // Houses: the same footprint (within a cube), its lights on the walls of the new model.
  const off: string[] = [];
  for (const style of HOUSE_STYLES)
    for (let s = 0; s < 12; s++) {
      const seed = Math.imul(s + 7, 0x85ebca6b) >>> 0;
      const sh = houseShape(seed, style, s % 2 === 0, s % 3 === 0);
      const f = fineHouse(sh, seed);
      if (f.windows.length !== sh.windows.length || f.chimneys.length !== sh.chimneys.length) off.push(`${style}:${s} lights`);
      const p = sh.plan!;
      let x0 = Infinity;
      let x1 = -Infinity;
      f.vox.each((x, y, z) => {
        if (z !== Math.round(p.lift * 8) + 2) return;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x + 1);
      });
      if (!p.leanTo && (Math.abs(x0 * CUBE - p.x0) > 0.2 || Math.abs(x1 * CUBE - (p.x0 + p.w)) > 0.3))
        off.push(`${style}:${s} walls ${x0}-${x1} vs ${p.x0.toFixed(2)}-${(p.x0 + p.w).toFixed(2)}`);
      for (const c of f.chimneys) if (c.y < (sh.chimneys[0]?.y ?? 0) - 0.07) off.push(`${style}:${s} chimney lower than its smoke`);
    }
  check("houses in cubes keep their footprint, windows and chimneys", off.length === 0, off.slice(0, 4).join("; "));

  // A village drawn with the cubes on near its middle: more triangles, as many lights.
  const world = generateWorld(152, 152, 7, resolveLand({ ...DEFAULT_LAND }, 7, 152));
  const s0 = world.settlements[0];
  const tris = (fine: ReturnType<typeof fineFocus>) => {
    const scene = new Scene();
    const b = new Buildings(scene, new MeshBasicMaterial());
    for (let k = 0; k < 40; k++) {
      b.update(world, fine);
      if (!b.pending) break;
    }
    const n = scene.children.filter((o): o is Mesh => o instanceof Mesh).reduce((t, m) => t + m.geometry.getAttribute("position").count / 3, 0);
    return { n, lights: b.lights.windows.length };
  };
  const before = tris(null);
  const after = tris(fineFocus(true, s0.x, s0.y, null));
  check("a village in cubes: lit windows kept, more detail", after.lights === before.lights && after.n > before.n, `${before.n} -> ${after.n} triangles`);
  GRAPHICS.cubes = was;
}
