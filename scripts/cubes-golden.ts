// The village houses and the trees as main drew them before the small cubes (5.2.5, houses and
// trees): hashes of every house, building and site shape over many seeds and styles, of every
// tree and cover model, and of the merged village meshes of three islands. The cubes test
// compares today's with scripts/fixtures/cubes-off-mesh.json, made by this script on main
// (6e64175) before the change, so the switch off draws exactly what main drew.
//
//   npx esbuild scripts/cubes-golden.ts --bundle --platform=node --format=esm --outfile=/tmp/cg.mjs && node /tmp/cg.mjs --write
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { BufferGeometry, Scene, Mesh, MeshBasicMaterial } from "three";
import { Buildings, houseShape, jobShape, siteShape } from "../src/sim/voxel/buildings";
import { floraModels } from "../src/sim/voxel/flora";
import { geometryOf, type Box } from "../src/sim/voxel/models";
import { C } from "../src/sim/materials";
import { HOUSE_STYLES } from "../src/sim/ecology";
import { generateWorld } from "../src/sim/world";
import { DEFAULT_LAND, resolveLand } from "../src/sim/land";

const hash = (a: ArrayLike<number>) =>
  createHash("sha256")
    .update(Buffer.from(new Float32Array(Array.from(a)).buffer))
    .digest("hex")
    .slice(0, 16);

const boxesHash = (boxes: Box[]) => hash(boxes.flatMap((b) => [b.x, b.y, b.z, b.w, b.h, b.d, b.color]));
const geomHash = (g: BufferGeometry) => hash(g.getAttribute("position").array) + hash(g.getAttribute("color").array);

const JOBS = [C.SMITHY, C.GRANARY, C.BAKERY, C.BARN, C.TAVERN, C.MARKET, C.CHAPEL, C.WATCHTOWER, C.LUMBERYARD, C.FISHERHUT];

export function shapeHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const style of HOUSE_STYLES)
    for (let s = 0; s < 24; s++) {
      const seed = Math.imul(s + 1, 0x9e3779b1) >>> 0;
      for (const grown of [false, true])
        for (const patched of [false, true]) {
          const sh = houseShape(seed, style, grown, patched);
          out[`house:${style}:${s}:${grown ? 1 : 0}${patched ? 1 : 0}`] =
            boxesHash(sh.boxes) + hash(sh.windows.flatMap((w) => [w.x, w.y, w.z, w.axis])) + hash(sh.chimneys.flatMap((c) => [c.x, c.y, c.z]));
          if (!grown && !patched) for (const stage of [0, 1, 2, 3]) out[`site:${style}:${s}:${stage}`] = boxesHash(siteShape(sh, stage, 5));
        }
      for (const kind of JOBS) {
        const sh = jobShape(seed, kind, style);
        out[`job:${kind}:${style}:${s}`] = boxesHash(sh.boxes) + hash(sh.windows.flatMap((w) => [w.x, w.y, w.z, w.axis]));
      }
    }
  for (const [key, boxes] of Object.entries(floraModels())) out[`flora:${key}`] = geomHash(geometryOf(boxes));
  // One hash per group (house:timber, job:23, site:stone, flora:...), so the fixture stays small.
  const groups: Record<string, string> = {};
  for (const [k, v] of Object.entries(out)) {
    const g = k.startsWith("flora:") ? k : k.split(":").slice(0, 2).join(":");
    groups[g] = (groups[g] ?? "") + v;
  }
  return Object.fromEntries(Object.entries(groups).map(([g, v]) => [g, createHash("sha256").update(v).digest("hex").slice(0, 16)]));
}

// The merged mesh of the houses and buildings of an island, and of its sites.
export function villageHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const seed of [7, 21, 4242]) {
    const world = generateWorld(152, 152, seed, resolveLand({ ...DEFAULT_LAND }, seed, 152));
    const scene = new Scene();
    const b = new Buildings(scene, new MeshBasicMaterial());
    b.update(world);
    const meshes = scene.children.filter((o): o is Mesh => o instanceof Mesh);
    out[`village:${seed}`] = meshes.map((m) => geomHash(m.geometry)).join("|") + `:${world.settlements.length}`;
    out[`lights:${seed}`] = hash(b.lights.windows.flatMap((w) => [w.x, w.y, w.z, w.axis])) + hash(b.lights.chimneys.flatMap((c) => [c.x, c.y, c.z]));
  }
  return out;
}

if (process.argv.includes("--write")) {
  const out = { ...shapeHashes(), ...villageHashes() };
  writeFileSync("scripts/fixtures/cubes-off-mesh.json", JSON.stringify(out, null, 1) + "\n");
  console.log(Object.keys(out).length, "hashes", out["village:7"], out["village:21"]);
}
