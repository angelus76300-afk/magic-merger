// The meshes of the 20 looks of scripts/fixtures/looks-20.json, as hashes: the
// props test compares today's with scripts/fixtures/looks-20-mesh.json, made
// by this script on main before the new shapes came in (2026-11-13, 49bd5e8).
//
//   npx esbuild scripts/looks-golden.ts --bundle --platform=node --format=esm --outfile=/tmp/lg.mjs && node /tmp/lg.mjs --write
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { readProp, shadeParts } from "../src/sim/props";
import { propMesh, type MeshArrays } from "../src/sim/voxel/props";

export interface Look {
  name: string;
  turn: unknown;
  vary: unknown;
  boxes: unknown;
}

const hash = (a: number[]) =>
  createHash("sha256")
    .update(Buffer.from(new Float32Array(a).buffer))
    .digest("hex")
    .slice(0, 16);

// As w.model does it: read, shade each part (vary 0.07 unless given), then draw at (56, 56) on ground 10.
export function lookMeshes(looks: Look[]): { name: string; tris: number; lit: string; glow: string }[] {
  return looks.map((l) => {
    const p = readProp({ key: "fx", name: l.name, x: 56, y: 56, turn: l.turn, boxes: l.boxes });
    if (!p) return { name: l.name, tris: 0, lit: "", glow: "" };
    const v = typeof l.vary === "number" && Number.isFinite(l.vary) ? Math.max(0, Math.min(0.3, l.vary)) : 0.07;
    shadeParts(p, v);
    const lit: MeshArrays = { pos: [], col: [] };
    const glow: MeshArrays = { pos: [], col: [] };
    propMesh(p, 10, 0.5, -3.5, lit, glow);
    return { name: l.name, tris: (lit.pos.length + glow.pos.length) / 9, lit: hash(lit.pos) + hash(lit.col), glow: hash(glow.pos) + hash(glow.col) };
  });
}

if (process.argv.includes("--write")) {
  const looks = JSON.parse(readFileSync("scripts/fixtures/looks-20.json", "utf8")) as Look[];
  const out = lookMeshes(looks);
  writeFileSync("scripts/fixtures/looks-20-mesh.json", JSON.stringify(out, null, 1) + "\n");
  console.log(out.map((o) => `${o.name}: ${o.tris} triangles`).join("\n"));
}
