// The village houses and the trees in small cubes (5.2.5, src/sim/voxel/cubes.ts, cube-houses.ts):
// with the switch off every house, building, site and tree is drawn exactly as main drew it
// (scripts/fixtures/cubes-off-mesh.json, made on main by scripts/cubes-golden.ts); with it on,
// near the camera, the houses keep their footprint, doors and lights, and each kind of tree its
// own model in cubes, cheaper at mid zoom.
import { readFileSync } from "node:fs";
import { Mesh, MeshBasicMaterial, Scene } from "three";
import { shapeHashes, villageHashes } from "./cubes-golden";
import { GRAPHICS, PRESETS } from "../src/sim/voxel/graphics";
import { Buildings, houseShape } from "../src/sim/voxel/buildings";
import { fineHouse } from "../src/sim/voxel/cube-houses";
import { CUBE, FINE_VARIANTS, cubeTree, fineFocus, lodAt, refocus } from "../src/sim/voxel/cubes";
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

  // Where they are drawn: eighths near the focus, quarters farther, the old model past that or zoomed out.
  const near = fineFocus(true, 26, 50, 50, null);
  check(
    "close zoom: eighth cubes by the focus, quarter cubes farther, old models past",
    !!near && lodAt(near, 2, 2) === 1 && lodAt(near, near.r + 2, 0) === 2 && lodAt(near, near.r2 + 1, 0) === 0,
  );
  check("zoomed far out or switched off: no cubes", fineFocus(true, 400, 0, 0, null) === null && fineFocus(false, 26, 0, 0, null) === null);
  check("placed again only once the camera looked away", !refocus(near, fineFocus(true, 26, 53, 50, null)) && refocus(near, fineFocus(true, 26, 70, 50, null)));

  // Trees: every kind has a model in cubes, cheaper in quarter cubes, and reads as a tree (taller than wide's half).
  const bad: string[] = [];
  for (const s of TREE_STYLES) {
    if (!s) continue;
    for (let v = 0; v < FINE_VARIANTS; v++) {
      const fine = cubeTree(s as Exclude<TreeStyle, "">, v);
      const mid = cubeTree(s as Exclude<TreeStyle, "">, v, true);
      let top = 0;
      for (let k = 1; k < fine.lit.pos.length; k += 3) top = Math.max(top, fine.lit.pos[k]);
      if (!fine.tris || mid.tris >= fine.tris || top < 0.6 || fine.tris > 1600) bad.push(`${s}:${v} ${fine.tris}/${mid.tris} top ${top.toFixed(2)}`);
    }
  }
  check("each kind of tree in cubes: drawn, under 1600 triangles, cheaper at mid zoom", bad.length === 0, bad.join("; "));

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
  const after = tris(fineFocus(true, 26, s0.x, s0.y, null));
  check(
    "a village near the camera in cubes: lit windows kept, more detail",
    after.lights === before.lights && after.n > before.n,
    `${before.n} -> ${after.n} triangles`,
  );
  GRAPHICS.cubes = was;
}
